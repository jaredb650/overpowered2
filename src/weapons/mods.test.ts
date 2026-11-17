/** Weapon mods (weapons-update plan section 10): what each one does to its gun, fitted, and that taking it off undoes it. */
import { beforeEach, describe, expect, it } from 'vitest';
import type { ModId, WeaponId } from '../core/gameplay';
import { AMMO, TUNING, WEAPONS } from './data';
import { ISSUED, MODS, moddedDef } from './mods';
import { makeRange, type Range } from './testkit';

let r: Range;
beforeEach(async () => {
  r = await makeRange();
  r.reset();
});

function draw(id: WeaponId): void {
  r.weapons.give(id);
  r.weapons.switchTo(id);
  r.run(0.6);
  expect(r.weapons.current).toBe(id);
}

/** Rounds the SMG puts out in a second of held fire, and every hit's damage on a body ahead. */
function burst(): { rounds: number; hits: number[] } {
  const body = r.enemies.add(0, -10);
  r.weapons.ammo('smg').mag = 30;
  r.input.simulate('fire', true);
  r.run(1);
  r.input.simulate('fire', false);
  r.run(0.1);
  return { rounds: 30 - r.weapons.ammo('smg').mag, hits: body.hits.map(h => h.amount) };
}

describe('the SMG suppressor', () => {
  it('is 100 rounds a minute faster and a tenth harder, from its own report', () => {
    const d = moddedDef('smg', new Set(['suppressor']));
    expect(60 / d.interval).toBeCloseTo(60 / WEAPONS.smg.interval + 100, 5);
    expect(d.damage).toBeCloseTo(WEAPONS.smg.damage * 1.1, 5);
    expect(d.muzzle).toBe('suppressed');

    draw('smg');
    const bare = burst();
    expect(r.record.sounds).toContain('smg_shot');
    r.reset();
    draw('smg');
    r.weapons.grantMod('suppressor');
    expect(r.weapons.fitMod('suppressor', true)).toBe(true);
    const quiet = burst();
    expect(r.record.sounds).toContain('smg_suppressed_shot');
    expect(r.record.sounds).not.toContain('smg_shot');
    // 800 to 900 a minute: about 13.3 to 15 rounds a second.
    expect(quiet.rounds).toBeGreaterThan(bare.rounds);
    expect(quiet.rounds - bare.rounds).toBeLessThanOrEqual(3);
    expect(Math.max(...quiet.hits)).toBeCloseTo(Math.max(...bare.hits) * 1.1, 3);
  });

  it('is not fitted until it is held, and comes off', () => {
    expect(r.weapons.fitMod('suppressor', true)).toBe(false);
    r.weapons.grantMod('suppressor');
    expect(r.weapons.fitMod('suppressor', true)).toBe(true);
    expect(r.weapons.fitMod('suppressor', false)).toBe(false);
    expect(r.weapons.mods.has('suppressor')).toBe(true);
    draw('smg');
    burst();
    expect(r.record.sounds).toContain('smg_shot');
  });

  it('goes with the run: a new one starts with only the issued mods (the Gimlet\'s)', () => {
    r.weapons.grantMod('suppressor');
    r.weapons.fitMod('suppressor', true);
    r.reset();
    expect([...r.weapons.mods]).toEqual([...ISSUED]);
    expect([...r.weapons.fitted]).toEqual([...ISSUED]);
    draw('smg');
    burst();
    expect(r.record.sounds).toContain('smg_shot');
  });
});

