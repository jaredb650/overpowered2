/** `pickTarget` (targeting.ts) is the allocation-free twin of `selectTarget` (authority.ts): the two must always agree. */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import * as THREE from 'three';
import { selectTarget } from '../authority';
import { pickTarget } from './targeting';

describe('an enemy\'s pick of a player, by property', () => {
  it('is the pick the rule in authority.ts makes, for any players, any place and any earlier pick', () => {
    const coordinate = fc.double({ min: -500, max: 500, noNaN: true });
    const players = fc.uniqueArray(fc.record({ id: fc.constantFrom('host', 'a', 'b', 'c'), alive: fc.boolean(), at: fc.tuple(coordinate, coordinate, coordinate) }), { maxLength: 4, selector: p => p.id });
    fc.assert(fc.property(players, fc.tuple(coordinate, coordinate, coordinate), fc.option(fc.constantFrom('host', 'a', 'b', 'c', 'gone'), { nil: undefined }), (list, from, previous) => {
      const want = selectTarget(from, list.map(p => ({ id: p.id, alive: p.alive, position: p.at })), previous);
      const got = pickTarget(new THREE.Vector3(...from), list.map(p => ({ id: p.id, player: { alive: p.alive, position: new THREE.Vector3(...p.at) } })), previous);
      expect(got?.id).toBe(want?.id);
    }), { numRuns: 500 });
  });
});
