/** One pooled skinned character, and the severed limbs it sheds. */
import * as THREE from 'three';
import type { CharacterInstance, SeveredLimb, WoundHit } from '../core/contracts';
import { HumanoidBone as H, type GoreRegion, type RigDef } from './rig';
import type { LoadedModel } from './model';
import { BONE_TEXTURE_SIZE, EXTRA_BLOOD_MAP, EXTRA_FIRE, EXTRA_INFO, EXTRA_PARAMS, EXTRA_TEXELS, EXTRA_WEAR, EXTRA_WOUNDS, REGION_OF } from './anatomy/glsl';
import type { BloodSurfacePool, WalkMesh } from './anatomy/bloodSurface';
import { WearBook, WearKind, type WearKindId } from './anatomy/wear';
import { Organ } from './anatomy/build';
import { FracturePose, type FractureStyle } from './anatomy/fracture';
import { newWoundSpec, STAIN_MARGIN, STAIN_RADII, WOUND_TEXELS, WoundBook, WoundKind, WoundRegion, type WoundKindId } from './anatomy/wounds';
import type { CorpseSnapshot, FarBuffers } from '../gore/far';
import { createAnimator, type PooledAnimation } from './animation/index';
import type { ArchetypeDef } from './archetypes';
import { charredVariant, FIRE_REACH, unburntVariant } from './material';

/** Char past which the kit a body carries (helmet, gun, pack) is burnt black with it. */
const KIT_CHARS_AT = 0.55;

/**
 * Swaps every mesh under `object` to its burnt material, or back. Which is which is the material's own business
 * (`charredVariant`, `unburntVariant`): nothing is written on the mesh, so a clone of burnt kit is burnt kit that can be
 * unburnt like any other, however it was cloned.
 */
export function charKit(object: THREE.Object3D, on: boolean): void {
  object.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material)) return;
    mesh.material = on ? charredVariant(mesh.material) : unburntVariant(mesh.material);
  });
}

/** Near-zero rather than zero, so decomposing a collapsed bone's matrix stays finite. */
export const COLLAPSED = 1e-5;

/** `n` identity 4x4 matrices back to back, cached by count. */
const identityCache = new Map<number, Float32Array>();
function identities(n: number): Float32Array {
  let m = identityCache.get(n);
  if (!m) {
    m = new Float32Array(n * 16);
    for (let i = 0; i < n; i++) m[i * 16] = m[i * 16 + 5] = m[i * 16 + 10] = m[i * 16 + 15] = 1;
    identityCache.set(n, m);
  }
  return m;
}
/** Hit flash intensity lost per second of world time. */
const FLASH_DECAY = 7;

export interface ArchetypeData {
  id: string;
  def: ArchetypeDef;
  rig: RigDef;
  model: LoadedModel;
  material: THREE.Material;
  /** The same skin with holes in it. Only for bodies that have some, because `discard` costs the whole draw. */
  woundMaterial: THREE.Material;
  /** Vertex-colour material for the far LOD. */
  farMaterial: THREE.Material;
  /** What is under the skin, shared by every body of this archetype. Null for machines, which get dents. */
  interior: THREE.BufferGeometry | null;
  /** Surface-walking topology for Overgrowth-style dynamic blood dripping (null for machines or UV-less models). */
  walkMesh?: WalkMesh | null;
  /** Shared pooled DataArrayTexture for dynamic character blood stains. */
  bloodPool?: BloodSurfacePool;
  interiorMaterial: THREE.Material | null;
  /** The inside of an opened body's skin, which is also what it casts its shadow with. */
  backingMaterial: THREE.Material | null;
  /** World clock, read lazily so hit flash fades on corpses that nothing ticks any more. */
  time: { elapsed: number };
  /** Skeleton bone count, rig bones plus cap bones. */
  boneCount: number;
  /** Rig bones in bind position, shared. Offsets are the rest transforms. */
  bindInverses: THREE.Matrix4[];
  bindPositions: THREE.Vector3[];
  children: number[][];
  acquireLimb(): SeveredPart;
}

function makeBones(a: ArchetypeData): THREE.Bone[] {
  const out: THREE.Bone[] = [];
  const skel = a.model.meta.skeleton;
  for (let i = 0; i < skel.length; i++) {
    const b = new THREE.Bone();
    b.name = skel[i]!.name;
    const p = skel[i]!.parent;
    const pos = a.bindPositions[i]!;
    if (p >= 0) b.position.copy(pos).sub(a.bindPositions[p]!);
    else b.position.copy(pos);
    out.push(b);
  }
  return out;
}

/** Replaces three's texture with one that has room for per-instance surface state after the matrices. */
function makeSkeleton(bones: THREE.Bone[], inverses: THREE.Matrix4[]): { skeleton: THREE.Skeleton; extras: number } {
  const skeleton = new THREE.Skeleton(bones, inverses);
  const size = BONE_TEXTURE_SIZE;
  if (bones.length * 4 + EXTRA_TEXELS > size * size) throw new Error(`${bones.length} bones leave no room for the wounds`);
  const data = new Float32Array(size * size * 4);
  data.set(skeleton.boneMatrices!);
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.FloatType);
  tex.needsUpdate = true;
  skeleton.boneMatrices = data;
  skeleton.boneTexture = tex;
  return { skeleton, extras: bones.length * 16 };
}

const v = new THREE.Vector3();
const q = new THREE.Quaternion();
const s = new THREE.Vector3();
const m = new THREE.Matrix4();
const n = new THREE.Vector3();
const u = new THREE.Vector3();
const spec = newWoundSpec();

/** Which parts of the rig a wound on `bone` can touch. A wound at a shoulder or a hip reaches across the joint. */
function woundRegions(a: ArchetypeData, bone: number, radius: number): number {
  if (a.def.rig !== 'humanoid') return WoundRegion.all;
  const near = (joint: number) => v.distanceTo(a.bindPositions[joint]!) < radius + 0.07 * a.def.proportions.scale;
  if (bone <= H.head) {
    let bits: number = WoundRegion.trunk;
    if (near(H.upperArmL)) bits |= WoundRegion.armL;
    if (near(H.upperArmR)) bits |= WoundRegion.armR;
    if (near(H.thighL)) bits |= WoundRegion.legL;
    if (near(H.thighR)) bits |= WoundRegion.legR;
    return bits;
  }
  const own = bone <= H.handL ? WoundRegion.armL : bone <= H.handR ? WoundRegion.armR : bone <= H.footL ? WoundRegion.legL : WoundRegion.legR;
  const root = bone <= H.handL ? H.upperArmL : bone <= H.handR ? H.upperArmR : bone <= H.footL ? H.thighL : H.thighR;
  return near(root) ? own | WoundRegion.trunk : own;
}

/** Puts a wound given in world space into a body's bind space. `v` is left on its centre. */
function placeWound(a: ArchetypeData, book: WoundBook, bone: THREE.Bone, boneIndex: number, hit: WoundHit): void {
  // World to bone local, then bone local to bind space: bind rotations are identity, so that is one add.
  bone.updateWorldMatrix(true, false);
  m.copy(bone.matrixWorld).invert();
  v.copy(hit.point).applyMatrix4(m).add(a.bindPositions[boneIndex]!);
  n.copy(hit.dir).transformDirection(m);
  spec.kind = (!a.interior && hit.kind !== WoundKind.burn && hit.kind !== WoundKind.graze ? WoundKind.dent : hit.kind) as WoundKindId;
  spec.nx = n.x; spec.ny = n.y; spec.nz = n.z;
  spec.radius = hit.radius;
  spec.depth = hit.depth;
  spec.ragged = hit.ragged;
  spec.reach = hit.reach ?? 0;
  spec.regions = woundRegions(a, boneIndex, hit.radius);
  const def = a.rig.bones[boneIndex]!;
  const boneLimit = (def.hit?.radius ?? 0.06) * (def.region === 'head' ? 0.8 : 1.5);
  spec.limit = hit.maxRadius !== undefined ? Math.min(boneLimit, hit.maxRadius) : boneLimit;
  if (hit.along && hit.length) {
    // Square to the axis, so the slot's two ends lie in one plane across the body.
    u.copy(hit.along).transformDirection(m).addScaledVector(n, -u.dot(n)).normalize().multiplyScalar(hit.length);
    spec.hx = u.x; spec.hy = u.y; spec.hz = u.z;
  } else {
    spec.hx = spec.hy = spec.hz = 0;
  }
  spec.cx = v.x; spec.cy = v.y; spec.cz = v.z;
  book.add(spec);
}

interface AttachedProp {
  bone: number;
  object: THREE.Object3D;
  /** Taken off at reset: a partial head's stand-in, not something he spawns with. */
  untilReset: boolean;
}

