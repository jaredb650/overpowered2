/**
 * Every player, for the host's soldiers and their Commander (world/crowd.ts): the host hands the Outpost its crowd, a guest's
 * notes of itself reach it checked, and the jammer's word reaches every guest.
 */
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CrowdLink, CrowdPlayer, JamState, Note } from '../../enemies/outpost/crowd';
import { party } from './sharedkit';

interface Heard { who: string; kind: string; n: number; what: string; x: number; left: number }

function game(guests = 2) {
  const g = party(guests);
  const sides = [g.host, ...g.guests].map(seat => {
    const heard: Heard[] = [];
    const trapped: { who: string; cause: string; amount: number }[] = [];
    const jams: JamState[] = [];
    const outpost = {
      crowd: null as CrowdLink | null,
      told: (who: CrowdPlayer, note: Note) => void heard.push({ who: who.id, kind: note.kind, n: note.n, what: note.what, x: note.at.x, left: note.left }),
      commander: { trapped: (who: CrowdPlayer, cause: string, amount: number) => void trapped.push({ who: who.id, cause, amount }), jam: { tell: (state: JamState) => void jams.push(state) } },
    };
    (seat.ctx.enemies as unknown as { outpost: unknown }).outpost = outpost;
    // What the team's own bookkeeping reads of a game as time passes (net/kit.ts, the wave banner).
    Object.assign(seat.ctx.weapons, { ammo: () => ({ mag: 0, reserve: 0 }), setLoadout: vi.fn() });
    Object.assign(seat.ctx.hud, { banner: vi.fn() });
    Object.assign(seat.ctx.contracts, { sonar: { share: vi.fn(), live: 0 } });
    return { ...seat, seat, outpost, heard, trapped, jams };
  });
  g.build();
  /** A frame a third of a second on, so what a guest has gathered goes out. */
  const step = () => { vi.advanceTimersByTime(340); g.step(); };
  step();
  return { ...g, sides, host: sides[0]!, guests: sides.slice(1), step };
}

