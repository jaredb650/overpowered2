/**
 * What is inside a person, built in code at load and fitted to the baked skin, so one description serves a Leaper and
 * a Brute. It rides the same skeleton as the skin. It is only ever seen through a wound, so it is cut for the shapes
 * that read through a hole: a rib cage, long bones, wet masses. There are no small parts.
 *
 * One geometry and one draw for the lot:
 *  - shell: the skin at its middle LOD, pulled in a little. Whatever a hole reveals, there is a surface under it, and
 *    from inside its back faces are the far wall of the body. The lowest LOD cuts too many corners to stay under the skin.
 *  - muscle round the limbs, with the long bones through it.
 *  - rib cage, spine, pelvis, skull.
 *  - organs, and bowel.
 *  - bone ends that stay collapsed until their joint breaks.
 */
import * as THREE from 'three';
import { mulberry32 } from '../../core/math';
import type { LoadedModel } from '../model';
import { HumanoidBone as B, type RigDef } from '../rig';

export const Part = { shell: 0, muscle: 1, bone: 2, organ: 3, gut: 4, shard: 5 } as const;
type PartId = (typeof Part)[keyof typeof Part];

/** How far under the skin the shell sits, at human size. */
const SHELL_DEPTH = 0.02;
/** Inside the skin, measured at the widest gear, with room left for what is on top of the ribs. */
const CAGE_FIT = 0.8;

type V3 = readonly [number, number, number];
type Rgb = readonly [number, number, number];
/** Up to two bones and the weight of the second. */
type Bind = readonly [number, number, number];

const BONE_RGB: Rgb = [0.62, 0.55, 0.42];
const RED_MEAT: Rgb = [0.3, 0.05, 0.045];
const LUNG: Rgb = [0.33, 0.1, 0.1];
const HEART: Rgb = [0.2, 0.02, 0.03];
const LIVER: Rgb = [0.11, 0.018, 0.016];
const STOMACH: Rgb = [0.34, 0.14, 0.12];
const BOWEL: Rgb = [0.42, 0.2, 0.17];

const add = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V3): V3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

class Builder {
  readonly pos: number[] = [];
  readonly nor: number[] = [];
  readonly skin: number[] = [];
  readonly weight: number[] = [];
  readonly part: number[] = [];
  readonly tint: number[] = [];
  readonly index: number[] = [];

  get count(): number {
    return this.part.length;
  }

  vertex(p: V3, n: V3, bind: Bind, part: number, rgb: Rgb): number {
    this.pos.push(p[0], p[1], p[2]);
    this.nor.push(n[0], n[1], n[2]);
    this.skin.push(bind[0], bind[1], 0, 0);
    this.weight.push(1 - bind[2], bind[2], 0, 0);
    this.part.push(part);
    this.tint.push(rgb[0], rgb[1], rgb[2]);
    return this.count - 1;
  }

  /** A swept tube. Radii of zero close the ends. `squash` flattens it along its side vector. */
  tube(path: readonly V3[], radius: (t: number, i: number) => number, sides: number, bind: (t: number) => Bind, part: number, rgb: Rgb, squash = 1, up: V3 = [0, 1, 0]): void {
    const rings: number[] = [];
    let side = unit(cross(sub(path[1]!, path[0]!), Math.abs(dot(unit(sub(path[1]!, path[0]!)), up)) > 0.9 ? [1, 0, 0] : up));
    for (let i = 0; i < path.length; i++) {
      const tan = unit(sub(path[Math.min(i + 1, path.length - 1)]!, path[Math.max(i - 1, 0)]!));
      // Carried along rather than rebuilt at each ring, which would twist the tube where the path bends.
      side = unit(sub(side, [tan[0] * dot(side, tan), tan[1] * dot(side, tan), tan[2] * dot(side, tan)]));
      const other = cross(tan, side);
      const t = i / (path.length - 1);
      const r = radius(t, i);
      rings.push(this.count);
      for (let s = 0; s < sides; s++) {
        const a = (s / sides) * Math.PI * 2;
        const c = Math.cos(a) * squash;
        const d = Math.sin(a);
        const n: V3 = [side[0] * c + other[0] * d, side[1] * c + other[1] * d, side[2] * c + other[2] * d];
        this.vertex(add(path[i]!, n, r), unit(n), bind(t), part, rgb);
      }
    }
    for (let i = 0; i + 1 < rings.length; i++) {
      for (let s = 0; s < sides; s++) {
        const a = rings[i]! + s;
        const b = rings[i]! + ((s + 1) % sides);
        const c = rings[i + 1]! + s;
        const d = rings[i + 1]! + ((s + 1) % sides);
        this.index.push(a, c, b, b, c, d);
      }
    }
  }

