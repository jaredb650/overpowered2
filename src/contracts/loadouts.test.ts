import { describe, expect, it } from 'vitest';
import type { WeaponId } from '../core/gameplay';
import { MISSIONS } from '../campaign/missions';
import type { Mission } from '../campaign/types';
import { validateMission } from '../campaign/validate';
import { CACHE_ORDER } from '../progression/data';
import { WEAPONS, WEAPON_ORDER } from '../weapons/data';
import { inPlay } from '../weapons/families';
import { makeRange } from '../weapons/testkit';
import { CONTRACTS } from './data';
import { DEFAULT_LOADOUT, LOADOUT_MELEE, WEAPON_PRICES } from './defense/data';
import { checkLoadout } from './defense/economy';
import { survivalLoadout } from './loadouts';
import { SHOP_CONTRACTS, weaponWares } from './shop/data';
import { issued, listedWeapons, weaponOffers, type ShopView } from './shop/rules';

function uniqueSlots(weapons: readonly WeaponId[]): void {
  expect(new Set(weapons.map(id => WEAPONS[id].slot)).size, weapons.join(', ')).toBe(weapons.length);
}

describe('starting loadouts', () => {
  it('gives every contract at most one weapon per key', () => {
    for (const contract of CONTRACTS) {
      const weapons = contract.mission ? MISSIONS[contract.mission]!.loadout.weapons
        : contract.economy ? [...DEFAULT_LOADOUT, LOADOUT_MELEE] : survivalLoadout(contract.id);
      uniqueSlots(weapons);
    }
  });

  it('keeps every mission and checkpoint slot-exclusive, including the development stub', () => {
    for (const mission of Object.values(MISSIONS)) {
      uniqueSlots(mission.loadout.weapons);
      for (const beat of mission.beats) if (beat.checkpoint) uniqueSlots(beat.checkpoint.loadout.weapons);
    }
    expect(MISSIONS.outpost!.loadout.weapons).not.toContain('rocket');
    expect(MISSIONS.outpost!.beats.some(beat => beat.checkpoint?.loadout.weapons.includes('rocket'))).toBe(true);
  });

  it('accepts a checkpoint replacing a gun only with another guaranteed pickup on its key', () => {
    const mission: Mission = {
      id: 'loadout', title: 'Loadout', loadout: { weapons: ['smg', 'shotgun', 'sword'], grenades: 0 },
      zones: {}, marks: { start: { at: [0, 0, 0] } }, routes: {}, doors: {}, cutscenes: {}, lines: [], redeployLines: [],
      beats: [
        { id: 'pickup', title: 'Pickup', start: [{ do: 'rack', weapon: 'thresher', at: 'start' }], until: { after: 1 } },
        { id: 'restart', title: 'Restart', checkpoint: { at: 'start', loadout: { weapons: ['smg', 'thresher', 'sword'], grenades: 0 } }, until: { after: 1 } },
      ],
    };
    expect(validateMission(mission)).toEqual([]);
    const unearned = { ...mission, beats: [{ ...mission.beats[0]!, start: [] }, mission.beats[1]!] };
    expect(validateMission(unearned)).toContain('beat restart: its checkpoint takes away the shotgun');
  });

  it('issues only the SMG in Crucible and only the Harrow in Endless Humans on key 1', () => {
    expect(survivalLoadout('crucible')).toEqual(['smg', 'shotgun', 'rivet', 'sword']);
    expect(survivalLoadout('outpost')).toEqual(['harrow', 'shotgun', 'rivet', 'sword']);
    for (const contract of SHOP_CONTRACTS) {
      expect(survivalLoadout(contract).filter(id => WEAPONS[id].slot === 1)).toHaveLength(1);
    }
  });

  it('falls back to the SMG and Judge when legacy families hide the Harrow and Rivet', () => {
    const weapons = survivalLoadout('outpost', id => !['harrow', 'rivet'].includes(id));
    expect(weapons).toEqual(['smg', 'shotgun', 'judge', 'sword']);
    uniqueSlots(weapons);
  });

  it('actually issues the small kit on construction and reset, and clears acquired guns', async () => {
    const range = await makeRange();
    expect([...range.weapons.owned]).toEqual(survivalLoadout('crucible'));
    range.weapons.give('quiver');
    range.reset();
    expect([...range.weapons.owned]).toEqual(survivalLoadout('crucible'));
    expect(range.weapons.current).toBe('smg');
    uniqueSlots([...range.weapons.owned]);
  });

  it('keeps every accepted Defense selection to one primary, one pistol and the Sword', () => {
    for (const primary of Object.keys(WEAPON_PRICES) as WeaponId[]) {
      for (const secondary of Object.keys(WEAPON_PRICES) as WeaponId[]) {
        if (checkLoadout(primary, secondary, 100_000).why === null) uniqueSlots([primary, secondary, LOADOUT_MELEE]);
      }
    }
  });

  it('leaves every non-issued weapon reachable in caches when the shops are disabled', () => {
    for (const contract of SHOP_CONTRACTS) {
      const reachable = new Set([...survivalLoadout(contract), ...CACHE_ORDER]);
      for (const id of WEAPON_ORDER.filter(inPlay)) expect(reachable.has(id), `${contract}: ${id}`).toBe(true);
    }
  });
});

describe.each(SHOP_CONTRACTS)('%s issuance and purchases', contract => {
  const start = survivalLoadout(contract);
  const wares = weaponWares(contract);
  const view: ShopView = {
    credits: 100_000, inBreak: true, cleared: 0, owned: new Set(start), mods: new Set(), fitted: new Set(),
    implants: new Set(), implantsFitted: new Set(), slots: 1,
  };

  it('marks exactly the actual starting weapons Issued, at no price or wave lock', () => {
    const offers = weaponOffers(view, wares);
    expect(offers.filter(offer => offer.why === 'Issued').map(offer => offer.act.id).sort()).toEqual([...start].sort());
    for (const id of listedWeapons()) {
      expect(issued(wares[id]!), id).toBe(start.includes(id));
      if (start.includes(id)) expect(wares[id]).toMatchObject({ price: 0, wave: 0 });
      else expect(wares[id]!.price, id).toBeGreaterThan(0);
    }
  });

  it('sells every non-issued weapon only after its wave, and never relabels purchases Issued', () => {
    for (const id of listedWeapons().filter(id => !start.includes(id))) {
      const ware = wares[id]!;
      expect(ware.lore.length, id).toBeGreaterThan(40);
      const offer = (cleared: number, owned = view.owned) =>
        weaponOffers({ ...view, cleared, owned }, wares).find(row => row.act.id === id)!;
      if (ware.wave > 0) expect(offer(ware.wave - 1).why, id).toBe(`Released after wave ${ware.wave}`);
      expect(offer(ware.wave).why, id).toBeNull();
      expect(offer(ware.wave, new Set([...start, id])).why, id).toBe('Owned');
    }
  });
});
