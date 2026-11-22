/**
 * Brine Central Reserve interior architecture:
 * - Grand Marble Banking Hall (polished marble inlay, 6 fluted atrium columns, mahogany teller
 *   desks with breakable glass teller panes, central check-writing island, twin grand staircases)
 * - Wrap-around Mezzanine Galleries (west/east galleries, south/north balconies, marble/brass
 *   railings, Mezzanine Security Office around SABOT_RACK_POS)
 * - Vault Descent Ramp & Vault Antechamber (4 heavy cover pillars, East Guard Cage around
 *   MGL_RACK_POS, West & East SWAT breach doorways + side security corridors)
 * - Planetary Bullion Vault Bulkhead (unobstructed 4.6 m x 4.4 m doorway for VaultDrill) &
 *   Bullion Vault Interior (steel walls, safety-deposit box trim panels, golden overhead lights)
 */
import type { Kit } from '../../kit/kit';
import { FACE } from '../../kit/geo';
import type { MapSpec } from '../spec';
import { CEIL, LV, SKYLIGHT_BOUNDS, VAULT_DOOR_SIZE } from './plan';

const MARBLE = 'concrete' as const;
const GRANITE = 'concreteDark' as const;
const MAHOGANY = 'panel' as const;
const BRONZE = 'steelDark' as const;
const VAULT_STEEL = 'steelDark' as const;
const STEEL = 'steel' as const;

/** Tall neoclassical fluted marble atrium column from floor to coffered ceiling. */
function atriumColumn(k: Kit, x: number, z: number, y0: number, y1: number, r = 0.56): void {
  const g = k.geo;
  g.use(GRANITE).tint(0.84);
  g.bevel(x, y0 + 0.35, z, r + 0.22, 0.35, r + 0.22, 0.05);
  g.use(MARBLE).tint(0.95, 0.94, 0.91);
  g.cyl(x, y0 + 0.7, z, x, y1 - 0.55, z, r, r * 0.92, 12, false, false);
  g.use(MARBLE).tint(0.92);
  g.bevel(x, y1 - 0.38, z, r + 0.14, 0.17, r + 0.14, 0.04);
  g.bevel(x, y1 - 0.12, z, r + 0.28, 0.12, r + 0.28, 0.04);
  g.tint(1);
  k.collide(x, (y0 + y1) / 2, z, r, (y1 - y0) / 2, r, 'concrete');
}

