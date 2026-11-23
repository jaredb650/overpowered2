/**
 * The team's rules over the mocked lobby transport, with two to four players: endings, respawn at wave clear, the break and its
 * ready vote, seats (a rejoin's kit, purse and life), the late joiner's catch-up, pings, kill credit and awards.
 */
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../core/events';
import type { Ctx, GameEvents, PlayerDamage } from '../core/contracts';
import { goreDoubles } from './world/goreDoubles';
import { Enemy } from '../enemies/Enemy';
import { ChipRack } from '../contracts/chips';
import { adoptRules, crucibleRules } from '../contracts/crucible';
import { DEFAULT_RULES, cloneRules, rulesEqual, type CrucibleRules } from '../enemies/rules';
import { Loadout } from '../progression/implants';
import type { CoopSession } from './index';
import { endCopy } from './coopHud';
import { applyKit, cleanKit, readKit, type Kit } from './kit';
import { Lobby } from './lobby';
import { SeatHooks } from './seats';
import { MARK_GAP_MS, MARK_KEEP, MARK_SECONDS } from './marks';
import type { NetRoom } from './room';
import { BLEED_MS, KIT_MS } from './team';
import { BOSS_BREAK, CUT_TO, TEAM_BREAK, teamBreakSeconds } from './teamBreak';
import { CoopWorld } from './world';
import { LINGER_MS } from './world/credit';
import type { WorldEvent } from './worldProtocol';
import { eventOf, batchOf } from './world/pack';

class Relay {
  readonly rooms: Room[] = [];
  readonly queue: (() => void)[] = [];
  readonly packets: { lane: string; data: unknown; to?: string; from: string }[] = [];
  open(id: string): Room {
    const room = new Room(id, this);
    for (const peer of this.rooms) this.queue.push(() => { peer.join(id); room.join(peer.id); });
    this.rooms.push(room);
    return room;
  }
  /** A browser closes: every other room hears it leave. */
  close(room: Room): void {
    if (!this.rooms.includes(room)) return;
    this.rooms.splice(this.rooms.indexOf(room), 1);
    for (const peer of this.rooms) this.queue.push(() => peer.left(room.id));
  }
  /** The same browser, the same page, connected again after a drop. */
  reopen(room: Room): void {
    if (this.rooms.includes(room)) return;
    for (const peer of this.rooms) this.queue.push(() => { peer.join(room.id); room.join(peer.id); });
    this.rooms.push(room);
  }
  flush(): void { while (this.queue.length) this.queue.shift()!(); }
  events(type: string): { data: WorldEvent; to?: string; from: string }[] {
    return this.packets.filter(p => p.lane === 'action' && eventOf<WorldEvent>(p.data).t === type).map(p => ({ data: eventOf<WorldEvent>(p.data), to: p.to, from: p.from }));
  }
}
class Room implements NetRoom {
  readonly handlers = new Map<string, (data: unknown, from: string) => void>();
  join: (id: string) => void = () => {};
  left: (id: string) => void = () => {};
  constructor(readonly id: string, private readonly relay: Relay) {}
  channel<T>(lane: string) {
    return {
      on: (handler: (data: T, from: string) => void) => this.handlers.set(lane, handler as (data: unknown, from: string) => void),
      send: (data: T, to?: string) => {
        this.relay.packets.push({ lane, data: structuredClone(data), to, from: this.id });
        for (const peer of this.relay.rooms) if (peer !== this && (!to || peer.id === to)) {
          const copied = structuredClone(data);
          this.relay.queue.push(() => peer.handlers.get(lane)?.(copied, this.id));
        }
      },
    };
  }
  onPeerJoin(handler: (id: string) => void) { this.join = handler; }
  onPeerLeave(handler: (id: string) => void) { this.left = handler; }
  onError() {}
  leave() {}
}

/** A stand-in arsenal with what the kit reads and writes. */
function arsenal() {
  const slots: Record<string, { mag: number; reserve: number; magSize: number; maxReserve: number }> = {};
  const ammo = (id: string) => (slots[id] ??= { mag: 30, reserve: 90, magSize: 30, maxReserve: 300 });
  const w = {
    current: 'smg', owned: new Set<string>(['smg']), mods: new Set<string>(), fitted: new Set<string>(), grenades: 3, akimbo: false,
    ammo: (id?: string) => ammo(id ?? w.current),
    setLoadout: vi.fn((ids: string[], grenades: number) => { w.owned.clear(); for (const id of ids) w.owned.add(id); w.grenades = grenades; w.current = ids[0]!; }),
    grantMod: vi.fn((id: string) => { w.mods.add(id); }),
    fitMod: vi.fn((id: string, on: boolean) => { if (on) w.fitted.add(id); else w.fitted.delete(id); return on; }),
    give: vi.fn((id: string) => { w.owned.add(id); }),
  };
  return w;
}

function context() {
  const events = new EventBus<GameEvents>();
  let uid = 0;
  const alive: Enemy[] = [];
  const spawn = vi.fn((id: Enemy['id'], at: THREE.Vector3) => {
    const enemy = new Enemy(); enemy.uid = ++uid; enemy.id = id; enemy.health = enemy.maxHealth = 100; enemy.alive = true;
    enemy.position.copy(at); enemy.center.copy(at).y += 1;
    enemy.char = { root: new THREE.Group(), severed: new Set(), rig: { bones: [{ name: 'chest' }] }, hitFlash: vi.fn(), anim: { play: vi.fn() } } as unknown as Enemy['char'];
    alive.push(enemy); return enemy;
  });
  const player = { position: new THREE.Vector3(0, 0, 0), eye: new THREE.Vector3(0, 1.6, 0), forward: new THREE.Vector3(0, 0, -1),
    velocity: new THREE.Vector3(), alive: true, health: 100, maxHealth: 100, armor: 0, grounded: true, downed: false, parked: false, yaw: 0,
    teleport: vi.fn(),
    takeDamage: vi.fn((damage: PlayerDamage) => {
      player.health -= damage.amount;
      if (player.health <= 0) { player.alive = false; events.emit('player:died', { source: damage.source }); }
    }),
  };
  const manager = { alive, spawn, withdraw: vi.fn(), applyDamage: vi.fn(), replayDeath: vi.fn((enemy: Enemy) => { enemy.alive = false; alive.splice(alive.indexOf(enemy), 1); }), placeReplica: vi.fn(), ...goreDoubles() };
  const keys = new Set<string>();
  const weapons = arsenal();
  const stims = { count: 1, max: 5, give: vi.fn((n: number) => { stims.count += n; return n; }), spend: vi.fn(() => { stims.count--; return true; }) };
  const callIns = new Set<string>();
  const progression = { kills: 0, score: 0, headshots: 0, combo: 0, callIns, stims, loadout: new Loadout(),
    resume: vi.fn((score: number, kills: number) => { progression.score = score; progression.kills = kills; }), award: vi.fn(),
    grantCallIn: vi.fn((id: string) => { callIns.add(id); }), setCombo: vi.fn((n: number) => { progression.combo = n; }),
    pods: { onWaveClear: vi.fn(), catchUp: vi.fn(), netIn: vi.fn() } };
  const hud = { feed: vi.fn(), follow: vi.fn(() => () => {}), callout: vi.fn(), banner: vi.fn(), marker: vi.fn((_at: THREE.Vector3, _label: string, _color?: string) => vi.fn()), floatText: vi.fn(), hold: vi.fn() };
  const waves = { wave: 1, phase: 'spawning', nextWaveIn: 0 };
  const ctx = { events, player, enemies: manager, weapons, waves, physics: { raycast: vi.fn(() => null as { point: THREE.Vector3 } | null) },
    world: { playerSpawns: [{ position: new THREE.Vector3(4, 0, 4), yaw: 0 }] }, hud,
    time: { dt: 0.016, realDt: 0.016, frame: 0 }, progression, contracts: { wallet: { credits: 0 }, chips: { rack: new ChipRack() } },
    camera: { setSeat: vi.fn(), addTrauma: vi.fn() }, input: { pressed: vi.fn((a: string) => keys.has(a)), isDown: vi.fn(() => false), labelFor: () => 'L' },
    fx: { tracer: vi.fn(), muzzleFlash: vi.fn(), bloodHit: vi.fn(), impact: vi.fn() }, gore: { wound: vi.fn(), sever: vi.fn() },
    audio: { play: vi.fn() }, combat: { fireRay: vi.fn(), explode: vi.fn() }, render: { viewScene: { visible: true } } } as unknown as Ctx;
  return { ctx, manager, player, keys, weapons, progression, hud, waves, stims };
}
type Side = ReturnType<typeof context> & { lobby: Lobby; world: CoopWorld; room: Room; session: CoopSession };

function body(player: unknown, at: [number, number, number] = [0, 0, -3]) {
  const root = new THREE.Group(); root.position.set(...at);
  return { player, char: { root, anim: { play: vi.fn() } }, buffer: { sample: () => ({ velocity: [0, 0, 0], yaw: 0 }) }, setTag: vi.fn(), muzzle: (v: THREE.Vector3) => v.copy(root.position), downed: false };
}

