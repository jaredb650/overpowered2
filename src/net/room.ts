/**
 * The one seam between the game and the network. `trystero.ts` is the real one; tests pass a fake. Stage 1 adds its own
 * channels here (a binary one for poses and snapshots) without touching the lobby.
 */

/** A named message lane to the other players. `to` leaves it to everyone. */
export interface Channel<T> {
  send(data: T, to?: string): void;
  on(handler: (data: T, from: string) => void): void;
}

/** What can go wrong that the player must hear about. */
/** 'relays': no public Nostr relay answered, so nobody can be found at all. */
export type NetError = 'password' | 'connect' | 'full' | 'relays';

export interface NetRoom {
  channel<T>(name: string): Channel<T>;
  onPeerJoin(handler: (peerId: string) => void): void;
  onPeerLeave(handler: (peerId: string) => void): void;
  /** `peerId` is the far side, where there is one. */
  onError(handler: (error: NetError, peerId?: string) => void): void;
  leave(): void;
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
