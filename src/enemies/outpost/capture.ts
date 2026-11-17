/**
 * One capture, with no three.js in it, so a test can walk it: the E key on a kneeling man, the state machine (cuffing, cuffed, hooked,
 * gone), when the drone's pass snatches him, the line he hangs on, and the bounty paid exactly once. airlift.ts flies the drone and
 * calls the transitions; this only says which are allowed.
 */
import type { Soldier } from './soldier';

export type CapturePhase = 'cuffing' | 'cuffed' | 'hooked' | 'gone';

/** Seconds: E let up before this is a tap, a question. Held past it, it is a capture under way, and the ring starts to fill. */
export const TAP_MAX = 0.22;
/** Seconds of holding E on a kneeling man that make it a capture: a commitment, for a bounty of about 300 (contracts/defense/data.ts). */
export const CUFF_HOLD = 1.2;
/** Seconds of getting his wrists behind him and the cuffs on: the first click, the second, and done. */
export const CLICKS = [0.3, 0.55] as const;
export const CUFFING_SECONDS = 0.7;
/** Seconds from the cuffs going on to the hook taking him off the floor, when he is out in the open. */
export const SNATCH_AT = 1.5;
/** Metres a second he is dragged along the floor on the line, out from under a roof to where the drone can reach him. */
export const DRAG_SPEED = 13;

/** What E on a kneeling man comes to: nothing yet, a question, cuffs, or a hold let go too soon (nothing at all). */
export type Gesture = 'question' | 'cuff' | 'cancel' | null;

/**
 * The key, read every frame while it is down and once on the frame it comes up. `held` is seconds down so far. Held to `CUFF_HOLD`,
 * it cuffs him at once, without waiting for the key to come up. Let up before `TAP_MAX` it questions him, once: a man already
 * questioned has nothing more to say. Let up anywhere else, it was a capture abandoned, and does nothing.
 */
export function gesture(held: number, down: boolean, questioned: boolean): Gesture {
  if (held >= CUFF_HOLD) return 'cuff';
  if (down) return null;
  return held < TAP_MAX && !questioned ? 'question' : 'cancel';
}

/** The capture ring's fill (ui/hud/holdRing.ts) for E held `held` seconds: none while it could still be a tap, then 0 to 1. */
export const holdFill = (held: number): number => (held < TAP_MAX ? 0 : Math.min(1, (held - TAP_MAX) / (CUFF_HOLD - TAP_MAX)));

/** Seconds from the cuffs going on to the snatch, for a man who has `drag` metres to be dragged first (0 in the open). */
export const snatchTime = (drag: number): number => Math.max(SNATCH_AT, CUFFING_SECONDS + drag / DRAG_SPEED);

export interface Vec {
  x: number;
  y: number;
  z: number;
}

/**
 * A weight on a line from `anchor`, by its velocity, as a ragdoll's chest is held: what is past `length` is pulled back in at `pull`
 * per second, and any speed outward along the line goes. Slack, nothing changes. Writes `v`. True when the line is taut.
 */
export function rope(p: Vec, v: Vec, anchor: Vec, length: number, pull: number): boolean {
  const dx = p.x - anchor.x, dy = p.y - anchor.y, dz = p.z - anchor.z;
  const d = Math.hypot(dx, dy, dz);
  if (d <= length || d < 1e-6) return false;
  const nx = dx / d, ny = dy / d, nz = dz / d;
  const out = Math.max(0, v.x * nx + v.y * ny + v.z * nz) + (d - length) * pull;
  v.x -= nx * out;
  v.y -= ny * out;
  v.z -= nz * out;
  return true;
}

/** Where a bounty goes. Outpost Defense's `Defense` is one; a mode without credits has none. */
export interface Wallet {
  earn(amount: number): void;
}

export class Capture {
  phase: CapturePhase = 'cuffing';
  /** Seconds in this phase. */
  t = 0;
  /** A drone is assigned to him. */
  drone = false;
  /** Snatched off the floor and paid for. Once per man, whatever happens to him after. */
  secured = false;

  constructor(readonly s: Soldier) {}

  private to(phase: CapturePhase): void {
    this.phase = phase;
    this.t = 0;
  }

  step(dt: number): void {
    this.t += dt;
    if (this.phase === 'cuffing' && this.t >= CUFFING_SECONDS) this.to('cuffed');
  }

  /** Cuffed with no drone on its way yet. */
  get waiting(): boolean {
    return this.phase === 'cuffed' && !this.drone;
  }

  /** The hook has him. */
  hook(): boolean {
    if (this.phase !== 'cuffed' || !this.drone) return false;
    this.to('hooked');
    return true;
  }

  /** Off the hook and still alive: back on the floor, waiting for another drone. */
  drop(): void {
    this.drone = false;
    if (this.phase === 'hooked') this.to('cuffed');
  }

  /** Carried out of sight. */
  leave(): boolean {
    if (this.phase !== 'hooked') return false;
    this.to('gone');
    return true;
  }

  /**
   * His feet have left the floor. Pays `bounty` into `wallet` the first time only. Null when it was already paid or he is not on
   * the hook; otherwise what was paid, which is 0 where there are no credits.
   */
  secure(wallet: Wallet | null | undefined, bounty: number): number | null {
    if (this.secured || this.phase !== 'hooked') return null;
    this.secured = true;
    if (!wallet) return 0;
    wallet.earn(bounty);
    return bounty;
  }
}
