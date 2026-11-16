/** Tab-local map handoff. Passwords never enter URLs or game messages. The room reconnects before the heavy map boot. */
import { Lobby, validMatch, type Match } from './lobby';
import { BUILD } from './build';
import { isStarter, selectedStarter, type StarterGun } from '../contracts/starter';

interface Handoff { code: string; password: string; name: string; hosting: boolean; match: Match; starter?: StarterGun }
const KEY = 'op2_coop_match';
export let resumedLobby: Lobby | null = null;
export let resumedMatch: Match | null = null;

export function deployMatch(code: string, password: string, lobby: Lobby, match: Match): void {
  const handoff: Handoff = { code, password, name: lobby.me?.name ?? 'PLAYER', hosting: lobby.hosting, match, starter: lobby.me?.starter ?? selectedStarter(match.mode) };
  // If storage is blocked, fail on the lobby page rather than reloading into an unrelated single-player run.
  sessionStorage.setItem(KEY, JSON.stringify(handoff));
  const params = new URLSearchParams(location.search);
  for (const flag of ['map', 'join', 'deploy', 'autostart', 'sandbox']) params.delete(flag);
  params.set('contract', match.mode);
  params.set('starter', handoff.starter!);
  location.search = params.toString();
}

export async function reconnectMatch(): Promise<void> {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return;
    sessionStorage.removeItem(KEY);
    const data = JSON.parse(raw) as Handoff;
    if (!validMatch(data.match) || typeof data.code !== 'string' || !/^[A-Z2-9]{6}$/.test(data.code)
      || typeof data.password !== 'string' || typeof data.name !== 'string' || typeof data.hosting !== 'boolean'
      || new URLSearchParams(location.search).get('contract') !== data.match.mode) return;
    const { openLobby } = await import('./trystero');
    resumedMatch = data.match;
    resumedLobby = new Lobby(openLobby(data.code, data.password), data.hosting, data.name, BUILD, true, isStarter(data.starter) ? data.starter : selectedStarter(data.match.mode));
    if (data.hosting) resumedLobby.startMatch(data.match.mode, data.match.id);
  } catch (error) {
    console.warn('[coop] Could not resume the room', error);
  }
}

/** Kept only for the current tab's lifetime. Quit clears it and the live room. */
export function clearSession(): void {
  resumedLobby = null;
  resumedMatch = null;
  try { sessionStorage.removeItem(KEY); } catch { /* blocked storage */ }
}
