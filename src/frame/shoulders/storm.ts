/**
 * Metal Storm Pod shoulder weapon plug-in (`storm`).
 *
 *   Lock & Sweep   Hold G / V / B to paint up to 8 distinct enemies under the crosshair (0.5 s lock per target via
 *                  `Painter`). Painted targets are exposed through `marks` so the cockpit HUD draws lock boxes.
 *   Charge         Once the first target is locked, a 0.7 s charge winds up (rising pitch whine + glowing barrels).
 *                  Keeping the key held lets you keep sweeping and painting additional targets up to 8.
 *   Cancel         Releasing before any lock or before the 0.7 s charge completes cancels cleanly with no reload.
 *   Snap Burst     Releasing when charged fires one blazing aimbot burst snapping sequentially from target to target
 *                  in the exact order painted: 0.25 s per target, 120 rounds × 30 damage = 3600 damage per target,
 *                  batched cleanly through `Combat.fireRay` with visual tracers pooled/capped to 3–4 golden-white
 *                  streaks per frame. Before snapping to each target, checks alive + line of sight from the shoulder
 *                  mount and skips dead or occluded targets immediately.
 *   Reload         7.5 s recharge after the burst completes.
 *   Co-op          Emits `u.onNews?.('storm', [mx, my, mz, tx, ty, tz])` per snapped target; `remoteNews` draws the
 *                  capped golden-white snapping tracer stream and volley audio on teammates' screens.
 */
import * as THREE from 'three';
import { CG, type Ctx, type LoopHandle, type PhysicsSystem, type TracerKind } from '../../core/contracts';
import type { MissileTarget, ShotSpec } from '../../core/gameplay';
import { clamp } from '../../core/math';
import type { MechKind } from '../../progression/callins/link';
import type { GunnerWeapon } from '../../vehicles/hud';
import { Painter, type PaintCandidate } from '../../weapons/swarm';
import type { FrameShoulderWeapon, ShoulderPlugin, ShoulderUpdateContext } from './types';

export const STORM = {
  /** Maximum distinct targets painted in a single sweep. */
  maxTargets: 8,
  /** Seconds held per target lock. */
  paintEvery: 0.5,
  /** Seconds of capacitor windup required after the first lock before releasing fires. */
  charge: 0.7,
  /** Seconds of hyper-velocity fire dumped into each painted target. */
  burstPerTarget: 0.25,
  /** Rounds fired per target during its 0.25 s window (480 rds/s). */
  roundsPerTarget: 120,
  /** Damage per round (120 × 30 = 3600 total per target). */
  damagePerRound: 30,
  /** Reload duration in seconds after a burst finishes. */
  reload: 7.5,
  /** Lock & fire reach in metres. */
  range: 200,
  /** Paint cone half-angle in radians. */
  cone: 0.26,
  /** Hard cap on visual golden-white tracer streaks emitted per frame. */
  maxTracersPerFrame: 4,
  /** Hard cap on batched `Combat.fireRay` calls per target slice per frame. */
  maxRaysPerFrame: 4,
  /** Visual streaks drawn per co-op `storm` news snap on teammates' screens. */
  remoteTracers: 4,
  /** Kinetic push & sever multiplier per batched hit. */
  force: 34,
  severMult: 2.2,
  impactScale: 1.2,
} as const;

export type StormPhase = 'ready' | 'painting' | 'firing' | 'reloading';

/** One pooled fire slice emitted by `StormClock.update` for the active target during a frame. */
export interface StormFireSlice {
  target: MissileTarget;
  readonly aim: THREE.Vector3;
  rounds: number;
  /** True on the first slice after snapping onto this target (triggers volley audio + co-op news). */
  snapped: boolean;
}

const UP = new THREE.Vector3(0, 1, 0);
const FALLBACK_RIGHT = new THREE.Vector3(1, 0, 0);
const _mount = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _losTo = new THREE.Vector3();
const _losDir = new THREE.Vector3();
const _rFrom = new THREE.Vector3();
const _rTo = new THREE.Vector3();
const _rDir = new THREE.Vector3();
const _rRight = new THREE.Vector3();
const _rUp = new THREE.Vector3();
const _rMuzzle = new THREE.Vector3();
const _rNegDir = new THREE.Vector3();

/** Writes the world-space aim point of a paintable target into `out`. */
export function targetAimPoint(target: MissileTarget, out: THREE.Vector3): THREE.Vector3 {
  out.copy(target.center);
  out.y += target.aimLift ?? 0;
  return out;
}

