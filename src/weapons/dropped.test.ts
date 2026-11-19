/**
 * Guns on the ground, solo and shared in co-op (dropped.ts): where a drop comes to rest, who sees it, who may take it, and that
 * a gun is never lost or doubled whatever the wire does.
 */
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Ctx } from '../core/contracts';
import type { WeaponId } from '../core/gameplay';
import { party, stubGame, type Seat } from '../net/world/sharedkit';
import { DroppedGuns, LIFE, type Arsenal } from './dropped';
import type { GunKit } from './handover';
import { makeRange } from './testkit';
import { batchOf } from '../net/world/pack';

/** An arsenal: what a player owns, and the kit their held gun leaves as. */
class Arms implements Arsenal {
  owned = new Set<WeaponId>(['smg', 'deuce']);
  current: WeaponId = 'deuce';
  kit: GunKit = { weapon: 'deuce', mods: ['deuceQuad'], fitted: ['deuceQuad'], mag: 2, reserve: 9 };
  got: GunKit[] = [];
  dropHeld(): GunKit | null {
    if (!this.owned.has(this.kit.weapon)) return null;
    this.owned.delete(this.kit.weapon);
    this.current = 'smg';
    return { ...this.kit };
  }
  receive(kit: GunKit): void {
    this.got.push(kit);
    this.owned.add(kit.weapon);
  }
}

interface Hands { arms: Arms; guns: DroppedGuns; press: (action: string) => void; frame: () => void; feed: string[] }

/** Puts an arsenal and its drops on a seat's game. */
function arm(ctx: Ctx): Hands {
  const arms = new Arms();
  const guns = new DroppedGuns(ctx, arms);
  (ctx as unknown as { weapons: unknown }).weapons = Object.assign(arms, { dropped: guns });
  let down = '';
  (ctx.input as unknown as { pressed: (a: string) => boolean }).pressed = a => a === down;
  const feed: string[] = [];
  (ctx as unknown as { hud: unknown }).hud = { feed: (line: string) => feed.push(line), follow: () => () => {}, callout() {} };
  // A frame: the wall clock moves a sixtieth where the test has it in hand (co-op reads a gun's age off it).
  const frame = () => { if (vi.isFakeTimers()) vi.advanceTimersByTime(1000 / 60); guns.update(1 / 60); };
  return { arms, guns, feed, frame, press: action => { down = action; frame(); down = ''; } };
}

function table(guests: number, begin = true) {
  const game = party(guests, begin);
  const hands = [game.host, ...game.guests].map(seat => arm(seat.ctx));
  game.build();
  const all = [game.host, ...game.guests];
  /** A second of frames on every screen. */
  const run = (seconds = 1) => { for (let i = 0; i < Math.round(seconds * 60); i++) { vi.advanceTimersByTime(1000 / 60); for (const h of hands) h.guns.update(1 / 60); } game.relay.flush(); };
  const stand = (seat: Seat, x: number, z: number) => seat.player.position.set(x, 0, z);
  return { game, hands, all, run, stand };
}

const lying = (h: Hands) => h.guns.list.map(g => ({ id: g.id, weapon: g.weapon, fitted: g.fitted, mag: g.mag, reserve: g.reserve, by: g.by, at: g.at }));

