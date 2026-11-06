/**
 * The enemy system: owns the pool, runs each enemy's frame, and answers queries from the rest of the game.
 *
 * Per-frame work is arithmetic only. Anything costly runs on a staggered tick: thinking on a per-enemy clock with
 * a frame cap, sight on the director's ray budget, and animation at a distance-based LOD.
 */
import * as THREE from 'three';
import type { GoreRegion } from '../characters/rig';
import type { CharacterInstance, Ctx, DamageInfo, LocomotionInput, RagdollOptions } from '../core/contracts';
import type { DamageResult, EnemyId, EnemyInstance, EnemyRayHit, EnemySystem } from '../core/gameplay';
import { clamp, rand, TAU } from '../core/math';
import { Pool } from '../core/pool';
import { PlayerSense, type AiWorld } from './aiWorld';
import { PlateDebris, plateGeometry, plateMaterial, type Plate, type PlateSpec } from './armor';
import { say } from './attacks';
import { finishAttack, thinkAttacks, thinkBehaviours, tickAttack, type Behaviour } from './brain';
import { updateContact } from './contact';
import { ENEMIES, LIMB_SIZE, waveScale, type Footfall } from './data';
import { DamageModel, STRAY_TANK_DAMAGE, STRAY_TANK_RADIUS } from './damage';
import { Director } from './director';
import { Enemy } from './Enemy';
import { updateMovement } from './movement';
import { Spawner } from './spawner';
import { Telegraphs } from './telegraph';
import { MAX_ALIVE } from './waves';

const MAX_THINKS_PER_FRAME = 14;
const THINK_INTERVAL = [0.12, 0.22, 0.4, 0.6] as const;
/** Pressure fades over about this many seconds without being shot at. */
const PRESSURE_DECAY = 0.28;
const NEAR_MISS_RADIUS = 2.2;
const MAX_STRIKES = 16;
const BURN_TICK = 0.25;
const BURN_SPREAD_RADIUS = 2.4;
/** Skin blackens to full char over about this many seconds on fire. */
const CHAR_SECONDS = 3.5;
/** Seconds of a Warden's speed boost after the aura last touched it. */
const BUFF_SECONDS = 2.5;
const HAZARD_TICK = 0.3;
/** Metres the route must shorten by to count as getting anywhere. */
const PATH_GAIN = 3;
/** Seconds with no gain before an enemy is moved: one that cannot see the player, and a melee one that can. */
const STRANDED_BLIND = 9;
const STRANDED_SIGHTED = 14;
/** Close enough that the route has nothing left to gain. */
const ARRIVED_PATH = 7;
/** Further back than this and a walker will never catch a player who keeps moving. */
const STRAGGLER_PATH = 110;
const RESCUE_MIN_PATH = 25;
const RESCUE_MAX_PATH = 60;
/** Player speed in m/s where aim starts to suffer, and how much more it takes to reach the worst of it. */
const EVASION_FROM = 3;
const EVASION_SPAN = 8.5;
/** Below this a falling wreck has missed the map. */
const CRASH_FLOOR = -40;
/** A player outrunning the tide strands a lot of it at once. It comes back in a trickle, not all on one frame. */
const RESCUE_GAP = 0.3;

/** Character members the contract leaves off. */
interface Skin {
  setBurn(amount: number): void;
  setFrost(amount: number): void;
  setLod(level: number): void;
}

interface Stepping {
  onFootstep: ((x: number, y: number, z: number, strength: number) => void) | null;
}

interface Strike {
  at: number;
  position: THREE.Vector3;
  radius: number;
  damage: number;
  source: string;
  live: boolean;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _hits: EnemyRayHit[] = [];
const UP = new THREE.Vector3(0, 1, 0);

function makeHit(): EnemyRayHit {
  return { enemy: null as unknown as EnemyInstance, distance: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(), bone: 0, region: 'chest' };
}

export class EnemyManager implements EnemySystem {
  readonly alive: Enemy[] = [];
  /** Enemies waiting in the wave queue. */
  queued = 0;
  get remaining(): number {
    return this.alive.length + this.queued;
  }

  readonly debris: PlateDebris;
  readonly spawner: Spawner;
  /** Jump links and pads crossed this run. */
  linksTaken = 0;
  /** Enemies moved because they got nowhere for too long. Should stay near zero; the arena reports it. */
  rescues = 0;
  /** Reused by every ragdoll call. Gore reads it synchronously. */
  readonly ragdollOptions: RagdollOptions = {
    impulses: [{ bone: 0, point: new THREE.Vector3(), impulse: new THREE.Vector3() }],
    velocity: new THREE.Vector3(),
  };

