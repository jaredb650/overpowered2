/**
 * The one owner of the camera. Runs after gameplay each frame and composes:
 *   FOV       = base + speed curve + punches, blended to the zoom override
 *   position  = player.eye + head bob + landing dip
 *   rotation  = look + spring kick + 50 ms shake + wall and slide roll
 *
 * Mouse look goes straight through: player.yaw and player.pitch are the frame's raw motion, and nothing here smooths
 * them. Every term added on top decays to exactly 0, so a level view is level. Normal running has no roll at all.
 *
 * Shake and kicks run on real time so a hit-stop freeze still jolts. Bob and speed FOV follow player time.
 */
import * as THREE from 'three';
import type { CameraRig, Ctx, SeatView } from '../core/contracts';
import { clamp, damp, lerp, rand, smoothstep } from '../core/math';
import { settle, springStep, type SpringState } from './moveMath';
import { FEEDBACK, VIEW } from './tuning';

const MAX_PUNCHES = 8;
const DEG = Math.PI / 180;
const UP = new THREE.Vector3();
const FORWARD = new THREE.Vector3();
const LISTENER = new THREE.Vector3();

interface Punch {
  degrees: number;
  left: number;
  duration: number;
}

export class CameraRigSystem implements CameraRig {
  fov = VIEW.baseFov;

  private baseFov = VIEW.baseFov;
  private speedFov = 0;
  private zoomFov: number | null = null;
  private zoomBlend = 0;
  private lastZoomFov = VIEW.baseFov;
  private punches: Punch[] = Array.from({ length: MAX_PUNCHES }, () => ({ degrees: 0, left: 0, duration: 1 }));

  private trauma = 0;
  private shakeHold = 0;
  private shakeP = 0;
  private shakeR = 0;
  private shakeY = 0;

  private kickP: SpringState = { x: 0, v: 0 };
  private kickY: SpringState = { x: 0, v: 0 };
  private kickR: SpringState = { x: 0, v: 0 };
  private dip: SpringState = { x: 0, v: 0 };

  private bobAmount = 0;
  private roll = 0;
  private wallRoll = 0;
  private unsub: (() => void)[] = [];
  private seat: SeatView | null = null;

  constructor(private readonly ctx: Ctx) {}

  init(): void {
    const { events } = this.ctx;
    this.unsub.push(
      events.on('player:landed', e => this.onLanded(e.impact)),
      events.on('player:slam', e => {
        const k = clamp(e.impact / FEEDBACK.slamFullAt, 0.3, 1);
        this.addTrauma(0.45 + 0.4 * k);
        this.dip.v -= 1.5 + 2.5 * k;
        this.fovPunch(VIEW.slamPunch + VIEW.slamPunchHard * k, 0.28);
      }),
      events.on('player:dashed', () => this.fovPunch(VIEW.dashPunch, 0.22)),
      events.on('player:jumped', e => {
        // A little push up through the knees, so leaving the ground has weight too.
        this.dip.v += VIEW.jumpLift;
        if (e.double) this.kick(-0.012, 0, 0);
      }),
      events.on('player:mantle', e => this.kick(0.03 + e.height * 0.012, 0, 0)),
      events.on('player:slide', e => { if (e.active) this.fovPunch(VIEW.slidePunch, 0.3); }),
      events.on('player:damaged', e => this.addTrauma(clamp(e.amount / 60, 0.15, 0.7))),
    );
  }

  addTrauma(amount: number): void {
    const felt = amount * (this.seat?.shake ?? 1);
    // Max, not sum: repeated SMG shots stay small, and a small shake never cancels a big one.
    if (felt <= this.trauma) return;
    this.trauma = Math.min(1, felt);
    // A new peak snaps on the very next frame, which is the point of the original's two-frame shake.
    this.shakeHold = 0;
  }

  kick(pitch: number, yaw: number, roll = 0): void {
    this.kickP.x += pitch;
    this.kickY.x += yaw;
    this.kickR.x += roll;
  }

  fovPunch(degrees: number, seconds: number): void {
    let slot = this.punches[0]!;
    for (const p of this.punches) {
      if (p.left <= 0) {
        slot = p;
        break;
      }
      if (p.left < slot.left) slot = p;
    }
    slot.degrees = degrees;
    slot.left = seconds;
    slot.duration = seconds;
  }

  setZoom(fov: number | null): void {
    this.zoomFov = fov;
    if (fov !== null) this.lastZoomFov = fov;
  }

  setBaseFov(degrees: number): void {
    this.baseFov = degrees;
  }

  setSeat(view: SeatView | null): void {
    this.seat = view;
  }

  private onLanded(impact: number): void {
    const k = Math.min(impact, VIEW.dipMaxImpact);
    this.dip.v -= k * VIEW.dipPerImpact;
    this.kickP.x -= Math.min(impact * VIEW.landNod, VIEW.landNodMax);
    if (impact > VIEW.landShakeFrom) this.addTrauma(clamp((impact - VIEW.landShakeFrom) / 40, 0.1, 0.45));
  }

