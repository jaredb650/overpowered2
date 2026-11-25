/**
 * Aero-Quad Legs 3D model (`legsAeroQuad`):
 * Sculpted lightweight 4-legged reverse-jointed Aero-Quad walker (`2` forward-angled, `2` rear-angled)
 * with dorsal thruster-fin thigh plates, razor-slim tibias, articulated talon feet, and ventral knee thruster cones.
 * - On ground: alternates brisk diagonal tetrapod gait pairs (`FL+RR`, `FR+RL`).
 * - When `extra?.hovering` is true (mid-air `aeroHovering`): smoothly splays all 4 sleek wing-legs outward and
 *   flat horizontally into an X-wing airframe while flaring all 4 leg-mounted thruster glow cones!
 */
import * as THREE from 'three';
import { clamp, lerp } from '../../core/math';
import { ModelBuilder, type ModelMaterials } from '../../progression/modelkit';
import {
  AMBER, BRASS, DARK, FLAT, GUNMETAL, IRON, OBSIDIAN, PLATE, RED, STEEL,
  frameBuilder, ngon, prism, type FramePalette, type LegsVisual,
} from './shared';

const HUB_DROP = 0.42;
const COXA_RADIUS = 0.88;
const KNEE_X = 1.12;
const KNEE_Y = 0.62;
const FOOT_X = 0.68;

interface AeroLegSpec {
  readonly baseAngle: number;
  readonly sweepSign: 1 | -1;
  readonly phase: 0 | 1;
  readonly side: -1 | 1;
  readonly hoverAngle: number;
  readonly jetAngle: number;
}

const AERO_SPECS: readonly AeroLegSpec[] = [
  { baseAngle: Math.PI * 0.23, sweepSign: 1, phase: 1, side: 1, hoverAngle: Math.PI * 0.22, jetAngle: -Math.PI * 0.34 },
  { baseAngle: Math.PI * 0.77, sweepSign: -1, phase: 0, side: -1, hoverAngle: Math.PI * 0.78, jetAngle: -Math.PI * 0.66 },
  { baseAngle: -Math.PI * 0.23, sweepSign: 1, phase: 0, side: 1, hoverAngle: -Math.PI * 0.24, jetAngle: -Math.PI * 0.42 },
  { baseAngle: -Math.PI * 0.77, sweepSign: -1, phase: 1, side: -1, hoverAngle: -Math.PI * 0.76, jetAngle: -Math.PI * 0.58 },
];

function makeLegPlume(palette?: FramePalette): THREE.Group {
  const root = new THREE.Group();
  const outerCol = palette?.thruster ?? '#38e8ff';
  const innerCol = palette?.thrusterCore ?? '#e8fbff';

  const outerGeo = new THREE.ConeGeometry(0.24, 1.55, 8, 1, true);
  outerGeo.translate(0, -0.775, 0);
  const outerMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(outerCol).multiplyScalar(3.8),
    transparent: true,
    opacity: 0.78,
    side: THREE.DoubleSide,
    depthWrite: false,
    toneMapped: false,
  });
  root.add(new THREE.Mesh(outerGeo, outerMat));

  const innerGeo = new THREE.ConeGeometry(0.12, 0.95, 8, 1, true);
  innerGeo.translate(0, -0.475, 0);
  const innerMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(innerCol).multiplyScalar(4.8),
    transparent: true,
    opacity: 0.9,
    side: THREE.DoubleSide,
    depthWrite: false,
    toneMapped: false,
  });
  root.add(new THREE.Mesh(innerGeo, innerMat));
  root.visible = false;
  return root;
}

