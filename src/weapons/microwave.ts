/**
 * Autoclave directed-microwave boiling & pop system (Lane I).
 *
 * Emits an invisible narrow cone of 2.45 GHz microwave radiation (faint heat shimmer ONLY via `ctx.fx.heatShimmer` —
 * no beam, no dynamic light). Heats every enemy inside the cone regardless of armour plates or shields, driving them
 * through three visible stages:
 *   - Stage 1 (>= 0.33 heat): stagger/flinch, white steam puffs rising off the torso, subtle skin reddening/charring.
 *   - Stage 2 (>= 0.67 heat): attack interrupted / weapon dropped out of action, scream + boiling hiss, heavy steam,
 *     and visible torso/body swell up to ~1.22x (cleanly restored on cool-down, death, pop, or reset).
 *   - Stage 3 (>= 1.00 heat): violent internal POP — lethal armour-bypassing damage with `gib: true` (bosses heat at
 *     0.35x and suffer a massive internal damage burst instead of an instant gib when above lethal threshold).
 *
 * Hook for `Weapons.ts` and `watch.ts`:
 *   - `microwave.update(dt, firing, eye, forward, muzzle)` while Autoclave is equipped (returns true while actively firing).
 *   - `microwave.emitShimmer(muzzle, dir, dt)` for co-op `Watcher` remote Autoclave streams.
 *   - `microwave.heatOf(uid)` for HUD/tests, `microwave.reset()` on run reset.
 */
import * as THREE from 'three';
import { CG, type Ctx, type DamageInfo, type LoopHandle, type RayHit } from '../core/contracts';
import { toldKill, type EnemyInstance } from '../core/gameplay';
import { clamp, lerp } from '../core/math';

export const MICROWAVE = {
  /** Half-angle of the narrow emitter cone in degrees (~10° -> 20° total width, hitting 2-3 men at once). */
  coneDeg: 10,
  /** Cosine of the cone half-angle for dot-product tests. */
  coneCos: Math.cos((10 * Math.PI) / 180),
  /** Maximum effective microwave range in metres. */
  range: 18,
  /** Seconds of sustained exposure to boil a standard enemy from 0 to 1.0 (POP). */
  heatTime: 2.2,
  /** Per-second heat accumulation rate (1 / heatTime). */
  heatRate: 1 / 2.2,
  /** Per-second heat decay rate once outside the cone. */
  coolRate: 0.25,
  /** Reduced heat buildup multiplier on bosses. */
  bossHeatMult: 0.35,
  /** Massive internal bypassing damage dealt to a boss on each Stage 3 burst. */
  bossPopDamage: 520,
  /** Floor for lethal bypassing damage on non-boss Stage 3 POP. */
  lethalPopDamage: 9999,
  /** Stage thresholds (0..1 heat). */
  stage1: 1 / 3,
  stage2: 2 / 3,
  stage3: 1,
  /** Maximum Stage 2 body/torso swell scale right before POP. */
  maxSwellXZ: 1.22,
  maxSwellY: 1.1,
  /** Seconds between white steam puffs in Stage 1 and Stage 2. */
  steamGapStage1: 0.26,
  steamGapStage2: 0.11,
  /** Seconds between Stage 2 boiling hiss sizzles. */
  hissGap: 0.95,
  /** Seconds between HUD body hit-ticks while actively cooking a target. */
  markerGap: 0.24,
  /** Seconds between heat-shimmer cone slices (Q8: shimmer only, no beam/light). */
  shimmerGap: 0.065,
  /** Stagger lock seconds maintained while an enemy is in Stage 2 boiling panic. */
  stage2Stagger: 0.35,
  /** All sound IDs verified registered in `src/audio/catalog.ts`. */
  sounds: {
    humLoop: 'railgun_charge_loop',
    stage1Pain: 'vox_pain',
    stage2Scream: 'vox_scream',
    boilHiss: 'char_sizzle',
    pop: 'head_pop',
    popWet: 'gib_squelch',
  },
} as const;

