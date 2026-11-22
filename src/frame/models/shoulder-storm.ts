/** Metal Storm Pod shoulder model — Phase 0 placeholder (Lane E replaces). */
import * as THREE from 'three';
import type { ModelBuilder } from '../../progression/modelkit';
import { ACROSS, ALONG_Z, AMBER, DARK, GUNMETAL, OBSIDIAN, PLATE, STEEL, prism } from './shared';

export function buildStormPod(b: ModelBuilder): void {
  b.cyl(0.12, 0.14, 0.52, 10, STEEL, { at: [0, -0.48, 0.06] });
  b.solid(prism([[-0.64, -0.36], [0.76, -0.36], [0.84, -0.2], [0.84, 0.24], [0.62, 0.4], [-0.58, 0.4], [-0.7, 0.2]], 1.06, 0.04), OBSIDIAN, { rot: ACROSS });
  b.solid(prism([[-0.5, 0.34], [0.6, 0.34], [0.46, 0.48], [-0.42, 0.48]], 0.96, 0.03), PLATE, { rot: ACROSS });
  b.box(0.94, 0.56, 0.1, DARK, { at: [0, 0, -0.82] });
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 4; col++) {
      b.cyl(0.055, 0.055, 0.22, 8, GUNMETAL, { at: [(col - 1.5) * 0.21, (row - 1) * 0.17, -0.88], rot: ALONG_Z });
    }
  }
  b.glow(new THREE.BoxGeometry(0.86, 0.04, 0.04), AMBER, 4.0, { at: [0, 0.34, -0.74] });
}
