/**
 * The one seam between the game and the network. Two transports sit behind it: `trystero.ts` (real WebRTC, what players
 * get) and `loopback.ts` (pages of one browser, for tests; `?net=loop`). Both are a small `Wire` under the shared
 * `LaneRoom` (lanes.ts), which adds the two lane kinds, the network simulator (netsim.ts) and the counters (metrics.ts).
 * Tests of the lobby pass a fake `NetRoom`.
 */
import type { IceReport } from './ice';

/**
 * What kind of lane a channel is.
 *
 * Reliable (the default): every message arrives, in order, and a lost packet holds back everything behind it to that peer.
 * For facts: events, the lobby, chat.
 *
 * Unreliable: a message arrives once or not at all, in any order, and never waits for another. For latest-wins data that is
 * sent again anyway: poses, snapshots. Bytes only (ArrayBuffer or Uint8Array), sent to one peer at a time, and a message
 * should fit `UNRELIABLE_SAFE_BYTES`. While the fast path to a peer is not up, or for anything that is not bytes, the same
 * channel quietly uses the reliable path, so the receiver's handler hears it either way.
 */
export interface ChannelOptions {
  unreliable?: boolean;
  /**
   * Latest-wins data: a message for a peer that is behind (more than `BEHIND_BYTES` queued) is not sent at all, since the
   * next one replaces it. Without this a slow peer's queue grows and it sees older and older data.
   */
  latest?: boolean;
}

/**
 * The most an unreliable message should carry: it then travels in one packet. WebRTC's SCTP cuts anything larger into
 * packets of about 1,200 bytes, and with no resend one lost packet loses the whole message, so a 2-packet message is lost
 * about twice as often. Larger messages still work, up to `UNRELIABLE_MAX_BYTES`.
 */
export const UNRELIABLE_SAFE_BYTES = 1100;
/** Above this an unreliable channel sends on the reliable path instead: 16 KiB is the largest message every browser takes. */
export const UNRELIABLE_MAX_BYTES = 16_000;
/** A peer with more than this queued on a lane and not yet taken by the network is behind (`NetRoom.buffered`). */
export const BEHIND_BYTES = 8192;

/** A named message lane to the other players. `to` leaves it to everyone. */
export interface Channel<T> {
  send(data: T, to?: string): void;
  on(handler: (data: T, from: string) => void): void;
}

/** What can go wrong that the player must hear about. */
/** 'relays': no public Nostr relay answered, so nobody can be found at all. */
export type NetError = 'password' | 'connect' | 'full' | 'relays';

export interface NetRoom {
  channel<T>(name: string, options?: ChannelOptions): Channel<T>;
  onPeerJoin(handler: (peerId: string) => void): void;
  onPeerLeave(handler: (peerId: string) => void): void;
  /** `peerId` is the far side, where there is one. */
  onError(handler: (error: NetError, peerId?: string) => void): void;
  leave(): void;
  /**
   * How the network side is doing: any matchmaking relay open, how many peers are mid-connection, and the candidates of
   * the latest connection that did not connect (ice.ts). Absent in tests.
   */
  status?(): { relays: boolean; trying: number; ice?: IceReport };
  /**
   * Backpressure: bytes this page has handed to a lane kind for `peerId` that the network has not taken yet. A sender of
   * latest-wins data skips a peer whose count is over `BEHIND_BYTES` rather than queue stale data behind it.
   */
  buffered?(peerId: string, unreliable?: boolean): number;
  /**
   * How many reliable messages to this peer the transport has given up on while it stayed connected (a data channel that
   * would not drain). Each is a hole in a stream that promised none: the sender must resynchronise the peer (pressure.ts).
   */
  failed?(peerId: string): number;
  /** Is the unreliable path to this peer really up? False while a channel that asked for it rides the reliable path. */
  fast?(peerId: string): boolean;
  /** Runs the simulator's due deliveries now. The game calls it every frame, since a hidden tab's timers are throttled. */
  pump?(): void;
}

/**
 * A lobby's two rooms. `main` is behind the password. `door` is behind the code only, and carries nothing but the news
 * that a guest's password failed: trystero tells only the peer that received the handshake, often the host. A guest
 * opens the door only when it is not in after a few seconds. A peer has the same id in both rooms.
 */
export interface LobbyRooms {
  main: NetRoom;
  door(): NetRoom;
}
