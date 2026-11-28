/**
 * Reusable high-speed rooftop zipline system for Deprecation (`Form 7742-A`).
 *
 * - Procedural 3D braided steel cable, orange safety anchor pylons, pulsing cyan entry ring,
 *   and animated sliding trolley with sparks.
 * - Proximity `[E] ZIPLINE` HUD prompt within `3.5 m` of the start anchor.
 * - High-speed ride (`28 m/s` accelerating up to `34 m/s` on steep descents) where the player
 *   keeps full camera look and one-handed hipfire (never calls `player.park()` or locks weapons).
 * - Pressing `Space` detaches early and calls `player.launch()` with full cable velocity so
 *   momentum chains straight into air-dash or Gaff grapple.
 * - Supports scripted mid-ride `snapAt` (e.g. `0.65`) that detonates the far anchor, severs the
 *   cable visually, launches the player with forward momentum + upward forgiveness lift, and
 *   invokes `onSnap`.
 */
import * as THREE from 'three';
import type { Ctx } from '../../core/contracts';
import { clamp } from '../../core/math';

export type Vec3Like = THREE.Vector3 | readonly [number, number, number];

export type ZiplineDetachReason = 'jump' | 'snap' | 'complete' | 'reset' | 'dead';

export interface ZiplineDef {
  readonly id: string;
  readonly start: Vec3Like;
  readonly end: Vec3Like;
  /** Starting ride speed along the cable in m/s (default 28). */
  readonly baseSpeed?: number;
  /** Maximum ride speed reached on steep downward pitches in m/s (default 34). */
  readonly maxSpeed?: number;
  /** Distance from start anchor within which `[E] ZIPLINE` is shown and attachable (default 3.5 m). */
  readonly attachRadius?: number;
  /** Vertical distance below the cable to position the player's feet while riding (default 2.15 m). */
  readonly hangOffset?: number;
  /** Optional normalized progress `0..1` along the cable at which the far anchor explodes and snaps the wire. */
  readonly snapAt?: number | null;
  /** Upward velocity boost (m/s) applied on scripted cable snap for Gaff grapple forgiveness (default 6.5). */
  readonly snapUpwardLift?: number;
  /** Horizontal momentum retention factor on snap (default 1.0). */
  readonly snapForwardScale?: number;
  /** Upward velocity boost (m/s) applied when detaching early with Space (default 4.5). */
  readonly detachUpwardLift?: number;
  /** Prompt label suffix after key cap (default `'ZIPLINE'`). */
  readonly label?: string;
  readonly onAttach?: (id: string) => void;
  readonly onDetach?: (id: string, reason: ZiplineDetachReason, velocity: THREE.Vector3) => void;
  readonly onSnap?: (id: string, position: THREE.Vector3, velocity: THREE.Vector3) => void;
  readonly onComplete?: (id: string) => void;
}

export interface ZiplineSample {
  readonly position: THREE.Vector3;
  readonly direction: THREE.Vector3;
  readonly length: number;
  /** Downward pitch sine in `[-1, 1]`, positive when descending from start toward end. */
  readonly downwardSin: number;
}

export interface ZiplineRideStepInput {
  readonly start: Vec3Like;
  readonly end: Vec3Like;
  readonly t: number;
  readonly speed: number;
  readonly elapsed: number;
  readonly baseSpeed?: number;
  readonly maxSpeed?: number;
  readonly snapAt?: number | null;
  readonly snapped?: boolean;
}

export interface ZiplineRideStepOutput {
  readonly t: number;
  readonly speed: number;
  readonly elapsed: number;
  readonly position: THREE.Vector3;
  readonly direction: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  readonly snappedNow: boolean;
  readonly completed: boolean;
}

export const ZIPLINE_DEFAULTS = {
  baseSpeed: 28,
  maxSpeed: 34,
  attachRadius: 6.5,
  /** Distance along the start of the cable that also counts for grabbing (helps mid-air / edge catches). */
  attachCableReach: 6.0,
  hangOffset: 2.15,
  snapUpwardLift: 6.5,
  snapForwardScale: 1.0,
  detachUpwardLift: 4.5,
  /** Brief grace period after attaching so a jump-attach doesn't immediately detach on the same press. */
  detachGraceSeconds: 0.12,
  /** Acceleration rate (m/s²) gained per unit downward pitch sine. */
  pitchAccel: 18,
  /** Natural cable acceleration (m/s²) on flat/mild descents so rides feel punchy. */
  flatAccel: 3.5,
} as const;

