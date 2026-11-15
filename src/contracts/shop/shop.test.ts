/** The Crucible's shop (weapons-update plan section 10): what kills pay, what each wave lets out, and what buying hands over. */
import { beforeEach, describe, expect, it } from 'vitest';
import type { Ctx } from '../../core/contracts';
import type { EnemyInstance, KillEvent, WavePhase, WeaponId } from '../../core/gameplay';
import { Capture, CUFFING_SECONDS } from '../../enemies/outpost/capture';
import type { Soldier } from '../../enemies/outpost/soldier';
import { CACHE_ORDER } from '../../progression/data';
import { STARTING_WEAPONS, WEAPONS } from '../../weapons/data';
import { makeRange, type Range } from '../../weapons/testkit';
import { BOUNTY, ECONOMY, killPay, wavePay } from '../defense/data';
import { BOSS_PAY, MOD_WARES, WEAPON_WARES } from './data';
import { CrucibleShop } from '.';
import { modOffers, soldWeapons, weaponOffers, type ShopView } from './rules';

let r: Range;
let shop: CrucibleShop;
const waves = { wave: 0, phase: 'intermission' as WavePhase, nextWaveIn: 10 };

beforeEach(async () => {
  r = await makeRange();
  r.reset();
  const ctx = r.ctx as Ctx & { waves: unknown };
  ctx.waves = waves as unknown as Ctx['waves'];
  waves.wave = 0;
  waves.phase = 'intermission';
  shop = new CrucibleShop(ctx);
  shop.init();
});

const kill = (headshot: boolean, source = 'smg', boss = false): void => {
  const enemy = { isBoss: boss } as EnemyInstance;
  r.ctx.events.emit('enemy:killed', { enemy, headshot, damage: { source } } as unknown as KillEvent);
};

/** A break after `cleared` waves, with money to spend. */
function breakAfter(cleared: number, credits = 100_000): void {
  waves.wave = cleared;
  waves.phase = 'intermission';
  shop.credits = credits;
}

const view = (over: Partial<ShopView> = {}): ShopView => ({
  credits: 100_000, inBreak: true, cleared: 0, owned: new Set(STARTING_WEAPONS), mods: new Set(), fitted: new Set(), ...over,
});

describe('credits', () => {
  it('pays a kill as Outpost Defense does, a headshot more, a boss a wave\'s work, an ally nothing', () => {
    kill(false);
    expect(shop.credits).toBe(ECONOMY.kill);
    kill(true);
    expect(shop.credits).toBe(ECONOMY.kill + killPay(true));
    expect(killPay(true)).toBeGreaterThan(killPay(false));
    kill(false, 'ally_rifle');
    expect(shop.credits).toBe(ECONOMY.kill + killPay(true));
    shop.credits = 0;
    kill(false, 'lance', true);
    expect(shop.credits).toBe(killPay(false) + BOSS_PAY);
  });

  it('pays a wave cleared, and a new run starts with nothing', () => {
    r.ctx.events.emit('wave:clear', { wave: 3, bonus: 0 });
    expect(shop.credits).toBe(wavePay(3));
    shop.reset();
    expect(shop.credits).toBe(0);
  });

  it('affords the first new gun by wave 3: two waves of the Crucible, all killed, a fifth to the head', () => {
    // The standard wave: (10 + 2 x wave) x 2 (enemies/waves.ts composeWave).
    let credits = 0;
    for (const w of [1, 2]) {
      const n = (10 + 2 * w) * 2;
      credits += Math.round(n * 0.8) * killPay(false) + Math.round(n * 0.2) * killPay(true) + wavePay(w);
    }
    const cheapest = Math.min(...soldWeapons().filter(id => WEAPON_WARES[id]!.wave <= 2).map(id => WEAPON_WARES[id]!.price));
    expect(credits).toBeGreaterThanOrEqual(cheapest);
    expect(credits).toBeGreaterThanOrEqual(WEAPON_WARES.judge!.price);
    // and not the whole catalogue.
    expect(credits).toBeLessThan(WEAPON_WARES.autocannon!.price);
  });

  it('takes a prisoner\'s bounty: the Crucible\'s purse is a capture\'s wallet', () => {
    const c = new Capture({} as Soldier);
    c.step(CUFFING_SECONDS + 0.01);
    c.drone = true;
    c.hook();
    expect(c.secure(shop, BOUNTY.regular)).toBe(BOUNTY.regular);
    expect(shop.credits).toBe(BOUNTY.regular);
  });
});

