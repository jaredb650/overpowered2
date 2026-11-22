/**
 * The Guided Heavy Missile's massive local non-nuke explosion (docs/proposals/mech-parts.md section 3).
 *
 * Designed to be watched from 60–150 m and read as completely distinct from the Tactical Nuke:
 *   - NO full-screen white-out, NO slender stem, NO mushroom cloud.
 *   - Stage 1 (t = 0.0 s): Crisp world-space bloom flash core + hard warm-white point light.
 *   - Stage 2 (t = 0.02..0.90 s): Sharp-edged hemispherical condensation dome + screen-space refraction shell
 *     racing out to 70 m * scale while lifting dust and debris chunks off the ground along its perimeter.
 *   - Stage 3 (t = 0.08..2.60 s): Ground-hugging turbulent dust & debris torus rolling outward behind the wave.
 *   - Stage 4 (t = 0.05..3.80 s): Short, fat fireball column that rises and collapses into a dirty dark cloud.
 *
 * Physics, combat, breakables, light flicker, camera shake, and sound are timed to physical wave arrival
 * (`dist / waveSpeed` at ~85 m/s for the pressure wave, `dist / 340` for acoustic delay) rather than firing
 * everything on frame 0. Pooled, capped, and allocation-free per frame.
 */
import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { CG, type Ctx, type DamageInfo, type PlayOptions, type RayHit } from '../../core/contracts';
import type { EnemyInstance, ExplosionSpec } from '../../core/gameplay';
import { clamp, lerp, rand, TAU } from '../../core/math';
import { MegaBlastVisualPool, type MegaBlastVisualFrame } from './megaBlastWave';

export interface MegaBlastOptions {
  /** Damage source name for kill feed / telemetry. Defaults to `'wireBomb'`. */
  source?: string;
  /** Co-op visual-only playback (no damage). */
  cosmetic?: boolean;
  /** Co-op mirrored flag (caller's blast mirrored on other screens). */
  mirrored?: boolean;
}

/** Tuned physical & timing constants for a scale-1 mega-blast (Guided Heavy Missile). */
export const MEGA_BLAST = {
  /** Core instakill radius in meters (at scale = 1). */
  killRadius: 26,
  /** Innermost vaporization core radius in meters (at scale = 1). */
  vaporizeRadius: 10,
  /** Maximum visible condensation dome & shockwave physics radius in meters (at scale = 1). */
  waveRadius: 70,
  /** Maximum range in meters at which a distant viewer still feels the delayed pressure tremor (at scale = 1). */
  feelRadius: 180,
  /** Pressure wave expansion speed in m/s (~0.82 s to reach 70 m). */
  waveSpeed: 85,
  /** Speed of sound in m/s for delayed deep boom. */
  soundSpeed: 340,
  /** Core explosion damage (at scale = 1). */
  coreDamage: 1400,
  /** Self-damage fraction passed to Combat.explode. */
  selfDamage: 0.55,
  /** Base visual lifetime in seconds (Stage 4 completes at 3.82 s). */
  baseDuration: 3.85,
  /** Fixed concurrent blast pool cap (safe for 4-player co-op bursts and Mac GPUs). */
  poolCap: 4,
} as const;

const LOOSE_BODIES = (0xffff << 16) | (CG.Ragdoll | CG.Gib | CG.Debris);
const IDENTITY_ROT = { x: 0, y: 0, z: 0, w: 1 };
const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);

/** Breakable shatter ring fractions along the 26..70 m outer pressure wave. */
const SHATTER_RINGS: readonly number[] = [36 / 70, 48 / 70, 60 / 70, 1.0];
/** Dynamic light flicker milestones along the expanding shock front. */
const FLICKER_RINGS: readonly number[] = [16 / 70, 30 / 70, 46 / 70, 62 / 70];

interface BlastSlot {
  active: boolean;
  age: number;
  duration: number;
  scale: number;
  source: string;
  cosmetic: boolean;
  readonly center: THREE.Vector3;
  floorY: number;
  killRadius: number;
  waveRadius: number;
  maxWaveRadius: number;
  feelRadius: number;
  waveSpeed: number;
  waveEndTime: number;
  travelDist: number;
  playerHit: boolean;
  shatterIdx: number;
  flickerIdx: number;
  perimeterTimer: number;
  perimeterPhase: number;
  wakeTimer: number;
  smokeTimer: number;
  flickerBurstLeft: number;
  flickerBurstTimer: number;
  readonly hitEnemies: Set<number>;
}

