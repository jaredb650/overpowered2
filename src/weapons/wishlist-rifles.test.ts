/**
 * Lane A (Rifles) of the weapons wishlist: verifies all 8 new rifle mod viewmodel parts, sockets, shop-turntable dressing
 * (`dressModel`), and mod-stacking geometry invariants on the Gimlet, Harrow, and Flail.
 */
import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ModId, WeaponId } from '../core/gameplay';
import { WEAPONS } from './data';
import { MODS, moddedDef } from './mods';
import type { ViewDef } from './viewmodels/def';
import { Kit } from './viewmodels/kit/kit';
import type { VmMaterials } from './viewmodels/kit/materials';
import { buildDefs } from './viewmodels/models';
import { dressModel, restingModel } from './viewmodels/rest';

const LANE_A_MODS: readonly (readonly [WeaponId, ModId])[] = [
  ['gimlet', 'gimletLong'],
  ['gimlet', 'gimletMagwell'],
  ['harrow', 'harrowShort'],
  ['harrow', 'harrowBrake'],
  ['harrow', 'harrowMag'],
  ['harrow', 'harrowMagwell'],
  ['flail', 'flailHeavy'],
  ['flail', 'flailStock'],
];

let defs: Record<string, ViewDef>;

beforeAll(() => {
  vi.stubGlobal('document', {
    createElement: () => ({
      getContext: () => ({ createRadialGradient: () => ({ addColorStop() {} }), fillRect() {} }),
    }),
  });
  const material = new THREE.MeshStandardMaterial();
  const kit = new Kit({
    hard: material,
    glass: material,
    decal: material,
    decalRegions: new Proxy({}, { get: () => [0, 0, 1, 1] }),
    glow(color: number, intensity: number) {
      const glow = new THREE.MeshBasicMaterial({ color });
      glow.color.multiplyScalar(intensity);
      glow.userData.base = glow.color.clone();
      return glow;
    },
  } as unknown as VmMaterials);
  defs = buildDefs(kit);
});

afterAll(() => vi.unstubAllGlobals());

function vertexCount(obj: THREE.Object3D): number {
  let total = 0;
  obj.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) total += mesh.geometry.getAttribute('position')?.count ?? 0;
  });
  return total;
}

