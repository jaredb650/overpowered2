/**
 * The Commander with more than one player (co-op host): each of his mechanics is about the player it concerns, he learns
 * from every player, and nothing is multiplied by how many there are. Alone, the same code takes the path it always did.
 *
 * The real Commander on a stand-in Outpost and world: what he decides is read, nothing is drawn.
 */
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { Ctx, PlayerSystem } from '../../core/contracts';
import type { KillEvent } from '../../core/gameplay';
import { noop } from '../../core/stubs';
import { makeCtx } from '../../sandbox/harness';
import type { AiWorld } from '../aiWorld';
import { PlayerSense } from '../aiWorld';
import type { EnemyManager } from '../EnemyManager';
import type { Outpost } from '../outpost';
import type { CrowdLink, CrowdPlayer, JamState } from '../outpost/crowd';
import { defaultDoctrine } from '../outpost/doctrine';
import type { Soldier } from '../outpost/soldier';
import type { Briefing } from './events';
import { Commander } from './index';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function body(x: number, z: number): PlayerSystem {
  return { position: V(x, 0, z), eye: V(x, 1.6, z), velocity: V(0, 0, 0), forward: V(0, 0, -1), alive: true, grounded: true, health: 100, maxHealth: 100 } as unknown as PlayerSystem;
}

/** A Commander. `guests`: how many other players are in the world (0: alone, with no crowd at all). */
function make(guests = 0) {
  const host = body(0, 0);
  const others = Array.from({ length: guests }, (_, i) => body(60 + i * 20, 0));
  const ctx = makeCtx({ player: host }) as Ctx & Record<string, unknown>;
  Object.assign(ctx, {
    render: { scene: new THREE.Scene(), materials: { patch: (m: THREE.Material) => m, world: () => new THREE.MeshBasicMaterial() }, highlight: vi.fn(), lights: { flash: vi.fn() }, decals: { add: vi.fn() } },
    physics: { ...noop<object>('physics'), raycast: vi.fn(() => null), radialListeners: new Set() },
    world: { zoneAt: () => null, zones: [], nav: { nearest: (p: THREE.Vector3, _r: number, out: THREE.Vector3) => (out.copy(p), true) }, spawnPoints: [] },
    progression: { pickups: [] },
  });
  const sense = new PlayerSense();
  const point = (p: PlayerSystem): void => {
    sense.position.copy(p.position);
    sense.eye.copy(p.eye);
    sense.chest.copy(p.position).y += 1;
    sense.velocity.copy(p.velocity);
    sense.forward.copy(p.forward);
    sense.speed = Math.hypot(p.velocity.x, p.velocity.y * 0.5, p.velocity.z);
    sense.alive = p.alive;
  };
  point(host);
  const focused: (PlayerSystem | null)[] = [];
  let applying: CrowdPlayer | null = null;
  const jams: JamState[] = [];
  const players: CrowdPlayer[] = [{ id: 'host', slot: 0, player: host, own: true }, ...others.map((player, i) => ({ id: `guest-${i + 1}`, slot: i + 1, player, own: false }))];
  const crowd: CrowdLink | null = guests === 0 ? null : {
    players: () => players,
    applying: () => applying,
    bySlot: slot => players.find(p => p.slot === slot) ?? null,
    jam: state => void jams.push(state),
  };
  const laser = { acquireLaser: vi.fn(() => 1), releaseLaser: vi.fn(), aimLaser: vi.fn(), zone: vi.fn() };
  const w = { ctx, player: sense, now: 0, director: { clearLine: () => false }, telegraphs: laser, enemies: {} } as unknown as AiWorld;
  const soldiers: Soldier[] = [];
  const o = {
    crowd, soldiers, squads: [], doors: [], hostile: 1, doctrine: defaultDoctrine(), noise: vi.fn(), comms: { relay: vi.fn(), say: vi.fn() },
    waves: { phase: 'spawning', nextWaveIn: 0 }, cover: { spots: [] }, routes: { setClosed: vi.fn() },
    focus: (p: PlayerSystem | null) => { if (!crowd) return; focused.push(p); point(p ?? host); },
    playerDistance: (at: THREE.Vector3) => Math.min(...players.filter(p => p.player.alive).map(p => p.player.position.distanceTo(at))),
    seenByAny: () => false, quarryOf: () => null,
  } as unknown as Outpost;
  const c = new Commander(w, o, {} as EnemyManager);
  c.init();
  c.reset();
  const briefings: Briefing[] = [];
  ctx.events.on('commander:briefing', b => briefings.push(b));
  return { c, ctx, w, o, host, guests: others, players, sense, soldiers, focused, jams, briefings, as: (p: CrowdPlayer | null) => { applying = p; } };
}

const kill = (source = 'smg', distance = 10): KillEvent => ({
  enemy: { position: V(0, 0, 0), uid: 1 }, damage: { source }, headshot: false, distance,
} as unknown as KillEvent);

