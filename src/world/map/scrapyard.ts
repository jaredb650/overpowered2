/** Scrapyard: open ground, walls of stacked containers, wrecks and long sightlines down the haul roads. */
import type { Kit } from '../kit/kit';
import { FACE } from '../kit/geo';
import { barrier, cable, container, CONTAINER, dropship, fence, loader, portalCrane, rebar, rubble, scrapHeap, signPanel, stack, truck, tyres, vent } from '../kit/props';
import { signId } from '../kit/signs';
import type { MapSpec } from './spec';
import { LEVEL, PIT, RING, viaductY } from './layout';
import { ringStile } from './ring';
import { kicker } from './shared';

const CW = LEVEL.catwalk;
const H = CONTAINER.h;

export function authorScrapyard(k: Kit, spec: MapSpec): void {
  pit(k, spec);
  yards(k, spec);
  conveyor(k, spec);
  cranes(k, spec);
  corner(k, spec);
  spec.view('scrap_road', -66, 1.7, 80, 40, 3, 86);
  spec.view('scrap_yard', -70, 8, 76, -34, 3, 126);
  spec.view('scrap_pit', 28, 3, 92, -6, -5, 116);
  spec.view('scrap_ship', 76, 2.4, 92, 45, 4, 118);
  spec.view('scrap_crane', -46, 15.7, 80, -46, 8, 136);
  spec.view('scrap_top', 0, 34, 132, 0, 4, 70);
}

function pit(k: Kit, spec: MapSpec): void {
  const g = k.geo;
  const { x0, x1, z0, z1, y } = PIT;
  const o = { thick: 1, bay: 3.4, lift: 3.6, cap: false, mat: 'rust' as const, surface: 'metal' as const };
  const door = (c: number) => [{ u0: c - 6.5, u1: c + 6.5, v0: y, v1: -2, frame: true }];
  k.wall(x0, z0, x1, z0, y, 0, { ...o, openings: door(22) });
  k.wall(x1, z0, x1, z1, y, 0, { ...o, openings: door(16) });
  k.wall(x1, z1, x0, z1, y, 0, o);
  k.wall(x0, z1, x0, z0, y, 0, { ...o, openings: door(12) });
  k.floor('dirt', x0, z0, x1, z1, y, 1, 2);
  g.use('asphalt').gridStep(-10, y + 0.02, 112, 20, 0, 0, 0, 0, -14, 2);
  // Two ramps meet at the south wall, so the pit is a bowl you can slide through at speed.
  k.ramp(0, z1 - 4.5, y, x1 + 0.5, z1 - 4.5, 0, 8, 'steel', 0.6);
  k.ramp(0, z1 - 4.5, y, x0 - 0.5, z1 - 4.5, 0, 8, 'steel', 0.6);
  // The rim has been chewed up by years of tipping.
  for (let i = 0; i < 46; i++) {
    const t = i / 46;
    const onX = i % 2 === 0;
    const px = onX ? x0 + t * (x1 - x0) : (i % 4 === 1 ? x0 - 1.4 : x1 + 1.4);
    const pz = onX ? (i % 4 === 0 ? z0 - 1.4 : z1 + 1.4) : z0 + t * (z1 - z0);
    rubble(k, px, 0, pz, k.rand(1.2, 2.6), 5, i % 3 === 0 ? 'rust' : 'concrete');
  }
  scrapHeap(k, -13, 118, 4.5, 3.4, y);
  tyres(k, 17, y, 116, 4);
  tyres(k, 18.3, y, 117.2, 3);
  rubble(k, -14, y, 104, 5, 22, 'concrete', true);
  rubble(k, 15, y, 102, 3.5, 16, 'rust');
  truck(k, 7, y, 106, 2.2, 0.15);
  barrier(k, -4, y, 110, 0.4, 4);
  barrier(k, 3, y, 114, -0.3, 4);
  for (const x of [-16, 16]) k.mast(x, z0 + 1, 0, 11, x > 0 ? 2.6 : -2.6 + Math.PI * 2, 'white', 90, 34);
  spec.pickup(0, y + 1, 106);
  spec.barrels(-12, y, 116, 3);
  spec.barrels(10, y, 99, 3);
  spec.pad(-8, y, 101.5, -8, 0, 88, 2.5);
  // Kicker ramps on the haul road either side: clear the pit with enough speed.
  kicker(k, spec, -36, 0, 110, 1, 0);
  kicker(k, spec, 36, 0, 110, -1, 0);
}

/** A row of container columns, heights from `levels`. */
function row(k: Kit, x: number, z: number, levels: readonly number[], along: 'x' | 'z'): void {
  levels.forEach((n, i) => {
    if (n === 0) return;
    if (along === 'z') stack(k, x, 0, z + i * 3.2, 0, n);
    else stack(k, x + i * 3.2, 0, z, Math.PI / 2, n);
  });
}