describe('Lane A rifle mod viewmodels', () => {
  it.each(LANE_A_MODS)('%s -> %s has its ViewDef.mods entry, referenced parts, geometry, and sockets', (weapon, modId) => {
    const def = defs[weapon]!;
    expect(def, weapon).toBeDefined();
    expect(MODS[modId].weapon).toBe(weapon);
    const look = def.mods?.[modId];
    expect(look, `${weapon}.mods.${modId}`).toBeDefined();

    const part = def.model.parts[look!.part];
    expect(part, `${weapon}.parts.${look!.part}`).toBeDefined();
    expect(vertexCount(part!), `${weapon}.${modId} vertices`).toBeGreaterThan(24);

    if (look!.hides) {
      expect(def.model.parts[look!.hides], `${weapon}.parts.${look!.hides}`).toBeDefined();
    }
    if (look!.moves) {
      expect(def.model.parts[look!.moves.part], `${weapon}.parts.${look!.moves.part}`).toBeDefined();
    }
    if (look!.muzzle) {
      expect(def.model.sockets[look!.muzzle], `${weapon}.sockets.${look!.muzzle}`).toBeDefined();
    }
  });

  it('Gimlet: long barrel swaps stdFront cleanly, extends muzzle forward, shifts suppressor cleanly, and preserves short barrel', () => {
    const def = defs.gimlet!;
    const stdMuzzleZ = def.model.sockets.muzzle!.position.z;
    const longMuzzleZ = def.model.sockets.muzzleLong!.position.z;
    const shortMuzzleZ = def.model.sockets.muzzleShort!.position.z;
    expect(longMuzzleZ).toBeLessThan(stdMuzzleZ - 0.08);
    expect(shortMuzzleZ).toBeGreaterThan(stdMuzzleZ + 0.06);

    // Suppressor comes before both barrel mods so muzzleCan wins whenever the can is fitted.
    const keys = Object.keys(def.mods!);
    expect(keys.indexOf('gimletCan')).toBeLessThan(keys.indexOf('gimletLong'));
    expect(keys.indexOf('gimletCan')).toBeLessThan(keys.indexOf('gimletShort'));

    // Shop turntable dressModel: long barrel + can + GL + magwell.
    const { root } = restingModel('gimlet', def);
    dressModel(root, def, new Set<ModId>(['gimletLong', 'gimletCan', 'gimletGl', 'gimletMagwell']));
    expect(root.getObjectByName('longBarrel')!.visible).toBe(true);
    expect(root.getObjectByName('stdFront')!.visible).toBe(false);
    expect(root.getObjectByName('shortBarrel')!.visible).toBe(false);
    expect(root.getObjectByName('can')!.visible).toBe(true);
    expect(root.getObjectByName('gl')!.visible).toBe(true);
    expect(root.getObjectByName('magwell')!.visible).toBe(true);
    const canShiftLongZ = root.getObjectByName('canShift')!.position.z;
    expect(canShiftLongZ).toBeLessThan(-0.08);

    // Switching to short barrel + can must still hide standard barrel and shift can back without clashing with gimletLong.
    dressModel(root, def, new Set<ModId>(['gimletShort', 'gimletCan']));
    expect(root.getObjectByName('stdFront')!.visible).toBe(true);
    expect(root.getObjectByName('barrel')!.visible).toBe(false);
    expect(root.getObjectByName('shortBarrel')!.visible).toBe(true);
    expect(root.getObjectByName('longBarrel')!.visible).toBe(false);
    expect(root.getObjectByName('canShift')!.position.z).toBeCloseTo(0, 6);
    expect(root.getObjectByName('can')!.position.z).toBeGreaterThan(def.model.parts.can!.position.z + 0.05);
  });

  it('Harrow: short barrel, muzzle brake, 40-rd mag (parented to animated mag), and magwell stack cleanly', () => {
    const def = defs.harrow!;
    const stdMuzzleZ = def.model.sockets.muzzle!.position.z;
    const shortMuzzleZ = def.model.sockets.muzzleShort!.position.z;
    expect(shortMuzzleZ).toBeGreaterThan(stdMuzzleZ + 0.07);

    // Extended 40-rd mag lives inside the animated `mag` group so reloads carry it automatically.
    const mag = def.model.parts.mag!;
    const magExt = def.model.parts.magExt!;
    const magStd = def.model.parts.magStd!;
    expect(magExt.parent).toBe(mag);
    expect(magStd.parent).toBe(mag);

    // Brake comes before short barrel so muzzleBrake (parented inside muzzleMount) wins when both are fitted.
    const keys = Object.keys(def.mods!);
    expect(keys.indexOf('harrowBrake')).toBeLessThan(keys.indexOf('harrowShort'));
    expect(def.model.sockets.muzzleBrake!.parent).toBe(def.model.parts.brake);

    // Shop turntable dressModel with all four new Harrow mods fitted together.
    const { root } = restingModel('harrow', def);
    dressModel(root, def, new Set<ModId>(['harrowShort', 'harrowBrake', 'harrowMag', 'harrowMagwell']));
    expect(root.getObjectByName('barrelShort')!.visible).toBe(true);
    expect(root.getObjectByName('barrelStd')!.visible).toBe(false);
    expect(root.getObjectByName('brake')!.visible).toBe(true);
    expect(root.getObjectByName('muzzleStd')!.visible).toBe(false);
    expect(root.getObjectByName('magExt')!.visible).toBe(true);
    expect(root.getObjectByName('magStd')!.visible).toBe(false);
    expect(root.getObjectByName('magwell')!.visible).toBe(true);
    // muzzleMount shifted back toward the gas block.
    expect(root.getObjectByName('muzzleMount')!.position.z).toBeGreaterThan(def.model.parts.muzzleMount!.position.z + 0.07);
  });

  it('Flail: heavy M60/MG42 fore-end and enhanced cheek-rest stock swap cleanly in FP and shop studio', () => {
    const def = defs.flail!;
    expect(def.model.sockets.muzzleHeavy!.position.z).toBeLessThan(def.model.sockets.muzzle!.position.z - 0.03);
    // Heavy barrel front is detailed (shroud + fluted barrel + bipod + carry handle + flash hider).
    expect(vertexCount(def.model.parts.frontHeavy!)).toBeGreaterThan(1500);
    expect(vertexCount(def.model.parts.stockEnh!)).toBeGreaterThan(300);

    const { root } = restingModel('flail', def);
    dressModel(root, def, new Set<ModId>(['flailHeavy', 'flailStock', 'flailBox']));
    expect(root.getObjectByName('frontHeavy')!.visible).toBe(true);
    expect(root.getObjectByName('frontStd')!.visible).toBe(false);
    expect(root.getObjectByName('stockEnh')!.visible).toBe(true);
    expect(root.getObjectByName('stockStd')!.visible).toBe(false);
    expect(root.getObjectByName('boxExt')!.visible).toBe(true);
    expect(root.getObjectByName('boxStd')!.visible).toBe(false);
  });

  it('matches Phase 0 stat patches for all 8 Lane A mods', () => {
    const gLong = moddedDef('gimlet', new Set<ModId>(['gimletLong']));
    expect(gLong.damage).toBeCloseTo(48, 5);
    expect(60 / gLong.interval).toBeCloseTo(760, 5);
    expect(moddedDef('gimlet', new Set<ModId>(['gimletLong', 'gimletAp'])).armorPiercing).toBe(true);
    expect(moddedDef('gimlet', new Set<ModId>(['gimletMagwell'])).reloadTime).toBeCloseTo(WEAPONS.gimlet.reloadTime * 0.85, 5);

    expect(60 / moddedDef('harrow', new Set<ModId>(['harrowShort'])).interval).toBeCloseTo(690, 5);
    expect(60 / moddedDef('harrow', new Set<ModId>(['harrowBrake'])).interval).toBeCloseTo(630, 5);
    expect(moddedDef('harrow', new Set<ModId>(['harrowMag'])).magSize).toBe(40);
    expect(moddedDef('harrow', new Set<ModId>(['harrowMagwell'])).reloadTime).toBeCloseTo(WEAPONS.harrow.reloadTime * 0.85, 5);

    const fHeavy = moddedDef('flail', new Set<ModId>(['flailHeavy']));
    expect(fHeavy.damage).toBeCloseTo(44, 5);
    expect(60 / fHeavy.interval).toBeCloseTo(880, 5);
    expect(moddedDef('flail', new Set<ModId>(['flailStock'])).breath!.hold).toBeGreaterThan(5);
  });
});
