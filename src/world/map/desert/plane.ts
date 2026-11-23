/**
 * Surplus — Section 7: The Relocated Crashed Cargo Plane (z = -206 -> -275).
 *
 * 100% SOLID (ZERO destruction clusters on the plane hull!) colossal crashed C-130 / An-124 cargo
 * transport crowning the north red-sandstone canyon basin directly beyond the Salt Cave exit:
 *   - Open rear cargo ramp ascending cleanly from (0, 0, -212) up to cabin deck (0, 1.5, -218).
 *   - Walkable solid fuselage interior (x = -3.4..+3.4, floor exact y = 1.5, curved rib ceiling
 *     y = 6.3, z = -218..-264), divided into 3 interior compartments by solid steel bulkhead frames
 *     at z = -234 (`plane.door1`, 3.2 m wide aperture) and z = -248 (`plane.door2`, 3.2 m wide aperture).
 *   - Sculpted exterior fuselage plating, swept high wings (±28 m wingspan, broken starboard wingtip
 *     resting directly on the sand), 4 huge underwing turboprop/jet nacelles, tapered nose cockpit,
 *     and a towering 18.5 m vertical tail stabilizer!
 *   - Framed by dramatic red-sandstone canyon cliffs with a wide 26 m eastern breach opening straight
 *     onto the flat Eastern Convoy Bypass Road (`[0,-204] -> [26,-196] -> [48,-172]`) for Section 8 exfil!
 *   - Forecourt cover nests (`z = -206..-208`, completely outside the plane hull) ARE Tier-0 destructible.
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
const RAMP_TOP_Z = CARGO_PLANE.rampZ; // -218
const RAMP_BOT_Z = RAMP_TOP_Z + 6; // -212
const NOSE_BULKHEAD_Z = DESERT_Z.planeEnd + 2; // -264 (46 m fuselage cabin length)
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

  g.use('steelDark').bevel(0, 1.0, -0.4, 0.28, 0.9, 1.5, 0.04);
  g.use('panel').tint(0.62, 0.66, 0.62);
  g.cyl(0, 0, -2.8, 0, 0, 2.2, 0.92, 1.02, 10, true, true);
  g.use('steelDark').cyl(0, 0, -3.15, 0, 0, -2.75, 0.88, 0.95, 10, true, true);
  g.use('rubber').cyl(0, 0, -2.9, 0, 0, -2.8, 0.72, 0.72, 8, true, false);
  g.use('rust').cyl(0, 0, 2.2, 0, 0, 3.1, 0.78, 0.52, 8, false, true);
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

  k.block('steelDark', -HALF_W, FLOOR_Y, z - hz, -DOOR_HALF_W, CEIL_Y, z + hz, 0.04, 'metal');
  k.block('steelDark', DOOR_HALF_W, FLOOR_Y, z - hz, HALF_W, CEIL_Y, z + hz, 0.04, 'metal');
  k.block('steelDark', -DOOR_HALF_W, DOOR_TOP_Y, z - hz, DOOR_HALF_W, CEIL_Y, z + hz, 0.04, 'metal');

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
  const hullLen = RAMP_TOP_Z - NOSE_BULKHEAD_Z; // 46 m (-218 .. -264)
  const hullMidZ = (RAMP_TOP_Z + NOSE_BULKHEAD_Z) / 2; // -241
  const wallThick = 0.52;

  // --- 1. Open Rear Cargo Ramp ascending cleanly from (0, 0, -212) up to cabin deck (0, 1.5, -218) ---
  k.ramp(0, RAMP_BOT_Z, 0, 0, RAMP_TOP_Z, FLOOR_Y, 5.4, 'steel', 0.34, true);
  for (const side of [-1, 1] as const) {
    k.beam(side * 2.85, 0.15, RAMP_BOT_Z + 0.2, side * 2.85, FLOOR_Y + 0.2, RAMP_TOP_Z, 0.12, 0.22, 'steelDark', false);
    k.beam(side * 2.9, FLOOR_Y + 3.2, RAMP_TOP_Z - 0.3, side * 2.85, 0.85, RAMP_BOT_Z - 3.0, 0.08, 0.08, 'rust', false);
  }
  g.use('hazard').box(0, 0.03, RAMP_BOT_Z + 0.45, 2.6, 0.01, 0.32, FACE.py);

  // --- 2. Solid Walkable Cabin Deck (exact y = 1.5) & Grounded Belly Keel ---
  k.floor('steel', -HALF_W - 0.2, NOSE_BULKHEAD_Z, HALF_W + 0.2, RAMP_TOP_Z, FLOOR_Y, 0.42, 4, 'metal');
  k.block('panel', -HALF_W - 0.15, 0, NOSE_BULKHEAD_Z, HALF_W + 0.15, FLOOR_Y - 0.42, RAMP_TOP_Z, 0.18, 'metal');
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
    k.block('panel', x0, FLOOR_Y, NOSE_BULKHEAD_Z, x1, CEIL_Y, RAMP_TOP_Z, 0.08, 'metal');
    g.use('panel').tint(HULL_OLIVE[0], HULL_OLIVE[1], HULL_OLIVE[2]);
    g.bevel(side * (HALF_W + 0.62), FLOOR_Y + 2.35, hullMidZ, 0.22, 1.55, hullLen / 2 - 0.3, 0.12);
    g.use('panel').tint(HULL_BELLY[0], HULL_BELLY[1], HULL_BELLY[2]);
    g.bevel(side * (HALF_W + 0.38), FLOOR_Y + 0.55, hullMidZ, 0.32, 0.55, hullLen / 2 - 0.4, 0.14);
    g.use('panel').tint(HULL_OLIVE[0] * 1.05, HULL_OLIVE[1] * 1.05, HULL_OLIVE[2] * 1.05);
    g.bevel(side * (HALF_W - 0.35), CEIL_Y + 0.45, hullMidZ, 0.65, 0.38, hullLen / 2 - 0.3, 0.16);
    g.use('paintRed').tint(HULL_STRIPE[0], HULL_STRIPE[1], HULL_STRIPE[2]);
    g.box(side * (HALF_W + 0.85), FLOOR_Y + 2.6, hullMidZ, 0.02, 0.28, hullLen / 2 - 2.0, side > 0 ? FACE.px : FACE.nx);
    g.use('steelDark').tint(0.32);
    for (let wz = RAMP_TOP_Z - 4; wz >= NOSE_BULKHEAD_Z + 5; wz -= 4.2) {
      g.box(side * (HALF_W + 0.86), FLOOR_Y + 3.25, wz, 0.02, 0.26, 0.36, side > 0 ? FACE.px : FACE.nx);
    }
    g.tint(1);
  }

  k.block('panel', -HALF_W - 0.1, CEIL_Y, NOSE_BULKHEAD_Z, HALF_W + 0.1, CEIL_Y + 0.65, RAMP_TOP_Z, 0.14, 'metal');
  g.use('panel').tint(HULL_OLIVE[0], HULL_OLIVE[1], HULL_OLIVE[2]);
  g.bevel(0, CEIL_Y + 0.82, hullMidZ, 2.35, 0.32, hullLen / 2 - 0.5, 0.18);
  g.tint(1);

  // Rear cargo bay upper surround header at RAMP_TOP_Z (-218)
  k.block('steelDark', -HALF_W, FLOOR_Y + 3.7, RAMP_TOP_Z - 0.35, HALF_W, CEIL_Y, RAMP_TOP_Z + 0.35, 0.05, 'metal');
  k.block('steelDark', -HALF_W, FLOOR_Y, RAMP_TOP_Z - 0.35, -2.85, FLOOR_Y + 3.7, RAMP_TOP_Z + 0.35, 0.04, 'metal');
  k.block('steelDark', 2.85, FLOOR_Y, RAMP_TOP_Z - 0.35, HALF_W, FLOOR_Y + 3.7, RAMP_TOP_Z + 0.35, 0.04, 'metal');

  // --- 4. Interior Rib Frames, Bulkhead Door Frames & Strapped Side Cargo Crates ---
  g.use('steel').tint(0.75);
  for (let rz = RAMP_TOP_Z - 3; rz >= NOSE_BULKHEAD_Z + 2; rz -= 4) {
    if (Math.abs(rz - CARGO_PLANE.door1Z) < 1.2 || Math.abs(rz - CARGO_PLANE.door2Z) < 1.2) continue;
    g.bevel(-HALF_W + 0.12, (FLOOR_Y + CEIL_Y) / 2, rz, 0.12, CARGO_PLANE.hullHeight / 2 - 0.1, 0.14, 0.03);
    g.bevel(HALF_W - 0.12, (FLOOR_Y + CEIL_Y) / 2, rz, 0.12, CARGO_PLANE.hullHeight / 2 - 0.1, 0.14, 0.03);
    g.bevel(0, CEIL_Y - 0.14, rz, HALF_W - 0.1, 0.14, 0.14, 0.03);
    for (const s of [-1, 1]) {
      g.bevel(s * (HALF_W - 0.45), CEIL_Y - 0.45, rz, 0.35, 0.35, 0.12, 0.06);
    }
  }
  g.tint(1);

  // Two Solid Steel Bulkhead Frames with clean 3.2 m doorways for plane.door1 (-234) & plane.door2 (-248)!
  cabinBulkhead(k, spec, CARGO_PLANE.door1Z);
  cabinBulkhead(k, spec, CARGO_PLANE.door2Z);

  // Forward cockpit bulkhead sealing the far end at NOSE_BULKHEAD_Z (-264) framing Quist at z = -256!
  k.block('steelDark', -HALF_W, FLOOR_Y, NOSE_BULKHEAD_Z - 0.5, HALF_W, CEIL_Y, NOSE_BULKHEAD_Z, 0.05, 'metal');
  g.use('glass').box(0, FLOOR_Y + 2.1, NOSE_BULKHEAD_Z + 0.03, 1.5, 0.65, 0.02, FACE.pz);
  g.use('emissiveOrange').box(-0.7, FLOOR_Y + 1.15, NOSE_BULKHEAD_Z + 0.05, 0.42, 0.12, 0.04, FACE.pz);
  g.use('emissiveRed').box(0.7, FLOOR_Y + 1.15, NOSE_BULKHEAD_Z + 0.05, 0.42, 0.12, 0.04, FACE.pz);

  // Solid strapped military supply crates tucked flush against outer cabin walls (|x| >= 2.5 -> 5.0 m clear aisle!)
  for (const [dz, sx] of [
    [-5, -1],
    [-10, 1],
    [-22, -1],
    [-26, 1],
    [-35, -1],
    [-41, 1],
  ] as const) {
    const cz = RAMP_TOP_Z + dz;
    const cx = sx * (HALF_W - 0.52);
    k.block('plywood', cx - 0.46, FLOOR_Y, cz - 1.35, cx + 0.46, FLOOR_Y + 1.05, cz + 1.35, 0.05);
    g.use('steelDark').box(cx, FLOOR_Y + 1.07, cz, 0.48, 0.03, 0.12, FACE.py);
  }

  // Overhead warm cabin strip lights down all 3 compartments (3 lights)
  k.lampBar(0, CEIL_Y - 0.18, RAMP_TOP_Z - 8, Math.PI / 2, 3.6, 'orange', 24, 14);
  k.lampBar(0, CEIL_Y - 0.18, RAMP_TOP_Z - 23, Math.PI / 2, 3.6, 'orange', 24, 14);
  k.lampBar(0, CEIL_Y - 0.18, RAMP_TOP_Z - 38, Math.PI / 2, 3.6, 'red', 22, 14);

  // --- 5. Tapered Nose Cone & Plowed Sand Impact Berm (z = -264 .. -275) ---
  k.block('panel', -3.1, 0.3, NOSE_BULKHEAD_Z - 3.8, 3.1, 5.4, NOSE_BULKHEAD_Z, 0.35, 'metal');
  k.block('panel', -2.3, 0.5, NOSE_BULKHEAD_Z - 7.2, 2.3, 4.1, NOSE_BULKHEAD_Z - 3.6, 0.42, 'metal');
  g.use('steelDark').tint(0.38).bevel(0, 2.1, NOSE_BULKHEAD_Z - 8.4, 1.45, 1.25, 1.4, 0.45);
  g.use('steelDark').tint(0.24).bevel(0, 4.55, NOSE_BULKHEAD_Z - 4.4, 2.1, 0.58, 1.35, 0.08);
  g.tint(1);
  g.use('dirt').tint(DESERT_PALETTE.sandMid[0], DESERT_PALETTE.sandMid[1], DESERT_PALETTE.sandMid[2]);
  g.bevel(0, 0.9, NOSE_BULKHEAD_Z - 9.5, 6.2, 0.9, 2.6, 0.55);
  g.tint(1);
  k.collide(0, 0.8, NOSE_BULKHEAD_Z - 9.5, 5.8, 0.8, 2.4, 'dirt', false);

  // --- 6. Swept High Wings (±28 m Wingspan!) ---
  const wingRootZ = RAMP_TOP_Z - 19.5; // -237.5
  k.along(-3.5, 6.4, wingRootZ, -28.0, 7.6, wingRootZ - 4.0, len => {
    g.use('panel').tint(HULL_OLIVE[0], HULL_OLIVE[1], HULL_OLIVE[2]);
    g.bevel(len / 2, 0, 0, len / 2, 0.42, 3.6, 0.16);
    g.use('steelDark').bevel(len * 0.45, -0.06, -3.75, len * 0.38, 0.16, 0.65, 0.04);
    g.use('paintRed').tint(HULL_STRIPE[0], HULL_STRIPE[1], HULL_STRIPE[2]);
    g.bevel(len - 1.4, 0.05, 0, 1.3, 0.44, 2.4, 0.1);
    g.use('emissiveCyan').box(len, 0.05, 0, 0.16, 0.14, 0.25, FACE.all);
    g.tint(1);
    k.collide(len / 2, 0, 0, len / 2, 0.45, 3.5, 'metal', false);
  });

  // Starboard Wing (+X): Inboard stub + Broken outer wing drooping directly onto desert sand
  k.along(3.5, 6.4, wingRootZ, 13.5, 5.7, wingRootZ - 1.7, len => {
    g.use('panel').tint(HULL_OLIVE[0], HULL_OLIVE[1], HULL_OLIVE[2]);
    g.bevel(len / 2, 0, 0, len / 2, 0.44, 3.7, 0.16);
    g.tint(1);
    k.collide(len / 2, 0, 0, len / 2, 0.46, 3.6, 'metal', false);
  });
  g.use('rust').tint(0.55).bevel(13.5, 5.65, wingRootZ - 1.7, 0.6, 0.55, 3.5, 0.08);
  g.tint(1);
  k.along(13.5, 5.6, wingRootZ - 1.7, 28.0, 0.42, wingRootZ - 4.3, len => {
    g.use('panel').tint(HULL_OLIVE[0] * 0.92, HULL_OLIVE[1] * 0.92, HULL_OLIVE[2] * 0.92);
    g.bevel(len / 2, 0, 0, len / 2, 0.36, 3.1, 0.14);
    g.use('paintRed').tint(HULL_STRIPE[0], HULL_STRIPE[1], HULL_STRIPE[2]);
    g.bevel(len - 1.4, 0.05, 0, 1.3, 0.38, 2.2, 0.1);
    g.use('emissiveRed').box(len, 0.1, 0, 0.16, 0.14, 0.25, FACE.all);
    g.tint(1);
    k.collide(len / 2, 0, 0, len / 2, 0.38, 3.0, 'metal', false);
  });
  g.use('dirt').tint(DESERT_PALETTE.sandLight[0], DESERT_PALETTE.sandLight[1], DESERT_PALETTE.sandLight[2]);
  g.bevel(28.2, 0.55, wingRootZ - 4.3, 2.8, 0.55, 3.8, 0.3);
  g.tint(1);

  // --- 7. Four Huge Underwing Turboprop / Jet Nacelles ---
  engineNacelle(k, -10.5, 4.9, wingRootZ + 1.5, 0, 0, false);
  engineNacelle(k, -19.5, 5.4, wingRootZ - 0.7, 0, 0, false);
  engineNacelle(k, 10.5, 4.4, wingRootZ + 1.5, 0.06, -0.08, false);
  engineNacelle(k, 19.8, 2.35, wingRootZ - 1.1, 0.12, -0.34, true);

  // --- 8. Towering Vertical Tail Stabilizer (y = 18.5 m!) + Swept Horizontal Tailplanes (±10.5 m) ---
  const tailBaseZ = RAMP_TOP_Z - 3.6; // -221.6
  k.block('panel', -0.45, 6.6, tailBaseZ - 4.4, 0.45, 10.6, tailBaseZ + 2.8, 0.12, 'metal');
  k.block('panel', -0.38, 10.6, tailBaseZ - 3.2, 0.38, 14.8, tailBaseZ + 3.2, 0.1, 'metal');
  k.block('panel', -0.32, 14.8, tailBaseZ - 1.8, 0.32, 18.5, tailBaseZ + 3.4, 0.1, 'metal');
  g.use('paintRed').tint(HULL_STRIPE[0], HULL_STRIPE[1], HULL_STRIPE[2]);
  g.box(0.41, 15.6, tailBaseZ + 0.8, 0.02, 1.35, 2.4, FACE.px);
  g.box(-0.41, 15.6, tailBaseZ + 0.8, 0.02, 1.35, 2.4, FACE.nx);
  g.use('emissiveRed').cyl(0, 18.5, tailBaseZ + 1.4, 0, 18.95, tailBaseZ + 1.4, 0.24, 0.24, 8, true, true);
  g.tint(1);

  for (const side of [-1, 1] as const) {
    k.along(side * 1.4, 7.3, tailBaseZ + 0.5, side * 10.8, 7.8, tailBaseZ + 2.6, len => {
      g.use('panel').tint(HULL_OLIVE[0], HULL_OLIVE[1], HULL_OLIVE[2]);
      g.bevel(len / 2, 0, 0, len / 2, 0.24, 1.85, 0.08);
      g.tint(1);
    });
  }

  // Minimap plan geometry for the colossal crashed plane silhouette
  spec.plan?.blocks.push(
    { x0: -HALF_W - 0.6, z0: NOSE_BULKHEAD_Z - 8, x1: HALF_W + 0.6, z1: RAMP_TOP_Z },
    { x0: -28, z0: wingRootZ - 6.5, x1: 28, z1: wingRootZ + 3.5 },
  );
  spec.plan?.decks.push({ x0: -HALF_W, z0: NOSE_BULKHEAD_Z, x1: HALF_W, z1: RAMP_BOT_Z });

  // Dramatic warm dawn floodlights washing the rear cargo ramp & towering tail silhouette (2 lights)
  k.light(0, 9.5, RAMP_BOT_Z + 4, DESERT_PALETTE.dawnWarm, 58, 34);
  k.light(0, 14, RAMP_TOP_Z - 6, DESERT_PALETTE.dawnAmber, 44, 28);
}

/**
 * Tier-0 destructible forecourt cover nests strictly OUTSIDE the Cargo Plane hull (`z > -211`),
 * clear of LOUDSPEAKER_POLES (`[±16, 0, -210]`) & clear of the eastern exfil convoy sweep!
 * Also builds dramatic red-sandstone canyon cliffs framing the Plane Basin with a wide 26 m
 * eastern breach exit onto the flat Eastern Convoy Bypass Road!
 */
