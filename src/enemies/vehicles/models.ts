/**
 * The Outpost's machines, drawn from the same kit as the player's aircraft: flat-shaded metal, vertex paint, a merged mesh per moving
 * part. All original designs, in one drab paint with one hazard stripe, because these belong to one army and came out of one shed.
 *
 * Nose along +Z, up +Y, so the left side is +X. Sizes follow the part boxes in data.ts: what you can see is what you can hit.
 *
 *   root      turns with the road and stays flat on it, and carries the wheels and tracks
 *   body      rides on the springs
 *   turret    turns on its ring, and `barrel` lifts and recoils inside it
 *
 * `Fleet` builds each model once and hands out clones that share geometry, so a spawn is a few Object3Ds and no merging.
 */
import * as THREE from 'three';
import { plate } from '../../progression/callins/ac130Model';
import type { AirframeSpec, RotorSpec } from '../../progression/callins/airframe';
import { ModelBuilder, type ModelMaterials } from '../../progression/modelkit';
import type { GunSpec } from '../../vehicles/guns';
import { hull } from '../../vehicles/loft';
import type { VehicleKind } from '../../campaign/types';

export type ChopperMount = 'chin' | 'podLeft' | 'podRight' | 'exhaust';

const DRAB = '#4b5140';
const DRAB_LIGHT = '#5e6450';
const DRAB_DARK = '#343a2e';
const CANVAS = '#54523e';
const CANVAS_DARK = '#3f3e30';
const STEEL = '#23272a';
const IRON = '#343a3e';
const WORN = '#6b7074';
const TYRE = '#17191b';
const GLASS = '#0a1014';
const HAZARD = '#b08a24';
const BOLT = '#7e8285';

const ALONG_Z: readonly [number, number, number] = [Math.PI / 2, 0, 0];
const ALONG_X: readonly [number, number, number] = [0, 0, Math.PI / 2];

/** The tank's turret ring and the gun's trunnion above it, in model space. */
export const TURRET_RING = [0, 1.98, -0.15] as const;
export const TRUNNION = [0, 0.56, 1.5] as const;
export const CANNON_MUZZLE = [0, 0, 5.6] as const;
/** Where each machine's roof gun swings from. */
export const PINTLE: Readonly<Record<'humvee' | 'truck' | 'tank', readonly [number, number, number]>> = {
  humvee: [0, 2.42, -0.7],
  truck: [0, 3.18, 1.6],
  tank: [-0.62, 3.42, -0.8],
};
const WHEEL_RADIUS = { humvee: 0.52, truck: 0.62 } as const;

function wheel(b: ModelBuilder, radius: number, width: number, x: number): void {
  b.cyl(radius, radius, width, 14, TYRE, { at: [x, 0, 0], rot: ALONG_X });
  b.cyl(radius * 0.56, radius * 0.56, width + 0.05, 10, IRON, { at: [x, 0, 0], rot: ALONG_X });
  // Lugs and bolts, or a turning wheel looks like a stopped one.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    b.box(width + 0.04, radius * 0.2, radius * 0.3, '#24272a', { at: [x, Math.cos(a) * radius * 0.92, Math.sin(a) * radius * 0.92], rot: [a, 0, 0] });
    b.box(width + 0.09, 0.05, 0.05, BOLT, { at: [x, Math.cos(a) * radius * 0.36, Math.sin(a) * radius * 0.36] });
  }
}

function roofGunRing(b: ModelBuilder, at: readonly [number, number, number], radius: number): void {
  b.solid(new THREE.TorusGeometry(radius, 0.07, 6, 18), IRON, { at, rot: [Math.PI / 2, 0, 0] });
}

