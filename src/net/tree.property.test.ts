/**
 * Property tests for the packed tree (tree.ts) and the world's packer over it (world/pack.ts): what comes out is what JSON
 * would have carried, for anything; junk never throws. How to add one: docs/notes/coop.md, "Testing".
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { PACKED_ROOM } from './batch';
import { Words, decodeTree, encodeTree } from './tree';
import { WORDS, batchOf, unbatch, worldPacker } from './world/pack';

/** What JSON keeps of a value. */
const asJson = (value: unknown): unknown => JSON.parse(JSON.stringify(value));
/**
 * Two values are the same if they print as the same JSON: keys in the same order, every number the same double. (A deep
 * equality check that looks at `.constructor` is thrown by an entry of that name, which events may not have but junk may.)
 */
const same = (got: unknown, want: unknown): void => { expect(JSON.stringify(got)).toBe(JSON.stringify(want)); };
const room = new Uint8Array(200_000);
const pack = (value: unknown, words?: Words): Uint8Array | null => {
  const end = encodeTree(value, room, 3, room.length - 3, words);
  return end < 0 ? null : room.slice(3, end);
};

/** Numbers of every kind the lanes send: whole, rounded to millimetres or ten-thousandths, any double, and what JSON has no text for. */
const number = fc.oneof(
  fc.integer({ min: -200, max: 200 }), fc.integer(), fc.maxSafeInteger(),
  fc.integer({ min: -5_000_000, max: 5_000_000 }).map(n => n / 1000), fc.integer({ min: -10000, max: 10000 }).map(n => n / 10000),
  fc.integer({ min: -99999, max: 99999 }).map(n => n / 10), fc.integer({ min: -99999, max: 99999 }).map(n => n / 100),
  fc.double(), fc.float(), fc.constantFrom(0, -0, NaN, Infinity, -Infinity, 0.1 + 0.2, 1e21, -1e-7, 2 ** 31, -(2 ** 31), 2 ** 31 - 1, 127, 128, -16, -17),
);
const text = fc.oneof(fc.constantFrom(...WORDS.list.slice(0, 80), '', '__proto__', 'constructor', 'toString', 'é漢字🙂', 'a'.repeat(300)), fc.string({ maxLength: 20 }), fc.string({ unit: 'binary', maxLength: 12 }));
const leaf = fc.oneof(number, text, fc.boolean(), fc.constant(null), fc.constant(undefined));
const { tree } = fc.letrec(tie => ({
  tree: fc.oneof({ depthSize: 'small', withCrossShrink: true }, leaf, fc.array(tie('tree'), { maxLength: 20 }), fc.dictionary(text, tie('tree'), { maxKeys: 12 })),
}));

describe('the packed tree, by property', () => {
  it('reads back as exactly what JSON would have carried, with or without the word list', () => {
    fc.assert(fc.property(tree, value => {
      for (const words of [undefined, WORDS]) {
        const bytes = pack(value, words);
        if (JSON.stringify(value) === undefined) { expect(bytes).toBeNull(); continue; }
        expect(bytes).not.toBeNull();
        same(decodeTree(bytes!, words), asJson(value));
      }
    }), { numRuns: 400 });
  });

  it('is never larger than the JSON text of an event made of the lanes\' own kinds of value, and far smaller when the words are known', () => {
    const vec = fc.tuple(fc.integer({ min: -400_000, max: 400_000 }), fc.integer({ min: 0, max: 30_000 }), fc.integer({ min: -400_000, max: 400_000 })).map(v => v.map(n => n / 1000));
    const event = fc.record({ t: fc.constantFrom('fire', 'hitfx', 'kill', 'move'), weapon: fc.constantFrom('smg', 'buzzsaw', 'lance'), origin: vec, dir: vec, slot: fc.integer({ min: 0, max: 3 }),
      u: fc.integer({ min: 1, max: 5000 }), h: fc.integer({ min: 0, max: 20000 }), d: fc.array(fc.integer({ min: -127, max: 40000 }), { minLength: 14, maxLength: 17 }) });
    let packed = 0, json = 0;
    fc.assert(fc.property(event, e => {
      const bytes = pack(e, WORDS)!;
      const size = JSON.stringify(e).length;
      expect(bytes.byteLength).toBeLessThan(size);
      packed += bytes.byteLength; json += size;
    }));
    expect(packed / json).toBeLessThan(0.5);
  });

  it('junk, cut and damaged bytes never throw: they read as undefined or as a value', () => {
    fc.assert(fc.property(fc.uint8Array({ maxLength: 200 }), bytes => {
      expect(() => decodeTree(bytes, WORDS)).not.toThrow();
      expect(() => decodeTree(bytes)).not.toThrow();
    }), { numRuns: 1000 });
    fc.assert(fc.property(tree, fc.nat(), fc.array(fc.tuple(fc.nat(), fc.integer({ min: 0, max: 255 })), { maxLength: 6 }), (value, cut, damage) => {
      const bytes = pack(value, WORDS);
      if (!bytes || bytes.byteLength === 0) return;
      // Cut short: never a value (a tree is read whole or not at all).
      const short = bytes.subarray(0, cut % bytes.byteLength);
      expect(decodeTree(short, WORDS)).toBeUndefined();
      const broken = bytes.slice();
      for (const [at, byte] of damage) broken[at % broken.byteLength] = byte;
      expect(() => decodeTree(broken, WORDS)).not.toThrow();
    }), { numRuns: 300 });
  });

  it('declines what JSON would treat specially, and a value with no room, so those go as JSON', () => {
    class Thing { x = 1; }
    for (const odd of [new Thing(), new Date(0), { toJSON: () => 1 }, new Map(), new Uint8Array(2), 10n, { deep: new Thing() }, [new Date(0)], undefined, () => 1, Symbol('s')]) expect(pack(odd)).toBeNull();
    let deep: unknown = 1;
    for (let i = 0; i < 40; i++) deep = [deep];
    expect(pack(deep)).toBeNull();
    expect(encodeTree({ t: 'x', big: 'y'.repeat(5000) }, room, 0, 1000)).toBe(-1);
    expect(encodeTree([1, 2, 3], room, 0, 3)).toBe(-1);
    expect(encodeTree([1, 2, 3], room, 0, 4)).toBe(4);
    // Depth junk and a count the bytes cannot hold are refused, not allocated.
    expect(decodeTree(new Uint8Array(100).fill(0x81))).toBeUndefined();
    expect(decodeTree(new Uint8Array([0x9d, 0xff, 0xff, 0xff, 0xff, 0x0f]))).toBeUndefined();
    expect(decodeTree(new Uint8Array([0x91, 0x05, 0x05]))).toBeUndefined();
    expect(decodeTree(new Uint8Array([0xa8, 0xff]), new Words(['a']))).toBeUndefined();
  });

  it('an entry named __proto__ is an entry, never the object\'s prototype', () => {
    const got = decodeTree(pack(JSON.parse('{"__proto__":{"evil":true},"a":1}'))!) as Record<string, unknown>;
    expect(Object.getPrototypeOf(got)).toBe(Object.prototype);
    expect(Object.keys(got)).toEqual(['__proto__', 'a']);
    expect(({} as { evil?: boolean }).evil).toBeUndefined();
  });
});

