/**
 * Red Beam arm weapon plug-in (`src/frame/arms/beam.ts`).
 *
 * Hold LMB (left arm) or RMB (right arm) for 1.6 s to charge the heavy crimson emitter:
 *   - Visible red glow builds at the muzzle, charge hum climbs in pitch, walk speed slows to 60%.
 *   - Early release before full charge fires nothing and retains half the accumulated charge for 2.0 s
 *     (decays smoothly after 2.0 s if not resumed).
 *   - Release at full charge fires a continuous 1.0 s, 1.4 m thick red beam out to 180 m, piercing up to
 *     3 walls (stopping on the 4th wall or terrain thicker than 3 m).
 *   - Vaporizes regular enemies touched by the core beam (`vaporize: true` -> `Gore.vaporize`), sets fire
 *     to survivors near the ~2.4 m outer beam edge (`enemies.afflict(..., 'burn', ...)`), and deals 900
 *     damage to bosses via `bossHit` (once per boss per beam fire).
 *   - 9.0 s cooldown after the 1.0 s beam ends.
 *   - Emits `u.onNews?.('beam', [mx, my, mz, ex, ey, ez, 1.0])` on fire so co-op teammates render the full
 *     1.0 s thick red beam via `remoteNews`.
 */
import * as THREE from 'three';
import { CG, type Ctx, type DamageInfo, type LoopHandle, type PlayOptions } from '../../core/contracts';
import type { DamageResult, EnemyInstance } from '../../core/gameplay';
import { clamp, rand } from '../../core/math';
import {
  acquireRedBeamSlot,
  emitRedBeamChargeFx,
  emitRedBeamLightsAndShimmer,
  emitRedBeamWallPierce,
  hideRedBeamSlot,
  poseRedBeamChargeOrb,
  poseRedBeamSlot,
  RED_BEAM_RADIUS,
  redBeamGirth,
  redBeamPower,
  releaseRedBeamSlot,
  spawnTimedRedBeam,
  type RedBeamSlot,
} from '../../fx/recipes/redBeam';
import type { MechKind } from '../../progression/callins/link';
import type { GunnerWeapon } from '../../vehicles/hud';
import type { Combat } from '../../weapons/Combat';
import { bossHit, PENETRATION } from '../../weapons/data';
import { wallExit, type Raycaster } from '../../weapons/penetration';
import type { Arm, ArmPlugin, ArmRemoteState, ArmUpdateContext, FrameArmGun } from './types';

export const RED_BEAM = {
  /** Hold time to reach full charge (seconds). */
  chargeTime: 1.6,
  /** Early release retains half of accumulated charge for this many seconds before decaying. */
  holdHalfDuration: 2.0,
  /** Charge decay rate per second once the 2.0 s retention window expires. */
  decayRate: 1.25,
  /** Continuous firing beam duration (seconds). */
  duration: 1.0,
  /** Cooldown duration after the 1.0 s beam ends (seconds). */
  cooldown: 9.0,
  /** Beam radius in metres (1.4 m diameter). */
  radius: RED_BEAM_RADIUS,
  /** Additional torso half-width allowance for core beam vaporization (matches Lance beam). */
  bodyAllowance: 0.35,
  /** Outer radiant scorch radius where survivors are set on fire (metres). */
  edgeScorchRadius: 2.4,
  /** Maximum beam reach (metres). */
  range: 180,
  /** Maximum number of walls the beam can pierce before stopping on the next wall. */
  maxWalls: 3,
  /** Walk speed multiplier while actively charging. */
  walkSpeedMult: 0.6,
  /** Instakill value for regular enemies; `bossHit(true, 9999)` clamps bosses to 900. */
  vaporizeDamage: 9999,
  /** Seconds of fire affliction applied to survivors at the outer beam edge. */
  burnSeconds: 4.5,
  /** Interval between beam damage/FX ticks during the 1.0 s beam (seconds). */
  tickInterval: 0.08,
  /** Charge thresholds that play rising audio stage ticks (last is full charge). */
  marks: [0.25, 0.5, 0.75, 1.0] as readonly number[],
} as const;

