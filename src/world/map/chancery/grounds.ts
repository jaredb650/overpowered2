/**
 * Chancery Estate outer grounds:
 * - South Coastal Culvert insertion, Perimeter Wall & Main Gatehouse, Guardhouses A & B
 * - West Garden, Generator & Boiler House, Generator Basement Stairs & Sub-Basement Capacitor Bank
 * - Grand Courtyard, reflecting pool & promenade bridge, symmetrical Colonnade Arcades
 * - East Hedge Terrace, Glass Conservatory (breakable glazing + roof mantle route)
 * - East Bell Tower & Sniper Perch (interior switchback stairs + exterior parkour buttress, sightline-clear belfry)
 * - North Cliff Bluff & distant visual-only Burning Holdfast Horizon
 */
import type { Kit } from '../../kit/kit';
import { FACE } from '../../kit/geo';
import type { MapSpec } from '../spec';
import { CEIL, CHANCERY_BOUNDS, LV } from './plan';

const IRON_BAR = 'steelDark' as const;
const LIMESTONE = 'concrete' as const;
const DARK_STONE = 'concreteDark' as const;

/** Decorative iron fence rail atop a masonry wall segment (visual only, zero extra colliders). */
function ironCrest(k: Kit, ax: number, az: number, bx: number, bz: number, y: number, h = 0.65): void {
  const len = Math.hypot(bx - ax, bz - az);
  k.push(ax, y, az, Math.atan2(-(bz - az), bx - ax));
  const g = k.geo.use(IRON_BAR);
  g.box(len / 2, h, 0, len / 2, 0.035, 0.035, FACE.all);
  g.box(len / 2, h * 0.25, 0, len / 2, 0.025, 0.025, FACE.all);
  const posts = Math.max(2, Math.round(len / 1.4));
  for (let i = 0; i <= posts; i++) {
    const u = (i / posts) * len;
    g.box(u, h / 2, 0, 0.025, h / 2, 0.025, FACE.sides);
  }
  k.pop();
}

/** Manicured dark cypress hedge planter block (crouch-height stealth cover). */
function hedgePlanter(k: Kit, x0: number, z0: number, x1: number, z1: number, y = 0, h = 1.25): void {
  k.block(LIMESTONE, x0, y, z0, x1, y + 0.45, z1, 0.04);
  k.geo.use('dirt').tint(0.22, 0.34, 0.2);
  k.geo.bevel((x0 + x1) / 2, y + 0.45 + (h - 0.45) / 2, (z0 + z1) / 2, (x1 - x0) / 2 - 0.08, (h - 0.45) / 2, (z1 - z0) / 2 - 0.08, 0.08);
  k.geo.tint(1);
  k.collide((x0 + x1) / 2, y + h / 2, (z0 + z1) / 2, (x1 - x0) / 2 - 0.06, h / 2, (z1 - z0) / 2 - 0.06, 'dirt');
}

/** Decorative post lamp pedestal matching a CHANCERY_LIGHTS 'lamp' fixture. */
function gardenLampBase(k: Kit, x: number, z: number): void {
  k.deco(DARK_STONE, x - 0.22, 0, z - 0.22, x + 0.22, 0.35, z + 0.22, 0.04);
}

/** Partitioned ground slab with clean cutouts for the two basement stairwells + invisible containment. */
function groundSlabAndContainment(k: Kit): void {
  const B = CHANCERY_BOUNDS;
  const gMat = 'asphalt';
  // Strip S: z in [-4, 72]
  k.floor(gMat, B.x0, -4, B.x1, B.z1, LV.ground, 0.6, 6);
  // Strip M1: z in [-16, -4], cutout at Generator Basement Stairwell x in [-60, -52]
  k.floor(gMat, B.x0, -16, -60, -4, LV.ground, 0.6, 6);
  k.floor(gMat, -52, -16, B.x1, -4, LV.ground, 0.6, 6);
  // Strip M2: z in [-43, -16]
  k.floor(gMat, B.x0, -43, B.x1, -16, LV.ground, 0.6, 6);
  // Strip N1: z in [-56, -43], cutout at Servant Wing Vault Stairwell x in [-41, -35]
  k.floor(gMat, B.x0, -56, -41, -43, LV.ground, 0.6, 6);
  k.floor(gMat, -35, -56, B.x1, -43, LV.ground, 0.6, 6);
  // Strip Cliff: z in [-66, -56]
  k.floor(gMat, B.x0, -66, B.x1, -56, LV.ground, 0.6, 6);

  // Outer invisible containment walls (north sits at z = -82 so cliff falls pass killY = -18 cleanly)
  const midY = (B.y0 + B.y1) / 2;
  const halfY = (B.y1 - B.y0) / 2 + 6;
  k.containment(B.x0 - 0.5, midY, (B.z0 + B.z1) / 2, 0.5, halfY, (B.z1 - B.z0) / 2);
  k.containment(B.x1 + 0.5, midY, (B.z0 + B.z1) / 2, 0.5, halfY, (B.z1 - B.z0) / 2);
  k.containment((B.x0 + B.x1) / 2, midY, B.z1 + 0.5, (B.x1 - B.x0) / 2, halfY, 0.5);
  k.containment((B.x0 + B.x1) / 2, midY, B.z0 - 0.5, (B.x1 - B.x0) / 2, halfY, 0.5);
}

