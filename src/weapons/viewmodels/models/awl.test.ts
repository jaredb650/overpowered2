import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { Anim, type ViewDef } from '../def';
import { Kit } from '../kit/kit';
import type { VmMaterials } from '../kit/materials';
import { awlDef } from './awl';

let def: ViewDef;
beforeAll(() => {
  const material = new THREE.MeshStandardMaterial();
  const mats = {
    hard: material, glass: material, decal: material, decalRegions: { optic4x: [0, 0, 1, 1] },
    glow(color: number, intensity: number) {
      const glow = new THREE.MeshBasicMaterial({ color });
      glow.color.multiplyScalar(intensity);
      glow.userData.base = glow.color.clone();
      return glow;
    },
  } as unknown as VmMaterials;
  def = awlDef(new Kit(mats));
});

function pose(seconds: number, acog = false): Anim {
  const anim = new Anim();
  anim.model = def.model;
  anim.parts = def.model.parts;
  anim.sinceFire = seconds;
  anim.mods = new Set(acog ? ['awlAcog'] : []);
  def.model.resetParts();
  def.animate(anim);
  return anim;
}

describe('Awl viewmodel', () => {
  it('has the forward scout scope, integral bipod, removable magazine and separate bolt', () => {
    for (const name of ['scoutScope', 'bipod', 'mag', 'bolt', 'acog', 'can']) expect(def.model.parts[name]).toBeDefined();
    // Its eyepiece ahead of the bolt handle, the body out over the barrel.
    expect(def.model.parts.scoutScope!.position.z).toBeLessThan(-0.12);
    expect(def.model.sockets.boltHold!.parent).toBe(def.model.parts.bolt);
    expect(def.model.triangles).toBeGreaterThan(1000);
    expect(def.model.triangles).toBeLessThan(30000);
  });

  it('rotates the bolt before drawing it back and follows it with the right hand', () => {
    const anim = pose(0.3);
    expect(def.model.parts.bolt!.rotation.z).toBeCloseTo(1.12);
    expect(def.model.parts.bolt!.position.z).toBeCloseTo(0.14);
    expect(anim.right.names.slice(0, anim.right.steps)).toContain('boltHold');
    pose(0.66);
    expect(def.model.parts.bolt!.rotation.z).toBeCloseTo(0);
    expect(def.model.parts.bolt!.position.z).toBeCloseTo(0.045);
  });

  it('replaces the long-eye-relief scope with the reusable ACOG', () => {
    pose(99);
    expect(def.model.parts.scoutScope!.visible).toBe(true);
    pose(99, true);
    expect(def.model.parts.scoutScope!.visible).toBe(false);
    expect(def.mods!.awlAcog!.eye!.socket).toBe('acogEye');
    expect(def.mods!.awlCan!.muzzle).toBe('muzzleCan');
  });
});
