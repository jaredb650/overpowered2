/**
 * 30 mm three-barrel Explosive Rotary Cannon arm model (`vulcan30L/R`).
 *
 * Sculpted Bureau-metal assembly drawn natively for the left arm (`+X` inboard toward cockpit, `-X` outboard, `-Z` forward);
 * `ArmRack` mirrors it across X when fitted on the right arm so the fat shell feed always faces inboard.
 *
 * Barrel cluster inspired by the Trommel's 12 mm three-barrel `trommel12` rechamber (GAU-19 rounded-triangle layout:
 * two heavy barrels on top, one below at rest), scaled up to mech-grade 30 mm ordnance with perforated trefoil clamps,
 * a hollow rounded-triangle muzzle shroud, and a belted brass 30 mm shell feed chute.
 *
 * `moving` hooks directly into `Gun.turn(radians)` (barrel cluster spin around Z) and `Gun.recoil(metres)` (recoil slide).
 */
import * as THREE from 'three';
import { TAU } from '../../core/math';
import type { GunSpec } from '../../vehicles/guns';
import { ACROSS, ALONG_Z, AMBER, BRASS, DARK, GUNMETAL, IRON, OBSIDIAN, PLATE, RED, STEEL, prism } from './shared';

const BARRELS = 3;
/** Radial distance from rotor axis to each 30 mm barrel centre. */
const CLUSTER_R = 0.168;
/** Outer radius of each heavy 30 mm barrel along its main run. */
const BARREL_R = 0.094;
/** Two barrels on top and one below at rest: flat across the top, matching GAU-19 / `trommel12`. */
const barrelAngle = (i: number): number => -Math.PI / 2 + (i / BARRELS) * TAU;

/** Counter-clockwise rounded triangle tangent to circles of `cornerR` centred on the three barrels. */
function trefoilShape(clusterR: number, cornerR: number): THREE.Shape {
  const shape = new THREE.Shape();
  for (let i = 0; i < BARRELS; i++) {
    const a = barrelAngle(i);
    shape.absarc(Math.cos(a) * clusterR, Math.sin(a) * clusterR, cornerR, a - Math.PI / 3, a + Math.PI / 3, false);
  }
  shape.closePath();
  return shape;
}

/** Clockwise rounded-triangle inner cutout path for hollow muzzle sleeves. */
function trefoilHole(clusterR: number, cornerR: number): THREE.Path {
  const path = new THREE.Path();
  for (let i = BARRELS - 1; i >= 0; i--) {
    const a = barrelAngle(i);
    path.absarc(Math.cos(a) * clusterR, Math.sin(a) * clusterR, cornerR, a + Math.PI / 3, a - Math.PI / 3, true);
  }
  path.closePath();
  return path;
}

function circleHole(x: number, y: number, r: number): THREE.Path {
  const path = new THREE.Path();
  path.absarc(x, y, r, 0, TAU, true);
  return path;
}

function extrudeCentered(shape: THREE.Shape, depth: number, bevel: number): THREE.BufferGeometry {
  const core = Math.max(0.01, depth - bevel * 2);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: core,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 1,
    curveSegments: 8,
  });
  return geo.translate(0, 0, -core / 2);
}

/** Perforated bevelled rounded-triangle barrel clamp plate with 3 barrel bores and 3 flat ventilation holes. */
function trefoilClamp(depth: number, bevel: number, cornerR: number, barrelHoleR: number, ventHoleR = 0.02): THREE.BufferGeometry {
  const shape = trefoilShape(CLUSTER_R, cornerR);
  for (let i = 0; i < BARRELS; i++) {
    const a = barrelAngle(i);
    shape.holes.push(circleHole(Math.cos(a) * CLUSTER_R, Math.sin(a) * CLUSTER_R, barrelHoleR));
    if (ventHoleR > 0) {
      const va = a + Math.PI / 3;
      shape.holes.push(circleHole(Math.cos(va) * 0.155, Math.sin(va) * 0.155, ventHoleR));
    }
  }
  return extrudeCentered(shape, depth, bevel);
}

/** Hollow rounded-triangle muzzle shroud / flash hider (GAU-19 style). */
function trefoilSleeve(depth: number, bevel: number, outerCornerR: number, innerCornerR: number): THREE.BufferGeometry {
  const shape = trefoilShape(CLUSTER_R, outerCornerR);
  shape.holes.push(trefoilHole(CLUSTER_R, innerCornerR));
  return extrudeCentered(shape, depth, bevel);
}

