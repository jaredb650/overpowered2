/**
 * Brine Central Reserve exterior, neoclassical portico, sunlit rooftop,
 * Tier-1 destructible Atrium Skylight Dome (`bank.skylight`), coastal financial-district
 * skyline backdrop, and offset 4-lane Coastal Elevated Expressway static deck.
 */
import type { Kit } from '../../kit/kit';
import { FACE } from '../../kit/geo';
import type { MapSpec } from '../spec';
import {
  BANK_BOUNDS,
  CEIL,
  HIGHWAY_HALF_LEN,
  HIGHWAY_HALF_WIDTH,
  HIGHWAY_LANES,
  HIGHWAY_ORIGIN,
  LV,
  ROOF_HELIPAD,
  SKYLIGHT_BOUNDS,
} from './plan';

const MARBLE = 'concrete' as const;
const GRANITE = 'concreteDark' as const;
const BRONZE = 'steelDark' as const;
const STEEL = 'steel' as const;

/** Tall neoclassical fluted column with plinth and Doric/Ionic capital. */
function flutedColumn(k: Kit, x: number, z: number, y0: number, y1: number, r = 0.62): void {
  const g = k.geo;
  // Square stepped marble plinth
  g.use(GRANITE).tint(0.86);
  g.bevel(x, y0 + 0.3, z, r + 0.24, 0.3, r + 0.24, 0.05);
  g.use(MARBLE).tint(0.95);
  g.bevel(x, y0 + 0.72, z, r + 0.14, 0.14, r + 0.14, 0.04);
  // Tapered cylindrical shaft (12-sided reads crisply as fluted stone)
  g.use(MARBLE).tint(0.96, 0.95, 0.92);
  g.cyl(x, y0 + 0.86, z, x, y1 - 0.58, z, r, r * 0.91, 12, false, false);
  // Capital necking & abacus
  g.use(MARBLE).tint(0.92);
  g.bevel(x, y1 - 0.42, z, r + 0.12, 0.16, r + 0.12, 0.04);
  g.bevel(x, y1 - 0.14, z, r + 0.28, 0.14, r + 0.28, 0.05);
  g.tint(1);
  k.collide(x, (y0 + y1) / 2, z, r, (y1 - y0) / 2, r, 'concrete');
}

/** Decorative neoclassical marble planter with coastal cypress shrub (crouch cover). */
function plazaPlanter(k: Kit, x0: number, z0: number, x1: number, z1: number, h = 1.2): void {
  k.block(MARBLE, x0, 0, z0, x1, 0.58, z1, 0.05);
  k.geo.use('dirt').tint(0.24, 0.38, 0.22);
  k.geo.bevel(
    (x0 + x1) / 2,
    0.58 + (h - 0.58) / 2,
    (z0 + z1) / 2,
    (x1 - x0) / 2 - 0.12,
    (h - 0.58) / 2,
    (z1 - z0) / 2 - 0.12,
    0.08,
  );
  k.geo.tint(1);
  k.collide((x0 + x1) / 2, h / 2, (z0 + z1) / 2, (x1 - x0) / 2 - 0.08, h / 2, (z1 - z0) / 2 - 0.08, 'dirt');
}

