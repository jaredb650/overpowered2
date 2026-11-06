/**
 * A CharacterInstance made of one capsule per bone. It exists so gore can be developed and unit tested
 * against the rig contract alone, and so the raycast tests have exact geometry to compare against.
 */
import * as THREE from 'three';
import type {
  AnimAction, CharacterAnimation, CharacterInstance, LocomotionInput, SeveredLimb, WoundHit,
} from '../core/contracts';
import type { GoreRegion, RigDef } from '../characters/rig';
import { rigInfo, markSubtree, MAX_BONES } from './rigInfo';

const SKIN = 0xb9a08e;
const CLOTH = 0x39424f;
const STUMP = 0x8a0d0d;

/** Local pose as quaternions per bone, plus a walk cycle. Enough to give ragdolls real seed velocity. */
class DummyAnimation implements CharacterAnimation {
  private phase = 0;
  private speed = 0;
  private readonly q = new THREE.Quaternion();
  private readonly axis = new THREE.Vector3(1, 0, 0);

  constructor(private readonly bones: readonly THREE.Bone[], private readonly rig: RigDef) {}

  setLocomotion(input: LocomotionInput): void {
    this.speed = input.speed;
  }

  play(_action: AnimAction): number {
    return 0.5;
  }

  flinch(): void {}

  update(dt: number): void {
    this.phase += dt * (2 + this.speed * 2.2);
    const swing = Math.min(1, this.speed / 5);
    const names = this.rig.bones;
    for (let i = 0; i < names.length; i++) {
      const name = names[i]!.name;
      const leftSide = name.endsWith('L');
      const s = Math.sin(this.phase + (leftSide ? 0 : Math.PI));
      if (name.startsWith('thigh')) {
        this.bones[i]!.quaternion.setFromAxisAngle(this.axis, -s * 0.7 * swing);
      } else if (name.startsWith('shin')) {
        this.bones[i]!.quaternion.setFromAxisAngle(this.axis, Math.max(0, -Math.cos(this.phase + (leftSide ? 0 : Math.PI))) * 1.1 * swing + 0.05);
      } else if (name.startsWith('upperArm')) {
        this.bones[i]!.quaternion.setFromAxisAngle(this.axis, s * 0.5 * swing);
      } else if (name.startsWith('foreArm')) {
        this.bones[i]!.quaternion.setFromAxisAngle(this.axis, -0.5 - 0.3 * swing);
      } else if (name === 'chest') {
        this.q.setFromAxisAngle(this.axis, 0.08 * swing + 0.02 * Math.sin(this.phase * 0.5));
        this.bones[i]!.quaternion.copy(this.q);
      }
    }
  }
}

function capsuleFor(from: THREE.Vector3, to: THREE.Vector3, radius: number): THREE.BufferGeometry {
  const len = from.distanceTo(to);
  const g = new THREE.CapsuleGeometry(radius, len, 5, 12);
  const dir = to.clone().sub(from);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), len > 1e-5 ? dir.normalize() : new THREE.Vector3(0, 1, 0));
  g.applyQuaternion(q);
  g.translate((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2);
  return g;
}

interface BakedDummy {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}

const baked = new WeakMap<RigDef, BakedDummy>();