  /** A lumpy ellipsoid. Nothing wet is a clean ball. */
  blob(center: V3, radii: V3, rows: number, cols: number, bind: Bind, part: number, rgb: Rgb, lumps: number, rnd: () => number): void {
    const phaseA = rnd() * 6.28;
    const phaseB = rnd() * 6.28;
    const first = this.count;
    for (let i = 0; i <= rows; i++) {
      const v = (i / rows) * Math.PI;
      for (let j = 0; j < cols; j++) {
        const u = (j / cols) * Math.PI * 2;
        const n: V3 = [Math.sin(v) * Math.cos(u), Math.cos(v), Math.sin(v) * Math.sin(u)];
        const bump = 1 + lumps * (Math.sin(u * 3 + phaseA + v * 2) * 0.6 + Math.sin(v * 5 + phaseB) * 0.4);
        this.vertex(
          [center[0] + n[0] * radii[0] * bump, center[1] + n[1] * radii[1] * bump, center[2] + n[2] * radii[2] * bump],
          unit([n[0] / radii[0], n[1] / radii[1], n[2] / radii[2]]), bind, part, rgb,
        );
      }
    }
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        const a = first + i * cols + j;
        const b = first + i * cols + ((j + 1) % cols);
        const c = a + cols;
        const d = b + cols;
        this.index.push(a, b, c, b, d, c);
      }
    }
  }
}

/** Bone with the most weight on each vertex. */
function dominant(model: LoadedModel): Uint8Array {
  const si = model.attributes.skinIndex!.array as Uint8Array;
  const sw = model.attributes.skinWeight!.array as Uint8Array;
  const out = new Uint8Array(model.attributes.position.count);
  for (let i = 0; i < out.length; i++) {
    let best = 0;
    for (let k = 1; k < 4; k++) if (sw[i * 4 + k]! > sw[i * 4 + best]!) best = k;
    out[i] = si[i * 4 + best]!;
  }
  return out;
}

const percentile = (values: number[], p: number): number => {
  if (values.length === 0) return 0;
  values.sort((a, b) => a - b);
  return values[Math.min(values.length - 1, Math.floor(values.length * p))]!;
};

/** Mid-range distance of a limb's skin from its bone. Armour pads the top of that range, so the top is no use. */
function limbRadius(pos: ArrayLike<number>, owner: Uint8Array, bone: number, a: V3, b: V3): number {
  const ab = sub(b, a);
  const ab2 = dot(ab, ab);
  const out: number[] = [];
  for (let i = 0; i < owner.length; i++) {
    if (owner[i] !== bone) continue;
    const p: V3 = [pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!];
    const t = Math.min(1, Math.max(0, dot(sub(p, a), ab) / ab2));
    if (t < 0.15 || t > 0.85) continue;
    out.push(len(sub(p, add(a, ab, t))));
  }
  return percentile(out, 0.35);
}

interface Slice {
  halfX: number;
  front: number;
  back: number;
}

