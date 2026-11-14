import { describe, expect, it } from 'vitest';
import { WEAPONS } from '../weapons/data';
import { armourHit, classOf } from './damage';

/** A Trooper in the campaign: 70 health, a helmet of 0.3 of it. */
const HELMET = 0.3 * 70;

describe('one armour rule, by the class of the round', () => {
  it('sorts the guns the way the plan says', () => {
    for (const id of ['smg', 'rivet', 'buzzsaw'] as const) expect(classOf(id, WEAPONS[id].damage), id).toBe('light');
    for (const id of ['harrow', 'judge'] as const) expect(classOf(id, WEAPONS[id].damage), id).toBe('medium');
    for (const id of ['piledriver', 'stakegun'] as const) expect(classOf(id, WEAPONS[id].damage), id).toBe('heavy');
    // Anything that is not a gun of the player's goes by weight.
    expect(classOf('sword', 75)).toBe('heavy');
    expect(classOf('door_gun', 13)).toBe('light');
  });

  it('a helmet saves a man from the SMG for two rounds, and from a rifle once', () => {
    let hp = HELMET;
    const smg = WEAPONS.smg.damage;
    let hits = 0;
    while (hp > 0) {
      const { wear, through } = armourHit('light', hp, smg, smg * 2);
      expect(through).toBe(0);
      hp -= wear;
      hits++;
    }
    expect(hits).toBe(2);
    const rifle = armourHit('medium', HELMET, WEAPONS.harrow.damage, WEAPONS.harrow.damage * 2);
    expect(rifle.through).toBe(0);
    expect(HELMET - rifle.wear).toBeLessThanOrEqual(0);
  });

  it('a heavy round always gets half through, and a shredder wears twice as hard', () => {
    const round = WEAPONS.piledriver.damage;
    const once = armourHit('heavy', 1000, round, round);
    expect(once.through).toBe(round / 2);
    expect(armourHit('heavy', 1000, round, round, 2).wear).toBe(once.wear * 2);
  });
});
