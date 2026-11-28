/**
 * The human faction's vehicles: section 17 and section 22 of the design, played through the mission's `vehicle` orders.
 *
 *   data.ts      every number
 *   armour.ts    what a hit is worth
 *   drive.ts     how a ground vehicle moves
 *   models.ts    what they look like
 *   ground.ts    trucks and tanks
 *   chopper.ts   the attack helicopter
 *   mount.ts     a roof gun with a man behind it
 *   crew.ts      the people inside
 *   wreck.ts     what is left
 *
 * EnemyManager builds this on the pages that can have vehicles and nowhere else, so the swarm pays nothing. Combat asks it about anything
 * it hits, through `enemies.vehicles`. docs/notes/vehicles.md has how to use it.
 */
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Mark, VehicleKind, VehicleOrder } from '../../campaign/types';
import { ON_RANGE } from '../../core/devflags';
import { MISSION_ID } from '../../campaign/select';
import type { ExplosionKind, RayHit } from '../../core/contracts';
import { CG, type Ctx, type PlayerSystem } from '../../core/contracts';
import type { EnemyId, ExplosionSpec, FriendlyAircraft, HijackClaim, HijackableVehicle, MissileTarget, VehicleGrappleHit, VehicleRadarTarget, VehicleTargets } from '../../core/gameplay';
import type { Ally } from '../../allies/ally';
import { clamp, rand } from '../../core/math';
import { Airframe } from '../../progression/callins/airframe';
import { GroundProbe } from '../../progression/callins/ground';
import { hitText } from '../../progression/data';
import { ModelMaterials } from '../../progression/modelkit';
import { Gun, type GunSpec } from '../../vehicles/guns';
import { Skyline } from '../../vehicles/skyline';
import { VehicleVision } from '../../vehicles/vision';
import { EXPLOSIONS, SHAPED_CHARGE } from '../../weapons/data';
import type { AiWorld } from '../aiWorld';
import type { Enemy } from '../Enemy';
import type { EnemyManager } from '../EnemyManager';
import { soldierOf } from '../outpost';
import { SOLDIER_BEHAVIOURS } from '../outpost/behaviours';
import { dropOff } from '../roles';
import { bulletDamage, directDamage, splashDamage } from './armour';
import { EnemyChopper, type GunshipRig } from './chopper';
import { CHOPPER, MAX_LIVE, MAX_WRECKS, VEHICLES, type GroundDef, type WeakZone } from './data';
import { EnemyDoorGunner } from './doorGunner';
import { GroundVehicle, GunRack, type GroundOrder } from './ground';
import { CHIN_GUN, Fleet, GUNSHIP_AIRFRAME, gunshipTailGroup } from './models';
import { FastRopeHeli } from './transport';
import { Vehicle, type PartState } from './vehicle';
import { Wreck } from './wreck';

export { VEHICLES } from './data';
export { EnemyDoorGunner } from './doorGunner';
export { FastRopeHeli } from './transport';
export { RIVAL_FRAME, RivalFrame, type RivalAttackKind, type RivalFramePhase, type RivalHitZoneId } from './rivalFrame';
export type GroundVehicleKind = 'humvee' | 'truck' | 'tank';

/** Maximum simultaneous enemy attack helicopters in flight (pooled GunshipRigs). */
export const MAX_CHOPPERS = 3;

/** Friendly AI vehicle (or emplacement) that enemy tanks, humvees, and choppers can target and damage. */
export interface FriendlyGroundTarget {
  readonly id: string | number;
  readonly alive: boolean;
  readonly position: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  readonly aimLift?: number;
  readonly armored?: boolean;
  readonly airborne?: boolean;
  takeDamage(amount: number, from?: THREE.Vector3, source?: string): void;
}

/** Resolved ground/low-altitude hostile target returned by `VehicleSystem.findGroundTarget()`. */
export interface GroundTargetResult {
  readonly kind: 'player' | 'ally' | 'friendly_vehicle';
  readonly position: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  readonly distance: number;
  readonly aimLift: number;
  readonly player?: PlayerSystem;
  readonly ally?: Ally;
  readonly vehicle?: FriendlyGroundTarget;
}

export interface GroundTargetOptions {
  /** Require unobstructed LOS via `lineClear` (default true). */
  readonly requireLos?: boolean;
  /** Explicit ceiling on player world Y for ground vehicles (default 18; players above 25m are always ignored by ground units). */
  readonly maxPlayerY?: number;
  /** When true (e.g., attack helicopters), allows engaging high-altitude airborne players and aircraft. */
  readonly includeAirbornePlayer?: boolean;
  /** When true (e.g., main battle tanks), gives priority weight to friendly armored vehicles. */
  readonly preferArmor?: boolean;
}

interface PendingFriendlyBlast {
  at: THREE.Vector3;
  radius: number;
  damage: number;
  delay: number;
  source: string;
}

declare module '../../core/contracts' {
  interface GameEvents {
    /** A vehicle is dead. Its wreck is on the map. */
    'vehicle:destroyed': { kind: VehicleKind; source: string; position: THREE.Vector3 };
    /** Player reeled into a live enemy vehicle with the Gaff harpoon and triggered an instant grapple hijack. */
    'vehicle:grapple_hijack': { vehicleId: number };
  }
}

/** True on a page that can have vehicles. On the swarm there are none, and none of this is built. */
export const vehiclesActive = (outpost: boolean): boolean => outpost || ON_RANGE || !!MISSION_ID;

/** Metres apart two vehicles need to be at a road entry before the next is let on. */
const ENTRY_GAP = 14;
const TRAFFIC_EVERY = 0.2;
/** How far ahead anyone looks, and the room it wants either side of whatever is there. */
const ROAD_LOOK = 26;
const TRAFFIC_HALF = 1.6;
const STOP_SHORT = 3;
const SIDESTEP = 3.3;
/** How often men in the way get shoved aside. */
const SHOVE_EVERY = 0.08;
const SHOVE_REACH = 0.55;
const CALLOUT = '#ffb347';
const TARGET_MARK = '#ff3b3b';
const SEAT_MARK = '#ff5a3a';
const SEAT_MARK_STRENGTH = 0.6;
const KILL_COLOR = '#ff7a30';
const BLAST_SOURCE = 'vehicle_blast';
const LOS_STEPS = 3;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _claimed = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _hit: RayHit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0, surface: 'concrete', collider: null };
const _near: { distance: number; part: PartState | null } = { distance: 0, part: null };
const _men: Enemy[] = [];
const _losPt = new THREE.Vector3();

interface GroundCand {
  kind: 'player' | 'ally' | 'friendly_vehicle';
  score: number;
  distance: number;
  aimLift: number;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  player?: PlayerSystem;
  ally?: Ally;
  vehicle?: FriendlyGroundTarget;
}
const _groundCands: GroundCand[] = [];

const NO_BEHAVIOURS: Enemy['behaviours'] = [];

interface Waiting {
  order: VehicleOrder;
  at: Mark;
  route: readonly Mark[];
}

export interface ExtraTarget {
  shot(collider: RAPIER.Collider, point: THREE.Vector3, amount: number, source: string): boolean;
  direct(collider: RAPIER.Collider, point: THREE.Vector3, amount: number, kind: ExplosionKind, source: string): boolean;
  blast(center: THREE.Vector3, spec: ExplosionSpec): number;
  paintable?(out: MissileTarget[]): void;
  radarTargets?(out: VehicleRadarTarget[]): void;
  frameBlow?(at: THREE.Vector3, radius: number, damage: number, dir: THREE.Vector3 | null, source: string): number;
  highlightMeshes?(out: THREE.Object3D[]): void;
}