/** South Coastal Culvert insertion, Perimeter Wall, Main Gatehouse, and Guardhouses A & B. */
function perimeterAndGate(k: Kit, spec: MapSpec): void {
  // South Coastal Culvert insertion behind (-55, 0, 62)
  k.geo.use('dirt').tint(0.35, 0.34, 0.32);
  k.geo.slab(-55, 0.02, 56, 4.5, 0.02, 12, 4, FACE.py);
  k.geo.tint(1);
  // Concrete culvert headwall & low coastal embankment behind insertion
  k.block(DARK_STONE, -60, 0, 66.5, -57.5, 2.8, 70.5, 0.06);
  k.block(DARK_STONE, -52.5, 0, 66.5, -50, 2.8, 70.5, 0.06);
  k.block(DARK_STONE, -60, 2.4, 66.5, -50, 3.2, 70.5, 0.06);
  // Low coastal scrub boulders & cover along approach
  k.block(DARK_STONE, -64, 0, 56, -60, 1.3, 62, 0.08);
  k.block(DARK_STONE, -49, 0, 55, -45, 1.1, 59, 0.08);

  // Main approach road paving from z = 72 to Gatehouse z = 44
  k.geo.use('concreteDark').tint(0.65);
  k.geo.slab(0, 0.025, 58, 4.5, 0.025, 14, 4, FACE.py);
  k.geo.tint(1);

  // South Perimeter Wall (z = 48, x in [-86, 86], 3.5 m limestone masonry + iron top rail)
  // 1. Far west segment [-86, -58]
  k.wall(-86, 48, -58, 48, 0, 3.5, { thick: 0.9, mat: LIMESTONE, back: true, bay: 7 });
  ironCrest(k, -86, 48, -58, 48, 3.5);
  // 2. Culvert breach lintel [-58, -52] (open passage y in [0, 2.6]!)
  k.block(DARK_STONE, -58.2, 2.65, 47.4, -51.8, 3.55, 48.6, 0.05);
  ironCrest(k, -58, 48, -52, 48, 3.55);
  // 3. Mid-west segment [-52, -7]
  k.wall(-52, 48, -7, 48, 0, 3.5, { thick: 0.9, mat: LIMESTONE, back: true, bay: 7.5 });
  ironCrest(k, -52, 48, -7, 48, 3.5);
  // 4. East segment [7, 86]
  k.wall(7, 48, 86, 48, 0, 3.5, { thick: 0.9, mat: LIMESTONE, back: true, bay: 8 });
  ironCrest(k, 7, 48, 86, 48, 3.5);

  // West & East estate perimeter walls framing the compound
  k.wall(-86, -66, -86, 48, 0, 3.2, { thick: 0.9, mat: LIMESTONE, back: true, bay: 10 });
  ironCrest(k, -86, -66, -86, 48, 3.2);
  k.wall(86, 48, 86, -66, 0, 3.2, { thick: 0.9, mat: LIMESTONE, back: true, bay: 10 });
  ironCrest(k, 86, 48, 86, -66, 3.2);

  // Main Gatehouse arched entry (x in [-4.4, 4.4], z = 44..48 open road for QRF waves)
  k.block(LIMESTONE, -7.2, 0, 43.2, -4.4, 6.4, 48.8, 0.08);
  k.block(LIMESTONE, 4.4, 0, 43.2, 7.2, 6.4, 48.8, 0.08);
  k.block(LIMESTONE, -7.4, 4.6, 43.0, 7.4, 6.6, 49.0, 0.08);
  k.deco(IRON_BAR, -4.4, 4.45, 43.4, 4.4, 4.65, 48.6, 0.03);
  // Decorative Chancery crest plaque on gatehouse lintel
  k.deco('paintRed', -2.6, 5.2, 48.98, 2.6, 6.0, 49.12, 0.02);

  // Guardhouse A (x in [-32, -22], z in [36, 44], y = 0..3.6)
  buildGuardhouse(k, spec, -32, -22, 36, 44, 'east');
  // Guardhouse B (x in [30, 40], z in [36, 44], y = 0..3.6)
  buildGuardhouse(k, spec, 30, 40, 36, 44, 'west');
}

