/**
 * Campaign co-op over the mocked lobby transport: the host's real mission runner on a pretend game (campaign/testkit.ts), wrapped
 * by CoopMission, and a guest's inert pretend game that plays what arrives. What each operation's class is: campaign/coop.test.ts.
 */
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REGROUP_SECONDS } from '../campaign/coop';
import { MissionRunner } from '../campaign/runner';
import { FakeHost } from '../campaign/testkit';
import type { Mission, MissionHost } from '../campaign/types';
import { EventBus } from '../core/events';
import type { Ctx, GameEvents } from '../core/contracts';
import type { Line } from '../enemies/commander/lines';
import type { CoopSession } from './index';
import { Lobby } from './lobby';
import type { NetRoom } from './room';
import { CoopWorld } from './world';
import type { WorldEvent } from './worldProtocol';

class Relay {
  readonly rooms: Room[] = [];
  readonly queue: (() => void)[] = [];
  readonly packets: { from: string; to?: string; lane: string; data: unknown }[] = [];
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
        this.relay.packets.push({ from: this.id, to, lane, data: structuredClone(data) });
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

const line = (id: string): Line => ({ id, speaker: 'council', emotion: 'flat', text: id } as unknown as Line);

/** A mission with one of everything, small enough to read. */
const MISSION: Mission = {
  id: 'test', title: 'Test', loadout: { weapons: ['smg', 'sword'], grenades: 1 },
  zones: { gate: { min: [90, -1, 90], max: [110, 5, 110] }, yard: { min: [-5, -1, 40], max: [5, 5, 60] } },
  marks: { start: { at: [0, 0, 0], yaw: 0 }, crate: { at: [5, 0, 5] }, inside: { at: [100, 0, 100], yaw: 0 }, up: { at: [0, 30, 0] }, over: { at: [50, 30, 0] } },
  routes: { in: ['up', 'over'] },
  doors: { blast: { at: [100, 0, 95], yaw: 0, width: 4, height: 3, kind: 'shutter', seconds: 2, start: 1 } },
  cutscenes: { film: { shots: [{ from: [0, 9, 0], to: [0, 9, 9], lookFrom: [0, 0, 0], lookTo: [0, 0, 0], seconds: 20 }] } },
  lines: [line('hello'), line('again'), line('fired'), line('short')],
  redeployLines: ['again'],
  beats: [
    {
      id: 'open', title: 'Opening',
      start: [
        { do: 'music', state: 'easy' },
        { do: 'say', line: 'hello' },
        { do: 'objective', id: 'in', text: 'Get inside', at: 'inside' },
        { do: 'squad', tag: 'men', men: ['trooper', 'trooper'], at: 'crate' },
        { do: 'rack', weapon: 'shotgun', at: 'crate' },
        { do: 'drop', item: 'health', at: 'crate' },
        { do: 'callins', held: true },
        { do: 'call', name: 'lights', arg: 'emergency' },
        { do: 'call', name: 'mark', arg: 'men' },
        { do: 'call', name: 'chip', arg: 'thermal' },
      ],
      cues: [
        { when: { event: 'weapon:fired' }, run: [{ do: 'say', line: 'fired' }] },
        { when: { ammo: 'rocket', under: 3 }, run: [{ do: 'say', line: 'short' }] },
        { when: { signal: 'took:shotgun' }, run: [{ do: 'grenades', count: 2 }, { do: 'give', weapon: 'rocket' }] },
        { when: { zone: 'yard' }, run: [{ do: 'door', door: 'blast', open: 0, seconds: 1 }] },
      ],
      until: { zone: 'gate' },
    },
    {
      id: 'inside', title: 'Inside', checkpoint: { at: 'inside', loadout: { weapons: ['smg', 'shotgun', 'sword'], grenades: 3 } },
      start: [{ do: 'objective', id: 'film', text: 'Watch' }, { do: 'cutscene', id: 'film' }, { do: 'ride', seat: 'doorGunner', route: 'in', circle: true }, { do: 'finish' }],
    },
  ],
};

/** The parts of a running campaign that co-op reaches (campaign/index.ts), over the pretend game. */
function campaign(ctx: Ctx, hosting: boolean) {
  const host = new FakeHost();
  // The pretend game's events are the game's own.
  host.bus = ctx.events as unknown as EventBus<GameEvents>;
  host.playerAt = out => { out.x = ctx.player.position.x; out.y = ctx.player.position.y; out.z = ctx.player.position.z; };
  const runner = new MissionRunner(MISSION, host);
  const ui = { votes: vi.fn(), beat: vi.fn() };
  const self = {
    active: true, host, runner, ui, follow: vi.fn(() => { host.racks.length = 0; host.rackGuns.length = 0; }),
    provide(parts: Partial<MissionHost>) { Object.assign(host, parts); },
    tally: () => ({ title: MISSION.title, seconds: runner.elapsed, deaths: runner.deaths, vehicles: 0, unlocked: false }),
    restart(): boolean {
      runner.down();
      (ctx.coop!.world!.mission as unknown as { restarting(): void }).restarting();
      host.racks.length = 0; host.rackGuns.length = 0;
      runner.redeploy();
      return true;
    },
  };
  void hosting;
  return self;
}

function context() {
  const events = new EventBus<GameEvents>();
  const player = { position: new THREE.Vector3(0, 0, 0), eye: new THREE.Vector3(0, 1.6, 0), forward: new THREE.Vector3(0, 0, -1), yaw: 0,
    velocity: new THREE.Vector3(), alive: true, health: 100, maxHealth: 100, armor: 0, grounded: true, downed: false, parked: false,
    reset: vi.fn(), teleport: vi.fn((at: THREE.Vector3) => { player.position.copy(at); }), takeDamage: vi.fn() };
  const owned = new Set<string>(['smg']);
  const ammo = { rocket: 9 };
  const ctx = { events, player, enemies: { alive: [], spawn: vi.fn(), withdraw: vi.fn() }, waves: { wave: 1 }, physics: { raycast: vi.fn(() => null) },
    weapons: { current: 'smg', owned, ammo: (w: keyof typeof ammo) => ({ mag: ammo[w] ?? 0, reserve: 0 }) },
    world: { playerSpawns: [{ position: new THREE.Vector3(4, 0, 4), yaw: 0 }] }, hud: { feed: vi.fn(), follow: vi.fn(() => () => {}), callout: vi.fn() },
    time: { dt: 0.016, realDt: 0.016, frame: 0 }, progression: { kills: 0, score: 0, headshots: 0, resume: vi.fn() }, contracts: { wallet: { credits: 0 } },
    camera: { setSeat: vi.fn(), addTrauma: vi.fn() }, input: { pressed: vi.fn(() => false), isDown: vi.fn(() => false) },
    fx: { tracer: vi.fn() }, gore: {}, audio: { play: vi.fn() }, combat: {} } as unknown as Ctx;
  return { ctx, player, owned, ammo };
}

function pair() {
  const relay = new Relay();
  const hr = relay.open('host-peer');
  const hostLobby = new Lobby({ main: hr, door: () => new Room('door', new Relay()) }, true, 'HOST', 'test');
  const gr = relay.open('guest-peer');
  const guestLobby = new Lobby({ main: gr, door: () => new Room('door', new Relay()) }, false, 'GUEST', 'test');
  relay.flush(); hostLobby.startMatch('campaign', 'mission-test'); relay.flush();
  const host = context(), guest = context();
  guest.player.position.set(0, 0, -5);
  // Each sees the other's body where that player really is.
  const body = (of: ReturnType<typeof context>, who: unknown) => {
    const root = new THREE.Group(); root.position.copy(of.player.position);
    return { player: who, char: { root, anim: { play: vi.fn() } }, buffer: { sample: () => ({ velocity: [0, 0, 0], yaw: 0 }) }, setTag: vi.fn(), retag: vi.fn(),
      muzzle: (v: THREE.Vector3) => v.copy(root.position), sync: () => root.position.copy(of.player.position) };
  };
  const guestBody = body(guest, guestLobby.me), hostBody = body(host, hostLobby.me);
  const hs = { lobby: hostLobby, hosting: true, match: hostLobby.match, remotes: new Map([[guestLobby.you, guestBody]]) } as unknown as CoopSession;
  const gs = { lobby: guestLobby, hosting: false, match: guestLobby.match, remotes: new Map([[guestLobby.players.find(p => p.host)!.id, hostBody]]) } as unknown as CoopSession;
  const hc = campaign(host.ctx, true), gc = campaign(guest.ctx, false);
  Object.assign(host.ctx, { campaign: hc, coop: hs }); Object.assign(guest.ctx, { campaign: gc, coop: gs });
  const hw = new CoopWorld(host.ctx, hs), gw = new CoopWorld(guest.ctx, gs);
  Object.assign(hs, { world: hw }); Object.assign(gs, { world: gw });
  hw.begin(); gw.begin();
  /** One frame on both screens: the bodies follow the players, the runner and the worlds tick, the wire is delivered. */
  const frame = (dt = 0.016) => {
    guestBody.sync(); hostBody.sync();
    (host.ctx.time as { realDt: number }).realDt = dt; (guest.ctx.time as { realDt: number }).realDt = dt;
    hc.runner.update(dt);
    hw.update(); gw.update();
    relay.flush();
  };
  const sent = (op: string, to?: string) => relay.packets.filter(p => p.lane === 'action' && p.from === 'host-peer' && (to === undefined || p.to === to))
    .map(p => (p.data as { data: WorldEvent }).data).filter((d): d is Extract<WorldEvent, { t: 'mission' }> => d.t === 'mission' && d.op === op);
  const guestSays = (op: string, args: unknown[]) => { gr.channel('action').send({ match: 'mission-test', data: { t: 'mission', op, args } }); relay.flush(); };
  // The guest's world says it is up (its first card): the host's catch-up for an arriving player goes out now, before the mission.
  frame();
  (guest.player.teleport as ReturnType<typeof vi.fn>).mockClear();
  guest.player.position.set(0, 0, -5);
  return { relay, host, guest, hw, gw, hc, gc, hostLobby, guestLobby, frame, sent, guestSays, start: () => { hc.runner.start(); relay.flush(); } };
}

describe('a mission run by the host and played on every screen', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] }));
  afterEach(() => vi.useRealTimers());

  it('mirrors what the mission says, shows and hands out, and never the world it runs', () => {
    const game = pair();
    game.start();
    const g = game.gc.host;
    expect(g.said).toEqual(['hello']);
    expect(g.objectiveText).toEqual(['Get inside']);
    expect(g.log).toContain('music easy');
    expect(g.log).toContain('drop health');
    expect(g.rackGuns).toEqual(['shotgun']);
    expect(g.skyHeld).toBe(true);
    expect(g.doorStates).toEqual({ blast: 1 });
    // The lights and the brain chip are every player's; a kill mark on the host's vehicle is the host's.
    expect(g.calls).toEqual([['lights', 'emergency'], ['chip', 'thermal']]);
    expect(game.hc.host.calls.map(c => c[0])).toEqual(['lights', 'mark', 'chip']);
    // The enemies are the host's world: a guest gets them in the snapshot, never as an order.
    expect(g.log.some(l => l.startsWith('squad'))).toBe(false);
    expect(game.hc.host.log).toContain('squad men 2');
    // The opening has no checkpoint, so no mark: only the kit, with this player's own starter gun where the host's stands.
    expect(g.deployed).toEqual({ at: null, weapons: 'smg,sword' });
    expect(game.gc.runner.state).toBe('idle');
    game.hw.dispose(); game.gw.dispose();
  });

  it('counts any player doing what a trigger waits for', () => {
    const game = pair();
    game.start();
    const fired = { weapon: 'smg', origin: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, -1) } as unknown as GameEvents['weapon:fired'];
    game.guest.ctx.events.emit('weapon:fired', fired);
    game.relay.flush(); game.frame();
    expect(game.hc.host.said).toContain('fired');
    expect(game.gc.host.said).toContain('fired');
    // The guest fired; the host's own HUD and guns heard nothing of it.
    const heard = vi.fn(); game.host.ctx.events.on('weapon:fired', heard);
    vi.advanceTimersByTime(300);
    game.guest.ctx.events.emit('weapon:fired', fired); game.relay.flush();
    expect(heard).not.toHaveBeenCalled();
    game.hw.dispose(); game.gw.dispose();
  });

  it('gives a gun on a rack to the team, whoever reaches it first', () => {
    const game = pair();
    game.start();
    // The guest walks over their copy.
    game.gc.host.taken('shotgun'); game.relay.flush(); game.frame();
    expect(game.hc.host.rackGuns).toEqual([]);
    expect(game.host.ctx.hud.feed).toHaveBeenCalledWith(expect.stringContaining('GUEST took the'), expect.any(String));
    // The runner heard `took:shotgun`: grenades and a launcher for everyone.
    expect(game.gc.host.log).toContain('grenades 2');
    expect(game.gc.host.log).toContain('give rocket');
    expect(game.gc.host.issuedGuns).toEqual([]);
    // A second take of the same rack, and a take of a rack that never stood, do nothing.
    game.guestSays('took', ['shotgun']); game.guestSays('took', ['nuke']);
    expect(game.sent('taken')).toHaveLength(1);
    game.hw.dispose(); game.gw.dispose();

    const other = pair();
    other.start();
    other.hc.host.taken('shotgun'); other.relay.flush();
    expect(other.gc.host.issuedGuns).toEqual(['shotgun']);
    expect(other.gc.host.rackGuns).toEqual([]);
    other.hw.dispose(); other.gw.dispose();
  });

  it('is short of rockets when the worst-off player who carries the launcher is', () => {
    const game = pair();
    game.start();
    game.hc.host.ammo = 9;
    game.guest.owned.add('rocket'); game.guest.ammo.rocket = 2;
    vi.advanceTimersByTime(600); game.frame(); game.frame();
    expect(game.hc.host.said).toContain('short');
    game.hw.dispose(); game.gw.dispose();
  });

  it('regroups the team at a closing door and when one player reaches the next section', () => {
    const game = pair();
    game.start();
    // The guest walks into the yard: the door starts down, and the host, far off, is counted down to it.
    game.guest.player.position.set(0, 0, 50);
    game.frame();
    expect(game.gc.host.doorStates.blast).toBe(0);
    expect(game.host.ctx.hud.callout).toHaveBeenCalledWith(expect.stringContaining('REGROUP'));
    for (let i = 0; i < 6; i++) { vi.advanceTimersByTime(1000); game.frame(1); }
    expect(game.host.player.teleport).toHaveBeenCalledOnce();
    expect(game.host.player.position.distanceTo(game.guest.player.position)).toBeLessThan(4);
    // The host walks on into the gate zone: the beat ends, the checkpoint is saved for all, and the guest has ten seconds.
    game.host.player.position.set(100, 0, 100);
    game.frame();
    expect(game.hc.runner.beat?.id).toBe('inside');
    expect(game.gc.host.log).toContain('saved inside');
    game.frame();
    expect(game.guest.ctx.hud.callout).toHaveBeenCalledWith(expect.stringContaining(`in ${REGROUP_SECONDS}`));
    // Standing right beside the leader is not being in the new section: a shut door may be between them.
    game.guest.player.position.set(100, 0, 88);
    for (let i = 0; i < REGROUP_SECONDS + 1; i++) { vi.advanceTimersByTime(1000); game.frame(1); }
    expect(game.guest.player.teleport).toHaveBeenCalledOnce();
    expect(game.guest.player.position.distanceTo(game.host.player.position)).toBeLessThan(0.1);
    game.hw.dispose(); game.gw.dispose();
  });

  it('drops a regroup that is still counting down when the mission itself places the team', () => {
    const game = pair();
    game.start();
    game.guest.player.position.set(0, 0, 50);
    game.frame();
    expect(game.host.ctx.hud.callout).toHaveBeenCalledWith(expect.stringContaining('REGROUP'));
    // The mission puts everyone on a mark before the five seconds are up: nobody is then moved off it.
    (game.hc.host as unknown as { place(at: { at: number[] }): void }).place({ at: [5, 0, 5] });
    game.relay.flush();
    for (let i = 0; i < 8; i++) { vi.advanceTimersByTime(1000); game.frame(1); }
    expect(game.host.player.teleport).not.toHaveBeenCalled();
    expect(game.guest.player.teleport).not.toHaveBeenCalled();
    game.hw.dispose(); game.gw.dispose();
  });

  it('plays a film for everyone, skips it only when every player votes, and ends a ride for all with the host\'s', () => {
    const game = pair();
    game.start();
    // The guest is dead when the film starts: got up for it.
    const life = game.hw.team.life(game.guestLobby.you); life.fall(0); life.bleed(Infinity);
    game.host.player.position.set(100, 0, 100);
    game.frame();
    expect(life.state).toBe('up');
    expect(game.gc.host.cutsceneDone).not.toBeNull();
    // One vote is a vote; both end it on both screens.
    game.hc.host.film.askSkip!(); game.relay.flush(); game.frame();
    expect(game.hc.host.cutsceneDone).not.toBeNull();
    expect(game.hc.ui.votes).toHaveBeenLastCalledWith('1/2');
    expect(game.gc.host.shown).toContainEqual(['votes', ['1/2']]);
    expect(game.gc.host.film.askSkip!()).toBe(false); game.relay.flush(); game.frame();
    expect(game.hc.host.cutsceneDone).toBeNull();
    expect(game.gc.host.cutsceneDone).toBeNull();
    // Then the ride, with its circle, on both; the host's landing takes the guest out of theirs.
    expect(game.gc.host.rides).toEqual(['circle']);
    expect(game.gc.host.riding).toBe(true);
    game.hc.host.cue('alight'); game.hc.host.rideDone!(); game.relay.flush(); game.frame();
    expect(game.gc.host.riding).toBe(false);
    // Won: every screen has the mission's numbers for the board.
    expect(game.hc.host.finishedCount).toBe(1);
    expect(game.gw.mission.result).toMatchObject({ title: 'Test', deaths: 0 });
    game.hw.dispose(); game.gw.dispose();
  });

  it('takes the whole team back to a checkpoint: every screen rebuilds, then gets the doors, the objectives and the kit again', () => {
    const game = pair();
    game.start();
    game.host.player.position.set(100, 0, 100);
    game.frame();
    game.gc.host.log.length = 0;
    const life = game.hw.team.life(game.guestLobby.you); life.fall(0);
    expect(game.hw.mission.restart()).toBe(true);
    game.relay.flush(); game.frame();
    expect(game.gc.follow).toHaveBeenCalledOnce();
    expect(life.state).toBe('up');
    expect(game.gc.host.deployed).toEqual({ at: '101.3,0,100', weapons: 'smg,shotgun,sword' });
    expect(game.gc.host.objectiveText).toEqual(['Get inside', 'Watch']);
    expect(game.gc.host.said).toContain('again');
    // A guest cannot send the team back, or drive the mission at all.
    game.guestSays('reset', []); game.guestSays('place', [{ at: [999, 0, 999] }]); game.guestSays('finished', [{}]);
    expect(game.hc.host.finishedCount).toBe(0);
    expect(game.host.player.position.x).toBe(100);
    game.hw.dispose(); game.gw.dispose();
  });

  it('brings a late joiner to where the mission is: place, doors, lights, sky, kit, racks, the film part way', () => {
    const game = pair();
    game.start();
    game.guest.player.position.set(0, 0, 50); game.frame();
    const you = game.guestLobby.you;
    const before = game.relay.packets.length;
    game.hw.mission.catchUp(you);
    const caught = game.relay.packets.slice(before).map(p => (p.data as { data: WorldEvent }).data);
    const ops = caught.filter((d): d is Extract<WorldEvent, { t: 'mission' }> => d.t === 'mission').map(d => [d.op, d.args] as const);
    expect(caught[0]!.t).toBe('gather');
    expect(ops.find(o => o[0] === 'door')![1]).toMatchObject(['blast', {}, 0, 0]);
    expect(ops.find(o => o[0] === 'objectives')).toBeDefined();
    expect(ops.find(o => o[0] === 'music')![1]).toEqual(['easy']);
    expect(ops.find(o => o[0] === 'callins')![1]).toEqual([true]);
    expect(ops.filter(o => o[0] === 'call').map(o => o[1])).toEqual([['lights', 'emergency'], ['chip', 'thermal']]);
    expect(ops.find(o => o[0] === 'rack')![1][0]).toBe('shotgun');
    expect(ops.find(o => o[0] === 'drop')![1][0]).toBe('health');
    // The kit so far, with no mark: the mission has moved on from where it began.
    expect(ops.find(o => o[0] === 'deploy')![1]).toEqual([null, { weapons: ['smg', 'sword'], grenades: 1 }]);
    // Later: the gun off the rack and what came with it are in the kit, and the film is joined part way.
    game.hc.host.taken('shotgun'); game.relay.flush(); game.frame();
    game.host.player.position.set(100, 0, 100); game.frame();
    vi.advanceTimersByTime(4000);
    const then = game.relay.packets.length;
    game.hw.mission.catchUp(you);
    const later = game.relay.packets.slice(then).map(p => (p.data as { data: WorldEvent }).data).filter((d): d is Extract<WorldEvent, { t: 'mission' }> => d.t === 'mission');
    expect(later.find(d => d.op === 'deploy')!.args[1]).toEqual({ weapons: ['smg', 'sword', 'shotgun', 'rocket'], grenades: 3 });
    expect(later.find(d => d.op === 'rack')).toBeUndefined();
    expect(later.find(d => d.op === 'cutscene')!.args[2]).toBeCloseTo(4, 0);
    game.hw.dispose(); game.gw.dispose();
  });
});
