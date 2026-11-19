/**
 * The envelope of the reliable event lane: every event a page queues for a peer in one frame travels as one message of bytes.
 *
 *   [0xB1][match tag, u32 LE] then one record per event, in the order they were sent:
 *   [kind u8][payload length, LEB128][payload]
 *
 * - **The match tag** stands in for the 36-character match id that used to ride on every event: a 32-bit hash of it, once
 *   per message. A page drops a batch whose tag is not its own match's (a page of the last match, still closing).
 * - **Kind 0** is one event as JSON text (UTF-8). Kinds 1 to 255 are packed forms a lane's `Packer` gives its hot events
 *   (world/pack.ts); an event with no packed form goes as JSON, so adding an event type needs nothing here.
 * - **One encode per event**, whoever it is for: the record's bytes are copied into each recipient's batch. Its length is
 *   the event's size on the wire, so nothing is turned to text a second time to be counted.
 * - **A batch is at most `BATCH_MAX_BYTES`**, so the transport sends it as one frame (trystero's inline frame holds 16,348
 *   bytes of payload; past that it negotiates a transfer). A batch that would outgrow it leaves early, in order; one event
 *   larger than that travels alone.
 * - **Reading never throws.** A message that is not a batch is refused whole; a batch cut short gives the records that
 *   are whole; a record that cannot be read is skipped.
 *
 * Both ends are always the same build (the lobby refuses another, lobby.ts `hello`), so no page ever meets the old
 * one-JSON-object-per-event form.
 */

export const BATCH_MAGIC = 0xb1;
/** The magic byte and the match tag. */
export const BATCH_HEAD = 5;
export const BATCH_MAX_BYTES = 15_000;
export const KIND_JSON = 0;
/** A record's own cost over its payload: the kind byte and a length of one to four bytes. */
export const RECORD_HEAD_MAX = 5;

/** A lane's packed forms: bytes for the events sent too often to afford JSON. */
export interface Packer<T> {
  /**
   * Writes `event`'s packed payload into `into` from `at` and returns `[kind, end]`, or null to send it as JSON (no packed
   * form, a value out of the form's range, or not enough room: `into` always has `PACKED_ROOM` bytes free after `at`).
   */
  pack(event: T, into: Uint8Array, at: number): readonly [kind: number, end: number] | null;
  /** The event a packed payload stands for, or null if the bytes are not one. */
  unpack(kind: number, payload: Uint8Array): T | null;
}
/** Room a packer may count on. A packed form is tens of bytes; the scratch buffer keeps this much free. */
export const PACKED_ROOM = 1024;

