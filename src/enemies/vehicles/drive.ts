/**
 * How a ground vehicle moves. No physics body: a kinematic chassis along a route, with the weight added on top, because a tank that
 * a blast can shove or a bump can flip is a tank that can leave the road and strand a mission.
 *
 * Weight is three things. Speed follows what the road allows through limited acceleration and braking, with the braking curve worked
 * out from the distance left, so it arrives and does not stop dead. The nose follows the wheels, the wheels follow the driver, and
 * neither is instant. And the chassis sits on a spring, so braking dips the nose and a corner rolls the body, late and heavily.
 */
import { clamp, damp, wrapAngle } from '../../core/math';
import type { DriveDef } from './data';

export interface RoutePoint {
  x: number;
  z: number;
  /** Seconds to wait here. */
  hold: number;
}

/** Springs need a short step to stay stable, whatever the frame rate. */
const MAX_STEP = 1 / 120;
const ARRIVED = 0.6;
/** Share of top speed it keeps through a right-angle bend. */
const CORNER_KEEP = 0.4;
const STEER_DEADBAND = 0.02;
const AVOID_RATE = 1.6;
/** It pivots on the spot rather than swinging wide past this much error. */
const PIVOT_FROM = 0.9;
const PIVOT_SPEED = 1.2;

export class Driver {
  x = 0;
  z = 0;
  /** Facing. Forward is (sin, cos), as `rotation.y` takes it. */
  yaw = 0;
  /** Signed: negative runs backwards. */
  speed = 0;
  /** Wheel angle, or turn rate on tracks, as a share of `steer`. */
  wheel = 0;
  pitch = 0;
  roll = 0;
  /** Metres to the side of the route it is holding, to pass something. */
  offset = 0;
  /** 1 is the road's top speed. Broken things lower it. */
  limit = 1;
  /** Drives the route tail first. */
  reversing = false;
  /** Past the last point, or stopped by `halt`. */
  done = false;
  /** Lets go of everything: it coasts, and with no driver it stops. */
  coasting = false;

  private leg = 0;
  private holdLeft = 0;
  private pitchRate = 0;
  private rollRate = 0;
  private accel = 0;
  private turnRate = 0;
  private route: readonly RoutePoint[] = [];
  private facing = NaN;

  constructor(private readonly plan: DriveDef) {}

  begin(x: number, z: number, yaw: number, route: readonly RoutePoint[]): void {
    this.x = x;
    this.z = z;
    this.yaw = yaw;
    this.route = route;
    this.leg = 0;
    this.speed = this.wheel = this.pitch = this.roll = this.pitchRate = this.rollRate = this.offset = 0;
    this.holdLeft = 0;
    this.limit = 1;
    this.coasting = false;
    this.reversing = false;
    this.facing = NaN;
    this.done = route.length === 0;
  }

  /** Metres of road left to the end of the route. */
  private get remaining(): number {
    const { route, leg } = this;
    const next = route[leg];
    if (!next) return 0;
    let total = Math.hypot(next.x - this.x, next.z - this.z);
    for (let i = leg; i + 1 < route.length; i++) total += Math.hypot(route[i + 1]!.x - route[i]!.x, route[i + 1]!.z - route[i]!.z);
    return total;
  }

  private nextHold(): number {
    const { route, leg } = this;
    const next = route[leg];
    if (!next) return 0;
    return next.hold > 0 ? Math.hypot(next.x - this.x, next.z - this.z) : this.remaining;
  }

  /** `clear` is metres of free road ahead, for whatever is parked or driving there. */
  update(dt: number, clear: number): void {
    let left = dt;
    while (left > 1e-5) {
      const h = Math.min(left, MAX_STEP);
      this.step(h, clear);
      left -= h;
    }
  }

  private step(h: number, clear: number): void {
    const { plan } = this;
    const want = this.coasting || this.done ? 0 : this.wantedSpeed(h, clear);
    const sign = this.reversing ? -1 : 1;
    const before = this.speed;
    const target = want * sign;
    const rate = Math.abs(target) > Math.abs(this.speed) ? plan.accel : plan.brake;
    this.speed += clamp(target - this.speed, -rate * h, rate * h);
    this.accel = (this.speed - before) / h;
    this.steer(h);
    this.x += Math.sin(this.yaw) * this.speed * h;
    this.z += Math.cos(this.yaw) * this.speed * h;
    this.spring(h);
    this.advance(h);
  }

  private wantedSpeed(h: number, clear: number): number {
    const { plan } = this;
    if (this.holdLeft > 0) {
      this.holdLeft -= h;
      return 0;
    }
    const road = Math.min(this.nextHold(), clear);
    // The speed from which full braking stops exactly at the end of the road.
    const stopping = Math.sqrt(2 * plan.brake * Math.max(road, 0));
    const bend = clamp(1 - Math.abs(this.heading()) / (Math.PI / 2) * (1 - CORNER_KEEP), CORNER_KEEP, 1);
    return Math.min(plan.top * this.limit * bend, stopping);
  }

