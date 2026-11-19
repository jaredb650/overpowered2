import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { DecalKind } from '../core/contracts';
import { DECAL_RINGS, Decals, MAX_DECALS, RING_CAPACITY, RING_OF, type DecalRing } from './Decals';
import type { MaterialPatcher } from './materials/patch';
import type { BakedSet } from './materials/TextureBaker';

const patcher = { apply: (m: THREE.MeshStandardMaterial) => m } as unknown as MaterialPatcher;
const atlas = { albedo: null, surface: null } as unknown as BakedSet;
const up = new THREE.Vector3(0, 1, 0);
const at = (x: number) => new THREE.Vector3(x, 0, 0);

/** Where a ring starts in the buffer. */
function baseOf(ring: DecalRing): number {
  let base = 0;
  for (const r of DECAL_RINGS) {
    if (r === ring) return base;
    base += RING_CAPACITY[r];
  }
  throw new Error(ring);
}

/** The x a slot was written at, or null for an empty slot. */
function xAt(d: Decals, slot: number): number | null {
  const m = d.mesh.instanceMatrix.array as Float32Array;
  return m[slot * 16 + 15] === 0 ? null : m[slot * 16 + 12]!;
}

/** The ranges `update` asked the GPU to take, as [first slot, slots]. */
function uploaded(d: Decals): [number, number][] {
  d.update(0, null as unknown as THREE.Texture, new THREE.PerspectiveCamera());
  return d.mesh.instanceMatrix.updateRanges.map(r => [r.start / 16, r.count / 16] as [number, number]);
}

