/**
 * Sci-fi starship / orbital Bureau training vessel architecture kit for the Retraining Annex.
 * Chamfered bulkhead ribs, layered hull paneling, hydraulic airlock portals, cylindrical cryo-clone pods,
 * cantilevered evaluator observation booths, glowing floor wayfinding chevrons, and telemetry consoles.
 *
 * All decorative pieces are collider-free where a player runs or slides; structural slabs carry clean colliders.
 */
import { FACE, type Mat } from '../../kit/geo';
import type { Kit, LampColor } from '../../kit/kit';
import { cable, pipe } from '../../kit/props';
import { signId, type SignName } from '../../kit/signs';

/** Cool slate-blue starship hull tint palette. */
export const HULL_TINTS: readonly (readonly [number, number, number])[] = [
  [0.74, 0.80, 0.88],
  [0.68, 0.75, 0.84],
  [0.80, 0.85, 0.92],
  [0.64, 0.71, 0.80],
];

/** Backlit starship gantry sign facing local +Z (`yaw = Math.PI` faces north along -Z). */
export function sign(k: Kit, x: number, y: number, z: number, yaw: number, name: SignName, w = 2.6, h?: number): void {
  const sh = h ?? w / 4;
  k.push(x, y, z, yaw);
  const g = k.geo;
  // Bevelled titanium housing with corner brackets and thin top glow rail.
  g.use('steelDark').bevel(0, 0, -0.02, w / 2 + 0.12, sh / 2 + 0.12, 0.06, 0.03);
  g.use('steel').tint(0.76, 0.82, 0.9);
  g.bevel(-w / 2 - 0.1, 0, 0.02, 0.05, sh / 2 + 0.14, 0.06, 0.015);
  g.bevel(w / 2 + 0.1, 0, 0.02, 0.05, sh / 2 + 0.14, 0.06, 0.015);
  g.tint(1);
  g.use('signs').quadUV(-w / 2, -sh / 2, 0.052, w / 2, sh / 2, signId(name));
  g.use('emissiveCyan').box(0, sh / 2 + 0.1, 0.04, w / 2 - 0.08, 0.014, 0.015, FACE.pz | FACE.py);
  k.pop();
}

/**
 * Heavy chamfered starship bulkhead wall slab with a doorway centred on `at` along X (east-west wall).
 * Adds angled octagonal corner gussets, dual hydraulic actuator cylinders, illuminated portal jambs, and hazard threshold.
 */
export function bulkheadWall(
  k: Kit,
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  y0: number,
  h: number,
  at: number,
  w: number,
  dh: number,
  accent: Mat = 'emissiveCyan',
): void {
  const g = k.geo;
  const zc = (z0 + z1) / 2;
  const hz = (z1 - z0) / 2;
  const halfW = w / 2;

  // Solid structural masses around the opening.
  k.mass('panel', x0, y0, z0, at - halfW, y0 + h, z1, 3, true);
  k.mass('panel', at + halfW, y0, z0, x1, y0 + h, z1, 3, true);
  k.mass('panel', at - halfW, y0 + dh, z0, at + halfW, y0 + h, z1, 3, true);

  // Dark titanium structural ribs flanking the doorway on both faces.
  for (const s of [-1, 1]) {
    const faceZ = zc + s * (hz + 0.08);
    // Heavy steelDark jamb columns.
    g.use('steelDark');
    g.bevel(at - halfW - 0.28, y0 + dh / 2, zc, 0.3, dh / 2 + 0.15, hz + 0.18, 0.06);
    g.bevel(at + halfW + 0.28, y0 + dh / 2, zc, 0.3, dh / 2 + 0.15, hz + 0.18, 0.06);
    // Heavy header lintel.
    g.bevel(at, y0 + dh + 0.28, zc, halfW + 0.65, 0.3, hz + 0.2, 0.07);
    // Octagonal upper corner chamfers (decorative, above head clearance).
    const ch = Math.min(0.65, halfW * 0.32);
    k.beam(at - halfW, y0 + dh - ch, faceZ, at - halfW + ch, y0 + dh, faceZ, 0.12, 0.12, 'steelDark');
    k.beam(at + halfW, y0 + dh - ch, faceZ, at + halfW - ch, y0 + dh, faceZ, 0.12, 0.12, 'steelDark');
    // Dual hydraulic actuator cylinders beside each jamb.
    g.use('steel').tint(0.75, 0.82, 0.9);
    for (const side of [-1, 1]) {
      const px = at + side * (halfW + 0.72);
      g.cyl(px, y0 + 0.2, faceZ, px, y0 + dh * 0.55, faceZ, 0.11, 0.11, 10);
      g.use('steelDark').cyl(px, y0 + dh * 0.55, faceZ, px, y0 + dh + 0.1, faceZ, 0.06, 0.06, 8);
      g.use('steel').tint(0.75, 0.82, 0.9);
    }
    g.tint(1);
    // Thin inset glowing portal jamb strips.
    g.use(accent);
    g.box(at - halfW - 0.06, y0 + dh * 0.5, zc + s * (hz + 0.19), 0.03, dh * 0.42, 0.02);
    g.box(at + halfW + 0.06, y0 + dh * 0.5, zc + s * (hz + 0.19), 0.03, dh * 0.42, 0.02);
    g.box(at, y0 + dh + 0.06, zc + s * (hz + 0.21), halfW - 0.15, 0.03, 0.02);
  }
  // Threshold hazard bar flush on the deck.
  g.use('hazard').box(at, y0 + 0.012, zc, halfW, 0.006, hz + 0.12, FACE.py);
}