function bake(rig: RigDef): BakedDummy {
  const existing = baked.get(rig);
  if (existing) return existing;
  const world: THREE.Vector3[] = [];
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const skinIndex: number[] = [];
  const skinWeight: number[] = [];
  const indices: number[] = [];
  const skin = new THREE.Color(SKIN);
  const cloth = new THREE.Color(CLOTH);
  rig.bones.forEach((b, i) => {
    const w = new THREE.Vector3(b.offset[0], b.offset[1], b.offset[2]);
    if (b.parent >= 0) w.add(world[b.parent]!);
    world[i] = w;
    if (!b.hit) return;
    const g = capsuleFor(
      w.clone().add(new THREE.Vector3(...b.hit.from)),
      w.clone().add(new THREE.Vector3(...b.hit.to)),
      b.hit.radius,
    );
    const base = positions.length / 3;
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    const u = g.getAttribute('uv');
    const bare = b.region === 'head' || b.name.startsWith('foreArm') || b.name.startsWith('hand');
    const c = bare ? skin : cloth;
    for (let v = 0; v < p.count; v++) {
      positions.push(p.getX(v), p.getY(v), p.getZ(v));
      normals.push(n.getX(v), n.getY(v), n.getZ(v));
      uvs.push(u.getX(v), u.getY(v));
      colors.push(c.r, c.g, c.b);
      skinIndex.push(i, 0, 0, 0);
      skinWeight.push(1, 0, 0, 0);
    }
    const idx = g.getIndex()!;
    for (let k = 0; k < idx.count; k++) indices.push(base + idx.getX(k));
    g.dispose();
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
  geometry.setIndex(indices);
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 });
  const out = { geometry, material };
  baked.set(rig, out);
  return out;
}

function makeBones(rig: RigDef, parentOf: (index: number) => THREE.Object3D | null): THREE.Bone[] {
  const bones: THREE.Bone[] = [];
  rig.bones.forEach((b, i) => {
    const bone = new THREE.Bone();
    bone.name = b.name;
    bone.position.set(b.offset[0], b.offset[1], b.offset[2]);
    const parent = parentOf(i);
    (parent ?? bones[b.parent]!).add(bone);
    bones[i] = bone;
  });
  return bones;
}

const stumpGeometry = new THREE.SphereGeometry(1, 8, 6);
const stumpMaterial = new THREE.MeshStandardMaterial({ color: STUMP, roughness: 0.35 });

export class TestDummy implements CharacterInstance {
  readonly archetype: string;
  readonly root = new THREE.Group();
  readonly bones: THREE.Bone[];
  readonly mesh: THREE.SkinnedMesh;
  readonly anim: CharacterAnimation;
  readonly severed = new Set<GoreRegion>();
  private readonly skeleton: THREE.Skeleton;
  private readonly caps: THREE.Mesh[] = [];
  private readonly hidden = new Uint8Array(MAX_BONES);

  constructor(readonly rig: RigDef) {
    this.archetype = rig.id;
    const { geometry, material } = bake(rig);
    this.bones = makeBones(rig, i => (rig.bones[i]!.parent < 0 ? this.root : null));
    this.mesh = new THREE.SkinnedMesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.skeleton = new THREE.Skeleton(this.bones);
    this.root.add(this.mesh);
    this.root.updateMatrixWorld(true);
    this.mesh.bind(this.skeleton, new THREE.Matrix4());
    this.anim = new DummyAnimation(this.bones, rig);
  }

  hideLimb(boneIndex: number): void {
    const info = rigInfo(this.rig);
    const mask = new Uint8Array(MAX_BONES);
    markSubtree(info, boneIndex, mask);
    for (let i = 0; i < info.count; i++) {
      if (mask[i] === 1) {
        this.hidden[i] = 1;
        this.severed.add(this.rig.bones[i]!.region);
      }
    }
    // Collapsing the bone folds its whole subtree into the joint, which the cap then covers.
    this.bones[boneIndex]!.scale.setScalar(1e-5);
    const def = this.rig.bones[boneIndex]!;
    const cap = new THREE.Mesh(stumpGeometry, stumpMaterial);
    cap.scale.setScalar((def.hit?.radius ?? 0.06) * 0.95);
    cap.position.set(def.offset[0], def.offset[1], def.offset[2]);
    this.bones[def.parent]!.add(cap);
    this.caps.push(cap);
  }

  addWound(): void {}
  wound(_hit: WoundHit): void {}
  readonly stress = new Float32Array(MAX_BONES);
  private readonly broken = new Set<number>();
  fracture(bone: number, _style?: 'hyper' | 'limp', _skew?: number): boolean {
    if (this.broken.has(bone)) return false;
    this.broken.add(bone);
    return true;
  }
  isFractured(bone: number): boolean {
    return this.broken.has(bone);
  }
  get skinMaterial(): THREE.Material {
    return this.mesh.material as THREE.Material;
  }
  setBloodiness(): void {}
  hitFlash(): void {}

