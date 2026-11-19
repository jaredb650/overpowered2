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
import { RagTuning } from './rag';
import { rigInfo } from './rigInfo';
import { sear, type Sear } from './sear';
import { TrailTuning, type GibTrail, type Ribbon } from './trail';
import { burnTint, FireTuning, type BurningPiece } from './fire';
import { cookable } from './cooked';

export const SliceTuning = {
  /**
   * Halves and broken trunk pieces kept (torso.ts). Past this the oldest sinks, but only once it has lain `minShown`
   * seconds: a crowd blown up in one go keeps every piece in sight a while. Past `hardCap` the oldest go whatever.
   */
  maxHalves: 28,
  minShown: 8,
  hardCap: 44,
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
  /**
   * A vaporizing cut's halves (the energy blade, DamageInfo.vaporize): they fall apart as any halves do, then once `lift` of
   * their time has gone they float up as the Lance's vaporized bodies do (VaporTuning's lift and drag), and are ash at the end
   * of `seconds`: long enough that the cut reads first. An ember and a spark every `ashEvery`.
   */
  vapor: { seconds: [1.1, 1.4] as const, lift: 0.3, gravity: -0.03, drag: 1.3, rise: 0.6, ashEvery: 0.09 },
};
const _up = new THREE.Vector3(0, 1, 0);
const _tint = new THREE.Color();
const IDENTITY = new THREE.Matrix4();

/** A half or a trunk piece. It can burn (`BurningPiece`: gore/fire.ts), drawn charred by its instance colour. */
export class Half implements BurningPiece {
  body: RAPIER.RigidBody | null = null;
  emitter: EmitterHandle | null = null;
  calm = 0;
  age = 0;
  releaseAt = 0;
  sinking = -1;
  pooled = false;
  born = 0;
  /** A trunk piece's geometry belongs to its archetype's kit, so it is never disposed with the piece. */
  shared = false;
  speed = 0;
  /** World time this half may next be heard landing. */
  nextThud = 0;
  /** A thrown trunk piece: the ribbon of blood it trails from its torn face while it flies (trail.ts). */
  ribbon: Ribbon | null = null;
  /** Burning away (a vaporizing cut): when it started, how long it takes, its materials, whether it has lifted, the next spark. */
  vapor = -1;
  vaporFor = 0;
  sear: Sear | null = null;
  lifted = false;
  ashAt = 0;
  readonly slide = new THREE.Vector3();
  readonly p = new THREE.Vector3();
  readonly q = new THREE.Quaternion();
  readonly v = new THREE.Vector3();
  /** 0..1 char: the body's when it was cut, and on from there if it is burning. */
  burn = 0;
  /** A piece of a machine's hull: it sparks, and has no blood in it. */
  scrap = false;
  constructor(readonly mesh: THREE.Mesh, readonly side: CutSide) {}

  get root(): THREE.Object3D {
    return this.mesh;
  }
  get min(): THREE.Vector3 {
    return this.side.min;
  }
  get max(): THREE.Vector3 {
    return this.side.max;
  }
  /** Burnt past the soot line: it has no blood left to spray, trail or pool. */
  get dry(): boolean {
    return this.burn >= FireTuning.sootFrom;
  }

  /** Only a piece made to burn (`SliceField.meshFor`) has a colour to write it in. */
  setBurn(amount: number): void {
    const mesh = this.mesh as THREE.InstancedMesh;
    if (!mesh.isInstancedMesh) return;
    this.burn = amount;
    mesh.setColorAt(0, burnTint(_tint, amount));
    mesh.instanceColor!.needsUpdate = true;
  }
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

  constructor(private readonly ctx: Ctx, private readonly blood: BloodField, private readonly impacts: ImpactEvents, private readonly trail: GibTrail | null = null) {}

  get count(): number {
    return this.halves.length;
  }

  private cap(): THREE.Material {
    if (this.capMaterial) return this.capMaterial;
    const m = new THREE.MeshPhysicalMaterial({
      // No canvas in Node, where the tests cut bodies: the vertex colours carry the cut face alone there.
      map: typeof document === 'undefined' ? null : fleshTexture(), vertexColors: true, roughness: 0.22, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.18,
      // Wet, and with a breath of its own red: a torn face is what says a piece was a body, and in a dark, blue-lit map a
      // matt dark red face on a dark floor read as nothing (the gore update's G2).
      emissive: new THREE.Color(0x2c0406),
    });
    // The cut face of a burnt piece is cooked, not wet (cooked.ts).
    cookable(m);
    this.capMaterial = this.ctx.render.materials?.patch ? this.ctx.render.materials.patch(m) ?? m : m;
    return this.capMaterial;
  }

