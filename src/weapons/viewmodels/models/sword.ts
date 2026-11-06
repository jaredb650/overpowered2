/**
 * The Tachi: a long curved blade, because a weapon with no ammo has to earn its slot by looking dangerous. Shinogi
 * cross-section with crisp facets, a fuller, a temper line in the shader, ray-skin hilt under real diamond wrap.
 * The blade lies along -Z with the edge on -Y, and the origin is the middle of the hilt.
 *
 * Timings are the first game's (docs/original/04, section 8). The arcs are not: each move runs along the direction
 * Sword.ts cuts in, so what the blade does, the crescent it draws and the plane it slices on all agree.
 */
import { Kit } from '../kit/kit';
import { Model } from '../kit/model';
import { F } from '../kit/finishes';
import { Kind, type Finish, type Mesher } from '../kit/mesher';
import { circle, type V2 } from '../kit/shapes';
import { rivet } from '../kit/details';
import { clamp, damp, lerp } from '../../../core/math';
import { inCubic, inOut, outBack, outCubic, outQuad, seg } from '../curves';
import type { Anim, ViewDef } from '../def';
import { HANDS } from '../poses';

const GUARD_Z = -0.112;
const BLADE_LEN = 0.86;
const TIP_START = 0.8;
const POMMEL_Z = 0.158;
const BLADE: Finish = { color: 0xb0b4ba, rough: 0.2, metal: 1, wear: 1, heat: 1, kind: Kind.blade };

/** Curve of the blade: the back rises toward the tip, so the edge sits on the outside of the bow. */
const sori = (s: number) => 0.03 * s * s;
const halfHeight = (s: number) => lerp(0.0162, 0.0118, s / BLADE_LEN);
const thick = (s: number) => lerp(0.0042, 0.0024, s / BLADE_LEN);

function spineY(s: number): number {
  return sori(s) + halfHeight(s);
}

function edgeY(s: number): number {
  const base = sori(s) - halfHeight(s);
  if (s <= TIP_START) return base;
  // The point: the edge sweeps up to meet the back in one long arc.
  const t = (s - TIP_START) / (BLADE_LEN - TIP_START);
  return lerp(base, spineY(BLADE_LEN), 1 - Math.sqrt(1 - t * t));
}

function blade(m: Mesher): void {
  m.use(BLADE);
  const nv = 56;
  const at = (v: number) => {
    const t = v * v * 0.16 + v * 0.84;
    return t * BLADE_LEN;
  };
  const taper = (s: number) => (s < TIP_START ? 1 : 1 - ((s - TIP_START) / (BLADE_LEN - TIP_START)) ** 2 * 0.98);
  const ridge = (s: number) => lerp(spineY(s), edgeY(s), 0.32);
  for (const side of [-1, 1] as const) {
    // Ji: ridge line down to the edge. Flat, polished, where the temper line lives.
    m.surface(4, nv, (u, v, o) => {
      const s = at(v);
      o.set(side * thick(s) * taper(s) * (1 - u) ** 1.25, lerp(ridge(s), edgeY(s), u), GUARD_Z - 0.008 - s);
    }, { flip: side < 0, edge: u => 0.32 + 0.68 * u });
    // Shinogi-ji: ridge line up to the back, with a fuller run along most of it.
    m.surface(6, nv, (u, v, o) => {
      const s = at(v);
      const groove = s < TIP_START - 0.1 ? Math.sin(u * Math.PI) ** 2 * 0.52 * clamp(s / 0.03) : 0;
      o.set(side * thick(s) * taper(s) * lerp(1, 0.62, u) * (1 - groove), lerp(ridge(s), spineY(s) - halfHeight(s) * 0.16, u), GUARD_Z - 0.008 - s);
    }, { flip: side > 0, edge: u => 0.32 * (1 - u) });
    // Mune: the roof of the back.
    m.surface(1, nv, (u, v, o) => {
      const s = at(v);
      o.set(side * thick(s) * taper(s) * 0.62 * (1 - u), lerp(spineY(s) - halfHeight(s) * 0.16, spineY(s), u), GUARD_Z - 0.008 - s);
    }, { flip: side > 0, edge: () => 0 });
  }
}

