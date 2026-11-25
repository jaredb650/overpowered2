/**
 * Plasma Energy Sword arm weapon plug-in (`src/frame/arms/sword.ts`).
 *
 *   - Tap / quick press (< 0.45 s): 3-hit directional melee combo:
 *       1) Wide horizontal right-to-left slash (150° arc / 8.5 m reach / 340 dmg)
 *       2) Reverse diagonal rising slash (150° arc / 8.5 m reach / 380 dmg)
 *       3) Heavy overhead finisher (170° arc / 9.0 m reach / 520 dmg + shockwave)
 *     Each slash triggers a forward melee-booster lunge (`u.lungeImpulse?.(fwd, 26, 0.22)`), swings the 3D arm
 *     via `u.arm.setPose`, ignites the 5.2 m blade via `u.arm.setActive(1)`, and passes `slicePlaneNormal` +
 *     `severMult: 3.0` (capped at 4 slices per swing to protect frame rate).
 *   - Hold (>= 0.45 s) & Release: switches based on tap `1`/`2` mode:
 *       - `CLEAVE` (default): launches a piercing crescent plasma energy wave (28 m range, 4.5 m wide,
 *         420 * energyMult dmg, slices enemies in its line with glowing cyan/gold crescent FX).
 *       - `IMPALE`: high-speed 18 m forward jet-lunge stab (`u.lungeImpulse?.(fwd, 46, 0.32)`) piercing
 *         everything in its corridor for `640 * energyMult` dmg.
 */
import * as THREE from 'three';
import { CG, type Ctx, type DamageInfo, type LoopHandle, type PlayOptions, type RayHit } from '../../core/contracts';
import type { EnemyInstance } from '../../core/gameplay';
import { clamp, rand } from '../../core/math';
import type { MechKind } from '../../progression/callins/link';
import type { GunnerWeapon } from '../../vehicles/hud';
import type { ArmPlugin, ArmUpdateContext, FrameArmGun } from './types';

export type SwordMode = 'CLEAVE' | 'IMPALE';

const DEG = Math.PI / 180;

export interface ComboStepSpec {
  readonly index: 0 | 1 | 2;
  readonly damage: number;
  readonly reach: number;
  readonly arc: number;
  readonly force: number;
  readonly lungeSpeed: number;
  readonly lungeDuration: number;
  readonly recovery: number;
  readonly shockwave: boolean;
}

export const PLASMA_SWORD = {
  /** Hold duration in seconds before release triggers the charged stance attack. */
  holdThreshold: 0.45,
  /** Cadence between combo hits 1->2 and 2->3 (seconds). */
  comboCadence: 0.38,
  /** Recovery window after the 3rd heavy finisher hit (seconds). */
  finisherRecovery: 0.85,
  /** Idle duration before combo index resets to hit 1 (seconds). */
  comboResetWindow: 1.4,
  /** Cap plane-slice gore kills per swing to protect frame rate. */
  maxSlicesPerSwing: 4,
  /** Limb-sever multiplier on all plasma sword hits. */
  severMult: 3.0,
  /** Heat gauge maximum (0..100). */
  maxHeat: 100,
  comboHeat: 10,
  cleaveHeat: 45,
  impaleHeat: 55,
  coolRate: 24,
  overheatUnlock: 45,
  combo: [
    {
      index: 0,
      damage: 340,
      reach: 8.5,
      arc: 150 * DEG,
      force: 110,
      lungeSpeed: 26,
      lungeDuration: 0.22,
      recovery: 0.38,
      shockwave: false,
    },
    {
      index: 1,
      damage: 380,
      reach: 8.5,
      arc: 150 * DEG,
      force: 125,
      lungeSpeed: 26,
      lungeDuration: 0.22,
      recovery: 0.38,
      shockwave: false,
    },
    {
      index: 2,
      damage: 520,
      reach: 9.0,
      arc: 170 * DEG,
      force: 175,
      lungeSpeed: 28,
      lungeDuration: 0.24,
      recovery: 0.85,
      shockwave: true,
    },
  ] as readonly [ComboStepSpec, ComboStepSpec, ComboStepSpec],
  cleave: {
    range: 28,
    width: 4.5,
    speed: 48,
    damage: 420,
    force: 145,
  },
  impale: {
    range: 18,
    corridorHalfWidth: 2.2,
    damage: 640,
    force: 210,
    lungeSpeed: 46,
    lungeDuration: 0.32,
  },
} as const;

