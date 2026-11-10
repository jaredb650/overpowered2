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
import { CG, type Ctx } from '../../core/contracts';
import type { EnemyId, ExplosionSpec, FriendlyAircraft, MissileTarget, VehicleTargets } from '../../core/gameplay';
import { rand } from '../../core/math';
import { Airframe } from '../../progression/callins/airframe';
import { GroundProbe } from '../../progression/callins/ground';
import { ModelMaterials } from '../../progression/modelkit';
import { Gun, type GunSpec } from '../../vehicles/guns';
import { Skyline } from '../../vehicles/skyline';
import { EXPLOSIONS } from '../../weapons/data';
import type { AiWorld } from '../aiWorld';
import type { Enemy } from '../Enemy';
import type { EnemyManager } from '../EnemyManager';
import { soldierOf } from '../outpost';
import { SOLDIER_BEHAVIOURS } from '../outpost/behaviours';
import { dropOff } from '../roles';
import { bulletDamage, directDamage, splashDamage } from './armour';
import { EnemyChopper, type GunshipRig } from './chopper';
import { CHOPPER, MAX_LIVE, MAX_WRECKS, VEHICLES, type GroundDef } from './data';
import { GroundVehicle, GunRack, type GroundOrder } from './ground';
import { CHIN_GUN, Fleet, GUNSHIP_AIRFRAME, gunshipTailGroup } from './models';
import { Vehicle, type PartState } from './vehicle';
import { Wreck } from './wreck';

export { VEHICLES } from './data';

declare module '../../core/contracts' {
  interface GameEvents {
    /** A vehicle is dead. Its wreck is on the map. */
    'vehicle:destroyed': { kind: VehicleKind; source: string; position: THREE.Vector3 };
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
const _up = new THREE.Vector3(0, 1, 0);
const _hit: RayHit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0, surface: 'concrete', collider: null };
const _near: { distance: number; part: PartState | null } = { distance: 0, part: null };
const _men: Enemy[] = [];

const NO_BEHAVIOURS: Enemy['behaviours'] = [];

interface Waiting {
  order: VehicleOrder;
  at: Mark;
  route: readonly Mark[];
}

export class VehicleSystem implements VehicleTargets {
  readonly ctx: Ctx;
  readonly manager: EnemyManager;
  readonly colliders = new Map<number, PartState>();
  readonly live: Vehicle[] = [];
  readonly wrecks: Wreck[] = [];
  readonly guns: GunRack;
  fleet!: Fleet;
  friendly: FriendlyAircraft | null = null;

  private materials!: ModelMaterials;
  private gunship: GunshipRig | null = null;
  private skyline: Skyline | null = null;
  private chopper: EnemyChopper | null = null;
  private readonly waiting: Waiting[] = [];
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
    if (w.order.kind === 'chopper') return this.chopper === null;
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

  spawnGround(kind: Exclude<VehicleKind, 'chopper'>, order: GroundOrder): GroundVehicle {
    const v = new GroundVehicle(this, VEHICLES[kind] as GroundDef, this.fleet.ground(kind), order);
    this.live.push(v);
    this.flag(v);
    return v;
  }

  spawnChopper(from: THREE.Vector3, marks: readonly THREE.Vector3[], tag: string | null): EnemyChopper {
    this.skyline ??= new Skyline(this.ctx, new GroundProbe(this.ctx));
    this.chopper?.remove();
    this.chopper = new EnemyChopper(this, this.rig(), this.skyline, from, marks, tag);
    this.live.push(this.chopper);
    this.flag(this.chopper);
    return this.chopper;
  }

  private rig(): GunshipRig {
    if (this.gunship) return this.gunship;
    const { scene } = this.ctx.render;
    const frame = new Airframe(this.materials, scene, GUNSHIP_AIRFRAME);
    const tail = gunshipTailGroup(this.materials);
    frame.root.add(tail);
    this.gunship = { frame, tail, gun: new Gun(this.materials, scene, CHIN_GUN) };
    return this.gunship;
  }

  chopperGone(): void {
    this.chopper = null;
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

  /** Writes where the enemy chopper is. A dying one is no longer anyone's target. */
  chopperAt(out: THREE.Vector3): boolean {
    if (!this.chopper?.alive) return false;
    out.copy(this.chopper.center);
    return true;
  }

  setFriendly(aircraft: FriendlyAircraft | null): void {
    this.friendly = aircraft;
  }

  /** Every live vehicle and the chopper, for a launcher that paints targets. A Vehicle is a MissileTarget as it stands. */
  paintable(out: MissileTarget[]): number {
    out.length = 0;
    for (const v of this.live) if (v.alive && !v.retired) out.push(v);
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

  private marker(dealt: boolean, killed: boolean): void {
    const { audio, hud } = this.ctx;
    hud.hitMarker(killed ? 'kill' : dealt ? 'body' : 'armor');
    audio.play(killed ? 'hit_marker_kill' : dealt ? 'hit_marker' : 'hit_marker_armor');
  }

  shot(collider: RAPIER.Collider | null, point: THREE.Vector3, amount: number, source: string): boolean {
    const part = this.part(collider);
    if (!part) return false;
    const v = part.owner;
    const dealt = bulletDamage(v.def, part.def, amount, source);
    if (dealt > 0 && part.def.id === 'cab' && v instanceof GroundVehicle) v.shotDriver(dealt, point);
    v.take(dealt, part, source, point);
    this.marker(dealt > 0, !v.alive);
    return true;
  }

  direct(collider: RAPIER.Collider | null, point: THREE.Vector3, amount: number, kind: ExplosionKind, source: string): boolean {
    const part = this.part(collider);
    if (!part) return false;
    const v = part.owner;
    const dealt = directDamage(v.def, part.def, amount, kind, source);
    v.take(dealt, part, source, point);
    this.marker(dealt > 0, !v.alive);
    return true;
  }

  /** Only the player's blasts count: a shell of theirs landing beside a truck of theirs is not what this fight is about. */
  blast(center: THREE.Vector3, spec: ExplosionSpec): number {
    if (spec.team !== 'player') return 0;
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
    return caught;
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
    this.ctx.hud.floatText(at, text, CALLOUT);
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
    audio.play('vehicle_explode', { position: at, volume: 0.8 });
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
    audio.play('vehicle_explode', { position: _b });
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
    if (this.live.length === 0 && this.wrecks.length === 0 && this.waiting.length === 0) return;
    this.traffic(dt);
    for (let i = 0; i < this.live.length; i++) this.live[i]!.update(dt);
    for (let i = this.live.length - 1; i >= 0; i--) if (this.live[i]!.retired) this.live.splice(i, 1);
    for (const w of this.wrecks) w.update(dt);
    this.shoveMen(dt);
    if (this.waiting.length > 0) this.admit();
    if (this.ctx.player.parked) this.mark();
  }

  /** From a gunner's seat a dark machine on a dark road is a guess. They get the same silhouette the men do. */
  private mark(): void {
    const { lit } = this;
    lit.length = 0;
    for (const v of this.live) for (let i = 0; i < v.meshes.length; i++) lit.push(v.meshes[i]!);
    this.ctx.render.highlight(lit, SEAT_MARK, SEAT_MARK_STRENGTH);
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
    this.chopper = null;
    this.gunship?.frame.hide();
    this.gunship?.gun.hide();
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

