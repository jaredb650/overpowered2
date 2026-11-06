/**
 * Binary model format, shared by tools/bake (writer) and the runtime loader (reader).
 *
 *   u32 magic, u32 version, u32 jsonBytes, json (padded to 4), then the sections listed in meta.sections.
 *
 * Every section is 4-byte aligned, so the loader builds typed-array views straight over the fetched buffer.
 * Attributes are stored in the format the GPU reads, so there is no decode step at load time.
 */
export const MODEL_MAGIC = 0x32435030;
export const MODEL_VERSION = 3;

export type SectionName =
  | 'position' | 'normal' | 'color' | 'material' | 'uv' | 'skinIndex' | 'skinWeight'
  | 'lod0' | 'lod1' | 'lod2' | 'caps' | 'chains';

export interface SectionRef {
  offset: number;
  bytes: number;
}

export interface SkeletonBone {
  name: string;
  parent: number;
  /** Bind position in model space. Bind rotations are identity. */
  pos: readonly [number, number, number];
}

export interface CapRef {
  /** Rig bone at the joint: the first bone that comes off. */
  bone: number;
  /** Skeleton index of the cap shown on the body side. */
  parentCap: number;
  /** Skeleton index of the cap shown on the severed part. */
  childCap: number;
  /** Index range of this joint's caps inside the `caps` section. */
  start: number;
  count: number;
  /** Index range of this chain, including its child cap, inside the `chains` section. */
  chainStart: number;
  chainCount: number;
}

export interface Socket {
  bone: number;
  pos: readonly [number, number, number];
  /** Unit quaternion x, y, z, w. */
  rot: readonly [number, number, number, number];
}

export interface ModelMeta {
  id: string;
  kind: 'character' | 'prop';
  vertexCount: number;
  /** Rig bones come first, in rig order. Cap bones follow. Empty for props. */
  skeleton: SkeletonBone[];
  rigBoneCount: number;
  caps: CapRef[];
  sockets: Record<string, Socket>;
  sections: Partial<Record<SectionName, SectionRef>>;
  /** True when index sections are u32, false for u16. */
  wideIndex: boolean;
  bounds: { min: readonly [number, number, number]; max: readonly [number, number, number] };
  /** Texture atlases next to this file. Null when the model only has vertex colours. */
  atlas: { size: number; albedo: string; normal: string } | null;
  accent: readonly [number, number, number];
  triangles: number;
}

export interface Manifest {
  version: number;
  models: Record<string, { file: string; bytes: number; triangles: number; kind: 'character' | 'prop' }>;
}
