/**
 * Metal Storm Pod shoulder weapon 3D model (`storm`).
 * Sculpted Bureau-metal stacked 16-barrel hyper-velocity pod: wide bevelled armoured housing,
 * dense 4x4 grid of 16 recessed dark steel barrel bores, glowing amber/red flank capacitor bus-bars,
 * and a heavy gimbal yoke with dual hydraulic recoil dampener struts at the base.
 */
import * as THREE from 'three';
import type { ModelBuilder } from '../../progression/modelkit';
import {
  ACROSS, ALONG_Z, AMBER, BRASS, DARK, FLAT, GUNMETAL, IRON, OBSIDIAN, PLATE, RED, STEEL,
  ngon, prism, type ShoulderModelBuilder,
} from './shared';

/** Builds the Metal Storm Pod in local mount space (origin = shoulder pylon mount, -Z = forward). */
export function buildStormPod(b: ModelBuilder): void {
  // ---- Base pedestal, gimbal yoke & hydraulic recoil dampener struts ----
  // Octagonal turret pedestal collar seated into the Frame's shoulder hardpoint.
  b.solid(prism(ngon(0.32, 8, Math.PI / 8), 0.14, 0.02), IRON, { at: [0, -0.56, 0.06], rot: FLAT });
  b.cyl(0.18, 0.24, 0.22, 10, GUNMETAL, { at: [0, -0.44, 0.06] });

  // Dual sculpted gimbal yoke arms cradling the pod's trunnion axis.
  for (const s of [-1, 1]) {
    b.solid(
      prism([[-0.22, -0.48], [0.24, -0.48], [0.2, -0.18], [-0.16, -0.18]], 0.14, 0.025),
      GUNMETAL,
      { at: [s * 0.52, 0, 0.06], rot: ACROSS },
    );
    // Horizontal elevation trunnion drum & brass retaining cap.
    b.cyl(0.13, 0.13, 0.24, 12, STEEL, { at: [s * 0.62, -0.22, 0.06], rot: [0, 0, Math.PI / 2] });
    b.cyl(0.08, 0.08, 0.06, 10, BRASS, { at: [s * 0.74, -0.22, 0.06], rot: [0, 0, Math.PI / 2] });

    // Angled hydraulic recoil dampener strut braced from rear yoke to pod recoil bulkhead.
    b.cyl(0.055, 0.065, 0.34, 8, IRON, { at: [s * 0.36, -0.39, 0.36], rot: [-0.62, 0, 0] });
    b.cyl(0.034, 0.034, 0.42, 8, STEEL, { at: [s * 0.36, -0.33, 0.28], rot: [-0.62, 0, 0] });
    b.cyl(0.068, 0.068, 0.06, 8, BRASS, { at: [s * 0.36, -0.35, 0.31], rot: [-0.62, 0, 0] });
  }
  // Cross-brace tie bar linking the yoke arms underneath.
  b.box(1.02, 0.12, 0.28, OBSIDIAN, { at: [0, -0.46, 0.06] });

  // ---- Wide bevelled Bureau-metal armoured housing ----
  // Core wide chamfered chassis (u = -Z forward, v = +Y up).
  b.solid(
    prism([
      [-0.72, -0.32], [0.78, -0.32], [0.88, -0.18], [0.88, 0.28],
      [0.74, 0.44], [-0.58, 0.44], [-0.78, 0.26], [-0.78, -0.18],
    ], 1.24, 0.05),
    OBSIDIAN,
    { rot: ACROSS },
  );

  // Sloped upper carapace cowling & overhanging front ballistic brow.
  b.solid(
    prism([
      [-0.58, 0.36], [0.82, 0.34], [0.94, 0.42], [0.68, 0.54], [-0.5, 0.52], [-0.66, 0.42],
    ], 1.08, 0.03),
    PLATE,
    { rot: ACROSS },
  );

  // Lower bevelled chin skid & recoil buffer keel.
  b.solid(
    prism([[-0.62, -0.38], [0.76, -0.36], [0.86, -0.26], [-0.56, -0.26]], 1.04, 0.025),
    GUNMETAL,
    { rot: ACROSS },
  );

  // Rear solid-state capacitor heatsink manifold & cooling fins.
  b.solid(
    prism([[-0.88, -0.22], [-0.68, -0.24], [-0.68, 0.3], [-0.84, 0.28]], 1.06, 0.03),
    GUNMETAL,
    { rot: ACROSS },
  );
  for (let i = 0; i < 4; i++) {
    b.box(0.94, 0.045, 0.16, i % 2 ? STEEL : IRON, { at: [0, -0.14 + i * 0.125, 0.86] });
  }

  // Top-mounted target-painter laser sensor pod (for 8-target sweep lock).
  b.solid(
    prism([[0.22, 0.48], [0.76, 0.48], [0.82, 0.58], [0.68, 0.68], [0.28, 0.68]], 0.36, 0.02),
    GUNMETAL,
    { rot: ACROSS },
  );
  b.cyl(0.052, 0.056, 0.08, 10, DARK, { at: [0, 0.58, -0.82], rot: ALONG_Z });
  b.glow(new THREE.CylinderGeometry(0.034, 0.034, 0.025, 10), RED, 4.4, { at: [0, 0.58, -0.86], rot: ALONG_Z });

  // ---- Flank capacitor bus-bar bays (glowing AMBER / RED inset rails) ----
  for (const s of [-1, 1]) {
    // Chamfered side cheek armour framing the recessed capacitor trough.
    b.solid(
      prism([[-0.56, -0.26], [0.62, -0.26], [0.7, -0.12], [0.7, 0.22], [0.56, 0.32], [-0.52, 0.32], [-0.62, 0.16]], 0.12, 0.02),
      GUNMETAL,
      { at: [s * 0.63, 0.02, 0], rot: ACROSS },
    );
    // Dark recessed bus-bar trough behind the glowing rails.
    b.box(0.05, 0.36, 1.06, DARK, { at: [s * 0.68, 0.02, -0.02] });

    // Twin parallel high-voltage AMBER capacitor bus-bars + upper RED charge indicator line.
    b.glow(new THREE.BoxGeometry(0.028, 0.042, 0.98), AMBER, 3.8, { at: [s * 0.71, -0.06, -0.02] });
    b.glow(new THREE.BoxGeometry(0.028, 0.042, 0.98), AMBER, 3.8, { at: [s * 0.71, 0.06, -0.02] });
    b.glow(new THREE.BoxGeometry(0.024, 0.024, 0.86), RED, 4.2, { at: [s * 0.705, 0.17, -0.04] });

    // Brass bus-bar clamp bridges strapping the rails to the chassis.
    for (let k = 0; k < 4; k++) {
      const bz = -0.36 + k * 0.24;
      b.box(0.06, 0.32, 0.045, BRASS, { at: [s * 0.705, 0.0, bz] });
    }
  }

  // ---- Dense 4x4 grid of 16 recessed dark steel barrel bores ----
  // Deep recessed ballistic face plate & protective muzzle cowling lips.
  b.box(1.06, 0.74, 0.08, DARK, { at: [0, 0.03, -0.84] });
  // Vertical & horizontal heat-sink separator vanes dividing the 4x4 barrel matrix.
  b.box(1.04, 0.028, 0.18, IRON, { at: [0, 0.03, -0.9] });
  b.box(0.028, 0.72, 0.18, IRON, { at: [0, 0.03, -0.9] });

  for (let row = 0; row < 4; row++) {
    const by = (row - 1.5) * 0.165 + 0.03;
    for (let col = 0; col < 4; col++) {
      const bx = (col - 1.5) * 0.235;
      // Outer hyper-velocity steel barrel sleeve.
      b.cyl(0.062, 0.066, 0.24, 10, STEEL, { at: [bx, by, -0.92], rot: ALONG_Z });
      // Stepped gunmetal muzzle reinforcement collar.
      b.cyl(0.07, 0.07, 0.045, 10, GUNMETAL, { at: [bx, by, -0.98], rot: ALONG_Z });
      // Deep recessed dark inner bore.
      b.cyl(0.042, 0.042, 0.06, 8, DARK, { at: [bx, by, -1.02], rot: ALONG_Z });
    }
  }

  // Thin forward amber charge-status strip under the upper ballistic brow.
  b.glow(new THREE.BoxGeometry(0.92, 0.028, 0.028), AMBER, 4.0, { at: [0, 0.42, -0.88] });
}

/** Named export matching the Lane E specification (`ShoulderModelBuilder`). */
export const SHOULDER_STORM: ShoulderModelBuilder = buildStormPod;
