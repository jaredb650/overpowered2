/**
 * What spills out of a broken trunk: four organs as wet blobs, and one whole ribcage pre-split into six fragments that fit
 * back together (left and right ribs upper and lower, the sternum with its cartilage, the spine with the rib heads). All
 * built in code once, at load, and drawn as instances by `ChunkField`.
 *
 * The ribcage is built in the chest bone's frame for a 1.85 m man (y up from the chest bone, the front toward +z), so a
 * burst can start every fragment where it sits in the body before it flies.
 */
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clamp, mulberry32 } from '../core/math';

export type OrganKind = 'lung' | 'liver' | 'heart' | 'stomach';
export type RibKind = 'ribsUL' | 'ribsLL' | 'ribsUR' | 'ribsLR' | 'sternum' | 'spine';
export const ORGANS: readonly OrganKind[] = ['lung', 'liver', 'heart', 'stomach'];
export const RIB_KINDS: readonly RibKind[] = ['ribsUL', 'ribsLL', 'ribsUR', 'ribsLR', 'sternum', 'spine'];

const BONE = new THREE.Color(0xe6dac4);
const CARTILAGE = new THREE.Color(0xa99a90);
const BLOOD = new THREE.Color(0x6e0a0c);
const MARROW = new THREE.Color(0x8a1414);

/** Collects vertices, normals and colours, and closes into one indexed geometry. */
class Builder {
  readonly pos: number[] = [];
  readonly nor: number[] = [];
  readonly col: number[] = [];
  readonly idx: number[] = [];
  vertex(p: THREE.Vector3, n: THREE.Vector3, c: THREE.Color): number {
    this.pos.push(p.x, p.y, p.z);
    this.nor.push(n.x, n.y, n.z);
    this.col.push(c.r, c.g, c.b);
    return this.pos.length / 3 - 1;
  }
  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    return g;
  }
}

const _t = new THREE.Vector3();
const _u = new THREE.Vector3();
const _w = new THREE.Vector3();
const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

/**
 * A flat band along `path`: `ry` tall (the broad face of a rib looks outward), `rx` thick, five sides, and both ends
 * closed with raw marrow, pushed about along the band so a break is jagged. `tint(i)` colours ring i.
 */
function band(b: Builder, path: readonly THREE.Vector3[], rx: number, ry: number, tint: (i: number, out: THREE.Color) => void, rnd: () => number): void {
  const sides = 5;
  const rings: number[] = [];
  const n = path.length;
  for (let i = 0; i < n; i++) {
    _t.subVectors(path[Math.min(n - 1, i + 1)]!, path[Math.max(0, i - 1)]!).normalize();
    _u.copy(UP).addScaledVector(_t, -UP.dot(_t)).normalize();
    _w.crossVectors(_t, _u);
    tint(i, _c);
    // The two ends break raggedly: each corner of the last ring sits a little further along, or short of it.
    const jag = i === 0 || i === n - 1 ? 0.0045 : 0;
    rings.push(b.pos.length / 3);
    for (let j = 0; j < sides; j++) {
      const a = (j / sides) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      _p.copy(path[i]!).addScaledVector(_u, ca * ry).addScaledVector(_w, sa * rx).addScaledVector(_t, (rnd() - 0.5) * 2 * jag);
      _n.copy(_u).multiplyScalar(ca / ry).addScaledVector(_w, sa / rx).normalize();
      b.vertex(_p, _n, _c);
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < sides; j++) {
      const k = (j + 1) % sides;
      const a = rings[i]! + j, c = rings[i]! + k, d = rings[i + 1]! + k, e = rings[i + 1]! + j;
      b.tri(a, c, e);
      b.tri(c, d, e);
    }
  }
  for (const [ring, at, sign] of [[rings[0]!, 0, -1], [rings[n - 1]!, n - 1, 1]] as const) {
    _t.subVectors(path[Math.min(n - 1, at + 1)]!, path[Math.max(0, at - 1)]!).normalize().multiplyScalar(sign);
    const centre = b.vertex(path[at]!, _t, MARROW);
    for (let j = 0; j < sides; j++) {
      const k = (j + 1) % sides;
      if (sign < 0) b.tri(centre, ring + k, ring + j);
      else b.tri(centre, ring + j, ring + k);
    }
  }
}