export class VehicleSystem implements VehicleTargets {
  readonly ctx: Ctx;
  readonly manager: EnemyManager;
  readonly colliders = new Map<number, PartState>();
  readonly extras: ExtraTarget[] = [];
  readonly live: Vehicle[] = [];
  readonly wrecks: Wreck[] = [];
  readonly choppers: EnemyChopper[] = [];
  readonly guns: GunRack;
  fleet!: Fleet;
  friendly: FriendlyAircraft | null = null;

  private materials!: ModelMaterials;
  private readonly freeGunships: GunshipRig[] = [];
  private readonly allGunships: GunshipRig[] = [];
  private skyline: Skyline | null = null;
  private readonly waiting: Waiting[] = [];
  private readonly friendlyTargets = new Set<FriendlyGroundTarget>();
  private friendlyVehicleProvider: (() => readonly FriendlyGroundTarget[]) | null = null;
  private readonly pendingFriendlyBlasts: PendingFriendlyBlast[] = [];
  private trafficIn = 0;
  private clearRoad = Infinity;
  private dodgeRoad = 0;
  private readonly lit: THREE.Object3D[] = [];
  /** Tags the mission has told the player to kill. */
  private readonly marked = new Set<string>();
  private shoveIn = 0;

  constructor(readonly world: AiWorld) {
    this.ctx = world.ctx;
    this.manager = world.enemies;
    this.guns = new GunRack(spec => this.buildGun(spec));
  }

  /** Primary live enemy chopper (backwards-compatible accessor when up to 3 choppers are active). */
  get chopper(): EnemyChopper | null {
    return this.choppers[0] ?? null;
  }

  get now(): number {
    return this.world.now;
  }

  private buildGun(spec: GunSpec): Gun {
    return new Gun(this.materials, this.ctx.render.scene, spec);
  }

  init(): void {
    const { campaign, events, render } = this.ctx;
    this.materials = new ModelMaterials(this.ctx);
    this.fleet = new Fleet(this.materials, render.scene);
    this.fleet.warm();
    campaign.provide({ vehicle: (order, at, route) => this.order(order, at, route) });
    events.on('campaign:sweep', () => this.sweep());
  }

  // -------------------------------------------------------------------------------------------
  // Orders
  // -------------------------------------------------------------------------------------------

  /** A mission's order. It waits for room on the road, or in the sky, and goes when there is. */
  order(order: VehicleOrder, at: Mark, route: readonly Mark[]): void {
    this.waiting.push({ order, at, route });
    this.admit();
  }

  private admit(): void {
    for (let i = 0; i < this.waiting.length;) {
      const w = this.waiting[i]!;
      if (!this.roomFor(w)) {
        i++;
        continue;
      }
      this.waiting.splice(i, 1);
      this.start(w);
    }
  }

  private roomFor(w: Waiting): boolean {
    if (w.order.state) return true;
    if (w.order.kind === 'chopper') return this.choppers.length < MAX_CHOPPERS;
    if (w.order.kind === 'transport' || w.order.kind === 'doorGunner') return this.live.length < MAX_LIVE;
    if (this.live.length >= MAX_LIVE) return false;
    const [x, , z] = w.at.at;
    for (const v of this.live) if (Math.hypot(v.position.x - x, v.position.z - z) < ENTRY_GAP + v.def.halfLength) return false;
    return true;
  }

  private start(w: Waiting): void {
    const { order, at, route } = w;
    const crewTag = order.crew && order.crew.length > 0 ? order.crewTag ?? order.tag : null;
    if (order.kind === 'chopper') {
      this.spawnChopper(_a.set(...at.at), route.map(m => new THREE.Vector3(...m.at)), order.tag);
      return;
    }
    if (order.kind === 'transport') {
      const first = route[0];
      const sameAsSpawn = first
        ? Math.hypot(first.at[0] - at.at[0], first.at[2] - at.at[2]) < 2
        : false;
      const drop = (sameAsSpawn ? route[1] : first) ?? at;
      const lz = new THREE.Vector3(...drop.at);
      this.spawnTransport(_a.set(...at.at), lz, lz.y + 12, order.crew ?? [], crewTag ?? order.tag);
      return;
    }
    if (order.kind === 'doorGunner') {
      const focus = route[0] ? new THREE.Vector3(...route[0].at) : new THREE.Vector3(...at.at);
      this.spawnDoorGunner(_a.set(...at.at), focus, order.tag);
      return;
    }
    const hold = order.holds ? route[route.length - 1] : undefined;
    if (order.state === 'wrecked') {
      if (this.wrecks.some(x => x.tag === order.tag)) return;
      this.spawnGround(order.kind, {
        x: at.at[0], y: at.at[1], z: at.at[2], route: [], tag: order.tag, crew: [], crewTag: null, holds: true, holdYaw: at.yaw ?? NaN, parked: true,
      }).cold();
      return;
    }
    this.spawnGround(order.kind, {
      x: at.at[0], y: at.at[1], z: at.at[2],
      route: route.map(m => ({ x: m.at[0], z: m.at[2], hold: m.hold ?? 0 })),
      tag: order.tag, crew: order.crew ?? [], crewTag, holds: !!order.holds, holdYaw: hold?.yaw ?? NaN, parked: order.state === 'parked',
    });
  }

  /** Who a machine at `from` looks for: the player (on foot or in a driveable vehicle/mech). */
  quarry(from: THREE.Vector3): PlayerSystem {
    const everyone = this.ctx.coop?.world?.hostPlayers();
    let best = this.ctx.player;
    if (!everyone) return best;
    let nearest = Infinity;
    for (let i = 0; i < everyone.length; i++) {
      const p = everyone[i]!;
      if (!p.alive || (p.parked && p.interceptor === null)) continue;
      const d = p.position.distanceToSquared(from);
      if (d < nearest) { nearest = d; best = p; }
    }
    return best;
  }

  /** Registers a friendly AI ground/low-air vehicle so enemy armor & choppers can target and damage it. */
  registerFriendlyTarget(target: FriendlyGroundTarget): void {
    this.friendlyTargets.add(target);
  }

  /** Registers a batch of friendly AI vehicles with enemy ground/chopper targeting. */
  registerFriendlyTargets(targets: readonly FriendlyGroundTarget[]): void {
    for (let i = 0; i < targets.length; i++) this.friendlyTargets.add(targets[i]!);
  }

  /** Removes a friendly AI vehicle from enemy targeting (e.g., on disposal). */
  unregisterFriendlyTarget(target: FriendlyGroundTarget): void {
    this.friendlyTargets.delete(target);
  }

  /**
   * Connects a live friendly vehicle list or provider callback (e.g., `() => aiFleet.getLiveGroundTargets()`)
   * so enemy tanks, humvees, and attack choppers engage friendly AI armor alongside `ctx.allies`.
   */
  setFriendlyVehicles(
    targets: readonly FriendlyGroundTarget[] | (() => readonly FriendlyGroundTarget[]) | null,
  ): void {
    if (targets === null) {
      this.friendlyVehicleProvider = null;
    } else if (typeof targets === 'function') {
      this.friendlyVehicleProvider = targets;
    } else {
      const snapshot = targets;
      this.friendlyVehicleProvider = () => snapshot;
    }
  }

  private forEachFriendlyVehicle(fn: (v: FriendlyGroundTarget) => void): void {
    if (this.friendlyTargets.size > 0) {
      for (const v of this.friendlyTargets) fn(v);
    }
    if (this.friendlyVehicleProvider) {
      const list = this.friendlyVehicleProvider();
      for (let i = 0; i < list.length; i++) {
        const v = list[i]!;
        if (!this.friendlyTargets.has(v)) fn(v);
      }
    }
  }

