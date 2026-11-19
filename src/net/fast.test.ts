import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FastLink, PROBE_MS, PROBE_TRIES, type FastChannel } from './fast';

/** Two ends of a data channel. What one sends reaches the other only while that other end has been made (`made`). */
class FakeChannel implements FastChannel {
  readyState = 'connecting';
  bufferedAmount = 0;
  binaryType = '';
  other: FakeChannel | null = null;
  sent: Uint8Array[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  send(data: Uint8Array): void {
    this.sent.push(data.slice());
    if (this.other?.readyState === 'open') this.other.onmessage?.({ data: data.slice().buffer });
  }
  open(): void { this.readyState = 'open'; this.onopen?.(); }
  close(): void { this.readyState = 'closed'; this.onclose?.(); }
}

const pair = () => {
  const a = new FakeChannel(), b = new FakeChannel();
  a.other = b; b.other = a;
  return { a, b };
};

describe('the unreliable link and its fallback', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('is not up, and refuses to send, until the far end has been heard', () => {
    const { a, b } = pair();
    const got: Uint8Array[] = [];
    const left = new FastLink(a, () => {});
    a.open();
    // The far end has not made its half yet: probes go nowhere, and a send says no so the caller uses the reliable path.
    vi.advanceTimersByTime(PROBE_MS * 3);
    expect(left.up).toBe(false);
    expect(left.send(new Uint8Array([4, 1, 2, 3]))).toBe(false);
    const right = new FastLink(b, frame => got.push(frame));
    b.open();
    vi.advanceTimersByTime(PROBE_MS);
    expect(left.up).toBe(true);
    expect(right.up).toBe(true);
    expect(left.send(new Uint8Array([4, 1, 2, 3]))).toBe(true);
    expect(got.map(f => [...f])).toEqual([[4, 1, 2, 3]]);
  });

  it('stops probing once heard, and gives up probing after ten seconds but still answers', () => {
    const { a, b } = pair();
    const left = new FastLink(a, () => {});
    a.open();
    vi.advanceTimersByTime(PROBE_MS * (PROBE_TRIES + 20));
    expect(a.sent.length).toBe(PROBE_TRIES);
    const right = new FastLink(b, () => {});
    b.open();
    vi.advanceTimersByTime(PROBE_MS);
    expect(left.up).toBe(true);
    expect(right.up).toBe(true);
    const sent = b.sent.length;
    vi.advanceTimersByTime(PROBE_MS * 10);
    expect(b.sent.length).toBe(sent);
  });

  it('falls back for good when the channel closes or errors', () => {
    const { a, b } = pair();
    const left = new FastLink(a, () => {});
    new FastLink(b, () => {});
    a.open(); b.open();
    vi.advanceTimersByTime(PROBE_MS);
    expect(left.up).toBe(true);
    a.readyState = 'closed';
    expect(left.send(new Uint8Array([4, 0]))).toBe(false);
    expect(left.up).toBe(false);
    expect(left.buffered).toBe(0);
  });

  it('a send that throws loses that frame and nothing else', () => {
    const { a, b } = pair();
    const left = new FastLink(a, () => {});
    new FastLink(b, () => {});
    a.open(); b.open();
    vi.advanceTimersByTime(PROBE_MS);
    a.send = () => { throw new Error('buffer full'); };
    expect(() => left.send(new Uint8Array([4, 0]))).not.toThrow();
    expect(left.up).toBe(true);
  });

  it('reports what is queued', () => {
    const { a } = pair();
    const left = new FastLink(a, () => {});
    a.open();
    a.bufferedAmount = 12_345;
    expect(left.buffered).toBe(12_345);
  });
});
