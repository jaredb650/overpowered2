/** Refinery: tank rows, pipe racks and towers, with tight lanes between them and things that explode. */
import type { Kit } from '../kit/kit';
import { FACE } from '../kit/geo';
import { barrier, cable, machine, pipe, signPanel, sphereTank, tank, tower, vent, wallLamp } from '../kit/props';
import { signId } from '../kit/signs';
import * as THREE from 'three';
import type { MapSpec } from './spec';
import { LEVEL, RING, SUMP } from './layout';
import { ringStile } from './ring';

const CW = LEVEL.catwalk;
const TANK_X = 95;

export function authorRefinery(k: Kit, spec: MapSpec): void {
  sump(k, spec);
  racks(k, spec);
  tanks(k, spec);
  towers(k, spec);
  farm(k, spec);
  spec.view('refinery_lane', 79, 1.7, -60, 86, 4, 20);
  spec.view('refinery_rack', 112, CW + 1.7, -46, 112, 6, 40);
  spec.view('refinery_sump', 112, SUMP.y + 1.7, 44, 112, SUMP.y + 3, -40);
  spec.view('refinery_alley', 122, 1.7, 8, 126, 5, -58);
  spec.view('refinery_top', 138, 30, -70, 96, 2, 20);
  spec.view('tank_farm', 74, 3, -80, 122, 10, -128);
  spec.view('refinery_barrels', 92, 1.6, -55, 98, 0.6, -49.5);
  spec.view('refinery_electric', 112, SUMP.y + 2.2, 4, 112, SUMP.y + 0.5, 34);
}

function sump(k: Kit, spec: MapSpec): void {
  const g = k.geo;
  const { x0, x1, z0, z1, y } = SUMP;
  const o = { thick: 1, bay: 8, lift: 2.4, cap: false, mat: 'concreteDark' as const, strip: { mat: 'emissiveCyan' as const, y: -1.1, h: 0.08 } };
  k.wall(x0, z0, x1, z0, y, 0, { ...o, openings: [{ u0: 2, u1: 14, v0: y, v1: -2 }] });
  k.wall(x1, z0, x1, z1, y, 0, o);
  k.wall(x1, z1, x0, z1, y, 0, { ...o, openings: [{ u0: 2, u1: 14, v0: y, v1: -2 }] });
  k.wall(x0, z1, x0, z0, y, 0, { ...o, openings: [{ u0: 56 - 6.5, u1: 56 + 6.5, v0: y, v1: -2, frame: true }] });
  k.floor('concreteDark', x0, z0, x1, z1, y, 1, 2.5);
  // Drains and a gutter down the middle.
  g.use('grate').box(112, y + 0.02, 0, 1, 0.015, 54, FACE.py);
  g.use('steelDark').box(112, y + 0.015, 0, 1.2, 0.015, 54.2, FACE.py);
  // Two flooded stretches go live on a cycle. The dry middle and the ends are the safe beats.
  for (const [a, b, phase] of [[-34, -12, 0], [12, 34, 3.5]] as const) {
    const box = new THREE.Box3(new THREE.Vector3(x0, y - 0.2, a), new THREE.Vector3(x1, y + 2.2, b));
    spec.electric.push({ box, period: 7, onTime: 2.6, phase });
    g.use('steel').tint(0.55).gridStep(x0, y + 0.03, b, x1 - x0, 0, 0, 0, 0, a - b, 2);
    g.tint(1);
    g.use('hazard');
    g.box(112, y + 0.05, a, 8, 0.02, 0.3, FACE.py);
    g.box(112, y + 0.05, b, 8, 0.02, 0.3, FACE.py);
    for (const z of [a + 3, b - 3]) {
      signPanel(k, x0 + 0.2, y + 3, z, Math.PI / 2, 4, 1, signId('HIGH VOLTAGE'), false);
    }
    for (let z = a + 2; z < b; z += 5) {
      machine(k, x1 - 1.2, y, z, -Math.PI / 2, 2, 1.2, 1);
    }
  }
  // Ladder of steel steps out of the sump, in pairs, so it never traps anyone.
  k.stairs(x0 + 3, -46, y, x0 + 3, -60 + 3, 0, 3, 'steel');
  k.stairs(x1 - 3, 46, y, x1 - 3, 57, 0, 3, 'steel');
  k.stairs(x1 - 3, -5, y, x1 - 3, 7, 0, 2.8, 'steel');
  k.floor('concrete', x0 - 1, -60, x0 + 5, -56, 0, 0.5);
  k.floor('concrete', x1 - 5, 56, x1 + 1, 60, 0, 0.5);
  for (let z = -48; z <= 48; z += 16) k.lampBar(116, -2.2, z, Math.PI / 2, 3, 'cyan', 22, 14);
  for (let z = -40; z <= 40; z += 40) spec.pickup(106, y + 1, z);
  spec.gate('refinery', 112, y + 0.1, -54);
  spec.gate('refinery', 112, y + 0.1, 54);
  spec.barrels(107, y, -5, 3);
  spec.barrels(118, y, 8, 2);
}

