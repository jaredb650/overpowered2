/**
 * The enemy attack helicopter. It flies the same way the player's Harrow does, on the same Autopilot: press the attack, swing wide along
 * its route, come in again. Its gun walks onto the target from short of it, so the first thing the player sees is the ground erupting
 * in a line, and that is the moment to move.
 *
 * Section 17's locational damage is what the fight is about. Shoot the tail and it spins. Shoot the rotor and it drops. A perfect round
 * into the cockpit ends it at once. Anything else is a matter of doing enough. All three come down as a falling thing that is still
 * burning, and what lands stays as cover.
 *
 * If the player has his own aircraft up, this one goes for it, because that is the fight the two came for. It drops under it, where a
 * gunner's seat cannot look, and the player's pilot brings him round to where it can.
 */
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { EmitterHandle } from '../../core/contracts';
import type { ProjectileSpec } from '../../core/gameplay';
import { chance, clamp, damp, rand, randomInCone, wrapAngle } from '../../core/math';
import { Airframe, EngineSound } from '../../progression/callins/airframe';
import type { Gun } from '../../vehicles/guns';
import { Autopilot, type PilotPlan } from '../../vehicles/pilot';
import type { Skyline } from '../../vehicles/skyline';
import { Crew } from './crew';
import { CHOPPER } from './data';
import type { VehicleSystem } from './index';
import { MAIN_ROTOR, TAIL_ROTOR, type ChopperMount } from './models';
import { Mount } from './mount';
import { CHOPPER_ENGINE } from './sounds';
import { Vehicle, type PartState } from './vehicle';

type Fate = 'flying' | 'spinning' | 'dropping' | 'diving';

/** The rig the gunship flies in. One is built, and goes round again. */
export interface GunshipRig {
  frame: Airframe<ChopperMount>;
  tail: THREE.Group;
  gun: Gun;
}

/** Metres under the map's clear air it may drop, to fight a friendly under its gun. */
const FLOOR_LEAST = 13;
const FLOOR_AHEAD = 2;
/** Seconds a target has to stay in view to count as seen. */
const LOOK_EVERY = 0.2;
const REMEMBERS = 5;
const ROTOR_RUNDOWN = 0.6;
/** Chance one burst at a friendly aircraft lands. */
const FRIENDLY_HIT = 0.55;
const FRIENDLY_BURST_EVERY = 1.3;
/** Height over the ground it hits at. */
const BELLY = 1.3;
const MAX_SPIN = 7;
/** Rockets leave a pod this much ahead of the aim, so a salvo arrives as a walk and not one spot. */
const SALVO_WALK = 3.5;
/** Seconds between the puffs of the smoke it falls in. */
const SMOKE_EVERY = 0.09;
/** Chance anyone walks away. */
const SURVIVOR = 0.3;

const _pos = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _pivot = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _p = new THREE.Vector3();
const _side = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

const ROCKET: ProjectileSpec = {
  origin: _pos, velocity: _vel, kind: 'rocket', team: 'enemy', damage: CHOPPER.rockets.damage, source: 'gunship_rocket',
  explosion: { radius: CHOPPER.rockets.radius, damage: CHOPPER.rockets.damage, kind: 'enemy' }, trail: 'smoke', lifetime: 4,
};

export class EnemyChopper extends Vehicle {
  private readonly pilot: Autopilot;
  private readonly plan: PilotPlan;
  private readonly engines: EngineSound;
  private readonly mount: Mount;
  private readonly marks: readonly THREE.Vector3[];
  private readonly focus = new THREE.Vector3();
  private readonly lastSeen = new THREE.Vector3();
  private fate: Fate = 'flying';
  private leg = 0;
  private pressing = false;
  private phaseLeft: number;
  private walk: number = CHOPPER.walkFrom;
  private rocketsIn: number;
  private salvo = 0;
  private salvoIn = 0;
  private leftPod = false;
  private lookIn = 0;
  private sees = false;
  private seenAt = -99;
  private friendlyIn = 0;
  private spin = 0;
  private fallSpeed = 0;
  private yaw = 0;
  private dropRoll = 0;
  private rotorRate = 1;
  private smokeIn = 0;
  private readonly drift = new THREE.Vector3();
  private readonly fires: EmitterHandle[] = [];