function makeSlot(): BlastSlot {
  return {
    active: false,
    age: 0,
    duration: MEGA_BLAST.baseDuration,
    scale: 1,
    source: 'wireBomb',
    cosmetic: false,
    center: new THREE.Vector3(),
    floorY: 0,
    killRadius: MEGA_BLAST.killRadius,
    waveRadius: 0,
    maxWaveRadius: MEGA_BLAST.waveRadius,
    feelRadius: MEGA_BLAST.feelRadius,
    waveSpeed: MEGA_BLAST.waveSpeed,
    waveEndTime: MEGA_BLAST.waveRadius / MEGA_BLAST.waveSpeed,
    travelDist: 0,
    playerHit: false,
    shatterIdx: 0,
    flickerIdx: 0,
    perimeterTimer: 0,
    perimeterPhase: 0,
    wakeTimer: 0,
    smokeTimer: 0,
    flickerBurstLeft: 0,
    flickerBurstTimer: 0,
    hitEnemies: new Set<number>(),
  };
}

class MegaBlastRunner {
  readonly slots: BlastSlot[] = [];
  readonly visuals: MegaBlastVisualPool;
  activeCount = 0;

  private hookedPhysics = false;
  private lastElapsed = 0;
  private ball: RAPIER.Ball | null = null;
  private readonly enemyList: EnemyInstance[] = [];
  private readonly bodies: RAPIER.RigidBody[] = [];
  private readonly seenBodies = new Set<number>();

  // Pre-allocated scratch objects (zero per-frame heap allocations).
  private readonly _dir = new THREE.Vector3();
  private readonly _pos = new THREE.Vector3();
  private readonly _vel = new THREE.Vector3();
  private readonly _probe = new THREE.Vector3();
  private readonly _hit: RayHit = {
    point: new THREE.Vector3(),
    normal: new THREE.Vector3(),
    distance: 0,
    surface: 'concrete',
    collider: null,
  };
  private readonly _dmg: DamageInfo = {
    amount: 0,
    type: 'explosive',
    point: new THREE.Vector3(),
    dir: new THREE.Vector3(),
    force: 0,
    source: 'wireBomb',
  };
  private readonly _coreSpec: ExplosionSpec = {
    radius: MEGA_BLAST.killRadius,
    damage: MEGA_BLAST.coreDamage,
    kind: 'barrel',
    source: 'wireBomb',
    team: 'player',
    instakill: true,
    selfDamage: MEGA_BLAST.selfDamage,
    playerPush: 26,
    scale: 2.8,
    shake: 0,
    worldObject: true,
    cosmetic: false,
    mirrored: undefined,
  };
  private readonly _audioOpts: PlayOptions = {};
  private readonly _visualFrame: {
    age: number;
    scale: number;
    waveRadius: number;
    maxWaveRadius: number;
    waveEndTime: number;
    centerX: number;
    centerY: number;
    centerZ: number;
    floorY: number;
  } = {
    age: 0,
    scale: 1,
    waveRadius: 0,
    maxWaveRadius: MEGA_BLAST.waveRadius,
    waveEndTime: 0.85,
    centerX: 0,
    centerY: 0,
    centerZ: 0,
    floorY: 0,
  };

  constructor(private readonly ctx: Ctx) {
    const scene = ctx.render?.scene && typeof ctx.render.scene.add === 'function' ? ctx.render.scene : null;
    this.visuals = new MegaBlastVisualPool(scene, MEGA_BLAST.poolCap);
    for (let i = 0; i < MEGA_BLAST.poolCap; i++) this.slots.push(makeSlot());
    this.lastElapsed = ctx.time?.elapsed ?? 0;

    // Clean up pooled visuals automatically when returning to menu/boot.
    ctx.events?.on?.('game:state', e => {
      if (e.to === 'menu' || e.to === 'boot') this.reset();
    });
  }

  private readonly onPreStep = (dt: number): void => {
    this.step(dt);
  };

  private readonly collectBody = (collider: RAPIER.Collider): boolean => {
    const body = collider.parent();
    if (body && body.isDynamic() && !this.seenBodies.has(body.handle)) {
      this.seenBodies.add(body.handle);
      this.bodies.push(body);
    }
    return true;
  };

  private ensureHooked(): void {
    if (this.hookedPhysics) return;
    const preStep = this.ctx.physics?.preStep;
    if (preStep && typeof preStep.add === 'function') {
      preStep.add(this.onPreStep);
      this.hookedPhysics = true;
    }
  }

