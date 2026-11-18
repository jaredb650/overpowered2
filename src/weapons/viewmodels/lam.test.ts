/** The laser module's beam: a dot where the ray meets a wall in range, none where it does not. */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { RayHit } from '../../core/contracts';
import { LAM, LamBeams, laserEnd, type LaserCast } from './lam';

const from = new THREE.Vector3(0, 1.5, 0);
const dir = new THREE.Vector3(0, 0, -1);
/** A wall `at` metres down -z, as physics.raycastInto would answer. */
const wall = (at: number): LaserCast => (o, d, max, out) => {
  if (at > max) return false;
  out.point.copy(o).addScaledVector(d, at);
  out.normal.set(0, 0, 1);
  out.distance = at;
  return true;
};
const hit = (): RayHit => ({ point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0, surface: 'concrete', collider: null });

describe('laser beam', () => {
  it('ends on a wall in range, and at the range with no wall', () => {
    const end = new THREE.Vector3();
    expect(laserEnd(from, dir, wall(12), hit(), end)).toBe(true);
    expect(end.z).toBeCloseTo(-12);
    expect(laserEnd(from, dir, wall(LAM.range + 5), hit(), end)).toBe(false);
    expect(end.z).toBeCloseTo(-LAM.range);
    // A stand-in physics answers with something that is not a boolean: no wall.
    expect(laserEnd(from, dir, (() => ({})) as unknown as LaserCast, hit(), end)).toBe(false);
  });

  it('lights the dot on a hit and hides it on a miss, a gun a slot', () => {
    const beams = new LamBeams();
    beams.aim(0, from, dir, 1, wall(8));
    expect(beams.dotOn(0)).toBe(true);
    expect(beams.mesh.visible).toBe(true);
    beams.aim(1, from, dir, 1, wall(80));
    expect(beams.dotOn(1)).toBe(false);
    beams.aim(0, from, dir, 1, wall(80));
    expect(beams.dotOn(0)).toBe(false);
    beams.hide(0);
    beams.hide(1);
    expect(beams.mesh.visible).toBe(false);
  });
});