/** Optional concrete runtime fields on `Enemy` manipulated defensively without importing concrete `Enemy`. */
interface RuntimeEnemyFields {
  stagger?: number;
  shaken?: number;
  pressure?: number;
  pace?: number;
  attack?: unknown;
  attackPhase?: string;
  attackLoop?: LoopHandle | null;
  attackReadyAt?: number;
}

interface HeatEntry {
  enemy: EnemyInstance;
  heat: number;
  heatedThisFrame: boolean;
  stage1Entered: boolean;
  stage2Entered: boolean;
  steamClock: number;
  hissClock: number;
  swelled: boolean;
  lastDir: THREE.Vector3;
}

/** Distances (m), puff radii (m), and lifetimes (s) along the narrow shimmer cone (3 slots per pulse). */
const SHIMMER_STEPS: readonly [number, number, number][] = [
  [2.2, 0.44, 0.24],
  [6.4, 0.78, 0.3],
  [11.6, 1.18, 0.34],
];

const UP = new THREE.Vector3(0, 1, 0);
const ALT_UP = new THREE.Vector3(1, 0, 0);

export class Microwave {
  private readonly entries = new Map<number, HeatEntry>();
  private readonly nearby: EnemyInstance[] = [];
  private readonly forwardNorm = new THREE.Vector3();
  private readonly toEnemy = new THREE.Vector3();
  private readonly dirToEnemy = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly scratchPos = new THREE.Vector3();
  private readonly rayHit: RayHit = {
    point: new THREE.Vector3(),
    normal: new THREE.Vector3(),
    distance: 0,
    surface: 'concrete',
    collider: null,
  };
  private readonly popInfo: DamageInfo = {
    amount: 0,
    type: 'true',
    point: new THREE.Vector3(),
    dir: new THREE.Vector3(),
    force: 110,
    source: 'autoclave',
    region: 'chest',
    gib: true,
    pierces: true,
    armorPiercing: true,
  };

  private humLoop: LoopHandle | null = null;
  private humCharge = 0;
  private lastHumVolume = -1;
  private lastHumPitch = -1;
  private shimmerClock = 0;
  private markerClock = 0;
  private clock = 0;
  private shimmerPhase = 0;

  constructor(private readonly ctx: Ctx) {}

