import type { HitClaim, Vec } from './worldProtocol';
import { REGIONS, validVec } from './worldProtocol';
import { WEAPONS } from '../weapons/data';
import type { WeaponId } from '../core/gameplay';

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

export class ClaimValidator {
  private readonly shots = new Map<string, { shot: number; weapon: string; at: number; hits: number }>();
  acceptFire(peer: string, shot: number, weapon: string, now: number): boolean {
    if (!Number.isSafeInteger(shot) || shot < 0 || !Object.hasOwn(WEAPONS, weapon)) return false;
    const def = WEAPONS[weapon as WeaponId];
    const previous = this.shots.get(peer);
    if (previous && (shot <= previous.shot || now - previous.at < Math.max(8, def.interval * 650))) return false;
    this.shots.set(peer, { shot, weapon, at: now, hits: 0 });
    return true;
  }
  validate(peer: string, value: unknown, now: number, eye: Vec, target: Vec, visible: (from: Vec, to: Vec) => boolean): value is HitClaim {
    const claim = value as HitClaim | null;
    if (!claim || claim.t !== 'hit' || !Object.hasOwn(WEAPONS, claim.weapon) || !Number.isSafeInteger(claim.target) || claim.target <= 0) return false;
    const shot = this.shots.get(peer);
    if (!shot || claim.shot !== shot.shot || claim.weapon !== shot.weapon || now - shot.at > 8000) return false;
    const def = WEAPONS[claim.weapon as WeaponId];
    const damage = claim.damage;
    if (!damage || !validVec(claim.origin) || !validVec(damage.point) || !validVec(damage.dir)
      || typeof damage.source !== 'string' || damage.source.length > 64
      || distance(claim.origin, eye) > 7 || distance(damage.point, target) > 8 || distance(eye, target) > 350
      || !Number.isFinite(damage.amount) || damage.amount <= 0 || damage.amount > Math.max(2000, def.damage * 24)
      || !Number.isFinite(damage.force) || damage.force < 0 || damage.force > 100000
      || !['bullet', 'pellet', 'explosive', 'slash', 'melee', 'fire', 'shock', 'crush', 'true'].includes(damage.type)
      || (damage.region !== undefined && !REGIONS.includes(damage.region))
      || (damage.load !== undefined && !['ap', 'hp'].includes(damage.load))
      || (damage.bone !== undefined && (!Number.isInteger(damage.bone) || damage.bone < 0 || damage.bone > 255))
      || (damage.slicePlaneNormal !== undefined && !validVec(damage.slicePlaneNormal))) return false;
    for (const scalar of [damage.headshotMult, damage.severMult, damage.reach]) if (scalar !== undefined && (!Number.isFinite(scalar) || scalar < 0 || scalar > 1000)) return false;
    if (shot.hits >= Math.max(64, def.pellets * 12) || !visible(eye, target)) return false;
    shot.hits++;
    return true;
  }
  forget(peer: string): void { this.shots.delete(peer); }
}

export class RespawnClock {
  private deadline: number | null = null;
  life = 0;
  get down(): boolean { return this.deadline !== null; }
  die(now: number): boolean {
    if (this.down) return false;
    this.deadline = now + 3500;
    return true;
  }
  update(now: number): boolean {
    if (this.deadline === null || now < this.deadline) return false;
    this.deadline = null;
    this.life++;
    return true;
  }
  accepts(life: number): boolean { return !this.down && life === this.life; }
}