const EPS = 1e-6;
const HUM_LOW = 0.42;
const HUM_HIGH = 1.15;
const HUM_STEPS = 12;
const UP = new THREE.Vector3(0, 1, 0);

// Scratch vectors & structures (zero per-frame allocations).
const _muzzle = new THREE.Vector3();
const _bore = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _traceOrigin = new THREE.Vector3();
const _hitPt = new THREE.Vector3();
const _remoteFrom = new THREE.Vector3();
const _remoteTo = new THREE.Vector3();
const _enemies: EnemyInstance[] = [];
const _play: PlayOptions = {};
const _fallbackDmg: DamageInfo = {
  amount: 0,
  type: 'fire',
  point: new THREE.Vector3(),
  dir: new THREE.Vector3(),
  force: 18,
  source: 'frame_beam',
  region: 'chest',
  severMult: 1.5,
  armorPiercing: true,
  vaporize: true,
};

// ---------------------------------------------------------------------------------------------
// Pure charge / beam / cooldown state machine
// ---------------------------------------------------------------------------------------------

export class RedBeamClock {
  /** Normalized charge 0..1. */
  charge = 0;
  /** True while the trigger is actively held and charging (or holding full charge). */
  charging = false;
  /** Seconds left in the 2.0 s early-release half-charge retention window. */
  holdLeft = 0;
  /** True during the 1.0 s continuous beam fire. */
  firing = false;
  /** Seconds elapsed in the current 1.0 s beam. */
  beamElapsed = 0;
  /** Seconds remaining in the 9.0 s post-beam cooldown. */
  cooldown = 0;

  // One-frame transition flags read by RedBeamArmGun for audio/FX/co-op notes.
  startedCharging = false;
  reachedFull = false;
  releasedEarly = false;
  firedNow = false;
  endedBeamNow = false;

  get onCooldown(): boolean {
    return this.cooldown > 0;
  }

  /** Walk-speed multiplier: 0.6 while charging, 1 otherwise. */
  get walkSpeedMult(): number {
    return this.charging ? RED_BEAM.walkSpeedMult : 1;
  }

  /** Normalized beam lifetime progress 0..1 while firing, else 0. */
  get beamProgress(): number {
    return this.firing ? clamp(this.beamElapsed / RED_BEAM.duration) : 0;
  }

  /** Crosshair bar indicator (0..1): charge progress while charging/retained, draining output while firing, 0 otherwise. */
  get heat(): number {
    if (this.firing) return clamp(1 - this.beamElapsed / RED_BEAM.duration);
    if (this.charge > 0) return clamp(this.charge);
    return 0;
  }

  /** HUD reload bar progress (0..1 during 9.0 s cooldown, -1 otherwise). */
  get cooldownProgress(): number {
    return this.cooldown > 0 ? clamp(1 - this.cooldown / RED_BEAM.cooldown) : -1;
  }

