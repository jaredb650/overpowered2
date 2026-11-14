/**
 * What the Frame looks like until stage 4 bakes its body: boxes, in the Bureau's black, grey and red.
 *
 *   The cockpit   a near-view model round the eye, turned with the view and never pitched: the canopy's struts frame the
 *                 edges of the screen, the sill and dash sit along the bottom, and the chin is open glass, so looking down
 *                 shows the feet. Built like the Packmule's cabin, in `materials.nearby`.
 *   The arms      the two guns are world objects (`Gun`), as the door gun is: their barrels swing, spin and recoil in
 *                 view at the bottom corners, and a tracer leaves a real muzzle.
 *   The body      hull, pod and reactor on the torso, which turns with the view; hips and two reverse-jointed legs, which
 *                 turn with the legs and swing with the stride. The hull is hidden from inside: the eye sits in it.
 *
 * Every place is in the torso's own space: x right, y up from the hips, -z ahead. `FRAME_PLACES` is what stage 4's body
 * has to keep, so the guns and the eye land where this one has them.
 */
import * as THREE from 'three';
import { clamp } from '../core/math';
import { ModelBuilder, type ModelMaterials } from '../progression/modelkit';
import type { GunSpec } from '../vehicles/guns';
import { FRAME } from './data';

const BLACK = '#17191c';
const PLATE = '#3b4047';
const DARK = '#0c0d0f';
const STEEL = '#565d66';
const RED = '#ff2a1a';
const AMBER = '#ffae3a';
const ALONG_Z: readonly [number, number, number] = [Math.PI / 2, 0, 0];

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

/** The left arm: a rotary cannon. Six barrels turn in the moving part. */
export const ROTARY_ARM: GunSpec = {
  name: 'frame-rotary',
  build: b => {
    b.box(0.72, 0.72, 1.5, BLACK, { at: [0, 0, 0.35] });
    b.box(0.78, 0.2, 1.1, PLATE, { at: [0, 0.42, 0.4] });
    b.box(0.34, 0.5, 0.9, PLATE, { at: [-0.5, -0.05, 0.45] });
    b.cyl(0.3, 0.3, 0.3, 14, STEEL, { at: [0, 0, -0.5], rot: ALONG_Z });
    b.glow(new THREE.BoxGeometry(0.04, 0.04, 0.5), RED, 4, { at: [0.38, 0.22, 0.2] });
  },
  moving: b => {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      b.cyl(0.05, 0.05, 1.9, 8, i % 2 ? DARK : STEEL, { at: [Math.cos(a) * 0.15, Math.sin(a) * 0.15, -1.55], rot: ALONG_Z });
    }
    for (const z of [-1.0, -1.9]) b.cyl(0.24, 0.24, 0.08, 14, PLATE, { at: [0, 0, z], rot: ALONG_Z });
    b.cyl(0.25, 0.25, 0.14, 14, BLACK, { at: [0, 0, -2.45], rot: ALONG_Z });
  },
  muzzle: [0, 0, -2.55],
  follow: 22,
  return: 22,
};

/** The right arm: the 40 mm on a slide. */
export const CANNON_ARM: GunSpec = {
  name: 'frame-cannon',
  build: b => {
    b.box(0.8, 0.8, 1.6, BLACK, { at: [0, 0, 0.3] });
    b.box(0.86, 0.22, 1.2, PLATE, { at: [0, 0.45, 0.35] });
    b.box(0.3, 0.55, 1.0, PLATE, { at: [0.52, -0.05, 0.4] });
    b.glow(new THREE.BoxGeometry(0.04, 0.04, 0.5), RED, 4, { at: [-0.42, 0.24, 0.2] });
  },
  moving: b => {
    b.cyl(0.13, 0.13, 2.7, 10, STEEL, { at: [0, 0, -1.75], rot: ALONG_Z });
    b.cyl(0.2, 0.2, 0.5, 10, BLACK, { at: [0, 0, -0.6], rot: ALONG_Z });
    b.box(0.42, 0.2, 0.36, BLACK, { at: [0, 0, -3.15] });
  },
  muzzle: [0, 0, -3.35],
  follow: 20,
  return: 14,
};

/**
 * The glass round the eye. Its origin is the eye. Thin struts at the screen's edges, two consoles low in the corners, and open
 * glass between them, so looking down shows the ground at the feet: the stomp is aimed through it.
 */
function cockpit(b: ModelBuilder): void {
  for (const s of [1, -1]) {
    // A pillar either side, raked back, and the side wall behind it.
    b.box(0.06, 1.25, 0.08, BLACK, { at: [s * 1.04, 0.02, -0.74], rot: [0.12, 0, s * 0.1] });
    b.box(0.06, 1.1, 1.2, PLATE, { at: [s * 1.14, 0, 0] });
    // The consoles, with their lamps.
    b.box(0.5, 0.3, 0.5, BLACK, { at: [s * 0.86, -0.78, -0.45], rot: [0.35, 0, 0] });
    for (let i = 0; i < 3; i++) b.glow(new THREE.BoxGeometry(0.05, 0.02, 0.02), i === 1 ? RED : AMBER, 3, { at: [s * (0.74 + i * 0.1), -0.6, -0.62] });
  }
  // The bar across the top of the glass and the roof behind it.
  b.box(2.1, 0.05, 0.08, BLACK, { at: [0, 0.64, -0.8] });
  b.box(2.2, 0.05, 1.1, DARK, { at: [0, 0.72, -0.25] });
  // The sill, and two rails down across the chin glass.
  b.box(2.1, 0.05, 0.08, BLACK, { at: [0, -0.55, -0.84] });
  for (const s of [1, -1]) b.box(0.04, 0.04, 0.9, DARK, { at: [s * 0.5, -1.0, -0.62], rot: [0.5, 0, 0] });
}

