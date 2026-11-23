import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { MaterialLibrary } from '../../core/contracts';
import type { FxCore } from '../core';
import { bloodPuff, PUFF } from '../recipes/blood';
import { BloodLayer, crossing } from './blood';
import { makeUniforms } from './shared';

/** Euler steps of the same motion the vertex shader evaluates in closed form. */
function simulate(h: number, hv: number, ha: number, k: number): number {
  const dt = 1e-4;
  let v = hv;
  for (let t = 0; t < 5; t += dt) {
    v += (ha - k * v) * dt;
    h += v * dt;
    if (h <= 0) return t;
  }
  return Infinity;
}

describe('crossing', () => {
  it('lands where the dragged path really lands', () => {
    expect(crossing(1.4, 3, -14, 1.5, 3)).toBeCloseTo(simulate(1.4, 3, -14, 1.5), 2);
    expect(crossing(0.6, 9, -14, 0.6, 3)).toBeCloseTo(simulate(0.6, 9, -14, 0.6), 2);
  });

  it('returns the limit when drag stops the strand short of a wall', () => {
    expect(crossing(8, -6, 0, 2, 1.6)).toBe(1.6);
  });

  it('never reports a landing for a start behind the plane', () => {
    expect(crossing(-0.1, 5, -14, 1, 1.6)).toBe(1.6);
  });
});

describe('the impact puff', () => {
  const layer = () => new BloodLayer(new THREE.Scene(), makeUniforms(), { patch: () => null } as unknown as MaterialLibrary, 256);
  const core = (blood: BloodLayer, now = 1) => ({ blood, bloodNow: now } as unknown as FxCore);
  const at = new THREE.Vector3(0, 1.2, 0);
  const dir = new THREE.Vector3(0, 0, -1);

  it('emits an immediate translucent mist pop plus snappy spritz droplets that expire cleanly', () => {
    const blood = layer();
    bloodPuff(core(blood), at, dir, 0.3);
    // Primary mist pop + spritz droplets are live just after birth and gone once the puff's lifetime ends.
    expect(blood.ring.countLive(1.02)).toBe(4);
    expect(blood.ring.countLive(1 + PUFF.life + PUFF.lifeHeavy + 0.05)).toBe(0);
    const d = blood.ring.data;
    // Record 0 is marked as a puff (negative trail and opacity), born now, standing off the skin toward the gun.
    expect(d[10]).toBeLessThan(0);
    expect(d[11]).toBeLessThan(0);
    expect(d[3]).toBe(1);
    expect(d[2]).toBeGreaterThan(at.z);
  });

  it('is bigger, lasts longer, and scales mist volume for heavier rounds and major gore bursts', () => {
    const light = layer();
    const heavy = layer();
    const gib = layer();
    bloodPuff(core(light), at, dir, 0.2);
    bloodPuff(core(heavy), at, dir, 0.9);
    bloodPuff(core(gib), at, dir, 1, 1.4, 'gib');
    expect(heavy.ring.data[9]).toBeGreaterThan(light.ring.data[9]! * 1.5);
    expect(heavy.ring.data[7]).toBeGreaterThan(light.ring.data[7]!);
    expect(gib.ring.data[9]).toBeGreaterThan(heavy.ring.data[9]! * 1.5);
    expect(gib.ring.countLive(1.1)).toBeGreaterThan(heavy.ring.countLive(1.1));
  });

  it('has a hard cap a frame, and a new frame has its own', () => {
    const blood = layer();
    for (let i = 0; i < 40; i++) bloodPuff(core(blood, 2), at, dir, 0.3);
    const capped = blood.ring.countLive(2.02);
    // Only PUFF.perFrame bullet pops are admitted on the same frame (4 records each: 1 mist + 3 spritz).
    expect(capped).toBe(PUFF.perFrame * 4);
    bloodPuff(core(blood, 2.016), at, dir, 0.3);
    expect(blood.ring.countLive(2.03)).toBe(capped + 4);
  });
});
