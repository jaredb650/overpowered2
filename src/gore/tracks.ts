/**
 * Blood carried on feet. Whoever steps in wet blood (a pool, a soaked patch, a fresh burst) leaves red prints after it,
 * each fainter than the last, for a dozen steps; a slide through it leaves a long smear. The player's steps come from
 * the stride the footstep sounds use, an enemy's from its animator's foot plants (`Gore.footfall`).
 *
 * Nothing is simulated: a walker is a count of steps left. Every print is one ray out of the blood field's budget and
 * one decal, so a crowd running through a massacre costs a few decals a second.
 */
import * as THREE from 'three';
import type { Ctx } from '../core/contracts';
import type { BloodField } from './blood';

export const TrackTuning = {
  /** Prints a wet foot leaves before it is dry. */
  steps: 12,
  /** A boot print's quad, m (the sole is 0.9 of it). */
  print: 0.38,
  /** Half the gap between a walker's two feet, m. */
  stance: 0.11,
  /** Metres slid between smears, and the steps of blood each one uses up. */
  slideEvery: 0.7,
  slideCost: 2,
  /** Enemy prints a second, all enemies together. The nearest to the player matter; the rest are noise. */
  perSecond: 14,
  /** An enemy further than this from the player leaves none. */
  reach: 30,
};

/** How faint a print is, 0 (fresh from the pool) to 1 (the last): the share of the blood that is gone. */
export function printFade(left: number, steps = TrackTuning.steps): number {
  return 1 - Math.max(0, Math.min(1, left / steps));
}

interface Walker {
  /** Steps of blood left on the feet. */
  left: number;
  /** Which foot is next: prints alternate. */
  leftFoot: boolean;
}

/** What the tracker reads from the player: all of it is on the Player already. */
interface Stepper {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  yaw: number;
  grounded: boolean;
  sliding?: boolean;
  stridePhase?: number;
}

const _at = new THREE.Vector3();
const _dir = new THREE.Vector3();

export class Tracks {
  private walkers = new WeakMap<object, Walker>();
  private readonly me: Walker = { left: 0, leftFoot: false };
  private lastStride = 0;
  private readonly slideFrom = new THREE.Vector3();
  private wasSliding = false;
  /** Enemy prints still allowed this second. */
  private allowance = TrackTuning.perSecond;
  /** Prints and smears laid since the last `clear`. For checks. */
  laid = 0;

  constructor(private readonly ctx: Ctx, private readonly blood: BloodField) {}

  /** Steps of blood left on the player's feet. */
  get playerSteps(): number {
    return this.me.left;
  }

  /** Steps of blood left on a body's feet. */
  stepsOf(who: object): number {
    return this.walkers.get(who)?.left ?? 0;
  }

  /**
   * A foot came down at (x, y, z), its owner facing along (fx, fz). In wet blood it is wet again; out of it, a wet foot
   * leaves a print and is a step drier. Returns true when a print was laid.
   */
  step(walker: Walker, x: number, y: number, z: number, fx: number, fz: number): boolean {
    walker.leftFoot = !walker.leftFoot;
    if (this.blood.wetAt(x, y, z)) {
      walker.left = TrackTuning.steps;
      return false;
    }
    if (walker.left <= 0) return false;
    const fade = printFade(walker.left);
    walker.left--;
    _at.set(x, y + 0.2, z);
    _dir.set(fx, 0, fz);
    this.blood.printAt(_at, _dir, TrackTuning.print, walker.leftFoot, fade);
    this.laid++;
    return true;
  }

  /** An enemy's foot plant, from its animator. `who` is anything that stands for the body (its character), facing along (fx, fz). */
  footfall(who: object, x: number, y: number, z: number, fx: number, fz: number): void {
    let w = this.walkers.get(who);
    if (!w) {
      // Most feet are never wet: a walker is only kept once it has stepped in blood.
      if (!this.blood.wetAt(x, y, z)) return;
      w = { left: 0, leftFoot: false };
      this.walkers.set(who, w);
    }
    if (w.left > 0 && !this.blood.wetAt(x, y, z)) {
      const p = this.ctx.player.position;
      if (this.allowance < 1 || (p && Math.hypot(p.x - x, p.z - z) > TrackTuning.reach)) {
        // Too many or too far: the step dries the foot all the same.
        w.leftFoot = !w.leftFoot;
        w.left--;
        return;
      }
      this.allowance--;
    }
    this.step(w, x, y, z, fx, fz);
  }

  update(dt: number): void {
    const t = TrackTuning;
    this.allowance = Math.min(t.perSecond, this.allowance + t.perSecond * dt);
    const p = this.ctx.player as unknown as Stepper;
    if (!p?.position) return;
    const me = this.me;
    const sliding = !!p.sliding && p.grounded;
    if (sliding) {
      if (!this.wasSliding) this.slideFrom.copy(p.position);
      // A slide through blood picks it up along the whole body, and lays it back down as a smear.
      if (this.blood.wetAt(p.position.x, p.position.y, p.position.z)) me.left = t.steps;
      const moved = Math.hypot(p.position.x - this.slideFrom.x, p.position.z - this.slideFrom.z);
      if (moved >= t.slideEvery) {
        if (me.left > 0 && !this.blood.wetAt(p.position.x, p.position.y, p.position.z)) {
          _at.copy(this.slideFrom).lerp(p.position, 0.5);
          this.blood.smear(_at, p.position.x - this.slideFrom.x, p.position.z - this.slideFrom.z, Math.min(moved * 1.5, 1.2), printFade(me.left));
          me.left = Math.max(0, me.left - t.slideCost);
          this.laid++;
        }
        this.slideFrom.copy(p.position);
      }
    }
    this.wasSliding = sliding;
    const stride = Math.floor(p.stridePhase ?? 0);
    if (stride === this.lastStride) return;
    this.lastStride = stride;
    if (!p.grounded || sliding) return;
    // The player faces -Z turned by yaw. The foot that just came down is to one side of that line.
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    const side = me.leftFoot ? t.stance : -t.stance;
    this.step(me, p.position.x - fz * side, p.position.y, p.position.z + fx * side, fx, fz);
  }

  clear(): void {
    this.walkers = new WeakMap();
    this.me.left = 0;
    this.me.leftFoot = false;
    this.lastStride = 0;
    this.wasSliding = false;
    this.allowance = TrackTuning.perSecond;
    this.laid = 0;
  }
}
