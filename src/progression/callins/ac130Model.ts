/**
 * The gunship, built to the real aircraft's proportions: 30 m long, 40 m across, a high wing with four turboprops, the
 * tall swept fin and the upswept tail. The guns are thicker than life, because the left side is what the player sees
 * from inside the circle and a true 25mm barrel is under a pixel from there.
 *
 * Gun line, nose to tail, as on the real ship: 25mm Gatling, 40mm Bofors, 105mm howitzer.
 */
import * as THREE from 'three';
import type { ModelBuilder } from '../modelkit';
import type { AirframeSpec, Point, RotorSpec } from './airframe';

export type Ac130Mount = 'gun25' | 'gun40' | 'gun105' | 'railLeft' | 'railRight' | 'flareLeft' | 'flareRight';

const GREY = '#515a64';
const LIGHT = '#6c7682';
const DARK = '#2c323a';
const BELLY = '#3c434c';
const STEEL = '#20252b';
const GLASS = '#0d1216';

/**
 * Below the wing line, in the aircraft's own frame. The rest of the angle down to the target comes from the bank, so
 * the barrels look as if they are pointing where the rounds go.
 */
const DEPRESSION = 0.2;
const COS_D = Math.cos(DEPRESSION);
const SIN_D = Math.sin(DEPRESSION);

function tube(b: ModelBuilder, frontR: number, backR: number, frontZ: number, backZ: number, frontY: number, backY: number, color: string, seg = 16): void {
  const dz = frontZ - backZ;
  const dy = frontY - backY;
  b.cyl(frontR, backR, Math.hypot(dz, dy), seg, color, {
    at: [0, (frontY + backY) / 2, (frontZ + backZ) / 2],
    rot: [Math.PI / 2 - Math.atan2(dy, dz), 0, 0],
  });
}

function plate(points: readonly (readonly [number, number])[], thickness: number): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(points[0]![0], points[0]![1]);
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i]![0], points[i]![1]);
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
}

function fuselage(b: ModelBuilder): void {
  tube(b, 2.2, 2.2, 8.2, -3.2, 0, 0, GREY);
  tube(b, 1.75, 2.2, 11.2, 8.2, -0.12, 0, GREY);
  tube(b, 0.95, 1.75, 13, 11.2, -0.42, -0.12, GREY);
  b.solid(new THREE.SphereGeometry(1, 12, 8), DARK, { at: [0, -0.44, 13], scale: [0.95, 0.9, 1.6] });
  // The upswept tail, the loading ramp's underside, and what is left of the cone behind it.
  tube(b, 2.2, 1.35, -3.2, -9.6, 0, 0.8, GREY);
  tube(b, 1.35, 0.62, -9.6, -13.2, 0.8, 1.6, GREY);
  tube(b, 0.62, 0.18, -13.2, -15, 1.6, 2, DARK);
  // Flight deck: the stepped brow and the windows that give the nose its face.
  b.box(2.9, 0.75, 2.2, LIGHT, { at: [0, 1.5, 10.2], rot: [0.18, 0, 0] });
  b.box(2.5, 0.42, 0.1, GLASS, { at: [0, 1.46, 11.28], rot: [0.5, 0, 0] });
  for (const s of [1, -1]) b.box(0.1, 0.4, 1.3, GLASS, { at: [s * 1.44, 1.46, 10.4] });
  // Satcom hump and the long equipment fairing along the spine.
  b.box(0.9, 0.4, 7, LIGHT, { at: [0, 2.32, -5.4] });
  b.solid(new THREE.SphereGeometry(0.7, 10, 6), LIGHT, { at: [0, 2.2, 7], scale: [1, 0.55, 1.5] });
  // Sensor balls under the nose: the crew's eyes, and the first thing anyone recognises as a gunship.
  b.solid(new THREE.SphereGeometry(0.62, 12, 8), DARK, { at: [0.5, -1.95, 10.6] });
  b.solid(new THREE.SphereGeometry(0.46, 10, 8), DARK, { at: [-0.7, -1.84, 9.1] });
  b.glow(new THREE.CircleGeometry(0.2, 10), '#7fd8ff', 2.4, { at: [0.68, -2.3, 10.82], rot: [Math.PI / 2 + 0.45, 0, 0] });
  for (const s of [1, -1]) {
    // Gear sponsons, the long blisters low on each side.
    b.box(1.1, 1.55, 6, BELLY, { at: [s * 2.25, -1.32, 1.1] });
    b.solid(new THREE.SphereGeometry(0.78, 10, 6), BELLY, { at: [s * 2.25, -1.32, 4.1], scale: [0.72, 1, 1.3] });
    b.solid(new THREE.SphereGeometry(0.78, 10, 6), BELLY, { at: [s * 2.25, -1.32, -1.9], scale: [0.72, 1, 1.5] });
  }
}

