/** The Crucible's shop (weapons-update plan section 10): what kills pay, what each wave lets out, and what buying hands over. */
import { beforeEach, describe, expect, it } from 'vitest';
import type { Ctx } from '../../core/contracts';
import type { EnemyInstance, KillEvent, ModId, WavePhase, WeaponId } from '../../core/gameplay';
import { Capture, CUFFING_SECONDS } from '../../enemies/outpost/capture';
import type { Soldier } from '../../enemies/outpost/soldier';
import { CACHE_ORDER } from '../../progression/data';
import { STARTING_WEAPONS, WEAPONS, WEAPON_ORDER } from '../../weapons/data';
import { inPlay } from '../../weapons/families';
import { AMMO_GUNS, MODS, MOD_ORDER } from '../../weapons/mods';
import { CONTRACTS } from '../data';
import { makeRange, type Range } from '../../weapons/testkit';
import { BOUNTY, ECONOMY, killPay, wavePay } from '../defense/data';
import { DEFAULT_BINDINGS } from '../../input/bindings';
import { BOSS_PAY, MOD_WARES, SHOP_CONTRACTS, SUPPLY_BREAK, WEAPON_WARES } from './data';
import { CrucibleShop } from '.';
import { implantOffers, issued, listedWeapons, modOffers, weaponOffers, type ShopView } from './rules';
import { IMPLANTS, Loadout } from '../../progression/implants';

let r: Range;
let shop: CrucibleShop;
const waves = { wave: 0, phase: 'intermission' as WavePhase, nextWaveIn: 10 };

