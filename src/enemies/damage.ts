/**
 * The damage model: the only code that takes health off an enemy, and the only code that kills one.
 *
 * Order of a hit: ward, riot shield, tank, region multiplier, armour plate, boss filter, health, wounds, limb pool.
 * Everything a kill should do happens in `kill`, once, so the first game's seven drifting kill paths cannot return.
 *
 * A body with anatomy (FACTIONS, src/contracts/data.ts) does not simply die when its health is gone. `WoundSystem.take` says
 * whether this hit is the end of him. Bodies without it never reach that line, which is what keeps the swarm as it was.
 */
import * as THREE from 'three';
import { DroneBone, HumanoidBone as B, type GoreRegion } from '../characters/rig';
import { DEFAULT_FORCE, type DamageInfo, type DamageType } from '../core/contracts';
import { DevFlags } from '../core/devflags';
import type { DamageResult, KillEvent } from '../core/gameplay';
import { chance, clamp, lerp, pick, rand } from '../core/math';
import { FACTIONS, type FactionRules } from '../contracts/data';
import { ACTIVE } from '../contracts/select';
import { KNOCK_PASS, MASS_PASS, WEIGHT_PASS } from '../gore/muscles';
import { STRUGGLE_PASS } from '../gore/reflex';
import { bursts, HEAVY_ROUND } from './wounds/rules';
import { BLAST, OUTCOME_COUNT, OUTCOMES, rollBlast, tearsWaist, type BlastBody, type BlastRoll, type OutcomeRule } from './blast';
import { CHECK_CARRY, CHECK_MIN, CHECK_TOPPLE_MAX, CHECK_TOPPLE_MIN, checkStrength, SLIDE_KICK, SLIDE_TOPPLE } from './contact';
import { ENEMIES, LIMB_SIZE, REGION_DAMAGE } from './data';
import { WEAPONS, type ArmourClass } from '../weapons/data';
import type { WeaponId } from '../core/gameplay';
import { say } from './attacks';
import { finishAttack } from './brain';
import { chooseReaction, mustFall, profileOf, type ReactionProfile } from './reactions';
import { dropOff } from './roles';
import type { Enemy } from './Enemy';
import type { Plate } from './armor';
import type { AiWorld } from './aiWorld';
import type { EnemyManager } from './EnemyManager';

/** Metres per second of knockback on the living, per newton-second per point of health, and the most one hit gives. */
const SHOVE_GAIN = 1.35;
const SHOVE_MAX = 4;
/** Seconds a stagger lasts, at no strength and at full. */
const STAGGER_MIN = 0.45;
const STAGGER_MAX = 1.05;
/** Seconds of failing to catch itself before a fall, least and most. */
const FALL_LEAD_MIN = 0.16;
const FALL_LEAD_MAX = 0.42;
/** What full strength adds to a catch step. */
const REEL_GAIN = 1.4;
/** Metres per second tipping the upper body over the feet, at no strength and at full. Less is a body that folds up. */
const TOPPLE_MIN = 1.2;
const TOPPLE_MAX = 2.2;
/** Share of a body's shock left after each kind of reaction, so one burst does not fell it twice. */
const SHOCK_AFTER_STAGGER = 0.5;
/** Knocked cold by a head hit, it lies this much longer, and gets up dazed for its whole `daze`. */
const KNOCKOUT_LIE = 1.5;
/**
 * Share of the get-up clip a body with all four limbs pushes itself through on the floor first (gore's struggle, `reflex.ts`),
 * which the clip then does not have to: the mean of the two frames it pushes for, 0.24 face down and 0.3 face up.
 */
const RISE_PUSHED = 0.27;

/** How a knockdown goes over, where the default from its direction and strength will not do. */
interface Knock {
  /** m/s on the upper body. Left out, along the hit by its strength. Null, none: it drops from the pose it is in. */
  topple?: THREE.Vector3 | null;
  /** How hard the limbs are thrown, along the knockdown's direction. Left out, by its strength. */
  impact?: number;
  /** Knocked cold by a head hit (`KnockdownOptions.knockout`), at `point`. */
  knockout?: boolean;
  point?: THREE.Vector3;
}
/** Weapons light enough that a body takes a moment to die of them, on its feet. Anything harder drops it. */
const DIES_ON_FEET: ReadonlySet<DamageType> = new Set<DamageType>(['bullet', 'fire', 'shock', 'true']);
const DIES_ON_FEET_FORCE = 30;
const COLLAPSE_MIN = 0.85;
const COLLAPSE_MAX = 1.4;
/** A man who bled out on his feet takes longer about it than one who was shot dead on them. */
const BLEED_COLLAPSE_MIN = 1.6;
const BLEED_COLLAPSE_MAX = 2.6;
/** How hard a body with anatomy twitches after a death that took it all at once, and one that came as a relief. */
const SUDDEN_TWITCH = 1;
const SLOW_TWITCH = 0.45;
/** A lethal headshot drops him like a sack, and he lies still. A sudden death's twitch with `?weight=0`. */
const HEADSHOT_TWITCH = WEIGHT_PASS ? 0 : SUDDEN_TWITCH;
/**
 * The living flinch, from the share of health a hit took: `base + share * gain`, at most `max`. The animator already sizes
 * it by build (`HumanoidAnimator.flinch`), so mass is not counted again here. As it was before, with `?mass=0`, an SMG round
 * rocked a Trooper's chest 0.26 rad and the springs under it rang past rest by a seventh of that. A machine (a drone, a
 * skitter) keeps the old size: its animator sizes nothing by build and its tilt spring was not made to settle, so the
 * smaller one would only be a smaller reaction.
 */
const FLINCH = MASS_PASS ? { base: 0.2, gain: 2.2, max: 1.4 } : { base: 0.35, gain: 3, max: 1.6 };
const MACHINE_FLINCH = { base: 0.35, gain: 3, max: 1.6 };
export const flinchSize = (share: number, machine = false): number => {
  const f = machine ? MACHINE_FLINCH : FLINCH;
  return clamp(f.base + share * f.gain, f.base, f.max);
};
/**
 * Most of its stagger and knockback a body keeps when it dies, in m/s. The living shed both within a second; a corpse
 * slides on with whatever it is given. Kept whole, a stagger from the round before made an SMG kill at 8 m land twice as
 * far, and the pellets of one shot added up to 10 m/s (that part is `unmoved` now). At 0.6, above
 * `MuscleTuning.stumbleOnward`, a body killed mid-stagger still stumbles on the way it was going, and an SMG kill at 8 m
 * lands about 0.3 m further than with none (`lab.md`).
 */
const DEATH_CARRY = 0.6;

/** How hard each damage type works a limb pool, on top of the weapon's severMult. */
const SEVER_FACTOR: Record<DamageType, number> = {
  bullet: 1, pellet: 1.2, explosive: 0.7, melee: 0.8, slash: 2.4, fire: 0, shock: 0, crush: 1, true: 0,
};

/** Damage types that ignore where they land. */
const AREA_TYPES: ReadonlySet<DamageType> = new Set<DamageType>(['explosive', 'fire', 'shock', 'crush', 'true']);

