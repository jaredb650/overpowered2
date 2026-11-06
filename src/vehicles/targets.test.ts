import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { EnemyInstance } from '../core/gameplay';
import { thickestKnot } from './targets';

let uid = 0;
const man = (x: number, z: number, alive = true) => ({ uid: uid++, alive, position: new THREE.Vector3(x, 0, z) }) as unknown as EnemyInstance;

describe('thickestKnot', () => {
  it('goes to the crowd and not to the stragglers', () => {
    const out = new THREE.Vector3();
    const list = [man(100, 100), man(0, 0), man(2, 0), man(0, 2), man(2, 2), man(-90, 40)];
    expect(thickestKnot(list, 8, new Set(), out)).toBe(4);
    expect(out.x).toBeCloseTo(1, 5);
    expect(out.z).toBeCloseTo(1, 5);
  });

  it('leaves `out` alone with nobody to fly to', () => {
    const out = new THREE.Vector3(7, 8, 9);
    expect(thickestKnot([man(1, 1, false)], 8, new Set(), out)).toBe(0);
    expect(out.toArray()).toEqual([7, 8, 9]);
  });

  it('does not count prisoners as a fight', () => {
    const out = new THREE.Vector3();
    const held = [man(0, 0), man(1, 0), man(0, 1)];
    const free = man(60, 60);
    expect(thickestKnot([...held, free], 8, new Set(held.map(e => e.uid)), out)).toBe(1);
    expect(out.x).toBeCloseTo(60, 5);
  });
});