/** A host and `guests` guests in one match, every world begun. `browsers`: each guest's stable browser id. */
function party(guests = 1, mode: 'crucible' | 'outpost' | 'campaign' = 'crucible', browsers: string[] = ['b1', 'b2', 'b3'], loading: number[] = []) {
  const relay = new Relay();
  const door = () => new Room('door', new Relay());
  const hostRoom = relay.open('host-peer');
  const hostLobby = new Lobby({ main: hostRoom, door }, true, 'HOST', 'test');
  const sides: Side[] = [];
  const join = (peer: string, name: string, browser: string) => {
    const room = relay.open(peer);
    const lobby = new Lobby({ main: room, door }, false, name, 'test');
    lobby.browser = browser;
    relay.flush();
    return { room, lobby };
  };
  const joined = Array.from({ length: guests }, (_, i) => join(`guest-${i + 1}`, `GUEST${i + 1}`, browsers[i]!));
  hostLobby.startMatch(mode, 'team-test'); relay.flush();
  const build = (lobby: Lobby, room: Room): Side => {
    const c = context();
    // The host's seat hooks, fed by the lobby as the real session feeds them (index.ts).
    const seats = new SeatHooks();
    if (lobby.hosting) lobby.onSeat = (player, event) => seats.feed(player, event);
    const session = { lobby, hosting: lobby.hosting, match: lobby.match, remotes: new Map(), localPaused: false,
      onArrived: seats.onArrived, onLost: seats.onLost, onGone: seats.onGone, onForget: seats.onForget } as unknown as CoopSession;
    const world = new CoopWorld(c.ctx, session);
    return { ...c, lobby, world, room, session };
  };
  const host = build(hostLobby, hostRoom);
  for (const j of joined) sides.push(build(j.lobby, j.room));
  for (const g of sides) (host.session.remotes as Map<string, unknown>).set(g.lobby.you, body(hostLobby.players.find(p => p.id === g.lobby.you)));
  // `loading`: guests whose map is still loading: in the lobby's list, their world not begun (a test begins it when it likes).
  host.world.begin(); sides.forEach((g, i) => { if (!loading.includes(i)) g.world.begin(); });
  const tick = (ms = 300) => {
    vi.advanceTimersByTime(ms);
    host.world.update(); relay.flush();
    for (const g of sides) g.world.update();
    relay.flush();
    host.world.update(); relay.flush();
  };
  /** A new page for the same player: a new peer id, the same browser. */
  const rejoin = (index: number, peer: string) => {
    const old = sides[index]!;
    old.world.dispose();
    relay.close(old.room); relay.flush();
    const j = join(peer, old.lobby.me?.name ?? `GUEST${index + 1}`, old.lobby.browser);
    relay.flush();
    const side = build(j.lobby, j.room);
    sides[index] = side;
    (host.session.remotes as Map<string, unknown>).set(side.lobby.you, body(hostLobby.players.find(p => p.id === side.lobby.you)));
    side.world.begin();
    return side;
  };
  const dispose = () => { host.world.dispose(); for (const g of sides) g.world.dispose(); };
  return { relay, host, guests: sides, tick, rejoin, dispose };
}

const press = (side: Side, action: string) => { side.keys.add(action); side.world.update(); side.keys.delete(action); };
const die = (side: Side) => { side.player.alive = false; side.player.health = 0; side.ctx.events.emit('player:died', { source: 'husk' }); };
const feeds = (side: Side): string[] => side.hud.feed.mock.calls.map(c => String(c[0]));
const kill = (side: Side, enemy: Enemy, source: string, headshot = false) => side.ctx.events.emit('enemy:killed', { enemy,
  damage: { source, point: enemy.center, dir: new THREE.Vector3(0, 0, -1), amount: 99, type: 'bullet', force: 1 }, headshot, gibbed: false } as never);

// Not setInterval: the lobby's own heartbeat would drop a player for the silence of a test that jumps the clock.
beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] }));
afterEach(() => vi.useRealTimers());

describe('endings: every run ends on the team board', () => {
  it('a wipe, a fulfilled contract and a mission won all reach every guest as `over`, once, with which ending it was', () => {
    for (const [how, run] of [
      ['wipe', (g: ReturnType<typeof party>) => { die(g.host); for (const s of g.guests) die(s); g.relay.flush(); g.tick(); }],
      ['fulfilled', (g: ReturnType<typeof party>) => { g.host.world.team.finish('fulfilled'); g.relay.flush(); }],
      ['mission', (g: ReturnType<typeof party>) => { g.host.ctx.events.emit('campaign:complete', {}); g.relay.flush(); }],
    ] as const) {
      const game = party(3);
      game.tick();
      const seen: string[] = [];
      for (const side of [game.host, ...game.guests]) side.world.team.onOver = (cards, _wave, ending) => seen.push(`${ending}:${cards.length}`);
      run(game);
      expect(seen, how).toEqual(Array(4).fill(`${how}:4`));
      // A second ending never replaces the first.
      game.host.world.team.finish('wipe'); game.relay.flush();
      expect(seen).toHaveLength(4);
      expect(game.guests[0]!.world.team.ending).toBe(how);
      game.dispose();
    }
  });
  it('the Commander falling ends the run even if his last words never finish, and never on a mission page', () => {
    const game = party(1, 'outpost');
    game.tick();
    const seen: string[] = [];
    game.guests[0]!.world.team.onOver = (_c, _w, ending) => seen.push(ending);
    game.host.ctx.events.emit('commander:fulfilled', {});
    game.tick(1000);
    expect(seen).toEqual([]);
    for (let i = 0; i < 26; i++) game.tick(1000);
    expect(seen).toEqual(['fulfilled']);
    game.dispose();
  });
  it('a guest still loading does not hold the run open, and does not wipe it either: only arrived players count', () => {
    // Guest 2's world is not up.
    const game = party(2, 'crucible', undefined, [1]);
    vi.advanceTimersByTime(300); game.host.world.update(); game.relay.flush(); game.guests[0]!.world.update(); game.relay.flush(); game.host.world.update();
    die(game.host); die(game.guests[0]!); game.relay.flush();
    game.host.world.update(); game.relay.flush();
    expect(game.host.world.team.ending).toBe('wipe');
    game.dispose();
  });
  it('a guest who arrives after the run ended is handed the board at once', () => {
    const game = party(2);
    game.tick();
    game.host.world.team.finish('fulfilled'); game.relay.flush();
    // A page that finishes loading only now (a rejoin, a late join): its world comes up after the `over` went out.
    const late = game.rejoin(1, 'guest-2b');
    expect(late.world.team.ending).toBeNull();
    vi.advanceTimersByTime(300); late.world.update(); game.relay.flush();
    expect(late.world.team.ending).toBe('fulfilled');
    game.dispose();
  });
  it('writes each board in the Council\'s voice, and only a win is green', () => {
    expect(endCopy('wipe', 7)).toMatchObject({ big: 'TEAM WIPED', won: false });
    expect(endCopy('wipe', 7).sub).toContain('wave 7');
    expect(endCopy('wipe', 0).sub).not.toContain('wave 0');
    expect(endCopy('fulfilled', 10)).toMatchObject({ big: 'CONTRACT FULFILLED', won: true });
    expect(endCopy('mission', 0)).toMatchObject({ big: 'MISSION COMPLETE', won: true });
  });
});

describe('lives: back at wave clear, and a stall costs nobody their seconds', () => {
  it('the dead and the downed get up when the wave is cleared, before the wave pays, and again as the next starts', () => {
    const game = party(2);
    game.tick();
    const [a, b] = game.guests as [Side, Side];
    die(a); die(b); game.relay.flush(); game.tick();
    // A bled out; B is still down.
    game.host.world.team.life(a.lobby.you).bleed(Infinity);
    game.tick();
    expect(game.host.world.team.life(a.lobby.you).state).toBe('dead');
    expect(game.host.world.team.life(b.lobby.you).state).toBe('down');
    const order: string[] = [];
    a.ctx.events.on('wave:clear', () => order.push(a.player.alive ? 'paid on my feet' : 'paid dead'));
    game.host.ctx.events.emit('wave:clear', { wave: 3, bonus: 500 }); game.relay.flush();
    expect(order).toEqual(['paid on my feet']);
    for (const s of [a, b]) {
      expect(game.host.world.team.life(s.lobby.you).state).toBe('up');
      expect(s.player.alive).toBe(true); expect(s.player.downed).toBe(false); expect(s.player.health).toBe(100);
      expect(s.player.teleport).toHaveBeenCalled();
    }
    // Someone who falls during the break is up again as the next wave starts.
    die(a); game.relay.flush(); game.tick();
    game.host.ctx.events.emit('wave:start', { wave: 4, total: 20, boss: false }); game.relay.flush();
    expect(a.player.alive).toBe(true);
    game.dispose();
  });
  it('a host stall does not eat a downed player\'s bleed-out', () => {
    const game = party(1);
    game.tick();
    die(game.guests[0]!); game.relay.flush(); game.tick(100);
    const life = game.host.world.team.life(game.guests[0]!.lobby.you);
    expect(life.state).toBe('down');
    // The host's tab sleeps for longer than a whole bleed-out.
    vi.advanceTimersByTime(BLEED_MS + 5000);
    game.host.world.update(); game.relay.flush();
    expect(life.state).toBe('down');
    // Real, ticking seconds still run it out.
    for (let i = 0; i < 160; i++) { vi.advanceTimersByTime(200); game.host.world.update(); }
    expect(life.state).toBe('dead');
    game.dispose();
  });
  it('says "back at the checkpoint" nowhere but a mission', () => {
    const game = party(1);
    game.tick();
    die(game.guests[0]!); game.relay.flush(); game.tick(100);
    for (let i = 0; i < 160; i++) { vi.advanceTimersByTime(200); game.host.world.update(); }
    expect(feeds(game.host).some(f => /BLED OUT · back at wave clear/.test(f))).toBe(true);
    game.dispose();
  });
});

