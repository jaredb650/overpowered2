/**
 * The movement test course: one layout shared by the browser sandbox and the headless tests, so a number
 * measured in Node describes the same geometry the screenshot shows.
 *
 * Lanes run along -Z and are spaced along +X. Every lane starts at z = 0 unless noted.
 */
import * as THREE from 'three';
import type { PhysicsSystem, SurfaceKind, WorldMaterialName } from '../../core/contracts';

export interface CourseBox {
  center: [number, number, number];
  half: [number, number, number];
  /** Rotation about X in degrees, for ramps. */
  tiltX?: number;
  /** Rotation about Y in degrees. */
  yaw?: number;
  /** Rotation about Z in degrees, for walls leaning off vertical. */
  tiltZ?: number;
  material: WorldMaterialName;
  surface?: SurfaceKind;
  /** Drawn but not collided with: lane markings. */
  decor?: boolean;
}

export interface CourseMesh {
  vertices: Float32Array;
  indices: Uint32Array;
  material: WorldMaterialName;
}

export interface JumpPad {
  center: THREE.Vector3;
  radius: number;
  velocity: THREE.Vector3;
}

export interface CourseSign {
  text: string;
  position: [number, number, number];
}

const FLOOR: WorldMaterialName = 'asphalt';
const WALL: WorldMaterialName = 'concrete';
const WALL2: WorldMaterialName = 'concreteDark';
const RAMP: WorldMaterialName = 'steel';
const STEP: WorldMaterialName = 'panel';
const LEDGE: WorldMaterialName = 'steelDark';
const ACCENT: WorldMaterialName = 'emissiveCyan';
const PAD: WorldMaterialName = 'emissiveOrange';
const CEIL: WorldMaterialName = 'rust';

export const LANES = {
  strafe: 0,
  wall: 60,
  ramp: 120,
  stairs: 180,
  gaps: 240,
  mantle: 300,
  pad: 360,
  low: 420,
  corner: 480,
  curbs: 540,
  round: 600,
  brush: 660,
} as const;

/** Top of a ramp box tilted about X. Helper for placing flats after ramps. */
function ramp(x: number, zStart: number, length: number, degrees: number, width = 7, y0 = 0): { box: CourseBox; topZ: number; topY: number } {
  const rad = (degrees * Math.PI) / 180;
  const thick = 0.5;
  const dz = Math.cos(rad) * length;
  const dy = Math.sin(rad) * length;
  // The box's top face runs from (zStart, y0) to (zStart - dz, y0 + dy). Its centre sits half a thickness below it.
  const cy = y0 + dy / 2 - Math.cos(rad) * thick;
  const cz = zStart - dz / 2 - Math.sin(rad) * thick;
  return {
    box: { center: [x, cy, cz], half: [width, thick, length / 2], tiltX: degrees, material: RAMP },
    topZ: zStart - dz,
    topY: y0 + dy,
  };
}

