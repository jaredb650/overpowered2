/**
 * Tower 4 — OpenMind HQ (`office.ts`, x = -26..+26, z = -12..+18):
 *   - Monumental white-steel & blue-glass corporate tower rising from Grand Boulevard (y = 0) to crown (y = 64)
 *   - Executive Floor (y = 42): 14 m x 6 m breakable `pane` glass curtain wall facing Tower 3's Launch Crane,
 *     Executive Conference Room, Ram Faultman's suite, open cubicle floor (`divider`, `monitor`, `chair`, `plant`,
 *     exploding `copier` & `vending`), panoramic south windows, and a 6 m x 6 m breakable floor skylight
 *   - Engineering Mezzanine (y = 34): AI Lab workstations, west grand glass staircase linking Mezz <-> Exec,
 *     and Rear Service Corridor leading to the 6 m x 6 m Freight Elevator Shaft
 *   - Freight Elevator Shaft (x = 14..20, z = 8..14): enclosed vertical guide-rail shaft descending cleanly from
 *     y = 34 down to Sub-Level 4 Compute Vault (y = -6) with emergency floor-marker strips & breakable vault grate
 */
import { FACE, type Mat } from '../../kit/geo';
import type { Kit } from '../../kit/kit';
import { signId, type SignName } from '../../kit/signs';
import type { MapSpec } from '../spec';
import { DATACENTER, ELEVATOR_SHAFT, LV, OFFICE } from './plan';

const WHITE: readonly [number, number, number] = [0.95, 0.97, 1.0];
const WARM_GRAY: readonly [number, number, number] = [0.84, 0.86, 0.9];
const GRAPHITE: readonly [number, number, number] = [0.22, 0.25, 0.3];
const GLASS_TINT: readonly [number, number, number] = [0.68, 0.88, 0.99];
const WALNUT: readonly [number, number, number] = [0.42, 0.28, 0.18];
const CARPET_COOL: readonly [number, number, number] = [0.34, 0.4, 0.48];

function solidBox(
  k: Kit,
  mat: Mat,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  tint?: readonly [number, number, number],
  bev = 0.04,
): void {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
  const hx = (x1 - x0) / 2, hy = (y1 - y0) / 2, hz = (z1 - z0) / 2;
  const g = k.geo.use(mat);
  if (tint) g.tint(tint[0], tint[1], tint[2]);
  if (bev > 0.008) g.bevel(cx, cy, cz, hx, hy, hz, bev);
  else g.box(cx, cy, cz, hx, hy, hz, FACE.all);
  if (tint) g.tint(1);
  const surf = mat === 'glass' ? 'glass' : mat === 'steel' || mat === 'steelDark' ? 'metal' : 'concrete';
  k.collide(cx, cy, cz, hx, hy, hz, surf);
}

function mountSign(k: Kit, x: number, y: number, z: number, yaw: number, name: SignName, w = 2.0): void {
  const h = w / 4;
  k.push(x, y, z, yaw);
  k.geo.use('steelDark').tint(...GRAPHITE).bevel(0, 0, -0.03, w / 2 + 0.05, h / 2 + 0.05, 0.03, 0.01);
  k.geo.tint(1).use('signs').quadUV(-w / 2, -h / 2, 0.015, w / 2, h / 2, signId(name));
  k.pop();
}

/** Sculpted modern office desk (1.6 m x 0.8 m) with bevelled laminate top and steel legs. */
function officeDesk(k: Kit, x: number, y: number, z: number, yaw: number, topTint: readonly [number, number, number] = WHITE): void {
  k.push(x, y, z, yaw);
  const g = k.geo;
  g.use('plaster').tint(topTint[0], topTint[1], topTint[2]).bevel(0, 0.74, 0, 0.8, 0.025, 0.4, 0.01);
  g.use('steelDark').tint(...GRAPHITE);
  g.bevel(-0.74, 0.36, 0, 0.03, 0.36, 0.36, 0.008);
  g.bevel(0.56, 0.35, -0.02, 0.22, 0.35, 0.34, 0.012);
  g.use('rubber').tint(0.16, 0.18, 0.22).box(-0.08, 0.775, 0.14, 0.22, 0.01, 0.08, FACE.noBottom);
  g.tint(1);
  k.collide(0, 0.38, 0, 0.8, 0.38, 0.4, 'metal');
  k.pop();
}

/** 4-seat cubicle pod with breakable fabric `divider`s, `monitor`s, and `chair`s. */
function cubiclePod(k: Kit, spec: MapSpec, x: number, y: number, z: number): void {
  for (const s of [-1, 1]) {
    for (const e of [-1, 1]) {
      officeDesk(k, x + e * 0.85, y, z + s * 0.46, s > 0 ? 0 : Math.PI);
      spec.breakable('monitor', x + e * 0.85, y + 0.76, z + s * 0.26, s > 0 ? 0 : Math.PI);
      spec.breakable('chair', x + e * 0.85, y, z + s * 1.42, s > 0 ? Math.PI : 0);
    }
  }
  spec.breakable('divider', x, y + 0.76, z, 0, 3.3, 0.55);
  spec.breakable('divider', x, y + 0.76, z, Math.PI / 2, 1.7, 0.45);
}

/** Executive conference table with brushed graphite pedestal and chamfered walnut top. */
function conferenceTable(k: Kit, x: number, y: number, z: number, w: number, d: number): void {
  const g = k.geo;
  g.use('plaster').tint(...WALNUT).bevel(x, y + 0.75, z, w / 2, 0.04, d / 2, 0.02);
  g.use('steelDark').tint(...GRAPHITE);
  for (const dx of [-w * 0.32, w * 0.32]) {
    g.bevel(x + dx, y + 0.36, z, 0.12, 0.36, d * 0.32, 0.02);
  }
  g.use('emissiveCyan').tint(0.75).box(x, y + 0.795, z, w * 0.36, 0.006, 0.06, FACE.py);
  g.tint(1);
  k.collide(x, y + 0.39, z, w / 2, 0.39, d / 2, 'metal');
}

