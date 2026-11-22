/**
 * Enemy Door Gunner (`EnemyDoorGunner`) for Rooftop Mode air support.
 *
 * Uses the Packmule `UTILITY_AIRFRAME` with a side-mounted `M134` rotary minigun and
 * tactical spotlight. Circles the rooftops in a left-hand orbit (so the open `+X` cabin
 * door continuously faces inward toward the player), suppressing the player with visible
 * tracer bursts. Fully shootable & destructible via `VehicleSystem`.
 */
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { EmitterHandle } from '../../core/contracts';
import { clamp, damp, rand, TAU, wrapAngle } from '../../core/math';
import { Airframe, EngineSound } from '../../progression/callins/airframe';
import { ModelMaterials } from '../../progression/modelkit';
import { Gun, M134 } from '../../vehicles/guns';
import type { Skyline } from '../../vehicles/skyline';
import { UTILITY_AIRFRAME, type UtilityMount } from '../../vehicles/utilityModel';
import { DOOR_GUNNER } from './data';
import type { VehicleSystem } from './index';
import { Mount } from './mount';
import { CHOPPER_ENGINE } from './sounds';
import { Vehicle, type PartState } from './vehicle';

const MAIN_ROTOR = 0;
const TAIL_ROTOR = 1;
const LOOK_EVERY = 0.18;
const REMEMBERS = 4.5;
const RING_SAMPLES = 8;
const BELLY = 1.4;
const MAX_SPIN = 7;
const SMOKE_EVERY = 0.09;
const BARREL_SPIN = 28;

const _pos = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _pivot = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _diff = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _p = new THREE.Vector3();

let sharedSpotGeo: THREE.ConeGeometry | null = null;
let sharedSpotMat: THREE.MeshBasicMaterial | null = null;

