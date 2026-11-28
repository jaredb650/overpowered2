/**
 * Living, killable, ragdollable Civilian & Press Corps NPC crowd for Deprecation (`Form 7742-A`).
 *
 * - Strictly capped pool of up to `MAX_CIVILIANS` (24) real articulated humanoid NPCs:
 *     - ~1/3 **Press Corps** (`press` baked archetype: royal-blue PRESS vest, lanyard, broadcast mic)
 *     - ~2/3 **Downtown Civilians** (`civilian` baked archetype: tailored blazer, dress shirt, slacks)
 *   Falls back gracefully to articulated procedural rigs when `ctx.characters` is unavailable (headless tests).
 * - GTA-style bystander rules:
 *     - Fully killable & ragdollable via `ctx.gore` (`ragdoll`, `headshot`, `gib`) from bullets,
 *       rockets, grenades, Frame weapons/stomp, and mech trample (`ExtraTarget` on `VehicleSystem`).
 *     - **Zero penalty and zero reward**: never increments `kills`, `score`, or `credits`, never
 *       locks enemy auto-aim or health bars, and never blocks mission progression.
 * - Dynamic panic behaviors:
 *     - Press crews report/film briefly near OpenMind Plaza, then flee or cower under fire.
 *     - Nearby blasts/gunshots trigger flinch, cowering with raised arms, or panicked sprint to SUBWAY exits.
 *     - Spatial 3D voice clips (`mission.deprecation.civ.*` & `mission.deprecation.press.*`) play from
 *       nearby fleeing/cowering NPCs and cut off mid-sentence if the speaker is killed.
 *     - Fires `onPressKilled(totalPressKilled)` so Ram Faultman reacts when press members are gunned down.
 */
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import {
  CG,
  type CharacterInstance,
  type Ctx,
  type DamageInfo,
  type ExplosionKind,
} from '../../core/contracts';
import type { ExplosionSpec } from '../../core/gameplay';
import { clamp } from '../../core/math';
import type { ExtraTarget } from '../../enemies/vehicles';

export type Vec3Like = THREE.Vector3 | readonly [number, number, number];
export type BystanderRole = 'civilian' | 'press';

export const MAX_CIVILIANS = 24;

export interface CivilianRouteDef {
  readonly id: string;
  /** Ordered sidewalk waypoints ending at or leading into the subway shelter entrance. */
  readonly waypoints: readonly Vec3Like[];
  /** Optional glowing green subway exit beacon location (defaults to the final waypoint). */
  readonly subwayExit?: Vec3Like;
  /** When true, spawns Press Corps reporters & cameramen on this route. */
  readonly pressZone?: boolean;
}

export interface CivilianCrowdConfig {
  readonly routes: readonly CivilianRouteDef[];
  /** Number of pooled NPCs to spawn (clamped to `0..MAX_CIVILIANS`, default `24`). */
  readonly count?: number;
  /** Base jogging/running speed in m/s (default `4.6`). */
  readonly baseSpeed?: number;
  /** Speed multiplier while panicked after a nearby blast/gunshot (default `1.6`). */
  readonly panicSpeedMult?: number;
  /** Minimum reaction radius in meters for `reactToBlast` (default `28`). */
  readonly panicRadius?: number;
  /** Duration in seconds of panicked sprint after a nearby blast (default `4.5`). */
  readonly panicDuration?: number;
  /** Duration in seconds of the initial crouch/duck flinch at blast onset (default `0.45`). */
  readonly duckDuration?: number;
  /** Automatically subscribe to `ctx.events.on('world:explosion', ...)` (default `true`). */
  readonly autoListenExplosions?: boolean;
  /** Automatically register with `ctx.enemies.vehicles.addExtra(this)` (default `true`). */
  readonly autoRegisterExtra?: boolean;
  /** Whether the crowd starts active immediately (default `true`). */
  readonly autoStart?: boolean;
  /** Optional callback fired when a civilian safely reaches a subway exit and recycles. */
  readonly onRecycle?: (routeId: string, recycledTotal: number) => void;
  /** Optional callback fired when a Press Corps NPC is killed (GTA-style commentary hook). */
  readonly onPressKilled?: (totalPressKilled: number, position: THREE.Vector3) => void;
  /** Optional callback fired when any Civilian NPC is killed. */
  readonly onCivilianKilled?: (totalCiviliansKilled: number, position: THREE.Vector3) => void;
}

export interface CivilianSnapshot {
  readonly index: number;
  readonly active: boolean;
  readonly alive: boolean;
  readonly role: BystanderRole;
  readonly hp: number;
  readonly routeId: string;
  readonly waypointIndex: number;
  readonly position: THREE.Vector3;
  readonly speed: number;
  readonly panicked: boolean;
  readonly ducking: boolean;
  readonly cowering: boolean;
  readonly stridePhase: number;
}

export const CIVILIAN_DEFAULTS = {
  baseSpeed: 4.6,
  panicSpeedMult: 1.6,
  panicRadius: 28,
  panicDuration: 4.5,
  duckDuration: 0.45,
  cowerDuration: 2.6,
  waypointReachDist: 0.9,
  maxHp: 45,
  respawnDelay: 12.0,
} as const;

const COAT_COLORS = [0x8f8a7e, 0x4b5c6b, 0xa89b84, 0x6f5358, 0x5c665d, 0x7a7670] as const;
const PRESS_VEST_COLOR = 0x1652c2;

const CIV_FLEE_CLIPS = [
  'mission.deprecation.civ.flee.1',
  'mission.deprecation.civ.flee.2',
  'mission.deprecation.civ.flee.3',
] as const;
const CIV_COWER_CLIPS = [
  'mission.deprecation.civ.cower.1',
  'mission.deprecation.civ.cower.2',
  'mission.deprecation.civ.cower.3',
] as const;
const CIV_WITNESS_CLIPS = [
  'mission.deprecation.civ.witness.1',
  'mission.deprecation.civ.witness.2',
] as const;
const PRESS_LIVE_CLIPS = [
  'mission.deprecation.press.live.1',
  'mission.deprecation.press.live.2',
] as const;
const PRESS_FLEE_CLIPS = [
  'mission.deprecation.press.flee.1',
  'mission.deprecation.press.flee.2',
] as const;
const PRESS_KILLED_CLIPS = [
  'mission.deprecation.press.killed.1',
  'mission.deprecation.press.killed.2',
] as const;

const VOICE_EARSHOT = 46;
const VOICE_MIN_INTERVAL = 3.1;
const HEADSHOT_LOCAL_Y = 1.42;

