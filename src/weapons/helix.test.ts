import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { helixOffset, type HelixSpec } from './helix';
import { TUNING, WEAPONS } from './data';
import { makeRange } from './testkit';

const right = new THREE.Vector3(1, 0, 0);
const up = new THREE.Vector3(0, 1, 0);
const spec: HelixSpec = { phase: Math.PI / 4, reach: 60, radius: 0.7, pitch: 15, startRadius: 0.6 / Math.SQRT2, convergence: 12 };
const offset = (distance: number, phase = spec.phase, reach = spec.reach) => helixOffset(new THREE.Vector3(), right, up, { ...spec, phase, reach }, distance);

describe('Quiver helix geometry', () => {
  it('starts at the four tube corners, equally spaced around one centre', () => {
    const corners = [1, 3, 5, 7].map(index => offset(0, index * Math.PI / 4));
    for (const corner of corners) {
      expect(Math.abs(corner.x)).toBeCloseTo(0.3);
      expect(Math.abs(corner.y)).toBeCloseTo(0.3);
    }
    expect(corners.reduce((sum, corner) => sum.add(corner), new THREE.Vector3()).length()).toBeLessThan(1e-8);
  });

  it('makes one complete turn per pitch in metres, independent of framerate or speed', () => {
    expect(offset(5).distanceTo(offset(20))).toBeLessThan(1e-8);
    expect(offset(5).angleTo(offset(5 + spec.pitch / 4))).toBeCloseTo(Math.PI / 2);
    expect(offset(5).length()).toBeCloseTo(0.7);
  });

  it('smoothly closes the braid onto the same fixed aim point, including close shots and beyond it', () => {
    expect(offset(50).length()).toBeGreaterThan(offset(55).length());
    for (const phase of [0, Math.PI / 2, Math.PI, 1.5 * Math.PI]) {
      expect(offset(60, phase).length()).toBe(0);
      expect(offset(70, phase).length()).toBe(0);
      expect(offset(3, phase, 3).length()).toBe(0);
    }
  });

  it('keeps swept wall impacts and each rocket\'s original damage and explosion numbers', async () => {
    const range = await makeRange();
    range.reset();
    range.wall(-16, 0.1);
    range.weapons.give('quiver');
    range.weapons.switchTo('quiver');
    range.run(0.5);
    range.tap('aim');
    const rockets = [...range.combat.projectiles.active];
    expect(rockets).toHaveLength(4);
    for (const rocket of rockets) {
      expect(rocket.damage).toBe(WEAPONS.quiver.damage);
      expect(rocket.blastDamage).toBe(TUNING.quiver.blastDamage);
      expect(rocket.blastRadius).toBe(TUNING.quiver.radius);
      expect(rocket.target).toBeNull();
    }
    range.run(0.8, 20);
    expect(range.combat.projectiles.count).toBe(0);
    expect(range.record.explosions).toBe(4);
    for (const impact of range.record.blasts) {
      expect(impact.z).toBeGreaterThanOrEqual(-16);
      expect(impact.z).toBeLessThan(-15.7);
    }
  });

  it('lays bounded, distance-spaced smoke along all four corkscrews even at 20 fps', async () => {
    const range = await makeRange();
    range.reset();
    range.weapons.give('quiver');
    range.weapons.switchTo('quiver');
    range.run(0.5);
    range.tap('aim');
    const smoke = vi.fn();
    range.ctx.fx = new Proxy(range.ctx.fx, { get: (target, key) => key === 'smoke' ? smoke : Reflect.get(target, key) });
    range.run(0.05, 20);
    expect(smoke.mock.calls.length).toBeGreaterThanOrEqual(8);
    expect(smoke.mock.calls.length).toBeLessThanOrEqual(32);
  });

  it('does not leak the helix into a normal salvo, another weapon or a recycled projectile', async () => {
    const range = await makeRange();
    range.reset();
    range.weapons.give('quiver');
    range.weapons.switchTo('quiver');
    range.run(0.5);
    range.tap('aim');
    range.combat.projectiles.clear();
    range.weapons.ammo('quiver').mag = 4;
    range.run(0.5);
    range.tap('fire');
    range.run(0.4);
    for (const rocket of range.combat.projectiles.active) expect(rocket.helix).toBeNull();
    range.combat.projectiles.clear();
    range.weapons.give('rocket');
    range.weapons.switchTo('rocket');
    range.run(0.5);
    range.tap('fire');
    expect(range.combat.projectiles.active[0]!.helix).toBeNull();
  });
});
