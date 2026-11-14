/**
 * Everything the gunship puts in the air. combat.spawnProjectile cannot carry these: its shell is a 1.5 m needle under
 * a pixel wide from up here, it cannot say when a round landed, and it lets a roof eat a shot from a mile away.
 *
 * Rounds, flares, muzzle flashes and the bomb's laser are one instanced draw, additive so they sit on top of the fog and
 * hot so bloom carries them. Their width is held to a pixel floor, which is what keeps a shell visible all the way down
 * from 300 m. The glide bomb has a real body and smoke, so it is a model of its own.
 *
 * Three rounds do more than land: AP goes on through walls (`pierce`), flak bursts short of what it meets (`fuze`), and
 * the bomb turns onto a laser all the way down (`steerBomb`). Those three are plain functions, for the tests.
 */
import * as THREE from 'three';
import { CG, type Ctx, type EmitterHandle, type RayHit } from '../../core/contracts';
import type { EnemyInstance } from '../../core/gameplay';
import { rand, randomInCone } from '../../core/math';
import { loadBudget, makeBudget, passWall, type Budget, type Raycaster } from '../../weapons/penetration';
import { ModelBuilder, type ModelMaterials } from '../modelkit';
import { AC130 as A } from './ac130Data';

/** `g40` is the 40 mm's HE, `wp` the 105's white phosphorus. */
export type RoundKind = 'g25' | 'g40' | 'ap' | 'flak' | 'g105' | 'wp';
export type ImpactKind = RoundKind | 'bomb';
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
  g25: { width: 0.2, length: 9, minPx: 1.8, r: 7, g: 4.6, b: 1.5, trail: 0 },
  g40: { width: 0.42, length: 8, minPx: 2.8, r: 9, g: 3.4, b: 0.8, trail: 0 },
  // AP is the cold white-blue streak, so a round punching a roof reads apart from the orange HE.
  ap: { width: 0.36, length: 12, minPx: 2.6, r: 6, g: 8, b: 13, trail: 0 },
  flak: { width: 0.46, length: 7, minPx: 2.8, r: 12, g: 2.2, b: 0.6, trail: 0 },
  g105: { width: 0.8, length: 4.6, minPx: 4.5, r: 10, g: 7.5, b: 4.5, trail: 0.07 },
  wp: { width: 0.8, length: 4.6, minPx: 4.5, r: 12, g: 12, b: 11, trail: 0.05 },
  flare: { width: 1.15, length: 2.3, minPx: 4, r: 15, g: 14, b: 12, trail: 0.11 },
};

/** The laser is a line, drawn as a long thin spark from the sensor to the spot. */
const LASER = { minPx: 1.3, r: 9, g: 1.2, b: 0.8 };

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
  /** World collisions only start this close to the aim. See Battery.armRange. */
  armRange: number;
  /** Seconds before landing that it starts to whistle. 0 once it has, or if it never does. */
  whistle: number;
  /** Walls an AP round may still go through. */
  walls: number;
  width: number;
  length: number;
  minPx: number;
  r: number;
  g: number;
  b: number;
  trail: number;
  trailIn: number;
}

interface Bomb {
  live: boolean;
  group: THREE.Group;
  velocity: THREE.Vector3;
  age: number;
  whistled: boolean;
  smoke: EmitterHandle | null;
}

export interface BombPlan {
  fall: number;
  gravity: number;
  speed: number;
  turn: number;
}

const MAX_SPARKS = 200;
/** Every round is fired from outside the map, so the invisible containment round it is no wall to them. */
export const AIR = CG.World | CG.Air;
const Y = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
const NOSE = new THREE.Vector3(0, -1, 0);
const TAIL = new THREE.Vector3(0, 1.6, 0);
const SMOKE = 0xb4bcc4;
/** Metres a round that has passed a wall is moved on, so its next step does not meet the face it just left. */
const EXIT_STEP = 0.05;

const _prev = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _want = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _exit = new THREE.Vector3();
const _probe = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _matrix = new THREE.Matrix4();
const _near: EnemyInstance[] = [];

/**
 * An AP round met `wall` going along unit `dir`. True when it goes on: the wall is one it can pass (`passWall`, on the
 * per-wall rule), and there is still floor under the far side, so it never drops through the ground itself. Writes the
 * point it comes out at into `exit`.
 */