describe('dropped guns in co-op', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] }); vi.spyOn(console, 'info').mockImplementation(() => {}); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("the host's drop lies on every screen with its mods and rounds, and a guest takes it with E", () => {
    const { game, hands, all, run, stand } = table(2);
    const [host, a, b] = hands as [Hands, Hands, Hands];
    stand(all[1]!, 30, 0); stand(all[2]!, 60, 0);
    host.press('dropWeapon');
    game.relay.flush();
    expect(lying(a)).toEqual(lying(host));
    expect(lying(b)).toEqual(lying(host));
    expect(lying(a)[0]).toMatchObject({ id: 1, weapon: 'deuce', fitted: ['deuceQuad'], mag: 2, reserve: 9, by: 'HOST', at: [0, 0, -1.3] });
    expect(a.feed).toContain('HOST dropped a DEUCE');
    // A guest walks over it: nothing. A gift is taken on purpose.
    stand(all[1]!, 0, -1.3);
    run(1);
    expect(a.arms.got).toHaveLength(0);
    a.press('interact');
    game.relay.flush();
    expect(a.arms.got).toEqual([{ weapon: 'deuce', mods: ['deuceQuad'], fitted: ['deuceQuad'], mag: 2, reserve: 9 }]);
    expect([host, a, b].map(h => h.guns.list.length)).toEqual([0, 0, 0]);
    expect(b.feed).toContain('GUEST1 took the DEUCE');
    expect(host.feed).toContain('GUEST1 took the DEUCE');
    game.dispose();
  });

  it("a guest's drop shows at once on its own screen, takes the host's number, and another guest takes it", () => {
    const { game, hands, all, stand } = table(2);
    const [host, a, b] = hands as [Hands, Hands, Hands];
    stand(all[0]!, 50, 50); stand(all[1]!, 10, 0); stand(all[2]!, 40, 0);
    a.press('dropWeapon');
    // Before the host has heard: it is on the ground here already, and out of the hands.
    expect(a.guns.list).toHaveLength(1);
    expect(a.arms.owned.has('deuce')).toBe(false);
    expect(host.guns.list).toHaveLength(0);
    game.relay.flush();
    // One gun on every screen, under the host's number; the dropper's did not double.
    expect([host, a, b].map(h => h.guns.list.map(g => g.id))).toEqual([[1], [1], [1]]);
    expect(lying(b)[0]).toMatchObject({ weapon: 'deuce', by: 'GUEST1', at: [10, 0, -1.3], mag: 2, reserve: 9 });
    expect(b.feed).toContain('GUEST1 dropped a DEUCE');
    expect(a.feed).toHaveLength(0);
    // Guest to guest, through the host.
    stand(all[2]!, 10, -1.3);
    b.frame();
    b.press('interact');
    game.relay.flush();
    expect(b.arms.got.map(k => k.weapon)).toEqual(['deuce']);
    expect(a.arms.got).toHaveLength(0);
    expect([host, a, b].map(h => h.guns.list.length)).toEqual([0, 0, 0]);
    expect(a.feed).toContain('GUEST2 took the DEUCE');
    game.dispose();
  });

  it('two players grabbing one gun on the same frame: the host gives it to one, and the other is told', () => {
    const { game, hands, all, stand } = table(2);
    const [host, a, b] = hands as [Hands, Hands, Hands];
    host.press('dropWeapon');
    game.relay.flush();
    stand(all[0]!, 50, 50); stand(all[1]!, 0, -1.0); stand(all[2]!, 0, -1.6);
    a.frame(); b.frame();
    // Both ask before either hears back.
    b.press('interact'); a.press('interact');
    game.relay.flush();
    expect(a.arms.got.length + b.arms.got.length).toBe(1);
    expect(b.arms.got).toHaveLength(1);
    expect(a.feed).toContain('GUEST2 got to the DEUCE first');
    expect([host, a, b].map(h => h.guns.list.length)).toEqual([0, 0, 0]);
    // The host against a guest on one frame: the host's own take lands first, the guest's ask finds nothing.
    b.arms.kit = { weapon: 'deuce', mods: [], fitted: [], mag: 1, reserve: 0 };
    stand(all[2]!, 20, 0);
    b.press('dropWeapon');
    game.relay.flush();
    stand(all[0]!, 20, -1.3); stand(all[1]!, 20, -1.3);
    a.frame(); host.frame();
    a.press('interact'); host.press('interact');
    game.relay.flush();
    expect(host.arms.got).toHaveLength(1);
    expect(a.arms.got).toHaveLength(0);
    expect([host, a, b].map(h => h.guns.list.length)).toEqual([0, 0, 0]);
    game.dispose();
  });

  it('a drop made while a guest is still loading reaches it when its world comes up, at rest, once', () => {
    const { game, hands, all, run } = table(2, false);
    const [host, a, b] = hands as [Hands, Hands, Hands];
    host.press('dropWeapon');
    game.relay.flush();
    expect(a.guns.list).toHaveLength(0);
    for (let i = 0; i < 60 * 20; i++) host.frame();
    all[1]!.world.begin();
    game.relay.flush();
    expect(lying(a)).toEqual(lying(host));
    // It has lain there twenty seconds: it is not thrown again, and it expires with the host's.
    expect((a.guns.list[0] as unknown as { age: number }).age).toBeCloseTo(20, 0);
    // The host sends the same again on the guest's first card, and a rejoining guest asks again: still one gun.
    all[1]!.world.begin();
    game.relay.flush();
    expect(a.guns.list).toHaveLength(1);
    // The other guest arrives later still.
    all[2]!.world.begin();
    game.relay.flush();
    expect(lying(b)).toEqual(lying(host));
    for (let i = 0; i < 60 * (LIFE - 19); i++) host.frame();
    run(0.1);
    expect([host, a, b].map(h => h.guns.list.length)).toEqual([0, 0, 0]);
    game.dispose();
  });

  it("a guest's drop the host refuses comes back to the guest's hands", () => {
    const { game, hands, all, stand } = table(1);
    const [host, a] = hands as [Hands, Hands];
    stand(all[1]!, 10, 0);
    // A gun the host does not know (a newer build's, junk): refused.
    a.arms.kit = { weapon: 'made-up' as WeaponId, mods: [], fitted: [], mag: 5, reserve: 5 };
    a.arms.owned.add('made-up' as WeaponId);
    a.press('dropWeapon');
    expect(a.guns.list).toHaveLength(1);
    game.relay.flush();
    expect(host.guns.list).toHaveLength(0);
    expect(a.guns.list).toHaveLength(0);
    expect(a.arms.got).toEqual([{ weapon: 'made-up', mods: [], fitted: [], mag: 5, reserve: 5 }]);
    expect(a.feed).toContain('THE HOST REFUSED THAT DROP: GUN RETURNED');
    game.dispose();
  });

  it('a drop the host never answers comes back, and its late number never makes a second gun', () => {
    const { game, hands, all, stand, run } = table(1);
    const [host, a] = hands as [Hands, Hands];
    stand(all[1]!, 10, 0);
    a.press('dropWeapon');
    // The wire holds the message: four seconds with no word.
    for (let i = 0; i < 60 * 4 + 2; i++) a.frame();
    expect(a.guns.list).toHaveLength(0);
    expect(a.arms.got.map(k => k.weapon)).toEqual(['deuce']);
    // Now it gets through, late.
    game.relay.flush();
    run(0.1);
    expect(host.guns.list).toHaveLength(0);
    expect(a.guns.list).toHaveLength(0);
    expect(a.arms.got).toHaveLength(1);
    game.dispose();
  });

  it("a guest's drop the host lays somewhere else lies there on the dropper's screen too", () => {
    const { game, hands, all, stand } = table(2);
    const [host, a, b] = hands as [Hands, Hands, Hands];
    stand(all[1]!, 10, 0);
    // The host still sees this guest 30 m away (a stale pose under lag): it lays the gun at the feet it sees.
    const seen = (game.host.session.remotes.get(game.guests[0]!.lobby.you) as unknown as { char: { root: THREE.Object3D } }).char.root;
    Object.defineProperty(seen, 'position', { value: new THREE.Vector3(40, 0, 0) });
    a.press('dropWeapon');
    expect(a.guns.list[0]!.at).toEqual([10, 0, -1.3]);
    game.relay.flush();
    expect([host, a, b].map(h => h.guns.list.map(g => g.at))).toEqual(Array(3).fill([[40, 0, 0]]));
    game.dispose();
  });

  it('checks what a guest sends: a drop far from its body lands at its feet, a far take is refused, junk is ignored', () => {
    const { game, hands, all, stand } = table(1);
    const [host, a] = hands as [Hands, Hands];
    stand(all[1]!, 10, 0);
    const send = (data: unknown) => { game.guests[0]!.room.channel('action').send(batchOf('shared-test', [data])); game.relay.flush(); };
    send({ t: 'gun', op: 'drop', q: 1, fall: 9999, gun: { weapon: 'smg', mods: ['deuceQuad', 7], fitted: ['deuceQuad'], mag: 1e9, reserve: -4, id: 0, at: [500, 0, 500], by: 'x' } });
    expect(lying(host)).toEqual([{ id: 1, weapon: 'smg', fitted: [], mag: 60, reserve: 0, by: 'GUEST1', at: [10, 0, 0] }]);
    stand(all[1]!, 100, 100);
    send({ t: 'gun', op: 'take', id: 1 });
    expect(host.guns.list).toHaveLength(1);
    for (const junk of [{ t: 'gun' }, { t: 'gun', op: 'take', id: 'x' }, { t: 'gun', op: 'void', id: 99 }, { t: 'gun', op: 'drop' }, { t: 'gun', op: 'add', gun: null }, { t: 'gun', op: 'give', gun: { weapon: 'smg', mods: [], fitted: [], mag: 1, reserve: 1 } }]) send(junk);
    expect(host.guns.list).toHaveLength(1);
    expect(host.arms.got).toHaveLength(0);
    expect(a.arms.got).toHaveLength(0);
    game.dispose();
  });
});

