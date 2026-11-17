/** Selling a gun back at the shop, and dropping one for anyone to take, solo and in co-op (handover.ts, dropped.ts). */
import { beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { Ctx } from '../core/contracts';
import type { WavePhase, WeaponId } from '../core/gameplay';
import { CrucibleShop } from '../contracts/shop';
import { MOD_WARES, WEAPON_WARES } from '../contracts/shop/data';
import { refundFor, SELL_RATE, sellWhy, weaponOffers, type ShopView } from '../contracts/shop/rules';
import { Loadout } from '../progression/implants';
import type { WorldEvent } from '../net/worldProtocol';
import { STARTING_WEAPONS } from './data';
import { cleanKit, keepsAGun } from './handover';
import { moddedDef } from './mods';
import { makeRange, type Range } from './testkit';

type GunEvent = Extract<WorldEvent, { t: 'gun' }>;

const view = (over: Partial<ShopView> = {}): ShopView => ({
  credits: 0, inBreak: true, cleared: 10, owned: new Set(STARTING_WEAPONS), mods: new Set(), fitted: new Set(),
  implants: new Set(), implantsFitted: new Set(), slots: 1, chips: new Set(), chipsFitted: [], chipSlots: 1, ...over,
});

/** A range with the stubs the drops need: a prompt over a gun, and a callout. */
async function range(): Promise<Range> {
  const r = await makeRange();
  r.reset();
  const hud = r.ctx.hud as unknown as Record<string, unknown>;
  hud.follow = () => () => {};
  hud.callout = () => {};
  return r;
}

describe('selling a gun back', () => {
  it('pays half the gun and half of every mod held for it, rounded down', () => {
    expect(SELL_RATE).toBe(0.5);
    const owned = new Set<WeaponId>([...STARTING_WEAPONS, 'deuce']);
    expect(refundFor('deuce', view({ owned }))).toBe(Math.floor(WEAPON_WARES.deuce!.price / 2));
    const mods = new Set(['deuceQuad', 'deuceLoader'] as const);
    const paid = WEAPON_WARES.deuce!.price + MOD_WARES.deuceQuad.price + MOD_WARES.deuceLoader.price;
    expect(refundFor('deuce', view({ owned, mods, fitted: new Set(['deuceQuad']) }))).toBe(Math.floor(paid * 0.5));
    // Another gun's mods are not this gun's to sell.
    expect(refundFor('deuce', view({ owned, mods: new Set(['shotgunChoke']) }))).toBe(Math.floor(WEAPON_WARES.deuce!.price / 2));
  });

  it('never sells an issued gun, the last gun, or out of a break', () => {
    const owned = new Set<WeaponId>([...STARTING_WEAPONS, 'deuce']);
    expect(sellWhy('deuce', view({ owned }))).toBeNull();
    expect(sellWhy('smg', view({ owned }))).toBe('Issued: not yours to sell');
    expect(refundFor('smg', view({ owned }))).toBe(0);
    expect(sellWhy('deuce', view({ owned, inBreak: false }))).toBe('Between waves only');
    // The Deuce and a blade: the Deuce is the last gun.
    expect(sellWhy('deuce', view({ owned: new Set<WeaponId>(['deuce', 'sword']) }))).toBe('Your last gun');
    expect(keepsAGun(new Set<WeaponId>(['deuce', 'sword']), 'deuce')).toBe(false);
    expect(keepsAGun(new Set<WeaponId>(['deuce', 'smg']), 'deuce')).toBe(true);
    expect(keepsAGun(new Set<WeaponId>(['deuce', 'smg']), 'sword')).toBe(false);
  });

  it('takes the gun and its mods away for the refund, and sells them again at full price', async () => {
    const r = await range();
    const waves = { wave: 10, phase: 'intermission' as WavePhase, nextWaveIn: 10 };
    const ctx = r.ctx as Ctx & { waves: unknown };
    ctx.waves = waves as unknown as Ctx['waves'];
    ctx.progression = { loadout: new Loadout() } as unknown as Ctx['progression'];
    const shop = new CrucibleShop(ctx);
    shop.init();
    shop.credits = 10_000;
    expect(shop.buy({ kind: 'weapon', id: 'deuce' })).toBeNull();
    expect(shop.buy({ kind: 'mod', id: 'deuceLoader' })).toBeNull();
    const paid = WEAPON_WARES.deuce!.price + MOD_WARES.deuceLoader.price;
    expect(shop.credits).toBe(10_000 - paid);
    r.weapons.switchTo('deuce');
    r.run(1);
    expect(shop.sell('deuce')).toBeNull();
    expect(shop.credits).toBe(10_000 - paid + Math.floor(paid / 2));
    expect(r.weapons.owned.has('deuce')).toBe(false);
    expect(r.weapons.mods.has('deuceLoader')).toBe(false);
    expect(r.weapons.current).not.toBe('deuce');
    const row = weaponOffers(shop.view()).find(o => o.act.id === 'deuce')!;
    expect(row.owned).toBe(false);
    expect(row.why).toBeNull();
    expect(shop.buy({ kind: 'weapon', id: 'deuce' })).toBeNull();
    expect(shop.credits).toBe(10_000 - paid + Math.floor(paid / 2) - WEAPON_WARES.deuce!.price);
    expect(shop.sell('smg')).toBe('Issued: not yours to sell');
  });
});

/** The Deuce with the quad fitted and the loader held, two in the magazine and 9 spare, in hand. */
function armDeuce(r: Range): void {
  r.weapons.give('deuce');
  r.weapons.grantMod('deuceQuad');
  r.weapons.grantMod('deuceLoader');
  r.weapons.fitMod('deuceQuad', true);
  const a = r.weapons.ammo('deuce');
  a.mag = 2;
  a.reserve = 9;
  r.weapons.switchTo('deuce');
  r.run(1.5);
}

describe('dropping a gun', () => {
  let r: Range;
  beforeEach(async () => { r = await range(); });

  it('throws the gun in hand down with its mods and rounds, and E takes it back as it was', () => {
    armDeuce(r);
    const before = moddedDef('deuce', new Set(r.weapons.fitted));
    r.tap('dropWeapon');
    expect(r.weapons.owned.has('deuce')).toBe(false);
    expect(r.weapons.mods.has('deuceQuad')).toBe(false);
    expect(r.weapons.current).not.toBe('deuce');
    const [gun] = r.weapons.dropped.list;
    expect(gun).toMatchObject({ weapon: 'deuce', mods: ['deuceQuad', 'deuceLoader'], fitted: ['deuceQuad'], mag: 2, reserve: 9 });
    r.run(1);
    r.tap('interact');
    expect(r.weapons.dropped.list).toHaveLength(0);
    expect(r.weapons.owned.has('deuce')).toBe(true);
    expect([...r.weapons.fitted].filter(m => m.startsWith('deuce'))).toEqual(['deuceQuad']);
    expect(r.weapons.mods.has('deuceLoader')).toBe(true);
    expect(r.weapons.ammo('deuce')).toMatchObject({ mag: 2, magSize: 4, reserve: 9 });
    // The same gun, pellet spread and all.
    expect(moddedDef('deuce', new Set(r.weapons.fitted))).toEqual(before);
    expect(r.weapons.current).toBe('deuce');
  });

  it('never drops the last gun, nor one mid-reload', () => {
    r.weapons.setLoadout(['smg', 'sword'], 0);
    r.run(1);
    r.tap('dropWeapon');
    expect(r.weapons.owned.has('smg')).toBe(true);
    expect(r.weapons.dropped.list).toHaveLength(0);
    r.weapons.setLoadout(['smg', 'shotgun'], 0);
    r.run(1);
    r.weapons.ammo('smg').mag = 3;
    r.tap('reload');
    expect(r.weapons.reloading).toBe(true);
    r.tap('dropWeapon');
    expect(r.weapons.owned.has('smg')).toBe(true);
  });

  it('is gone after its time on the ground', () => {
    armDeuce(r);
    r.tap('dropWeapon');
    r.player.position.set(50, 0, 50);
    r.run(151);
    expect(r.weapons.dropped.list).toHaveLength(0);
  });

  it('drops an akimbo SMG and takes it back still akimbo, both magazines and every SMG mod with it', () => {
    r.weapons.setLoadout(['smg', 'shotgun'], 0);
    for (const m of ['smgAkimbo', 'smgMag', 'smgTape'] as const) {
      r.weapons.grantMod(m);
      r.weapons.fitMod(m, true);
    }
    r.run(1);
    expect(r.weapons.akimbo).toBe(true);
    const a = r.weapons.ammo('smg');
    expect(a.magSize).toBe(100);
    a.mag = 87;
    r.tap('dropWeapon');
    expect(r.weapons.owned.has('smg')).toBe(false);
    expect(r.weapons.akimbo).toBe(false);
    const [gun] = r.weapons.dropped.list;
    expect(gun!.fitted).toEqual(expect.arrayContaining(['smgAkimbo', 'smgMag', 'smgTape']));
    expect(gun!.mag).toBe(87);
    r.run(1);
    r.tap('interact');
    r.run(0.5);
    expect(r.weapons.current).toBe('smg');
    expect(r.weapons.akimbo).toBe(true);
    expect(r.weapons.ammo('smg')).toMatchObject({ mag: 87, magSize: 100 });
    // Over the wire too: the host's check lets a hundred-round pair through, not the stock SMG's sixty.
    expect(cleanKit({ ...gun, at: undefined })!.mag).toBe(87);
    expect(cleanKit({ weapon: 'smg', mods: ['smgAkimbo', 'smgMag'], fitted: ['smgAkimbo', 'smgMag'], mag: 500, reserve: 0 })!.mag).toBe(100);
  });

  it('will not drop a gun in the middle of a Gun Kata', () => {
    r.weapons.setLoadout(['smg', 'shotgun'], 0);
    r.weapons.grantMod('smgAkimbo');
    r.weapons.fitMod('smgAkimbo', true);
    r.run(1);
    r.enemies.add(0, -8);
    r.enemies.add(8, 0);
    r.enemies.add(0, 8);
    expect(r.weapons.kata()).toBe('go');
    expect(r.weapons.dropHeld()).toBeNull();
    expect(r.weapons.owned.has('smg')).toBe(true);
    r.run(1);
    expect(r.weapons.dropHeld()).not.toBeNull();
  });

  it('rejects a kit with another gun\'s mods or impossible rounds', () => {
    expect(cleanKit({ weapon: 'deuce', mods: ['smgMag', 'deuceQuad'], fitted: ['smgMag', 'deuceQuad'], mag: 99, reserve: 1e9 }))
      .toMatchObject({ mods: ['deuceQuad'], fitted: ['deuceQuad'], mag: 4 });
    expect(cleanKit({ weapon: 'nope', mods: [], fitted: [], mag: 0, reserve: 0 })).toBeNull();
  });
});

describe('dropping a gun in co-op', () => {
  let host: Range;
  let guest: Range;
  /** What each side has sent and not yet delivered. */
  let toHost: GunEvent[];
  let toGuest: GunEvent[];

  beforeEach(async () => {
    host = await range();
    guest = await range();
    toHost = [];
    toGuest = [];
    const session = (hosting: boolean, name: string, out: () => GunEvent[]) => ({
      hosting, lobby: { me: { name } }, world: { sendGun: (e: GunEvent) => out().push(e) },
    }) as unknown as Ctx['coop'];
    host.ctx.coop = session(true, 'HOST', () => toGuest);
    guest.ctx.coop = session(false, 'WARDEN-42', () => toHost);
    // Both stand at the origin; the guest's model is where the host sees them.
  });

  /** Delivers what is in flight, the host's way first, as the wire would. */
  function pump(): void {
    for (let i = 0; i < 4; i++) {
      for (const e of toHost.splice(0)) host.weapons.dropped.hostIn(e, 'guest', guest.player.position, 'WARDEN-42');
      for (const e of toGuest.splice(0)) guest.weapons.dropped.guestIn(e);
    }
  }

  it('a guest\'s drop shows on the host, named, and the host takes it with its mods and rounds', () => {
    armDeuce(guest);
    guest.tap('dropWeapon');
    expect(guest.weapons.owned.has('deuce')).toBe(false);
    pump();
    expect(host.weapons.dropped.list).toHaveLength(1);
    expect(host.weapons.dropped.list[0]).toMatchObject({ weapon: 'deuce', by: 'WARDEN-42', fitted: ['deuceQuad'], mag: 2, reserve: 9 });
    expect(guest.weapons.dropped.list).toHaveLength(1);
    host.run(0.5);
    host.tap('interact');
    pump();
    expect(host.weapons.owned.has('deuce')).toBe(true);
    expect(host.weapons.ammo('deuce')).toMatchObject({ mag: 2, magSize: 4, reserve: 9 });
    expect(host.weapons.dropped.list).toHaveLength(0);
    expect(guest.weapons.dropped.list).toHaveLength(0);
  });

  it('the host\'s drop goes to the guest who asks for it, and only one of them gets it', () => {
    armDeuce(host);
    host.tap('dropWeapon');
    pump();
    expect(guest.weapons.dropped.list[0]).toMatchObject({ weapon: 'deuce', by: 'HOST' });
    // Both reach for it in the same frame: the guest's ask is in flight when the host takes it.
    guest.tap('interact');
    expect(toHost).toHaveLength(1);
    host.tap('interact');
    pump();
    expect(host.weapons.owned.has('deuce')).toBe(true);
    expect(guest.weapons.owned.has('deuce')).toBe(false);
    expect(guest.weapons.dropped.list).toHaveLength(0);
  });

  it('a guest takes the host\'s gun, mods and rounds, and it is gone for both', () => {
    armDeuce(host);
    host.tap('dropWeapon');
    pump();
    guest.player.position.copy(new THREE.Vector3(...host.weapons.dropped.list[0]!.at));
    guest.tap('interact');
    pump();
    expect(guest.weapons.owned.has('deuce')).toBe(true);
    expect(guest.weapons.current).toBe('deuce');
    expect([...guest.weapons.fitted].filter(m => m.startsWith('deuce'))).toEqual(['deuceQuad']);
    expect(guest.weapons.ammo('deuce')).toMatchObject({ mag: 2, reserve: 9 });
    expect(host.weapons.dropped.list).toHaveLength(0);
    expect(guest.weapons.dropped.list).toHaveLength(0);
  });
});
