/** The 20 mm six-barrel Vulcan arm model, moved intact from cockpit.ts. */
import * as THREE from 'three';
import { TAU } from '../../core/math';
import type { GunSpec } from '../../vehicles/guns';
import { ACROSS, ALONG_Z, AMBER, BRASS, DARK, GUNMETAL, IRON, OBSIDIAN, PLATE, RED, STEEL, prism } from './shared';

/** The left arm: a 20 mm six-barrel Vulcan with an armoured forearm shroud, side ammo drum and brass feed chute. */
export const ROTARY_ARM: GunSpec = {
  name: 'frame-rotary',
  build: b => {
    // Chamfered main receiver housing (+u forward along -Z).
    b.solid(prism([[-1.12, -0.34], [0.46, -0.32], [0.64, -0.14], [0.64, 0.22], [0.36, 0.42], [-0.95, 0.42], [-1.18, 0.18]], 0.78, 0.05), OBSIDIAN, { rot: ACROSS });
    // Top angled armour cowling & cooling ribs.
    b.solid(prism([[-0.88, 0.38], [0.42, 0.38], [0.58, 0.24], [0.22, 0.52], [-0.74, 0.52]], 0.74, 0.03), PLATE, { rot: ACROSS });
    for (let i = 0; i < 4; i++) b.box(0.56, 0.04, 0.08, DARK, { at: [0, 0.51, -0.15 + i * 0.22] });
    // Outer forearm shield plate.
    b.solid(prism([[-0.9, -0.26], [0.52, -0.22], [0.62, 0.04], [0.36, 0.28], [-0.78, 0.3]], 0.18, 0.03), GUNMETAL, { at: [-0.46, 0.02, 0], rot: ACROSS });
    // Underslung cylindrical ammo drum & brass feed chute.
    b.cyl(0.32, 0.32, 0.62, 14, GUNMETAL, { at: [-0.52, -0.22, 0.32], rot: ALONG_Z });
    b.cyl(0.24, 0.24, 0.66, 12, IRON, { at: [-0.52, -0.22, 0.32], rot: ALONG_Z });
    b.box(0.26, 0.24, 0.36, BRASS, { at: [-0.26, -0.12, 0.28], rot: [0, 0, 0.45] });
    // Front machined bearing collar + inner rotor drive housing.
    b.cyl(0.34, 0.38, 0.28, 16, STEEL, { at: [0, 0, -0.66], rot: ALONG_Z });
    b.cyl(0.28, 0.28, 0.14, 14, DARK, { at: [0, 0, -0.82], rot: ALONG_Z });
    // Rear hydraulic elbow yoke.
    b.cyl(0.28, 0.28, 0.52, 12, STEEL, { at: [0, 0.18, 0.96], rot: [0, 0, Math.PI / 2] });
    // Thin Bureau crimson telemetry strip along the inboard cheek.
    b.glow(new THREE.BoxGeometry(0.035, 0.035, 0.64), RED, 3.8, { at: [0.4, 0.22, 0.05] });
    b.glow(new THREE.BoxGeometry(0.03, 0.12, 0.04), AMBER, 3, { at: [0.4, 0.04, -0.35] });
  },
  moving: b => {
    // Central rotor shaft & six fluted barrels.
    b.cyl(0.075, 0.075, 1.92, 10, IRON, { at: [0, 0, -1.62], rot: ALONG_Z });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      b.cyl(0.052, 0.056, 2.02, 8, i % 2 ? DARK : STEEL, { at: [Math.cos(a) * 0.165, Math.sin(a) * 0.165, -1.66], rot: ALONG_Z });
    }
    // Two perforated barrel stabilizer clamps + heavy slotted muzzle crown.
    for (const z of [-1.08, -1.86]) {
      b.cyl(0.255, 0.255, 0.09, 16, PLATE, { at: [0, 0, z], rot: ALONG_Z });
      b.cyl(0.265, 0.265, 0.03, 16, IRON, { at: [0, 0, z + 0.04], rot: ALONG_Z });
    }
    b.cyl(0.265, 0.245, 0.18, 16, OBSIDIAN, { at: [0, 0, -2.56], rot: ALONG_Z });
    b.cyl(0.23, 0.23, 0.05, 16, BRASS, { at: [0, 0, -2.46], rot: ALONG_Z });
  },
  muzzle: [0, 0, -2.68],
  follow: 22,
  return: 22,
};
