/**
 * Pile-Driver Legs 3D model: massive squared-off hydraulic siege columns,
 * thick armoured knee blast shields, bright brass/steel telescoping pile-driver rams,
 * and oversized broad hydraulic stomp pads.
 */
import * as THREE from 'three';
import { clamp } from '../../core/math';
import { ModelBuilder, type ModelMaterials } from '../../progression/modelkit';
import {
  ACROSS, AMBER, BRASS, DARK, FLAT, GUNMETAL, IRON, OBSIDIAN, PLATE, STEEL,
  frameBuilder, ngon, prism, type FramePalette, type LegsVisual,
} from './shared';

const HIP_DROP = 0.26;
const KNEE_Y = -1.16;
const KNEE_Z = -0.42;

function buildPelvis(b: ModelBuilder, hipsY: number): void {
  const y = hipsY - 0.18;
  // Thick reinforced siege waist bearing ring.
  b.solid(prism(ngon(1.18, 8, Math.PI / 8), 0.3, 0.045), STEEL, { at: [0, hipsY, 0.16], rot: FLAT });
  // Broad heavy bevelled pelvis bunker.
  b.solid(prism([
    [-1.02, -0.68], [1.06, -0.56], [1.22, -0.02], [0.92, 0.24], [-0.94, 0.24], [-1.1, -0.18],
  ], 1.92, 0.07), OBSIDIAN, { at: [0, y - 0.16, 0.16], rot: ACROSS });
  // Sloped frontal codpiece glacis plate.
  b.solid(prism([
    [0.52, -0.78], [1.18, -0.62], [1.28, -0.06], [0.68, 0.08],
  ], 1.04, 0.05), PLATE, { at: [0, y - 0.16, 0.16], rot: ACROSS });
  // Twin armoured hip-skirt blast shields with amber hazard trim.
  for (const s of [-1, 1]) {
    b.solid(prism([
      [-0.78, -0.52], [0.84, -0.46], [0.76, 0.16], [-0.72, 0.18],
    ], 0.22, 0.035), PLATE, { at: [s * 1.12, y - 0.22, 0.16], rot: ACROSS });
    b.glow(new THREE.BoxGeometry(0.04, 0.045, 0.88), AMBER, 3.2, { at: [s * 1.24, y - 0.56, 0.16] });
  }
  // Massive transverse hip trunnion drum + brass thrust collars.
  b.cyl(0.42, 0.42, 2.74, 14, IRON, { at: [0, hipsY - HIP_DROP, 0.16], rot: [0, 0, Math.PI / 2] });
  for (const s of [-1, 1]) {
    b.cyl(0.47, 0.47, 0.22, 14, BRASS, { at: [s * 0.98, hipsY - HIP_DROP, 0.16], rot: [0, 0, Math.PI / 2] });
  }
}

function buildThigh(b: ModelBuilder, s: number): void {
  // Heavy hip hub cap.
  b.cyl(0.44, 0.44, 0.5, 14, STEEL, { at: [s * 0.04, 0, 0], rot: [0, 0, Math.PI / 2] });
  // Squared-off heavy bevelled thigh block: hip (0,0,0) -> knee (0, KNEE_Y, KNEE_Z).
  const midY = KNEE_Y * 0.5;
  const midZ = KNEE_Z * 0.5;
  const pitch = Math.atan2(-KNEE_Z, -KNEE_Y);
  b.solid(prism([
    [-0.46, -0.72], [0.46, -0.72], [0.5, 0.72], [-0.5, 0.72],
  ], 0.92, 0.06), OBSIDIAN, { at: [s * 0.04, midY, midZ], rot: [pitch, 0, 0] });
  // Thick outer reactive armour skirt plate + recessed bolt ribs.
  b.solid(prism([
    [-0.4, -0.66], [0.44, -0.64], [0.48, 0.58], [-0.36, 0.64],
  ], 0.24, 0.045), PLATE, { at: [s * 0.48, midY, midZ], rot: ACROSS });
  b.box(0.08, 0.9, 0.16, IRON, { at: [s * 0.6, midY, midZ - 0.18], rot: [pitch, 0, 0] });
  b.box(0.08, 0.9, 0.16, IRON, { at: [s * 0.6, midY, midZ + 0.18], rot: [pitch, 0, 0] });
  // Twin heavy brass hydraulic cylinders flanking front & rear of thigh.
  b.cyl(0.12, 0.12, 1.1, 10, BRASS, { at: [s * -0.1, midY + 0.06, midZ + 0.34], rot: [pitch, 0, 0] });
  b.cyl(0.085, 0.085, 1.32, 10, STEEL, { at: [s * -0.1, midY - 0.06, midZ + 0.34], rot: [pitch, 0, 0] });
  b.cyl(0.1, 0.1, 0.96, 10, BRASS, { at: [s * 0.14, midY + 0.08, midZ - 0.34], rot: [pitch, 0, 0] });

  // Heavy transverse knee drum.
  b.cyl(0.42, 0.42, 0.96, 14, IRON, { at: [0, KNEE_Y, KNEE_Z], rot: [0, 0, Math.PI / 2] });
  // Oversized forward-jutting hexagonal knee blast shield.
  b.solid(prism([
    [-0.14, -0.58], [0.48, -0.44], [0.58, 0.04], [0.44, 0.52], [-0.1, 0.58], [-0.26, 0.18],
  ], 1.02, 0.06), PLATE, { at: [0, KNEE_Y + 0.04, KNEE_Z - 0.32], rot: ACROSS });
  b.solid(prism([
    [0.14, -0.44], [0.54, -0.34], [0.62, 0.04], [0.5, 0.4], [0.16, 0.44],
  ], 0.72, 0.04), OBSIDIAN, { at: [0, KNEE_Y + 0.04, KNEE_Z - 0.36], rot: ACROSS });
  b.glow(new THREE.BoxGeometry(0.62, 0.055, 0.035), AMBER, 3.8, { at: [0, KNEE_Y + 0.24, KNEE_Z - 0.96] });
}