export function buildCourse(): { boxes: CourseBox[]; meshes: CourseMesh[]; pads: JumpPad[]; signs: CourseSign[] } {
  const boxes: CourseBox[] = [];
  const meshes: CourseMesh[] = [];
  const pads: JumpPad[] = [];
  const signs: CourseSign[] = [];
  const add = (center: CourseBox['center'], half: CourseBox['half'], material: WorldMaterialName, extra?: Partial<CourseBox>) =>
    boxes.push({ center, half, material, ...extra });

  // Tiled like the real map's floor, so seams get crossed at speed on every run.
  for (let x = -450; x <= 1050; x += 100) {
    for (let z = -1750; z <= 750; z += 100) add([x, -0.5, z], [50, 0.5, 50], FLOOR);
  }

  // Strafe: an open straight. Cross strips every 10 m make speed readable at a glance.
  for (let z = 0; z >= -1500; z -= 10) {
    add([LANES.strafe, 0.012, z], [z % 50 === 0 ? 24 : 12, 0.012, 0.08], ACCENT, { decor: true });
  }
  signs.push({ text: 'STRAFE', position: [LANES.strafe, 5, -8] });

  // Wall lane: two long walls 9 m apart, then a lone leaning wall.
  {
    const x = LANES.wall;
    add([x - 4.75, 5, -160], [0.25, 5, 140], WALL);
    add([x + 4.75, 5, -160], [0.25, 5, 140], WALL2);
    add([x + 16, 5, -80], [0.25, 5, 60], WALL, { tiltZ: 8 });
    signs.push({ text: 'WALLS', position: [x, 6, -8] });
  }

  // Ramps: a slide hill with a shallow run-up, a steep unwalkable face, and a launch ramp into open air.
  {
    const x = LANES.ramp;
    const up = ramp(x, -10, 40, 20);
    boxes.push(up.box);
    add([x, up.topY / 2 - 0.25, up.topZ - 15], [7, up.topY / 2 + 0.25, 15], STEP);
    const flatEnd = up.topZ - 30;
    const down = ramp(x, flatEnd, 40, -20, 7, up.topY);
    boxes.push(down.box);
    // Launch ramp
    const launch = ramp(x + 20, -10, 22, 28, 6);
    boxes.push(launch.box);
    // Unwalkable slope
    const steep = ramp(x - 20, -10, 14, 62, 6);
    boxes.push(steep.box);
    signs.push({ text: 'RAMPS', position: [x, 6, -8] });
  }

  // Stairs: risers of 0.25 m, a landing, then back down.
  {
    const x = LANES.stairs;
    const riser = 0.25;
    const tread = 0.5;
    const n = 20;
    let z = -6;
    for (let i = 0; i < n; i++) {
      const top = (i + 1) * riser;
      add([x, top / 2, z - tread / 2], [6, top / 2, tread / 2], i % 2 ? STEP : WALL2);
      z -= tread;
    }
    const top = n * riser;
    add([x, top / 2, z - 10], [6, top / 2, 10], STEP);
    z -= 20;
    for (let i = n - 1; i >= 0; i--) {
      const stepTop = i * riser;
      if (stepTop <= 0) break;
      add([x, stepTop / 2, z - tread / 2], [6, stepTop / 2, tread / 2], i % 2 ? STEP : WALL2);
      z -= tread;
    }
    signs.push({ text: 'STAIRS', position: [x, 6, -8] });
  }

  // Gaps: 4 m high platforms with growing gaps.
  {
    const x = LANES.gaps;
    const h = 2;
    let z = -8;
    add([x, h, z - 15], [6, h, 15], LEDGE);
    z -= 30;
    for (const gap of [6, 10, 14, 18]) {
      z -= gap;
      add([x, h, z - 12], [6, h, 12], LEDGE);
      z -= 24;
    }
    signs.push({ text: 'GAPS', position: [x, 6, -8] });
  }

  // Mantle: blocks of rising height, spaced along the lane, wide enough to be hit square.
  {
    const x = LANES.mantle;
    let z = -14;
    for (const height of [0.8, 1.2, 1.6, 2.0, 2.4, 2.8, 3.2, 4.0]) {
      add([x, height / 2, z - 3], [7, height / 2, 3], LEDGE);
      z -= 26;
    }
    signs.push({ text: 'MANTLE', position: [x, 6, -8] });
  }

  // Jump pad: throws the player up and forward onto a 16 m platform.
  {
    const x = LANES.pad;
    add([x, 0.1, -20], [3, 0.1, 3], PAD);
    pads.push({ center: new THREE.Vector3(x, 0.2, -20), radius: 3, velocity: new THREE.Vector3(0, 32, -14) });
    add([x, 8, -70], [12, 8, 10], LEDGE);
    signs.push({ text: 'PAD', position: [x, 6, -8] });
  }

  // Low: a 1.3 m crawl tunnel, then a 2.6 m hall with a ceiling to bang into.
  {
    const x = LANES.low;
    add([x, 1.3 + 0.5, -40], [7, 0.5, 20], CEIL);
    add([x - 7.5, 1, -40], [0.5, 1, 20], WALL);
    add([x + 7.5, 1, -40], [0.5, 1, 20], WALL);
    add([x, 2.6 + 0.5, -100], [7, 0.5, 25], CEIL);
    signs.push({ text: 'LOW', position: [x, 6, -8] });
  }

  // Corner: an L of tall walls, then a 135 degree bend, for wall runs that end in a corner.
  {
    const x = LANES.corner;
    add([x - 6, 6, -40], [0.25, 6, 40], WALL);
    add([x + 14, 6, -80], [20, 6, 0.25], WALL2);
    add([x + 20, 6, -20], [0.25, 6, 20], WALL);
    add([x + 28, 6, -46], [0.25, 6, 11], WALL2, { yaw: 45 });
    signs.push({ text: 'CORNERS', position: [x, 6, -8] });
  }

  // Curbs: strips of height 0.1 to 0.4 across the lane, for snag tests at speed.
  {
    const x = LANES.curbs;
    let z = -20;
    for (const height of [0.08, 0.15, 0.25, 0.35, 0.44]) {
      add([x, height / 2, z - 10], [7, height / 2, 10], STEP);
      z -= 40;
    }
    signs.push({ text: 'CURBS', position: [x, 6, -8] });
  }

  // Round: a 24-sided column, the curved case for wall running. A mesh, so trimesh collision gets exercised.
  {
    const x = LANES.round;
    const sides = 24;
    const r = 18;
    const h = 14;
    const vertices = new Float32Array((sides * 2 + 2) * 3);
    const indices: number[] = [];
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      const px = x + Math.cos(a) * r;
      const pz = -60 + Math.sin(a) * r;
      vertices.set([px, 0, pz], i * 6);
      vertices.set([px, h, pz], i * 6 + 3);
      const j = (i + 1) % sides;
      indices.push(i * 2, i * 2 + 1, j * 2, j * 2, i * 2 + 1, j * 2 + 1);
    }
    const top = sides * 2;
    vertices.set([x, h, -60], top * 3);
    for (let i = 0; i < sides; i++) indices.push(top, ((i + 1) % sides) * 2 + 1, i * 2 + 1);
    meshes.push({ vertices, indices: new Uint32Array(indices), material: RAMP });
    signs.push({ text: 'ROUND', position: [x, 6, -8] });
  }

  // Brush: what a shoot house is made of. Door jambs to clip, a chest-high crate to run into, a long wall to hug.
  {
    const x = LANES.brush;
    for (let z = -20; z >= -60; z -= 10) add([x - 2.5, 1.5, z], [0.5, 1.5, 0.5], WALL);
    add([x + 12, 0.6, -30], [4, 0.6, 1], LEDGE);
    add([x - 12, 2, -60], [0.25, 2, 60], WALL2);
    // A shoot-house corridor, 5 m wide.
    add([x + 30 - 2.75, 3, -70], [0.25, 3, 70], WALL);
    add([x + 30 + 2.75, 3, -70], [0.25, 3, 70], WALL2);
    signs.push({ text: 'BRUSH', position: [x, 6, -8] });
  }

  return { boxes, meshes, pads, signs };
}

const _euler = new THREE.Euler();
const _quat = new THREE.Quaternion();

export function boxRotation(box: CourseBox, out = _quat): THREE.Quaternion | null {
  if (!box.tiltX && !box.yaw && !box.tiltZ) return null;
  const d = Math.PI / 180;
  _euler.set((box.tiltX ?? 0) * d, (box.yaw ?? 0) * d, (box.tiltZ ?? 0) * d, 'YXZ');
  return out.setFromEuler(_euler);
}

/** Adds the course to physics. Call flushQueries afterwards. */
export function addCourseToPhysics(physics: PhysicsSystem, course: ReturnType<typeof buildCourse>): void {
  const c = new THREE.Vector3();
  const h = new THREE.Vector3();
  for (const box of course.boxes) {
    if (box.decor) continue;
    c.set(...box.center);
    h.set(...box.half);
    physics.addStaticBox(c, h, boxRotation(box, new THREE.Quaternion()), box.surface ?? 'concrete');
  }
  for (const mesh of course.meshes) physics.addStaticMesh(mesh.vertices, mesh.indices, 'metal');
}
