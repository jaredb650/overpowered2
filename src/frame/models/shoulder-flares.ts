/**
 * Countermeasure Rack shoulder model (`flares`).
 * Angled multi-tube chaff & flare dispenser rack: 2 rows x 6 canted brass-rimmed mortar tubes
 * mounted in a bevelled gunmetal/plate armoured collar with thin inset amber hazard markings.
 */
import * as THREE from 'three';
import type { ModelBuilder } from '../../progression/modelkit';
import {
  ACROSS, AMBER, BRASS, DARK, GUNMETAL, IRON, OBSIDIAN, PLATE, STEEL,
  prism, type ShoulderModelBuilder,
} from './shared';

export function buildFlareRack(b: ModelBuilder): void {
  // Reinforced mounting pylon & swivel bracket.
  b.cyl(0.11, 0.14, 0.46, 10, STEEL, { at: [0, -0.44, 0.04] });
  b.solid(prism([[-0.38, -0.3], [0.4, -0.3], [0.34, -0.14], [-0.32, -0.14]], 0.72, 0.03), IRON, { rot: ACROSS });

  // Lower obsidian/gunmetal ammunition magazine base housing.
  b.solid(
    prism([
      [-0.56, -0.24], [0.58, -0.24], [0.66, -0.06], [0.56, 0.18],
      [-0.52, 0.18], [-0.62, -0.04],
    ], 1.28, 0.045),
    GUNMETAL,
    { rot: ACROSS },
  );

  // Bevelled PLATE upper blast-shield collar framing the 12 dispenser mortars.
  b.solid(
    prism([
      [-0.5, 0.12], [0.54, 0.12], [0.62, 0.28], [0.46, 0.34],
      [-0.44, 0.34], [-0.58, 0.26],
    ], 1.32, 0.032),
    PLATE,
    { rot: ACROSS },
  );

  // Side cheek blast baffles in OBSIDIAN & STEEL reinforcement straps.
  for (const s of [-1, 1]) {
    b.solid(
      prism([[-0.48, -0.14], [0.52, -0.14], [0.56, 0.3], [-0.46, 0.28]], 0.1, 0.022),
      OBSIDIAN,
      { at: [s * 0.67, 0.06, 0], rot: ACROSS },
    );
    b.solid(
      prism([[-0.36, -0.02], [0.38, -0.02], [0.34, 0.05], [-0.34, 0.05]], 0.06, 0.01),
      STEEL,
      { at: [s * 0.72, 0.18, 0], rot: ACROSS },
    );
  }

  // 2 rows x 6 canted brass-rimmed chaff/flare mortar tubes (12 tubes total), fanned outward.
  const rows: readonly (readonly [number, number])[] = [
    [-0.24, -0.44], // front row: pitched forward-upward
    [0.22, -0.22],  // rear row: steeper upward arc
  ];
  for (let r = 0; r < rows.length; r++) {
    const [zBase, pitch] = rows[r]!;
    for (let c = 0; c < 6; c++) {
      const t = (c - 2.5) / 2.5; // -1 .. +1 across the 6 tubes
      const x = t * 0.52;
      const roll = -t * 0.32;
      const y = 0.38 + (r === 1 ? 0.06 : 0) - Math.abs(t) * 0.04;
      const z = zBase - Math.abs(t) * 0.04;

      // Exact local +Y unit axis after Euler XYZ [pitch, 0, roll].
      const ax = -Math.sin(roll);
      const ay = Math.cos(roll) * Math.cos(pitch);
      const az = Math.cos(roll) * Math.sin(pitch);

      // Tube barrel body in GUNMETAL + IRON lower clamp ring.
      b.cyl(0.054, 0.062, 0.42, 8, GUNMETAL, { at: [x, y, z], rot: [pitch, 0, roll] });
      b.cyl(0.068, 0.068, 0.07, 8, IRON, {
        at: [x - ax * 0.1, y - ay * 0.1, z - az * 0.1],
        rot: [pitch, 0, roll],
      });

      // Brass-rimmed muzzle collar & recessed dark mortar bore at the tube tip.
      const tipOff = 0.21;
      b.cyl(0.058, 0.058, 0.052, 8, BRASS, {
        at: [x + ax * tipOff, y + ay * tipOff, z + az * tipOff],
        rot: [pitch, 0, roll],
      });
      b.cyl(0.04, 0.04, 0.032, 8, DARK, {
        at: [x + ax * (tipOff + 0.018), y + ay * (tipOff + 0.018), z + az * (tipOff + 0.018)],
        rot: [pitch, 0, roll],
      });
    }
  }

  // Thin inset AMBER countermeasure hazard markings along the front & side collar faces.
  b.glow(new THREE.BoxGeometry(0.92, 0.026, 0.024), AMBER, 4.0, { at: [0, 0.22, -0.64] });
  b.glow(new THREE.BoxGeometry(0.46, 0.02, 0.022), AMBER, 3.6, { at: [0, 0.02, -0.66] });
  for (const s of [-1, 1]) {
    b.glow(new THREE.BoxGeometry(0.022, 0.024, 0.64), AMBER, 3.6, { at: [s * 0.72, 0.25, 0] });
  }
}

export const SHOULDER_FLARES: ShoulderModelBuilder = buildFlareRack;
