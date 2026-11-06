/**
 * Everything the gunship puts in the air. combat.spawnProjectile cannot carry these: its shell is a 1.5 m needle under
 * a pixel wide from up here, it cannot say when a round landed, and it lets a roof eat a shot from a mile away.
 *
 * Rounds, flares and muzzle flashes are one instanced draw, additive so they sit on top of the fog and hot so bloom
 * carries them. Their width is held to a pixel floor, which is what keeps a shell visible all the way down from 300 m.
 * Missiles have real bodies and smoke, so they are four pooled models instead.
 */
import * as THREE from 'three';
import { CG, type Ctx, type EmitterHandle, type RayHit } from '../../core/contracts';
import type { EnemyInstance } from '../../core/gameplay';
import { rand } from '../../core/math';
import { ModelBuilder, type ModelMaterials } from '../modelkit';
import { AC130 as A } from './ac130Data';

export type RoundKind = 'g25' | 'g40' | 'g105';
export type ImpactKind = RoundKind | 'hellfire';
type SparkKind = RoundKind | 'flare' | 'flash';

interface Look {
  width: number;
  length: number;
  /** Narrowest it may draw, in screen pixels. */
  minPx: number;
  r: number;
  g: number;
  b: number;
  /** Seconds between smoke puffs behind it. 0 for none. */
  trail: number;
}

const LOOKS: Readonly<Record<RoundKind | 'flare', Look>> = {
  g25: { width: 0.2, length: 8, minPx: 1.8, r: 7, g: 4.6, b: 1.5, trail: 0 },
  g40: { width: 0.42, length: 8, minPx: 2.8, r: 9, g: 3.4, b: 0.8, trail: 0 },
  g105: { width: 0.8, length: 4.6, minPx: 4.5, r: 10, g: 7.5, b: 4.5, trail: 0.07 },
  flare: { width: 1.15, length: 2.3, minPx: 4, r: 12, g: 10, b: 7, trail: 0.11 },
};

interface Spark {
  live: boolean;
  kind: SparkKind;
  origin: THREE.Vector3;
  velocity: THREE.Vector3;
  position: THREE.Vector3;
  aim: THREE.Vector3;
  gravity: number;
  age: number;
  life: number;
  /** World collisions only start this close to the aim. See FireControl.armRange. */
  armRange: number;
  width: number;
  length: number;
  minPx: number;
  r: number;
  g: number;
  b: number;
  trail: number;
  trailIn: number;
}

interface Missile {
  live: boolean;
  group: THREE.Group;
  velocity: THREE.Vector3;
  aim: THREE.Vector3;
  target: EnemyInstance | null;
  uid: number;
  age: number;
  armRange: number;
  smoke: EmitterHandle | null;
}

const MAX_SPARKS = 160;
const MISSILES = 4;
const Y = new THREE.Vector3(0, 1, 0);
const NOSE = new THREE.Vector3(0, -1, 0);
const TAIL = new THREE.Vector3(0, 1.4, 0);
const SMOKE = 0xb4bcc4;
const HIT_RANGE = 2;

const _prev = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _want = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _matrix = new THREE.Matrix4();

function missileModel(materials: ModelMaterials): THREE.Group {
  const b = new ModelBuilder();
  b.cyl(0.16, 0.16, 2.1, 8, '#b9c2cb');
  // Nose down the model's -Y, as in ordnance.ts.
  b.solid(new THREE.ConeGeometry(0.16, 0.5, 8), '#20262c', { at: [0, -1.3, 0], rot: [Math.PI, 0, 0] });
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    b.box(0.34, 0.5, 0.03, '#39424c', { at: [Math.cos(a) * 0.24, 0.8, Math.sin(a) * 0.24], rot: [0, -a, 0] });
  }
  b.glow(new THREE.CylinderGeometry(0.12, 0.05, 0.3, 8), '#ffb060', 7, { at: [0, 1.2, 0] });
  return materials.group(b);
}

export class Ac130Rounds {
  /** Set once by the strike. Called when a round or missile lands. `normal` is null when it reached its aim in open air. */
  onImpact: (kind: ImpactKind, point: THREE.Vector3, normal: THREE.Vector3 | null) => void = () => undefined;

