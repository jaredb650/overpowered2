/**
 * Surplus — The Crashed Cargo Plane (z = -74 -> -134).
 *
 * 100% SOLID (ZERO destruction clusters on the plane hull!) colossal crashed C-130 / An-124 cargo
 * transport crowning the north plateau:
 *   - Open rear cargo ramp ascending cleanly from (0, 0, -80) up to cabin deck (0, 1.5, -86).
 *   - Walkable solid fuselage interior (x = -3.4..+3.4, floor exact y = 1.5, curved rib ceiling
 *     y = 6.3, z = -86..-132), divided into 3 interior compartments by solid steel bulkhead frames
 *     at z = -102 (plane.door1, 3.2 m wide aperture) and z = -116 (plane.door2, 3.2 m wide aperture).
 *   - Sculpted exterior fuselage plating, swept high wings (±28 m wingspan, broken starboard wingtip
 *     resting directly on the sand), 4 huge underwing turboprop/jet nacelles, tapered nose cockpit,
 *     and a towering 18.5 m vertical tail stabilizer visible all the way from the Approach dunes!
 *   - Surrounding forecourt cover (z = -70..-60, |x| >= 14, completely outside the plane hull) IS
 *     Tier-0 destructible sandbags, crates & red fuel drums!
 */
import type { StructuralClusterSpec } from '../../destruction';
import { FACE } from '../../kit/geo';
import type { Kit } from '../../kit/kit';
import { tyres } from '../../kit/props';
import type { MapSpec } from '../spec';
import { DESERT_PALETTE } from './dunes';
import { CARGO_PLANE, DESERT_Z } from './plan';

const FLOOR_Y = CARGO_PLANE.floorY; // 1.5
const HALF_W = CARGO_PLANE.hullHalfW; // 3.4
const CEIL_Y = FLOOR_Y + CARGO_PLANE.hullHeight; // 6.3
const RAMP_TOP_Z = CARGO_PLANE.rampZ; // -86
const RAMP_BOT_Z = -80;
const NOSE_BULKHEAD_Z = -132;
const DOOR_HALF_W = 1.6; // 3.2 m wide clean doorway aperture for plane.door1 & plane.door2
const DOOR_TOP_Y = FLOOR_Y + 3.0; // 4.5 m (3.0 m vertical clearance)

const HULL_OLIVE = [0.68, 0.71, 0.65] as const;
const HULL_BELLY = [0.52, 0.55, 0.52] as const;
const HULL_STRIPE = [0.84, 0.44, 0.22] as const;

/** Builds one underwing turboprop / jet nacelle with intake cowling, exhaust cone, pylon & propeller blades. */
function engineNacelle(
  k: Kit,
  x: number,
  y: number,
  z: number,
  pitch: number,
  roll: number,
  bentProps = false,
): void {
  const g = k.geo;
  k.push(x, y, z, 0, pitch, roll);

  // Underwing strut pylon
  g.use('steelDark').bevel(0, 1.0, -0.4, 0.28, 0.9, 1.5, 0.04);
  // Main nacelle cowling barrel along Z (intake facing north -Z, exhaust facing south +Z)
  g.use('panel').tint(0.62, 0.66, 0.62);
  g.cyl(0, 0, -2.8, 0, 0, 2.2, 0.92, 1.02, 12, true, true);
  // Intake lip ring & dark turbine face
  g.use('steelDark').cyl(0, 0, -3.15, 0, 0, -2.75, 0.88, 0.95, 12, true, true);
  g.use('rubber').cyl(0, 0, -2.9, 0, 0, -2.8, 0.72, 0.72, 10, true, false);
  // Exhaust tailcone
  g.use('rust').cyl(0, 0, 2.2, 0, 0, 3.1, 0.78, 0.52, 10, false, true);
  // Propeller nose spinner & 4 blades
  g.use('steelDark').cyl(0, 0, -3.7, 0, 0, -3.1, 0.14, 0.42, 8, true, true);
  g.use('steelDark');
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + (bentProps ? 0.35 : 0.2);
    const bladeLen = bentProps && i === 1 ? 1.35 : 2.15;
    const bx = Math.cos(a) * bladeLen;
    const by = Math.sin(a) * bladeLen;
    const bz = bentProps && i === 1 ? -2.8 : -3.45;
    k.beam(0, 0, -3.45, bx, by, bz, 0.13, 0.035, 'steelDark', false);
  }
  g.tint(1);
  k.collide(0, 0, -0.3, 1.0, 1.0, 2.8, 'metal', false);
  k.pop();
}

