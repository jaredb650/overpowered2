/**
 * Head / Sensor Crown visual builder registry (`src/frame/models/heads/`).
 * Routes all 6 `HeadKind` variants (`standard`, `duelist`, `cyclops`, `stealth`, `bunker`, `halo`) to their
 * palette-aware bevelled procedural builders with subtle aim/idle pose animations.
 */
import * as THREE from 'three';
import { clamp } from '../../../core/math';
import type { ModelMaterials } from '../../../progression/modelkit';
import type { HeadKind } from '../../loadout';
import {
  ACROSS, AMBER, FLAT, GUNMETAL, OBSIDIAN, PLATE, STEEL,
  frameBuilder, ngon, prism,
  type FramePalette, type HeadVisual,
} from '../shared';
import { buildBunkerHead } from './bunker';
import { buildCyclopsHead } from './cyclops';
import { buildDuelistHead } from './duelist';
import { buildHaloHead } from './halo';
import { buildStealthHead } from './stealth';

/** Subtle low-profile Bureau flush sensor periscope & telemetry fin for `'standard'`. */
function buildStandardHead(materials: ModelMaterials, palette?: FramePalette): HeadVisual {
  const b = frameBuilder(palette);
  b.solid(prism(ngon(0.28, 8, Math.PI / 8), 0.1, 0.018), GUNMETAL, { at: [0, 0.05, 0], rot: FLAT });
  b.solid(prism([
    [-0.26, 0.06], [0.28, 0.06], [0.22, 0.22], [-0.24, 0.24],
  ], 0.34, 0.022), OBSIDIAN, { rot: ACROSS });
  b.solid(prism([
    [-0.22, 0.2], [0.16, 0.2], [0.06, 0.38], [-0.24, 0.36],
  ], 0.08, 0.012), PLATE, { rot: ACROSS });
  b.cyl(0.018, 0.025, 0.32, 8, STEEL, { at: [-0.14, 0.34, 0.14], rot: [-0.14, 0, 0] });
  b.glow(new THREE.BoxGeometry(0.18, 0.032, 0.028), AMBER, 3.4, { at: [0, 0.15, -0.29] });

  const pivot = materials.group(b);
  pivot.name = 'head.standard.pivot';
  const group = new THREE.Group();
  group.name = 'head.standard';
  group.add(pivot);

  let smoothPitch = 0;
  return {
    group,
    pose(_aimYawDelta: number, aimPitch: number, dt: number, standby: boolean) {
      const target = standby ? 0 : clamp(aimPitch * 0.2, -0.15, 0.15);
      smoothPitch += (target - smoothPitch) * Math.min(1, dt * 6);
      pivot.rotation.x = smoothPitch;
    },
  };
}

export function buildHeadVisual(
  head: HeadKind,
  materials: ModelMaterials,
  palette?: FramePalette,
): HeadVisual | null {
  switch (head) {
    case 'standard': return buildStandardHead(materials, palette);
    case 'duelist': return buildDuelistHead(materials, palette);
    case 'cyclops': return buildCyclopsHead(materials, palette);
    case 'stealth': return buildStealthHead(materials, palette);
    case 'bunker': return buildBunkerHead(materials, palette);
    case 'halo': return buildHaloHead(materials, palette);
    default:
      return null;
  }
}