/** The torso seen from outside, hips at the origin. */
function hull(b: ModelBuilder): void {
  b.box(3.2, 2.0, 2.6, BLACK, { at: [0, 1.15, 0.6] });
  b.box(3.3, 0.25, 2.4, PLATE, { at: [0, 2.2, 0.6] });
  b.box(1.8, 1.4, 1.3, PLATE, { at: [0, 1.25, -1.15] });
  b.glow(new THREE.BoxGeometry(1.3, 0.07, 0.04), RED, 5, { at: [0, 1.42, -1.81] });
  // Shoulders, the pod and the reactor's slats on the back.
  for (const s of [1, -1]) b.box(1.0, 0.9, 1.3, PLATE, { at: [s * 1.95, 1.55, 0.35] });
  b.box(1.1, 0.75, 1.3, BLACK, { at: [FRAME_PLACES.pod[0], FRAME_PLACES.pod[1], FRAME_PLACES.pod[2]] });
  for (let i = 0; i < 6; i++) b.cyl(0.11, 0.11, 0.06, 8, DARK, { at: [1.27 + (i % 3) * 0.28, 2.35 + (i < 3 ? 0.18 : -0.18), -0.46], rot: ALONG_Z });
  for (let i = 0; i < 5; i++) b.box(2.2, 0.08, 0.5, i % 2 ? DARK : PLATE, { at: [0, 0.5 + i * 0.32, 2.0], rot: [0.3, 0, 0] });
  for (const s of [1, -1]) b.glow(new THREE.BoxGeometry(0.08, 0.08, 0.08), RED, 5, { at: [s * 1.6, 2.15, -0.7] });
}

/** One leg from the hip down, the hip at the origin: thigh forward to the knee, shin back to the ankle, the foot under. */
function leg(b: ModelBuilder, s: number): void {
  b.box(0.7, 1.6, 0.7, PLATE, { at: [s * 0.05, -0.62, -0.45], rot: [-0.62, 0, 0] });
  b.box(0.5, 1.8, 0.5, BLACK, { at: [0, -2.0, -0.05], rot: [0.75, 0, 0] });
  b.box(0.4, 0.95, 0.4, STEEL, { at: [0, -3.1, 0.3], rot: [-0.3, 0, 0] });
  b.box(0.95, 0.3, 1.9, BLACK, { at: [0, -3.6, 0.05] });
  b.box(0.75, 0.12, 0.5, PLATE, { at: [0, -3.42, -0.75] });
}

/** The Frame's stand-in, posed every frame. */
export class StandIn {
  readonly cockpit: THREE.Group;
  readonly torso: THREE.Group;
  readonly legs = new THREE.Group();
  private readonly hull: THREE.Group;
  private readonly sides: THREE.Group[] = [];

  constructor(materials: ModelMaterials, scene: THREE.Scene) {
    const c = new ModelBuilder();
    cockpit(c);
    this.cockpit = materials.group(c, materials.nearby);
    this.cockpit.name = 'frame.cockpit';
    const h = new ModelBuilder();
    hull(h);
    this.hull = materials.group(h);
    this.torso = new THREE.Group();
    this.torso.name = 'frame.torso';
    this.torso.add(this.hull);
    const hips = new ModelBuilder();
    hips.box(2.3, 0.8, 1.5, PLATE, { at: [0, FRAME_PLACES.hips - 0.2, 0.25] });
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

  /**
   * `stride` is in plants: the left foot is down on even ones, the right on odd. `walk` is 0..1 of a full walk, which sets
   * how far the legs swing. `sink` lowers the hull on its legs and `sway` moves it along its right, the eye with it.
   * `inside` hides the hull round the eye and shows the cockpit. Writes the eye into `eye`.
   */
  pose(feet: THREE.Vector3, legYaw: number, viewYaw: number, stride: number, walk: number, sink: number, sway: number, inside: boolean, eye: THREE.Vector3): void {
    this.legs.visible = this.torso.visible = true;
    this.legs.position.copy(feet);
    this.legs.rotation.y = legYaw;
    this.torso.position.set(feet.x + Math.cos(viewYaw) * sway, feet.y + FRAME_PLACES.hips + sink, feet.z - Math.sin(viewYaw) * sway);
    this.torso.rotation.y = viewYaw;
    this.place(FRAME_PLACES.eye, eye);
    this.hull.visible = !inside;
    this.cockpit.visible = inside;
    this.cockpit.position.copy(eye);
    this.cockpit.rotation.set(0, viewYaw, 0);
    const swing = 0.26 * clamp(walk);
    for (let i = 0; i < 2; i++) {
      // Over two plants: planted and pushed back for one, lifted and carried forward for the next.
      const u = ((stride + i) % 2 + 2) % 2 / 2;
      const planted = u < 0.5;
      const k = planted ? u * 2 : (u - 0.5) * 2;
      const side = this.sides[i]!;
      side.rotation.x = planted ? swing * (1 - 2 * k) : swing * (2 * k - 1);
      side.position.y = FRAME_PLACES.hips - 0.25 + sink * 0.5 + (planted ? 0 : Math.sin(k * Math.PI) * 0.45 * clamp(walk * 2));
    }
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