const UP = new THREE.Vector3(0, 1, 0);
const _tmpStart = new THREE.Vector3();
const _tmpEnd = new THREE.Vector3();
const _tmpDir = new THREE.Vector3();
const _tmpPos = new THREE.Vector3();
const _tmpFeet = new THREE.Vector3();
const _tmpLaunch = new THREE.Vector3();
const _tmpSparkDir = new THREE.Vector3();
const _tmpMid = new THREE.Vector3();
const _tmpQuat = new THREE.Quaternion();

function toVec3(v: Vec3Like, out: THREE.Vector3): THREE.Vector3 {
  if (v instanceof THREE.Vector3) return out.copy(v);
  return out.set(v[0], v[1], v[2]);
}

/**
 * Pure, headless-safe parametric sampler along a zipline cable.
 * `t` is clamped to `[0, 1]`. Optional `sag` adds symmetric catenary droop in meters.
 */
export function sampleZipline(
  start: Vec3Like,
  end: Vec3Like,
  t: number,
  outPos = new THREE.Vector3(),
  outDir = new THREE.Vector3(),
  sag = 0,
): ZiplineSample {
  const s = toVec3(start, _tmpStart);
  const e = toVec3(end, _tmpEnd);
  const ct = clamp(t, 0, 1);

  outDir.subVectors(e, s);
  const length = outDir.length();
  if (length > 1e-6) {
    outDir.divideScalar(length);
  } else {
    outDir.set(0, 0, -1);
  }

  outPos.lerpVectors(s, e, ct);
  if (sag !== 0) {
    outPos.y -= 4 * sag * ct * (1 - ct);
  }

  const downwardSin = clamp(-outDir.y, -1, 1);
  return { position: outPos, direction: outDir, length, downwardSin };
}

/**
 * Pure, headless-safe simulation step for a zipline ride.
 * Accelerates smoothly from `baseSpeed` (`28 m/s`) up to `maxSpeed` (`34 m/s`) on downward pitches,
 * detects scripted `snapAt` crossings, and signals completion at `t >= 1`.
 */
export function stepZiplineRide(input: ZiplineRideStepInput, dt: number): ZiplineRideStepOutput {
  const baseSpeed = input.baseSpeed ?? ZIPLINE_DEFAULTS.baseSpeed;
  const maxSpeed = input.maxSpeed ?? ZIPLINE_DEFAULTS.maxSpeed;
  const clampedDt = Math.max(0, dt);

  const pos = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const sample0 = sampleZipline(input.start, input.end, input.t, pos, dir);
  const length = Math.max(sample0.length, 0.001);

  // Target speed scales smoothly between baseSpeed (flat) and maxSpeed (steep descent >= ~15 deg).
  const steepness = clamp(sample0.downwardSin / 0.26, 0, 1);
  const targetSpeed = baseSpeed + (maxSpeed - baseSpeed) * steepness;
  const accel = ZIPLINE_DEFAULTS.flatAccel + ZIPLINE_DEFAULTS.pitchAccel * Math.max(0, sample0.downwardSin);

  let speed = Math.max(input.speed, baseSpeed);
  if (speed < targetSpeed) {
    speed = Math.min(targetSpeed, speed + accel * clampedDt);
  } else {
    speed = Math.max(targetSpeed, speed - ZIPLINE_DEFAULTS.flatAccel * clampedDt);
  }

  const nextElapsed = input.elapsed + clampedDt;
  const deltaT = (speed * clampedDt) / length;
  let nextT = input.t + deltaT;

  let snappedNow = false;
  if (
    !input.snapped &&
    typeof input.snapAt === 'number' &&
    input.snapAt > 0 &&
    input.snapAt < 1 &&
    nextT >= input.snapAt
  ) {
    nextT = input.snapAt;
    snappedNow = true;
  }

  const completed = !snappedNow && nextT >= 1;
  if (completed) nextT = 1;

  const finalSample = sampleZipline(input.start, input.end, nextT, pos, dir);
  const velocity = dir.clone().multiplyScalar(speed);

  return {
    t: nextT,
    speed,
    elapsed: nextElapsed,
    position: finalSample.position,
    direction: finalSample.direction,
    velocity,
    snappedNow,
    completed,
  };
}