  private readonly w: AiWorld;
  private readonly model: DamageModel;
  private readonly director: Director;
  private readonly telegraphs: Telegraphs;
  private readonly player = new PlayerSense();
  private readonly pool = new Pool<Enemy>(() => new Enemy(), e => e.reset());
  private readonly dying: Enemy[] = [];
  private readonly recycle: Enemy[] = [];
  private readonly frameList: Enemy[] = [];
  private readonly strikes: Strike[] = [];
  private readonly plateMeshes = new WeakMap<object, THREE.Mesh[]>();
  private readonly footfalls = new WeakSet<object>();
  private readonly hitRing: EnemyRayHit[] = Array.from({ length: 16 }, makeHit);
  private hitHead = 0;
  private readonly allHits: EnemyRayHit[] = Array.from({ length: 32 }, makeHit);
  private readonly loco: LocomotionInput = { speed: 0, moveX: 0, moveZ: 0, aimYaw: 0, aimPitch: 0, grounded: true };
  private readonly tick: DamageInfo = {
    amount: 0, type: 'fire', point: new THREE.Vector3(), dir: new THREE.Vector3(0, 1, 0), force: 0, source: 'fire',
  };
  private readonly nearby: EnemyInstance[] = [];

  private uid = 0;
  private wave = 1;
  private thinks = 0;
  private nextRescueAt = 0;
  /** The Titan went down and took the field with it: the wave queue is cancelled. */
  fieldCleared = false;

  constructor(private readonly ctx: Ctx) {
    const self = this;
    this.w = {
      ctx,
      get director() { return self.director; },
      get telegraphs() { return self.telegraphs; },
      enemies: this,
      player: this.player,
      now: 0,
    };
    this.director = new Director(this.w);
    this.telegraphs = new Telegraphs(ctx);
    this.debris = new PlateDebris(ctx);
    this.spawner = new Spawner(this.w, this);
    this.model = new DamageModel(this.w, this);
    for (let i = 0; i < MAX_STRIKES; i++) {
      this.strikes.push({ at: 0, position: new THREE.Vector3(), radius: 0, damage: 0, source: '', live: false });
    }
  }

  init(ctx: Ctx): void {
    this.telegraphs.init();
    ctx.events.on('weapon:fired', e => this.onShot(e.origin, e.dir));
  }

  reset(): void {
    for (let i = this.alive.length - 1; i >= 0; i--) {
      const e = this.alive[i]!;
      this.stopEffects(e);
      e.char.release();
      this.pool.release(e);
    }
    this.alive.length = 0;
    for (const e of this.dying) {
      // A headless stumbler already belongs to gore. Crashes and bosses are ours until their last frame.
      if (e.dyingKind !== 'stumble') e.char.release();
      this.pool.release(e);
    }
    this.dying.length = 0;
    this.flushRecycle();
    for (const s of this.strikes) s.live = false;
    this.queued = 0;
    this.wave = 1;
    this.linksTaken = this.rescues = this.nextRescueAt = 0;
    this.fieldCleared = false;
    this.director.reset();
    this.telegraphs.clear();
    this.debris.clear();
    this.spawner.reset();
  }

  setWave(wave: number): void {
    this.wave = wave;
    this.director.setWave(wave);
  }

  /** True while a boss is still playing out its death. The wave must not clear over the top of it. */
  get bossDying(): boolean {
    for (const e of this.dying) if (e.dyingKind === 'boss') return true;
    return false;
  }

  // -------------------------------------------------------------------------------------------
  // Spawning
  // -------------------------------------------------------------------------------------------

  spawn(id: EnemyId, position: THREE.Vector3): Enemy | null {
    if (this.alive.length >= MAX_ALIVE) return null;
    const { ctx } = this;
    const def = ENEMIES[id];
    const e = this.pool.get();
    const char = ctx.characters.spawn(id);
    e.uid = ++this.uid;
    e.id = id;
    e.def = def;
    e.char = char;
    ctx.render.scene.add(char.root);

    const scale = waveScale(this.wave);
    e.maxHealth = e.health = def.hp * scale.health;
    e.damageMul = scale.damage;
    // A small spread keeps a pack from moving in lockstep.
    e.speedMul = scale.speed * rand(0.93, 1.07);
    e.score = def.score;
    e.isBoss = def.boss !== undefined;
    e.position.copy(position);
    e.groundY = position.y;
    e.groundSampleAt.set(position.x, position.z);
    e.lastProgress.copy(position);
    e.side = e.uid % 2 === 0 ? 1 : -1;
    e.slotAngle = rand(0, TAU);
    e.thinkAt = this.w.now + rand(0, 0.15);
    e.barkAt = this.w.now + rand(1, 6);
    e.bestPathAt = this.w.now;
    e.windowStart.copy(position);
    e.behaviours = def.behaviours;
    e.attacks = def.attacks;
    e.shield = id === 'riot';

    for (const key in LIMB_SIZE) {
      const region = key as GoreRegion;
      e.limbHp.set(region, e.maxHealth * def.limbFrac * LIMB_SIZE[region]!);
    }
    if (id === 'drone') e.limbHp.set('abdomen', e.maxHealth * 0.3);
    e.limbHp.set('head', def.headPoolFixed ? def.headPool : e.maxHealth * def.headPool);

    if (def.plates) this.fitPlates(e, def.plates);
    if (def.boss) e.boss = def.boss(e, this.w);
    if (def.footfall) this.fitFootfall(char, def.footfall);
    if (def.loop) e.bodyLoop = ctx.audio.startLoop(def.loop, { position });

    e.alive = true;
    this.alive.push(e);
    this.place(e);
    ctx.events.emit('enemy:spawned', { enemy: e });
    return e;
  }

