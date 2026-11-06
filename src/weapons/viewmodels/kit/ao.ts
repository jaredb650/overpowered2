/**
 * Per-vertex ambient occlusion, baked at load.
 *
 * The whole model is splatted into a coarse occupancy grid, including every moving part at its rest position.
 * Each vertex then marches a fixed set of hemisphere rays through the grid. It costs a few milliseconds per gun,
 * and it is what seats a screw into a plate and a magazine into a well instead of leaving them floating.
 */
import * as THREE from 'three';
import type { Layer, PartNode } from './mesher';

interface Item { layer: Layer; offset: THREE.Vector3; }

function gather(node: PartNode, offset: THREE.Vector3, out: Item[]): void {
  const hard = node.layers.get('hard');
  if (hard && hard.count > 0) out.push({ layer: hard, offset: offset.clone() });
  for (const c of node.children) gather(c, offset.clone().add(c.pivot), out);
}

const DIRS: [number, number, number][] = [];
{
  // Fibonacci hemisphere around +Z.
  const n = 14;
  for (let i = 0; i < n; i++) {
    const z = 0.12 + (0.88 * (i + 0.5)) / n;
    const r = Math.sqrt(1 - z * z);
    const a = i * 2.39996;
    DIRS.push([Math.cos(a) * r, Math.sin(a) * r, z]);
  }
}

export function bakeAo(root: PartNode, strength = 1.15): void {
  const items: Item[] = [];
  gather(root, new THREE.Vector3(), items);
  if (items.length === 0) return;

  const lo = new THREE.Vector3(Infinity, Infinity, Infinity);
  const hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  for (const { layer, offset } of items) {
    for (let i = 0; i < layer.count; i++) {
      const x = layer.p[i * 3]! + offset.x;
      const y = layer.p[i * 3 + 1]! + offset.y;
      const z = layer.p[i * 3 + 2]! + offset.z;
      if (x < lo.x) lo.x = x; if (y < lo.y) lo.y = y; if (z < lo.z) lo.z = z;
      if (x > hi.x) hi.x = x; if (y > hi.y) hi.y = y; if (z > hi.z) hi.z = z;
    }
  }
  const size = hi.clone().sub(lo);
  const cell = Math.max(0.0028, Math.max(size.x, size.y, size.z) / 220);
  const pad = 4;
  const nx = Math.ceil(size.x / cell) + pad * 2;
  const ny = Math.ceil(size.y / cell) + pad * 2;
  const nz = Math.ceil(size.z / cell) + pad * 2;
  const grid = new Uint8Array(nx * ny * nz);
  const ox = lo.x - pad * cell;
  const oy = lo.y - pad * cell;
  const oz = lo.z - pad * cell;
  const inv = 1 / cell;

  for (const { layer, offset } of items) {
    const p = layer.p;
    const idx = layer.i;
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t]! * 3;
      const b = idx[t + 1]! * 3;
      const c = idx[t + 2]! * 3;
      const ax = p[a]! + offset.x, ay = p[a + 1]! + offset.y, az = p[a + 2]! + offset.z;
      const bx = p[b]! + offset.x, by = p[b + 1]! + offset.y, bz = p[b + 2]! + offset.z;
      const cx = p[c]! + offset.x, cy = p[c + 1]! + offset.y, cz = p[c + 2]! + offset.z;
      const longest = Math.max(Math.hypot(bx - ax, by - ay, bz - az), Math.hypot(cx - ax, cy - ay, cz - az), Math.hypot(cx - bx, cy - by, cz - bz));
      const steps = Math.min(64, Math.max(1, Math.ceil(longest * inv * 1.2)));
      for (let i = 0; i <= steps; i++) {
        for (let j = 0; j <= steps - i; j++) {
          const u = i / steps;
          const v = j / steps;
          const w = 1 - u - v;
          const gx = ((ax * w + bx * u + cx * v - ox) * inv) | 0;
          const gy = ((ay * w + by * u + cy * v - oy) * inv) | 0;
          const gz = ((az * w + bz * u + cz * v - oz) * inv) | 0;
          grid[(gz * ny + gy) * nx + gx] = 1;
        }
      }
    }
  }

  const reach = [2.2, 3.6, 5.8, 9.5, 15];
  const weight = [1, 0.8, 0.6, 0.4, 0.25];
  let wsum = 0;
  for (const w of weight) wsum += w;
  for (const { layer, offset } of items) {
    const p = layer.p;
    const n = layer.n;
    for (let i = 0; i < layer.count; i++) {
      const px = p[i * 3]! + offset.x;
      const py = p[i * 3 + 1]! + offset.y;
      const pz = p[i * 3 + 2]! + offset.z;
      const wx = n[i * 3]!;
      const wy = n[i * 3 + 1]!;
      const wz = n[i * 3 + 2]!;
      // Tangent basis around the normal.
      const ux0 = Math.abs(wz) < 0.9 ? -wy : 0;
      const uy0 = Math.abs(wz) < 0.9 ? wx : -wz;
      const uz0 = Math.abs(wz) < 0.9 ? 0 : wy;
      const ul = 1 / (Math.hypot(ux0, uy0, uz0) || 1);
      const ux = ux0 * ul, uy = uy0 * ul, uz = uz0 * ul;
      const vx = wy * uz - wz * uy;
      const vy = wz * ux - wx * uz;
      const vz = wx * uy - wy * ux;
      let occ = 0;
      for (const d of DIRS) {
        const dx = ux * d[0] + vx * d[1] + wx * d[2];
        const dy = uy * d[0] + vy * d[1] + wy * d[2];
        const dz = uz * d[0] + vz * d[1] + wz * d[2];
        let hit = 0;
        for (let s = 0; s < reach.length; s++) {
          const r = reach[s]! * cell;
          const gx = ((px + dx * r - ox) * inv) | 0;
          const gy = ((py + dy * r - oy) * inv) | 0;
          const gz = ((pz + dz * r - oz) * inv) | 0;
          if (gx < 0 || gy < 0 || gz < 0 || gx >= nx || gy >= ny || gz >= nz) break;
          if (grid[(gz * ny + gy) * nx + gx]) {
            hit = weight[s]!;
            break;
          }
        }
        occ += hit * d[2];
      }
      occ /= DIRS.length * (wsum / reach.length) * 0.55;
      const ao = Math.max(0, 1 - occ * strength);
      layer.a[i * 4 + 3] = Math.round(ao * 255);
    }
  }
}