/** A man in the fight, a few metres from the player he is after. */
const man = (quarry: PlayerSystem | null, dist: number, extra: Partial<Soldier> = {}): Soldier => ({
  fighting: true, role: 'rifle', task: 'hold', hasOrder: false, sees: false, squad: { directed: false },
  e: { quarry, dist, alive: true, uid: 1, position: V(0, 0, 0), center: V(0, 1, 0) }, ...extra,
} as unknown as Soldier);

const watch = (c: Commander, now = 0): void => (c as unknown as { watch(now: number): void }).watch(now);

describe('alone: one player, one notebook, and nothing is pointed anywhere', () => {
  it('kills, cuts and a look at the player all go in the one notebook', () => {
    const g = make(0);
    g.ctx.events.emit('enemy:killed', kill());
    g.ctx.events.emit('enemy:severed', {} as never);
    g.host.position.set(4, 5, 4);
    g.sense.position.copy(g.host.position);
    watch(g.c);
    expect(g.c.tracker.round.kills).toBe(1);
    expect(g.c.tracker.round.limbs).toBe(1);
    expect(g.c.tracker.round.seconds).toBe(0.25);
    expect(g.c.tracker.round.highSeconds).toBe(0.25);
    expect(g.c.books.shared).toBe(false);
    expect(g.focused).toEqual([]);
  });

  it('the box quotes that notebook', () => {
    const g = make(0);
    for (let i = 0; i < 7; i++) g.c.tracker.shot('smg', 0, 0);
    g.c.intermission(1, 8);
    expect(g.briefings[0]!.report.shots).toBe(7);
  });
});

describe('co-op: he learns from every player, each in their own notebook', () => {
  it('a kill and a cut are their maker\'s: a guest\'s claim is applied as that guest', () => {
    const g = make(1);
    g.as(g.players[1]!);
    g.ctx.events.emit('enemy:killed', kill('shotgun', 3));
    g.ctx.events.emit('enemy:severed', {} as never);
    g.as(null);
    g.ctx.events.emit('enemy:killed', kill('smg', 30));
    const theirs = g.c.books.of('guest-1').round;
    expect([theirs.kills, theirs.limbs]).toEqual([1, 1]);
    expect([g.c.tracker.round.kills, g.c.tracker.round.limbs]).toEqual([1, 0]);
  });

  it('what a guest tells of itself lands in that guest\'s notebook: shots, sonar, pickups, hurt, a trap that caught them', () => {
    const g = make(2);
    const who = g.players[2]!;
    const note = (kind: string, n = 1, what = '') => g.c.learn(who, { kind: kind as never, n, what, at: V(80, 0, 0), left: 1 });
    note('shots', 12, 'rivet');
    note('ping');
    note('ping');
    note('pickup', 1, 'ammo');
    note('hurt', 30);
    g.c.trapped(who, 'mortar', 30);
    g.c.trapped(who, 'trooper', 10);
    const book = g.c.books.of('guest-2');
    expect(book.round).toMatchObject({ shots: 12, pings: 2, pickups: 1, damageTaken: 30 });
    const report = book.closeRound(1);
    expect(report.favouriteWeapon).toBe('rivet');
    expect(report.trapHits).toEqual([{ cause: 'mortar', hits: 1, damage: 30 }]);
    // Nobody else's notebook heard of it.
    expect(g.c.tracker.round.shots + g.c.books.of('guest-1').round.shots).toBe(0);
  });

  it('a teammate\'s call-in is counted against the teammate', () => {
    const g = make(1);
    g.ctx.events.emit('callin:teammate', { id: 'airstrike', slot: 1, position: V(0, 0, 0) });
    g.ctx.events.emit('callin:used', { id: 'airstrike', position: V(0, 0, 0) });
    expect(g.c.books.of('guest-1').round.callIns).toBe(1);
    expect(g.c.tracker.round.callIns).toBe(1);
  });

  it('one look at each living player, where they are: a guest on the catwalks is the one on high ground', () => {
    const g = make(2);
    g.guests[0]!.position.y = 6;
    (g.guests[1] as { alive: boolean }).alive = false;
    watch(g.c);
    expect(g.c.tracker.round.seconds).toBe(0.25);
    expect(g.c.tracker.round.highSeconds).toBe(0);
    expect(g.c.books.of('guest-1').round.highSeconds).toBe(0.25);
    // The dead are not watched.
    expect(g.c.books.of('guest-2').round.seconds).toBe(0);
  });

  it('a guest who camps brings the mortars, and the box quotes that guest\'s round', () => {
    const g = make(1);
    for (let i = 0; i < 480; i++) {
      g.host.position.set(Math.sin(i / 8) * 30, 0, Math.cos(i / 8) * 30);
      watch(g.c);
    }
    for (let i = 0; i < 40; i++) g.c.books.of('guest-1').shot('rivet', 60, 0);
    for (let i = 0; i < 9; i++) g.c.tracker.shot('smg', 0, 0);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    g.c.intermission(2, 8);
    vi.restoreAllMocks();
    expect(g.c.books.leader.get('camping')).toBe('guest-1');
    expect(g.briefings[0]!.adaptation).toBe('mortars');
    expect(g.briefings[0]!.report).toMatchObject({ shots: 40, favouriteWeapon: 'rivet' });
  });
});

