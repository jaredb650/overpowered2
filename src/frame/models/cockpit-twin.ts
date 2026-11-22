/**
 * Twin-Mount Cockpit model (`cockpitTwin`): dual reinforced shoulder pylon saddles linked by a dorsal cross-brace yoke
 * for twin shoulder ordnance (G / V), plus a sleeker thin-framed twin-strut armoured visor canopy (exterior and slim
 * first-person interior struts so the pilot feels the thinner 0.7× canopy and dual shoulder hardpoints).
 *
 * Keeps `hideStandardInterior: false` so progressive canopy crack overlays remain visible on the thinner glass.
 */
import * as THREE from 'three';
import { ModelBuilder, type ModelMaterials } from '../../progression/modelkit';
import { ACROSS, ALONG_Z, AMBER, BRASS, DARK, GUNMETAL, IRON, OBSIDIAN, PLATE, RED, STEEL, prism, type CockpitVisual } from './shared';

/** Exterior twin shoulder pylon reinforcements and sleek thin-framed twin-strut canopy brow (torso space). */
function exterior(b: ModelBuilder): void {
  // Dorsal cross-brace yoke linking left and right shoulder hardpoints across the upper carapace.
  b.solid(prism([[-0.42, -0.08], [0.46, -0.06], [0.34, 0.16], [-0.34, 0.16]], 3.36, 0.03), OBSIDIAN, { at: [0, 2.38, 0.22], rot: ACROSS });
  b.solid(prism([[-0.22, -0.05], [0.24, -0.04], [0.18, 0.12], [-0.18, 0.12]], 2.94, 0.02), STEEL, { at: [0, 2.48, 0.22], rot: ACROSS });

  for (const s of [-1, 1]) {
    // Heavy bevelled shoulder pylon saddle at x = ±1.55, z = 0.20 (slots 0 & 1).
    b.solid(prism([
      [-0.58, 0.0], [0.64, 0.0], [0.54, 0.32], [-0.46, 0.34],
    ], 0.72, 0.035), PLATE, { at: [s * 1.55, 2.14, 0.2], rot: ACROSS });
    b.solid(prism([
      [-0.44, 0.0], [0.48, 0.0], [0.42, 0.18], [-0.38, 0.18],
    ], 0.56, 0.025), GUNMETAL, { at: [s * 1.55, 2.36, 0.2], rot: ACROSS });
    // Structural gusset rib bracing each pylon down onto the pauldron.
    b.solid(prism([
      [-0.36, -0.26], [0.44, -0.18], [0.34, 0.16], [-0.28, 0.2],
    ], 0.18, 0.02), IRON, { at: [s * 1.88, 2.14, 0.14], rot: [0, Math.PI / 2, s * -0.18] });
    // Brass hydraulic lock pins and recoil damper rods along each mount.
    b.cyl(0.085, 0.085, 0.64, 10, BRASS, { at: [s * 1.55, 2.36, 0.58], rot: [0, 0, Math.PI / 2] });
    b.cyl(0.055, 0.055, 0.78, 10, STEEL, { at: [s * 1.24, 2.18, -0.24], rot: [1.34, 0, s * 0.16] });
    // Crisp amber hardpoint-ready lamp on each pylon cheek.
    b.glow(new THREE.BoxGeometry(0.18, 0.04, 0.04), AMBER, 3.8, { at: [s * 1.55, 2.42, -0.26] });

    // Slimmer canted twin canopy visor struts framing the thinner armoured glass.
    b.solid(prism([
      [-0.04, -0.34], [0.05, -0.32], [0.04, 0.32], [-0.04, 0.34],
    ], 0.075, 0.012), STEEL, { at: [s * 0.36, 1.24, -2.23], rot: [-0.14, 0, s * 0.1] });
    // Sleek side canopy fairing cheeks sweeping back toward the twin pylons.
    b.solid(prism([
      [0.65, 1.44], [2.16, 1.52], [2.04, 1.84], [0.76, 1.94],
    ], 0.18, 0.025), OBSIDIAN, { at: [s * 0.96, 0, 0], rot: ACROSS });
    b.glow(new THREE.BoxGeometry(0.035, 0.035, 0.92), RED, 3.6, { at: [s * 1.06, 1.68, -1.48] });
  }

  // Sleek forward-raked thin visor brow lip above the glass.
  b.solid(prism([
    [1.45, 1.56], [2.36, 1.54], [2.14, 1.76], [1.48, 1.84],
  ], 1.62, 0.03), OBSIDIAN, { at: [0, 0, 0], rot: ACROSS });
  b.solid(prism([
    [1.62, 1.52], [2.32, 1.5], [2.24, 1.59], [1.62, 1.62],
  ], 1.44, 0.015), STEEL, { at: [0, 0, 0], rot: ACROSS });
  // Thin lower glacis lip under the glass viewport.
  b.solid(prism([
    [1.72, 0.86], [2.22, 0.92], [2.16, 1.02], [1.72, 0.98],
  ], 1.46, 0.018), GUNMETAL, { at: [0, 0, 0], rot: ACROSS });
  // Recessed dark glass gasket trim behind the twin struts.
  b.box(1.38, 0.04, 0.06, DARK, { at: [0, 1.52, -2.18], rot: [-0.14, 0, 0] });
}

