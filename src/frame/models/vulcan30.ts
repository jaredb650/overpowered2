/**
 * 30 mm Rotary Cannon arm model — Phase 0 placeholder.
 * Lane A replaces this file with the full three-barrel rounded-triangle 30 mm cannon with fat shell feed.
 */
import * as THREE from 'three';
import { TAU } from '../../core/math';
import type { GunSpec } from '../../vehicles/guns';
import { ACROSS, ALONG_Z, AMBER, BRASS, DARK, GUNMETAL, IRON, OBSIDIAN, PLATE, RED, STEEL, prism } from './shared';

export const VULCAN30_ARM: GunSpec = {
  name: 'frame-vulcan30',
  build: b => {
    b.solid(prism([[-1.15, -0.36], [0.5, -0.34], [0.68, -0.12], [0.68, 0.24], [0.38, 0.44], [-0.98, 0.44], [-1.2, 0.18]], 0.82, 0.05), OBSIDIAN, { rot: ACROSS });
    b.solid(prism([[-0.88, 0.4], [0.44, 0.4], [0.58, 0.26], [0.24, 0.54], [-0.76, 0.54]], 0.76, 0.03), PLATE, { rot: ACROSS });
    b.cyl(0.36, 0.36, 0.68, 14, GUNMETAL, { at: [-0.56, -0.22, 0.3], rot: ALONG_Z });
    b.box(0.28, 0.26, 0.4, BRASS, { at: [-0.28, -0.1, 0.26], rot: [0, 0, 0.42] });
    b.cyl(0.36, 0.4, 0.3, 16, STEEL, { at: [0, 0, -0.68], rot: ALONG_Z });
    b.glow(new THREE.BoxGeometry(0.035, 0.035, 0.64), AMBER, 3.8, { at: [0.42, 0.22, 0.04] });
    b.glow(new THREE.BoxGeometry(0.03, 0.12, 0.04), RED, 3.4, { at: [0.42, 0.04, -0.36] });
  },
  moving: b => {
    b.cyl(0.09, 0.09, 2.05, 10, IRON, { at: [0, 0, -1.7], rot: ALONG_Z });
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU + Math.PI / 6;
      b.cyl(0.095, 0.105, 2.18, 10, STEEL, { at: [Math.cos(a) * 0.17, Math.sin(a) * 0.17, -1.75], rot: ALONG_Z });
    }
    b.cyl(0.28, 0.28, 0.1, 14, PLATE, { at: [0, 0, -1.35], rot: ALONG_Z });
    b.cyl(0.29, 0.27, 0.2, 14, DARK, { at: [0, 0, -2.72], rot: ALONG_Z });
  },
  muzzle: [0, 0, -2.86],
  follow: 20,
  return: 20,
};
