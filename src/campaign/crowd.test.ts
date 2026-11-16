import { describe, expect, it } from 'vitest';
import { FakeHost } from './testkit';
import { arm, type WatchFacts } from './watch';

const zone = { min: [0, 0, 0], max: [10, 5, 10] } as const;
const facts = (crowd?: { x: number; y: number; z: number }[]): WatchFacts => {
  const host = new FakeHost() as FakeHost & { crowd?: () => { x: number; y: number; z: number }[] };
  if (crowd) host.crowd = () => crowd;
  return { host, zone: () => zone as never, spawned: () => 0, left: () => 0, feet: { x: 50, y: 0, z: 50 }, join() {}, leave() {} };
};

describe('co-op zones (net/mission.ts)', () => {
  it('fires when any player is in, and outside only when all have left', () => {
    const someone = [{ x: 50, y: 0, z: 50 }, { x: 5, y: 1, z: 5 }];
    expect(arm({ zone: 'z' }, facts(someone)).test(0)).toBe(true);
    expect(arm({ zone: 'z', outside: true }, facts(someone)).test(0)).toBe(false);
    expect(arm({ zone: 'z', outside: true }, facts([{ x: 50, y: 0, z: 50 }])).test(0)).toBe(true);
  });
  it('alone, it is the player as before', () => {
    expect(arm({ zone: 'z' }, facts()).test(0)).toBe(false);
  });
});