  private wreckMaterial: THREE.Material | null = null;

  /**
   * The broken face of a machine's hull: dark burnt metal, a little oily, with nothing red in it. The cut's own vertex
   * colours (meat, fat and bone, for a body) are not read.
   */
  private wreckCap(): THREE.Material {
    if (this.wreckMaterial) return this.wreckMaterial;
    const m = new THREE.MeshStandardMaterial({ color: 0x0c0d10, roughness: 0.5, metalness: 0.85, emissive: new THREE.Color(0x120703) });
    this.wreckMaterial = this.ctx.render.materials?.patch ? this.ctx.render.materials.patch(m) ?? m : m;
    return this.wreckMaterial;
  }

  /**
   * A piece of a machine's broken hull (torso.ts `buildWreck`), thrown from where it sits at `p`, `q`, as `throwPiece`
   * throws a piece of a trunk: the same body, the same cap on moving pieces, a trail of sparks for blood, and nothing
   * pools under it.
   */
  throwWreck(side: CutSide, skin: THREE.Material, p: THREE.Vector3, q: THREE.Quaternion, v: THREE.Vector3, spin: number): Half {
    const half = this.throwPiece(side, skin, p, q, v, spin, 0, this.wreckCap());
    half.scrap = true;
    half.pooled = true;
    half.emitter?.stop();
    half.emitter = this.ctx.fx.attachEmitter(half.mesh, 'sparkTrail', side.capCenter, 1.6) ?? null;
    half.ribbon = null;
    return half;
  }

  /** The cut face's material: wet red meat by vertex colour. Slabs wear it on their underside (slabs.ts). */
  get flesh(): THREE.Material {
    return this.cap();
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

  /**
   * The mesh a piece is drawn as. One of a body with any char on it (`burn`), or with flames on it, is an instanced mesh
   * of one: an instance has a colour of its own, which is where a rigid piece's char is kept (`burnTint`), so a burnt
   * body's halves are burnt and can burn on. Anything else is the plain mesh it always was.
   */
  private meshFor(side: CutSide, skin: THREE.Material, burn: number): THREE.Mesh {
    if (burn <= 0) return new THREE.Mesh(side.geometry, [skin, this.cap()]);
    const mesh = new THREE.InstancedMesh(side.geometry, [skin, this.cap()], 1);
    mesh.setMatrixAt(0, IDENTITY);
    mesh.setColorAt(0, burnTint(_tint, burn));
    return mesh;
  }

  /**
   * Cuts `char` in two (or more) along the plane and returns the pieces. `burn` is the char on the body, 0..1: its
   * halves are as burnt, and one burnt past the soot line spills no blood.
   */
  cut(char: CharacterInstance, point: THREE.Vector3, normal: THREE.Vector3, damage: DamageInfo, burn = 0): Half[] {
    const { fx } = this.ctx;
    const made = this.halves.length;
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
    if (result.above.length === 0 || result.below.length === 0) return [];

    // Which way the upper piece slides: downhill along the plane, or with the blade on a flat cut.
    const slide = _v2.set(0, -1, 0).addScaledVector(n, n.y);
    if (slide.lengthSq() < 0.02) slide.copy(damage.dir).addScaledVector(n, -damage.dir.dot(n));
    if (slide.lengthSq() < 1e-4) slide.set(1, 0, 0);
    slide.normalize();
    const aboveIsUpper = result.above[0]!.origin.y >= result.below[0]!.origin.y;

    const skin = char.skinMaterial;
    result.above.forEach((side, i) => this.spawn(side, skin, slide, n, 1, damage, aboveIsUpper && i === 0, burn));
    result.below.forEach((side, i) => this.spawn(side, skin, slide, n, -1, damage, !aboveIsUpper && i === 0, burn));
    const pieces = this.halves.slice(made);

    const at = _o.copy(point);
    if (burn >= FireTuning.sootFrom && !damage.vaporize) {
      // Cooked through: the blade opens dry, dark meat. A breath of ash where it passed, and nothing runs.
      fx.embers(at, 4, 0.3);
    } else if (damage.vaporize) {
      // Cauterized: no blood, a spit of molten sparks along the cut and a flash.
      fx.sparks(at, n, 14, 0xffb060);
      fx.sparks(at, _d.copy(n).negate(), 14, 0xffb060);
      this.ctx.render.lights?.flash(at, 0xffa860, 4, 5, 0.25);
    } else {
      fx.bloodJet(at, _d.copy(damage.dir), 0.5);
      // What the blade carried off: a fan the way it cut, and a line of drops flung off it.
      this.blood.fan(at, damage.dir, 1.25);
      this.blood.castOff(at, damage.dir, 0.9 + Math.random() * 0.6);
      this.blood.splatterAlong(at, damage.dir, 5, 7, 0.6);
      this.blood.spray(at, damage.dir, 10, 9, 0.5, 0.12);
    }
    this.enforce();
    return pieces;
  }

  private spawn(side: CutSide, skin: THREE.Material, slide: THREE.Vector3, n: THREE.Vector3, sign: number, damage: DamageInfo, upper: boolean, char = 0): void {
    const { R, world } = this.ctx.physics;
    // A half is placed unturned at its origin, so the cut lies through its cap's centre along `n` in its own frame too.
    const burn = damage.vaporize ? sear(skin, this.cap(), n, side.capCenter) : null;
    const mesh = burn ? new THREE.Mesh(side.geometry, burn.materials) : this.meshFor(side, skin, char);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.copy(side.origin);
    side.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), side.max.length());
    this.ctx.render.scene.add(mesh);