function scoutBody(b: ModelBuilder): void {
  // The tub, with the arches cut by leaving them out.
  b.box(2.1, 0.46, 4.9, DRAB_DARK, { at: [0, 0.82, 0] });
  b.solid(hull([
    { z: 0.72, w: 1.08, top: 1.62, bottom: 0.98 },
    { z: 1.6, w: 1.06, top: 1.5, bottom: 0.98 },
    { z: 2.48, w: 0.98, top: 1.28, bottom: 0.98 },
  ]), DRAB);
  // A slatted grille and a brush guard: the one face everyone remembers.
  for (let i = 0; i < 5; i++) b.box(1.4, 0.03, 0.02, STEEL, { at: [0, 1.04 + i * 0.05, 2.5] });
  b.box(2.06, 0.1, 0.08, IRON, { at: [0, 0.68, 2.64] });
  for (const s of [1, -1]) {
    b.box(0.07, 0.72, 0.07, IRON, { at: [s * 0.86, 1.02, 2.6] });
    b.box(0.3, 0.14, 0.05, HAZARD, { at: [s * 0.74, 0.68, 2.67] });
    b.glow(new THREE.CircleGeometry(0.09, 8), '#ffd9a0', 2.6, { at: [s * 0.7, 1.2, 2.5] });
  }
  b.box(1.82, 0.05, 0.05, IRON, { at: [0, 1.36, 2.6] });
  // Cab: doors, a raked screen, a flat roof with the ring in it.
  b.box(2.16, 0.62, 1.42, DRAB, { at: [0, 1.32, 0.02] });
  for (const s of [1, -1]) {
    b.box(0.03, 0.5, 0.6, DRAB_LIGHT, { at: [s * 1.09, 1.3, 0.34] });
    b.box(0.03, 0.5, 0.6, DRAB_LIGHT, { at: [s * 1.09, 1.3, -0.34] });
    b.box(0.05, 0.34, 0.52, GLASS, { at: [s * 1.08, 1.8, 0.1] });
    b.box(0.12, 0.05, 0.16, TYRE, { at: [s * 1.16, 1.78, 0.72] });
  }
  b.solid(hull([
    { z: -0.7, w: 1.06, top: 2.04, bottom: 1.6 },
    { z: 0.34, w: 1.06, top: 2.04, bottom: 1.6 },
    { z: 0.82, w: 1.03, top: 1.92, bottom: 1.6 },
  ]), DRAB_LIGHT);
  b.box(1.82, 0.36, 0.05, GLASS, { at: [0, 1.76, 0.84], rot: [-0.28, 0, 0] });
  // The open bed the gunner stands in.
  for (const s of [1, -1]) b.box(0.1, 0.52, 1.86, DRAB, { at: [s * 1.05, 1.26, -1.62] });
  b.box(2.1, 0.5, 0.1, DRAB, { at: [0, 1.26, -2.5] });
  b.box(1.96, 0.05, 1.82, IRON, { at: [0, 1.06, -1.62] });
  for (const s of [1, -1]) b.box(0.62, 0.34, 0.5, STEEL, { at: [s * 0.62, 1.26, -2.2] });
  // Spare wheel and cans on the tail, because a thing like this is packed by the man who has to fix it.
  b.cyl(0.46, 0.46, 0.24, 12, TYRE, { at: [0.5, 1.28, -2.66], rot: ALONG_Z });
  for (const x of [-0.42, -0.74]) b.box(0.26, 0.36, 0.14, DRAB_DARK, { at: [x, 1.26, -2.62] });
  b.box(0.03, 2.1, 0.03, STEEL, { at: [-0.98, 2.2, -2.3], rot: [-0.08, 0, 0] });
  roofGunRing(b, [0, 2.06, -0.7], 0.5);
  b.box(2.2, 0.04, 0.3, HAZARD, { at: [0, 1.65, -0.72] });
}

function truckBody(b: ModelBuilder): void {
  // Ladder frame under everything, so from low down it stops being a box.
  for (const s of [1, -1]) b.box(0.16, 0.26, 7.6, STEEL, { at: [s * 0.62, 0.96, 0] });
  b.box(2.24, 0.26, 5.2, DRAB_DARK, { at: [0, 1.22, -1.5] });
  // Bonnet, cab and grille.
  b.solid(hull([
    { z: 2.46, w: 1.02, top: 1.98, bottom: 0.96 },
    { z: 3.3, w: 1, top: 1.92, bottom: 0.96 },
    { z: 4.02, w: 0.94, top: 1.7, bottom: 0.96 },
  ]), DRAB);
  for (let i = 0; i < 7; i++) b.box(1.36, 0.035, 0.02, STEEL, { at: [0, 1.06 + i * 0.08, 4.04] });
  b.box(2.3, 0.2, 0.14, IRON, { at: [0, 0.82, 4.02] });
  b.box(0.9, 0.1, 0.05, HAZARD, { at: [0, 0.82, 4.1] });
  for (const s of [1, -1]) {
    b.solid(hull([{ z: 2.56, w: 0.28, top: 1.62, bottom: 1.3 }, { z: 3.9, w: 0.26, top: 1.44, bottom: 1.3 }]), DRAB_DARK, { at: [s * 1.08, 0, 0] });
    b.glow(new THREE.CircleGeometry(0.11, 8), '#ffd9a0', 2.4, { at: [s * 0.8, 1.56, 4.0] });
    b.box(0.34, 0.3, 0.9, STEEL, { at: [s * 1.12, 1.06, 0.72] });
    b.box(0.03, 0.72, 0.8, DRAB_LIGHT, { at: [s * 1.25, 1.72, 1.85] });
    b.box(0.04, 0.42, 0.66, GLASS, { at: [s * 1.25, 2.28, 1.92] });
    b.box(0.16, 0.08, 0.2, TYRE, { at: [s * 1.36, 2.22, 2.46] });
  }
  b.box(2.5, 1.02, 1.36, DRAB, { at: [0, 1.86, 1.82] });
  b.solid(hull([
    { z: 1.12, w: 1.25, top: 2.74, bottom: 2.3 },
    { z: 2.24, w: 1.25, top: 2.74, bottom: 2.3 },
    { z: 2.56, w: 1.2, top: 2.56, bottom: 2.3 },
  ]), DRAB_LIGHT);
  b.box(2.2, 0.4, 0.05, GLASS, { at: [0, 2.44, 2.56], rot: [-0.24, 0, 0] });
  b.box(0.08, 0.48, 0.05, STEEL, { at: [0, 2.44, 2.58], rot: [-0.24, 0, 0] });
  roofGunRing(b, [0, 2.76, 1.6], 0.56);
  // Bed: sides, tilt hoops and the canvas over them, rolled up at the back so the men can be seen going.
  for (const s of [1, -1]) {
    b.box(0.08, 0.7, 5.05, DRAB, { at: [s * 1.26, 1.68, -1.5] });
    for (let i = 0; i < 6; i++) b.box(0.04, 0.68, 0.06, DRAB_DARK, { at: [s * 1.31, 1.68, -3.7 + i * 0.86] });
    b.box(0.34, 0.08, 4.8, IRON, { at: [s * 0.95, 1.8, -1.5] });
  }
  b.box(2.5, 0.7, 0.08, DRAB, { at: [0, 1.68, 0.98] });
  b.solid(hull([
    { z: -3.75, w: 1.32, top: 3.24, bottom: 1.98 },
    { z: -1.5, w: 1.34, top: 3.26, bottom: 1.98 },
    { z: 1, w: 1.32, top: 3.24, bottom: 1.98 },
  ]), CANVAS);
  for (let i = 0; i < 5; i++) b.box(2.72, 0.05, 0.05, CANVAS_DARK, { at: [0, 3.27, -3.3 + i * 1.05] });
  for (const s of [1, -1]) for (let i = 0; i < 5; i++) b.box(0.05, 1.04, 0.05, CANVAS_DARK, { at: [s * 1.36, 2.62, -3.3 + i * 1.05] });
  b.cyl(0.14, 0.14, 2.6, 8, CANVAS_DARK, { at: [0, 3.26, -3.9], rot: ALONG_X });
  // Tailgate, dropped, with a step for the man who is not young any more.
  b.box(2.42, 0.08, 0.62, DRAB, { at: [0, 1.22, -4.34], rot: [-0.24, 0, 0] });
  b.box(1.4, 0.05, 0.22, IRON, { at: [0, 0.78, -4.2] });
  for (const s of [1, -1]) b.box(0.32, 0.14, 0.05, HAZARD, { at: [s * 1.02, 1.1, -4.06] });
}

