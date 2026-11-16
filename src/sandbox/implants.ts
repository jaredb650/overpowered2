/**
 * The implants on the contractor, in the shop's studio (ui/backdrop/bodystage.ts), without a run or the shop over it.
 *
 *   /?sandbox=implants                         the default loadout, turning
 *   &fit=hellfire,butcher,skyfall              what he wears
 *   &preview=berserk                           the row in focus: put on him, and the camera on that part
 *   &yaw=<radians>                             held still at that turn
 *
 * window.__st is the stage.
 */
import { createRenderSystem, type Renderer } from '../render';
import { makeCtx, runLoop } from './harness';
import { createCharacterLibrary } from '../characters/index';
import { BodyStage } from '../ui/backdrop/bodystage';
import { DEFAULT_FITTED, isImplant, type ImplantId } from '../progression/implants';

export default async function implants(params: URLSearchParams): Promise<void> {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const render = (await createRenderSystem(canvas)) as Renderer;
  const ctx = makeCtx({ render });
  render.init(ctx);
  ctx.characters = createCharacterLibrary(ctx);
  const stage = new BodyStage(ctx);
  const list = (key: string): ImplantId[] => (params.get(key) ?? '').split(',').filter(isImplant);
  const fit = params.has('fit') ? list('fit') : [...DEFAULT_FITTED];
  const preview = list('preview')[0] ?? null;
  if (params.has('yaw')) stage.holdYaw = Number(params.get('yaw'));
  stage.show(fit, preview);
  stage.active = true;
  (window as unknown as { __st: BodyStage }).__st = stage;
  runLoop(ctx, () => {
    stage.update(ctx.time.realDt);
    render.render();
  }, () => ({ ready: stage.ready, calls: render.drawCalls(), triangles: render.triangles() }));
}