describe('Sabot Raufoss rounds', () => {
  it('fires a Raufoss round with no right click, and its scope is still its right click', () => {
    expect(MODS.raufoss.weapon).toBe('sabot');
    expect(WEAPONS.sabot.scope).toBe(true);
    r.wall(-8, 0.3);
    const behind = r.enemies.add(0, -12);
    draw('sabot');
    r.weapons.grantMod('raufoss');
    r.weapons.fitMod('raufoss', true);
    expect(r.weapons.ammoMode).toBe('RAUFOSS');
    r.tap('fire');
    expect(r.combat.bursts.stats.bursts).toBe(1);
    expect(r.record.sounds).toContain('raufoss_detonation');
    expect(behind.hits.length).toBe(TUNING.raufoss.pellets);
    for (const h of behind.hits) expect(h.amount).toBeCloseTo(WEAPONS.sabot.damage * TUNING.raufoss.share, 5);
  });

  it('without it the dart goes through the wall as it always has', () => {
    r.wall(-8, 0.3);
    draw('sabot');
    r.tap('fire');
    expect(r.combat.bursts.stats.bursts).toBe(0);
    expect(r.record.sounds).not.toContain('raufoss_detonation');
    expect(r.weapons.ammoMode).toBe('');
  });
});

describe('the red dot', () => {
  it('belongs to the Harrow and changes nothing it fires', () => {
    expect(MODS.reddot.weapon).toBe('harrow');
    expect(moddedDef('harrow', new Set(['reddot']))).toEqual(WEAPONS.harrow);
  });
});

describe('AP and HP rounds', () => {
  it('a gun takes one kind of round, beside its optic and its can: a suppressed AP Gimlet', () => {
    const w = r.weapons;
    for (const id of ['gimletAp', 'gimletHp'] as const) w.grantMod(id);
    expect(w.fitMod('gimletAp', true)).toBe(true);
    expect([...w.fitted].sort()).toEqual(['gimletAcog', 'gimletAp', 'gimletCan', 'smgLight']);
    expect(w.fitMod('gimletHp', true)).toBe(true);
    expect(w.fitted.has('gimletAp')).toBe(false);
    expect([...w.fitted].sort()).toEqual(['gimletAcog', 'gimletCan', 'gimletHp', 'smgLight']);
    expect(MODS.gimletHp.slot).toBe('ammo');
  });

  it('every round carries its load to the body, wears its tracer, and the HUD calls it', () => {
    const body = r.enemies.add(0, -10);
    draw('rivet');
    r.weapons.grantMod('rivetAp');
    r.weapons.fitMod('rivetAp', true);
    expect(r.weapons.ammoMode).toBe('AP');
    r.tap('fire');
    expect(body.hits[0]!.load).toBe('ap');
    expect(body.hits[0]!.amount).toBeCloseTo(WEAPONS.rivet.damage * AMMO.ap.flesh, 5);
    expect(r.record.tracers.some(t => t.kind === 'ap')).toBe(true);
    r.weapons.fitMod('rivetAp', false);
    expect(r.weapons.ammoMode).toBe('');
  });

  it('the Gimlet\'s bursts keep the round on the HUD', () => {
    draw('gimlet');
    r.weapons.grantMod('gimletHp');
    r.weapons.fitMod('gimletHp', true);
    expect(r.weapons.ammoMode).toBe('HP');
    r.input.simulate('reload', true);
    r.run(WEAPONS.gimlet.select!.hold + 0.1);
    r.input.simulate('reload', false);
    r.run(0.05);
    expect(r.weapons.ammoMode).toBe('HP · BURST');
  });

  /** Bodies a Harrow round strikes in a line of three, 3 m apart. */
  function line(mod: ModId | null): number {
    r.reset();
    const bodies = [r.enemies.add(0, -8), r.enemies.add(0, -11), r.enemies.add(0, -14)];
    draw('harrow');
    if (mod) {
      r.weapons.grantMod(mod);
      r.weapons.fitMod(mod, true);
    }
    r.tap('fire');
    return bodies.filter(b => b.hits.length > 0).length;
  }

  it('on the Harrow, HP stays in the first man, ball goes through one, AP through two', () => {
    expect(line('harrowHp')).toBe(1);
    expect(line(null)).toBe(2);
    expect(line('harrowAp')).toBe(3);
  });
});
