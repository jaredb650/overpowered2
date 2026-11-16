/** Weapon families: what a number key, the wheel and Q draw. Every weapon is its own unlock: nothing comes with a base. */
import { beforeEach, describe, expect, it } from 'vitest';
import type { WeaponId } from '../core/gameplay';
import { CACHE_ORDER } from '../progression/data';
import { STARTING_WEAPONS, TUNING, WEAPONS, WEAPON_ORDER } from './data';
import { SLOT_ORDER, familyOf, familyOfSlot, inPlay, membersOf, pressSlot, wheelSlot } from './families';
import { makeRange, type Range } from './testkit';

const all = new Set<WeaponId>(WEAPON_ORDER);

describe('family table', () => {
  it('groups by number key, base first', () => {
    expect(familyOfSlot(1)).toEqual(['smg', 'gimlet', 'harrow']);
    expect(familyOfSlot(2)).toEqual(['shotgun', 'thresher', 'deuce']);
    expect(familyOfSlot(3)).toEqual(['rocket', 'quiver']);
    // The Sabot is first on key 4: the explosive autocannon is its upgrade.
    expect(familyOfSlot(4)).toEqual(['sabot', 'awl', 'autocannon']);
    expect(familyOfSlot(6)).toEqual(['judge', 'rivet', 'ultramag', 'autoraffica']);
    // Key 5: the katana alone. The four swung beside it are switched off (`?melee=four` brings them back).
    expect(familyOfSlot(5)).toEqual(['sword']);
    for (const id of ['knife', 'crowbar', 'shovel', 'baton'] as WeaponId[]) expect(inPlay(id), id).toBe(false);
    expect(inPlay('sword')).toBe(true);
    expect(familyOf('harrow')).toEqual(['smg', 'gimlet', 'harrow']);
  });

  it('every weapon in play is on exactly one key, and every member names a base on the same key', () => {
    const seen = SLOT_ORDER.flatMap(slot => familyOfSlot(slot));
    expect([...seen].sort()).toEqual(WEAPON_ORDER.filter(inPlay).sort());
    expect(new Set(seen).size).toBe(seen.length);
    for (const id of WEAPON_ORDER) {
      const base = WEAPONS[id].base;
      if (base) expect(WEAPONS[base].slot, id).toBe(WEAPONS[id].slot);
    }
    expect(membersOf('smg')).toEqual(['gimlet', 'harrow']);
    expect(membersOf('judge')).toEqual(['rivet', 'ultramag', 'autoraffica']);
    expect(membersOf('shotgun')).toEqual(['thresher', 'deuce']);
    expect(membersOf('rocket')).toEqual(['quiver']);
    // The autocannon is earned on its own, from a weapon cache: owning the Sabot does not bring it.
    expect(membersOf('sabot')).toEqual(['awl']);
    expect(WEAPONS.autocannon.base).toBeUndefined();
    expect(membersOf('sword')).toEqual([]);
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
    expect(pressSlot(1, 'smg', all, undefined)).toBe('gimlet');
    expect(pressSlot(1, 'gimlet', all, undefined)).toBe('harrow');
    expect(pressSlot(1, 'harrow', all, undefined)).toBe('smg');
    expect(pressSlot(2, 'shotgun', all, undefined)).toBe('thresher');
    expect(pressSlot(4, 'sabot', all, undefined)).toBe('awl');
    expect(pressSlot(4, 'awl', all, undefined)).toBe('autocannon');
    expect(pressSlot(4, 'autocannon', all, undefined)).toBe('sabot');
    // The katana alone: key 5 again does nothing, even with the four owned.
    expect(pressSlot(5, 'sword', all, undefined)).toBeNull();
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
    r.weapons.setLoadout(['smg', 'harrow', 'shotgun', 'thresher', 'rocket', 'quiver', 'sabot', 'sword'], 0);
  });
  const settle = () => r.run(0.4);

  it('a run starts with one weapon per key, not the rest of each family', () => {
    r.reset();
    expect([...r.weapons.owned].sort()).toEqual(['rivet', 'shotgun', 'smg', 'sword']);
    expect(r.weapons.owned.has('autocannon')).toBe(false);
  });

  it('a pickup gives that weapon only, never the rest of its key', () => {
    // A rack, a drop pod, a cache and the Outpost's shop all hand a weapon over through give.
    const pairs: [WeaponId, WeaponId][] = [['shotgun', 'thresher'], ['rocket', 'quiver'], ['smg', 'harrow'], ['judge', 'rivet'], ['buzzsaw', 'piledriver'], ['shotgun', 'deuce'], ['judge', 'ultramag'], ['judge', 'autoraffica']];
    for (const [base, member] of pairs) {
      r.weapons.setLoadout(['sword'], 0);
      r.weapons.give(base);
      expect(r.weapons.owned.has(base), base).toBe(true);
      expect(r.weapons.owned.has(member), `${base} brought ${member}`).toBe(false);
      // A second one of the same is ammo for it, not the member.
      r.weapons.give(base);
      expect(r.weapons.owned.has(member), member).toBe(false);
      r.weapons.give(member);
      expect(r.weapons.owned.has(member), member).toBe(true);
      expect(r.weapons.ammo(member).mag).toBe(WEAPONS[member].magSize);
    }
  });

  it('a mission loadout brings what it names and nothing else', () => {
    r.weapons.setLoadout(['smg', 'shotgun'], 0);
    expect([...r.weapons.owned].sort()).toEqual(['shotgun', 'smg']);
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

  it('each autocannon shell shoves the player back along the shot: all of it in the air, along the floor on the ground', () => {
    const t = TUNING.autocannon;
    r.weapons.give('autocannon');
    r.weapons.switchTo('autocannon');
    r.run(0.6);
    const P = r.player;
    const shoot = () => {
      P.velocity.set(0, 0, 0);
      r.tap('fire');
      r.run(1 / 60);
      const v = P.velocity.clone();
      r.run(0.5);
      return v;
    };
    // Aimed down and ahead, as at the floor in front of you.
    P.forward.set(0, -Math.SQRT1_2, -Math.SQRT1_2);
    P.grounded = false;
    const air = shoot();
    expect(air.y).toBeCloseTo(t.push * Math.SQRT1_2, 5);
    expect(air.z).toBeCloseTo(t.push * Math.SQRT1_2, 5);
    P.grounded = true;
    const ground = shoot();
    expect(ground.y).toBe(0);
    expect(ground.z).toBeCloseTo(t.push * t.groundPush * Math.SQRT1_2, 5);
    P.forward.set(0, 0, -1);
  });

  it('the Deuce and the Ultramag are each their own unlock, from a cache of their own', () => {
    for (const id of ['deuce', 'ultramag'] as WeaponId[]) {
      expect(STARTING_WEAPONS, id).not.toContain(id);
      expect(r.weapons.owned.has(id), id).toBe(false);
      expect(CACHE_ORDER.filter(c => c === id), id).toHaveLength(1);
      r.weapons.give(id);
      expect(r.weapons.owned.has(id), id).toBe(true);
    }
    // Each came alone: the Judge and the Rivet are not owned for the Ultramag's cache.
    expect(r.weapons.owned.has('judge')).toBe(false);
    expect(r.weapons.owned.has('rivet')).toBe(false);
  });

  it('the Deuce fires one barrel on a left click and both at once on a right click, then shoves the player back', () => {
    const d = WEAPONS.deuce;
    const two = d.altBoth!;
    r.weapons.give('deuce');
    r.weapons.switchTo('deuce');
    r.run(0.6);
    expect(r.weapons.current).toBe('deuce');
    let pellets = 0;
    const fire = r.combat.fireRay.bind(r.combat);
    r.combat.fireRay = (...args: Parameters<typeof fire>) => { pellets++; return fire(...args); };
    const P = r.player;
    const pull = (button: 'fire' | 'aim') => {
      pellets = 0;
      r.record.sounds.length = 0;
      P.velocity.set(0, 0, 0);
      r.tap(button);
      r.run(1 / 60);
      return P.velocity.clone();
    };

    // One barrel: one shell, one shot's pellets, no shove.
    const one = pull('fire');
    expect(pellets).toBe(d.pellets);
    expect(r.weapons.ammo('deuce').mag).toBe(1);
    expect(r.record.sounds.filter(id => id === 'dbshotgun_shot')).toHaveLength(1);
    expect(one.length()).toBe(0);
    // With one shell left, a right click fires the one; empty, it breaks open and reloads by itself.
    r.run(d.interval + 0.05);
    pull('aim');
    expect(pellets).toBe(d.pellets);
    expect(r.weapons.ammo('deuce').mag).toBe(0);
    r.run(d.reloadTime + 0.5);
    expect(r.weapons.ammo('deuce').mag).toBe(2);

    // Both: both shells, twice the pellets, the shot heard twice, and a shove back along the aim.
    P.forward.set(0, 0, -1);
    P.grounded = false;
    const both = pull('aim');
    expect(pellets).toBe(d.pellets * 2);
    expect(r.weapons.ammo('deuce').mag).toBe(0);
    expect(r.record.sounds.filter(id => id === 'dbshotgun_shot')).toHaveLength(2);
    expect(both.z).toBeCloseTo(two.push, 5);
    P.grounded = true;
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
    r.weapons.give('harrow');
    const e = r.enemies.add(0, -10);
    r.tap('weapon1');
    settle();
    r.input.simulate('fire', true);
    r.run(1);
    r.input.simulate('fire', false);
    // 800 a minute, give or take the round on the first frame.
    expect(Math.abs(smg - 1 / WEAPONS.smg.interval)).toBeLessThanOrEqual(1);
    // 500 a minute.
    expect(Math.abs(e.hits.length - 1 / WEAPONS.harrow.interval)).toBeLessThanOrEqual(1);
    expect(e.hits.length).toBeLessThan(smg);
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
    r.weapons.give('harrow');
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
    // The Judge's headshot ricochet is off, for the fanning that replaces it.
    expect(WEAPONS.judge.headHops).toBeUndefined();
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
