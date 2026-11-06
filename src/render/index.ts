import { Renderer } from './Renderer';
import type { RenderSystem } from '../core/contracts';

export { Renderer };
export type { QualityPreset } from './quality';

/** Builds the renderer, shaders, procedural materials and sky. Resolves when the first frame can be drawn. */
export async function createRenderSystem(canvas: HTMLCanvasElement): Promise<RenderSystem> {
  const renderer = new Renderer(canvas);
  await renderer.ready();
  return renderer;
}
