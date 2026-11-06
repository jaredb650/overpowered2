/**
 * The player: fixed-step character controller, movement state machine, health.
 *
 * Simulation runs in 120 Hz ticks on ctx.time.playerDt, which makes a strafe arc or a wall run identical at any
 * frame rate. `pos` is the true simulated feet position; `position` and `eye` are interpolated between the last
 * two ticks for display. Input edges are latched per frame and spent by the next tick, because at 144 fps some
 * frames run no tick at all.
 */
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type {
  Ctx, PlayerDamage, PlayerModifiers, PlayerMoveState, PlayerSystem, SurfaceKind,
} from '../core/contracts';
import { clamp, damp, lerp } from '../core/math';
import { CapsuleWorld, newSweepHit } from './collide';
import { MovementFeedback } from './feedback';
import {
  airSteer, approachVector, clipVelocity, moveToward, quakeAccelerate, redirectOntoPlane, rotateToward, slamBounceSpeed,
  softLimit,
} from './moveMath';
import { MOVE as T } from './tuning';

const MAX_SLIDE_ITERATIONS = 5;
/** Below this, an obstacle's top is a lip the capsule's round bottom simply rolls over. */
const FLAT_NORMAL_Y = 0.999;
const DOWN = new THREE.Vector3(0, -1, 0);
const NEUTRAL_MODIFIERS: PlayerModifiers = { speed: 1, jump: 1, damageTaken: 1, invulnerable: false, infiniteDash: false };

export class Player implements PlayerSystem {
  readonly position = new THREE.Vector3();
  readonly eye = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  readonly forward = new THREE.Vector3(0, 0, -1);
  yaw = 0;
  pitch = 0;
  health = T.maxHealth;
  maxHealth = T.maxHealth;
  armor = 0;
  modifiers: PlayerModifiers = { ...NEUTRAL_MODIFIERS };
  interceptor: ((damage: PlayerDamage) => boolean) | null = null;
  /** Radians of look per pixel. */
  sensitivity = T.sensitivity;
  invertY = false;
  lookScale = 1;
  parked = false;
  /** Seconds left of being untouchable after a seat. */
  private parkGrace = 0;
  /** A player setting: holding Space hops on every landing instead of needing a fresh press. */
  holdToHop = T.holdToHop;

  // Movement state ---------------------------------------------------------------------------------------------
  grounded = false;
  sliding = false;
  crouched = false;
  wallRunning = false;
  slamming = false;
  mantling = false;
  alive = true;
  dashCharges = T.dashCharges;
  /** -1 wall on the left of the view, +1 on the right, 0 none. */
  wallSide = 0;
  /** What the player last stood on, for footsteps. */
  groundSurface: SurfaceKind = 'concrete';
  /** Footstep clock: whole numbers are foot plants. Advances with distance, so it is tied to true velocity. */
  stridePhase = 0;
  /** Seconds since last touching the ground. */
  airTime = 0;
  /** Highest horizontal speed reached since reset, for tests and the speedometer. */
  peakSpeed = 0;

  private ctx: Ctx;
  private body!: CapsuleWorld;
  private feedback: MovementFeedback;

  /** Simulated feet position. */
  private readonly pos = new THREE.Vector3();
  private readonly prev = new THREE.Vector3();
  private readonly v = this.velocity;
  private height: number = T.standHeight;
  private readonly groundN = new THREE.Vector3(0, 1, 0);
  /** Horizontal normal of the wall last tick's move ran into, if it ran into one. */
  private readonly wallPressN = new THREE.Vector3();
  private wallPressed = false;
  private readonly floorN = new THREE.Vector3(0, 1, 0);
  private floorDrop = 0;
  private floorCollider: RAPIER.Collider | null = null;
  private groundCollider: RAPIER.Collider | null = null;
  private minWalkY = Math.cos((T.maxSlopeDeg * Math.PI) / 180);
  private accumulator = 0;
  private simYaw = 0;
  private eyeHeight: number = T.eyeStand;
  private stepSmooth = 0;
  private fixedDt = 1 / T.hz;

  // Input for the tick
  private fwd = 0;
  private side = 0;
  private wishX = 0;
  private wishZ = 0;
  private hasWish = false;
  private jumpHeld = false;
  private slideHeld = false;
  private jumpBufferT = 0;
  private jumpFresh = false;
  private dashBufferT = 0;
  private slideLatch = false;
  /** A slide pressed in the air, waiting for the ground. */
  private slideQueued = false;

  // Timers
  private coyoteT = 0;
  private noGroundT = 0;
  private landGraceT = 0;
  private landWeightT = 0;
  private slideCooldownT = 0;
  private dashT = 0;
  private noWallT = 0;
  private wallCoyoteT = 0;
  private bounceT = 0;
  private lastDamageT = 0;
  private wallRunT = 0;

  /** Horizontal velocity at touchdown, which a hop caught in the landing window gets back. */
  private hopVx = 0;
  private hopVz = 0;
  /** Fraction of run speed the current landing took away. */
  private landWeight = 0;
  /** Thrown by something other than the player's legs. Pads are aimed, so air drag must leave them alone. */
  private flung = false;
  private hasDoubleJump = true;
  private dashDirX = 0;
  private dashDirZ = 0;
  private dashEntrySpeed = 0;
  private dashGrounded = false;
  private dashStartSpeed = 0;
  private slamStartY = 0;
  private slamFall = 0;
  private preStepVy = 0;

  private readonly wallN = new THREE.Vector3();
  private readonly wallT = new THREE.Vector3();
  /** The last wall kicked from or run on: same plane cannot be reused until landing or touching another wall. */
  private readonly lastWallN = new THREE.Vector3();
  private readonly lastWallPoint = new THREE.Vector3();
  private hasLastWall = false;
  private readonly coyoteWallN = new THREE.Vector3();

  private mantleFrom = 0;
  private mantleTo = 0;
  private mantleTime = 0;
  private mantleDuration = 0;
  private mantleDirX = 0;
  private mantleDirZ = 0;

