/**
 * Rooftop props & tactical cover:
 *   - Apex Helipad paint & perimeter beacon ring
 *   - Twin industrial Water Towers on Bastion Water-Tower Sniper Deck
 *   - HVAC chiller units, exhaust vents, ductwork, satellite dishes, crates, glass skylights, neon billboards
 *   - Tactical explosive barrels & fuel tanks near bridge approaches
 *
 * Every prop is placed strictly outside STAIRWELL_DOORS, HOVER_DROP_ZONES, PARATROOPER_ZONES, and PICKUP_SPOTS.
 */
import { FACE } from '../../kit/geo';
import type { Kit } from '../../kit/kit';
import { signId, type SignName } from '../../kit/signs';
import type { MapSpec } from '../spec';
import { LV } from './plan';

/** Industrial rooftop HVAC chiller block with fan grilles & side cover collider. */
function hvacUnit(k: Kit, spec: MapSpec, x: number, y: number, z: number, wx: number, wz: number, h = 1.65): void {
  const g = k.geo;
  const hx = wx / 2, hz = wz / 2;
  k.collide(x, y + h / 2, z, hx, h / 2, hz, 'metal');
  g.use('steel').tint(0.76, 0.8, 0.84).bevel(x, y + h / 2, z, hx, h / 2, hz, 0.05);
  g.use('steelDark').tint(0.35).box(x, y + h + 0.03, z, hx * 0.72, 0.04, hz * 0.72, FACE.py);
  g.use('grate').tint(0.55).box(x, y + h * 0.55, z + hz + 0.015, hx * 0.65, h * 0.3, 0.02, FACE.pz);
  g.use('grate').tint(0.55).box(x, y + h * 0.55, z - hz - 0.015, hx * 0.65, h * 0.3, 0.02, FACE.nz);
  g.tint(1);
  spec.plan?.blocks.push({ x0: x - hx, z0: z - hz, x1: x + hx, z1: z + hz });
}

/** Stacked shipping / equipment crates for waist-high & chest-high rooftop gunfight cover. */
function crateCluster(k: Kit, spec: MapSpec, x: number, y: number, z: number, yaw = 0): void {
  k.push(x, y, z, yaw);
  const g = k.geo;
  k.collide(-0.7, 0.65, 0, 0.7, 0.65, 0.7, 'metal');
  g.use('rust').tint(0.84, 0.72, 0.58).bevel(-0.7, 0.65, 0, 0.7, 0.65, 0.7, 0.05);
  k.collide(0.75, 0.55, 0.15, 0.65, 0.55, 0.6, 'metal');
  g.use('steelDark').tint(0.66, 0.72, 0.78).bevel(0.75, 0.55, 0.15, 0.65, 0.55, 0.6, 0.05);
  // Smaller upper crate for standing cover
  k.collide(-0.65, 1.65, -0.05, 0.45, 0.35, 0.45, 'metal');
  g.use('paintYellow').tint(0.85, 0.72, 0.22).bevel(-0.65, 1.65, -0.05, 0.45, 0.35, 0.45, 0.04);
  g.tint(1);
  k.pop();
  spec.plan?.blocks.push({ x0: x - 1.5, z0: z - 0.9, x1: x + 1.5, z1: z + 0.9 });
}

/** Raised glass skylight curb with interior sky-blue glow (great mid-height cover + visual landmark). */
function skylight(k: Kit, spec: MapSpec, x: number, y: number, z: number, wx: number, wz: number): void {
  const g = k.geo;
  const hx = wx / 2, hz = wz / 2;
  k.collide(x, y + 0.55, z, hx, 0.55, hz, 'glass');
  g.use('concreteDark').tint(0.75).box(x, y + 0.25, z, hx, 0.25, hz, FACE.sides);
  g.use('glass').tint(0.78, 0.94, 1.0).box(x, y + 0.8, z, hx - 0.12, 0.32, hz - 0.12, FACE.all);
  g.use('emissiveCyan').tint(0.45).box(x, y + 0.52, z, hx - 0.22, 0.05, hz - 0.22, FACE.py);
  // Steel cross mullions
  g.use('steelDark').tint(0.45);
  g.box(x, y + 1.14, z, hx - 0.08, 0.04, 0.06, FACE.all);
  g.box(x, y + 1.14, z, 0.06, 0.04, hz - 0.08, FACE.all);
  g.tint(1);
  spec.plan?.blocks.push({ x0: x - hx, z0: z - hz, x1: x + hx, z1: z + hz });
}

