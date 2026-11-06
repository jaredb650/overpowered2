/** Parses baked model files into shared GPU-ready geometry. */
import * as THREE from 'three';
import { MODEL_MAGIC, MODEL_VERSION, type CapRef, type ModelMeta, type SectionName } from './format';

export interface LoadedModel {
  meta: ModelMeta;
  attributes: {
    position: THREE.BufferAttribute;
    normal: THREE.BufferAttribute;
    aColor: THREE.BufferAttribute;
    aMat: THREE.BufferAttribute;
    uv: THREE.BufferAttribute | null;
    skinIndex: THREE.BufferAttribute | null;
    skinWeight: THREE.BufferAttribute | null;
  };
  /** Index per LOD, without caps. */
  lods: THREE.BufferGeometry[];
  /** Index per LOD with every stump cap appended. Only used once something has been cut off. */
  lodsWithCaps: THREE.BufferGeometry[];
  /** Severed chain geometry by rig bone index. */
  chains: Map<number, THREE.BufferGeometry>;
  capByBone: Map<number, CapRef>;
  /** Raw index data for CPU skinning. */
  indices: Uint16Array | Uint32Array;
  capIndices: Uint16Array | Uint32Array | null;
}

function view<T extends ArrayBufferView>(buf: ArrayBuffer, base: number, meta: ModelMeta, name: SectionName, ctor: new (b: ArrayBuffer, o: number, n: number) => T, size: number): T | null {
  const s = meta.sections[name];
  return s ? new ctor(buf, base + s.offset, s.bytes / size) : null;
}

/**
 * Per vertex, the longest edge touching it in any LOD, in centimetres. Whether a wound is near is worked out per vertex
 * and interpolated, and on a big flat plate all three corners of a triangle can be far from a hole in its middle. A vertex
 * that adds this much to its reach can never miss one.
 */
function longestEdges(pos: Float32Array, lods: readonly (Uint16Array | Uint32Array)[]): Uint8Array {
  const out = new Uint8Array(pos.length / 3);
  const edge = (a: number, b: number) => {
    const cm = Math.min(255, Math.ceil(Math.hypot(pos[a * 3]! - pos[b * 3]!, pos[a * 3 + 1]! - pos[b * 3 + 1]!, pos[a * 3 + 2]! - pos[b * 3 + 2]!) * 100));
    if (cm > out[a]!) out[a] = cm;
    if (cm > out[b]!) out[b] = cm;
  };
  for (const index of lods) {
    for (let i = 0; i < index.length; i += 3) {
      edge(index[i]!, index[i + 1]!);
      edge(index[i + 1]!, index[i + 2]!);
      edge(index[i + 2]!, index[i]!);
    }
  }
  return out;
}

export function parseModel(buf: ArrayBuffer): LoadedModel {
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== MODEL_MAGIC) throw new Error('Not a character model file');
  const version = dv.getUint32(4, true);
  if (version !== MODEL_VERSION) throw new Error(`Model version ${version}, expected ${MODEL_VERSION}. Re-run tools/bake.`);
  const jsonBytes = dv.getUint32(8, true);
  const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 12, jsonBytes))) as ModelMeta;
  const base = 12 + jsonBytes;
  const u8 = (n: SectionName) => view(buf, base, meta, n, Uint8Array, 1);
  const position = new THREE.BufferAttribute(view(buf, base, meta, 'position', Float32Array, 4)!, 3);
  const normal = new THREE.BufferAttribute(view(buf, base, meta, 'normal', Int8Array, 1)!, 4, true);
  const aColor = new THREE.BufferAttribute(u8('color')!, 4, true);
  const aMat = new THREE.BufferAttribute(u8('material')!, 4, true);
  const uvData = view(buf, base, meta, 'uv', Uint16Array, 2);
  const uv = uvData ? new THREE.BufferAttribute(uvData, 2, true) : null;
  const si = u8('skinIndex');
  const sw = u8('skinWeight');
  const skinIndex = si ? new THREE.BufferAttribute(si, 4) : null;
  const skinWeight = sw ? new THREE.BufferAttribute(sw, 4, true) : null;
  const attributes = { position, normal, aColor, aMat, uv, skinIndex, skinWeight };

  const idx = (n: SectionName) => {
    const s = meta.sections[n];
    if (!s) return null;
    return meta.wideIndex ? new Uint32Array(buf, base + s.offset, s.bytes / 4) : new Uint16Array(buf, base + s.offset, s.bytes / 2);
  };
  const bounds = new THREE.Box3(new THREE.Vector3(...meta.bounds.min), new THREE.Vector3(...meta.bounds.max));
  const sphere = bounds.getBoundingSphere(new THREE.Sphere());
  let edge: THREE.BufferAttribute;
  const make = (index: Uint16Array | Uint32Array) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', position);
    g.setAttribute('normal', normal);
    g.setAttribute('aColor', aColor);
    g.setAttribute('aMat', aMat);
    if (uv) g.setAttribute('uv', uv);
    if (skinIndex) g.setAttribute('skinIndex', skinIndex);
    if (skinWeight) g.setAttribute('skinWeight', skinWeight);
    g.setIndex(new THREE.BufferAttribute(index, 1));
    g.setAttribute('aEdge', edge);
    g.boundingBox = bounds;
    g.boundingSphere = sphere;
    return g;
  };

  const lod0 = idx('lod0')!;
  const lodData: (Uint16Array | Uint32Array)[] = [lod0];
  for (const name of ['lod1', 'lod2'] as const) {
    const l = idx(name);
    if (l) lodData.push(l);
  }
  edge = new THREE.BufferAttribute(longestEdges(position.array as Float32Array, lodData), 1);
  const lods = lodData.map(l => make(l));
  const capIndices = idx('caps');
  const lodsWithCaps = capIndices?.length
    ? lodData.map(l => {
      const merged = meta.wideIndex ? new Uint32Array(l.length + capIndices.length) : new Uint16Array(l.length + capIndices.length);
      merged.set(l);
      merged.set(capIndices, l.length);
      return make(merged);
    })
    : lods;
  const chains = new Map<number, THREE.BufferGeometry>();
  const chainData = idx('chains');
  const capByBone = new Map<number, CapRef>();
  for (const c of meta.caps) {
    capByBone.set(c.bone, c);
    if (chainData) chains.set(c.bone, make(chainData.subarray(c.chainStart, c.chainStart + c.chainCount)));
  }
  return { meta, attributes, lods, lodsWithCaps, chains, capByBone, indices: lod0, capIndices };
}