describe('dropped guns solo', () => {
  it('as before on level ground: thrown 1.3 m ahead, taken by walking over a gun not owned, never by its dropper', () => {
    const { ctx, player } = stubGame();
    const me = arm(ctx);
    me.press('dropWeapon');
    expect(lying(me)).toEqual([{ id: 1, weapon: 'deuce', fitted: ['deuceQuad'], mag: 2, reserve: 9, by: '', at: [0, 0, -1.3] }]);
    player.position.set(0, 0, -1.3);
    for (let i = 0; i < 60; i++) me.frame();
    // My own drop: walking over it does nothing.
    expect(me.arms.got).toHaveLength(0);
    me.press('interact');
    expect(me.arms.got).toHaveLength(1);
    expect(me.guns.list).toHaveLength(0);
  });

  it('comes to rest on the ground below a ledge and short of a wall, on real physics', async () => {
    const r = await makeRange();
    r.reset();
    const me = arm(r.ctx);
    // On a deck 6 m up whose edge is half a metre ahead: the gun goes over and lies on the floor below.
    r.physics.addStaticBox(new THREE.Vector3(0, 5.5, 5), new THREE.Vector3(3, 0.5, 5.5), null, 'metal');
    r.physics.flushQueries();
    r.player.position.set(0, 6, 0);
    (r.player as unknown as { forward: THREE.Vector3 }).forward = new THREE.Vector3(0, -0.6, -0.8);
    me.press('dropWeapon');
    const off = me.guns.list[0]!;
    expect(off.at[2]).toBeCloseTo(-1.3, 3);
    expect(off.at[1]).toBeCloseTo(0, 3);
    expect((off as unknown as { fall: number }).fall).toBeCloseTo(6.9, 3);
    // Back on the deck, facing a wall 0.8 m away: it stops short of the wall, on the deck.
    r.physics.addStaticBox(new THREE.Vector3(0, 8, 5.9), new THREE.Vector3(3, 2, 0.1), null, 'concrete');
    r.physics.flushQueries();
    r.player.position.set(0, 6, 5);
    (r.player as unknown as { forward: THREE.Vector3 }).forward = new THREE.Vector3(0, 0, 1);
    me.arms.owned.add('deuce');
    me.press('dropWeapon');
    const short = me.guns.list[1]!;
    expect(short.at[2]).toBeCloseTo(5.4, 2);
    expect(short.at[1]).toBeCloseTo(6, 3);
  });
});