function buildGuardhouse(
  k: Kit,
  spec: MapSpec,
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  doorSide: 'east' | 'west',
): void {
  const h = CEIL.guardhouse;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  // South wall (solid)
  k.wall(x0, z1, x1, z1, 0, h, { thick: 0.45, mat: LIMESTONE, back: true, plain: true });
  // North wall with observation window opening
  k.wall(x1, z0, x0, z0, 0, h, {
    thick: 0.45,
    mat: LIMESTONE,
    back: true,
    plain: true,
    openings: [{ u0: 2.5, u1: 7.5, v0: 1.1, v1: 2.7 }],
  });
  spec.breakable('pane', cx, 1.9, z0, 0, 4.9, 1.56);

  // West & East walls (one has the 3 m doorway)
  if (doorSide === 'east') {
    k.wall(x0, z0, x0, z1, 0, h, { thick: 0.45, mat: LIMESTONE, back: true, plain: true });
    k.wall(x1, z1, x1, z0, 0, h, {
      thick: 0.45,
      mat: LIMESTONE,
      back: true,
      plain: true,
      openings: [{ u0: 2.5, u1: 5.5, v0: 0, v1: 2.8 }],
    });
  } else {
    k.wall(x1, z1, x1, z0, 0, h, { thick: 0.45, mat: LIMESTONE, back: true, plain: true });
    k.wall(x0, z0, x0, z1, 0, h, {
      thick: 0.45,
      mat: LIMESTONE,
      back: true,
      plain: true,
      openings: [{ u0: 2.5, u1: 5.5, v0: 0, v1: 2.8 }],
    });
  }
  // Roof slab
  k.mass(DARK_STONE, x0 - 0.3, h, z0 - 0.3, x1 + 0.3, h + 0.45, z1 + 0.3, 4);
  // Interior guard desk & breakable monitor
  k.block('panel', cx - 1.5, 0, z0 + 0.7, cx + 1.5, 0.85, z0 + 1.5, 0.03);
  spec.breakable('monitor', cx, 0.86, z0 + 1.0, Math.PI);
  spec.breakable('chair', cx, 0, cz, 0);
}

/** West Garden (x in [-74, -24], z in [16, 46]): hedges, gravel walkways, cover walls. */
function westGarden(k: Kit): void {
  // Gravel walkways
  k.geo.use('dirt').tint(0.42, 0.4, 0.36);
  k.geo.slab(-55, 0.02, 31, 2.2, 0.02, 16, 4, FACE.py);
  k.geo.slab(-48, 0.02, 24, 18, 0.02, 2.0, 4, FACE.py);
  k.geo.tint(1);

  // Symmetrical cypress hedges & stone planters
  hedgePlanter(k, -70, 34, -62, 37);
  hedgePlanter(k, -70, 22, -62, 25);
  hedgePlanter(k, -50, 34, -40, 36.5);
  hedgePlanter(k, -50, 26, -40, 28.5);
  hedgePlanter(k, -36, 28, -28, 30.5);
  hedgePlanter(k, -36, 18, -28, 20.5);

  // Low limestone garden walls (1.15 m stealth cover with clean breaks)
  k.block(LIMESTONE, -66, 0, 42, -59, 1.15, 42.6, 0.04);
  k.block(LIMESTONE, -48, 0, 41, -38, 1.15, 41.6, 0.04);
  k.block(LIMESTONE, -62, 0, 17, -53, 1.15, 17.6, 0.04);

  // Lamp bases matching CHANCERY_LIGHTS
  gardenLampBase(k, -60, 38);
  gardenLampBase(k, -44, 32);
  gardenLampBase(k, -30, 22);
}

