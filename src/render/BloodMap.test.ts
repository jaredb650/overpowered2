import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { MapTuning, TILES, TILE_SPAN, tileKey } from './BloodMap';
import { Decals, RING_CAPACITY } from './Decals';
import type { MaterialPatcher } from './materials/patch';
import type { BakedSet } from './materials/TextureBaker';

const patcher = { apply: (m: THREE.MeshStandardMaterial) => m } as unknown as MaterialPatcher;
const atlas = { albedo: null, surface: null } as unknown as BakedSet;
const up = new THREE.Vector3(0, 1, 0);
const wall = new THREE.Vector3(1, 0, 0);
const down = new THREE.Vector3(0, -6, 0);

/** Enough of a renderer for the map to draw into nothing: it counts the draws. */
function renderer() {
  const r = {
    draws: 0, clears: 0,
    setRenderTarget() {}, getRenderTarget: () => null, getClearColor: (c: THREE.Color) => c, getClearAlpha: () => 0, setClearColor() {},
    clear() { r.clears++; }, render() { r.draws++; },
  };
  return r as unknown as THREE.WebGLRenderer & { draws: number; clears: number };
}

/** A decal system whose clock is at `t`. */
function at(t: number) {
  const d = new Decals(patcher, atlas);
  const tick = (to: number) => d.update(to, null as unknown as THREE.Texture, new THREE.PerspectiveCamera());
  tick(t);
  return { d, tick };
}