  private readonly sparks: Spark[] = [];
  private head = 0;
  private readonly missiles: Missile[] = [];
  private readonly mesh: THREE.InstancedMesh;
  private readonly colors: Float32Array;
  private readonly hit: RayHit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0, surface: 'concrete', collider: null };

  constructor(private readonly ctx: Ctx, materials: ModelMaterials) {
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff, toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.mesh = new THREE.InstancedMesh(new THREE.OctahedronGeometry(1, 0), material, MAX_SPARKS);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.colors = new Float32Array(MAX_SPARKS * 3);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(this.colors, 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.name = 'ac130.rounds';
    // Always in the scene and always visible, at a count of zero. The shader warm-up's plain stand-ins would compile a
    // different program from an instanced one, and the load pass only walks what is visible.
    ctx.render.scene.add(this.mesh);

    for (let i = 0; i < MAX_SPARKS; i++) {
      this.sparks.push({
        live: false, kind: 'flash', origin: new THREE.Vector3(), velocity: new THREE.Vector3(), position: new THREE.Vector3(), aim: new THREE.Vector3(),
        gravity: 0, age: 0, life: 0, armRange: Infinity, width: 0, length: 0, minPx: 0, r: 0, g: 0, b: 0, trail: 0, trailIn: 0,
      });
    }
    for (let i = 0; i < MISSILES; i++) {
      const group = missileModel(materials);
      group.visible = false;
      ctx.render.scene.add(group);
      this.missiles.push({ live: false, group, velocity: new THREE.Vector3(), aim: new THREE.Vector3(), target: null, uid: -1, age: 0, armRange: Infinity, smoke: null });
    }
  }

  private next(kind: SparkKind, look: Look | null): Spark {
    // Oldest out. At these fire rates the pool never comes close to wrapping onto a shell still in the air.
    const s = this.sparks[this.head]!;
    this.head = (this.head + 1) % MAX_SPARKS;
    s.live = true;
    s.kind = kind;
    s.age = 0;
    s.armRange = Infinity;
    if (look) {
      s.width = look.width;
      s.length = look.length;
      s.minPx = look.minPx;
      s.r = look.r;
      s.g = look.g;
      s.b = look.b;
      s.trail = look.trail;
      s.trailIn = 0;
    }
    return s;
  }

  /** Lands exactly on `aim` after `seconds`, whatever the frame rate: the flight is a closed form of time. */
  fire(kind: RoundKind, from: THREE.Vector3, aim: THREE.Vector3, seconds: number, gravity: number, armRange: number): void {
    const s = this.next(kind, LOOKS[kind]);
    s.origin.copy(from);
    s.position.copy(from);
    s.aim.copy(aim);
    s.life = seconds;
    s.gravity = gravity;
    s.armRange = armRange;
    s.velocity.subVectors(aim, from).divideScalar(seconds);
    s.velocity.y += 0.5 * gravity * seconds;
  }

  flare(from: THREE.Vector3, velocity: THREE.Vector3): void {
    const s = this.next('flare', LOOKS.flare);
    s.position.copy(from);
    s.velocity.copy(velocity);
    s.life = A.flares.life * rand(0.8, 1.15);
  }

  /** `size` is a radius in metres, held to `minPx` on screen. */
  flash(at: THREE.Vector3, size: number, seconds: number, minPx: number, r: number, g: number, b: number): void {
    const s = this.next('flash', null);
    s.position.copy(at);
    s.width = s.length = size;
    s.minPx = minPx;
    s.r = r;
    s.g = g;
    s.b = b;
    s.trail = 0;
    s.life = seconds;
  }

  /** Falls off the rail, lights, then flies at `target`, or at `aim` if there is none or it dies on the way. */
  launch(from: THREE.Vector3, velocity: THREE.Vector3, target: EnemyInstance | null, aim: THREE.Vector3, armRange: number): void {
    const m = this.missiles.find(x => !x.live) ?? this.missiles[0]!;
    this.retire(m);
    m.live = true;
    m.target = target;
    m.uid = target?.uid ?? -1;
    m.aim.copy(aim);
    m.age = 0;
    m.armRange = armRange;
    m.velocity.copy(velocity);
    m.group.position.copy(from);
    m.group.quaternion.setFromUnitVectors(NOSE, _dir.copy(velocity).normalize());
    m.group.visible = true;
  }

  /** True while a missile is on its way to this enemy, so a second one looks for someone else. */
  hunting(enemy: EnemyInstance): boolean {
    for (const m of this.missiles) if (m.live && m.uid === enemy.uid) return true;
    return false;
  }

  /** True once nothing is left to land. */
  get idle(): boolean {
    for (const s of this.sparks) if (s.live && (s.kind === 'g25' || s.kind === 'g40' || s.kind === 'g105')) return false;
    for (const m of this.missiles) if (m.live) return false;
    return true;
  }

  update(dt: number): void {
    const camera = this.ctx.render.camera;
    const pixel = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / Math.max(this.ctx.render.renderer.domElement.clientHeight, 1);
    let count = 0;
    for (const s of this.sparks) {
      if (!s.live) continue;
      s.age += dt;
      if (s.kind === 'flash') {
        if (s.age >= s.life) s.live = false;
      } else if (s.kind === 'flare') {
        this.moveFlare(s, dt);
      } else {
        this.moveRound(s, dt);
      }
      if (s.live) count = this.draw(s, count, pixel, camera.position);
    }
    for (const m of this.missiles) if (m.live) this.moveMissile(m, dt);
    this.mesh.count = count;
    if (count === 0) return;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;
  }

  private puff(s: Spark, dt: number, size: number, seconds: number): void {
    if (s.trail <= 0) return;
    s.trailIn -= dt;
    if (s.trailIn > 0) return;
    s.trailIn = s.trail;
    this.ctx.fx.smoke(s.position, SMOKE, size, seconds);
  }

  private moveRound(s: Spark, dt: number): void {
    if (dt <= 0) return;
    const t = Math.min(s.age, s.life);
    const drop = 0.5 * s.gravity * t * t;
    _prev.copy(s.position);
    s.position.copy(s.origin).addScaledVector(s.velocity, t);
    s.position.y -= drop;
    this.puff(s, dt, 1.5, 1.7);

    _dir.subVectors(s.position, _prev);
    const step = _dir.length();
    if (step > 1e-4 && s.position.distanceToSquared(s.aim) < s.armRange * s.armRange) {
      _dir.divideScalar(step);
      if (this.ctx.physics.raycastInto(_prev, _dir, step, CG.World, this.hit)) {
        s.live = false;
        this.onImpact(s.kind as RoundKind, this.hit.point, this.hit.normal);
        return;
      }
    }
    if (s.age >= s.life) {
      s.live = false;
      this.onImpact(s.kind as RoundKind, s.aim, null);
    }
  }

  private moveFlare(s: Spark, dt: number): void {
    if (s.age >= s.life) {
      s.live = false;
      return;
    }
    s.velocity.multiplyScalar(Math.exp(-A.flares.drag * dt));
    s.velocity.y -= A.flares.gravity * dt;
    s.position.addScaledVector(s.velocity, dt);
    this.puff(s, dt, 1.3, 1.5);
  }

  private moveMissile(m: Missile, dt: number): void {
    if (dt <= 0) return;
    const { fx, physics } = this.ctx;
    const H = A.hellfire;
    const body = m.group;
    m.age += dt;
    if (m.target && m.target.alive && m.target.uid === m.uid) m.aim.copy(m.target.center);

    if (m.age < H.drop) {
      m.velocity.y -= 14 * dt;
    } else {
      m.smoke ??= fx.attachEmitter(body, 'airstrikeTrail', TAIL);
      _want.subVectors(m.aim, body.position).setLength(H.speed);
      m.velocity.lerp(_want, 1 - Math.exp(-H.turn * dt));
      m.velocity.setLength(Math.min(H.speed, m.velocity.length() + H.speed * 1.6 * dt));
    }

    const speed = m.velocity.length();
    _dir.copy(m.velocity).divideScalar(speed);
    body.quaternion.setFromUnitVectors(NOSE, _dir);
    const step = speed * dt;
    if (body.position.distanceToSquared(m.aim) < m.armRange * m.armRange && physics.raycastInto(body.position, _dir, step + 0.5, CG.World, this.hit)) {
      this.retire(m);
      this.onImpact('hellfire', this.hit.point, this.hit.normal);
      return;
    }
    body.position.addScaledVector(_dir, step);
    if (body.position.distanceToSquared(m.aim) < HIT_RANGE * HIT_RANGE || m.age >= H.life) {
      this.retire(m);
      this.onImpact('hellfire', body.position, null);
    }
  }

  private retire(m: Missile): void {
    m.live = false;
    m.group.visible = false;
    m.target = null;
    m.uid = -1;
    m.smoke?.stop();
    m.smoke = null;
  }

  private draw(s: Spark, at: number, pixel: number, eye: THREE.Vector3): number {
    const floor = s.position.distanceTo(eye) * pixel * s.minPx;
    let width = Math.max(s.width, floor);
    let length = Math.max(s.length, floor);
    if (s.kind === 'flash') {
      const left = 1 - s.age / s.life;
      width *= left;
      length *= left;
      _quat.identity();
    } else if (s.kind === 'flare') {
      const flicker = rand(0.75, 1.2);
      width *= flicker;
      length *= flicker;
      _quat.identity();
    } else {
      _dir.copy(s.velocity);
      _dir.y -= s.gravity * Math.min(s.age, s.life);
      _quat.setFromUnitVectors(Y, _dir.normalize());
    }
    _matrix.compose(s.position, _quat, _scale.set(width, length, width));
    this.mesh.setMatrixAt(at, _matrix);
    const c = at * 3;
    this.colors[c] = s.r;
    this.colors[c + 1] = s.g;
    this.colors[c + 2] = s.b;
    return at + 1;
  }

  clear(): void {
    for (const s of this.sparks) s.live = false;
    for (const m of this.missiles) this.retire(m);
    this.mesh.count = 0;
  }
}