  constructor(sys: VehicleSystem, private readonly rig: GunshipRig, private readonly skyline: Skyline, from: THREE.Vector3, marks: readonly THREE.Vector3[], tag: string | null) {
    super(sys, CHOPPER, tag);
    const bounds = sys.ctx.world.bounds;
    const edge = Math.min(bounds.max.x, -bounds.min.x, bounds.max.z, -bounds.min.z);
    this.plan = { ...CHOPPER.pilot, limit: Math.min(CHOPPER.pilot.limit, Math.max(edge - 6, 12)) };
    this.pilot = new Autopilot(this.plan);
    this.marks = marks;
    this.phaseLeft = rand(CHOPPER.breakOff[0], CHOPPER.breakOff[1]);
    this.rocketsIn = rand(CHOPPER.rockets.every[0], CHOPPER.rockets.every[1]);
    this.mount = new Mount(sys.ctx, CHOPPER.gun, rig.gun, 'gunship_gun', 'gunship_gun', 1);
    this.engines = new EngineSound(sys.ctx, CHOPPER_ENGINE);
    rig.tail.visible = true;
    rig.frame.setRotor(MAIN_ROTOR, true);
    rig.frame.setRotor(TAIL_ROTOR, true);
    this.focus.copy(marks[0] ?? sys.ctx.player.position);
    _dir.subVectors(this.focus, from).setY(0);
    if (_dir.lengthSq() < 1) _dir.set(0, 0, 1);
    this.pilot.begin(from, _dir.normalize());
    this.engines.start(1.6);
    this.stepFrame(0);
    this.collectMeshes(rig.frame.root);
  }

  override get center(): THREE.Vector3 {
    return this.rig.frame.root.position;
  }

  private stepFrame(dt: number): void {
    const { rig, pilot } = this;
    if (this.fate === 'flying') {
      rig.frame.fly(pilot.position, pilot.forward, pilot.roll);
      this.yaw = Math.atan2(pilot.forward.x, pilot.forward.z);
    }
    rig.frame.update(dt * this.rotorRate);
    this.position.copy(rig.frame.root.position);
    this.quaternion.copy(rig.frame.root.quaternion);
    this.placeColliders();
  }

  update(dt: number): void {
    const { sys } = this;
    if (!this.alive) return;
    if (this.fate !== 'flying') {
      this.fall(dt);
      if (!this.retired) this.stepFrame(dt);
      this.engines.update(this.position, this.rotorRate, dt);
      return;
    }
    this.look(dt);
    this.plot(dt);
    const friendly = sys.friendly;
    this.plan.altitude = friendly ? Math.max(FLOOR_LEAST, friendly.position.y - CHOPPER.underFriendly) : CHOPPER.pilot.altitude;
    this.pilot.update(dt, this.focus, this.skyline.along(this.pilot.position, this.pilot.velocity, FLOOR_AHEAD));
    this.stepFrame(dt);
    this.rig.frame.mount('chin', _pivot);
    if (friendly) this.dogfight(dt, friendly.position);
    else this.attack(dt);
    this.engines.update(this.position, 1, dt);
  }

  private look(dt: number): void {
    this.lookIn -= dt;
    if (this.lookIn > 0) return;
    this.lookIn = LOOK_EVERY;
    const { player } = this.sys.ctx;
    this.rig.frame.mount('chin', _pivot);
    _aim.copy(player.position);
    _aim.y += 1;
    this.sees = player.alive && !player.parked && _pivot.distanceTo(_aim) < CHOPPER.gun.range * 1.4 && this.sys.lineClear(_pivot, _aim);
    if (!this.sees) return;
    this.lastSeen.copy(_aim);
    this.seenAt = this.sys.now;
  }

  /** Press, break, press. A break leads to the next mark on its route, so it comes in again from somewhere else. */
  private plot(dt: number): void {
    const { sys } = this;
    this.phaseLeft -= dt;
    if (this.phaseLeft <= 0) {
      this.pressing = !this.pressing;
      const range = this.pressing ? CHOPPER.press : CHOPPER.breakOff;
      this.phaseLeft = rand(range[0], range[1]);
      if (this.pressing) this.walk = CHOPPER.walkFrom;
      else if (this.marks.length > 0) this.leg = (this.leg + 1) % this.marks.length;
    }
    const friendly = sys.friendly;
    if (friendly) this.focus.copy(friendly.position);
    else if (this.pressing) this.focus.copy(sys.ctx.player.position);
    else if (this.marks.length > 0) this.focus.copy(this.marks[this.leg]!);
  }

