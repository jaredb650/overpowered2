/**
 * The Distraint Frame's procedural 3D chassis, first-person cockpit, and arm weapons — Bureau heavy-industrial silhouette
 * built from bevelled 2D profiles (`prism`) in obsidian, gunmetal, steel, brass, crimson optics, and amber standby lamps.
 *
 *   The cockpit   near-view roll-cage, brow, sill, and angled side consoles round the eye, with open chin glass so
 *                 looking down shows the ground at the feet for stomps, plus 3 progressive canopy crack overlays.
 *   The arms      world-space `Gun`s (20 mm six-barrel Vulcan on the left, 40 mm autocannon with an armoured melee
 *                 strike-gauntlet on the right) visible in the bottom corners from inside and articulated from outside.
 *   The body      hunched bevelled torso, overhanging visor brow, layered shoulder pauldrons, sculpted 6-tube missile
 *                 pod with visible warheads, dorsal reactor cooling slats, twin thruster bells with live jet cones,
 *                 pelvis turntable, and reverse-jointed 3-toed legs.
 *
 * Every place is in torso space: x right, y up from the hips, -z ahead. `FRAME_PLACES` keeps eye, arms, pod and jets
 * aligned between single-player (`Frame`) and co-op (`FramePuppet`).
 */
import * as THREE from 'three';
import { clamp, TAU } from '../core/math';
import { ModelBuilder, type ModelMaterials } from '../progression/modelkit';
import type { GunSpec } from '../vehicles/guns';
import { FRAME } from './data';

const OBSIDIAN = '#15181d';
const GUNMETAL = '#2b313a';
const PLATE = '#47505c';
const STEEL = '#6b7582';
const IRON = '#1e2228';
const DARK = '#0b0d10';
const BRASS = '#a5894b';
const RED = '#ff2a1a';
const AMBER = '#ffaa30';
const ALONG_Z: readonly [number, number, number] = [Math.PI / 2, 0, 0];
const ACROSS: readonly [number, number, number] = [0, Math.PI / 2, 0];
const FLAT: readonly [number, number, number] = [-Math.PI / 2, 0, 0];

/** A 2D outline extruded `depth` with a chamfer on every edge, centred on its depth. With `rot: ACROSS`, `[u, v]` maps to `z = -u, y = v`. */
function prism(points: readonly (readonly [number, number])[], depth: number, bevel: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const core = Math.max(0.01, depth - bevel * 2);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: core, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 4,
  });
  return geo.translate(0, 0, -core / 2);
}

function ngon(r: number, n: number, turn = 0): [number, number][] {
  return Array.from({ length: n }, (_, i) => [Math.cos((i / n) * TAU + turn) * r, Math.sin((i / n) * TAU + turn) * r] as [number, number]);
}

/** Hips over the feet, and the torso's places from there. */
export const FRAME_PLACES = {
  hips: 3.9,
  /** The eye: `FRAME.eye` over the feet, `FRAME.podAhead` ahead of the hips. */
  eye: [0, FRAME.eye - 3.9, -FRAME.podAhead] as const,
  /** Where each arm's gun turns. */
  rotary: [-1.75, 0.15, -1.15] as const,
  cannon: [1.75, 0.15, -1.15] as const,
  /** The middle of the six tubes on the right shoulder. */
  pod: [1.55, 2.35, 0.2] as const,
  /** Where the jets burn, on the back. */
  jets: [0, 1.0, 1.9] as const,
} as const;

