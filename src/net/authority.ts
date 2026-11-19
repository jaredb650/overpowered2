/**
 * The host's check on what a guest says its weapons did. This is a game among friends, so the rule is: favour the shooter. An
 * honest player never loses a hit, on any weapon, with any perk, mod or implant, on a bad connection. What is left guards
 * against the absurd: a flood, a number no weapon makes, a shot from the other side of the map.
 *
 * - **Rate.** A hit belongs to a shot (the claim's `shot` id) and once a shot is in, all its hits are. Shots are counted per gun
 *   in a token bucket filled on the shooter's own clock (the claim's `at`), so bunching from lag or a host hitch costs nothing.
 *   The bucket fills at the fastest that gun can fire with every mod, akimbo, Gun Kata and the perks' rate cap (`limitsOf`).
 * - **Amount.** A claim over its cap is cut to the cap, never thrown away. An instakill a weapon really has stays an instakill.
 * - **Sight.** Only a straight shot from a gun that cannot pass walls is tested, from the eye the claim names to the point it
 *   hit, with second looks and a small allowance before a hit is refused.
 * - **Kind.** What made the damage decides how it is checked (`claimClass`): a gun, a melee weapon, a blast, a call-in, a perk,
 *   a mounted gun, the player's own body. Only a gun needs a shot.
 */
import type { HitClaim, StatusClaim, VehicleClaim } from './world/claims';
import { REGIONS, validVec, type Vec } from './world/wire';
import { WEAPONS, type WeaponDef } from '../weapons/data';
import type { ModId, WeaponId } from '../core/gameplay';
import { MODS, MOD_ORDER, moddedDef } from '../weapons/mods';
import { KATA } from '../weapons/kata';
import { ENERGY, isMelee } from '../weapons/melee/data';

const distance = (left: readonly number[], right: readonly number[]) => Math.hypot(...left.map((value, index) => value - right[index]!));
export interface Target { id: string; alive: boolean; position: readonly number[] }
export function selectTarget(position: readonly number[], players: readonly Target[], previous?: string): Target | undefined {
  const live = players.filter(player => player.alive);
  let best = live.find(player => player.id === previous);
  let range = best ? distance(position, best.position) * 0.8 : Infinity;
  for (const player of live) {
    const next = distance(position, player.position);
    if (next < range) { best = player; range = next; }
  }
  return best;
}

// ---------------------------------------------------------------------------------------------
// What made the damage
// ---------------------------------------------------------------------------------------------

/**
 * How a claim is checked, by what made the damage:
 * - `gun`: a round from a gun in the weapon table. Needs a shot; a straight shot is tested for sight.
 * - `melee`: a blade or a club. Needs a swing (a shot); no sight test, short reach.
 * - `blast`: an explosion's splash. No shot, no sight line: grenades go round corners.
 * - `callin`: a strike, an aircraft, a sentry, the mech. No shot; its instakills need a call-in announced.
 * - `perk`: a perk or implant doing damage by itself (Chain Storm, Chain Reaction, Skyfall).
 * - `mounted`: a gun the player sits at. No shot; fired from the gun, not the body.
 * - `body`: the player's own body (ground slam, a parried round, gibs thrown).
 * - `world`: something standing in the world (a mine, a mortar, a barrel) that the guest's game saw go off.
 * - `other`: anything else. Never refused for being unknown.
 */
export type ClaimClass = 'gun' | 'melee' | 'blast' | 'callin' | 'perk' | 'mounted' | 'body' | 'world' | 'other';

const CALLIN_SOURCE = /^(airstrike|warthog|chopper|door_gun|gunship|orbital|ac130|black_sun|nuke|sentry|drop_pod|frame|mech|harrow_|attack|manpads)/;
const PERK_SOURCE = /^(chain|skyfall|frost|rigged|deadman|vampire|overdrive)/;
const MOUNTED_SOURCE = /^(emplacement|mounted|turret)/;
const BODY_SOURCE = /^(slam|sword_deflect|gib|kick|stomp)/;
const WORLD_SOURCE = /^(mortar|mine|tripwire|claymore|barrel|hazard_|vehicle_blast|wreck)/;

