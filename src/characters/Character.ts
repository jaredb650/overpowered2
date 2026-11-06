/** One pooled skinned character, and the severed limbs it sheds. */
import * as THREE from 'three';
import type { CharacterInstance, SeveredLimb, WoundHit } from '../core/contracts';
import { HumanoidBone as H, type GoreRegion, type RigDef } from './rig';
import type { LoadedModel } from './model';
import { EXTRA_INFO, EXTRA_PARAMS, EXTRA_TEXELS, EXTRA_WOUNDS } from './anatomy/glsl';
import { FracturePose, type FractureStyle } from './anatomy/fracture';
import { newWoundSpec, WoundBook, WoundKind, WoundRegion, type WoundKindId } from './anatomy/wounds';
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
  /** The same skin with holes in it. Only for bodies that have some, because `discard` costs the whole draw. */
  woundMaterial: THREE.Material;
  /** Vertex-colour material for the far LOD. */
  farMaterial: THREE.Material;
  /** What is under the skin, shared by every body of this archetype. Null for machines, which get dents. */
  interior: THREE.BufferGeometry | null;
  interiorMaterial: THREE.Material | null;
  /** What an opened body casts its shadow with. */
  shadowMaterial: THREE.Material | null;
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
  spec.regions = woundRegions(a, boneIndex, hit.radius);
  const def = a.rig.bones[boneIndex]!;
  spec.limit = (def.hit?.radius ?? 0.06) * (boneIndex === H.head ? 0.8 : 1.5);
  if (hit.along && hit.length) {
    // Square to the axis, so the slot's two ends lie in one plane across the body.
    u.copy(hit.along).transformDirection(m).addScaledVector(n, -u.dot(n)).normalize().multiplyScalar(hit.length);
    spec.ax = v.x - u.x; spec.ay = v.y - u.y; spec.az = v.z - u.z;
    spec.bx = v.x + u.x; spec.by = v.y + u.y; spec.bz = v.z + u.z;
  } else {
    spec.ax = spec.bx = v.x;
    spec.ay = spec.by = v.y;
    spec.az = spec.bz = v.z;
  }
  book.add(spec);
}

interface AttachedProp {
  bone: number;
  object: THREE.Object3D;
}

/** A wound that takes nothing away, for callers that only know where it is. */
const paintDir = new THREE.Vector3();
const paint: WoundHit = { kind: WoundKind.graze, bone: 0, point: paintDir, dir: paintDir, radius: 0.05, depth: 0.03, ragged: 0.5 };

/** Past this LOD a body is too far off for anything but paint. */
const FAR_LOD = 2;

function makeInside(a: ArchetypeData, skeleton: THREE.Skeleton): THREE.SkinnedMesh {
  const inside = new THREE.SkinnedMesh(a.interior!, a.interiorMaterial!);
  // After the skin, so the depth test throws away almost every pixel of it before any shading runs.
  inside.renderOrder = 1;
  inside.castShadow = false;
  inside.receiveShadow = true;
  inside.bind(skeleton, new THREE.Matrix4());
  return inside;
}

function makeCaster(a: ArchetypeData, geometry: THREE.BufferGeometry, skeleton: THREE.Skeleton): THREE.SkinnedMesh {
  const caster = new THREE.SkinnedMesh(geometry, a.shadowMaterial!);
  caster.castShadow = true;
  caster.receiveShadow = false;
  caster.bind(skeleton, new THREE.Matrix4());
  return caster;
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
  private readonly breaks: FracturePose;
  /** Null until a wound opens this body. */
  inside: THREE.SkinnedMesh | null = null;
  private caster: THREE.SkinnedMesh | null = null;
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
      if (this.hidden[p.bone]) p.object.visible = false;
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

  /** Puts the body on the wounded program, with its inside if it has been opened. */
  private showWounds(): void {
    if (this.book.count === 0) return;
    if (this.mesh.material === this.a.material) this.mesh.material = this.a.woundMaterial;
    if (this.book.open === 0 || !this.a.interior) return;
    if (!this.inside) {
      this.inside = makeInside(this.a, this.skeleton);
      this.caster = makeCaster(this.a, this.a.model.lods[1]!, this.skeleton);
      Object.defineProperty(this.inside, 'boundingSphere', this.cullSphere);
      Object.defineProperty(this.caster, 'boundingSphere', this.cullSphere);
      this.root.add(this.inside, this.caster);
    }
    this.showInside(this.lod < FAR_LOD);
  }

  private showInside(on: boolean): void {
    this.inside!.visible = on;
    this.caster!.visible = on;
    this.mesh.castShadow = !on;
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

  /** Whether anything has been opened, for callers that want to know what a hit left. */
  get woundCount(): number {
    return this.book.count;
  }

  /** The material to give a world-space copy of this body. The wounded one only works on a skeleton. */
  get skinMaterial(): THREE.Material {
    return this.a.material;
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
    this.mesh.material = i >= FAR_LOD ? this.a.farMaterial : this.book.count > 0 ? this.a.woundMaterial : this.a.material;
    if (this.inside) this.showInside(i < FAR_LOD && this.book.open > 0);
  }

  spawnSevered(boneIndex: number): SeveredLimb {
    const part = this.a.acquireLimb();
    part.pose(this, boneIndex);
    if (this.root.parent) this.root.parent.add(part.root);
    return part;
  }

  /** Copies this instance's surface state onto a severed part, so wounds and burn follow the limb. */
  copySurfaceTo(dst: Float32Array, dstOffset: number, book: WoundBook): void {
    dst.set(this.data.subarray(this.extras, this.extras + EXTRA_TEXELS * 4), dstOffset);
    book.adopt(this.book);
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
    this.book.clear();
    this.breaks.reset();
    this.stress.fill(0);
    if (this.inside) this.showInside(false);
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
  private readonly book: WoundBook;
  private inside: THREE.SkinnedMesh | null = null;
  private caster: THREE.SkinnedMesh | null = null;
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
    this.book = new WoundBook(this.data, this.extras + EXTRA_WOUNDS * 4, count => {
      this.data[this.extras + EXTRA_INFO * 4] = count;
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
    if (this.book.count === 0) return;
    this.mesh.material = this.a.woundMaterial;
    if (this.book.open === 0 || !this.a.interior) return;
    if (!this.inside) {
      this.inside = makeInside(this.a, this.skeleton);
      this.caster = makeCaster(this.a, this.mesh.geometry, this.skeleton);
      this.inside.frustumCulled = false;
      this.caster.frustumCulled = false;
      this.root.add(this.inside, this.caster);
    }
    this.caster!.geometry = this.mesh.geometry;
    this.showInside(true);
  }

  private showInside(on: boolean): void {
    this.inside!.visible = on;
    this.caster!.visible = on;
    this.mesh.castShadow = !on;
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

    src.copySurfaceTo(this.data, this.extras, this.book);
    // A limb has nothing fading its flash, so a value copied mid-hit would stay lit for good.
    this.data[this.extras + EXTRA_PARAMS * 4 + 1] = 0;
    this.showWounds();
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
    this.book.clear();
    this.mesh.material = this.a.material;
    if (this.inside) this.showInside(false);
    this.root.removeFromParent();
    this.releaseHook?.(this);
  }
}