/** Generator & Boiler House (x in [-68, -32], z in [-18, 14]), Basement Stairs, and Sub-Basement Capacitor Bank. */
function generatorComplex(k: Kit, spec: MapSpec): void {
  const x0 = -68, x1 = -32, z0 = -18, z1 = 14, h = CEIL.generator;

  // Exterior walls with 3 clean 4 m doorways
  // South wall z = 14 (doorway x in [-52, -48])
  k.wall(x0, z1, x1, z1, 0, h, {
    thick: 0.65,
    mat: DARK_STONE,
    back: true,
    bay: 6,
    openings: [{ u0: 16, u1: 20, v0: 0, v1: 3.4 }],
  });
  // North wall z = -18 (doorway x in [-48, -44])
  k.wall(x1, z0, x0, z0, 0, h, {
    thick: 0.65,
    mat: DARK_STONE,
    back: true,
    bay: 6,
    openings: [{ u0: 12, u1: 16, v0: 0, v1: 3.4 }],
  });
  // East wall x = -32 (doorway z in [-2, 2])
  k.wall(x1, z1, x1, z0, 0, h, {
    thick: 0.65,
    mat: DARK_STONE,
    back: true,
    bay: 6,
    openings: [{ u0: 12, u1: 16, v0: 0, v1: 3.4 }],
  });
  // West wall x = -68 (solid industrial boiler wall)
  k.wall(x0, z0, x0, z1, 0, h, { thick: 0.65, mat: DARK_STONE, back: true, bay: 6 });

  // Roof slab with industrial skylight monitor ribs
  k.mass(DARK_STONE, x0 - 0.3, h, z0 - 0.3, x1 + 0.3, h + 0.5, z1 + 0.3, 6);
  for (const z of [-10, 0, 8]) {
    k.ibeam(x0 + 0.4, h - 0.35, z, x1 - 0.4, h - 0.35, z, 0.55, 0.28, 'steelDark');
  }

  // Interior floor inlay
  k.geo.use('concrete').tint(0.62);
  k.geo.slab(-50, 0.02, 5, 17, 0.02, 8.5, 5, FACE.py);
  k.geo.tint(1);

  // Three heavy diesel generator banks on west wall (clear of stairwell x in [-60, -52], z in [-16, -4])
  for (const z of [9, 3, -3]) {
    k.block('steelDark', -66.5, 0, z - 1.4, -62.2, 2.0, z + 1.4, 0.06);
    k.deco('rust', -66.2, 2.0, z - 0.5, -62.5, 2.5, z + 0.5, 0.04);
    k.deco('steel', -64.5, 2.5, z - 0.18, -64.1, h - 0.1, z + 0.18, 0.02);
  }
  spec.breakable('generator', -44, 0, 8, Math.PI / 2);
  spec.breakable('generator', -44, 0, -10, Math.PI / 2);
  spec.breakable('extinguisher', -33, 1.1, 10, -Math.PI / 2);

  // Electrical conduit runs leading toward the 3 wing breaker panels on east/south walls
  for (const z of [-6, 6]) {
    k.deco('steel', -62.2, 3.8, z - 0.12, -32.4, 4.05, z + 0.12, 0.02);
  }
  k.deco('steel', -40.15, 2.0, 13.45, -39.85, h - 0.2, 13.65, 0.02);

  // Generator Basement Stairwell (x in [-60, -52], z in [-16, -4], clean y = 0 -> y = -8)
  k.stairs(-56, -4, LV.ground, -56, -16, LV.sub, 4.0, 'steel', true);
  // Stairwell shaft side walls below ground so no void leaks around stairs
  k.wall(-60, -4, -60, -16, LV.sub, LV.ground, { thick: 0.4, mat: DARK_STONE, plain: true, back: true });
  k.wall(-52, -16, -52, -4, LV.sub, LV.ground, { thick: 0.4, mat: DARK_STONE, plain: true, back: true });
  k.wall(-60, -4, -52, -4, LV.sub, -2.5, { thick: 0.4, mat: DARK_STONE, plain: true, back: true });
  // Safety guardrails around stairwell hole on ground floor
  k.rail([-60, 0, -4, -60, 0, -16, -52, 0, -16, -52, 0, -4]);

  // Generator Sub-Basement (x in [-62, -40], z in [-30, -14], y = -8, ceiling y = -3.4)
  k.floor(DARK_STONE, -62, -30, -40, -14, LV.sub, 0.6, 5);
  // Ceiling covers z in [-30, -16] (clear of stairwell shaft z in [-16, -4])
  k.mass(DARK_STONE, -62, CEIL.sub, -30, -40, CEIL.sub + 0.5, -16, 5);
  // Sub-basement perimeter walls
  // West wall x = -62 (solid)
  k.wall(-62, -30, -62, -14, LV.sub, CEIL.sub, { thick: 0.5, mat: DARK_STONE, back: true, plain: true });
  // South wall z = -14 (clear around stair landing x in [-60, -52], solid flanking)
  k.wall(-62, -14, -60, -14, LV.sub, CEIL.sub, { thick: 0.5, mat: DARK_STONE, back: true, plain: true });
  k.wall(-52, -14, -40, -14, LV.sub, CEIL.sub, { thick: 0.5, mat: DARK_STONE, back: true, plain: true });
  // North wall z = -30: solid west of utility tunnel (x in [-62, -54]), open east into Utility Tunnel!
  k.wall(-54, -30, -62, -30, LV.sub, CEIL.sub, { thick: 0.5, mat: DARK_STONE, back: true, plain: true });
  // East wall x = -40: solid along z in [-20, -14] (also mounts breaker.bunker near z = -24 on a short stub pier)
  k.wall(-40, -14, -40, -20, LV.sub, CEIL.sub, { thick: 0.5, mat: DARK_STONE, back: true, plain: true });
  k.block(DARK_STONE, -40.6, LV.sub, -25.2, -39.8, CEIL.sub, -22.8, 0.04);

  // Hydraulic Capacitor Bank at (-50, -8, -22)
  k.block('steelDark', -51.8, LV.sub, -23.4, -48.2, LV.sub + 0.45, -20.6, 0.05);
  k.block('steel', -51.4, LV.sub + 0.45, -23.0, -50.2, LV.sub + 3.2, -21.0, 0.06);
  k.block('steel', -49.8, LV.sub + 0.45, -23.0, -48.6, LV.sub + 3.2, -21.0, 0.06);
  // High-voltage copper busbars & glowing charge gauges
  k.deco('rust', -51.5, LV.sub + 1.4, -23.1, -48.5, LV.sub + 1.65, -20.9, 0.02);
  k.deco('rust', -51.5, LV.sub + 2.5, -23.1, -48.5, LV.sub + 2.75, -20.9, 0.02);
  k.deco('emissiveCyan', -50.95, LV.sub + 1.75, -20.95, -50.65, LV.sub + 2.4, -20.9, 0.01);
  k.deco('emissiveOrange', -49.35, LV.sub + 1.75, -20.95, -49.05, LV.sub + 2.4, -20.9, 0.01);
  // Overhead hydraulic pressure manifold running east toward the bunker
  k.deco('steel', -50, CEIL.sub - 0.55, -22.25, -24, CEIL.sub - 0.25, -21.75, 0.03);
}

