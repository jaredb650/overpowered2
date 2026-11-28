/**
 * OpenMind Skyline (Towers 1-3, z = -156..-12):
 *   - Crisp bright Mirror's Edge daylight white/silver/glass skyscrapers with warm orange parkour sightlines
 *   - Tower 1 (East Spire, y = 52): 1.05 m HVAC vault course, corporate billboard gantry, Canyon Zipline deck
 *   - Tower 2 (Meridian Relay, y = 38): Rescue Gaff crane gantry, safety maintenance ledge, retracted skybridge stub
 *   - Gaff Slingshot Canyon (38 m chasm): 2 suspended orange crane booms + 26 m unbroken glass wall-run facade (22 m gap)
 *   - Tower 3 (Lightwell Tower, y = 38 -> 48.4): PARKOUR.slide closing shutter frame, PARKOUR.stacks.chimney twin-glass
 *     lightwell shaft, and cantilevered HQ Launch Crane aimed straight at OpenMind HQ's 80th-floor glass wall
 *   - Non-colliding chasm street canyon & distant sunlit metropolis backdrop below
 */
import { FACE, type Mat } from '../../kit/geo';
import type { Kit } from '../../kit/kit';
import { signId, type SignName } from '../../kit/signs';
import type { MapSpec } from '../spec';
import {
  CHASM_Y,
  GRAPPLE_ANCHORS,
  LV,
  OFFICE,
  PARKOUR_GEOM,
  TOWER_BY_ID,
  TOWERS,
  ZIPLINES,
  type OpenmindTowerSpec,
} from './plan';

const WHITE: readonly [number, number, number] = [0.95, 0.97, 1.0];
const SILVER: readonly [number, number, number] = [0.82, 0.86, 0.92];
const GLASS_TINT: readonly [number, number, number] = [0.7, 0.88, 0.99];
const ORANGE_PAINT: readonly [number, number, number] = [1.0, 0.42, 0.1];
const GRAPHITE: readonly [number, number, number] = [0.24, 0.28, 0.34];

const PARAPET_H = 0.95;
const PARAPET_T = 0.46;
const SLAB_THICK = 1.0;

/** Sculpted bevelled box with matching collider and optional color tint. */
function solidBevel(
  k: Kit,
  mat: Mat,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  tint?: readonly [number, number, number],
  bev = 0.05,
  vox = true,
): void {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
  const hx = (x1 - x0) / 2, hy = (y1 - y0) / 2, hz = (z1 - z0) / 2;
  const g = k.geo.use(mat);
  if (tint) g.tint(tint[0], tint[1], tint[2]);
  g.bevel(cx, cy, cz, hx, hy, hz, bev);
  if (tint) g.tint(1);
  const surf = mat === 'glass' ? 'glass' : mat === 'steel' || mat === 'steelDark' || mat === 'paintRed' ? 'metal' : 'concrete';
  k.collide(cx, cy, cz, hx, hy, hz, surf, vox);
}

/** Architectural white concrete parapet with chamfered graphite coping rail. */
function parapetX(k: Kit, spec: MapSpec, x0: number, x1: number, z: number, y: number): void {
  if (x1 - x0 < 0.8) return;
  solidBevel(k, 'concrete', x0, y, z - PARAPET_T / 2, x1, y + PARAPET_H, z + PARAPET_T / 2, WHITE, 0.04);
  k.geo.use('steelDark').tint(...GRAPHITE).bevel((x0 + x1) / 2, y + PARAPET_H + 0.05, z, (x1 - x0) / 2, 0.05, PARAPET_T / 2 + 0.04, 0.02);
  k.geo.tint(1);
  spec.plan?.walls.push({ ax: x0, az: z, bx: x1, bz: z, half: PARAPET_T / 2 });
}

function parapetZ(k: Kit, spec: MapSpec, z0: number, z1: number, x: number, y: number): void {
  if (z1 - z0 < 0.8) return;
  solidBevel(k, 'concrete', x - PARAPET_T / 2, y, z0, x + PARAPET_T / 2, y + PARAPET_H, z1, WHITE, 0.04);
  k.geo.use('steelDark').tint(...GRAPHITE).bevel(x, y + PARAPET_H + 0.05, (z0 + z1) / 2, PARAPET_T / 2 + 0.04, 0.05, (z1 - z0) / 2, 0.02);
  k.geo.tint(1);
  spec.plan?.walls.push({ ax: x, az: z0, bx: x, bz: z1, half: PARAPET_T / 2 });
}

/** High-contrast orange/hazard launch strip along a parkour drop edge. */
function launchEdgeStrip(k: Kit, ax: number, az: number, bx: number, bz: number, y: number): void {
  k.along(ax, y + 0.018, az, bx, y + 0.018, bz, len => {
    k.geo.use('paintRed').tint(...ORANGE_PAINT).box(len / 2, 0, 0, len / 2, 0.018, 0.36, FACE.py);
    k.geo.use('emissiveOrange').tint(0.95).box(len / 2, 0.012, 0.24, len / 2, 0.01, 0.07, FACE.py);
    k.geo.tint(1);
  });
}

/** Mounted architectural sign panel facing local +Z at (x, y, z) turned by `yaw`. */
function mountSign(k: Kit, x: number, y: number, z: number, yaw: number, name: SignName, w = 3.2): void {
  const h = w / 4;
  k.push(x, y, z, yaw);
  k.geo.use('steelDark').tint(...GRAPHITE).bevel(0, 0, -0.04, w / 2 + 0.08, h / 2 + 0.08, 0.05, 0.02);
  k.geo.tint(1).use('signs').quadUV(-w / 2, -h / 2, 0.02, w / 2, h / 2, signId(name));
  k.pop();
}

const CORE_SLATE: readonly [number, number, number] = [0.16, 0.23, 0.32];
const WARM_OFFICE: readonly [number, number, number] = [0.92, 0.84, 0.7];
const COOL_OFFICE: readonly [number, number, number] = [0.54, 0.66, 0.78];

