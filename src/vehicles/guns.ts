/**
 * The two guns the player actually sees: the M134 on its door pintle and the Harrow's chin cannon.
 *
 * Both are ordinary world objects and not viewmodels. A gun on an aircraft has to be there for someone watching from the
 * ground too, and in the world scene the muzzle needs no correction for a second camera: a tracer leaves it exactly.
 * Barrels run along -Z, so a gun takes the same yaw and pitch as the camera behind it.
 */
import * as THREE from 'three';
import { dampAngle, damp } from '../core/math';
import type { Point } from '../progression/callins/airframe';
import { ModelBuilder, type ModelMaterials } from '../progression/modelkit';

export interface GunSpec {
  name: string;
  /** What stays put on the mount. */
  build(b: ModelBuilder): void;
  /** What moves when it fires: a Gatling's barrel cluster, or a cannon's barrel on its slide. */
  moving(b: ModelBuilder): void;
  /** In the gun's own space. */
  muzzle: Point;
  /** Barrels this far behind the aim, as a rate: the weight the gun has when it is swung. */
  follow: number;
  /** How fast a slide runs back out after it recoils. */
  return: number;
  scale?: number;
}

export class Gun {
  /** The pivot. Parent to the scene only, like `Airframe.root`. */
  readonly root = new THREE.Group();
  private readonly moving: THREE.Group;
  private yaw = 0;
  private pitch = 0;
  private slide = 0;

  constructor(materials: ModelMaterials, scene: THREE.Scene, private readonly spec: GunSpec) {
    const fixed = new ModelBuilder();
    spec.build(fixed);
    const moving = new ModelBuilder();
    spec.moving(moving);
    this.moving = materials.group(moving, materials.nearby);
    this.root.name = spec.name;
    this.root.rotation.order = 'YXZ';
    this.root.scale.setScalar(spec.scale ?? 1);
    this.root.add(materials.group(fixed, materials.nearby), this.moving);
    this.root.visible = false;
    scene.add(this.root);
  }

  /** Sets the aim at once, as when the player first takes the seat. */
  snap(yaw: number, pitch: number): void {
    this.yaw = yaw;
    this.pitch = pitch;
  }

  /** Call once a frame. The gun swings after the aim, and the slide runs back out. */
  point(pivot: THREE.Vector3, yaw: number, pitch: number, dt: number): void {
    const { root, spec } = this;
    this.yaw = dampAngle(this.yaw, yaw, spec.follow, dt);
    this.pitch = damp(this.pitch, pitch, spec.follow, dt);
    this.slide = damp(this.slide, 0, spec.return, dt);
    root.visible = true;
    root.position.copy(pivot);
    root.rotation.set(this.pitch, this.yaw, 0);
    this.moving.position.z = this.slide;
  }

  /** Radians to turn the moving part about the bore. */
  turn(radians: number): void {
    this.moving.rotation.z += radians;
  }

  recoil(metres: number): void {
    this.slide = metres;
  }

  /** In world space, valid from the last `point`. */
  muzzle(out: THREE.Vector3): THREE.Vector3 {
    const m = this.spec.muzzle;
    return out.set(m[0], m[1], m[2]).multiply(this.root.scale).applyQuaternion(this.root.quaternion).add(this.root.position);
  }

  /** Which way it is pointing. */
  bore(out: THREE.Vector3): THREE.Vector3 {
    return out.set(0, 0, -1).applyQuaternion(this.root.quaternion);
  }

  hide(): void {
    this.root.visible = false;
  }
}

const IRON = '#3a4148';
const GUNMETAL = '#4d565f';
const WORN = '#6a747d';
const GRIP = '#22262b';
const BRASS = '#a4874c';

const ALONG_Z: readonly [number, number, number] = [Math.PI / 2, 0, 0];

