/**
 * Which transport this page uses, and its simulator setting: both read from the address **once, as the page loads**. The
 * menu wipes an invite link's query from the address bar, so anything read later would miss them; the match handoff
 * (session.ts) writes them back into the match page's address. Its own small file, so the lobby, the entry point and the
 * transports can all ask without importing each other. The why of the loopback is in loopback.ts.
 */

/**
 * True only with `?net=loop` in the address **and** a page that is a dev build or served from this computer. The public
 * site ignores the word: no link can put a player on a transport that reaches nobody.
 */
export function loopbackOn(
  search: string = typeof location === 'undefined' ? '' : location.search,
  host: string = typeof location === 'undefined' ? '' : location.hostname,
  dev: boolean = import.meta.env?.DEV === true,
): boolean {
  if (new URLSearchParams(search).get('net') !== 'loop') return false;
  return dev || host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

/** This page is on the loopback test transport. */
export const LOOPBACK: boolean = loopbackOn();

/** `?netsim=` as the page loaded with it, or '' (netsim.ts reads it). */
export const NETSIM: string = (() => {
  try { return new URLSearchParams(location.search).get('netsim') ?? ''; } catch { return ''; }
})();

export const transportName = (): 'loop' | 'rtc' => (LOOPBACK ? 'loop' : 'rtc');

/** Puts this page's transport and simulator setting into another page's query (the match page, an invite link). */
export function carryNet(params: URLSearchParams, sim: string = NETSIM): void {
  if (LOOPBACK) params.set('net', 'loop');
  if (sim) params.set('netsim', sim);
}
