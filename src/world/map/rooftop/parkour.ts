/**
 * Parkour-first rooftop geometry:
 *   - Wall-run billboards & illuminated glass wall-run panels bridging lethal chasms (unbroken single colliders)
 *   - Multi-tier scaffolding towers & parkour kicker ramps climbing to higher roofs and sniper perches
 *   - Foundry Tower Crane cab & cantilevered steel jib boom sniper perch (y = 38.5)
 *   - Helios Comms Spire chimney-jump & highest rooftop sniper platform (y = 44.5)
 */
import { FACE } from '../../kit/geo';
import type { Kit } from '../../kit/kit';
import { signId } from '../../kit/signs';
import type { MapSpec } from '../spec';
import { LV, WALL_RUN_PANELS, type WallRunPanelSpec } from './plan';

/** Unbroken wall-run billboard or glass panel across a lethal skyscraper drop. */
function buildWallRunPanel(k: Kit, p: WallRunPanelSpec): void {
  const g = k.geo;
  const cx = (p.x0 + p.x1) / 2;
  const cy = (p.y0 + p.y1) / 2;
  const cz = (p.z0 + p.z1) / 2;
  const hx = (p.x1 - p.x0) / 2;
  const hy = (p.y1 - p.y0) / 2;
  const hz = (p.z1 - p.z0) / 2;
  const alongX = hx > hz;
  const span = (alongX ? hx : hz) * 2;
  const height = hy * 2;

  // Single continuous collider so wall-runs never catch on a seam!
  k.collide(cx, cy, cz, hx, hy, hz, p.kind === 'glass' ? 'glass' : 'metal', false);

  if (p.kind === 'billboard') {
    g.use('steelDark').tint(0.32, 0.35, 0.42).bevel(cx, cy, cz, hx, hy, hz, 0.04);
    g.tint(1);

    // Signage on both long faces.
    if (p.sign) {
      const sh = Math.min(height - 1.2, span / 4.2);
      const id = signId(p.sign);
      if (alongX) {
        k.push(cx, cy + 0.25, p.z1 + 0.02, 0);
        g.use('signs').quadUV(-sh * 2, -sh / 2, 0, sh * 2, sh / 2, id);
        k.pop();
        k.push(cx, cy + 0.25, p.z0 - 0.02, Math.PI);
        g.use('signs').quadUV(-sh * 2, -sh / 2, 0, sh * 2, sh / 2, id);
        k.pop();
      } else {
        k.push(p.x1 + 0.02, cy + 0.25, cz, Math.PI / 2);
        g.use('signs').quadUV(-sh * 2, -sh / 2, 0, sh * 2, sh / 2, id);
        k.pop();
        k.push(p.x0 - 0.02, cy + 0.25, cz, -Math.PI / 2);
        g.use('signs').quadUV(-sh * 2, -sh / 2, 0, sh * 2, sh / 2, id);
        k.pop();
      }
    }

    // Glowing top & bottom neon runner strips + structural truss hangers (visual only).
    g.use(p.accent).tint(0.95);
    if (alongX) {
      g.box(cx, p.y1 + 0.06, cz, hx - 0.15, 0.07, hz + 0.08, FACE.all);
      g.box(cx, p.y0 - 0.05, cz, hx - 0.15, 0.06, hz + 0.06, FACE.sides | FACE.ny);
      k.truss(p.x0 + 0.4, p.y0 - 0.55, cz, p.x1 - 0.4, p.y0 - 0.55, cz, 0.7, 0.5, 'steelDark', 0.08);
    } else {
      g.box(cx, p.y1 + 0.06, cz, hx + 0.08, 0.07, hz - 0.15, FACE.all);
      g.box(cx, p.y0 - 0.05, cz, hx + 0.06, 0.06, hz - 0.15, FACE.sides | FACE.ny);
      k.truss(cx, p.y0 - 0.55, p.z0 + 0.4, cx, p.y0 - 0.55, p.z1 - 0.4, 0.7, 0.5, 'steelDark', 0.08);
    }
    g.tint(1);
    k.light(cx, p.y1 - 0.6, cz, p.accent === 'emissiveOrange' ? 'orange' : p.accent === 'emissiveMagenta' ? 'magenta' : 'cyan', 28, 15);
  } else {
    // Sleek architectural glass wall-run panel with dark steel mullions and neon edge strip.
    g.use('glass').tint(0.76, 0.92, 1.0).box(cx, cy, cz, hx, hy, hz, FACE.all);
    g.use('steelDark').tint(0.42);
    if (alongX) {
      g.box(cx, p.y1 + 0.08, cz, hx + 0.04, 0.08, hz + 0.08, FACE.all);
      g.box(cx, p.y0 - 0.08, cz, hx + 0.04, 0.08, hz + 0.08, FACE.all);
      for (let x = p.x0 + 0.5; x <= p.x1 - 0.4; x += 3.2) {
        g.box(x, cy, cz, 0.06, hy, hz + 0.03, FACE.sides);
      }
      g.use(p.accent).tint(0.9).box(cx, cy + hy * 0.65, cz, hx - 0.2, 0.08, hz + 0.04, FACE.pz | FACE.nz);
    } else {
      g.box(cx, p.y1 + 0.08, cz, hx + 0.08, 0.08, hz + 0.04, FACE.all);
      g.box(cx, p.y0 - 0.08, cz, hx + 0.08, 0.08, hz + 0.04, FACE.all);
      for (let z = p.z0 + 0.5; z <= p.z1 - 0.4; z += 3.2) {
        g.box(cx, cy, z, hx + 0.03, hy, 0.06, FACE.sides);
      }
      g.use(p.accent).tint(0.9).box(cx, cy + hy * 0.65, cz, hx + 0.04, 0.08, hz - 0.2, FACE.px | FACE.nx);
    }
    g.tint(1);
    k.light(cx, cy + 1.5, cz, p.accent === 'emissiveMagenta' ? 'magenta' : 'cyan', 24, 14);
  }
}