describe('the team break and its ready vote', () => {
  it('is 45 s, 60 s before a boss wave, by mode', () => {
    expect(teamBreakSeconds('crucible', 4)).toBe(TEAM_BREAK);
    expect(teamBreakSeconds('crucible', 5)).toBe(BOSS_BREAK);
    expect(teamBreakSeconds('crucible', 10)).toBe(BOSS_BREAK);
    expect(teamBreakSeconds('outpost', 9)).toBe(TEAM_BREAK);
    expect(teamBreakSeconds('outpost', 10)).toBe(BOSS_BREAK);
    expect(teamBreakSeconds('defense', 5)).toBe(TEAM_BREAK);
    expect([TEAM_BREAK, BOSS_BREAK, CUT_TO]).toEqual([45, 60, 3]);
  });
  const clear = (game: ReturnType<typeof party>, wave: number, own = 8) => {
    game.host.ctx.events.emit('wave:clear', { wave, bonus: 0 });
    // The waves open the break themselves, after the event.
    Object.assign(game.host.waves, { wave, phase: 'intermission', nextWaveIn: own });
    game.relay.flush();
    for (const g of game.guests) Object.assign(g.waves, { wave, phase: 'intermission', nextWaveIn: own });
    game.tick(50);
  };
  it('stretches the host\'s break once it has begun, and leaves the first countdown of a run alone', () => {
    const game = party(1);
    Object.assign(game.host.waves, { wave: 0, phase: 'intermission', nextWaveIn: 3 });
    game.tick();
    expect(game.host.waves.nextWaveIn).toBe(3);
    press(game.host, 'nextWave'); game.relay.flush();
    expect(game.relay.events('vote')).toHaveLength(0);
    clear(game, 3);
    expect(game.host.waves.nextWaveIn).toBe(TEAM_BREAK);
    clear(game, 4);
    expect(game.host.waves.nextWaveIn).toBe(BOSS_BREAK);
    game.dispose();
  });
  it('one player alone never cuts the break; when everyone has pressed the key it drops to its last three seconds', () => {
    const game = party(2);
    game.tick();
    clear(game, 2);
    const [a, b] = game.guests as [Side, Side];
    press(game.host, 'nextWave'); game.relay.flush();
    expect(game.host.waves.nextWaveIn).toBe(TEAM_BREAK);
    expect(game.host.world.team.rest.ready).toEqual([0]);
    expect(a.world.team.rest).toMatchObject({ ready: [0], need: 3, on: true });
    expect(feeds(a).some(f => /HOST is ready \(1\/3\)/.test(f))).toBe(true);
    expect(feeds(game.host).some(f => /You are ready \(1\/3\)/.test(f))).toBe(true);
    // A guest's key is a message to the host: it never writes its own clock, and a second press counts once.
    press(a, 'nextWave'); press(a, 'nextWave'); game.relay.flush();
    expect(a.waves.nextWaveIn).toBe(8);
    expect(game.host.world.team.rest.ready).toEqual([0, a.lobby.me!.slot]);
    expect(game.host.waves.nextWaveIn).toBe(TEAM_BREAK);
    press(b, 'nextWave'); game.relay.flush();
    expect(game.host.waves.nextWaveIn).toBe(CUT_TO);
    expect(feeds(b).some(f => /EVERYONE READY/.test(f))).toBe(true);
    // The next wave clears the vote on every screen.
    game.host.ctx.events.emit('wave:start', { wave: 3, total: 10, boss: false }); game.relay.flush();
    expect(a.world.team.rest).toMatchObject({ ready: [], on: false });
    game.dispose();
  });
  it('pressing through the Commander\'s briefing is that player\'s vote (`readyUp`), and counts once with the key', () => {
    const game = party(1);
    game.tick();
    // Outside a break it says nothing.
    game.host.world.team.rest.readyUp(); game.relay.flush();
    expect(game.relay.events('vote')).toHaveLength(0);
    clear(game, 2);
    const [a] = game.guests as [Side];
    game.host.world.team.rest.readyUp(); game.relay.flush();
    expect(game.host.world.team.rest.ready).toEqual([0]);
    expect(game.host.waves.nextWaveIn).toBe(TEAM_BREAK);
    // The key after it is the same vote, not a second one.
    press(game.host, 'nextWave'); game.relay.flush();
    expect(game.host.world.team.rest.ready).toEqual([0]);
    // A guest's goes to the host, and with everyone in the break is cut.
    a.world.team.rest.readyUp(); game.relay.flush();
    expect(game.host.world.team.rest.ready).toEqual([0, a.lobby.me!.slot]);
    expect(game.host.waves.nextWaveIn).toBe(CUT_TO);
    game.dispose();
  });
  it('the dead never hold the team up, and a voter who leaves does not either', () => {
    const game = party(3);
    game.tick();
    clear(game, 2);
    const [a, b, c] = game.guests as [Side, Side, Side];
    // A is dead in the break (they came back dead, or fell to a straggler).
    die(a); game.relay.flush(); game.tick(50);
    game.host.world.team.life(a.lobby.you).bleed(Infinity); game.tick(50);
    expect(game.host.world.team.rest.need).toBe(3);
    press(game.host, 'nextWave'); press(b, 'nextWave'); game.relay.flush();
    expect(game.host.waves.nextWaveIn).toBeGreaterThan(CUT_TO);
    // C, the one not ready, leaves the match: the two who are ready are everyone.
    game.relay.close(c.room); game.relay.flush(); game.tick(50);
    expect(game.host.waves.nextWaveIn).toBe(CUT_TO);
    game.dispose();
  });
});

