/** Countermeasure Rack shoulder model — Phase 0 placeholder (Lane H replaces). */
import * as THREE from 'three';
import type { ModelBuilder } from '../../progression/modelkit';
import { ACROSS, AMBER, BRASS, DARK, GUNMETAL, OBSIDIAN, PLATE, STEEL, prism } from './shared';

export function buildFlareRack(b: ModelBuilder): void {
  b.cyl(0.12, 0.14, 0.44, 10, STEEL, { at: [0, -0.42, 0.05] });
  b.solid(prism([[-0.54, -0.28], [0.54, -0.28], [0.6, -0.1], [0.52, 0.28], [-0.5, 0.28], [-0.58, 0.08]], 1.02, 0.04), OBSIDIAN, { rot: ACROSS });
  b.solid(prism([[-0.42, 0.22], [0.42, 0.22], [0.34, 0.36], [-0.34, 0.36]], 0.9, 0.03), PLATE, { rot: ACROSS });
  for (let i = 0; i < 6; i++) {
    const x = ((i % 3) - 1) * 0.28;
    const z = i < 3 ? -0.26 : 0.22;
    b.cyl(0.08, 0.09, 0.42, 8, GUNMETAL, { at: [x, 0.34, z], rot: [-0.35, 0, x * 0.4] });
    b.cyl(0.075, 0.075, 0.05, 8, BRASS, { at: [x, 0.5, z - 0.06], rot: [-0.35, 0, x * 0.4] });
    b.cyl(0.055, 0.055, 0.04, 8, DARK, { at: [x, 0.54, z - 0.08], rot: [-0.35, 0, x * 0.4] });
  }
  b.glow(new THREE.BoxGeometry(0.76, 0.04, 0.04), AMBER, 4.0, { at: [0, 0.14, -0.58] });
}