/** Grand Marble Banking Hall (x in [-26.8, 26.8], z in [-16, 23.4], y = 0). */
function grandBankingHall(k: Kit, spec: MapSpec): void {
  const g = k.geo;

  // Polished marble-tile hall floor inlay & dark stone atrium compass border (non-colliding at y = 0.02)
  g.use('tile').tint(0.94, 0.92, 0.88);
  g.slab(0, 0.02, 3.8, 26.2, 0.015, 19.2, 5, FACE.py);
  // Decorative dark marble atrium rug inlay directly beneath the skylight
  g.use(GRANITE).tint(0.74, 0.72, 0.7);
  g.box(0, 0.036, 2.0, 5.2, 0.01, 5.2, FACE.py);
  g.use('tile').tint(0.96, 0.92, 0.82);
  g.box(0, 0.044, 2.0, 4.4, 0.01, 4.4, FACE.py);
  g.tint(1);

  // 6 Fluted Marble Atrium Columns (x = ±10, z = -8, 4, 14.2 -> keeps GROUND_SPAWNS [±10, 0, 16] clear!)
  for (const cx of [-10, 10]) {
    for (const cz of [-8, 4, 14.2]) {
      atriumColumn(k, cx, cz, LV.hall, CEIL.hall, 0.56);
    }
  }

  // Central Check-Writing Island at [0, 0, 12] (low crouch cover, keeps BANK_HUB [0, 0, 8] & spawn [0, 0, 10] clear!)
  k.block(MAHOGANY, -2.4, 0, 11.35, 2.4, 0.96, 12.65, 0.04);
  k.deco(MARBLE, -2.55, 0.96, 11.25, 2.55, 1.06, 12.75, 0.03);
  // Decorative brass stanchion & desk lamp on island
  k.deco(BRONZE, -1.6, 1.06, 11.9, -1.45, 1.48, 12.1, 0.02);
  k.deco(BRONZE, 1.45, 1.06, 11.9, 1.6, 1.48, 12.1, 0.02);
  k.deco('emissiveWhite', -1.75, 1.44, 11.88, -1.3, 1.56, 12.12, 0.01);
  k.deco('emissiveWhite', 1.3, 1.44, 11.88, 1.75, 1.56, 12.12, 0.01);

  // West & East Mahogany Teller Desks with Breakable Glass Teller Panes
  // Counters sit at x = ±14.2 (leaving wide teller aisles x in [-18.5, -14.8] & [14.8, 18.5] for spawns [±16, 0, 2] & pickups [±16, 0, 10]!)
  const segments: readonly [number, number][] = [
    [-8.4, -0.4],
    [3.6, 11.6],
  ];
  for (const side of [-1, 1] as const) {
    const cx = side * 14.25;
    const x0 = cx - 0.55;
    const x1 = cx + 0.55;
    for (const [z0, z1] of segments) {
      // Mahogany counter body & polished marble ledge
      k.block(MAHOGANY, x0, 0, z0, x1, 1.02, z1, 0.04);
      k.deco(MARBLE, x0 - 0.12, 1.02, z0 - 0.06, x1 + 0.12, 1.12, z1 + 0.06, 0.03);
      // Decorative bronze vertical mullions & top header framing 2 breakable panes per segment
      const zMid = (z0 + z1) / 2;
      for (const mz of [z0 + 0.08, zMid, z1 - 0.08]) {
        k.deco(BRONZE, cx - 0.06, 1.12, mz - 0.06, cx + 0.06, 2.95, mz + 0.06, 0.01);
      }
      k.deco(BRONZE, cx - 0.08, 2.88, z0, cx + 0.08, 3.04, z1, 0.02);
      // 2 breakable glass teller panes per counter segment (8 total across west & east!)
      const paneW = (z1 - z0) / 2 - 0.16;
      spec.breakable('pane', cx, 2.0, (z0 + zMid) / 2, Math.PI / 2, paneW, 1.72);
      spec.breakable('pane', cx, 2.0, (zMid + z1) / 2, Math.PI / 2, paneW, 1.72);
    }

    // Back teller credenzas & office props tucked against x = ±18.6 (clear of aisle x = ±16 and stairs x = ±21.5!)
    const bx0 = side < 0 ? -19.0 : 18.2;
    const bx1 = side < 0 ? -18.2 : 19.0;
    k.block(MAHOGANY, bx0, 0, -8.2, bx1, 0.88, -1.0, 0.03);
    spec.breakable('monitor', (bx0 + bx1) / 2, 0.9, -6.4, side < 0 ? Math.PI / 2 : -Math.PI / 2);
    spec.breakable('monitor', (bx0 + bx1) / 2, 0.9, -2.8, side < 0 ? Math.PI / 2 : -Math.PI / 2);
    spec.breakable('chair', side * 16.4, 0, -4.6, side < 0 ? -Math.PI / 2 : Math.PI / 2);
    spec.breakable('plant', side * 13.0, 0, 15.2, 0);
  }

  // Twin Wide Grand Marble Staircases (west x = -21.5, east x = +21.5, width = 4.4 m)
  // Run = 12 m (z = 21.5 -> 9.5), rise = 5.5 m (y = 0 -> 5.5) -> ny = 0.909, stepY = 0.458!
  k.stairs(-21.5, 21.5, LV.hall, -21.5, 9.5, LV.mezz, 4.4, 'tile', true);
  k.stairs(21.5, 21.5, LV.hall, 21.5, 9.5, LV.mezz, 4.4, 'tile', true);

  // Ornamental solid marble balustrade walls flanking the outer stair edges
  k.sideWall(-23.85, 21.5, 0.9, -23.85, 9.5, 6.4, 0, MARBLE, 0.35);
  k.sideWall(-19.15, 21.5, 0.9, -19.15, 9.5, 6.4, 0, MARBLE, 0.35);
  k.sideWall(19.15, 21.5, 0.9, 19.15, 9.5, 6.4, 0, MARBLE, 0.35);
  k.sideWall(23.85, 21.5, 0.9, 23.85, 9.5, 6.4, 0, MARBLE, 0.35);
}

