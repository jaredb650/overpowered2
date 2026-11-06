/**
 * Airstrike: the first game's rhythm, on the game clock. Radio, three seconds of nothing but a ring, a second cue,
 * then 15 rockets a tenth of a second apart, a beat of silence, and the largest single blast in the first game.
 */
import * as THREE from 'three';
import { rand, TAU } from '../../core/math';
import { AIRSTRIKE as A, CALLINS } from '../data';
import { GroundRing } from './ground';
import type { Strike, StrikeKit, StrikeOrder } from './shared';

const _from = new THREE.Vector3();
const _vel = new THREE.Vector3();

export class Airstrike implements Strike {
  private t = 0;
  private fired = 0;
  private activated = false;
  private finaleLaunched = false;
  private landed = false;
  private readonly point = new THREE.Vector3();
  private readonly ring: GroundRing;
  /** Cover over the target. Under a roof, rockets start below it instead of bursting on top. */
  private readonly ceiling: number;

  constructor(private readonly kit: StrikeKit, order: StrikeOrder) {
    this.point.copy(order.point);
    this.ring = new GroundRing(kit.ctx);
    this.ring.setColor(CALLINS.airstrike.color, 2.2);
    this.ceiling = kit.probe.headroom(this.point.x, this.point.y + 0.5, this.point.z, A.finaleHeight + 2) - 1.5;
    kit.ctx.audio.play('walkietalkie_fire');
  }

  update(dt: number): boolean {
    this.t += dt;
    const { audio } = this.kit.ctx;
    if (!this.activated && this.t >= A.activateAt) {
      this.activated = true;
      audio.play('airstrike_activate');
    }
    while (this.fired < A.rockets && this.t >= A.rocketsAt + this.fired * A.rocketGap) this.rocket();
    if (!this.finaleLaunched && this.t >= A.finaleAt) this.launchFinale();

    if (this.t < A.markerUntil) {
      // The original pulse, on the true finale radius with the rocket scatter inside it.
      this.ring.show(this.point, A.finaleRadius, A.scatter);
      this.ring.setOpacity(0.55 + Math.sin(this.t * 5) * 0.4);
      this.ring.tick(this.t);
    } else {
      this.ring.hide();
    }
    return this.landed;
  }

  private rocket(): void {
    this.fired++;
    // Radius straight from random() biases to the centre, which is the shape the first game had.
    const r = Math.random() * A.scatter;
    const a = rand(0, TAU);
    const height = Math.min(rand(A.rocketHeight[0], A.rocketHeight[1]), this.ceiling);
    _from.set(this.point.x + Math.cos(a) * r, this.point.y + height, this.point.z + Math.sin(a) * r);
    _vel.set(rand(-A.rocketDrift, A.rocketDrift), -1, rand(-A.rocketDrift, A.rocketDrift)).normalize().multiplyScalar(A.rocketSpeed);
    this.kit.ctx.combat.spawnProjectile({
      origin: _from, velocity: _vel, kind: 'rocket', team: 'player', damage: A.rocketDamage, source: 'airstrike',
      gravity: 0, lifetime: 5,
      explosion: { radius: A.rocketRadius, damage: A.rocketDamage, kind: 'rocket', selfDamage: A.rocketSelfDamage },
    });
  }

  private launchFinale(): void {
    this.finaleLaunched = true;
    const height = Math.min(A.finaleHeight, this.ceiling);
    _from.copy(this.point).setY(this.point.y + height);
    _vel.set(0, -A.finaleSpeed, 0);
    this.kit.ctx.audio.play('missile_incoming', { position: this.point });
    this.kit.ordnance.launch('finale', _from, _vel, p => this.impact(p));
  }

  private impact(p: THREE.Vector3): void {
    const { camera, combat, fx, render, time } = this.kit.ctx;
    combat.explode(p, {
      radius: A.finaleRadius, damage: 99999, kind: 'hellfire', source: 'airstrike', team: 'player',
      instakill: true, selfDamage: 0, playerPush: A.finalePlayerPush,
    });
    fx.ring(p, _vel.set(0, 1, 0), '#ffaa00', A.finaleRadius * 2);
    render.post.flash('#ffb060', 1.1, 0.45);
    render.post.chromatic(1, 0.5);
    render.post.radialBlur(0.5, 0.45);
    camera.fovPunch(10, 0.4);
    camera.addTrauma(0.85);
    time.hitStop(0.09);
    render.lights.flash(p, '#ffa040', 90, 60, 0.5);
    render.decals.add('scorch', p, _vel, A.finaleRadius * 0.9, rand(0, TAU));
    this.landed = true;
  }

  dispose(): void {
    this.ring.dispose();
  }
}
