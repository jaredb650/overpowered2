/**
 * 4-Barrel Shoulder Minigun 3D model (`shoulderGatling`).
 * Compact brutal 4-barrel rotary cluster on a gimballed pintle arm, underslung linked ammo drum
 * with visible brass belt feed chute, and perforated cooling shroud.
 */
import * as THREE from 'three';
import type { ModelBuilder } from '../../progression/modelkit';
import {
  ACROSS, ALONG_Z, AMBER, BRASS, DARK, FLAT, GUNMETAL, IRON, OBSIDIAN, PLATE, RED, STEEL,
  ngon, prism, type ShoulderModelBuilder,
} from './shared';

/** Builds the 4-Barrel Shoulder Rotary Pod in local mount space (origin = shoulder pylon, -Z = forward). */
export function buildShoulderGatling(b: ModelBuilder): void {
  // ---- Gimballed pintle arm & turret azimuth ring ----
  b.solid(prism(ngon(0.26, 8, Math.PI / 8), 0.12, 0.02), IRON, { at: [0, -0.46, 0.08], rot: FLAT });
  b.cyl(0.12, 0.15, 0.24, 10, STEEL, { at: [0, -0.32, 0.08] });
  // Offset angled pintle arm lifting the rotary motor clear of the shoulder pauldron.
  b.solid(
    prism([[-0.16, -0.34], [0.18, -0.34], [0.24, 0.06], [-0.1, 0.06]], 0.18, 0.022),
    GUNMETAL,
    { at: [0, 0, 0.08], rot: ACROSS },
  );
  b.cyl(0.11, 0.11, 0.44, 10, STEEL, { at: [0, -0.04, 0.08], rot: [0, 0, Math.PI / 2] });
  for (const s of [-1, 1]) {
    b.cyl(0.065, 0.065, 0.055, 8, BRASS, { at: [s * 0.24, -0.04, 0.08], rot: [0, 0, Math.PI / 2] });
  }

  // ---- Compact rotary drive motor housing ----
  b.solid(
    prism([
      [-0.52, -0.1], [0.46, -0.1], [0.54, 0.04], [0.54, 0.34],
      [0.4, 0.44], [-0.44, 0.44], [-0.58, 0.28], [-0.58, 0.02],
    ], 0.56, 0.038),
    OBSIDIAN,
    { rot: ACROSS },
  );
  // Sloped top receiver cowling & heat-gauge glow bar.
  b.solid(
    prism([[-0.4, 0.38], [0.44, 0.36], [0.34, 0.5], [-0.32, 0.5]], 0.46, 0.022),
    PLATE,
    { rot: ACROSS },
  );
  b.glow(new THREE.BoxGeometry(0.032, 0.032, 0.52), AMBER, 3.8, { at: [0.26, 0.36, -0.02] });
  b.glow(new THREE.BoxGeometry(0.032, 0.032, 0.52), AMBER, 3.8, { at: [-0.26, 0.36, -0.02] });

  // Rear cylindrical electric drive motor cap & cooling fins.
  b.cyl(0.18, 0.2, 0.26, 10, GUNMETAL, { at: [0, 0.18, 0.62], rot: ALONG_Z });
  b.cyl(0.11, 0.13, 0.08, 10, BRASS, { at: [0, 0.18, 0.77], rot: ALONG_Z });

  // ---- Underslung linked ammo drum & visible brass belt feed chute ----
  b.solid(
    prism(ngon(0.24, 10), 0.34, 0.022),
    GUNMETAL,
    { at: [0.22, -0.24, -0.04], rot: [0, 0, Math.PI / 2] },
  );
  b.cyl(0.17, 0.17, 0.05, 10, PLATE, { at: [0.4, -0.24, -0.04], rot: [0, 0, Math.PI / 2] });
  b.cyl(0.075, 0.075, 0.07, 8, BRASS, { at: [0.43, -0.24, -0.04], rot: [0, 0, Math.PI / 2] });

  // Curved armored feed chute with visible linked brass cartridge strip rising into breech.
  b.solid(
    prism([[-0.14, -0.18], [0.16, -0.18], [0.2, 0.12], [-0.1, 0.12]], 0.12, 0.018),
    IRON,
    { at: [0.32, -0.02, -0.06], rot: [0, Math.PI / 2, -0.24] },
  );
  for (let i = 0; i < 5; i++) {
    b.cyl(0.024, 0.024, 0.14, 6, BRASS, {
      at: [0.36, -0.16 + i * 0.065, -0.12],
      rot: [0, 0, Math.PI / 2],
    });
  }

  // ---- Perforated cooling shroud & 4-barrel rotary cluster ----
  const cy = 0.18;

  // Rear perforated shroud collar around barrel roots.
  b.solid(prism(ngon(0.22, 8, Math.PI / 8), 0.42, 0.02), PLATE, { at: [0, cy, -0.74] });
  for (const s of [-1, 1]) {
    b.box(0.06, 0.1, 0.3, DARK, { at: [s * 0.21, cy, -0.74] });
  }
  b.box(0.1, 0.06, 0.3, DARK, { at: [0, cy + 0.21, -0.74] });

  // Central rotary drive spindle.
  b.cyl(0.045, 0.045, 1.48, 8, IRON, { at: [0, cy, -1.26], rot: ALONG_Z });

  // 4 heavy rifled rotary barrels arranged at 45° / 135° / 225° / 315°.
  const ringR = 0.115;
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    const bx = Math.cos(a) * ringR;
    const by = cy + Math.sin(a) * ringR;
    b.cyl(0.044, 0.048, 1.5, 8, STEEL, { at: [bx, by, -1.28], rot: ALONG_Z });
    b.cyl(0.052, 0.052, 0.06, 8, GUNMETAL, { at: [bx, by, -1.98], rot: ALONG_Z });
    b.cyl(0.028, 0.028, 0.06, 6, DARK, { at: [bx, by, -2.03], rot: ALONG_Z });
  }

  // Mid & muzzle rotary clamp disks tying the 4 barrels together.
  b.solid(prism(ngon(0.185, 8, Math.PI / 8), 0.075, 0.014), GUNMETAL, { at: [0, cy, -1.28] });
  b.solid(prism(ngon(0.18, 8, Math.PI / 8), 0.085, 0.014), BRASS, { at: [0, cy, -1.86] });

  // Forward targeting laser sensor block & crimson optic pip.
  b.box(0.12, 0.08, 0.22, IRON, { at: [-0.22, 0.36, -0.58] });
  b.glow(new THREE.CylinderGeometry(0.026, 0.026, 0.03, 8), RED, 4.4, {
    at: [-0.22, 0.36, -0.7],
    rot: ALONG_Z,
  });
}

export const SHOULDER_GATLING_MODEL: ShoulderModelBuilder = buildShoulderGatling;
