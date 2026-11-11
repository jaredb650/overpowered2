/** Weapon families: what a number key, the wheel and Q draw, and what comes with a base weapon. */
import { beforeEach, describe, expect, it } from 'vitest';
import type { WeaponId } from '../core/gameplay';
import { WEAPONS, WEAPON_ORDER } from './data';
import { SLOT_ORDER, familyOf, familyOfSlot, membersOf, pressSlot, wheelSlot } from './families';
import { makeRange, type Range } from './testkit';

const all = new Set<WeaponId>(WEAPON_ORDER);

describe('family table', () => {
  it('groups by number key, base first', () => {
    expect(familyOfSlot(1)).toEqual(['smg', 'harrow']);
    expect(familyOfSlot(2)).toEqual(['shotgun', 'thresher']);
    expect(familyOfSlot(3)).toEqual(['rocket', 'quiver']);
    // The Sabot is first on key 4: the explosive autocannon is its upgrade.
    expect(familyOfSlot(4)).toEqual(['sabot', 'autocannon']);
    expect(familyOfSlot(6)).toEqual(['judge', 'rivet']);
    // Key 5: the katana and the four swung beside it, all owned with it.
    expect(familyOfSlot(5)).toEqual(['sword', 'knife', 'crowbar', 'shovel', 'baton']);
    expect(familyOf('harrow')).toEqual(['smg', 'harrow']);
  });

  it('every weapon is on exactly one key, and every member names a base on the same key', () => {
    const seen = SLOT_ORDER.flatMap(slot => familyOfSlot(slot));
    expect([...seen].sort()).toEqual([...WEAPON_ORDER].sort());
    for (const id of WEAPON_ORDER) {
      const base = WEAPONS[id].base;
      if (base) expect(WEAPONS[base].slot, id).toBe(WEAPONS[id].slot);
    }
    expect(membersOf('smg')).toEqual(['harrow']);
    expect(membersOf('judge')).toEqual(['rivet']);
    expect(membersOf('shotgun')).toEqual(['thresher']);
    expect(membersOf('rocket')).toEqual(['quiver']);
    // The autocannon is earned on its own, from a weapon cache: owning the Sabot does not bring it.
    expect(membersOf('sabot')).toEqual([]);
    expect(WEAPONS.autocannon.base).toBeUndefined();
    expect(membersOf('sword')).toEqual(['knife', 'crowbar', 'shovel', 'baton']);
  });

  it('the order is the table\'s, with each family together and its base first', () => {
    expect(WEAPON_ORDER).toEqual(Object.keys(WEAPONS));
    for (const slot of SLOT_ORDER) {
      const family = familyOfSlot(slot);
      const at = WEAPON_ORDER.indexOf(family[0]!);
      expect(WEAPON_ORDER.slice(at, at + family.length), `slot ${slot}`).toEqual(family);
      expect(WEAPONS[family[0]!].base, `slot ${slot}`).toBeUndefined();
    }
  });

  it('the key of the slot in hand steps to the next member and wraps', () => {
    expect(pressSlot(1, 'smg', all, undefined)).toBe('harrow');
    expect(pressSlot(1, 'harrow', all, undefined)).toBe('smg');
    expect(pressSlot(2, 'shotgun', all, undefined)).toBe('thresher');
    expect(pressSlot(4, 'sabot', all, undefined)).toBe('autocannon');
    expect(pressSlot(4, 'autocannon', all, undefined)).toBe('sabot');
    expect(pressSlot(5, 'sword', all, undefined)).toBe('knife');
    expect(pressSlot(5, 'baton', all, undefined)).toBe('sword');
    expect(pressSlot(5, 'sword', new Set<WeaponId>(['sword']), undefined)).toBeNull();
  });

  it('another slot\'s key draws the member last held there', () => {
    expect(pressSlot(1, 'shotgun', all, 'harrow')).toBe('harrow');
    expect(pressSlot(1, 'shotgun', all, undefined)).toBe('smg');
    // A remembered member that is no longer owned falls back to one that is.
    expect(pressSlot(1, 'shotgun', new Set<WeaponId>(['smg', 'shotgun']), 'harrow')).toBe('smg');
    expect(pressSlot(7, 'smg', new Set<WeaponId>(['smg']), undefined)).toBeNull();
  });

  it('skips members that are not owned', () => {
    expect(pressSlot(1, 'smg', new Set<WeaponId>(['smg']), undefined)).toBeNull();
  });

  it('the wheel walks keys, not weapons', () => {
    const last = new Map<number, WeaponId>([[4, 'autocannon']]);
    const recall = (slot: number) => last.get(slot);
    expect(wheelSlot('smg', 1, all, recall)).toBe('shotgun');
    expect(wheelSlot('harrow', 1, all, recall)).toBe('shotgun');
    expect(wheelSlot('rocket', 1, all, recall)).toBe('autocannon');
    expect(wheelSlot('quiver', 1, all, () => undefined)).toBe('sabot');
    expect(wheelSlot('smg', -1, all, recall)).toBe('stakegun');
    expect(wheelSlot('smg', 1, new Set<WeaponId>(['smg', 'sword']), recall)).toBe('sword');
    expect(wheelSlot('smg', 1, new Set<WeaponId>(['smg', 'harrow']), recall)).toBeNull();
  });
});

