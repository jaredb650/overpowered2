/**
 * What is left. A wreck is the model, scorched, on the colliders the vehicle had: it stays as cover for whoever gets to it first, and
 * burns long enough to be a hazard. It leaves the ground in the blast and comes down heavily, and it cooks off for a while after,
 * because a real fire in a magazine does not stop at one bang.
 */
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { EmitterHandle, LoopHandle } from '../../core/contracts';
import { rand } from '../../core/math';
import type { WreckDef } from './data';
import type { VehicleSystem } from './index';

const GRAVITY = 19;
/** Damage a second to a player standing in the flames, and how long a tick lasts. */
const FIRE_DPS = 16;
const FIRE_TICK = 0.25;
const FIRE_RISE = 3.2;
/** Share of the spin it keeps through a landing. Heavy things do not bounce much. */
const BOUNCE = 0.22;
const SMOKE_EVERY = 0.45;
const SMOKE_HEIGHT = 11;
/** The column stands this many times as long as the fire. */
const SMOKE_OUTLASTS = 2;

const _up = new THREE.Vector3(0, 1, 0);
const _p = new THREE.Vector3();

/** A part thrown clear: a turret, a tail. It lands, and stays as a piece of cover of its own. */
export interface Flung {
  mesh: THREE.Object3D;
  velocity: THREE.Vector3;
  spin: THREE.Vector3;
  floor: number;
  collider: RAPIER.Collider | null;
  flying: boolean;
}

export class Wreck {
  readonly root: THREE.Object3D;
  burnLeft: number;
  /** Never cleared to make room: the mission needs it where it fell. */
  keep = false;

  private readonly emitters: EmitterHandle[] = [];
  private flames: LoopHandle | null = null;
  private cookOff: number;
  private clock = 0;
  private fireTick = 0;
  private smokeIn = 0;
  private velocityY: number;
  private readonly tumble = new THREE.Vector3();
  private readonly rest: THREE.Euler;
  private readonly restY: number;
  private readonly flung: Flung[] = [];

  constructor(
    private readonly sys: VehicleSystem, root: THREE.Object3D, readonly colliders: RAPIER.Collider[], private readonly def: WreckDef,
    readonly halfWidth: number, readonly halfLength: number, readonly tag: string | null,
    /** Dead before the beat began: no blast, no flames. */
    private readonly cold = false,
  ) {
    this.root = root;
    this.burnLeft = cold ? 0 : def.burnSeconds;
    this.cookOff = cold ? def.cookOffs.length : 0;
    this.velocityY = cold ? 0 : def.hop;
    this.restY = root.position.y;
    this.rest = root.rotation.clone();
    this.tumble.set(rand(-1, 1), rand(-0.3, 0.3), rand(-1, 1)).multiplyScalar(def.hop * 0.09);
    if (cold) return;
    const { fx, audio } = sys.ctx;
    _p.set(0, 1.4, 0);
    this.emitters.push(fx.attachEmitter(root, 'burning', _p, def.burnSeconds));
    this.emitters.push(fx.attachEmitter(root, 'burning', _p.set(0, 1.2, halfLength * 0.5), def.burnSeconds), fx.attachEmitter(root, 'burning', _p.set(0, 1.2, -halfLength * 0.5), def.burnSeconds));
    this.flames = audio.startLoop('flame_burn_loop', { position: root.position, volume: 0.8 });
  }

  /** Throws a piece clear. It carries its own collider once it has come to rest. */
  fling(piece: Flung): void {
    this.flung.push(piece);
  }

  /** The part of the update that only a wreck in the air needs. */
  private fall(dt: number): void {
    const { root } = this;
    if (this.velocityY === 0 && root.position.y === this.restY) return;
    this.velocityY -= GRAVITY * dt;
    root.position.y += this.velocityY * dt;
    root.rotation.x += this.tumble.x * dt;
    root.rotation.y += this.tumble.y * dt;
    root.rotation.z += this.tumble.z * dt;
    if (root.position.y > this.restY) return;
    root.position.y = this.restY;
    const hard = -this.velocityY;
    if (hard > 2.2) {
      // One small bounce, and a slump into the rest pose it will keep.
      this.velocityY = hard * BOUNCE;
      this.tumble.multiplyScalar(-BOUNCE);
      this.thud(root.position, hard);
      return;
    }
    this.velocityY = 0;
    root.rotation.copy(this.rest);
  }