/** Rooftop satellite dish on steel pedestal (Vanguard & Helios). */
function satelliteDish(k: Kit, x: number, y: number, z: number, yaw: number): void {
  k.push(x, y, z, yaw);
  const g = k.geo;
  k.collide(0, 0.9, 0, 0.55, 0.9, 0.55, 'metal', false);
  g.use('steelDark').tint(0.55).cyl(0, 0, 0, 0, 1.7, 0, 0.35, 0.22, 8, false, true);
  // Tilted dish bowl
  k.push(0, 2.0, 0.1, 0, -0.55, 0);
  g.use('paintWhite').tint(0.88, 0.92, 0.96).lathe([0.05, 0, 0.8, 0.14, 1.5, 0.45, 1.6, 0.52, 1.52, 0.56, 0.75, 0.22, 0.05, 0.08], 0, 0, 0, 14, true);
  g.use('steelDark').cyl(0, 0.08, 0, 0, 1.25, 0, 0.04, 0.03, 6, false, false);
  g.use('emissiveOrange').box(0, 1.32, 0, 0.1, 0.1, 0.1, FACE.all);
  g.tint(1);
  k.pop();
  k.pop();
}

/** Classic rooftop wooden/steel cylindrical water tower tank on steel legs (Bastion Sniper Deck). */
function waterTower(k: Kit, x: number, y: number, z: number): void {
  const g = k.geo;
  // Four short legs elevating tank 1.2 m above deck
  for (const dx of [-1.2, 1.2]) {
    for (const dz of [-1.2, 1.2]) {
      g.use('steelDark').cyl(x + dx, y, z + dz, x + dx, y + 1.4, z + dz, 0.14, 0.14, 6, false, false);
    }
  }
  k.collide(x, y + 2.6, z, 1.75, 2.6, 1.75, 'metal');
  g.use('plywood').tint(0.58, 0.44, 0.32).cyl(x, y + 1.3, z, x, y + 4.9, z, 1.85, 1.85, 14, true, true);
  // Steel hoops
  g.use('steelDark').tint(0.42);
  for (const hy of [1.8, 2.7, 3.6, 4.4]) {
    g.cyl(x, y + hy, z, x, y + hy + 0.12, z, 1.9, 1.9, 14, false, false);
  }
  // Conical steel roof cap
  g.use('steel').tint(0.6).cyl(x, y + 4.9, z, x, y + 6.1, z, 2.0, 0.1, 14, false, true);
  g.tint(1);
}

/** Rooftop neon billboard perched on steel legs as a dramatic skyline landmark. */
function roofBillboard(k: Kit, x: number, y: number, z: number, yaw: number, w: number, h: number, sign: SignName, accent: 'emissiveCyan' | 'emissiveMagenta' | 'emissiveOrange'): void {
  k.push(x, y, z, yaw);
  const g = k.geo;
  const legH = 2.6;
  const cy = legH + h / 2;
  // Support legs
  g.use('steelDark').tint(0.4);
  for (const sx of [-w * 0.38, w * 0.38]) {
    g.box(sx, legH / 2, 0, 0.16, legH / 2, 0.16, FACE.sides);
    g.box(sx, legH / 2, -0.8, 0.1, legH / 2, 0.1, FACE.sides);
    k.collide(sx, legH / 2, 0, 0.2, legH / 2, 0.2, 'metal', false);
  }
  // Board backing + illuminated sign
  k.collide(0, cy, 0, w / 2, h / 2, 0.22, 'metal', false);
  g.use('steelDark').tint(0.28, 0.3, 0.36).bevel(0, cy, 0, w / 2, h / 2, 0.18, 0.04);
  g.use('signs').tint(1);
  const sh = Math.min(h - 0.5, w / 4);
  k.push(0, cy, 0.21, 0);
  g.quadUV(-sh * 2, -sh / 2, 0, sh * 2, sh / 2, signId(sign));
  k.pop();
  g.use(accent).tint(0.95).box(0, legH + h + 0.08, 0.08, w / 2 - 0.1, 0.08, 0.14, FACE.all);
  g.tint(1);
  k.light(0, cy, 2.2, accent === 'emissiveOrange' ? 'orange' : accent === 'emissiveMagenta' ? 'magenta' : 'cyan', 30, 16);
  k.pop();
}