describe('seats: a rejoin gives the kit back and is not a free revive', () => {
  const kitOf = (side: Side): Kit => readKit(side.ctx);
  const arm = (side: Side) => {
    side.weapons.owned.add('shotgun'); side.weapons.current = 'shotgun';
    Object.assign(side.weapons.ammo('shotgun'), { mag: 5, reserve: 31, magSize: 8, maxReserve: 64 });
    Object.assign(side.weapons.ammo('smg'), { mag: 11, reserve: 77 });
    side.weapons.mods.add('suppressor'); side.weapons.fitted.add('suppressor');
    side.weapons.grenades = 5;
    side.progression.loadout.fit('berserk', true);
    side.progression.callIns.add('airstrike');
    side.progression.combo = 12; side.progression.kills = 40; side.progression.score = 9000; side.progression.headshots = 7;
    side.stims.count = 3;
    (side.ctx.contracts.wallet as unknown as { credits: number }).credits = 1450;
    (side.ctx.contracts as unknown as { chips: { rack: ChipRack } }).chips.rack.fit('thermal', true);
  };
  it('keeps the kit by the browser\'s id on the host and hands it to the same browser on a new page', () => {
    const game = party(2);
    game.tick();
    const a = game.guests[0]!;
    arm(a);
    const before = kitOf(a);
    game.tick(KIT_MS + 100); game.tick();
    expect(game.relay.events('kit').filter(e => e.from === 'guest-1').length).toBeGreaterThanOrEqual(1);
    // The tab dies; the same browser comes back on a new page, with a new peer id and the starter kit.
    const back = game.rejoin(0, 'guest-1b');
    expect(kitOf(back).guns.map(g => g.weapon)).toEqual(['smg']);
    game.tick();
    const after = kitOf(back);
    expect(after.guns.map(g => g.weapon).sort()).toEqual(['shotgun', 'smg']);
    expect(after.current).toBe('shotgun');
    expect(after.guns.find(g => g.weapon === 'shotgun')).toMatchObject({ mag: 5, reserve: 31 });
    expect(after.guns.find(g => g.weapon === 'smg')).toMatchObject({ mag: 11, reserve: 77, mods: ['suppressor'], fitted: ['suppressor'] });
    expect(after).toMatchObject({ grenades: 5, stims: 3, combo: 12, callIns: ['airstrike'] });
    expect(after.implantsFitted).toEqual(before.implantsFitted);
    expect(after.chipsFitted).toEqual(before.chipsFitted);
    expect(back.ctx.contracts.wallet).toMatchObject({ credits: 1450 });
    expect(back.progression.resume).toHaveBeenCalledWith(9000, 40, 7);
    expect(feeds(back).some(f => /your kit and credits are back/.test(f))).toBe(true);
    // A mission's catch-up asks once whether the seat has just given a kit back (it must then add to it, never replace it).
    expect(back.world.team.takeKitBack()).toBe(true);
    expect(back.world.team.takeKitBack()).toBe(false);
    // The other guest, with another browser, got nobody's kit.
    expect(kitOf(game.guests[1]!).guns.map(g => g.weapon)).toEqual(['smg']);
    expect(game.guests[1]!.world.team.takeKitBack()).toBe(false);
    game.dispose();
  });
  it('a fresh page\'s empty first cards never wipe the purse the host is keeping', () => {
    const game = party(1);
    game.tick();
    arm(game.guests[0]!);
    game.tick(KIT_MS + 100); game.tick();
    const back = game.rejoin(0, 'guest-1b');
    // Its first card arrives, and more follow before the purse has come back (a slow line): the host must not keep those zeros.
    const sendCard = () => { vi.advanceTimersByTime(300); back.world.update(); };
    sendCard(); sendCard(); sendCard();
    game.relay.flush(); game.host.world.update(); game.relay.flush();
    expect(back.ctx.contracts.wallet).toMatchObject({ credits: 1450 });
    // And if it drops again at once, the purse is still there.
    const again = game.rejoin(0, 'guest-1c');
    game.tick();
    expect(again.ctx.contracts.wallet).toMatchObject({ credits: 1450 });
    game.dispose();
  });
  it('someone who left dead or down comes back dead and waits for the team\'s next respawn', () => {
    const game = party(2);
    game.tick();
    const a = game.guests[0]!;
    arm(a); game.tick(KIT_MS + 100); game.tick();
    die(a); game.relay.flush(); game.tick(100);
    expect(game.host.world.team.life(a.lobby.you).state).toBe('down');
    const back = game.rejoin(0, 'guest-1b');
    game.tick();
    expect(game.host.world.team.life(back.lobby.you).state).toBe('dead');
    expect(back.player.alive).toBe(false);
    expect(feeds(back).some(f => /YOU LEFT DOWN/.test(f))).toBe(true);
    // The kit still came back.
    expect(kitOf(back).guns.map(g => g.weapon).sort()).toEqual(['shotgun', 'smg']);
    // The wave is cleared: now they get up.
    game.host.ctx.events.emit('wave:clear', { wave: 2, bonus: 0 }); game.relay.flush();
    expect(back.player.alive).toBe(true);
    game.dispose();
  });
  it('money owed to a player follows their seat: to their new page, or kept in the purse until they are back', () => {
    const game = party(1);
    game.tick();
    const first = game.guests[0]!;
    const old = first.lobby.you;
    arm(first); game.tick(KIT_MS + 100); game.tick();
    const team = game.host.world.team;
    expect(team.payee(old, 300)).toBe(old);
    expect(team.payee('nobody', 300)).toBeUndefined();
    // They drop: the bounty waits in the purse.
    first.world.dispose(); game.relay.close(first.room); game.relay.flush(); game.tick();
    expect(team.payee(old, 300)).toBeNull();
    const back = game.rejoin(0, 'guest-1b');
    game.tick();
    expect(back.ctx.contracts.wallet).toMatchObject({ credits: 1450 + 300 });
    // Owed to the id they had before the reload: paid to the page they are on now.
    expect(team.payee(old, 50)).toBe(back.lobby.you);
    game.dispose();
  });
  it('someone who left dead and sat out the team\'s respawn while away comes back alive', () => {
    const game = party(2);
    game.tick();
    const a = game.guests[0]!;
    arm(a); game.tick(KIT_MS + 100); game.tick();
    die(a); game.relay.flush(); game.tick(100);
    // Their page dies; while they are away the wave is cleared and everyone else respawns.
    a.world.dispose(); game.relay.close(a.room); game.relay.flush(); game.tick();
    game.host.ctx.events.emit('wave:clear', { wave: 2, bonus: 0 }); game.relay.flush();
    const back = game.rejoin(0, 'guest-1b');
    game.tick();
    expect(game.host.world.team.life(back.lobby.you).state).toBe('up');
    expect(back.player.alive).toBe(true);
    expect(feeds(back).some(f => /YOU LEFT DOWN/.test(f))).toBe(false);
    expect(kitOf(back).guns.map(g => g.weapon).sort()).toEqual(['shotgun', 'smg']);
    game.dispose();
  });
  it('a connection that drops and comes back on the same page keeps its life, its seconds and what it holds', () => {
    const game = party(2);
    game.tick();
    const a = game.guests[0]!;
    const id = a.lobby.you;
    arm(a); game.tick(KIT_MS + 100); game.tick();
    die(a); game.relay.flush(); game.tick(100);
    const life = game.host.world.team.life(id);
    const bleedBefore = life.bleedUntil - performance.now();
    // The line drops for ten seconds; the page is still there, and its seat is kept.
    game.relay.close(a.room); game.relay.flush();
    for (let i = 0; i < 50; i++) { vi.advanceTimersByTime(200); game.host.world.update(); }
    expect(game.host.lobby.players.find(p => p.id === id)).toMatchObject({ away: true, state: 'lost' });
    expect(life.state).toBe('down');
    // Nobody bleeds out behind a dead line: the seconds are still theirs.
    expect(life.bleedUntil - performance.now()).toBeGreaterThan(bleedBefore - 1000);
    (a.ctx.contracts.wallet as unknown as { credits: number }).credits = 999;
    game.relay.reopen(a.room); game.relay.flush();
    game.tick(); game.tick();
    expect(game.host.lobby.players.some(p => p.id === id && !p.away)).toBe(true);
    expect(game.host.world.team.life(id)).toBe(life);
    expect(life.state).toBe('down');
    // What their page holds is newer than the host's copy: nothing is put back over it.
    expect(a.ctx.contracts.wallet).toMatchObject({ credits: 999 });
    expect(a.weapons.setLoadout).not.toHaveBeenCalled();
    expect(feeds(a).some(f => /REJOINED|YOU LEFT DOWN/.test(f))).toBe(false);
    game.dispose();
  });
  it('a respawn the team had while a connection was down reaches that player when it is back', () => {
    const game = party(2);
    game.tick();
    const a = game.guests[0]!;
    const id = a.lobby.you;
    die(a); game.relay.flush(); game.tick(100);
    game.relay.close(a.room); game.relay.flush(); game.tick();
    game.host.ctx.events.emit('wave:clear', { wave: 2, bonus: 0 }); game.relay.flush();
    expect(game.host.world.team.life(id).state).toBe('up');
    expect(a.player.alive).toBe(false);
    game.relay.reopen(a.room); game.relay.flush();
    game.tick(); game.tick();
    expect(a.player.alive).toBe(true);
    expect(a.player.downed).toBe(false);
    game.dispose();
  });
  it('Outpost Defense: a player who comes back with a kit is not sent to the loadout screen; a new player is', () => {
    const game = party(1);
    game.tick();
    const a = game.guests[0]!;
    arm(a); game.tick(KIT_MS + 100); game.tick();
    const back = game.rejoin(0, 'guest-1b');
    const defense = { resumed: vi.fn() };
    (back.ctx.contracts as unknown as { defense: unknown }).defense = defense;
    expect(back.world.team.seated).toBe(false);
    game.tick();
    expect(back.world.team.seated).toBe(true);
    expect(defense.resumed).toHaveBeenCalledOnce();
    expect(kitOf(back).guns.map(g => g.weapon).sort()).toEqual(['shotgun', 'smg']);
    game.dispose();
    // A new player's seat is settled with nothing in it: the mode's own loadout is theirs to pick.
    const other = party(1, 'crucible', undefined, [0]);
    const fresh = { resumed: vi.fn() };
    (other.guests[0]!.ctx.contracts as unknown as { defense: unknown }).defense = fresh;
    other.guests[0]!.world.begin(); other.tick();
    expect(other.guests[0]!.world.team.seated).toBe(true);
    expect(fresh.resumed).not.toHaveBeenCalled();
    other.dispose();
  });
  it('a brand-new player gets no purse, no kit and no line about rejoining', () => {
    const game = party(1);
    game.tick();
    const g = game.guests[0]!;
    expect(feeds(g).some(f => /REJOINED/.test(f))).toBe(false);
    expect(g.progression.resume).not.toHaveBeenCalled();
    expect(g.weapons.setLoadout).not.toHaveBeenCalled();
    game.dispose();
  });
  it('cleans a kit from another browser: known guns and mods only, bounded numbers, junk refused', () => {
    expect(cleanKit(null)).toBeNull();
    expect(cleanKit({ guns: [] })).toBeNull();
    expect(cleanKit({ guns: [{ weapon: 'not-a-gun', mods: [], fitted: [], mag: 1, reserve: 1 }] })).toBeNull();
    const kit = cleanKit({ guns: [{ weapon: 'smg', mods: ['suppressor', 'bogus'], fitted: ['bogus'], mag: 1e9, reserve: -5 }, { weapon: 'smg', mods: [], fitted: [], mag: 1, reserve: 1 }],
      current: 'lance', grenades: 1e9, stims: NaN, implants: ['berserk', 'x'], implantsFitted: ['x', 'berserk', 'slowmo'], implantSlots: 99,
      chips: ['thermal', 'zzz'], chipsFitted: ['thermal', 'focus'], chipSlots: -3, callIns: ['nuke', 'pizza'], combo: 1e9, headshots: 'many' })!;
    expect(kit.guns).toHaveLength(1);
    expect(kit.guns[0]).toMatchObject({ weapon: 'smg', mods: ['suppressor'], fitted: [], reserve: 0 });
    expect(kit.guns[0]!.mag).toBeLessThan(1000);
    expect(kit).toMatchObject({ current: 'smg', stims: 0, implants: ['berserk'], implantsFitted: ['berserk'], chips: ['thermal'], chipsFitted: ['thermal'], chipSlots: 1, callIns: ['nuke'], combo: 9999, headshots: 0 });
    expect(kit.grenades).toBeLessThanOrEqual(6);
    expect(kit.implantSlots).toBeLessThanOrEqual(3);
  });
  it('puts a kit back through the game\'s own calls', () => {
    const side = context();
    applyKit(side.ctx, cleanKit({ guns: [{ weapon: 'smg', mods: [], fitted: [], mag: 4, reserve: 9 }, { weapon: 'shotgun', mods: [], fitted: [], mag: 2, reserve: 3 }], current: 'shotgun',
      grenades: 2, stims: 0, implants: [], implantsFitted: [], implantSlots: 2, chips: ['sonar', 'thermal'], chipsFitted: ['thermal'], chipSlots: 2, callIns: ['warthog'], combo: 5, headshots: 0 })!);
    expect(side.weapons.setLoadout).toHaveBeenCalledWith(['shotgun', 'smg'], 2);
    expect(side.weapons.ammo('smg')).toMatchObject({ mag: 4, reserve: 9 });
    expect(side.progression.grantCallIn).toHaveBeenCalledWith('warthog');
    expect(side.progression.setCombo).toHaveBeenCalledWith(5);
    expect(side.stims.count).toBe(0);
    expect(side.progression.loadout.slots).toBe(2);
    const rack = (side.ctx.contracts as unknown as { chips: { rack: ChipRack } }).chips.rack;
    expect([...rack.fitted]).toEqual(['thermal']);
    expect(rack.slots).toBe(2);
  });
});