/** True when `target` is alive, within `range`, and has clear line of sight from `from` against `CG.World`. */
export function hasLineOfSight(
  physics: Pick<PhysicsSystem, 'raycast'>,
  from: THREE.Vector3,
  target: MissileTarget,
  range: number = STORM.range,
): boolean {
  if (!target.alive) return false;
  targetAimPoint(target, _losTo);
  _losDir.subVectors(_losTo, from);
  const dist = _losDir.length();
  if (dist > range) return false;
  if (dist < 1e-3) return true;
  _losDir.divideScalar(dist);
  const wall = physics.raycast(from, _losDir, dist, CG.World);
  if (wall && wall.distance < dist - (target.paintRadius ?? 0.6)) return false;
  return true;
}

/** Builds a right/up orthonormal basis perpendicular to unit direction `dir` (zero allocation). */
function barrelBasis(dir: THREE.Vector3, right: THREE.Vector3, up: THREE.Vector3): void {
  right.crossVectors(dir, UP);
  if (right.lengthSq() < 1e-6) right.copy(FALLBACK_RIGHT);
  else right.normalize();
  up.crossVectors(right, dir).normalize();
}

/** Computes the world-space muzzle point for barrel `index` (0..15) on the 4×4 pod face. */
function barrelMuzzle(
  mount: THREE.Vector3,
  right: THREE.Vector3,
  up: THREE.Vector3,
  index: number,
  out: THREE.Vector3,
): THREE.Vector3 {
  const b = ((index % 16) + 16) % 16;
  const col = b % 4;
  const row = (b - col) / 4;
  return out
    .copy(mount)
    .addScaledVector(right, (col - 1.5) * 0.235)
    .addScaledVector(up, (row - 1.5) * 0.165);
}

/** Pure state machine for the Metal Storm Pod (no audio/FX/DOM): paint, charge, cancel, sequential snap burst, reload. */
export class StormClock {
  readonly painter = new Painter(STORM.paintEvery);
  /** Seconds of capacitor charge accumulated since the first target locked (`0..STORM.charge`). */
  charge = 0;
  /** Seconds left in the 7.5 s reload, or `-1` when not reloading. */
  reloading = -1;
  /** Currently snapped target during a burst, or null. */
  activeTarget: MissileTarget | null = null;
  /** Aim position of the active target (updated while alive, held on last position if killed mid-burst). */
  readonly activeAim = new THREE.Vector3();
  /** Seconds spent firing on `activeTarget` (`0..STORM.burstPerTarget`). */
  targetElapsed = 0;
  /** Rounds delivered so far to `activeTarget` (`0..STORM.roundsPerTarget`). */
  targetRoundsDelivered = 0;

  // Per-tick event flags read by `StormShoulder`.
  startedPainting = false;
  marked: MissileTarget | null = null;
  chargeReadyNow = false;
  cancelledNow = false;
  burstFinishedNow = false;
  reloadFinishedNow = false;
  skippedCount = 0;

  private readonly queue: MissileTarget[] = [];
  private queueHead = 0;
  private firing = false;
  private readonly activeMarks: MissileTarget[] = [];
  private readonly unmarked: PaintCandidate[] = [];
  private readonly slicePool: StormFireSlice[] = [];
  private sliceCount = 0;
  readonly slices: StormFireSlice[] = [];

  get phase(): StormPhase {
    if (this.reloading >= 0) return 'reloading';
    if (this.firing) return 'firing';
    if (this.painter.painting) return 'painting';
    return 'ready';
  }

  get charged(): boolean {
    return this.charge >= STORM.charge - 1e-6;
  }

  get chargeProgress(): number {
    return clamp(this.charge / STORM.charge);
  }

  get reloadProgress(): number {
    return this.reloading < 0 ? -1 : clamp(1 - this.reloading / STORM.reload);
  }

  /** Number of painted targets remaining in the current burst (including the active target). */
  get remainingTargets(): number {
    if (!this.firing) return 0;
    return (this.activeTarget ? 1 : 0) + (this.queue.length - this.queueHead);
  }

  /** Painted targets to show on the cockpit HUD lock-box overlay. */
  get marks(): readonly MissileTarget[] {
    return this.firing ? this.activeMarks : this.painter.marks;
  }

