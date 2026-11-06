/**
 * Anything on wheels or tracks. It drives its road, stops, lets its men out, and fights: a roof gun with a man behind it, and on a tank a
 * main gun that has to be laid.
 *
 * The rhythm of the main gun is the whole fight with a tank. The turret comes round slowly, it stops on the mark with a laser up, and
 * there is a moment to get off that line before the round goes. Losing sight of the player does not stop it: it keeps laying on the last
 * place it saw him, so cover under a tank's gun does not stay cover. Shots at it change what it can do. A thrown track stops it, a burning
 * engine slows it and its loader, a jammed ring turns the turret into a slow thing the player can outrun.
 */
import * as THREE from 'three';
import type { EmitterHandle, LoopHandle } from '../../core/contracts';
import type { EnemyId, ProjectileSpec } from '../../core/gameplay';
import { clamp, damp, dampAngle, rand, wrapAngle } from '../../core/math';
import { EngineSound } from '../../progression/callins/airframe';
import type { Gun, GunSpec } from '../../vehicles/guns';
import type { Enemy } from '../Enemy';
import { Crew } from './crew';
import {
  DRIVER_HEALTH, ENGINE_FIRE_BLEED, ENGINE_FIRE_RELOAD, ENGINE_FIRE_SPEED, SOFT_FIRE_AT, SOFT_FIRE_SECONDS, type CannonDef, type GroundDef,
} from './data';
import { Driver, type RoutePoint } from './drive';
import type { VehicleSystem } from './index';
import { CANNON_MUZZLE, PINTLE, PINTLE_GUN, TRUNNION, TURRET_RING, type GroundModel } from './models';
import { Mount } from './mount';
import { GROUND_ENGINES } from './sounds';
import { Vehicle, type PartState } from './vehicle';
import { Wreck, type Flung } from './wreck';

/** What the mission or the lab asks for. */
export interface GroundOrder {
  x: number;
  y: number;
  z: number;
  route: readonly RoutePoint[];
  tag: string | null;
  crew: readonly EnemyId[];
  crewTag: string | null;
  /** Drives the route tail first and fights from the end of it, facing `holdYaw` if that is a number. */
  holds: boolean;
  holdYaw: number;
  /** No one in it. It sits there. */
  parked: boolean;
}

/** Seconds between looks at the player, and between readings of the ground. */
const LOOK_EVERY = 0.22;
const GROUND_EVERY = 0.12;
/** Seconds a tank keeps laying on the place it last saw the player. */
const REMEMBERS = 8;
/** Radians off at which a laid gun counts as on. */
const LAID = 0.045;
const GUN_MIN = -0.14;
const GUN_MAX = 0.42;
const LASER_COLOR = 0xff2010;
const LASER_STRENGTH = 0.9;
/** Share of the laser's life that it follows before it locks. The last of it is the player's window. */
const LASER_TRACKS = 0.35;
const RECOIL = 0.62;
const RECOIL_RETURN = 5;
const SHELL_SHAKE = 0.5;
const TURRET_JAM = 0.22;
/** A tank that has stopped shifts along the road now and then, because the one thing it must not be is a fixture. */
const SHUFFLE_EVERY: readonly [number, number] = [11, 19];
const SHUFFLE_METRES: readonly [number, number] = [5, 11];
const STOPPED = 0.25;
/** Speed under which a bump only nudges. */
const RAM_FROM = 2.5;
const RAM_COOLDOWN = 0.9;
const PLAYER_RADIUS = 0.45;
/** How far ahead it looks for anything parked in the road, and how wide a thing has to be to count. */
const ROAD_LOOK = 22;
const SIDESTEP = 3.1;
/** Chance a tank's men live to climb out of it. */
const TANK_SURVIVOR = 0.35;

const _pivot = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);

const SHELL: ProjectileSpec = {
  origin: _muzzle, velocity: _vel, kind: 'shell', team: 'enemy', damage: 0, source: 'tank_cannon',
  explosion: { radius: 0, damage: 0, kind: 'enemy', playerPush: 20, scale: 1.3 }, trail: 'rings', tracer: 'heavy', lifetime: 4,
};

type GunStage = 'loading' | 'laying';

