/** An enemy ray's near miss: the whizz, or the sound the shot names, only for a round that passes close and misses. */
import * as THREE from 'three';
import { beforeEach, expect, it } from 'vitest';
import type { ShotSpec } from '../core/gameplay';
import { makeRange, type Range } from './testkit';

const DIR = new THREE.Vector3(0, 0, 1);
const fire = (x: number, o: Partial<ShotSpec> = {}) =>
  r.combat.fireRay(new THREE.Vector3(x, 1, -60), DIR, { damage: 10, source: 'test', team: 'enemy', maxDistance: 120, ...o });

let r: Range;
beforeEach(async () => {
  r = await makeRange();
  r.reset();
});

it('a round 2 m past the player whizzes, or plays the sound the shot names', () => {
  fire(2);
  expect(r.record.sounds).toContain('bullet_whizz');
  r.record.sounds.length = 0;
  fire(2, { whizz: 'sniper_crack' });
  expect(r.record.sounds).toContain('sniper_crack');
  expect(r.record.sounds).not.toContain('bullet_whizz');
});

it('neither a hit nor a round 4 m off plays it', () => {
  fire(0, { whizz: 'sniper_crack' });
  expect(r.player.damage.length).toBe(1);
  fire(4, { whizz: 'sniper_crack' });
  expect(r.record.sounds).not.toContain('sniper_crack');
});
