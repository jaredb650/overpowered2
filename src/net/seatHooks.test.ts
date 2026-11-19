/**
 * The session's seat hooks as the co-op world acts on them (world.ts): what a player whose connection drops lets go of in the
 * world, what is forgotten when a connection is gone for good, and an arrival that comes before the host's own world is up.
 */
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerSystem } from '../core/contracts';
import { party } from './world/testkit';

beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] }));
afterEach(() => vi.useRealTimers());

/** A host's game with the parts a lost player can hold something in: the fort's guns, the prisoners. */
function hostExtras() {
  const defense = { leftSeats: vi.fn() };
  const captives = { dropFor: vi.fn(() => true), heldBy: vi.fn(() => null) };
  return { defense, captives };
}

describe('a lost player lets go of what they held in the world', () => {
  it('their slow-mo ends, their Ghost is over, their mounted gun is free and the man in their hands is dropped', () => {
    const { defense, captives } = hostExtras();
    const time = { dt: 0.016, realDt: 0.016, frame: 0, elapsed: 0, share: vi.fn(), unshare: vi.fn() };
    const game = party(2, [{ time }]);
    (game.host.manager as unknown as { outpost: unknown }).outpost = { captives };
    const [a, b] = game.guestLobbies as [typeof game.guestLobbies[0], typeof game.guestLobbies[0]];
    const id = a.you, slot = a.me!.slot;
    game.step();
    // The guest has a Time Warp running and the Ghost power-up on, and the host has seen their body.
    (game.guests[0]!.ctx.time as unknown as { gate: { push(id: string, scale: number, i: number, o: number): void } }).gate.push('timeWarp', 0.4, 0.2, 0.4);
    game.sendFrom(0, { t: 'ghost', on: true });
    game.relay.flush(); game.hw.clock(); game.step();
    expect(game.hw.slows.map(e => e.slot)).toEqual([slot]);
    const targeting = (game.hw as unknown as { targeting: { ghosts: Set<string>; standIn(id: string): PlayerSystem | null; players(): unknown[] } }).targeting;
    targeting.players();
    expect(targeting.ghosts.has(id)).toBe(true);
    const standIn = targeting.standIn(id);
    expect(standIn).not.toBeNull();
    // The fort is found by the world on first use: here it is handed in.
    (game.hw as unknown as { fort: { defense: unknown } }).fort.defense = defense;
    game.relay.close(game.rooms[0]!); game.relay.flush();
    expect(game.hostLobby.players.find(p => p.id === id)).toMatchObject({ state: 'lost', away: true });
    game.hw.clock();
    expect(game.hw.slows).toEqual([]);
    expect(targeting.ghosts.has(id)).toBe(false);
    expect(defense.leftSeats).toHaveBeenCalledExactlyOnceWith(slot);
    expect(captives.dropFor).toHaveBeenCalledExactlyOnceWith(standIn);
    // The other guest, still here, lost nothing.
    expect(game.hostLobby.players.find(p => p.id === b.you)?.away).toBeFalsy();
    game.dispose();
  });
  it('their call-in copies and their Frame\'s puppet go on every screen, at once, and not the copies of those still here', () => {
    const drops: number[][] = [[], []];
    const link = (i: number) => ({ send: null, order: vi.fn(), news: vi.fn(), mech: vi.fn(), mechNews: vi.fn(), drop: vi.fn((slot: number) => { drops[i]!.push(slot); }),
      has: () => false, inFrame: () => false, shootDown: () => false });
    const progression = (i: number) => ({ kills: 0, score: 0, headshots: 0, resume: vi.fn(), callinLink: link(i) });
    const game = party(2, [{ progression: progression(0) }, undefined, { progression: progression(1) }]);
    const lost = game.guestLobbies[0]!;
    game.step(); game.step();
    game.relay.close(game.rooms[0]!); game.relay.flush();
    game.step();
    // The host and the guest who stayed both drop the lost player's things; nobody drops anyone else's.
    expect(drops[0]).toEqual([lost.me!.slot]);
    expect(drops[1]).toEqual([lost.me!.slot]);
    game.dispose();
  });
});

