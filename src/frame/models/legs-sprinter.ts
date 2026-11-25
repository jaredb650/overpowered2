/**
 * Sprinter Legs 3D model: sleek, bird-like digitigrade / reverse-jointed hydraulic legs.
 * High backward hock joints, slim carbon-dark thigh spars, aerodynamic outer fairings,
 * brass/steel jump-actuator pistons, spring-bladed thruster feet, and clean aft fold in `jetMode`.
 */
import * as THREE from 'three';
import { clamp } from '../../core/math';
import { ModelBuilder, type ModelMaterials } from '../../progression/modelkit';
import {
  ACROSS, AMBER, BRASS, DARK, FLAT, GUNMETAL, IRON, OBSIDIAN, PLATE, RED, STEEL,
  frameBuilder, ngon, prism, type FramePalette, type LegsVisual,
} from './shared';

const HIP_DROP = 0.22;
const KNEE_Y = -1.05;
const KNEE_Z = -0.82;

function buildPelvis(b: ModelBuilder, hipsY: number): void {
  const y = hipsY - 0.14;
  // Compact octagonal waist bearing ring flush with torso belly.
  b.solid(prism(ngon(0.96, 8, Math.PI / 8), 0.24, 0.035), STEEL, { at: [0, hipsY, 0.18], rot: FLAT });
  // Tapered aero-wedge central pelvis chassis.
  b.solid(prism([
    [-0.74, -0.44], [0.76, -0.34], [0.96, 0.06], [0.62, 0.24], [-0.66, 0.24], [-0.94, -0.06],
  ], 1.24, 0.05), OBSIDIAN, { at: [0, y - 0.08, 0.18], rot: ACROSS });
  // Sculpted forward codpiece keel.
  b.solid(prism([
    [0.36, -0.54], [0.92, -0.38], [1.02, 0.02], [0.54, 0.14],
  ], 0.56, 0.035), PLATE, { at: [0, y - 0.08, 0.18], rot: ACROSS });
  // Swept-back aero stabilizer tail fins on rear pelvis.
  for (const s of [-1, 1]) {
    b.solid(prism([
      [-1.18, -0.18], [-0.46, -0.26], [-0.42, 0.12], [-0.98, 0.2],
    ], 0.12, 0.02), GUNMETAL, { at: [s * 0.44, y - 0.06, 0.24], rot: ACROSS });
    b.glow(new THREE.BoxGeometry(0.035, 0.03, 0.48), RED, 3.6, { at: [s * 0.52, y - 0.02, 0.92] });
  }
  // High-torque hip axle bar with brass actuator collars.
  b.cyl(0.26, 0.26, 2.04, 14, IRON, { at: [0, hipsY - HIP_DROP, 0.2], rot: [0, 0, Math.PI / 2] });
  for (const s of [-1, 1]) {
    b.cyl(0.32, 0.32, 0.16, 12, BRASS, { at: [s * 0.72, hipsY - HIP_DROP, 0.2], rot: [0, 0, Math.PI / 2] });
  }
}

function buildThigh(b: ModelBuilder, s: number): void {
  // Slim articulated hip drum.
  b.cyl(0.3, 0.3, 0.34, 14, STEEL, { at: [s * 0.02, 0, 0], rot: [0, 0, Math.PI / 2] });
  // Carbon-dark swept-forward thigh spar: hip (0,0,0) -> knee (0, KNEE_Y, KNEE_Z).
  b.solid(prism([
    [-0.18, -0.68], [0.22, -0.68], [0.24, 0.68], [-0.2, 0.68],
  ], 0.42, 0.04), OBSIDIAN, { at: [s * 0.02, KNEE_Y * 0.5, KNEE_Z * 0.5], rot: [0.66, 0, 0] });
  // Sleek outer aerodynamic fairing winglet with forward taper.
  b.solid(prism([
    [-0.12, -0.74], [0.28, -0.58], [0.34, 0.46], [-0.04, 0.66], [-0.22, 0.32],
  ], 0.16, 0.03), PLATE, { at: [s * 0.26, KNEE_Y * 0.52, KNEE_Z * 0.52], rot: ACROSS });
  b.glow(new THREE.BoxGeometry(0.03, 0.035, 0.78), RED, 3.8, { at: [s * 0.36, KNEE_Y * 0.46, KNEE_Z * 0.52], rot: [0.66, 0, 0] });
  // Dual slim brass & steel jump-launch hydraulic pistons behind the spar.
  b.cyl(0.06, 0.06, 1.18, 10, STEEL, { at: [s * -0.04, KNEE_Y * 0.52, KNEE_Z * 0.26], rot: [0.66, 0, 0] });
  b.cyl(0.095, 0.095, 0.42, 10, BRASS, { at: [s * -0.04, KNEE_Y * 0.36, KNEE_Z * 0.16], rot: [0.66, 0, 0] });
  // Forward knee pivot drum & razor chamfered knee guard.
  b.cyl(0.27, 0.27, 0.54, 14, IRON, { at: [0, KNEE_Y, KNEE_Z], rot: [0, 0, Math.PI / 2] });
  b.solid(prism([
    [-0.08, -0.32], [0.34, -0.14], [0.42, 0.16], [0.12, 0.36], [-0.14, 0.22],
  ], 0.44, 0.035), PLATE, { at: [0, KNEE_Y + 0.02, KNEE_Z - 0.12], rot: ACROSS });
  b.glow(new THREE.BoxGeometry(0.28, 0.032, 0.028), AMBER, 3.6, { at: [0, KNEE_Y + 0.1, KNEE_Z - 0.44] });
}