/** A side of the tank's running gear: the belt, the wheels inside it, and the skirt over them. */
function trackGear(b: ModelBuilder, side: number): void {
  const x = side * 1.56;
  b.box(0.66, 0.1, 7.4, TYRE, { at: [x, 1.42, 0] });
  b.box(0.66, 0.1, 7.1, TYRE, { at: [x, 0.05, 0] });
  for (const z of [3.75, -3.75]) b.cyl(0.42, 0.42, 0.68, 12, TYRE, { at: [x, 0.78, z], rot: ALONG_X });
  b.box(0.66, 1.1, 0.5, TYRE, { at: [x, 0.74, 3.84] });
  b.box(0.66, 1.1, 0.5, TYRE, { at: [x, 0.74, -3.84] });
}

function roadWheels(b: ModelBuilder, side: number): void {
  const x = side * 1.56;
  for (let i = 0; i < 7; i++) {
    const z = -3.1 + i * 1.03;
    b.cyl(0.44, 0.44, 0.5, 12, IRON, { at: [x, 0.5, z], rot: ALONG_X });
    b.cyl(0.26, 0.26, 0.56, 8, STEEL, { at: [x, 0.5, z], rot: ALONG_X });
  }
  b.cyl(0.36, 0.36, 0.56, 10, IRON, { at: [x, 0.92, 3.72], rot: ALONG_X });
  b.cyl(0.4, 0.4, 0.56, 8, STEEL, { at: [x, 0.92, -3.72], rot: ALONG_X });
}

function treads(b: ModelBuilder, side: number, phase: number): void {
  const x = side * 1.56;
  for (let i = 0; i < 15; i++) {
    const z = -3.7 + phase + i * 0.5;
    b.box(0.72, 0.1, 0.14, '#2a2d2f', { at: [x, 1.49, z] });
    b.box(0.72, 0.1, 0.14, '#2a2d2f', { at: [x, -0.02, z] });
  }
}

