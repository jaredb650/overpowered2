/**
 * Shoulder weapon plug-in registry. Wired once in Phase 0 so Phase 1 shoulder lanes (C, E, F, H) edit only their own files.
 */
import type { Ctx } from '../../core/contracts';
import type { MechKind } from '../../progression/callins/link';
import type { ShoulderKind } from '../loadout';
import { POD6_PLUGIN } from './pod6';
import { STORM_PLUGIN } from './storm';
import { MIRV_PLUGIN } from './mirv';
import { WIRE_PLUGIN } from './wire';
import { MORTAR_PLUGIN } from './mortar';
import { FPV_PLUGIN } from './fpv';
import { POINTDEF_PLUGIN } from './pointdef';
import { FLARES_PLUGIN } from './flares';
import type { ShoulderPlugin } from './types';

export const SHOULDER_REGISTRY: Readonly<Record<ShoulderKind, ShoulderPlugin>> = {
  pod6: POD6_PLUGIN,
  storm: STORM_PLUGIN,
  mirv: MIRV_PLUGIN,
  wire: WIRE_PLUGIN,
  mortar: MORTAR_PLUGIN,
  fpv: FPV_PLUGIN,
  pointdef: POINTDEF_PLUGIN,
  flares: FLARES_PLUGIN,
};

/** Dispatches a remote co-op `MechKind` wire note to the matching shoulder plug-in, if any. Returns true if handled. */
export function dispatchShoulderRemoteNews(ctx: Ctx, kind: MechKind, values: number[]): boolean {
  for (const plugin of Object.values(SHOULDER_REGISTRY)) {
    if (plugin.newsKinds?.includes(kind)) {
      plugin.remoteNews?.(ctx, kind, values);
      return true;
    }
  }
  return false;
}