/** Rear round rotor drive disc with 3 barrel bores. */
function rotorDisc(radius: number, depth: number, bevel: number, barrelHoleR: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, radius, 0, TAU, false);
  for (let i = 0; i < BARRELS; i++) {
    const a = barrelAngle(i);
    shape.holes.push(circleHole(Math.cos(a) * CLUSTER_R, Math.sin(a) * CLUSTER_R, barrelHoleR));
  }
  return extrudeCentered(shape, depth, bevel);
}

export const VULCAN30_ARM: GunSpec = {
  name: 'frame-vulcan30',
  build: b => {
    // Heavy chamfered main receiver housing (+u forward along -Z).
    b.solid(
      prism(
        [[-1.18, -0.36], [0.54, -0.34], [0.74, -0.14], [0.74, 0.22], [0.42, 0.44], [-0.98, 0.44], [-1.24, 0.18]],
        0.84,
        0.055,
      ),
      OBSIDIAN,
      { rot: ACROSS },
    );

    // Sloped upper armour cowling, central recoil spine, and recessed heat-vent louver fins.
    b.solid(
      prism([[-0.94, 0.4], [0.48, 0.4], [0.64, 0.24], [0.28, 0.56], [-0.82, 0.56]], 0.76, 0.035),
      PLATE,
      { rot: ACROSS },
    );
    b.solid(
      prism([[-0.76, 0.53], [0.34, 0.53], [0.42, 0.62], [-0.66, 0.62]], 0.28, 0.02),
      GUNMETAL,
      { rot: ACROSS },
    );
    for (let i = 0; i < 4; i++) {
      const z = -0.16 + i * 0.24;
      b.solid(prism([[-0.06, -0.02], [0.06, -0.02], [0.04, 0.04], [-0.04, 0.04]], 0.64, 0.008), IRON, {
        at: [0, 0.56, z],
        rot: ACROSS,
      });
    }
    // Subtle inset amber heat-vent slits across the rear upper deck.
    for (let i = 0; i < 3; i++) {
      b.glow(new THREE.BoxGeometry(0.46, 0.016, 0.028), AMBER, 3.0, { at: [0, 0.565, 0.12 + i * 0.24] });
    }

    // Outboard (-X) heavy forearm shield plate & rotary electric drive motor pod.
    b.solid(
      prism([[-0.96, -0.28], [0.58, -0.24], [0.7, 0.04], [0.42, 0.3], [-0.84, 0.32]], 0.2, 0.035),
      GUNMETAL,
      { at: [-0.48, 0.02, -0.02], rot: ACROSS },
    );
    b.solid(
      prism([[-0.68, -0.08], [0.44, -0.06], [0.52, 0.1], [-0.6, 0.14]], 0.08, 0.02),
      PLATE,
      { at: [-0.58, 0.04, -0.02], rot: ACROSS },
    );
    // Underslung outboard electric rotor drive motor.
    b.cyl(0.22, 0.24, 0.78, 14, IRON, { at: [-0.46, -0.24, 0.18], rot: ALONG_Z });
    b.cyl(0.18, 0.2, 0.14, 12, STEEL, { at: [-0.46, -0.24, -0.24], rot: ALONG_Z });
    b.cyl(0.24, 0.24, 0.06, 14, BRASS, { at: [-0.46, -0.24, 0.04], rot: ALONG_Z });

    // Inboard (+X) fat 30 mm ammo drum & curved belted shell feed chute (visible from cockpit!).
    b.cyl(0.36, 0.36, 0.74, 16, GUNMETAL, { at: [0.56, -0.32, 0.36], rot: ALONG_Z });
    b.cyl(0.38, 0.38, 0.08, 16, IRON, { at: [0.56, -0.32, 0.02], rot: ALONG_Z });
    b.cyl(0.38, 0.38, 0.08, 16, IRON, { at: [0.56, -0.32, 0.7], rot: ALONG_Z });
    b.cyl(0.15, 0.15, 0.82, 12, STEEL, { at: [0.56, -0.32, 0.36], rot: ALONG_Z });
    b.solid(
      prism([[-0.22, -0.2], [0.24, -0.2], [0.3, 0.16], [-0.14, 0.22]], 0.44, 0.025),
      PLATE,
      { at: [0.48, -0.02, 0.16], rot: [0, Math.PI / 2, -0.38] },
    );
    // Feed throat shroud rails guiding the 30 mm belt into the inboard breech.
    for (const dz of [-0.22, 0.22]) {
      b.solid(
        prism([[-0.05, -0.26], [0.05, -0.26], [0.07, 0.24], [-0.07, 0.24]], 0.06, 0.012),
        GUNMETAL,
        { at: [0.48, 0.0, 0.14 + dz], rot: [0, 0, 0.44] },
      );
    }
    // Exposed belted 30 mm cartridges curving up the inboard feed chute (brass cases, steel projectiles, dark links).
    for (let i = 0; i < 7; i++) {
      const t = i / 6;
      const x = 0.62 - t * 0.24 + Math.sin(t * Math.PI) * 0.05;
      const y = -0.22 + t * 0.38;
      const z = 0.26 - t * 0.18;
      const tilt = 0.52 - t * 0.24;
      // Fat 30 mm brass casing + projectile tip + steel belt link.
      b.cyl(0.036, 0.038, 0.24, 8, BRASS, { at: [x, y, z + 0.04], rot: [Math.PI / 2, 0, tilt] });
      b.cyl(0.022, 0.034, 0.12, 8, STEEL, { at: [x, y, z - 0.12], rot: [Math.PI / 2, 0, tilt] });
      b.cyl(0.042, 0.042, 0.06, 8, i % 2 === 0 ? DARK : IRON, { at: [x, y, z + 0.05], rot: [Math.PI / 2, 0, tilt] });
    }

    // Front machined bearing collar + stepped recoil guide housing.
    b.cyl(0.38, 0.42, 0.26, 18, STEEL, { at: [0, 0, -0.72], rot: ALONG_Z });
    b.cyl(0.35, 0.37, 0.16, 18, OBSIDIAN, { at: [0, 0, -0.9], rot: ALONG_Z });
    b.cyl(0.3, 0.3, 0.1, 16, IRON, { at: [0, 0, -0.99], rot: ALONG_Z });

    // Twin hydraulic recoil recuperators beneath the front bearing.
    for (const s of [-1, 1]) {
      b.cyl(0.08, 0.08, 0.78, 10, IRON, { at: [s * 0.26, -0.32, -0.74], rot: ALONG_Z });
      b.cyl(0.052, 0.052, 0.42, 8, STEEL, { at: [s * 0.26, -0.32, -1.24], rot: ALONG_Z });
      b.cyl(0.09, 0.09, 0.05, 10, BRASS, { at: [s * 0.26, -0.32, -1.12], rot: ALONG_Z });
    }

    // Rear heavy elbow gimbal yoke.
    for (const s of [-1, 1]) {
      b.solid(
        prism([[-0.22, -0.18], [0.22, -0.18], [0.28, 0.22], [-0.18, 0.26]], 0.12, 0.025),
        GUNMETAL,
        { at: [s * 0.26, 0.16, 0.94], rot: ACROSS },
      );
    }
    b.cyl(0.3, 0.3, 0.62, 14, STEEL, { at: [0, 0.18, 1.0], rot: [0, 0, Math.PI / 2] });
    b.cyl(0.22, 0.22, 0.68, 12, IRON, { at: [0, 0.18, 1.0], rot: [0, 0, Math.PI / 2] });

    // Subtle inset heat-vent & status telemetry strip along the inboard upper cheek (cockpit-facing).
    b.solid(prism([[-0.35, -0.045], [0.35, -0.045], [0.38, 0.045], [-0.38, 0.045]], 0.04, 0.01), DARK, {
      at: [0.42, 0.24, -0.08],
      rot: ACROSS,
    });
    b.glow(new THREE.BoxGeometry(0.024, 0.03, 0.64), AMBER, 3.6, { at: [0.44, 0.24, -0.08] });
    b.glow(new THREE.BoxGeometry(0.024, 0.12, 0.036), RED, 3.5, { at: [0.44, 0.06, -0.46] });
  },

  moving: b => {
    // Central heavy rotor spindle shaft + front hex spinner nut.
    b.cyl(0.062, 0.068, 2.02, 10, IRON, { at: [0, 0, -1.68], rot: ALONG_Z });
    b.cyl(0.078, 0.064, 0.14, 6, STEEL, { at: [0, 0, -2.72], rot: ALONG_Z });

    // Three heavy 30 mm barrels arranged in a tight GAU-19 rounded triangle (2 top, 1 bottom at rest).
    for (let i = 0; i < BARRELS; i++) {
      const a = barrelAngle(i);
      const bx = Math.cos(a) * CLUSTER_R;
      const by = Math.sin(a) * CLUSTER_R;

      // Reinforced breech sleeve.
      b.cyl(0.106, 0.112, 0.44, 12, GUNMETAL, { at: [bx, by, -0.96], rot: ALONG_Z });
      // Brass witness / chamber pressure ring (echoes trommel12's heavy-calibre brass mark).
      b.cyl(0.114, 0.114, 0.065, 12, BRASS, { at: [bx, by, -1.2], rot: ALONG_Z });
      // Main heavy 30 mm tapered cannon barrel.
      b.cyl(BARREL_R - 0.005, BARREL_R, 1.48, 12, STEEL, { at: [bx, by, -1.96], rot: ALONG_Z });
      // Crowned muzzle collar & deep recessed dark bore.
      b.cyl(0.098, 0.094, 0.1, 12, IRON, { at: [bx, by, -2.68], rot: ALONG_Z });
      b.cyl(0.058, 0.058, 0.14, 10, DARK, { at: [bx, by, -2.71], rot: ALONG_Z });
    }

    // Rear circular rotor drive plate seated at the bearing mouth + 3 hex clamping bolts.
    b.solid(rotorDisc(0.32, 0.11, 0.014, 0.124), GUNMETAL, { at: [0, 0, -0.96] });
    for (let i = 0; i < BARRELS; i++) {
      const a = barrelAngle(i) + Math.PI / 3;
      b.cyl(0.032, 0.032, 0.05, 6, STEEL, { at: [Math.cos(a) * 0.21, Math.sin(a) * 0.21, -1.03], rot: ALONG_Z });
    }

    // Two heavy perforated rounded-triangle barrel stabilizer clamp rings.
    for (const z of [-1.48, -2.1]) {
      b.solid(trefoilClamp(0.12, 0.012, 0.138, BARREL_R + 0.016, 0.02), PLATE, { at: [0, 0, z] });
      b.solid(trefoilClamp(0.04, 0.008, 0.144, BARREL_R + 0.014, 0), IRON, { at: [0, 0, z + 0.065] });
      for (let i = 0; i < BARRELS; i++) {
        const a = barrelAngle(i) + Math.PI / 3;
        b.cyl(0.024, 0.024, 0.15, 6, STEEL, { at: [Math.cos(a) * 0.195, Math.sin(a) * 0.195, z], rot: ALONG_Z });
      }
    }

    // Sculpted GAU-19-inspired hollow rounded-triangle muzzle shroud / flash hider encircling all three muzzles.
    const shroudBack = -2.5;
    const shroudMouth = -2.86;
    const shroudMid = (shroudBack + shroudMouth) / 2;
    const shroudLen = shroudBack - shroudMouth;
    b.solid(trefoilSleeve(shroudLen, 0.012, 0.15, 0.122), OBSIDIAN, { at: [0, 0, shroudMid] });
    // Bright machined steel chamfered mouth lip so the hollow trefoil shroud reads crisply.
    b.solid(trefoilSleeve(0.048, 0.008, 0.154, 0.118), STEEL, { at: [0, 0, shroudMouth + 0.024] });
    // Recessed internal bulkhead ring + 3 radial flash-divider fins inside the shroud.
    b.solid(trefoilClamp(0.07, 0.006, 0.124, BARREL_R + 0.008, 0), GUNMETAL, { at: [0, 0, shroudBack - 0.035] });
    const flatDist = CLUSTER_R * 0.5 + 0.154;
    for (let i = 0; i < BARRELS; i++) {
      const a = barrelAngle(i) + Math.PI / 3;
      const c = Math.cos(a);
      const s = Math.sin(a);
      // Radial fin between barrels inside the flash hider.
      b.solid(prism([[-0.09, -0.014], [0.09, -0.014], [0.08, 0.014], [-0.08, 0.014]], 0.24, 0.004), IRON, {
        at: [c * 0.11, s * 0.11, shroudMid - 0.02],
        rot: [0, 0, a],
      });
      // Thin amber heat-vent indicator tick across each outer flat of the shroud.
      b.glow(new THREE.BoxGeometry(0.016, 0.14, 0.022), AMBER, 3.2, {
        at: [c * (flatDist + 0.006), s * (flatDist + 0.006), shroudBack - 0.07],
        rot: [0, 0, a],
      });
    }
  },

  muzzle: [0, 0, -2.92],
  follow: 19,
  return: 24,
};
