/**
 * Twin Shoulder Grenade Cannon 3D model (`twinGrenade`).
 * Heavy twin-tube side-by-side 80 mm breech cannon on an elevating trunnion yoke,
 * dual perforated muzzle brakes, twin curved side drum feeds, and brass pressure vent rings.
 */
import * as THREE from 'three';
import type { ModelBuilder } from '../../progression/modelkit';
import {
  ACROSS, ALONG_Z, AMBER, BRASS, DARK, FLAT, GUNMETAL, IRON, OBSIDIAN, PLATE, RED, STEEL,
  ngon, prism, type ShoulderModelBuilder,
} from './shared';

/** Builds the Twin 80 mm Shoulder Grenade Cannon in local mount space (origin = shoulder pylon, -Z = forward). */
export function buildTwinGrenade(b: ModelBuilder): void {
  // ---- Base turret pedestal & elevating trunnion yoke ----
  b.solid(prism(ngon(0.3, 8, Math.PI / 8), 0.14, 0.02), IRON, { at: [0, -0.48, 0.08], rot: FLAT });
  b.cyl(0.16, 0.21, 0.22, 10, GUNMETAL, { at: [0, -0.36, 0.08] });

  // Heavy elevating yoke cheeks & brass trunnion pivot drums.
  for (const s of [-1, 1]) {
    b.solid(
      prism([[-0.22, -0.38], [0.24, -0.38], [0.22, 0.02], [-0.18, 0.02]], 0.12, 0.02),
      GUNMETAL,
      { at: [s * 0.46, 0, 0.08], rot: ACROSS },
    );
    b.cyl(0.11, 0.11, 0.2, 12, STEEL, { at: [s * 0.54, -0.1, 0.08], rot: [0, 0, Math.PI / 2] });
    b.cyl(0.068, 0.068, 0.06, 10, BRASS, { at: [s * 0.65, -0.1, 0.08], rot: [0, 0, Math.PI / 2] });
    // Rear hydraulic elevation strut.
    b.cyl(0.044, 0.052, 0.36, 8, IRON, { at: [s * 0.28, -0.26, 0.36], rot: [-0.55, 0, 0] });
    b.cyl(0.028, 0.028, 0.42, 8, STEEL, { at: [s * 0.28, -0.18, 0.29], rot: [-0.55, 0, 0] });
  }
  b.box(0.86, 0.1, 0.26, OBSIDIAN, { at: [0, -0.34, 0.08] });

  // ---- Main twin-breech armoured receiver housing ----
  b.solid(
    prism([
      [-0.68, -0.18], [0.58, -0.18], [0.68, -0.04], [0.68, 0.34],
      [0.52, 0.46], [-0.56, 0.46], [-0.74, 0.28], [-0.74, -0.04],
    ], 0.92, 0.045),
    OBSIDIAN,
    { rot: ACROSS },
  );

  // Sloped upper ballistic breech hood & ammo mode indicator strip.
  b.solid(
    prism([[-0.52, 0.4], [0.56, 0.38], [0.66, 0.48], [0.42, 0.56], [-0.44, 0.56]], 0.82, 0.028),
    PLATE,
    { rot: ACROSS },
  );
  b.glow(new THREE.BoxGeometry(0.68, 0.028, 0.032), AMBER, 3.8, { at: [0, 0.47, -0.66] });

  // Rear twin brass-capped recoil breech blocks.
  for (const s of [-1, 1]) {
    b.cyl(0.14, 0.14, 0.22, 10, GUNMETAL, { at: [s * 0.24, 0.16, 0.72], rot: ALONG_Z });
    b.cyl(0.095, 0.105, 0.07, 10, BRASS, { at: [s * 0.24, 0.16, 0.84], rot: ALONG_Z });
  }

  // ---- Dual curved side-mounted drum feed magazines ----
  for (const s of [-1, 1]) {
    // Feed throat chute linking drum to breech.
    b.solid(
      prism([[-0.22, -0.1], [0.22, -0.1], [0.26, 0.18], [-0.26, 0.18]], 0.18, 0.02),
      IRON,
      { at: [s * 0.5, 0.08, 0.18], rot: ACROSS },
    );
    // Heavy octagonal rotary grenade drum.
    b.solid(
      prism(ngon(0.28, 10), 0.32, 0.025),
      GUNMETAL,
      { at: [s * 0.62, 0.04, 0.18], rot: [0, 0, Math.PI / 2] },
    );
    // Outer drum plate & brass windup hub.
    b.cyl(0.21, 0.21, 0.05, 10, PLATE, { at: [s * 0.78, 0.04, 0.18], rot: [0, 0, Math.PI / 2] });
    b.cyl(0.09, 0.09, 0.08, 8, BRASS, { at: [s * 0.81, 0.04, 0.18], rot: [0, 0, Math.PI / 2] });
    // Drum readiness status pip.
    b.glow(new THREE.BoxGeometry(0.026, 0.14, 0.04), RED, 3.6, { at: [s * 0.79, 0.18, -0.02] });
  }

  // ---- Twin side-by-side 80 mm heavy cannons, brass vent rings & perforated muzzle brakes ----
  for (const s of [-1, 1]) {
    const bx = s * 0.24;
    const by = 0.16;

    // Stepped recoil jacket & hydraulic slide sleeve.
    b.cyl(0.145, 0.155, 0.46, 12, PLATE, { at: [bx, by, -0.78], rot: ALONG_Z });
    b.cyl(0.12, 0.13, 0.96, 12, GUNMETAL, { at: [bx, by, -1.22], rot: ALONG_Z });

    // Brass pressure vent collars along each barrel.
    for (const vz of [-0.94, -1.16, -1.38]) {
      b.cyl(0.136, 0.136, 0.055, 12, BRASS, { at: [bx, by, vz], rot: ALONG_Z });
    }

    // Underslung recoil recuperator rod under each tube.
    b.cyl(0.042, 0.042, 0.82, 8, STEEL, { at: [bx, by - 0.15, -1.04], rot: ALONG_Z });

    // Heavy bevelled twin-baffle perforated muzzle brake.
    b.solid(
      prism(ngon(0.155, 8, Math.PI / 8), 0.34, 0.02),
      OBSIDIAN,
      { at: [bx, by, -1.78] },
    );
    // Dark side vent slots on muzzle brake.
    b.box(0.32, 0.075, 0.08, DARK, { at: [bx, by, -1.72] });
    b.box(0.32, 0.075, 0.08, DARK, { at: [bx, by, -1.85] });
    // Recessed 80 mm dark inner bore.
    b.cyl(0.095, 0.095, 0.08, 10, DARK, { at: [bx, by, -1.94], rot: ALONG_Z });
  }

  // Central bridge clamp tying the twin barrels together.
  b.solid(
    prism([[-0.32, -0.14], [0.32, -0.14], [0.28, 0.14], [-0.28, 0.14]], 0.14, 0.02),
    PLATE,
    { at: [0, 0.16, -1.06] },
  );
  // Thin glowing fire-control optic perched between the barrels.
  b.box(0.12, 0.09, 0.24, IRON, { at: [0, 0.32, -0.78] });
  b.glow(new THREE.BoxGeometry(0.07, 0.036, 0.024), RED, 4.2, { at: [0, 0.32, -0.91] });
}

export const SHOULDER_TWIN_GRENADE: ShoulderModelBuilder = buildTwinGrenade;
