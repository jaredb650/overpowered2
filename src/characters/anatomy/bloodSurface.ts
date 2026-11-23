/**
 * Overgrowth-style dynamic character blood staining and mesh surface topology.
 *
 * Every flesh humanoid archetype builds one shared `WalkMesh` (LOD 1, which preserves UV seams) with 3D-position-hashed
 * triangle adjacency so blood collars and gravity-driven surface droplets cross UV seams cleanly.
 *
 * A single pooled `THREE.DataArrayTexture` (32 layers × 256×256 × RG8, 4 MB total) holds per-character blood stains:
 *   R  coverage / thickness (0 clean, 0.05..0.4 soaked fabric tint, 0.5..1.0 thick glossy crimson)
 *   G  freshness (1 freshly pumped bright wet sheen, decaying toward 0 once bleeding stops)
 *
 * Each character's layer index (+1, 0 = clean) rides in its existing bone texture (`EXTRA_BLOOD_MAP`), keeping all
 * instances on one shared material with partial per-layer GPU uploads (`addLayerUpdate`).
 */
import * as THREE from 'three';
import type { LoadedModel } from '../model';

export const BLOOD_MAP_SIZE = 256;
export const BLOOD_MAP_LAYERS = 32;

/** Bleeding severity tier for visual readability. */
export type BloodTier = 1 | 2 | 3;

export interface WalkMesh {
  readonly triCount: number;
  /** Dominant rig bone index per triangle. */
  readonly triBone: Uint8Array;
  /** Bind-space corner positions: 9 floats per triangle (x0,y0,z0, x1,y1,z1, x2,y2,z2). */
  readonly triPos: Float32Array;
  /** Normalized 0..1 UVs: 6 floats per triangle (u0,v0, u1,v1, u2,v2). */
  readonly triUv: Float32Array;
  /** Bind-space triangle centroids: 3 floats per triangle. */
  readonly triCenter: Float32Array;
  /** Bind-space unit face normals: 3 floats per triangle. */
  readonly triNormal: Float32Array;
  /** Neighbor triangle across edges 0 (v0-v1), 1 (v1-v2), 2 (v2-v0), or -1 on a boundary. */
  readonly triAdj: Int32Array;
  /** Triangle indices grouped by dominant rig bone. */
  readonly boneTris: readonly Int32Array[];
}

/** Quantizes a bind-space coordinate to 0.5 mm precision for UV-seam-bridging vertex welding. */
function quantKey(x: number, y: number, z: number): string {
  return `${Math.round(x * 2000)},${Math.round(y * 2000)},${Math.round(z * 2000)}`;
}

/**
 * Builds the surface-walking topology for a character model from LOD 1 (respects UV seams, ~5k tris), falling back to
 * LOD 0. Returns null for models without UVs.
 */