/** The left arm: a 20 mm six-barrel Vulcan with an armoured forearm shroud, side ammo drum and brass feed chute. */
export const ROTARY_ARM: GunSpec = {
  name: 'frame-rotary',
  build: b => {
    // Chamfered main receiver housing (+u forward along -Z).
    b.solid(prism([[-1.12, -0.34], [0.46, -0.32], [0.64, -0.14], [0.64, 0.22], [0.36, 0.42], [-0.95, 0.42], [-1.18, 0.18]], 0.78, 0.05), OBSIDIAN, { rot: ACROSS });
    // Top angled armour cowling & cooling ribs.
    b.solid(prism([[-0.88, 0.38], [0.42, 0.38], [0.58, 0.24], [0.22, 0.52], [-0.74, 0.52]], 0.74, 0.03), PLATE, { rot: ACROSS });
    for (let i = 0; i < 4; i++) b.box(0.56, 0.04, 0.08, DARK, { at: [0, 0.51, -0.15 + i * 0.22] });
    // Outer forearm shield plate.
    b.solid(prism([[-0.9, -0.26], [0.52, -0.22], [0.62, 0.04], [0.36, 0.28], [-0.78, 0.3]], 0.18, 0.03), GUNMETAL, { at: [-0.46, 0.02, 0], rot: ACROSS });
    // Underslung cylindrical ammo drum & brass feed chute.
    b.cyl(0.32, 0.32, 0.62, 14, GUNMETAL, { at: [-0.52, -0.22, 0.32], rot: ALONG_Z });
    b.cyl(0.24, 0.24, 0.66, 12, IRON, { at: [-0.52, -0.22, 0.32], rot: ALONG_Z });
    b.box(0.26, 0.24, 0.36, BRASS, { at: [-0.26, -0.12, 0.28], rot: [0, 0, 0.45] });
    // Front machined bearing collar + inner rotor drive housing.
    b.cyl(0.34, 0.38, 0.28, 16, STEEL, { at: [0, 0, -0.66], rot: ALONG_Z });
    b.cyl(0.28, 0.28, 0.14, 14, DARK, { at: [0, 0, -0.82], rot: ALONG_Z });
    // Rear hydraulic elbow yoke.
    b.cyl(0.28, 0.28, 0.52, 12, STEEL, { at: [0, 0.18, 0.96], rot: [0, 0, Math.PI / 2] });
    // Thin Bureau crimson telemetry strip along the inboard cheek.
    b.glow(new THREE.BoxGeometry(0.035, 0.035, 0.64), RED, 3.8, { at: [0.4, 0.22, 0.05] });
    b.glow(new THREE.BoxGeometry(0.03, 0.12, 0.04), AMBER, 3, { at: [0.4, 0.04, -0.35] });
  },
  moving: b => {
    // Central rotor shaft & six fluted barrels.
    b.cyl(0.075, 0.075, 1.92, 10, IRON, { at: [0, 0, -1.62], rot: ALONG_Z });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      b.cyl(0.052, 0.056, 2.02, 8, i % 2 ? DARK : STEEL, { at: [Math.cos(a) * 0.165, Math.sin(a) * 0.165, -1.66], rot: ALONG_Z });
    }
    // Two perforated barrel stabilizer clamps + heavy slotted muzzle crown.
    for (const z of [-1.08, -1.86]) {
      b.cyl(0.255, 0.255, 0.09, 16, PLATE, { at: [0, 0, z], rot: ALONG_Z });
      b.cyl(0.265, 0.265, 0.03, 16, IRON, { at: [0, 0, z + 0.04], rot: ALONG_Z });
    }
    b.cyl(0.265, 0.245, 0.18, 16, OBSIDIAN, { at: [0, 0, -2.56], rot: ALONG_Z });
    b.cyl(0.23, 0.23, 0.05, 16, BRASS, { at: [0, 0, -2.46], rot: ALONG_Z });
  },
  muzzle: [0, 0, -2.68],
  follow: 22,
  return: 22,
};