interface ZiplineVisuals {
  root: THREE.Group;
  cable: THREE.Mesh;
  snappedStub: THREE.Mesh;
  entryRing: THREE.Mesh;
  trolley: THREE.Group;
  endPylon: THREE.Group;
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
}

interface ZiplineInstance {
  readonly def: ZiplineDef;
  readonly start: THREE.Vector3;
  readonly end: THREE.Vector3;
  readonly direction: THREE.Vector3;
  readonly length: number;
  readonly baseSpeed: number;
  readonly maxSpeed: number;
  readonly attachRadius: number;
  readonly hangOffset: number;
  readonly snapAt: number | null;
  readonly snapUpwardLift: number;
  readonly snapForwardScale: number;
  readonly detachUpwardLift: number;
  readonly label: string;
  snapped: boolean;
  snapTime: number;
  visuals: ZiplineVisuals | null;
}

export interface ZiplineManagerOptions {
  /** Manager-level callback invoked when any zipline snaps mid-ride. */
  readonly onSnap?: (id: string, position: THREE.Vector3, velocity: THREE.Vector3) => void;
  /** Manager-level callback invoked when the player attaches to any zipline. */
  readonly onAttach?: (id: string) => void;
  /** Manager-level callback invoked when the player detaches from any zipline. */
  readonly onDetach?: (id: string, reason: ZiplineDetachReason, velocity: THREE.Vector3) => void;
}

export class ZiplineManager {
  private readonly lines = new Map<string, ZiplineInstance>();
  private readonly opts: ZiplineManagerOptions;

  private activeLine: ZiplineInstance | null = null;
  private rideT = 0;
  private rideSpeed = 0;
  private rideElapsed = 0;
  private readonly rideVelocity = new THREE.Vector3();
  private sparkAccum = 0;
  private pulseClock = 0;
  private reattachCooldown = 0;

  private promptLineId: string | null = null;
  private promptCleanup: (() => void) | null = null;
  private readonly promptAnchor = new THREE.Vector3();
  private disposed = false;

  constructor(private readonly ctx: Ctx, opts: ZiplineManagerOptions = {}) {
    this.opts = opts;
  }

  /** True while the player is actively riding a zipline. */
  get riding(): boolean {
    return this.activeLine !== null;
  }

  /** Id of the zipline currently being ridden, or null. */
  get activeId(): string | null {
    return this.activeLine?.def.id ?? null;
  }

  /** Normalized progress `0..1` along the currently ridden zipline. */
  get progress(): number {
    return this.activeLine ? this.rideT : 0;
  }

  /** Current speed (m/s) along the active zipline. */
  get speed(): number {
    return this.activeLine ? this.rideSpeed : 0;
  }

  /** Id of the zipline currently showing the `[E] ZIPLINE` proximity prompt, or null. */
  get promptedId(): string | null {
    return this.promptLineId;
  }

  /** Human-readable label of the zipline currently in grab range, or null. */
  get promptedLabel(): string | null {
    return this.promptLineId ? (this.lines.get(this.promptLineId)?.label ?? null) : null;
  }

  /** Human-readable label of the zipline currently being ridden, or null. */
  get activeLabel(): string | null {
    return this.activeLine?.label ?? null;
  }