/** Sculpted Mirror's Edge skyscraper shaft beneath Towers 1-3 (visual sides only, walkable rooftop slab). */
function buildSkylineTowerShell(k: Kit, spec: MapSpec, t: OpenmindTowerSpec): void {
  const g = k.geo;
  const cx = (t.x0 + t.x1) / 2;
  const cz = (t.z0 + t.z1) / 2;
  const hx = (t.x1 - t.x0) / 2;
  const hz = (t.z1 - t.z0) / 2;

  // Bright crisp white rooftop slab with clean collider.
  g.use('concrete').tint(...WHITE);
  g.slab(cx, t.y - SLAB_THICK / 2, cz, hx, SLAB_THICK / 2, hz, 4, FACE.all);
  g.tint(1);
  k.collide(cx, t.y - SLAB_THICK / 2, cz, hx, SLAB_THICK / 2, hz, 'concrete');
  spec.plan?.fills.push({ x0: t.x0, z0: t.z0, x1: t.x1, z1: t.z1, rgb: t.rgb, label: t.name });

  // Clean decorative white roof tiles grid inset.
  g.use('tile').tint(0.92, 0.95, 0.99).slab(cx, t.y + 0.012, cz, hx - 0.8, 0.01, hz - 0.8, 4, FACE.py);
  g.tint(1);

  // Solid opaque recessed architectural interior core behind the reflective curtain wall (ZERO see-through void!).
  const shaftTop = t.y - SLAB_THICK;
  const shaftH = shaftTop - CHASM_Y;
  const shaftCy = CHASM_Y + shaftH / 2;
  const coreHx = Math.max(2, hx - 0.95);
  const coreHz = Math.max(2, hz - 0.95);
  g.use('panel').tint(...CORE_SLATE).box(cx, shaftCy, cz, coreHx, shaftH / 2, coreHz, FACE.sides);

  // Segmented warm/cool dusk office window bays on the recessed core visible behind the glazing!
  for (let y = shaftTop - 4.0, fi = 0; y > CHASM_Y + 6; y -= 5.5, fi++) {
    for (let bi = -1; bi <= 1; bi++) {
      if (((fi * 3 + bi + 4) & 3) === 0) continue; // Organic unlit office rooms
      const warm = ((fi + bi + 2) & 1) === 0;
      g.use(warm ? 'emissiveDim' : 'screen').tint(...(warm ? WARM_OFFICE : COOL_OFFICE));
      const bx = cx + bi * (coreHx * 0.56);
      const bz = cz + bi * (coreHz * 0.56);
      g.box(bx, y - 1.5, cz + coreHz + 0.08, coreHx * 0.21, 0.85, 0.02, FACE.pz);
      g.box(bx, y - 1.5, cz - coreHz - 0.08, coreHx * 0.21, 0.85, 0.02, FACE.nz);
      g.box(cx + coreHx + 0.08, y - 1.5, bz, 0.02, 0.85, coreHz * 0.21, FACE.px);
      g.box(cx - coreHx - 0.08, y - 1.5, bz, 0.02, 0.85, coreHz * 0.21, FACE.nx);
    }
  }

  // Deep reflective blue-glass exterior curtain wall over the opaque core.
  g.use('glass').tint(...GLASS_TINT).box(cx, shaftCy, cz, hx - 0.18, shaftH / 2, hz - 0.18, FACE.sides);

  // White structural corner fins & floor spandrel bands for crisp modernist skyscraper silhouette.
  g.use('concrete').tint(...WHITE);
  for (const sx of [t.x0 + 0.5, t.x1 - 0.5]) {
    for (const sz of [t.z0 + 0.5, t.z1 - 0.5]) {
      g.box(sx, shaftCy, sz, 0.6, shaftH / 2, 0.6, FACE.sides);
    }
  }
  for (let y = shaftTop - 4; y > CHASM_Y + 4; y -= 5.5) {
    g.box(cx, y, cz, hx + 0.1, 0.38, hz + 0.1, FACE.sides);
  }
  // Vertical aluminum mullions on all 4 faces.
  g.use('steel').tint(...SILVER);
  for (let mx = t.x0 + 4.5; mx <= t.x1 - 4.5; mx += 4.5) {
    g.box(mx, shaftCy, t.z1 - 0.06, 0.1, shaftH / 2, 0.12, FACE.pz | FACE.px | FACE.nx);
    g.box(mx, shaftCy, t.z0 + 0.06, 0.1, shaftH / 2, 0.12, FACE.nz | FACE.px | FACE.nx);
  }
  for (let mz = t.z0 + 4.5; mz <= t.z1 - 4.5; mz += 4.5) {
    g.box(t.x0 + 0.06, shaftCy, mz, 0.12, shaftH / 2, 0.1, FACE.nx | FACE.pz | FACE.nz);
    g.box(t.x1 - 0.06, shaftCy, mz, 0.12, shaftH / 2, 0.1, FACE.px | FACE.pz | FACE.nz);
  }
  // Upper cornice collar + crisp glowing cyan/orange accent strip.
  g.use('steel').tint(...SILVER).bevel(cx, t.y - 0.45, cz, hx + 0.24, 0.45, hz + 0.24, 0.06);
  g.use(t.accent).tint(0.95).box(cx, t.y - 0.12, cz, hx + 0.28, 0.08, hz + 0.28, FACE.sides);
  g.tint(1);
}

/** Sculpted HVAC chiller unit (1.05 m tall, 1.4 m deep) with warm orange parkour vault lip. */
function buildHvacVault(k: Kit, x: number, y: number, z: number, depth: number, width: number, height: number): void {
  const g = k.geo;
  const hx = depth / 2;
  const hz = width / 2;
  // Main white-silver steel chiller housing.
  solidBevel(k, 'panel', x, y, z - hz, x + depth, y + height - 0.08, z + hz, SILVER, 0.05);
  // Chamfered warm-orange top vault cap (exact top at y + height = y + 1.05 m).
  solidBevel(k, 'paintRed', x - 0.04, y + height - 0.08, z - hz - 0.04, x + depth + 0.04, y + height, z + hz + 0.04, ORANGE_PAINT, 0.025);
  // Recessed fan shrouds & side intake louvres (visual detail).
  g.use('steelDark').tint(...GRAPHITE);
  for (const dz of [-hz * 0.48, hz * 0.48]) {
    g.cyl(x + hx, y + height, z + dz, x + hx, y + height + 0.025, z + dz, 0.42, 0.42, 12);
  }
  for (let lz = z - hz + 0.4; lz <= z + hz - 0.4; lz += 0.45) {
    g.box(x - 0.02, y + height * 0.48, lz, 0.02, height * 0.28, 0.12, FACE.nx);
    g.box(x + depth + 0.02, y + height * 0.48, lz, 0.02, height * 0.28, 0.12, FACE.px);
  }
  g.tint(1);
}

