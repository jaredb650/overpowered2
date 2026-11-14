/**
 * A friendly aircraft shot down: it trails fire and smoke, spins or noses over, falls, and hits the ground with a blast
 * and a wreck that burns for a while. The blast is the player's team with selfDamage 0 and playerPush 0, and goes
 * through combat as a `worldObject` (see ac130.ts) so it cannot set off a barrel either: it hurts enemies, never the
 * player (section 4 of `docs/proposals/air-support.md`).
 */
import * as THREE from 'three';
import type { Ctx, EmitterHandle } from '../../core/contracts';
import type { ExplosionSpec } from '../../core/gameplay';
import { clamp, rand, TAU } from '../../core/math';

export interface CrashPlan {
  /** m/s² it falls with. */
  gravity: number;
  /** Radians a second of yaw it spins up to, and how fast it gets there. */
  spin: number;
  spinUp: number;
  /** Radians a second the nose goes over, up to `pitch`. */
  pitchRate: number;
  pitch: number;
  /** Metres from the root down to the belly, where it meets the ground. */
  belly: number;
  radius: number;
  damage: number;
  /** Seconds the wreck burns before it is gone. */
  wreck: number;
  /** Size of the fireball and the shake. */
  scale: number;
}

const UP = new THREE.Vector3(0, 1, 0);
const SMOKE_EVERY = 0.1;
/** Seconds to fall before it is called down wherever it is: nothing should hang in the sky over a hole in the map. */
const LONGEST_FALL = 14;

const _at = new THREE.Vector3();
const _fire = new THREE.Vector3(0, 0.6, -1);

export class Crash {
  readonly velocity = new THREE.Vector3();
  landed = false;
  private spin = 0;
  private pitched = 0;
  private age = 0;
  private burnt = 0;
  private smokeIn = 0;
  private fire: EmitterHandle | null;
  private readonly blast: ExplosionSpec;

  constructor(
    private readonly ctx: Ctx,
    private readonly root: THREE.Object3D,
    velocity: THREE.Vector3,
    private readonly ground: (x: number, z: number) => number,
    private readonly plan: CrashPlan,
    source: string,
  ) {
    this.velocity.copy(velocity);
    this.spin = plan.spin * 0.2 * Math.sign(rand(-1, 1) || 1);
    this.fire = ctx.fx.attachEmitter(root, 'fireTrail', _fire);
    this.blast = { kind: 'rocket', source, radius: plan.radius, damage: plan.damage, team: 'player', selfDamage: 0, playerPush: 0, worldObject: true };
    ctx.fx.explosion(root.position, { radius: 4 * plan.scale, kind: 'rocket', scale: plan.scale });
    ctx.audio.play('gunship_stricken', { position: root.position });
  }

  /** True once the wreck has burnt out. */
  update(dt: number): boolean {
    if (this.landed) return this.burn(dt);
    const { plan, root, velocity } = this;
    this.age += dt;
    velocity.y -= plan.gravity * dt;
    velocity.x *= Math.exp(-0.25 * dt);
    velocity.z *= Math.exp(-0.25 * dt);
    root.position.addScaledVector(velocity, dt);
    const target = plan.spin * Math.sign(this.spin);
    this.spin += clamp(target - this.spin, -plan.spinUp * dt, plan.spinUp * dt);
    root.rotateOnWorldAxis(UP, this.spin * dt);
    const over = Math.min(plan.pitchRate * dt, plan.pitch - this.pitched);
    if (over > 0) {
      this.pitched += over;
      root.rotateX(over);
    }
    this.smoke(dt, 2.6);
    const floor = this.ground(root.position.x, root.position.z) + plan.belly;
    if (root.position.y <= floor || this.age >= LONGEST_FALL) {
      root.position.y = Math.min(root.position.y, floor);
      this.land();
    }
    return false;
  }

  private smoke(dt: number, size: number): void {
    this.smokeIn -= dt;
    if (this.smokeIn > 0) return;
    this.smokeIn = SMOKE_EVERY;
    this.ctx.fx.smoke(this.root.position, '#141210', size * this.plan.scale * rand(0.8, 1.2), rand(2.4, 4));
  }

  private land(): void {
    const { audio, camera, combat, fx, player, render } = this.ctx;
    const { plan, root } = this;
    this.landed = true;
    _at.copy(root.position).setY(root.position.y + 0.7);
    combat.explode(_at, this.blast);
    fx.explosion(root.position, { radius: plan.radius, kind: 'finisher', scale: plan.scale });
    fx.ring(root.position, UP, '#ffa040', plan.radius * 1.8);
    fx.chips(root.position, '#ffb050', 40, true);
    fx.smoke(root.position, 0x23262a, plan.radius * 0.8, 12);
    render.lights.flash(root.position, '#ffa050', 90, plan.radius * 4, 0.7);
    render.decals.add('scorch', _at.copy(root.position).setY(root.position.y - plan.belly), UP, plan.radius * 0.8, rand(0, TAU));
    audio.layer([{ id: 'vehicle_explode' }, { id: 'wreck_land' }], { position: root.position });
    const near = clamp(1 - player.position.distanceTo(root.position) / (plan.radius * 8));
    camera.addTrauma(0.25 + 0.5 * near);
    // Down on its belly, tipped where it fell.
    root.rotateZ(rand(-0.4, 0.4));
  }

  private burn(dt: number): boolean {
    this.burnt += dt;
    this.smoke(dt, 1.6);
    if (this.burnt < this.plan.wreck) return false;
    this.dispose();
    return true;
  }

  dispose(): void {
    this.fire?.stop();
    this.fire = null;
  }
}
