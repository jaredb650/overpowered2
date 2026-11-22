/**
 * Chancery Mansion & Sub-Level Continuity Bunker:
 * - Ground Floor (Grand Foyer, West Library, East Archive, Security Hub Room, Central Grand Staircase)
 * - Upper Floor (High Magistrate Vane's Upper Bureau, cantilevered breakable South Panoramic Glass Wall,
 *   East Private Stone Loggia Balcony, breakable Roof Skylight, Red Goggles Sighting Board, Executive Lift)
 * - Servant & Maintenance Wing (Kitchen/Cellar, Dumbwaiter Parkour Shaft, Vault Access Stairs)
 * - Sub-Level (Utility Tunnel, Vault Antechamber, Estate Guard Armory, Tier-3 Destructible Bunker Blast Door,
 *   and Continuity Bunker)
 */
import type { Kit } from '../../kit/kit';
import { FACE } from '../../kit/geo';
import type { MapSpec } from '../spec';
import { CEIL, LV } from './plan';

const LIMESTONE = 'concrete' as const;
const DARK_STONE = 'concreteDark' as const;
const IRON = 'steelDark' as const;

/** Chancery Mansion Ground Floor (x in [-24, 24], z in [-60, -24], y = 0..5.8) + Grand Staircase. */
function mansionGroundFloor(k: Kit, spec: MapSpec): void {
  const x0 = -24, x1 = 24, z0 = -60, z1 = -24, h = LV.upper;

  // Marble / limestone interior ground floor inlay
  k.geo.use('tile').tint(0.84, 0.84, 0.82);
  k.geo.slab(0, 0.025, -42, 23.4, 0.025, 17.5, 5, FACE.py);
  k.geo.tint(1);

  // South exterior facade (z = -24): Grand Foyer double doors (x in [-3, 3]) + Library & Archive windows
  k.wall(x0, z1, x1, z1, 0, h, {
    thick: 0.75,
    mat: LIMESTONE,
    back: true,
    bay: 6,
    openings: [
      { u0: 3, u1: 9, v0: 1.0, v1: 4.4 },
      { u0: 21, u1: 27, v0: 0, v1: 4.2, frame: true },
      { u0: 39, u1: 45, v0: 1.0, v1: 4.4 },
    ],
  });
  // Breakable ground-floor front windows (Library west, Archive east)
  spec.breakable('pane', -18, 2.7, z1, 0, 5.8, 3.3);
  spec.breakable('pane', 18, 2.7, z1, 0, 5.8, 3.3);

  // North exterior facade (z = -60, facing the North Cliff Bluff)
  k.wall(x1, z0, x0, z0, 0, h, { thick: 0.75, mat: LIMESTONE, back: true, bay: 8 });

  // West exterior wall (x = -24): doorway into Servant Wing at z in [-36, -32] (u = z + 60 -> 24..28)
  k.wall(x0, z0, x0, z1, 0, h, {
    thick: 0.7,
    mat: LIMESTONE,
    back: true,
    bay: 6,
    openings: [{ u0: 24, u1: 28, v0: 0, v1: 3.4 }],
  });

  // East exterior wall (x = 24): side garden doorway at z in [-44, -40] (u = -24 - z -> 16..20)
  k.wall(x1, z1, x1, z0, 0, h, {
    thick: 0.7,
    mat: LIMESTONE,
    back: true,
    bay: 6,
    openings: [{ u0: 16, u1: 20, v0: 0, v1: 3.4 }],
  });

  // Interior wing dividers (x = -12 and x = +12) with wide archways between Foyer, Library, and Archive
  const divH = 5.65;
  // West Library divider x = -12, z in [-59.5, -24.5] (u = z + 59.5 -> z=-50..-46 is 9.5..13.5, z=-33..-29 is 26.5..30.5)
  k.wall(-12, -59.5, -12, -24.5, 0, divH, {
    thick: 0.45,
    mat: 'plaster',
    back: true,
    plain: true,
    openings: [
      { u0: 9.5, u1: 13.5, v0: 0, v1: 3.8 },
      { u0: 26.5, u1: 30.5, v0: 0, v1: 3.8 },
    ],
  });
  // East Archive divider x = +12, z in [-24.5, -59.5] (u = -24.5 - z -> z=-29..-33 is 4.5..8.5, z=-46..-50 is 21.5..25.5)
  k.wall(12, -24.5, 12, -59.5, 0, divH, {
    thick: 0.45,
    mat: 'plaster',
    back: true,
    plain: true,
    openings: [
      { u0: 4.5, u1: 8.5, v0: 0, v1: 3.8 },
      { u0: 21.5, u1: 25.5, v0: 0, v1: 3.8 },
    ],
  });

  // Grand Foyer columns & limestone reception desk
  for (const [cx, cz] of [[-8, -28], [8, -28], [-8, -36], [8, -36]] as const) {
    k.column(cx, cz, 0, divH, 0.8, LIMESTONE);
  }
  k.block(DARK_STONE, -3.2, 0, -31.8, 3.2, 1.05, -30.5, 0.04);
  spec.breakable('monitor', -1.2, 1.06, -31.1, 0);
  spec.breakable('monitor', 1.2, 1.06, -31.1, 0);
  spec.breakable('chair', 0, 0, -32.6, 0);

  // West Library bookshelves & reading tables (clear center north-south aisle x in [-19.5, -15.5])
  for (const z of [-29, -41, -53]) {
    k.block('panel', -23.4, 0, z - 2.2, -22.2, 3.2, z + 2.2, 0.04);
  }
  k.block('panel', -19.5, 0, -49.2, -16.5, 0.82, -46.8, 0.03);
  spec.breakable('chair', -18, 0, -45.8, Math.PI);
  spec.breakable('plant', -13.2, 0, -25.6, 0);

  // East Archive filing cabinets (north half z in [-55, -41])
  for (const z of [-44, -50, -55]) {
    k.block('steelDark', 15.5, 0, z - 0.6, 20.5, 1.7, z + 0.6, 0.04);
  }
  spec.breakable('copier', 13.4, 0, -54, Math.PI / 2);

  // Security Hub Room (x in [14.8, 23.5], z in [-38, -28], console alarm.hub at (18, 0, -34))
  // West partition x = 14.8 (leaves a clean 2.5 m corridor from x = 12 divider) with doorway at z in [-35.5, -32.5]
  k.wall(14.8, -38, 14.8, -28, 0, divH, {
    thick: 0.24,
    mat: IRON,
    back: true,
    plain: true,
    openings: [
      { u0: 2.5, u1: 5.5, v0: 0, v1: 3.0 },
      { u0: 6.2, u1: 9.2, v0: 1.0, v1: 3.0 },
    ],
  });
  spec.breakable('pane', 14.8, 2.0, -30.3, Math.PI / 2, 2.9, 1.9);
  // North partition z = -38 with doorway (x in [16.5, 19.5] -> u = 23.5 - x = 4.0..7.0) and observation glass
  k.wall(23.5, -38, 14.8, -38, 0, divH, {
    thick: 0.24,
    mat: IRON,
    back: true,
    plain: true,
    openings: [
      { u0: 0.8, u1: 3.4, v0: 1.0, v1: 3.0 },
      { u0: 4.0, u1: 7.0, v0: 0, v1: 3.0 },
    ],
  });
  spec.breakable('pane', 21.4, 2.0, -38, 0, 2.5, 1.9);
  // South partition z = -28 (solid)
  k.wall(14.8, -28, 23.5, -28, 0, divH, { thick: 0.24, mat: IRON, back: true, plain: true });
  // Security monitor wall bank behind console (east side x = 21.8, keeping (18, 0, -34) clear!)
  k.block(IRON, 21.4, 0, -36.5, 22.8, 0.88, -31.5, 0.04);
  k.deco('screen', 22.6, 1.15, -36.2, 22.8, 2.6, -31.8, 0.02);
  spec.breakable('monitor', 21.8, 0.9, -35.2, -Math.PI / 2);
  spec.breakable('monitor', 21.8, 0.9, -33.2, -Math.PI / 2);

  // Central Grand Staircase (x in [-3, 3], z = -40 -> -54, y = 0 -> 6.0)
  // Run = 14 m, rise = 6 m -> slope 0.428 (ny = 0.92). Passes cleanly under y = 6.0 floor until z = -47.6!
  k.stairs(0, -40, LV.ground, 0, -54, LV.upper, 6.0, 'tile', true);
}