export function claimClass(source: string, type: string): ClaimClass {
  if (CALLIN_SOURCE.test(source)) return 'callin';
  if (PERK_SOURCE.test(source)) return 'perk';
  if (MOUNTED_SOURCE.test(source)) return 'mounted';
  if (BODY_SOURCE.test(source)) return 'body';
  if (WORLD_SOURCE.test(source)) return 'world';
  // A blade's wave is a blast of its own; every other swing is the blade.
  if (type !== 'explosive' && (isMelee(source) || /^sword/.test(source))) return 'melee';
  if (type === 'explosive') return 'blast';
  return Object.hasOwn(WEAPONS, source) ? 'gun' : 'other';
}

/** Damage from a call-in, a sentry or a drop pod: what the guest called in hit, not what their gun did. Kept for older callers. */
export const ASSIST_CLAIM = CALLIN_SOURCE;
/** The older three-way split, kept for callers that only ask "is this a gun's shot". */
export const claimKind = (source: string, type: string): 'shot' | 'blast' | 'assist' => {
  const kind = claimClass(source, type);
  return kind === 'gun' || kind === 'melee' ? 'shot' : kind === 'blast' ? 'blast' : 'assist';
};

// ---------------------------------------------------------------------------------------------
// What each gun can really do
// ---------------------------------------------------------------------------------------------

/** What a gun can do at its most, over every mod it takes: the guard's numbers come from the weapon table, not a guess. */
export interface GunLimits {
  /** Seconds between two shots at its fastest, before perks: the row's interval, a fitted rate mod, the smart aim, the fan, akimbo, Gun Kata. */
  fastest: number;
  /** The most one round does before perks. */
  damage: number;
  /** The most pellets one pull throws before perks (every barrel together). */
  pellets: number;
  /** Its rounds pass walls without an AP load: no sight test at all. */
  pierces: boolean;
  /** Its round is a kill whatever it touches (the autocannon's shell). */
  instakill: boolean;
}

/** All perks' fire rate together is capped at 2 (implants.ts `CAPS`); with implants off it is 3 x 1.5 x Geneva's 1.6 = 7.2. Room for all of it. */
export const RATE_ROOM = 8;
/** All perks' damage together is capped at 6; far more with implants off. A claim over this many times the gun's round is cut. */
export const DAMAGE_ROOM = 64;
/** Combat's instakill number (an `instakill` blast) and the nuke's front: what the host applies for a kill it recognises. */
export const INSTAKILL = 99999, NUKE = 999999;

const limits = new Map<string, GunLimits>();

/** A gun's limits, worked out once from its row and every mod's row. Melee weapons too: their swing is their shot. */
export function limitsOf(weapon: string): GunLimits | null {
  const known = limits.get(weapon);
  if (known) return known;
  if (!Object.hasOwn(WEAPONS, weapon)) return null;
  const id = weapon as WeaponId;
  const mine = MOD_ORDER.filter(mod => MODS[mod].weapon === id);
  const rows: WeaponDef[] = [WEAPONS[id], ...mine.map(mod => moddedDef(id, new Set<ModId>([mod]))), moddedDef(id, new Set<ModId>(mine))];
  let fastest = Infinity, damage = 0, pellets = 1, pierces = id === 'lance', instakill = false, akimbo = id === 'smg';
  for (const row of rows) {
    fastest = Math.min(fastest, row.interval, row.smart?.interval ?? Infinity, row.altFan?.gap ?? Infinity);
    damage = Math.max(damage, row.damage);
    pellets = Math.max(pellets, row.pellets * (row.altBoth ? row.magSize : 1));
    // AP and API rounds are known from the claim's `load`; this is the gun going through walls on its own.
    if (row.penetration > 0 && row.load !== 'ap' && row.load !== 'api') pierces = true;
    if (row.damage >= INSTAKILL) instakill = true;
    if (row.akimbo) akimbo = true;
  }
  if (isMelee(id)) fastest /= ENERGY.speed;
  // Two guns fire in turn at twice the rate, and Gun Kata fires them faster still for its burst.
  if (akimbo) fastest = Math.min(fastest / 2, KATA.step);
  const result = { fastest: Math.max(0.004, fastest), damage, pellets, pierces, instakill };
  limits.set(weapon, result);
  return result;
}

/** The gun a claim's source stands for: a weapon id, or a blade's special (`sword_flurry`), which is the sword. */
const gunOf = (source: string): string => Object.hasOwn(WEAPONS, source) ? source : /^sword/.test(source) ? 'sword' : source;

// ---------------------------------------------------------------------------------------------
// Buckets
// ---------------------------------------------------------------------------------------------

