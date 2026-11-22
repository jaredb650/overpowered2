/**
 * MIRV Launcher shoulder model (`buildMirv` / `SHOULDER_MIRV`).
 * Vertical-launch heavy canister cell: bevelled obsidian/gunmetal armoured silo with hinged top blast hatch,
 * louvered side exhaust vents, amber warning chevrons, and a visible multi-warhead nose cone inside the launch well.
 */
import * as THREE from 'three';
import { TAU } from '../../core/math';
import type { ModelBuilder } from '../../progression/modelkit';
import { ACROSS, AMBER, BRASS, DARK, GUNMETAL, IRON, OBSIDIAN, PLATE, RED, STEEL, ngon, prism } from './shared';

/** Builds the vertical-launch MIRV canister silo in local shoulder mount space (origin = pylon mount, -Z = forward). */
export function buildMirv(b: ModelBuilder): void {
  // Heavy shoulder pylon column, hydraulic recoil damper, and angled gusset struts.
  b.cyl(0.15, 0.18, 0.52, 10, STEEL, { at: [0, -0.48, 0.04] });
  b.cyl(0.08, 0.09, 0.44, 8, IRON, { at: [0, -0.44, -0.22], rot: [-0.26, 0, 0] });
  for (const s of [-1, 1]) {
    b.solid(prism([[-0.18, -0.24], [0.22, -0.24], [0.16, 0.14], [-0.14, 0.14]], 0.12, 0.02), GUNMETAL, {
      at: [s * 0.28, -0.34, 0.04],
      rot: [0, Math.PI / 2, s * -0.22],
    });
  }

  // Chamfered octagonal lower plinth collar with brass anchor bolts.
  b.solid(prism(ngon(0.56, 8, Math.PI / 8), 0.14, 0.025), IRON, { at: [0, -0.30, 0], rot: [Math.PI / 2, 0, 0] });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + Math.PI / 4;
    b.cyl(0.036, 0.036, 0.06, 6, BRASS, { at: [Math.cos(a) * 0.46, -0.23, Math.sin(a) * 0.46] });
  }

  // Main bevelled vertical-launch armoured silo body (OBSIDIAN core, +u forward along -Z).
  b.solid(
    prism(
      [[-0.56, -0.28], [0.58, -0.28], [0.66, -0.06], [0.62, 0.78], [0.46, 0.94], [-0.48, 0.94], [-0.62, 0.72], [-0.64, -0.04]],
      1.04,
      0.055,
    ),
    OBSIDIAN,
    { rot: ACROSS },
  );

  // Layered GUNMETAL flank armour cheeks & vertical stiffener ribs.
  for (const s of [-1, 1]) {
    b.solid(
      prism([[-0.46, -0.18], [0.48, -0.18], [0.54, 0.04], [0.48, 0.76], [-0.44, 0.76], [-0.52, 0.06]], 0.14, 0.025),
      GUNMETAL,
      { at: [s * 0.52, 0, 0], rot: ACROSS },
    );
    // Twin vertical reinforcement ribs framing the side exhaust bay.
    b.solid(prism([[-0.06, -0.16], [0.06, -0.16], [0.04, 0.80], [-0.04, 0.80]], 0.08, 0.015), PLATE, {
      at: [s * 0.58, 0, -0.32],
      rot: ACROSS,
    });
    b.solid(prism([[-0.06, -0.16], [0.06, -0.16], [0.04, 0.80], [-0.04, 0.80]], 0.08, 0.015), PLATE, {
      at: [s * 0.58, 0, 0.30],
      rot: ACROSS,
    });

    // Side exhaust vent plenum + 3 angled blast-deflector louver vanes.
    b.solid(prism([[-0.22, -0.16], [0.22, -0.16], [0.22, 0.24], [-0.22, 0.24]], 0.07, 0.012), DARK, {
      at: [s * 0.58, 0.06, 0],
      rot: ACROSS,
    });
    for (let v = 0; v < 3; v++) {
      b.solid(prism([[-0.20, -0.025], [0.20, -0.025], [0.18, 0.025], [-0.18, 0.025]], 0.11, 0.008), STEEL, {
        at: [s * 0.61, -0.04 + v * 0.12, 0],
        rot: [0, Math.PI / 2, s * 0.42],
      });
    }

    // AMBER warning chevrons (three stacked angled hazard bars on upper flank).
    for (let c = 0; c < 3; c++) {
      const cy = 0.42 + c * 0.11;
      b.glow(new THREE.BoxGeometry(0.024, 0.032, 0.16), AMBER, 3.4, {
        at: [s * 0.605, cy, -0.08],
        rot: [0.46, 0, 0],
      });
      b.glow(new THREE.BoxGeometry(0.024, 0.032, 0.16), AMBER, 3.4, {
        at: [s * 0.605, cy, 0.08],
        rot: [-0.46, 0, 0],
      });
    }
  }

  // Forward sloped ballistic shield brow + thin inset RED armed strip + AMBER hazard pair.
  b.solid(prism([[0.46, 0.12], [0.70, 0.18], [0.64, 0.86], [0.42, 0.94]], 0.86, 0.035), PLATE, { rot: ACROSS });
  b.glow(new THREE.BoxGeometry(0.54, 0.032, 0.03), RED, 4.2, { at: [0, 0.80, -0.66] });
  for (const s of [-1, 1]) {
    b.glow(new THREE.BoxGeometry(0.18, 0.034, 0.026), AMBER, 3.5, { at: [s * 0.19, 0.62, -0.67], rot: [0, 0, s * -0.45] });
    b.glow(new THREE.BoxGeometry(0.18, 0.034, 0.026), AMBER, 3.5, { at: [s * 0.19, 0.50, -0.68], rot: [0, 0, s * -0.45] });
  }

  // Rear lower back-blast deflector duct.
  b.solid(prism([[-0.74, -0.22], [-0.54, -0.22], [-0.54, 0.24], [-0.68, 0.16]], 0.72, 0.03), IRON, { rot: ACROSS });
  b.cyl(0.24, 0.28, 0.14, 10, DARK, { at: [0, -0.02, 0.68], rot: [Math.PI / 2, 0, 0] });

  // Upper launch deck collar & recessed circular vertical-launch well.
  b.solid(prism([[-0.46, 0.88], [0.46, 0.88], [0.40, 1.02], [-0.40, 1.02]], 0.94, 0.028), GUNMETAL, { rot: ACROSS });
  b.cyl(0.39, 0.42, 0.12, 16, IRON, { at: [0, 1.01, -0.02] });
  b.cyl(0.34, 0.34, 0.14, 16, DARK, { at: [0, 1.02, -0.02] });
  b.cyl(0.36, 0.36, 0.04, 16, BRASS, { at: [0, 1.08, -0.02] });

  // Visible multi-warhead MIRV bus nose cone seated inside the open vertical cell.
  b.cyl(0.24, 0.30, 0.22, 12, GUNMETAL, { at: [0, 1.08, -0.02] });
  b.cyl(0.06, 0.14, 0.24, 10, PLATE, { at: [0, 1.30, -0.02] });
  b.cyl(0.15, 0.15, 0.04, 10, BRASS, { at: [0, 1.19, -0.02] });
  b.glow(new THREE.CylinderGeometry(0.042, 0.052, 0.03, 8), AMBER, 4.4, { at: [0, 1.42, -0.02] });
  // Six visible peripheral sub-warhead cones arranged around the central bus tip.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    const wx = Math.cos(a) * 0.21;
    const wz = -0.02 + Math.sin(a) * 0.21;
    b.cyl(0.018, 0.064, 0.20, 8, STEEL, { at: [wx, 1.24, wz] });
    b.cyl(0.066, 0.066, 0.03, 8, BRASS, { at: [wx, 1.15, wz] });
    b.glow(new THREE.CylinderGeometry(0.016, 0.022, 0.025, 6), RED, 3.8, { at: [wx, 1.34, wz] });
  }

  // Hinged top blast hatch swung open toward the rear (~58 deg) on twin knuckle barrels + actuator piston.
  for (const s of [-1, 1]) {
    b.cyl(0.055, 0.055, 0.16, 10, STEEL, { at: [s * 0.28, 1.03, 0.44], rot: [0, 0, Math.PI / 2] });
    b.cyl(0.035, 0.035, 0.20, 8, BRASS, { at: [s * 0.28, 1.03, 0.44], rot: [0, 0, Math.PI / 2] });
  }
  b.solid(
    prism([[-0.42, -0.04], [0.42, -0.04], [0.36, 0.07], [-0.36, 0.07]], 0.86, 0.025),
    OBSIDIAN,
    { at: [0, 1.38, 0.64], rot: [-1.02, Math.PI / 2, 0] },
  );
  b.solid(
    prism([[-0.34, -0.05], [0.34, -0.05], [0.30, -0.01], [-0.30, -0.01]], 0.72, 0.015),
    PLATE,
    { at: [0, 1.37, 0.60], rot: [-1.02, Math.PI / 2, 0] },
  );
  // Hydraulic hatch actuator strut.
  b.cyl(0.028, 0.034, 0.42, 8, STEEL, { at: [0, 1.15, 0.56], rot: [-0.48, 0, 0] });
}

export const SHOULDER_MIRV = buildMirv;