/** Upper Floor (y = 6.0, ceiling y = 11.6): Vane's Upper Bureau, Panoramic Glass Wall, East Loggia, Roof Skylight. */
function upperBureauAndLoggia(k: Kit, spec: MapSpec): void {
  const y = LV.upper; // 6.0
  const ceilY = CEIL.upperBureau; // 11.6
  const x0 = -20, x1 = 20, z0 = -58, z1 = -26;

  // Upper Bureau Floor slabs at y = 6.0 (thick 0.35 -> bottom at 5.65)
  // Cutout for Grand Staircase head is ONLY z in [-54.0, -47.6], x in [-3.8, 3.8],
  // so Vane's desk at (0, 6, -46) rests on 100% solid floor while stairs below have >2.4 m headroom!
  k.floor(LIMESTONE, x0, -47.6, x1, z1, y, 0.35, 5); // South main suite (includes desk at z = -46)
  k.floor(LIMESTONE, x0, -54.0, -3.8, -47.6, y, 0.35, 4); // West stair gallery
  k.floor(LIMESTONE, 3.8, -54.0, x1, -47.6, y, 0.35, 4); // East stair gallery
  k.floor(LIMESTONE, x0, z0, x1, -54.0, y, 0.35, 5); // North upper landing

  // Seal outer ground-floor mansion ceiling perimeter around the recessed Upper Bureau
  k.floor(DARK_STONE, -24, -60, x0, -24, y, 0.35, 4); // West terrace skirt
  k.floor(DARK_STONE, x1, -60, 24, -50, y, 0.35, 4); // NE terrace skirt
  k.floor(DARK_STONE, x1, -30, 24, -24, y, 0.35, 4); // SE terrace skirt
  k.floor(DARK_STONE, x0, -26, x1, -24, y, 0.35, 4); // South cornice ledge
  k.floor(DARK_STONE, x0, -60, x1, -58, y, 0.35, 4); // North cornice ledge

  // Safety railings around the Grand Staircase cutout on Upper Floor (leaving north exit z = -54 open!)
  k.rail([-3.8, y, -54.0, -3.8, y, -47.6, 3.8, y, -47.6, 3.8, y, -54.0]);

  // Executive dark carpet runner across Vane's suite
  k.geo.use('carpet').tint(0.24, 0.25, 0.28);
  k.geo.slab(0, y + 0.02, -37, 15.5, 0.02, 9.5, 4, FACE.py);
  k.geo.tint(1);

  // North Wall (z = -58, solid)
  k.wall(x1, z0, x0, z0, y, ceilY, { thick: 0.65, mat: LIMESTONE, back: true, bay: 8 });

  // West Wall (x = -20): solid EXCEPT Dumbwaiter Service Hatch doorway at z in [-45.5, -42.5] (u = z + 58 -> 12.5..15.5)
  k.wall(x0, z0, x0, z1, y, ceilY, {
    thick: 0.65,
    mat: LIMESTONE,
    back: true,
    bay: 8,
    openings: [{ u0: 12.5, u1: 15.5, v0: y, v1: y + 2.8 }],
  });

  // South Panoramic Laminated Glass Window Wall (z = -26):
  // West solid corner pier x in [-20, -14]
  k.wall(x0, z1, -14, z1, y, ceilY, { thick: 0.65, mat: LIMESTONE, back: true, plain: true });
  // Open cantilevered glass facade x in [-14, 20]: low sill (6.0..6.8) + upper fascia (10.8..12.0), ZERO solid wall between!
  k.block(LIMESTONE, -14.0, y, z1 - 0.3, x1 + 0.3, y + 0.8, z1 + 0.3, 0.04);
  k.block(LIMESTONE, -14.0, 10.8, z1 - 0.35, x1 + 0.35, ceilY + 0.4, z1 + 0.35, 0.04);
  // Breakable laminated glass panels across South Panoramic Window (x in [-14, 14] + SE corner [14, 19.8])
  for (let i = 0; i < 7; i++) {
    const cx = -12 + i * 4.0;
    spec.breakable('pane', cx, 8.8, z1, 0, 3.92, 3.92);
  }
  spec.breakable('pane', 16.9, 8.8, z1, 0, 5.7, 3.92);

  // East Wall (x = 20):
  // North solid corner pier z in [-58, -50]
  k.wall(x1, -50, x1, z0, y, ceilY, { thick: 0.65, mat: LIMESTONE, back: true, plain: true });
  // Open glass/loggia span z in [-50, -26]:
  // - South-east wraparound glass return z in [-36, -26]: sill (6.0..6.8) + fascia (10.8..12.0), ZERO solid collider in window!
  k.block(LIMESTONE, x1 - 0.3, y, -36.0, x1 + 0.3, y + 0.8, z1, 0.04);
  k.block(LIMESTONE, x1 - 0.35, 10.8, -50.0, x1 + 0.35, ceilY + 0.4, z1, 0.04);
  // - North loggia glass return z in [-50, -44]: sill (6.0..6.8)
  k.block(LIMESTONE, x1 - 0.3, y, -50.0, x1 + 0.3, y + 0.8, -44.0, 0.04);
  // - Open archway to East Private Loggia at z in [-44, -36] (centered at x = 20, z = -40, wide open for player, AI, and sightlines!)
  spec.breakable('pane', x1, 8.8, -31.0, Math.PI / 2, 9.8, 3.92);
  spec.breakable('pane', x1, 8.8, -47.0, Math.PI / 2, 5.8, 3.92);

  // East Private Stone Loggia Balcony (x in [20, 30], z in [-50, -30], y = 6.0)
  k.floor(LIMESTONE, 20, -50, 30, -30, y, 0.35, 4);
  // Support columns from ground to balcony deck
  for (const cz of [-31, -40, -49]) {
    k.column(29.3, cz, LV.ground, y - 0.35, 0.75, LIMESTONE);
  }
  // Waist-high stone balustrade (0.9 m tall -> top at y = 6.9, well below Bell Tower sightline at y = 8.975!)
  k.block(LIMESTONE, 20.0, y, -50.0, 30.0, y + 0.9, -49.55, 0.04);
  k.block(LIMESTONE, 20.0, y, -30.45, 30.0, y + 0.9, -30.0, 0.04);
  k.block(LIMESTONE, 29.55, y, -49.55, 30.0, y + 0.9, -30.45, 0.04);

  // Upper Bureau Inset Columns (positioned well clear of Bell Tower sniper sightlines to window & desk!)
  for (const [cx, cz] of [[-13, -34], [13, -34], [-13, -50], [13, -50]] as const) {
    k.column(cx, cz, y, ceilY, 0.78, LIMESTONE);
  }

  // High Magistrate Vane's Executive Desk at (0, 6, -46) (low 0.82 m front, back facing north)
  k.block(DARK_STONE, -2.2, y, -46.4, 2.2, y + 0.82, -45.6, 0.04);
  k.deco('steel', -2.1, y + 0.82, -46.35, 2.1, y + 0.86, -45.65, 0.01);
  spec.breakable('monitor', -0.9, y + 0.86, -46.0, 0);
  spec.breakable('chair', 0, y, -47.0, 0);

  // Red Goggles Sighting Board on West Wall (-19.5, 6, -42)
  k.deco(IRON, -19.65, y + 0.9, -44.8, -19.45, y + 3.4, -39.2, 0.03);
  k.deco('concreteDark', -19.46, y + 1.05, -44.6, -19.4, y + 3.25, -39.4, 0.01);
  // Glowing red sighting pins & tactical reticle lines
  for (const [py, pz] of [[2.6, -43.4], [2.1, -42.0], [2.7, -40.6], [1.6, -41.2]] as const) {
    k.deco('emissiveRed', -19.4, y + py - 0.08, pz - 0.08, -19.34, y + py + 0.08, pz + 0.08, 0.01);
  }
  k.deco('emissiveRed', -19.39, y + 2.15, -44.2, -19.36, y + 2.2, -39.8, 0.005);

  // Executive Lift Alcove at (-16, 6, -54) connecting down to Continuity Bunker (-16, -8, -54)
  k.block(IRON, -17.8, y, -57.6, -14.2, y + 3.4, -55.4, 0.04);
  k.deco('steel', -17.2, y + 0.05, -55.42, -14.8, y + 2.9, -55.34, 0.02);
  k.deco('emissiveOrange', -16.25, y + 3.05, -55.38, -15.75, y + 3.22, -55.32, 0.01);

  // Upper Bureau Roof (y = 11.6..12.0) partitioned around the open Roof Skylight (x in [-6, 6], z in [-46, -38])
  k.floor(DARK_STONE, x0 - 0.4, -38, x1 + 0.4, z1 + 0.4, ceilY + 0.4, 0.4, 5); // South roof
  k.floor(DARK_STONE, x0 - 0.4, z0 - 0.4, x1 + 0.4, -46, ceilY + 0.4, 0.4, 5); // North roof
  k.floor(DARK_STONE, x0 - 0.4, -46, -6, -38, ceilY + 0.4, 0.4, 4); // West roof flank
  k.floor(DARK_STONE, 6, -46, x1 + 0.4, -38, ceilY + 0.4, 0.4, 4); // East roof flank
  // Skylight perimeter curb & thin non-colliding steel mullions
  k.deco(IRON, -6.15, ceilY + 0.35, -46.15, 6.15, ceilY + 0.52, -45.95, 0.02);
  k.deco(IRON, -6.15, ceilY + 0.35, -38.05, 6.15, ceilY + 0.52, -37.85, 0.02);
  for (const mx of [-6, -2, 2, 6]) {
    k.deco(IRON, mx - 0.06, ceilY + 0.32, -46, mx + 0.06, ceilY + 0.45, -38, 0.01);
  }
  k.deco(IRON, -6, ceilY + 0.32, -42.06, 6, ceilY + 0.45, -41.94, 0.01);
  // 6 flat breakable glass skylight panels (Dishonored-style rooftop drop straight into Vane's office!)
  for (const cx of [-4, 0, 4]) {
    for (const cz of [-44, -40]) {
      spec.breakable('pane', cx, ceilY + 0.36, cz, 0, 3.88, 3.88, true);
    }
  }
}