/** Container resting at an angle against a stack, climbable. */
function leaning(k: Kit, x: number, z: number, yaw: number, pitch: number): void {
  k.push(x, 0, z, yaw, pitch);
  container(k, 6, -0.25, 0, 0, undefined, true);
  k.pop();
}

function yards(k: Kit, spec: MapSpec): void {
  // West Yard: two long walls of steel with a lane between them, and a cross cut.
  row(k, -56, 95, [2, 3, 3, 2, 0, 0, 3, 3, 2, 2], 'z');
  row(k, -34, 95, [1, 2, 3, 3, 0, 0, 2, 3, 3, 1], 'z');
  leaning(k, -62, 92, Math.PI, 0);
  leaning(k, -51, 110, -0.02, 0.42);
  leaning(k, -39.5, 122, Math.PI + 0.02, 0.42);
  stack(k, -45, 0, 87, Math.PI / 2 + 0.3, 2);
  stack(k, -62, 0, 134, 0.2, 1);
  stack(k, -30, 0, 134, -0.4, 1);
  truck(k, -46, 0, 112, 1.4);
  loader(k, -48, 0, 133, 0.6);

  // East Yard: a ring of stacks around the crashed dropship. Open centre, gaps at the compass points.
  row(k, 28, 95, [2, 3, 3, 0, 0, 3, 3, 2, 2], 'x');
  row(k, 34, 126, [3, 3, 2, 0, 0, 2, 3, 3], 'x');
  stack(k, 28, 0, 104, 0, 2);
  stack(k, 28, 0, 108, 0, 3);
  stack(k, 28, 0, 112, 0, 2);
  stack(k, 28, 0, 118, 0, 1);
  stack(k, 64, 0, 104, Math.PI, 3);
  stack(k, 64, 0, 110, Math.PI, 2);
  stack(k, 64, 0, 116, Math.PI, 3);
  leaning(k, 52, 98, Math.PI / 2, 0);
  leaning(k, 40, 123, Math.PI / 2 + Math.PI, 0.42);
  dropship(k, 45, 4.4, 111, 2.3);
  rubble(k, 50, 0, 116, 6, 30, 'rust');
  rubble(k, 38, 0, 106, 4, 16, 'concrete');
  spec.pad(38, 0, 118, 29, 3 * H, 108, 2.4);

  // Open ground by the south road: stray wrecks at odd angles, the opposite of the ordered stacks.
  truck(k, 12, 0, 132, 0.4);
  truck(k, -16, 0, 90, -0.35, 0.02);
  loader(k, 72, 0, 124, 2.6);
  barrier(k, 8, 0, 84, 0, 4);
  barrier(k, -8, 0, 82, 0.1, 4);
  barrier(k, -24, 0, 86, Math.PI / 2, 4);
  barrier(k, 24, 0, 82, Math.PI / 2, 4);
  stack(k, 0, 0, 136, Math.PI / 2 + 0.02, 2);
  stack(k, 20, 0, 136, Math.PI / 2 - 0.1, 1);
  stack(k, -20, 0, 136, Math.PI / 2 + 0.2, 1);

  // Heaps give the open ground an organic skyline against the stacks.
  scrapHeap(k, -16, 74 + 14, 6, 4.2);
  scrapHeap(k, 20, 133, 7.5, 5);
  scrapHeap(k, 76, 106, 7, 5);
  scrapHeap(k, -76, 112, 6.5, 4.5);
  scrapHeap(k, 112, 110, 9, 6);
  scrapHeap(k, 92, 90, 5, 3.4);
  for (const [x, z, n] of [[-24, 128, 5], [-22.8, 129.2, 3], [66, 88, 4], [14, 125, 3], [-68, 130, 5], [-69.2, 128.9, 2], [30, 84, 3]] as const) tyres(k, x, 0, z, n);
  fence(k, [-92, 78, -66, 78], 0, 2.6);
  fence(k, [66, 78, 92, 78], 0, 2.6);
  fence(k, [-26, 104, -26, 92], 0, 2.2);
  fence(k, [26, 124, 26, 132], 0, 2.2);
  k.mast(-70, 96, 0, 16, 0.4);
  k.mast(70, 96, 0, 16, -0.4);
  k.mast(0, 128, 0, 16, Math.PI);
  k.mast(-22, 88, 0, 12, 2.5, 'cyan', 70, 30);
  k.mast(22, 88, 0, 12, -2.5, 'cyan', 70, 30);

  spec.barrels(-46, 0, 104, 4);
  spec.barrels(14, 0, 90, 3);
  spec.barrels(46, 0, 123, 4);
  spec.tank(-30, 0, 116);
  spec.tank(44, 0, 96);
  spec.pickup(-45, 1, 116);
  spec.pickup(56, 1, 112);
  spec.pickup(0, 1, 90);
  spec.pickup(46, 3 * H + 1, 95);
  spec.gate('scrapyard', -90, 0.1, 132);
  spec.gate('scrapyard', 90, 0.1, 132);
}

