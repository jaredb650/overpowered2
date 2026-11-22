/**
 * Red Beam emitter arm model — Phase 0 placeholder.
 * Lane B replaces this file with the full finned heavy emitter with inset crimson focus channel.
 */
import * as THREE from 'three';
import type { GunSpec } from '../../vehicles/guns';
import { ACROSS, ALONG_Z, DARK, GUNMETAL, OBSIDIAN, PLATE, RED, STEEL, prism } from './shared';

export const BEAM_ARM: GunSpec = {
  name: 'frame-beam',
  build: b => {
    b.solid(prism([[-1.2, -0.36], [0.64, -0.34], [0.84, -0.1], [0.8, 0.28], [0.36, 0.48], [-1.0, 0.48], [-1.24, 0.2]], 0.86, 0.05), OBSIDIAN, { rot: ACROSS });
    b.solid(prism([[-0.9, 0.42], [0.52, 0.42], [0.66, 0.28], [0.24, 0.58], [-0.8, 0.56]], 0.78, 0.035), PLATE, { rot: ACROSS });
    b.cyl(0.3, 0.3, 0.56, 12, STEEL, { at: [0, 0.18, 1.0], rot: [0, 0, Math.PI / 2] });
    b.glow(new THREE.BoxGeometry(0.04, 0.06, 1.1), RED, 4.6, { at: [-0.45, 0.18, -0.18] });
  },
  moving: b => {
    b.solid(prism([[-0.22, -0.22], [1.95, -0.18], [2.15, -0.06], [2.15, 0.12], [1.95, 0.24], [-0.22, 0.26]], 0.52, 0.04), GUNMETAL, { at: [0, 0.02, -1.0], rot: ACROSS });
    b.cyl(0.18, 0.22, 0.24, 12, DARK, { at: [0, 0.02, -3.18], rot: ALONG_Z });
    b.glow(new THREE.BoxGeometry(0.06, 0.06, 1.95), RED, 5.2, { at: [0, 0.02, -2.05] });
  },
  muzzle: [0, 0.02, -3.35],
  follow: 16,
  return: 12,
};
