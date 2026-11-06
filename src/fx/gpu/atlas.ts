import * as THREE from 'three';
import { mulberry32 } from '../../core/math';

/**
 * Procedural puff atlas, 2x2 cells, built once at startup.
 *
 *   R  density: reaches 0 before the cell edge, usable as a height field
 *   G  x slope of that height field, B  y slope (faux lighting)
 *   A  fine noise for edge erosion
 *
 * The top row is billows, a heap of sphere caps, for smoke. The bottom row is torn ridged noise, for
 * flame. Sprites are drawn by thresholding R, and a thresholded bilinear field stays a sharp curve at
 * any magnification, so these cells hold up full screen.
 */
const CELL = 256;
const SIZE = CELL * 2;

function makeNoise(seed: number) {
  const rng = mulberry32(seed);
  const N = 256;
  const table = new Float32Array(N * N);
  for (let i = 0; i < table.length; i++) table[i] = rng();
  const smooth = (t: number) => t * t * (3 - 2 * t);
  return (x: number, y: number, period: number): number => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = smooth(x - xi);
    const fy = smooth(y - yi);
    const wrap = (v: number) => ((v % period) + period) % period;
    const x0 = wrap(xi);
    const x1 = wrap(xi + 1);
    const y0 = wrap(yi) * N;
    const y1 = wrap(yi + 1) * N;
    const a = table[y0 + x0]!;
    const b = table[y0 + x1]!;
    const c = table[y1 + x0]!;
    const d = table[y1 + x1]!;
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}

/** Heap of sphere caps with a little noise: a cumulus outline with real lobes to light. */
function billow(height: Float32Array, seed: number, noise: ReturnType<typeof makeNoise>): void {
  const rng = mulberry32(seed);
  const blobs: [number, number, number][] = [[0, 0, 0.26 + rng() * 0.05]];
  for (let i = 0; i < 16; i++) {
    const a = rng() * Math.PI * 2;
    const d = 0.1 + rng() * 0.26;
    blobs.push([Math.cos(a) * d, Math.sin(a) * d, 0.08 + rng() * 0.11]);
  }
  for (let y = 0; y < CELL; y++) {
    for (let x = 0; x < CELL; x++) {
      const u = (x + 0.5) / CELL - 0.5;
      const v = (y + 0.5) / CELL - 0.5;
      let h = 0;
      for (const [bx, by, r] of blobs) {
        const d2 = (u - bx) * (u - bx) + (v - by) * (v - by);
        if (d2 < r * r) h = Math.max(h, Math.sqrt(r * r - d2) + 0.1 * (0.3 - r));
      }
      const n = noise(u * 11 + seed, v * 11, 256) * 0.6 + noise(u * 26, v * 26 + seed, 256) * 0.4;
      height[y * CELL + x] = h > 0 ? Math.min(1, h * 3.3 + (n - 0.5) * 0.16) : 0;
    }
  }
}

/** Ridged noise warping the radius: a torn outline for flame. */
function torn(height: Float32Array, seed: number, noise: ReturnType<typeof makeNoise>): void {
  for (let y = 0; y < CELL; y++) {
    for (let x = 0; x < CELL; x++) {
      const u = (x + 0.5) / CELL - 0.5;
      const v = (y + 0.5) / CELL - 0.5;
      const r = Math.hypot(u, v) * 2;
      let ridge = 0;
      let amp = 0.55;
      let f = 3;
      for (let o = 0; o < 4; o++) {
        const n = noise(u * f + seed + 9, v * f + seed, 256);
        ridge += (1 - Math.abs(n * 2 - 1)) * amp;
        amp *= 0.5;
        f *= 2.1;
      }
      const h = 1 - r * 1.28 + (ridge - 0.55) * 0.62;
      height[y * CELL + x] = Math.max(0, Math.min(1, h * 1.25));
    }
  }
}

export function buildPuffAtlas(): THREE.DataTexture {
  const noise = makeNoise(1337);
  const out = new Uint8Array(SIZE * SIZE * 4);
  const height = new Float32Array(CELL * CELL);

  for (let cell = 0; cell < 4; cell++) {
    const ox = (cell & 1) * CELL;
    const oy = (cell >> 1) * CELL;
    const seed = 11 + cell * 37;
    if (cell < 2) billow(height, seed, noise);
    else torn(height, seed, noise);

    for (let y = 0; y < CELL; y++) {
      for (let x = 0; x < CELL; x++) {
        const h = height[y * CELL + x]!;
        const hx = height[y * CELL + Math.min(CELL - 1, x + 1)]! - height[y * CELL + Math.max(0, x - 1)]!;
        const hy = height[Math.min(CELL - 1, y + 1) * CELL + x]! - height[Math.max(0, y - 1) * CELL + x]!;
        const detail = noise(x * 0.07 + seed, y * 0.07, 256) * 0.6 + noise(x * 0.16, y * 0.16 + seed, 256) * 0.4;
        const o = ((oy + y) * SIZE + ox + x) * 4;
        out[o] = h * 255;
        out[o + 1] = Math.max(0, Math.min(255, 128 + hx * 1400));
        out[o + 2] = Math.max(0, Math.min(255, 128 + hy * 1400));
        out[o + 3] = detail * 255;
      }
    }
  }

  const tex = new THREE.DataTexture(out, SIZE, SIZE, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  tex.name = 'fx.puffAtlas';
  return tex;
}