function m134Body(b: ModelBuilder): void {
  // Pintle, cradle and receiver. Thick enough to read as heavy from the back, which is the only side the gunner sees.
  b.cyl(0.05, 0.06, 0.42, 10, IRON, { at: [0, -0.3, 0] });
  b.box(0.2, 0.05, 0.3, IRON, { at: [0, -0.1, 0.02] });
  for (const s of [1, -1]) b.box(0.03, 0.14, 0.2, IRON, { at: [s * 0.1, -0.03, 0.02] });
  b.box(0.13, 0.15, 0.32, GUNMETAL, { at: [0, 0, 0.04] });
  b.cyl(0.075, 0.075, 0.13, 12, GUNMETAL, { at: [0, 0, -0.17], rot: ALONG_Z });
  b.box(0.08, 0.1, 0.16, WORN, { at: [0.11, 0.03, 0.06] });
  b.cyl(0.04, 0.04, 0.2, 10, IRON, { at: [-0.1, 0.05, 0.05], rot: ALONG_Z });
  // Spade grips, the thing the gunner's hands are on.
  b.box(0.24, 0.03, 0.05, IRON, { at: [0, -0.02, 0.27] });
  for (const s of [1, -1]) {
    b.box(0.03, 0.03, 0.1, IRON, { at: [s * 0.11, -0.02, 0.22] });
    b.cyl(0.018, 0.018, 0.14, 8, GRIP, { at: [s * 0.11, 0.06, 0.28] });
  }
  b.box(0.05, 0.03, 0.02, BRASS, { at: [0, 0.015, 0.26] });
  // The ring sight stands up over the receiver.
  b.box(0.012, 0.09, 0.012, IRON, { at: [0, 0.12, -0.08] });
  b.solid(new THREE.TorusGeometry(0.045, 0.004, 6, 18), IRON, { at: [0, 0.19, -0.08] });
  // Feed chute down to the can, in a curve of short links.
  for (let i = 0; i < 6; i++) {
    const a = i / 5;
    b.box(0.09, 0.03, 0.11, i % 2 ? WORN : GUNMETAL, { at: [-0.1 - a * 0.26, 0.02 - a * a * 0.44, 0.05 + a * 0.1], rot: [0, 0.2, -0.3 - a * 0.9] });
  }
}

const BARRELS = 6;

function m134Barrels(b: ModelBuilder): void {
  for (let i = 0; i < BARRELS; i++) {
    const a = (i / BARRELS) * Math.PI * 2;
    b.cyl(0.0135, 0.0135, 0.76, 8, i % 2 ? IRON : GUNMETAL, { at: [Math.cos(a) * 0.044, Math.sin(a) * 0.044, -0.6], rot: ALONG_Z });
  }
  for (const z of [-0.34, -0.72, -0.96]) b.cyl(0.066, 0.066, 0.024, 12, IRON, { at: [0, 0, z], rot: ALONG_Z });
}

export const M134: GunSpec = {
  name: 'm134',
  build: m134Body,
  moving: m134Barrels,
  muzzle: [0, 0, -1],
  follow: 26,
  return: 30,
};

function cannonBody(b: ModelBuilder): void {
  b.box(0.62, 0.34, 0.62, IRON, { at: [0, 0, 0.1] });
  b.box(0.3, 0.26, 1.15, GUNMETAL, { at: [0, 0.02, -0.28] });
  b.cyl(0.11, 0.11, 0.5, 10, IRON, { at: [0, 0.02, -0.92], rot: ALONG_Z });
  // The belt runs up over the shoulder into the hull.
  for (let i = 0; i < 5; i++) b.box(0.2, 0.04, 0.16, i % 2 ? WORN : GUNMETAL, { at: [0.26, 0.1 + i * 0.1, 0.28 + i * 0.08], rot: [0.7, 0, 0.1] });
}

function cannonBarrel(b: ModelBuilder): void {
  b.cyl(0.058, 0.058, 1.7, 10, IRON, { at: [0, 0.02, -1.8], rot: ALONG_Z });
  b.cyl(0.09, 0.09, 0.2, 10, GUNMETAL, { at: [0, 0.02, -2.62], rot: ALONG_Z });
  b.box(0.2, 0.05, 0.1, IRON, { at: [0, 0.02, -2.68] });
}

export const CHIN_CANNON: GunSpec = {
  name: 'chin-cannon',
  build: cannonBody,
  moving: cannonBarrel,
  muzzle: [0, 0.02, -2.75],
  follow: 16,
  return: 16,
  scale: 1.15,
};
