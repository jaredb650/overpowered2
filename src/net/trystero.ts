import { report } from '../core/report';
/**
 * The room over trystero's default strategy, Nostr: peers find each other through public Nostr relays, then talk
 * browser to browser over WebRTC. The password encrypts the handshake, so without it nobody can join or see who is in.
 *
 * Relays: 8 of trystero's public list (it picks the same 8 for everyone from the app id, so all players share them).
 * Any one of them answering is enough; when none does, the lobby says so ('relays') instead of waiting.
 *
 * TURN: `fetchTurn` (turn.ts) asks the owner's Worker for short-lived relay credentials before joining. Without it the
 * browsers have STUN only, and a friend behind a strict router or mobile data gets the 'connect' error.
 *
 * Two paths per peer. trystero's actions are the reliable, ordered one (its single data channel). The unreliable one is
 * a second data channel this file opens on each connected peer connection (fast.ts); the lane layer (lanes.ts) picks
 * the path per message and falls back to the reliable one whenever the fast link is not up.
 *
 * `openLobby` is the one way in for the game: it hands out the loopback transport instead when the page asks for it
 * (`?net=loop`, tests only; loopback.ts).
 */
import { getRelaySockets, joinRoom, type Room } from 'trystero';
import { TRANSPORT_MAX_USERS } from './lobby';
import type { LobbyRooms, NetError, NetRoom } from './room';
import { fetchTurn, type IceServer } from './turn';
import { addCandidate, noKinds, type IceKinds, type IceReport } from './ice';
import { FAST_CHANNEL_INIT, FAST_CHANNEL_LABEL, FastLink, type FastChannel } from './fast';
import { LaneRoom, type Wire } from './lanes';
import { LOOPBACK } from './mode';
import { pageSim } from './netsim';
import { publishNet, watchNet } from './debug';

export const APP_ID = 'overpowered-2-coop';
export const RELAY_REDUNDANCY = 8;

/** The lobby behind `password`, and its door behind the code (room.ts). Fetches TURN first (at most TURN_TIMEOUT_MS). */
export async function openLobby(code: string, password: string): Promise<LobbyRooms> {
  publishNet();
  let rooms: LobbyRooms;
  if (LOOPBACK) rooms = (await import('./loopback')).openLoopLobby(code, password);
  else {
    const turn = await fetchTurn();
    rooms = { main: openRoom(code, password, turn, true), door: () => openRoom(`${code}-door`, code, turn) };
  }
  watchNet(rooms.main);
  return rooms;
}

const kinds = (k: IceKinds): string => `host ${k.host} (${k.mdns} as .local), srflx ${k.srflx}, relay ${k.relay}`;

/**
 * trystero's peer connections, watched: how many have met a peer (an offer or answer came back) and are still connecting,
 * and the candidates each side offered: ours as we gather them, theirs as the handshake hands them to addIceCandidate.
 * `ice()` is the latest connection that got candidates from a peer and never connected: the one an error is about.
 * Each connection that connects also gets its unreliable link (fast.ts), whose frames go to `onFast`.
 */
interface WatchedPeer extends RTCPeerConnection {
  /** The unreliable link, made once the connection is up; null while there is none, or if it could not be made. */
  fast: FastLink | null;
  /** trystero's own channel, for its queue length. */
  data: RTCDataChannel | null;
}

