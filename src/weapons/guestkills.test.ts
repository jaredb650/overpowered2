/**
 * A co-op guest's enemies die on the host's word, so on a guest a hit's result never says `killed`: it says `killSoon`, the
 * guest's own guess (enemies/damage.ts). What a shot counts as its kills must go by that guess on a guest, or the Lance
 * never splits past its first body and never gets its kill stop there. Alone, a guess is never set and nothing changes.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { DamageResult } from '../core/gameplay';
import { makeRange } from './testkit';

const result = (extra: Partial<DamageResult>): DamageResult => ({ dealt: 50, killed: false, headshot: false, severed: [], blocked: false, ...extra });

describe('what a shot counts as its kills', () => {
  const fire = async (answer: Partial<DamageResult>) => {
    const r = await makeRange();
    r.enemies.add(0, -10, 100);
    r.enemies.applyDamage = () => result(answer);
    return r.combat.fireRay(new THREE.Vector3(0, 1.2, 0), new THREE.Vector3(0, 0, -1), { damage: 50, source: 'smg', team: 'player' });
  };

  it('a guest\'s guess at the kill counts as one, as the host\'s decision does', async () => {
    const guessed = await fire({ killSoon: true });
    expect(guessed.hitEnemy).toBe(true);
    expect(guessed.killed).toBe(true);
    expect(guessed.kills).toBe(1);
    const decided = await fire({ killed: true });
    expect(decided.kills).toBe(1);
  });

  it('a hit that is neither is not a kill, and a round into a body already reckoned dead says nothing', async () => {
    const hit = await fire({});
    expect(hit.hitEnemy).toBe(true);
    expect(hit.killed).toBe(false);
    expect(hit.kills).toBe(0);
    const corpse = await fire({ doomed: true });
    expect(corpse.kills).toBe(0);
  });
});
