import * as THREE from 'three';
import type { LightVolumeBakeInput } from '../../core/contracts';
import type { EngineUniforms } from '../engine';
import type { BakeJob, BakeResult } from './bakeCore';

const DEFAULT_CELL = 1.5;
const MAX_DIMS = [200, 48, 200] as const;
/** Per-frame budget for the isSolid sweep, which has to run on the main thread. */
const SLICE_MS = 10;
/** Keep the fine occupancy sweep inside this many seconds, by dropping to one sample per voxel if needed. */
const OCCUPANCY_BUDGET_S = 3;

const yieldToBrowser = () => new Promise<void>(resolve => setTimeout(resolve, 0));

function texture3D(data: Uint16Array, nx: number, ny: number, nz: number): THREE.Data3DTexture {
  const t = new THREE.Data3DTexture(data, nx, ny, nz);
  t.format = THREE.RGBAFormat;
  t.type = THREE.HalfFloatType;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = t.wrapR = THREE.ClampToEdgeWrapping;
  t.unpackAlignment = 1;
  t.needsUpdate = true;
  return t;
}

export interface BakeStats {
  dims: [number, number, number];
  cell: [number, number, number];
  sub: number;
  occupancyMs: number;
  workerMs: number;
}

/**
 * Owns the 3D textures that every lit material and the fog sample. Before a bake it holds one cell of
 * flat blue-hour ambient, so anything rendered early still has plausible light.
 */
export class LightVolume {
  stats: BakeStats | null = null;
  /** The sky colours the bake integrates. Linear irradiance-scale radiance. */
  skyZenith: [number, number, number] = [0.05, 0.068, 0.108];
  skyHorizon: [number, number, number] = [0.135, 0.175, 0.225];
  bounce = 0.8;

  constructor(private readonly engine: EngineUniforms) {
    this.setDefault();
  }

  private setDefault(): void {
    const c0 = new Uint16Array(4);
    const h = (v: number) => THREE.DataUtils.toHalfFloat(v);
    c0[0] = h(0.09);
    c0[1] = h(0.14);
    c0[2] = h(0.22);
    c0[3] = h(1);
    const up = (v: number) => {
      const d = new Uint16Array(4);
      d[1] = h(v);
      return d;
    };
    this.assign([c0, up(0.05), up(0.08), up(0.14)], 1, 1, 1);
    this.engine.opVolOrigin.value.set(-1e4, -1e4, -1e4);
    this.engine.opVolInvSize.value.setScalar(0.5e-4);
    this.engine.opVolInfo.value.set(1, 0);
  }

  private assign(data: Uint16Array[], nx: number, ny: number, nz: number): void {
    const e = this.engine;
    e.opVol0.value?.dispose();
    e.opVol1.value?.dispose();
    e.opVol2.value?.dispose();
    e.opVol3.value?.dispose();
    e.opVol0.value = texture3D(data[0]!, nx, ny, nz);
    e.opVol1.value = texture3D(data[1]!, nx, ny, nz);
    e.opVol2.value = texture3D(data[2]!, nx, ny, nz);
    e.opVol3.value = texture3D(data[3]!, nx, ny, nz);
  }

  async bake(input: LightVolumeBakeInput): Promise<void> {
    const { bounds, lights, isSolid } = input;
    const size = bounds.getSize(new THREE.Vector3());
    const target = input.voxelSize ?? DEFAULT_CELL;
    const nx = Math.min(MAX_DIMS[0], Math.max(2, Math.ceil(size.x / target)));
    const ny = Math.min(MAX_DIMS[1], Math.max(2, Math.ceil(size.y / target)));
    const nz = Math.min(MAX_DIMS[2], Math.max(2, Math.ceil(size.z / target)));
    const cell: [number, number, number] = [size.x / nx, size.y / ny, size.z / nz];
    const origin: [number, number, number] = [bounds.min.x, bounds.min.y, bounds.min.z];

    // isSolid is a closure into the world, so it cannot move to the worker. Time it to decide how
    // finely this map can afford to sample, then sweep in slices so the page stays alive.
    const t0 = performance.now();
    const probe = () => {
      const start = performance.now();
      for (let i = 0; i < 4000; i++) isSolid(origin[0] + (i * 7.31 % size.x), origin[1] + (i * 3.17 % size.y), origin[2] + (i * 11.7 % size.z));
      return (performance.now() - start) / 4000 / 1000;
    };
    probe();
    const perCall = probe();
    const sub = perCall * nx * ny * nz * 8 > OCCUPANCY_BUDGET_S ? 1 : 2;

    const fx = nx * sub, fy = ny * sub, fz = nz * sub;
    const solid = new Uint8Array(fx * fy * fz);
    const fcx = cell[0] / sub, fcy = cell[1] / sub, fcz = cell[2] / sub;
    let sliceStart = performance.now();
    let i = 0;
    for (let z = 0; z < fz; z++) {
      const wz = origin[2] + (z + 0.5) * fcz;
      for (let y = 0; y < fy; y++) {
        const wy = origin[1] + (y + 0.5) * fcy;
        for (let x = 0; x < fx; x++, i++) {
          solid[i] = isSolid(origin[0] + (x + 0.5) * fcx, wy, wz) ? 1 : 0;
        }
      }
      if (performance.now() - sliceStart > SLICE_MS) {
        await yieldToBrowser();
        sliceStart = performance.now();
      }
    }
    const t1 = performance.now();

    const packed = new Float32Array(lights.length * 8);
    const c = new THREE.Color();
    lights.forEach((l, n) => {
      c.set(l.color);
      packed.set([l.position.x, l.position.y, l.position.z, c.r, c.g, c.b, l.intensity, l.radius], n * 8);
    });

    const job: BakeJob = {
      nx, ny, nz, sub, solid, origin, cell, lights: packed,
      skyZenith: this.skyZenith, skyHorizon: this.skyHorizon, bounce: this.bounce,
    };
    const result = await new Promise<BakeResult>((resolve, reject) => {
      const worker = new Worker(new URL('./bake.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<{ result?: BakeResult }>) => {
        if (!e.data.result) return;
        worker.terminate();
        resolve(e.data.result);
      };
      worker.onerror = e => {
        worker.terminate();
        reject(new Error(`light volume worker failed: ${e.message}`));
      };
      worker.postMessage(job, [solid.buffer]);
    });
    const t2 = performance.now();

    this.assign(result.textures, nx, ny, nz);
    this.engine.opVolOrigin.value.copy(bounds.min);
    this.engine.opVolInvSize.value.set(1 / size.x, 1 / size.y, 1 / size.z);
    this.engine.opVolInfo.value.set(Math.max(...cell), Math.max(...cell) * 0.6);
    this.stats = { dims: [nx, ny, nz], cell, sub, occupancyMs: t1 - t0, workerMs: t2 - t1 };
  }
}
