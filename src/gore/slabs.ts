/**
 * Slabs: the mid-size pieces of a burst trunk (the gore update's G2). Between the trunk's big pieces (2 to 27 litres) and
 * the lumps of meat (a tenth of a litre) there was nothing the size of a forearm: a body went from five things to dust.
 * A slab is a patch of the victim's own skin and suit, lifted off the trunk it is cut from at load, with a thick lumpy
 * layer of muscle under it and a torn, lobed outline: his surface on one face, wet red meat on the other, a pale line of
 * fat round the lip.
 *
 * Six a kit, one from each part of the trunk (both sides of the chest, a shoulder blade, a flank, the belly, the small of
 * the back), so a burst throws pieces that are recognisably that man. Each is one geometry in two groups, the skin (drawn
 * with the archetype's skin material, as a trunk piece is) and the meat (the cut face's material), and is drawn as
 * instances by `ChunkField`.
 */
import * as THREE from 'three';
import type { CharacterInstance } from '../core/contracts';
import { HumanoidBone as B } from '../characters/rig';
import { mulberry32 } from '../core/math';

export const SlabTuning = {
  /** Half length and half width of a slab on a 1.85 m body, metres: about a forearm long and a hand and a half wide. */
  long: [0.125, 0.165] as const,
  wide: [0.075, 0.1] as const,
  /** Muscle under the skin at the middle of a slab, and at its lip, where the fat and the meat show as a wall. */
  thick: 0.062,
  lip: 0.015,
  /** Times each skin triangle is split in four before the slab is cut out of it: the bake's are 3 to 5 cm, too coarse to tear. */
  split: 2,
  /** Slabs of one shape of one archetype in the world at once. Six shapes: six bodies' worth lie about. */
  perShape: 6,
  /** How many a burst throws: a full one, a waist tear, and one past the frame's full gibs. */
  full: 5,
  waist: 3,
  lite: 2,
};

export interface Slab {
  /** Centred on its own middle. Group 0 is skin, group 1 meat. Shared by every instance: never dispose it. */
  geometry: THREE.BufferGeometry;
  /** Where its middle sits in the model's bind space, and the bone that part of the trunk rides. */
  at: THREE.Vector3;
  bone: number;
  /** Half its bounds, for the box it rests on. */
  half: THREE.Vector3;
  /** Its volume, for the audit. */
  litres: number;
  /** The way its skin faces, in bind space: it leaves the body that way. */
  normal: THREE.Vector3;
}

/** Where on the trunk each slab is lifted from: the way out from the spine, the height, and how its long axis lies. */
interface Site {
  dir: readonly [number, number];
  /** 0 the hips bone, 1 the chest bone, and metres above that on a 1.85 m body. */
  level: number;
  rise: number;
  /** Radians its long axis is turned from upright. */
  lean: number;
}

const SITES: readonly Site[] = [
  { dir: [0.5, 0.86], level: 1, rise: 0.1, lean: 0.35 },
  { dir: [-0.6, -0.8], level: 1, rise: 0.13, lean: -0.5 },
  { dir: [0.97, 0.12], level: 0.55, rise: 0.02, lean: 0.1 },
  { dir: [-0.2, 0.98], level: 0.3, rise: 0, lean: 1.2 },
  { dir: [0.3, -0.95], level: 0.35, rise: 0, lean: -1.1 },
  { dir: [-0.88, 0.48], level: 0.95, rise: 0, lean: -0.25 },
];

const SKIN_FAT = new THREE.Color(0.93, 0.7, 0.5);
const MEAT_DEEP = new THREE.Color(0.34, 0.012, 0.02);
const MEAT_RAW = new THREE.Color(0.78, 0.03, 0.045);
const MEAT_PINK = new THREE.Color(0.9, 0.2, 0.2);
const SINEW = new THREE.Color(0.92, 0.66, 0.6);