/** Ore conveyor at catwalk height along the yard's north side: the Scrapyard's upper route. */
function conveyor(k: Kit, spec: MapSpec): void {
  const g = k.geo;
  const z = 91;
  k.catwalk(-1.6, 73, -1.6, z, CW, 3.2, 'left');
  k.catwalk(1.6, z, 1.6, 73, CW, 3.2, 'left');
  k.catwalk(-70, z, 70, z, CW, 4.4, 'both');
  // Trestles.
  for (let x = -66; x <= 66; x += 22) {
    k.beam(x - 3, 0, z, x, CW - 0.2, z, 0.2, 0.2, 'steelDark', true);
    k.beam(x + 3, 0, z, x, CW - 0.2, z, 0.2, 0.2, 'steelDark', true);
    k.ibeam(x - 3, CW - 0.5, z, x + 3, CW - 0.5, z, 0.3, 0.2);
    k.ibeam(x, CW - 0.4, z - 2.4, x, CW - 0.4, z + 2.4, 0.3, 0.2);
  }
  // Belt on the north side of the walkway, with leftover ore.
  g.use('rubber').box(0, CW + 0.5, z - 1.5, 70, 0.04, 0.5, FACE.py | FACE.pz | FACE.nz);
  for (let x = -68; x <= 68; x += 2.5) g.use('steelDark').cyl(x, CW + 0.42, z - 2.0, x, CW + 0.42, z - 1.0, 0.07, 0.07, 6, false, false);
  for (let x = -60; x < 60; x += 11) rubble(k, x, CW + 0.55, z - 1.5, 0.45, 3, 'dirt');
  // Ends tie to the viaducts at their matching height.
  const yv = viaductY(122.6);
  k.ramp(70, z, CW, 81.8, z, yv, 4.4, 'steel', 0.25, false);
  k.ramp(-70, z, CW, -81.8, z, yv, 4.4, 'steel', 0.25, false);
  for (let x = -56; x <= 56; x += 28) k.lampBar(x, CW + 3.4, z + 2.3, 0, 3, 'white', 26, 18);
  for (let x = -56; x <= 56; x += 28) {
    k.geo.use('steelDark').box(x, CW + 1.7, z + 2.3, 0.04, 1.7, 0.04, FACE.sides);
  }
  spec.pickup(0, CW + 1, z);
}

function cranes(k: Kit, spec: MapSpec): void {
  // Two portal cranes straddle the yards. Their decks run level with the Ring Road and bridge to it.
  const edge = RING.half - RING.width / 2;
  for (const x of [-46, 46]) {
    portalCrane(k, x, 0, 108, 0, 48, LEVEL.ring - 2.75);
    k.floor('steelDark', x - 1.8, 138, x + 1.8, edge + 0.4, LEVEL.ring, 0.3, 2, 'grate');
    ringStile(k, x, edge, 0, 1, 3.6);
    k.lampBar(x, LEVEL.ring - 3.4, 108, Math.PI / 2, 5, 'white', 60, 26);
    // Stair down the north leg onto the conveyor, so the deck is not a dead end.
    k.stairs(x + 2.8, 77.2, LEVEL.ring, x + 2.8, 89, CW, 2.2, 'steel');
    k.catwalk(x + 1.8, 77.4, x + 4, 77.4, LEVEL.ring, 1.4, 'none');
  }
  cable(k, -46, 13.5, 92, -46, 13.5, 130, 3, 0.06);
  cable(k, 46, 13.5, 92, 46, 13.5, 130, 3, 0.06);
  spec.pad(-53, 0, 128, -46, LEVEL.ring, 122, 2.5);
  spec.pad(54, 0, 136, 46.2, LEVEL.ring, 129, 3);
  signPanel(k, 46, 12.2, 110.8, Math.PI / 2, 6, 1.5, signId('CRANE 04'));
}

function corner(k: Kit, spec: MapSpec): void {
  // South-east corner: the yard runs on under the viaduct, loose rows on open dirt.
  row(k, 104, 96, [2, 3, 2, 0, 0, 2, 2], 'z');
  row(k, 122, 104, [1, 2, 3, 2], 'z');
  stack(k, 88, 0, 118, 0.6, 2);
  stack(k, 112, 0, 128, 1.1, 1);
  k.mast(92, 126, 0, 14, -2.3, 'white', 90, 34);
  signPanel(k, 110, 2.2, 78.2, 0, 5, 1.25, signId('SCRAPYARD'), false);
  spec.ringPad(80, 80, Math.PI * 0.1);
  spec.barrels(100, 0, 118, 3);
  rebar(k, 80, 0.4, 120, 0.2, 6, 8);
  vent(k, 120, 1, 90, 0.4);
  spec.pickup(96, 1, 108);
}