/** The right arm: a 40 mm autocannon on hydraulic recoil rails with an armoured melee strike-gauntlet blade. */
export const CANNON_ARM: GunSpec = {
  name: 'frame-cannon',
  build: b => {
    // Heavy chamfered breech housing (+u forward along -Z).
    b.solid(prism([[-1.18, -0.36], [0.54, -0.34], [0.76, -0.1], [0.72, 0.26], [0.34, 0.48], [-0.98, 0.48], [-1.24, 0.2]], 0.84, 0.05), OBSIDIAN, { rot: ACROSS });
    // Sloped upper armour mantle & breech inspection hatch.
    b.solid(prism([[-0.92, 0.42], [0.46, 0.42], [0.64, 0.28], [0.24, 0.58], [-0.8, 0.56]], 0.78, 0.035), PLATE, { rot: ACROSS });
    // Side-mounted 40 mm clip box with exposed brass shell rims.
    b.solid(prism([[-0.64, -0.24], [0.24, -0.24], [0.28, 0.22], [-0.56, 0.28]], 0.34, 0.03), GUNMETAL, { at: [0.56, -0.02, 0.2], rot: ACROSS });
    for (let i = 0; i < 4; i++) b.cyl(0.042, 0.042, 0.14, 8, BRASS, { at: [0.44, 0.16, -0.02 + i * 0.14], rot: [0, 0, Math.PI / 2] });
    // Twin hydraulic recoil recuperator tubes flanking the breech.
    for (const s of [-1, 1]) {
      b.cyl(0.085, 0.085, 1.05, 10, IRON, { at: [s * 0.28, -0.28, -0.68], rot: ALONG_Z });
      b.cyl(0.055, 0.055, 0.48, 8, STEEL, { at: [s * 0.28, -0.28, -1.28], rot: ALONG_Z });
      b.cyl(0.095, 0.095, 0.06, 10, BRASS, { at: [s * 0.28, -0.28, -1.12], rot: ALONG_Z });
    }
    // Armoured melee knuckle-ram strike blade along the outer forearm (visually reads during backhand sweeps!).
    b.solid(prism([[-0.35, -0.44], [0.95, -0.42], [1.28, -0.18], [1.05, 0.12], [-0.25, 0.18]], 0.22, 0.035), PLATE, { at: [0.52, -0.12, -0.48], rot: ACROSS });
    b.box(0.06, 0.34, 0.92, STEEL, { at: [0.64, -0.18, -0.82], rot: [0.1, 0, 0] });
    // Rear elbow gimbal.
    b.cyl(0.3, 0.3, 0.56, 12, STEEL, { at: [0, 0.18, 1.0], rot: [0, 0, Math.PI / 2] });
    // Bureau red accent bar & ready lamp on the inboard face.
    b.glow(new THREE.BoxGeometry(0.035, 0.035, 0.68), RED, 3.8, { at: [-0.43, 0.24, 0.02] });
    b.glow(new THREE.BoxGeometry(0.03, 0.12, 0.04), AMBER, 3, { at: [-0.43, 0.06, -0.4] });
  },
  moving: b => {
    // Heavy thermal-sleeved 40 mm barrel.
    b.cyl(0.21, 0.24, 0.72, 12, GUNMETAL, { at: [0, 0.02, -0.78], rot: ALONG_Z });
    b.cyl(0.145, 0.165, 1.98, 12, STEEL, { at: [0, 0.02, -1.96], rot: ALONG_Z });
    b.cyl(0.18, 0.18, 0.12, 12, IRON, { at: [0, 0.02, -1.55], rot: ALONG_Z });
    b.cyl(0.17, 0.17, 0.12, 12, IRON, { at: [0, 0.02, -2.35], rot: ALONG_Z });
    // Sculpted dual-baffle muzzle brake.
    b.solid(prism([[-0.22, -0.14], [0.28, -0.14], [0.34, -0.06], [0.34, 0.08], [0.28, 0.16], [-0.22, 0.16]], 0.48, 0.03), OBSIDIAN, { at: [0, 0.02, -3.12], rot: ACROSS });
    for (const s of [-1, 1]) b.box(0.05, 0.18, 0.18, DARK, { at: [s * 0.23, 0.02, -3.12] });
  },
  muzzle: [0, 0.02, -3.42],
  follow: 20,
  return: 14,
};