export class GroundVehicle extends Vehicle {
  readonly drive: Driver;
  private readonly mount: Mount | null;
  private readonly crew: Crew;
  private readonly engine: EngineSound;
  private y: number;
  private rider: Enemy | null = null;
  private driverHealth = DRIVER_HEALTH;
  private travelled = 0;
  private lookIn = 0;
  private groundIn = 0;
  private sees = false;
  private seenAt = -99;
  private readonly lastSeen = new THREE.Vector3();
  private clear = Infinity;
  private dodge = 0;
  private shuffleIn: number;
  private shuffleWay = -1;
  private readonly shuffleTo: RoutePoint[] = [{ x: 0, z: 0, hold: 0 }];
  private ramReady = 0;
  private placed = false;

  private stage: GunStage = 'loading';
  private reloadLeft = 1.5;
  private layLeft = 0;
  private laser = -1;
  private gunPitch = 0;
  private gunRecoil = 0;
  private readonly layAt = new THREE.Vector3();
  private turretLoop: LoopHandle | null = null;

  private fireLeft = -1;
  private engineFire = false;
  private turretJammed = false;
  private readonly smoke: EmitterHandle[] = [];

  constructor(sys: VehicleSystem, override readonly def: GroundDef, private readonly model: GroundModel, private readonly order: GroundOrder) {
    super(sys, def, order.tag);
    this.y = order.y;
    this.drive = new Driver(def.drive);
    const first = order.route[0] ?? { x: order.x, z: order.z + 1 };
    const second = order.route.find(p => Math.hypot(p.x - order.x, p.z - order.z) > 1) ?? first;
    const heading = Math.atan2(second.x - order.x, second.z - order.z);
    this.drive.begin(order.x, order.z, order.holds ? heading + Math.PI : heading, order.route);
    if (order.holds) {
      this.drive.reversing = true;
      if (!Number.isNaN(order.holdYaw)) this.drive.face(order.holdYaw);
    }
    this.shuffleIn = rand(SHUFFLE_EVERY[0], SHUFFLE_EVERY[1]);
    this.crew = new Crew(sys, order.crew, order.crewTag);
    this.engine = new EngineSound(sys.ctx, GROUND_ENGINES[def.kind as 'humvee' | 'truck' | 'tank']);
    for (const w of model.steered) w.rotation.order = 'YXZ';
    this.mount = order.parked ? null : this.fitGun();
    if (order.parked) this.drive.halt();
    else this.engine.start(1);
    this.pose(0);
    model.root.visible = true;
    if (def.rider && !order.parked) this.seatRider();
  }

  private fitGun(): Mount {
    const { sys, def } = this;
    const gun = sys.guns.get(PINTLE_GUN);
    const mount = new Mount(sys.ctx, def.mount, gun, `${def.kind}_gun`, 'mounted_gun', def.kind === 'tank' ? 1.1 : 1);
    mount.snap(this.drive.yaw + Math.PI, 0);
    return mount;
  }

  /** A real soldier on the gun: he can be shot off it, and it stops when he is. */
  private seatRider(): void {
    const e = this.sys.spawnRider(this.position);
    if (!e) return;
    this.rider = e;
    this.placeRider();
  }

  private pivot(out: THREE.Vector3): THREE.Vector3 {
    const { def, model } = this;
    const at = PINTLE[def.kind as 'humvee' | 'truck' | 'tank'];
    if (def.kind === 'tank') {
      // The tank's gun rides on the turret, so it swings with it.
      return out.set(at[0], at[1] - TURRET_RING[1], at[2] - TURRET_RING[2]).applyAxisAngle(_up, this.turretYaw)
        .add(_p.set(TURRET_RING[0], TURRET_RING[1], TURRET_RING[2])).applyQuaternion(model.root.quaternion).add(model.root.position);
    }
    return out.set(at[0], at[1], at[2]).applyQuaternion(model.root.quaternion).add(model.root.position);
  }

  private placeRider(): void {
    const { rider, mount, def } = this;
    if (!rider || !mount || !def.rider) return;
    this.pivot(_pivot);
    const back = def.rider[2];
    rider.position.set(_pivot.x + Math.sin(mount.yaw) * -back, _pivot.y + def.rider[1], _pivot.z + Math.cos(mount.yaw) * -back);
    rider.groundY = rider.position.y;
    rider.yaw = mount.yaw + Math.PI;
  }