/** One parkour scaffold plank deck (collider + wooden planks + optional climbable plywood wall sheet). */
function scaffoldDeck(k: Kit, spec: MapSpec, x0: number, z0: number, x1: number, z1: number, y: number): void {
  const g = k.geo;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const hx = (x1 - x0) / 2;
  const hz = (z1 - z0) / 2;
  k.collide(cx, y - 0.05, cz, hx, 0.05, hz, 'metal', false);
  g.use('plywood').tint(0.7, 0.58, 0.42).box(cx, y - 0.04, cz, hx, 0.04, hz, FACE.all);
  g.use('steel').tint(0.62, 0.62, 0.6).box(cx, y - 0.1, cz, hx + 0.03, 0.04, hz + 0.03, FACE.sides | FACE.ny);
  g.tint(1);
  spec.plan?.decks.push({ x0, z0, x1, z1 });
}

function climbSheet(k: Kit, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
  const g = k.geo;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
  const hx = (x1 - x0) / 2, hy = (y1 - y0) / 2, hz = (z1 - z0) / 2;
  k.collide(cx, cy, cz, hx, hy, hz, 'concrete', false);
  g.use('plywood').tint(0.74, 0.62, 0.46).box(cx, cy, cz, hx, hy, hz, FACE.all);
  g.use('hazard').tint(1).box(cx, y1 - 0.25, cz, hx + 0.01, 0.14, hz + 0.01, FACE.sides);
  g.tint(1);
}

/** Steel tube scaffolding frame (visual only — zero colliders so jumps/mantles never snag). */
function scaffoldTubes(k: Kit, x0: number, z0: number, x1: number, z1: number, y0: number, y1: number): void {
  const g = k.geo.use('steel').tint(0.68, 0.68, 0.64);
  for (const x of [x0 + 0.06, x1 - 0.06]) {
    for (const z of [z0 + 0.06, z1 - 0.06]) {
      g.cyl(x, y0, z, x, y1, z, 0.04, 0.04, 6, false, false);
    }
  }
  for (let y = y0 + 2.5; y < y1; y += 3.0) {
    g.cyl(x0 + 0.06, y, z0 + 0.06, x1 - 0.06, y, z0 + 0.06, 0.03, 0.03, 6, false, false);
    g.cyl(x0 + 0.06, y, z1 - 0.06, x1 - 0.06, y, z1 - 0.06, 0.03, 0.03, 6, false, false);
    g.cyl(x0 + 0.06, y, z0 + 0.06, x0 + 0.06, y, z1 - 0.06, 0.03, 0.03, 6, false, false);
    g.cyl(x1 - 0.06, y, z0 + 0.06, x1 - 0.06, y, z1 - 0.06, 0.03, 0.03, 6, false, false);
  }
  g.tint(1);
}