/**
 * Massive chamfered starship hull rib arch spanning across X (`x0..x1`) at `z`, from `y0` up to `yTop`.
 * When `openTop` is true, spans overhead with an open lattice truss so sky & drones stay visible.
 */
export function ribArch(
  k: Kit,
  x0: number,
  x1: number,
  z: number,
  y0: number,
  yTop: number,
  opts: { openTop?: boolean; accent?: Mat; thick?: number; cant?: number } = {},
): void {
  const g = k.geo;
  const thick = opts.thick ?? 0.55;
  const cant = opts.cant ?? Math.min(2.6, (x1 - x0) * 0.16);
  const accent = opts.accent ?? 'emissiveCyan';
  const yCant = yTop - cant;
  const cx = (x0 + x1) / 2;

  // Left & right angled hull ribs climbing from floor plinth to upper haunch.
  for (const side of [-1, 1]) {
    const xWall = side < 0 ? x0 : x1;
    const xIn = xWall - side * 0.36;
    const xCant = xWall - side * cant;
    // Lower pedestal kick-block.
    g.use('steelDark').bevel(xWall - side * 0.22, y0 + 0.6, z, 0.26, 0.6, thick * 0.6, 0.06);
    // Vertical rib spine (shallow so it hugs wall cleanly).
    g.use('steelDark').bevel(xWall - side * 0.16, (y0 + yCant) / 2, z, 0.18, (yCant - y0) / 2, thick * 0.45, 0.04);
    // Brushed metallic rib flange.
    g.use('steel').tint(0.72, 0.78, 0.88);
    g.bevel(xWall - side * 0.24, (y0 + yCant) / 2, z, 0.06, (yCant - y0) / 2 - 0.4, thick * 0.22, 0.02);
    g.tint(1);
    // Diagonal upper hull cant beam (angled haunch giving the unmistakable sci-fi corridor profile!).
    k.beam(xIn, yCant, z, xCant, yTop - 0.18, z, thick * 0.38, 0.26, 'steelDark');
    k.beam(xIn - side * 0.06, yCant - 0.2, z, xCant - side * 0.08, yTop - 0.35, z, thick * 0.16, 0.08, 'steel');
    // Thin inset glowing cyan spine accent along the angled haunch.
    k.along(xIn - side * 0.1, yCant - 0.32, z, xCant - side * 0.1, yTop - 0.45, z, len => {
      g.use(accent).box(len / 2, 0, 0, len / 2 - 0.15, 0.025, 0.025);
    });
  }

  // Overhead span connecting the two haunches.
  const spanA = x0 + cant, spanB = x1 - cant;
  if (spanB > spanA + 1) {
    if (opts.openTop) {
      k.truss(spanA, yTop - 0.15, z, spanB, yTop - 0.15, z, 0.75, 0.55, 'steelDark', 0.07);
    } else {
      g.use('steelDark').bevel(cx, yTop - 0.16, z, (spanB - spanA) / 2 + 0.3, 0.22, thick * 0.48, 0.05);
      g.use(accent).box(cx, yTop - 0.4, z, (spanB - spanA) / 2 - 0.6, 0.022, 0.03, FACE.ny | FACE.pz | FACE.nz);
    }
  }
}

