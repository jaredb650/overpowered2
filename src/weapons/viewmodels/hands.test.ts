import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Arm } from './arms';
import type { ViewDef } from './def';
import { Kit } from './kit/kit';
import type { VmMaterials } from './kit/materials';
import { Model } from './kit/model';
import { buildDefs, buildOffhand } from './models';
import { Offhand } from './offhand';
import { HANDS } from './poses';

let kit: Kit;
let defs: Record<string, ViewDef>;
let arms: Arm[];

beforeAll(() => {
  vi.stubGlobal('document', {
    createElement: () => ({
      getContext: () => ({ createRadialGradient: () => ({ addColorStop() {} }), fillRect() {} }),
    }),
  });
  const material = new THREE.MeshStandardMaterial();
  kit = new Kit({
    hard: material, glass: material, decal: material,
    decalRegions: new Proxy({}, { get: () => [0, 0, 1, 1] }),
    glow(color: number, intensity: number) {
      const glow = new THREE.MeshBasicMaterial({ color });
      glow.color.multiplyScalar(intensity);
      glow.userData.base = glow.color.clone();
      return glow;
    },
  } as unknown as VmMaterials);
  defs = buildDefs(kit);
  arms = [new Arm(kit, 1), new Arm(kit, -1)];
});

afterAll(() => vi.unstubAllGlobals());

describe('hand frames and support grips', () => {
  it('opposes both thumbs into the palm, not through the armoured back', () => {
    const tips: THREE.Vector3[] = [];
    for (const arm of arms) {
      arm.pose.fill(0);
      arm.applyPose();
      arm.mesh.updateMatrixWorld(true);
      const before = arm.bones[6]!.getWorldPosition(new THREE.Vector3());
      arm.pose[0] = 0.6;
      arm.applyPose();
      arm.mesh.updateMatrixWorld(true);
      const after = arm.bones[6]!.getWorldPosition(new THREE.Vector3());
      expect(after.y).toBeLessThan(before.y - 0.025);
      tips.push(after);
    }
    expect(tips[0]!.x).toBeCloseTo(-tips[1]!.x, 8);
    expect(tips[0]!.y).toBeCloseTo(tips[1]!.y, 8);
    expect(tips[0]!.z).toBeCloseTo(tips[1]!.z, 8);
  });

  it('cups a handguard from the near underside, with fingers up the far side and thumb forward', () => {
    const model = new Model(kit.mesher(), kit.mats);
    const socket = model.support('support', [0, 0, 0]);
    const arm = arms[1]!;
    arm.bones[3]!.position.copy(socket.position);
    arm.bones[3]!.quaternion.copy(socket.quaternion);
    arm.pose.set(HANDS.support);
    arm.applyPose();
    arm.mesh.updateMatrixWorld(true);
    const palm = new THREE.Vector3(0, -1, 0).applyQuaternion(socket.quaternion);
    expect(palm.y).toBeGreaterThan(0.9);
    expect(palm.x).toBeGreaterThan(0.3);
    for (const bone of [9, 12, 15, 18]) {
      const tip = arm.bones[bone]!.getWorldPosition(new THREE.Vector3());
      expect(tip.x).toBeGreaterThan(0.015);
      expect(tip.y).toBeGreaterThan(0.015);
    }
    const thumb = arm.bones[6]!.getWorldPosition(new THREE.Vector3());
    expect(thumb.z).toBeLessThan(-0.035);
    expect(thumb.x).toBeLessThan(0.06);
    expect(thumb.y).toBeGreaterThan(0.04);
  });

  it.each(['smg', 'gimlet', 'harrow', 'shotgun', 'thresher', 'deuce', 'sabot', 'kiln', 'stakegun'])('%s uses the shared palm-up support frame', id => {
    const def = defs[id]!;
    expect(def.left!.pose).toBe(HANDS.support);
    const socket = def.model.sockets[def.left!.socket]!;
    const palm = new THREE.Vector3(0, -1, 0).applyQuaternion(socket.quaternion);
    expect(palm.y).toBeGreaterThan(0.9);
    expect(palm.x).toBeGreaterThan(0.3);
  });

  it.each(['autocannon', 'buzzsaw', 'piledriver', 'rocket', 'quiver', 'lance'])('%s keeps the palm against its vertical foregrip', id => {
    const def = defs[id]!;
    expect(def.left!.pose).toBe(HANDS.foregrip);
    const socket = def.model.sockets[def.left!.socket]!;
    const palm = new THREE.Vector3(0, -1, 0).applyQuaternion(socket.quaternion);
    expect(palm.x).toBeGreaterThan(0.9);
  });

  it('keeps the pump and break-action support sockets parented to their moving parts', () => {
    expect(defs.shotgun!.model.sockets.pumpL!.parent).toBe(defs.shotgun!.model.parts.pump);
    expect(defs.deuce!.model.sockets.foreL!.parent).toBe(defs.deuce!.model.parts.barrels);
  });

  it('keeps the same palm-up grip when the Gimlet switches to its launcher', () => {
    const socket = defs.gimlet!.model.sockets.glHold!;
    const palm = new THREE.Vector3(0, -1, 0).applyQuaternion(socket.quaternion);
    expect(palm.y).toBeGreaterThan(0.9);
    expect(palm.x).toBeGreaterThan(0.3);
  });
});

describe('visor tap', () => {
  it('faces the left palm toward the face, with its thumb on the left, throughout the tap', () => {
    const offhand = new Offhand(buildOffhand(kit));
    offhand.tap();
    for (let frame = 0; frame < 54; frame++) {
      offhand.update(1 / 120);
      const rotation = offhand.hand.quaternion;
      const palm = new THREE.Vector3(0, -1, 0).applyQuaternion(rotation);
      const thumb = new THREE.Vector3(1, 0, 0).applyQuaternion(rotation);
      const fingers = new THREE.Vector3(0, 0, -1).applyQuaternion(rotation);
      expect(palm.z).toBeGreaterThan(0.8);
      expect(thumb.x).toBeLessThan(-0.3);
      expect(fingers.y).toBeGreaterThan(0.8);
      const arm = arms[1]!;
      arm.bones[3]!.quaternion.copy(rotation);
      arm.pose.set(HANDS.tap);
      arm.applyPose();
      arm.mesh.updateMatrixWorld(true);
      const thumbBase = arm.bones[4]!.getWorldPosition(new THREE.Vector3());
      const thumbTip = arm.bones[6]!.getWorldPosition(new THREE.Vector3());
      expect(thumbTip.x).toBeLessThan(thumbBase.x - 0.02);
    }
    offhand.update(1);
    offhand.update(1 / 120);
    expect(offhand.leftWeight).toBe(0);
  });
});
