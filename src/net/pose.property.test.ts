/**
 * Property tests for the pose lane (pose.ts): fast-check makes thousands of random poses, packets and delivery orders and
 * shrinks any failure to the smallest case. How to add one: docs/notes/coop.md, "Testing".
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { decodePose, encodePose, MOVES, PoseBuffer, type Pose } from './pose';

const f32 = (min: number, max: number) => fc.float({ min: Math.fround(min), max: Math.fround(max), noNaN: true });
const vec = (limit: number) => fc.tuple(f32(-limit, limit), f32(-limit, limit), f32(-limit, limit));
const weapon = fc.stringMatching(/^[a-zA-Z0-9_-]{1,32}$/);
/** A pose every field of which the wire accepts. Pitch stops short of π: see the edge test below. */
const pose: fc.Arbitrary<Pose> = fc.record({
  seq: fc.integer({ min: 0, max: 0xffffffff }),
  position: vec(10000),
  velocity: vec(1000),
  yaw: f32(-Math.PI * 2, Math.PI * 2),
  pitch: f32(-3.14, 3.14),
  move: fc.constantFrom(...MOVES),
  weapon,
  // The "doing" bits: one byte, and a pose with none set comes back without the field.
  flags: fc.option(fc.integer({ min: 0, max: 255 }), { nil: undefined }),
}, { requiredKeys: ['seq', 'position', 'velocity', 'yaw', 'pitch', 'move', 'weapon'] });
/** Bytes before the weapon name, read off the codec so a new header field does not break these tests. */
const HEADER = encodePose({ seq: 0, position: [0, 0, 0], velocity: [0, 0, 0], yaw: 0, pitch: 0, move: 'walk', weapon: 'smg' }, 0).byteLength - 3;
const slot = fc.integer({ min: 0, max: 3 });
const bytesOf = (data: ArrayBuffer) => [...new Uint8Array(data)];

describe('pose wire format, by property', () => {
  it('decode(encode(pose)) is the pose, with numbers at 32-bit float precision and nothing else changed', () => {
    fc.assert(fc.property(pose, slot, (p, s) => {
      const data = encodePose(p, s);
      expect(data.byteLength).toBe(HEADER + p.weapon.length);
      const back = decodePose(data);
      const { flags, ...rest } = p;
      expect(back).toEqual({ slot: s, pose: { ...rest, position: p.position.map(Math.fround), velocity: p.velocity.map(Math.fround),
        yaw: Math.fround(p.yaw), pitch: Math.fround(p.pitch), ...(flags ? { flags } : {}) } });
      // The quantization error of a 32-bit float at this size: under a millimetre at the far edge of any map.
      for (let i = 0; i < 3; i++) expect(Math.abs(back!.pose.position[i]! - p.position[i]!)).toBeLessThanOrEqual(0.0005);
      // A decoded pose encodes back to the same bytes: one pose, one packet.
      expect(bytesOf(encodePose(back!.pose, back!.slot))).toEqual(bytesOf(data));
    }));
  });

  it('reads the same pose from a view at any offset inside a larger buffer (how trystero delivers binary)', () => {
    fc.assert(fc.property(pose, slot, fc.integer({ min: 0, max: 64 }), fc.integer({ min: 0, max: 64 }), (p, s, before, after) => {
      const packet = new Uint8Array(encodePose(p, s));
      const big = new Uint8Array(before + packet.length + after).fill(0xa5);
      big.set(packet, before);
      expect(decodePose(big.subarray(before, before + packet.length))).toEqual(decodePose(packet));
    }));
  });

  it('encode never emits a packet the decoder refuses: any pose at all either throws or round trips', () => {
    const wild = fc.oneof(fc.double(), fc.constantFrom(NaN, Infinity, -Infinity, 1e9, Math.PI, -Math.PI, 10000, 10000.001));
    const anyPose = fc.record({
      seq: fc.oneof(fc.integer(), fc.double()), position: fc.tuple(wild, wild, wild), velocity: fc.tuple(wild, wild, wild),
      yaw: wild, pitch: wild, move: fc.oneof(fc.constantFrom(...MOVES), fc.string()), weapon: fc.oneof(weapon, fc.string({ maxLength: 40 })),
    });
    fc.assert(fc.property(anyPose, fc.oneof(slot, fc.integer(), fc.double()), (p, s) => {
      let data: ArrayBuffer;
      try { data = encodePose(p as Pose, s); } catch (e) { expect((e as Error).message).toBe('Invalid pose'); return; }
      expect(decodePose(data)).not.toBeNull();
    }));
  });

  it('an edge worth knowing: a pitch of exactly ±π rounds past π as a 32-bit float, so it is refused, not sent', () => {
    const p: Pose = { seq: 1, position: [0, 0, 0], velocity: [0, 0, 0], yaw: 0, pitch: Math.PI, move: 'walk', weapon: 'smg' };
    expect(Math.fround(Math.PI)).toBeGreaterThan(Math.PI);
    expect(() => encodePose(p, 0)).toThrow('Invalid pose');
    expect(decodePose(encodePose({ ...p, pitch: Math.PI / 2 }, 0))?.pose.pitch).toBeCloseTo(Math.PI / 2, 6);
  });

  it('junk never throws: any value, any bytes', () => {
    fc.assert(fc.property(fc.anything({ withTypedArray: true, withBigInt: true, withMap: true, withSet: true }), junk => {
      const back = decodePose(junk);
      // Only bytes can ever be a pose (and random bytes that are one are checked just below).
      if (!(junk instanceof Uint8Array || junk instanceof ArrayBuffer)) expect(back).toBeNull();
    }));
    fc.assert(fc.property(fc.uint8Array({ maxLength: 120 }), bytes => {
      const back = decodePose(bytes);
      // Random bytes almost never make a pose; when they do it must be a real one.
      if (back) expect(bytesOf(encodePose(back.pose, back.slot))).toEqual([...bytes]);
    }));
  });

  it('a truncated or padded packet is refused, whatever the cut', () => {
    fc.assert(fc.property(pose, slot, fc.nat(), fc.integer({ min: 1, max: 40 }), (p, s, cut, extra) => {
      const packet = new Uint8Array(encodePose(p, s));
      expect(decodePose(packet.subarray(0, cut % packet.length))).toBeNull();
      const padded = new Uint8Array(packet.length + extra);
      padded.set(packet);
      expect(decodePose(padded)).toBeNull();
    }));
  });

  it('a damaged packet (any bytes overwritten) never throws, and is either refused or still a real pose', () => {
    const damage = fc.array(fc.tuple(fc.nat(), fc.integer({ min: 0, max: 255 })), { minLength: 1, maxLength: 6 });
    fc.assert(fc.property(pose, slot, damage, (p, s, hits) => {
      const packet = new Uint8Array(encodePose(p, s));
      for (const [at, value] of hits) packet[at % packet.length] = value;
      const back = decodePose(packet);
      if (!back) return;
      expect(back.slot).toBeLessThanOrEqual(3);
      expect(MOVES).toContain(back.pose.move);
      expect(back.pose.weapon).toMatch(/^[a-zA-Z0-9_-]{1,32}$/);
      expect([...back.pose.position, ...back.pose.velocity, back.pose.yaw, back.pose.pitch].every(Number.isFinite)).toBe(true);
      expect(bytesOf(encodePose(back.pose, back.slot))).toEqual([...packet]);
    }));
  });
});

