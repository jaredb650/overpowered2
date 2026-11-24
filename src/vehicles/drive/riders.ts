/**
 * Articulated visible player/occupant character models mounted on open & multi-seat vehicles.
 *
 * Built to support full co-op multi-seat visibility right out of the box (e.g. 0, 1, or 2 riders
 * visibly seated on the Quad ATV, Combat Moto, Viper Hover-Skiff, Jackal Technical, or Valkyrie
 * Chopper, plus cockpit pilots inside the Harrier, Warthog, and Kestrel).
 *
 * Conventions: +Z forward, +Y up, +X left (matching drive/models.ts).
 */
import * as THREE from 'three';
import type { ModelMaterials } from '../../progression/modelkit';
import { clamp } from '../../core/math';
import { VehicleBuilder } from './textures';

export type RiderPosture = 'straddle' | 'pillion' | 'seated' | 'gunner' | 'cockpit';

export interface RiderSocketSpec {
  /** Zero-based seat index in `DriveVehicleDef.seats`. */
  readonly seatIndex: number;
  /** Parent Object3D to attach to (`body` or `turret` so roof gunners rotate with the gun!). */
  readonly parent: THREE.Object3D;
  /** Seat anchor in `parent` local space (pelvis / saddle contact point). */
  readonly at: readonly [number, number, number];
  readonly posture: RiderPosture;
  /** Optional uniform scale tweak (e.g. 0.92 for tight fighter cockpits). */
  readonly scale?: number;
  /** Optional base Y yaw offset (e.g. Math.PI / 2 for side door gunner). */
  readonly yawOffset?: number;
}

export interface RiderRig {
  readonly seatIndex: number;
  readonly posture: RiderPosture;
  readonly root: THREE.Group;
  readonly torso: THREE.Group;
  readonly head: THREE.Group;
  readonly accentMeshes: THREE.Mesh[];
  occupantId: string | null;
}

const SUIT_DARK = '#252b32';
const ARMOR_PLATE = '#39424d';
const ARMOR_TRIM = '#525f6e';
const HELMET = '#2f3740';
const BOOT = '#191d22';
const GLOVE = '#1f242a';
const GUN_STEEL = '#2b3138';

/** Default operator accent colors by co-op slot (Slot 0 local player = tactical cyan, Slot 1 = amber, etc.). */
export const RIDER_ACCENTS: readonly string[] = ['#38e8ff', '#ffaa2b', '#52ff88', '#ff5478'];

