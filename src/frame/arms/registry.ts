/**
 * Arm weapon plug-in registry. Wired once in Phase 0 so Phase 1 arm lanes (A, B, C, D) edit only their own files.
 */
import type { Ctx } from '../../core/contracts';
import type { MechKind } from '../../progression/callins/link';
import type { ArmKind } from '../loadout';
import { ROTARY_PLUGIN } from './rotary';
import { CANNON40_PLUGIN } from './cannon40';
import { HOWITZER105_PLUGIN } from './howitzer105';
import { VULCAN30_PLUGIN } from './vulcan30';
import { BEAM_PLUGIN } from './beam';
import { CLUSTER_PLUGIN } from './cluster';
import { SHOTGUN_PLUGIN } from './shotgun';
import type { ArmPlugin } from './types';

export const ARM_REGISTRY: Readonly<Record<ArmKind, ArmPlugin>> = {
  rotary: ROTARY_PLUGIN,
  cannon40: CANNON40_PLUGIN,
  howitzer105: HOWITZER105_PLUGIN,
  vulcan30: VULCAN30_PLUGIN,
  beam: BEAM_PLUGIN,
  cluster: CLUSTER_PLUGIN,
  shotgun: SHOTGUN_PLUGIN,
};

/** Dispatches a remote co-op `MechKind` wire note to the matching arm plug-in, if any. Returns true if handled. */
export function dispatchArmRemoteNews(ctx: Ctx, kind: MechKind, values: number[]): boolean {
  for (const plugin of Object.values(ARM_REGISTRY)) {
    if (plugin.newsKinds?.includes(kind)) {
      plugin.remoteNews?.(ctx, kind, values);
      return true;
    }
  }
  return false;
}