  private get gunnerUp(): boolean {
    const { rider, def } = this;
    if (!def.rider) return true;
    if (!rider) return false;
    if (rider.alive && rider.pinned) return true;
    this.rider = null;
    return false;
  }

  /** Free road ahead, for the fleet's traffic pass. */
  setTraffic(clear: number, dodge: number): void {
    this.clear = clear;
    this.dodge = dodge;
  }

  get body(): THREE.Object3D {
    return this.model.root;
  }

  get settled(): boolean {
    return this.drive.done && Math.abs(this.drive.speed) < STOPPED;
  }

  update(dt: number): void {
    const { drive, order } = this;
    if (this.fireLeft >= 0) this.burn(dt);
    if (this.engineFire) this.take(ENGINE_FIRE_BLEED * dt, null, this.source, this.position);
    if (!this.alive) return;
    this.look(dt);
    if (!drive.done || this.clear < ROAD_LOOK) drive.sidestep(this.dodge, dt);
    drive.update(dt, this.clear);
    this.pose(dt);
    this.moved();
    if (order.parked) return;
    if (this.def.cannon) this.mainGun(dt, this.def.cannon);
    this.roofGun(dt);
    this.disembark(dt);
    this.shuffle(dt);
    this.bump(dt);
    this.engine.update(this.position, 1, dt, undefined, 0.8 + 0.5 * Math.abs(drive.speed) / this.def.drive.top);
  }

  private look(dt: number): void {
    this.lookIn -= dt;
    if (this.lookIn > 0) return;
    this.lookIn = LOOK_EVERY;
    const { ctx, now } = this.sys;
    const { player } = ctx;
    this.pivot(_pivot);
    _aim.copy(player.position);
    _aim.y += 1.1;
    const range = this.def.cannon?.range ?? this.def.mount.range;
    this.sees = player.alive && !player.parked && !this.order.parked && _pivot.distanceTo(_aim) < range && this.sys.lineClear(_pivot, _aim);
    if (!this.sees) return;
    this.lastSeen.copy(_aim);
    this.seenAt = now;
  }

  private pose(dt: number): void {
    const { drive, model, def } = this;
    this.groundIn -= dt;
    if (this.groundIn <= 0) {
      this.groundIn = GROUND_EVERY;
      const ground = this.sys.ctx.world.nav.groundHeight(drive.x, this.y + 1.2, drive.z);
      // Anything far above the wheels is its own roof, read through a gap in the nav.
      if (!Number.isNaN(ground) && ground < this.y + 1.5) this.y = dt > 0 ? damp(this.y, ground, 9, GROUND_EVERY) : ground;
    }
    model.root.position.set(drive.x, this.y, drive.z);
    model.root.rotation.set(0, drive.yaw, 0);
    model.body.rotation.set(drive.pitch, 0, drive.roll);
    model.body.position.y = Math.abs(drive.pitch) * def.halfLength * 0.4;
    this.position.copy(model.root.position);
    this.quaternion.copy(model.root.quaternion);
    const step = drive.speed * dt;
    this.travelled += step;
    for (const w of model.wheels) w.part.rotation.x += step / w.part.position.y;
    for (const w of model.steered) w.rotation.y = drive.wheel * def.drive.steer;
    const link = Math.floor(this.travelled / 0.25) & 1;
    for (const t of model.tracks) {
      if (!t.belt.visible) continue;
      t.links[0].visible = link === 0;
      t.links[1].visible = link === 1;
    }
    model.root.updateMatrixWorld();
  }

  /** A parked truck leaves its colliders alone: moving one is what wakes the broad phase. */
  private moved(): void {
    if (this.placed && Math.abs(this.drive.speed) <= 0.01 && !this.def.cannon) return;
    this.placeColliders();
    this.placed = true;
  }

  /** The target, with as much lead as this crew can manage. */
  private leadOn(c: CannonDef, from: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    const { player } = this.sys.ctx;
    const t = from.distanceTo(this.lastSeen) / c.speed;
    return out.copy(this.lastSeen).addScaledVector(player.velocity, t * c.lead * (this.sees ? 1 : 0));
  }

