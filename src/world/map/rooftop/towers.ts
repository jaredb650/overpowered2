/**
 * Skyscraper towers, deep shadowed street chasm, distant decorative city skyline,
 * rooftop penthouses, stairwell bulkheads, walkable skybridges, and perimeter parapets
 * (with intentional lethal fall gaps for parkour and tactical knockback).
 */
import { FACE, type Mat } from '../../kit/geo';
import type { Kit } from '../../kit/kit';
import type { MapSpec } from '../spec';
import {
  BRIDGES, CHASM_Y, LV, STAIRWELL_DOORS, TOWERS,
  type BridgeSpec, type StairwellDoor, type TowerSpec,
} from './plan';

const PARAPET_H = 0.92;
const PARAPET_T = 0.45;
const SLAB_THICK = 1.0;

/** Solid box with collider (axis-aligned from min to max). */
function solidBox(k: Kit, mat: Mat, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, tint?: readonly [number, number, number]): void {
  const g = k.geo.use(mat);
  if (tint) g.tint(tint[0], tint[1], tint[2]);
  g.bevel((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2, 0.04);
  if (tint) g.tint(1);
  k.collide((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2, mat === 'glass' ? 'glass' : mat === 'steel' || mat === 'steelDark' ? 'metal' : 'concrete');
}

/** One skyscraper: walkable rooftop slab, deep non-colliding curtain-wall shaft into the chasm, cornice trim & beacons. */
function buildTower(k: Kit, spec: MapSpec, t: TowerSpec): void {
  const g = k.geo;
  const cx = (t.x0 + t.x1) / 2;
  const cz = (t.z0 + t.z1) / 2;
  const hx = (t.x1 - t.x0) / 2;
  const hz = (t.z1 - t.z0) / 2;

  // Walkable concrete/asphalt rooftop slab with collider.
  k.floor('concrete', t.x0, t.z0, t.x1, t.z1, t.y, SLAB_THICK, 4);
  spec.plan?.fills.push({ x0: t.x0, z0: t.z0, x1: t.x1, z1: t.z1, rgb: t.rgb, label: t.name });

  // Deep skyscraper shaft dropping down into the chasm (visual sides only — no huge redundant colliders below the roof).
  const shaftTop = t.y - SLAB_THICK;
  const shaftH = shaftTop - CHASM_Y;
  const shaftCy = CHASM_Y + shaftH / 2;
  g.use(t.facade).tint(0.62, 0.68, 0.78).box(cx, shaftCy, cz, hx - 0.15, shaftH / 2, hz - 0.15, FACE.sides);
  g.tint(1);

  // Horizontal illuminated window bands and structural mullions down the facade.
  g.use('steelDark').tint(0.45);
  for (let y = shaftTop - 4; y > CHASM_Y + 4; y -= 6) {
    g.box(cx, y, cz, hx + 0.08, 0.22, hz + 0.08, FACE.sides);
  }
  g.tint(1);
  // Glowing curtain-wall spandrel strips every 12 m for depth & scale when looking into the abyss.
  g.use('emissiveDim').tint(0.65, 0.78, 0.92);
  for (let y = shaftTop - 7; y > CHASM_Y + 5; y -= 12) {
    g.box(cx, y, cz, hx - 0.05, 0.55, hz - 0.05, FACE.sides);
  }
  g.tint(1);

  // Upper cornice belt + neon architectural accent around the roof perimeter.
  g.use('steelDark').tint(0.55).box(cx, t.y - 0.45, cz, hx + 0.25, 0.45, hz + 0.25, FACE.sides | FACE.ny);
  g.use(t.accent).tint(0.85).box(cx, t.y - 0.12, cz, hx + 0.28, 0.09, hz + 0.28, FACE.sides);
  g.tint(1);

  // Corner aviation markers.
  for (const sx of [t.x0 + 0.6, t.x1 - 0.6]) {
    for (const sz of [t.z0 + 0.6, t.z1 - 0.6]) {
      g.use('steelDark').box(sx, t.y + 0.6, sz, 0.18, 0.6, 0.18, FACE.sides | FACE.py);
      g.use('emissiveRed').box(sx, t.y + 1.28, sz, 0.12, 0.1, 0.12, FACE.all);
    }
  }
}

/** Parapet segment along X or Z with intentional open gaps for bridges, wall-runs, and lethal fall edges. */
function parapetX(k: Kit, spec: MapSpec, x0: number, x1: number, z: number, y: number): void {
  if (x1 - x0 < 0.8) return;
  solidBox(k, 'concreteDark', x0, y, z - PARAPET_T / 2, x1, y + PARAPET_H, z + PARAPET_T / 2, [0.82, 0.85, 0.9]);
  k.geo.use('steel').tint(0.7).box((x0 + x1) / 2, y + PARAPET_H + 0.05, z, (x1 - x0) / 2, 0.05, PARAPET_T / 2 + 0.05, FACE.all);
  k.geo.tint(1);
  spec.plan?.walls.push({ ax: x0, az: z, bx: x1, bz: z, half: PARAPET_T / 2 });
}

function parapetZ(k: Kit, spec: MapSpec, z0: number, z1: number, x: number, y: number): void {
  if (z1 - z0 < 0.8) return;
  solidBox(k, 'concreteDark', x - PARAPET_T / 2, y, z0, x + PARAPET_T / 2, y + PARAPET_H, z1, [0.82, 0.85, 0.9]);
  k.geo.use('steel').tint(0.7).box(x, y + PARAPET_H + 0.05, (z0 + z1) / 2, PARAPET_T / 2 + 0.05, 0.05, (z1 - z0) / 2, FACE.all);
  k.geo.tint(1);
  spec.plan?.walls.push({ ax: x, az: z0, bx: x, bz: z1, half: PARAPET_T / 2 });
}

/** Paint yellow/black hazard threshold strip at an open lethal drop edge. */
function dropEdgeStrip(k: Kit, ax: number, az: number, bx: number, bz: number, y: number): void {
  k.along(ax, y + 0.015, az, bx, y + 0.015, bz, len => {
    k.geo.use('hazard').box(len / 2, 0, 0, len / 2, 0.015, 0.35, FACE.py);
  });
}

/** Parapets with carved openings at every skybridge, wall-run entry/exit, and tactical lethal fall gap. */
function buildParapets(k: Kit, spec: MapSpec): void {
  // 1. Apex Plaza (x -22..22, z -20..20, y 28)
  const ay = LV.apex;
  parapetX(k, spec, -22, -7.2, -19.75, ay);      // North west of skybridge (-4)
  parapetX(k, spec, -0.8, 8.2, -19.75, ay);      // North between skybridge & wall-run (12)
  parapetX(k, spec, 15.8, 22, -19.75, ay);       // North east corner
  dropEdgeStrip(k, 8.2, -19.6, 15.8, -19.6, ay);

  parapetX(k, spec, -22, -15.5, 19.75, ay);      // South west corner
  parapetX(k, spec, -8.5, 2.8, 19.75, ay);       // South between wall-run (-12) & bridge (6)
  parapetX(k, spec, 9.2, 22, 19.75, ay);         // South east
  dropEdgeStrip(k, -15.5, 19.6, -8.5, 19.6, ay);

  parapetZ(k, spec, -20, -13.5, 21.75, ay);      // East north of wall-run (-10)
  parapetZ(k, spec, -6.5, 2.8, 21.75, ay);       // East between wall-run & bridge (6)
  parapetZ(k, spec, 9.2, 20, 21.75, ay);         // East south
  dropEdgeStrip(k, 21.6, -13.5, 21.6, -6.5, ay);

  parapetZ(k, spec, -20, -11.5, -21.75, ay);     // West north of glass wall-run (-8)
  parapetZ(k, spec, -4.5, 6.8, -21.75, ay);      // West between wall-run & bridge (10)
  parapetZ(k, spec, 13.2, 20, -21.75, ay);       // West south
  dropEdgeStrip(k, -21.6, -11.5, -21.6, -4.5, ay);

  // 2. Helios Tower (x -20..20, z -68..-32, y 34)
  const hy = LV.helios;
  parapetX(k, spec, -20, 20, -67.75, hy);
  parapetX(k, spec, -20, -7.2, -32.25, hy);
  parapetX(k, spec, -0.8, 8.2, -32.25, hy);
  parapetX(k, spec, 15.8, 20, -32.25, hy);
  dropEdgeStrip(k, 8.2, -32.4, 15.8, -32.4, hy);
  parapetZ(k, spec, -68, -49.2, -19.75, hy);     // Gap for Vanguard-Helios bridge (-46)
  parapetZ(k, spec, -42.8, -32, -19.75, hy);
  parapetZ(k, spec, -68, -50, 19.75, hy);
  parapetZ(k, spec, -42, -32, 19.75, hy);        // Intentional east drop gap (-50..-42)
  dropEdgeStrip(k, 19.6, -50, 19.6, -42, hy);

  // 3. Foundry Construction (x 34..72, z -22..20, y 24) — open construction edges with partial guardrails!
  const fy = LV.foundry;
  parapetX(k, spec, 34, 48, -21.75, fy);
  k.rail([48, fy, -21.75, 72, fy, -21.75]);      // Open rail overlook north
  parapetX(k, spec, 34, 48.8, 19.75, fy);        // Gap for Foundry-Citadel bridge (52)
  parapetX(k, spec, 55.2, 72, 19.75, fy);
  parapetZ(k, spec, -22, -13.5, 34.25, fy);      // Gap for Apex wall-run (-10) & bridge (6)
  parapetZ(k, spec, -6.5, 2.8, 34.25, fy);
  parapetZ(k, spec, 9.2, 20, 34.25, fy);
  dropEdgeStrip(k, 34.4, -13.5, 34.4, -6.5, fy);
  parapetZ(k, spec, -22, 2, 71.75, fy);
  parapetZ(k, spec, 10, 20, 71.75, fy);          // Open east drop gap (2..10)
  dropEdgeStrip(k, 71.6, 2, 71.6, 10, fy);

  // 4. Meridian Exchange (x -72..-34, z -22..22, y 26)
  const my = LV.meridian;
  parapetX(k, spec, -72, -57.2, -21.75, my);     // Gap for Meridian-Vanguard bridge (-54) & glass wall-run (-40)
  parapetX(k, spec, -50.8, -43.5, -21.75, my);
  parapetX(k, spec, -36.5, -34, -21.75, my);
  dropEdgeStrip(k, -43.5, -21.6, -36.5, -21.6, my);
  parapetX(k, spec, -72, -58, 21.75, my);
  parapetX(k, spec, -50, -34, 21.75, my);        // Open south drop gap (-58..-50)
  dropEdgeStrip(k, -58, 21.6, -50, 21.6, my);
  parapetZ(k, spec, -22, 22, -71.75, my);
  parapetZ(k, spec, -22, -11.5, -34.25, my);     // Gap for glass wall-run (-8) & bridge (10)
  parapetZ(k, spec, -4.5, 6.8, -34.25, my);
  parapetZ(k, spec, 13.2, 22, -34.25, my);
  dropEdgeStrip(k, -34.4, -11.5, -34.4, -4.5, my);

  // 5. Bastion South Annex (x -24..24, z 32..68, y 20)
  const by = LV.bastion;
  parapetX(k, spec, -24, -15.5, 32.25, by);      // Gap for wall-run (-12) & bridge (6)
  parapetX(k, spec, -8.5, 2.8, 32.25, by);
  parapetX(k, spec, 9.2, 24, 32.25, by);
  dropEdgeStrip(k, -15.5, 32.4, -8.5, 32.4, by);
  parapetX(k, spec, -24, -2, 67.75, by);
  parapetX(k, spec, 8, 24, 67.75, by);           // Open south drop gap (-2..8)
  dropEdgeStrip(k, -2, 67.6, 8, 67.6, by);
  parapetZ(k, spec, 32, 68, -23.75, by);
  parapetZ(k, spec, 32, 44.8, 23.75, by);        // Gap for Bastion-Citadel bridge (48)
  parapetZ(k, spec, 51.2, 68, 23.75, by);

  // 6. Vanguard NW Relay (x -70..-34, z -66..-34, y 30)
  const vy = LV.vanguard;
  parapetX(k, spec, -70, -34, -65.75, vy);
  parapetX(k, spec, -70, -57.2, -34.25, vy);     // Gap for bridge (-54) & glass wall-run (-40)
  parapetX(k, spec, -50.8, -43.5, -34.25, vy);
  parapetX(k, spec, -36.5, -34, -34.25, vy);
  dropEdgeStrip(k, -43.5, -34.4, -36.5, -34.4, vy);
  parapetZ(k, spec, -66, -34, -69.75, vy);
  parapetZ(k, spec, -66, -49.2, -34.25, vy);     // Gap for Vanguard-Helios bridge (-46)
  parapetZ(k, spec, -42.8, -34, -34.25, vy);

  // 7. Citadel SE Atrium (x 34..70, z 32..66, y 22)
  const cy = LV.citadel;
  parapetX(k, spec, 34, 48.8, 32.25, cy);        // Gap for Foundry-Citadel bridge (52)
  parapetX(k, spec, 55.2, 70, 32.25, cy);
  parapetX(k, spec, 34, 52, 65.75, cy);
  parapetX(k, spec, 60, 70, 65.75, cy);          // Open drop gap (52..60)
  dropEdgeStrip(k, 52, 65.6, 60, 65.6, cy);
  parapetZ(k, spec, 32, 44.8, 34.25, cy);        // Gap for Bastion-Citadel bridge (48)
  parapetZ(k, spec, 51.2, 66, 34.25, cy);
  parapetZ(k, spec, 32, 66, 69.75, cy);
}

/** Framed rooftop bulkhead doorway visual + MapSpec gate & MapPlan door registration. */
function addDoorway(k: Kit, spec: MapSpec, d: StairwellDoor): void {
  const g = k.geo;
  const hw = d.width / 2;
  const h = 2.6;
  // Place frame slightly behind threshold (inside bulkhead wall face by 0.65 m).
  const fx = d.x - d.nx * 0.65;
  const fz = d.z - d.nz * 0.65;
  const yaw = Math.atan2(d.nx, d.nz);

  k.push(fx, d.y, fz, yaw);
  // Dark recessed doorway interior backing.
  g.use('steelDark').tint(0.18).box(0, h / 2, -0.05, hw - 0.1, h / 2 - 0.05, 0.12, FACE.pz);
  // Heavy steel doorframe + cyan/orange access beacon above lintel.
  g.use('steelDark').tint(0.5);
  g.box(-hw - 0.14, h / 2, 0.05, 0.14, h / 2, 0.22, FACE.all);
  g.box(hw + 0.14, h / 2, 0.05, 0.14, h / 2, 0.22, FACE.all);
  g.box(0, h + 0.16, 0.05, hw + 0.28, 0.16, 0.22, FACE.all);
  g.use('emissiveOrange').box(0, h + 0.02, 0.28, hw - 0.15, 0.07, 0.04, FACE.all);
  g.tint(1);
  k.pop();

  // Register gate + minimap door.
  spec.gate(d.zone, d.x, d.y, d.z);
  spec.plan?.doors.push({ x: d.x, z: d.z, dx: d.nx, dz: d.nz, w: d.width });
}

/** Penthouses, elevator cores, stairwell bulkheads, walkable upper terraces, and stairs on all 7 towers. */
function buildSuperstructures(k: Kit, spec: MapSpec): void {
  const g = k.geo;
  const blockPlan = (x0: number, z0: number, x1: number, z1: number) => spec.plan?.blocks.push({ x0, z0, x1, z1 });
  const deckPlan = (x0: number, z0: number, x1: number, z1: number) => spec.plan?.decks.push({ x0, z0, x1, z1 });

  // --- 1. Apex Plaza ---
  // NW Mechanical Penthouse (roof y = 34 walkable!)
  solidBox(k, 'panel', -20, LV.apex, -14, -11, LV.helios - 0.5, -4, [0.85, 0.9, 0.96]);
  k.floor('concrete', -20, -14, -11, -4, LV.helios, 0.5, 3);
  deckPlan(-20, -14, -11, -4);
  k.rail([-20, LV.helios, -4, -11, LV.helios, -4, -11, LV.helios, -14]);
  // Walkable stairs on north face up to Apex Penthouse (x -8 -> -20 at z = -15.6, run 12, rise 6, slope 0.50)
  k.stairs(-8, -15.6, LV.apex, -20, -15.6, LV.helios, 2.8, 'steel', true);
  k.floor('steel', -21.2, -17.2, -18, -14, LV.helios, 0.35, 2);
  // SE Stairwell Bulkhead (non-walkable roof y = 32.3, door on west face at x = 12, z = 15)
  solidBox(k, 'concreteDark', 13, LV.apex, 12, 20, LV.apex + 4.3, 18, [0.82, 0.85, 0.9]);
  blockPlan(13, 12, 20, 18);

  // --- 2. Helios Tower ---
  // Upper Corporate Penthouse (roof y = 40 walkable!)
  solidBox(k, 'glass', -12, LV.helios, -64, 10, LV.heliosTop - 0.5, -52, [0.76, 0.88, 0.98]);
  k.floor('concrete', -12, -64, 10, -52, LV.heliosTop, 0.5, 4);
  deckPlan(-12, -64, 10, -52);
  k.rail([-12, LV.heliosTop, -52, 10, LV.heliosTop, -52]);
  // Walkable stairs on east side (z -40 -> -52 at x = 12.5, run 12, rise 6, slope 0.50)
  k.stairs(12.5, -40, LV.helios, 12.5, -52, LV.heliosTop, 3.0, 'steel', true);
  k.floor('steel', 10, -56, 14.2, -52, LV.heliosTop, 0.35, 2);

  // --- 3. Foundry Construction ---
  // Core Lift Bulkhead (y = 24..28.5, door on west face at x = 61, z = 12)
  solidBox(k, 'concrete', 62, LV.foundry, 8, 70, LV.foundry + 4.5, 16, [0.9, 0.86, 0.8]);
  blockPlan(62, 8, 70, 16);

  // --- 4. Meridian Exchange ---
  // Twin Elevator Cores forming dedicated 3.0 m Chimney-Jump Alley (x = -50..-47, z = -14..0, y = 26..36)
  // West Core: x -58..-50, z -14..0, roof y = 36 walkable
  solidBox(k, 'panel', -58, LV.meridian, -14, -50, LV.meridianTop - 0.5, 0, [0.82, 0.88, 0.95]);
  k.floor('concrete', -58, -14, -50, 0, LV.meridianTop, 0.5, 3);
  // East Core: x -47..-39, z -14..0, roof y = 36 walkable
  solidBox(k, 'panel', -47, LV.meridian, -14, -39, LV.meridianTop - 0.5, 0, [0.82, 0.88, 0.95]);
  k.floor('concrete', -47, -14, -39, 0, LV.meridianTop, 0.5, 3);
  // Connecting catwalk across the north end of the chimney (z = -14..-10.5) so chimney mouth (-10.5..0) stays open!
  k.floor('grate', -50, -14, -47, -10.5, LV.meridianTop, 0.3, 2);
  deckPlan(-58, -14, -39, 0);
  // Bright vertical guide strips inside the 3.0 m chimney walls!
  g.use('emissiveCyan');
  for (const z of [-8, -5, -2]) {
    g.box(-49.96, 31, z, 0.04, 4.4, 0.14, FACE.px);
    g.box(-47.04, 31, z, 0.04, 4.4, 0.14, FACE.nx);
  }
  // Walkable 2-flight service stairs up to Meridian Terrace (y 26 -> 31 -> 36)
  k.stairs(-61.5, 2, LV.meridian, -61.5, -8, LV.meridianMid, 3.0, 'steel', true);
  k.floor('steel', -63.2, -17, -59.5, -8, LV.meridianMid, 0.35, 2);
  k.stairs(-60, -15.5, LV.meridianMid, -50, -15.5, LV.meridianTop, 3.0, 'steel', true);
  k.floor('steel', -50, -17.2, -46, -14, LV.meridianTop, 0.35, 2);

  // --- 5. Bastion South Annex ---
  // West & East stairwell bulkheads
  solidBox(k, 'concreteDark', -22, LV.bastion, 34, -15, LV.bastion + 4.3, 41, [0.8, 0.84, 0.88]);
  blockPlan(-22, 34, -15, 41);
  solidBox(k, 'concreteDark', 15, LV.bastion, 58, 22, LV.bastion + 4.3, 65, [0.8, 0.84, 0.88]);
  blockPlan(15, 58, 22, 65);
  // Water-Tower Sniper Deck (x -22..-10, z 48..62, y = 30 walkable, supported on heavy steel legs!)
  k.floor('grate', -22, 48, -10, 62, LV.vanguard, 0.45, 3);
  deckPlan(-22, 48, -10, 62);
  for (const sx of [-21.4, -16, -10.6]) {
    for (const sz of [48.6, 55, 61.4]) {
      k.column(sx, sz, LV.bastion, LV.vanguard - 0.45, 0.65, 'steelDark');
    }
  }
  k.rail([-22, LV.vanguard, 48, -10, LV.vanguard, 48, -10, LV.vanguard, 60]);
  // Walkable 2-flight switchback stairs up to Water-Tower Deck (20 -> 25 -> 30)
  k.stairs(-8.2, 38, LV.bastion, -8.2, 48, LV.bastionMid, 2.8, 'steel', true);
  k.floor('steel', -9.8, 48, -6.6, 52, LV.bastionMid, 0.35, 2);
  k.stairs(-8.2, 52, LV.bastionMid, -8.2, 62, LV.vanguard, 2.8, 'steel', true);
  k.floor('steel', -10.2, 60, -6.6, 63.8, LV.vanguard, 0.35, 2);

  // --- 6. Vanguard NW Relay ---
  // Twin Comms Housings forming Chimney-Jump Alley #2 (z = -53..-50.2 -> 2.8 m gap, x = -66..-52, y = 30..38)
  solidBox(k, 'panel', -66, LV.vanguard, -62, -52, 38.2, -53, [0.85, 0.82, 0.95]);
  solidBox(k, 'panel', -66, LV.vanguard, -50.2, -52, 38.2, -42, [0.85, 0.82, 0.95]);
  blockPlan(-66, -62, -52, -53);
  blockPlan(-66, -50.2, -52, -42);
  g.use('emissiveMagenta');
  for (const x of [-63, -59, -55]) {
    g.box(x, 34, -52.96, 0.14, 3.6, 0.04, FACE.pz);
    g.box(x, 34, -50.24, 0.14, 3.6, 0.04, FACE.nz);
  }

  // --- 7. Citadel SE Atrium ---
  // Mezzanine Observation Gallery (x 58..68, z 34..62, roof y = 28 walkable!)
  solidBox(k, 'glass', 58, LV.citadel, 34, 68, LV.apex - 0.5, 62, [0.76, 0.9, 0.96]);
  k.floor('concrete', 58, 34, 68, 62, LV.apex, 0.5, 3);
  deckPlan(58, 34, 68, 62);
  k.rail([58, LV.apex, 34, 58, LV.apex, 44, 58, LV.apex, 48, 58, LV.apex, 62]);
  // Walkable construction ramp along west face of Mezzanine (z 60 -> 48 at x = 55.6, run 12, rise 6, slope 0.50)
  k.ramp(55.6, 60, LV.citadel, 55.6, 48, LV.apex, 3.4, 'steel', 0.45);
  k.floor('steel', 53.9, 44, 58, 48, LV.apex, 0.35, 2);

  // Place all 10 rooftop stairwell/elevator doors & register gates.
  for (const d of STAIRWELL_DOORS) addDoorway(k, spec, d);
}

/** Walkable skybridges & steel construction catwalks spanning the chasms between all 7 towers. */
function buildBridges(k: Kit, spec: MapSpec): void {
  for (const b of BRIDGES) {
    const mat: Mat = b.style === 'catwalk' ? 'grate' : 'steel';
    k.ramp(b.ax, b.az, b.ay, b.bx, b.bz, b.by, b.width, mat, 0.5);

    // Underside structural Warren truss and visual side rails (rails never have colliders so fast players can vault over!).
    const dx = b.bx - b.ax;
    const dz = b.bz - b.az;
    const len = Math.hypot(dx, dz);
    const nx = -dz / len;
    const nz = dx / len;
    const hw = b.width / 2;

    k.truss(b.ax, b.ay - 1.0, b.az, b.bx, b.by - 1.0, b.bz, 1.3, b.width - 0.4, 'steelDark', 0.1);
    k.rail([b.ax + nx * hw, b.ay, b.az + nz * hw, b.bx + nx * hw, b.by, b.bz + nz * hw], 1.05);
    k.rail([b.ax - nx * hw, b.ay, b.az - nz * hw, b.bx - nx * hw, b.by, b.bz - nz * hw], 1.05);

    // Overhead portal arches on glass skybridges for unmistakable city-skybridge silhouette.
    if (b.style === 'glass') {
      const steps = 3;
      for (let i = 1; i < steps; i++) {
        const f = i / steps;
        const px = b.ax + dx * f;
        const py = b.ay + (b.by - b.ay) * f;
        const pz = b.az + dz * f;
        k.beam(px + nx * hw, py, pz + nz * hw, px + nx * hw, py + 3.4, pz + nz * hw, 0.1, 0.1, 'steelDark');
        k.beam(px - nx * hw, py, pz - nz * hw, px - nx * hw, py + 3.4, pz - nz * hw, 0.1, 0.1, 'steelDark');
        k.beam(px + nx * hw, py + 3.4, pz + nz * hw, px - nx * hw, py + 3.4, pz - nz * hw, 0.1, 0.1, 'steelDark');
      }
      k.stripLine([b.ax, b.ay, b.az, b.bx, b.by, b.bz], 0.16, 'emissiveCyan');
    } else {
      k.stripLine([b.ax + nx * (hw - 0.25), b.ay, b.az + nz * (hw - 0.25), b.bx + nx * (hw - 0.25), b.by, b.bz + nz * (hw - 0.25)], 0.1, 'emissiveOrange');
    }

    // Minimap deck footprint.
    const x0 = Math.min(b.ax, b.bx) - (Math.abs(nx) * hw + 0.2);
    const x1 = Math.max(b.ax, b.bx) + (Math.abs(nx) * hw + 0.2);
    const z0 = Math.min(b.az, b.bz) - (Math.abs(nz) * hw + 0.2);
    const z1 = Math.max(b.az, b.bz) + (Math.abs(nz) * hw + 0.2);
    spec.plan?.decks.push({ x0, z0, x1, z1 });
  }
}

/** Deep dark street chasm floor + glowing street lanes far below killY (non-colliding!) + distant skyline monoliths. */
function buildCityBackdrop(k: Kit): void {
  const g = k.geo;

  // Deep street chasm plane (visual only — zero colliders so falling ragdolls/players never bounce or stall).
  g.use('asphalt').tint(0.18, 0.2, 0.26).quad(-260, CHASM_Y, 260, 260, CHASM_Y, 260, 260, CHASM_Y, -260, -260, CHASM_Y, -260);
  g.tint(1);

  // Glowing distant avenue centerlines & intersections down in the canyon for dizzying vertigo!
  g.use('emissiveOrange').tint(0.55);
  for (const x of [-28, 28]) g.box(x, CHASM_Y + 0.08, 0, 0.45, 0.05, 190, FACE.py);
  for (const z of [-26, 26]) g.box(0, CHASM_Y + 0.08, z, 190, 0.05, 0.45, FACE.py);
  g.use('emissiveWhite').tint(0.45);
  for (const x of [-82, 82]) g.box(x, CHASM_Y + 0.08, 0, 0.35, 0.05, 190, FACE.py);
  for (const z of [-80, 80]) g.box(0, CHASM_Y + 0.08, z, 190, 0.05, 0.35, FACE.py);
  g.tint(1);

  // Decorative distant city skyline ring (strictly outside [-84, 84], no colliders).
  const ring: readonly [number, number, number, number, number, Mat][] = [
    [-128, -118, 26, 24, 62, 'glass'],
    [-76, -124, 24, 22, 54, 'concreteDark'],
    [-18, -132, 30, 24, 72, 'glass'],
    [42, -126, 26, 24, 58, 'panel'],
    [104, -120, 28, 26, 66, 'glass'],
    [130, -56, 24, 28, 60, 'concreteDark'],
    [134, 4, 26, 26, 74, 'glass'],
    [128, 66, 24, 26, 52, 'panel'],
    [108, 122, 28, 24, 64, 'glass'],
    [46, 128, 26, 24, 56, 'concreteDark'],
    [-14, 132, 30, 26, 68, 'glass'],
    [-78, 126, 26, 24, 52, 'panel'],
    [-126, 114, 24, 26, 60, 'concreteDark'],
    [-132, 52, 26, 28, 66, 'glass'],
    [-134, -8, 24, 26, 76, 'glass'],
    [-130, -64, 26, 24, 58, 'panel'],
  ];

  for (const [cx, cz, w, d, topY, mat] of ring) {
    const h = topY - CHASM_Y;
    g.use(mat).tint(0.42, 0.48, 0.58).box(cx, CHASM_Y + h / 2, cz, w / 2, h / 2, d / 2, FACE.sides | FACE.py);
    // Subtle lit horizon window bands & roof aviation light.
    g.use('emissiveDim').tint(0.55, 0.68, 0.85);
    for (let y = topY - 6; y > 4; y -= 11) {
      g.box(cx, y, cz, w / 2 + 0.12, 0.7, d / 2 + 0.12, FACE.sides);
    }
    g.use('emissiveRed').tint(1).box(cx, topY + 2.5, cz, 0.3, 0.3, 0.3, FACE.all);
    g.use('steelDark').box(cx, topY + 1.2, cz, 0.14, 1.2, 0.14, FACE.sides);
  }
  g.tint(1);
}

/** Sunlit outdoor rooftop floodlights & architectural skylight washes so every deck reads crisply. */
function buildOutdoorLighting(k: Kit): void {
  // Broad warm-daylight sky washes over every tower plaza (kept well within light budget).
  const washes: readonly [number, number, number, number, number][] = [
    [0, LV.apex + 12, 0, 140, 44],
    [-12, LV.apex + 10, -10, 90, 32],
    [0, LV.helios + 12, -46, 130, 40],
    [0, LV.heliosTop + 8, -58, 85, 28],
    [52, LV.foundry + 12, 0, 130, 40],
    [-52, LV.meridian + 12, 4, 130, 40],
    [-48, LV.meridianTop + 8, -7, 80, 26],
    [0, LV.bastion + 12, 50, 130, 42],
    [-52, LV.vanguard + 12, -50, 110, 36],
    [52, LV.citadel + 12, 48, 110, 36],
  ];
  for (const [x, y, z, intensity, radius] of washes) {
    k.light(x, y, z, 0xfff3dc, intensity, radius);
  }

  // Tall floodlight masts on corners of key plazas.
  k.mast(-20, 18, LV.apex, 7.5, -Math.PI * 0.25, 'white', 95, 34);
  k.mast(20, -18, LV.apex, 7.5, Math.PI * 0.75, 'white', 95, 34);
  k.mast(18, -34, LV.helios, 7.5, Math.PI * 0.75, 'cyan', 90, 34);
  k.mast(36, -18, LV.foundry, 7.5, -Math.PI * 0.75, 'orange', 95, 34);
  k.mast(-36, 18, LV.meridian, 7.5, Math.PI * 0.25, 'cyan', 90, 34);
  k.mast(20, 34, LV.bastion, 7.5, Math.PI * 0.75, 'white', 90, 34);
}

export function authorTowers(k: Kit, spec: MapSpec): void {
  for (const t of TOWERS) buildTower(k, spec, t);
  buildParapets(k, spec);
  buildSuperstructures(k, spec);
  buildBridges(k, spec);
  buildCityBackdrop(k);
  buildOutdoorLighting(k);
}