describe('a late joiner is told where the waves stand', () => {
  it('gets the banner mid-wave, and in a break the banner, the clock and the vote', () => {
    // Only guest 1 is in so far.
    const game = party(2, 'crucible', undefined, [1]);
    vi.advanceTimersByTime(300); game.host.world.update(); game.relay.flush(); game.guests[0]!.world.update(); game.relay.flush(); game.host.world.update(); game.relay.flush();
    expect(game.guests[0]!.hud.banner).toHaveBeenCalledWith('WAVE 1', expect.stringContaining('in progress'));
    game.host.ctx.events.emit('wave:clear', { wave: 4, bonus: 0 });
    Object.assign(game.host.waves, { wave: 4, phase: 'intermission', nextWaveIn: 8 });
    game.relay.flush(); game.host.world.update(); game.relay.flush();
    press(game.host, 'nextWave'); game.relay.flush();
    const late = game.guests[1]!;
    late.world.begin(); game.relay.flush();
    expect(late.hud.banner).toHaveBeenCalledWith('WAVE 4 CLEAR', expect.stringContaining('wave 5 in'));
    // The pod itself is the shared world's to bring (world/pods.ts catch-up), never a second one from here.
    expect(late.progression.pods.onWaveClear).not.toHaveBeenCalled();
    expect(late.world.team.rest).toMatchObject({ on: true, ready: [0] });
    game.dispose();
  });
});

describe('pings', () => {
  it('show at once for the pinger, reach every other screen with the host\'s word on whose it was, and expire', () => {
    const game = party(2);
    game.tick();
    const [a, b] = game.guests as [Side, Side];
    (a.ctx.physics.raycast as ReturnType<typeof vi.fn>).mockReturnValue({ point: new THREE.Vector3(3, 0, -20) });
    press(a, 'ping');
    expect(a.hud.marker).toHaveBeenCalledOnce();
    expect(a.hud.marker.mock.calls[0]![1]).toBe('YOUR PING');
    game.relay.flush();
    for (const other of [game.host, b]) {
      expect(other.hud.marker).toHaveBeenCalledOnce();
      expect((other.hud.marker.mock.calls[0]![0] as THREE.Vector3).toArray()).toEqual([3, 0, -20]);
      expect(other.hud.marker.mock.calls[0]![1]).toBe('PING · GUEST1');
    }
    // Not echoed back to the pinger.
    expect(a.hud.marker).toHaveBeenCalledOnce();
    // The host's own ping goes to everyone; with nothing in front it lands ahead.
    press(game.host, 'ping'); game.relay.flush();
    expect(b.hud.marker.mock.calls[1]![1]).toBe('PING · HOST');
    expect((b.hud.marker.mock.calls[1]![0] as THREE.Vector3).z).toBeLessThan(-30);
    const off = b.hud.marker.mock.results[0]!.value as ReturnType<typeof vi.fn>;
    vi.advanceTimersByTime(MARK_SECONDS * 1000 + 100); b.world.update();
    expect(off).toHaveBeenCalled();
    game.dispose();
  });
  it('are capped per player and dropped by the host when they come in a flood', () => {
    const game = party(1);
    game.tick();
    const g = game.guests[0]!;
    for (let i = 0; i < 12; i++) g.room.channel('action').send(batchOf('team-test', [{ t: 'mark', at: [i, 0, 0] }]), 'host-peer');
    game.relay.flush();
    expect(game.host.hud.marker).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 4; i++) { vi.advanceTimersByTime(MARK_GAP_MS + 10); g.room.channel('action').send(batchOf('team-test', [{ t: 'mark', at: [i, 0, 0] }]), 'host-peer'); game.relay.flush(); }
    expect(game.host.world.team.marks.live.length).toBe(MARK_KEEP);
    // A forged slot or a bad point is ignored.
    g.room.channel('action').send(batchOf('team-test', [{ t: 'mark', at: [NaN, 0, 0] }]), 'host-peer'); game.relay.flush();
    expect(game.host.world.team.marks.live.length).toBe(MARK_KEEP);
    game.dispose();
  });
});