/** Painted Helipad ('H' + yellow circle + cyan perimeter beacons) on Apex Plaza (0, 28, 0). */
function buildHelipad(k: Kit): void {
  const g = k.geo;
  const y = LV.apex + 0.025;
  // Dark asphalt pad octadecagon/square base decal
  g.use('asphalt').tint(0.45).cyl(0, LV.apex, 0, 0, y, 0, 7.6, 7.6, 24, false, true);
  // Yellow landing ring (16 segments)
  const segs = 16;
  g.use('paintYellow').tint(0.95, 0.82, 0.18);
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2;
    const a1 = ((i + 0.72) / segs) * Math.PI * 2;
    const r0 = 6.2, r1 = 6.65;
    g.quad(
      Math.cos(a0) * r0, y + 0.01, Math.sin(a0) * r0,
      Math.cos(a1) * r0, y + 0.01, Math.sin(a1) * r0,
      Math.cos(a1) * r1, y + 0.01, Math.sin(a1) * r1,
      Math.cos(a0) * r1, y + 0.01, Math.sin(a0) * r1,
    );
  }
  // Bold painted 'H'
  g.box(-1.6, y + 0.01, 0, 0.42, 0.01, 2.6, FACE.py);
  g.box(1.6, y + 0.01, 0, 0.42, 0.01, 2.6, FACE.py);
  g.box(0, y + 0.01, 0, 1.6, 0.01, 0.42, FACE.py);
  // 8 glowing perimeter aviation approach lights (flat, no collision)
  g.use('emissiveCyan');
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    g.box(Math.cos(a) * 7.2, y + 0.05, Math.sin(a) * 7.2, 0.2, 0.05, 0.2, FACE.all);
  }
  g.tint(1);
}

