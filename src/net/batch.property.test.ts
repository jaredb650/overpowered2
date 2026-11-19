/**
 * Property tests for the reliable lane's envelope (batch.ts): what holds for any events, any split, any junk.
 * How to add one: docs/notes/coop.md, "Testing".
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { BATCH_HEAD, Batcher, RecordWriter, batchOf, batchTag, matchTag, readBatch, unbatch, type Packer } from './batch';

/** What JSON keeps of a value: the wire's precision for an event sent as text. */
const asJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const event = fc.record({ t: fc.string({ maxLength: 8 }), n: fc.double({ noNaN: true, noDefaultInfinity: true }), s: fc.string({ maxLength: 40 }),
  v: fc.array(fc.double({ noNaN: true, noDefaultInfinity: true }), { maxLength: 6 }), o: fc.option(fc.jsonValue({ maxDepth: 2 }), { nil: undefined }) });
const events = fc.array(event, { maxLength: 40 });
const matchId = fc.oneof(fc.uuid(), fc.string({ maxLength: 40 }));

/** A packer with one packed form: `{ t: 'p', a, b }` as two bytes. Everything else is JSON. */
const packer: Packer<unknown> = {
  pack(value, into, at) {
    const e = value as { t?: unknown; a?: unknown; b?: unknown };
    if (!e || e.t !== 'p' || !Number.isInteger(e.a) || !Number.isInteger(e.b) || (e.a as number) < 0 || (e.a as number) > 255 || (e.b as number) < 0 || (e.b as number) > 255) return null;
    into[at] = e.a as number; into[at + 1] = e.b as number;
    return [7, at + 2];
  },
  unpack: (kind, payload) => (kind === 7 && payload.byteLength === 2 ? { t: 'p', a: payload[0], b: payload[1] } : null),
};

describe('the event batch, by property', () => {
  it('gives back every event, in order, at the precision JSON keeps, with its match tag', () => {
    fc.assert(fc.property(matchId, events, (id, list) => {
      const batch = batchOf(id, list);
      expect(batchTag(batch)).toBe(matchTag(id));
      expect(unbatch(batch)).toEqual(asJson(list));
    }));
  });

  it('keeps the order for every peer whatever the size a batch may grow to, and never sends a batch over that size unless one event is', () => {
    const plan = fc.record({ max: fc.integer({ min: 16, max: 600 }), sends: fc.array(fc.tuple(event, fc.subarray(['a', 'b', 'c'], { minLength: 1 })), { maxLength: 50 }),
      flushAfter: fc.array(fc.nat(50), { maxLength: 6 }) });
    fc.assert(fc.property(plan, ({ max, sends, flushAfter }) => {
      const got: Record<string, unknown[]> = { a: [], b: [], c: [] };
      const want: Record<string, unknown[]> = { a: [], b: [], c: [] };
      const sizes: number[] = [];
      const batcher = new Batcher((batch, to) => {
        const read = unbatch(batch);
        if (read.length > 1) sizes.push(batch.byteLength);
        got[to]!.push(...read);
      }, max);
      const writer = new RecordWriter<unknown>();
      sends.forEach(([e, peers], i) => {
        const record = writer.encode(e)!;
        for (const peer of peers) { batcher.add(record, peer, 1); want[peer]!.push(asJson(e)); }
        if (flushAfter.includes(i)) batcher.flush();
      });
      batcher.flush();
      expect(got).toEqual(want);
      expect(batcher.waiting).toBe(false);
      for (const size of sizes) expect(size).toBeLessThanOrEqual(max);
    }));
  });

  it('carries packed and JSON events side by side, each read back as it was sent', () => {
    const mixed = fc.array(fc.oneof(event, fc.record({ t: fc.constant('p'), a: fc.integer({ min: 0, max: 255 }), b: fc.integer({ min: 0, max: 255 }) }),
      fc.record({ t: fc.constant('p'), a: fc.integer({ min: 256, max: 9999 }), b: fc.constant(1) })), { maxLength: 30 });
    fc.assert(fc.property(mixed, list => {
      expect(unbatch(batchOf('m', list, packer), packer)).toEqual(asJson(list));
    }));
  });

  it('a batch cut short anywhere never throws and gives a prefix of what was sent', () => {
    fc.assert(fc.property(events, fc.nat(), (list, cut) => {
      const batch = batchOf('m', list);
      const short = batch.subarray(0, cut % (batch.byteLength + 1));
      const read = unbatch(short);
      expect(read).toEqual(asJson(list).slice(0, read.length));
      if (short.byteLength < BATCH_HEAD) expect(batchTag(short)).toBeNull();
    }));
  });

  it('junk and damaged bytes never throw: they read as nothing, or as values', () => {
    fc.assert(fc.property(fc.uint8Array({ maxLength: 300 }), bytes => {
      expect(() => unbatch(bytes, packer)).not.toThrow();
      expect(() => readBatch(bytes, () => {})).not.toThrow();
    }));
    fc.assert(fc.property(events, fc.array(fc.tuple(fc.nat(), fc.integer({ min: 0, max: 255 })), { minLength: 1, maxLength: 8 }), (list, damage) => {
      const batch = batchOf('m', list, packer);
      for (const [at, byte] of damage) batch[at % batch.byteLength] = byte;
      let read: unknown[] = [];
      expect(() => { read = unbatch(batch, packer); }).not.toThrow();
      expect(read.length).toBeLessThanOrEqual(batch.byteLength);
    }));
    for (const junk of [null, undefined, 7, 'batch', {}, [], { match: 'm', data: { t: 'hit' } }, new ArrayBuffer(0), new Uint8Array([0xb1])]) {
      expect(unbatch(junk)).toEqual([]);
      expect(batchTag(junk)).toBeNull();
    }
  });
});