/** Smooth noise in -1..1 from a position: three sines, so both faces of a slab agree where they meet. */
const wave = (x: number, y: number, z: number, k: number): number =>
  (Math.sin(x * 41 + k) + Math.sin(y * 53 + k * 1.7) + Math.sin(z * 47 + k * 2.3) + Math.sin((x + y + z) * 29 + k * 0.6)) * 0.25;

/** A patch of the trunk's skin on its own: every attribute as plain numbers, so it can be split finer and cut. */
interface Patch {
  names: string[];
  size: number[];
  data: number[][];
  index: number[];
}

/** Splits every triangle in four, `times` over. A midpoint takes the mean of every attribute, which is what the skin draws there anyway. */
function refine(patch: Patch, times: number): void {
  const pos = patch.names.indexOf('position');
  for (let pass = 0; pass < times; pass++) {
    const mids = new Map<number, number>();
    const count = () => patch.data[pos]!.length / 3;
    const mid = (a: number, b: number): number => {
      const key = a < b ? a * 1e6 + b : b * 1e6 + a;
      let m = mids.get(key);
      if (m !== undefined) return m;
      m = count();
      for (let k = 0; k < patch.data.length; k++) {
        const d = patch.data[k]!;
        const n = patch.size[k]!;
        for (let c = 0; c < n; c++) d.push((d[a * n + c]! + d[b * n + c]!) * 0.5);
      }
      mids.set(key, m);
      return m;
    };
    const next: number[] = [];
    for (let t = 0; t < patch.index.length; t += 3) {
      const a = patch.index[t]!, b = patch.index[t + 1]!, c = patch.index[t + 2]!;
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      next.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
    }
    patch.index = next;
  }
}

/** For each vertex, the first at the same place: a baked skin is split along its UV charts. */
function weldOf(pos: readonly number[]): Int32Array {
  const n = pos.length / 3;
  const out = new Int32Array(n);
  const seen = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const key = `${Math.round(pos[i * 3]! * 8192)},${Math.round(pos[i * 3 + 1]! * 8192)},${Math.round(pos[i * 3 + 2]! * 8192)}`;
    const first = seen.get(key);
    if (first === undefined) seen.set(key, i);
    out[i] = first ?? i;
  }
  return out;
}

/**
 * Lifts the slabs off a trunk. `trunk` is the archetype's bind-pose bake with head and limbs folded away (what the kit is
 * cut from), compacted; it is only read. `hipsY` and `chestY` are the heights of those bones in it.
 */