export function authorProps(k: Kit, spec: MapSpec): void {
  // --- 1. Apex Plaza (y = 28) ---
  buildHelipad(k);
  skylight(k, spec, 14, LV.apex, -12, 5.4, 3.8);
  skylight(k, spec, -15, LV.apex, 13, 4.6, 4.2);
  hvacUnit(k, spec, 16, LV.apex, -1, 3.4, 2.4);
  hvacUnit(k, spec, -16, LV.helios, -9, 3.2, 2.2); // Cover atop Apex Penthouse!
  crateCluster(k, spec, -7, LV.apex, 15, 0.3);
  crateCluster(k, spec, 8, LV.apex, -14, -0.4);
  spec.barrels(18, LV.apex, 3, 2, 1.0);
  spec.barrels(-18, LV.apex, 5, 2, 1.0);

  // --- 2. Helios Tower (y = 34 & 40) ---
  hvacUnit(k, spec, -14, LV.helios, -38, 3.8, 2.6);
  hvacUnit(k, spec, 15, LV.helios, -60, 3.2, 2.6);
  crateCluster(k, spec, 2, LV.helios, -34.5, 0.2);
  crateCluster(k, spec, -9, LV.helios, -48, 0.5);
  satelliteDish(k, -16, LV.helios, -64, 0.8);
  roofBillboard(k, 0, LV.heliosTop, -63.4, 0, 14, 4.2, 'SOCIETAL COMPLIANCE', 'emissiveCyan');
  spec.barrels(-8, LV.helios, -36, 2, 1.0);

  // --- 3. Foundry Construction (y = 24) ---
  // Stacked steel I-beams & construction material piles
  hvacUnit(k, spec, 64, LV.foundry, -16, 4.0, 2.8);
  crateCluster(k, spec, 39, LV.foundry, -4, 0.4);
  crateCluster(k, spec, 40, LV.foundry, 14, -0.3);
  crateCluster(k, spec, 55, LV.foundry, 14, 0.1);
  // Decorative rebar / stacked beams on south-east edge
  k.ibeam(58, LV.foundry + 0.35, 0, 68, LV.foundry + 0.35, 0, 0.55, 0.45, 'rust', true);
  k.ibeam(58, LV.foundry + 0.35, 1.1, 68, LV.foundry + 0.35, 1.1, 0.55, 0.45, 'rust', true);
  spec.tank(38, LV.foundry, 10);
  spec.barrels(48, LV.foundry, -2, 3, 1.1);

  // --- 4. Meridian Exchange (y = 26 & 36) ---
  hvacUnit(k, spec, -66, LV.meridian, 12, 3.6, 2.8);
  hvacUnit(k, spec, -66, LV.meridian, -15, 3.6, 2.6);
  skylight(k, spec, -44, LV.meridian, 17, 5.2, 3.2);
  crateCluster(k, spec, -38, LV.meridian, 4, 0.2);
  crateCluster(k, spec, -54, LV.meridianTop, -7, 0); // Cover on Meridian Sniper Terrace
  roofBillboard(k, -70.6, LV.meridian, 0, Math.PI / 2, 14, 4.4, 'MORALE IS MONITORED', 'emissiveCyan');
  spec.barrels(-38, LV.meridian, 13, 2, 1.0);

  // --- 5. Bastion South Annex (y = 20 & Water-Tower Deck y = 30) ---
  waterTower(k, -19, LV.vanguard, 58.5);
  waterTower(k, -13, LV.vanguard, 58.5);
  hvacUnit(k, spec, 16, LV.bastion, 38, 4.2, 2.8);
  hvacUnit(k, spec, -4, LV.bastion, 62, 4.0, 2.6);
  crateCluster(k, spec, -2, LV.bastion, 36, 0.25);
  crateCluster(k, spec, 18, LV.bastion, 52, -0.35);
  roofBillboard(k, -16, LV.bastion, 66.8, Math.PI, 12, 3.8, 'NO LOITERING', 'emissiveOrange');
  spec.tank(14, LV.bastion, 44);
  spec.barrels(1, LV.bastion, 38, 2, 1.0);

  // --- 6. Vanguard NW Relay (y = 30) ---
  satelliteDish(k, -59, 38.2, -57.5, 0.6); // Dish atop North Comms Housing!
  satelliteDish(k, -59, 38.2, -46, 1.1);   // Dish atop South Comms Housing!
  satelliteDish(k, -64, LV.vanguard, -38, 0.4);
  hvacUnit(k, spec, -40, LV.vanguard, -62, 3.4, 2.4);
  crateCluster(k, spec, -46, LV.vanguard, -38, -0.3);
  roofBillboard(k, -52, LV.vanguard, -64.8, 0, 12, 4.0, 'COMMS', 'emissiveMagenta');
  spec.barrels(-48, LV.vanguard, -44, 2, 1.0);

  // --- 7. Citadel SE Glass Atrium (y = 22 & Mezzanine y = 28) ---
  skylight(k, spec, 45, LV.citadel, 60, 10.0, 4.2);
  skylight(k, spec, 39, LV.citadel, 37, 4.4, 3.8);
  hvacUnit(k, spec, 63, LV.apex, 54, 3.4, 2.6); // Cover atop Citadel Mezzanine
  crateCluster(k, spec, 40, LV.citadel, 52, 0.35);
  crateCluster(k, spec, 51, LV.citadel, 38, -0.2);
  roofBillboard(k, 68.8, LV.apex, 44, -Math.PI / 2, 12, 3.8, 'THANK YOU FOR YOUR COMPLIANCE', 'emissiveCyan');
  spec.barrels(51, LV.citadel, 52, 2, 1.0);
}