/** Ground slab partitioned around the sub-grade vault/antechamber footprint + precinct containment. */
function groundAndPlaza(k: Kit): void {
  // Partition y = 0 ground slab around bank sub-grade zone x in [-28, 28], z in [-44, -16]
  k.floor(MARBLE, -64, -16, 64, 64, LV.hall, 0.6, 6); // South plaza, avenue & grand hall sub-slab
  k.floor(GRANITE, -64, -64, 64, -44, LV.hall, 0.6, 6); // North rear service lot
  k.floor(GRANITE, -64, -44, -28, -16, LV.hall, 0.6, 6); // West side avenue
  k.floor(GRANITE, 28, -44, 64, -16, LV.hall, 0.6, 6); // East side avenue

  // Bright granite plaza paving & coastal avenue asphalt inlay (non-colliding visual layers at y = 0.02)
  const g = k.geo;
  g.use('tile').tint(0.88, 0.86, 0.82);
  g.slab(0, 0.02, 28.5, 36, 0.015, 5.5, 4, FACE.py);
  // Coastal avenue asphalt z in [34, 56]
  g.use('asphalt').tint(0.95);
  g.slab(0, 0.02, 45, 63.5, 0.015, 11, 6, FACE.py);
  // Curbs flanking coastal avenue
  g.use(GRANITE).tint(0.82);
  g.box(0, 0.06, 33.85, 63.5, 0.06, 0.18, FACE.py | FACE.pz | FACE.nz);
  g.box(0, 0.06, 56.15, 63.5, 0.06, 0.18, FACE.py | FACE.pz | FACE.nz);
  // Lane dashes along z = 45 (two-way coastal boulevard)
  g.use('paintYellow');
  for (let x = -56; x <= 56; x += 6) {
    g.box(x, 0.04, 45.0, 1.8, 0.01, 0.12, FACE.py);
  }
  g.use('paintWhite');
  for (let x = -54; x <= 54; x += 8) {
    g.box(x, 0.04, 39.5, 1.6, 0.01, 0.09, FACE.py);
    g.box(x, 0.04, 50.5, 1.6, 0.01, 0.09, FACE.py);
  }
  // Crosswalk stripes west & east of Humvee lane
  for (const cx of [-22, 22]) {
    for (let z = 35.5; z <= 54.5; z += 1.6) {
      g.box(cx, 0.04, z, 1.6, 0.01, 0.35, FACE.py);
    }
  }
  g.tint(1);

  // Low civic perimeter walls around plaza precinct (x = ±63, z = 62, z = -62)
  k.wall(-63, 62, 63, 62, 0, 2.2, { thick: 0.7, mat: GRANITE, back: true, bay: 12, cap: true });
  k.wall(-63, -62, -63, 62, 0, 2.4, { thick: 0.7, mat: GRANITE, back: true, bay: 12, cap: true });
  k.wall(63, 62, 63, -62, 0, 2.4, { thick: 0.7, mat: GRANITE, back: true, bay: 12, cap: true });
  k.wall(63, -62, -63, -62, 0, 2.4, { thick: 0.7, mat: GRANITE, back: true, bay: 12, cap: true });

  // Invisible precinct containment (keeps rocket-jumps inside the bank block without blocking offset highway at x = 128!)
  const midY = (BANK_BOUNDS.y0 + BANK_BOUNDS.y1) / 2;
  const halfY = (BANK_BOUNDS.y1 - BANK_BOUNDS.y0) / 2 + 6;
  k.containment(-64.5, midY, 0, 0.5, halfY, 65);
  k.containment(64.5, midY, 0, 0.5, halfY, 65);
  k.containment(0, midY, 64.5, 65, halfY, 0.5);
  k.containment(0, midY, -64.5, 65, halfY, 0.5);

  // Decorative planters & street cover flanking Getaway Humvee lane (x in [-5.5, 5.5], z in [24, 46] kept 100% clear!)
  plazaPlanter(k, -15.5, 32.2, -11.5, 34.8, 1.25);
  plazaPlanter(k, 11.5, 32.2, 15.5, 34.8, 1.25);
  plazaPlanter(k, -28.0, 28.0, -24.0, 32.5, 1.25);
  plazaPlanter(k, 24.0, 28.0, 28.0, 32.5, 1.25);

  // Granite bollards & tactical street cover flanking Humvee Park (HUMVEE_PARK_POS = [0, 0, 35.5])
  // Clear of PICKUP_SPOTS [±10, 0, 36] and GROUND_SPAWNS [±18, 0, 42]!
  k.block(GRANITE, -8.2, 0, 38.4, -6.2, 1.15, 39.4, 0.05);
  k.block(GRANITE, 6.2, 0, 38.4, 8.2, 1.15, 39.4, 0.05);
  k.block(GRANITE, -23.0, 0, 35.2, -19.5, 1.15, 36.2, 0.05);
  k.block(GRANITE, 19.5, 0, 35.2, 23.0, 1.15, 36.2, 0.05);
  k.block(GRANITE, -14.5, 0, 49.0, -10.5, 1.1, 50.0, 0.05);
  k.block(GRANITE, 10.5, 0, 49.0, 14.5, 1.1, 50.0, 0.05);

  // Coastal avenue boulevard streetlamps (decorative poles outside main traffic lane)
  for (const sx of [-36, -18, 18, 36]) {
    k.deco(BRONZE, sx - 0.14, 0, 33.4, sx + 0.14, 7.6, 33.68, 0.03);
    k.deco('emissiveWhite', sx - 0.25, 7.45, 33.8, sx + 0.25, 7.65, 34.4, 0.02);
    k.deco(BRONZE, sx - 0.14, 0, 56.32, sx + 0.14, 7.6, 56.6, 0.03);
    k.deco('emissiveWhite', sx - 0.25, 7.45, 55.6, sx + 0.25, 7.65, 56.2, 0.02);
  }
}

