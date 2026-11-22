/** MIRV Launcher shoulder model — Phase 0 placeholder (Lane F replaces). */
import * as THREE from 'three';
import type { ModelBuilder } from '../../progression/modelkit';
import { ACROSS, AMBER, DARK, GUNMETAL, OBSIDIAN, PLATE, RED, STEEL, prism } from './shared';

export function buildMirv(b: ModelBuilder): void {
  b.cyl(0.14, 0.16, 0.5, 10, STEEL, { at: [0, -0.46, 0.05] });
  b.solid(prism([[-0.56, -0.44], [0.56, -0.44], [0.64, -0.22], [0.64, 0.56], [0.42, 0.72], [-0.46, 0.72], [-0.64, 0.44]], 1.08, 0.05), OBSIDIAN, { rot: ACROSS });
  b.solid(prism([[-0.44, 0.62], [0.44, 0.62], [0.36, 0.8], [-0.36, 0.8]], 0.96, 0.03), PLATE, { rot: ACROSS });
  b.cyl(0.32, 0.36, 0.35, 12, GUNMETAL, { at: [0, 0.82, 0] });
  b.cyl(0.24, 0.24, 0.14, 12, DARK, { at: [0, 0.98, 0] });
  b.glow(new THREE.BoxGeometry(0.05, 0.56, 0.05), RED, 4.0, { at: [0.52, 0.12, -0.35] });
  b.glow(new THREE.BoxGeometry(0.05, 0.56, 0.05), AMBER, 3.6, { at: [-0.52, 0.12, -0.35] });
}