export function buildWalkMesh(model: LoadedModel): WalkMesh | null {
  const uvAttr = model.attributes.uv;
  const siAttr = model.attributes.skinIndex;
  const swAttr = model.attributes.skinWeight;
  if (!uvAttr || !siAttr || !swAttr) return null;

  const geom = model.lods[1] ?? model.lods[0];
  const index = geom?.getIndex();
  if (!index || index.count < 3) return null;

  const idx = index.array;
  const pos = model.attributes.position.array as Float32Array;
  const uvArr = uvAttr.array as Uint16Array | Float32Array;
  const uvScale = uvArr instanceof Uint16Array ? 1 / 65535 : 1;
  const si = siAttr.array as Uint8Array;
  const sw = swAttr.array as Uint8Array;
  const rigCount = model.meta.rigBoneCount;
  const triCount = (index.count / 3) | 0;

  const triBone = new Uint8Array(triCount);
  const triPos = new Float32Array(triCount * 9);
  const triUv = new Float32Array(triCount * 6);
  const triCenter = new Float32Array(triCount * 3);
  const triNormal = new Float32Array(triCount * 3);
  const triAdj = new Int32Array(triCount * 3).fill(-1);

  const vertCount = model.attributes.position.count;
  const posIds = new Int32Array(vertCount).fill(-1);
  const posMap = new Map<string, number>();
  let nextPosId = 0;

  const getPosId = (vi: number): number => {
    const existing = posIds[vi]!;
    if (existing >= 0) return existing;
    const key = quantKey(pos[vi * 3]!, pos[vi * 3 + 1]!, pos[vi * 3 + 2]!);
    let id = posMap.get(key);
    if (id === undefined) {
      id = nextPosId++;
      posMap.set(key, id);
    }
    posIds[vi] = id;
    return id;
  };

  // Edge table keyed by canonical (minPosId, maxPosId) -> first (tri * 3 + edgeIdx).
  // Supports up to 2^26 unique positions cleanly using BigInt or string; with < 50k verts,
  // numeric key `lo * 131072 + hi` stays safely inside Number.MAX_SAFE_INTEGER (2^53).
  const edgeMap = new Map<number, number>();
  const boneCounts = new Int32Array(rigCount);

  for (let t = 0; t < triCount; t++) {
    const i0 = idx[t * 3]!;
    const i1 = idx[t * 3 + 1]!;
    const i2 = idx[t * 3 + 2]!;

    const x0 = pos[i0 * 3]!, y0 = pos[i0 * 3 + 1]!, z0 = pos[i0 * 3 + 2]!;
    const x1 = pos[i1 * 3]!, y1 = pos[i1 * 3 + 1]!, z1 = pos[i1 * 3 + 2]!;
    const x2 = pos[i2 * 3]!, y2 = pos[i2 * 3 + 1]!, z2 = pos[i2 * 3 + 2]!;

    const p = t * 9;
    triPos[p] = x0; triPos[p + 1] = y0; triPos[p + 2] = z0;
    triPos[p + 3] = x1; triPos[p + 4] = y1; triPos[p + 5] = z1;
    triPos[p + 6] = x2; triPos[p + 7] = y2; triPos[p + 8] = z2;

    const u = t * 6;
    triUv[u] = uvArr[i0 * 2]! * uvScale; triUv[u + 1] = uvArr[i0 * 2 + 1]! * uvScale;
    triUv[u + 2] = uvArr[i1 * 2]! * uvScale; triUv[u + 3] = uvArr[i1 * 2 + 1]! * uvScale;
    triUv[u + 4] = uvArr[i2 * 2]! * uvScale; triUv[u + 5] = uvArr[i2 * 2 + 1]! * uvScale;

    const c = t * 3;
    triCenter[c] = (x0 + x1 + x2) / 3;
    triCenter[c + 1] = (y0 + y1 + y2) / 3;
    triCenter[c + 2] = (z0 + z1 + z2) / 3;

    const e1x = x1 - x0, e1y = y1 - y0, e1z = z1 - z0;
    const e2x = x2 - x0, e2y = y2 - y0, e2z = z2 - z0;
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    const nl = Math.hypot(nx, ny, nz) || 1;
    triNormal[c] = nx / nl;
    triNormal[c + 1] = ny / nl;
    triNormal[c + 2] = nz / nl;

    // Dominant rig bone across the 3 vertices.
    let bestBone = 0;
    let bestW = -1;
    for (let k = 0; k < 3; k++) {
      const vi = k === 0 ? i0 : k === 1 ? i1 : i2;
      for (let j = 0; j < 4; j++) {
        const w = sw[vi * 4 + j]!;
        if (w <= bestW) continue;
        const b = si[vi * 4 + j]!;
        if (b < rigCount) {
          bestW = w;
          bestBone = b;
        }
      }
    }
    triBone[t] = bestBone;
    boneCounts[bestBone] = boneCounts[bestBone]! + 1;

    // Seam-bridging 3D edge adjacency.
    const p0 = getPosId(i0), p1 = getPosId(i1), p2 = getPosId(i2);
    for (let e = 0; e < 3; e++) {
      const a = e === 0 ? p0 : e === 1 ? p1 : p2;
      const b = e === 0 ? p1 : e === 1 ? p2 : p0;
      if (a === b) continue;
      const key = a < b ? a * 1048576 + b : b * 1048576 + a;
      const other = edgeMap.get(key);
      if (other === undefined) {
        edgeMap.set(key, t * 3 + e);
      } else {
        const ot = (other / 3) | 0;
        const oe = other - ot * 3;
        if (ot !== t && triAdj[t * 3 + e] === -1 && triAdj[ot * 3 + oe] === -1) {
          triAdj[t * 3 + e] = ot;
          triAdj[ot * 3 + oe] = t;
        }
      }
    }
  }

  const boneTris: Int32Array[] = Array.from({ length: rigCount }, (_, b) => new Int32Array(boneCounts[b]!));
  const cursor = new Int32Array(rigCount);
  for (let t = 0; t < triCount; t++) {
    const b = triBone[t]!;
    boneTris[b]![cursor[b]!] = t;
    cursor[b] = cursor[b]! + 1;
  }

  return { triCount, triBone, triPos, triUv, triCenter, triNormal, triAdj, boneTris };
}

/** Computes barycentric coordinates of point (px, py, pz) projected onto triangle `tri` in bind space. */
export function triBarycentric(mesh: WalkMesh, tri: number, px: number, py: number, pz: number, out: Float32Array): void {
  const p = tri * 9;
  const x0 = mesh.triPos[p]!, y0 = mesh.triPos[p + 1]!, z0 = mesh.triPos[p + 2]!;
  const v0x = mesh.triPos[p + 3]! - x0, v0y = mesh.triPos[p + 4]! - y0, v0z = mesh.triPos[p + 5]! - z0;
  const v1x = mesh.triPos[p + 6]! - x0, v1y = mesh.triPos[p + 7]! - y0, v1z = mesh.triPos[p + 8]! - z0;
  const v2x = px - x0, v2y = py - y0, v2z = pz - z0;

  const d00 = v0x * v0x + v0y * v0y + v0z * v0z;
  const d01 = v0x * v1x + v0y * v1y + v0z * v1z;
  const d11 = v1x * v1x + v1y * v1y + v1z * v1z;
  const d20 = v2x * v0x + v2y * v0y + v2z * v0z;
  const d21 = v2x * v1x + v2y * v1y + v2z * v1z;
  const denom = d00 * d11 - d01 * d01;
  if (Math.abs(denom) < 1e-12) {
    out[0] = out[1] = out[2] = 1 / 3;
    return;
  }
  const inv = 1 / denom;
  const b1 = (d11 * d20 - d01 * d21) * inv;
  const b2 = (d00 * d21 - d01 * d20) * inv;
  out[0] = 1 - b1 - b2;
  out[1] = b1;
  out[2] = b2;
}

