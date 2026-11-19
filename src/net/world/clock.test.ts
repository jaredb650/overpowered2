import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Ctx, GameEvents } from '../../core/contracts';
import { EventBus } from '../../core/events';
import { GameTime } from '../../core/time';
import type { CoopSession } from '../index';
import { Lobby } from '../lobby';
import type { NetRoom } from '../room';
import { CoopWorld } from '../world';
import type { WorldEvent } from '../worldProtocol';
import { goreDoubles } from './goreDoubles';
import { SLOW, TEAM_SLOW } from './slow';

/** The mocked transport of world.test.ts: every message is copied and queued until `flush`, or thrown away with `lose`. */
class Relay {
  readonly rooms: Room[] = [];
  queue: { lane: string; data: unknown; run: () => void }[] = [];
  open(id: string): Room {
    const room = new Room(id, this);
    for (const peer of this.rooms) this.queue.push({ lane: '', data: null, run: () => { peer.join(id); room.join(peer.id); } });
    this.rooms.push(room);
    return room;
  }
  flush(): void { while (this.queue.length) this.queue.shift()!.run(); }
  /** Drops every queued message `match` picks: the network lost them. */
  lose(match: (event: WorldEvent) => boolean): number {
    const before = this.queue.length;
    this.queue = this.queue.filter(m => !(m.lane === 'action' && match((m.data as { data: WorldEvent }).data)));
    return before - this.queue.length;
  }
}
class Room implements NetRoom {
  readonly handlers = new Map<string, (data: unknown, from: string) => void>();
  join: (id: string) => void = () => {};
  constructor(readonly id: string, private readonly relay: Relay) {}
  channel<T>(lane: string) {
    return {
      on: (handler: (data: T, from: string) => void) => this.handlers.set(lane, handler as (data: unknown, from: string) => void),
      send: (data: T, to?: string) => {
        for (const peer of this.relay.rooms) if (peer !== this && (!to || peer.id === to)) {
          const copied = structuredClone(data);
          this.relay.queue.push({ lane, data: copied, run: () => peer.handlers.get(lane)?.(copied, this.id) });
        }
      },
    };
  }
  onPeerJoin(handler: (id: string) => void) { this.join = handler; }
  onPeerLeave() {}
  onError() {}
  leave() {}
}

function context() {
  const events = new EventBus<GameEvents>();
  const player = { position: new THREE.Vector3(), eye: new THREE.Vector3(0, 1.6, 0), forward: new THREE.Vector3(0, 0, -1), velocity: new THREE.Vector3(),
    alive: true, downed: false, health: 100, maxHealth: 100, armor: 0, grounded: true, parked: false, reset: vi.fn(), teleport: vi.fn(), takeDamage: vi.fn() };
  const chips = { meter: 1 };
  const ctx = { events, player, enemies: { alive: [], spawn: vi.fn(), withdraw: vi.fn(), applyDamage: vi.fn(), replayDeath: vi.fn(), placeReplica: vi.fn(), ...goreDoubles() },
    weapons: { current: 'smg', owned: [], ammo: () => ({ mag: 0, reserve: 0 }) }, waves: { wave: 1 }, physics: { raycast: vi.fn(() => null) },
    world: { playerSpawns: [{ position: new THREE.Vector3(4, 0, 4), yaw: 0 }] }, hud: { feed: vi.fn(), follow: vi.fn(() => () => {}), callout: vi.fn() },
    time: new GameTime(), progression: { kills: 0, score: 0, headshots: 0, resume: vi.fn(), shareGrade: vi.fn() }, contracts: { wallet: { credits: 0 }, chips },
    camera: { setSeat: vi.fn(), addTrauma: vi.fn() }, input: { pressed: vi.fn(() => false), isDown: vi.fn(() => false) },
    fx: { tracer: vi.fn(), muzzleFlash: vi.fn(), bloodHit: vi.fn(), impact: vi.fn() }, gore: { wound: vi.fn(), sever: vi.fn() },
    audio: { play: vi.fn() }, combat: { fireRay: vi.fn(), explode: vi.fn() } } as unknown as Ctx;
  return { ctx, player, chips, time: ctx.time, callout: ctx.hud.callout as ReturnType<typeof vi.fn>, sounds: ctx.audio.play as unknown as ReturnType<typeof vi.fn>,
    grade: (ctx.progression as unknown as { shareGrade: ReturnType<typeof vi.fn> }).shareGrade };
}

