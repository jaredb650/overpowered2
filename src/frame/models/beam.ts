/**
 * Red Beam heavy Bureau-metal industrial emitter arm model (`src/frame/models/beam.ts`).
 *
 * Native side: right (`-X` inboard toward cockpit, `+X` outboard, `-Z` forward along bore, `+Z` rear elbow).
 * Built strictly from bevelled `prism()` profiles, chamfered cylinders, and thin recessed inset `RED` focus rails:
 *   - Fixed chassis (`build`): bevelled `OBSIDIAN`/`GUNMETAL` emitter housing, `PLATE` sloped thermal hood,
 *     outboard high-voltage capacitor bank with `BRASS` terminal caps & busbars, stacked radial cooling fins
 *     at the emitter throat, underslung hydraulic recoil rails, and inboard cockpit telemetry strips.
 *   - Recoiling accelerator (`moving`): split heavy accelerator barrel shroud, mid-barrel radial `PLATE`/`STEEL`
 *     radiator fins, thin inset `RED` focus rails nestled inside dark recessed channels, and a deep octagonal
 *     muzzle crown with a recessed `DARK` focusing lens cavity and glowing crimson aperture core.
 */
import * as THREE from 'three';
import type { GunSpec } from '../../vehicles/guns';
import {
  ACROSS, ALONG_Z, AMBER, BRASS, DARK, GUNMETAL, IRON, OBSIDIAN, PLATE, RED, STEEL, ngon, prism,
} from './shared';