function tankHull(b: ModelBuilder): void {
  b.solid(hull([
    { z: -4.02, w: 1.14, top: 1.92, bottom: 0.7 },
    { z: -2.4, w: 1.22, top: 2.0, bottom: 0.62 },
    { z: 1.6, w: 1.22, top: 2.0, bottom: 0.62 },
    { z: 2.5, w: 1.2, top: 1.92, bottom: 0.66 },
    { z: 3.95, w: 1.1, top: 1.18, bottom: 0.92 },
  ]), DRAB);
  // Fenders run the whole length, and the skirts hang off them in panels, so a shot-away panel could be missed from them.
  for (const s of [1, -1]) {
    b.box(0.92, 0.07, 8.1, DRAB_DARK, { at: [s * 1.5, 1.58, 0] });
    for (let i = 0; i < 6; i++) {
      b.box(0.06, 0.74, 1.24, i % 2 ? DRAB : DRAB_LIGHT, { at: [s * 1.92, 1.2, -3.1 + i * 1.26], rot: [0, 0, s * 0.03] });
      b.box(0.07, 0.03, 1.24, DRAB_DARK, { at: [s * 1.93, 1.52, -3.1 + i * 1.26] });
    }
    b.box(0.08, 0.1, 0.5, HAZARD, { at: [s * 1.94, 1.24, 3.2] });
    b.box(0.14, 0.2, 0.05, '#ffd9a0', { at: [s * 0.98, 1.3, 3.54] });
    b.box(0.3, 0.2, 0.9, STEEL, { at: [s * 1.46, 1.74, -2.7] });
  }
  // Glacis detail: the driver's hatch and his three vision blocks, set where a rocket would like to go.
  b.solid(new THREE.CylinderGeometry(0.42, 0.46, 0.1, 10), IRON, { at: [0, 2.03, 2.0] });
  for (const x of [-0.26, 0, 0.26]) b.box(0.18, 0.08, 0.06, GLASS, { at: [x, 1.98, 2.42], rot: [0.5, 0, 0] });
  b.box(1.8, 0.05, 0.8, DRAB_DARK, { at: [0, 1.52, 3.24], rot: [0.55, 0, 0] });
  for (const s of [1, -1]) b.box(0.28, 0.22, 0.14, IRON, { at: [s * 0.82, 0.98, 3.96] });
  // Engine deck: louvres, an exhaust, a tow cable. The soft part of a tank says so.
  b.box(2, 0.05, 1.8, IRON, { at: [0, 2.0, -3.0] });
  for (let i = 0; i < 9; i++) b.box(1.86, 0.05, 0.08, STEEL, { at: [0, 2.04, -3.76 + i * 0.19], rot: [0.5, 0, 0] });
  b.box(1.5, 0.3, 0.1, STEEL, { at: [0, 1.5, -4.04] });
  b.glow(new THREE.PlaneGeometry(1.2, 0.08), '#ff7a2a', 1.3, { at: [0, 1.5, -4.1], rot: [0, Math.PI, 0] });
  b.cyl(0.05, 0.05, 2.7, 6, IRON, { at: [1.02, 2.07, -1.6], rot: ALONG_Z });
  for (const s of [1, -1]) b.cyl(0.24, 0.24, 0.9, 10, DRAB_DARK, { at: [s * 1.0, 2.06, -3.9], rot: ALONG_X });
}

function tankTurret(b: ModelBuilder): void {
  // Coordinates are about the ring.
  b.solid(hull([
    { z: -2.15, w: 0.72, top: 0.86, bottom: 0.14 },
    { z: -1.1, w: 1.26, top: 1.0, bottom: 0.08 },
    { z: 0.8, w: 1.32, top: 1.0, bottom: 0.06 },
    { z: 1.65, w: 0.92, top: 0.88, bottom: 0.1 },
    { z: 2.2, w: 0.5, top: 0.72, bottom: 0.24 },
  ]), DRAB_LIGHT);
  b.cyl(1.2, 1.26, 0.18, 16, DRAB_DARK, { at: [0, 0.05, 0] });
  for (const s of [1, -1]) {
    // Add-on blocks on the cheeks, which is what makes the turret read as a thing that has been up-armoured in a hurry.
    for (let i = 0; i < 4; i++) b.box(0.1, 0.36, 0.4, i % 2 ? DRAB : DRAB_DARK, { at: [s * (1.3 - i * 0.03), 0.56, 0.9 - i * 0.48], rot: [0, s * 0.1, 0] });
    for (let i = 0; i < 3; i++) b.cyl(0.05, 0.05, 0.3, 6, STEEL, { at: [s * 1.1, 0.92 - i * 0.1, 1.16], rot: [Math.PI / 2 + 0.3, 0, s * 0.5] });
    b.box(0.08, 0.05, 1.6, IRON, { at: [s * 1.26, 0.9, -1] });
  }
  // Bustle rack and stowage.
  b.box(1.5, 0.05, 0.5, IRON, { at: [0, 0.82, -2.28] });
  b.box(0.7, 0.3, 0.4, CANVAS, { at: [0.3, 0.98, -2.22] });
  b.box(0.5, 0.24, 0.4, CANVAS_DARK, { at: [-0.4, 0.95, -2.2] });
  // Cupola and loader's hatch, and the gun's own armour.
  b.cyl(0.42, 0.46, 0.28, 10, DRAB, { at: [-0.62, 1.12, -0.65] });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    b.box(0.12, 0.08, 0.04, GLASS, { at: [-0.62 + Math.sin(a) * 0.42, 1.18, -0.65 + Math.cos(a) * 0.42], rot: [0, a, 0] });
  }
  b.cyl(0.34, 0.34, 0.06, 10, IRON, { at: [0.6, 1.03, -0.6] });
  b.box(0.3, 0.26, 0.44, IRON, { at: [0.72, 1.14, 0.54] });
  b.box(0.04, 1.9, 0.04, STEEL, { at: [0.92, 1.9, -1.7] });
  b.box(1.1, 0.04, 0.8, HAZARD, { at: [0, 1.01, -1.6] });
}

