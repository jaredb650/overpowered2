/**
 * The sword's signature. A slice replaces the character with two rigid meshes cut by the swing plane.
 * For a moment nothing moves, then the top slides off along the cut. That small delay is the whole effect.
 */
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { CG, type CharacterInstance, type Ctx, type DamageInfo, type EmitterHandle } from '../core/contracts';
import { groups } from '../physics/Physics';
import { rand } from '../core/math';
import type { BloodField } from './blood';
import type { ImpactEvents } from './impacts';
import { cutMesh, weldTable, type BoneCrossing, type CutSide } from './cut';
import { rigInfo } from './rigInfo';

export const SliceTuning = {
  /** Half pairs kept. Past this the oldest sinks. */
  maxHalves: 12,
  /** Seconds the two halves hang together before the upper one lets go. */
  holdSeconds: 0.14,
  /** Speed along the cut once it lets go, m/s. */
  slideSpeed: 1.9,
  /** Speed apart across the cut, m/s. */
  partSpeed: 0.55,
  /** Share of gravity during the hold. */
  holdGravity: 0.12,
  calmSpeed: 0.3,
  settle: 0.5,
  maxSimTime: 7,
  sinkSeconds: 2.2,
  density: 900,
};

export class Half {
  body: RAPIER.RigidBody | null = null;
  emitter: EmitterHandle | null = null;
  calm = 0;
  age = 0;
  releaseAt = 0;
  sinking = -1;
  pooled = false;
  speed = 0;
  /** World time this half may next be heard landing. */
  nextThud = 0;
  readonly slide = new THREE.Vector3();
  readonly p = new THREE.Vector3();
  readonly q = new THREE.Quaternion();
  readonly v = new THREE.Vector3();
  constructor(readonly mesh: THREE.Mesh, readonly side: CutSide) {}
}

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
const _inv = new THREE.Quaternion();

