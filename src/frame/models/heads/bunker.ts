/**
 * Bunker Demolition Cage (`headBunker`): heavy industrial demolition roll-cage helmet with welded vertical visor
 * grille bars protecting a deeply recessed wide amber optic bay, thick bolted brow plate, overhead roll-bars, and
 * twin heavy industrial temple work-lights.
 */
import * as THREE from 'three';
import { clamp } from '../../../core/math';
import { ModelBuilder, type ModelMaterials } from '../../../progression/modelkit';
import {
  ACROSS, ALONG_Z, AMBER, BRASS, DARK, FLAT, GUNMETAL, IRON, OBSIDIAN, PLATE, RED, STEEL,
  frameBuilder, ngon, prism,
  type FramePalette, type HeadVisual,
} from '../shared';

function buildGeometry(b: ModelBuilder): void {
  // Heavy squat steel collar base.
  b.solid(prism(ngon(0.44, 8, Math.PI / 8), 0.14, 0.025), STEEL, { at: [0, 0.07, 0], rot: FLAT });

  // Squat brutalist bolted industrial head block.
  b.solid(prism([
    [-0.46, 0.12], [0.46, 0.12], [0.52, 0.56], [0.36, 0.72], [-0.42, 0.72], [-0.52, 0.44],
  ], 0.84, 0.045), OBSIDIAN, { rot: ACROSS });

  // Thick bolted chamfered overhanging brow plate & upper crown armour slab.
  b.solid(prism([
    [-0.36, 0.62], [0.64, 0.58], [0.56, 0.76], [-0.34, 0.8],
  ], 0.9, 0.03), PLATE, { rot: ACROSS });
  // Bolted brass studs across the heavy brow plate.
  for (const x of [-0.34, -0.12, 0.12, 0.34]) {
    b.cyl(0.026, 0.026, 0.05, 8, BRASS, { at: [x, 0.68, -0.61], rot: ALONG_Z });
  }

  // Deeply recessed wide armoured amber optic bay!
  b.box(0.68, 0.24, 0.18, DARK, { at: [0, 0.4, -0.48] });
  b.glow(new THREE.BoxGeometry(0.58, 0.14, 0.04), AMBER, 4.4, { at: [0, 0.4, -0.53] });
  b.glow(new THREE.BoxGeometry(0.18, 0.05, 0.045), RED, 4.2, { at: [0, 0.4, -0.54] });

  // Heavy lower welded jaw bumper plate beneath the grille.
  b.solid(prism([
    [0.24, 0.12], [0.58, 0.14], [0.56, 0.28], [0.24, 0.28],
  ], 0.82, 0.022), GUNMETAL, { rot: ACROSS });

  // Welded cylindrical steel vertical visor grille bars + top/bottom horizontal cage tubes!
  for (const x of [-0.3, -0.1, 0.1, 0.3]) {
    b.cyl(0.026, 0.026, 0.34, 8, STEEL, { at: [x, 0.41, -0.61] });
  }
  b.cyl(0.032, 0.032, 0.88, 10, STEEL, { at: [0, 0.56, -0.61], rot: [0, 0, Math.PI / 2] });
  b.cyl(0.032, 0.032, 0.88, 10, STEEL, { at: [0, 0.26, -0.61], rot: [0, 0, Math.PI / 2] });

  // Overhead protective steel roll-cage hoops wrapping back across the helmet crown.
  for (const s of [-1, 1]) {
    b.cyl(0.036, 0.036, 0.96, 8, STEEL, { at: [s * 0.44, 0.82, -0.06], rot: [Math.PI / 2, 0, 0] });
    b.cyl(0.034, 0.034, 0.62, 8, IRON, { at: [s * 0.46, 0.52, -0.56], rot: [0.12, 0, 0] });
    b.cyl(0.034, 0.034, 0.62, 8, IRON, { at: [s * 0.46, 0.52, 0.42], rot: [-0.14, 0, 0] });
    b.cyl(0.052, 0.052, 0.08, 8, BRASS, { at: [s * 0.44, 0.82, -0.52], rot: [0, 0, Math.PI / 2] });

    // Heavy industrial side work-light / floodlight housings bolted to the temples!
    b.solid(prism([
      [-0.18, -0.12], [0.22, -0.12], [0.2, 0.12], [-0.16, 0.12],
    ], 0.2, 0.02), PLATE, { at: [s * 0.56, 0.44, -0.14], rot: ACROSS });
    b.cyl(0.085, 0.095, 0.12, 12, IRON, { at: [s * 0.56, 0.44, -0.36], rot: ALONG_Z });
    b.cyl(0.095, 0.095, 0.035, 12, BRASS, { at: [s * 0.56, 0.44, -0.41], rot: ALONG_Z });
    b.glow(new THREE.CylinderGeometry(0.068, 0.068, 0.03, 12), AMBER, 4.8, { at: [s * 0.56, 0.44, -0.43], rot: ALONG_Z });
  }
  b.cyl(0.034, 0.034, 0.92, 8, STEEL, { at: [0, 0.82, 0.42], rot: [0, 0, Math.PI / 2] });
  b.cyl(0.034, 0.034, 0.92, 8, STEEL, { at: [0, 0.82, -0.52], rot: [0, 0, Math.PI / 2] });
}

export function buildBunkerHead(materials: ModelMaterials, palette?: FramePalette): HeadVisual {
  const b = frameBuilder(palette);
  buildGeometry(b);
  const pivot = materials.group(b);
  pivot.name = 'head.bunker.pivot';

  const group = new THREE.Group();
  group.name = 'head.bunker';
  group.add(pivot);

  let smoothPitch = 0;
  let smoothYaw = 0;
  return {
    group,
    pose(aimYawDelta: number, aimPitch: number, dt: number, standby: boolean) {
      const k = Math.min(1, dt * 5);
      const targetPitch = standby ? -0.1 : clamp(aimPitch * 0.25, -0.2, 0.2);
      const targetYaw = standby ? 0 : clamp(aimYawDelta * 0.3, -0.28, 0.28);
      smoothPitch += (targetPitch - smoothPitch) * k;
      smoothYaw += (targetYaw - smoothYaw) * k;
      pivot.rotation.set(smoothPitch, smoothYaw, 0);
    },
  };
}