  /** Plates live on the pooled character for good, so a respawn re-seats them instead of building new ones. */
  private fitPlates(e: Enemy, specs: readonly PlateSpec[]): void {
    let meshes = this.plateMeshes.get(e.char);
    if (!meshes) {
      meshes = specs.map(spec => {
        const mesh = new THREE.Mesh(plateGeometry(spec), plateMaterial(this.ctx));
        mesh.castShadow = true;
        e.char.attachProp(spec.bone, mesh);
        return mesh;
      });
      this.plateMeshes.set(e.char, meshes);
    }
    const plates: Plate[] = [];
    let total = 0;
    for (let i = 0; i < specs.length; i++) {
      const spec = specs[i]!;
      const mesh = meshes[i]!;
      e.char.bones[spec.bone]!.add(mesh);
      mesh.position.set(spec.offset[0], spec.offset[1], spec.offset[2]);
      mesh.rotation.set(spec.tilt?.[0] ?? 0, spec.tilt?.[1] ?? 0, spec.tilt?.[2] ?? 0);
      mesh.scale.setScalar(1);
      mesh.visible = true;
      const hp = spec.hp * e.maxHealth;
      total += hp;
      plates.push({ spec, hp, mesh });
    }
    e.plates = plates;
    e.armor = total;
  }

  /** The animator finds the plants; this adds what the ground does about them. A pooled body keeps its hook. */
  private fitFootfall(char: CharacterInstance, step: Footfall): void {
    if (this.footfalls.has(char)) return;
    this.footfalls.add(char);
    const { ctx } = this;
    const anim = char.anim as unknown as Stepping;
    const shared = anim.onFootstep;
    const at = new THREE.Vector3();
    anim.onFootstep = (x, y, z, strength) => {
      shared?.(x, y, z, strength);
      at.set(x, y, z);
      ctx.audio.play(step.sound, { position: at, pitch: step.pitch, pitchJitter: 0.05, volume: step.volume });
      if (step.impulse <= 0) return;
      ctx.physics.radialImpulse(at, 6, step.impulse);
      ctx.fx.dust(at, UP, 2);
    };
  }

  /** Bosses arrive where the player can see it, because the arrival is the point. */
  spawnBoss(id: EnemyId): Enemy | null {
    const point = this.spawner.pickArena(34, 64);
    if (!point) return null;
    const e = this.spawn(id, point.position);
    if (!e) return null;
    e.entrance = 'boss';
    e.airborne = true;
    e.position.y += 42;
    e.verticalSpeed = -46;
    this.telegraphs.zone(point.position, id === 'titan' ? 16 : 9, 0.9, 0xff5a1e);
    return e;
  }

  reinforce(id: EnemyId, count: number): void {
    const room = MAX_ALIVE - this.alive.length;
    const n = Math.min(count, room);
    if (n <= 0) return;
    const ids = new Array<EnemyId>(n).fill(id);
    this.spawner.spawnPack(ids);
  }

  // -------------------------------------------------------------------------------------------
  // Frame
  // -------------------------------------------------------------------------------------------

  update(): void {
    const { ctx, w, director } = this;
    const dt = ctx.time.dt;
    w.now = ctx.time.elapsed;
    this.sensePlayer();
    director.beginFrame();
    director.updateSight(this.alive);
    this.thinks = 0;

    const list = this.frameList;
    list.length = 0;
    for (let i = 0; i < this.alive.length; i++) list.push(this.alive[i]!);
    for (let i = 0; i < list.length; i++) {
      const e = list[i]!;
      if (e.alive) this.updateEnemy(e, dt);
    }
    this.updateDying(dt);
    this.updateStrikes();
    this.telegraphs.update(dt);
    this.debris.update(dt);
    this.flushRecycle();
  }

  private sensePlayer(): void {
    const p = this.player;
    const src = this.ctx.player;
    p.position.copy(src.position);
    p.eye.copy(src.eye);
    p.chest.copy(src.position);
    p.chest.y += 1;
    p.velocity.copy(src.velocity);
    p.forward.copy(src.forward);
    p.speed = Math.hypot(src.velocity.x, src.velocity.y * 0.5, src.velocity.z);
    p.grounded = src.grounded;
    p.alive = src.alive;
    // Full at 11.5 m/s, just under the player's 12.5 run, so simply running gets all of it. Tricks earn score.
    p.evasion = clamp((p.speed - EVASION_FROM) / EVASION_SPAN);
    p.ghost = this.ctx.progression.isActive?.('ghost') ?? false;
  }

