/**
 * Core Expansion plug-in contract (`Q` key overdrive & passive safety nets under `src/frame/expansions/`).
 */
import type * as THREE from 'three';
import type { Ctx } from '../../core/contracts';
import type { MechKind } from '../../progression/callins/link';
import type { GunnerWeapon } from '../../vehicles/hud';
import type { ExpansionKind } from '../loadout';

/** Active visual state read by `StandIn` each frame to animate expansion domes, shields, and novas. */
export interface ExpansionVisualState {
  /** 0..1 intensity of an expanding Breacher Nova shock sphere. */
  novaProgress: number;
  /** 0..1 health/opacity of the mobile Aegis Barrier or Last-Stand Fuse shield around the mech. */
  aegisAlpha: number;
  /** True when Last-Stand Fuse (crimson overdrive) is active instead of standard Aegis. */
  terminalActive: boolean;
  /** Active stationary Bunker Dome position & 0..1 opacity (`null` when none deployed). */
  domePos: THREE.Vector3 | null;
  domeAlpha: number;
}

export interface ExpansionContext {
  readonly ctx: Ctx;
  readonly feet: THREE.Vector3;
  readonly torsoYaw: number;
  /** Trigger standard smoke screen (used by `expSmoke`). */
  readonly popSmoke: () => boolean;
  /** Clear any attached leg sapper charge (Breacher Nova & Aegis Barrier). */
  readonly clearSapper: () => boolean;
  /** Co-op wire notification. */
  readonly onNews: ((kind: MechKind, values: number[]) => void) | null;
}

export interface FrameExpansion {
  readonly kind: ExpansionKind;
  readonly visual: ExpansionVisualState;
  /** Attempt to trigger on `Q` press. Returns true if activated. */
  trigger(u: ExpansionContext): boolean;
  /** Tick timers, active domes, shields, and cooldowns. */
  update(dt: number, u: ExpansionContext): void;
  /** Tick passive cooldowns while parked empty. */
  idleUpdate(dt: number): void;
  /** Intercept incoming hull damage (e.g. Aegis Barrier, Bunker Dome, or Last-Stand Fuse at 0 HP). Returns remaining damage. */
  absorbDamage?(damage: number, currentHp: number, from: THREE.Vector3 | undefined, u: ExpansionContext): number;
  /** Fill the `Q` HUD row. */
  fillRow(row: GunnerWeapon): void;
  reset(): void;
}

export interface ExpansionPlugin {
  readonly kind: ExpansionKind;
  create(ctx: Ctx): FrameExpansion;
  /** Co-op visual playback on teammates' screens when an `expansion` wire note arrives. */
  remoteNews?(ctx: Ctx, values: number[]): void;
}