function buildUpperSleeve(b: ModelBuilder, s: number): void {
  // Squared-off armoured pile-driver outer sleeve housing (open channels reveal the bright rams inside).
  b.solid(prism([
    [-0.44, -0.92], [0.44, -0.92], [0.48, 0.76], [-0.48, 0.76],
  ], 0.94, 0.06), OBSIDIAN, { at: [0, -0.78, 0.2], rot: [0, 0, 0] });
  // Layered heavy outer & inner fender plates.
  for (const fs of [-1, 1]) {
    b.solid(prism([
      [-0.42, -0.82], [0.46, -0.82], [0.5, 0.62], [-0.46, 0.62],
    ], 0.22, 0.04), PLATE, { at: [fs * 0.48, -0.76, 0.2], rot: ACROSS });
  }
  // Rear hydraulic accumulator manifold drum + brass feed tubes.
  b.solid(prism([
    [-0.36, -0.68], [0.18, -0.68], [0.22, 0.54], [-0.32, 0.6],
  ], 0.76, 0.045), GUNMETAL, { at: [0, -0.66, 0.68], rot: ACROSS });
  for (const rs of [-1, 1]) {
    b.cyl(0.13, 0.13, 1.38, 12, BRASS, { at: [rs * 0.26, -0.76, -0.22] });
    b.cyl(0.16, 0.16, 0.22, 12, IRON, { at: [rs * 0.26, -1.36, -0.22] });
    b.cyl(0.11, 0.11, 1.15, 10, BRASS, { at: [rs * 0.24, -0.72, 0.78] });
  }
  // Side caution beacon strip on outer sleeve.
  b.glow(new THREE.BoxGeometry(0.04, 0.06, 0.64), AMBER, 3.6, { at: [s * 0.6, -1.32, 0.2] });
}

function buildPileDriverFoot(b: ModelBuilder, footY: number): void {
  const padTop = footY + 0.48;
  // Bright gleaming twin front + rear telescoping hydraulic pile-driver rams rising into sleeve.
  for (const rs of [-1, 1]) {
    b.cyl(0.105, 0.105, 1.55, 12, STEEL, { at: [rs * 0.26, padTop + 0.62, -0.22] });
    b.cyl(0.14, 0.14, 0.34, 12, BRASS, { at: [rs * 0.26, padTop + 0.18, -0.22] });
    b.cyl(0.095, 0.095, 1.45, 10, STEEL, { at: [rs * 0.24, padTop + 0.58, 0.52] });
  }
  // Massive central hydraulic ram shaft.
  b.cyl(0.24, 0.26, 1.35, 14, STEEL, { at: [0, padTop + 0.54, 0.18] });
  b.cyl(0.32, 0.32, 0.28, 14, IRON, { at: [0, padTop + 0.08, 0.18] });

  // Oversized broad hydraulic stomp pad — sole flush at y = footY (world y = 0.0).
  b.solid(prism([
    [-0.94, -0.18], [1.02, -0.18], [0.88, 0.26], [-0.82, 0.26],
  ], 1.28, 0.05), OBSIDIAN, { at: [0, footY + 0.22, 0.18], rot: ACROSS });
  // Sloped bevelled upper stomp-skirt carapace.
  b.solid(prism([
    [-0.86, -0.06], [0.96, -0.06], [0.76, 0.24], [-0.68, 0.24],
  ], 1.18, 0.04), PLATE, { at: [0, footY + 0.36, 0.18], rot: ACROSS });
  // Four splayed hydraulic ground-anchor claws gripping the corners of the stomp pad.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.solid(prism([
        [-0.22, -0.1], [0.34, -0.1], [0.24, 0.16], [-0.14, 0.2],
      ], 0.3, 0.025), GUNMETAL, {
        at: [sx * 0.56, footY + 0.14, 0.18 + sz * 0.86],
        rot: [0, sz < 0 ? Math.PI / 2 - sx * 0.28 : -Math.PI / 2 + sx * 0.28, 0],
      });
    }
  }
  // Heavy shock-absorber impact sole plate flush at y = footY.
  b.box(1.22, 0.06, 1.88, DARK, { at: [0, footY + 0.03, 0.18] });
  // Front & rear amber impact-warning strips on stomp pad skirt.
  b.glow(new THREE.BoxGeometry(0.76, 0.045, 0.035), AMBER, 3.6, { at: [0, footY + 0.26, -0.84] });
  b.glow(new THREE.BoxGeometry(0.68, 0.045, 0.035), AMBER, 3.0, { at: [0, footY + 0.26, 1.14] });
}

