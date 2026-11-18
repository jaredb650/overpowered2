/**
 * The akimbo left gun and the left hand's own work (offhand.ts): a grenade, a call-in device, the sonar brain chip's visor tap and a
 * stim. For each, the left gun is down (`leftGunAway`) at least as far as the hand has left it, all the way down at the height of
 * it, and back up after. No third hand.
 */
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { Kit } from './kit/kit';
import type { VmMaterials } from './kit/materials';
import { buildOffhand } from './models';
import { Offhand, leftGunAway } from './offhand';

let hand: Offhand;
const DT = 1 / 60;
/** The left gun's height, carried from one stretch of play to the next. */
let away = 0;

beforeAll(() => {
  const ctx2d = new Proxy({}, { get: (_t, k) => (k === 'measureText' ? () => ({ width: 1 }) : () => {}), set: () => true });
  (globalThis as { document?: unknown }).document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }) };
  const material = new THREE.MeshStandardMaterial();
  const mats = {
    hard: material, decal: material, decalRegions: new Proxy({}, { get: () => [0, 0, 1, 1] }),
    glow(color: number) { const g = new THREE.MeshBasicMaterial({ color }); g.userData.base = g.color.clone(); return g; },
  } as unknown as VmMaterials;
  hand = new Offhand(buildOffhand(new Kit(mats)));
});

/** Runs `seconds` of the off hand, with `during` called on the frames given; the most the hand left, and the gun's height then. */
function play(seconds: number, during: Record<number, () => void> = {}): { peakHand: number; awayAtPeak: number; worst: number; away: number } {
  let peakHand = 0, awayAtPeak = 0, worst = 1;
  for (let f = 0; f < Math.round(seconds / DT); f++) {
    during[f]?.();
    hand.update(DT);
    away = leftGunAway(away, hand.leftWeight, DT);
    if (hand.leftWeight > peakHand) { peakHand = hand.leftWeight; awayAtPeak = away; }
    // The gun is never higher than the hand is off it.
    if (hand.leftWeight > 0.001) worst = Math.min(worst, away - hand.leftWeight);
  }
  return { peakHand, awayAtPeak, worst, away };
}

describe('the left gun while the left hand works', () => {
  const cases: [string, Record<number, () => void>, number][] = [
    ['grenade, cooked and thrown', { 0: () => hand.cook(), 30: () => hand.release() }, 2],
    ['call-in device, up and put away', { 0: () => hand.device('walkie'), 60: () => hand.device(null) }, 2.5],
    ['designator, up and put away', { 0: () => hand.device('designator'), 60: () => hand.device(null) }, 2.5],
    ['sonar brain chip visor tap', { 0: () => hand.tap() }, 1.5],
    ['stim, the heal', { 0: () => hand.inject() }, 3],
  ];
  for (const [name, during, seconds] of cases) {
    it(`is down for the ${name}, and back after`, () => {
      hand.reset();
      away = 0;
      const r = play(seconds, during);
      expect(r.peakHand, 'the hand left the gun').toBeGreaterThan(0.5);
      expect(r.awayAtPeak).toBeGreaterThanOrEqual(0.99);
      expect(r.worst).toBeGreaterThanOrEqual(-1e-9);
      // Home again: the hand is back and the gun has come up.
      const after = play(0.6);
      expect(hand.leftWeight).toBe(0);
      expect(after.away).toBeLessThan(0.05);
    });
  }

  it('comes up smoothly, not in one frame', () => {
    const down = leftGunAway(0, 1, DT);
    expect(down).toBe(1);
    expect(leftGunAway(down, 0, DT)).toBeGreaterThan(0.7);
  });
});