/** Wrap-around Mezzanine Galleries (y = 5.5), railings, coffered atrium beams, and Security Office. */
function mezzanineAndSecurityOffice(k: Kit, spec: MapSpec): void {
  const y = LV.mezz; // 5.5
  const thick = 0.4; // bottom at 5.1 = CEIL.mezzUnder

  // West Gallery (partitioned cleanly around west grand stair cutout x in [-24.0, -19.0], z in [9.5, 16.0])
  k.floor(MARBLE, -26.8, -16.0, -14.0, 9.5, y, thick, 4);
  k.floor(MARBLE, -26.8, 9.5, -24.0, 16.0, y, thick, 3);
  k.floor(MARBLE, -19.0, 9.5, -14.0, 16.0, y, thick, 3);

  // East Gallery (symmetrical around east grand stair cutout x in [19.0, 24.0], z in [9.5, 16.0])
  k.floor(MARBLE, 14.0, -16.0, 26.8, 9.5, y, thick, 4);
  k.floor(MARBLE, 24.0, 9.5, 26.8, 16.0, y, thick, 3);
  k.floor(MARBLE, 14.0, 9.5, 19.0, 16.0, y, thick, 3);

  // South Balcony (z in [16.0, 23.4]) & North Balcony (z in [-16.0, -10.0])
  k.floor(MARBLE, -26.8, 16.0, 26.8, 23.4, y, thick, 5);
  k.floor(MARBLE, -14.0, -16.0, 14.0, -10.0, y, thick, 4);

  // Decorative dark marble gallery carpet runners (non-colliding at y + 0.02)
  const g = k.geo;
  g.use('carpet').tint(0.28, 0.22, 0.2);
  g.box(-17.2, y + 0.02, 2.0, 2.2, 0.015, 7.0, FACE.py);
  g.box(17.2, y + 0.02, 2.0, 2.2, 0.015, 7.0, FACE.py);
  g.box(0, y + 0.02, -13.0, 12.5, 0.015, 1.8, FACE.py);
  g.box(0, y + 0.02, 19.7, 12.5, 0.015, 2.0, FACE.py);
  g.tint(1);

  // Wrap-around Atrium Balustrade Railings (h = 1.05 m) overlooking central well (x in [-14, 14], z in [-10, 16])
  k.rail([-14.0, y, -10.0, 14.0, y, -10.0, 14.0, y, 16.0, -14.0, y, 16.0, -14.0, y, -10.0], 1.05);
  // Decorative marble fascia molding around atrium edge (visually supports TICKER_POSITIONS at z = ±15.4!)
  k.deco(MARBLE, -14.2, y - 0.55, -10.2, 14.2, y + 0.08, -9.85, 0.03);
  k.deco(MARBLE, -14.2, y - 0.55, 15.85, 14.2, y + 0.08, 16.2, 0.03);
  k.deco(MARBLE, -14.2, y - 0.55, -10.2, -13.85, y + 0.08, 16.2, 0.03);
  k.deco(MARBLE, 13.85, y - 0.55, -10.2, 14.2, y + 0.08, 16.2, 0.03);

  // Guardrails along the two Grand Staircase cutouts (leaving north exit z = 9.5 open!)
  k.rail([-24.0, y, 9.5, -24.0, y, 16.0, -19.0, y, 16.0, -19.0, y, 9.5], 1.05);
  k.rail([19.0, y, 9.5, 19.0, y, 16.0, 24.0, y, 16.0, 24.0, y, 9.5], 1.05);

  // Mezzanine Security Office around SABOT_RACK_POS = [-20, 5.5, -8]
  // Encloses x in [-22.4, -15.6], z in [-11.6, -5.2], leaving rooftop stairwell along x in [-26.0, -22.6] wide open!
  const secCeil = y + 3.8; // 9.3
  // West partition wall (x = -22.4, separates Security Office from Rooftop Stairwell!)
  k.wall(-22.4, -11.6, -22.4, -5.2, y, secCeil, { thick: 0.28, mat: BRONZE, back: true, plain: true });
  // North partition wall (z = -11.6)
  k.wall(-15.6, -11.6, -22.4, -11.6, y, secCeil, { thick: 0.28, mat: BRONZE, back: true, plain: true });
  // South entry wall (z = -5.2) with clean 3.0 m doorway centered at x = -20 (x in [-21.5, -18.5], u = x + 22.4 -> 0.9..3.9)
  k.wall(-22.4, -5.2, -15.6, -5.2, y, secCeil, {
    thick: 0.28,
    mat: BRONZE,
    back: true,
    plain: true,
    openings: [{ u0: 0.9, u1: 3.9, v0: y, v1: y + 2.9, frame: true }],
  });
  // East observation wall (x = -15.6) with wide breakable glass window overlooking the Grand Atrium!
  k.wall(-15.6, -5.2, -15.6, -11.6, y, secCeil, {
    thick: 0.28,
    mat: BRONZE,
    back: true,
    plain: true,
    openings: [{ u0: 1.0, u1: 5.4, v0: y + 1.0, v1: y + 2.9 }],
  });
  spec.breakable('pane', -15.6, y + 1.95, -8.4, Math.PI / 2, 4.3, 1.84);
  // Security Office ceiling soffit (flat visual cap at y = 9.3, not in BANK_LEVELS)
  k.mass(GRANITE, -22.5, secCeil, -11.7, -15.5, secCeil + 0.3, -5.1, 3);
  // Security desk & breakable monitors/chairs tucked on north wall (keeping SABOT_RACK_POS [-20, 5.5, -8] open!)
  k.block(BRONZE, -21.8, y, -11.2, -16.6, y + 0.88, -10.2, 0.04);
  k.deco('screen', -21.4, y + 1.2, -11.38, -17.0, y + 2.6, -11.28, 0.02);
  spec.breakable('monitor', -20.5, y + 0.9, -10.7, 0);
  spec.breakable('monitor', -18.0, y + 0.9, -10.7, 0);
  spec.breakable('chair', -19.2, y, -9.4, Math.PI);

  // East Mezzanine decorative executive seating & tactical cover
  k.block(MARBLE, 15.2, y, -2.5, 16.4, y + 1.1, 2.5, 0.04);
  k.block(MARBLE, 15.2, y, -12.0, 18.8, y + 1.0, -10.8, 0.04);
  spec.breakable('chair', 22.0, y, -8.0, -Math.PI / 2);
  spec.breakable('plant', 25.0, y, -14.0, 0);

  // Coffered atrium ceiling beams framing SKYLIGHT_BOUNDS (x in [-4.5, 4.5], z in [-2.5, 6.5]) — NEVER cross the aperture!
  const beamY = CEIL.hall - 0.32;
  k.ibeam(-26.5, beamY, SKYLIGHT_BOUNDS.z0 - 0.35, 26.5, beamY, SKYLIGHT_BOUNDS.z0 - 0.35, 0.6, 0.45, MARBLE);
  k.ibeam(-26.5, beamY, SKYLIGHT_BOUNDS.z1 + 0.35, 26.5, beamY, SKYLIGHT_BOUNDS.z1 + 0.35, 0.6, 0.45, MARBLE);
  k.ibeam(SKYLIGHT_BOUNDS.x0 - 0.35, beamY, -15.8, SKYLIGHT_BOUNDS.x0 - 0.35, beamY, 23.2, 0.6, 0.45, MARBLE);
  k.ibeam(SKYLIGHT_BOUNDS.x1 + 0.35, beamY, -15.8, SKYLIGHT_BOUNDS.x1 + 0.35, beamY, 23.2, 0.6, 0.45, MARBLE);
}