/** Foundry Tower Crane (y = 38.5 sniper cab & cantilevered jib boom over Apex chasm) + 5-tier parkour scaffold ascent. */
function buildFoundryCraneAndScaffold(k: Kit, spec: MapSpec): void {
  const g = k.geo;
  const baseY = LV.foundry; // 24
  const cabY = 38.5;

  // Yellow steel lattice crane mast at (58, 24..44, -10)
  k.truss(58, baseY, -10, 58, 44.5, -10, 2.2, 2.2, 'paintYellow', 0.14);
  k.collide(58, (baseY + 44) / 2, -10, 1.15, (44 - baseY) / 2, 1.15, 'metal', false);

  // Crane Cab Deck (x 54..62, z -14..-6, y = 38.5)
  k.collide(58, cabY - 0.15, -10, 4.0, 0.15, 4.0, 'metal', false);
  g.use('grate').tint(0.75).box(58, cabY - 0.12, -10, 4.0, 0.12, 4.0, FACE.all);
  g.use('paintYellow').tint(0.92, 0.72, 0.14).box(58, cabY - 0.25, -10, 4.15, 0.18, 4.15, FACE.sides | FACE.ny);
  // Open-sided operator cab frame on north-east corner (cover + silhouette)
  g.use('paintYellow').box(60.6, cabY + 1.4, -12.6, 1.2, 1.4, 0.12, FACE.all);
  g.use('paintYellow').box(61.8, cabY + 1.4, -10.5, 0.12, 1.4, 2.2, FACE.all);
  g.use('paintYellow').box(60.4, cabY + 2.85, -10.5, 1.5, 0.1, 2.3, FACE.all);
  k.rail([54, cabY, -14, 62, cabY, -14, 62, cabY, -6, 54, cabY, -6]);
  spec.plan?.decks.push({ x0: 54, z0: -14, x1: 62, z1: -6 });

  // Cantilevered Walkable Jib Boom extending west over the chasm (x 30..54, z -11.4..-8.6, y = 38.5)!
  k.collide(42, cabY - 0.14, -10, 12.0, 0.14, 1.4, 'metal', false);
  g.use('grate').tint(0.72).box(42, cabY - 0.08, -10, 12.0, 0.08, 1.35, FACE.all);
  k.truss(30, cabY + 1.2, -10, 68, cabY + 1.2, -10, 2.2, 2.4, 'paintYellow', 0.1);
  // Counterweight block on east tail (x 64..69)
  g.use('concreteDark').box(66.5, cabY + 0.5, -10, 2.2, 1.0, 1.4, FACE.all);
  // Apex spire & tension stay cables
  k.beam(58, 44.5, -10, 32, cabY + 2.3, -10, 0.06, 0.06, 'steelDark');
  k.beam(58, 44.5, -10, 66.5, cabY + 1.5, -10, 0.06, 0.06, 'steelDark');
  g.use('emissiveRed').box(58, 45.1, -10, 0.2, 0.2, 0.2, FACE.all);
  g.use('emissiveOrange').box(30.2, cabY + 1.6, -10, 0.22, 0.22, 0.22, FACE.all);
  g.tint(1);
  spec.plan?.decks.push({ x0: 30, z0: -11.4, x1: 54, z1: -8.6 });

  // Multi-Tier Parkour Scaffolding Tower (x 48..54, z -15..-5) climbing 24 -> 26.5 -> 29.5 -> 32.5 -> 35.5 -> 38.5!
  scaffoldTubes(k, 48, -15, 54, -5, baseY, cabY + 1.2);
  // Tier 1 (y = 26.5): easy jump+mantle or kicker ramp from roof (y = 24)
  scaffoldDeck(k, spec, 48, -10, 54, -5, 26.5);
  k.ramp(45, -7.5, baseY, 48, -7.5, 26.5, 2.2, 'plywood', 0.22, false);
  // Tier 2 (y = 29.5): north half, climbable plywood sheet at z = -10
  scaffoldDeck(k, spec, 48, -15, 54, -10, 29.5);
  climbSheet(k, 48, 26.5, -10.06, 54, 29.5, -9.94);
  // Tier 3 (y = 32.5): south half
  scaffoldDeck(k, spec, 48, -10, 54, -5, 32.5);
  climbSheet(k, 48, 29.5, -10.06, 54, 32.5, -9.94);
  // Tier 4 (y = 35.5): north half
  scaffoldDeck(k, spec, 48, -15, 54, -10, 35.5);
  climbSheet(k, 48, 32.5, -10.06, 54, 35.5, -9.94);
  // Tier 5 (y = 38.5): bridge right into Crane Cab at x = 54!
  scaffoldDeck(k, spec, 48, -10, 54, -6, cabY);
  climbSheet(k, 48, 35.5, -10.06, 54, cabY, -9.94);
  k.light(51, cabY + 1, -10, 'orange', 32, 18);
}

