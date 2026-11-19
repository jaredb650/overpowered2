/**
 * Property tests for the world event router and the wire helpers (router.ts, wire.ts): what holds for any event, any junk and
 * any delivery order. How to add one: docs/notes/coop.md, "Testing".
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import * as THREE from 'three';
import type { DamageInfo } from '../../core/contracts';
import type { WorldEvent } from '../worldProtocol';
import { Router, type EventType } from './router';
import { ENEMY_IDS, packDamage, REGIONS, validVec } from './wire';

/** Event type names: ones the game uses, names that trip a plain object used as a map, and anything else. */
const typeName = fc.oneof(
  fc.constantFrom('fire', 'hit', 'kill', 'boom', 'kata', 'wave'),
  fc.constantFrom('constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf', ''),
  fc.string({ maxLength: 12 }),
);
const side = fc.constantFrom<'host' | 'guest' | 'both'>('host', 'guest', 'both');
const event = (t: string, n: number) => ({ t, n }) as unknown as WorldEvent;

describe('the world event router, by property', () => {
  it('gives every event to the one handler registered for its type and side, in arrival order, and drops the rest', () => {
    const plan = fc.record({
      registered: fc.uniqueArray(fc.tuple(typeName, side), { maxLength: 12, selector: ([t]) => t }),
      // Arrival is whatever the network did: any order, the same event twice, types nobody registered.
      arrivals: fc.array(fc.tuple(typeName, fc.boolean(), fc.string({ maxLength: 6 }), fc.double({ noNaN: true })), { maxLength: 60 }),
    });
    fc.assert(fc.property(plan, ({ registered, arrivals }) => {
      const router = new Router();
      const heard: string[] = [];
      const want: string[] = [];
      for (const [t, where] of registered) {
        const handler = (hears: string) => (e: WorldEvent, from: string, now: number) => { heard.push(`${hears}|${e.t}|${(e as unknown as { n: number }).n}|${from}|${now}`); };
        if (where === 'both') router.both(t as EventType, handler('both'));
        else router[where](t as EventType, handler(where));
      }
      arrivals.forEach(([t, hosting, from, now], n) => {
        const match = registered.find(([name, where]) => name === t && (where === 'both' || where === (hosting ? 'host' : 'guest')));
        if (match) want.push(`${match[1]}|${t}|${n}|${from}|${now}`);
        expect(() => router.dispatch(event(t, n), from, hosting, now)).not.toThrow();
        // The same event again is handed over again: the router keeps no memory; dropping repeats is the handler's job.
      });
      expect(heard).toEqual(want);
    }));
  });

  it('refuses a second handler for a type on a side, however the two were registered', () => {
    fc.assert(fc.property(typeName, side, side, (t, first, second) => {
      const router = new Router();
      const add = (where: 'host' | 'guest' | 'both') => router[where](t as EventType, () => {});
      add(first);
      const clash = first === 'both' || second === 'both' || first === second;
      if (clash) expect(() => add(second)).toThrow(/Two handlers/);
      else expect(() => add(second)).not.toThrow();
    }));
  });
});

describe('wire helpers, by property', () => {
  it('validVec never throws and says yes only to three finite numbers within ±100000', () => {
    fc.assert(fc.property(fc.anything({ withTypedArray: true, withBigInt: true }), value => {
      const model = Array.isArray(value) && value.length === 3 && value.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 100000);
      expect(validVec(value)).toBe(model);
    }));
    const number = fc.oneof(fc.double(), fc.constantFrom(NaN, Infinity, -Infinity, 100000, -100000, 100000.0001, 0, -0));
    fc.assert(fc.property(fc.array(fc.oneof(number, fc.string(), fc.constant(null)), { maxLength: 5 }), value => {
      const model = value.length === 3 && value.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 100000);
      expect(validVec(value)).toBe(model);
    }));
  });

  it('packDamage turns vectors into plain triples that survive the JSON wire, and changes nothing else', () => {
    const coord = fc.double({ min: -100000, max: 100000, noNaN: true });
    const triple = fc.tuple(coord, coord, coord);
    const damage = fc.record({
      amount: fc.double({ min: 0, max: 99999, noNaN: true }), type: fc.constantFrom('bullet', 'explosive', 'slash'), point: triple, dir: triple,
      force: fc.double({ min: 0, max: 5000, noNaN: true }), source: fc.string({ maxLength: 16 }),
      region: fc.option(fc.constantFrom(...REGIONS), { nil: undefined }), slice: fc.option(triple, { nil: undefined }),
      gib: fc.option(fc.boolean(), { nil: undefined }), severMult: fc.option(fc.double({ min: 0, max: 10, noNaN: true }), { nil: undefined }),
    });
    fc.assert(fc.property(damage, d => {
      const { slice, ...rest } = d;
      const info = { ...rest, point: new THREE.Vector3(...d.point), dir: new THREE.Vector3(...d.dir),
        ...(slice ? { slicePlaneNormal: new THREE.Vector3(...slice) } : {}) } as unknown as DamageInfo;
      const packed = packDamage(info);
      expect(packed.point).toEqual(d.point);
      expect(packed.dir).toEqual(d.dir);
      expect(packed.slicePlaneNormal).toEqual(slice);
      expect(validVec(packed.point) && validVec(packed.dir)).toBe(true);
      // The source object is untouched (it is still used by the shooter's own game).
      expect(info.point).toBeInstanceOf(THREE.Vector3);
      const wire = JSON.parse(JSON.stringify(packed)) as typeof packed;
      expect(validVec(wire.point) && validVec(wire.dir)).toBe(true);
      // -0 becomes 0 in JSON; nothing else moves.
      expect(wire.point.map(n => n + 0)).toEqual(d.point.map(n => n + 0));
      expect('slicePlaneNormal' in wire).toBe(slice !== undefined);
      for (const key of ['amount', 'type', 'force', 'source', 'region', 'gib', 'severMult'] as const) expect(wire[key]).toEqual(d[key]);
    }));
  });

  it('the id lists both ends index into have no repeats, so an index names one thing', () => {
    for (const list of [ENEMY_IDS, REGIONS] as const) {
      expect(new Set(list).size).toBe(list.length);
      fc.assert(fc.property(fc.integer({ min: 0, max: list.length - 1 }), i => { expect((list as readonly string[]).indexOf(list[i]!)).toBe(i); }));
    }
    // Sever masks are bit sets over REGIONS; they travel in 16 bits.
    expect(REGIONS.length).toBeLessThanOrEqual(16);
  });
});
