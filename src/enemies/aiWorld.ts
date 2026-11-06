/** Everything an AI routine can read in one place, refreshed once per frame by the enemy system. */
import * as THREE from 'three';
import type { Ctx } from '../core/contracts';
import type { Director } from './director';
import type { Telegraphs } from './telegraph';
import type { EnemyManager } from './EnemyManager';

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
  /** Earliest time a body may bump the player again. */
  nudgeAt = 0;
}

export interface AiWorld {
  readonly ctx: Ctx;
  readonly director: Director;
  readonly telegraphs: Telegraphs;
  readonly enemies: EnemyManager;
  readonly player: PlayerSense;
  /** ctx.time.elapsed, world clock. */
  now: number;
}