export function pierce(physics: Raycaster, budget: Budget, wall: RayHit, dir: THREE.Vector3, exit: THREE.Vector3): boolean {
  if (!passWall(physics, budget, wall, dir, exit)) return false;
  return physics.raycast(_probe.copy(exit).addScaledVector(dir, EXIT_STEP), DOWN, 200, CG.World) !== null;
}

/**
 * Where a flak round flying along unit `dir` goes off, given the open distance ahead of it (`open`, Infinity for none),
 * the distance to the nearest enemy ahead (`enemy`), and the step it is about to take. Returns metres along the step to
 * burst at, or -1 to fly on. It goes `fuze` short of whichever comes first.
 */
export function fuze(open: number, enemy: number, step: number, distance: number): number {
  const first = Math.min(open, enemy);
  if (first - distance > step) return -1;
  return Math.max(0, first - distance);
}

/** One frame of the glide bomb: a free fall off the ramp, then a glide turning onto `laser`. Moves `position`. */
export function steerBomb(position: THREE.Vector3, velocity: THREE.Vector3, laser: THREE.Vector3, age: number, dt: number, plan: BombPlan): void {
  if (age < plan.fall) {
    velocity.y -= plan.gravity * dt;
  } else {
    _want.subVectors(laser, position).setLength(plan.speed);
    velocity.lerp(_want, 1 - Math.exp(-plan.turn * dt)).setLength(plan.speed);
  }
  position.addScaledVector(velocity, dt);
}

/** `n` pellet directions in a cone of `cone` radians about unit `dir`. */
export function flakCone(dir: THREE.Vector3, cone: number, out: THREE.Vector3[]): THREE.Vector3[] {
  for (const v of out) randomInCone(dir, cone, v);
  return out;
}

function bombModel(materials: ModelMaterials): THREE.Group {
  const b = new ModelBuilder();
  b.cyl(0.34, 0.34, 3.2, 10, '#5b6570');
  // Nose down the model's -Y, as in ordnance.ts. The seeker is the dark glass at its tip.
  b.solid(new THREE.ConeGeometry(0.34, 0.9, 10), '#2a3038', { at: [0, -2.05, 0], rot: [Math.PI, 0, 0] });
  b.solid(new THREE.SphereGeometry(0.16, 8, 6), '#0d1216', { at: [0, -2.45, 0] });
  b.cyl(0.35, 0.35, 0.16, 10, '#ffcf3a', { at: [0, -1.1, 0] });
  // Glide wings, folded out, and the tail fins that steer it.
  b.box(2.6, 0.1, 0.5, '#3a424c', { at: [0, 0.1, 0] });
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    b.box(0.7, 0.6, 0.05, '#39424c', { at: [Math.cos(a) * 0.45, 1.35, Math.sin(a) * 0.45], rot: [0, -a, 0] });
  }
  return materials.group(b);
}

export class Ac130Rounds {
  /**
   * Set by the strike. Called when a round or the bomb lands. `normal` is null when it went off in open air, and `dir`
   * is the way it was going, which the flak's cone needs.
   */
  onImpact: (kind: ImpactKind, point: THREE.Vector3, normal: THREE.Vector3 | null, dir: THREE.Vector3) => void = () => undefined;
  /** Where the bomb steers. The owner moves it every frame. */
  readonly laser = new THREE.Vector3();
  /** The laser is drawn from here while `laserOn`. */
  readonly laserFrom = new THREE.Vector3();
  laserOn = false;