  update(dt: number, held: boolean): void {
    this.startedCharging = false;
    this.reachedFull = false;
    this.releasedEarly = false;
    this.firedNow = false;
    this.endedBeamNow = false;

    if (this.firing) {
      this.beamElapsed += dt;
      if (this.beamElapsed >= RED_BEAM.duration - EPS) {
        this.firing = false;
        this.beamElapsed = 0;
        this.cooldown = RED_BEAM.cooldown;
        this.endedBeamNow = true;
      }
      return;
    }

    if (this.cooldown > 0) {
      this.cooldown = Math.max(0, this.cooldown - dt);
      this.charging = false;
      return;
    }

    if (held) {
      if (!this.charging) {
        this.charging = true;
        this.startedCharging = true;
        this.holdLeft = 0;
      }
      const wasFull = this.charge >= 1 - EPS;
      this.charge = Math.min(1, this.charge + dt / RED_BEAM.chargeTime);
      if (!wasFull && this.charge >= 1 - EPS) {
        this.charge = 1;
        this.reachedFull = true;
      }
      return;
    }

    // Trigger released or idle.
    if (this.charging) {
      this.charging = false;
      if (this.charge >= 1 - EPS) {
        this.charge = 0;
        this.holdLeft = 0;
        this.firing = true;
        this.beamElapsed = 0;
        this.firedNow = true;
        return;
      }
      if (this.charge > EPS) {
        this.charge *= 0.5;
        this.holdLeft = RED_BEAM.holdHalfDuration;
        this.releasedEarly = true;
        return;
      }
      this.charge = 0;
      return;
    }

    // Retaining kept half-charge for 2.0 s, then decaying smoothly to 0.
    if (this.charge > 0) {
      if (this.holdLeft > 0) {
        if (dt <= this.holdLeft) {
          this.holdLeft -= dt;
        } else {
          const overflow = dt - this.holdLeft;
          this.holdLeft = 0;
          this.charge = Math.max(0, this.charge - overflow * RED_BEAM.decayRate);
        }
      } else {
        this.charge = Math.max(0, this.charge - dt * RED_BEAM.decayRate);
      }
    }
  }

  reset(): void {
    this.charge = 0;
    this.charging = false;
    this.holdLeft = 0;
    this.firing = false;
    this.beamElapsed = 0;
    this.cooldown = 0;
    this.startedCharging = false;
    this.reachedFull = false;
    this.releasedEarly = false;
    this.firedNow = false;
    this.endedBeamNow = false;
  }
}

// ---------------------------------------------------------------------------------------------
// 3-wall piercing raycast up to 180 m
// ---------------------------------------------------------------------------------------------

export interface BeamWallHit {
  readonly point: THREE.Vector3;
  readonly normal: THREE.Vector3;
  readonly exit: THREE.Vector3;
  readonly exitNormal: THREE.Vector3;
  pierced: boolean;
}

export interface BeamTrace {
  readonly end: THREE.Vector3;
  readonly endNormal: THREE.Vector3;
  reach: number;
  wallsPierced: number;
  hitFinalWall: boolean;
  wallCount: number;
  readonly walls: BeamWallHit[];
}

export function makeBeamTrace(maxWalls: number = RED_BEAM.maxWalls): BeamTrace {
  const walls: BeamWallHit[] = [];
  for (let i = 0; i <= maxWalls; i++) {
    walls.push({
      point: new THREE.Vector3(),
      normal: new THREE.Vector3(),
      exit: new THREE.Vector3(),
      exitNormal: new THREE.Vector3(),
      pierced: false,
    });
  }
  return {
    end: new THREE.Vector3(),
    endNormal: new THREE.Vector3(0, 1, 0),
    reach: 0,
    wallsPierced: 0,
    hitFinalWall: false,
    wallCount: 0,
    walls,
  };
}

/**
 * Traces the Red Beam along `(origin, dir)` up to `maxRange` (180 m), piercing up to `maxWalls` (3)
 * world walls via `wallExit` and stopping on the 4th wall or unpierceable thick geometry. Zero allocations.
 */
