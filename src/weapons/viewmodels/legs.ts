/**
 * First-person legs, for the two moves where a body would see its own: a slide and a vault. Three rigid pieces a leg
 * (thigh, shin, boot), six draw calls, and only while one of those moves is playing.
 *
 * Poses are written in the body's frame, with the eye at the origin, and the whole rig turns against the look's pitch.
 * So level eyes see the boots at the bottom of a slide, and looking down shows the legs under them.
 */
import * as THREE from 'three';
import type { MovePose } from '../../core/contracts';
import { clamp } from '../../core/math';
import { bakeAo } from './kit/ao';
import { F } from './kit/finishes';
import type { Kit } from './kit/kit';
import { layerGeometry, type Mesher, type V3 } from './kit/mesher';

const THIGH = 0.44;
const SHIN = 0.43;
/** Where a hidden rig waits, below the view. */
const STOW = 0.7;
const LEGS_SLIDE = 1;

const _z = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _d = new THREE.Vector3();
const _k = new THREE.Vector3();
const _h = new THREE.Vector3();
const _a = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _toe = new THREE.Vector3();
const _up = new THREE.Vector3();

/** Orients a piece whose -Z runs down the limb and whose +Y is its front. */
function lookAlong(dir: THREE.Vector3, up: THREE.Vector3, out: THREE.Quaternion): void {
  _z.copy(dir).negate().normalize();
  _x.crossVectors(up, _z);
  if (_x.lengthSq() < 1e-6) _x.set(1, 0, 0);
  _x.normalize();
  _y.crossVectors(_z, _x);
  _m.makeBasis(_x, _y, _z);
  out.setFromRotationMatrix(_m);
}

/** A tapered limb from the origin down -Z, with cloth folds so it does not read as a pipe. */
function limb(m: Mesher, length: number, r0: number, r1: number, folds: number): void {
  const rings: V3[][] = [];
  const steps = 14;
  const n = 14;
  for (let i = 0; i <= steps; i++) {
    const k = i / steps;
    const z = -length + k * length;
    const r = r1 + (r0 - r1) * k;
    const ring: V3[] = [];
    for (let a = 0; a < n; a++) {
      const ang = (a / n) * Math.PI * 2;
      const fold = Math.sin(z * 60 + ang * 2 + Math.sin(ang * 3)) * folds;
      ring.push([Math.cos(ang) * (r + fold), Math.sin(ang) * (r * 0.92 + fold), z]);
    }
    rings.push(ring);
  }
  m.loft(rings, { capStart: true, capEnd: true });
}

function mesh(kit: Kit, build: (m: Mesher) => void, name: string): THREE.Mesh {
  const m = kit.mesher();
  build(m);
  bakeAo(m.tree, 0.9);
  const out = new THREE.Mesh(layerGeometry(m.tree.layers.get('hard')!, false), kit.mats.hard);
  out.frustumCulled = false;
  out.name = name;
  return out;
}

function thigh(m: Mesher): void {
  m.use(F.fabric);
  limb(m, THIGH, 0.088, 0.066, 0.0026);
  // Cargo pocket on the outside, and the strap of a drop holster.
  m.use(F.fabric);
  m.at([0.07, 0, -0.2], [0, 0, 0], () => m.box(0.03, 0.1, 0.13, 0.008));
  m.use(F.webbing);
  m.at([0, 0, -0.1], null, () => limb(m, 0.03, 0.09, 0.089, 0));
}

function shin(m: Mesher): void {
  m.use(F.fabric);
  limb(m, SHIN, 0.066, 0.05, 0.002);
  // Knee pad over the joint and a hard guard down the front of the shin.
  m.use(F.polymerGrey);
  m.at([0, 0.052, -0.02], [0.2, 0, 0], () => m.box(0.1, 0.035, 0.12, 0.012));
  m.use(F.carbon);
  m.at([0, 0.05, -0.21], [-0.03, 0, 0], () => m.box(0.078, 0.022, 0.24, 0.008));
  m.use(F.webbing);
  m.at([0, 0, -0.12], null, () => limb(m, 0.022, 0.064, 0.062, 0));
  m.at([0, 0, -0.3], null, () => limb(m, 0.022, 0.058, 0.056, 0));
}

/** Ankle at the origin, toe along -Z, sole along -Y. */
function boot(m: Mesher): void {
  m.use(F.leather);
  m.at([0, 0.03, 0.0], [Math.PI / 2, 0, 0], () => limb(m, 0.13, 0.058, 0.056, 0.001));
  m.at([0, -0.045, -0.07], null, () => m.box(0.1, 0.085, 0.25, 0.022));
  m.use(F.leatherGrey);
  m.at([0, -0.03, -0.185], null, () => m.box(0.104, 0.07, 0.07, 0.024));
  // Sole with a heel step and a tread that shows when the boots point at the camera in a slide.
  m.use(F.rubber);
  m.at([0, -0.098, -0.07], null, () => m.box(0.108, 0.026, 0.27, 0.008));
  m.at([0, -0.115, 0.03], null, () => m.box(0.1, 0.02, 0.07, 0.006));
  for (let i = 0; i < 5; i++) m.at([0, -0.113, -0.04 - i * 0.034], null, () => m.box(0.096, 0.012, 0.016, 0.003));
}

interface Leg {
  thigh: THREE.Mesh;
  shin: THREE.Mesh;
  boot: THREE.Mesh;
}

