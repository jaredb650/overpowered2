/**
 * FPV Drone Hive shoulder model (`fpv`).
 * Honeycomb 4-bay bevelled launch hive in obsidian/gunmetal with angled twin launch rails per bay,
 * four miniature folded kamikaze quadcopters visible inside the cells, and thin inset crimson status diodes.
 */
import * as THREE from 'three';
import type { ModelBuilder } from '../../progression/modelkit';
import {
  ACROSS, ALONG_Z, AMBER, DARK, GUNMETAL, IRON, OBSIDIAN, PLATE, RED, STEEL,
  ngon, prism, type ShoulderModelBuilder,
} from './shared';

export function buildFpvHive(b: ModelBuilder): void {
  // Reinforced shoulder pylon & bevelled recoil cradle.
  b.cyl(0.11, 0.14, 0.52, 10, STEEL, { at: [0, -0.46, 0.06], rot: [0.1, 0, 0] });
  b.solid(prism([[-0.42, -0.34], [0.46, -0.34], [0.38, -0.18], [-0.36, -0.18]], 0.78, 0.03), IRON, { rot: ACROSS });

  // Main bevelled obsidian honeycomb hive carapace (canting slightly upward toward -Z).
  b.solid(
    prism([
      [-0.64, -0.32], [0.68, -0.28], [0.76, -0.06], [0.72, 0.36],
      [0.48, 0.48], [-0.54, 0.46], [-0.7, 0.24], [-0.7, -0.14],
    ], 1.24, 0.05),
    OBSIDIAN,
    { rot: ACROSS },
  );

  // Recessed gunmetal honeycomb fascia shroud & armoured cheek ribs.
  b.solid(
    prism([
      [-0.58, -0.28], [0.58, -0.28], [0.64, -0.08], [0.58, 0.34],
      [0.4, 0.42], [-0.4, 0.42], [-0.58, 0.34], [-0.64, -0.08],
    ], 0.22, 0.035),
    GUNMETAL,
    { at: [0, 0.02, -0.64] },
  );
  // Sloped dorsal armour hood & cooling fins.
  b.solid(
    prism([[-0.54, 0.38], [0.58, 0.4], [0.44, 0.54], [-0.44, 0.52]], 1.08, 0.03),
    PLATE,
    { rot: ACROSS },
  );
  for (const s of [-1, 1]) {
    b.solid(
      prism([[-0.48, -0.16], [0.52, -0.14], [0.58, 0.24], [-0.46, 0.28]], 0.12, 0.025),
      GUNMETAL,
      { at: [s * 0.65, 0.04, 0], rot: ACROSS },
    );
  }

  // Four staggered honeycomb launch bays (2x2 hexagonal collars) with angled launch rails + folded quadcopters.
  const bays: readonly (readonly [number, number])[] = [
    [-0.29, 0.16],
    [0.29, 0.16],
    [-0.23, -0.14],
    [0.35, -0.14],
  ];
  for (let i = 0; i < bays.length; i++) {
    const [bx, by] = bays[i]!;
    // Bevelled hexagonal honeycomb cell frame & recessed dark cavity.
    b.solid(prism(ngon(0.24, 6, Math.PI / 6), 0.16, 0.022), GUNMETAL, { at: [bx, by, -0.7] });
    b.solid(prism(ngon(0.185, 6, Math.PI / 6), 0.18, 0.01), DARK, { at: [bx, by, -0.71] });

    // Angled twin steel launch rails projecting slightly forward and upward (-Z, +Y).
    for (const rSide of [-1, 1]) {
      b.solid(
        prism([[-0.018, -0.018], [0.018, -0.018], [0.014, 0.02], [-0.014, 0.02]], 0.34, 0.006),
        STEEL,
        { at: [bx + rSide * 0.1, by - 0.05, -0.78], rot: [0.16, 0, 0] },
      );
    }

    // Miniature folded FPV quadcopter seated on the rails inside the bay.
    b.solid(
      prism([[-0.06, -0.032], [0.06, -0.032], [0.075, 0.008], [0.045, 0.038], [-0.045, 0.038], [-0.075, 0.008]], 0.18, 0.01),
      PLATE,
      { at: [bx, by + 0.005, -0.76], rot: [0.16, 0, 0] },
    );
    // Underslung cylindrical micro-warhead.
    b.cyl(0.028, 0.034, 0.15, 8, IRON, { at: [bx, by - 0.036, -0.78], rot: [Math.PI / 2 + 0.16, 0, 0] });
    // Four folded swept rotor arms + micro rotor hub caps.
    for (const sx of [-1, 1]) {
      for (const sz of [-0.04, 0.05]) {
        b.cyl(0.012, 0.014, 0.12, 6, GUNMETAL, {
          at: [bx + sx * 0.08, by + 0.025, -0.76 + sz],
          rot: [0.16, 0, sx * -0.95],
        });
        b.cyl(0.032, 0.032, 0.012, 8, STEEL, {
          at: [bx + sx * 0.125, by + 0.05, -0.77 + sz],
          rot: [0.16, 0, 0],
        });
      }
    }
    // Thin crimson LED nose diode on each parked quadcopter.
    b.glow(new THREE.BoxGeometry(0.042, 0.018, 0.022), RED, 4.2, { at: [bx, by + 0.012, -0.86] });
  }

  // Rear exhaust manifold vents.
  for (let i = 0; i < 3; i++) {
    b.solid(
      prism([[-0.44, -0.04], [0.44, -0.04], [0.4, 0.04], [-0.4, 0.04]], 0.14, 0.012),
      i % 2 === 0 ? IRON : PLATE,
      { at: [0, -0.14 + i * 0.18, 0.64], rot: [0.22, 0, 0] },
    );
  }

  // Thin inset status diode strip across the upper brow (4 red bay LEDs + subtle amber link bar).
  for (let i = 0; i < 4; i++) {
    const x = -0.33 + i * 0.22;
    b.glow(new THREE.BoxGeometry(0.06, 0.022, 0.024), RED, 4.4, { at: [x, 0.44, -0.58] });
  }
  b.glow(new THREE.BoxGeometry(0.46, 0.018, 0.022), AMBER, 3.4, { at: [0, 0.49, -0.46] });
  // Side telemetry slit.
  b.cyl(0.02, 0.02, 0.05, 8, STEEL, { at: [0, 0.49, -0.58], rot: ALONG_Z });
}

export const SHOULDER_FPV: ShoulderModelBuilder = buildFpvHive;
