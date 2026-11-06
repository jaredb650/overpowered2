import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { HumanoidBone as B, humanoidRig } from '../rig';
import { FracturePose } from './fracture';

function body() {
  const rig = humanoidRig('dummy');
  const root = new THREE.Group();
  const bones = rig.bones.map(() => new THREE.Bone());
  rig.bones.forEach((def, i) => {
    bones[i]!.position.set(def.offset[0], def.offset[1], def.offset[2]);
    (def.parent >= 0 ? bones[def.parent]! : root).add(bones[i]!);
  });
  root.updateMatrixWorld(true);
  return { rig, root, bones, pose: new FracturePose(rig, bones) };
}

/** What an animator does: writes every joint, every frame. */
function animate(bones: THREE.Bone[], flex: number): void {
  bones[B.foreArmL]!.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -flex);
  bones[B.shinL]!.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), flex);
  bones[B.upperArmR]!.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -1.2);
  bones[B.foreArmR]!.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -1);
}

const angleAboutX = (q: THREE.Quaternion) => 2 * Math.atan2(q.x, q.w);

describe('FracturePose', () => {
  it('holds an elbow past straight, backwards, whatever the animator writes', () => {
    const { bones, pose } = body();
    pose.add(B.foreArmL, 'hyper', 0);
    for (let i = 0; i < 120; i++) {
      animate(bones, 1.4);
      pose.apply(1 / 60);
    }
    const a = angleAboutX(bones[B.foreArmL]!.quaternion);
    expect(a).toBeGreaterThan(0.4);
    expect(a).toBeLessThan(1.31);
  });

  it('bends a knee forward, the opposite sign', () => {
    const { bones, pose } = body();
    pose.add(B.shinL, 'hyper', 0);
    for (let i = 0; i < 120; i++) {
      animate(bones, 1.4);
      pose.apply(1 / 60);
    }
    expect(angleAboutX(bones[B.shinL]!.quaternion)).toBeLessThan(-0.4);
  });

  it('lets a dead arm hang, with the forearm slack below it, while the body stays up', () => {
    const { bones, pose, root } = body();
    pose.add(B.upperArmR, 'limp', 0);
    for (let i = 0; i < 300; i++) {
      animate(bones, 0.5);
      pose.apply(1 / 60);
    }
    root.updateMatrixWorld(true);
    const shoulder = bones[B.upperArmR]!.getWorldPosition(new THREE.Vector3());
    const elbow = bones[B.foreArmR]!.getWorldPosition(new THREE.Vector3());
    const wrist = bones[B.handR]!.getWorldPosition(new THREE.Vector3());
    expect(elbow.y).toBeLessThan(shoulder.y - 0.25);
    expect(wrist.y).toBeLessThan(elbow.y - 0.2);
    expect(Math.abs(elbow.z - shoulder.z)).toBeLessThan(0.05);
  });

  it('settles the same at 30 fps as at 144', () => {
    const run = (hz: number) => {
      const { bones, pose } = body();
      pose.add(B.upperArmR, 'limp', 0);
      for (let i = 0; i < hz * 5; i++) {
        animate(bones, 0.5);
        pose.apply(1 / hz);
      }
      return bones[B.upperArmR]!.quaternion.clone();
    };
    expect(run(30).angleTo(run(144))).toBeLessThan(0.03);
  });

  it('swings the way it was carried: a limb trails a body that moves off', () => {
    const { bones, pose, root } = body();
    pose.add(B.upperArmR, 'limp', 0);
    for (let i = 0; i < 300; i++) {
      animate(bones, 0.5);
      pose.apply(1 / 60);
    }
    for (let i = 0; i < 12; i++) {
      root.position.z += 6 / 60;
      root.updateMatrixWorld(true);
      animate(bones, 0.5);
      pose.apply(1 / 60);
    }
    root.updateMatrixWorld(true);
    const shoulder = bones[B.upperArmR]!.getWorldPosition(new THREE.Vector3());
    const elbow = bones[B.foreArmR]!.getWorldPosition(new THREE.Vector3());
    expect(elbow.z).toBeLessThan(shoulder.z - 0.02);
  });

  it('survives a teleport without flinging the limb', () => {
    const { bones, pose, root } = body();
    pose.add(B.upperArmR, 'limp', 0);
    for (let i = 0; i < 120; i++) {
      animate(bones, 0.5);
      pose.apply(1 / 60);
    }
    const before = bones[B.upperArmR]!.quaternion.clone();
    root.position.set(40, 0, 40);
    root.updateMatrixWorld(true);
    animate(bones, 0.5);
    pose.apply(1 / 60);
    expect(bones[B.upperArmR]!.quaternion.angleTo(before)).toBeLessThan(1.2);
  });

  it('forgets everything on reset', () => {
    const { bones, pose } = body();
    pose.add(B.foreArmL, 'hyper', 0);
    pose.reset();
    expect(pose.has(B.foreArmL)).toBe(false);
    animate(bones, 1.4);
    pose.apply(1 / 60);
    expect(angleAboutX(bones[B.foreArmL]!.quaternion)).toBeCloseTo(-1.4, 5);
  });
});
