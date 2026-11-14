import { describe, expect, it, vi } from 'vitest';
import type { Ctx } from '../../core/contracts';
import type { CallInId, WeaponId } from '../../core/gameplay';
import { composeOutpostWave } from '../../enemies/outpost/doctrine';
import { pickContract } from '../select';
import {
  ALLY_PRICES, CALLIN_PRICES, DEFAULT_LOADOUT, ECONOMY, SHOPS, STIM_PRICE, WEAPON_PRICES, killPay, wavePay,
} from './data';
import { ShopState, checkLoadout, offers, startPosts, type Act, type ShopView } from './economy';
import { Defense } from './index';

function view(over: Partial<ShopView> = {}): ShopView {
  return {
    credits: 10_000, inBreak: true, owned: new Set<WeaponId>(['harrow', 'rivet', 'knife']),
    ammo: () => ({ reserve: 10, maxReserve: 100 }), grenades: 0, grenadesMax: 6, stims: 1, stimsMax: 5, squad: 0,
    held: new Set<CallInId>(), cooldown: () => 0, mounts: [{ level: 1, names: ['M2', 'M2A1', 'M134'] }], pieces: [],
    lost: () => false, mortars: 0, mortarsMax: 4, ...over,
  };
}

const find = (list: ReturnType<typeof offers>, act: Act) => list.find(o => JSON.stringify(o.act) === JSON.stringify(act))!;

describe('credits', () => {
  it('pays per kill, a little more for a head, and per wave survived, climbing', () => {
    expect(killPay(false)).toBe(ECONOMY.kill);
    expect(killPay(true)).toBe(ECONOMY.kill + ECONOMY.headshot);
    expect(wavePay(2)).toBeGreaterThan(wavePay(1));
  });

  it('Q4: the opening budget buys a decent rifle and a pistol, with change', () => {
    const check = checkLoadout(...DEFAULT_LOADOUT);
    expect(DEFAULT_LOADOUT).toEqual(['harrow', 'rivet']);
    expect(check.why).toBeNull();
    expect(check.left).toBeGreaterThan(0);
  });

  it('Q4: the first rocketeer is in reach in the break before wave 5, not before', () => {
    const left = checkLoadout(...DEFAULT_LOADOUT).left;
    const after = (waves: number, share: number) => {
      let c = left;
      for (let w = 1; w <= waves; w++) c += wavePay(w) + Math.floor(composeOutpostWave(w).flat().length * share) * killPay(false);
      return c;
    };
    expect(after(3, 1)).toBeLessThan(ALLY_PRICES.rocketeer);
    expect(after(4, 1)).toBeGreaterThanOrEqual(ALLY_PRICES.rocketeer);
    // Half the kills (the squad took the rest) still gets him.
    expect(after(4, 0.5)).toBeGreaterThanOrEqual(ALLY_PRICES.rocketeer);
  });

  it('Q3: the troops keep the proposal ratios', () => {
    const r = ALLY_PRICES.rifleman;
    expect(ALLY_PRICES.gunner / r).toBe(2);
    expect(ALLY_PRICES.shotgunner / r).toBe(2);
    expect(ALLY_PRICES.riot / r).toBe(3);
    expect(ALLY_PRICES.medic / r).toBe(3);
    for (const t of ['sniper', 'rocketeer', 'mortar'] as const) {
      expect(ALLY_PRICES[t] / r).toBeGreaterThanOrEqual(4);
      expect(ALLY_PRICES[t] / r).toBeLessThanOrEqual(5);
    }
  });

  it('prices call-ins climbing with their power', () => {
    const order: CallInId[] = ['airstrike', 'warthog', 'doorGunner', 'attackChopper', 'orbital', 'ac130', 'blackSun', 'nuke'];
    for (let i = 1; i < order.length; i++) expect(CALLIN_PRICES[order[i]!]).toBeGreaterThan(CALLIN_PRICES[order[i - 1]!]);
  });
});