export function traceBeamSegments(
  physics: Raycaster,
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  maxRange: number = RED_BEAM.range,
  maxWalls: number = RED_BEAM.maxWalls,
  out: BeamTrace = makeBeamTrace(maxWalls),
): BeamTrace {
  out.wallsPierced = 0;
  out.wallCount = 0;
  out.hitFinalWall = false;
  out.endNormal.set(0, 1, 0);

  _traceOrigin.copy(origin);
  let remaining = maxRange;
  let travelled = 0;

  for (let seg = 0; seg <= maxWalls; seg++) {
    if (remaining <= 0.05) break;
    const hit = physics.raycast(_traceOrigin, dir, remaining, CG.World);
    if (!hit) {
      travelled += remaining;
      out.reach = Math.min(maxRange, travelled);
      out.end.copy(origin).addScaledVector(dir, out.reach);
      return out;
    }

    const slot = out.walls[out.wallCount++]!;
    slot.point.copy(hit.point);
    slot.normal.copy(hit.normal);
    slot.pierced = false;

    const hitDist = Math.min(remaining, Math.max(0, hit.distance));
    travelled += hitDist;

    if (out.wallsPierced >= maxWalls) {
      out.end.copy(hit.point);
      out.endNormal.copy(hit.normal);
      out.reach = Math.min(maxRange, travelled);
      out.hitFinalWall = true;
      return out;
    }

    const thickness = wallExit(physics, hit.point, dir, PENETRATION.maxWall, slot.exit, slot.exitNormal);
    if (thickness < 0) {
      out.end.copy(hit.point);
      out.endNormal.copy(hit.normal);
      out.reach = Math.min(maxRange, travelled);
      out.hitFinalWall = true;
      return out;
    }

    slot.pierced = true;
    out.wallsPierced++;
    const advance = thickness + 0.05;
    if (hitDist + advance >= remaining) {
      out.reach = maxRange;
      out.end.copy(origin).addScaledVector(dir, maxRange);
      return out;
    }

    remaining -= hitDist + advance;
    travelled += advance;
    _traceOrigin.copy(slot.exit).addScaledVector(dir, 0.05);
  }

  out.reach = Math.min(maxRange, travelled);
  out.end.copy(origin).addScaledVector(dir, out.reach);
  return out;
}

/**
 * Closest squared lateral distance from an enemy's vertical body column to the beam segment `(origin, dir, reach)`.
 * Writes the closest point on the beam axis into `outHitPoint`.
 */
function enemyBeamDistanceSq(
  e: EnemyInstance,
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  reach: number,
  outHitPoint: THREE.Vector3,
): number {
  const top = e.char?.rig ? e.char.rig.height : 1.8;
  let bestD2 = Infinity;
  let bestAlong = 0;

  for (let i = 0; i < 3; i++) {
    const sy = i === 1 ? e.center.y : e.position.y + 0.3 + (top - 0.3) * (i / 2);
    const sx = i === 1 ? e.center.x : e.position.x;
    const sz = i === 1 ? e.center.z : e.position.z;
    const dx = sx - origin.x;
    const dy = sy - origin.y;
    const dz = sz - origin.z;
    const along = dx * dir.x + dy * dir.y + dz * dir.z;
    if (along < -0.5 || along > reach + 0.5) continue;
    const clamped = clamp(along, 0, reach);
    const px = dx - dir.x * clamped;
    const py = dy - dir.y * clamped;
    const pz = dz - dir.z * clamped;
    const d2 = px * px + py * py + pz * pz;
    if (d2 < bestD2) {
      bestD2 = d2;
      bestAlong = clamped;
    }
  }

  if (bestD2 < Infinity) {
    outHitPoint.copy(origin).addScaledVector(dir, bestAlong);
  }
  return bestD2;
}

function stageMark(charge: number): number {
  let m = -1;
  for (let i = 0; i < RED_BEAM.marks.length; i++) {
    if (charge >= RED_BEAM.marks[i]! - EPS) m = i;
  }
  return m;
}

// ---------------------------------------------------------------------------------------------
// Red Beam arm weapon instance
// ---------------------------------------------------------------------------------------------

export class RedBeamArmGun implements FrameArmGun {
  readonly kind = 'beam' as const;
  readonly clock = new RedBeamClock();
  private readonly trace = makeBeamTrace(RED_BEAM.maxWalls);
  private readonly hitBosses = new Set<number>();
  private fxSlot: RedBeamSlot | null = null;
  private chargeLoop: LoopHandle | null = null;
  private beamLoop: LoopHandle | null = null;
  private rumbleLoop: LoopHandle | null = null;
  private humStep = -1;
  private stage = -1;
  private tickIn = 0;
  private decalCooldown = 0;

