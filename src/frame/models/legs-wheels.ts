/**
 * Drift-Wheel Rig 3D model (`legsWheels`):
 * Brutal 4-wheel outrigger battle-sled chassis:
 * - 2 massive steerable front armoured combat wheels (`r = 0.92`) on articulated steering knuckles,
 * - 2 oversized wide rear drive wheels (`r = 1.12`) on heavy hydraulic swing-arms,
 * - Coiled suspension springs, curved mudguard fenders, steel hub axles, and twin rear drift skates.
 * Wheels visibly spin proportional to ground speed and front wheels steer live into turns!
 */
import * as THREE from 'three';
import { clamp, lerp, TAU } from '../../core/math';
import { ModelBuilder, type ModelMaterials } from '../../progression/modelkit';
import {
  ACROSS, AMBER, BRASS, DARK, FLAT, GUNMETAL, IRON, OBSIDIAN, PLATE, RED, STEEL,
  frameBuilder, ngon, prism, type FramePalette, type LegsVisual,
} from './shared';

const FRONT_R = 0.92;
const FRONT_W = 0.62;
const FRONT_X = 1.66;
const FRONT_Z = -1.58;

const REAR_R = 1.12;
const REAR_W = 0.92;
const REAR_X = 1.84;
const REAR_Z = 1.42;

function buildWheelMesh(b: ModelBuilder, radius: number, width: number, lugs: number): void {
  // Chunky armoured rubber-composite tire carcass.
  b.cyl(radius, radius, width, 16, DARK, { rot: [0, 0, Math.PI / 2] });
  // Recessed inner armoured steel dish rim.
  b.cyl(radius * 0.62, radius * 0.62, width + 0.04, 12, GUNMETAL, { rot: [0, 0, Math.PI / 2] });
  b.cyl(radius * 0.44, radius * 0.44, width + 0.09, 10, PLATE, { rot: [0, 0, Math.PI / 2] });
  // Brass heavy torque hub cap & axle bolt.
  b.cyl(radius * 0.24, radius * 0.24, width + 0.15, 8, BRASS, { rot: [0, 0, Math.PI / 2] });
  b.cyl(radius * 0.12, radius * 0.12, width + 0.2, 8, STEEL, { rot: [0, 0, Math.PI / 2] });

  // Heavy radial combat chevron tread lugs around the tire circumference so spin reads crisply!
  for (let i = 0; i < lugs; i++) {
    const a = (i / lugs) * TAU;
    const cy = Math.cos(a) * (radius + 0.02);
    const cz = Math.sin(a) * (radius + 0.02);
    b.box(width * 0.86, 0.08, 0.18, IRON, { at: [0, cy, cz], rot: [a, 0, 0] });
    // Spoken rim bolt accents every 2 lugs.
    if (i % 2 === 0) {
      b.box(width + 0.11, 0.11, radius * 0.34, STEEL, {
        at: [0, Math.cos(a) * radius * 0.44, Math.sin(a) * radius * 0.44],
        rot: [a, 0, 0],
      });
    }
  }
  // Thin glowing rotor-brake indicator pips on the outer rim so high-speed spin pops visually.
  b.glow(new THREE.BoxGeometry(width + 0.12, 0.07, 0.22), AMBER, 3.6, { at: [0, radius * 0.54, 0] });
  b.glow(new THREE.BoxGeometry(width + 0.12, 0.07, 0.22), RED, 3.6, { at: [0, -radius * 0.54, 0] });
}

function buildCoilSpring(
  b: ModelBuilder,
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  coils: number,
): void {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  const len = Math.hypot(dx, dy, dz);
  const mx = (from[0] + to[0]) * 0.5;
  const my = (from[1] + to[1]) * 0.5;
  const mz = (from[2] + to[2]) * 0.5;

  // Compute orientation aligning cylinder Y axis along (dx, dy, dz).
  const dir = new THREE.Vector3(dx, dy, dz).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  const e = new THREE.Euler().setFromQuaternion(q);
  const rot: [number, number, number] = [e.x, e.y, e.z];

  // Central telescoping steel hydraulic damper piston.
  b.cyl(0.055, 0.055, len, 8, STEEL, { at: [mx, my, mz], rot });
  // Stacked coiled suspension spring rings along the mid 60% of the damper.
  for (let c = 0; c < coils; c++) {
    const f = 0.22 + (c / Math.max(1, coils - 1)) * 0.56;
    b.solid(prism(ngon(0.14, 8, Math.PI / 8), 0.045, 0.012), BRASS, {
      at: [from[0] + dx * f, from[1] + dy * f, from[2] + dz * f],
      rot: [e.x - Math.PI / 2, e.y, e.z],
    });
  }
}

