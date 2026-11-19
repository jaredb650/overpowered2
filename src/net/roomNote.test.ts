/**
 * The room a tab is in, kept in its sessionStorage so a reload on the lobby page walks back into it (session.ts
 * `rememberRoom`, `roomToRejoin`, `forgetRoom`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Lobby } from './lobby';

function storage() {
  const kept = new Map<string, string>();
  return { getItem: (k: string) => kept.get(k) ?? null, setItem: vi.fn((k: string, v: string) => { kept.set(k, v); }), removeItem: (k: string) => { kept.delete(k); }, kept };
}
const lobbyOf = (hosting: boolean, name: string, seats: [string, string][] = []) =>
  ({ hosting, me: { name }, seatRecords: () => ({ roster: [], seats }) }) as unknown as Lobby;

describe('the room a tab is in', () => {
  let store: ReturnType<typeof storage>;
  beforeEach(() => { store = storage(); vi.stubGlobal('sessionStorage', store); });
  afterEach(() => vi.unstubAllGlobals());

  it('is kept for a guest and for a host with its seats, read back whole, and forgotten on leaving', async () => {
    const { rememberRoom, roomToRejoin, forgetRoom } = await import('./session');
    expect(roomToRejoin()).toBeNull();
    rememberRoom('ABC234', 'secret', lobbyOf(false, 'VIPER-27'));
    expect(roomToRejoin()).toEqual({ code: 'ABC234', password: 'secret', name: 'VIPER-27', hosting: false });
    rememberRoom('ABC234', 'secret', lobbyOf(true, 'HOST', [['browser-a', 's1'], ['browser-b', 's2']]));
    expect(roomToRejoin()).toEqual({ code: 'ABC234', password: 'secret', name: 'HOST', hosting: true, seats: [['browser-a', 's1'], ['browser-b', 's2']] });
    forgetRoom();
    expect(roomToRejoin()).toBeNull();
  });
  it('is written only when it changes (the lobby calls it on every change)', async () => {
    const { rememberRoom } = await import('./session');
    const lobby = lobbyOf(true, 'HOST', [['browser-a', 's1']]);
    rememberRoom('ABC234', 'secret', lobby); rememberRoom('ABC234', 'secret', lobby); rememberRoom('ABC234', 'secret', lobby);
    expect(store.setItem).toHaveBeenCalledOnce();
  });
  it('a note that is not one is thrown away, and leaving the match alone keeps the room', async () => {
    const { roomToRejoin, rememberRoom, clearSession } = await import('./session');
    store.kept.set('op2_coop_room', JSON.stringify({ code: 'nope', password: 'x', name: 'A', hosting: true }));
    expect(roomToRejoin()).toBeNull();
    expect(store.kept.has('op2_coop_room')).toBe(false);
    store.kept.set('op2_coop_room', '{not json');
    expect(roomToRejoin()).toBeNull();
    // Back from a match to the lobby page: the match's handoff goes, the room stays.
    rememberRoom('ABC234', 'secret', lobbyOf(false, 'VIPER-27'));
    store.kept.set('op2_coop_match', '{}');
    clearSession();
    expect(store.kept.has('op2_coop_match')).toBe(false);
    expect(roomToRejoin()).toMatchObject({ code: 'ABC234' });
  });
});