describe('kill credit and rewards go to the player who earned them', () => {
  const claimKill = (game: ReturnType<typeof party>, guest: Side, enemy: Enemy, source = 'smg') => {
    game.host.manager.applyDamage.mockImplementationOnce((target: Enemy) => { target.alive = false; kill(game.host, target, source); });
    guest.ctx.events.emit('weapon:fired', { weapon: 'smg', origin: new THREE.Vector3(0, 1.6, -3), dir: new THREE.Vector3(0, 0, -1) } as never);
    game.relay.flush();
    const copy = guest.ctx.enemies.alive.find(e => e.uid === enemy.uid)!;
    guest.world.claim(copy, { amount: 50, type: 'bullet', source, point: copy.center.clone(), dir: new THREE.Vector3(0, 0, -1), force: 1 });
    game.relay.flush();
  };
  const hit = (game: ReturnType<typeof party>, guest: Side, enemy: Enemy) => {
    game.host.manager.applyDamage.mockImplementationOnce((target: Enemy) => {
      game.host.ctx.events.emit('enemy:hit', { enemy: target, damage: { source: 'smg', point: target.center, dir: new THREE.Vector3(), amount: 5, type: 'bullet', force: 1 }, result: { blocked: false } } as never);
    });
    guest.ctx.events.emit('weapon:fired', { weapon: 'smg', origin: new THREE.Vector3(0, 1.6, -3), dir: new THREE.Vector3(0, 0, -1) } as never);
    game.relay.flush();
    const copy = guest.ctx.enemies.alive.find(e => e.uid === enemy.uid)!;
    guest.world.claim(copy, { amount: 5, type: 'bullet', source: 'smg', point: copy.center.clone(), dir: new THREE.Vector3(0, 0, -1), force: 1 });
    game.relay.flush();
  };
  const by = (game: ReturnType<typeof party>, uid: number) => (game.relay.events('kill').find(e => (e.data as { uid: number }).uid === uid)!.data as { by: number }).by;
  it('the host\'s call-in, slam or barrel kill on an enemy a guest once hit is the host\'s', () => {
    const game = party(1);
    const g = game.guests[0]!;
    const feed: string[] = [];
    game.host.ctx.events.on('coop:kill', k => feed.push(`host sees ${k.by}`));
    g.ctx.events.on('coop:kill', k => feed.push(`guest sees ${k.by}`));
    for (const source of ['airstrike', 'warthog', 'ac130', 'sentry', 'skyfall', 'barrel', 'frame']) {
      const enemy = game.host.manager.spawn('husk', new THREE.Vector3(0, 0, -8));
      game.tick(120);
      hit(game, g, enemy);
      vi.advanceTimersByTime(1000);
      let mine: boolean | null = null;
      const off = game.host.ctx.events.on('enemy:killed', e => { mine = !game.host.world.notMine(e.enemy); });
      kill(game.host, enemy, source); game.relay.flush(); off();
      expect(mine, source).toBe(true);
      expect(by(game, enemy.uid), source).toBe(0);
    }
    expect(feed.filter(f => f === 'host sees 0')).toHaveLength(7);
    expect(feed.filter(f => f === 'guest sees 0')).toHaveLength(7);
    game.dispose();
  });
  it('a bleed or a burn kills for whoever hurt the enemy last, host or guest, and only for a while', () => {
    const game = party(1);
    const g = game.guests[0]!;
    const slot = g.lobby.me!.slot;
    // The guest's hit, then it bleeds out: the guest's.
    const a = game.host.manager.spawn('husk', new THREE.Vector3(0, 0, -8)); game.tick(120);
    hit(game, g, a); kill(game.host, a, 'bleed'); game.relay.flush();
    expect(by(game, a.uid)).toBe(slot);
    // The guest hit it, then the host hit it, then it burns: the host's.
    const b = game.host.manager.spawn('husk', new THREE.Vector3(0, 0, -8)); game.tick(120);
    hit(game, g, b);
    game.host.ctx.events.emit('enemy:hit', { enemy: b, damage: { source: 'kiln', point: b.center, dir: new THREE.Vector3(), amount: 5, type: 'fire', force: 1 }, result: { blocked: false } } as never);
    // `burn` is the burn tick's real source (EnemyManager.updateBurn); credit.test.ts runs the real tick.
    kill(game.host, b, 'burn'); game.relay.flush();
    expect(by(game, b.uid)).toBe(0);
    // The guest's fire (a `status` claim), then the burn's own ticks as hits, then it dies burning: the guest's.
    const d = game.host.manager.spawn('husk', new THREE.Vector3(0, 0, -8)); game.tick(120);
    g.world.status(g.ctx.enemies.alive.find(e => e.uid === d.uid)!, 'burn', 4); game.relay.flush();
    for (let i = 0; i < 4; i++) game.host.ctx.events.emit('enemy:hit', { enemy: d, damage: { source: 'burn', point: d.center, dir: new THREE.Vector3(), amount: 4, type: 'fire', force: 0 }, result: { blocked: false } } as never);
    kill(game.host, d, 'burn'); game.relay.flush();
    expect(by(game, d.uid)).toBe(slot);
    // A hit long ago no longer claims a bleed.
    const c = game.host.manager.spawn('husk', new THREE.Vector3(0, 0, -8)); game.tick(120);
    hit(game, g, c);
    vi.advanceTimersByTime(LINGER_MS + 1000);
    kill(game.host, c, 'bleed'); game.relay.flush();
    expect(by(game, c.uid)).toBe(0);
    game.dispose();
  });
  it('a garrison ally\'s kill is nobody\'s, even on an enemy a guest hit', () => {
    const game = party(1);
    const g = game.guests[0]!;
    const enemy = game.host.manager.spawn('husk', new THREE.Vector3(0, 0, -8)); game.tick(120);
    hit(game, g, enemy);
    const guestKills = vi.fn(); g.ctx.events.on('enemy:killed', guestKills);
    kill(game.host, enemy, 'ally_rifle'); game.relay.flush();
    expect(by(game, enemy.uid)).toBe(-1);
    expect(guestKills).not.toHaveBeenCalled();
    game.dispose();
  });
  it('a blast a guest\'s hit queued for a later frame is still the guest\'s when it goes off', () => {
    const game = party(1);
    const g = game.guests[0]!;
    const first = game.host.manager.spawn('husk', new THREE.Vector3(0, 0, -8));
    const second = game.host.manager.spawn('husk', new THREE.Vector3(1, 0, -8));
    game.tick(120);
    let owner: string | null = null;
    game.host.manager.applyDamage.mockImplementationOnce((target: Enemy) => { owner = game.host.world.crediting; target.alive = false; kill(game.host, target, 'smg'); });
    g.ctx.events.emit('weapon:fired', { weapon: 'smg', origin: new THREE.Vector3(0, 1.6, -3), dir: new THREE.Vector3(0, 0, -1) } as never); game.relay.flush();
    const copy = g.ctx.enemies.alive.find(e => e.uid === first.uid)!;
    g.world.claim(copy, { amount: 50, type: 'bullet', source: 'smg', point: copy.center.clone(), dir: new THREE.Vector3(0, 0, -1), force: 1 }); game.relay.flush();
    expect(owner).toBe(g.lobby.you);
    expect(game.host.world.crediting).toBeNull();
    // Combat runs the queued blast a frame later under the owner it noted (weapons/Combat.ts drainBlasts).
    const before = game.host.world.creditAs(owner);
    expect(game.host.world.notMine()).toBe(true);
    kill(game.host, second, 'barrel');
    game.host.world.creditAs(before);
    game.relay.flush();
    expect(by(game, second.uid)).toBe(g.lobby.me!.slot);
    expect(game.host.world.notMine()).toBe(false);
    game.dispose();
  });
  it('a guest\'s wound bonus, execution and BACK SHOT label go to the guest, not the host', () => {
    const game = party(2);
    const [g, other] = game.guests as [Side, Side];
    const enemy = game.host.manager.spawn('trooper', new THREE.Vector3(0, 0, -8)); game.tick(120);
    let labelled: boolean | null = null;
    game.host.manager.applyDamage.mockImplementationOnce((target: Enemy) => {
      game.host.ctx.events.emit('enemy:wounded', { enemy: target, zone: 'gut', label: 'GUT SHOT', bonus: 150, damage: { source: 'smg', point: target.center, dir: new THREE.Vector3(), amount: 5, type: 'bullet', force: 1 } } as never);
      labelled = game.host.world.labelFor(target.center, 'BACK SHOT', '#ffd400');
    });
    g.ctx.events.emit('weapon:fired', { weapon: 'smg', origin: new THREE.Vector3(0, 1.6, -3), dir: new THREE.Vector3(0, 0, -1) } as never); game.relay.flush();
    const copy = g.ctx.enemies.alive.find(e => e.uid === enemy.uid)!;
    g.world.claim(copy, { amount: 5, type: 'bullet', source: 'smg', point: copy.center.clone(), dir: new THREE.Vector3(0, 0, -1), force: 1 }); game.relay.flush();
    expect(labelled).toBe(true);
    expect(g.progression.award).toHaveBeenCalledWith(150, 'GUT SHOT', expect.any(THREE.Vector3));
    expect(g.hud.floatText).toHaveBeenCalledWith(expect.any(THREE.Vector3), expect.stringContaining('BACK SHOT'), '#ffd400');
    expect(other.progression.award).not.toHaveBeenCalled();
    expect(game.host.hud.floatText).not.toHaveBeenCalled();
    // The host's own hit is labelled on the host.
    expect(game.host.world.labelFor(enemy.center, 'BACK SHOT')).toBe(false);
    // An execution: the guest kills a man who had given up; the host's world says so, the guest's browser is told.
    const executed = vi.fn(); g.ctx.events.on('enemy:executed', executed);
    const hostExecuted = vi.fn();
    game.host.ctx.events.on('enemy:killed', k => game.host.ctx.events.emit('enemy:executed', { kill: k }));
    game.host.ctx.events.on('enemy:executed', e => { if (!game.host.world.notMine(e.kill.enemy)) hostExecuted(); });
    claimKill(game, g, enemy);
    expect(hostExecuted).not.toHaveBeenCalled();
    expect(executed).toHaveBeenCalledOnce();
    expect(other.hud.floatText).not.toHaveBeenCalled();
    game.dispose();
  });
});

describe('the team is told', () => {
  it('who has cheats on, once, on the strip\'s card and in the feed of every screen', async () => {
    const cheats = await import('../core/cheats');
    cheats.resetCheatsForTest(false);
    const game = party(1);
    game.tick();
    const lines: string[] = [];
    game.guests[0]!.lobby.onLine = line => lines.push(line.text);
    expect(lines).toEqual([]);
    cheats.resetCheatsForTest(true);
    game.tick(); game.tick();
    // Both pages share the one module in a test, so both say so: each is announced once.
    expect(lines.filter(l => /HOST has cheats on/.test(l))).toHaveLength(1);
    expect(lines.filter(l => /GUEST1 has cheats on/.test(l))).toHaveLength(1);
    expect(game.guests[0]!.world.team.cards.get(0)).toMatchObject({ cheats: true });
    cheats.resetCheatsForTest(false);
    game.dispose();
  });
});

