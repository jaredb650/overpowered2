/**
 * Arterial spurts: the Kiln's hose (fx/layers/hose.ts, commit a7789c9) in blood, out of a neck or a limb's stump. Each
 * spurt fires a chain of globs that fall under gravity, drawn as one rope that bends as the body moves. It beats: a
 * strong pulse and an echo, the pause stretching and the push falling as the pressure goes, until it stops. Where a glob
 * lands it leaves blood, through the blood field's own drops.
 *
 * Pooled: `SpurtTuning.max` at once across the world, the oldest given back first.
 */
import * as THREE from 'three';
import { CG, type Ctx, type RayHit } from '../core/contracts';
import { clamp } from '../core/math';
import type { BloodField } from './blood';

export const SpurtTuning = {
  max: 12,
  /** Globs each spurt can have in the air, and how many it fires a second. */
  globs: 30,
  rate: 34,
  /** Seconds a glob lives if it lands on nothing. */
  life: 0.9,
  /** Jet speed in m/s at no pressure and at full, on a strong beat. */
  slow: 1.2,
  fast: 5.2,
  gravity: 9.81,
  /** One heartbeat in seconds at the start; it stretches by this share as the pressure goes. */
  beat: 0.62,
  stretch: 0.9,
  /** Globs further apart than this are two strands. */
  gap: 0.35,
  /**
   * Rays a frame, across every spurt, along the globs' paths: wherever one meets a wall, the floor or a prop, the jet
   * stains it (`BloodField.bleedAt`), one stain a spurt per `stainEvery` seconds, so a sweeping jet paints a trail.
   */
  raysPerFrame: 20,
  stainEvery: 0.08,
};

const STRIDE = 6;
const G = 8;

class Spurt {
  alive = false;
  serial = 0;
  target: THREE.Object3D | null = null;
  owner: THREE.Object3D | null = null;
  readonly offset = new THREE.Vector3();
  readonly axis = new THREE.Vector3();
  /** A lean of its own, so a neck does not jet straight up and fall back down its own column. */
  readonly lean = new THREE.Vector3();
  started = 0;
  ends = 0;
  power = 1;
  acc = 0;
  /** Glob ring: x y z vx vy vz age alive. */
  readonly globs = new Float32Array(SpurtTuning.globs * G);
  head = 0;
  fired = 0;
  floor = -1e4;
  nextGround = 0;
  emitting = false;
  readonly nozzle = new THREE.Vector3();
  readonly lastNozzle = new THREE.Vector3();
  hasLast = false;
  drops = 0;
  nextStain = 0;
  phase = 0;
}

const _a = new THREE.Vector3();
const _d = new THREE.Vector3();
const _o = new THREE.Vector3();
const _r = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _down = new THREE.Vector3(0, -1, 0);
const _hit: RayHit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0, surface: 'concrete', collider: null };

/** How hard the heart is pushing at `phase` (0..1) of a beat: a strong pulse, then a smaller echo. */
export function heartbeat(phase: number): number {
  return 0.55 + 0.45 * Math.exp(-phase * 6) + 0.2 * Math.exp(-Math.abs(phase - 0.32) * 18);
}

export class SpurtField {
  private readonly spurts: Spurt[] = Array.from({ length: SpurtTuning.max }, () => new Spurt());
  private serial = 0;
  private readonly chain: Float32Array;
  private drawn = false;
  private firstSpurt = 0;
  private putCount = 0;
  private putFirst = true;
  private putHasDir = false;
  private putLx = 0;
  private putLy = 0;
  private putLz = 0;
  private putPdx = 0;
  private putPdy = 0;
  private putPdz = 0;
  /** Stains laid so far, for checks. */
  stains = 0;

  /**
   * `tail` is more rope for the same layer, drawn after the spurts' own: the ribbons flying pieces trail (trail.ts). It
   * says how many chain points it may add, and adds them.
   */
  constructor(
    private readonly ctx: Ctx, private readonly blood: BloodField,
    private readonly tail: { readonly points: number; append(chain: Float32Array, count: number): number } | null = null,
  ) {
    this.chain = new Float32Array((SpurtTuning.max * (SpurtTuning.globs + 1) + (tail?.points ?? 0)) * STRIDE);
  }