function buildShin(b: ModelBuilder, s: number, footY: number): void {
  const hockY = footY * 0.46;
  const hockZ = 1.24;
  const ankleY = footY + 0.34;
  const ankleZ = 0.72;

  // Long swept-back digitigrade upper shin: (0, 0, 0) -> high backward hock (0, hockY, hockZ).
  const upperMidY = hockY * 0.5;
  const upperMidZ = hockZ * 0.5;
  const upperLen = Math.hypot(hockY, hockZ);
  const upperPitch = -Math.atan2(hockZ, -hockY);
  b.solid(prism([
    [-0.17, -upperLen * 0.5], [0.17, -upperLen * 0.5], [0.22, upperLen * 0.5], [-0.22, upperLen * 0.5],
  ], 0.36, 0.035), GUNMETAL, { at: [0, upperMidY, upperMidZ], rot: [upperPitch, 0, 0] });
  // Front swept aero shin blade.
  b.solid(prism([
    [-0.14, -upperLen * 0.42], [0.14, -upperLen * 0.42], [0.18, upperLen * 0.44], [-0.18, upperLen * 0.44],
  ], 0.18, 0.03), PLATE, { at: [0, upperMidY - 0.06, upperMidZ - 0.14], rot: [upperPitch, 0, 0] });
  // Exposed carbon-spring tendon piston along back of shin.
  b.cyl(0.055, 0.055, upperLen * 0.92, 10, STEEL, { at: [0, upperMidY + 0.06, upperMidZ + 0.22], rot: [upperPitch, 0, 0] });
  b.cyl(0.09, 0.09, 0.44, 10, BRASS, { at: [0, upperMidY + 0.18, upperMidZ + 0.08], rot: [upperPitch, 0, 0] });

  // Prominent high backward-pointing hock joint + aerodynamic spur fin.
  b.cyl(0.24, 0.24, 0.48, 12, IRON, { at: [0, hockY, hockZ], rot: [0, 0, Math.PI / 2] });
  b.solid(prism([
    [-0.54, -0.14], [0.18, -0.22], [0.24, 0.16], [-0.42, 0.28],
  ], 0.34, 0.03), PLATE, { at: [0, hockY + 0.06, hockZ + 0.12], rot: ACROSS });
  b.glow(new THREE.BoxGeometry(0.03, 0.04, 0.32), AMBER, 3.4, { at: [s * 0.19, hockY + 0.14, hockZ + 0.3] });

  // Slim spring-loaded lower metatarsus strut: hock -> ankle.
  const lowDy = ankleY - hockY;
  const lowDz = ankleZ - hockZ;
  const lowLen = Math.hypot(lowDy, lowDz);
  const lowPitch = -Math.atan2(lowDz, -lowDy);
  b.solid(prism([
    [-0.12, -lowLen * 0.5], [0.12, -lowLen * 0.5], [0.16, lowLen * 0.5], [-0.16, lowLen * 0.5],
  ], 0.28, 0.025), STEEL, { at: [0, (hockY + ankleY) * 0.5, (hockZ + ankleZ) * 0.5], rot: [lowPitch, 0, 0] });
  // Secondary spring-steel damper rod parallel to metatarsus.
  b.cyl(0.045, 0.045, lowLen * 0.88, 8, BRASS, { at: [0, (hockY + ankleY) * 0.5, (hockZ + ankleZ) * 0.5 - 0.16], rot: [lowPitch, 0, 0] });

  // Ankle gimbal + compact jump-assist thruster nozzle tucked aft.
  b.cyl(0.2, 0.2, 0.46, 12, IRON, { at: [0, ankleY, ankleZ], rot: [0, 0, Math.PI / 2] });
  b.cyl(0.11, 0.16, 0.28, 10, GUNMETAL, { at: [0, ankleY + 0.06, ankleZ + 0.26], rot: [0.38, 0, 0] });
  b.glow(new THREE.CylinderGeometry(0.09, 0.12, 0.04, 10), AMBER, 4.0, { at: [0, ankleY - 0.06, ankleZ + 0.32], rot: [0.38, 0, 0] });

  // Spring-bladed thruster foot: bottom sole flush at y = footY (world y = 0.0).
  const soleY = footY;
  // Curved carbon-steel foot bridge.
  b.solid(prism([
    [-0.36, -0.06], [0.68, -0.08], [0.54, 0.18], [-0.24, 0.2],
  ], 0.54, 0.025), OBSIDIAN, { at: [0, soleY + 0.14, ankleZ - 0.08], rot: ACROSS });
  // Twin swept spring-runner front blades.
  for (const ts of [-1, 1]) {
    b.solid(prism([
      [0.08, -0.08], [1.14, -0.08], [1.22, 0.03], [0.92, 0.14], [0.22, 0.2],
    ], 0.19, 0.02), PLATE, { at: [ts * 0.25, soleY + 0.1, ankleZ - 0.06], rot: [0, Math.PI / 2 - ts * 0.1, 0] });
    // High-grip runner pad flush at soleY.
    b.box(0.18, 0.04, 0.78, DARK, { at: [ts * 0.28, soleY + 0.02, ankleZ - 0.72], rot: [0, -ts * 0.1, 0] });
  }
  // Compact rear recoil heel blade flush at soleY.
  b.solid(prism([
    [-0.78, -0.08], [-0.16, -0.08], [-0.2, 0.12], [-0.66, 0.06],
  ], 0.26, 0.02), GUNMETAL, { at: [0, soleY + 0.1, ankleZ + 0.04], rot: ACROSS });
  b.box(0.24, 0.04, 0.42, DARK, { at: [0, soleY + 0.02, ankleZ + 0.56] });
}