/** Adds a colour from `pick(x, y, z, noise)` and drops the UVs, so pieces built from three.js shapes merge with bands. */
function tinted(g: THREE.BufferGeometry, seed: number, pick: (x: number, y: number, z: number, k: number, out: THREE.Color) => void): THREE.BufferGeometry {
  const rnd = mulberry32(seed);
  const out = g;
  out.deleteAttribute('uv');
  const pos = out.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    pick(pos.getX(i), pos.getY(i), pos.getZ(i), rnd(), _c);
    colors[i * 3] = _c.r;
    colors[i * 3 + 1] = _c.g;
    colors[i * 3 + 2] = _c.b;
  }
  out.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return out;
}

const bloodied = (base: THREE.Color, k: number, extra: number, out: THREE.Color) =>
  out.copy(base).lerp(BLOOD, clamp((k - 0.55) * 1.4 + extra, 0, 0.9));

// ---------------------------------------------------------------------------------------------
// Ribcage
// ---------------------------------------------------------------------------------------------

const RIBS = 12;
/** Half width of each rib's hoop, top to bottom. */
const RIB_WIDTH = [0.062, 0.092, 0.112, 0.126, 0.136, 0.142, 0.145, 0.145, 0.14, 0.132, 0.118, 0.104];
/** Where the bone of each rib ends and cartilage starts, as a share of the half turn from spine to sternum. */
const RIB_BONE = [0.82, 0.8, 0.79, 0.78, 0.77, 0.76, 0.75, 0.72, 0.7, 0.68, 0.56, 0.44];
/** Where its cartilage meets the sternum (true ribs) or the rib above (false ribs). Floating ribs have none. */
const RIB_END = [0.95, 0.95, 0.95, 0.94, 0.94, 0.93, 0.92, 0.9, 0.88, 0.86, 0.56, 0.44];
const STERNUM_Z = 0.098;
const STERNUM_LOW = -0.01;
const STERNUM_TOP = 0.2;

/** A point on rib `i` at `s` (0 the spine, 1 the front) on side `side` (+1 his left, +X). */
function ribPoint(i: number, s: number, side: number, out: THREE.Vector3): THREE.Vector3 {
  const th = s * Math.PI;
  const w = RIB_WIDTH[i]!;
  // A hoop from the rib head beside the spine (z -0.068) round to the sternum's edge (STERNUM_Z), narrower at the top.
  const zc = (STERNUM_Z - 0.068) / 2;
  const depth = (STERNUM_Z + 0.068) / 2 * (0.82 + 0.18 * Math.min(1, i / 4));
  const yBack = 0.232 - i * 0.026;
  const drop = 0.045 + 0.007 * i;
  let y = yBack - drop * s ** 1.3;
  // False ribs' cartilage sweeps up to the bottom of the sternum.
  const bone = RIB_BONE[i]!;
  if (i >= 7 && i <= 9 && s > bone) y += (s - bone) / (RIB_END[i]! - bone) * (STERNUM_LOW + 0.02 - (yBack - drop)) * 0.9;
  return out.set(side * (0.019 + (w - 0.019) * Math.sin(th)), y, zc - depth * Math.cos(th));
}

