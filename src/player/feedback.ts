/**
 * Everything the player hears and sees because of movement, except camera motion. All of it reads true velocity
 * from the simulation, never the keys, so running into a wall is silent and a rocket jump sounds fast.
 *
 * One-shots live here. AudioSystem runs the continuous beds itself from player state: speed wind, slide loop,
 * wall-run scrape and the slam fall whistle.
 */
import * as THREE from 'three';
import type { Ctx, DamageInfo } from '../core/contracts';
import type { EnemyInstance } from '../core/gameplay';
import { clamp, lerp, smoothstep } from '../core/math';
import type { Player } from './Player';
import { FEEDBACK, MOVE } from './tuning';

const FOOTSTEPS = ['player_footstep1', 'player_footstep2', 'player_footstep3'] as const;
const UP = new THREE.Vector3(0, 1, 0);

const MAX_SLAM_TARGETS = 48;

export class MovementFeedback {
  private lastStride = 0;
  private trailDistance = 0;
  private unsub: (() => void)[] = [];
  private readonly feet = new THREE.Vector3();
  private readonly along = new THREE.Vector3();
  private readonly wallNormal = new THREE.Vector3();
  private readonly slamHits: EnemyInstance[] = [];
  private readonly slamDamage: DamageInfo = {
    amount: 0, type: 'crush', point: new THREE.Vector3(), dir: new THREE.Vector3(), force: 0, source: 'slam',
  };

  constructor(private readonly ctx: Ctx, private readonly player: Player) {}

  init(): void {
    const { events, audio, render, fx } = this.ctx;
    const p = this.player;
    this.unsub.push(
      events.on('player:jumped', e => {
        if (e.bounce) audio.play('slam_bounce');
        else if (e.wall) audio.play('wall_kick');
        else if (e.double) audio.play('double_jump');
        else audio.play('player_jump', { volume: FEEDBACK.jumpVolume, pitchJitter: 0.05 });
      }),
      events.on('player:landed', e => {
        const k = clamp(e.impact / FEEDBACK.landLoudAt, 0.2, 1);
        audio.play(e.impact > FEEDBACK.hardLanding ? 'land_hard' : 'player_land', {
          volume: FEEDBACK.landVolume * k, pitch: 1.08 - 0.25 * k, pitchJitter: 0.05,
        });
        if (e.impact > FEEDBACK.landDust) fx.dust(p.position, UP, 0.5 + k);
      }),
      events.on('player:dashed', e => {
        audio.play('dash');
        render.post.radialBlur(0.3, 0.16);
        fx.dashStreaks(p.eye, e.dir);
      }),
      events.on('player:slide', e => {
        if (e.active) {
          audio.play('slide_start');
          audio.play('slide_ground', { volume: clamp(p.velocity.length() / 30, 0.4, 1), pitch: 1.05 });
        } else if (p.grounded) {
          audio.play('slide_stop');
        }
      }),
      events.on('player:wallrun', e => { if (e.active) audio.play('wallrun_start'); }),
      events.on('player:mantle', () => audio.play('mantle')),
      events.on('player:slamstart', () => audio.play('slam_start')),
      events.on('player:slam', e => {
        const k = clamp(e.impact / FEEDBACK.slamFullAt, 0.3, 1);
        audio.play('slam_impact', { volume: 0.6 + 0.4 * k });
        render.post.radialBlur(0.45 * k, 0.25);
        render.post.chromatic(0.5 * k, 0.2);
        fx.slam(e.position, k);
        this.ctx.physics.radialImpulse(e.position, e.radius, 30 * k);
        this.slamEnemies(e.position, e.radius, k);
      }),
      events.on('player:damaged', e => {
        audio.play(e.amount >= 35 ? 'player_hurt_heavy' : 'player_hurt', { unaffectedByTime: true });
        audio.play('enemy_hit', { volume: 0.5, unaffectedByTime: true });
        if (e.from) {
          const dx = e.from.x - p.position.x;
          const dz = e.from.z - p.position.z;
          // Clockwise from straight ahead, relative to where the player looks.
          render.post.damageDirection(Math.atan2(dx, -dz) + p.yaw, clamp(e.amount / 40, 0.3, 1));
        }
      }),
      events.on('player:died', () => audio.play('player_death', { unaffectedByTime: true })),
    );
  }

  update(dt: number): void {
    const { render } = this.ctx;
    const p = this.player;

    const foot = Math.floor(p.stridePhase);
    if (foot !== this.lastStride) {
      this.lastStride = foot;
      if (p.grounded || p.wallRunning) this.footstep();
    }

    render.post.setSpeed(smoothstep(FEEDBACK.speedLinesFrom, FEEDBACK.speedLinesFull, p.velocity.length()));
    render.post.setLowHealth(p.alive ? 1 - clamp(p.health / 35) : 1);
    if (p.sliding || p.wallRunning) this.trail(dt);
    else this.trailDistance = 0;
  }

  /** Dust under a slide and sparks along a wall, spaced by distance so they stay even at any speed. */
  private trail(dt: number): void {
    const { fx } = this.ctx;
    const p = this.player;
    const speed = p.speed;
    this.trailDistance += speed * dt;
    const every = p.sliding ? FEEDBACK.slideDustEvery : FEEDBACK.wallSparksEvery;
    if (this.trailDistance < every) return;
    this.trailDistance = 0;
    if (p.sliding) {
      fx.dust(p.position, UP, clamp(speed / 30, 0.4, 1));
      return;
    }
    const inv = speed > 0.1 ? 1 / speed : 0;
    this.along.set(p.velocity.x * inv, 0, p.velocity.z * inv);
    this.wallNormal.copy(p.wallNormal);
    this.feet.copy(p.position).addScaledVector(this.wallNormal, -0.45);
    this.feet.y += 0.3;
    fx.wallSparks(this.feet, this.wallNormal, this.along);
  }

  private slamEnemies(center: THREE.Vector3, radius: number, strength: number): void {
    // Sandboxes run without an enemy system, and stubs answer with something that is not a count.
    const { enemies } = this.ctx;
    const count = enemies?.query(center, radius, this.slamHits);
    if (typeof count !== 'number') return;
    const d = this.slamDamage;
    const peak = lerp(FEEDBACK.slamDamageMin, FEEDBACK.slamDamageMax, strength);
    for (let i = 0; i < Math.min(count, MAX_SLAM_TARGETS); i++) {
      const enemy = this.slamHits[i]!;
      const distance = enemy.position.distanceTo(center);
      d.amount = peak * lerp(1, FEEDBACK.slamEdge, clamp(distance / radius));
      d.point.copy(enemy.center);
      d.dir.copy(enemy.position).sub(center).setY(0.4).normalize();
      d.force = FEEDBACK.slamForce * strength;
      enemies.applyDamage(enemy, d);
    }
  }

  private footstep(): void {
    const { audio } = this.ctx;
    const p = this.player;
    const k = clamp(p.speed / MOVE.runSpeed, 0.3, 1.2);
    const options = {
      volume: FEEDBACK.footstepVolume * k * (p.crouched ? 0.5 : 1),
      pitch: FEEDBACK.footstepPitch + FEEDBACK.footstepPitchFromSpeed * k + (p.wallRunning ? 0.15 : 0),
      pitchJitter: 0.08,
    };
    // The first game's trio is the concrete step. Other surfaces get their synthesized set.
    if (p.groundSurface === 'concrete' || p.wallRunning) audio.playOneOf(FOOTSTEPS, options);
    else audio.play(`footstep_${p.groundSurface}`, options);
  }

  reset(): void {
    this.lastStride = Math.floor(this.player.stridePhase);
  }
}
