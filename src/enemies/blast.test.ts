/** The rings as arithmetic. Crowds here stand the way the Test Range sheet stands them, and take a grenade's real numbers. */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { mulberry32 } from '../core/math';
import { TUNING, EXPLOSIONS } from '../weapons/data';
import { BLAST, OUTCOME_COUNT, OUTCOMES, rollBlast, tearsWaist, type BlastBody, type BlastOutcome, type BlastRoll } from './blast';

const out = (): BlastRoll => ({ outcome: 'thrown', amount: 0, fatal: false });
const flesh = (hp = 70): BlastBody => ({ health: hp, maxHealth: hp, machine: false, fireproof: false });
const G = TUNING.grenade;

/** What a blast does to a body this far out, the same sum Combat does. */
const splash = (reach: number) => G.damage * (1 - reach * (1 - EXPLOSIONS.grenade.edgeDamage));

/** A crowd of `n` round the grenade, out to `spread` metres. Returns how each body went. */
function crowd(n: number, spread: number, rng: () => number, hp = 70): BlastRoll[] {
  const seen = new Uint8Array(OUTCOME_COUNT);
  const rolls: BlastRoll[] = [];
  for (let i = 0; i < n; i++) {
    const reach = (Math.sqrt(rng()) * spread) / G.radius;
    rolls.push({ ...rollBlast(flesh(hp), 'grenade', reach, splash(reach), seen, out(), rng) });
  }
  return rolls;
}

describe('the rings', () => {
  it('only the fireball gibs, and only what it kills', () => {
    const seen = new Uint8Array(OUTCOME_COUNT);
    const [fireball, maim] = BLAST.rings.grenade;
    expect(rollBlast(flesh(), 'grenade', fireball * 0.5, 180, seen, out()).outcome).toBe('gib');
    expect(rollBlast(flesh(2000), 'grenade', fireball * 0.5, 180, seen, out()).outcome).not.toBe('gib');
    for (let i = 0; i < 400; i++) {
      seen.fill(0);
      expect(rollBlast(flesh(), 'grenade', (fireball + maim) / 2, 150, seen, out()).outcome).not.toBe('gib');
      seen.fill(0);
      expect(rollBlast(flesh(), 'grenade', 0.9, 110, seen, out()).outcome).not.toBe('gib');
    }
  });

  it('the middle ring is usually fatal, or nearly', () => {
    const rng = mulberry32(5);
    const reach = 0.42;
    let dead = 0;
    let nearly = 0;
    const seen = new Uint8Array(OUTCOME_COUNT);
    for (let i = 0; i < 1000; i++) {
      seen.fill(0);
      const r = rollBlast(flesh(), 'grenade', reach, splash(reach), seen, out(), rng);
      if (r.fatal) dead++;
      else if (70 - r.amount <= 70 * BLAST.spared[1] + 1) nearly++;
    }
    expect(dead).toBeGreaterThan(450);
    expect(dead + nearly).toBeGreaterThan(950);
  });

  it('a healthy body lives through the outer ring however big the blast, and a nearly dead one does not', () => {
    const rng = mulberry32(6);
    const seen = new Uint8Array(OUTCOME_COUNT);
    for (let i = 0; i < 500; i++) {
      seen.fill(0);
      const r = rollBlast(flesh(), 'grenade', 0.85, 400, seen, out(), rng);
      expect(r.fatal).toBe(false);
      expect(r.amount).toBeLessThan(70 * BLAST.tossHurt[1] + 0.01);
      expect(OUTCOMES[r.outcome].ends).toBeFalsy();
    }
    seen.fill(0);
    const worn: BlastBody = { ...flesh(), health: 5 };
    expect(rollBlast(worn, 'grenade', 0.85, 95, seen, out(), rng).amount).toBeGreaterThanOrEqual(5);
  });

  it('Hellfire still kills everything in reach', () => {
    const rng = mulberry32(7);
    const seen = new Uint8Array(OUTCOME_COUNT);
    for (const reach of [0.4, 0.6, 0.95]) {
      seen.fill(0);
      expect(rollBlast(flesh(), 'hellfire', reach, 99999, seen, out(), rng).fatal).toBe(true);
    }
  });

  it('a blast that hardly hurts a big body cannot tear it in two', () => {
    const rng = mulberry32(8);
    const seen = new Uint8Array(OUTCOME_COUNT);
    for (let i = 0; i < 1000; i++) {
      seen.fill(0);
      const r = rollBlast(flesh(800), 'rocket', 0.4, 80, seen, out(), rng);
      expect(['waist', 'head', 'gib']).not.toContain(r.outcome);
    }
  });

  it('machines lose parts and spark, and never bleed, burn or come apart at the waist', () => {
    const rng = mulberry32(9);
    const machine: BlastBody = { ...flesh(22), machine: true };
    const seen = new Uint8Array(OUTCOME_COUNT);
    const got = new Set<BlastOutcome>();
    for (let i = 0; i < 400; i++) {
      seen.fill(0);
      got.add(rollBlast(machine, 'grenade', 0.3 + rng() * 0.7, 120, seen, out(), rng).outcome);
    }
    expect([...got].sort()).toEqual(['parts', 'sparks']);
  });

  it('nothing fireproof is rolled alight', () => {
    const rng = mulberry32(10);
    const seen = new Uint8Array(OUTCOME_COUNT);
    for (let i = 0; i < 1000; i++) {
      seen.fill(0);
      const r = rollBlast({ ...flesh(), fireproof: true }, 'grenade', rng(), 120, seen, out(), rng);
      expect(OUTCOMES[r.outcome].fire).toBeUndefined();
    }
  });
});