interface HeavySide {
  readonly hip: THREE.Group;
  readonly shin: THREE.Group;
  readonly ram: THREE.Group;
  readonly side: -1 | 1;
}

export function buildHeavyLegs(materials: ModelMaterials, hipsY: number, palette?: FramePalette): LegsVisual {
  const group = new THREE.Group();
  group.name = 'frame.legs.heavy';

  const pelvisBuilder = frameBuilder(palette);
  buildPelvis(pelvisBuilder, hipsY);
  const pelvisGroup = materials.group(pelvisBuilder);
  group.add(pelvisGroup);

  const hipBaseY = hipsY - HIP_DROP;
  const footY = -(hipBaseY + KNEE_Y);
  const sides: HeavySide[] = [];

  for (const s of [-1, 1] as const) {
    const hip = new THREE.Group();
    hip.position.set(s * 1.24, hipBaseY, 0.16);
    const thighB = frameBuilder(palette);
    buildThigh(thighB, s);
    hip.add(materials.group(thighB));

    const shin = new THREE.Group();
    shin.position.set(0, KNEE_Y, KNEE_Z);
    const sleeveB = frameBuilder(palette);
    buildUpperSleeve(sleeveB, s);
    shin.add(materials.group(sleeveB));

    const ram = new THREE.Group();
    const footB = frameBuilder(palette);
    buildPileDriverFoot(footB, footY);
    ram.add(materials.group(footB));
    shin.add(ram);

    hip.add(shin);
    group.add(hip);
    sides.push({ hip, shin, ram, side: s });
  }

  return {
    group,
    pose(stride, walk, effectiveSink, kneel, collapse, limpSide, parked, jetMode): void {
      const w = clamp(walk);
      const sinkY = clamp(effectiveSink * 0.85, -1.9, 0.45);
      pelvisGroup.position.y = sinkY;
      pelvisGroup.rotation.x = jetMode ? -0.25 : collapse * 0.26;

      // Telescoping pile-driver ram compression under landing/stomp/kneel load.
      const ramCompress = clamp(-effectiveSink * 0.42 + kneel * 0.35 + collapse * 0.45, 0, 0.85);
      const crouchHip = kneel * 0.36 + collapse * 0.52 + (parked ? 0.1 : 0);

      for (let i = 0; i < sides.length; i++) {
        const leg = sides[i]!;
        const u = ((stride + i) % 2 + 2) % 2 / 2;
        const planted = u < 0.5;
        const k = planted ? u * 2 : (u - 0.5) * 2;
        const isLimping = leg.side === limpSide;
        const limpMult = isLimping ? 0.5 : 1;

        if (jetMode) {
          leg.hip.position.y = hipBaseY + sinkY * 0.4;
          leg.hip.rotation.x = 0.85;
          leg.shin.rotation.x = -0.55;
          leg.ram.position.y = 0.55;
          continue;
        }

        const swingAmp = 0.22 * w * limpMult;
        const strideHip = planted ? swingAmp * (1 - 2 * k) : swingAmp * (2 * k - 1);
        const lift = planted ? 0 : Math.sin(k * Math.PI) * clamp(w * 2) * limpMult;
        leg.hip.position.y = hipBaseY + sinkY * 0.5 + lift * 0.34;
        leg.hip.rotation.x = (parked ? 0.06 : strideHip) + crouchHip;
        leg.shin.rotation.x = -crouchHip * 0.85 - strideHip * 0.45;
        // Pile-driver ram retracts cleanly on lift and slams down on plant; compresses under weight.
        leg.ram.position.y = ramCompress + lift * 0.28;
      }
    },
  };
}
