/**
 * Sensor Cockpit model (`cockpitSensor`): recessed cyclops optics housing with wide multi-lens sensor array, canted
 * phased-array side radar cheeks, subtle glowing crimson/amber optical scan bar on the exterior, and a crisp technical
 * optical rangefinder bezel in the first-person interior.
 *
 * Sets `hideStandardVisor: true` so the recessed cyclops optics and scan bar replace the standard flat visor cleanly,
 * while keeping `hideStandardInterior: false` so progressive canopy cracks still render on the optical viewport.
 */
import * as THREE from 'three';
import { ModelBuilder, type ModelMaterials } from '../../progression/modelkit';
import { ACROSS, ALONG_Z, AMBER, BRASS, DARK, GUNMETAL, IRON, OBSIDIAN, PLATE, RED, STEEL, frameBuilder, ngon, prism, type CockpitVisual, type FramePalette } from './shared';

/** Exterior recessed cyclops optics housing, multi-lens array, canted radar cheeks, and dorsal FLIR dome (torso space). */
function exterior(b: ModelBuilder): void {
  // Bevelled armoured cyclops shroud projecting forward around the recessed multi-lens aperture.
  b.solid(prism([
    [1.74, 0.92], [2.42, 0.98], [2.48, 1.56], [2.22, 1.84], [1.74, 1.88],
  ], 1.66, 0.04), OBSIDIAN, { at: [0, 0, 0], rot: ACROSS });
  // Chamfered upper optical visor brow plate.
  b.solid(prism([
    [1.58, 1.62], [2.56, 1.58], [2.36, 1.88], [1.62, 1.96],
  ], 1.72, 0.035), PLATE, { at: [0, 0, 0], rot: ACROSS });
  // Deeply recessed dark optical bay inside the shroud.
  b.box(1.42, 0.54, 0.14, DARK, { at: [0, 1.3, -2.38], rot: [-0.08, 0, 0] });

  // Central cyclops primary telephoto/FLIR optic drum (octagonal bezel + lens barrel + crimson iris).
  b.solid(prism(ngon(0.24, 8, Math.PI / 8), 0.18, 0.02), STEEL, { at: [0, 1.32, -2.42] });
  b.cyl(0.17, 0.19, 0.16, 14, IRON, { at: [0, 1.32, -2.46], rot: ALONG_Z });
  b.cyl(0.13, 0.13, 0.06, 14, DARK, { at: [0, 1.32, -2.53], rot: ALONG_Z });
  b.glow(new THREE.CylinderGeometry(0.085, 0.085, 0.03, 14), RED, 4.4, { at: [0, 1.32, -2.55], rot: ALONG_Z });

  // Flanking secondary multi-lens FLIR & lidar optics with brass focus collars.
  for (const s of [-1, 1]) {
    b.cyl(0.11, 0.125, 0.18, 12, GUNMETAL, { at: [s * 0.42, 1.33, -2.42], rot: ALONG_Z });
    b.cyl(0.118, 0.118, 0.04, 12, BRASS, { at: [s * 0.42, 1.33, -2.48], rot: ALONG_Z });
    b.glow(new THREE.CylinderGeometry(0.055, 0.055, 0.03, 12), AMBER, 3.8, { at: [s * 0.42, 1.33, -2.52], rot: ALONG_Z });

    // Outer micro-optic rangefinder apertures.
    b.cyl(0.06, 0.068, 0.12, 10, STEEL, { at: [s * 0.62, 1.24, -2.4], rot: ALONG_Z });
    b.glow(new THREE.CylinderGeometry(0.032, 0.032, 0.03, 10), RED, 3.4, { at: [s * 0.62, 1.24, -2.46], rot: ALONG_Z });
  }

  // Subtle inset glowing horizontal optical scan bar (crimson core + amber flanking calibration ticks).
  b.glow(new THREE.BoxGeometry(1.18, 0.032, 0.03), RED, 3.6, { at: [0, 1.12, -2.45] });
  for (const s of [-1, 1]) {
    b.glow(new THREE.BoxGeometry(0.24, 0.022, 0.026), AMBER, 3.2, { at: [s * 0.48, 1.48, -2.44] });
  }

  // Canted phased-array side radar cheeks flanking the cockpit pod.
  for (const s of [-1, 1]) {
    b.solid(prism([
      [-0.56, -0.34], [0.64, -0.26], [0.58, 0.36], [-0.46, 0.44],
    ], 0.24, 0.035), PLATE, { at: [s * 1.22, 1.24, -1.52], rot: [0, Math.PI / 2 + s * -0.28, 0] });
    b.solid(prism([
      [-0.44, -0.24], [0.5, -0.18], [0.44, 0.26], [-0.36, 0.32],
    ], 0.09, 0.015), GUNMETAL, { at: [s * 1.32, 1.24, -1.56], rot: [0, Math.PI / 2 + s * -0.28, 0] });
    // Horizontal radar array louver fins & thin amber telemetry edge slit.
    for (let i = 0; i < 3; i++) {
      b.box(0.05, 0.045, 0.76, STEEL, { at: [s * 1.36, 1.1 + i * 0.14, -1.56], rot: [0, s * -0.28, 0] });
    }
    b.glow(new THREE.BoxGeometry(0.03, 0.026, 0.72), AMBER, 3.4, { at: [s * 1.37, 1.5, -1.56], rot: [0, s * -0.28, 0] });
  }

  // Dorsal thermal/radar sensor turret mast on the left carapace (clear of right shoulder slot 0 at x = +1.55).
  b.solid(prism([
    [-0.36, 0.0], [0.4, 0.0], [0.32, 0.32], [-0.28, 0.32],
  ], 0.52, 0.03), GUNMETAL, { at: [-0.92, 2.34, -0.34], rot: ACROSS });
  b.solid(prism(ngon(0.32, 8, Math.PI / 8), 0.22, 0.025), PLATE, { at: [-0.92, 2.74, -0.34], rot: [Math.PI / 2, 0, 0] });
  b.cyl(0.14, 0.14, 0.26, 12, IRON, { at: [-0.92, 2.74, -0.56], rot: ALONG_Z });
  b.glow(new THREE.CylinderGeometry(0.08, 0.08, 0.03, 12), RED, 4.0, { at: [-0.92, 2.74, -0.7], rot: ALONG_Z });
  // Compact blade telemetry array behind the turret.
  b.solid(prism([[-0.08, 0], [0.1, 0], [0.02, 0.62], [-0.08, 0.56]], 0.04, 0.008), STEEL, { at: [-1.18, 2.58, 0.08], rot: ACROSS });
}

