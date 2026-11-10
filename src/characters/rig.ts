/**
 * Canonical character rigs.
 *
 * Conventions (every system relies on these):
 *  - Units are meters, Y is up, and a character faces +Z. Its left side is +X.
 *  - Bind rotations are identity for every bone. A bone's rest transform is a pure translation from its parent,
 *    so an animation is just a quaternion per bone, in character space axes.
 *  - The bind pose is an A-pose with arms about 20 degrees off the body.
 *  - `root` is an Object3D owned by the character. Bone 0 (hips) sits under it.
 */

export type GoreRegion =
  | 'head' | 'chest' | 'abdomen'
  | 'armL' | 'forearmL' | 'armR' | 'forearmR'
  | 'legL' | 'shinL' | 'legR' | 'shinR';

export type Vec3Tuple = readonly [number, number, number];

export interface JointDef {
  kind: 'ball' | 'hinge';
  /** Hinge axis in character space. */
  axis?: Vec3Tuple;
  /** Hinge limits in radians. */
  min?: number;
  max?: number;
  /** Ball joints: maximum swing from rest in radians (soft limit). */
  cone?: number;
  /** Ball joints: maximum twist in radians (soft limit). */
  twist?: number;
  /** What the joint does for the body, so impacts and collapses never need to know the rig. */
  role?: JointRole;
}

export type JointRole = 'spine' | 'head' | 'arm' | 'leg';

export interface BoneDef {
  name: string;
  parent: number;
  /** Rest translation from the parent bone. */
  offset: Vec3Tuple;
  /** Which damage/gore region a hit on this bone counts as. */
  region: GoreRegion;
  /** Hit capsule in bone space. Omitted bones cannot be hit directly. */
  hit?: { from: Vec3Tuple; to: Vec3Tuple; radius: number };
  /**
   * The ragdoll's collider, where that differs from `hit`. Hits, mass, cuts and slices keep reading `hit`: this changes
   * only what the body rests on.
   */
  collider?: { from: Vec3Tuple; to: Vec3Tuple; radius: number };
  /** True when the joint to the parent can be cut. Everything below it comes off with it. */
  severable?: boolean;
  /** 'body' gets a rigid body in a ragdoll; 'merge' rides rigidly on its parent's body. */
  ragdoll: 'body' | 'merge';
  joint?: JointDef;
  /**
   * Where the joint rests when nothing is using it, as a rotation vector from bind in the parent's axes. For a
   * person this is the neutral body posture NASA measured in microgravity. On a hinge it must lie along the axis.
   */
  relax?: Vec3Tuple;
}

export interface RigDef {
  id: string;
  bones: readonly BoneDef[];
  /** Overall height in meters, for spawning and for AI line of sight. */
  height: number;
}

export interface HumanoidProportions {
  /** Uniform size multiplier. 1 is a 1.85 m human. */
  scale: number;
  /** Multiplier on shoulder and hip width, and on limb hit radius. */
  bulk: number;
  /** Multiplier on arm length. */
  reach: number;
}

export const HumanoidBone = {
  hips: 0, spine: 1, chest: 2, neck: 3, head: 4,
  upperArmL: 5, foreArmL: 6, handL: 7,
  upperArmR: 8, foreArmR: 9, handR: 10,
  thighL: 11, shinL: 12, footL: 13,
  thighR: 14, shinR: 15, footR: 16,
} as const;
export type HumanoidBoneName = keyof typeof HumanoidBone;