function buildAeroHub(b: ModelBuilder, hipsY: number): void {
  const hubY = hipsY - HUB_DROP;
  // Compact lightweight octagonal waist bearing ring.
  b.solid(prism(ngon(0.94, 8, Math.PI / 8), 0.22, 0.035), STEEL, { at: [0, hipsY, 0.1], rot: FLAT });
  // Razor-faceted diamond aero-pelvis chassis.
  b.solid(prism(ngon(1.06, 8, Math.PI / 8), 0.42, 0.05), OBSIDIAN, { at: [0, hubY + 0.12, 0.06], rot: FLAT });
  b.solid(prism(ngon(0.88, 8, Math.PI / 8), 0.22, 0.035), PLATE, { at: [0, hubY + 0.3, 0.06], rot: FLAT });
  // Ventral hover stabilizer nozzle cone under the pelvis hub.
  b.cyl(0.46, 0.28, 0.34, 10, GUNMETAL, { at: [0, hubY - 0.24, 0.06] });
  b.glow(new THREE.CylinderGeometry(0.22, 0.26, 0.06, 10), RED, 4.0, { at: [0, hubY - 0.4, 0.06] });

  for (const spec of AERO_SPECS) {
    const cx = Math.cos(spec.baseAngle) * (COXA_RADIUS * 0.82);
    const cz = -Math.sin(spec.baseAngle) * (COXA_RADIUS * 0.82);
    b.cyl(0.22, 0.24, 0.36, 10, IRON, { at: [cx, hubY, cz + 0.06] });
    b.cyl(0.26, 0.26, 0.1, 10, BRASS, { at: [cx, hubY + 0.14, cz + 0.06] });
  }
}

/**
 * Segment 1 — Sleek reverse-jointed Aero-Quad femur with sweeping dorsal wing-fin thigh plate
 * and ventral knee hover-thruster bell.
 */
function buildAeroFemur(b: ModelBuilder): void {
  const len = Math.hypot(KNEE_X, KNEE_Y);
  const angle = Math.atan2(KNEE_Y, KNEE_X);
  const midX = KNEE_X * 0.5;
  const midY = KNEE_Y * 0.5;

  // Slim coxa gimbal drum.
  b.cyl(0.2, 0.2, 0.32, 10, STEEL, { rot: [Math.PI / 2, 0, 0] });
  // Razor-thin carbon-steel main femur spar.
  b.solid(prism([
    [-len * 0.5, -0.11], [len * 0.5, -0.09], [len * 0.5, 0.11], [-len * 0.5, 0.13],
  ], 0.22, 0.025), OBSIDIAN, { at: [midX, midY, 0], rot: [0, 0, angle] });
  // Swept dorsal thruster-fin / aero wing-blade rising along top of femur.
  b.solid(prism([
    [-len * 0.42, 0.06], [len * 0.54, 0.08], [len * 0.38, 0.44], [-len * 0.22, 0.36],
  ], 0.12, 0.02), PLATE, { at: [midX, midY, 0], rot: [0, 0, angle] });
  // Thin glowing wing-blade edge line.
  b.glow(new THREE.BoxGeometry(len * 0.68, 0.032, 0.04), RED, 4.2, { at: [midX + 0.06, midY + 0.32, 0], rot: [0, 0, angle] });
  // Slim exposed brass hydraulic actuator piston underneath femur.
  b.cyl(0.048, 0.048, len * 0.82, 8, STEEL, { at: [midX + 0.04, midY - 0.14, 0], rot: [0, 0, angle - Math.PI / 2] });
  b.cyl(0.075, 0.075, len * 0.34, 8, BRASS, { at: [midX - 0.14, midY - 0.19, 0], rot: [0, 0, angle - Math.PI / 2] });

  // Sleek knee gimbal drum + aerodynamic apex fin + ventral hover-thruster bell.
  b.cyl(0.22, 0.22, 0.38, 12, IRON, { at: [KNEE_X, KNEE_Y, 0], rot: [Math.PI / 2, 0, 0] });
  b.solid(prism([
    [-0.18, -0.08], [0.44, 0.02], [0.22, 0.32], [-0.26, 0.2],
  ], 0.28, 0.025), PLATE, { at: [KNEE_X + 0.06, KNEE_Y + 0.08, 0] });
  // Ventral knee hover-thruster nozzle pointing straight down (-Y).
  b.cyl(0.14, 0.22, 0.32, 10, GUNMETAL, { at: [KNEE_X, KNEE_Y - 0.24, 0] });
  b.glow(new THREE.CylinderGeometry(0.12, 0.17, 0.05, 10), AMBER, 4.4, { at: [KNEE_X, KNEE_Y - 0.39, 0] });
}