/** Builds a solid interior bulkhead wall at `z` with a clean centered 3.2 m x 3.0 m doorway aperture. */
function cabinBulkhead(k: Kit, spec: MapSpec, z: number): void {
  const g = k.geo;
  const thick = 0.48;
  const hz = thick / 2;

  // Solid west & east bulkhead walls flanking the 3.2 m doorway (x = -3.4..-1.6 and +1.6..+3.4)
  k.block('steelDark', -HALF_W, FLOOR_Y, z - hz, -DOOR_HALF_W, CEIL_Y, z + hz, 0.04, 'metal');
  k.block('steelDark', DOOR_HALF_W, FLOOR_Y, z - hz, HALF_W, CEIL_Y, z + hz, 0.04, 'metal');
  // Solid header lintel above the doorway (y = 4.5..6.3)
  k.block('steelDark', -DOOR_HALF_W, DOOR_TOP_Y, z - hz, DOOR_HALF_W, CEIL_Y, z + hz, 0.04, 'metal');

  // Heavy industrial steel bulkhead frame trim & hazard stripes around doorway jambs
  g.use('hazard');
  for (const s of [-1, 1]) {
    g.box(s * (DOOR_HALF_W + 0.14), FLOOR_Y + 1.5, z + hz + 0.02, 0.12, 1.45, 0.015, FACE.pz);
    g.box(s * (DOOR_HALF_W + 0.14), FLOOR_Y + 1.5, z - hz - 0.02, 0.12, 1.45, 0.015, FACE.nz);
  }
  g.use('emissiveOrange');
  g.box(0, DOOR_TOP_Y + 0.16, z + hz + 0.02, 1.1, 0.06, 0.02, FACE.pz);
  g.box(0, DOOR_TOP_Y + 0.16, z - hz - 0.02, 1.1, 0.06, 0.02, FACE.nz);

  spec.plan?.doors.push({ x: 0, z, dx: 0, dz: -1, w: DOOR_HALF_W * 2 });
}