  private releaseHookIfIdle(): void {
    if (!this.hookedPhysics || this.activeCount > 0) return;
    this.ctx.physics?.preStep?.delete(this.onPreStep);
    this.hookedPhysics = false;
  }

  private probeFloor(x: number, y: number, z: number): number {
    const physics = this.ctx.physics;
    if (physics && typeof physics.raycastInto === 'function') {
      this._probe.set(x, y + 6, z);
      if (physics.raycastInto(this._probe, DOWN, 60, CG.World, this._hit)) {
        return this._hit.point.y;
      }
    }
    return y;
  }

  private viewerPosition(): THREE.Vector3 | null {
    const c = this.ctx;
    if (c.player?.eye) return c.player.eye;
    if (c.player?.position) return c.player.position;
    if (c.render?.camera?.position) return c.render.camera.position;
    return null;
  }

  private pickSlotIndex(): number {
    let oldestIdx = 0;
    let oldestAge = -1;
    for (let i = 0; i < this.slots.length; i++) {
      const sl = this.slots[i]!;
      if (!sl.active) return i;
      if (sl.age > oldestAge) {
        oldestAge = sl.age;
        oldestIdx = i;
      }
    }
    // Pool full: recycle oldest slot cleanly.
    this.releaseSlot(oldestIdx);
    return oldestIdx;
  }

  private releaseSlot(index: number): void {
    const sl = this.slots[index]!;
    if (!sl.active) return;
    sl.active = false;
    sl.hitEnemies.clear();
    this.visuals.hideSlot(index);
    this.activeCount = Math.max(0, this.activeCount - 1);
  }

  trigger(at: THREE.Vector3, scale: number, opts?: MegaBlastOptions): void {
    const c = this.ctx;
    const now = c.time?.elapsed ?? 0;
    if (now < this.lastElapsed - 0.5) this.reset();
    this.lastElapsed = now;

    const s = Math.max(0.25, scale);
    const cosmetic = opts?.cosmetic === true;
    const source = opts?.source ?? 'wireBomb';
    const floorY = this.probeFloor(at.x, at.y, at.z);

    const slotIdx = this.pickSlotIndex();
    const sl = this.slots[slotIdx]!;
    sl.active = true;
    sl.age = 0;
    sl.scale = s;
    sl.source = source;
    sl.cosmetic = cosmetic;
    sl.center.copy(at);
    sl.floorY = floorY;
    sl.killRadius = MEGA_BLAST.killRadius * s;
    sl.waveRadius = 0;
    sl.maxWaveRadius = MEGA_BLAST.waveRadius * s;
    sl.feelRadius = MEGA_BLAST.feelRadius * s;
    sl.waveSpeed = MEGA_BLAST.waveSpeed;
    sl.waveEndTime = sl.maxWaveRadius / sl.waveSpeed;
    sl.duration = Math.max(MEGA_BLAST.baseDuration, sl.waveEndTime + 2.95);
    sl.travelDist = 0;
    sl.playerHit = false;
    sl.shatterIdx = 0;
    sl.flickerIdx = 0;
    sl.perimeterTimer = 0.02;
    sl.perimeterPhase = 0;
    sl.wakeTimer = 0;
    sl.smokeTimer = 0.12;
    sl.flickerBurstLeft = 0;
    sl.flickerBurstTimer = 0;
    sl.hitEnemies.clear();
    this.activeCount++;

    // --- Core kill blast (26 m * scale) & core vaporization (< 10 m * scale) ---
    if (!cosmetic) {
      this.applyCoreVaporize(sl);
      this.recordCoreEnemies(sl);

      const spec = this._coreSpec;
      spec.radius = sl.killRadius;
      spec.damage = MEGA_BLAST.coreDamage * s;
      spec.kind = 'barrel';
      spec.source = source;
      spec.team = 'player';
      spec.instakill = true;
      spec.selfDamage = MEGA_BLAST.selfDamage;
      spec.playerPush = 26 * s;
      spec.scale = 2.8 * s;
      // Camera shake is triggered later on physical pressure-wave arrival, NOT on frame 0.
      spec.shake = 0;
      // megaBlast owns its bespoke visual sequence, delayed audio, and expanding ring breakables.
      spec.worldObject = true;
      spec.cosmetic = false;
      spec.mirrored = opts?.mirrored;
      c.combat?.explode?.(at, spec);

      // Core structural & breakable destruction inside the 26 m kill radius at impact.
      c.world?.objects?.damageExplosivesInRadius?.(at, sl.killRadius, MEGA_BLAST.coreDamage * s, source);
    }

    // --- Stage 1 (t = 0.0 s): Flash without white-out ---
    // Hard warm-white point light illuminating the whole surrounding area + warm fireball fill light.
    c.render?.lights?.flash?.(at, 0xfff3de, 240 * s, 135 * s, 0.52);
    this._pos.set(at.x, Math.max(at.y, floorY) + 4 * s, at.z);
    c.render?.lights?.flash?.(this._pos, 0xff7b24, 95 * s, 85 * s, 1.55);

    // Scorch & crack decals at ground zero.
    this._pos.set(at.x, floorY + 0.03, at.z);
    c.render?.decals?.add?.('scorch', this._pos, UP, 22 * s, rand(0, TAU));
    c.render?.decals?.add?.('crack', this._pos, UP, 14 * s, rand(0, TAU));

    // Initial spark & ember burst + thermal shimmer over ground zero (no full-screen white-out!).
    c.fx?.sparks?.(at, UP, Math.min(80, Math.round(48 * s)), 0xffe29a);
    c.fx?.embers?.(at, Math.min(90, Math.round(55 * s)), 8 * s);
    c.fx?.heatShimmer?.(at, 32 * s, 2.8);
    c.fx?.ring?.(this._pos, UP, 0xffd28a, 32 * s);

    // --- Delayed acoustic boom (arrives at dist / 340 s) ---
    const viewer = this.viewerPosition();
    const viewerDist = viewer ? viewer.distanceTo(at) : 0;
    const soundDelay = viewerDist / MEGA_BLAST.soundSpeed;

    // 3D heavy blast (AudioEngine applies airDelay automatically when position is set).
    this._audioOpts.position = at;
    this._audioOpts.volume = 1;
    this._audioOpts.pitch = 0.78;
    this._audioOpts.pitchJitter = 0.03;
    this._audioOpts.delay = 0;
    c.audio?.play?.('explosion_tank', this._audioOpts);

    // 2D deep sub-bass boom explicitly delayed by acoustic travel time (dist / 340 s).
    this._audioOpts.position = undefined;
    this._audioOpts.volume = clamp(1 - viewerDist / (280 * Math.max(1, s)), 0.22, 0.95);
    this._audioOpts.pitch = 0.72;
    this._audioOpts.pitchJitter = 0.02;
    this._audioOpts.delay = soundDelay;
    c.audio?.play?.('explosion_distant', this._audioOpts);

    // Sync initial frame 0 visual meshes immediately so stage 1 bloom core is visible on frame 0.
    this.syncVisuals(slotIdx, sl);
    this.ensureHooked();
  }

