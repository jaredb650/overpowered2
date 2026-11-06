import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { Ctx } from '../core/contracts';
import type { GroundProbe } from '../progression/callins/ground';
import { Skyline } from './skyline';

const BOUNDS = new THREE.Box3(new THREE.Vector3(-100, -10, -100), new THREE.Vector3(100, 80, 100));

/** A flat floor with one tower at the origin, and a slab of invisible wall along the far edge. */
function probe(rays: { n: number }): GroundProbe {
  return {
    heightAt(x: number, fromY: number, z: number) {
      rays.n++;
      if (x > 90) return fromY;
      return Math.hypot(x, z) < 6 ? 55 : 2;
    },
  } as unknown as GroundProbe;
}

const made = (rays = { n: 0 }) => new Skyline({ world: { bounds: BOUNDS } } as unknown as Ctx, probe(rays));

describe('Skyline', () => {
  it('reads what is straight below', () => {
    const s = made();
    expect(s.ground(0, 0)).toBe(55);
    expect(s.ground(50, 0)).toBe(2);
  });

  it('warns of a tower well before the aircraft is over it', () => {
    const s = made();
    expect(s.at(0, 0)).toBe(55);
    expect(s.at(14, 0)).toBe(55);
    expect(s.at(40, 0)).toBe(2);
  });

  it('finds a tower anywhere along a path', () => {
    const s = made();
    const from = new THREE.Vector3(60, 40, 0);
    expect(s.along(from, new THREE.Vector3(-30, 0, 0), 2.4)).toBe(55);
    expect(s.along(from, new THREE.Vector3(30, 0, 0), 0.5)).toBe(2);
  });

  it('does not mistake the inside of an invisible wall for a skyscraper', () => {
    const s = made();
    expect(s.ground(95, 0)).toBe(0);
    expect(s.at(80, 0)).toBeLessThan(10);
  });

  it('reads the map once', () => {
    const rays = { n: 0 };
    const s = made(rays);
    s.build();
    const after = rays.n;
    expect(after).toBeGreaterThan(0);
    s.build();
    s.at(0, 0);
    s.along(new THREE.Vector3(), new THREE.Vector3(10, 0, 0), 2);
    expect(rays.n).toBe(after);
  });

  it('reports open air off the edge of the map', () => {
    expect(made().at(500, 500)).toBe(0);
  });
});