/** Servant & Maintenance Wing (x in [-52, -24], z in [-58, -26]), Dumbwaiter Shaft, and Vault Access Stairs. */
function servantWing(k: Kit, spec: MapSpec): void {
  const x0 = -52, x1 = -24, z0 = -58, z1 = -26, h = CEIL.servant;

  // Interior floor tile inlay (south half clear of Vault Stairwell cutout x in [-41, -35], z in [-56, -43])
  k.geo.use('tile').tint(0.68, 0.67, 0.65);
  k.geo.slab(-38, 0.02, -34, 13.5, 0.02, 7.5, 4, FACE.py);
  k.geo.tint(1);

  // Exterior walls
  // South wall z = -26 with exterior side entry at x in [-48, -44] (u = x + 52 -> 4..8)
  k.wall(x0, z1, x1, z1, 0, h, {
    thick: 0.6,
    mat: LIMESTONE,
    back: true,
    bay: 7,
    openings: [{ u0: 4, u1: 8, v0: 0, v1: 3.2 }],
  });
  // West wall x = -52 (solid)
  k.wall(x0, z0, x0, z1, 0, h, { thick: 0.6, mat: LIMESTONE, back: true, bay: 8 });
  // North wall z = -58 (solid)
  k.wall(x1, z0, x0, z0, 0, h, { thick: 0.6, mat: LIMESTONE, back: true, bay: 7 });

  // Roof slab (y = 5.4..5.9) partitioned around Dumbwaiter Shaft opening x in [-28, -24], z in [-46, -42]
  k.mass(DARK_STONE, x0 - 0.3, h, z0 - 0.3, -28, h + 0.5, z1 + 0.3, 6);
  k.mass(DARK_STONE, -28, h, z0 - 0.3, x1, h + 0.5, -46, 4);
  k.mass(DARK_STONE, -28, h, -42, x1, h + 0.5, z1 + 0.3, 4);

  // Kitchen / cellar counters & breakable props
  k.block('steel', -50.8, 0, -40, -49.2, 0.92, -31, 0.03);
  k.block('panel', -45, 0, -35.6, -39, 0.92, -34.2, 0.03);
  spec.breakable('cooler', -50.6, 0, -28, Math.PI / 2);
  spec.breakable('extinguisher', -24.7, 1.1, -28.5, -Math.PI / 2);
  spec.breakable('chair', -43, 0, -32.6, Math.PI);

  // Dumbwaiter / Maintenance Shaft (x in [-28, -24], z in [-46, -42], y = 0 -> 6.0)
  k.wall(-28, -46, -24.4, -46, 0, LV.upper + 3.0, { thick: 0.3, mat: IRON, back: true, plain: true });
  k.wall(-24.4, -42, -28, -42, 0, LV.upper + 3.0, { thick: 0.3, mat: IRON, back: true, plain: true });
  // West shaft wall x = -28 with entry doorway at y = 0..2.8
  k.wall(-28, -46, -28, -42, 0, LV.upper + 3.0, {
    thick: 0.3,
    mat: IRON,
    back: true,
    plain: true,
    openings: [{ u0: 0.6, u1: 3.4, v0: 0, v1: 2.8 }],
  });
  // Stepped wall-kick / climb ledges inside shaft rising to Upper Bureau service hatch at (-20, 6, -44)
  k.block(IRON, -27.6, 1.4, -45.6, -25.6, 1.65, -44.2, 0.03);
  k.block(IRON, -26.4, 3.0, -43.6, -24.6, 3.25, -42.4, 0.03);
  k.block(IRON, -27.6, 4.6, -45.6, -25.4, 4.85, -44.2, 0.03);
  // Service duct floor bridge from shaft top into Upper Bureau service hatch (x in [-24.4, -20], z in [-45.6, -42.4], y = 6.0)
  k.floor(IRON, -24.6, -45.6, -20.0, -42.4, LV.upper, 0.25, 2);

  // Vault Access Stairs (x in [-41, -35], z = -56 -> -44, y = 0 -> -8.0)
  k.stairs(-38, -56, LV.ground, -38, -44, LV.sub, 4.0, LIMESTONE, true);
  // Sub-grade stairwell enclosure walls
  k.wall(-41, -56, -41, -43, LV.sub, LV.ground, { thick: 0.4, mat: DARK_STONE, back: true, plain: true });
  k.wall(-35, -43, -35, -56, LV.sub, LV.ground, { thick: 0.4, mat: DARK_STONE, back: true, plain: true });
  k.wall(-35, -56, -41, -56, LV.sub, -2.5, { thick: 0.4, mat: DARK_STONE, back: true, plain: true });
  // Safety guardrails around stairwell hole on ground floor (north entrance z = -56 left open!)
  k.rail([-41, 0, -56, -41, 0, -43, -35, 0, -43, -35, 0, -56]);
}

