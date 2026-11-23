/**
 * A packed form for any event: the same tree of objects, arrays, numbers and strings JSON would carry, as bytes. It knows
 * nothing of what an event means, so every event type gets it and no module changes how it builds its events; what comes
 * out the far end is, value for value, what `JSON.parse(JSON.stringify(event))` gives. It is about half the size of the
 * text, because:
 *
 * - a key or a common word is one or two bytes from a list both ends hold (`Words`), not its letters in quotes;
 * - a whole number is one to five bytes, and 0 to 127 and -1 to -16 are one;
 * - a number with up to four decimals (a position in millimetres, a direction in ten-thousandths: what the lanes round
 *   to) is its digits as a whole number and a scale, not text; anything else is a 4- or 8-byte float, exactly.
 *
 * One byte says what follows:
 *
 *   00-7f  the whole number 0 to 127          b0-bf  the whole number -1 to -16
 *   80-8f  an array of 0 to 15 values         c0-ff  word 0 to 63
 *   90-97  an object of 0 to 7 entries        98 null, 99 false, 9a true
 *   9b f64, 9c f32 (little endian)            9d array, 9e object, 9f text: a count or byte length (LEB128) first
 *   a0-a4  a whole number (zigzag LEB128) divided by 1, 10, 100, 1000, 10000
 *   a8  word 64 to 319 (one byte more)        a9  word 320 and up (two bytes more, little endian)
 *
 * An object is its entries in order, each a key (a word or text) and a value. `encodeTree` gives up (returns -1, and the
 * event goes as JSON text) on anything JSON itself would treat specially: an object that is not a plain one, a `toJSON`,
 * a bigint, more than 32 levels, or not enough room. `decodeTree` never throws: bytes that are not a tree read as
 * `undefined`.
 */

/** The words both ends know by number. Both ends are the same build (the lobby refuses another), so the list may change freely. */
export class Words {
  private readonly index = new Map<string, number>();
  readonly list: readonly string[];
  constructor(words: readonly string[]) {
    const list: string[] = [];
    for (const word of words) if (!this.index.has(word)) { this.index.set(word, list.length); list.push(word); }
    this.list = list;
  }
  of(word: string): number | undefined { return this.index.get(word); }
}

const NO_WORDS = new Words([]);
const MAX_DEPTH = 32;
const POW = [1, 10, 100, 1000, 10000];
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const float = new DataView(new ArrayBuffer(8));
const has = Object.prototype.hasOwnProperty;

class Writer {
  bytes!: Uint8Array;
  at = 0;
  end = 0;
  ok = true;
  words = NO_WORDS;

  byte(value: number): void {
    if (this.at >= this.end) { this.ok = false; return; }
    this.bytes[this.at++] = value;
  }

  /** An unsigned whole number under 2^32, seven bits a byte, low first. */
  varint(value: number): void {
    while (value >= 0x80) { this.byte((value & 0x7f) | 0x80); value = Math.floor(value / 128); }
    this.byte(value);
  }

  text(value: string): void {
    const index = this.words.of(value);
    if (index !== undefined) {
      if (index < 64) this.byte(0xc0 + index);
      else if (index < 320) { this.byte(0xa8); this.byte(index - 64); }
      else { this.byte(0xa9); this.byte((index - 320) & 0xff); this.byte((index - 320) >> 8); }
      return;
    }
    // Worst case three bytes a UTF-16 unit, and five for the head.
    if (this.at + 6 + value.length * 3 > this.end) { this.ok = false; return; }
    const head = this.at;
    // Room for the length is left once the text's size is known: write the text first, a byte in, and move it if needed.
    const written = encoder.encodeInto(value, this.bytes.subarray(head + 2, this.end)).written;
    if (written < 0x80) {
      this.bytes[head] = 0x9f; this.bytes[head + 1] = written;
      this.at = head + 2 + written;
      return;
    }
    let size = 0;
    for (let n = written; n > 0; n = Math.floor(n / 128)) size++;
    this.bytes.copyWithin(head + 1 + size, head + 2, head + 2 + written);
    this.at = head;
    this.byte(0x9f); this.varint(written);
    this.at += written;
  }

