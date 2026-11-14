/**
 * The ground of Brine: salt crust under the town and the Flats, the white Pans west of the wall, the sea past the harbour wall and the
 * east quay, the dry dock's hole, the salt dyke that shuts the Flats off from the Pans, and the invisible walls. One collider per slab of
 * ground, so nothing crosses a seam it does not have to.
 */
import { FACE, type Mat } from '../../kit/geo';
import type { Kit } from '../../kit/kit';
import { truck } from '../../kit/props';
import type { MapSpec } from '../spec';
import { Site } from '../outpost/site';
import { flag, hull } from './props';
import {
  APRON, BOUNDS, CRANE_STREET, DYES, DYKE, HARBOUR, HORIZON, LZ, MAIN_STREET, PANS, QUAY_ROAD, type Rgb, SALT_STREET, SEA, SITE, SKY, SLIP,
  SQUARE, TOWER_ROAD, WALL_Z, WEST_ROAD, WEST_X,
} from './plan';

const SALT: Rgb = [0.56, 0.55, 0.51];
const PAN: Rgb = [0.7, 0.7, 0.68];
const TOWN: Rgb = [0.6, 0.56, 0.48];
const CONCRETE: Rgb = [0.7, 0.68, 0.64];

function ground(k: Kit, mat: Mat, tint: Rgb, x0: number, z0: number, x1: number, z1: number, y: number, step: number): void {
  const g = k.geo.use(mat).tint(tint[0], tint[1], tint[2]);
  g.gridStep(x0, y, z1, x1 - x0, 0, 0, 0, 0, z0 - z1, step);
  g.tint(1);
}

/** Box colliders for the ground: everywhere at y 0 but the dry dock, which is a hole down to its floor. */
function colliders(k: Kit): void {
  const box = (x0: number, z0: number, x1: number, z1: number, top: number) =>
    k.collide((x0 + x1) / 2, top - 4, (z0 + z1) / 2, (x1 - x0) / 2, 4, (z1 - z0) / 2, 'dirt');
  const X0 = BOUNDS.x0 - 2, X1 = SEA.eastX, Z0 = HARBOUR.z0, Z1 = BOUNDS.z1 + 2;
  box(X0, Z0, SLIP.x0, Z1, 0);
  box(SLIP.x1, Z0, X1, Z1, 0);
  box(SLIP.x0, Z0, SLIP.x1, SLIP.z0, 0);
  box(SLIP.x0, SLIP.z1, SLIP.x1, Z1, 0);
  box(SLIP.x0, SLIP.z0, SLIP.x1, SLIP.z1, -6);
  // The sea bed, for rounds that go over the wall.
  box(X0, -HORIZON, HORIZON, Z0, SEA.y - 0.4);
  box(X1, Z0, HORIZON, Z1, SEA.y - 0.4);
}

