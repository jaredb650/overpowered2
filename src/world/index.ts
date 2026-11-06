import type { Ctx, WorldSystem } from '../core/contracts';
import { World } from './World';

export function createWorld(ctx: Ctx): WorldSystem {
  return new World(ctx);
}

export type { World } from './World';
