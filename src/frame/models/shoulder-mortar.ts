/** Mortar Rack shoulder model — Phase 0 placeholder (Lane C replaces). */
import * as THREE from 'three';
import type { ModelBuilder } from '../../progression/modelkit';
import { ACROSS, AMBER, DARK, GUNMETAL, OBSIDIAN, PLATE, STEEL, prism } from './shared';

export function buildMortarRack(b: ModelBuilder): void {
  b.cyl(0.13, 0.15, 0.5, 10, STEEL, { at: [0, -0.46, 0.06] });
  b.solid(prism([[-0.66, -0.36], [0.62, -0.36], [0.7, -0.16], [0.62, 0.34], [-0.6, 0.34], [-0.7, 0.12]], 1.12, 0.05), OBSIDIAN, { rot: ACROSS });
  // Three angled mortar tubes pitched up at 55°.
  for (const x of [-0.32, 0, 0.32]) {
    b.cyl(0.12, 0.13, 0.92, 10, GUNMETAL, { at: [x, 0.44, -0.12], rot: [-0.55, 0, 0] });
    b.cyl(0.13, 0.13, 0.08, 10, PLATE, { at: [x, 0.78, -0.34], rot: [-0.55, 0, 0] });
    b.cyl(0.09, 0.09, 0.06, 10, DARK, { at: [x, 0.84, -0.38], rot: [-0.55, 0, 0] });
  }
  b.glow(new THREE.BoxGeometry(0.92, 0.04, 0.04), AMBER, 3.8, { at: [0, 0.24, -0.66] });
}
