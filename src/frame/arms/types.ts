/**
 * Arm weapon plug-in contract for the Distraint Frame (`src/frame/arms/`).
 * Phase 1 arm lanes (A: vulcan30, B: beam, C: cluster, D: shotgun) implement `ArmPlugin` in their own file without
 * editing `weapons.ts`, `seat.ts`, `puppet.ts`, or `arms/registry.ts`.
 */
import type * as THREE from 'three';
import type { Ctx } from '../../core/contracts';
import type { Round40 } from '../../progression/callins/ac130Guns';
import type { Ac130Rounds } from '../../progression/callins/ac130Rounds';
import type { MechKind } from '../../progression/callins/link';
import type { GunnerWeapon } from '../../vehicles/hud';
import type { GunnerSeat } from '../../vehicles/seat';
import type { ArmKind, ArmSide } from '../loadout';

/** The physical arm gun model interface, placed by the Frame each frame. */
export interface Arm {
  muzzle(out: THREE.Vector3): THREE.Vector3;
  bore(out: THREE.Vector3): THREE.Vector3;
  turn(radians: number): void;
  recoil(metres: number): void;
}

/** Where the Frame aims from and at: the seat, as it has it this frame. */
export type Sight = Pick<GunnerSeat, 'view' | 'aim' | 'point' | 'range'>;

/** Context handed to an arm weapon each frame while piloted. */
export interface ArmUpdateContext {
  readonly ctx: Ctx;
  readonly rounds: Ac130Rounds;
  readonly arm: Arm;
  readonly side: ArmSide;
  /** Mouse button label: `'LMB'` (left) or `'RMB'` (right). */
  readonly button: string;
  /** Cycle key label: `'1'` (left) or `'2'` (right). */
  readonly cycleKey: string;
  readonly sight: Sight;
  readonly held: boolean;
  readonly pressed: boolean;
  /** True on the frame the pilot tapped `1` (left arm) or `2` (right arm) to cycle ammo/mode. */
  readonly cyclePressed: boolean;
  /** True on the frame the pilot tapped `R` for manual reload (never cycles ammo). */
  readonly reloadPressed: boolean;
  /** View recoil kick multiplier (`0` on Spider Legs `noRecoil`, `1` otherwise). */
  readonly recoilMult: number;
  /** Co-op shell note callback for 40 mm / 105 mm arcs. */
  readonly onShell: ((round: Round40 | 'g105', from: THREE.Vector3, aim: THREE.Vector3, seconds: number, side: ArmSide) => void) | null;
  /** Co-op mech news callback for new arm weapons (`vulcan30`, `beam`, `cluster`, `shotgun`). */
  readonly onNews: ((kind: MechKind, values: number[]) => void) | null;
}

/** Per-mount runtime instance of an arm weapon. */
export interface FrameArmGun {
  readonly kind: ArmKind;
  /** True while actively spinning/firing (sent in the co-op pose firing bitmask). */
  readonly firing: boolean;
  /** Optional 0..1 heat/charge meter for the crosshair bar. */
  readonly heat?: number;
  /** Optional walk-speed multiplier while charging/firing (e.g. Red Beam returns 0.6 while charging). */
  readonly walkSpeedMult?: number;
  /** Step this arm while piloted. */
  update(dt: number, u: ArmUpdateContext): void;
  /** Passive cooling / reloading while parked empty on the map. */
  idleUpdate(dt: number): void;
  /** Fill this arm's HUD row. */
  fillRow(row: GunnerWeapon, button: string, cycleKey: string): void;
  /** Stop any looping sounds immediately (exit seat, swap arm, reset). */
  silence(): void;
  /** Reset ammo/heat/charge clocks to full/ready. */
  reset(): void;
}

/** Per-side scratch state for remote co-op continuous firing playback on `FramePuppet`. */
export interface ArmRemoteState {
  accum: number;
  fired: number;
}

export interface ArmPlugin {
  readonly kind: ArmKind;
  /** Optional `MechKind` wire notes routed to `remoteNews` on teammates' screens. */
  readonly newsKinds?: readonly MechKind[];
  create(ctx: Ctx): FrameArmGun;
  /** Called every frame on `FramePuppet` while the remote pilot's pose bit says this arm is firing. */
  remoteFiring?(ctx: Ctx, arm: Arm, side: ArmSide, dt: number, state: ArmRemoteState): void;
  /** Called on `FramePuppet` when a `MechKind` wire note in `newsKinds` arrives from another player. */
  remoteNews?(ctx: Ctx, kind: MechKind, values: number[]): void;
}
