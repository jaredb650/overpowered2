/**
 * Stealth Arrowhead Hood (`headStealth`): wide low-profile faceted stealth-aircraft radar head (flat diamond delta
 * wedge with zero protruding chin), razor-thin recessed horizontal sensor slit, and twin swept-back blade antennae.
 */
import * as THREE from 'three';
import { clamp } from '../../../core/math';
import { ModelBuilder, type ModelMaterials } from '../../../progression/modelkit';
import {
  ACROSS, AMBER, BRASS, DARK, FLAT, GUNMETAL, IRON, OBSIDIAN, PLATE, RED, STEEL,
  frameBuilder, ngon, prism,
  type FramePalette, type HeadVisual,
} from '../shared';

const _yAxis = new THREE.Vector3(0, 1, 0);
function acrossRot(roll = 0, yaw = 0, pitch = 0): [number, number, number] {
  const q = new THREE.Quaternion()
    .setFromEuler(new THREE.Euler(pitch, yaw, -roll, 'YXZ'))
    .multiply(new THREE.Quaternion().setFromAxisAngle(_yAxis, Math.PI / 2));
  const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
  return [e.x, e.y, e.z];
}

function buildGeometry(b: ModelBuilder): void {
  // Ultra-low flush gimbal collar tucked cleanly onto the torso neck socket.
  b.solid(prism(ngon(0.32, 8, Math.PI / 8), 0.1, 0.018), IRON, { at: [0, 0.05, 0], rot: FLAT });

  // Wide low-profile faceted diamond delta-wedge main radar hood (with FLAT: +y maps to -Z forward; no chin protrusion!).
  b.solid(prism([
    [0, 0.78], [-0.64, 0.04], [-0.46, -0.44], [0, -0.56], [0.46, -0.44], [0.64, 0.04],
  ], 0.22, 0.035), OBSIDIAN, { at: [0, 0.22, -0.04], rot: FLAT });

  // Faceted upper stealth-chined armor crown tapering to a crisp forward prow ridge.
  b.solid(prism([
    [0, 0.66], [-0.48, -0.02], [-0.34, -0.38], [0, -0.46], [0.34, -0.38], [0.48, -0.02],
  ], 0.12, 0.028), PLATE, { at: [0, 0.32, -0.02], rot: FLAT });

  // Sharp forward radar-deflecting nose spine & micro-sensor bevel.
  b.solid(prism([
    [-0.44, 0.24], [0.68, 0.18], [0.44, 0.36], [-0.38, 0.42],
  ], 0.16, 0.018), GUNMETAL, { rot: ACROSS });

  // Deeply recessed horizontal razor sensor cavity wrapping the sharp front diamond bevels.
  b.solid(prism([
    [0, 0.77], [-0.54, 0.14], [-0.44, 0.06], [0, 0.64], [0.44, 0.06], [0.54, 0.14],
  ], 0.09, 0.01), DARK, { at: [0, 0.21, -0.04], rot: FLAT });

  // Razor-thin glowing V-chevron horizontal sensor slit along the leading diamond edges!
  for (const s of [-1, 1]) {
    b.glow(new THREE.BoxGeometry(0.46, 0.032, 0.03), RED, 4.8, {
      at: [s * 0.24, 0.21, -0.58],
      rot: [0, s * -0.84, 0],
    });
    // Subtle secondary amber phase-array calibration ticks on outer diamond cheeks.
    b.glow(new THREE.BoxGeometry(0.16, 0.024, 0.028), AMBER, 3.6, {
      at: [s * 0.5, 0.22, -0.22],
      rot: [0, s * -0.84, 0],
    });
    // Micro-pitot airspeed/lock probe jutting cleanly from the outer flank.
    b.cyl(0.012, 0.018, 0.26, 6, BRASS, { at: [s * 0.58, 0.18, -0.18], rot: [Math.PI / 2, 0, 0] });

    // Twin swept-back razor stealth blade antennae flaring low and outward!
    const finRot = acrossRot(s * 0.55, s * -0.18);
    b.solid(prism([
      [-0.64, 0.0], [0.1, 0.02], [-0.04, 0.18], [-0.78, 0.24],
    ], 0.038, 0.008), PLATE, { at: [s * 0.42, 0.24, 0.12], rot: finRot });
    b.solid(prism([
      [-0.54, 0.04], [0.02, 0.06], [-0.08, 0.15], [-0.66, 0.18],
    ], 0.018, 0.005), STEEL, { at: [s * 0.46, 0.24, 0.12], rot: finRot });
  }
}

export function buildStealthHead(materials: ModelMaterials, palette?: FramePalette): HeadVisual {
  const b = frameBuilder(palette);
  buildGeometry(b);
  const pivot = materials.group(b);
  pivot.name = 'head.stealth.pivot';

  const group = new THREE.Group();
  group.name = 'head.stealth';
  group.add(pivot);

  let smoothPitch = 0;
  let smoothYaw = 0;
  return {
    group,
    pose(aimYawDelta: number, aimPitch: number, dt: number, standby: boolean) {
      const k = Math.min(1, dt * 9);
      const targetPitch = standby ? -0.06 : clamp(aimPitch * 0.28, -0.2, 0.2);
      const targetYaw = standby ? 0 : clamp(aimYawDelta * 0.4, -0.35, 0.35);
      smoothPitch += (targetPitch - smoothPitch) * k;
      smoothYaw += (targetYaw - smoothYaw) * k;
      pivot.rotation.set(smoothPitch, smoothYaw, 0);
    },
  };
}