describe('co-op: a mechanic is about the player it concerns, once', () => {
  const armed = (g: ReturnType<typeof make>) => {
    (g.c as unknown as { tricks: Set<string> }).tricks.add('dangerClose');
    const calls: THREE.Vector3[] = [];
    Object.assign(g.c, { mortars: { manned: true, busy: false, call: (at: THREE.Vector3) => (calls.push(at.clone()), true) } });
    return calls;
  };

  it('danger close: the shells go on the player the men are crowding, and it is one call', () => {
    const g = make(2);
    const calls = armed(g);
    // Two men on the host, four on the second guest.
    g.soldiers.push(man(g.host, 4), man(g.host, 5));
    for (let i = 0; i < 4; i++) g.soldiers.push(man(g.guests[1]!, 3 + i));
    watch(g.c);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.x).toBe(g.guests[1]!.position.x);
  });

  it('danger close alone: three men near the player, on the player, as ever', () => {
    const g = make(0);
    const calls = armed(g);
    for (let i = 0; i < 3; i++) g.soldiers.push(man(null, 4));
    watch(g.c);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.x).toBe(0);
  });

  it('men are not counted twice: two near each of two players is nobody\'s danger close', () => {
    const g = make(1);
    const calls = armed(g);
    g.soldiers.push(man(g.host, 4), man(g.host, 5), man(g.guests[0]!, 4), man(g.guests[0]!, 5));
    watch(g.c);
    expect(calls).toHaveLength(0);
  });

  it('the spotter paints the player he can see: a guest in his sights is the one shelled, not the host', () => {
    const g = make(1);
    const guest = g.guests[0]!;
    const spotter = { kind: 'spotter', s: man(guest, 30, { sees: true } as Partial<Soldier>) };
    const crew = { kind: 'mortar', s: man(g.host, 40) };
    (g.c.units as unknown as { list: unknown[] }).list.push(spotter, crew);
    Object.assign(g.c.units, { eyeOf: (_u: unknown, out: THREE.Vector3) => out.set(30, 2, 30) });
    const mortars = g.c.mortars as unknown as { tube: object | null; target: THREE.Vector3; stage: string; update(dt: number): void };
    mortars.tube = {};
    // The lock runs for 1.9 s on the man in his sights.
    for (let t = 0; t < 2.2; t += 0.1) {
      (g.w as { now: number }).now = t;
      mortars.update(0.1);
    }
    expect(mortars.stage).not.toBe('idle');
    expect(mortars.target.x).toBe(guest.position.x);
    expect(g.focused).toContain(guest);
    // And the host's own player is "the player" again when he is done.
    expect(g.focused.at(-1)).toBeNull();
    expect(g.sense.position.x).toBe(0);
  });

  it('keeping their distance: a man backs away from the player he is too close to', () => {
    const g = make(1);
    g.c.adopt('shotguns');
    const order = vi.fn();
    Object.assign(g.o, { order });
    const guest = g.guests[0]!;
    const s = man(guest, 3);
    s.e.position.set(guest.position.x + 3, 0, 0);
    g.soldiers.push(s);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    watch(g.c);
    vi.restoreAllMocks();
    // Away from the guest at x = 60, so further along +x: not toward the host at the origin.
    expect(order).toHaveBeenCalledTimes(1);
    expect((order.mock.calls[0]![1] as THREE.Vector3).x).toBeGreaterThan(s.e.position.x + 5);
  });
});

describe('pressing through his briefing', () => {
  it('alone it shortens the break to three seconds, as ever', () => {
    const g = make(0);
    Object.assign(g.o.waves, { phase: 'intermission', nextWaveIn: 12 });
    g.ctx.events.emit('commander:skipped', {});
    expect(g.o.waves.nextWaveIn).toBe(3);
  });

  it('in co-op it is that player\'s ready vote, and the break is not shortened by it', () => {
    const g = make(1);
    const readyUp = vi.fn();
    (g.ctx as { coop: unknown }).coop = { hosting: true, world: { team: { rest: { readyUp } } } };
    Object.assign(g.o.waves, { phase: 'intermission', nextWaveIn: 40 });
    g.ctx.events.emit('commander:skipped', {});
    expect(readyUp).toHaveBeenCalledTimes(1);
    expect(g.o.waves.nextWaveIn).toBe(40);
  });
});
