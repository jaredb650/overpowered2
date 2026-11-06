/** Foundry: an enormous casting hall with a river of lava down its length. The only warm light on the map. */
import type { Kit } from '../kit/kit';
import { FACE } from '../kit/geo';
import { cable, machine, pipe, rebar, rubble, signPanel, tank, vent, wallLamp } from '../kit/props';
import { signId } from '../kit/signs';
import * as THREE from 'three';
import type { MapSpec } from './spec';
import { HALL, LAVA, LEVEL, RING } from './layout';
import { ringStile } from './ring';

const { x: HX, z0: Z0, z1: Z1, height: H } = HALL;
const CW = LEVEL.catwalk;
const WALK = 14;
const BAY = 17;

export function authorFoundry(k: Kit, spec: MapSpec): void {
  shell(k, spec);
  channel(k, spec);
  furnace(k, spec);
  catwalks(k, spec);
  northStrip(k, spec);
  yards(k, spec);
  light(k);
  spec.view('foundry_door', 0, 1.7, -80, 0, 8, -126);
  spec.view('foundry_catwalk', -60, CW + 1.7, -78, 20, 2, -118);
  spec.view('foundry_gallery', -44, LAVA.galleryY + 1.7, -98, 40, -2, -118);
  spec.view('foundry_top', 58, 22, -132, -30, 6, -88);
  spec.view('foundry_press', 28, 1.7, -130, 68, 3, -130);
}

