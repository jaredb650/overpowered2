/**
 * Open Frame cockpit model (`cockpitOpen`): canopy stripped away for an open exoskeleton roll-cage, sculpted exposed
 * pilot seat backrest and harness rails, twin hydraulic joystick consoles in first-person, and an overhead triple-pylon
 * hardpoint bridge supporting all three shoulder weapons (G, V, B).
 *
 * Sets `hideStandardInterior: true` and `hideStandardVisor: true` for a completely unobstructed open-air view.
 */
import * as THREE from 'three';
import { ModelBuilder, type ModelMaterials } from '../../progression/modelkit';
import { ACROSS, ALONG_Z, AMBER, BRASS, DARK, GUNMETAL, IRON, OBSIDIAN, PLATE, RED, STEEL, prism, type CockpitVisual } from './shared';

/** Exterior open roll-cage, exposed pilot seat & harness, and overhead triple-pylon hardpoint bridge (torso space). */
function exterior(b: ModelBuilder): void {
  // Recessed open cockpit tub coaming (replaces enclosed visor look with an open industrial well).
  b.solid(prism([
    [1.35, 0.62], [2.18, 0.72], [2.24, 1.02], [1.45, 0.94],
  ], 1.66, 0.03), OBSIDIAN, { at: [0, 0, 0], rot: ACROSS });
  // Low wind-deflector lip along the front coaming (no windscreen glass).
  b.solid(prism([
    [1.86, 0.98], [2.32, 1.04], [2.24, 1.18], [1.82, 1.14],
  ], 1.42, 0.02), PLATE, { at: [0, 0, 0], rot: ACROSS });
  b.box(1.36, 0.74, 0.24, DARK, { at: [0, 1.32, -2.14], rot: [-0.08, 0, 0] });

  // Sculpted exposed pilot seat pan, contoured armoured backrest, headrest bolster, and harness straps.
  b.solid(prism([
    [1.56, 0.94], [2.04, 0.98], [2.02, 1.1], [1.56, 1.12],
  ], 0.76, 0.025), IRON, { at: [0, 0, 0], rot: ACROSS });
  b.solid(prism([
    [1.42, 1.06], [1.66, 1.06], [1.74, 1.88], [1.52, 1.94], [1.38, 1.64],
  ], 0.72, 0.03), OBSIDIAN, { at: [0, 0, 0], rot: ACROSS });
  // Headrest cushion & lumbar support plates.
  b.solid(prism([
    [1.54, 1.72], [1.78, 1.74], [1.74, 2.02], [1.52, 2.0],
  ], 0.44, 0.025), GUNMETAL, { at: [0, 0, 0], rot: ACROSS });
  for (let i = 0; i < 3; i++) {
    b.box(0.54, 0.12, 0.06, PLATE, { at: [0, 1.22 + i * 0.18, -1.69], rot: [-0.08, 0, 0] });
  }
  // Twin vertical pilot shoulder harness rails & brass restraint clasps.
  for (const s of [-1, 1]) {
    b.solid(prism([
      [-0.035, -0.34], [0.035, -0.34], [0.03, 0.34], [-0.03, 0.34],
    ], 0.08, 0.01), PLATE, { at: [s * 0.2, 1.48, -1.73], rot: [-0.1, 0, 0] });
    b.box(0.09, 0.09, 0.06, BRASS, { at: [s * 0.2, 1.38, -1.78] });
    // Exposed pilot armrest & side control stick visible from outside.
    b.solid(prism([
      [1.56, 1.08], [2.14, 1.12], [2.12, 1.24], [1.56, 1.22],
    ], 0.14, 0.02), GUNMETAL, { at: [s * 0.5, 0, 0], rot: ACROSS });
    b.cyl(0.032, 0.042, 0.34, 8, STEEL, { at: [s * 0.5, 1.36, -2.02], rot: [0.22, 0, 0] });
    b.glow(new THREE.BoxGeometry(0.05, 0.05, 0.05), RED, 3.8, { at: [s * 0.72, 1.12, -2.26] });
  }

  // Open exoskeleton roll-cage hoops arching around and over the exposed seat.
  for (const s of [-1, 1]) {
    // Front raked roll-bar pillar from lower coaming up to top hoop.
    b.cyl(0.068, 0.075, 1.22, 10, STEEL, { at: [s * 0.86, 1.62, -2.06], rot: [-0.26, 0, s * -0.08] });
    // Upper horizontal side roll-cage rail back to dorsal bridge.
    b.cyl(0.065, 0.065, 1.88, 10, STEEL, { at: [s * 0.82, 2.18, -1.04], rot: [Math.PI / 2 - 0.1, 0, 0] });
    // Diagonal side exoskeleton guard bar (keeps waist shielded while seat stays open).
    b.cyl(0.052, 0.052, 1.1, 8, IRON, { at: [s * 0.92, 1.34, -1.66], rot: [0.68, 0, 0] });
    // Brass roll-cage weld gussets at the brow corners.
    b.cyl(0.095, 0.095, 0.12, 10, BRASS, { at: [s * 0.82, 2.14, -1.92], rot: [0, 0, Math.PI / 2] });
  }
  // Open front roll-cage header bar (leaves the center sky & front completely open).
  b.cyl(0.062, 0.062, 1.68, 10, OBSIDIAN, { at: [0, 2.14, -1.92], rot: [0, 0, Math.PI / 2] });

  // Upper overhead triple-pylon hardpoint bridge supporting Slots 0 (right), 1 (left), and 2 (dorsal top at [0, 2.65, 0.35]).
  b.solid(prism([
    [-0.52, -0.08], [0.58, -0.06], [0.46, 0.18], [-0.42, 0.18],
  ], 3.44, 0.035), OBSIDIAN, { at: [0, 2.34, 0.24], rot: ACROSS });
  // Elevated central dorsal bridge gantry for Shoulder Slot 3 (B).
  b.solid(prism([
    [-0.54, 0.0], [0.58, 0.0], [0.44, 0.28], [-0.44, 0.28],
  ], 1.12, 0.03), PLATE, { at: [0, 2.46, 0.35], rot: ACROSS });
  b.solid(prism([
    [-0.36, 0.0], [0.38, 0.0], [0.32, 0.14], [-0.32, 0.14],
  ], 0.84, 0.02), STEEL, { at: [0, 2.62, 0.35], rot: ACROSS });
  // Angled truss legs connecting the central top pylon to the left/right shoulder saddles.
  for (const s of [-1, 1]) {
    b.solid(prism([
      [-0.3, -0.08], [0.32, -0.08], [0.24, 0.1], [-0.24, 0.1],
    ], 1.18, 0.02), GUNMETAL, { at: [s * 0.94, 2.48, 0.28], rot: [0, Math.PI / 2, s * -0.22] });
    // Outer left/right shoulder pylon cradles.
    b.solid(prism([
      [-0.48, 0.0], [0.52, 0.0], [0.44, 0.24], [-0.4, 0.24],
    ], 0.64, 0.03), PLATE, { at: [s * 1.55, 2.22, 0.2], rot: ACROSS });
    b.cyl(0.08, 0.08, 0.52, 10, BRASS, { at: [s * 1.55, 2.38, 0.56], rot: [0, 0, Math.PI / 2] });
    b.glow(new THREE.BoxGeometry(0.16, 0.04, 0.04), AMBER, 3.8, { at: [s * 1.55, 2.42, -0.22] });
  }
  b.cyl(0.085, 0.085, 0.68, 10, BRASS, { at: [0, 2.66, 0.78], rot: [0, 0, Math.PI / 2] });
  b.glow(new THREE.BoxGeometry(0.24, 0.045, 0.045), AMBER, 4.0, { at: [0, 2.68, -0.14] });
}

