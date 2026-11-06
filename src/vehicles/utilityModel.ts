/**
 * The Packmule, the Door Gunner's ride. An original utility helicopter: a slab-sided cabin, a long boom, and the left
 * side open from floor to roof. Nose along +Z, so the door is on +X.
 *
 * The cabin is built from real boxes and not a lofted shell, because the player sits inside it: outward faces are all a
 * loft has, and from inside those are culled, so the walls would vanish and leave the gun floating in the sky.
 */
import * as THREE from 'three';
import { plate } from '../progression/callins/ac130Model';
import type { AirframeSpec, RotorSpec } from '../progression/callins/airframe';
import type { ModelBuilder } from '../progression/modelkit';
import { hull } from './loft';

export type UtilityMount = 'door';

const SKIN = '#454f52';
const PANEL = '#566166';
const DARK = '#2a3034';
const INSIDE = '#23292e';
const FLOOR = '#30373c';
const STEEL = '#1e2328';
const GLASS = '#0c1317';

const ALONG_Z: readonly [number, number, number] = [Math.PI / 2, 0, 0];
const BLADE_RADIUS = 8.2;

/** The cabin box, in the aircraft's frame. */
const C = { halfWidth: 1.28, floor: -1, roof: 1, back: -2.1, front: 2.5, doorBack: -1.45, doorFront: 1.75 } as const;

function cabin(b: ModelBuilder): void {
  const length = C.front - C.back;
  const mid = (C.front + C.back) / 2;
  const height = C.roof - C.floor;
  const midY = (C.roof + C.floor) / 2;
  const width = C.halfWidth * 2;
  b.box(width, 0.14, length, FLOOR, { at: [0, C.floor - 0.07, mid] });
  b.box(width, 0.14, length, INSIDE, { at: [0, C.roof + 0.07, mid] });
  b.box(0.1, height, length, INSIDE, { at: [-C.halfWidth - 0.05, midY, mid] });
  b.box(width, height, 0.1, INSIDE, { at: [0, midY, C.back - 0.05] });
  b.box(width, height, 0.1, INSIDE, { at: [0, midY, C.front + 0.05] });
  // The wall either side of the door, and the sill and lintel that frame the view.
  b.box(0.1, height, C.front - C.doorFront, SKIN, { at: [C.halfWidth + 0.05, midY, (C.front + C.doorFront) / 2] });
  b.box(0.1, height, C.doorBack - C.back, SKIN, { at: [C.halfWidth + 0.05, midY, (C.doorBack + C.back) / 2] });
  b.box(0.12, 0.16, C.doorFront - C.doorBack, PANEL, { at: [C.halfWidth + 0.05, C.roof - 0.06, (C.doorFront + C.doorBack) / 2] });
  b.box(0.16, 0.08, C.doorFront - C.doorBack, PANEL, { at: [C.halfWidth + 0.06, C.floor + 0.02, (C.doorFront + C.doorBack) / 2] });
  // The slid-back door, proud of the skin on its rail.
  b.box(0.06, height - 0.3, 1.9, PANEL, { at: [C.halfWidth + 0.16, midY - 0.04, C.doorBack - 0.6] });
  b.box(0.05, 0.05, 4.4, DARK, { at: [C.halfWidth + 0.14, C.roof - 0.08, -0.1] });
  // Inside: seats along the far wall, webbing, a grab rail, a red working light.
  for (const z of [-1.3, -0.3, 0.7, 1.7]) {
    b.box(0.5, 0.08, 0.75, DARK, { at: [-C.halfWidth + 0.34, -0.5, z] });
    b.box(0.08, 0.72, 0.75, DARK, { at: [-C.halfWidth + 0.1, -0.12, z] });
  }
  b.box(0.04, 0.04, 3.6, STEEL, { at: [0.5, C.roof - 0.14, 0.1] });
  for (const z of [-1.7, 1.2]) b.box(2.3, 0.06, 0.06, STEEL, { at: [0, C.roof - 0.05, z] });
  b.glow(new THREE.BoxGeometry(0.14, 0.03, 0.34), '#ff3020', 1.6, { at: [-0.6, C.roof - 0.02, 0.2] });
}

function nose(b: ModelBuilder): void {
  b.solid(hull([
    { z: 2.5, w: 1.3, top: 1.04, bottom: -1.08 },
    { z: 3.7, w: 1.16, top: 0.86, bottom: -1.02 },
    { z: 4.7, w: 0.88, top: 0.2, bottom: -0.92 },
    { z: 5.5, w: 0.42, top: -0.28, bottom: -0.72 },
  ]), SKIN);
  b.solid(hull([
    { z: 2.6, w: 1.14, top: 1.08, bottom: 0.08 },
    { z: 3.7, w: 1.04, top: 0.92, bottom: -0.02 },
    { z: 4.45, w: 0.8, top: 0.3, bottom: -0.3 },
  ]), GLASS);
  b.box(0.05, 1.1, 0.05, PANEL, { at: [0, 0.42, 4.05], rot: [0.75, 0, 0] });
}