/**
 * Sci-fi starship side wall dressing along an X=const face from `z0` to `z1`, `y0` to `y1`.
 * Adds layered bevelled armor hull plates (varied cool-slate tints), dark base plinth, recessed horizontal
 * conduit pipes, and thin glowing datum strips. `dir` is +1 if interior is at +X (west wall), -1 if at -X (east wall).
 * `flush` keeps everything <= 0.04 m proud of the wall for wall-run surfaces!
 */
export function dressHullWall(
  k: Kit,
  xFace: number,
  dir: 1 | -1,
  z0: number,
  z1: number,
  y0: number,
  y1: number,
  opts: { bay?: number; flush?: boolean; stripY?: number[]; accent?: Mat; pipes?: boolean } = {},
): void {
  const g = k.geo;
  const bay = opts.bay ?? 6;
  const accent = opts.accent ?? 'emissiveCyan';
  const depth = opts.flush ? 0.025 : 0.07;
  const zMin = Math.min(z0, z1), zMax = Math.max(z0, z1);
  const len = zMax - zMin;
  const count = Math.max(1, Math.round(len / bay));
  const step = len / count;

  // Bevelled sci-fi armor panels in tiers.
  const tiers = Math.max(1, Math.round((y1 - y0) / 3.4));
  const tierH = (y1 - y0) / tiers;
  for (let i = 0; i < count; i++) {
    const za = zMin + i * step + 0.08;
    const zb = zMin + (i + 1) * step - 0.08;
    if (zb - za < 0.4) continue;
    for (let j = 0; j < tiers; j++) {
      const ya = y0 + j * tierH + 0.07;
      const yb = y0 + (j + 1) * tierH - 0.07;
      const tint = HULL_TINTS[(i * 3 + j) % HULL_TINTS.length]!;
      const mat: Mat = j === 0 ? 'steelDark' : 'panel';
      g.use(mat).tint(tint[0], tint[1], tint[2]);
      g.bevel(xFace + dir * (depth * 0.5), (ya + yb) / 2, (za + zb) / 2, depth * 0.5, (yb - ya) / 2, (zb - za) / 2, Math.min(0.03, depth * 0.45));
    }
  }
  g.tint(1);

  // Thin glowing datum strips running cleanly along the hull.
  for (const sy of opts.stripY ?? [y0 + 1.15]) {
    if (sy <= y0 || sy >= y1) continue;
    g.use(accent).box(xFace + dir * (depth + 0.015), sy, (zMin + zMax) / 2, 0.015, 0.028, len / 2 - 0.2);
  }

  // Upper coolant conduit pipes along non-flush walls.
  if (opts.pipes && !opts.flush && y1 - y0 >= 5) {
    const py = y1 - 1.4;
    pipe(k, [xFace + dir * 0.22, py, zMin + 0.6, xFace + dir * 0.22, py, zMax - 0.6], 0.11, 'steel', 8, 8, false);
    pipe(k, [xFace + dir * 0.22, py - 0.34, zMin + 0.6, xFace + dir * 0.22, py - 0.34, zMax - 0.6], 0.07, 'steelDark', 8, 6, false);
  }
}

/**
 * Cantilevered Bureau Evaluator Observation Booth projecting from a side wall high above the deck.
 * Dark angled titanium hull, tinted panoramic observation glass, glowing interior `screen` monitors, and faint light.
 */