function wings(b: ModelBuilder): void {
  // Drawn flat in plan and laid down, so a tapered wing is one extrusion and not a stack of boxes.
  const span = 20.2;
  b.solid(plate([[-span, 2.5], [0, 3.8], [span, 2.5], [span, 0.3], [0, -1.8], [-span, 0.3]], 0.46), GREY, { at: [0, 2.72, 0], rot: [Math.PI / 2, 0, 0] });
  b.box(3.4, 0.85, 6, GREY, { at: [0, 2.3, 1] });
  // Fin and tailplane.
  b.solid(plate([[-8.8, 1.8], [-14.2, 1.8], [-16, 9.6], [-13.8, 9.6]], 0.34), GREY, { at: [0.17, 0, 0], rot: [0, -Math.PI / 2, 0] });
  b.solid(plate([[-8.3, -14.2], [0, -11.4], [8.3, -14.2], [8.3, -15.8], [0, -16.2], [-8.3, -15.8]], 0.2), GREY, { at: [0, 2.72, 0], rot: [Math.PI / 2, 0, 0] });
}

const ENGINES = [6.4, 12.2, -6.4, -12.2] as const;
const ENGINE_Y = 1.86;
const HUB_Z = 6.1;

function nacelle(b: ModelBuilder, x: number): void {
  const along = (frontR: number, backR: number, front: number, back: number, y: number, color: string) => {
    b.cyl(frontR, backR, front - back, 12, color, { at: [x, y, (front + back) / 2], rot: [Math.PI / 2, 0, 0] });
  };
  along(0.74, 0.8, 5.7, 1, ENGINE_Y, GREY);
  along(0.72, 0.28, 1, -2.8, 2.08, GREY);
  b.box(0.92, 0.5, 2.3, BELLY, { at: [x, ENGINE_Y - 0.72, 4.3] });
  b.box(0.3, 0.8, 2.6, GREY, { at: [x, 2.42, 2.3] });
  // Exhaust on the outboard side, the only warm thing on the ship.
  const out = Math.sign(x);
  b.cyl(0.16, 0.2, 0.7, 8, STEEL, { at: [x + out * 0.72, ENGINE_Y + 0.15, 1.4], rot: [0, 0, Math.PI / 2] });
  b.glow(new THREE.CircleGeometry(0.14, 8), '#ff8a3a', 2.2, { at: [x + out * 1.08, ENGINE_Y + 0.15, 1.4], rot: [0, out * Math.PI / 2, 0] });
}

function blades(b: ModelBuilder): void {
  b.solid(new THREE.ConeGeometry(0.42, 1.05, 10), DARK, { at: [0, 0, 0.3], rot: [Math.PI / 2, 0, 0] });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    b.box(0.3, 2.05, 0.05, STEEL, { at: [Math.sin(a) * 1.1, Math.cos(a) * 1.1, 0], rot: [0.28, 0, -a] });
  }
}

/** Places a barrel leaving the side at `x`, `y`, `z`, and returns where its muzzle is. */
function barrel(b: ModelBuilder, x: number, y: number, z: number, length: number, radius: number, color: string, across = 0): Point {
  b.cyl(radius, radius, length, 8, color, {
    at: [x + (COS_D * length) / 2, y - (SIN_D * length) / 2, z + across],
    rot: [0, 0, -(Math.PI / 2 + DEPRESSION)],
  });
  return [x + COS_D * length, y - SIN_D * length, z + across];
}

function gunPort(b: ModelBuilder, x: number, y: number, z: number, h: number, w: number): void {
  b.box(0.5, h + 0.34, w + 0.34, LIGHT, { at: [x - 0.1, y, z] });
  b.box(0.54, h, w, GLASS, { at: [x - 0.08, y, z] });
}

const MUZZLE_25: Point = [5.14, -0.96, 6.9];
const MUZZLE_40: Point = [5.73, -1.17, -2.6];
const MUZZLE_105: Point = [6.26, -1.45, -6.5];