interface SprinterSide {
  readonly hip: THREE.Group;
  readonly shin: THREE.Group;
  readonly side: -1 | 1;
}

export function buildSprinterLegs(materials: ModelMaterials, hipsY: number, palette?: FramePalette): LegsVisual {
  const group = new THREE.Group();
  group.name = 'frame.legs.sprinter';

  const pelvisBuilder = frameBuilder(palette);
  buildPelvis(pelvisBuilder, hipsY);
  const pelvisGroup = materials.group(pelvisBuilder);
  group.add(pelvisGroup);

  const hipBaseY = hipsY - HIP_DROP;
  const footY = -(hipBaseY + KNEE_Y);
  const sides: SprinterSide[] = [];

  for (const s of [-1, 1] as const) {
    const hip = new THREE.Group();
    hip.position.set(s * 0.96, hipBaseY, 0.2);
    const thighB = frameBuilder(palette);
    buildThigh(thighB, s);
    hip.add(materials.group(thighB));

    const shin = new THREE.Group();
    shin.position.set(0, KNEE_Y, KNEE_Z);
    const shinB = frameBuilder(palette);
    buildShin(shinB, s, footY);
    shin.add(materials.group(shinB));
    hip.add(shin);

    group.add(hip);
    sides.push({ hip, shin, side: s });
  }

  return {
    group,
    pose(stride, walk, effectiveSink, kneel, collapse, limpSide, parked, jetMode): void {
      const w = clamp(walk);
      const sinkY = clamp(effectiveSink * 0.85, -2.0, 0.5);
      pelvisGroup.position.y = sinkY;
      pelvisGroup.rotation.x = jetMode ? -0.35 : collapse * 0.22;

      const crouchHip = kneel * 0.46 + collapse * 0.62 + (parked ? 0.16 : 0) + clamp(-effectiveSink * 0.18, 0, 0.35);
      const crouchShin = -crouchHip * 1.15;

      for (let i = 0; i < sides.length; i++) {
        const leg = sides[i]!;
        const u = ((stride + i) % 2 + 2) % 2 / 2;
        const planted = u < 0.5;
        const k = planted ? u * 2 : (u - 0.5) * 2;
        const isLimping = leg.side === limpSide;
        const limpMult = isLimping ? 0.55 : 1;

        if (jetMode) {
          // Fold reverse-jointed legs neatly back into aerodynamic jet nacelles.
          leg.hip.position.y = hipBaseY + sinkY * 0.5;
          leg.hip.rotation.x = 1.12;
          leg.shin.rotation.x = -1.32;
          continue;
        }

        const swingAmp = 0.42 * w * limpMult;
        const strideHip = planted ? swingAmp * (1 - 2 * k) : swingAmp * (2 * k - 1);
        const lift = planted ? 0 : Math.sin(k * Math.PI) * clamp(w * 2) * limpMult;
        leg.hip.position.y = hipBaseY + sinkY * 0.55 + lift * 0.42;
        leg.hip.rotation.x = (parked ? 0.1 : strideHip) + crouchHip - lift * 0.18;
        leg.shin.rotation.x = crouchShin + lift * 0.52 - (planted ? Math.sin(k * Math.PI) * 0.12 * w : 0);
      }
    },
  };
}