/**
 * Vault Descent Ramp (z = -16..-21, y = 0..-1.5),
 * Vault Antechamber (x in [-18, 18], z in [-32, -20], y = -1.5),
 * East Guard Cage (MGL_RACK_POS = [13.5, -1.5, -25.5]),
 * West & East SWAT Breach Doorways & Side Security Corridors,
 * and Planetary Bullion Vault Bulkhead + Interior (z in [-43, -32], y = -1.5).
 */
function vaultComplex(k: Kit, spec: MapSpec): void {
  const vy = LV.vault; // -1.5
  const vc = CEIL.vault; // 3.8

  // 1. North Banking Hall Divider Wall (z = -16.0, x in [-26.8, 26.8], y = 0..13.6)
  // Wide 10 m arched portal at x in [-5, 5], y in [0, 4.6] (u = x + 26.8 -> 21.8..31.8) leading down to the Vault!
  k.wall(-26.8, -16.0, 26.8, -16.0, LV.hall, CEIL.hall, {
    thick: 0.9,
    mat: MARBLE,
    back: true,
    bay: 8,
    openings: [{ u0: 21.8, u1: 31.8, v0: LV.hall, v1: 4.6, frame: true }],
  });

  // 2. Wide Smooth Vault Descent Ramp (x in [-5, 5], z = -16 -> -21, y = 0 -> -1.5)
  k.ramp(0, -16.0, LV.hall, 0, -21.0, vy, 10.0, 'tile', 0.5, true);
  // Ramp enclosure side walls & overhead ceiling
  k.wall(-5.4, -20.5, -5.4, -16.0, vy, vc, { thick: 0.6, mat: GRANITE, back: true, plain: true });
  k.wall(5.4, -16.0, 5.4, -20.5, vy, vc, { thick: 0.6, mat: GRANITE, back: true, plain: true });
  k.mass(GRANITE, -5.8, vc, -20.5, 5.8, vc + 0.55, -15.8, 3);

  // 3. Vault Antechamber & Side Security Corridors Floor & Ceiling (x in [-26.8, 26.8], z in [-32, -20])
  k.floor('tile', -26.8, -32.0, 26.8, -20.0, vy, 0.6, 5);
  k.mass(GRANITE, -26.8, vc, -32.0, 26.8, vc + 0.6, -20.0, 5);

  // Antechamber South Wall (z = -20.0) flanking the 10 m Vault Descent Ramp opening (x in [-5, 5])
  k.wall(-18.0, -20.0, -5.0, -20.0, vy, vc, { thick: 0.7, mat: GRANITE, back: true, plain: true });
  k.wall(5.0, -20.0, 18.0, -20.0, vy, vc, { thick: 0.7, mat: GRANITE, back: true, plain: true });

  // 4 Heavy Reinforced Cover Pillars in Vault Antechamber (x = ±7, z = -23, -28)
  for (const px of [-7.0, 7.0]) {
    for (const pz of [-23.0, -28.0]) {
      k.column(px, pz, vy, vc, 1.15, GRANITE);
    }
  }

  // East Guard Cage enclosing MGL_RACK_POS = [13.5, -1.5, -25.5]
  // Open west steel doorframe (x = 11.0, z in [-27.2, -23.8]) & open east passage to VAULT_EAST_DOOR_POS = [18, -1.5, -26]!
  k.wall(11.0, -29.0, 11.0, -22.2, vy, vc, {
    thick: 0.24,
    mat: VAULT_STEEL,
    back: true,
    plain: true,
    openings: [{ u0: 1.8, u1: 5.2, v0: vy, v1: vy + 3.2, frame: true }],
  });
  k.wall(16.8, -29.0, 11.0, -29.0, vy, vc, { thick: 0.24, mat: VAULT_STEEL, back: true, plain: true });
  k.wall(11.0, -22.2, 16.8, -22.2, vy, vc, { thick: 0.24, mat: VAULT_STEEL, back: true, plain: true });
  // Decorative steel cage transom overhead on east opening so SWAT & player walk right through
  k.deco(VAULT_STEEL, 16.5, vy + 3.2, -29.0, 16.9, vc, -22.2, 0.03);
  // Cage bench tucked against south wall (clear of MGL_RACK_POS [13.5, -1.5, -25.5] and spawn [14, -1.5, -26]!)
  k.block(STEEL, 11.8, vy, -23.4, 15.6, vy + 0.85, -22.5, 0.03);
  spec.breakable('monitor', 13.6, vy + 0.87, -22.95, Math.PI);

  // West & East Antechamber Walls with SWAT Breach Doorways at VAULT_WEST_DOOR_POS [-18, -1.5, -26] & VAULT_EAST_DOOR_POS [18, -1.5, -26]
  // West wall x = -18.0, z in [-32, -20] (u = z + 32 -> z = -27.8..-24.2 is u = 4.2..7.8, width 3.6 m!)
  k.wall(-18.0, -32.0, -18.0, -20.0, vy, vc, {
    thick: 0.6,
    mat: GRANITE,
    back: true,
    plain: true,
    openings: [{ u0: 4.2, u1: 7.8, v0: vy, v1: vy + 3.5, frame: true }],
  });
  // East wall x = +18.0, z in [-20, -32] (u = -20 - z -> z = -24.2..-27.8 is u = 4.2..7.8, width 3.6 m!)
  k.wall(18.0, -20.0, 18.0, -32.0, vy, vc, {
    thick: 0.6,
    mat: GRANITE,
    back: true,
    plain: true,
    openings: [{ u0: 4.2, u1: 7.8, v0: vy, v1: vy + 3.5, frame: true }],
  });

  // West & East Side Security Staging Corridors (x in [-26.8, -18] & [18, 26.8], z in [-30, -22])
  k.wall(-26.8, -30.0, -18.0, -30.0, vy, vc, { thick: 0.5, mat: GRANITE, back: true, plain: true });
  k.wall(-18.0, -22.0, -26.8, -22.0, vy, vc, { thick: 0.5, mat: GRANITE, back: true, plain: true });
  k.wall(18.0, -30.0, 26.8, -30.0, vy, vc, { thick: 0.5, mat: GRANITE, back: true, plain: true });
  k.wall(26.8, -22.0, 18.0, -22.0, vy, vc, { thick: 0.5, mat: GRANITE, back: true, plain: true });

  // 4. Planetary Bullion Vault Bulkhead Wall (z = -32.0, x in [-18, 18], y = -1.5..3.8)
  // Physically UNOBSTRUCTED 4.6 m x 4.4 m aperture (x in [-2.3, 2.3], y in [-1.5, 2.9]) for VaultDrill & NavGraph!
  const halfDoorW = VAULT_DOOR_SIZE.width / 2; // 2.3
  const doorTopY = vy + VAULT_DOOR_SIZE.height; // 2.9
  k.wall(-18.0, -32.0, 18.0, -32.0, vy, vc, {
    thick: 1.2,
    mat: VAULT_STEEL,
    back: true,
    bay: 6,
    openings: [{ u0: 18 - halfDoorW, u1: 18 + halfDoorW, v0: vy, v1: doorTopY }],
  });
  // Monumental polished steel & hazard-striped vault portal surround (strictly outside x in [-2.3, 2.3], y <= 2.9!)
  k.deco(STEEL, -3.1, vy, -31.38, -2.32, doorTopY + 0.75, -31.22, 0.04);
  k.deco(STEEL, 2.32, vy, -31.38, 3.1, doorTopY + 0.75, -31.22, 0.04);
  k.deco(STEEL, -3.1, doorTopY + 0.02, -31.38, 3.1, doorTopY + 0.78, -31.22, 0.04);
  k.deco('hazard', -2.9, doorTopY + 0.16, -31.24, 2.9, doorTopY + 0.56, -31.16, 0.01);

  // 5. Planetary Bullion Vault Interior (x in [-12, 12], z in [-43, -32], y = -1.5, ceiling y = 3.8)
  k.floor('tile', -12.6, -43.4, 12.6, -32.0, vy, 0.6, 4);
  k.mass(VAULT_STEEL, -12.6, vc, -43.4, 12.6, vc + 0.6, -32.0, 4);
  k.wall(-12.0, -43.0, -12.0, -32.0, vy, vc, { thick: 0.8, mat: VAULT_STEEL, back: true, bay: 5 });
  k.wall(12.0, -32.0, 12.0, -43.0, vy, vc, { thick: 0.8, mat: VAULT_STEEL, back: true, bay: 5 });
  k.wall(12.0, -43.0, -12.0, -43.0, vy, vc, { thick: 0.8, mat: VAULT_STEEL, back: true, bay: 6 });

  // Heavy steel vault ceiling ribs
  for (const rz of [-35, -38.5, -41.5]) {
    k.ibeam(-11.4, vc - 0.25, rz, 11.4, vc - 0.25, rz, 0.45, 0.28, STEEL);
  }

  // Safety-deposit box brass/steel trim panels lining west, east & north vault walls (clear of all 7 GOLD_PALLETS!)
  for (const sx of [-11.48, 11.48]) {
    for (const sz of [-34.5, -37.5, -40.5]) {
      k.deco(STEEL, sx - 0.12, vy + 0.2, sz - 1.15, sx + 0.12, vy + 3.2, sz + 1.15, 0.03);
      k.deco('paintYellow', sx - 0.14, vy + 0.35, sz - 1.0, sx + 0.14, vy + 0.48, sz + 1.0, 0.01);
      k.deco('paintYellow', sx - 0.14, vy + 1.7, sz - 1.0, sx + 0.14, vy + 1.82, sz + 1.0, 0.01);
      k.deco('paintYellow', sx - 0.14, vy + 2.95, sz - 1.0, sx + 0.14, vy + 3.08, sz + 1.0, 0.01);
    }
  }
  for (const nx of [-7.5, -2.5, 2.5, 7.5]) {
    k.deco(STEEL, nx - 1.8, vy + 0.2, -42.55, nx + 1.8, vy + 3.2, -42.35, 0.03);
    k.deco('paintYellow', nx - 1.6, vy + 1.7, -42.36, nx + 1.6, vy + 1.84, -42.32, 0.01);
  }
}

