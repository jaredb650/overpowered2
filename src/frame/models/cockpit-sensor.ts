/**
 * Sensor Cockpit model — Phase 0 placeholder (Lane K replaces with multi-optic sensor dome & interior HUD bezel).
 * Returns `null` in Phase 0 so `StandIn` uses the standard cockpit until Lane K lands its model.
 */
import type { ModelMaterials } from '../../progression/modelkit';
import type { CockpitVisual } from './shared';

export function buildSensorCockpit(_materials: ModelMaterials): CockpitVisual | null {
  return null;
}
