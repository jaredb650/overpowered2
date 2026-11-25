/**
 * Twin-Mount Cockpit model (`cockpitTwin`): upgraded gunship twin-shoulder yoke with wide heavy shoulder gantries,
 * canted dual rear ammo hoppers, reinforced forward-raked armoured brow cowl, twin hydraulic stabilizer arms bracing
 * each gantry into the torso flanks, and sleek twin-mullion fighter canopy framing in first-person.
 *
 * Keeps `hideStandardInterior: false` and `hideStandardVisor: false` so progressive canopy crack overlays remain
 * visible on the thinner glass.
 */
import * as THREE from 'three';
import { ModelBuilder, type ModelMaterials } from '../../progression/modelkit';
import {
  ACROSS, ALONG_Z, AMBER, BRASS, DARK, GUNMETAL, IRON, OBSIDIAN, PLATE, RED, STEEL,
  frameBuilder, prism,
  type ChassisPlaces, type CockpitVisual, type FramePalette,
} from './shared';

export const TWIN_CHASSIS_PLACES: ChassisPlaces = {
  eye: [0, 1.3, -0.9],
  head: [0, 2.42, -0.35],
  leftArm: [-1.82, 0.15, -1.15],
  rightArm: [1.82, 0.15, -1.15],
  shoulders: [
    [1.72, 2.46, 0.2],
    [-1.72, 2.46, 0.2],
    [0, 2.68, 0.35],
  ],
  jets: [0, 1.0, 1.9],
  jetNozzles: [
    [-1.2, 0.5, 1.98],
    [1.2, 0.5, 1.98],
  ],
};

const _yAxis = new THREE.Vector3(0, 1, 0);
function acrossRot(roll = 0, yaw = 0, pitch = 0): [number, number, number] {
  const q = new THREE.Quaternion()
    .setFromEuler(new THREE.Euler(pitch, yaw, -roll, 'YXZ'))
    .multiply(new THREE.Quaternion().setFromAxisAngle(_yAxis, Math.PI / 2));
  const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
  return [e.x, e.y, e.z];
}

/** Exterior wide twin-yoke heavy shoulder gantries, dual ammo hoppers, armoured brow cowl, and hydraulic stabilizers. */
function exterior(b: ModelBuilder): void {
  // Massive dual-beam dorsal cross-brace yoke spanning across the upper carapace to carry heavy twin shoulder loads.
  b.solid(prism([[-0.52, -0.1], [0.56, -0.08], [0.44, 0.2], [-0.42, 0.2]], 3.92, 0.035), OBSIDIAN, { at: [0, 2.38, 0.2], rot: ACROSS });
  b.solid(prism([[-0.26, -0.06], [0.28, -0.04], [0.22, 0.14], [-0.22, 0.14]], 3.64, 0.025), STEEL, { at: [0, 2.52, 0.2], rot: ACROSS });
  // Forward bridge truss tying both shoulder gantries across the brow.
  b.solid(prism([[-0.18, -0.05], [0.22, -0.05], [0.16, 0.12], [-0.16, 0.12]], 3.36, 0.02), GUNMETAL, { at: [0, 2.34, -0.44], rot: ACROSS });

  for (const s of [-1, 1]) {
    // Wide heavy bevelled shoulder gantry cradle at x = ±1.72, z = 0.20 (slots 0 & 1).
    b.solid(prism([
      [-0.72, -0.08], [0.78, -0.04], [0.66, 0.38], [-0.58, 0.42],
    ], 0.84, 0.04), PLATE, { at: [s * 1.72, 2.16, 0.2], rot: ACROSS });
    b.solid(prism([
      [-0.52, 0.0], [0.56, 0.0], [0.48, 0.2], [-0.44, 0.2],
    ], 0.64, 0.025), GUNMETAL, { at: [s * 1.72, 2.42, 0.2], rot: ACROSS });
    // Outer flanged gantry guard shield flaring out past the standard pauldron.
    b.solid(prism([
      [-0.68, -0.26], [0.74, -0.18], [0.64, 0.34], [-0.56, 0.38],
    ], 0.18, 0.025), PLATE, { at: [s * 2.24, 2.18, 0.18], rot: acrossRot(s * 0.18) });

    // Canted rear heavy ordnance ammo feed hopper tucked behind each shoulder gantry.
    const hopperRot = acrossRot(0, s * -0.14, 0.16);
    b.solid(prism([
      [-0.62, -0.32], [0.44, -0.28], [0.54, 0.32], [-0.48, 0.38],
    ], 0.56, 0.035), OBSIDIAN, { at: [s * 1.56, 1.98, 1.18], rot: hopperRot });
    b.solid(prism([
      [-0.46, 0.18], [0.34, 0.18], [0.42, 0.36], [-0.38, 0.4],
    ], 0.44, 0.02), GUNMETAL, { at: [s * 1.56, 2.02, 1.18], rot: hopperRot });
    b.glow(new THREE.BoxGeometry(0.14, 0.04, 0.54), AMBER, 3.6, { at: [s * 1.84, 2.16, 1.18], rot: [0.16, s * -0.14, 0] });

    // Twin hydraulic stabilizer arms & recoil shock dampers bracing each gantry into the hull flanks.
    b.cyl(0.088, 0.095, 1.06, 10, IRON, { at: [s * 2.28, 1.66, -0.34], rot: [0.42, 0, s * -0.26] });
    b.cyl(0.056, 0.056, 1.18, 10, STEEL, { at: [s * 2.38, 1.58, -0.44], rot: [0.42, 0, s * -0.26] });
    b.cyl(0.105, 0.105, 0.22, 10, BRASS, { at: [s * 2.22, 1.82, -0.22], rot: [0.42, 0, s * -0.26] });
    // Rear secondary diagonal stabilizer strut + brass hinge lock pin.
    b.cyl(0.068, 0.068, 0.94, 10, STEEL, { at: [s * 1.36, 2.14, -0.34], rot: [1.3, 0, s * 0.2] });
    b.cyl(0.092, 0.092, 0.72, 10, BRASS, { at: [s * 1.72, 2.42, 0.62], rot: [0, 0, Math.PI / 2] });
    b.glow(new THREE.BoxGeometry(0.22, 0.045, 0.045), AMBER, 4.0, { at: [s * 1.72, 2.48, -0.32] });

    // Thick swept gunship cheek cowls with recessed air-intake ducts flanking the visor.
    b.solid(prism([
      [0.62, 1.12], [2.32, 1.24], [2.24, 1.86], [0.76, 2.02],
    ], 0.26, 0.03), PLATE, { at: [s * 1.04, 0, 0], rot: ACROSS });
    b.box(0.14, 0.34, 0.16, DARK, { at: [s * 1.06, 1.46, -2.26] });
    b.glow(new THREE.BoxGeometry(0.04, 0.04, 1.08), RED, 3.8, { at: [s * 1.18, 1.72, -1.52] });

    // Slimmer canted twin canopy visor mullions framing the armoured fighter glass.
    b.solid(prism([
      [-0.042, -0.34], [0.052, -0.32], [0.042, 0.32], [-0.042, 0.34],
    ], 0.08, 0.012), STEEL, { at: [s * 0.36, 1.24, -2.24], rot: [-0.14, 0, s * 0.1] });
  }

  // Heavy reinforced forward-raked armoured brow cowl projecting aggressively above the canopy.
  b.solid(prism([
    [1.32, 1.56], [2.56, 1.52], [2.28, 1.88], [1.38, 2.02],
  ], 1.86, 0.04), OBSIDIAN, { rot: ACROSS });
  b.solid(prism([
    [1.58, 1.5], [2.52, 1.48], [2.42, 1.6], [1.58, 1.64],
  ], 1.62, 0.02), STEEL, { rot: ACROSS });
  // Lower armoured gunship chin lip & recessed glass gasket.
  b.solid(prism([
    [1.66, 0.82], [2.32, 0.9], [2.24, 1.04], [1.66, 0.98],
  ], 1.6, 0.022), GUNMETAL, { rot: ACROSS });
  b.box(1.42, 0.04, 0.06, DARK, { at: [0, 1.52, -2.18], rot: [-0.14, 0, 0] });
}

