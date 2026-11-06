/** Shape of a weapon's first-person definition, and the per-frame state its animation reads and writes. */
import * as THREE from 'three';
import { clamp } from '../../core/math';
import { POSE_SIZE } from './arms';
import type { Model } from './kit/model';
import type { SwordMove } from '../../core/gameplay';

export type Tuple3 = readonly [number, number, number];

export interface RecoilSpec {
  /** Peak travel toward the shooter, meters. */
  back: number;
  /** Peak lift, meters. */
  lift: number;
  /** Peak muzzle climb, radians. */
  pitch: number;
  /** Random yaw and roll ranges, radians. */
  yaw: number;
  roll: number;
  /** Spring stiffness and damping: a high omega is what makes recoil snap instead of float. */
  omega: number;
  zeta: number;
}

export interface HandBind {
  socket: string;
  pose: Float32Array;
}

export interface ViewDef {
  id: string;
  model: Model;
  /** Hip position of the model origin in view space, and its rotation. */
  pos: Tuple3;
  rot: Tuple3;
  recoil: RecoilSpec;
  right: HandBind | null;
  left: HandBind | null;
  /** Per-frame: moves parts, adds to `a.gun`, and steers the hands. */
  animate(a: Anim): void;
  /** Redraws readouts. Called only when the ammo count or charge bucket changes. */
  readout?(a: Anim): void;
  /** Heat added per shot at strength 1. */
  heatPerShot?: number;
  /** Radians per second at full charge, for spinning barrels. */
  spinMax?: number;
}

const MAX_STEPS = 10;

/**
 * Where one hand wants to be this frame. Clips queue steps instead of resolving immediately, because a socket can
 * sit on a part the same clip is still moving; the rig resolves them once the part matrices are final.
 */
export class HandCtl {
  /** Current base socket; null hides the arm. */
  base: string | null = null;
  readonly names: string[] = new Array<string>(MAX_STEPS).fill('');
  readonly weights = new Float32Array(MAX_STEPS);
  steps = 0;
  readonly pose = new Float32Array(POSE_SIZE);
  /** Extra offset applied after resolving, gun space is not implied: view space. */
  readonly nudge = new THREE.Vector3();
  /** Multiplies the finger-blend speed. Fast snaps for grabs. */
  fingerRate = 28;
  /** Trigger finger pull 0..1. */
  trigger = 0;

  begin(bind: HandBind | null): void {
    this.base = bind ? bind.socket : null;
    this.steps = 0;
    this.nudge.set(0, 0, 0);
    this.trigger = 0;
    if (bind) this.pose.set(bind.pose);
  }

  /** Blends toward a socket. Later calls win, so a clip reads as a sequence of moves. */
  to(socket: string, w: number): this {
    if (w > 0 && this.steps < MAX_STEPS) {
      this.names[this.steps] = socket;
      this.weights[this.steps++] = clamp(w);
    }
    return this;
  }

  shape(pose: Float32Array, w: number): this {
    if (w <= 0) return this;
    const k = clamp(w);
    for (let i = 0; i < POSE_SIZE; i++) this.pose[i] = this.pose[i]! + (pose[i]! - this.pose[i]!) * k;
    return this;
  }
}

export class Anim {
  dt = 0;
  time = 0;
  /** Seconds since the last shot. Large when the gun has not fired. */
  sinceFire = 99;
  /** Counts shots since equip; drives anything that indexes, like cylinder rotation. */
  shots = 0;
  /** Strength of the last shot. */
  strength = 1;
  /** 0..1 through the reload, or -1. */
  reload = -1;
  /** Seconds the reload was given. */
  reloadSeconds = 1;
  /** 0..1 through the draw; 1 when settled. */
  draw = 1;
  /** Seconds since the draw finished. */
  sinceDraw = 99;
  charge = 0;
  /** Accumulated spin angle, radians. */
  spin = 0;
  /** Current spin rate, radians per second. */
  spinRate = 0;
  mag = 0;
  magSize = 1;
  reserve = 0;
  /** Sustained-fire heat, 0..1. */
  heat = 0;
  /** Current sword move, or null. */
  swing: SwordMove | null = null;
  /** 0..1 through the move, then past 1 while it recovers. */
  swingP = 0;
  swingSeconds = 0.25;
  /** Seconds a finished move takes to ease back to guard. */
  recover = 0.16;
  /** 0..1 guard weight, for the Sword's own bookkeeping. */
  guard = 0;
  /** 0..1 through a parry reaction, or -1. */
  parry = -1;
  parrySeconds = 0.16;
  /** 0..1 glow on the sword, separate from gun heat. */
  bladeHeat = 0;
  /** Additive transform around the model origin, written by the clip. */
  readonly gunP = new THREE.Vector3();
  readonly gunR = new THREE.Vector3();
  readonly left = new HandCtl();
  readonly right = new HandCtl();
  parts: Record<string, THREE.Group> = {};
  model: Model | null = null;
  /** View-model state the clips may want to react to. */
  speed = 0;
  grounded = true;

  part(name: string): THREE.Group {
    return this.parts[name]!;
  }

  /** The weapon's glow material. */
  glow(name: string, level: number): void {
    const m = this.model!.glows[name];
    if (!m) return;
    m.color.copy(m.userData.base as THREE.Color).multiplyScalar(level);
  }
}