function shell(k: Kit, spec: MapSpec): void {
  const g = k.geo;
  const trim = { mat: 'emissiveOrange' as const, y: 6, h: 0.1 };
  const wall = { thick: 1.6, bay: BAY, lift: 3.4, strip: trim, back: false };
  // South wall: main doors on the spoke, catwalk door above them, side doors to the corner plazas.
  k.wall(HX, Z1, -HX, Z1, 0, H, {
    ...wall, back: true,
    openings: [
      { u0: HX - 13, u1: HX + 13, v0: 0, v1: 14, frame: true },
      { u0: 12, u1: 22, v0: 0, v1: 7, frame: true },
      { u0: HX * 2 - 22, u1: HX * 2 - 12, v0: 0, v1: 7, frame: true },
    ],
  });
  // North wall, with breaches at walkway height that open onto the Ring Road.
  k.wall(-HX, Z0, HX, Z0, 0, H, {
    ...wall,
    openings: [
      { u0: HX - 42, u1: HX - 30, v0: WALK, v1: WALK + 5.5, frame: true },
      { u0: HX + 30, u1: HX + 42, v0: WALK, v1: WALK + 5.5, frame: true },
    ],
  });
  // End walls with a big ground door and a catwalk door.
  k.wall(HX, Z0, HX, Z1, 0, H, {
    ...wall,
    openings: [
      { u0: 3, u1: 13, v0: 0, v1: 7, frame: true },
      { u0: 36, u1: 46, v0: CW, v1: CW + 4, frame: true },
    ],
  });
  k.wall(-HX, Z1, -HX, Z0, 0, H, {
    ...wall,
    openings: [
      { u0: 51, u1: 61, v0: 0, v1: 7, frame: true },
      { u0: 18, u1: 28, v0: CW, v1: CW + 4, frame: true },
    ],
  });

  // Portal frames: a column pair and a roof truss every bay. This repetition is what makes the hall feel huge.
  for (let x = -HX + BAY; x < HX; x += BAY) {
    for (const s of [1, -1]) {
      k.push(x, 0, s > 0 ? Z1 - 2 : Z0 + 2, 0);
      k.block('concrete', -1.3, 0, -1.2, 1.3, 22, 1.2, 0.14);
      g.use('concreteDark').bevel(0, 0.7, 0, 1.6, 0.7, 1.5, 0.1);
      k.deco('steelDark', -0.7, 22, -0.8, 0.7, H - 3, 0.8, 0.08);
      // Crane corbel.
      k.block('concrete', -1.3, 20.4, -1.2 - (s > 0 ? 1.5 : 0), 1.3, 22, 1.2 + (s < 0 ? 1.5 : 0), 0.14);
      k.pop();
    }
    k.truss(x, H - 3.2, Z1 - 1, x, H - 3.2, Z0 + 1, 4.2, 0, 'steelDark', 0.22);
    k.lampBar(x, H - 6.2, -106, Math.PI / 2, 9, 'orange', 120, 40);
    pipe(k, [x - 3, H - 0.8, Z1, x - 3, H - 0.8, Z0], 0.1, 'steelDark', 30, 6);
  }

  // Crane rails along both long walls, on top of the corbels.
  for (const z of [Z1 - 3.1, Z0 + 3.1]) {
    k.ibeam(-HX + 1, 22.35, z, HX - 1, 22.35, z, 0.7, 0.9, 'steel');
    k.ibeam(-HX + 1, 21.5, z, HX - 1, 21.5, z, 1.2, 0.6, 'steelDark');
  }

  // Roof: long plates with a skylight slot on the centreline of each bay row.
  const roofY = H + 0.2;
  for (const [a, b] of [[Z1 - 2, -98], [-114, -128], [-128, Z0 + 2]] as const) {
    k.mass('steelDark', -HX - 1, roofY - 0.2, b, HX + 1, roofY + 0.2, a, 4);
  }
  g.use('glass').gridStep(-HX, roofY + 0.1, -98, HX * 2, 0, 0, 0, 0, -16, 8);
  k.collide(0, roofY, -106, HX, 0.3, 8, 'glass', false);
  for (let x = -HX + 8; x < HX; x += 8.5) {
    k.ibeam(x, roofY + 0.15, -114, x, roofY + 0.15, -98, 0.3, 0.2, 'steelDark');
  }
  // Skyline: chimneys are the silhouette across the map, with beacons reading through fog.
  for (const x of [-48, -32, 44]) {
    const h = x === -32 ? 62 : 54;
    g.use('concreteDark').tint(0.82).lathe([4.2, H, 4, H + 6, 3.2, h - 2, 3.6, h - 1.5, 3.6, h, 2.8, h, 2.8, h - 3], x, 0, -128, 20, false);
    g.tint(1).use('steelDark');
    for (let y = H + 10; y < h - 3; y += 7) g.lathe([3.72 - (y - H) * 0.014, y - 0.2, 3.9 - (y - H) * 0.014, y - 0.1, 3.9 - (y - H) * 0.014, y + 0.1, 3.72 - (y - H) * 0.014, y + 0.2], x, 0, -128, 20, false);
    g.use('emissiveRed').cyl(x, h + 0.8, -128, x, h + 1.2, -128, 0.25, 0.25, 6);
    g.use('steelDark').cyl(x + 3, h, -128, x + 3, h + 1, -128, 0.06, 0.06, 4, false, false);
    k.collidePrism(x, -128, H, h, 3.8, 10, 'concrete', true);
  }

  // Outside faces: buttresses on the south wall, facing the Core.
  for (let x = -HX + 8.5; x < HX; x += BAY) {
    if (Math.abs(x) < 16) continue;
    k.along(x, 0, Z1 + 4.6, x, 18, Z1 + 0.9, len => {
      g.use('concrete').tint(0.85).bevel(len / 2, 0, 0, len / 2, 0.8, 1.2, 0.1);
      g.tint(1);
      k.collide(len / 2, 0, 0, len / 2, 0.8, 1.2, 'concrete');
    });
  }
  signPanel(k, 0, 16.5, Z1 + 1.1, 0, 14, 3.5, signId('FOUNDRY'));
  signPanel(k, 0, 16.2, Z1 - 1.1, Math.PI, 14, 3.5, signId('REACTOR ACCESS'));
  spec.gate('foundry', -HX + 2, 0.1, -100);
  spec.gate('foundry', 0, 0.1, Z0 + 4);
}