function buildTorsoAndArms(
  materials: ModelMaterials,
  posture: RiderPosture,
  accentHex: string,
): { torso: THREE.Group; head: THREE.Group; accentMeshes: THREE.Mesh[] } {
  const torso = new THREE.Group();
  const accentMeshes: THREE.Mesh[] = [];

  const b = new VehicleBuilder();
  // Armored tactical chest rig & ballistic backplate
  b.box(0.4, 0.48, 0.24, ARMOR_PLATE, { at: [0, 0.28, 0] }, 'armor');
  b.box(0.34, 0.28, 0.28, SUIT_DARK, { at: [0, 0.24, 0.01] }, 'carbon');
  // Tactical belt & utility pouches
  b.box(0.42, 0.09, 0.27, BOOT, { at: [0, 0.05, 0] }, 'carbon');
  b.box(0.24, 0.34, 0.14, ARMOR_TRIM, { at: [0, 0.3, -0.17] }, 'armor'); // compact jump-pack / spine plate
  // Shoulder pauldrons (armored caps)
  for (const s of [-1, 1]) {
    b.box(0.14, 0.15, 0.18, ARMOR_PLATE, { at: [s * 0.27, 0.45, 0], rot: [0, 0, s * -0.22] }, 'armor');
  }

  // Arms posed cleanly for the seat posture
  if (posture === 'straddle') {
    // Reaching forward to grip Moto / Quad / Viper handlebars
    for (const s of [-1, 1]) {
      b.cyl(0.058, 0.052, 0.32, 10, SUIT_DARK, { at: [s * 0.28, 0.36, 0.16], rot: [1.05, s * -0.14, s * 0.12] }, 'carbon');
      b.cyl(0.048, 0.044, 0.3, 10, ARMOR_TRIM, { at: [s * 0.3, 0.28, 0.42], rot: [1.35, s * -0.1, 0] }, 'armor');
      b.sphere(0.052, GLOVE, { at: [s * 0.31, 0.24, 0.56] }, 'carbon');
    }
  } else if (posture === 'seated' || posture === 'cockpit') {
    // Hands reaching forward to steering wheel / flight stick & throttle
    for (const s of [-1, 1]) {
      b.cyl(0.056, 0.05, 0.3, 10, SUIT_DARK, { at: [s * 0.27, 0.34, 0.13], rot: [0.92, s * -0.18, s * 0.1] }, 'carbon');
      b.cyl(0.046, 0.042, 0.28, 10, ARMOR_TRIM, { at: [s * 0.23, 0.26, 0.36], rot: [1.4, s * -0.22, 0] }, 'armor');
      b.sphere(0.048, GLOVE, { at: [s * 0.18, 0.24, 0.49] }, 'carbon');
    }
  } else if (posture === 'gunner') {
    // Braced forward gripping dual turret spade handles
    for (const s of [-1, 1]) {
      b.cyl(0.058, 0.052, 0.32, 10, SUIT_DARK, { at: [s * 0.27, 0.38, 0.18], rot: [1.18, s * -0.15, 0] }, 'carbon');
      b.cyl(0.048, 0.044, 0.3, 10, ARMOR_TRIM, { at: [s * 0.21, 0.36, 0.44], rot: [1.48, s * -0.18, 0] }, 'armor');
      b.sphere(0.05, GLOVE, { at: [s * 0.16, 0.36, 0.58] }, 'carbon');
    }
  } else {
    // 'pillion': Rear passenger holding a compact tactical carbine ready to fire!
    b.cyl(0.056, 0.05, 0.3, 10, SUIT_DARK, { at: [-0.27, 0.36, 0.14], rot: [1.05, 0.28, 0] }, 'carbon');
    b.cyl(0.046, 0.042, 0.28, 10, ARMOR_TRIM, { at: [-0.18, 0.32, 0.36], rot: [1.45, 0.34, 0] }, 'armor');
    b.cyl(0.056, 0.05, 0.3, 10, SUIT_DARK, { at: [0.27, 0.35, 0.16], rot: [1.15, -0.35, 0] }, 'carbon');
    b.cyl(0.046, 0.042, 0.3, 10, ARMOR_TRIM, { at: [0.1, 0.32, 0.4], rot: [1.48, -0.45, 0] }, 'armor');
    // Compact bullpup carbine across hands
    b.box(0.07, 0.12, 0.62, GUN_STEEL, { at: [-0.08, 0.36, 0.46] }, 'metal');
    b.cyl(0.02, 0.024, 0.28, 8, GUN_STEEL, { at: [-0.08, 0.38, 0.85], rot: [Math.PI / 2, 0, 0] }, 'metal');
    b.box(0.05, 0.16, 0.07, BOOT, { at: [-0.08, 0.24, 0.48], rot: [0.18, 0, 0] }, 'carbon');
    b.glow(new THREE.BoxGeometry(0.03, 0.025, 0.04), accentHex, 3.0, { at: [-0.08, 0.44, 0.52] });
  }

  torso.add(b.build(materials));

  // Separate accent stripe mesh so co-op player slot colors can be tinted dynamically at runtime!
  const accentMat = new THREE.MeshBasicMaterial({ color: accentHex, toneMapped: false });
  for (const s of [-1, 1]) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.08, 0.19), accentMat);
    strip.position.set(s * 0.34, 0.46, 0);
    torso.add(strip);
    accentMeshes.push(strip);
  }
  const chestTag = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.045, 0.03), accentMat);
  chestTag.position.set(0, 0.38, 0.155);
  torso.add(chestTag);
  accentMeshes.push(chestTag);

  // Articulated ballistic helmet + glowing tactical visor
  const head = new THREE.Group();
  head.position.set(0, 0.56, 0.02);
  torso.add(head);

  const hb = new VehicleBuilder();
  hb.cyl(0.068, 0.076, 0.1, 10, SUIT_DARK, { at: [0, 0.02, 0] }, 'carbon'); // neck collar
  hb.sphere(0.145, HELMET, { at: [0, 0.15, 0], scale: [0.96, 1.04, 1.08] }, 'armor'); // helmet dome
  hb.box(0.24, 0.11, 0.18, ARMOR_TRIM, { at: [0, 0.09, 0.05] }, 'armor'); // chin/jaw guard
  hb.box(0.06, 0.07, 0.22, ARMOR_PLATE, { at: [0, 0.27, -0.02] }, 'armor'); // helmet ridge rail
  head.add(hb.build(materials));

  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.082, 0.08), accentMat);
  visor.position.set(0, 0.15, 0.125);
  head.add(visor);
  accentMeshes.push(visor);

  return { torso, head, accentMeshes };
}

