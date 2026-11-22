/** Six-tube lock-on missile pod model, moved intact from cockpit.ts. */
import * as THREE from 'three';
import type { ModelBuilder } from '../../progression/modelkit';
import { ACROSS, ALONG_Z, DARK, IRON, OBSIDIAN, PLATE, RED, STEEL, prism } from './shared';

/** Shoulder 6-tube lock-on missile pod built in local mount space so it can slump when knocked offline. */
export function buildPod6(b: ModelBuilder): void {
  b.cyl(0.12, 0.14, 0.55, 10, STEEL, { at: [-0.12, -0.52, 0.06], rot: [0, 0, -0.22] });
  b.solid(prism([[-0.72, -0.44], [0.68, -0.44], [0.76, -0.28], [0.76, 0.32], [0.58, 0.46], [-0.64, 0.46], [-0.76, 0.28]], 1.18, 0.05), OBSIDIAN, { rot: ACROSS });
  b.solid(prism([[-0.56, 0.38], [0.58, 0.38], [0.46, 0.54], [-0.48, 0.54]], 1.06, 0.03), PLATE, { rot: ACROSS });
  b.box(1.06, 0.72, 0.08, DARK, { at: [0, 0, -0.72] });
  for (let i = 0; i < 6; i++) {
    const tx = ((i % 3) - 1) * 0.31;
    const ty = i < 3 ? 0.18 : -0.18;
    b.cyl(0.115, 0.115, 0.12, 10, IRON, { at: [tx, ty, -0.75], rot: ALONG_Z });
    b.cyl(0.03, 0.075, 0.14, 8, PLATE, { at: [tx, ty, -0.78], rot: ALONG_Z });
    b.glow(new THREE.CylinderGeometry(0.028, 0.028, 0.03, 8), RED, 4.2, { at: [tx, ty, -0.85], rot: ALONG_Z });
  }
}
