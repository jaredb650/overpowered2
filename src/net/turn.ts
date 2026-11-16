/**
 * TURN: the relay a pair of browsers falls back on when their routers will not let them talk directly (strict NATs,
 * mobile data, some offices). Credentials are short-lived and minted by a tiny Cloudflare Worker
 * (tools/turn-worker/worker.js, setup in docs/notes/coop.md "TURN setup"), so no secret ever sits in this page.
 */

/**
 * THE CONFIG SLOT. Paste your Worker's address between the quotes, e.g. 'https://op2-turn.yourname.workers.dev', commit
 * and push. It is not a secret (the key lives in the Worker). Empty: STUN only. A build can also set VITE_TURN_URL.
 */
const WORKER_URL = '';

export const TURN_URL: string = (import.meta.env?.VITE_TURN_URL as string | undefined) || WORKER_URL;

export interface IceServer { urls: string | string[]; username?: string; credential?: string }

/** How long the lobby waits for the Worker before going on without TURN. */
export const TURN_TIMEOUT_MS = 4000;

const CACHE_KEY = 'op2_coop_turn';
/** Credentials live for a day; an hour of reuse, kept across the match's page reload, saves asking again. */
const CACHE_MS = 3_600_000;
let cached: { at: number; servers: IceServer[] } | null = null;
try {
  const stored = JSON.parse(globalThis.sessionStorage?.getItem(CACHE_KEY) ?? 'null') as { at?: unknown; servers?: unknown } | null;
  if (stored && typeof stored.at === 'number' && Date.now() - stored.at < CACHE_MS) cached = { at: stored.at, servers: parseIce(stored.servers) };
} catch { /* blocked or corrupt storage: ask the Worker */ }

/** The Worker's answer, cleaned: Cloudflare's `{ iceServers: [...] }` or a bare list. Port 53 hangs browsers without trickle, so it goes. */
export function parseIce(data: unknown): IceServer[] {
  const list = Array.isArray(data) ? data : (data as { iceServers?: unknown } | null)?.iceServers;
  const entries = Array.isArray(list) ? list : list && typeof list === 'object' ? [list] : [];
  const servers: IceServer[] = [];
  for (const entry of entries.slice(0, 8)) {
    if (!entry || typeof entry !== 'object') continue;
    const raw = (entry as IceServer).urls;
    const urls = (Array.isArray(raw) ? raw : [raw]).filter((u): u is string => typeof u === 'string'
      && /^(stun|turns?):[^\s]{1,200}$/.test(u) && !/:53(\?|$)/.test(u));
    if (!urls.length) continue;
    const { username, credential } = entry as IceServer;
    if (urls.some(u => u.startsWith('turn')) && (typeof username !== 'string' || typeof credential !== 'string')) continue;
    servers.push(typeof username === 'string' ? { urls, username, credential } : { urls });
  }
  return servers;
}

/** The relay servers, or [] when none is set up or the Worker does not answer in time. Never throws, never hangs. */
export async function fetchTurn(url = TURN_URL, fetcher: typeof fetch = globalThis.fetch?.bind(globalThis)): Promise<IceServer[]> {
  if (!url || !fetcher) return [];
  if (cached && cached.servers.length && Date.now() - cached.at < CACHE_MS) return cached.servers;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TURN_TIMEOUT_MS);
  try {
    const response = await fetcher(url, { method: 'POST', signal: abort.signal });
    if (!response.ok) throw new Error(`TURN worker answered ${response.status}`);
    const servers = parseIce(await response.json());
    if (servers.length) {
      cached = { at: Date.now(), servers };
      try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(cached)); } catch { /* fine without */ }
    }
    return servers;
  } catch (error) {
    console.warn('[coop] No TURN relay this time; direct connections only.', error);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export const turnConfigured = (): boolean => !!TURN_URL;