  constructor(private readonly ctx: Ctx) {}

  get firing(): boolean {
    return this.clock.firing;
  }

  get heat(): number {
    return this.clock.heat;
  }

  get walkSpeedMult(): number {
    return this.clock.walkSpeedMult;
  }

  update(dt: number, u: ArmUpdateContext): void {
    const { audio, camera } = this.ctx;
    const c = this.clock;

    if (u.pressed && c.onCooldown) {
      audio.play('weapon_dry');
    }

    c.update(dt, u.held);

    // Charge transition: started charging or released early.
    if (c.startedCharging) {
      this.stage = stageMark(c.charge);
      this.startChargeAudio();
    }
    if (c.releasedEarly) {
      this.stopChargeAudio();
      audio.play('railgun_fizzle', { volume: 0.65, pitch: 0.9 });
    }

    // Beam fire transition: start the 1.0 s continuous mega-beam.
    if (c.firedNow) {
      this.stopChargeAudio();
      this.beginBeam(u);
    }

    // Beam finished transition: stop loops and start 9.0 s cooldown.
    if (c.endedBeamNow) {
      this.finishBeam();
    }

    // Active firing step.
    if (c.firing) {
      this.stepBeam(dt, u);
      return;
    }

    // Active charging (or holding kept half-charge glow).
    if (c.charging) {
      this.stepCharging(dt, u);
      if (u.recoilMult > 0) {
        camera.addTrauma?.(0.14 * c.charge * c.charge * u.recoilMult);
      }
      return;
    }

    // Holding kept half-charge during the 2.0 s window: dim muzzle orb, no charge hum.
    this.stopChargeAudio();
    if (c.charge > 0.01) {
      u.arm.muzzle(_muzzle);
      this.ensureSlot();
      poseRedBeamChargeOrb(this.fxSlot, this.ctx, _muzzle, c.charge * 0.7);
    } else {
      hideRedBeamSlot(this.fxSlot);
    }
  }

  idleUpdate(dt: number): void {
    const wasFiring = this.clock.firing;
    this.clock.update(dt, false);
    if (wasFiring && !this.clock.firing) {
      this.stopBeamAudio();
      hideRedBeamSlot(this.fxSlot);
      this.hitBosses.clear();
    }
  }

  fillRow(row: GunnerWeapon, button: string): void {
    const c = this.clock;
    if (c.firing) {
      row.name = `${button} RED BEAM [FIRING]`;
      row.ammo = Math.round((1 - c.beamProgress) * 100);
      row.max = 100;
      row.reload = -1;
      row.selected = true;
    } else if (c.onCooldown) {
      row.name = `${button} RED BEAM [COOLDOWN]`;
      row.ammo = 0;
      row.max = 100;
      row.reload = c.cooldownProgress;
      row.selected = false;
    } else if (c.charging || c.charge > EPS) {
      const pct = Math.round(c.charge * 100);
      row.name = `${button} RED BEAM [CHARGING ${pct}%]`;
      row.ammo = pct;
      row.max = 100;
      row.reload = -1;
      row.selected = c.charge >= 1 - EPS;
    } else {
      row.name = `${button} RED BEAM [READY]`;
      row.ammo = 100;
      row.max = 100;
      row.reload = -1;
      row.selected = false;
    }
  }

  silence(): void {
    this.stopChargeAudio();
    this.stopBeamAudio();
    hideRedBeamSlot(this.fxSlot);
  }

  reset(): void {
    this.silence();
    this.clock.reset();
    this.hitBosses.clear();
    this.stage = -1;
    this.humStep = -1;
    this.tickIn = 0;
    this.decalCooldown = 0;
    releaseRedBeamSlot(this.ctx, this.fxSlot);
    this.fxSlot = null;
  }