  /**
   * A spurt out of `target` at `offset`, along `axis` (both in its frame), for `seconds`. `owner` is the body's root: when
   * it leaves the scene the spurt stops. `power` scales the push: 1 a limb, more for a neck. Returns a handle id for
   * damping (hand clutching a wound) or stopping (dressed/cauterised).
   */
  start(target: THREE.Object3D, offset: THREE.Vector3, axis: THREE.Vector3, owner: THREE.Object3D, seconds: number, power = 1, leanScale = 0.8): number {
    let s = this.spurts.find(o => !o.alive);
    if (!s) {
      s = this.spurts[0]!;
      for (const o of this.spurts) if (o.serial < s.serial) s = o;
    }
    s.alive = true;
    s.emitting = true;
    s.serial = ++this.serial;
    s.target = target;
    s.owner = owner;
    s.offset.copy(offset);
    s.axis.copy(axis).normalize();
    s.lean.set(Math.sin(s.serial * 2.4), 0, Math.cos(s.serial * 2.4)).multiplyScalar(leanScale);
    s.started = this.ctx.time.elapsed;
    s.ends = s.started + seconds;
    s.power = power;
    s.acc = 0;
    s.fired = 0;
    s.nextGround = 0;
    s.floor = -1e4;
    s.hasLast = false;
    s.drops = 0;
    s.nextStain = 0;
    s.phase = 0;
    for (let i = 0; i < SpurtTuning.globs; i++) s.globs[i * G + 7] = 0;
    return s.serial;
  }

  /** Updates jet pressure of a running spurt by handle (e.g. clutching hand cuts carotid jet in half). */
  setPower(id: number, power: number): void {
    if (id <= 0) return;
    for (const s of this.spurts) {
      if (s.alive && s.serial === id) {
        s.power = Math.max(0.05, power);
        return;
      }
    }
  }

  /** Stops emission on a running spurt by handle (dressed/cauterised); globs already airborne finish falling. */
  stop(id: number): void {
    if (id <= 0) return;
    for (const s of this.spurts) {
      if (s.alive && s.serial === id) {
        s.ends = Math.min(s.ends, this.ctx.time.elapsed);
        s.emitting = false;
        return;
      }
    }
  }

  /** Caps remaining pumping time on a spurt (e.g. heart stops on death, pressure fades quickly). */
  clampRemaining(id: number, maxSeconds: number, powerScale = 0.7): void {
    if (id <= 0) return;
    const limit = this.ctx.time.elapsed + maxSeconds;
    for (const s of this.spurts) {
      if (s.alive && s.serial === id) {
        if (s.ends > limit) s.ends = limit;
        s.power = Math.max(0.15, s.power * powerScale);
        return;
      }
    }
  }

  private warming = 0;

  /** Draws the blood rope once, out of sight, so its program is compiled at load. */
  warm(): void {
    this.warming = 2;
  }

  /** Spurts still pumping. */
  get pumping(): number {
    let n = 0;
    for (const s of this.spurts) if (s.alive && s.emitting) n++;
    return n;
  }

  /** Spurts with anything still in the air. */
  get live(): number {
    let n = 0;
    for (const s of this.spurts) if (s.alive) n++;
    return n;
  }

