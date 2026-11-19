/**
 * Call-ins on the wire: a caller's order, news and Frame reach every other player's game with the caller's slot, a guest's
 * through the host; junk and floods are dropped; the host notes the call so the caller's damage passes; and a blast that is a
 * copy, or that the copies draw, never goes out as a `boom`.
 */
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Ctx, GameEvents } from '../../core/contracts';
import type { ExplosionSpec } from '../../core/gameplay';
import { EventBus } from '../../core/events';
import { AirliftCopy } from '../../enemies/outpost/airlift';
import type { CallinLink, CallNews, CallOrder } from '../../progression/callins/link';
import type { CoopSession } from '../index';
import { Lobby } from '../lobby';
import type { NetRoom } from '../room';
import { CoopWorld } from '../world';
import type { WorldEvent } from '../worldProtocol';
import { eventOf } from './pack';

class Relay {
  readonly rooms: Room[] = [];
  readonly queue: (() => void)[] = [];
  readonly packets: { from: string; lane: string; data: unknown }[] = [];
  open(id: string): Room {
    const room = new Room(id, this);
    for (const peer of this.rooms) this.queue.push(() => { peer.join(id); room.join(peer.id); });
    this.rooms.push(room);
    return room;
  }
  flush(): void { while (this.queue.length) this.queue.shift()!(); }
}
class Room implements NetRoom {
  readonly handlers = new Map<string, (data: unknown, from: string) => void>();
  join: (id: string) => void = () => {};
  constructor(readonly id: string, private readonly relay: Relay) {}
  channel<T>(lane: string) {
    return {
      on: (handler: (data: T, from: string) => void) => this.handlers.set(lane, handler as (data: unknown, from: string) => void),
      send: (data: T, to?: string) => {
        this.relay.packets.push({ from: this.id, lane, data: structuredClone(data) });
        for (const peer of this.relay.rooms) if (peer !== this && (!to || peer.id === to)) {
          const copied = structuredClone(data);
          this.relay.queue.push(() => peer.handlers.get(lane)?.(copied, this.id));
        }
      },
    };
  }
  onPeerJoin(handler: (id: string) => void) { this.join = handler; }
  onPeerLeave() {}
  onError() {}
  leave() {}
}

function fakeLink() {
  const log = { orders: [] as { slot: number; order: CallOrder }[], news: [] as { slot: number; news: CallNews }[],
    mech: [] as { slot: number; pose: number[] | null }[], mechNews: [] as { slot: number; kind: string; values: number[] }[],
    dropped: [] as number[], shotDown: [] as string[],
    /** What this side has running of its own, and its copies of the others', as a test sets them. */
    running: [] as CallOrder[], copies: new Map<number, CallOrder[]>() };
  const link: CallinLink = {
    send: null,
    order: (slot, order) => void log.orders.push({ slot, order }),
    news: (slot, news) => void log.news.push({ slot, news }),
    mech: (slot, pose) => void log.mech.push({ slot, pose }),
    mechNews: (slot, kind, values) => void log.mechNews.push({ slot, kind, values }),
    drop: slot => void log.dropped.push(slot),
    has: () => true,
    inFrame: () => false,
    shootDown: id => (log.shotDown.push(id), true),
    runningOrders: () => log.running,
    copyOrders: slot => log.copies.get(slot) ?? [],
  };
  return { link, log };
}

function context() {
  const events = new EventBus<GameEvents>();
  const side = fakeLink();
  const player = { position: new THREE.Vector3(), eye: new THREE.Vector3(0, 1.6, 0), forward: new THREE.Vector3(0, 0, -1), velocity: new THREE.Vector3(),
    alive: true, health: 100, maxHealth: 100, armor: 0, grounded: true, downed: false, parked: false, reset: vi.fn(), teleport: vi.fn(), takeDamage: vi.fn() };
  const ctx = { events, player, enemies: { alive: [], spawn: vi.fn(), withdraw: vi.fn(), applyDamage: vi.fn(), replayDeath: vi.fn(), placeReplica: vi.fn() },
    weapons: { current: 'smg' }, waves: { wave: 1 }, physics: { raycast: vi.fn(() => null) },
    world: { playerSpawns: [{ position: new THREE.Vector3(4, 0, 4), yaw: 0 }] }, hud: { feed: vi.fn(), follow: vi.fn(() => () => {}), callout: vi.fn() },
    time: { dt: 0.016, realDt: 0.016, frame: 0 }, progression: { kills: 0, score: 0, headshots: 0, resume: vi.fn(), callinLink: side.link }, contracts: { wallet: { credits: 0 } },
    camera: { setSeat: vi.fn(), addTrauma: vi.fn() }, input: { pressed: vi.fn(() => false), isDown: vi.fn(() => false) },
    fx: { tracer: vi.fn(), muzzleFlash: vi.fn(), bloodHit: vi.fn(), impact: vi.fn(), explosion: vi.fn() }, gore: { wound: vi.fn(), sever: vi.fn() },
    audio: { play: vi.fn() }, combat: { fireRay: vi.fn(), explode: vi.fn() } } as unknown as Ctx;
  return { ctx, ...side };
}