interface Bucket { tokens: number; at: number }

/** Takes one token if there is one. `rate` a second, `burst` at most, on the clock `now` (ms). A clock that jumps back starts over. */
function take(bucket: Bucket, now: number, rate: number, burst: number): boolean {
  if (now < bucket.at - 5000) bucket.at = now;
  if (now > bucket.at) {
    bucket.tokens = Math.min(burst, bucket.tokens + (now - bucket.at) / 1000 * rate);
    bucket.at = now;
  }
  if (bucket.tokens < 1) return false;
  bucket.tokens--;
  return true;
}

/** Hits a second, and at once, for damage that has no shot: a nuke's worth and an AC-130's, not a flood. */
const HITS: Readonly<Record<Exclude<ClaimClass, 'gun' | 'melee'>, readonly [rate: number, burst: number]>> = {
  blast: [400, 800], callin: [600, 1200], perk: [200, 400], mounted: [200, 400], body: [100, 200], world: [200, 400], other: [200, 400],
};
/** The most a claim of each kind may carry; over it, it is cut to this. A gun's own cap is its round times `DAMAGE_ROOM`. */
const CAPS: Readonly<Record<ClaimClass, number>> = {
  gun: 2000, melee: 20000, blast: 20000, callin: 20000, perk: 20000, mounted: 4000, body: 20000, world: 20000, other: 20000,
};
/** Metres from the eye to the target, at most. Combat's own bullet range is 800; a call-in or a perk works anywhere on the map. */
const RANGE: Readonly<Record<ClaimClass, number>> = {
  gun: 850, melee: 60, blast: 850, callin: 2000, perk: 2000, mounted: 850, body: 120, world: 2000, other: 850,
};
/** How long after calling one in a guest's call-in may still land its instakills (the AC-130 circles, a nuke takes its time). */
const CALLIN_WINDOW_MS = 600_000;
/** The call-ins whose hit is a kill whatever it touches, by source, with the blast kind (the nuke's: its damage type) it comes as. */
const CALLIN_KILLS: Readonly<Record<string, string>> = { airstrike: 'hellfire', black_sun: 'finisher', nuke: 'true', ac130_bomb: 'finisher' };
/** How far the shooter's clock may run ahead of where it stood when first heard, in ms: the lag of that first message, and drift. */
const CLOCK_SLACK_MS = 4000;
/** Shots remembered per guest: a round in flight lands seconds after its shot, and several guns' shots overlap. */
const SHOTS_KEPT = 256;
/** Nearer than this the sight test is skipped: a fight round a corner at arm's length is never absurd. */
const CLOSE = 6;
/** Hits refused for sight that pass anyway: this many at once, one more a second. Honest odd cases, not a wall hack. */
const DOUBT: readonly [rate: number, burst: number] = [1, 8];

const TYPES = ['bullet', 'pellet', 'explosive', 'slash', 'melee', 'fire', 'shock', 'crush', 'true'];
const LOADS = ['ap', 'hp', 'plusP', 'flechette', 'api'];
const ARMOURS = ['light', 'medium', 'heavy'];

/** What the host knows about the two ends of a claim when it arrives. */
export interface ClaimScene {
  /** The host's copy of the shooter's eye: a little old, so only a bound on where the claim may say it was. */
  eye: Vec;
  /** The enemy's centre on the host, now. */
  target: Vec;
  /** The enemy's size: metres from its centre to its furthest part (a Titan is not a trooper). */
  size?: number;
  /** How fast the enemy is moving on the host, m/s: where the guest saw it is behind by the link's delay. */
  speed?: number;
  /**
   * Metres from a point to the nearest place the enemy has been on the host in the last few seconds, or stands as a guest
   * draws him. A man thrown across the room by the last shot is still where he stood on the shooter's screen when the next lands.
   */
  near?: (point: Vec) => number;
  /** The shooter's round trip to the host, ms, if measured. */
  ping?: number;
  /** The shooter is down or dead: only what was already in flight or stands by itself still counts. */
  down?: boolean;
  /** Nothing of the world between the two points (the last metre before `to` is not looked at). */
  visible: (from: Vec, to: Vec) => boolean;
}

export type Verdict = { ok: true; kind: ClaimClass } | { ok: false; why: RejectReason };
/**
 * Why a claim was refused: `shape` (not a claim at all), `down` (the shooter is down), `eye` (fired from where the shooter is
 * not), `range`, `point` (the hit is nowhere near the enemy), `rate` (more shots than the gun can fire), `hits` (more hits than a
 * shot can land), `flood`, `sight` (a wall, after every second look).
 */
