import { describe, expect, it } from 'vitest';
import { DEFAULT_BINDINGS } from '../../input/bindings';
import { KH } from '../../world/map/killhouse/plan';
import { ASSIST_SOURCES, CALLIN_ORDER, CALLINS } from '../data';
import { ATTACK, DOOR } from './heliData';

describe('the helicopters on the ladder', () => {
  it('sit between the Warthog and the Black Sun, the door first', () => {
    const { warthog, doorGunner, attackChopper, blackSun } = CALLINS;
    expect(doorGunner.combo).toBeGreaterThan(warthog.combo);
    expect(attackChopper.combo).toBeGreaterThan(doorGunner.combo);
    expect(blackSun.combo).toBeGreaterThan(attackChopper.combo);
  });

  it('keep the ladder in order and every rung different', () => {
    const combos = CALLIN_ORDER.map(id => CALLINS[id].combo);
    expect(combos).toEqual([...combos].sort((a, b) => a - b));
    expect(new Set(combos).size).toBe(combos.length);
  });

  it('cannot be called while the one airframe is still flying', () => {
    expect(CALLINS.attackChopper.cooldown).toBeGreaterThan(ATTACK.boardSeconds + ATTACK.seat.seconds + ATTACK.departSeconds);
    expect(CALLINS.doorGunner.cooldown).toBeGreaterThan(DOOR.boardSeconds + DOOR.seat.seconds + DOOR.departSeconds);
  });

  it('have keys of their own', () => {
    const taken = new Map<string, string>();
    for (const [action, codes] of Object.entries(DEFAULT_BINDINGS)) {
      for (const code of codes) {
        expect(taken.get(code), `${code} on ${action}`).toBeUndefined();
        taken.set(code, action);
      }
    }
    expect(DEFAULT_BINDINGS.callinChopper).toEqual([`Key${CALLINS.attackChopper.key}`]);
    expect(DEFAULT_BINDINGS.callinDoorGunner).toEqual([`Key${CALLINS.doorGunner.key}`]);
  });

  it('credit kills at the strike rate', () => {
    for (const source of ['chopper_cannon', 'chopper_rocket', 'door_gun']) expect(ASSIST_SOURCES.test(source)).toBe(true);
  });
});

describe('the Kill House flight plans', () => {
  it('fly over the invisible walls', () => {
    expect(ATTACK.small.altitude).toBeGreaterThan(KH.containment);
    expect(DOOR.small.altitude).toBeGreaterThan(KH.containment);
  });

  it('stay inside them, where a line of fire cannot run into one from behind', () => {
    expect(ATTACK.small.limit).toBeLessThan(KH.perimeter);
    expect(DOOR.small.radius + DOOR.limit.small).toBeLessThan(KH.perimeter);
  });

  it('count those walls as what they fly over and hold their height', () => {
    expect(KH.containment + ATTACK.small.clearance).toBeLessThanOrEqual(ATTACK.small.altitude);
    expect(KH.containment + DOOR.clearance.small).toBeLessThanOrEqual(DOOR.small.altitude);
  });

  it('let the guns reach the far wall at their highest', () => {
    const across = KH.perimeter + DOOR.small.radius + DOOR.limit.small;
    const reach = (DOOR.small.altitude - KH.perimeterH) / Math.tan(-DOOR.seat.pitchMax);
    expect(reach).toBeLessThanOrEqual(across);
  });
});
