/**
 * The katana's energy blade (ENERGY), on the real Weapons and Combat as melee.test.ts runs them: faster swings, a longer dash
 * and stab, kills that slice and vaporize, plates gone through, and the shop's row.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { FINAL_WAVE } from '../../enemies/commander/adaptations';
import { MOD_WARES, modWares } from '../../contracts/shop/data';
import { MOVE } from '../../player/tuning';
import { WEAPONS } from '../data';
import { MODS, MOD_ORDER } from '../mods';
import { makeRange, type Dummy, type Range } from '../testkit';
import { ENERGY, KATANA, MELEE } from './data';

let r: Range;
const swings: { move: string; seconds: number }[] = [];

beforeAll(async () => {
  r = await makeRange();
  r.ctx.viewmodel.swing = ((move: string, seconds: number) => swings.push({ move, seconds })) as never;
});

/** Draws the katana, with the energy blade fitted or not, and waits out the draw. */
function hold(energy: boolean): void {
  r.reset();
  r.player.position.set(0, 0, 0);
  r.player.eye.set(0, 1.6, 0);
  r.player.forward.set(0, 0, -1);
  r.player.velocity.set(0, 0, 0);
  r.weapons.give('sword');
  r.weapons.grantMod('swordEnergy');
  r.weapons.fitMod('swordEnergy', energy);
  r.weapons.switchTo('sword');
  r.run(0.5);
  swings.length = 0;
}

const ahead = (surface: number, x = 0): Dummy => r.enemies.add(x, -(surface + 0.35));

function walk(seconds: number, fps = 60): void {
  for (let i = 0; i < Math.round(seconds * fps); i++) {
    r.run(1 / fps, fps);
    const v = r.player.velocity;
    const speed = Math.hypot(v.x, v.z);
    if (speed > 0) v.multiplyScalar(Math.max(0, speed - MOVE.stopDecel / fps) / speed);
    r.player.position.addScaledVector(v, 1 / fps);
    r.player.eye.set(r.player.position.x, 1.6, r.player.position.z);
  }
}

function click(action: 'fire' | 'aim' = 'fire'): void {
  r.input.simulate(action, true);
  r.run(1 / 60);
  r.input.simulate(action, false);
}

describe('energy blade', () => {
  it('is the katana\'s mod, sold late enough and by the break after wave 9 in Endless Humans', () => {
    expect(MODS.swordEnergy.weapon).toBe('sword');
    expect(MOD_ORDER).toContain('swordEnergy');
    expect(MOD_WARES.swordEnergy.price).toBeGreaterThan(1000);
    expect(MOD_WARES.swordEnergy.lore.length).toBeGreaterThan(40);
    expect(modWares('outpost').swordEnergy.wave).toBeLessThanOrEqual(FINAL_WAVE - 1);
  });

  it('swings faster by ENERGY.speed, a clear 35 to 50 percent', () => {
    expect(ENERGY.speed).toBeGreaterThanOrEqual(1.35);
    expect(ENERGY.speed).toBeLessThanOrEqual(1.5);
    hold(false);
    click();
    const plain = swings[0]!.seconds;
    hold(true);
    click();
    expect(swings[0]!.move).toBe('light1');
    expect(plain / swings[0]!.seconds).toBeCloseTo(ENERGY.speed, 5);
    // The stab too.
    hold(true);
    click('aim');
    expect(swings[0]!.seconds).toBeCloseTo(KATANA.stab.seconds / ENERGY.speed, 5);
  });

  it('chains on the shorter window: a slash past it starts the chain again', () => {
    const window = MELEE.sword.comboWindow / ENERGY.speed;
    hold(true);
    click();
    walk(window - 0.08);
    click();
    expect(r.weapons.swordStep).toBe(2);
    hold(true);
    click();
    walk(window + 0.05);
    expect(r.weapons.swordStep).toBe(0);
  });

  it('stabs ENERGY.thrust further', () => {
    // Past the steel stab and its step, inside the energy one's.
    const at = KATANA.stab.reach + MELEE.sword.step + ENERGY.thrust * 0.5;
    hold(false);
    const plain = ahead(at);
    click('aim');
    walk(0.3);
    expect(plain.hits.length).toBe(0);
    hold(true);
    const lit = ahead(at);
    click('aim');
    walk(0.3);
    expect(lit.hits.length).toBe(1);
    expect(lit.hits[0]!.source).toBe('sword_stab');
  });

  it('dashes out of a run from ENERGY.reach times as far, and lands the cut', () => {
    const at = KATANA.dash.range * 1.15;
    expect(at + 0.35).toBeLessThan(KATANA.dash.range * ENERGY.reach);
    hold(false);
    const plain = ahead(at);
    r.player.velocity.set(0, 0, -12.5);
    click();
    expect(-r.player.velocity.z).toBeLessThan(13);
    walk(0.4);
    expect(plain.hits.length).toBe(0);

    hold(true);
    const lit = ahead(at);
    r.player.velocity.set(0, 0, -12.5);
    click();
    expect(-r.player.velocity.z).toBeGreaterThan(30);
    walk(0.4);
    expect(lit.hits.length).toBe(1);
    // It sheds the extra speed on arrival: the player ends in front of him, not past him.
    expect(-r.player.position.z).toBeLessThan(at + 0.35);
  });

  it('a slash kill slices and sets the dissolve flag; the plain katana\'s does not', () => {
    hold(false);
    const plain = ahead(1.8);
    click();
    expect(plain.hits[0]!.slicePlaneNormal).toBeDefined();
    expect(plain.hits[0]!.vaporize).toBeUndefined();

    hold(true);
    const lit = ahead(1.8);
    click();
    const h = lit.hits[0]!;
    expect(h.slicePlaneNormal).toBeDefined();
    expect(h.vaporize).toBe(true);
    expect(h.amount).toBe(WEAPONS.sword.damage);
  });

  it('cuts through a plate the steel blade is stopped by', () => {
    hold(false);
    const plain = ahead(1.8);
    plain.armor = 100;
    click();
    expect(plain.hits[0]!.pierces).toBeFalsy();

    hold(true);
    const lit = ahead(1.8);
    lit.armor = 100;
    click();
    expect(lit.hits[0]!.pierces).toBe(true);
    expect(lit.hits[0]!.amount).toBeCloseTo(WEAPONS.sword.damage * ENERGY.armour.direct, 5);
  });
});