function tankBarrel(b: ModelBuilder): void {
  // About the trunnion. The barrel lifts and slides here, so everything that moves with it is in this one mesh.
  b.box(1.2, 0.72, 0.8, DRAB, { at: [0, 0, 0.5] });
  b.cyl(0.2, 0.25, 1, 12, DRAB_DARK, { at: [0, 0, 1.2], rot: ALONG_Z });
  b.cyl(0.115, 0.13, 4.5, 12, IRON, { at: [0, 0, 3.2], rot: ALONG_Z });
  b.cyl(0.19, 0.19, 0.74, 12, IRON, { at: [0, 0, 3.15], rot: ALONG_Z });
  b.cyl(0.16, 0.16, 0.44, 12, STEEL, { at: [0, 0, 5.38], rot: ALONG_Z });
  for (const s of [1, -1]) b.box(0.1, 0.16, 0.3, STEEL, { at: [s * 0.2, 0, 5.4] });
}

export const PINTLE_GUN: GunSpec = {
  name: 'pintle',
  build: b => {
    b.cyl(0.05, 0.07, 0.5, 8, IRON, { at: [0, -0.34, 0.05] });
    b.box(0.2, 0.2, 0.5, IRON, { at: [0, 0, 0.1] });
    b.box(0.06, 0.1, 0.16, STEEL, { at: [0.14, 0, 0.3] });
    // A shield, because the man behind it has a family.
    b.solid(plate([[-0.46, -0.3], [0.46, -0.3], [0.5, 0.26], [0.16, 0.26], [0.16, 0.02], [-0.16, 0.02], [-0.16, 0.26], [-0.5, 0.26]], 0.04), DRAB, { at: [0, 0, -0.26], rot: [0, 0, 0] });
    b.box(0.26, 0.24, 0.3, DRAB_DARK, { at: [-0.2, -0.14, 0.12] });
  },
  moving: b => {
    b.cyl(0.03, 0.03, 1.26, 8, STEEL, { at: [0, 0.02, -0.72], rot: ALONG_Z });
    b.cyl(0.05, 0.05, 0.5, 8, IRON, { at: [0, 0.02, -0.34], rot: ALONG_Z });
    b.cyl(0.045, 0.03, 0.12, 8, IRON, { at: [0, 0.02, -1.38], rot: ALONG_Z });
  },
  muzzle: [0, 0.02, -1.46],
  follow: 9,
  return: 22,
};

const BARRELS = 3;

export const CHIN_GUN: GunSpec = {
  name: 'enemy-chin',
  build: b => {
    b.solid(new THREE.SphereGeometry(0.34, 10, 8), STEEL);
    b.box(0.3, 0.3, 0.7, IRON, { at: [0, 0, -0.32] });
  },
  moving: b => {
    for (let i = 0; i < BARRELS; i++) {
      const a = (i / BARRELS) * Math.PI * 2;
      b.cyl(0.03, 0.03, 1.5, 8, STEEL, { at: [Math.cos(a) * 0.07, Math.sin(a) * 0.07, -1.2], rot: ALONG_Z });
    }
    b.cyl(0.11, 0.11, 0.05, 10, IRON, { at: [0, 0, -1.6], rot: ALONG_Z });
  },
  muzzle: [0, 0, -1.98],
  follow: 12,
  return: 26,
};

const ROTOR_RADIUS = 6.6;

function gunshipHull(b: ModelBuilder): void {
  b.solid(hull([
    { z: -1.9, w: 0.5, top: 1.5, bottom: 0.2 },
    { z: -0.4, w: 1.04, top: 1.46, bottom: -0.92 },
    { z: 1.9, w: 1.08, top: 1.22, bottom: -1.04 },
    { z: 3.1, w: 0.94, top: 0.5, bottom: -1.02 },
    { z: 4.6, w: 0.66, top: 0.1, bottom: -0.96 },
    { z: 5.7, w: 0.3, top: -0.32, bottom: -0.74 },
  ]), DRAB);
  // Two men side by side behind a single wraparound of glass: heavier and blunter than the player's Harrow, on purpose.
  b.solid(hull([
    { z: 1.8, w: 0.86, top: 1.3, bottom: 0.2 },
    { z: 3.1, w: 0.88, top: 1.02, bottom: -0.06 },
    { z: 4.2, w: 0.68, top: 0.56, bottom: -0.3 },
    { z: 5.12, w: 0.28, top: 0, bottom: -0.54 },
  ]), GLASS);
  b.box(0.05, 0.05, 2.6, DRAB_DARK, { at: [0, 1.0, 3.3], rot: [0.42, 0, 0] });
  for (const s of [1, -1]) b.box(0.05, 0.66, 0.05, DRAB_DARK, { at: [s * 0.74, 0.5, 3.0], rot: [0.5, 0, s * 0.2] });
  b.solid(new THREE.SphereGeometry(0.26, 10, 8), STEEL, { at: [0, -0.72, 5.36] });
  b.glow(new THREE.CircleGeometry(0.1, 8), '#ff4030', 2.6, { at: [0, -0.72, 5.63] });
  // Plated flanks with a side door nobody will ever use.
  for (const s of [1, -1]) {
    b.box(0.05, 1.1, 2, DRAB_LIGHT, { at: [s * 1.09, 0.02, 0.76] });
    b.box(0.06, 0.05, 2.1, DRAB_DARK, { at: [s * 1.1, 0.6, 0.76] });
    b.box(0.07, 0.14, 0.7, HAZARD, { at: [s * 1.1, -0.58, 1.2] });
  }
}