/** Grand Courtyard (x in [-26, 26], z in [-22, 36]): plaza, reflecting pool, colonnades, floodlight poles. */
function grandCourtyard(k: Kit): void {
  // Pale limestone plaza paving
  k.geo.use(LIMESTONE).tint(0.84, 0.83, 0.8);
  k.geo.slab(0, 0.02, 7, 25, 0.02, 29, 6, FACE.py);
  k.geo.tint(1);

  // Dark modernist reflecting pool (x in [-10, 10], z in [-6, 14]), walkable shallow obsidian surface
  k.geo.use('glass').tint(0.12, 0.16, 0.22);
  k.geo.slab(0, 0.04, 4, 9.6, 0.02, 9.6, 4, FACE.py);
  k.geo.tint(1);
  // Low decorative stone coping rim around reflecting pool (non-blocking 0.14 m lip)
  k.deco(LIMESTONE, -10.3, 0, -6.3, 10.3, 0.14, -5.8, 0.02);
  k.deco(LIMESTONE, -10.3, 0, 13.8, 10.3, 0.14, 14.3, 0.02);
  k.deco(LIMESTONE, -10.3, 0, -5.8, -9.8, 0.14, 13.8, 0.02);
  k.deco(LIMESTONE, 9.8, 0, -5.8, 10.3, 0.14, 13.8, 0.02);
  // Flush limestone promenade deck across south pool edge supporting CHANCERY_HUB = (0, 0, 12)
  k.deco(LIMESTONE, -10.2, 0, 10.4, 10.2, 0.06, 13.8, 0.02);

  // Symmetrical West & East Stone Colonnade Arcades (x = -22 and x = +22, z in [-20, 28])
  for (const sx of [-22, 22]) {
    for (let z = -20; z <= 28; z += 6) {
      k.column(sx, z, 0, 4.4, 0.85, LIMESTONE);
    }
    // Overhead limestone entablature & roof strip (no pillars blocking walking aisles)
    k.block(LIMESTONE, sx - 1.1, 4.4, -21, sx + 1.1, 5.1, 29, 0.06);
  }
  // Low waist-high courtyard cover plinths & stone planters
  for (const sx of [-15, 15]) {
    hedgePlanter(k, sx - 1.5, 4, sx + 1.5, 9, 0, 1.1);
    k.block(LIMESTONE, sx - 1.6, 0, -4, sx + 1.6, 0.95, -2.8, 0.04);
    k.block(LIMESTONE, sx - 1.6, 0, 27, sx + 1.6, 0.95, 28.2, 0.04);
  }

  // 4 sleek Courtyard Floodlight Poles matching CHANCERY_LIGHTS floodlights (no bright baked lights!)
  for (const [fx, fz] of [[-16, 22], [16, 22], [-16, -10], [16, -10]] as const) {
    k.deco(DARK_STONE, fx - 0.35, 0, fz - 0.35, fx + 0.35, 0.5, fz + 0.35, 0.04);
    k.geo.use(IRON_BAR).cyl(fx, 0.5, fz, fx, 4.75, fz, 0.1, 0.07, 8, false, false);
    k.collide(fx, 2.35, fz, 0.18, 2.35, 0.18, 'metal', false);
  }
}

/** East Hedge Terrace (x in [28, 74], z in [14, 46]): terraced stone cover & hedges. */
function eastHedgeTerrace(k: Kit): void {
  k.geo.use('dirt').tint(0.4, 0.39, 0.35);
  k.geo.slab(48, 0.02, 28, 2.2, 0.02, 16, 4, FACE.py);
  k.geo.slab(52, 0.02, 24, 18, 0.02, 2.0, 4, FACE.py);
  k.geo.tint(1);

  hedgePlanter(k, 32, 26, 42, 28.5);
  hedgePlanter(k, 32, 17, 42, 19.5);
  hedgePlanter(k, 54, 34, 66, 36.5);
  hedgePlanter(k, 54, 24, 66, 26.5);
  hedgePlanter(k, 58, 15, 70, 17.5);

  k.block(LIMESTONE, 44, 0, 38, 52, 1.15, 38.6, 0.04);
  k.block(LIMESTONE, 64, 0, 30, 72, 1.15, 30.6, 0.04);

  gardenLampBase(k, 42, 30);
  gardenLampBase(k, 60, 24);
}