  update(): void {
    const { render, time, player, audio } = this.ctx;
    const dt = time.playerDt;
    const real = time.realDt;
    if (time.paused) return;

    this.updateFov(dt, real);
    this.updateShake(real);
    springStep(this.kickP, VIEW.kickOmega, VIEW.kickZeta, real);
    springStep(this.kickY, VIEW.kickOmega, VIEW.kickZeta, real);
    springStep(this.kickR, VIEW.kickOmega, VIEW.kickZeta, real);
    springStep(this.dip, VIEW.dipOmega, VIEW.dipZeta, dt);

    const yaw = player.yaw;
    const sinY = Math.sin(yaw);
    const cosY = Math.cos(yaw);
    const v = player.velocity;
    let rollTarget = 0;
    if (!player.alive) rollTarget = VIEW.deathRoll * DEG;
    else if (player.sliding) {
      // Sideways speed in the view's frame leans a slide.
      const lateral = v.x * cosY - v.z * sinY;
      rollTarget = -clamp(lateral / VIEW.slideRollRef, -1, 1) * VIEW.slideRoll * DEG;
    }
    this.roll = settle(damp(this.roll, rollTarget, VIEW.rollRate, dt), rollTarget);
    // Feet go to the wall and the head tips away from it, so the wall rolls under the player, as in Titanfall.
    const wallTarget = player.wallSide * VIEW.wallRoll * DEG;
    this.wallRoll = settle(damp(this.wallRoll, wallTarget, VIEW.wallRollRate, dt), wallTarget);

    const onFoot = player.grounded && !player.sliding;
    const speed = player.speed;
    const bobTarget = onFoot || player.wallRunning ? smoothstep(1, VIEW.bobInSpeed, speed) : 0;
    this.bobAmount = damp(this.bobAmount, bobTarget, VIEW.bobRate, dt);
    const phase = player.stridePhase * Math.PI;
    // Lowest on the foot plant, where stridePhase is whole, with the sharp bottom a footfall has.
    const bobY = -(1 - Math.abs(Math.sin(phase))) * VIEW.bobHeight * this.bobAmount;
    const bobX = Math.cos(phase) * VIEW.bobSide * this.bobAmount;

    const cam = render.camera;
    cam.rotation.order = 'YXZ';
    const seat = this.seat;
    if (seat) {
      cam.position.copy(seat.position);
      cam.rotation.set(seat.pitch + this.kickP.x + this.shakeP, seat.yaw + this.kickY.x + this.shakeY, seat.roll + this.kickR.x + this.shakeR);
    } else {
      cam.position.copy(player.eye);
      cam.position.x += cosY * bobX;
      cam.position.z -= sinY * bobX;
      cam.position.y += bobY + this.dip.x;
      cam.rotation.set(
        player.pitch + this.kickP.x + this.shakeP,
        yaw + this.kickY.x + this.shakeY,
        this.roll + this.wallRoll + this.kickR.x + this.shakeR,
      );
    }
    if (Math.abs(this.fov - cam.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();

    const view = render.viewCamera;
    view.rotation.order = 'YXZ';
    view.rotation.set(this.shakeP * VIEW.shakeView, this.shakeY * VIEW.shakeView, this.shakeR * VIEW.shakeView);
    view.position.set(this.shakeY * VIEW.shakeViewOffset * 8, this.shakeP * VIEW.shakeViewOffset * 8, 0);
    view.updateMatrixWorld();

    FORWARD.set(0, 0, -1).applyQuaternion(cam.quaternion);
    UP.set(0, 1, 0).applyQuaternion(cam.quaternion);
    LISTENER.copy(cam.position);
    audio.setListener(LISTENER, FORWARD, UP);
  }

  private updateFov(dt: number, real: number): void {
    const { player } = this.ctx;
    // Horizontal speed only: a fall is not speed the player earned, and opening the view would soften the landing.
    const target = VIEW.fovSpeedAdd * smoothstep(VIEW.fovSpeedFrom, VIEW.fovSpeedFull, player.speed);
    this.speedFov = damp(this.speedFov, target, target > this.speedFov ? VIEW.fovRiseRate : VIEW.fovFallRate, dt);

    let punch = 0;
    for (const p of this.punches) {
      if (p.left <= 0) continue;
      p.left -= real;
      if (p.left <= 0) continue;
      const k = p.left / p.duration;
      punch += p.degrees * k * k;
    }

    const free = this.baseFov + this.speedFov + punch;
    this.zoomBlend = damp(this.zoomBlend, this.zoomFov === null ? 0 : 1, VIEW.zoomRate, real);
    if (this.zoomFov === null && this.zoomBlend < 0.001) this.zoomBlend = 0;
    this.fov = lerp(free, this.lastZoomFov, this.zoomBlend);

    // The same mouse motion should move the same distance on screen at any zoom. Only the scope changes it:
    // speed FOV must not change aim feel while running.
    const zoomed = lerp(this.baseFov, this.lastZoomFov, this.zoomBlend);
    player.lookScale = Math.tan((zoomed * DEG) / 2) / Math.tan((this.baseFov * DEG) / 2);
  }

  private updateShake(real: number): void {
    this.trauma = Math.max(0, this.trauma - VIEW.traumaDecay * real);
    this.shakeHold -= real;
    if (this.shakeHold > 0) return;
    this.shakeHold = VIEW.shakeHold;
    const a = this.trauma * this.trauma;
    this.shakeP = rand(-1, 1) * a * VIEW.shakePitch;
    this.shakeR = rand(-1, 1) * a * VIEW.shakeRoll;
    this.shakeY = rand(-1, 1) * a * VIEW.shakeYaw;
  }

  reset(): void {
    this.seat = null;
    this.trauma = 0;
    this.shakeP = this.shakeR = this.shakeY = 0;
    this.kickP.x = this.kickP.v = this.kickY.x = this.kickY.v = this.kickR.x = this.kickR.v = 0;
    this.dip.x = this.dip.v = 0;
    this.speedFov = 0;
    this.roll = this.wallRoll = 0;
    this.zoomFov = null;
    this.zoomBlend = 0;
    for (const p of this.punches) p.left = 0;
  }
}
