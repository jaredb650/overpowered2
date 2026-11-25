/**
 * Shock-Needle Launcher 3D model (`arcNeedle`).
 * Long sleek split-prong electromagnetic rail-spire pod with exposed brass/copper accelerator coils,
 * underslung harpoon needle magazine cassette, and high-voltage capacitor fins.
 */
import * as THREE from 'three';
import type { ModelBuilder } from '../../progression/modelkit';
import {
  ACROSS, ALONG_Z, AMBER, BRASS, DARK, FLAT, GUNMETAL, IRON, OBSIDIAN, PLATE, RED, STEEL,
  ngon, prism, type ShoulderModelBuilder,
} from './shared';

/** Builds the Shock-Needle Rail-Spire Pod in local mount space (origin = shoulder pylon, -Z = forward). */
export function buildArcNeedle(b: ModelBuilder): void {
  // ---- Heavy recoil mount & articulated pivot saddle ----
  b.solid(prism(ngon(0.26, 8, Math.PI / 8), 0.12, 0.02), IRON, { at: [0, -0.44, 0.12], rot: FLAT });
  b.cyl(0.12, 0.16, 0.32, 10, STEEL, { at: [0, -0.26, 0.12] });
  b.cyl(0.1, 0.1, 0.56, 10, GUNMETAL, { at: [0, -0.08, 0.12], rot: [0, 0, Math.PI / 2] });
  for (const s of [-1, 1]) {
    b.cyl(0.06, 0.06, 0.06, 8, BRASS, { at: [s * 0.31, -0.08, 0.12], rot: [0, 0, Math.PI / 2] });
  }

  // ---- Sleek elongated breech & capacitor spine ----
  b.solid(
    prism([
      [-0.74, -0.14], [0.64, -0.14], [0.84, 0.04], [0.62, 0.34],
      [-0.56, 0.38], [-0.82, 0.16],
    ], 0.52, 0.035),
    OBSIDIAN,
    { rot: ACROSS },
  );
  b.solid(
    prism([[-0.5, 0.3], [0.58, 0.28], [0.46, 0.44], [-0.42, 0.44]], 0.38, 0.022),
    PLATE,
    { rot: ACROSS },
  );

  // Underslung 3-needle vertical magazine cassette.
  b.solid(
    prism([[-0.34, -0.34], [0.28, -0.34], [0.36, -0.12], [-0.28, -0.12]], 0.34, 0.025),
    GUNMETAL,
    { at: [0, 0, -0.06], rot: ACROSS },
  );
  // 3 visible glowing charge pips on the magazine flank.
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      b.glow(new THREE.BoxGeometry(0.022, 0.045, 0.1), AMBER, 4.0, {
        at: [s * 0.18, -0.24, -0.2 + i * 0.14],
      });
    }
  }

  // ---- High-voltage swept capacitor fins along rear hull ----
  for (const s of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      const fz = 0.05 + k * 0.24;
      b.solid(
        prism([[-0.08, -0.04], [0.1, -0.04], [0.06, 0.32], [-0.06, 0.26]], 0.05, 0.012),
        PLATE,
        { at: [s * 0.32, 0.24, fz], rot: [0, Math.PI / 2, -s * 0.48] },
      );
      b.glow(new THREE.BoxGeometry(0.024, 0.18, 0.024), RED, 3.8, {
        at: [s * 0.36, 0.3, fz],
        rot: [0, 0, -s * 0.48],
      });
    }
  }

  // ---- Long split-prong electromagnetic rail-spire extending forward (-Z) ----
  for (const s of [-1, 1]) {
    // Upper and lower split rail blades.
    b.solid(
      prism([
        [0.42, 0.08], [2.22, 0.06], [2.36, 0.11], [2.14, 0.2], [0.5, 0.24],
      ], 0.085, 0.018),
      GUNMETAL,
      { at: [s * 0.13, 0.08, 0], rot: ACROSS },
    );
    // Inner glowing accelerator track lining the split gap.
    b.glow(new THREE.BoxGeometry(0.022, 0.036, 1.56), RED, 4.4, {
      at: [s * 0.078, 0.18, -1.36],
    });
  }

  // Bottom stabilizer spine beneath the rail gap.
  b.solid(
    prism([[0.48, -0.06], [1.92, -0.02], [2.04, 0.04], [0.54, 0.06]], 0.14, 0.018),
    OBSIDIAN,
    { rot: ACROSS },
  );

  // ---- Exposed copper/brass induction coil rings wrapping the rail spire ----
  for (const cz of [-0.76, -1.04, -1.32, -1.6, -1.88]) {
    b.solid(prism(ngon(0.18, 8, Math.PI / 8), 0.065, 0.012), BRASS, { at: [0, 0.15, cz] });
    b.cyl(0.14, 0.14, 0.08, 8, DARK, { at: [0, 0.15, cz], rot: ALONG_Z });
  }

  // ---- Visibly chambered steel harpoon needle sitting inside the split prongs ----
  b.cyl(0.026, 0.036, 1.85, 8, STEEL, { at: [0, 0.15, -1.48], rot: ALONG_Z });
  // Sharp conical harpoon tip jutting past the rail forks.
  b.cyl(0.004, 0.038, 0.28, 8, STEEL, { at: [0, 0.15, -2.52], rot: [-Math.PI / 2, 0, 0] });
  // Glowing ionized charge collar behind the harpoon tip.
  b.glow(new THREE.CylinderGeometry(0.034, 0.034, 0.08, 8), AMBER, 4.6, {
    at: [0, 0.15, -2.28],
    rot: ALONG_Z,
  });
}

export const SHOULDER_ARC_NEEDLE: ShoulderModelBuilder = buildArcNeedle;