function channel(k: Kit, spec: MapSpec): void {
  const g = k.geo;
  const { x0, x1, z0, z1, y, galleryZ1, galleryY } = LAVA;
  const gal = galleryY;
  // Walls of the cut, clockwise so they face in.
  const o = { thick: 1, bay: 8, lift: 2.6, cap: false, mat: 'concreteDark' as const, strip: { mat: 'emissiveOrange' as const, y: -1.2, h: 0.08 } };
  k.wall(x0, z0, x1, z0, y - 1, 0, o);
  k.wall(x1, z0, x1, galleryZ1, y - 1, 0, { ...o, openings: [{ u0: 18.5 + 2, u1: 30, v0: gal, v1: -2 }] });
  k.wall(x1, galleryZ1, x0, galleryZ1, gal, 0, { ...o, openings: [{ u0: 56 - 6.5, u1: 56 + 6.5, v0: gal, v1: -2, frame: true }] });
  k.wall(x0, galleryZ1, x0, z0, y - 1, 0, { ...o, openings: [{ u0: 0, u1: 9.5, v0: gal, v1: -2 }] });

  // Lava surface and the steps of crust at its banks.
  g.use('lava').gridStep(x0, y, z1, x1 - x0, 0, 0, 0, 0, z0 - z1, 3);
  g.use('rust').tint(0.35);
  for (let x = x0 + 2; x < x1; x += 5.5) {
    const s = k.rand(1.2, 3.4);
    g.bevel(x, y + 0.02, z0 + k.rand(0.6, 2), s, 0.2, k.rand(0.7, 1.8), 0.1);
    g.bevel(x + 2, y + 0.02, z1 - k.rand(0.6, 1.6), s, 0.18, k.rand(0.6, 1.2), 0.1);
  }
  g.tint(1);
  k.collide(0, y - 2, (z0 + z1) / 2, (x1 - x0) / 2 + 1, 1, (z1 - z0) / 2 + 1, 'lava');
  spec.lava.push(new THREE.Box3(new THREE.Vector3(x0, y - 4, z0), new THREE.Vector3(x1, y + 1.1, z1)));

  // Lower gallery beside the lava. Close to the heat, with a lip you can fall over.
  k.floor('concreteDark', x0, z1, x1, galleryZ1, gal, 1.2, 3);
  g.use('steelDark').bevel(0, gal + 0.12, z1 + 0.12, (x1 - x0) / 2, 0.14, 0.16, 0.04);
  for (let x = x0 + 4; x < x1 - 2; x += 8) {
    if (Math.abs(x) < 7) continue;
    k.rail([x, gal, z1 + 0.2, x + 4, gal, z1 + 0.2]);
  }
  for (let x = x0 + 8; x < x1 - 4; x += 16) k.column(x, galleryZ1 - 1.1, gal, 0, 1.3, 'concreteDark');

  // Bridges. The east one has dropped its middle: a jump worth making, over lava.
  const bridge = (x: number, w: number, a: number, b: number) => {
    k.mass('concrete', x - w / 2, -1, b, x + w / 2, 0, a, 3);
    k.deco('steelDark', x - w / 2 - 0.15, -1.2, b, x - w / 2 + 0.05, 0.3, a, 0.04);
    k.deco('steelDark', x + w / 2 - 0.05, -1.2, b, x + w / 2 + 0.15, 0.3, a, 0.04);
    k.rail([x - w / 2, 0.3, a, x - w / 2, 0.3, b]);
    k.rail([x + w / 2, 0.3, a, x + w / 2, 0.3, b]);
  };
  bridge(0, 11, z1 + 12, z0);
  bridge(-34, 7, z1 + 12, z0);
  bridge(34, 7, z1 + 12, -100 - 2);
  bridge(34, 7, -116, z0);
  rebar(k, 34, 0, -102, Math.PI, 7, 12);
  rebar(k, 34, 0, -116, 0, 7, 12);
  rubble(k, 34, y + 0.1, -109, 3.2, 12, 'concrete');
  spec.jump(34, 0.1, -100, 34, 0.1, -118);
  // Piers under the bridges, standing in the lava.
  for (const x of [0, -34, 34]) {
    if (x === 34) continue;
    for (const z of [-104, -113]) {
      k.push(x, 0, z, 0);
      k.deco('concreteDark', -2.2, y - 0.5, -1.2, 2.2, -1, 1.2, 0.2);
      k.pop();
    }
  }
  signPanel(k, 34, 1.6, -100.8, 0, 4, 1, signId('GAP AHEAD'));
  signPanel(k, 34, 1.6, -117.2, Math.PI, 4, 1, signId('GAP AHEAD'));
  signPanel(k, -48, -3.4, galleryZ1 - 0.1, Math.PI, 7, 1.75, signId('DANGER: MOLTEN'));

  // Stairs from the gallery to the hall floor, at both ends.
  k.stairs(x0 + 16, galleryZ1 - 3, gal, x0 + 2.5, galleryZ1 - 3, 0, 4);
  k.stairs(x1 - 16, galleryZ1 - 3, gal, x1 - 2.5, galleryZ1 - 3, 0, 4);
  k.floor('concrete', x0, galleryZ1 - 5, x0 + 3, galleryZ1, 0, 0.5);
  k.floor('concrete', x1 - 3, galleryZ1 - 5, x1, galleryZ1, 0, 0.5);

  // Pads throw you from the gallery across the lava to the north strip.
  spec.pad(-46, gal, -98, -46, 0, -129, 4);
  spec.pad(27, gal, -98, 27, 0, -128, 4);
  spec.pickup(-20, gal + 1, -98);
  spec.pickup(0, 1, -108);
}

