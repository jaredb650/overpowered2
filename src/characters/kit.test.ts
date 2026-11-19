/** The kit a burnt body carries (Character.ts `charKit`, material.ts): burnt with it, and unburnt again however it was copied. */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { Ctx } from '../core/contracts';
import { charKit } from './Character';
import { charredVariant, createCharacterMaterial, unburntVariant } from './material';

const ctx = { render: {} } as unknown as Ctx;
const make = () => createCharacterMaterial(ctx, { detail: new THREE.Texture(), atlasA: null, atlasB: null, extraBase: 0 });

describe('burnt kit', () => {
  it('has a burnt twin that knows what it was made from', () => {
    const plain = make();
    const twin = charredVariant(plain);
    expect(twin).not.toBe(plain);
    expect(charredVariant(plain)).toBe(twin);
    expect(unburntVariant(twin)).toBe(plain);
    // Neither is changed by being asked twice, or the wrong way round.
    expect(charredVariant(twin)).toBe(twin);
    expect(unburntVariant(plain)).toBe(plain);
    // A material that is not a character's has no twin.
    const other = new THREE.MeshBasicMaterial();
    expect(charredVariant(other)).toBe(other);
    expect(unburntVariant(other)).toBe(other);
  });

  it('a copy of burnt kit made by three is burnt kit that can be unburnt: nothing is kept on the mesh', () => {
    const plain = make();
    const gun = new THREE.Group();
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(), plain);
    gun.add(barrel);
    charKit(gun, true);
    expect(barrel.material).toBe(charredVariant(plain));
    // three's clone puts userData through JSON: a material kept there came back as a plain object (the bug this guards).
    expect(Object.keys(barrel.userData)).toEqual([]);
    const copy = gun.clone();
    const copied = copy.children[0] as THREE.Mesh;
    expect(copied.material).toBe(charredVariant(plain));
    charKit(copy, false);
    expect(copied.material).toBe(plain);
    expect((copied.material as THREE.Material).isMaterial).toBe(true);
    // The original is not touched by what was done to its copy.
    expect(barrel.material).toBe(charredVariant(plain));
    charKit(gun, false);
    expect(barrel.material).toBe(plain);
  });
});
