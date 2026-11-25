/**
 * The Distraint Frame's procedural 3D chassis, first-person cockpit, and modular part mount points — Bureau
 * heavy-industrial silhouette built from bevelled 2D profiles (`prism`) in obsidian, gunmetal, steel, brass, crimson
 * optics, and amber standby lamps.
 *
 *   The cockpit   near-view roll-cage, brow, sill, and angled side consoles round the eye, with open chin glass so
 *                 looking down shows the ground at the feet for stomps, plus 3 progressive canopy crack overlays.
 *   The arms      world-space `Gun`s (see `src/frame/models/` and `arms.ts`), visible in the bottom corners from inside
 *                 and articulated from outside.
 *   The body      hunched bevelled torso, overhanging visor brow, layered shoulder pauldrons, up to 3 modular shoulder
 *                 mounts (`FRAME_PLACES.shoulders`), dorsal reactor cooling slats, twin thruster bells with live jet
 *                 cones, pelvis turntable, and reverse-jointed 3-toed legs (or custom leg/cockpit/engine visuals).
 *
 * Every place is in torso space: x right, y up from the hips, -z ahead. `FRAME_PLACES` keeps eye, arms, shoulders and
 * jets aligned between single-player (`Frame`) and co-op (`FramePuppet`).
 */
import * as THREE from 'three';
import { clamp } from '../core/math';
import { ModelBuilder, type ModelMaterials } from '../progression/modelkit';
import { FRAME } from './data';
import {
  frameStats, headOf, paintOf, shouldersOf, type DriveKind, type FrameLoadout, type FramePartId, type GaitKind, type HeadKind, type ShoulderKind,
} from './loadout';
import {
  ACROSS, ALONG_Z, AMBER, BRASS, BUREAU_PALETTE, DARK, FLAT, GUNMETAL, IRON, OBSIDIAN, PLATE, RED, STEEL,
  frameBuilder, ngon, paletteKey, prism, resolvePalette,
  type ChassisPlaces, type CockpitVisual, type EngineVisual, type FramePalette, type HeadVisual, type LegsVisual,
} from './models/shared';
import { SHOULDER_MODELS } from './models/shoulders';
import { buildChassisVisual } from './models/chassis';
import { buildHeadVisual } from './models/heads';
import { buildSprinterLegs } from './models/legs-sprinter';
import { buildHeavyLegs } from './models/legs-heavy';
import { buildTreadsLegs } from './models/legs-treads';
import { buildSpiderLegs } from './models/legs-spider';
import { buildHoverLegs } from './models/legs-hover';
import { buildWheelLegs } from './models/legs-wheels';
import { buildAeroQuadLegs } from './models/legs-aeroquad';
import { buildEngineVisual } from './models/engine-kit';
import type { ExpansionVisualState } from './expansions/types';
import { ExpansionVisuals } from './expansions/visuals';

export { ROTARY_ARM } from './models/rotary';
export { CANNON_ARM } from './models/cannon40';
export { HOWITZER_ARM } from './models/howitzer105';

/** Hips over the feet, and the torso's places from there. */
export const FRAME_PLACES = {
  hips: 3.9,
  /** The eye: `FRAME.eye` over the feet, `FRAME.podAhead` ahead of the hips. */
  eye: [0, FRAME.eye - 3.9, -FRAME.podAhead] as const,
  /** Where the head / sensor crown mounts on the standard torso. */
  head: [0, 2.36, -0.35] as const,
  /** Where each arm's gun turns. */
  rotary: [-1.75, 0.15, -1.15] as const,
  cannon: [1.75, 0.15, -1.15] as const,
  /** The middle of the six tubes on the right shoulder (also `shoulders[0]`). */
  pod: [1.55, 2.35, 0.2] as const,
  /** Up to 3 shoulder mount points on the torso: slot 0 = right shoulder, slot 1 = left shoulder, slot 2 = dorsal top. */
  shoulders: [
    [1.55, 2.35, 0.2] as const,
    [-1.55, 2.35, 0.2] as const,
    [0, 2.65, 0.35] as const,
  ] as const,
  /** Where the jets burn, on the back. */
  jets: [0, 1.0, 1.9] as const,
} as const;

const DEFAULT_JET_NOZZLES: readonly (readonly [number, number, number])[] = [
  [-1.2, 0.5, 1.98],
  [1.2, 0.5, 1.98],
];

export const STANDARD_CHASSIS_PLACES: ChassisPlaces = {
  eye: FRAME_PLACES.eye,
  head: FRAME_PLACES.head,
  leftArm: FRAME_PLACES.rotary,
  rightArm: FRAME_PLACES.cannon,
  shoulders: FRAME_PLACES.shoulders,
  jets: FRAME_PLACES.jets,
  jetNozzles: DEFAULT_JET_NOZZLES,
};

/**
 * First-person cockpit roll-cage around the eye (origin = eye). Wide unobstructed center field of view, bevelled angled
 * A-pillars at the screen margins, overhead sensor brow, slim sill with open chin glass (so looking down shows the feet
 * for stomps), and dual angled side consoles with glowing telemetry bars.
 */