  /**
   * Advances microwave emission, cone heating, stage effects, swelling, pops, cool-down, and magnetron hum.
   * Returns `true` when actively emitting (caller should consume ammo while true).
   */
  update(
    dt: number,
    firing: boolean,
    eye: THREE.Vector3,
    forward: THREE.Vector3,
    muzzle: THREE.Vector3,
  ): boolean {
    if (dt <= 0) return false;
    this.clock += dt;
    this.markerClock = Math.max(0, this.markerClock - dt);

    for (const entry of this.entries.values()) {
      entry.heatedThisFrame = false;
    }

    let heatedAny = false;
    let peakHeat = 0;

    if (firing) {
      this.forwardNorm.copy(forward);
      const fwdLen = this.forwardNorm.length();
      if (fwdLen > 1e-6) {
        this.forwardNorm.multiplyScalar(1 / fwdLen);
      } else {
        this.forwardNorm.set(0, 0, -1);
      }

      // Faint heat shimmer along the emitter cone — NO visible beam, NO dynamic light (Q8).
      this.emitShimmer(muzzle, this.forwardNorm, dt);

      // Query all candidate enemies within range around the eye.
      const count = this.ctx.enemies.query(eye, MICROWAVE.range + 1.5, this.nearby);
      for (let i = 0; i < count; i++) {
        const enemy = this.nearby[i];
        if (!enemy || !enemy.alive) continue;

        this.toEnemy.subVectors(enemy.center, eye);
        const dist = this.toEnemy.length();
        if (dist > MICROWAVE.range || dist < 1e-4) continue;

        this.dirToEnemy.copy(this.toEnemy).multiplyScalar(1 / dist);
        const dot = this.dirToEnemy.dot(this.forwardNorm);
        if (dot < MICROWAVE.coneCos) continue;

        // Solid world walls block microwave radiation.
        if (this.wallBlocks(eye, this.dirToEnemy, dist)) continue;

        let entry = this.entries.get(enemy.uid);
        if (!entry) {
          entry = {
            enemy,
            heat: 0,
            heatedThisFrame: false,
            stage1Entered: false,
            stage2Entered: false,
            steamClock: 0,
            hissClock: 0,
            swelled: false,
            lastDir: new THREE.Vector3(),
          };
          this.entries.set(enemy.uid, entry);
        } else {
          entry.enemy = enemy;
        }

        // Armour plates, shields, and wards are bypassed completely: armoured men heat at the exact same rate.
        const rate = MICROWAVE.heatRate * (enemy.isBoss ? MICROWAVE.bossHeatMult : 1);
        entry.heat = clamp(entry.heat + rate * dt, 0, 1);
        entry.heatedThisFrame = true;
        entry.lastDir.copy(this.dirToEnemy);
        heatedAny = true;
        if (entry.heat > peakHeat) peakHeat = entry.heat;
      }

      if (heatedAny && this.markerClock <= 0) {
        this.markerClock = MICROWAVE.markerGap;
        this.ctx.hud?.hitMarker?.('body');
      }
    }

    // Update rising magnetron hum loop (registered catalog loop ID).
    this.updateHum(dt, firing, peakHeat);

    // Advance stage effects, swelling, cool-down decay, and Stage 3 pops.
    for (const [uid, entry] of this.entries) {
      const e = entry.enemy;
      if (!e.alive) {
        this.restoreSwell(entry);
        this.entries.delete(uid);
        continue;
      }

      if (!entry.heatedThisFrame) {
        entry.heat = Math.max(0, entry.heat - MICROWAVE.coolRate * dt);
        if (entry.heat <= 0) {
          this.restoreSwell(entry);
          this.entries.delete(uid);
          continue;
        }
      }

      // Reset stage flags if the target cooled back below a threshold.
      if (entry.heat < MICROWAVE.stage1) {
        entry.stage1Entered = false;
        entry.stage2Entered = false;
        this.restoreSwell(entry);
        continue;
      }

      // Stage 3: violent internal POP!
      if (entry.heat >= MICROWAVE.stage3) {
        this.triggerPop(entry);
        this.entries.delete(uid);
        continue;
      }

      // Stage 1 (>= 0.33): stagger, rising white steam, subtle skin reddening/charring.
      if (!entry.stage1Entered) {
        entry.stage1Entered = true;
        this.enterStage1(entry);
      }

      // Subtle reddening/charring progression across Stage 1 -> Stage 3 without overwriting heavier fire burn.
      const targetChar = clamp((entry.heat - MICROWAVE.stage1) / (MICROWAVE.stage3 - MICROWAVE.stage1), 0, 1) * 0.55;
      if (e.char?.setBurn && (e.char.burn ?? 0) < targetChar) {
        e.char.setBurn(targetChar);
      }
      e.char?.setEmber?.(clamp(entry.heat * 0.7, 0, 0.7));

      // Stage 2 (>= 0.67): drop/interrupt weapon, scream, heavy steam + boiling hiss, visible torso swell.
      if (entry.heat >= MICROWAVE.stage2) {
        if (!entry.stage2Entered) {
          entry.stage2Entered = true;
          this.enterStage2(entry);
        }
        this.maintainStage2(entry, dt);
      } else {
        entry.stage2Entered = false;
        this.restoreSwell(entry);
      }

      // Periodic white steam puffs rising off the boiling torso.
      entry.steamClock -= dt;
      if (entry.steamClock <= 0) {
        const inStage2 = entry.heat >= MICROWAVE.stage2;
        entry.steamClock = inStage2 ? MICROWAVE.steamGapStage2 : MICROWAVE.steamGapStage1;
        this.emitSteam(e, inStage2);
      }
    }

    return firing;
  }