/** A host and `guests` guests in a Crucible match, each with a real game clock. `begin`: which guests' maps are up. */
function party(guests = 1, begin: boolean[] = []) {
  const relay = new Relay();
  const rooms = { door: () => new Room('door', new Relay()) };
  const hostLobby = new Lobby({ main: relay.open('host-peer'), ...rooms }, true, 'HOST', 'test');
  const guestLobbies = Array.from({ length: guests }, (_, i) => new Lobby({ main: relay.open(`guest-${i + 1}`), ...rooms }, false, `GUEST${i + 1}`, 'test'));
  relay.flush(); hostLobby.startMatch('crucible', 'clock-test'); relay.flush();
  const host = context();
  const body = () => ({ char: { root: new THREE.Group(), anim: { play: vi.fn() } }, buffer: { sample: () => ({ velocity: [0, 0, 0], yaw: 0 }) }, setTag: vi.fn(),
    muzzle: (v: THREE.Vector3) => v });
  const hs = { lobby: hostLobby, hosting: true, match: hostLobby.match, remotes: new Map(guestLobbies.map(l => [l.you, { player: l.me, ...body() }])) } as unknown as CoopSession;
  const hw = new CoopWorld(host.ctx, hs);
  hw.begin();
  const g = guestLobbies.map((lobby, i) => {
    const game = context();
    const world = new CoopWorld(game.ctx, { lobby, hosting: false, match: lobby.match, remotes: new Map() } as unknown as CoopSession);
    if (begin[i] !== false) world.begin();
    return { ...game, world, lobby, slot: lobby.me!.slot };
  });
  /** One frame on every screen, `ms` long: the clock, the tick, the world's update, and the network delivers. */
  const frame = (ms = 50, deliver = true) => {
    vi.advanceTimersByTime(ms);
    for (const side of [{ time: host.time, world: hw }, ...g]) { side.world.clock(); side.time.tick(ms / 1000); side.world.update(); }
    if (deliver) relay.flush();
  };
  const run = (seconds: number, ms = 50) => { for (let t = 0; t < seconds * 1000; t += ms) frame(ms); };
  const dispose = () => { hw.dispose(); for (const guest of g) guest.world.dispose(); };
  return { relay, host: { ...host, world: hw, lobby: hostLobby, slot: 0 }, g, frame, run, dispose };
}

const FADES = [0.12, 0.25] as const;