const _tmpVec = new THREE.Vector3();
const _tmpDir = new THREE.Vector3();
const _tmpVel = new THREE.Vector3();
const _tmpRight = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

function rapierGroups(membership: number, filter: number): number {
  return ((membership & 0xffff) << 16) | (filter & 0xffff);
}

function toVec3(v: Vec3Like, out: THREE.Vector3): THREE.Vector3 {
  if (v instanceof THREE.Vector3) return out.copy(v);
  return out.set(v[0], v[1], v[2]);
}

interface ParsedRoute {
  readonly id: string;
  readonly waypoints: readonly THREE.Vector3[];
  readonly subwayExit: THREE.Vector3;
  readonly pressZone: boolean;
}

interface ProceduralRig {
  root: THREE.Group;
  body: THREE.Group;
  leftArm: THREE.Mesh;
  rightArm: THREE.Group;
  leftLeg: THREE.Mesh;
  rightLeg: THREE.Mesh;
}

interface CivilianAgent {
  readonly index: number;
  readonly role: BystanderRole;
  active: boolean;
  alive: boolean;
  hp: number;
  respawnTimer: number;
  routeIndex: number;
  waypointIndex: number;
  readonly position: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  yaw: number;
  readonly personalSpeedFactor: number;
  currentSpeed: number;
  stridePhase: number;
  panicRemaining: number;
  duckRemaining: number;
  cowerRemaining: number;
  reportRemaining: number;
  readonly lateralOffset: number;
  char: CharacterInstance | null;
  rig: ProceduralRig | null;
  body: RAPIER.RigidBody | null;
  collider: RAPIER.Collider | null;
}

interface VoiceChannel {
  audio: HTMLAudioElement;
  speakerIndex: number;
  playing: boolean;
  startedAt: number;
}

interface VehicleSystemLike {
  addExtra?: (target: ExtraTarget) => void;
  removeExtra?: (target: ExtraTarget) => void;
}

export class CivilianCrowd implements ExtraTarget {
  readonly maxCount: number;

  private readonly routes: ParsedRoute[] = [];
  private readonly agents: CivilianAgent[] = [];
  private readonly colliderToAgent = new Map<number, CivilianAgent>();
  private readonly baseSpeed: number;
  private readonly panicSpeedMult: number;
  private readonly panicRadius: number;
  private readonly panicDuration: number;
  private readonly duckDuration: number;
  private readonly onRecycleCb?: (routeId: string, recycledTotal: number) => void;
  private readonly onPressKilledCb?: (totalPressKilled: number, position: THREE.Vector3) => void;
  private readonly onCivilianKilledCb?: (totalCiviliansKilled: number, position: THREE.Vector3) => void;

  private running = false;
  private _recycledCount = 0;
  private _pressKilledCount = 0;
  private _civilianKilledCount = 0;
  private nextRouteCursor = 0;
  private modelsReady = false;
  private modelsLoading = false;
  private registeredExtra = false;

  // Lightweight 3-channel spatial bystander voice pool
  private readonly voiceChannels: VoiceChannel[] = [];
  private voiceCooldown = 1.2;
  private voiceSeq = 0;
  private clock = 0;

  private sceneRoot: THREE.Group | null = null;
  private readonly sharedGeos: THREE.BufferGeometry[] = [];
  private readonly sharedMats: THREE.Material[] = [];
  private readonly unsubs: (() => void)[] = [];
  private readonly loco = { speed: 0, moveX: 0, moveZ: 1, aimYaw: 0, aimPitch: 0, grounded: true };
  private disposed = false;

  constructor(private readonly ctx: Ctx, config: CivilianCrowdConfig) {
    this.baseSpeed = config.baseSpeed ?? CIVILIAN_DEFAULTS.baseSpeed;
    this.panicSpeedMult = config.panicSpeedMult ?? CIVILIAN_DEFAULTS.panicSpeedMult;
    this.panicRadius = config.panicRadius ?? CIVILIAN_DEFAULTS.panicRadius;
    this.panicDuration = config.panicDuration ?? CIVILIAN_DEFAULTS.panicDuration;
    this.duckDuration = config.duckDuration ?? CIVILIAN_DEFAULTS.duckDuration;
    this.onRecycleCb = config.onRecycle;
    this.onPressKilledCb = config.onPressKilled;
    this.onCivilianKilledCb = config.onCivilianKilled;

    for (const r of config.routes) {
      if (r.waypoints.length < 2) continue;
      const waypoints = r.waypoints.map(w => toVec3(w, new THREE.Vector3()));
      const subwayExit = r.subwayExit
        ? toVec3(r.subwayExit, new THREE.Vector3())
        : waypoints[waypoints.length - 1]!.clone();
      this.routes.push({ id: r.id, waypoints, subwayExit, pressZone: Boolean(r.pressZone) });
    }

    const requested = config.count ?? MAX_CIVILIANS;
    this.maxCount = this.routes.length > 0 ? clamp(Math.floor(requested), 0, MAX_CIVILIANS) : 0;

    this.buildSceneResources();
    this.initPool();
    this.initVoicePool();
    this.requestCharacterModels();

    if (config.autoListenExplosions !== false && ctx.events?.on) {
      this.unsubs.push(
        ctx.events.on('world:explosion', ev => {
          this.reactToBlast(ev.position, ev.radius);
        }),
      );
    }

    const vehSys = (ctx.enemies as unknown as { vehicles?: VehicleSystemLike } | undefined)?.vehicles;
    if (config.autoRegisterExtra !== false && typeof vehSys?.addExtra === 'function') {
      vehSys.addExtra(this);
      this.registeredExtra = true;
    }

    if (config.autoStart !== false && this.maxCount > 0) {
      this.start();
    }
  }

  /** Number of currently active living bystanders (`<= 24`). */
  get activeCount(): number {
    let n = 0;
    for (let i = 0; i < this.agents.length; i++) {
      if (this.agents[i]!.active && this.agents[i]!.alive) n++;
    }
    return n;
  }