  private ensureSlot(): RedBeamSlot | null {
    if (!this.fxSlot) this.fxSlot = acquireRedBeamSlot(this.ctx);
    return this.fxSlot;
  }

  private startChargeAudio(): void {
    if (this.chargeLoop) return;
    const { audio } = this.ctx;
    this.humStep = -1;
    this.chargeLoop = audio.startLoop?.('railgun_charge_loop', { pitch: HUM_LOW, volume: 0.28 }) ?? null;
  }

  private stopChargeAudio(): void {
    if (!this.chargeLoop) return;
    this.chargeLoop.stop(0.06);
    this.chargeLoop = null;
    this.humStep = -1;
  }

  private stopBeamAudio(): void {
    if (this.beamLoop) {
      this.beamLoop.stop(0.12);
      this.beamLoop = null;
    }
    if (this.rumbleLoop) {
      this.rumbleLoop.stop(0.32);
      this.rumbleLoop = null;
    }
  }

  private stepCharging(dt: number, u: ArmUpdateContext): void {
    const { audio } = this.ctx;
    const charge = this.clock.charge;
    if (!this.chargeLoop) this.startChargeAudio();

    const mark = stageMark(charge);
    while (this.stage < mark) {
      this.stage++;
      audio.play('lance_stage', { pitch: 0.9 + this.stage * 0.22 });
      if (this.stage === RED_BEAM.marks.length - 1) {
        audio.play('railgun_ready', { pitch: 0.92, volume: 0.9 });
      }
    }

    this.chargeLoop?.setPitch(HUM_LOW + (HUM_HIGH - HUM_LOW) * charge, 0.05);
    const step = Math.round(charge * HUM_STEPS);
    if (step !== this.humStep) {
      this.humStep = step;
      this.chargeLoop?.setVolume(0.28 + 0.67 * charge, 0.08);
    }

    u.arm.muzzle(_muzzle);
    this.ensureSlot();
    poseRedBeamChargeOrb(this.fxSlot, this.ctx, _muzzle, charge);
    emitRedBeamChargeFx(this.ctx, _muzzle, charge, dt);
  }

  private beginBeam(u: ArmUpdateContext): void {
    const { audio, camera, render } = this.ctx;
    this.hitBosses.clear();
    this.tickIn = 0;
    this.decalCooldown = 0;

    u.arm.muzzle(_muzzle);
    _dir.copy(u.sight.aim).normalize();
    traceBeamSegments(this.ctx.physics, u.sight.view.position, _dir, RED_BEAM.range, RED_BEAM.maxWalls, this.trace);

    // Co-op: notify teammates so `remoteNews` renders the full 1.0 s thick red beam on their screens.
    u.onNews?.('beam', [
      _muzzle.x, _muzzle.y, _muzzle.z,
      this.trace.end.x, this.trace.end.y, this.trace.end.z,
      RED_BEAM.duration,
    ]);

    audio.play('lance_thunder', { volume: 1.05, pitch: 0.78 });
    audio.play('orbital_strike', { volume: 0.85, pitch: 0.72 });
    audio.play('railgun_fire', { volume: 0.8, pitch: 0.75 });
    this.beamLoop = audio.startLoop?.('lance_beam_loop', { pitch: 0.82, volume: 0.9 }) ?? null;
    this.rumbleLoop = audio.startLoop?.('orbital_beam_loop', { pitch: 0.62, volume: 0.95, fadeIn: 0.03 }) ?? null;

    u.arm.recoil(0.55);
    if (u.recoilMult > 0) {
      camera.addTrauma?.(0.65 * u.recoilMult);
      camera.kick?.(0.045 * u.recoilMult, rand(-0.01, 0.01) * u.recoilMult);
      camera.fovPunch?.(6 * u.recoilMult, 0.25);
    }
    render?.post?.flash?.(0xff2a1a, 0.38, 0.2);
    render?.post?.chromatic?.(0.9, 0.28);
    render?.post?.radialBlur?.(0.32, 0.28);
  }

