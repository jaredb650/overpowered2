/**
 * One capture as a state machine, with no three.js in it, so a test can walk it: cuffing, cuffed and waiting for a drone, hooked, and
 * gone. airlift.ts flies the drone and calls the transitions; this only says which are allowed, and pays the bounty exactly once.
 */
import type { Soldier } from './soldier';

export type CapturePhase = 'cuffing' | 'cuffed' | 'hooked' | 'gone';

/** Seconds of getting his wrists behind him and the cuffs on, before he is waiting for the drone. */
export const CUFFING_SECONDS = 1.1;

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
  /** Lifted off the floor and paid for. Once per man, whatever happens to him after. */
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