describe("the team's slow-mo over the mocked transport", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] }));
  afterEach(() => vi.useRealTimers());

  it("a guest's Focus slows the host's world and every screen, names the guest on all of them, and leaves every player at full speed", () => {
    const game = party(2);
    const [a, b] = game.g as [typeof game.g[number], typeof game.g[number]];
    game.run(0.2);
    a.time.pushScale('focus', 0.35, ...FADES);
    // On its own screen at once, before the host has heard.
    expect(a.world.slowHeld('focus')).toBe(true);
    expect(a.world.slows.map(e => [e.slot, e.kind])).toEqual([[a.slot, 'focus']]);
    expect(game.host.world.slows).toHaveLength(0);
    game.run(0.5);
    for (const side of [game.host, a, b]) {
      expect(side.world.slows.map(e => [e.slot, e.kind, e.scale])).toEqual([[a.slot, 'focus', 0.35]]);
      expect(side.time.slowmo).toBeCloseTo(0.35, 2);
      // The world clock is slowed, the player's own is not.
      expect(side.time.dt).toBeCloseTo(0.05 * 0.35, 3);
      expect(side.time.playerDt).toBeCloseTo(0.05, 6);
    }
    // The causer hears what single player plays; the others get the cue.
    expect(a.sounds).not.toHaveBeenCalledWith('time_warp_in');
    expect(b.sounds).toHaveBeenCalledWith('time_warp_in');
    expect(game.host.sounds).toHaveBeenCalledWith('time_warp_in');
    a.time.popScale('focus');
    expect(a.world.slowHeld('focus')).toBe(false);
    game.run(1);
    for (const side of [game.host, a, b]) {
      expect(side.world.slows).toHaveLength(0);
      expect(side.time.slowmo).toBe(1);
    }
    expect(b.sounds).toHaveBeenCalledWith('time_warp_out');
    game.dispose();
  });

  it("the host's Focus does the same for every guest", () => {
    const game = party(2);
    game.run(0.2);
    game.host.time.pushScale('focus', 0.35, ...FADES);
    expect(game.host.world.slowHeld('focus')).toBe(true);
    game.run(0.5);
    for (const side of [game.host, ...game.g]) {
      expect(side.world.slows.map(e => [e.slot, e.kind])).toEqual([[0, 'focus']]);
      expect(side.time.slowmo).toBeCloseTo(0.35, 2);
      expect(side.time.playerDt).toBeCloseTo(0.05, 6);
    }
    game.host.time.popScale('focus');
    game.run(1);
    for (const side of [game.host, ...game.g]) expect(side.time.slowmo).toBe(1);
    game.dispose();
  });

  it('two at once: the deeper scale wins, both are named, and the world eases between them rather than stepping', () => {
    const game = party(2);
    const [a, b] = game.g as [typeof game.g[number], typeof game.g[number]];
    game.run(0.2);
    a.time.pushScale('focus', 0.35, ...FADES);
    game.run(0.4);
    b.time.pushScale('slowmo', 0.25, 0.18, 0.4);
    game.run(0.6);
    for (const side of [game.host, a, b]) {
      expect(side.world.slows.map(e => e.kind).sort()).toEqual(['focus', 'slowmo']);
      expect(side.time.slowmo).toBeCloseTo(0.25, 2);
    }
    // A teammate's SLOWMO gives every screen its look.
    expect(a.grade).toHaveBeenLastCalledWith('slowmo');
    expect(game.host.grade).toHaveBeenLastCalledWith('slowmo');
    b.time.popScale('slowmo');
    const seen: number[] = [];
    for (let i = 0; i < 20; i++) { game.frame(); seen.push(game.host.time.slowmo); }
    // 0.25 back to 0.35 over the blend, never a jump of more than a tenth of the way to full speed in one frame.
    expect(seen.at(-1)).toBeCloseTo(0.35, 2);
    for (let i = 1; i < seen.length; i++) expect(Math.abs(seen[i]! - seen[i - 1]!)).toBeLessThan(0.1);
    expect(a.grade).toHaveBeenLastCalledWith(null);
    game.dispose();
  });

  it('blends in and out on a guest: about half a second back to full speed, no step', () => {
    const game = party(1);
    const a = game.g[0]!;
    game.run(0.2);
    game.host.time.pushScale('slowmo', 0.25, 0.18, 0.4);
    game.run(1, 10);
    expect(a.time.slowmo).toBeCloseTo(0.25, 2);
    game.host.time.popScale('slowmo');
    const seen: number[] = [];
    for (let i = 0; i < 80; i++) { game.frame(10); seen.push(a.time.slowmo); }
    const firstFull = seen.findIndex(s => s === 1), firstRise = seen.findIndex(s => s > 0.26);
    expect((firstFull - firstRise) * 10).toBeGreaterThanOrEqual(SLOW.slowmo.fadeOut * 1000 - 30);
    expect((firstFull - firstRise) * 10).toBeLessThanOrEqual(SLOW.slowmo.fadeOut * 1000 + 30);
    for (let i = 1; i < seen.length; i++) expect(seen[i]! - seen[i - 1]!).toBeLessThan(0.03);
    game.dispose();
  });

  it('a perk asked again resets its clock on the host (a second Time Warp), and never adds', () => {
    const game = party(1);
    const a = game.g[0]!;
    game.run(0.2);
    a.time.pushScale('timeWarp', 0.25, 0.18, 0.4);
    game.run(3);
    const first = game.host.world.slowBoard.list[0]!.until;
    a.time.pushScale('timeWarp', 0.25, 0.18, 0.4);
    game.run(0.2);
    const again = game.host.world.slowBoard.list;
    expect(again).toHaveLength(1);
    expect(again[0]!.until - first).toBeGreaterThan(2500);
    expect(again[0]!.until - first).toBeLessThan(3500);
    game.dispose();
  });

  it('refuses a downed player, on a guest and on the host, and says why to that player only', () => {
    const game = party(2);
    const [a, b] = game.g as [typeof game.g[number], typeof game.g[number]];
    game.run(0.2);
    // The host has the guest as down; the guest's own screen has not caught up.
    game.host.world.team.life(a.lobby.you).fall(performance.now());
    a.time.pushScale('focus', 0.35, ...FADES);
    expect(a.world.slowHeld('focus')).toBe(true);
    game.run(0.3);
    expect(a.world.slowHeld('focus')).toBe(false);
    expect(a.world.slowRefusal('focus')).toMatchObject({ why: 'down' });
    expect(a.callout).toHaveBeenCalledWith('NO SLOW-MO WHILE DOWN');
    expect(b.callout).not.toHaveBeenCalled();
    for (const side of [game.host, a, b]) { expect(side.world.slows).toHaveLength(0); expect(side.time.slowmo).toBe(1); }
    // A guest that knows it is down does not even ask.
    b.player.downed = true;
    b.time.pushScale('slowmo', 0.25, 0.18, 0.4);
    expect(b.world.slowHeld('slowmo')).toBe(false);
    expect(b.callout).toHaveBeenCalledWith('NO SLOW-MO WHILE DOWN');
    // The host itself.
    game.host.player.downed = true;
    game.host.time.pushScale('focus', 0.35, ...FADES);
    expect(game.host.world.slowHeld('focus')).toBe(false);
    expect(game.host.callout).toHaveBeenCalledWith('NO SLOW-MO WHILE DOWN');
    game.dispose();
  });

  it('a player who goes down, or leaves, takes their slow-mo with them', () => {
    const game = party(2);
    const [a, b] = game.g as [typeof game.g[number], typeof game.g[number]];
    game.run(0.2);
    a.time.pushScale('focus', 0.35, ...FADES);
    b.time.pushScale('slowmo', 0.25, 0.18, 0.4);
    game.run(0.5);
    expect(game.host.world.slows).toHaveLength(2);
    game.host.world.team.life(a.lobby.you).fall(performance.now());
    game.run(0.3);
    expect(game.host.world.slows.map(e => e.kind)).toEqual(['slowmo']);
    // The guest's Focus learns the host ended it: the chip turns off (chips.ts reads `slowHeld`).
    game.run(0.8);
    expect(a.world.slowHeld('focus')).toBe(false);
    expect(a.world.slowRefusal('focus')).toMatchObject({ why: 'ended' });
    // The other guest's connection goes: the host's lobby no longer has them.
    const players = game.host.lobby.players as unknown as { id: string }[];
    players.splice(players.findIndex(p => p.id === b.lobby.you), 1);
    game.run(0.3);
    expect(game.host.world.slows).toHaveLength(0);
    game.run(1);
    expect(game.host.time.slowmo).toBe(1);
    game.dispose();
  });

  it(`holds the team to ${TEAM_SLOW.bank} s in a row: the world returns to full speed and the next request is refused with the wait`, () => {
    const game = party(2);
    const [a, b] = game.g as [typeof game.g[number], typeof game.g[number]];
    game.run(0.2);
    // The team chains Focus and perks without a gap.
    let slowFor = 0;
    for (let t = 0; t < 12.6; t += 0.05) {
      if (!a.world.slowHeld('focus')) { a.world.slowRefusal('focus'); a.time.pushScale('focus', 0.35, ...FADES); }
      if (!b.world.slowHeld('slowmo')) b.time.pushScale('slowmo', 0.25, 0.18, 0.4);
      if (!game.host.world.slowHeld('timeWarp')) game.host.time.pushScale('timeWarp', 0.25, 0.18, 0.4);
      game.frame();
      if (game.host.world.slows.length > 0) slowFor += 0.05;
    }
    expect(slowFor).toBeGreaterThan(TEAM_SLOW.bank - 0.3);
    expect(slowFor).toBeLessThan(TEAM_SLOW.bank + 0.3);
    expect(game.host.world.slowBoard.locked).toBe(true);
    expect(a.callout).toHaveBeenCalledWith(expect.stringMatching(/^TEAM SLOW-MO SPENT · \d S$/));
    expect(game.host.callout).toHaveBeenCalledWith(expect.stringMatching(/^TEAM SLOW-MO SPENT · \d S$/));
    game.run(1.2);
    for (const side of [game.host, a, b]) expect(side.time.slowmo).toBe(1);
    // A guest knows the wait from the host's state and does not even send.
    a.callout.mockClear();
    a.time.pushScale('focus', 0.35, ...FADES);
    expect(a.world.slowHeld('focus')).toBe(false);
    expect(a.callout).toHaveBeenCalledWith(expect.stringMatching(/^TEAM SLOW-MO SPENT/));
    game.run(TEAM_SLOW.restart);
    a.time.pushScale('focus', 0.35, ...FADES);
    game.run(0.4);
    expect(game.host.world.slows.map(e => e.kind)).toEqual(['focus']);
    game.dispose();
  });

  it("a boss's death slows every screen and names the boss and its killer", () => {
    const game = party(1);
    const a = game.g[0]!;
    game.run(0.2);
    const boss = { uid: 7, id: 'juggernaut', def: { name: 'Juggernaut', boss: () => ({}) }, position: new THREE.Vector3(), center: new THREE.Vector3(), yaw: 0, health: 0, armor: 0 };
    const damage = { source: 'smg', point: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, -1), amount: 9, type: 'bullet', force: 1 };
    // The boss starts dying, then its kill is announced (the order EnemyManager uses does not matter).
    game.host.time.pushScale('bossDeath', 0.4, 0.05, 0.5);
    game.host.ctx.events.emit('enemy:killed', { enemy: boss, damage, headshot: false, gibbed: false } as never);
    game.run(0.5);
    for (const side of [game.host, a]) {
      expect(side.world.slows).toEqual([expect.objectContaining({ kind: 'bossDeath', slot: 0, label: 'Juggernaut', scale: 0.4 })]);
      expect(side.time.slowmo).toBeCloseTo(0.4, 2);
      expect(side.time.playerDt).toBeCloseTo(0.05, 6);
    }
    game.host.time.popScale('bossDeath');
    game.run(1);
    for (const side of [game.host, a]) expect(side.time.slowmo).toBe(1);
    // A guest cannot claim a boss died.
    game.relay.rooms[1]!.channel('action').send({ match: 'clock-test', data: { t: 'slow', id: 'bossDeath', on: true } });
    game.run(0.3);
    expect(game.host.world.slows).toHaveLength(0);
    game.dispose();
  });

  it('a lost end: the scale returns to 1 on the guest by its own deadline, and the next state agrees', () => {
    const game = party(1);
    const a = game.g[0]!;
    game.run(0.2);
    game.host.time.pushScale('focus', 0.35, ...FADES);
    game.run(1);
    expect(a.time.slowmo).toBeCloseTo(0.35, 2);
    const left = a.world.slows[0]!.until - performance.now();
    expect(left).toBeGreaterThan(3000);
    // The host's Focus runs its whole length, and everything the host says from now on is lost.
    let lost = 0;
    for (let t = 0; t < left + 400; t += 50) { game.frame(50, false); lost += game.relay.lose(e => e.t === 'slowstate'); game.relay.flush(); }
    expect(lost).toBeGreaterThan(5);
    expect(game.host.world.slows).toHaveLength(0);
    // Still slow on the guest for the half second it waits for the word...
    expect(a.world.slows).toHaveLength(1);
    for (let t = 0; t < 1200; t += 50) { game.frame(50, false); game.relay.lose(e => e.t === 'slowstate'); game.relay.flush(); }
    // ...then it lets go by itself.
    expect(a.world.slows).toHaveLength(0);
    expect(a.time.slowmo).toBe(1);
    game.run(2.5);
    expect(a.time.slowmo).toBe(1);
    game.dispose();
  });

  it('a lost start: the periodic state puts the guest right within a quarter second', () => {
    const game = party(1);
    const a = game.g[0]!;
    game.run(0.2);
    game.host.time.pushScale('slowmo', 0.25, 0.18, 0.4);
    game.frame(50, false);
    expect(game.relay.lose(e => e.t === 'slowstate')).toBe(1);
    game.relay.flush();
    expect(a.world.slows).toHaveLength(0);
    game.run(0.3);
    expect(a.world.slows.map(e => e.kind)).toEqual(['slowmo']);
    game.dispose();
  });

  it('a late joiner arriving mid-slow-mo is at the right speed, with who caused it, within a quarter second of its map being up', () => {
    const game = party(2, [true, false]);
    const [a, late] = game.g as [typeof game.g[number], typeof game.g[number]];
    game.run(0.2);
    a.time.pushScale('focus', 0.35, ...FADES);
    game.run(1);
    expect(late.world.slows).toHaveLength(0);
    expect(late.time.slowmo).toBe(1);
    late.world.begin();
    game.run(0.3);
    expect(late.world.slows.map(e => [e.slot, e.kind])).toEqual([[a.slot, 'focus']]);
    game.run(0.3);
    expect(late.time.slowmo).toBeCloseTo(0.35, 2);
    game.dispose();
  });

  it('drops every slow-mo that is not the team\'s: hit-stop, the Judge\'s fan, the death beat, the dev panel', () => {
    const game = party(1);
    const a = game.g[0]!;
    game.run(0.2);
    for (const side of [game.host, a]) {
      side.time.hitStop(0.2, 0.02);
      side.time.pushScale('judgeFan', 0.5, 0.05, 0.15);
      side.time.pushScale('hud-death', 0.3, 0.08, 0.2);
      side.time.pushScale('lab', 0, 0, 0);
    }
    game.run(0.3);
    for (const side of [game.host, a]) {
      expect(side.world.slows).toHaveLength(0);
      expect(side.time.scale).toBe(1);
      expect(side.time.dt).toBeCloseTo(0.05, 6);
    }
    game.dispose();
  });

  it('takes junk from the wire without a throw or a slow-mo', () => {
    const game = party(1);
    const a = game.g[0]!;
    game.run(0.2);
    const junk: unknown[] = [{ t: 'slow', id: 'x', on: 'yes' }, { t: 'slow', id: 'focus' }, { t: 'slow', id: 'focus', on: true, s: 'long' }, { t: 'slow', id: 'hud-death', on: true },
      { t: 'slowstate' }, { t: 'slowstate', list: 'all', lock: 0 }, { t: 'slowstate', list: [null, { k: 'nope', s: 0, sc: 0.1, ms: 1, of: 1 }, { k: 'focus', s: 9, sc: 0.1, ms: 1, of: 1 },
        { k: 'focus', s: 0, sc: 'slow', ms: 1, of: 1 }], lock: 'never' }, { t: 'slowno', id: 'focus', why: 'because', ms: NaN }, { t: 'slowno' }];
    for (const data of junk) for (const room of game.relay.rooms) room.channel('action').send({ match: 'clock-test', data });
    expect(() => game.run(0.3)).not.toThrow();
    // The one well-formed request among them (`s` is not a number, so the cap stands) is an honest Focus from the guest.
    expect(game.host.world.slows.map(e => [e.slot, e.kind])).toEqual([[a.slot, 'focus']]);
    expect(game.host.world.slows[0]!.total).toBe(SLOW.focus.cap * 1000);
    // A guest never takes a scale below the floor, or a state from anyone but the host: the guest's own junk went to the host only.
    expect(a.time.slowmo).toBeGreaterThanOrEqual(0.34);
    game.dispose();
  });

  it('gives the clock back when the world is gone: single player after co-op is untouched', () => {
    const game = party(1);
    const time = game.host.time;
    expect(time.gate).not.toBeNull();
    expect(time.hostSteps).toBe(true);
    expect(game.g[0]!.time.hostSteps).toBe(false);
    game.host.time.pushScale('focus', 0.35, ...FADES);
    game.run(0.3);
    game.dispose();
    expect(time.gate).toBeNull();
    expect(time.hostSteps).toBe(false);
    for (let i = 0; i < 20; i++) time.tick(0.05);
    expect(time.slowmo).toBe(1);
    time.pushScale('focus', 0.35, 0, 0);
    time.tick(0.05);
    expect(time.slowmo).toBe(0.35);
  });
});