describe('the loadout', () => {
  it('takes one primary and one secondary, no explosives, inside the budget', () => {
    expect(checkLoadout(null, 'rivet').why).toBe('Pick a primary');
    expect(checkLoadout('harrow', null).why).toBe('Pick a secondary');
    expect(checkLoadout('rocket', 'rivet').why).toMatch(/No explosives/);
    expect(checkLoadout('quiver', 'rivet').why).toMatch(/No explosives/);
    expect(checkLoadout('rivet', 'harrow').why).toBe('A secondary');
    expect(checkLoadout('buzzsaw', 'judge').why).toMatch(/^Over budget by \d+/);
    expect(checkLoadout('smg', 'rivet')).toMatchObject({ why: null, left: ECONOMY.budget - 1100 - 400 });
    expect(checkLoadout('smg', 'judge').why).toBe('Over budget by 150');
  });

  it('marks every rocket, shell and plasma gun explosive and keeps them out of it', () => {
    for (const id of ['rocket', 'quiver', 'autocannon', 'lance'] as WeaponId[]) {
      expect(WEAPON_PRICES[id]).toMatchObject({ explosive: true });
      expect(WEAPON_PRICES[id]!.loadout).toBeUndefined();
    }
  });
});

describe('buying', () => {
  it('says what more it needs when it cannot be afforded', () => {
    const o = find(offers('infirmary', view({ credits: 100 })), { kind: 'stim' });
    expect(o.why).toBe(`Need ${STIM_PRICE - 100} more`);
    expect(find(offers('infirmary', view({ credits: STIM_PRICE })), { kind: 'stim' }).why).toBeNull();
  });

  it('starts each run with two squads of three riflemen, spread so every side of the outer ring is held', () => {
    expect(ECONOMY.startRiflemen).toBe(6);
    const posts = startPosts();
    expect(posts).toHaveLength(6);
    expect(posts.every(p => p.type === 'rifleman' && p.ring === 'outer')).toBe(true);
    expect(new Set(posts.map(p => p.id)).size).toBe(6);
    expect(new Set(posts.map(p => p.yaw.toFixed(3))).size).toBe(4);
  });

  it('caps the squad at twenty, so fourteen can be hired on top of the six', () => {
    expect(ECONOMY.squadMax).toBe(20);
    expect(find(offers('barracks', view({ squad: ECONOMY.startRiflemen })), { kind: 'ally', type: 'rifleman' }).why).toBeNull();
    expect(find(offers('barracks', view({ squad: 19 })), { kind: 'ally', type: 'rifleman' }).why).toBeNull();
    expect(find(offers('barracks', view({ squad: 20 })), { kind: 'ally', type: 'rifleman' }).why).toBe('Squad full, 20');
  });

  it('caps stims at five, grenades at their most, and the squad at its most', () => {
    expect(find(offers('infirmary', view({ stims: 5 })), { kind: 'stim' }).why).toBe('Carrying 5');
    expect(find(offers('armoury', view({ grenades: 6 })), { kind: 'grenade' }).why).toBe('Full');
    expect(find(offers('barracks', view({ squad: ECONOMY.squadMax })), { kind: 'ally', type: 'rifleman' }).why).toMatch(/Squad full/);
  });

  it('piece 8: sells mortar teams, one a mortar post, and none off the fort', () => {
    expect(find(offers('barracks', view()), { kind: 'mortar' })).toMatchObject({ price: ALLY_PRICES.mortar, why: null });
    expect(find(offers('barracks', view({ squad: ECONOMY.squadMax })), { kind: 'mortar' }).why).toBeNull();
    expect(find(offers('barracks', view({ mortars: 4 })), { kind: 'mortar' }).why).toBe('All 4 posts manned');
    expect(find(offers('barracks', view({ mortarsMax: 0 })), { kind: 'mortar' }).why).toBe('No mortar posts here');
    expect(find(offers('barracks', view({ credits: 100 })), { kind: 'mortar' }).why).toMatch(/^Need/);
  });

  it('sells weapons only in a break, and everything else under fire', () => {
    const fight = offers('armoury', view({ inBreak: false }));
    expect(find(fight, { kind: 'weapon', id: 'sabot' }).why).toBe('Only in a break');
    expect(find(fight, { kind: 'callin', id: 'airstrike' }).why).toBeNull();
    expect(find(fight, { kind: 'ammo', id: 'harrow' }).why).toBeNull();
    expect(find(fight, { kind: 'mount', index: 0 }).why).toBeNull();
    expect(find(offers('armoury', view()), { kind: 'weapon', id: 'sabot' }).why).toBeNull();
    expect(find(offers('armoury', view()), { kind: 'weapon', id: 'harrow' }).why).toBe('Owned');
  });

  it('will not sell a call-in that is held or rearming, or a gun past the top of the ladder', () => {
    const v = view({ held: new Set<CallInId>(['airstrike']), cooldown: id => (id === 'warthog' ? 12.2 : 0), mounts: [{ level: 3, names: ['a', 'b', 'c'] }] });
    const list = offers('armoury', v);
    expect(find(list, { kind: 'callin', id: 'airstrike' }).why).toMatch(/^Ready/);
    expect(find(list, { kind: 'callin', id: 'warthog' }).why).toBe('Rearming, 13 s');
    expect(find(list, { kind: 'mount', index: 0 }).why).toBe('Top of the ladder');
  });

  it('prices repairs per stage on walls and gates, half for a chip, and never shacks', () => {
    const piece = (kind: 'wall' | 'gate' | 'shack', stage: 'intact' | 'damaged' | 'breached', health = 0) => ({ kind, stage, health, maxHealth: 100, repairing: -1 });
    const list = offers('barracks', view({ pieces: [piece('wall', 'breached'), piece('gate', 'breached'), piece('shack', 'breached'), piece('wall', 'intact', 60), piece('wall', 'intact', 100)] }));
    const repairs = list.filter(o => o.section === 'Repairs');
    expect(repairs.map(o => [o.label, o.price])).toEqual([['Wall 1', 250], ['Gate 1', 350], ['Wall 2', 125]]);
  });
});