/** Builds the 100% solid crashed C-130 / An-124 cargo fuselage, interior compartments, wings, engines, and tail. */
function buildCargoPlaneHull(k: Kit, spec: MapSpec): void {
  const g = k.geo;
  const hullLen = RAMP_TOP_Z - NOSE_BULKHEAD_Z; // 46 m (-86 .. -132)
  const hullMidZ = (RAMP_TOP_Z + NOSE_BULKHEAD_Z) / 2; // -109
  const wallThick = 0.52;

  // --- 1. Open Rear Cargo Ramp ascending cleanly from (0, 0, -80) up to cabin deck (0, 1.5, -86) ---
  k.ramp(0, RAMP_BOT_Z, 0, 0, RAMP_TOP_Z, FLOOR_Y, 5.4, 'steel', 0.34, true);
  // Hydraulic ramp side guide cheeks & yellow chevron loading marks
  for (const side of [-1, 1] as const) {
    k.beam(side * 2.85, 0.15, RAMP_BOT_Z + 0.2, side * 2.85, FLOOR_Y + 0.2, RAMP_TOP_Z, 0.12, 0.22, 'steelDark', false);
    // Overhead hydraulic actuator arm connecting upper doorway frame to ramp midpoint
    k.beam(side * 2.9, FLOOR_Y + 3.2, RAMP_TOP_Z - 0.3, side * 2.85, 0.85, -83.0, 0.08, 0.08, 'rust', false);
  }
  g.use('hazard').box(0, 0.03, RAMP_BOT_Z + 0.45, 2.6, 0.01, 0.32, FACE.py);

  // --- 2. Solid Walkable Cabin Deck (exact y = 1.5) & Grounded Belly Keel ---
  k.floor('steel', -HALF_W - 0.2, NOSE_BULKHEAD_Z, HALF_W + 0.2, RAMP_TOP_Z, FLOOR_Y, 0.42, 4, 'metal');
  // Solid fuselage lower belly resting in desert sand (y = 0 .. 1.08) so nothing clips under the hull
  k.block('panel', -HALF_W - 0.15, 0, NOSE_BULKHEAD_Z, HALF_W + 0.15, FLOOR_Y - 0.42, RAMP_TOP_Z, 0.18, 'metal');
  // Cargo floor tie-down roller tracks (flush decorative steel rails along interior aisle)
  g.use('steelDark');
  for (const rx of [-2.0, -0.8, 0.8, 2.0]) {
    g.box(rx, FLOOR_Y + 0.015, hullMidZ, 0.08, 0.015, hullLen / 2 - 1.0, FACE.py);
  }

  // --- 3. Solid Fuselage Side Walls, Curved Exterior Plating & Overhead Ribbed Ceiling ---
  for (const side of [-1, 1] as const) {
    const xInner = side * HALF_W;
    const xOuter = side * (HALF_W + wallThick);
    const x0 = Math.min(xInner, xOuter);
    const x1 = Math.max(xInner, xOuter);
    // Main load-bearing solid fuselage side wall (x = ±3.4..±3.92, y = 1.5..6.3)
    k.block('panel', x0, FLOOR_Y, NOSE_BULKHEAD_Z, x1, CEIL_Y, RAMP_TOP_Z, 0.08, 'metal');
    // Sculpted rounded outer barrel shoulder cladding (gives unmistakably cylindrical aircraft fuselage!)
    g.use('panel').tint(HULL_OLIVE[0], HULL_OLIVE[1], HULL_OLIVE[2]);
    g.bevel(side * (HALF_W + 0.62), FLOOR_Y + 2.35, hullMidZ, 0.22, 1.55, hullLen / 2 - 0.3, 0.12);
    // Lower sloped chine fairing & upper curved crown fairing
    g.use('panel').tint(HULL_BELLY[0], HULL_BELLY[1], HULL_BELLY[2]);
    g.bevel(side * (HALF_W + 0.38), FLOOR_Y + 0.55, hullMidZ, 0.32, 0.55, hullLen / 2 - 0.4, 0.14);
    g.use('panel').tint(HULL_OLIVE[0] * 1.05, HULL_OLIVE[1] * 1.05, HULL_OLIVE[2] * 1.05);
    g.bevel(side * (HALF_W - 0.35), CEIL_Y + 0.45, hullMidZ, 0.65, 0.38, hullLen / 2 - 0.3, 0.16);
    // High-visibility weathered orange military transport rescue stripe along both flanks
    g.use('paintRed').tint(HULL_STRIPE[0], HULL_STRIPE[1], HULL_STRIPE[2]);
    g.box(side * (HALF_W + 0.85), FLOOR_Y + 2.6, hullMidZ, 0.02, 0.28, hullLen / 2 - 2.0, side > 0 ? FACE.px : FACE.nx);
    // Small darkened porthole windows spaced down both hull flanks
    g.use('steelDark').tint(0.32);
    for (let wz = RAMP_TOP_Z - 4; wz >= NOSE_BULKHEAD_Z + 5; wz -= 4.2) {
      g.box(side * (HALF_W + 0.86), FLOOR_Y + 3.25, wz, 0.02, 0.26, 0.36, side > 0 ? FACE.px : FACE.nx);
    }
    g.tint(1);
  }

  // Solid overhead curved fuselage roof deck (y = 6.3 .. 7.05)
  k.block('panel', -HALF_W - 0.1, CEIL_Y, NOSE_BULKHEAD_Z, HALF_W + 0.1, CEIL_Y + 0.65, RAMP_TOP_Z, 0.14, 'metal');
  // Upper spine fairing crowning the top of the barrel (y = 6.95 .. 7.45)
  g.use('panel').tint(HULL_OLIVE[0], HULL_OLIVE[1], HULL_OLIVE[2]);
  g.bevel(0, CEIL_Y + 0.82, hullMidZ, 2.35, 0.32, hullLen / 2 - 0.5, 0.18);
  g.tint(1);

  // Rear cargo bay upper surround header at z = -86 (leaves rear cargo opening x = -2.8..+2.8, y = 1.5..5.2 wide open!)
  k.block('steelDark', -HALF_W, FLOOR_Y + 3.7, RAMP_TOP_Z - 0.35, HALF_W, CEIL_Y, RAMP_TOP_Z + 0.35, 0.05, 'metal');
  k.block('steelDark', -HALF_W, FLOOR_Y, RAMP_TOP_Z - 0.35, -2.85, FLOOR_Y + 3.7, RAMP_TOP_Z + 0.35, 0.04, 'metal');
  k.block('steelDark', 2.85, FLOOR_Y, RAMP_TOP_Z - 0.35, HALF_W, FLOOR_Y + 3.7, RAMP_TOP_Z + 0.35, 0.04, 'metal');

  // --- 4. Interior Rib Frames, Bulkhead Door Frames & Strapped Side Cargo Crates ---
  // Interior aluminum fuselage rib arches every 4 m (tucked flush against walls & ceiling)
  g.use('steel').tint(0.75);
  for (let rz = RAMP_TOP_Z - 3; rz >= NOSE_BULKHEAD_Z + 2; rz -= 4) {
    // Skip right on top of the two bulkhead frames
    if (Math.abs(rz - CARGO_PLANE.door1Z) < 1.2 || Math.abs(rz - CARGO_PLANE.door2Z) < 1.2) continue;
    g.bevel(-HALF_W + 0.12, (FLOOR_Y + CEIL_Y) / 2, rz, 0.12, CARGO_PLANE.hullHeight / 2 - 0.1, 0.14, 0.03);
    g.bevel(HALF_W - 0.12, (FLOOR_Y + CEIL_Y) / 2, rz, 0.12, CARGO_PLANE.hullHeight / 2 - 0.1, 0.14, 0.03);
    g.bevel(0, CEIL_Y - 0.14, rz, HALF_W - 0.1, 0.14, 0.14, 0.03);
    // Upper corner gusset brackets giving curved ceiling look inside
    for (const s of [-1, 1]) {
      g.bevel(s * (HALF_W - 0.45), CEIL_Y - 0.45, rz, 0.35, 0.35, 0.12, 0.06);
    }
  }
  g.tint(1);

  // Two Solid Steel Bulkhead Frames with clean 3.2 m doorways for plane.door1 (-102) & plane.door2 (-116)!
  cabinBulkhead(k, spec, CARGO_PLANE.door1Z);
  cabinBulkhead(k, spec, CARGO_PLANE.door2Z);

  // Forward cockpit bulkhead sealing the far end at z = -132 (dramatically framing Quist at z = -124!)
  k.block('steelDark', -HALF_W, FLOOR_Y, NOSE_BULKHEAD_Z - 0.5, HALF_W, CEIL_Y, NOSE_BULKHEAD_Z, 0.05, 'metal');
  // Recessed cockpit viewport & glowing amber/red emergency console lights behind Quist
  g.use('glass').box(0, FLOOR_Y + 2.1, NOSE_BULKHEAD_Z + 0.03, 1.5, 0.65, 0.02, FACE.pz);
  g.use('emissiveOrange').box(-0.7, FLOOR_Y + 1.15, NOSE_BULKHEAD_Z + 0.05, 0.42, 0.12, 0.04, FACE.pz);
  g.use('emissiveRed').box(0.7, FLOOR_Y + 1.15, NOSE_BULKHEAD_Z + 0.05, 0.42, 0.12, 0.04, FACE.pz);

  // Solid strapped military supply benches/crates tucked flush against the outer walls (|x| >= 2.5 -> 5.0 m clear center aisle!)
  for (const [cz, sx] of [
    [-91, -1],
    [-96, 1],
    [-108, -1],
    [-112, 1],
    [-121, -1],
    [-127, 1],
  ] as const) {
    const cx = sx * (HALF_W - 0.52);
    k.block('plywood', cx - 0.46, FLOOR_Y, cz - 1.35, cx + 0.46, FLOOR_Y + 1.05, cz + 1.35, 0.05);
    g.use('steelDark').box(cx, FLOOR_Y + 1.07, cz, 0.48, 0.03, 0.12, FACE.py);
  }

  // Overhead warm cabin strip lights down all 3 compartments (moody emergency cabin glow)
  k.lampBar(0, CEIL_Y - 0.18, -94, Math.PI / 2, 3.6, 'orange', 24, 14);
  k.lampBar(0, CEIL_Y - 0.18, -109, Math.PI / 2, 3.6, 'orange', 24, 14);
  k.lampBar(0, CEIL_Y - 0.18, -124, Math.PI / 2, 3.6, 'red', 22, 14);

  // --- 5. Tapered Nose Cone & Plowed Sand Impact Berm (z = -132 .. -142) ---
  // Stepped tapering military transport nose
  k.block('panel', -3.1, 0.3, -135.8, 3.1, 5.4, NOSE_BULKHEAD_Z, 0.35, 'metal');
  k.block('panel', -2.3, 0.5, -139.2, 2.3, 4.1, -135.6, 0.42, 'metal');
  g.use('steelDark').tint(0.38).bevel(0, 2.1, -140.4, 1.45, 1.25, 1.4, 0.45);
  // Flight-deck wrap-around cockpit windscreen windows (angled dark glass)
  g.use('steelDark').tint(0.24).bevel(0, 4.55, -136.4, 2.1, 0.58, 1.35, 0.08);
  g.tint(1);
  // Plowed golden sand impact mound banked around the crashed nose
  g.use('dirt').tint(DESERT_PALETTE.sandMid[0], DESERT_PALETTE.sandMid[1], DESERT_PALETTE.sandMid[2]);
  g.bevel(0, 0.9, -141.5, 6.2, 0.9, 2.6, 0.55);
  g.tint(1);
  k.collide(0, 0.8, -141.5, 5.8, 0.8, 2.4, 'dirt', false);

  // --- 6. Swept High Wings (±28 m Wingspan!) ---
  // Port Wing (-X: intact swept high wing angling slightly up from y = 6.2 to y = 7.6 at x = -28)
  k.along(-3.5, 6.4, -105.5, -28.0, 7.6, -109.5, len => {
    g.use('panel').tint(HULL_OLIVE[0], HULL_OLIVE[1], HULL_OLIVE[2]);
    g.bevel(len / 2, 0, 0, len / 2, 0.42, 3.6, 0.16);
    // Trailing edge flaps & high-vis tip stripe
    g.use('steelDark').bevel(len * 0.45, -0.06, -3.75, len * 0.38, 0.16, 0.65, 0.04);
    g.use('paintRed').tint(HULL_STRIPE[0], HULL_STRIPE[1], HULL_STRIPE[2]);
    g.bevel(len - 1.4, 0.05, 0, 1.3, 0.44, 2.4, 0.1);
    g.use('emissiveCyan').box(len, 0.05, 0, 0.16, 0.14, 0.25, FACE.all);
    g.tint(1);
    k.collide(len / 2, 0, 0, len / 2, 0.45, 3.5, 'metal', false);
  });

  // Starboard Wing (+X): Inboard intact stub (x = 3.5 -> 13.5) + Broken outer wing resting on the desert sand (x = 13.5 -> 28.0)!
  k.along(3.5, 6.4, -105.5, 13.5, 5.7, -107.2, len => {
    g.use('panel').tint(HULL_OLIVE[0], HULL_OLIVE[1], HULL_OLIVE[2]);
    g.bevel(len / 2, 0, 0, len / 2, 0.44, 3.7, 0.16);
    g.tint(1);
    k.collide(len / 2, 0, 0, len / 2, 0.46, 3.6, 'metal', false);
  });
  // Sheared wing break seam with dark charred steel spar & jagged framing at (13.5, 5.7, -107.2)
  g.use('rust').tint(0.55).bevel(13.5, 5.65, -107.2, 0.6, 0.55, 3.5, 0.08);
  g.tint(1);
  // Broken outer starboard wing drooping steeply to rest directly on the desert sand at (28.0, 0.4, -109.8)!
  k.along(13.5, 5.6, -107.2, 28.0, 0.42, -109.8, len => {
    g.use('panel').tint(HULL_OLIVE[0] * 0.92, HULL_OLIVE[1] * 0.92, HULL_OLIVE[2] * 0.92);
    g.bevel(len / 2, 0, 0, len / 2, 0.36, 3.1, 0.14);
    g.use('paintRed').tint(HULL_STRIPE[0], HULL_STRIPE[1], HULL_STRIPE[2]);
    g.bevel(len - 1.4, 0.05, 0, 1.3, 0.38, 2.2, 0.1);
    g.use('emissiveRed').box(len, 0.1, 0, 0.16, 0.14, 0.25, FACE.all);
    g.tint(1);
    k.collide(len / 2, 0, 0, len / 2, 0.38, 3.0, 'metal', false);
  });
  // Plowed sand mound beneath the grounded starboard wingtip (28, 0, -109.8)
  g.use('dirt').tint(DESERT_PALETTE.sandLight[0], DESERT_PALETTE.sandLight[1], DESERT_PALETTE.sandLight[2]);
  g.bevel(28.2, 0.55, -109.8, 2.8, 0.55, 3.8, 0.3);
  g.tint(1);

  // --- 7. Four Huge Underwing Turboprop / Jet Nacelles ---
  engineNacelle(k, -10.5, 4.9, -104.0, 0, 0, false);
  engineNacelle(k, -19.5, 5.4, -106.2, 0, 0, false);
  engineNacelle(k, 10.5, 4.4, -104.0, 0.06, -0.08, false);
  engineNacelle(k, 19.8, 2.35, -106.6, 0.12, -0.34, true); // hangs low off broken starboard wing!

  // --- 8. Towering Vertical Tail Stabilizer (y = 18.5 m!) + Swept Horizontal Tailplanes (±10.5 m) ---
  // Visible all the way from the Approach Dunes (z = 208) as the ultimate mission landmark!
  const tailBaseZ = RAMP_TOP_Z - 3.6; // -89.6
  // Multi-tiered swept vertical tail fin rising from y = 6.6 up to y = 18.5 m
  k.block('panel', -0.45, 6.6, tailBaseZ - 4.4, 0.45, 10.6, tailBaseZ + 2.8, 0.12, 'metal');
  k.block('panel', -0.38, 10.6, tailBaseZ - 3.2, 0.38, 14.8, tailBaseZ + 3.2, 0.1, 'metal');
  k.block('panel', -0.32, 14.8, tailBaseZ - 1.8, 0.32, 18.5, tailBaseZ + 3.4, 0.1, 'metal');
  // High-visibility orange/red military tail band & dark rudder trim
  g.use('paintRed').tint(HULL_STRIPE[0], HULL_STRIPE[1], HULL_STRIPE[2]);
  g.box(0.41, 15.6, tailBaseZ + 0.8, 0.02, 1.35, 2.4, FACE.px);
  g.box(-0.41, 15.6, tailBaseZ + 0.8, 0.02, 1.35, 2.4, FACE.nx);
  // Glowing red aviation beacon atop the 18.5 m tail fin!
  g.use('emissiveRed').cyl(0, 18.5, tailBaseZ + 1.4, 0, 18.95, tailBaseZ + 1.4, 0.24, 0.24, 8, true, true);
  g.tint(1);

  // Swept Horizontal Tailplanes (±10.5 m span at y = 7.4, z = -88.5)
  for (const side of [-1, 1] as const) {
    k.along(side * 1.4, 7.3, tailBaseZ + 0.5, side * 10.8, 7.8, tailBaseZ + 2.6, len => {
      g.use('panel').tint(HULL_OLIVE[0], HULL_OLIVE[1], HULL_OLIVE[2]);
      g.bevel(len / 2, 0, 0, len / 2, 0.24, 1.85, 0.08);
      g.tint(1);
    });
  }

  // Minimap plan geometry for the colossal crashed plane silhouette
  spec.plan?.blocks.push(
    { x0: -HALF_W - 0.6, z0: -140, x1: HALF_W + 0.6, z1: RAMP_TOP_Z },
    { x0: -28, z0: -112, x1: 28, z1: -102 },
  );
  spec.plan?.decks.push({ x0: -HALF_W, z0: NOSE_BULKHEAD_Z, x1: HALF_W, z1: RAMP_BOT_Z });

  // Dramatic warm dawn floodlights washing the rear cargo ramp & towering tail silhouette
  k.light(0, 9.5, -76, DESERT_PALETTE.dawnWarm, 58, 32);
  k.light(0, 14, -92, DESERT_PALETTE.dawnAmber, 44, 28);
}