export const BEAM_ARM: GunSpec = {
  name: 'frame-beam',
  build: b => {
    // Heavy bevelled main emitter chassis (+u forward along -Z).
    b.solid(
      prism(
        [[-1.24, -0.38], [0.68, -0.36], [0.92, -0.14], [0.9, 0.28], [0.46, 0.52], [-1.04, 0.52], [-1.3, 0.2]],
        0.92,
        0.055,
      ),
      OBSIDIAN,
      { rot: ACROSS },
    );

    // Stepped upper thermal armour cowling & recessed spine vent channel.
    b.solid(
      prism([[-0.98, 0.44], [0.56, 0.44], [0.76, 0.3], [0.3, 0.64], [-0.84, 0.62]], 0.82, 0.04),
      PLATE,
      { rot: ACROSS },
    );
    b.solid(
      prism([[-0.76, 0.56], [0.36, 0.56], [0.44, 0.65], [-0.68, 0.65]], 0.24, 0.015),
      DARK,
      { rot: ACROSS },
    );

    // Chamfered side armour cheek plates flanking the breech housing.
    for (const s of [-1, 1]) {
      b.solid(
        prism([[-0.86, -0.22], [0.62, -0.2], [0.76, 0.04], [0.48, 0.28], [-0.74, 0.3]], 0.14, 0.03),
        GUNMETAL,
        { at: [s * 0.48, 0.02, 0], rot: ACROSS },
      );
    }

    // Rear high-voltage capacitor cell bank (two heavy outboard/upper-rear drums with BRASS terminals & busbars).
    for (const [cx, cy, cz] of [[0.58, 0.12, 0.42], [0.58, -0.18, 0.54]] as const) {
      b.cyl(0.155, 0.155, 0.78, 12, GUNMETAL, { at: [cx, cy, cz], rot: ALONG_Z });
      // Dark insulated end-collars & clamping bands.
      b.cyl(0.168, 0.168, 0.07, 12, IRON, { at: [cx, cy, cz - 0.24], rot: ALONG_Z });
      b.cyl(0.168, 0.168, 0.07, 12, IRON, { at: [cx, cy, cz + 0.24], rot: ALONG_Z });
      // Brass high-current front & rear terminal caps.
      b.cyl(0.115, 0.135, 0.11, 12, BRASS, { at: [cx, cy, cz - 0.43], rot: ALONG_Z });
      b.cyl(0.125, 0.11, 0.09, 12, BRASS, { at: [cx, cy, cz + 0.42], rot: ALONG_Z });
      // Brass busbar feed conduit tying capacitor terminals into the emitter core.
      b.cyl(0.038, 0.038, 0.46, 8, BRASS, { at: [cx - 0.14, cy, cz - 0.52], rot: [0, 0.35, Math.PI / 2] });
    }
    // Protective bevelled capacitor guard frame on outboard flank.
    b.solid(
      prism([[-0.98, -0.34], [0.06, -0.32], [0.18, -0.06], [0.04, 0.32], [-0.92, 0.34]], 0.12, 0.025),
      PLATE,
      { at: [0.74, -0.02, 0.04], rot: ACROSS },
    );

    // Underslung recoil cradle & twin hydraulic stabilizer tubes with brass lock collars.
    b.solid(
      prism([[-0.4, -0.44], [1.38, -0.38], [1.54, -0.22], [-0.36, -0.24]], 0.52, 0.035),
      GUNMETAL,
      { rot: ACROSS },
    );
    for (const s of [-1, 1]) {
      b.cyl(0.09, 0.09, 1.18, 10, IRON, { at: [s * 0.28, -0.32, -0.82], rot: ALONG_Z });
      b.cyl(0.06, 0.06, 0.56, 10, STEEL, { at: [s * 0.28, -0.32, -1.52], rot: ALONG_Z });
      b.cyl(0.105, 0.105, 0.07, 10, BRASS, { at: [s * 0.28, -0.32, -1.32], rot: ALONG_Z });
    }

    // Stacked radial cooling fins around the forward breech / emitter throat (alternating PLATE / STEEL).
    for (let i = 0; i < 6; i++) {
      const z = -0.78 - i * 0.145;
      const r = 0.43 - i * 0.014;
      b.solid(prism(ngon(r, 8, Math.PI / 8), 0.065, 0.014), i % 2 === 0 ? PLATE : STEEL, { at: [0, 0.02, z] });
      b.cyl(r * 0.72, r * 0.72, 0.08, 12, IRON, { at: [0, 0.02, z - 0.07], rot: ALONG_Z });
    }

    // Rear heavy elbow gimbal & machined yoke.
    b.cyl(0.34, 0.34, 0.62, 12, STEEL, { at: [0, 0.18, 1.06], rot: [0, 0, Math.PI / 2] });
    b.cyl(0.24, 0.24, 0.72, 10, IRON, { at: [0, 0.18, 1.06], rot: [0, 0, Math.PI / 2] });

    // Inboard cockpit telemetry & capacitor status strips (thin recessed glow lines facing the pilot).
    b.solid(prism([[-0.42, 0.16], [0.56, 0.16], [0.56, 0.28], [-0.42, 0.28]], 0.05, 0.01), DARK, { at: [-0.55, 0, 0], rot: ACROSS });
    b.glow(new THREE.BoxGeometry(0.028, 0.036, 0.88), RED, 4.8, { at: [-0.565, 0.22, -0.07] });
    b.glow(new THREE.BoxGeometry(0.028, 0.14, 0.042), AMBER, 3.6, { at: [-0.565, 0.02, -0.52] });
  },

  moving: b => {
    // Recessed dark accelerator core tube running down the center of the split barrel shroud.
    b.cyl(0.205, 0.235, 1.98, 14, DARK, { at: [0, 0.02, -2.28], rot: ALONG_Z });

    // Deep split upper & lower heavy accelerator barrel shrouds (bevelled prism shells, not boxes).
    b.solid(
      prism([[0.58, 0.12], [2.36, 0.14], [2.56, 0.22], [2.48, 0.34], [0.68, 0.38], [0.52, 0.24]], 0.44, 0.032),
      GUNMETAL,
      { at: [0, 0.02, -0.82], rot: ACROSS },
    );
    b.solid(
      prism([[0.64, -0.34], [2.36, -0.3], [2.52, -0.18], [2.34, -0.12], [0.62, -0.12]], 0.42, 0.03),
      OBSIDIAN,
      { at: [0, 0.02, -0.82], rot: ACROSS },
    );

    // Side structural rail frames flanking the glowing crimson focus channels.
    for (const s of [-1, 1]) {
      b.solid(
        prism([[0.76, -0.14], [2.38, -0.12], [2.46, -0.06], [0.76, -0.06]], 0.1, 0.018),
        PLATE,
        { at: [s * 0.26, 0.02, -0.82], rot: ACROSS },
      );
      b.solid(
        prism([[0.76, 0.06], [2.38, 0.06], [2.46, 0.12], [0.76, 0.14]], 0.1, 0.018),
        PLATE,
        { at: [s * 0.26, 0.02, -0.82], rot: ACROSS },
      );
    }

    // Mid-barrel stacked radial cooling fins (`PLATE`/`STEEL`) clamped around the accelerator rails.
    for (let i = 0; i < 5; i++) {
      const z = -1.78 - i * 0.24;
      b.solid(prism(ngon(0.36, 8, Math.PI / 8), 0.055, 0.012), i % 2 === 0 ? STEEL : PLATE, { at: [0, 0.02, z] });
    }

    // Thin inset glowing RED focus rails deeply recessed along all four accelerator channels.
    for (const s of [-1, 1]) {
      b.glow(new THREE.BoxGeometry(0.032, 0.036, 1.72), RED, 5.6, { at: [s * 0.235, 0.02, -2.4] });
      b.glow(new THREE.BoxGeometry(0.036, 0.028, 1.66), RED, 5.2, { at: [0, 0.02 + s * 0.215, -2.4] });
    }

    // Heavy bevelled octagonal muzzle shroud & focusing lens cavity at the emitter tip.
    b.solid(prism(ngon(0.37, 8, Math.PI / 8), 0.34, 0.035), OBSIDIAN, { at: [0, 0.02, -3.32] });
    b.solid(prism(ngon(0.39, 8, Math.PI / 8), 0.08, 0.015), STEEL, { at: [0, 0.02, -3.14] });
    // Four brass magnetic lens alignment lugs around the muzzle collar.
    for (const [lx, ly] of [[0.29, 0.29], [-0.29, 0.29], [0.29, -0.29], [-0.29, -0.29]] as const) {
      b.cyl(0.045, 0.045, 0.24, 8, BRASS, { at: [lx, 0.02 + ly, -3.28], rot: ALONG_Z });
    }
    // Deep recessed dark optical cavity + glowing crimson focusing lens core ring inside the muzzle.
    b.cyl(0.24, 0.26, 0.24, 14, DARK, { at: [0, 0.02, -3.44], rot: ALONG_Z });
    b.glow(new THREE.TorusGeometry(0.165, 0.026, 8, 18), RED, 6.2, { at: [0, 0.02, -3.38] });
    b.glow(new THREE.CylinderGeometry(0.085, 0.085, 0.05, 12), RED, 7.2, { at: [0, 0.02, -3.32], rot: ALONG_Z });
  },

  muzzle: [0, 0.02, -3.56],
  follow: 14,
  return: 6.5,
};
