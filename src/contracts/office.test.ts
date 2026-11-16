/** The Office plays both survival modes: each resolves there, ranked, with its own notice and its own record. */
import { describe, expect, it } from 'vitest';
import { validMatch } from '../net/lobby';
import { CONTRACTS } from './data';
import { scoreKeyOf } from './scores';
import { contractSearch, pickContract, playsOn } from './select';

const byId = (id: string) => CONTRACTS.find(c => c.id === id)!;

describe('the Office', () => {
  it('runs the Crucible and Endless Humans there, ranked, with their own rules', () => {
    for (const id of ['crucible', 'outpost']) {
      const a = pickContract(id, 'office');
      expect(a.def.id).toBe(id);
      expect(a.map).toBe('office');
      expect(a.ranked).toBe(true);
      expect(a.def.alsoOn?.office?.ref).toMatch(/^Form 774\d-O$/);
    }
    // Rules that do not play there stay unranked, as on any borrowed map.
    expect(pickContract('defense', 'office').ranked).toBe(false);
    expect(playsOn(byId('defense'), 'office')).toBe(false);
  });

  it('takes the Crucible for a bare ?map=office, and leaves the other maps as they were', () => {
    expect(pickContract(null, 'office').def.id).toBe('crucible');
    expect(pickContract(null, 'killhouse').def.id).toBe('outpost');
    expect(pickContract('crucible', 'killhouse').ranked).toBe(false);
    expect(pickContract(null, null).map).toBe('crucible');
  });

  it('keeps a separate record per map, and the old keys where they were', () => {
    expect(scoreKeyOf(byId('crucible'))).toBe('op2_highscore');
    expect(scoreKeyOf(byId('crucible'), 'office')).toBe('op2_highscore.office');
    expect(scoreKeyOf(byId('outpost'), 'office')).toBe('op2_highscore.outpost.office');
    expect(scoreKeyOf(byId('outpost'), 'killhouse')).toBe('op2_highscore.outpost');
  });

  it('carries the map in the menu and co-op hand-offs', () => {
    const q = new URLSearchParams(contractSearch('outpost', '?dev=1&map=killhouse', 'office'));
    expect([q.get('contract'), q.get('map'), q.get('dev')]).toEqual(['outpost', 'office', '1']);
    expect(new URLSearchParams(contractSearch('outpost', '?map=office', 'killhouse')).has('map')).toBe(false);
    expect(validMatch({ id: 'a1', mode: 'crucible', map: 'office' })).toBe(true);
    expect(validMatch({ id: 'a1', mode: 'crucible', map: 'crucible' })).toBe(false);
    expect(validMatch({ id: 'a1', mode: 'outpost' })).toBe(true);
  });
});