/** A host and two guests, each with a world and a stand-in for the game's call-ins. */
function party() {
  const relay = new Relay();
  const rooms = ['host-peer', 'guest-a', 'guest-b'].map(id => relay.open(id));
  const lobbies = rooms.map((room, i) => new Lobby({ main: room, door: () => new Room('door', new Relay()) }, i === 0, ['HOST', 'ALPHA', 'BRAVO'][i]!, 'test'));
  relay.flush(); lobbies[0]!.startMatch('crucible', 'callins-test'); relay.flush();
  const games = lobbies.map(() => context());
  const body = () => ({ char: { root: new THREE.Group(), anim: { play: vi.fn() } }, buffer: { sample: () => ({ velocity: [0, 0, 0], yaw: 0 }) }, setTag: vi.fn(),
    muzzle: (v: THREE.Vector3) => v, hidden: false, player: { slot: 1 } });
  const sessions = lobbies.map((lobby, i) => ({ lobby, hosting: i === 0, match: lobby.match,
    remotes: new Map(lobbies.filter(other => other !== lobby).map(other => [i === 0 ? other.you : other.you, body()])) }) as unknown as CoopSession);
  const worlds = games.map((game, i) => new CoopWorld(game.ctx, sessions[i]!));
  for (const world of worlds) world.begin();
  // Each guest's world says it is up (`worldsync`); the host settles its seat and catches it up before the test begins.
  relay.flush();
  const slotOf = (i: number) => lobbies[i]!.me!.slot;
  return { relay, lobbies, games, worlds, slotOf, dispose: () => { for (const world of worlds) world.dispose(); } };
}

const ORDER: CallOrder = { n: 7, id: 'warthog', at: [12.3456789, 0, -40], yaw: 1.23456789, seed: 123456789, ai: false, age: 0 };
const events = (relay: Relay, from: string, t: string) => relay.packets.filter(p => p.from === from && p.lane === 'action' && eventOf<WorldEvent>(p.data).t === t)
  .map(p => eventOf<Record<string, unknown>>(p.data));