/** The trunk's cross-section by height, from the skin itself. */
function torsoSlices(pos: ArrayLike<number>, owner: Uint8Array, y0: number, y1: number, n: number): Slice[] {
  const xs: number[][] = Array.from({ length: n }, () => []);
  const zs: number[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < owner.length; i++) {
    const o = owner[i]!;
    if (o !== B.hips && o !== B.spine && o !== B.chest) continue;
    const k = Math.floor(((pos[i * 3 + 1]! - y0) / (y1 - y0)) * n);
    if (k < 0 || k >= n) continue;
    xs[k]!.push(Math.abs(pos[i * 3]!));
    zs[k]!.push(pos[i * 3 + 2]!);
  }
  return xs.map((x, k) => ({ halfX: percentile(x, 0.9), front: percentile(zs[k]!, 0.92), back: percentile(zs[k]!, 0.08) }));
}

function sliceAt(slices: readonly Slice[], y0: number, y1: number, y: number): Slice {
  const f = Math.min(slices.length - 1.001, Math.max(0, ((y - y0) / (y1 - y0)) * slices.length - 0.5));
  const i = Math.floor(f);
  const a = slices[i]!;
  const b = slices[i + 1]!;
  const t = f - i;
  return { halfX: mix(a.halfX, b.halfX, t), front: mix(a.front, b.front, t), back: mix(a.back, b.back, t) };
}

function addShell(g: Builder, model: LoadedModel, scale: number): void {
  const A = model.attributes;
  const pos = A.position.array as Float32Array;
  const nor = A.normal.array as Int8Array;
  const si = A.skinIndex!.array as Uint8Array;
  const sw = A.skinWeight!.array as Uint8Array;
  const source = model.lods[1]!.index!.array;
  const remap = new Map<number, number>();
  const shrink = SHELL_DEPTH * scale;
  for (let i = 0; i < source.length; i++) {
    const v = source[i]!;
    let to = remap.get(v);
    if (to === undefined) {
      const n: V3 = unit([nor[v * 4]!, nor[v * 4 + 1]!, nor[v * 4 + 2]!]);
      to = g.vertex([pos[v * 3]! - n[0] * shrink, pos[v * 3 + 1]! - n[1] * shrink, pos[v * 3 + 2]! - n[2] * shrink], n, [0, 0, 0], Part.shell, RED_MEAT);
      for (let k = 0; k < 4; k++) {
        g.skin[to * 4 + k] = si[v * 4 + k]!;
        g.weight[to * 4 + k] = sw[v * 4 + k]! / 255;
      }
      remap.set(v, to);
    }
    g.index.push(to);
  }
}

/** Bulbs at both ends and a straight shaft between. */
const shaft = (t: number): number => 1 + 0.9 * Math.max(0, 1 - t * 7) ** 2 + 0.9 * Math.max(0, 1 - (1 - t) * 7) ** 2;

function longBone(g: Builder, a: V3, b: V3, r: number, bone: number): void {
  const path: V3[] = [];
  const rings = 7;
  for (let i = 0; i <= rings; i++) path.push(add(a, sub(b, a), i / rings));
  g.tube(path, (t, i) => (i === 0 || i === rings ? 0 : r * shaft(t)), 6, () => [bone, bone, 0], Part.bone, BONE_RGB);
}

function muscleSleeve(g: Builder, a: V3, b: V3, r: number, bone: number, rnd: () => number): void {
  const path: V3[] = [];
  const rings = 8;
  for (let i = 0; i <= rings; i++) path.push(add(a, sub(b, a), i / rings));
  const belly = 0.82 + rnd() * 0.16;
  g.tube(path, (t, i) => (i === 0 || i === rings ? 0 : r * (0.72 + 0.28 * Math.sin(t * Math.PI) * belly)), 8, () => [bone, bone, 0], Part.muscle, RED_MEAT);
}

/** A jagged spike of bone, dormant until `joint` breaks. */
function spike(g: Builder, base: V3, tip: V3, r: number, bone: number, joint: number, rnd: () => number): void {
  const path: V3[] = [];
  const rings = 5;
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const wander = (1 - t) * t * r * 2;
    path.push(add(add(base, sub(tip, base), t), [(rnd() - 0.5) * wander, (rnd() - 0.5) * wander, (rnd() - 0.5) * wander]));
  }
  const code = Part.shard + joint * 8;
  g.tube(path, (t, i) => (i === rings ? 0 : r * (1 - t * t) * (0.75 + rnd() * 0.5)), 5, () => [bone, bone, 0], code as PartId, BONE_RGB);
}

