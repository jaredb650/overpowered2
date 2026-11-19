import { onBeforeChunkReload } from '../core/chunkRetry';
import { report, reportLobby } from '../core/report';
/**
 * Tab-local map handoff. A match is played on a fresh page per player (maps are fixed for a page's life), so the lobby
 * writes what the map page needs into sessionStorage and changes page. Passwords never enter URLs or game messages. The
 * room reconnects before the heavy map boot.
 *
 * The handoff stays for as long as the match does (only `clearSession` removes it), so a reload of the map page lands in
 * the same match, never in a silent solo run: a guest takes its seat back, and a host, whose page was the world, opens a
 * new match of the same mode for the same players, who follow it.
 */
import { Lobby, validMatch, type Match, type SeatRecord } from './lobby';
import { BUILD } from './build';
import { carryNet } from './mode';
import { simText } from './netsim';
import { isStarter, selectedStarter, type StarterGun } from '../contracts/starter';

interface Handoff {
  code: string; password: string; name: string; hosting: boolean; match: Match; starter?: StarterGun;
  /** Host: the players the lobby sent into this match, so the map page can wait for them by name and keep their seats. */
  roster?: SeatRecord[];
  /** Host: every seat this room has given out (browser id, seat id). */
  seats?: [string, string][];
  /** A map page has already been built from this handoff: finding it again means the page was reloaded. */
  used?: boolean;
}
const KEY = 'op2_coop_match';
/**
 * The room this tab is in, kept beside the match handoff for as long as the player is in it (the lobby page writes it as a
 * lobby is attached, leaving removes it). A reload on the lobby page, between matches, finds it and walks back into the same
 * room: a guest joins again and takes its seat back; a host opens its lobby again on the same code, where its guests are
 * waiting on "Reconnecting to host".
 */
const ROOM_KEY = 'op2_coop_room';
export interface RoomNote {
  code: string; password: string; name: string; hosting: boolean;
  /** Host: every seat given out (browser id, seat id), and the slot each seat had (seat id, slot). */
  seats?: [string, string][];
  slots?: [string, number][];
}
export let resumedLobby: Lobby | null = null;
export let resumedMatch: Match | null = null;
/** The room the match was played in, so leaving the match lands back in its lobby rather than the main menu. */
export let resumedRoom: { code: string; password: string } | null = null;
/** Why a match handoff found on this page could not be used: shown on Multiplayer, never a silent splash. */
export let resumeFailed = '';
/** This page was reloaded in the middle of its match (and has rejoined it). */
export let reloaded = false;
/**
 * What the host did while this page was still loading the map. The game is not listening yet (its session is built at the
 * end of the boot), so this keeps the news: the match ended, and the boot must land on the lobby page, not in a dead run.
 */
export const whileLoading = { ended: false };
/** The handoff this page read, kept so a failed boot can put it back (restoreHandoff). */
let consumed: string | null = null;
/** This page is changing to a map page of its own accord: no "leave the match?" prompt for that. */
export let deploying = false;

/** '' when this tab can carry a match to its map page, else why not. Asked before the host sends anyone off. */
export function canDeploy(): string {
  try {
    sessionStorage.setItem(`${KEY}_probe`, '1');
    sessionStorage.removeItem(`${KEY}_probe`);
    return '';
  } catch {
    return 'Co-op needs tab storage to load the map, and this browser is blocking it. Allow site data for this page, then start again.';
  }
}

export function deployMatch(code: string, password: string, lobby: Lobby, match: Match): void {
  const handoff: Handoff = { code, password, name: lobby.me?.name ?? 'PLAYER', hosting: lobby.hosting, match,
    // This player's own pick first: the host's list can lag a pick made as the count ran out.
    starter: lobby.starter ?? lobby.me?.starter ?? selectedStarter(match.mode),
    ...(lobby.hosting ? lobby.seatRecords() : {}) };
  // If storage is blocked, fail on the lobby page rather than reloading into an unrelated single-player run.
  sessionStorage.setItem(KEY, JSON.stringify(handoff));
  const params = new URLSearchParams(location.search);
  for (const flag of ['map', 'join', 'deploy', 'autostart', 'sandbox']) params.delete(flag);
  params.set('contract', match.mode);
  if (match.map) params.set('map', match.map);
  params.set('starter', handoff.starter!);
  // The test transport and the network simulator follow the player into the match page (mode.ts, netsim.ts).
  carryNet(params, simText());
  deploying = true;
  const next = params.toString();
  // The same mode on the same map again (a match restarted under a loading or reloaded page): the address does not change.
  if (`?${next}` === location.search) location.reload();
  else location.search = next;
}