  private readonly sparks: Spark[] = [];
  private head = 0;
  private readonly bomb: Bomb;
  private readonly budget: Budget = makeBudget();
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
        gravity: 0, age: 0, life: 0, armRange: Infinity, whistle: 0, walls: 0, width: 0, length: 0, minPx: 0, r: 0, g: 0, b: 0, trail: 0, trailIn: 0,
      });
    }
    const group = bombModel(materials);
    group.visible = false;
    ctx.render.scene.add(group);
    this.bomb = { live: false, group, velocity: new THREE.Vector3(), age: 0, whistled: false, smoke: null };
  }

  private next(kind: SparkKind, look: Look | null): Spark {
    // Oldest out. At these fire rates the pool never comes close to wrapping onto a shell still in the air.
    const s = this.sparks[this.head]!;
    this.head = (this.head + 1) % (MAX_SPARKS - 1);
    s.live = true;
    s.kind = kind;
    s.age = 0;
    s.armRange = Infinity;
    s.whistle = 0;
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
    s.whistle = kind === 'g105' || kind === 'wp' ? A.howitzer.whistle : 0;
    s.walls = kind === 'ap' ? A.bofors.ap.walls : 0;
    s.velocity.subVectors(aim, from).divideScalar(seconds);
    s.velocity.y += 0.5 * gravity * seconds;
  }

  flare(from: THREE.Vector3, velocity: THREE.Vector3, life: number = A.flares.life): void {
    const s = this.next('flare', LOOKS.flare);
    s.position.copy(from);
    s.velocity.copy(velocity);
    s.life = life * rand(0.8, 1.15);
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

  /** Out of the ramp at `velocity`. It steers for `laser` from then on. */
  drop(from: THREE.Vector3, velocity: THREE.Vector3): void {
    const m = this.bomb;
    this.retire();
    m.live = true;
    m.age = 0;
    m.whistled = false;
    m.velocity.copy(velocity);
    m.group.position.copy(from);
    m.group.quaternion.setFromUnitVectors(NOSE, _dir.copy(velocity).normalize());
    m.group.visible = true;
  }

  get bombLive(): boolean {
    return this.bomb.live;
  }

  get bombPosition(): THREE.Vector3 {
    return this.bomb.group.position;
  }

  /** True once nothing is left to land. */
  get idle(): boolean {
    for (const s of this.sparks) if (s.live && s.kind !== 'flare' && s.kind !== 'flash') return false;
    return !this.bomb.live;
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
    if (this.bomb.live) this.moveBomb(dt);
    if (this.laserOn) count = this.drawLaser(count, pixel, camera.position);
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
    this.ctx.fx.smoke(s.position, s.kind === 'wp' ? 0xf2f4f6 : SMOKE, size, seconds);
  }

  private land(s: Spark, point: THREE.Vector3, normal: THREE.Vector3 | null): void {
    s.live = false;
    this.onImpact(s.kind as RoundKind, point, normal, _dir);
  }

  private moveRound(s: Spark, dt: number): void {
    if (dt <= 0) return;
    const t = Math.min(s.age, s.life);
    const drop = 0.5 * s.gravity * t * t;
    _prev.copy(s.position);
    s.position.copy(s.origin).addScaledVector(s.velocity, t);
    s.position.y -= drop;
    this.puff(s, dt, 1.5, 1.7);
    // On the round's own clock, not the audio clock, so it keeps time through SLOWMO and dies with the round on a reset.
    if (s.whistle > 0 && s.life - s.age <= s.whistle) {
      s.whistle = 0;
      this.ctx.audio.play('missile_incoming', { position: s.aim, pitch: s.kind === 'wp' ? 0.95 : 0.82 });
    }

    _dir.subVectors(s.position, _prev);
    const step = _dir.length();
    if (step > 1e-6) _dir.divideScalar(step);
    // From where the step starts: testing where it ends would sweep straight back through the roof being skipped.
    const armed = step > 1e-4 && _prev.distanceToSquared(s.aim) < s.armRange * s.armRange;
    if (armed && s.kind === 'flak' && this.flak(s, step)) return;
    if (armed && this.ctx.physics.raycastInto(_prev, _dir, step, AIR, this.hit)) {
      if (s.kind === 'ap' && this.through(s)) return;
      this.land(s, this.hit.point, this.hit.normal);
      return;
    }
    if (s.age >= s.life) this.land(s, s.aim, null);
  }

  /** Burst short of the first surface or enemy ahead. True when it went off. */
  private flak(s: Spark, step: number): boolean {
    const F = A.bofors.flak;
    const reach = step + F.fuze;
    const wall = this.ctx.physics.raycastInto(_prev, _dir, reach, AIR, this.hit) ? this.hit.distance : Infinity;
    let enemy = Infinity;
    const n = this.ctx.enemies.query(_prev, reach, _near) || 0;
    for (let i = 0; i < n; i++) {
      const e = _near[i]!;
      if (!e.alive) continue;
      // Along the line, and close enough to it to be what the fuze sees.
      _mid.subVectors(e.center, _prev);
      const along = _mid.dot(_dir);
      if (along > 0 && _mid.addScaledVector(_dir, -along).lengthSq() < F.fuze * F.fuze) enemy = Math.min(enemy, along);
    }
    const at = fuze(wall, enemy, step, F.fuze);
    if (at < 0) return false;
    this.land(s, _mid.copy(_prev).addScaledVector(_dir, at), null);
    return true;
  }

  /** An AP round goes on from the far side of the wall it met, on the same line. True if it did. */
  private through(s: Spark): boolean {
    loadBudget(this.budget, A.bofors.ap.wall, 0, 1, s.walls);
    if (!pierce(this.ctx.physics, this.budget, this.hit, _dir, _exit)) return false;
    s.walls = this.budget.walls;
    const { fx } = this.ctx;
    fx.impact(this.hit.point, this.hit.normal, this.hit.surface, 1.6);
    fx.sparks(_exit, _dir, 10, '#cfe4ff');
    this.ctx.audio.play('impact_metal', { position: this.hit.point, volume: 0.8 });
    // A straight round: start a fresh closed-form flight from the far face, on to the same aim at the same speed.
    const speed = s.velocity.length();
    s.origin.copy(_exit).addScaledVector(_dir, EXIT_STEP);
    s.position.copy(s.origin);
    s.life = Math.max(0.01, s.origin.distanceTo(s.aim) / speed);
    s.velocity.copy(_dir).multiplyScalar(speed);
    s.age = 0;
    // Every wall from here on is met, however low.
    s.armRange = 1e6;
    return true;
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

  private moveBomb(dt: number): void {
    if (dt <= 0) return;
    const B = A.bomb;
    const m = this.bomb;
    const body = m.group;
    m.age += dt;
    if (m.age >= B.fall) m.smoke ??= this.ctx.fx.attachEmitter(body, 'smokeTrail', TAIL);
    _prev.copy(body.position);
    steerBomb(body.position, m.velocity, this.laser, m.age, dt, B);
    _dir.copy(m.velocity).normalize();
    body.quaternion.setFromUnitVectors(NOSE, _dir);
    const left = body.position.distanceTo(this.laser);
    if (!m.whistled && left < B.speed * B.whistle) {
      m.whistled = true;
      this.ctx.audio.play('nuke_incoming', { position: this.laser, pitch: 1.5, volume: 0.7 });
    }
    _want.subVectors(body.position, _prev);
    const step = _want.length();
    if (left < B.armWithin && step > 1e-4 && this.ctx.physics.raycastInto(_prev, _want.divideScalar(step), step + 0.5, AIR, this.hit)) {
      this.retire();
      this.onImpact('bomb', this.hit.point, this.hit.normal, _dir);
      return;
    }
    if (m.age >= B.life) {
      this.retire();
      this.onImpact('bomb', body.position, null, _dir);
    }
  }

  private retire(): void {
    const m = this.bomb;
    m.live = false;
    m.group.visible = false;
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
    return this.put(at, s.r, s.g, s.b);
  }

  /** The last slot of the pool is kept for the laser, so nothing in the air can push it out. */
  private drawLaser(at: number, pixel: number, eye: THREE.Vector3): number {
    _dir.subVectors(this.laser, this.laserFrom);
    const length = _dir.length();
    if (length < 1e-3) return at;
    _mid.copy(this.laserFrom).addScaledVector(_dir, 0.5);
    _quat.setFromUnitVectors(Y, _dir.divideScalar(length));
    const width = _mid.distanceTo(eye) * pixel * LASER.minPx;
    // The octahedron's tips are the ends of the line, so it is half as long either way as the line is.
    _matrix.compose(_mid, _quat, _scale.set(width, length / 2, width));
    return this.put(at, LASER.r, LASER.g, LASER.b);
  }

  private put(at: number, r: number, g: number, b: number): number {
    this.mesh.setMatrixAt(at, _matrix);
    const c = at * 3;
    this.colors[c] = r;
    this.colors[c + 1] = g;
    this.colors[c + 2] = b;
    return at + 1;
  }

  clear(): void {
    for (const s of this.sparks) s.live = false;
    this.retire();
    this.laserOn = false;
    this.mesh.count = 0;
  }
}
