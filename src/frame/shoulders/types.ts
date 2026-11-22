/**
 * Shoulder weapon plug-in contract for the Distraint Frame (`src/frame/shoulders/`).
 * Phase 1 shoulder lanes (C: mortar, E: storm, F: mirv & wire, H: fpv, pointdef & flares) implement `ShoulderPlugin`
 * in their own file without editing `weapons.ts`, `seat.ts`, `puppet.ts`, or `shoulders/registry.ts`.
 */
import type * as THREE from 'three';
import type { Ctx } from '../../core/contracts';
import type { MissileTarget } from '../../core/gameplay';
import type { Ac130Rounds } from '../../progression/callins/ac130Rounds';
import type { MechKind } from '../../progression/callins/link';
import type { GunnerWeapon } from '../../vehicles/hud';
import type { PaintCandidate } from '../../weapons/swarm';
import type { ShoulderKind } from '../loadout';
import type { Sight } from '../arms/types';

/** Modifiers a Countermeasure Rack (or similar defence shoulder) applies to the Frame's Q smoke. */
export interface SmokeModifier {
  /** Override max smoke charges (default 3; Countermeasure Rack = 6). */
  maxCharges?: number;
  /** Override refill seconds per charge (default 14; Countermeasure Rack = 7). */
  refillSeconds?: number;
  /** Scale smoke wall width/length (default 1; Countermeasure Rack = 1.5). */
  screenScale?: number;
}

export interface ShoulderUpdateContext {
  readonly ctx: Ctx;
  readonly rounds: Ac130Rounds;
  /** Slot index 0..2 (`0 = G`, `1 = V`, `2 = B`). */
  readonly slot: number;
  /** Trigger key label: `'G'`, `'V'`, or `'B'`. */
  readonly keyLabel: string;
  /** Ammo cycle key label: `'3'`, `'4'`, or `'5'`. */
  readonly cycleKeyLabel: string;
  readonly sight: Sight;
  /** World-space position of this shoulder mount (writes into `out`). */
  mountPos(out: THREE.Vector3): THREE.Vector3;
  /** Frame's feet position and torso yaw in world space. */
  readonly feet: THREE.Vector3;
  readonly torsoYaw: number;
  readonly held: boolean;
  readonly pressed: boolean;
  /** True on the frame the pilot tapped this slot's ammo-cycle key (`3`, `4`, or `5`). */
  readonly cyclePressed: boolean;
  /** False when the mount has been knocked offline (slot 0 damage state). */
  readonly online: boolean;
  /** Shared painter candidate lookup (enemies + vehicles in view cone with LOS). */
  gatherTargets(range?: number, coneCos?: number): readonly PaintCandidate[];
  /** Co-op six-tube pod missile callback. */
  readonly onMissile: ((from: THREE.Vector3, velocity: THREE.Vector3) => void) | null;
  /** Co-op mech news callback (`storm`, `mirv`, `wire`, `mortar`, `fpv`, `pointdef`). */
  readonly onNews: ((kind: MechKind, values: number[]) => void) | null;
  /** Trigger auto-flares without consuming a Q smoke charge (Countermeasure Rack). */
  popFreeFlares(): void;
}

export interface FrameShoulderWeapon {
  readonly kind: ShoulderKind;
  /** True when this shoulder supports ammo/round cycling (used for `3` fallback routing). */
  readonly hasCycle?: boolean;
  /** Painted targets to display on the cockpit HUD (up to 8). */
  readonly marks?: readonly MissileTarget[];
  /** Optional smoke upgrade modifier (Countermeasure Rack). */
  readonly smokeModifier?: SmokeModifier;
  update(dt: number, u: ShoulderUpdateContext): void;
  idleUpdate(dt: number): void;
  fillRow(row: GunnerWeapon, keyLabel: string, cycleKeyLabel: string, online: boolean): void;
  silence?(): void;
  reset(): void;
}

export interface ShoulderPlugin {
  readonly kind: ShoulderKind;
  readonly newsKinds?: readonly MechKind[];
  create(ctx: Ctx): FrameShoulderWeapon;
  /** Co-op playback on teammates' screens when a `MechKind` note in `newsKinds` arrives. */
  remoteNews?(ctx: Ctx, kind: MechKind, values: number[]): void;
}
