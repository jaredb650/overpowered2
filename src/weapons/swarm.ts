/**
 * The Quiver's mind: painting marks, filling a salvo from them, and how a missile steers. Nothing here touches the world,
 * so every rule is a unit test away. `Weapons.ts` gathers what is in sight and fires; `Projectiles.ts` flies.
 *
 * A mark is a target, in the order painted. A target marked twice is in the list twice, and gets two missiles.
 */
import * as THREE from 'three';
import type { MissileTarget } from '../core/gameplay';

/** A target in the paint cone and in sight this tick, with its angle off the crosshair. */
export interface PaintCandidate {
  target: MissileTarget;
  /** Radians off the crosshair. */
  angle: number;
}

/** A boss or a vehicle: a spare mark goes to one of these before anything else. */
export function heavy(t: MissileTarget): boolean {
  return t.isBoss === true || (t.paintRadius ?? 0) > 1.5;
}

/** Radians off the line `forward`, or -1 when out of `cosCone` or `range`. Writes nothing. */
export function angleOff(eye: THREE.Vector3, forward: THREE.Vector3, at: THREE.Vector3, range: number, cosCone: number): number {
  const dx = at.x - eye.x;
  const dy = at.y - eye.y;
  const dz = at.z - eye.z;
  const d = Math.hypot(dx, dy, dz);
  if (d < 1e-3 || d > range) return -1;
  const c = (dx * forward.x + dy * forward.y + dz * forward.z) / d;
  if (c < cosCone) return -1;
  return Math.acos(Math.min(1, c));
}

/**
 * Where a spare mark goes when nobody new is in view: a heavy target already marked, else the marked target nearest the
 * crosshair. Only targets still in view count, so a spare never lands on someone behind a wall. Null when none is.
 */
export function stackOn(marks: readonly MissileTarget[], inView: readonly PaintCandidate[]): MissileTarget | null {
  let best: PaintCandidate | null = null;
  for (let i = 0; i < inView.length; i++) {
    const c = inView[i]!;
    if (!c.target.alive || !marks.includes(c.target)) continue;
    if (!best) {
      best = c;
      continue;
    }
    const h = heavy(c.target);
    const bh = heavy(best.target);
    if (h !== bh ? h : c.angle < best.angle) best = c;
  }
  return best ? best.target : null;
}

/** The next mark: the unmarked target nearest the crosshair, else a spare on one already marked. */
export function nextMark(marks: readonly MissileTarget[], inView: readonly PaintCandidate[]): MissileTarget | null {
  let best: PaintCandidate | null = null;
  for (let i = 0; i < inView.length; i++) {
    const c = inView[i]!;
    if (!c.target.alive || marks.includes(c.target)) continue;
    if (!best || c.angle < best.angle) best = c;
  }
  return best ? best.target : stackOn(marks, inView);
}

/**
 * Hold to paint. `begin` on the press, `update` every frame the trigger is held, `release` when it lets go. A mark lands
 * every `every` seconds, the first one `every` after the press, so a tap leaves none.
 */
export class Painter {
  readonly marks: MissileTarget[] = [];
  painting = false;
  max = 4;
  /** Seconds held. */
  held = 0;
  private clock = 0;

  constructor(private readonly every: number) {}

  begin(max: number): void {
    this.marks.length = 0;
    this.painting = true;
    this.max = Math.max(0, max);
    this.held = 0;
    this.clock = this.every;
  }

  cancel(): void {
    this.marks.length = 0;
    this.painting = false;
    this.held = 0;
  }

  get full(): boolean {
    return this.marks.length >= this.max;
  }

  /**
   * Advances the hold. `look` answers everyone in the cone and in sight now. Returns the target marked on this call, or null.
   * A mark on a target that has died is dropped, which frees its place for someone else.
   */
  update(dt: number, look: () => readonly PaintCandidate[]): MissileTarget | null {
    if (!this.painting) return null;
    this.held += dt;
    for (let i = this.marks.length - 1; i >= 0; i--) if (!this.marks[i]!.alive) this.marks.splice(i, 1);
    if (this.full) return null;
    this.clock -= dt;
    if (this.clock > 0) return null;
    // Asked only when a mark is due: what is in sight costs a ray per target in the cone.
    const mark = nextMark(this.marks, look());
    // Nothing to paint: wait, and paint on the first frame someone comes into view.
    if (!mark) {
      this.clock = 0;
      return null;
    }
    this.marks.push(mark);
    this.clock += this.every;
    if (this.clock < 0) this.clock = 0;
    return mark;
  }

