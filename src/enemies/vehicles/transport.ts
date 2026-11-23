/**
 * Fast-rope SWAT transport helicopter (`FastRopeHeli`) for Rooftop Mode.
 *
 * Uses the Packmule `UTILITY_AIRFRAME` with spinning rotors, a downward tactical floodlight,
 * and dual rappelling ropes. Flies in from off-map to a rooftop `HoverDropZone`, hovers,
 * fast-ropes its 3–5 man SWAT squad down onto the deck, retracts ropes, and departs.
 *
 * Shoot-down payoff: fully shootable and destructible via `VehicleSystem`. Shooting it down
 * (or breaking its tail/rotor) during approach, hover, or fast-roping sends it crashing in
 * flames and immediately kills all remaining onboard AND currently rappelling SWAT troops
 * with kill credit and bonus score.
 */
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { EmitterHandle } from '../../core/contracts';
import type { EnemyId } from '../../core/gameplay';
import { clamp, damp, rand, wrapAngle } from '../../core/math';
import { Airframe, EngineSound } from '../../progression/callins/airframe';
import { ModelMaterials } from '../../progression/modelkit';
import { UTILITY_AIRFRAME, type UtilityMount } from '../../vehicles/utilityModel';
import type { Enemy } from '../Enemy';
import type { OutpostSquad } from '../outpost/squad';
import { TRANSPORT } from './data';
import type { VehicleSystem } from './index';
import { CHOPPER_ENGINE } from './sounds';
import { Vehicle, type PartState } from './vehicle';

export type TransportPhase = 'approach' | 'deploy' | 'egress' | 'crashing';

interface Rappeller {
  enemy: Enemy;
  ropeIndex: 0 | 1;
  target: THREE.Vector3;
}

const MAIN_ROTOR = 0;
const TAIL_ROTOR = 1;
const BELLY = 1.4;
const MAX_SPIN = 7;
const SMOKE_EVERY = 0.09;
const ROPE_EXTEND_RATE = 2.4;
const EGRESS_DIST = 145;
const HOVER_ARRIVE = 1.5;
const WIPED_FEED_COLOR = '#ff8c38';
const ONBOARD_KILL_SCORE = 125;

const _pos = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _door = new THREE.Vector3();
const _top = new THREE.Vector3();
const _bot = new THREE.Vector3();
const _diff = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _p = new THREE.Vector3();

let sharedRopeGeo: THREE.CylinderGeometry | null = null;
let sharedRopeMat: THREE.MeshStandardMaterial | null = null;
let sharedBeamGeo: THREE.ConeGeometry | null = null;
let sharedBeamMat: THREE.MeshBasicMaterial | null = null;