export function humanoidRig(id: string, p: Partial<HumanoidProportions> = {}): RigDef {
  const s = p.scale ?? 1;
  const b = p.bulk ?? 1;
  const r = p.reach ?? 1;
  const v = (x: number, y: number, z: number): Vec3Tuple => [x * s, y * s, z * s];
  const shoulderX = 0.2 * b;
  const hipX = 0.1 * b;
  const arm = (side: 1 | -1, upperName: string, foreName: string, handName: string, upperRegion: GoreRegion, foreRegion: GoreRegion, chest: number, baseIndex: number): BoneDef[] => [
    {
      name: upperName, parent: chest, offset: v(side * shoulderX, 0.235, 0), region: upperRegion, severable: true, ragdoll: 'body',
      hit: { from: v(0, 0, 0), to: v(side * 0.1 * r, -0.28 * r, 0), radius: 0.062 * s * b },
      joint: { kind: 'ball', cone: 1.9, twist: 0.8, role: 'arm' },
      // Forward and out, with the shoulder rolled in. Bind already holds the arm about 20 degrees off the body.
      relax: [-0.62, -side * 0.3, side * 0.22],
    },
    {
      name: foreName, parent: baseIndex, offset: v(side * 0.1 * r, -0.28 * r, 0), region: foreRegion, severable: true, ragdoll: 'body',
      hit: { from: v(0, 0, 0), to: v(side * 0.08 * r, -0.25 * r, 0.02), radius: 0.05 * s * b },
      joint: { kind: 'hinge', axis: [1, 0, 0], min: 0, max: 2.4, role: 'arm' },
      relax: [-1.5, 0, 0],
    },
    {
      name: handName, parent: baseIndex + 1, offset: v(side * 0.08 * r, -0.25 * r, 0.02), region: foreRegion, ragdoll: 'merge',
      hit: { from: v(0, 0, 0), to: v(side * 0.02, -0.1, 0.02), radius: 0.05 * s },
    },
  ];
  const leg = (side: 1 | -1, thighName: string, shinName: string, footName: string, upperRegion: GoreRegion, lowerRegion: GoreRegion, baseIndex: number): BoneDef[] => [
    {
      name: thighName, parent: 0, offset: v(side * hipX, -0.05, 0), region: upperRegion, severable: true, ragdoll: 'body',
      hit: { from: v(0, 0, 0), to: v(0, -0.44, 0), radius: 0.085 * s * b },
      joint: { kind: 'ball', cone: 1.4, twist: 0.5, role: 'leg' },
      // Hip bent about 50 degrees, thigh drifting out, knee falling outward.
      relax: [-0.87, side * 0.22, side * 0.14],
    },
    {
      name: shinName, parent: baseIndex, offset: v(0, -0.44, 0), region: lowerRegion, severable: true, ragdoll: 'body',
      hit: { from: v(0, 0, 0), to: v(0, -0.42, 0), radius: 0.065 * s * b },
      joint: { kind: 'hinge', axis: [1, 0, 0], min: -2.4, max: 0, role: 'leg' },
      relax: [0.87, 0, 0],
    },
    {
      name: footName, parent: baseIndex + 1, offset: v(0, -0.42, 0), region: lowerRegion, ragdoll: 'merge',
      hit: { from: v(0, -0.03, -0.04), to: v(0, -0.05, 0.16), radius: 0.05 * s },
      // A ball at the heel, under the ankle. On the whole sole a dead shin stood up by itself like a boot, and the body
      // sat down on its heels; on a ball it tips, and the knees go.
      collider: { from: v(0, -0.03, 0), to: v(0, -0.03, 0.001), radius: 0.05 * s },
      relax: [0.4, 0, 0],
    },
  ];
  const bones: BoneDef[] = [
    {
      name: 'hips', parent: -1, offset: v(0, 0.97, 0), region: 'abdomen', ragdoll: 'body',
      hit: { from: v(-0.07 * b, 0.02, 0), to: v(0.07 * b, 0.02, 0), radius: 0.13 * s * b },
    },
    {
      name: 'spine', parent: 0, offset: v(0, 0.11, 0), region: 'abdomen', severable: true, ragdoll: 'merge',
      hit: { from: v(0, 0, 0), to: v(0, 0.16, 0), radius: 0.135 * s * b },
    },
    {
      name: 'chest', parent: 1, offset: v(0, 0.17, 0), region: 'chest', ragdoll: 'body',
      hit: { from: v(-0.08 * b, 0.1, 0), to: v(0.08 * b, 0.1, 0), radius: 0.16 * s * b },
      joint: { kind: 'ball', cone: 0.7, twist: 0.5, role: 'spine' },
      relax: [0.24, 0, 0],
    },
    {
      name: 'neck', parent: 2, offset: v(0, 0.28, 0.01), region: 'head', severable: true, ragdoll: 'merge',
      hit: { from: v(0, 0, 0), to: v(0, 0.09, 0.01), radius: 0.06 * s },
    },
    {
      name: 'head', parent: 3, offset: v(0, 0.09, 0.01), region: 'head', ragdoll: 'body',
      hit: { from: v(0, 0.04, 0.015), to: v(0, 0.14, 0.015), radius: 0.11 * s },
      joint: { kind: 'ball', cone: 0.9, twist: 1.0, role: 'head' },
      relax: [0.42, 0, 0],
    },
    ...arm(1, 'upperArmL', 'foreArmL', 'handL', 'armL', 'forearmL', 2, HumanoidBone.upperArmL),
    ...arm(-1, 'upperArmR', 'foreArmR', 'handR', 'armR', 'forearmR', 2, HumanoidBone.upperArmR),
    ...leg(1, 'thighL', 'shinL', 'footL', 'legL', 'shinL', HumanoidBone.thighL),
    ...leg(-1, 'thighR', 'shinR', 'footR', 'legR', 'shinR', HumanoidBone.thighR),
  ];
  return { id, bones, height: 1.85 * s };
}