  /**
   * Emits faint heat-shimmer distortion slices along the narrow microwave cone.
   * Callable from co-op `Watcher` as well as local `update()`.
   * Strictly NO visible beam and NO dynamic light (Q8).
   */
  emitShimmer(origin: THREE.Vector3, dir: THREE.Vector3, dt: number): void {
    if (dt <= 0 || !this.ctx.fx?.heatShimmer) return;
    this.shimmerClock -= dt;
    if (this.shimmerClock > 0) return;
    this.shimmerClock = MICROWAVE.shimmerGap;

    this.forwardNorm.copy(dir);
    const len = this.forwardNorm.length();
    if (len > 1e-6) {
      this.forwardNorm.multiplyScalar(1 / len);
    } else {
      this.forwardNorm.set(0, 0, -1);
    }

    // Clamp shimmer reach to any wall in front of the muzzle so shimmer doesn't bleed through solid cover.
    let maxReach: number = MICROWAVE.range;
    const wall = this.raycastWorld(origin, this.forwardNorm, MICROWAVE.range);
    if (wall !== null && wall < maxReach) maxReach = wall;

    // Orthonormal basis around the cone axis for subtle cone-width stagger.
    const refUp = Math.abs(this.forwardNorm.y) > 0.92 ? ALT_UP : UP;
    this.right.crossVectors(this.forwardNorm, refUp).normalize();
    this.up.crossVectors(this.right, this.forwardNorm).normalize();

    const coneTan = Math.tan((MICROWAVE.coneDeg * Math.PI) / 180);
    this.shimmerPhase += 1.6180339;

    for (let i = 0; i < SHIMMER_STEPS.length; i++) {
      const step = SHIMMER_STEPS[i]!;
      const d = step[0];
      if (d > maxReach) break;
      const radius = step[1];
      const life = step[2];

      // Subtle deterministic offset inside the narrow cone so the air looks alive and undulating.
      const angle = this.shimmerPhase * (i + 1.3);
      const radial = d * coneTan * 0.35;
      this.scratchPos
        .copy(origin)
        .addScaledVector(this.forwardNorm, d)
        .addScaledVector(this.right, Math.cos(angle) * radial)
        .addScaledVector(this.up, Math.sin(angle) * radial);

      this.ctx.fx.heatShimmer(this.scratchPos, radius, life);
    }
  }

  /** Returns the current normalized microwave heat `0..1` of enemy `uid` (0 if untracked). */
  heatOf(uid: number): number {
    return this.entries.get(uid)?.heat ?? 0;
  }

  /** Restores all swelled enemies, clears all heat state, and stops the magnetron hum loop. */
  reset(): void {
    for (const entry of this.entries.values()) {
      this.restoreSwell(entry);
    }
    this.entries.clear();
    if (this.humLoop) {
      this.humLoop.stop(0.08);
      this.humLoop = null;
    }
    this.humCharge = 0;
    this.lastHumVolume = -1;
    this.lastHumPitch = -1;
    this.shimmerClock = 0;
    this.markerClock = 0;
    this.clock = 0;
  }

  private wallBlocks(origin: THREE.Vector3, dir: THREE.Vector3, dist: number): boolean {
    const hitDist = this.raycastWorld(origin, dir, dist);
    return hitDist !== null && hitDist < dist - 0.35;
  }

  private raycastWorld(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): number | null {
    const physics = this.ctx.physics;
    if (!physics) return null;
    if (typeof physics.raycastInto === 'function') {
      if (physics.raycastInto(origin, dir, maxDist, CG.World, this.rayHit)) {
        return this.rayHit.distance;
      }
      return null;
    }
    const hit = physics.raycast(origin, dir, maxDist, CG.World);
    return hit ? hit.distance : null;
  }

  private updateHum(dt: number, firing: boolean, peakHeat: number): void {
    if (firing) {
      // Hum rises smoothly while emitting and pitches higher as targets approach boiling point.
      const target = clamp(0.45 + peakHeat * 0.55, 0.45, 1);
      this.humCharge = clamp(this.humCharge + dt * 0.72, 0, Math.max(this.humCharge, target));
      const pitch = lerp(0.48, 1.18, Math.max(this.humCharge, peakHeat));
      const volume = lerp(0.32, 0.72, Math.max(this.humCharge, peakHeat));
      if (!this.humLoop || !this.humLoop.alive) {
        this.humLoop = this.ctx.audio?.startLoop?.(MICROWAVE.sounds.humLoop, {
          volume,
          pitch,
          fadeIn: 0.08,
        }) ?? null;
        this.lastHumPitch = pitch;
        this.lastHumVolume = volume;
      } else {
        if (Math.abs(pitch - this.lastHumPitch) > 0.002) {
          this.lastHumPitch = pitch;
          this.humLoop.setPitch(pitch, 0.08);
        }
        if (Math.abs(volume - this.lastHumVolume) > 0.004) {
          this.lastHumVolume = volume;
          this.humLoop.setVolume(volume, 0.08);
        }
      }
    } else {
      this.humCharge = Math.max(0, this.humCharge - dt * 1.4);
      if (this.humLoop) {
        this.humLoop.stop(0.12);
        this.humLoop = null;
        this.lastHumVolume = -1;
        this.lastHumPitch = -1;
      }
    }
  }