/** Fast parkour scaffolding climbs on Apex Penthouse (south face) and Bastion Water-Tower Deck (north face). */
function buildAuxScaffolds(k: Kit, spec: MapSpec): void {
  // Apex Penthouse South Scaffold (x -19..-11, z -3.9..-2.1, climbing 28 -> 30.8 -> 34)
  scaffoldTubes(k, -19, -3.9, -11, -2.1, LV.apex, LV.helios + 0.8);
  scaffoldDeck(k, spec, -15, -3.9, -11, -2.1, 30.8);
  climbSheet(k, -15, LV.apex, -2.16, -11, 30.8, -2.04);
  scaffoldDeck(k, spec, -19, -3.9, -15, -2.1, 33.4);
  climbSheet(k, -15.06, 30.8, -3.9, -14.94, 33.4, -2.1);

  // Bastion Water-Tower North Scaffold (x -21..-11, z 46.1..47.9, climbing 20 -> 23.2 -> 26.6 -> 30)
  scaffoldTubes(k, -21, 46.1, -11, 47.9, LV.bastion, LV.vanguard + 0.8);
  scaffoldDeck(k, spec, -21, 46.1, -16, 47.9, 23.2);
  climbSheet(k, -21, LV.bastion, 46.04, -16, 23.2, 46.16);
  scaffoldDeck(k, spec, -16, 46.1, -11, 47.9, 26.6);
  climbSheet(k, -16.06, 23.2, 46.1, -15.94, 26.6, 47.9);
  scaffoldDeck(k, spec, -21, 46.1, -16, 47.9, 29.4);
  climbSheet(k, -16.06, 26.6, 46.1, -15.94, 29.4, 47.9);
}

/** Helios Comms Spire Chimney (2.8 m parallel walls) & Highest Rooftop Sniper Platform (y = 44.5). */
function buildHeliosCommsSpire(k: Kit, spec: MapSpec): void {
  const g = k.geo;
  const base = LV.heliosTop; // 40
  const deckY = 44.5;

  // Twin vertical comms shaft walls forming a 2.8 m Chimney-Jump Alley (x = -3.4..-0.6, z = -61..-55)
  k.collide(-3.6, (base + deckY) / 2, -58, 0.22, (deckY - base) / 2, 3.0, 'concrete', false);
  g.use('panel').tint(0.84, 0.9, 0.98).box(-3.6, (base + deckY) / 2, -58, 0.22, (deckY - base) / 2, 3.0, FACE.all);
  k.collide(-0.4, (base + deckY) / 2, -58, 0.22, (deckY - base) / 2, 3.0, 'concrete', false);
  g.use('panel').tint(0.84, 0.9, 0.98).box(-0.4, (base + deckY) / 2, -58, 0.22, (deckY - base) / 2, 3.0, FACE.all);
  // Cyan guide stripes inside chimney
  g.use('emissiveCyan');
  g.box(-3.36, base + 2.2, -57.2, 0.03, 1.9, 0.12, FACE.px);
  g.box(-0.64, base + 2.2, -57.2, 0.03, 1.9, 0.12, FACE.nx);

  // Upper Sniper Platform (y = 44.5): left wing, right wing, and north bridge — chimney exit slot (-3.4..-0.6, -58..-55) stays open!
  scaffoldDeck(k, spec, -7.2, -62, -3.4, -55, deckY);
  scaffoldDeck(k, spec, -0.6, -62, 3.2, -55, deckY);
  scaffoldDeck(k, spec, -3.4, -62, -0.6, -58.2, deckY);
  k.rail([-7.2, deckY, -55, -3.4, deckY, -55]);
  k.rail([-0.6, deckY, -55, 3.2, deckY, -55]);
  k.rail([-7.2, deckY, -62, 3.2, deckY, -62]);

  // Iconic towering comms spire mast rising above the sniper deck to y = 58!
  k.truss(-2, deckY, -60.5, -2, 54, -60.5, 1.2, 1.2, 'steel', 0.08);
  g.use('steel').cyl(-2, 54, -60.5, -2, 58.5, -60.5, 0.14, 0.04, 8, false, false);
  g.use('emissiveRed').box(-2, 58.7, -60.5, 0.24, 0.24, 0.24, FACE.all);
  g.use('emissiveCyan').box(-2, deckY + 4.0, -60.5, 0.8, 0.12, 0.8, FACE.sides);
  g.tint(1);
  k.light(-2, deckY + 2.5, -58, 'cyan', 36, 18);
}

export function authorParkour(k: Kit, spec: MapSpec): void {
  for (const p of WALL_RUN_PANELS) buildWallRunPanel(k, p);
  buildFoundryCraneAndScaffold(k, spec);
  buildAuxScaffolds(k, spec);
  buildHeliosCommsSpire(k, spec);
}