describe('a lost shop', () => {
  it('loses at zero health, takes no more, and comes back whole', () => {
    const s = new ShopState('armoury');
    expect(s.damage(SHOPS.armoury.health - 1)).toBe(false);
    expect(s.damage(5)).toBe(true);
    expect(s.lost).toBe(true);
    expect(s.damage(5)).toBe(false);
    s.restore();
    expect(s).toMatchObject({ lost: false, health: SHOPS.armoury.health });
  });

  it('sells nothing but its rebuild, and that only in a break', () => {
    const lost = (id: string) => id === 'infirmary';
    expect(offers('infirmary', view({ lost })).map(o => o.act)).toEqual([{ kind: 'rebuild', shop: 'infirmary' }]);
    expect(offers('infirmary', view({ lost, inBreak: false }))[0]!.why).toBe('Only in a break');
    expect(offers('infirmary', view({ lost, credits: 10 }))[0]!.why).toMatch(/^Need/);
  });
});

/** Enough of a run for the runtime's buy path. */
function fakeCtx(phase: 'intermission' | 'spawning' = 'intermission') {
  const ammo = new Map<WeaponId, { mag: number; magSize: number; reserve: number; maxReserve: number }>();
  const grantCallIn = vi.fn();
  const setLoadout = vi.fn();
  const give = vi.fn();
  const ctx = {
    weapons: {
      owned: new Set<WeaponId>(['harrow', 'rivet']), grenades: 0, give, setLoadout, addGrenades: vi.fn(),
      ammo: (id: WeaponId) => ammo.get(id) ?? ammo.set(id, { mag: 1, magSize: 1, reserve: 0, maxReserve: 100 }).get(id)!,
    },
    progression: { stims: { count: 1, max: 5, give: vi.fn(() => 1) }, callIns: new Set<CallInId>(), callInCooldown: () => 0, grantCallIn },
    world: { objects: { structures: [] } },
    waves: { wave: 2, phase, nextWaveIn: 10 },
    hud: { banner: vi.fn(), feed: vi.fn() },
  } as unknown as Ctx;
  return { ctx, grantCallIn, setLoadout, give };
}