  /**
   * Combined-arms target acquisition for enemy ground vehicles and attack choppers.
   * Considers:
   *  1. The player (when on foot or low `y < 22 m` for ground vehicles, ignoring high-flying jets at `y > 25 m` so tanks fight ground allies/armor instead of staring at the sky),
   *  2. Live friendly infantry in `ctx.allies`,
   *  3. Registered / provided friendly AI vehicles (`setFriendlyVehicles` / `registerFriendlyTarget`).
   */
  findGroundTarget(from: THREE.Vector3, maxRange: number, opts?: GroundTargetOptions): GroundTargetResult | null {
    const requireLos = opts?.requireLos !== false;
    const includeAirborne = opts?.includeAirbornePlayer === true;
    const preferArmor = opts?.preferArmor === true;

    if (!requireLos) {
      let best: GroundTargetResult | null = null;
      let bestScore = Infinity;

      const player = this.quarry(from);
      if (player && player.alive && (!player.parked || player.interceptor !== null)) {
        const py = player.position.y;
        const maxY = opts?.maxPlayerY ?? 22;
        const elevOk = includeAirborne ? true : (py < maxY && py <= 25);
        if (elevOk) {
          _losPt.set(player.position.x, player.position.y + 1.1, player.position.z);
          const dist = from.distanceTo(_losPt);
          if (dist < maxRange) {
            bestScore = dist;
            best = {
              kind: 'player',
              position: player.position,
              velocity: player.velocity,
              distance: dist,
              aimLift: 1.1,
              player,
            };
          }
        }
      }

      const allies = this.ctx.allies?.allies;
      if (allies && allies.length > 0) {
        for (let i = 0; i < allies.length; i++) {
          const a = allies[i]!;
          if (!a.alive) continue;
          const pos = a.body.position;
          _losPt.set(pos.x, pos.y + 1.1, pos.z);
          const dist = from.distanceTo(_losPt);
          if (dist >= maxRange || dist >= bestScore) continue;
          bestScore = dist;
          best = {
            kind: 'ally',
            position: pos,
            velocity: a.body.velocity,
            distance: dist,
            aimLift: 1.1,
            ally: a,
          };
        }
      }

      this.forEachFriendlyVehicle(v => {
        if (!v.alive) return;
        if (v.airborne && !includeAirborne) return;
        const lift = v.aimLift ?? 1.4;
        _losPt.set(v.position.x, v.position.y + lift, v.position.z);
        const dist = from.distanceTo(_losPt);
        if (dist >= maxRange) return;
        const score = (preferArmor && v.armored) ? dist * 0.78 : dist;
        if (score >= bestScore) return;
        bestScore = score;
        best = {
          kind: 'friendly_vehicle',
          position: v.position,
          velocity: v.velocity,
          distance: dist,
          aimLift: lift,
          vehicle: v,
        };
      });

      return best;
    }

    // Collect in-range candidates into reusable scratch buffer, sort ascending by score, and
    // return on the first unobstructed LOS raycast (exact same best target, ~10x fewer rays).
    const maxR2 = maxRange * maxRange;
    let count = 0;
    const pushCand = (
      kind: 'player' | 'ally' | 'friendly_vehicle',
      score: number,
      distance: number,
      aimLift: number,
      position: THREE.Vector3,
      velocity: THREE.Vector3,
      player?: PlayerSystem,
      ally?: Ally,
      vehicle?: FriendlyGroundTarget,
    ) => {
      let c = _groundCands[count];
      if (!c) {
        c = { kind, score, distance, aimLift, position, velocity, player, ally, vehicle };
        _groundCands.push(c);
      } else {
        c.kind = kind;
        c.score = score;
        c.distance = distance;
        c.aimLift = aimLift;
        c.position = position;
        c.velocity = velocity;
        c.player = player;
        c.ally = ally;
        c.vehicle = vehicle;
      }
      count++;
    };

    // 1. Player candidate
    const player = this.quarry(from);
    if (player && player.alive && (!player.parked || player.interceptor !== null)) {
      const py = player.position.y;
      const maxY = opts?.maxPlayerY ?? 22;
      const elevOk = includeAirborne ? true : (py < maxY && py <= 25);
      if (elevOk) {
        const dx = player.position.x - from.x;
        const dy = player.position.y + 1.1 - from.y;
        const dz = player.position.z - from.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < maxR2) {
          const dist = Math.sqrt(d2);
          pushCand('player', dist, dist, 1.1, player.position, player.velocity, player, undefined, undefined);
        }
      }
    }

