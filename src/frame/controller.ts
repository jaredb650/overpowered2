/**
 * The Frame's legs: a kinematic walker on the Rapier world, the only thing besides the player that walks freely.
 *
 * The body is a capsule from a step's height over the feet to the top of the hull, so anything lower than a step is under
 * it and not in its way: sandbags, barriers, rubble, a run of stairs. The ground is five rays, under the middle and four
 * feet, and the Frame stands on the highest of them. A ray cannot tunnel, and each one starts over where the feet were a
 * tick before, so no fall at any speed passes a floor. Walls stop the capsule; it slides along them.
 *
 * Everything here is motion. What a step, a landing or a stomp does to the world and the view is the owner's: it reads
 * `said`, which holds what happened during the last `update`.
 */
import * as THREE from 'three';
import { CG, type PhysicsSystem } from '../core/contracts';
import { clamp, lerp, wrapAngle } from '../core/math';
import { CapsuleWorld, newSweepHit } from '../player/collide';
import { FRAME, FRAME_TURN_FREE } from './data';
import type { DriveKind, GaitKind } from './loadout';
import type { DrivePlugin } from './move/drive/types';
import type { GaitPlugin, MoveState } from './move/gait/types';
import { DRIVE_REGISTRY, GAIT_REGISTRY } from './move/registry';

export interface WalkerIntent {
  /** -1..1 each, relative to the view: right and ahead. */
  moveX: number;
  moveZ: number;
  /** Where the mouse would put the view this frame, before the legs hold it back. A camera yaw: 0 looks down -Z. */
  viewYaw: number;
  /** Held. */
  jet: boolean;
  /** Pressed this frame. */
  stomp: boolean;
  charge: boolean;
  /** Held Shift (used by Afterburner jet mode and Long-Haul run). */
  chargeHeld?: boolean;
  /** Camera pitch in radians (used by Flight / Afterburner 3D steering). */
  viewPitch?: number;
}

/** What happened in the last `update`. */
export interface WalkerSaid {
  /** Feet planted. The side is `stride` parity. */
  steps: number;
  /** Speed of a landing, 0 for none. */
  landed: number;
  /** Height a stomp fell, or -1. */
  stomped: number;
  /** Speed a charge hit a wall at, or 0. */
  bumped: number;
  charged: boolean;
  /** Jets lit off the ground. */
  lifted: boolean;
  /** Radians the legs turned. */
  turned: number;
  /** Metres the ground under the feet rose or fell while walking: a step, for the eye to ease over. */
  shift: number;
  /** Put back on the last ground it stood on, having got lost below the world. Should never happen. */
  rescued: boolean;
  /** True when Spider Legs triggered a 360° leg sweep instead of a stomp. */
  swept: boolean;
  /** Extra stomp power/radius multiplier (e.g. 1.5 for Afterburner dive-bomb, 1 normally). */
  stompMult: number;
}

const DOWN = new THREE.Vector3(0, -1, 0);
const MAX_SLIDES = 4;
/** No tick longer than this: a stomp moves half a metre in one, well inside a step's reach. */
const TICK = 1 / 60;
/** How far down the HUD and the stomp look for the ground. */
const LOOK_DOWN = 80;
/** Below the world's floor by this much is lost. */
const LOST = 12;

const _wish = new THREE.Vector3();
const _base = new THREE.Vector3();
const _motion = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _n = new THREE.Vector3();
const _o = new THREE.Vector3();