function hilt(m: Mesher): void {
  const zs = GUARD_Z + 0.012;
  const ze = POMMEL_Z - 0.012;
  const a = 0.0142;
  const b = 0.0176;
  const ellipse = (k: number): V2[] => {
    const out: [number, number][] = [];
    for (let i = 0; i < 24; i++) out.push([Math.cos((i / 24) * Math.PI * 2) * a * k, Math.sin((i / 24) * Math.PI * 2) * b * k]);
    return out;
  };
  // Pale ray skin under the wrap, so the diamonds of the binding read.
  m.use({ color: 0xc8c2b0, rough: 0.6, metal: 0, wear: 0.1, kind: Kind.stipple });
  m.at([0, 0, (zs + ze) / 2], null, () => m.front(ellipse(0.97), ze - zs, { bevel: 0.0006, smooth: 50 }));
  // The binding: flat cord crossing from side to side, one over the other.
  m.use({ color: 0x1b1d22, rough: 0.72, metal: 0, wear: 0, kind: Kind.fabric });
  const pitch = 0.0272;
  const n = Math.floor((ze - zs) / pitch);
  const band = 0.0052;
  for (let i = 0; i < n; i++) {
    const z0 = zs + 0.004 + i * pitch;
    for (const dir of [-1, 1] as const) {
      for (const face of [0, Math.PI] as const) {
        m.surface(2, 10, (u, v, o) => {
          const ang = face + v * Math.PI;
          const lift = 0.0009 + 0.0009 * Math.sin(u * Math.PI);
          const rise = dir > 0 ? v : 1 - v;
          o.set(Math.cos(ang) * (a + lift), Math.sin(ang) * (b + lift), z0 + rise * pitch + (u - 0.5) * band * 2);
        }, { flip: false });
      }
    }
  }
  // Fuchi, kashira and the peg through the tang.
  m.use(F.blued);
  m.at([0, 0, zs - 0.006], null, () => m.front(ellipse(1.09), 0.016, { bevel: 0.0012, smooth: 50 }));
  m.at([0, 0, ze + 0.008], null, () => m.front(ellipse(1.1), 0.022, { bevel: 0.002, smooth: 50 }));
  m.use(F.brass);
  m.at([0, 0, POMMEL_Z + 0.0015], null, () => m.lathe([[0.008, 0.0015, 0], [0.008, -0.002], [0, -0.002, 0]].reverse() as never, 16));
  m.mirror(() => m.at([0.0165, 0, -0.03], [0, Math.PI / 2, 0], () => rivet(m, 0.0022, F.brass)));
  // Red cord through the pommel, for the sake of the silhouette.
  m.use({ color: 0x8a1712, rough: 0.7, metal: 0, wear: 0, kind: Kind.fabric });
  m.tube([[0.004, -0.012, POMMEL_Z + 0.002], [0.016, -0.03, POMMEL_Z + 0.022], [0.012, -0.06, POMMEL_Z + 0.026], [0.018, -0.082, POMMEL_Z + 0.014]], 0.0016, { seg: 6, samples: 18 });
}

function guard(m: Mesher): void {
  // Tsuba: a pierced steel disc. Thin spacers and a brass collar seat it on the blade.
  const out = curveDisc();
  const holes: V2[][] = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    holes.push(circle(Math.cos(a) * 0.0285, Math.sin(a) * 0.0285, 0.0062, 12));
  }
  m.use(F.steelDark);
  m.at([0, 0, GUARD_Z], null, () => m.front(out, 0.0056, { bevel: 0.0012, holes, smooth: 40 }));
  m.use(F.brass);
  m.at([0, 0, GUARD_Z - 0.0035], null, () => m.front(ellipseRect(0.0048, 0.019), 0.0018, { bevel: 0.0004 }));
  m.at([0, 0, GUARD_Z + 0.0036], null, () => m.front(ellipseRect(0.0115, 0.0185), 0.0016, { bevel: 0.0004 }));
  m.at([0, sori(0.012), GUARD_Z - 0.019], null, () => m.front(ellipseRect(0.0056, 0.0185), 0.029, { bevel: 0.0007, smooth: 40 }));
}