export function buildSlabs(trunk: THREE.BufferGeometry, char: CharacterInstance, hipsY: number, chestY: number): Slab[] {
  const s = char.rig.height / 1.85;
  const broad = Math.max(1, (char.rig.bones[B.chest]!.hit?.radius ?? 0.16) / (0.16 * s));
  const position = trunk.getAttribute('position') as THREE.BufferAttribute;
  const normal = trunk.getAttribute('normal') as THREE.BufferAttribute;
  const pos = position.array as Float32Array;
  const nor = normal.array as Float32Array;
  const index = trunk.getIndex()!.array as ArrayLike<number>;
  const count = position.count;
  const names = Object.keys(trunk.attributes).filter(n => n !== 'color');
  const attrs = names.map(n => trunk.getAttribute(n) as THREE.BufferAttribute);
  const seed = [...char.archetype].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);
  const rnd = mulberry32(seed ^ 0x51ab);
  const out: Slab[] = [];
  const P = new THREE.Vector3();
  const N = new THREE.Vector3();
  const U = new THREE.Vector3();
  const W = new THREE.Vector3();
  const q = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  for (const site of SITES) {
    const y0 = hipsY + (chestY - hipsY) * site.level + site.rise * s;
    // The skin furthest out that way at that height.
    let best = -Infinity;
    let at = -1;
    for (let i = 0; i < count; i++) {
      if (Math.abs(pos[i * 3 + 1]! - y0) > 0.035 * s) continue;
      const d = pos[i * 3]! * site.dir[0] + pos[i * 3 + 2]! * site.dir[1];
      // Facing out, so the pick is skin and not the inside of a cap.
      if (d > best && nor[i * 3]! * site.dir[0] + nor[i * 3 + 2]! * site.dir[1] > 0.3) {
        best = d;
        at = i;
      }
    }
    if (at < 0) continue;
    P.set(pos[at * 3]!, pos[at * 3 + 1]!, pos[at * 3 + 2]!);
    // The patch's own facing: the skin's round the pick, not one vertex's.
    N.set(0, 0, 0);
    for (let i = 0; i < count; i++) {
      const d2 = (pos[i * 3]! - P.x) ** 2 + (pos[i * 3 + 1]! - P.y) ** 2 + (pos[i * 3 + 2]! - P.z) ** 2;
      if (d2 < (0.08 * s) ** 2) N.set(N.x + nor[i * 3]!, N.y + nor[i * 3 + 1]!, N.z + nor[i * 3 + 2]!);
    }
    if (N.lengthSq() < 1e-6) N.set(site.dir[0], 0, site.dir[1]);
    N.normalize();
    U.copy(up).addScaledVector(N, -up.dot(N)).normalize();
    W.crossVectors(N, U);
    const lean = site.lean + (rnd() - 0.5) * 0.3;
    q.copy(U).multiplyScalar(Math.cos(lean)).addScaledVector(W, Math.sin(lean));
    U.copy(q);
    W.crossVectors(N, U);
    const a = (SlabTuning.long[0] + (SlabTuning.long[1] - SlabTuning.long[0]) * rnd()) * s;
    const b = (SlabTuning.wide[0] + (SlabTuning.wide[1] - SlabTuning.wide[0]) * rnd()) * s * broad;
    const p1 = rnd() * 6.28, p2 = rnd() * 6.28, p3 = rnd() * 6.28, p4 = rnd() * 6.28;
    // A torn outline: a few broad tongues and bays, and a ragged edge on them. Never an ellipse.
    const edge = (phi: number, x: number, y: number, z: number): number =>
      1 + 0.17 * Math.sin(3 * phi + p1) + 0.1 * Math.sin(5 * phi + p2) + 0.05 * Math.sin(9 * phi + p3)
      + 0.075 * wave(x / s * 3.4, y / s * 3.4, z / s * 3.4, p4) + 0.04 * wave(x / s * 9, y / s * 9, z / s * 9, p4 + 2);
    // How far out a point is, 0 at the middle and 1 on the outline; 9 where it is not this side of the body at all.
    const farOf = (x: number, y: number, z: number, nx: number, ny: number, nz: number): number => {
      q.set(x - P.x, y - P.y, z - P.z);
      const u = q.dot(U) / a;
      const w = q.dot(W) / b;
      // The same side of the body, and not a cap or the far wall of the trunk behind the patch.
      if (q.dot(N) < -0.11 * s || nx * N.x + ny * N.y + nz * N.z < 0.05) return 9;
      return Math.hypot(u, w) / edge(Math.atan2(w, u), x, y, z);
    };

    // The skin round the pick, lifted out as a patch of its own and split fine enough to tear.
    const patch: Patch = { names, size: attrs.map(t => t.itemSize), data: names.map(() => []), index: [] };
    const local = new Map<number, number>();
    const use = (v: number): number => {
      let o = local.get(v);
      if (o === undefined) {
        o = local.size;
        local.set(v, o);
        for (let k = 0; k < attrs.length; k++) {
          const t = attrs[k]!;
          const src = t.array as THREE.TypedArray;
          for (let c = 0; c < t.itemSize; c++) patch.data[k]!.push(src[v * t.itemSize + c]!);
        }
      }
      return o;
    };
    for (let t = 0; t < index.length; t += 3) {
      let near = 9;
      let worst = 0;
      for (let c = 0; c < 3; c++) {
        const v = index[t + c]!;
        const f = farOf(pos[v * 3]!, pos[v * 3 + 1]!, pos[v * 3 + 2]!, nor[v * 3]!, nor[v * 3 + 1]!, nor[v * 3 + 2]!);
        near = Math.min(near, f);
        worst = Math.max(worst, f);
      }
      if (near < 1.25 && worst < 9) patch.index.push(use(index[t]!), use(index[t + 1]!), use(index[t + 2]!));
    }
    if (patch.index.length < 9) continue;
    refine(patch, SlabTuning.split);
    const pp = patch.data[names.indexOf('position')]!;
    const pn = patch.data[names.indexOf('normal')]!;
    const total = pp.length / 3;
    const far = new Float32Array(total);
    for (let i = 0; i < total; i++) far[i] = farOf(pp[i * 3]!, pp[i * 3 + 1]!, pp[i * 3 + 2]!, pn[i * 3]!, pn[i * 3 + 1]!, pn[i * 3 + 2]!);
    // Every triangle that reaches inside the outline, and each of its corners that lies outside drawn in to the outline
    // along the line from the middle: the edge is the torn curve itself, not the saw teeth of the triangles it crosses.
    const tris: number[] = [];
    for (let t = 0; t < patch.index.length; t += 3) {
      const fa = far[patch.index[t]!]!, fb = far[patch.index[t + 1]!]!, fc = far[patch.index[t + 2]!]!;
      // Two corners inside: with one, the triangle would be a spike on the outline once its other two are drawn in.
      if (Math.max(fa, fb, fc) < 9 && (fa < 1 ? 1 : 0) + (fb < 1 ? 1 : 0) + (fc < 1 ? 1 : 0) >= 2) tris.push(t);
    }
    if (tris.length < 40) continue;
    const drawn = new Uint8Array(total);
    for (const t of tris) {
      for (let c = 0; c < 3; c++) {
        const v = patch.index[t + c]!;
        if (far[v]! <= 1 || drawn[v]) continue;
        drawn[v] = 1;
        q.set(pp[v * 3]! - P.x, pp[v * 3 + 1]! - P.y, pp[v * 3 + 2]! - P.z);
        const h = q.dot(N);
        // In along the patch's plane, keeping its height off it; twice, since the outline wanders as the point moves.
        let k = 1 / far[v]!;
        for (let pass = 0; pass < 2; pass++) {
          const x = P.x + (q.x - N.x * h) * k + N.x * h, y = P.y + (q.y - N.y * h) * k + N.y * h, z = P.z + (q.z - N.z * h) * k + N.z * h;
          const f = farOf(x, y, z, N.x, N.y, N.z);
          if (pass === 1 || f > 8) {
            pp[v * 3] = x;
            pp[v * 3 + 1] = y;
            pp[v * 3 + 2] = z;
          } else k /= f;
        }
        far[v] = 1;
      }
    }
    const weld = weldOf(pp);
    const owner = new Map<number, number[]>();
    for (let k = 0; k < tris.length; k++) {
      for (let c = 0; c < 3; c++) {
        const v = weld[patch.index[tris[k]! + c]!]!;
        let list = owner.get(v);
        if (!list) owner.set(v, (list = []));
        list.push(k);
      }
    }
    // The biggest island of them: a trunk's pouches and caps are islands of its mesh, and a slab is one piece.
    const islandOf = new Int32Array(tris.length).fill(-1);
    let biggest = -1;
    let most = 0;
    for (let k0 = 0; k0 < tris.length; k0++) {
      if (islandOf[k0]! >= 0) continue;
      let size = 0;
      const stack = [k0];
      islandOf[k0] = k0;
      while (stack.length > 0) {
        const k = stack.pop()!;
        size++;
        for (let c = 0; c < 3; c++) {
          for (const o of owner.get(weld[patch.index[tris[k]! + c]!]!)!) {
            if (islandOf[o]! >= 0) continue;
            islandOf[o] = k0;
            stack.push(o);
          }
        }
      }
      if (size > most) {
        most = size;
        biggest = k0;
      }
    }
    const island = tris.filter((_, k) => islandOf[k] === biggest);
    if (island.length < 40) continue;
    const slab = assemble(patch, attrs, island, weld, far, N, U, W, P, s, seed + out.length * 7);
    slab.bone = y0 > (hipsY + chestY) / 2 ? B.chest : B.hips;
    out.push(slab);
  }
  return out;
}