describe('a crowd', () => {
  it('never goes all one way, over 100 blasts', () => {
    const rng = mulberry32(11);
    const totals = new Map<BlastOutcome, number>();
    let bodies = 0;
    for (let i = 0; i < 100; i++) {
      const rolls = crowd(12, 5.5, rng);
      const kinds = new Map<BlastOutcome, number>();
      for (const r of rolls) {
        kinds.set(r.outcome, (kinds.get(r.outcome) ?? 0) + 1);
        totals.set(r.outcome, (totals.get(r.outcome) ?? 0) + 1);
        bodies++;
      }
      expect(kinds.size).toBeGreaterThanOrEqual(5);
      expect(Math.max(...kinds.values())).toBeLessThanOrEqual(6);
    }
    for (const count of totals.values()) expect(count / bodies).toBeLessThan(0.3);
    expect((totals.get('gib') ?? 0) / bodies).toBeLessThan(0.25);
  });

  it('a second blast does not remember the first', () => {
    const rng = mulberry32(12);
    const first = crowd(12, 5.5, rng).map(r => r.outcome);
    const second = crowd(12, 5.5, rng).map(r => r.outcome);
    expect(first).not.toEqual(second);
  });
});

describe('a point-blank shotgun', () => {
  const d = (force: number) => ({ amount: 20, type: 'pellet' as const, point: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, 1), force, source: 'shotgun' });

  it('can tear a body at the waist, and only up close and only through the trunk', () => {
    const rng = () => 0;
    expect(tearsWaist(d(118), 'abdomen', 118, rng)).toBe(true);
    expect(tearsWaist(d(118), 'chest', 118, rng)).toBe(true);
    expect(tearsWaist(d(18), 'abdomen', 18, rng)).toBe(false);
    expect(tearsWaist(d(118), 'legL', 118, rng)).toBe(false);
    expect(tearsWaist({ ...d(118), type: 'bullet' }, 'abdomen', 118, rng)).toBe(false);
  });

  it('does not do it every time', () => {
    expect(tearsWaist(d(118), 'abdomen', 118, () => 0.9)).toBe(false);
  });
});
