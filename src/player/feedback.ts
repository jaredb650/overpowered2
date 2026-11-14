/**
 * Everything the player hears and sees because of movement, except camera motion. All of it reads true velocity
 * from the simulation, never the keys, so running into a wall is silent and a rocket jump sounds fast.
 *
 * One-shots live here. AudioSystem runs the continuous beds itself from player state: speed wind, slide loop,
 * wall-run scrape and the slam fall whistle.
 */
import * as THREE from 'three';
import type { Ctx, DamageInfo, PlayOptions } from '../core/contracts';
import type { EnemyInstance } from '../core/gameplay';
import { clamp, lerp, smoothstep } from '../core/math';
import { ANIM } from './moveAnim';
import type { Player } from './Player';
import { FEEDBACK, MOVE } from './tuning';

const FOOTSTEPS = ['player_footstep1', 'player_footstep2', 'player_footstep3'] as const;
const UP = new THREE.Vector3(0, 1, 0);

const MAX_SLAM_TARGETS = 48;

/** Where a body was blown apart, the floor is wet for a while: steps inside this many metres of it squelch. */
const GIB_WET_RADIUS = 3.5;
const GIB_WET_SECONDS = 6;
/** Height either side of the spot that is the same floor. */
const GIB_WET_HEIGHT = 2;
/** Spots remembered at once. A rocket into a crowd lays several, and the oldest goes first. */
const GIB_SPOTS = 4;
const GIB_STEP_VOLUME = 0.7;

export class MovementFeedback {
  private lastStride = 0;
  private trailDistance = 0;
  private wasGrounded = true;
  private wasMantling = false;
  private wasVaulting = false;
  private sinceJump = 9;
  private unsub: (() => void)[] = [];
  private readonly feet = new THREE.Vector3();
  private readonly along = new THREE.Vector3();
  private readonly wallNormal = new THREE.Vector3();
  private readonly slamHits: EnemyInstance[] = [];
  private readonly gibs = Array.from({ length: GIB_SPOTS }, () => ({ at: new THREE.Vector3(), until: -1 }));
  private nextGib = 0;
  private readonly slamDamage: DamageInfo = {
    amount: 0, type: 'crush', point: new THREE.Vector3(), dir: new THREE.Vector3(), force: 0, source: 'slam',
  };

  constructor(private readonly ctx: Ctx, private readonly player: Player) {}