interface PlasmaWave {
  active: boolean;
  readonly pos: THREE.Vector3;
  readonly prev: THREE.Vector3;
  readonly dir: THREE.Vector3;
  readonly right: THREE.Vector3;
  travelled: number;
  damage: number;
  slicesLeft: number;
  fxAccum: number;
  readonly struck: Set<number>;
}

const MAX_WAVES = 4;
const UP = new THREE.Vector3(0, 1, 0);

// Scratch vectors & structures (zero per-frame allocations).
const _origin = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _upLocal = new THREE.Vector3();
const _to = new THREE.Vector3();
const _planeNormal = new THREE.Vector3();
const _startDir = new THREE.Vector3();
const _at = new THREE.Vector3();
const _enemies: EnemyInstance[] = [];
const _play: PlayOptions = {};
const _rayHit: RayHit = {
  point: new THREE.Vector3(),
  normal: new THREE.Vector3(),
  distance: 0,
  surface: 'concrete',
  collider: null,
};

function flatForward(aim: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  out.set(aim.x, 0, aim.z);
  if (out.lengthSq() < 1e-5) out.set(0, 0, -1);
  return out.normalize();
}

export class SwordArmGun implements FrameArmGun {
  readonly kind = 'sword' as const;
  mode: SwordMode = 'CLEAVE';
  /** Current combo step ready to fire next (`0`, `1`, or `2`). */
  comboStep: 0 | 1 | 2 = 0;
  /** Heat gauge `0..100`. */
  heatValue = 0;
  overheated = false;

  private holding = false;
  private holdTime = 0;
  private cooldown = 0;
  private comboResetTimer = 0;
  private swingAnim = 0;
  private swingDuration = 0.32;
  private lastSwingKind: 0 | 1 | 2 | 3 = 0; // 0..2 combo, 3 impale
  private chargeLoop: LoopHandle | null = null;
  private chargeNotified = false;

  private readonly waves: PlasmaWave[] = Array.from({ length: MAX_WAVES }, () => ({
    active: false,
    pos: new THREE.Vector3(),
    prev: new THREE.Vector3(),
    dir: new THREE.Vector3(),
    right: new THREE.Vector3(),
    travelled: 0,
    damage: PLASMA_SWORD.cleave.damage,
    slicesLeft: PLASMA_SWORD.maxSlicesPerSwing,
    fxAccum: 0,
    struck: new Set<number>(),
  }));

  constructor(private readonly ctx: Ctx) {}

  get firing(): boolean {
    return this.swingAnim > 0 || (this.holding && this.holdTime >= PLASMA_SWORD.holdThreshold);
  }

  /** Normalized heat/charge bar `0..1` for the crosshair meter. */
  get heat(): number {
    if (this.holding && this.holdTime > 0.05 && !this.overheated) {
      return Math.max(clamp(this.heatValue / PLASMA_SWORD.maxHeat), clamp(this.holdTime / PLASMA_SWORD.holdThreshold));
    }
    return clamp(this.heatValue / PLASMA_SWORD.maxHeat);
  }

  /** Number of active flying Wave Cleave crescents (diagnostics/tests). */
  get activeWaves(): number {
    let n = 0;
    for (let i = 0; i < this.waves.length; i++) if (this.waves[i]!.active) n++;
    return n;
  }

  update(dt: number, u: ArmUpdateContext): void {
    const { audio } = this.ctx;
    const energyMult = u.energyMult ?? 1;

    this.stepWaves(dt);

    // Mode toggle (tap 1 left / 2 right): CLEAVE <-> IMPALE.
    if (u.cyclePressed) {
      this.mode = this.mode === 'CLEAVE' ? 'IMPALE' : 'CLEAVE';
      audio.play('reload_bolt', { pitch: this.mode === 'IMPALE' ? 1.18 : 0.92, volume: 0.82 });
      this.ctx.hud?.callout?.(
        this.mode === 'IMPALE' ? 'PLASMA SWORD // IMPALE LUNGE' : 'PLASMA SWORD // WAVE CLEAVE',
      );
    }

    // Cooldown & combo-reset decay.
    if (this.cooldown > 0) this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.comboResetTimer > 0) {
      this.comboResetTimer -= dt;
      if (this.comboResetTimer <= 0) this.comboStep = 0;
    }
    if (this.swingAnim > 0) {
      this.swingAnim = Math.max(0, this.swingAnim - dt);
    }