/** Neoclassical front portico (z = 24..30), grand steps & pediment. */
function frontPortico(k: Kit): void {
  // 6 tall fluted marble portico columns along z = 29.0 (wide open 10.4 m central carriageway for Humvee!)
  for (const cx of [-14.2, -9.6, -5.2, 5.2, 9.6, 14.2]) {
    flutedColumn(k, cx, 29.0, 0, 12.6, 0.64);
  }

  // Portico entablature, frieze & cornice overhang (y = 12.6..14.0, z = 24..30.2)
  k.block(MARBLE, -16.6, 12.6, 24.0, 16.6, 13.7, 30.2, 0.06);
  k.deco(GRANITE, -17.0, 13.7, 23.8, 17.0, 14.15, 30.6, 0.05);
  // Classical gold/bronze reserve frieze plaque
  k.deco(BRONZE, -11.5, 12.85, 30.18, 11.5, 13.52, 30.32, 0.02);
  k.deco('paintYellow', -8.8, 13.06, 30.3, 8.8, 13.32, 30.36, 0.01);

  // Stepped triangular classical pediment crowning the portico (y = 14.15..17.1, z = 29.5..30.3)
  const g = k.geo;
  g.use(MARBLE).tint(0.95, 0.94, 0.9);
  for (let i = 0; i < 6; i++) {
    const t0 = i / 6;
    const hw = 16.2 * (1 - t0);
    const y0 = 14.15 + i * 0.46;
    g.bevel(0, y0 + 0.23, 29.85, hw, 0.23, 0.48, 0.04);
  }
  g.tint(1);

  // Ornamental granite front steps & flanking plinths (z = 24..32):
  // Central lane x in [-4.5, 4.5] stays flush y = 0 so Humvee tailgate [0, 1.0, 32.8] & portico door [0, 0, 24] sit cleanly on grade;
  // Wide stepped granite riser inlays across the threshold + low granite cheek plinths flanking the steps!
  g.use(GRANITE).tint(0.84);
  for (let i = 0; i < 5; i++) {
    const z = 25.0 + i * 1.45;
    g.box(0, 0.03, z, 15.6, 0.02, 0.45, FACE.py | FACE.pz | FACE.nz);
  }
  g.tint(1);
  // Flanking granite cheek walls framing the portico steps
  k.block(GRANITE, -16.8, 0, 24.4, -15.6, 1.1, 31.8, 0.05);
  k.block(GRANITE, 15.6, 0, 24.4, 16.8, 1.1, 31.8, 0.05);
  // Decorative bronze lantern pedestals at portico foot
  k.deco(BRONZE, -16.5, 1.1, 31.1, -15.9, 2.2, 31.7, 0.04);
  k.deco('emissiveWhite', -16.4, 1.5, 31.2, -16.0, 2.05, 31.6, 0.02);
  k.deco(BRONZE, 15.9, 1.1, 31.1, 16.5, 2.2, 31.7, 0.04);
  k.deco('emissiveWhite', 16.0, 1.5, 31.2, 16.4, 2.05, 31.6, 0.02);
}

/** Neoclassical bank exterior facade enclosing x in [-28, 28], z in [-44, 24], y = 0..14. */
function bankExteriorShell(k: Kit): void {
  // South Front Facade (z = 24, x in [-28, 28], y = 0..14)
  // 6 m wide open portico doorway at x in [-3, 3] (u = x + 28 -> 25..31), plus high sunlit arched windows!
  k.wall(-28, 24, 28, 24, 0, LV.roof, {
    thick: 1.2,
    mat: MARBLE,
    back: true,
    bay: 7,
    openings: [
      { u0: 5, u1: 9, v0: 7.2, v1: 11.4 },
      { u0: 14, u1: 18, v0: 7.2, v1: 11.4 },
      { u0: 25, u1: 31, v0: 0, v1: 4.8, frame: true },
      { u0: 38, u1: 42, v0: 7.2, v1: 11.4 },
      { u0: 47, u1: 51, v0: 7.2, v1: 11.4 },
    ],
  });

  // Decorative arched window trim & glass glazing for south upper windows
  for (const wx of [-21, -12, 12, 21]) {
    k.deco('glass', wx - 1.95, 7.25, 23.95, wx + 1.95, 11.35, 24.05, 0.01);
    k.deco(BRONZE, wx - 2.1, 11.2, 23.4, wx + 2.1, 11.6, 24.65, 0.03);
    k.deco(MARBLE, wx - 2.2, 6.9, 23.4, wx + 2.2, 7.25, 24.75, 0.04);
  }

  // West Exterior Facade (x = -27.4, z in [-44, 24], y = -2.0..14.0 -> seals sub-grade vault sides too!)
  // High clerestory windows along Grand Hall section (z in [-12, 18] -> u = z + 44 = 32..62)
  k.wall(-27.4, -44, -27.4, 24, -2.0, LV.roof, {
    thick: 1.2,
    mat: MARBLE,
    back: true,
    bay: 8,
    openings: [
      { u0: 36, u1: 40, v0: 7.2, v1: 11.4 },
      { u0: 46, u1: 50, v0: 7.2, v1: 11.4 },
      { u0: 56, u1: 60, v0: 7.2, v1: 11.4 },
    ],
  });
  for (const wz of [-6, 4, 14]) {
    k.deco('glass', -27.45, 7.25, wz - 1.95, -27.35, 11.35, wz + 1.95, 0.01);
    k.deco(BRONZE, -28.05, 11.2, wz - 2.1, -26.8, 11.6, wz + 2.1, 0.03);
  }

  // East Exterior Facade (x = +27.4, z in [24, -44], y = -2.0..14.0)
  // u = 24 - z -> z = 14..18 is u = 6..10; z = 4..8 -> wait: z=16..12 is u=8..12, z=6..2 is u=18..22, z=-4..-8 is u=28..32
  k.wall(27.4, 24, 27.4, -44, -2.0, LV.roof, {
    thick: 1.2,
    mat: MARBLE,
    back: true,
    bay: 8,
    openings: [
      { u0: 8, u1: 12, v0: 7.2, v1: 11.4 },
      { u0: 18, u1: 22, v0: 7.2, v1: 11.4 },
      { u0: 28, u1: 32, v0: 7.2, v1: 11.4 },
    ],
  });
  for (const wz of [-6, 4, 14]) {
    k.deco('glass', 27.35, 7.25, wz - 1.95, 27.45, 11.35, wz + 1.95, 0.01);
    k.deco(BRONZE, 26.8, 11.2, wz - 2.1, 28.05, 11.6, wz + 2.1, 0.03);
  }

  // North Exterior Facade (z = -43.4, x in [28, -28], y = -2.0..14.0, reinforced blind vault facade)
  k.wall(28, -43.4, -28, -43.4, -2.0, LV.roof, {
    thick: 1.2,
    mat: MARBLE,
    back: true,
    bay: 8,
  });

  // Recessed mechanical vault wing roof cap (z in [-43, -22] at y = 12.4 — non-walkable level behind north roof parapet)
  k.floor(GRANITE, -27.0, -43.0, 27.0, -22.0, 12.4, 0.5, 6);

  // Continuous neoclassical cornice band wrapping the top of the bank exterior (y = 13.65..14.2)
  k.deco(MARBLE, -28.6, 13.65, -44.6, 28.6, 14.15, -43.0, 0.05);
  k.deco(MARBLE, -28.6, 13.65, 23.6, 28.6, 14.15, 25.0, 0.05);
  k.deco(MARBLE, -28.6, 13.65, -44.6, -27.2, 14.15, 25.0, 0.05);
  k.deco(MARBLE, 27.2, 13.65, -44.6, 28.6, 14.15, 25.0, 0.05);
}