describe('old blood kept in floor tiles', () => {
  it('a tile is one floor level of one square of ground', () => {
    expect(TILES).toBe(16);
    expect(TILE_SPAN).toBeGreaterThan(15);
    expect(tileKey(1, 0, 1)).toEqual(tileKey(TILE_SPAN - 1, 0.005, 2));
    expect(tileKey(1, 0, 1)).not.toEqual(tileKey(TILE_SPAN + 1, 0, 1));
    // The floor above is another tile, so its blood does not show through.
    expect(tileKey(1, 0, 1)).not.toEqual(tileKey(1, 3, 1));
    expect(tileKey(-0.1, 0, 0)[0]).toBe(-1);
  });

  it('a stain that has dried on a flat floor is drawn into a tile, once, and the tile is shown', () => {
    const { d, tick } = at(0);
    const r = renderer();
    d.splat(new THREE.Vector3(2, 0, 3), up, 0.9, down);
    tick(1);
    d.floor.flush(r);
    // Still wet: baking it now would change how it looks.
    expect(d.floor.bakedCount).toBe(0);
    tick(MapTuning.dryAge + 2);
    d.floor.flush(r);
    expect(d.floor.bakedCount).toBe(1);
    expect(d.floor.liveTiles).toBe(1);
    expect(d.floor.tileAt(0) ?? d.floor.tileAt(TILES - 1)).not.toBeNull();
    expect(r.draws).toBe(1);
    // The tile's quad lies on that floor, faces up, and covers the tile's ground.
    const slot = d.base('floor') + [...Array(TILES).keys()].find(i => d.floor.tileAt(i))!;
    const m = new THREE.Matrix4().fromArray(d.mesh.instanceMatrix.array as Float32Array, slot * 16);
    const [x, y, n] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    m.extractBasis(x, y, n);
    expect(x.length()).toBeCloseTo(TILE_SPAN);
    expect(new THREE.Vector3().crossVectors(x, y).normalize().y).toBeCloseTo(1);
    const p = new THREE.Vector3().setFromMatrixPosition(m);
    expect(Math.abs(p.x - 2)).toBeLessThan(TILE_SPAN);
    expect(p.y).toBeCloseTo(0, 2);
    // Not again.
    tick(MapTuning.dryAge + 10);
    d.floor.flush(r);
    expect(d.floor.bakedCount).toBe(1);
  });

  it('what is on a wall, a slope, too small, a run or a bullet hole stays a decal', () => {
    const { d, tick } = at(0);
    const r = renderer();
    d.splat(new THREE.Vector3(0, 1, 0), wall, 0.9, new THREE.Vector3(-6, 0, 0));
    d.splat(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0.3).normalize(), 0.9, down);
    d.splat(new THREE.Vector3(0, 0, 0), up, 0.03, new THREE.Vector3(0, -1, 0));
    d.add('bullet', new THREE.Vector3(), up, 0.5);
    tick(MapTuning.dryAge + 2);
    d.floor.flush(r);
    expect(d.floor.bakedCount).toBe(0);
    expect(d.floor.liveTiles).toBe(0);
  });

  it('a stain overwritten before it dried is baked on its way out', () => {
    const { d, tick } = at(0);
    const r = renderer();
    d.setLimit('blood', 4);
    for (let i = 0; i < 4; i++) d.splat(new THREE.Vector3(i, 0, 0), up, 0.9, down);
    expect(d.floor.pending).toBe(0);
    for (let i = 0; i < 3; i++) d.splat(new THREE.Vector3(i, 0, 5), up, 0.9, down);
    expect(d.floor.pending).toBe(3);
    tick(1);
    d.floor.flush(r);
    expect(d.floor.bakedCount).toBe(3);
  });

  it('a stain across the edge of a tile is drawn into both', () => {
    const { d, tick } = at(0);
    const r = renderer();
    d.splat(new THREE.Vector3(TILE_SPAN, 0, 3), up, 2, down);
    tick(MapTuning.dryAge + 2);
    d.floor.flush(r);
    expect(d.floor.bakedCount).toBe(1);
    expect(d.floor.liveTiles).toBe(2);
    expect(r.draws).toBe(2);
  });

  it('a seventeenth tile takes the place of the one least lately added to', () => {
    const { d, tick } = at(0);
    const r = renderer();
    for (let i = 0; i < TILES; i++) {
      d.splat(new THREE.Vector3((i + 0.5) * TILE_SPAN, 0, 1), up, 0.9, down);
      tick(MapTuning.dryAge + 2 + i * (MapTuning.dryAge + 2));
      d.floor.flush(r);
    }
    expect(d.floor.liveTiles).toBe(TILES);
    expect(d.floor.evicted).toBe(0);
    d.splat(new THREE.Vector3(1, 0, 60), up, 0.9, down);
    tick(1e5);
    d.floor.flush(r);
    expect(d.floor.liveTiles).toBe(TILES);
    expect(d.floor.evicted).toBe(1);
    // The first tile laid is the one that went.
    const keys = [...Array(TILES).keys()].map(i => d.floor.tileAt(i)!.join());
    expect(keys).not.toContain(tileKey(0.5 * TILE_SPAN, 0, 1).join());
    expect(keys).toContain(tileKey(1, 0, 60).join());
  });

  it('fewer tiles keep less floor, and none turns the map off (the quality setting)', () => {
    const { d, tick } = at(0);
    const r = renderer();
    d.floor.tileLimit = 2;
    for (let i = 0; i < 3; i++) {
      d.splat(new THREE.Vector3((i + 0.5) * TILE_SPAN, 0, 1), up, 0.9, down);
      tick((i + 1) * (MapTuning.dryAge + 2));
      d.floor.flush(r);
    }
    // The third square of floor took the place of the first: two tiles, never three.
    expect(d.floor.liveTiles).toBe(2);
    expect(d.floor.evicted).toBe(1);
    expect(d.floor.tileAt(2)).toBeNull();
    // Off: the tiles are emptied and hidden, and nothing more is baked, on a stain's way out or after it dries.
    d.floor.tileLimit = 0;
    expect(d.floor.liveTiles).toBe(0);
    const quads = d.mesh.instanceMatrix.array as Float32Array;
    for (let i = 0; i < TILES; i++) expect(quads[(d.base('floor') + i) * 16 + 15]).toBe(0);
    const baked = d.floor.bakedCount;
    d.setLimit('blood', 4);
    for (let i = 0; i < 9; i++) d.splat(new THREE.Vector3(i, 0, 9), up, 0.9, down);
    expect(d.floor.pending).toBe(0);
    tick(1e5);
    d.floor.flush(r);
    expect(d.floor.bakedCount).toBe(baked);
    expect(d.floor.liveTiles).toBe(0);
    // Back on: what has dried since goes in.
    d.floor.tileLimit = TILES;
    tick(1e5 + 1);
    d.floor.flush(r);
    expect(d.floor.liveTiles).toBeGreaterThan(0);
  });

  it('a new run clears the tiles with the decals', () => {
    const { d, tick } = at(0);
    const r = renderer();
    d.splat(new THREE.Vector3(2, 0, 3), up, 0.9, down);
    tick(MapTuning.dryAge + 2);
    d.floor.flush(r);
    d.clear();
    expect(d.floor.liveTiles).toBe(0);
    expect(d.floor.bakedCount).toBe(0);
    expect(d.live('floor')).toBe(0);
    expect(RING_CAPACITY.floor).toBe(TILES);
  });
});