  attachProp(boneIndex: number, prop: THREE.Object3D): void {
    this.bones[boneIndex]!.add(prop);
  }

  spawnSevered(boneIndex: number): SeveredLimb {
    const info = rigInfo(this.rig);
    const mask = new Uint8Array(MAX_BONES);
    markSubtree(info, boneIndex, mask);
    this.root.updateMatrixWorld(true);
    const root = new THREE.Group();
    const scene = this.root.parent;
    if (scene) scene.add(root);
    // Bones outside the chain hang off the root with zero scale, so their vertices vanish.
    const bones = makeBones(this.rig, i => (i === boneIndex || mask[i] === 0 ? root : null));
    for (let i = 0; i < info.count; i++) {
      const src = this.bones[i]!;
      const dst = bones[i]!;
      if (mask[i] === 1 && i !== boneIndex) {
        dst.quaternion.copy(src.quaternion);
        dst.position.copy(src.position);
      } else if (i === boneIndex) {
        src.matrixWorld.decompose(dst.position, dst.quaternion, new THREE.Vector3());
      } else {
        dst.scale.setScalar(1e-5);
      }
    }
    const { geometry, material } = bake(this.rig);
    const mesh = new THREE.SkinnedMesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    root.add(mesh);
    const skeleton = new THREE.Skeleton(bones, this.skeleton.boneInverses);
    mesh.bind(skeleton, new THREE.Matrix4());
    const cap = new THREE.Mesh(stumpGeometry, stumpMaterial);
    cap.scale.setScalar((this.rig.bones[boneIndex]!.hit?.radius ?? 0.06) * 0.95);
    bones[boneIndex]!.add(cap);
    root.updateMatrixWorld(true);
    return {
      root,
      mesh,
      bones,
      wound: () => {},
      isFractured: () => false,
      release: () => {
        root.removeFromParent();
        skeleton.dispose();
      },
    };
  }

  bakePose(): THREE.BufferGeometry {
    const { geometry } = bake(this.rig);
    this.root.updateMatrixWorld(true);
    this.skeleton.update();
    const src = geometry.getAttribute('position');
    const nrm = geometry.getAttribute('normal');
    const uv = geometry.getAttribute('uv');
    const col = geometry.getAttribute('color');
    const si = geometry.getAttribute('skinIndex');
    const index = geometry.getIndex()!;
    const pos = new Float32Array(src.count * 3);
    const nor = new Float32Array(src.count * 3);
    const m = new THREE.Matrix4();
    const n3 = new THREE.Matrix3();
    const v = new THREE.Vector3();
    const live = new Uint8Array(src.count);
    for (let i = 0; i < src.count; i++) {
      const b = si.getX(i);
      live[i] = this.hidden[b] === 1 ? 0 : 1;
      m.multiplyMatrices(this.bones[b]!.matrixWorld, this.skeleton.boneInverses[b]!);
      v.fromBufferAttribute(src, i).applyMatrix4(m);
      pos.set([v.x, v.y, v.z], i * 3);
      n3.getNormalMatrix(m);
      v.fromBufferAttribute(nrm, i).applyMatrix3(n3).normalize();
      nor.set([v.x, v.y, v.z], i * 3);
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('uv', new THREE.BufferAttribute((uv.array as Float32Array).slice(), 2));
    out.setAttribute('color', new THREE.BufferAttribute((col.array as Float32Array).slice(), 3));
    const keep: number[] = [];
    for (let i = 0; i < index.count; i += 3) {
      const a = index.getX(i);
      const b = index.getX(i + 1);
      const c = index.getX(i + 2);
      if (live[a] && live[b] && live[c]) keep.push(a, b, c);
    }
    out.setIndex(keep);
    return out;
  }

  release(): void {
    this.root.removeFromParent();
    this.skeleton.dispose();
    for (const cap of this.caps) cap.removeFromParent();
    this.caps.length = 0;
  }
}