export class Walker implements MoveState {
  /** Bottom of the legs. */
  readonly feet = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  /** Where the legs point, as a camera yaw. */
  legYaw = 0;
  /** Where the view is held, the same way: within the arc of the legs. */
  viewYaw = 0;
  grounded = false;
  /** Seconds of thrust left. */
  fuel: number = FRAME.jet.fuel;
  /** Current tank capacity in seconds (from the active drive plug-in). */
  maxFuel: number = FRAME.jet.fuel;
  jetting = false;
  flying = false;
  hovering = false;
  jetMode = false;
  armsLockedForward = false;
  charges: number = FRAME.charge.count;
  maxCharges: number = FRAME.charge.count;
  /** Seconds until the next charge is back. */
  chargeIn = 0;
  /** Seconds left of a charge. */
  charging = 0;
  stomping = false;
  /** Seconds left standing up out of a stomp. */
  recover = 0;
  /** Plants so far: whole numbers are a foot coming down. */
  stride = 0;
  boost = 0;
  stompTop = 0;
  onGround = 0;
  readonly chargeDir = new THREE.Vector3();
  readonly said: WalkerSaid = {
    steps: 0, landed: 0, stomped: -1, bumped: 0, charged: false, lifted: false, turned: 0, shift: 0, rescued: false,
    swept: false, stompMult: 1,
  };
  /** The legs take the view with them at once and there is no arc. */
  free: boolean = FRAME_TURN_FREE;
  /** Multiplier on walk speed from leg damage (1 intact, 0.62 one leg, 0.42 both legs), times the loadout's legs and engine. */
  speedScale = 1;
  /** Multiplier on the jets' launch from the loadout's legs (loadout.ts `frameStats`): 1 for the standard legs. */
  jumpScale = 1;
  /** Multiplier on Shift charge speed from the engine (`frameStats.dash`). */
  dashScale = 1;
  /** Multiplier on lateral strafe speed from the legs (`frameStats.strafe`). */
  strafeScale = 1;
  /** Multiplier on hull turn rate from the legs (`frameStats.turnRate`). */
  turnScale = 1;
  /** Multiplier on jet/flight fuel capacity from the engine (`frameStats.fuelScale`). */
  fuelScale = 1;

  private readonly body: CapsuleWorld;
  private readonly hit = newSweepHit();
  private readonly ray = newSweepHit();
  private readonly safe = new THREE.Vector3();
  private sinceGround = 0;
  private stuck = 0;
  private groundNormalY = 1;
  private gaitPlugin: GaitPlugin = GAIT_REGISTRY.walker;
  private drivePlugin: DrivePlugin = DRIVE_REGISTRY.jets;
  private readonly intent: WalkerIntent = { moveX: 0, moveZ: 0, viewYaw: 0, jet: false, stomp: false, charge: false, chargeHeld: false, viewPitch: 0 };

  constructor(physics: PhysicsSystem, private readonly floorY = -Infinity) {
    this.body = new CapsuleWorld(physics, FRAME.body.radius, CG.World | CG.Barrier);
  }

  /** Switches the active leg gait and engine drive plug-ins from the Frame's loadout. */
  setMovement(gait: GaitKind, drive: DriveKind): void {
    this.gaitPlugin = GAIT_REGISTRY[gait] ?? GAIT_REGISTRY.walker;
    this.drivePlugin = DRIVE_REGISTRY[drive] ?? DRIVE_REGISTRY.jets;
    this.gaitPlugin.reset?.();
    this.drivePlugin.reset?.();
    this.flying = this.hovering = this.jetMode = this.armsLockedForward = false;
    this.maxFuel = this.drivePlugin.maxFuel(this);
    this.maxCharges = this.drivePlugin.maxCharges(this);
    this.fuel = this.maxFuel;
    this.charges = this.maxCharges;
    this.chargeIn = 0;
  }

  /** HUD label for the drive/jets row (e.g. `'JETS'`, `'FLIGHT'`, `'ROTOR'`). */
  get driveHudLabel(): string {
    return this.drivePlugin.hudLabel ?? 'JETS';
  }

  /** Stands it on `feet`, facing `yaw`, with everything full. */
  place(feet: THREE.Vector3, yaw: number): void {
    this.feet.copy(feet);
    this.safe.copy(feet);
    this.velocity.set(0, 0, 0);
    this.legYaw = this.viewYaw = yaw;
    this.grounded = false;
    this.gaitPlugin.reset?.();
    this.drivePlugin.reset?.();
    this.maxFuel = this.drivePlugin.maxFuel(this);
    this.maxCharges = this.drivePlugin.maxCharges(this);
    this.fuel = this.maxFuel;
    this.jetting = this.flying = this.hovering = this.jetMode = this.armsLockedForward = this.stomping = false;
    this.charges = this.maxCharges;
    this.chargeIn = this.charging = this.recover = this.boost = 0;
    this.stride = 0;
    this.groundNormalY = 1;
    this.speedScale = 1;
    this.settle();
  }

