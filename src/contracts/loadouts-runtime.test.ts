import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe.each([
  '?contract=crucible&starter=gimlet', '?contract=outpost&starter=smg', '?contract=crucible&starter=harrow',
  '?contract=crucible', '?contract=outpost', '?contract=outpost&families=0', '?contract=crucible&slot4=old', '?map=range',
  '?contract=defense', '?contract=campaign', '?contract=foreclosure', '?map=killhouse',
])('runtime start on %s', search => {
  it('equips and resets the actual issued kit, with only one member on each key', async () => {
    vi.stubGlobal('location', { search });
    const { makeRange } = await import('../weapons/testkit');
    const { ACTIVE } = await import('./select');
    const { survivalLoadout } = await import('./loadouts');
    const { WEAPONS } = await import('../weapons/data');
    const { WEAPON_WARES } = await import('./shop/data');
    const { listedWeapons, issued } = await import('./shop/rules');
    const start = survivalLoadout(ACTIVE.def.id);
    const range = await makeRange();
    expect([...range.weapons.owned]).toEqual(start);
    expect(range.weapons.current).toBe(start[0]);
    if (start.includes('gimlet')) expect([...range.weapons.fitted]).toEqual(expect.arrayContaining(['gimletAcog', 'gimletCan']));
    expect([...range.weapons.fitted]).toContain('smgLight');
    expect(new Set(start.map(id => WEAPONS[id].slot)).size).toBe(start.length);
    expect(listedWeapons().filter(id => issued(WEAPON_WARES[id]!)).sort()).toEqual([...start].sort());
    range.tap('weapon1');
    range.run(0.4);
    range.tap('weapon1');
    expect(range.weapons.current).toBe(start[0]);
    if (start.includes('gimlet')) expect([...range.weapons.fitted]).toEqual(expect.arrayContaining(['gimletAcog', 'gimletCan']));
    expect([...range.weapons.fitted]).toContain('smgLight');
    // A campaign checkpoint swaps the guns, never the mods.
    range.weapons.setLoadout(['smg', 'shotgun'], 0);
    expect([...range.weapons.fitted]).toContain('smgLight');
    range.weapons.give('quiver');
    range.reset();
    expect([...range.weapons.owned]).toEqual(start);
    expect(range.weapons.current).toBe(start[0]);
    if (start.includes('gimlet')) expect([...range.weapons.fitted]).toEqual(expect.arrayContaining(['gimletAcog', 'gimletCan']));
    expect([...range.weapons.fitted]).toContain('smgLight');
  });
});

it('keeps the cheat panel Give all weapons action unrestricted', async () => {
  const { Lab } = await import('../lab');
  const { makeRange } = await import('../weapons/testkit');
  const { WEAPON_ORDER } = await import('../weapons/data');
  const { inPlay } = await import('../weapons/families');
  const range = await makeRange();
  const lab = Object.assign(Object.create(Lab.prototype), { ctx: range.ctx }) as InstanceType<typeof Lab>;
  lab.giveAll();
  expect([...range.weapons.owned].sort()).toEqual(WEAPON_ORDER.filter(inPlay).sort());
});
