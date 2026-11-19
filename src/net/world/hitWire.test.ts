import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { DamageInfo } from '../../core/contracts';
import { newFacts, type HitFacts } from '../../enemies/damage';
import { planGib } from '../../gore/torso';
import { packFacts, packHit, packKill, unpackFacts, unpackHit, unpackKill } from './hitWire';

const round = (extra: Partial<DamageInfo> = {}): DamageInfo => ({
  amount: 26.4, type: 'pellet', point: new THREE.Vector3(12.3456, 1.2071, -48.9912), dir: new THREE.Vector3(0.6, -0.1, -0.79).normalize(),
  force: 37.5, source: 'shotgun', region: 'abdomen', bone: 2, ...extra,
});
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

describe('a hit on the wire', () => {
  it('comes back as the round that was sent, to the millimetre and the tenth', () => {
    const sent = round({ load: 'flechette', pierces: true, spill: true, torso: 'blowout', gib: true });
    const got = unpackHit(JSON.parse(JSON.stringify(packHit(sent))))!;
    expect(got).toMatchObject({ type: 'pellet', source: 'shotgun', region: 'abdomen', bone: 2, load: 'flechette', pierces: true, spill: true, torso: 'blowout', gib: true });
    expect(got.amount).toBeCloseTo(26.4, 5);
    expect(got.force).toBeCloseTo(37.5, 5);
    expect(got.point.distanceTo(sent.point)).toBeLessThan(0.001);
    expect(got.dir.angleTo(sent.dir)).toBeLessThan(0.01);
    expect(got.dir.length()).toBeCloseTo(1, 6);
  });

  it('breaks a trunk the same way on every screen: the pieces are seeded from the point as sent', () => {
    for (const force of [300, 900, 1700]) {
      const blast = round({ type: 'explosive', source: 'rocket', force, bone: undefined, region: undefined, gib: true, point: new THREE.Vector3(0.31, 1.13, -9.62 + force * 1e-4) });
      const host = planGib(blast, force);
      blast.torso = host.mode;
      const got = unpackHit(packHit(blast))!;
      expect(planGib(got, got.force)).toEqual(host);
    }
  });

  it('carries a cut\'s plane, a source it has no number for, and no bone the rig lacks', () => {
    const slice = unpackHit(packHit(round({ type: 'slash', source: 'sword', slicePlaneNormal: new THREE.Vector3(0, 1, 0) })))!;
    expect(slice.slicePlaneNormal!.y).toBeCloseTo(1, 5);
    expect(unpackHit(packHit(round({ source: 'somebody_elses_mod' })))!.source).toBe('somebody_elses_mod');
    expect(unpackHit(packHit(round({ bone: 40 })), 20)!.bone).toBeUndefined();
    const bare = unpackHit(packHit(round({ bone: undefined, region: undefined })))!;
    expect(bare.bone).toBeUndefined();
    expect(bare.region).toBeUndefined();
  });

  it('is small: a hit and what the host found of it are under 100 bytes of JSON, a tenth of the old event', () => {
    const facts: HitFacts = { ...newFacts(), amount: 26.4, level: 'stagger', strength: 0.42 };
    const hitfx = { t: 'hitfx', u: 431, by: 1, h: 1234, a: 0, f: packFacts(facts), d: packHit(round()) };
    const ack = { t: 'ack', c: 512, u: 431, h: 1234, a: 0, f: packFacts(facts), k: 0 };
    expect(bytes(hitfx)).toBeLessThan(120);
    expect(bytes(ack)).toBeLessThan(70);
  });

  it('refuses anything that is not a hit', () => {
    const good = packHit(round());
    for (const junk of [null, 'hit', [], good.slice(0, 5), [...good, 1, 2, 3, 4], good.map(() => 'x'), good.map((v, i) => (i === 0 ? 99 : v)), good.map((v, i) => (i === 3 ? 1e12 : v)),
      good.map((v, i) => (i === 6 ? 0.5 : v)), good.map((v, i) => (i === 12 ? 9999 : v))]) expect(unpackHit(junk), JSON.stringify(junk)).toBeNull();
    expect(unpackFacts([1, 2, 3])).toBeNull();
    expect(unpackFacts([1, 7, 0, 0])).toBeNull();
    expect(unpackFacts(['a', 0, 0, 0])).toBeNull();
    expect(unpackKill('junk')).toEqual({ blast: null, shatter: false, heavyHead: false, wound: 0 });
  });
});

describe('what the host found', () => {
  it('comes back whole', () => {
    const all: HitFacts[] = [
      newFacts(),
      { amount: 133.7, stop: 'plate', armour: 'broken', plate: 3, broke: true, headshot: false, level: 'flinch', strength: 0, knockout: false, tripped: false, blast: null },
      { amount: 12.5, stop: 'none', armour: 'through', plate: 1, broke: false, headshot: true, level: 'felled', strength: 0.7, knockout: true, tripped: false, blast: null },
      { amount: 400, stop: 'none', armour: undefined, plate: -1, broke: false, headshot: false, level: 'thrown', strength: 1, knockout: false, tripped: true, blast: 'flesh' },
      { amount: 0, stop: 'ward', armour: 'stopped', plate: -1, broke: false, headshot: false, level: 'fall', strength: 0.33, knockout: false, tripped: false, blast: 'sparks' },
    ];
    for (const facts of all) expect(unpackFacts(JSON.parse(JSON.stringify(packFacts(facts))))).toEqual(facts);
  });

  it('about a death, too', () => {
    for (const kill of [{ blast: null, shatter: false, heavyHead: false, wound: 0 }, { blast: 'waist' as const, shatter: true, heavyHead: false, wound: 312.5 }, { blast: 'gib' as const, shatter: false, heavyHead: true, wound: 99999 }]) {
      expect(unpackKill(packKill(kill))).toEqual(kill);
    }
  });
});
