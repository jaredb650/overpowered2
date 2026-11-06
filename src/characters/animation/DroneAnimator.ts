/**
 * Hover flight. The body banks into acceleration like a real quadcopter, the gun stays on target, rotors spin
 * up with thrust, and a slow drift keeps it from sitting dead still in the air.
 */
import * as THREE from 'three';
import type { AnimAction, LocomotionInput } from '../../core/contracts';
import { DroneBone as D } from '../rig';
import { Spring3 } from './springs';

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const damp = (a: number, b: number, r: number, dt: number) => a + (b - a) * (1 - Math.exp(-r * dt));

const eul = new THREE.Euler(0, 0, 0, 'YXZ');
const qA = new THREE.Quaternion();
const qB = new THREE.Quaternion();
const Y = new THREE.Vector3(0, 1, 0);
const ROTORS = [D.rotorFL, D.rotorFR, D.rotorBL, D.rotorBR] as const;

export class DroneAnimator {
  onFootstep: ((x: number, y: number, z: number, strength: number) => void) | null = null;
  treadmill = false;
  groundAt: ((x: number, y: number, z: number) => number) | null = null;

  private readonly vel = new THREE.Vector3();
  private readonly last = new THREE.Vector3();
  private readonly tilt = new Spring3(90, 9);
  private readonly recoil = new Spring3(300, 22);
  private accelF = 0;
  private accelS = 0;
  private lastF = 0;
  private lastS = 0;
  private bankF = 0;
  private bankS = 0;
  private time = Math.random() * 20;
  private spin = 0;
  private valid = false;
  private aimYaw = 0;
  private aimPitch = 0;
  private speedIn = 0;
  private moveX = 0;
  private moveZ = 1;
  private acc = 0;
  private tickCount = 0;

  constructor(private readonly bones: readonly THREE.Bone[], private readonly root: THREE.Object3D, private readonly hidden: (b: number) => boolean) {}

  setLocomotion(i: LocomotionInput): void {
    this.speedIn = i.speed;
    this.moveX = i.moveX;
    this.moveZ = i.moveZ;
    this.aimYaw = i.aimYaw;
    this.aimPitch = i.aimPitch;
  }

  play(action: AnimAction): number {
    if (action === 'shoot') {
      this.recoil.kick(0, 0, -1.8);
      this.tilt.kick(-1.2, 0, 0);
      return 0.12;
    }
    return 0.3;
  }

  flinch(_bone: number, dir: THREE.Vector3, mag: number): void {
    const yaw = this.root.rotation.y;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    this.tilt.kick((dir.x * s + dir.z * c) * mag * 9, 0, -(dir.x * c - dir.z * s) * mag * 9);
  }

  reset(): void {
    this.valid = false;
    this.tilt.clear();
    this.recoil.clear();
    this.vel.set(0, 0, 0);
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
    const c = Math.cos(yaw), s = Math.sin(yaw);
    if (!this.valid) {
      this.valid = true;
      this.last.copy(this.root.position);
    }
    if (this.treadmill) {
      this.vel.set((this.moveX * c + this.moveZ * s) * this.speedIn, 0, (-this.moveX * s + this.moveZ * c) * this.speedIn);
    } else {
      this.vel.x = damp(this.vel.x, (this.root.position.x - this.last.x) / step, 12, step);
      this.vel.z = damp(this.vel.z, (this.root.position.z - this.last.z) / step, 12, step);
    }
    this.last.copy(this.root.position);
    const fwd = this.vel.x * s + this.vel.z * c;
    const side = this.vel.x * c - this.vel.z * s;
    this.accelF = damp(this.accelF, (fwd - this.lastF) / step, 8, step);
    this.accelS = damp(this.accelS, (side - this.lastS) / step, 8, step);
    this.lastF = fwd;
    this.lastS = side;
    this.bankF = damp(this.bankF, clamp(fwd * 0.05 + this.accelF * 0.05, -0.6, 0.6), 5, step);
    this.bankS = damp(this.bankS, clamp(-side * 0.05 - this.accelS * 0.05, -0.6, 0.6), 5, step);
    this.tilt.step(step);
    this.recoil.step(step);

    const body = this.bones[D.body]!;
    body.position.y = Math.sin(this.time * 1.7) * 0.05 + Math.sin(this.time * 3.1) * 0.015;
    body.position.x = Math.sin(this.time * 0.9) * 0.03;
    eul.set(this.bankF + this.tilt.x * 0.3 + Math.sin(this.time * 1.3) * 0.03, Math.sin(this.time * 0.7) * 0.04, this.bankS + this.tilt.z * 0.3 + Math.sin(this.time * 1.1) * 0.03, 'YXZ');
    body.quaternion.setFromEuler(eul);

    if (!this.hidden(D.gun)) {
      // The gun is gimballed: it undoes the bank and tracks the aim.
      qA.copy(body.quaternion).invert();
      eul.set(-this.aimPitch, this.aimYaw, 0, 'YXZ');
      qB.setFromEuler(eul);
      const gun = this.bones[D.gun]!;
      gun.quaternion.copy(qA).multiply(qB);
      gun.position.z = 0.12 + this.recoil.z * 0.05;
    }
    const thrust = 1 + Math.hypot(this.bankF, this.bankS) * 2;
    this.spin += step * 70 * thrust;
    for (const r of ROTORS) {
      if (this.hidden(r)) continue;
      this.bones[r]!.quaternion.setFromAxisAngle(Y, r % 2 ? this.spin : -this.spin);
    }
    if (!this.hidden(D.sensor)) {
      eul.set(-this.aimPitch * 0.5, this.aimYaw * 0.7, 0, 'YXZ');
      this.bones[D.sensor]!.quaternion.setFromEuler(eul);
    }
  }
}