/** Limbs that can come off, for blasts that have no struck region. */
const BLAST_LIMBS: readonly GoreRegion[] = ['armL', 'armR', 'legL', 'legR', 'forearmL', 'forearmR', 'shinL', 'shinR'];
const BLAST_ARMS: readonly GoreRegion[] = ['armL', 'armR', 'forearmL', 'forearmR'];
const BLAST_LEGS: readonly GoreRegion[] = ['legL', 'legR', 'shinL', 'shinR'];
/** How far round the body a second opening goes, for a blast that opened it up. */
const FLESH_TURN = 1.1;

const REGION_BONE: Record<GoreRegion, number> = {
  head: B.head, chest: B.chest, abdomen: B.spine,
  armL: B.upperArmL, forearmL: B.foreArmL, armR: B.upperArmR, forearmR: B.foreArmR,
  legL: B.thighL, shinL: B.shinL, legR: B.thighR, shinR: B.shinR,
};

const WHOLE_LIMB: Partial<Record<GoreRegion, GoreRegion>> = { forearmL: 'armL', forearmR: 'armR', shinL: 'legL', shinR: 'legR' };

/** Gore bursts the head at this much damage. Below it the head pops off whole, and a man keeps his. */
const HEAD_BURST_DAMAGE = 40;
const RESULT_RING = 16;
/** Seconds between cries of pain. Under an SMG every hit would otherwise be one. */
const PAIN_GAP = 0.7;
const BOSS_PAIN_GAP = 6;
/** A tank the player did not set off, as a share of a full blast. */
export const STRAY_TANK_DAMAGE = 0.17;
/** The Piledriver shreds armour: a plate takes its rounds at this many times their worth. */
export const PILEDRIVER_SHRED = 2;
/** A light round wears a plate by this share of its own damage: an SMG round takes about half of a trooper's helmet. */
export const LIGHT_WEAR = 0.5;

/** A gun's own class, else light under HEAVY_ROUND damage and heavy at or over it (melee, call-in guns, sentinels). */
export function classOf(source: string, round: number): ArmourClass {
  const def = Object.hasOwn(WEAPONS, source) ? WEAPONS[source as WeaponId] : null;
  return def?.armour ?? (round >= HEAVY_ROUND ? 'heavy' : 'light');
}

/**
 * One round on one plate. `round` is the round's own damage, `amount` what it would do where it struck. Light is stopped
 * and wears the plate by half the round; medium is stopped but wrecks the plate; heavy wears it by the round (twice for
 * a shredder) and half of what it would have done gets through either way.
 */
export function armourHit(cls: ArmourClass, plateHp: number, round: number, amount: number, shred = 1): { wear: number; through: number } {
  if (cls === 'medium') return { wear: plateHp, through: 0 };
  if (cls === 'light') return { wear: round * LIGHT_WEAR, through: 0 };
  return { wear: round * shred, through: amount * 0.5 };
}
export const STRAY_TANK_RADIUS = 0.8;
/** Share of a shot tank's blast that reaches the player who shot it. Too close is a mistake, not a death sentence. */
const TANK_SELF_DAMAGE = 0.35;
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _dying = new THREE.Vector3();
const _check = new THREE.Vector3();
const _checkTopple = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

const _knock: Knock = {};
/** The one `Knock` every caller fills, all of it each time. */
function knockAs(topple: THREE.Vector3 | null | undefined, impact: number | undefined, knockout: boolean, point: THREE.Vector3 | undefined): Knock {
  _knock.topple = topple;
  _knock.impact = impact;
  _knock.knockout = knockout;
  _knock.point = point;
  return _knock;
}

/**
 * How fast a body was really going when it died: its stride, the reel it was in and the knockback it was taking, and in the
 * air, how fast it was falling. Movement steps by all three on the ground, so a body killed mid-stagger keeps going the way
 * it was, up to `DEATH_CARRY`. What hits at world time `now` added, it has not stepped with yet, and does not keep. In the
 * air only the stride moves it. With `?weight=0`, the stride alone, as before the weight pass.
 */
export function deathVelocity(e: Enemy, out: THREE.Vector3, now = Number.NaN): THREE.Vector3 {
  if (!WEIGHT_PASS) return out.copy(e.velocity);
  out.set(e.velocity.x, e.airborne ? e.verticalSpeed : e.velocity.y, e.velocity.z);
  if (e.airborne) return out;
  let x = e.reel.x + e.push.x;
  let z = e.reel.z + e.push.z;
  if (e.unmovedAt === now) {
    const ux = x - e.unmoved.x;
    const uz = z - e.unmoved.z;
    // A knockdown or a trip since may have cleared or turned it: then nothing it stepped with is left.
    if (ux * x + uz * z > 0) {
      x = ux;
      z = uz;
    } else x = z = 0;
  }
  const k = Math.min(1, DEATH_CARRY / Math.max(Math.hypot(x, z), 1e-6));
  out.x += x * k;
  out.z += z * k;
  return out;
}

/**
 * Both arms and both legs there to push itself up with, none of them broken at the shoulder, elbow, hip or knee: what gore's
 * struggle asks (`Reflex.canPush`), or a body that gathers for the whole clip would play it in the pushed one's time.
 */
function pushesUp(e: Enemy): boolean {
  const s = e.char.severed;
  if (s.has('armL') || s.has('armR') || s.has('forearmL') || s.has('forearmR') || s.has('legL') || s.has('legR') || s.has('shinL') || s.has('shinR')) return false;
  const c = e.char;
  return !c.isFractured(B.upperArmL) && !c.isFractured(B.foreArmL) && !c.isFractured(B.upperArmR) && !c.isFractured(B.foreArmR)
    && !c.isFractured(B.thighL) && !c.isFractured(B.shinL) && !c.isFractured(B.thighR) && !c.isFractured(B.shinR);
}

/** Reel or knockback a hit adds at world time `now`, which the body has not stepped with until its next frame. */
function unmoved(e: Enemy, now: number, x: number, z: number): void {
  if (e.unmovedAt !== now) {
    e.unmovedAt = now;
    e.unmoved.set(0, 0, 0);
  }
  e.unmoved.x += x;
  e.unmoved.z += z;
}

function newResult(): DamageResult {
  return { dealt: 0, killed: false, headshot: false, severed: [], blocked: false };
}

export class DamageModel {
  private readonly results: DamageResult[] = Array.from({ length: RESULT_RING }, newResult);
  private head = 0;
  private readonly blastBody: BlastBody = { health: 0, maxHealth: 0, machine: false, fireproof: false };
  private readonly blastRoll: BlastRoll = { outcome: 'thrown', amount: 0, fatal: false };
  /** What has come up so far in the blast `seenIn`, so that one crowd does not all go the same way. */
  private readonly seen = new Uint8Array(OUTCOME_COUNT);
  private seenIn = -1;
  /** Pellets of the blast on this frame that have met each plate, so a blast's pellets are counted together. */
  private readonly volley = new Map<Plate, number>();
  private volleyAt = -1;
  /** Limbs the blast `seenIn` has taken so far. */
  private cuts = 0;
  private readonly seam: DamageInfo = { amount: 0, type: 'explosive', point: new THREE.Vector3(), dir: new THREE.Vector3(), force: 0, source: '' };

