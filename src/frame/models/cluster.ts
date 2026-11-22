/**
 * Bomblet Cannon arm model — Phase 0 placeholder.
 * Lane C replaces this file with the dedicated wide-bore standoff bomblet launcher model.
 */
import * as THREE from 'three';
import type { GunSpec } from '../../vehicles/guns';
import { ACROSS, ALONG_Z, AMBER, BRASS, DARK, GUNMETAL, OBSIDIAN, PLATE, STEEL, prism } from './shared';

export const CLUSTER_ARM: GunSpec = {
  name: 'frame-cluster',
  build: b => {
    b.solid(prism([[-1.2, -0.4], [0.58, -0.38], [0.8, -0.12], [0.76, 0.3], [0.36, 0.52], [-1.0, 0.52], [-1.26, 0.22]], 0.92, 0.05), OBSIDIAN, { rot: ACROSS });
    b.solid(prism([[-0.94, 0.46], [0.48, 0.46], [0.68, 0.3], [0.26, 0.62], [-0.82, 0.6]], 0.84, 0.04), PLATE, { rot: ACROSS });
    b.cyl(0.32, 0.32, 0.6, 12, STEEL, { at: [0, 0.18, 1.0], rot: [0, 0, Math.PI / 2] });
    b.glow(new THREE.BoxGeometry(0.04, 0.05, 0.72), AMBER, 4.0, { at: [-0.48, 0.24, -0.02] });
  },
  moving: b => {
    b.cyl(0.32, 0.34, 1.65, 14, GUNMETAL, { at: [0, 0.03, -1.55], rot: ALONG_Z });
    b.cyl(0.36, 0.36, 0.1, 14, BRASS, { at: [0, 0.03, -1.9], rot: ALONG_Z });
    b.cyl(0.38, 0.32, 0.36, 14, DARK, { at: [0, 0.03, -2.52], rot: ALONG_Z });
  },
  muzzle: [0, 0.03, -2.75],
  follow: 16,
  return: 10,
};