describe('locks', () => {
  it('sells every gun the caches brought, and none of the starting ones', () => {
    expect(new Set(soldWeapons())).toEqual(new Set(CACHE_ORDER));
    for (const id of STARTING_WEAPONS) expect(soldWeapons()).not.toContain(id);
  });

  it('holds each gun back until its wave is cleared: the Deuce 6, the Ultramag 14, the Lance last', () => {
    expect(WEAPON_WARES.deuce!.wave).toBe(6);
    expect(WEAPON_WARES.ultramag!.wave).toBe(14);
    expect(Math.max(...soldWeapons().map(id => WEAPON_WARES[id]!.wave))).toBe(WEAPON_WARES.lance!.wave);
    const at = (cleared: number, id: WeaponId) => weaponOffers(view({ cleared })).find(o => o.act.id === id)!;
    expect(at(5, 'deuce').locked).toBe(true);
    expect(at(5, 'deuce').why).toBe('Released after wave 6');
    expect(at(6, 'deuce').locked).toBe(false);
    expect(at(6, 'deuce').why).toBeNull();
    expect(at(13, 'ultramag').locked).toBe(true);
    expect(at(14, 'ultramag').why).toBeNull();
  });

  it('the Raufoss rounds wait for their wave too, and every mod for its gun', () => {
    expect(modOffers(view({ cleared: MOD_WARES.raufoss.wave - 1 })).find(o => o.act.id === 'raufoss')!.locked).toBe(true);
    expect(modOffers(view({ cleared: MOD_WARES.raufoss.wave })).find(o => o.act.id === 'raufoss')!.why).toBeNull();
    expect(modOffers(view({ owned: new Set<WeaponId>(['harrow']) })).find(o => o.act.id === 'suppressor')!.why).toBe('Needs its gun');
  });
});

describe('buying', () => {
  it('hands over exactly the gun bought, and its price', () => {
    breakAfter(6, 5000);
    const before = new Set(r.weapons.owned);
    expect(shop.buy({ kind: 'weapon', id: 'deuce' })).toBeNull();
    const now = [...r.weapons.owned].filter(id => !before.has(id));
    expect(now).toEqual(['deuce']);
    expect(shop.credits).toBe(5000 - WEAPON_WARES.deuce!.price);
    expect(r.weapons.ammo('deuce').mag).toBe(WEAPONS.deuce.magSize);
    expect(shop.buy({ kind: 'weapon', id: 'deuce' })).toBe('Owned');
  });

  it('refuses a locked gun, one not afforded, and anything during a wave', () => {
    breakAfter(5);
    expect(shop.buy({ kind: 'weapon', id: 'deuce' })).toBe('Released after wave 6');
    breakAfter(6, 100);
    expect(shop.buy({ kind: 'weapon', id: 'deuce' })).toBe(`Need ${WEAPON_WARES.deuce!.price - 100} more`);
    breakAfter(6);
    waves.phase = 'spawning';
    waves.wave = 7;
    expect(shop.buy({ kind: 'weapon', id: 'deuce' })).toBe('Between waves only');
    expect(r.weapons.owned.has('deuce')).toBe(false);
  });

  it('buys a mod fitted, then fits and takes it off free, and never mid-wave', () => {
    breakAfter(1, 2000);
    expect(shop.buy({ kind: 'mod', id: 'suppressor' })).toBeNull();
    expect(shop.credits).toBe(2000 - MOD_WARES.suppressor.price);
    expect(r.weapons.fitted.has('suppressor')).toBe(true);
    expect(shop.buy({ kind: 'mod', id: 'suppressor' })).toBeNull();
    expect(r.weapons.fitted.has('suppressor')).toBe(false);
    expect(shop.credits).toBe(2000 - MOD_WARES.suppressor.price);
    waves.phase = 'clearing';
    waves.wave = 2;
    expect(shop.buy({ kind: 'mod', id: 'suppressor' })).toBe('Between waves only');
    expect(r.weapons.fitted.has('suppressor')).toBe(false);
  });
});