function buildForecourtAndCanyon(k: Kit, spec: MapSpec): void {
  const nests: readonly [number, number, number, boolean][] = [
    [-22, -206, 0.22, true],
    [-11, -206, 0.15, false],
    [11, -208, -0.15, false],
    [23, -208, -0.22, true],
  ];

  for (let i = 0; i < nests.length; i++) {
    const [x, z, yaw, withDrum] = nests[i]!;
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
        { id: 'sandbags', pos: pt(0, 0.62, 0), half: [2.2, 0.62, 0.42], mat: 'dirt', color: 0x9b8660, hp: 145, tier: 0, anchored: true, kind: 'wall', yaw, materialClass: 'stone' },
        { id: 'crate_l', pos: pt(-1.6, 0.56, -0.75), half: [0.6, 0.56, 0.6], mat: 'plywood', color: 0x987448, hp: 120, tier: 0, anchored: true, kind: 'wall', yaw, materialClass: 'wood' },
        { id: 'crate_r', pos: pt(1.6, 0.56, -0.75), half: [0.6, 0.56, 0.6], mat: 'plywood', color: 0x8d6940, hp: 120, tier: 0, anchored: true, kind: 'wall', yaw, materialClass: 'wood' },
        ...(withDrum
          ? [{ id: 'drum', pos: pt(0.2, 0.56, -0.85), half: [0.42, 0.56, 0.42] as readonly [number, number, number], mat: 'paintRed' as const, color: 0xcc2820, hp: 38, tier: 0 as const, anchored: true, kind: 'hazard' as const, yaw, hazardRadius: 7.5, hazardDamage: 205, materialClass: 'metal' as const }]
          : []),
      ],
      collapseThreshold: 0.5,
    };
    spec.cluster(cluster);
  }

  // Scattered tyre piles & forecourt floodlight masts framing the plane apron (2 lights)
  tyres(k, -28, 0, -212, 3, false);
  tyres(k, 29, 0, -214, 3, false);
  k.mast(-26, -214, 0, 9.0, -0.6, 'orange', 44, 26);
  k.mast(26, -214, 0, 9.0, 0.6, 'orange', 44, 26);

  // Eastern Breach Exfil Beacon guiding the eye toward the wide eastern canyon exit (1 light -> total 8 in plane.ts)
  k.light(36, 6.5, -198, DESERT_PALETTE.dawnAmber, 38, 24);

  // Dramatic Red-Sandstone Canyon Cliffs enclosing the Crashed Plane Basin
  // Leaves a wide 26 m Eastern Breach Exit (`z = -216 .. -190`) onto the Eastern Convoy Bypass Road!
  k.noClimb(() => {
    // West Sandstone Canyon Wall (x = -46, z = -196 .. -278)
    k.wall(-46, -196, -46, -278, 0, 13.5, {
      mat: 'concrete',
      backing: 'concreteDark',
      thick: 3.2,
      bay: 14,
      pilasters: false,
    });
    // North Canyon Backwall behind the crashed Cargo Plane nose (z = -278, x = -46 .. +58)
    k.wall(-46, -278, 58, -278, 0, 15.0, {
      mat: 'concrete',
      backing: 'concreteDark',
      thick: 3.6,
      bay: 16,
      pilasters: false,
    });
    // East Canyon Wall north of the wide Eastern Exfil Breach (x = +46, z = -216 .. -278)
    k.wall(46, -216, 46, -278, 0, 13.5, {
      mat: 'concrete',
      backing: 'concreteDark',
      thick: 3.2,
      bay: 14,
      pilasters: false,
    });
    // Angled canyon turn-out wall guiding the eastern breach smoothly onto the Bypass Road (x = 46..62 at z = -214)
    k.wall(46, -216, 62, -212, 0, 12.0, {
      mat: 'concrete',
      backing: 'concreteDark',
      thick: 2.8,
      bay: 12,
      pilasters: false,
    });
  });

  spec.plan?.walls.push(
    { ax: -46, az: -196, bx: -46, bz: -278, half: 1.6 },
    { ax: -46, az: -278, bx: 58, bz: -278, half: 1.8 },
    { ax: 46, az: -216, bx: 46, bz: -278, half: 1.6 },
  );
}

export function authorDesertPlane(k: Kit, spec: MapSpec): void {
  buildCargoPlaneHull(k, spec);
  buildForecourtAndCanyon(k, spec);
}