  /** Number of currently active living Press Corps reporters. */
  get activePressCount(): number {
    let n = 0;
    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i]!;
      if (a.active && a.alive && a.role === 'press') n++;
    }
    return n;
  }

  /** Number of bystanders currently in panicked sprint mode. */
  get panickedCount(): number {
    let n = 0;
    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i]!;
      if (a.active && a.alive && a.panicRemaining > 0) n++;
    }
    return n;
  }

  /** Total bystanders that have safely entered subway shelter exits and recycled. */
  get recycledCount(): number {
    return this._recycledCount;
  }

  /** Total Press Corps reporters killed in this run. */
  get pressKilledCount(): number {
    return this._pressKilledCount;
  }

  /** Total non-press Civilians killed in this run. */
  get civilianKilledCount(): number {
    return this._civilianKilledCount;
  }

  /** Total bystanders (civilians + press) killed in this run. */
  get totalKilledCount(): number {
    return this._pressKilledCount + this._civilianKilledCount;
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** Read-only snapshots of all pooled bystanders for diagnostics & testing. */
  getSnapshots(): CivilianSnapshot[] {
    return this.agents.map(a => ({
      index: a.index,
      active: a.active,
      alive: a.alive,
      role: a.role,
      hp: a.hp,
      routeId: this.routes[a.routeIndex]?.id ?? '',
      waypointIndex: a.waypointIndex,
      position: a.position.clone(),
      speed: a.currentSpeed,
      panicked: a.panicRemaining > 0,
      ducking: a.duckRemaining > 0,
      cowering: a.cowerRemaining > 0,
      stridePhase: a.stridePhase,
    }));
  }

  /** Activates the civilian & press crowd along Grand Boulevard sidewalks and OpenMind Plaza. */
  start(): void {
    if (this.disposed || this.routes.length === 0) return;
    this.running = true;
    this.requestCharacterModels();
    for (const a of this.agents) {
      a.active = true;
      if (a.alive) {
        this.attachVisual(a);
        this.ensureCollider(a);
        if (a.char) a.char.root.visible = true;
        if (a.rig) a.rig.root.visible = !a.char;
      }
    }
    if (this.sceneRoot) this.sceneRoot.visible = true;
    // Kick off a live press report right as ORION-0 breaches OpenMind Plaza!
    const reporter = this.agents.find(a => a.active && a.alive && a.role === 'press');
    if (reporter) {
      this.speak(reporter, PRESS_LIVE_CLIPS, true);
    }
  }

  /** Hides and pauses the crowd without destroying the pool. */
  stop(): void {
    this.running = false;
    this.stopAllVoices();
    for (const a of this.agents) {
      a.active = false;
      this.removeCollider(a);
      if (a.char) a.char.root.visible = false;
      if (a.rig) a.rig.root.visible = false;
    }
    if (this.sceneRoot) this.sceneRoot.visible = false;
  }

  // -------------------------------------------------------------------------------------------
  // ExtraTarget: Weapons, Projectiles, Explosions, Frame Blows & Trample (Zero Score / Penalty)
  // -------------------------------------------------------------------------------------------

  /** ExtraTarget: hitscan bullets, shotguns, Frame rotary cannon, sniper rounds. */
  shot(collider: RAPIER.Collider, point: THREE.Vector3, amount: number, source: string): boolean {
    if (this.disposed || !this.running) return false;
    const agent = this.colliderToAgent.get(collider.handle);
    if (!agent || !agent.active || !agent.alive) return false;
    const shooterPos = this.ctx.player?.eye ?? this.ctx.player?.position;
    if (shooterPos) {
      _tmpDir.copy(point).sub(shooterPos);
      if (_tmpDir.lengthSq() > 1e-6) _tmpDir.normalize();
      else _tmpDir.set(0, 0, 1);
    } else {
      _tmpDir.set(0, 0, 1);
    }
    this.applyDamage(agent, Math.max(15, amount), point, _tmpDir, source, 'bullet', false);
    return true;
  }

  /** ExtraTarget: direct rocket / autocannon / howitzer shell hit. */
  direct(
    collider: RAPIER.Collider,
    point: THREE.Vector3,
    amount: number,
    _kind: ExplosionKind,
    source: string,
  ): boolean {
    if (this.disposed || !this.running) return false;
    const agent = this.colliderToAgent.get(collider.handle);
    if (!agent || !agent.active || !agent.alive) return false;
    _tmpDir.copy(agent.position).sub(point);
    _tmpDir.y = 0.35;
    if (_tmpDir.lengthSq() > 1e-6) _tmpDir.normalize();
    else _tmpDir.set(0, 0.35, 1).normalize();
    this.applyDamage(agent, Math.max(80, amount), point, _tmpDir, source, 'explosive', amount >= 140);
    return true;
  }

  /** ExtraTarget: grenades, rockets, satchels, Frame howitzer, ORION blasts, building collapses. */
  blast(center: THREE.Vector3, spec: ExplosionSpec): number {
    if (this.disposed || !this.running) return 0;
    const radius = Math.max(1, spec.radius);
    const r2 = radius * radius;
    let affected = 0;

    // Startle everyone in wider panic range first.
    this.reactToBlast(center, radius * 2.2);

    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i]!;
      if (!a.active || !a.alive) continue;
      const dx = a.position.x - center.x;
      const dy = a.position.y + 0.9 - center.y;
      const dz = a.position.z - center.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > r2) continue;
      const dist = Math.sqrt(d2);
      const falloff = clamp(1 - dist / radius, 0.15, 1);
      const dmg = spec.damage * falloff;
      _tmpDir.set(dx, Math.max(0.35, dy + 0.5), dz).normalize();
      _tmpVec.set(a.position.x, a.position.y + 1.0, a.position.z);
      this.applyDamage(a, dmg, _tmpVec, _tmpDir, spec.source ?? 'explosion', 'explosive', dmg >= 140);
      affected++;
    }
    return affected;
  }

  /** ExtraTarget: Distraint Frame melee punches & ground stomps. */
  frameBlow(
    at: THREE.Vector3,
    radius: number,
    damage: number,
    dir: THREE.Vector3 | null,
    source: string,
  ): number {
    if (this.disposed || !this.running) return 0;
    const r2 = radius * radius;
    let hit = 0;
    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i]!;
      if (!a.active || !a.alive) continue;
      const dx = a.position.x - at.x;
      const dy = a.position.y + 0.9 - at.y;
      const dz = a.position.z - at.z;
      if (dx * dx + dy * dy + dz * dz > r2) continue;
      if (dir) {
        _tmpDir.copy(dir).addScaledVector(_up, 0.35).normalize();
      } else {
        _tmpDir.set(dx, 0.5, dz).normalize();
      }
      _tmpVec.set(a.position.x, a.position.y + 1.0, a.position.z);
      this.applyDamage(a, Math.max(90, damage), _tmpVec, _tmpDir, source, 'melee', damage >= 180);
      hit++;
    }
    if (hit > 0) this.reactToBlast(at, radius * 3);
    return hit;
  }

  /**
   * Direct ray-capsule hit helper for programmatic tests & melee/kick checks.
   * Returns the index of the struck agent, or -1 if none was hit.
   */
  damageByRay(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    maxDist: number,
    amount: number,
    source = 'weapon',
  ): number {
    if (this.disposed || !this.running) return -1;
    let best: CivilianAgent | null = null;
    let bestT = maxDist;
    const hitPoint = new THREE.Vector3();

    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i]!;
      if (!a.active || !a.alive) continue;
      const cx = a.position.x;
      const cy = a.position.y + 0.92;
      const cz = a.position.z;
      const ox = cx - origin.x;
      const oy = cy - origin.y;
      const oz = cz - origin.z;
      const proj = ox * dir.x + oy * dir.y + oz * dir.z;
      if (proj < 0 || proj > bestT) continue;
      const px = origin.x + dir.x * proj;
      const py = origin.y + dir.y * proj;
      const pz = origin.z + dir.z * proj;
      const horiz2 = (px - cx) * (px - cx) + (pz - cz) * (pz - cz);
      if (horiz2 <= 0.42 * 0.42 && py >= a.position.y && py <= a.position.y + 1.82) {
        bestT = proj;
        best = a;
        hitPoint.set(px, py, pz);
      }
    }

    if (!best) return -1;
    this.applyDamage(best, amount, hitPoint, dir, source, 'bullet', false);
    return best.index;
  }

  /**
   * Checks heavy mech / vehicle trample (Distraint Frame or ORION-0) moving past civilians.
   * Anyone caught directly underfoot gets launched into a physics ragdoll!
   */
  checkTrample(center: Vec3Like, radius: number, speed: number, source = 'trample'): number {
    if (this.disposed || !this.running || speed < 2.4) return 0;
    const cx = center instanceof THREE.Vector3 ? center.x : center[0];
    const cy = center instanceof THREE.Vector3 ? center.y : center[1];
    const cz = center instanceof THREE.Vector3 ? center.z : center[2];
    const r2 = radius * radius;
    let trampled = 0;

    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i]!;
      if (!a.active || !a.alive) continue;
      const dx = a.position.x - cx;
      const dy = a.position.y - cy;
      const dz = a.position.z - cz;
      if (Math.abs(dy) > 3.0 || dx * dx + dz * dz > r2) continue;
      _tmpDir.set(dx, 0.55, dz);
      if (_tmpDir.lengthSq() < 1e-4) _tmpDir.set(1, 0.55, 0);
      _tmpDir.normalize();
      _tmpVec.set(a.position.x, a.position.y + 0.95, a.position.z);
      this.applyDamage(a, 120, _tmpVec, _tmpDir, source, 'melee', false);
      trampled++;
    }
    return trampled;
  }

  /**
   * Triggers panic, brief crouch-duck flinch, and sprint acceleration on all bystanders within
   * `Math.max(radius, panicRadius)` meters of a blast, ORION thermal beam, or building collapse.
   * Returns the number of bystanders startled.
   */
  reactToBlast(pos: Vec3Like, radius = 0): number {
    if (this.disposed || !this.running) return 0;
    const bx = pos instanceof THREE.Vector3 ? pos.x : pos[0];
    const by = pos instanceof THREE.Vector3 ? pos.y : pos[1];
    const bz = pos instanceof THREE.Vector3 ? pos.z : pos[2];
    const reach = Math.max(radius, this.panicRadius);
    const reachSq = reach * reach;

    let startled = 0;
    let speaker: CivilianAgent | null = null;
    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i]!;
      if (!a.active || !a.alive) continue;
      const dx = a.position.x - bx;
      const dy = a.position.y - by;
      const dz = a.position.z - bz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > reachSq) continue;

      a.reportRemaining = 0;
      a.panicRemaining = Math.max(a.panicRemaining, this.panicDuration);
      a.duckRemaining = Math.max(a.duckRemaining, this.duckDuration);
      if (a.char) a.char.anim.play('block', 1.1);
      if (!speaker && d2 < VOICE_EARSHOT * VOICE_EARSHOT) speaker = a;
      startled++;
    }

    if (speaker) {
      this.speak(speaker, speaker.role === 'press' ? PRESS_FLEE_CLIPS : CIV_FLEE_CLIPS);
    }
    return startled;
  }

  /** Advances waypoint sprint, cowering, animations, kinematic hit capsules, voices, and recycling. */
  update(dt: number): void {
    if (this.disposed || !this.running || dt <= 0 || this.routes.length === 0) return;
    this.clock += dt;
    if (this.voiceCooldown > 0) this.voiceCooldown = Math.max(0, this.voiceCooldown - dt);

    // Check Distraint Frame / vehicle trample automatically while player is seated (parked).
    const player = this.ctx.player;
    if (player?.parked && player.position && player.velocity) {
      const spd = Math.hypot(player.velocity.x, player.velocity.z);
      if (spd > 3.2) this.checkTrample(player.position, 2.35, spd, 'frame_trample');
    }

    const playerPos = this.ctx.player?.position;

    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i]!;
      if (!a.active) continue;

      if (!a.alive) {
        a.respawnTimer -= dt;
        if (a.respawnTimer <= 0) {
          this.respawnAgent(a);
        }
        continue;
      }

      if (a.panicRemaining > 0) a.panicRemaining = Math.max(0, a.panicRemaining - dt);
      if (a.duckRemaining > 0) a.duckRemaining = Math.max(0, a.duckRemaining - dt);
      if (a.cowerRemaining > 0) a.cowerRemaining = Math.max(0, a.cowerRemaining - dt);
      if (a.reportRemaining > 0) a.reportRemaining = Math.max(0, a.reportRemaining - dt);

      const route = this.routes[a.routeIndex]!;
      const target = route.waypoints[a.waypointIndex]!;

      // Press reporters briefly pause near the plaza barricades to film/report until startled!
      if (a.reportRemaining > 0 && a.panicRemaining <= 0 && a.cowerRemaining <= 0) {
        a.currentSpeed = 0;
        a.velocity.set(0, 0, 0);
        // Face south toward ORION-0 on Grand Boulevard
        a.yaw = 0;
        this.syncAgentVisual(a, dt, playerPos);
        this.syncCollider(a);
        continue;
      }

      // Cowering bystanders crouch in place shielding their heads when gunfire erupts right beside them!
      if (a.cowerRemaining > 0) {
        a.currentSpeed = 0;
        a.velocity.set(0, 0, 0);
        if (playerPos) {
          a.yaw = Math.atan2(playerPos.x - a.position.x, playerPos.z - a.position.z);
        }
        this.syncAgentVisual(a, dt, playerPos);
        this.syncCollider(a);
        continue;
      }

      // Determine current sprint speed: brief duck flinch slows momentarily then surges into panicked sprint.
      const panicMult = a.panicRemaining > 0 ? this.panicSpeedMult : 1.0;
      const duckMult = a.duckRemaining > 0 ? 0.85 : 1.0;
      const speed = this.baseSpeed * a.personalSpeedFactor * panicMult * duckMult;
      a.currentSpeed = speed;

      const tx = target.x + a.lateralOffset;
      const ty = target.y;
      const tz = target.z;
      const dx = tx - a.position.x;
      const dy = ty - a.position.y;
      const dz = tz - a.position.z;
      const dist = Math.hypot(dx, dy, dz);
      const step = speed * dt;

      if (dist <= Math.max(step, CIVILIAN_DEFAULTS.waypointReachDist)) {
        a.position.set(tx, ty, tz);
        a.velocity.set(0, 0, 0);
        a.waypointIndex++;
        if (a.waypointIndex >= route.waypoints.length) {
          this.recycleAgent(a, route.id);
        }
      } else {
        const inv = 1 / dist;
        const vx = dx * inv * speed;
        const vy = dy * inv * speed;
        const vz = dz * inv * speed;
        a.position.x += vx * dt;
        a.position.y += vy * dt;
        a.position.z += vz * dt;
        a.velocity.set(vx, vy, vz);
        a.yaw = Math.atan2(dx, dz);
      }

      a.stridePhase += step * 2.35;
      this.syncAgentVisual(a, dt, playerPos);
      this.syncCollider(a);
    }

    this.updateVoiceVolumes();
  }

  /** Resets all pooled bystanders back to staggered starting positions along the routes. */
  reset(): void {
    this._recycledCount = 0;
    this._pressKilledCount = 0;
    this._civilianKilledCount = 0;
    this.nextRouteCursor = 0;
    this.stopAllVoices();

    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i]!;
      a.alive = true;
      a.hp = CIVILIAN_DEFAULTS.maxHp;
      a.respawnTimer = 0;
      a.panicRemaining = 0;
      a.duckRemaining = 0;
      a.cowerRemaining = 0;
      a.reportRemaining = a.role === 'press' && i % 2 === 0 ? 4.5 + (i % 3) * 1.5 : 0;
      a.currentSpeed = this.baseSpeed * a.personalSpeedFactor;
      a.velocity.set(0, 0, 0);
      a.stridePhase = i * 0.9;
      this.placeStaggered(a, i);
      if (this.running) {
        this.attachVisual(a);
        this.ensureCollider(a);
      }
      this.syncAgentVisual(a, 0, this.ctx.player?.position);
      this.syncCollider(a);
    }
  }

  /** Disposes all characters, colliders, fallback meshes, voices, and event subscriptions. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.running = false;
    this.stopAllVoices();

    if (this.registeredExtra) {
      const vehSys = (this.ctx.enemies as unknown as { vehicles?: VehicleSystemLike } | undefined)?.vehicles;
      vehSys?.removeExtra?.(this);
      this.registeredExtra = false;
    }

    for (const unsub of this.unsubs) unsub();
    this.unsubs.length = 0;

    for (const a of this.agents) {
      this.removeCollider(a);
      if (a.char) {
        a.char.release();
        a.char = null;
      }
    }

    if (this.sceneRoot) {
      this.ctx.render?.scene?.remove?.(this.sceneRoot);
      this.sceneRoot = null;
    }
    for (const g of this.sharedGeos) g.dispose();
    for (const m of this.sharedMats) m.dispose();
    this.sharedGeos.length = 0;
    this.sharedMats.length = 0;
    this.agents.length = 0;
    this.colliderToAgent.clear();
  }

  // -------------------------------------------------------------------------------------------
  // Damage, Ragdoll, Gore & Witness Reactions (Zero Score / Zero Penalty)
  // -------------------------------------------------------------------------------------------

  private applyDamage(
    agent: CivilianAgent,
    amount: number,
    point: THREE.Vector3,
    dir: THREE.Vector3,
    source: string,
    type: DamageInfo['type'],
    allowGib: boolean,
  ): void {
    if (!agent.alive) return;
    agent.hp -= amount;
    agent.reportRemaining = 0;
    agent.panicRemaining = Math.max(agent.panicRemaining, this.panicDuration * 1.4);

    // Blood impact burst & audio
    this.ctx.fx?.bloodPuff?.(point, dir, amount >= 60 ? 1.4 : 0.85);
    this.ctx.audio?.play?.('flesh_bullet_impact', { position: point, volume: 0.75 });

    if (agent.hp > 0) {
      // Non-lethal hit: flinch and cower or sprint away screaming!
      agent.cowerRemaining = 0;
      agent.duckRemaining = Math.max(agent.duckRemaining, 0.35);
      agent.char?.anim.flinch?.(2, dir, clamp(amount / 35, 0.35, 1.0), point);
      this.speak(agent, agent.role === 'press' ? PRESS_FLEE_CLIPS : CIV_COWER_CLIPS, true);
      this.alertWitnesses(agent, false);
      return;
    }

    // Lethal kill: hand off to GoreSystem ragdoll / headshot / gib — ZERO score, kills, or credits!
    agent.alive = false;
    agent.hp = 0;
    agent.currentSpeed = 0;
    agent.respawnTimer = CIVILIAN_DEFAULTS.respawnDelay;
    this.cutSpeakerVoice(agent.index);
    this.removeCollider(agent);

    const headshot = point.y - agent.position.y >= HEADSHOT_LOCAL_Y;
    const force = clamp(amount * 6.5, 180, 950);
    const dmgInfo: DamageInfo = {
      amount,
      from: point.clone().addScaledVector(dir, -1.5),
      point: point.clone(),
      dir: dir.clone(),
      type,
      source,
      force,
      gib: allowGib,
    };

    const char = agent.char;
    if (char) {
      agent.char = null; // GoreSystem now owns and will release this character instance!
      char.root.visible = true;
      _tmpVel.copy(agent.velocity).addScaledVector(dir, clamp(amount * 0.14, 3.2, 14));
      _tmpVel.y = Math.max(_tmpVel.y, 1.4);

      if (allowGib && this.ctx.gore?.gib) {
        this.ctx.gore.gib(char, point, force, dmgInfo);
      } else if (headshot && this.ctx.gore?.headshot) {
        this.ctx.gore.headshot(char, dmgInfo);
      } else if (this.ctx.gore?.ragdoll) {
        this.ctx.gore.ragdoll(char, {
          velocity: _tmpVel,
          impulses: [{ bone: 2, point: point.clone(), impulse: dir.clone().multiplyScalar(clamp(amount * 0.65, 22, 110)) }],
        });
      } else {
        char.release();
      }
    }
    if (agent.rig) {
      agent.rig.root.visible = false;
    }

    if (agent.role === 'press') {
      this._pressKilledCount++;
      this.onPressKilledCb?.(this._pressKilledCount, agent.position.clone());
    } else {
      this._civilianKilledCount++;
      this.onCivilianKilledCb?.(this._civilianKilledCount, agent.position.clone());
    }

    this.alertWitnesses(agent, true);
  }

  private alertWitnesses(victim: CivilianAgent, killed: boolean): void {
    const panicR2 = 34 * 34;
    const cowerR2 = 12 * 12;
    let pressWitness: CivilianAgent | null = null;
    let civWitness: CivilianAgent | null = null;

    for (let i = 0; i < this.agents.length; i++) {
      const o = this.agents[i]!;
      if (!o.active || !o.alive || o === victim) continue;
      const dx = o.position.x - victim.position.x;
      const dz = o.position.z - victim.position.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > panicR2) continue;

      o.reportRemaining = 0;
      o.panicRemaining = Math.max(o.panicRemaining, this.panicDuration * 1.4);
      // Roughly 1 in 3 very close bystanders drops to cower with hands up while others bolt!
      if (killed && d2 < cowerR2 && o.index % 3 === 0) {
        o.cowerRemaining = CIVILIAN_DEFAULTS.cowerDuration;
        o.char?.anim.play('block', 0.9);
      } else {
        o.duckRemaining = Math.max(o.duckRemaining, 0.4);
      }

      if (o.role === 'press' && !pressWitness) pressWitness = o;
      else if (o.role === 'civilian' && !civWitness) civWitness = o;
    }

    if (killed && victim.role === 'press' && pressWitness) {
      this.speak(pressWitness, PRESS_KILLED_CLIPS, true);
    } else if (killed && civWitness) {
      this.speak(civWitness, CIV_WITNESS_CLIPS, true);
    } else if (killed && pressWitness) {
      this.speak(pressWitness, PRESS_FLEE_CLIPS, true);
    }
  }

  // -------------------------------------------------------------------------------------------
  // Baked Character Model Loading, Pooling & Kinematic Colliders
  // -------------------------------------------------------------------------------------------

  private requestCharacterModels(): void {
    if (this.modelsReady || this.modelsLoading || this.disposed) return;
    const chars = this.ctx.characters;
    if (!chars || typeof chars.load !== 'function' || typeof chars.spawn !== 'function') return;
    this.modelsLoading = true;
    chars
      .load(['civilian', 'press'])
      .then(() => {
        if (this.disposed) return;
        this.modelsReady = true;
        this.modelsLoading = false;
        for (const a of this.agents) {
          if (a.alive) this.attachVisual(a);
        }
      })
      .catch(() => {
        this.modelsLoading = false;
      });
  }

  private attachVisual(agent: CivilianAgent): void {
    if (!this.modelsReady || agent.char || !agent.alive) return;
    const chars = this.ctx.characters;
    const scene = this.ctx.render?.scene;
    if (!chars || !scene) return;
    try {
      const inst = chars.spawn(agent.role);
      inst.root.position.copy(agent.position);
      inst.root.rotation.y = agent.yaw;
      inst.root.visible = this.running && agent.active;
      scene.add(inst.root);
      agent.char = inst;
      if (agent.rig) agent.rig.root.visible = false;
    } catch {
      // Fallback to procedural rig if archetype failed to load
    }
  }

  private ensureCollider(agent: CivilianAgent): void {
    if (agent.collider || !agent.alive) return;
    const phys = this.ctx.physics;
    if (!phys?.world || !phys.R) return;
    const R = phys.R;
    const bodyDesc = R.RigidBodyDesc.kinematicPositionBased().setTranslation(
      agent.position.x,
      agent.position.y + 0.92,
      agent.position.z,
    );
    const body = phys.world.createRigidBody(bodyDesc);
    // Membership = CG.World so hitscan/projectile raycasts hit cleanly; Filter = CG.Projectile so player/Frame never snag!
    const colDesc = R.ColliderDesc.capsule(0.56, 0.3)
      .setCollisionGroups(rapierGroups(CG.World, CG.Projectile));
    const collider = phys.world.createCollider(colDesc, body);
    agent.body = body;
    agent.collider = collider;
    this.colliderToAgent.set(collider.handle, agent);
  }

  private syncCollider(agent: CivilianAgent): void {
    if (!agent.body || !agent.alive) return;
    const cy = agent.cowerRemaining > 0 ? 0.62 : 0.92;
    agent.body.setNextKinematicTranslation({
      x: agent.position.x,
      y: agent.position.y + cy,
      z: agent.position.z,
    });
  }

  private removeCollider(agent: CivilianAgent): void {
    if (agent.collider) {
      this.colliderToAgent.delete(agent.collider.handle);
    }
    const phys = this.ctx.physics;
    if (agent.body && phys?.world) {
      try {
        phys.world.removeRigidBody(agent.body);
      } catch {
        // World may already be torn down on dispose
      }
    }
    agent.body = null;
    agent.collider = null;
  }

  private initPool(): void {
    const pressRouteIndices = this.routes
      .map((r, i) => (r.pressZone ? i : -1))
      .filter(i => i >= 0);

    for (let i = 0; i < this.maxCount; i++) {
      const speedFactor = 0.88 + ((i * 37) % 100) * 0.0028;
      const lateralOffset = (((i * 53) % 11) - 5) * 0.16;
      // ~1/3 Press Corps reporters (indices 0, 3, 6, 9, 12, 15, 18, 21) so press presence is unmistakable!
      const role: BystanderRole = i % 3 === 0 ? 'press' : 'civilian';
      const defaultRoute =
        role === 'press' && pressRouteIndices.length > 0
          ? pressRouteIndices[Math.floor(i / 3) % pressRouteIndices.length]!
          : i % this.routes.length;

      const agent: CivilianAgent = {
        index: i,
        role,
        active: false,
        alive: true,
        hp: CIVILIAN_DEFAULTS.maxHp,
        respawnTimer: 0,
        routeIndex: defaultRoute,
        waypointIndex: 1,
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        yaw: 0,
        personalSpeedFactor: speedFactor,
        currentSpeed: this.baseSpeed * speedFactor,
        stridePhase: i * 0.9,
        panicRemaining: 0,
        duckRemaining: 0,
        cowerRemaining: 0,
        reportRemaining: role === 'press' && i % 2 === 0 ? 4.0 + (i % 3) * 1.4 : 0,
        lateralOffset,
        char: null,
        rig: this.buildProceduralRig(i, role),
        body: null,
        collider: null,
      };

      this.placeStaggered(agent, i);
      this.syncAgentVisual(agent, 0, undefined);
      this.agents.push(agent);
    }
  }

  private placeStaggered(agent: CivilianAgent, index: number): void {
    if (this.routes.length === 0) return;
    const pressRouteIndices = this.routes
      .map((r, i) => (r.pressZone ? i : -1))
      .filter(i => i >= 0);
    const routeIdx =
      agent.role === 'press' && pressRouteIndices.length > 0
        ? pressRouteIndices[Math.floor(index / 3) % pressRouteIndices.length]!
        : index % this.routes.length;
    const route = this.routes[routeIdx]!;
    agent.routeIndex = routeIdx;

    const segCount = route.waypoints.length - 1;
    const frac = ((index / Math.max(1, this.maxCount)) * 0.82) % 0.85;
    const scaled = frac * segCount;
    const segIdx = Math.min(segCount - 1, Math.floor(scaled));
    const localT = scaled - segIdx;

    const a = route.waypoints[segIdx]!;
    const b = route.waypoints[segIdx + 1]!;
    agent.position.lerpVectors(a, b, localT);
    agent.position.x += agent.lateralOffset;
    agent.waypointIndex = segIdx + 1;
    agent.yaw = Math.atan2(b.x - a.x, b.z - a.z);
  }

  private respawnAgent(agent: CivilianAgent): void {
    agent.alive = true;
    agent.hp = CIVILIAN_DEFAULTS.maxHp;
    agent.respawnTimer = 0;
    agent.panicRemaining = 0;
    agent.duckRemaining = 0;
    agent.cowerRemaining = 0;
    agent.reportRemaining = 0;

    const nextIdx = this.nextRouteCursor++ % this.routes.length;
    const route = this.routes[nextIdx]!;
    agent.routeIndex = nextIdx;
    agent.waypointIndex = 1;
    agent.position.copy(route.waypoints[0]!);
    agent.position.x += agent.lateralOffset;
    const nextWp = route.waypoints[1]!;
    agent.yaw = Math.atan2(nextWp.x - route.waypoints[0]!.x, nextWp.z - route.waypoints[0]!.z);

    if (this.running && agent.active) {
      this.attachVisual(agent);
      this.ensureCollider(agent);
      if (agent.char) agent.char.root.visible = true;
      if (agent.rig) agent.rig.root.visible = !agent.char;
      this.syncCollider(agent);
    }
  }

  private recycleAgent(agent: CivilianAgent, finishedRouteId: string): void {
    this._recycledCount++;
    this.onRecycleCb?.(finishedRouteId, this._recycledCount);

    const nextIdx = this.nextRouteCursor++ % this.routes.length;
    const route = this.routes[nextIdx]!;
    agent.routeIndex = nextIdx;
    agent.waypointIndex = 1;
    agent.panicRemaining = 0;
    agent.duckRemaining = 0;
    agent.cowerRemaining = 0;
    agent.position.copy(route.waypoints[0]!);
    agent.position.x += agent.lateralOffset;
    const nextWp = route.waypoints[1]!;
    agent.yaw = Math.atan2(nextWp.x - route.waypoints[0]!.x, nextWp.z - route.waypoints[0]!.z);
  }

  // -------------------------------------------------------------------------------------------
  // Spatial 3D Crowd Voices (Breeze TTS 2 clips, instant mid-word cut-off on death)
  // -------------------------------------------------------------------------------------------

  private initVoicePool(): void {
    if (typeof Audio === 'undefined') return;
    for (let i = 0; i < 3; i++) {
      const audio = new Audio();
      audio.preload = 'none';
      const ch: VoiceChannel = { audio, speakerIndex: -1, playing: false, startedAt: 0 };
      audio.addEventListener('ended', () => {
        ch.playing = false;
        ch.speakerIndex = -1;
      });
      audio.addEventListener('error', () => {
        ch.playing = false;
        ch.speakerIndex = -1;
      });
      this.voiceChannels.push(ch);
    }
  }

  private speak(agent: CivilianAgent, pool: readonly string[], priority = false): void {
    if (this.voiceChannels.length === 0 || pool.length === 0) return;
    if (!priority && this.voiceCooldown > 0) return;
    const playerPos = this.ctx.player?.position;
    if (playerPos && agent.position.distanceTo(playerPos) > VOICE_EARSHOT) return;

    // Pick a free channel (or steal oldest on priority reactions like witnessing a press kill).
    let slot = this.voiceChannels.find(c => !c.playing) ?? null;
    if (!slot && priority) {
      slot = this.voiceChannels.reduce((a, b) => (a.startedAt < b.startedAt ? a : b));
    }
    if (!slot) return;

    const clipId = pool[this.voiceSeq++ % pool.length]!;
    slot.speakerIndex = agent.index;
    slot.playing = true;
    slot.startedAt = this.clock;
    slot.audio.src = `audio/voice/${clipId}.mp3`;
    slot.audio.volume = this.computeVoiceVolume(agent.position);
    slot.audio.play().catch(() => {
      slot!.playing = false;
      slot!.speakerIndex = -1;
    });
    this.voiceCooldown = priority ? 1.8 : VOICE_MIN_INTERVAL;
  }

  private computeVoiceVolume(pos: THREE.Vector3): number {
    const p = this.ctx.player?.position;
    if (!p) return 0.65;
    const dist = pos.distanceTo(p);
    if (dist >= VOICE_EARSHOT) return 0;
    const att = 1 - dist / VOICE_EARSHOT;
    return clamp(0.18 + att * att * 0.72, 0, 0.9);
  }

  private updateVoiceVolumes(): void {
    const p = this.ctx.player?.position;
    if (!p) return;
    for (const ch of this.voiceChannels) {
      if (!ch.playing) continue;
      const a = this.agents[ch.speakerIndex];
      if (!a || !a.alive) {
        this.cutChannel(ch);
        continue;
      }
      ch.audio.volume = this.computeVoiceVolume(a.position);
    }
  }

  private cutSpeakerVoice(agentIndex: number): void {
    for (const ch of this.voiceChannels) {
      if (ch.playing && ch.speakerIndex === agentIndex) this.cutChannel(ch);
    }
  }

  private cutChannel(ch: VoiceChannel): void {
    try {
      ch.audio.pause();
      ch.audio.currentTime = 0;
    } catch {
      // Ignore in headless/stub audio
    }
    ch.playing = false;
    ch.speakerIndex = -1;
  }

  private stopAllVoices(): void {
    for (const ch of this.voiceChannels) this.cutChannel(ch);
  }

  // -------------------------------------------------------------------------------------------
  // Visual Sync & Fallback Procedural Rigs
  // -------------------------------------------------------------------------------------------

  private buildSceneResources(): void {
    const scene = this.ctx.render?.scene;
    if (!scene || this.routes.length === 0) return;

    this.sceneRoot = new THREE.Group();
    this.sceneRoot.visible = false;

    const torsoGeo = new THREE.BoxGeometry(0.42, 0.68, 0.24);
    const headGeo = new THREE.SphereGeometry(0.14, 7, 6);
    const armGeo = new THREE.BoxGeometry(0.12, 0.52, 0.12);
    armGeo.translate(0, -0.22, 0);
    const legGeo = new THREE.BoxGeometry(0.15, 0.72, 0.16);
    legGeo.translate(0, -0.34, 0);
    const propGeo = new THREE.BoxGeometry(0.08, 0.26, 0.34);
    this.sharedGeos.push(torsoGeo, headGeo, armGeo, legGeo, propGeo);

    const headMat = new THREE.MeshStandardMaterial({ color: 0xd9b89c, roughness: 0.75, metalness: 0.05 });
    const trouserMat = new THREE.MeshStandardMaterial({ color: 0x2a2d34, roughness: 0.8, metalness: 0.05 });
    const propMat = new THREE.MeshStandardMaterial({ color: 0x263242, roughness: 0.5, metalness: 0.35 });
    const pressMat = new THREE.MeshStandardMaterial({ color: PRESS_VEST_COLOR, roughness: 0.6, metalness: 0.1 });
    this.sharedMats.push(headMat, trouserMat, propMat, pressMat);

    for (const c of COAT_COLORS) {
      this.sharedMats.push(
        new THREE.MeshStandardMaterial({ color: c, roughness: 0.75, metalness: 0.08 }),
      );
    }

    scene.add(this.sceneRoot);
  }

  private buildProceduralRig(index: number, role: BystanderRole): ProceduralRig | null {
    if (!this.sceneRoot || this.sharedGeos.length < 5) return null;

    const torsoGeo = this.sharedGeos[0]!;
    const headGeo = this.sharedGeos[1]!;
    const armGeo = this.sharedGeos[2]!;
    const legGeo = this.sharedGeos[3]!;
    const propGeo = this.sharedGeos[4]!;

    const headMat = this.sharedMats[0]!;
    const trouserMat = this.sharedMats[1]!;
    const propMat = this.sharedMats[2]!;
    const pressMat = this.sharedMats[3]!;
    const coatMat = role === 'press' ? pressMat : this.sharedMats[4 + (index % COAT_COLORS.length)]!;

    const root = new THREE.Group();
    root.visible = false;
    const body = new THREE.Group();
    root.add(body);

    const torso = new THREE.Mesh(torsoGeo, coatMat);
    torso.position.y = 1.06;
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 1.56;

    const leftArm = new THREE.Mesh(armGeo, coatMat);
    leftArm.position.set(-0.27, 1.32, 0);

    const rightArm = new THREE.Group();
    rightArm.position.set(0.27, 1.32, 0);
    rightArm.add(new THREE.Mesh(armGeo, coatMat));
    if (role === 'press' || index % 3 !== 2) {
      const prop = new THREE.Mesh(propGeo, propMat);
      prop.position.set(0.05, -0.5, 0.04);
      rightArm.add(prop);
    }

    const leftLeg = new THREE.Mesh(legGeo, trouserMat);
    leftLeg.position.set(-0.11, 0.72, 0);
    const rightLeg = new THREE.Mesh(legGeo, trouserMat);
    rightLeg.position.set(0.11, 0.72, 0);

    body.add(torso, head, leftArm, rightArm, leftLeg, rightLeg);
    this.sceneRoot.add(root);

    return { root, body, leftArm, rightArm, leftLeg, rightLeg };
  }

  private syncAgentVisual(agent: CivilianAgent, dt: number, playerPos: THREE.Vector3 | undefined): void {
    if (agent.char) {
      const char = agent.char;
      char.root.position.copy(agent.position);
      if (agent.cowerRemaining > 0) {
        char.root.position.y -= 0.34;
      } else if (agent.duckRemaining > 0) {
        char.root.position.y -= 0.18;
      }
      char.root.rotation.y = agent.yaw;

      const dist = playerPos ? agent.position.distanceTo(playerPos) : 15;
      const lod = dist < 24 ? 0 : dist < 52 ? 1 : 2;
      this.loco.speed = agent.currentSpeed;
      this.loco.moveX = 0;
      this.loco.moveZ = agent.currentSpeed > 0.1 ? 1 : 0;
      this.loco.aimYaw = 0;
      this.loco.aimPitch = agent.cowerRemaining > 0 ? -0.45 : agent.duckRemaining > 0 ? -0.25 : 0;
      this.loco.grounded = true;
      char.anim.setLocomotion(this.loco);
      if (agent.cowerRemaining > 0) {
        char.anim.play('block', 0.8);
      }
      if (dt > 0) char.anim.update(dt, lod);
      char.setLod?.(lod);
      char.setShadowActive?.(dist < 44);
      return;
    }

    const rig = agent.rig;
    if (!rig) return;

    rig.root.position.copy(agent.position);
    rig.root.rotation.y = agent.yaw;

    if (agent.cowerRemaining > 0) {
      rig.leftLeg.rotation.x = 0.5;
      rig.rightLeg.rotation.x = 0.5;
      rig.leftArm.rotation.x = -2.2;
      rig.rightArm.rotation.x = -2.2;
      rig.body.position.y = -0.36;
      rig.body.rotation.x = 0.48;
      return;
    }

    const swingAmp = agent.panicRemaining > 0 ? 0.92 : 0.65;
    const s = Math.sin(agent.stridePhase) * swingAmp;
    rig.leftLeg.rotation.x = s;
    rig.rightLeg.rotation.x = -s;
    rig.leftArm.rotation.x = -s * 0.85;
    rig.rightArm.rotation.x = s * 0.65;

    const bob = Math.abs(Math.sin(agent.stridePhase)) * 0.07;
    const duckDrop = agent.duckRemaining > 0 ? -0.24 : 0;
    rig.body.position.y = bob + duckDrop;
    rig.body.rotation.x = agent.duckRemaining > 0 ? 0.38 : agent.panicRemaining > 0 ? 0.18 : 0.08;
  }
}

void _tmpRight;