export async function reconnectMatch(): Promise<void> {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return;
    consumed = raw;
    resumeFailed = 'The co-op match could not be carried over to this page. Join the lobby again.';
    const data = JSON.parse(raw) as Handoff;
    if (!validMatch(data.match) || typeof data.code !== 'string' || !/^[A-Z2-9]{6}$/.test(data.code)
      || typeof data.password !== 'string' || typeof data.name !== 'string' || typeof data.hosting !== 'boolean'
      || new URLSearchParams(location.search).get('contract') !== data.match.mode
      || (new URLSearchParams(location.search).get('map') ?? undefined) !== data.match.map) {
      sessionStorage.removeItem(KEY);
      return;
    }
    reloaded = data.used === true;
    // The host's page was the world. Reloaded, it cannot pick that world up again, so it opens a new match of the same mode
    // for the same players: their pages take the new match's start and follow (Lobby.onMatch).
    const match: Match = reloaded && data.hosting ? { ...data.match, id: crypto.randomUUID() } : data.match;
    if (match !== data.match) sessionStorage.setItem(KEY, JSON.stringify({ ...data, match } satisfies Handoff));
    await reportLobby(data.code, data.hosting ? 'host' : 'guest');
    report('COOP_ATTEMPT', { stage: reloaded ? 'reload' : 'reconnect' });
    if (reloaded) console.info(`[coop] This page was reloaded mid-match: ${data.hosting ? 'hosting the match again from its start' : 'rejoining it'}.`);
    const { openLobby } = await import('./trystero');
    resumedMatch = match;
    resumedRoom = { code: data.code, password: data.password };
    const roster = Array.isArray(data.roster) ? data.roster.filter(r => r && typeof r.browser === 'string' && typeof r.seat === 'string' && Number.isInteger(r.slot)) : [];
    const seats = Array.isArray(data.seats) ? data.seats.filter(s => Array.isArray(s) && typeof s[0] === 'string' && typeof s[1] === 'string') : [];
    const lobby = resumedLobby = new Lobby(await openLobby(data.code, data.password), data.hosting, data.name, BUILD,
      { page: match.id, roster, seats }, isStarter(data.starter) ? data.starter : selectedStarter(data.match.mode));
    lobby.onEnd = () => { whileLoading.ended = true; };
    // The host moved on to another match while this page loaded (or reloaded): go there.
    lobby.onMatch = next => { if (next.id !== match.id) deployMatch(data.code, data.password, lobby, next); };
    if (data.hosting) lobby.startMatch(match.mode, match.id, match.map);
    resumeFailed = '';
  } catch (error) {
    report('COOP_DISCONNECTED', { error, stage: 'reconnect' });
    console.warn('[coop] Could not resume the room', error);
    resumeFailed = 'Could not reconnect to the co-op room on this page. Check you are online, then join the lobby again.';
  }
}

/**
 * The map page booted from its handoff. Marked only now, so a boot that failed and was reloaded is still the first page of
 * its match (a host must not restart a match nobody has seen yet).
 */
export function handoffUsed(): void {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw) sessionStorage.setItem(KEY, JSON.stringify({ ...(JSON.parse(raw) as Handoff), used: true }));
  } catch { /* blocked storage */ }
}

/** The boot failed after this page took the handoff: make sure it is still there, so a reload lands in the same match. */
export function restoreHandoff(): void {
  try { if (consumed && !sessionStorage.getItem(KEY)) sessionStorage.setItem(KEY, consumed); } catch { /* blocked storage: the reload starts solo */ }
}

onBeforeChunkReload(restoreHandoff);

/** Kept only for the current tab's lifetime. Quit clears it and the live room. */
export function clearSession(): void {
  resumedLobby = null;
  resumedMatch = null;
  resumedRoom = null;
  consumed = null;
  try { sessionStorage.removeItem(KEY); } catch { /* blocked storage */ }
}

/** The lobby page is in this room now. Written again whenever the host's seat table grows. */
export function rememberRoom(code: string, password: string, lobby: Lobby): void {
  const records = lobby.hosting ? lobby.seatRecords() : null;
  const note: RoomNote = { code, password, name: lobby.me?.name ?? '', hosting: lobby.hosting, ...(records ? { seats: records.seats, slots: records.slots } : {}) };
  try {
    const text = JSON.stringify(note);
    if (sessionStorage.getItem(ROOM_KEY) !== text) sessionStorage.setItem(ROOM_KEY, text);
  } catch { /* blocked storage: a reload on the lobby page starts from the menu */ }
}

/** The player left the room, or it closed for good. */
export function forgetRoom(): void {
  try { sessionStorage.removeItem(ROOM_KEY); } catch { /* blocked storage */ }
}

/** The room this tab was in when its page was reloaded, or null. Read once the match handoff has been tried (`reconnectMatch`). */
export function roomToRejoin(): RoomNote | null {
  try {
    const raw = sessionStorage.getItem(ROOM_KEY);
    if (!raw) return null;
    const note = JSON.parse(raw) as RoomNote;
    if (typeof note.code !== 'string' || !/^[A-Z2-9]{6}$/.test(note.code) || typeof note.password !== 'string' || !note.password
      || typeof note.name !== 'string' || typeof note.hosting !== 'boolean') { forgetRoom(); return null; }
    const seats = Array.isArray(note.seats) ? note.seats.filter(s => Array.isArray(s) && typeof s[0] === 'string' && typeof s[1] === 'string').slice(0, 64) : undefined;
    const slots = Array.isArray(note.slots) ? note.slots.filter(s => Array.isArray(s) && typeof s[0] === 'string' && Number.isInteger(s[1])).slice(0, 64) : undefined;
    return { code: note.code, password: note.password, name: note.name.slice(0, 16), hosting: note.hosting, ...(seats ? { seats } : {}), ...(slots ? { slots } : {}) };
  } catch { return null; }
}