  constructor(private readonly w: AiWorld, private readonly m: EnemyManager) {}

  /** What can break this body. A husk on the Outpost is still a husk. */
  private rules(e: Enemy): FactionRules {
    return this.m.outpost?.wounds.bodyOf(e) ? FACTIONS[ACTIVE.def.faction] : FACTIONS.swarm;
  }

  private result(): DamageResult {
    const r = this.results[this.head]!;
    this.head = (this.head + 1) % RESULT_RING;
    r.dealt = 0;
    r.killed = r.headshot = r.blocked = false;
    r.armour = undefined;
    r.severed.length = 0;
    return r;
  }

  apply(e: Enemy, d: DamageInfo): DamageResult {
    const res = this.result();
    if (!e.alive) return res;

    if (e.entrance === 'boss') return this.blocked(e, d, res);

    const area = AREA_TYPES.has(d.type);
    if (e.ward > 0 && d.type !== 'true' && d.type !== 'fire') {
      this.hitWard(e, d, res);
      return res;
    }
    if (e.shield && this.shieldStops(e, d, res)) return res;

    let region: GoreRegion = d.region ?? 'chest';
    if (e.def.wholeLimbs) region = WHOLE_LIMB[region] ?? region;

    if (e.def.tank && !e.tankBlown && this.tankStruck(e, d, region)) {
      this.blowTank(e, d);
      // The tank going up is the kill. Fall through with enough damage to finish it.
      return this.lethal(e, d, res, region, false);
    }

    const wounds = this.m.outpost?.wounds ?? null;
    const body = wounds?.bodyOf(e) ?? null;
    const placed = body ? wounds!.read(e, d, region) : null;
    const headMul = d.headshotMult ?? REGION_DAMAGE.head;
    let amount = d.amount * (area ? 1 : region === 'head' ? headMul : REGION_DAMAGE[region]);
    const kneeling = body !== null && wounds!.kneeling(e);
    if (body) amount = wounds!.priced(placed, d, amount, region, kneeling);
    res.headshot = region === 'head' && !area && (placed === null || (placed.zone === 'head' && !placed.glancing));

    // A plate does nothing about a fire, or about blood that is already leaving.
    const reaches = (!body || d.type === 'explosive' || !area) && !kneeling;
    // A round that goes through armour takes the armour with it: the Sabot's dart deletes the piece it passes, a shaped
    // charge on the body strips every plate he wears (only the one it hit on a boss, so one rocket cannot skip his phases).
    if (reaches && d.pierces && e.armor > 0) this.tearOff(e, region, d, res);
    const plate = !reaches || d.pierces ? null : area ? this.blastPlate(e) : this.plateFor(e, region, d);
    if (plate) {
      const shred = d.source === 'piledriver' ? PILEDRIVER_SHRED : 1;
      // What the plate loses, and what of the round gets past it.
      let wear: number;
      let through: number;
      if (e.isBoss || area) {
        // Bosses keep the soak their phases were tuned on, and a blast chips whatever plate is left. What breaks through
        // only half lands; the rest went into tearing the plate off.
        const absorbed = Math.min(plate.hp / shred, amount);
        wear = absorbed * shred;
        through = (amount - absorbed) * 0.5;
      } else {
        // One rule in every mode, by the class of the round (docs/proposals/armour-and-headshots-plan.md, section 2).
        ({ wear, through } = armourHit(this.armourClass(plate, d), plate.hp, d.amount, amount, shred));
      }
      e.armor = Math.max(0, e.armor - Math.min(wear, plate.hp));
      plate.hp -= wear;
      const broken = plate.hp <= 0;
      if (broken) this.shootOff(e, plate, d);
      if (body) wounds!.onPlate(e, plate, d, region);
      res.armour = broken ? 'broken' : through <= 0 ? 'stopped' : 'through';
      if (through <= 0) {
        res.blocked = true;
        res.headshot = false;
        res.dealt = amount;
        this.react(e, d, region, amount, res);
        this.m.emitHit(e, d, res);
        return res;
      }
      amount = through;
    }

    if (e.frozen > 0 && amount >= 4) amount *= 3;
    if (e.boss) amount = e.boss.filter(e, this.w, amount, d, region);

    const blast = this.rolled(e, d, amount);
    if (blast) amount = blast.amount;

    e.health -= amount;
    // Before the death is picked, so a killing shot leaves its mark on the body too.
    if (this.w.ctx.gore.wound(e.char, d, blast?.outcome === 'flesh' ? 1 : amount / e.maxHealth)) this.updateMaim(e);
    res.dealt = amount;

    const headPool = region === 'head' ? this.spendPool(e, 'head', amount) : Infinity;
    const spent = e.health <= 0 || headPool <= 0;
    if (blast?.fatal || (body ? wounds!.take(e, body, placed, d, amount, spent) : spent)) return this.lethal(e, d, res, region, true, blast);

    if (blast) this.blastWound(e, d, res, blast);
    else if (area) this.blastLimb(e, d, res);
    else this.spendLimb(e, region, d, res);

    if (!e.alive) return res;
    this.react(e, d, region, amount, res, blast !== null && !OUTCOMES[blast.outcome].stands);
    this.m.emitHit(e, d, res);
    return res;
  }

  /** The ring this body stood in has its say, or null for anything but a blast's splash. Bosses only take the damage. */
  private rolled(e: Enemy, d: DamageInfo, amount: number): BlastRoll | null {
    if (d.reach === undefined || d.blastKind === undefined || e.isBoss) return null;
    if (d.explosionId !== this.seenIn) {
      this.seenIn = d.explosionId ?? -1;
      this.seen.fill(0);
      this.cuts = 0;
    }
    const body = this.blastBody;
    body.health = e.health;
    body.maxHealth = e.maxHealth;
    body.machine = e.def.machine === true;
    body.fireproof = e.def.fireproof === true;
    return rollBlast(body, d.blastKind, d.reach, amount, this.seen, this.blastRoll);
  }

  /** What the ring did to a body that lives. */
  private blastWound(e: Enemy, d: DamageInfo, res: DamageResult, blast: BlastRoll): void {
    const rule = OUTCOMES[blast.outcome];
    this.tear(e, d, res, rule);
    if (!e.alive) return;
    if (blast.outcome === 'flesh') this.open(e, d);
    if (rule.fire !== undefined) this.ignite(e, rule.fire);
    if (rule.stands) {
      e.char.anim.daze?.(BLAST.dazed);
      this.stagger(e, BLAST.dazed);
    }
  }

  /** Takes the limbs a roll asked for, skipping any already gone. */
  private tear(e: Enemy, d: DamageInfo, res: DamageResult | null, rule: OutcomeRule): void {
    if (!DevFlags.gibbing) return;
    if (rule.arms) this.takeLimbs(e, d, res, BLAST_ARMS, rule.arms);
    if (rule.legs) this.takeLimbs(e, d, res, BLAST_LEGS, rule.legs);
    if (rule.any) this.takeLimbs(e, d, res, BLAST_LIMBS, rule.any);
  }

