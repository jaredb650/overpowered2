/**
 * Autonomous Laser Orbit Drone Dock 3D model (`laserOrbit`).
 * Sleek angled twin-bay magnetic drone dock with glowing dock clamps, brass inductive charge coils,
 * and folded diamond winglet silhouettes.
 */
import * as THREE from 'three';
import type { ModelBuilder } from '../../progression/modelkit';
import {
  ACROSS, ALONG_Z, AMBER, BRASS, DARK, FLAT, GUNMETAL, IRON, OBSIDIAN, PLATE, RED, STEEL,
  ngon, prism, type ShoulderModelBuilder,
} from './shared';

/** Builds the Autonomous Laser Orbit Drone Dock in local mount space (origin = shoulder pylon, -Z = forward). */
export function buildLaserOrbit(b: ModelBuilder): void {
  // ---- Articulated base mount & canted spine pylon ----
  b.solid(prism(ngon(0.28, 8, Math.PI / 8), 0.12, 0.02), IRON, { at: [0, -0.46, 0.06], rot: FLAT });
  b.cyl(0.13, 0.17, 0.34, 10, STEEL, { at: [0, -0.28, 0.08], rot: [-0.18, 0, 0] });

  // Swept central aero-spine pylon holding both magnetic bays.
  b.solid(
    prism([
      [-0.56, -0.18], [0.52, -0.18], [0.76, 0.06], [0.58, 0.48],
      [0.08, 0.72], [-0.42, 0.62], [-0.68, 0.16],
    ], 0.34, 0.035),
    OBSIDIAN,
    { rot: ACROSS },
  );

  // Dorsal fairing ridge & forward sensor fin.
  b.solid(
    prism([[-0.38, 0.54], [0.46, 0.44], [0.64, 0.56], [0.12, 0.82], [-0.32, 0.72]], 0.22, 0.02),
    PLATE,
    { rot: ACROSS },
  );

  // Rear inductive capacitor core & brass cooling coils.
  b.cyl(0.14, 0.16, 0.42, 10, GUNMETAL, { at: [0, 0.24, 0.56], rot: ALONG_Z });
  for (const cz of [0.44, 0.56, 0.68]) {
    b.cyl(0.165, 0.165, 0.04, 10, BRASS, { at: [0, 0.24, cz], rot: ALONG_Z });
  }
  b.glow(new THREE.BoxGeometry(0.06, 0.34, 0.03), AMBER, 3.8, { at: [0, 0.26, 0.78] });

  // ---- Twin angled magnetic launch bays (left & right winglet drone cradles) ----
  for (const s of [-1, 1]) {
    const bx = s * 0.34;
    const tiltZ = -s * 0.24;

    // Angled bay cradle wing-shroud.
    b.solid(
      prism([[-0.44, -0.14], [0.48, -0.14], [0.64, 0.1], [0.36, 0.52], [-0.32, 0.48], [-0.52, 0.12]], 0.1, 0.02),
      GUNMETAL,
      { at: [bx, 0.22, -0.04], rot: [0, Math.PI / 2, tiltZ] },
    );

    // Magnetic dock rails & glowing inductive lock clamps.
    b.box(0.08, 0.08, 0.82, IRON, { at: [s * 0.26, 0.48, -0.06], rot: [0, 0, tiltZ] });
    b.box(0.08, 0.08, 0.82, IRON, { at: [s * 0.26, 0.02, -0.06], rot: [0, 0, tiltZ] });
    b.glow(new THREE.BoxGeometry(0.03, 0.032, 0.72), RED, 4.2, { at: [s * 0.32, 0.45, -0.08] });
    b.glow(new THREE.BoxGeometry(0.03, 0.032, 0.72), AMBER, 3.8, { at: [s * 0.32, 0.05, -0.08] });

    // Brass magnetic anchor clamps fore and aft.
    for (const cz of [-0.34, 0.22]) {
      b.box(0.14, 0.12, 0.08, BRASS, { at: [s * 0.3, 0.25, cz] });
    }

    // Docked faceted diamond gun-drone silhouette tucked into each bay.
    b.solid(
      prism([[-0.32, 0], [0.04, 0.22], [0.46, 0.04], [0.04, -0.18]], 0.14, 0.02),
      PLATE,
      { at: [s * 0.42, 0.26, -0.12], rot: [0, Math.PI / 2, tiltZ] },
    );
    // Drone swept outer winglet blade.
    b.solid(
      prism([[-0.22, -0.04], [0.3, -0.04], [0.16, 0.34], [-0.14, 0.28]], 0.045, 0.012),
      OBSIDIAN,
      { at: [s * 0.52, 0.32, -0.1], rot: [0, Math.PI / 2, tiltZ * 1.4] },
    );
    // Drone recessed emitter nozzle & glowing optic core.
    b.cyl(0.045, 0.055, 0.22, 8, STEEL, { at: [s * 0.42, 0.24, -0.58], rot: ALONG_Z });
    b.cyl(0.028, 0.028, 0.05, 8, DARK, { at: [s * 0.42, 0.24, -0.68], rot: ALONG_Z });
    b.glow(new THREE.OctahedronGeometry(0.052, 0), RED, 4.5, { at: [s * 0.46, 0.26, -0.26] });
  }

  // Forward telemetry optic bar on spine nose.
  b.box(0.22, 0.14, 0.12, DARK, { at: [0, 0.32, -0.64] });
  b.glow(new THREE.BoxGeometry(0.18, 0.032, 0.028), AMBER, 4.4, { at: [0, 0.32, -0.71] });
}

export const SHOULDER_LASER_ORBIT: ShoulderModelBuilder = buildLaserOrbit;