function buildRigChassis(b: ModelBuilder, hipsY: number): void {
  // Heavy waist turret bearing ring flush with the torso belly.
  b.solid(prism(ngon(1.14, 8, Math.PI / 8), 0.28, 0.04), STEEL, { at: [0, hipsY, 0.12], rot: FLAT });
  b.cyl(1.2, 1.28, 0.14, 14, BRASS, { at: [0, hipsY - 0.16, 0.12] });

  // Forward-sloped low-slung battle-sled pedestal & central armoured spine tub.
  b.solid(prism([
    [-1.68, 1.44], [1.46, 1.44], [1.14, hipsY - 0.24], [-1.22, hipsY - 0.24],
  ], 1.88, 0.06), OBSIDIAN, { at: [0, 0, 0.12], rot: ACROSS });
  b.solid(prism([
    [-2.08, 0.72], [1.98, 0.64], [2.44, 1.12], [2.04, 1.56], [-1.72, 1.66], [-2.36, 1.24],
  ], 1.78, 0.065), GUNMETAL, { at: [0, 0, 0.0], rot: ACROSS });
  // Sloped front nose armour wedge + heavy steel ram-bumper cage.
  b.solid(prism([
    [1.36, 1.38], [2.46, 1.14], [2.16, 1.62], [1.38, 1.72],
  ], 1.52, 0.04), PLATE, { at: [0, 0, 0.0], rot: ACROSS });
  b.cyl(0.085, 0.085, 2.08, 10, STEEL, { at: [0, 0.96, -2.52], rot: [0, 0, Math.PI / 2] });
  for (const s of [-1, 1]) {
    b.cyl(0.08, 0.08, 0.64, 8, IRON, { at: [s * 0.78, 0.96, -2.26], rot: [Math.PI / 2, 0, 0] });
    // Twin bright amber rally headlights tucked inside front bumper.
    b.box(0.28, 0.15, 0.16, IRON, { at: [s * 0.62, 1.48, -2.18] });
    b.glow(new THREE.BoxGeometry(0.22, 0.08, 0.04), AMBER, 4.4, { at: [s * 0.62, 1.48, -2.27] });
  }

  // Twin slanted rear drift-booster exhaust pipes & spark-skid stabilizer tail skates.
  for (const s of [-1, 1]) {
    b.cyl(0.16, 0.22, 0.88, 10, IRON, { at: [s * 0.68, 1.54, 2.38], rot: [-0.45, 0, s * -0.14] });
    b.glow(new THREE.CylinderGeometry(0.13, 0.16, 0.06, 10), RED, 4.2, { at: [s * 0.74, 1.72, 2.74], rot: [-0.45, 0, s * -0.14] });
    // Rear stabilizer drift skate strut.
    b.solid(prism([
      [-0.58, 0.0], [0.24, 0.0], [0.34, 0.18], [-0.44, 0.22],
    ], 0.18, 0.02), STEEL, { at: [s * 0.84, 0.18, 2.48], rot: ACROSS });
  }

  // Hydraulic outrigger swing-arms, steel hub axles, coiled suspension springs & arched mudguard fenders!
  for (const s of [-1, 1]) {
    // Front outrigger wishbone swing-arm + steering knuckle yoke.
    b.solid(prism([
      [-0.22, -0.14], [0.22, -0.14], [0.26, 0.14], [-0.26, 0.14],
    ], 0.92, 0.025), STEEL, { at: [s * 1.12, FRONT_R, FRONT_Z], rot: [0, Math.PI / 2, 0] });
    b.cyl(0.13, 0.13, 1.06, 10, IRON, { at: [s * 1.18, FRONT_R, FRONT_Z], rot: [0, 0, Math.PI / 2] });
    // Front coiled suspension spring strut (upper chassis -> front hub arm).
    buildCoilSpring(b, [s * 0.88, 1.98, FRONT_Z + 0.18], [s * 1.38, FRONT_R + 0.24, FRONT_Z], 5);

    // Rear heavy trailing swing-arm + reinforced drive axle housing.
    b.solid(prism([
      [-0.42, -0.18], [0.56, -0.14], [0.56, 0.22], [-0.42, 0.22],
    ], 1.16, 0.035), OBSIDIAN, { at: [s * 1.16, REAR_R, REAR_Z - 0.12], rot: [0, Math.PI / 2, 0] });
    b.cyl(0.18, 0.18, 1.34, 12, STEEL, { at: [s * 1.24, REAR_R, REAR_Z], rot: [0, 0, Math.PI / 2] });
    // Rear heavy coiled suspension spring strut (upper pedestal -> rear axle).
    buildCoilSpring(b, [s * 0.96, 2.38, REAR_Z - 0.28], [s * 1.48, REAR_R + 0.34, REAR_Z], 6);

    // Arched armoured rear mudguard fender curving cleanly over the massive rear wheel.
    b.solid(prism([
      [-1.32, 1.56], [-0.88, 2.18], [0.0, 2.42], [0.88, 2.18], [1.28, 1.62],
      [1.14, 1.52], [0.76, 2.02], [0.0, 2.24], [-0.76, 2.02], [-1.18, 1.48],
    ], REAR_W + 0.16, 0.035), PLATE, { at: [s * REAR_X, 0, REAR_Z], rot: ACROSS });
    b.glow(new THREE.BoxGeometry(0.05, 0.06, 0.62), RED, 3.8, { at: [s * (REAR_X + REAR_W * 0.56), 2.18, REAR_Z + 0.72] });
  }
}

