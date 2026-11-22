/**
 * Property tests for two places where one bad value used to cost more than itself (review-net m4 and m9):
 * - the enemy snapshot: whatever numbers the host's game holds, the chunk it writes can be read; and a chunk with one
 *   record that no enemy can have gives every other record in it, not nothing;
 * - a guest's claim: whatever object arrives as its damage, what reaches the damage model holds only the fields a claim
 *   may set, each in its range.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import * as THREE from 'three';
import type { DamageInfo } from '../../core/contracts';
import { claimedDamage } from './claims';
import { ChunkReader, decodeChunk, encodeChunk, HEALTH_MOST, PLACE_MOST, sane, type EnemyFrame } from './snapshot';
import { ENEMY_IDS, packDamage, REGIONS } from './wire';

const HEADER = 16, MOTION = 27, FULL = 44;
/** Any number a broken game might hold: ordinary ones, the edges, and the three that are not numbers at all. */
const wild = fc.oneof(fc.double(), fc.constantFrom(NaN, Infinity, -Infinity, 1e300, -1e300, 3.5e38, -0, 1e-320), fc.integer({ min: -200000, max: 200000 }));
const tame = fc.double({ min: -500, max: 500, noNaN: true });

const frame = (uid: number, n: [number, number, number, number, number, number], full: boolean): EnemyFrame => ({
  uid, id: ENEMY_IDS[uid % ENEMY_IDS.length]!, position: [n[0], n[1], n[2]], velocity: [0, 0, 0], yaw: 0, health: n[3], maxHealth: n[4], armor: n[5],
  flags: 0, animation: 0, severed: 0, plates: 0, full,
});