/** A wound that takes nothing away, for callers that only know where it is. */
const paintDir = new THREE.Vector3();
const paint: WoundHit = { kind: WoundKind.graze, bone: 0, point: paintDir, dir: paintDir, radius: 0.05, depth: 0.03, ragged: 0.5 };

/** Past this LOD a body is too far off for anything but paint. */
export const FAR_LOD = 2;
/** From this LOD on, nothing under the skin is drawn. */
const INSIDE_LOD = 1;

function makeInside(a: ArchetypeData, skeleton: THREE.Skeleton): THREE.SkinnedMesh {
  const inside = new THREE.SkinnedMesh(a.interior!, a.interiorMaterial!);
  // After the skin, so the depth test throws away almost every pixel of it before any shading runs.
  inside.renderOrder = 1;
  inside.castShadow = false;
  inside.receiveShadow = true;
  inside.bind(skeleton, new THREE.Matrix4());
  return inside;
}

function makeBacking(a: ArchetypeData, geometry: THREE.BufferGeometry, skeleton: THREE.Skeleton): THREE.SkinnedMesh {
  const backing = new THREE.SkinnedMesh(geometry, a.backingMaterial!);
  backing.renderOrder = 1;
  backing.castShadow = true;
  backing.receiveShadow = false;
  backing.bind(skeleton, new THREE.Matrix4());
  return backing;
}

const NOTHING = { verts: 0, indices: 0 } as const;

/** A wear book's own count, set aside: the texels it describes are kept with the rest of the surface. */
function copyWear(from: WearBook): WearBook {
  const keep = new WearBook(new Float32Array(0), 0, () => {});
  keep.adopt(from);
  return keep;
}
const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/**
 * What fire leaves of the flesh and bone it bares, as a baked body's vertex colour (bytes, before the shader's lift):
 * the skin shader's SKIN_GONE at `sChar` 0.95, worked back through its curve. Keep in step with it.
 */
const FAR_COOKED = [40, 27, 23] as const;
const FAR_COOKED_BONE = [50, 45, 40] as const;
let farLive = new Uint8Array(4096);
let farUsed = new Uint8Array(4096);
let farSlot = new Int32Array(4096);
const farE = new Float64Array(12);
const farTables = new WeakMap<THREE.BufferGeometry, { verts: Uint32Array; index: Uint32Array }>();

/** The vertices a level of detail's triangles use, and its triangles numbered within them: worked out once a geometry. */
function farTable(geometry: THREE.BufferGeometry): { verts: Uint32Array; index: Uint32Array } {
  let t = farTables.get(geometry);
  if (t) return t;
  const src = geometry.index!.array;
  const local = new Map<number, number>();
  const index = new Uint32Array(src.length);
  for (let i = 0; i < src.length; i++) {
    const v = src[i]!;
    let k = local.get(v);
    if (k === undefined) local.set(v, (k = local.size));
    index[i] = k;
  }
  t = { verts: Uint32Array.from(local.keys()), index };
  farTables.set(geometry, t);
  return t;
}

const propV = new THREE.Vector3();
const propN = new THREE.Matrix3();
const propColor = new THREE.Color();
const propTint = new THREE.Color();
const WHITE = new THREE.Color(1, 1, 1);

/**
 * One plain mesh (a rifle, a helmet, a plate, a stand-in head) written into the far batch where it hangs. A baked model
 * brings its own vertex colours; anything else is painted its material's colour.
 */
function bakeProp(mesh: THREE.Mesh, out: FarBuffers, vertex: number, index: number, maxVerts: number, maxIndices: number, burn: number): { verts: number; indices: number } {
  const g = mesh.geometry;
  const pos = g.getAttribute('position');
  if (!pos) return NOTHING;
  const idx = g.getIndex();
  const n = pos.count;
  const count = idx ? idx.count : n;
  if (n > maxVerts || count > maxIndices) return NOTHING;
  const nor = g.getAttribute('normal');
  const col = g.getAttribute('aColor');
  // A plain three mesh with vertex colours (an armour plate): linear, where the models' own are stored as they are seen.
  const plain = col ? null : g.getAttribute('color');
  const mat = g.getAttribute('aMat');
  const material = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial | undefined;
  propColor.set(material?.color ?? 0x808080).convertLinearToSRGB();
  const world = mesh.matrixWorld;
  propN.getNormalMatrix(world);
  const dark = 1 - burn * 0.85;
  for (let i = 0; i < n; i++) {
    propV.fromBufferAttribute(pos, i).applyMatrix4(world);
    const v = (vertex + i) * 3;
    out.position[v] = propV.x; out.position[v + 1] = propV.y; out.position[v + 2] = propV.z;
    const c = (vertex + i) * 4;
    if (nor) propV.fromBufferAttribute(nor, i).applyMatrix3(propN).normalize();
    else propV.set(0, 1, 0);
    out.normal[c] = propV.x * 127; out.normal[c + 1] = propV.y * 127; out.normal[c + 2] = propV.z * 127; out.normal[c + 3] = 0;
    if (col) {
      out.color[c] = col.getX(i) * 255 * dark; out.color[c + 1] = col.getY(i) * 255 * dark; out.color[c + 2] = col.getZ(i) * 255 * dark; out.color[c + 3] = col.getW(i) * 255;
    } else if (plain) {
      propTint.setRGB(plain.getX(i), plain.getY(i), plain.getZ(i)).multiply(material?.color ?? WHITE).convertLinearToSRGB();
      out.color[c] = propTint.r * 255 * dark; out.color[c + 1] = propTint.g * 255 * dark; out.color[c + 2] = propTint.b * 255 * dark; out.color[c + 3] = 255;
    } else {
      out.color[c] = propColor.r * 255 * dark; out.color[c + 1] = propColor.g * 255 * dark; out.color[c + 2] = propColor.b * 255 * dark; out.color[c + 3] = 255;
    }
    if (mat) {
      out.mat[c] = mat.getX(i) * 255; out.mat[c + 1] = mat.getY(i) * 255; out.mat[c + 2] = mat.getZ(i) * 255; out.mat[c + 3] = mat.getW(i) * 255;
    } else {
      out.mat[c] = (material?.roughness ?? 0.7) * 255; out.mat[c + 1] = (material?.metalness ?? 0) * 255; out.mat[c + 2] = 0; out.mat[c + 3] = 0;
    }
  }
  for (let i = 0; i < count; i++) out.index[index + i] = vertex + (idx ? idx.getX(i) : i);
  return { verts: n, indices: count };
}

/** What `bakeSkin` needs of a skinned body, or of a piece cut from one. */
interface FarSkin {
  a: ArchetypeData;
  /** The skeleton's matrices, worked out for the pose it lies in. */
  bm: Float32Array;
  /** Its texture's own array, and where the texels after the bones start. */
  data: Float32Array;
  extras: number;
  /** Wounds in its book. */
  wounds: number;
  /** Drawn with the caps that close a cut. */
  caps: boolean;
  /** Is this bone folded away (a limb that has gone, a cap not in use)? */
  gone(bone: number): boolean;
}

const NOTHING_BAKED = { verts: 0, indices: 0, burn: 0 } as const;

/**
 * A skinned body or piece as it lies, at its coarsest level of detail, written into the far batch's arrays (gore/far.ts):
 * world positions and normals, and its colour with what the skin shader would have drawn from its texels painted into the
 * vertices, since what is baked has no texels: blood, the stain and the dark of each wound, char, skin gone by wear and by
 * fire. Only the vertices it still has are written. Returns how many of each, and its char for what hangs on it.
 */