/**
 * Playable Rooftop (y = 14, x in [-28, 28], z in [-22, 26]):
 * - 4+ partitioned slabs leaving an ACTUAL OPEN APERTURE matching SKYLIGHT_BOUNDS
 * - Tier-1 `bank.skylight` StructuralClusterSpec dome over the aperture
 * - Painted Helipad at ROOF_HELIPAD = [0, 14, 18]
 * - Marble perimeter parapet, HVAC chillers, north sniper bulkheads
 * - Walkable Rooftop Stairwell Headhouse descending from [-20, 14, -12] to west mezzanine (-24.3, 5.5, -3.5)
 */
function rooftopAndSkylight(k: Kit, spec: MapSpec): void {
  const y = LV.roof; // 14.0
  const thick = 0.4; // bottom at 13.6 = CEIL.hall
  const S = SKYLIGHT_BOUNDS; // x in [-4.5, 4.5], z in [-2.5, 6.5]

  // Partitioned y = 14 roof slabs around BOTH SKYLIGHT_BOUNDS and the west stairwell shaft (x in [-26.2, -22.4], z in [-15.5, -8.5])
  k.floor(GRANITE, -28, S.z1, 28, 26, y, thick, 5); // South roof (Helipad, satchel crate, pickups)
  k.floor(GRANITE, S.x1, S.z0, 28, S.z1, y, thick, 4); // East of skylight
  k.floor(GRANITE, -28, S.z0, S.x0, S.z1, y, thick, 4); // West of skylight
  k.floor(GRANITE, -22.4, -22, 28, S.z0, y, thick, 5); // North-East roof (north spawns & stair door [-20, 14, -12])
  k.floor(GRANITE, -28, -8.5, -22.4, S.z0, y, thick, 3); // West-South of stairwell shaft
  k.floor(GRANITE, -28, -22, -22.4, -15.5, y, thick, 3); // West-North of stairwell shaft (top stair landing!)
  k.floor(GRANITE, -28, -15.5, -26.2, -8.5, y, thick, 2); // Far-west rim beside stairwell

  // Low static marble curb framing SKYLIGHT_BOUNDS outside the open aperture (never blocks the 9 m x 9 m drop!)
  k.block(MARBLE, S.x0 - 0.55, y, S.z0 - 0.55, S.x1 + 0.55, y + 0.32, S.z0 - 0.05, 0.04);
  k.block(MARBLE, S.x0 - 0.55, y, S.z1 + 0.05, S.x1 + 0.55, y + 0.32, S.z1 + 0.55, 0.04);
  k.block(MARBLE, S.x0 - 0.55, y, S.z0 - 0.05, S.x0 - 0.05, y + 0.32, S.z1 + 0.05, 0.04);
  k.block(MARBLE, S.x1 + 0.05, y, S.z0 - 0.05, S.x1 + 0.55, y + 0.32, S.z1 + 0.05, 0.04);

  // Tier-1 Destructible Central Atrium Skylight Dome (`bank.skylight`)
  // Spans x in [-4.5, 4.5], z in [-2.5, 6.5], y = 14..15.2; shattered by satchels/breach_charge into crushing debris!
  spec.cluster({
    id: 'bank.skylight',
    tag: 'bank.skylight',
    kind: 'skylight',
    label: 'ATRIUM SKYLIGHT DOME',
    value: 85_000,
    collapseThreshold: 0.35,
    nodes: [
      // 4 anchored steel perimeter ribs
      {
        id: 'skylight_rib_n',
        pos: [0, 14.32, -2.1],
        half: [4.4, 0.22, 0.35],
        mat: 'steelDark',
        color: 0x3b4858,
        hp: 150,
        tier: 1,
        anchored: true,
        kind: 'roof',
        supports: ['skylight_glass_nw', 'skylight_glass_ne'],
        impactRadius: 4.0,
        impactDamage: 180,
        label: 'SKYLIGHT NORTH RIB',
      },
      {
        id: 'skylight_rib_s',
        pos: [0, 14.32, 6.1],
        half: [4.4, 0.22, 0.35],
        mat: 'steelDark',
        color: 0x3b4858,
        hp: 150,
        tier: 1,
        anchored: true,
        kind: 'roof',
        supports: ['skylight_glass_sw', 'skylight_glass_se'],
        impactRadius: 4.0,
        impactDamage: 180,
        label: 'SKYLIGHT SOUTH RIB',
      },
      {
        id: 'skylight_rib_w',
        pos: [-4.1, 14.32, 2.0],
        half: [0.35, 0.22, 3.8],
        mat: 'steelDark',
        color: 0x3b4858,
        hp: 150,
        tier: 1,
        anchored: true,
        kind: 'roof',
        supports: ['skylight_glass_nw', 'skylight_glass_sw'],
        impactRadius: 4.0,
        impactDamage: 180,
        label: 'SKYLIGHT WEST RIB',
      },
      {
        id: 'skylight_rib_e',
        pos: [4.1, 14.32, 2.0],
        half: [0.35, 0.22, 3.8],
        mat: 'steelDark',
        color: 0x3b4858,
        hp: 150,
        tier: 1,
        anchored: true,
        kind: 'roof',
        supports: ['skylight_glass_ne', 'skylight_glass_se'],
        impactRadius: 4.0,
        impactDamage: 180,
        label: 'SKYLIGHT EAST RIB',
      },
      // 4 laminated glass dome quadrant panes
      {
        id: 'skylight_glass_nw',
        pos: [-2.05, 14.7, 0.0],
        half: [1.95, 0.14, 1.95],
        mat: 'glass',
        color: 0x9ed8f0,
        hp: 110,
        tier: 1,
        anchored: false,
        kind: 'roof',
        supports: ['skylight_rib_n', 'skylight_rib_w', 'skylight_crown'],
        impactRadius: 4.5,
        impactDamage: 220,
        label: 'SKYLIGHT GLASS NW',
      },
      {
        id: 'skylight_glass_ne',
        pos: [2.05, 14.7, 0.0],
        half: [1.95, 0.14, 1.95],
        mat: 'glass',
        color: 0x9ed8f0,
        hp: 110,
        tier: 1,
        anchored: false,
        kind: 'roof',
        supports: ['skylight_rib_n', 'skylight_rib_e', 'skylight_crown'],
        impactRadius: 4.5,
        impactDamage: 220,
        label: 'SKYLIGHT GLASS NE',
      },
      {
        id: 'skylight_glass_sw',
        pos: [-2.05, 14.7, 4.0],
        half: [1.95, 0.14, 1.95],
        mat: 'glass',
        color: 0x9ed8f0,
        hp: 110,
        tier: 1,
        anchored: false,
        kind: 'roof',
        supports: ['skylight_rib_s', 'skylight_rib_w', 'skylight_crown'],
        impactRadius: 4.5,
        impactDamage: 220,
        label: 'SKYLIGHT GLASS SW',
      },
      {
        id: 'skylight_glass_se',
        pos: [2.05, 14.7, 4.0],
        half: [1.95, 0.14, 1.95],
        mat: 'glass',
        color: 0x9ed8f0,
        hp: 110,
        tier: 1,
        anchored: false,
        kind: 'roof',
        supports: ['skylight_rib_s', 'skylight_rib_e', 'skylight_crown'],
        impactRadius: 4.5,
        impactDamage: 220,
        label: 'SKYLIGHT GLASS SE',
      },
      // Crown lantern keystone (breaking it collapses the dome!)
      {
        id: 'skylight_crown',
        pos: [0, 15.04, 2.0],
        half: [1.45, 0.16, 1.45],
        mat: 'steel',
        color: 0xc9dae8,
        hp: 120,
        tier: 1,
        anchored: false,
        keyNode: true,
        kind: 'roof',
        supports: ['skylight_glass_nw', 'skylight_glass_ne', 'skylight_glass_sw', 'skylight_glass_se'],
        impactRadius: 5.5,
        impactDamage: 260,
        label: 'SKYLIGHT CROWN LANTERN',
      },
    ],
  });

  // Painted Helipad at ROOF_HELIPAD = [0, 14, 18]
  const [hx, , hz] = ROOF_HELIPAD;
  const g = k.geo;
  g.use('asphalt').tint(0.88);
  g.box(hx, y + 0.02, hz, 6.4, 0.02, 5.4, FACE.py);
  // Yellow outer border stripes
  g.use('paintYellow');
  g.box(hx, y + 0.045, hz - 5.1, 6.2, 0.01, 0.24, FACE.py);
  g.box(hx, y + 0.045, hz + 5.1, 6.2, 0.01, 0.24, FACE.py);
  g.box(hx - 6.1, y + 0.045, hz, 0.24, 0.01, 5.1, FACE.py);
  g.box(hx + 6.1, y + 0.045, hz, 0.24, 0.01, 5.1, FACE.py);
  // Crisp white "H" marking
  g.use('paintWhite');
  g.box(hx - 1.9, y + 0.05, hz, 0.42, 0.01, 2.8, FACE.py);
  g.box(hx + 1.9, y + 0.05, hz, 0.42, 0.01, 2.8, FACE.py);
  g.box(hx, y + 0.05, hz, 1.9, 0.01, 0.42, FACE.py);
  // 4 corner amber helipad perimeter beacons
  for (const sx of [-6.0, 6.0]) {
    for (const sz of [-5.0, 5.0]) {
      k.deco(BRONZE, hx + sx - 0.16, y, hz + sz - 0.16, hx + sx + 0.16, y + 0.22, hz + sz + 0.16, 0.03);
      k.deco('emissiveOrange', hx + sx - 0.11, y + 0.22, hz + sz - 0.11, hx + sx + 0.11, y + 0.34, hz + sz + 0.11, 0.02);
    }
  }
  g.tint(1);

  // Marble Perimeter Parapet (h = 1.25 m -> top at CEIL.roofParapet = 15.25)
  const ph = CEIL.roofParapet;
  k.block(MARBLE, -28.0, y, -22.0, 28.0, ph, -21.2, 0.05); // North parapet
  k.block(MARBLE, -28.0, y, 25.2, 28.0, ph, 26.0, 0.05); // South parapet
  k.block(MARBLE, -28.0, y, -21.2, -27.2, ph, 25.2, 0.05); // West parapet
  k.block(MARBLE, 27.2, y, -21.2, 28.0, ph, 25.2, 0.05); // East parapet

  // North Sniper Bulkhead Cover overlooking skylight & helipad (clear of [0, 14, -12] spawn!)
  k.block(MARBLE, -10.0, y, -17.4, -4.4, y + 1.35, -16.2, 0.05);
  k.block(MARBLE, 4.4, y, -17.4, 10.0, y + 1.35, -16.2, 0.05);
  k.block(GRANITE, -11.5, y, -7.2, -8.5, y + 1.15, -6.2, 0.04);
  k.block(GRANITE, 8.5, y, -7.2, 11.5, y + 1.15, -6.2, 0.04);

  // Rooftop HVAC Chillers & Mechanical Equipment (clear of all spawns, pickups, satchel crate & helipad!)
  for (const [cx, cz] of [[18.5, -13.0], [18.5, 16.0], [-19.5, 16.0]] as const) {
    k.block(STEEL, cx - 2.6, y, cz - 1.7, cx + 2.6, y + 2.2, cz + 1.7, 0.06);
    k.deco(BRONZE, cx - 2.3, y + 2.2, cz - 1.4, cx + 2.3, y + 2.38, cz + 1.4, 0.03);
    k.deco('grate', cx - 1.8, y + 2.38, cz - 1.0, cx - 0.3, y + 2.45, cz + 1.0, 0.01);
    k.deco('grate', cx + 0.3, y + 2.38, cz - 1.0, cx + 1.8, y + 2.45, cz + 1.0, 0.01);
  }
  // Satchel Supply Pedestal beside ROOF_SATCHEL_POS = [-8, 14, 14] (offset slightly south so [-8, 14, 14] stays walkable)
  k.deco('hazard', -8.8, y + 0.01, 13.2, -7.2, y + 0.06, 14.8, 0.01);

  // Rooftop Stairwell Headhouse & Walkable Stairwell descending to West Mezzanine (y = 14 -> 5.5)
  // Doorway sits right at ROOF_STAIR_DOOR_POS = [-20, 14, -12] (open during static bake so NavGraph connects roof <-> mezz!)
  // Headhouse walls enclose x in [-26.4, -18.0], z in [-19.6, -12.0], y = 14..17.4
  k.wall(-26.4, -19.6, -26.4, -8.3, y, y + 3.4, { thick: 0.4, mat: MARBLE, back: true, plain: true }); // West bulkhead wall
  k.wall(-18.0, -19.6, -26.4, -19.6, y, y + 3.4, { thick: 0.4, mat: MARBLE, back: true, plain: true }); // North bulkhead wall
  k.wall(-18.0, -12.0, -18.0, -19.6, y, y + 3.4, { thick: 0.4, mat: MARBLE, back: true, plain: true }); // East entry wall
  // South entry wall z = -12.0 with open 3.2 m doorway centered at x = -20 (x in [-21.6, -18.4], u = x + 22.4 -> 0.8..4.0)
  k.wall(-22.4, -12.0, -18.0, -12.0, y, y + 3.4, {
    thick: 0.4,
    mat: MARBLE,
    back: true,
    plain: true,
    openings: [{ u0: 0.8, u1: 4.0, v0: y, v1: y + 2.8, frame: true }],
  });
  // Hood walls guarding the stairwell aperture x in [-26.4, -22.2], z in [-12.0, -8.3]
  k.wall(-22.2, -8.3, -22.2, -12.0, y, y + 3.4, { thick: 0.4, mat: MARBLE, back: true, plain: true });
  k.wall(-26.4, -8.3, -22.2, -8.3, y, y + 3.4, { thick: 0.4, mat: MARBLE, back: true, plain: true });
  // Headhouse roof cap (y = 17.4..17.85)
  k.mass(GRANITE, -26.6, y + 3.4, -19.8, -17.8, y + 3.85, -11.8, 3);
  k.mass(GRANITE, -26.6, y + 3.4, -11.8, -22.0, y + 3.85, -8.1, 3);

  // Continuous walkable stairwell run: (-24.3, 14.0, -15.5) -> (-24.3, 5.5, -3.5)
  // Run = 12 m, rise = 8.5 m -> ny = 0.816 (> 0.68), stepY = 0.708 (< 1.08), width = 3.4 m!
  k.stairs(-24.3, -15.5, LV.roof, -24.3, -3.5, LV.mezz, 3.4, 'tile', true);
}