function ensureSpotlightAssets(): { geo: THREE.ConeGeometry; mat: THREE.MeshBasicMaterial } {
  if (!sharedSpotGeo) {
    sharedSpotGeo = new THREE.ConeGeometry(4.2, 26, 14, 1, true);
    sharedSpotGeo.translate(0, -13, 0);
  }
  if (!sharedSpotMat) {
    sharedSpotMat = new THREE.MeshBasicMaterial({
      color: '#ffe8b8',
      transparent: true,
      opacity: 0.08,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
  }
  return { geo: sharedSpotGeo, mat: sharedSpotMat };
}

export class EnemyDoorGunner extends Vehicle {
  private readonly frame: Airframe<UtilityMount>;
  private readonly gun: Gun;
  private readonly mount: Mount;
  private readonly engines: EngineSound;
  private readonly spotlight: THREE.Mesh;
  private readonly focus = new THREE.Vector3();
  private readonly lastSeen = new THREE.Vector3();
  private readonly vel = new THREE.Vector3();
  private readonly drift = new THREE.Vector3();
  private readonly fires: EmitterHandle[] = [];

  private crashing = false;
  private angle: number;
  private clock = 0;
  private lookIn = 0;
  private sees = false;
  private seenAt = -99;
  private yaw = 0;
  private pitch = 0;
  private roll = 0;
  private rotorRate = 1;
  private spin = 0;
  private fallSpeed = 0;
  private smokeIn = 0;

  constructor(
    sys: VehicleSystem,
    materials: ModelMaterials,
    private readonly skyline: Skyline,
    from: THREE.Vector3,
    focus: THREE.Vector3,
    tag: string | null,
  ) {
    super(sys, DOOR_GUNNER, tag);
    const { scene } = sys.ctx.render;
    this.frame = new Airframe(materials, scene, UTILITY_AIRFRAME);
    this.gun = new Gun(materials, scene, M134);
    this.mount = new Mount(sys.ctx, DOOR_GUNNER.gun, this.gun, 'enemy_door_gun', 'gunship_gun', 1.15);
    this.engines = new EngineSound(sys.ctx, CHOPPER_ENGINE);

    const spot = ensureSpotlightAssets();
    this.spotlight = new THREE.Mesh(spot.geo, spot.mat);
    this.spotlight.position.set(1.4, -0.3, 0.6);
    this.spotlight.rotation.set(0, 0, 0.55); // Aimed down and out the open +X side door toward orbit center.
    this.frame.root.add(this.spotlight);

    this.focus.copy(focus);
    this.position.copy(from);
    this.angle = Math.atan2(from.z - focus.z, from.x - focus.x);
    this.yaw = Math.atan2(focus.x - from.x, focus.z - from.z);
    this.engines.start(1.4);
    this.stepFrame(0);
    this.collectMeshes(this.frame.root);
  }

  override get center(): THREE.Vector3 {
    return this.frame.root.position;
  }

  private stepFrame(dt: number): void {
    const cp = Math.cos(this.pitch);
    _fwd.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp);
    this.frame.fly(this.position, _fwd, this.roll);
    this.frame.update(dt * this.rotorRate);
    this.quaternion.copy(this.frame.root.quaternion);
    this.placeColliders();
  }

  update(dt: number): void {
    if (!this.alive || this.retired) return;
    this.clock += dt;

    if (this.crashing) {
      this.fall(dt);
      if (!this.retired) {
        this.stepFrame(dt);
        this.engines.update(this.position, this.rotorRate, dt);
      }
      return;
    }

    this.flyOrbit(dt);
    this.stepFrame(dt);
    this.look(dt);
    this.fireDoorGun(dt);
    this.engines.update(this.position, 1, dt);
  }

  private flyOrbit(dt: number): void {
    const { orbit } = DOOR_GUNNER;
    const quarry = this.sys.quarry(this.position);
    const bounds = this.sys.ctx.world.bounds;
    const limitX = Math.max(12, Math.min(bounds.max.x, -bounds.min.x) - orbit.radius * 0.4);
    const limitZ = Math.max(12, Math.min(bounds.max.z, -bounds.min.z) - orbit.radius * 0.4);

    // Drift focus gently toward the player so the orbit stays over the active rooftop fight.
    if (quarry.alive && !quarry.parked) {
      this.focus.x = damp(this.focus.x, clamp(quarry.position.x, -limitX, limitX), 0.35, dt);
      this.focus.z = damp(this.focus.z, clamp(quarry.position.z, -limitZ, limitZ), 0.35, dt);
      this.focus.y = damp(this.focus.y, quarry.position.y, 0.5, dt);
    }

    // Left-hand circle (`orbit.rate < 0`) keeps the +X open door pointed directly at the rooftop center.
    this.angle += orbit.rate * dt;
    const targetX = this.focus.x + Math.cos(this.angle) * orbit.radius;
    const targetZ = this.focus.z + Math.sin(this.angle) * orbit.radius;

    let top = this.skyline.at(targetX, targetZ);
    for (let i = 0; i < RING_SAMPLES; i++) {
      const a = (i / RING_SAMPLES) * TAU;
      top = Math.max(top, this.skyline.at(this.focus.x + Math.cos(a) * orbit.radius, this.focus.z + Math.sin(a) * orbit.radius));
    }
    const targetY = Math.max(top + orbit.clearance, this.focus.y + orbit.altitude) + Math.sin(this.clock * 1.1) * 0.8;

    _diff.set(targetX - this.position.x, targetY - this.position.y, targetZ - this.position.z);
    const dist = _diff.length();
    const speed = dist > 16 ? orbit.approachSpeed : orbit.cruise;
    if (dist > 0.1) _diff.multiplyScalar(Math.min(speed, dist * 2.2) / dist);

    this.vel.x = damp(this.vel.x, _diff.x, 2.4, dt);
    this.vel.y = damp(this.vel.y, _diff.y, 2.0, dt);
    this.vel.z = damp(this.vel.z, _diff.z, 2.4, dt);
    this.position.addScaledVector(this.vel, dt);

    // Nose points along the left-hand tangent so +X door faces straight inward.
    const tangentX = -Math.sin(this.angle) * Math.sign(orbit.rate);
    const tangentZ = Math.cos(this.angle) * Math.sign(orbit.rate);
    const desiredYaw = dist > 20 ? Math.atan2(this.vel.x, this.vel.z) : Math.atan2(tangentX, tangentZ);
    this.yaw = wrapAngle(this.yaw + clamp(wrapAngle(desiredYaw - this.yaw), -2.0 * dt, 2.0 * dt));
    this.pitch = damp(this.pitch, -0.06, 3, dt);
    this.roll = damp(this.roll, -orbit.bank, 2.5, dt);
  }

  private look(dt: number): void {
    this.lookIn -= dt;
    if (this.lookIn > 0) return;
    this.lookIn = LOOK_EVERY;
    this.frame.mount('door', _pivot);
    const player = this.sys.quarry(_pivot);
    _aim.copy(player.position);
    _aim.y += 1.0;
    this.sees = player.alive && !player.parked && _pivot.distanceTo(_aim) < DOOR_GUNNER.gun.range * 1.25 && this.sys.lineClear(_pivot, _aim);
    if (!this.sees) return;
    this.lastSeen.copy(_aim);
    this.seenAt = this.sys.now;
  }

  private fireDoorGun(dt: number): void {
    this.frame.mount('door', _pivot);
    const fresh = this.sys.now - this.seenAt < REMEMBERS;
    if (!fresh) {
      this.mount.idle(dt, _pivot);
      return;
    }
    this.mount.update(dt, _pivot, this.lastSeen, this.sees);
    if (this.mount.firing) this.gun.turn(BARREL_SPIN * dt);
  }

  protected broke(part: PartState, point: THREE.Vector3): void {
    const { sys, frame } = this;
    const { fx } = sys.ctx;
    fx.sparks(point, _up, 40, 0xffd080);
    if (part.def.id === 'tail') {
      frame.setRotor(TAIL_ROTOR, false);
      fx.chips(point, 0x30373c, 40);
      sys.callout(point, 'TAIL ROTOR');
      this.goDown(this.source);
    } else if (part.def.id === 'rotor') {
      frame.setRotor(MAIN_ROTOR, false);
      fx.chips(point, 0x1e2328, 40);
      sys.callout(point, 'ROTOR');
      this.goDown(this.source);
    }
  }

  private goDown(source: string): void {
    if (this.crashing) return;
    this.crashing = true;
    this.source = source;
    this.drift.copy(this.vel);
    this.spotlight.visible = false;
    this.mount.idle(0, _pivot);
    const { audio, fx } = this.sys.ctx;
    _p.set(0, 1.4, -1.5);
    this.fires.push(fx.attachEmitter(this.frame.root, 'fireTrail', _p, 12));
    audio.play('gunship_stricken', { position: this.position });
  }

  override take(amount: number, part: PartState | null, source: string, point: THREE.Vector3): void {
    if (!this.alive || amount <= 0) return;
    if (this.crashing) {
      this.source = source;
      return;
    }
    if (this.health - amount <= 0) {
      this.health = 1;
      this.source = source;
      this.sys.airburst(this.position);
      this.sys.callout(point, 'DOOR GUNNER DOWN');
      this.goDown(source);
      return;
    }
    super.take(amount, part, source, point);
  }

  private fall(dt: number): void {
    const { sys } = this;
    this.fallSpeed += DOOR_GUNNER.fallAccel * dt;
    this.spin = Math.min(MAX_SPIN, this.spin + DOOR_GUNNER.spinRate * dt);
    this.yaw = wrapAngle(this.yaw + this.spin * dt);
    this.roll = damp(this.roll, 0.45, 1.5, dt);
    this.pitch = damp(this.pitch, -0.32, 1.4, dt);
    this.rotorRate = damp(this.rotorRate, 0.35, 0.8, dt);
    this.drift.x = damp(this.drift.x, 0, 0.5, dt);
    this.drift.z = damp(this.drift.z, 0, 0.5, dt);

    this.smokeIn -= dt;
    if (this.smokeIn <= 0) {
      this.smokeIn = SMOKE_EVERY;
      sys.ctx.fx.smoke(this.position, '#141210', rand(2.2, 3.4), rand(2, 3.4));
    }

    this.position.x += this.drift.x * dt;
    this.position.z += this.drift.z * dt;
    this.position.y -= this.fallSpeed * dt;

    const killY = sys.ctx.world.objects?.killY;
    const ground = sys.groundUnder(this.position);
    const hitRoof = killY == null ? this.position.y - BELLY <= ground : ground > killY && this.position.y - BELLY <= ground;
    const fellIntoChasm = killY != null && this.position.y <= killY - 2;
    if (!hitRoof && !fellIntoChasm) return;

    _pos.copy(this.position);
    if (hitRoof) _pos.y = ground + BELLY;
    this.destroy(this.source, _pos);
  }

  protected destroy(source: string, point: THREE.Vector3): void {
    const { sys } = this;
    this.alive = false;
    this.retired = true;
    this.teardownVisuals();

    const killY = sys.ctx.world.objects?.killY;
    const overVoid = killY != null && point.y <= killY;
    if (overVoid) {
      for (const c of this.releaseColliders()) sys.ctx.physics.world.removeCollider(c, true);
      sys.airburst(point);
      if (source.length > 0) {
        sys.ctx.progression.award(this.def.score, this.def.name, point);
        sys.ctx.hud.feed(`${this.def.name} DESTROYED`, '#ff7a30');
      }
      if (this.tag !== null) sys.ctx.campaign.unitGone(this.tag, true, source);
      sys.ctx.events.emit('vehicle:destroyed', { kind: this.def.kind, source, position: point });
      return;
    }

    this.position.copy(point);
    const wreck = sys.wreckUtility(this);
    sys.bury(this, wreck, source, point);
  }

  private teardownVisuals(): void {
    for (const e of this.fires) e.stop();
    this.fires.length = 0;
    this.engines.stop(0.35);
    this.spotlight.visible = false;
    this.frame.hide();
    this.frame.root.removeFromParent();
    this.gun.hide();
    this.gun.root.removeFromParent();
  }

  remove(): void {
    if (this.retired) return;
    this.alive = false;
    this.retired = true;
    this.teardownVisuals();
    for (const c of this.releaseColliders()) this.sys.ctx.physics.world.removeCollider(c, true);
  }

  wreckColliders(): RAPIER.Collider[] {
    const { sys } = this;
    this.placeColliders();
    const keep = this.releaseColliders();
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const part = this.parts[i]!;
      if (part.def.id !== 'rotor') continue;
      sys.ctx.physics.world.removeCollider(part.collider, true);
      keep.splice(keep.indexOf(part.collider), 1);
    }
    return keep;
  }
}
