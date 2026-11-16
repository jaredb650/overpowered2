/** Shape of a weapon's first-person definition, and the per-frame state its animation reads and writes. */
import * as THREE from 'three';
import { clamp } from '../../core/math';
import { POSE_SIZE } from './arms';
import type { Model } from './kit/model';
import type { ModId, SwordMove } from '../../core/gameplay';

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
  /**
   * Aim down sights: the point of the sight, in the model's frame, that sits on the eye line when aimed (the tip of the
   * front post, the dot of a reflex sight), and how far in front of the eye it sits, meters. Unset: the gun has no ADS pose.
   */
  sight?: Tuple3;
  /** The rear sight, for iron sights: the gun is pitched so it lines up with `sight`. Unset on an optic: level. */
  rear?: Tuple3;
  relief?: number;
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
  /** What each weapon mod (src/weapons/mods.ts) looks like on this gun while it is fitted. */
  mods?: Partial<Record<ModId, ModLook>>;
  /** A part (flip-up irons) shown only while none of `mods` that brings a sight is fitted. */
  irons?: string;
}

/** Whether `def` shows its `irons` with `fitted` on: no optic among them. */
export function ironsUp(def: ViewDef, fitted: ReadonlySet<ModId> | null | undefined): boolean {
  for (const id in def.mods) if (def.mods[id as ModId]!.sight && fitted?.has(id as ModId)) return false;
  return true;
}

/** A fitted mod on the gun: its part (hidden until fitted), and the sight or muzzle it puts in place of the gun's own. */
export interface ModLook {
  part: string;
  /** A part of the gun's own that the mod takes the place of, hidden while it is fitted: the Trommel's six barrels. */
  hides?: string;
  /** Another part this mod moves along the bore while fitted, metres (+ is back): the Gimlet's short barrel brings its can back. */
  moves?: { readonly part: string; readonly z: number };
  /** Replace `sight`, `rear` (null for an optic: level) and `relief` while fitted. */
  sight?: Tuple3;
  rear?: Tuple3 | null;
  relief?: number;
  /** The socket the flash and tracers leave from while fitted. */
  muzzle?: string;
  /**
   * A part of the optic hidden once the gun is up at the eye (past `INNER_AT` of the aim): a magnified sight's tube and
   * objective, which would show through its eyepiece as a tunnel. Aimed, the eyepiece frames the picture and nothing else.
   */
  inner?: string;
  /** A magnified optic's eyepiece: a socket at the middle of its back glass and its clear radius. See VmUniforms.uScope. */
  eye?: { readonly socket: string; readonly radius: number };
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
  /** Extra offset applied after resolving, in view space. */
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
    this.fingerRate = 28;
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
  /** Horizontal player speed. */
  speed = 0;
  /** Weapon mods fitted now (src/weapons/mods.ts), for a clip that dresses itself by them. */
  mods: ReadonlySet<ModId> | null = null;
  /** The gun's second barrel is in use: the Gimlet's launcher is up. */
  alt = false;
  /** 0 to 1 as the sights come up to the eye, so a clip can hold still what would spoil the sight picture. */
  aim = 0;
  /**
   * The Autoraffica's smart aim (weapons.smartAim), eased by the rig: `smart` 0 to 1 while it is on, `lock` 0 to 1 while a head
   * is locked, and the head's bearing off the view's centre, radians: `lockYaw` to the left, `lockPitch` up.
   */
  smart = 0;
  lock = 0;
  lockYaw = 0;
  lockPitch = 0;

  /** The weapon's glow material. */
  glow(name: string, level: number): void {
    const m = this.model!.glows[name];
    if (!m) return;
    m.color.copy(m.userData.base as THREE.Color).multiplyScalar(level);
  }
}
