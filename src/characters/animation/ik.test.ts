import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { humanoidRig, HumanoidBone as H } from '../rig';
import { Limb } from './ik';

describe('hand IK', () => {
  it.each([1, -1])('puts roll in the forearm without moving the %s hand or its grip', side => {
    const rig = humanoidRig('hands');
    const root = new THREE.Group();
    const bones = rig.bones.map(def => {
      const bone = new THREE.Bone();
      bone.position.set(...def.offset);
      return bone;
    });
    rig.bones.forEach((def, index) => (def.parent < 0 ? root : bones[def.parent]!).add(bones[index]!));
    root.rotation.set(0.1, 0.4, -0.2);
    const upper = bones[side > 0 ? H.upperArmL : H.upperArmR]!;
    const fore = bones[side > 0 ? H.foreArmL : H.foreArmR]!;
    const hand = bones[side > 0 ? H.handL : H.handR]!;
    const limb = new Limb(upper, fore, hand, new THREE.Vector3(side * 0.3, 0, -1));
    const shoulder = new THREE.Vector3(side * 0.2, 1.5, 0);
    const target = new THREE.Vector3(side * 0.25, 1.25, 0.35);
    const pole = new THREE.Vector3(side * 0.4, -0.4, -1);
    const axis = hand.position.clone().normalize();
    const parentQ = new THREE.Quaternion();
    for (const angle of [-2.8, -1.5, 0, 1.5, 2.8]) {
      limb.solve(shoulder, parentQ, target, pole);
      const wanted = limb.lowerQ.clone().multiply(new THREE.Quaternion().setFromAxisAngle(axis, angle));
      wanted.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.3));
      root.updateMatrixWorld(true);
      const before = hand.getWorldPosition(new THREE.Vector3());
      const elbow = fore.getWorldPosition(new THREE.Vector3());
      limb.setHand(wanted);
      root.updateMatrixWorld(true);
      expect(hand.getWorldPosition(new THREE.Vector3()).distanceTo(before)).toBeLessThan(1e-10);
      expect(fore.getWorldPosition(new THREE.Vector3()).distanceTo(elbow)).toBeLessThan(1e-10);
      const expected = root.quaternion.clone().multiply(wanted);
      expect(hand.getWorldQuaternion(new THREE.Quaternion()).angleTo(expected)).toBeLessThan(1e-7);
      expect(Math.abs(new THREE.Vector3(hand.quaternion.x, hand.quaternion.y, hand.quaternion.z).dot(axis))).toBeLessThan(1e-10);
      limb.setHand(wanted);
      expect(hand.quaternion.length()).toBeCloseTo(1, 10);
    }
  });
});
