/**
 * Gantry Open-Cage (`cockpitOpen`): full `replacesHull: true` stripped-down tubular welded roll-cage exoskeleton!
 * Strips the solid torso shell completely away to reveal an open dark steel spaceframe truss, sculpted exposed
 * bucket pilot seat with shoulder harness and twin hydraulic joysticks, an exposed glowing vertical reactor core
 * cylinder in the rear cage, open skeletal shoulder booms, and a towering triple-pylon weapons bridge supporting
 * all three shoulder weapons (G, V, B).
 *
 * Sets `replacesHull: true`, `hideStandardInterior: true` (suppressing canopy cracks), and `hideStandardVisor: true`
 * for a completely unobstructed open-air view.
 */
import * as THREE from 'three';
import { ModelBuilder, type ModelMaterials } from '../../progression/modelkit';
import {
  ACROSS, ALONG_Z, AMBER, BRASS, FLAT, GUNMETAL, IRON, OBSIDIAN, PLATE, RED, STEEL,
  frameBuilder, ngon, prism,
  type ChassisPlaces, type CockpitVisual, type FramePalette,
} from './shared';

export const OPEN_CHASSIS_PLACES: ChassisPlaces = {
  eye: [0, 1.38, -0.96],
  head: [0, 2.34, -0.62],
  leftArm: [-1.78, 0.16, -1.12],
  rightArm: [1.78, 0.16, -1.12],
  shoulders: [
    [1.58, 2.4, 0.22],
    [-1.58, 2.4, 0.22],
    [0, 2.7, 0.36],
  ],
  jets: [0, 0.96, 1.84],
  jetNozzles: [
    [-1.1, 0.52, 1.9],
    [1.1, 0.52, 1.9],
  ],
};