/** Glass Conservatory (x in [34, 62], z in [-26, 10], roof y = 5.6) + mantle route to roof. */
function glassConservatory(k: Kit, spec: MapSpec): void {
  const x0 = 34, x1 = 62, z0 = -26, z1 = 10, roofY = CEIL.conservatory;

  // Conservatory tile floor inlay
  k.geo.use('tile').tint(0.76, 0.78, 0.76);
  k.geo.slab(48, 0.02, -3, 13.5, 0.02, 12.5, 5, FACE.py);
  k.geo.tint(1);

  // Low limestone knee walls (0.9 m) with doorway breaks:
  // South z = 10 (doorway x in [46, 50])
  k.block(LIMESTONE, x0, 0, z1 - 0.3, 46, 0.9, z1 + 0.3, 0.04);
  k.block(LIMESTONE, 50, 0, z1 - 0.3, x1, 0.9, z1 + 0.3, 0.04);
  // West x = 34 (doorway z in [-4, 0])
  k.block(LIMESTONE, x0 - 0.3, 0, z0, x0 + 0.3, 0.9, -4, 0.04);
  k.block(LIMESTONE, x0 - 0.3, 0, 0, x0 + 0.3, 0.9, z1, 0.04);
  // East x = 62 (solid knee wall)
  k.block(LIMESTONE, x1 - 0.3, 0, z0, x1 + 0.3, 0.9, z1, 0.04);
  // North z = -26 flanking Bell Tower (x in [34, 44] and [56, 62])
  k.block(LIMESTONE, x0, 0, z0 - 0.3, 44, 0.9, z0 + 0.3, 0.04);
  k.block(LIMESTONE, 56, 0, z0 - 0.3, x1, 0.9, z0 + 0.3, 0.04);

  // Steel structural columns & top eave ring at y = 5.6 (visual + light colliders at corners)
  for (const z of [-26, -16, -8, 0, 10]) {
    k.deco(IRON_BAR, x0 - 0.14, 0.9, z - 0.14, x0 + 0.14, roofY, z + 0.14, 0.02);
    k.deco(IRON_BAR, x1 - 0.14, 0.9, z - 0.14, x1 + 0.14, roofY, z + 0.14, 0.02);
  }
  // Vaulted steel gable ribs across main botanical hall (z = -12, -4, 4 — peak at y = 7.2, well below sightlines!)
  for (const z of [-12, -4, 4]) {
    k.beam(x0, roofY, z, 48, roofY + 1.6, z, 0.12, 0.16, IRON_BAR, false);
    k.beam(x1, roofY, z, 48, roofY + 1.6, z, 0.12, 0.16, IRON_BAR, false);
  }
  k.beam(48, roofY + 1.6, -16, 48, roofY + 1.6, 10, 0.12, 0.14, IRON_BAR, false);

  // Breakable glass wall panes on south, west, east walls
  for (const cx of [37, 43, 53, 59]) {
    spec.breakable('pane', cx, 3.1, z1, 0, 5.7, 4.3);
  }
  for (const cz of [-21, -12, -6, 5]) {
    spec.breakable('pane', x0, 3.1, cz, Math.PI / 2, 7.6, 4.3);
  }
  for (const cz of [-21, -12, -3, 5]) {
    spec.breakable('pane', x1, 3.1, cz, Math.PI / 2, 7.6, 4.3);
  }

  // Walkable steel-framed perimeter roof decks at y = 5.6 (flanking central breakable glass skylight)
  k.floor('steelDark', x0, z0, 44, z1, roofY, 0.28, 4);
  k.floor('steelDark', 56, z0, x1, z1, roofY, 0.28, 4);
  k.floor('steelDark', 44, 6, 56, z1, roofY, 0.28, 4);

  // Central conservatory roof skylight filled with flat breakable glass panes (x in [44, 56], z in [-16, 6])
  for (const cx of [47, 53]) {
    for (const cz of [-12.5, -5, 2.5]) {
      spec.breakable('pane', cx, roofY + 0.05, cz, 0, 5.8, 7.2, true);
    }
  }

  // Central botanical stone planters + breakable plants inside Conservatory
  hedgePlanter(k, 40, -10, 44, -2, 0, 1.15);
  hedgePlanter(k, 52, -10, 56, -2, 0, 1.15);
  for (const [px, pz] of [[42, 4], [54, 4], [38, -14], [58, -14]] as const) {
    spec.breakable('plant', px, 0, pz, 0);
  }

  // Exterior parkour mantle route on west wall -> Conservatory Roof (y = 5.6)
  // Step 1: stone planter (y = 1.3) -> Step 2: maintenance roof ledge (y = 2.6) -> Step 3: steel cornice (y = 4.1) -> Roof (5.6)
  k.block(LIMESTONE, 31.2, 0, 5.5, 33.8, 1.3, 9.5, 0.05);
  k.block('steelDark', 30.4, 2.2, 0.2, 33.8, 2.6, 5.6, 0.04);
  k.block('steelDark', 31.8, 3.7, -2.5, 33.8, 4.1, 0.5, 0.04);
  // Subtle jump/parkour stepping cornice on north-west corner toward East Private Loggia (x in [20, 30], z in [-50, -30], y = 6.0)
  k.block(LIMESTONE, 31.0, 5.3, -29.5, 34.0, 5.6, -25.8, 0.04);
}

