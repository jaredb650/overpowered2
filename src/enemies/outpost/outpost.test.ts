import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { PhysicsSystem, RayHit } from '../../core/contracts';
import { mulberry32 } from '../../core/math';
import { CoverMap, type SpotQuery, type SpotReading } from './cover';
import { composeOutpostWave, MAX_SQUAD, MIN_SQUAD, ROLE_OF, waveStrength } from './doctrine';
import { Dread, killDread, moraleCeiling, moraleState } from './morale';
import { Route, RouteFinder, type NavGrid } from './routes';

/** A flat floor of 1 m columns, with `solid` cells missing, as the real graph leaves them. */
function grid(size: number, solid: (x: number, z: number) => boolean): NavGrid {
  const px: number[] = [], pz: number[] = [], clearance: number[] = [];
  const colStart = new Int32Array(size * size + 1);
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      const c = z * size + x;
      colStart[c + 1] = colStart[c]!;
      if (solid(x, z)) continue;
      px.push(x + 0.5);
      pz.push(z + 0.5);
      clearance.push(solid(x + 1, z) || solid(x - 1, z) || solid(x, z + 1) || solid(x, z - 1) ? 0 : 3);
      colStart[c + 1]!++;
    }
  }
  const n = px.length;
  return {
    nodeCount: n, px: Float32Array.from(px), py: new Float32Array(n), pz: Float32Array.from(pz), slopeX: new Float32Array(n), slopeZ: new Float32Array(n),
    clearance: Uint8Array.from(clearance), minX: 0, minZ: 0, nx: size, nz: size, colStart,
    locate(p) {
      const c = Math.floor(p.z) * size + Math.floor(p.x);
      return colStart[c] !== colStart[c + 1] ? colStart[c]! : -1;
    },
  };
}

const v = (x: number, z: number) => new THREE.Vector3(x, 0, z);

describe('morale', () => {
  it('walks down through the states', () => {
    expect(moraleState(100, 0)).toBe('steady');
    expect(moraleState(50, 0)).toBe('shaken');
    expect(moraleState(30, 0)).toBe('panicked');
    expect(moraleState(10, 0)).toBe('broken');
  });

  it('breaks the same man sooner under Dread', () => {
    expect(moraleState(40, 0)).toBe('shaken');
    expect(moraleState(40, 100)).toBe('broken');
    expect(moraleCeiling(100, 100)).toBeLessThan(moraleCeiling(100, 0));
  });

  it('counts a brutal kill for more, and a spree for more again', () => {
    const plain = { gibbed: false, sliced: false, headshot: false, severed: 0 };
    expect(killDread({ ...plain, gibbed: true })).toBeGreaterThan(killDread(plain));
    const spaced = new Dread();
    const spree = new Dread();
    for (let i = 0; i < 5; i++) {
      spaced.onKill(plain, i * 20);
      spree.onKill(plain, i);
    }
    expect(spree.value).toBeGreaterThan(spaced.value * 1.5);
  });

  it('decays, and makes reinforcements hesitate while it lasts', () => {
    const d = new Dread();
    d.add(50);
    expect(d.hesitation).toBe(2);
    d.update(10);
    expect(d.value).toBeLessThan(50);
  });
});

describe('waves', () => {
  it('opens with about eight men', () => {
    expect(composeOutpostWave(1).flat()).toHaveLength(8);
  });

  it('only sends soldiers, in squads of three to six, in the numbers it promised', () => {
    const roll = mulberry32(4);
    for (let wave = 1; wave <= 20; wave++) {
      for (let i = 0; i < 30; i++) {
        const squads = composeOutpostWave(wave, roll);
        expect(squads.flat()).toHaveLength(waveStrength(wave));
        for (const s of squads) {
          expect(s.length).toBeGreaterThanOrEqual(MIN_SQUAD);
          expect(s.length).toBeLessThanOrEqual(MAX_SQUAD);
          for (const id of s) expect(ROLE_OF[id]).toBeDefined();
        }
      }
    }
  });
});

