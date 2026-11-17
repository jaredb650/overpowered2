/**
 * Why a direct connection failed, read from the ICE candidates each side gathered. Each side's candidates already reach
 * the other through the Nostr handshake (trystero trickles them), so the "theirs" half needs no extra message.
 * Public addresses stay in memory, only to compare them; they are never shown or sent anywhere.
 */

/** One side's candidates: host = a LAN address (mdns of them hidden behind a random .local name), srflx = the public address seen by STUN, relay = TURN. */
export interface IceKinds { host: number; mdns: number; srflx: number; relay: number; publicIps: string[] }
export interface IceReport { ours: IceKinds; theirs: IceKinds }

export const noKinds = (): IceKinds => ({ host: 0, mdns: 0, srflx: 0, relay: 0, publicIps: [] });

/** Counts one candidate line ("candidate:<foundation> <component> <proto> <priority> <address> <port> typ <type> ..."). */
export function addCandidate(kinds: IceKinds, line: string | undefined | null): void {
  const match = line && /candidate:\S+ \d+ \S+ \d+ (\S+) \d+ typ (\w+)/i.exec(line);
  if (!match) return;
  const [, address, type] = match;
  if (type === 'host') {
    kinds.host++;
    if (address.endsWith('.local')) kinds.mdns++;
  } else if (type === 'srflx' || type === 'prflx') {
    kinds.srflx++;
    if (!kinds.publicIps.includes(address)) kinds.publicIps.push(address);
  } else if (type === 'relay') kinds.relay++;
}

const total = (k: IceKinds): number => k.host + k.srflx + k.relay;

/** The two halves of a lobby, as the player reading the message sees them. */
export type Side = 'host' | 'guest';

/**
 * The likely cause, short and plain (the counts go to the console), or '' when the candidates say nothing more than
 * "needs TURN". `me` is the side reading it; `brave` is whether this browser is Brave. Keep "same network" in that case:
 * the error screen keys on it.
 */
export function iceAdvice(report: IceReport | undefined, me: Side, brave = !!(globalThis.navigator as { brave?: unknown } | undefined)?.brave): string {
  if (!report) return '';
  const { ours, theirs } = report;
  const them = me === 'host' ? 'the guest' : 'the host';
  const braveTip = 'in Brave, set WebRTC IP handling policy to Default (brave://settings/privacy)';
  if (!total(ours)) return `Your browser is blocking direct connections (a privacy setting or extension). Turn that off${brave ? `: ${braveTip}` : ''}, or try another browser.`;
  if (!total(theirs)) return `${them[0].toUpperCase()}${them.slice(1)}'s browser may be blocking direct connections (a privacy setting or extension). They can turn that off, or try another browser.`;
  // Different networks: LAN addresses would not help anyway, and the "needs TURN" text stands.
  if (!ours.publicIps.some(ip => theirs.publicIps.includes(ip))) return '';
  // Seen 2026-11-17: owner and guest on one home Wi-Fi failed; a phone hotspot for one of them played fine.
  const base = `You may be on the same network as ${them} — some routers block that. Check your router settings, or have one player switch networks (e.g. a phone hotspot).`;
  const hidden = [!ours.host && 'you', !theirs.host && them].filter(Boolean);
  if (!hidden.length) return base;
  const hider = hidden.length === 2 ? 'you both hide' : hidden[0] === 'you' ? 'your browser hides' : `${them}'s browser hides`;
  return `${base} Also, ${hider} local addresses${hidden[0] === 'you' && brave ? `: ${braveTip}` : ''}.`;
}
