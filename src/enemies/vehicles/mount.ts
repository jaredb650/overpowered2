/**
 * A gun on a mount with a man behind it. Shared by the roof guns and the gunship's chin: it swings at the rate the mount allows, watches
 * for a moment so the barrel coming round is the warning, then fires in bursts that open wide and settle.
 *
 * Rounds are hitscan through combat like every other enemy gun, so they spark off walls and whiz past the player.
 */
import * as THREE from 'three';
import type { Ctx, PlayOptions } from '../../core/contracts';
import type { ShotSpec } from '../../core/gameplay';
import { clamp, rand, randomInCone, wrapAngle } from '../../core/math';
import type { Gun } from '../../vehicles/guns';
import type { MountDef } from './data';

/** Radians off the mark at which it counts as on. */
const ON_TARGET = 0.09;
const TRACER_EVERY = 3;

const _to = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _bore = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _play: PlayOptions = { position: _muzzle, pitch: 1, pitchJitter: 0.03 };

export class Mount {
  /** World yaw and pitch, as `Gun.point` takes them: barrels along -Z. */
  yaw = 0;
  pitch = 0;
  /** The gun is on the mark and has been watching long enough. */
  firing = false;

  private burst = 0;
  private restLeft = 0;
  private watched = 0;
  private roundIn = 0;
  private rounds = 0;
  private settled = 0;
  private readonly shot: ShotSpec;

  constructor(private readonly ctx: Ctx, private readonly def: MountDef, readonly gun: Gun, source: string, private readonly sound: string, private readonly pitchShift: number) {
    this.shot = { damage: def.damage, source, team: 'enemy', maxDistance: def.range * 1.3, tracerFrom: _muzzle };
  }

  /** Points it at once, for a vehicle that has just arrived. */
  snap(yaw: number, pitch: number): void {
    this.yaw = yaw;
    this.pitch = pitch;
    this.gun.snap(yaw, pitch);
  }

  /** A swing toward `aim`, however it was reached. `free` says it may fire. Returns radians still to go. */
  update(dt: number, pivot: THREE.Vector3, aim: THREE.Vector3, free: boolean): number {
    const { def } = this;
    _to.subVectors(aim, pivot);
    const flat = Math.hypot(_to.x, _to.z);
    const yawError = wrapAngle(Math.atan2(-_to.x, -_to.z) - this.yaw);
    const pitchError = Math.atan2(_to.y, flat) - this.pitch;
    const step = def.slew * dt;
    this.yaw = wrapAngle(this.yaw + clamp(yawError, -step, step));
    this.pitch += clamp(pitchError, -step, step);
    this.gun.point(pivot, this.yaw, this.pitch, dt);
    const off = Math.abs(yawError) + Math.abs(pitchError);
    const onMark = free && off < ON_TARGET;
    this.watched = onMark ? this.watched + dt : Math.max(0, this.watched - dt * 2);
    this.firing = this.watched >= def.acquire;
    if (this.firing) this.fight(dt, aim);
    else this.burst = 0;
    return off;
  }

  /** Nobody on it, or nothing to shoot: it hangs where it was left. */
  idle(dt: number, pivot: THREE.Vector3): void {
    this.firing = false;
    this.burst = 0;
    this.watched = 0;
    this.gun.point(pivot, this.yaw, this.pitch, dt);
  }

  private fight(dt: number, aim: THREE.Vector3): void {
    const { def } = this;
    if (this.restLeft > 0) {
      this.restLeft -= dt;
      return;
    }
    if (this.burst <= 0) {
      this.burst = Math.round(rand(def.burst[0], def.burst[1]));
      this.settled = 0;
    }
    this.roundIn -= dt;
    // A slow frame pays what it owes up to a limit, and the rate never bursts to catch up.
    for (let i = 0; this.roundIn <= 0 && i < 3 && this.burst > 0; i++) {
      this.roundIn += 1 / def.rate;
      this.round(aim);
      if (--this.burst <= 0) this.restLeft = rand(def.rest[0], def.rest[1]);
    }
    if (this.roundIn < 0) this.roundIn = 0;
  }

  private round(aim: THREE.Vector3): void {
    const { ctx, def, gun, shot } = this;
    gun.muzzle(_muzzle);
    gun.bore(_bore);
    _to.subVectors(aim, _muzzle).normalize();
    const settling = clamp(this.settled / def.settle);
    this.settled++;
    randomInCone(_to, def.spreadOpen + (def.spreadSettled - def.spreadOpen) * settling, _dir);
    this.rounds++;
    shot.tracer = this.rounds % TRACER_EVERY === 0 ? 'enemy' : undefined;
    ctx.combat.fireRay(_muzzle, _dir, shot);
    ctx.combat.enemyMuzzle(_muzzle, _bore, 'enemy');
    gun.recoil(0.05);
    _play.pitch = this.pitchShift;
    ctx.audio.play(this.sound, _play);
  }
}