/**
 * Rich sunlit atrium & warm golden bullion vault interior lighting (20 baked lights).
 * Combined with exterior.ts (18 lights) = 38 total baked lights (< 56 target, < 60 hard budget!).
 */
function interiorLights(k: Kit): void {
  const SUN_BEAM = 0xfff5dd;
  const WARM_CHANDELIER = 0xffdfa8;
  const OFFICE_COOL = 0xcce2ff;
  const VAULT_GOLD = 0xffc857;
  const VAULT_STEEL_FILL = 0x9ec0d8;

  // Grand Atrium morning skylight shaft & 3 chandelier warm glows + hall floor fill (5 lights)
  k.light(0, 12.2, 2.0, SUN_BEAM, 115, 36);
  k.light(0, 9.8, -7.0, WARM_CHANDELIER, 78, 26);
  k.light(0, 9.8, 9.5, WARM_CHANDELIER, 82, 26);
  k.light(0, 9.8, 17.0, WARM_CHANDELIER, 74, 24);
  k.light(0, 4.2, 12.0, WARM_CHANDELIER, 55, 22);

  // West & East Teller Bays (4 lights)
  k.light(-18, 3.6, -4, WARM_CHANDELIER, 44, 18);
  k.light(-18, 3.6, 8, WARM_CHANDELIER, 44, 18);
  k.light(18, 3.6, -4, WARM_CHANDELIER, 44, 18);
  k.light(18, 3.6, 8, WARM_CHANDELIER, 44, 18);

  // Mezzanine Galleries & Security Office (5 lights)
  k.light(-20, 9.4, 6, WARM_CHANDELIER, 48, 20);
  k.light(20, 9.4, 6, WARM_CHANDELIER, 48, 20);
  k.light(-19, 8.4, -8, OFFICE_COOL, 42, 16);
  k.light(20, 9.4, -8, WARM_CHANDELIER, 46, 20);
  k.light(0, 9.4, -13, WARM_CHANDELIER, 52, 22);

  // Vault Descent Ramp & Vault Antechamber (3 lights)
  k.light(0, 2.4, -18.5, VAULT_STEEL_FILL, 44, 18);
  k.light(-9, 2.6, -26, VAULT_STEEL_FILL, 52, 22);
  k.light(9, 2.6, -26, VAULT_STEEL_FILL, 52, 22);

  // Planetary Bullion Vault warm golden glow illuminating the 7 GOLD_PALLETS (3 lights)
  k.light(-6, 2.8, -38.5, VAULT_GOLD, 64, 20);
  k.light(6, 2.8, -38.5, VAULT_GOLD, 64, 20);
  k.light(0, 2.8, -34.5, VAULT_GOLD, 56, 18);
}

export function authorBankInterior(k: Kit, spec: MapSpec): void {
  grandBankingHall(k, spec);
  mezzanineAndSecurityOffice(k, spec);
  vaultComplex(k, spec);
  interiorLights(k);
}
