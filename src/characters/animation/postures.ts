/**
 * How a soldier holds his body when he is not simply standing: down behind cover, leaning out, hands in the air, on his
 * knees, curled up, hauling a casualty. A posture is a handful of numbers that bend the normal pose, so gait, flinches and
 * the wound reactions all keep running on top of it. Every number eases toward its target, so a change never pops.
 *
 * Distances are shares of body height, so one table fits a Trooper and a Brute. Angles are radians. +X is the body's left,
 * +Z its front, and hand offsets are in arm lengths from the shoulder, in chest axes, with X mirrored for the right hand.
 */
import * as THREE from 'three';

export type PostureName =
  | 'stand' | 'crouch' | 'cover' | 'peek' | 'leanLeft' | 'leanRight' | 'handsUp' | 'kneel' | 'cower' | 'flee' | 'drag' | 'revive' | 'downed'
  | 'hunched' | 'pistol';

interface Shape {
  /** Hips lowered. */
  drop: number;
  /** Hips moved forward, and to the left. */
  shift: number;
  sway: number;
  /** Forward bend of the spine, roll to the right, and the head's own pitch. */
  bend: number;
  roll: number;
  head: number;
  /** 0..1 lead foot out in front and trail knee down: how a rifleman kneels. */
  brace: number;
  /** 0..1 both knees on the floor. */
  kneel: number;
  /** How far the hands leave what they were doing, and where they go. */
  hands: number;
  x: number;
  y: number;
  z: number;
  /** Elbows out rather than down. */
  flare: number;
  /** Hands working: chest compressions, or shaking with fear. */
  pump: number;
  tremble: number;
  /** 1 leaves the right hand out of `hands`. */
  leftOnly: number;
}

const FLAT: Shape = {
  drop: 0, shift: 0, sway: 0, bend: 0, roll: 0, head: 0, brace: 0, kneel: 0, hands: 0, x: 0, y: 0, z: 0, flare: 0, pump: 0, tremble: 0, leftOnly: 0,
};

const SHAPES: Record<PostureName, Shape> = {
  stand: FLAT,
  crouch: { ...FLAT, drop: 0.16, bend: 0.28, brace: 0.7 },
  // Low enough to sit behind waist-high cover: the top of the head ends up under 1.15 m.
  cover: { ...FLAT, drop: 0.28, shift: -0.02, bend: 0.62, head: -0.18, brace: 1 },
  peek: { ...FLAT, drop: 0.09, bend: 0.14, brace: 0.45 },
  leanLeft: { ...FLAT, drop: 0.07, sway: 0.05, bend: 0.1, roll: -0.32, brace: 0.3 },
  leanRight: { ...FLAT, drop: 0.07, sway: -0.05, bend: 0.1, roll: 0.32, brace: 0.3 },
  handsUp: { ...FLAT, drop: 0.01, bend: -0.04, hands: 1, x: 0.34, y: 0.86, z: 0.16, flare: 1, tremble: 0.5 },
  kneel: { ...FLAT, drop: 0.25, shift: 0.01, bend: 0.08, head: 0.24, kneel: 1, hands: 1, x: 0.32, y: 0.78, z: 0.2, flare: 1, tremble: 1 },
  cower: { ...FLAT, drop: 0.3, shift: -0.03, bend: 0.85, head: 0.5, brace: 1, hands: 1, x: -0.12, y: 0.62, z: 0.34, flare: 0.8, tremble: 0.7 },
  flee: { ...FLAT, bend: 0.22, head: -0.1 },
  drag: { ...FLAT, drop: 0.14, shift: -0.05, bend: 0.72, head: -0.42, hands: 1, x: 0.12, y: -0.62, z: 0.72 },
  revive: { ...FLAT, drop: 0.26, bend: 0.5, head: 0.22, kneel: 0.8, hands: 1, x: 0.08, y: -0.52, z: 0.62, pump: 1 },
  // Its own object: a posture of exactly FLAT counts as being finished with, and this one is not.
  downed: { ...FLAT },
  // Folded over a hole in the belly. Hips back and low, because that is what takes the pull off it.
  hunched: { ...FLAT, drop: 0.09, shift: -0.03, bend: 0.82, head: -0.5, brace: 0.3 },
  // One arm out in front with a pistol at the end of it, with the other hand gone and hanging.
  pistol: { ...FLAT, drop: 0.03, bend: 0.1, roll: -0.08, hands: 1, x: 0.04, y: 0.1, z: 0.84, leftOnly: 1 },
};