/** Sculpted A-frame zipline anchor gantry with pulley head and pulsing orange/cyan sightline. */
function buildZiplinePylon(k: Kit, x: number, baseY: number, z: number, headY: number, yaw: number): void {
  const g = k.geo;
  const h = headY - baseY;
  k.push(x, baseY, z, yaw);
  // Stepped steel plinth.
  g.use('steelDark').tint(...GRAPHITE).bevel(0, 0.22, 0, 1.35, 0.22, 0.65, 0.05);
  // Twin angled orange A-frame legs rising above pulley head.
  g.use('paintRed').tint(...ORANGE_PAINT);
  k.beam(-1.05, 0.35, 0, -0.55, h + 1.4, 0, 0.16, 0.16, 'paintRed', false);
  k.beam(1.05, 0.35, 0, 0.55, h + 1.4, 0, 0.16, 0.16, 'paintRed', false);
  g.use('paintRed').tint(...ORANGE_PAINT).bevel(0, h + 1.35, 0, 0.95, 0.18, 0.28, 0.04);
  // Pulley housing & glowing cyan entry ring.
  g.use('steelDark').tint(...GRAPHITE).bevel(0, h, 0, 0.36, 0.22, 0.32, 0.03);
  g.use('emissiveCyan').tint(1).box(0, h + 0.85, 0.18, 0.62, 0.07, 0.06, FACE.all);
  g.use('emissiveOrange').tint(1).box(-0.85, h * 0.55, 0.18, 0.08, h * 0.42, 0.04, FACE.all);
  g.use('emissiveOrange').tint(1).box(0.85, h * 0.55, 0.18, 0.08, h * 0.42, 0.04, FACE.all);
  g.tint(1);
  k.pop();
}

/** Tower 1: East Spire insertion roof, HVAC vaults, billboard gantry & Canyon Zipline start. */
function buildTower1(k: Kit, spec: MapSpec): void {
  const t = TOWER_BY_ID.tower1;
  const y = t.y; // 52

  // Parapets on N, W, S; open east launch drop along z = -144..-128.
  parapetX(k, spec, t.x0, t.x1, t.z0 + 0.24, y);
  parapetX(k, spec, t.x0, t.x1, t.z1 - 0.24, y);
  parapetZ(k, spec, t.z0, t.z1, t.x0 + 0.24, y);
  parapetZ(k, spec, t.z0, -144, t.x1 - 0.24, y);
  parapetZ(k, spec, -128, t.z1, t.x1 - 0.24, y);
  launchEdgeStrip(k, t.x1 - 0.35, -144, t.x1 - 0.35, -128, y);

  // Sculpted mechanical penthouse behind spawn (NW corner) for clean Mirror's Edge silhouette & cover.
  solidBevel(k, 'concrete', -100, y, -152, -91, y + 4.4, -148.5, WHITE, 0.06);
  k.geo.use('glass').tint(...GLASS_TINT).box(-95.5, y + 2.4, -148.45, 3.6, 1.2, 0.05, FACE.pz);
  k.geo.use('emissiveOrange').tint(0.9).box(-95.5, y + 4.5, -148.5, 4.6, 0.08, 1.8, FACE.sides);
  k.geo.tint(1);
  spec.plan?.blocks.push({ x0: -100, z0: -152, x1: -91, z1: -148.5 });

  // 3 HVAC Vault Units along the sprint sightline from spawn (-94, -146) -> zipline (-68, -136).
  for (const h of PARKOUR_GEOM.hvacVaults) {
    buildHvacVault(k, h.x - h.depth / 2, h.y, h.z, h.depth, h.width, h.height);
    spec.plan?.blocks.push({ x0: h.x - h.depth / 2, z0: h.z - h.width / 2, x1: h.x + h.depth / 2, z1: h.z + h.width / 2 });
  }

  // Painted orange runner sightline stripe guiding player straight through vaults to the zipline deck.
  k.stripLine([-93, y + 0.02, -145.5, -68, y + 0.02, -136], 0.38, 'emissiveOrange');

  // Overhead Corporate Billboard Gantry on Tower 1's SE flank (pure skyline branding + cover pillars).
  k.column(-74, -127, y, y + 7.2, 0.65, 'steelDark');
  k.column(-68, -127, y, y + 7.2, 0.65, 'steelDark');
  k.truss(-75, y + 6.4, -127, -67, y + 6.4, -127, 1.2, 0.8, 'steelDark', 0.09);
  k.geo.use('steelDark').tint(...GRAPHITE).bevel(-71, y + 9.2, -127, 5.4, 1.9, 0.28, 0.05);
  k.geo.use('emissiveCyan').tint(0.9).box(-71, y + 11.2, -127, 5.2, 0.08, 0.32, FACE.all);
  k.geo.tint(1);
  mountSign(k, -71, y + 9.2, -127.32, Math.PI, 'SMILE: YOU ARE BEING AUDITED', 8.8);
  mountSign(k, -71, y + 9.2, -126.68, 0, 'COMPLIANCE IS MANDATORY', 8.8);

  // Canyon Zipline start pylon at (-68, 52, -136) pointing toward Tower 2 (-8, 38, -112).
  // The cable itself is rendered and snapped dynamically by `ZiplineManager` (`zipline.ts`).
  const zip = ZIPLINES[0]!;
  const zipYaw = Math.atan2(zip.end[0] - zip.start[0], zip.end[2] - zip.start[2]);
  buildZiplinePylon(k, zip.start[0], y, zip.start[2], zip.start[1], zipYaw);
  mountSign(k, zip.start[0] - 0.6, y + 3.8, zip.start[2] - 2.6, Math.PI / 2, 'LAUNCH', 2.6);
}

