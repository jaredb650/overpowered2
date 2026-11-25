/**
 * Spider Legs 3D model: articulated 4-leg industrial quadruped walker (FL, FR, RL, RR at ±45° / ±135°).
 * Each leg has an armoured coxa gimbal, an elevated bevelled femur truss with brass hydraulic lifters,
 * and a pointed hydraulic climbing tibia animating in an alternating diagonal quadruped gait.
 */
import * as THREE from 'three';
import { clamp } from '../../core/math';
import { ModelBuilder, type ModelMaterials } from '../../progression/modelkit';
import {
  AMBER, BRASS, DARK, FLAT, GUNMETAL, IRON, OBSIDIAN, PLATE, RED, STEEL,
  frameBuilder, ngon, prism, type FramePalette, type LegsVisual,
} from './shared';

const HUB_DROP = 0.5;
const COXA_RADIUS = 0.96;
/** Femur tip (knee apex) in local leg space (+X outward, +Y up). */
const KNEE_X = 0.96;
const KNEE_Y = 0.72;
/** Pointed tibia tip horizontal reach past the knee apex. */
const FOOT_X = 0.56;

interface LegSpec {
  /** Base azimuth around Y where local +X points to (cos(a), 0, -sin(a)). */
  readonly baseAngle: number;
  /** Sign so +delta swings the leg forward (-Z). */
  readonly sweepSign: 1 | -1;
  /** Diagonal quadruped gait phase: FL + RR = 0, FR + RL = 1. */
  readonly phase: 0 | 1;
  /** Left (-1) or right (+1) side for limp response. */
  readonly side: -1 | 1;
  /** Aft folded azimuth for `jetMode`. */
  readonly jetAngle: number;
}

const LEG_SPECS: readonly LegSpec[] = [
  { baseAngle: Math.PI * 0.25, sweepSign: 1, phase: 1, side: 1, jetAngle: -Math.PI * 0.36 },   // Front-Right
  { baseAngle: Math.PI * 0.75, sweepSign: -1, phase: 0, side: -1, jetAngle: -Math.PI * 0.64 }, // Front-Left
  { baseAngle: -Math.PI * 0.25, sweepSign: 1, phase: 0, side: 1, jetAngle: -Math.PI * 0.42 },  // Rear-Right
  { baseAngle: -Math.PI * 0.75, sweepSign: -1, phase: 1, side: -1, jetAngle: -Math.PI * 0.58 },// Rear-Left
];

function buildHub(b: ModelBuilder, hipsY: number): void {
  const hubY = hipsY - HUB_DROP;
  // Waist turret bearing ring flush with the torso belly.
  b.solid(prism(ngon(1.12, 8, Math.PI / 8), 0.26, 0.04), STEEL, { at: [0, hipsY, 0.12], rot: FLAT });
  // Octagonal bevelled spider carapace hub.
  b.solid(prism(ngon(1.24, 8, Math.PI / 8), 0.56, 0.06), OBSIDIAN, { at: [0, hubY + 0.14, 0.06], rot: FLAT });
  b.solid(prism(ngon(1.06, 8, Math.PI / 8), 0.28, 0.045), PLATE, { at: [0, hubY + 0.38, 0.06], rot: FLAT });
  // Underslung gyro-stabilizer dome + amber belly sensor ring.
  b.cyl(0.68, 0.42, 0.34, 12, GUNMETAL, { at: [0, hubY - 0.28, 0.06] });
  b.glow(new THREE.CylinderGeometry(0.32, 0.28, 0.06, 10), AMBER, 3.6, { at: [0, hubY - 0.46, 0.06] });

  // Four radially projecting armoured coxa socket housings.
  for (const spec of LEG_SPECS) {
    const cx = Math.cos(spec.baseAngle) * (COXA_RADIUS * 0.85);
    const cz = -Math.sin(spec.baseAngle) * (COXA_RADIUS * 0.85);
    b.cyl(0.28, 0.32, 0.46, 10, IRON, { at: [cx, hubY, cz + 0.06] });
    b.cyl(0.34, 0.34, 0.12, 10, BRASS, { at: [cx, hubY + 0.18, cz + 0.06] });
  }
}

/**
 * Segment 1 — Elevated arachnid femur built in local leg space (+X outward, +Y up):
 * coxa drum (0, 0, 0) -> high bevelled knee apex (KNEE_X, KNEE_Y, 0).
 */
