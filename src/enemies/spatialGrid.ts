/**
 * Zero-allocation flat spatial hash grid over live enemies (3 m XZ cells).
 * Rebuilt once per frame in O(N) using typed arrays and generation stamps so
 * separation, radius queries, ward scans, and boss tramples avoid O(N^2) scans.
 */
import type { Enemy } from './Enemy';

const CELL_SIZE = 3.0;
const INV_CELL = 1 / CELL_SIZE;
const TABLE_SIZE = 1024;
const TABLE_MASK = TABLE_SIZE - 1;

function hashCell(cx: number, cz: number): number {
  return ((cx * 73856093) ^ (cz * 19349663)) & TABLE_MASK;
}

export class EnemySpatialGrid {
  private readonly cellHead = new Int32Array(TABLE_SIZE);
  private readonly cellStamp = new Int32Array(TABLE_SIZE);
  private readonly visitStamp = new Int32Array(TABLE_SIZE);
  private next = new Int32Array(128);
  private stamp = 0;
  private queryStamp = 0;
  private items: readonly Enemy[] = [];
  private count = 0;
  maxRadius = 1.0;
  dirty = true;

  /** Rebuilds the hash table in O(N) with zero heap allocations. */
  rebuild(alive: readonly Enemy[]): void {
    const n = alive.length;
    this.items = alive;
    this.count = n;
    this.dirty = false;
    if (n > this.next.length) {
      let cap = this.next.length;
      while (cap < n) cap <<= 1;
      this.next = new Int32Array(cap);
    }
    let s = ++this.stamp;
    if (s >= 0x7fffffff) {
      this.cellStamp.fill(0);
      this.stamp = s = 1;
    }
    let maxR = 0.5;
    const { cellHead, cellStamp, next } = this;
    for (let i = 0; i < n; i++) {
      const e = alive[i]!;
      const r = e.def.radius;
      if (r > maxR) maxR = r;
      const cx = Math.floor(e.position.x * INV_CELL);
      const cz = Math.floor(e.position.z * INV_CELL);
      const h = hashCell(cx, cz);
      if (cellStamp[h] !== s) {
        cellStamp[h] = s;
        next[i] = -1;
      } else {
        next[i] = cellHead[h]!;
      }
      cellHead[h] = i;
    }
    this.maxRadius = maxR;
  }

  /** Ensures the grid reflects `alive` if enemies were added/removed since the last rebuild. */
  ensure(alive: readonly Enemy[]): void {
    if (this.dirty || this.items !== alive || this.count !== alive.length) this.rebuild(alive);
  }

  /**
   * Appends every enemy in XZ cells overlapping `(x, z) +/- radius` into `out` (clears `out` first).
   * Zero closures, zero allocations, and safe when callers mutate/kill enemies after collecting.
   */
  collectInRadius(x: number, z: number, radius: number, out: Enemy[]): number {
    out.length = 0;
    const n = this.count;
    if (n === 0) return 0;
    const minCx = Math.floor((x - radius) * INV_CELL);
    const maxCx = Math.floor((x + radius) * INV_CELL);
    const minCz = Math.floor((z - radius) * INV_CELL);
    const maxCz = Math.floor((z + radius) * INV_CELL);
    const cellSpan = (maxCx - minCx + 1) * (maxCz - minCz + 1);
    const items = this.items;
    if (cellSpan >= n) {
      for (let i = 0; i < n; i++) out.push(items[i]!);
      return n;
    }
    let q = ++this.queryStamp;
    if (q >= 0x7fffffff) {
      this.visitStamp.fill(0);
      this.queryStamp = q = 1;
    }
    const s = this.stamp;
    const { cellHead, cellStamp, visitStamp, next } = this;
    for (let cz = minCz; cz <= maxCz; cz++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const h = hashCell(cx, cz);
        if (cellStamp[h] !== s || visitStamp[h] === q) continue;
        visitStamp[h] = q;
        for (let idx = cellHead[h]!; idx >= 0; idx = next[idx]!) {
          out.push(items[idx]!);
        }
      }
    }
    return out.length;
  }

  /**
   * Zero-closure separation accumulator for `movement.ts` so `separate()` pays no callback allocation.
   * Writes into `outX`/`outZ` via returned scratch or directly mutates `out` Vector3.
   */
  accumulateSeparation(
    e: Enemy,
    px: number,
    py: number,
    pz: number,
    r: number,
    gap: number,
    out: { x: number; z: number },
  ): void {
    const n = this.count;
    if (n <= 1) return;
    const search = r + this.maxRadius + gap;
    const minCx = Math.floor((px - search) * INV_CELL);
    const maxCx = Math.floor((px + search) * INV_CELL);
    const minCz = Math.floor((pz - search) * INV_CELL);
    const maxCz = Math.floor((pz + search) * INV_CELL);
    let q = ++this.queryStamp;
    if (q >= 0x7fffffff) {
      this.visitStamp.fill(0);
      this.queryStamp = q = 1;
    }
    const s = this.stamp;
    const { cellHead, cellStamp, visitStamp, next, items } = this;
    const invR = 1 / r;
    const uid = e.uid;
    let sx = 0;
    let sz = 0;
    for (let cz = minCz; cz <= maxCz; cz++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const h = hashCell(cx, cz);
        if (cellStamp[h] !== s || visitStamp[h] === q) continue;
        visitStamp[h] = q;
        for (let idx = cellHead[h]!; idx >= 0; idx = next[idx]!) {
          const o = items[idx]!;
          if (o === e || o.airborne || !o.alive) continue;
          const dx = px - o.position.x;
          const dz = pz - o.position.z;
          const reach = r + o.def.radius + gap;
          const d2 = dx * dx + dz * dz;
          if (d2 > reach * reach || Math.abs(py - o.position.y) > 2) continue;
          const d = Math.sqrt(d2) || 0.01;
          const invD = 1 / d;
          const push = (1 - d / reach) * (o.def.radius * invR);
          const tangent = uid < o.uid ? 0.6 : -0.6;
          const nx = dx * invD;
          const nz = dz * invD;
          sx += (nx - nz * tangent) * push;
          sz += (nz + nx * tangent) * push;
        }
      }
    }
    out.x = sx;
    out.z = sz;
  }
}