  private takeLimbs(e: Enemy, d: DamageInfo, res: DamageResult | null, from: readonly GoreRegion[], count: number): void {
    const start = Math.floor(rand(0, from.length));
    for (let i = 0; i < from.length && count > 0 && this.cuts < BLAST.cuts; i++) {
      const region = from[(start + i) % from.length]!;
      if (!e.limbHp.has(region) || e.char.severed.has(region)) continue;
      this.sever(e, region, d, res);
      if (e.char.severed.has(region)) {
        count--;
        this.cuts++;
      }
    }
  }

  /** A second opening round the side of the first, so that it reads as a body laid open and not as one big hole. */
  private open(e: Enemy, d: DamageInfo): void {
    const seam = this.seam;
    seam.amount = d.amount;
    seam.source = d.source;
    seam.point.copy(d.point);
    seam.dir.copy(d.dir).applyAxisAngle(UP, chance(0.5) ? FLESH_TURN : -FLESH_TURN);
    this.w.ctx.gore.wound(e.char, seam, 1);
    e.blood = 1;
    e.char.setBloodiness(1);
  }

  ignite(e: Enemy, seconds: number): void {
    e.burning = Math.max(e.burning, seconds);
    this.m.outpost?.wounds.caughtFire(e);
  }

  private blocked(e: Enemy, d: DamageInfo, res: DamageResult): DamageResult {
    res.blocked = true;
    this.m.emitHit(e, d, res);
    return res;
  }

  private spendPool(e: Enemy, region: GoreRegion, amount: number): number {
    const left = (e.limbHp.get(region) ?? Infinity) - amount;
    e.limbHp.set(region, left);
    return left;
  }

  private spendLimb(e: Enemy, region: GoreRegion, d: DamageInfo, res: DamageResult): void {
    if (!e.limbHp.has(region) || region === 'head' || e.char.severed.has(region)) return;
    const hit = d.amount * (d.severMult ?? 1) * SEVER_FACTOR[d.type] * this.rules(e).limbWear;
    if (hit <= 0) return;
    if (this.spendPool(e, region, hit) <= 0) this.sever(e, region, d, res);
  }

  /** An explosive hit with no ring to answer to, a rocket's own contact or a boss in a blast, works the limb pools. */
  private blastLimb(e: Enemy, d: DamageInfo, res: DamageResult): void {
    const rules = this.rules(e);
    if (d.type !== 'explosive' || e.def.machine || !chance(rules.blastLimb)) return;
    const region = pick(BLAST_LIMBS);
    if (e.limbHp.has(region) && !e.char.severed.has(region)) {
      const hit = d.amount * (d.severMult ?? 1) * SEVER_FACTOR.explosive * rules.limbWear;
      if (this.spendPool(e, region, hit) <= 0) this.sever(e, region, d, res);
    }
  }

  sever(e: Enemy, region: GoreRegion, d: DamageInfo, res: DamageResult | null): void {
    const { ctx } = this.w;
    // The limb leaves at the speed the body was going, the same as the body it leaves when this is a death.
    const cut = ctx.gore.sever(e.char, e.def.severAt?.[region] ?? region, d, deathVelocity(e, _dying, this.w.now));
    if (!cut) return;
    ctx.audio.play('limb_sever', { position: cut.stump, pitchJitter: 0.08 });
    if (!e.def.machine) say(e, this.w, 'vox_scream', 0.8);
    for (const r of cut.regions) {
      e.limbHp.delete(r);
      res?.severed.push(r);
      ctx.events.emit('enemy:severed', { enemy: e, region: r, damage: d });
    }
    this.updateMaim(e);
    this.m.outpost?.wounds.onSevered(e, region);
    e.def.onLimbLost?.(e, this.w, region);
    e.boss?.onLimbLost(e, this.w, region);
  }

  /** Re-reads what is left of the body. The AI layers react through `requires` and scores; nothing else is needed. */
  updateMaim(e: Enemy): void {
    if (e.def.machine) return;
    const s = e.char.severed;
    const m = e.maim;
    const legL = s.has('legL') || s.has('shinL');
    const legR = s.has('legR') || s.has('shinR');
    const c = e.char;
    const body = this.m.outpost?.wounds.bodyOf(e) ?? null;
    const armL = s.has('armL') || s.has('forearmL') || c.isFractured(B.upperArmL) || c.isFractured(B.foreArmL) || (body?.armL ?? false) || (body?.handL ?? false);
    const armR = s.has('armR') || s.has('forearmR') || c.isFractured(B.upperArmR) || c.isFractured(B.foreArmR) || (body?.armR ?? false) || (body?.handR ?? false);
    m.legs = (legL ? 0 : 1) + (legR ? 0 : 1);
    // A broken leg still drags along. Crawling is for a body that has lost the legs, which the animator can see.
    if (m.legs > 1 && (c.isFractured(B.thighL) || c.isFractured(B.shinL) || c.isFractured(B.thighR) || c.isFractured(B.shinR))) m.legs = 1;
    // A wound takes the legs without taking them off. Everything that reads `legs` already knows what a man on the floor can do.
    if (body?.floored) m.legs = 0;
    else if (body && m.legs > 1 && body.limp !== 0) m.legs = 1;
    m.arms = (armL ? 0 : 1) + (armR ? 0 : 1);
    m.gunArm = !armR;
    m.offArm = !armL;
    m.head = !s.has('head');
    const open = 4 - m.legs - m.arms;
    // Wounds keep their own account of blood. See `WoundSystem.syncBody`.
    if (!body) e.bleed = e.isBoss ? 0 : open * e.maxHealth * 0.022;

    if (armL && e.shield) {
      // The shield went with the arm. It stops guarding and comes at you.
      e.shield = false;
      e.face = 'move';
      this.w.ctx.audio.play('riot_shield_break', { position: e.center });
    }
    if (e.attack?.requires && !e.attack.requires(e)) finishAttack(e, this.w, true);
    if (e.pinned && (m.legs < 2 || m.arms === 0)) dropOff(e);
    // Force a fresh choice now. Waiting for the next think would show a beat of the old behaviour on the new body.
    e.thinkAt = 0;
    e.behaviourUntil = 0;
  }

  private plateFor(e: Enemy, region: GoreRegion, d: DamageInfo): Plate | null {
    for (let i = 0; i < e.plates.length; i++) {
      const p = e.plates[i]!;
      if (p.hp <= 0 || !p.spec.regions.includes(region)) continue;
      if (p.spec.facing) {
        const behind = Math.sin(e.yaw) * d.dir.x + Math.cos(e.yaw) * d.dir.z > 0;
        if (behind !== (p.spec.facing === 'back')) continue;
      }
      return p;
    }
    return null;
  }

  /** An armour-piercing round or a shaped charge on the body: the armour in its way is gone, and the round lands in full. */
  private tearOff(e: Enemy, region: GoreRegion, d: DamageInfo, res: DamageResult): void {
    const all = !d.armorPiercing && !e.isBoss;
    // A dart only takes what covers the spot it hit; a charge on a boss takes the nearest plate it can find.
    const only = all ? null : this.plateFor(e, region, d) ?? (d.armorPiercing ? null : this.blastPlate(e));
    if (!all && !only) return;
    let torn = 0;
    for (let i = 0; i < e.plates.length; i++) {
      const p = e.plates[i]!;
      if (p.hp <= 0 || (only && p !== only)) continue;
      e.armor = Math.max(0, e.armor - p.hp);
      this.shootOff(e, p, d);
      torn++;
    }
    if (torn === 0) return;
    res.armour = 'broken';
    if (all && torn > 1) this.w.ctx.audio.play('armour_crunch', { position: e.center, pitchJitter: 0.05 });
  }