  private updateEnemy(e: Enemy, dt: number): void {
    const { w, player } = this;
    this.perceive(e, dt);
    this.updateStatus(e, dt);
    if (!e.alive) return;
    e.bodyLoop?.setPosition(e.center);

    if (e.frozen > 0) {
      this.place(e);
      return;
    }
    if (e.stagger > 0) e.stagger -= dt;
    e.pressure = Math.max(0, e.pressure - PRESSURE_DECAY * dt);
    e.buff = Math.max(0, e.buff - dt / BUFF_SECONDS);

    if (e.entrance !== 'none') {
      this.updateEntrance(e, dt);
    } else {
      if (w.now >= e.thinkAt && this.thinks < MAX_THINKS_PER_FRAME && e.stagger <= 0) {
        this.thinks++;
        e.thinkAt = w.now + THINK_INTERVAL[e.lod]! * rand(0.85, 1.15);
        this.thinkRoute(e);
        thinkBehaviours(e, w);
        // Panic takes the hands too, but the ones built to burn keep fighting.
        if (player.alive && (e.burning <= 0 || e.def.fireproof || e.isBoss)) thinkAttacks(e, w);
        this.bark(e);
      }
      e.behaviour?.frame?.(e, w, dt);
      tickAttack(e, w, dt);
      if (!e.alive) return;
      updateMovement(e, w, dt, this.alive);
      updateContact(e, w);
    }
    this.place(e);
    this.animate(e, dt);
  }

  /**
   * The last line of defence against a stuck enemy, because one body that never arrives stalls the wave. Route gain
   * alone cannot prove that: the player moving away lengthens the route of a body walking straight at them. So a
   * window with no gain only counts if the body also stayed put, or has been left so far behind that it is out of
   * the fight. Either way it re-enters through a spawn point.
   */
  private thinkRoute(e: Enemy): void {
    const { w } = this;
    e.pathDist = this.ctx.world.nav.pathDistance(e.position);
    if (e.pathDist < e.bestPath - PATH_GAIN || e.pathDist < ARRIVED_PATH) {
      e.bestPath = e.pathDist;
      e.bestPathAt = w.now;
      e.windowStart.copy(e.position);
      return;
    }
    // A legless crawler bleeds out long before this matters, and one falling from the sky would be absurd.
    if (e.isBoss || e.pinned || e.airborne || e.maim.legs === 0 || e.def.id === 'drone') return;
    // Only a body trying to travel can be stranded. A Warden hanging back or a Trooper in cover means to stay put.
    if (e.mode !== 'flow') {
      e.bestPathAt = w.now;
      e.windowStart.copy(e.position);
      return;
    }
    // A gunfighter holding its band is doing its job, however long it stands there.
    const limit = e.hasLos ? (e.def.ranged ? Infinity : STRANDED_SIGHTED) : STRANDED_BLIND;
    if (w.now - e.bestPathAt <= limit) return;
    const stuck = e.position.distanceToSquared(e.windowStart) < PATH_GAIN * PATH_GAIN;
    e.bestPath = e.pathDist;
    e.bestPathAt = w.now;
    e.windowStart.copy(e.position);
    if ((stuck || e.pathDist > STRAGGLER_PATH) && !(e.inView && e.hasLos)) this.rescue(e);
  }

  private bark(e: Enemy): void {
    const { w } = this;
    if (w.now < e.barkAt) return;
    e.barkAt = w.now + rand(4, 9);
    if (e.dist < 42 && e.maim.head && w.director.spendBark()) say(e, w, e.def.voice.bark, 0.55);
  }

  private perceive(e: Enemy, dt: number): void {
    const p = this.player;
    const dx = e.position.x - p.eye.x;
    const dy = e.position.y + e.def.chest - p.eye.y;
    const dz = e.position.z - p.eye.z;
    e.dist = Math.hypot(e.position.x - p.position.x, (e.position.y - p.position.y) * 0.6, e.position.z - p.position.z);
    const along = dx * p.forward.x + dy * p.forward.y + dz * p.forward.z;
    const total2 = dx * dx + dy * dy + dz * dz;
    const d = Math.sqrt(total2) || 1;
    e.inView = along / d > 0.62;
    // Crosshair check: distance from the look ray to the body, widened a little with range.
    const off2 = total2 - along * along;
    const tolerance = 0.9 + d * 0.012;
    if (along > 0 && off2 < tolerance * tolerance && e.hasLos) e.aimedAt += dt;
    else e.aimedAt = 0;
  }

  /** Burn, bleed and hazard checks. All of these can kill, so callers re-check alive afterwards. */
  private updateStatus(e: Enemy, dt: number): void {
    const skin = e.char as unknown as Skin;
    if (e.frozen > 0) {
      e.frozen -= dt;
      skin.setFrost(clamp(e.frozen * 2));
    }
    if (e.bleed > 0) {
      e.health -= e.bleed * dt;
      if (e.health <= 0) {
        const t = this.statusDamage(e, 'bleed', 'true', 1);
        e.health = 0.01;
        this.applyDamage(e, t);
        return;
      }
    }
    if (e.burning > 0) this.updateBurn(e, dt, skin);
    if (e.alive) this.updateHazard(e, dt);
  }

