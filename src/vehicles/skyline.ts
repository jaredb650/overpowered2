/**
 * How high the map stands, for anything flying over it. A single ray down tells a pilot what he is over and nothing about
 * the tower ahead: the Harrow flew 22 m into the Crucible's structures on exactly that. So the top of the map is read
 * once into a coarse grid, and each cell is widened to the tallest thing within a rotor's reach. Lookups then cost
 * nothing, and a pilot can check his whole path every frame.
 *
 * The map's solid shape never changes during a run, so this is built once, and `run:start` is where the cost is hidden.
 */
import type * as THREE from 'three';
import type { Ctx } from '../core/contracts';
import type { GroundProbe } from '../progression/callins/ground';

const CELL = 8;
/** Cells each way a height spreads: 16 m covers the widest rotor with some air to spare. */
const REACH = 2;
/** How many points along a path to check. */
const PATH_STEPS = 4;

export class Skyline {
  private cells: Float32Array | null = null;
  private nx = 0;
  private nz = 0;
  private minX = 0;
  private minZ = 0;
  private readonly start: number;
  private readonly drop: number;

  constructor(ctx: Ctx, private readonly probe: GroundProbe, private readonly bounds = ctx.world.bounds) {
    this.start = bounds.max.y - 1;
    this.drop = this.start - bounds.min.y;
  }

  /** The surface straight below, or 0 over nothing. */
  ground(x: number, z: number): number {
    const h = this.probe.heightAt(x, this.start, z, this.drop);
    // A ray that starts inside the invisible walls past the map's edge reports a hit at once.
    return Number.isNaN(h) || h >= this.start - 0.5 ? 0 : h;
  }

  build(): void {
    if (this.cells) return;
    const { bounds } = this;
    this.minX = bounds.min.x;
    this.minZ = bounds.min.z;
    this.nx = Math.ceil((bounds.max.x - bounds.min.x) / CELL) + 1;
    this.nz = Math.ceil((bounds.max.z - bounds.min.z) / CELL) + 1;
    const { nx, nz } = this;
    const raw = new Float32Array(nx * nz);
    for (let z = 0; z < nz; z++) {
      for (let x = 0; x < nx; x++) raw[z * nx + x] = this.ground(this.minX + x * CELL, this.minZ + z * CELL);
    }
    const wide = new Float32Array(nx * nz);
    for (let z = 0; z < nz; z++) {
      for (let x = 0; x < nx; x++) {
        let top = 0;
        for (let dz = Math.max(0, z - REACH); dz <= Math.min(nz - 1, z + REACH); dz++) {
          for (let dx = Math.max(0, x - REACH); dx <= Math.min(nx - 1, x + REACH); dx++) top = Math.max(top, raw[dz * nx + dx]!);
        }
        wide[z * nx + x] = top;
      }
    }
    this.cells = wide;
  }

  /** The tallest thing near a point. */
  at(x: number, z: number): number {
    this.build();
    const cx = Math.round((x - this.minX) / CELL);
    const cz = Math.round((z - this.minZ) / CELL);
    if (cx < 0 || cz < 0 || cx >= this.nx || cz >= this.nz) return 0;
    return this.cells![cz * this.nx + cx]!;
  }

  /** The tallest thing from here to where `velocity` will be in `seconds`. */
  along(position: THREE.Vector3, velocity: THREE.Vector3, seconds: number): number {
    let top = this.at(position.x, position.z);
    for (let i = 1; i <= PATH_STEPS; i++) {
      const t = (seconds * i) / PATH_STEPS;
      top = Math.max(top, this.at(position.x + velocity.x * t, position.z + velocity.z * t));
    }
    return top;
  }
}