function rackBent(k: Kit, x: number, z: number, w: number): void {
  // One bent of the pipe rack: two columns, a beam at walkway height and a beam below it.
  const g = k.geo;
  for (const s of [-1, 1]) {
    k.block('steelDark', x + s * w / 2 - 0.22, 0, z - 0.22, x + s * w / 2 + 0.22, CW, z + 0.22, 0.04);
    g.use('concreteDark').bevel(x + s * w / 2, 0.3, z, 0.6, 0.3, 0.6, 0.05);
  }
  k.ibeam(x - w / 2, CW - 0.5, z, x + w / 2, CW - 0.5, z, 0.5, 0.3);
  k.ibeam(x - w / 2, CW - 3.2, z, x + w / 2, CW - 3.2, z, 0.44, 0.26);
}

function racks(k: Kit, spec: MapSpec): void {
  const rx = 112, w = 10;
  // North-south rack straddles the sump: walkway on top, pipes under it.
  for (let z = -66; z <= 66; z += 11) {
    if (Math.abs(z) < 4) continue;
    if (Math.abs(z) < 57) {
      // Hangs from the sump lips.
      for (const s of [-1, 1]) k.block('steelDark', rx + s * 9 - 0.22, 0, z - 0.22, rx + s * 9 + 0.22, CW, z + 0.22, 0.04);
      k.ibeam(rx - 9, CW - 0.5, z, rx + 9, CW - 0.5, z, 0.5, 0.3);
    } else rackBent(k, rx, z, w);
  }
  k.catwalk(rx, -69, rx, 69, CW, 5, 'both');
  // Ends reach out to the viaducts, so the catwalk ring never touches the ground.
  k.catwalk(rx - 2, -68, 97.6, -85, CW, 3.2, 'both');
  k.catwalk(rx - 2, 68, 97.6, 85, CW, 3.2, 'both');
  for (const [dx, dy, r] of [[-3.8, -1.2, 0.5], [-2.6, -1.2, 0.5], [-1.3, -1.25, 0.42], [1.2, -1.2, 0.55], [3, -1.25, 0.34], [-3, -3.6, 0.6], [0, -3.6, 0.4], [3.2, -3.6, 0.46]] as const) {
    pipe(k, [rx + dx, CW + dy, -69, rx + dx, CW + dy, 69], r, dx > 0 ? 'steel' : 'panel', 11, 10);
  }

  // East-west rack flanking the spoke road, joining the walkway to the Rim side.
  for (const z of [-9, 9]) {
    for (let x = 78; x <= 104; x += 13) rackBent(k, x, z, 3.6);
    for (const dy of [-1.1, -1.8]) {
      pipe(k, [74, CW + dy, z - 0.8, 104, CW + dy, z - 0.8], 0.36, 'steel', 8, 8);
      pipe(k, [74, CW + dy, z + 0.8, 104, CW + dy, z + 0.8], 0.28, 'panel', 8, 8);
    }
    k.catwalk(74, z, 106.5, z, CW, 3.2, 'both');
  }
  // Link across the road and into the Core-side bridge.
  k.catwalk(106.5, -10.6, 106.5, 10.6, CW, 3.2, 'none');
  k.catwalk(106.5, 0, 111, 0, CW, 3.2, 'none');
  k.floor('steelDark', 73, -10.6, 77, 10.6, CW, 0.5, 2, 'grate');
  // Stair to the road.
  k.stairs(88, 11.5, CW, 76, 11.5, 0, 3, 'steel', true);
  k.stairs(92, -11.5, 0, 104, -11.5, CW, 3, 'steel', true);
  k.stairs(rx + 7, 62, 0, rx + 7, 72, CW, 3, 'steel', true);
  k.catwalk(rx + 2.5, 72, rx + 7, 72, CW, 3, 'none');

  signPanel(k, 96, 6.6, 9.8, 0, 10, 2.5, signId('REFINERY'));
  signPanel(k, 96, 6.6, -9.8, Math.PI, 10, 2.5, signId('SECTOR 03'));
  spec.pad(86, 0, -67, rx, CW, -66, 3);
  spec.pad(86, 0, 67, rx, CW, 66, 3);
  spec.pickup(rx, CW + 1, 0);
}