/** One stretch of a rib, s0 to s1, as a band. */
function ribStretch(b: Builder, i: number, side: number, s0: number, s1: number, rnd: () => number): void {
  if (s1 - s0 < 0.01) return;
  const steps = Math.max(2, Math.ceil((s1 - s0) * 20));
  const path: THREE.Vector3[] = [];
  for (let k = 0; k <= steps; k++) path.push(ribPoint(i, s0 + (s1 - s0) * (k / steps), side, new THREE.Vector3()));
  const bone = RIB_BONE[i]!;
  const thick = i < 2 ? 0.0075 : 0.006;
  band(b, path, thick, i < 2 ? 0.012 : 0.0098, (k, out) => {
    const s = s0 + (s1 - s0) * (k / steps);
    const base = s > bone ? CARTILAGE : BONE;
    // Blood soaks in toward each broken end.
    // Off-white bone with blood in patches, soaked toward each broken end.
    const end = Math.min(k, steps - k) <= 1 ? 0.6 : 0;
    bloodied(base, rnd() * 0.88, end, out);
  }, rnd);
}

function sternum(seed: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(1, 1, 1, 2, 6, 1);
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) + 0.5;
    // Manubrium wide at the top, the body narrower, the xiphoid a point.
    const w = y > 0.8 ? 0.042 : y > 0.12 ? 0.026 + (y - 0.12) * 0.01 : 0.008 + y * 0.15;
    pos.setXYZ(i, pos.getX(i) * w, STERNUM_LOW + y * (STERNUM_TOP - STERNUM_LOW), STERNUM_Z + pos.getZ(i) * 0.012);
  }
  g.computeVertexNormals();
  return tinted(g, seed, (_x, y, _z, k, out) => bloodied(BONE, k, y < 0.02 ? 0.3 : 0, out));
}

function vertebrae(seed: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 9; k++) {
    const y = -0.085 + k * 0.039;
    const body = new THREE.CylinderGeometry(0.019, 0.02, 0.029, 7);
    body.translate(0, y, -0.072);
    const spinous = new THREE.BoxGeometry(0.009, 0.018, 0.038);
    spinous.rotateX(0.5);
    spinous.translate(0, y - 0.01, -0.112);
    const wings = new THREE.BoxGeometry(0.07, 0.011, 0.012);
    wings.translate(0, y + 0.004, -0.094);
    parts.push(body, spinous, wings);
  }
  const g = mergeGeometries(parts.map(p => p.toNonIndexed()))!;
  g.computeVertexNormals();
  return tinted(g, seed, (_x, _y, _z, k, out) => bloodied(BONE, k, 0.08, out));
}

/**
 * The whole ribcage, split. Every rib is broken twice at a random point near each end, so the left and right pieces hold
 * the shafts, the spine keeps the rib heads and the sternum the cartilage: put back, they make one ribcage.
 */
