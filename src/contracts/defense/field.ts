/**
 * The rules of the fight round the fort as plain arithmetic, for `siege.ts`, `teams.ts` and the tests: which ring a man is in and
 * which wall stands between him and the player, what a satchel charge does to a wall, when an enemy mortar team may fire, and where
 * the player's own mortar teams drop their rounds.
 */
import * as THREE from 'three';
import type { WorldObjects } from '../../core/contracts';
import { ring, RINGS, ringAt, type RingId } from '../../world/map/fort/plan';

/** Field 0, outer yard 1, middle 2, core 3. */
export const DEPTH_RING: readonly (RingId | null)[] = [null, 'outer', 'middle', 'core'];

export const depthAt = (x: number, z: number): number => DEPTH_RING.indexOf(ringAt(x, z));

/** The ring a man at `depth` has to get through next, or null from the core. */
export const nextRing = (depth: number): RingId | null => DEPTH_RING[depth + 1] ?? null;

/** Which way is out from a point on or near a ring's side: the dominant axis. */
export function outward(x: number, z: number, out: THREE.Vector3): THREE.Vector3 {
  if (Math.abs(x) >= Math.abs(z)) out.set(Math.sign(x) || 1, 0, 0);
  else out.set(0, 0, Math.sign(z) || 1);
  return out;
}

/** True for a wall or gate centre on `id`'s wall line. */
export const onRing = (x: number, z: number, id: RingId): boolean => Math.abs(Math.max(Math.abs(x), Math.abs(z)) - ring(id).half) < 0.8;

// ---- satchel charges --------------------------------------------------------------------------------------------

export const SATCHEL = {
  /** Seconds kneeling at the wall to set it. */
  plant: 2.2,
  /** Seconds from set to bang. The blink and the ring on the floor are the warning. */
  fuse: 7,
  /** What the wall takes, through the same path as any blast: a gate (400) in one, a wall (300 a stage) in two. */
  wall: 420,
  /** Metres it reaches a piece. A charge is set against the face, so the near end of the piece takes nearly all of it. */
  reach: 3,
  /** Metres and damage to anyone standing there. */
  radius: 5,
  damage: 70,
  /** Metres out from the wall line he kneels to set it. */
  standOff: 0.9,
} as const;

/** The bang, on the walls. People take theirs through `combat.explode`. */
export function satchelBlast(objects: Pick<WorldObjects, 'damageExplosivesInRadius'>, at: THREE.Vector3): void {
  objects.damageExplosivesInRadius(at, SATCHEL.reach, SATCHEL.wall, 'satchel');
}

// ---- enemy mortar teams -----------------------------------------------------------------------------------------

export const FIELD_MORTAR = {
  /** Seconds at the pit, standing still, before the first round. Moving starts it again. */
  setup: 4,
  /** Seconds between salvos, and rounds a salvo. */
  reload: 11,
  salvo: 3,
  /** Metres from the pit's middle a crewman has to be to work the tube. */
  atPit: 2.6,
  radius: 6,
  damage: 50,
  flight: 3.6,
  scatter: 4,
} as const;

export type CrewStage = 'moving' | 'setup' | 'ready';

/** A tube and its crew, as a clock. They cannot fire while moving: any move, and the setup starts again. */
export class MortarCrew {
  stage: CrewStage = 'moving';
  clock = 0;
  salvos = 0;

  /** True on the frame a salvo goes out. */
  tick(dt: number, atPit: boolean, moving: boolean): boolean {
    if (!atPit || moving) {
      this.stage = 'moving';
      this.clock = FIELD_MORTAR.setup;
      return false;
    }
    this.clock -= dt;
    if (this.stage === 'moving') this.stage = 'setup';
    if (this.clock > 0) return false;
    this.stage = 'ready';
    this.clock = FIELD_MORTAR.reload;
    this.salvos++;
    return true;
  }
}

// ---- the player's mortar teams ----------------------------------------------------------------------------------

export const TEAM_MORTAR = {
  /** Seconds between rounds, either way of this. */
  every: [8, 13] as const,
  /** The nearest a round lands to the outer wall's line, scatter and all. */
  clear: 9,
  /** Where random rounds go when nothing out there is worth one: between the clear band and the fence. */
  far: 100,
  scatter: 3.5,
  radius: 6,
  damage: 80,
  flight: 4.6,
  /** Metres within which other bodies count toward a group. */
  group: 7,
  /** What a vehicle is worth, in bodies. */
  vehicle: 4,
} as const;

export interface MortarCandidate {
  x: number;
  z: number;
  vehicle: boolean;
}

/** Inside the walls, or too close to them for a round to be safe. */
export const tooClose = (x: number, z: number): boolean => Math.max(Math.abs(x), Math.abs(z)) < RINGS[0]!.half + TEAM_MORTAR.clear;

/** Pushes a point straight out until it is clear of the walls. */
export function clearOfWalls(p: THREE.Vector3): THREE.Vector3 {
  const d = Math.max(Math.abs(p.x), Math.abs(p.z));
  const need = RINGS[0]!.half + TEAM_MORTAR.clear;
  if (d >= need) return p;
  if (d < 1e-3) return p.set(need + 0.01, p.y, 0);
  // A centimetre over, so rounding cannot leave it on the line.
  const k = (need + 0.01) / d;
  p.x *= k;
  p.z *= k;
  return p;
}

/**
 * Where a team's next round goes: at random, but weighted toward groups and vehicles out in the field, and never inside the walls.
 * With nothing worth a round it goes somewhere in the field anyway: the owner wants a constant bombardment to watch.
 */
export function pickMortarTarget(list: readonly MortarCandidate[], roll: () => number, out: THREE.Vector3): THREE.Vector3 {
  let total = 0;
  const weights: number[] = [];
  for (const c of list) {
    if (tooClose(c.x, c.z)) {
      weights.push(0);
      continue;
    }
    let near = 0;
    for (const o of list) if (o !== c && Math.hypot(o.x - c.x, o.z - c.z) < TEAM_MORTAR.group) near++;
    const w = (c.vehicle ? TEAM_MORTAR.vehicle : 1) + near * near;
    weights.push(w);
    total += w;
  }
  if (total > 0) {
    let r = roll() * total;
    let chosen = 0;
    for (let i = 0; i < list.length; i++) {
      if (weights[i]! <= 0) continue;
      chosen = i;
      r -= weights[i]!;
      if (r <= 0) break;
    }
    out.set(list[chosen]!.x, 0, list[chosen]!.z);
  } else {
    const a = roll() * Math.PI * 2;
    const r = RINGS[0]!.half + TEAM_MORTAR.clear + roll() * (TEAM_MORTAR.far - RINGS[0]!.half - TEAM_MORTAR.clear);
    out.set(Math.sin(a) * r, 0, Math.cos(a) * r);
  }
  const a = roll() * Math.PI * 2;
  const s = roll() * TEAM_MORTAR.scatter;
  out.x += Math.sin(a) * s;
  out.z += Math.cos(a) * s;
  return clearOfWalls(out);
}