/** Sub-Level (y = -8, ceiling y = -3.4): Utility Tunnel, Armory, Vault Antechamber, Tier-3 Blast Door & Continuity Bunker. */
function subLevelBunker(k: Kit, spec: MapSpec): void {
  const y = LV.sub; // -8.0
  const ceilY = CEIL.sub; // -3.4

  // 1. Utility Tunnel (x in [-54, -22], z in [-46, -20])
  k.floor(DARK_STONE, -54, -46, -22, -20, y, 0.6, 5);
  // Ceiling covers z in [-44, -20] (clear of Vault Access Stairwell shaft z in [-56, -44]!)
  k.mass(DARK_STONE, -54, ceilY, -44, -22, ceilY + 0.5, -20, 5);
  // West wall of tunnel north of Generator Sub-Basement (x = -54, z in [-46, -30])
  k.wall(-54, -46, -54, -30, y, ceilY, { thick: 0.5, mat: DARK_STONE, back: true, plain: true });
  // North tunnel walls flanking Vault Access Stairs opening (x in [-41, -35])
  k.wall(-41, -46, -54, -46, y, ceilY, { thick: 0.5, mat: DARK_STONE, back: true, plain: true });
  k.wall(-22, -46, -35, -46, y, ceilY, { thick: 0.5, mat: DARK_STONE, back: true, plain: true });
  // East wall of tunnel north of Antechamber (x = -22, z in [-46, -38])
  k.wall(-22, -38, -22, -46, y, ceilY, { thick: 0.5, mat: DARK_STONE, back: true, plain: true });
  // South tunnel wall (z = -20, x in [-40, -24])
  k.wall(-40, -20, -24, -20, y, ceilY, { thick: 0.5, mat: DARK_STONE, back: true, plain: true });
  // Industrial concrete ribs & overhead conduit along Utility Tunnel
  for (const x of [-46, -36, -28]) {
    k.ibeam(x, ceilY - 0.25, -44, x, ceilY - 0.25, -20.5, 0.4, 0.25, IRON);
  }

  // 2. Vault Antechamber (x in [-24, 16], z in [-38, -20])
  k.floor(DARK_STONE, -24, -38, 16, -20, y, 0.6, 5);
  k.mass(DARK_STONE, -24, ceilY, -38, 16, ceilY + 0.5, -20, 5);
  // East wall x = 16
  k.wall(16, -20, 16, -38, y, ceilY, { thick: 0.6, mat: DARK_STONE, back: true, plain: true });
  // South wall z = -20 with Estate Guard Armory doorway at x in [-16, -12] (u = x + 24 -> 8..12)
  k.wall(-24, -20, 16, -20, y, ceilY, {
    thick: 0.6,
    mat: DARK_STONE,
    back: true,
    plain: true,
    openings: [{ u0: 8, u1: 12, v0: y, v1: y + 3.4 }],
  });
  // Concrete blast columns in Antechamber
  k.column(-10, -28, y, ceilY, 0.9, DARK_STONE);
  k.column(8, -28, y, ceilY, 0.9, DARK_STONE);

  // 3. Estate Guard Armory (x in [-22, -6], z in [-20, -8])
  k.floor(DARK_STONE, -22, -20, -6, -8, y, 0.6, 4);
  k.mass(DARK_STONE, -22, ceilY, -20, -6, ceilY + 0.5, -8, 4);
  k.wall(-22, -20, -22, -8, y, ceilY, { thick: 0.5, mat: DARK_STONE, back: true, plain: true });
  k.wall(-6, -8, -6, -20, y, ceilY, { thick: 0.5, mat: DARK_STONE, back: true, plain: true });
  k.wall(-22, -8, -6, -8, y, ceilY, { thick: 0.5, mat: DARK_STONE, back: true, plain: true });
  // Weapon lockers on east & west walls
  k.block(IRON, -21.4, y, -18.5, -20.5, y + 2.4, -10.5, 0.04);
  k.block(IRON, -7.5, y, -18.5, -6.6, y + 2.4, -10.5, 0.04);
  // Armory Crate Bench at (-14, -8, -16) where Breach Charges / Satchels sit
  k.block('steel', -16.0, y, -17.0, -12.0, y + 0.85, -15.2, 0.04);
  k.deco('hazard', -16.0, y + 0.85, -15.25, -12.0, y + 0.92, -15.18, 0.01);

  // 4. Reinforced Bunker Bulkhead Wall (z = -38, x in [-22, 18], y in [-8, -3.4])
  // Clean doorway opening at x in [-2.4, 2.4], y in [-8, -4.4] (u = x + 22 -> 19.6..24.4)
  k.wall(-22, -38, 18, -38, y, ceilY, {
    thick: 1.0,
    mat: DARK_STONE,
    back: true,
    bay: 6,
    openings: [{ u0: 19.6, u1: 24.4, v0: y, v1: -4.4, frame: true }],
  });
  // Warning chevron strip above blast door frame
  k.deco('hazard', -2.8, -4.35, -37.38, 2.8, -3.95, -37.25, 0.01);

  // Tier-3 Destructible Bunker Blast Door StructuralClusterSpec (attached after nav sampling!)
  // Impervious to small arms (tier: 3); shattered cleanly by 'breach_charge' or 'hydraulic_overload'.
  spec.cluster({
    id: 'bunker_door',
    tag: 'bunker.door',
    kind: 'bunkerDoor',
    label: 'CONTINUITY VAULT BLAST DOOR',
    value: 250000,
    collapseThreshold: 0.5,
    nodes: [
      {
        id: 'bunker_door_ll',
        pos: [-1.2, -7.1, -38],
        half: [1.16, 0.88, 0.34],
        mat: 'steel',
        color: 0x738294,
        hp: 360,
        tier: 3,
        anchored: true,
        kind: 'wall',
        supports: ['bunker_door_ul', 'bunker_door_lr'],
        label: 'VAULT BLAST LEAF SW',
      },
      {
        id: 'bunker_door_lr',
        pos: [1.2, -7.1, -38],
        half: [1.16, 0.88, 0.34],
        mat: 'steel',
        color: 0x738294,
        hp: 360,
        tier: 3,
        anchored: true,
        kind: 'wall',
        supports: ['bunker_door_ur', 'bunker_door_ll'],
        label: 'VAULT BLAST LEAF SE',
      },
      {
        id: 'bunker_door_ul',
        pos: [-1.2, -5.3, -38],
        half: [1.16, 0.88, 0.34],
        mat: 'steel',
        color: 0x8695a8,
        hp: 360,
        tier: 3,
        anchored: false,
        kind: 'wall',
        supports: ['bunker_door_ll', 'bunker_door_ur'],
        label: 'VAULT BLAST LEAF NW',
      },
      {
        id: 'bunker_door_ur',
        pos: [1.2, -5.3, -38],
        half: [1.16, 0.88, 0.34],
        mat: 'steel',
        color: 0x8695a8,
        hp: 360,
        tier: 3,
        anchored: false,
        kind: 'wall',
        supports: ['bunker_door_lr', 'bunker_door_ul'],
        label: 'VAULT BLAST LEAF NE',
      },
    ],
  });

  // 5. Continuity Bunker (x in [-18, 18], z in [-62, -38], y = -8, ceiling y = -3.4)
  k.floor(DARK_STONE, -18, -62, 18, -38, y, 0.6, 5);
  k.mass(DARK_STONE, -18, ceilY, -62, 18, ceilY + 0.6, -38, 5);
  k.wall(-18, -62, -18, -38, y, ceilY, { thick: 0.9, mat: DARK_STONE, back: true, bay: 6 });
  k.wall(18, -38, 18, -62, y, ceilY, { thick: 0.9, mat: DARK_STONE, back: true, bay: 6 });
  k.wall(18, -62, -18, -62, y, ceilY, { thick: 0.9, mat: DARK_STONE, back: true, bay: 6 });

  // Heavy concrete blast ribs across Continuity Bunker ceiling
  for (const z of [-44, -50, -56]) {
    k.ibeam(-17.4, ceilY - 0.3, z, 17.4, ceilY - 0.3, z, 0.55, 0.32, IRON);
  }

  // Bunker Panic Desk at (0, -8, -52)
  k.block(IRON, -2.4, y, -52.6, 2.4, y + 0.92, -51.4, 0.04);
  spec.breakable('monitor', -1.0, y + 0.94, -52.0, 0);
  spec.breakable('monitor', 1.0, y + 0.94, -52.0, 0);
  spec.breakable('chair', 0, y, -53.3, 0);

  // Continuity server racks along east & north walls
  for (const x of [13.5, 10.5]) {
    for (const z of [-44, -50, -56]) {
      spec.breakable('rack', x, y, z, -Math.PI / 2);
    }
  }
  for (const x of [-8, -4, 4, 8]) {
    spec.breakable('rack', x, y, -60.6, 0);
  }

  // Executive Lift Shaft Alcove at (-16, -8, -54) (matching Upper Bureau lift at (-16, 6, -54))
  k.block(IRON, -17.4, y, -56.2, -15.6, ceilY, -51.8, 0.04);
  k.deco('steel', -15.62, y + 0.05, -55.3, -15.54, y + 2.9, -52.7, 0.02);
  k.deco('emissiveRed', -15.58, y + 3.05, -54.25, -15.52, y + 3.22, -53.75, 0.01);
}