  private updateBurn(e: Enemy, dt: number, skin: Skin): void {
    const { ctx } = this;
    e.burning -= dt;
    if (e.burning <= 0) {
      e.burnEmitter?.stop();
      e.burnEmitter = null;
      return;
    }
    if (!e.burnEmitter) {
      e.burnEmitter = ctx.fx.attachEmitter(e.char.root, 'burning', _a.set(0, e.def.chest, 0));
      ctx.audio.play('char_sizzle', { position: e.center });
    }
    if (!e.def.fireproof) {
      e.charred = Math.min(1, e.charred + dt / CHAR_SECONDS);
      skin.setBurn(e.charred);
    }
    e.burnTick -= dt;
    if (e.burnTick > 0) return;
    e.burnTick = BURN_TICK;
    const n = this.query(e.position, BURN_SPREAD_RADIUS, this.nearby);
    for (let i = 0; i < n; i++) {
      const o = this.nearby[i]!;
      if (o !== e && o.burning <= 0) o.burning = 2.5;
    }
    if (!e.def.fireproof) this.applyDamage(e, this.statusDamage(e, 'burn', 'fire', 3 + e.maxHealth * 0.03));
  }

  /**
   * The map kills enemies the way it kills the player. Bosses wade through it: a Titan that dies to a floor is a
   * disappointment. Anything in the air is above it.
   */
  private updateHazard(e: Enemy, dt: number): void {
    if (e.isBoss || e.airborne || e.pinned || e.def.id === 'drone') return;
    const { ctx } = this;
    const h = ctx.world.objects.hazardAt(e.position);
    if (!h) {
      e.hazardTick = 0;
      return;
    }
    if (h.lethal) {
      const crushed = h.kind === 'crusher';
      const t = this.statusDamage(e, h.kind, crushed ? 'crush' : 'fire', e.health + 1);
      t.gib = crushed;
      if (h.kind === 'lava') {
        (e.char as unknown as Skin).setBurn(1);
        ctx.fx.embers(e.center, 24, 1.2);
        ctx.fx.smoke(e.position, 0x202020, 1.6, 0.8);
      }
      ctx.audio.play(crushed ? 'crusher_slam' : 'lava_burn', { position: e.position });
      this.model.kill(e, t, 'chest', null);
      return;
    }
    // Electric floors bite in readable jolts, each one a stagger, so a body caught on one visibly fights it.
    e.hazardTick -= dt;
    if (e.hazardTick > 0) return;
    e.hazardTick = HAZARD_TICK;
    ctx.fx.sparks(e.center, UP, 10, 0x8fd8ff);
    ctx.audio.play('electric_zap', { position: e.center });
    this.model.stagger(e, HAZARD_TICK);
    this.applyDamage(e, this.statusDamage(e, h.kind, 'shock', h.dps * HAZARD_TICK));
  }

  private statusDamage(e: Enemy, source: string, type: DamageInfo['type'], amount: number): DamageInfo {
    const t = this.tick;
    t.amount = amount;
    t.type = type;
    t.source = source;
    t.point.copy(e.center);
    t.dir.set(0, 1, 0);
    t.force = 0;
    t.gib = false;
    return t;
  }

  /** Comes back through a spawn point like a reinforcement, out of sight, so it never reads as a teleport. */
  rescue(e: Enemy): void {
    if (this.w.now < this.nextRescueAt) return;
    this.nextRescueAt = this.w.now + RESCUE_GAP;
    const point = this.spawner.pick(['ground', 'gate'], RESCUE_MIN_PATH, RESCUE_MAX_PATH);
    if (!point) return;
    this.rescues++;
    if (e.attack) finishAttack(e, this.w, true);
    e.position.copy(point.position);
    e.groundY = point.position.y;
    e.velocity.set(0, 0, 0);
    e.push.set(0, 0, 0);
    e.pinned = e.airborne = e.ballistic = false;
    e.verticalSpeed = e.flightLeft = 0;
    e.groundSampleAt.set(e.position.x, e.position.z);
    e.bestPath = Infinity;
    e.windowStart.copy(e.position);
    this.spawner.enter(e, point);
  }

  private updateEntrance(e: Enemy, dt: number): void {
    const { w, ctx } = this;
    if (e.entrance === 'gate') {
      e.entranceTime -= dt;
      e.position.addScaledVector(e.entranceDir, e.def.speed * 0.6 * dt);
      e.velocity.copy(e.entranceDir).multiplyScalar(e.def.speed * 0.6);
      const ground = ctx.world.nav.groundHeight(e.position.x, e.position.y + 1, e.position.z);
      if (!Number.isNaN(ground)) e.position.y = ground;
      if (e.entranceTime <= 0) e.entrance = 'none';
      return;
    }
    updateMovement(e, w, dt, this.alive);
    if (e.airborne) return;
    const kind = e.entrance;
    e.entrance = 'none';
    if (kind === 'boss') {
      ctx.camera.addTrauma(0.9);
      e.char.anim.play('roar');
      e.boss?.onLand?.(e, w);
    } else {
      e.char.anim.play('land');
      ctx.fx.dust(e.position, UP, 1.4);
      ctx.audio.play('body_thud', { position: e.position, pitch: 0.8, pitchJitter: 0.1 });
    }
  }