/** Tower 2: Meridian Relay Deck, Rescue Gaff Crane, Lower Safety Ledge, Retracted Skybridge Stub & Wall-Run Lip. */
function buildTower2(k: Kit, spec: MapSpec): void {
  const t = TOWER_BY_ID.tower2;
  const y = t.y; // 38

  // Parapets with open west zipline landing (-118..-106), open safety stair exit (-124..-119), and open south canyon edge.
  parapetX(k, spec, t.x0, t.x1, t.z0 + 0.24, y);
  parapetZ(k, spec, t.z0, t.z1, t.x1 - 0.24, y);
  parapetZ(k, spec, -106, t.z1, t.x0 + 0.24, y);
  parapetX(k, spec, t.x0, -4, t.z1 - 0.24, y);
  parapetX(k, spec, 14, t.x1, t.z1 - 0.24, y);
  launchEdgeStrip(k, -4, t.z1 - 0.35, 13.5, t.z1 - 0.35, y);

  // Zipline end pylon on west landing (-8, 38, -112).
  const zip = ZIPLINES[0]!;
  const zipYaw = Math.atan2(zip.start[0] - zip.end[0], zip.start[2] - zip.end[2]);
  buildZiplinePylon(k, zip.end[0], y, zip.end[2], zip.end[1], zipYaw);

  // Tower 2 Rescue Crane (Gaff Grapple Anchor #1: hangs at x = -16..-6, y = 46, z = -113).
  const anchor = GRAPPLE_ANCHORS[0]!;
  k.truss(-6, y, -113, -6, 51, -113, 1.8, 1.8, 'paintRed', 0.12);
  k.collide(-6, y + 6.5, -113, 0.95, 6.5, 0.95, 'metal', false);
  const [bx0, by0, bz0, bx1, by1, bz1] = anchor.beam;
  solidBevel(k, 'paintRed', bx0, by0, bz0, bx1, by1, bz1, ORANGE_PAINT, 0.06, false);
  k.truss(bx0, by1 + 0.65, -113, 2, by1 + 0.65, -113, 1.3, 1.2, 'paintRed', 0.09);
  k.beam(-6, 50.8, -113, bx0 + 0.6, by1 + 1.2, -113, 0.05, 0.05, 'steelDark');
  k.geo.use('emissiveOrange').tint(1).box((bx0 + bx1) / 2, by0 - 0.06, -113, (bx1 - bx0) / 2 - 0.2, 0.08, 0.55, FACE.all);
  k.geo.tint(1);

  // Safety Maintenance Ledge below Tower 2 west face (y = 31) + walkable recovery stair back up to y = 38.
  k.floor('grate', -15, -119, -10, -107, LV.tower2Ledge, 0.35, 2);
  k.rail([-15, LV.tower2Ledge, -107, -15, LV.tower2Ledge, -119]);
  k.stairs(-12.5, -107, LV.tower2Ledge, -12.5, -121, y, 2.6, 'steel', true);
  k.floor('steel', -14, -124, -10, -121, y, 0.35, 2);
  spec.plan?.decks.push({ x0: -15, z0: -119, x1: -10, z1: -107 });

  // Modernist rooftop skylight prism & relay shelter on east side (cover against Pursuit Runners).
  solidBevel(k, 'concrete', 13, y, -118, 21, y + 3.2, -106, WHITE, 0.06);
  k.geo.use('glass').tint(...GLASS_TINT).bevel(17, y + 3.55, -112, 3.6, 0.35, 5.4, 0.04);
  k.geo.use('emissiveCyan').tint(0.85).box(12.95, y + 2.4, -112, 0.05, 0.08, 5.2, FACE.nx);
  k.geo.tint(1);
  spec.plan?.blocks.push({ x0: 13, z0: -118, x1: 21, z1: -106 });

  // Low vaultable AC cover banks on Tower 2 deck.
  buildHvacVault(k, 2, y, -115, 1.4, 3.4, 1.05);
  buildHvacVault(k, 5, y, -103, 1.4, 3.4, 1.05);

  // Retracted Skybridge Stub at south lip (x = 2, z = -96): sheared steel girders + GAP AHEAD sign.
  for (const sx of [-0.5, 4.5]) {
    k.ibeam(sx, y - 0.25, -96, sx, y - 0.25, -92.5, 0.45, 0.32, 'steelDark', false);
  }
  k.geo.use('hazard').box(2, y + 0.02, -96.5, 3.2, 0.02, 0.4, FACE.py);
  mountSign(k, 2, y + 2.6, -96.2, Math.PI, 'GAP AHEAD', 3.4);

  // East Wall-Run Launch Finger Deck extending south to z = -88 (gives exact 22 m wall-run gap to z = -66!).
  const wrNear = PARKOUR_GEOM.canyon.wallRunNearLipZ; // -88
  k.floor('steel', 8.5, -96, 13.4, wrNear, y, 0.45, 2);
  k.truss(10.9, y - 0.9, -96, 10.9, y - 0.9, wrNear, 1.1, 3.8, 'steelDark', 0.09);
  launchEdgeStrip(k, 8.6, wrNear - 0.3, 13.3, wrNear - 0.3, y);
  spec.plan?.decks.push({ x0: 8.5, z0: -96, x1: 13.4, z1: wrNear });
}