export type RejectReason = 'shape' | 'down' | 'eye' | 'range' | 'point' | 'rate' | 'hits' | 'flood' | 'sight';

interface Peer {
  /** The shooter's clock minus the host's when first heard, ms. */
  anchor: number | null;
  buckets: Map<string, Bucket>;
  /** Shots let in lately, by gun and shot id, with the hits counted against each. */
  shots: Map<string, number>;
  order: string[];
  called: number;
}

export class ClaimValidator {
  private readonly peers = new Map<string, Peer>();
  /** Every refusal by reason, since the match began: the proofs and the cost meter read it. */
  readonly refused: Partial<Record<RejectReason, number>> = {};
  /** Claims cut to their cap, and sight tests passed on the allowance: honest play keeps both near zero. */
  clamped = 0;
  doubted = 0;
  /** Why the last refusal was one, for a caller whose answer is only yes or no (`status`, `vehicle`). */
  last: RejectReason | null = null;

  private peer(id: string): Peer {
    let peer = this.peers.get(id);
    if (!peer) this.peers.set(id, peer = { anchor: null, buckets: new Map(), shots: new Map(), order: [], called: -Infinity });
    return peer;
  }

  private bucket(peer: Peer, key: string, burst: number): Bucket {
    let bucket = peer.buckets.get(key);
    if (!bucket) peer.buckets.set(key, bucket = { tokens: burst, at: -Infinity });
    return bucket;
  }

  /** The shooter's clock for this claim, held to what the host's own clock allows: it may lag as it likes, never run ahead. */
  private clock(peer: Peer, at: unknown, now: number): number {
    if (typeof at !== 'number' || !Number.isFinite(at)) return now;
    // A reloaded page starts its clock again: follow it.
    if (peer.anchor === null || at - now < peer.anchor - 10_000) peer.anchor = at - now;
    return Math.min(at, now + peer.anchor + CLOCK_SLACK_MS);
  }

  /** The guest announced a call-in (`callin:used` on their side), or a mission put them on a ride. */
  callIn(peer: string, now: number): void { this.peer(peer).called = now; }

  /** The guest's Gun Kata began. Its burst is inside every akimbo gun's limits already (`limitsOf`), so this only says yes. */
  kata(_peer: string, _now: number): boolean { return true; }

  /**
   * A guest's shot for the others to see and hear (remoteFire.ts): let through unless it is a flood. Hits no longer wait on
   * it: a claim carries its own shot. `now` is the host's clock; the bucket's burst covers shots that arrive together.
   */
  acceptFire(peer: string, shot: number, weapon: string, now: number, _akimbo = false): boolean {
    const gun = limitsOf(weapon);
    if (!Number.isSafeInteger(shot) || shot < 0 || !gun) return false;
    const rate = RATE_ROOM / gun.fastest;
    const burst = Math.max(12, Math.ceil(rate * 1.5));
    return take(this.bucket(this.peer(peer), `fire:${weapon}`, burst), now, rate, burst);
  }

