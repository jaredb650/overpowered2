/** Public entry to the player, its camera and the movement tuning table. */
import type { Ctx } from '../core/contracts';
import { CameraRigSystem } from './CameraRig';
import { Player } from './Player';

export { MOVE, VIEW, FEEDBACK } from './tuning';
export { CameraRigSystem } from './CameraRig';
export { Player } from './Player';

export function createPlayer(ctx: Ctx): Player {
  return new Player(ctx);
}

export function createCameraRig(ctx: Ctx): CameraRigSystem {
  return new CameraRigSystem(ctx);
}