  /** Registers a zipline and builds its procedural 3D anchors, cable, entry ring, and trolley. */
  add(def: ZiplineDef): void {
    if (this.disposed) return;
    if (this.lines.has(def.id)) {
      this.remove(def.id);
    }

    const start = toVec3(def.start, new THREE.Vector3());
    const end = toVec3(def.end, new THREE.Vector3());
    const direction = new THREE.Vector3().subVectors(end, start);
    const length = Math.max(direction.length(), 0.001);
    direction.divideScalar(length);

    const inst: ZiplineInstance = {
      def,
      start,
      end,
      direction,
      length,
      baseSpeed: def.baseSpeed ?? ZIPLINE_DEFAULTS.baseSpeed,
      maxSpeed: def.maxSpeed ?? ZIPLINE_DEFAULTS.maxSpeed,
      attachRadius: def.attachRadius ?? ZIPLINE_DEFAULTS.attachRadius,
      hangOffset: def.hangOffset ?? ZIPLINE_DEFAULTS.hangOffset,
      snapAt: def.snapAt ?? null,
      snapUpwardLift: def.snapUpwardLift ?? ZIPLINE_DEFAULTS.snapUpwardLift,
      snapForwardScale: def.snapForwardScale ?? ZIPLINE_DEFAULTS.snapForwardScale,
      detachUpwardLift: def.detachUpwardLift ?? ZIPLINE_DEFAULTS.detachUpwardLift,
      label: def.label ?? 'ZIPLINE',
      snapped: false,
      snapTime: 0,
      visuals: this.buildVisuals(start, end, direction, length),
    };

    this.lines.set(def.id, inst);
  }

  /** Removes a registered zipline and cleans up its 3D scene resources. */
  remove(id: string): boolean {
    const inst = this.lines.get(id);
    if (!inst) return false;
    if (this.activeLine === inst) {
      this.detach('reset', false);
    }
    if (this.promptLineId === id) {
      this.clearPrompt();
    }
    this.disposeVisuals(inst);
    this.lines.delete(id);
    return true;
  }

  /** True if the named zipline has already snapped. */
  isSnapped(id: string): boolean {
    return this.lines.get(id)?.snapped ?? false;
  }

  /**
   * Imperatively attaches the player to a registered, intact zipline.
   * Does NOT lock weapons or call `player.park()` so the player retains full camera look & hipfire.
   */
  attach(id: string): boolean {
    const inst = this.lines.get(id);
    const player = this.ctx.player;
    if (!inst || inst.snapped || !player || !player.alive || player.parked) return false;

    this.clearPrompt();
    this.activeLine = inst;
    this.rideT = 0;
    this.rideSpeed = inst.baseSpeed;
    this.rideElapsed = 0;
    this.sparkAccum = 0;
    this.rideVelocity.copy(inst.direction).multiplyScalar(inst.baseSpeed);

    if (inst.visuals) {
      inst.visuals.trolley.visible = true;
      inst.visuals.trolley.position.copy(inst.start);
    }

    this.placePlayerOnCable(inst.start, this.rideVelocity);
    this.ctx.audio?.play?.('metal_clang', { position: inst.start, volume: 0.85, pitch: 1.25 });
    this.ctx.audio?.play?.('stakegun_string', { position: inst.start, volume: 0.7, pitch: 1.1 });
    this.ctx.fx?.sparks?.(inst.start, inst.direction, 10, 0x66e8ff);

    inst.def.onAttach?.(inst.def.id);
    this.opts.onAttach?.(inst.def.id);
    return true;
  }

  /**
   * Detaches the player from the active zipline.
   * When `applyLaunch` is true, invokes `player.launch()` with full cable velocity so momentum
   * chains seamlessly into air-dash or Gaff grapple.
   */
  detach(reason: ZiplineDetachReason = 'jump', applyLaunch = true): void {
    const inst = this.activeLine;
    if (!inst) return;

    this.activeLine = null;
    this.reattachCooldown = 0.45;

    if (inst.visuals) {
      inst.visuals.trolley.visible = false;
    }

    const launchVel = _tmpLaunch.copy(this.rideVelocity);
    if (reason === 'jump') {
      launchVel.y = Math.max(launchVel.y + inst.detachUpwardLift, inst.detachUpwardLift);
    } else if (reason === 'snap') {
      launchVel.x *= inst.snapForwardScale;
      launchVel.z *= inst.snapForwardScale;
      launchVel.y = Math.max(launchVel.y, 0) + inst.snapUpwardLift;
    } else if (reason === 'complete') {
      launchVel.y = Math.max(launchVel.y, 2.5);
    }

    if (applyLaunch && this.ctx.player && this.ctx.player.alive && !this.ctx.player.parked) {
      this.launchPlayerPreservingLook(launchVel);
      if (reason === 'jump') {
        this.ctx.audio?.play?.('reload_bolt', { position: this.ctx.player.eye, volume: 0.7, pitch: 1.2 });
      }
    }

    const outVel = launchVel.clone();
    inst.def.onDetach?.(inst.def.id, reason, outVel);
    this.opts.onDetach?.(inst.def.id, reason, outVel);
  }