function ellipseRect(a: number, b: number): V2[] {
  const out: [number, number][] = [];
  for (let i = 0; i < 16; i++) out.push([Math.cos((i / 16) * Math.PI * 2) * a, Math.sin((i / 16) * Math.PI * 2) * b]);
  return out;
}

function curveDisc(): V2[] {
  const out: [number, number][] = [];
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    const r = 0.041 + 0.0014 * Math.cos(a * 4);
    out.push([Math.cos(a) * r * 0.94, Math.sin(a) * r]);
  }
  return out;
}

function buildSword(kit: Kit): Model {
  const m = kit.mesher();
  blade(m);
  hilt(m);
  guard(m);
  const model = new Model(m, kit.mats);
  model.socket('muzzle', [0, spineY(BLADE_LEN), GUARD_Z - BLADE_LEN]);
  model.hand('gripR', [0.0158, 0, -0.052], [0, 0, 1], [-0.32, -0.95, 0]);
  model.hand('gripL', [-0.0158, 0, 0.098], [0, 0, -1], [0.32, -0.95, 0]);
  return model;
}

/** Pose of the sword in view space: position, then Euler X, Y, Z. */
type Pose = readonly [number, number, number, number, number, number];

const REST: Pose = [0.215, -0.235, -0.43, 0.82, 0.16, 0];
const COCK: Pose = [0.3, -0.13, -0.4, 0.5, -0.5, -0.95];
const PARRY: Pose = [0.08, -0.14, -0.44, 0.72, 0.42, -1.25];

/** Each arc: where it starts, where the middle is pulled to, where it ends. */
const ARCS: Record<'light1' | 'light2' | 'light3', readonly [Pose, Pose, Pose]> = {
  // Down and a little left, from over the right shoulder.
  light1: [[0.27, 0.02, -0.4, 1.7, -0.32, 0.1], [0.08, -0.08, -0.72, 0.2, 0.08, 0.12], [-0.13, -0.36, -0.46, -0.95, 0.42, 0.16]],
  // Rising to the right, edge leading, picked up where the first cut ended.
  light2: [[-0.14, -0.32, -0.46, -0.72, 0.5, 2.5], [0.08, -0.12, -0.74, 0.32, 0.05, 2.45], [0.34, 0.04, -0.46, 1.32, -0.62, 2.3]],
  // Flat, right to left, the widest of the three.
  light3: [[0.38, -0.06, -0.38, 0.08, -1.22, -1.57], [0.05, -0.1, -0.8, 0.12, 0, -1.57], [-0.32, -0.16, -0.42, 0.12, 1.3, -1.57]],
};

const AREA: readonly [Pose, Pose, Pose] = [[0.4, -0.12, -0.34, 0.08, -1.5, -1.57], [0.02, -0.1, -0.86, 0.1, 0.1, -1.57], [-0.46, -0.2, -0.38, 0.12, 2.25, -1.57]];
const SLAM_TOP: Pose = [0.14, 0.17, -0.3, 2.05, -0.1, 0.08];
const SLAM_END: Pose = [0.03, -0.37, -0.64, -1.05, 0.02, 0];

const cur = new Float64Array(6);
const from = new Float64Array(6);
const _hold = { move: null as Anim['swing'], p: 0 };

function set(out: Float64Array, a: Pose): void {
  for (let i = 0; i < 6; i++) out[i] = a[i]!;
}

function mix(out: Float64Array, a: ArrayLike<number>, b: ArrayLike<number>, t: number): void {
  for (let i = 0; i < 6; i++) out[i] = a[i]! + (b[i]! - a[i]!) * t;
}

function bezier(out: Float64Array, c: readonly [Pose, Pose, Pose], t: number): void {
  const u = 1 - t;
  for (let i = 0; i < 6; i++) out[i] = u * u * c[0][i]! + 2 * u * t * c[1][i]! + t * t * c[2][i]!;
}

