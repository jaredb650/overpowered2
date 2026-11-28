/**
 * The enemy system: owns the pool, runs each enemy's frame, and answers queries from the rest of the game.
 *
 * Per-frame work is arithmetic only. Anything costly runs on a staggered tick: thinking on a per-enemy clock with
 * a frame cap, sight on the director's ray budget, and animation at a distance-based LOD.
 */
import * as THREE from 'three';
import { HumanoidBone as B, type GoreRegion } from '../characters/rig';
import { CG, type CharacterInstance, type Ctx, type DamageInfo, type LocomotionInput, type PlayerSystem, type RagdollOptions, type RayHit } from '../core/contracts';
import { SwayWorld } from '../characters/animation/sway';
import type { CollapseOptions, KnockdownOptions } from '../gore/muscles';
import type { DamageResult, EnemyId, EnemyInstance, EnemyRayHit, EnemySystem, WeaponId } from '../core/gameplay';
import { clamp, rand, TAU } from '../core/math';
import { Pool } from '../core/pool';
import { mountOfVehicle, PlayerSense, type AiWorld } from './aiWorld';
import { SPOIL } from './reactions';
import { PlateDebris, plateGeometry, plateMaterial, type Plate, type PlateSpec } from './armor';
import { shout } from './attacks';
import { finishAttack, thinkAttacks, thinkBehaviours, tickAttack, type Behaviour } from './brain';
import { fearsFire } from './behaviours';
import { updateContact } from './contact';
import { archetypeById } from '../characters/archetypes';
import { ENEMIES, LIMB_SIZE, waveScale, type Footfall } from './data';
import { DamageModel, STRAY_TANK_DAMAGE, STRAY_TANK_RADIUS, drainDarts, type HitFacts, type KillFacts } from './damage';
import { Director } from './director';
import { Enemy } from './Enemy';
import { updateMovement } from './movement';
import { EnemySpatialGrid } from './spatialGrid';
import { Outpost, outpostActive } from './outpost';
import { resetAirRadio } from './outpost/chatter/airRadio';
import { Spawner } from './spawner';
import { VehicleSystem, vehiclesActive } from './vehicles';
import { Telegraphs } from './telegraph';
import { MAX_ALIVE } from './waves';
import { HELMET } from './wounds/armour';
import { isMelee } from '../weapons/melee/data';
import { isGuest } from '../core/coop';
import { DevFlags } from '../core/devflags';
import { ACTIVE } from '../contracts/select';

const byDistance = (a: EnemyRayHit, b: EnemyRayHit) => a.distance - b.distance;
const _gridScratch: Enemy[] = [];
const _trampleScratch: Enemy[] = [];

/** The Crucible's helmeted types: the dangerous ones, so the armour says what to aim at. Troopers stay bare. */
const CRUCIBLE_HELMETS: ReadonlySet<EnemyId> = new Set<EnemyId>(['gunner', 'rocketeer']);

const MAX_THINKS_PER_FRAME = 14;
const THINK_INTERVAL = [0.12, 0.22, 0.4, 0.6] as const;
/** Pressure fades over about this many seconds without being shot at. */
const PRESSURE_DECAY = 0.28;
const NEAR_MISS_RADIUS = 2.2;
const NEAR_MISS_MAX_DIST = 45;
const MAX_STRIKES = 16;
const BURN_TICK = 0.25;
const BURN_SPREAD_RADIUS = 2.4;
/** Skin blackens to full char over about this many seconds on fire. */
const CHAR_SECONDS = 3.5;
/** Seconds of a Warden's speed boost after the aura last touched it. */
const BUFF_SECONDS = 2.5;
const HAZARD_TICK = 0.3;
/** Rate shock fades, in 1/s. */
const SHOCK_FADE = 1.3;
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
/** Seconds before a body that caught its balance on its muscles acts again, once gore hands it back standing. */
const STOOD_STAGGER = 0.2;
/** Co-op: how far a teammate's eye is taken to be above their feet. */
const SHOOTER_EYE = 1.6;
const NO_KILL_FACTS: KillFacts = { blast: null, shatter: false, heavyHead: false };
/** A player outrunning the tide strands a lot of it at once. It comes back in a trickle, not all on one frame. */
const RESCUE_GAP = 0.3;

/**
 * What a co-op guest's copy of a host enemy is shown as this frame (net/world/replicas.ts). `frozen` and `burning` are the
 * host's word and become the copy's own state; `feet` and `eye` are the player it is after, for where it aims.
 */
export interface ReplicaView {
  frozen: boolean;
  /** Frost on its skin, 0..1. */
  frost: number;
  burning: boolean;
  aiming: boolean;
  feet: THREE.Vector3 | null;
  eye: THREE.Vector3 | null;
  /** Legs it can stand on, 0-2. */
  legs: number;
  rising: boolean;
}