/** Open-air first-person view: peripheral roll-cage rails + twin hydraulic joystick consoles, zero roof/glass obstruction. */
function interior(b: ModelBuilder): void {
  for (const s of [-1, 1]) {
    // Wide-set peripheral tubular roll-cage bar framing only the far screen edge (100% open sky & horizon).
    b.cyl(0.032, 0.036, 1.38, 10, STEEL, { at: [s * 1.16, 0.08, -0.68], rot: [0.16, 0, s * 0.12] });
    b.cyl(0.028, 0.028, 0.92, 8, IRON, { at: [s * 1.18, 0.68, -0.24], rot: [Math.PI / 2, 0, 0] });
    b.cyl(0.048, 0.048, 0.08, 10, BRASS, { at: [s * 1.09, 0.68, -0.78], rot: [0, 0, Math.PI / 2] });

    // Twin hydraulic joystick consoles in lower-left and lower-right foreground.
    b.solid(prism([
      [-0.22, -0.14], [0.24, -0.14], [0.2, 0.12], [-0.18, 0.14],
    ], 0.42, 0.02), OBSIDIAN, { at: [s * 0.72, -0.78, -0.52], rot: [0.28, s * -0.16, 0] });
    // Hydraulic gimbal boot & brass piston collar.
    b.cyl(0.075, 0.095, 0.09, 10, GUNMETAL, { at: [s * 0.64, -0.64, -0.58] });
    b.cyl(0.048, 0.056, 0.07, 10, BRASS, { at: [s * 0.64, -0.57, -0.58] });
    // Canted flight-grip control stick & sculpted trigger guard.
    b.cyl(0.026, 0.032, 0.24, 10, PLATE, { at: [s * 0.62, -0.44, -0.6], rot: [0.18, 0, s * 0.12] });
    b.solid(prism([
      [-0.032, -0.035], [0.042, -0.028], [0.036, 0.045], [-0.032, 0.038],
    ], 0.065, 0.01), OBSIDIAN, { at: [s * 0.6, -0.33, -0.62], rot: [0.18, 0, s * 0.12] });
    b.glow(new THREE.BoxGeometry(0.022, 0.028, 0.018), RED, 3.6, { at: [s * 0.6, -0.33, -0.66] });
    // Compact side console telemetry pips (three shoulder-slot lamps across the consoles).
    b.glow(new THREE.BoxGeometry(0.04, 0.012, 0.012), AMBER, 3.0, { at: [s * 0.78, -0.63, -0.62] });
    b.glow(new THREE.BoxGeometry(0.04, 0.012, 0.012), AMBER, 3.0, { at: [s * 0.85, -0.63, -0.58] });
  }
  // Thin open overhead tubular arch high above eye line (no roof panel — open sky above).
  b.cyl(0.026, 0.026, 2.22, 10, OBSIDIAN, { at: [0, 0.72, -0.78], rot: [0, 0, Math.PI / 2] });
  // Minimal low knee-guard coaming bar so looking down for stomps stays completely unobstructed.
  b.solid(prism([
    [-0.04, -0.025], [0.04, -0.025], [0.03, 0.025], [-0.035, 0.025],
  ], 1.88, 0.008), IRON, { at: [0, -0.68, -0.84], rot: ACROSS });
  b.cyl(0.022, 0.022, 0.18, 8, STEEL, { at: [0, -0.65, -0.82], rot: ALONG_Z });
}

export function buildOpenCockpit(materials: ModelMaterials): CockpitVisual {
  const ext = new ModelBuilder();
  exterior(ext);
  const int = new ModelBuilder();
  interior(int);
  return {
    exterior: materials.group(ext),
    interior: materials.group(int, materials.nearby),
    hideStandardInterior: true,
    hideStandardVisor: true,
  };
}