function tanks(k: Kit, spec: MapSpec): void {
  // Tank row: bund walls make low cover and force you into the alleys between tanks.
  const zs = [-58, -41, -24, 24, 41, 58];
  for (const z of zs) {
    tank(k, TANK_X, z, 0, 7, 15, z < 0 ? 'panel' : 'steel', { bands: 4 });
    const a = TANK_X - 8.6;
    k.block('concrete', a, 0, z - 8.5, a + 0.5, 1.6, z + 8.2, 0.06);
    pipe(k, [TANK_X + 7, 4, z, TANK_X + 8.8, 4, z, TANK_X + 8.8, CW - 1.2, z], 0.3, 'steel', 6, 8);
    vent(k, TANK_X - 6.8, 2, z - 3, Math.PI / 2 + 0.6, 1, 0.8);
  }
  // Walkway over the tank tops, joined to the racks by the alley bridges.
  for (const z of [-58, -41, -24]) k.catwalk(TANK_X, z - 8.5, TANK_X, z + 8.5, 15.4, 2.8, 'both');
  for (const z of [24, 41, 58]) k.catwalk(TANK_X, z - 8.5, TANK_X, z + 8.5, 15.4, 2.8, 'both');
  k.catwalk(TANK_X, -32.5, 108, -32.5, 15.4, 2.6, 'both');
  k.catwalk(TANK_X, 32.5, 108, 32.5, 15.4, 2.6, 'both');
  k.stairs(108, -44, CW, 108, -32.5 - 1.4, 15.4, 2.4, 'steel');
  k.stairs(108, 44, CW, 108, 32.5 + 1.4, 15.4, 2.4, 'steel');

  // Explosives sit in the alleys, where a shot through the gap pays off.
  for (const z of [-49.5, -32.5, 32.5, 49.5]) {
    spec.barrels(TANK_X + 2, 0, z, 4);
    spec.tank(TANK_X - 6, 0, z);
  }
  spec.barrels(82, 0, -30, 5);
  spec.barrels(82, 0, 34, 5);
  spec.tank(124, 0, -12);
  spec.tank(124, 0, 12);
  barrier(k, 78, 0, -44, Math.PI / 2, 4);
  barrier(k, 88, 0, -18, 0.1, 4);
  barrier(k, 80, 0, 22, Math.PI / 2 + 0.1, 4);
  barrier(k, 86, 0, 48, 0, 4);
  k.mast(76, -36, 0, 14, -Math.PI / 2, 'white', 110, 36);
  k.mast(76, 36, 0, 14, -Math.PI / 2, 'white', 110, 36);
  for (const z of [-49.5, -32.5, 32.5, 49.5]) {
    wallLamp(k, TANK_X + 3, 3.5, z, -Math.PI / 2, 'cyan', 18, 12);
  }
  spec.pickup(95, 16.4, -41);
  spec.pickup(95, 16.4, 41);
  spec.pickup(84, 1, 0);
}