    // Cool down heat when not actively holding a charge.
    const charging = this.holding && this.holdTime >= PLASMA_SWORD.holdThreshold && !this.overheated;
    if (!charging && this.heatValue > 0) {
      this.heatValue = Math.max(0, this.heatValue - PLASMA_SWORD.coolRate * energyMult * dt);
      if (this.overheated && this.heatValue <= PLASMA_SWORD.overheatUnlock) {
        this.overheated = false;
      }
    }

    // Handle trigger press / hold / release.
    if (this.overheated) {
      this.holding = false;
      this.holdTime = 0;
      this.stopChargeAudio();
      if (u.pressed) audio.play('weapon_dry', { pitch: 0.75 });
    } else {
      if (u.pressed && !this.holding) {
        this.holding = true;
        this.holdTime = 0;
        this.chargeNotified = false;
      }

      if (this.holding && u.held) {
        this.holdTime += dt;
        if (this.holdTime >= PLASMA_SWORD.holdThreshold && !this.chargeNotified) {
          this.chargeNotified = true;
          audio.play('railgun_ready', { pitch: this.mode === 'IMPALE' ? 1.12 : 0.96, volume: 0.85 });
          this.startChargeAudio();
        }
      } else if (this.holding && !u.held) {
        const heldFor = this.holdTime;
        this.holding = false;
        this.holdTime = 0;
        this.chargeNotified = false;
        this.stopChargeAudio();

        if (heldFor >= PLASMA_SWORD.holdThreshold) {
          if (this.cooldown <= 0) {
            if (this.mode === 'IMPALE') this.executeImpale(u, energyMult);
            else this.executeWaveCleave(u, energyMult);
          }
        } else if (this.cooldown <= 0) {
          this.executeComboSlash(u, energyMult);
        }
      }
    }