  /**
   * A guest's claim, checked. On a yes, `claim.damage.amount` may have been cut to its cap or set to the kill it stands for:
   * apply it as it now reads.
   */
  check(id: string, value: unknown, now: number, scene: ClaimScene): Verdict {
    const claim = value as HitClaim | null;
    if (!this.shaped(claim)) return this.no('shape');
    const peer = this.peer(id);
    const damage = claim.damage;
    const kind = claimClass(damage.source, damage.type);
    const gun = kind === 'gun' || kind === 'melee' ? limitsOf(gunOf(damage.source)) : null;
    const own = kind === 'gun' || kind === 'melee' || kind === 'body' || kind === 'mounted';
    if (scene.down && own) return this.no('down');

    // Where it was fired from, how far, and whether the hit is on or beside the enemy, as far as two machines can agree.
    const ping = Math.min(1500, scene.ping ?? 250);
    if (own && distance(claim.origin, scene.eye) > (kind === 'mounted' ? 80 : 7 + 26 * (0.35 + ping / 1000))) return this.no('eye');
    if (distance(claim.origin, scene.target) > RANGE[kind]) return this.no('range');
    const slack = 10 + (scene.size ?? 2) + (scene.speed ?? 0) * (0.35 + ping / 1000);
    const area = kind === 'blast' || kind === 'callin' || kind === 'perk' || kind === 'world';
    if (!area && distance(damage.point, scene.target) > slack && fromSegment(scene.target, claim.origin, damage.point) > slack
      && (scene.near?.(damage.point) ?? Infinity) > slack) return this.no('point');

    // How much. Over the cap it is cut, unless it is a kill the weapon really has.
    const cap = gun ? gun.instakill ? INSTAKILL : Math.max(CAPS[kind], gun.damage * DAMAGE_ROOM) : CAPS[kind];
    if (damage.amount > cap) {
      const kill = this.instakill(peer, damage, kind, now);
      if (kill === undefined) this.clamped++;
      damage.amount = kill ?? cap;
    }

    // How often.
    const at = this.clock(peer, claim.at, now);
    if (gun) {
      const key = `${gunOf(damage.source)}#${claim.shot}`;
      let hits = peer.shots.get(key);
      if (hits === undefined) {
        const rate = RATE_ROOM / gun.fastest;
        const burst = Math.max(12, Math.ceil(rate * 1.5));
        if (!take(this.bucket(peer, `shot:${gunOf(damage.source)}`, burst), at, rate, burst)) return this.no('rate');
        hits = 0;
        peer.order.push(key);
        if (peer.order.length > SHOTS_KEPT) peer.shots.delete(peer.order.shift()!);
      }
      if (hits >= Math.max(256, gun.pellets * 64)) return this.no('hits');
      peer.shots.set(key, hits + 1);
    } else {
      const [rate, burst] = HITS[kind as keyof typeof HITS];
      if (!take(this.bucket(peer, `hits:${kind}`, burst), at, rate, burst)) return this.no('flood');
    }

    // Sight: a straight shot from a gun that cannot pass walls. Everything else has no line to test.
    if ((kind === 'gun' || kind === 'mounted' || kind === 'other') && claim.hop !== 1 && !gun?.pierces
      && damage.load !== 'ap' && damage.load !== 'api' && damage.type !== 'fire' && distance(claim.origin, damage.point) > CLOSE
      && !this.sees(claim, scene)) {
      if (!take(this.bucket(peer, 'doubt', DOUBT[1]), now, DOUBT[0], DOUBT[1])) return this.no('sight');
      this.doubted++;
    }
    return { ok: true, kind };
  }

  /** From the claim's eye to its hit point; failing that, from the host's copy of the eye, and to the enemy as the host has it. */
  private sees(claim: HitClaim, scene: ClaimScene): boolean {
    const head: Vec = [scene.target[0], scene.target[1] + 0.6, scene.target[2]];
    return scene.visible(claim.origin, claim.damage.point) || scene.visible(scene.eye, claim.damage.point)
      || scene.visible(claim.origin, scene.target) || scene.visible(claim.origin, head) || scene.visible(scene.eye, head);
  }

  private shaped(claim: HitClaim | null): claim is HitClaim {
    if (!claim || claim.t !== 'hit' || !Number.isSafeInteger(claim.target) || claim.target <= 0 || !Number.isSafeInteger(claim.shot) || claim.shot < 0) return false;
    const damage = claim.damage;
    if (!damage || typeof damage.source !== 'string' || damage.source.length > 64 || typeof damage.type !== 'string' || !TYPES.includes(damage.type)) return false;
    if (!validVec(claim.origin) || !validVec(damage.point) || !validVec(damage.dir)
      || !Number.isFinite(damage.amount) || damage.amount <= 0
      || !Number.isFinite(damage.force) || damage.force < 0 || damage.force > 100000
      || (damage.region !== undefined && !REGIONS.includes(damage.region))
      || (damage.load !== undefined && !LOADS.includes(damage.load))
      || (damage.armour !== undefined && !ARMOURS.includes(damage.armour))
      || (damage.bone !== undefined && (!Number.isInteger(damage.bone) || damage.bone < 0 || damage.bone > 255))
      || (damage.slicePlaneNormal !== undefined && !validVec(damage.slicePlaneNormal))) return false;
    for (const scalar of [damage.headshotMult, damage.severMult, damage.reach]) if (scalar !== undefined && (!Number.isFinite(scalar) || scalar < 0 || scalar > 1000)) return false;
    return true;
  }