/**
 * Offset 4-Lane Coastal Elevated Expressway Static Deck (`HIGHWAY_ORIGIN = [128, 12, 0]`):
 * Real asphalt bridge physics + concrete safety walls + lane markings + warm daylight lighting.
 */
function coastalExpressway(k: Kit): void {
  const [hx, hy, hz] = HIGHWAY_ORIGIN; // [128, 12, 0]
  const x0 = hx - HIGHWAY_HALF_WIDTH - 1; // 114
  const x1 = hx + HIGHWAY_HALF_WIDTH + 1; // 142
  const z0 = hz - HIGHWAY_HALF_LEN - 2; // -60
  const z1 = hz + HIGHWAY_HALF_LEN + 2; // +60

  // 4-lane asphalt bridge deck (x in [114, 142], z in [-60, 60], y = 12)
  k.floor('asphalt', x0, z0, x1, z1, hy, 0.9, 6);

  // Concrete outer safety walls (x = 114 and x = 142, height 1.1 m)
  k.block(MARBLE, x0 - 0.5, hy, z0, x0 + 0.3, hy + 1.1, z1, 0.06);
  k.block(MARBLE, x1 - 0.3, hy, z0, x1 + 0.5, hy + 1.1, z1, 0.06);

  // Crisp lane markings for the 4 lanes (HIGHWAY_LANES = [120.5, 125.5, 130.5, 135.5])
  const g = k.geo;
  g.use('paintYellow');
  g.box(HIGHWAY_LANES[0]! - 2.6, hy + 0.03, hz, 0.14, 0.01, HIGHWAY_HALF_LEN + 1, FACE.py);
  g.box(HIGHWAY_LANES[3]! + 2.6, hy + 0.03, hz, 0.14, 0.01, HIGHWAY_HALF_LEN + 1, FACE.py);
  g.use('paintWhite');
  for (const divX of [123.0, 128.0, 133.0]) {
    for (let z = z0 + 4; z <= z1 - 4; z += 7) {
      g.box(divX, hy + 0.03, z, 0.1, 0.01, 2.0, FACE.py);
    }
  }

  // Structural bridge piers & overhead highway light standards (visual framing)
  for (const pz of [-45, -15, 15, 45]) {
    k.deco(GRANITE, x0 + 2.0, -4, pz - 1.2, x0 + 4.4, hy - 0.9, pz + 1.2, 0.08);
    k.deco(GRANITE, x1 - 4.4, -4, pz - 1.2, x1 - 2.0, hy - 0.9, pz + 1.2, 0.08);
    k.deco(GRANITE, x0 + 1.5, hy - 2.2, pz - 1.4, x1 - 1.5, hy - 0.9, pz + 1.4, 0.06);
  }
  for (const lz of [-50, -30, -10, 10, 30, 50]) {
    k.deco(BRONZE, x0 - 0.35, hy + 1.1, lz - 0.12, x0 - 0.1, hy + 8.4, lz + 0.12, 0.02);
    k.deco(BRONZE, x0 - 0.2, hy + 8.15, lz - 0.12, x0 + 2.4, hy + 8.4, lz + 0.12, 0.02);
    k.deco('emissiveWhite', x0 + 1.6, hy + 8.05, lz - 0.2, x0 + 2.4, hy + 8.18, lz + 0.2, 0.01);

    k.deco(BRONZE, x1 + 0.1, hy + 1.1, lz - 0.12, x1 + 0.35, hy + 8.4, lz + 0.12, 0.02);
    k.deco(BRONZE, x1 - 2.4, hy + 8.15, lz - 0.12, x1 + 0.2, hy + 8.4, lz + 0.12, 0.02);
    k.deco('emissiveWhite', x1 - 2.4, hy + 8.05, lz - 0.2, x1 - 1.6, hy + 8.18, lz + 0.2, 0.01);
  }
}

