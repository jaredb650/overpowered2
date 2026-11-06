import type { AudioSystem, Ctx } from '../core/contracts';
import { AudioEngine } from './AudioEngine';

export { AudioEngine } from './AudioEngine';
export { CATALOG, ALIASES } from './catalog';

export function createAudio(ctx: Ctx): AudioSystem {
  return new AudioEngine(ctx);
}