/**
 * Tier-0 destructible forecourt cover nests (sandbags, crates & red fuel drums) strictly OUTSIDE
 * the Cargo Plane hull (z = -70..-60, |x| >= 14), keeping exfil pos [0,0,-70] & sewerExitTop [0,0,-77] clear!
 */
function buildForecourtDestructibleCover(k: Kit, spec: MapSpec): void {
  const nests: readonly [number, number, number][] = [
    [-18, -68, 0.22],
    [18, -68, -0.22],
    [-15, -61, 0.15],
    [15, -61, -0.15],
  ];

  for (let i = 0; i < nests.length; i++) {
    const [x, z, yaw] = nests[i]!;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const pt = (lx: number, ly: number, lz: number): [number, number, number] => [
      x + lx * c + lz * s,
      ly,
      z - lx * s + lz * c,
    ];

    const cluster: StructuralClusterSpec = {
      id: `forecourt.cover.${i}`,
      tag: `forecourt.cover.${i}`,
      kind: 'forecourtCover',
      label: 'FORECOURT COVER NEST',
      value: 28_000,
      nodes: [
        { id: 'sandbags', pos: pt(0, 0.62, 0), half: [2.2, 0.62, 0.42], mat: 'dirt', color: 0x9b8660, hp: 85, tier: 0, anchored: true, kind: 'wall', yaw },
        { id: 'crate_l', pos: pt(-1.6, 0.56, -0.75), half: [0.6, 0.56, 0.6], mat: 'plywood', color: 0x987448, hp: 70, tier: 0, anchored: true, kind: 'wall', yaw },
        { id: 'crate_r', pos: pt(1.6, 0.56, -0.75), half: [0.6, 0.56, 0.6], mat: 'plywood', color: 0x8d6940, hp: 70, tier: 0, anchored: true, kind: 'wall', yaw },
        { id: 'drum', pos: pt(0.2, 0.56, -0.85), half: [0.42, 0.56, 0.42], mat: 'paintRed', color: 0xcc2820, hp: 35, tier: 0, anchored: true, kind: 'hazard', yaw, hazardRadius: 9.0, hazardDamage: 225 },
      ],
      collapseThreshold: 0.5,
    };
    spec.cluster(cluster);
  }

  // Scattered tyre piles & forecourt floodlight masts framing the plane apron
  tyres(k, -26, 0, -72, 3, false);
  tyres(k, 26, 0, -72, 3, false);
  k.mast(-24, -74, 0, 9.0, -0.6, 'orange', 44, 24);
  k.mast(24, -74, 0, 9.0, 0.6, 'orange', 44, 24);
  spec.barrels(-11, 0, -64, 2);
  spec.barrels(11, 0, -64, 2);

  // Subtle perimeter berm/rock ridge flanking the plane plateau beyond x = ±44
  for (const side of [-1, 1] as const) {
    k.wall(side * 56, DESERT_Z.pumpNorthGate, side * 56, DESERT_Z.planeEnd - 12, 0, 5.5, {
      mat: 'concrete',
      backing: 'concreteDark',
      thick: 1.8,
      bay: 12,
      pilasters: false,
    });
  }
}

export function authorDesertPlane(k: Kit, spec: MapSpec): void {
  buildCargoPlaneHull(k, spec);
  buildForecourtDestructibleCover(k, spec);
}