/** Gaff Slingshot Canyon: 2 suspended orange crane booms (y=46, y=48) + 26 m unbroken glass wall-run facade. */
function buildGaffCanyon(k: Kit): void {
  const g = k.geo;

  // Flanking crane support towers (outside the chasm play corridor) carrying Booms #1 and #2.
  const boom1 = GRAPPLE_ANCHORS[1]!; // z = -84, y = 46, beam x: -16..12
  const boom2 = GRAPPLE_ANCHORS[2]!; // z = -69, y = 48, beam x: 2..30

  // West crane tower & Boom #1
  k.truss(-19, CHASM_Y + 20, -84, -19, 54, -84, 2.4, 2.4, 'steelDark', 0.14);
  solidBevel(k, 'paintRed', ...boom1.beam, ORANGE_PAINT, 0.06, false);
  k.truss(boom1.beam[0], boom1.beam[4] + 0.75, -84, boom1.beam[3], boom1.beam[4] + 0.75, -84, 1.4, 1.2, 'paintRed', 0.1);
  k.beam(-19, 53.6, -84, 10, boom1.beam[4] + 1.35, -84, 0.06, 0.06, 'steelDark');
  g.use('emissiveOrange').tint(1).box(4, boom1.beam[1] - 0.06, -84, 8.5, 0.09, 0.55, FACE.all);
  g.tint(1);

  // East crane tower & Boom #2
  k.truss(33, CHASM_Y + 20, -69, 33, 56, -69, 2.4, 2.4, 'steelDark', 0.14);
  solidBevel(k, 'paintRed', ...boom2.beam, ORANGE_PAINT, 0.06, false);
  k.truss(boom2.beam[0], boom2.beam[4] + 0.75, -69, boom2.beam[3], boom2.beam[4] + 0.75, -69, 1.4, 1.2, 'paintRed', 0.1);
  k.beam(33, 55.6, -69, 4, boom2.beam[4] + 1.35, -69, 0.06, 0.06, 'steelDark');
  g.use('emissiveOrange').tint(1).box(8, boom2.beam[1] - 0.06, -69, 8.5, 0.09, 0.55, FACE.all);
  g.tint(1);

  // 26 m unbroken vertical Glass Wall-Run Facade on east edge of canyon (z = -90..-64, x = 13.5..14.1).
  const p = PARKOUR_GEOM.canyon.wallRunPanel;
  const cx = (p.x0 + p.x1) / 2, cy = (p.y0 + p.y1) / 2, cz = (p.z0 + p.z1) / 2;
  const hx = (p.x1 - p.x0) / 2, hy = (p.y1 - p.y0) / 2, hz = (p.z1 - p.z0) / 2;

  // Single unbroken glass collider so wall-runs never catch on any seam!
  k.collide(cx, cy, cz, hx, hy, hz, 'glass', false);

  g.use('glass').tint(...GLASS_TINT).box(cx, cy, cz, hx, hy, hz, FACE.all);
  g.use('steelDark').tint(...GRAPHITE);
  g.bevel(cx, p.y1 + 0.12, cz, hx + 0.1, 0.14, hz + 0.08, 0.03);
  g.bevel(cx, p.y0 - 0.12, cz, hx + 0.1, 0.14, hz + 0.08, 0.03);
  for (let z = p.z0 + 0.5; z <= p.z1 - 0.4; z += 3.2) {
    g.box(cx, cy, z, hx + 0.04, hy, 0.06, FACE.sides);
  }
  // Vivid orange wall-run sightline runner strips on the west runnable face.
  g.use('emissiveOrange').tint(1).box(p.x0 - 0.03, LV.tower2 + 1.4, cz, 0.03, 0.12, hz - 0.3, FACE.nx);
  g.use('emissiveCyan').tint(0.9).box(p.x0 - 0.03, LV.tower2 + 3.4, cz, 0.03, 0.08, hz - 0.3, FACE.nx);
  g.tint(1);
  // Structural steel truss backing behind the glass billboard (east side, clear of runnable face).
  k.truss(p.x1 + 0.65, LV.tower2 + 1.5, p.z0 + 1, p.x1 + 0.65, LV.tower2 + 1.5, p.z1 - 1, 2.2, 0.9, 'steelDark', 0.1);
  mountSign(k, p.x0 - 0.05, LV.tower2 + 4.8, cz, -Math.PI / 2, 'WALL RUN', 6.4);
  k.light(p.x0 - 2.2, LV.tower2 + 3.5, cz, 'orange', 34, 22);
}