  private place(e: Enemy): void {
    const root = e.char.root;
    root.position.copy(e.position);
    root.rotation.y = e.yaw;
    e.center.copy(e.position);
    e.center.y += e.maim.legs === 0 ? e.def.chest * 0.4 : e.def.chest;
    if (e.ward > 0) this.telegraphs.placeWard(e.wardVisual, e.center, e.def.radius + 0.9, e.ward / 70);
  }

  private animate(e: Enemy, dt: number): void {
    const near = e.dist < 26 ? 0 : e.dist < 60 ? 1 : 2;
    // Bosses stay at full rate: their footfalls shake the camera, and a skipped frame is a skipped plant.
    e.lod = e.isBoss ? 0 : e.inView ? near : Math.min(near + 1, 3);
    const cos = Math.cos(e.yaw);
    const sin = Math.sin(e.yaw);
    const vx = e.velocity.x;
    const vz = e.velocity.z;
    const speed = Math.hypot(vx, vz);
    const l = this.loco;
    l.speed = speed;
    l.moveX = speed > 0.1 ? (vx * cos - vz * sin) / speed : 0;
    l.moveZ = speed > 0.1 ? (vx * sin + vz * cos) / speed : 0;
    const dx = this.player.position.x - e.position.x;
    const dz = this.player.position.z - e.position.z;
    let yawOff = Math.atan2(dx, dz) - e.yaw;
    yawOff = Math.atan2(Math.sin(yawOff), Math.cos(yawOff));
    const aiming = e.attack !== null || e.face === 'player';
    l.aimYaw = aiming ? clamp(yawOff, -1.2, 1.2) : 0;
    const flat = Math.hypot(dx, dz) || 1;
    l.aimPitch = aiming ? clamp(Math.atan2(this.player.eye.y - (e.position.y + e.def.eyeHeight), flat), -0.8, 0.8) : 0;
    l.grounded = !e.airborne;
    e.char.anim.setLocomotion(l);
    e.char.anim.update(dt, e.lod);
    (e.char as unknown as Skin).setLod(e.lod);
  }

  private updateDying(dt: number): void {
    const { w, ctx } = this;
    for (let i = this.dying.length - 1; i >= 0; i--) {
      const e = this.dying[i]!;
      e.dying -= dt;
      if (e.dyingKind === 'stumble') {
        // Gore holds the body; the legs just keep going for a moment, slowing as there is nothing left to steer them.
        const fade = Math.exp(-2.2 * dt);
        e.velocity.x *= fade;
        e.velocity.z *= fade;
        e.position.x += e.velocity.x * dt;
        e.position.z += e.velocity.z * dt;
        const ground = ctx.world.nav.groundHeight(e.position.x, e.position.y + 1, e.position.z);
        if (!Number.isNaN(ground) && Math.abs(ground - e.position.y) < 1.2) e.position.y = ground;
        e.char.root.position.copy(e.position);
      } else if (e.dyingKind === 'crash') {
        e.dying = this.updateCrash(e, dt) ? 0 : 1;
      } else if (e.dyingKind === 'boss') {
        e.boss!.dying(e, w, dt);
        e.char.anim.update(dt, 0);
      }
      if (e.dying > 0) continue;
      // Off the list before the last act. Its blast reaches into other systems, and if one of them throws, a body
      // still on this list would replay the blast every frame and stop every enemy and the wave director with it.
      this.dying.splice(i, 1);
      this.recycle.push(e);
      if (e.dyingKind === 'boss') e.boss!.finish(e, w);
      else if (e.dyingKind === 'crash') this.crashImpact(e);
    }
  }

  /** Falls and tumbles. True once it has hit the floor, or dropped out of the world with no floor to hit. */
  private updateCrash(e: Enemy, dt: number): boolean {
    const { ctx } = this;
    e.verticalSpeed -= 22 * dt;
    e.position.x += e.velocity.x * dt;
    e.position.z += e.velocity.z * dt;
    e.position.y += e.verticalSpeed * dt;
    const root = e.char.root;
    root.position.copy(e.position);
    root.rotation.x += dt * 5;
    root.rotation.z += dt * 7;
    const ground = ctx.world.nav.groundHeight(e.position.x, e.position.y + 1, e.position.z);
    if (Number.isNaN(ground)) return e.position.y < CRASH_FLOOR;
    return e.position.y <= ground + 0.3;
  }

  private crashImpact(e: Enemy): void {
    const { ctx } = this;
    ctx.combat.explode(e.position, { radius: 4.2, damage: 70, kind: 'barrel', source: 'drone', team: 'player', selfDamage: 0.3 });
    ctx.gore.gib(e.char, e.position, 300);
  }

  /** Two lost rotors, or the killing blow: goes down trailing smoke and hits the floor like a bomb. */
  crashDrone(e: Enemy): void {
    if (!e.alive) return;
    this.applyDamage(e, this.statusDamage(e, 'crash', 'true', e.health + 1));
  }