  private thud(at: THREE.Vector3, hard: number): void {
    const { audio, fx } = this.sys.ctx;
    _p.copy(at);
    fx.dust(_p, _up, 3 + hard * 0.5);
    audio.play('wreck_land', { position: _p, volume: Math.min(1, hard / 7) });
  }

  private flight(dt: number): void {
    for (const f of this.flung) {
      if (!f.flying) continue;
      f.velocity.y -= GRAVITY * dt;
      f.mesh.position.addScaledVector(f.velocity, dt);
      f.mesh.rotation.x += f.spin.x * dt;
      f.mesh.rotation.y += f.spin.y * dt;
      f.mesh.rotation.z += f.spin.z * dt;
      if (f.mesh.position.y > f.floor) continue;
      f.mesh.position.y = f.floor;
      f.flying = false;
      f.mesh.rotation.x *= 0.12;
      f.mesh.rotation.z *= 0.12;
      this.thud(f.mesh.position, 9);
      if (f.collider) {
        f.collider.setTranslation(f.mesh.position);
        f.collider.setRotation(f.mesh.quaternion);
      }
    }
  }

  private cook(): void {
    const { def } = this;
    if (this.cookOff >= def.cookOffs.length || this.clock < def.cookOffs[this.cookOff]!) return;
    this.cookOff++;
    this.sys.detonate(this.root.position, def.blastRadius * 0.6, def.blastDamage * 0.35, 0.8, 'vehicle_cookoff');
  }

  private hazard(dt: number): void {
    const { player } = this.sys.ctx;
    this.fireTick -= dt;
    if (this.fireTick > 0 || !player.alive || player.parked) return;
    this.fireTick = FIRE_TICK;
    const { root, def } = this;
    if (player.position.y > root.position.y + FIRE_RISE) return;
    const dx = player.position.x - root.position.x;
    const dz = player.position.z - root.position.z;
    const s = Math.sin(root.rotation.y);
    const c = Math.cos(root.rotation.y);
    if (Math.abs(dx * c - dz * s) > this.halfWidth + def.burnReach || Math.abs(dx * s + dz * c) > this.halfLength + def.burnReach) return;
    player.takeDamage({ amount: FIRE_DPS * FIRE_TICK, from: root.position, type: 'fire', source: 'wreck_fire' });
  }

  /** The column it sends up: black while it burns, thinning for as long again. The one thing that shows where the fight has been. */
  private smoke(dt: number): void {
    this.smokeIn -= dt;
    if (this.smokeIn > 0 || this.clock > this.def.burnSeconds * SMOKE_OUTLASTS) return;
    this.smokeIn = SMOKE_EVERY;
    const hot = this.burnLeft > 0;
    const rise = rand(2, SMOKE_HEIGHT);
    _p.copy(this.root.position);
    _p.x += rand(-1, 1);
    _p.z += rand(-1, 1);
    _p.y += rise;
    // Thin at the wreck, where the player has to see past it, and wide up where it only has to be seen.
    this.sys.ctx.fx.smoke(_p, hot ? '#36322d' : '#4a4743', 1.2 + rise * 0.3, rand(3, 4.5));
  }

  update(dt: number): void {
    this.clock += dt;
    this.fall(dt);
    if (this.flung.length > 0) this.flight(dt);
    this.cook();
    if (!this.cold) this.smoke(dt);
    if (this.burnLeft <= 0) return;
    this.burnLeft -= dt;
    if (this.burnLeft <= 0) {
      this.flames?.stop(2);
      this.flames = null;
      return;
    }
    this.hazard(dt);
  }

  dispose(): void {
    const { physics } = this.sys.ctx;
    for (const e of this.emitters) e.stop();
    this.flames?.stop(0.3);
    this.flames = null;
    for (const c of this.colliders) physics.world.removeCollider(c, true);
    for (const f of this.flung) {
      if (f.collider) physics.world.removeCollider(f.collider, true);
      f.mesh.removeFromParent();
    }
    this.root.removeFromParent();
  }
}