/** Tower 3: Catch deck, PARKOUR.slide shutter pavilion, twin-glass chimney, and HQ Launch Crane. */
function buildTower3(k: Kit, spec: MapSpec): void {
  const t = TOWER_BY_ID.tower3;
  const y = t.y; // 38
  const sh = PARKOUR_GEOM.shutter;
  const ch = PARKOUR_GEOM.chimney;
  const lc = PARKOUR_GEOM.launchCrane;

  // East Wall-Run Catch Finger Deck extending north to z = -66 (exact 22 m gap from z = -88!).
  const wrFar = PARKOUR_GEOM.canyon.wallRunFarLipZ; // -66
  k.floor('steel', 8.5, wrFar, 13.4, -58, y, 0.45, 2);
  k.truss(10.9, y - 0.9, wrFar, 10.9, y - 0.9, -58, 1.1, 3.8, 'steelDark', 0.09);
  launchEdgeStrip(k, 8.6, wrFar + 0.3, 13.3, wrFar + 0.3, y);
  spec.plan?.decks.push({ x0: 8.5, z0: wrFar, x1: 13.4, z1: -58 });

  // Perimeter parapets around north deck (open north catch edge x = -6..13.5).
  parapetX(k, spec, t.x0, -6, t.z0 + 0.24, y);
  parapetX(k, spec, 13.5, t.x1, t.z0 + 0.24, y);
  parapetZ(k, spec, t.z0, sh.z, t.x0 + 0.24, y);
  parapetZ(k, spec, t.z0, sh.z, t.x1 - 0.24, y);

  // Painted orange runway stripe along x = 0 from z = -57 to z = -35 (exact 22 m trigger run-up!).
  k.stripLine([0, y + 0.02, -57, 0, y + 0.02, sh.z + 2], 0.42, 'emissiveOrange');

  // --- Closing Armored Roof Shutter Pavilion (z = -35, opening x: -2.2..+2.2, y: 38..41.6) ---
  const shHalfW = sh.width / 2; // 2.2
  const pavTopY = y + 7.4;      // 45.4
  // West & East full-height white/glass barrier walls so nobody runs around the shutter.
  solidBevel(k, 'concrete', t.x0, y, sh.z - 0.4, -shHalfW, pavTopY, sh.z + 0.4, WHITE, 0.05);
  solidBevel(k, 'concrete', shHalfW, y, sh.z - 0.4, t.x1, pavTopY, sh.z + 0.4, WHITE, 0.05);
  // Heavy shutter lintel starting at exact y + PARKOUR.slide.doorHeight (38 + 3.6 = 41.6)!
  solidBevel(k, 'steelDark', -shHalfW, y + sh.height, sh.z - 0.45, shHalfW, pavTopY, sh.z + 0.45, GRAPHITE, 0.05);
  // Orange illuminated shutter frame jambs & threshold chevron.
  k.geo.use('emissiveOrange').tint(1);
  k.geo.box(-shHalfW - 0.08, y + sh.height / 2, sh.z - 0.46, 0.08, sh.height / 2, 0.05, FACE.all);
  k.geo.box(shHalfW + 0.08, y + sh.height / 2, sh.z - 0.46, 0.08, sh.height / 2, 0.05, FACE.all);
  k.geo.box(0, y + sh.height + 0.08, sh.z - 0.48, shHalfW + 0.16, 0.08, 0.05, FACE.all);
  k.geo.use('hazard').box(0, y + 0.02, sh.z, sh.width, 0.02, 1.2, FACE.py);
  k.geo.tint(1);
  mountSign(k, 0, y + sh.height + 1.2, sh.z - 0.5, Math.PI, 'SLIDE', 2.8);
  mountSign(k, -6.5, y + 3.8, sh.z - 0.46, Math.PI, 'BLAST DOOR', 3.4);
  spec.plan?.doors.push({ x: sh.x, z: sh.z, dx: 0, dz: 1, w: sh.width });

  // Side enclosure walls south of the shutter pavilion (x = -12 and x = +22) to funnel into the chimney.
  solidBevel(k, 'glass', t.x0, y, sh.z + 0.4, t.x0 + 0.6, pavTopY, t.z1, GLASS_TINT, 0.03);
  solidBevel(k, 'glass', t.x1 - 0.6, y, sh.z + 0.4, t.x1, pavTopY, t.z1, GLASS_TINT, 0.03);

  // --- Twin-Glass Lightwell Chimney (PARKOUR.stacks.chimney: width = 1.5 m, rise = 5.2 m x 2 -> 48.4 m) ---
  // Climbable frosted-glass chimney liners at inner faces x = -0.75 and x = +0.75 (smooth single colliders).
  solidBevel(k, 'glass', ch.x0 - 0.22, ch.baseY, ch.z0, ch.x0, ch.topY, ch.z1, GLASS_TINT, 0.02, false);
  solidBevel(k, 'glass', ch.x1, ch.baseY, ch.z0, ch.x1 + 0.22, ch.topY, ch.z1, GLASS_TINT, 0.02, false);

  // Glowing vertical orange climb-guide stripes inside the 1.5 m chimney shaft.
  k.geo.use('emissiveOrange').tint(1);
  for (const cz of [ch.z0 + 0.9, (ch.z0 + ch.z1) / 2, ch.z1 - 0.9]) {
    k.geo.box(ch.x0 + 0.02, (ch.baseY + ch.topY) / 2, cz, 0.02, (ch.topY - ch.baseY) / 2 - 0.4, 0.09, FACE.px);
    k.geo.box(ch.x1 - 0.02, (ch.baseY + ch.topY) / 2, cz, 0.02, (ch.topY - ch.baseY) / 2 - 0.4, 0.09, FACE.nx);
  }
  k.geo.tint(1);

  // Outer structural tower halves flanking the chimney (refuse climb on outer faces so the chimney is required!).
  k.noClimb(() => {
    solidBevel(k, 'concrete', -10, ch.baseY, ch.z0, ch.x0 - 0.22, ch.topY - 0.45, t.z1, WHITE, 0.06);
    solidBevel(k, 'concrete', ch.x1 + 0.22, ch.baseY, ch.z0, 10, ch.topY - 0.45, t.z1, WHITE, 0.06);
    // Back (south) wall of the chimney shaft (z = ch.z1 .. t.z1) rising to ch.topY.
    solidBevel(k, 'glass', ch.x0, ch.baseY, ch.z1, ch.x1, ch.topY - 0.45, t.z1, GLASS_TINT, 0.04);
  });

  // Architectural facade details on the outer concrete halves flanking the lightwell chimney (visual only, clear of interior).
  const g3 = k.geo;
  const chMidY = (ch.baseY + ch.topY) / 2;
  const chHalfH = (ch.topY - ch.baseY) / 2 - 0.8;
  for (const side of [-1, 1] as const) {
    const fx = side * 5.4;
    // Recessed dark-framed architectural mechanical louver panels on North face
    g3.use('steelDark').tint(...GRAPHITE).box(fx, chMidY, ch.z0 - 0.04, 3.2, chHalfH - 0.6, 0.04, FACE.nz);
    g3.use('steel').tint(...SILVER);
    for (let ly = ch.baseY + 1.4; ly <= ch.topY - 1.6; ly += 1.1) {
      g3.box(fx, ly, ch.z0 - 0.09, 3.0, 0.14, 0.06, FACE.nz);
    }
    // Crisp dark architectural trim ribbon wrapping the top & mid belt of the penthouse
    g3.use('steelDark').tint(...GRAPHITE).box(fx, ch.midY, ch.z0 - 0.08, 4.3, 0.18, 0.08, FACE.nz);
  }
  // Vertical mullions framing the side pavilion glass walls so they read as engineered glass curtain walls
  g3.use('steelDark').tint(...GRAPHITE);
  for (let mz = sh.z + 2.0; mz <= t.z1 - 0.5; mz += 2.6) {
    g3.box(t.x0 + 0.3, (y + pavTopY) / 2, mz, 0.36, (pavTopY - y) / 2, 0.1, FACE.sides);
    g3.box(t.x1 - 0.3, (y + pavTopY) / 2, mz, 0.36, (pavTopY - y) / 2, 0.1, FACE.sides);
  }
  g3.tint(1);

  // Intermediate glass observation balcony overlooking the lightwell at Stage 1 height (y = 43.2 = LV.tower3Mid).
  k.floor('grate', -11.4, ch.z0 - 1.4, -10, t.z1, ch.midY, 0.3, 2);
  k.rail([-11.4, ch.midY, ch.z0 - 1.4, -11.4, ch.midY, t.z1]);
  k.floor('grate', 10, ch.z0 - 1.4, 11.4, t.z1, ch.midY, 0.3, 2);
  k.rail([11.4, ch.midY, ch.z0 - 1.4, 11.4, ch.midY, t.z1]);

  // Upper Launch Crane Deck (y = 48.4 = LV.tower3Top) wrapping W, E, and S around the open chimney exit slot!
  k.floor('concrete', -10, ch.z0, ch.x0, t.z1, ch.topY, 0.45, 3);
  k.floor('concrete', ch.x1, ch.z0, 10, t.z1, ch.topY, 0.45, 3);
  k.floor('concrete', ch.x0, ch.z1, ch.x1, t.z1, ch.topY, 0.45, 2);
  k.rail([-10, ch.topY, ch.z0, -10, ch.topY, t.z1, -2.0, ch.topY, t.z1]);
  k.rail([10, ch.topY, ch.z0, 10, ch.topY, t.z1, 2.0, ch.topY, t.z1]);
  mountSign(k, 0, ch.topY + 1.6, ch.z0 - 0.1, Math.PI, 'CHIMNEY', 2.8);
  spec.plan?.decks.push({ x0: -10, z0: ch.z0, x1: 10, z1: t.z1 });

  // --- Tower 3 -> Tower 4 Launch Crane (aimed straight at HQ's 80th-floor 14 m x 6 m glass curtain wall!) ---
  k.ramp(lc.x, lc.z0, lc.startY, lc.x, lc.z1, lc.tipY, lc.width, 'grate', 0.42, true);
  // Vivid orange box-truss crane flanks & overhead tension cable mast.
  k.truss(lc.x - lc.width / 2 - 0.2, lc.startY + 1.0, lc.z0, lc.x - lc.width / 2 - 0.2, lc.tipY + 1.0, lc.z1, 1.8, 0, 'paintRed', 0.1);
  k.truss(lc.x + lc.width / 2 + 0.2, lc.startY + 1.0, lc.z0, lc.x + lc.width / 2 + 0.2, lc.tipY + 1.0, lc.z1, 1.8, 0, 'paintRed', 0.1);
  k.truss(lc.x, lc.startY, lc.z0 + 0.4, lc.x, lc.startY + 7.2, lc.z0 + 0.4, 1.6, 1.6, 'paintRed', 0.11);
  k.beam(lc.x, lc.startY + 7.0, lc.z0 + 0.4, lc.x, lc.tipY + 1.8, lc.z1, 0.06, 0.06, 'steelDark');
  k.stripLine([lc.x, lc.startY + 0.03, lc.z0, lc.x, lc.tipY + 0.03, lc.z1], 0.34, 'emissiveOrange');
  launchEdgeStrip(k, -lc.width / 2, lc.z1 - 0.3, lc.width / 2, lc.z1 - 0.3, lc.tipY);
  spec.plan?.decks.push({ x0: -lc.width / 2, z0: lc.z0, x1: lc.width / 2, z1: lc.z1 });

  // Second Zipline (`hq_launch_zipline`) running from Launch Crane mast straight through HQ's glass curtain wall!
  // Cable itself is rendered dynamically by `ZiplineManager` (`zipline.ts`).
  const hqZip = ZIPLINES[1]!;
  buildZiplinePylon(k, hqZip.start[0], lc.startY, hqZip.start[2], hqZip.start[1], 0);
}