/** Clamps barycentric coordinates into the triangle [0,1] and normalizes their sum to 1. */
export function clampBarycentric(out: Float32Array): void {
  let b0 = out[0]!, b1 = out[1]!, b2 = out[2]!;
  if (b0 < 0) b0 = 0;
  if (b1 < 0) b1 = 0;
  if (b2 < 0) b2 = 0;
  const sum = b0 + b1 + b2;
  if (sum > 1e-8) {
    const inv = 1 / sum;
    out[0] = b0 * inv;
    out[1] = b1 * inv;
    out[2] = b2 * inv;
  } else {
    out[0] = out[1] = out[2] = 1 / 3;
  }
}

/**
 * Finds the triangle on `mesh` nearest to bind-space point `(bx, by, bz)`, preferring triangles skinned to `bone`.
 * Writes clamped barycentric coordinates of the projected point into `outBary`.
 */
export function findNearestTri(mesh: WalkMesh, bone: number, bx: number, by: number, bz: number, outBary: Float32Array): number {
  const c = mesh.triCenter;
  let bestTri = -1;
  let bestD2 = Infinity;

  const list = mesh.boneTris[bone];
  if (list && list.length > 0) {
    for (let i = 0; i < list.length; i++) {
      const t = list[i]!;
      const dx = c[t * 3]! - bx, dy = c[t * 3 + 1]! - by, dz = c[t * 3 + 2]! - bz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < bestD2) {
        bestD2 = d2;
        bestTri = t;
      }
    }
  }

  // Fallback across the full mesh if the bone list was empty or the hit sits on a neighboring bone's joint.
  if (bestTri < 0 || bestD2 > 0.0225) {
    for (let t = 0; t < mesh.triCount; t++) {
      const dx = c[t * 3]! - bx, dy = c[t * 3 + 1]! - by, dz = c[t * 3 + 2]! - bz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < bestD2) {
        bestD2 = d2;
        bestTri = t;
      }
    }
  }

  if (bestTri >= 0) {
    triBarycentric(mesh, bestTri, bx, by, bz, outBary);
    clampBarycentric(outBary);
  }
  return bestTri;
}

/**
 * When a surface droplet hits an open edge of a layered mesh shell (e.g. the bottom hem of a chest rig or belt),
 * checks whether another shell sits just along gravity `(gx, gy, gz)` within `maxDist` (e.g. underlying tunic or thigh).
 * Returns the catching triangle index (with `outBary` filled) or -1 if the droplet should detach into the air.
 */
export function findStepDownTri(
  mesh: WalkMesh,
  excludeTri: number,
  px: number, py: number, pz: number,
  gx: number, gy: number, gz: number,
  maxDist: number,
  outBary: Float32Array,
  nearbyBones?: readonly number[],
): number {
  // Probe slightly further along gravity from the shell hem.
  const tx = px + gx * (maxDist * 0.55);
  const ty = py + gy * (maxDist * 0.55);
  const tz = pz + gz * (maxDist * 0.55);
  const maxD2 = maxDist * maxDist;
  const c = mesh.triCenter;
  const n = mesh.triNormal;
  let bestTri = -1;
  let bestD2 = maxD2;

  if (nearbyBones && nearbyBones.length > 0) {
    for (let bi = 0; bi < nearbyBones.length; bi++) {
      const list = mesh.boneTris[nearbyBones[bi]!];
      if (!list) continue;
      for (let i = 0; i < list.length; i++) {
        const t = list[i]!;
        if (t === excludeTri) continue;
        // Skip triangles facing strongly downward (undersides shouldn't catch a falling drop).
        if (n[t * 3]! * gx + n[t * 3 + 1]! * gy + n[t * 3 + 2]! * gz > 0.45) continue;
        const dx = c[t * 3]! - tx, dy = c[t * 3 + 1]! - ty, dz = c[t * 3 + 2]! - tz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= bestD2) continue;
        // Must lie forward along gravity from the exit point (never hop back upward).
        const fwd = (c[t * 3]! - px) * gx + (c[t * 3 + 1]! - py) * gy + (c[t * 3 + 2]! - pz) * gz;
        if (fwd < 0.008) continue;
        bestD2 = d2;
        bestTri = t;
      }
    }
  } else {
    for (let t = 0; t < mesh.triCount; t++) {
      if (t === excludeTri) continue;
      // Skip triangles facing strongly downward (undersides shouldn't catch a falling drop).
      if (n[t * 3]! * gx + n[t * 3 + 1]! * gy + n[t * 3 + 2]! * gz > 0.45) continue;
      const dx = c[t * 3]! - tx, dy = c[t * 3 + 1]! - ty, dz = c[t * 3 + 2]! - tz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= bestD2) continue;
      // Must lie forward along gravity from the exit point (never hop back upward).
      const fwd = (c[t * 3]! - px) * gx + (c[t * 3 + 1]! - py) * gy + (c[t * 3 + 2]! - pz) * gz;
      if (fwd < 0.008) continue;
      bestD2 = d2;
      bestTri = t;
    }
  }

  if (bestTri >= 0) {
    triBarycentric(mesh, bestTri, tx, ty, tz, outBary);
    clampBarycentric(outBary);
  }
  return bestTri;
}