  /**
   * Advances one tick.
   * - `look` returns live candidates in the paint cone with LOS.
   * - `canHit` validates alive + mount LOS right before snapping to each painted target.
   */
  update(
    dt: number,
    held: boolean,
    look: () => readonly PaintCandidate[],
    canHit: (target: MissileTarget) => boolean,
  ): void {
    this.clearTickEvents();

    if (this.reloading >= 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) {
        this.reloading = -1;
        this.reloadFinishedNow = true;
      }
      return;
    }

    if (this.firing) {
      this.stepFiring(dt, canHit);
      return;
    }

    if (!this.painter.painting) {
      if (!held) return;
      this.painter.begin(STORM.maxTargets);
      this.charge = 0;
      this.startedPainting = true;
    }

    if (held) {
      const hadLock = this.painter.marks.length > 0;
      const wasCharged = this.charged;
      this.marked = this.painter.update(dt, () => this.filterUnmarked(look()));
      if (this.painter.marks.length === 0) {
        this.charge = 0;
      } else if (hadLock) {
        this.charge = Math.min(STORM.charge, this.charge + dt);
        if (this.charge >= STORM.charge - 1e-6) this.charge = STORM.charge;
        if (!wasCharged && this.charged) this.chargeReadyNow = true;
      }
      return;
    }

    // Trigger released while painting.
    for (let i = this.painter.marks.length - 1; i >= 0; i--) {
      if (!this.painter.marks[i]!.alive) this.painter.marks.splice(i, 1);
    }

    if (this.charged && this.painter.marks.length > 0) {
      this.queue.length = 0;
      for (let i = 0; i < this.painter.marks.length; i++) {
        this.queue.push(this.painter.marks[i]!);
      }
      this.queueHead = 0;
      this.painter.cancel();
      this.charge = 0;
      this.firing = true;
      this.activeTarget = null;
      this.targetElapsed = 0;
      this.targetRoundsDelivered = 0;
      this.stepFiring(dt, canHit);
      return;
    }