describe('every player, for the enemy side', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] }));
  afterEach(() => vi.useRealTimers());

  it('the host\'s Outpost is handed every player in the world, its own first; a guest\'s is handed nothing', () => {
    const g = game(2);
    const crowd = g.host.outpost.crowd!;
    expect(crowd).not.toBeNull();
    const players = crowd.players();
    expect(players.map(p => p.own)).toEqual([true, false, false]);
    expect(players[0]!.player).toBe(g.host.ctx.player);
    expect(players.slice(1).map(p => p.id).sort()).toEqual(g.guests.map(s => s.lobby.you).sort());
    expect(crowd.bySlot(players[1]!.slot)).toBe(players[1]);
    expect(crowd.applying()).toBeNull();
    for (const guest of g.guests) expect(guest.outpost.crowd).toBeNull();
    g.dispose();
    expect(g.host.outpost.crowd).toBeNull();
  });

  it('a guest\'s shots are gathered and told as one note, with the weapon and the place', () => {
    const g = game(1);
    const guest = g.guests[0]!;
    guest.player.position.set(20, 0, 5);
    for (let i = 0; i < 7; i++) guest.ctx.events.emit('weapon:fired', { weapon: 'rivet', origin: new THREE.Vector3(20, 1.5, 5), dir: new THREE.Vector3(0, 0, -1) } as never);
    g.step();
    expect(g.host.heard).toEqual([{ who: guest.lobby.you, kind: 'shots', n: 7, what: 'rivet', x: 20, left: 1 }]);
    // Nothing more until it fires again.
    g.step();
    expect(g.host.heard).toHaveLength(1);
    expect(g.relay.sent('note')).toHaveLength(1);
  });

  it('a landing, a slam, a pickup, a sonar ping, a reload and being hurt are each told', () => {
    const g = game(1);
    const guest = g.guests[0]!;
    const at = new THREE.Vector3(3, 0, 3);
    guest.player.position.copy(at);
    (guest.ctx.player as unknown as { health: number }).health = 20;
    guest.ctx.events.emit('player:landed', { impact: 9 });
    guest.ctx.events.emit('player:slam', { impact: 1, position: at, radius: 5 });
    guest.ctx.events.emit('pickup:collected', { kind: 'ammo', position: at } as never);
    guest.ctx.events.emit('sonar:ping', { origin: at });
    guest.ctx.events.emit('weapon:reload', { weapon: 'smg', phase: 'start' });
    guest.ctx.events.emit('weapon:reload', { weapon: 'smg', phase: 'end' });
    guest.ctx.events.emit('player:damaged', { amount: 30, type: 'bullet' });
    guest.ctx.events.emit('player:damaged', { amount: 15, type: 'bullet' });
    g.step();
    expect(g.host.heard.map(h => h.kind).sort()).toEqual(['hurt', 'land', 'pickup', 'ping', 'reload', 'slam']);
    expect(g.host.heard.find(h => h.kind === 'land')!.n).toBe(9);
    expect(g.host.heard.find(h => h.kind === 'slam')!.n).toBe(5);
    expect(g.host.heard.find(h => h.kind === 'pickup')!.what).toBe('ammo');
    // Two hits in one gathering are one note: the damage, and what is left of the guest's health.
    expect(g.host.heard.find(h => h.kind === 'hurt')).toMatchObject({ n: 45, left: 0.2 });
  });

  it('a guest blinded by a flashbang says so, and the host hands it to the enemy side as that guest\'s', () => {
    const g = game(2);
    const blind = g.guests[1]!;
    blind.player.position.set(4, 0, 2);
    // The bang goes off on that guest's screen and its own eyes are caught (warnings.ts): the note is the world's to send.
    (blind.seat.world as unknown as { crowd: { blinded(): void } }).crowd.blinded();
    g.step();
    expect(g.host.heard).toEqual([expect.objectContaining({ who: blind.lobby.you, kind: 'blind' })]);
    // The host's own eyes are its own Outpost's business: nothing is sent.
    (g.host.seat.world as unknown as { crowd: { blinded(): void } }).crowd.blinded();
    g.step();
    expect(g.relay.sent('note')).toHaveLength(1);
  });

  it('the host\'s own doings are not notes: it hears itself by its own events', () => {
    const g = game(1);
    g.host.ctx.events.emit('weapon:fired', { weapon: 'smg', origin: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, -1) } as never);
    g.host.ctx.events.emit('sonar:ping', { origin: new THREE.Vector3() });
    g.step();
    expect(g.relay.sent('note')).toHaveLength(0);
    expect(g.host.heard).toHaveLength(0);
  });

  it('a note from somewhere the guest is not, from a downed guest, or in a flood is dropped', () => {
    const g = game(1);
    const guest = g.guests[0]!;
    guest.ctx.events.emit('pickup:collected', { kind: 'ammo', position: new THREE.Vector3(300, 0, 0) } as never);
    g.step();
    expect(g.host.heard).toHaveLength(0);
    for (let i = 0; i < 40; i++) guest.ctx.events.emit('sonar:ping', { origin: guest.player.position });
    g.relay.flush();
    expect(g.host.heard.length).toBeGreaterThan(0);
    expect(g.host.heard.length).toBeLessThanOrEqual(14);
    const before = g.host.heard.length;
    vi.advanceTimersByTime(1100);
    g.host.seat.world.team.life(guest.lobby.you).fall(performance.now());
    guest.ctx.events.emit('sonar:ping', { origin: guest.player.position });
    g.relay.flush();
    expect(g.host.heard).toHaveLength(before);
  });

  it('what hurt a guest is told to the Commander with whom it caught', () => {
    const g = game(2);
    const guest = g.guests[1]!;
    g.host.ctx.events.emit('coop:hurt', { id: guest.lobby.you, amount: 60, source: 'mortar' });
    expect(g.host.trapped).toEqual([{ who: guest.lobby.you, cause: 'mortar', amount: 60 }]);
  });

  it('the jammer\'s word reaches every guest, and nothing malformed is passed on', () => {
    const g = game(2);
    g.host.outpost.crowd!.jam({ on: true, ops: [3], cold: [7, 8], floor: [4] });
    g.relay.flush();
    for (const guest of g.guests) expect(guest.jams).toEqual([{ on: true, ops: [3], cold: [7, 8], floor: [4] }]);
    expect(g.host.jams).toHaveLength(0);
    (g.host.seat.world as unknown as { w: { send(event: unknown): void } }).w.send({ t: 'jam', on: true, ops: ['x'], cold: [], floor: [] });
    g.relay.flush();
    for (const guest of g.guests) expect(guest.jams).toHaveLength(1);
    // Late joiner catchUp replays the active jam state only to that guest.
    const late = g.guests[1]!;
    late.jams.length = 0;
    (g.host.seat.world as unknown as { crowd: { catchUp(id: string): void } }).crowd.catchUp(late.lobby.you);
    g.relay.flush();
    expect(late.jams).toEqual([{ on: true, ops: [3], cold: [7, 8], floor: [4] }]);
    expect(g.guests[0]!.jams).toHaveLength(1);
  });
});