    this.poseArm(u);
  }

  idleUpdate(dt: number): void {
    this.stepWaves(dt);
    if (this.cooldown > 0) this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.swingAnim > 0) this.swingAnim = Math.max(0, this.swingAnim - dt);
    if (this.heatValue > 0) {
      this.heatValue = Math.max(0, this.heatValue - PLASMA_SWORD.coolRate * dt);
      if (this.overheated && this.heatValue <= PLASMA_SWORD.overheatUnlock) {
        this.overheated = false;
      }
    }
  }

  fillRow(row: GunnerWeapon, button: string, cycleKey: string): void {
    const tag = this.overheated
      ? 'VENTING'
      : this.holding && this.holdTime >= PLASMA_SWORD.holdThreshold
        ? `${this.mode} CHARGED`
        : this.mode;
    row.name = `${button} PLASMA SWORD [${tag}] // ${cycleKey}`;
    row.ammo = Math.round(PLASMA_SWORD.maxHeat - this.heatValue);
    row.max = PLASMA_SWORD.maxHeat;
    row.reload = this.overheated ? clamp(1 - this.heatValue / PLASMA_SWORD.maxHeat) : -1;
    row.selected = this.firing;
  }

  silence(): void {
    this.stopChargeAudio();
  }

  reset(): void {
    this.silence();
    this.mode = 'CLEAVE';
    this.comboStep = 0;
    this.heatValue = 0;
    this.overheated = false;
    this.holding = false;
    this.holdTime = 0;
    this.cooldown = 0;
    this.comboResetTimer = 0;
    this.swingAnim = 0;
    this.chargeNotified = false;
    for (let i = 0; i < this.waves.length; i++) {
      this.waves[i]!.active = false;
      this.waves[i]!.struck.clear();
    }
  }

  private addHeat(amount: number): void {
    this.heatValue = Math.min(PLASMA_SWORD.maxHeat, this.heatValue + amount);
    if (this.heatValue >= PLASMA_SWORD.maxHeat) {
      this.overheated = true;
      this.ctx.audio?.play?.('steam_burst', { volume: 0.85, pitch: 0.92 });
      this.ctx.hud?.callout?.('PLASMA SWORD OVERHEATED');
    }
  }

  private executeComboSlash(u: ArmUpdateContext, energyMult: number): void {
    const step = PLASMA_SWORD.combo[this.comboStep]!;
    const { audio, camera, enemies, fx, hud, physics, world, render, combat } = this.ctx;

    this.resolveOrigin(u, _origin);
    flatForward(u.sight.aim, _fwd);
    _right.set(-_fwd.z, 0, _fwd.x).normalize();

    // Forward melee booster lunge into the slash.
    u.lungeImpulse?.(_fwd.clone(), step.lungeSpeed, step.lungeDuration);

    // Compute cut plane normal per combo step for directional Gore plane-slicing.
    const sideSign = u.side === 'left' ? 1 : -1;
    if (step.index === 0) {
      // Wide horizontal slash.
      _planeNormal.copy(UP);
      _startDir.copy(_right).multiplyScalar(sideSign);
    } else if (step.index === 1) {
      // Reverse diagonal rising slash.
      _planeNormal.copy(_right).multiplyScalar(0.55 * sideSign).addScaledVector(UP, 0.835).normalize();
      _startDir.copy(_right).multiplyScalar(-sideSign);
    } else {
      // Heavy overhead / vertical cleave finisher.
      _planeNormal.copy(_right).normalize();
      _startDir.copy(UP);
    }

    const damage = Math.round(step.damage * energyMult);
    const cosHalf = Math.cos(step.arc * 0.5);
    const count = Math.min(enemies?.query?.(_origin, step.reach + 2.5, _enemies) || 0, _enemies.length);
    let slicesLeft = PLASMA_SWORD.maxSlicesPerSwing;
    let struck = 0;

    for (let i = 0; i < count; i++) {
      const e = _enemies[i]!;
      if (!e.alive) continue;
      _to.subVectors(e.center, _origin);
      const dist = _to.length();
      if (dist > step.reach + 1.0) continue;
      if (dist > 1.8) {
        const horizLen = Math.hypot(_to.x, _to.z) || 1;
        const dot = (_to.x * _fwd.x + _to.z * _fwd.z) / horizLen;
        if (dot < cosHalf) continue;
      }

      const sliceNormal = slicesLeft > 0 ? _planeNormal.clone() : undefined;
      const dmg: DamageInfo = {
        amount: damage,
        type: 'slash',
        point: e.center.clone(),
        dir: _fwd.clone().setY(0.28).normalize(),
        force: step.force,
        source: step.index === 2 ? 'frame_sword_finisher' : 'frame_sword',
        region: 'chest',
        severMult: PLASMA_SWORD.severMult,
        armorPiercing: true,
        slicePlaneNormal: sliceNormal,
      };
      const res = enemies.applyDamage(e, dmg);
      struck++;
      if (sliceNormal && res?.killed) slicesLeft--;
      fx?.sparks?.(e.center, _fwd, 10, '#66eeff');
    }
    _enemies.length = 0;

    if (struck > 0) hud?.hitMarker?.('body');

    // Damage vehicles, map explosives, and bat enemy grenades in the slash arc.
    _at.copy(_origin).addScaledVector(_fwd, step.reach * 0.55);
    world?.objects?.damageExplosivesInRadius?.(_at, step.reach * 0.65, damage, 'frame_sword');
    enemies?.vehicles?.frameBlow?.(_at, step.reach * 0.65, damage, _fwd, 'frame_sword');
    combat?.batGrenade?.(_origin, _fwd, step.reach);

    // Visual crescent FX + finisher shockwave.
    fx?.slash?.(
      _origin,
      _planeNormal,
      _startDir,
      step.arc,
      step.reach,
      step.index === 2 ? 'finisher' : step.index === 1 ? 'heavy' : 'sweep',
    );
    fx?.sparks?.(_at, _fwd, step.shockwave ? 32 : 16, step.shockwave ? '#ffdd77' : '#55eeff');
    render?.lights?.flash?.(_at, step.shockwave ? 0xffcc55 : 0x55eeff, 12, 14, 0.16);

    if (step.shockwave) {
      fx?.ring?.(_at, UP, '#66f0ff', step.reach * 1.1);
      fx?.slam?.(_at, 1.8);
      physics?.radialImpulse?.(_at, step.reach, step.force);
      audio?.play?.('slam_impact', { volume: 0.85, pitch: 0.92 });
    }

    audio?.play?.('sword_swing', { pitch: 0.72 - step.index * 0.08, volume: 0.95 });
    audio?.play?.('railgun_beam', { pitch: 1.35 - step.index * 0.12, volume: 0.45 });

    if (u.recoilMult > 0) {
      camera?.addTrauma?.((step.shockwave ? 0.36 : 0.18) * u.recoilMult);
      camera?.kick?.(0.014 * u.recoilMult, (step.index === 1 ? -0.022 : 0.022) * sideSign * u.recoilMult);
    }

    // Advance 3-hit combo state & animation.
    this.lastSwingKind = step.index;
    this.swingDuration = step.index === 2 ? 0.46 : 0.30;
    this.swingAnim = this.swingDuration;
    this.cooldown = step.recovery;
    this.comboStep = ((this.comboStep + 1) % 3) as 0 | 1 | 2;
    this.comboResetTimer = PLASMA_SWORD.comboResetWindow;
    this.addHeat(PLASMA_SWORD.comboHeat);

    u.onNews?.('sword', [step.index, _origin.x, _origin.y, _origin.z, _fwd.x, _fwd.y, _fwd.z]);
  }

  private executeWaveCleave(u: ArmUpdateContext, energyMult: number): void {
    const { audio, camera, fx, render } = this.ctx;

    this.resolveOrigin(u, _origin);
    _fwd.copy(u.sight.aim);
    if (_fwd.lengthSq() < 1e-6) _fwd.set(0, 0, -1);
    _fwd.normalize();
    _right.crossVectors(_fwd, UP);
    if (_right.lengthSq() < 1e-6) _right.set(1, 0, 0);
    _right.normalize();

    let slot: PlasmaWave | null = null;
    for (let i = 0; i < this.waves.length; i++) {
      if (!this.waves[i]!.active) {
        slot = this.waves[i]!;
        break;
      }
    }
    slot ??= this.waves[0]!;
    slot.active = true;
    slot.pos.copy(_origin).addScaledVector(_fwd, 1.8);
    slot.prev.copy(slot.pos);
    slot.dir.copy(_fwd);
    slot.right.copy(_right);
    slot.travelled = 0;
    slot.damage = Math.round(PLASMA_SWORD.cleave.damage * energyMult);
    slot.slicesLeft = PLASMA_SWORD.maxSlicesPerSwing;
    slot.fxAccum = 0;
    slot.struck.clear();

    fx?.slash?.(slot.pos, UP, _right, 2.2, PLASMA_SWORD.cleave.width, 'wave');
    fx?.ring?.(slot.pos, _fwd, '#66f2ff', PLASMA_SWORD.cleave.width);
    render?.lights?.flash?.(slot.pos, 0x66f2ff, 14, 16, 0.22);
    audio?.play?.('railgun_fire', { pitch: 1.25, volume: 0.9 });
    audio?.play?.('sword_swing', { pitch: 0.56, volume: 1.0 });

    if (u.recoilMult > 0) {
      camera?.addTrauma?.(0.32 * u.recoilMult);
      camera?.kick?.(0.022 * u.recoilMult, rand(-0.008, 0.008) * u.recoilMult);
    }

    this.lastSwingKind = 0;
    this.swingDuration = 0.36;
    this.swingAnim = this.swingDuration;
    this.cooldown = PLASMA_SWORD.comboCadence;
    this.comboStep = 0;
    this.addHeat(PLASMA_SWORD.cleaveHeat);

    u.onNews?.('sword', [10, slot.pos.x, slot.pos.y, slot.pos.z, _fwd.x, _fwd.y, _fwd.z]);
  }

  private executeImpale(u: ArmUpdateContext, energyMult: number): void {
    const { audio, camera, enemies, fx, hud, physics, world, render } = this.ctx;
    const I = PLASMA_SWORD.impale;

    this.resolveOrigin(u, _origin);
    flatForward(u.sight.aim, _fwd);
    _right.set(-_fwd.z, 0, _fwd.x).normalize();

    // High-speed 18 m forward jet-lunge stab.
    u.lungeImpulse?.(_fwd.clone(), I.lungeSpeed, I.lungeDuration);

    // Respect solid walls along the 18 m impale corridor.
    let maxReach: number = I.range;
    if (physics?.raycastInto && physics.raycastInto(_origin, _fwd, I.range, CG.World, _rayHit)) {
      maxReach = Math.max(2.0, _rayHit.distance);
    } else if (physics?.raycast) {
      const hit = physics.raycast(_origin, _fwd, I.range, CG.World);
      if (hit) maxReach = Math.max(2.0, hit.distance);
    }

    const damage = Math.round(I.damage * energyMult);
    const halfW2 = I.corridorHalfWidth * I.corridorHalfWidth;
    _at.copy(_origin).addScaledVector(_fwd, maxReach * 0.5);
    const count = Math.min(enemies?.query?.(_at, maxReach * 0.5 + I.corridorHalfWidth + 2, _enemies) || 0, _enemies.length);
    let slicesLeft = PLASMA_SWORD.maxSlicesPerSwing;
    let struck = 0;

    for (let i = 0; i < count; i++) {
      const e = _enemies[i]!;
      if (!e.alive) continue;
      const dx = e.center.x - _origin.x;
      const dy = e.center.y - _origin.y;
      const dz = e.center.z - _origin.z;
      const proj = dx * _fwd.x + dy * _fwd.y + dz * _fwd.z;
      if (proj < -0.5 || proj > maxReach + 1.0) continue;
      const px = dx - _fwd.x * proj;
      const py = dy - _fwd.y * proj;
      const pz = dz - _fwd.z * proj;
      if (px * px + py * py + pz * pz > halfW2) continue;

      const sliceNormal = slicesLeft > 0 ? _right.clone() : undefined;
      const dmg: DamageInfo = {
        amount: damage,
        type: 'slash',
        point: e.center.clone(),
        dir: _fwd.clone().setY(0.22).normalize(),
        force: I.force,
        source: 'frame_sword_impale',
        region: 'chest',
        severMult: PLASMA_SWORD.severMult,
        armorPiercing: true,
        pierces: true,
        slicePlaneNormal: sliceNormal,
      };
      const res = enemies.applyDamage(e, dmg);
      struck++;
      if (sliceNormal && res?.killed) slicesLeft--;
      fx?.sparks?.(e.center, _fwd, 14, '#ffbb44');
    }
    _enemies.length = 0;

    if (struck > 0) hud?.hitMarker?.('body');

    const endPt = _at.copy(_origin).addScaledVector(_fwd, maxReach);
    world?.objects?.damageExplosivesInRadius?.(endPt, 4.5, damage, 'frame_sword_impale');
    enemies?.vehicles?.frameBlow?.(endPt, 4.5, damage, _fwd, 'frame_sword_impale');
    physics?.radialImpulse?.(endPt, 5.5, I.force);

    fx?.beam?.(_origin, endPt, 'lance', 0.48, 0.24);
    fx?.dashStreaks?.(_origin, _fwd);
    fx?.ring?.(endPt, _fwd, '#ffbb44', 4.6);
    fx?.sparks?.(endPt, _fwd, 32, '#ffdd77');
    render?.lights?.flash?.(endPt, 0xffaa38, 16, 16, 0.24);
    render?.post?.radialBlur?.(0.35, 0.24);

    audio?.play?.('dash', { pitch: 0.72, volume: 1.0 });
    audio?.play?.('railgun_fire', { pitch: 0.92, volume: 0.95 });
    audio?.play?.('slam_impact', { pitch: 0.85, volume: 0.8 });

    if (u.recoilMult > 0) {
      camera?.addTrauma?.(0.45 * u.recoilMult);
      camera?.fovPunch?.(6 * u.recoilMult, 0.28);
    }

    this.lastSwingKind = 3;
    this.swingDuration = 0.38;
    this.swingAnim = this.swingDuration;
    this.cooldown = PLASMA_SWORD.finisherRecovery;
    this.comboStep = 0;
    this.addHeat(PLASMA_SWORD.impaleHeat);

    u.onNews?.('sword', [11, _origin.x, _origin.y, _origin.z, endPt.x, endPt.y, endPt.z]);
  }

  private stepWaves(dt: number): void {
    if (dt <= 0) return;
    const { physics, enemies, fx, hud, world, render } = this.ctx;
    const C = PLASMA_SWORD.cleave;
    const halfW = C.width * 0.5;
    const halfW2 = halfW * halfW;

    for (let i = 0; i < this.waves.length; i++) {
      const w = this.waves[i]!;
      if (!w.active) continue;

      const stepDist = Math.min(C.speed * dt, C.range - w.travelled);
      if (stepDist <= 1e-5) {
        w.active = false;
        continue;
      }

      w.prev.copy(w.pos);
      let actualDist = stepDist;
      let hitWall = false;
      if (physics?.raycastInto && physics.raycastInto(w.prev, w.dir, stepDist, CG.World, _rayHit)) {
        actualDist = _rayHit.distance;
        hitWall = true;
      } else if (physics?.raycast) {
        const hit = physics.raycast(w.prev, w.dir, stepDist, CG.World);
        if (hit) {
          actualDist = hit.distance;
          hitWall = true;
        }
      }

      w.pos.copy(w.prev).addScaledVector(w.dir, actualDist);
      w.travelled += actualDist;

      // Slice every enemy intersecting the 4.5 m wide crescent wave segment.
      const count = Math.min(enemies?.query?.(w.pos, halfW + actualDist + 2, _enemies) || 0, _enemies.length);
      let hitAny = false;
      for (let k = 0; k < count; k++) {
        const e = _enemies[k]!;
        if (!e.alive || w.struck.has(e.uid)) continue;
        const dx = e.center.x - w.prev.x;
        const dy = e.center.y - w.prev.y;
        const dz = e.center.z - w.prev.z;
        const proj = clamp(dx * w.dir.x + dy * w.dir.y + dz * w.dir.z, 0, actualDist);
        const px = dx - w.dir.x * proj;
        const py = dy - w.dir.y * proj;
        const pz = dz - w.dir.z * proj;
        // Generous vertical envelope (2.4 m) + 4.5 m wide horizontal crescent.
        const horizDist2 = px * px + pz * pz;
        if (horizDist2 > halfW2 || Math.abs(py) > 2.4) continue;

        w.struck.add(e.uid);
        const sliceNormal = w.slicesLeft > 0 ? UP.clone() : undefined;
        const dmg: DamageInfo = {
          amount: w.damage,
          type: 'slash',
          point: e.center.clone(),
          dir: w.dir.clone().setY(0.25).normalize(),
          force: C.force,
          source: 'frame_sword_wave',
          region: 'chest',
          severMult: PLASMA_SWORD.severMult,
          armorPiercing: true,
          slicePlaneNormal: sliceNormal,
        };
        const res = enemies.applyDamage(e, dmg);
        hitAny = true;
        if (sliceNormal && res?.killed) w.slicesLeft--;
        fx?.sparks?.(e.center, w.dir, 10, '#66eeff');
      }
      _enemies.length = 0;
      if (hitAny) hud?.hitMarker?.('body');

      world?.objects?.damageExplosivesInRadius?.(w.pos, halfW, w.damage * 0.5, 'frame_sword_wave');
      enemies?.vehicles?.frameBlow?.(w.pos, halfW, w.damage, w.dir, 'frame_sword_wave');

      w.fxAccum += dt;
      if (w.fxAccum >= 0.04) {
        w.fxAccum = 0;
        fx?.slash?.(w.pos, UP, w.right, 1.9, halfW, 'wave');
        fx?.sparks?.(w.pos, w.dir, 4, '#88f4ff');
        render?.lights?.flash?.(w.pos, 0x55e8ff, 8, 10, 0.08);
      }

      if (hitWall || w.travelled >= C.range - 1e-3) {
        fx?.ring?.(w.pos, w.dir, '#66eeff', 3.4);
        fx?.sparks?.(w.pos, w.dir, 16, '#88f4ff');
        w.active = false;
      }
    }
  }

  private poseArm(u: ArmUpdateContext): void {
    const sideSign = u.side === 'left' ? 1 : -1;
    const modeNum = this.mode === 'IMPALE' ? 1 : 0;

    if (this.swingAnim > 0) {
      const t = 1 - clamp(this.swingAnim / Math.max(0.05, this.swingDuration));
      if (this.lastSwingKind === 0) {
        // Wide horizontal right-to-left sweep across screen.
        const yaw = (-0.85 + 1.8 * t) * sideSign;
        u.arm.setPose?.(yaw, -0.05, -0.95 * sideSign, -0.45 * Math.sin(t * Math.PI));
      } else if (this.lastSwingKind === 1) {
        // Reverse diagonal rising slash.
        const yaw = (0.9 - 1.75 * t) * sideSign;
        const pitch = -0.32 + 0.78 * t;
        u.arm.setPose?.(yaw, pitch, 0.7 * sideSign, -0.5 * Math.sin(t * Math.PI));
      } else if (this.lastSwingKind === 2) {
        // Heavy overhead cleave finisher.
        const pitch = 0.88 - 1.52 * t;
        u.arm.setPose?.(0.1 * sideSign, pitch, 0.12 * sideSign, -0.7 * Math.sin(t * Math.PI));
      } else {
        // Impale straight-ahead lance thrust.
        u.arm.setPose?.(0, 0, 0, -1.25 * (1 - t * 0.4));
      }
      u.arm.setActive?.(1, modeNum);
      return;
    }

    if (this.holding && !this.overheated) {
      const chargeProg = clamp(this.holdTime / PLASMA_SWORD.holdThreshold);
      u.arm.setPose?.(0.42 * sideSign * chargeProg, 0.24 * chargeProg, 0.45 * sideSign * chargeProg, 0.28 * chargeProg);
      u.arm.setActive?.(0.35 + chargeProg * 0.65, modeNum);
      return;
    }

    // Idle pilot flame hum.
    u.arm.setPose?.(0, 0, 0, 0);
    u.arm.setActive?.(this.overheated ? 0.12 : 0.15, modeNum);
  }

  private resolveOrigin(u: ArmUpdateContext, out: THREE.Vector3): THREE.Vector3 {
    if (u.feet) {
      return out.set(u.feet.x, u.feet.y + 2.4, u.feet.z);
    }
    return out.copy(u.sight.view.position);
  }

  private startChargeAudio(): void {
    if (this.chargeLoop) return;
    this.chargeLoop = this.ctx.audio?.startLoop?.('railgun_charge_loop', { pitch: 0.95, volume: 0.35 }) ?? null;
  }

  private stopChargeAudio(): void {
    if (!this.chargeLoop) return;
    this.chargeLoop.stop(0.06);
    this.chargeLoop = null;
  }
}

