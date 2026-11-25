/** Everything an AI routine can read in one place, refreshed once per frame by the enemy system. */
import * as THREE from 'three';
import type { Ctx } from '../core/contracts';
import type { Director } from './director';
import type { Telegraphs } from './telegraph';
import type { EnemyManager } from './EnemyManager';

import type { DriveVehicleId } from '../vehicles/drive/types';

/** Tactical vehicle/mount class read by AI planners, weapon targeting, and dynamic chatter. */
export type PlayerMount = 'foot' | 'frame' | 'light' | 'armor' | 'chopper' | 'jet';

/** Player vehicle ordnance / maneuver kinds that ground squads and enemy pilots react to. */
export type OrdnanceEventKind =
  | 'napalm'
  | 'bomb'
  | 'cluster'
  | 'chute'
  | 'thermobaric'
  | 'moab'
  | 'dump_burn'
  | 'gau8'
  | 'cannon'
  | 'mortar'
  | 'rocket'
  | 'missile'
  | 'lance'
  | 'cobra'
  | 'flares'
  | 'bunker'
  | 'stomp';

export type CcipKind = 'he' | 'napalm' | 'cluster' | 'chute' | 'thermobaric' | 'moab';

/** Maps a driveable vehicle id to its tactical mount class. */
export function mountOfVehicle(id: DriveVehicleId): PlayerMount {
  switch (id) {
    case 'aegis':
    case 'bastion':
      return 'armor';
    case 'kestrel':
    case 'valkyrie':
      return 'chopper';
    case 'harrier':
    case 'warthog':
    case 'raptor':
    case 'hornet':
    case 'lancer':
      return 'jet';
    default:
      return 'light';
  }
}

/** A snapshot of the player, so AI code never reaches into the player system mid-frame. */
export class PlayerSense {
  readonly position = new THREE.Vector3();
  readonly eye = new THREE.Vector3();
  /** What enemy guns aim at. */
  readonly chest = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  readonly forward = new THREE.Vector3();
  speed = 0;
  grounded = true;
  alive = true;
  /** 0 standing still to 1 at full speed. Everything that aims reads this: speed is armour. */
  evasion = 0;
  /** The Ghost powerup: past this range enemies cannot tell where the player is. */
  ghost = false;
  /** Current vehicle/Frame mount class. */
  mount: PlayerMount = 'foot';
  /** Specific driveable id or 'frame', or null on foot. */
  vehicleId: DriveVehicleId | 'frame' | null = null;
  /** Height above ground/nav surface in metres. */
  altitude = 0;
  /** True when flying in an aircraft or elevated > 5.5 m above the terrain. */
  airborne = false;
  /** True when inside heavy armor (Aegis MBT, Bastion guntruck, or Distraint Frame). */
  heavyArmor = false;
  /** True when piloting a low-observable stealth jet (F-22 Raptor). */
  stealth = false;
  /** True when inside a Bastion deployed in bunker mode. */
  deployedBunker = false;
  /** Live CCIP bomb impact point while the player is lining up an airstrike. */
  readonly ccipPos = new THREE.Vector3();
  ccipActive = false;
  ccipKind: CcipKind | null = null;
  /** Earliest time a body may bump the player again. */
  nudgeAt = 0;
  /** Player clock. Solid bodies let the player through until this time, after finding them wedged. */
  solidFreeAt = 0;
  /** Player clock: when the current spell deep inside a solid body began, and when it was last seen. */
  wedgeSince = 0;
  wedgeSeen = -1;
}

export interface AiWorld {
  readonly ctx: Ctx;
  readonly director: Director;
  readonly telegraphs: Telegraphs;
  readonly enemies: EnemyManager;
  readonly player: PlayerSense;
  /** ctx.time.elapsed, world clock. */
  now: number;
  /**
   * Co-op: this is a guest's copy of an attack (net/world/attacks.ts). It shows and sounds the attack and can hurt nothing:
   * `ctx.player` and `ctx.combat` are stand-ins. Code that decides an outcome (a wall hit, a blast) must not run under it.
   */
  readonly cosmetic?: boolean;
}

declare module '../core/contracts' {
  interface GameEvents {
    'vehicle:boarded': {
      id: DriveVehicleId | 'frame';
      mount: PlayerMount;
      hijacked: boolean;
      viaGrapple: boolean;
      position: THREE.Vector3;
    };
    'vehicle:ordnance': {
      vehicleId: DriveVehicleId | 'frame';
      kind: OrdnanceEventKind;
      origin: THREE.Vector3;
      target: THREE.Vector3 | null;
    };
    'vehicle:roadkill': {
      vehicleId: DriveVehicleId | 'frame';
      position: THREE.Vector3;
      speed: number;
    };
  }
}