function cockpit(b: ModelBuilder): void {
  for (const s of [1, -1]) {
    // Raked chamfered A-pillar framing the viewport edges.
    b.solid(prism([[-0.06, -0.62], [0.06, -0.58], [0.04, 0.68], [-0.07, 0.64]], 0.075, 0.015), OBSIDIAN, { at: [s * 1.07, 0.04, -0.74], rot: [0.12, 0, s * 0.11] });
    // Inner gasket trim + grab handle along each pillar.
    b.box(0.02, 1.12, 0.03, GUNMETAL, { at: [s * 1.03, 0.04, -0.7], rot: [0.12, 0, s * 0.11] });
    b.cyl(0.014, 0.014, 0.28, 8, STEEL, { at: [s * 0.99, 0.14, -0.64], rot: [0.12, 0, s * 0.11] });
    // Side bulkhead wall behind the pillar.
    b.box(0.08, 1.25, 1.35, GUNMETAL, { at: [s * 1.18, 0, 0.04] });
    b.box(0.03, 0.85, 0.9, IRON, { at: [s * 1.13, -0.05, -0.05] });
    // Angled side instrument console with bevelled hood.
    b.solid(prism([[-0.32, -0.16], [0.34, -0.16], [0.28, 0.16], [-0.26, 0.2]], 0.56, 0.025), OBSIDIAN, { at: [s * 0.9, -0.78, -0.44], rot: [0.36, s * -0.14, 0] });
    b.box(0.46, 0.03, 0.34, GUNMETAL, { at: [s * 0.88, -0.63, -0.48], rot: [0.36, s * -0.14, 0] });
    // Crisp glowing console indicator pips & bar graph.
    for (let i = 0; i < 4; i++) {
      b.glow(new THREE.BoxGeometry(0.048, 0.016, 0.018), i === 1 ? RED : AMBER, 3.2, { at: [s * (0.72 + i * 0.085), -0.61, -0.61 + i * 0.02] });
    }
    b.glow(new THREE.BoxGeometry(0.18, 0.012, 0.014), RED, 2.5, { at: [s * 0.84, -0.65, -0.56] });
  }
  // Overhead armoured brow bar, central optics sensor pod, and roof deck.
  b.solid(prism([[-0.1, -0.04], [0.1, -0.04], [0.06, 0.05], [-0.08, 0.05]], 2.24, 0.015), OBSIDIAN, { at: [0, 0.65, -0.8], rot: ACROSS });
  b.box(0.36, 0.05, 0.12, GUNMETAL, { at: [0, 0.63, -0.79] });
  b.glow(new THREE.BoxGeometry(0.08, 0.014, 0.014), RED, 3.4, { at: [0, 0.61, -0.74] });
  b.glow(new THREE.BoxGeometry(0.03, 0.012, 0.012), AMBER, 2.8, { at: [-0.12, 0.61, -0.74] });
  b.glow(new THREE.BoxGeometry(0.03, 0.012, 0.012), AMBER, 2.8, { at: [0.12, 0.61, -0.74] });
  b.box(2.3, 0.06, 1.25, DARK, { at: [0, 0.74, -0.22] });
  // Slim lower instrument sill and two armoured chin-glass frame rails (center open for stomp sightlines).
  b.solid(prism([[-0.08, -0.035], [0.08, -0.035], [0.05, 0.035], [-0.07, 0.035]], 2.18, 0.012), OBSIDIAN, { at: [0, -0.57, -0.84], rot: ACROSS });
  b.box(0.42, 0.022, 0.05, GUNMETAL, { at: [0, -0.555, -0.82] });
  for (const s of [1, -1]) {
    b.box(0.045, 0.045, 0.96, IRON, { at: [s * 0.54, -1.02, -0.62], rot: [0.5, 0, s * -0.08] });
  }
}

