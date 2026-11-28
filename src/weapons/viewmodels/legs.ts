/**
 * First-person legs, for the two moves where a body would see its own: a slide and a vault. Three rigid pieces a leg
 * (thigh, shin, boot), six draw calls, and only while one of those moves is playing.
 *
 * Poses are written in the body's frame, with the eye at the origin, and the whole rig turns against the look's pitch.
 * So level eyes see the boots at the bottom of a slide, and looking down shows the legs under them.
 */
import * as THREE from 'three';
import type { MovePose } from '../../core/contracts';
import type { KickMove } from '../../core/gameplay';
import { clamp, lerp } from '../../core/math';
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
  /** Sparta kick: right boot whips up and explodes straight through center-screen with flat sole slamming forward. */
  kick: {
    hip: [0.15, -0.46, 0.14],
    start: [0.22, -0.86, 0.10],
    chamber: [0.11, -0.24, -0.32],
    thrust: [0.00, -0.07, -1.04],
    peak: [-0.02, -0.04, -1.12],
    stow: [0.22, -0.90, 0.12],
    toeStart: [0, 0.42, -0.90],
    toeThrust: [-0.04, 0.94, -0.34],
  },
  /** Head stomp: boot rises huge into upper-center frame, then crushes visibly inside lower-center viewport. */
  stomp: {
    hip: [0.15, -0.36, 0.16],
    start: [0.20, -0.78, 0.06],
    liftMid: [0.09, -0.08, -0.26],
    poised: [0.03, 0.16, -0.58],
    crush: [0.01, -0.24, -0.78],
    stow: [0.20, -0.86, 0.10],
    toePoised: [0, 0.45, -0.89],
    toeCrush: [0, 0.24, -0.97],
  },
  /** Flying double-leg dropkick: BOTH boots shoot out together across center-screen, flat soles forward. */
  diveKick: {
    hipL: [-0.15, -0.44, 0.16],
    hipR: [0.15, -0.44, 0.16],
    startL: [-0.22, -0.86, 0.10],
    startR: [0.22, -0.86, 0.10],
    chamberL: [-0.14, -0.28, -0.28],
    chamberR: [0.14, -0.26, -0.30],
    thrustL: [-0.14, -0.10, -1.04],
    thrustR: [0.14, -0.07, -1.08],
    stowL: [-0.22, -0.90, 0.12],
    stowR: [0.22, -0.90, 0.12],
    toeStart: [0, 0.45, -0.89],
    toeThrust: [0, 0.92, -0.39],
  },
  /** Slide tackle: left leg braced low while right shin sweeps violently low across the screen at ankle height. */
  slideKick: {
    hipL: [-0.13, -0.46, 0.12],
    hipR: [0.14, -0.46, 0.12],
    footL: [-0.22, -0.44, -0.72],
    fromR: [0.50, -0.42, -0.50],
    midR: [0.02, -0.30, -1.04],
    toR: [-0.42, -0.38, -0.80],
    stowR: [0.20, -0.76, -0.20],
  },
};

const setLegVisible = (leg: Leg, visible: boolean): void => {
  leg.thigh.visible = visible;
  leg.shin.visible = visible;
  leg.boot.visible = visible;
};

export class Legs {
  readonly root = new THREE.Group();
  private readonly legs: Leg[] = [];
  private time = 0;
  private kickMove: KickMove | null = null;
  private kickTime = 0;
  private kickDuration = 0;

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

  /** Starts a first-person leg strike animation over `seconds`. */
  kick(move: KickMove, seconds: number): void {
    this.kickMove = move;
    this.kickTime = 0;
    this.kickDuration = Math.max(seconds, 0.12);
  }

  /** Cancels any kick/stomp animation in progress (e.g. holster or reset). */
  cancelKick(): void {
    this.kickMove = null;
    this.kickTime = 0;
    this.kickDuration = 0;
  }