  /**
   * The class a round meets this plate as. A shotgun's pellets are counted per blast: the first on a piece bounces off, the
   * second wrecks it (medium), and the rest find nothing in their way.
   */
  private armourClass(plate: Plate, d: DamageInfo): ArmourClass {
    if (d.type === 'pellet') {
      if (this.volleyAt !== this.w.now) {
        this.volleyAt = this.w.now;
        this.volley.clear();
      }
      const hits = (this.volley.get(plate) ?? 0) + 1;
      this.volley.set(plate, hits);
      return hits >= 2 ? 'medium' : 'light';
    }
    return classOf(d.source, d.amount);
  }

  /** A blast chips whichever plate is left. */
  private blastPlate(e: Enemy): Plate | null {
    for (let i = 0; i < e.plates.length; i++) {
      const p = e.plates[i]!;
      if (p.hp > 0) return p;
    }
    return null;
  }

  private shootOff(e: Enemy, plate: Plate, d: DamageInfo): void {
    const { ctx } = this.w;
    plate.hp = 0;
    plate.mesh.getWorldPosition(_v);
    this.m.debris.launch(plate, _n.copy(d.dir).negate());
    ctx.fx.sparks(_v, _n, 18, 0xffe0a0);
    ctx.fx.ring(_v, _n, 0xffd0a0, 1.1);
    ctx.audio.play('armor_plate_off', { position: _v, pitchJitter: 0.08 });
    e.boss?.onPlateLost?.(e, this.w);
  }

  private hitWard(e: Enemy, d: DamageInfo, res: DamageResult): void {
    const { ctx } = this.w;
    e.ward -= d.amount;
    res.blocked = true;
    res.armour = 'stopped';
    this.w.telegraphs.flashWard(e.wardVisual);
    e.char.hitFlash(0.25);
    if (e.ward <= 0) {
      this.m.dropWard(e);
      ctx.fx.ring(e.center, _n.set(0, 1, 0), 0xffe9a0, 1.8);
      ctx.fx.sparks(e.center, _n, 14, 0xffe9a0);
    }
    this.m.emitHit(e, d, res);
  }

  private shieldStops(e: Enemy, d: DamageInfo, res: DamageResult): boolean {
    const facing = Math.sin(e.yaw) * d.dir.x + Math.cos(e.yaw) * d.dir.z;
    // Angle of the incoming shot against the body. The shield covers a little over the front half.
    if (facing > -0.35) return false;
    // Shots at the exposed gun arm or the legs below the rim still land.
    const region = d.region;
    if (region === 'armR' || region === 'forearmR' || region === 'shinL' || region === 'shinR') return false;
    // An armour-piercing dart goes through the shield as it does a plate, and lands on the man behind it.
    if (d.armorPiercing) {
      this.w.ctx.audio.play('sabot_shield_pierce', { position: d.point, pitchJitter: 0.04 });
      res.armour = 'broken';
      return false;
    }
    res.blocked = true;
    res.armour = 'stopped';
    const { ctx } = this.w;
    ctx.audio.play('riot_shield_hit', { position: d.point, pitchJitter: 0.1 });
    e.char.anim.flinch(B.upperArmL, d.dir, 0.3);
    if (d.type === 'explosive' || d.amount >= 40) e.char.anim.play('block', 1.4);
    // Sustained fire batters the arm behind the shield: enough of it and the arm goes, shield and all.
    const left = this.spendPool(e, 'armL', d.amount * (d.type === 'explosive' ? 0.35 : 0.22));
    if (left <= 0) this.sever(e, 'armL', d, res);
    this.m.emitHit(e, d, res);
    return true;
  }

  private tankStruck(e: Enemy, d: DamageInfo, region: GoreRegion): boolean {
    const t = e.def.tank!;
    if (!t.regions.includes(region) || d.type === 'fire') return false;
    if (d.type === 'explosive') return true;
    return !t.rearOnly || Math.sin(e.yaw) * d.dir.x + Math.cos(e.yaw) * d.dir.z > 0.2;
  }

  /**
   * Credited to whoever hit it, so a player who bursts a bomber in a pack gets the whole pack. One enemy setting off
   * another is a smaller thing: a full tank at the player's feet for a kill they had no part in would be a free death.
   */
  blowTank(e: Enemy, d: DamageInfo): void {
    const { ctx } = this.w;
    const t = e.def.tank!;
    e.tankBlown = true;
    const stray = d.source in ENEMIES || d.type === 'true' || d.type === 'crush';
    ctx.combat.explode(e.center, {
      radius: t.radius * (stray ? STRAY_TANK_RADIUS : 1), damage: t.damage * e.damageMul * (stray ? STRAY_TANK_DAMAGE : 1),
      kind: stray ? 'enemy' : 'barrel', source: stray ? e.id : d.source, team: stray ? 'enemy' : 'player', selfDamage: TANK_SELF_DAMAGE,
    });
  }

  private lethal(e: Enemy, d: DamageInfo, res: DamageResult, region: GoreRegion, severNow: boolean, blast: BlastRoll | null = null): DamageResult {
    res.killed = true;
    if (severNow && region !== 'head' && e.limbHp.has(region)) {
      const left = (e.limbHp.get(region) ?? 0) - d.amount * (d.severMult ?? 1) * SEVER_FACTOR[d.type] * this.rules(e).limbWear;
      if (left <= 0) this.sever(e, region, d, res);
    }
    this.kill(e, d, region, res, blast);
    this.m.emitHit(e, d, res);
    return res;
  }

