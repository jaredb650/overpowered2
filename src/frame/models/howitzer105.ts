/** The 105 mm siege howitzer arm model, moved intact from cockpit.ts. */
import * as THREE from 'three';
import type { GunSpec } from '../../vehicles/guns';
import { ACROSS, ALONG_Z, AMBER, BRASS, DARK, GUNMETAL, IRON, OBSIDIAN, PLATE, RED, STEEL, prism } from './shared';

/** The upgraded right arm: a chunky 105 mm siege howitzer with heavy recuperators, bore evacuator and dual-baffle muzzle brake. */
export const HOWITZER_ARM: GunSpec = {
  name: 'frame-howitzer',
  build: b => {
    // Reinforced siege breech housing (+u forward along -Z).
    b.solid(prism([[-1.28, -0.44], [0.64, -0.42], [0.92, -0.14], [0.88, 0.34], [0.42, 0.58], [-1.06, 0.58], [-1.34, 0.24]], 1.02, 0.06), OBSIDIAN, { rot: ACROSS });
    // Heavy sloped upper armour hood & breech-lock block.
    b.solid(prism([[-1.0, 0.5], [0.54, 0.5], [0.78, 0.34], [0.3, 0.7], [-0.88, 0.68]], 0.94, 0.04), PLATE, { rot: ACROSS });
    b.box(0.56, 0.24, 0.42, GUNMETAL, { at: [0, 0.42, 0.58] });
    // Oversized twin hydraulic recoil recuperator cylinders under & beside the cradle.
    for (const s of [-1, 1]) {
      b.cyl(0.135, 0.135, 1.48, 12, IRON, { at: [s * 0.36, -0.34, -0.82], rot: ALONG_Z });
      b.cyl(0.088, 0.088, 0.68, 10, STEEL, { at: [s * 0.36, -0.34, -1.62], rot: ALONG_Z });
      b.cyl(0.15, 0.15, 0.09, 12, BRASS, { at: [s * 0.36, -0.34, -1.42], rot: ALONG_Z });
    }
    // Lower cradle sled under the barrel.
    b.box(0.62, 0.18, 1.38, GUNMETAL, { at: [0, -0.32, -1.1] });
    // Armoured melee knuckle-ram strike blade retained along the outer forearm.
    b.solid(prism([[-0.35, -0.46], [1.0, -0.44], [1.34, -0.18], [1.1, 0.14], [-0.25, 0.2]], 0.24, 0.04), PLATE, { at: [0.62, -0.12, -0.52], rot: ACROSS });
    b.box(0.07, 0.36, 0.98, STEEL, { at: [0.74, -0.18, -0.86], rot: [0.1, 0, 0] });
    // Rear heavy elbow gimbal.
    b.cyl(0.35, 0.35, 0.66, 12, STEEL, { at: [0, 0.2, 1.06], rot: [0, 0, Math.PI / 2] });
    // Bureau siege amber/crimson status strips on the inboard face (visible from cockpit).
    b.glow(new THREE.BoxGeometry(0.04, 0.055, 0.82), AMBER, 4.4, { at: [-0.52, 0.28, -0.02] });
    b.glow(new THREE.BoxGeometry(0.04, 0.16, 0.06), RED, 4.0, { at: [-0.52, 0.06, -0.52] });
  },
  moving: b => {
    // Massive thick-walled 105 mm cannon barrel & thermal shroud.
    b.cyl(0.32, 0.36, 0.94, 14, GUNMETAL, { at: [0, 0.04, -0.92], rot: ALONG_Z });
    b.cyl(0.245, 0.275, 2.38, 14, STEEL, { at: [0, 0.04, -2.3], rot: ALONG_Z });
    // Prominent cylindrical bore evacuator mid-barrel + brass reinforcement bands.
    b.cyl(0.34, 0.34, 0.66, 14, PLATE, { at: [0, 0.04, -2.05], rot: ALONG_Z });
    b.cyl(0.35, 0.35, 0.06, 14, BRASS, { at: [0, 0.04, -1.72], rot: ALONG_Z });
    b.cyl(0.35, 0.35, 0.06, 14, BRASS, { at: [0, 0.04, -2.38], rot: ALONG_Z });
    // Dark recessed 105 mm muzzle bore.
    b.cyl(0.18, 0.18, 0.18, 12, DARK, { at: [0, 0.04, -3.86], rot: ALONG_Z });
    // Giant rectangular dual-baffle artillery muzzle brake.
    b.solid(prism([[-0.38, -0.26], [0.46, -0.26], [0.54, -0.14], [0.54, 0.18], [0.46, 0.3], [-0.38, 0.3]], 0.78, 0.04), OBSIDIAN, { at: [0, 0.04, -3.56], rot: ACROSS });
    for (const s of [-1, 1]) {
      b.box(0.08, 0.32, 0.24, DARK, { at: [s * 0.38, 0.04, -3.42] });
      b.box(0.08, 0.32, 0.24, DARK, { at: [s * 0.38, 0.04, -3.72] });
    }
  },
  muzzle: [0, 0.04, -3.96],
  follow: 14,
  return: 5.5,
};
