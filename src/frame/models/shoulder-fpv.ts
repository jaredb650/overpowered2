/** FPV Drone Hive shoulder model — Phase 0 placeholder (Lane H replaces). */
import * as THREE from 'three';
import type { ModelBuilder } from '../../progression/modelkit';
import { ACROSS, AMBER, DARK, GUNMETAL, OBSIDIAN, PLATE, RED, STEEL, prism } from './shared';

export function buildFpvHive(b: ModelBuilder): void {
  b.cyl(0.12, 0.14, 0.48, 10, STEEL, { at: [0, -0.44, 0.05] });
  b.solid(prism([[-0.62, -0.34], [0.66, -0.34], [0.74, -0.14], [0.68, 0.36], [-0.58, 0.36], [-0.68, 0.14]], 1.18, 0.045), OBSIDIAN, { rot: ACROSS });
  b.solid(prism([[-0.5, 0.32], [0.54, 0.32], [0.42, 0.46], [-0.42, 0.46]], 1.06, 0.03), PLATE, { rot: ACROSS });
  // Four launch bay cells.
  for (const x of [-0.28, 0.28]) {
    for (const y of [-0.12, 0.14]) {
      b.box(0.42, 0.18, 0.1, DARK, { at: [x, y, -0.68] });
      b.box(0.36, 0.06, 0.12, GUNMETAL, { at: [x, y, -0.7] });
    }
  }
  b.glow(new THREE.BoxGeometry(0.08, 0.04, 0.04), AMBER, 4.0, { at: [-0.28, 0.36, -0.64] });
  b.glow(new THREE.BoxGeometry(0.08, 0.04, 0.04), RED, 4.0, { at: [0.28, 0.36, -0.64] });
}