export const SWORD_PLUGIN: ArmPlugin = {
  kind: 'sword',
  newsKinds: ['sword'],
  create: ctx => new SwordArmGun(ctx),
  remoteNews(ctx: Ctx, kind: MechKind, values: number[]): void {
    if (kind !== 'sword' || values.length < 7) return;
    const tag = values[0]!;
    _origin.set(values[1]!, values[2]!, values[3]!);
    _fwd.set(values[4]!, values[5]!, values[6]!);
    _play.position = _origin;
    _play.volume = 0.85;
    if (tag === 11) {
      ctx.fx?.beam?.(_origin, _fwd, 'lance', 0.45, 0.22);
      ctx.audio?.play?.('railgun_fire', _play);
    } else if (tag === 10) {
      _right.crossVectors(_fwd, UP).normalize();
      ctx.fx?.slash?.(_origin, UP, _right, 2.2, PLASMA_SWORD.cleave.width, 'wave');
      ctx.audio?.play?.('railgun_fire', _play);
    } else {
      _upLocal.copy(UP);
      _right.set(-_fwd.z, 0, _fwd.x).normalize();
      ctx.fx?.slash?.(_origin, _upLocal, _right, 2.6, 8.5, tag >= 2 ? 'finisher' : 'sweep');
      ctx.audio?.play?.('sword_swing', _play);
    }
  },
};