type TowerStyle = 'glass_blue' | 'white_modern' | 'slate_corporate' | 'warm_stone';

/** Builds a realistic solid-core multi-tiered metropolis skyscraper (NEVER a hollow transparent glass shell!). */
function buildSolidSkyscraper(
  k: Kit,
  cx: number,
  cz: number,
  w: number,
  d: number,
  baseY: number,
  topY: number,
  style: TowerStyle,
  seed: number,
): void {
  const g = k.geo;
  const h = topY - baseY;
  const hw = w / 2;
  const hd = d / 2;

  // Palette per architectural style (every facade has an opaque solid core!)
  const bodyMat: Mat = style === 'white_modern' || style === 'warm_stone' ? 'concrete' : 'panel';
  const bodyTint: readonly [number, number, number] =
    style === 'glass_blue'
      ? [0.22, 0.34, 0.48]
      : style === 'slate_corporate'
        ? [0.24, 0.28, 0.35]
        : style === 'warm_stone'
          ? [0.84, 0.81, 0.76]
          : [0.9, 0.93, 0.97];
  const spandrelTint: readonly [number, number, number] =
    style === 'slate_corporate' ? [0.46, 0.52, 0.6] : style === 'warm_stone' ? [0.72, 0.69, 0.64] : WHITE;

  // Primary solid opaque shaft (reaches all the way down to baseY)
  const tier1H = h * 0.76;
  const tier1Top = baseY + tier1H;
  g.use(bodyMat).tint(...bodyTint).box(cx, baseY + tier1H / 2, cz, hw, tier1H / 2, hd, FACE.sides | FACE.py);

  // Upper setback tier (gives real Manhattan / Mirror's Edge skyline silhouette!)
  const tier2H = h - tier1H;
  const hw2 = hw * 0.82;
  const hd2 = hd * 0.82;
  g.use(bodyMat).tint(...bodyTint).box(cx, tier1Top + tier2H / 2, cz, hw2, tier2H / 2, hd2, FACE.sides | FACE.py);

  // Horizontal floor spandrel bands + subtle dark window bands + realistic segmented lit/unlit office bays
  const step = 7.0;
  for (let y = baseY + 10, fi = 0; y < topY - 2; y += step, fi++) {
    const isUpper = y > tier1Top;
    const rw = isUpper ? hw2 : hw;
    const rd = isUpper ? hd2 : hd;
    g.use('concrete').tint(...spandrelTint).box(cx, y, cz, rw + 0.16, 0.42, rd + 0.16, FACE.sides);

    // Continuous dark reflective window ribbon recessed behind floor spandrels
    g.use('panel').tint(...CORE_SLATE).box(cx, y - 2.3, cz, rw + 0.04, 1.35, rd + 0.04, FACE.sides);

    // Varied segmented warm & cool lit office bays (never blinding white bars!)
    for (let bi = -1; bi <= 1; bi++) {
      if (((fi * 5 + bi * 3 + seed) % 5) === 0 || ((fi + bi + seed) % 4) === 0) continue;
      const warm = ((fi + bi + seed) & 1) === 0;
      g.use(warm ? 'emissiveDim' : 'screen').tint(...(warm ? WARM_OFFICE : COOL_OFFICE));
      const bx = cx + bi * (rw * 0.56);
      const bz = cz + bi * (rd * 0.56);
      g.box(bx, y - 2.3, cz + rd + 0.08, rw * 0.21, 0.72, 0.02, FACE.pz);
      g.box(bx, y - 2.3, cz - rd - 0.08, rw * 0.21, 0.72, 0.02, FACE.nz);
      g.box(cx + rw + 0.08, y - 2.3, bz, 0.02, 0.72, rd * 0.21, FACE.px);
      g.box(cx - rw - 0.08, y - 2.3, bz, 0.02, 0.72, rd * 0.21, FACE.nx);
    }
  }

  // Structural corner piers & rooftop parapet / mechanical penthouse / spire
  g.use('concrete').tint(...spandrelTint);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      g.box(cx + sx * (hw - 0.45), baseY + tier1H / 2, cz + sz * (hd - 0.45), 0.65, tier1H / 2, 0.65, FACE.sides);
    }
  }
  g.box(cx, topY + 1.4, cz, hw2 * 0.52, 1.4, hd2 * 0.52, FACE.noBottom);
  g.use('steelDark').tint(...GRAPHITE).box(cx, topY + 0.35, cz, hw2 + 0.18, 0.35, hd2 + 0.18, FACE.sides | FACE.py);

  // Subtle architectural crown accent on select glass towers & optional communications spire
  if (style === 'glass_blue' && (seed % 3) === 0) {
    g.use('screen').tint(0.55, 0.76, 0.92).box(cx, topY - 0.8, cz, hw2 + 0.2, 0.16, hd2 + 0.2, FACE.sides);
  }
  if (seed % 3 === 0) {
    g.use('steel').tint(...SILVER).cyl(cx, topY + 2.8, cz, cx, topY + 12.5, cz, 0.26, 0.06, 6);
    g.use('emissiveRed').tint(0.95).box(cx, topY + 12.7, cz, 0.22, 0.22, 0.22, FACE.all);
  }
  g.tint(1);
}