function ensureRopeAssets(): {
  ropeGeo: THREE.CylinderGeometry;
  ropeMat: THREE.MeshStandardMaterial;
  beamGeo: THREE.ConeGeometry;
  beamMat: THREE.MeshBasicMaterial;
} {
  if (!sharedRopeGeo) {
    sharedRopeGeo = new THREE.CylinderGeometry(0.035, 0.035, 1, 6, 1, true);
    sharedRopeGeo.translate(0, 0.5, 0);
  }
  if (!sharedRopeMat) {
    sharedRopeMat = new THREE.MeshStandardMaterial({ color: '#1b1a16', roughness: 0.95 });
  }
  if (!sharedBeamGeo) {
    sharedBeamGeo = new THREE.ConeGeometry(3.2, 14, 14, 1, true);
    sharedBeamGeo.translate(0, -7, 0);
  }
  if (!sharedBeamMat) {
    sharedBeamMat = new THREE.MeshBasicMaterial({
      color: '#cfe8ff',
      transparent: true,
      opacity: 0.09,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
  }
  return { ropeGeo: sharedRopeGeo, ropeMat: sharedRopeMat, beamGeo: sharedBeamGeo, beamMat: sharedBeamMat };
}

export class FastRopeHeli extends Vehicle {
  private readonly frame: Airframe<UtilityMount>;
  private readonly engines: EngineSound;
  private readonly ropes: [THREE.Mesh, THREE.Mesh];
  private readonly floodlight: THREE.Mesh;
  private readonly lz: THREE.Vector3;
  private readonly hoverPos: THREE.Vector3;
  private readonly egressTarget: THREE.Vector3;
  private readonly vel = new THREE.Vector3();
  private readonly drift = new THREE.Vector3();
  private readonly onboard: EnemyId[];
  private readonly rappelling: Rappeller[] = [];
  private readonly fires: EmitterHandle[] = [];

  private squad: OutpostSquad | null = null;
  private _phase: TransportPhase = 'approach';
  private yaw = 0;
  private pitch = 0;
  private roll = 0;
  private clock = 0;
  private ropeExtend = 0;
  private dropIn = 0.45;
  private nextRope: 0 | 1 = 0;
  private rotorRate = 1;
  private spin = 0;
  private fallSpeed = 0;
  private smokeIn = 0;
  private payloadWiped = false;

  /** Counts of onboard + rappelling troops killed when this transport was shot down. */
  wipedOnboard = 0;
  wipedRappelling = 0;

  constructor(
    sys: VehicleSystem,
    materials: ModelMaterials,
    from: THREE.Vector3,
    lz: THREE.Vector3,
    hoverY: number,
    squadIds: readonly EnemyId[],
    tag: string | null,
  ) {
    super(sys, TRANSPORT, tag);
    const { scene } = sys.ctx.render;
    this.frame = new Airframe(materials, scene, UTILITY_AIRFRAME);
    this.engines = new EngineSound(sys.ctx, CHOPPER_ENGINE);
    this.lz = lz.clone();
    this.hoverPos = new THREE.Vector3(lz.x, hoverY, lz.z);
    this.onboard = [...squadIds];

    // Pick an egress corridor away from the LZ along the opposite horizontal direction.
    _diff.subVectors(this.hoverPos, from).setY(0);
    if (_diff.lengthSq() < 1) _diff.set(1, 0, 0);
    _diff.normalize();
    this.egressTarget = new THREE.Vector3(
      this.hoverPos.x + _diff.x * EGRESS_DIST,
      hoverY + 26,
      this.hoverPos.z + _diff.z * EGRESS_DIST,
    );

    const assets = ensureRopeAssets();
    this.ropes = [
      new THREE.Mesh(assets.ropeGeo, assets.ropeMat),
      new THREE.Mesh(assets.ropeGeo, assets.ropeMat),
    ];
    for (const r of this.ropes) {
      r.visible = false;
      scene.add(r);
    }

    this.floodlight = new THREE.Mesh(assets.beamGeo, assets.beamMat);
    this.floodlight.position.set(0.3, -0.85, 2.4);
    this.floodlight.visible = true;
    this.frame.root.add(this.floodlight);

    this.position.copy(from);
    this.yaw = Math.atan2(_diff.x, _diff.z);
    this.engines.start(1.2);
    this.stepFrame(0);
    this.collectMeshes(this.frame.root);
  }

  get phase(): TransportPhase {
    return this._phase;
  }

  get onboardCount(): number {
    return this.onboard.length;
  }

  get rappellingCount(): number {
    return this.rappelling.length;
  }

  /** True while troops are still onboard or descending ropes (used by RooftopWaves to gate wave clear). */
  get hasActivePayload(): boolean {
    return this.onboard.length > 0 || this.rappelling.length > 0;
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

    if (this._phase === 'crashing') {
      this.fall(dt);
      if (!this.retired) {
        this.stepFrame(dt);
        this.engines.update(this.position, this.rotorRate, dt);
      }
      return;
    }

    if (this._phase === 'approach') this.updateApproach(dt);
    else if (this._phase === 'deploy') this.updateDeploy(dt);
    else if (this._phase === 'egress') this.updateEgress(dt);

    if (this.retired) return;
    this.stepFrame(dt);
    this.updateRopesAndRappellers(dt);
    this.engines.update(this.position, 1, dt);
  }

  private updateApproach(dt: number): void {
    _diff.subVectors(this.hoverPos, this.position);
    const dist = _diff.length();
    if (dist <= HOVER_ARRIVE) {
      this._phase = 'deploy';
      this.vel.multiplyScalar(0.3);
      this.dropIn = 0.55;
      const o = this.sys.manager.outpost;
      if (o && this.onboard.length > 0) {
        this.squad = o.muster(this.onboard.length, this.lz);
      }
      return;
    }

    const desiredSpeed = Math.min(TRANSPORT.approachSpeed, Math.max(4.5, dist * 1.4));
    _diff.multiplyScalar(desiredSpeed / dist);
    this.vel.x = damp(this.vel.x, _diff.x, 3.2, dt);
    this.vel.y = damp(this.vel.y, _diff.y, 3.2, dt);
    this.vel.z = damp(this.vel.z, _diff.z, 3.2, dt);
    this.position.addScaledVector(this.vel, dt);

    const flatSpeed = Math.hypot(this.vel.x, this.vel.z);
    if (flatSpeed > 1) {
      const targetYaw = Math.atan2(this.vel.x, this.vel.z);
      this.yaw = wrapAngle(this.yaw + clamp(wrapAngle(targetYaw - this.yaw), -2.2 * dt, 2.2 * dt));
    }
    this.pitch = damp(this.pitch, clamp(-flatSpeed * 0.012, -0.26, 0.14), 4, dt);
    this.roll = damp(this.roll, 0, 4, dt);
  }

  private updateDeploy(dt: number): void {
    // Gentle hover bob directly above LZ.
    const bobY = this.hoverPos.y + Math.sin(this.clock * 1.6) * 0.35;
    this.position.x = damp(this.position.x, this.hoverPos.x, 4, dt);
    this.position.y = damp(this.position.y, bobY, 4, dt);
    this.position.z = damp(this.position.z, this.hoverPos.z, 4, dt);
    this.vel.set(0, 0, 0);
    this.pitch = damp(this.pitch, 0, 4, dt);
    this.roll = damp(this.roll, Math.sin(this.clock * 1.1) * 0.04, 4, dt);

    // Extend ropes first, then fast-rope SWAT troopers one by one.
    this.ropeExtend = Math.min(1, this.ropeExtend + ROPE_EXTEND_RATE * dt);
    if (this.ropeExtend >= 0.85 && this.onboard.length > 0) {
      this.dropIn -= dt;
      if (this.dropIn <= 0) {
        this.dropIn = TRANSPORT.dropInterval;
        this.launchRappeller();
      }
    }

    if (this.onboard.length === 0 && this.rappelling.length === 0) {
      this._phase = 'egress';
      this.floodlight.visible = false;
    }
  }

  private launchRappeller(): void {
    const id = this.onboard.shift();
    if (!id) return;
    const { manager } = this.sys;
    const o = manager.outpost;
    manager.queued = Math.max(0, manager.queued - 1);

    const ropeIndex = this.nextRope;
    this.nextRope = ropeIndex === 0 ? 1 : 0;
    this.ropeAnchor(ropeIndex, _top);

    const target = this.lz.clone();
    const angle = rand(0, Math.PI * 2);
    const spread = rand(0.6, 2.2);
    target.x += Math.cos(angle) * spread;
    target.z += Math.sin(angle) * spread;
    this.sys.ctx.world.nav.nearest(target, 5, target);

    const spawnAt = _top.clone();
    spawnAt.y -= 1.2;
    const enemy = o && this.squad ? o.enlistInto(this.squad, id, spawnAt) : manager.spawn(id, spawnAt);
    if (!enemy) return;

    enemy.position.copy(spawnAt);
    enemy.groundY = target.y;
    enemy.pinned = true;
    enemy.airborne = false;
    enemy.mode = 'hold';
    enemy.face = 'player';
    enemy.velocity.set(0, 0, 0);
    this.rappelling.push({ enemy, ropeIndex, target });
  }

  private updateEgress(dt: number): void {
    this.ropeExtend = Math.max(0, this.ropeExtend - ROPE_EXTEND_RATE * 1.5 * dt);
    _diff.subVectors(this.egressTarget, this.position);
    const dist = _diff.length();
    if (dist < 6 || this.position.distanceTo(this.hoverPos) > EGRESS_DIST) {
      this.remove();
      return;
    }
    _diff.multiplyScalar(TRANSPORT.egressSpeed / dist);
    this.vel.x = damp(this.vel.x, _diff.x, 1.8, dt);
    this.vel.y = damp(this.vel.y, _diff.y, 1.8, dt);
    this.vel.z = damp(this.vel.z, _diff.z, 1.8, dt);
    this.position.addScaledVector(this.vel, dt);

    const targetYaw = Math.atan2(this.vel.x, this.vel.z);
    this.yaw = wrapAngle(this.yaw + clamp(wrapAngle(targetYaw - this.yaw), -2.0 * dt, 2.0 * dt));
    this.pitch = damp(this.pitch, -0.22, 3, dt);
    this.roll = damp(this.roll, 0, 3, dt);
  }

  private ropeAnchor(index: 0 | 1, out: THREE.Vector3): THREE.Vector3 {
    this.frame.mount('door', _door);
    const offset = index === 0 ? 0.55 : -0.55;
    out.set(0, 0, offset).applyQuaternion(this.quaternion).add(_door);
    return out;
  }

  private updateRopesAndRappellers(dt: number): void {
    const showRopes = this.ropeExtend > 0.02 && this._phase !== 'crashing';
    for (let i = 0; i < 2; i++) {
      const rope = this.ropes[i]!;
      if (!showRopes) {
        rope.visible = false;
        continue;
      }
      this.ropeAnchor(i as 0 | 1, _top);
      _bot.set(_top.x, this.lz.y, _top.z);
      _diff.subVectors(_top, _bot);
      const fullLen = Math.max(0.5, _diff.length());
      const len = fullLen * this.ropeExtend;
      _bot.copy(_top).addScaledVector(_up, -len);
      rope.visible = true;
      rope.position.copy(_bot);
      rope.quaternion.identity();
      rope.scale.set(1, len, 1);
    }

    for (let i = this.rappelling.length - 1; i >= 0; i--) {
      const r = this.rappelling[i]!;
      const e = r.enemy;
      if (!e.alive) {
        e.pinned = false;
        this.rappelling.splice(i, 1);
        continue;
      }
      this.ropeAnchor(r.ropeIndex, _top);
      e.position.y -= TRANSPORT.rappelSpeed * dt;
      // Gently guide onto the rooftop nav point as they reach the deck.
      const totalDrop = Math.max(1, _top.y - r.target.y);
      const frac = clamp(1 - (e.position.y - r.target.y) / totalDrop, 0, 1);
      e.position.x = _top.x + (r.target.x - _top.x) * frac * frac;
      e.position.z = _top.z + (r.target.z - _top.z) * frac * frac;

      if (e.position.y <= r.target.y) {
        e.position.copy(r.target);
        e.groundY = r.target.y;
        e.groundSampleAt.set(r.target.x, r.target.z);
        e.pinned = false;
        e.airborne = false;
        e.verticalSpeed = 0;
        e.char.anim.play('land', 1.2);
        this.rappelling.splice(i, 1);
      }
    }
  }

  /** Kills all remaining onboard AND currently rappelling SWAT troops immediately on shoot-down. */
  private wipePayload(source: string): void {
    if (this.payloadWiped) return;
    this.payloadWiped = true;

    const { sys } = this;
    const { hud, progression } = sys.ctx;
    const cause = source || 'transport_crash';

    const onboardKilled = this.onboard.length;
    if (onboardKilled > 0) {
      sys.manager.queued = Math.max(0, sys.manager.queued - onboardKilled);
      this.onboard.length = 0;
      this.wipedOnboard += onboardKilled;
    }

    let rappellingKilled = 0;
    for (const r of this.rappelling) {
      const e = r.enemy;
      e.pinned = false;
      if (e.alive) {
        sys.killMan(e, cause, this.position);
        rappellingKilled++;
      }
    }
    this.rappelling.length = 0;
    this.wipedRappelling += rappellingKilled;

    const totalWiped = onboardKilled + rappellingKilled;
    if (totalWiped > 0 && source.length > 0) {
      const bonus = onboardKilled * ONBOARD_KILL_SCORE + TRANSPORT.squadWipeBonus;
      progression.award(bonus, 'SQUAD WIPED', this.position);
      hud.feed(`SWAT TRANSPORT DOWN — ${totalWiped} KIA`, WIPED_FEED_COLOR);
      sys.callout(this.position, 'SQUAD WIPED');
    }
  }

  protected broke(part: PartState, point: THREE.Vector3): void {
    const { sys, frame } = this;
    const { fx } = sys.ctx;
    fx.sparks(point, _up, 35, 0xffd080);
    if (part.def.id === 'tail') {
      frame.setRotor(TAIL_ROTOR, false);
      fx.chips(point, 0x30373c, 35);
      sys.callout(point, 'TAIL ROTOR');
      this.goDown(this.source);
    } else if (part.def.id === 'rotor') {
      frame.setRotor(MAIN_ROTOR, false);
      fx.chips(point, 0x1e2328, 35);
      sys.callout(point, 'ROTOR');
      this.goDown(this.source);
    }
  }

  private goDown(source: string): void {
    if (this._phase === 'crashing') return;
    this._phase = 'crashing';
    this.source = source;
    this.drift.copy(this.vel);
    this.floodlight.visible = false;
    for (const r of this.ropes) r.visible = false;
    this.wipePayload(source);

    const { audio, fx } = this.sys.ctx;
    _p.set(0, 1.4, -1.5);
    this.fires.push(fx.attachEmitter(this.frame.root, 'fireTrail', _p, 12));
    audio.play('gunship_stricken', { position: this.position });
  }

  override take(amount: number, part: PartState | null, source: string, point: THREE.Vector3): void {
    if (!this.alive || amount <= 0) return;
    if (this._phase === 'crashing') {
      this.source = source;
      if (amount >= 200) this.destroyMidAir(source, point);
      return;
    }
    if (this.health - amount <= 0) {
      const overkill = amount - this.health;
      if (overkill >= this.def.health * 0.4 || amount >= 340) {
        this.destroyMidAir(source, point);
        return;
      }
      this.health = 1;
      this.source = source;
      this.sys.airburst(this.position);
      this.goDown(source);
      return;
    }
    super.take(amount, part, source, point);
  }

  private destroyMidAir(source: string, point: THREE.Vector3): void {
    this.alive = false;
    this.retired = true;
    this.wipePayload(source);
    this.teardownVisuals();
    this.sys.airburst(this.position);
    this.sys.callout(point, 'MID-AIR DETONATION');
    const wreck = this.sys.wreckUtility(this);
    this.sys.shatterAirborne(wreck, this.position, this.vel);
    this.sys.bury(this, wreck, source, point);
  }

  private fall(dt: number): void {
    const { sys } = this;
    this.fallSpeed += TRANSPORT.fallAccel * dt;
    this.spin = Math.min(MAX_SPIN, this.spin + TRANSPORT.spinRate * dt);
    this.yaw = wrapAngle(this.yaw + this.spin * dt);
    this.roll = damp(this.roll, 0.42, 1.6, dt);
    this.pitch = damp(this.pitch, -0.35, 1.5, dt);
    this.rotorRate = damp(this.rotorRate, 0.35, 0.9, dt);
    this.drift.x = damp(this.drift.x, 0, 0.6, dt);
    this.drift.z = damp(this.drift.z, 0, 0.6, dt);

    this.smokeIn -= dt;
    if (this.smokeIn <= 0) {
      this.smokeIn = SMOKE_EVERY;
      sys.ctx.fx.smoke(this.position, '#141210', rand(2.2, 3.2), rand(2, 3.2));
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
    this.wipePayload(source);
    this.alive = false;
    this.retired = true;
    this.teardownVisuals();

    const killY = sys.ctx.world.objects?.killY;
    const overVoid = killY != null && point.y <= killY;
    if (overVoid) {
      // Fell into the street chasm between skyscrapers: explode cleanly without stranding a roof wreck in the void.
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
    this.floodlight.visible = false;
    this.frame.hide();
    this.frame.root.removeFromParent();
    for (const r of this.ropes) {
      r.visible = false;
      r.removeFromParent();
    }
  }

  remove(): void {
    if (this.retired) return;
    if (this.onboard.length > 0) {
      this.sys.manager.queued = Math.max(0, this.sys.manager.queued - this.onboard.length);
      this.onboard.length = 0;
    }
    for (const r of this.rappelling) r.enemy.pinned = false;
    this.rappelling.length = 0;
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