  /** Stops an active charge dead (e.g. slamming a tank or crawler) and holds the legs in recovery. */
  stopCharge(recover = 0.8): void {
    this.charging = 0;
    this.recover = Math.max(this.recover, recover);
    this.velocity.x = this.velocity.z = 0;
  }

  /** Down onto whatever is under it, so a Frame placed over the floor starts standing. */
  private settle(): void {
    const below = this.clearance();
    if (below < LOOK_DOWN) {
      this.feet.y -= below;
      this.grounded = true;
    }
  }

  get speed(): number {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  /** Metres of air under the feet, up to `LOOK_DOWN`. */
  clearance(): number {
    _o.copy(this.feet);
    _o.y += 0.05;
    return this.body.castRay(_o, DOWN, LOOK_DOWN, this.ray) ? Math.max(0, this.ray.toi - 0.05) : LOOK_DOWN;
  }

  update(dt: number, intent: WalkerIntent): void {
    const s = this.said;
    s.steps = s.landed = s.bumped = s.turned = s.shift = 0;
    s.stomped = -1;
    s.charged = s.lifted = s.rescued = s.swept = false;
    s.stompMult = 1;
    Object.assign(this.intent, intent);
    this.intent.chargeHeld = intent.chargeHeld ?? false;
    this.intent.viewPitch = intent.viewPitch ?? 0;
    const ticks = Math.max(1, Math.ceil(dt / TICK - 1e-6));
    for (let i = 0; i < ticks; i++) {
      this.tick(dt / ticks, this.intent);
      // A press counts once, on the first tick.
      this.intent.stomp = this.intent.charge = false;
    }
  }

  private tick(h: number, intent: WalkerIntent): void {
    this.turn(h, intent);
    this.refill(h);
    if (!this.drivePlugin.charge?.(this, h, intent) && intent.charge) this.startCharge(intent);
    if (intent.stomp) {
      if (!this.gaitPlugin.startStomp?.(this, intent)) this.startStomp();
    }
    this.jets(h, intent);
    this.walk(h, intent);
    const startY = this.feet.y;
    const wasGrounded = this.grounded;
    this.slide(h);
    this.rise(h);
    this.ground(wasGrounded);
    if (wasGrounded && this.grounded) this.said.shift += this.feet.y - startY;
    this.stepping(h);
    this.lost();
  }

  // ---- turning ------------------------------------------------------------------------------------------------

  /**
   * Inside the arc the view is free and the legs stay planted. The mouse pushing past it drags the legs round at `rate`, and
   * whatever it asks beyond that is lost, so the view never moves on its own. Walking, the legs come round under it as well.
   */
  private turn(h: number, intent: WalkerIntent): void {
    const before = this.legYaw;
    if (!this.gaitPlugin.turn?.(this, h, intent)) {
      const T = FRAME.turn;
      const off = wrapAngle(intent.viewYaw - this.legYaw);
      if (this.free) {
        this.legYaw = wrapAngle(this.legYaw + off * (1 - Math.exp(-T.free * this.turnScale * h)));
        this.viewYaw = intent.viewYaw;
      } else {
        const over = Math.abs(off) - T.arc;
        const moving = this.grounded && (intent.moveX !== 0 || intent.moveZ !== 0);
        const rate = over > 0
          ? Math.min(over, T.rate * this.turnScale * h)
          : moving ? Math.min(Math.abs(off), T.walking * this.turnScale * h) : 0;
        this.legYaw = wrapAngle(this.legYaw + Math.sign(off) * rate);
        this.viewYaw = wrapAngle(this.legYaw + clamp(wrapAngle(intent.viewYaw - this.legYaw), -T.arc, T.arc));
      }
    }
    this.said.turned += Math.abs(wrapAngle(this.legYaw - before));
  }

  // ---- the three moves ----------------------------------------------------------------------------------------

  private refill(h: number): void {
    this.maxFuel = this.drivePlugin.maxFuel(this);
    this.maxCharges = this.drivePlugin.maxCharges(this);
    const refillTime = this.drivePlugin.chargeRefill(this);
    if (this.charges < this.maxCharges && refillTime > 0) {
      this.chargeIn -= h;
      if (this.chargeIn <= 0) {
        this.charges++;
        this.chargeIn = this.charges < this.maxCharges ? refillTime : 0;
      }
    } else if (this.charges >= this.maxCharges) {
      this.chargeIn = 0;
    }
    if (this.recover > 0) this.recover = Math.max(0, this.recover - h);
  }

  /** Shoulder first along the keys held, or the view with none; the legs re-plant under the view at once. Cancels standing up. */
  private startCharge(intent: WalkerIntent): void {
    const C = FRAME.charge;
    if (this.maxCharges <= 0 || this.charges <= 0 || this.charging > 0 || this.stomping) return;
    this.charges--;
    const refillTime = this.drivePlugin.chargeRefill(this);
    if (this.chargeIn <= 0 && refillTime > 0) this.chargeIn = refillTime;
    this.charging = C.seconds;
    this.recover = 0;
    this.legYaw = this.viewYaw;
    this.wish(intent, _wish);
    if (_wish.lengthSq() > 0.01) this.chargeDir.copy(_wish).normalize();
    else this.chargeDir.set(-Math.sin(this.viewYaw), 0, -Math.cos(this.viewYaw));
    this.said.charged = true;
  }

  private startStomp(): void {
    const S = FRAME.stomp;
    if (this.grounded || this.stomping || this.clearance() < S.minHeight) return;
    this.stomping = true;
    this.stompTop = this.feet.y;
    this.charging = this.boost = 0;
    this.velocity.x *= S.carry;
    this.velocity.z *= S.carry;
    this.velocity.y = -S.speed;
  }

  private jets(h: number, intent: WalkerIntent): void {
    if (this.drivePlugin.jets?.(this, h, intent)) return;
    const J = FRAME.jet;
    const maxFuel = this.maxFuel;
    const v = this.velocity;
    if (this.grounded) {
      this.onGround += h;
      if (this.onGround > J.refillAfter) this.fuel = Math.min(maxFuel, this.fuel + (maxFuel / J.refill) * h);
    } else {
      this.onGround = 0;
    }
    // A press off the ground launches; a key already down on landing does not, as a jump would not.
    const launch = intent.jet && !this.jetting && this.grounded && this.jumpScale > 0 && this.fuel >= J.launchMin && this.recover <= 0 && !this.stomping;
    if (launch) {
      v.y = J.launch * this.jumpScale;
      this.boost = J.boostSeconds;
      this.grounded = false;
      this.said.lifted = true;
      this.wish(intent, _wish);
      const want = Math.hypot(_wish.x, _wish.z);
      if (want > 0.1) {
        const k = Math.min(J.kick, Math.max(0, FRAME.walk.forward - (v.x * _wish.x + v.z * _wish.z) / want)) / want;
        v.x += _wish.x * k;
        v.z += _wish.z * k;
      }
    }
    const burning = intent.jet && !this.grounded && !this.stomping && this.fuel > 0;
    if (burning) {
      this.fuel = Math.max(0, this.fuel - h);
      if (this.boost > 0) {
        this.boost -= h;
        v.y += J.boost * h;
      } else {
        v.y += (0 - v.y) * (1 - Math.exp(-J.hold * h));
      }
    } else {
      this.boost = 0;
      if (this.stomping) v.y = -FRAME.stomp.speed;
      else if (!this.grounded) v.y -= FRAME.gravity * h;
    }
    this.jetting = intent.jet && (burning || this.grounded);
  }

  /** The keys as a velocity in the world: ahead and back and sideways each at its own speed. */
  wish(intent: WalkerIntent, out: THREE.Vector3): THREE.Vector3 {
    const W = FRAME.walk;
    let x = intent.moveX;
    let z = intent.moveZ;
    const len = Math.hypot(x, z);
    if (len > 1) {
      x /= len;
      z /= len;
    }
    const sy = Math.sin(this.viewYaw);
    const cy = Math.cos(this.viewYaw);
    const ahead = z * (z > 0 ? W.forward : W.back) * this.speedScale;
    const side = x * W.side * this.speedScale * this.strafeScale;
    return out.set(-sy * ahead + cy * side, 0, -cy * ahead - sy * side);
  }

  private walk(h: number, intent: WalkerIntent): void {
    if (this.drivePlugin.airMove?.(this, h, intent)) return;
    if (this.gaitPlugin.walk?.(this, h, intent, this.groundNormalY)) return;
    const W = FRAME.walk;
    const v = this.velocity;
    if (this.charging > 0) {
      this.charging -= h;
      const speed = this.charging > 0 ? FRAME.charge.speed * this.dashScale : W.forward;
      v.x = this.chargeDir.x * speed;
      v.z = this.chargeDir.z * speed;
      return;
    }
    if (this.stomping) return;
    if (this.recover > 0) _wish.set(0, 0, 0);
    else this.wish(intent, _wish);
    const control = this.grounded || this.jetting ? 1 : W.air;
    const now = Math.hypot(v.x, v.z);
    const want = Math.hypot(_wish.x, _wish.z);
    // Gaining speed the way it is already going is slow; everything else, stopping and turning, is the brakes.
    const gaining = want > now && v.x * _wish.x + v.z * _wish.z >= 0;
    const step = (gaining ? W.accel : W.decel) * control * h;
    const dx = _wish.x - v.x;
    const dz = _wish.z - v.z;
    const d = Math.hypot(dx, dz);
    if (d <= step) {
      v.x = _wish.x;
      v.z = _wish.z;
    } else {
      v.x += (dx / d) * step;
      v.z += (dz / d) * step;
    }
  }

  // ---- collision ----------------------------------------------------------------------------------------------

  /** Across, the body capsule against walls, sliding along them. A charge that meets one square on stops dead. */
  private slide(h: number): void {
    const B = FRAME.body;
    const step = this.gaitPlugin.stepHeight;
    const v = this.velocity;
    const height = Math.max(0.5, B.top - step);
    // Each plant pushes, so a walk swells and sags over a stride instead of gliding (suppressed on Treads).
    const surge = !this.gaitPlugin.noSurge && this.grounded && this.charging <= 0
      ? 1 + FRAME.walk.surge * Math.cos(this.stride * Math.PI * 2) : 1;
    _base.copy(this.feet);
    _base.y += step;
    _motion.set(v.x * h * surge, 0, v.z * h * surge);
    for (let i = 0; i < MAX_SLIDES; i++) {
      const len = _motion.length();
      if (len < 1e-6) break;
      if (!this.body.sweep(_base, height, _motion, this.hit)) {
        _base.add(_motion);
        break;
      }
      _dir.copy(_motion).divideScalar(len);
      // Walls only: a contact on the round of the capsule's end still pushes straight out from the axis.
      _n.set(this.hit.normal.x, 0, this.hit.normal.z);
      if (_n.lengthSq() < 0.04) _n.set(_base.x - this.hit.point.x, 0, _base.z - this.hit.point.z);
      if (_n.lengthSq() < 1e-8) break;
      _n.normalize();
      const into = -_dir.dot(_n);
      const travel = this.hit.toi * len;
      const back = into > 0.02 ? B.skin / into : 0;
      const moved = Math.max(0, travel - back);
      _base.addScaledVector(_dir, moved);
      if (this.charging > 0 && into > 0.5) {
        this.said.bumped = FRAME.charge.speed * this.dashScale;
        this.charging = 0;
        this.recover = 0.3;
        v.x = v.z = 0;
        break;
      }
      _motion.multiplyScalar(1 - moved / len);
      clipFlat(_motion, _n);
      clipFlat(v, _n);
    }
    // Casts that start inside something cannot be trusted: push out if a tick ends that way and keeps doing so.
    if (this.body.overlaps(_base, height)) {
      if (++this.stuck >= 2) this.body.depenetrate(_base, height, B.skin);
    } else {
      this.stuck = 0;
    }
    this.feet.x = _base.x;
    this.feet.z = _base.z;
  }

  /** Up, the capsule against what is overhead; down is the ground's to stop. */
  private rise(h: number): void {
    const B = FRAME.body;
    const step = this.gaitPlugin.stepHeight;
    const v = this.velocity;
    let dy = v.y * h;
    if (dy > 0) {
      _base.copy(this.feet);
      _base.y += step;
      _motion.set(0, dy, 0);
      if (this.body.sweep(_base, Math.max(0.5, B.top - step), _motion, this.hit)) {
        dy = Math.max(0, this.hit.toi * dy - B.skin);
        v.y = 0;
        this.boost = 0;
      }
    }
    if (!this.grounded) this.feet.y += dy;
  }

  /**
   * The highest walkable ground under the middle or a foot, from a step over the feet down to a step under them while
   * walking (it walks down stairs), or a hair under them in the air. Landing is meeting it on the way down; on the way up a
   * foot that catches a ledge lifts the Frame onto it and the climb goes on.
   */
  private ground(wasGrounded: boolean): void {
    const step = this.gaitPlugin.stepHeight;
    const minWalkY = this.gaitPlugin.minWalkY;
    const v = this.velocity;
    const reach = step + 0.05 + (wasGrounded ? step + 0.1 : 0.05);
    const c = Math.cos(this.legYaw);
    const sn = Math.sin(this.legYaw);
    const r = FRAME.foot;
    let top = -Infinity;
    let bestNormalY = 1;
    for (let i = 0; i < 5; i++) {
      // Middle, ahead, behind, left, right, in the legs' frame.
      const a = i === 0 ? 0 : r;
      const along = i === 1 ? -a : i === 2 ? a : 0;
      const across = i === 3 ? -a : i === 4 ? a : 0;
      _o.set(this.feet.x + c * across + sn * along, this.feet.y + step + 0.05, this.feet.z - sn * across + c * along);
      if (!this.body.castRay(_o, DOWN, reach, this.ray) || this.ray.toi < 0.01 || this.ray.normal.y < minWalkY) continue;
      if (this.ray.point.y > top) {
        top = this.ray.point.y;
        bestNormalY = this.ray.normal.y;
      }
    }
    if (top === -Infinity) {
      if (wasGrounded) this.leave();
      this.groundNormalY = 1;
      return;
    }
    if (wasGrounded || v.y <= 0) {
      if (!wasGrounded) this.land();
      this.feet.y = top;
      v.y = 0;
      this.grounded = true;
      this.groundNormalY = bestNormalY;
      this.sinceGround = 0;
      this.safe.copy(this.feet);
    } else if (top > this.feet.y) {
      this.feet.y = top;
      this.groundNormalY = bestNormalY;
    }
  }

  private leave(): void {
    this.grounded = false;
    this.velocity.y = Math.min(this.velocity.y, 0);
  }

  private land(): void {
    const v = this.velocity;
    this.said.landed = Math.max(this.said.landed, -v.y);
    if (this.stomping) {
      this.stomping = false;
      this.said.stomped = Math.max(0, this.stompTop - this.feet.y);
      this.recover = FRAME.stomp.recover;
      v.x = v.z = 0;
    }
    this.boost = 0;
  }

  /** Plants come by distance, longer strides at speed. Stopping, the foot in the air comes down. */
  private stepping(h: number): void {
    if (!this.grounded) {
      this.sinceGround += h;
      return;
    }
    const S = FRAME.stride;
    const speed = this.speed;
    const before = Math.floor(this.stride);
    if (speed > 0.3) this.stride += (speed * h) / lerp(S.slow, S.full, clamp(speed / FRAME.walk.forward));
    else if (this.stride - before > 1e-3) this.stride = Math.min(before + 1, this.stride + h * 2);
    this.said.steps += Math.floor(this.stride) - before;
  }

  /** A gap in the map must not drop it forever: back to the last ground it stood on. */
  private lost(): void {
    if (this.feet.y > this.floorY - LOST) return;
    this.feet.copy(this.safe);
    this.velocity.set(0, 0, 0);
    this.stomping = false;
    this.said.rescued = true;
  }
}

/** Takes out what of `v` goes into a wall with horizontal normal `n`. */
function clipFlat(v: THREE.Vector3, n: THREE.Vector3): void {
  const d = v.x * n.x + v.z * n.z;
  if (d >= 0) return;
  v.x -= n.x * d;
  v.z -= n.z * d;
}