/** Non-colliding chasm canyon floor & dense sunlit metropolis skyscrapers framing the skyline. */
function buildSkylineBackdrop(k: Kit): void {
  const g = k.geo;

  // Vast urban dusk ground plane out to the distant horizon (sits safely below CHASM_Y so zero clipping with playable map!).
  g.use('paintWhite').tint(0.06, 0.07, 0.095).gridStep(-460, CHASM_Y - 0.4, 420, 920, 0, 0, 0, 0, -880, 60);

  // Deep chasm avenue floor far below Towers 1-3 (strictly north of z = -28 so it never clips Datacenter/Boulevard).
  g.use('asphalt').tint(0.24, 0.28, 0.34).quad(-240, CHASM_Y, -28, 240, CHASM_Y, -28, 240, CHASM_Y, -240, -240, CHASM_Y, -240);
  g.use('paintWhite').tint(0.65);
  for (const x of [-40, 40]) g.box(x, CHASM_Y + 0.06, -134, 0.4, 0.04, 102, FACE.py);
  for (const z of [-76, -138]) g.box(0, CHASM_Y + 0.06, z, 200, 0.04, 0.4, FACE.py);
  g.tint(1);

  // Dense inner + outer rings of solid-core downtown skyscrapers surrounding the northern, eastern, and western skyline (zero colliders).
  const towers: readonly [number, number, number, number, number, TowerStyle][] = [
    [-156, -172, 28, 28, 80, 'glass_blue'],
    [-118, -192, 30, 26, 72, 'white_modern'],
    [-76, -188, 30, 26, 86, 'slate_corporate'],
    [-26, -186, 30, 28, 92, 'glass_blue'],
    [24, -184, 28, 26, 74, 'warm_stone'],
    [68, -176, 30, 26, 82, 'white_modern'],
    [110, -158, 30, 28, 78, 'glass_blue'],
    [96, -116, 28, 26, 68, 'slate_corporate'],
    [76, -98, 26, 24, 64, 'white_modern'],
    [82, -52, 28, 26, 74, 'glass_blue'],
    [116, -64, 30, 28, 86, 'warm_stone'],
    [78, -6, 26, 26, 68, 'slate_corporate'],
    [-144, -124, 28, 28, 70, 'white_modern'],
    [-142, -74, 28, 26, 76, 'slate_corporate'],
    [-112, -52, 26, 26, 66, 'warm_stone'],
    [-78, -84, 24, 24, 62, 'glass_blue'],
    [-74, -36, 26, 24, 60, 'white_modern'],
    [-78, -2, 26, 26, 68, 'glass_blue'],
    // Outer metropolitan skyline horizon silhouettes (breaks up empty horizon from rooftop viewpoints!)
    [-198, -210, 34, 30, 96, 'slate_corporate'],
    [-148, -242, 36, 30, 108, 'glass_blue'],
    [-86, -244, 34, 30, 114, 'warm_stone'],
    [-18, -248, 38, 32, 122, 'glass_blue'],
    [48, -242, 34, 30, 102, 'white_modern'],
    [114, -228, 36, 30, 94, 'slate_corporate'],
    [164, -188, 34, 30, 104, 'glass_blue'],
    [170, -122, 34, 30, 92, 'warm_stone'],
    [172, -50, 34, 32, 108, 'slate_corporate'],
    [168, 22, 34, 30, 96, 'glass_blue'],
    [-200, -142, 34, 30, 98, 'warm_stone'],
    [-196, -72, 34, 30, 104, 'glass_blue'],
    [-190, 6, 34, 30, 92, 'white_modern'],
  ];
  for (let i = 0; i < towers.length; i++) {
    const [cx, cz, w, d, topY, style] = towers[i]!;
    buildSolidSkyscraper(k, cx, cz, w, d, CHASM_Y, topY, style, i + 1);
  }
}

/** Crisp daylight rooftop washes across Towers 1-3 & Gaff Canyon. */
function buildSkylineLighting(k: Kit): void {
  const SUN = 0xfff7e6;
  const SKY = 0xdbf0ff;
  const washes: readonly [number, number, number, number, number, number][] = [
    [-84, LV.tower1 + 9, -138, SUN, 130, 40],
    [-68, LV.tower1 + 8, -136, SKY, 95, 32],
    [6, LV.tower2 + 10, -110, SUN, 125, 38],
    [6, LV.tower2 + 10, -76, SKY, 105, 36],
    [4, LV.tower2 + 10, -44, SUN, 125, 38],
    [0, LV.tower3Top + 7, -28, SUN, 100, 28],
    [0, OFFICE.execY + 8, -16, SKY, 95, 28],
  ];
  for (const [x, y, z, col, intensity, radius] of washes) {
    k.light(x, y, z, col, intensity, radius);
  }
}

export function authorSkyline(k: Kit, spec: MapSpec): void {
  // Build Towers 1, 2, 3 (Tower 4 HQ is built in office.ts so its interior floors & shafts stay open).
  for (const t of TOWERS) {
    if (t.id !== 'hq') buildSkylineTowerShell(k, spec, t);
  }
  buildTower1(k, spec);
  buildTower2(k, spec);
  buildGaffCanyon(k);
  buildTower3(k, spec);
  buildSkylineBackdrop(k);
  buildSkylineLighting(k);

  // Connect skyline rooftop arenas to Tower 4 in NavGraph so `mutual: true` retains all skyline AI nodes.
  spec.jump(-68, LV.tower1, -136, -6, LV.tower2, -112, true);
  spec.jump(6, LV.tower2, -97, 6, LV.tower2, -57, true);
  spec.jump(0, LV.tower2, -33.5, 0, LV.tower3Top, -27.2, true);
  spec.jump(0, LV.tower3Top, -26, 0, LV.exec, -10, true);
}