  /** Vaporizes non-boss enemies caught inside the innermost 10 m * scale thermal core. */
  private applyCoreVaporize(sl: BlastSlot): void {
    const enemies = this.ctx.enemies;
    if (!enemies || typeof enemies.query !== 'function') return;
    const vapR = MEGA_BLAST.vaporizeRadius * sl.scale;
    const n = enemies.query(sl.center, vapR, this.enemyList) || 0;
    for (let i = 0; i < n; i++) {
      const e = this.enemyList[i]!;
      if (!e.alive || e.isBoss) continue;
      const d = e.center.distanceTo(sl.center);
      if (d > vapR) continue;
      sl.hitEnemies.add(e.uid);
      this._dir.subVectors(e.center, sl.center);
      if (this._dir.lengthSq() < 1e-4) this._dir.set(0, 1, 0);
      else {
        this._dir.setY(0).normalize();
        this._dir.y = 0.6;
        this._dir.normalize();
      }
      const dmg = this._dmg;
      dmg.amount = 99999;
      dmg.type = 'explosive';
      dmg.point.copy(e.center);
      dmg.dir.copy(this._dir);
      dmg.force = 420 * sl.scale;
      dmg.source = sl.source;
      dmg.gib = true;
      dmg.vaporize = true;
      dmg.reach = 0;
      dmg.blastKind = 'barrel';
      enemies.applyDamage(e, dmg);
    }
  }

  /** Records enemies inside the 26 m core kill radius so the outer pressure wave doesn't double-hit them. */
  private recordCoreEnemies(sl: BlastSlot): void {
    const enemies = this.ctx.enemies;
    if (!enemies || typeof enemies.query !== 'function') return;
    const n = enemies.query(sl.center, sl.killRadius, this.enemyList) || 0;
    for (let i = 0; i < n; i++) {
      const e = this.enemyList[i]!;
      if (e.center.distanceTo(sl.center) <= sl.killRadius) {
        sl.hitEnemies.add(e.uid);
      }
    }
  }

