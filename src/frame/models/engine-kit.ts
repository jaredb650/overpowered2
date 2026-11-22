/**
 * Engine exterior attachment visuals (Jump-Jet thrusters, Rotor blades, Afterburner folding wings, Overcharge vents,
 * Long-Haul diesel stacks). Phase 0 returns `null` for all drives; Lane J replaces this file with the full animated visuals.
 */
import type { ModelMaterials } from '../../progression/modelkit';
import type { DriveKind } from '../loadout';
import type { EngineVisual } from './shared';

export function buildEngineVisual(_drive: DriveKind, _materials: ModelMaterials): EngineVisual | null {
  return null;
}