function buildFemur(b: ModelBuilder): void {
  const len = Math.hypot(KNEE_X, KNEE_Y);
  const angle = Math.atan2(KNEE_Y, KNEE_X);
  const midX = KNEE_X * 0.5;
  const midY = KNEE_Y * 0.5;

  // Coxa gimbal pivot drum.
  b.cyl(0.26, 0.26, 0.42, 12, STEEL, { rot: [Math.PI / 2, 0, 0] });
  // Core obsidian femur truss spar.
  b.solid(prism([
    [-len * 0.5, -0.18], [len * 0.5, -0.16], [len * 0.5, 0.18], [-len * 0.5, 0.2],
  ], 0.34, 0.035), OBSIDIAN, { at: [midX, midY, 0], rot: [0, 0, angle] });
  // Chamfered dorsal carapace armour shield riding along top of femur.
  b.solid(prism([
    [-len * 0.44, 0.08], [len * 0.46, 0.1], [len * 0.38, 0.32], [-len * 0.34, 0.34],
  ], 0.44, 0.04), PLATE, { at: [midX, midY, 0], rot: [0, 0, angle] });
  // Twin exposed brass/steel elevation hydraulic pistons beneath the femur.
  for (const zs of [-1, 1]) {
    b.cyl(0.065, 0.065, len * 0.84, 8, STEEL, { at: [midX + 0.06, midY - 0.18, zs * 0.16], rot: [0, 0, angle - Math.PI / 2] });
    b.cyl(0.095, 0.095, len * 0.38, 8, BRASS, { at: [midX - 0.12, midY - 0.26, zs * 0.16], rot: [0, 0, angle - Math.PI / 2] });
  }
  // Thin Bureau crimson edge line on femur crest.
  b.glow(new THREE.BoxGeometry(len * 0.56, 0.035, 0.04), RED, 3.8, { at: [midX, midY + 0.28, 0], rot: [0, 0, angle] });

  // Heavy articulated spider knee drum & apex crest shield at (KNEE_X, KNEE_Y, 0).
  b.cyl(0.28, 0.28, 0.5, 12, IRON, { at: [KNEE_X, KNEE_Y, 0], rot: [Math.PI / 2, 0, 0] });
  b.solid(prism([
    [-0.24, -0.14], [0.34, -0.06], [0.22, 0.34], [-0.28, 0.24],
  ], 0.48, 0.035), PLATE, { at: [KNEE_X + 0.04, KNEE_Y + 0.08, 0] });
  b.glow(new THREE.BoxGeometry(0.18, 0.04, 0.36), AMBER, 3.6, { at: [KNEE_X + 0.24, KNEE_Y + 0.12, 0] });
}

/**
 * Segment 2 — Pointed hydraulic climbing tibia built in knee-local space (+X outward, +Y up):
 * knee (0, 0, 0) -> pointed hydraulic climbing claw tip (FOOT_X, footY, 0) flush at world y = 0.0.
 */
function buildTibia(b: ModelBuilder, footY: number): void {
  const len = Math.hypot(FOOT_X, footY);
  const angle = Math.atan2(footY, FOOT_X); // ~ -82 deg (steep downward)
  const midX = FOOT_X * 0.5;
  const midY = footY * 0.5;

  // Tapered main structural tibia beam narrowing smoothly toward the climbing point.
  b.solid(prism([
    [-len * 0.5, -0.22], [len * 0.48, -0.09], [len * 0.48, 0.09], [-len * 0.5, 0.22],
  ], 0.32, 0.035), OBSIDIAN, { at: [midX, midY, 0], rot: [0, 0, angle] });
  // Upper armoured tibia shin fairing covering upper 55% of the leg.
  const upperX = FOOT_X * 0.28;
  const upperY = footY * 0.28;
  b.solid(prism([
    [-len * 0.24, 0.04], [len * 0.26, -0.02], [len * 0.22, 0.26], [-len * 0.22, 0.34],
  ], 0.44, 0.04), PLATE, { at: [upperX, upperY, 0], rot: [0, 0, angle] });
  // Exposed inner telescoping hydraulic shock damper + brass pressure barrel.
  b.cyl(0.065, 0.055, len * 0.86, 10, STEEL, { at: [midX - 0.18, midY - 0.02, 0], rot: [0, 0, angle - Math.PI / 2] });
  b.cyl(0.1, 0.1, len * 0.34, 10, BRASS, { at: [upperX - 0.2, upperY, 0], rot: [0, 0, angle - Math.PI / 2] });

  // Lower ankle collar & pointed hydraulic ground spike flush at (FOOT_X, footY, 0).
  const collarX = FOOT_X * 0.86;
  const collarY = footY * 0.86;
  b.cyl(0.16, 0.11, 0.42, 10, GUNMETAL, { at: [collarX, collarY, 0], rot: [0, 0, angle - Math.PI / 2] });
  // Pointed ground-anchor spike tip (cone apex resting at footY).
  b.cyl(0.11, 0.04, 0.38, 8, IRON, { at: [FOOT_X, footY + 0.19, 0] });
  // Twin splayed climbing crampon claws flanking the spike for 45° rock grip.
  for (const zs of [-1, 1]) {
    b.solid(prism([
      [-0.14, 0], [0.22, 0], [0.16, 0.12], [-0.08, 0.22],
    ], 0.1, 0.015), STEEL, { at: [FOOT_X + 0.02, footY + 0.02, zs * 0.16], rot: [0, zs * -0.25, 0] });
  }
  // Compact dark grip footpad ring at exact ground level.
  b.cyl(0.14, 0.16, 0.05, 8, DARK, { at: [FOOT_X, footY + 0.025, 0] });
}

