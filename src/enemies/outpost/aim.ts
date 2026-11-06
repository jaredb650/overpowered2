/**
 * How a soldier hits a moving target. The swarm's `aimAtPlayer` treats speed as armour, which is right for a horde and is why humans
 * could not touch a running player: measured, a sprinter took 20 damage a minute and a man standing still took 450.
 *
 * Here a man solves the intercept properly and his error comes from range, rank and nerve. Running in a straight line buys almost nothing.
 * What he cannot read is a change of direction, because he leads on what his eye has averaged: `TargetTrack` lags the real velocity by
 * a fifth of a second or so. The player's counter is to turn, dash and break line, which is a skill, not a speed.
 */
import * as THREE from 'three';
import { randomUnit } from '../../core/math';
import type { AiWorld } from '../aiWorld';
import type { RankDef } from './rank';

/** Metres of miss radius at the muzzle, and per metre of range, for a steady regular. */
const MISS_BASE = 0.34;
const MISS_PER_METRE = 0.031;
/** What full speed adds to his error. A tax, and no longer a shield. */
const SPEED_TAX = 0.28;
/** A target that has stopped moving is easy. */
const STILL_SHARE = 0.62;
/** The first round of a burst is a snap shot. The rest walk on. */
const SNAP_MISS = 1.35;
const WALKED_MISS = 0.85;
/** Rate his eye catches up with the target's real motion, in 1/s. */
const EYE_RATE = 5;
/** Vertical motion is a jump, and nobody leads a jump all the way. */
const LEAD_VERTICAL = 0.45;

const _target = new THREE.Vector3();
const _rand = new THREE.Vector3();

/** The player's motion as a watching eye has it: right for a straight run, late for a turn. */
export class TargetTrack {
  readonly velocity = new THREE.Vector3();

  update(dt: number, real: THREE.Vector3): void {
    this.velocity.lerp(real, 1 - Math.exp(-EYE_RATE * dt));
  }

  reset(): void {
    this.velocity.set(0, 0, 0);
  }

  get speed(): number {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }
}

/** Writes where the target will be when a round leaving `from` at `speed` gets there, as far as this man can tell. */
export function interceptPoint(w: AiWorld, track: TargetTrack, from: THREE.Vector3, speed: number, lead: number, out: THREE.Vector3): THREE.Vector3 {
  const p = w.player;
  const v = track.velocity;
  // Two passes: the flight time depends on where the target ends up, and at these speeds the second pass is within a few centimetres.
  let flight = from.distanceTo(p.chest) / speed;
  out.copy(p.chest).addScaledVector(v, flight);
  flight = from.distanceTo(out) / speed;
  out.copy(p.chest);
  out.x += v.x * flight * lead;
  out.z += v.z * flight * lead;
  out.y += v.y * flight * lead * LEAD_VERTICAL;
  return out;
}

/** The miss radius in metres for one round. `gun` multiplies it: a belt-fed gun on a bipod is not a carbine from the shoulder. */
export function missRadius(w: AiWorld, range: number, rank: RankDef, nerve: number, gun: number, shot: number): number {
  const p = w.player;
  const motion = p.evasion > 0 ? 1 + SPEED_TAX * p.evasion : STILL_SHARE;
  return (MISS_BASE + range * MISS_PER_METRE) * rank.aim * nerve * gun * motion * (shot === 0 ? SNAP_MISS : WALKED_MISS);
}

/** One round's direction, written to `out`. */
export function aimRound(
  w: AiWorld, track: TargetTrack, from: THREE.Vector3, out: THREE.Vector3, speed: number, rank: RankDef, nerve: number, gun: number, shot: number,
): THREE.Vector3 {
  interceptPoint(w, track, from, speed, rank.lead, _target);
  const miss = missRadius(w, from.distanceTo(_target), rank, nerve, gun, shot) * Math.sqrt(Math.random());
  randomUnit(_rand);
  _target.addScaledVector(_rand, miss);
  return out.subVectors(_target, from).normalize();
}