/** Crisp technical optical rangefinder bezel in first-person interior (eye space; center crosshair unobstructed). */
function interior(b: ModelBuilder): void {
  // Upper sculpted optical rangefinder hood & laser emitter bar tucked along the top brow.
  b.solid(prism([
    [-0.08, -0.03], [0.08, -0.03], [0.055, 0.035], [-0.06, 0.035],
  ], 1.78, 0.01), GUNMETAL, { at: [0, 0.59, -0.82], rot: ACROSS });
  // Thin metallic optical rangefinder scale ticks along the top bezel edge.
  for (let i = -3; i <= 3; i++) {
    const h = i === 0 ? 0.038 : 0.022;
    b.box(0.012, h, 0.014, i === 0 ? BRASS : STEEL, { at: [i * 0.14, 0.565, -0.8] });
  }
  b.glow(new THREE.BoxGeometry(0.28, 0.009, 0.01), RED, 3.2, { at: [0, 0.585, -0.78] });

  for (const s of [-1, 1]) {
    // Upper-corner laser rangefinder / thermal bus prism pods.
    b.solid(prism([
      [-0.14, -0.045], [0.14, -0.045], [0.11, 0.045], [-0.11, 0.045],
    ], 0.11, 0.012), OBSIDIAN, { at: [s * 0.72, 0.57, -0.8], rot: [0, 0, s * -0.14] });
    b.cyl(0.022, 0.024, 0.06, 10, STEEL, { at: [s * 0.64, 0.56, -0.77], rot: ALONG_Z });
    b.glow(new THREE.BoxGeometry(0.09, 0.011, 0.012), AMBER, 3.2, { at: [s * 0.76, 0.56, -0.75] });

    // Slim angled inner telemetry bezel brackets framing the side viewport margins.
    b.solid(prism([
      [-0.022, -0.44], [0.024, -0.42], [0.018, 0.44], [-0.022, 0.46],
    ], 0.035, 0.008), PLATE, { at: [s * 0.94, 0.02, -0.78], rot: [0.08, 0, s * 0.1] });
    // Compact side FLIR readout bezel mounted above each console.
    b.solid(prism([
      [-0.16, -0.09], [0.16, -0.09], [0.14, 0.09], [-0.14, 0.09],
    ], 0.04, 0.008), OBSIDIAN, { at: [s * 0.84, -0.44, -0.72], rot: [0.16, s * -0.32, 0] });
    b.glow(new THREE.BoxGeometry(0.22, 0.012, 0.01), AMBER, 3.0, { at: [s * 0.82, -0.41, -0.69], rot: [0.16, s * -0.32, 0] });
    b.glow(new THREE.BoxGeometry(0.14, 0.01, 0.01), RED, 3.0, { at: [s * 0.82, -0.46, -0.69], rot: [0.16, s * -0.32, 0] });
  }

  // Lower rangefinder calibration strip on the central sill (stomp chin sightline stays clear).
  b.solid(prism([
    [-0.045, -0.018], [0.045, -0.018], [0.035, 0.018], [-0.035, 0.018],
  ], 0.72, 0.006), STEEL, { at: [0, -0.535, -0.83], rot: ACROSS });
  b.glow(new THREE.BoxGeometry(0.18, 0.008, 0.01), AMBER, 2.8, { at: [0, -0.528, -0.8] });
}

export function buildSensorCockpit(materials: ModelMaterials, palette?: FramePalette): CockpitVisual {
  const ext = frameBuilder(palette);
  exterior(ext);
  const int = frameBuilder(palette);
  interior(int);
  return {
    exterior: materials.group(ext),
    interior: materials.group(int, materials.nearby),
    hideStandardInterior: false,
    hideStandardVisor: true,
  };
}