/** Quadratic curve through three body-space points, for a foot's path. */
function along(a: readonly number[], b: readonly number[], c: readonly number[], t: number, out: THREE.Vector3): THREE.Vector3 {
  const u = 1 - t;
  // The control point is placed so the curve passes through `b` at the middle.
  const bx = 2 * b[0]! - 0.5 * (a[0]! + c[0]!);
  const by = 2 * b[1]! - 0.5 * (a[1]! + c[1]!);
  const bz = 2 * b[2]! - 0.5 * (a[2]! + c[2]!);
  return out.set(
    u * u * a[0]! + 2 * u * t * bx + t * t * c[0]!,
    u * u * a[1]! + 2 * u * t * by + t * t * c[1]!,
    u * u * a[2]! + 2 * u * t * bz + t * t * c[2]!,
  );
}

/** Tuned by eye from the camera. Body frame: +X right, +Y up, -Z ahead, eye at the origin. */
export const LEG_POSES = {
  slide: {
    hipL: [-0.11, -0.47, 0.12], footL: [-0.15, -0.5, -0.86],
    hipR: [0.11, -0.47, 0.12], footR: [0.17, -0.44, -0.6],
    toe: [0, 0.86, -0.5],
  },
  /** Feet come from behind on the right, pass at the bottom right of the view, and go down to the landing. */
  vault: {
    hip: [0.27, -0.52, 0.06],
    from: [0.62, -0.52, 0.3], mid: [0.5, -0.27, -0.7], to: [0.14, -0.74, -0.58],
    /** The second foot follows this far behind, and this far to the side. */
    lag: 0.16, spread: 0.13,
  },
};

export class Legs {
  readonly root = new THREE.Group();
  private readonly legs: Leg[] = [];
  private time = 0;

  constructor(kit: Kit) {
    this.root.name = 'legs';
    for (const side of [-1, 1]) {
      const leg: Leg = {
        thigh: mesh(kit, thigh, 'thigh'),
        shin: mesh(kit, shin, 'shin'),
        boot: mesh(kit, boot, 'boot'),
      };
      // The pocket goes on the outside of each leg.
      leg.thigh.scale.x = side;
      this.legs.push(leg);
      this.root.add(leg.thigh, leg.shin, leg.boot);
    }
    this.root.visible = false;
  }

  update(pose: MovePose | null, pitch: number, dt: number): void {
    const w = pose ? pose.legsW : 0;
    if (!pose || w <= 0.01 || pose.legsMode === 0) {
      this.root.visible = false;
      return;
    }
    this.root.visible = true;
    this.time += dt;
    // Legs belong to the body, so they turn against the look. They rise from below the view rather than fading in.
    this.root.rotation.x = -clamp(pitch, -1.2, 1.2);
    const stow = (1 - w) * (1 - w) * STOW;
    const c = Math.cos(this.root.rotation.x);
    const s = Math.sin(this.root.rotation.x);
    this.root.position.set(0, -stow * c, -stow * s);

    if (pose.legsMode === LEGS_SLIDE) {
      const P = LEG_POSES.slide;
      // The floor is passing under them: a small shudder, out of step between the two.
      const j = Math.sin(this.time * 31) * 0.004;
      const j2 = Math.sin(this.time * 27 + 1.3) * 0.004;
      _toe.set(P.toe[0]!, P.toe[1]!, P.toe[2]!);
      this.place(this.legs[0]!, _h.set(P.hipL[0]!, P.hipL[1]!, P.hipL[2]!), _a.set(P.footL[0]!, P.footL[1]! + j, P.footL[2]!), _pole.set(-0.1, 1, 0), _toe);
      this.place(this.legs[1]!, _h.set(P.hipR[0]!, P.hipR[1]!, P.hipR[2]!), _a.set(P.footR[0]!, P.footR[1]! + j2, P.footR[2]!), _pole.set(0.2, 1, 0), _toe);
      return;
    }

    const P = LEG_POSES.vault;
    const p = pose.legsPhase;
    for (let i = 0; i < 2; i++) {
      const t = clamp(p * 1.12 - i * P.lag);
      along(P.from, P.mid, P.to, t * t * (3 - 2 * t), _a);
      _a.x += i * P.spread;
      _a.y -= i * 0.05;
      _h.set(P.hip[0]! + i * 0.14, P.hip[1]!, P.hip[2]!);
      // Toes lead the swing and drop for the landing.
      _toe.set(-0.35, 0.35 - 0.9 * t, -0.85);
      this.place(this.legs[i]!, _h, _a, _pole.set(0.5, 1, -0.1), _toe);
    }
  }

  /** Two-bone solve from hip to ankle. Out of reach, the hip follows the foot: it is off screen and never seen to move. */
  private place(leg: Leg, hip: THREE.Vector3, ankle: THREE.Vector3, pole: THREE.Vector3, toe: THREE.Vector3): void {
    _d.subVectors(ankle, hip);
    let d = _d.length();
    const reach = (THIGH + SHIN) * 0.985;
    if (d > reach) {
      hip.addScaledVector(_d, 1 - reach / d);
      _d.subVectors(ankle, hip);
      d = reach;
    }
    _d.normalize();
    const a = (THIGH * THIGH - SHIN * SHIN + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, THIGH * THIGH - a * a));
    _up.copy(pole).addScaledVector(_d, -pole.dot(_d)).normalize();
    _k.copy(hip).addScaledVector(_d, a).addScaledVector(_up, h);

    leg.thigh.position.copy(hip);
    lookAlong(_d.subVectors(_k, hip), _up, leg.thigh.quaternion);
    leg.shin.position.copy(_k);
    _d.subVectors(ankle, _k);
    lookAlong(_d, _up, leg.shin.quaternion);
    leg.boot.position.copy(ankle);
    // The top of the foot faces back up the shin.
    lookAlong(toe, _d.negate(), leg.boot.quaternion);
  }
}