function gunshipEngines(b: ModelBuilder): void {
  for (const s of [1, -1]) {
    b.solid(hull([
      { z: -1.7, w: 0.38, top: 1.86, bottom: 1.18 },
      { z: 0.1, w: 0.5, top: 2, bottom: 1.1 },
      { z: 1.6, w: 0.42, top: 1.86, bottom: 1.2 },
    ]), DRAB_LIGHT, { at: [s * 0.82, 0, 0] });
    b.cyl(0.34, 0.34, 0.1, 12, STEEL, { at: [s * 0.82, 1.52, 1.64], rot: ALONG_Z });
    b.cyl(0.26, 0.2, 0.6, 10, STEEL, { at: [s * 0.94, 1.52, -1.9], rot: [Math.PI / 2 + 0.1, 0, s * 0.3] });
    b.glow(new THREE.CircleGeometry(0.13, 8), '#ff8a3a', 2, { at: [s * 1.03, 1.55, -2.2], rot: [0, Math.PI, 0] });
  }
  b.box(0.7, 0.4, 2, DRAB, { at: [0, 1.74, 0.1] });
  b.cyl(0.16, 0.2, 0.6, 8, STEEL, { at: [0, 2.08, 0.3] });
}

function gunshipWings(b: ModelBuilder): void {
  for (const s of [1, -1]) {
    // Stub wings drooping to a pair of pods each: the shape that says this thing came to shoot.
    b.box(2.5, 0.14, 1.3, DRAB_DARK, { at: [s * 2.12, -0.24, 0.76], rot: [0, 0, s * 0.14] });
    b.box(0.09, 0.5, 1, DRAB, { at: [s * 3.34, -0.5, 0.76] });
    for (const x of [1.76, 2.92]) {
      b.box(0.1, 0.36, 0.56, IRON, { at: [s * x, -0.42 - (x - 1.76) * 0.14, 0.84] });
      b.cyl(0.26, 0.26, 1.7, 10, IRON, { at: [s * x, -0.74 - (x - 1.76) * 0.14, 1.08], rot: ALONG_Z });
      b.cyl(0.21, 0.21, 0.04, 10, '#0c0e11', { at: [s * x, -0.74 - (x - 1.76) * 0.14, 1.94], rot: ALONG_Z });
      b.box(0.1, 0.1, 0.3, HAZARD, { at: [s * x, -0.5 - (x - 1.76) * 0.14, 1.72] });
    }
  }
  for (const s of [1, -1]) {
    b.box(0.08, 0.7, 0.14, IRON, { at: [s * 0.94, -1.26, 2.5], rot: [0, 0, s * 0.3] });
    b.cyl(0.22, 0.22, 0.14, 10, TYRE, { at: [s * 1.1, -1.56, 2.5], rot: ALONG_X });
    b.box(0.08, 0.7, 0.14, IRON, { at: [s * 0.8, -1.24, -0.3], rot: [0, 0, s * 0.3] });
    b.cyl(0.22, 0.22, 0.14, 10, TYRE, { at: [s * 0.96, -1.54, -0.3], rot: ALONG_X });
  }
}

/** Boom, fin and tailplane, apart from the body so a shot tail can come off. */
function gunshipTail(b: ModelBuilder): void {
  b.solid(hull([
    { z: -6.9, w: 0.14, top: 1.42, bottom: 1.1 },
    { z: -3.2, w: 0.3, top: 1.46, bottom: 0.76 },
    { z: -1.7, w: 0.46, top: 1.5, bottom: 0.3 },
  ]), DRAB);
  b.solid(plate([[-5.7, 1.3], [-7.1, 1.3], [-7.8, 3.2], [-6.9, 3.2]], 0.14), DRAB_LIGHT, { at: [0.07, 0, 0], rot: [0, -Math.PI / 2, 0] });
  b.box(2.8, 0.08, 0.7, DRAB_DARK, { at: [0, 1.26, -5.6] });
  b.box(0.2, 0.3, 0.05, HAZARD, { at: [0.15, 2.5, -7.1] });
  b.box(0.06, 0.5, 0.1, IRON, { at: [0, 0.86, -6.4] });
}

