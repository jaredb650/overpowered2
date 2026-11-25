/**
 * Chassis / Core silhouette builder registry (`src/frame/models/chassis/`).
 * Routes every custom chassis (`cockpitTwin`, `cockpitOpen`, `cockpitSensor`, `chassisKestrel`, `chassisBastion`,
 * `chassisValkyrie`, `chassisChitin`) to its procedural builder with full `FramePalette` livery support.
 */
import type { ModelMaterials } from '../../../progression/modelkit';
import type { FramePartId } from '../../loadout';
import { buildOpenCockpit } from '../cockpit-open';
import { buildSensorCockpit } from '../cockpit-sensor';
import { buildTwinCockpit } from '../cockpit-twin';
import type { CockpitVisual, FramePalette } from '../shared';
import { buildBastionChassis } from './bastion';
import { buildChitinChassis } from './chitin';
import { buildKestrelChassis } from './kestrel';
import { buildValkyrieChassis } from './valkyrie';

export function buildChassisVisual(
  id: FramePartId,
  materials: ModelMaterials,
  palette?: FramePalette,
): CockpitVisual | null {
  switch (id) {
    case 'cockpitStandard': return null;
    case 'cockpitTwin': return buildTwinCockpit(materials, palette);
    case 'cockpitOpen': return buildOpenCockpit(materials, palette);
    case 'cockpitSensor': return buildSensorCockpit(materials, palette);
    case 'chassisKestrel': return buildKestrelChassis(materials, palette);
    case 'chassisBastion': return buildBastionChassis(materials, palette);
    case 'chassisValkyrie': return buildValkyrieChassis(materials, palette);
    case 'chassisChitin': return buildChitinChassis(materials, palette);
    default:
      return null;
  }
}