  /**
   * Imperatively detonates the far anchor and snaps a zipline (also triggered automatically
   * when riding across `def.snapAt`).
   */
  snap(id: string): boolean {
    const inst = this.lines.get(id);
    if (!inst || inst.snapped) return false;

    inst.snapped = true;
    inst.snapTime = 0;

    if (this.promptLineId === id) {
      this.clearPrompt();
    }

    if (inst.visuals) {
      inst.visuals.cable.visible = false;
      inst.visuals.entryRing.visible = false;
      inst.visuals.snappedStub.visible = true;
      inst.visuals.endPylon.visible = false;
    }

    const blastPos = inst.end.clone();
    this.ctx.events?.emit?.('world:explosion', {
      position: blastPos,
      radius: 7,
      damage: 120,
      kind: 'barrel',
      source: 'zipline_snap',
    });
    this.ctx.fx?.explosion?.(blastPos, { radius: 6.5, kind: 'barrel', scale: 1.15 });
    this.ctx.fx?.sparks?.(blastPos, UP, 28, 0xffaa33);
    this.ctx.audio?.play?.('explosion_barrel', { position: blastPos, volume: 0.95, pitch: 0.92 });
    this.ctx.audio?.play?.('stake_twang', { position: this.ctx.player?.eye ?? blastPos, volume: 1.0, pitch: 0.72 });
    this.ctx.audio?.play?.('metal_clang', { position: blastPos, volume: 0.9, pitch: 0.8 });
    this.ctx.camera?.addTrauma?.(0.38);

    const riderPos = sampleZipline(inst.start, inst.end, this.activeLine === inst ? this.rideT : (inst.snapAt ?? 0.5), new THREE.Vector3(), _tmpDir).position;
    if (this.activeLine === inst) {
      const snapVel = _tmpLaunch.copy(this.rideVelocity);
      snapVel.x *= inst.snapForwardScale;
      snapVel.z *= inst.snapForwardScale;
      snapVel.y = Math.max(snapVel.y, 0) + inst.snapUpwardLift;
      const reportedVel = snapVel.clone();

      this.ctx.fx?.sparks?.(riderPos, UP, 18, 0xffd266);
      this.detach('snap', true);

      inst.def.onSnap?.(inst.def.id, riderPos, reportedVel);
      this.opts.onSnap?.(inst.def.id, riderPos, reportedVel);
    } else {
      const zeroVel = new THREE.Vector3();
      inst.def.onSnap?.(inst.def.id, riderPos, zeroVel);
      this.opts.onSnap?.(inst.def.id, riderPos, zeroVel);
    }

    return true;
  }

  /** Per-frame update: handles proximity prompts, ride physics, sparks, snap trigger, and visuals. */
  update(dt: number): void {
    if (this.disposed || dt <= 0) return;
    this.pulseClock += dt;
    if (this.reattachCooldown > 0) {
      this.reattachCooldown = Math.max(0, this.reattachCooldown - dt);
    }

    this.updateVisualAnimations(dt);

    const player = this.ctx.player;
    if (!player) return;

    if (this.activeLine) {
      this.updateActiveRide(dt);
      return;
    }

    if (!player.alive || player.parked || this.reattachCooldown > 0) {
      this.clearPrompt();
      return;
    }

    this.updateProximityAndAttach();
  }