/** Modernist lounge sofa. */
function loungeSofa(k: Kit, x: number, y: number, z: number, yaw: number, w = 2.4): void {
  k.push(x, y, z, yaw);
  const g = k.geo;
  g.use('carpet').tint(0.24, 0.34, 0.46);
  g.bevel(0, 0.3, 0.42, w / 2, 0.2, 0.42, 0.05);
  g.bevel(0, 0.72, 0.12, w / 2, 0.24, 0.12, 0.05);
  for (const s of [-1, 1]) g.bevel(s * (w / 2 - 0.1), 0.46, 0.42, 0.1, 0.24, 0.42, 0.04);
  g.tint(1);
  k.collide(0, 0.46, 0.42, w / 2, 0.46, 0.42, 'concrete');
  k.pop();
}

const CORE_SLATE: readonly [number, number, number] = [0.16, 0.22, 0.31];
const CORE_DARK: readonly [number, number, number] = [0.11, 0.15, 0.22];
const WARM_OFFICE: readonly [number, number, number] = [0.92, 0.84, 0.7];
const COOL_OFFICE: readonly [number, number, number] = [0.56, 0.68, 0.8];

/** Exterior skyscraper shell of Tower 4 HQ (y = 0..64), opening cleanly for breakout ramp & glass curtain walls. */
function buildHqExteriorShell(k: Kit, spec: MapSpec): void {
  const g = k.geo;
  const { x0, x1, z0, z1, execY, execCeil, mezzY } = OFFICE;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const hx = (x1 - x0) / 2;
  const hz = (z1 - z0) / 2;
  const sh = ELEVATOR_SHAFT;

  // --- Lower Tower Exterior Curtain Wall (y = 4.5 .. 33.4) + Opaque Recessed Architectural Core ---
  const lowerY0 = DATACENTER.ceilY; // 4.5
  const lowerY1 = mezzY - 0.6;      // 33.4
  const lowerH = lowerY1 - lowerY0;
  const lowerCy = (lowerY0 + lowerY1) / 2;

  // Opaque recessed interior architectural core (set 1.1 m behind the glass skin, split cleanly around
  // the x=14..20, z=8..14 elevator shaft so the shaft descends unobstructed while zero see-through void exists!).
  const coreIn = 1.1;
  const cX0 = x0 + coreIn, cX1 = x1 - coreIn;
  const cZ0 = z0 + coreIn, cZ1 = z1 - coreIn;
  g.use('panel').tint(...CORE_SLATE);
  // 1) Main West & Center core (x = -24.9 .. 13.2, full depth z = -10.9 .. 16.9)
  g.box((cX0 + (sh.x0 - 0.8)) / 2, lowerCy, (cZ0 + cZ1) / 2, (sh.x0 - 0.8 - cX0) / 2, lowerH / 2, (cZ1 - cZ0) / 2, FACE.sides);
  // 2) North-East core block (x = 13.2 .. 24.9, z = -10.9 .. 7.2)
  g.box(((sh.x0 - 0.8) + cX1) / 2, lowerCy, (cZ0 + (sh.z0 - 0.8)) / 2, (cX1 - (sh.x0 - 0.8)) / 2, lowerH / 2, (sh.z0 - 0.8 - cZ0) / 2, FACE.sides);
  // 3) South-East backing wall behind glass (x = 13.2 .. 24.9, z = 14.8 .. 16.9)
  g.box(((sh.x0 - 0.8) + cX1) / 2, lowerCy, ((sh.z1 + 0.8) + cZ1) / 2, (cX1 - (sh.x0 - 0.8)) / 2, lowerH / 2, (cZ1 - (sh.z1 + 0.8)) / 2, FACE.sides);
  // 4) Far-East backing wall beside shaft (x = 20.8 .. 24.9, z = 7.2 .. 14.8)
  g.box(((sh.x1 + 0.8) + cX1) / 2, lowerCy, (sh.z0 + sh.z1) / 2, (cX1 - (sh.x1 + 0.8)) / 2, lowerH / 2, (sh.z1 - sh.z0) / 2 + 0.8, FACE.sides);

  // Recessed interior office floor slabs & realistic warm/cool dusk window bays visible through the curtain wall!
  for (let fy = lowerY0 + 4.8; fy < lowerY1 - 1.0; fy += 4.8) {
    // Structural floor slab edge right behind the glazing
    g.use('concrete').tint(...WARM_GRAY);
    g.box(cx, fy, cz, hx - 0.55, 0.28, hz - 0.55, FACE.sides);

    // Warm golden & cool office dusk window bays on recessed core perimeter (non-blooming emissiveDim / screen)
    const floorIdx = Math.round((fy - lowerY0) / 4.8);
    for (let bx = -20; bx <= 20; bx += 8) {
      const lit = ((bx + floorIdx * 5) & 3) !== 0;
      if (!lit) continue;
      const warm = ((bx + floorIdx) & 1) === 0;
      g.use(warm ? 'emissiveDim' : 'screen').tint(...(warm ? WARM_OFFICE : COOL_OFFICE));
      g.box(bx, fy - 1.5, cZ1 + 0.08, 2.4, 0.85, 0.02, FACE.pz);
      g.box(bx, fy - 1.5, cZ0 - 0.08, 2.4, 0.85, 0.02, FACE.nz);
    }
    for (let bz = -8; bz <= 14; bz += 7) {
      const lit = ((bz + floorIdx * 3) & 3) !== 0;
      if (!lit) continue;
      const warm = ((bz + floorIdx) & 1) === 0;
      g.use(warm ? 'emissiveDim' : 'screen').tint(...(warm ? WARM_OFFICE : COOL_OFFICE));
      g.box(cX0 - 0.08, fy - 1.5, bz, 0.02, 0.85, 2.1, FACE.nx);
      g.box(cX1 + 0.08, fy - 1.5, bz, 0.02, 0.85, 2.1, FACE.px);
    }
  }
  g.tint(1);

  // 4 perimeter exterior reflective glass curtain walls enclosing the lower tower (y = 4.5..33.4).
  solidBox(k, 'glass', x0, lowerY0, z0, x0 + 0.6, lowerY1, z1, GLASS_TINT, 0.02);
  solidBox(k, 'glass', x1 - 0.6, lowerY0, z0, x1, lowerY1, z1, GLASS_TINT, 0.02);
  solidBox(k, 'glass', x0 + 0.6, lowerY0, z0, x1 - 0.6, lowerY1, z0 + 0.6, GLASS_TINT, 0.02);
  solidBox(k, 'glass', x0 + 0.6, lowerY0, z1 - 0.6, x1 - 0.6, lowerY1, z1, GLASS_TINT, 0.02);

  // Street-level South Podium Facade (y = 0 .. 4.5 at z = +18) flanking the x = -4..+4 breakout ramp portal!
  solidBox(k, 'concrete', x0, 0, z1 - 0.8, DATACENTER.breakoutRamp.x0, lowerY0, z1, WHITE, 0.05);
  solidBox(k, 'concrete', DATACENTER.breakoutRamp.x1, 0, z1 - 0.8, x1, lowerY0, z1, WHITE, 0.05);

  // Finished corporate lobby storefront windows, warm-lit reception bays & cantilevered glass canopies on flanking wings!
  for (const side of [-1, 1] as const) {
    const wingX0 = side < 0 ? -24.2 : 6.4;
    const wingX1 = side < 0 ? -6.4 : 24.2;
    const wingCx = (wingX0 + wingX1) / 2;
    const wingHx = (wingX1 - wingX0) / 2;
    // Recessed dark-framed lobby window bay with warm interior glow
    g.use('panel').tint(...CORE_DARK).box(wingCx, 2.2, z1 + 0.03, wingHx, 1.85, 0.04, FACE.pz);
    g.use('emissiveDim').tint(...WARM_OFFICE).box(wingCx, 2.75, z1 + 0.08, wingHx - 0.6, 0.95, 0.02, FACE.pz);
    g.use('glass').tint(...GLASS_TINT).box(wingCx, 2.2, z1 + 0.12, wingHx, 1.85, 0.04, FACE.pz);
    // Vertical brushed steel lobby mullions
    g.use('steelDark').tint(...GRAPHITE);
    for (let mx = wingX0; mx <= wingX1 + 0.01; mx += 3.56) {
      g.bevel(mx, 2.2, z1 + 0.15, 0.09, 1.95, 0.12, 0.02);
    }
    // Cantilevered architectural porte-cochère canopy (clear of x = -6..+6 ORION breakout lane!)
    g.use('steelDark').tint(...GRAPHITE).bevel(wingCx, 4.35, z1 + 1.5, wingHx + 0.3, 0.16, 1.55, 0.04);
    g.use('emissiveDim').tint(...WARM_OFFICE).box(wingCx, 4.18, z1 + 1.5, wingHx - 0.4, 0.02, 0.85, FACE.ny);
    g.use('concrete').tint(...WHITE);
    g.bevel(wingX0 + 0.4, 2.1, z1 + 2.6, 0.28, 2.1, 0.28, 0.04);
    g.bevel(wingX1 - 0.4, 2.1, z1 + 2.6, 0.28, 2.1, 0.28, 0.04);
  }
  // Monumental white & graphite architectural lintel framing the street breakout portal.
  g.use('steelDark').tint(...GRAPHITE).bevel(0, lowerY0 + 0.35, z1 + 0.18, 5.8, 0.45, 0.45, 0.04);
  g.use('screen').tint(0.65, 0.85, 0.98).box(0, lowerY0 + 0.16, z1 + 0.32, 23.5, 0.1, 0.06, FACE.pz);
  // Bold corporate OpenMind HQ tower header emblem high on the south facade
  g.use('steelDark').tint(...GRAPHITE).bevel(0, 29.5, z1 + 0.24, 10.5, 1.8, 0.28, 0.05);
  g.use('emissiveCyan').tint(1).box(0, 31.35, z1 + 0.36, 10.4, 0.12, 0.08, FACE.pz);
  g.use('emissiveCyan').tint(1).box(0, 27.65, z1 + 0.36, 10.4, 0.12, 0.08, FACE.pz);
  mountSign(k, 0, 29.5, z1 + 0.56, 0, 'COMPLIANCE IS MANDATORY', 12.0);
  mountSign(k, -15.3, 5.65, z1 + 0.18, 0, 'EXECUTIVE SUITE', 4.4);
  mountSign(k, 15.3, 5.65, z1 + 0.18, 0, 'OPEN OFFICE', 4.4);

  // Horizontal white architectural floor spandrel fins & corner mega-columns from street (y=0) cleanly to executive roofline!
  const mainRoofY = execCeil + 0.8;
  g.use('concrete').tint(...WHITE);
  for (const sx of [x0 + 0.6, x1 - 0.6]) {
    for (const sz of [z0 + 0.6, z1 - 0.6]) {
      g.bevel(sx, mainRoofY / 2, sz, 0.9, mainRoofY / 2, 0.9, 0.08);
    }
  }
  for (let y = lowerY0 + 4.8; y < mezzY; y += 4.8) {
    g.box(cx, y, cz, hx + 0.22, 0.38, hz + 0.22, FACE.sides);
  }
  // Vertical architectural mullions on ALL FOUR facades (South, North, West, East) for crisp curtain-wall realism.
  g.use('steel').tint(...WARM_GRAY);
  for (let x = x0 + 4; x <= x1 - 4; x += 4) {
    g.box(x, lowerCy, z1 + 0.1, 0.11, lowerH / 2, 0.14, FACE.pz | FACE.px | FACE.nx);
    g.box(x, lowerCy, z0 - 0.1, 0.11, lowerH / 2, 0.14, FACE.nz | FACE.px | FACE.nx);
  }
  for (let z = z0 + 4; z <= z1 - 4; z += 4) {
    g.box(x0 - 0.1, lowerCy, z, 0.14, lowerH / 2, 0.11, FACE.nx | FACE.pz | FACE.nz);
    g.box(x1 + 0.1, lowerCy, z, 0.14, lowerH / 2, 0.11, FACE.px | FACE.pz | FACE.nz);
  }
  g.tint(1);

  // --- Mezzanine & Executive Floor Perimeter Walls (y = 34 .. 48) ---
  // West & East perimeter walls (sleek white architectural precast with dark-backed recessed glass ribbon windows).
  solidBox(k, 'concrete', x0, mezzY, z0, x0 + 0.6, execCeil, z1, WHITE, 0.04);
  solidBox(k, 'concrete', x1 - 0.6, mezzY, z0, x1, execCeil, z1, WHITE, 0.04);
  // Recessed dark slate backing + exterior glass ribbon bands + mullions on W/E facades
  g.use('panel').tint(...CORE_SLATE);
  g.box(x0 - 0.02, mezzY + 4, cz, 0.03, 2.35, hz - 2.1, FACE.nx);
  g.box(x1 + 0.02, mezzY + 4, cz, 0.03, 2.35, hz - 2.1, FACE.px);
  g.box(x0 - 0.02, execY + 3, cz, 0.03, 2.45, hz - 2.1, FACE.nx);
  g.box(x1 + 0.02, execY + 3, cz, 0.03, 2.45, hz - 2.1, FACE.px);
  g.use('glass').tint(...GLASS_TINT);
  g.box(x0 - 0.07, mezzY + 4, cz, 0.04, 2.35, hz - 2.1, FACE.nx);
  g.box(x1 + 0.07, mezzY + 4, cz, 0.04, 2.35, hz - 2.1, FACE.px);
  g.box(x0 - 0.07, execY + 3, cz, 0.04, 2.45, hz - 2.1, FACE.nx);
  g.box(x1 + 0.07, execY + 3, cz, 0.04, 2.45, hz - 2.1, FACE.px);
  g.use('steel').tint(...WARM_GRAY);
  for (let z = z0 + 4; z <= z1 - 4; z += 4) {
    g.box(x0 - 0.1, (mezzY + execCeil) / 2, z, 0.1, (execCeil - mezzY) / 2, 0.1, FACE.nx | FACE.pz | FACE.nz);
    g.box(x1 + 0.1, (mezzY + execCeil) / 2, z, 0.1, (execCeil - mezzY) / 2, 0.1, FACE.px | FACE.pz | FACE.nz);
  }
  g.tint(1);

  // North facade (z = -12): solid on Mezzanine (34..42); on Executive (42..48) WIDE OPEN x = -7..+7 for the 14 m x 6 m breakable glass wall!
  solidBox(k, 'concrete', x0 + 0.6, mezzY, z0, x1 - 0.6, execY, z0 + 0.6, WHITE, 0.04);
  solidBox(k, 'concrete', x0 + 0.6, execY, z0, OFFICE.curtainWall.x0, execCeil, z0 + 0.6, WHITE, 0.04);
  solidBox(k, 'concrete', OFFICE.curtainWall.x1, execY, z0, x1 - 0.6, execCeil, z0 + 0.6, WHITE, 0.04);
  // Recessed facade ribbon windows on solid North Mezzanine & Executive flanks
  g.use('panel').tint(...CORE_SLATE);
  g.box(cx, mezzY + 4, z0 - 0.02, hx - 2.4, 2.2, 0.03, FACE.nz);
  g.box(-16.5, execY + 3, z0 - 0.02, 7.6, 2.3, 0.03, FACE.nz);
  g.box(16.5, execY + 3, z0 - 0.02, 7.6, 2.3, 0.03, FACE.nz);
  g.use('glass').tint(...GLASS_TINT);
  g.box(cx, mezzY + 4, z0 - 0.07, hx - 2.4, 2.2, 0.04, FACE.nz);
  g.box(-16.5, execY + 3, z0 - 0.07, 7.6, 2.3, 0.04, FACE.nz);
  g.box(16.5, execY + 3, z0 - 0.07, 7.6, 2.3, 0.04, FACE.nz);
  g.tint(1);

  // --- 14 m x 6 m Floor-to-Ceiling Breakable Glass Curtain Wall facing Launch Crane (z = -12, x = -7..+7, y = 42..48) ---
  const cw = OFFICE.curtainWall;
  const paneW = cw.width / cw.panesX;  // 2.0 m
  const paneH = cw.height / cw.panesY; // 3.0 m
  for (let ix = 0; ix < cw.panesX; ix++) {
    const px = cw.x0 + (ix + 0.5) * paneW;
    for (let iy = 0; iy < cw.panesY; iy++) {
      const py = cw.y0 + (iy + 0.5) * paneH;
      spec.breakable('pane', px, py, cw.z + 0.1, 0, paneW, paneH);
    }
  }
  // Visual-only graphite transom/mullion accents around the curtain wall opening (zero collider obstruction!).
  g.use('steelDark').tint(...GRAPHITE);
  g.bevel(cw.x0 - 0.14, execY + 3, cw.z, 0.14, 3.0, 0.35, 0.03);
  g.bevel(cw.x1 + 0.14, execY + 3, cw.z, 0.14, 3.0, 0.35, 0.03);
  g.bevel(0, execCeil + 0.14, cw.z, cw.width / 2 + 0.3, 0.18, 0.38, 0.03);
  g.use('emissiveCyan').tint(1).box(0, execCeil + 0.36, cw.z - 0.18, cw.width / 2 + 0.4, 0.08, 0.06, FACE.nz);
  g.tint(1);

  // South facade (z = +18, overlooking Grand Boulevard): solid on Mezzanine; panoramic breakable glass wall x = -10..+10 on Executive!
  solidBox(k, 'concrete', x0 + 0.6, mezzY, z1 - 0.6, x1 - 0.6, execY, z1, WHITE, 0.04);
  solidBox(k, 'concrete', x0 + 0.6, execY, z1 - 0.6, -10, execCeil, z1, WHITE, 0.04);
  solidBox(k, 'concrete', 10, execY, z1 - 0.6, x1 - 0.6, execCeil, z1, WHITE, 0.04);
  // Recessed ribbon windows on South Mezzanine & Executive flanks
  g.use('panel').tint(...CORE_SLATE);
  g.box(cx, mezzY + 4, z1 + 0.02, hx - 2.4, 2.2, 0.03, FACE.pz);
  g.box(-17.8, execY + 3, z1 + 0.02, 6.2, 2.3, 0.03, FACE.pz);
  g.box(17.8, execY + 3, z1 + 0.02, 6.2, 2.3, 0.03, FACE.pz);
  g.use('glass').tint(...GLASS_TINT);
  g.box(cx, mezzY + 4, z1 + 0.07, hx - 2.4, 2.2, 0.04, FACE.pz);
  g.box(-17.8, execY + 3, z1 + 0.07, 6.2, 2.3, 0.04, FACE.pz);
  g.box(17.8, execY + 3, z1 + 0.07, 6.2, 2.3, 0.04, FACE.pz);
  g.tint(1);
  for (let ix = 0; ix < 10; ix++) {
    const px = -10 + (ix + 0.5) * 2.0;
    spec.breakable('pane', px, execY + 1.5, z1 - 0.1, 0, 2.0, 3.0);
    spec.breakable('pane', px, execY + 4.5, z1 - 0.1, 0, 2.0, 3.0);
  }
  // Crisp white spandrel ledges separating Mezzanine, Executive Floor, and Crown
  g.use('concrete').tint(...WHITE);
  g.box(cx, mezzY, cz, hx + 0.25, 0.42, hz + 0.25, FACE.sides);
  g.box(cx, execY, cz, hx + 0.25, 0.42, hz + 0.25, FACE.sides);

  // --- Executive Roof Slab & Sculpted Corporate Crown Penthouse (y = 48 .. 64) ---
  k.floor('concrete', x0, z0, x1, z1, execCeil + 0.6, 0.6, 5);
  // Tier 1 mechanical parapet & louver screen (y = 48.6..56.4)
  g.use('concrete').tint(...WHITE).bevel(cx, 52.5, cz, hx - 1.5, 4.0, hz - 1.5, 0.15);
  g.use('steelDark').tint(...GRAPHITE);
  for (let lx = -18; lx <= 18; lx += 3.6) {
    g.box(lx, 52.5, cz + hz - 1.45, 1.2, 2.5, 0.08, FACE.pz);
    g.box(lx, 52.5, cz - hz + 1.45, 1.2, 2.5, 0.08, FACE.nz);
  }
  // Tier 2 glass penthouse with SOLID opaque recessed core + mullions + soft architectural dusk glow!
  g.use('panel').tint(...CORE_SLATE).bevel(cx, 58.2, cz, hx - 5.4, 3.1, hz - 4.4, 0.1);
  g.use('screen').tint(...COOL_OFFICE).box(cx, 58.5, cz, hx - 5.25, 0.65, hz - 4.25, FACE.sides);
  g.use('glass').tint(...GLASS_TINT).bevel(cx, 58.2, cz, hx - 4.9, 3.2, hz - 3.9, 0.12);
  g.use('steel').tint(...WARM_GRAY);
  for (let mx = -18; mx <= 18; mx += 4.5) {
    g.box(mx, 58.2, cz + hz - 3.85, 0.12, 3.2, 0.12, FACE.pz);
    g.box(mx, 58.2, cz - hz + 3.85, 0.12, 3.2, 0.12, FACE.nz);
  }
  // Tier 3 sculpted corporate cap + twin architectural communication masts
  g.use('concrete').tint(...WHITE).bevel(cx, 62.4, cz, hx - 8.2, 1.5, hz - 6.2, 0.1);
  g.use('steel').tint(...WHITE);
  g.cyl(cx - 6, 63.8, cz, cx - 6, 74.5, cz, 0.28, 0.06, 8);
  g.cyl(cx + 6, 63.8, cz, cx + 6, 72.0, cz, 0.24, 0.06, 8);
  g.use('emissiveRed').tint(1).box(cx - 6, 74.7, cz, 0.22, 0.22, 0.22, FACE.all);
  g.use('emissiveRed').tint(1).box(cx + 6, 72.2, cz, 0.22, 0.22, 0.22, FACE.all);
  // Signature crisp cyan OpenMind architectural halo rings wrapping the skyscraper crown!
  g.use('screen').tint(0.65, 0.88, 1.0);
  g.box(cx, 48.8, cz, hx + 0.3, 0.2, hz + 0.3, FACE.sides);
  g.box(cx, 56.6, cz, hx - 1.2, 0.2, hz - 1.2, FACE.sides);
  g.use('emissiveCyan').tint(0.85).box(cx, 63.8, cz, hx - 8.0, 0.22, hz - 6.0, FACE.sides);
  g.tint(1);

  spec.plan?.fills.push({ x0, z0, x1, z1, rgb: [184, 214, 238], label: 'OPENMIND HQ' });
}

