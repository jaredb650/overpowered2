/** Pure movement maths. No three.js types and no state, so vitest can check it directly. */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export function moveToward(current: number, target: number, maxDelta: number): number {
  const d = target - current;
  if (Math.abs(d) <= maxDelta) return target;
  return current + Math.sign(d) * maxDelta;
}

/**
 * Quake's PM_Accelerate on the horizontal plane. It only limits speed along the wish direction, so a wish
 * nearly perpendicular to velocity keeps adding speed. That loophole is what strafe-jumping is.
 */
export function quakeAccelerate(v: Vec3, wishX: number, wishZ: number, wishSpeed: number, accel: number, dt: number): void {
  const current = v.x * wishX + v.z * wishZ;
  const add = wishSpeed - current;
  if (add <= 0) return;
  const gain = Math.min(accel * wishSpeed * dt, add);
  v.x += wishX * gain;
  v.z += wishZ * gain;
}

/** CPMA air control: turns horizontal velocity toward the wish direction without changing its length. */
export function airSteer(v: Vec3, wishX: number, wishZ: number, strength: number, dt: number): void {
  const speed = Math.hypot(v.x, v.z);
  if (speed < 1e-3) return;
  const ux = v.x / speed;
  const uz = v.z / speed;
  const dot = ux * wishX + uz * wishZ;
  if (dot <= 0) return;
  const k = strength * dot * dot * dt;
  const nx = ux * speed + wishX * k;
  const nz = uz * speed + wishZ * k;
  const len = Math.hypot(nx, nz);
  v.x = (nx / len) * speed;
  v.z = (nz / len) * speed;
}

/** Moves `v` toward `(tx, ty, tz)` in a straight line by at most `maxDelta`. */
export function approachVector(v: Vec3, tx: number, ty: number, tz: number, maxDelta: number): void {
  const dx = tx - v.x;
  const dy = ty - v.y;
  const dz = tz - v.z;
  const d = Math.hypot(dx, dy, dz);
  if (d <= maxDelta || d < 1e-9) {
    v.x = tx;
    v.y = ty;
    v.z = tz;
    return;
  }
  const s = maxDelta / d;
  v.x += dx * s;
  v.y += dy * s;
  v.z += dz * s;
}

/** Exponential decay of the part of `speed` above `limit`. Rate is 1/seconds. */
export function softLimit(speed: number, limit: number, rate: number, dt: number): number {
  if (speed <= limit) return speed;
  return limit + (speed - limit) * Math.exp(-rate * dt);
}

/** Removes the part of `v` going into a surface. `n` must be unit length. */
export function clipVelocity(v: Vec3, n: Vec3): void {
  const into = v.x * n.x + v.y * n.y + v.z * n.z;
  if (into >= 0) return;
  v.x -= n.x * into;
  v.y -= n.y * into;
  v.z -= n.z * into;
}

/** Projects `v` onto the plane with normal `n` and restores its length, so a slope redirects speed instead of eating it. */
export function redirectOntoPlane(v: Vec3, n: Vec3): void {
  const speed = Math.hypot(v.x, v.y, v.z);
  const d = v.x * n.x + v.y * n.y + v.z * n.z;
  v.x -= n.x * d;
  v.y -= n.y * d;
  v.z -= n.z * d;
  const len = Math.hypot(v.x, v.y, v.z);
  if (len < 1e-6) return;
  const s = speed / len;
  v.x *= s;
  v.y *= s;
  v.z *= s;
}

/** Rotates the horizontal part of `v` toward a unit direction by `fraction` of the angle between them, capped at `maxAngle`. */
export function rotateToward(v: Vec3, dirX: number, dirZ: number, fraction: number, maxAngle = Math.PI): void {
  const speed = Math.hypot(v.x, v.z);
  if (speed < 1e-6) return;
  const from = Math.atan2(v.z, v.x);
  let delta = Math.atan2(dirZ, dirX) - from;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  const turn = Math.max(-maxAngle, Math.min(maxAngle, delta * fraction));
  v.x = Math.cos(from + turn) * speed;
  v.z = Math.sin(from + turn) * speed;
}

/** Steady speed gain per second of perfect W+strafe at `speed`, for tests and docs: d(v^2)/dt = 2 a W^2. */
export function idealStrafeGain(speed: number, wishSpeed: number, accel: number): number {
  return (accel * wishSpeed * wishSpeed) / Math.max(speed, 1e-3);
}

/** Bounce speed out of a slam: a fraction of the fall's energy, clamped. */
export function slamBounceSpeed(fall: number, gravity: number, energyReturn: number, min: number, max: number): number {
  const v = Math.sqrt(2 * gravity * Math.max(fall, 0) * energyReturn);
  return Math.max(min, Math.min(max, v));
}

/** Radians and meters. Far below what the eye can see, so the last step to rest never shows. */
const REST_EPSILON = 1e-4;

export interface SpringState {
  x: number;
  v: number;
}

/**
 * Advances a damped spring toward 0 with the exact solution, so a stiff camera spring cannot blow up on a long
 * frame and gives the same motion at any frame rate. `omega` is the natural frequency in rad/s, `zeta` the
 * damping ratio, and `zeta` must be below 1.
 */
export function springStep(s: SpringState, omega: number, zeta: number, dt: number): void {
  const wd = omega * Math.sqrt(1 - zeta * zeta);
  const decay = Math.exp(-zeta * omega * dt);
  const c = Math.cos(wd * dt);
  const sn = Math.sin(wd * dt);
  const a = s.x;
  const b = (s.v + zeta * omega * s.x) / wd;
  s.x = decay * (a * c + b * sn);
  s.v = decay * ((b * wd - zeta * omega * a) * c - (a * wd + zeta * omega * b) * sn);
  if (Math.abs(s.x) < REST_EPSILON && Math.abs(s.v) < REST_EPSILON) s.x = s.v = 0;
}

/** Exponential decay never reaches its target, and a view that should be level has to be exactly level. */
export function settle(x: number, target: number): number {
  return Math.abs(x - target) < REST_EPSILON ? target : x;
}