function surfaces(k: Kit): void {
  // The Pans: white to the horizon.
  ground(k, 'paintWhite', PAN, -HORIZON, HARBOUR.z0, WEST_X, HORIZON, 0, 8);
  // The Flats and shanties, south of the wall: salt crust over mud.
  ground(k, 'paintWhite', SALT, WEST_X, WALL_Z, SEA.eastX, HORIZON, 0, 6);
  // The town inside the walls, round the dry dock's hole.
  ground(k, 'dirt', TOWN, WEST_X, HARBOUR.z1, SLIP.x0, WALL_Z, 0, 4);
  ground(k, 'dirt', TOWN, SLIP.x1, HARBOUR.z1, SEA.eastX, WALL_Z, 0, 4);
  ground(k, 'dirt', TOWN, SLIP.x0, SLIP.z1, SLIP.x1, WALL_Z, 0, 4);
  // Concrete where the yard was: the quay apron, the quay road, Crane Street, the west and tower roads.
  for (const r of [APRON, QUAY_ROAD, CRANE_STREET, WEST_ROAD, TOWER_ROAD]) ground(k, 'concrete', CONCRETE, r.x0, r.z0, r.x1, r.z1, 0.01, 3);
  // The harbour quay along the wall, and the east quay.
  ground(k, 'concrete', CONCRETE, WEST_X, HARBOUR.z1, SEA.eastX, SLIP.z0, 0.01, 3);
  ground(k, 'concrete', CONCRETE, SLIP.x1, SLIP.z0, SEA.eastX, APRON.z0, 0.01, 3);
  // The Square's paving, Salt Street and the main street, in old tiles.
  ground(k, 'tile', [0.72, 0.6, 0.48], SQUARE.x0, SQUARE.z0, SQUARE.x1, SQUARE.z1, 0.015, 2);
  ground(k, 'tile', [0.6, 0.52, 0.44], SALT_STREET.x0, SALT_STREET.z0, SALT_STREET.x1, SALT_STREET.z1, 0.012, 2);
  ground(k, 'tile', [0.6, 0.52, 0.44], MAIN_STREET.x0, MAIN_STREET.z0, MAIN_STREET.x1, MAIN_STREET.z1, 0.012, 2);
  // The sea, past the harbour wall and the east quay.
  ground(k, 'asphalt', [0.1, 0.17, 0.2], -HORIZON, -HORIZON, HORIZON, HARBOUR.z0, SEA.y, 12);
  ground(k, 'asphalt', [0.1, 0.17, 0.2], SEA.eastX, HARBOUR.z0, HORIZON, HORIZON, SEA.y, 12);
  // Past the map's edge to the camera's far plane: salt to the south and west, sea to the north and east, so it runs to the horizon.
  const FAR = 1400;
  ground(k, 'paintWhite', PAN, -FAR, HARBOUR.z0, -HORIZON, FAR, -0.02, 120);
  ground(k, 'paintWhite', SALT, -HORIZON, HORIZON, SEA.eastX, FAR, -0.02, 120);
  ground(k, 'asphalt', [0.1, 0.17, 0.2], -FAR, -FAR, FAR, -HORIZON, SEA.y, 120);
  ground(k, 'asphalt', [0.1, 0.17, 0.2], -FAR, -HORIZON, -HORIZON, HARBOUR.z0, SEA.y, 120);
  ground(k, 'asphalt', [0.1, 0.17, 0.2], HORIZON, HARBOUR.z0, FAR, FAR, SEA.y, 120);
  ground(k, 'asphalt', [0.1, 0.17, 0.2], SEA.eastX, HORIZON, HORIZON, FAR, SEA.y, 60);
  // The east quay's edge, its face down to the water, and bollards.
  const g = k.geo;
  g.use('concreteDark').tint(0.7).box(SEA.eastX, (SEA.y - 1) / 2, (HARBOUR.z0 + BOUNDS.z1) / 2, 0.02, (1 - SEA.y) / 2, (BOUNDS.z1 - HARBOUR.z0) / 2, FACE.px);
  for (let z = -100; z < 120; z += 9) {
    g.use('rust').tint(0.6).cyl(SEA.eastX - 0.8, 0, z, SEA.eastX - 0.8, 0.7, z, 0.28, 0.24, 8, false, true);
  }
  g.tint(1);
}

/** The LZ on the salt: a ring of painted stones and an H the 14th come down on. */
function lz(k: Kit): void {
  const g = k.geo;
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    g.use('paintWhite').tint(0.95, 0.72, 0.2).bevel(LZ.x + Math.cos(a) * LZ.radius, 0.08, LZ.z + Math.sin(a) * LZ.radius, 0.35, 0.08, 0.25, 0.04);
  }
  g.use('paintWhite').tint(0.9, 0.9, 0.86);
  g.box(LZ.x - 2.5, 0.02, LZ.z, 0.4, 0.01, 4, FACE.py);
  g.box(LZ.x + 2.5, 0.02, LZ.z, 0.4, 0.01, 4, FACE.py);
  g.box(LZ.x, 0.02, LZ.z, 2.1, 0.01, 0.4, FACE.py);
  g.tint(1);
}

/** The salt dyke: a steep bank from the wall's west end to the south edge. Out of a climb's reach and refusing it. */
function dyke(k: Kit, site: Site): void {
  const { x0, x1, z0, z1, h } = DYKE;
  k.noClimb(() => k.collide((x0 + x1) / 2, h / 2, (z0 + z1) / 2, (x1 - x0) / 2, h / 2, (z1 - z0) / 2, 'dirt'));
  const g = k.geo.use('dirt').tint(0.62, 0.58, 0.5);
  const m = (x0 + x1) / 2, t = 0.6;
  // Sloped faces inside the collider, a stone cap on top.
  g.quad(x1, 0, z1, x1, 0, z0, m + t, h, z0, m + t, h, z1);
  g.quad(x0, 0, z0, x0, 0, z1, m - t, h, z1, m - t, h, z0);
  g.quad(m - t, h, z1, m + t, h, z1, m + t, h, z0, m - t, h, z0);
  g.quad(x0, 0, z1, x1, 0, z1, m + t, h, z1, m - t, h, z1);
  g.tint(1);
  for (let z = z0 + 6; z < z1; z += 14) flag(k, m, h, z, 2.6, 0, [0.95, 0.62, 0.12]);
  site.plan.blocks.push({ x0, z0, x1, z1 });
}

/**
 * The Pans: evaporation ponds as low ridges, Old Mother's ruts round her loop, salt heaps, a dead crawler at the far edge, poles with
 * rags on them. Nothing solid on the loop, and nothing on the Frame's way out of the gate.
 */