function addCage(g: Builder, slices: readonly Slice[], y0: number, y1: number, chest: V3, neck: V3, scale: number): void {
  const top = neck[1] - 0.05 * scale;
  const bottom = chest[1] - 0.08 * scale;
  const ribs = 10;
  for (let i = 0; i < ribs; i++) {
    const t = i / (ribs - 1);
    const yBack = mix(top, bottom, t);
    const drop = mix(0.05, 0.11, t) * scale;
    const floating = i >= ribs - 2;
    const end = floating ? 0.35 - (i - (ribs - 2)) * 0.5 : Math.PI / 2 - mix(0.1, 0.34, t);
    for (const side of [1, -1]) {
      const path: V3[] = [];
      const steps = 11;
      for (let k = 0; k <= steps; k++) {
        const u = k / steps;
        const angle = mix(-Math.PI / 2 + 0.1, end, u);
        const y = yBack - drop * u * u - 0.015 * scale * Math.sin(u * Math.PI);
        const s = sliceAt(slices, y0, y1, y);
        const rz = (s.front - s.back) * 0.5 * CAGE_FIT;
        const cz = (s.front + s.back) * 0.5;
        // Narrow at the top of the chest and widest low down, whatever the gear on the outside says.
        const taper = mix(0.68, 1, Math.min(1, (t + 0.1) * 2));
        path.push([side * s.halfX * CAGE_FIT * taper * Math.cos(angle), y, cz + rz * Math.sin(angle)]);
      }
      g.tube(path, (_t, k) => (k === 0 || k === steps ? 0 : 0.0088 * scale), 5, () => [B.chest, B.chest, 0], Part.bone, BONE_RGB, 0.62);
    }
  }
  const s = sliceAt(slices, y0, y1, mix(top, bottom, 0.4));
  const front = (s.front + s.back) * 0.5 + (s.front - s.back) * 0.5 * CAGE_FIT;
  g.tube(
    [[0, top - 0.02 * scale, front - 0.01 * scale], [0, mix(top, bottom, 0.25), front], [0, mix(top, bottom, 0.5), front + 0.004 * scale], [0, mix(top, bottom, 0.75) - 0.02 * scale, front]],
    (t, i) => (i === 3 ? 0 : (i === 0 ? 0.022 : 0.016 + t * 0.006) * scale), 6, () => [B.chest, B.chest, 0], Part.bone, BONE_RGB, 1.2, [0, 0, 1],
  );
}

function addSpine(g: Builder, hips: V3, chest: V3, neck: V3, head: V3, slices: readonly Slice[], y0: number, y1: number, scale: number): void {
  const path: V3[] = [];
  const steps = 26;
  const bottom = hips[1] - 0.04 * scale;
  const top = head[1] + 0.02 * scale;
  for (let i = 0; i <= steps; i++) {
    const y = mix(bottom, top, i / steps);
    const s = sliceAt(slices, y0, y1, Math.min(y, neck[1]));
    const z = y > neck[1] ? mix(neck[2], head[2], (y - neck[1]) / Math.max(top - neck[1], 1e-3)) - 0.03 * scale : mix(s.back, s.front, 0.24);
    path.push([0, y, z]);
  }
  const vertebrae = (t: number) => (0.5 + 0.5 * Math.cos(t * Math.PI * 2 * 13)) * 0.006 * scale;
  const bind = (t: number): Bind => {
    const y = mix(bottom, top, t);
    if (y < hips[1] + 0.1 * scale) return [B.hips, B.spine, 0.3];
    if (y < chest[1]) return [B.spine, B.chest, Math.max(0, (y - chest[1]) / (0.08 * scale) + 1) * 0.5];
    return y < neck[1] ? [B.chest, B.chest, 0] : [B.neck, B.head, 0.4];
  };
  g.tube(path, (t, i) => (i === 0 || i === steps ? 0 : 0.016 * scale + vertebrae(t)), 6, bind, Part.bone, BONE_RGB, 1, [0, 0, 1]);
}