/** The 32-bit tag a match id travels as (FNV-1a). */
export function matchTag(id: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** One encoded record, valid until the next `encode`: `bytes.subarray(start, end)`. */
export interface Encoded { bytes: Uint8Array; start: number; end: number; kind: number }

/** Encodes records into one reused buffer. */
export class RecordWriter<T> {
  private scratch = new Uint8Array(8192);
  private readonly out: Encoded = { bytes: this.scratch, start: 0, end: 0, kind: KIND_JSON };

  constructor(private readonly packer?: Packer<T>) {}

  /** `event` as one record, or null for something JSON cannot carry (undefined, a function). */
  encode(event: T): Encoded | null {
    const at = RECORD_HEAD_MAX;
    let kind = KIND_JSON, end = -1;
    const packed = this.packer?.pack(event, this.scratch, at);
    if (packed && packed[0] > 0 && packed[0] <= 255 && packed[1] >= at && packed[1] <= this.scratch.length) {
      kind = packed[0];
      end = packed[1];
    } else {
      const text = JSON.stringify(event);
      if (typeof text !== 'string') return null;
      // UTF-8 is at most three bytes for each UTF-16 unit.
      const need = at + text.length * 3 + PACKED_ROOM;
      if (need > this.scratch.length) this.scratch = new Uint8Array(Math.max(need, this.scratch.length * 2));
      end = at + encoder.encodeInto(text, this.scratch.subarray(at)).written;
    }
    // The head sits right before the payload: the kind, then the length in 7-bit groups, low first.
    let length = end - at, size = 1;
    for (let n = length; n >= 0x80; n >>>= 7) size++;
    let i = at - size;
    const start = i - 1;
    this.scratch[start] = kind;
    for (; length >= 0x80; length >>>= 7) this.scratch[i++] = (length & 0x7f) | 0x80;
    this.scratch[i] = length;
    const out = this.out;
    out.bytes = this.scratch; out.start = start; out.end = end; out.kind = kind;
    return out;
  }
}

interface Pending { bytes: Uint8Array; length: number; tag: number; events: number }

/**
 * What is queued for each peer until the next flush. `send` is handed a fresh copy of each finished batch. `flush` asks
 * `gate` first, per peer: false discards what is queued for that peer (a peer the lobby has just given up on).
 */
export class Batcher {
  private readonly pending = new Map<string, Pending>();
  /** Batches and events sent, and events thrown away at a closed gate. */
  readonly stats = { batches: 0, events: 0, bytes: 0, discarded: 0 };

  constructor(private readonly send: (batch: Uint8Array, to: string) => void, private readonly maxBytes = BATCH_MAX_BYTES) {}

  /** Adds an encoded record to `to`'s batch for the match tagged `tag`. */
  add(record: Encoded, to: string, tag: number): void {
    const size = record.end - record.start;
    let p = this.pending.get(to);
    if (!p) this.pending.set(to, (p = { bytes: new Uint8Array(2048), length: 0, tag, events: 0 }));
    // Another match's events never share a batch; a batch that would outgrow one frame leaves first.
    if (p.length > 0 && (p.tag !== tag || p.length + size > this.maxBytes)) this.out(to, p);
    if (p.length === 0) {
      p.tag = tag;
      p.bytes[0] = BATCH_MAGIC;
      p.bytes[1] = tag & 0xff; p.bytes[2] = (tag >>> 8) & 0xff; p.bytes[3] = (tag >>> 16) & 0xff; p.bytes[4] = tag >>> 24;
      p.length = BATCH_HEAD;
    }
    if (p.length + size > p.bytes.length) {
      const grown = new Uint8Array(Math.max(p.length + size, p.bytes.length * 2));
      grown.set(p.bytes.subarray(0, p.length));
      p.bytes = grown;
    }
    p.bytes.set(record.bytes.subarray(record.start, record.end), p.length);
    p.length += size;
    p.events++;
  }

  private out(to: string, p: Pending): void {
    const batch = p.bytes.slice(0, p.length);
    this.stats.batches++;
    this.stats.events += p.events;
    this.stats.bytes += p.length;
    p.length = p.events = 0;
    this.send(batch, to);
  }

  /** Sends what is queued, a message per peer. */
  flush(gate?: (to: string, bytes: number) => boolean): void {
    for (const [to, p] of this.pending) {
      if (p.length === 0) continue;
      if (gate && !gate(to, p.length)) {
        this.stats.discarded += p.events;
        p.length = p.events = 0;
        continue;
      }
      this.out(to, p);
    }
  }

  /** Bytes queued for `to` and not yet flushed. */
  queued(to: string): number { return this.pending.get(to)?.length ?? 0; }
  get waiting(): boolean {
    for (const p of this.pending.values()) if (p.length > 0) return true;
    return false;
  }
  /** A peer that is gone: what was queued for it goes with it. */
  forget(to: string): void { this.pending.delete(to); }
}

const view = (data: unknown): Uint8Array | null => (data instanceof Uint8Array ? data : data instanceof ArrayBuffer ? new Uint8Array(data) : null);

/** The match tag of a batch message, or null if `data` is not one. */
export function batchTag(data: unknown): number | null {
  const bytes = view(data);
  if (!bytes || bytes.byteLength < BATCH_HEAD || bytes[0] !== BATCH_MAGIC) return null;
  return (bytes[1]! | (bytes[2]! << 8) | (bytes[3]! << 16) | (bytes[4]! << 24)) >>> 0;
}

/**
 * Hands each whole record of a batch to `each`, in order: its kind, its payload (a view into `data`) and its size on the
 * wire. Stops at the first record that is cut short. Returns how many it handed over. `each` may return false to stop.
 */
export function readBatch(data: unknown, each: (kind: number, payload: Uint8Array, size: number) => boolean | void): number {
  const bytes = view(data);
  if (!bytes || batchTag(bytes) === null) return 0;
  let at = BATCH_HEAD, count = 0;
  const end = bytes.byteLength;
  while (at < end) {
    const start = at;
    const kind = bytes[at++]!;
    let length = 0, shift = 0, more = true;
    while (more) {
      if (at >= end || shift > 21) return count;
      const byte = bytes[at++]!;
      length |= (byte & 0x7f) << shift;
      shift += 7;
      more = byte >= 0x80;
    }
    if (at + length > end) return count;
    count++;
    if (each(kind, bytes.subarray(at, at + length), at + length - start) === false) return count;
    at += length;
  }
  return count;
}

/** One JSON record's value, or undefined if it is not JSON. */
export function readJson(payload: Uint8Array): unknown {
  try { return JSON.parse(decoder.decode(payload)); } catch { return undefined; }
}

/** Every event in a batch message, read with `packer` where one is given. For tests and tools: the game reads with `readBatch`. */
export function unbatch<T = unknown>(data: unknown, packer?: Packer<T>): T[] {
  const events: T[] = [];
  readBatch(data, (kind, payload) => {
    const event = kind === KIND_JSON ? readJson(payload) : packer?.unpack(kind, payload) ?? undefined;
    if (event !== undefined) events.push(event as T);
  });
  return events;
}

/** A batch message holding `events` for the match `matchId`, as a page of that match would send it. For tests and tools. */
export function batchOf<T = unknown>(matchId: string, events: readonly T[], packer?: Packer<T>): Uint8Array {
  let made: Uint8Array = new Uint8Array(0);
  const writer = new RecordWriter<T>(packer);
  const batcher = new Batcher(batch => { made = batch; }, Infinity);
  const tag = matchTag(matchId);
  for (const event of events) {
    const record = writer.encode(event);
    if (record) batcher.add(record, 'x', tag);
  }
  batcher.flush();
  if (made.byteLength === 0) {
    made = new Uint8Array(BATCH_HEAD);
    made[0] = BATCH_MAGIC;
    made[1] = tag & 0xff; made[2] = (tag >>> 8) & 0xff; made[3] = (tag >>> 16) & 0xff; made[4] = tag >>> 24;
  }
  return made;
}

/** The first event of a batch message (a page that is not batching sends one event a message), or undefined. For tests. */
export const eventOf = <T = unknown>(data: unknown, packer?: Packer<T>): T => unbatch<T>(data, packer)[0] as T;