function furnace(k: Kit, spec: MapSpec): void {
  const g = k.geo;
  const z = Z0 + 1;
  // Blast furnace against the north wall. A stepped mass with a deep mouth, lit from inside.
  const back = -131;
  k.block('concreteDark', -24, 0, z, -9.5, 26, -124, 0.3);
  k.block('concreteDark', 9.5, 0, z, 24, 26, -124, 0.3);
  k.block('concreteDark', -9.5, 14, z, 9.5, 26, -124, 0.2);
  k.block('concreteDark', -9.5, 0, z, 9.5, 2.4, -124, 0.1);
  k.block('concreteDark', -9.5, 2.4, z, 9.5, 14, back, 0.1);
  k.block('concrete', -17, 26, z, 17, 30, -128, 0.25);
  for (let x = -22; x <= 22; x += 5.5) {
    if (Math.abs(x) < 9) continue;
    k.deco('steelDark', x - 0.4, 0, -124.5, x + 0.4, 26, -123.6, 0.08);
  }
  k.deco('steelDark', -25, 25.3, z, 25, 26.3, -123.3, 0.12);
  for (const y of [9, 18]) {
    k.deco('steel', -24.5, y - 0.3, -124.3, -9.5, y + 0.3, -123.5, 0.08);
    k.deco('steel', 9.5, y - 0.3, -124.3, 24.5, y + 0.3, -123.5, 0.08);
  }
  k.deco('steel', -9.5, 17.7, -124.3, 9.5, 18.3, -123.5, 0.08);
  // Heavy steel frame around the mouth with a tapered lintel.
  k.deco('steelDark', -10.6, 0, -125, -9.3, 15, -123.2, 0.12);
  k.deco('steelDark', 9.3, 0, -125, 10.6, 15, -123.2, 0.12);
  k.deco('steelDark', -10.8, 14, -125, 10.8, 15.6, -123, 0.14);
  // Inside: bars of white heat through a charred grate, so it reads as depth, not a poster.
  g.use('lava').gridStep(-9.4, 2.4, back + 0.02, 18.8, 0, 0, 0, 11.6, 0, 2);
  g.use('emissiveOrange').box(0, 2.6, -128, 9.3, 0.08, 3, FACE.py);
  for (let x = -8; x <= 8; x += 2) k.deco('rust', x - 0.28, 2.4, back + 0.3, x + 0.28, 14, back + 1, 0.06);
  for (const y of [5.5, 9.5]) k.deco('rust', -9.4, y, back + 0.2, 9.4, y + 0.4, back + 0.9, 0.05);
  // Tapping trough and the molten fall into the channel.
  k.along(0, 2.8, -129, 0, 1.2, -119, len => {
    g.use('lava').gridStep(0, 0, 3.2, len, 0, 0, 0, 0, -6.4, 2);
    g.use('steelDark');
    g.bevel(len / 2, -0.5, 0, len / 2, 0.3, 3.8, 0.06);
    g.bevel(len / 2, 0.15, 3.6, len / 2, 0.6, 0.3, 0.06);
    g.bevel(len / 2, 0.15, -3.6, len / 2, 0.6, 0.3, 0.06);
  });
  for (let i = 0; i < 6; i++) {
    const t0 = i / 6, t1 = (i + 1) / 6;
    const y0 = 1.2 + (LAVA.y - 1.2) * t0, y1 = 1.2 + (LAVA.y - 1.2) * t1;
    const z0 = -119 + 2.6 * Math.sqrt(t0), z1 = -119 + 2.6 * Math.sqrt(t1);
    const w = 3 - t1 * 0.7;
    g.use('lava').quad(-w, y1, z1, w, y1, z1, w, y0, z0, -w, y0, z0);
    g.quad(w, y1, z1 - 0.1, -w, y1, z1 - 0.1, -w, y0, z0 - 0.1, w, y0, z0 - 0.1);
  }
  spec.lava.push(new THREE.Box3(new THREE.Vector3(-3.4, -9, -130), new THREE.Vector3(3.4, 3.6, -115)));
  // Two smaller pours from the channel wall, so the whole river is fed.
  for (const x of [-42, 42]) {
    k.deco('steelDark', x - 2, -2.6, -122.6, x + 2, -1, -119.6, 0.14);
    g.use('lava').box(x, -1.2, -120.4, 1.3, 0.1, 1, FACE.py);
    g.use('lava').gridStep(x - 1.3, -1.3, -119.3, 2.6, 0, 0, 0, LAVA.y + 1.3, 0, 2);
    k.light(x, -3, -117, 'orange', 26, 14);
  }
  for (const x of [-26, 26]) {
    pipe(k, [x, 0.8, -126, x, 18, -126, x * 0.6, 28, -126, x * 0.2, 36, -130], 1.1, 'steelDark', 5, 12);
  }
  tank(k, -33, -131, 0, 4, 13, 'steelDark', { bands: 3 });
  // Heat lamps: light pours out of the mouth and warms the wall above.
  k.light(0, 7, -118, 'orange', 340, 48);
  k.light(0, 2, -108, 'orange', 90, 28);
  k.light(-14, 12, -119, 'orange', 60, 22);
  k.light(14, 12, -119, 'orange', 60, 22);
  signPanel(k, 0, 17.5, -123.4, 0, 12, 3, signId('DANGER: MOLTEN'));
}

