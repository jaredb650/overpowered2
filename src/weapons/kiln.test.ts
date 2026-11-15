/** Key 9, the Kiln: napalm that arcs, lands, sticks and burns there. */
import * as THREE from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import { TUNING } from './data';
import { makeRange, type Range } from './testkit';

const N = TUNING.napalm;
const UP = new THREE.Vector3(0, 1, 0);

let r: Range;
beforeEach(async () => {
  r = await makeRange();
  r.reset();
  r.player.eye.set(0, 1.6, 0);
  r.player.forward.set(0, 0, -1);
  r.weapons.give('kiln');
  r.weapons.switchTo('kiln');
  r.run(0.6);
});

function squeeze(seconds: number): void {
  r.input.simulate('fire', true);
  r.run(seconds);
  r.input.simulate('fire', false);
}

const live = () => r.combat.flames.patches.filter(p => p.live);

describe('the Kiln', () => {
  it('arcs down onto the floor about 12 m out from a flat shot, and further from a lob', () => {
    squeeze(0.2);
    r.run(1.5);
    const flat = live();
    expect(flat.length).toBeGreaterThan(0);
    for (const p of flat) {
      expect(p.position.y).toBeCloseTo(0, 1);
      expect(-p.position.z).toBeGreaterThan(10);
      expect(-p.position.z).toBeLessThan(14);
    }
    expect(r.record.decals.some(d => d.kind === 'scorch')).toBe(true);

    r.combat.flames.clear();
    r.player.forward.set(0, Math.sin(0.35), -Math.cos(0.35));
    squeeze(0.2);
    r.run(2);
    const lob = live();
    expect(lob.length).toBeGreaterThan(0);
    for (const p of lob) expect(-p.position.z).toBeGreaterThan(16);
  });

  it('coats a man the stream hits, and lights one who walks through a patch, for less', () => {
    const hit = r.enemies.add(0, -5);
    squeeze(0.3);
    expect(hit.burning).toBeGreaterThan(N.coatSeconds - 0.5);

    const walker = r.enemies.add(6, 0);
    r.combat.flames.feed(new THREE.Vector3(6, 0, 0), UP, 'kiln');
    r.run(N.patch.tick * 2);
    expect(walker.burning).toBeGreaterThan(0);
    expect(walker.burning).toBeLessThanOrEqual(TUNING.kiln.burnSeconds);
  });

  it('never burns the player, even standing in his own patch', () => {
    r.combat.flames.feed(new THREE.Vector3(0, 0, 0), UP, 'kiln');
    r.player.forward.set(0, -0.9, -0.44).normalize();
    squeeze(0.5);
    r.run(1);
    expect(r.player.damage.length).toBe(0);
  });

  it('burns for its life after the last glob and no longer, in a pool that puts out the oldest', () => {
    const f = r.combat.flames;
    for (let i = 0; i < N.patch.max + 10; i++) f.feed(new THREE.Vector3(i * 3, 0, -40), UP, 'kiln');
    expect(f.burning).toBe(N.patch.max);
    // The first was put out to make room.
    expect(live().some(p => p.position.x === 0 && p.position.z === -40)).toBe(false);

    // Feeding the same spot keeps one patch, growing it to its cap and holding it alight.
    f.clear();
    for (let i = 0; i < 60; i++) {
      f.feed(new THREE.Vector3(0.1 * Math.sin(i), 0, -40), UP, 'kiln');
      r.run(0.1);
    }
    expect(f.burning).toBe(1);
    expect(live()[0]!.radius).toBeCloseTo(N.patch.maxRadius, 5);
    r.run(N.patch.life - 0.3);
    expect(f.burning).toBe(1);
    r.run(0.5);
    expect(f.burning).toBe(0);
  });

  it('keeps floor and wall patches apart', () => {
    const f = r.combat.flames;
    f.feed(new THREE.Vector3(0, 0, -10), UP, 'kiln');
    f.feed(new THREE.Vector3(0, 0.3, -10.05), new THREE.Vector3(0, 0, 1), 'kiln');
    expect(f.burning).toBe(2);
  });
});
