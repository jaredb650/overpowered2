import type { HitClaim, Vec } from './worldProtocol';
import { REGIONS, validVec } from './worldProtocol';
import { WEAPONS } from '../weapons/data';
import type { WeaponId } from '../core/gameplay';
import { AKIMBO_GUNS } from '../weapons/mods';
import { KATA } from '../weapons/kata';

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

/** Damage from a call-in, a sentry or a drop pod: what the guest called in hit, not what their gun did. */
export const ASSIST_CLAIM = /^(airstrike|warthog|chopper|door_gun|orbital|ac130|black_sun|nuke|sentry|chain_storm|chain_reaction|drop_pod|mortar|mine|tripwire|claymore|rigged|deadman|frame|mech|harrow_|attack)/;
/** How a claim is checked: a gun's shot, a blast (no line from the eye: grenades go round corners), or a call-in's work. */
export const claimKind = (source: string, type: string): 'shot' | 'blast' | 'assist' =>
  ASSIST_CLAIM.test(source) ? 'assist' : type === 'explosive' ? 'blast' : 'shot';
/** Blast and call-in claims a guest may make in a second, whatever made them. A nuke's worth, not a flood. */
const AREA_PER_SECOND = 160;
/** How long after calling one in a guest's call-in may still be doing damage (a sentry stands for minutes). */
const CALLIN_WINDOW_MS = 240_000;
/** Combat's instakill number (an `instakill` blast) and the nuke's front: what the host applies for a kill it recognises. */
const INSTAKILL = 99999, NUKE = 999999;
/** The call-ins whose hit is a kill whatever it touches, by source, with the blast kind (the nuke's: its damage type) it comes as. */
const CALLIN_KILLS: Readonly<Record<string, string>> = { airstrike: 'hellfire', black_sun: 'finisher', nuke: 'true' };

