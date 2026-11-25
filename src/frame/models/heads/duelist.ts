/**
 * Duelist V-Crest Helmet (`headDuelist`): sharp angular armoured knight/samurai helmet with a sweeping twin V-fin
 * blade crest fanning out from a brass forehead crest gem, chiseled faceplate & chin guard, narrow glowing twin-eye
 * visor slits, and swept-back angular temple ear vents.
 */
import * as THREE from 'three';
import { clamp } from '../../../core/math';
import { ModelBuilder, type ModelMaterials } from '../../../progression/modelkit';
import {
  ACROSS, AMBER, BRASS, DARK, FLAT, GUNMETAL, IRON, OBSIDIAN, PLATE, RED, STEEL,
  frameBuilder, ngon, prism,
  type FramePalette, type HeadVisual,
} from '../shared';

function buildGeometry(b: ModelBuilder): void {
  // Armoured neck collar ring & twin hydraulic neck tendons.
  b.solid(prism(ngon(0.32, 8, Math.PI / 8), 0.16, 0.025), STEEL, { at: [0, 0.08, 0.02], rot: FLAT });
  for (const s of [-1, 1]) {
    b.cyl(0.055, 0.065, 0.24, 8, IRON, { at: [s * 0.19, 0.14, -0.02], rot: [0.16, 0, s * -0.14] });
  }

  // Sculpted angular knight/samurai helmet cranium (faceted swept crown).
  b.solid(prism([
    [-0.44, 0.14], [0.36, 0.12], [0.46, 0.44], [0.22, 0.78], [-0.28, 0.8], [-0.52, 0.48],
  ], 0.64, 0.045), PLATE, { rot: ACROSS });

  // Swept central dorsal mohawk ridge crest & rear optical camera pod.
  b.solid(prism([
    [-0.56, 0.56], [0.34, 0.66], [0.18, 0.94], [-0.46, 0.92], [-0.62, 0.72],
  ], 0.18, 0.022), OBSIDIAN, { rot: ACROSS });
  b.glow(new THREE.BoxGeometry(0.11, 0.055, 0.03), RED, 4.2, { at: [0, 0.79, -0.34] });
  b.glow(new THREE.BoxGeometry(0.11, 0.045, 0.03), AMBER, 3.6, { at: [0, 0.76, 0.54] });

  // Fierce overhanging angular brow visor hood.
  b.solid(prism([
    [0.12, 0.48], [0.58, 0.42], [0.46, 0.64], [0.12, 0.68],
  ], 0.68, 0.025), PLATE, { rot: ACROSS });

  // Deeply recessed dark optical visor cavity & narrow glowing twin-eye slits.
  b.box(0.56, 0.16, 0.12, DARK, { at: [0, 0.41, -0.44] });
  for (const s of [-1, 1]) {
    b.glow(new THREE.BoxGeometry(0.19, 0.055, 0.04), RED, 4.8, { at: [s * 0.14, 0.41, -0.49], rot: [0, s * -0.22, s * 0.12] });
  }

  // Sharp angular faceplate mask & chiseled lower chin guard.
  b.solid(prism([
    [0.18, 0.14], [0.5, 0.2], [0.44, 0.36], [0.18, 0.36],
  ], 0.38, 0.022), GUNMETAL, { rot: ACROSS });
  b.solid(prism([
    [0.34, 0.08], [0.54, 0.14], [0.48, 0.26], [0.32, 0.24],
  ], 0.16, 0.015), BRASS, { rot: ACROSS });

  // Central brass diamond forehead crest block anchoring the twin swept V-fin blades!
  b.solid(prism([
    [0, -0.09], [0.09, 0], [0, 0.12], [-0.09, 0],
  ], 0.1, 0.014), BRASS, { at: [0, 0.56, -0.52] });

  for (const s of [-1, 1]) {
    // Iconic swept twin V-fin blade crest fanning outward and upward (±0.68 m span, mirrored without negative scale).
    const mainFin: [number, number][] = s === 1
      ? [[0.02, -0.035], [0.68, 0.34], [0.64, 0.43], [-0.02, 0.055]]
      : [[-0.02, -0.035], [0.02, 0.055], [-0.64, 0.43], [-0.68, 0.34]];
    b.solid(prism(mainFin, 0.042, 0.008), BRASS, { at: [s * 0.04, 0.56, -0.54], rot: [0.14, s * 0.24, 0] });
    // Secondary razor inner crest sub-fin.
    const subFin: [number, number][] = s === 1
      ? [[0.02, -0.02], [0.42, 0.16], [0.38, 0.23], [-0.02, 0.04]]
      : [[-0.02, -0.02], [0.02, 0.04], [-0.38, 0.23], [-0.42, 0.16]];
    b.solid(prism(subFin, 0.03, 0.006), PLATE, { at: [s * 0.04, 0.64, -0.5], rot: [0.18, s * 0.26, 0] });

    // Angular flared cheek armor plates & swept-back ear exhaust vents!
    b.solid(prism([
      [-0.24, 0.16], [0.42, 0.18], [0.34, 0.46], [-0.32, 0.48],
    ], 0.12, 0.02), OBSIDIAN, { at: [s * 0.36, 0, 0], rot: [0, Math.PI / 2 + s * -0.14, 0] });
    const earQ = new THREE.Quaternion()
      .setFromEuler(new THREE.Euler(0, s * -0.22, s * -0.12, 'YXZ'))
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2));
    const earE = new THREE.Euler().setFromQuaternion(earQ, 'XYZ');
    b.solid(prism([
      [-0.3, -0.16], [0.32, -0.14], [0.22, 0.1], [-0.4, 0.16],
    ], 0.1, 0.016), GUNMETAL, { at: [s * 0.42, 0.48, 0.26], rot: [earE.x, earE.y, earE.z] });
    b.glow(new THREE.BoxGeometry(0.03, 0.035, 0.22), AMBER, 3.6, { at: [s * 0.47, 0.48, 0.18], rot: [0, s * -0.22, 0] });
  }
}

export function buildDuelistHead(materials: ModelMaterials, palette?: FramePalette): HeadVisual {
  const b = frameBuilder(palette);
  buildGeometry(b);
  const pivot = materials.group(b);
  pivot.name = 'head.duelist.pivot';

  const group = new THREE.Group();
  group.name = 'head.duelist';
  group.add(pivot);

  let smoothPitch = 0;
  let smoothYaw = 0;
  return {
    group,
    pose(aimYawDelta: number, aimPitch: number, dt: number, standby: boolean) {
      const k = Math.min(1, dt * 8);
      const targetPitch = standby ? -0.18 : clamp(aimPitch * 0.45, -0.32, 0.32);
      const targetYaw = standby ? 0 : clamp(aimYawDelta * 0.5, -0.45, 0.45);
      smoothPitch += (targetPitch - smoothPitch) * k;
      smoothYaw += (targetYaw - smoothYaw) * k;
      pivot.rotation.set(smoothPitch, smoothYaw, 0);
    },
  };
}