/** Builds one slab's geometry from the skin triangles `island` of `patch`: the skin, the meat under it and the lip between. */
function assemble(
  patch: Patch, attrs: readonly THREE.BufferAttribute[], island: readonly number[], weld: Int32Array, far: Float32Array,
  N: THREE.Vector3, U: THREE.Vector3, W: THREE.Vector3, P: THREE.Vector3, s: number, seed: number,
): Slab {
  const index = patch.index;
  const names = patch.names;
  const pos = patch.data[names.indexOf('position')]!;
  const k0 = (seed % 97) * 0.13;

  // Skin vertices as they are; under each welded one, a meat vertex; and on the outline, a lip vertex over it.
  const skinOf = new Map<number, number>();
  const meatOf = new Map<number, number>();
  const lipOf = new Map<number, number>();
  const from: number[] = [];
  const kind: number[] = [];
  const take = (v: number, what: 0 | 1 | 2, map: Map<number, number>, key: number): number => {
    let o = map.get(key);
    if (o === undefined) {
      o = from.length;
      map.set(key, o);
      from.push(v);
      kind.push(what);
    }
    return o;
  };
  const skinIdx: number[] = [];
  const edges = new Map<number, [number, number, number]>();
  for (const t of island) {
    const tri = [index[t]!, index[t + 1]!, index[t + 2]!] as const;
    for (let c = 0; c < 3; c++) {
      skinIdx.push(take(tri[c]!, 0, skinOf, tri[c]!));
      const a = weld[tri[c]!]!, b = weld[tri[(c + 1) % 3]!]!;
      const back = edges.get(b * 1e6 + a);
      // An edge two triangles share runs once each way: what is left is the outline.
      if (back) back[2] = 2;
      else edges.set(a * 1e6 + b, [tri[c]!, tri[(c + 1) % 3]!, 1]);
    }
  }
  const meatIdx: number[] = [];
  for (const t of island) {
    const a = take(index[t]!, 1, meatOf, weld[index[t]!]!);
    const b = take(index[t + 1]!, 1, meatOf, weld[index[t + 1]!]!);
    const c = take(index[t + 2]!, 1, meatOf, weld[index[t + 2]!]!);
    meatIdx.push(c, b, a);
  }
  const onLip = new Set<number>();
  for (const [a, b, uses] of edges.values()) {
    if (uses !== 1) continue;
    const la = take(a, 2, lipOf, weld[a]!);
    const lb = take(b, 2, lipOf, weld[b]!);
    const ma = meatOf.get(weld[a]!)!;
    const mb = meatOf.get(weld[b]!)!;
    onLip.add(ma).add(mb);
    meatIdx.push(lb, la, ma, lb, ma, mb);
  }

  // The skin's own lie over the patch, without its relief: height above the patch's plane as a smooth bowl, fitted to
  // the skin by least squares. The meat's underside follows that, so plates and seams show as thickness, not as dents.
  const fit = bowl(island, index, pos, P, N, U, W);

  const n = from.length;
  const g = new THREE.BufferGeometry();
  const outPos = new Float32Array(n * 3);
  const color = new Float32Array(n * 3);
  const c = new THREE.Color();
  let depthSum = 0;
  let depthN = 0;
  for (let i = 0; i < n; i++) {
    const v = from[i]!;
    let x = pos[v * 3]!, y = pos[v * 3 + 1]!, z = pos[v * 3 + 2]!;
    const r = Math.min(1, far[v]!);
    if (kind[i] === 1) {
      const u = (x - P.x) * U.x + (y - P.y) * U.y + (z - P.z) * U.z;
      const w = (x - P.x) * W.x + (y - P.y) * W.y + (z - P.z) * W.z;
      const h = (x - P.x) * N.x + (y - P.y) * N.y + (z - P.z) * N.z;
      // Thick most of the way across and rounding in to the lip, lumpy as muscle is: bundles along the slab, and bulges.
      const lump = 0.82 + 0.3 * wave(x / s, y / s, z / s, k0) + 0.16 * Math.sin((w / s) * 70 + Math.sin((u / s) * 16 + k0) * 1.2);
      const lip = SlabTuning.lip * s * (0.75 + 0.5 * (0.5 + 0.5 * wave(x / s * 2, y / s * 2, z / s * 2, k0 + 5)));
      const depth = lip + SlabTuning.thick * s * (1 - r * r) ** 0.45 * lump;
      // Straight in from the skin, to the bowl less the depth, and never above the skin's own lip.
      const under = Math.min(h - lip, fit(u, w) - depth);
      depthSum += h - under;
      depthN++;
      // The meat's own edge is torn back from the skin's, by more here and less there: the wall between them slopes.
      const back = onLip.has(i) ? 1 - (0.011 + 0.009 * wave(x / s * 3, y / s * 3, z / s * 3, k0 + 9)) * s / Math.max(0.03 * s, Math.hypot(u, w)) : 1;
      x = P.x + U.x * u * back + W.x * w * back + N.x * under;
      y = P.y + U.y * u * back + W.y * w * back + N.y * under;
      z = P.z + U.z * u * back + W.z * w * back + N.z * under;
      // Muscle in bands along the slab, darker in the troughs, sinew in a few pale streaks, fat toward the lip.
      const band = Math.sin((w / s) * 70 + Math.sin((u / s) * 16 + k0) * 1.2);
      c.copy(MEAT_DEEP).lerp(MEAT_RAW, 0.5 + 0.5 * band).lerp(MEAT_PINK, Math.max(0, lump - 1) * 1.2);
      if (band > 0.95 && r < 0.75) c.lerp(SINEW, 0.5);
    } else if (kind[i] === 2) {
      // The lip: the line of fat under the skin, bloodied. The wall under it runs to red by the meat's own edge.
      c.copy(SKIN_FAT).lerp(MEAT_RAW, 0.2 + 0.35 * (0.5 + 0.5 * wave(x / s * 2, y / s * 2, z / s * 2, k0 + 3)));
      // Just under the skin's edge, so the skin stands a hair proud of it.
      x -= N.x * 0.0025 * s;
      y -= N.y * 0.0025 * s;
      z -= N.z * 0.0025 * s;
    } else c.setRGB(1, 1, 1);
    outPos[i * 3] = x;
    outPos[i * 3 + 1] = y;
    outPos[i * 3 + 2] = z;
    color[i * 3] = c.r;
    color[i * 3 + 1] = c.g;
    color[i * 3 + 2] = c.b;
  }

  // Centre it, and measure it.
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  for (let i = 0; i < n; i++) {
    min.min(c3(outPos, i));
    max.max(c3(outPos, i));
  }
  const at = min.clone().add(max).multiplyScalar(0.5);
  for (let i = 0; i < n; i++) {
    outPos[i * 3] = outPos[i * 3]! - at.x;
    outPos[i * 3 + 1] = outPos[i * 3 + 1]! - at.y;
    outPos[i * 3 + 2] = outPos[i * 3 + 2]! - at.z;
  }
  let area = 0;
  for (const t of island) {
    const a = index[t]! * 3, b = index[t + 1]! * 3, d = index[t + 2]! * 3;
    const e1x = pos[b]! - pos[a]!, e1y = pos[b + 1]! - pos[a + 1]!, e1z = pos[b + 2]! - pos[a + 2]!;
    const e2x = pos[d]! - pos[a]!, e2y = pos[d + 1]! - pos[a + 1]!, e2z = pos[d + 2]! - pos[a + 2]!;
    area += Math.hypot(e1y * e2z - e1z * e2y, e1z * e2x - e1x * e2z, e1x * e2y - e1y * e2x) * 0.5;
  }

  for (let k = 0; k < names.length; k++) {
    const a = attrs[k]!;
    if (names[k] === 'position') {
      g.setAttribute('position', new THREE.BufferAttribute(outPos, 3));
      continue;
    }
    const src = patch.data[k]!;
    const whole = !(a.array instanceof Float32Array);
    const dst = new (a.array.constructor as new (n: number) => THREE.TypedArray)(n * a.itemSize);
    for (let i = 0; i < n; i++) {
      const o = from[i]! * a.itemSize;
      for (let j = 0; j < a.itemSize; j++) dst[i * a.itemSize + j] = whole ? Math.round(src[o + j]!) : src[o + j]!;
    }
    if (names[k] === 'uv') {
      // The meat's fibres run along the slab: the cut face's texture, laid by where a vertex is on the patch.
      const scale = a.normalized ? 65535 : 1;
      const wrap = (t: number) => (scale === 1 ? t : (t - Math.floor(t)) * scale);
      for (let i = 0; i < n; i++) {
        if (kind[i] === 0) continue;
        const x = outPos[i * 3]! + at.x - P.x, y = outPos[i * 3 + 1]! + at.y - P.y, z = outPos[i * 3 + 2]! + at.z - P.z;
        // Down the wall as well as across the slab, or the lip's fibres would be one texel pulled into streaks.
        const down = (x * N.x + y * N.y + z * N.z) * 3.5;
        dst[i * 2] = wrap((x * U.x + y * U.y + z * U.z) * 3.5 + down);
        dst[i * 2 + 1] = wrap((x * W.x + y * W.y + z * W.z) * 3.5 + down * 0.7);
      }
    }
    g.setAttribute(names[k]!, new THREE.BufferAttribute(dst, a.itemSize, a.normalized));
  }
  g.setAttribute('color', new THREE.BufferAttribute(color, 3));
  g.setIndex([...skinIdx, ...meatIdx]);
  g.addGroup(0, skinIdx.length, 0);
  g.addGroup(skinIdx.length, meatIdx.length, 1);

  // The meat's and the lip's normals from their own faces; the skin keeps the body's.
  const outNor = g.getAttribute('normal').array as Float32Array;
  const acc = new Float32Array(n * 3);
  for (let t = 0; t < meatIdx.length; t += 3) {
    const a = meatIdx[t]!, b = meatIdx[t + 1]!, d = meatIdx[t + 2]!;
    const e1x = outPos[b * 3]! - outPos[a * 3]!, e1y = outPos[b * 3 + 1]! - outPos[a * 3 + 1]!, e1z = outPos[b * 3 + 2]! - outPos[a * 3 + 2]!;
    const e2x = outPos[d * 3]! - outPos[a * 3]!, e2y = outPos[d * 3 + 1]! - outPos[a * 3 + 1]!, e2z = outPos[d * 3 + 2]! - outPos[a * 3 + 2]!;
    const fx = e1y * e2z - e1z * e2y, fy = e1z * e2x - e1x * e2z, fz = e1x * e2y - e1y * e2x;
    for (const v of [a, b, d]) {
      acc[v * 3] = acc[v * 3]! + fx;
      acc[v * 3 + 1] = acc[v * 3 + 1]! + fy;
      acc[v * 3 + 2] = acc[v * 3 + 2]! + fz;
    }
  }
  for (let i = 0; i < n; i++) {
    if (kind[i] === 0) {
      // A midpoint's normal is the mean of two: back to unit length.
      const l = 1 / (Math.hypot(outNor[i * 3]!, outNor[i * 3 + 1]!, outNor[i * 3 + 2]!) || 1);
      outNor[i * 3] = outNor[i * 3]! * l;
      outNor[i * 3 + 1] = outNor[i * 3 + 1]! * l;
      outNor[i * 3 + 2] = outNor[i * 3 + 2]! * l;
      continue;
    }
    const l = 1 / (Math.hypot(acc[i * 3]!, acc[i * 3 + 1]!, acc[i * 3 + 2]!) || 1);
    outNor[i * 3] = acc[i * 3]! * l;
    outNor[i * 3 + 1] = acc[i * 3 + 1]! * l;
    outNor[i * 3 + 2] = acc[i * 3 + 2]! * l;
  }
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return {
    geometry: g, at, bone: B.chest, half: max.clone().sub(min).multiplyScalar(0.5),
    litres: area * (depthN > 0 ? depthSum / depthN : 0) * 1000, normal: N.clone(),
  };
}

