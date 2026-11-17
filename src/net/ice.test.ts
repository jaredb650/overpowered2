import { describe, expect, it } from 'vitest';
import { addCandidate, iceAdvice, noKinds, type IceKinds } from './ice';

const side = (...lines: string[]): IceKinds => {
  const k = noKinds();
  for (const line of lines) addCandidate(k, line);
  return k;
};
const mdns = (n: number) => `candidate:1 1 udp 2122260223 ${n}a1b2c3d4-0000-4000-8000-000000000000.local 5${n}000 typ host generation 0`;
const srflx = (ip: string) => `candidate:2 1 udp 1686052607 ${ip} 61000 typ srflx raddr 0.0.0.0 rport 0 generation 0`;
const HOME = '203.0.113.7';

describe('ICE candidates', () => {
  it('counts kinds, .local names and public addresses', () => {
    const k = side(mdns(1), 'a=candidate:3 1 udp 2122194687 192.168.1.20 52000 typ host', srflx(HOME), srflx(HOME),
      'candidate:4 1 udp 41885439 198.51.100.9 3478 typ relay raddr 203.0.113.7 rport 61000', 'garbage', '');
    expect(k).toEqual({ host: 2, mdns: 1, srflx: 2, relay: 1, publicIps: [HOME] });
  });

  it('same network, both offer LAN addresses: the router or the Mac blocks it', () => {
    const text = iceAdvice({ ours: side(mdns(1), srflx(HOME)), theirs: side(mdns(2), srflx(HOME)) }, 'guest', false);
    expect(text).toMatch(/same network/);
    expect(text).toMatch(/Local Network/);
  });

  it('same network, one side hides its LAN address: names that side', () => {
    const report = { ours: side(mdns(1), srflx(HOME)), theirs: side(srflx(HOME)) };
    expect(iceAdvice(report, 'guest', false)).toMatch(/the host's browser hides/);
    expect(iceAdvice(report, 'host', false)).toMatch(/the guest's browser hides/);
    expect(iceAdvice({ ours: report.theirs, theirs: report.ours }, 'guest', true)).toMatch(/your browser hides.*brave:\/\/settings\/privacy/);
    expect(iceAdvice({ ours: side(srflx(HOME)), theirs: side(srflx(HOME)) }, 'host', false)).toMatch(/you both hide/);
  });

  it('different networks: nothing beyond the TURN text', () => {
    expect(iceAdvice({ ours: side(srflx(HOME)), theirs: side(mdns(2), srflx('198.51.100.1')) }, 'guest', false)).toBe('');
    expect(iceAdvice(undefined, 'guest')).toBe('');
  });

  it('a side with no addresses at all blocks peer-to-peer', () => {
    expect(iceAdvice({ ours: noKinds(), theirs: side(srflx(HOME)) }, 'guest', true)).toMatch(/^Your browser offered no network addresses.*Brave/);
    expect(iceAdvice({ ours: side(srflx(HOME)), theirs: noKinds() }, 'guest', false)).toMatch(/from the host/);
  });
});