const KEYS = Object.keys(FLAT) as (keyof Shape)[];
/** How close to flat counts as flat. */
const SETTLED = 0.002;
const EASE = 9;
const TREMBLE_RATE = 23;
const TREMBLE_SIZE = 0.012;
const PUMP_RATE = 9;
const PUMP_SIZE = 0.09;

const _at = new THREE.Vector3();

export class Postures {
  private name: PostureName = 'stand';
  private target: Shape = FLAT;
  private readonly now: Shape = { ...FLAT };
  private clock = 0;
  /** False for anyone just standing, which on the swarm's contract is everyone, so they pay nothing for any of this. */
  private active = false;

  /** Crawl's prone plan fits a man lying on the floor, so `downed` asks for it rather than repeating it. */
  get prone(): boolean {
    return this.name === 'downed';
  }

  get drop(): number {
    return this.now.drop;
  }

  get shift(): number {
    return this.now.shift;
  }

  get sway(): number {
    return this.now.sway;
  }

  get bend(): number {
    return this.now.bend;
  }

  get roll(): number {
    return this.now.roll;
  }

  get head(): number {
    return this.now.head;
  }

  set(name: PostureName): void {
    this.name = name;
    this.target = SHAPES[name];
    this.active = true;
  }

  reset(): void {
    this.name = 'stand';
    this.target = FLAT;
    this.active = false;
    Object.assign(this.now, FLAT);
  }

  step(dt: number): void {
    if (!this.active) return;
    this.clock += dt;
    const k = 1 - Math.exp(-EASE * dt);
    const { now, target } = this;
    let left = 0;
    for (let i = 0; i < KEYS.length; i++) {
      const key = KEYS[i]!;
      now[key] += (target[key] - now[key]) * k;
      left = Math.max(left, Math.abs(now[key]));
    }
    if (target === FLAT && left < SETTLED) this.reset();
  }

  /** Moves an ankle, in body space. Standing feet only: a man walking crouched keeps his stride. */
  foot(side: 1 | -1, height: number, moving: number, ankle: THREE.Vector3): void {
    const n = this.now;
    const still = 1 - moving;
    if (n.brace > 0.01) ankle.z += n.brace * still * height * (side > 0 ? 0.15 : -0.17);
    if (n.kneel > 0.01) {
      const k = n.kneel * still;
      ankle.x += (side * 0.06 * height - ankle.x) * k;
      ankle.z += (-0.24 * height - ankle.z) * k;
    }
  }

  /** Extra toe pitch: kneeling, the foot lies on its laces behind him. */
  toe(side: 1 | -1, moving: number): number {
    const n = this.now;
    return (1 - moving) * (n.kneel * 1.1 + (side < 0 ? n.brace * 0.8 : 0));
  }

  /** Moves a wrist target, in body space. */
  hand(side: 1 | -1, arm: number, chest: THREE.Quaternion, shoulder: THREE.Vector3, target: THREE.Vector3, pole: THREE.Vector3): void {
    const n = this.now;
    if (n.hands < 0.01 || (side < 0 && n.leftOnly > 0.5)) return;
    const shake = Math.sin(this.clock * TREMBLE_RATE + side) * TREMBLE_SIZE * n.tremble;
    const pump = Math.abs(Math.sin(this.clock * PUMP_RATE)) * PUMP_SIZE * n.pump;
    _at.set(side * n.x + shake, n.y + shake - pump, n.z).multiplyScalar(arm).applyQuaternion(chest).add(shoulder);
    target.lerp(_at, n.hands);
    // Elbows out to the sides, or they fold through the chest.
    pole.lerp(_at.set(side, 0.1 * n.flare, -0.2), n.hands * n.flare);
  }
}