  step(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0 || this.activeCount <= 0) return;

    const now = this.ctx.time?.elapsed ?? 0;
    if (now < this.lastElapsed - 0.5) {
      this.reset();
      return;
    }
    this.lastElapsed = now;

    // Sub-step large test deltas so wave-arrival ordering stays crisp and exact.
    const maxSlice = 0.05;
    let remaining = dt;
    while (remaining > 1e-6 && this.activeCount > 0) {
      const h = remaining > maxSlice ? maxSlice : remaining;
      remaining -= h;
      this.stepSlice(h);
    }
    this.releaseHookIfIdle();
  }

  private stepSlice(dt: number): void {
    for (let i = 0; i < this.slots.length; i++) {
      const sl = this.slots[i]!;
      if (!sl.active) continue;
      sl.age += dt;

      const prevWave = sl.waveRadius;
      sl.travelDist += sl.waveSpeed * dt;
      sl.waveRadius = Math.min(sl.maxWaveRadius, sl.travelDist);
      const currWave = sl.waveRadius;

      // 1. Pressure-wave arrival at viewer (delayed shake, kick, chromatic pulse, light flicker, shock audio).
      this.checkPlayerWaveArrival(sl);

      // 2. Electrical overhead flicker pulses after wave hits viewer.
      if (sl.flickerBurstLeft > 0) {
        sl.flickerBurstTimer -= dt;
        if (sl.flickerBurstTimer <= 0) {
          sl.flickerBurstLeft--;
          sl.flickerBurstTimer = 0.09;
          const viewer = this.viewerPosition();
          if (viewer) {
            this._pos.set(viewer.x + rand(-6, 6), viewer.y + rand(2, 6), viewer.z + rand(-6, 6));
            this.ctx.render?.lights?.flash?.(
              this._pos,
              sl.flickerBurstLeft % 2 === 0 ? 0xd8ecff : 0xffcfa0,
              45 * sl.scale,
              28 * sl.scale,
              0.08,
            );
          }
        }
      }

      // 3. Expanding wave front effects while sweeping out to 70 m * scale.
      if (currWave > prevWave) {
        if (!sl.cosmetic) {
          this.sweepOuterEnemies(sl, currWave);
          this.sweepBreakableRings(sl, currWave);
        }
        this.sweepDynamicBodies(sl, prevWave, currWave, dt);
        this.sweepLightFlicker(sl, currWave);
        this.sweepPerimeterDust(sl, currWave, dt);
      }

      // 4. Ongoing fireball crown smoke & ember puffs during Stage 4 rise/collapse.
      if (sl.age >= 0.1 && sl.age <= 2.2) {
        sl.smokeTimer -= dt;
        if (sl.smokeTimer <= 0) {
          sl.smokeTimer = 0.16;
          this.emitColumnSmoke(sl);
        }
      }

      // 5. Update pooled shader meshes or clean up once complete.
      if (sl.age >= sl.duration) {
        this.releaseSlot(i);
      } else {
        this.syncVisuals(i, sl);
      }
    }
  }

  private checkPlayerWaveArrival(sl: BlastSlot): void {
    if (sl.playerHit) return;
    const viewer = this.viewerPosition();
    if (!viewer) return;
    const dist = viewer.distanceTo(sl.center);
    if (dist > sl.feelRadius) {
      sl.playerHit = true;
      return;
    }
    if (sl.travelDist < dist) return;

    sl.playerHit = true;
    const c = this.ctx;
    const s = sl.scale;
    const inWave = dist <= sl.maxWaveRadius;
    // Strong trauma inside 70 m * scale, tapering to a felt shock thump out to 180 m * scale.
    const nearK = clamp(1 - dist / sl.maxWaveRadius, 0, 1);
    const farK = clamp(1 - (dist - sl.maxWaveRadius) / Math.max(sl.feelRadius - sl.maxWaveRadius, 1), 0, 1);
    const trauma = inWave ? lerp(0.34, 1.0, nearK * nearK) : lerp(0.08, 0.34, farK);

    c.camera?.addTrauma?.(clamp(trauma * Math.min(s, 1.4), 0.05, 1.0));
    const kickMag = (inWave ? lerp(0.02, 0.075, nearK) : lerp(0.004, 0.02, farK)) * Math.min(s, 1.35);
    c.camera?.kick?.(kickMag, rand(-kickMag * 0.4, kickMag * 0.4), rand(-kickMag * 0.6, kickMag * 0.6));
    if (inWave) {
      c.camera?.fovPunch?.(lerp(2.5, 9.5, nearK) * Math.min(s, 1.3), 0.28);
      c.render?.post?.chromatic?.(lerp(0.18, 0.75, nearK), 0.32);
      c.render?.post?.radialBlur?.(lerp(0.08, 0.36, nearK), 0.24);
    } else {
      c.camera?.fovPunch?.(lerp(0.8, 2.5, farK), 0.2);
      c.render?.post?.chromatic?.(lerp(0.05, 0.18, farK), 0.22);
    }

    // Physical air shove on foot in the 26..55 m * scale outer shock zone (skip if parked in mech).
    const player = c.player;
    if (player && player.alive && !player.parked && dist > sl.killRadius && dist < 55 * s) {
      const shoveK = clamp(1 - (dist - sl.killRadius) / (55 * s - sl.killRadius), 0, 1);
      this._dir.subVectors(player.position, sl.center).setY(0);
      const len = this._dir.length();
      if (len > 1e-3) this._dir.divideScalar(len);
      else this._dir.set(1, 0, 0);
      this._vel.set(this._dir.x * 14 * shoveK * s, 4.5 * shoveK * s, this._dir.z * 14 * shoveK * s);
      if (typeof player.push === 'function') player.push(this._vel);
      else player.launch?.(this._vel);
    }

    // Trigger 3-beat nearby light flicker burst as the shockwave rattles fixtures around the player.
    sl.flickerBurstLeft = 3;
    sl.flickerBurstTimer = 0;

    // Pressure-wave impact boom + trailing debris rain & settling rumble.
    this._audioOpts.position = undefined;
    this._audioOpts.volume = clamp(inWave ? lerp(0.55, 0.95, nearK) : lerp(0.22, 0.55, farK), 0.15, 0.95);
    this._audioOpts.pitch = 0.76;
    this._audioOpts.pitchJitter = 0.03;
    this._audioOpts.delay = 0;
    c.audio?.play?.('vehicle_explode', this._audioOpts);

    this._audioOpts.volume = clamp(inWave ? 0.75 : 0.4, 0.2, 0.8);
    this._audioOpts.pitch = 0.92;
    this._audioOpts.pitchJitter = 0.06;
    this._audioOpts.delay = 0.32;
    c.audio?.play?.('explosion_debris', this._audioOpts);

    this._audioOpts.volume = clamp(inWave ? 0.65 : 0.35, 0.15, 0.7);
    this._audioOpts.pitch = 0.85;
    this._audioOpts.pitchJitter = 0.05;
    this._audioOpts.delay = 0.54;
    c.audio?.play?.('concrete_crumble', this._audioOpts);
  }

  /** Knocks down and flings enemies in the 26..70 m * scale band right as the pressure wave reaches them. */
  private sweepOuterEnemies(sl: BlastSlot, currWave: number): void {
    const enemies = this.ctx.enemies;
    if (!enemies || typeof enemies.query !== 'function') return;
    const n = enemies.query(sl.center, currWave, this.enemyList) || 0;
    const outerSpan = Math.max(sl.maxWaveRadius - sl.killRadius, 1);

    for (let i = 0; i < n; i++) {
      const e = this.enemyList[i]!;
      if (!e.alive || sl.hitEnemies.has(e.uid)) continue;
      const d = e.center.distanceTo(sl.center);
      if (d > currWave) continue;
      sl.hitEnemies.add(e.uid);

      const falloff = clamp(1 - Math.max(0, d - sl.killRadius) / outerSpan, 0.15, 1);
      this._dir.subVectors(e.center, sl.center);
      this._dir.y = 0;
      const hLen = this._dir.length();
      if (hLen > 1e-4) this._dir.divideScalar(hLen);
      else this._dir.set(1, 0, 0);
      this._dir.y = 0.48;
      this._dir.normalize();

      // Inherit strong fling velocity on the body so ragdolls & knockdowns fly outward.
      const throwSpeed = lerp(10, 26, falloff) * sl.scale;
      e.velocity.copy(this._dir).multiplyScalar(throwSpeed);

      const dmg = this._dmg;
      dmg.amount = Math.round((80 + 200 * falloff) * sl.scale);
      dmg.type = 'explosive';
      dmg.point.copy(e.center);
      dmg.dir.copy(this._dir);
      dmg.force = (180 + 260 * falloff) * sl.scale;
      dmg.source = sl.source;
      dmg.gib = false;
      dmg.vaporize = false;
      dmg.reach = clamp(0.72 + (1 - falloff) * 0.28, 0.72, 1);
      dmg.blastKind = 'barrel';
      enemies.applyDamage(e, dmg);
    }
  }

  /** Shatters glass, breakable props, explosives, and mission lights progressively in an expanding ring. */
  private sweepBreakableRings(sl: BlastSlot, currWave: number): void {
    const objs = this.ctx.world?.objects;
    if (!objs || typeof objs.damageExplosivesInRadius !== 'function') return;
    while (sl.shatterIdx < SHATTER_RINGS.length) {
      const targetR = SHATTER_RINGS[sl.shatterIdx]! * sl.maxWaveRadius;
      if (currWave < targetR) break;
      const frac = SHATTER_RINGS[sl.shatterIdx]!;
      sl.shatterIdx++;
      const ringDamage = lerp(260, 45, clamp((frac - 0.5) / 0.5, 0, 1)) * sl.scale;
      objs.damageExplosivesInRadius(sl.center, targetR, ringDamage, sl.source);
    }
  }

  /** Flings ragdolls, severed limbs, gibs, and debris chunks outward right as the wave front passes them. */
  private sweepDynamicBodies(sl: BlastSlot, prevWave: number, currWave: number, dt: number): void {
    const physics = this.ctx.physics;
    if (!physics) return;

    // Wake sleeping corpses slightly ahead of the shock front so Rapier has dynamic bodies ready.
    sl.wakeTimer -= dt;
    if (sl.wakeTimer <= 0) {
      sl.wakeTimer = 0.12;
      physics.radialImpulse?.(sl.center, Math.min(sl.maxWaveRadius, currWave + 8 * sl.scale), 18 * sl.scale);
    }

    const world = physics.world;
    const R = physics.R;
    if (!world || typeof world.intersectionsWithShape !== 'function' || !R?.Ball) return;

    if (!this.ball) this.ball = new R.Ball(1);
    this.ball.radius = currWave;
    this.bodies.length = 0;
    this.seenBodies.clear();
    world.intersectionsWithShape(sl.center, IDENTITY_ROT, this.ball, this.collectBody, undefined, LOOSE_BODIES);

    const span = Math.max(sl.maxWaveRadius, 1);
    for (let i = 0; i < this.bodies.length; i++) {
      const body = this.bodies[i]!;
      const p = body.translation();
      const dx = p.x - sl.center.x;
      const dz = p.z - sl.center.z;
      const d = Math.hypot(dx, dz);
      if (d < prevWave || d > currWave) continue;
      const inv = 1 / Math.max(d, 0.1);
      const falloff = clamp(1 - d / span, 0.18, 1);
      const k = lerp(12, 34, falloff) * sl.scale * body.mass();
      body.applyImpulse({ x: dx * inv * k, y: k * 0.55, z: dz * inv * k }, true);
    }
  }

  /** Pulses dynamic light flashes along the sweeping shockwave rim to illuminate and flicker nearby geometry. */
  private sweepLightFlicker(sl: BlastSlot, currWave: number): void {
    const lights = this.ctx.render?.lights;
    if (!lights || typeof lights.flash !== 'function') return;
    while (sl.flickerIdx < FLICKER_RINGS.length) {
      const targetR = FLICKER_RINGS[sl.flickerIdx]! * sl.maxWaveRadius;
      if (currWave < targetR) break;
      const idx = sl.flickerIdx++;
      const viewer = this.viewerPosition();
      let angle = idx * 1.57;
      if (viewer) {
        angle = Math.atan2(viewer.z - sl.center.z, viewer.x - sl.center.x);
      }
      this._pos.set(
        sl.center.x + Math.cos(angle) * targetR,
        sl.floorY + 3.5 * sl.scale,
        sl.center.z + Math.sin(angle) * targetR,
      );
      lights.flash(this._pos, 0xffe0b2, lerp(110, 42, idx / FLICKER_RINGS.length) * sl.scale, 34 * sl.scale, 0.12);
    }
  }

  /** Lifts visible dust plumes and debris chunks off the ground right along the expanding condensation dome rim. */
  private sweepPerimeterDust(sl: BlastSlot, currWave: number, dt: number): void {
    if (currWave < 5 * sl.scale) return;
    sl.perimeterTimer -= dt;
    if (sl.perimeterTimer > 0) return;
    sl.perimeterTimer = 0.045;

    const fx = this.ctx.fx;
    if (!fx) return;
    const samples = 5;
    sl.perimeterPhase += 0.47;
    const progress = clamp(currWave / Math.max(sl.maxWaveRadius, 1), 0, 1);
    const dustScale = lerp(1.5, 0.85, progress) * sl.scale;

    for (let i = 0; i < samples; i++) {
      const a = sl.perimeterPhase + (i / samples) * TAU;
      const px = sl.center.x + Math.cos(a) * currWave;
      const pz = sl.center.z + Math.sin(a) * currWave;
      const gy = this.probeFloor(px, sl.floorY, pz);
      this._pos.set(px, gy + 0.15, pz);
      fx.dust?.(this._pos, UP, dustScale);
      if (i % 2 === 0) {
        fx.smoke?.(this._pos, 0x7c7266, lerp(4.2, 2.4, progress) * sl.scale, lerp(1.6, 1.0, progress));
      } else {
        fx.chips?.(this._pos, 0x5c554c, 4);
      }
    }
  }

  /** Emits billowing dark smoke & embers off the collapsing squat fireball column for silhouette break-up. */
  private emitColumnSmoke(sl: BlastSlot): void {
    const fx = this.ctx.fx;
    if (!fx) return;
    const s = sl.scale;
    const a = rand(0, TAU);
    const rad = rand(3, 14) * s;
    const h = rand(4, 22) * s * (1 - clamp((sl.age - 1.2) / 2.2, 0, 0.4));
    this._pos.set(sl.center.x + Math.cos(a) * rad, sl.floorY + h, sl.center.z + Math.sin(a) * rad);
    fx.smoke?.(this._pos, sl.age < 0.7 ? 0x3a2a22 : 0x262426, rand(5, 9) * s, rand(1.4, 2.4));
    if (sl.age < 1.1) {
      fx.embers?.(this._pos, 6, 4 * s);
    }
  }

  private syncVisuals(index: number, sl: BlastSlot): void {
    const f = this._visualFrame;
    f.age = sl.age;
    f.scale = sl.scale;
    f.waveRadius = sl.waveRadius;
    f.maxWaveRadius = sl.maxWaveRadius;
    f.waveEndTime = sl.waveEndTime;
    f.centerX = sl.center.x;
    f.centerY = sl.center.y;
    f.centerZ = sl.center.z;
    f.floorY = sl.floorY;
    this.visuals.syncSlot(index, f as MegaBlastVisualFrame);
  }

  reset(): void {
    for (let i = 0; i < this.slots.length; i++) {
      this.slots[i]!.active = false;
      this.slots[i]!.hitEnemies.clear();
    }
    this.activeCount = 0;
    this.visuals.hideAll();
    this.releaseHookIfIdle();
    this.lastElapsed = this.ctx.time?.elapsed ?? 0;
  }
}

