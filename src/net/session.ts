import { onBeforeChunkReload } from '../core/chunkRetry';
import { report, reportLobby } from '../core/report';
/** Tab-local map handoff. Passwords never enter URLs or game messages. The room reconnects before the heavy map boot. */
import { Lobby, validMatch, type Match } from './lobby';
import { BUILD } from './build';
import { isStarter, selectedStarter, type StarterGun } from '../contracts/starter';

interface Handoff { code: string; password: string; name: string; hosting: boolean; match: Match; starter?: StarterGun }
const KEY = 'op2_coop_match';
export let resumedLobby: Lobby | null = null;
export let resumedMatch: Match | null = null;
/** The room the match was played in, so leaving the match lands back in its lobby rather than the main menu. */
export let resumedRoom: { code: string; password: string } | null = null;
/** Why a match handoff found on this page could not be used: shown on Multiplayer, never a silent splash. */
export let resumeFailed = '';
/** The handoff this page read, kept so a failed boot can put it back (restoreHandoff). */
let consumed: string | null = null;

export function deployMatch(code: string, password: string, lobby: Lobby, match: Match): void {
  const handoff: Handoff = { code, password, name: lobby.me?.name ?? 'PLAYER', hosting: lobby.hosting, match,
    // This player's own pick first: the host's list can lag a pick made as the count ran out.
    starter: lobby.starter ?? lobby.me?.starter ?? selectedStarter(match.mode) };
  // If storage is blocked, fail on the lobby page rather than reloading into an unrelated single-player run.
  sessionStorage.setItem(KEY, JSON.stringify(handoff));
  const params = new URLSearchParams(location.search);
  for (const flag of ['map', 'join', 'deploy', 'autostart', 'sandbox']) params.delete(flag);
  params.set('contract', match.mode);
  if (match.map) params.set('map', match.map);
  params.set('starter', handoff.starter!);
  location.search = params.toString();
}

export async function reconnectMatch(): Promise<void> {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return;
    sessionStorage.removeItem(KEY);
    consumed = raw;
    resumeFailed = 'The co-op match could not be carried over to this page. Join the lobby again.';
    const data = JSON.parse(raw) as Handoff;
    if (!validMatch(data.match) || typeof data.code !== 'string' || !/^[A-Z2-9]{6}$/.test(data.code)
      || typeof data.password !== 'string' || typeof data.name !== 'string' || typeof data.hosting !== 'boolean'
      || new URLSearchParams(location.search).get('contract') !== data.match.mode
      || (new URLSearchParams(location.search).get('map') ?? undefined) !== data.match.map) return;
    await reportLobby(data.code, data.hosting ? 'host' : 'guest');
    report('COOP_ATTEMPT', { stage: 'reconnect' });
    const { openLobby } = await import('./trystero');
    resumedMatch = data.match;
    resumedRoom = { code: data.code, password: data.password };
    resumedLobby = new Lobby(await openLobby(data.code, data.password), data.hosting, data.name, BUILD, true, isStarter(data.starter) ? data.starter : selectedStarter(data.match.mode));
    if (data.hosting) resumedLobby.startMatch(data.match.mode, data.match.id, data.match.map);
    resumeFailed = '';
  } catch (error) {
    report('COOP_DISCONNECTED', { error, stage: 'reconnect' });
    console.warn('[coop] Could not resume the room', error);
    resumeFailed = 'Could not reconnect to the co-op room on this page. Check you are online, then join the lobby again.';
  }
}

/** The boot failed after this page took the handoff: put it back, so a reload lands in the same match, not a solo run. */
export function restoreHandoff(): void {
  try { if (consumed) sessionStorage.setItem(KEY, consumed); } catch { /* blocked storage: the reload starts solo */ }
}

onBeforeChunkReload(restoreHandoff);

/** Kept only for the current tab's lifetime. Quit clears it and the live room. */
export function clearSession(): void {
  resumedLobby = null;
  resumedMatch = null;
  resumedRoom = null;
  try { sessionStorage.removeItem(KEY); } catch { /* blocked storage */ }
}
