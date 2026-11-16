/**
 * The room over trystero's default strategy, Nostr: peers find each other through public Nostr relays, then talk
 * browser to browser over WebRTC. The password encrypts the handshake, so without it nobody can join or see who is in.
 *
 * TURN plugs in at `turnConfig` below: a list of { urls, username, credential }. Until it does, the browsers can only
 * use STUN, and a friend behind a strict router or a mobile network may never connect ('connect' error).
 * Plan: a free Cloudflare Worker that mints short-lived Cloudflare Realtime TURN credentials, fetched before joinRoom.
 */
import { joinRoom, type Room } from 'trystero';
import { MAX_PLAYERS } from './lobby';
import type { LobbyRooms, NetError, NetRoom } from './room';

export const APP_ID = 'overpowered-2-coop';

/** The lobby behind `password`, and its door behind the code (room.ts). */
export function openLobby(code: string, password: string): LobbyRooms {
  return { main: openRoom(code, password), door: () => openRoom(`${code}-door`, code) };
}

export function openRoom(code: string, password: string): NetRoom {
  const room: Room = joinRoom(
    // identity 'none': a fresh key per visit, nothing stored, and two tabs of one browser are two players.
    { appId: APP_ID, password, identity: 'none', maxUsers: MAX_PLAYERS /* , turnConfig: [...] */ },
    code,
  );
  return {
    channel<T>(name: string) {
      const action = room.makeAction<never>(name);
      return {
        send: (data: T, to?: string) => void action.send(data as never, to ? { target: to } : undefined).catch(() => {}),
        on: (handler: (data: T, from: string) => void) => void action.onMessage((data, context) => handler(data as T, context.peerId)),
      };
    },
    onPeerJoin: handler => void room.onPeerJoin(c => handler(c.peerId)),
    onPeerLeave: handler => void room.onPeerLeave(c => handler(c.peerId)),
    onError: handler =>
      void room.onError(e => {
        const map: Partial<Record<string, NetError>> = {
          'decrypt-failed': 'password',
          'peer-connect-failed': 'connect',
          'room-full': 'full',
        };
        const error = map[e.code];
        if (error) handler(error, 'peerId' in e ? e.peerId : undefined);
      }),
    leave: () => void room.leave().catch(() => {}),
  };
}