export function obsBooth(k: Kit, xWall: number, dir: 1 | -1, yFloor: number, zCenter: number, len = 10, h = 3.2): void {
  const g = k.geo;
  const proj = 1.8;
  const xMid = xWall + dir * (proj / 2);
  const xFront = xWall + dir * proj;

  // Angled steelDark underbelly brackets supporting the cantilevered pod.
  for (const dz of [-len * 0.38, 0, len * 0.38]) {
    k.beam(xWall, yFloor - 1.4, zCenter + dz, xFront - dir * 0.15, yFloor, zCenter + dz, 0.14, 0.16, 'steelDark');
  }
  // Floor & roof cantilevered slabs.
  g.use('steelDark');
  g.bevel(xMid, yFloor + 0.16, zCenter, proj / 2, 0.18, len / 2, 0.05);
  g.bevel(xMid, yFloor + h - 0.16, zCenter, proj / 2 + 0.12, 0.2, len / 2 + 0.1, 0.05);
  // End bulkheads.
  g.bevel(xMid, yFloor + h / 2, zCenter - len / 2 + 0.14, proj / 2, h / 2, 0.14, 0.04);
  g.bevel(xMid, yFloor + h / 2, zCenter + len / 2 - 0.14, proj / 2, h / 2, 0.14, 0.04);
  // Low knee-wall sill under the observation window.
  g.bevel(xFront - dir * 0.12, yFloor + 0.6, zCenter, 0.12, 0.45, len / 2 - 0.2, 0.03);
  // Panoramic tinted glass + vertical steel mullions.
  const winY0 = yFloor + 1.05, winY1 = yFloor + h - 0.35;
  g.use('glass').box(xFront - dir * 0.06, (winY0 + winY1) / 2, zCenter, 0.03, (winY1 - winY0) / 2, len / 2 - 0.28);
  g.use('steelDark');
  const mullions = Math.max(2, Math.round(len / 2.4));
  for (let i = 1; i < mullions; i++) {
    const mz = zCenter - len / 2 + (len * i) / mullions;
    g.box(xFront - dir * 0.04, (winY0 + winY1) / 2, mz, 0.05, (winY1 - winY0) / 2, 0.04);
  }
  // Glowing evaluator monitors inside the booth (visible through the glass!).
  const screens = Math.max(2, Math.floor(len / 2.6));
  for (let i = 0; i < screens; i++) {
    const sz = zCenter - len * 0.34 + (i / Math.max(1, screens - 1)) * (len * 0.68);
    g.use('screen').box(xWall + dir * 0.6, yFloor + 1.55, sz, 0.03, 0.32, 0.55, dir > 0 ? FACE.px : FACE.nx);
  }
  // Thin cyan trim bar under the sill + subtle interior booth glow.
  g.use('emissiveCyan').box(xFront + dir * 0.02, yFloor + 0.2, zCenter, 0.02, 0.025, len / 2 - 0.2);
  k.light(xMid, yFloor + h - 0.6, zCenter, 'cyan', 26, 9);
}

/**
 * Sculpted sci-fi cylindrical Cryo-Clone Pod (`lathe` base & dome cap, glowing cyan stasis fluid core,
 * vertical structural struts, glass containment cylinder, and umbilical conduit rising to ceiling).
 */
export function clonePod(k: Kit, x: number, z: number, y0: number, ceilY: number, yaw = 0, opened = false): void {
  const g = k.geo;
  k.push(x, y0, z, yaw);
  // Stepped dark-steel circular pedestal base.
  g.use('steelDark').lathe([1.05, 0, 1.05, 0.14, 0.92, 0.24, 0.88, 0.34, 0.72, 0.36], 0, 0, 0, 18, false);
  // Glowing cyan stasis emitter ring on top of pedestal.
  g.use('emissiveCyan').lathe([0.74, 0.34, 0.74, 0.39, 0.55, 0.39], 0, 0, 0, 18, false);
  // Upper crown & dome cap.
  g.use('steelDark').lathe([0.72, 2.55, 0.94, 2.62, 0.96, 2.86, 0.78, 3.04, 0.45, 3.16, 0.16, 3.22], 0, 0, 0, 18, false);
  g.use('emissiveCyan').lathe([0.82, 2.56, 0.82, 2.61], 0, 0, 0, 18, false);
  // 4 vertical titanium frame struts.
  const strutAngles = opened ? [Math.PI * 0.25, Math.PI * 0.75, Math.PI * 1.25, Math.PI * 1.75] : [0, Math.PI / 2, Math.PI, Math.PI * 1.5];
  g.use('steel').tint(0.75, 0.82, 0.9);
  for (const a of strutAngles) {
    const sx = Math.cos(a) * 0.84, sz = Math.sin(a) * 0.84;
    g.cyl(sx, 0.3, sz, sx, 2.6, sz, 0.055, 0.055, 6);
  }
  g.tint(1);
  // Glass cylinder (partial arc if opened so the player stepped right out of it!).
  if (opened) {
    g.use('glass').lathe([0.78, 0.38, 0.78, 2.55], 0, 0, 0, 16, true, Math.PI * 0.25, Math.PI * 1.75);
  } else {
    g.use('glass').lathe([0.78, 0.38, 0.78, 2.55], 0, 0, 0, 18, true);
    // Faint vertical stasis core column inside closed pods.
    g.use('screen').lathe([0.24, 0.42, 0.28, 1.45, 0.22, 2.48], 0, 0, 0, 12, true);
    k.collide(0, 1.5, 0, 0.95, 1.5, 0.95, 'metal');
  }
  // Overhead umbilical trunk connecting dome cap into the bay ceiling.
  if (ceilY > y0 + 3.25) {
    const top = ceilY - y0;
    g.use('steelDark').cyl(0, 3.16, 0, 0, top, 0, 0.16, 0.22, 8);
    cable(k, 0.22, 3.05, 0.1, 0.55, top - 0.15, 0.35, 0.25, 0.045);
    cable(k, -0.22, 3.05, -0.1, -0.55, top - 0.15, -0.35, 0.25, 0.045);
  }
  k.pop();
}

