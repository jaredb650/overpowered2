/**
 * No honest claim is lost: a guest's damage is applied whether or not the host has that guest's body yet, what needs the body
 * (a shot to draw, a prisoner's key) waits a moment for it, and every claim the host refuses is counted and written down
 * with its reason.
 */
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CoopSession } from '../index';
import type { CoopWorld } from '../world';
import { goreDoubles } from './goreDoubles';
import { LATE_KEPT, LATE_MS } from './late';
import { party } from './testkit';

const sessionOf = (world: CoopWorld) => (world as unknown as { session: CoopSession }).session;

function game(guests = 1) {
  const g = party(guests);
  for (const side of [g.host, ...g.guests]) Object.assign(side.manager, goreDoubles(), { afflict: vi.fn() });
  const remotes = sessionOf(g.hw).remotes as unknown as Map<string, { buffer: { sample: () => unknown }; watcher?: unknown; player: { slot: number } }>;
  const id = g.guestLobbies[0]!.you!;
  const body = remotes.get(id)!;
  const pose = body.buffer.sample;
  /** The host has no pose from the first guest yet / has one. */
  const bodied = (on: boolean) => { body.buffer.sample = on ? pose : () => null; };
  const enemy = g.host.manager.spawn('husk', new THREE.Vector3(0, 0, -8));
  const copy = g.guests[0]!.manager.spawn('husk', new THREE.Vector3(0, 0, -8));
  copy.uid = enemy.uid;
  const shoot = (source = 'smg', amount = 20) => {
    g.guests[0]!.ctx.events.emit('weapon:fired', { weapon: 'smg', origin: new THREE.Vector3(3, 1.6, -5), dir: new THREE.Vector3(0, 0, -1) } as never);
    g.gws[0]!.claim(copy, { amount, type: 'bullet', source, point: copy.center.clone(), dir: new THREE.Vector3(0, 0, -1), force: 1, region: 'chest' });
    g.relay.flush();
  };
  return { ...g, id, body, bodied, enemy, copy, shoot };
}

describe('a claim from a guest whose body the host does not have yet', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['performance'] }); vi.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('a hit is applied at once, checked against the eye it names', () => {
    const g = game();
    g.guests[0]!.player.eye.set(3, 1.6, -5);
    g.bodied(false);
    g.shoot();
    expect(g.host.manager.applyDamage).toHaveBeenCalledTimes(1);
    expect(g.hw.claimBooks).toMatchObject({ received: { hit: 1 }, refusedTotal: 0, accepted: 1 });
    expect(g.gws[0]!.claimBooks.sent.hit).toBe(1);
    g.dispose();
  });

  it('fire, frost and a vehicle hit are applied at once too', () => {
    const g = game();
    g.bodied(false);
    g.gws[0]!.status(g.copy, 'burn', 4);
    g.relay.flush();
    expect((g.host.manager as unknown as { afflict: unknown }).afflict).toHaveBeenCalledWith(g.enemy, 'burn', 4);
    expect(g.hw.claimBooks.received.status).toBe(1);
    g.dispose();
  });

  it('a shot to draw waits for the body, in order, and is drawn and passed on when it comes', () => {
    const g = game(2);
    // The watcher is handed one reused vector: read it as it comes.
    const from: number[] = [];
    const watcher = { fire: vi.fn((_w: unknown, origin: THREE.Vector3) => { from.push(+origin.z.toFixed(1)); }), launch: vi.fn(), loop: vi.fn(), landed: vi.fn(), meleeFx: vi.fn(), hold: vi.fn(), held: true };
    g.body.watcher = watcher;
    g.bodied(false);
    const fired = (z: number) => g.sendFrom(0, { t: 'fire', weapon: 'smg', origin: [3, 1.6, z], dir: [0, 0, -1] });
    fired(-5); fired(-5.1); fired(-5.2);
    g.relay.flush();
    expect(watcher.fire).not.toHaveBeenCalled();
    expect(g.relay.sent('fire').filter(e => (e as { slot?: number }).slot !== undefined)).toHaveLength(0);
    expect(g.hw.claimBooks.late).toMatchObject({ held: 3, run: 0, dropped: 0 });
    // The first pose arrives.
    g.bodied(true);
    vi.advanceTimersByTime(50);
    g.step();
    expect(watcher.fire).toHaveBeenCalledTimes(3);
    expect(from).toEqual([-5, -5.1, -5.2]);
    // And the other guest was sent each, with the shooter's slot stamped.
    expect(g.relay.sent('fire').filter(e => (e as { slot?: number }).slot === g.body.player.slot)).toHaveLength(3);
    expect(g.hw.claimBooks.late).toMatchObject({ held: 3, run: 3, dropped: 0 });
    g.dispose();
  });

  it('a shot that comes while earlier ones wait goes behind them, not in front', () => {
    const g = game();
    const from: number[] = [];
    const watcher = { fire: vi.fn((_w: unknown, origin: THREE.Vector3) => { from.push(origin.z); }), launch: vi.fn(), loop: vi.fn(), landed: vi.fn(), meleeFx: vi.fn(), hold: vi.fn(), held: true };
    g.body.watcher = watcher;
    g.bodied(false);
    g.sendFrom(0, { t: 'fire', weapon: 'smg', origin: [3, 1.6, -5], dir: [0, 0, -1] });
    g.relay.flush();
    g.bodied(true);
    g.sendFrom(0, { t: 'fire', weapon: 'smg', origin: [3, 1.6, -6], dir: [0, 0, -1] });
    g.relay.flush();
    expect(from).toEqual([-5, -6]);
    g.dispose();
  });

  it('gives up after two seconds without a body, counts it and says so; never more than a held trigger is kept', () => {
    const g = game();
    g.bodied(false);
    for (let i = 0; i < LATE_KEPT + 5; i++) g.sendFrom(0, { t: 'fire', weapon: 'smg', origin: [3, 1.6, -5], dir: [0, 0, -1] });
    g.relay.flush();
    expect(g.hw.claimBooks.late).toMatchObject({ held: LATE_KEPT + 5, dropped: 5 });
    vi.advanceTimersByTime(LATE_MS + 100);
    g.step();
    expect(g.hw.claimBooks.late).toMatchObject({ run: 0, dropped: LATE_KEPT + 5 });
    expect(console.warn).toHaveBeenCalled();
    g.dispose();
  });
});

