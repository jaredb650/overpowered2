/**
 * The room over trystero's default strategy, Nostr: peers find each other through public Nostr relays, then talk
 * browser to browser over WebRTC. The password encrypts the handshake, so without it nobody can join or see who is in.
 *
 * Relays: 8 of trystero's public list (it picks the same 8 for everyone from the app id, so all players share them).
 * Any one of them answering is enough; when none does, the lobby says so ('relays') instead of waiting.
 *
 * TURN: `fetchTurn` (turn.ts) asks the owner's Worker for short-lived relay credentials before joining. Without it the
 * browsers have STUN only, and a friend behind a strict router or mobile data gets the 'connect' error.
 */
import { getRelaySockets, joinRoom, type Room } from 'trystero';
import { MAX_PLAYERS } from './lobby';
import type { LobbyRooms, NetError, NetRoom } from './room';
import { fetchTurn, type IceServer } from './turn';

export const APP_ID = 'overpowered-2-coop';
export const RELAY_REDUNDANCY = 8;

/** The lobby behind `password`, and its door behind the code (room.ts). Fetches TURN first (at most TURN_TIMEOUT_MS). */
export async function openLobby(code: string, password: string): Promise<LobbyRooms> {
  const turn = await fetchTurn();
  return { main: openRoom(code, password, turn), door: () => openRoom(`${code}-door`, code, turn) };
}

/** ICE candidate kinds: host (LAN), srflx (public address via STUN), relay (TURN). */
const kinds = (types: string[]): string => ['host', 'srflx', 'prflx', 'relay'].map(t => `${t} ${types.filter(x => x === t).length}`).join(', ');

/**
 * trystero's peer connections, watched: how many have met a peer (an offer or answer came back) and are still connecting,
 * and, when one connects or fails, which candidate kinds each side had. No srflx means STUN failed; srflx on both sides and
 * still failed means a NAT that needs TURN.
 */
function watchedPeers(): { Peer: typeof RTCPeerConnection; trying(): number } {
  const met = new Set<RTCPeerConnection>();
  class Peer extends RTCPeerConnection {
    constructor(config?: RTCConfiguration) {
      super(config);
      this.addEventListener('signalingstatechange', () => void (this.remoteDescription && met.add(this)));
      this.addEventListener('iceconnectionstatechange', () => {
        const state = this.iceConnectionState;
        if (state !== 'connected' && state !== 'failed') return;
        this.getStats().then(stats => {
          const ours: string[] = [], theirs: string[] = [];
          stats.forEach(stat => {
            if (stat.type === 'local-candidate') ours.push(stat.candidateType);
            else if (stat.type === 'remote-candidate') theirs.push(stat.candidateType);
          });
          (state === 'failed' ? console.warn : console.info)(`[coop] Peer connection ${state}. Our candidates: ${kinds(ours)}. Theirs: ${kinds(theirs)}.`);
        }).catch(() => {});
      });
    }
  }
  const trying = (): number => {
    for (const pc of met) if (pc.connectionState !== 'new' && pc.connectionState !== 'connecting') met.delete(pc);
    return met.size;
  };
  return { Peer, trying };
}

export function openRoom(code: string, password: string, turn: IceServer[] = []): NetRoom {
  const peers = watchedPeers();
  const room: Room = joinRoom(
    // identity 'none': a fresh key per visit, nothing stored, and two tabs of one browser are two players.
    { appId: APP_ID, password, identity: 'none', maxUsers: MAX_PLAYERS, relayConfig: { redundancy: RELAY_REDUNDANCY },
      rtcPolyfill: peers.Peer, ...(turn.length ? { turnConfig: turn } : {}) },
    code,
  );
  return {
    channel<T>(name: string) {
      const action = room.makeAction<never>(name);
      return {
        send: (data: T, to?: string) => void action.send(data as never, to ? { target: to } : undefined).catch(() => {}),
        on: (handler: (data: T, from: string) => void) => void action.onMessage((data, context) => {
          // A peer's malformed message must never take the game down with it.
          try { handler(data as T, context.peerId); } catch (error) { console.warn('[coop] Dropped a message that could not be read', error); }
        }),
      };
    },
    onPeerJoin: handler => void room.onPeerJoin(c => handler(c.peerId)),
    onPeerLeave: handler => void room.onPeerLeave(c => handler(c.peerId)),
    onError: handler =>
      void room.onError(e => {
        const map: Partial<Record<string, NetError>> = {
          'decrypt-failed': 'password',
          'peer-connect-failed': 'connect',
          'handshake-failed': 'connect',
          'room-full': 'full',
          'relay-failed': 'relays',
        };
        const error = map[e.code];
        if (error) handler(error, 'peerId' in e ? e.peerId : undefined);
      }),
    leave: () => void room.leave().catch(() => {}),
    status: () => ({ relays: Object.values(getRelaySockets()).some(socket => socket.readyState === WebSocket.OPEN), trying: peers.trying() }),
  };
}