describe('decal rings', () => {
  it('give every kind a ring, and the rings fill the buffer end to end', () => {
    const kinds: DecalKind[] = ['bullet', 'scorch', 'blood', 'bloodPool', 'bloodSmear', 'slash', 'crack', 'exit'];
    for (const k of kinds) expect(DECAL_RINGS, k).toContain(RING_OF[k]);
    expect(MAX_DECALS).toBe(DECAL_RINGS.reduce((n, r) => n + RING_CAPACITY[r], 0));
    const d = new Decals(patcher, atlas);
    expect(d.mesh.instanceMatrix.count).toBe(MAX_DECALS);
    // Four times the old single ring's 2,048 for blood alone, which used to share them with every hole.
    expect(RING_CAPACITY.blood).toBeGreaterThanOrEqual(2048 * 4);
  });

  it('never let bullet holes erase blood, nor blood erase holes', () => {
    const d = new Decals(patcher, atlas);
    for (let i = 0; i < 40; i++) d.add('blood', at(i), up, 0.3);
    for (let i = 0; i < RING_CAPACITY.mark * 3; i++) d.add('bullet', at(1000 + i), up, 0.12);
    expect(d.live('blood')).toBe(40);
    expect(d.retired('blood')).toBe(0);
    expect(d.live('mark')).toBe(RING_CAPACITY.mark);
    expect(d.retired('mark')).toBe(RING_CAPACITY.mark * 2);
    for (let i = 0; i < 40; i++) expect(xAt(d, baseOf('blood') + i)).toBeCloseTo(i);
    for (let i = 0; i < RING_CAPACITY.blood * 2; i++) d.add('bloodPool', at(5000 + i), up, 1);
    expect(d.live('mark')).toBe(RING_CAPACITY.mark);
    expect(d.retired('mark')).toBe(RING_CAPACITY.mark * 2);
    expect(d.live('blood')).toBe(RING_CAPACITY.blood);
  });

  it('overwrite the oldest of their own ring first', () => {
    const d = new Decals(patcher, atlas);
    const n = RING_CAPACITY.scorch;
    for (let i = 0; i < n + 3; i++) d.add('scorch', at(i), up, 2);
    const base = baseOf('scorch');
    expect(xAt(d, base)).toBeCloseTo(n);
    expect(xAt(d, base + 2)).toBeCloseTo(n + 2);
    expect(xAt(d, base + 3)).toBeCloseTo(3);
    expect(d.retired('scorch')).toBe(3);
  });

  it('draw as far as the last slot in use, with empty slots of no size', () => {
    const d = new Decals(patcher, atlas);
    expect(d.mesh.count).toBe(0);
    d.add('blood', at(1), up, 0.3);
    expect(d.mesh.count).toBe(baseOf('blood') + 1);
    // Rings before it are empty: all zeros, so they rasterise nothing.
    const m = d.mesh.instanceMatrix.array as Float32Array;
    for (let i = 0; i < baseOf('blood') * 16; i++) expect(m[i]).toBe(0);
    d.add('bullet', at(2), up, 0.12);
    expect(d.mesh.count).toBe(baseOf('mark') + 1);
    d.add('scorch', at(3), up, 2);
    expect(d.mesh.count).toBe(baseOf('mark') + 1);
  });

  it('send only what changed, a ring at a time', () => {
    const d = new Decals(patcher, atlas);
    expect(uploaded(d)).toEqual([]);
    d.add('blood', at(1), up, 0.3);
    d.add('blood', at(2), up, 0.3);
    d.add('crack', at(3), up, 0.5);
    expect(uploaded(d)).toEqual([[baseOf('blood'), 2], [baseOf('mark'), 1]]);
    // A stretch that wraps past the end of its ring is two ranges.
    for (let i = 0; i < RING_CAPACITY.scorch - 1; i++) d.add('scorch', at(i), up, 2);
    uploaded(d);
    for (let i = 0; i < 3; i++) d.add('scorch', at(i), up, 2);
    expect(uploaded(d)).toEqual([[baseOf('scorch') + RING_CAPACITY.scorch - 1, 1], [baseOf('scorch'), 2]]);
  });

  it('tell whoever asked which decal is about to go, before it is overwritten', () => {
    const d = new Decals(patcher, atlas);
    const gone: [DecalRing, number][] = [];
    d.onRetire = (ring, matrices, _data, slot) => gone.push([ring, matrices[slot * 16 + 12]!]);
    for (let i = 0; i < RING_CAPACITY.big; i++) d.add('scorch', at(i), up, 2);
    expect(gone).toEqual([]);
    d.add('scorch', at(900), up, 2);
    d.add('scorch', at(901), up, 2);
    expect(gone).toEqual([['scorch', 0], ['scorch', 1]]);
    d.clear();
    expect(gone).toHaveLength(2);
  });

  it('clear to nothing and start again from the first slot', () => {
    const d = new Decals(patcher, atlas);
    for (let i = 0; i < 30; i++) d.add('blood', at(i), up, 0.3);
    d.add('bullet', at(7), up, 0.12);
    uploaded(d);
    d.clear();
    for (const r of DECAL_RINGS) expect(d.live(r)).toBe(0);
    // The emptied slots are sent, and only then does the draw shorten.
    expect(uploaded(d)).toEqual([[baseOf('blood'), 30], [baseOf('mark'), 1]]);
    expect(d.mesh.count).toBe(0);
    expect(xAt(d, baseOf('blood') + 5)).toBeNull();
    d.add('blood', at(50), up, 0.3);
    expect(xAt(d, baseOf('blood'))).toBeCloseTo(50);
    expect(d.mesh.count).toBe(baseOf('blood') + 1);
  });

  it('hold fewer when a limit is lowered, and take the room back when it is raised', () => {
    const d = new Decals(patcher, atlas);
    for (let i = 0; i < 100; i++) d.add('blood', at(i), up, 0.3);
    uploaded(d);
    d.setLimit('blood', 40);
    expect(d.limit('blood')).toBe(40);
    expect(d.live('blood')).toBe(40);
    expect(xAt(d, baseOf('blood') + 39)).toBeCloseTo(39);
    expect(xAt(d, baseOf('blood') + 40)).toBeNull();
    expect(uploaded(d)).toEqual([[baseOf('blood'), 100]]);
    expect(d.mesh.count).toBe(baseOf('blood') + 40);
    for (let i = 0; i < 45; i++) d.add('blood', at(200 + i), up, 0.3);
    expect(d.live('blood')).toBe(40);
    expect(xAt(d, baseOf('blood') + 4)).toBeCloseTo(244);
    expect(xAt(d, baseOf('blood') + 40)).toBeNull();
    // Raised again while full: the next one goes on the end and erases nothing.
    d.setLimit('blood', 1e9);
    expect(d.limit('blood')).toBe(RING_CAPACITY.blood);
    const retired = d.retired('blood');
    d.add('blood', at(999), up, 0.3);
    expect(d.live('blood')).toBe(41);
    expect(d.retired('blood')).toBe(retired);
    expect(xAt(d, baseOf('blood') + 40)).toBeCloseTo(999);
  });

  it('stop spending slots on a soaked spot: a new small stain takes an old one\'s place there', () => {
    const d = new Decals(patcher, atlas);
    d.soak = 6;
    const spot = new THREE.Vector3(0.2, 0, 0.2);
    // Each 0.4 m stain is 0.4 x 0.4 x half ink over a quarter square metre: 0.32 of a layer. Nineteen make six layers.
    for (let i = 0; i < 400; i++) d.add('blood', spot, up, 0.4);
    expect(d.layersAt(spot)).toBeGreaterThanOrEqual(6);
    expect(d.layersAt(spot)).toBeLessThan(6.5);
    expect(d.live('blood')).toBe(19);
    expect(d.soaked).toBe(400 - 19);
    expect(d.retired('blood')).toBe(0);
    // The next cell over is its own count.
    const beside = new THREE.Vector3(0.2, 0, 0.9);
    d.add('blood', beside, up, 0.4);
    expect(d.live('blood')).toBe(20);
    expect(d.layersAt(beside)).toBeCloseTo(0.32, 2);
    // A pool, a smear or a run always lands: they are few, and they are the coverage.
    d.add('bloodPool', spot, up, 1.5);
    d.add('bloodSmear', spot, up, 0.6);
    expect(d.live('blood')).toBe(22);
    // The floor above is not this floor.
    d.add('blood', new THREE.Vector3(0.2, 3.2, 0.2), up, 0.4);
    expect(d.live('blood')).toBe(23);
  });

  it('send a soaked spot\'s rewritten slots on their own, and count a spot down as its stains are overwritten', () => {
    const d = new Decals(patcher, atlas);
    d.soak = 2;
    const spot = new THREE.Vector3(5.1, 0, 5.1);
    for (let i = 0; i < 7; i++) d.add('blood', spot, up, 0.4);
    uploaded(d);
    d.add('blood', spot, up, 0.4);
    // The cell remembers its last six: the seventh pushed slot 0 out of its memory, so slot 1 is the oldest it has.
    expect(uploaded(d)).toEqual([[baseOf('blood') + 1, 1]]);
    expect(d.live('blood')).toBe(7);
    // With no limit it is a ring like any other.
    d.soak = 0;
    d.add('blood', spot, up, 0.4);
    expect(d.live('blood')).toBe(8);
    // Overwritten from elsewhere, the spot dries out of the count.
    d.setLimit('blood', 8);
    for (let i = 0; i < 8; i++) d.add('blood', at(100 + i), up, 0.4);
    expect(d.layersAt(spot)).toBe(0);
    d.clear();
    expect(d.soaked).toBe(0);
  });
});

