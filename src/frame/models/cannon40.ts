/** The 40 mm autocannon arm model, moved intact from cockpit.ts. */
import * as THREE from 'three';
import type { GunSpec } from '../../vehicles/guns';
import { ACROSS, ALONG_Z, AMBER, BRASS, DARK, GUNMETAL, IRON, OBSIDIAN, PLATE, RED, STEEL, prism } from './shared';

/** The right arm: a 40 mm autocannon on hydraulic recoil rails with an armoured melee strike-gauntlet blade. */
export const CANNON_ARM: GunSpec = {
  name: 'frame-cannon',
  build: b => {
    // Heavy chamfered breech housing (+u forward along -Z).
    b.solid(prism([[-1.18, -0.36], [0.54, -0.34], [0.76, -0.1], [0.72, 0.26], [0.34, 0.48], [-0.98, 0.48], [-1.24, 0.2]], 0.84, 0.05), OBSIDIAN, { rot: ACROSS });
    // Sloped upper armour mantle & breech inspection hatch.
    b.solid(prism([[-0.92, 0.42], [0.46, 0.42], [0.64, 0.28], [0.24, 0.58], [-0.8, 0.56]], 0.78, 0.035), PLATE, { rot: ACROSS });
    // Side-mounted 40 mm clip box with exposed brass shell rims.
    b.solid(prism([[-0.64, -0.24], [0.24, -0.24], [0.28, 0.22], [-0.56, 0.28]], 0.34, 0.03), GUNMETAL, { at: [0.56, -0.02, 0.2], rot: ACROSS });
    for (let i = 0; i < 4; i++) b.cyl(0.042, 0.042, 0.14, 8, BRASS, { at: [0.44, 0.16, -0.02 + i * 0.14], rot: [0, 0, Math.PI / 2] });
    // Twin hydraulic recoil recuperator tubes flanking the breech.
    for (const s of [-1, 1]) {
      b.cyl(0.085, 0.085, 1.05, 10, IRON, { at: [s * 0.28, -0.28, -0.68], rot: ALONG_Z });
      b.cyl(0.055, 0.055, 0.48, 8, STEEL, { at: [s * 0.28, -0.28, -1.28], rot: ALONG_Z });
      b.cyl(0.095, 0.095, 0.06, 10, BRASS, { at: [s * 0.28, -0.28, -1.12], rot: ALONG_Z });
    }
    // Armoured melee knuckle-ram strike blade along the outer forearm (visually reads during backhand sweeps!).
    b.solid(prism([[-0.35, -0.44], [0.95, -0.42], [1.28, -0.18], [1.05, 0.12], [-0.25, 0.18]], 0.22, 0.035), PLATE, { at: [0.52, -0.12, -0.48], rot: ACROSS });
    b.box(0.06, 0.34, 0.92, STEEL, { at: [0.64, -0.18, -0.82], rot: [0.1, 0, 0] });
    // Rear elbow gimbal.
    b.cyl(0.3, 0.3, 0.56, 12, STEEL, { at: [0, 0.18, 1.0], rot: [0, 0, Math.PI / 2] });
    // Bureau red accent bar & ready lamp on the inboard face.
    b.glow(new THREE.BoxGeometry(0.035, 0.035, 0.68), RED, 3.8, { at: [-0.43, 0.24, 0.02] });
    b.glow(new THREE.BoxGeometry(0.03, 0.12, 0.04), AMBER, 3, { at: [-0.43, 0.06, -0.4] });
  },
  moving: b => {
    // Heavy thermal-sleeved 40 mm barrel.
    b.cyl(0.21, 0.24, 0.72, 12, GUNMETAL, { at: [0, 0.02, -0.78], rot: ALONG_Z });
    b.cyl(0.145, 0.165, 1.98, 12, STEEL, { at: [0, 0.02, -1.96], rot: ALONG_Z });
    b.cyl(0.18, 0.18, 0.12, 12, IRON, { at: [0, 0.02, -1.55], rot: ALONG_Z });
    b.cyl(0.17, 0.17, 0.12, 12, IRON, { at: [0, 0.02, -2.35], rot: ALONG_Z });
    // Sculpted dual-baffle muzzle brake.
    b.solid(prism([[-0.22, -0.14], [0.28, -0.14], [0.34, -0.06], [0.34, 0.08], [0.28, 0.16], [-0.22, 0.16]], 0.48, 0.03), OBSIDIAN, { at: [0, 0.02, -3.12], rot: ACROSS });
    for (const s of [-1, 1]) b.box(0.05, 0.18, 0.18, DARK, { at: [s * 0.23, 0.02, -3.12] });
  },
  muzzle: [0, 0.02, -3.42],
  follow: 20,
  return: 14,
};