/** Progressive canopy crack overlays (levels 1..3), rendered just inside the front glass. */
function makeCrackLayer(segments: readonly (readonly [number, number, number, number])[], opacity: number): THREE.LineSegments {
  const verts: number[] = [];
  for (const [x1, y1, x2, y2] of segments) {
    verts.push(x1, y1, -0.76, x2, y2, -0.76);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  const mat = new THREE.LineBasicMaterial({ color: '#d8eeff', transparent: true, opacity, depthTest: false, fog: false });
  const lines = new THREE.LineSegments(geo, mat);
  lines.visible = false;
  lines.renderOrder = 2;
  return lines;
}

const CRACK_SETS: readonly (readonly (readonly [number, number, number, number])[])[] = [
  // Stage 1 (< 70% hull): upper-right impact star.
  [
    [0.68, 0.36, 0.96, 0.54], [0.68, 0.36, 0.88, 0.16], [0.68, 0.36, 0.48, 0.46],
    [0.68, 0.36, 0.56, 0.18], [0.48, 0.46, 0.34, 0.58], [0.88, 0.16, 1.0, 0.04],
  ],
  // Stage 2 (< 45% hull): lower-left fracture spreading inward.
  [
    [-0.64, -0.32, -0.96, -0.46], [-0.64, -0.32, -0.42, -0.48], [-0.64, -0.32, -0.46, -0.1],
    [-0.64, -0.32, -0.84, -0.06], [-0.46, -0.1, -0.28, 0.02], [-0.84, -0.06, -0.98, 0.14],
  ],
  // Stage 3 (< 20% hull): heavy spiderweb across top-left and lower-right edges.
  [
    [-0.58, 0.34, -0.92, 0.54], [-0.58, 0.34, -0.3, 0.42], [-0.58, 0.34, -0.48, 0.12],
    [-0.3, 0.42, -0.1, 0.56], [0.56, -0.34, 0.92, -0.5], [0.56, -0.34, 0.34, -0.2],
    [0.56, -0.34, 0.72, -0.08], [0.34, -0.2, 0.18, -0.38],
  ],
];

/** The exterior armoured torso, hips at the origin (`+u` forward along `-Z`, `+v` up along `+Y`). */
function hull(b: ModelBuilder): void {
  // Core sculpted chassis: hunched forward over the waist with an aggressive sloped dorsal deck and bevelled underside.
  b.solid(prism([
    [-1.78, 0.25], [1.28, 0.18], [1.66, 0.64], [1.46, 1.62], [0.82, 2.26],
    [-0.94, 2.32], [-1.72, 1.88], [-1.96, 0.95],
  ], 2.95, 0.12), OBSIDIAN, { rot: ACROSS });

  // Sloped upper carapace armour hood.
  b.solid(prism([
    [-1.56, 1.84], [1.06, 1.82], [1.38, 1.54], [0.86, 2.38], [-0.98, 2.44], [-1.62, 2.12],
  ], 2.55, 0.08), PLATE, { rot: ACROSS });

  // Lower belly armour keel & hydraulic waist collar interface.
  b.solid(prism([[-1.25, -0.08], [1.18, -0.02], [1.42, 0.32], [-1.45, 0.32]], 2.15, 0.07), GUNMETAL, { rot: ACROSS });

  // Forward-jutting hexagonal cockpit pod + overhanging visor brow.
  b.solid(prism([
    [0.55, 0.42], [1.84, 0.58], [2.12, 1.04], [2.04, 1.54], [1.68, 1.92], [0.68, 1.98],
  ], 1.86, 0.08), GUNMETAL, { rot: ACROSS });
  // Overhanging brow shield above the canopy glass.
  b.solid(prism([
    [1.1, 1.62], [2.24, 1.58], [2.02, 1.92], [1.12, 2.02],
  ], 1.72, 0.05), PLATE, { rot: ACROSS });
  // Chin viewport bevel & lower glacis bumper bar.
  b.solid(prism([[1.2, 0.38], [2.04, 0.54], [1.94, 0.82], [1.2, 0.72]], 1.48, 0.04), OBSIDIAN, { rot: ACROSS });
  // Deeply recessed dark armoured canopy face (flush outside the 0.08 m pod bevel).
  b.box(1.44, 0.56, 0.12, DARK, { at: [0, 1.24, -2.18], rot: [-0.14, 0, 0] });
  b.box(1.12, 0.24, 0.1, DARK, { at: [0, 0.76, -2.06], rot: [0.32, 0, 0] });

  // Side cheek armour plates + twin optical sensor pods flanking the cockpit.
  for (const s of [-1, 1]) {
    b.solid(prism([[0.4, 0.62], [1.68, 0.78], [1.82, 1.46], [0.5, 1.68]], 0.26, 0.04), PLATE, { at: [s * 1.02, 0, 0], rot: ACROSS });
    // Cheek sensor lens housing.
    b.cyl(0.11, 0.13, 0.32, 10, IRON, { at: [s * 1.12, 1.44, -1.48], rot: ALONG_Z });
    b.glow(new THREE.CylinderGeometry(0.06, 0.06, 0.04, 10), RED, 4.5, { at: [s * 1.12, 1.44, -1.65], rot: ALONG_Z });

    // Heavy layered shoulder pauldrons & upper-arm gantry struts connecting down to the gun pivots.
    b.solid(prism([
      [-0.86, 1.05], [0.92, 1.1], [1.18, 1.48], [0.76, 2.18], [-0.58, 2.24], [-1.04, 1.72],
    ], 0.94, 0.07), PLATE, { at: [s * 1.94, 0, -0.15], rot: ACROSS });
    b.solid(prism([
      [-0.72, 0.82], [0.76, 0.88], [0.92, 1.38], [-0.82, 1.38],
    ], 0.78, 0.05), OBSIDIAN, { at: [s * 1.88, 0, -0.15], rot: ACROSS });
    // Shoulder gimbal drum & angled upper-arm strut down to the arm gun's rear elbow.
    b.cyl(0.36, 0.36, 0.62, 14, STEEL, { at: [s * 1.76, 1.32, -0.08], rot: [0, 0, Math.PI / 2] });
    b.solid(prism([[-0.22, -0.62], [0.22, -0.62], [0.24, 0.62], [-0.24, 0.62]], 0.42, 0.04), GUNMETAL, { at: [s * 1.76, 0.78, -0.14], rot: [0.32, 0, 0] });
    b.cyl(0.11, 0.11, 1.1, 10, STEEL, { at: [s * 1.98, 0.78, 0.02], rot: [0.32, 0, 0] });
    // Thin Bureau crimson stripe along each pauldron brow.
    b.glow(new THREE.BoxGeometry(0.14, 0.045, 1.18), RED, 4.2, { at: [s * 2.38, 1.78, -0.22] });
    b.glow(new THREE.BoxGeometry(0.08, 0.08, 0.08), AMBER, 4, { at: [s * 1.54, 2.24, -0.82] });
  }

  // Left-shoulder tactical sensor mast & twin comms whip antennas.
  b.solid(prism([[-0.28, 0], [0.34, 0], [0.26, 0.42], [-0.22, 0.42]], 0.36, 0.03), GUNMETAL, { at: [-1.45, 2.34, 0.32], rot: ACROSS });
  b.cyl(0.035, 0.055, 1.25, 8, STEEL, { at: [-1.54, 3.1, 0.48], rot: [-0.14, 0, 0.08] });
  b.cyl(0.025, 0.035, 0.85, 8, IRON, { at: [-1.36, 2.9, 0.42], rot: [-0.1, 0, -0.06] });
  b.glow(new THREE.BoxGeometry(0.06, 0.06, 0.06), RED, 5, { at: [-1.6, 3.72, 0.56] });

  // Rear dorsal reactor pack: louvered cooling slats + glowing internal core seams (visual cue for rear weakspot!).
  b.solid(prism([[-0.56, 0.2], [0.35, 0.15], [0.35, 1.95], [-0.34, 2.02], [-0.64, 1.56]], 2.1, 0.06), GUNMETAL, { at: [0, 0, 1.72], rot: ACROSS });
  for (let i = 0; i < 5; i++) {
    b.box(1.76, 0.085, 0.28, i % 2 ? IRON : PLATE, { at: [0, 0.48 + i * 0.31, 2.38], rot: [0.32, 0, 0] });
    b.glow(new THREE.BoxGeometry(1.48, 0.042, 0.05), AMBER, 4.0, { at: [0, 0.44 + i * 0.31, 2.34] });
  }
  // Twin angled jump-jet thruster bells flanking the reactor pack.
  for (const s of [-1, 1]) {
    b.solid(prism([[-0.38, -0.3], [0.32, -0.25], [0.36, 0.56], [-0.28, 0.62]], 0.58, 0.04), OBSIDIAN, { at: [s * 1.18, 1.24, 1.76], rot: ACROSS });
    b.cyl(0.24, 0.36, 0.56, 14, IRON, { at: [s * 1.18, 0.76, 1.92], rot: [0.22, 0, s * -0.1] });
    b.cyl(0.32, 0.36, 0.08, 14, STEEL, { at: [s * 1.2, 0.5, 1.98], rot: [0.22, 0, s * -0.1] });
    b.glow(new THREE.CylinderGeometry(0.18, 0.24, 0.06, 12), AMBER, 4.5, { at: [s * 1.19, 0.56, 1.96], rot: [0.22, 0, s * -0.1] });
  }
}

/** Pelvis & waist turntable block on the legs group. */
function pelvis(b: ModelBuilder): void {
  const y = FRAME_PLACES.hips - 0.16;
  // Waist turret bearing ring.
  b.solid(prism(ngon(1.06, 8, Math.PI / 8), 0.26, 0.04), STEEL, { at: [0, y + 0.16, 0.18], rot: FLAT });
  // Sculpted central pelvis block & armoured groin codpiece.
  b.solid(prism([[-0.84, -0.58], [0.88, -0.46], [1.04, 0.02], [0.76, 0.22], [-0.74, 0.22], [-0.92, -0.14]], 1.48, 0.06), OBSIDIAN, { at: [0, y - 0.14, 0.18], rot: ACROSS });
  b.solid(prism([[0.4, -0.68], [0.96, -0.52], [1.06, -0.02], [0.56, 0.08]], 0.72, 0.04), PLATE, { at: [0, y - 0.14, 0.18], rot: ACROSS });
  // Twin cylindrical hip axle drums & hydraulic stabilizers.
  b.cyl(0.34, 0.34, 2.28, 14, IRON, { at: [0, y - 0.14, 0.2], rot: [0, 0, Math.PI / 2] });
  for (const s of [-1, 1]) {
    b.cyl(0.38, 0.38, 0.16, 14, BRASS, { at: [s * 0.84, y - 0.14, 0.2], rot: [0, 0, Math.PI / 2] });
  }
}

/**
 * One reverse-jointed leg, hip at the origin (world `y = 3.65`), foot sole flush at `y = -3.65` (world `0.0`):
 * hip drum → forward-raked bevelled thigh + pistons → armoured knee shield → swept-back shin + actuator → ankle → 3-toed foot.
 */
function leg(b: ModelBuilder, s: number): void {
  // Hip joint cap.
  b.cyl(0.36, 0.36, 0.42, 14, STEEL, { at: [s * 0.04, 0, 0], rot: [0, 0, Math.PI / 2] });

  // Upper thigh running forward-down from hip (0, 0, 0) to knee (0, -1.18, -0.78).
  b.solid(prism([[-0.34, -0.72], [0.36, -0.72], [0.34, 0.72], [-0.32, 0.72]], 0.68, 0.05), GUNMETAL, { at: [s * 0.04, -0.59, -0.39], rot: [0.58, 0, 0] });
  // Outer bevelled thigh fairing plate.
  b.solid(prism([[-0.22, -0.66], [0.22, -0.66], [0.26, 0.64], [-0.26, 0.64]], 0.66, 0.04), PLATE, { at: [s * 0.34, -0.59, -0.4], rot: [0.58, 0, 0] });
  // Rear twin hydraulic thigh pistons.
  b.cyl(0.085, 0.085, 1.24, 10, STEEL, { at: [s * -0.06, -0.62, -0.12], rot: [0.58, 0, 0] });
  b.cyl(0.11, 0.11, 0.34, 10, BRASS, { at: [s * -0.06, -0.46, -0.22], rot: [0.58, 0, 0] });

  // Reverse-joint knee drum & jutting chamfered knee armour shield.
  b.cyl(0.34, 0.34, 0.72, 14, IRON, { at: [0, -1.18, -0.78], rot: [0, 0, Math.PI / 2] });
  b.solid(prism([[-0.12, -0.42], [0.42, -0.24], [0.48, 0.18], [0.14, 0.44], [-0.18, 0.32]], 0.68, 0.045), PLATE, { at: [0, -1.16, -0.96], rot: ACROSS });
  b.glow(new THREE.BoxGeometry(0.42, 0.04, 0.03), AMBER, 3.2, { at: [0, -1.04, -1.36] });

  // Swept-back shin from knee (0, -1.18, -0.78) down-back to rear hock (0, -2.56, 0.38).
  b.solid(prism([[-0.28, -0.95], [0.28, -0.95], [0.32, 0.95], [-0.32, 0.95]], 0.52, 0.045), OBSIDIAN, { at: [0, -1.86, -0.2], rot: [-0.68, 0, 0] });
  // Front armoured shin greave (aligned along the front face of the shin).
  b.solid(prism([[-0.24, -0.82], [0.24, -0.82], [0.28, 0.78], [-0.28, 0.78]], 0.24, 0.035), PLATE, { at: [0, -1.96, -0.34], rot: [-0.68, 0, 0] });
  // Exposed calf hydraulic damper rod.
  b.cyl(0.075, 0.075, 1.56, 10, STEEL, { at: [0, -1.82, 0.12], rot: [-0.68, 0, 0] });
  b.cyl(0.11, 0.11, 0.48, 10, IRON, { at: [0, -1.56, -0.1], rot: [-0.68, 0, 0] });

  // Rear hock drum & lower ankle strut down-forward to ankle (0, -3.32, -0.02).
  b.cyl(0.26, 0.26, 0.56, 12, STEEL, { at: [0, -2.56, 0.38], rot: [0, 0, Math.PI / 2] });
  b.solid(prism([[-0.2, -0.46], [0.22, -0.44], [0.24, 0.44], [-0.22, 0.46]], 0.4, 0.03), STEEL, { at: [0, -2.94, 0.18], rot: [0.48, 0, 0] });
  b.cyl(0.24, 0.24, 0.58, 12, IRON, { at: [0, -3.32, -0.02], rot: [0, 0, Math.PI / 2] });

  // Heavy 3-toed foot — bottom sole flush at y = -3.65 (world y = 0.0).
  b.solid(prism([[-0.44, -0.15], [0.56, -0.15], [0.48, 0.18], [-0.36, 0.18]], 0.86, 0.035), OBSIDIAN, { at: [0, -3.5, -0.02], rot: ACROSS });
  // Twin splayed armoured front toes.
  for (const ts of [-1, 1]) {
    b.solid(prism([[0.18, -0.14], [1.14, -0.14], [1.06, 0.06], [0.36, 0.2]], 0.34, 0.03), PLATE, { at: [ts * 0.32, -3.51, -0.06], rot: [0, Math.PI / 2 - ts * 0.16, 0] });
    b.box(0.32, 0.05, 0.62, DARK, { at: [ts * 0.34, -3.625, -0.68], rot: [0, -ts * 0.16, 0] });
  }
  // Sturdy rear stabilizer heel spur.
  b.solid(prism([[-0.96, -0.14], [-0.24, -0.14], [-0.28, 0.14], [-0.84, 0.06]], 0.46, 0.03), GUNMETAL, { at: [0, -3.51, 0.0], rot: ACROSS });
  b.box(0.42, 0.05, 0.56, DARK, { at: [0, -3.625, 0.62] });
}

export interface StandInOptions {
  /** Parked / empty standby crouch with amber visor optics. */
  parked?: boolean;
  /** Jump jets currently burning: lights twin thruster exhaust cones. */
  jets?: boolean;
  /** 0..3 progressive cockpit canopy crack overlay stage. */
  cracks?: number;
  /** True while flying (Jump-Jet or Afterburner). */
  flying?: boolean;
  /** True while in Afterburner jet mode (legs fold back, wings deploy). */
  jetMode?: boolean;
  /** True while hovering (Rotor Engine or Aero-Quad mid-air hover). */
  hover?: boolean;
  /** True when rolling on Treads. */
  treads?: boolean;
  /** 0..1 forward torso dive pitch during an angled Pile-Driver dive-slam (also flares thrusters in 3P). */
  diveTilt?: number;
  /** Frame delta time in seconds for animated attachments. */
  dt?: number;
  /** Visual hover lift above feet (e.g. Mag-Skiff Hover Hull = 0.65). */
  hoverHeight?: number;
  /** Active Core Expansion visual state (Nova / Aegis / Dome / Last-Stand). */
  expansion?: ExpansionVisualState | null;
  /** Engine extra animation telemetry (blink/redline/assault). */
  charging?: boolean;
  redline?: number;
  dashDirX?: number;
  dashDirZ?: number;
  /** Leg extra animation telemetry (wheels drift / hover / aero-quad). */
  turnRate?: number;
  speed?: number;
  /** Camera pitch for subtle head-tracking animation. */
  aimPitch?: number;
}

/** The Frame's full procedural exterior & cockpit rig, posed every frame. */
export class StandIn {
  readonly cockpit: THREE.Group;
  readonly torso: THREE.Group;
  readonly legs = new THREE.Group();
  private readonly materials: ModelMaterials;
  private cockpitStandard: THREE.Group;
  private readonly hull: THREE.Group;
  private hullCore: THREE.Group;
  private standardLegs: THREE.Group;
  private readonly headAnchor = new THREE.Group();
  /** Slot 0..2 shoulder mount anchors on the hull; each holds cached shoulder weapon meshes. */
  private readonly shoulderAnchors: THREE.Group[] = [];
  private shoulderCache: Partial<Record<ShoulderKind, THREE.Group>>[] = [{}, {}, {}];
  private readonly visorActive: THREE.Mesh;
  private readonly visorActiveMat: THREE.MeshBasicMaterial;
  private readonly visorStandby: THREE.Mesh;
  private readonly visorStandbyMat: THREE.MeshBasicMaterial;
  private readonly jetCones: THREE.Mesh[] = [];
  private readonly jetConeMat: THREE.MeshBasicMaterial;
  private readonly cracks: THREE.LineSegments[] = [];
  private readonly sides: THREE.Group[] = [];
  private legsCache: Partial<Record<GaitKind, LegsVisual | null>> = {};
  private activeLegs: LegsVisual | null = null;
  private cockpitCache: Partial<Record<FramePartId, CockpitVisual | null>> = {};
  private activeCockpit: CockpitVisual | null = null;
  private headCache: Partial<Record<HeadKind, HeadVisual | null>> = {};
  private activeHead: HeadVisual | null = null;
  private engineCache: Partial<Record<DriveKind, EngineVisual | null>> = {};
  private activeEngine: EngineVisual | null = null;
  private readonly expansions: ExpansionVisuals;
  private palette: FramePalette = BUREAU_PALETTE;
  private paletteSig: string = paletteKey(BUREAU_PALETTE);
  private hoverClock = 0;
  private kneel = 0;
  private collapse = 0;
  private limpSide: -1 | 0 | 1 = 0;

  constructor(materials: ModelMaterials, scene: THREE.Scene) {
    this.materials = materials;
    this.cockpit = new THREE.Group();
    this.cockpit.name = 'frame.cockpit';
    this.cockpitStandard = this.buildCockpitStandard();
    this.cockpit.add(this.cockpitStandard);
    for (let i = 0; i < CRACK_SETS.length; i++) {
      const layer = makeCrackLayer(CRACK_SETS[i]!, 0.34 + i * 0.12);
      this.cockpit.add(layer);
      this.cracks.push(layer);
    }

    this.hull = new THREE.Group();
    this.hullCore = this.buildHullCore();
    this.hull.add(this.hullCore);

    this.headAnchor.position.set(FRAME_PLACES.head[0], FRAME_PLACES.head[1], FRAME_PLACES.head[2]);
    this.hull.add(this.headAnchor);

    for (let i = 0; i < FRAME_PLACES.shoulders.length; i++) {
      const anchor = new THREE.Group();
      const pos = FRAME_PLACES.shoulders[i]!;
      anchor.position.set(pos[0], pos[1], pos[2]);
      this.hull.add(anchor);
      this.shoulderAnchors.push(anchor);
    }

    const pd = frameBuilder(this.palette);
    SHOULDER_MODELS.pod6(pd);
    const podGroup = materials.group(pd);
    this.shoulderAnchors[0]!.add(podGroup);
    this.shoulderCache[0]!.pod6 = podGroup;

    // Dual-state glowing canopy visor slit (primary glow when active, secondary glow when parked/empty).
    const visorGeo = new THREE.BoxGeometry(1.36, 0.11, 0.06);
    this.visorActiveMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(RED).multiplyScalar(4.2), toneMapped: false });
    this.visorActive = new THREE.Mesh(visorGeo, this.visorActiveMat);
    this.visorActive.position.set(0, 1.32, -2.24);
    this.visorActive.rotation.x = -0.14;
    this.hull.add(this.visorActive);

    this.visorStandbyMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(AMBER).multiplyScalar(3.4), toneMapped: false });
    this.visorStandby = new THREE.Mesh(visorGeo, this.visorStandbyMat);
    this.visorStandby.position.copy(this.visorActive.position);
    this.visorStandby.rotation.copy(this.visorActive.rotation);
    this.visorStandby.visible = false;
    this.hull.add(this.visorStandby);

    // Twin dynamic thruster flame cones under the back jet bells.
    const coneGeo = new THREE.ConeGeometry(0.28, 1.6, 10, 1, true);
    coneGeo.translate(0, -0.8, 0);
    this.jetConeMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#ff8828').multiplyScalar(3.5), transparent: true, opacity: 0.85, side: THREE.DoubleSide, toneMapped: false,
    });
    for (let i = 0; i < DEFAULT_JET_NOZZLES.length; i++) {
      const n = DEFAULT_JET_NOZZLES[i]!;
      const s = i === 0 ? -1 : 1;
      const cone = new THREE.Mesh(coneGeo, this.jetConeMat);
      cone.position.set(n[0], n[1], n[2]);
      cone.rotation.set(0.22, 0, s * -0.1);
      cone.visible = false;
      this.hull.add(cone);
      this.jetCones.push(cone);
    }

    this.torso = new THREE.Group();
    this.torso.name = 'frame.torso';
    this.torso.add(this.hull);

    this.expansions = new ExpansionVisuals(scene);
    this.torso.add(this.expansions.root);

    this.standardLegs = this.buildStandardLegs();
    this.legs.add(this.standardLegs);
    this.legs.name = 'frame.legs';
    for (const g of [this.cockpit, this.torso, this.legs]) {
      g.visible = false;
      scene.add(g);
    }
  }

  /** Active torso hardpoints (arms, shoulders, head, eye, jets) for the equipped chassis. */
  get places(): ChassisPlaces {
    return this.activeCockpit?.places ?? STANDARD_CHASSIS_PLACES;
  }

  private buildCockpitStandard(): THREE.Group {
    const c = frameBuilder(this.palette);
    cockpit(c);
    return this.materials.group(c, this.materials.nearby);
  }

  private buildHullCore(): THREE.Group {
    const h = frameBuilder(this.palette);
    hull(h);
    return this.materials.group(h);
  }

  private buildStandardLegs(): THREE.Group {
    this.sides.length = 0;
    const g = new THREE.Group();
    const hips = frameBuilder(this.palette);
    pelvis(hips);
    g.add(this.materials.group(hips));
    for (const s of [-1, 1]) {
      const b = frameBuilder(this.palette);
      leg(b, s);
      const side = new THREE.Group();
      side.add(this.materials.group(b));
      side.position.set(s * 1.05, FRAME_PLACES.hips - 0.25, 0.2);
      g.add(side);
      this.sides.push(side);
    }
    return g;
  }

  /** Rebuilds base geometry and clears cached modular attachments when the active paint livery changes. */
  private applyPalette(next: FramePalette): void {
    const sig = paletteKey(next);
    if (sig === this.paletteSig) return;
    this.palette = next;
    this.paletteSig = sig;

    // Retint dynamic glow materials (visor & thruster cones & expansion shells).
    this.visorActiveMat.color.set(next.glow).multiplyScalar(4.2);
    this.visorStandbyMat.color.set(next.secondaryGlow).multiplyScalar(3.4);
    this.jetConeMat.color.set(next.thruster).multiplyScalar(3.5);
    this.expansions.setPalette(next);

    // Rebuild standard cockpit, hull core, and standard legs.
    this.cockpit.remove(this.cockpitStandard);
    this.cockpitStandard = this.buildCockpitStandard();
    this.cockpit.add(this.cockpitStandard);

    this.hull.remove(this.hullCore);
    this.hullCore = this.buildHullCore();
    this.hull.add(this.hullCore);

    this.legs.remove(this.standardLegs);
    this.standardLegs = this.buildStandardLegs();
    this.legs.add(this.standardLegs);

    // Clear modular caches so every equipped attachment rebuilds in the new palette.
    for (let slot = 0; slot < this.shoulderAnchors.length; slot++) {
      const anchor = this.shoulderAnchors[slot]!;
      for (const mesh of Object.values(this.shoulderCache[slot]!)) if (mesh) anchor.remove(mesh);
      this.shoulderCache[slot] = {};
    }
    for (const lv of Object.values(this.legsCache)) if (lv) this.legs.remove(lv.group);
    this.legsCache = {};
    this.activeLegs = null;

    for (const cv of Object.values(this.cockpitCache)) {
      if (cv?.exterior) this.hull.remove(cv.exterior);
      if (cv?.interior) this.cockpit.remove(cv.interior);
    }
    this.cockpitCache = {};
    this.activeCockpit = null;

    for (const hv of Object.values(this.headCache)) if (hv) this.headAnchor.remove(hv.group);
    this.headCache = {};
    this.activeHead = null;

    for (const ev of Object.values(this.engineCache)) if (ev) this.hull.remove(ev.group);
    this.engineCache = {};
    this.activeEngine = null;
  }

  /** Syncs anchor transforms (head, shoulders, jet nozzles) to the active chassis hardpoints. */
  private syncHardpoints(): void {
    const p = this.places;
    this.headAnchor.position.set(p.head[0], p.head[1], p.head[2]);
    for (let i = 0; i < this.shoulderAnchors.length; i++) {
      const pos = p.shoulders[i] ?? FRAME_PLACES.shoulders[i]!;
      this.shoulderAnchors[i]!.position.set(pos[0], pos[1], pos[2]);
    }
    const nozzles = p.jetNozzles ?? DEFAULT_JET_NOZZLES;
    for (let i = 0; i < this.jetCones.length; i++) {
      const n = nozzles[i] ?? DEFAULT_JET_NOZZLES[i]!;
      this.jetCones[i]!.position.set(n[0], n[1], n[2]);
    }
  }

  /** Updates modular chassis, head, shoulder, leg, engine, and paint livery visuals to match `loadout`. */
  setLoadout(loadout: FrameLoadout): void {
    const palette = resolvePalette(paintOf(loadout), loadout.customPaint);
    this.applyPalette(palette);

    const stats = frameStats(loadout);

    // Cockpit / full Chassis visual swap.
    const nextCockpit = this.cockpitVisualFor(loadout.cockpit);
    if (this.activeCockpit && this.activeCockpit !== nextCockpit) {
      if (this.activeCockpit.exterior) this.activeCockpit.exterior.visible = false;
      if (this.activeCockpit.interior) this.activeCockpit.interior.visible = false;
    }
    this.activeCockpit = nextCockpit;
    this.hullCore.visible = !(nextCockpit?.replacesHull);
    this.cockpitStandard.visible = !(nextCockpit?.hideStandardInterior);
    if (nextCockpit?.exterior) nextCockpit.exterior.visible = true;
    if (nextCockpit?.interior) nextCockpit.interior.visible = true;
    this.syncHardpoints();

    // Head / Sensor Crown visual swap.
    const headKind = headOf(loadout);
    const nextHead = this.headVisualFor(headKind);
    if (this.activeHead && this.activeHead !== nextHead) this.activeHead.group.visible = false;
    this.activeHead = nextHead;
    if (nextHead) nextHead.group.visible = true;

    // Shoulder weapon visuals.
    const fitted = shouldersOf(loadout);
    for (let slot = 0; slot < this.shoulderAnchors.length; slot++) {
      const kind = fitted[slot];
      const cache = this.shoulderCache[slot]!;
      for (const existing of Object.values(cache)) if (existing) existing.visible = false;
      if (!kind) continue;
      let group = cache[kind];
      if (!group) {
        const b = frameBuilder(this.palette);
        SHOULDER_MODELS[kind](b);
        group = this.materials.group(b);
        this.shoulderAnchors[slot]!.add(group);
        cache[kind] = group;
      }
      group.visible = true;
    }

    // Legs visual swap.
    const nextLegs = this.legsVisualFor(stats.gait);
    if (this.activeLegs && this.activeLegs !== nextLegs) this.activeLegs.group.visible = false;
    this.activeLegs = nextLegs;
    this.standardLegs.visible = nextLegs === null;
    if (nextLegs) nextLegs.group.visible = true;

    // Engine visual swap.
    const nextEngine = this.engineVisualFor(stats.drive);
    if (this.activeEngine && this.activeEngine !== nextEngine) this.activeEngine.group.visible = false;
    this.activeEngine = nextEngine;
    if (nextEngine) nextEngine.group.visible = true;
  }

  private legsVisualFor(gait: GaitKind): LegsVisual | null {
    if (gait === 'walker') return null;
    if (Object.hasOwn(this.legsCache, gait)) return this.legsCache[gait] ?? null;
    let built: LegsVisual | null = null;
    if (gait === 'sprinter') built = buildSprinterLegs(this.materials, FRAME_PLACES.hips, this.palette);
    else if (gait === 'heavy') built = buildHeavyLegs(this.materials, FRAME_PLACES.hips, this.palette);
    else if (gait === 'treads') built = buildTreadsLegs(this.materials, FRAME_PLACES.hips, this.palette);
    else if (gait === 'spider') built = buildSpiderLegs(this.materials, FRAME_PLACES.hips, this.palette);
    else if (gait === 'hover') built = buildHoverLegs(this.materials, FRAME_PLACES.hips, this.palette);
    else if (gait === 'wheels') built = buildWheelLegs(this.materials, FRAME_PLACES.hips, this.palette);
    else if (gait === 'aeroQuad') built = buildAeroQuadLegs(this.materials, FRAME_PLACES.hips, this.palette);
    if (built) {
      built.group.visible = false;
      this.legs.add(built.group);
    }
    this.legsCache[gait] = built;
    return built;
  }

  private cockpitVisualFor(id: FramePartId): CockpitVisual | null {
    if (id === 'cockpitStandard') return null;
    if (Object.hasOwn(this.cockpitCache, id)) return this.cockpitCache[id] ?? null;
    const built = buildChassisVisual(id, this.materials, this.palette);
    if (built?.exterior) {
      built.exterior.visible = false;
      this.hull.add(built.exterior);
    }
    if (built?.interior) {
      built.interior.visible = false;
      this.cockpit.add(built.interior);
    }
    this.cockpitCache[id] = built;
    return built;
  }

  private headVisualFor(head: HeadKind): HeadVisual | null {
    if (head === 'standard') return null;
    if (Object.hasOwn(this.headCache, head)) return this.headCache[head] ?? null;
    const built = buildHeadVisual(head, this.materials, this.palette);
    if (built) {
      built.group.visible = false;
      this.headAnchor.add(built.group);
    }
    this.headCache[head] = built;
    return built;
  }

  private engineVisualFor(drive: DriveKind): EngineVisual | null {
    if (drive === 'jets') return null;
    if (Object.hasOwn(this.engineCache, drive)) return this.engineCache[drive] ?? null;
    const built = buildEngineVisual(drive, this.materials, this.palette);
    if (built) {
      built.group.visible = false;
      this.hull.add(built.group);
    }
    this.engineCache[drive] = built;
    return built;
  }

  /** Sets non-stride mechanical poses: kneeling (0..1), collapse (0..1), canopy cracks (0..3), leg limp and pod damage. */
  setPoseState(kneel: number, collapse: number, cracks: number, limpSide: -1 | 0 | 1, podDown: boolean): void {
    this.kneel = clamp(kneel);
    this.collapse = clamp(collapse);
    this.limpSide = limpSide;
    this.setCracks(cracks);
    this.shoulderAnchors[0]!.rotation.set(podDown ? 0.36 : 0, 0, podDown ? -0.4 : 0);
  }

  /**
   * `stride` is in plants: the left foot is down on even ones, the right on odd. `walk` is 0..1 of a full walk, which sets
   * how far the legs swing. `sink` lowers the hull on its legs and `sway` moves it along its right, the eye with it.
   * `inside` hides the hull round the eye and shows the cockpit. Writes the eye into `eye`.
   */
  pose(
    feet: THREE.Vector3, legYaw: number, viewYaw: number, stride: number, walk: number, sink: number, sway: number,
    inside: boolean, eye: THREE.Vector3, options?: StandInOptions,
  ): void {
    const dt = options?.dt ?? 1 / 60;
    const parked = options?.parked === true;
    const jets = options?.jets === true;
    const flying = options?.flying === true;
    const jetMode = options?.jetMode === true;
    const hover = options?.hover === true;
    const diveTilt = clamp(options?.diveTilt ?? 0);
    const hoverHeight = options?.hoverHeight ?? 0;
    this.hoverClock += dt;
    const hoverLift = hoverHeight > 0 && !parked && this.collapse < 0.2
      ? hoverHeight + Math.sin(this.hoverClock * 3.2) * 0.08
      : 0;
    const standby = parked || this.kneel > 0.1 || this.collapse > 0.1;
    const effectiveSink = (parked ? sink - 0.42 : sink) - this.kneel * 1.35 - this.collapse * 1.9 + hoverLift;
    const limpRoll = this.limpSide * 0.08 * (0.4 + 0.6 * Math.abs(Math.sin(stride * Math.PI)));
    const p = this.places;

    this.legs.visible = this.torso.visible = true;
    this.legs.position.set(feet.x, feet.y + hoverLift, feet.z);
    this.legs.rotation.y = legYaw;
    this.torso.position.set(feet.x + Math.cos(viewYaw) * sway, feet.y + FRAME_PLACES.hips + effectiveSink, feet.z - Math.sin(viewYaw) * sway);
    this.torso.rotation.set(
      (p.posturePitch ?? 0) + (parked ? -0.1 : 0) + (jetMode ? -0.55 : 0) - diveTilt * 0.42 + this.kneel * 0.22 + this.collapse * 0.42,
      viewYaw,
      limpRoll + this.collapse * 0.26,
      'YXZ',
    );
    this.place(p.eye, eye);

    this.hull.visible = !inside;
    this.cockpit.visible = inside;
    this.cockpit.position.copy(eye);
    this.cockpit.rotation.set(0, viewYaw, 0);

    const hideVisor = this.activeCockpit?.hideStandardVisor === true || this.activeCockpit?.replacesHull === true;
    this.visorActive.visible = !hideVisor && !standby;
    this.visorStandby.visible = !hideVisor && standby;
    if (this.activeCockpit?.visorActive) this.activeCockpit.visorActive.visible = !standby;
    if (this.activeCockpit?.visorStandby) this.activeCockpit.visorStandby.visible = standby;

    const burn = jets || flying || jetMode || diveTilt > 0.15 || options?.charging === true;
    for (let i = 0; i < this.jetCones.length; i++) {
      const cone = this.jetCones[i]!;
      cone.visible = burn && !inside;
      if (burn) cone.scale.set(1, (jetMode || diveTilt > 0.5 || options?.charging ? 1.55 : 0.85) + Math.abs(Math.sin(stride * 13 + i * 2.1)) * 0.45, 1);
    }
    if (options?.cracks !== undefined) this.setCracks(options.cracks);

    this.expansions.sync(options?.expansion ?? null, dt, inside);

    if (this.activeHead?.pose) {
      this.activeHead.pose(0, options?.aimPitch ?? 0, dt, standby);
    }

    if (this.activeEngine) {
      this.activeEngine.pose(dt, jets, flying, hover, jetMode, stride, inside, {
        charging: options?.charging,
        redline: options?.redline,
        dashDirX: options?.dashDirX,
        dashDirZ: options?.dashDirZ,
      });
    }

    if (this.activeLegs) {
      this.activeLegs.pose(stride, walk, effectiveSink - hoverLift, this.kneel, this.collapse, this.limpSide, parked, jetMode, {
        hovering: hover,
        flying,
        dt,
        turnRate: options?.turnRate,
        speed: options?.speed,
      });
      return;
    }

    const swing = 0.28 * clamp(walk);
    const crouchFlex = this.kneel * 0.32 + this.collapse * 0.48 + (jetMode ? 0.95 : 0);
    for (let i = 0; i < 2; i++) {
      // Over two plants: planted and pushed back for one, lifted and carried forward for the next.
      const u = ((stride + i) % 2 + 2) % 2 / 2;
      const planted = u < 0.5;
      const k = planted ? u * 2 : (u - 0.5) * 2;
      const side = this.sides[i]!;
      const isLimping = (i === 0 ? -1 : 1) === this.limpSide;
      const strideRot = planted ? swing * (1 - 2 * k) : swing * (2 * k - 1);
      side.rotation.x = parked ? 0.08 : (jetMode ? 0 : strideRot * (isLimping ? 0.55 : 1)) + crouchFlex;
      side.position.y = FRAME_PLACES.hips - 0.25 + (effectiveSink - hoverLift) * 0.45 + (planted || jetMode ? 0 : Math.sin(k * Math.PI) * 0.45 * clamp(walk * 2) * (isLimping ? 0.45 : 1));
    }
  }

  /** Reveal 0..3 progressive crack layers on the inner cockpit glass. */
  setCracks(stage: number): void {
    const suppress = this.activeCockpit?.hideStandardInterior === true;
    for (let i = 0; i < this.cracks.length; i++) this.cracks[i]!.visible = !suppress && i < stage;
  }

  /** In torso space to the world, from the last `pose`. */
  place(local: readonly [number, number, number], out: THREE.Vector3): THREE.Vector3 {
    return out.set(local[0], local[1], local[2]).applyAxisAngle(_up, this.torso.rotation.y).add(this.torso.position);
  }

  hide(): void {
    this.cockpit.visible = this.torso.visible = this.legs.visible = false;
    this.expansions.hide();
  }
}

const _up = new THREE.Vector3(0, 1, 0);