function addPelvis(g: Builder, hips: V3, s: Slice, rnd: () => number, scale: number): void {
  const wide = s.halfX * 0.72;
  const cz = (s.front + s.back) * 0.5;
  for (const side of [1, -1]) {
    g.blob([side * wide * 0.72, hips[1] + 0.015 * scale, cz - 0.02 * scale], [wide * 0.5, 0.082 * scale, 0.05 * scale], 6, 8, [B.hips, B.hips, 0], Part.bone, BONE_RGB, 0.07, rnd);
  }
  g.blob([0, hips[1] - 0.04 * scale, cz - 0.045 * scale], [wide * 0.34, 0.075 * scale, 0.03 * scale], 5, 7, [B.hips, B.hips, 0], Part.bone, BONE_RGB, 0.05, rnd);
}

function addOrgans(g: Builder, slices: readonly Slice[], y0: number, y1: number, chest: V3, neck: V3, spine: V3, hips: V3, rnd: () => number, scale: number): void {
  const inner = (y: number) => {
    const s = sliceAt(slices, y0, y1, y);
    return { rx: s.halfX * CAGE_FIT * 0.86, rz: (s.front - s.back) * 0.5 * CAGE_FIT * 0.86, cz: (s.front + s.back) * 0.5 };
  };
  const lungY = mix(chest[1], neck[1], 0.42);
  const lung = inner(lungY);
  const heartY = mix(chest[1], neck[1], 0.28);
  const chestBind: Bind = [B.chest, B.chest, 0];
  const lungRy = (neck[1] - chest[1]) * 0.46;
  for (const side of [1, -1]) {
    g.blob([side * lung.rx * 0.52, lungY, lung.cz - lung.rz * 0.08], [lung.rx * 0.5, lungRy, lung.rz * 0.84], 8, 10, chestBind, Part.organ, LUNG, 0.06, rnd);
  }
  g.blob([lung.rx * 0.1, heartY, lung.cz + lung.rz * 0.44], [0.055 * scale, 0.07 * scale, 0.05 * scale], 7, 8, chestBind, Part.organ, HEART, 0.08, rnd);

  const bellyY = mix(spine[1], chest[1], 0.5);
  const belly = inner(bellyY);
  const spineBind: Bind = [B.spine, B.chest, 0.3];
  g.blob([-belly.rx * 0.34, bellyY, belly.cz + belly.rz * 0.1], [belly.rx * 0.62, 0.062 * scale, belly.rz * 0.62], 6, 9, spineBind, Part.organ, LIVER, 0.05, rnd);
  g.blob([belly.rx * 0.42, bellyY - 0.008 * scale, belly.cz + belly.rz * 0.15], [belly.rx * 0.46, 0.056 * scale, belly.rz * 0.6], 6, 8, spineBind, Part.organ, STOMACH, 0.08, rnd);

  // A serpentine packed into the belly. Rows run across, and each row wanders front and back.
  const low = hips[1] - 0.005 * scale;
  const high = spine[1] + 0.03 * scale;
  const path: V3[] = [];
  const rows = 4;
  const steps = 15;
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k <= steps; k++) {
      const u = k / steps;
      const across = (r % 2 === 0 ? u : 1 - u) * 2 - 1;
      const y = mix(high, low, (r + u * 0.8) / rows) + Math.sin(u * 13 + r) * 0.012 * scale;
      const f = inner(y);
      path.push([across * f.rx * 0.8, y, f.cz + f.rz * (0.5 + 0.28 * Math.sin(u * 17 + r * 2.1))]);
    }
  }
  g.tube(path, (_t, i) => (i === 0 || i === path.length - 1 ? 0 : 0.019 * scale), 5, (t): Bind => [B.spine, B.hips, 0.2 + t * 0.6], Part.gut, BOWEL);
}

