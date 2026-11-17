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
 * The likely cause in plain words, or '' when the candidates say nothing more than "needs TURN". `me` is the side
 * reading it; `brave` is whether this browser is Brave.
 */
export function iceAdvice(report: IceReport | undefined, me: Side, brave = !!(globalThis.navigator as { brave?: unknown } | undefined)?.brave): string {
  if (!report) return '';
  const { ours, theirs } = report;
  const them = me === 'host' ? 'the guest' : 'the host';
  const braveFix = 'brave://settings/privacy, WebRTC IP handling policy, set to Default';
  const hideFix = `In Brave: ${braveFix}. Otherwise turn off any "WebRTC leak" setting in a privacy extension.`;
  if (!total(ours)) return `Your browser offered no network addresses at all, so it blocks peer-to-peer. ${brave ? `In Brave: ${braveFix}.` : hideFix}`;
  if (!total(theirs)) return `No network addresses arrived from ${them}: their browser may block peer-to-peer. ${hideFix}`;
  const hidden = [!ours.host && 'you', !theirs.host && them].filter(Boolean);
  // Different networks: LAN addresses would not help anyway, and the old "needs TURN" text stands.
  if (!ours.publicIps.some(ip => theirs.publicIps.includes(ip))) return '';
  if (hidden.length) {
    const hider = hidden.length === 2 ? 'you both hide' : hidden[0] === 'you' ? 'your browser hides' : `${them}'s browser hides`;
    const fix = hidden[0] === 'you' && brave ? `In Brave: ${braveFix}.` : hideFix;
    return `You are on the same network, but ${hider} local network addresses, and most routers will not loop traffic back in. ${fix} Or use Chrome on both.`;
  }
  // Seen 2026-11-17: owner and guest on one home Wi-Fi failed; a phone hotspot for one of them played fine.
  return 'You are on the same network, and it will not connect your computers to each other. To play now: put one computer on a phone hotspot. To fix it: on each Mac, System Settings, Privacy & Security, Local Network, switch your browser on, then restart the browser. If that changes nothing, the router blocks it (Wi-Fi isolation, or no loop-back), and only the relay server (TURN) gets round it.';
}