  private putPoint(x: number, y: number, z: number, age: number, serial: number): void {
    const c = this.chain;
    const o = this.putCount * STRIDE;
    let split = false;
    if (!this.putFirst) {
      const dx = x - this.putLx, dy = y - this.putLy, dz = z - this.putLz;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > SpurtTuning.gap) {
        split = true;
      } else if (this.putHasDir && dist > 1e-4) {
        // A fresh systolic pulse overtaking the slower diastolic tail folds the ribbon backward: split into clean arcs.
        const inv = 1 / dist;
        if (this.putPdx * dx * inv + this.putPdy * dy * inv + this.putPdz * dz * inv < 0.1) split = true;
      }
      if (!split && dist > 1e-4) {
        this.putPdx = dx / dist;
        this.putPdy = dy / dist;
        this.putPdz = dz / dist;
        this.putHasDir = true;
      } else if (split) {
        this.putHasDir = false;
      }
    }
    c[o] = x;
    c[o + 1] = y;
    c[o + 2] = z;
    c[o + 3] = age;
    c[o + 4] = serial * 0.35;
    c[o + 5] = this.putFirst || split ? 1 : 0;
    this.putLx = x;
    this.putLy = y;
    this.putLz = z;
    this.putFirst = false;
    this.putCount++;
  }

  update(dt: number): void {
    const now = this.ctx.time.elapsed;
    const t = SpurtTuning;
    this.putCount = 0;
    const c = this.chain;
    let rays = t.raysPerFrame;
    let activeLeft = 0;
    for (const s of this.spurts) if (s.alive) activeLeft++;
    // Each frame a different spurt asks first, so the ray budget is shared out over them.
    this.firstSpurt = (this.firstSpurt + 1) % this.spurts.length;
    for (let si = 0; si < this.spurts.length; si++) {
      const s = this.spurts[(si + this.firstSpurt) % this.spurts.length]!;
      if (!s.alive) continue;
      let spurtRays = activeLeft > 0 ? Math.ceil(rays / activeLeft) : 0;
      activeLeft--;
      const gone = s.owner !== null && s.owner.parent === null;
      const life = clamp((now - s.started) / Math.max(1e-3, s.ends - s.started));
      const pressure = (1 - life) ** 1.3;
      s.emitting = !gone && now < s.ends && s.target !== null;
      if (s.emitting) {
        s.target!.updateWorldMatrix(true, false);
        s.nozzle.copy(s.offset).applyMatrix4(s.target!.matrixWorld);
        s.target!.getWorldQuaternion(_q);
        // The cut end whips about: two slow sways out of step, so the jet never holds still.
        const k = now - s.started;
        _d.copy(s.axis).applyQuaternion(_q).add(s.lean);
        _d.x += Math.sin(k * 7.3 + s.serial) * 0.18;
        _d.y += Math.sin(k * 5.1 + s.serial * 2) * 0.14;
        _d.z += Math.cos(k * 6.2 + s.serial) * 0.18;
        _d.normalize();
        // The body's own motion goes into every glob, so a jet from a falling man falls with him.
        _a.set(0, 0, 0);
        if (s.hasLast && dt > 0) _a.subVectors(s.nozzle, s.lastNozzle).divideScalar(dt).clampLength(0, 6);
        s.lastNozzle.copy(s.nozzle);
        s.hasLast = true;
        const period = t.beat * (1 + life * t.stretch);
        if (dt > 0) s.phase = (s.phase + dt / period) % 1;
        const speed = (t.slow + (t.fast - t.slow) * pressure) * heartbeat(s.phase) * s.power;
        s.acc += dt * t.rate;
        while (s.acc >= 1) {
          s.acc -= 1;
          const g = s.head * G;
          s.head = (s.head + 1) % t.globs;
          s.globs[g] = s.nozzle.x;
          s.globs[g + 1] = s.nozzle.y;
          s.globs[g + 2] = s.nozzle.z;
          s.globs[g + 3] = _d.x * speed + _a.x;
          s.globs[g + 4] = _d.y * speed + _a.y;
          s.globs[g + 5] = _d.z * speed + _a.z;
          s.globs[g + 6] = 0;
          s.globs[g + 7] = 1;
          s.fired++;
        }
      }
      if (now >= s.nextGround) {
        s.nextGround = now + 0.3;
        _a.copy(s.emitting ? s.nozzle : s.lastNozzle);
        _a.y += 0.3;
        if (this.ctx.physics.raycastInto(_a, _down, 4, CG.World, _hit)) s.floor = _hit.point.y;
      }
      // Fly, and land. Walk oldest-first so globs nearing walls or the floor are raycasted before brand-new nozzle globs.
      let any = false;
      s.drops = 0;
      for (let k = 0; k < t.globs; k++) {
        const i = (s.head + k) % t.globs;
        const g = i * G;
        if (s.globs[g + 7] === 0) continue;
        _o.set(s.globs[g]!, s.globs[g + 1]!, s.globs[g + 2]!);
        s.globs[g + 4] = s.globs[g + 4]! - t.gravity * dt;
        s.globs[g] = s.globs[g]! + s.globs[g + 3]! * dt;
        s.globs[g + 1] = s.globs[g + 1]! + s.globs[g + 4]! * dt;
        s.globs[g + 2] = s.globs[g + 2]! + s.globs[g + 5]! * dt;
        s.globs[g + 6] = s.globs[g + 6]! + dt;
        // Along this frame's step: what the jet hits, it stains, and that glob is spent.
        if (spurtRays > 0 && rays > 0) {
          _r.set(s.globs[g]! - _o.x, s.globs[g + 1]! - _o.y, s.globs[g + 2]! - _o.z);
          const len = _r.length();
          if (len > 1e-4) {
            rays--;
            spurtRays--;
            if (this.ctx.physics.raycastInto(_o, _r.multiplyScalar(1 / len), len + 0.03, CG.World, _hit)) {
              s.globs[g + 7] = 0;
              if (now >= s.nextStain) {
                s.nextStain = now + t.stainEvery;
                _vel.set(s.globs[g + 3]!, s.globs[g + 4]!, s.globs[g + 5]!);
                this.blood.bleedAt(_hit.point, _hit.normal, 0.1 + 0.45 * pressure * s.power, _vel);
                this.stains++;
              }
              continue;
            }
          }
        }
        if (s.globs[g + 1]! <= s.floor) {
          s.globs[g + 7] = 0;
          // A drop of the blood field's where it lands, which stains the floor there. One a spurt a frame is plenty.
          if (s.drops++ === 0) this.blood.droplet(s.globs[g]!, s.floor + 0.05, s.globs[g + 2]!, s.globs[g + 3]! * 0.1, -0.5, s.globs[g + 5]! * 0.1, 0.05 + 0.07 * pressure * s.power);
          continue;
        }
        if (s.globs[g + 6]! > t.life) {
          s.globs[g + 7] = 0;
          continue;
        }
        any = true;
      }
      if (!any && !s.emitting) {
        s.alive = false;
        s.target = null;
        s.owner = null;
        continue;
      }
      // The chain, newest first: the nozzle, then each glob in the order it left.
      this.putFirst = true;
      this.putHasDir = false;
      this.putLx = 0;
      this.putLy = 0;
      this.putLz = 0;
      this.putPdx = 0;
      this.putPdy = 0;
      this.putPdz = 0;
      if (s.emitting) this.putPoint(s.nozzle.x, s.nozzle.y, s.nozzle.z, 0, s.fired);
      for (let k = 1; k <= t.globs; k++) {
        const i = (s.head - k + t.globs) % t.globs;
        const g = i * G;
        if (s.globs[g + 7] === 0) {
          // A glob gone in the middle of the chain is a break in it.
          this.putFirst = true;
          this.putHasDir = false;
          continue;
        }
        this.putPoint(s.globs[g]!, s.globs[g + 1]!, s.globs[g + 2]!, s.globs[g + 6]!, s.fired - k);
      }
    }
    let count = this.putCount;
    if (this.tail) count = this.tail.append(c, count);
    if (this.warming > 0 && count === 0) {
      // A short rope far under the world, for a frame or two: the layer's program compiles now, not on the first neck
      // opened or the first body burst in a fight.
      this.warming--;
      for (let i = 0; i < 3; i++) {
        c[i * STRIDE] = i * 0.1;
        c[i * STRIDE + 1] = -500 - i * 0.2;
        c[i * STRIDE + 2] = 0;
        c[i * STRIDE + 3] = i * 0.1;
        c[i * STRIDE + 4] = i * 0.35;
        c[i * STRIDE + 5] = i === 0 ? 1 : 0;
      }
      count = 3;
    }
    if (count > 0 || this.drawn) this.ctx.fx.bloodHose?.(c, count);
    this.drawn = count > 0;
  }

  clear(): void {
    for (const s of this.spurts) {
      s.alive = false;
      s.emitting = false;
      s.target = null;
      s.owner = null;
    }
    this.serial = 0;
    this.stains = 0;
    this.warming = 0;
    this.firstSpurt = 0;
    if (this.drawn) this.ctx.fx.bloodHose?.(this.chain, 0);
    this.drawn = false;
  }
}