/**
 * Subtle moody baked interior fills & red bunker emergency beacons (10 lights).
 * Combined with grounds.ts (14 lights), total baked static lights = 24 (< 60 hard budget!).
 */
function mansionMoodLights(k: Kit): void {
  const MOON_TINT = 0x435d80;
  const DIM_WARM = 0x7c5d3a;
  const BUNKER_RED = 0xa81f1f;

  // Faint moonlight bleed through Mansion entrance & Upper Bureau panoramic glass
  k.light(0, 4.2, -26, MOON_TINT, 10, 16);
  k.light(0, 9.6, -28, MOON_TINT, 14, 22);
  k.light(24, 9.2, -40, MOON_TINT, 12, 18);

  // Subtle ambient fill in Library, Security Hub & Servant Wing (still dark when shootable lights go out!)
  k.light(-18, 4.2, -42, DIM_WARM, 7, 14);
  k.light(18, 3.6, -34, 0x306a8a, 9, 12);
  k.light(-38, 4.0, -40, DIM_WARM, 7, 14);

  // Dim red emergency beacons across Sub-Level & Continuity Bunker
  k.light(-36, -4.4, -34, BUNKER_RED, 9, 16);
  k.light(0, -4.6, -35.6, 0xd84638, 28, 16);
  k.light(-10, -4.4, -52, BUNKER_RED, 11, 18);
  k.light(10, -4.4, -52, BUNKER_RED, 11, 18);
}

export function authorMansion(k: Kit, spec: MapSpec): void {
  mansionGroundFloor(k, spec);
  upperBureauAndLoggia(k, spec);
  servantWing(k, spec);
  subLevelBunker(k, spec);
  mansionMoodLights(k);
}