function catwalks(k: Kit, spec: MapSpec): void {
  const zs = Z1 - 5.2, zn = Z0 + 5.2;
  // A rectangle at catwalk level.
  k.catwalk(-HX + 1, zs, -2, zs, CW, 3.4, 'right');
  k.catwalk(2, zs, HX - 1, zs, CW, 3.4, 'right');
  k.catwalk(-HX + 1, zn, -25, zn, CW, 3.4, 'left');
  k.catwalk(25, zn, HX - 1, zn, CW, 3.4, 'left');
  k.catwalk(-HX + 2.5, zs, -HX + 2.5, zn, CW, 3.4, 'right');
  k.catwalk(HX - 2.5, zn, HX - 2.5, zs, CW, 3.4, 'right');
  // Catwalk door platform above the main doors, tying to the rim bridge outside.
  k.floor('steelDark', -6, Z1 - 7, 6, Z1 + 12, CW, 0.5, 3, 'grate');
  k.rail([-6, CW, Z1 - 7, 6, CW, Z1 - 7]);
  // Cross bridges over the lava, to fight across.
  k.catwalk(-22, zs, -22, zn, CW, 4, 'both', true);
  k.catwalk(22, zn, 22, zs, CW, 4, 'both', true);
  // Stairs between floor, catwalks and the high walkway.
  k.stairs(-52, Z1 - 3.6, 0.0, -36, Z1 - 3.6, CW, 3.2);
  k.stairs(36, Z1 - 3.6, CW, 52, Z1 - 3.6, 0, 3.2);
  k.stairs(HX - 3, -100, 0, HX - 3, -118, CW, 3.2);

  // High walkway along the north wall leading to the breaches onto the Ring Road.
  const zw = Z0 + 2.8;
  k.catwalk(-48, zw, -27, zw, WALK, 4.4, 'left', false);
  k.catwalk(27, zw, 48, zw, WALK, 4.4, 'left', false);
  k.stairs(-62, Z0 + 3.2, CW, -48, Z0 + 3.2, WALK, 3.2);
  k.stairs(62, Z0 + 3.2, CW, 48, Z0 + 3.2, WALK, 3.2);
  // Over the wall and across the road barrier.
  const edge = -(RING.half - RING.width / 2);
  for (const x of [-36, 36]) {
    k.floor('steelDark', x - 6, edge + 2.7, x + 6, Z0 + 1, WALK, 0.5, 3, 'grate');
    ringStile(k, x, edge - 0.25, 0, -1, 12);
    k.lampBar(x, WALK + 5.2, Z0 + 2.4, 0, 6, 'white', 40, 20);
  }
  // Catwalk doors on the end walls lead out to the viaducts at matching height.
  k.catwalk(HX - 1, -97, 85.4, -97, CW, 3.4, 'both');
  k.catwalk(-HX + 1, -97, -85.4, -97, CW, 3.4, 'both');

  // Corner pads for quick climbs.
  spec.pad(-30, 0, -87.5, -30, CW, zs, 2.5);
  spec.pad(30, 0, -87.5, 30, CW, zs, 2.5);
  spec.pickup(-22, CW + 1, -105);
  spec.pickup(36, WALK + 1, zw);

  // Moving crane on the rails.
  spec.gantries.push({ x0: -50, x1: 50, y: 23.4, z0: Z0 + 3, z1: Z1 - 3, period: 48 });
}