/**
 * Segment 2 — Sleek tapered reverse-jointed tibia ending in a split talon foot flush at y = 0.0.
 */
function buildAeroTibia(b: ModelBuilder, footY: number): void {
  const len = Math.hypot(FOOT_X, footY);
  const angle = Math.atan2(footY, FOOT_X);
  const midX = FOOT_X * 0.5;
  const midY = footY * 0.5;

  // Razor-tapered carbon-steel tibia blade.
  b.solid(prism([
    [-len * 0.5, -0.14], [len * 0.48, -0.055], [len * 0.48, 0.055], [-len * 0.5, 0.14],
  ], 0.2, 0.025), OBSIDIAN, { at: [midX, midY, 0], rot: [0, 0, angle] });
  // Outer aero wing-strake fairing on upper 60% of the tibia.
  const ux = FOOT_X * 0.3;
  const uy = footY * 0.3;
  b.solid(prism([
    [-len * 0.28, 0.02], [len * 0.32, -0.02], [len * 0.24, 0.26], [-len * 0.26, 0.28],
  ], 0.14, 0.02), PLATE, { at: [ux, uy, 0], rot: [0, 0, angle] });
  // Inner slim damper rod.
  b.cyl(0.045, 0.04, len * 0.84, 8, STEEL, { at: [midX - 0.14, midY, 0], rot: [0, 0, angle - Math.PI / 2] });
  b.cyl(0.075, 0.075, len * 0.3, 8, BRASS, { at: [ux - 0.15, uy, 0], rot: [0, 0, angle - Math.PI / 2] });

  // Ankle collar + sleek articulated talon foot flush at footY (world y = 0.0).
  b.cyl(0.12, 0.09, 0.28, 8, IRON, { at: [FOOT_X * 0.9, footY * 0.9, 0], rot: [0, 0, angle - Math.PI / 2] });
  // Split forward twin talon claws + sharp rear balancing spur.
  for (const zs of [-1, 1]) {
    b.solid(prism([
      [-0.06, 0.0], [0.46, 0.0], [0.54, 0.05], [0.22, 0.18], [-0.08, 0.16],
    ], 0.085, 0.014), PLATE, { at: [FOOT_X, footY + 0.01, zs * 0.14], rot: [0, zs * -0.22, 0] });
    b.box(0.42, 0.03, 0.08, DARK, { at: [FOOT_X + 0.2, footY + 0.015, zs * 0.16], rot: [0, zs * -0.22, 0] });
  }
  b.solid(prism([
    [-0.36, 0.0], [0.02, 0.0], [0.02, 0.14], [-0.28, 0.08],
  ], 0.1, 0.014), GUNMETAL, { at: [FOOT_X, footY + 0.01, 0] });
}

interface AeroLeg {
  readonly coxa: THREE.Group;
  readonly femur: THREE.Group;
  readonly tibia: THREE.Group;
  readonly plume: THREE.Group;
  readonly spec: AeroLegSpec;
}