describe('the host\'s rules are the run\'s rules on every screen', () => {
  const events = (game: ReturnType<typeof party>, type: string, to: string) => game.relay.events(type).filter(e => e.to === to);
  afterEach(() => adoptRules(null));

  it('a guest is told the host\'s custom Crucible rules as it arrives, plays by them, and says so once', () => {
    const game = party(1, 'crucible', ['b1'], [0]);
    const guest = game.guests[0]!, id = guest.lobby.you;
    const adopt = vi.fn(), tune = vi.fn();
    Object.assign(guest.waves, { adopt });
    Object.assign(guest.manager, { tune });
    // The host's page plays these (one process stands for both pages here: the rules are set as the host's world reads them).
    const hosts = cloneRules(DEFAULT_RULES);
    hosts.healthPct = 200; hosts.damagePct = 150; hosts.helmetsFrom = 1; hosts.startWave = 12; hosts.titan.first = 12; hosts.types.brute.on = false;
    adoptRules(hosts);
    guest.world.begin();
    game.tick();
    const sync = events(game, 'sync', id).at(-1)!.data as { custom: boolean; rules: Record<string, unknown> };
    expect(sync.custom).toBe(true);
    // Only what differs from the standard game crosses.
    expect(sync.rules).toEqual({ healthPct: 200, damagePct: 150, helmetsFrom: 1, startWave: 12, titan: { first: 12 }, types: { brute: { on: false } } });
    expect(adopt).toHaveBeenCalledTimes(1);
    expect(rulesEqual(adopt.mock.calls[0]![0] as CrucibleRules, hosts)).toBe(true);
    expect(rulesEqual(crucibleRules(), hosts)).toBe(true);
    expect(guest.world.team.customRules).toBe(true);
    expect(guest.hud.feed.mock.calls.filter(c => /HOST'S CUSTOM RULES APPLY/.test(String(c[0])))).toHaveLength(1);
    // The guest's own run starts after that (its click to deploy): every system is put back to its start, and the host's
    // rules are set again. (The browser proof found the manager on the standard game's numbers without this.)
    guest.ctx.events.emit('run:start', {});
    expect(adopt).toHaveBeenCalledTimes(2);
    expect(rulesEqual(adopt.mock.calls[1]![0] as CrucibleRules, hosts)).toBe(true);
    // The manager's numbers are set by the team itself, not through the waves: a guest's waves are never set up.
    expect(tune).toHaveBeenCalledTimes(2);
    expect(tune.mock.calls[1]![0]).toMatchObject({ healthPct: 200, damagePct: 150, helmetsFrom: 1 });
    game.dispose();
  });

  it('a host on the standard game says so, and a guest with rules of its own saved plays the standard game', () => {
    const game = party(1, 'crucible', ['b1'], [0]);
    const guest = game.guests[0]!, id = guest.lobby.you;
    const adopt = vi.fn();
    Object.assign(guest.waves, { adopt });
    adoptRules(DEFAULT_RULES);
    guest.world.begin();
    game.tick();
    const sync = events(game, 'sync', id).at(-1)!.data as { custom: boolean; rules?: unknown };
    expect(sync.custom).toBe(false);
    expect(sync.rules).toBeUndefined();
    expect(adopt).toHaveBeenLastCalledWith(DEFAULT_RULES);
    expect(crucibleRules()).toBe(DEFAULT_RULES);
    game.dispose();
  });

  it('in any other mode the manager\'s numbers are left alone: only the Crucible\'s game sets them from the rules', () => {
    const game = party(1, 'outpost', ['b1'], [0]);
    const guest = game.guests[0]!;
    const adopt = vi.fn(), tune = vi.fn();
    Object.assign(guest.waves, { adopt });
    Object.assign(guest.manager, { tune });
    guest.world.begin();
    game.tick();
    guest.ctx.events.emit('run:start', {});
    expect(tune).not.toHaveBeenCalled();
    expect(adopt).not.toHaveBeenCalled();
    expect(crucibleRules()).toBe(DEFAULT_RULES);
    game.dispose();
  });

  it('rules that are not rules are put on their grid and inside their range before a guest plays by them', () => {
    const game = party(1);
    game.tick();
    const guest = game.guests[0]!;
    const adopt = vi.fn();
    Object.assign(guest.waves, { adopt });
    const say = (rules: unknown) => { (game.host.world as unknown as { w: { send(event: WorldEvent, to?: string): void } }).w.send({ t: 'sync', wave: 1, phase: 'spawning', left: 0, rest: false, custom: true, rules, ready: [], need: 1, back: true } as unknown as WorldEvent, guest.lobby.you); game.relay.flush(); game.tick(50); };
    say({ healthPct: 1e9, damagePct: 'lots', startWave: -5, types: { husk: { on: false }, nobody: { on: true } }, extra: { deep: [1, 2, 3] } });
    const got = adopt.mock.calls.at(-1)![0] as CrucibleRules;
    expect(got.healthPct).toBe(400);
    expect(got.damagePct).toBe(100);
    expect(got.startWave).toBe(1);
    expect(Object.keys(got.types)).toEqual(Object.keys(DEFAULT_RULES.types));
    expect('extra' in got).toBe(false);
    say('nonsense');
    expect(adopt).toHaveBeenLastCalledWith(DEFAULT_RULES);
    game.dispose();
  });

  it('a guest counts the enemies left as the host does: the host\'s queue and prisoners, on top of the copies alive here', () => {
    const game = party(1);
    const host = game.host.manager as unknown as { remaining: number }, guest = game.guests[0]!.manager as unknown as { hostMore?: number | null };
    // Thirty-one still to come on the host, two alive.
    game.host.manager.spawn('husk', new THREE.Vector3()); game.host.manager.spawn('husk', new THREE.Vector3());
    host.remaining = 33;
    game.tick();
    expect((game.relay.events('team').at(-1)!.data as { more: number }).more).toBe(31);
    expect(guest.hostMore).toBe(31);
    // Prisoners on the host with nothing queued: fewer left than alive.
    host.remaining = 1;
    game.tick();
    expect(guest.hostMore).toBe(-1);
    game.dispose();
  });
});

describe('the session\'s word on a seat drives the team: arriving, dropping, coming back', () => {
  const events = (game: ReturnType<typeof party>, type: string, to: string) => game.relay.events(type).filter(e => e.to === to);
  it('the same page back after a drop gets the wave it missed with the clock as it stands, the vote, and no second seat', () => {
    const game = party(2);
    game.tick();
    const a = game.guests[0]!, id = a.lobby.you;
    const heard: string[] = [];
    a.ctx.events.on('wave:clear', e => heard.push(`clear ${e.wave} ${e.bonus}`));
    a.ctx.events.on('wave:start', e => heard.push(`start ${e.wave}`));
    const seatsBefore = events(game, 'restore', id).length;
    const catchUps = (game.host.progression.pods.catchUp as ReturnType<typeof vi.fn>).mock.calls.length;
    game.relay.close(a.room); game.relay.flush();
    // The wave is cleared and the host votes while the line is down: none of it reaches that page.
    Object.assign(game.host.waves, { wave: 3, phase: 'intermission', nextWaveIn: 40 });
    game.host.ctx.events.emit('wave:clear', { wave: 3, bonus: 650 }); game.relay.flush();
    press(game.host, 'nextWave'); game.relay.flush();
    expect(heard).toEqual([]);
    game.host.waves.nextWaveIn = 31;
    a.hud.banner.mockClear();
    game.relay.reopen(a.room); game.relay.flush(); game.tick();
    // Its own wave event, late, with the pay; the phase and the clock are the host's of now, not of then.
    expect(heard).toEqual(['clear 3 650']);
    expect(a.waves).toMatchObject({ wave: 3, phase: 'intermission' });
    expect(a.waves.nextWaveIn).toBeGreaterThan(29); expect(a.waves.nextWaveIn).toBeLessThan(32);
    expect(a.world.team.rest).toMatchObject({ on: true, ready: [0] });
    // It is the same page: no seat is sent again, and it is not told it "joined late".
    expect(events(game, 'restore', id)).toHaveLength(seatsBefore);
    expect(events(game, 'sync', id).at(-1)?.data).toMatchObject({ back: true, rest: true });
    expect(a.hud.banner).not.toHaveBeenCalledWith(expect.anything(), expect.stringContaining('joined late'));
    // And the world's own catch-ups ran for it again (the pod, the guns, what is broken).
    expect((game.host.progression.pods.catchUp as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(catchUps);
    expect(game.host.progression.pods.catchUp).toHaveBeenLastCalledWith(id);
    // The other guest, who never left, got the wave once, when it happened.
    expect(events(game, 'wave', game.guests[1]!.lobby.you)).toHaveLength(1);
    game.dispose();
  });
  it('a wave that started while the line was down shuts the break on that page when it is back', () => {
    const game = party(1);
    game.tick();
    const a = game.guests[0]!;
    Object.assign(game.host.waves, { wave: 2, phase: 'intermission', nextWaveIn: 40 });
    game.host.ctx.events.emit('wave:clear', { wave: 2, bonus: 0 }); game.relay.flush(); game.tick();
    expect(a.world.team.rest.on).toBe(true);
    game.relay.close(a.room); game.relay.flush();
    Object.assign(game.host.waves, { wave: 3, phase: 'spawning', nextWaveIn: 0 });
    game.host.ctx.events.emit('wave:start', { wave: 3, total: 18, boss: false }); game.relay.flush();
    const started: number[] = [];
    a.ctx.events.on('wave:start', e => started.push(e.wave));
    game.relay.reopen(a.room); game.relay.flush(); game.tick();
    expect(started).toEqual([3]);
    expect(a.world.team.rest.on).toBe(false);
    expect(a.waves).toMatchObject({ wave: 3, phase: 'spawning' });
    game.dispose();
  });
  it('a page whose seat never reached it asks again until the host has sent it, and is told nothing else twice', () => {
    const game = party(1);
    game.tick();
    const a = game.guests[0]!, id = a.lobby.you;
    (a.ctx.contracts.wallet as unknown as { credits: number }).credits = 700;
    game.tick(); game.tick();
    // As if the seat's word had been lost: the page is not settled, so its cards stop saying so.
    (a.world.team as unknown as { settled: boolean }).settled = false;
    const seats = events(game, 'restore', id).length, syncs = events(game, 'sync', id).length;
    game.tick(400); game.tick(400); game.tick(400); game.tick(400);
    expect(game.relay.events('worldsync').length).toBeGreaterThan(1);
    expect(events(game, 'restore', id).length).toBe(seats + 1);
    expect((a.world.team as unknown as { settled: boolean }).settled).toBe(true);
    expect(events(game, 'sync', id)).toHaveLength(syncs);
    // Settled, it stops asking.
    const asks = game.relay.events('worldsync').length;
    game.tick(1200); game.tick(1200);
    expect(game.relay.events('worldsync')).toHaveLength(asks);
    game.dispose();
  });
  it('the last one standing losing their link is not a wipe for ten seconds: back in time, the run goes on', () => {
    const game = party(1);
    game.tick();
    const a = game.guests[0]!;
    die(game.host); game.relay.flush(); game.tick(100);
    expect(game.host.world.team.life('host').state).toBe('down');
    game.relay.close(a.room); game.relay.flush();
    for (let i = 0; i < 40; i++) { vi.advanceTimersByTime(200); game.host.world.update(); }
    expect(game.host.lobby.players.find(p => !p.host)).toMatchObject({ state: 'lost' });
    expect(game.host.world.team.ending).toBeNull();
    game.relay.reopen(a.room); game.relay.flush(); game.tick();
    for (let i = 0; i < 30; i++) game.tick(500);
    expect(game.host.world.team.ending).toBeNull();
    game.dispose();
  });
  it('a returning player on their way back in (their line answers, their page has not said where it is) still holds the wipe off', () => {
    const game = party(1);
    game.tick();
    const a = game.guests[0]!;
    die(game.host); game.relay.flush(); game.tick(100);
    game.relay.close(a.room); game.relay.flush();
    const row = game.host.lobby.players.find(p => !p.host)!;
    expect(row.state).toBe('lost');
    for (let i = 0; i < 45; i++) { vi.advanceTimersByTime(200); game.host.world.update(); }
    // Nine seconds in the lobby hears from them again: behind the load barrier that is 'loading' until their page reports in.
    row.state = 'loading';
    for (let i = 0; i < 15; i++) { vi.advanceTimersByTime(200); game.host.world.update(); }
    // Twelve seconds after the loss, and no wipe: they were given time to arrive.
    expect(game.host.world.team.ending).toBeNull();
    // But not for ever: a page that never reports in is not waited on.
    for (let i = 0; i < 20; i++) { vi.advanceTimersByTime(200); game.host.world.update(); }
    expect(game.host.world.team.ending).toBe('wipe');
    game.dispose();
  });
  it('not back within the ten seconds, the wipe rules apply; a player who was already down holds nothing off', () => {
    const game = party(1);
    game.tick();
    const a = game.guests[0]!;
    die(game.host); game.relay.flush(); game.tick(100);
    game.relay.close(a.room); game.relay.flush();
    for (let i = 0; i < 48; i++) { vi.advanceTimersByTime(200); game.host.world.update(); }
    expect(game.host.world.team.ending).toBeNull();
    for (let i = 0; i < 5; i++) { vi.advanceTimersByTime(200); game.host.world.update(); }
    expect(game.host.world.team.ending).toBe('wipe');
    game.dispose();
    // Down when the line dropped: nobody is up, and nothing waits.
    const second = party(1);
    second.tick();
    const b = second.guests[0]!;
    die(b); second.relay.flush(); second.tick(100);
    second.relay.close(b.room); second.relay.flush();
    die(second.host); second.relay.flush();
    second.host.world.update();
    expect(second.host.world.team.ending).toBe('wipe');
    second.dispose();
  });
  it('a deliberate leave is not a lost seat: the wipe is at once', () => {
    const game = party(1);
    game.tick();
    const a = game.guests[0]!;
    die(game.host); game.relay.flush(); game.tick(100);
    a.lobby.leave(); game.relay.flush();
    expect(game.host.lobby.players).toHaveLength(1);
    game.host.world.update();
    expect(game.host.world.team.ending).toBe('wipe');
    game.dispose();
  });
});

describe('a guest\'s words said once are said again when the host has dropped them', () => {
  const seatsOf = (game: ReturnType<typeof party>) => (game.host.world.team as unknown as { seats: Map<string, { kit: Kit | null }> }).seats;
  it('"I am down" while the line was down: the host still says up, so it is said again and the host makes it so', () => {
    const game = party(2);
    game.tick();
    const a = game.guests[0]!, id = a.lobby.you;
    game.relay.close(a.room); game.relay.flush();
    // Its own rocket, a crusher, lava: the guest reaches 0 behind a dead line, and the host drops the word.
    die(a); game.relay.flush();
    expect(a.player.downed).toBe(true);
    expect(game.host.world.team.life(id).state).toBe('up');
    game.relay.reopen(a.room); game.relay.flush();
    game.tick(); game.tick();
    expect(game.host.world.team.life(id).state).toBe('up');
    const before = game.relay.events('life').length;
    for (let i = 0; i < 5; i++) game.tick(300);
    expect(game.relay.events('life').length).toBeGreaterThan(before);
    expect(game.host.world.team.life(id).state).toBe('down');
    expect(feeds(game.host)).toContain('GUEST1 IS DOWN');
    // And once the host agrees, it is not said again.
    const said = game.relay.events('life').length;
    for (let i = 0; i < 6; i++) game.tick(300);
    expect(game.relay.events('life')).toHaveLength(said);
    // A teammate can now get them up, as anyone who is down.
    expect(a.player.downed).toBe(true);
    game.host.ctx.events.emit('wave:clear', { wave: 1, bonus: 0 }); game.relay.flush(); game.tick();
    expect(a.player.alive).toBe(true); expect(a.player.downed).toBe(false);
    game.dispose();
  });
  it('down on a life the host has already moved on from: the guest stands up, it never crawls for ever', () => {
    const game = party(1);
    game.tick();
    const a = game.guests[0]!, id = a.lobby.you;
    die(a); game.relay.flush(); game.tick(100);
    expect(game.host.world.team.life(id).state).toBe('down');
    // The host gets them up, and that word never reaches the guest.
    const life = game.host.world.team.life(id);
    life.respawn();
    for (let i = 0; i < 3; i++) game.tick(300);
    expect(a.player.downed).toBe(true);
    for (let i = 0; i < 8; i++) game.tick(300);
    expect(a.player.downed).toBe(false); expect(a.player.alive).toBe(true);
    expect(a.world.team.life(id).life).toBe(life.life);
    game.dispose();
  });
  it('a kit that changed while the line was down reaches the host when it is back, so a later reload gives back the newer one', () => {
    const game = party(1);
    game.tick();
    const a = game.guests[0]!;
    game.tick(KIT_MS + 100); game.tick();
    game.relay.close(a.room); game.relay.flush();
    a.weapons.owned.add('shotgun'); a.weapons.grenades = 5;
    // The guest sends it, on its own clock, to a host that has it marked away: dropped.
    game.tick(KIT_MS + 100); game.tick();
    const kept = () => [...seatsOf(game).values()].find(seat => seat.kit)?.kit;
    expect(kept()?.grenades).not.toBe(5);
    game.relay.reopen(a.room); game.relay.flush();
    game.tick(); game.tick();
    expect(kept()?.grenades).toBe(5);
    expect(kept()?.guns.map(g => g.weapon).sort()).toEqual(['shotgun', 'smg']);
    game.dispose();
  });

  it('a quick reload while downed does not grant a free revive, and an away respawn keeps checkpoint coordinates', () => {
    const game = party(1);
    game.tick();
    const a = game.guests[0]!;
    die(a); game.relay.flush(); game.tick();
    expect(game.host.world.team.life(a.lobby.you).state).toBe('down');
    // Immediately reload (new peer id, same browser) before the bleed timer finishes: must come back dead/bleeding, not up.
    const reloaded = game.rejoin(0, 'guest-1-fast');
    game.tick();
    expect(game.host.world.team.life(reloaded.lobby.you).state).not.toBe('up');
    expect(reloaded.player.alive).toBe(false);
    // Away player respawned at a checkpoint receives those exact coordinates upon returning.
    game.relay.close(reloaded.room); game.relay.flush();
    game.tick();
    game.host.world.team.respawnAll({ x: 42, y: 3, z: -18 }, 1.25);
    game.relay.reopen(reloaded.room); game.relay.flush();
    game.tick();
    expect(reloaded.player.alive).toBe(true);
    const call = reloaded.player.teleport.mock.calls.at(-1)!;
    expect(call[0].distanceTo(new THREE.Vector3(42, 3, -18))).toBeLessThan(2);
    expect(call[1]).toBeCloseTo(1.25, 2);
    game.dispose();
  });
});
