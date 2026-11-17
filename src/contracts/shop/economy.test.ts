/**
 * Endless Humans' credit curve (shop/data.ts `ENDLESS_PAY`), walked break by break over the real wave sizes: poor for the first breaks,
 * a new gun by the fifth, two good guns and mods by the seventh, and the dearest gun within reach by the ninth, the last break before
 * the Commander's wave. Credits are what is left once the player has bought the resupplies they needed.
 */
import { describe, expect, it } from 'vitest';
import { FINAL_WAVE } from '../../enemies/commander/adaptations';
import { composeOutpostWave } from '../../enemies/outpost/doctrine';
import { BOUNTY } from '../defense/data';
import { killPayIn, modWares, SUPPLY_WARES, wavePayIn, weaponWares } from './data';

interface Player {
  /** Share of each wave's men they kill, and of those kills to the head. */
  kills: number;
  head: number;
  /** Prisoners a wave from wave 2 on, at a corporal's bounty. */
  captures: number;
  /** Resupplies a break from break 2 on. */
  resupply: number;
}

const { heal, armor } = SUPPLY_WARES;
const DECENT: Player = { kills: 0.85, head: 0.35, captures: 0.5, resupply: heal.price + armor.price / 2 };
const WEAK: Player = { kills: 0.8, head: 0.1, captures: 0, resupply: heal.price + armor.price };

/** Credits in hand at each break 1 to 9 (index 0 is break 1), for one of `team` players splitting the kills evenly. */
function curve(p: Player, team = 1): number[] {
  const out: number[] = [];
  let credits = 0;
  for (let wave = 1; wave < FINAL_WAVE; wave++) {
    const killed = (composeOutpostWave(wave, () => 0.5).flat().length * p.kills) / team;
    credits += killed * ((1 - p.head) * killPayIn('outpost', false) + p.head * killPayIn('outpost', true)) + wavePayIn('outpost', wave);
    if (wave >= 2) credits += p.captures * BOUNTY.regular - p.resupply;
    out.push(Math.round(credits));
  }
  return out;
}

const guns = weaponWares('outpost');
const mods = modWares('outpost');
const at = (c: number[], brk: number): number => c[brk - 1]!;
/** A good gun: 1400 and up, the Deuce to the Lance. */
const good = Object.values(guns).filter(w => w.price >= 1400);
const cheapestGood = Math.min(...good.map(w => w.price));
const dearest = Math.max(...Object.values(guns).map(w => w.price));

describe('Endless Humans credit curve', () => {
  it('a decent player: poor early, a gun by break 5, two good guns and mods by 7, the dearest gun by 9', () => {
    const c = curve(DECENT);
    // Breaks 1 to 3: a light, a cheap mod or a resupply, and the starter gun still.
    expect(at(c, 1)).toBeLessThan(guns.judge!.price);
    expect(at(c, 2)).toBeGreaterThanOrEqual(mods.harrowLight.price + mods.rivetHp.price);
    expect(at(c, 3)).toBeLessThan(cheapestGood);
    // Break 5: a first good gun, or a couple of mods.
    expect(at(c, 5)).toBeGreaterThanOrEqual(guns.sabot!.price + mods.harrowAp.price);
    // Break 7: two good guns and two mods for them.
    const seventh = guns.autocannon!.price + guns.sabot!.price + 2 * mods.harrowAp.price;
    expect(at(c, 7)).toBeGreaterThanOrEqual(seventh);
    // Break 9: after all that, the Piledriver too; or, saving from break 6, the Lance.
    expect(at(c, 9) - seventh).toBeGreaterThanOrEqual(guns.piledriver!.price);
    expect(at(c, 9) - at(c, 6)).toBeGreaterThanOrEqual(dearest);
    // and never the whole catalogue.
    expect(at(c, 9)).toBeLessThan(good.reduce((n, w) => n + w.price, 0));
  });

  it('a weak player who heals and plates every break still gets a good gun by break 5 and two by break 9', () => {
    const c = curve(WEAK);
    expect(Math.min(...c)).toBeGreaterThan(0);
    expect(at(c, 5)).toBeGreaterThanOrEqual(cheapestGood);
    expect(at(c, 9)).toBeGreaterThanOrEqual(2 * guns.sabot!.price);
  });

  it('four players splitting the kills each keep most of a solo purse: every player gets the whole wave pay', () => {
    expect(at(curve(DECENT, 4), 9)).toBeGreaterThan(0.6 * at(curve(DECENT), 9));
  });

  it('a capture pays far more than executing him', () => {
    for (const bounty of Object.values(BOUNTY)) expect(bounty).toBeGreaterThanOrEqual(8 * killPayIn('outpost', true));
  });
});