    // Early release (0 locks or incomplete 0.7 s charge): cancel cleanly without triggering reload.
    const hadProgress = this.charge > 0 || this.painter.marks.length > 0;
    this.painter.cancel();
    this.charge = 0;
    this.cancelledNow = hadProgress;
  }

  /** Cancels any active paint/charge or burst without triggering reload (e.g. knocked offline or exited mech). */
  cancelActive(): boolean {
    const wasActive = this.painter.painting || this.firing || this.charge > 0;
    this.painter.cancel();
    this.charge = 0;
    this.firing = false;
    this.activeTarget = null;
    this.targetElapsed = 0;
    this.targetRoundsDelivered = 0;
    this.queue.length = 0;
    this.queueHead = 0;
    this.activeMarks.length = 0;
    this.slices.length = 0;
    this.sliceCount = 0;
    return wasActive;
  }

  /** Ticks reload while parked/uncrewed; cancels any unfinished paint or burst. */
  idleUpdate(dt: number): void {
    this.clearTickEvents();
    if (this.painter.painting || this.firing) this.cancelActive();
    if (this.reloading >= 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) {
        this.reloading = -1;
        this.reloadFinishedNow = true;
      }
    }
  }

  reset(): void {
    this.cancelActive();
    this.reloading = -1;
    this.clearTickEvents();
  }

  private clearTickEvents(): void {
    this.startedPainting = false;
    this.marked = null;
    this.chargeReadyNow = false;
    this.cancelledNow = false;
    this.burstFinishedNow = false;
    this.reloadFinishedNow = false;
    this.skippedCount = 0;
    this.sliceCount = 0;
    this.slices.length = 0;
  }

  /** Filters out dead targets and targets already in `painter.marks` so marks never duplicate onto one enemy. */
  private filterUnmarked(candidates: readonly PaintCandidate[]): readonly PaintCandidate[] {
    const out = this.unmarked;
    out.length = 0;
    const marks = this.painter.marks;
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i]!;
      if (!c.target.alive) continue;
      if (marks.includes(c.target)) continue;
      out.push(c);
    }
    return out;
  }

  private pushSlice(target: MissileTarget, aim: THREE.Vector3, rounds: number, snapped: boolean): void {
    let slot = this.slicePool[this.sliceCount];
    if (!slot) {
      slot = { target, aim: new THREE.Vector3(), rounds: 0, snapped: false };
      this.slicePool[this.sliceCount] = slot;
    }
    slot.target = target;
    slot.aim.copy(aim);
    slot.rounds = rounds;
    slot.snapped = snapped;
    this.slices.push(slot);
    this.sliceCount++;
  }

  private syncActiveMarks(): void {
    const out = this.activeMarks;
    out.length = 0;
    if (this.activeTarget) out.push(this.activeTarget);
    for (let i = this.queueHead; i < this.queue.length; i++) {
      out.push(this.queue[i]!);
    }
  }

  private finishBurst(): void {
    this.firing = false;
    this.activeTarget = null;
    this.targetElapsed = 0;
    this.targetRoundsDelivered = 0;
    this.queue.length = 0;
    this.queueHead = 0;
    this.activeMarks.length = 0;
    this.reloading = STORM.reload;
    this.burstFinishedNow = true;
  }

  private stepFiring(dt: number, canHit: (target: MissileTarget) => boolean): void {
    let remaining = Math.max(0, dt);
    let firstPass = true;

    while (firstPass || remaining > 1e-6) {
      firstPass = false;
      let snapped = false;

      if (!this.activeTarget) {
        while (this.queueHead < this.queue.length) {
          const cand = this.queue[this.queueHead++]!;
          if (cand.alive && canHit(cand)) {
            this.activeTarget = cand;
            targetAimPoint(cand, this.activeAim);
            this.targetElapsed = 0;
            this.targetRoundsDelivered = 0;
            snapped = true;
            break;
          }
          this.skippedCount++;
        }
        if (!this.activeTarget) {
          this.finishBurst();
          return;
        }
      }

      if (this.activeTarget.alive) {
        targetAimPoint(this.activeTarget, this.activeAim);
      }

      const step = Math.min(remaining, Math.max(0, STORM.burstPerTarget - this.targetElapsed));
      this.targetElapsed += step;
      remaining -= step;

      const doneTarget = this.targetElapsed >= STORM.burstPerTarget - 1e-6;
      const nextDelivered = doneTarget
        ? STORM.roundsPerTarget
        : Math.min(
            STORM.roundsPerTarget,
            Math.floor((this.targetElapsed / STORM.burstPerTarget) * STORM.roundsPerTarget + 1e-6),
          );
      const rounds = nextDelivered - this.targetRoundsDelivered;
      this.targetRoundsDelivered = nextDelivered;

      if (rounds > 0 || snapped) {
        this.pushSlice(this.activeTarget, this.activeAim, rounds, snapped);
      }

      if (doneTarget) {
        this.activeTarget = null;
        this.targetElapsed = 0;
        this.targetRoundsDelivered = 0;
        if (this.queueHead >= this.queue.length) {
          this.finishBurst();
          return;
        }
        // If no time remains in this frame, snap to the next target on the next frame so its LOS check runs fresh.
        if (remaining <= 1e-6) break;
      } else {
        break;
      }
    }

    this.syncActiveMarks();
  }
}

export class StormShoulder implements FrameShoulderWeapon {
  readonly kind = 'storm' as const;
  readonly clock = new StormClock();
  private chargeLoop: LoopHandle | null = null;
  private fireLoop: LoopHandle | null = null;
  private barrelCursor = 0;
  private snapCount = 0;
  private chargeFxAccum = 0;
  private readonly shot: ShotSpec = {
    damage: STORM.damagePerRound,
    source: 'frame_storm',
    team: 'player',
    maxDistance: STORM.range,
    tracerFrom: _muzzle,
    force: STORM.force,
    severMult: STORM.severMult,
    impactScale: STORM.impactScale,
  };

  constructor(private readonly ctx: Ctx) {}

  get marks(): readonly MissileTarget[] {
    return this.clock.marks;
  }

