/** Enemies, AI, waves and bosses. Game.ts finds these factories by convention. */
import { MISSION_ID } from '../campaign/select';
import { MissionWaves } from '../campaign/waves';
import { DefenseDirector } from '../contracts/defense/director';
import { ACTIVE } from '../contracts/select';
import type { Ctx } from '../core/contracts';
import type { EnemySystem, WaveSystem } from '../core/gameplay';
import { EnemyManager } from './EnemyManager';
import { Waves } from './waves';

export function createEnemies(ctx: Ctx): EnemySystem {
  return new EnemyManager(ctx);
}

/** After `createEnemies`: the squads' loop lives on the controller that runs them. */
export function createWaves(ctx: Ctx): WaveSystem {
  if (MISSION_ID) return new MissionWaves();
  const manager = ctx.enemies as EnemyManager;
  const outpost = manager.outpost;
  // Outpost Defense on the fort runs its own director. Anywhere else (the Test Range stand-in) it borrows Endless Humans' waves.
  if (ACTIVE.def.economy && ACTIVE.map === 'fort' && outpost) return new DefenseDirector(ctx, outpost, manager);
  return ACTIVE.def.waves === 'squads' && outpost ? outpost.waves : new Waves();
}