  /** The single kill flow. Picks one death, tells everyone once. */
  kill(e: Enemy, d: DamageInfo, region: GoreRegion, res: DamageResult | null, blast: BlastRoll | null = null): void {
    if (!e.alive) return;
    const { ctx, player } = this.w;
    e.alive = false;
    e.health = 0;
    this.m.detach(e);

    if (e.def.tank && !e.tankBlown && chance(e.def.tank.onDeath)) this.blowTank(e, d);

    const force = d.force || DEFAULT_FORCE[d.type];
    const wounds = this.m.outpost?.wounds ?? null;
    const body = wounds?.bodyOf(e) ?? null;
    const slowly = wounds?.isBleedOut(d) ?? false;
    const headshot = region === 'head' && !AREA_TYPES.has(d.type);
    const shatter = e.frozen > 0;
    const blownUp = e.tankBlown || blast?.outcome === 'gib' || bursts(d);
    let gibbed = false;
    let sliced = false;

    if (e.boss) {
      e.dyingKind = 'boss';
      e.dying = e.boss.deathSeconds;
      e.boss.onDeath(e, this.w, d);
    } else if (e.def.id === 'drone') {
      this.m.startCrash(e);
    } else if (DevFlags.gibbing && (shatter || (blownUp && DevFlags.explosiveDeaths))) {
      gibbed = true;
      if (shatter) ctx.fx.sparks(e.center, _n.set(0, 1, 0), 40, 0xa0e8ff);
      else if (!e.def.machine) ctx.audio.play('gib_squelch', { position: e.center, pitchJitter: 0.1 });
      ctx.gore.gib(e.char, e.center, force);
    } else if (d.slicePlaneNormal) {
      sliced = true;
      ctx.gore.slice(e.char, d.point, d.slicePlaneNormal, d);
    } else if (headshot && !e.def.machine && d.type === 'melee') {
      // A club kills a man and leaves him his head: key 5's blunt blows, the only hits on an enemy typed 'melee'. An edge
      // takes a head with a slice plane, above.
      this.ragdoll(e, d, force, body ? HEADSHOT_TWITCH : undefined, true);
    } else if (headshot && !e.def.machine && (e.rising > 0 || body?.floored)) {
      // Half up, or lying down, there is no head to burst from standing height.
      this.ragdoll(e, d, force, body ? HEADSHOT_TWITCH : undefined, true);
      if (!body || d.amount >= HEAD_BURST_DAMAGE) ctx.gore.sever(e.char, 'head', d);
    } else if (headshot && body && d.amount < HEAD_BURST_DAMAGE) {
      // A light round kills a man and leaves him his head. Popping it off every time is what "like clay" meant.
      this.ragdoll(e, d, force, HEADSHOT_TWITCH, true);
    } else if (headshot && !e.def.machine) {
      ctx.gore.headshot(e.char, d, deathVelocity(e, _dying, this.w.now));
      if (d.amount < HEAD_BURST_DAMAGE) ctx.audio.play('vox_choke', { position: e.center, pitch: e.def.voice.pitch });
    } else if (blast?.outcome === 'head' && DevFlags.gibbing) {
      ctx.gore.headshot(e.char, d, deathVelocity(e, _dying, this.w.now));
    } else {
      if (blownUp && !DevFlags.explosiveDeaths) this.blastMaim(e, d);
      if (blast) this.blastDeath(e, d, res, blast);
      else if (DevFlags.gibbing && !e.def.machine && tearsWaist(d, region, force)) this.sever(e, 'abdomen', d, res);
      const twitch = body ? (slowly ? SLOW_TWITCH : SUDDEN_TWITCH) : undefined;
      // Section 14.1: what kills a man all at once drops him where he is. Only a clock gives him time to go.
      if (!blownUp && this.diesOnFeet(e, d, force) && (!body || slowly)) this.collapse(e, d, region, force, slowly, twitch);
      else this.ragdoll(e, d, force, twitch);
    }

    if (res) res.headshot = headshot;

    const ev: KillEvent = {
      enemy: e,
      damage: d,
      headshot,
      gibbed,
      sliced,
      severedCount: e.char.severed.size,
      playerAirborne: !ctx.player.grounded,
      playerSliding: ctx.player.sliding,
      playerWallRunning: ctx.player.wallRunning,
      playerSpeed: player.speed,
      distance: e.position.distanceTo(player.position),
      explosionId: d.explosionId ?? null,
    };
    if (!headshot) say(e, this.w, e.def.voice.die, 0.7);
    ctx.events.emit('enemy:killed', ev);
    if (e.dyingKind === 'none') this.m.retire(e);
    else this.m.holdForDeath(e);
  }

  /** What the ring left of a body it killed. The ragdoll takes whatever comes after this. */
  private blastDeath(e: Enemy, d: DamageInfo, res: DamageResult | null, blast: BlastRoll): void {
    const rule = OUTCOMES[blast.outcome];
    if (blast.outcome === 'waist' && DevFlags.gibbing && this.cuts < BLAST.cuts) {
      this.cuts++;
      this.sever(e, 'abdomen', d, res);
    }
    this.tear(e, d, res, rule);
    if (blast.outcome === 'flesh') this.open(e, d);
    if (rule.fire !== undefined) (e.char as unknown as { setBurn(amount: number): void }).setBurn(1);
  }

  /** With explosive deaths off, what would have been a gib leaves a thrown body short of a limb or two. */
  private blastMaim(e: Enemy, d: DamageInfo): void {
    if (e.def.machine) return;
    for (let i = 0; i < 2; i++) {
      const region = pick(BLAST_LIMBS);
      if (e.limbHp.has(region) && !e.char.severed.has(region)) this.sever(e, region, d, null);
    }
  }

  /** It needs its legs under it and a hit too light to knock them away. */
  private diesOnFeet(e: Enemy, d: DamageInfo, force: number): boolean {
    return DIES_ON_FEET.has(d.type) && force <= DIES_ON_FEET_FORCE && e.maim.legs === 2 && !e.downed && e.rising <= 0
      && !e.airborne && !e.pinned && !e.def.machine;
  }

  /** Shot dead standing up: it takes a moment to go, and goes on taking rounds on the way. */
  private collapse(e: Enemy, d: DamageInfo, region: GoreRegion, force: number, slowly: boolean, twitch: number | undefined): void {
    const o = this.m.collapseOptions;
    o.duration = slowly ? rand(BLEED_COLLAPSE_MIN, BLEED_COLLAPSE_MAX) : rand(COLLAPSE_MIN, COLLAPSE_MAX);
    o.twitch = twitch;
    deathVelocity(e, o.velocity, this.w.now);
    if (AREA_TYPES.has(d.type)) o.hit = undefined;
    else {
      const hit = this.m.collapseHit;
      hit.bone = d.bone ?? REGION_BONE[region] ?? 0;
      hit.point.copy(d.point);
      hit.dir.copy(d.dir);
      hit.force = force;
      o.hit = hit;
    }
    this.w.ctx.gore.collapse(e.char, o);
  }

  ragdoll(e: Enemy, d: DamageInfo | null, force: number, twitch?: number, limp = false): void {
    const { ctx } = this.w;
    if (d) {
      const bone = d.bone ?? REGION_BONE[d.region ?? 'chest'] ?? 0;
      _v.copy(d.dir).multiplyScalar(force);
      _v.y += force * 0.15;
      this.m.ragdollOptions.impulses![0]!.bone = bone;
      this.m.ragdollOptions.impulses![0]!.point.copy(d.point);
      this.m.ragdollOptions.impulses![0]!.impulse.copy(_v);
    } else {
      this.m.ragdollOptions.impulses![0]!.impulse.set(0, 0, 0);
    }
    deathVelocity(e, this.m.ragdollOptions.velocity!, this.w.now);
    this.m.ragdollOptions.twitch = twitch;
    this.m.ragdollOptions.limp = limp;
    ctx.gore.ragdoll(e.char, this.m.ragdollOptions);
  }