/** Cheap deterministic texel hash in [0, 1] for subtle organic cloth absorption edges. */
function hashTexel(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = ((h ^ (h >>> 13)) * 1274126177) | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

interface LayerSlot {
  owner: object | null;
  dirty: boolean;
  lastActive: number;
  priority: number;
  hasFresh: boolean;
  minFreshByte: number;
  maxFreshByte: number;
  lastDecayAt: number;
}

const LAYER_BYTES = BLOOD_MAP_SIZE * BLOOD_MAP_SIZE * 2;
const BFS_CAP = 128;

/**
 * Pooled 2D array texture storing dynamic UV blood stains for up to `BLOOD_MAP_LAYERS` characters at once.
 * Owned by `CharacterLibraryImpl`, shared by every flesh humanoid material, and painted by `SurfaceBloodField`.
 */
export class BloodSurfacePool {
  readonly data = new Uint8Array(BLOOD_MAP_LAYERS * LAYER_BYTES);
  readonly texture: THREE.DataArrayTexture;
  /** Called when a busy pool evicts an older character's layer so callers can drop its walkers and reset its texel. */
  onEvict: ((owner: object, layer: number) => void) | null = null;

  private readonly slots: LayerSlot[] = Array.from({ length: BLOOD_MAP_LAYERS }, () => ({
    owner: null, dirty: false, lastActive: -1, priority: 0, hasFresh: false,
    minFreshByte: LAYER_BYTES, maxFreshByte: -1, lastDecayAt: 0,
  }));
  private readonly ownerLayer = new Map<object, number>();
  private gpuReady = false;
  private fullUploadPending = true;
  private decayCursor = 0;
  private decayClock = 0;
  private readonly sampleOut: [number, number] = [0, 0];

  // Scratch BFS state (zero hot-path allocations).
  private readonly bfsQueue = new Int32Array(BFS_CAP);
  private visitMarks = new Uint32Array(8192);
  private visitStamp = 1;

  constructor() {
    const tex = new THREE.DataArrayTexture(this.data, BLOOD_MAP_SIZE, BLOOD_MAP_SIZE, BLOOD_MAP_LAYERS);
    tex.format = THREE.RGFormat;
    tex.type = THREE.UnsignedByteType;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.generateMipmaps = false;
    tex.flipY = false;
    tex.unpackAlignment = 1;
    tex.needsUpdate = true;
    tex.onUpdate = () => {
      this.gpuReady = true;
      this.fullUploadPending = false;
    };
    this.texture = tex;
  }

  /** Returns the 0-based layer index for `owner`, or -1 if it has no layer. */
  layerOf(owner: object): number {
    return this.ownerLayer.get(owner) ?? -1;
  }

  /** Number of layers currently assigned. For tests and diagnostics. */
  get activeCount(): number {
    return this.ownerLayer.size;
  }

  /** Acquires or reuses a layer for `owner`, evicting the lowest-priority oldest slot if the pool is full. */
  acquire(owner: object, priority: number, now: number): number {
    const existing = this.ownerLayer.get(owner);
    if (existing !== undefined) {
      const s = this.slots[existing]!;
      s.lastActive = now;
      if (priority > s.priority) s.priority = priority;
      return existing;
    }
    let pick = -1;
    for (let i = 0; i < BLOOD_MAP_LAYERS; i++) {
      if (this.slots[i]!.owner === null) {
        pick = i;
        break;
      }
    }
    if (pick < 0) {
      let worstPrio = Infinity;
      let oldest = Infinity;
      for (let i = 0; i < BLOOD_MAP_LAYERS; i++) {
        const s = this.slots[i]!;
        if (s.priority < worstPrio || (s.priority === worstPrio && s.lastActive < oldest)) {
          worstPrio = s.priority;
          oldest = s.lastActive;
          pick = i;
        }
      }
      const prev = this.slots[pick]!.owner;
      if (prev) {
        this.ownerLayer.delete(prev);
        this.onEvict?.(prev, pick);
      }
    }
    const slot = this.slots[pick]!;
    slot.owner = owner;
    slot.lastActive = now;
    slot.priority = priority;
    slot.hasFresh = false;
    slot.minFreshByte = LAYER_BYTES;
    slot.maxFreshByte = -1;
    slot.lastDecayAt = this.decayClock;
    slot.dirty = true;
    this.data.fill(0, pick * LAYER_BYTES, (pick + 1) * LAYER_BYTES);
    this.ownerLayer.set(owner, pick);
    return pick;
  }

  /** Lowers a settled body's priority so live active bleeders can reclaim its layer first when full. */
  setPriority(owner: object, priority: number): void {
    const layer = this.ownerLayer.get(owner);
    if (layer !== undefined) this.slots[layer]!.priority = priority;
  }

  /** Releases `owner`'s layer and zeroes its buffer. */
  release(owner: object): void {
    const layer = this.ownerLayer.get(owner);
    if (layer === undefined) return;
    this.ownerLayer.delete(owner);
    const slot = this.slots[layer]!;
    slot.owner = null;
    slot.priority = 0;
    slot.hasFresh = false;
    slot.minFreshByte = LAYER_BYTES;
    slot.maxFreshByte = -1;
    slot.lastDecayAt = this.decayClock;
    slot.dirty = true;
    this.data.fill(0, layer * LAYER_BYTES, (layer + 1) * LAYER_BYTES);
  }

  /** Clears all layers. */
  clear(): void {
    for (let i = 0; i < BLOOD_MAP_LAYERS; i++) {
      const s = this.slots[i]!;
      if (s.owner) this.onEvict?.(s.owner, i);
      s.owner = null;
      s.dirty = false;
      s.lastActive = -1;
      s.priority = 0;
      s.hasFresh = false;
      s.minFreshByte = LAYER_BYTES;
      s.maxFreshByte = -1;
      s.lastDecayAt = 0;
    }
    this.decayClock = 0;
    this.decayCursor = 0;
    this.ownerLayer.clear();
    this.data.fill(0);
    this.fullUploadPending = true;
    this.texture.clearLayerUpdates();
    this.texture.needsUpdate = true;
  }

  /** Copies one layer's bytes into a newly acquired layer (e.g., severed limb inheriting parent's stains). */
  copyLayer(srcLayer: number, dstLayer: number): void {
    if (srcLayer < 0 || dstLayer < 0 || srcLayer === dstLayer) return;
    const srcOff = srcLayer * LAYER_BYTES;
    this.data.copyWithin(dstLayer * LAYER_BYTES, srcOff, srcOff + LAYER_BYTES);
    const src = this.slots[srcLayer]!;
    const dst = this.slots[dstLayer]!;
    dst.dirty = true;
    dst.hasFresh = src.hasFresh;
    dst.minFreshByte = src.minFreshByte;
    dst.maxFreshByte = src.maxFreshByte;
    dst.lastDecayAt = src.lastDecayAt;
  }

  /** Samples `[coverage01, fresh01]` at normalized UV `(u, v)` into a reused scratch tuple (or `out`). */
  sampleUv(layer: number, u: number, v: number, out: [number, number] = this.sampleOut): [number, number] {
    if (layer < 0 || layer >= BLOOD_MAP_LAYERS) {
      out[0] = 0;
      out[1] = 0;
      return out;
    }
    const px = Math.min(BLOOD_MAP_SIZE - 1, Math.max(0, (u * BLOOD_MAP_SIZE) | 0));
    const py = Math.min(BLOOD_MAP_SIZE - 1, Math.max(0, (v * BLOOD_MAP_SIZE) | 0));
    const o = layer * LAYER_BYTES + (py * BLOOD_MAP_SIZE + px) * 2;
    out[0] = this.data[o]! / 255;
    out[1] = this.data[o + 1]! / 255;
    return out;
  }

  /** Stamps a single pixel with smooth coverage accumulation and fresh arterial highlight. Returns true iff a byte changed. */
  private stampPixel(slot: LayerSlot, base: number, px: number, py: number, cov: number, fresh: number): boolean {
    if (px < 0 || px >= BLOOD_MAP_SIZE || py < 0 || py >= BLOOD_MAP_SIZE) return false;
    const local = (py * BLOOD_MAP_SIZE + px) * 2;
    const o = base + local;
    let changed = false;
    const targetR = cov * 255;
    const curR = this.data[o]!;
    // Accumulate smoothly so repeated drips over the same cloth thicken and darken naturally.
    const nextR = Math.min(255, curR >= targetR ? curR + targetR * 0.14 : curR + (targetR - curR) * 0.72) | 0;
    if (nextR > curR) {
      this.data[o] = nextR;
      changed = true;
    }
    const targetG = Math.min(255, (fresh * 255) | 0);
    if (targetG > this.data[o + 1]!) {
      this.data[o + 1] = targetG;
      changed = true;
      const gOff = local + 1;
      if (!slot.hasFresh) {
        slot.hasFresh = true;
        slot.lastDecayAt = this.decayClock;
      }
      if (gOff < slot.minFreshByte) slot.minFreshByte = gOff;
      if (gOff > slot.maxFreshByte) slot.maxFreshByte = gOff;
    }
    return changed;
  }

  /**
   * Paints a thin rivulet trail from UV `(u0, v0)` to `(u1, v1)` within a single triangle.
   * Width is in texels (`~1.0..2.4` on 256×256 for crisp trickling trails).
   */
  paintStreak(layer: number, u0: number, v0: number, u1: number, v1: number, widthPx: number, amount: number, fresh: number): boolean {
    if (layer < 0 || layer >= BLOOD_MAP_LAYERS) return false;
    const slot = this.slots[layer]!;
    const base = layer * LAYER_BYTES;
    const x0 = u0 * (BLOOD_MAP_SIZE - 1);
    const y0 = v0 * (BLOOD_MAP_SIZE - 1);
    const x1 = u1 * (BLOOD_MAP_SIZE - 1);
    const y1 = v1 * (BLOOD_MAP_SIZE - 1);
    const dx = x1 - x0, dy = y1 - y0;
    const dist = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.min(24, Math.ceil(dist * 1.5)));
    const r = Math.max(0.75, widthPx);
    const ri = Math.ceil(r);
    let changed = false;

    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const cx = x0 + dx * t;
      const cy = y0 + dy * t;
      const ix0 = Math.max(0, Math.floor(cx - ri));
      const ix1 = Math.min(BLOOD_MAP_SIZE - 1, Math.ceil(cx + ri));
      const iy0 = Math.max(0, Math.floor(cy - ri));
      const iy1 = Math.min(BLOOD_MAP_SIZE - 1, Math.ceil(cy + ri));
      for (let py = iy0; py <= iy1; py++) {
        for (let px = ix0; px <= ix1; px++) {
          const d = Math.hypot(px - cx, py - cy) / r;
          if (d >= 1) continue;
          const fall = (1 - d * d);
          const grain = 0.86 + 0.28 * hashTexel(px, py);
          const cov = Math.min(1, amount * fall * grain);
          if (cov > 0.02 && this.stampPixel(slot, base, px, py, cov, fresh * fall)) changed = true;
        }
      }
    }
    if (changed) slot.dirty = true;
    return changed;
  }

  /**
   * Paints a seamless 3D-radius soaking collar around bind-space point `(bx, by, bz)` by walking adjacent triangles
   * across UV seams and evaluating true 3D bind-space distance at every rasterized texel.
   * Returns true iff at least one byte changed.
   */
  paintCollar(
    layer: number, mesh: WalkMesh, startTri: number,
    bx: number, by: number, bz: number,
    radius: number, amount: number, fresh: number, stretchDown = 0,
    nearbyBones?: readonly number[],
  ): boolean {
    if (layer < 0 || layer >= BLOOD_MAP_LAYERS || startTri < 0 || radius <= 1e-4) return false;
    if (this.visitMarks.length < mesh.triCount) this.visitMarks = new Uint32Array(mesh.triCount);
    const stamp = ++this.visitStamp;
    if (stamp === 0xffffffff) {
      this.visitMarks.fill(0);
      this.visitStamp = 1;
    }

    const q = this.bfsQueue;
    let qHead = 0, qTail = 0;
    q[qTail++] = startTri;
    this.visitMarks[startTri] = this.visitStamp;

    const slot = this.slots[layer]!;
    const base = layer * LAYER_BYTES;
    const downMul = 1 / (1 + stretchDown);
    const reachX = radius * 1.35;
    const reachY = radius * (1.35 + stretchDown);
    const pos = mesh.triPos;
    let painted = false;

    while (qHead < qTail) {
      const tri = q[qHead++]!;
      if (this.rasterizeTriCollar(slot, base, mesh, tri, bx, by, bz, radius, downMul, amount, fresh)) painted = true;

      if (qTail >= BFS_CAP) continue;
      for (let e = 0; e < 3; e++) {
        const nb = mesh.triAdj[tri * 3 + e]!;
        if (nb < 0 || this.visitMarks[nb] === this.visitStamp) continue;
        const p = nb * 9;
        const minX = Math.min(pos[p]!, pos[p + 3]!, pos[p + 6]!);
        const maxX = Math.max(pos[p]!, pos[p + 3]!, pos[p + 6]!);
        if (bx + reachX < minX || bx - reachX > maxX) continue;
        const minY = Math.min(pos[p + 1]!, pos[p + 4]!, pos[p + 7]!);
        const maxY = Math.max(pos[p + 1]!, pos[p + 4]!, pos[p + 7]!);
        if (by + reachY < minY || by - reachY > maxY) continue;
        const minZ = Math.min(pos[p + 2]!, pos[p + 5]!, pos[p + 8]!);
        const maxZ = Math.max(pos[p + 2]!, pos[p + 5]!, pos[p + 8]!);
        if (bz + reachX < minZ || bz - reachX > maxZ) continue;
        this.visitMarks[nb] = this.visitStamp;
        if (qTail < BFS_CAP) q[qTail++] = nb;
      }
    }

    // Layered armor vests, straps, belts and underlying cloth often live on disconnected mesh shells:
    // also rasterize any unvisited triangles within the 3D collar AABB on the wound's bone and adjacent bones.
    if (nearbyBones && nearbyBones.length > 0) {
      for (const boneId of nearbyBones) {
        const list = mesh.boneTris[boneId];
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          const tri = list[i]!;
          if (this.visitMarks[tri] === this.visitStamp) continue;
          const p = tri * 9;
          const minX = Math.min(pos[p]!, pos[p + 3]!, pos[p + 6]!);
          const maxX = Math.max(pos[p]!, pos[p + 3]!, pos[p + 6]!);
          if (bx + reachX < minX || bx - reachX > maxX) continue;
          const minY = Math.min(pos[p + 1]!, pos[p + 4]!, pos[p + 7]!);
          const maxY = Math.max(pos[p + 1]!, pos[p + 4]!, pos[p + 7]!);
          if (by + reachY < minY || by - reachY > maxY) continue;
          const minZ = Math.min(pos[p + 2]!, pos[p + 5]!, pos[p + 8]!);
          const maxZ = Math.max(pos[p + 2]!, pos[p + 5]!, pos[p + 8]!);
          if (bz + reachX < minZ || bz - reachX > maxZ) continue;
          this.visitMarks[tri] = this.visitStamp;
          if (this.rasterizeTriCollar(slot, base, mesh, tri, bx, by, bz, radius, downMul, amount, fresh)) painted = true;
        }
      }
    }

    if (painted) slot.dirty = true;
    return painted;
  }

  /** Rasterizes one triangle into UV space, shading each texel by 3D bind-space distance from `(bx, by, bz)`. */
  private rasterizeTriCollar(
    slot: LayerSlot, base: number, mesh: WalkMesh, tri: number,
    bx: number, by: number, bz: number,
    radius: number, downMul: number, amount: number, fresh: number,
  ): boolean {
    const S = BLOOD_MAP_SIZE - 1;
    const u = tri * 6;
    const x0 = mesh.triUv[u]! * S, y0 = mesh.triUv[u + 1]! * S;
    const x1 = mesh.triUv[u + 2]! * S, y1 = mesh.triUv[u + 3]! * S;
    const x2 = mesh.triUv[u + 4]! * S, y2 = mesh.triUv[u + 5]! * S;

    const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (Math.abs(area) < 1e-4) return false;
    const invA = 1 / area;

    const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)) - 1);
    const maxX = Math.min(S, Math.ceil(Math.max(x0, x1, x2)) + 1);
    const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)) - 1);
    const maxY = Math.min(S, Math.ceil(Math.max(y0, y1, y2)) + 1);

    const p = tri * 9;
    const px0 = mesh.triPos[p]!, py0 = mesh.triPos[p + 1]!, pz0 = mesh.triPos[p + 2]!;
    const px1 = mesh.triPos[p + 3]!, py1 = mesh.triPos[p + 4]!, pz1 = mesh.triPos[p + 5]!;
    const px2 = mesh.triPos[p + 6]!, py2 = mesh.triPos[p + 7]!, pz2 = mesh.triPos[p + 8]!;

    // Small negative tolerance dilates 1 texel across UV island borders to prevent seam cracks under bilinear filtering.
    const pad = -0.14;
    let changed = false;

    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        const w0 = ((x1 - px) * (y2 - py) - (x2 - px) * (y1 - py)) * invA;
        const w1 = ((x2 - px) * (y0 - py) - (x0 - px) * (y2 - py)) * invA;
        const w2 = 1 - w0 - w1;
        if (w0 < pad || w1 < pad || w2 < pad) continue;

        // Clamp weights for position interpolation so dilated border texels stay on the edge.
        const cw0 = w0 < 0 ? 0 : w0, cw1 = w1 < 0 ? 0 : w1, cw2 = w2 < 0 ? 0 : w2;
        const csum = cw0 + cw1 + cw2 || 1;
        const iw0 = cw0 / csum, iw1 = cw1 / csum, iw2 = cw2 / csum;

        const wx = px0 * iw0 + px1 * iw1 + px2 * iw2 - bx;
        const wy = py0 * iw0 + py1 * iw1 + py2 * iw2 - by;
        const wz = pz0 * iw0 + pz1 * iw1 + pz2 * iw2 - bz;
        const sy = wy < 0 ? wy * downMul : wy;
        const normD = Math.hypot(wx, sy, wz) / radius;
        if (normD >= 1.15) continue;

        const jitter = (hashTexel(px, py) - 0.5) * 0.28;
        const edge = 1 - Math.min(1, Math.max(0, (normD + jitter - 0.2) / 0.85));
        if (edge <= 0.01) continue;
        const cov = Math.min(1, amount * edge * edge * (1.25 - 0.25 * edge));
        if (this.stampPixel(slot, base, px, py, cov, fresh * edge)) changed = true;
      }
    }
    return changed;
  }

  /**
   * Stains all triangles belonging to `bone` (e.g., staining a clutching hand/forearm when pressing an arterial wound).
   */
  paintBone(layer: number, mesh: WalkMesh, bone: number, amount: number, fresh: number): boolean {
    if (layer < 0 || layer >= BLOOD_MAP_LAYERS) return false;
    const tris = mesh.boneTris[bone];
    if (!tris || tris.length === 0) return false;
    const slot = this.slots[layer]!;
    const base = layer * LAYER_BYTES;
    let changed = false;
    for (let i = 0; i < tris.length; i++) {
      if (this.rasterizeTriUniform(slot, base, mesh, tris[i]!, amount, fresh)) changed = true;
    }
    if (changed) slot.dirty = true;
    return changed;
  }

  /**
   * Soaks the underside/floor-contact side of a downed, crawling, or settled body lying in a wet blood pool.
   */
  paintFloorSoak(
    layer: number, mesh: WalkMesh,
    bones: readonly THREE.Bone[], bindPositions: readonly THREE.Vector3[],
    floorY: number, maxHeight: number, amount: number, fresh: number,
  ): boolean {
    if (layer < 0 || layer >= BLOOD_MAP_LAYERS || maxHeight <= 1e-4) return false;
    const slot = this.slots[layer]!;
    const base = layer * LAYER_BYTES;
    const c = mesh.triCenter;
    let changed = false;

    for (let t = 0; t < mesh.triCount; t++) {
      const b = mesh.triBone[t]!;
      const bone = bones[b];
      const bind = bindPositions[b];
      if (!bone || !bind) continue;
      const e = bone.matrixWorld.elements;
      // Skip collapsed (severed) bones.
      if (Math.abs(e[0]!) + Math.abs(e[1]!) + Math.abs(e[2]!) < 1e-3) continue;
      const lx = c[t * 3]! - bind.x;
      const ly = c[t * 3 + 1]! - bind.y;
      const lz = c[t * 3 + 2]! - bind.z;
      // World Y of the triangle center.
      const wy = e[1]! * lx + e[5]! * ly + e[9]! * lz + e[13]!;
      const h = wy - floorY;
      if (h > maxHeight) continue;
      const k = 1 - Math.max(0, h) / maxHeight;
      if (this.rasterizeTriUniform(slot, base, mesh, t, amount * (0.45 + 0.55 * k), fresh * k)) changed = true;
    }

    if (changed) slot.dirty = true;
    return changed;
  }

  /** Rasterizes one triangle uniformly with subtle organic cloth absorption variation. */
  private rasterizeTriUniform(slot: LayerSlot, base: number, mesh: WalkMesh, tri: number, amount: number, fresh: number): boolean {
    const S = BLOOD_MAP_SIZE - 1;
    const u = tri * 6;
    const x0 = mesh.triUv[u]! * S, y0 = mesh.triUv[u + 1]! * S;
    const x1 = mesh.triUv[u + 2]! * S, y1 = mesh.triUv[u + 3]! * S;
    const x2 = mesh.triUv[u + 4]! * S, y2 = mesh.triUv[u + 5]! * S;
    const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (Math.abs(area) < 1e-4) return false;
    const invA = 1 / area;
    const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)) - 1);
    const maxX = Math.min(S, Math.ceil(Math.max(x0, x1, x2)) + 1);
    const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)) - 1);
    const maxY = Math.min(S, Math.ceil(Math.max(y0, y1, y2)) + 1);
    const pad = -0.14;
    let changed = false;
    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        const w0 = ((x1 - px) * (y2 - py) - (x2 - px) * (y1 - py)) * invA;
        const w1 = ((x2 - px) * (y0 - py) - (x0 - px) * (y2 - py)) * invA;
        const w2 = 1 - w0 - w1;
        if (w0 < pad || w1 < pad || w2 < pad) continue;
        const grain = 0.72 + 0.45 * hashTexel(px, py);
        if (this.stampPixel(slot, base, px, py, Math.min(1, amount * grain), fresh)) changed = true;
      }
    }
    return changed;
  }

  /**
   * Gradually dulls the bright fresh arterial sheen (`G` channel) once active pumping stops.
   * Staggered 2 layers per frame (at 60 FPS) with per-layer elapsed tracking and tight `[minFreshByte, maxFreshByte]` bounds.
   */
  decayFreshness(dt: number): void {
    if (dt <= 0) return;
    this.decayClock += dt;
    const perCall = Math.max(2, Math.min(BLOOD_MAP_LAYERS, Math.ceil((dt / 0.25) * 4)));

    for (let k = 0; k < perCall; k++) {
      const layer = this.decayCursor;
      this.decayCursor = (layer + 1) & (BLOOD_MAP_LAYERS - 1);
      const slot = this.slots[layer]!;
      if (!slot.owner || !slot.hasFresh || slot.minFreshByte > slot.maxFreshByte) {
        slot.lastDecayAt = this.decayClock;
        continue;
      }
      const elapsed = this.decayClock - slot.lastDecayAt;
      const step = Math.floor(elapsed * 4);
      if (step < 1) continue;
      slot.lastDecayAt += step / 4;

      const base = layer * LAYER_BYTES;
      const hi = slot.maxFreshByte;
      let newMin = LAYER_BYTES;
      let newMax = -1;
      let changed = false;
      for (let i = slot.minFreshByte; i <= hi; i += 2) {
        const g = this.data[base + i]!;
        if (g === 0) continue;
        const next = g > step ? g - step : 0;
        this.data[base + i] = next;
        changed = true;
        if (next > 0) {
          if (i < newMin) newMin = i;
          if (i > newMax) newMax = i;
        }
      }
      slot.minFreshByte = newMin;
      slot.maxFreshByte = newMax;
      slot.hasFresh = newMax >= newMin;
      if (changed) slot.dirty = true;
    }
  }

  /** Queues GPU uploads for dirty layers only (after initial full allocation). */
  flush(): void {
    let any = false;
    for (let i = 0; i < BLOOD_MAP_LAYERS; i++) {
      const s = this.slots[i]!;
      if (!s.dirty) continue;
      s.dirty = false;
      any = true;
      if (this.gpuReady && !this.fullUploadPending) {
        this.texture.addLayerUpdate(i);
      }
    }
    if (any) this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
  }
}