/**
 * The smooth surface nearest a patch of skin: its height over the patch's plane as `a + bu + cw + du² + euw + fw²`, by
 * least squares over the patch's vertices. Returns that height at (u, w).
 */
function bowl(
  island: readonly number[], index: readonly number[], pos: readonly number[], P: THREE.Vector3, N: THREE.Vector3, U: THREE.Vector3, W: THREE.Vector3,
): (u: number, w: number) => number {
  const A = Array.from({ length: 6 }, () => new Float64Array(7));
  const row = new Float64Array(6);
  const seen = new Set<number>();
  for (const t of island) {
    for (let c = 0; c < 3; c++) {
      const v = index[t + c]!;
      if (seen.has(v)) continue;
      seen.add(v);
      const x = pos[v * 3]! - P.x, y = pos[v * 3 + 1]! - P.y, z = pos[v * 3 + 2]! - P.z;
      const u = x * U.x + y * U.y + z * U.z;
      const w = x * W.x + y * W.y + z * W.z;
      const h = x * N.x + y * N.y + z * N.z;
      row[0] = 1; row[1] = u; row[2] = w; row[3] = u * u; row[4] = u * w; row[5] = w * w;
      for (let i = 0; i < 6; i++) {
        for (let j = 0; j < 6; j++) A[i]![j] = A[i]![j]! + row[i]! * row[j]!;
        A[i]![6] = A[i]![6]! + row[i]! * h;
      }
    }
  }
  // Gauss-Jordan, with a little on the diagonal so a flat or thin patch still solves.
  for (let i = 0; i < 6; i++) A[i]![i] = A[i]![i]! + 1e-9;
  for (let i = 0; i < 6; i++) {
    let pivot = i;
    for (let r = i + 1; r < 6; r++) if (Math.abs(A[r]![i]!) > Math.abs(A[pivot]![i]!)) pivot = r;
    [A[i], A[pivot]] = [A[pivot]!, A[i]!];
    const d = A[i]![i]! || 1e-12;
    for (let j = i; j < 7; j++) A[i]![j] = A[i]![j]! / d;
    for (let r = 0; r < 6; r++) {
      if (r === i) continue;
      const k = A[r]![i]!;
      if (k === 0) continue;
      for (let j = i; j < 7; j++) A[r]![j] = A[r]![j]! - k * A[i]![j]!;
    }
  }
  const k = A.map(r => r[6]!);
  return (u, w) => k[0]! + k[1]! * u + k[2]! * w + k[3]! * u * u + k[4]! * u * w + k[5]! * w * w;
}

const _c3 = new THREE.Vector3();
const c3 = (a: Float32Array, i: number): THREE.Vector3 => _c3.set(a[i * 3]!, a[i * 3 + 1]!, a[i * 3 + 2]!);