export function buildWheelLegs(materials: ModelMaterials, hipsY: number, palette?: FramePalette): LegsVisual {
  const group = new THREE.Group();
  group.name = 'frame.legs.wheels';

  const chassisGroup = new THREE.Group();
  const cb = frameBuilder(palette);
  buildRigChassis(cb, hipsY);
  chassisGroup.add(materials.group(cb));
  group.add(chassisGroup);

  const frontSteerGroups: THREE.Group[] = [];
  const frontSpinGroups: THREE.Group[] = [];
  const rearSpinGroups: THREE.Group[] = [];

  // 2 Steerable Front Armoured Combat Wheels (with attached front mudguard fender on steering knuckle!).
  for (const s of [-1, 1]) {
    const steer = new THREE.Group();
    steer.position.set(s * FRONT_X, FRONT_R, FRONT_Z);

    // Knuckle-mounted curved front fender so the mudguard steers smoothly with the front wheel.
    const fb = frameBuilder(palette);
    fb.solid(prism([
      [-0.96, 0.42], [-0.62, 0.98], [0.0, 1.14], [0.64, 0.98], [0.96, 0.46],
      [0.84, 0.36], [0.54, 0.86], [0.0, 1.0], [-0.54, 0.86], [-0.84, 0.34],
    ], FRONT_W + 0.14, 0.03), OBSIDIAN, { rot: ACROSS });
    steer.add(materials.group(fb));

    const spin = new THREE.Group();
    const wb = frameBuilder(palette);
    buildWheelMesh(wb, FRONT_R, FRONT_W, 10);
    spin.add(materials.group(wb));
    steer.add(spin);

    chassisGroup.add(steer);
    frontSteerGroups.push(steer);
    frontSpinGroups.push(spin);
  }

  // 2 Oversized Wide Rear Drive Wheels.
  for (const s of [-1, 1]) {
    const spin = new THREE.Group();
    spin.position.set(s * REAR_X, REAR_R, REAR_Z);
    const wb = frameBuilder(palette);
    buildWheelMesh(wb, REAR_R, REAR_W, 12);
    spin.add(materials.group(wb));

    chassisGroup.add(spin);
    rearSpinGroups.push(spin);
  }

  let frontAngle = 0;
  let rearAngle = 0;
  let steerAngle = 0;

  return {
    group,
    pose(stride, walk, effectiveSink, kneel, collapse, limpSide, parked, jetMode, extra): void {
      const dt = Math.max(0, extra?.dt ?? 1 / 60);
      const w = clamp(walk);
      const speed = extra?.speed ?? w * 11;
      const turnRate = extra?.turnRate ?? 0;

      // Subtle suspension compression on sink/kneel/collapse.
      const sinkY = clamp(effectiveSink * 0.4, -0.55, 0.35);
      chassisGroup.position.y = sinkY - kneel * 0.18 - collapse * 0.28;
      chassisGroup.rotation.set(
        (jetMode ? -0.22 : -clamp(speed / 16) * 0.06) + collapse * 0.16,
        0,
        clamp(-turnRate * 0.08, -0.18, 0.18) + limpSide * 0.06 + collapse * 0.12,
      );

      // Advance wheel spin smoothly proportional to ground speed (fallback to stride delta when speed is 0).
      const travel = parked ? 0 : (speed > 0.05 ? speed * dt : 0);
      if (travel > 0) {
        frontAngle = (frontAngle - travel / FRONT_R) % TAU;
        rearAngle = (rearAngle - travel / REAR_R) % TAU;
      } else if (!parked && w > 0.01) {
        frontAngle = -stride * 2.4;
        rearAngle = -stride * 1.95;
      }

      // Smooth front wheel steering angle into turns.
      const targetSteer = parked || jetMode ? 0 : clamp(turnRate * 0.32, -0.48, 0.48);
      steerAngle = lerp(steerAngle, targetSteer, 1 - Math.exp(-12 * dt));

      for (let i = 0; i < frontSpinGroups.length; i++) {
        frontSteerGroups[i]!.rotation.y = steerAngle;
        frontSpinGroups[i]!.rotation.x = frontAngle;
      }
      for (let i = 0; i < rearSpinGroups.length; i++) {
        rearSpinGroups[i]!.rotation.x = rearAngle;
      }
    },
  };
}
