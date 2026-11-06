/** Enemies, AI, waves and bosses. Game.ts finds these factories by convention. */
import type { Ctx } from '../core/contracts';
import type { EnemySystem, WaveSystem } from '../core/gameplay';
import { EnemyManager } from './EnemyManager';
import { Waves } from './waves';

export function createEnemies(ctx: Ctx): EnemySystem {
  return new EnemyManager(ctx);
}

export function createWaves(_ctx: Ctx): WaveSystem {
  return new Waves();
}