/** The upgraded right arm: a chunky 105 mm siege howitzer with heavy recuperators, bore evacuator and dual-baffle muzzle brake. */
export const HOWITZER_ARM: GunSpec = {
  name: 'frame-howitzer',
  build: b => {
    // Reinforced siege breech housing (+u forward along -Z).
    b.solid(prism([[-1.28, -0.44], [0.64, -0.42], [0.92, -0.14], [0.88, 0.34], [0.42, 0.58], [-1.06, 0.58], [-1.34, 0.24]], 1.02, 0.06), OBSIDIAN, { rot: ACROSS });
    // Heavy sloped upper armour hood & breech-lock block.
    b.solid(prism([[-1.0, 0.5], [0.54, 0.5], [0.78, 0.34], [0.3, 0.7], [-0.88, 0.68]], 0.94, 0.04), PLATE, { rot: ACROSS });
    b.box(0.56, 0.24, 0.42, GUNMETAL, { at: [0, 0.42, 0.58] });
    // Oversized twin hydraulic recoil recuperator cylinders under & beside the cradle.
    for (const s of [-1, 1]) {
      b.cyl(0.135, 0.135, 1.48, 12, IRON, { at: [s * 0.36, -0.34, -0.82], rot: ALONG_Z });
      b.cyl(0.088, 0.088, 0.68, 10, STEEL, { at: [s * 0.36, -0.34, -1.62], rot: ALONG_Z });
      b.cyl(0.15, 0.15, 0.09, 12, BRASS, { at: [s * 0.36, -0.34, -1.42], rot: ALONG_Z });
    }
    // Lower cradle sled under the barrel.
    b.box(0.62, 0.18, 1.38, GUNMETAL, { at: [0, -0.32, -1.1] });
    // Armoured melee knuckle-ram strike blade retained along the outer forearm.
    b.solid(prism([[-0.35, -0.46], [1.0, -0.44], [1.34, -0.18], [1.1, 0.14], [-0.25, 0.2]], 0.24, 0.04), PLATE, { at: [0.62, -0.12, -0.52], rot: ACROSS });
    b.box(0.07, 0.36, 0.98, STEEL, { at: [0.74, -0.18, -0.86], rot: [0.1, 0, 0] });
    // Rear heavy elbow gimbal.
    b.cyl(0.35, 0.35, 0.66, 12, STEEL, { at: [0, 0.2, 1.06], rot: [0, 0, Math.PI / 2] });
    // Bureau siege amber/crimson status strips on the inboard face (visible from cockpit).
    b.glow(new THREE.BoxGeometry(0.04, 0.055, 0.82), AMBER, 4.4, { at: [-0.52, 0.28, -0.02] });
    b.glow(new THREE.BoxGeometry(0.04, 0.16, 0.06), RED, 4.0, { at: [-0.52, 0.06, -0.52] });
  },
  moving: b => {
    // Massive thick-walled 105 mm cannon barrel & thermal shroud.
    b.cyl(0.32, 0.36, 0.94, 14, GUNMETAL, { at: [0, 0.04, -0.92], rot: ALONG_Z });
    b.cyl(0.245, 0.275, 2.38, 14, STEEL, { at: [0, 0.04, -2.3], rot: ALONG_Z });
    // Prominent cylindrical bore evacuator mid-barrel + brass reinforcement bands.
    b.cyl(0.34, 0.34, 0.66, 14, PLATE, { at: [0, 0.04, -2.05], rot: ALONG_Z });
    b.cyl(0.35, 0.35, 0.06, 14, BRASS, { at: [0, 0.04, -1.72], rot: ALONG_Z });
    b.cyl(0.35, 0.35, 0.06, 14, BRASS, { at: [0, 0.04, -2.38], rot: ALONG_Z });
    // Dark recessed 105 mm muzzle bore.
    b.cyl(0.18, 0.18, 0.18, 12, DARK, { at: [0, 0.04, -3.86], rot: ALONG_Z });
    // Giant rectangular dual-baffle artillery muzzle brake.
    b.solid(prism([[-0.38, -0.26], [0.46, -0.26], [0.54, -0.14], [0.54, 0.18], [0.46, 0.3], [-0.38, 0.3]], 0.78, 0.04), OBSIDIAN, { at: [0, 0.04, -3.56], rot: ACROSS });
    for (const s of [-1, 1]) {
      b.box(0.08, 0.32, 0.24, DARK, { at: [s * 0.38, 0.04, -3.42] });
      b.box(0.08, 0.32, 0.24, DARK, { at: [s * 0.38, 0.04, -3.72] });
    }
  },
  muzzle: [0, 0.04, -3.96],
  follow: 14,
  return: 5.5,
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

/** Right-shoulder 6-tube lock-on missile pod built in local space so it can slump when knocked offline. */
function pod(b: ModelBuilder): void {
  b.cyl(0.12, 0.14, 0.55, 10, STEEL, { at: [-0.12, -0.52, 0.06], rot: [0, 0, -0.22] });
  b.solid(prism([[-0.72, -0.44], [0.68, -0.44], [0.76, -0.28], [0.76, 0.32], [0.58, 0.46], [-0.64, 0.46], [-0.76, 0.28]], 1.18, 0.05), OBSIDIAN, { rot: ACROSS });
  b.solid(prism([[-0.56, 0.38], [0.58, 0.38], [0.46, 0.54], [-0.48, 0.54]], 1.06, 0.03), PLATE, { rot: ACROSS });
  b.box(1.06, 0.72, 0.08, DARK, { at: [0, 0, -0.72] });
  for (let i = 0; i < 6; i++) {
    const tx = ((i % 3) - 1) * 0.31;
    const ty = i < 3 ? 0.18 : -0.18;
    b.cyl(0.115, 0.115, 0.12, 10, IRON, { at: [tx, ty, -0.75], rot: ALONG_Z });
    b.cyl(0.03, 0.075, 0.14, 8, PLATE, { at: [tx, ty, -0.78], rot: ALONG_Z });
    b.glow(new THREE.CylinderGeometry(0.028, 0.028, 0.03, 8), RED, 4.2, { at: [tx, ty, -0.85], rot: ALONG_Z });
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
}

/** The Frame's full procedural exterior & cockpit rig, posed every frame. */
export class StandIn {
  readonly cockpit: THREE.Group;
  readonly torso: THREE.Group;
  readonly legs = new THREE.Group();
  private readonly hull: THREE.Group;
  private readonly podGroup: THREE.Group;
  private readonly visorActive: THREE.Mesh;
  private readonly visorStandby: THREE.Mesh;
  private readonly jetCones: THREE.Mesh[] = [];
  private readonly cracks: THREE.LineSegments[] = [];
  private readonly sides: THREE.Group[] = [];
  private kneel = 0;
  private collapse = 0;
  private limpSide: -1 | 0 | 1 = 0;

  constructor(materials: ModelMaterials, scene: THREE.Scene) {
    const c = new ModelBuilder();
    cockpit(c);
    this.cockpit = materials.group(c, materials.nearby);
    this.cockpit.name = 'frame.cockpit';
    for (let i = 0; i < CRACK_SETS.length; i++) {
      const layer = makeCrackLayer(CRACK_SETS[i]!, 0.34 + i * 0.12);
      this.cockpit.add(layer);
      this.cracks.push(layer);
    }

    const h = new ModelBuilder();
    hull(h);
    this.hull = materials.group(h);

    const pd = new ModelBuilder();
    pod(pd);
    this.podGroup = materials.group(pd);
    this.podGroup.position.set(FRAME_PLACES.pod[0], FRAME_PLACES.pod[1], FRAME_PLACES.pod[2]);
    this.hull.add(this.podGroup);

    // Dual-state glowing canopy visor slit (crimson when active, warm amber when parked/empty).
    const visorGeo = new THREE.BoxGeometry(1.36, 0.11, 0.06);
    this.visorActive = new THREE.Mesh(visorGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(RED).multiplyScalar(4.2), toneMapped: false }));
    this.visorActive.position.set(0, 1.32, -2.24);
    this.visorActive.rotation.x = -0.14;
    this.hull.add(this.visorActive);

    this.visorStandby = new THREE.Mesh(visorGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(AMBER).multiplyScalar(3.4), toneMapped: false }));
    this.visorStandby.position.copy(this.visorActive.position);
    this.visorStandby.rotation.copy(this.visorActive.rotation);
    this.visorStandby.visible = false;
    this.hull.add(this.visorStandby);

    // Twin dynamic thruster flame cones under the back jet bells.
    const coneGeo = new THREE.ConeGeometry(0.28, 1.6, 10, 1, true);
    coneGeo.translate(0, -0.8, 0);
    const coneMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#ff8828').multiplyScalar(3.5), transparent: true, opacity: 0.85, side: THREE.DoubleSide, toneMapped: false,
    });
    for (const s of [-1, 1]) {
      const cone = new THREE.Mesh(coneGeo, coneMat);
      cone.position.set(s * 1.2, 0.5, 1.98);
      cone.rotation.set(0.22, 0, s * -0.1);
      cone.visible = false;
      this.hull.add(cone);
      this.jetCones.push(cone);
    }

    this.torso = new THREE.Group();
    this.torso.name = 'frame.torso';
    this.torso.add(this.hull);

    const hips = new ModelBuilder();
    pelvis(hips);
    this.legs.add(materials.group(hips));
    for (const s of [-1, 1]) {
      const b = new ModelBuilder();
      leg(b, s);
      const side = new THREE.Group();
      side.add(materials.group(b));
      side.position.set(s * 1.05, FRAME_PLACES.hips - 0.25, 0.2);
      this.legs.add(side);
      this.sides.push(side);
    }
    this.legs.name = 'frame.legs';
    for (const g of [this.cockpit, this.torso, this.legs]) {
      g.visible = false;
      scene.add(g);
    }
  }

  /** Sets non-stride mechanical poses: kneeling (0..1), collapse (0..1), canopy cracks (0..3), leg limp and pod damage. */
  setPoseState(kneel: number, collapse: number, cracks: number, limpSide: -1 | 0 | 1, podDown: boolean): void {
    this.kneel = clamp(kneel);
    this.collapse = clamp(collapse);
    this.limpSide = limpSide;
    this.setCracks(cracks);
    this.podGroup.rotation.set(podDown ? 0.36 : 0, 0, podDown ? -0.4 : 0);
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
    const parked = options?.parked === true;
    const jets = options?.jets === true;
    const standby = parked || this.kneel > 0.1 || this.collapse > 0.1;
    const effectiveSink = (parked ? sink - 0.42 : sink) - this.kneel * 1.35 - this.collapse * 1.9;
    const limpRoll = this.limpSide * 0.08 * (0.4 + 0.6 * Math.abs(Math.sin(stride * Math.PI)));

    this.legs.visible = this.torso.visible = true;
    this.legs.position.copy(feet);
    this.legs.rotation.y = legYaw;
    this.torso.position.set(feet.x + Math.cos(viewYaw) * sway, feet.y + FRAME_PLACES.hips + effectiveSink, feet.z - Math.sin(viewYaw) * sway);
    this.torso.rotation.set(
      (parked ? -0.1 : 0) + this.kneel * 0.22 + this.collapse * 0.42,
      viewYaw,
      limpRoll + this.collapse * 0.26,
      'YXZ',
    );
    this.place(FRAME_PLACES.eye, eye);

    this.hull.visible = !inside;
    this.cockpit.visible = inside;
    this.cockpit.position.copy(eye);
    this.cockpit.rotation.set(0, viewYaw, 0);

    this.visorActive.visible = !standby;
    this.visorStandby.visible = standby;
    for (let i = 0; i < this.jetCones.length; i++) {
      const cone = this.jetCones[i]!;
      cone.visible = jets && !inside;
      if (jets) cone.scale.set(1, 0.85 + Math.abs(Math.sin(stride * 13 + i * 2.1)) * 0.45, 1);
    }
    if (options?.cracks !== undefined) this.setCracks(options.cracks);

    const swing = 0.28 * clamp(walk);
    const crouchFlex = this.kneel * 0.32 + this.collapse * 0.48;
    for (let i = 0; i < 2; i++) {
      // Over two plants: planted and pushed back for one, lifted and carried forward for the next.
      const u = ((stride + i) % 2 + 2) % 2 / 2;
      const planted = u < 0.5;
      const k = planted ? u * 2 : (u - 0.5) * 2;
      const side = this.sides[i]!;
      const isLimping = (i === 0 ? -1 : 1) === this.limpSide;
      const strideRot = planted ? swing * (1 - 2 * k) : swing * (2 * k - 1);
      side.rotation.x = parked ? 0.08 : strideRot * (isLimping ? 0.55 : 1) + crouchFlex;
      side.position.y = FRAME_PLACES.hips - 0.25 + effectiveSink * 0.45 + (planted ? 0 : Math.sin(k * Math.PI) * 0.45 * clamp(walk * 2) * (isLimping ? 0.45 : 1));
    }
  }

  /** Reveal 0..3 progressive crack layers on the inner cockpit glass. */
  setCracks(stage: number): void {
    for (let i = 0; i < this.cracks.length; i++) this.cracks[i]!.visible = i < stage;
  }

  /** In torso space to the world, from the last `pose`. */
  place(local: readonly [number, number, number], out: THREE.Vector3): THREE.Vector3 {
    return out.set(local[0], local[1], local[2]).applyAxisAngle(_up, this.torso.rotation.y).add(this.torso.position);
  }

  hide(): void {
    this.cockpit.visible = this.torso.visible = this.legs.visible = false;
  }
}

const _up = new THREE.Vector3(0, 1, 0);