/** Exterior stripped-down tubular roll-cage spaceframe, exposed pilot seat, rear reactor core, and 3-pylon gantry. */
function exterior(b: ModelBuilder): void {
  // Exposed waist turret bearing ring & open skeletal floor chassis frame (no solid torso carapace!).
  b.solid(prism(ngon(1.02, 8, Math.PI / 8), 0.24, 0.035), STEEL, { at: [0, 0.08, 0.14], rot: FLAT });
  b.solid(prism([
    [-1.22, -0.04], [1.42, 0.02], [1.56, 0.28], [-1.32, 0.28],
  ], 1.56, 0.035), OBSIDIAN, { rot: ACROSS });
  // Lower exposed footwell cradle & open grated pedal floor extending forward under the seat.
  b.solid(prism([
    [0.82, 0.24], [1.96, 0.44], [1.9, 0.6], [0.76, 0.44],
  ], 1.24, 0.025), GUNMETAL, { rot: ACROSS });
  // Low protective toe-bumper tube across the front footwell (leaves front & roof completely open!).
  b.cyl(0.065, 0.065, 1.48, 10, STEEL, { at: [0, 0.62, -1.94], rot: [0, 0, Math.PI / 2] });
  b.solid(prism([
    [1.48, 0.56], [2.04, 0.66], [1.96, 0.84], [1.44, 0.76],
  ], 1.18, 0.02), PLATE, { rot: ACROSS });

  // Sculpted exposed bucket pilot seat pan, contoured armoured backrest, headrest bolster, and harness straps!
  b.solid(prism([
    [0.64, 0.52], [1.44, 0.58], [1.42, 0.74], [0.64, 0.74],
  ], 0.82, 0.025), IRON, { rot: ACROSS });
  b.solid(prism([
    [0.42, 0.66], [0.74, 0.66], [0.84, 1.66], [0.58, 1.74], [0.36, 1.42],
  ], 0.76, 0.03), OBSIDIAN, { rot: ACROSS });
  // Contoured headrest bolster & ribbed lumbar cushion plates facing forward.
  b.solid(prism([
    [0.54, 1.56], [0.82, 1.58], [0.76, 1.94], [0.5, 1.92],
  ], 0.48, 0.025), GUNMETAL, { rot: ACROSS });
  for (let i = 0; i < 3; i++) {
    b.box(0.56, 0.14, 0.07, PLATE, { at: [0, 0.92 + i * 0.2, -0.78], rot: [-0.08, 0, 0] });
  }
  // Twin vertical pilot shoulder harness straps, brass buckles, armrests, and exposed side control joysticks!
  for (const s of [-1, 1]) {
    b.solid(prism([
      [-0.04, -0.36], [0.04, -0.36], [0.035, 0.36], [-0.035, 0.36],
    ], 0.07, 0.01), PLATE, { at: [s * 0.2, 1.24, -0.82], rot: [-0.08, 0, 0] });
    b.box(0.09, 0.09, 0.06, BRASS, { at: [s * 0.2, 1.12, -0.86] });
    // Exposed bucket seat side bolster & armrest with visible hydraulic flight stick.
    b.solid(prism([
      [0.62, 0.72], [1.54, 0.78], [1.5, 0.92], [0.62, 0.9],
    ], 0.14, 0.02), GUNMETAL, { at: [s * 0.52, 0, 0], rot: ACROSS });
    b.cyl(0.034, 0.044, 0.38, 8, STEEL, { at: [s * 0.52, 1.08, -1.36], rot: [0.22, 0, 0] });
    b.box(0.06, 0.09, 0.06, OBSIDIAN, { at: [s * 0.52, 1.26, -1.4], rot: [0.22, 0, 0] });
    b.glow(new THREE.BoxGeometry(0.045, 0.045, 0.045), RED, 3.8, { at: [s * 0.52, 1.26, -1.44] });
  }

  // Tubular welded steel roll-cage exoskeleton arching openly around the pilot seat (see-through bars!).
  for (const s of [-1, 1]) {
    // Front raked A-pillar roll-bar rising from lower footwell to upper brow corner.
    b.cyl(0.072, 0.08, 1.62, 10, STEEL, { at: [s * 0.88, 1.42, -1.56], rot: [-0.32, 0, s * -0.06] });
    // Upper longitudinal roll-cage rail running from brow back to the dorsal weapons bridge.
    b.cyl(0.07, 0.07, 2.08, 10, STEEL, { at: [s * 0.86, 2.18, -0.34], rot: [Math.PI / 2 - 0.04, 0, 0] });
    // Mid-height diagonal truss bar & lower sill tube forming an open triangular side cage.
    b.cyl(0.058, 0.058, 1.64, 8, IRON, { at: [s * 0.92, 1.06, -0.92], rot: [0.84, 0, 0] });
    b.cyl(0.065, 0.065, 1.98, 8, OBSIDIAN, { at: [s * 0.86, 0.42, -0.78], rot: [Math.PI / 2 - 0.14, 0, 0] });
    // Rear vertical roll-cage spine column anchoring the reactor cage & triple bridge.
    b.cyl(0.082, 0.09, 2.18, 10, STEEL, { at: [s * 0.84, 1.24, 0.64], rot: [-0.08, 0, 0] });
    // Diagonal rear brace down from dorsal bridge to waist frame.
    b.cyl(0.062, 0.062, 1.88, 8, IRON, { at: [s * 0.88, 1.18, 1.22], rot: [0.56, 0, 0] });
    // Brass weld-gusset collars at key roll-cage nodes.
    b.cyl(0.105, 0.105, 0.14, 10, BRASS, { at: [s * 0.86, 2.14, -1.28], rot: [0, 0, Math.PI / 2] });
    b.cyl(0.105, 0.105, 0.14, 10, BRASS, { at: [s * 0.86, 2.22, 0.56], rot: [0, 0, Math.PI / 2] });

    // Exposed skeletal shoulder outrigger boom & hydraulic actuator arm down to x = ±1.78 (no heavy pauldrons!).
    b.cyl(0.075, 0.075, 1.12, 10, OBSIDIAN, { at: [s * 1.34, 1.38, -0.1], rot: [0, 0, Math.PI / 2 + s * -0.14] });
    b.cyl(0.06, 0.06, 1.08, 8, STEEL, { at: [s * 1.34, 1.82, 0.08], rot: [0, 0, Math.PI / 2 + s * 0.36] });
    b.cyl(0.32, 0.32, 0.46, 12, IRON, { at: [s * 1.72, 1.28, -0.12], rot: [0, 0, Math.PI / 2] });
    b.cyl(0.36, 0.36, 0.1, 12, BRASS, { at: [s * 1.54, 1.28, -0.12], rot: [0, 0, Math.PI / 2] });
    b.cyl(0.095, 0.095, 1.22, 10, STEEL, { at: [s * 1.76, 0.72, -0.58], rot: [0.64, 0, 0] });
    b.cyl(0.065, 0.065, 1.16, 8, IRON, { at: [s * 1.92, 0.76, -0.44], rot: [0.64, 0, 0] });
  }
  // Open front roll-cage header tube & low cross-brace (leaves sky & face 100% open!).
  b.cyl(0.065, 0.065, 1.78, 10, OBSIDIAN, { at: [0, 2.14, -1.28], rot: [0, 0, Math.PI / 2] });
  b.cyl(0.055, 0.055, 1.74, 10, GUNMETAL, { at: [0, 2.26, -0.58], rot: [0, 0, Math.PI / 2] });

  // Exposed glowing vertical cylindrical reactor core drum right behind the pilot backrest!
  b.solid(prism(ngon(0.66, 12), 0.16, 0.025), OBSIDIAN, { at: [0, 0.38, 0.96], rot: FLAT });
  b.solid(prism(ngon(0.66, 12), 0.16, 0.025), OBSIDIAN, { at: [0, 1.98, 0.96], rot: FLAT });
  // Glowing exposed core cylinder & cooling fins visible through the skeletal cage ribs!
  b.glow(new THREE.CylinderGeometry(0.42, 0.42, 1.44, 14), AMBER, 3.8, { at: [0, 1.18, 0.96] });
  b.glow(new THREE.CylinderGeometry(0.46, 0.46, 0.24, 14), RED, 4.4, { at: [0, 1.18, 0.96] });
  for (let r = 0; r < 5; r++) {
    b.cyl(0.54, 0.54, 0.055, 12, IRON, { at: [0, 0.62 + r * 0.28, 0.96] });
  }
  // Six vertical steel cage bars surrounding the glowing reactor drum.
  for (let c = 0; c < 6; c++) {
    const a = (c / 6) * Math.PI * 2 + Math.PI / 6;
    b.cyl(0.048, 0.048, 1.62, 8, STEEL, { at: [Math.cos(a) * 0.58, 1.18, 0.96 + Math.sin(a) * 0.58] });
  }
  // Brass cooling manifold pipes curving out from the reactor core.
  for (const s of [-1, 1]) {
    b.cyl(0.068, 0.068, 1.18, 8, BRASS, { at: [s * 0.68, 1.14, 1.46], rot: [0.34, 0, s * -0.18] });
  }

  // Towering overhead triple-pylon welded weapons bridge supporting Slots 0 (right), 1 (left), and 2 (dorsal top).
  b.solid(prism([
    [-0.48, -0.08], [0.54, -0.06], [0.44, 0.16], [-0.4, 0.16],
  ], 3.52, 0.03), OBSIDIAN, { at: [0, 2.34, 0.24], rot: ACROSS });
  b.cyl(0.055, 0.055, 3.38, 10, STEEL, { at: [0, 2.26, -0.14], rot: [0, 0, Math.PI / 2] });
  // Elevated central dorsal bridge gantry for Shoulder Slot 3 (B) at [0, 2.7, 0.36].
  b.solid(prism([
    [-0.52, 0.0], [0.56, 0.0], [0.44, 0.28], [-0.42, 0.28],
  ], 1.1, 0.03), PLATE, { at: [0, 2.48, 0.36], rot: ACROSS });
  b.solid(prism([
    [-0.34, 0.0], [0.36, 0.0], [0.3, 0.14], [-0.3, 0.14],
  ], 0.82, 0.02), STEEL, { at: [0, 2.66, 0.36], rot: ACROSS });
  b.cyl(0.085, 0.085, 0.68, 10, BRASS, { at: [0, 2.7, 0.8], rot: [0, 0, Math.PI / 2] });
  b.glow(new THREE.BoxGeometry(0.24, 0.045, 0.045), AMBER, 4.0, { at: [0, 2.72, -0.12] });

  const yAxis = new THREE.Vector3(0, 1, 0);
  for (const s of [-1, 1]) {
    // Angled truss struts linking the central dorsal pylon to left/right shoulder saddles.
    const trussQ = new THREE.Quaternion()
      .setFromEuler(new THREE.Euler(0, 0, s * -0.22, 'YXZ'))
      .multiply(new THREE.Quaternion().setFromAxisAngle(yAxis, Math.PI / 2));
    const trussE = new THREE.Euler().setFromQuaternion(trussQ, 'XYZ');
    b.solid(prism([
      [-0.28, -0.07], [0.3, -0.07], [0.22, 0.09], [-0.22, 0.09],
    ], 1.2, 0.02), GUNMETAL, { at: [s * 0.96, 2.52, 0.28], rot: [trussE.x, trussE.y, trussE.z] });
    // Left/right shoulder pylon saddles at x = ±1.58, y = 2.4, z = 0.22.
    b.solid(prism([
      [-0.48, 0.0], [0.52, 0.0], [0.44, 0.24], [-0.4, 0.24],
    ], 0.64, 0.03), PLATE, { at: [s * 1.58, 2.24, 0.22], rot: ACROSS });
    b.cyl(0.08, 0.08, 0.52, 10, BRASS, { at: [s * 1.58, 2.4, 0.58], rot: [0, 0, Math.PI / 2] });
    b.glow(new THREE.BoxGeometry(0.16, 0.04, 0.04), AMBER, 3.8, { at: [s * 1.58, 2.44, -0.2] });

    // Exposed tubular thruster outrigger brackets & twin rear jet bells at [±1.1, 0.52, 1.9].
    b.cyl(0.065, 0.065, 0.96, 8, STEEL, { at: [s * 0.92, 1.06, 1.54], rot: [0.48, 0, s * -0.28] });
    b.cyl(0.24, 0.34, 0.56, 14, IRON, { at: [s * 1.1, 0.78, 1.84], rot: [0.24, 0, s * -0.1] });
    b.cyl(0.3, 0.34, 0.08, 14, STEEL, { at: [s * 1.1, 0.52, 1.9], rot: [0.24, 0, s * -0.1] });
    b.glow(new THREE.CylinderGeometry(0.18, 0.24, 0.06, 12), AMBER, 4.5, { at: [s * 1.1, 0.58, 1.88], rot: [0.24, 0, s * -0.1] });
  }
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

export function buildOpenCockpit(materials: ModelMaterials, palette?: FramePalette): CockpitVisual {
  const ext = frameBuilder(palette);
  exterior(ext);
  const exteriorGroup = materials.group(ext);
  exteriorGroup.name = 'chassis.open';

  const int = frameBuilder(palette);
  interior(int);
  const interiorGroup = materials.group(int, materials.nearby);
  interiorGroup.name = 'chassis.open.interior';

  return {
    exterior: exteriorGroup,
    interior: interiorGroup,
    replacesHull: true,
    hideStandardInterior: true,
    hideStandardVisor: true,
    places: OPEN_CHASSIS_PLACES,
  };
}