describe('pose buffer under duplicate and out-of-order delivery, by property', () => {
  /** A stream of poses numbered base, base+1, ... (wrapping past 2^32), then delivered in any order with repeats. */
  const delivery = fc.record({
    base: fc.oneof(fc.integer({ min: 0, max: 0xffffffff }), fc.constantFrom(0xffffffff - 3, 0xfffffff0, 0)),
    order: fc.array(fc.integer({ min: 0, max: 60 }), { minLength: 1, maxLength: 120 }),
    gaps: fc.array(fc.integer({ min: 0, max: 80 }), { minLength: 120, maxLength: 120 }),
    samples: fc.array(fc.integer({ min: -50, max: 9000 }), { maxLength: 20 }),
  });
  const at = (index: number): Pose => ({ seq: 0, position: [index * 0.2, 1, -index * 0.1], velocity: [index, 0, 0], yaw: (index % 7) - 3,
    pitch: (index % 5) * 0.2 - 0.4, move: MOVES[index % MOVES.length]!, weapon: 'smg' });

  it('takes a pose only when it is newer than the last one taken; repeats and stragglers are dropped', () => {
    fc.assert(fc.property(delivery, ({ base, order, gaps }) => {
      const buffer = new PoseBuffer();
      let newest = -1;
      let now = 1000;
      order.forEach((index, i) => {
        now += gaps[i]!;
        const taken = buffer.push({ ...at(index), seq: (base + index) >>> 0 }, now);
        expect(taken).toBe(index > newest);
        newest = Math.max(newest, index);
        expect(buffer.latest()!.pose.seq).toBe((base + newest) >>> 0);
      });
    }));
  });

  it('sampling at any time never throws and never leaves the range of the poses that were taken', () => {
    fc.assert(fc.property(delivery, ({ base, order, gaps, samples }) => {
      const buffer = new PoseBuffer();
      expect(buffer.sample(0)).toBeNull();
      let now = 1000;
      const taken: Pose[] = [];
      order.forEach((index, i) => {
        now += gaps[i]!;
        const p = { ...at(index), seq: (base + index) >>> 0 };
        if (buffer.push(p, now)) taken.push(p);
      });
      const range = (axis: number) => [Math.min(...taken.map(p => p.position[axis]!)), Math.max(...taken.map(p => p.position[axis]!))];
      // Times only ever move forward on a real client.
      for (const t of [...samples].sort((a, b) => a - b)) {
        const s = buffer.sample(1000 + t);
        expect(s).not.toBeNull();
        for (let axis = 0; axis < 3; axis++) {
          const [low, high] = range(axis);
          expect(s!.position[axis]!).toBeGreaterThanOrEqual(low! - 1e-9);
          expect(s!.position[axis]!).toBeLessThanOrEqual(high! + 1e-9);
        }
        expect(Number.isFinite(s!.yaw) && Number.isFinite(s!.pitch)).toBe(true);
        expect(MOVES).toContain(s!.move);
      }
      // Long after the last arrival the buffer rests on the newest pose and calls it stale.
      expect(buffer.sample(now + 100000)!.seq).toBe(taken.at(-1)!.seq);
      expect(buffer.stale(now + 100000)).toBe(true);
    }));
  });
});