function gunshipRotor(b: ModelBuilder): void {
  b.cyl(0.32, 0.4, 0.3, 10, STEEL);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const mid = (ROTOR_RADIUS + 0.3) / 2;
    b.box(0.34, 0.05, ROTOR_RADIUS - 0.3, TYRE, { at: [Math.sin(a) * mid, 0.03, Math.cos(a) * mid], rot: [0.05, a, 0] });
    b.box(0.35, 0.055, 0.3, HAZARD, { at: [Math.sin(a) * (ROTOR_RADIUS - 0.2), 0.03, Math.cos(a) * (ROTOR_RADIUS - 0.2)], rot: [0.05, a, 0] });
  }
}

function gunshipTailRotor(b: ModelBuilder): void {
  b.cyl(0.1, 0.1, 0.2, 8, STEEL, { rot: ALONG_X });
  for (let i = 0; i < 2; i++) b.box(0.03, 2.3, 0.16, STEEL, { rot: [(i * Math.PI) / 2, 0, 0] });
}

const GUNSHIP_ROTORS: readonly RotorSpec[] = [
  { at: [0, 2.42, 0.3], axis: 'y', rate: 27, build: gunshipRotor, disc: ROTOR_RADIUS },
  { at: [0.2, 2.5, -7.4], axis: 'x', rate: 58, build: gunshipTailRotor, disc: 1.2 },
];

export const MAIN_ROTOR = 0;
export const TAIL_ROTOR = 1;

export const GUNSHIP_AIRFRAME: AirframeSpec<ChopperMount> = {
  name: 'gunship',
  build: b => {
    gunshipHull(b);
    gunshipEngines(b);
    gunshipWings(b);
  },
  rotors: GUNSHIP_ROTORS,
  mounts: { chin: [0, -1.2, 4.4], podLeft: [2.3, -0.8, 2.1], podRight: [-2.3, -0.8, 2.1], exhaust: [0, 1.6, -2] },
  strobe: {
    build: b => {
      b.glow(new THREE.SphereGeometry(0.08, 6, 4), '#ff2a20', 6, { at: [0, 3.25, -7.2] });
      b.glow(new THREE.SphereGeometry(0.06, 6, 4), '#ff2a20', 6, { at: [3.4, -0.5, 0.76] });
      b.glow(new THREE.SphereGeometry(0.06, 6, 4), '#35ff8a', 6, { at: [-3.4, -0.5, 0.76] });
    },
    period: 1.6,
    lit: 0.11,
  },
};

export function gunshipTailGroup(materials: ModelMaterials): THREE.Group {
  const b = new ModelBuilder();
  gunshipTail(b);
  return materials.group(b);
}

/** One built vehicle. Anything a kind does not have is null. */
export interface GroundModel {
  readonly root: THREE.Group;
  readonly body: THREE.Group;
  /** Wheels that turn with the road, each with its radius. */
  readonly wheels: readonly { part: THREE.Object3D; radius: number }[];
  /** Front wheels, which also steer. */
  readonly steered: readonly THREE.Object3D[];
  /** Per side, left then right: the belt and wheels left when a track is thrown, and the two sets of links that swap to show it moving. */
  readonly tracks: readonly { belt: THREE.Object3D; links: readonly [THREE.Object3D, THREE.Object3D] }[];
  readonly turret: THREE.Group | null;
  readonly barrel: THREE.Group | null;
}

interface Template {
  root: THREE.Group;
}

const NAMES = { wheelFront: 'front', turret: 'turret', barrel: 'barrel', body: 'body' } as const;

function axle(materials: ModelMaterials, radius: number, width: number, xs: readonly number[], at: readonly [number, number, number], name: string): THREE.Group {
  const b = new ModelBuilder();
  for (const x of xs) wheel(b, radius, width, x);
  const g = materials.group(b);
  g.position.set(at[0], at[1], at[2]);
  g.name = name;
  return g;
}

function wheeled(materials: ModelMaterials, kind: 'humvee' | 'truck'): Template {
  const root = new THREE.Group();
  const body = new ModelBuilder();
  if (kind === 'humvee') scoutBody(body);
  else truckBody(body);
  const b = materials.group(body);
  b.name = NAMES.body;
  root.add(b);
  const r = WHEEL_RADIUS[kind];
  if (kind === 'humvee') {
    for (const s of [1, -1]) root.add(axle(materials, r, 0.34, [0], [s * 1.0, r, 1.62], NAMES.wheelFront));
    root.add(axle(materials, r, 0.34, [1.0, -1.0], [0, r, -1.46], 'rear'));
  } else {
    for (const s of [1, -1]) root.add(axle(materials, r, 0.34, [0], [s * 1.08, r, 2.9], NAMES.wheelFront));
    for (const z of [-1.2, -2.7]) root.add(axle(materials, r, 0.5, [0.98, -0.98], [0, r, z], 'rear'));
  }
  return { root };
}