  update(dt: number, u: ShoulderUpdateContext): void {
    const { audio, combat, fx, camera, physics, render } = this.ctx;
    const clock = this.clock;

    if (!u.online) {
      if (clock.cancelActive()) {
        this.silence();
        audio.play('quiver_cancel', { volume: 0.7 });
      }
      if (clock.reloading >= 0) {
        clock.idleUpdate(dt);
        if (clock.reloadFinishedNow) audio.play('reload_cell', { volume: 0.8 });
      }
      if (u.pressed) audio.play('weapon_dry');
      return;
    }

    if (u.pressed && clock.reloading >= 0) {
      audio.play('weapon_dry');
    }

    u.mountPos(_mount);
    clock.update(
      dt,
      u.held,
      () => u.gatherTargets(STORM.range, Math.cos(STORM.cone)),
      target => hasLineOfSight(physics, _mount, target, STORM.range),
    );

    if (clock.startedPainting) {
      audio.play('quiver_arm');
    }
    if (clock.marked) {
      audio.play('quiver_lock', { pitch: 1 + (clock.painter.marks.length - 1) * 0.09 });
      if (clock.painter.full) audio.play('quiver_full');
    }

    // Charge windup whine + glowing pod barrels once >= 1 target is locked.
    if (clock.phase === 'painting' && clock.painter.marks.length > 0) {
      const frac = clock.chargeProgress;
      const pitch = 0.55 + frac * 0.9;
      const volume = 0.45 + frac * 0.4;
      if (!this.chargeLoop) {
        this.chargeLoop = audio.startLoop('railgun_charge_loop', { fadeIn: 0.06, pitch, volume });
      } else {
        this.chargeLoop.setPitch(pitch, 0.04);
        this.chargeLoop.setVolume(volume, 0.04);
      }
      render.lights?.flash(_mount, 0xffaa30, 1.5 + frac * 3.5, 6, 0.06);
      this.chargeFxAccum += dt;
      if (this.chargeFxAccum >= 0.08) {
        this.chargeFxAccum = 0;
        fx.inhale?.(_mount, 1.4, 2, '#ffaa30');
      }
      if (clock.chargeReadyNow) {
        audio.play('railgun_ready', { pitch: 1.15, volume: 0.85 });
      }
    } else {
      this.stopChargeLoop();
    }

    if (clock.cancelledNow) {
      audio.play('quiver_cancel', { volume: 0.7 });
    }

    // Execute batched aimbot burst slices with pooled/capped visual tracers (<= 4 per frame).
    if (clock.slices.length > 0) {
      if (!this.fireLoop) {
        this.fireLoop = audio.startLoop('minigun_fire_loop', { fadeIn: 0.02, pitch: 1.85, volume: 0.9 });
      }
      let tracersUsed = 0;
      let flashedThisFrame = false;

      for (let s = 0; s < clock.slices.length; s++) {
        const slice = clock.slices[s]!;
        _dir.subVectors(slice.aim, _mount);
        const dist = _dir.length();
        if (dist > 1e-4) _dir.divideScalar(dist);
        else _dir.copy(u.sight.aim);
        barrelBasis(_dir, _right, _up);

        if (slice.snapped) {
          const snapIdx = this.snapCount++;
          audio.play('metalstorm_volley', { pitch: 1.05 + (snapIdx % 4) * 0.04, volume: 0.85 });
          audio.play('judge_fan_lock', { pitch: 1.2 + (snapIdx % 4) * 0.06, volume: 0.45 });
          u.onNews?.('storm', [_mount.x, _mount.y, _mount.z, slice.aim.x, slice.aim.y, slice.aim.z]);
          render.lights?.flash(_mount, 0xffd070, 5.5, 12, 0.08);
          camera.addTrauma(0.12);
        }

        if (slice.rounds > 0) {
          const rays = Math.min(slice.rounds, STORM.maxRaysPerFrame);
          const baseRounds = Math.floor(slice.rounds / rays);
          const extra = slice.rounds % rays;

          for (let r = 0; r < rays; r++) {
            const batchRounds = baseRounds + (r < extra ? 1 : 0);
            const barrel = this.barrelCursor++ & 15;
            barrelMuzzle(_mount, _right, _up, barrel, _muzzle);

            let tracer: TracerKind | undefined;
            if (tracersUsed < STORM.maxTracersPerFrame) {
              tracer = (tracersUsed & 1) === 0 ? 'raufoss' : 'carbine';
              tracersUsed++;
            }

            this.shot.damage = batchRounds * STORM.damagePerRound;
            this.shot.tracer = tracer;
            this.shot.tracerFrom = _muzzle;
            combat.fireRay(_mount, _dir, this.shot);
          }

          if (!flashedThisFrame) {
            fx.muzzleFlash(_mount, _dir, 'hmg');
            camera.addTrauma(0.04);
            flashedThisFrame = true;
          }
        }
      }
    }

    if (clock.burstFinishedNow) {
      this.stopFireLoop();
      audio.play('metalstorm_shot', { pitch: 0.85, volume: 0.75 });
    } else if (clock.phase !== 'firing') {
      this.stopFireLoop();
    }

    if (clock.reloadFinishedNow) {
      audio.play('reload_cell', { volume: 0.8 });
    }
  }