/** A guest's copy stays frozen or burning this long past the host's last word of it, seconds. */
const REPLICA_STATUS_HOLD = 0.3;

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
  /** Co-op guest: the host's `remaining` less its enemies alive, as last told (net/team.ts, 4 times a second). null: this page counts for itself. */
  hostMore: number | null = null;
  /**
   * The Crucible's health and damage rules, over the wave scale, and the wave its helmets start (0: never). Only its wave
   * director sets them, at the start of a run, and every reset puts them back, so Endless Humans and the Campaign never see them.
   */
  readonly tuning = { health: 1, damage: 1, helmetsFrom: 0 };
  get remaining(): number {
    // Co-op guest: the men still to come are in the host's queue, not this page's. What the host counts beyond the enemies
    // alive (its queue, less its prisoners) is added to the copies alive here, so the HUD's count is the host's.
    if (this.hostMore !== null) return Math.max(0, this.alive.length + this.hostMore);
    return this.alive.length + this.queued - (this.outpost?.prisoners ?? 0);
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
  /** The same for a body dying on its feet, and one knocked off them. */
  readonly collapseOptions: CollapseOptions & { velocity: THREE.Vector3 } = { velocity: new THREE.Vector3() };
  readonly collapseHit = { bone: 0, point: new THREE.Vector3(), dir: new THREE.Vector3(), force: 0 };
  readonly knockOptions: KnockdownOptions & { velocity: THREE.Vector3 } = { velocity: new THREE.Vector3() };
  readonly knockImpact = { dir: new THREE.Vector3(), strength: 0 };
  readonly knockTopple = new THREE.Vector3();
  readonly knockImpulses = [{ bone: 0, point: new THREE.Vector3(), impulse: new THREE.Vector3() }];
  readonly knockWound = { bone: 0, point: new THREE.Vector3() };

  /** The human faction's rules. Null on every other contract, which is what keeps the swarm game as it is. */
  readonly outpost: Outpost | null;
  /** Their machines. Null with no outpost, mission or range, for the same reason. */
  readonly vehicles: VehicleSystem | null;

  private readonly w: AiWorld;
  readonly model: DamageModel;
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

  readonly grid = new EnemySpatialGrid();
  private hasHazards = true;
  private uid = 0;
  private wave = 1;
  private thinks = 0;
  private nextRescueAt = 0;
  /** The Titan went down and took the field with it: the wave queue is cancelled. */
  fieldCleared = false;

  constructor(private readonly ctx: Ctx) {
    const self = this;
    // Prototype-backed view avoids Proxy + Reflect.get on every w.ctx.* property read while still
    // redirecting `player` to `ctx.coop.world.targetPlayer` in co-op.
    const ctxView = Object.create(ctx) as Ctx;
    Object.defineProperty(ctxView, 'player', {
      get: () => ctx.coop?.world?.targetPlayer ?? ctx.player,
      enumerable: true,
      configurable: true,
    });
    this.w = {
      ctx: ctxView,
      get director() { return self.director; },
      get telegraphs() { return self.telegraphs; },
      enemies: this,
      player: this.player,
      now: 0,
    };
    // A loose arm asks the world one thing: what is along this ray (characters/animation/sway.ts, the wall's stop).
    const wall: RayHit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0, surface: 'concrete', collider: null };
    SwayWorld.ray = (origin, dir, max, hit) => {
      const physics = this.ctx.physics as Partial<Ctx['physics']> | undefined;
      if (!physics?.raycastInto?.(origin, dir, max, CG.World, wall)) return false;
      hit.point.copy(wall.point);
      hit.normal.copy(wall.normal);
      return true;
    };
    this.director = new Director(this.w);
    this.telegraphs = new Telegraphs(ctx);
    this.debris = new PlateDebris(ctx);
    this.spawner = new Spawner(this.w, this);
    this.model = new DamageModel(this.w, this);
    this.outpost = outpostActive() ? new Outpost(this.w, this) : null;
    this.vehicles = vehiclesActive(this.outpost !== null) ? new VehicleSystem(this.w) : null;
    for (let i = 0; i < MAX_STRIKES; i++) {
      this.strikes.push({ at: 0, position: new THREE.Vector3(), radius: 0, damage: 0, source: '', live: false });
    }
  }

  init(ctx: Ctx): void {
    this.telegraphs.init();
    ctx.events.on('weapon:fired', e => this.onShot(e.origin, e.dir, e.weapon));
    this.outpost?.init();
    this.vehicles?.init();
  }

  reset(): void {
    for (let i = this.alive.length - 1; i >= 0; i--) {
      const e = this.alive[i]!;
      this.stopEffects(e);
      e.char.release();
      this.pool.release(e);
    }
    this.alive.length = 0;
    this.grid.dirty = true;
    for (const e of this.dying) {
      e.char.release();
      this.pool.release(e);
    }
    this.dying.length = 0;
    this.flushRecycle();
    for (const s of this.strikes) s.live = false;
    this.queued = 0;
    this.hostMore = null;
    this.wave = 1;
    this.tuning.health = this.tuning.damage = 1;
    this.tuning.helmetsFrom = 0;
    this.linksTaken = this.rescues = this.nextRescueAt = 0;
    this.fieldCleared = false;
    this.director.reset();
    this.telegraphs.clear();
    this.debris.clear();
    this.spawner.reset();
    this.outpost?.reset();
    resetAirRadio();
    this.vehicles?.reset();
  }

  /** The AI's view of the game, for co-op's copies of attacks and warnings (net/world/attacks.ts, warnings.ts). */
  get aiWorld(): AiWorld {
    return this.w;
  }

  /** Co-op guest: the host's Crucible rules as the numbers every copy is made with (the waves set the same three as a run starts, `Waves.start`). */
  tune(rules: { healthPct: number; damagePct: number; helmetsFrom: number }): void {
    this.tuning.health = rules.healthPct / 100;
    this.tuning.damage = rules.damagePct / 100;
    this.tuning.helmetsFrom = rules.helmetsFrom;
  }

  /** The wave the next spawn is scaled for (`waveScale`). */
  get level(): number {
    return this.wave;
  }

  setWave(wave: number): void {
    this.wave = wave;
    this.director.setWave(wave);
    this.outpost?.setWave(wave);
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
    const cap = ACTIVE.def.id === 'endless_war' ? 68 : MAX_ALIVE;
    if (this.alive.length >= cap) return null;
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
    e.maxHealth = e.health = def.hp * scale.health * this.tuning.health;
    e.damageMul = scale.damage * this.tuning.damage;
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

    this.initLimbHp(e);

    if (def.plates) this.fitPlates(e, def.plates);
    else if (CRUCIBLE_HELMETS.has(id) && this.tuning.helmetsFrom > 0 && this.wave >= this.tuning.helmetsFrom) this.fitPlates(e, [HELMET]);
    if (def.boss) e.boss = def.boss(e, this.w);
    if (def.footfall) this.fitFootfall(char, def.footfall);
    if (def.loop) e.bodyLoop = ctx.audio.startLoop(def.loop, { position });

    e.alive = true;
    this.alive.push(e);
    this.grid.dirty = true;
    const preMax = e.maxHealth;
    this.outpost?.onSpawn(e);
    if (e.maxHealth !== preMax) this.initLimbHp(e);
    this.place(e);
    ctx.events.emit('enemy:spawned', { enemy: e });
    return e;
  }

  private initLimbHp(e: Enemy): void {
    const def = e.def;
    for (const key in LIMB_SIZE) {
      const region = key as GoreRegion;
      e.limbHp.set(region, e.maxHealth * def.limbFrac * LIMB_SIZE[region]!);
    }
    if (e.id === 'drone') e.limbHp.set('abdomen', e.maxHealth * 0.3);
    e.limbHp.set('head', def.headPoolFixed ? def.headPool : e.maxHealth * def.headPool);
  }

  /** Silently removes a living scripted enemy (e.g. an ejected pilot splashing into the sea) without awarding kill score. */
  despawn(e: Enemy): void {
    const idx = this.alive.indexOf(e);
    if (idx < 0) return;
    this.alive.splice(idx, 1);
    e.alive = false;
    e.pinned = false;
    e.scriptedNpc = false;
    this.stopEffects(e);
    this.director.releaseAll(e);
    this.outpost?.onDetach(e);
    this.ctx.gore?.releaseChar?.(e.char);
    e.char.release();
    this.pool.release(e);
    this.grid.dirty = true;
  }

  /** Plates live on the pooled character for good, so a respawn re-seats them instead of building new ones. */
  fitPlates(e: Enemy, specs: readonly PlateSpec[]): void {
    let meshes = this.plateMeshes.get(e.char);
    if (!meshes) {
      const def = archetypeById(e.char.archetype);
      meshes = specs.map(spec => {
        // His helmet is already on his head as a baked prop: that is the plate, so shooting it off bares his head.
        const model = spec.worn && def.props.find(p => p.socket === spec.worn)?.model;
        const prop = model && e.char.bones[spec.bone]!.getObjectByName(model);
        if (prop instanceof THREE.Mesh) return prop;
        const mesh = new THREE.Mesh(plateGeometry(spec), plateMaterial(this.ctx));
        mesh.castShadow = true;
        this.ctx.render.registerBatchedProp?.(mesh);
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
      const worn = mesh.material !== plateMaterial(this.ctx);
      this.debris.release(mesh);
      e.char.bones[spec.bone]!.add(mesh);
      if (worn) {
        // Where the head socket mounts it, at the body's scale, as `fitProps` first put it.
        mesh.position.set(0, 0, 0);
        mesh.rotation.set(0, 0, 0);
        mesh.scale.setScalar(archetypeById(e.char.archetype).proportions.scale);
      } else {
        mesh.position.set(spec.offset[0], spec.offset[1], spec.offset[2]);
        mesh.rotation.set(spec.tilt?.[0] ?? 0, spec.tilt?.[1] ?? 0, spec.tilt?.[2] ?? 0);
        mesh.scale.setScalar(1);
      }
      mesh.visible = true;
      const hp = spec.hp * e.maxHealth;
      total += hp;
      plates.push({ spec, hp, mesh, worn });
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
  spawnBoss(id: EnemyId, at?: THREE.Vector3): Enemy | null {
    const landing = at ?? this.spawner.pickArena(34, 64)?.position;
    if (!landing) return null;
    const e = this.spawn(id, landing);
    if (!e) return null;
    e.entrance = 'boss';
    e.airborne = true;
    e.position.y += 42;
    e.verticalSpeed = -46;
    this.telegraphs.zone(landing, id === 'titan' ? 16 : 9, 0.9, 0xff5a1e);
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
    if (isGuest(ctx)) {
      // A guest runs no AI, but it does show the host's attacks: the warnings tick, and being shot at tells (suppression).
      this.sensePlayer();
      ctx.coop.world.updateGuests();
      this.updateDying(dt);
      this.telegraphs.update(dt);
      this.outpost?.suppression.update(dt);
      // What the villain's jammer does to this player's own sonar and minimap, from the host's word.
      this.outpost?.commander.jam.updateGuest();
      this.debris.update(dt);
      this.flushRecycle();
      return;
    }
    this.sensePlayer();
    director.beginFrame();
    director.updateSight(this.alive);
    this.outpost?.update(dt);
    // Ahead of the men, so a gunner stands on this frame's truck and not last frame's.
    this.vehicles?.update(dt);
    this.thinks = 0;

    // Detect hazard-free maps once per frame so updateHazard() early-outs across all live enemies.
    const objs = ctx.world.objects as (typeof ctx.world.objects & {
      lava?: readonly unknown[];
      crushers?: readonly unknown[];
      electric?: readonly unknown[];
    }) | undefined;
    if (!objs?.hazardAt) {
      this.hasHazards = false;
    } else if (Array.isArray(objs.lava) && Array.isArray(objs.crushers) && Array.isArray(objs.electric)) {
      this.hasHazards = objs.killY != null || objs.lava.length > 0 || objs.crushers.length > 0 || objs.electric.length > 0;
    } else {
      this.hasHazards = true;
    }

    this.grid.rebuild(this.alive);
    const list = this.frameList;
    list.length = 0;
    for (let i = 0; i < this.alive.length; i++) list.push(this.alive[i]!);
    for (let i = 0; i < list.length; i++) {
      const e = list[i]!;
      if (e.alive) this.updateEnemy(e, dt);
    }
    if (ctx.coop?.world) {
      ctx.coop.world.targetPlayer = null;
      this.sensePlayer();
    }
    this.updateDying(dt);
    this.updateStrikes();
    this.telegraphs.update(dt);
    this.debris.update(dt);
    this.flushRecycle();
  }

  /**
   * Co-op host: from now until the next call, "the player" is `player` for everything that reads the AI's picture of one
   * (`w.player`, and `ctx.player` inside the enemy system): what a squad, a spotter, a trap or a mortar does outside any one
   * enemy's own update is done about the player it concerns, as `select` does for each enemy inside it. `null` puts the
   * host's own player back, which is what must be left behind. Alone, and on a guest, it does nothing: there is one player.
   */
  focus(player: PlayerSystem | null): void {
    const coop = this.ctx.coop;
    const world = coop?.world;
    if (!world || !coop!.hosting) return;
    const other = player && player !== this.ctx.player ? player : null;
    world.targetPlayer = other;
    this.sensePlayer();
    // A friend's Ghost is their own, told to the host; the host's own perks are not theirs.
    if (other) this.player.ghost = world.ghosted(other);
  }

  private sensePlayer(): void {
    const p = this.player;
    const src = this.w.ctx.player;
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

    // Detect occupied player vehicle or Distraint Frame without allocating per frame.
    const prog = this.ctx.progression as unknown as {
      driveables?: {
        active?: {
          def: { id: import('../vehicles/drive/types').DriveVehicleId; stealth?: boolean };
          phys: { position: THREE.Vector3; velocity: THREE.Vector3; altitude: number; deployed: boolean; speed: number; grounded: boolean };
          hud?: { ccipWorld: readonly [number, number, number] | null; ccipLabel: string };
        } | null;
      };
      frame?: { occupied?: boolean };
    } | undefined;
    const veh = src === this.ctx.player ? prog?.driveables?.active ?? null : null;
    const inFrame = !veh && src === this.ctx.player && Boolean(prog?.frame?.occupied);
    if (veh) {
      p.mount = mountOfVehicle(veh.def.id);
      p.vehicleId = veh.def.id;
      p.altitude = Math.max(0, veh.phys.altitude);
      p.airborne = p.mount === 'jet' || p.mount === 'chopper' ? p.altitude > 3.2 || !veh.phys.grounded : p.altitude > 5.5;
      p.heavyArmor = p.mount === 'armor';
      p.stealth = Boolean(veh.def.stealth);
      p.deployedBunker = veh.def.id === 'bastion' && veh.phys.deployed;
      p.chest.copy(veh.phys.position);
      p.velocity.copy(veh.phys.velocity);
      p.speed = Math.max(p.speed, veh.phys.speed);
      const ccip = veh.hud?.ccipWorld ?? null;
      if (ccip) {
        p.ccipActive = true;
        p.ccipPos.set(ccip[0], ccip[1], ccip[2]);
        const lbl = veh.hud?.ccipLabel ?? '';
        p.ccipKind = lbl.includes('NAPALM') ? 'napalm'
          : lbl.includes('CLUSTER') ? 'cluster'
            : lbl.includes('CHUTE') || lbl.includes('SNAKE') ? 'chute'
              : lbl.includes('THERMO') ? 'thermobaric'
                : lbl.includes('MOAB') ? 'moab'
                  : 'he';
      } else {
        p.ccipActive = false;
        p.ccipKind = null;
      }
    } else if (inFrame) {
      p.mount = 'frame';
      p.vehicleId = 'frame';
      const navGy = this.ctx.world?.nav?.groundHeight?.(src.position.x, src.position.y + 4, src.position.z);
      p.altitude = Number.isFinite(navGy) ? Math.max(0, src.position.y - navGy!) : Math.max(0, src.position.y);
      p.airborne = !src.grounded && p.altitude > 5.5;
      p.heavyArmor = true;
      p.stealth = false;
      p.deployedBunker = false;
      p.chest.y = src.position.y + 1.8;
      p.ccipActive = false;
      p.ccipKind = null;
    } else {
      p.mount = 'foot';
      p.vehicleId = null;
      const navGy = this.ctx.world?.nav?.groundHeight?.(src.position.x, src.position.y + 4, src.position.z);
      p.altitude = Number.isFinite(navGy) ? Math.max(0, src.position.y - navGy!) : Math.max(0, src.position.y);
      p.airborne = !src.grounded && p.altitude > 6.5;
      p.heavyArmor = false;
      p.stealth = false;
      p.deployedBunker = false;
      p.ccipActive = false;
      p.ccipKind = null;
    }
  }

  private updateEnemy(e: Enemy, dt: number): void {
    const { w, player } = this;
    const world = this.ctx.coop?.world;
    if (world) {
      world.select(e, player);
      e.quarry = world.targetPlayer;
    }
    this.perceive(e, dt);
    this.updateStatus(e, dt);
    if (!e.alive) return;
    e.bodyLoop?.setPosition(e.center);
    e.shock *= Math.exp(-SHOCK_FADE * dt);
    if (e.shaken > 0) e.shaken = Math.max(0, e.shaken - dt / SPOIL.seconds);
    if (e.downed) {
      this.updateDowned(e);
      if (!e.downed && e.alive) this.animate(e, dt);
      return;
    }

    if (e.frozen > 0) {
      updateContact(e, w);
      this.place(e);
      return;
    }
    if (e.stagger > 0) e.stagger -= dt;
    if (e.rising > 0) e.rising -= dt;
    if (e.fallIn > 0) {
      e.fallIn -= dt;
      if (e.fallIn <= 0) this.model.fall(e);
      if (e.downed) return;
    }
    e.pressure = Math.max(0, e.pressure - PRESSURE_DECAY * dt);
    e.buff = Math.max(0, e.buff - dt / BUFF_SECONDS);

    if (e.entrance !== 'none') {
      this.updateEntrance(e, dt);
    } else if (e.scriptedNpc) {
      if (e.mode !== 'hold') updateMovement(e, w, dt, this.alive);
      updateContact(e, w);
      if (e.downed) return;
    } else {
      if (w.now >= e.thinkAt && this.thinks < MAX_THINKS_PER_FRAME && e.stagger <= 0) {
        this.thinks++;
        e.thinkAt = w.now + THINK_INTERVAL[e.lod]! * rand(0.85, 1.15);
        this.thinkRoute(e);
        thinkBehaviours(e, w);
        // Panic takes the hands too, but the ones built to burn, and the dead, keep fighting.
        if (player.alive && (e.burning <= 0 || !fearsFire(e))) thinkAttacks(e, w);
        this.bark(e);
      }
      e.behaviour?.frame?.(e, w, dt);
      tickAttack(e, w, dt);
      if (!e.alive) return;
      updateMovement(e, w, dt, this.alive);
      updateContact(e, w);
      // Run over (`DamageModel.bodyCheck`): gore has the bones now. Animated on top, the hips would read as an instance the
      // library took back, and gore would let go the same frame.
      if (e.downed) return;
    }
    this.place(e);
    this.animate(e, dt);
  }

  /** Gore has the body and tells us where it got to. When it stops telling us, the body is ours again and getting up. */
  private updateDowned(e: Enemy): void {
    const { ctx } = this;
    const down = ctx.gore.downed(e.char);
    if (down) {
      const c = down.center;
      if (c.y < CRASH_FLOOR) {
        this.applyDamage(e, this.statusDamage(e, 'fell', 'true', e.health + 1));
        return;
      }
      const navGy = ctx.world?.nav?.groundHeight?.(c.x, c.y + 0.5, c.z);
      const floorY = navGy !== undefined && Number.isFinite(navGy) && navGy <= c.y + 0.5
        ? navGy
        : Math.min(e.groundY, c.y - e.def.chest);
      e.groundY = floorY;
      e.position.set(c.x, Math.max(c.y - e.def.chest, floorY), c.z);
      e.center.copy(c);
      return;
    }
    const root = e.char.root;
    e.downed = e.airborne = false;
    e.position.copy(root.position);
    e.yaw = root.rotation.y;
    e.groundY = root.position.y;
    e.groundSampleAt.set(root.position.x, root.position.z);
    e.lastProgress.copy(root.position);
    e.thinkAt = 0;
    // It caught its balance on its feet (`gore/stand.ts`): there is nothing to get up from, and it is itself again at once.
    if (ctx.gore.handedBack(e.char) === 'stand') {
      e.rising = 0;
      e.stagger = STOOD_STAGGER;
      this.place(e);
      return;
    }
    const rise = e.maim.legs === 0 ? 0 : e.riseSeconds;
    e.rising = rise;
    e.stagger = rise + e.dazeSeconds;
    if (e.dazeSeconds > 0) e.char.anim.daze?.(rise + e.dazeSeconds);
    this.place(e);
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
    if (e.dist < 42 && e.maim.head && w.director.spendBark()) shout(e, w, e.def.voice.bark, 0.55);
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
    // Flechette holes drain what they hold (damage.ts drainDarts), on top of any open stump.
    const darts = drainDarts(e.darts, dt);
    e.darts -= darts;
    if (e.bleed > 0 || darts > 0) {
      e.health -= e.bleed * dt + darts;
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
      this.burnOut(e);
      return;
    }
    this.burnLook(e, dt, skin);
    e.burnTick -= dt;
    if (e.burnTick > 0) return;
    e.burnTick = BURN_TICK;
    const n = this.query(e.position, BURN_SPREAD_RADIUS, this.nearby);
    for (let i = 0; i < n; i++) {
      const o = this.nearby[i]!;
      if (o !== e && o.burning <= 0) {
        o.burning = 2.5;
        // Co-op: a death by this new fire is whose the first fire was (net/world/credit.ts).
        ctx.coop?.world?.burnSpread?.(e, o);
      }
    }
    if (!e.def.fireproof) this.applyDamage(e, this.statusDamage(e, 'burn', 'fire', 3 + e.maxHealth * 0.03));
  }

  /**
   * What burning looks and sounds like: the flames on it, the sizzle as they catch, its skin charring. Hurts nothing.
   * The flames are gore's (gore/fire.ts): off the whole body, and the corpse's after it. The char rises with time here and
   * with fire damage taken in the damage model (`FIRE_CHAR`), so a quick death by fire is as black as a slow one.
   */
  private burnLook(e: Enemy, dt: number, skin: Skin): void {
    const { ctx } = this;
    const fire = DevFlags.fire ? ctx.gore.alight : undefined;
    if (!e.alight) {
      e.alight = true;
      ctx.audio.play('char_sizzle', { position: e.center });
    }
    if (fire) {
      ctx.gore.alight!(e.char, e.def.fireproof);
    } else if (!e.burnEmitter) {
      // Fire as it was (`?fire=0`), and for a stand-in gore: one emitter, on the chest and not over the root, which a body
      // thrown by a blast leaves lying 1.2 m under the flames.
      const chest = e.char.rig.bones[B.chest]?.name === 'chest';
      e.burnEmitter = chest ? ctx.fx.attachEmitter(e.char.bones[B.chest]!, 'burning') : ctx.fx.attachEmitter(e.char.root, 'burning', _a.set(0, e.def.chest, 0));
    }
    if (!e.def.fireproof) {
      e.charred = Math.min(1, e.charred + dt / CHAR_SECONDS);
      skin.setBurn(e.charred);
    }
  }

  /** Its fire is out, or it is dead and the fire is its corpse's (gore's) from here. */
  private burnOut(e: Enemy): void {
    e.alight = false;
    e.burnEmitter?.stop();
    e.burnEmitter = null;
  }

  /**
   * The map kills enemies the way it kills the player. Bosses wade through it: a Titan that dies to a floor is a
   * disappointment. Anything in the air is above it.
   */
  private updateHazard(e: Enemy, dt: number): void {
    const aloft = e.airborne && (!e.downed || e.position.y > e.groundY + 0.8);
    if (!this.hasHazards || e.isBoss || aloft || e.pinned || e.def.id === 'drone') return;
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

  /** `aiming`, `feet` and `eye` are the player's unless a co-op guest's copy says who it is after (`placeReplica`). */
  private animate(e: Enemy, dt: number, aiming = e.attack !== null || e.face === 'player', feet: THREE.Vector3 = this.player.position, eye: THREE.Vector3 = this.player.eye): void {
    const near = e.dist < 26 ? 0 : e.dist < 60 ? 1 : 2;
    // Bosses stay at full rate: their footfalls shake the camera, and a skipped frame is a skipped plant.
    // Off-screen enemies beyond 18 m freeze at LOD 3; closer ones behind/beside the player keep animating for shadows.
    e.lod = e.isBoss ? 0 : e.inView ? near : e.dist > 18 ? 3 : Math.min(near + 1, 2);
    const cos = Math.cos(e.yaw);
    const sin = Math.sin(e.yaw);
    const vx = e.velocity.x;
    const vz = e.velocity.z;
    const speed = Math.hypot(vx, vz);
    const l = this.loco;
    l.speed = speed;
    l.moveX = speed > 0.1 ? (vx * cos - vz * sin) / speed : 0;
    l.moveZ = speed > 0.1 ? (vx * sin + vz * cos) / speed : 0;
    const dx = feet.x - e.position.x;
    const dz = feet.z - e.position.z;
    let yawOff = Math.atan2(dx, dz) - e.yaw;
    yawOff = Math.atan2(Math.sin(yawOff), Math.cos(yawOff));
    l.aimYaw = aiming ? clamp(yawOff, -1.2, 1.2) : 0;
    const flat = Math.hypot(dx, dz) || 1;
    l.aimPitch = aiming ? clamp(Math.atan2(eye.y - (e.position.y + e.def.eyeHeight), flat), -0.8, 0.8) : 0;
    l.grounded = !e.airborne;
    e.char.anim.setLocomotion(l);
    const drawn = this.drawnLod(e);
    e.char.anim.update(dt, drawn);
    (e.char as unknown as Skin).setLod(drawn);
  }

  /**
   * The level of detail an enemy is drawn and animated at on this screen. Alone, and on a co-op guest, it is `e.lod`. On a
   * co-op host `e.lod` is the AI's: `e.dist` and `e.inView` are measured from the player the enemy is after (`perceive`),
   * who may be a guest at the far end of the map, and an enemy beside the host that hunts that guest would move at the
   * far, skipped-frame rate. So the host draws by its own eye, and the AI keeps its own number.
   */
  private drawnLod(e: Enemy): number {
    return e.isBoss ? e.lod : this.localView(e).lod;
  }

  private readonly seen = { dist: 0, inView: false, lod: 0 };

  /**
   * How this screen's own player sees `e`: how far, in view or not, and the level of detail that gives. Alone and on a
   * guest that is what `e.dist`, `e.inView` and `e.lod` already are. On a co-op host those three are measured from the
   * player the enemy is after, for its AI: anything that is only for the eye (the level of detail it is drawn at, a
   * struck part on physics) goes by this, or an enemy beside the host that hunts a far guest is shown as a far one.
   * The answer is one shared object: read it, do not keep it.
   */
  localView(e: Enemy): { readonly dist: number; readonly inView: boolean; readonly lod: number } {
    const out = this.seen;
    const coop = this.ctx.coop;
    if (!coop?.world || !coop.hosting) {
      out.dist = e.dist;
      out.inView = e.inView;
      out.lod = e.lod;
      return out;
    }
    const p = this.ctx.player;
    const dist = Math.hypot(e.position.x - p.position.x, (e.position.y - p.position.y) * 0.6, e.position.z - p.position.z);
    const dx = e.position.x - p.eye.x;
    const dy = e.position.y + e.def.chest - p.eye.y;
    const dz = e.position.z - p.eye.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    const inView = (dx * p.forward.x + dy * p.forward.y + dz * p.forward.z) / d > 0.62;
    const near = dist < 26 ? 0 : dist < 60 ? 1 : 2;
    out.dist = dist;
    out.inView = inView;
    out.lod = e.isBoss ? 0 : inView ? near : dist > 18 ? 3 : Math.min(near + 1, 2);
    return out;
  }

  private updateDying(dt: number): void {
    const { w, ctx } = this;
    for (let i = this.dying.length - 1; i >= 0; i--) {
      const e = this.dying[i]!;
      e.dying -= dt;
      if (e.dyingKind === 'crash') {
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
    let s: Strike | null = null;
    for (let i = 0; i < this.strikes.length; i++) {
      if (!this.strikes[i]!.live) {
        s = this.strikes[i]!;
        break;
      }
    }
    if (!s) return;
    s.live = true;
    s.at = this.w.now + delay;
    s.position.copy(position);
    s.radius = radius;
    s.damage = damage;
    s.source = source;
    this.telegraphs.zone(position, radius, delay);
    this.ctx.coop?.world?.warnings.strike(position, delay);
  }

  // -------------------------------------------------------------------------------------------
  // Being shot at
  // -------------------------------------------------------------------------------------------

  /** Near misses count: enemies that hear rounds passing react before they are hit. */
  private onShot(origin: THREE.Vector3, dir: THREE.Vector3, weapon?: WeaponId): void {
    if (weapon && isMelee(weapon)) return;
    for (let i = 0; i < this.alive.length; i++) {
      const e = this.alive[i]!;
      _a.subVectors(e.center, origin);
      const along = _a.dot(dir);
      if (along < 0 || along > NEAR_MISS_MAX_DIST) continue;
      const off2 = _a.lengthSq() - along * along;
      if (off2 >= NEAR_MISS_RADIUS * NEAR_MISS_RADIUS) continue;
      if (this.ctx.physics && !this.director.clearLine(origin, e.center)) continue;
      e.pressure = Math.min(1, e.pressure + 0.09);
    }
  }

  applyDamage(enemy: EnemyInstance, damage: DamageInfo): DamageResult {
    const world = this.ctx.coop?.world;
    if (world && !this.ctx.coop!.hosting) return world.claim(enemy, damage);
    if (world) this.sensePlayer();
    // A guest's claim: the damage model's player is that guest (the proxy above), and gore sizes by range from their eye.
    this.model.shooter = world?.notMine() ? this.player.eye : null;
    return this.model.apply(enemy as Enemy, damage);
  }

  /**
   * Fire, frost and the live bolt, from anything of the player's: the same write a weapon used to make itself. On a co-op guest
   * the enemy is a copy, so the host is told too (net/world/claims.ts `status`) and does this for real.
   */
  afflict(enemy: EnemyInstance, kind: 'burn' | 'freeze' | 'bolt', seconds: number): void {
    const e = enemy as Enemy;
    if (kind === 'burn') e.burning = Math.max(e.burning, seconds);
    else if (kind === 'freeze') e.frozen = seconds;
    else e.bolted = this.ctx.time.elapsed + seconds;
    // The host is told (a guest), or notes whose fire it is for the death it may end in (the host).
    this.ctx.coop?.world?.status?.(enemy, kind, seconds);
  }

  /**
   * Co-op guest: the local player's own hit on a copy of the host's enemy, shown now and decided by the host later
   * (`DamageModel.predict`). The result is this machine's guess.
   */
  predictDamage(enemy: Enemy, damage: DamageInfo): DamageResult {
    this.sensePlayer();
    this.model.shooter = null;
    return this.model.predict(enemy, damage);
  }

  /** The damage model's player is whoever fired: the local player, or a teammate standing at `eye`. */
  private senseShooter(eye: THREE.Vector3 | null): void {
    this.sensePlayer();
    this.model.shooter = eye;
    if (!eye) return;
    const p = this.player;
    p.eye.copy(eye);
    p.position.copy(eye);
    p.position.y -= SHOOTER_EYE;
    p.chest.copy(p.position);
    p.chest.y += 1;
  }

  /** Co-op guest: a hit the host decided, shown from its findings. `eye` is the shooter's when it was a teammate. */
  showDamage(enemy: Enemy, damage: DamageInfo, told: HitFacts, eye: THREE.Vector3 | null): DamageResult {
    this.senseShooter(eye);
    const result = this.model.show(enemy, damage, told);
    this.model.shooter = null;
    return result;
  }

  /** Co-op guest: what the host's body did about a hit already drawn here, and nothing else of it (`DamageModel.reactShown`). */
  showReaction(enemy: Enemy, damage: DamageInfo, told: HitFacts, reaction = true): void {
    this.senseShooter(null);
    this.model.reactShown(enemy, damage, told, reaction);
  }

  /** Co-op guest: a cut the host decided, through the damage model's own path. `mine`: the local player's shot made it. */
  showSever(enemy: Enemy, region: GoreRegion, damage: DamageInfo, eye: THREE.Vector3 | null, mine: boolean): void {
    this.senseShooter(eye);
    this.model.severShown(enemy, region, damage, mine);
    this.model.shooter = null;
  }

  /**
   * Co-op guest: a copy's limb pools were sized at its making for the health this page would have given it (its own wave,
   * its own rules); the host's enemy has `maxHealth`. The pools are scaled to that, so each limb is as whole on the copy as
   * on the host. A limb's strength is its pool over the body's whole health (`poolStrength`): left alone, a copy of an enemy
   * with twice the health read as a body with every limb half gone, could not catch its balance and could not push itself
   * up off the floor (it lay about 2 s longer than the host's body, out of the line of fire). Sets `maxHealth` too, and
   * scales his armour plates with it.
   */
  fitReplicaHealth(e: Enemy, maxHealth: number): void {
    const built = e.maxHealth;
    e.maxHealth = maxHealth;
    if (!(built > 0) || !(maxHealth > 0) || built === maxHealth) return;
    const ratio = maxHealth / built;
    for (const [region, hp] of e.limbHp) if (region !== 'head' || !e.def.headPoolFixed) e.limbHp.set(region, hp * ratio);
    // His plates were cut from the same wrong health (a plate's strength is a share of the body's, `fitPlates`): a copy's
    // helmet came off under fewer rounds than the host's, or more, and this screen's guess at the hit behind it was wrong.
    for (const plate of e.plates) plate.hp *= ratio;
    e.armor *= ratio;
  }

  /**
   * Co-op guest: the host's word on a soldier's rank, after the copy was fitted (`fitReplicaHealth`). A rank's toughness
   * multiplies a man's health **after** his limb pools (and any plates his kind is born with) are cut, so the host's pools
   * are a share of his health before it; the copy's were scaled by the host's whole health over this page's, which holds
   * this page's own roll of his rank. `was` is the toughness this page gave him, `now` the host's: the pools are put right
   * by one over the other. (The browser proof read a copy's limbs 15 and 35 % stronger than the host's man's.)
   */
  rerankReplica(e: Enemy, was: number, now: number): void {
    if (!(was > 0) || !(now > 0) || was === now) return;
    const ratio = was / now;
    for (const [region, hp] of e.limbHp) if (region !== 'head' || !e.def.headPoolFixed) e.limbHp.set(region, hp * ratio);
    if (!e.def.plates) return;
    for (const plate of e.plates) plate.hp *= ratio;
    e.armor *= ratio;
  }

  /** Co-op guest: the host's word that this copy should not be on the floor (its answer to a hit this machine guessed wrong). */
  rouseReplica(enemy: Enemy): void {
    if (enemy.downed && !this.ctx.gore.downed(enemy.char)?.standing) this.ctx.gore.rouse?.(enemy.char);
  }

  /**
   * A co-op guest's copy of a host enemy, where net/world/replicas.ts has just put it, in the posture the host says. With a
   * `view` it also carries the host's word on its body: frozen and burning become its own state (so a shatter is a shatter,
   * and it burns and chars as the host's does, hurting nothing), and it aims at the player it is after.
   */
  placeReplica(enemy: Enemy, dt: number, posture: string, view?: ReplicaView): void {
    if (view) this.replicaStatus(enemy, dt, view);
    // The reactions this page's gore started on it from a hit (lane "gore"): its shock fades as the host's does, a fall it
    // staggered into comes due, and what its hits pushed it by is dropped, because the host's position is where it stands.
    // (Its own ragdoll, once it is down, is replicas.ts's to wait out.)
    enemy.shock *= Math.exp(-SHOCK_FADE * dt);
    if (enemy.fallIn > 0) {
      enemy.fallIn -= dt;
      if (enemy.fallIn <= 0) {
        this.model.fallShown(enemy);
        // Gore has the bones from here: posed on top, it would read as an instance the library took back.
        if (this.ctx.gore.downed(enemy.char)) return;
      }
    }
    enemy.reel.set(0, 0, 0);
    enemy.push.set(0, 0, 0);
    this.place(enemy);
    enemy.dist = enemy.position.distanceTo(this.ctx.player.position);
    enemy.inView = true;
    (enemy.char.anim as unknown as { setPosture?(posture: string): void }).setPosture?.(posture);
    if (view?.feet && view.eye) this.animate(enemy, dt, view.aiming, view.feet, view.eye);
    else this.animate(enemy, dt, false);
    enemy.char.root.updateMatrixWorld(true);
  }

  /** The look of `updateStatus` on a guest's copy, from the host's flags: no damage, no spreading, no timers of its own. */
  private replicaStatus(e: Enemy, dt: number, view: ReplicaView): void {
    const skin = e.char as unknown as Skin;
    // The host's word holds it frozen or burning. Without it, what this player's own weapon just put on the copy (`afflict`,
    // ahead of the host's answer) runs out by itself, as it would on the host.
    e.frozen = view.frozen ? Math.max(e.frozen, REPLICA_STATUS_HOLD) : Math.max(0, e.frozen - dt);
    skin.setFrost(Math.max(view.frost, clamp(e.frozen * 2)));
    e.burning = view.burning ? Math.max(e.burning, REPLICA_STATUS_HOLD) : Math.max(0, e.burning - dt);
    if (e.burning > 0) this.burnLook(e, dt, skin);
    else if (e.alight) this.burnOut(e);
    if (!e.def.machine) {
      // The host's word, but never more legs than this copy's body has left. The cut arrives as an event of its own, ahead
      // of the snapshot that knows of it (snapshots are played 150 ms behind): for that moment the view still says two,
      // and a copy that went down just then is not placed again until it is up, so it kept two legs it did not have (the
      // co-op gore proof's "what is left of the body", on a watching guest, about one run in three).
      const lost = e.char.severed;
      const own = (lost.has('legL') || lost.has('shinL') ? 0 : 1) + (lost.has('legR') || lost.has('shinR') ? 0 : 1);
      e.maim.legs = Math.min(view.legs, own);
    }
    if (e.stagger > 0) e.stagger -= dt;
    e.rising = view.rising ? Math.max(e.rising, 0.1) : 0;
  }

  /** Co-op guest: the death the host decided, shown through the one kill flow with the host's findings (`KillFacts`). */
  replayDeath(enemy: Enemy, damage: DamageInfo, gib: boolean, told: KillFacts = NO_KILL_FACTS, eye: THREE.Vector3 | null = null): void {
    if (gib) damage.gib = true;
    this.senseShooter(eye);
    this.model.killShown(enemy, damage, told);
    this.model.shooter = null;
  }

  emitHit(e: Enemy, d: DamageInfo, res: DamageResult): void {
    this.ctx.events.emit('enemy:hit', { enemy: e, damage: d, result: res });
  }

  // -------------------------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------------------------

  private rayEnemy(e: Enemy, origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, out: EnemyRayHit): boolean {
    const dx = e.center.x - origin.x;
    const dy = e.center.y - origin.y;
    const dz = e.center.z - origin.z;
    const along = dx * dir.x + dy * dir.y + dz * dir.z;
    const reach = e.char.rig.height * 0.75 + 0.3;
    if (along < -reach || along > maxDist + reach) return false;
    if (dx * dx + dy * dy + dz * dz - along * along > reach * reach) return false;
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
    _hits.sort(byDistance);
    if (_hits.length > max) _hits.length = max;
    return _hits;
  }

  query(center: THREE.Vector3, radius: number, out: EnemyInstance[]): number {
    out.length = 0;
    this.grid.ensure(this.alive);
    const n = this.grid.collectInRadius(center.x, center.z, radius + 0.5, _gridScratch);
    const r2 = radius * radius;
    for (let i = 0; i < n; i++) {
      const e = _gridScratch[i]!;
      if (e.alive && e.center.distanceToSquared(center) <= r2) out.push(e);
    }
    _gridScratch.length = 0;
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
    this.vehicles?.killAll(source);
  }

  /** The Titan's death takes the field with it. */
  killAllExcept(keep: Enemy, source: string): void {
    const n = this.alive.length;
    for (let i = n - 1; i >= 0; i--) {
      const e = this.alive[i];
      if (!e || e === keep) continue;
      const t = this.statusDamage(e, source, 'explosive', e.health * 2 + 1);
      t.force = 500;
      t.gib = true;
      this.model.kill(e, t, 'chest', null);
    }
  }

  // -------------------------------------------------------------------------------------------
  // Helpers for behaviours
  // -------------------------------------------------------------------------------------------

  /** Nearest ally that is closer to the player than `e`, and not another support. */
  frontAlly(e: Enemy, radius: number): Enemy | null {
    this.grid.ensure(this.alive);
    const n = this.grid.collectInRadius(e.position.x, e.position.z, radius, _gridScratch);
    let best: Enemy | null = null;
    let bestD = radius * radius;
    for (let i = 0; i < n; i++) {
      const o = _gridScratch[i]!;
      if (!o.alive || o === e || o.id === 'warden' || o.dist > e.dist + 6) continue;
      const d = o.position.distanceToSquared(e.position);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    _gridScratch.length = 0;
    return best;
  }

  wardNearby(e: Enemy, radius: number, hp: number, maxTargets: number): void {
    this.grid.ensure(this.alive);
    const n = this.grid.collectInRadius(e.position.x, e.position.z, radius, _gridScratch);
    const r2 = radius * radius;
    let given = 0;
    for (let i = 0; i < n && given < maxTargets; i++) {
      const o = _gridScratch[i]!;
      if (!o.alive || o === e || o.isBoss || o.def.machine) continue;
      if (o.position.distanceToSquared(e.position) > r2) continue;
      o.buff = 1;
      if (o.ward > 0) {
        if (o.wardBy === e) given++;
        continue;
      }
      const visual = this.telegraphs.acquireWard();
      if (visual < 0) break;
      o.ward = hp;
      o.wardBy = e;
      o.wardVisual = visual;
      given++;
      this.ctx.fx.ring(o.center, UP, 0xffe9a0, 1.4);
      this.ctx.audio.play('warden_shield_up', { position: o.center });
    }
    _gridScratch.length = 0;
  }

  dropWard(e: Enemy): void {
    if (e.wardVisual >= 0) this.telegraphs.releaseWard(e.wardVisual);
    e.wardVisual = -1;
    e.ward = 0;
    e.wardBy = null;
  }

  /** Charging bosses plough through their own side. */
  trample(boss: Enemy, radius: number): void {
    this.grid.ensure(this.alive);
    const r = radius + 0.4;
    const r2 = r * r;
    const n = this.grid.collectInRadius(boss.position.x, boss.position.z, r, _trampleScratch);
    for (let i = 0; i < n; i++) {
      const o = _trampleScratch[i]!;
      if (!o.alive || o === boss || o.isBoss) continue;
      if (o.position.distanceToSquared(boss.position) > r2) continue;
      const t = this.statusDamage(o, 'trample', 'crush', o.health + 1);
      _dir.copy(o.position).sub(boss.position).setY(0.4).normalize();
      t.dir.copy(_dir);
      t.force = 700;
      this.model.kill(o, t, 'chest', null);
    }
    _trampleScratch.length = 0;
  }

  /** The enemy's own blast. It is not a kill: nobody earned it. */
  selfDestruct(e: Enemy): void {
    if (!e.alive) return;
    this.ctx.coop?.world?.selfDestruct(e);
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
    this.burnOut(e);
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
    this.outpost?.onDetach(e);
    const i = this.alive.indexOf(e);
    if (i >= 0) {
      const last = this.alive.pop()!;
      if (last !== e) this.alive[i] = last;
      this.grid.dirty = true;
    }
  }

  /** Leaves the round alive: no kill, no score, no body. A broken man who made it to a gate. */
  withdraw(e: Enemy): void {
    e.alive = false;
    this.detach(e);
    this.ctx.gore?.releaseChar?.(e.char);
    e.char.release();
    this.retire(e);
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

  /** For the sandbox and contact: staggers by the same rule as a hit. `dir` sends it stepping that way. */
  stagger(e: Enemy, seconds: number, dir?: THREE.Vector3, strength = 0.5): void {
    this.model.stagger(e, seconds, dir, strength);
  }

  describe(e: Enemy): string {
    return `${e.id}#${e.uid} ${(e.behaviour as Behaviour | null)?.name ?? '-'} ${e.attack?.name ?? ''} hp ${e.health.toFixed(0)}`;
  }
}