function bakeSkin(s: FarSkin, out: FarBuffers, vertex: number, index: number, maxVerts: number, maxIndices: number): { verts: number; indices: number; burn: number } {
  const model = s.a.model;
  const set = s.caps ? model.lodsWithCaps : model.lods;
  const far = farTable(set[Math.min(FAR_LOD, set.length - 1)]!);
  const A = model.attributes;
  const src = A.position.array as Float32Array;
  const nrm = A.normal.array as Int8Array;
  const col = A.aColor.array as Uint8Array;
  const mat = A.aMat.array as Uint8Array;
  const si = A.skinIndex!.array as Uint8Array;
  const sw = A.skinWeight!.array as Uint8Array;
  const bm = s.bm;
  const d = s.data;
  const params = s.extras + EXTRA_PARAMS * 4;
  const wet = s.a.interior ? Math.min(1, d[params]!) : 0;
  const burn = Math.min(1, Math.max(0, d[params + 2]!));
  // Where the fire caught and how far it has burnt through the skin, and whether any limb is worn: all three are the
  // skin shader's to draw from texels, and painted here as its far level draws them (material.ts, OP2_FAR).
  const fire = s.extras + EXTRA_FIRE * 4;
  const fx = d[fire]!, fy = d[fire + 1]!, fz = d[fire + 2]!;
  const caught = d[fire + 3]! > 0.5;
  const eaten = s.a.interior ? d[fire + 5]! : 0;
  const dry = Math.min(1, Math.max(0, d[fire + 7]!));
  const worn = s.a.interior && d[s.extras + EXTRA_INFO * 4 + 3]! > 0;
  const wearAt = s.extras + EXTRA_WEAR * 4;
  const bmLayer = s.a.interior && s.a.bloodPool && A.uv ? (d[s.extras + EXTRA_BLOOD_MAP * 4]! | 0) - 1 : -1;
  const uvArr = bmLayer >= 0 ? (A.uv!.array as Uint16Array | Float32Array) : null;
  const uvScale = uvArr instanceof Uint16Array ? 1 / 65535 : 1;
  const wounds = s.a.interior ? s.wounds : 0;
  const w0 = s.extras + EXTRA_WOUNDS * 4;
  const n = far.verts.length;
  const live = farLive.length >= n ? farLive : (farLive = new Uint8Array(n));
  const e = farE;
  // Which vertices are on the body still (not folded away with a lost limb), which triangles those leave, and so which
  // vertices are drawn at all: only those are written, packed, so a limb takes a limb's room and not a body's.
  const tri = far.index;
  const used = farUsed.length >= n ? farUsed : (farUsed = new Uint8Array(n));
  const slot = farSlot.length >= n ? farSlot : (farSlot = new Int32Array(n));
  for (let k = 0; k < n; k++) {
    const i = far.verts[k]!;
    let collapsed = 0;
    for (let j = 0; j < 4; j++) {
      const w = sw[i * 4 + j]!;
      if (w !== 0 && s.gone(si[i * 4 + j]!)) collapsed += w / 255;
    }
    live[k] = collapsed < 0.5 ? 1 : 0;
    used[k] = 0;
  }
  let indices = 0;
  for (let t = 0; t < tri.length; t += 3) {
    const a = tri[t]!, b = tri[t + 1]!, c = tri[t + 2]!;
    if (!live[a] || !live[b] || !live[c]) continue;
    used[a] = used[b] = used[c] = 1;
    indices += 3;
  }
  let verts = 0;
  for (let k = 0; k < n; k++) if (used[k]) slot[k] = verts++;
  if (verts > maxVerts || indices > maxIndices) return NOTHING_BAKED;
  for (let k = 0; k < n; k++) {
    if (!used[k]) continue;
    const i = far.verts[k]!;
    e.fill(0);
    for (let j = 0; j < 4; j++) {
      const w = sw[i * 4 + j]! / 255;
      if (w === 0) continue;
      const b = si[i * 4 + j]!;
      const o = b * 16;
      e[0] += bm[o]! * w; e[1] += bm[o + 1]! * w; e[2] += bm[o + 2]! * w;
      e[3] += bm[o + 4]! * w; e[4] += bm[o + 5]! * w; e[5] += bm[o + 6]! * w;
      e[6] += bm[o + 8]! * w; e[7] += bm[o + 9]! * w; e[8] += bm[o + 10]! * w;
      e[9] += bm[o + 12]! * w; e[10] += bm[o + 13]! * w; e[11] += bm[o + 14]! * w;
    }
    const x = src[i * 3]!, y = src[i * 3 + 1]!, z = src[i * 3 + 2]!;
    const v = (vertex + slot[k]!) * 3;
    out.position[v] = e[0]! * x + e[3]! * y + e[6]! * z + e[9]!;
    out.position[v + 1] = e[1]! * x + e[4]! * y + e[7]! * z + e[10]!;
    out.position[v + 2] = e[2]! * x + e[5]! * y + e[8]! * z + e[11]!;
    const nx = nrm[i * 4]!, ny = nrm[i * 4 + 1]!, nz = nrm[i * 4 + 2]!;
    const ox = e[0]! * nx + e[3]! * ny + e[6]! * nz;
    const oy = e[1]! * nx + e[4]! * ny + e[7]! * nz;
    const oz = e[2]! * nx + e[5]! * ny + e[8]! * nz;
    const l = 127 / (Math.hypot(ox, oy, oz) || 1);
    const c = (vertex + slot[k]!) * 4;
    out.normal[c] = ox * l; out.normal[c + 1] = oy * l; out.normal[c + 2] = oz * l; out.normal[c + 3] = 0;

    // Blood, in the vertex: how near the nearest wound is (its stain runs out to twice its size and a way down the
    // body), dynamic UV surface stains, and the body's overall wet in patches.
    let stain = 0;
    let hole = 0;
    for (let q = 0; q < wounds; q++) {
      const o = w0 + q * WOUND_TEXELS * 4;
      const r = d[o + 7]!;
      const dx = x - d[o]!, dy = y - d[o + 1]!, dz = z - d[o + 2]!;
      // Below the wound counts for more: blood runs down.
      const dist = Math.hypot(dx, dy > 0 ? dy : dy * 0.55, dz);
      // The skin shader's own reach for a stain (`STAIN_RADII`, `STAIN_MARGIN`), and it runs further on a wetter body.
      const reach = (r * STAIN_RADII + STAIN_MARGIN) * (1 + wet * 0.5);
      if (dist < reach) stain = Math.max(stain, 1 - dist / reach);
      if (dist < r) hole = Math.max(hole, 1 - dist / r);
    }
    let mapBlood = 0;
    if (uvArr && s.a.bloodPool) {
      mapBlood = s.a.bloodPool.sampleUv(bmLayer, uvArr[i * 2]! * uvScale, uvArr[i * 2 + 1]! * uvScale)[0] * 0.92;
    }
    // A stain is strong at the wound and thins out; a wet body is only a little darker and redder all over.
    const blood = Math.min(0.95, Math.max(stain * stain * 1.6 + wet * 0.06, mapBlood));
    let r8 = col[i * 4]!, g8 = col[i * 4 + 1]!, b8 = col[i * 4 + 2]!;
    // Dried, it is darker and browner (the skin shader's own drying: a baked body is an old one).
    r8 += (104 - 36 * dry - r8) * blood; g8 += (7 + 3 * dry - g8) * blood; b8 += (9 - b8) * blood;
    // The wound itself is dark and deep.
    r8 += (40 - r8) * hole; g8 += (2 - g8) * hole; b8 += (4 - b8) * hole;
    // Char: all over at once, or walking out from where the fire caught, as the shader's far level has it (its noise
    // there is its middle value, 0.5).
    const from = caught ? Math.min(1, Math.hypot(x - fx, y - fy, z - fz) / FIRE_REACH) : 0.45;
    const charred = burn <= 0.001 ? 0 : smooth(-0.1, 0.08, burn * 1.45 - 0.2 - (caught ? 0.21 + from * 0.72 : 0.5));
    r8 += (16 - r8) * charred; g8 += (13 - g8) * charred; b8 += (12 - b8) * charred;
    // Skin gone (material.ts, SKIN_GONE): how far through it this vertex is, by its limb's wear and by the fire, and
    // whether what shows is raw or cooked.
    let through = -1;
    let cooked = 0;
    if (worn) {
      let amount = 0, kind = 0, own = -1, region = -1;
      for (let j = 0; j < 4; j++) {
        const b = si[i * 4 + j]!;
        const w = sw[i * 4 + j]! / 255;
        if (b >= REGION_OF.length || w <= 0) continue;
        const reg = REGION_OF[b]!;
        if (reg < 0) continue;
        const v = d[wearAt + (reg >> 2) * 4 + (reg & 3)]!;
        const kd = Math.floor(v * 0.5);
        if (kd === WearKind.burn) continue;
        const a = (v - kd * 2) * smooth(0.04, 0.3, w);
        if (a > amount) { amount = a; kind = kd; own = b; region = reg; }
      }
      if (amount > 0.01) {
        let parent = 0;
        for (let j = 0; j < 4; j++) {
          const b = si[i * 4 + j]!;
          if (b < REGION_OF.length && b < own && REGION_OF[b] !== region) parent += sw[i * 4 + j]! / 255;
        }
        through = amount * 0.9 + smooth(0.08, 0.42, parent) * smooth(0.5, 1, amount) * 0.4 - 0.42;
        cooked = kind === WearKind.strip ? 0.5 : 0;
      }
    }
    if (eaten > 0.004 && mat[i * 4 + 1]! <= 127) {
      const depth = (eaten * 0.8 - from * 0.4 - 0.35) * 1.3;
      if (depth > through) { through = depth; cooked = 0.95; }
    }
    let gone = 0;
    if (through > -0.1) {
      const bruise = smooth(-0.1, 0, through) * 0.72;
      r8 += (48 - r8) * bruise; g8 += (17 - g8) * bruise; b8 += (23 - b8) * bruise;
      gone = smooth(0, 0.028, through);
      const meat = smooth(0.12, 0.24, through) * 0.5;
      const bone = smooth(0.5, 0.57, through);
      // Raw muscle, darker deep in, then bone with blood on it; cooked, the same gone dark and dry.
      let ur = 86 + (59 - 86) * meat, ug = 24 + (21 - 24) * meat, ub = 24 + (21 - 24) * meat;
      ur += (133 - ur) * bone; ug += (123 - ug) * bone; ub += (111 - ub) * bone;
      const dark = cooked * (1 - bone * 0.45);
      ur += (FAR_COOKED[0] + (FAR_COOKED_BONE[0] - FAR_COOKED[0]) * bone - ur) * dark;
      ug += (FAR_COOKED[1] + (FAR_COOKED_BONE[1] - FAR_COOKED[1]) * bone - ug) * dark;
      ub += (FAR_COOKED[2] + (FAR_COOKED_BONE[2] - FAR_COOKED[2]) * bone - ub) * dark;
      r8 += (ur - r8) * gone; g8 += (ug - g8) * gone; b8 += (ub - b8) * gone;
    }
    out.color[c] = r8; out.color[c + 1] = g8; out.color[c + 2] = b8; out.color[c + 3] = col[i * 4 + 3]!;
    // Wet blood shines, char does not; bloodied metal is no longer bare metal; bared flesh is wet unless it is cooked.
    const rough = mat[i * 4]!;
    const dull = rough + (70 - rough) * blood * (1 - charred) + (235 - rough) * charred;
    out.mat[c] = dull + ((cooked > 0.5 ? 150 : 80) - dull) * gone;
    out.mat[c + 1] = mat[i * 4 + 1]! * (1 - Math.max(blood, charred, gone));
    out.mat[c + 2] = mat[i * 4 + 2]! * (1 - Math.max(charred, gone));
    out.mat[c + 3] = mat[i * 4 + 3]!;
  }
  let at = index;
  for (let t = 0; t < tri.length; t += 3) {
    const a = tri[t]!, b = tri[t + 1]!, c = tri[t + 2]!;
    if (!live[a] || !live[b] || !live[c]) continue;
    out.index[at] = vertex + slot[a]!;
    out.index[at + 1] = vertex + slot[b]!;
    out.index[at + 2] = vertex + slot[c]!;
    at += 3;
  }
  return { verts, indices, burn };
}