  number(value: number): void {
    // JSON has no NaN and no infinities: they travel as null.
    if (!Number.isFinite(value)) return this.byte(0x98);
    if (Number.isInteger(value)) {
      if (value >= 0 && value <= 127) return this.byte(value);
      if (value < 0 && value >= -16) return this.byte(0xb0 - 1 - value);
      if (value > -0x80000000 && value < 0x80000000) { this.byte(0xa0); return this.varint(value < 0 ? -value * 2 - 1 : value * 2); }
    } else for (let d = 1; d <= 4; d++) {
      const whole = Math.round(value * POW[d]!);
      // Only when dividing gives the very same number back.
      if (whole > -0x80000000 && whole < 0x80000000 && whole / POW[d]! === value) { this.byte(0xa0 + d); return this.varint(whole < 0 ? -whole * 2 - 1 : whole * 2); }
    }
    const single = Math.fround(value) === value;
    if (this.at + 9 > this.end) { this.ok = false; return; }
    if (single) { float.setFloat32(0, value, true); this.byte(0x9c); for (let i = 0; i < 4; i++) this.bytes[this.at++] = float.getUint8(i); }
    else { float.setFloat64(0, value, true); this.byte(0x9b); for (let i = 0; i < 8; i++) this.bytes[this.at++] = float.getUint8(i); }
  }

  value(value: unknown, depth: number): void {
    if (!this.ok) return;
    switch (typeof value) {
      case 'number': return this.number(value);
      case 'string': return this.text(value);
      case 'boolean': return this.byte(value ? 0x9a : 0x99);
      // Inside an array JSON writes null for these; an object's are left out before this is reached.
      case 'undefined': case 'function': case 'symbol': return this.byte(0x98);
      case 'object': break;
      default: this.ok = false; return;
    }
    if (value === null) return this.byte(0x98);
    if (depth >= MAX_DEPTH) { this.ok = false; return; }
    if (Array.isArray(value)) {
      if (value.length < 16) this.byte(0x80 + value.length);
      else { this.byte(0x9d); this.varint(value.length); }
      for (let i = 0; i < value.length && this.ok; i++) this.value(value[i], depth + 1);
      return;
    }
    const proto = Object.getPrototypeOf(value) as unknown;
    const object = value as Record<string, unknown>;
    if ((proto !== Object.prototype && proto !== null) || typeof object.toJSON === 'function') { this.ok = false; return; }
    let count = 0;
    for (const key in object) if (has.call(object, key) && carried(object[key])) count++;
    if (count < 8) this.byte(0x90 + count);
    else { this.byte(0x9e); this.varint(count); }
    for (const key in object) {
      if (!this.ok) return;
      if (!has.call(object, key)) continue;
      const entry = object[key];
      if (!carried(entry)) continue;
      this.text(key);
      this.value(entry, depth + 1);
    }
  }
}

/** JSON leaves an object's entry out when its value is one of these. */
const carried = (value: unknown): boolean => value !== undefined && typeof value !== 'function' && typeof value !== 'symbol';

const writer = new Writer();

/**
 * Writes `value` into `into` from `at`, using no more than `room` bytes. Returns where it ended, or -1 if `value` is not
 * something this form carries exactly as JSON would (the caller then sends JSON).
 */
export function encodeTree(value: unknown, into: Uint8Array, at: number, room: number, words: Words = NO_WORDS): number {
  // At the top JSON has nothing to say for these at all.
  if (!carried(value)) return -1;
  writer.bytes = into; writer.at = at; writer.end = Math.min(into.length, at + room); writer.ok = true; writer.words = words;
  writer.value(value, 0);
  return writer.ok ? writer.at : -1;
}

class Reader {
  bytes!: Uint8Array;
  at = 0;
  ok = true;
  words = NO_WORDS;

  varint(): number {
    let value = 0, scale = 1;
    for (let i = 0; i < 5; i++) {
      if (this.at >= this.bytes.length) break;
      const byte = this.bytes[this.at++]!;
      value += (byte & 0x7f) * scale;
      if (byte < 0x80) return value;
      scale *= 128;
    }
    this.ok = false;
    return 0;
  }