describe('the runtime', () => {
  it('grants a bought call-in through progression, and charges for it', () => {
    const { ctx, grantCallIn } = fakeCtx('spawning');
    const d = new Defense(ctx);
    d.credits = CALLIN_PRICES.airstrike + 5;
    expect(d.buy('armoury', { kind: 'callin', id: 'airstrike' })).toBeNull();
    expect(grantCallIn).toHaveBeenCalledWith('airstrike');
    expect(d.credits).toBe(5);
    expect(d.buy('armoury', { kind: 'callin', id: 'warthog' })).toMatch(/^Need/);
    expect(grantCallIn).toHaveBeenCalledTimes(1);
  });

  it('refuses a weapon in a wave, sells it in the break', () => {
    const fight = fakeCtx('spawning');
    const d = new Defense(fight.ctx);
    d.credits = 5000;
    expect(d.buy('armoury', { kind: 'weapon', id: 'sabot' })).toBe('Only in a break');
    expect(fight.give).not.toHaveBeenCalled();
    const calm = fakeCtx();
    const e = new Defense(calm.ctx);
    e.credits = 5000;
    expect(e.buy('armoury', { kind: 'weapon', id: 'sabot' })).toBeNull();
    expect(calm.give).toHaveBeenCalledWith('sabot');
    expect(e.credits).toBe(5000 - WEAPON_PRICES.sabot!.price);
  });

  it('deploys the loadout with a free Shiv, no grenades, and the change as credits', () => {
    const { ctx, setLoadout } = fakeCtx();
    const d = new Defense(ctx);
    d.needLoadout = true;
    expect(d.deploy('rocket', 'rivet')).toMatch(/No explosives/);
    expect(d.deploy('harrow', 'rivet')).toBeNull();
    expect(setLoadout).toHaveBeenCalledWith(['harrow', 'rivet', 'knife'], 0);
    expect(d.credits).toBe(ECONOMY.budget - 900 - 400);
    expect(d.needLoadout).toBe(false);
  });

  it('loses a shop to damage and rebuilds it in a break for its sum', () => {
    const { ctx } = fakeCtx();
    const d = new Defense(ctx);
    d.damageShop('barracks', SHOPS.barracks.health);
    expect(d.shops.barracks.lost).toBe(true);
    expect(d.buy('barracks', { kind: 'ally', type: 'rifleman' })).toBe('Not sold here');
    d.credits = SHOPS.barracks.rebuild;
    expect(d.buy('barracks', { kind: 'rebuild', shop: 'barracks' })).toBeNull();
    expect(d.shops.barracks.lost).toBe(false);
    expect(d.credits).toBe(0);
  });

  it('tops up one gun by half its reserve, up to the most', () => {
    const { ctx } = fakeCtx();
    const d = new Defense(ctx);
    d.credits = 1000;
    expect(d.buy('armoury', { kind: 'ammo', id: 'harrow' })).toBeNull();
    expect(ctx.weapons.ammo('harrow').reserve).toBe(50);
  });
});

describe('the contract', () => {
  it('plays on the fort, keeps the Test Range stand-in for ?map=range, and leaves a bare ?map=range to the lab', () => {
    expect(pickContract('defense', null)).toMatchObject({ def: { id: 'defense', name: 'Outpost Defense', economy: true }, map: 'fort', ranked: true });
    expect(pickContract(null, 'fort').def.id).toBe('defense');
    expect(pickContract('defense', 'range')).toMatchObject({ def: { id: 'defense' }, map: 'range', ranked: false });
    expect(pickContract(null, 'range').def.id).toBe('crucible');
  });
});