  /** Error between the nose and the point it is steering for, in radians. */
  private heading(): number {
    const { route, leg, plan } = this;
    const a = route[leg];
    if (!a) return 0;
    let tx = a.x;
    let tz = a.z;
    const to = Math.hypot(tx - this.x, tz - this.z);
    const b = route[leg + 1];
    if (b && to < plan.lookahead) {
      // Past the corner already: the look-ahead point slides onto the next leg, which is what rounds it off.
      const spare = plan.lookahead - to;
      const len = Math.max(Math.hypot(b.x - a.x, b.z - a.z), 1e-3);
      tx += ((b.x - a.x) / len) * Math.min(spare, len);
      tz += ((b.z - a.z) / len) * Math.min(spare, len);
    }
    const dx = tx - this.x;
    const dz = tz - this.z;
    const len = Math.max(Math.hypot(dx, dz), 1e-3);
    // The offset is to the right of the direction of travel.
    tx += (dz / len) * this.offset * -1;
    tz += (dx / len) * this.offset;
    const facing = this.reversing ? this.yaw + Math.PI : this.yaw;
    return wrapAngle(Math.atan2(tx - this.x, tz - this.z) - facing);
  }

  private steer(h: number): void {
    const { plan } = this;
    const tracked = plan.wheelbase === 0;
    const parked = this.coasting || this.done;
    const error = !parked ? this.heading() : tracked && !this.coasting && !Number.isNaN(this.facing) ? wrapAngle(this.facing - this.yaw) : 0;
    const aim = Math.abs(error) < STEER_DEADBAND ? 0 : clamp(error / (tracked ? 0.5 : plan.steer), -1, 1);
    this.wheel = damp(this.wheel, aim, plan.steerRate, h);
    const before = this.yaw;
    if (tracked) {
      // Tracks turn at any speed, down to nothing.
      this.yaw += this.wheel * plan.steer * h;
    } else {
      const flow = Math.abs(this.speed) < 0.05 ? 0 : (this.speed / plan.wheelbase) * Math.tan(this.wheel * plan.steer);
      this.yaw += flow * h * (this.reversing ? -1 : 1);
    }
    this.turnRate = (this.yaw - before) / h;
    if (tracked && Math.abs(error) > PIVOT_FROM) this.speed = clamp(this.speed, -PIVOT_SPEED, PIVOT_SPEED);
  }

  /** The chassis on its springs. Acceleration sits the tail down, a corner leans it out. */
  private spring(h: number): void {
    const { plan } = this;
    const pitchTo = clamp(-this.accel * plan.dive, -0.16, 0.16);
    const rollTo = clamp(this.turnRate * this.speed * plan.lean, -0.14, 0.14);
    this.pitchRate += (plan.spring * (pitchTo - this.pitch) - plan.damping * this.pitchRate) * h;
    this.rollRate += (plan.spring * (rollTo - this.roll) - plan.damping * this.rollRate) * h;
    this.pitch += this.pitchRate * h;
    this.roll += this.rollRate * h;
  }

  private advance(h: number): void {
    const { route, leg } = this;
    const next = route[leg];
    if (!next || this.done) return;
    if (Math.hypot(next.x - this.x, next.z - this.z) > Math.max(ARRIVED, Math.abs(this.speed) * h * 2) && !this.passed(next)) return;
    if (next.hold > 0) this.holdLeft = next.hold;
    this.leg++;
    if (this.leg >= route.length) this.done = true;
  }

  /** Over the line through a mark, square to the leg. A mark inside the turning circle would otherwise be circled for ever. */
  private passed(next: RoutePoint): boolean {
    const from = this.route[this.leg - 1];
    if (!from) return false;
    return (next.x - this.x) * (next.x - from.x) + (next.z - this.z) * (next.z - from.z) < 0;
  }

  /** A new road from where it stands, keeping its speed and its springs. */
  reroute(route: readonly RoutePoint[], reversing: boolean): void {
    this.route = route;
    this.leg = 0;
    this.holdLeft = 0;
    this.reversing = reversing;
    this.done = route.length === 0;
  }

  /** Once stopped, turns on the spot to face this way. Only tracks can. */
  face(yaw: number): void {
    this.facing = yaw;
  }

  /** Eases the side-step toward `metres`. */
  sidestep(metres: number, dt: number): void {
    this.offset = damp(this.offset, metres, AVOID_RATE, dt);
  }

  /** A jolt to the chassis: a hit, a shot from its own gun. */
  shove(pitch: number, roll: number): void {
    this.pitchRate += pitch;
    this.rollRate += roll;
  }

  /** Stops following the road where it is. */
  halt(): void {
    this.done = true;
  }
}