function watchedPeers(onFast: (frame: Uint8Array, peer: WatchedPeer) => void): { Peer: typeof RTCPeerConnection; trying(): number; ice(): IceReport | undefined } {
  const met = new Set<RTCPeerConnection>();
  let latest: (IceReport & { connected: boolean }) | undefined;
  class Peer extends RTCPeerConnection implements WatchedPeer {
    report = { ours: noKinds(), theirs: noKinds(), connected: false };
    fast: FastLink | null = null;
    data: RTCDataChannel | null = null;
    constructor(config?: RTCConfiguration) {
      super(config);
      this.addEventListener('signalingstatechange', () => {
        if (this.remoteDescription && !met.has(this)) { met.add(this); report('COOP_STAGE', { stage: 'peer-ice' }); }
      });
      this.addEventListener('icecandidate', e => addCandidate(this.report.ours, e.candidate?.candidate));
      this.addEventListener('iceconnectionstatechange', () => {
        const state = this.iceConnectionState;
        if (state === 'connected' || state === 'completed') this.report.connected = true;
        if (state !== 'connected' && state !== 'failed') return;
        (state === 'failed' ? console.warn : console.info)(`[coop] Peer connection ${state}. Our candidates: ${kinds(this.report.ours)}. Theirs: ${kinds(this.report.theirs)}.`);
      });
      this.addEventListener('datachannel', e => { this.data = e.channel; });
      // Only once connected: by then the data section is agreed, so the new channel asks for no renegotiation (which
      // trystero's answering side would turn into an offer of its own).
      this.addEventListener('connectionstatechange', () => {
        if (this.connectionState === 'connected') this.openFast();
        else if (this.connectionState === 'closed' || this.connectionState === 'failed') this.fast?.close();
      });
    }
    private openFast(): void {
      if (this.fast) return;
      try {
        const channel = super.createDataChannel(FAST_CHANNEL_LABEL, FAST_CHANNEL_INIT);
        this.fast = new FastLink(channel as unknown as FastChannel, frame => onFast(frame, this));
      } catch (error) {
        // No fast link: every lane stays on the reliable path, as before it existed.
        console.info('[coop] No unreliable channel on this connection; using the reliable one.', error);
      }
    }
    override createDataChannel(label: string, init?: RTCDataChannelInit): RTCDataChannel {
      const channel = super.createDataChannel(label, init);
      if (label !== FAST_CHANNEL_LABEL) this.data = channel;
      return channel;
    }
    // shortcut: candidates inside the SDP itself are not counted; trystero trickles them all, so none are there.
    override addIceCandidate(candidate?: RTCIceCandidateInit | null): Promise<void> {
      addCandidate(this.report.theirs, candidate?.candidate);
      if (!this.report.connected) latest = this.report;
      return super.addIceCandidate(candidate ?? undefined);
    }
  }
  const trying = (): number => {
    for (const pc of met) if (pc.connectionState !== 'new' && pc.connectionState !== 'connecting') met.delete(pc);
    return met.size;
  };
  return { Peer, trying, ice: () => (latest && !latest.connected ? latest : undefined) };
}

export function openRoom(code: string, password: string, turn: IceServer[] = [], main = false): NetRoom {
  let fastHandler: (frame: Uint8Array, from: string) => void = () => {};
  /** Which peer id a connection belongs to, and back: trystero knows (`getPeers`), asked again whenever a lookup misses. */
  const idOf = new WeakMap<RTCPeerConnection, string>();
  const peerOf = new Map<string, WatchedPeer>();
  let scanned = 0;
  const scan = (): void => {
    scanned = performance.now();
    peerOf.clear();
    for (const [id, info] of Object.entries(room.getPeers())) {
      const connection = info.connection as WatchedPeer | null;
      if (!connection) continue;
      peerOf.set(id, connection);
      idOf.set(connection, id);
    }
  };
  const peer = (id: string): WatchedPeer | undefined => {
    let found = peerOf.get(id);
    if ((!found || found.connectionState === 'closed') && performance.now() - scanned > 250) {
      scan();
      found = peerOf.get(id);
    }
    return found;
  };
  const peers = watchedPeers((frame, connection) => {
    // Only from a peer trystero has let into the room.
    if (!idOf.has(connection) && performance.now() - scanned > 250) scan();
    const from = idOf.get(connection);
    if (from) fastHandler(frame, from);
  });
  const room: Room = joinRoom(
    // identity 'none': a fresh key per visit, nothing stored, and two browser profiles (or a private window) are two players. One browser runs one tab (core/oneTab.ts).
    { appId: APP_ID, password, identity: 'none', maxUsers: TRANSPORT_MAX_USERS, relayConfig: { redundancy: RELAY_REDUNDANCY },
      rtcPolyfill: peers.Peer, ...(turn.length ? { turnConfig: turn } : {}) },
    code,
  );
  const wire: Wire = {
    reliable(name) {
      const action = room.makeAction<never>(name);
      return {
        send: (data, to) => void action.send(data as never, to ? { target: to } : undefined).catch(() => {}),
        on: handler => void action.onMessage((data, context) => handler(data, context.peerId)),
      };
    },
    fastSend: (to, frame) => peer(to)?.fast?.send(frame) ?? false,
    fastUp: id => peer(id)?.fast?.up ?? false,
    onFast: handler => { fastHandler = handler; },
    buffered: (id, unreliable) => (unreliable ? peer(id)?.fast?.buffered : peer(id)?.data?.bufferedAmount) ?? 0,
    onPeerJoin: handler => void room.onPeerJoin(c => { scan(); handler(c.peerId); }),
    onPeerLeave: handler => void room.onPeerLeave(c => { peerOf.delete(c.peerId); handler(c.peerId); }),
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
    status: () => ({ relays: Object.values(getRelaySockets()).some(socket => socket.readyState === WebSocket.OPEN), trying: peers.trying(), ice: peers.ice() }),
  };
  // The door carries one word, once: nothing to count there, and no pings.
  return new LaneRoom(wire, { sim: pageSim(), ping: main, metrics: main ? undefined : null });
}