  startCrash(e: Enemy): void {
    e.dyingKind = 'crash';
    e.dying = 1;
    e.pinned = false;
    e.verticalSpeed = Math.min(e.velocity.y, 0);
    this.ctx.fx.attachEmitter(e.char.root, 'smokeTrail', undefined, 3);
    this.ctx.fx.sparks(e.center, UP, 14, 0xffd0a0);
  }

  private updateStrikes(): void {
    const { ctx, w } = this;
    for (const s of this.strikes) {
      if (!s.live || w.now < s.at) continue;
      s.live = false;
      _a.copy(s.position);
      _a.y += 34;
      ctx.fx.tracer(_a, s.position, 'heavy');
      ctx.combat.explode(s.position, { radius: s.radius, damage: s.damage, kind: 'enemy', source: s.source, team: 'enemy' });
    }
  }

  /** A shell on its way down: a ground circle first, then the blast. */
  strike(position: THREE.Vector3, delay: number, radius: number, damage: number, source: string): void {
    const s = this.strikes.find(x => !x.live);
    if (!s) return;
    s.live = true;
    s.at = this.w.now + delay;
    s.position.copy(position);
    s.radius = radius;
    s.damage = damage;
    s.source = source;
    this.telegraphs.zone(position, radius, delay);
  }

  // -------------------------------------------------------------------------------------------
  // Being shot at
  // -------------------------------------------------------------------------------------------

  /** Near misses count: enemies that hear rounds passing react before they are hit. */
  private onShot(origin: THREE.Vector3, dir: THREE.Vector3): void {
    for (let i = 0; i < this.alive.length; i++) {
      const e = this.alive[i]!;
      _a.subVectors(e.center, origin);
      const along = _a.dot(dir);
      if (along < 0) continue;
      const off2 = _a.lengthSq() - along * along;
      if (off2 < NEAR_MISS_RADIUS * NEAR_MISS_RADIUS) e.pressure = Math.min(1, e.pressure + 0.09);
    }
  }

  applyDamage(enemy: EnemyInstance, damage: DamageInfo): DamageResult {
    return this.model.apply(enemy as Enemy, damage);
  }

  emitHit(e: Enemy, d: DamageInfo, res: DamageResult): void {
    this.ctx.events.emit('enemy:hit', { enemy: e, damage: d, result: res });
  }

  // -------------------------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------------------------

  private rayEnemy(e: Enemy, origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, out: EnemyRayHit): boolean {
    _a.subVectors(e.center, origin);
    const along = _a.dot(dir);
    const reach = e.char.rig.height * 0.75 + 0.3;
    if (along < -reach || along > maxDist + reach) return false;
    if (_a.lengthSq() - along * along > reach * reach) return false;
    const hit = this.ctx.gore.raycastCharacter(e.char, origin, dir, maxDist);
    if (!hit) return false;
    out.enemy = e;
    out.distance = hit.distance;
    out.point.copy(hit.point);
    out.normal.copy(hit.normal);
    out.bone = hit.bone;
    out.region = hit.region;
    return true;
  }

  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): EnemyRayHit | null {
    const out = this.hitRing[this.hitHead]!;
    this.hitHead = (this.hitHead + 1) % this.hitRing.length;
    const test = this.allHits[0]!;
    let best = maxDist;
    let found = false;
    for (let i = 0; i < this.alive.length; i++) {
      if (!this.rayEnemy(this.alive[i]!, origin, dir, best, test) || test.distance >= best) continue;
      best = test.distance;
      found = true;
      out.enemy = test.enemy;
      out.distance = test.distance;
      out.point.copy(test.point);
      out.normal.copy(test.normal);
      out.bone = test.bone;
      out.region = test.region;
    }
    return found ? out : null;
  }

  raycastAll(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, limit: number): EnemyRayHit[] {
    _hits.length = 0;
    const max = Math.min(limit, this.allHits.length);
    let used = 0;
    for (let i = 0; i < this.alive.length; i++) {
      const slot = this.allHits[used]!;
      if (!this.rayEnemy(this.alive[i]!, origin, dir, maxDist, slot)) continue;
      _hits.push(slot);
      used++;
      if (used >= this.allHits.length) break;
    }
    _hits.sort((a, b) => a.distance - b.distance);
    if (_hits.length > max) _hits.length = max;
    return _hits;
  }

  query(center: THREE.Vector3, radius: number, out: EnemyInstance[]): number {
    out.length = 0;
    const r2 = radius * radius;
    for (let i = 0; i < this.alive.length; i++) {
      const e = this.alive[i]!;
      if (e.center.distanceToSquared(center) <= r2) out.push(e);
    }
    return out.length;
  }

  killAll(source: string): void {
    const list = this.frameList;
    list.length = 0;
    for (const e of this.alive) list.push(e);
    for (const e of list) {
      if (!e.alive) continue;
      const t = this.statusDamage(e, source, 'true', e.health * 2 + 1);
      this.model.kill(e, t, 'chest', null);
    }
  }

