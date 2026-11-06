/** Enemies, AI, waves and bosses. Game.ts finds these factories by convention. */
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
  const outpost = (ctx.enemies as EnemyManager).outpost;
  return ACTIVE.def.waves === 'squads' && outpost ? outpost.waves : new Waves();
}