/** What a body or a piece wears and carries, each a plain mesh hung on a bone, written after its skin. */
function bakeHung(objects: Iterable<THREE.Object3D>, out: FarBuffers, vertex: number, index: number, maxVerts: number, maxIndices: number, burn: number): { verts: number; indices: number } {
  let verts = 0;
  let indices = 0;
  for (const object of objects) {
    object.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.visible || (mesh as unknown as THREE.SkinnedMesh).isSkinnedMesh) return;
      const wrote = bakeProp(mesh, out, vertex + verts, index + indices, maxVerts - verts, maxIndices - indices, burn);
      verts += wrote.verts;
      indices += wrote.indices;
    });
  }
  return { verts, indices };
}

export class Character implements CharacterInstance {
  readonly archetype: string;
  readonly rig: RigDef;
  readonly root = new THREE.Group();
  readonly bones: THREE.Bone[];
  readonly mesh: THREE.SkinnedMesh;
  readonly anim: PooledAnimation;
  readonly severed = new Set<GoreRegion>();

  readonly allBones: THREE.Bone[];
  readonly skeleton: THREE.Skeleton;
  readonly props: AttachedProp[] = [];
  /** Follows the weapon's muzzle, when the archetype carries one. Read its world position to spawn shots. */
  muzzle: THREE.Object3D | null = null;
  /** Sits in the free list when false. */
  live = false;
  lod = 0;
  /** Frame number of the last animation update, so the library never advances an instance twice. */
  animFrame = -1;

  private readonly extras: number;
  private readonly data: Float32Array;
  private readonly hidden: Uint8Array;
  private readonly activeCaps = new Set<THREE.Bone>();
  private flash = 0;
  private flashAt = 0;
  private readonly book: WoundBook;
  /** How far through its skin each region is (anatomy/wear.ts). Only a humanoid with flesh under its skin wears. */
  private readonly worn: WearBook;
  private readonly breaks: FracturePose;
  /** Null until a wound opens this body. */
  inside: THREE.SkinnedMesh | null = null;
  private backing: THREE.SkinnedMesh | null = null;
  private readonly cullSphere: PropertyDescriptor;
  /** Hits taken per bone that did not break it on their own, so sustained fire gets there too. */
  readonly stress: Float32Array;