function tracked(materials: ModelMaterials): Template {
  const root = new THREE.Group();
  const hullBuilder = new ModelBuilder();
  tankHull(hullBuilder);
  const body = materials.group(hullBuilder);
  body.name = NAMES.body;
  root.add(body);
  for (const side of [1, -1]) {
    const gear = new ModelBuilder();
    roadWheels(gear, side);
    root.add(materials.group(gear));
    const belt = new ModelBuilder();
    trackGear(belt, side);
    const beltGroup = materials.group(belt);
    beltGroup.name = 'belt';
    root.add(beltGroup);
    for (const phase of [0, 0.25]) {
      const links = new ModelBuilder();
      treads(links, side, phase);
      const g = materials.group(links);
      g.name = 'links';
      root.add(g);
    }
  }
  const turretBuilder = new ModelBuilder();
  tankTurret(turretBuilder);
  const turret = materials.group(turretBuilder);
  turret.name = NAMES.turret;
  turret.position.set(TURRET_RING[0], TURRET_RING[1], TURRET_RING[2]);
  const barrelBuilder = new ModelBuilder();
  tankBarrel(barrelBuilder);
  const barrel = materials.group(barrelBuilder);
  barrel.name = NAMES.barrel;
  barrel.position.set(TRUNNION[0], TRUNNION[1], TRUNNION[2]);
  turret.add(barrel);
  body.add(turret);
  return { root };
}

function shadows(root: THREE.Object3D): void {
  root.traverse(o => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
  });
}

function read(root: THREE.Group): GroundModel {
  const wheels: { part: THREE.Object3D; radius: number }[] = [];
  const steered: THREE.Object3D[] = [];
  const belts: THREE.Object3D[] = [];
  const links: THREE.Object3D[] = [];
  for (const child of root.children) {
    if (child.name === NAMES.wheelFront || child.name === 'rear') {
      wheels.push({ part: child, radius: child.position.y });
      if (child.name === NAMES.wheelFront) steered.push(child);
    } else if (child.name === 'belt') belts.push(child);
    else if (child.name === 'links') links.push(child);
  }
  const tracks = belts.map((belt, i) => ({ belt, links: [links[i * 2]!, links[i * 2 + 1]!] as const }));
  return {
    root,
    body: root.getObjectByName(NAMES.body) as THREE.Group,
    wheels,
    steered,
    tracks,
    turret: (root.getObjectByName(NAMES.turret) as THREE.Group | undefined) ?? null,
    barrel: (root.getObjectByName(NAMES.barrel) as THREE.Group | undefined) ?? null,
  };
}

/** Builds each kind on first use and hands out clones. A clone shares geometry and material, so it costs a few Object3Ds. */
export class Fleet {
  private readonly templates = new Map<VehicleKind, Template>();
  /** Scorched paint: the wreck's whole look comes from multiplying the model's own colours down. */
  readonly burnt: THREE.MeshStandardMaterial;
  private tail: THREE.Group | null = null;

  constructor(private readonly materials: ModelMaterials, private readonly scene: THREE.Scene) {
    this.burnt = materials.solid.clone();
    this.burnt.color.set('#3a3430');
    this.burnt.metalness = 0.25;
    this.burnt.roughness = 0.95;
  }

  private template(kind: 'humvee' | 'truck' | 'tank'): Template {
    let t = this.templates.get(kind);
    if (!t) {
      t = kind === 'tank' ? tracked(this.materials) : wheeled(this.materials, kind);
      shadows(t.root);
      this.templates.set(kind, t);
    }
    return t;
  }

  /** A live vehicle. Parented to the scene, and hidden until it is first placed. */
  ground(kind: 'humvee' | 'truck' | 'tank'): GroundModel {
    const root = this.template(kind).root.clone();
    root.visible = false;
    this.scene.add(root);
    return read(root);
  }

  /** The same machine, scorched, in a pose of its own. The glow goes out with the engine. */
  scorch(root: THREE.Object3D): void {
    root.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (mesh.material === this.materials.glow) mesh.visible = false;
      else mesh.material = this.burnt;
    });
  }

  /** The gunship's body as it lies on the ground: airframe parts and no rotors. */
  gunshipWreck(withTail: boolean): THREE.Group {
    const root = new THREE.Group();
    const b = new ModelBuilder();
    gunshipHull(b);
    gunshipEngines(b);
    gunshipWings(b);
    root.add(this.materials.group(b));
    if (withTail) root.add(this.tailClone());
    shadows(root);
    this.scorch(root);
    this.scene.add(root);
    return root;
  }

  private tailClone(): THREE.Group {
    this.tail ??= gunshipTailGroup(this.materials);
    return this.tail.clone();
  }

  get solidMaterials(): readonly THREE.Material[] {
    return [this.burnt];
  }
}