const runners = new WeakMap<Ctx, MegaBlastRunner>();

function runnerFor(ctx: Ctx): MegaBlastRunner {
  let r = runners.get(ctx);
  if (!r) {
    r = new MegaBlastRunner(ctx);
    runners.set(ctx, r);
  }
  return r;
}

/**
 * Triggers a massive local non-nuke explosion at `at`, scaled by `scale`
 * (1 = Guided Heavy Missile: 26 m kill radius, 70 m pressure wave).
 */
export function megaBlast(ctx: Ctx, at: THREE.Vector3, scale = 1, opts?: MegaBlastOptions): void {
  runnerFor(ctx).trigger(at, scale, opts);
}

/** Advances all active mega-blasts for `ctx` by `dt` seconds. Called automatically via `ctx.physics.preStep`. */
export function stepMegaBlasts(ctx: Ctx, dt: number): void {
  runners.get(ctx)?.step(dt);
}

/** Clears and hides all active mega-blast pooled state for `ctx`. */
export function resetMegaBlasts(ctx: Ctx): void {
  runners.get(ctx)?.reset();
}

/** Number of currently active pooled mega-blasts for `ctx`. */
export function activeMegaBlastCount(ctx: Ctx): number {
  return runners.get(ctx)?.activeCount ?? 0;
}

/** Count of currently visible pooled meshes across all slots for `ctx` (0 when idle). */
export function visibleMegaBlastMeshes(ctx: Ctx): number {
  return runners.get(ctx)?.visuals.visibleMeshCount() ?? 0;
}