function northStrip(k: Kit, spec: MapSpec): void {
  const g = k.geo;
  // Press line: three drop hammers across the east half of the strip. Time them or go over.
  const z = -130;
  for (const [i, x] of [41, 51.5, 62].entries()) {
    spec.crushers.push({ x, z, halfX: 4, halfZ: 6.4, floorY: 0, topY: 7, period: 5.2, phase: i * 1.7 });
    // Fixed frame around each press.
    for (const s of [-1, 1]) {
      k.block('steelDark', x + s * 5 - 0.5, 0, z - 7.4, x + s * 5 + 0.5, 15, z - 6.6, 0.08);
      k.block('steelDark', x + s * 5 - 0.5, 0, z + 6.6, x + s * 5 + 0.5, 15, z + 7.4, 0.08);
    }
    k.deco('steelDark', x - 5.5, 14, z - 7.6, x + 5.5, 15.6, z + 7.6, 0.1);
    g.use('hazard').box(x, 0.02, z, 4.2, 0.015, 6.6, FACE.py);
    k.lampBar(x, 13.8, z + 3, 0, 5, 'white', 0, 0);
  }
  signPanel(k, 34, 5.2, -123, 0, 6, 1.5, signId('CRUSH ZONE'));
  k.light(50, 11, -130, 'white', 70, 24);
  // Ingot stacks and casting moulds on the west side: chunky cover.
  for (let i = 0; i < 6; i++) {
    const x = -62 + i * 6.2, zz = -130 + (i % 2) * 2.5;
    const h = 1.1 + (i % 3) * 0.9;
    k.block('rust', x - 2.1, 0, zz - 2.8, x + 2.1, h, zz + 2.8, 0.08);
    for (let j = 0; j < 3; j++) k.deco('steelDark', x - 1.7 + j * 1.2, h, zz - 2.3, x - 0.9 + j * 1.2, h + 0.45, zz + 2.3, 0.05);
  }
  // Hall floor: rail spurs and bay lines tie the working floor together.
  for (const z of [-80, -88]) {
    g.use('steel').box(-34, 0.03, z, 30, 0.03, 0.05, FACE.py | FACE.pz | FACE.nz);
    g.box(34, 0.03, z, 30, 0.03, 0.05, FACE.py | FACE.pz | FACE.nz);
  }
  for (let x = -HX + BAY; x < HX; x += BAY) {
    g.use('hazard').tint(0.6).box(x, 0.012, -83, 0.12, 0.01, 8, FACE.py);
    g.tint(1);
    k.light(x, 7, -83, 'orange', 34, 20);
  }
  for (const x of [-48, -24, 24, 48]) k.light(x, 7, -130, 'orange', 34, 20);
  // Ladle cars parked on the spur, a chunky run of cover.
  for (const x of [-46, 40]) {
    k.block('steelDark', x - 3.4, 0, -82.4, x + 3.4, 1.1, -77.6, 0.08);
    g.use('rust').lathe([1.6, 1.1, 2.4, 3.8, 2.5, 4, 2.3, 4], x, 0, -80, 14, false);
    k.collidePrism(x, -80, 1.1, 4, 2.3, 8, 'metal');
  }
  machine(k, -60, 0, -86, 0, 5, 3, 3);
  machine(k, 58, 0, -84, 0.1, 5, 3, 3);
  machine(k, -28, 0, -80, 0, 3.5, 2.2, 2.2);
  k.block('steelDark', 14, 0, -83, 21, 3, -80, 0.08);
  k.block('steelDark', -21, 0, -87, -14, 2.5, -84, 0.08);
}

