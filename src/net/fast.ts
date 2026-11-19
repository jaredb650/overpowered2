/**
 * The unreliable path of real WebRTC: one extra RTCDataChannel per peer connection beside trystero's own, opened by both
 * ends with the same number (`negotiated`), unordered and with no resend. trystero 0.27 offers no such option, and its
 * answering side takes any channel the far end announces for its own, which a negotiated channel never triggers.
 *
 * A link is **up** only once this end has heard the far end on it: a channel can say `open` before the far end has made
 * its half, and what is sent then is lost. Each end sends a 2-byte probe four times a second until it hears anything, and
 * answers a probe with an ack. Until then, and after the channel closes or fails, `send` says no and the caller uses the
 * reliable path. So the worst a broken fast channel can do is leave co-op exactly as it was before it existed.
 *
 * Frames: byte 0 is 0 for these two control frames (`[0, 0]` probe, `[0, 1]` ack); anything else is the lane layer's.
 */

/** The data channel number both ends use. trystero's own channel takes 0 or 1; Chrome allows up to 1023. */
export const FAST_CHANNEL_ID = 100;
export const FAST_CHANNEL_LABEL = 'op2-fast';
export const FAST_CHANNEL_INIT = { negotiated: true, id: FAST_CHANNEL_ID, ordered: false, maxRetransmits: 0 } as const;
export const PROBE_MS = 250;
/** Ten seconds of probes; after that this end only answers. */
export const PROBE_TRIES = 40;

/** The part of RTCDataChannel a link uses, so tests can pass a fake. */
export interface FastChannel {
  readyState: string;
  bufferedAmount: number;
  binaryType: string;
  send(data: Uint8Array): void;
  close(): void;
  onopen: ((event: never) => void) | null;
  onclose: ((event: never) => void) | null;
  onerror: ((event: never) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
}

const PROBE = new Uint8Array([0, 0]);
const ACK = new Uint8Array([0, 1]);

export class FastLink {
  /** The far end has been heard on this channel, and it is still open. */
  up = false;
  private heard = false;
  private tries = 0;
  private prober: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly channel: FastChannel, private readonly onFrame: (frame: Uint8Array) => void) {
    channel.binaryType = 'arraybuffer';
    channel.onopen = () => this.opened();
    channel.onclose = channel.onerror = () => this.down();
    channel.onmessage = event => this.message(event.data);
    if (channel.readyState === 'open') this.opened();
  }

  private opened(): void {
    if (this.prober || this.heard) return;
    this.probe();
    this.prober = setInterval(() => this.probe(), PROBE_MS);
    (this.prober as { unref?: () => void }).unref?.();
  }

  private probe(): void {
    if (this.heard || ++this.tries > PROBE_TRIES) return this.stopProbing();
    this.raw(PROBE);
  }

  private stopProbing(): void {
    if (this.prober) clearInterval(this.prober);
    this.prober = null;
  }

  private message(data: unknown): void {
    const frame = data instanceof ArrayBuffer ? new Uint8Array(data) : data instanceof Uint8Array ? data : null;
    if (!frame || !frame.byteLength) return;
    if (!this.heard) {
      this.heard = true;
      this.stopProbing();
    }
    this.up = this.channel.readyState === 'open';
    if (frame[0] !== 0) return this.onFrame(frame);
    if (frame[1] === 0) this.raw(ACK);
  }

  private raw(frame: Uint8Array): boolean {
    if (this.channel.readyState !== 'open') return false;
    try {
      this.channel.send(frame);
      return true;
    } catch {
      // A full buffer or a channel closing under us: this frame is lost, which an unreliable lane allows.
      return false;
    }
  }

  private down(): void {
    this.up = false;
    this.stopProbing();
  }

  /** False when the link is not up: the caller sends by the reliable path instead. */
  send(frame: Uint8Array): boolean {
    if (!this.up) return false;
    if (this.channel.readyState !== 'open') {
      this.down();
      return false;
    }
    this.raw(frame);
    return true;
  }

  get buffered(): number {
    return this.channel.readyState === 'open' ? this.channel.bufferedAmount : 0;
  }

  close(): void {
    this.down();
    try { this.channel.close(); } catch { /* already gone */ }
  }
}