/** Builds a visible articulated seated tactical operator mounted at `spec`. */
export function buildRiderRig(materials: ModelMaterials, spec: RiderSocketSpec): RiderRig {
  const root = new THREE.Group();
  root.position.set(spec.at[0], spec.at[1], spec.at[2]);
  if (spec.yawOffset) root.rotation.y = spec.yawOffset;
  if (spec.scale && spec.scale !== 1) root.scale.setScalar(spec.scale);
  root.visible = false; // hidden until a seat occupant boards!

  const accentHex = RIDER_ACCENTS[spec.seatIndex % RIDER_ACCENTS.length] ?? '#38e8ff';

  // Lower body (pelvis + thighs + shins + boots) posed cleanly for straddle, seated, or standing gunner
  const lb = new VehicleBuilder();
  lb.box(0.36, 0.16, 0.24, SUIT_DARK, { at: [0, 0.04, 0] }, 'carbon');

  if (spec.posture === 'straddle' || spec.posture === 'pillion') {
    const spread = spec.posture === 'straddle' ? 0.22 : 0.24;
    for (const s of [-1, 1]) {
      // Thigh angling outward & down around the saddle/tank
      lb.cyl(0.078, 0.066, 0.4, 10, SUIT_DARK, { at: [s * spread, -0.08, 0.14], rot: [0.85, s * 0.22, s * -0.25] }, 'carbon');
      // Knee pad
      lb.sphere(0.072, ARMOR_PLATE, { at: [s * (spread + 0.05), -0.2, 0.29] }, 'armor');
      // Shin angling back toward footpegs
      lb.cyl(0.062, 0.052, 0.38, 10, ARMOR_TRIM, { at: [s * (spread + 0.03), -0.37, 0.19], rot: [-0.48, 0, 0] }, 'armor');
      // Heavy combat boot planted on footpeg
      lb.box(0.11, 0.1, 0.22, BOOT, { at: [s * (spread + 0.03), -0.53, 0.15] }, 'tread');
    }
  } else if (spec.posture === 'seated') {
    for (const s of [-1, 1]) {
      lb.cyl(0.078, 0.066, 0.42, 10, SUIT_DARK, { at: [s * 0.15, 0.02, 0.22], rot: [1.42, s * 0.06, 0] }, 'carbon');
      lb.sphere(0.07, ARMOR_PLATE, { at: [s * 0.16, -0.02, 0.42] }, 'armor');
      lb.cyl(0.06, 0.052, 0.4, 10, ARMOR_TRIM, { at: [s * 0.16, -0.22, 0.45], rot: [0.15, 0, 0] }, 'armor');
      lb.box(0.11, 0.09, 0.22, BOOT, { at: [s * 0.16, -0.4, 0.51] }, 'tread');
    }
  } else if (spec.posture === 'gunner') {
    for (const s of [-1, 1]) {
      lb.cyl(0.08, 0.068, 0.44, 10, SUIT_DARK, { at: [s * 0.16, -0.22, -0.02], rot: [-0.08, 0, s * -0.08] }, 'carbon');
      lb.cyl(0.064, 0.054, 0.42, 10, ARMOR_TRIM, { at: [s * 0.18, -0.6, -0.05], rot: [0.06, 0, 0] }, 'armor');
      lb.box(0.12, 0.1, 0.24, BOOT, { at: [s * 0.18, -0.8, 0.0] }, 'tread');
    }
  }
  // 'cockpit' skips legs (hidden below cockpit tub) to save triangles and keep pilot cleanly framed in glass!
  root.add(lb.build(materials));

  const { torso, head, accentMeshes } = buildTorsoAndArms(materials, spec.posture, accentHex);
  torso.position.set(0, 0.09, 0);
  if (spec.posture === 'straddle') torso.rotation.x = 0.26; // athletic forward lean into handlebars
  else if (spec.posture === 'pillion') torso.rotation.x = 0.14;
  else if (spec.posture === 'gunner') torso.rotation.x = 0.12;
  root.add(torso);

  spec.parent.add(root);

  return {
    seatIndex: spec.seatIndex,
    posture: spec.posture,
    root,
    torso,
    head,
    accentMeshes,
    occupantId: null,
  };
}