  /** The Titan's death takes the field with it. */
  killAllExcept(keep: Enemy, source: string): void {
    const n = this.alive.length;
    for (let i = n - 1; i >= 0; i--) {
      const e = this.alive[i];
      if (!e || e === keep) continue;
      const t = this.statusDamage(e, source, 'explosive', e.health * 2 + 1);
      t.force = 500;
      this.model.kill(e, t, 'chest', null);
    }
  }

  // -------------------------------------------------------------------------------------------
  // Helpers for behaviours
  // -------------------------------------------------------------------------------------------

  /** Nearest ally that is closer to the player than `e`, and not another support. */
  frontAlly(e: Enemy, radius: number): Enemy | null {
    let best: Enemy | null = null;
    let bestD = radius * radius;
    for (let i = 0; i < this.alive.length; i++) {
      const o = this.alive[i]!;
      if (o === e || o.id === 'warden' || o.dist > e.dist + 6) continue;
      const d = o.position.distanceToSquared(e.position);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    return best;
  }

  wardNearby(e: Enemy, radius: number, hp: number, maxTargets: number): void {
    const r2 = radius * radius;
    let given = 0;
    for (let i = 0; i < this.alive.length && given < maxTargets; i++) {
      const o = this.alive[i]!;
      if (o === e || o.isBoss || o.def.machine) continue;
      if (o.position.distanceToSquared(e.position) > r2) continue;
      o.buff = 1;
      if (o.ward > 0) {
        if (o.wardBy === e) given++;
        continue;
      }
      const visual = this.telegraphs.acquireWard();
      if (visual < 0) return;
      o.ward = hp;
      o.wardBy = e;
      o.wardVisual = visual;
      given++;
      this.ctx.fx.ring(o.center, UP, 0xffe9a0, 1.4);
      this.ctx.audio.play('warden_shield_up', { position: o.center });
    }
  }

  dropWard(e: Enemy): void {
    if (e.wardVisual >= 0) this.telegraphs.releaseWard(e.wardVisual);
    e.wardVisual = -1;
    e.ward = 0;
    e.wardBy = null;
  }

  /** Charging bosses plough through their own side. */
  trample(boss: Enemy, radius: number): void {
    const r = radius + 0.4;
    for (let i = this.alive.length - 1; i >= 0; i--) {
      const o = this.alive[i];
      if (!o || o === boss || o.isBoss) continue;
      if (o.position.distanceToSquared(boss.position) > r * r) continue;
      const t = this.statusDamage(o, 'trample', 'crush', o.health + 1);
      _dir.copy(o.position).sub(boss.position).setY(0.4).normalize();
      t.dir.copy(_dir);
      t.force = 700;
      this.model.kill(o, t, 'chest', null);
    }
  }

  /** The enemy's own blast. It is not a kill: nobody earned it. */
  selfDestruct(e: Enemy): void {
    if (!e.alive) return;
    const { ctx } = this;
    const t = e.def.tank;
    e.alive = false;
    this.detach(e);
    if (e.def.machine) ctx.audio.play('skitter_explode', { position: e.center });
    if (t) {
      e.tankBlown = true;
      ctx.combat.explode(e.center, {
        radius: t.radius * STRAY_TANK_RADIUS, damage: t.damage * STRAY_TANK_DAMAGE * e.damageMul, kind: 'enemy', source: e.id, team: 'enemy',
      });
    }
    ctx.gore.gib(e.char, e.center, 300);
    this.retire(e);
  }

  // -------------------------------------------------------------------------------------------
  // Lifecycle internals
  // -------------------------------------------------------------------------------------------

  private stopEffects(e: Enemy): void {
    if (e.attack) finishAttack(e, this.w, true);
    this.director.releaseAll(e);
    this.dropWard(e);
    e.burnEmitter?.stop();
    e.burnEmitter = null;
    e.bodyLoop?.stop(0.2);
    e.bodyLoop = null;
    if (e.id === 'warden') {
      // Its wards die with it, which is why it is the priority target.
      for (const o of this.alive) if (o.wardBy === e) this.dropWard(o);
    }
  }

  /** Takes a dying enemy out of the live list, leaving it in `dying` if it still has a death to play out. */
  detach(e: Enemy): void {
    this.stopEffects(e);
    const i = this.alive.indexOf(e);
    if (i >= 0) {
      const last = this.alive.pop()!;
      if (last !== e) this.alive[i] = last;
    }
  }

  /** Queues recycling. Listeners may still read the enemy until the frame ends. */
  retire(e: Enemy): void {
    this.recycle.push(e);
  }

  /** Puts an enemy with a death still playing on the dying list. Called by the damage model. */
  holdForDeath(e: Enemy): void {
    this.dying.push(e);
  }

  private flushRecycle(): void {
    for (const e of this.recycle) this.pool.release(e);
    this.recycle.length = 0;
  }

  /** For the sandbox and contact: staggers by the same rule as a hit. */
  stagger(e: Enemy, seconds: number): void {
    this.model.stagger(e, seconds);
  }

  describe(e: Enemy): string {
    return `${e.id}#${e.uid} ${(e.behaviour as Behaviour | null)?.name ?? '-'} ${e.attack?.name ?? ''} hp ${e.health.toFixed(0)}`;
  }
}