  /** Restores all ziplines to intact/un-snapped state and detaches any active rider. */
  reset(): void {
    if (this.activeLine) {
      this.detach('reset', false);
    }
    this.clearPrompt();
    this.rideT = 0;
    this.rideSpeed = 0;
    this.rideElapsed = 0;
    this.rideVelocity.set(0, 0, 0);
    this.reattachCooldown = 0;
    this.sparkAccum = 0;
    this.pulseClock = 0;

    for (const inst of this.lines.values()) {
      inst.snapped = false;
      inst.snapTime = 0;
      if (inst.visuals) {
        inst.visuals.cable.visible = true;
        inst.visuals.entryRing.visible = true;
        inst.visuals.snappedStub.visible = false;
        inst.visuals.endPylon.visible = true;
        inst.visuals.trolley.visible = false;
      }
    }
  }

  /** Tears down all meshes, geometries, materials, and HUD prompts. */
  dispose(): void {
    if (this.disposed) return;
    if (this.activeLine) {
      this.detach('reset', false);
    }
    this.clearPrompt();
    for (const inst of this.lines.values()) {
      this.disposeVisuals(inst);
    }
    this.lines.clear();
    this.disposed = true;
  }

  // -------------------------------------------------------------------------------------------
  // Internal ride & prompt logic
  // -------------------------------------------------------------------------------------------

  private updateProximityAndAttach(): void {
    const player = this.ctx.player;
    const input = this.ctx.input;
    let nearest: ZiplineInstance | null = null;
    let nearestDistSq = Infinity;

    for (const inst of this.lines.values()) {
      if (inst.snapped) continue;
      // Measure against the entry segment of the cable (start..start+6 m) at both feet and chest height
      // so walking up to the pylon OR leaping off the lip onto the wire catches cleanly.
      const reach = Math.min(ZIPLINE_DEFAULTS.attachCableReach, inst.length);
      const px = player.position.x - inst.start.x;
      const py = player.position.y + 1.1 - inst.start.y;
      const pz = player.position.z - inst.start.z;
      const proj = clamp(
        px * inst.direction.x + py * inst.direction.y + pz * inst.direction.z,
        0,
        reach,
      );
      const cx = inst.start.x + inst.direction.x * proj;
      const cy = inst.start.y + inst.direction.y * proj;
      const cz = inst.start.z + inst.direction.z * proj;

      const dx = player.position.x - cx;
      const dz = player.position.z - cz;
      const chestY = player.position.y + 1.2;
      const dy = Math.min(Math.abs(player.position.y - cy), Math.abs(chestY - cy));
      const dSq = dx * dx + dy * dy + dz * dz;
      const r = inst.attachRadius;
      if (dSq <= r * r && dSq < nearestDistSq) {
        nearestDistSq = dSq;
        nearest = inst;
      }
    }

    if (!nearest) {
      this.clearPrompt();
      return;
    }

    if (this.promptLineId !== nearest.def.id) {
      this.clearPrompt();
      this.promptLineId = nearest.def.id;
      this.promptAnchor.copy(nearest.start);
      this.promptAnchor.y += 0.35;
      const key = input?.labelFor?.('interact') ?? 'E';
      if (this.ctx.hud?.follow) {
        this.promptCleanup = this.ctx.hud.follow(this.promptAnchor, `[${key}] ${nearest.label}`, '#22e8ff');
      }
    }

    const interactTriggered =
      Boolean(input?.pressed?.('interact')) || Boolean(input?.isDown?.('interact'));
    if (interactTriggered) {
      this.attach(nearest.def.id);
    }
  }

  private updateActiveRide(dt: number): void {
    const inst = this.activeLine!;
    const player = this.ctx.player;

    if (!player.alive || player.parked) {
      this.detach('dead', false);
      return;
    }

    // Pressing Space detaches early with full cable momentum (after brief attach grace).
    if (this.rideElapsed >= ZIPLINE_DEFAULTS.detachGraceSeconds && this.ctx.input?.pressed?.('jump')) {
      this.detach('jump', true);
      return;
    }

    const step = stepZiplineRide(
      {
        start: inst.start,
        end: inst.end,
        t: this.rideT,
        speed: this.rideSpeed,
        elapsed: this.rideElapsed,
        baseSpeed: inst.baseSpeed,
        maxSpeed: inst.maxSpeed,
        snapAt: inst.snapAt,
        snapped: inst.snapped,
      },
      dt,
    );

    this.rideT = step.t;
    this.rideSpeed = step.speed;
    this.rideElapsed = step.elapsed;
    this.rideVelocity.copy(step.velocity);

    if (inst.visuals) {
      inst.visuals.trolley.position.copy(step.position);
    }

    this.placePlayerOnCable(step.position, this.rideVelocity);

    // Friction sparks trailing off the high-speed sliding trolley.
    this.sparkAccum += dt;
    if (this.sparkAccum >= 0.045) {
      this.sparkAccum = 0;
      _tmpSparkDir.copy(inst.direction).multiplyScalar(-1).addScaledVector(UP, 0.35).normalize();
      this.ctx.fx?.sparks?.(step.position, _tmpSparkDir, 3, 0xffcc55);
    }

    if (step.snappedNow) {
      this.snap(inst.def.id);
      return;
    }

    if (step.completed) {
      const id = inst.def.id;
      const onComplete = inst.def.onComplete;
      this.detach('complete', true);
      onComplete?.(id);
    }
  }