/** East Bell Tower & Sniper Perch (x in [44, 56], z in [-28, -16], perch deck y = 11.5). */
function bellTower(k: Kit): void {
  const x0 = 44, x1 = 56, z0 = -28, z1 = -16;
  const midY = LV.upper; // 6.0
  const perchY = LV.perch; // 11.5

  // Tower shaft exterior masonry walls (y = 0..11.5)
  // South wall z = -16: doorway from Conservatory at x in [46, 50], y in [0, 3.6]
  k.wall(x0, z1, x1, z1, 0, perchY, {
    thick: 0.5,
    mat: LIMESTONE,
    back: true,
    bay: 6,
    openings: [{ u0: 2.0, u1: 6.0, v0: 0, v1: 3.6 }],
  });
  // West wall x = 44: ground doorway z in [-22.5, -19.5] + mid-level conservatory roof doorway at y = 6.0 (z in [-27.0, -24.8])
  k.wall(x0, z0, x0, z1, 0, perchY, {
    thick: 0.5,
    mat: LIMESTONE,
    back: true,
    bay: 6,
    openings: [
      { u0: 5.5, u1: 8.5, v0: 0, v1: 3.6 },
      { u0: 1.0, u1: 3.2, v0: midY - 0.4, v1: midY + 2.8 },
    ],
  });
  // North wall z = -28 (solid)
  k.wall(x1, z0, x0, z0, 0, perchY, { thick: 0.5, mat: LIMESTONE, back: true, bay: 6 });
  // East wall x = 56 (solid)
  k.wall(x1, z1, x1, z0, 0, perchY, { thick: 0.5, mat: LIMESTONE, back: true, bay: 6 });

  // Interior Switchback Stairs (y = 0 -> y = 6.0 landing -> y = 11.5 perch deck)
  // Flight 1: runs north along west interior wall x = 46.5, width 2.6 m
  k.stairs(46.5, -16.6, LV.ground, 46.5, -25.0, midY, 2.6, 'concrete', true);
  // Mid Landing at y = 6.0 (in CHANCERY_LEVELS!) across north end of tower
  k.floor(LIMESTONE, 44.4, -27.6, 55.6, -24.8, midY, 0.35, 3);
  // Flight 2: runs south along east interior wall x = 53.5, width 2.6 m
  k.stairs(53.5, -24.8, midY, 53.5, -17.4, perchY, 2.6, 'concrete', true);

  // Sniper Perch Deck at y = 11.5 (partitioned cleanly around Flight 2 stairwell hole x in [52.0, 55.2], z in [-24.9, -17.4])
  k.floor(LIMESTONE, x0, z0, 52.0, z1, perchY, 0.4, 3); // Main west sniper deck containing (48, 11.5, -22)
  k.floor(LIMESTONE, 52.0, z0, x1, -24.9, perchY, 0.4, 3);
  k.floor(LIMESTONE, 52.0, -17.4, x1, -15.6, perchY, 0.4, 3);
  // Safety railing beside interior Flight 2 stairwell pit
  k.rail([52.0, perchY, -24.9, 52.0, perchY, -17.4]);

  // Belfry Parapets:
  // West firing face (x in [44.0, 44.42], z in [-27.0, -17.0]): low 0.55 m stone embrasure (y = 12.05)
  // Guaranteed clear below BOTH sightlines from (48, 13.1, -22): Vane window crosses x=44 at y=12.64, Loggia at y=12.18!
  k.block(LIMESTONE, x0, perchY, -27.0, x0 + 0.42, perchY + 0.55, -17.0, 0.04);
  // North, East, and partial South parapets (0.9 m waist-high cover; SE edge open for parkour route)
  k.block(LIMESTONE, 44.8, perchY, z0, 55.2, perchY + 0.9, z0 + 0.42, 0.04);
  k.block(LIMESTONE, x1 - 0.42, perchY, -27.0, x1, perchY + 0.9, -17.0, 0.04);
  k.block(LIMESTONE, 44.8, perchY, z1 - 0.42, 52.0, perchY + 0.9, z1, 0.04);

  // Four slender corner belfry piers (far outside sightlines) + modernist canopy roof + bronze bell
  for (const [cx, cz] of [[44.4, -16.4], [55.6, -16.4], [55.6, -27.6], [44.4, -27.6]] as const) {
    k.column(cx, cz, perchY, CEIL.belfryRoof, 0.72, LIMESTONE);
  }
  k.mass(DARK_STONE, x0 - 0.4, CEIL.belfryRoof, z0 - 0.4, x1 + 0.4, CEIL.belfryRoof + 0.65, z1 + 0.4, 4);
  // Decorative cast bronze bell hung high under canopy (y = 14.9..16.2, well above eye level 13.1)
  k.geo.use('rust').cyl(50, 14.8, -22, 50, 16.0, -22, 0.75, 0.35, 10, true, true);
  k.deco(IRON_BAR, 49.9, 16.0, -22.1, 50.1, CEIL.belfryRoof, -21.9, 0.01);

  // Exterior Parkour Route: Conservatory Roof (y = 5.6) -> Buttress & Stepped Ledges -> Perch Deck (y = 11.5)
  k.block(LIMESTONE, 56.0, 0, -18.5, 58.0, 7.4, -14.5, 0.06); // Angled south-east buttress climbable from roof (5.6 -> 7.4)
  k.block('steelDark', 56.0, 9.0, -24.5, 57.8, 9.4, -18.5, 0.04); // East exterior wall-run & mantle ledge (7.4 -> 9.4)
  k.block('steelDark', 52.4, 10.3, -16.0, 56.8, 10.6, -14.4, 0.04); // South-east top mantle step (9.4 -> 10.6 -> 11.5)
}