function gunLine(b: ModelBuilder): void {
  // 25mm: five barrels in a blister forward of the wing.
  gunPort(b, 2.2, -0.34, 6.9, 1.1, 1.5);
  b.cyl(0.33, 0.33, 0.9, 10, STEEL, { at: [2.5, -0.4, 6.9], rot: [0, 0, -(Math.PI / 2 + DEPRESSION)] });
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    barrel(b, 2.3, -0.38 + Math.sin(a) * 0.17, 6.9, 2.9, 0.075, STEEL, Math.cos(a) * 0.17);
  }
  b.cyl(0.27, 0.27, 0.12, 10, DARK, { at: [4.85, -0.9, 6.9], rot: [0, 0, -(Math.PI / 2 + DEPRESSION)] });

  // 40mm: one long barrel behind the gear, with its flash hider.
  gunPort(b, 2.05, -0.42, -2.6, 1.2, 1.5);
  b.cyl(0.26, 0.3, 1, 10, STEEL, { at: [2.4, -0.52, -2.6], rot: [0, 0, -(Math.PI / 2 + DEPRESSION)] });
  barrel(b, 2.2, -0.45, -2.6, 3.6, 0.13, STEEL);
  barrel(b, 5, -1.02, -2.6, 0.75, 0.21, DARK);

  // 105mm: the reason the ship exists. Recoil sleeve, tube and muzzle brake.
  gunPort(b, 1.8, -0.5, -6.5, 1.6, 1.9);
  barrel(b, 1.8, -0.55, -6.5, 1.9, 0.34, STEEL);
  barrel(b, 2.2, -0.63, -6.5, 4.1, 0.2, STEEL);
  barrel(b, 5.55, -1.31, -6.5, 0.72, 0.33, DARK);
}

const RAIL_X = 15.6;

function stores(b: ModelBuilder): void {
  for (const s of [1, -1]) {
    b.box(0.26, 0.72, 2.2, DARK, { at: [s * RAIL_X, 1.95, 1.4] });
    b.box(1.1, 0.14, 2.3, BELLY, { at: [s * RAIL_X, 1.56, 1.4] });
    for (const dx of [-0.34, 0.34]) {
      b.cyl(0.13, 0.13, 2, 8, LIGHT, { at: [s * RAIL_X + dx, 1.32, 1.5], rot: [Math.PI / 2, 0, 0] });
      b.solid(new THREE.ConeGeometry(0.13, 0.34, 8), DARK, { at: [s * RAIL_X + dx, 1.32, 2.66], rot: [Math.PI / 2, 0, 0] });
    }
    // Flare buckets on the back of each sponson.
    b.box(0.5, 0.34, 0.9, STEEL, { at: [s * 2.55, -1.92, -2.4] });
  }
}

function lights(b: ModelBuilder): void {
  // Red on the left, green on the right, as on anything that flies. They keep the shape readable in a dark sky.
  b.glow(new THREE.SphereGeometry(0.22, 6, 4), '#ff2020', 7, { at: [20.3, 2.5, 1.2] });
  b.glow(new THREE.SphereGeometry(0.22, 6, 4), '#20ff60', 7, { at: [-20.3, 2.5, 1.2] });
  b.glow(new THREE.SphereGeometry(0.18, 6, 4), '#dfe8ff', 5, { at: [0, 2.05, -15.1] });
}

function strobes(b: ModelBuilder): void {
  b.glow(new THREE.SphereGeometry(0.34, 6, 4), '#ff3030', 12, { at: [0, 9.8, -15] });
  b.glow(new THREE.SphereGeometry(0.34, 6, 4), '#ff3030', 12, { at: [0, -2.4, -1] });
}

const ROTORS: readonly RotorSpec[] = ENGINES.map(x => ({ at: [x, ENGINE_Y, HUB_Z] as Point, axis: 'z', rate: 38, build: blades, disc: 2.1 }));

export const AC130_AIRFRAME: AirframeSpec<Ac130Mount> = {
  name: 'ac130',
  build(b) {
    fuselage(b);
    wings(b);
    for (const x of ENGINES) nacelle(b, x);
    gunLine(b);
    stores(b);
    lights(b);
  },
  rotors: ROTORS,
  mounts: {
    gun25: MUZZLE_25,
    gun40: MUZZLE_40,
    gun105: MUZZLE_105,
    railLeft: [RAIL_X, 1.1, 1.5],
    railRight: [-RAIL_X, 1.1, 1.5],
    flareLeft: [2.55, -2.1, -2.8],
    flareRight: [-2.55, -2.1, -2.8],
  },
  strobe: { build: strobes, period: 1.4, lit: 0.09 },
};