/** Executive Floor (y = 42): partitioned slab around skylight & grand stair, conference room, cubicles, exec suite. */
function buildExecutiveFloor(k: Kit, spec: MapSpec): void {
  const { x0, x1, z0, z1, execY: y, skylight: sk, grandStair: gs } = OFFICE;
  const thick = 0.6;
  const stairX0 = gs.x - gs.width / 2 - 0.1; // -22.8
  const stairX1 = gs.x + gs.width / 2 + 0.1; // -19.2

  // Partition y = 42 Executive Floor slab cleanly around BOTH the 6x6 skylight (x:-3..3, z:-1..5) and the west stair well!
  k.floor('tile', x0 + 0.6, z0 + 0.6, x1 - 0.6, gs.z0, y, thick, 4);               // North band (z = -11.4..-4, conference room!)
  k.floor('tile', x0 + 0.6, gs.z1, x1 - 0.6, z1 - 0.6, y, thick, 4);               // South panorama band (z = 12..17.4)
  k.floor('tile', x0 + 0.6, gs.z0, stairX0, gs.z1, y, thick, 2);                   // Far west rim beside stair
  k.floor('tile', stairX1, gs.z0, sk.x0, gs.z1, y, thick, 3);                      // West-mid between stair & skylight
  k.floor('tile', sk.x1, gs.z0, x1 - 0.6, gs.z1, y, thick, 4);                     // East open office floor
  k.floor('tile', sk.x0, gs.z0, sk.x1, sk.z0, y, thick, 2);                        // Strip north of skylight (z = -4..-1)
  k.floor('tile', sk.x0, sk.z1, sk.x1, gs.z1, y, thick, 2);                        // Strip south of skylight (z = 5..12)

  // Cool corporate carpet accents (visual inlays).
  const g = k.geo;
  g.use('carpet').tint(...CARPET_COOL);
  g.slab(0, y + 0.012, -6.5, 8.8, 0.008, 4.2, 4, FACE.py);
  g.slab(15, y + 0.012, 3, 8.2, 0.008, 11.5, 4, FACE.py);
  g.tint(1);

  // --- 6 m x 6 m Breakable Floor Skylight (x: -3..+3, z: -1..+5, y = 42) ---
  // Low chamfered steel curb around the aperture (never blocks falling through once shattered!).
  g.use('steelDark').tint(...GRAPHITE);
  g.bevel(0, y + 0.08, sk.z0 - 0.14, 3.28, 0.08, 0.14, 0.02);
  g.bevel(0, y + 0.08, sk.z1 + 0.14, 3.28, 0.08, 0.14, 0.02);
  g.bevel(sk.x0 - 0.14, y + 0.08, (sk.z0 + sk.z1) / 2, 0.14, 0.08, 3.0, 0.02);
  g.bevel(sk.x1 + 0.14, y + 0.08, (sk.z0 + sk.z1) / 2, 0.14, 0.08, 3.0, 0.02);
  g.use('emissiveCyan').tint(0.9);
  g.box(0, y + 0.17, sk.z0 - 0.14, 3.1, 0.02, 0.04, FACE.py);
  g.box(0, y + 0.17, sk.z1 + 0.14, 3.1, 0.02, 0.04, FACE.py);
  g.tint(1);
  // 3 x 3 grid of flat breakable glass `pane`s spanning the 6 m x 6 m skylight!
  for (let ix = 0; ix < 3; ix++) {
    for (let iz = 0; iz < 3; iz++) {
      spec.breakable('pane', sk.x0 + 1 + ix * 2, y - 0.02, sk.z0 + 1 + iz * 2, 0, 2.0, 2.0, true);
    }
  }

  // --- Executive Conference Room (directly behind the 14 m x 6 m launch glass wall!) ---
  conferenceTable(k, 0, y, -6.5, 6.4, 1.8);
  for (const cx of [-2.2, -0.7, 0.7, 2.2]) {
    spec.breakable('chair', cx, y, -8.0, 0);
    spec.breakable('chair', cx, y, -5.0, Math.PI);
  }
  spec.breakable('monitor', -1.4, y + 0.79, -6.5, Math.PI);
  spec.breakable('monitor', 1.4, y + 0.79, -6.5, Math.PI);
  spec.breakable('plant', -8.8, y, -10.5, 0);
  spec.breakable('plant', 8.8, y, -10.5, 0);
  // Glass conference side walls with breakable `pane`s flanking the room at x = -10 and x = +10.
  for (const sideX of [-10, 10]) {
    for (const pz of [-9.5, -6.5]) {
      spec.breakable('pane', sideX, y + 1.5, pz, Math.PI / 2, 2.8, 3.0);
    }
    k.column(sideX, -4.4, y, OFFICE.execCeil, 0.45, 'steelDark');
  }
  mountSign(k, 0, y + 4.4, -1.6, Math.PI, 'EXECUTIVE SUITE', 2.8);

  // --- East Open Office Cubicle Floor (x: +10..+24, z: -10..+15) ---
  for (const px of [14, 20.5]) {
    for (const pz of [-6, 2, 10]) {
      cubiclePod(k, spec, px, y, pz);
    }
  }
  spec.breakable('copier', 24.4, y, -1.8, -Math.PI / 2);
  spec.breakable('copier', 24.4, y, 6.2, -Math.PI / 2);
  spec.breakable('vending', 24.4, y, 13.8, -Math.PI / 2);
  spec.breakable('vending', 24.4, y, 15.6, -Math.PI / 2);
  spec.breakable('cooler', 10.6, y, 15.6, Math.PI);
  spec.breakable('extinguisher', 25.2, y + 1.1, 2.0, -Math.PI / 2);
  spec.breakable('plant', 10.4, y, 16.4, 0);
  spec.breakable('plant', 24.4, y, -10.4, 0);
  mountSign(k, 17, y + 4.2, -11.3, 0, 'OPEN OFFICE', 2.6);

  // --- West Executive Suite (Ram Faultman's Office) & Break Lounge ---
  officeDesk(k, -17.5, y, -7.8, 0, WALNUT);
  spec.breakable('monitor', -17.9, y + 0.76, -8.0, 0);
  spec.breakable('monitor', -17.1, y + 0.76, -8.0, 0);
  spec.breakable('chair', -17.5, y, -8.9, 0);
  spec.breakable('chair', -18.2, y, -6.5, Math.PI);
  spec.breakable('chair', -16.8, y, -6.5, Math.PI);
  loungeSofa(k, -13.5, y, 3.0, -Math.PI / 2, 2.8);
  loungeSofa(k, -13.5, y, 9.0, -Math.PI / 2, 2.8);
  spec.breakable('copier', -12.5, y, 15.5, Math.PI);
  spec.breakable('vending', -15.5, y, 16.4, Math.PI);
  spec.breakable('cooler', -24.5, y, -10.5, 0);
  spec.breakable('plant', -24.5, y, -5.5, 0);
  spec.breakable('plant', -11.2, y, 16.4, 0);
  spec.breakable('extinguisher', -25.2, y + 1.1, 2.0, Math.PI / 2);
  mountSign(k, -17.5, y + 4.2, -11.3, 0, 'DIRECTOR', 2.2);
  mountSign(k, -16, y + 3.8, 17.3, Math.PI, 'SMILE: YOU ARE BEING AUDITED', 3.4);

  // Executive interior architectural finish: walnut credenza/feature panel, structural columns, & acoustic ceiling ribs.
  g.use('plaster').tint(...WALNUT).bevel(-17.5, y + 2.2, -11.2, 4.4, 2.2, 0.14, 0.03);
  g.use('emissiveCyan').tint(0.85).box(-17.5, y + 4.45, -11.12, 4.2, 0.06, 0.06, FACE.pz);
  // Crisp structural steel-and-white columns framing the open floor & conference lounge
  k.column(-10, 11.0, y, OFFICE.execCeil, 0.45, 'steelDark');
  k.column(10, 11.0, y, OFFICE.execCeil, 0.45, 'steelDark');
  // Recessed acoustic ceiling structural beams running east-west across the 80th floor
  g.use('steelDark').tint(...GRAPHITE);
  for (const bz of [-8.5, -1.5, 5.5, 12.5]) {
    g.box(0, OFFICE.execCeil - 0.14, bz, (x1 - x0) / 2 - 0.8, 0.14, 0.16, FACE.sides | FACE.ny);
  }
  g.tint(1);

  // Guard railings around the West Grand Staircase well on Executive Floor.
  k.rail([stairX1, y, gs.z0, stairX1, y, gs.z1, stairX0, y, gs.z1]);
  k.rail([stairX0, y, gs.z0, stairX0, y, gs.z1]);

  // Overhead sleek ceiling light bars on Executive Floor (6 baked lights).
  for (const lx of [-16, 0, 16]) {
    for (const lz of [-6, 8]) {
      k.lampBar(lx, OFFICE.execCeil - 0.15, lz, 0, 3.6, 'white', 46, 20);
    }
  }
}