  private mainGun(dt: number, c: CannonDef): void {
    const { sys, model, drive } = this;
    const { now } = sys;
    const turret = model.turret!;
    const barrel = model.barrel!;
    const engaged = now - this.seenAt < REMEMBERS;
    const reload = this.engineFire ? ENGINE_FIRE_RELOAD : 1;
    this.reloadLeft -= (dt / reload);
    this.muzzle(_muzzle);
    if (this.stage === 'laying') {
      const left = this.layLeft / c.lay;
      if (left > LASER_TRACKS && this.sees) this.leadOn(c, _muzzle, this.layAt);
    } else if (engaged) this.leadOn(c, _muzzle, this.layAt);

    // The turret and the gun chase the mark at their own slow rates.
    let error = 0;
    if (engaged || this.stage === 'laying') {
      this.pivotRing(_pivot);
      const wanted = wrapAngle(Math.atan2(this.layAt.x - _pivot.x, this.layAt.z - _pivot.z) - drive.yaw);
      error = wrapAngle(wanted - this.turretYaw);
      const rate = c.traverse * (this.turretJammed ? TURRET_JAM : 1) * dt;
      this.turretYaw = wrapAngle(this.turretYaw + clamp(error, -rate, rate));
      const flat = Math.hypot(this.layAt.x - _pivot.x, this.layAt.z - _pivot.z);
      const lift = clamp(Math.atan2(this.layAt.y - _pivot.y - TRUNNION[1], flat), GUN_MIN, GUN_MAX);
      this.gunPitch += clamp(lift - this.gunPitch, -c.elevate * dt, c.elevate * dt);
    } else if (this.order.holds && !Number.isNaN(this.order.holdYaw)) {
      this.turretYaw = dampAngle(this.turretYaw, wrapAngle(this.order.holdYaw + Math.PI - drive.yaw), 0.5, dt);
    }
    turret.rotation.y = this.turretYaw;
    this.gunRecoil = damp(this.gunRecoil, 0, RECOIL_RETURN, dt);
    barrel.rotation.x = -this.gunPitch;
    barrel.position.z = TRUNNION[2] - this.gunRecoil;
    this.whine(Math.abs(error) > 0.02);

    if (this.stage === 'loading') {
      if (this.reloadLeft <= 0 && engaged && Math.abs(error) < LAID) this.beginLay(c);
      return;
    }
    this.layLeft -= dt;
    this.muzzle(_muzzle);
    sys.world.telegraphs.aimLaser(this.laser, _muzzle, this.layAt);
    if (this.layLeft <= 0) this.fire(c);
  }

  private pivotRing(out: THREE.Vector3): THREE.Vector3 {
    return out.set(TURRET_RING[0], TURRET_RING[1], TURRET_RING[2]).applyQuaternion(this.quaternion).add(this.position);
  }

  private beginLay(c: CannonDef): void {
    const { sys } = this;
    this.stage = 'laying';
    this.layLeft = c.lay;
    this.laser = sys.world.telegraphs.acquireLaser(LASER_COLOR, LASER_STRENGTH);
    sys.ctx.audio.play('tank_lay', { position: this.position });
  }

  private endLay(): void {
    if (this.laser >= 0) this.sys.world.telegraphs.releaseLaser(this.laser);
    this.laser = -1;
  }

  private whine(on: boolean): void {
    const { audio } = this.sys.ctx;
    if (on && !this.turretLoop) this.turretLoop = audio.startLoop('tank_turret_loop', { position: this.position, fadeIn: 0.15 });
    else if (!on && this.turretLoop) {
      this.turretLoop.stop(0.2);
      this.turretLoop = null;
      audio.play('tank_turret_stop', { position: this.position });
    }
    this.turretLoop?.setPosition(this.position);
  }

  /** Writes the end of the main gun, valid from the last `pose`. */
  private muzzle(out: THREE.Vector3): THREE.Vector3 {
    const { model } = this;
    const barrel = model.barrel!;
    barrel.updateWorldMatrix(true, false);
    return out.set(CANNON_MUZZLE[0], CANNON_MUZZLE[1], CANNON_MUZZLE[2]).applyMatrix4(barrel.matrixWorld);
  }

