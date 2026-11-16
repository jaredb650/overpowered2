import { describe, expect, it } from 'vitest';
import { ClaimValidator, RespawnClock, selectTarget } from './authority';
import type { HitClaim, Vec } from './worldProtocol';

const eye: Vec = [0, 1.6, 0], target: Vec = [0, 1, -10];
const claim = (): HitClaim => ({ t: 'hit', shot: 1, target: 42, weapon: 'smg', origin: eye,
  damage: { amount: 12, type: 'bullet', source: 'smg', force: 12, region: 'chest', point: target, dir: [0, 0, -1] } });

describe('friends-only hit sanity checks', () => {
  it('allows normal AP, HP and Raufoss plate inputs without bypassing the damage model', () => {
    const validator = new ClaimValidator();
    expect(validator.acceptFire('guest', 1, 'smg', 100)).toBe(true);
    for (const load of ['ap', 'hp'] as const) {
      const value = claim(); value.damage.load = load;
      expect(validator.validate('guest', value, 120, eye, target, () => true)).toBe(true);
    }
    const inside = claim(); inside.damage.type = 'pellet'; inside.damage.pierces = true; inside.damage.headshotMult = 1.5;
    expect(validator.validate('guest', inside, 140, eye, target, () => true)).toBe(true);
  });
  it('rejects no shot, wrong identity, replay, rate, range, cover and non-finite inputs', () => {
    const validator = new ClaimValidator();
    expect(validator.validate('guest', claim(), 100, eye, target, () => true)).toBe(false);
    expect(validator.acceptFire('guest', 1, 'smg', 100)).toBe(true);
    expect(validator.acceptFire('guest', 1, 'smg', 200)).toBe(false);
    expect(validator.acceptFire('guest', 2, 'smg', 101)).toBe(false);
    expect(validator.acceptFire('other', 1, '__proto__', 100)).toBe(false);
    expect(validator.validate('other', claim(), 120, eye, target, () => true)).toBe(false);
    expect(validator.validate('guest', claim(), 120, eye, target, () => false)).toBe(false);
    expect(validator.validate('guest', claim(), 120, [100, 1, 0], target, () => true)).toBe(false);
    expect(validator.validate('guest', claim(), 120, eye, [0, 0, -400], () => true)).toBe(false);
    for (const bad of [NaN, Infinity, -1, 1e9]) {
      const value = claim(); value.damage.amount = bad;
      expect(validator.validate('guest', value, 120, eye, target, () => true)).toBe(false);
    }
    const forged = claim(); forged.damage.headshotMult = Infinity;
    expect(validator.validate('guest', forged, 120, eye, target, () => true)).toBe(false);
    expect(validator.validate('guest', null, 120, eye, target, () => true)).toBe(false);
    validator.forget('guest');
    expect(validator.validate('guest', claim(), 120, eye, target, () => true)).toBe(false);
  });
  it('caps pellets and secondary damage per shot while allowing a complete Raufoss burst', () => {
    const validator = new ClaimValidator(); validator.acceptFire('guest', 1, 'smg', 0);
    for (let index = 0; index < 64; index++) expect(validator.validate('guest', claim(), 120, eye, target, () => true)).toBe(true);
    expect(validator.validate('guest', claim(), 120, eye, target, () => true)).toBe(false);
  });
});

describe('all-player enemy target selection', () => {
  const players = [{ id: 'host', alive: true, position: [10, 0, 0] }, { id: 'guest', alive: true, position: [3, 0, 0] }];
  it('chooses a nearer guest, retains close calls, switches and excludes dead players', () => {
    expect(selectTarget([0, 0, 0], players)?.id).toBe('guest');
    expect(selectTarget([0, 0, 0], [{ ...players[0]!, position: [3.2, 0, 0] }, players[1]!], 'host')?.id).toBe('host');
    expect(selectTarget([0, 0, 0], players, 'host')?.id).toBe('guest');
    expect(selectTarget([0, 0, 0], [players[0]!, { ...players[1]!, alive: false }])?.id).toBe('host');
    expect(selectTarget([0, 0, 0], [])).toBeUndefined();
  });
});

describe('death and respawn epochs', () => {
  it('starts one real-time countdown, respawns once and ignores stale damage', () => {
    const life = new RespawnClock();
    expect(life.accepts(0)).toBe(true);
    expect(life.die(100)).toBe(true); expect(life.die(150)).toBe(false);
    expect(life.accepts(0)).toBe(false); expect(life.update(3599)).toBe(false);
    expect(life.update(3600)).toBe(true); expect(life.update(5000)).toBe(false);
    expect(life.accepts(0)).toBe(false); expect(life.accepts(1)).toBe(true);
    expect(life.die(6000)).toBe(true); expect(life.update(9500)).toBe(true); expect(life.life).toBe(2);
  });
});
