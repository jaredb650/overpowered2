/**
 * Mortar Rack shoulder model (`buildMortarRack`): angled 6-tube heavy mortar battery (2×3 staggered ribbed tubes
 * pitched up at 55°), armoured blast deflector baseplate, side ammo hoist rails, and contrasting
 * `OBSIDIAN`/`GUNMETAL`/`PLATE`/`BRASS` trim.
 */
import * as THREE from 'three';
import type { ModelBuilder } from '../../progression/modelkit';
import { ACROSS, AMBER, BRASS, DARK, GUNMETAL, IRON, OBSIDIAN, PLATE, STEEL, prism } from './shared';

/** 55° elevation above horizontal = 35° forward tilt from vertical +Y toward -Z. */
const TILT_55 = -(Math.PI / 2 - (55 * Math.PI) / 180); // ~-0.6109 rad
const SIN_T = Math.sin(-TILT_55);
const COS_T = Math.cos(-TILT_55);

export function buildMortarRack(b: ModelBuilder): void {
  // Heavy articulated shoulder pylon anchoring the battery to the hull.
  b.cyl(0.14, 0.17, 0.54, 12, STEEL, { at: [0, -0.46, 0.06] });
  b.cyl(0.2, 0.2, 0.14, 12, IRON, { at: [0, -0.24, 0.06] });

  // Bevelled blast deflector baseplate housing (+u runs forward along -Z with rot: ACROSS).
  b.solid(
    prism(
      [[-0.78, -0.34], [0.68, -0.34], [0.78, -0.14], [0.66, 0.24], [-0.52, 0.34], [-0.82, 0.14]],
      1.26,
      0.05,
    ),
    OBSIDIAN,
    { rot: ACROSS },
  );

  // Angled rear blast deflector shield behind the breech row to vent mortar backblast upward.
  b.solid(
    prism([[-0.6, -0.06], [0.6, -0.06], [0.54, 0.1], [-0.54, 0.1]], 0.54, 0.03),
    PLATE,
    { at: [0, 0.12, 0.64], rot: [0.55, 0, 0] },
  );

  // Side ammo hoist rails, elevation trunnions, and hydraulic elevation struts on both flanks.
  for (const s of [-1, 1]) {
    // Hoist guide rail flanking the battery.
    b.solid(
      prism([[-0.48, -0.16], [0.46, -0.16], [0.54, 0.14], [0.36, 0.38], [-0.4, 0.38]], 0.1, 0.025),
      PLATE,
      { at: [s * 0.64, 0.24, 0.04], rot: ACROSS },
    );
    // Twin vertical/angled steel hoist slide rods.
    b.cyl(0.035, 0.035, 0.86, 8, STEEL, { at: [s * 0.69, 0.38, -0.18], rot: [TILT_55, 0, 0] });
    b.cyl(0.035, 0.035, 0.86, 8, STEEL, { at: [s * 0.69, 0.38, 0.14], rot: [TILT_55, 0, 0] });
    // Hoist carriage block & brass elevation trunnion.
    b.box(0.09, 0.14, 0.38, IRON, { at: [s * 0.7, 0.44, -0.04], rot: [TILT_55, 0, 0] });
    b.cyl(0.11, 0.11, 0.14, 12, BRASS, { at: [s * 0.66, 0.14, -0.14], rot: [0, 0, Math.PI / 2] });
  }

  // 2×3 staggered ribbed heavy mortar tubes tilted up at 55°.
  const rows: readonly { y: number; z: number; len: number }[] = [
    { y: 0.42, z: -0.26, len: 0.94 }, // Front row of 3
    { y: 0.6, z: 0.14, len: 1.02 },   // Rear staggered row of 3 (raised for clear silhouette)
  ];

  for (const row of rows) {
    for (const x of [-0.36, 0, 0.36]) {
      // Main heavy tube barrel.
      b.cyl(0.115, 0.13, row.len, 12, GUNMETAL, { at: [x, row.y, row.z], rot: [TILT_55, 0, 0] });

      // Reinforcement cooling ribs & brass collar along the tube axis.
      for (const offset of [-0.2, 0.06, 0.28]) {
        const ry = row.y + COS_T * offset;
        const rz = row.z - SIN_T * offset;
        b.cyl(0.136, 0.136, 0.055, 12, offset === 0.06 ? BRASS : PLATE, {
          at: [x, ry, rz],
          rot: [TILT_55, 0, 0],
        });
      }

      // Flared muzzle crown + deep recessed mortar bore.
      const top = row.len * 0.5;
      b.cyl(0.142, 0.128, 0.1, 12, OBSIDIAN, {
        at: [x, row.y + COS_T * (top - 0.03), row.z - SIN_T * (top - 0.03)],
        rot: [TILT_55, 0, 0],
      });
      b.cyl(0.088, 0.088, 0.07, 10, DARK, {
        at: [x, row.y + COS_T * (top + 0.01), row.z - SIN_T * (top + 0.01)],
        rot: [TILT_55, 0, 0],
      });
    }
  }

  // Front brow trim & thin inset AMBER fire-control readiness strip.
  b.solid(
    prism([[-0.56, -0.08], [0.56, -0.08], [0.48, 0.08], [-0.48, 0.08]], 0.16, 0.025),
    PLATE,
    { at: [0, 0.22, -0.66] },
  );
  b.glow(new THREE.BoxGeometry(0.92, 0.035, 0.035), AMBER, 3.8, { at: [0, 0.22, -0.75] });
}
