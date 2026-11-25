/**
 * Vertical Plasma Missile Rack 3D model (`plasmaMissiles`).
 * Tilted 6-cell vertical-launch VLS honeycomb silo box with bevelled hinged blast doors,
 * glowing plasma cell rims, and rear exhaust blast deflector louvers.
 */
import * as THREE from 'three';
import type { ModelBuilder } from '../../progression/modelkit';
import {
  ACROSS, AMBER, BRASS, DARK, FLAT, GUNMETAL, IRON, OBSIDIAN, PLATE, RED, STEEL,
  ngon, prism, type ShoulderModelBuilder,
} from './shared';

/** Slight backward cant (~14 deg) so VLS tubes clear the chassis crown on vertical ignition. */
const VLS_TILT = 0.24;

/** Builds the 6-Cell Vertical Plasma Missile Rack in local mount space (origin = shoulder pylon, -Z = forward). */
export function buildPlasmaMissiles(b: ModelBuilder): void {
  // ---- Reinforced VLS pedestal & lower exhaust plenum ----
  b.solid(prism(ngon(0.3, 8, Math.PI / 8), 0.14, 0.02), IRON, { at: [0, -0.44, 0.06], rot: FLAT });
  b.cyl(0.15, 0.19, 0.26, 10, STEEL, { at: [0, -0.28, 0.06] });

  // Heavy lower blast-deflector manifold box.
  b.solid(
    prism([[-0.56, -0.24], [0.52, -0.24], [0.62, -0.06], [0.54, 0.12], [-0.52, 0.12], [-0.62, -0.06]], 1.02, 0.04),
    IRON,
    { rot: ACROSS },
  );

  // Rear exhaust blast deflector louvers (venting vertical ignition plume backward/downward).
  for (let i = 0; i < 4; i++) {
    b.solid(
      prism([[-0.42, -0.02], [0.42, -0.02], [0.38, 0.05], [-0.38, 0.05]], 0.18, 0.012),
      PLATE,
      { at: [0, -0.14 + i * 0.13, 0.56 + i * 0.03], rot: [0.58, 0, 0] },
    );
  }

  // ---- Tilted 6-cell VLS honeycomb silo casing ----
  b.solid(
    prism([
      [-0.48, -0.1], [0.46, -0.1], [0.54, 0.06], [0.54, 0.72],
      [0.42, 0.84], [-0.42, 0.84], [-0.54, 0.68], [-0.54, 0.06],
    ], 0.96, 0.045),
    OBSIDIAN,
    { at: [0, 0.06, 0.04], rot: [0, Math.PI / 2, 0] },
  );

  // Side cheek reinforcing plates & brass hydraulic door actuators.
  for (const s of [-1, 1]) {
    b.solid(
      prism([[-0.38, 0.02], [0.38, 0.02], [0.44, 0.66], [-0.36, 0.66]], 0.09, 0.02),
      GUNMETAL,
      { at: [s * 0.5, 0.08, 0.04], rot: ACROSS },
    );
    b.cyl(0.042, 0.042, 0.48, 8, BRASS, { at: [s * 0.55, 0.44, -0.14], rot: [VLS_TILT, 0, 0] });
    b.cyl(0.03, 0.03, 0.52, 8, STEEL, { at: [s * 0.55, 0.48, 0.18], rot: [VLS_TILT, 0, 0] });
    // Glowing side capacitor strip.
    b.glow(new THREE.BoxGeometry(0.026, 0.46, 0.055), AMBER, 3.8, { at: [s * 0.56, 0.42, 0.02] });
  }

  // ---- 2×3 Honeycomb hexagonal VLS launch cells facing UP (+Y) ----
  const topY = 0.88;
  const colXs = [-0.28, 0, 0.28];
  const rowZs = [-0.22, 0.18];

  // Recessed dark cell deck plate.
  b.box(0.86, 0.06, 0.76, DARK, { at: [0, topY - 0.02, 0.0] });

  for (let r = 0; r < rowZs.length; r++) {
    for (let c = 0; c < colXs.length; c++) {
      const cx = colXs[c]!;
      const cz = rowZs[r]!;
      // Hexagonal VLS collar ring.
      b.solid(prism(ngon(0.135, 6), 0.12, 0.014), GUNMETAL, { at: [cx, topY + 0.02, cz], rot: FLAT });
      // Deep recessed dark launch tube bore.
      b.cyl(0.092, 0.092, 0.08, 8, DARK, { at: [cx, topY + 0.06, cz] });
      // Seated plasma missile nosecone inside tube.
      b.cyl(0.025, 0.072, 0.12, 8, PLATE, { at: [cx, topY + 0.06, cz] });
      // Glowing plasma charge rim around each cell mouth.
      b.glow(new THREE.CylinderGeometry(0.112, 0.112, 0.022, 6, 1, true), RED, 4.3, {
        at: [cx, topY + 0.09, cz],
      });
    }
  }

  // ---- Hinged bevelled blast doors flared open fore and aft ----
  b.solid(
    prism([[-0.44, -0.04], [0.44, -0.04], [0.4, 0.24], [-0.4, 0.24]], 0.065, 0.018),
    PLATE,
    { at: [0, topY + 0.14, -0.48], rot: [-0.52, 0, 0] },
  );
  b.solid(
    prism([[-0.44, -0.04], [0.44, -0.04], [0.4, 0.24], [-0.4, 0.24]], 0.065, 0.018),
    PLATE,
    { at: [0, topY + 0.14, 0.46], rot: [0.58, 0, 0] },
  );

  // Forward target-acquisition optical visor bar.
  b.solid(
    prism([[-0.38, -0.06], [0.38, -0.06], [0.34, 0.08], [-0.34, 0.08]], 0.12, 0.02),
    PLATE,
    { at: [0, 0.54, -0.52] },
  );
  b.glow(new THREE.BoxGeometry(0.62, 0.032, 0.026), AMBER, 4.2, { at: [0, 0.54, -0.59] });
}

export const SHOULDER_PLASMA_MISSILES: ShoulderModelBuilder = buildPlasmaMissiles;
