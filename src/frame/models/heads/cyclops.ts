/**
 * Cyclops Recon Dome (`headCyclops`): armoured cylindrical turret dome with a deeply recessed wrap-around horizontal
 * visor track holding an animated gleaming mono-eye lens carriage (`RED` glow + brass focus ring), a right-side FLIR
 * rangefinder drum, and tall twin comms whip antennas on the left rear.
 */
import * as THREE from 'three';
import { clamp } from '../../../core/math';
import { ModelBuilder, type ModelMaterials } from '../../../progression/modelkit';
import {
  ACROSS, ALONG_Z, AMBER, BRASS, DARK, FLAT, GUNMETAL, IRON, OBSIDIAN, PLATE, RED, STEEL,
  frameBuilder, ngon, prism,
  type FramePalette, type HeadVisual,
} from '../shared';

function buildDome(b: ModelBuilder): void {
  // Heavy armoured turret neck ring & base flange.
  b.solid(prism(ngon(0.42, 12), 0.16, 0.025), STEEL, { at: [0, 0.08, 0], rot: FLAT });
  b.solid(prism(ngon(0.48, 12), 0.18, 0.03), OBSIDIAN, { at: [0, 0.22, 0], rot: FLAT });

  // Deeply recessed dark horizontal visor track core (allows the gleaming mono-eye to sweep left/right).
  b.cyl(0.38, 0.38, 0.24, 14, DARK, { at: [0, 0.42, 0] });
  // Rear half armoured collar wrapping behind the track so the recess opens only across the front ±70°.
  b.solid(prism([
    [-0.48, 0.28], [0.06, 0.28], [0.06, 0.56], [-0.48, 0.56],
  ], 0.94, 0.035), PLATE, { rot: ACROSS });

  // Armoured upper turret dome cap & chamfered top hatch ring.
  b.solid(prism(ngon(0.5, 12), 0.16, 0.03), PLATE, { at: [0, 0.6, 0], rot: FLAT });
  b.solid(prism(ngon(0.42, 12), 0.14, 0.035), GUNMETAL, { at: [0, 0.72, 0], rot: FLAT });
  b.solid(prism(ngon(0.24, 8, Math.PI / 8), 0.08, 0.02), OBSIDIAN, { at: [0, 0.81, -0.02], rot: FLAT });
  // Vertical central guard pillar & top brow overhang lip.
  b.solid(prism([
    [0.24, 0.54], [0.58, 0.52], [0.5, 0.66], [0.24, 0.68],
  ], 0.62, 0.02), OBSIDIAN, { rot: ACROSS });
  b.glow(new THREE.BoxGeometry(0.18, 0.03, 0.03), AMBER, 3.4, { at: [0, 0.64, -0.52] });

  // Right-side tactical FLIR / laser rangefinder drum pod with brass focus bezel.
  b.solid(prism([
    [-0.24, -0.14], [0.34, -0.14], [0.28, 0.16], [-0.22, 0.16],
  ], 0.24, 0.025), GUNMETAL, { at: [0.54, 0.46, -0.06], rot: ACROSS });
  b.cyl(0.11, 0.12, 0.22, 12, IRON, { at: [0.54, 0.46, -0.34], rot: ALONG_Z });
  b.cyl(0.12, 0.12, 0.05, 12, BRASS, { at: [0.54, 0.46, -0.44], rot: ALONG_Z });
  b.glow(new THREE.CylinderGeometry(0.065, 0.065, 0.03, 12), AMBER, 4.0, { at: [0.54, 0.46, -0.47], rot: ALONG_Z });

  // Left-side armoured comms blister & tall twin radio whip antennas.
  b.solid(prism([
    [-0.26, -0.14], [0.22, -0.14], [0.18, 0.18], [-0.24, 0.18],
  ], 0.18, 0.02), OBSIDIAN, { at: [-0.52, 0.48, 0.06], rot: ACROSS });
  b.cyl(0.028, 0.042, 0.96, 8, STEEL, { at: [-0.54, 1.06, 0.14], rot: [-0.14, 0, 0.08] });
  b.cyl(0.02, 0.03, 0.62, 8, IRON, { at: [-0.46, 0.88, 0.24], rot: [-0.18, 0, -0.04] });
  b.glow(new THREE.BoxGeometry(0.05, 0.05, 0.05), RED, 4.6, { at: [-0.58, 1.54, 0.21] });
}

function buildMonoEye(b: ModelBuilder): void {
  // Sleek articulated lens carriage mounted at radius z = -0.40 inside the recessed horizontal track.
  b.cyl(0.12, 0.135, 0.14, 14, IRON, { at: [0, 0.42, -0.4], rot: ALONG_Z });
  b.cyl(0.138, 0.138, 0.045, 14, BRASS, { at: [0, 0.42, -0.45], rot: ALONG_Z });
  b.cyl(0.095, 0.095, 0.04, 14, DARK, { at: [0, 0.42, -0.47], rot: ALONG_Z });
  // Gleaming glowing mono-eye iris lens!
  b.glow(new THREE.CylinderGeometry(0.075, 0.075, 0.035, 14), RED, 5.2, { at: [0, 0.42, -0.49], rot: ALONG_Z });
}

export function buildCyclopsHead(materials: ModelMaterials, palette?: FramePalette): HeadVisual {
  const domeB = frameBuilder(palette);
  buildDome(domeB);
  const eyeB = frameBuilder(palette);
  buildMonoEye(eyeB);

  const eyePivot = materials.group(eyeB);
  eyePivot.name = 'head.cyclops.eye';

  const headPivot = new THREE.Group();
  headPivot.name = 'head.cyclops.pivot';
  headPivot.add(materials.group(domeB), eyePivot);

  const group = new THREE.Group();
  group.name = 'head.cyclops';
  group.add(headPivot);

  let clock = 0;
  let eyeYaw = 0;
  let headPitch = 0;
  return {
    group,
    pose(aimYawDelta: number, aimPitch: number, dt: number, standby: boolean) {
      clock += dt;
      const k = Math.min(1, dt * 7);
      // Mono-eye subtly scans back and forth along its track when active, and tracks aim yaw!
      const scan = standby ? 0 : Math.sin(clock * 1.45) * 0.26;
      const targetEyeYaw = clamp(aimYawDelta * 0.75 + scan, -0.68, 0.68);
      const targetPitch = standby ? -0.14 : clamp(aimPitch * 0.35, -0.25, 0.25);
      eyeYaw += (targetEyeYaw - eyeYaw) * k;
      headPitch += (targetPitch - headPitch) * k;
      eyePivot.rotation.y = eyeYaw;
      headPivot.rotation.x = headPitch;
    },
  };
}