  // Scratch
  private readonly hit = newSweepHit();
  private readonly hit2 = newSweepHit();
  private readonly hit3 = newSweepHit();
  private readonly motion = new THREE.Vector3();
  private readonly moveStart = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly planes = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];

  constructor(ctx: Ctx) {
    this.ctx = ctx;
    this.feedback = new MovementFeedback(ctx, this);
  }

  /** Unit normal of the wall being run on. Stale when not wall running. */
  get wallNormal(): THREE.Vector3 {
    return this.wallN;
  }

  get dashing(): boolean {
    return this.dashT > 0;
  }

  /** Horizontal speed. */
  get speed(): number {
    return Math.hypot(this.v.x, this.v.z);
  }

  get state(): PlayerMoveState {
    if (!this.alive) return 'dead';
    if (this.mantling) return 'mantle';
    if (this.dashT > 0) return 'dash';
    if (this.slamming) return 'slam';
    if (this.wallRunning) return 'wallrun';
    if (this.sliding) return 'slide';
    if (this.grounded) return this.crouched ? 'crouch' : 'ground';
    return 'air';
  }

  init(): void {
    this.ensureBody();
    this.feedback.init();
  }

  private ensureBody(): void {
    if (!this.body) this.body = new CapsuleWorld(this.ctx.physics, T.radius, T.collisionMask);
  }

  // --- Frame ---------------------------------------------------------------------------------------------------

  update(): void {
    this.ensureBody();
    const { time, input } = this.ctx;
    const dt = time.playerDt;
    const look = input.consumeLook();
    if (time.paused) return;
    this.parkGrace = Math.max(0, this.parkGrace - dt);
    // The look still has to be consumed: `input.frameLook` is what the seat aims with.
    if (this.parked) {
      this.updateHealth(dt);
      this.feedback.update(dt);
      return;
    }

    if (this.alive) {
      const scale = this.sensitivity * this.lookScale;
      this.yaw -= look.x * scale;
      this.pitch = clamp(this.pitch - look.y * scale * (this.invertY ? -1 : 1), -T.pitchLimit, T.pitchLimit);
      this.sampleInput();
    } else {
      this.clearInput();
    }

    this.fixedDt = 1 / T.hz;
    this.accumulator += dt;
    const ticks = Math.floor(this.accumulator / this.fixedDt);
    if (ticks > 0) {
      // Mouse motion is spread across the frame's ticks, so a 30 fps frame's yaw sweep stays a curve rather
      // than a corner. Strafe gain depends on that curve.
      const startYaw = this.simYaw;
      for (let i = 1; i <= ticks; i++) {
        this.simYaw = lerp(startYaw, this.yaw, i / ticks);
        this.tick(this.fixedDt);
      }
      this.accumulator -= ticks * this.fixedDt;
    }

    const cp = Math.cos(this.pitch);
    this.forward.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);

    const alpha = this.accumulator / this.fixedDt;
    this.position.lerpVectors(this.prev, this.pos, alpha);

    const eyeTarget = this.alive ? (this.sliding ? T.eyeSlide : this.crouched ? T.eyeCrouch : T.eyeStand) : 0.35;
    this.eyeHeight = damp(this.eyeHeight, eyeTarget, T.eyeRate, dt);
    this.stepSmooth = damp(this.stepSmooth, 0, T.stepSmoothRate, dt);
    this.eye.copy(this.position);
    this.eye.y += this.eyeHeight + this.stepSmooth;

    this.updateHealth(dt);
    this.feedback.update(dt);
    this.rescueIfLost();
  }

  /** A gap in the map must not end a run with the player falling forever, even under invulnerability. */
  private rescueIfLost(): void {
    const floor = this.ctx.world.bounds?.min?.y;
    if (typeof floor !== 'number' || this.pos.y > floor - T.lostBelowWorld) return;
    const spawns = this.ctx.world.playerSpawns;
    if (Array.isArray(spawns) && spawns[0]) this.teleport(spawns[0].position, spawns[0].yaw);
  }

  private sampleInput(): void {
    const { input } = this.ctx;
    this.fwd = (input.isDown('forward') ? 1 : 0) - (input.isDown('back') ? 1 : 0);
    this.side = (input.isDown('right') ? 1 : 0) - (input.isDown('left') ? 1 : 0);
    this.jumpHeld = input.isDown('jump');
    this.slideHeld = input.isDown('slide');
    if (input.pressed('jump')) {
      this.jumpBufferT = T.jumpBuffer;
      this.jumpFresh = true;
    }
    if (input.pressed('dash')) this.dashBufferT = T.dashBuffer;
    if (input.pressed('slide')) this.slideLatch = true;
    if (!this.slideHeld) this.slideQueued = false;
  }

  private clearInput(): void {
    this.fwd = this.side = 0;
    this.jumpHeld = this.slideHeld = this.jumpFresh = this.slideLatch = this.slideQueued = false;
    this.jumpBufferT = this.dashBufferT = 0;
  }

  // --- Tick ----------------------------------------------------------------------------------------------------

  private tick(h: number): void {
    this.prev.copy(this.pos);
    this.tickTimers(h);
    this.computeWish();
    this.preStepVy = this.v.y;

    if (this.mantling) {
      this.mantleTick(h);
      return;
    }
    if (!this.alive) {
      this.deadTick(h);
      return;
    }

    this.updateCrouch();
    this.handleJump();
    this.handleDash();
    this.handleSlideKey();

    if (this.dashT > 0) this.dashForces();
    else if (this.wallRunning) this.wallForces(h);
    else if (this.grounded) {
      if (this.sliding) this.slideForces(h);
      else this.groundForces(h);
    } else if (this.slamming) this.slamForces(h);
    else this.airForces(h);

    this.applySoftCap(h);
    this.rideGround(h);
    this.moveAndCollide(h);
    if (this.mantling) return;

    this.categorize();
    if (this.wallRunning) this.wallStick();

    if (this.dashT > 0) this.dashAfterMove(h);
    if (this.sliding) this.slideAfterMove();

    const s = this.speed;
    this.airTime = this.grounded ? 0 : this.airTime + h;
    if ((this.grounded && !this.sliding) || this.wallRunning) {
      this.stridePhase += (s * h) / (T.strideBase + T.strideFromSpeed * s);
    }
    if (s > this.peakSpeed) this.peakSpeed = s;
  }

  /** A moving deck carries whoever stands on it. Added to position, so it never counts as the player's own speed. */
  private rideGround(h: number): void {
    if (!this.grounded || !this.ctx.world.objects?.platformVelocity(this.pos, this.motion)) return;
    this.motion.multiplyScalar(h);
    if (!this.body.sweep(this.pos, this.height, this.motion, this.hit)) this.pos.add(this.motion);
  }

  private tickTimers(h: number): void {
    this.jumpBufferT = Math.max(0, this.jumpBufferT - h);
    this.dashBufferT = Math.max(0, this.dashBufferT - h);
    this.coyoteT = Math.max(0, this.coyoteT - h);
    this.noGroundT = Math.max(0, this.noGroundT - h);
    this.landGraceT = Math.max(0, this.landGraceT - h);
    this.landWeightT = Math.max(0, this.landWeightT - h);
    this.slideCooldownT = Math.max(0, this.slideCooldownT - h);
    this.noWallT = Math.max(0, this.noWallT - h);
    this.wallCoyoteT = Math.max(0, this.wallCoyoteT - h);
    this.bounceT = Math.max(0, this.bounceT - h);
    if (this.dashCharges < T.dashCharges) this.dashCharges = Math.min(T.dashCharges, this.dashCharges + h / T.dashRecharge);
  }

  private computeWish(): void {
    const s = Math.sin(this.simYaw);
    const c = Math.cos(this.simYaw);
    const x = -s * this.fwd + c * this.side;
    const z = -c * this.fwd - s * this.side;
    const len = Math.hypot(x, z);
    this.hasWish = len > 0;
    this.wishX = len > 0 ? x / len : 0;
    this.wishZ = len > 0 ? z / len : 0;
  }

  // --- Crouch --------------------------------------------------------------------------------------------------

  private updateCrouch(): void {
    if ((this.slideHeld || this.sliding) && !this.crouched) {
      this.crouched = true;
      this.height = T.crouchHeight;
    } else if (!this.slideHeld && !this.sliding && this.crouched && this.canStand()) {
      this.crouched = false;
      this.height = T.standHeight;
    }
  }

  private canStand(): boolean {
    return !this.body.overlaps(this.pos, T.standHeight);
  }

  // --- Jump ----------------------------------------------------------------------------------------------------

  private handleJump(): void {
    const wants = this.jumpBufferT > 0 || (this.holdToHop && this.jumpHeld);
    if (this.grounded || this.coyoteT > 0) {
      if (wants) this.groundJump();
      return;
    }
    if (!this.jumpFresh) return;
    // A press in the air is judged once, on the tick after it happened.
    this.jumpFresh = false;

    if (this.wallRunning) {
      this.tmp.copy(this.wallN);
      this.endWallRun();
      this.wallKick(this.tmp);
    } else if (this.wallCoyoteT > 0) {
      this.tmp.copy(this.coyoteWallN);
      this.wallKick(this.tmp);
    } else if (this.findKickWall()) {
      this.tmp.copy(this.hit2.normal);
      this.wallKick(this.tmp);
    } else if (this.hasDoubleJump && !this.willLandInBuffer()) {
      this.doubleJump();
    }
  }

  private groundJump(): void {
    const jump = T.jumpSpeed * this.modifiers.jump;
    const bounce = this.bounceT > 0;
    if (this.sliding) this.endSlide();
    if (this.dashT > 0) this.endDash(true);
    // Friction starts on touchdown, so nobody who is not hopping ever skates. A hop in time undoes what it took.
    if (this.landGraceT > 0 && Math.hypot(this.hopVx, this.hopVz) > this.speed) {
      this.v.x = this.hopVx;
      this.v.z = this.hopVz;
    }
    this.landGraceT = this.landWeightT = 0;
    this.leaveGround();
    if (bounce) {
      this.v.y = slamBounceSpeed(this.slamFall, T.gravity, T.slamBounceReturn, T.slamBounceMin, T.slamBounceMax) * this.modifiers.jump;
      this.bounceT = 0;
    } else {
      // Up a ramp the jump stacks on top of the climb. Down a ramp it replaces the descent, so a hop never stalls.
      this.v.y = Math.max(this.v.y, 0) + jump;
    }
    this.jumpBufferT = 0;
    this.jumpFresh = false;
    this.coyoteT = 0;
    this.noGroundT = 0.05;
    this.ctx.events.emit('player:jumped', { double: false, bounce });
  }

  private doubleJump(): void {
    this.hasDoubleJump = false;
    this.jumpBufferT = 0;
    if (this.hasWish) {
      rotateToward(this.v, this.wishX, this.wishZ, T.doubleJumpRedirect);
      const s = this.speed;
      const min = T.doubleJumpMinSpeed * this.modifiers.speed;
      if (s < min) {
        this.v.x = this.wishX * min;
        this.v.z = this.wishZ * min;
      }
    }
    this.v.y = Math.max(this.v.y, T.doubleJumpSpeed * this.modifiers.jump);
    if (this.dashT > 0) this.endDash(true);
    if (this.slamming) this.slamming = false;
    this.ctx.events.emit('player:jumped', { double: true });
  }

  /** True when a falling player will touch ground inside the jump buffer, so the press is a hop and not a double jump. */
  private willLandInBuffer(): boolean {
    if (this.v.y >= 0) return false;
    const b = T.jumpBuffer;
    const drop = -this.v.y * b + 0.5 * T.gravity * b * b;
    this.motion.set(this.v.x * b, -drop, this.v.z * b);
    if (!this.body.sweep(this.pos, this.height, this.motion, this.hit3)) return false;
    return this.hit3.normal.y >= this.minWalkY;
  }

  // --- Ground --------------------------------------------------------------------------------------------------

  private groundForces(h: number): void {
    const v = this.v;
    const scale = this.modifiers.speed;
    if (!this.hasWish) {
      approachVector(v, 0, 0, 0, T.stopDecel * scale * h);
      return;
    }

    let base = (this.crouched ? T.crouchSpeed : T.runSpeed) * scale;
    if (this.landWeightT > 0) base *= 1 - this.landWeight * (this.landWeightT / T.landWeightTime);

    // The wish lives in the ground plane at full length, so a ramp changes nothing about top speed.
    const n = this.groundN;
    const d = this.wishX * n.x + this.wishZ * n.z;
    let tx = this.wishX - n.x * d;
    let ty = -n.y * d;
    let tz = this.wishZ - n.z * d;
    const len = Math.hypot(tx, ty, tz);
    tx /= len;
    ty /= len;
    tz /= len;

    // Feet pressed on a wall run at whatever of the wish the wall leaves them. Grip has to measure against that, or
    // it reads the slide along the wall as drift and scrubs it away. The push into the wall stays in the velocity,
    // so the contact holds and the collision removes it, and the wish is whole again the moment the wall ends.
    let mx = 0;
    let my = 0;
    let mz = 0;
    let push = 0;
    if (this.wallPressed) {
      // In the ground plane, or a wall at the top of a ramp would leave nothing of the wish but its climb.
      const m = this.wallPressN;
      const g = m.x * n.x + m.z * n.z;
      mx = m.x - n.x * g;
      my = -n.y * g;
      mz = m.z - n.z * g;
      const ml = Math.hypot(mx, my, mz);
      mx /= ml;
      my /= ml;
      mz /= ml;
      const into = tx * mx + ty * my + tz * mz;
      if (into < 0) {
        tx -= mx * into;
        ty -= my * into;
        tz -= mz * into;
        const left = Math.hypot(tx, ty, tz);
        const k = left > 1e-4 ? 1 / left : 0;
        tx *= k;
        ty *= k;
        tz *= k;
        push = into * base;
        base *= left;
      }
    }

    // Speed along the wish and speed across it are different jobs. Pushing off takes time, but feet that have
    // changed direction do not keep sliding the old way, so everything else goes at grip rate.
    const along = v.x * tx + v.y * ty + v.z * tz;
    const cx = v.x - tx * along;
    const cy = v.y - ty * along;
    const cz = v.z - tz * along;
    const across = Math.hypot(cx, cy, cz);
    const grip = T.groundGrip * scale * h;
    const kept = across > grip ? (across - grip) / across : 0;
    const next = along < 0
      ? moveToward(along, 0, grip)
      : moveToward(along, base, (along < base ? T.groundAccel : T.overspeedDecel) * scale * h);
    v.x = tx * next + cx * kept + mx * push;
    v.y = ty * next + cy * kept + my * push;
    v.z = tz * next + cz * kept + mz * push;
  }

  private leaveGround(): void {
    this.grounded = false;
    this.groundN.set(0, 1, 0);
  }

  /** Ground check and snap. Runs after every move. */
  private categorize(): void {
    if (this.noGroundT > 0 || (this.wallRunning && this.v.y > 0)) {
      if (this.grounded) this.dropFromGround(false);
      return;
    }
    const wasGrounded = this.grounded;
    // In the air only look when not rising fast: nothing to land on otherwise, and it saves a query per tick.
    // The exception is touching a floor this tick, which is a landing on a ramp climbing at speed.
    if (!wasGrounded && this.v.y > T.snapMaxSeparation && !this.touchedFloor) return;

    const probe = wasGrounded ? T.snapDown : T.skin * 3;
    if (!this.findFloor(probe)) {
      if (wasGrounded) this.dropFromGround(true);
      return;
    }

    const n = this.tmp.copy(this.floorN);
    const separation = this.v.dot(n);
    if (wasGrounded) {
      // Convex crest on the way up: this is a launch ramp doing its job.
      if (this.v.y > 0 && separation > T.snapMaxSeparation) {
        this.dropFromGround(true);
        return;
      }
    } else if (separation > 0.5) {
      return;
    }

    const drop = this.floorDrop;
    this.pos.y -= drop;
    if (wasGrounded && Math.abs(drop) > 0.02) {
      this.stepSmooth = clamp(this.stepSmooth + drop, -0.5, 0.5);
      this.prev.y -= drop;
    }
    if (!wasGrounded) {
      this.land(n);
      this.settleOnSlope(n);
    } else if (this.dashT <= 0 || this.dashGrounded) {
      redirectOntoPlane(this.v, n);
    }
    this.grounded = true;
    this.groundN.copy(n);
    this.coyoteT = 0;
    if (this.floorCollider !== this.groundCollider) {
      this.groundCollider = this.floorCollider;
      if (this.groundCollider) this.groundSurface = this.ctx.physics.surfaceOf(this.groundCollider);
    }
  }

  /**
   * Finds what the player would stand on within `probe` below the feet. Fills floorN and floorDrop, the height
   * to come down by (negative when sunk into the floor), and returns true when it can be stood on.
   *
   * The ray goes first and is usually the whole answer. Rapier's capsule casts lose accuracy on very large
   * colliders, overshooting by centimetres on a 300 m slab and 25 cm on a 2 km one, while a ray stays exact.
   * The capsule cast still decides when the ray misses, which is standing on a lip with the centre past the edge.
   */
  private findFloor(probe: number): boolean {
    const r = T.radius;
    const start = this.tmp2.copy(this.pos);
    start.y += r;
    if (this.body.castRay(start, DOWN, r / this.minWalkY + probe, this.hit3) && this.hit3.normal.y >= this.minWalkY) {
      const drop = this.hit3.toi - r / this.hit3.normal.y - T.skin;
      if (drop <= probe) {
        // Close enough that nothing else can be in the way.
        this.floorN.copy(this.hit3.normal);
        this.floorDrop = drop;
        this.floorCollider = this.hit3.collider;
        if (drop < T.skin * 3) return true;
        this.motion.set(0, -drop, 0);
        if (!this.body.sweep(this.pos, this.height, this.motion, this.hit)) return true;
        // Something stands between the feet and the floor under the centre: a lip or a stair nose.
        if (!this.resolveFloor(this.hit)) return false;
        this.floorN.copy(this.hit2.normal);
        this.floorDrop = this.hit.toi * drop - T.skin;
        return true;
      }
    }
    this.motion.set(0, -probe, 0);
    if (!this.body.sweep(this.pos, this.height, this.motion, this.hit) || !this.resolveFloor(this.hit)) return false;
    this.floorN.copy(this.hit2.normal);
    this.floorDrop = this.hit.toi * probe - T.skin;
    this.floorCollider = this.hit.collider;
    return true;
  }

  /** Removes fall speed on touchdown. Fall speed must never turn into run speed, but a ramp keeps horizontal speed. */
  private settleOnSlope(n: THREE.Vector3): void {
    const before = this.speed;
    clipVelocity(this.v, n);
    const now = this.speed;
    if (now > 1e-4 && now < before) this.v.multiplyScalar(before / now);
  }

  /**
   * Fills hit2 with the real surface under a downward cast and returns true if it can be stood on. A capsule on
   * a ledge lip gets a tilted normal from the lip itself. Taken at face value that normal would act as a ramp and
   * fling the player off every stair, so a tilted contact gets a second look with a ray just inside the contact.
   */
  private resolveFloor(hit: typeof this.hit): boolean {
    const out = this.hit2;
    if (hit.normal.y < FLAT_NORMAL_Y) {
      this.tmp2.set(hit.point.x - hit.normal.x * 0.03, hit.point.y + 0.12, hit.point.z - hit.normal.z * 0.03);
      if (this.body.castRay(this.tmp2, DOWN, 0.3, out) && Math.abs(out.point.y - hit.point.y) < 0.1) {
        return out.normal.y >= this.minWalkY;
      }
    }
    out.normal.copy(hit.normal);
    out.point.copy(hit.point);
    return hit.normal.y >= this.minWalkY;
  }

  private dropFromGround(canCoyote: boolean): void {
    this.leaveGround();
    if (canCoyote) this.coyoteT = T.coyote;
    if (this.sliding) {
      // Sliding off a ledge is the same slide, so a key still held picks it up on the way down.
      this.endSlide();
      this.slideQueued = this.slideHeld;
    }
  }

  private land(n: THREE.Vector3): void {
    const impact = Math.max(0, -Math.min(this.preStepVy, this.v.y));
    this.hasDoubleJump = true;
    this.hasLastWall = false;
    this.flung = false;
    this.landGraceT = T.landGrace;
    this.hopVx = this.v.x;
    this.hopVz = this.v.z;
    this.landWeightT = T.landWeightTime;
    this.landWeight = T.landWeightSlow * clamp(impact / T.landWeightImpact);
    this.wallCoyoteT = 0;

    if (this.wallRunning) this.endWallRun();
    const wasSlam = this.slamming;
    if (wasSlam) this.landSlam(impact);
    if (this.airTime > 0.05 || impact > 2) this.ctx.events.emit('player:landed', { impact });

    this.grounded = true;
    this.groundN.copy(n);
    if (this.slideQueued || (wasSlam && this.slideHeld)) {
      this.slideQueued = false;
      const s = this.v.length();
      if (wasSlam && this.slideCooldownT <= 0) {
        // Tied to height and to the slide cooldown: otherwise jump, slam, slide on flat ground prints speed.
        const gain = Math.min(T.slamSlideMaxGain, this.slamFall * T.slamSlideGain);
        const hs = this.speed;
        if (hs > 1) this.v.multiplyScalar((hs + gain) / hs);
        else if (this.hasWish) this.v.set(this.wishX * gain, 0, this.wishZ * gain);
      }
      if (s >= T.slideEntrySpeed || wasSlam) this.startSlide();
    }
  }

  // --- Slide and slam ------------------------------------------------------------------------------------------

  private handleSlideKey(): void {
    if (!this.slideLatch) return;
    this.slideLatch = false;
    if (this.grounded) {
      if (!this.sliding && this.v.length() >= T.slideEntrySpeed) {
        if (this.dashT > 0) this.endDash(true);
        this.startSlide();
      }
      return;
    }
    if (this.mantling || this.slamming) return;
    if (this.heightAboveGround(T.slamMinHeight) >= T.slamMinHeight) this.startSlam();
    else this.slideQueued = true;
  }

  private startSlide(): void {
    if (this.sliding) return;
    this.sliding = true;
    if (!this.crouched) {
      this.crouched = true;
      this.height = T.crouchHeight;
    }
    if (this.slideCooldownT <= 0) {
      const s = this.v.length();
      const boosted = Math.min(s * T.slideBoost, Math.max(s, T.slideBoostCap * this.modifiers.speed));
      if (s > 1e-3) this.v.multiplyScalar(boosted / s);
      this.slideCooldownT = T.slideBoostCooldown;
    }
    this.ctx.events.emit('player:slide', { active: true });
  }

  private endSlide(): void {
    if (!this.sliding) return;
    this.sliding = false;
    this.ctx.events.emit('player:slide', { active: false });
  }

  private slideForces(h: number): void {
    const v = this.v;
    const n = this.groundN;
    // Gravity along the slope. On flat ground this is zero; downhill it beats friction.
    const g = T.gravity * T.slideGravity;
    v.x += n.x * n.y * g * h;
    v.y += (n.y * n.y - 1) * g * h;
    v.z += n.z * n.y * g * h;

    let friction = T.slideFriction;
    if (this.hasWish) {
      const s = this.speed;
      if (s > 1e-3) {
        const along = (v.x * this.wishX + v.z * this.wishZ) / s;
        if (along < -0.3) friction += T.slideBrake;
        else rotateToward(v, this.wishX, this.wishZ, 1, T.slideSteer * h);
      }
    }
    const speed = v.length();
    friction += T.slideOverDrag * Math.max(0, speed - T.runSpeed * this.modifiers.speed);
    if (speed > 1e-3) v.multiplyScalar(Math.max(0, speed - friction * h) / speed);
  }

  private slideAfterMove(): void {
    if (!this.grounded) return;
    const speed = this.v.length();
    if (!this.slideHeld && this.canStand()) {
      this.endSlide();
      return;
    }
    if (speed < T.slideEndSpeed) this.endSlide();
  }

  private heightAboveGround(max: number): number {
    if (!this.body.castRay(this.pos, DOWN, max, this.hit3)) return max;
    return this.hit3.toi;
  }

  private startSlam(): void {
    if (this.wallRunning) this.endWallRun();
    if (this.dashT > 0) this.endDash(false);
    this.slamming = true;
    this.slamStartY = this.pos.y;
    this.v.y = Math.min(this.v.y, -T.slamSpeed);
    this.ctx.events.emit('player:slamstart', { position: this.pos });
  }

  private slamForces(h: number): void {
    this.v.y = Math.max(this.v.y - T.gravity * T.slamGravityScale * h, -T.slamMaxSpeed);
  }

  private landSlam(impactSpeed: number): void {
    this.slamming = false;
    const fall = Math.max(this.slamStartY - this.pos.y, 0);
    this.slamFall = fall + this.slamBonusFall(impactSpeed);
    this.bounceT = T.slamBounceWindow;
    const radius = lerp(T.slamRadiusMin, T.slamRadiusMax, clamp(this.slamFall / T.slamRadiusFall));
    this.ctx.events.emit('player:slam', { impact: this.slamFall, position: this.pos.clone(), radius });
  }

  /** Height equivalent of arriving already moving fast, so a slam out of a fall is worth what it felt like. */
  private slamBonusFall(impactSpeed: number): number {
    return Math.max(0, (impactSpeed - T.slamSpeed) * 0.15);
  }

  // --- Air -----------------------------------------------------------------------------------------------------

  private airForces(h: number): void {
    const v = this.v;
    if (this.hasWish) {
      const wish = T.airWishSpeed * this.modifiers.speed;
      const speed = this.speed;
      const along = v.x * this.wishX + v.z * this.wishZ;
      if (speed < wish) {
        quakeAccelerate(v, this.wishX, this.wishZ, wish, T.airAccelSlow, h);
      } else if (this.fwd === 0) {
        quakeAccelerate(v, this.wishX, this.wishZ, Math.min(wish, T.sideWishSpeed), T.sideAccel, h);
      } else {
        quakeAccelerate(v, this.wishX, this.wishZ, wish, along < 0 ? T.airStopAccel : T.airAccel, h);
      }
      if (this.fwd > 0 && this.side === 0) airSteer(v, this.wishX, this.wishZ, T.airControl, h);
    }
    v.y -= T.gravity * h;
  }

  private applySoftCap(h: number): void {
    const s = this.speed;
    const cap = T.softCap * this.modifiers.speed;
    if (s <= cap || this.dashT > 0 || this.flung) return;
    const limited = softLimit(s, cap, T.softDrag, h);
    const k = limited / s;
    this.v.x *= k;
    this.v.z *= k;
  }

  // --- Dash ----------------------------------------------------------------------------------------------------

  private handleDash(): void {
    if (this.dashBufferT <= 0 || this.dashT > 0) return;
    const free = this.modifiers.infiniteDash && !this.grounded;
    if (this.dashCharges < 1 && !free) return;
    this.dashBufferT = 0;
    if (!free) this.dashCharges -= 1;

    let dx = this.wishX;
    let dz = this.wishZ;
    if (!this.hasWish) {
      dx = -Math.sin(this.simYaw);
      dz = -Math.cos(this.simYaw);
    }
    if (this.wallRunning) {
      // Dashing into the wall you are running on goes along it instead.
      const into = dx * this.wallN.x + dz * this.wallN.z;
      if (into < 0) {
        dx -= this.wallN.x * into;
        dz -= this.wallN.z * into;
        const len = Math.hypot(dx, dz);
        if (len > 1e-3) {
          dx /= len;
          dz /= len;
        } else {
          dx = this.wallN.x;
          dz = this.wallN.z;
        }
      }
      this.endWallRun();
    }
    if (this.sliding) this.endSlide();
    if (this.slamming) this.slamming = false;

    const entry = this.speed;
    this.dashDirX = dx;
    this.dashDirZ = dz;
    this.dashEntrySpeed = entry;
    this.dashStartSpeed = Math.max(T.dashSpeed * this.modifiers.speed, entry + T.dashMinGain);
    this.dashT = T.dashTime;
    this.dashGrounded = this.grounded;
    if (this.v.y < 0) this.v.y = 0;
    this.tmp.set(dx, 0, dz);
    this.ctx.events.emit('player:dashed', { dir: this.tmp.clone() });
  }

  private dashForces(): void {
    const v = this.v;
    const s = this.dashStartSpeed;
    v.x = this.dashDirX * s;
    v.z = this.dashDirZ * s;
    if (this.grounded) {
      v.y = 0;
      redirectOntoPlane(v, this.groundN);
    }
  }

  private dashAfterMove(h: number): void {
    const along = this.v.x * this.dashDirX + this.v.z * this.dashDirZ;
    // A wall took the dash head-on: nothing left to carry.
    if (along < this.dashStartSpeed * 0.3) {
      this.dashT = 0;
      return;
    }
    this.dashT -= h;
    if (this.dashT <= 0) this.endDash(false);
  }

  /**
   * `keep` is true when a jump or slide took over mid-dash, which is the dash-jump tech: it leaves more speed behind
   * than a dash that ran its course. It cannot stack past that, or dash-jumps alone would outrun strafing.
   */
  private endDash(keep: boolean): void {
    this.dashT = 0;
    const s = this.speed;
    if (s < 1e-3) return;
    const floor = keep ? T.dashKeep : T.dashExit;
    const exit = Math.max(this.dashEntrySpeed, floor * this.modifiers.speed);
    // Clipped against a wall, the exit keeps the same share of the speed that survived.
    const k = (exit * Math.min(1, s / this.dashStartSpeed)) / s;
    this.v.x *= k;
    this.v.z *= k;
  }

  // --- Wall run ------------------------------------------------------------------------------------------------

  private sameWall(n: THREE.Vector3): boolean {
    if (!this.hasLastWall) return false;
    if (n.dot(this.lastWallN) < 0.92) return false;
    this.tmp2.copy(this.pos).sub(this.lastWallPoint);
    return Math.abs(this.tmp2.dot(n)) < 1.2;
  }

  private rememberWall(n: THREE.Vector3): void {
    this.lastWallN.copy(n);
    this.lastWallPoint.copy(this.pos);
    this.hasLastWall = true;
  }

  /** A wall run is a decision. Every test here is something a brush against a wall in a corridor does not do. */
  private canWallRun(n: THREE.Vector3): boolean {
    if (this.grounded || this.slamming || this.wallRunning || this.slideHeld || this.fwd <= 0 || this.noWallT > 0) return false;
    if (this.airTime < T.wallRunMinAir || Math.abs(n.y) > T.wallMaxNormalY) return false;
    const speed = this.speed;
    if (speed < T.wallRunMinSpeed) return false;
    const nl = Math.hypot(n.x, n.z);
    const nx = n.x / nl;
    const nz = n.z / nl;
    const into = -(this.v.x * nx + this.v.z * nz) / speed;
    if (into > T.wallRunMaxInto || into < -0.3) return false;
    const wishInto = -(this.wishX * nx + this.wishZ * nz);
    if (wishInto < T.wallRunWishMin || wishInto > T.wallRunWishMax) return false;
    if ((this.wishX * this.v.x + this.wishZ * this.v.z) / speed < T.wallRunWishAlong) return false;
    if (this.sameWall(n)) return false;
    return this.heightAboveGround(T.wallRunMinHeight) >= T.wallRunMinHeight && this.wallContinues(nx, nz);
  }

  /** Looks for the same wall further along, at chest height: a low rail or the end of a crate does not count. */
  private wallContinues(nx: number, nz: number): boolean {
    const speed = this.speed;
    const ahead = T.wallRunAhead / speed;
    this.tmp2.set(this.pos.x + this.v.x * ahead, this.pos.y + this.height / 2, this.pos.z + this.v.z * ahead);
    this.dir.set(-nx, 0, -nz);
    return this.body.castRay(this.tmp2, this.dir, T.radius + T.wallProbe, this.hit3)
      && this.hit3.normal.x * nx + this.hit3.normal.z * nz > 0.8;
  }

  private startWallRun(n: THREE.Vector3): void {
    const nl = Math.hypot(n.x, n.z);
    this.wallN.set(n.x / nl, 0, n.z / nl);
    this.setWallTangent(this.v.x, this.v.z);
    const speed = this.speed;
    this.v.x = this.wallT.x * speed;
    this.v.z = this.wallT.z * speed;
    this.v.y = clamp(this.v.y, T.wallRunEntryMinVy, T.wallRunEntryMaxVy);
    this.wallRunT = 0;
    this.wallRunning = true;
    this.hasDoubleJump = true;
    this.dashT = 0;
    this.updateWallSide();
    this.ctx.events.emit('player:wallrun', { active: true });
  }

  private setWallTangent(dirX: number, dirZ: number): void {
    const n = this.wallN;
    // cross(up, n)
    let tx = n.z;
    let tz = -n.x;
    if (tx * dirX + tz * dirZ < 0) {
      tx = -tx;
      tz = -tz;
    }
    this.wallT.set(tx, 0, tz);
  }

  private updateWallSide(): void {
    const c = Math.cos(this.simYaw);
    const s = Math.sin(this.simYaw);
    // The wall normal points away from the wall, so a normal to the view's right means the wall is on the left.
    this.wallSide = this.wallN.x * c - this.wallN.z * s > 0 ? -1 : 1;
  }

  private endWallRun(): void {
    if (!this.wallRunning) return;
    this.wallRunning = false;
    this.wallSide = 0;
    this.rememberWall(this.wallN);
    this.coyoteWallN.copy(this.wallN);
    this.wallCoyoteT = T.wallCoyote;
    this.ctx.events.emit('player:wallrun', { active: false });
  }

  private wallForces(h: number): void {
    const v = this.v;
    const t = this.wallT;
    this.wallRunT += h;
    let along = v.x * t.x + v.z * t.z;
    if (this.hasWish && this.wishX * t.x + this.wishZ * t.z > 0) {
      along = moveToward(along, Math.max(along, T.wallRunSpeed * this.modifiers.speed), T.wallRunAccel * h);
    }
    if (this.wallRunT < T.wallRunHold) v.y = damp(v.y, 0, T.wallRunVyDamp, h);
    else v.y = Math.max(v.y - T.gravity * T.wallRunFallScale * h, -T.wallRunMaxFall);
    v.x = t.x * along;
    v.z = t.z * along;
    this.updateWallSide();
  }

  /** Follows the wall after the move: updates the normal for curved walls and detaches when it ends. */
  private wallStick(): void {
    if (this.grounded) {
      this.endWallRun();
      return;
    }
    const along = this.speed;
    const pushingOff = this.hasWish && this.wishX * this.wallN.x + this.wishZ * this.wallN.z > 0.7;
    if (this.wallRunT > T.wallRunMax || along < T.wallRunEndSpeed || pushingOff || this.fwd <= 0) {
      this.endWallRun();
      return;
    }
    this.motion.copy(this.wallN).multiplyScalar(-T.wallProbe);
    if (!this.body.sweep(this.pos, this.height, this.motion, this.hit) || Math.abs(this.hit.normal.y) > T.wallMaxNormalY) {
      this.endWallRun();
      return;
    }
    const n = this.hit.normal;
    const nl = Math.hypot(n.x, n.z);
    // Close the gap from a scan attach over a few ticks: a snap would show as a sideways jerk.
    const gap = this.hit.toi * T.wallProbe - T.skin;
    if (gap > 0) this.pos.addScaledVector(this.wallN, -Math.min(gap, T.wallPull * this.fixedDt));
    this.wallN.set(n.x / nl, 0, n.z / nl);
    this.setWallTangent(this.v.x, this.v.z);
  }

  /** Looks for a kickable wall around the player. Fills hit2. */
  private findKickWall(): boolean {
    const c = Math.cos(this.simYaw);
    const s = Math.sin(this.simYaw);
    let best = Infinity;
    for (let i = 0; i < 4; i++) {
      const ax = i < 2 ? -s : c;
      const az = i < 2 ? -c : -s;
      const sign = i % 2 === 0 ? 1 : -1;
      this.motion.set(ax * sign * T.wallKickReach, 0, az * sign * T.wallKickReach);
      if (!this.body.sweep(this.pos, this.height, this.motion, this.hit)) continue;
      const n = this.hit.normal;
      if (Math.abs(n.y) > T.wallMaxNormalY || this.hit.toi >= best || this.sameWall(n)) continue;
      if (-(this.v.x * n.x + this.v.z * n.z) < T.wallKickMinInto) continue;
      best = this.hit.toi;
      this.hit2.normal.copy(n);
    }
    return best < Infinity;
  }

  private wallKick(n: THREE.Vector3): void {
    const v = this.v;
    const nl = Math.hypot(n.x, n.z);
    const nx = n.x / nl;
    const nz = n.z / nl;
    const into = v.x * nx + v.z * nz;
    if (into < 0) {
      v.x -= nx * into;
      v.z -= nz * into;
    }
    const s = this.speed;
    if (s > 1e-3) {
      const k = (s * T.wallKickSpeedMult + T.wallKickSpeedAdd) / s;
      v.x *= k;
      v.z *= k;
    }
    v.x += nx * T.wallKickOut;
    v.z += nz * T.wallKickOut;
    if (this.hasWish && this.wishX * nx + this.wishZ * nz > -0.2) rotateToward(v, this.wishX, this.wishZ, 1, T.wallKickSteer);
    v.y = Math.max(v.y, T.wallKickUp * this.modifiers.jump);
    this.tmp2.set(nx, 0, nz);
    this.rememberWall(this.tmp2);
    this.hasDoubleJump = true;
    this.noWallT = T.wallKickLock;
    this.wallCoyoteT = 0;
    this.jumpBufferT = 0;
    if (this.dashT > 0) this.endDash(true);
    if (this.slamming) this.slamming = false;
    this.ctx.events.emit('player:jumped', { double: false, wall: true });
  }

  // --- Mantle --------------------------------------------------------------------------------------------------

  private tryMantle(n: THREE.Vector3): boolean {
    if (this.grounded || this.fwd <= 0 || this.slamming) return false;
    const fl = Math.hypot(n.x, n.z);
    if (fl < 0.5) return false;
    const fx = -n.x / fl;
    const fz = -n.z / fl;
    if (this.wishX * fx + this.wishZ * fz < T.mantleFacing) return false;

    const reach = T.mantleReach;
    const offset = T.radius + 0.3;
    this.tmp.set(this.pos.x + fx * offset, this.pos.y + reach + 0.05, this.pos.z + fz * offset);
    if (!this.body.castRay(this.tmp, DOWN, reach + 0.05, this.hit3)) return false;
    // A ray starting inside solid reports distance 0: the ledge is too tall.
    if (this.hit3.toi < 0.02 || this.hit3.normal.y < this.minWalkY) return false;
    const top = this.hit3.point.y + T.skin * 2;
    const rise = top - this.pos.y;
    if (rise < T.mantleMinRise) return false;

    this.motion.set(0, rise, 0);
    if (this.body.sweep(this.pos, this.height, this.motion, this.hit3)) return false;
    this.tmp.copy(this.pos);
    this.tmp.y = top;
    this.motion.set(fx * offset, 0, fz * offset);
    if (this.body.sweep(this.tmp, this.height, this.motion, this.hit3) && this.hit3.toi * offset < 0.25) return false;

    const hs = this.speed;
    const speed = Math.max(hs, T.mantleExitSpeed * this.modifiers.speed);
    this.mantleFrom = this.pos.y;
    this.mantleTo = top;
    this.mantleTime = 0;
    this.mantleDuration = rise / Math.max(T.mantleRiseSpeed, hs * T.mantleRiseFromSpeed);
    this.mantleDirX = this.hasWish ? this.wishX : fx;
    this.mantleDirZ = this.hasWish ? this.wishZ : fz;
    this.mantling = true;
    if (this.wallRunning) this.endWallRun();
    this.endSlide();
    this.dashT = 0;
    this.leaveGround();
    // The climb moves `pos` directly, so velocity is free to keep saying how fast the player really is: speed
    // readouts, FOV and Overdrive should not blink to zero for a tenth of a second.
    this.v.set(this.mantleDirX * speed, rise / this.mantleDuration, this.mantleDirZ * speed);
    this.hasDoubleJump = true;
    this.ctx.events.emit('player:mantle', { height: rise });
    return true;
  }

  private mantleTick(h: number): void {
    this.mantleTime += h;
    const t = Math.min(1, this.mantleTime / this.mantleDuration);
    // Eases out, but starts at only 1.5x the average rise so the first frame is a pull and not a yank.
    this.pos.y = lerp(this.mantleFrom, this.mantleTo, t * (1.5 - 0.5 * t));
    if (t < 1) return;
    this.mantling = false;
    this.v.y = 0;
  }

  // --- Collide and slide ---------------------------------------------------------------------------------------

  private moveAndCollide(h: number): void {
    this.moveStart.copy(this.pos);
    this.touchedFloor = false;
    this.wallPressed = false;
    const wanted = this.v.length() * h;
    this.slideAlong(h);
    if (this.mantling) return;

    // Not moving while trying to. Nothing static can cause this, but a crusher or a bad teleport can, and casts
    // that start inside a solid cannot be trusted to get out on their own.
    if (wanted > 0.02 && this.pos.distanceToSquared(this.moveStart) < wanted * wanted * 1e-4) {
      if (++this.stuckTicks >= 3) {
        this.stuckTicks = 0;
        this.body.depenetrate(this.pos, this.height, T.skin);
      }
    } else {
      this.stuckTicks = 0;
    }
  }

  private slideAlong(h: number): void {
    const v = this.v;
    const hit = this.hit;
    let timeLeft = h;
    let planes = 0;

    for (let it = 0; it < MAX_SLIDE_ITERATIONS && timeLeft > 1e-7; it++) {
      this.motion.copy(v).multiplyScalar(timeLeft);
      const len = this.motion.length();
      if (len < 1e-6) break;
      if (!this.body.sweep(this.pos, this.height, this.motion, hit)) {
        this.pos.add(this.motion);
        return;
      }
      const dir = this.dir.copy(this.motion).divideScalar(len);
      const n = hit.normal;
      const travel = hit.toi * len;
      const dn = -dir.dot(n);
      // Stop `skin` short of the surface measured along the normal. The path here was clear, so backing up
      // along it can never push into something else the way a push along the normal can.
      const back = dn > 0.02 ? T.skin / dn : 0;
      const moved = Math.max(0, travel - back);
      this.pos.addScaledVector(dir, moved);
      if (travel < back) this.pos.addScaledVector(n, T.skin - travel * dn);
      this.refineContact(n);
      // Only distance covered costs time. At a shallow angle `back` is about a whole tick of motion, so charging for
      // the distance to the hit spent the tick standing still. A hit that moved nothing still clips velocity below,
      // which is what makes progress, and the iteration cap bounds it.
      timeLeft *= 1 - moved / len;

      if (this.resolveContact(n, timeLeft)) {
        if (this.mantling) return;
        planes = 0;
        timeLeft = this.stepTimeLeft;
        continue;
      }
      planes = this.clipAgainst(n, planes);
      if (planes < 0) return;
    }
  }

  private stepTimeLeft = 0;
  private touchedFloor = false;
  private stuckTicks = 0;

  /**
   * Pushes out of a planar surface using a ray, which is exact, after a capsule cast that may have overshot it.
   * See findFloor for why. Edges fail the normal check and keep the cast's answer.
   */
  private refineContact(n: THREE.Vector3): void {
    const p = this.hit.point;
    const q = this.tmp2.copy(p).addScaledVector(n, 0.6);
    this.dir.copy(n).negate();
    if (!this.body.castRay(q, this.dir, 0.9, this.hit3) || this.hit3.normal.dot(n) < 0.995) return;
    const surface = this.hit3.point;
    // The point of the capsule's core nearest the plane: an end cap unless the plane is vertical.
    const half = this.height / 2 - T.radius;
    const coreY = this.pos.y + this.height / 2 - Math.sign(n.y) * half;
    const dist = (this.pos.x - surface.x) * n.x + (coreY - surface.y) * n.y + (this.pos.z - surface.z) * n.z;
    const short = T.radius + T.skin - dist;
    if (short > 0) this.pos.addScaledVector(n, short);
  }

  /** Everything a surface can mean besides "slide along it". Returns true if the move should carry on unclipped. */
  private resolveContact(n: THREE.Vector3, timeLeft: number): boolean {
    this.stepTimeLeft = timeLeft;
    const hit = this.hit;
    const walkable = n.y >= this.minWalkY;
    const towardHorizontally = this.v.x * n.x + this.v.z * n.z < 0;

    // Stairs, curbs and lips. A walkable tilt can still be an edge, which must not act like a ramp: at 40 m/s
    // the velocity redirect off a 10 cm curb would throw the player 25 m/s upward.
    if (towardHorizontally && n.y < FLAT_NORMAL_Y && n.y > -0.1 && !this.wallRunning) {
      const low = hit.point.y - this.pos.y < T.stepHeight + 0.03;
      const allowed = this.grounded || this.v.y <= 2;
      if ((!walkable || (low && this.isEdge(n))) && allowed && this.tryStepUp(timeLeft)) return true;
    }

    if (!walkable && n.y > -0.3) {
      if (this.tryMantle(n)) return true;
      if (this.wallRunning) {
        if (Math.abs(n.y) <= T.wallMaxNormalY && n.dot(this.wallN) < 0.9) return this.turnWallCorner(n);
      } else if (this.canWallRun(n)) {
        this.startWallRun(n);
        return true;
      }
    }
    return false;
  }

  /** True when a contact is the corner of something rather than a real sloped face. */
  private isEdge(n: THREE.Vector3): boolean {
    const hl = Math.hypot(this.v.x, this.v.z);
    if (hl < 1e-3) return false;
    const p = this.hit.point;
    this.tmp2.set(p.x + (this.v.x / hl) * 0.04, p.y + 0.08, p.z + (this.v.z / hl) * 0.04);
    if (!this.body.castRay(this.tmp2, DOWN, 0.25, this.hit3)) return false;
    return this.hit3.normal.dot(n) < 0.985;
  }

  /** Inside corner during a wall run: carry the speed onto the new wall. */
  private turnWallCorner(n: THREE.Vector3): boolean {
    const old = this.tmp.copy(this.wallN);
    const nl = Math.hypot(n.x, n.z);
    this.wallN.set(n.x / nl, 0, n.z / nl);
    this.setWallTangent(old.x, old.z);
    const speed = this.speed;
    this.v.x = this.wallT.x * speed;
    this.v.z = this.wallT.z * speed;
    this.wallRunT = Math.min(this.wallRunT, T.wallRunHold * 0.5);
    this.updateWallSide();
    return true;
  }

  private tryStepUp(timeLeft: number): boolean {
    const hx = this.v.x * timeLeft;
    const hz = this.v.z * timeLeft;
    const hl = Math.hypot(hx, hz);
    const speed = this.speed;
    if (speed < 0.05) return false;
    const forward = Math.max(hl, T.stepMinForward);
    const dx = (this.v.x / speed) * forward;
    const dz = (this.v.z / speed) * forward;

    // Up
    let lift = T.stepHeight;
    this.motion.set(0, lift, 0);
    if (this.body.sweep(this.pos, this.height, this.motion, this.hit3)) lift = Math.max(0, this.hit3.toi * lift - T.skin);
    if (lift < 0.04) return false;
    const p = this.tmp.copy(this.pos);
    p.y += lift;

    // Across
    this.motion.set(dx, 0, dz);
    let along = 1;
    if (this.body.sweep(p, this.height, this.motion, this.hit3)) {
      if (this.hit3.toi * forward < 0.015) return false;
      // Still hitting something up here means a ledge, not a step. The round bottom of the capsule would otherwise
      // roll up any edge lower than step height plus radius, which is an unasked climb of nearly a meter.
      if (this.hit3.point.y - this.pos.y > T.stepHeight + 0.03) return false;
      along = Math.max(0, this.hit3.toi - T.skin / forward);
    }
    p.x += dx * along;
    p.z += dz * along;

    // Down
    const reach = lift + 0.02;
    this.motion.set(0, -reach, 0);
    if (!this.body.sweep(p, this.height, this.motion, this.hit3)) return false;
    const n = this.hit3.normal;
    if (n.y < this.minWalkY) {
      if (!this.resolveFloor(this.hit3)) return false;
    }
    const dropped = this.hit3.toi * reach - T.skin;
    const newY = p.y - dropped;
    const rise = newY - this.pos.y;
    if (rise <= 0.002) return false;

    this.pos.x = p.x;
    this.pos.z = p.z;
    this.pos.y = newY;
    this.prev.y += rise;
    this.stepSmooth = clamp(this.stepSmooth - rise, -0.5, 0.5);
    this.stepTimeLeft = speed > 0 ? Math.max(0, timeLeft - (forward * along) / speed) : 0;
    return true;
  }

  /** Quake's plane clipping, so two surfaces can never squeeze velocity back and forth. Returns the plane count. */
  private clipAgainst(n: THREE.Vector3, planes: number): number {
    const v = this.v;
    const walkable = n.y >= this.minWalkY;
    const speedBefore = v.length();
    const hBefore = this.speed;

    if (planes < this.planes.length) this.planes[planes++]!.copy(n);
    clipVelocity(v, n);
    if (walkable) {
      this.touchedFloor = true;
      // A ramp or a landing redirects speed. It never takes it away.
      const keep = this.grounded ? speedBefore : hBefore;
      const now = v.length();
      if (now > 1e-4 && now < keep) v.multiplyScalar(keep / now);
    } else if (n.y > -0.3) {
      const nl = Math.hypot(n.x, n.z);
      this.wallPressN.set(n.x / nl, 0, n.z / nl);
      this.wallPressed = true;
    }

    for (let i = 0; i < planes - 1; i++) {
      const p = this.planes[i]!;
      if (p.dot(n) > 0.999 || v.dot(p) >= -1e-5) continue;
      if (planes > 2) {
        v.set(0, 0, 0);
        return -1;
      }
      // Trapped between two planes: run along their crease.
      const crease = this.tmp.crossVectors(p, n);
      const len = crease.length();
      if (len < 1e-4) {
        v.set(0, 0, 0);
        return -1;
      }
      crease.divideScalar(len);
      v.copy(crease).multiplyScalar(crease.dot(v));
      break;
    }
    return planes;
  }

  // --- Death ---------------------------------------------------------------------------------------------------

  private deadTick(h: number): void {
    if (this.grounded) approachVector(this.v, 0, 0, 0, T.stopDecel * 0.5 * h);
    else this.v.y -= T.gravity * h;
    this.moveAndCollide(h);
    this.categorize();
  }

  // --- Health --------------------------------------------------------------------------------------------------

  private updateHealth(dt: number): void {
    if (!this.alive) return;
    this.lastDamageT += dt;
    if (this.health > this.maxHealth) {
      this.health = Math.max(this.maxHealth, this.health - T.overhealDecay * dt);
    } else if (this.lastDamageT >= T.regenDelay && this.health < this.maxHealth) {
      this.health = Math.min(this.maxHealth, this.health + T.regenRate * dt);
    }
  }

  takeDamage(damage: PlayerDamage): void {
    if (!this.alive || this.modifiers.invulnerable || this.parked || this.parkGrace > 0) return;
    if (this.interceptor?.(damage)) return;
    const amount = damage.amount * this.modifiers.damageTaken;
    if (amount <= 0) return;
    this.lastDamageT = 0;
    let toHealth = amount;
    if (this.armor > 0 && damage.type !== 'true' && damage.type !== 'hazard') {
      const absorbed = Math.min(this.armor, amount * T.armorAbsorb);
      this.armor -= absorbed;
      toHealth -= absorbed;
    }
    this.health -= toHealth;
    this.ctx.events.emit('player:damaged', { amount, from: damage.from, type: damage.type });
    if (this.health <= 0) this.die(damage.source);
  }

  private die(source: string): void {
    this.health = 0;
    this.alive = false;
    if (this.wallRunning) this.endWallRun();
    this.endSlide();
    this.slamming = false;
    this.mantling = false;
    this.dashT = 0;
    this.ctx.events.emit('player:died', { source });
  }

  heal(amount: number, overheal = false): void {
    if (!this.alive || amount <= 0) return;
    const cap = overheal ? T.overhealMax : Math.max(this.maxHealth, this.health);
    const next = Math.min(cap, this.health + amount);
    const gained = next - this.health;
    if (gained <= 0) return;
    this.health = next;
    this.ctx.events.emit('player:healed', { amount: gained });
  }

  addArmor(amount: number): void {
    this.armor = Math.min(T.maxArmor, this.armor + amount);
  }

  // --- External motion -----------------------------------------------------------------------------------------

  launch(velocity: THREE.Vector3): void {
    if (this.parked) return;
    this.interruptForLaunch();
    this.v.x += velocity.x;
    this.v.z += velocity.z;
    this.v.y = velocity.y;
  }

  /** Adds velocity on all axes, for blasts that should stack with a jump. */
  push(velocity: THREE.Vector3): void {
    if (this.parked) return;
    this.interruptForLaunch();
    this.v.add(velocity);
  }

  private interruptForLaunch(): void {
    if (this.wallRunning) this.endWallRun();
    this.endSlide();
    this.slamming = false;
    this.dashT = 0;
    this.flung = true;
    if (this.mantling) {
      this.mantling = false;
      this.pos.y = this.mantleTo;
    }
    this.leaveGround();
    this.coyoteT = 0;
    this.noGroundT = 0.12;
  }

  teleport(position: THREE.Vector3, yaw?: number): void {
    this.pos.copy(position);
    this.prev.copy(position);
    this.position.copy(position);
    this.v.set(0, 0, 0);
    if (yaw !== undefined) {
      this.yaw = yaw;
      this.simYaw = yaw;
    }
    this.pitch = 0;
    this.accumulator = 0;
    this.grounded = false;
    this.groundN.set(0, 1, 0);
    this.sliding = false;
    this.wallRunning = false;
    this.wallSide = 0;
    this.slamming = false;
    this.mantling = false;
    this.dashT = 0;
    this.coyoteT = this.jumpBufferT = this.dashBufferT = this.noGroundT = this.landGraceT = this.landWeightT = 0;
    this.slideQueued = this.flung = this.wallPressed = false;
    this.hasDoubleJump = true;
    this.hasLastWall = false;
    this.stepSmooth = 0;
    this.eye.copy(position);
    this.eye.y += this.eyeHeight;
  }

  park(feet: THREE.Vector3): void {
    const { pitch } = this;
    this.teleport(feet, this.yaw);
    this.pitch = pitch;
    this.clearInput();
    // Standing, so a kill from the seat does not score as an airborne one.
    this.grounded = true;
    this.parked = true;
  }

  unpark(grace: number): void {
    this.parked = false;
    this.parkGrace = grace;
  }

  reset(): void {
    this.parked = false;
    this.parkGrace = 0;
    this.alive = true;
    this.health = this.maxHealth = T.maxHealth;
    this.armor = 0;
    this.lastDamageT = 0;
    this.dashCharges = T.dashCharges;
    this.slideCooldownT = 0;
    this.peakSpeed = 0;
    Object.assign(this.modifiers, NEUTRAL_MODIFIERS);
    this.crouched = false;
    this.height = T.standHeight;
    this.eyeHeight = T.eyeStand;
    this.stridePhase = 0;
    this.airTime = 0;
    this.lookScale = 1;
    this.clearInput();
    const spawns = this.ctx.world.playerSpawns;
    const spawn = Array.isArray(spawns) ? spawns[0] : undefined;
    if (spawn) this.teleport(spawn.position, spawn.yaw);
    else this.teleport(this.pos);
    this.feedback.reset();
  }

  /** True when the capsule is inside something. Only tests and diagnostics need this. */
  isPenetrating(): boolean {
    return this.body.overlaps(this.pos, this.height);
  }
}