/** Update rider accent color (e.g. for co-op player slot distinction). */
export function setRiderAccent(rig: RiderRig, color: string): void {
  for (const m of rig.accentMeshes) {
    (m.material as THREE.MeshBasicMaterial).color.set(color);
  }
}

/** Subtle live procedural animation for seated riders (steering lean, wheelie crouch, aim look). */
export function animateRider(
  rig: RiderRig,
  steerAngle: number,
  speedRatio: number,
  wheeliePitch: number,
  lookYawDelta: number,
  lookPitch: number,
): void {
  if (!rig.root.visible) return;
  if (rig.posture === 'straddle') {
    rig.torso.rotation.x = 0.22 + speedRatio * 0.22 - wheeliePitch * 0.35;
    rig.torso.rotation.z = clamp(steerAngle * 0.45, -0.32, 0.32);
    rig.torso.rotation.y = clamp(steerAngle * 0.28, -0.25, 0.25);
    rig.head.rotation.y = clamp(steerAngle * 0.4, -0.45, 0.45);
    rig.head.rotation.x = clamp(-0.18 - speedRatio * 0.14, -0.45, 0.25);
  } else if (rig.posture === 'pillion') {
    // Pillion passenger turns upper body & carbine smoothly toward their aim direction!
    rig.torso.rotation.y = clamp(lookYawDelta, -2.4, 2.4);
    rig.torso.rotation.x = 0.1 + clamp(-lookPitch * 0.45, -0.4, 0.35);
    rig.head.rotation.x = clamp(-lookPitch * 0.35, -0.4, 0.4);
  } else if (rig.posture === 'seated' || rig.posture === 'cockpit') {
    rig.torso.rotation.z = clamp(steerAngle * 0.22, -0.18, 0.18);
    rig.head.rotation.y = clamp(lookYawDelta * 0.5, -0.65, 0.65);
    rig.head.rotation.x = clamp(-lookPitch * 0.4, -0.4, 0.35);
  } else if (rig.posture === 'gunner') {
    rig.torso.rotation.x = 0.1 + clamp(-lookPitch * 0.25, -0.22, 0.22);
    rig.head.rotation.x = clamp(-lookPitch * 0.4, -0.45, 0.35);
  }
}