  private stepBeam(dt: number, u: ArmUpdateContext): void {
    const { camera, render } = this.ctx;
    const progress = this.clock.beamProgress;
    const power = redBeamPower(progress);
    const girth = redBeamGirth(progress);

    u.arm.muzzle(_muzzle);
    _dir.copy(u.sight.aim).normalize();
    traceBeamSegments(this.ctx.physics, u.sight.view.position, _dir, RED_BEAM.range, RED_BEAM.maxWalls, this.trace);

    this.ensureSlot();
    poseRedBeamSlot(this.fxSlot, this.ctx, _muzzle, this.trace.end, power, girth, this.trace.hitFinalWall);

    this.beamLoop?.setVolume(0.45 + 0.55 * power, 0.05);
    this.rumbleLoop?.setVolume(0.95 * power, 0.05);

    this.decalCooldown = Math.max(0, this.decalCooldown - dt);
    this.tickIn -= dt;
    if (this.tickIn <= 0) {
      this.tickIn += RED_BEAM.tickInterval;
      this.beamTick(u, power);
    }
    if (u.recoilMult > 0) {
      camera.addTrauma?.(0.42 * power * u.recoilMult);
      render?.post?.chromatic?.(0.22 * power, 0.08);
    }
  }

  private beamTick(u: ArmUpdateContext, power: number): void {
    const c = this.ctx;
    const { enemies, fx, hud, camera } = c;
    const origin = u.sight.view.position;
    const reach = this.trace.reach;
    const coreR = RED_BEAM.radius + RED_BEAM.bodyAllowance;
    const coreR2 = coreR * coreR;
    const scorchR2 = RED_BEAM.edgeScorchRadius * RED_BEAM.edgeScorchRadius;

    _mid.copy(origin).addScaledVector(_dir, reach * 0.5);
    const count = Math.min(enemies.query(_mid, reach * 0.5 + RED_BEAM.edgeScorchRadius + 2, _enemies) || 0, _enemies.length);
    let struck = 0;

    for (let i = 0; i < count; i++) {
      const e = _enemies[i]!;
      if (!e.alive) continue;
      const d2 = enemyBeamDistanceSq(e, origin, _dir, reach, _hitPt);
      if (d2 > scorchR2) continue;

      if (d2 <= coreR2) {
        // Bosses take 900 via `bossHit` once per beam fire (avoiding 1-frame multi-tick boss instakills).
        if (e.isBoss) {
          if (this.hitBosses.has(e.uid)) continue;
          this.hitBosses.add(e.uid);
        }
        const res = this.applyCoreBeamHit(e, _hitPt, _dir);
        struck++;
        if (!res.killed && e.alive) {
          enemies.afflict?.(e, 'burn', RED_BEAM.burnSeconds);
        }
        fx.sparks?.(_hitPt, UP, 6, 0xff4422);
        fx.embers?.(_hitPt, 4, 0.7);
      } else {
        // Outer ~2.4 m edge scorch: ignite survivors with fire.
        enemies.afflict?.(e, 'burn', RED_BEAM.burnSeconds);
        fx.embers?.(e.center, 3, 0.8);
      }
    }
    _enemies.length = 0;

    if (struck > 0) hud.hitMarker?.('body');

    // Damage enemy vehicles / map explosives along wall strikes and beam end.
    const addDecals = this.decalCooldown <= 0;
    if (addDecals) this.decalCooldown = 0.2;
    for (let i = 0; i < this.trace.wallCount; i++) {
      const w = this.trace.walls[i]!;
      const isFinal = !w.pierced;
      emitRedBeamWallPierce(c, w.point, w.normal, isFinal, addDecals);
      if (w.pierced) {
        emitRedBeamWallPierce(c, w.exit, w.exitNormal, false, addDecals);
      }
      c.world?.objects?.damageExplosivesInRadius?.(w.point, 2.4, 220, 'frame_beam');
      c.physics.radialImpulse?.(w.point, 3.0, 12);
    }
    enemies.vehicles?.frameBlow?.(this.trace.end, 2.5, 45, _dir, 'frame_beam');

    emitRedBeamLightsAndShimmer(c, _muzzle, this.trace.end, power);
    u.arm.recoil(0.28);
    if (u.recoilMult > 0) {
      camera.kick?.(rand(0.005, 0.012) * power * u.recoilMult, rand(-0.006, 0.006) * power * u.recoilMult);
    }
  }