export class ClaimValidator {
  private readonly shots = new Map<string, { shot: number; weapon: string; at: number; hits: number }>();
  private readonly called = new Map<string, number>();
  private readonly area = new Map<string, { second: number; count: number }>();
  /** When each guest's last Gun Kata began, by their word. */
  private readonly katas = new Map<string, number>();
  /** The guest announced a call-in (`callin:used` on their side). */
  callIn(peer: string, now: number): void { this.called.set(peer, now); }
  /**
   * The guest's Gun Kata began: for `KATA.window` s their shots may come as fast as the floor, as the burst fires every gun in hand
   * at whoever is round them. Each shot is still a hit claim checked as any other. Taken once a brain chip charge (most of
   * `KATA.cooldown`, for lag), so a guest cannot keep it open: false when it comes too soon.
   */
  kata(peer: string, now: number): boolean {
    const last = this.katas.get(peer);
    if (last !== undefined && now - last < KATA.cooldown * 800) return false;
    this.katas.set(peer, now);
    return true;
  }
  /** `akimbo`: the guest says two guns fired it, which halves the gap the gun's rate needs, on a gun that takes akimbo only. */
  acceptFire(peer: string, shot: number, weapon: string, now: number, akimbo = false): boolean {
    if (!Number.isSafeInteger(shot) || shot < 0 || !Object.hasOwn(WEAPONS, weapon)) return false;
    const def = WEAPONS[weapon as WeaponId];
    const previous = this.shots.get(peer);
    const kata = now - (this.katas.get(peer) ?? -Infinity) < KATA.window * 1000;
    const pace = kata ? 0 : def.interval * 650 / (akimbo && (AKIMBO_GUNS as readonly string[]).includes(weapon) ? 2 : 1);
    if (previous && (shot <= previous.shot || now - previous.at < Math.max(8, pace))) return false;
    this.shots.set(peer, { shot, weapon, at: now, hits: 0 });
    return true;
  }
  validate(peer: string, value: unknown, now: number, eye: Vec, target: Vec, visible: (from: Vec, to: Vec) => boolean): value is HitClaim {
    const claim = value as HitClaim | null;
    if (!claim || claim.t !== 'hit' || !Object.hasOwn(WEAPONS, claim.weapon) || !Number.isSafeInteger(claim.target) || claim.target <= 0) return false;
    const damage = claim.damage;
    if (!damage || typeof damage.source !== 'string' || typeof damage.type !== 'string') return false;
    const kind = claimKind(damage.source, damage.type);
    const def = WEAPONS[claim.weapon as WeaponId];
    const shot = this.shots.get(peer);
    if (kind === 'shot' && (!shot || claim.shot !== shot.shot || claim.weapon !== shot.weapon || now - shot.at > 8000)) return false;
    // Pods, mines and Outpost Defense's bought mortars work on their own clock, with no call-in announced.
    if (kind === 'assist' && now - (this.called.get(peer) ?? -Infinity) > CALLIN_WINDOW_MS && !/^(drop_pod|mine|tripwire|claymore|mortar)/.test(damage.source)) return false;
    if (kind !== 'shot') {
      const second = Math.floor(now / 1000);
      const area = this.area.get(peer) ?? { second, count: 0 };
      if (area.second !== second) { area.second = second; area.count = 0; }
      this.area.set(peer, area);
      if (++area.count > AREA_PER_SECOND) return false;
    }
    let cap = kind === 'shot' ? Math.max(2000, def.damage * 24) : 20000;
    // Over the cap only as a kill the guest really has; then the claim carries the host's number, not theirs.
    const kill = damage.amount > cap ? this.instakill(peer, damage, kind, now) : undefined;
    if (kill) damage.amount = cap = kill;
    const range = kind === 'assist' ? 800 : 350;
    if (!validVec(claim.origin) || !validVec(damage.point) || !validVec(damage.dir)
      || damage.source.length > 64
      || distance(claim.origin, eye) > 7 || distance(damage.point, target) > 8 || distance(eye, target) > range
      || !Number.isFinite(damage.amount) || damage.amount <= 0 || damage.amount > cap
      || !Number.isFinite(damage.force) || damage.force < 0 || damage.force > 100000
      || !['bullet', 'pellet', 'explosive', 'slash', 'melee', 'fire', 'shock', 'crush', 'true'].includes(damage.type)
      || (damage.region !== undefined && !REGIONS.includes(damage.region))
      || (damage.load !== undefined && !['ap', 'hp', 'plusP', 'flechette', 'api'].includes(damage.load))
      || (damage.armour !== undefined && !['light', 'medium', 'heavy'].includes(damage.armour))
      || (damage.bone !== undefined && (!Number.isInteger(damage.bone) || damage.bone < 0 || damage.bone > 255))
      || (damage.slicePlaneNormal !== undefined && !validVec(damage.slicePlaneNormal))) return false;
    for (const scalar of [damage.headshotMult, damage.severMult, damage.reach]) if (scalar !== undefined && (!Number.isFinite(scalar) || scalar < 0 || scalar > 1000)) return false;
    if (kind !== 'shot') return true;
    if (shot!.hits >= Math.max(64, def.pellets * 12) || !visible(eye, target)) return false;
    shot!.hits++;
    return true;
  }
  /**
   * The number a claim over its cap may stand for, or undefined. A gun's instakill blast comes off the gun the guest last fired:
   * the HE shell of a gun whose row is an instakill (the autocannon), or a Hellfire rocket off a launcher. A call-in's kill comes
   * from a call-in announced lately (checked before this). Shots never need one: a gun's own cap is its damage times 24.
   */
  private instakill(peer: string, damage: HitClaim['damage'], kind: 'shot' | 'blast' | 'assist', now: number): number | undefined {
    if (kind === 'assist') {
      if (!Object.hasOwn(CALLIN_KILLS, damage.source) || CALLIN_KILLS[damage.source] !== (damage.blastKind ?? damage.type)) return undefined;
      return damage.source === 'nuke' ? NUKE : INSTAKILL;
    }
    const shot = this.shots.get(peer);
    if (kind !== 'blast' || !shot || shot.weapon !== damage.source || now - shot.at > 8000) return undefined;
    const gun = WEAPONS[shot.weapon as WeaponId];
    const hits = gun.round === 'shell' ? gun.damage >= INSTAKILL && damage.blastKind === 'shell' : gun.round === 'rocket' && damage.blastKind === 'hellfire';
    return hits ? INSTAKILL : undefined;
  }
  forget(peer: string): void { this.shots.delete(peer); this.called.delete(peer); this.area.delete(peer); this.katas.delete(peer); }
}