beforeEach(async () => {
  r = await makeRange();
  r.reset();
  const ctx = r.ctx as Ctx & { waves: unknown };
  ctx.waves = waves as unknown as Ctx['waves'];
  // The shop's view reads progression's implant loadout.
  ctx.progression = { loadout: new Loadout() } as unknown as Ctx['progression'];
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
  credits: 100_000, inBreak: true, cleared: 0, owned: new Set(STARTING_WEAPONS), mods: new Set(), fitted: new Set(),
  implants: new Set(['bloodthirst']), implantsFitted: new Set(['bloodthirst']), slots: 1,
  chips: new Set(['sonar']), chipsFitted: ['sonar'], chipSlots: 1, ...over,
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
    const forSale = listedWeapons().filter(id => !issued(WEAPON_WARES[id]!));
    const cheapest = Math.min(...forSale.filter(id => WEAPON_WARES[id]!.wave <= 2).map(id => WEAPON_WARES[id]!.price));
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

describe('the break', () => {
  it('is stretched to the supply break once a wave is cleared, and L calls the next wave in', () => {
    waves.phase = 'clearing';
    r.ctx.events.emit('wave:clear', { wave: 3, bonus: 0 });
    waves.phase = 'intermission';
    waves.nextWaveIn = 8;
    shop.update();
    expect(waves.nextWaveIn).toBe(SUPPLY_BREAK);
    // Once only: the break then runs down.
    waves.nextWaveIn = 10;
    shop.update();
    expect(waves.nextWaveIn).toBe(10);
    r.input.simulate('nextWave', true);
    shop.update();
    r.input.simulate('nextWave', false);
    expect(waves.nextWaveIn).toBe(3);
  });

  it('has no key of its own: the shop opens only at a supply pod (progression/pickups/pods.test.ts)', () => {
    expect(Object.keys(DEFAULT_BINDINGS)).not.toContain('shop');
    let opened = 0;
    r.ctx.events.on('shop:open', () => opened++);
    for (const code of ['interact', 'nextWave', 'reload'] as const) {
      r.input.simulate(code, true);
      shop.update();
      r.input.simulate(code, false);
    }
    expect(opened).toBe(0);
  });
});

describe('locks', () => {
  it('opens in every endless survival game but Outpost Defense, which has its own shops', () => {
    const endless = CONTRACTS.filter(c => !c.mission && !c.economy).map(c => c.id);
    expect([...SHOP_CONTRACTS].sort()).toEqual(endless.sort());
    expect(SHOP_CONTRACTS).toContain('outpost');
    expect(SHOP_CONTRACTS).not.toContain('defense');
  });

  it('lists every player weapon: the caches\' guns for sale, the issued ones as issued, each with a price, a wave and a line', () => {
    expect(new Set(listedWeapons())).toEqual(new Set(WEAPON_ORDER.filter(inPlay)));
    expect(listedWeapons()).toContain('piledriver');
    expect(listedWeapons()).toContain('kiln');
    for (const id of CACHE_ORDER.filter(id => !STARTING_WEAPONS.includes(id))) expect(issued(WEAPON_WARES[id]!)).toBe(false);
    for (const id of STARTING_WEAPONS) expect(issued(WEAPON_WARES[id]!)).toBe(true);
    for (const id of Object.keys(WEAPON_WARES) as WeaponId[]) expect(WEAPON_WARES[id]!.lore.length).toBeGreaterThan(40);
    // Every mod for sale has its line, the AP and HP rounds among them.
    for (const id of MOD_ORDER) expect(MOD_WARES[id].lore.length, id).toBeGreaterThan(40);
    expect(modOffers(view({})).filter(o => MODS[o.act.id as ModId].slot === 'ammo').length).toBe(AMMO_GUNS.length * 3);
    const rows = weaponOffers(view({ cleared: 0, credits: 0 }));
    expect(rows.find(o => o.act.id === 'smg')!.why).toBe('Issued');
    expect(rows.find(o => o.act.id === 'piledriver')!.why).toBe(`Released after wave ${WEAPON_WARES.piledriver!.wave}`);
    expect(rows.find(o => o.act.id === 'kiln')!.locked).toBe(true);
  });

  it('holds each gun back until its wave is cleared: the Deuce 6, the Ultramag 14, the Lance last', () => {
    expect(WEAPON_WARES.deuce!.wave).toBe(6);
    expect(WEAPON_WARES.ultramag!.wave).toBe(14);
    expect(Math.max(...listedWeapons().map(id => WEAPON_WARES[id]!.wave))).toBe(WEAPON_WARES.lance!.wave);
    const at = (cleared: number, id: WeaponId) => weaponOffers(view({ cleared })).find(o => o.act.id === id)!;
    expect(at(5, 'deuce').locked).toBe(true);
    expect(at(5, 'deuce').why).toBe('Released after wave 6');
    expect(at(6, 'deuce').locked).toBe(false);
    expect(at(6, 'deuce').why).toBeNull();
    expect(at(13, 'ultramag').locked).toBe(true);
    expect(at(14, 'ultramag').why).toBeNull();
  });

  it('the Raufoss rounds wait for their wave too, and every mod for its gun', () => {
    const owned = new Set<WeaponId>([...STARTING_WEAPONS, 'sabot']);
    expect(modOffers(view({ owned, cleared: MOD_WARES.raufoss.wave - 1 })).find(o => o.act.id === 'raufoss')!.locked).toBe(true);
    expect(modOffers(view({ owned, cleared: MOD_WARES.raufoss.wave })).find(o => o.act.id === 'raufoss')!.why).toBeNull();
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

describe('implants', () => {
  const implant = (v: ShopView, id: string) => implantOffers(v).find(o => o.act.kind === 'implant' && o.act.id === id)!;
  const slot = (v: ShopView, n: number) => implantOffers(v).find(o => o.act.kind === 'slot' && o.act.id === n)!;

  it('sells each implant from its wave, at its price; one of a fitted class replaces it, a new class needs a slot', () => {
    expect(implant(view(), 'hellfire').why).toBe('Released after wave 4');
    const v = view({ cleared: 4 });
    expect(implant(v, 'hellfire').why).toBeNull();
    expect(implant(v, 'hellfire').replaces).toBe('bloodthirst');
    expect(implant(v, 'hellfire').ware.price).toBe(IMPLANTS.hellfire.price);
    expect(implant(v, 'skyfall').why).toBe('No free slot');
    expect(implant(view({ cleared: 4, slots: 2 }), 'skyfall').why).toBeNull();
    expect(implant(view({ cleared: 4, credits: 100 }), 'hellfire').why).toBe('Need 1500 more');
    expect(implant(view({ cleared: 4, inBreak: false }), 'hellfire').why).toBe('Between waves only');
  });

  it('sells slot 2 after wave 5 and slot 3 after wave 12, in order', () => {
    expect(slot(view({ cleared: 4 }), 2).why).toBe('Released after wave 5');
    expect(slot(view({ cleared: 5 }), 2).why).toBeNull();
    expect(slot(view({ cleared: 12 }), 3).why).toBe('Open slot 2 first');
    expect(slot(view({ cleared: 12, slots: 2 }), 3).why).toBeNull();
    expect(slot(view({ cleared: 12, slots: 2 }), 2).owned).toBe(true);
  });

  it('buys and fits through the loadout, charges once, and refits free', () => {
    const loadout = shop.loadout;
    breakAfter(6, 10_000);
    expect(shop.buy({ kind: 'implant', id: 'berserk' })).toBeNull();
    expect([...loadout.fitted]).toEqual(['berserk']);
    expect(shop.credits).toBe(10_000 - IMPLANTS.berserk.price);
    expect(shop.buy({ kind: 'implant', id: 'bloodthirst' })).toBeNull();
    expect([...loadout.fitted]).toEqual(['bloodthirst']);
    expect(shop.credits).toBe(10_000 - IMPLANTS.berserk.price);
    expect(shop.buy({ kind: 'implant', id: 'butcher' })).toBe('No free slot');
    expect(shop.buy({ kind: 'slot', id: 2 })).toBeNull();
    expect(loadout.slots).toBe(2);
    expect(shop.buy({ kind: 'implant', id: 'butcher' })).toBeNull();
    expect(new Set(loadout.fitted)).toEqual(new Set(['bloodthirst', 'butcher']));
    expect(shop.credits).toBe(10_000 - IMPLANTS.berserk.price - 1500 - IMPLANTS.butcher.price);
  });
});
