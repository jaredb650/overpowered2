/** The katana's model with the energy blade (sword.ts): the emitter hilt in place of the steel, the beam igniting on the draw. */
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { Anim, type ViewDef } from '../def';
import { Kit } from '../kit/kit';
import type { VmMaterials } from '../kit/materials';
import { swordDef } from './sword';

let def: ViewDef;

beforeAll(() => {
  const material = new THREE.MeshStandardMaterial();
  const mats = {
    hard: material, decal: material, decalRegions: {},
    glow(color: number, intensity: number) {
      const glow = new THREE.MeshBasicMaterial({ color });
      glow.color.multiplyScalar(intensity);
      glow.userData.base = glow.color.clone();
      return glow;
    },
  } as unknown as VmMaterials;
  def = swordDef(new Kit(mats));
});

function pose(draw: number, energy: boolean): Anim {
  const a = new Anim();
  a.mods = new Set(energy ? ['swordEnergy'] : []);
  a.model = def.model;
  a.parts = def.model.parts;
  a.draw = draw;
  def.model.resetParts();
  def.animate(a);
  return a;
}

describe('energy blade model', () => {
  it('shows the emitter hilt in place of the steel sword, and stays inside the budget', () => {
    expect(def.mods?.swordEnergy).toEqual({ part: 'energy', hides: 'steel' });
    expect(def.model.parts.energy).toBeDefined();
    expect(def.model.parts.steel).toBeDefined();
    expect(def.model.parts.beam!.getObjectByName('halo')).toBeDefined();
    expect(def.model.triangles).toBeLessThan(40000);
  });

  it('ignites out of the emitter on the draw, and is full length once drawn', () => {
    expect(pose(0, true).parts.beam!.scale.z).toBeLessThan(0.05);
    expect(pose(0.5, true).parts.beam!.scale.z).toBeGreaterThan(0.5);
    expect(pose(1, true).parts.beam!.scale.z).toBeCloseTo(1, 5);
    // The steel katana's draw leaves the beam alone.
    expect(pose(0, false).parts.beam!.scale.z).toBe(1);
  });
});
