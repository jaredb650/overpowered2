/**
 * The radio or laser designator held up while targeting. It lives in the view scene with the weapons, and only
 * exists while the gun is holstered, so it has no interaction with the viewmodel rig.
 */
import * as THREE from 'three';
import type { Ctx } from '../../core/contracts';
import { damp } from '../../core/math';
import { ModelBuilder, type ModelMaterials } from '../modelkit';

export type DeviceKind = 'walkie' | 'designator';

/** Camera-space rest pose and how far below it the hand starts. */
const REST = new THREE.Vector3(0.27, -0.26, -0.52);
const DOWN = new THREE.Vector3(0.3, -0.72, -0.48);

const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _tilt = new THREE.Quaternion();
const _euler = new THREE.Euler();

function hand(b: ModelBuilder): void {
  // Gloved fist and forearm, so the device reads as held and not floating.
  b.box(0.085, 0.1, 0.075, '#1b1e22', { at: [0.02, -0.075, 0.015] });
  for (let i = 0; i < 4; i++) b.box(0.016, 0.018, 0.03, '#22262b', { at: [0.056, -0.04 - i * 0.024, 0.042] });
  b.cyl(0.05, 0.062, 0.34, 8, '#23282e', { at: [0.05, -0.27, 0.11], rot: [0.5, 0, -0.14] });
}

function walkie(color: string): ModelBuilder {
  const b = new ModelBuilder();
  b.box(0.08, 0.16, 0.042, '#2b2f33');
  b.box(0.066, 0.05, 0.002, '#101316', { at: [0, 0.038, 0.022] });
  for (let i = 0; i < 5; i++) b.box(0.05, 0.003, 0.002, '#0b0d0f', { at: [0, -0.018 - i * 0.008, 0.022] });
  b.cyl(0.0055, 0.0075, 0.15, 6, '#6a7076', { at: [0.024, 0.15, 0] });
  b.cyl(0.011, 0.011, 0.02, 8, '#17191c', { at: [-0.022, 0.089, 0] });
  b.box(0.012, 0.042, 0.016, '#3b4046', { at: [-0.046, 0.022, 0] });
  b.glow(new THREE.CylinderGeometry(0.0095, 0.0095, 0.005, 8), color, 3, { at: [0, -0.058, 0.023], rot: [Math.PI / 2, 0, 0] });
  b.glow(new THREE.BoxGeometry(0.056, 0.038, 0.001), color, 1.4, { at: [0, 0.038, 0.0235] });
  hand(b);
  return b;
}

function designator(color: string): ModelBuilder {
  const b = new ModelBuilder();
  b.box(0.075, 0.09, 0.19, '#2a2e33', { at: [0, 0.02, -0.03] });
  b.box(0.05, 0.035, 0.11, '#1a1d21', { at: [0, 0.082, -0.05] });
  b.cyl(0.03, 0.036, 0.1, 10, '#14171a', { at: [0, 0.02, -0.17], rot: [Math.PI / 2, 0, 0] });
  b.box(0.08, 0.012, 0.06, '#3a4047', { at: [0, -0.03, 0.02] });
  b.box(0.05, 0.1, 0.05, '#212529', { at: [0, -0.06, 0.03], rot: [0.18, 0, 0] });
  b.glow(new THREE.CylinderGeometry(0.02, 0.02, 0.004, 10), color, 5, { at: [0, 0.02, -0.222], rot: [Math.PI / 2, 0, 0] });
  b.glow(new THREE.BoxGeometry(0.04, 0.022, 0.001), color, 1.6, { at: [0, 0.082, 0.006] });
  hand(b);
  return b;
}

export class HeldDevice {
  private readonly walkie: Map<string, THREE.Group> = new Map();
  private readonly designators: Map<string, THREE.Group> = new Map();
  private current: THREE.Group | null = null;
  private raised = 0;
  private want = 0;
  private time = 0;
  /** Keyed by button colour, so each call-in keeps its colour identity. */
  private readonly root = new THREE.Group();

  constructor(private readonly ctx: Ctx, private readonly materials: ModelMaterials) {
    this.root.visible = false;
    ctx.render.viewScene.add(this.root);
  }

  private model(kind: DeviceKind, color: string): THREE.Group {
    const cache = kind === 'walkie' ? this.walkie : this.designators;
    let g = cache.get(color);
    if (!g) {
      g = this.materials.group(kind === 'walkie' ? walkie(color) : designator(color));
      g.visible = false;
      this.root.add(g);
      cache.set(color, g);
    }
    return g;
  }

  show(kind: DeviceKind, color: string): void {
    if (this.current) this.current.visible = false;
    this.current = this.model(kind, color);
    this.current.visible = true;
    this.root.visible = true;
    this.want = 1;
  }

  /** Lowers it. The caller unholsters the gun once `lowered` is true. */
  hide(): void {
    this.want = 0;
  }

  get lowered(): boolean {
    return this.want === 0 && this.raised < 0.08;
  }

  update(dt: number): void {
    if (!this.root.visible) return;
    this.time += dt;
    this.raised = damp(this.raised, this.want, 11, dt);
    if (this.want === 0 && this.raised < 0.02) {
      this.root.visible = false;
      return;
    }
    const cam = this.ctx.render.viewCamera;
    cam.updateMatrixWorld();
    const sway = Math.sin(this.time * 1.7) * 0.004;
    _pos.lerpVectors(DOWN, REST, this.raised);
    _pos.y += sway;
    _pos.applyMatrix4(cam.matrixWorld);
    this.root.position.copy(_pos);
    cam.getWorldQuaternion(_quat);
    _euler.set(0.12, -0.32, -0.08 + (1 - this.raised) * 0.5);
    _tilt.setFromEuler(_euler);
    this.root.quaternion.copy(_quat).multiply(_tilt);
  }

  clear(): void {
    this.want = 0;
    this.raised = 0;
    this.root.visible = false;
  }
}