  private fire(c: CannonDef): void {
    const { sys, drive } = this;
    const { audio, camera, combat, fx, player } = sys.ctx;
    this.endLay();
    this.stage = 'loading';
    this.reloadLeft = c.reload;
    this.muzzle(_muzzle);
    _dir.subVectors(this.layAt, _muzzle).normalize();
    _vel.copy(_dir).multiplyScalar(c.speed);
    SHELL.damage = c.damage;
    SHELL.explosion!.radius = c.radius;
    SHELL.explosion!.damage = c.damage;
    combat.spawnProjectile(SHELL);
    fx.muzzleFlash(_muzzle, _dir, 'autocannon');
    fx.smoke(_muzzle, '#8a8478', 2.6, 1.6);
    _p.set(this.position.x, this.y + 0.1, this.position.z);
    fx.dust(_p.addScaledVector(_dir, 3), _up, 4);
    this.gunRecoil = RECOIL;
    // The whole machine rocks back on its springs: a gun this size moves forty tonnes.
    drive.shove(-Math.cos(this.turretYaw) * 0.55, Math.sin(this.turretYaw) * 0.4);
    audio.play('tank_cannon', { position: _muzzle });
    const near = clamp(1 - _muzzle.distanceTo(player.position) / 70);
    if (near > 0) camera.addTrauma(SHELL_SHAKE * near * near);
  }

  private roofGun(dt: number): void {
    const { mount } = this;
    if (!mount) return;
    this.pivot(_pivot);
    const firing = this.gunnerUp && !this.broken('turret');
    if (!firing || (!this.sees && this.sys.now - this.seenAt > 2)) {
      mount.idle(dt, _pivot);
    } else {
      _aim.copy(this.lastSeen);
      mount.update(dt, _pivot, _aim, this.sees);
    }
    this.placeRider();
  }

  private broken(id: string): boolean {
    for (const p of this.parts) if (p.def.id === id) return p.broken;
    return false;
  }

  private readonly exit = (seat: number, out: THREE.Vector3): THREE.Vector3 => {
    const { exits } = this.def;
    const e = exits[seat % exits.length]!;
    return out.set(e[0], e[1], e[2]).applyQuaternion(this.quaternion).add(this.position);
  };

  private disembark(dt: number): void {
    const { crew, drive, def } = this;
    if (crew.aboard <= 0 || !(this.settled || (drive.coasting && Math.abs(drive.speed) < 1))) return;
    // Out of the back of a truck and away from it, and off the sides of anything else.
    const seat = def.kind === 'truck' ? -1 : 0;
    if (seat) crew.dismount(dt, this.exit, this.y, -Math.sin(drive.yaw), -Math.cos(drive.yaw));
    else crew.dismount(dt, this.exit, this.y, Math.cos(drive.yaw) * (crew.aboard % 2 ? 1 : -1), -Math.sin(drive.yaw) * (crew.aboard % 2 ? 1 : -1));
  }

  private shuffle(dt: number): void {
    const { drive, def, order } = this;
    if (!def.cannon || order.holds || !drive.done || this.broken('trackLeft') || this.broken('trackRight')) return;
    if (this.stage === 'laying') return;
    this.shuffleIn -= dt;
    if (this.shuffleIn > 0) return;
    this.shuffleIn = rand(SHUFFLE_EVERY[0], SHUFFLE_EVERY[1]);
    this.shuffleWay = -this.shuffleWay;
    const reach = rand(SHUFFLE_METRES[0], SHUFFLE_METRES[1]) * this.shuffleWay;
    const p = this.shuffleTo[0]!;
    p.x = drive.x + Math.sin(drive.yaw) * reach;
    p.z = drive.z + Math.cos(drive.yaw) * reach;
    drive.reroute(this.shuffleTo, this.shuffleWay < 0);
  }

