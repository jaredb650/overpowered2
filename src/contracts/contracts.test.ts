import { describe, expect, it } from 'vitest';
import { CONTRACTS, DEFAULT_CONTRACT, SONAR } from './data';
import { isPlayerWeapon } from './rewards';
import { contractSearch, pickContract } from './select';
import { sonarCooldown } from './sonar';

describe('contract table', () => {
  it('keeps ids and score tables apart', () => {
    expect(new Set(CONTRACTS.map(c => c.id)).size).toBe(CONTRACTS.length);
    expect(new Set(CONTRACTS.map(c => c.scoreKey)).size).toBe(CONTRACTS.length);
  });

  it('leaves the record set before contracts existed with the swarm game', () => {
    expect(DEFAULT_CONTRACT.id).toBe('crucible');
    expect(DEFAULT_CONTRACT.scoreKey).toBe('op2_highscore');
  });

  it('gives every contract a whole notice', () => {
    for (const c of CONTRACTS) {
      expect(c.briefing.body.length).toBeGreaterThan(0);
      expect(c.briefing.terms.length).toBeGreaterThan(0);
      expect(c.briefing.subject).not.toBe('');
    }
  });

  it('keeps the swarm game free of the Outpost rules', () => {
    expect(DEFAULT_CONTRACT).toMatchObject({ waves: 'swarm', ai: 'swarm', wounds: 'limbs', rewards: { backShot: 1 } });
  });
});

describe('picking a contract', () => {
  it('defaults to The Crucible on its own map', () => {
    expect(pickContract(null, null)).toEqual({ def: DEFAULT_CONTRACT, map: 'crucible', ranked: true });
  });

  it('honours ?contract=', () => {
    const picked = pickContract('outpost', null);
    expect(picked.def.id).toBe('outpost');
    expect(picked.map).toBe('killhouse');
    expect(picked.ranked).toBe(true);
  });

  it('reads ?map=killhouse as the contract that plays there', () => {
    expect(pickContract(null, 'killhouse')).toMatchObject({ map: 'killhouse', ranked: true, def: { id: 'outpost' } });
  });

  it('keeps ?map=range on the default rules, off the score table', () => {
    expect(pickContract(null, 'range')).toEqual({ def: DEFAULT_CONTRACT, map: 'range', ranked: false });
  });

  it('runs a contract on a map it does not own, unranked', () => {
    expect(pickContract('crucible', 'killhouse')).toEqual({ def: DEFAULT_CONTRACT, map: 'killhouse', ranked: false });
  });

  it('ignores what is not a map or a contract, such as the movement sandbox\'s ?map=1', () => {
    expect(pickContract('nonsense', '1')).toEqual({ def: DEFAULT_CONTRACT, map: 'crucible', ranked: true });
  });
});

describe('moving between contracts', () => {
  it('keeps dev flags and drops what pinned the old page', () => {
    const next = new URLSearchParams(contractSearch('outpost', '?dev=1&map=range&autostart=1'));
    expect(next.get('contract')).toBe('outpost');
    expect(next.get('deploy')).toBe('1');
    expect(next.get('dev')).toBe('1');
    expect(next.has('map')).toBe(false);
    expect(next.has('autostart')).toBe(false);
  });
});

describe('back shots', () => {
  it('pay for the player\'s own weapons only', () => {
    for (const source of ['smg', 'judge', 'sword', 'sword_finisher']) expect(isPlayerWeapon(source)).toBe(true);
    for (const source of ['trooper', 'sentinel', 'airstrike', 'burn']) expect(isPlayerWeapon(source)).toBe(false);
  });
});

describe('sonar cooldown', () => {
  it('drops once few enough enemies are left', () => {
    expect(sonarCooldown(SONAR.lastEnemies + 1)).toBe(SONAR.cooldown);
    expect(sonarCooldown(SONAR.lastEnemies)).toBe(SONAR.lastCooldown);
    expect(sonarCooldown(0)).toBe(SONAR.lastCooldown);
  });
});