  constructor(readonly a: ArchetypeData) {
    this.archetype = a.id;
    this.rig = a.rig;
    this.allBones = makeBones(a);
    const skel = a.model.meta.skeleton;
    const rigCount = a.model.meta.rigBoneCount;
    this.bones = this.allBones.slice(0, rigCount);
    for (let i = 0; i < rigCount; i++) {
      const p = skel[i]!.parent;
      (p >= 0 ? this.allBones[p]! : this.root).add(this.allBones[i]!);
    }
    // Cap bones stay out of the scene graph until shown, so a healthy character pays nothing for them.
    for (let i = rigCount; i < skel.length; i++) {
      const b = this.allBones[i]!;
      b.scale.setScalar(COLLAPSED);
      b.updateMatrixWorld(true);
    }
    const { skeleton, extras } = makeSkeleton(this.allBones, a.bindInverses);
    this.skeleton = skeleton;
    this.extras = extras;
    this.data = skeleton.boneMatrices as Float32Array;
    this.mesh = new THREE.SkinnedMesh(a.model.lods[0]!, a.material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = true;
    this.root.add(this.mesh);
    this.root.updateMatrixWorld(true);
    this.mesh.bind(skeleton, new THREE.Matrix4());
    // Ragdolls carry the bones far from the root, so the culling sphere is read off the hips on demand.
    const sphere = new THREE.Sphere(new THREE.Vector3(), a.rig.height * 1.15);
    const hips = this.bones[0]!;
    const mesh = this.mesh;
    this.cullSphere = {
      configurable: true,
      get: () => {
        const h = hips.matrixWorld.elements, w = mesh.matrixWorld.elements;
        const dx = h[12]! - w[12]!, dy = h[13]! - w[13]!, dz = h[14]! - w[14]!;
        // Into mesh space. The root never scales, so the transpose is the inverse.
        sphere.center.set(dx * w[0]! + dy * w[1]! + dz * w[2]!, dx * w[4]! + dy * w[5]! + dz * w[6]!, dx * w[8]! + dy * w[9]! + dz * w[10]!);
        return sphere;
      },
    };
    Object.defineProperty(mesh, 'boundingSphere', this.cullSphere);
    this.hidden = new Uint8Array(this.allBones.length);
    this.stress = new Float32Array(rigCount);
    this.data[this.extras + EXTRA_INFO * 4 + 1] = Math.random() * 64;
    this.book = new WoundBook(this.data, this.extras + EXTRA_WOUNDS * 4, count => {
      this.data[this.extras + EXTRA_INFO * 4] = count;
    });
    this.worn = new WearBook(this.data, this.extras + EXTRA_WEAR * 4, most => {
      this.data[this.extras + EXTRA_INFO * 4 + 3] = most;
    });
    this.anim = createAnimator(a.def, this);
    this.breaks = new FracturePose(a.rig, this.bones);
    // Wrapped here so a break holds through every animator, whatever it writes and however often it runs.
    const pose = this.anim.update.bind(this.anim);
    this.anim.update = (dt, lod) => {
      pose(dt, lod);
      this.breaks.apply(dt);
    };
    // The fade runs where the draw happens, so it needs no per-frame update from whoever owns the body now.
    this.mesh.onBeforeRender = () => {
      if (this.flash <= 0) return;
      const left = this.flash - (this.a.time.elapsed - this.flashAt) * FLASH_DECAY;
      this.data[this.extras + EXTRA_PARAMS * 4 + 1] = left > 0 ? left : 0;
      if (left <= 0) this.flash = 0;
    };
  }

  private markChain(bone: number, value: number): void {
    this.hidden[bone] = value;
    for (const c of this.a.children[bone]!) this.markChain(c, value);
  }

  private showCap(index: number, parent: THREE.Bone): void {
    const cap = this.allBones[index]!;
    if (cap.parent === parent) return;
    cap.scale.setScalar(1);
    parent.add(cap);
    this.activeCaps.add(cap);
    this.setLod(this.lod, true);
  }

  hideLimb(boneIndex: number): void {
    if (this.hidden[boneIndex]) return;
    const def = this.rig.bones[boneIndex]!;
    this.bones[boneIndex]!.scale.setScalar(COLLAPSED);
    this.markChain(boneIndex, 1);
    for (let i = 0; i < this.bones.length; i++) {
      if (this.hidden[i]) this.severed.add(this.rig.bones[i]!.region);
    }
    const cap = this.a.model.capByBone.get(boneIndex);
    if (cap && def.parent >= 0) this.showCap(cap.parentCap, this.bones[def.parent]!);
    for (const p of this.props) {
      // A prop already off the bone (a helmet shot off and flying) is not on the limb any more.
      if (this.hidden[p.bone] && p.object.parent === this.bones[p.bone]) p.object.visible = false;
    }
  }

  isHidden(boneIndex: number): boolean {
    return this.hidden[boneIndex] === 1;
  }

  addWound(boneIndex: number, worldPoint: THREE.Vector3, radius: number): void {
    const bone = this.bones[boneIndex];
    if (!bone) return;
    bone.getWorldPosition(paintDir).sub(worldPoint);
    if (paintDir.lengthSq() < 1e-6) paintDir.set(0, 0, -1);
    paint.bone = boneIndex;
    paint.point = worldPoint;
    paint.dir = paintDir.normalize();
    paint.radius = radius;
    this.wound(paint);
  }

  wound(hit: WoundHit): void {
    const bone = this.bones[hit.bone];
    if (!bone || this.hidden[hit.bone]) return;
    placeWound(this.a, this.book, bone, hit.bone, hit);
    this.showWounds();
  }

  get lastWoundPromoted(): boolean {
    return this.book.lastPromoted;
  }

  /**
   * A region of this body stands at `spent` of its health pool, 0 to 1, after a hit of `kind`: its skin is torn that far
   * through, to muscle and then to bone (anatomy/wear.ts; drawn by the skin shader). Only what is seen: nothing reads it back.
   */
  setWear(region: GoreRegion, spent: number, kind: WearKindId): void {
    if (this.a.def.rig !== 'humanoid' || !this.a.interior) return;
    this.worn.set(region, spent, kind);
    this.showWounds();
  }

  /** The same for a region with no pool of its own (the trunk): `share` more of it is worn. */
  addWear(region: GoreRegion, share: number, kind: WearKindId, most = 1): void {
    if (this.a.def.rig !== 'humanoid' || !this.a.interior) return;
    this.worn.set(region, Math.min(this.worn.amount(region) + share, Math.max(most, this.worn.amount(region))), kind);
    this.showWounds();
  }

  /** How worn a region is drawn, 0 to 1. */
  wearOf(region: GoreRegion): number {
    return this.worn.amount(region);
  }

  /** Whether anything on this body needs the wounded program: a wound, worn skin, or skin burnt through. */
  private get marked(): boolean {
    return this.book.count > 0 || this.worn.most > 0 || this.burnThrough > 0;
  }

  /** Puts the body on the wounded program, with its inside if it has been opened. */
  private showWounds(): void {
    if (!this.marked) return;
    if (this.mesh.material === this.a.material) this.mesh.material = this.a.woundMaterial;
    if (this.book.open === 0 || !this.a.interior) return;
    if (!this.inside) {
      this.inside = makeInside(this.a, this.skeleton);
      this.backing = makeBacking(this.a, this.mesh.geometry, this.skeleton);
      this.backing.castShadow = this.mesh.castShadow;
      Object.defineProperty(this.inside, 'boundingSphere', this.cullSphere);
      Object.defineProperty(this.backing, 'boundingSphere', this.cullSphere);
      this.root.add(this.inside, this.backing);
    }
    this.showInside(this.lod);
  }

  /** Past `INSIDE_LOD` a hole is a few pixels of dark, which the backing alone gives it. */
  private showInside(lod: number): void {
    const open = lod < FAR_LOD;
    const casts = this.mesh.castShadow || this.backing!.castShadow;
    this.inside!.visible = lod < INSIDE_LOD;
    this.backing!.visible = open;
    this.backing!.geometry = this.mesh.geometry;
    this.mesh.castShadow = casts && !open;
    this.backing!.castShadow = casts && open;
  }

  /**
   * Snaps a limb at `bone`, the joint at its top. Holds in animation, and a ragdoll made from this body gets that joint
   * with its limits open. Returns false if it was already broken.
   */
  fracture(bone: number, style: FractureStyle, skew = 0): boolean {
    if (this.hidden[bone] || this.isFractured(bone)) return false;
    this.data[this.extras + EXTRA_INFO * 4 + 2] += 2 ** bone;
    this.breaks.add(bone, style, skew);
    return true;
  }

  isFractured(bone: number): boolean {
    return (this.data[this.extras + EXTRA_INFO * 4 + 2]! / 2 ** bone) % 2 >= 1;
  }

  /** The material to give a world-space copy of this body. The wounded one only works on a skeleton. */
  get skinMaterial(): THREE.Material {
    return this.a.material;
  }

  setBloodiness(amount: number): void {
    // Machines do not bleed, whoever asks.
    this.data[this.extras + EXTRA_PARAMS * 4] = this.a.interior ? amount : 0;
  }

  /** Sets the pooled dynamic UV blood layer (`layer` is 1-based; 0 = clean/skip). Machines stay clean. */
  setBloodMapLayer(layer: number, active = 0, soak = 0): void {
    const o = this.extras + EXTRA_BLOOD_MAP * 4;
    if (!this.a.interior || layer <= 0) {
      this.data[o] = 0;
      this.data[o + 1] = 0;
      this.data[o + 2] = 0;
      this.data[o + 3] = 0;
      return;
    }
    this.data[o] = layer;
    this.data[o + 1] = active;
    this.data[o + 2] = soak;
  }

  /** 1-based dynamic blood map layer index, or 0 if clean. */
  get bloodMapLayer(): number {
    return this.data[this.extras + EXTRA_BLOOD_MAP * 4]! | 0;
  }

  hitFlash(_intensity: number): void {
    // Whole-body red impact flash disabled: it hid the blood mist puff and looked cartoony.
  }

  /** 0..1 char from fire. Embers crawl across as it rises. Past `KIT_CHARS_AT` what it carries is burnt too. */
  setBurn(amount: number): void {
    this.data[this.extras + EXTRA_PARAMS * 4 + 2] = amount;
    const kit = amount >= KIT_CHARS_AT;
    if (kit === this.kitCharred) return;
    this.kitCharred = kit;
    // A prop that has left its bone (a helmet shot off) is not his any more.
    for (const p of this.props) if (p.object.parent === this.bones[p.bone]) charKit(p.object, kit);
  }

  private kitCharred = false;

  /**
   * Where the fire caught: a world point on `bone`. From then on the char walks out across the body from there instead of
   * coming up everywhere at once, and the skin burns through there first. The first point a fire is given is kept.
   */
  setBurnOrigin(boneIndex: number, worldPoint: THREE.Vector3): void {
    const o = this.extras + EXTRA_FIRE * 4;
    const bone = this.bones[boneIndex];
    if (!bone || this.data[o + 3]! > 0) return;
    // World to bone local, then bone local to bind space, as a wound is placed.
    bone.updateWorldMatrix(true, false);
    v.copy(worldPoint).applyMatrix4(m.copy(bone.matrixWorld).invert()).add(this.a.bindPositions[boneIndex]!);
    this.data[o] = v.x;
    this.data[o + 1] = v.y;
    this.data[o + 2] = v.z;
    this.data[o + 3] = 1;
  }

  /**
   * How far the fire has burnt through the skin, 0 to 1: charred muscle and then bone show where it has burnt longest,
   * nearest where it caught (the skin shader's FIRE_DRIVER, drawn by the one skin-gone path it shares with wear). Flesh
   * only: a machine's skin does not burn through.
   */
  setBurnThrough(amount: number): void {
    if (!this.a.interior) return;
    this.data[this.extras + EXTRA_FIRE * 4 + 5] = amount;
    if (amount > 0) this.showWounds();
  }

  get burnThrough(): number {
    return this.data[this.extras + EXTRA_FIRE * 4 + 5]!;
  }

  /** The char on it now, as `setBurn` left it. */
  get burn(): number {
    return this.data[this.extras + EXTRA_PARAMS * 4 + 2]!;
  }

  /** How hot its char still is: 1 alight, fading to 0 cold. It is the glow in the cracks (gore/fire.ts keeps it). */
  setEmber(heat: number): void {
    this.data[this.extras + EXTRA_FIRE * 4 + 4] = heat;
  }

  /**
   * How dry the blood and the bared flesh on it are drawn, 0 wet to 1 dry (the skin shader, "drying"): gore dries the dead
   * where they lie, in a few steps, as the blood on the floor round them dries. Kept in the spare channel of fire's second
   * texel, so it goes with a baked body's snapshot and a limb cut from the body.
   */
  setDry(amount: number): void {
    this.data[this.extras + EXTRA_FIRE * 4 + 7] = amount;
  }

  /**
   * An organ has been thrown out of this body (a blow-out): it is no longer drawn inside it. `left` chooses the lung.
   * Kept in the body's texels, so it goes with a baked body's snapshot and with a top half cut from it, and ends at reset.
   */
  takeOrgan(organ: 'lung' | 'heart' | 'liver' | 'stomach', left = false): void {
    const id = organ === 'lung' ? (left ? Organ.lungL : Organ.lungR) : Organ[organ];
    const at = this.extras + EXTRA_FIRE * 4 + 6;
    this.data[at] = (this.data[at]! | 0) | (1 << id);
  }

  /** The organs thrown out of it so far, a bit each (`Organ`). */
  get organsGone(): number {
    return this.data[this.extras + EXTRA_FIRE * 4 + 6]! | 0;
  }

  /** 0..1 ice coverage, for Frost Nova. */
  setFrost(amount: number): void {
    this.data[this.extras + EXTRA_PARAMS * 4 + 3] = amount;
  }

  /**
   * Folds the skin on one bone away and mounts `prop` there in its place: a stand-in for that part of him, a partial head.
   * The bone stays, so it is still hit, still on the ragdoll, and still comes off or bursts, stand-in and all. Undone at
   * reset. False if that bone is hidden or already stood in for.
   */
  standIn(boneIndex: number, prop: THREE.Object3D): boolean {
    const own = this.skeleton.boneInverses;
    if (this.hidden[boneIndex] || own[boneIndex] !== this.a.bindInverses[boneIndex]) return false;
    // The bind inverses are the archetype's, shared by every body: this one gets its own before one is changed.
    const inverses = own === this.a.bindInverses ? own.slice() : own;
    inverses[boneIndex] = new THREE.Matrix4().makeScale(COLLAPSED, COLLAPSED, COLLAPSED).multiply(this.a.bindInverses[boneIndex]!);
    this.skeleton.boneInverses = inverses;
    // Whatever else is still on it (a helmet no plate threw off) goes with the skin.
    for (const p of this.props) if (p.bone === boneIndex && p.object.parent === this.bones[boneIndex]) p.object.visible = false;
    this.attachProp(boneIndex, prop, true);
    return true;
  }

  attachProp(boneIndex: number, prop: THREE.Object3D, untilReset = false): void {
    this.bones[boneIndex]!.add(prop);
    this.props.push({ bone: boneIndex, object: prop, untilReset });
    prop.visible = !this.hidden[boneIndex];
  }

  setLod(level: number, force = false): void {
    if (level === this.lod && !force) return;
    this.lod = level;
    const set = this.activeCaps.size ? this.a.model.lodsWithCaps : this.a.model.lods;
    const i = Math.min(level, set.length - 1);
    this.mesh.geometry = set[i]!;
    // The last LOD indexes welded vertices, so its UVs are meaningless and it paints from vertex colour.
    this.mesh.material = i >= FAR_LOD ? this.a.farMaterial : this.marked ? this.a.woundMaterial : this.a.material;
    if (this.inside) this.showInside(this.book.open > 0 ? i : FAR_LOD);
  }

  spawnSevered(boneIndex: number): SeveredLimb {
    const part = this.a.acquireLimb();
    part.pose(this, boneIndex);
    if (this.root.parent) this.root.parent.add(part.root);
    return part;
  }

  /** Copies this instance's surface state onto a severed part, so wounds and burn follow the limb. */
  copySurfaceTo(dst: Float32Array, dstOffset: number, book: WoundBook, worn: WearBook): void {
    dst.set(this.data.subarray(this.extras, this.extras + EXTRA_TEXELS * 4), dstOffset);
    // Pooled blood-map layers belong to the body and may be recycled after it resets.
    dst[dstOffset + EXTRA_BLOOD_MAP * 4] = 0;
    book.adopt(this.book);
    worn.adopt(this.worn);
  }

  /** The material a baked copy of any body is drawn with (gore/far.ts): it shades from the vertices alone, so one does for all. */
  get farMaterial(): THREE.Material {
    return this.a.farMaterial;
  }

  /**
   * What this body would need to be stood up again exactly as it lies, on another instance: where it is, its pose, what is
   * cut off it, its wounds and blood, and what it wears. For a body about to be baked into the far batch (gore/far.ts).
   */
  snapshot(): CorpseSnapshot {
    const n = this.bones.length;
    const pose = new Float32Array(n * 7);
    const cut: number[] = [];
    for (let i = 0; i < n; i++) {
      const b = this.bones[i]!;
      pose[i * 7] = b.position.x; pose[i * 7 + 1] = b.position.y; pose[i * 7 + 2] = b.position.z;
      pose[i * 7 + 3] = b.quaternion.x; pose[i * 7 + 4] = b.quaternion.y; pose[i * 7 + 5] = b.quaternion.z; pose[i * 7 + 6] = b.quaternion.w;
      const parent = this.rig.bones[i]!.parent;
      if (this.hidden[i] && (parent < 0 || !this.hidden[parent])) cut.push(i);
    }
    const gear: CorpseSnapshot['gear'] = [];
    const standIns: CorpseSnapshot['standIns'] = [];
    for (const p of this.props) {
      // What has left the bone (a helmet shot off) or gone with a limb is not on the body any more.
      if (p.object.parent !== this.bones[p.bone] || !p.object.visible || this.hidden[p.bone]) continue;
      // A stand-in is this body's alone and leaves the instance at its reset, so it is carried as it is. Gear is the
      // instance's for good: a copy is carried, as a severed limb carries one.
      if (p.untilReset) standIns.push({ bone: p.bone, object: p.object, folds: this.skeleton.boneInverses[p.bone] !== this.a.bindInverses[p.bone] });
      else gear.push({ bone: p.bone, object: p.object.clone() });
    }
    const q = this.root.quaternion;
    const at = this.root.position;
    return {
      archetype: this.archetype,
      root: Float32Array.of(at.x, at.y, at.z, q.x, q.y, q.z, q.w),
      pose, cut,
      surface: this.data.slice(this.extras, this.extras + EXTRA_TEXELS * 4),
      wounds: this.book.save(),
      worn: copyWear(this.worn),
      stress: this.stress.slice(),
      gear, standIns,
    };
  }

  /** Lays a fresh instance out as `snap` had it. The instance must be as the library gives it: reset. */
  restore(snap: CorpseSnapshot): void {
    this.root.position.set(snap.root[0]!, snap.root[1]!, snap.root[2]!);
    this.root.quaternion.set(snap.root[3]!, snap.root[4]!, snap.root[5]!, snap.root[6]!);
    for (let i = 0; i < this.bones.length; i++) {
      const b = this.bones[i]!;
      b.position.set(snap.pose[i * 7]!, snap.pose[i * 7 + 1]!, snap.pose[i * 7 + 2]!);
      b.quaternion.set(snap.pose[i * 7 + 3]!, snap.pose[i * 7 + 4]!, snap.pose[i * 7 + 5]!, snap.pose[i * 7 + 6]!);
    }
    for (const bone of snap.cut) this.hideLimb(bone);
    this.data.set(snap.surface, this.extras);
    // Nothing fades a flash on a body nobody is hitting, and the old pooled blood layer may now belong to someone else.
    this.data[this.extras + EXTRA_PARAMS * 4 + 1] = 0;
    this.data[this.extras + EXTRA_BLOOD_MAP * 4] = 0;
    this.flash = 0;
    this.book.load(snap.wounds);
    this.worn.adopt(snap.worn as WearBook);
    this.stress.set(snap.stress);
    this.kitCharred = this.burn >= KIT_CHARS_AT;
    // Its own gear is whatever the last enemy to wear this instance left on it. The body's own is carried in the snapshot.
    for (const p of this.props) p.object.visible = false;
    for (const g of snap.gear) this.attachProp(g.bone, g.object, true);
    for (const g of snap.standIns) {
      if (!g.folds || !this.standIn(g.bone, g.object)) this.attachProp(g.bone, g.object, true);
    }
    if (this.kitCharred) {
      for (const p of this.props) if (p.object.parent === this.bones[p.bone] && p.object.visible) charKit(p.object, true);
    }
    this.showWounds();
    this.root.updateMatrixWorld(true);
  }

  /**
   * The body as it lies, at its coarsest level of detail, written into the far batch's own arrays (gore/far.ts): world
   * positions and normals, and its colour with what the skin shader would have drawn from this instance's texels painted
   * into the vertices, since a baked body has no texels: blood, the stain and the dark of each wound, char. Its gear and
   * stand-ins go in as they hang. Returns nothing written if it does not fit.
   */
  bakeFar(out: FarBuffers, vertex: number, index: number, maxVerts: number, maxIndices: number): { verts: number; indices: number } {
    this.root.updateMatrixWorld(true);
    this.skeleton.update();
    const rig = this.bones.length;
    const skin = bakeSkin({
      a: this.a, bm: this.skeleton.boneMatrices as Float32Array, data: this.data, extras: this.extras, wounds: this.book.count,
      caps: this.activeCaps.size > 0,
      gone: b => !!this.hidden[b] || (b >= rig && !this.activeCaps.has(this.allBones[b]!)),
    }, out, vertex, index, maxVerts, maxIndices);
    if (skin.indices === 0) return NOTHING;
    // What has left the bone (a helmet shot off) or gone with a limb is not on the body any more.
    const worn = this.props.filter(p => p.object.parent === this.bones[p.bone] && p.object.visible && !this.hidden[p.bone]).map(p => p.object);
    const hung = bakeHung(worn, out, vertex + skin.verts, index + skin.indices, maxVerts - skin.verts, maxIndices - skin.indices, skin.burn);
    return { verts: skin.verts + hung.verts, indices: skin.indices + hung.indices };
  }

  bakePose(bind = false): THREE.BufferGeometry {
    this.root.updateMatrixWorld(true);
    this.skeleton.update();
    const model = this.a.model;
    const A = model.attributes;
    const n = A.position.count;
    const pos = new Float32Array(n * 3);
    const nor = new Float32Array(n * 3);
    const quat = new Float32Array(n * 4);
    const src = A.position.array as Float32Array;
    const nrm = A.normal.array as Int8Array;
    const si = A.skinIndex!.array as Uint8Array;
    const sw = A.skinWeight!.array as Uint8Array;
    // In bind, every bone matrix is the identity: the copy is in the model's own space, as it was baked.
    const bm = bind ? identities(this.skeleton.bones.length) : this.skeleton.boneMatrices as Float32Array;
    const e = new Float64Array(12);
    const live = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      e.fill(0);
      let collapsed = 0;
      for (let k = 0; k < 4; k++) {
        const w = sw[i * 4 + k]! / 255;
        if (w === 0) continue;
        const b = si[i * 4 + k]!;
        const o = b * 16;
        if (this.hidden[b] || (b >= this.bones.length && !this.activeCaps.has(this.allBones[b]!))) collapsed += w;
        e[0] += bm[o]! * w; e[1] += bm[o + 1]! * w; e[2] += bm[o + 2]! * w;
        e[3] += bm[o + 4]! * w; e[4] += bm[o + 5]! * w; e[5] += bm[o + 6]! * w;
        e[6] += bm[o + 8]! * w; e[7] += bm[o + 9]! * w; e[8] += bm[o + 10]! * w;
        e[9] += bm[o + 12]! * w; e[10] += bm[o + 13]! * w; e[11] += bm[o + 14]! * w;
      }
      live[i] = collapsed < 0.5 ? 1 : 0;
      const x = src[i * 3]!, y = src[i * 3 + 1]!, z = src[i * 3 + 2]!;
      pos[i * 3] = e[0]! * x + e[3]! * y + e[6]! * z + e[9]!;
      pos[i * 3 + 1] = e[1]! * x + e[4]! * y + e[7]! * z + e[10]!;
      pos[i * 3 + 2] = e[2]! * x + e[5]! * y + e[8]! * z + e[11]!;
      const nx = nrm[i * 4]! / 127, ny = nrm[i * 4 + 1]! / 127, nz = nrm[i * 4 + 2]! / 127;
      const ox = e[0]! * nx + e[3]! * ny + e[6]! * nz;
      const oy = e[1]! * nx + e[4]! * ny + e[7]! * nz;
      const oz = e[2]! * nx + e[5]! * ny + e[8]! * nz;
      const l = 1 / (Math.hypot(ox, oy, oz) || 1);
      nor[i * 3] = ox * l; nor[i * 3 + 1] = oy * l; nor[i * 3 + 2] = oz * l;
      // Blended matrices are not pure rotations, but normalizing the rotation part is close enough for
      // the object-space normal map, which only needs to land in the right hemisphere of each limb.
      m.set(e[0]!, e[3]!, e[6]!, 0, e[1]!, e[4]!, e[7]!, 0, e[2]!, e[5]!, e[8]!, 0, 0, 0, 0, 1);
      m.decompose(v, q, s);
      quat[i * 4] = q.x; quat[i * 4 + 1] = q.y; quat[i * 4 + 2] = q.z; quat[i * 4 + 3] = q.w;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('aColor', new THREE.BufferAttribute((A.aColor.array as Uint8Array).slice(), 4, true));
    out.setAttribute('aMat', new THREE.BufferAttribute((A.aMat.array as Uint8Array).slice(), 4, true));
    out.setAttribute('aSkinQuat', new THREE.BufferAttribute(quat, 4));
    if (A.uv) out.setAttribute('uv', new THREE.BufferAttribute((A.uv.array as Uint16Array).slice(), 2, true));
    const keep: number[] = [];
    const take = (idx: ArrayLike<number>) => {
      for (let i = 0; i < idx.length; i += 3) {
        const a = idx[i]!, b = idx[i + 1]!, c = idx[i + 2]!;
        if (live[a] && live[b] && live[c]) keep.push(a, b, c);
      }
    };
    take(model.indices);
    if (this.activeCaps.size && model.capIndices) take(model.capIndices);
    out.setIndex(keep);
    return out;
  }

  /** Called by the library. Restores the pristine pose and surface. */
  reset(): void {
    for (const cap of this.activeCaps) {
      cap.removeFromParent();
      cap.scale.setScalar(COLLAPSED);
      cap.updateMatrixWorld(true);
    }
    this.activeCaps.clear();
    for (let i = 0; i < this.bones.length; i++) {
      const b = this.bones[i]!;
      b.scale.setScalar(1);
      b.quaternion.identity();
      const p = this.rig.bones[i]!.parent;
      if (p >= 0) b.position.copy(this.a.bindPositions[i]!).sub(this.a.bindPositions[p]!);
      else b.position.copy(this.a.bindPositions[i]!);
    }
    this.hidden.fill(0);
    this.skeleton.boneInverses = this.a.bindInverses;
    this.severed.clear();
    this.flash = 0;
    this.book.clear();
    this.worn.clear();
    this.breaks.reset();
    this.stress.fill(0);
    this.mesh.castShadow = true;
    if (this.inside) this.showInside(FAR_LOD);
    this.a.bloodPool?.release(this);
    this.data.fill(0, this.extras, this.extras + EXTRA_TEXELS * 4);
    this.data[this.extras + EXTRA_INFO * 4 + 1] = Math.random() * 64;
    this.kitCharred = false;
    for (let i = this.props.length - 1; i >= 0; i--) {
      const p = this.props[i]!;
      if (p.untilReset) {
        p.object.removeFromParent();
        this.props.splice(i, 1);
        continue;
      }
      charKit(p.object, false);
      p.object.visible = true;
    }
    this.mesh.geometry = this.a.model.lods[0]!;
    this.mesh.material = this.a.material;
    this.lod = 0;
    this.anim.reset();
    this.root.position.set(0, 0, 0);
    this.root.rotation.set(0, 0, 0);
    this.root.visible = true;
  }

  release(): void {
    this.releaseHook?.(this);
  }

  /** Set by the library. */
  releaseHook: ((c: Character) => void) | null = null;
}

/** A limb in flight. Pooled per archetype, with its own skeleton sharing the character's vertex data. */
export class SeveredPart implements SeveredLimb {
  readonly root = new THREE.Group();
  readonly mesh: THREE.SkinnedMesh;
  readonly bones: THREE.Bone[];
  readonly allBones: THREE.Bone[];
  readonly skeleton: THREE.Skeleton;
  live = false;
  releaseHook: ((p: SeveredPart) => void) | null = null;