describe('families in the weapon system', () => {
  let r: Range;
  beforeEach(async () => {
    r = await makeRange();
    r.reset();
  });
  const settle = () => r.run(0.4);

  it('starts with the members of the starting weapons, and the Sabot without its upgrade', () => {
    expect(r.weapons.owned.has('harrow')).toBe(true);
    expect(r.weapons.owned.has('thresher')).toBe(true);
    expect(r.weapons.owned.has('quiver')).toBe(true);
    expect(r.weapons.owned.has('sabot')).toBe(true);
    expect(r.weapons.owned.has('autocannon')).toBe(false);
    expect(r.weapons.owned.has('rivet')).toBe(false);
    r.weapons.give('judge');
    expect(r.weapons.owned.has('rivet')).toBe(true);
    expect(r.weapons.ammo('rivet').mag).toBe(WEAPONS.rivet.magSize);
  });

  it('a mission loadout brings members with their base and nothing else', () => {
    r.weapons.setLoadout(['smg', 'shotgun'], 0);
    expect([...r.weapons.owned].sort()).toEqual(['harrow', 'shotgun', 'smg', 'thresher']);
  });

  it('a loadout that names the autocannon keeps it, and its key draws it first', () => {
    // The Outpost's loadout, written when the autocannon was the gun on 4.
    r.weapons.setLoadout(['smg', 'shotgun', 'rocket', 'autocannon', 'sword'], 0);
    expect(r.weapons.owned.has('autocannon')).toBe(true);
    expect(r.weapons.owned.has('sabot')).toBe(false);
    r.tap('weapon4');
    expect(r.weapons.current).toBe('autocannon');
    // With both named, the first one named is what the key draws.
    r.weapons.setLoadout(['smg', 'autocannon', 'sabot', 'sword'], 0);
    expect(r.weapons.slotMember(4)).toBe('autocannon');
    r.weapons.setLoadout(['smg', 'sabot', 'autocannon', 'sword'], 0);
    expect(r.weapons.slotMember(4)).toBe('sabot');
  });

  it('the cache that brings the autocannon puts it second on key 4, beside the Sabot', () => {
    r.tap('weapon4');
    expect(r.weapons.current).toBe('sabot');
    r.run(0.4);
    // Only the Sabot on the key: pressing it again does nothing.
    r.tap('weapon4');
    expect(r.weapons.current).toBe('sabot');
    r.weapons.give('autocannon');
    expect(r.weapons.owned.has('autocannon')).toBe(true);
    expect(r.weapons.ammo('autocannon').mag).toBe(WEAPONS.autocannon.magSize);
    r.run(0.4);
    r.tap('weapon4');
    expect(r.weapons.current).toBe('autocannon');
  });

  it('pressing the key again cycles, another key returns to the member last held', () => {
    expect(r.weapons.current).toBe('smg');
    r.tap('weapon1');
    expect(r.weapons.current).toBe('harrow');
    settle();
    r.tap('weapon2');
    expect(r.weapons.current).toBe('shotgun');
    expect(r.weapons.slotMember(1)).toBe('harrow');
    settle();
    r.tap('weapon1');
    expect(r.weapons.current).toBe('harrow');
    settle();
    r.tap('weapon1');
    expect(r.weapons.current).toBe('smg');
  });

  it('last weapon and the wheel still work', () => {
    r.tap('weapon1');
    settle();
    r.weapons.give('autocannon');
    r.tap('weapon4');
    settle();
    r.tap('weapon4');
    expect(r.weapons.current).toBe('autocannon');
    settle();
    r.tap('weaponLast');
    expect(r.weapons.current).toBe('sabot');
    settle();
    r.tap('weaponPrev');
    expect(r.weapons.current).toBe('rocket');
    settle();
    r.tap('weaponNext');
    expect(r.weapons.current).toBe('sabot');
    settle();
    r.tap('weaponPrev');
    settle();
    r.tap('weaponPrev');
    settle();
    r.tap('weaponPrev');
    expect(r.weapons.current).toBe('harrow');
  });

  it('ammo is per member', () => {
    r.tap('weapon1');
    settle();
    r.input.simulate('fire', true);
    r.run(0.5);
    r.input.simulate('fire', false);
    expect(r.weapons.ammo('harrow').mag).toBeLessThan(WEAPONS.harrow.magSize);
    expect(r.weapons.ammo('smg').mag).toBe(WEAPONS.smg.magSize);
    expect(r.weapons.ammo('smg').reserve).toBe(WEAPONS.smg.reserve);
  });

  it('the Harrow fires slower and harder than the SMG', () => {
    const d = r.enemies.add(0, -10);
    r.input.simulate('fire', true);
    r.run(1);
    r.input.simulate('fire', false);
    const smg = d.hits.length;
    const smgDamage = d.hits[0]!.amount;
    r.reset();
    const e = r.enemies.add(0, -10);
    r.tap('weapon1');
    settle();
    r.input.simulate('fire', true);
    r.run(1);
    r.input.simulate('fire', false);
    expect(smg).toBe(10);
    expect(e.hits.length).toBeGreaterThanOrEqual(6);
    expect(e.hits.length).toBeLessThanOrEqual(7);
    expect(e.hits[0]!.amount).toBeGreaterThan(smgDamage * 1.5);
    expect(e.hits.length * e.hits[0]!.amount).toBeGreaterThan(smg * smgDamage);
  });

  it('a dry gun hands over to its family member first, then down the list', () => {
    const dry = (id: WeaponId, mag = 0) => {
      const a = r.weapons.ammo(id);
      a.mag = mag;
      a.reserve = 0;
    };
    dry('smg', 1);
    r.input.simulate('fire', true);
    r.run(0.6);
    r.input.simulate('fire', false);
    expect(r.weapons.current).toBe('harrow');

    r.reset();
    dry('smg', 1);
    dry('harrow');
    const d = r.enemies.add(0, -10);
    r.input.simulate('fire', true);
    r.run(0.9);
    r.input.simulate('fire', false);
    expect(r.weapons.current).toBe('shotgun');
    // The finger never left the trigger: a semi-auto fires once on the hand-over and waits for a fresh click.
    expect(d.hits.filter(h => h.source === 'shotgun').length).toBe(WEAPONS.shotgun.pellets);

    // With the rotary cannon owned, which heads the list, a dry Harrow still hands over to the SMG on its own key.
    r.reset();
    r.weapons.give('buzzsaw');
    r.tap('weapon1');
    settle();
    expect(r.weapons.current).toBe('harrow');
    dry('harrow', 1);
    r.input.simulate('fire', true);
    r.run(0.6);
    r.input.simulate('fire', false);
    expect(r.weapons.current).toBe('smg');
  });

  it('what a gun fires and how its trigger works come from its row, not its name', () => {
    expect(WEAPONS.autocannon.round).toBe('shell');
    expect(WEAPONS.sabot.round).toBeUndefined();
    expect(WEAPONS.sabot.mode).toBe(WEAPONS.autocannon.mode);
    expect(WEAPONS.judge.headHops).toBe(2);
    expect(WEAPONS.rivet.headHops).toBeUndefined();
  });

  it('the scope belongs to the weapon data, so the Sabot has the autocannon\'s', () => {
    r.tap('weapon4');
    settle();
    expect(r.weapons.current).toBe('sabot');
    r.tap('aim');
    r.run(0.5);
    expect(r.weapons.scoped).toBe(true);
    r.tap('weapon1');
    expect(r.weapons.scoped).toBe(false);
  });
});