  /** The player and a moving box. Nothing else stops him walking through one, and it would be no fun if it did nothing. */
  private bump(dt: number): void {
    this.ramReady -= dt;
    const { def, drive, sys } = this;
    const { player, audio, camera, fx } = sys.ctx;
    if (!player.alive || player.parked) return;
    const p = player.position;
    if (p.y > this.y + def.roof || p.y + 1.8 < this.y) return;
    const dx = p.x - drive.x;
    const dz = p.z - drive.z;
    const s = Math.sin(drive.yaw);
    const c = Math.cos(drive.yaw);
    const across = dx * c - dz * s;
    const along = dx * s + dz * c;
    const reachX = def.halfWidth + PLAYER_RADIUS;
    const reachZ = def.halfLength + PLAYER_RADIUS;
    if (Math.abs(across) >= reachX || Math.abs(along) >= reachZ) return;
    const speed = Math.abs(drive.speed);
    if (speed > RAM_FROM && this.ramReady <= 0 && Math.sign(along) === Math.sign(drive.speed)) {
      this.ramReady = RAM_COOLDOWN;
      const share = speed / def.drive.top;
      player.takeDamage({ amount: def.ram.damage * share, from: this.position, type: 'crush', source: 'vehicle_ram' });
      const side = across >= 0 ? 1 : -1;
      _vel.set(s * Math.sign(drive.speed) + c * side * 0.8, 0.5, c * Math.sign(drive.speed) - s * side * 0.8).normalize().multiplyScalar(def.ram.throw * (0.5 + share * 0.5));
      player.launch(_vel);
      camera.addTrauma(0.5);
      audio.play('metal_clang', { position: p, pitch: 0.7 });
      fx.dust(p, _up, 2);
    }
    // Out by the shallower side, and never into the middle of it.
    if (reachX - Math.abs(across) < reachZ - Math.abs(along)) {
      const out = (reachX - Math.abs(across)) * (across >= 0 ? 1 : -1);
      p.x += c * out;
      p.z -= s * out;
    } else {
      const out = (reachZ - Math.abs(along)) * (along >= 0 ? 1 : -1);
      p.x += s * out;
      p.z += c * out;
    }
  }

  /** A bullet through the cab door. Only soft-skins get here. */
  shotDriver(amount: number, point: THREE.Vector3): void {
    if (this.driverHealth <= 0) return;
    this.driverHealth -= amount;
    if (this.driverHealth > 0) return;
    this.drive.coasting = true;
    this.sys.callout(point, 'DRIVER DOWN');
    this.sys.ctx.audio.play('vehicle_horn', { position: this.position });
  }

  /** A soft-skin past saving. It rolls to a stop on fire, the men get out if they are quick, and then the tank goes. */
  private burn(dt: number): void {
    this.fireLeft -= dt;
    if (this.fireLeft > 0) return;
    this.fireLeft = -1;
    this.destroy(this.source, this.position);
  }

  /** Called whenever health drops, to see if that was the moment it caught. */
  override take(amount: number, part: PartState | null, source: string, point: THREE.Vector3): void {
    super.take(amount, part, source, point);
    if (!this.alive || this.def.armoured || this.fireLeft >= 0) return;
    if (this.health > this.def.health * SOFT_FIRE_AT) return;
    this.fireLeft = SOFT_FIRE_SECONDS;
    this.drive.coasting = true;
    const { fx } = this.sys.ctx;
    this.smoke.push(fx.attachEmitter(this.model.root, 'burning', _p.set(0, 1.5, this.def.halfLength * 0.6), SOFT_FIRE_SECONDS + 1));
    this.sys.ctx.audio.play('vehicle_fuel_leak', { position: this.position });
  }

  protected broke(part: PartState, point: THREE.Vector3): void {
    const { sys, drive, model } = this;
    const { fx, audio } = sys.ctx;
    fx.sparks(point, _up, 30, 0xffd080);
    audio.play('metal_groan', { position: point, volume: 0.9 });
    switch (part.def.id) {
      case 'trackLeft':
      case 'trackRight': {
        const side = model.tracks[part.def.id === 'trackLeft' ? 0 : 1]!;
        side.belt.visible = side.links[0].visible = side.links[1].visible = false;
        fx.chips(point, 0x2a2d2f, 30);
        drive.halt();
        audio.play('track_snap', { position: point });
        sys.callout(point, 'TRACK OFF');
        break;
      }
      case 'engine':
        this.engineFire = true;
        drive.limit = ENGINE_FIRE_SPEED;
        this.smoke.push(fx.attachEmitter(model.root, 'burning', _p.set(0, 2.2, -3), 300));
        this.smoke.push(fx.attachEmitter(model.root, 'smokeTrail', _p.set(0, 2.4, -3.2), 300));
        sys.callout(point, 'ENGINE ON FIRE');
        break;
      case 'turret':
        this.turretJammed = true;
        sys.callout(point, 'TURRET JAMMED');
        break;
    }
  }

