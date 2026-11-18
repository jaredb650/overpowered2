/** The Piledriver's optics (weapons/mods.ts `piledriverDot`, `piledriverAcog`) and the flak clip on the autocannon. */
import * as THREE from 'three';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ModId } from '../../../core/gameplay';
import { MOD_WARES, modWares } from '../../../contracts/shop/data';
import { FINAL_WAVE } from '../../../enemies/commander/adaptations';
import { WEAPONS } from '../../data';
import { MODS, MOD_ORDER, moddedDef } from '../../mods';
import { makeRange, type Range } from '../../testkit';
import { Anim, ironsUp, type ViewDef } from '../def';
import { Kit } from '../kit/kit';
import type { VmMaterials } from '../kit/materials';
import { dressModel, restingModel } from '../rest';
import { autocannonDef } from './autocannon';
import { piledriverDef } from './piledriver';

let hmg: ViewDef;
let cannon: ViewDef;
beforeAll(() => {
  const material = new THREE.MeshStandardMaterial();
  const mats = {
    hard: material, glass: material, decal: material, decalRegions: new Proxy({}, { get: () => [0, 0, 1, 1] }),
    screen: () => material,
    glow(color: number, intensity: number) {
      const glow = new THREE.MeshBasicMaterial({ color });
      glow.color.multiplyScalar(intensity);
      glow.userData.base = glow.color.clone();
      return glow;
    },
  } as unknown as VmMaterials;
  const kit = new Kit(mats);
  hmg = piledriverDef(kit);
  // The autocannon's ammo readout draws to a canvas: a stand-in that takes every call, for this build only.
  const any: unknown = new Proxy(() => any, { get: () => any, apply: () => any });
  const g = globalThis as { document?: unknown };
  g.document = { createElement: () => ({ getContext: () => any }) };
  try {
    cannon = autocannonDef(kit);
  } finally {
    delete g.document;
  }
});

function pose(def: ViewDef, mods: ModId[], reload = -1): Anim {
  const anim = new Anim();
  anim.model = def.model;
  anim.parts = def.model.parts;
  anim.sinceFire = 99;
  anim.mag = anim.magSize = 3;
  anim.reload = reload;
  anim.mods = new Set(mods);
  def.model.resetParts();
  def.animate(anim);
  return anim;
}

describe('the Piledriver\'s red dot and ACOG', () => {
  it('narrow the view as the other guns\' do, and take one optic slot', () => {
    expect(moddedDef('piledriver', new Set(['piledriverDot'])).ads!.zoom).toBe(MODS.gimletDot.patch.ads!.zoom);
    expect(moddedDef('piledriver', new Set(['piledriverAcog'])).ads!.zoom).toBe(MODS.gimletAcog.patch.ads!.zoom);
    expect(moddedDef('piledriver', new Set()).ads).toEqual(WEAPONS.piledriver.ads);
    expect(MODS.piledriverDot.slot).toBe('sight');
    expect(MODS.piledriverAcog.slot).toBe('sight');
    for (const id of ['piledriverDot', 'piledriverAcog'] as const) {
      expect(MOD_ORDER).toContain(id);
      expect(MOD_WARES[id].price).toBeGreaterThan(0);
      expect(modWares('outpost')[id].wave).toBeLessThanOrEqual(FINAL_WAVE - 1);
    }
  });

  it('sit level on the rail behind the feed cover, the sight on the bore\'s line, and fold the ladder away', () => {
    const dot = hmg.mods!.piledriverDot!;
    const scope = hmg.mods!.piledriverAcog!;
    for (const look of [dot, scope]) {
      expect(look.rear).toBeNull();
      expect(look.sight![0]).toBe(0);
      // Above the ladder's notch, so nothing of the gun is in the picture, and behind the cover's hinge.
      expect(look.sight![1]).toBeGreaterThan(0.13);
      expect(look.sight![2]).toBeGreaterThan(-0.01);
    }
    expect(scope.eye!.socket).toBe('acogEye');
    expect(hmg.model.sockets.acogEye).toBeDefined();
    expect(hmg.irons).toBe('ladder');
    expect(ironsUp(hmg, new Set(['piledriverAcog']))).toBe(false);
    expect(ironsUp(hmg, new Set(['piledriverDot']))).toBe(false);
    expect(ironsUp(hmg, new Set())).toBe(true);
  });

  it('show on the shop\'s model only while fitted, one at a time', () => {
    const { root } = restingModel('piledriver', hmg);
    dressModel(root, hmg, new Set(['piledriverDot']));
    expect(root.getObjectByName('reddot')!.visible).toBe(true);
    expect(root.getObjectByName('acog')!.visible).toBe(false);
    expect(root.getObjectByName('ladder')!.visible).toBe(false);
    dressModel(root, hmg, new Set());
    expect(root.getObjectByName('reddot')!.visible).toBe(false);
    expect(root.getObjectByName('ladder')!.visible).toBe(true);
  });

  let r: Range;
  beforeEach(async () => {
    r = await makeRange();
    r.reset();
  });

  it('exclude each other when fitted', () => {
    r.weapons.give('piledriver');
    r.weapons.grantMod('piledriverDot');
    r.weapons.grantMod('piledriverAcog');
    expect(r.weapons.fitMod('piledriverDot', true)).toBe(true);
    expect(r.weapons.fitMod('piledriverAcog', true)).toBe(true);
    expect(r.weapons.fitted.has('piledriverAcog')).toBe(true);
    expect(r.weapons.fitted.has('piledriverDot')).toBe(false);
  });
});

describe('the autocannon\'s flak clip', () => {
  it('swaps the clip\'s rounds for flak while fitted, and strips them a shot at a time as the plain ones', () => {
    const { root } = restingModel('autocannon', cannon);
    dressModel(root, cannon, new Set(['autocannonFlak']));
    expect(root.getObjectByName('flakRounds')!.visible).toBe(true);
    expect(root.getObjectByName('heRounds')!.visible).toBe(false);
    const a = pose(cannon, ['autocannonFlak']);
    a.mag = 1;
    cannon.model.resetParts();
    cannon.animate(a);
    expect(cannon.model.parts.f0!.visible).toBe(true);
    expect(cannon.model.parts.f2!.visible).toBe(false);
  });
});