  init(): void {
    const { events, audio, render, fx } = this.ctx;
    const p = this.player;
    this.unsub.push(
      events.on('player:jumped', e => {
        this.sinceJump = 0;
        if (e.bounce) audio.play('slam_bounce');
        else if (e.wall) {
          audio.play('wall_kick');
          this.body('boot_scuff', { volume: FEEDBACK.bodyVolume, pitch: 1.15, pitchJitter: 0.08 });
        } else if (e.double) {
          audio.play('double_jump');
          this.body('gear_rustle', { volume: FEEDBACK.bodyVolume, pitchJitter: 0.1 });
        } else audio.play('player_jump', { volume: FEEDBACK.jumpVolume, pitchJitter: 0.05 });
      }),
      events.on('player:landed', e => {
        const k = clamp(e.impact / FEEDBACK.landLoudAt, 0.2, 1);
        audio.play(e.impact > FEEDBACK.hardLanding ? 'land_hard' : 'player_land', {
          volume: FEEDBACK.landVolume * k, pitch: 1.08 - 0.25 * k, pitchJitter: 0.05,
        });
        if (e.impact > FEEDBACK.landDust) fx.dust(p.position, UP, 0.5 + k);
        if (e.impact > FEEDBACK.hardLanding) this.body('gear_rustle', { volume: FEEDBACK.bodyVolume * k, pitch: 0.9, pitchJitter: 0.1 });
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
          // The bracing hand reaches the floor a tenth of a second into the slide.
          this.body('hand_plant', { volume: FEEDBACK.bodyVolume * 0.6, pitch: 0.86, pitchJitter: 0.08, delay: 0.1 });
        } else if (p.grounded) {
          audio.play('slide_stop');
        }
      }),
      events.on('player:wallrun', e => {
        if (!e.active) return;
        audio.play('wallrun_start');
        // The trailing hand finds the wall a moment after the feet do.
        if (p.wallSide < 0) this.body('hand_plant', { volume: FEEDBACK.bodyVolume * 0.7, pitch: 1.2, pitchJitter: 0.08, delay: 0.09 });
      }),
      events.on('player:mantle', () => {
        audio.play('mantle');
        this.body('hand_plant', { volume: FEEDBACK.bodyVolume, pitchJitter: 0.08 });
      }),
      events.on('player:vault', () => {
        // The vault is a move of its own with its own switch, so its sound stays when the body layer is off.
        audio.play('vault_over', { volume: FEEDBACK.bodyVolume, pitchJitter: 0.05 });
        this.body('hand_plant', { volume: FEEDBACK.bodyVolume, pitch: 0.92, pitchJitter: 0.08 });
      }),
      events.on('player:slamstart', () => audio.play('slam_start')),
      events.on('player:slam', e => {
        const k = clamp(e.impact / FEEDBACK.slamFullAt, 0.3, 1);
        audio.play('slam_impact', { volume: 0.6 + 0.4 * k, pitch: e.big ? 0.72 : 1 });
        this.body('hand_plant', { volume: FEEDBACK.bodyVolume, pitch: 0.8, delay: 0.06 });
        render.post.radialBlur(0.45 * k, 0.25);
        render.post.chromatic(0.5 * k, 0.2);
        fx.slam(e.position, e.big ? 1.6 : k);
        if (e.big) this.groundImpact(e.position);
        this.ctx.physics.radialImpulse(e.position, e.radius, 30 * k * (e.big ? FEEDBACK.bigSlamDamage : 1));
        this.slamEnemies(e.position, e.radius, k, e.big === true);
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
      events.on('enemy:killed', e => {
        if (!e.gibbed || e.enemy.machine) return;
        const spot = this.gibs[this.nextGib]!;
        this.nextGib = (this.nextGib + 1) % GIB_SPOTS;
        spot.at.copy(e.enemy.center);
        spot.until = this.ctx.time.elapsed + GIB_WET_SECONDS;
      }),
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

    this.bodySounds(dt);
    render.post.setSpeed(smoothstep(FEEDBACK.speedLinesFrom, FEEDBACK.speedLinesFull, p.velocity.length()));
    render.post.setLowHealth(p.alive ? 1 - clamp(p.health / 35) : 1);
    if (p.sliding || p.wallRunning) this.trail(dt);
    else this.trailDistance = 0;
  }

  /**
   * A hand or a boot on a move. These are the sounds of the first-person body, so `?moveanim=0` silences them with it: a
   * hand that is not shown does not slap a ledge.
   */
  private body(id: string, options: PlayOptions): void {
    if (ANIM.enabled) this.ctx.audio.play(id, options);
  }

  /** Boots at the end of a climb, on the far side of cover, and scuffing off an edge the player walked over. */
  private bodySounds(dt: number): void {
    const p = this.player;
    this.sinceJump += dt;
    if (this.wasMantling && !p.mantling && p.alive) this.body('boot_scuff', { volume: FEEDBACK.bodyVolume, pitchJitter: 0.08 });
    if (this.wasVaulting && !p.vaulting && p.alive) this.body('boot_scuff', { volume: FEEDBACK.bodyVolume, pitch: 0.9, pitchJitter: 0.08 });
    const stepped = this.wasGrounded && !p.grounded && !p.mantling && !p.vaulting && !p.dashing && p.alive;
    if (stepped && this.sinceJump > 0.1 && p.velocity.y <= 0.5 && p.speed > 2) {
      this.body('boot_scuff', { volume: FEEDBACK.bodyVolume * 0.7, pitch: 1.1, pitchJitter: 0.1 });
    }
    this.wasGrounded = p.grounded;
    this.wasMantling = p.mantling;
    this.wasVaulting = p.vaulting;
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

  /**
   * A big slam's ground impact, not an explosion: a deep thud and the second fist landing, a ring of dust rolling out,
   * floor thrown up in chips and a wide crack. Nothing burns.
   */
  private groundImpact(at: THREE.Vector3): void {
    const { audio, fx, render } = this.ctx;
    audio.play('land_hard', { volume: 1, pitch: 0.62 });
    this.body('hand_plant', { volume: FEEDBACK.bodyVolume, pitch: 0.7, delay: 0.03 });
    for (const [ring, count, scale] of [[1.2, 8, 1.4], [2.6, 12, 1.8]] as const) {
      for (let i = 0; i < count; i++) {
        const a = ((i + (ring > 2 ? 0.5 : 0)) / count) * Math.PI * 2;
        this.feet.set(at.x + Math.cos(a) * ring, at.y, at.z + Math.sin(a) * ring);
        fx.dust(this.feet, UP, scale);
      }
    }
    fx.chips(at, 0x6f6a63, 14);
    // Stand-in renderers in the tests have no decals.
    render.decals?.add('crack', at, UP, 5.5, Math.random() * Math.PI * 2);
  }

  /** Small or big, damage falls off to the rim. A big slam hits `bigSlamDamage` harder, and throws the inner half off its feet. */
  private slamEnemies(center: THREE.Vector3, radius: number, strength: number, big = false): void {
    // Sandboxes run without an enemy system, and stubs answer with something that is not a count.
    const { enemies } = this.ctx;
    const count = enemies?.query(center, radius, this.slamHits);
    if (typeof count !== 'number') return;
    const d = this.slamDamage;
    const peak = lerp(FEEDBACK.slamDamageMin, FEEDBACK.slamDamageMax, strength) * (big ? FEEDBACK.bigSlamDamage : 1);
    for (let i = 0; i < Math.min(count, MAX_SLAM_TARGETS); i++) {
      const enemy = this.slamHits[i]!;
      const distance = enemy.position.distanceTo(center);
      d.amount = peak * lerp(1, FEEDBACK.slamEdge, clamp(distance / radius));
      d.point.copy(enemy.center);
      const knock = big && distance < radius * 0.5;
      d.dir.copy(enemy.position).sub(center).setY(knock ? 0.6 : 0.4).normalize();
      d.force = knock ? FEEDBACK.bigSlamKnock : FEEDBACK.slamForce * strength;
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
    if (!p.wallRunning && this.onGore()) audio.play('wet_squelch', { volume: options.volume * GIB_STEP_VOLUME, pitch: 1.12, pitchJitter: 0.12 });
  }

  /** Standing where something was gibbed in the last few seconds. */
  private onGore(): boolean {
    const now = this.ctx.time.elapsed;
    const p = this.player.position;
    for (const g of this.gibs) {
      if (now > g.until || Math.abs(g.at.y - p.y) > GIB_WET_HEIGHT) continue;
      const dx = g.at.x - p.x;
      const dz = g.at.z - p.z;
      if (dx * dx + dz * dz < GIB_WET_RADIUS * GIB_WET_RADIUS) return true;
    }
    return false;
  }

  reset(): void {
    this.lastStride = Math.floor(this.player.stridePhase);
    this.wasGrounded = true;
    this.wasMantling = this.wasVaulting = false;
    for (const g of this.gibs) g.until = -1;
  }
}