export function buildRibcage(seed = 71): Map<RibKind, THREE.BufferGeometry> {
  const rnd = mulberry32(seed);
  const lateral: Record<string, Builder> = { ribsUL: new Builder(), ribsLL: new Builder(), ribsUR: new Builder(), ribsLR: new Builder() };
  const spine = new Builder();
  const front = new Builder();
  for (const side of [1, -1]) {
    for (let i = 0; i < RIBS; i++) {
      const back = 0.09 + rnd() * 0.11;
      const floating = i >= 10;
      const end = RIB_END[i]!;
      const frontBreak = floating ? end : RIB_BONE[i]! - 0.06 + rnd() * 0.1;
      const piece = lateral[`ribs${i < 6 ? 'U' : 'L'}${side > 0 ? 'L' : 'R'}`]!;
      ribStretch(spine, i, side, 0, back, rnd);
      ribStretch(piece, i, side, back, Math.min(frontBreak, end), rnd);
      if (!floating) ribStretch(front, i, side, Math.min(frontBreak, end), end, rnd);
    }
  }
  const out = new Map<RibKind, THREE.BufferGeometry>();
  for (const [k, b] of Object.entries(lateral)) out.set(k as RibKind, b.build());
  out.set('spine', mergeGeometries([spine.build(), mergeVertices(vertebrae(seed + 1))])!);
  out.set('sternum', mergeGeometries([front.build(), mergeVertices(sternum(seed + 2))])!);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Organs
// ---------------------------------------------------------------------------------------------

/**
 * A smooth wet blob of radius about 1: an icosphere welded so it shades round, lumpy by `rough`, pushed into shape by
 * `shape` and coloured by `pick`. Noise is keyed by position so the welded surface stays closed.
 */
function blob(seed: number, rough: number, shape: (p: THREE.Vector3) => void, pick: (p: THREE.Vector3, k: number, out: THREE.Color) => void, detail = 3): THREE.BufferGeometry {
  const base = new THREE.IcosahedronGeometry(1, detail);
  base.deleteAttribute('uv');
  base.deleteAttribute('normal');
  const g = mergeVertices(base);
  const rnd = mulberry32(seed);
  const pos = g.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  // A few soft bumps, not per-vertex noise: an organ is smooth and swollen, not faceted like meat.
  const bumps = Array.from({ length: 9 }, () => [rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1, (rnd() - 0.4) * rough] as const);
  for (let i = 0; i < pos.count; i++) {
    _p.set(pos.getX(i), pos.getY(i), pos.getZ(i));
    let r = 1;
    for (const [bx, by, bz, h] of bumps) r += h * Math.max(0, 1 - _w.set(bx, by, bz).normalize().distanceTo(_p) * 1.4);
    _p.multiplyScalar(r);
    const k = rnd();
    pick(_p, k, _c);
    shape(_p);
    pos.setXYZ(i, _p.x, _p.y, _p.z);
    colors[i * 3] = _c.r;
    colors[i * 3 + 1] = _c.g;
    colors[i * 3 + 2] = _c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}

const LUNG_A = new THREE.Color(0xc4727c);
const LUNG_B = new THREE.Color(0x8e2c3a);
const LIVER_A = new THREE.Color(0x6e1018);
const LIVER_B = new THREE.Color(0xa8242a);
const HEART_A = new THREE.Color(0x8c1019);
const HEART_B = new THREE.Color(0xc92c3c);
const FAT = new THREE.Color(0xc9a25e);
const STOMACH_A = new THREE.Color(0xc08a82);
const STOMACH_B = new THREE.Color(0x8c3a3a);

export function buildOrgans(): Map<OrganKind, THREE.BufferGeometry> {
  const out = new Map<OrganKind, THREE.BufferGeometry>();
  // A lung: tall, flat on the inner face, spongy pink mottled dark.
  out.set('lung', blob(3, 0.22, p => {
    p.x = Math.max(p.x, -0.35) * 0.55;
    p.z *= 0.72;
    if (p.y < -0.55) p.y = -0.55 + (p.y + 0.55) * 0.35;
  }, (p, k, c) => c.copy(LUNG_A).lerp(LUNG_B, clamp(Math.sin(p.x * 9 + p.y * 7) * 0.3 + (k - 0.5) * 0.9 + (p.y < -0.4 ? 0.4 : 0), 0, 0.85))));
  // The liver: a wide glossy wedge, thick on one side and thin on the other.
  out.set('liver', blob(5, 0.18, p => {
    p.y *= 0.42 * (1.15 - 0.45 * (p.x + 1) * 0.5);
    p.x *= 1.3;
    p.z *= 0.8;
  }, (_p, k, c) => c.copy(LIVER_A).lerp(LIVER_B, k * 0.8)));
  // The heart: an egg drawn to a point, dark muscle with fat over the top.
  out.set('heart', blob(7, 0.2, p => {
    p.y *= 1.15;
    if (p.y < 0) {
      const t = 1 + p.y * 0.5;
      p.x *= t;
      p.z *= t;
    }
    p.x += p.y * 0.18;
  }, (p, k, c) => (p.y > 0.6 ? c.copy(FAT).lerp(HEART_B, k * 0.5) : c.copy(HEART_A).lerp(HEART_B, k))));
  // The stomach: a pale bent bag streaked with blood.
  out.set('stomach', blob(9, 0.25, p => {
    p.y = p.y * 0.62 + p.x * p.x * 0.38;
    p.z *= 0.58;
  }, (p, k, c) => c.copy(STOMACH_A).lerp(STOMACH_B, clamp(Math.abs(Math.sin(p.x * 6 + p.z * 4)) * 0.35 + (k - 0.6), 0, 0.7))));
  return out;
}

// ---------------------------------------------------------------------------------------------
// Torn flesh
// ---------------------------------------------------------------------------------------------

const MEAT_DARK = new THREE.Color(0x3e0408);
const MEAT_RAW = new THREE.Color(0x9a1622);
const MEAT_PINK = new THREE.Color(0xc8606a);
const FAT_STREAK = new THREE.Color(0xd9bf86);
const SINEW = new THREE.Color(0xe2b7b4);

/**
 * The loose pieces every burst throws: torn meat (soft and lumpy, a ragged flap or two, dark red to pink with fat and
 * sinew streaked through it), a loop of gut, and a splinter of bone. Smooth-shaded and wet, so they read as flesh and not
 * as red gems. One shape each; instances stretch and turn them so no two match.
 */
export function buildFlesh(): Map<'meat' | 'viscera' | 'bone', THREE.BufferGeometry> {
  const out = new Map<'meat' | 'viscera' | 'bone', THREE.BufferGeometry>();
  const rnd = mulberry32(91);
  // Torn: most of the surface swollen and soft, a few vertices pulled out into flaps and strings.
  const flaps = Array.from({ length: 4 }, () => new THREE.Vector3(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1).normalize());
  out.set('meat', blob(13, 0.35, p => {
    const dir = _w.copy(p).normalize();
    let pull = 0;
    for (const f of flaps) pull = Math.max(pull, dir.dot(f));
    // A flap is a thin lip of tissue: out along it, and flattened across.
    const flap = Math.max(0, pull - 0.86) * 4.5;
    p.multiplyScalar(1 + flap * 0.9 + (Math.sin(p.x * 11 + p.z * 7) * 0.5 + 0.5) * 0.06);
    p.y *= 0.72;
  }, (p, k, c) => {
    const streak = Math.sin(p.x * 7.5 + p.y * 12 + p.z * 4 + k * 1.5);
    c.copy(MEAT_DARK).lerp(MEAT_RAW, clamp(0.45 + k * 0.7, 0, 1)).lerp(MEAT_PINK, clamp((p.y + 0.2) * 0.8 * k, 0, 0.6));
    if (streak > 0.93) c.lerp(FAT_STREAK, 0.6);
    else if (streak < -0.92) c.lerp(SINEW, 0.6);
    // Small and many: 96 of them are drawn every frame, so fewer vertices than an organ.
  }, 2));
  // Gut: a short bent sausage, pale and pink, bloodied.
  out.set('viscera', blob(29, 0.15, p => {
    const t = p.x;
    p.set(p.x * 1.6, p.y * 0.42 + t * t * 0.45, p.z * 0.42);
  }, (p, k, c) => c.copy(MEAT_PINK).lerp(SINEW, k * 0.4).lerp(MEAT_RAW, Math.abs(Math.sin(p.x * 9)) > 0.8 ? 0.5 : 0), 2));
  // Bone: a splinter, thick at the break and sharp at the far end, marrow red where it snapped.
  const bone = new THREE.CylinderGeometry(0.25, 0.4, 2.2, 7, 3);
  const pos = bone.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const k = rnd();
    // The top end splinters to a point off to one side; the bottom is jagged.
    if (y > 1) pos.setXYZ(i, pos.getX(i) * 0.25 + 0.12, y + k * 0.3, pos.getZ(i) * 0.25);
    else if (y < -1) pos.setY(i, y - k * 0.35);
  }
  bone.computeVertexNormals();
  out.set('bone', tinted(bone, 97, (_x, y, _z, k, c) => (y < -1.05 ? c.copy(MARROW) : bloodied(BONE, k, y < -0.6 ? 0.35 : 0, c))));
  return out;
}