/** Pale fibres on grey. Vertex colour supplies the hue, so one texture serves muscle, fat and bone. */
function fleshTexture(): THREE.CanvasTexture {
  const n = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = n;
  const c = canvas.getContext('2d')!;
  c.fillStyle = '#b8b8b8';
  c.fillRect(0, 0, n, n);
  for (let i = 0; i < 900; i++) {
    const x = Math.random() * n;
    const y = Math.random() * n;
    const a = 0.4 + (Math.random() - 0.5) * 0.7;
    const l = 10 + Math.random() * 34;
    const b = Math.random() < 0.6 ? 80 + Math.random() * 60 : 215 + Math.random() * 40;
    c.strokeStyle = `rgba(${b},${b},${b},0.5)`;
    c.lineWidth = 0.6 + Math.random() * 2;
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    c.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class SliceField {
  private halves: Half[] = [];
  private capMaterial: THREE.Material | null = null;
  private readonly welds = new WeakMap<object, Int32Array>();
  lastDistance = 0;
  /** Cost of the last cut in milliseconds, excluding the character's own bakePose. */
  lastCutMs = 0;

  constructor(private readonly ctx: Ctx, private readonly blood: BloodField, private readonly impacts: ImpactEvents) {}

  get count(): number {
    return this.halves.length;
  }

  private cap(): THREE.Material {
    if (this.capMaterial) return this.capMaterial;
    const m = new THREE.MeshPhysicalMaterial({
      map: fleshTexture(), vertexColors: true, roughness: 0.28, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.3,
    });
    this.capMaterial = this.ctx.render.materials?.patch ? this.ctx.render.materials.patch(m) ?? m : m;
    return this.capMaterial;
  }

  /** Bone discs for every bone that crosses the plane. */
  private crossings(char: CharacterInstance, point: THREE.Vector3, normal: THREE.Vector3): BoneCrossing[] {
    const out: BoneCrossing[] = [];
    const info = rigInfo(char.rig);
    const defs = char.rig.bones;
    for (let i = 0; i < info.count; i++) {
      const kids = info.children[i]!;
      const r = (defs[i]!.hit?.radius ?? 0) * 0.34;
      if (r <= 0 || char.severed.has(defs[i]!.region)) continue;
      _v.setFromMatrixPosition(char.bones[i]!.matrixWorld);
      const a = _v2.copy(_v).sub(point).dot(normal);
      for (const k of kids) {
        _o.setFromMatrixPosition(char.bones[k]!.matrixWorld);
        const b = _d.copy(_o).sub(point).dot(normal);
        if (a > 0 === b > 0) continue;
        const t = a / (a - b);
        out.push({
          x: _v.x + (_o.x - _v.x) * t, y: _v.y + (_o.y - _v.y) * t, z: _v.z + (_o.z - _v.z) * t, radius: r,
        });
      }
    }
    return out;
  }

  cut(char: CharacterInstance, point: THREE.Vector3, normal: THREE.Vector3, damage: DamageInfo): void {
    const { fx } = this.ctx;
    const geometry = char.bakePose();
    const n = _v.copy(normal).normalize().clone();
    let weld = this.welds.get(char.rig);
    if (!weld || weld.length !== geometry.getAttribute('position').count) {
      weld = weldTable(geometry);
      this.welds.set(char.rig, weld);
    }
    const started = performance.now();
    let result = cutMesh(geometry, point, n, this.crossings(char, point, n), weld);
    if (result.above.length === 0 || result.below.length === 0) {
      // The swing plane missed the mesh. A sword kill must still cut, so move the plane onto the body.
      const hips = _o.setFromMatrixPosition(char.bones[0]!.matrixWorld).clone();
      hips.y += char.rig.height * 0.1;
      result = cutMesh(geometry, hips, n, this.crossings(char, hips, n), weld);
    }
    this.lastCutMs = performance.now() - started;
    geometry.dispose();
    if (result.above.length === 0 || result.below.length === 0) return;

    // Which way the upper piece slides: downhill along the plane, or with the blade on a flat cut.
    const slide = _v2.set(0, -1, 0).addScaledVector(n, n.y);
    if (slide.lengthSq() < 0.02) slide.copy(damage.dir).addScaledVector(n, -damage.dir.dot(n));
    if (slide.lengthSq() < 1e-4) slide.set(1, 0, 0);
    slide.normalize();
    const aboveIsUpper = result.above[0]!.origin.y >= result.below[0]!.origin.y;

    const skin = char.skinMaterial;
    result.above.forEach((side, i) => this.spawn(side, skin, slide, n, 1, damage, aboveIsUpper && i === 0));
    result.below.forEach((side, i) => this.spawn(side, skin, slide, n, -1, damage, !aboveIsUpper && i === 0));

    const at = _o.copy(point);
    fx.bloodJet(at, _d.copy(damage.dir), 0.5);
    this.blood.splatterAlong(at, damage.dir, 8, 7, 0.6);
    this.blood.spray(at, damage.dir, 10, 9, 0.5, 0.12);
    this.enforce();
  }

  private spawn(side: CutSide, skin: THREE.Material, slide: THREE.Vector3, n: THREE.Vector3, sign: number, damage: DamageInfo, upper: boolean): void {
    const { R, world } = this.ctx.physics;
    const mesh = new THREE.Mesh(side.geometry, [skin, this.cap()]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.copy(side.origin);
    side.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), side.max.length());
    this.ctx.render.scene.add(mesh);

    const body = world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(side.origin.x, side.origin.y, side.origin.z)
        .setGravityScale(SliceTuning.holdGravity)
        .setLinearDamping(0.1)
        .setAngularDamping(0.6),
    );
    const collider = R.ColliderDesc.convexHull(side.hull)
      ?? R.ColliderDesc.cuboid(side.max.x, side.max.y, side.max.z);
    world.createCollider(
      collider
        .setDensity(SliceTuning.density)
        .setFriction(0.7)
        .setRestitution(0.03)
        .setCollisionGroups(groups(CG.Ragdoll, CG.World | CG.Ragdoll | CG.Gib)),
      body,
    );
    const half = new Half(mesh, side);
    half.body = body;
    half.releaseAt = this.ctx.time.elapsed + SliceTuning.holdSeconds;
    if (upper) half.slide.copy(slide).multiplyScalar(SliceTuning.slideSpeed);
    half.slide.addScaledVector(n, sign * SliceTuning.partSpeed);
    half.slide.addScaledVector(damage.dir, 0.4);
    half.emitter = this.ctx.fx.attachEmitter(mesh, 'stumpSpray', side.capCenter, 3.5) ?? null;
    this.halves.push(half);
  }

  private enforce(): void {
    let live = 0;
    for (const h of this.halves) if (h.sinking < 0) live++;
    for (let i = 0; i < this.halves.length && live > SliceTuning.maxHalves; i++) {
      const h = this.halves[i]!;
      if (h.sinking >= 0) continue;
      this.freeze(h);
      h.sinking = this.ctx.time.elapsed;
      live--;
    }
  }

  private freeze(h: Half): void {
    if (h.body) this.ctx.physics.world.removeRigidBody(h.body);
    h.body = null;
    h.emitter?.stop();
    h.emitter = null;
    if (!h.pooled) {
      h.pooled = true;
      this.blood.pool(h.mesh.position, rand(1.1, 1.7), 3.5);
    }
  }

  update(dt: number): void {
    const now = this.ctx.time.elapsed;
    const t = SliceTuning;
    for (let i = this.halves.length - 1; i >= 0; i--) {
      const h = this.halves[i]!;
      if (h.sinking >= 0) {
        const k = (now - h.sinking) / t.sinkSeconds;
        if (k >= 1) {
          this.remove(h);
          this.halves.splice(i, 1);
        } else {
          h.mesh.position.y -= dt * 0.5;
        }
        continue;
      }
      const body = h.body;
      if (!body) continue;
      if (h.releaseAt > 0 && now >= h.releaseAt) {
        h.releaseAt = 0;
        body.setGravityScale(1, true);
        body.setLinvel(h.slide, true);
      }
      body.translation(h.p);
      body.rotation(h.q);
      body.linvel(h.v);
      const speed = h.v.length();
      h.nextThud = this.impacts.land('body', h.speed - speed, h.speed, h.p, h.nextThud);
      h.speed = speed;
      h.mesh.position.copy(h.p);
      h.mesh.quaternion.copy(h.q);
      h.age += dt;
      if (h.v.lengthSq() < t.calmSpeed * t.calmSpeed && h.releaseAt === 0) h.calm += dt;
      else h.calm = 0;
      if (h.calm > t.settle || h.age > t.maxSimTime) this.freeze(h);
    }
  }

  private remove(h: Half): void {
    this.freeze(h);
    h.mesh.removeFromParent();
    h.side.geometry.dispose();
  }

  /** Ray against each half's local bounding box. Halves are too irregular to bother with more. */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, point: THREE.Vector3, normal: THREE.Vector3): Half | null {
    let best = maxDist;
    let found: Half | null = null;
    for (let i = 0; i < this.halves.length; i++) {
      const h = this.halves[i]!;
      if (h.sinking >= 0) continue;
      _inv.copy(h.mesh.quaternion).conjugate();
      _o.copy(origin).sub(h.mesh.position).applyQuaternion(_inv);
      _d.copy(dir).applyQuaternion(_inv);
      const t = slab(_o, _d, h.side.min, h.side.max);
      if (t >= 0 && t < best) {
        best = t;
        found = h;
      }
    }
    if (found) {
      this.lastDistance = best;
      point.copy(origin).addScaledVector(dir, best);
      normal.copy(dir).negate();
    }
    return found;
  }

  private wake(h: Half): void {
    if (h.body || h.sinking >= 0) return;
    const { R, world } = this.ctx.physics;
    const body = world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(h.mesh.position.x, h.mesh.position.y, h.mesh.position.z)
        .setRotation(h.mesh.quaternion)
        .setLinearDamping(0.1)
        .setAngularDamping(0.6),
    );
    const collider = R.ColliderDesc.convexHull(h.side.hull)
      ?? R.ColliderDesc.cuboid(h.side.max.x, h.side.max.y, h.side.max.z);
    world.createCollider(
      collider.setDensity(SliceTuning.density).setFriction(0.7).setRestitution(0.03)
        .setCollisionGroups(groups(CG.Ragdoll, CG.World | CG.Ragdoll | CG.Gib)),
      body,
    );
    h.body = body;
    h.age = 0;
    h.calm = 0;
  }

  damage(handle: unknown, point: THREE.Vector3, impulse: THREE.Vector3): void {
    if (!(handle instanceof Half)) return;
    this.wake(handle);
    handle.body?.applyImpulseAtPoint(impulse, point, true);
  }

  pin(handle: unknown, point: THREE.Vector3, anchor: THREE.Vector3): void {
    if (!(handle instanceof Half)) return;
    this.wake(handle);
    const body = handle.body;
    if (!body) return;
    const { R, world, anchorBody } = this.ctx.physics;
    const local = _v.copy(point).sub(handle.mesh.position).applyQuaternion(_inv.copy(handle.mesh.quaternion).conjugate());
    world.createImpulseJoint(R.JointData.spherical(local, anchor), body, anchorBody, true);
  }

  clear(): void {
    for (const h of this.halves) this.remove(h);
    this.halves = [];
  }
}

function slab(o: THREE.Vector3, d: THREE.Vector3, min: THREE.Vector3, max: THREE.Vector3): number {
  let lo = 0;
  let hi = Infinity;
  for (const axis of ['x', 'y', 'z'] as const) {
    const inv = 1 / d[axis];
    let a = (min[axis] - o[axis]) * inv;
    let b = (max[axis] - o[axis]) * inv;
    if (a > b) [a, b] = [b, a];
    if (a > lo) lo = a;
    if (b < hi) hi = b;
    if (lo > hi) return -1;
  }
  return lo;
}