  get kicking(): boolean {
    return this.kickMove !== null;
  }

  /** 0..1 weapon dip factor while the leg is in view, so the held gun whips aside cleanly without swapping. */
  get kickDip(): number {
    if (!this.kickMove || this.kickDuration <= 0) return 0;
    const u = clamp(this.kickTime / this.kickDuration);
    const holdEnd = this.kickMove === 'diveKick' || this.kickMove === 'tornadoL' || this.kickMove === 'tornadoR' || this.kickMove === 'stomp'
      ? 0.66
      : 0.56;
    if (u < 0.09) return u / 0.09;
    if (u < holdEnd) return 1;
    return clamp((1 - u) / (1 - holdEnd));
  }

  update(pose: MovePose | null, pitch: number, dt: number): void {
    if (this.kickMove) {
      this.kickTime += dt;
      if (this.kickTime >= this.kickDuration) {
        this.kickMove = null;
      } else {
        this.time += dt;
        this.updateKick(this.kickMove, clamp(this.kickTime / this.kickDuration));
        return;
      }
    }

    const w = pose ? pose.legsW : 0;
    if (!pose || w <= 0.01 || pose.legsMode === 0) {
      this.root.visible = false;
      return;
    }
    this.root.visible = true;
    setLegVisible(this.legs[0]!, true);
    setLegVisible(this.legs[1]!, true);
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

  /** Animates the leg(s) in camera space for every movement-intertwined kick move. */
  private updateKick(move: KickMove, u: number): void {
    this.root.visible = true;
    this.root.rotation.set(0, 0, 0);
    this.root.position.set(0, 0, 0);

    if (move === 'kick' || move === 'backKick') {
      setLegVisible(this.legs[0]!, false);
      setLegVisible(this.legs[1]!, true);
      const P = LEG_POSES.kick;
      const lift = move === 'backKick' ? 0.05 : 0;
      if (u < 0.14) {
        const t = 1 - (1 - u / 0.14) ** 4;
        along(P.start, P.chamber, P.thrust, t, _a);
        _a.y += lift * t;
        _toe.set(
          lerp(P.toeStart[0]!, P.toeThrust[0]!, t),
          lerp(P.toeStart[1]!, P.toeThrust[1]!, t),
          lerp(P.toeStart[2]!, P.toeThrust[2]!, t),
        );
      } else if (u < 0.42) {
        const t = (u - 0.14) / 0.28;
        const hold = Math.sin(t * Math.PI);
        const jitter = Math.sin(this.time * 140) * 0.011 * (1 - t);
        _a.set(
          lerp(P.thrust[0]!, P.peak[0]!, hold) + jitter,
          lerp(P.thrust[1]!, P.peak[1]!, hold) + lift + jitter * 0.7 - 0.03 * t,
          lerp(P.thrust[2]!, P.peak[2]!, hold),
        );
        _toe.set(P.toeThrust[0]!, P.toeThrust[1]!, P.toeThrust[2]!);
      } else {
        const t = (u - 0.42) / 0.58;
        const e = Math.pow(t, 1.5);
        along(P.thrust, P.chamber, P.stow, e, _a);
        _toe.set(
          lerp(P.toeThrust[0]!, P.toeStart[0]!, e),
          lerp(P.toeThrust[1]!, P.toeStart[1]!, e),
          lerp(P.toeThrust[2]!, P.toeStart[2]!, e),
        );
      }
      _h.set(P.hip[0]!, P.hip[1]!, P.hip[2]!);
      this.place(this.legs[1]!, _h, _a, _pole.set(0.22, 1, 0.14), _toe);
      return;
    }

    if (move === 'diveKick') {
      // Double-leg flying dropkick: both boots snap out side-by-side straight through center-screen!
      setLegVisible(this.legs[0]!, true);
      setLegVisible(this.legs[1]!, true);
      const P = LEG_POSES.diveKick;
      const flutter = Math.sin(this.time * 95) * 0.012;
      for (let i = 0; i < 2; i++) {
        const isR = i === 1;
        const hip = isR ? P.hipR : P.hipL;
        const start = isR ? P.startR : P.startL;
        const chamber = isR ? P.chamberR : P.chamberL;
        const thrust = isR ? P.thrustR : P.thrustL;
        const stow = isR ? P.stowR : P.stowL;
        const lag = isR ? 0 : 0.025;
        const uu = clamp((u - lag) / (1 - lag));
        if (uu < 0.14) {
          const t = 1 - (1 - uu / 0.14) ** 4;
          along(start, chamber, thrust, t, _a);
          _toe.set(
            lerp(P.toeStart[0]!, P.toeThrust[0]!, t),
            lerp(P.toeStart[1]!, P.toeThrust[1]!, t),
            lerp(P.toeStart[2]!, P.toeThrust[2]!, t),
          );
        } else if (uu < 0.68) {
          const t = (uu - 0.14) / 0.54;
          const sag = Math.sin(t * Math.PI) * 0.03;
          _a.set(
            thrust[0]! + (isR ? 1 : -1) * 0.015 * Math.sin(t * Math.PI),
            thrust[1]! + sag + flutter * (isR ? 1 : -1),
            thrust[2]! - 0.05 * Math.sin(t * Math.PI),
          );
          _toe.set(P.toeThrust[0]!, P.toeThrust[1]!, P.toeThrust[2]!);
        } else {
          const t = (uu - 0.68) / 0.32;
          const e = Math.pow(t, 1.45);
          along(thrust, chamber, stow, e, _a);
          _toe.set(
            lerp(P.toeThrust[0]!, P.toeStart[0]!, e),
            lerp(P.toeThrust[1]!, P.toeStart[1]!, e),
            lerp(P.toeThrust[2]!, P.toeStart[2]!, e),
          );
        }
        _h.set(hip[0]!, hip[1]!, hip[2]!);
        this.place(this.legs[i]!, _h, _a, _pole.set(isR ? 0.25 : -0.25, 1, 0.16), _toe);
      }
      return;
    }

    if (move === 'slideKick') {
      // Slide tackle leg sweep: left boot stays low as anchor while right shin whips low across the bottom of view!
      setLegVisible(this.legs[0]!, true);
      setLegVisible(this.legs[1]!, true);
      const P = LEG_POSES.slideKick;
      const shake = Math.sin(this.time * 42) * 0.006;
      _h.set(P.hipL[0]!, P.hipL[1]!, P.hipL[2]!);
      _a.set(P.footL[0]!, P.footL[1]! + shake, P.footL[2]!);
      _toe.set(-0.2, 0.82, -0.54);
      this.place(this.legs[0]!, _h, _a, _pole.set(-0.35, 1, 0.1), _toe);

      if (u < 0.56) {
        const t = 1 - (1 - u / 0.56) ** 3;
        along(P.fromR, P.midR, P.toR, t, _a);
        _toe.set(lerp(0.6, -0.75, t), 0.36, -0.62);
      } else {
        const t = (u - 0.56) / 0.44;
        const e = t * t;
        _a.set(
          lerp(P.toR[0]!, P.stowR[0]!, e),
          lerp(P.toR[1]!, P.stowR[1]!, e),
          lerp(P.toR[2]!, P.stowR[2]!, e),
        );
        _toe.set(-0.2, 0.6, -0.75);
      }
      _h.set(P.hipR[0]!, P.hipR[1]!, P.hipR[2]!);
      this.place(this.legs[1]!, _h, _a, _pole.set(0.45, 0.85, 0.2), _toe);
      return;
    }

    if (move === 'roundhouseL' || move === 'roundhouseR' || move === 'tornadoL' || move === 'tornadoR') {
      // Roundhouse (grounded whip) & Tornado (high dramatic aerial spinning whip):
      // Kicking LEFT swings the RIGHT leg from +X -> -X across screen; kicking RIGHT swings the LEFT leg from -X -> +X.
      const kickRight = move === 'roundhouseR' || move === 'tornadoR';
      const tornado = move === 'tornadoL' || move === 'tornadoR';
      const dir = kickRight ? 1 : -1;
      const strikeIdx = kickRight ? 0 : 1;
      const otherIdx = 1 - strikeIdx;
      setLegVisible(this.legs[strikeIdx]!, true);
      // Tornado briefly flashes the chambering knee at the bottom as you spin into the whip.
      const showChamber = tornado && u < 0.26;
      setLegVisible(this.legs[otherIdx]!, showChamber);
      if (showChamber) {
        const ct = Math.sin((u / 0.26) * Math.PI);
        _h.set(dir * 0.16, -0.46, 0.14);
        _a.set(dir * lerp(0.24, 0.08, ct), lerp(-0.82, -0.34, ct), lerp(0.06, -0.42, ct));
        _toe.set(dir * 0.3, 0.35, -0.88);
        this.place(this.legs[otherIdx]!, _h, _a, _pole.set(dir * 0.45, 1, 0.1), _toe);
      }

      const spanX = tornado ? 0.72 : 0.58;
      const yPeak = tornado ? 0.04 : -0.08;
      const zPeak = tornado ? -1.08 : -0.94;
      const fromX = -dir * spanX;
      const toX = dir * spanX;
      const windEnd = tornado ? 0.18 : 0.12;
      const whipEnd = tornado ? 0.58 : 0.48;

      if (u < windEnd) {
        const t = 1 - (1 - u / windEnd) ** 3;
        _a.set(lerp(-dir * 0.26, fromX, t), lerp(-0.84, yPeak - 0.14, t), lerp(0.08, -0.48, t));
        _toe.set(-dir * 0.65, 0.28, -0.70);
      } else if (u < whipEnd) {
        const t = (u - windEnd) / (whipEnd - windEnd);
        const s = 1 - (1 - t) ** 3;
        const arc = Math.sin(s * Math.PI);
        _a.set(
          lerp(fromX, toX, s),
          yPeak + arc * (tornado ? 0.08 : 0.03) - (1 - arc) * 0.10,
          lerp(-0.48, -0.68, s) + arc * (zPeak + 0.58),
        );
        _toe.set(dir * lerp(-0.4, 0.92, s), 0.18, lerp(-0.85, -0.34, s));
      } else {
        const t = (u - whipEnd) / (1 - whipEnd);
        const e = Math.pow(t, 1.45);
        _a.set(lerp(toX, -dir * 0.22, e), lerp(yPeak - 0.10, -0.90, e), lerp(-0.68, 0.10, e));
        _toe.set(dir * 0.4, 0.35, -0.84);
      }
      _h.set(-dir * 0.16, -0.44, 0.14);
      this.place(this.legs[strikeIdx]!, _h, _a, _pole.set(-dir * 0.85, 0.55, 0.15), _toe);
      return;
    }

    if (move === 'wallKickL' || move === 'wallKickR') {
      // Wall-run kick: pushes off wall side with inner boot and drives outer flying side-kick diagonally across screen!
      const toRight = move === 'wallKickR';
      const dir = toRight ? 1 : -1;
      const leadIdx = toRight ? 1 : 0;
      const pushIdx = 1 - leadIdx;
      setLegVisible(this.legs[leadIdx]!, true);
      setLegVisible(this.legs[pushIdx]!, u < 0.46);

      if (u < 0.46) {
        const pt = u / 0.46;
        _h.set(-dir * 0.16, -0.46, 0.14);
        _a.set(-dir * lerp(0.32, 0.56, pt), lerp(-0.42, -0.86, pt), lerp(-0.48, 0.12, pt));
        _toe.set(-dir * 0.65, 0.35, -0.65);
        this.place(this.legs[pushIdx]!, _h, _a, _pole.set(-dir * 0.5, 0.9, 0.1), _toe);
      }

      if (u < 0.15) {
        const t = 1 - (1 - u / 0.15) ** 4;
        _a.set(lerp(dir * 0.22, -dir * 0.08, t), lerp(-0.82, -0.06, t), lerp(0.08, -1.06, t));
        _toe.set(dir * 0.35, 0.85, -0.38);
      } else if (u < 0.58) {
        const t = (u - 0.15) / 0.43;
        const hold = Math.sin(t * Math.PI);
        _a.set(
          lerp(-dir * 0.08, dir * 0.22, t),
          -0.06 + hold * 0.04,
          -1.06 - hold * 0.05,
        );
        _toe.set(dir * 0.45, 0.82, -0.35);
      } else {
        const t = (u - 0.58) / 0.42;
        const e = Math.pow(t, 1.5);
        _a.set(lerp(dir * 0.22, dir * 0.24, e), lerp(-0.08, -0.90, e), lerp(-1.02, 0.12, e));
        _toe.set(0, 0.45, -0.88);
      }
      _h.set(dir * 0.16, -0.44, 0.14);
      this.place(this.legs[leadIdx]!, _h, _a, _pole.set(dir * 0.38, 0.95, 0.15), _toe);
      return;
    }

    // Head stomp: boot looms huge in upper-center view (~125 ms), crashes visibly into lower-center viewport right onto
    // the skull (~35 ms), holds & grinds violently inside frame so you clearly watch your boot crush their head, then retracts.
    setLegVisible(this.legs[0]!, false);
    setLegVisible(this.legs[1]!, true);
    const P = LEG_POSES.stomp;
    if (u < 0.30) {
      const t = 1 - (1 - u / 0.30) ** 3;
      along(P.start, P.liftMid, P.poised, t, _a);
      _toe.set(P.toePoised[0]!, P.toePoised[1]!, P.toePoised[2]!);
    } else if (u < 0.38) {
      // Accelerating downward skull smash straight into lower-center of screen.
      const t = ((u - 0.30) / 0.08) ** 3;
      _a.set(
        lerp(P.poised[0]!, P.crush[0]!, t),
        lerp(P.poised[1]!, P.crush[1]!, t),
        lerp(P.poised[2]!, P.crush[2]!, t),
      );
      _toe.set(
        lerp(P.toePoised[0]!, P.toeCrush[0]!, t),
        lerp(P.toePoised[1]!, P.toeCrush[1]!, t),
        lerp(P.toePoised[2]!, P.toeCrush[2]!, t),
      );
    } else if (u < 0.70) {
      // Heavy visible crush-grind hold inside the lower-center frame while the skull bursts underneath.
      const t = (u - 0.38) / 0.32;
      const grind = Math.sin(this.time * 165) * 0.013 * (1 - t);
      _a.set(
        P.crush[0]! + grind,
        P.crush[1]! - 0.045 * Math.sin(t * Math.PI),
        P.crush[2]! - 0.025 * (1 - t),
      );
      _toe.set(P.toeCrush[0]!, P.toeCrush[1]!, P.toeCrush[2]!);
    } else {
      const t = (u - 0.70) / 0.30;
      const e = Math.pow(t, 1.5);
      _a.set(
        lerp(P.crush[0]!, P.stow[0]!, e),
        lerp(P.crush[1]!, P.stow[1]!, e),
        lerp(P.crush[2]!, P.stow[2]!, e),
      );
      _toe.set(P.toeCrush[0]!, P.toeCrush[1]!, P.toeCrush[2]!);
    }
    _h.set(P.hip[0]!, P.hip[1]!, P.hip[2]!);
    this.place(this.legs[1]!, _h, _a, _pole.set(0.28, 1, 0.24), _toe);
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