  /** Non-lethal hits always answer, on the same frame. This is the first game's biggest missing feel. */
  private react(e: Enemy, d: DamageInfo, region: GoreRegion, amount: number, res: DamageResult, throws = false): void {
    const char = e.char;
    const frac = clamp(amount / e.maxHealth, 0, 1);
    const bone = d.bone ?? (e.def.machine ? DroneBone.body : REGION_BONE[region] ?? 0);
    const armoured = res.blocked;
    const flinch = flinchSize(frac, e.def.machine === true);
    const profile = profileOf(e);

    // A body with a profile, on its feet, flinches in `respond`, which knows first whether a head hit takes it to the floor.
    if (!profile || e.downed) char.anim.flinch(bone, d.dir, flinch);
    char.hitFlash(armoured ? 0.35 : clamp(0.55 + frac * 2, 0.55, 1));
    if (!armoured && d.type !== 'fire' && d.type !== 'shock' && !e.def.machine) {
      e.blood = Math.min(1, e.blood + 0.08 + frac * 1.1);
      char.setBloodiness(e.blood);
    }

    const pushForce = d.force || DEFAULT_FORCE[d.type];
    e.pressure = Math.min(1, e.pressure + 0.22 + frac);
    if (e.downed) {
      this.hitWhileDown(e, d, bone, pushForce);
      return;
    }
    // Getting up runs on keys from the root. Moved under it, the feet would slide.
    const shove = e.rising > 0 ? 0 : clamp((pushForce / e.def.hp) * SHOVE_GAIN, 0, SHOVE_MAX) * (e.isBoss ? 0.1 : 1);
    e.push.x += d.dir.x * shove;
    e.push.z += d.dir.z * shove;
    unmoved(e, this.w.now, d.dir.x * shove, d.dir.z * shove);

    if (e.pinned) dropOff(e);

    if (profile) {
      this.respond(e, d, profile, region, amount, pushForce, bone, armoured, throws, flinch);
      return;
    }
    e.poise += amount;
    if (e.poise >= e.def.poise * e.maxHealth) {
      e.poise = 0;
      this.stagger(e, d.type === 'explosive' ? 0.75 : 0.5);
    } else if (!armoured) this.cryOut(e);
  }

  private cryOut(e: Enemy): void {
    if (this.w.now < e.painAt) return;
    e.painAt = this.w.now + (e.isBoss ? BOSS_PAIN_GAP : rand(PAIN_GAP, PAIN_GAP * 2));
    say(e, this.w, e.def.voice.pain, 0.6);
  }

  /** The rule in reactions.ts, carried out. */
  private respond(e: Enemy, d: DamageInfo, profile: ReactionProfile, region: GoreRegion, amount: number, force: number, bone: number, armoured: boolean, throws: boolean, flinch: number): void {
    const anim = e.char.anim;
    const r = chooseReaction(e, d, profile, region, amount, force, this.w.now);
    // Only a head hit goes to the floor through the cooldown or a get-up (`chooseReaction`), where anything else flinches.
    const early = r.level === 'felled' && (this.w.now < e.reactAt || e.rising > 0);
    const must = this.m.outpost?.wounds.mustFall(e) || (throws && e.maim.legs > 0);
    if (must) mustFall(r, d);
    // Ice cannot stumble, and a body still arriving is on somebody else's clock.
    const held = e.frozen > 0 || e.entrance !== 'none';
    // Floored by a head hit, the fall is the whole reaction. A flinch and a guard on the animator first would be read into the
    // speed it goes down at, the head spinning against the chest and the hands thrown up at 10 m/s (gore.md, nothing a hit
    // does to the animation may land in one frame), as `contact.ts` does for a body check. With `?knock=0`, as before.
    const headDown = KNOCK_PASS && !held && r.level === 'felled' && region === 'head';
    // Felled on its way up, it goes over from the clip's pose, with nothing on the animator first either (`?struggle=0`: as
    // before, which only a head hit did).
    const riseDown = STRUGGLE_PASS && !held && r.level === 'felled' && e.rising > 0;
    const floors = headDown || riseDown;
    if (!floors) anim.flinch(bone, d.dir, flinch);
    if (held) return;
    const felt = profile.pain > 0;
    const blast = d.type === 'explosive';
    if (r.level === 'flinch') {
      if (!armoured) this.cryOut(e);
      return;
    }
    if (felt && !floors) {
      if (blast || region === 'head') anim.guard?.(0.5 + r.strength * 0.5);
      else if (!armoured) anim.holdWound?.(bone, d.point, 0.7 + r.strength);
    }
    if (felt && !armoured) say(e, this.w, e.def.voice.pain, 0.7);
    const reactAt = e.reactAt;
    e.reactAt = this.w.now + profile.cooldown;
    if (r.level === 'thrown' || r.level === 'felled') {
      // Only the rising rule drops it from the clip's pose with no topple. A head hit on a rising body goes over as any head
      // hit does, tipped along the round and, knocked cold, with legs and spine locked.
      const drops = riseDown && region !== 'head';
      const how = r.knockout || drops ? knockAs(drops ? null : undefined, undefined, r.knockout, r.knockout ? d.point : undefined) : undefined;
      if (this.knockDown(e, d.dir, r.strength, bone, profile, r.level === 'thrown', how)) {
        e.shock = 0;
        return;
      }
      if (floors) {
        anim.flinch(bone, d.dir, flinch);
        // Gore has no room for it. Inside the cooldown or a get-up a head hit only skipped them to go to the floor, so it
        // flinches as any other hit would there; staggered, an SMG would pin and shove a body for as long as it kept firing.
        // A body felled on its way up is always inside a get-up.
        if (early && !must) {
          e.reactAt = reactAt;
          return;
        }
        if (felt && headDown) anim.guard?.(0.5 + r.strength * 0.5);
      }
      // Past gore's budget. Staggering is what it would have done with one more foot under it.
      this.stagger(e, STAGGER_MAX, d.dir, r.strength, bone, profile.reel);
      e.shock = 0;
      return;
    }
    const seconds = lerp(STAGGER_MIN, STAGGER_MAX, r.strength);
    if (r.tripped) {
      // Stopped short by its own leg, with the rest of the body still going.
      _v.copy(e.velocity);
      e.reel.copy(_v);
      e.velocity.set(0, 0, 0);
      this.stagger(e, seconds, _v.normalize(), r.strength, bone, 0);
    } else {
      this.stagger(e, seconds, d.dir, r.strength, bone, profile.reel);
    }
    e.shock *= SHOCK_AFTER_STAGGER;
    if (r.level === 'fall') {
      e.fallIn = rand(FALL_LEAD_MIN, FALL_LEAD_MAX);
      e.fallStrength = r.strength;
      e.fallBone = bone;
    }
  }

  /** Wounds: nothing hit him, he has simply stopped being able to stand. He goes over the way he was facing. */
  drop(e: Enemy, strength: number, bone: number): void {
    if (e.downed || e.fallIn > 0 || !e.alive) return;
    _n.set(Math.sin(e.yaw), 0, Math.cos(e.yaw));
    this.stagger(e, STAGGER_MIN, _n, strength, bone, 0.5);
    e.fallIn = rand(FALL_LEAD_MIN, FALL_LEAD_MAX);
    e.fallStrength = strength;
    e.fallBone = bone;
  }

  /** Wounds: patched up and helped to his feet, from the crawl he was in. */
  standUp(e: Enemy): void {
    const profile = profileOf(e);
    if (!profile) return;
    e.char.anim.getUp?.('prone', profile.rise * 1.3, 0.9);
    e.rising = profile.rise * 1.3;
    e.stagger = e.rising + profile.daze;
    e.char.anim.daze?.(e.stagger);
  }