function towers(k: Kit, spec: MapSpec): void {
  // Distillation columns on the east side, tall enough to read from the Core, with bridges to the Ring Road.
  const edge = RING.half - RING.width / 2;
  for (const [z, h] of [[-32, 44], [32, 50]] as const) {
    tower(k, 131, z, 0, 4.2, h, [CW, LEVEL.ring, 30]);
    k.catwalk(112 + 2.5, z, 131 - 5.4, z, CW, 3, 'both');
    k.catwalk(131 + 5.4, z, edge - 2.4, z, LEVEL.ring, 3.4, 'both');
    ringStile(k, edge + 0.25, z, 1, 0, 3.4);
    k.stairs(127 - 5, z + 7, 0, 127 - 5, z + 7 + 14, CW, 2.6, 'steel');
    k.floor('steelDark', 120, z + 21, 124, z + 24, CW, 0.3, 2, 'grate');
    k.catwalk(122, z + 22.5, 114.5, z + 22.5, CW, 2.6, 'none');
    k.floor('steelDark', 130.5, z + 4.8, 135.5, z + 9.5, CW, 0.3, 2, 'grate');
    spec.pad(133, CW, z + 7.2, 138.2, LEVEL.ring, z + 0.4, 3, 1.5);
    k.light(131, CW + 4, z + 8, 'white', 50, 20);
  }
  tower(k, 124, -66, 0, 2.6, 30, []);
  tower(k, 136, 62, 0, 3, 34, []);

  // Alleys on the east side: low blocks and machinery in a tight weave.
  for (let z = -56; z <= 56; z += 14) {
    if (Math.abs(z) < 10) continue;
    k.block('concrete', 125, 0, z - 4, 127, 2.4, z + 4, 0.08);
    machine(k, 134, 0, z + 3, Math.PI / 2, 4, 2.6, 3);
  }
  for (let z = -60; z <= 60; z += 20) {
    pipe(k, [126, 0.8, z, 126, 3.4, z, 121, 3.4, z, 121, 0.6, z], 0.26, 'steel', 6, 8);
  }
  cable(k, 131, 16, -32, 131, 16, 32, 8, 0.07);
  signPanel(k, 128.2, 3, 5, Math.PI / 2, 4.4, 1.1, signId('COOLANT'));
  spec.pad(133, 0, -2, 150, LEVEL.ring, -2, 5);
  spec.pickup(131, 1, 0);
}

function farm(k: Kit, spec: MapSpec): void {
  // Tank Farm: three pressure spheres under the viaduct. The landmark of the north-east corner.
  sphereTank(k, 120, -96, 0, 10);
  sphereTank(k, 96, -122, 0, 8.5);
  sphereTank(k, 128, -76 + 0, 0, 7);
  pipe(k, [86, 1.2, -96, 112, 1.2, -96], 0.5, 'steel', 7, 10);
  pipe(k, [96, 1.2, -96, 96, 1.2, -116], 0.5, 'steel', 7, 10);
  k.mast(84, -112, 0, 15, 2.3, 'white', 110, 36);
  k.mast(136, -104, 0, 13, -2.2, 'cyan', 80, 30);
  signPanel(k, 80, 6, -106, Math.PI / 2, 7, 1.75, signId('TANK FARM'));
  spec.barrels(108, 0, -112, 4);
  spec.tank(112, 0, -116);
  spec.pickup(96, 1, -100);
}