describe('the world\'s events in a batch, by property', () => {
  it('any events, packed, batched and read back, are what JSON would have carried, in order; one the tree declines still arrives', () => {
    const event = fc.oneof(fc.dictionary(text, tree, { maxKeys: 10 }).map(o => ({ ...o, t: 'x' })), fc.constant({ t: 'odd', when: new Date(0) }));
    fc.assert(fc.property(fc.array(event, { maxLength: 30 }), list => {
      same(unbatch(batchOf('m', list)), asJson(list));
    }), { numRuns: 200 });
  });

  it('real events are about half their JSON, and the packer never needs more than its room', () => {
    const real = [
      { t: 'hitfx', u: 412, by: 1, h: 730, a: 0, f: [2, 0, 1, 0, 14, 3], d: [0, 7, 1, 12345, 1602, -30021, 54, -3, -114, 260, 200, 0, 7, 0] },
      { t: 'kill', uid: 412, id: 'husk', at: [12.345, 0, -30.021], yaw: 1.5708, gib: false, by: 2, head: true, k: 1043, d: [1, -1, -1, 12345, 1602, -30021, 54, -3, -114, 1300, 200, 1, 1, 0] },
      { t: 'fire', weapon: 'buzzsaw', origin: [12.345, 1.6, -30.021], dir: [0.1234, -0.0567, -0.9907], slot: 0, k: 'gun', f: 1 },
      { t: 'team', list: [0, 1, 2, 3].map(slot => ({ slot, state: 'up', bleed: 0, life: 1, hp: 100, max: 100, armor: 25, kills: 131, score: 48250, credits: 3120, downs: 0, revives: 0, ping: 34, cheats: false, menu: false, ok: true })) },
      { t: 'hit', shot: 5512, at: 183422.5, target: 412, weapon: 'shotgun', origin: [1.2345678901234, 1.6, -3.9876543210987], damage: { amount: 26, type: 'pellet', point: [12.34567890123, 1.602, -30.0211234], dir: [0.42, -0.02, -0.9], force: 20, source: 'shotgun', region: 'chest', bone: 7 } },
      { t: 'move', uid: 412, k: 'stagger', at: 183422, v: [0.4, 0, -0.9] },
    ];
    for (const event of real) {
      const bytes = pack(event, WORDS)!;
      expect(decodeTree(bytes, WORDS)).toStrictEqual(asJson(event));
      expect(bytes.byteLength / JSON.stringify(event).length, event.t).toBeLessThan(0.62);
    }
    const scratch = new Uint8Array(PACKED_ROOM + 16);
    expect(worldPacker.pack({ t: 'kit', kit: { text: 'k'.repeat(PACKED_ROOM) } } as never, scratch, 5)).toBeNull();
  });
});
