import { describe, expect, it } from 'vitest';
import { CONTRACTS } from '../../contracts/data';
import { CAMPAIGN, SURVIVAL_MAPS, modeName, modesOn } from './mainmenu';

describe('the main menu tree', () => {
  it('lists the missions in order under Campaign', () => {
    expect(CAMPAIGN.map(c => c.id)).toEqual(['campaign', 'foreclosure']);
  });

  it('puts each survival mode under its map', () => {
    expect(SURVIVAL_MAPS.map(({ name, map }) => [name, modesOn(map).map(c => c.id)])).toEqual([
      ['Crucible', ['crucible']],
      ['Kill House', ['outpost']],
      ['Outpost', ['defense']],
      ['Office', ['crucible', 'outpost']],
    ]);
  });

  it('names modes as modes, so the Crucible under Office never reads as a map', () => {
    expect(modesOn('office').map(modeName)).toEqual(['Crucible mode', 'Endless Humans mode']);
  });

  it('reaches every contract, so a new row cannot fall off the menu', () => {
    const reached = [...CAMPAIGN, ...SURVIVAL_MAPS.flatMap(({ map }) => modesOn(map))];
    expect([...new Set(reached.map(c => c.id))].sort()).toEqual(CONTRACTS.map(c => c.id).sort());
  });
});
