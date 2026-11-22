/**
 * Gait plug-in interface for the Distraint Frame's legs (`src/frame/move/gait/`).
 * Lane I implements `sprinter.ts`, `heavy.ts`, `treads.ts`, and `spider.ts` without editing `controller.ts` or `seat.ts`.
 */
import type * as THREE from 'three';
import type { GaitKind } from '../../loadout';
import type { WalkerIntent, WalkerSaid } from '../../controller';

/** Mutable kinematic state exposed by `Walker` to gait and drive plug-ins. */
export interface MoveState {
  readonly feet: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  legYaw: number;
  viewYaw: number;
  grounded: boolean;
  fuel: number;
  maxFuel: number;
  jetting: boolean;
  flying: boolean;
  hovering: boolean;
  jetMode: boolean;
  armsLockedForward: boolean;
  charges: number;
  maxCharges: number;
  chargeIn: number;
  charging: number;
  stomping: boolean;
  recover: number;
  stride: number;
  boost: number;
  stompTop: number;
  onGround: number;
  readonly chargeDir: THREE.Vector3;
  readonly said: WalkerSaid;
  readonly speedScale: number;
  readonly jumpScale: number;
  readonly dashScale: number;
  readonly strafeScale: number;
  readonly turnScale: number;
  readonly fuelScale: number;
  readonly free: boolean;
  clearance(): number;
  wish(intent: WalkerIntent, out: THREE.Vector3): THREE.Vector3;
}

export interface GaitPlugin {
  readonly kind: GaitKind;
  /** Capsule step-over height in metres (default `FRAME.body.step` = 1.1; Spider Legs = 2.2). */
  readonly stepHeight: number;
  /** Minimum walkable surface normal Y (default `FRAME.body.minWalkY`; Spider Legs = cos(45°) ≈ 0.707). */
  readonly minWalkY: number;
  /** True if landing/crouch stomp triggers a 360° leg sweep instead of a slam (Spider Legs). */
  readonly legSweepOnStomp?: boolean;
  /** True if stride surge is suppressed (Treads). */
  readonly noSurge?: boolean;
  /** Optional custom turning step. Return true to replace standard walker turn. */
  turn?(s: MoveState, h: number, intent: WalkerIntent): boolean;
  /** Optional custom ground/slope walking step. Return true to replace standard walker walk. */
  walk?(s: MoveState, h: number, intent: WalkerIntent, groundNormalY: number): boolean;
  /** Optional stomp trigger override (e.g. Treads cannot stomp; Spider sweeps). Return true if handled. */
  startStomp?(s: MoveState, intent: WalkerIntent): boolean;
  /** Reset any internal gait state on `Walker.place`. */
  reset?(): void;
}
