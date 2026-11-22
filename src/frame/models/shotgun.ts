/**
 * Mech Shotgun arm model — Phase 0 placeholder.
 * Lane D replaces this file with the full heavy combat shotgun (tube magazine, ventilated heat shield, folding stub).
 */
import * as THREE from 'three';
import type { GunSpec } from '../../vehicles/guns';
import { ACROSS, ALONG_Z, AMBER, DARK, GUNMETAL, IRON, OBSIDIAN, PLATE, RED, STEEL, prism } from './shared';

export const SHOTGUN_ARM: GunSpec = {
  name: 'frame-shotgun',
  build: b => {
    b.solid(prism([[-1.12, -0.34], [0.54, -0.32], [0.74, -0.08], [0.7, 0.28], [0.34, 0.46], [-0.96, 0.46], [-1.18, 0.18]], 0.8, 0.05), OBSIDIAN, { rot: ACROSS });
    b.solid(prism([[-0.84, 0.4], [0.46, 0.4], [0.62, 0.26], [0.22, 0.54], [-0.74, 0.52]], 0.72, 0.03), PLATE, { rot: ACROSS });
    // Under-barrel tube magazine.
    b.cyl(0.14, 0.14, 1.85, 12, IRON, { at: [0, -0.2, -1.48], rot: ALONG_Z });
    b.cyl(0.28, 0.28, 0.54, 12, STEEL, { at: [0, 0.18, 0.96], rot: [0, 0, Math.PI / 2] });
    b.glow(new THREE.BoxGeometry(0.035, 0.04, 0.6), RED, 3.8, { at: [-0.42, 0.22, 0.0] });
    b.glow(new THREE.BoxGeometry(0.03, 0.1, 0.04), AMBER, 3.2, { at: [-0.42, 0.05, -0.36] });
  },
  moving: b => {
    b.cyl(0.17, 0.18, 2.05, 12, STEEL, { at: [0, 0.08, -1.62], rot: ALONG_Z });
    b.box(0.42, 0.28, 1.5, GUNMETAL, { at: [0, 0.12, -1.5] });
    b.cyl(0.19, 0.19, 0.14, 12, DARK, { at: [0, 0.08, -2.68], rot: ALONG_Z });
  },
  muzzle: [0, 0.08, -2.78],
  follow: 22,
  return: 16,
};