/**
 * The inside of a humanoid, or null for anything else. Machines have no flesh, and a Titan's stumps spark.
 * @param bind Bind position of every bone, from the model, so this matches the skin exactly.
 */
export function buildInterior(model: LoadedModel, rig: RigDef, bind: readonly THREE.Vector3[], seed: number): THREE.BufferGeometry {
  const g = new Builder();
  const rnd = mulberry32(seed);
  const pos = model.attributes.position.array as Float32Array;
  const owner = dominant(model);
  const at = (b: number): V3 => [bind[b]!.x, bind[b]!.y, bind[b]!.z];
  const scale = rig.height / 1.85;

  addShell(g, model, scale);

  const hips = at(B.hips);
  const spine = at(B.spine);
  const chest = at(B.chest);
  const neck = at(B.neck);
  const head = at(B.head);
  const y0 = hips[1] - 0.12 * scale;
  const y1 = neck[1] + 0.02 * scale;
  const slices = torsoSlices(pos, owner, y0, y1, 12);
  addCage(g, slices, y0, y1, chest, neck, scale);
  addSpine(g, hips, chest, neck, head, slices, y0, y1, scale);
  addPelvis(g, hips, sliceAt(slices, y0, y1, hips[1]), rnd, scale);
  addOrgans(g, slices, y0, y1, chest, neck, spine, hips, rnd, scale);

  // Skull: what a glancing head wound opens onto. The jaw does not move, so it is one piece with it.
  const skull = add(head, [0, 0.09 * scale, 0.015 * scale]);
  g.blob(skull, [0.078 * scale, 0.098 * scale, 0.092 * scale], 8, 10, [B.head, B.head, 0], Part.bone, BONE_RGB, 0.02, rnd);
  g.blob(add(skull, [0, -0.08 * scale, 0.03 * scale]), [0.058 * scale, 0.04 * scale, 0.06 * scale], 5, 7, [B.head, B.head, 0], Part.bone, BONE_RGB, 0.03, rnd);

  for (const side of [1, -1] as const) {
    const [upper, fore, hand] = side === 1 ? [B.upperArmL, B.foreArmL, B.handL] : [B.upperArmR, B.foreArmR, B.handR];
    const [thigh, shin, foot] = side === 1 ? [B.thighL, B.shinL, B.footL] : [B.thighR, B.shinR, B.footR];
    const shoulder = at(upper);
    const elbow = at(fore);
    const wrist = at(hand);
    const hip = at(thigh);
    const knee = at(shin);
    const ankle = at(foot);

    // Collar bone, breast bone to shoulder. It is what a chest wound high up finds.
    const collarFrom: V3 = [0.02 * side * scale, neck[1] - 0.04 * scale, (sliceAt(slices, y0, y1, neck[1] - 0.05 * scale).front) * CAGE_FIT];
    g.tube([collarFrom, add(collarFrom, sub(shoulder, collarFrom), 0.5), shoulder], (_t, i) => (i === 2 ? 0 : 0.009 * scale), 5, () => [B.chest, B.chest, 0], Part.bone, BONE_RGB);

    const armR = limbRadius(pos, owner, upper, shoulder, elbow) || 0.05 * scale;
    const foreR = limbRadius(pos, owner, fore, elbow, wrist) || 0.04 * scale;
    const thighR = limbRadius(pos, owner, thigh, hip, knee) || 0.08 * scale;
    const shinR = limbRadius(pos, owner, shin, knee, ankle) || 0.055 * scale;

    muscleSleeve(g, shoulder, elbow, armR * 0.78, upper, rnd);
    muscleSleeve(g, elbow, wrist, foreR * 0.78, fore, rnd);
    muscleSleeve(g, hip, knee, thighR * 0.78, thigh, rnd);
    muscleSleeve(g, knee, ankle, shinR * 0.78, shin, rnd);

    longBone(g, shoulder, elbow, armR * 0.22, upper);
    const across: V3 = [0, 0, foreR * 0.2];
    longBone(g, add(elbow, across), add(wrist, across), foreR * 0.14, fore);
    longBone(g, add(elbow, across, -1), add(wrist, across, -1), foreR * 0.14, fore);
    longBone(g, hip, knee, thighR * 0.2, thigh);
    longBone(g, knee, ankle, shinR * 0.24, shin);
    longBone(g, add(knee, [side * shinR * 0.45, 0, -shinR * 0.3]), add(ankle, [side * shinR * 0.4, 0, -shinR * 0.2]), shinR * 0.1, shin);

    // Back through the elbow, forward through the knee: the way each one bursts when it goes the wrong way.
    const armAxis = unit(sub(elbow, shoulder));
    const foreAxis = unit(sub(wrist, elbow));
    const legAxis = unit(sub(knee, hip));
    const shinAxis = unit(sub(ankle, knee));
    spike(g, add(elbow, armAxis, -0.09 * scale), add(add(elbow, armAxis, 0.02 * scale), [side * 0.012 * scale, 0, -(armR + 0.05 * scale)]), armR * 0.3, upper, fore, rnd);
    spike(g, add(elbow, foreAxis, 0.08 * scale), add(add(elbow, foreAxis, 0.0), [0, 0, foreR + 0.035 * scale]), foreR * 0.22, fore, fore, rnd);
    spike(g, add(knee, legAxis, -0.1 * scale), add(add(knee, legAxis, 0.02 * scale), [side * 0.015 * scale, 0, thighR + 0.05 * scale]), thighR * 0.26, thigh, shin, rnd);
    spike(g, add(knee, shinAxis, 0.09 * scale), add(knee, [0, 0, -(shinR + 0.04 * scale)]), shinR * 0.28, shin, shin, rnd);
    // A dead shoulder or hip has no joint to bend, so the shaft comes out of the side of the limb.
    const midArm = add(shoulder, sub(elbow, shoulder), 0.55);
    spike(g, add(midArm, armAxis, 0.05 * scale), add(midArm, [side * (armR + 0.04 * scale), 0, 0.02 * scale]), armR * 0.3, upper, upper, rnd);
    const midLeg = add(hip, sub(knee, hip), 0.55);
    spike(g, add(midLeg, legAxis, 0.06 * scale), add(midLeg, [side * (thighR + 0.05 * scale), 0, 0.03 * scale]), thighR * 0.26, thigh, thigh, rnd);
  }

  const n = g.count;
  const normals = new Int8Array(n * 4);
  for (let i = 0; i < n; i++) {
    normals[i * 4] = Math.round(g.nor[i * 3]! * 127);
    normals[i * 4 + 1] = Math.round(g.nor[i * 3 + 1]! * 127);
    normals[i * 4 + 2] = Math.round(g.nor[i * 3 + 2]! * 127);
  }
  const weights = new Uint8Array(n * 4);
  for (let i = 0; i < n * 4; i++) weights[i] = Math.round(g.weight[i]! * 255);
  const tints = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    tints[i * 4] = Math.round(g.tint[i * 3]! * 255);
    tints[i * 4 + 1] = Math.round(g.tint[i * 3 + 1]! * 255);
    tints[i * 4 + 2] = Math.round(g.tint[i * 3 + 2]! * 255);
    tints[i * 4 + 3] = g.part[i]!;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(new Float32Array(g.pos), 3));
  out.setAttribute('normal', new THREE.BufferAttribute(normals, 4, true));
  out.setAttribute('skinIndex', new THREE.BufferAttribute(new Uint8Array(g.skin), 4));
  out.setAttribute('skinWeight', new THREE.BufferAttribute(weights, 4, true));
  // Colour in rgb, and in alpha which layer this is, with the joint a dormant bone end waits for above that.
  out.setAttribute('aTint', new THREE.BufferAttribute(tints, 4));
  out.setIndex(n > 65535 ? new THREE.BufferAttribute(new Uint32Array(g.index), 1) : new THREE.BufferAttribute(new Uint16Array(g.index), 1));
  return out;
}