  /**
   * The number a claim over its cap may stand for, or undefined (then it is cut to the cap). A gun's instakill blast is known
   * by the gun's own row: the HE shell of a gun whose round is an instakill (the autocannon), or a Hellfire rocket off a
   * launcher. A call-in's kill needs a call-in announced lately.
   */
  private instakill(peer: Peer, damage: HitClaim['damage'], kind: ClaimClass, now: number): number | undefined {
    if (kind === 'callin') {
      if (now - peer.called > CALLIN_WINDOW_MS) return undefined;
      if (!Object.hasOwn(CALLIN_KILLS, damage.source) || CALLIN_KILLS[damage.source] !== (damage.blastKind ?? damage.type)) return undefined;
      return damage.source === 'nuke' ? NUKE : INSTAKILL;
    }
    if (kind !== 'blast' || !Object.hasOwn(WEAPONS, damage.source)) return undefined;
    const gun = WEAPONS[damage.source as WeaponId];
    const hits = gun.round === 'shell' ? gun.damage >= INSTAKILL && damage.blastKind === 'shell' : gun.round === 'rocket' && damage.blastKind === 'hellfire';
    return hits ? INSTAKILL : undefined;
  }

  /** A guest's fire, frost or stuck bolt on an enemy: the seconds it may last, cut to what the game's own effects give, or null. */
  status(id: string, value: unknown, now: number): number | null {
    const claim = value as StatusClaim | null;
    if (!claim || claim.t !== 'status' || !Number.isSafeInteger(claim.uid) || claim.uid <= 0 || !Object.hasOwn(STATUS_SECONDS, claim.kind)
      || !Number.isFinite(claim.s) || claim.s <= 0) { this.no('shape'); return null; }
    const peer = this.peer(id);
    if (!take(this.bucket(peer, 'hits:status', 800), this.clock(peer, claim.at, now), 400, 800)) { this.no('flood'); return null; }
    return Math.min(claim.s, STATUS_SECONDS[claim.kind]);
  }

  /** A guest's round or blast on one of the host's vehicles: true if it may be applied (`claim.amount` cut to its cap). */
  vehicle(id: string, value: unknown, now: number): boolean {
    const claim = value as VehicleClaim | null;
    if (!claim || claim.t !== 'vhit' || !Number.isSafeInteger(claim.id) || claim.id <= 0 || !validVec(claim.point)
      || typeof claim.source !== 'string' || claim.source.length > 64 || !Number.isFinite(claim.amount) || claim.amount <= 0
      || (claim.part !== undefined && (typeof claim.part !== 'string' || claim.part.length > 16))
      || (claim.kind !== undefined && (typeof claim.kind !== 'string' || claim.kind.length > 24))
      || (claim.radius !== undefined && (!Number.isFinite(claim.radius) || claim.radius <= 0 || claim.radius > 200))) { this.no('shape'); return false; }
    const peer = this.peer(id);
    if (!take(this.bucket(peer, 'hits:vehicle', 600), this.clock(peer, claim.at, now), 300, 600)) { this.no('flood'); return false; }
    if (claim.amount > INSTAKILL) claim.amount = INSTAKILL;
    return true;
  }

  private no(why: RejectReason): Verdict {
    this.refused[why] = (this.refused[why] ?? 0) + 1;
    this.last = why;
    return { ok: false, why };
  }

  forget(peer: string): void { this.peers.delete(peer); }
}

/** The longest each status a guest may claim can last: the game's own longest (napalm's coat, Frost Nova, a bolt's fuse) with room. */
export const STATUS_SECONDS: Readonly<Record<StatusClaim['kind'], number>> = { burn: 30, freeze: 20, bolt: 12 };

/** Metres from `point` to the segment `a`-`b`: a beam's hit is named at its far end, and the enemy stands somewhere along it. */
function fromSegment(point: readonly number[], a: readonly number[], b: readonly number[]): number {
  const ab = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!], ap = [point[0]! - a[0]!, point[1]! - a[1]!, point[2]! - a[2]!];
  const length = ab[0]! * ab[0]! + ab[1]! * ab[1]! + ab[2]! * ab[2]!;
  const t = length > 1e-9 ? Math.max(0, Math.min(1, (ap[0]! * ab[0]! + ap[1]! * ab[1]! + ap[2]! * ab[2]!) / length)) : 0;
  return Math.hypot(ap[0]! - ab[0]! * t, ap[1]! - ab[1]! * t, ap[2]! - ab[2]! * t);
}