  private enterStage1(entry: HeatEntry): void {
    const e = entry.enemy;
    const rt = e as unknown as RuntimeEnemyFields;
    if (!e.isBoss) {
      if (typeof rt.stagger === 'number') rt.stagger = Math.max(rt.stagger, 0.42);
      if (typeof rt.pace === 'number') rt.pace = Math.min(rt.pace, 0.55);
    }
    if (typeof rt.shaken === 'number') rt.shaken = Math.max(rt.shaken, 0.65);
    if (typeof rt.pressure === 'number') rt.pressure = Math.max(rt.pressure, 0.75);

    const chestBone = this.chestBoneOf(e);
    e.char?.anim?.flinch?.(chestBone, entry.lastDir, 0.7, e.center);
    if (!e.isBoss) e.char?.anim?.play?.('stagger', 1);

    this.ctx.audio?.play?.(MICROWAVE.sounds.stage1Pain, { position: e.center, volume: 0.8 });
    this.emitSteam(e, false);
  }

  private enterStage2(entry: HeatEntry): void {
    const e = entry.enemy;
    const rt = e as unknown as RuntimeEnemyFields;

    // Interrupt active attack & drop weapon out of firing readiness.
    if (!e.isBoss) {
      if (typeof rt.attackPhase === 'string') rt.attackPhase = 'idle';
      if ('attack' in rt) rt.attack = null;
      if (rt.attackLoop) {
        rt.attackLoop.stop(0.05);
        rt.attackLoop = null;
      }
      if (typeof rt.stagger === 'number') rt.stagger = Math.max(rt.stagger, MICROWAVE.stage2Stagger);
      if (typeof rt.pace === 'number') rt.pace = Math.min(rt.pace, 0.3);
      if (typeof rt.attackReadyAt === 'number') {
        const now = this.ctx.time?.elapsed ?? 0;
        rt.attackReadyAt = Math.max(rt.attackReadyAt, now + 1.2);
      }
    }
    if (typeof rt.shaken === 'number') rt.shaken = 1;
    if (typeof rt.pressure === 'number') rt.pressure = 1;

    const chestBone = this.chestBoneOf(e);
    e.char?.anim?.flinch?.(chestBone, entry.lastDir, 1.0, e.center);
    e.char?.anim?.play?.('stagger', 1.1);

    this.ctx.audio?.play?.(MICROWAVE.sounds.stage2Scream, { position: e.center, volume: 0.95 });
    this.ctx.audio?.play?.(MICROWAVE.sounds.boilHiss, { position: e.center, volume: 0.85 });
    entry.hissClock = MICROWAVE.hissGap;
    this.emitSteam(e, true);
  }