  idleUpdate(dt: number): void {
    this.silence();
    this.clock.idleUpdate(dt);
  }

  fillRow(row: GunnerWeapon, keyLabel: string, _cycleKeyLabel: string, online: boolean): void {
    row.max = STORM.maxTargets;
    row.selected = false;
    if (!online) {
      row.name = `${keyLabel} METAL STORM // OFFLINE`;
      row.ammo = 0;
      row.reload = -1;
      return;
    }
    const clock = this.clock;
    if (clock.reloading >= 0) {
      row.name = `${keyLabel} METAL STORM // RELOAD`;
      row.ammo = 0;
      row.reload = clock.reloadProgress;
      return;
    }
    if (clock.phase === 'firing') {
      const left = clock.remainingTargets;
      row.name = `${keyLabel} METAL STORM // SWEEPING ${left}`;
      row.ammo = left;
      row.reload = -1;
      row.selected = true;
      return;
    }
    if (clock.phase === 'painting') {
      const count = clock.painter.marks.length;
      if (count === 0) {
        row.name = `${keyLabel} METAL STORM // LOCKING`;
        row.ammo = 0;
        row.reload = -1;
      } else if (!clock.charged) {
        row.name = `${keyLabel} METAL STORM // CHARGING ${count}`;
        row.ammo = count;
        row.reload = clock.chargeProgress;
        row.selected = true;
      } else {
        row.name = `${keyLabel} METAL STORM // LOCKED ${count} [RELEASE]`;
        row.ammo = count;
        row.reload = -1;
        row.selected = true;
      }
      return;
    }
    row.name = `${keyLabel} METAL STORM // READY`;
    row.ammo = STORM.maxTargets;
    row.reload = -1;
  }

  silence(): void {
    this.stopChargeLoop();
    this.stopFireLoop();
  }

  reset(): void {
    this.silence();
    this.clock.reset();
    this.barrelCursor = 0;
    this.snapCount = 0;
    this.chargeFxAccum = 0;
  }

  private stopChargeLoop(): void {
    if (!this.chargeLoop) return;
    this.chargeLoop.stop(0.08);
    this.chargeLoop = null;
    this.chargeFxAccum = 0;
  }

  private stopFireLoop(): void {
    if (!this.fireLoop) return;
    this.fireLoop.stop(0.08);
    this.fireLoop = null;
  }
}

let remoteBarrelCursor = 0;

/** Co-op playback for teammates when a `storm` snap note `[mx, my, mz, tx, ty, tz]` arrives. */
export function playRemoteStorm(ctx: Ctx, kind: MechKind, values: number[]): void {
  if (kind !== 'storm' || values.length < 6) return;
  _rFrom.set(values[0]!, values[1]!, values[2]!);
  _rTo.set(values[3]!, values[4]!, values[5]!);
  _rDir.subVectors(_rTo, _rFrom);
  const lenSq = _rDir.lengthSq();
  if (lenSq < 1e-6) return;
  _rDir.divideScalar(Math.sqrt(lenSq));
  barrelBasis(_rDir, _rRight, _rUp);

  for (let i = 0; i < STORM.remoteTracers; i++) {
    const barrel = (remoteBarrelCursor++ * 3) & 15;
    barrelMuzzle(_rFrom, _rRight, _rUp, barrel, _rMuzzle);
    ctx.fx.tracer(_rMuzzle, _rTo, (i & 1) === 0 ? 'raufoss' : 'carbine');
  }
  ctx.fx.muzzleFlash(_rFrom, _rDir, 'hmg');
  _rNegDir.copy(_rDir).negate();
  ctx.fx.sparks(_rTo, _rNegDir, 6, '#ffd27a');
  ctx.render.lights?.flash(_rFrom, 0xffd070, 4.5, 10, 0.08);
  ctx.audio.play('metalstorm_volley', { position: _rFrom, volume: 0.8, pitchJitter: 0.05 });
}

export const STORM_PLUGIN: ShoulderPlugin = {
  kind: 'storm',
  newsKinds: ['storm'],
  create: ctx => new StormShoulder(ctx),
  remoteNews: playRemoteStorm,
};