function pans(k: Kit, site: Site): void {
  const g = k.geo;
  // Pond ridges: a grid of 0.25 m lips, flat enough to walk over, drawn only.
  g.use('dirt').tint(0.86, 0.85, 0.82);
  for (let x = PANS.x0 + 8; x < PANS.x1 - 4; x += 24) g.box(x, 0.06, (PANS.z0 + PANS.z1) / 2, 0.35, 0.06, (PANS.z1 - PANS.z0) / 2 - 4, FACE.py | FACE.px | FACE.nx);
  for (let z = PANS.z0 + 10; z < PANS.z1 - 4; z += 24) g.box((PANS.x0 + PANS.x1) / 2, 0.06, z, (PANS.x1 - PANS.x0) / 2 - 4, 0.06, 0.35, FACE.py | FACE.pz | FACE.nz);
  // Old Mother's ruts: two dark bands round the loop, where her tracks have ground the crust to mud.
  const { x, z, rx, rz } = PANS.loop;
  g.use('dirt').tint(0.42, 0.4, 0.36);
  const n = 72;
  for (const off of [-6, 6]) {
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
      const p = (a: number, r: number) => [x + Math.cos(a) * (rx + r), z + Math.sin(a) * (rz + r)] as const;
      const [ax, az] = p(a0, off - 1.4), [bx, bz] = p(a1, off - 1.4), [cx, cz] = p(a1, off + 1.4), [dx, dz] = p(a0, off + 1.4);
      g.quad(ax, 0.02, az, dx, 0.02, dz, cx, 0.02, cz, bx, 0.02, bz);
    }
  }
  g.tint(1);
  // Salt heaps, white cones outside the loop.
  for (const [hx, hz, r] of [[-155, -90, 6], [-150, 96, 7], [-30, -100, 5], [-148, 30, 5], [-25, 100, 6], [-70, 108, 4]] as const) {
    g.use('paintWhite').tint(0.8, 0.8, 0.78).lathe([r, 0, r * 0.55, r * 0.5, 0.01, r * 0.85], hx, 0, hz, 14, false);
    k.collide(hx, r * 0.3, hz, r * 0.6, r * 0.3, r * 0.6, 'dirt', false);
    site.plan.blocks.push({ x0: hx - r * 0.6, z0: hz - r * 0.6, x1: hx + r * 0.6, z1: hz + r * 0.6 });
  }
  g.tint(1);
  // Mother's sister: a dead salt crawler sunk in the crust on the far side, a landmark.
  k.push(-158, 0, -40, 0.3);
  g.use('rust').tint(0.55).bevel(0, 3, 0, 4, 3, 13, 0.3);
  g.use('rust').tint(0.4).bevel(0, 1.4, 0, 5.2, 1.4, 14, 0.2);
  g.use('paintWhite').tint(0.86, 0.5, 0.3).bevel(0, 7.2, 4, 2.6, 1.2, 3, 0.2);
  g.tint(1);
  k.collide(0, 3, 0, 5.2, 3, 14, 'metal');
  k.pop();
  for (const [px, pz, c] of [[-60, -105, 0], [-125, -70, 2], [-40, 30, 4], [-150, 60, 1], [-100, 112, 3]] as const) {
    flag(k, px, 0, pz, 4.5, 0.5, DYES[c]!);
  }
}

/** The Flats: a few wrecks on the salt, a beached trawler, burnt trucks. Kept off the LZ and the tracks. */
function flats(k: Kit): void {
  hull(k, 92, 0, 98, 0.15, 22, 6.5, 0.18);
  hull(k, -2, 0, 92, 1.4, 14, 4.5, -0.25);
  truck(k, 62, 0, 104, 0.6, 0.06);
  truck(k, 26, 0, 104, -0.3);
  truck(k, 98, 0, 84, 2.4, -0.08);
}

/** The invisible walls on the site's edge. */
function containment(k: Kit): void {
  const h = SKY / 2, cx = (SITE.x0 + SITE.x1) / 2, cz = (SITE.z0 + SITE.z1) / 2, hx = (SITE.x1 - SITE.x0) / 2 + 1, hz = (SITE.z1 - SITE.z0) / 2 + 1;
  k.containment(cx, h, SITE.z0 - 0.5, hx, h, 0.5);
  k.containment(cx, h, SITE.z1 + 0.5, hx, h, 0.5);
  k.containment(SITE.x0 - 0.5, h, cz, 0.5, h, hz);
  k.containment(SITE.x1 + 0.5, h, cz, 0.5, h, hz);
}

export function authorGround(k: Kit, spec: MapSpec): void {
  const site = new Site(k, spec);
  colliders(k);
  surfaces(k);
  lz(k);
  dyke(k, site);
  pans(k, site);
  flats(k);
  containment(k);
}