describe('the decal sheet baked again at another size (a quality change)', () => {
  it('every decal already down, and the floor tiles, draw from the new sheet', () => {
    type Hook = (shader: { uniforms: Record<string, { value: unknown }>; vertexShader: string; fragmentShader: string }) => void;
    let hook: Hook | null = null;
    const catching = { apply: (m: THREE.MeshStandardMaterial, h: Hook) => { hook = h; return m; } } as unknown as MaterialPatcher;
    const first = { albedo: new THREE.Texture(), surface: new THREE.Texture(), dispose() {} };
    const d = new Decals(catching, first);
    d.add('blood', at(1), up, 0.5);
    const shader = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: '', fragmentShader: '' };
    hook!(shader);
    expect(shader.uniforms.opDecalA!.value).toBe(first.albedo);
    const half = { albedo: new THREE.Texture(), surface: new THREE.Texture(), dispose() {} };
    d.setAtlas(half);
    // The compiled program holds the same uniform objects, so it follows without a recompile.
    expect(shader.uniforms.opDecalA!.value).toBe(half.albedo);
    expect(shader.uniforms.opDecalS!.value).toBe(half.surface);
    // Nothing on the floor moved: a decal is a cell's number, not its pixels.
    expect(d.live('blood')).toBe(1);
  });
});