  private attack(dt: number): void {
    const { mount } = this;
    const fresh = this.sys.now - this.seenAt < REMEMBERS;
    if (!this.pressing || !fresh) {
      mount.idle(dt, _pivot);
      return;
    }
    // The stream starts short and walks on, across the line from the gun, at a pace a running man can beat.
    this.walk = Math.max(0, this.walk - CHOPPER.walkRate * dt);
    _side.subVectors(_pivot, this.lastSeen).setY(0).normalize();
    _aim.copy(this.lastSeen).addScaledVector(_side, this.walk);
    mount.update(dt, _pivot, _aim, this.sees);
    this.pods(dt);
  }

  private pods(dt: number): void {
    const { rockets } = CHOPPER;
    if (this.salvo > 0) {
      this.salvoIn -= dt;
      if (this.salvoIn <= 0) this.rocket();
      return;
    }
    this.rocketsIn -= dt;
    if (this.rocketsIn > 0 || !this.sees || _pivot.distanceTo(this.lastSeen) > rockets.range) return;
    this.rocketsIn = rand(rockets.every[0], rockets.every[1]);
    this.salvo = rockets.salvo;
    this.salvoIn = 0;
  }

  private rocket(): void {
    const { rockets } = CHOPPER;
    const { audio, combat, fx } = this.sys.ctx;
    this.leftPod = !this.leftPod;
    this.salvo--;
    this.salvoIn = rockets.gap;
    this.rig.frame.mount(this.leftPod ? 'podLeft' : 'podRight', _pos);
    _side.subVectors(this.lastSeen, _pos).setY(0).normalize();
    _aim.copy(this.lastSeen).addScaledVector(_side, (this.salvo - rockets.salvo / 2) * SALVO_WALK);
    _aim.sub(_pos).normalize();
    randomInCone(_aim, rockets.spread, _dir);
    _vel.copy(_dir).multiplyScalar(rockets.speed);
    combat.spawnProjectile(ROCKET);
    fx.muzzleFlash(_pos, _dir, 'rocket');
    audio.play('enemy_rocket_fire', { position: _pos });
  }

  /** Its gun on the player's aircraft. A burst that lands costs him time in the air. */
  private dogfight(dt: number, target: THREE.Vector3): void {
    const { sys } = this;
    this.mount.update(dt, _pivot, target, false);
    this.friendlyIn -= dt;
    if (this.friendlyIn > 0 || _pivot.distanceTo(target) > CHOPPER.gun.range * 1.6) return;
    this.friendlyIn = FRIENDLY_BURST_EVERY;
    const { audio, fx } = sys.ctx;
    this.mount.gun.muzzle(_p);
    audio.play('gunship_gun', { position: _p });
    fx.tracer(_p, target, 'enemy');
    if (chance(FRIENDLY_HIT)) sys.friendly?.hit(CHOPPER.seatHit);
  }

  protected broke(part: PartState, point: THREE.Vector3): void {
    const { sys, rig } = this;
    const { fx } = sys.ctx;
    fx.sparks(point, _up, 40, 0xffd080);
    if (part.def.id === 'tail') {
      this.goDown('spinning');
      rig.tail.visible = false;
      rig.frame.setRotor(TAIL_ROTOR, false);
      fx.chips(point, 0x4b5140, 40);
      sys.callout(point, 'TAIL ROTOR');
    } else if (part.def.id === 'rotor') {
      this.goDown('dropping');
      rig.frame.setRotor(MAIN_ROTOR, false);
      fx.chips(point, 0x17191b, 40);
      sys.callout(point, 'ROTOR');
    }
  }

  private goDown(fate: Fate): void {
    if (this.fate !== 'flying') return;
    const { sys, rig, pilot } = this;
    const { audio, fx } = sys.ctx;
    this.fate = fate;
    this.drift.copy(pilot.velocity);
    this.mount.idle(0, _pivot);
    this.rotorRate = fate === 'spinning' ? 1 : ROTOR_RUNDOWN;
    _p.set(0, 1.6, -2);
    this.fires.push(fx.attachEmitter(rig.frame.root, 'fireTrail', _p, 12));
    audio.play('gunship_stricken', { position: this.position });
  }