  private maintainStage2(entry: HeatEntry, dt: number): void {
    const e = entry.enemy;
    const rt = e as unknown as RuntimeEnemyFields;

    // Keep non-boss enemies staggered / unable to shoot while actively microwaved in Stage 2.
    if (entry.heatedThisFrame && !e.isBoss) {
      if (typeof rt.stagger === 'number') rt.stagger = Math.max(rt.stagger, MICROWAVE.stage2Stagger);
      if (typeof rt.attackPhase === 'string') rt.attackPhase = 'idle';
      if ('attack' in rt) rt.attack = null;
      if (typeof rt.shaken === 'number') rt.shaken = 1;
    }

    // Periodic boiling hiss.
    entry.hissClock -= dt;
    if (entry.hissClock <= 0) {
      entry.hissClock = MICROWAVE.hissGap;
      this.ctx.audio?.play?.(MICROWAVE.sounds.boilHiss, { position: e.center, volume: 0.72 });
    }

    // Visible torso/body swell right up to POP, with subtle high-frequency internal pressure tremor.
    const t = clamp((entry.heat - MICROWAVE.stage2) / (MICROWAVE.stage3 - MICROWAVE.stage2), 0, 1);
    const tremor = Math.sin(this.clock * 40 + e.uid * 1.7) * 0.015 * t;
    const sxz = lerp(1, MICROWAVE.maxSwellXZ, t) + tremor;
    const sy = lerp(1, MICROWAVE.maxSwellY, t) + tremor * 0.5;
    if (e.char?.root?.scale) {
      e.char.root.scale.set(sxz, sy, sxz);
      entry.swelled = true;
    }
  }

  private triggerPop(entry: HeatEntry): void {
    const e = entry.enemy;

    // Restore scale BEFORE applying damage/gib so pooled character instances never keep inflated scale.
    this.restoreSwell(entry);

    const amount = e.isBoss
      ? MICROWAVE.bossPopDamage
      : Math.max(e.health + e.maxHealth * 2, MICROWAVE.lethalPopDamage);
    const shouldGib = !e.isBoss || e.health <= amount;

    this.popInfo.amount = amount;
    this.popInfo.type = 'true';
    this.popInfo.point.copy(e.center);
    this.popInfo.dir.copy(entry.lastDir.lengthSq() > 1e-4 ? entry.lastDir : this.forwardNorm);
    this.popInfo.force = 115;
    this.popInfo.source = 'autoclave';
    this.popInfo.region = 'chest';
    this.popInfo.gib = shouldGib;
    this.popInfo.pierces = true;
    this.popInfo.armorPiercing = true;

    const result = this.ctx.enemies.applyDamage(e, this.popInfo);

    // Violent steam burst + red mist + wet internal pop audio.
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + e.uid;
      this.scratchPos.set(
        e.center.x + Math.cos(a) * 0.32,
        e.center.y + 0.1 + (i % 2) * 0.25,
        e.center.z + Math.sin(a) * 0.32,
      );
      this.ctx.fx?.smoke?.(this.scratchPos, 0xf2f6fa, 0.95, 1.15);
    }
    this.ctx.fx?.bloodMist?.(e.center, 1.9);

    this.ctx.audio?.play?.(MICROWAVE.sounds.pop, { position: e.center, volume: 1.0 });
    this.ctx.audio?.play?.(MICROWAVE.sounds.popWet, { position: e.center, volume: 0.9 });
    this.ctx.camera?.addTrauma?.(0.14);

    if (result && toldKill(result)) {
      this.ctx.hud?.hitMarker?.('kill');
    } else {
      this.ctx.hud?.hitMarker?.('head');
    }
  }

  private emitSteam(enemy: EnemyInstance, heavy: boolean): void {
    const jitter = Math.sin(this.clock * 19 + enemy.uid * 3.1) * 0.18;
    const jitterZ = Math.cos(this.clock * 23 + enemy.uid * 2.3) * 0.18;
    this.scratchPos.set(
      enemy.center.x + jitter,
      enemy.center.y + (heavy ? 0.22 : 0.16),
      enemy.center.z + jitterZ,
    );
    this.ctx.fx?.smoke?.(this.scratchPos, 0xeef4f8, heavy ? 0.72 : 0.44, heavy ? 1.05 : 0.78);
    this.ctx.fx?.smokeWisp?.(this.scratchPos, heavy ? 0.55 : 0.32, heavy ? 0.85 : 0.5);
  }

  private restoreSwell(entry: HeatEntry): void {
    if (!entry.swelled) return;
    entry.enemy.char?.root?.scale?.set(1, 1, 1);
    entry.swelled = false;
  }

  private chestBoneOf(enemy: EnemyInstance): number {
    const bones = enemy.char?.rig?.bones;
    if (!bones || bones.length === 0) return 0;
    const idx = bones.findIndex((b) => b.region === 'chest');
    return idx >= 0 ? idx : Math.min(2, bones.length - 1);
  }
}