export const SkitterBone = {
  body: 0, head: 1,
  hipFL: 2, kneeFL: 3, footFL: 4, hipML: 5, kneeML: 6, footML: 7, hipBL: 8, kneeBL: 9, footBL: 10,
  hipFR: 11, kneeFR: 12, footFR: 13, hipMR: 14, kneeMR: 15, footMR: 16, hipBR: 17, kneeBR: 18, footBR: 19,
} as const;

/** Six-legged spider mine. Legs fan out from the body. Regions reuse the humanoid vocabulary. */
export function skitterRig(id: string): RigDef {
  const bones: BoneDef[] = [
    {
      name: 'body', parent: -1, offset: [0, 0.42, 0], region: 'chest', ragdoll: 'body',
      hit: { from: [0, 0, -0.14], to: [0, 0, 0.14], radius: 0.24 },
    },
    {
      name: 'head', parent: 0, offset: [0, 0.03, 0.22], region: 'head', ragdoll: 'merge', severable: true,
      hit: { from: [0, 0, 0], to: [0, 0, 0.08], radius: 0.1 },
    },
  ];
  const leg = (name: string, x: number, z: number, region: GoreRegion) => {
    const base = bones.length;
    const out = Math.hypot(x, z);
    const ux = x / out, uz = z / out;
    bones.push(
      {
        name: `hip${name}`, parent: 0, offset: [x, -0.02, z], region, severable: true, ragdoll: 'body',
        hit: { from: [0, 0, 0], to: [ux * 0.3, 0.16, uz * 0.3], radius: 0.05 },
        joint: { kind: 'ball', cone: 1.2, twist: 0.3, role: 'leg' },
        // Legs draw up about their tangent as the servos lose power, the way a dead spider curls.
        relax: [-uz * 0.45, 0, ux * 0.45],
      },
      {
        name: `knee${name}`, parent: base, offset: [ux * 0.3, 0.16, uz * 0.3], region, ragdoll: 'merge',
        hit: { from: [0, 0, 0], to: [ux * 0.26, -0.5, uz * 0.26], radius: 0.04 },
      },
      {
        name: `foot${name}`, parent: base + 1, offset: [ux * 0.26, -0.54, uz * 0.26], region, ragdoll: 'merge',
      },
    );
  };
  leg('FL', 0.17, 0.15, 'armL');
  leg('ML', 0.21, 0, 'legL');
  leg('BL', 0.17, -0.15, 'shinL');
  leg('FR', -0.17, 0.15, 'armR');
  leg('MR', -0.21, 0, 'legR');
  leg('BR', -0.17, -0.15, 'shinR');
  return { id, bones, height: 0.72 };
}

export const DroneBone = {
  body: 0, gun: 1, rotorFL: 2, rotorFR: 3, rotorBL: 4, rotorBR: 5, sensor: 6,
} as const;

/** Hover platform. The body banks and the gun tracks independently. */
export function droneRig(id: string): RigDef {
  const rotor = (name: string, x: number, z: number, region: GoreRegion): BoneDef => ({
    name, parent: 0, offset: [x, 0.05, z], region, severable: true, ragdoll: 'body',
    hit: { from: [0, 0, 0], to: [0, 0.02, 0], radius: 0.17 },
  });
  const bones: BoneDef[] = [
    {
      name: 'body', parent: -1, offset: [0, 0, 0], region: 'chest', ragdoll: 'body',
      hit: { from: [0, 0, -0.16], to: [0, 0, 0.18], radius: 0.2 },
    },
    {
      name: 'gun', parent: 0, offset: [0, -0.17, 0.12], region: 'abdomen', severable: true, ragdoll: 'body',
      hit: { from: [0, 0, 0], to: [0, -0.02, 0.34], radius: 0.07 },
    },
    rotor('rotorFL', 0.42, 0.34, 'armL'),
    rotor('rotorFR', -0.42, 0.34, 'armR'),
    rotor('rotorBL', 0.42, -0.34, 'legL'),
    rotor('rotorBR', -0.42, -0.34, 'legR'),
    {
      name: 'sensor', parent: 0, offset: [0, 0.03, 0.26], region: 'head', severable: true, ragdoll: 'merge',
      hit: { from: [0, 0, 0], to: [0, 0, 0.05], radius: 0.08 },
    },
  ];
  return { id, bones, height: 0.6 };
}
