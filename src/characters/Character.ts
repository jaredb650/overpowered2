/** One pooled skinned character, and the severed limbs it sheds. */
import * as THREE from 'three';
import type { CharacterInstance, SeveredLimb } from '../core/contracts';
import type { GoreRegion, RigDef } from './rig';
import type { LoadedModel } from './model';
import { EXTRA_INFO, EXTRA_PARAMS, EXTRA_TEXELS, EXTRA_WOUNDS, MAX_WOUNDS } from './material';
import { createAnimator, type PooledAnimation } from './animation/index';
import type { ArchetypeDef } from './archetypes';

/** Near-zero rather than zero, so decomposing a collapsed bone's matrix stays finite. */
export const COLLAPSED = 1e-5;
/** Hit flash intensity lost per second of world time. */
const FLASH_DECAY = 7;

export interface ArchetypeData {
  id: string;
  def: ArchetypeDef;
  rig: RigDef;
  model: LoadedModel;
  material: THREE.Material;
  /** Vertex-colour material for the far LOD. */
  farMaterial: THREE.Material;
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
  const texels = bones.length * 4 + EXTRA_TEXELS;
  const size = Math.max(4, Math.ceil(Math.sqrt(texels) / 4) * 4);
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

interface AttachedProp {
  bone: number;
  object: THREE.Object3D;
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
  private woundCount = 0;
  private woundCursor = 0;

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
    Object.defineProperty(mesh, 'boundingSphere', {
      configurable: true,
      get: () => {
        const h = hips.matrixWorld.elements, w = mesh.matrixWorld.elements;
        const dx = h[12]! - w[12]!, dy = h[13]! - w[13]!, dz = h[14]! - w[14]!;
        // Into mesh space. The root never scales, so the transpose is the inverse.
        sphere.center.set(dx * w[0]! + dy * w[1]! + dz * w[2]!, dx * w[4]! + dy * w[5]! + dz * w[6]!, dx * w[8]! + dy * w[9]! + dz * w[10]!);
        return sphere;
      },
    });
    this.hidden = new Uint8Array(this.allBones.length);
    this.data[this.extras + EXTRA_INFO * 4 + 1] = Math.random() * 64;
    this.anim = createAnimator(a.def, this);
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
      if (this.hidden[p.bone]) p.object.visible = false;
    }
  }

  isHidden(boneIndex: number): boolean {
    return this.hidden[boneIndex] === 1;
  }

  addWound(boneIndex: number, worldPoint: THREE.Vector3, radius: number): void {
    const bone = this.bones[boneIndex];
    if (!bone) return;
    // World to bone local, then bone local to bind space: bind rotations are identity, so that is one add.
    bone.updateWorldMatrix(true, false);
    v.copy(worldPoint).applyMatrix4(m.copy(bone.matrixWorld).invert()).add(this.a.bindPositions[boneIndex]!);
    const o = this.extras + (EXTRA_WOUNDS + this.woundCursor) * 4;
    this.data[o] = v.x; this.data[o + 1] = v.y; this.data[o + 2] = v.z; this.data[o + 3] = radius;
    this.woundCursor = (this.woundCursor + 1) % MAX_WOUNDS;
    this.woundCount = Math.min(MAX_WOUNDS, this.woundCount + 1);
    this.data[this.extras + EXTRA_INFO * 4] = this.woundCount;
  }

  setBloodiness(amount: number): void {
    this.data[this.extras + EXTRA_PARAMS * 4] = amount;
  }

  hitFlash(intensity: number): void {
    const now = this.a.time.elapsed;
    this.flash = Math.max(this.flash - (now - this.flashAt) * FLASH_DECAY, intensity);
    this.flashAt = now;
    this.data[this.extras + EXTRA_PARAMS * 4 + 1] = this.flash;
  }

  /** 0..1 char from fire. Embers crawl across as it rises. */
  setBurn(amount: number): void {
    this.data[this.extras + EXTRA_PARAMS * 4 + 2] = amount;
  }

  /** 0..1 ice coverage, for Frost Nova. */
  setFrost(amount: number): void {
    this.data[this.extras + EXTRA_PARAMS * 4 + 3] = amount;
  }

  attachProp(boneIndex: number, prop: THREE.Object3D): void {
    this.bones[boneIndex]!.add(prop);
    this.props.push({ bone: boneIndex, object: prop });
    prop.visible = !this.hidden[boneIndex];
  }

  setLod(level: number, force = false): void {
    if (level === this.lod && !force) return;
    this.lod = level;
    const set = this.activeCaps.size ? this.a.model.lodsWithCaps : this.a.model.lods;
    const i = Math.min(level, set.length - 1);
    this.mesh.geometry = set[i]!;
    // The last LOD indexes welded vertices, so its UVs are meaningless and it paints from vertex colour.
    this.mesh.material = i >= 2 ? this.a.farMaterial : this.a.material;
  }

  spawnSevered(boneIndex: number): SeveredLimb {
    const part = this.a.acquireLimb();
    part.pose(this, boneIndex);
    if (this.root.parent) this.root.parent.add(part.root);
    return part;
  }

  /** Copies this instance's surface state onto a severed part, so wounds and burn follow the limb. */
  copySurfaceTo(dst: Float32Array, dstOffset: number): void {
    dst.set(this.data.subarray(this.extras, this.extras + EXTRA_TEXELS * 4), dstOffset);
  }

  bakePose(): THREE.BufferGeometry {
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
    const bm = this.skeleton.boneMatrices as Float32Array;
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
    this.severed.clear();
    this.flash = 0;
    this.woundCount = 0;
    this.woundCursor = 0;
    this.data.fill(0, this.extras, this.extras + EXTRA_TEXELS * 4);
    this.data[this.extras + EXTRA_INFO * 4 + 1] = Math.random() * 64;
    for (const p of this.props) p.object.visible = true;
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
  private clones: THREE.Object3D[] = [];

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

    src.copySurfaceTo(this.data, this.extras);
    for (const p of src.props) {
      if (!chain[p.bone]) continue;
      // A clone, because the limb can outlive the instance that shed it.
      const clone = p.object.clone();
      clone.visible = true;
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
    this.root.removeFromParent();
    this.releaseHook?.(this);
  }
}