/** Sloped sci-fi telemetry terminal / workstation with glowing cyan screen. */
export function consoleDesk(k: Kit, x: number, y: number, z: number, yaw: number, w = 1.8): void {
  const g = k.geo;
  k.push(x, y, z, yaw);
  g.use('steelDark');
  g.bevel(0, 0.45, 0, w / 2, 0.45, 0.36, 0.04);
  g.use('panel').tint(0.72, 0.78, 0.88).bevel(0, 0.94, -0.04, w / 2 + 0.06, 0.08, 0.42, 0.03);
  g.tint(1);
  // Tilted screen hood.
  k.push(0, 1.24, -0.22, 0, 0, -0.28);
  g.use('steelDark').bevel(0, 0, 0, w * 0.44, 0.24, 0.05, 0.02);
  g.use('screen').box(0, 0, 0.055, w * 0.39, 0.18, 0.01, FACE.pz);
  k.pop();
  g.use('emissiveCyan').box(0, 0.96, 0.39, w * 0.42, 0.015, 0.015, FACE.pz);
  k.collide(0, 0.6, 0, w / 2 + 0.06, 0.6, 0.42, 'metal');
  k.pop();
}

/**
 * Recessed glowing floor wayfinding track with crisp forward chevrons pointing along -Z (north) from `zStart` to `zEnd`.
 * Gives players unmistakable sci-fi directional flow without cluttering the floor.
 */
export function floorGuide(
  k: Kit,
  x: number,
  y: number,
  zStart: number,
  zEnd: number,
  opts: { mat?: Mat; width?: number; step?: number; rails?: boolean } = {},
): void {
  const g = k.geo;
  const mat = opts.mat ?? 'emissiveCyan';
  const w = opts.width ?? 1.4;
  const step = opts.step ?? 2.6;
  const zHi = Math.max(zStart, zEnd), zLo = Math.min(zStart, zEnd);
  const len = zHi - zLo;
  const zMid = (zHi + zLo) / 2;

  // Flanking thin recessed light rails.
  if (opts.rails !== false) {
    g.use(mat);
    g.box(x - w / 2, y + 0.008, zMid, 0.03, 0.004, len / 2, FACE.py);
    g.box(x + w / 2, y + 0.008, zMid, 0.03, 0.004, len / 2, FACE.py);
  }
  // Forward-pointing chevrons (`^` pointing north toward -Z).
  const n = Math.max(1, Math.floor(len / step));
  for (let i = 0; i < n; i++) {
    const z = zHi - (i + 0.5) * (len / n);
    const arm = Math.min(0.42, w * 0.34);
    k.stripLine([x - arm, y, z + arm * 0.7, x, y, z - arm * 0.35, x + arm, y, z + arm * 0.7], 0.065, mat);
  }
}

/** Overhead suspended starship light gantry spanning `x0..x1` at `(y, z)`. */
export function lightGantry(k: Kit, x0: number, x1: number, y: number, z: number, color: LampColor = 'white', intensity = 110, radius = 22): void {
  const cx = (x0 + x1) / 2;
  const w = x1 - x0;
  k.ibeam(x0, y + 0.25, z, x1, y + 0.25, z, 0.28, 0.18, 'steelDark');
  k.lampBar(cx, y, z, 0, Math.min(w * 0.52, 6.5), color, intensity, radius);
}
