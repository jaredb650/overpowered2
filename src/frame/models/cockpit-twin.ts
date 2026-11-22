/**
 * Twin-Mount Cockpit model — Phase 0 placeholder (Lane K replaces with twin-mount reinforced brow & glass).
 * Returns `null` in Phase 0 so `StandIn` uses the standard cockpit until Lane K lands its model.
 */
import type { ModelMaterials } from '../../progression/modelkit';
import type { CockpitVisual } from './shared';

export function buildTwinCockpit(_materials: ModelMaterials): CockpitVisual | null {
  return null;
}