/** Distant sunlit coastal financial-district skyline backdrop (visual only, zero colliders). */
function coastalSkyline(k: Kit): void {
  const g = k.geo;
  const towers: readonly [number, number, number, number, number, 'concrete' | 'glass' | 'concreteDark'][] = [
    // West financial district avenue
    [-86, 18, 12, 42, 14, 'concrete'],
    [-90, -16, 14, 54, 16, 'glass'],
    [-84, -48, 12, 36, 12, 'concreteDark'],
    [-88, 52, 13, 46, 14, 'glass'],
    // North downtown high-rises behind the reserve
    [-46, -86, 14, 58, 14, 'glass'],
    [-12, -92, 18, 66, 16, 'concrete'],
    [24, -88, 15, 50, 14, 'glass'],
    [54, -84, 12, 40, 14, 'concreteDark'],
    // South harborfront financial blocks across the avenue
    [-52, 86, 14, 34, 12, 'concrete'],
    [-16, 92, 16, 28, 12, 'glass'],
    [22, 90, 15, 36, 12, 'concrete'],
    [54, 84, 13, 44, 14, 'glass'],
    // East mid-rise towers tucked safely between plaza (x = 64) and highway (x = 114)
    [82, -46, 10, 38, 14, 'concrete'],
    [84, 42, 10, 34, 14, 'glass'],
  ];

  for (const [cx, cz, hx, h, hz, mat] of towers) {
    g.use(mat).tint(mat === 'glass' ? 0.72 : 0.88, mat === 'glass' ? 0.84 : 0.87, mat === 'glass' ? 0.94 : 0.84);
    g.box(cx, h / 2 - 2, cz, hx, h / 2 + 2, hz, FACE.noBottom);
    // Stepped Art Deco / financial crown
    g.use(MARBLE).tint(0.92);
    g.box(cx, h + 1.8, cz, hx * 0.68, 1.8, hz * 0.68, FACE.noBottom);
  }

  // Distant coastal bay sheen beyond the expressway & southern horizon
  g.use('glass').tint(0.24, 0.52, 0.74);
  g.box(165, -2.5, 0, 55, 0.2, 160, FACE.py);
  g.box(0, -2.5, 132, 160, 0.2, 34, FACE.py);
  g.tint(1);
}