export function buildAeroQuadLegs(materials: ModelMaterials, hipsY: number, palette?: FramePalette): LegsVisual {
  const group = new THREE.Group();
  group.name = 'frame.legs.aeroQuad';

  const hubGroup = new THREE.Group();
  const hb = frameBuilder(palette);
  buildAeroHub(hb, hipsY);
  hubGroup.add(materials.group(hb));
  group.add(hubGroup);

  const hubY = hipsY - HUB_DROP;
  const footY = -(hubY + KNEE_Y);
  const legs: AeroLeg[] = [];

  for (const spec of AERO_SPECS) {
    const coxa = new THREE.Group();
    coxa.position.set(
      Math.cos(spec.baseAngle) * COXA_RADIUS,
      hubY,
      -Math.sin(spec.baseAngle) * COXA_RADIUS + 0.06,
    );
    coxa.rotation.y = spec.baseAngle;

    const femur = new THREE.Group();
    const fb = frameBuilder(palette);
    buildAeroFemur(fb);
    femur.add(materials.group(fb));

    const plume = makeLegPlume(palette);
    plume.position.set(KNEE_X, KNEE_Y - 0.42, 0);
    femur.add(plume);

    const tibia = new THREE.Group();
    tibia.position.set(KNEE_X, KNEE_Y, 0);
    const tb = frameBuilder(palette);
    buildAeroTibia(tb, footY);
    tibia.add(materials.group(tb));

    femur.add(tibia);
    coxa.add(femur);
    hubGroup.add(coxa);
    legs.push({ coxa, femur, tibia, plume, spec });
  }

  let clock = 0;
  let splayBlend = 0;

  return {
    group,
    pose(stride, walk, effectiveSink, kneel, collapse, limpSide, parked, jetMode, extra): void {
      const dt = Math.max(0, extra?.dt ?? 1 / 60);
      clock += dt;

      const hovering = extra?.hovering === true && !parked && !jetMode;
      const targetSplay = hovering ? 1 : 0;
      splayBlend += (targetSplay - splayBlend) * (1 - Math.exp(-10 * dt));

      const w = clamp(walk);
      const sinkY = clamp(effectiveSink * 0.8, -1.8, 0.45);
      hubGroup.position.y = lerp(sinkY, 0.15 + Math.sin(clock * 5.2) * 0.06, splayBlend);
      hubGroup.rotation.set(
        (jetMode ? -0.32 : 0) + collapse * 0.18,
        0,
        collapse * 0.14 + limpSide * 0.05,
      );

      const crouch = clamp(-sinkY * 0.22 + kneel * 0.22 + collapse * 0.34 + (parked ? 0.12 : 0), 0, 0.68);
      const flareActive = (hovering || extra?.flying === true || jetMode) && !parked;

      for (let i = 0; i < legs.length; i++) {
        const leg = legs[i]!;
        const { spec } = leg;

        if (jetMode) {
          leg.coxa.rotation.y = spec.jetAngle;
          leg.femur.rotation.z = -0.52;
          leg.tibia.rotation.z = -0.78;
          leg.plume.visible = true;
          const flick = 0.9 + Math.sin(clock * 46 + i * 1.7) * 0.16;
          leg.plume.scale.set(1.0, 1.35 * flick, 1.0);
          continue;
        }

        // Ground alternating diagonal tetrapod gait (`FL+RR`, `FR+RL`).
        const u = ((stride + spec.phase) % 2 + 2) % 2 / 2;
        const planted = u < 0.5;
        const k = planted ? u * 2 : (u - 0.5) * 2;
        const limpMult = spec.side === limpSide ? 0.55 : 1;

        const sweepAmp = 0.32 * w * limpMult;
        const sweep = planted ? sweepAmp * (1 - 2 * k) : sweepAmp * (2 * k - 1);
        const lift = planted ? 0 : Math.sin(k * Math.PI) * clamp(w * 2) * limpMult;

        const walkCoxa = spec.baseAngle + (parked ? 0 : spec.sweepSign * sweep);
        const walkFemur = crouch + lift * 0.38;
        const walkTibia = -crouch * 1.15 - lift * 0.44;

        // Splay pose: rotate femur slightly down to level and kick tibia straight out horizontally into an X-wing airframe!
        const hoverCoxa = spec.hoverAngle;
        const hoverFemur = -0.46;
        const hoverTibia = 1.38;

        leg.coxa.rotation.y = lerp(walkCoxa, hoverCoxa, splayBlend);
        leg.femur.rotation.z = lerp(walkFemur, hoverFemur, splayBlend);
        leg.tibia.rotation.z = lerp(walkTibia, hoverTibia, splayBlend);

        leg.plume.visible = flareActive || splayBlend > 0.12;
        if (leg.plume.visible) {
          const flick = 0.86 + Math.sin(clock * 42 + i * 1.9) * 0.16;
          const lenScale = Math.max(0.4, splayBlend * 1.15 + (extra?.flying ? 0.85 : 0)) * flick;
          leg.plume.scale.set(0.95, lenScale, 0.95);
        }
      }
    },
  };
}