/** Engineering Mezzanine (y = 34), Grand Glass Staircase, AI Lab, Service Corridor & 6x6 Freight Elevator Shaft. */
function buildMezzanineAndShaft(k: Kit, spec: MapSpec): void {
  const { x0, x1, z0, z1, mezzY: y, mezzCeil, grandStair: gs } = OFFICE;
  const sh = ELEVATOR_SHAFT;
  const thick = 0.6;

  // Partition y = 34 Mezzanine floor slab cleanly around the 6 m x 6 m Freight Elevator Shaft (x: 14..20, z: 8..14)!
  k.floor('tile', x0 + 0.6, z0 + 0.6, x1 - 0.6, sh.z0, y, thick, 4);    // North & Center Mezzanine (z = -11.4..8)
  k.floor('tile', x0 + 0.6, sh.z0, sh.x0, z1 - 0.6, y, thick, 4);       // South-West & Service Lobby west of shaft (x = -25.4..14, z = 8..17.4)
  k.floor('tile', sh.x1, sh.z0, x1 - 0.6, z1 - 0.6, y, thick, 2);       // East rim beside shaft (x = 20..25.4)
  k.floor('tile', sh.x0, sh.z1, sh.x1, z1 - 0.6, y, thick, 2);          // South rim behind shaft (z = 14..17.4)

  // --- West Grand Glass Staircase linking Mezzanine (y = 34) <-> Executive Floor (y = 42) ---
  // Run = 16 m (z = 12 -> -4), rise = 8 m -> slope = 0.50, ny = 0.894 (super smooth walkable!).
  k.stairs(gs.x, gs.z1, gs.y0, gs.x, gs.z0, gs.y1, gs.width, 'steel', true);

  // --- Central Atrium below Skylight (x: -4..+4, z: -1..+5) ---
  // Glowing cyan holographic server pedestal & flanking glass railings.
  const g = k.geo;
  g.use('steelDark').tint(...GRAPHITE).bevel(0, y + 0.52, 2, 1.8, 0.52, 0.85, 0.04);
  g.use('emissiveCyan').tint(0.95).box(0, y + 1.06, 2, 1.5, 0.03, 0.6, FACE.py);
  g.tint(1);
  k.collide(0, y + 0.52, 2, 1.8, 0.52, 0.85, 'metal');
  spec.breakable('plant', -5.4, y, -1.2, 0);
  spec.breakable('plant', 5.4, y, -1.2, 0);
  spec.breakable('plant', -5.4, y, 5.2, 0);
  spec.breakable('plant', 5.4, y, 5.2, 0);

  // --- AI Lab & Engineering Workstations (North & West Mezzanine) ---
  for (const px of [-10, 4, 16]) {
    cubiclePod(k, spec, px, y, -6.5);
  }
  // Test server racks along east engineering wall (exploding chain targets!).
  for (let rz = -9.5; rz <= 5.0; rz += 1.05) {
    spec.breakable('rack', 24.4, y, rz, -Math.PI / 2);
  }
  spec.breakable('copier', -14.5, y, 4.5, Math.PI / 2);
  spec.breakable('vending', -14.5, y, 14.8, Math.PI / 2);
  spec.breakable('cooler', -5.5, y, 14.5, Math.PI);
  spec.breakable('extinguisher', 3.5, y + 1.1, 7.6, Math.PI);
  // Glass partition panes dividing AI Lab & Service Corridor.
  for (const gx of [-12, -8, -4]) {
    spec.breakable('pane', gx, y + 1.5, 7.8, 0, 2.8, 3.0);
  }

  // --- Rear Service Corridor & Freight Elevator Lobby (x = 4..14, z = 8..14) ---
  // North partition wall of Service Corridor (z = 8, x = 4..14) with 3.4 m entrance archway at x = 4..7.4.
  solidBox(k, 'concrete', 7.4, y, 7.75, 14.0, mezzCeil, 8.25, WARM_GRAY, 0.04);
  // South partition wall (z = 14, x = 4..14)
  solidBox(k, 'concrete', 4.0, y, 13.75, 14.0, mezzCeil, 14.25, WARM_GRAY, 0.04);
  // Heavy Rifle / Autocannon service rack alcove against north corridor wall (x = 10, z = 8.6).
  g.use('steelDark').tint(...GRAPHITE).bevel(10.2, y + 1.1, 8.55, 1.3, 1.1, 0.25, 0.03);
  g.use('emissiveOrange').tint(0.95).box(10.2, y + 2.25, 8.75, 1.1, 0.07, 0.04, FACE.pz);
  g.tint(1);
  mountSign(k, 10.2, y + 3.6, 8.3, 0, 'THE LIFT IS UNDER REVIEW', 3.0);
  mountSign(k, 13.7, y + 4.1, 11.0, -Math.PI / 2, 'LOADING', 2.2);
  k.lampBar(9.0, mezzCeil - 0.15, 11.0, 0, 3.0, 'orange', 34, 16);

  // Mezzanine ceiling lamp bars (6 baked lights).
  for (const lx of [-15, 0, 15]) {
    for (const lz of [-6, 4]) {
      k.lampBar(lx, mezzCeil - 0.15, lz, 0, 3.4, 'white', 40, 18);
    }
  }

  // --- 6 m x 6 m Freight Elevator Shaft (x = 14..20, z = 8..14, y = -6 .. 41.4) ---
  const shaftY0 = sh.bottomY; // -6
  const shaftY1 = mezzCeil;   // 41.4
  const wallT = 0.35;

  // North, South, and East continuous reinforced concrete shaft walls (y = -6..41.4).
  solidBox(k, 'concreteDark', sh.x0, shaftY0, sh.z0 - wallT, sh.x1 + wallT, shaftY1, sh.z0, GRAPHITE, 0.02);
  solidBox(k, 'concreteDark', sh.x0, shaftY0, sh.z1, sh.x1 + wallT, shaftY1, sh.z1 + wallT, GRAPHITE, 0.02);
  solidBox(k, 'concreteDark', sh.x1, shaftY0, sh.z0, sh.x1 + wallT, shaftY1, sh.z1, GRAPHITE, 0.02);

  // West shaft wall (x = 14) with clean open elevator portals at Mezzanine (y=34..37.6) and Vault (y=-6..-2.2)!
  // Middle shaft wall between Vault portal top (-2.2) and Mezzanine floor (34.0)
  solidBox(k, 'concreteDark', sh.x0 - wallT, -2.2, sh.z0, sh.x0, sh.topY, sh.z1, GRAPHITE, 0.02);
  // Header above Mezzanine portal (37.6 .. 41.4)
  solidBox(k, 'concreteDark', sh.x0 - wallT, sh.topY + 3.6, sh.z0, sh.x0, shaftY1, sh.z1, GRAPHITE, 0.02);
  // Portal jamb piers flanking z = 9.1..12.9 at both Mezzanine and Vault entries
  for (const [py0, py1] of [[sh.bottomY, -2.2], [sh.topY, sh.topY + 3.6]] as const) {
    solidBox(k, 'steelDark', sh.x0 - wallT, py0, sh.z0, sh.x0, py1, 9.1, GRAPHITE, 0.02);
    solidBox(k, 'steelDark', sh.x0 - wallT, py0, 12.9, sh.x0, py1, sh.z1, GRAPHITE, 0.02);
  }
  spec.plan?.doors.push({ x: sh.x0, z: sh.cz, dx: 1, dz: 0, w: 3.8 });

  // 4 vertical steel guide rails inside the corners of the 6x6 shaft (visual only so kinematic cab never snags).
  g.use('steel').tint(0.65, 0.7, 0.78);
  for (const [ox, oz] of sh.clampOffsets) {
    g.box(sh.cx + ox, (shaftY0 + shaftY1) / 2, sh.cz + oz, 0.14, (shaftY1 - shaftY0) / 2, 0.14, FACE.sides);
  }
  // Scrolling-style red/cyan emergency floor-marker light strips down the shaft walls!
  for (let sy = 0; sy <= 32; sy += 4) {
    const isJamZone = Math.abs(sy - sh.jamY) <= 5;
    g.use(isJamZone ? 'emissiveRed' : 'emissiveCyan').tint(0.9);
    g.box(sh.x1 - 0.06, sy, sh.cz, 0.05, 0.12, 2.2, FACE.nx);
    g.box(sh.cx, sy, sh.z0 + 0.06, 2.2, 0.12, 0.05, FACE.pz);
    g.box(sh.cx, sy, sh.z1 - 0.06, 2.2, 0.12, 0.05, FACE.nz);
  }
  g.tint(1);

  // Red emergency beacon lights inside the Freight Shaft (3 lights).
  k.light(sh.cx, sh.jamY, sh.cz, 'red', 42, 16);
  k.light(sh.cx, 6, sh.cz, 'cyan', 28, 14);
  k.light(sh.cx, 28, sh.cz, 'white', 30, 14);

  // Breakable ceiling grate panes right above Sub-Level 4 Vault landing (y = ELEVATOR_SHAFT.grateY = -1.4).
  for (const ox of [-2, 0, 2]) {
    for (const oz of [-2, 0, 2]) {
      spec.breakable('pane', sh.cx + ox, sh.grateY, sh.cz + oz, 0, 2.0, 2.0, true);
    }
  }
}

export function authorOffice(k: Kit, spec: MapSpec): void {
  buildHqExteriorShell(k, spec);
  buildExecutiveFloor(k, spec);
  buildMezzanineAndShaft(k, spec);

  // NavGraph vertical link bridging Mezzanine Service Lobby (y=34) <-> Vault Elevator Entry (y=-6).
  spec.jump(12.5, LV.mezz, 11, 12.5, LV.vault, 11, true);
}