  /** Staggering did not save it. */
  fall(e: Enemy): void {
    const profile = profileOf(e);
    if (!profile || !e.alive || e.downed) return;
    _v.copy(e.reel).setY(0);
    if (_v.lengthSq() < 1e-4) _v.set(Math.sin(e.yaw), 0, Math.cos(e.yaw)).negate();
    this.knockDown(e, _v.normalize(), e.fallStrength, e.fallBone, profile, false);
  }

  /**
   * The player ran into it (`contact.ts`). Fast enough, it goes off its feet along the run with some of the player's speed
   * in it, and gets up again; a slide takes its legs from under it, so they go with the player and it goes over backwards.
   * False when it did not go down: then contact staggers it as it always did. Bosses and machines, which have no
   * reaction profile, never go down here.
   */
  bodyCheck(e: Enemy, dir: THREE.Vector3, closing: number, sliding: boolean): boolean {
    const profile = profileOf(e);
    if (!KNOCK_PASS || !profile || e.downed || e.frozen > 0 || e.entrance !== 'none') return false;
    const s = checkStrength(closing, e.def.mass, sliding);
    if (s < CHECK_MIN) return false;
    // The shove contact just gave it is most of the player's speed, which on a corpse-to-be would be a throw.
    const px = e.push.x;
    const pz = e.push.z;
    const carry = Math.hypot(px, pz);
    if (carry > CHECK_CARRY) {
      e.push.x *= CHECK_CARRY / carry;
      e.push.z *= CHECK_CARRY / carry;
    }
    // Swept: `dir` is where the legs go, and the knockdown's own direction is where it falls, back along the slide.
    const way = sliding ? _check.copy(dir).negate() : _check.copy(dir);
    const topple = _checkTopple.copy(way).multiplyScalar(sliding ? SLIDE_TOPPLE : lerp(CHECK_TOPPLE_MIN, CHECK_TOPPLE_MAX, s));
    const how = knockAs(topple, sliding ? SLIDE_KICK : undefined, false, undefined);
    // Refused, `knockDown` calls off a fall the body already had coming, which is not this run's to call off.
    const fallIn = e.fallIn;
    if (this.knockDown(e, way, s, sliding ? B.thighL : B.chest, profile, false, how)) return true;
    e.push.x = px;
    e.push.z = pz;
    e.fallIn = fallIn;
    return false;
  }

  /** False if gore has no room for another body on the floor. */
  private knockDown(e: Enemy, dir: THREE.Vector3, strength: number, bone: number, profile: ReactionProfile, thrown: boolean, how?: Knock): boolean {
    const { ctx } = this.w;
    const m = this.m;
    const o = m.knockOptions;
    const cold = how?.knockout === true;
    o.velocity.set(e.velocity.x + e.reel.x + e.push.x, e.airborne ? e.verticalSpeed : 0, e.velocity.z + e.reel.z + e.push.z);
    m.knockImpact.dir.copy(dir);
    m.knockImpact.strength = how?.impact ?? strength * 0.4;
    o.impact = m.knockImpact;
    // A blast throws it by itself, once this returns and the blast reaches Physics. Knocked down on its way up, it goes over
    // from the clip's pose under its own weight, at the speed the clip had it moving (`measureAnimVelocity`).
    if (thrown || how?.topple === null) o.topple = undefined;
    else if (how?.topple) o.topple = m.knockTopple.copy(how.topple);
    else o.topple = m.knockTopple.copy(dir).multiplyScalar(lerp(TOPPLE_MIN, TOPPLE_MAX, strength));
    o.impulses = undefined;
    o.knockout = cold;
    const wounds = m.outpost?.wounds ?? null;
    const floored = wounds?.bodyOf(e)?.floored ?? false;
    // Before gore has the body: what it hands back at the end depends on this.
    if (floored) wounds!.stayDown(e);
    o.hurt = floored ? 1 : profile.pain * (0.5 + strength * 0.5);
    o.lie = floored ? wounds!.lieSeconds(wounds!.bodyOf(e)!) : rand(profile.lie[0], profile.lie[1]) * (0.7 + strength * 0.6) * (cold ? KNOCKOUT_LIE : 1);
    // With all four limbs it pushes itself part of the way up on the floor, and the clip plays the rest in the rest of the time.
    const pushes = STRUGGLE_PASS && pushesUp(e);
    e.riseSeconds = floored ? 0 : profile.rise * (0.85 + strength * 0.4) * (pushes ? 1 - RISE_PUSHED : 1);
    e.dazeSeconds = floored ? 0 : profile.daze * (thrown || cold ? 1 : strength);
    o.rise = e.riseSeconds;
    const wound = m.knockWound;
    wound.bone = bone;
    // Knocked cold, the head jolts back from where the round went in, and a hand goes there.
    if (how?.point) wound.point.copy(how.point);
    else wound.point.setFromMatrixPosition(e.char.bones[bone]!.matrixWorld);
    o.wound = wound;
    if (!ctx.gore.knockdown(e.char, o)) {
      e.fallIn = 0;
      return false;
    }
    if (e.attack) finishAttack(e, this.w, true);
    if (e.pinned) dropOff(e);
    e.downed = true;
    e.airborne = true;
    e.ballistic = false;
    e.fallIn = e.stagger = 0;
    e.verticalSpeed = e.flightLeft = 0;
    e.reel.set(0, 0, 0);
    e.push.set(0, 0, 0);
    e.velocity.set(0, 0, 0);
    return true;
  }

  /** It keeps taking hits on the floor, and every one lands on the body as it lies. */
  private hitWhileDown(e: Enemy, d: DamageInfo, bone: number, force: number): void {
    const m = this.m;
    const o = m.knockOptions;
    const i = m.knockImpulses[0]!;
    i.bone = bone;
    i.point.copy(d.point);
    i.impulse.copy(d.dir).multiplyScalar(force);
    o.impulses = m.knockImpulses;
    o.impact = undefined;
    o.topple = undefined;
    o.knockout = false;
    const wound = m.knockWound;
    wound.bone = bone;
    wound.point.copy(d.point);
    o.wound = wound;
    this.w.ctx.gore.knockdown(e.char, o);
    this.cryOut(e);
  }

  /** A hit that took its balance. With `dir` it takes real steps that way, `reel` metres per second at the start. */
  stagger(e: Enemy, seconds: number, dir?: THREE.Vector3, strength = 0.5, bone = REGION_BONE.chest, reel = 1.5): void {
    if (e.isBoss) return;
    e.stagger = Math.max(e.stagger, seconds);
    const anim = e.char.anim;
    if (dir && anim.stumble) {
      anim.stumble(dir, strength, bone);
      const speed = reel * (1 + strength * REEL_GAIN);
      e.reel.x += dir.x * speed;
      e.reel.z += dir.z * speed;
      unmoved(e, this.w.now, dir.x * speed, dir.z * speed);
    } else {
      anim.play('stagger', 1);
    }
    if (e.attackPhase === 'windup') finishAttack(e, this.w, true);
  }
}

