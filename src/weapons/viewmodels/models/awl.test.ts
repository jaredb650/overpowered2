import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { Anim, type ViewDef } from '../def';
import { Kit } from '../kit/kit';
import type { VmMaterials } from '../kit/materials';
import type { ModId } from '../../../core/gameplay';
import { GREASE } from '../../mods';
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

function pose(seconds: number, acog = false, ...mods: ModId[]): Anim {
  const anim = new Anim();
  anim.model = def.model;
  anim.parts = def.model.parts;
  anim.sinceFire = seconds;
  anim.mods = new Set([...(acog ? ['awlAcog'] as const : []), ...mods]);
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
    // Every mod part is built in, hidden until fitted: the gun, the ACOG, the can and the weapon light came to about 32,600;
    // the extended barrel, greased bolt film, and .50 Cal kit (standard & extended tank brakes, heavy barrel, shroud, bolt, mag)
    // bring the total well under 42,000.
    expect(def.model.triangles).toBeLessThan(42000);
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

  it('runs the barrel on past the cap it replaces, the can forward over its brake, and the flash from whichever is out front', () => {
    const long = def.mods!.awlBarrel!;
    expect(long).toMatchObject({ part: 'longBarrel', hides: 'crown', muzzle: 'muzzleLong' });
    const at = (name: string) => def.model.sockets[name]!.getWorldPosition(new THREE.Vector3()).z;
    def.model.resetParts();
    def.model.root.updateMatrixWorld(true);
    expect(at('muzzle') - at('muzzleLong')).toBeCloseTo(0.12, 3);
    // The can's mouth is on the can, so moving the can along moves the flash with it; the can is listed first, so it wins.
    expect(def.model.sockets.muzzleCan!.parent).toBe(def.model.parts.can);
    const before = at('muzzleCan');
    def.model.parts.can!.position.z += long.moves!.z;
    def.model.root.updateMatrixWorld(true);
    expect(at('muzzleCan')).toBeLessThan(at('muzzleLong'));
    expect(before - at('muzzleCan')).toBeCloseTo(-long.moves!.z, 6);
    expect(Object.keys(def.mods!).indexOf('awlCan')).toBeLessThan(Object.keys(def.mods!).indexOf('awlBarrel'));
  });

  it('greased, the bolt runs the same path sooner, its film riding with it', () => {
    pose(0.3 * GREASE, false, 'awlBolt');
    expect(def.model.parts.bolt!.rotation.z).toBeCloseTo(1.12);
    expect(def.model.parts.bolt!.position.z).toBeCloseTo(0.14);
    expect(def.model.parts.grease!.rotation.z).toBeCloseTo(def.model.parts.bolt!.rotation.z);
    expect(def.model.parts.grease!.position.z).toBeCloseTo(def.model.parts.bolt!.position.z);
    pose(0.66 * GREASE, false, 'awlBolt');
    expect(def.model.parts.bolt!.rotation.z).toBeCloseTo(0);
    expect(def.mods!.awlBolt!.part).toBe('grease');
  });

  it('gives the .50 Cal standard brake on crown and an elongated heavy barrel when paired with awlBarrel', () => {
    expect(def.model.parts.cal50BrakeStd).toBeDefined();
    expect(def.model.parts.cal50Long).toBeDefined();
    expect(def.model.parts.cal50BrakeStd!.parent).toBe(def.model.parts.crown);
    expect(def.model.parts.cal50Long!.parent).toBe(def.model.parts.longBarrel);

    def.model.resetParts();
    def.model.root.updateMatrixWorld(true);
    const stdLongBox = new THREE.Box3().setFromObject(def.model.parts.longBarrel!);
    const cal50LongBox = new THREE.Box3().setFromObject(def.model.parts.cal50Long!);
    // cal50Long extends noticeably farther forward (-Z) than the stock longBarrel crown.
    expect(cal50LongBox.min.z).toBeLessThan(stdLongBox.min.z + 0.01);
    expect(cal50LongBox.getSize(new THREE.Vector3()).z).toBeGreaterThan(0.25);

    // With both awl50 and awlBarrel fitted, clip() pushes muzzleLong and can further forward than standard awlBarrel.
    pose(99, false, 'awlBarrel');
    const stdMuzzleLongZ = def.model.sockets.muzzleLong!.position.z;
    const stdCanZ = def.model.parts.can!.position.z;
    pose(99, false, 'awl50', 'awlBarrel');
    expect(def.model.sockets.muzzleLong!.position.z).toBeLessThan(stdMuzzleLongZ - 0.15);
    expect(def.model.parts.can!.position.z).toBeLessThan(stdCanZ - 0.15);
  });

  it('cycles the bolt only on empty reloads and swaps only the mag on tactical reloads', () => {
    const runReload = (progress: number, fromEmpty: boolean) => {
      const anim = new Anim();
      anim.model = def.model;
      anim.parts = def.model.parts;
      anim.sinceFire = 99;
      anim.reload = progress;
      anim.reloadFromEmpty = fromEmpty;
      anim.mag = fromEmpty ? 0 : 3;
      anim.magSize = 5;
      anim.left.begin(def.left);
      anim.right.begin(def.right);
      def.model.resetParts();
      def.animate(anim);
      return anim;
    };

    const empty = runReload(0.76, true);
    expect(def.model.parts.bolt!.rotation.z).toBeGreaterThan(0.5);
    expect(def.model.parts.bolt!.position.z).toBeGreaterThan(0.1);
    expect(empty.right.names.slice(0, empty.right.steps)).toContain('boltHold');

    const tac = runReload(0.76, false);
    expect(def.model.parts.bolt!.rotation.z).toBeCloseTo(0, 5);
    expect(def.model.parts.bolt!.position.z).toBeCloseTo(0.045, 5);
    expect(tac.right.names.slice(0, tac.right.steps)).not.toContain('boltHold');
  });
});