function clip(a: Anim): void {
  const move = a.swing;
  // A new move starts from wherever the blade is, so a chain flows instead of popping back to guard.
  if (move !== _hold.move || a.swingP < _hold.p) {
    from.set(cur);
    _hold.move = move;
  }
  _hold.p = a.swingP;
  const p = a.swingP;
  // Past 1 the move is recovering, over the rig's recover time.
  const back = move && move !== 'windup' && p > 1 ? clamp((p - 1) / (a.recover / a.swingSeconds)) : 0;
  let heat = 0;

  if (move === 'light1' || move === 'light2' || move === 'light3') {
    const arc = ARCS[move];
    // Fastest at the start: the hit lands on the frame of the click, so the blade cannot be seen winding up.
    bezier(cur, arc, outQuad(Math.min(p, 1)));
    if (p < 0.14) mix(cur, from, cur, inOut(p / 0.14));
    if (back > 0) mix(cur, cur, REST, inOut(back));
  } else if (move === 'windup') {
    const w = a.charge;
    set(cur, COCK);
    mix(cur, from, cur, outCubic(clamp(p * 1.6)));
    // The arm starts to shake as the charge tops out.
    const tremble = w * w * 0.0065;
    cur[0] = cur[0]! + Math.sin(a.time * 71) * tremble;
    cur[1] = cur[1]! + Math.sin(a.time * 83 + 1) * tremble;
    cur[4] = cur[4]! + Math.sin(a.time * 59) * tremble * 1.5;
    heat = w * w * 0.16;
  } else if (move === 'area') {
    // 80 ms into line, then one flat sweep. It leaves the screen on the left, and comes home from below.
    bezier(cur, AREA, inOut(seg(p, 0.2, 1) * 0.5 + seg(p, 0.2, 1) ** 2 * 0.5));
    if (p < 0.2) mix(cur, from, cur, outCubic(p / 0.2));
    if (back > 0) {
      mix(cur, cur, REST, inOut(back));
      cur[1] = cur[1]! - Math.sin(back * Math.PI) * 0.22;
    }
  } else if (move === 'finisher') {
    // Up in 70 ms, down to land exactly on the blast at p = 0.571, then the blade stays driven into the floor.
    if (p < 0.2) mix(cur, from, SLAM_TOP, outCubic(p / 0.2));
    else mix(cur, SLAM_TOP, SLAM_END, inCubic(seg(p, 0.2, 0.571)));
    const shudder = p > 0.571 ? (1 - seg(p, 0.571, 1)) * 0.012 : 0;
    cur[1] = cur[1]! + Math.sin(a.time * 90) * shudder;
    cur[3] = cur[3]! + Math.sin(a.time * 77) * shudder;
    heat = seg(p, 0.05, 0.42);
    if (back > 0) mix(cur, cur, REST, inOut(back));
  } else {
    set(cur, REST);
  }

  // A blocked shot rides on top of whatever the guard is doing: snap across the body, ring, and settle.
  if (a.parry >= 0) {
    const k = outBack(seg(a.parry, 0, 0.3)) * (1 - seg(a.parry, 0.45, 1));
    for (let i = 0; i < 6; i++) cur[i] = cur[i]! + (PARRY[i]! - cur[i]!) * k * 0.85;
    cur[3] = cur[3]! + Math.sin(a.parry * 40) * 0.02 * (1 - a.parry);
  }

  a.bladeHeat = Math.max(heat, damp(a.bladeHeat, 0, 2.6, a.dt));

  if (a.draw < 1) {
    // Out of the scabbard: the blade rolls over into guard.
    const k = 1 - outCubic(a.draw);
    cur[5] = cur[5]! - k * 1.6;
    cur[0] = cur[0]! + k * 0.09;
  }

  a.gunP.x += cur[0]! - REST[0];
  a.gunP.y += cur[1]! - REST[1];
  a.gunP.z += cur[2]! - REST[2];
  a.gunR.x += cur[3]! - REST[3];
  a.gunR.y += cur[4]! - REST[4];
  a.gunR.z += cur[5]! - REST[5];
}

export function swordDef(kit: Kit): ViewDef {
  set(cur, REST);
  return {
    id: 'sword',
    model: buildSword(kit),
    pos: [REST[0], REST[1], REST[2]],
    rot: [REST[3], REST[4], REST[5]],
    recoil: { back: 0, lift: 0, pitch: 0, yaw: 0, roll: 0, omega: 40, zeta: 0.7 },
    right: { socket: 'gripR', pose: HANDS.hilt },
    left: { socket: 'gripL', pose: HANDS.hilt },
    animate: clip,
  };
}