/** Slim first-person twin canopy mullions and dual shoulder ordnance telemetry bar (center FOV stays clear). */
function interior(b: ModelBuilder): void {
  for (const s of [-1, 1]) {
    // Slim raked inner mullion rib tucked at the outer viewport margin so you feel the fighter twin-strut canopy.
    b.solid(prism([
      [-0.024, -0.58], [0.026, -0.56], [0.02, 0.62], [-0.026, 0.6],
    ], 0.04, 0.008), STEEL, { at: [s * 0.84, 0.04, -0.78], rot: [0.1, 0, s * 0.14] });
    // Corner gusset bracket joining the slim strut into the armoured brow.
    b.solid(prism([
      [-0.09, -0.055], [0.09, -0.025], [0.07, 0.065], [-0.09, 0.065],
    ], 0.045, 0.008), GUNMETAL, { at: [s * 0.72, 0.58, -0.79], rot: [0, 0, s * -0.22] });
    // Overhead dual-shoulder mount status pods (Slot 1 right / Slot 2 left).
    b.solid(prism([
      [-0.16, -0.038], [0.16, -0.038], [0.12, 0.038], [-0.12, 0.038],
    ], 0.1, 0.01), OBSIDIAN, { at: [s * 0.44, 0.61, -0.78] });
    b.glow(new THREE.BoxGeometry(0.16, 0.012, 0.012), AMBER, 3.2, { at: [s * 0.44, 0.59, -0.74] });
    b.glow(new THREE.BoxGeometry(0.034, 0.012, 0.012), RED, 3.4, { at: [s * 0.56, 0.59, -0.74] });
    // Brass canopy clamp bolt at the lower sill corner.
    b.cyl(0.018, 0.018, 0.055, 8, BRASS, { at: [s * 0.76, -0.54, -0.82], rot: ALONG_Z });
  }
  // Center overhead reinforcement strap tying both shoulder telemetry pods.
  b.solid(prism([
    [-0.055, -0.018], [0.055, -0.018], [0.045, 0.02], [-0.045, 0.02],
  ], 1.24, 0.007), PLATE, { at: [0, 0.625, -0.79], rot: ACROSS });
}

export function buildTwinCockpit(materials: ModelMaterials, palette?: FramePalette): CockpitVisual {
  const ext = frameBuilder(palette);
  exterior(ext);
  const exteriorGroup = materials.group(ext);
  exteriorGroup.name = 'chassis.twin';

  const int = frameBuilder(palette);
  interior(int);
  const interiorGroup = materials.group(int, materials.nearby);
  interiorGroup.name = 'chassis.twin.interior';

  return {
    exterior: exteriorGroup,
    interior: interiorGroup,
    hideStandardInterior: false,
    hideStandardVisor: false,
    places: TWIN_CHASSIS_PLACES,
  };
}
