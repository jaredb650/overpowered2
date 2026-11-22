/** Guided Heavy Missile shoulder model — Phase 0 placeholder (Lane F replaces). */
import * as THREE from 'three';
import type { ModelBuilder } from '../../progression/modelkit';
import { ACROSS, ALONG_Z, AMBER, BRASS, GUNMETAL, OBSIDIAN, PLATE, RED, STEEL, prism } from './shared';

export function buildWireBomb(b: ModelBuilder): void {
  b.cyl(0.14, 0.16, 0.52, 10, STEEL, { at: [0, -0.46, 0.05] });
  b.solid(prism([[-0.82, -0.38], [0.82, -0.38], [0.92, -0.18], [0.92, 0.24], [0.7, 0.42], [-0.74, 0.42], [-0.88, 0.18]], 0.92, 0.05), OBSIDIAN, { rot: ACROSS });
  b.cyl(0.32, 0.32, 1.55, 14, GUNMETAL, { at: [0, 0.04, -0.25], rot: ALONG_Z });
  b.cyl(0.08, 0.32, 0.52, 14, PLATE, { at: [0, 0.04, -1.26], rot: ALONG_Z });
  b.cyl(0.34, 0.34, 0.08, 14, BRASS, { at: [0, 0.04, -0.82], rot: ALONG_Z });
  b.glow(new THREE.BoxGeometry(0.12, 0.04, 0.65), RED, 4.4, { at: [0, 0.44, -0.15] });
  b.glow(new THREE.CylinderGeometry(0.06, 0.06, 0.04, 10), AMBER, 4.2, { at: [0, 0.04, -1.52], rot: ALONG_Z });
}
