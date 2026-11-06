/**
 * Six-legged walker. Legs step in two alternating tripods: each foot holds its world position while the body
 * moves over it, and swings to a predicted spot when it reaches the end of its range.
 */
import * as THREE from 'three';
import type { AnimAction, LocomotionInput } from '../../core/contracts';
import { SkitterBone as S } from '../rig';
import { Limb } from './ik';
import { Spring3 } from './springs';

const clamp = (v: number, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const damp = (a: number, b: number, r: number, dt: number) => a + (b - a) * (1 - Math.exp(-r * dt));
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

interface Leg {
  limb: Limb;
  hip: number;
  home: THREE.Vector3;
  pos: THREE.Vector3;
  from: THREE.Vector3;
  to: THREE.Vector3;
  planted: boolean;
  t: number;
  group: 0 | 1;
  rootOffset: THREE.Vector3;
}

const vA = new THREE.Vector3();
const vB = new THREE.Vector3();
const vC = new THREE.Vector3();
const eul = new THREE.Euler(0, 0, 0, 'YXZ');

export class SkitterAnimator {
  onFootstep: ((x: number, y: number, z: number, strength: number) => void) | null = null;
  treadmill = false;
  groundAt: ((x: number, y: number, z: number) => number) | null = null;

  private readonly legs: Leg[] = [];
  private readonly frame = new THREE.Vector3();
  private readonly last = new THREE.Vector3();
  private readonly vel = new THREE.Vector3();
  private readonly bodyQ = new THREE.Quaternion();
  private readonly tilt = new Spring3(120, 11);
  private readonly bodyY: number;
  private lastYaw = 0;
  private yawRate = 0;
  private needsHome = true;
  private speedIn = 0;
  private moveX = 0;
  private moveZ = 1;
  private group: 0 | 1 = 0;
  private groupClock = 0;
  private time = Math.random() * 10;
  private acc = 0;
  private tickCount = 0;
  private lunge = 0;

  constructor(private readonly bones: readonly THREE.Bone[], private readonly root: THREE.Object3D, private readonly hidden: (b: number) => boolean) {
    this.bodyY = bones[S.body]!.position.y;
    const defs = [[S.hipFL, 0], [S.hipML, 1], [S.hipBL, 0], [S.hipFR, 1], [S.hipMR, 0], [S.hipBR, 1]] as const;
    for (const [hip, group] of defs) {
      const a = bones[hip]!, b = bones[hip + 1]!, c = bones[hip + 2]!;
      const rootOffset = a.position.clone();
      const home = new THREE.Vector3().copy(a.position).add(b.position).add(c.position);
      home.y = -this.bodyY + 0.02;
      home.x *= 1.05;
      home.z *= 1.05;
      const out = vA.set(a.position.x, 0, a.position.z).normalize();
      this.legs.push({
        limb: new Limb(a, b, c, new THREE.Vector3(out.x * 0.4, 1, out.z * 0.4)), hip, home, group, rootOffset,
        pos: new THREE.Vector3(), from: new THREE.Vector3(), to: new THREE.Vector3(), planted: true, t: 1,
      });
    }
  }

  setLocomotion(i: LocomotionInput): void {
    this.speedIn = i.speed;
    this.moveX = i.moveX;
    this.moveZ = i.moveZ;
  }

  play(action: AnimAction): number {
    if (action === 'leap') { this.lunge = 1; return 0.5; }
    if (action === 'shoot') this.tilt.kick(-2, 0, 0);
    return 0.3;
  }

  flinch(_bone: number, dir: THREE.Vector3, mag: number): void {
    const yaw = this.root.rotation.y;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    this.tilt.kick((dir.x * s + dir.z * c) * mag * 7, 0, -(dir.x * c - dir.z * s) * mag * 7);
  }

  reset(): void {
    this.needsHome = true;
    this.tilt.clear();
    this.vel.set(0, 0, 0);
    this.lunge = 0;
  }

  private toWorld(v: THREE.Vector3, out: THREE.Vector3): void {
    const yaw = this.root.rotation.y;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    out.set(this.frame.x + v.x * c + v.z * s, this.frame.y + v.y + this.bodyY, this.frame.z - v.x * s + v.z * c);
  }

  update(dt: number, lod: number): void {
    this.acc += dt;
    const every = lod <= 0 ? 1 : lod === 1 ? 2 : 4;
    if (++this.tickCount % every !== 0) return;
    const step = this.acc;
    this.acc = 0;
    if (step <= 0) return;
    this.time += step;
    const yaw = this.root.rotation.y;
    if (this.needsHome) {
      this.needsHome = false;
      this.frame.copy(this.root.position);
      this.last.copy(this.frame);
      this.lastYaw = yaw;
      for (const l of this.legs) {
        this.toWorld(l.home, l.pos);
        l.pos.y = this.frame.y + 0.02;
        l.planted = true;
      }
    }
    const c = Math.cos(yaw), s = Math.sin(yaw);
    if (this.treadmill) {
      this.vel.set((this.moveX * c + this.moveZ * s) * this.speedIn, 0, (-this.moveX * s + this.moveZ * c) * this.speedIn);
      this.frame.addScaledVector(this.vel, step);
    } else {
      this.vel.x = damp(this.vel.x, (this.root.position.x - this.last.x) / step, 16, step);
      this.vel.z = damp(this.vel.z, (this.root.position.z - this.last.z) / step, 16, step);
      this.frame.copy(this.root.position);
    }
    this.last.copy(this.root.position);
    this.yawRate = damp(this.yawRate, wrap(yaw - this.lastYaw) / step, 12, step);
    this.lastYaw = yaw;
    this.tilt.step(step);
    this.lunge = Math.max(0, this.lunge - step * 2);

    const speed = Math.hypot(this.vel.x, this.vel.z);
    const stepTime = clamp(0.36 / (1 + speed * 0.2), 0.06, 0.3);
    this.groupClock += step;
    if (this.groupClock >= stepTime) {
      this.groupClock = 0;
      this.group = this.group === 0 ? 1 : 0;
      for (const l of this.legs) {
        if (l.group !== this.group || !l.planted || this.hidden(l.hip)) continue;
        this.toWorld(l.home, vA);
        vA.addScaledVector(this.vel, stepTime * 1.3);
        const need = Math.hypot(vA.x - l.pos.x, vA.z - l.pos.z);
        if (need < 0.09) continue;
        l.planted = false;
        l.t = 0;
        l.from.copy(l.pos);
        l.to.copy(vA);
        const g = this.groundAt?.(vA.x, this.frame.y + 1, vA.z);
        l.to.y = (g === undefined || g === null || Number.isNaN(g) ? this.frame.y : g) + 0.02;
      }
    }

    const fwd = this.vel.x * s + this.vel.z * c;
    const side = this.vel.x * c - this.vel.z * s;
    const bob = Math.sin(this.time * 34) * 0.006 * clamp(speed / 4) + Math.sin(this.time * 2.1) * 0.006;
    const body = this.bones[S.body]!;
    body.position.y = this.bodyY + bob - this.lunge * 0.09;
    eul.set(clamp(fwd * 0.03, -0.3, 0.3) + this.tilt.x * 0.3 - this.lunge * 0.4, this.yawRate * -0.05, clamp(-side * 0.04, -0.3, 0.3) + this.tilt.z * 0.3, 'YXZ');
    this.bodyQ.setFromEuler(eul);
    body.quaternion.copy(this.bodyQ);
    eul.set(0, Math.sin(this.time * 1.4) * 0.3, 0, 'YXZ');
    this.bones[S.head]!.quaternion.setFromEuler(eul);

    for (const l of this.legs) {
      if (this.hidden(l.hip)) continue;
      if (!l.planted) {
        l.t = Math.min(1, l.t + step / (stepTime * 0.9));
        const e = l.t * l.t * (3 - 2 * l.t);
        l.pos.lerpVectors(l.from, l.to, e);
        l.pos.y += Math.sin(Math.PI * l.t) * 0.13;
        if (l.t >= 1) {
          l.planted = true;
          this.onFootstep?.(l.pos.x, l.pos.y, l.pos.z, 0.08);
        }
      }
      vA.copy(l.rootOffset).applyQuaternion(this.bodyQ).add(body.position);
      const dx = l.pos.x - this.frame.x, dz = l.pos.z - this.frame.z;
      vB.set(dx * c - dz * s, l.pos.y - this.frame.y, dx * s + dz * c);
      vC.set(l.rootOffset.x * 0.5, 1, l.rootOffset.z * 0.5);
      l.limb.solve(vA, this.bodyQ, vB, vC);
    }
  }
}