  /**
   * Positions the player cleanly under the trolley while preserving mouse look (`yaw`, `pitch`)
   * and keeping weapons fully usable (never parks the player).
   */
  private placePlayerOnCable(cablePos: THREE.Vector3, velocity: THREE.Vector3): void {
    const player = this.ctx.player;
    const savedYaw = player.yaw;
    const savedPitch = player.pitch;

    _tmpFeet.set(cablePos.x, cablePos.y - (this.activeLine?.hangOffset ?? ZIPLINE_DEFAULTS.hangOffset), cablePos.z);
    player.teleport(_tmpFeet, savedYaw);

    // Restore pitch & look vector (Player.teleport resets pitch to 0).
    player.pitch = savedPitch;
    const cp = Math.cos(savedPitch);
    player.forward.set(-Math.sin(savedYaw) * cp, Math.sin(savedPitch), -Math.cos(savedYaw) * cp);
    player.velocity.copy(velocity);
  }

  private launchPlayerPreservingLook(launchVel: THREE.Vector3): void {
    const player = this.ctx.player;
    const savedYaw = player.yaw;
    const savedPitch = player.pitch;
    _tmpFeet.copy(player.position);

    // Teleport zeroes internal `this.v` so `player.launch()` applies exact momentum without doubling.
    player.teleport(_tmpFeet, savedYaw);
    player.pitch = savedPitch;
    const cp = Math.cos(savedPitch);
    player.forward.set(-Math.sin(savedYaw) * cp, Math.sin(savedPitch), -Math.cos(savedYaw) * cp);
    player.launch(launchVel);
  }

  private clearPrompt(): void {
    this.promptCleanup?.();
    this.promptCleanup = null;
    this.promptLineId = null;
  }

  // -------------------------------------------------------------------------------------------
  // Procedural 3D visuals
  // -------------------------------------------------------------------------------------------

  private buildVisuals(
    start: THREE.Vector3,
    end: THREE.Vector3,
    direction: THREE.Vector3,
    length: number,
  ): ZiplineVisuals | null {
    const scene = this.ctx.render?.scene;
    if (!scene) return null;

    const root = new THREE.Group();
    const geometries: THREE.BufferGeometry[] = [];
    const materials: THREE.Material[] = [];

    const orangeMat = new THREE.MeshStandardMaterial({
      color: 0xff6a1a,
      roughness: 0.45,
      metalness: 0.55,
      emissive: 0x331200,
      emissiveIntensity: 0.35,
    });
    const steelMat = new THREE.MeshStandardMaterial({
      color: 0x6c7682,
      roughness: 0.35,
      metalness: 0.85,
    });
    const cableMat = new THREE.MeshStandardMaterial({
      color: 0xb8c4d0,
      roughness: 0.3,
      metalness: 0.9,
    });
    const ringMat = new THREE.MeshStandardMaterial({
      color: 0x22e8ff,
      emissive: 0x22e8ff,
      emissiveIntensity: 1.6,
      roughness: 0.2,
      metalness: 0.1,
      transparent: true,
      opacity: 0.85,
    });
    materials.push(orangeMat, steelMat, cableMat, ringMat);

    // Main tensioned braided steel cable stretched between start and end anchors.
    const cableGeo = new THREE.CylinderGeometry(0.055, 0.055, length, 6, 1, false);
    geometries.push(cableGeo);
    const cable = new THREE.Mesh(cableGeo, cableMat);
    _tmpMid.addVectors(start, end).multiplyScalar(0.5);
    cable.position.copy(_tmpMid);
    _tmpQuat.setFromUnitVectors(UP, direction);
    cable.quaternion.copy(_tmpQuat);
    root.add(cable);

    // Severed dangling stub (shown after scripted snap).
    const stubLen = Math.min(length * 0.32, 14);
    const stubGeo = new THREE.CylinderGeometry(0.048, 0.044, stubLen, 6, 1, false);
    stubGeo.translate(0, -stubLen * 0.5, 0);
    geometries.push(stubGeo);
    const snappedStub = new THREE.Mesh(stubGeo, cableMat);
    snappedStub.position.copy(start);
    snappedStub.visible = false;
    root.add(snappedStub);

    // Start & end orange anchor pylons.
    const pylonPostGeo = new THREE.BoxGeometry(0.36, 2.8, 0.36);
    const pylonBaseGeo = new THREE.BoxGeometry(0.75, 0.24, 0.75);
    const pulleyGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.16, 10);
    pulleyGeo.rotateZ(Math.PI / 2);
    geometries.push(pylonPostGeo, pylonBaseGeo, pulleyGeo);

