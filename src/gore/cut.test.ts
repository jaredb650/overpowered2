import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { cutMesh } from './cut';

/** Signed volume of a closed mesh. Zero-gap cuts conserve it exactly, which proves the caps seal. */
function volume(g: THREE.BufferGeometry, offset = new THREE.Vector3()): number {
  const p = g.getAttribute('position');
  const idx = g.getIndex()!;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  let v = 0;
  for (let i = 0; i < idx.count; i += 3) {
    a.fromBufferAttribute(p, idx.getX(i)).add(offset);
    b.fromBufferAttribute(p, idx.getX(i + 1)).add(offset);
    c.fromBufferAttribute(p, idx.getX(i + 2)).add(offset);
    v += a.dot(b.clone().cross(c)) / 6;
  }
  return v;
}

/** Every directed edge has its reverse, so the surface has no holes. */
function openEdges(g: THREE.BufferGeometry): number {
  const p = g.getAttribute('position');
  const idx = g.getIndex()!;
  const key = (i: number) => `${p.getX(i).toFixed(4)},${p.getY(i).toFixed(4)},${p.getZ(i).toFixed(4)}`;
  const edges = new Map<string, number>();
  for (let t = 0; t < idx.count; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = key(idx.getX(t + k));
      const b = key(idx.getX(t + ((k + 1) % 3)));
      if (a === b) continue;
      const fwd = `${a}|${b}`;
      const rev = `${b}|${a}`;
      if (edges.has(rev)) {
        const n = edges.get(rev)! - 1;
        if (n === 0) edges.delete(rev);
        else edges.set(rev, n);
      } else {
        edges.set(fwd, (edges.get(fwd) ?? 0) + 1);
      }
    }
  }
  let open = 0;
  for (const n of edges.values()) open += n;
  return open;
}

/** Weld a sphere so its seam is shared; three's sphere duplicates seam vertices, like a real UV seam. */
const sphere = () => new THREE.SphereGeometry(1, 32, 24);

describe('cutMesh', () => {
  it('splits a sphere into two closed halves that keep the total volume', () => {
    const g = sphere();
    const whole = volume(g);
    const r = cutMesh(g, new THREE.Vector3(0.1, 0.05, 0), new THREE.Vector3(1, 0.3, 0.2).normalize());
    expect(r.loops).toBe(1);
    const va = volume(r.above[0]!.geometry);
    const vb = volume(r.below[0]!.geometry);
    expect(va).toBeGreaterThan(0);
    expect(vb).toBeGreaterThan(0);
    expect(va + vb).toBeCloseTo(whole, 2);
  });

  it('caps face outward: above faces down the plane normal', () => {
    const g = sphere();
    const r = cutMesh(g, new THREE.Vector3(), new THREE.Vector3(0, 1, 0));
    expect(r.above[0]!.capNormal.y).toBeLessThan(0);
    expect(r.below[0]!.capNormal.y).toBeGreaterThan(0);
    expect(r.above[0]!.capArea).toBeCloseTo(Math.PI, 1);
  });

  it('leaves no open edges when the source is closed, in spite of UV seams', () => {
    const g = new THREE.IcosahedronGeometry(1, 4);
    // Polyhedra are unindexed. Index them by position so "closed" is meaningful for the check.
    const p = g.getAttribute('position');
    g.setIndex(Array.from({ length: p.count }, (_, i) => i));
    const r = cutMesh(g, new THREE.Vector3(0, 0.13, 0), new THREE.Vector3(0.2, 1, 0.1).normalize());
    expect(openEdges(r.above[0]!.geometry)).toBe(0);
    expect(openEdges(r.below[0]!.geometry)).toBe(0);
  });

  it('interpolates UVs across the cut', () => {
    const g = new THREE.BoxGeometry(2, 2, 2, 1, 1, 1);
    const r = cutMesh(g, new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0));
    const uv = r.above[0]!.geometry.getAttribute('uv');
    const pos = r.above[0]!.geometry.getAttribute('position');
    let midU = 0;
    for (let i = 0; i < uv.count; i++) {
      const x = pos.getX(i) + r.above[0]!.origin.x;
      const u = uv.getX(i);
      if (Math.abs(x) < 1e-4 && (u === 0.5 || Math.abs(u - 0.5) < 1e-5)) midU++;
    }
    expect(midU).toBeGreaterThan(0);
  });

  it('finds separate openings, and a hole inside an opening', () => {
    const a = new THREE.SphereGeometry(0.6, 16, 12);
    a.translate(-2, 0, 0);
    const b = new THREE.SphereGeometry(0.6, 16, 12);
    b.translate(2, 0, 0);
    const merged = mergeIndexed([a, b]);
    const r = cutMesh(merged, new THREE.Vector3(), new THREE.Vector3(0, 1, 0));
    expect(r.loops).toBe(2);
    // Two boxes means two pieces per side, each with its own cap.
    expect(r.above.length).toBe(2);
    expect(r.below.length).toBe(2);
    expect(r.above[0]!.capArea).toBeCloseTo(Math.PI * 0.36, 1);
    expect(Math.abs(r.above[0]!.origin.x)).toBeCloseTo(2, 3);

    const outer = new THREE.BoxGeometry(2, 2, 2);
    const inner = new THREE.BoxGeometry(1, 3, 1);
    flip(inner); // Inverted shell: a tube's inner wall.
    const tube = mergeIndexed([outer, inner]);
    const t = cutMesh(tube, new THREE.Vector3(), new THREE.Vector3(0, 1, 0));
    expect(t.above[0]!.capArea).toBeCloseTo(3, 3);
  });

  it('reports one empty side when the plane misses the mesh', () => {
    const r = cutMesh(sphere(), new THREE.Vector3(0, 5, 0), new THREE.Vector3(0, 1, 0));
    expect(r.above.length).toBe(0);
    expect(r.below.length).toBe(1);
  });

  it('cuts a body-sized mesh quickly', () => {
    const g = new THREE.SphereGeometry(1, 96, 64);
    const n = new THREE.Vector3(0.3, 1, 0.2).normalize();
    cutMesh(g, new THREE.Vector3(), n);
    // Best of many, because a shared machine makes any single sample meaningless.
    let best = Infinity;
    for (let i = 0; i < 30; i++) {
      const t0 = performance.now();
      cutMesh(g, new THREE.Vector3(0, 0.01 * (i % 7), 0), n);
      best = Math.min(best, performance.now() - t0);
    }
    expect(best).toBeLessThan(10);
  });
});

function flip(g: THREE.BufferGeometry): void {
  const idx = g.getIndex()!;
  for (let i = 0; i < idx.count; i += 3) {
    const a = idx.getX(i);
    idx.setX(i, idx.getX(i + 1));
    idx.setX(i + 1, a);
  }
}

function mergeIndexed(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (const g of parts) {
    const base = pos.length / 3;
    pos.push(...(g.getAttribute('position').array as Float32Array));
    nrm.push(...(g.getAttribute('normal').array as Float32Array));
    uv.push(...(g.getAttribute('uv').array as Float32Array));
    for (const i of g.getIndex()!.array) idx.push(base + i);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.setIndex(idx);
  return out;
}
