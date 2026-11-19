/** What each way a room can close reads as, for the join page, the lobby page and the match alike. */
import { BUILD } from './build';
import type { LobbyError } from './lobby';
import { turnConfigured } from './turn';

/** `advice`: with 'connect', what the failed connection's candidates say (ice.ts), in place of the generic network line. */
export function errorText(error: LobbyError, theirBuild: string, code: string, advice = ''): string {
  switch (error) {
    case 'password': return 'Wrong password. Check it with the host and try again.';
    case 'version': return `Version mismatch: the host has ${theirBuild}, you have ${BUILD}. Both of you hard reload (Ctrl+Shift+R, or Cmd+Shift+R on a Mac), then try again.`;
    case 'host-left': return 'The host left, so the lobby is closed.';
    case 'no-host': return `Lobby not found: nobody answered on code ${code}. Check the code and password with the host; an old invite link points at a lobby that has closed. If both are right, ${turnConfigured() ? 'the host may have left.' : "your networks may not be able to connect directly: set up TURN or try a different network."}`;
    case 'connect': return advice ? `Couldn't connect. ${advice}` : turnConfigured()
      ? "Couldn't connect, even through the relay server. Have one player switch networks (e.g. a phone hotspot)."
      : "Couldn't connect. One of your networks blocks direct connections. Have one player switch networks (e.g. a phone hotspot); a relay server (TURN) would fix it for good.";
    case 'full': return 'That lobby is full: four players.';
    case 'relays': return 'Contacting lobby servers failed: could not reach any of the matchmaking relays. Check your internet connection (a VPN or firewall can block them), then try again.';
    case 'lost': return 'Lost the connection to the host: nothing heard for over half a minute. Their game may have closed, or one of your networks dropped.';
    case 'code-taken': return 'That code was already in use by another lobby. Host again for a fresh code.';
    case 'no-answer': return `Found lobby ${code}, but its host is not answering: their game may be frozen or still loading. Ask them to check their tab, then try again.`;
  }
}