function yards(k: Kit, spec: MapSpec): void {
  const g = k.geo;
  // Slag Yard (north-west corner): spoil heaps, a skip hoist, and a pad up to the road.
  const heap = (x: number, z: number, r: number, h: number) => {
    const prof: number[] = [];
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      prof.push(Math.max(0.2, r * (1 - t) * (0.9 + 0.1 * Math.sin(i * 2.1))), h * (1 - (1 - t) * (1 - t)));
    }
    g.use('dirt').tint(0.55, 0.56, 0.6).lathe(prof, x, 0, z, 16, true);
    g.tint(1);
    k.collidePrism(x, z, 0, h * 0.55, r * 0.55, 10, 'dirt');
    rubble(k, x, 0, z, r * 1.1, 18, 'rust');
  };
  heap(-118, -112, 12, 7);
  heap(-92, -126, 9, 5);
  heap(-128, -84, 8, 4.5);
  k.truss(-108, 1, -88, -76, 22, -88, 3, 2.4, 'steelDark', 0.12);
  k.column(-86, -86, 0, 14, 1, 'steelDark');
  k.column(-86, -90, 0, 14, 1, 'steelDark');
  signPanel(k, -74, 11, -78.6, Math.PI, 7, 1.75, signId('SLAG YARD'));
  k.mast(-120, -98, 0, 15, 0.8);
  spec.ringPad(-80, -80, Math.PI * 1.3);

  // Tank Farm (north-east corner): pressure spheres and a pad to the road.
  spec.ringPad(80, -80, Math.PI * 1.7);
  spec.view('slag', -72, 2.4, -106, -122, 6, -112);
}

function light(k: Kit): void {
  // Warm pools along the channel. The light comes from below, so everything above reads as lit by heat.
  for (let x = -48; x <= 48; x += 16) {
    k.light(x, -3, -112, 'orange', 80, 26);
  }
  // Cold spill from the doors, so the warm hall has an edge.
  k.light(0, 10, -80, 'cyan', 60, 26);
  k.lampBar(-40, 7, -78, 0, 4, 'white', 30, 16);
  k.lampBar(40, 7, -78, 0, 4, 'white', 30, 16);
  for (const x of [-60, -40, -20, 20, 40, 60]) {
    wallLamp(k, x, 5, -75, Math.PI, 'orange', 14, 12);
    vent(k, x + 6, 28, -75, Math.PI, 2.6, 1.6);
  }
  for (const x of [-52, 52]) cable(k, x, 21, -78, x, 21, -134, 6, 0.08);
}
