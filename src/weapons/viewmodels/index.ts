/** First-person arms and weapons. See docs/notes/viewmodels.md. */
import type { Ctx } from '../../core/contracts';
import type { ViewmodelRig } from '../../core/gameplay';
import { Rig } from './rig';

export function createViewmodels(_ctx: Ctx): ViewmodelRig {
  return new Rig();
}
