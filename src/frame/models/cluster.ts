/**
 * Bomblet Cannon arm model (`CLUSTER_ARM`): fat short-barrelled wide-bore siege cannon with slotted muzzle brake,
 * twin heavy hydraulic recoil cylinders, bevelled `prism()` breech block, and a side-mounted cluster drum feed with
 * `AMBER` hazard stripes. Drawn natively for the right arm (`+X` outer, `-X` inboard facing the cockpit).
 */
import * as THREE from 'three';
import type { GunSpec } from '../../vehicles/guns';
import { ACROSS, ALONG_Z, AMBER, BRASS, DARK, GUNMETAL, IRON, OBSIDIAN, PLATE, STEEL, ngon, prism } from './shared';

export const CLUSTER_ARM: GunSpec = {
  name: 'frame-cluster',
  build: b => {
    // Bevelled heavy siege breech block (+u runs forward along -Z with rot: ACROSS).
    b.solid(
      prism(
        [[-1.24, -0.44], [0.68, -0.42], [0.94, -0.16], [0.92, 0.3], [0.46, 0.56], [-1.02, 0.56], [-1.3, 0.24]],
        1.04,
        0.055,
      ),
      OBSIDIAN,
      { rot: ACROSS },
    );
    // Sloped chamfered upper breech armour hood & breech-lock ribs.
    b.solid(
      prism([[-0.98, 0.48], [0.56, 0.48], [0.76, 0.34], [0.34, 0.68], [-0.84, 0.66]], 0.94, 0.04),
      PLATE,
      { rot: ACROSS },
    );
    b.solid(
      prism([[-0.26, -0.14], [0.26, -0.14], [0.34, 0.08], [0.22, 0.22], [-0.22, 0.22], [-0.34, 0.08]], 0.44, 0.03),
      GUNMETAL,
      { at: [0, 0.54, 0.42] },
    );

    // Lower armoured cradle sled under the wide-bore barrel.
    b.solid(
      prism([[-0.34, -0.1], [0.34, -0.1], [0.42, 0.08], [-0.42, 0.08]], 1.32, 0.03),
      GUNMETAL,
      { at: [0, -0.34, -1.02] },
    );

    // Twin heavy hydraulic recoil cylinders flanking the lower cradle.
    for (const s of [-1, 1]) {
      b.cyl(0.14, 0.14, 1.38, 12, IRON, { at: [s * 0.42, -0.28, -0.84], rot: ALONG_Z });
      b.cyl(0.09, 0.09, 0.64, 10, STEEL, { at: [s * 0.42, -0.28, -1.58], rot: ALONG_Z });
      b.cyl(0.16, 0.16, 0.09, 12, BRASS, { at: [s * 0.42, -0.28, -1.42], rot: ALONG_Z });
      b.cyl(0.155, 0.155, 0.08, 12, PLATE, { at: [s * 0.42, -0.28, -0.26], rot: ALONG_Z });
    }

    // Side-mounted cluster canister drum feed on the outer flank (+X) with feed chute & AMBER hazard stripes.
    b.cyl(0.42, 0.42, 0.86, 16, GUNMETAL, { at: [0.78, -0.02, -0.14], rot: ALONG_Z });
    b.cyl(0.45, 0.45, 0.09, 16, PLATE, { at: [0.78, -0.02, -0.54], rot: ALONG_Z });
    b.cyl(0.45, 0.45, 0.09, 16, PLATE, { at: [0.78, -0.02, 0.26], rot: ALONG_Z });
    b.cyl(0.18, 0.18, 0.94, 12, IRON, { at: [0.78, -0.02, -0.14], rot: ALONG_Z });
    b.cyl(0.11, 0.11, 0.98, 10, BRASS, { at: [0.78, -0.02, -0.14], rot: ALONG_Z });
    // Angled canister feed chute linking drum into the breech.
    b.solid(
      prism([[-0.18, -0.22], [0.22, -0.22], [0.28, 0.16], [-0.14, 0.24]], 0.66, 0.03),
      STEEL,
      { at: [0.54, 0.14, -0.14] },
    );
    // Diagonal AMBER hazard stripes along the outer drum casing + thin inset amber charge strip.
    for (let i = 0; i < 4; i++) {
      const z = -0.4 + i * 0.18;
      b.box(0.05, 0.22, 0.075, AMBER, { at: [1.19, 0.04, z], rot: [0.42, 0, 0] });
    }
    b.glow(new THREE.BoxGeometry(0.03, 0.04, 0.64), AMBER, 3.6, { at: [1.21, 0.24, -0.14] });

    // Heavy rear elbow gimbal.
    b.cyl(0.35, 0.35, 0.66, 12, STEEL, { at: [0, 0.18, 1.04], rot: [0, 0, Math.PI / 2] });
    b.cyl(0.24, 0.24, 0.74, 10, IRON, { at: [0, 0.18, 1.04], rot: [0, 0, Math.PI / 2] });

    // Inboard cockpit-facing Bureau status strips (-X).
    b.glow(new THREE.BoxGeometry(0.035, 0.05, 0.78), AMBER, 4.2, { at: [-0.53, 0.28, -0.04] });
    b.glow(new THREE.BoxGeometry(0.035, 0.12, 0.05), AMBER, 3.8, { at: [-0.53, 0.06, -0.52] });
  },
  moving: b => {
    // Fat short-barrelled wide-bore siege tube + thermal jacket.
    b.cyl(0.36, 0.4, 0.82, 16, GUNMETAL, { at: [0, 0.04, -0.96], rot: ALONG_Z });
    b.cyl(0.31, 0.34, 1.32, 16, STEEL, { at: [0, 0.04, -1.72], rot: ALONG_Z });
    // Ribbed wide-bore reinforcement collars + brass gas-check bands.
    b.cyl(0.37, 0.37, 0.12, 16, PLATE, { at: [0, 0.04, -1.42], rot: ALONG_Z });
    b.cyl(0.37, 0.37, 0.12, 16, PLATE, { at: [0, 0.04, -1.78], rot: ALONG_Z });
    b.cyl(0.385, 0.385, 0.07, 16, BRASS, { at: [0, 0.04, -1.6], rot: ALONG_Z });
    b.cyl(0.385, 0.385, 0.07, 16, BRASS, { at: [0, 0.04, -2.06], rot: ALONG_Z });

    // Chunky bevelled octagonal slotted muzzle brake.
    b.solid(prism(ngon(0.46, 8, Math.PI / 8), 0.74, 0.045), OBSIDIAN, { at: [0, 0.04, -2.48] });
    // Recessed side vent slots (two pairs per side) + top/bottom compensator ribs.
    for (const s of [-1, 1]) {
      b.box(0.09, 0.34, 0.18, DARK, { at: [s * 0.43, 0.04, -2.32] });
      b.box(0.09, 0.34, 0.18, DARK, { at: [s * 0.43, 0.04, -2.62] });
      b.box(0.06, 0.44, 0.06, PLATE, { at: [s * 0.44, 0.04, -2.47] });
    }
    b.box(0.34, 0.07, 0.66, PLATE, { at: [0, 0.46, -2.48] });
    b.box(0.34, 0.07, 0.66, PLATE, { at: [0, -0.38, -2.48] });
    // Deep recessed wide-bore muzzle mouth.
    b.cyl(0.25, 0.25, 0.2, 14, DARK, { at: [0, 0.04, -2.78], rot: ALONG_Z });
  },
  muzzle: [0, 0.04, -2.88],
  follow: 15,
  return: 7.5,
};