/** Slim first-person twin canopy struts and dual shoulder telemetry housings (eye space; center FOV stays clear). */
function interior(b: ModelBuilder): void {
  for (const s of [-1, 1]) {
    // Slim raked inner mullion rib tucked at the outer viewport margin so you feel the thinner twin-strut canopy.
    b.solid(prism([
      [-0.022, -0.58], [0.024, -0.56], [0.018, 0.62], [-0.024, 0.6],
    ], 0.036, 0.008), STEEL, { at: [s * 0.84, 0.04, -0.78], rot: [0.1, 0, s * 0.14] });
    // Corner gusset bracket joining the slim strut into the brow.
    b.solid(prism([
      [-0.08, -0.05], [0.08, -0.02], [0.06, 0.06], [-0.08, 0.06],
    ], 0.04, 0.008), GUNMETAL, { at: [s * 0.72, 0.58, -0.79], rot: [0, 0, s * -0.22] });
    // Overhead dual-shoulder mount status pods (Slot 1 right / Slot 2 left).
    b.solid(prism([
      [-0.14, -0.035], [0.14, -0.035], [0.11, 0.035], [-0.11, 0.035],
    ], 0.09, 0.01), OBSIDIAN, { at: [s * 0.44, 0.61, -0.78] });
    b.glow(new THREE.BoxGeometry(0.14, 0.012, 0.012), AMBER, 3.2, { at: [s * 0.44, 0.59, -0.74] });
    b.glow(new THREE.BoxGeometry(0.03, 0.012, 0.012), RED, 3.4, { at: [s * 0.54, 0.59, -0.74] });
    // Thin brass canopy clamp bolt at the lower sill corner.
    b.cyl(0.016, 0.016, 0.05, 8, BRASS, { at: [s * 0.76, -0.54, -0.82], rot: ALONG_Z });
  }
  // Center slim overhead reinforcement strap tying both shoulder telemetry pods.
  b.solid(prism([
    [-0.05, -0.016], [0.05, -0.016], [0.04, 0.018], [-0.04, 0.018],
  ], 1.18, 0.006), PLATE, { at: [0, 0.625, -0.79], rot: ACROSS });
}

export function buildTwinCockpit(materials: ModelMaterials): CockpitVisual {
  const ext = new ModelBuilder();
  exterior(ext);
  const int = new ModelBuilder();
  interior(int);
  return {
    exterior: materials.group(ext),
    interior: materials.group(int, materials.nearby),
    hideStandardInterior: false,
    hideStandardVisor: false,
  };
}
