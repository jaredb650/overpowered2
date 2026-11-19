import { describe, expect, it } from 'vitest';
import { BATCH_HEAD, BATCH_MAGIC, BATCH_MAX_BYTES, Batcher, RecordWriter, batchOf, batchTag, eventOf, matchTag, readBatch, unbatch } from './batch';

describe('the reliable lane\'s envelope', () => {
  it('is five bytes a message and two a short event over its JSON, where the old form was 56 an event', () => {
    const event = { t: 'kata' };
    const batch = batchOf('1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed', [event]);
    expect(batch[0]).toBe(BATCH_MAGIC);
    expect(batch.byteLength).toBe(BATCH_HEAD + 2 + JSON.stringify(event).length);
    expect(JSON.stringify({ match: '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed', data: event }).length - JSON.stringify(event).length).toBe(56);
    expect(eventOf(batch)).toEqual(event);
  });

  it('encodes an event once for every recipient and says its size', () => {
    const writer = new RecordWriter<unknown>();
    const record = writer.encode({ t: 'boom', at: [1, 2, 3] })!;
    const size = record.end - record.start;
    expect(size).toBe(2 + JSON.stringify({ t: 'boom', at: [1, 2, 3] }).length);
    const sent: [string, Uint8Array][] = [];
    const batcher = new Batcher((batch, to) => sent.push([to, batch]));
    for (const peer of ['a', 'b', 'c']) batcher.add(record, peer, 9);
    expect(sent).toHaveLength(0);
    expect(batcher.queued('a')).toBe(BATCH_HEAD + size);
    batcher.flush();
    expect(sent.map(([to]) => to)).toEqual(['a', 'b', 'c']);
    expect(sent.every(([, batch]) => batch.byteLength === BATCH_HEAD + size && batchTag(batch) === 9)).toBe(true);
    // A flushed batch is its own copy: the next frame's events do not write over it.
    batcher.add(writer.encode({ t: 'other' })!, 'a', 9);
    batcher.flush();
    expect(unbatch(sent[0]![1])).toEqual([{ t: 'boom', at: [1, 2, 3] }]);
    expect(batcher.stats).toMatchObject({ batches: 4, events: 4 });
  });

  it('non-ASCII text, a long event and a value JSON cannot carry', () => {
    const long = { t: 'kit', text: 'é漢字🙂'.repeat(4000) };
    expect(unbatch(batchOf('m', [long, { t: 'after' }]))).toEqual([long, { t: 'after' }]);
    const writer = new RecordWriter<unknown>();
    expect(writer.encode(undefined)).toBeNull();
    expect(writer.encode(() => 1)).toBeNull();
    expect(unbatch(batchOf('m', []))).toEqual([]);
    expect(batchTag(batchOf('m', []))).toBe(matchTag('m'));
  });

  it('sends a full batch early, in order, and lets one oversize event travel alone', () => {
    const sent: Uint8Array[] = [];
    const batcher = new Batcher(batch => sent.push(batch));
    const writer = new RecordWriter<unknown>();
    const filler = { t: 'x', pad: 'p'.repeat(4000) };
    for (let i = 0; i < 5; i++) batcher.add(writer.encode({ ...filler, i })!, 'a', 1);
    // Three fit under the limit; the fourth starts a second batch.
    expect(sent).toHaveLength(1);
    expect(sent[0]!.byteLength).toBeLessThanOrEqual(BATCH_MAX_BYTES);
    batcher.add(writer.encode({ t: 'huge', pad: 'h'.repeat(40_000) })!, 'a', 1);
    batcher.add(writer.encode({ t: 'last' })!, 'a', 1);
    batcher.flush();
    const all = sent.flatMap(batch => unbatch<{ t: string; i?: number }>(batch));
    expect(all.map(e => e.t === 'x' ? e.i : e.t)).toEqual([0, 1, 2, 3, 4, 'huge', 'last']);
    expect(sent.filter(batch => batch.byteLength > BATCH_MAX_BYTES).map(batch => unbatch<{ t: string }>(batch).map(e => e.t))).toEqual([['huge']]);
  });

  it('never mixes two matches in one message, forgets a peer that left, and discards at a closed gate', () => {
    const sent: [string, number, unknown[]][] = [];
    const batcher = new Batcher((batch, to) => sent.push([to, batchTag(batch)!, unbatch(batch)]));
    const writer = new RecordWriter<unknown>();
    batcher.add(writer.encode({ t: 'old' })!, 'a', 1);
    batcher.add(writer.encode({ t: 'new' })!, 'a', 2);
    batcher.add(writer.encode({ t: 'gone' })!, 'b', 2);
    batcher.add(writer.encode({ t: 'shut' })!, 'c', 2);
    batcher.forget('b');
    batcher.flush(to => to !== 'c');
    expect(sent).toEqual([['a', 1, [{ t: 'old' }]], ['a', 2, [{ t: 'new' }]]]);
    expect(batcher.stats.discarded).toBe(1);
    expect(batcher.waiting).toBe(false);
  });

  it('stops reading when told to, and skips a record that is not JSON', () => {
    const batch = batchOf('m', [{ t: 'a' }, { t: 'b' }, { t: 'c' }]);
    const seen: number[] = [];
    expect(readBatch(batch, (kind, payload) => { seen.push(payload.byteLength); return seen.length < 2; })).toBe(2);
    // The second record's text is broken; the framing still holds, so the third is read.
    const broken = batch.slice();
    broken[BATCH_HEAD + 2 + 9 + 2] = 0x7d;
    expect(unbatch(broken)).toEqual([{ t: 'a' }, { t: 'c' }]);
  });
});
