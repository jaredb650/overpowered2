/**
 * A gun too heavy to run with. While the rotary cannon's barrels turn the player's ground speed is capped a little, and
 * while it or the heavy machine gun fires it is capped a lot: `WeaponDef.slow`, as a share of run speed.
 *
 * The cap is written to the player's velocity, not `modifiers.speed`, because progression rewrites that field every frame
 * after weapons run. The player moves at 120 Hz and wins speed back between two of our once-a-frame clamps, so the clamp
 * sits half a frame's regain under the target, which keeps the average on it at any frame rate.
 *
 * What it leaves alone, so that earned momentum stays the player's and a move is never cut short by the trigger:
 *
 * - A dash, a slide, a wall run, a climb, a vault and a slam. Nothing is clamped while one is going.
 * - Speed past `leave` times run speed, on the ground or off it: a pad, a blast or a slide hop put it there, pads are
 *   aimed, and the ground scrubs that kind of speed off by itself.
 * - What a move leaves behind. A dash ends at 13 m/s and a dash-jump at 18, both under `leave`, and a hard clamp the
 *   frame after would stop the player dead where the move ends. So speed a move left, or any speed over run speed (legs
 *   alone never make it), is carried: it bleeds down to the cap at `carry` m/s a second, net of what the legs or the
 *   air give back, and only once it is there does the clamp hold. `Handling.carrying` keeps that from frame to frame.
 *
 * An ordinary jump is not on that list. The air gives speed back to a player under run speed faster than any drag takes it
 * (`MOVE.airAccelSlow`), so a gentle drag there, which is what the Buzzsaw had, was no slowdown at all: measured live, a
 * hop with the trigger held kept 12.5 m/s. The cap holds in the air as on the ground. It never arrives in one frame: it
 * eases in with the barrels and with `TUNING.handling.rise`, so a trigger pulled in mid-air brakes the jump over a tenth
 * of a second and does not stop it dead.
 */
import type { PlayerSystem } from '../core/contracts';
import { clamp, lerp } from '../core/math';
import { MOVE } from '../player/tuning';
import { TUNING, type WeaponDef } from './data';

/** `?slow=0`: no gun slows the player, spinning or firing. */
export const SLOW_ON = typeof location === 'undefined' || new URLSearchParams(location.search).get('slow') !== '0';

export class Handling {
  /** 0 to 1: how much of the firing slowdown is on. */
  weight = 0;
  /** The player is above the cap on speed a move left, which bleeds off rather than being cut: see `holdSpeed`. */
  carrying = false;
  private sinceShot = 99;

  /** A round left the gun. */
  shot(): void {
    this.sinceShot = 0;
  }

  reset(): void {
    this.weight = 0;
    this.carrying = false;
    this.sinceShot = 99;
  }

  /**
   * Advances the firing weight and returns the ground speed cap for this frame, as a share of run speed. 1 is no cap.
   * `spin` is the barrels' 0 to 1 on a spin gun, and 0 for anything else.
   */
  cap(dt: number, def: WeaponDef, spin: number): number {
    const t = TUNING.handling;
    this.sinceShot += dt;
    const firing = def.slow !== undefined && this.sinceShot <= t.hold;
    this.weight = clamp(this.weight + (firing ? t.rise : -t.fall) * dt);
    if (!SLOW_ON) return 1;
    const spun = def.mode === 'spin' ? lerp(1, TUNING.buzzsaw.moveSpeed, clamp(spin)) : 1;
    return def.slow === undefined ? spun : lerp(spun, Math.min(spun, def.slow), this.weight);
  }
}

/** The part of the player this needs, so a stand-in can be handed over. */
export type Mover = Pick<PlayerSystem, 'velocity' | 'grounded' | 'sliding' | 'modifiers'>
  & Partial<Pick<PlayerSystem, 'dashing' | 'wallRunning' | 'mantling' | 'vaulting' | 'slamming'>>;

/** True while the player is in a move the gun must not cut short. */
export function inMove(p: Mover): boolean {
  return p.sliding === true || p.dashing === true || p.wallRunning === true || p.mantling === true || p.vaulting === true || p.slamming === true;
}

/**
 * Holds the player's horizontal speed to `cap` of run speed, by the rules at the top of this file. Returns the speed it left.
 * `state` carries what a move left from one frame to the next; without it every frame stands alone and nothing is carried.
 */
export function holdSpeed(p: Mover, cap: number, dt: number, state?: { carrying: boolean }): number {
  const v = p.velocity;
  const speed = Math.hypot(v.x, v.z);
  const scale = p.modifiers.speed;
  const run = MOVE.runSpeed * scale;
  if (cap >= 1 || speed < 1e-3) {
    if (state) state.carrying = false;
    return speed;
  }
  if (inMove(p) || speed > run * TUNING.handling.leave) {
    if (state) state.carrying = true;
    return speed;
  }
  if (state && speed > run * 1.02) state.carrying = true;
  const target = run * cap;
  // On the ground the player regains `groundAccel` between two clamps, so the clamp sits half of that under the target.
  let next = p.grounded ? Math.min(speed, Math.max(target - MOVE.groundAccel * scale * dt * 0.5, 0)) : Math.min(speed, target);
  if (state?.carrying) {
    // Once the cut takes it under run speed the legs, or a key held in the air (`airAccelSlow`), push back before the
    // next frame, so that is added to the brake and `carry` is what the player feels.
    let floor = speed - TUNING.handling.carry * dt;
    if (floor < run) floor -= (p.grounded ? MOVE.groundAccel : MOVE.airAccelSlow * MOVE.airWishSpeed) * scale * dt;
    if (floor > next) next = floor;
    else state.carrying = false;
  }
  if (next >= speed) return speed;
  const k = next / speed;
  v.x *= k;
  v.z *= k;
  return next;
}