  private applyCoreBeamHit(enemy: EnemyInstance, point: THREE.Vector3, dir: THREE.Vector3): DamageResult {
    const combat = this.ctx.combat as Combat | undefined;
    if (combat && typeof combat.strike === 'function' && typeof combat.strikeOptions === 'function') {
      const o = combat.strikeOptions('fire', 'frame_beam');
      o.force = 18;
      o.severMult = 1.5;
      o.quiet = true;
      o.pierces = true;
      o.vaporize = true;
      return combat.strike(enemy, point, UP, dir, undefined, 'chest', RED_BEAM.vaporizeDamage, o);
    }
    // Lightweight fallback for unit tests where `ctx.combat` is a minimal mock without `Combat.strike`.
    _fallbackDmg.amount = bossHit(enemy.isBoss, RED_BEAM.vaporizeDamage);
    _fallbackDmg.point.copy(point);
    _fallbackDmg.dir.copy(dir);
    _fallbackDmg.pierces = enemy.armor > 0;
    _fallbackDmg.vaporize = true;
    return this.ctx.enemies.applyDamage(enemy, _fallbackDmg);
  }

  private finishBeam(): void {
    this.stopBeamAudio();
    hideRedBeamSlot(this.fxSlot);
    this.hitBosses.clear();
    this.ctx.audio.play('railgun_beam', { pitch: 0.75, volume: 0.85 });
    this.ctx.audio.play('steam_burst', { volume: 0.6, pitch: 0.85 });
  }
}

export const BEAM_PLUGIN: ArmPlugin = {
  kind: 'beam',
  newsKinds: ['beam'],
  create: ctx => new RedBeamArmGun(ctx),
  remoteFiring(ctx: Ctx, arm: Arm, _side, dt: number, state: ArmRemoteState): void {
    arm.recoil(0.26);
    state.accum += dt * 10;
    if (state.accum < 1) return;
    state.accum -= Math.floor(state.accum);
    arm.muzzle(_muzzle);
    arm.bore(_bore);
    ctx.fx.sparks?.(_muzzle, _bore, 6, 0xff3b22);
    ctx.render?.lights?.flash?.(_muzzle, 0xff2414, 18, 14, 0.08);
  },
  remoteNews(ctx: Ctx, kind: MechKind, values: number[]): void {
    if (kind !== 'beam' || values.length < 6) return;
    _remoteFrom.set(values[0]!, values[1]!, values[2]!);
    _remoteTo.set(values[3]!, values[4]!, values[5]!);
    const duration = clamp(values[6] ?? RED_BEAM.duration, 0.1, 3.0);
    spawnTimedRedBeam(ctx, _remoteFrom, _remoteTo, duration);
    _play.position = _remoteFrom;
    _play.volume = 0.95;
    _play.pitch = 0.78;
    ctx.audio.play('lance_thunder', _play);
    _play.volume = 0.75;
    _play.pitch = 0.72;
    ctx.audio.play('orbital_strike', _play);
    _play.volume = 0.8;
    _play.pitch = 0.75;
    ctx.audio.play('railgun_beam', _play);
    const dist = ctx.player?.position ? ctx.player.position.distanceTo(_remoteFrom) : 0;
    const shake = Math.max(0, 0.45 * (1 - dist / 45));
    if (shake > 0) ctx.camera?.addTrauma?.(shake);
  },
};
