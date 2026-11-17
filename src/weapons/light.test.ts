/** The weapon light: one mod a gun for every rifle, shotgun and pistol, cheap and sold from the start, a part on each model. */
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { WeaponId } from '../core/gameplay';
import { MOD_WARES } from '../contracts/shop/data';
import { modOffers, type ShopView } from '../contracts/shop/rules';
import { WEAPONS } from './data';
import { LIGHT_GUNS, MODS, MOD_ORDER, lightOf, moddedDef } from './mods';
import { Kit } from './viewmodels/kit/kit';
import type { VmMaterials } from './viewmodels/kit/materials';
import { buildDefs } from './viewmodels/models';

const view = (owned: WeaponId[]): ShopView => ({
  credits: 1000, inBreak: true, cleared: 0, owned: new Set(owned), mods: new Set(), fitted: new Set(),
  implants: new Set(), implantsFitted: new Set(), slots: 1, chips: new Set(), chipsFitted: [], chipSlots: 1,
});

describe('weapon light', () => {
  it('fits every rifle, shotgun and pistol, and nothing heavy', () => {
    expect([...LIGHT_GUNS].sort()).toEqual(['autoraffica', 'awl', 'deuce', 'gimlet', 'harrow', 'judge', 'rivet', 'shotgun', 'smg', 'thresher', 'ultramag']);
    for (const heavy of ['sabot', 'autocannon', 'rocket', 'quiver', 'buzzsaw', 'piledriver', 'lance', 'kiln', 'stakegun'] as WeaponId[]) {
      expect(MOD_ORDER.some(id => MODS[id].weapon === heavy && id.endsWith('Light')), heavy).toBe(false);
    }
  });

  it('is one mod a gun, changes nothing in the row, and has a cheap shop row open from the start', () => {
    for (const gun of LIGHT_GUNS) {
      const id = lightOf(gun);
      expect(MODS[id].weapon).toBe(gun);
      expect(MOD_ORDER).toContain(id);
      expect(moddedDef(gun, new Set([id]))).toEqual(WEAPONS[gun]);
      expect(MOD_WARES[id]).toMatchObject({ price: 150, wave: 0 });
      const offer = modOffers(view([gun])).find(o => o.act.kind === 'mod' && o.act.id === id)!;
      expect(offer.locked, gun).toBe(false);
      expect(offer.why, gun).toBeNull();
    }
  });

  it('is a part on every eligible gun\'s viewmodel, hidden until fitted', () => {
    // The ammo screens draw on a canvas: as hands.test.ts, enough of one to build.
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({ createRadialGradient: () => ({ addColorStop() {} }), fillRect() {} }) }) });
    const material = new THREE.MeshStandardMaterial();
    const mats = { hard: material, decal: material, decalRegions: new Proxy({}, { get: () => [0, 0, 1, 1] }), glow: (c: number) => new THREE.MeshBasicMaterial({ color: c }) } as unknown as VmMaterials;
    const defs = buildDefs(new Kit(mats));
    for (const gun of LIGHT_GUNS) {
      const look = defs[gun]!.mods?.[lightOf(gun)];
      expect(look?.part, gun).toBe('light');
      expect(defs[gun]!.model.parts.light, gun).toBeDefined();
    }
    vi.unstubAllGlobals();
  });
});
