/**
 * Shared TypeScript contracts between the Desert Raid director (`src/campaign/desertRaid.ts`)
 * and its four modular runtime subsystems (`convoy.ts`, `airAndSquads.ts`, `setpieces.ts`, `saltbloods.ts`).
 */
import type * as THREE from 'three';

export type QuistOutcome = 'captured' | 'killed' | 'grenade_survived' | 'grenade_killed' | 'suicide';

export interface ConvoyController {
  /** Build or reset the 3-truck ally-driven convoy and place at Approach start. */
  startApproach(): void;
  /** Transition the convoy into the slow Section 2 broadside shooting-gallery loop along the Wall. */
  startWallLoop(): void;
  /** Halt convoy at the breached Main Gate and dismount the player on foot into the Warren. */
  dismountAtGate(): void;
  /** Drive convoy trucks through the rubble into the Plane forecourt for exfil pickup. */
  arriveForExfil(quistCaptured: boolean): void;
  /** Begin high-speed desert exfil chase with pursuing bandit bikes & trucks. */
  startExfilChase(quistCaptured: boolean): void;
  /** Unmount turret HUD and lock convoy into smooth scenic highway cruise for the ending cutscene. */
  enterEndingCruise?(): void;
  /** Returns the world position of cuffed Quist seated in the open middle truck bed. */
  getQuistBedPosition?(out: THREE.Vector3): THREE.Vector3;
  /** Toggle whether cuffed Quist is visibly seated in the middle truck bed. */
  setQuistCaptured?(captured: boolean): void;
  /** Dispatch a Saltblood reinforcement pickup truck out of the west or east side gate. */
  spawnSideGateTruck(side: 'west' | 'east'): void;
  /** Spawn a wave of desert bandit bikes/trucks during Approach or Exfil. */
  spawnBanditWave(phase: 'approach' | 'exfil', count: number): void;
  /** Returns true while the player is mounted on the middle truck's heavy gun. */
  isPlayerBoarded(): boolean;
  /** Current world position of the player's middle convoy truck. */
  getTruckPosition(out: THREE.Vector3): THREE.Vector3;
  /** Current world yaw of the player's middle convoy truck. */
  getTruckYaw(): number;
  /** Number of enemy bandit vehicles destroyed this run. */
  readonly banditVehiclesDestroyed: number;
  update(dt: number): void;
  clear(): void;
  reset(): void;
}

export interface AirAndSquadsController {
  /** Launch the two escort gunships flying low overhead with the convoy. */
  startEscort(): void;
  /** Execute the scripted Section 2 Warthog A-10 gate breach (short camera cut + gate destruction). */
  strikeMainGate(onBreached: () => void): void;
  /** Hover gunships over the breached gate and drop friendly assault squads into the Warren. */
  dropWarrenSquads(): void;
  /** Advance friendly assault squads northward into the Warren / Pump Yard / High Terraces / Salt Cave. */
  advanceSquads(stage: 'warren' | 'pumpyard' | 'terraces' | 'cave'): void;
  /** Run the scenic town-flattening ending cutscene behind the retreating convoy. */
  startEndingCutscene(
    getConvoyPos: (out: THREE.Vector3) => THREE.Vector3,
    quistCaptured: boolean,
    onDone: () => void,
    getQuistBedPos?: (out: THREE.Vector3) => THREE.Vector3,
    getTruckYaw?: () => number,
  ): void;
  /** Number of living friendly raid soldiers currently on the ground. */
  readonly aliveFriendlies: number;
  update(dt: number): void;
  clear(): void;
  reset(): void;
}

export interface QuistHooks {
  /** Fired whenever Quist speaks a line during the chase or cornered speech. */
  onLine(key: string, opts?: { now?: boolean }): void;
  /** Fired once Quist's fate is decided by the player's action or timer. */
  onOutcome(outcome: QuistOutcome): void;
  /** Fired when Quist slams a bulkhead door behind him during the plane chase. */
  onDoorSlam(doorId: 'plane.door1' | 'plane.door2'): void;
  /** Fired if cuffed Quist is killed or crushed by falling debris while being escorted to the exfil truck. */
  onEscortLost?: (reason: 'crushed' | 'shot') => void;
}

export interface SetpiecesController {
  /** Build loudspeaker poles, bulldozer gate visual/blocker, water tower, sewer lights & triggers. */
  ensureBuilt(): void;
  /** Visually pulse the nearest loudspeaker pole when Quist talks over PA. */
  pulseLoudspeaker(): void;
  /** Shatter and remove the solid Bulldozer Main Gate (invoked by Warthog strike). */
  shatterMainGate(): void;
  /** Arm the Pump Yard water tower collapse trigger. */
  armWaterTower(): void;
  /** Execute the dramatic Water Tower collapse + flood knockback + street rubble block. */
  triggerWaterTowerDrop(): void;
  /** Deactivate the Pump Yard sewer grate drop beacon once the player advances past the sewer. */
  clearSewerBeacon?(): void;
  /** Spawn Hadrek Quist inside the Cargo Plane for the chase & 5-outcome speech. */
  startPlaneChase(hooks: QuistHooks): void;
  /** Advance Quist from mid-hull to tail cornered state when player reaches the aft bulkhead. */
  advanceQuistToTail(): void;
  /** Hide/retire the walking cuffed Quist NPC when player + Quist board the exfil truck. */
  boardCapturedQuistToConvoy?(): void;
  /** Whether the escorted cuffed Quist NPC is currently alive. */
  readonly quistEscortAlive?: boolean;
  /** Current final outcome of Hadrek Quist (null until resolved). */
  readonly quistOutcome: QuistOutcome | null;
  /** Whether the main gate has been breached by the Warthog. */
  readonly gateBreached: boolean;
  /** Whether the Pump Yard water tower has collapsed. */
  readonly towerDropped: boolean;
  update(dt: number): void;
  clear(): void;
  reset(): void;
}