describe('routes', () => {
  /** A wall across the map with one gap at x 2..3. */
  const walled = (x: number, z: number) => x < 0 || z < 0 || x >= 20 || z >= 20 || (z === 10 && (x < 2 || x > 3));

  it('finds the way round', () => {
    const r = new RouteFinder();
    r.build(grid(20, walled));
    const route = new Route();
    expect(r.find(v(15.5, 5.5), v(15.5, 15.5), route)).toBe(true);
    let through = false;
    for (let i = 0; i < route.count; i++) if (Math.abs(route.z[i]! - 10.5) < 1.5 && route.x[i]! < 5) through = true;
    expect(through).toBe(true);
    expect(route.length).toBeGreaterThan(20);
  });

  it('cuts corners in open floor instead of following the grid', () => {
    const r = new RouteFinder();
    r.build(grid(20, (x, z) => x < 0 || z < 0 || x >= 20 || z >= 20));
    const route = new Route();
    r.find(v(1.5, 1.5), v(18.5, 12.5), route);
    expect(route.count).toBeLessThanOrEqual(3);
  });

  it('goes the long way round ground the threat can see', () => {
    const r = new RouteFinder();
    r.build(grid(30, (x, z) => x < 0 || z < 0 || x >= 30 || z >= 30));
    const direct = new Route();
    const hidden = new Route();
    r.find(v(2.5, 15.5), v(27.5, 15.5), direct);
    // A lane across the middle in full view of the threat.
    r.find(v(2.5, 15.5), v(27.5, 15.5), hidden, { exposed: (x, z) => x > 8 && x < 22 && Math.abs(z - 15) < 9 });
    expect(hidden.length).toBeGreaterThan(direct.length + 5);
  });

  it('reports no route to a sealed room', () => {
    const r = new RouteFinder();
    r.build(grid(20, (x, z) => x < 0 || z < 0 || x >= 20 || z >= 20 || z === 10));
    expect(r.find(v(5.5, 5.5), v(5.5, 15.5), new Route())).toBe(false);
  });

  it('reads points along itself', () => {
    const route = new Route();
    route.push(0, 0, 0);
    route.push(10, 0, 0);
    route.push(10, 0, 10);
    expect(route.length).toBe(20);
    expect(route.pointAt(15, new THREE.Vector3()).toArray()).toEqual([10, 0, 5]);
    expect(route.pointAt(99, new THREE.Vector3()).toArray()).toEqual([10, 0, 10]);
  });
});

describe('cover', () => {
  /** A wall along z = 10, up to `top` metres, between x 5 and x 15. */
  function wallPhysics(top: number): PhysicsSystem {
    const raycastInto = (o: THREE.Vector3, d: THREE.Vector3, max: number, _mask: number, out: RayHit): boolean => {
      if (Math.abs(d.z) < 1e-6 || o.y > top) return false;
      const t = (10 - o.z) / d.z;
      if (t < 0 || t > max) return false;
      const x = o.x + d.x * t;
      if (x < 5 || x > 15) return false;
      out.distance = t;
      return true;
    };
    return { raycastInto } as unknown as PhysicsSystem;
  }

  const open = grid(20, (x, z) => x < 0 || z < 0 || x >= 20 || z >= 20 || (z === 10 && x >= 5 && x <= 14));
  const nav: NavGrid = { ...open, locate: open.locate, clearance: open.clearance };

  const build = (top: number) => {
    const map = new CoverMap(wallPhysics(top));
    map.build(nav);
    return map;
  };

  const query = (threat: THREE.Vector3, anchor: THREE.Vector3): SpotQuery => ({
    anchor, radius: 8, threat, near: 0, far: 60, bearing: NaN, bearingSlack: 0.4, needShot: false, spacing: 1, uid: 1, from: anchor,
  });

  it('finds spots against the wall and tells low from tall', () => {
    const low = build(1.15);
    const tall = build(4);
    expect(low.spots.length).toBeGreaterThan(4);
    expect(low.spots.every(s => s.tall === 0)).toBe(true);
    expect(tall.spots.every(s => s.tall === s.low)).toBe(true);
  });

  it('picks the side of the wall away from the threat', () => {
    const map = build(4);
    const reading: SpotReading = { hidden: false, canShoot: false, side: 0 };
    const spot = map.pick(query(v(10, 18), v(10, 7)), reading);
    expect(spot).not.toBeNull();
    expect(spot!.position.z).toBeLessThan(10);
    expect(reading.hidden).toBe(true);
  });

  it('fires over low cover and hides behind it at the same time', () => {
    const map = build(1.15);
    const reading: SpotReading = { hidden: false, canShoot: false, side: 0 };
    map.pick(query(new THREE.Vector3(10, 1, 18), v(10, 7)), reading);
    expect(reading.hidden).toBe(true);
    expect(reading.canShoot).toBe(true);
    expect(reading.side).toBe(0);
  });

  it('never gives one spot to two men', () => {
    const map = build(4);
    const reading: SpotReading = { hidden: false, canShoot: false, side: 0 };
    const q = query(v(10, 18), v(10, 7));
    const first = map.pick(q, reading)!;
    first.claimedBy = 1;
    const second = map.pick({ ...q, uid: 2 }, reading);
    expect(second).not.toBe(first);
  });
});
