import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Anim, type ViewDef } from '../def';
import { Kit } from '../kit/kit';
import type { VmMaterials } from '../kit/materials';
import { HANDS } from '../poses';
import { flailDef } from './flail';

let def: ViewDef;
beforeAll(() => {
  vi.stubGlobal('document', {
    createElement: () => ({ getContext: () => ({ createRadialGradient: () => ({ addColorStop() {} }), fillRect() {} }) }),
  });
  const material = new THREE.MeshStandardMaterial();
  const mats = {
    hard: material, glass: material, decal: material, decalRegions: new Proxy({}, { get: () => [0, 0, 1, 1] }),
    glow(color: number, intensity: number) {
      const glow = new THREE.MeshBasicMaterial({ color });
      glow.color.multiplyScalar(intensity);
      glow.userData.base = glow.color.clone();
      return glow;
    },
  } as unknown as VmMaterials;
  def = flailDef(new Kit(mats));
});
afterAll(() => vi.unstubAllGlobals());

function reloadAt(p: number): Anim {
  const a = new Anim();
  a.model = def.model;
  a.parts = def.model.parts;
  a.reload = p;
  a.mag = 0;
  a.magSize = 100;
  def.model.resetParts();
  def.animate(a);
  return a;
}

describe('Flail viewmodel', () => {
  it('has a hinged cover carrying the optics, a box with both its looks, a belt and a handle, under a triangle cap', () => {
    for (const name of ['cover', 'box', 'boxStd', 'boxExt', 'belt', 'charge', 'irons', 'reddot', 'acog', 'countStd', 'countExt']) {
      expect(def.model.parts[name], name).toBeDefined();
    }
    // The optics ride up with the cover.
    expect(def.model.parts.reddot!.parent).toBe(def.model.parts.cover);
    expect(def.model.parts.acog!.parent).toBe(def.model.parts.cover);
    expect(def.mods!.flailBox).toMatchObject({ part: 'boxExt', hides: 'boxStd' });
    // Every look is built in, hidden until fitted: the gun with both optics and both boxes came to about 29,500.
    expect(def.model.triangles).toBeLessThan(31000);
  });

  it('puts each optic\'s sight point on the cover where the cover puts it, centred over the bore', () => {
    def.model.resetParts();
    def.model.root.updateMatrixWorld(true);
    for (const id of ['flailDot', 'flailAcog'] as const) {
      const look = def.mods![id]!;
      expect(look.sight![0]).toBe(0);
      expect(look.rear).toBeNull();
      // Above the irons' line, so the post sits under the picture.
      expect(look.sight![1]).toBeGreaterThan(def.sight![1]);
    }
    expect(def.mods!.flailAcog!.eye!.socket).toBe('acogEye');
  });

  it('holds the handguard with the shared support frame', () => {
    expect(def.left!.pose).toBe(HANDS.support);
    const socket = def.model.sockets[def.left!.socket]!;
    expect(new THREE.Vector3(0, -1, 0).applyQuaternion(socket.quaternion).y).toBeGreaterThan(0.7);
  });

  it('reloads as a belt-fed gun: cover up, the box away, the belt laid, cover down, the handle racked', () => {
    const steps = (a: Anim) => a.left.names.slice(0, a.left.steps);
    let a = reloadAt(0.1);
    expect(def.model.parts.cover!.rotation.x).toBeLessThan(-0.5);
    expect(steps(a)).toContain('coverHold');
    a = reloadAt(0.32);
    expect(def.model.parts.box!.visible).toBe(false);
    expect(def.model.parts.belt!.visible).toBe(false);
    a = reloadAt(0.55);
    expect(def.model.parts.box!.visible).toBe(true);
    expect(def.model.parts.box!.position.y).toBeGreaterThan(-0.02);
    expect(steps(a)).toContain('beltHold');
    a = reloadAt(0.75);
    expect(def.model.parts.cover!.rotation.x).toBeCloseTo(0, 6);
    a = reloadAt(0.845);
    expect(def.model.parts.charge!.position.z).toBeGreaterThan(-0.168 + 0.02);
    expect(steps(a)).toContain('chargeHold');
    reloadAt(-1);
  });
});