  /**
   * Ends the hold and writes one target per missile into `out`, `count` long: the marks still alive, in the order they
   * were painted, then the spares on the same rule as a stacked mark. With no live mark every entry is null, a dumb salvo.
   * Returns how many missiles have a target.
   */
  release(out: (MissileTarget | null)[], count: number, inView: readonly PaintCandidate[]): number {
    this.painting = false;
    out.length = count;
    let n = 0;
    for (let i = 0; i < this.marks.length && n < count; i++) {
      const m = this.marks[i]!;
      if (m.alive) out[n++] = m;
    }
    const live = n;
    if (live === 0) {
      for (let i = 0; i < count; i++) out[i] = null;
      this.marks.length = 0;
      return 0;
    }
    // Spares: on the heavy or the nearest the crosshair among those still in view, else on the first mark.
    const spare = stackOn(this.marks, inView) ?? out[0]!;
    while (n < count) out[n++] = spare;
    this.marks.length = 0;
    return count;
  }
}

const _axis = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _side = new THREE.Vector3();
const _up = new THREE.Vector3();

/**
 * Turns `velocity` toward the unit direction `want` by at most `maxAngle` radians, keeping its speed. Returns the angle
 * that was left to turn after this step.
 */
export function turnToward(velocity: THREE.Vector3, want: THREE.Vector3, maxAngle: number): number {
  const speed = velocity.length();
  if (speed < 1e-6) return 0;
  const dir = _v.copy(velocity).divideScalar(speed);
  const angle = Math.acos(Math.max(-1, Math.min(1, dir.dot(want))));
  if (angle < 1e-6) return 0;
  if (angle <= maxAngle) {
    velocity.copy(want).multiplyScalar(speed);
    return 0;
  }
  _axis.crossVectors(dir, want);
  // Straight behind: any axis at right angles will do.
  if (_axis.lengthSq() < 1e-10) {
    _axis.set(-dir.z, 0, dir.x);
    if (_axis.lengthSq() < 1e-10) _axis.set(1, 0, 0);
  }
  _axis.normalize();
  _q.setFromAxisAngle(_axis, maxAngle);
  velocity.copy(dir).applyQuaternion(_q).multiplyScalar(speed);
  return angle - maxAngle;
}

/**
 * The nearest live target ahead of a missile, inside `range`, or null to fly on straight. "Ahead" is within 70 degrees of
 * its heading: a missile does not double back for someone behind it.
 */
export function retarget(
  position: THREE.Vector3, heading: THREE.Vector3, candidates: readonly MissileTarget[], range: number,
): MissileTarget | null {
  const speed = heading.length();
  if (speed < 1e-6) return null;
  let best: MissileTarget | null = null;
  let bestD = range * range;
  for (let i = 0; i < candidates.length; i++) {
    const t = candidates[i]!;
    if (!t.alive) continue;
    const dx = t.center.x - position.x;
    const dy = t.center.y + (t.aimLift ?? 0) - position.y;
    const dz = t.center.z - position.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 >= bestD || d2 < 1e-6) continue;
    const c = (dx * heading.x + dy * heading.y + dz * heading.z) / (Math.sqrt(d2) * speed);
    if (c < 0.34) continue;
    best = t;
    bestD = d2;
  }
  return best;
}

/**
 * Bends the unit direction `dir` off its line by up to `amount` radians, on a slow figure eight set by `phase`, and
 * renormalises it. The side and up axes are built from `dir`, so the weave works at any heading.
 */
export function weave(dir: THREE.Vector3, phase: number, amount: number): THREE.Vector3 {
  if (amount <= 0) return dir;
  const side = _side.set(-dir.z, 0, dir.x);
  if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
  side.normalize();
  const up = _up.crossVectors(side, dir).normalize();
  const s = Math.sin(phase) * amount;
  const u = Math.sin(phase * 0.71 + 1.3) * amount * 0.5;
  return dir.addScaledVector(side, s).addScaledVector(up, u).normalize();
}
