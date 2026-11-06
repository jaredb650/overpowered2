/**
 * The Harrow, the Attack Chopper. An original gunship: a narrow tandem hull with the gunner low in the nose and the
 * pilot stepped up behind, two turbines on the shoulders, stub wings carrying the rocket pods, and a turret under the
 * chin. Nose along +Z, as every airframe here. The chin gun itself is in guns.ts, because it moves.
 */
import * as THREE from 'three';
import { plate } from '../progression/callins/ac130Model';
import type { AirframeSpec, RotorSpec } from '../progression/callins/airframe';
import type { ModelBuilder } from '../progression/modelkit';
import { hull } from './loft';

export type AttackMount = 'chin' | 'podLeft' | 'podRight';

const SKIN = '#3e4a54';
const PANEL = '#4d5a65';
const DARK = '#262e35';
const STEEL = '#1d2228';
const GLASS = '#0b1216';

const ALONG_Z: readonly [number, number, number] = [Math.PI / 2, 0, 0];

const BLADE_RADIUS = 7.3;

function fuselage(b: ModelBuilder): void {
  b.solid(hull([
    { z: -6.8, w: 0.17, top: 1.32, bottom: 1.02 },
    { z: -2.8, w: 0.38, top: 1.05, bottom: 0.2 },
    { z: -0.6, w: 0.82, top: 1.22, bottom: -0.78 },
    { z: 2, w: 0.84, top: 1.08, bottom: -1.02 },
    { z: 3.9, w: 0.66, top: 0.76, bottom: -1 },
    { z: 5.7, w: 0.48, top: 0.24, bottom: -0.9 },
    { z: 7, w: 0.16, top: -0.34, bottom: -0.72 },
  ]), SKIN);
  // The stepped canopy is the one thing that says "two men in a line", so it is drawn large and dark.
  b.solid(hull([
    { z: 2.1, w: 0.6, top: 1.62, bottom: 0.7 },
    { z: 3.4, w: 0.58, top: 1.5, bottom: 0.56 },
    { z: 3.8, w: 0.54, top: 1.14, bottom: 0.4 },
    { z: 5.3, w: 0.44, top: 0.84, bottom: 0.04 },
    { z: 6.2, w: 0.2, top: 0.2, bottom: -0.3 },
  ]), GLASS);
  for (const z of [2.9, 4.6]) b.box(1.3, 0.05, 0.05, PANEL, { at: [0, z < 4 ? 1.6 : 0.97, z] });
  b.box(0.05, 0.06, 3.9, PANEL, { at: [0, 1.28, 3.9], rot: [0.26, 0, 0] });
  // Sensor ball on the nose, with the one cold light on the front of the aircraft.
  b.solid(new THREE.SphereGeometry(0.33, 12, 8), DARK, { at: [0, -0.86, 6.45] });
  b.glow(new THREE.CircleGeometry(0.15, 10), '#7fd8ff', 2.4, { at: [0, -0.84, 6.78] });
}

function engines(b: ModelBuilder): void {
  for (const s of [1, -1]) {
    b.cyl(0.42, 0.46, 2.9, 12, PANEL, { at: [s * 1.02, 1.14, -0.1], rot: ALONG_Z });
    b.cyl(0.34, 0.42, 0.5, 12, DARK, { at: [s * 1.02, 1.14, 1.52], rot: ALONG_Z });
    b.cyl(0.3, 0.2, 0.7, 10, STEEL, { at: [s * 1.14, 1.2, -1.85], rot: [Math.PI / 2 + 0.12, 0, s * 0.3] });
    b.glow(new THREE.CircleGeometry(0.17, 10), '#ff8a3a', 2.1, { at: [s * 1.26, 1.25, -2.2], rot: [0, Math.PI, 0] });
  }
  b.solid(hull([
    { z: -1.7, w: 0.5, top: 1.62, bottom: 1.05 },
    { z: 0.2, w: 0.62, top: 1.78, bottom: 1.05 },
    { z: 1.6, w: 0.5, top: 1.5, bottom: 1.05 },
  ]), SKIN);
  b.cyl(0.13, 0.17, 0.75, 8, STEEL, { at: [0, 2.1, 0.3] });
}