/** Bright coastal morning sunlight baked lights across plaza, rooftop & offset expressway (18 lights). */
function exteriorDaylight(k: Kit): void {
  const MORNING_SUN = 0xfff3d8;
  const SKY_FILL = 0xdceeff;

  // Front plaza, portico & coastal avenue (6 lights)
  k.light(-16, 12, 36, MORNING_SUN, 85, 34);
  k.light(0, 12, 34, MORNING_SUN, 95, 36);
  k.light(16, 12, 36, MORNING_SUN, 85, 34);
  k.light(0, 8.5, 26.5, MORNING_SUN, 70, 22);
  k.light(-28, 12, 48, SKY_FILL, 72, 34);
  k.light(28, 12, 48, SKY_FILL, 72, 34);

  // Rooftop bright morning sunlight (4 lights)
  k.light(0, 22, 16, MORNING_SUN, 95, 38);
  k.light(0, 22, -8, MORNING_SUN, 90, 36);
  k.light(-16, 20, 4, SKY_FILL, 70, 30);
  k.light(16, 20, 4, SKY_FILL, 70, 30);

  // Flanking avenue daylight fills (2 lights)
  k.light(-38, 14, 2, SKY_FILL, 68, 34);
  k.light(38, 14, 2, SKY_FILL, 68, 34);

  // Offset Coastal Elevated Expressway warm morning daylight (6 lights)
  const [hx, hy] = HIGHWAY_ORIGIN;
  for (const lz of [-48, -28, -8, 12, 32, 50]) {
    k.light(hx, hy + 8.5, lz, MORNING_SUN, 92, 38);
  }
}

export function authorBankExterior(k: Kit, spec: MapSpec): void {
  groundAndPlaza(k);
  frontPortico(k);
  bankExteriorShell(k);
  rooftopAndSkylight(k, spec);
  coastalExpressway(k);
  coastalSkyline(k);
  exteriorDaylight(k);
}