    const body = world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(side.origin.x, side.origin.y, side.origin.z)
        .setGravityScale(SliceTuning.holdGravity * RagTuning.gravityScale)
        .setLinearDamping(0.1)
        .setAngularDamping(0.6)
        .setCcdEnabled(true),
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
    half.born = this.ctx.time.elapsed;
    half.body = body;
    half.burn = burn ? 0 : char;
    half.releaseAt = this.ctx.time.elapsed + SliceTuning.holdSeconds;
    if (upper) half.slide.copy(slide).multiplyScalar(SliceTuning.slideSpeed);
    half.slide.addScaledVector(n, sign * SliceTuning.partSpeed);
    half.slide.addScaledVector(damage.dir, 0.4);
    if (burn) {
      half.sear = burn;
      half.vapor = this.ctx.time.elapsed;
      half.vaporFor = rand(SliceTuning.vapor.seconds[0], SliceTuning.vapor.seconds[1]);
      // It burns away before it would bleed or pool.
      half.pooled = true;
    } else if (half.dry) half.pooled = true;
    else half.emitter = this.ctx.fx.attachEmitter(mesh, 'stumpSpray', side.capCenter, 3.5) ?? null;
    this.halves.push(half);
  }

  /**
   * A broken piece of a trunk (torso.ts), thrown from where it sits at `p`, `q`. Its geometry is the kit's and stays. `v`
   * is at full gravity: under the tempo dial it is slowed by its square root, as a limb's throw is, so it lands as far.
   */
  throwPiece(side: CutSide, skin: THREE.Material, p: THREE.Vector3, q: THREE.Quaternion, v: THREE.Vector3, spin: number, burn = 0, cap: THREE.Material | null = null): Half {
    const { R, world } = this.ctx.physics;
    const mesh = cap ? new THREE.Mesh(side.geometry, [skin, cap]) : this.meshFor(side, skin, burn);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.copy(p);
    mesh.quaternion.copy(q);
    this.ctx.render.scene.add(mesh);
    const k = Math.sqrt(RagTuning.gravityScale);
    const body = world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(p.x, p.y, p.z)
        .setRotation(q)
        .setLinvel(v.x * k, v.y * k, v.z * k)
        .setAngvel({ x: rand(-spin, spin) * k, y: rand(-spin, spin) * k, z: rand(-spin, spin) * k })
        .setGravityScale(RagTuning.gravityScale)
        .setLinearDamping(0.1)
        .setAngularDamping(0.6)
        .setCcdEnabled(true),
    );
    const collider = R.ColliderDesc.convexHull(side.hull) ?? R.ColliderDesc.cuboid(side.max.x, side.max.y, side.max.z);
    world.createCollider(
      collider.setDensity(SliceTuning.density).setFriction(0.7).setRestitution(0.05)
        .setCollisionGroups(groups(CG.Ragdoll, CG.World | CG.Ragdoll | CG.Gib)),
      body,
    );
    const half = new Half(mesh, side);
    half.born = this.ctx.time.elapsed;
    half.shared = true;
    half.body = body;
    half.burn = burn;
    // A piece of a burnt body is cooked through: it sprays, trails and pools nothing. Nor does a machine's (`throwWreck`).
    if (half.dry || cap) half.pooled = true;
    else {
      half.emitter = this.ctx.fx.attachEmitter(mesh, 'stumpSpray', side.capCenter, 2.5) ?? null;
      half.ribbon = this.trail?.open(half) ?? null;
    }
    this.halves.push(half);
    this.enforce();
    return half;
  }

  /**
   * Draws one piece out of sight for a frame, so the programs a cut piece is drawn with (the skin's unskinned variant, the
   * cut face) compile at load and not on the first gib or slice of a fight.
   */
  warm(side: CutSide, skin: THREE.Material): void {
    // And the burning copies (sear.ts), so the energy blade's first cut does not compile them mid-swing.
    const burn = sear(skin, this.cap(), _up, side.capCenter);
    for (const materials of [[skin, this.cap()], burn.materials]) {
      const mesh = new THREE.Mesh(side.geometry, materials);
      mesh.position.y = -500;
      mesh.frustumCulled = false;
      mesh.onAfterRender = () => {
        mesh.onAfterRender = () => {};
        queueMicrotask(() => {
          mesh.removeFromParent();
          if (materials === burn.materials) for (const m of materials) m.dispose();
        });
      };
      this.ctx.render.scene.add(mesh);
    }
  }

  /** Asked whether a piece could be seen from the camera (mess.ts). Left unset, every piece counts as in sight. */
  inView: ((at: THREE.Vector3, radius: number) => boolean) | null = null;

  private enforce(): void {
    let live = 0;
    for (const h of this.halves) if (h.sinking < 0) live++;
    const now = this.ctx.time.elapsed;
    // Out of sight first, and those go at once: there is nothing to watch.
    if (this.inView) {
      for (let i = 0; i < this.halves.length && live > SliceTuning.maxHalves; i++) {
        const h = this.halves[i]!;
        if (h.sinking >= 0 || h.body || this.inView(h.mesh.position, 1)) continue;
        this.remove(h);
        this.halves.splice(i--, 1);
        live--;
      }
    }
    for (let i = 0; i < this.halves.length && live > SliceTuning.maxHalves; i++) {
      const h = this.halves[i]!;
      if (h.sinking >= 0) continue;
      if (now - h.born < SliceTuning.minShown && live <= SliceTuning.hardCap) break;
      this.freeze(h);
      h.sinking = this.ctx.time.elapsed;
      live--;
    }
  }

  private freeze(h: Half): void {
    if (h.body) this.ctx.physics.world.removeRigidBody(h.body);
    h.body = null;
    // At rest it lies in its own pool and casts no shadow of its own, as a settled body and a limb at rest do not: with
    // one, twenty-eight pieces were 110 draws.
    h.mesh.castShadow = false;
    h.emitter?.stop();
    h.emitter = null;
    if (!h.pooled) {
      h.pooled = true;
      this.blood.pool(h.mesh.position, rand(1.1, 1.7), 3.5);
    }
  }

  private nextEnforce = 0;

  update(dt: number): void {
    const now = this.ctx.time.elapsed;
    // Pieces kept past the cap while they were fresh go once they have been seen.
    if (now >= this.nextEnforce) {
      this.nextEnforce = now + 0.5;
      this.enforce();
    }
    const t = SliceTuning;
    // Landings are heard as they would be at full gravity: slower under the dial by its square root, like a body's.
    const heard = 1 / Math.sqrt(RagTuning.gravityScale);
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
      if (h.vapor >= 0 && this.burnAway(h, now)) {
        this.remove(h);
        this.halves.splice(i, 1);
        continue;
      }
      const body = h.body;
      if (!body) continue;
      if (h.releaseAt > 0 && now >= h.releaseAt) {
        h.releaseAt = 0;
        // Halves of a body fall the way a body does, on the tempo dial.
        body.setGravityScale(RagTuning.gravityScale, true);
        body.setLinvel(h.slide, true);
      }
      body.translation(h.p);
      body.rotation(h.q);
      body.linvel(h.v);
      const speed = h.v.length();
      h.nextThud = this.impacts.land('body', (h.speed - speed) * heard, h.speed * heard, h.p, h.nextThud);
      h.speed = speed;
      // From its torn face, which is where a piece of a trunk bleeds.
      if (h.ribbon && speed > TrailTuning.minSpeed && now - h.born < TrailTuning.seconds) {
        this.trail!.feed(h.ribbon, h, _v.copy(h.side.capCenter).applyQuaternion(h.q).add(h.p), h.v);
      }
      h.mesh.position.copy(h.p);
      h.mesh.quaternion.copy(h.q);
      h.age += dt;
      if (h.v.lengthSq() < t.calmSpeed * t.calmSpeed && h.releaseAt === 0) h.calm += dt;
      else h.calm = 0;
      // A burning half floats until it is gone.
      if (h.vapor < 0 && (h.calm > t.settle || h.age > t.maxSimTime)) this.freeze(h);
    }
  }

  /** One frame of a half burning away (`SliceTuning.vapor`). True when it is ash, and should go. */
  private burnAway(h: Half, now: number): boolean {
    const v = SliceTuning.vapor;
    const k = (now - h.vapor) / h.vaporFor;
    const { fx } = this.ctx;
    const at = _v.copy(h.side.capCenter).applyQuaternion(h.mesh.quaternion).add(h.mesh.position);
    if (k >= 1) {
      fx.embers(at, 5, 0.4);
      fx.sparks(at, _up, 4, 0xffb060);
      return true;
    }
    h.sear!.k.value = k;
    // Its shadow would stay whole while it burns: none once it starts to go.
    if (k > 0.2) h.mesh.castShadow = false;
    const body = h.body;
    if (!h.lifted && k >= v.lift && body && h.releaseAt === 0) {
      h.lifted = true;
      body.setGravityScale(v.gravity, true);
      body.setLinearDamping(v.drag);
      body.linvel(h.v);
      body.setLinvel({ x: h.v.x * 0.3, y: Math.max(h.v.y, 0) + v.rise * rand(0.8, 1.2), z: h.v.z * 0.3 }, true);
    }
    // A cut body is several pieces at once: a few embers a piece, not a body's worth each.
    if (now >= h.ashAt) {
      h.ashAt = now + v.ashEvery;
      fx.embers(at, 1, 0.2);
      fx.sparks(at, _up, 1, k < 0.5 ? 0xffc080 : 0x9fe0ff);
    }
    return false;
  }

  private remove(h: Half): void {
    this.freeze(h);
    h.mesh.removeFromParent();
    if (h.sear) for (const m of h.sear.materials) m.dispose();
    if (!h.shared) h.side.geometry.dispose();
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
        .setAngularDamping(0.6)
        .setCcdEnabled(true),
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
    h.mesh.castShadow = true;
  }

  damage(handle: unknown, point: THREE.Vector3, impulse: THREE.Vector3): void {
    if (!(handle instanceof Half)) return;
    this.wake(handle);
    handle.body?.applyImpulseAtPoint(impulse, point, true);
  }

  /** Every piece sinks away now: the floor is being cleared. */
  dismiss(): void {
    for (const h of this.halves) {
      if (h.sinking >= 0 || h.vapor >= 0) continue;
      this.freeze(h);
      h.sinking = this.ctx.time.elapsed;
    }
  }

  /**
   * Someone walked into the pieces lying at `at`: each still one within `radius` wakes and is shoved along `vx, vz`, away
   * from whoever it was, a couple a call. Returns how many.
   */
  shove(at: THREE.Vector3, radius: number, vx: number, vz: number): number {
    let n = 0;
    const speed = Math.hypot(vx, vz);
    for (let i = 0; i < this.halves.length && n < 2; i++) {
      const h = this.halves[i]!;
      if (h.sinking >= 0 || h.vapor >= 0) continue;
      const p = h.mesh.position;
      const dx = p.x - at.x;
      const dz = p.z - at.z;
      const d = Math.hypot(dx, dz);
      if (d > radius + 0.25 || p.y < at.y - 0.4 || p.y > at.y + 1.6) continue;
      const closing = d > 1e-3 ? (vx * dx + vz * dz) / d : speed;
      if (closing <= 0.3) continue;
      if (!h.body) {
        this.wake(h);
        n++;
      }
      const body = h.body;
      if (!body) continue;
      // One way only, as for a body: speed away from the walker up to a ceiling, never taken off.
      const want = Math.min(4.5, 0.8 + closing * 0.5);
      const v = body.linvel();
      const ux = d > 1e-3 ? dx / d : vx / speed;
      const uz = d > 1e-3 ? dz / d : vz / speed;
      const have = v.x * ux + v.z * uz;
      if (have >= want) continue;
      const j = (want - have) * body.mass();
      body.applyImpulse(_v.set(ux * j, j * 0.2, uz * j), true);
    }
    return n;
  }

  /**
   * A body at rest whose capsules filled the box `lo`..`hi` has gone from under whatever lay on it: each piece at rest
   * there that is not on the floor's own level is woken, and falls. Returns how many.
   */
  unsettle(lo: THREE.Vector3, hi: THREE.Vector3): number {
    let n = 0;
    for (let i = 0; i < this.halves.length && n < 3; i++) {
      const h = this.halves[i]!;
      if (h.body || h.sinking >= 0 || h.vapor >= 0) continue;
      const p = h.mesh.position;
      if (p.x < lo.x - 0.3 || p.x > hi.x + 0.3 || p.z < lo.z - 0.3 || p.z > hi.z + 0.3 || p.y < lo.y || p.y > hi.y + 0.8) continue;
      this.wake(h);
      n++;
    }
    return n;
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