interface SpiderLeg {
  readonly coxa: THREE.Group;
  readonly femur: THREE.Group;
  readonly tibia: THREE.Group;
  readonly spec: LegSpec;
}

export function buildSpiderLegs(materials: ModelMaterials, hipsY: number, palette?: FramePalette): LegsVisual {
  const group = new THREE.Group();
  group.name = 'frame.legs.spider';

  const hubGroup = new THREE.Group();
  const hubB = frameBuilder(palette);
  buildHub(hubB, hipsY);
  hubGroup.add(materials.group(hubB));
  group.add(hubGroup);

  const hubY = hipsY - HUB_DROP;
  const footY = -(hubY + KNEE_Y);
  const legs: SpiderLeg[] = [];

  for (const spec of LEG_SPECS) {
    const coxa = new THREE.Group();
    coxa.position.set(
      Math.cos(spec.baseAngle) * COXA_RADIUS,
      hubY,
      -Math.sin(spec.baseAngle) * COXA_RADIUS + 0.06,
    );
    coxa.rotation.y = spec.baseAngle;

    const femur = new THREE.Group();
    const femurB = frameBuilder(palette);
    buildFemur(femurB);
    femur.add(materials.group(femurB));

    const tibia = new THREE.Group();
    tibia.position.set(KNEE_X, KNEE_Y, 0);
    const tibiaB = frameBuilder(palette);
    buildTibia(tibiaB, footY);
    tibia.add(materials.group(tibiaB));

    femur.add(tibia);
    coxa.add(femur);
    hubGroup.add(coxa);
    legs.push({ coxa, femur, tibia, spec });
  }

  return {
    group,
    pose(stride, walk, effectiveSink, kneel, collapse, limpSide, parked, jetMode): void {
      const w = clamp(walk);
      const sinkY = clamp(effectiveSink * 0.85, -1.9, 0.45);
      hubGroup.position.y = sinkY;
      hubGroup.rotation.set(
        (jetMode ? -0.3 : 0) + collapse * 0.18,
        0,
        collapse * 0.14 + limpSide * 0.05,
      );

      // As hub lowers (sink/kneel/collapse/parked), femurs splay upward and tibias tuck inward to keep claws planted.
      const crouch = clamp(-sinkY * 0.24 + kneel * 0.22 + collapse * 0.32 + (parked ? 0.1 : 0), 0, 0.72);

      for (let i = 0; i < legs.length; i++) {
        const leg = legs[i]!;
        const { spec } = leg;

        if (jetMode) {
          // Sweep all 4 spider legs aft into a tight aerodynamic flight profile.
          leg.coxa.rotation.y = spec.jetAngle;
          leg.femur.rotation.z = -0.58;
          leg.tibia.rotation.z = -0.82;
          continue;
        }

        // Alternating diagonal quadruped gait: FL + RR move together, opposite FR + RL.
        const u = ((stride + spec.phase) % 2 + 2) % 2 / 2;
        const planted = u < 0.5;
        const k = planted ? u * 2 : (u - 0.5) * 2;
        const isLimping = spec.side === limpSide;
        const limpMult = isLimping ? 0.55 : 1;

        const sweepAmp = 0.28 * w * limpMult;
        // Planted foot pushes backward; lifted foot swings forward.
        const sweep = planted ? sweepAmp * (1 - 2 * k) : sweepAmp * (2 * k - 1);
        const lift = planted ? 0 : Math.sin(k * Math.PI) * clamp(w * 2) * limpMult;

        leg.coxa.rotation.y = spec.baseAngle + (parked ? 0 : spec.sweepSign * sweep);
        leg.femur.rotation.z = crouch + lift * 0.36;
        leg.tibia.rotation.z = -crouch * 1.15 - lift * 0.42;
      }
    },
  };
}