describe('a connection that is gone for good is forgotten', () => {
  it('the same seat on a new page, or a seat given up, takes everything kept by the old connection id with it', () => {
    const game = party(1);
    const id = game.guestLobbies[0]!.you;
    game.step();
    const parts = game.hw as unknown as {
      shots: { kits: Map<string, unknown>; side: Map<string, unknown> }; booms: { relayed: Map<string, unknown> };
      calls: { rates: Map<string, unknown> }; fort: { spent: Map<string, unknown> }; props: { spent: Map<string, unknown> };
      capture: { spent: Map<string, unknown> }; targeting: { adapters: Map<string, unknown>; players(): unknown[] };
    };
    const maps = [parts.shots.kits, parts.shots.side, parts.booms.relayed, parts.calls.rates, parts.fort.spent, parts.props.spent, parts.capture.spent];
    for (const map of maps) map.set(id, {});
    parts.targeting.players();
    expect(parts.targeting.adapters.has(id)).toBe(true);
    game.seats.onForget.emit(id);
    for (const map of maps) expect(map.has(id)).toBe(false);
    expect(parts.targeting.adapters.has(id)).toBe(false);
    game.dispose();
  });
});

describe('an arrival the session says before the host\'s own world is up', () => {
  it('is kept, and caught up the moment the host\'s world begins', () => {
    const game = party(1);
    const id = game.guestLobbies[0]!.you;
    const w = (game.hw as unknown as { w: { ready: boolean } }).w;
    const before = game.relay.sent('sync').length;
    w.ready = false;
    game.seats.onArrived.emit(id, { seat: 's1', slot: 1, name: 'GUEST1', rejoin: true, same: true });
    expect(game.relay.sent('sync')).toHaveLength(before);
    game.hw.begin();
    expect(game.relay.sent('sync')).toHaveLength(before + 1);
    expect(game.relay.sent<{ t: string; back?: boolean }>('sync').at(-1)).toMatchObject({ back: true });
    game.dispose();
  });
});

void THREE;

describe('a guest says again what the host may not have heard', () => {
  it('Ghost switched on behind a dead line is in force on the host once the guest is back, and off again when it ends', () => {
    let ghost = false;
    const progression = { kills: 0, score: 0, headshots: 0, resume: vi.fn(), isActive: (id: string) => id === 'ghost' && ghost };
    const game = party(1, [undefined, { progression }]);
    const id = game.guestLobbies[0]!.you;
    const ghosts = (game.hw as unknown as { targeting: { ghosts: Set<string> } }).targeting.ghosts;
    game.step();
    game.relay.close(game.rooms[0]!); game.relay.flush();
    ghost = true;
    game.step(); game.step();
    expect(ghosts.has(id)).toBe(false);
    game.relay.reopen(game.rooms[0]!); game.relay.flush(); game.step(); game.step();
    expect(ghosts.has(id)).toBe(true);
    // The other way: it ends behind a dead line. The host forgot it when the line dropped, and hears "off" again anyway.
    game.relay.close(game.rooms[0]!); game.relay.flush();
    expect(ghosts.has(id)).toBe(false);
    ghost = false;
    game.step();
    game.relay.reopen(game.rooms[0]!); game.relay.flush(); game.step(); game.step();
    expect(ghosts.has(id)).toBe(false);
    expect(game.relay.sent<{ t: string; on: boolean }>('ghost').at(-1)).toMatchObject({ on: false });
    game.dispose();
  });
  it('the gun in hand, changed behind a dead line, is told again', () => {
    const game = party(1);
    const guest = game.guests[0]!;
    game.step(); game.step();
    game.relay.close(game.rooms[0]!); game.relay.flush();
    (guest.ctx.weapons as unknown as { current: string }).current = 'shotgun';
    for (let i = 0; i < 40; i++) game.step();
    const kits = (game.hw as unknown as { shots: { kits: Map<string, { weapon: string }> } }).shots.kits;
    expect(kits.get(game.guestLobbies[0]!.you)?.weapon).not.toBe('shotgun');
    game.relay.reopen(game.rooms[0]!); game.relay.flush();
    for (let i = 0; i < 40; i++) game.step();
    expect(kits.get(game.guestLobbies[0]!.you)?.weapon).toBe('shotgun');
    game.dispose();
  });
});