    const makePylon = (anchor: THREE.Vector3): THREE.Group => {
      const g = new THREE.Group();
      g.position.copy(anchor);
      const post = new THREE.Mesh(pylonPostGeo, orangeMat);
      post.position.y = -1.4;
      const base = new THREE.Mesh(pylonBaseGeo, steelMat);
      base.position.y = -2.68;
      const pulley = new THREE.Mesh(pulleyGeo, steelMat);
      pulley.position.y = 0.08;
      g.add(post, base, pulley);
      return g;
    };

    const startPylon = makePylon(start);
    const endPylon = makePylon(end);
    root.add(startPylon, endPylon);

    // Large pulsing cyan entry ring around the start anchor so it reads from across the roof.
    const ringGeo = new THREE.TorusGeometry(1.35, 0.08, 10, 28);
    geometries.push(ringGeo);
    const entryRing = new THREE.Mesh(ringGeo, ringMat);
    entryRing.position.copy(start);
    entryRing.lookAt(end);
    root.add(entryRing);

    // Sliding trolley assembly (visible while riding).
    const trolley = new THREE.Group();
    const trolleyBodyGeo = new THREE.BoxGeometry(0.24, 0.26, 0.44);
    const handleBarGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.52, 8);
    handleBarGeo.rotateZ(Math.PI / 2);
    geometries.push(trolleyBodyGeo, handleBarGeo);

    const trolleyBody = new THREE.Mesh(trolleyBodyGeo, orangeMat);
    const handleBar = new THREE.Mesh(handleBarGeo, steelMat);
    handleBar.position.y = -0.35;
    trolley.add(trolleyBody, handleBar);
    trolley.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), direction);
    trolley.visible = false;
    root.add(trolley);

    scene.add(root);
    return { root, cable, snappedStub, entryRing, trolley, endPylon, geometries, materials };
  }

  private updateVisualAnimations(dt: number): void {
    for (const inst of this.lines.values()) {
      const v = inst.visuals;
      if (!v) continue;

      if (!inst.snapped) {
        const pulse = 1 + Math.sin(this.pulseClock * 4.5) * 0.1;
        v.entryRing.scale.setScalar(pulse);
        v.entryRing.rotation.z += dt * 1.4;
      } else {
        inst.snapTime += dt;
        // Subtle pendulum sway on the severed cable stub.
        const sway = Math.sin(inst.snapTime * 3.8) * Math.exp(-inst.snapTime * 0.65) * 0.35;
        v.snappedStub.rotation.z = sway;
      }
    }
  }

  private disposeVisuals(inst: ZiplineInstance): void {
    const v = inst.visuals;
    if (!v) return;
    this.ctx.render?.scene?.remove?.(v.root);
    for (const g of v.geometries) g.dispose();
    for (const m of v.materials) m.dispose();
    inst.visuals = null;
  }
}