  private readonly extras: number;
  private readonly data: Float32Array;
  private readonly book: WoundBook;
  private readonly worn: WearBook;
  private inside: THREE.SkinnedMesh | null = null;
  private backing: THREE.SkinnedMesh | null = null;
  private clones: THREE.Object3D[] = [];
  private kitCharred = false;

  constructor(private readonly a: ArchetypeData) {
    this.allBones = makeBones(a);
    this.bones = this.allBones.slice(0, a.model.meta.rigBoneCount);
    const { skeleton, extras } = makeSkeleton(this.allBones, a.bindInverses);
    this.skeleton = skeleton;
    this.extras = extras;
    this.data = skeleton.boneMatrices as Float32Array;
    this.mesh = new THREE.SkinnedMesh(a.model.lods[0]!, a.material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.root.add(this.mesh);
    this.mesh.bind(skeleton, new THREE.Matrix4());
    this.book = new WoundBook(this.data, this.extras + EXTRA_WOUNDS * 4, count => {
      this.data[this.extras + EXTRA_INFO * 4] = count;
    });
    this.worn = new WearBook(this.data, this.extras + EXTRA_WEAR * 4, most => {
      this.data[this.extras + EXTRA_INFO * 4 + 3] = most;
    });
  }

  wound(hit: WoundHit): void {
    const bone = this.bones[hit.bone];
    if (!bone) return;
    placeWound(this.a, this.book, bone, hit.bone, hit);
    this.showWounds();
  }

  isFractured(bone: number): boolean {
    return (this.data[this.extras + EXTRA_INFO * 4 + 2]! / 2 ** bone) % 2 >= 1;
  }

  private showWounds(): void {
    if (this.book.count === 0 && this.worn.most <= 0 && this.burnThrough <= 0) return;
    this.mesh.material = this.a.woundMaterial;
    if (this.book.open === 0 || !this.a.interior) return;
    if (!this.inside) {
      this.inside = makeInside(this.a, this.skeleton);
      this.backing = makeBacking(this.a, this.mesh.geometry, this.skeleton);
      this.backing.castShadow = this.mesh.castShadow;
      this.inside.frustumCulled = false;
      this.backing.frustumCulled = false;
      this.root.add(this.inside, this.backing);
    }
    this.showInside(true);
  }

  private showInside(on: boolean): void {
    const casts = this.mesh.castShadow || this.backing!.castShadow;
    this.inside!.visible = on;
    this.backing!.visible = on;
    this.backing!.geometry = this.mesh.geometry;
    this.mesh.castShadow = casts && !on;
    this.backing!.castShadow = casts && on;
  }

  /** As the body's: the limb goes on burning after it has left it. */
  setBurn(amount: number): void {
    this.data[this.extras + EXTRA_PARAMS * 4 + 2] = amount;
    const kit = amount >= KIT_CHARS_AT;
    if (kit === this.kitCharred) return;
    this.kitCharred = kit;
    for (const c of this.clones) charKit(c, kit);
  }

  get burn(): number {
    return this.data[this.extras + EXTRA_PARAMS * 4 + 2]!;
  }

  setEmber(heat: number): void {
    this.data[this.extras + EXTRA_FIRE * 4 + 4] = heat;
  }

  setBurnThrough(amount: number): void {
    if (!this.a.interior) return;
    this.data[this.extras + EXTRA_FIRE * 4 + 5] = amount;
    if (amount > 0) this.showWounds();
  }

  get burnThrough(): number {
    return this.data[this.extras + EXTRA_FIRE * 4 + 5]!;
  }

  /** As the body's: the blood on a limb dries where it lies. */
  setDry(amount: number): void {
    this.data[this.extras + EXTRA_FIRE * 4 + 7] = amount;
  }

  /** The material a baked copy of this piece is drawn with (gore/far.ts), as a body's. */
  get farMaterial(): THREE.Material {
    return this.a.farMaterial;
  }

  /**
   * The piece as it lies, at its coarsest level of detail, written into a far batch's arrays, with what hangs on it: how a
   * loose limb at rest is drawn once it is one of many (gore/far.ts, `Gore.bakeLimb`). A bone folded into the cut has no
   * size, and its vertices are left out by that. Nothing written if it does not fit.
   */
  bakeFar(out: FarBuffers, vertex: number, index: number, maxVerts: number, maxIndices: number): { verts: number; indices: number } {
    this.root.updateMatrixWorld(true);
    this.skeleton.update();
    const bm = this.skeleton.boneMatrices as Float32Array;
    const skin = bakeSkin({
      a: this.a, bm, data: this.data, extras: this.extras, wounds: this.book.count, caps: true,
      gone: b => Math.abs(bm[b * 16]!) + Math.abs(bm[b * 16 + 1]!) + Math.abs(bm[b * 16 + 2]!) < 1e-3,
    }, out, vertex, index, maxVerts, maxIndices);
    if (skin.indices === 0) return NOTHING;
    // All of what hangs on it, or it is not baked: a limb's slot is small, and a hand that lost its gun as it was baked
    // would be seen to.
    let needVerts = 0;
    let needIndices = 0;
    for (const clone of this.clones) {
      clone.traverse(o => {
        const g = (o as THREE.Mesh).isMesh && o.visible ? (o as THREE.Mesh).geometry : null;
        const pos = g?.getAttribute('position');
        if (!g || !pos) return;
        needVerts += pos.count;
        needIndices += g.getIndex()?.count ?? pos.count;
      });
    }
    if (needVerts > maxVerts - skin.verts || needIndices > maxIndices - skin.indices) return NOTHING;
    const hung = bakeHung(this.clones, out, vertex + skin.verts, index + skin.indices, maxVerts - skin.verts, maxIndices - skin.indices, skin.burn);
    return { verts: skin.verts + hung.verts, indices: skin.indices + hung.indices };
  }

  /** Takes the pose of `src`'s chain from `boneIndex` down. */
  pose(src: Character, boneIndex: number): void {
    const a = this.a;
    const skel = a.model.meta.skeleton;
    const rigCount = this.bones.length;
    const chain = new Uint8Array(skel.length);
    const mark = (b: number) => {
      chain[b] = 1;
      for (const c of a.children[b]!) mark(c);
    };
    mark(boneIndex);

    // The chain root's parent may already be collapsed, and the bone itself may be too.
    src.root.updateMatrixWorld(true);
    const rootBone = this.bones[boneIndex]!;
    const parentIdx = this.a.rig.bones[boneIndex]!.parent;
    const srcBone = src.bones[boneIndex]!;
    if (parentIdx >= 0) {
      m.compose(srcBone.position, srcBone.quaternion, s.set(1, 1, 1)).premultiply(src.bones[parentIdx]!.matrixWorld);
    } else {
      m.copy(srcBone.matrixWorld);
    }
    this.root.add(rootBone);
    // A bone the body has a stand-in on (`Character.standIn`) keeps its skin folded away here too.
    this.skeleton.boneInverses = src.skeleton.boneInverses;
    m.decompose(rootBone.position, rootBone.quaternion, s);
    rootBone.scale.setScalar(1);

    for (let i = 0; i < skel.length; i++) {
      if (i === boneIndex) continue;
      const b = this.allBones[i]!;
      const p = skel[i]!.parent;
      if (i < rigCount && chain[i]) {
        this.allBones[p]!.add(b);
        const sb = src.bones[i]!;
        b.position.copy(sb.position);
        b.quaternion.copy(sb.quaternion);
        b.scale.setScalar(src.isHidden(i) && !src.isHidden(p) ? COLLAPSED : 1);
      } else {
        // Everything else folds into the joint, which closes the skin around the child cap.
        rootBone.add(b);
        b.position.set(0, 0, 0);
        b.quaternion.identity();
        b.scale.setScalar(COLLAPSED);
      }
    }

    const cap = a.model.capByBone.get(boneIndex);
    if (cap) {
      const c = this.allBones[cap.childCap]!;
      rootBone.add(c);
      c.position.set(0, 0, 0);
      c.quaternion.identity();
      c.scale.setScalar(1);
      this.mesh.geometry = a.model.chains.get(boneIndex)!;
    } else {
      this.mesh.geometry = a.model.lods[0]!;
    }

    src.copySurfaceTo(this.data, this.extras, this.book, this.worn);
    // A limb has nothing fading its flash, so a value copied mid-hit would stay lit for good.
    this.data[this.extras + EXTRA_PARAMS * 4 + 1] = 0;
    this.kitCharred = this.burn >= KIT_CHARS_AT;
    this.showWounds();
    for (const p of src.props) {
      // A prop that has already left the bone (a helmet shot off) stays where it went; one out of sight stays so.
      if (!chain[p.bone] || p.object.parent !== src.bones[p.bone] || !p.object.visible) continue;
      // A clone, because the limb can outlive the instance that shed it.
      const clone = p.object.clone();
      clone.visible = true;
      if (this.kitCharred) charKit(clone, true);
      this.bones[p.bone]!.add(clone);
      this.clones.push(clone);
      p.object.visible = false;
    }
    this.root.position.set(0, 0, 0);
    this.root.quaternion.identity();
    this.root.visible = true;
    this.root.updateMatrixWorld(true);
  }

  release(): void {
    for (const c of this.clones) c.removeFromParent();
    this.clones.length = 0;
    this.kitCharred = false;
    this.book.clear();
    this.worn.clear();
    this.mesh.material = this.a.material;
    this.mesh.castShadow = true;
    if (this.inside) this.showInside(false);
    this.root.removeFromParent();
    this.releaseHook?.(this);
  }
}