function back(b: ModelBuilder): void {
  b.solid(hull([
    { z: -9.3, w: 0.16, top: 1.3, bottom: 0.9 },
    { z: -5, w: 0.3, top: 1.15, bottom: 0.45 },
    { z: -2.15, w: 1.3, top: 1.04, bottom: -1.08 },
  ]), SKIN);
  b.solid(plate([[-8.7, 1.2], [-9.9, 1.2], [-10.5, 3.3], [-9.6, 3.3]], 0.16), SKIN, { at: [0.08, 0, 0], rot: [0, -Math.PI / 2, 0] });
  b.solid(plate([[-1.7, -8.3], [1.7, -8.3], [1.7, -9], [-1.7, -9]], 0.08), PANEL, { at: [0, 1.1, 0], rot: [Math.PI / 2, 0, 0] });
}

function top(b: ModelBuilder): void {
  b.solid(hull([
    { z: -2.4, w: 0.5, top: 1.5, bottom: 1.06 },
    { z: -0.4, w: 0.88, top: 1.82, bottom: 1.06 },
    { z: 1.5, w: 0.82, top: 1.72, bottom: 1.06 },
    { z: 2.4, w: 0.4, top: 1.3, bottom: 1.06 },
  ]), PANEL);
  for (const s of [1, -1]) {
    b.cyl(0.22, 0.26, 0.4, 10, DARK, { at: [s * 0.58, 1.48, 1.64], rot: ALONG_Z });
    b.cyl(0.2, 0.15, 0.5, 10, STEEL, { at: [s * 0.62, 1.5, -1.9], rot: ALONG_Z });
    b.glow(new THREE.CircleGeometry(0.13, 10), '#ff8a3a', 1.9, { at: [s * 0.62, 1.5, -2.16], rot: [0, Math.PI, 0] });
  }
  b.cyl(0.14, 0.18, 0.7, 8, STEEL, { at: [0, 2.1, 0.3] });
}

function gear(b: ModelBuilder): void {
  for (const s of [1, -1]) {
    b.box(0.08, 0.5, 0.1, DARK, { at: [s * 1.5, -1.26, 1.4], rot: [0, 0, s * 0.7] });
    b.cyl(0.3, 0.3, 0.18, 10, STEEL, { at: [s * 1.68, -1.46, 1.4], rot: [0, 0, Math.PI / 2] });
  }
  b.box(0.06, 0.7, 0.08, DARK, { at: [0, 0.6, -8.4] });
  b.cyl(0.14, 0.14, 0.08, 8, STEEL, { at: [0, 0.26, -8.4], rot: [0, 0, Math.PI / 2] });
}

function mainRotor(b: ModelBuilder): void {
  b.cyl(0.32, 0.38, 0.28, 10, DARK);
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    const mid = (BLADE_RADIUS + 0.3) / 2;
    b.box(0.46, 0.05, BLADE_RADIUS - 0.3, STEEL, { at: [Math.sin(a) * mid, 0.03, Math.cos(a) * mid], rot: [0.05, a, 0] });
  }
}

function tailRotor(b: ModelBuilder): void {
  b.cyl(0.12, 0.12, 0.2, 8, DARK, { rot: [0, 0, Math.PI / 2] });
  // Each box is a pair of blades through the hub.
  for (let i = 0; i < 2; i++) b.box(0.03, 2.8, 0.2, STEEL, { rot: [(i * Math.PI) / 2, 0, 0] });
}

const ROTORS: readonly RotorSpec[] = [
  { at: [0, 2.5, 0.3], axis: 'y', rate: 27, build: mainRotor, disc: BLADE_RADIUS },
  { at: [-0.22, 2.55, -10], axis: 'x', rate: 58, build: tailRotor, disc: 1.45 },
];

function strobes(b: ModelBuilder): void {
  b.glow(new THREE.SphereGeometry(0.09, 6, 4), '#ff2a20', 6, { at: [0, 3.35, -10] });
  b.glow(new THREE.SphereGeometry(0.06, 6, 4), '#35ff8a', 6, { at: [-1.34, 0.9, 2.5] });
}

export const UTILITY_AIRFRAME: AirframeSpec<UtilityMount> = {
  name: 'packmule',
  build: b => {
    cabin(b);
    nose(b);
    back(b);
    top(b);
    gear(b);
  },
  rotors: ROTORS,
  mounts: { door: [1.5, 0.02, 0.2] },
  strobe: { build: strobes, period: 1.5, lit: 0.11 },
};