function wings(b: ModelBuilder): void {
  for (const s of [1, -1]) {
    b.box(2.6, 0.13, 1.35, PANEL, { at: [s * 2.05, 0.16, 0.8], rot: [0, 0, s * -0.08] });
    b.box(0.09, 0.42, 0.9, SKIN, { at: [s * 3.34, 0.02, 0.8] });
    for (const x of [1.72, 2.86]) {
      b.box(0.1, 0.34, 0.6, DARK, { at: [s * x, -0.1, 0.82] });
      b.cyl(0.27, 0.27, 1.8, 10, DARK, { at: [s * x, -0.48, 1.05], rot: ALONG_Z });
      // Tube mouths, so a pod reads as full of rockets and not as a fuel tank.
      b.cyl(0.23, 0.23, 0.04, 10, '#0c0e11', { at: [s * x, -0.48, 1.96], rot: ALONG_Z });
    }
  }
}

function tail(b: ModelBuilder): void {
  b.solid(plate([[-6.2, 1.2], [-7.5, 1.2], [-8.2, 3.3], [-7.2, 3.3]], 0.14), SKIN, { at: [0.07, 0, 0], rot: [0, -Math.PI / 2, 0] });
  b.solid(plate([[-1.5, -6.7], [1.5, -6.7], [1.5, -7.3], [-1.5, -7.3]], 0.08), PANEL, { at: [0, 1.32, 0], rot: [Math.PI / 2, 0, 0] });
}

function gear(b: ModelBuilder): void {
  for (const s of [1, -1]) {
    b.box(0.09, 0.8, 0.14, DARK, { at: [s * 1.02, -1.2, 2.4], rot: [0, 0, s * 0.4] });
    b.cyl(0.26, 0.26, 0.15, 10, STEEL, { at: [s * 1.2, -1.6, 2.4], rot: [0, 0, Math.PI / 2] });
  }
  b.box(0.06, 0.5, 0.1, DARK, { at: [0, 0.75, -6.4] });
  b.cyl(0.13, 0.13, 0.08, 8, STEEL, { at: [0, 0.48, -6.4], rot: [0, 0, Math.PI / 2] });
}

function mainRotor(b: ModelBuilder): void {
  b.cyl(0.3, 0.36, 0.26, 10, DARK);
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    const mid = (BLADE_RADIUS + 0.3) / 2;
    b.box(0.36, 0.05, BLADE_RADIUS - 0.3, STEEL, { at: [Math.sin(a) * mid, 0.03, Math.cos(a) * mid], rot: [0.05, a, 0] });
  }
}

function tailRotor(b: ModelBuilder): void {
  b.cyl(0.11, 0.11, 0.2, 8, DARK, { rot: [0, 0, Math.PI / 2] });
  for (let i = 0; i < 4; i++) b.box(0.03, 2.5, 0.17, STEEL, { rot: [(i * Math.PI) / 4, 0, 0] });
}

const ROTORS: readonly RotorSpec[] = [
  { at: [0, 2.5, 0.3], axis: 'y', rate: 30, build: mainRotor, disc: BLADE_RADIUS },
  { at: [0.2, 2.5, -7.75], axis: 'x', rate: 62, build: tailRotor, disc: 1.3 },
];

function strobes(b: ModelBuilder): void {
  b.glow(new THREE.SphereGeometry(0.08, 6, 4), '#ff2a20', 6, { at: [0, 3.35, -7.6] });
  b.glow(new THREE.SphereGeometry(0.06, 6, 4), '#ff2a20', 6, { at: [3.4, 0.2, 0.8] });
  b.glow(new THREE.SphereGeometry(0.06, 6, 4), '#35ff8a', 6, { at: [-3.4, 0.2, 0.8] });
}

export const ATTACK_AIRFRAME: AirframeSpec<AttackMount> = {
  name: 'harrow',
  scale: 1.15,
  build: b => {
    fuselage(b);
    engines(b);
    wings(b);
    tail(b);
    gear(b);
  },
  rotors: ROTORS,
  mounts: { chin: [0, -1.26, 5.2], podLeft: [2.3, -0.48, 2.1], podRight: [-2.3, -0.48, 2.1] },
  strobe: { build: strobes, period: 1.3, lit: 0.11 },
};
