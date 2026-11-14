/**
 * The ground and the field round the fort: one floor collider under everything, the roads and the track, a line of tank traps
 * outside the walls, shacks and wrecks for the attackers to hide behind, mortar pits, landing zones, and the fence at the edge.
 * Each side is authored as the north one and turned. Lanes, landing zones and the track are kept clear: the map test sweeps them.
 */
import { FACE, type Mat } from '../../kit/geo';
import type { Kit } from '../../kit/kit';
import { barrier, container, fence, rubble, truck, tyres } from '../../kit/props';
import { Site } from '../outpost/site';
import type { MapSpec } from '../spec';
import { onSide } from './rings';
import { EDGE, FENCE, LZ_AT, MORTAR_AT, ring, type Rgb, rot, SKY, TRACK } from './plan';

const OUTER = ring('outer').half;
const HORIZON = 180;

function ground(k: Kit, mat: Mat, tint: Rgb, x0: number, z0: number, x1: number, z1: number, y: number, step: number): void {
  const g = k.geo.use(mat).tint(tint[0], tint[1], tint[2]);
  g.gridStep(x0, y, z1, x1 - x0, 0, 0, 0, 0, z0 - z1, step);
  g.tint(1);
}

/** The four pieces of the band between two squares, half-widths `a` < `b`. */
function band(k: Kit, mat: Mat, tint: Rgb, a: number, b: number, y: number, step: number): void {
  ground(k, mat, tint, -b, -b, b, -a, y, step);
  ground(k, mat, tint, -b, a, b, b, y, step);
  ground(k, mat, tint, -b, -a, -a, a, y, step);
  ground(k, mat, tint, a, -a, b, a, y, step);
}

function floors(k: Kit): void {
  // One collider under the whole field, so nothing anywhere crosses a seam.
  k.collide(0, -1, 0, EDGE + 2, 1, EDGE + 2, 'dirt');
  ground(k, 'dirt', [0.6, 0.57, 0.5], -OUTER, -OUTER, OUTER, OUTER, 0, 4);
  band(k, 'dirt', [0.5, 0.47, 0.4], OUTER, EDGE, 0, 6);
  band(k, 'dirt', [0.3, 0.29, 0.26], EDGE, HORIZON, -0.02, 20);
  // The track round the walls, worn darker.
  band(k, 'dirt', [0.4, 0.37, 0.32], TRACK - 4, TRACK + 4, 0.006, 4);
  // Two roads: asphalt north to south, gravel east to west, each from beyond the fence to its gate.
  for (const s of [-1, 1]) {
    ground(k, 'asphalt', [0.5, 0.5, 0.52], -5, s < 0 ? -FENCE - 6 : OUTER + 0.3, 5, s < 0 ? -OUTER - 0.3 : FENCE + 6, 0.012, 3);
    ground(k, 'dirt', [0.34, 0.32, 0.28], s < 0 ? -FENCE - 6 : OUTER + 0.3, -4, s < 0 ? -OUTER - 0.3 : FENCE + 6, 4, 0.012, 3);
  }
  // The road's edge lines.
  const g = k.geo.use('paintWhite').tint(0.7, 0.68, 0.6);
  for (const s of [-1, 1]) for (const e of [-4.6, 4.6]) {
    g.box(e, 0.014, s * (OUTER + FENCE) / 2, 0.08, 0.002, (FENCE - OUTER) / 2, FACE.py);
  }
  g.tint(1);
}

/** Chain-link round the field on its own posts, and the invisible wall on it that keeps everyone in. */
function edge(k: Kit): void {
  const F = FENCE;
  fence(k, [-F, -F, F, -F, F, F, -F, F, -F, -F], 0, 2.6, false);
  const half = SKY / 2;
  k.collide(0, half, -F - 0.5, F + 1, half, 0.5, 'concrete', false);
  k.collide(0, half, F + 0.5, F + 1, half, 0.5, 'concrete', false);
  k.collide(-F - 0.5, half, 0, 0.5, half, F, 'concrete', false);
  k.collide(F + 0.5, half, 0, 0.5, half, F, 'concrete', false);
}

/** A Czech hedgehog: three crossed girders. Cover for a man, a wall for a wheel. */
function hedgehog(k: Kit, x: number, z: number, yaw: number): void {
  k.push(x, 0.62, z, yaw);
  for (const [p, r] of [[0.62, 0], [-0.62, 0], [0, Math.PI / 2]] as const) {
    k.push(0, 0, 0, r, p, r === 0 ? 0 : 0.62);
    k.geo.use('rust').tint(0.7).box(0, 0, 0, 0.95, 0.06, 0.06, FACE.py | FACE.ny | FACE.pz | FACE.nz | FACE.px | FACE.nx);
    k.pop();
  }
  k.geo.tint(1);
  k.collide(0, 0, 0, 0.55, 0.6, 0.55, 'metal', false);
  k.pop();
}

