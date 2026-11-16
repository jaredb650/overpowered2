import { describe, expect, it } from 'vitest';
import type { ModId, WeaponId } from '../core/gameplay';
import { AMMO, WEAPONS } from '../weapons/data';
import { AMMO_GUNS, moddedDef } from '../weapons/mods';
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

describe('AP and HP rounds (weapons-update plan section 12)', () => {
  /** A fresh plate bigger than any one round, so nothing breaks it and only the class decides. */
  const PLATE = 1000;
  const ball = (id: WeaponId) => armourHit(classOf(id, WEAPONS[id].damage), PLATE, WEAPONS[id].damage, WEAPONS[id].damage);

  it('AP loses a fifth on flesh, gets most of itself through a plate, and goes one body further', () => {
    for (const id of AMMO_GUNS) {
      const ap = moddedDef(id, new Set([`${id}Ap` as ModId]));
      expect(ap.load, id).toBe('ap');
      expect(ap.damage, id).toBeCloseTo(WEAPONS[id].damage * AMMO.ap.flesh, 6);
      expect(ap.penetration, id).toBeCloseTo(WEAPONS[id].penetration + AMMO.ap.penetration, 6);
      const hit = armourHit(classOf(id, ap.damage), PLATE, ap.damage, ap.damage, 1, ap.load);
      // Ball is stopped by a plate on every one of these guns; AP is not, on any.
      expect(ball(id).through, id).toBe(0);
      expect(hit.through, id).toBeCloseTo(WEAPONS[id].damage * AMMO.ap.flesh * AMMO.ap.plate, 6);
      expect(hit.wear, id).toBe(ap.damage);
    }
  });

  it('HP does half again to flesh, nothing through a plate, barely marks it, and stays in the first body', () => {
    for (const id of AMMO_GUNS) {
      const hp = moddedDef(id, new Set([`${id}Hp` as ModId]));
      expect(hp.damage, id).toBeCloseTo(WEAPONS[id].damage * AMMO.hp.flesh, 6);
      expect(hp.penetration, id).toBe(0);
      const hit = armourHit(classOf(id, hp.damage), PLATE, hp.damage, hp.damage, 1, hp.load);
      expect(hit.through, id).toBe(0);
      // Less wear than the ball round does to the same plate: a light round's half, or a medium round's whole plate.
      expect(hit.wear, id).toBeLessThan(ball(id).wear);
      expect(hit.wear, id).toBeCloseTo(hp.damage * AMMO.hp.wear, 6);
    }
  });

  it('on the Harrow, AP is not its rifle-class ball: ball wrecks a helmet for nothing, AP kills through it', () => {
    const trooper = 70;
    const ballHit = armourHit('medium', HELMET, WEAPONS.harrow.damage, WEAPONS.harrow.damage * 2);
    expect(ballHit.through).toBe(0);
    const ap = moddedDef('harrow', new Set<ModId>(['harrowAp']));
    const apHit = armourHit('medium', HELMET, ap.damage, ap.damage * 2, 1, 'ap');
    expect(apHit.through).toBeGreaterThanOrEqual(trooper * 0.85);
    // And on a plate too big to wreck, ball is stopped every time; AP is 30 a round through it.
    expect(armourHit('medium', 1000, ap.damage, ap.damage, 1, 'ap').through).toBeCloseTo(30, 6);
  });

  it('a medium gun with HP no longer wrecks the plate it hits', () => {
    for (const id of ['harrow', 'judge', 'ultramag'] as const) {
      const hp = moddedDef(id, new Set([`${id}Hp` as ModId]));
      expect(armourHit('medium', HELMET * 3, hp.damage, hp.damage, 1, 'hp').wear, id).toBeLessThan(HELMET * 3);
    }
  });
});
