/** Point Defence active protection turret model — Phase 0 placeholder (Lane H replaces). */
import * as THREE from 'three';
import type { ModelBuilder } from '../../progression/modelkit';
import { ALONG_Z, AMBER, GUNMETAL, IRON, OBSIDIAN, PLATE, RED, STEEL } from './shared';

export function buildPointDef(b: ModelBuilder): void {
  b.cyl(0.28, 0.34, 0.34, 12, IRON, { at: [0, -0.28, 0] });
  b.cyl(0.38, 0.42, 0.38, 12, OBSIDIAN, { at: [0, 0.06, 0] });
  b.cyl(0.26, 0.36, 0.22, 12, PLATE, { at: [0, 0.34, 0] });
  // Radar panel + twin short intercept barrels.
  b.box(0.48, 0.32, 0.08, GUNMETAL, { at: [0, 0.52, 0.14], rot: [-0.25, 0, 0] });
  for (const x of [-0.14, 0.14]) b.cyl(0.045, 0.045, 0.56, 8, STEEL, { at: [x, 0.14, -0.44], rot: ALONG_Z });
  b.glow(new THREE.BoxGeometry(0.38, 0.04, 0.04), RED, 4.4, { at: [0, 0.52, 0.09] });
  b.glow(new THREE.BoxGeometry(0.18, 0.04, 0.04), AMBER, 3.8, { at: [0, 0.24, -0.34] });
}