/** North Cliff Bluff parapet (z = -66), escarpment drop, and visual-only Burning Holdfast Horizon. */
function cliffAndHorizon(k: Kit): void {
  // Low stone cliff parapet along z = -66 with scenic center rail
  k.block(LIMESTONE, -86, 0, -66.5, -14, 0.95, -65.7, 0.05);
  k.block(LIMESTONE, 14, 0, -66.5, 86, 0.95, -65.7, 0.05);
  k.rail([-14, 0, -66.1, 14, 0, -66.1], 1.0, 2.0);

  // Visual-only cliff escarpment rock face dropping below killY (-18)
  k.geo.use(DARK_STONE).tint(0.35, 0.36, 0.38);
  k.geo.slab(0, -14, -67.5, 92, 14, 1.5, 8, FACE.nz | FACE.py);
  k.geo.tint(1);

  // Visual-only Burning Holdfast Horizon silhouettes far outside play bounds (zero colliders!)
  // North horizon over the salt flats (z = -126)
  const silhouettes: readonly [number, number, number, number][] = [
    [-72, -126, 8, 18], [-54, -130, 5, 28], [-38, -125, 11, 14], [-18, -132, 6, 32],
    [4, -128, 14, 16], [26, -130, 5, 26], [46, -126, 10, 19], [68, -128, 7, 22],
  ];
  for (const [sx, sz, sw, sh] of silhouettes) {
    k.geo.use('concreteDark').tint(0.16, 0.14, 0.14);
    k.geo.box(sx, -12 + sh / 2, sz, sw / 2, sh / 2, 2.5, FACE.pz | FACE.py | FACE.px | FACE.nx);
    k.geo.tint(1);
  }
  // Glowing amber/orange burning salt-flat ember bands on the far north & south horizons
  k.geo.use('emissiveOrange').tint(0.95, 0.45, 0.14);
  k.geo.box(-30, -8, -122, 34, 1.4, 0.4, FACE.pz);
  k.geo.box(38, -9, -123, 28, 1.2, 0.4, FACE.pz);
  k.geo.use('lava').tint(0.9, 0.3, 0.1);
  k.geo.box(-14, -11, -121, 18, 0.8, 0.4, FACE.pz);
  k.geo.box(24, -11, -122, 14, 0.7, 0.4, FACE.pz);
  // Subtle distant ember glow on far south coast (z = 112)
  k.geo.use('emissiveOrange').tint(0.65, 0.28, 0.1);
  k.geo.box(-40, -2, 112, 24, 0.9, 0.4, FACE.nz);
  k.geo.box(44, -2, 112, 20, 0.9, 0.4, FACE.nz);
  k.geo.tint(1);
}

/**
 * Dark, moody moonlit baked baseline for the outer grounds (16 low-intensity lights).
 * Deliberately dim so shooting out or cutting the 44 dynamic CHANCERY_LIGHTS plunges areas into true stealth shadow!
 */
function groundsMoodLights(k: Kit): void {
  const MOON = 0x4b688e;
  const EMBER = 0xb84c1c;
  const SUB_RED = 0x992020;

  // High cool silver-blue moonlight washes (subtle intensity 16–22, wide soft falloff)
  k.light(-55, 22, 58, MOON, 18, 44);
  k.light(0, 24, 48, MOON, 18, 46);
  k.light(-52, 22, 28, MOON, 16, 42);
  k.light(0, 26, 8, MOON, 20, 50);
  k.light(52, 22, 28, MOON, 16, 42);
  k.light(-50, 22, -4, MOON, 14, 38);
  k.light(48, 22, -6, MOON, 16, 40);
  k.light(48, 17, -22, MOON, 16, 26); // Subtle moonlight on Bell Tower Sniper Perch
  k.light(-40, 22, -46, MOON, 15, 40);
  k.light(40, 22, -46, MOON, 15, 40);

  // Faint burning Holdfast ember wash along the north cliff edge
  k.light(-34, 8, -72, EMBER, 16, 44);
  k.light(28, 8, -72, EMBER, 16, 44);

  // Very dim ambient red emergency beacons in Generator House & Sub-Basement (never lights the room brightly)
  k.light(-56, 3.8, -10, SUB_RED, 8, 14);
  k.light(-50, -4.5, -22, SUB_RED, 10, 15);
}

export function authorGrounds(k: Kit, spec: MapSpec): void {
  groundSlabAndContainment(k);
  perimeterAndGate(k, spec);
  westGarden(k);
  generatorComplex(k, spec);
  grandCourtyard(k);
  eastHedgeTerrace(k);
  glassConservatory(k, spec);
  bellTower(k);
  cliffAndHorizon(k);
  groundsMoodLights(k);
}