  word(index: number): string {
    const word = this.words.list[index];
    if (word === undefined) { this.ok = false; return ''; }
    return word;
  }

  /** A key: a word or text, nothing else. */
  key(): string {
    const value = this.value(MAX_DEPTH);
    if (typeof value !== 'string') { this.ok = false; return ''; }
    return value;
  }

  value(depth: number): unknown {
    if (!this.ok || this.at >= this.bytes.length) { this.ok = false; return undefined; }
    const bytes = this.bytes;
    const tag = bytes[this.at++]!;
    if (tag < 0x80) return tag;
    if (tag >= 0xc0) return this.word(tag - 0xc0);
    if (tag >= 0xb0) return 0xb0 - 1 - tag;
    if (tag < 0x90) return this.array(tag - 0x80, depth);
    if (tag < 0x98) return this.object(tag - 0x90, depth);
    switch (tag) {
      case 0x98: return null;
      case 0x99: return false;
      case 0x9a: return true;
      case 0x9b: case 0x9c: {
        const size = tag === 0x9b ? 8 : 4;
        if (this.at + size > bytes.length) { this.ok = false; return undefined; }
        for (let i = 0; i < size; i++) float.setUint8(i, bytes[this.at++]!);
        const value = size === 8 ? float.getFloat64(0, true) : float.getFloat32(0, true);
        // A tree never holds one: a number JSON cannot carry was written as null.
        if (!Number.isFinite(value)) { this.ok = false; return undefined; }
        return value;
      }
      case 0x9d: return this.array(this.varint(), depth);
      case 0x9e: return this.object(this.varint(), depth);
      case 0x9f: {
        const length = this.varint();
        if (!this.ok || this.at + length > bytes.length) { this.ok = false; return undefined; }
        const start = this.at;
        this.at += length;
        try { return decoder.decode(bytes.subarray(start, start + length)); } catch { this.ok = false; return undefined; }
      }
      case 0xa0: case 0xa1: case 0xa2: case 0xa3: case 0xa4: {
        const zigzag = this.varint();
        const whole = zigzag % 2 === 1 ? -(zigzag + 1) / 2 : zigzag / 2;
        return tag === 0xa0 ? whole : whole / POW[tag - 0xa0]!;
      }
      case 0xa8:
        if (this.at >= bytes.length) { this.ok = false; return undefined; }
        return this.word(64 + bytes[this.at++]!);
      case 0xa9:
        if (this.at + 2 > bytes.length) { this.ok = false; return undefined; }
        this.at += 2;
        return this.word(320 + bytes[this.at - 2]! + bytes[this.at - 1]! * 256);
      default:
        this.ok = false;
        return undefined;
    }
  }

  private array(length: number, depth: number): unknown {
    // Every value is at least a byte, so a length the bytes cannot hold is junk (and is never allocated).
    if (!this.ok || depth >= MAX_DEPTH || length > this.bytes.length - this.at) { this.ok = false; return undefined; }
    const out: unknown[] = new Array<unknown>(length);
    for (let i = 0; i < length; i++) {
      out[i] = this.value(depth + 1);
      if (!this.ok) return undefined;
    }
    return out;
  }

  private object(count: number, depth: number): unknown {
    if (!this.ok || depth >= MAX_DEPTH || count * 2 > this.bytes.length - this.at) { this.ok = false; return undefined; }
    const out: Record<string, unknown> = {};
    for (let i = 0; i < count; i++) {
      const key = this.key();
      const value = this.value(depth + 1);
      if (!this.ok) return undefined;
      // As JSON.parse does it: an entry of its own, never the object's prototype.
      if (key === '__proto__') Object.defineProperty(out, key, { value, enumerable: true, writable: true, configurable: true });
      else out[key] = value;
    }
    return out;
  }
}

const reader = new Reader();

/** The value `bytes` stand for, or undefined if they are not exactly one tree. */
export function decodeTree(bytes: Uint8Array, words: Words = NO_WORDS): unknown {
  reader.bytes = bytes; reader.at = 0; reader.ok = true; reader.words = words;
  const value = reader.value(0);
  return reader.ok && reader.at === bytes.length ? value : undefined;
}