describe('the enemy snapshot, by property', () => {
  it('whatever numbers the host holds, the chunk it writes is read whole, every record a number an enemy can have', () => {
    const enemies = fc.array(fc.tuple(fc.tuple(wild, wild, wild, wild, wild, wild), fc.boolean()), { minLength: 1, maxLength: 20 });
    fc.assert(fc.property(enemies, list => {
      const frames = list.map(([n, full], index) => frame(index + 1, n, full));
      const back = decodeChunk(encodeChunk({ time: 1, tick: 1, wave: 1, enemies: frames }));
      expect(back).not.toBeNull();
      expect(back!.enemies.map(e => e.uid)).toEqual(frames.map(f => f.uid));
      for (const e of back!.enemies) {
        for (const axis of e.position) expect(Number.isFinite(axis) && Math.abs(axis) <= PLACE_MOST).toBe(true);
        for (const n of [e.health, e.maxHealth, e.armor]) expect(Number.isFinite(n) && n >= 0 && n <= HEALTH_MOST).toBe(true);
      }
    }), { numRuns: 300 });
  });

  it('`sane` gives a finite number in the range for anything at all, and leaves a good one alone', () => {
    fc.assert(fc.property(wild, n => {
      const out = sane(n, -PLACE_MOST, PLACE_MOST);
      expect(Number.isFinite(out) && Math.abs(out) <= PLACE_MOST).toBe(true);
      if (Number.isFinite(n) && Math.abs(n) <= PLACE_MOST) expect(out).toBe(n);
    }));
  });

  it('one record with a number no enemy can have is passed over alone: the others in its chunk are all read', () => {
    const plan = fc.record({
      enemies: fc.array(fc.tuple(tame, tame, tame, fc.double({ min: 0, max: 5000, noNaN: true })), { minLength: 2, maxLength: 20 }),
      victim: fc.nat(),
      // Which field of the victim is broken (a place, its health, its largest health, its armour, its kind) and with what.
      field: fc.constantFrom(7, 11, 15, 32, 36, 40, 27),
      poison: fc.constantFrom(NaN, Infinity, -Infinity, 2e5, -1),
    });
    fc.assert(fc.property(plan, ({ enemies, victim, field, poison }) => {
      const frames = enemies.map(([x, y, z, health], index) => frame(index + 1, [x, y, z, health, 5000, 0], true));
      const bytes = new Uint8Array(encodeChunk({ time: 1, tick: 1, wave: 1, enemies: frames }));
      const which = victim % frames.length;
      const view = new DataView(bytes.buffer);
      const at = HEADER + which * FULL + field;
      // A place may be any finite number in range, so -1 is no poison there, and a health may be 200,000; a kind is a byte.
      const bad = field === 27 ? 255 : field < 27 && poison === -1 ? NaN : field > 27 && poison === 2e5 ? -Infinity : poison;
      if (field === 27) view.setUint8(at, bad);
      else view.setFloat32(at, bad, true);
      const reader = new ChunkReader();
      expect(reader.open(bytes)).not.toBeNull();
      const got: number[] = [];
      for (let e = reader.next(); e; e = reader.next()) {
        got.push(e.uid);
        expect(Number.isFinite(e.x + e.y + e.z + e.health + e.maxHealth + e.armor)).toBe(true);
      }
      expect(got).toEqual(frames.map(f => f.uid).filter(uid => uid !== which + 1));
      expect(reader.skipped).toBe(1);
    }), { numRuns: 300 });
  });

  it('a chunk of the wrong shape is still refused whole: cut short, or a uid twice', () => {
    const frames = [1, 2, 3].map(uid => frame(uid, [uid, 0, 0, 10, 10, 0], false));
    const bytes = new Uint8Array(encodeChunk({ time: 1, tick: 1, wave: 1, enemies: frames }));
    expect(bytes.byteLength).toBe(HEADER + 3 * MOTION);
    fc.assert(fc.property(fc.integer({ min: 1, max: bytes.byteLength - 1 }), cut => {
      expect(decodeChunk(bytes.slice(0, cut))).toBeNull();
    }));
    const twice = bytes.slice();
    new DataView(twice.buffer).setUint32(HEADER + MOTION, 1, true);
    expect(decodeChunk(twice)).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------

const ALLOWED = new Set(['amount', 'type', 'point', 'dir', 'force', 'source', 'region', 'bone', 'slicePlaneNormal', 'gib', 'pierces', 'armorPiercing',
  'vaporize', 'severMult', 'headshotMult', 'reach', 'blastKind', 'load', 'armour', 'explosionId', 'claim']);
const TYPES = ['bullet', 'pellet', 'explosive', 'slash', 'melee', 'fire', 'shock', 'crush', 'true'];
const anything = fc.anything({ maxDepth: 2 });
const vecish = fc.oneof(fc.tuple(wild, wild, wild), fc.tuple(tame, tame, tame), anything);

/** A claim's damage as a hostile or broken client might send it: the real fields with anything in them, and anything beside them. */
const hostile = fc.record({
  amount: fc.oneof(wild, anything), type: fc.oneof(fc.constantFrom(...TYPES), anything), point: vecish, dir: vecish,
  force: fc.oneof(wild, anything), source: fc.oneof(fc.string({ maxLength: 80 }), anything),
  region: fc.oneof(fc.constantFrom(...REGIONS), anything), bone: fc.oneof(fc.integer({ min: -5, max: 400 }), wild, anything),
  slicePlaneNormal: vecish, gib: anything, pierces: anything, armorPiercing: anything, vaporize: anything,
  severMult: fc.oneof(wild, anything), headshotMult: fc.oneof(wild, anything), reach: fc.oneof(wild, anything),
  blastKind: fc.oneof(fc.constantFrom('rocket', 'shell', 'nuke', 'constructor', '__proto__', 'toString'), anything),
  load: fc.oneof(fc.constantFrom('ap', 'hp', 'api', 'toString'), anything), armour: fc.oneof(fc.constantFrom('light', 'heavy', 'valueOf'), anything),
  explosionId: fc.oneof(fc.integer(), wild, anything), claim: fc.oneof(fc.integer({ min: -3, max: 70000 }), wild, anything),
  // The host's alone to set, or nothing a claim has at all.
  from: vecish, torso: fc.constantFrom('crack', 'waist', 'blowout'), spill: fc.boolean(), killed: fc.boolean(), then: anything, toString: anything,
}, { requiredKeys: [] });

describe('a claim\'s damage, by property', () => {
  it('whatever arrives, what reaches the damage model is null or holds only what a claim may set, each in its range', () => {
    fc.assert(fc.property(fc.oneof(hostile, anything), wire => {
      const d = claimedDamage(wire);
      if (d === null) return;
      for (const key of Object.keys(d)) expect(ALLOWED.has(key), key).toBe(true);
      expect(Object.getPrototypeOf(d)).toBe(Object.prototype);
      expect(Number.isFinite(d.amount) && d.amount > 0).toBe(true);
      expect(TYPES).toContain(d.type);
      for (const v of [d.point, d.dir]) expect(v instanceof THREE.Vector3 && Number.isFinite(v.x + v.y + v.z) && Math.abs(v.x) <= 100000).toBe(true);
      expect(d.force >= 0 && d.force <= 100000).toBe(true);
      expect(typeof d.source === 'string' && d.source.length <= 64).toBe(true);
      if (d.region !== undefined) expect(REGIONS).toContain(d.region);
      if (d.bone !== undefined) expect(Number.isInteger(d.bone) && d.bone >= 0 && d.bone <= 255).toBe(true);
      if (d.slicePlaneNormal) expect(d.slicePlaneNormal.length()).toBeCloseTo(1, 5);
      for (const flag of [d.gib, d.pierces, d.armorPiercing, d.vaporize]) expect(flag === undefined || flag === true).toBe(true);
      for (const n of [d.severMult, d.headshotMult, d.reach]) expect(n === undefined || (Number.isFinite(n) && n >= 0 && n <= 1000)).toBe(true);
      if (d.blastKind !== undefined) expect(['rocket', 'grenade', 'hellfire', 'hellfireBullet', 'shell', 'plasma', 'plasmaBurst', 'enemy', 'barrel', 'nuke', 'finisher', 'howitzer']).toContain(d.blastKind);
      if (d.load !== undefined) expect(['ap', 'hp', 'plusP', 'flechette', 'api', 'dragon']).toContain(d.load);
      if (d.armour !== undefined) expect(['light', 'medium', 'heavy']).toContain(d.armour);
      if (d.claim !== undefined) expect(Number.isInteger(d.claim) && d.claim >= 1 && d.claim <= 0xffff).toBe(true);
      const loose = d as unknown as Record<string, unknown>;
      for (const never of ['from', 'torso', 'spill', 'killed', 'then']) expect(never in loose).toBe(false);
    }), { numRuns: 600 });
  });

  it('an honest hit arrives as it was sent', () => {
    const honest = fc.record({
      amount: fc.double({ min: 0.5, max: 5000, noNaN: true }), type: fc.constantFrom(...TYPES), force: fc.double({ min: 0, max: 900, noNaN: true }),
      source: fc.constantFrom('smg', 'shotgun', 'warthog', 'sword_wave', 'grenade'), region: fc.option(fc.constantFrom(...REGIONS), { nil: undefined }),
      bone: fc.option(fc.integer({ min: 0, max: 60 }), { nil: undefined }), gib: fc.option(fc.constant(true), { nil: undefined }),
      severMult: fc.option(fc.double({ min: 0, max: 1000, noNaN: true }), { nil: undefined }), claim: fc.integer({ min: 1, max: 0xffff }),
      p: fc.tuple(tame, tame, tame), d: fc.tuple(tame, tame, tame),
    });
    fc.assert(fc.property(honest, h => {
      const sent: DamageInfo = { amount: h.amount, type: h.type as DamageInfo['type'], point: new THREE.Vector3(...h.p), dir: new THREE.Vector3(...h.d), force: h.force,
        source: h.source, region: h.region, bone: h.bone, gib: h.gib, severMult: h.severMult, claim: h.claim };
      // As the transport carries it: through JSON.
      const got = claimedDamage(JSON.parse(JSON.stringify(packDamage(sent))));
      expect(got).not.toBeNull();
      expect(got).toMatchObject({ amount: sent.amount, type: sent.type, force: sent.force, source: sent.source, claim: sent.claim });
      // (JSON has no minus zero.)
      expect(got!.point.toArray()).toEqual(sent.point.toArray().map(n => n + 0));
      expect(got!.dir.toArray()).toEqual(sent.dir.toArray().map(n => n + 0));
      expect(got!.region).toBe(sent.region);
      expect(got!.bone).toBe(sent.bone);
      expect(got!.gib).toBe(sent.gib);
      expect(got!.severMult).toBe(sent.severMult);
    }), { numRuns: 300 });
  });
});