describe('a claim the host refuses', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['performance'] }); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('is counted, kept with its reason and written to the console', () => {
    const g = game();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // From 400 m off the body the host has for that guest: no weapon does that.
    g.guests[0]!.player.eye.set(400, 1.6, -5);
    g.shoot();
    expect(g.host.manager.applyDamage).not.toHaveBeenCalled();
    const books = g.hw.claimBooks;
    expect(books).toMatchObject({ received: { hit: 1 }, refusedTotal: 1, accepted: 0 });
    expect(books.refused.eye).toBe(1);
    expect(books.refusals.at(-1)).toMatchObject({ t: 'hit', why: 'eye', source: 'smg', target: g.enemy.uid, from: g.id });
    expect(warn.mock.calls.some(call => /Refused a claim from GUEST1: eye \(hit smg on #/.test(String(call[0])))).toBe(true);
    // Junk is a refusal with a reason too.
    g.sendFrom(0, { t: 'status', uid: g.enemy.uid, kind: 'melt', s: 3 });
    g.sendFrom(0, { t: 'vhit', id: 1, point: [0, 0, 0], amount: -4, source: 'smg' });
    g.relay.flush();
    expect(g.hw.claimBooks.refusedTotal).toBe(3);
    expect(g.hw.claimBooks.refusals.slice(-2).map(r => [r.t, r.why])).toEqual([['status', 'shape'], ['vhit', 'shape']]);
    g.dispose();
  });

  it('an enemy already dead on the host is not a refusal: nobody lost a hit', () => {
    const g = game();
    g.guests[0]!.player.eye.set(3, 1.6, -5);
    g.host.manager.withdraw(g.enemy);
    g.shoot();
    expect(g.hw.claimBooks).toMatchObject({ received: { hit: 1 }, refusedTotal: 0 });
    expect(g.hw.claimBooks.refused.gone).toBe(1);
    g.dispose();
  });

  it('the very same hit delivered twice is applied once, counted, and the answer to the first stands', () => {
    const g = game();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    g.guests[0]!.player.eye.set(3, 1.6, -5);
    g.shoot();
    expect(g.host.manager.applyDamage).toHaveBeenCalledTimes(1);
    const sent = g.relay.sent('hit').at(-1)!;
    g.sendFrom(0, sent);
    g.relay.flush();
    expect(g.host.manager.applyDamage).toHaveBeenCalledTimes(1);
    expect(g.hw.claimBooks).toMatchObject({ received: { hit: 2 }, refusedTotal: 1, accepted: 1 });
    expect(g.hw.claimBooks.refused.replay).toBe(1);
    expect(g.relay.sent('nack')).toHaveLength(0);
    g.dispose();
  });

  it('nothing a guest adds to a claim rides into the damage model with it', () => {
    const g = game();
    g.guests[0]!.player.eye.set(3, 1.6, -5);
    g.shoot();
    const sent = structuredClone(g.relay.sent<{ t: 'hit'; at: number; damage: Record<string, unknown> }>('hit').at(-1)!);
    sent.at += 50;
    Object.assign(sent.damage, { claim: 9, from: [0, 0, 0], torso: 'blowout', spill: true, killed: true, vaporize: 'yes', gib: 1 });
    g.sendFrom(0, sent);
    g.relay.flush();
    expect(g.host.manager.applyDamage).toHaveBeenCalledTimes(2);
    const applied = g.host.manager.applyDamage.mock.calls[1]![1] as Record<string, unknown>;
    for (const never of ['from', 'torso', 'spill', 'killed', 'vaporize', 'gib']) expect(never in applied, never).toBe(false);
    expect(applied).toMatchObject({ amount: 20, type: 'bullet', source: 'smg', region: 'chest', claim: 9 });
    g.dispose();
  });

  it('a long honest fight refuses nothing', () => {
    const g = game();
    g.guests[0]!.player.eye.set(3, 1.6, -5);
    for (let i = 0; i < 400; i++) { vi.advanceTimersByTime(70); g.shoot('smg', 12); }
    expect(g.hw.claimBooks).toMatchObject({ received: { hit: 400 }, refusedTotal: 0, accepted: 400 });
    g.dispose();
  });
});