  /** Falling with no way to stop. It ends on the ground or on whatever is in the way. */
  private fall(dt: number): void {
    const { rig, sys } = this;
    const { root } = rig.frame;
    const rate = this.fate === 'spinning' ? CHOPPER.spinFall : this.fate === 'dropping' ? CHOPPER.dropFall : CHOPPER.diveFall;
    this.fallSpeed += rate * dt;
    if (this.fate === 'spinning') this.spin = Math.min(MAX_SPIN, this.spin + CHOPPER.spinRate * dt);
    this.yaw = wrapAngle(this.yaw + this.spin * dt);
    this.dropRoll = damp(this.dropRoll, this.fate === 'dropping' ? 0.5 : 0.28, 1.2, dt);
    this.rotorRate = damp(this.rotorRate, this.fate === 'spinning' ? 0.7 : 0.2, 0.8, dt);
    this.drift.x = damp(this.drift.x, 0, 0.5, dt);
    this.drift.z = damp(this.drift.z, 0, 0.5, dt);
    this.smokeIn -= dt;
    if (this.smokeIn <= 0) {
      this.smokeIn = SMOKE_EVERY;
      sys.ctx.fx.smoke(root.position, '#141210', rand(2.2, 3.4), rand(2, 3.4));
    }
    _pos.copy(root.position);
    _pos.x += this.drift.x * dt;
    _pos.z += this.drift.z * dt;
    _pos.y -= this.fallSpeed * dt;
    // Nose down in a dive, and held near level in a drop, so each reads as what it is.
    const nose = this.fate === 'diving' ? clamp(this.fallSpeed * 0.03, 0, 0.7) : 0.12;
    _fwd.set(Math.sin(this.yaw) * Math.cos(nose), -Math.sin(nose), Math.cos(this.yaw) * Math.cos(nose));
    rig.frame.fly(_pos, _fwd, this.dropRoll);
    const ground = sys.groundUnder(_pos);
    if (_pos.y - BELLY > ground) return;
    _pos.y = ground + BELLY;
    this.destroy(this.source, _pos);
  }

  /** Called with the books already open by `take`: an aircraft out of health in the air has further to go. */
  override take(amount: number, part: PartState | null, source: string, point: THREE.Vector3): void {
    if (!this.alive || amount <= 0) return;
    if (this.fate !== 'flying') {
      this.source = source;
      return;
    }
    if (this.health - amount <= 0) {
      this.health = 1;
      this.source = source;
      this.sys.airburst(this.position);
      this.sys.callout(point, 'DIRECT HIT');
      this.goDown('diving');
      return;
    }
    super.take(amount, part, source, point);
  }

  protected destroy(source: string, point: THREE.Vector3): void {
    const { sys, rig } = this;
    this.alive = false;
    this.retired = true;
    this.teardown();
    const wreck = sys.wreckGunship(this, rig.tail.visible);
    // One of them gets out of what is left, sometimes.
    new Crew(sys, chance(SURVIVOR) ? CHOPPER.crew : [], null).spill(this.position, source);
    sys.bury(this, wreck, source, point);
  }

  private teardown(): void {
    const { rig, sys } = this;
    for (const e of this.fires) e.stop();
    this.fires.length = 0;
    this.engines.stop(0.4);
    rig.frame.hide();
    rig.gun.hide();
    sys.chopperGone();
  }

  remove(): void {
    const { sys } = this;
    if (this.retired) return;
    this.alive = false;
    this.retired = true;
    this.teardown();
    for (const c of this.releaseColliders()) sys.ctx.physics.world.removeCollider(c, true);
  }

  /** The colliders it lies on: everything but what was shot off, and never the rotor. */
  wreckColliders(): RAPIER.Collider[] {
    const { sys } = this;
    this.placeColliders();
    const keep = this.releaseColliders();
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const part = this.parts[i]!;
      if (part.def.id !== 'rotor' && !(part.def.id === 'tail' && part.broken)) continue;
      sys.ctx.physics.world.removeCollider(part.collider, true);
      keep.splice(keep.indexOf(part.collider), 1);
    }
    return keep;
  }
}