    // 2. Live friendly infantry (`ctx.allies`)
    const allies = this.ctx.allies?.allies;
    if (allies && allies.length > 0) {
      for (let i = 0; i < allies.length; i++) {
        const a = allies[i]!;
        if (!a.alive) continue;
        const pos = a.body.position;
        const dx = pos.x - from.x;
        const dy = pos.y + 1.1 - from.y;
        const dz = pos.z - from.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= maxR2) continue;
        const dist = Math.sqrt(d2);
        pushCand('ally', dist, dist, 1.1, pos, a.body.velocity, undefined, a, undefined);
      }
    }

    // 3. Registered / provided friendly AI vehicles (tanks, APCs, gunships)
    this.forEachFriendlyVehicle(v => {
      if (!v.alive) return;
      if (v.airborne && !includeAirborne) return;
      const lift = v.aimLift ?? 1.4;
      const dx = v.position.x - from.x;
      const dy = v.position.y + lift - from.y;
      const dz = v.position.z - from.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= maxR2) return;
      const dist = Math.sqrt(d2);
      const score = (preferArmor && v.armored) ? dist * 0.78 : dist;
      pushCand('friendly_vehicle', score, dist, lift, v.position, v.velocity, undefined, undefined, v);
    });

    if (count === 0) return null;

    // Stable insertion sort preserves exact tie-breaking order (player -> allies -> friendly vehicles).
    for (let i = 1; i < count; i++) {
      const cur = _groundCands[i]!;
      let j = i - 1;
      while (j >= 0 && _groundCands[j]!.score > cur.score) {
        _groundCands[j + 1] = _groundCands[j]!;
        j--;
      }
      _groundCands[j + 1] = cur;
    }

    for (let i = 0; i < count; i++) {
      const c = _groundCands[i]!;
      _losPt.set(c.position.x, c.position.y + c.aimLift, c.position.z);
      if (!this.lineClear(from, _losPt)) continue;
      return {
        kind: c.kind,
        position: c.position,
        velocity: c.velocity,
        distance: c.distance,
        aimLift: c.aimLift,
        player: c.player,
        ally: c.ally,
        vehicle: c.vehicle,
      };
    }

    return null;
  }

  /** Schedules an enemy tank shell / chopper rocket / mortar blast against friendly allies and AI vehicles. */
  scheduleFriendlyBlast(at: THREE.Vector3, radius: number, damage: number, delay: number, source: string): void {
    if (delay <= 0) {
      this.damageFriendlyAt(at, radius, damage, source);
      return;
    }
    this.pendingFriendlyBlasts.push({
      at: at.clone(),
      radius,
      damage,
      delay,
      source,
    });
  }

  /** Applies explosive splash damage from enemy ordnance to friendly allies and registered friendly AI vehicles. */
  damageFriendlyAt(at: THREE.Vector3, radius: number, damage: number, source: string): number {
    let hit = 0;

    // 1. Friendly infantry squad (call blast once on closest alive ally inside radius to avoid duplicate AllySystem blasts)
    const allies = this.ctx.allies?.allies;
    if (allies && allies.length > 0) {
      let closest: Ally | null = null;
      let closestDist = radius + 1.2;
      for (let i = 0; i < allies.length; i++) {
        const a = allies[i]!;
        if (!a.alive) continue;
        const d = a.body.position.distanceTo(at);
        if (d <= closestDist) {
          closestDist = d;
          closest = a;
        }
      }
      if (closest) {
        closest.blast(at, radius, damage, 0, source);
        hit++;
      }
    }

    // 2. Registered / provided friendly AI vehicles
    this.forEachFriendlyVehicle(v => {
      if (!v.alive) return;
      const reach = radius + (v.armored ? 3.2 : 2.0);
      const d = v.position.distanceTo(at);
      if (d > reach) return;
      const falloff = clamp(1 - (d / Math.max(0.5, reach)) * 0.72, 0.25, 1);
      v.takeDamage(damage * falloff, at, source);
      hit++;
    });

    return hit;
  }

  private tickFriendlyBlasts(dt: number): void {
    for (let i = this.pendingFriendlyBlasts.length - 1; i >= 0; i--) {
      const b = this.pendingFriendlyBlasts[i]!;
      b.delay -= dt;
      if (b.delay > 0) continue;
      this.pendingFriendlyBlasts.splice(i, 1);
      this.damageFriendlyAt(b.at, b.radius, b.damage, b.source);
    }
  }

  spawnGround(kind: GroundVehicleKind, order: GroundOrder): GroundVehicle {
    const v = new GroundVehicle(this, VEHICLES[kind] as GroundDef, this.fleet.ground(kind), order);
    this.live.push(v);
    this.flag(v);
    return v;
  }

  spawnChopper(from: THREE.Vector3, marks: readonly THREE.Vector3[], tag: string | null): EnemyChopper {
    this.skyline ??= new Skyline(this.ctx, new GroundProbe(this.ctx));
    while (this.choppers.length >= MAX_CHOPPERS) {
      const oldest = this.choppers[0];
      if (!oldest) break;
      oldest.remove();
      const idx = this.choppers.indexOf(oldest);
      if (idx >= 0) this.choppers.splice(idx, 1);
    }
    const c = new EnemyChopper(this, this.acquireGunshipRig(), this.skyline, from, marks, tag);
    this.choppers.push(c);
    this.live.push(c);
    this.flag(c);
    return c;
  }

  spawnTransport(from: THREE.Vector3, lz: THREE.Vector3, hoverY: number, squadIds: readonly EnemyId[], tag: string | null = null): FastRopeHeli {
    const heli = new FastRopeHeli(this, this.materials, from, lz, hoverY, squadIds, tag);
    this.live.push(heli);
    this.flag(heli);
    return heli;
  }

  spawnDoorGunner(from: THREE.Vector3, focus: THREE.Vector3, tag: string | null = null): EnemyDoorGunner {
    this.skyline ??= new Skyline(this.ctx, new GroundProbe(this.ctx));
    const gunner = new EnemyDoorGunner(this, this.materials, this.skyline, from, focus, tag);
    this.live.push(gunner);
    this.flag(gunner);
    return gunner;
  }

  private acquireGunshipRig(): GunshipRig {
    const pooled = this.freeGunships.pop();
    if (pooled) return pooled;
    const { scene } = this.ctx.render;
    const frame = new Airframe(this.materials, scene, GUNSHIP_AIRFRAME);
    const tail = gunshipTailGroup(this.materials);
    frame.root.add(tail);
    const rig: GunshipRig = { frame, tail, gun: new Gun(this.materials, scene, CHIN_GUN) };
    this.allGunships.push(rig);
    return rig;
  }

  chopperGone(chopper?: EnemyChopper, rig?: GunshipRig): void {
    if (chopper) {
      const idx = this.choppers.indexOf(chopper);
      if (idx >= 0) this.choppers.splice(idx, 1);
    } else {
      this.choppers.length = 0;
    }
    if (rig && !this.freeGunships.includes(rig)) {
      this.freeGunships.push(rig);
    }
  }

  /** The player has been told to kill this. A tank at the far end of the apron is otherwise a shell from nowhere, and nothing shows it on the minimap. */
  target(tag: string): void {
    this.marked.add(tag);
    for (const v of this.live) this.flag(v);
  }

  private flag(v: Vehicle): void {
    if (v.alive && v.tag !== null && v.unmark === null && this.marked.has(v.tag)) v.unmark = this.ctx.hud.follow(v.position, v.def.name, TARGET_MARK);
  }

  private unflag(v: Vehicle): void {
    v.unmark?.();
    v.unmark = null;
  }

  /** Writes where the nearest live enemy chopper is. A dying one is no longer anyone's target. */
  chopperAt(out: THREE.Vector3): boolean {
    let best: EnemyChopper | null = null;
    let bestD = Infinity;
    const ref = this.ctx.player?.position;
    for (let i = 0; i < this.choppers.length; i++) {
      const c = this.choppers[i]!;
      if (!c.alive) continue;
      if (!ref) {
        best = c;
        break;
      }
      const d = c.center.distanceToSquared(ref);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    if (!best) return false;
    out.copy(best.center);
    return true;
  }

  setFriendly(aircraft: FriendlyAircraft | null): void {
    this.friendly = aircraft;
  }

  /** Registers an extra destructible war-machine target (FlakTower, OldMother, BaseDefenseSystem) with vehicle hit/blast/paint pipelines. */
  addExtra(target: ExtraTarget): void {
    if (!this.extras.includes(target)) this.extras.push(target);
  }

  removeExtra(target: ExtraTarget): void {
    const i = this.extras.indexOf(target);
    if (i >= 0) this.extras.splice(i, 1);
  }

  /** Every live vehicle and the choppers, for a launcher that paints targets. A Vehicle is a MissileTarget as it stands. */
  paintable(out: MissileTarget[]): number {
    out.length = 0;
    for (const v of this.live) if (v.alive && !v.retired) out.push(v);
    for (const x of this.extras) x.paintable?.(out);
    return out.length;
  }

  // -------------------------------------------------------------------------------------------
  // Men
  // -------------------------------------------------------------------------------------------

  /** A gunner: a real soldier with nothing to think about but the gun under his hands. */
  spawnRider(at: THREE.Vector3): Enemy | null {
    const { manager } = this;
    const o = manager.outpost;
    const id: EnemyId = 'trooper';
    let e: Enemy | null;
    if (o) {
      const squad = o.muster(1, at);
      squad.directed = true;
      e = o.enlistInto(squad, id, at);
    } else e = manager.spawn(id, at);
    if (!e) return null;
    e.behaviours = NO_BEHAVIOURS;
    e.attacks = [];
    e.barkAt = Infinity;
    e.mode = 'hold';
    e.face = 'lock';
    e.pinned = true;
    return e;
  }

  /** False once he has broken or given up. */
  steady(e: Enemy): boolean {
    return soldierOf(e)?.fighting ?? true;
  }

  /** Off the gun and back on his own feet, with a soldier's mind again. */
  unseat(e: Enemy): void {
    dropOff(e);
    e.behaviours = this.manager.outpost ? SOLDIER_BEHAVIOURS : e.def.behaviours;
  }

  killMan(e: Enemy, source: string, from: THREE.Vector3): void {
    const d = {
      amount: e.health + 1, type: 'explosive' as const, point: e.center, dir: _dir.subVectors(e.center, from).setY(1).normalize(), force: 0, source, blastKind: 'barrel' as const, reach: 0.3,
    };
    this.manager.applyDamage(e, d);
  }

  // -------------------------------------------------------------------------------------------
  // What Combat asks
  // -------------------------------------------------------------------------------------------

  private part(collider: RAPIER.Collider | null): PartState | null {
    return collider ? this.colliders.get(collider.handle) ?? null : null;
  }

  /** `pierced` is a dart through armour: it reads as armour let through, not as a plain hit. */
  private marker(dealt: boolean, killed: boolean, pierced = false, weak = false): void {
    const { audio, hud } = this.ctx;
    hud.hitMarker(killed ? 'kill' : weak ? 'armorBroken' : pierced ? 'armorThrough' : dealt ? 'body' : 'armor');
    if (weak) audio.play('vehicle_weak_point');
    audio.play(killed ? 'hit_marker_kill' : weak ? 'plate_destroyed' : pierced ? 'armour_through' : dealt ? 'hit_marker' : 'armour_stopped');
  }

  /** A weak point found: at least its share of the whole machine, and what it does to it. */
  private weakHit(v: Vehicle, zone: WeakZone, share: number, dealt: number, point: THREE.Vector3): number {
    if (zone.id === 'ring' && v instanceof GroundVehicle) v.lockGun(point);
    else if (zone.id === 'pilot') this.callout(point, 'PILOT DOWN');
    else if (zone.id === 'roof') this.callout(point, 'THROUGH THE HATCH');
    return Math.max(dealt, share * v.def.health);
  }

  /** `quiet`: no hit marker or marker sound on this screen (a co-op guest's round, applied by the host: `claimed`). */
  shot(collider: RAPIER.Collider | null, point: THREE.Vector3, amount: number, source: string, quiet = false): boolean {
    // A co-op guest has only the shapes of the host's vehicles: its round is a claim (net/world/vehicleHits.ts).
    if (this.ctx.coop?.world?.vehicleShot(collider, point, amount, source)) return true;
    const part = this.part(collider);
    if (!part) {
      if (collider) for (const x of this.extras) if (x.shot(collider, point, amount, source)) return true;
      return false;
    }
    const v = part.owner;
    let dealt = bulletDamage(v.def, part.def, amount, source);
    if (dealt > 0 && part.def.id === 'cab' && v instanceof GroundVehicle) v.shotDriver(dealt, point);
    const pierced = dealt > 0 && v.def.armoured;
    const weak = pierced && source === 'sabot' ? v.weakAt(part, point) : null;
    if (weak) dealt = this.weakHit(v, weak, weak.sabot, dealt, point);
    if (pierced) this.ctx.audio.play('sabot_on_vehicle', { position: point, pitchJitter: 0.04 });
    v.take(dealt, part, source, point);
    if (!quiet) this.marker(dealt > 0, !v.alive, pierced, weak !== null);
    return true;
  }

  direct(collider: RAPIER.Collider | null, point: THREE.Vector3, amount: number, kind: ExplosionKind, source: string, quiet = false): boolean {
    if (this.ctx.coop?.world?.vehicleShot(collider, point, amount, source, kind)) return true;
    const part = this.part(collider);
    if (!part) {
      if (collider) for (const x of this.extras) if (x.direct(collider, point, amount, kind, source)) return true;
      return false;
    }
    const v = part.owner;
    let dealt = directDamage(v.def, part.def, amount, kind, source);
    const weak = SHAPED_CHARGE[kind] ? v.weakAt(part, point) : null;
    if (weak) dealt = this.weakHit(v, weak, weak.charge, dealt, point);
    v.take(dealt, part, source, point);
    if (!quiet) this.marker(dealt > 0, !v.alive, false, weak !== null);
    return true;
  }

  /**
   * Co-op host: a guest's round landed on `v` (net/world/claims.ts), on the part it names, at `local` in the vehicle's own frame:
   * the two machines draw the vehicle a little apart, and a hit on the hatch on the shooter's screen is a hit on the hatch.
   * Applied as the host's own round would be (`shot`, or `direct` for a rocket or shell of `kind`), without the host's marker.
   */
  claimed(v: Vehicle, part: string | undefined, local: THREE.Vector3, amount: number, source: string, kind?: ExplosionKind): boolean {
    if (!v.alive) return false;
    const point = _claimed.copy(local).applyQuaternion(v.quaternion).add(v.position);
    let struck = v.parts.find(p => p.def.id === part) ?? null;
    if (!struck) {
      v.nearest(point, _near);
      struck = _near.part;
    }
    if (!struck) return false;
    return kind ? this.direct(struck.collider, point, amount, kind, source, true) : this.shot(struck.collider, point, amount, source, true);
  }

  /** Only the player's blasts count: a shell of theirs landing beside a truck of theirs is not what this fight is about. */
  blast(center: THREE.Vector3, spec: ExplosionSpec): number {
    if (spec.team !== 'player') return 0;
    // A co-op guest's blast: the vehicles are the host's, so the host is told and works out which it reaches.
    if (this.ctx.coop?.world?.vehicleBlast(center, spec)) return 0;
    const def = EXPLOSIONS[spec.kind];
    let caught = 0;
    for (let i = this.live.length - 1; i >= 0; i--) {
      const v = this.live[i]!;
      if (!v.alive) continue;
      v.nearest(center, _near);
      if (_near.distance > spec.radius) continue;
      const falloff = 1 - (_near.distance / spec.radius) * (1 - def.edgeDamage);
      const amount = spec.instakill ? Infinity : spec.damage * falloff;
      v.take(splashDamage(v.def, amount, spec.kind, spec.source), _near.part, spec.source, center);
      caught++;
    }
    for (const x of this.extras) caught += x.blast(center, spec);
    return caught;
  }

  /**
   * A Distraint Frame charging into ground vehicles: technicals and trucks are destroyed outright and tossed clear; a tank
   * takes heavy impact damage, staggers, and stops the charge.
   */
  frameCharge(at: THREE.Vector3, dir: THREE.Vector3): 'soft' | 'tank' | null {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const v = this.live[i]!;
      if (!v.alive || !(v instanceof GroundVehicle)) continue;
      const dx = v.position.x - at.x;
      const dz = v.position.z - at.z;
      const reach = v.def.halfLength + 2.4;
      if (dx * dx + dz * dz > reach * reach || Math.abs(v.position.y - at.y) > 4) continue;
      if (v.def.kind === 'tank') {
        v.take(320, null, 'frame_charge', at);
        if (v.alive) {
          v.stagger(1.1);
          this.callout(v.position, 'STAGGERED');
        }
        return 'tank';
      }
      const before = this.wrecks.length;
      v.take(Infinity, null, 'frame_charge', at);
      if (this.wrecks.length > before) {
        const w = this.wrecks[this.wrecks.length - 1]!;
        w.toss(_a.set(dir.x * 14, 7.5, dir.z * 14));
      }
      return 'soft';
    }
    // Already-wrecked light vehicles can be punted out of the way too.
    for (const w of this.wrecks) {
      if (w.halfLength >= 3.5) continue;
      const dx = w.root.position.x - at.x;
      const dz = w.root.position.z - at.z;
      const reach = w.halfLength + 2.4;
      if (dx * dx + dz * dz <= reach * reach && Math.abs(w.root.position.y - at.y) <= 4) {
        w.toss(_a.set(dir.x * 13, 6.5, dir.z * 13));
        return 'soft';
      }
    }
    for (const x of this.extras) {
      if (x.frameBlow?.(at, 4.5, 320, dir, 'frame_charge')) return 'tank';
    }
    return null;
  }

  /** A Frame stomp or backhand against nearby vehicles (and light wrecks if `dir` is given). */
  frameBlow(at: THREE.Vector3, radius: number, damage: number, dir: THREE.Vector3 | null, source: string): number {
    let hit = 0;
    for (let i = this.live.length - 1; i >= 0; i--) {
      const v = this.live[i]!;
      if (!v.alive || !(v instanceof GroundVehicle)) continue;
      v.nearest(at, _near);
      if (_near.distance > radius) continue;
      const before = this.wrecks.length;
      v.take(damage, _near.part, source, at);
      hit++;
      if (dir && v.def.kind !== 'tank' && this.wrecks.length > before) {
        this.wrecks[this.wrecks.length - 1]!.toss(_a.set(dir.x * 11, 5.5, dir.z * 11));
      }
    }
    if (dir) {
      for (const w of this.wrecks) {
        if (w.halfLength >= 3.5) continue;
        if (w.root.position.distanceTo(at) <= radius + w.halfLength * 0.5) {
          w.toss(_a.set(dir.x * 11, 5.5, dir.z * 11));
          hit++;
        }
      }
    }
    for (const x of this.extras) hit += x.frameBlow?.(at, radius, damage, dir, source) ?? 0;
    return hit;
  }

  /** Nearest live enemy vehicle within `maxDist` m that can be hijacked on foot or mid-air. */
  findHijackable(point: THREE.Vector3, maxDist: number): HijackableVehicle | null {
    let best: Vehicle | null = null;
    let bestDist = maxDist;
    for (let i = 0; i < this.live.length; i++) {
      const v = this.live[i]!;
      if (!v.alive || v.retired) continue;
      v.nearest(point, _near);
      if (_near.distance <= bestDist) {
        bestDist = _near.distance;
        best = v;
      }
    }
    if (!best) return null;
    const kind = best.def.kind;
    return {
      id: best.uid,
      kind,
      label: best.def.name,
      position: best.position,
      quaternion: best.quaternion,
      health: best.health,
      maxHealth: best.def.health,
      armored: kind === 'tank',
      airborne: kind === 'chopper' || kind === 'transport' || kind === 'doorGunner',
      distance: bestDist,
    };
  }

  /** Resolves a Gaff harpoon ray hit on a collider into a live vehicle grapple anchor in hull-local space. */
  resolveGrapple(
    collider: RAPIER.Collider | null,
    point: THREE.Vector3,
    normal: THREE.Vector3,
    distance: number,
  ): VehicleGrappleHit | null {
    const part = this.part(collider);
    if (!part) return null;
    const v = part.owner;
    if (!v.alive || v.retired) return null;
    const invQ = new THREE.Quaternion().copy(v.quaternion).invert();
    const localOffset = new THREE.Vector3().subVectors(point, v.position).applyQuaternion(invQ);
    return {
      vehicleId: v.uid,
      kind: v.def.kind,
      point: point.clone(),
      localOffset,
      normal: normal.clone(),
      distance,
    };
  }

  /** Updates world-space anchor position for a harpoon lodged into a moving enemy vehicle. */
  grappleAnchor(vehicleId: number, localOffset: THREE.Vector3, outPos: THREE.Vector3): boolean {
    for (let i = 0; i < this.live.length; i++) {
      const v = this.live[i]!;
      if (v.uid !== vehicleId) continue;
      if (!v.alive || v.retired) return false;
      outPos.copy(localOffset).applyQuaternion(v.quaternion).add(v.position);
      return true;
    }
    return false;
  }

  /**
   * Cleanly commandeers a live enemy vehicle: writes off/ejects enemy crew without softlocking endless waves,
   * retires the enemy hull, and returns its transform + velocity + health fraction for player takeover.
   */
  hijack(vehicleId: number): HijackClaim | null {
    const idx = this.live.findIndex(v => v.uid === vehicleId);
    if (idx < 0) return null;
    const v = this.live[idx]!;
    if (!v.alive || v.retired) return null;

    const kind = v.def.kind;
    const position = v.position.clone();
    let yaw = 0;
    const velocity = new THREE.Vector3();
    if (v instanceof GroundVehicle) {
      yaw = v.drive.yaw;
      velocity.set(Math.sin(yaw) * v.drive.speed, 0, Math.cos(yaw) * v.drive.speed);
    } else {
      _dir.set(0, 0, 1).applyQuaternion(v.quaternion);
      yaw = Math.atan2(_dir.x, _dir.z);
    }
    const healthFraction = Math.max(0.35, Math.min(1, v.health / Math.max(1, v.def.health)));

    this.unflag(v);
    // CRITICAL: call v.remove() BEFORE setting v.retired = true, because every Vehicle.remove()
    // early-returns when `this.retired` is already true (preventing ghost meshes/colliders/audio!).
    v.remove();
    v.alive = false;
    v.retired = true;
    this.live.splice(idx, 1);
    if (v instanceof EnemyChopper) this.chopperGone(v);
    if (v.tag !== null) this.ctx.campaign.unitGone(v.tag, true, 'hijack');

    return { kind, position, yaw, velocity, healthFraction };
  }

  /** Physically shoves any destroyed enemy wrecks in front of a moving player vehicle so wrecks never permanently block roads. */
  pushWrecks(center: THREE.Vector3, radius: number, velocity: THREE.Vector3, mass: number): number {
    const speed = Math.hypot(velocity.x, velocity.z);
    if (speed < 3.5) return 0;
    let pushed = 0;
    for (let i = 0; i < this.wrecks.length; i++) {
      const w = this.wrecks[i]!;
      const dx = w.root.position.x - center.x;
      const dz = w.root.position.z - center.z;
      const reach = radius + Math.max(w.halfWidth, w.halfLength) * 0.9;
      if (dx * dx + dz * dz > reach * reach) continue;
      if (Math.abs(w.root.position.y - center.y) > 3.6) continue;
      const wreckMass = w.halfLength >= 3.5 ? 6.5 : 2.2;
      const ratio = Math.min(1.4, (mass / wreckMass) * 0.65);
      if (ratio < 0.14 && speed < 14) continue;
      const dist = Math.max(0.25, Math.hypot(dx, dz));
      const pushX = velocity.x * 0.55 * ratio + (dx / dist) * speed * 0.35 * ratio;
      const pushZ = velocity.z * 0.55 * ratio + (dz / dist) * speed * 0.35 * ratio;
      const cross = (dx * velocity.z - dz * velocity.x) / (dist * Math.max(1, speed));
      w.shove(_a.set(pushX, 0, pushZ), Math.min(4.2, speed * 0.12 * ratio), cross * speed * 0.18);
      pushed++;
    }
    return pushed;
  }

  /** Resolves a high-speed collision / ram between a player-driven vehicle and any live enemy vehicle. */
  vehicleRam(
    center: THREE.Vector3,
    radius: number,
    velocity: THREE.Vector3,
    mass: number,
    source: string,
  ): { hit: boolean; armored: boolean; killed: boolean; point: THREE.Vector3 } | null {
    const speed = velocity.length();
    if (speed < 6.5) return null;
    for (let i = this.live.length - 1; i >= 0; i--) {
      const v = this.live[i]!;
      if (!v.alive || v.retired) continue;
      v.nearest(center, _near);
      if (_near.distance > radius + 1.35) continue;
      // Kinetic impact heavily favors the player: high-speed & heavy rams smash enemy trucks/humvees and dent tanks!
      const kinetic = mass * Math.pow(speed, 1.38) * 1.15;
      const dmg = Math.max(95, v.def.armoured ? kinetic * 0.95 : kinetic * 2.15);
      const beforeWrecks = this.wrecks.length;
      const hitPt = v.position.clone();
      v.take(dmg, _near.part, source, hitPt);
      const killed = !v.alive;
      if (killed && this.wrecks.length > beforeWrecks) {
        const w = this.wrecks[this.wrecks.length - 1]!;
        w.shove(_a.set(velocity.x * 0.85, 0, velocity.z * 0.85), Math.min(7.5, speed * 0.22), rand(-3.0, 3.0));
      } else if (v instanceof GroundVehicle && v.alive && dmg > 90) {
        v.stagger(1.1);
      }
      return { hit: true, armored: v.def.armoured, killed, point: hitPt };
    }
    return null;
  }

  /** Appends live enemy vehicle radar tracks for AA lead-computing reticles and fighter jet missile lock-on. */
  listTargets(out: VehicleRadarTarget[]): number {
    let added = 0;
    for (let i = 0; i < this.live.length; i++) {
      const v = this.live[i]!;
      if (!v.alive || v.retired) continue;
      const airborne = v.def.kind === 'chopper' || v.def.kind === 'transport' || v.def.kind === 'doorGunner';
      const vel = new THREE.Vector3();
      if (v instanceof GroundVehicle) {
        vel.set(Math.sin(v.drive.yaw) * v.drive.speed, 0, Math.cos(v.drive.yaw) * v.drive.speed);
      } else if ('vel' in v && (v as unknown as { vel: THREE.Vector3 }).vel instanceof THREE.Vector3) {
        vel.copy((v as unknown as { vel: THREE.Vector3 }).vel);
      } else if (v instanceof EnemyChopper) {
        _dir.set(0, 0, 1).applyQuaternion(v.quaternion);
        vel.copy(_dir).multiplyScalar(20);
      }
      out.push({
        id: v.uid,
        kind: v.def.kind,
        label: v.def.name,
        position: v.center.clone(),
        velocity: vel,
        airborne,
      });
      added++;
    }
    const beforeExtras = out.length;
    for (const x of this.extras) x.radarTargets?.(out);
    added += out.length - beforeExtras;
    return added;
  }

  /** Shatters an overkilled airborne helicopter into flaming tumbling hull chunks that rain onto the desert floor. */
  shatterAirborne(wreck: Wreck, at: THREE.Vector3, baseVel: THREE.Vector3): void {
    const { fx, render } = this.ctx;
    const groundY = this.groundUnder(at);
    // Drop main scorched fuselage onto the desert floor from altitude with tumbling momentum.
    wreck.toss(_a.set(baseVel.x * 0.45 + rand(-6, 6), rand(2, 6), baseVel.z * 0.45 + rand(-6, 6)));
    // Spawn 5 fiery spinning debris chunks (rotor hub, tail boom, wing stub, engine cowling, armored panel).
    const chunkMat = new THREE.MeshStandardMaterial({ color: 0x25282c, roughness: 0.9, metalness: 0.35 });
    const sizes: readonly [number, number, number][] = [
      [1.8, 0.35, 0.7],
      [0.6, 0.55, 2.4],
      [1.2, 0.22, 1.1],
      [0.85, 0.85, 1.3],
      [2.6, 0.12, 0.35],
    ];
    for (let i = 0; i < sizes.length; i++) {
      const [sx, sy, sz] = sizes[i]!;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), chunkMat);
      mesh.position.copy(at);
      render.scene.add(mesh);
      fx.attachEmitter(mesh, 'fireTrail', new THREE.Vector3(0, 0, 0), 5.5);
      wreck.fling({
        mesh,
        velocity: new THREE.Vector3(
          baseVel.x * 0.4 + rand(-18, 18),
          rand(5, 16),
          baseVel.z * 0.4 + rand(-18, 18),
        ),
        spin: new THREE.Vector3(rand(-9, 9), rand(-9, 9), rand(-9, 9)),
        floor: groundY + sy * 0.5,
        collider: null,
        flying: true,
      });
    }
  }

  // -------------------------------------------------------------------------------------------
  // What vehicles ask
  // -------------------------------------------------------------------------------------------

  /** True if nothing solid stands between two points. Its own hull is in the way of very little, so it only skips what a ray starts in. */
  lineClear(from: THREE.Vector3, to: THREE.Vector3): boolean {
    _a.copy(from);
    for (let i = 0; i < LOS_STEPS; i++) {
      _dir.subVectors(to, _a);
      const d = _dir.length();
      if (d < 0.1) return true;
      _dir.divideScalar(d);
      if (!this.ctx.physics.raycastInto(_a, _dir, d - 0.05, CG.World, _hit)) return true;
      // Started inside a vehicle's own box: step through it.
      if (_hit.distance > 0.01 || !this.part(_hit.collider)) return false;
      _a.addScaledVector(_dir, 1.5);
    }
    return false;
  }

  groundUnder(at: THREE.Vector3): number {
    const y = this.ctx.world.nav.groundHeight(at.x, at.y - 2.5, at.z);
    return Number.isNaN(y) ? this.ctx.world.bounds.min.y + 1 : y;
  }

  callout(at: THREE.Vector3, text: string): void {
    const shown = hitText(text);
    if (shown) this.ctx.hud.floatText(at, shown, CALLOUT);
  }

  /** A blast with this system's name on it, for wrecks going up. */
  detonate(at: THREE.Vector3, radius: number, damage: number, scale: number, source: string): void {
    // A new object each time: this can be called from inside another blast, which is still reading its own.
    this.ctx.combat.explode(at, { radius, damage, kind: 'barrel', source, team: 'player', scale });
  }

  /** Takes ground off the soldiers' routes, or gives it back. A strip at a time, because that is what a shut door is to them. */
  closeGround(at: THREE.Vector3, yaw: number, halfWidth: number, halfLength: number, shut: boolean): void {
    const routes = this.manager.outpost?.routes;
    if (!routes) return;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    for (let across = 1 - halfWidth; across < halfWidth; across += 2) routes.setClosed(at.x + c * across, at.z - s * across, c, -s, halfLength * 2, shut);
  }

  /** It took a killing hit in the air and has a long way to fall. */
  airburst(at: THREE.Vector3): void {
    const { audio, fx, render } = this.ctx;
    fx.explosion(at, { radius: 6, kind: 'rocket', scale: 1.8 });
    fx.chips(at, 0xff9000, 40);
    render.lights.flash(at, 0xffa050, 14, 40, 0.3);
    audio.play('veh_destroyed', { position: at, volume: 0.95 });
  }

  /** The vehicle has gone. Everything that happens once, in one place. */
  bury(v: Vehicle, wreck: Wreck, source: string, point: THREE.Vector3): void {
    if (v.alive) return;
    this.unflag(v);
    const { ctx } = this;
    const { audio, events, fx, hud, progression, render } = ctx;
    const { def } = v;
    const w = def.wreck;
    _b.copy(v.position);
    _b.y += 1.2;
    fx.chips(_b, 0xff9000, 60);
    fx.embers(_b, 40, 4);
    fx.heatShimmer(_b, def.halfLength * 1.4, 6);
    render.lights.flash(_b, 0xffa050, 18, w.blastRadius * 5, 0.5);
    render.decals.add('scorch', v.position, _up, def.halfLength * 2.2, rand(0, 6.28));
    audio.play('veh_destroyed', { position: _b });
    if (source.length > 0) {
      progression.award(def.score, def.name, _b);
      hud.feed(`${def.name} DESTROYED`, KILL_COLOR);
    }
    this.keep(wreck);
    if (v.tag !== null) ctx.campaign.unitGone(v.tag, true, source);
    events.emit('vehicle:destroyed', { kind: def.kind, source, position: point });
    // Last, because it can set off the truck beside this one, and that comes back through here.
    this.detonate(_b, w.blastRadius, w.blastDamage, w.blastScale, BLAST_SOURCE);
  }

  wreckGunship(v: EnemyChopper, withTail: boolean): Wreck {
    const root = this.fleet.gunshipWreck(withTail);
    root.position.copy(v.position);
    root.position.y -= 0.2;
    root.rotation.set(0.08, rand(0, 6.28), rand(-0.22, 0.22));
    v.quaternion.copy(root.quaternion);
    const colliders = v.wreckColliders();
    return new Wreck(this, root, colliders, CHOPPER.wreck, CHOPPER.halfWidth, CHOPPER.halfLength, v.tag);
  }

  wreckUtility(v: FastRopeHeli | EnemyDoorGunner): Wreck {
    const root = this.fleet.utilityWreck();
    root.position.copy(v.position);
    root.position.y -= 0.2;
    root.rotation.set(0.08, rand(0, 6.28), rand(-0.22, 0.22));
    v.quaternion.copy(root.quaternion);
    const colliders = v.wreckColliders();
    return new Wreck(this, root, colliders, v.def.wreck, v.def.halfWidth, v.def.halfLength, v.tag);
  }

  /** On the map for good. Oldest out past the cap, except one the mission is standing on. */
  keep(wreck: Wreck): void {
    this.wrecks.push(wreck);
    while (this.wrecks.length > MAX_WRECKS) {
      const i = this.wrecks.findIndex(w => !w.keep);
      if (i < 0) return;
      this.wrecks[i]!.dispose();
      this.wrecks.splice(i, 1);
    }
  }

  // -------------------------------------------------------------------------------------------
  // Frame
  // -------------------------------------------------------------------------------------------

  update(dt: number): void {
    if (this.pendingFriendlyBlasts.length > 0) this.tickFriendlyBlasts(dt);
    if (this.live.length === 0 && this.wrecks.length === 0 && this.waiting.length === 0 && this.extras.length === 0) return;
    this.traffic(dt);
    for (let i = 0; i < this.live.length; i++) this.live[i]!.update(dt);
    for (let i = this.live.length - 1; i >= 0; i--) if (this.live[i]!.retired) this.live.splice(i, 1);
    for (const w of this.wrecks) w.update(dt);
    this.shoveMen(dt);
    if (this.waiting.length > 0) this.admit();
    if (this.ctx.player.parked && VehicleVision.enabled) this.mark();
  }

  /** From a gunner's seat a dark machine on a dark road is a guess. They get the same silhouette the men do. */
  private mark(): void {
    const { lit } = this;
    lit.length = 0;
    for (const v of this.live) for (let i = 0; i < v.meshes.length; i++) lit.push(v.meshes[i]!);
    for (const x of this.extras) x.highlightMeshes?.(lit);
    if (lit.length > 0) this.ctx.render.highlight(lit, SEAT_MARK, SEAT_MARK_STRENGTH);
  }

  /** What is in the road, for everything on it. A few times a second: nothing here moves fast enough to need more. */
  private traffic(dt: number): void {
    this.trafficIn -= dt;
    if (this.trafficIn > 0) return;
    this.trafficIn = TRAFFIC_EVERY;
    for (const v of this.live) {
      if (!(v instanceof GroundVehicle)) continue;
      this.clearRoad = Infinity;
      this.dodgeRoad = 0;
      for (const o of this.live) {
        if (o !== v && o.alive && o instanceof GroundVehicle) this.lookAhead(v, o.position.x, o.position.z, o.def.halfWidth, o.def.halfLength, o.settled);
      }
      for (const w of this.wrecks) this.lookAhead(v, w.root.position.x, w.root.position.z, w.halfWidth, w.halfLength, true);
      v.setTraffic(Math.max(this.clearRoad, 0), this.dodgeRoad);
    }
  }

  /** Round something stopped in the road, and in behind anything else: a moving one, or one parked where this one was going anyway. */
  private lookAhead(v: GroundVehicle, x: number, z: number, half: number, length: number, stopped: boolean): void {
    const { drive, def } = v;
    const way = drive.reversing ? -1 : 1;
    const fx = Math.sin(drive.yaw) * way;
    const fz = Math.cos(drive.yaw) * way;
    const dx = x - drive.x;
    const dz = z - drive.z;
    const ahead = dx * fx + dz * fz;
    const across = dx * fz - dz * fx;
    if (ahead < 0 || ahead > ROAD_LOOK + def.halfLength || Math.abs(across) > def.halfWidth + half + TRAFFIC_HALF) return;
    if (stopped && drive.roadLeft > ahead + length + def.halfLength + STOP_SHORT) this.dodgeRoad = across >= 0 ? -SIDESTEP : SIDESTEP;
    else this.clearRoad = Math.min(this.clearRoad, ahead - def.halfLength - length - STOP_SHORT);
  }

  /** Nobody walks through a truck, moving or burnt out. Soldiers have no bodies, so they are moved aside here. */
  private shoveMen(dt: number): void {
    this.shoveIn -= dt;
    if (this.shoveIn > 0) return;
    this.shoveIn = SHOVE_EVERY;
    for (const v of this.live) if (v instanceof GroundVehicle) this.shoveFrom(v.position, v.drive.yaw, v.def.halfWidth, v.def.halfLength);
    for (const w of this.wrecks) this.shoveFrom(w.root.position, w.root.rotation.y, w.halfWidth, w.halfLength);
  }

  private shoveFrom(at: THREE.Vector3, yaw: number, halfWidth: number, halfLength: number): void {
    const n = this.manager.query(at, halfLength + 1.5, _men as never);
    const s = Math.sin(yaw);
    const c = Math.cos(yaw);
    for (let i = 0; i < n; i++) {
      const e = _men[i]!;
      if (!e.alive || e.airborne || e.pinned || e.downed) continue;
      const dx = e.position.x - at.x;
      const dz = e.position.z - at.z;
      const across = dx * c - dz * s;
      const along = dx * s + dz * c;
      const x = halfWidth + SHOVE_REACH - Math.abs(across);
      const z = halfLength + SHOVE_REACH - Math.abs(along);
      if (x <= 0 || z <= 0) continue;
      if (x < z) {
        const out = x * (across >= 0 ? 1 : -1);
        e.position.x += c * out;
        e.position.z -= s * out;
      } else {
        const out = z * (along >= 0 ? 1 : -1);
        e.position.x += s * out;
        e.position.z += c * out;
      }
    }
  }

  /** Every machine up in flames at once, for the lab and for bots. */
  killAll(source: string): void {
    for (const v of this.live) v.take(Infinity, null, source, v.position);
  }

  /** The fight has moved on. Everything still running goes with it, and nothing is scored. */
  private sweep(): void {
    for (const w of this.waiting) {
      if (w.order.state) continue;
      const crew = w.order.crew?.length ?? 0;
      this.ctx.campaign.unitGone(w.order.tag, false, '');
      for (let i = 0; i < crew; i++) this.ctx.campaign.unitGone(w.order.crewTag ?? w.order.tag, false, '');
    }
    this.waiting.length = 0;
    for (const v of this.live) {
      if (v.retired) continue;
      this.unflag(v);
      v.remove();
      if (v.tag !== null) this.ctx.campaign.unitGone(v.tag, false, '');
    }
    this.live.length = 0;
  }

  reset(): void {
    this.waiting.length = 0;
    this.marked.clear();
    for (const v of this.live) {
      this.unflag(v);
      v.remove();
    }
    this.live.length = 0;
    for (const w of this.wrecks) w.dispose();
    this.wrecks.length = 0;
    this.friendly = null;
    this.choppers.length = 0;
    this.freeGunships.length = 0;
    for (const g of this.allGunships) {
      g.frame.hide();
      g.gun.hide();
      this.freeGunships.push(g);
    }
    this.friendlyTargets.clear();
    this.friendlyVehicleProvider = null;
    this.pendingFriendlyBlasts.length = 0;
  }

  /** One read of everything, for bots and the lab. */
  describe(): Record<string, unknown> {
    return {
      live: this.live.map(v => ({ kind: v.def.kind, health: Math.round(v.health), x: Math.round(v.position.x), y: Math.round(v.position.y), z: Math.round(v.position.z), tag: v.tag })),
      wrecks: this.wrecks.length,
      waiting: this.waiting.length,
    };
  }
}