/** An oil drum burning: an orange glow to steer by, in the dark of the field. */
function burner(k: Kit, x: number, z: number): void {
  const g = k.geo;
  g.use('rust').cyl(x, 0, z, x, 0.9, z, 0.3, 0.3, 10, false, false);
  g.use('emissiveOrange').cyl(x, 0.86, z, x, 0.88, z, 0.27, 0.27, 10, false, true);
  k.collide(x, 0.45, z, 0.3, 0.45, 0.3, 'metal');
  k.light(x, 1.6, z, 'orange', 22, 11);
}

/** A sandbag crescent with a tube behind it. The spot itself is FORT_MORTARS; nothing stands on it. */
function mortarPit(k: Kit, site: Site, u: number, z: number): void {
  site.sandbags(u - 2.4, z + 2.2, u + 2.4, z + 3, 1.1);
  site.sandbags(u - 2.4, z + 0.4, u - 1.6, z + 2.2, 1.1);
  site.sandbags(u + 1.6, z + 0.4, u + 2.4, z + 2.2, 1.1);
  const g = k.geo;
  g.use('steelDark').bevel(u + 1, 0.03, z - 0.6, 0.3, 0.03, 0.3, 0.01);
  k.push(u + 1, 0.05, z - 0.6, Math.PI / 2, 1.0);
  g.use('steel').tint(0.6).cyl(0, 0, 0, 1.1, 0, 0, 0.06, 0.06, 8, false, true);
  g.tint(1);
  k.pop();
  site.crate(u - 1.3, z - 1.6, u - 0.5, z - 1.0, 0.45, [0.42, 0.46, 0.3]);
}

/** A painted ring and an H, so a helicopter's spot reads from the walls. */
function landingZone(k: Kit, x: number, z: number): void {
  const g = k.geo.use('paintWhite').tint(0.75, 0.74, 0.68);
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    k.push(x + Math.cos(a) * 7, 0.016, z + Math.sin(a) * 7, -a);
    g.box(0, 0, 0, 0.18, 0.002, 0.8, FACE.py);
    k.pop();
  }
  g.box(x - 1.4, 0.016, z, 0.22, 0.002, 2, FACE.py);
  g.box(x + 1.4, 0.016, z, 0.22, 0.002, 2, FACE.py);
  g.box(x, 0.016, z, 1.2, 0.002, 0.22, FACE.py);
  g.tint(1);
}

/** Shacks on the north side's field, turned for the others: u, z, yaw. Off the lanes, the track, the pits and the landing zone. */
const SHACKS = [[-20, -74, 0.2], [-13, -80, -0.4], [-25, -98, 1.3], [17, -75, 0.1], [26, -72, -0.2], [13, -100, 0.5], [47, -80, 0.9]] as const;

function side(k: Kit, site: Site, spec: MapSpec, i: number): void {
  // Tank traps a few metres out from the walls, with gaps at the gate and round the corners.
  for (let u = -45; u <= 45; u += 6) if (Math.abs(u) > 9) hedgehog(k, u, -OUTER - 5, u * 0.7 + i);
  SHACKS.forEach(([u, z, yaw], n) => {
    const [x, wz] = rot(i, u + ((i * 7 + n * 3) % 3) - 1, z);
    spec.shack(x, wz, yaw - (i * Math.PI) / 2 + i * 0.2, (n + i) % 2 ? 'sheet' : 'planks');
  });
  for (const [u, z] of MORTAR_AT) mortarPit(k, site, u, z);
  landingZone(k, LZ_AT[0], LZ_AT[1]);
  barrier(k, -14, 0, -88, 0.3);
  barrier(k, 16, 0, -86, -0.2);
  barrier(k, 38, 0, -100, 0.6);
  barrier(k, -36, 0, -76, 1.4);
  truck(k, -40, 0, -74, 0.2 + i * 0.1);
  container(k, 58, 0, -96, 0.35 + i * 0.2);
  tyres(k, 22, 0, -92, 3);
  tyres(k, -31, 0, -103, 2);
  rubble(k, -14 + i * 3, 0, -108, 2.4, 9, 'concrete');
  burner(k, -16, -85);
  burner(k, 21, -81);
}

export function authorField(k: Kit, spec: MapSpec): void {
  const site = new Site(k, spec);
  floors(k);
  edge(k);
  for (let i = 0; i < 4; i++) onSide(k, spec.plan!, i, () => side(k, site, spec, i));
}