describe('call-ins over the mocked lobby transport', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] }));
  afterEach(() => vi.useRealTimers());

  it("the host's order starts the same call-in on every guest, with the host's slot and the numbers rounded", () => {
    const p = party();
    expect(p.games[0]!.link.send).not.toBeNull();
    p.games[0]!.link.send!.order(ORDER);
    p.relay.flush();
    for (const guest of [p.games[1]!, p.games[2]!]) {
      expect(guest.log.orders).toHaveLength(1);
      expect(guest.log.orders[0]!.slot).toBe(0);
      expect(guest.log.orders[0]!.order).toMatchObject({ n: 7, id: 'warthog', at: [12.346, 0, -40], yaw: 1.235, seed: 123456789, ai: false });
    }
    // The host does not play its own.
    expect(p.games[0]!.log.orders).toHaveLength(0);
    p.dispose();
  });

  it("a guest's order is played by the host and passed on to the other guest, with the caller's slot stamped by the host", () => {
    const p = party();
    const told: unknown[] = [];
    p.games[0]!.ctx.events.on('callin:teammate', e => told.push(e));
    const callIn = vi.spyOn(p.worlds[0]!.validator, 'callIn');
    // The guest claims to be slot 0: the host stamps the real one.
    p.games[1]!.link.send!.order({ ...ORDER, ai: true });
    p.relay.flush();
    const slot = p.slotOf(1);
    expect(p.games[0]!.log.orders).toEqual([{ slot, order: expect.objectContaining({ id: 'warthog', n: 7, ai: true }) }]);
    expect(p.games[2]!.log.orders).toEqual([{ slot, order: expect.objectContaining({ id: 'warthog', n: 7, ai: true }) }]);
    expect(p.games[1]!.log.orders).toHaveLength(0);
    // The host notes the call (the caller's call-in damage will pass) and tells the Commander.
    expect(callIn).toHaveBeenCalledWith(p.lobbies[1]!.you, expect.any(Number));
    expect(told).toEqual([expect.objectContaining({ id: 'warthog', slot })]);
    p.dispose();
  });

  it('news of a running call-in follows the same road, and names its kind', () => {
    const p = party();
    p.games[1]!.link.send!.news({ n: 7, k: 'steer', v: [1.00049, 2, 3] });
    p.games[1]!.link.send!.news({ n: 7, k: 'release' });
    p.games[0]!.link.send!.news({ n: 3, k: 'down' });
    p.relay.flush();
    const slot = p.slotOf(1);
    expect(p.games[0]!.log.news).toEqual([{ slot, news: { n: 7, k: 'steer', v: [1, 2, 3] } }, { slot, news: { n: 7, k: 'release' } }]);
    // The other guest hears both callers: the host's own word, and the first guest's passed on in the order it was said.
    expect(p.games[2]!.log.news.filter(n => n.slot === slot)).toEqual([{ slot, news: { n: 7, k: 'steer', v: [1, 2, 3] } }, { slot, news: { n: 7, k: 'release' } }]);
    expect(p.games[2]!.log.news.filter(n => n.slot === 0)).toEqual([{ slot: 0, news: { n: 3, k: 'down' } }]);
    expect(p.games[1]!.log.news).toEqual([{ slot: 0, news: { n: 3, k: 'down' } }]);
    p.dispose();
  });

  it("a player's Frame: the pose, what it fires, and leaving it", () => {
    const p = party();
    const pose = Array.from({ length: 13 }, (_, i) => i + 0.5);
    p.games[1]!.link.send!.mech(pose);
    p.games[1]!.link.send!.mechNews('shell', [1, 2, 3, 4, 5, 6, 7, 0.4]);
    p.games[1]!.link.send!.mechNews('stomp', [5]);
    p.games[1]!.link.send!.mech(null);
    p.relay.flush();
    const slot = p.slotOf(1);
    for (const game of [p.games[0]!, p.games[2]!]) {
      expect(game.log.mech).toEqual([{ slot, pose }, { slot, pose: null }]);
      expect(game.log.mechNews).toEqual([{ slot, kind: 'shell', values: [1, 2, 3, 4, 5, 6, 7, 0.4] }, { slot, kind: 'stomp', values: [5] }]);
    }
    p.dispose();
  });

  it('drops junk, and a flood past what a player may send a second', () => {
    const p = party();
    const junk: unknown[] = [
      { t: 'cin', id: 'warthog', n: 1, at: [0, 0, 0], yaw: 0 }, { t: 'cin', id: 'bfg', n: 1, at: [0, 0, 0], yaw: 0, seed: 1 },
      { t: 'cin', id: 'warthog', n: 999, at: [0, 0, 0], yaw: 0, seed: 1 }, { t: 'cin', id: 'warthog', n: 1, at: [0, NaN, 0], yaw: 0, seed: 1 },
      { t: 'cin', id: 'warthog', n: 1, at: 'here', yaw: 0, seed: 1 }, { t: 'cin', id: 'toString', n: 1, at: [0, 0, 0], yaw: 0, seed: 1 },
      { t: 'cnews', n: 1, k: 99 }, { t: 'cnews', n: 1, k: 0, v: 'x' }, { t: 'cnews', n: 1, k: 0, v: [1, Infinity] }, { t: 'cnews', n: 1, k: 0, v: Array(40).fill(1) },
      { t: 'cnews', n: -1, k: 0 }, { t: 'mech', p: [1, 2, 3] }, { t: 'mech', p: Array(13).fill('a') }, { t: 'mech', k: 42 }, { t: 'mech', k: 0, v: [1e9] },
      { t: 'aadown', id: 'ac130' },
    ];
    const lane = p.lobbies[1]!.events<unknown>('action', () => {});
    const send = (event: unknown) => lane.send(event);
    for (const event of junk) send(event);
    p.relay.flush();
    expect(p.games[0]!.log.orders).toHaveLength(0);
    expect(p.games[0]!.log.news).toHaveLength(0);
    expect(p.games[0]!.log.mechNews).toHaveLength(0);
    // A Frame's pose is thirteen numbers or it is nothing; a `mech` with neither pose nor kind is the player leaving.
    expect(p.games[0]!.log.mech.every(m => m.pose === null)).toBe(true);
    // A guest cannot have the host's aircraft shot down.
    expect(p.games[0]!.log.shotDown).toHaveLength(0);
    // Twenty orders in one second: four get through.
    for (let n = 0; n < 20; n++) p.games[1]!.link.send!.order({ ...ORDER, n });
    p.relay.flush();
    expect(p.games[0]!.log.orders).toHaveLength(4);
    expect(p.games[2]!.log.orders).toHaveLength(4);
    p.dispose();
  });

  it("the Commander's missile on a guest's aircraft is that guest's own game's to bring down", () => {
    const p = party();
    const slot = p.slotOf(2);
    expect(p.worlds[0]!.shootDown(slot, 'ac130')).toBe(true);
    // Never the host's own, and never from a guest.
    expect(p.worlds[0]!.shootDown(0, 'ac130')).toBe(false);
    expect(p.worlds[1]!.shootDown(slot, 'ac130')).toBe(false);
    p.relay.flush();
    expect(p.games[2]!.log.shotDown).toEqual(['ac130']);
    expect(p.games[1]!.log.shotDown).toHaveLength(0);
    p.dispose();
  });

  it('a blast that is a copy, or that the copies draw themselves, is never sent as a boom; an ordinary one is', () => {
    const p = party();
    const at = new THREE.Vector3(0, 0, -20);
    const blast: ExplosionSpec = { radius: 6, damage: 100, kind: 'rocket', source: 'airstrike', team: 'player' };
    p.worlds[1]!.blast(at, { ...blast, cosmetic: true });
    p.worlds[1]!.blast(at, { ...blast, mirrored: true });
    p.worlds[1]!.blast(at, { ...blast, worldObject: true });
    expect(events(p.relay, 'guest-a', 'boom')).toHaveLength(0);
    p.worlds[1]!.blast(at, blast);
    p.worlds[1]!.boom(at, 'barrel', 5);
    expect(events(p.relay, 'guest-a', 'boom')).toHaveLength(2);
    p.relay.flush();
    // Drawn on the host, and passed on to the other guest without the damage it carried for the host's vehicles.
    expect(p.games[0]!.ctx.fx.explosion).toHaveBeenCalledTimes(2);
    expect(p.games[2]!.ctx.fx.explosion).toHaveBeenCalledTimes(2);
    expect(events(p.relay, 'host-peer', 'boom').every(e => e.damage === undefined && e.slot === p.slotOf(1))).toBe(true);
    p.dispose();
  });

  it('a storm of small far blasts is thinned on its way out, and counted', () => {
    const p = party();
    const far = new THREE.Vector3(0, 0, -400);
    for (let i = 0; i < 100; i++) p.worlds[0]!.blast(far, { radius: 1.5, damage: 10, kind: 'hellfireBullet', source: 'smg', team: 'player' });
    // Two guests: each boom is two packets.
    expect(events(p.relay, 'host-peer', 'boom')).toHaveLength(24 * 2);
    expect(p.worlds[0]!.boomsDropped).toBe(76);
    // A big one still goes.
    p.worlds[0]!.blast(far, { radius: 20, damage: 10, kind: 'hellfire', source: 'airstrike', team: 'player' });
    expect(events(p.relay, 'host-peer', 'boom')).toHaveLength(25 * 2);
    p.dispose();
  });

  it("a streak perk's arc and frost ring are drawn on every other screen, a guest's through the host", () => {
    const p = party();
    for (const game of p.games) Object.assign(game.ctx.fx, { arc: vi.fn(), sparks: vi.fn(), ring: vi.fn() });
    p.worlds[1]!.perkFx('arc', new THREE.Vector3(1, 1, 1), new THREE.Vector3(4, 1, 1));
    p.worlds[0]!.perkFx('nova', new THREE.Vector3(0, 0, 0));
    p.relay.flush();
    const fx = (i: number) => p.games[i]!.ctx.fx as unknown as { arc: ReturnType<typeof vi.fn>; ring: ReturnType<typeof vi.fn> };
    expect(fx(0).arc).toHaveBeenCalledOnce();
    expect(fx(2).arc).toHaveBeenCalledOnce();
    expect(fx(1).arc).not.toHaveBeenCalled();
    expect(fx(1).ring).toHaveBeenCalledOnce();
    expect(fx(2).ring).toHaveBeenCalledOnce();
    expect(fx(0).ring).not.toHaveBeenCalled();
    // Junk draws nothing.
    const lane = p.lobbies[1]!.events<unknown>('action', () => {});
    const send = (event: unknown) => lane.send(event);
    send({ t: 'pfx', k: 0, a: [0, 0, 0] }); send({ t: 'pfx', k: 7, a: [0, 0, 0] }); send({ t: 'pfx', k: 1, a: 'x' });
    p.relay.flush();
    expect(fx(0).arc).toHaveBeenCalledOnce();
    expect(fx(0).ring).not.toHaveBeenCalled();
    p.dispose();
  });

  it('a player who arrives while call-ins are running is told each with its age: the host\'s own and its copies of the others\'', () => {
    const p = party();
    const [hostLog, aLog, bLog] = p.games.map(g => g.log) as [ReturnType<typeof fakeLink>['log'], ReturnType<typeof fakeLink>['log'], ReturnType<typeof fakeLink>['log']];
    hostLog.running.push({ n: 3, id: 'ac130', at: [1, 0, 2], yaw: 0.5, seed: 77, ai: true, age: 41.239 });
    hostLog.copies.set(p.slotOf(1), [{ n: 9, id: 'nuke', at: [5, 0, 5], yaw: 0, seed: 1, ai: false, age: 6 }]);
    hostLog.copies.set(p.slotOf(2), [{ n: 2, id: 'warthog', at: [8, 0, 8], yaw: 1, seed: 4, ai: false, age: 2 }]);
    aLog.orders.length = 0; bLog.orders.length = 0;
    const calls = (p.worlds[0] as unknown as { calls: { catchUp(id: string): void } }).calls;
    calls.catchUp(p.lobbies[2]!.you);
    p.relay.flush();
    // The arriving guest: the host's gunship 41 s in, and the other guest's nuke 6 s in. Not its own Warthog back.
    expect(bLog.orders.map(o => [o.slot, o.order.id, o.order.n, o.order.age])).toEqual([[0, 'ac130', 3, 41.24], [p.slotOf(1), 'nuke', 9, 6]]);
    expect(bLog.orders[0]!.order).toMatchObject({ at: [1, 0, 2], yaw: 0.5, seed: 77, ai: true });
    // Nobody else is told anything again.
    expect(aLog.orders).toEqual([]);
    p.dispose();
  });

  it('a guest back after a drop says again what it still has running, with its age; the host passes it on once and wakes no one', () => {
    const p = party();
    const [hostLog, aLog, bLog] = p.games.map(g => g.log) as [ReturnType<typeof fakeLink>['log'], ReturnType<typeof fakeLink>['log'], ReturnType<typeof fakeLink>['log']];
    const teammate = vi.fn();
    p.games[0]!.ctx.events.on('callin:teammate', teammate);
    aLog.running.push({ n: 5, id: 'attackChopper', at: [0, 0, 0], yaw: 0, seed: 0, ai: false, age: 12.5 },
      { n: 6, id: 'sentry', at: [3, 0, 3], yaw: 1, seed: 2, ai: false, age: 30 });
    hostLog.orders.length = 0; bLog.orders.length = 0;
    (p.worlds[1] as unknown as { calls: { resay(): void } }).calls.resay();
    p.relay.flush();
    for (const log of [hostLog, bLog]) expect(log.orders.map(o => [o.slot, o.order.id, o.order.age])).toEqual([[p.slotOf(1), 'attackChopper', 12.5], [p.slotOf(1), 'sentry', 30]]);
    // Said again is not called again: the Commander does not answer it a second time.
    expect(teammate).not.toHaveBeenCalled();
    // An age from another browser is bounded, and junk is no age at all.
    const send = p.lobbies[1]!.gameplay<unknown>('action', () => {});
    hostLog.orders.length = 0;
    send({ t: 'cin', id: 'nuke', n: 7, at: [0, 0, 0], yaw: 0, seed: 1, age: 1e9 });
    send({ t: 'cin', id: 'nuke', n: 8, at: [0, 0, 0], yaw: 0, seed: 1, age: 'old' });
    p.relay.flush();
    expect(hostLog.orders.map(o => o.order.age)).toEqual([900, 0]);
    p.dispose();
  });

  it("the skyhook: the host's pass starts the same pass on every guest, and its end calls it off", () => {
    const p = party();
    const begin = vi.spyOn(AirliftCopy.prototype, 'begin').mockImplementation(() => {});
    const cancel = vi.spyOn(AirliftCopy.prototype, 'cancel').mockImplementation(() => {});
    const airlift = { onPass: null as null | ((uid: number, at: THREE.Vector3 | null, dir: THREE.Vector3, lead: number) => void) };
    // The outpost's prisoners, as far as the world's modules ask of them here: nobody is held, and there is an airlift.
    const captives = new Proxy({ airlift } as Record<string, unknown>, { get: (t, k) => (k in t ? t[k as string] : () => null) });
    (p.games[0]!.ctx.enemies as unknown as { outpost: unknown }).outpost = { captives };
    p.worlds[0]!.update();
    expect(airlift.onPass).not.toBeNull();
    airlift.onPass!(7, new THREE.Vector3(3, 0.9, -12), new THREE.Vector3(0.6, 0, 0.8), 1.2);
    p.relay.flush();
    expect(begin).toHaveBeenCalledTimes(2);
    expect(begin.mock.calls[0]![0]).toBe(7);
    expect((begin.mock.calls[0]![1] as THREE.Vector3).toArray()).toEqual([3, 0.9, -12]);
    expect(begin.mock.calls[0]![3]).toBe(1.2);
    airlift.onPass!(7, null, new THREE.Vector3(1, 0, 0), 0);
    p.relay.flush();
    expect(cancel).toHaveBeenCalledWith(7);
    // A guest cannot send drones to the others, and junk starts nothing.
    const lane = p.lobbies[1]!.events<unknown>('action', () => {});
    const send = (event: unknown) => lane.send(event);
    send({ t: 'airlift', uid: 9, at: [0, 0, 0], dir: [1, 0], in: 1 });
    p.relay.flush();
    expect(begin).toHaveBeenCalledTimes(2);
    // A player who arrives while a drone is on its way gets that pass with the seconds it has left, and only they do.
    vi.useFakeTimers({ toFake: ['performance'] });
    try {
      airlift.onPass!(11, new THREE.Vector3(1, 0.9, -4), new THREE.Vector3(1, 0, 0), 3);
      p.relay.flush();
      begin.mockClear();
      vi.advanceTimersByTime(1000);
      const hook = (p.worlds[0] as unknown as { hook: { catchUp(id: string): void } }).hook;
      hook.catchUp(p.lobbies[2]!.you);
      p.relay.flush();
      expect(begin).toHaveBeenCalledOnce();
      expect(begin.mock.calls[0]![0]).toBe(11);
      expect(begin.mock.calls[0]![3]).toBeCloseTo(2, 1);
      // Once the hook has taken him there is nothing left to tell.
      vi.advanceTimersByTime(2500);
      begin.mockClear();
      hook.catchUp(p.lobbies[2]!.you); p.relay.flush();
      expect(begin).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
    const hostLane = p.lobbies[0]!.events<unknown>('action', () => {});
    const fromHost = (event: unknown) => hostLane.send(event);
    fromHost({ t: 'airlift', uid: 9, at: [0, NaN, 0], dir: [1, 0], in: 1 });
    fromHost({ t: 'airlift', uid: 9, at: [0, 0, 0], dir: [0, 0], in: 1 });
    p.relay.flush();
    expect(begin).not.toHaveBeenCalled();
    begin.mockRestore(); cancel.mockRestore();
    p.dispose();
  });

  it('a player who leaves takes their call-ins with them', () => {
    const p = party();
    p.worlds[0]!.update();
    const slot = p.slotOf(2);
    // The lobby's list is what says who is here.
    (p.lobbies[0]! as unknown as { players: unknown[] }).players = p.lobbies[0]!.players.filter(player => player.slot !== slot);
    p.worlds[0]!.update();
    expect(p.games[0]!.log.dropped).toEqual([slot]);
    p.dispose();
  });
});
