/**
 * Drive plug-in interface for the Distraint Frame's engines (`src/frame/move/drive/`).
 * Lane J implements `flight.ts`, `hover.ts`, `afterburner.ts`, `overcharge.ts`, and `diesel.ts` without editing
 * `controller.ts` or `seat.ts`.
 */
import type { DriveKind } from '../../loadout';
import type { WalkerIntent } from '../../controller';
import type { MoveState } from '../gait/types';

export interface DrivePlugin {
  readonly kind: DriveKind;
  /** Fuel tank duration in seconds. */
  maxFuel(s: MoveState): number;
  /** Maximum stored Shift charges (0 = no Shift charge). */
  maxCharges(s: MoveState): number;
  /** Seconds to refill one Shift charge. */
  chargeRefill(s: MoveState): number;
  /** Optional custom Shift charge / run / jet-blast / jet-mode handler. Return true to replace standard charge. */
  charge?(s: MoveState, h: number, intent: WalkerIntent): boolean;
  /** Optional custom Space jump-jet / flight / hover handler. Return true to replace standard jets. */
  jets?(s: MoveState, h: number, intent: WalkerIntent): boolean;
  /** Optional custom airborne / jet-mode horizontal+vertical movement handler. Return true to replace standard walk. */
  airMove?(s: MoveState, h: number, intent: WalkerIntent): boolean;
  /** Optional HUD label for the jets/drive row (defaults to `'JETS'`). */
  readonly hudLabel?: string;
  /** Reset any internal drive state on `Walker.place`. */
  reset?(): void;
}