  protected destroy(source: string, point: THREE.Vector3): void {
    const { sys, def, model, order } = this;
    this.alive = false;
    this.retired = true;
    this.teardown(1.2);
    if (this.rider?.alive) {
      // He was stood over a fuel tank.
      this.rider.pinned = false;
      this.sys.killMan(this.rider, source, this.position);
    }
    const crewPoint = _p.copy(this.position);
    crewPoint.y = this.y + 1;
    if (def.kind === 'tank') this.tankCrew(source);
    else this.crew.spill(crewPoint, source);
    const wreck = new Wreck(sys, model.root, this.releaseColliders(), def.wreck, def.halfWidth, def.halfLength, this.tag);
    sys.ctx.fx.ring(this.position, _up, 0xffa040, def.wreck.blastRadius);
    if (def.kind === 'tank') this.popTurret(wreck);
    sys.fleet.scorch(model.root);
    model.body.rotation.set(0.04, 0, rand(-0.07, 0.07));
    wreck.keep = order.holds;
    sys.bury(this, wreck, source, point);
  }

  /** The turret is the part that leaves: sixty kilos of propellant under a lid. */
  private popTurret(wreck: Wreck): void {
    const { sys, model, def, drive } = this;
    const turret = model.turret!;
    const a = this.turretYaw + drive.yaw + rand(-0.8, 0.8);
    turret.getWorldPosition(_p);
    turret.getWorldQuaternion(_q);
    sys.ctx.render.scene.add(turret);
    turret.position.copy(_p);
    turret.quaternion.copy(_q);
    sys.fleet.scorch(turret);
    const part = this.parts.find(x => x.def.turns)!;
    const piece: Flung = {
      mesh: turret,
      velocity: new THREE.Vector3(Math.sin(a) * rand(2.5, 5), def.wreck.hop + rand(9, 13), Math.cos(a) * rand(2.5, 5)),
      spin: new THREE.Vector3(rand(-2.4, 2.4), rand(-1.6, 1.6), rand(-2.4, 2.4)),
      floor: this.y + 0.75,
      collider: part.collider,
      flying: true,
    };
    wreck.fling(piece);
    wreck.colliders.splice(wreck.colliders.indexOf(part.collider), 1);
  }

  private tankCrew(source: string): void {
    const { crew, order, def } = this;
    const on = _p.set(0, 3, 0).applyQuaternion(this.quaternion).add(this.position);
    if (order.crew.length > 0) {
      crew.spill(on, source);
      return;
    }
    const men = new Crew(this.sys, Math.random() < TANK_SURVIVOR ? [def.crew[0]!] : [], null);
    men.spill(on, source);
  }

  private teardown(fade: number): void {
    this.endLay();
    this.engine.stop(fade);
    this.turretLoop?.stop(0.1);
    this.turretLoop = null;
    for (const e of this.smoke) e.stop();
    this.smoke.length = 0;
    if (this.mount) {
      this.sys.guns.put(this.mount.gun);
    }
  }

  /** Becomes the wreck a beat opens on: the one that died before a restart, which the mission still has to climb over. */
  cold(): void {
    const { sys, def, model } = this;
    this.alive = false;
    this.retired = true;
    this.placeColliders();
    this.teardown(0);
    sys.fleet.scorch(model.root);
    const wreck = new Wreck(sys, model.root, this.releaseColliders(), def.wreck, def.halfWidth, def.halfLength, this.tag, true);
    wreck.keep = true;
    sys.keep(wreck);
  }

  /** A mission moved on, or a run ended. Nothing is scored. */
  remove(): void {
    const { sys, model } = this;
    this.alive = false;
    this.retired = true;
    this.teardown(0.3);
    this.crew.writeOff();
    if (this.rider?.alive) {
      sys.manager.withdraw(this.rider);
      this.rider = null;
    }
    for (const c of this.releaseColliders()) sys.ctx.physics.world.removeCollider(c, true);
    model.root.removeFromParent();
  }
}

/** Guns are built once and go round again, because a Gun is a scene object with two merged meshes in it. */
export class GunRack {
  private readonly free = new Map<string, Gun[]>();

  constructor(private readonly build: (spec: GunSpec) => Gun) {}

  get(spec: GunSpec): Gun {
    return this.free.get(spec.name)?.pop() ?? this.build(spec);
  }

  put(gun: Gun): void {
    gun.hide();
    const name = gun.root.name;
    const list = this.free.get(name);
    if (list) list.push(gun);
    else this.free.set(name, [gun]);
  }
}
