import * as THREE from 'three';
import type { DecalKind, DecalSystem } from '../core/contracts';
import type { MaterialPatcher, ShaderHook } from './materials/patch';
import type { BakedSet } from './materials/TextureBaker';
import {
  BIG_CELLS, BIG_ROOT, CELL, CELL_COUNT, DRAG_ASPECT, Flag, KIND_CELLS, chooseSplat, flagOf, flipsOf, isBloodCell, lipOf, printThin, type BigKind, type SplatHow,
} from './decalSheet';
import {
  DECAL_FRAG_MAIN, DECAL_FRAG_PARS, DECAL_LIGHT, DECAL_METALNESS, DECAL_NORMAL, DECAL_ROUGHNESS, DECAL_VERT_MAIN, DECAL_VERT_PARS,
} from './decalShader.glsl';

/**
 * The decal buffer is one instanced mesh and one draw call, cut into rings by kind. Each ring is a stretch of the buffer
 * with its own cursor, so a kind only ever overwrites its own oldest: bullet holes cannot erase blood, and a few big
 * stains cannot be pushed out by a thousand small ones. The order here is the order they are drawn in, bottom first:
 *
 * - `scorch`: burns. Under everything, so the blood of the man a rocket killed lands on the burn and not beneath it.
 * - `big`: large stains laid for coverage (a burst under a gib, a fan along a shot). Few, and kept longest.
 * - `blood`: every small stain, smear, run and pool. The detail on top of the big ones.
 * - `mark`: holes, exit craters, cracks and cuts. On top: a round into a bloody wall still leaves its hole.
 *
 * `capacity` is the room each ring has in the buffer and never changes. `limit` (`setLimit`, the "Mess" setting) is how
 * much of it is in use.
 */
export type DecalRing = 'scorch' | 'big' | 'blood' | 'mark';
export const DECAL_RINGS: readonly DecalRing[] = ['scorch', 'big', 'blood', 'mark'];
export const RING_CAPACITY: Readonly<Record<DecalRing, number>> = { scorch: 256, big: 256, blood: 8192, mark: 1536 };
/** Which ring a kind lives in. A new kind needs a row here and in `KIND_CELLS` (`decalSheet.ts`). */
export const RING_OF: Readonly<Record<DecalKind, DecalRing>> = {
  bullet: 'mark',
  bulletMetal: 'mark',
  bulletGlass: 'mark',
  exit: 'mark',
  slash: 'mark',
  crack: 'mark',
  scorch: 'scorch',
  soot: 'scorch',
  blood: 'blood',
  bloodPool: 'blood',
  bloodSmear: 'blood',
};
/** Every slot in the buffer, all rings together. */
export const MAX_DECALS = DECAL_RINGS.reduce((n, r) => n + RING_CAPACITY[r], 0);

/**
 * One decal that is about to be overwritten by a newer one of its ring (never called by `clear`). `matrices` holds 16
 * floats a slot from `slot * 16` (the quad's two edges, its normal and its place, as columns) and `data` 4 from
 * `slot * 4` (what each of the four is: the top of `decalShader.glsl.ts`). Read them now: the slot is rewritten as
 * soon as this returns. This is where old blood can be drawn into a floor texture before it goes.
 */
export type DecalRetire = (ring: DecalRing, matrices: Float32Array, data: Float32Array, slot: number) => void;

interface RingState {
  readonly name: DecalRing;
  /** First slot in the buffer. */
  readonly base: number;
  readonly capacity: number;
  /** Slots in use, at most `capacity`. */
  limit: number;
  /** Next slot to write, 0..limit-1, from `base`. */
  cursor: number;
  /** Slots that hold a decal. */
  live: number;
  /** Decals overwritten since the last `clear`. */
  retired: number;
  dirtyStart: number;
  dirtyCount: number;
  /** Slots from `base` to send whole on the next upload: they were emptied by `clear` or a lowered limit. */
  flush: number;
}

const _at = new THREE.Vector3();
const _dir = new THREE.Vector3();
/** A wall stain this big (quad edge, m) or bigger can start a run down the wall, and is sure to from `RUN_SURE`. */
const RUN_FROM = 0.16;
const RUN_SURE = 0.6;
/** A surface counts as a wall for runs while its normal is this flat. */
const RUN_WALL = 0.55;

declare module '../core/contracts' {
  interface DecalSystem {
    /**
     * A drop of blood arriving at `velocity`: elongated along its travel, by as much as the angle of
     * impact says, with its tail pointing the way it was going. `size` is the edge of the quad a round stain of that
     * much blood gets. `how` is what made it, where that changes the shape: a `mist` of fine specks, or a pattern laid
     * along the travel (`cast`: a line of drops off a swung blade; `arc`: an arterial wave; `trail`: drips under a
     * walking man), which is `size` long.
     */
    splat(position: THREE.Vector3, normal: THREE.Vector3, size: number, velocity: THREE.Vector3, how?: SplatHow): void;
    /**
     * Blood running down a wall from `position`, as wide as a stain of `size` would feed. Grows downward over a second
     * or two. Does nothing on a floor or ceiling. `splat` calls it by itself for big enough wall stains.
     */
    run(position: THREE.Vector3, normal: THREE.Vector3, size: number): void;
    /**
     * One big composition, `size` metres across (a `drag` is that long and two fifths as wide): the coverage a violent
     * event leaves at once, in one decal where dozens of small stains used to stand. `dir` turns it: a `fan` and a
     * `drag` start at `position` and run along it, a lopsided `burst` or `ring` throws most that way. A `sheet` on a
     * wall always hangs with its runs down. The small traced drops still land on top of it and past its edge.
     * It goes in the `big` ring, which is small and kept longest; `minor` (a single round's mark, laid many times a
     * second) puts it with the small stains instead.
     */
    big(kind: BigKind, position: THREE.Vector3, normal: THREE.Vector3, size: number, dir?: THREE.Vector3, minor?: boolean): void;
    /**
     * A boot print `size` metres long, toe along `dir`, the left foot's or the right's. `fade` 0..1 is how much of the
     * blood had gone from the sole: the lugs thin out and drop away.
     */
    print(position: THREE.Vector3, normal: THREE.Vector3, size: number, dir: THREE.Vector3, left: boolean, fade: number): void;
    /** A smear (`bloodSmear`) with less blood in it: `thin` 0.5 is as drawn, 1 the faintest. */
    wipe(position: THREE.Vector3, normal: THREE.Vector3, size: number, rotation: number, thin: number): void;
  }
}

/**
 * Surface-aligned quads in one instanced draw, lit by the same patched PBR as the world.
 * Each ring (see `DECAL_RINGS`) overwrites its own oldest first, and only the ranges touched since the last frame are uploaded.
 */
export class Decals implements DecalSystem {
  readonly mesh: THREE.InstancedMesh;
  private readonly extra: THREE.InstancedBufferAttribute;
  private readonly matrices: Float32Array;
  private readonly data: Float32Array;
  private readonly rings: RingState[] = [];
  private readonly ringOf = {} as Record<DecalKind, RingState>;
  /** Called for a decal about to be overwritten. See `DecalRetire`. */
  onRetire: DecalRetire | null = null;
  private now = 0;
  private readonly time = { value: 0 };
  private readonly proj = { value: new THREE.Vector2() };
  private readonly depth: THREE.IUniform<THREE.Texture | null> = { value: null };

  constructor(patcher: MaterialPatcher, atlas: BakedSet) {
    const geometry = new THREE.PlaneGeometry(1, 1);
    this.extra = new THREE.InstancedBufferAttribute(new Float32Array(MAX_DECALS * 4), 4);
    this.extra.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aDecal', this.extra);
    const material = new THREE.MeshStandardMaterial({
      name: 'decals', roughness: 1, metalness: 1, transparent: true, depthWrite: false, depthTest: false,
      // Leaves destination alpha alone: it holds the floor's reflectivity, and wet stays wet under blood.
      blending: THREE.CustomBlending, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    });
    const own = { opDecalA: { value: atlas.albedo }, opDecalS: { value: atlas.surface }, opDepth: this.depth, opProj: this.proj, opWorldTime: this.time };
    const hook: ShaderHook = shader => {
      Object.assign(shader.uniforms, own);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${DECAL_VERT_PARS}`)
        .replace('#include <uv_vertex>', `#include <uv_vertex>\n${DECAL_VERT_MAIN}`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <map_pars_fragment>', `#include <map_pars_fragment>\n${DECAL_FRAG_PARS}`)
        .replace('#include <map_fragment>', DECAL_FRAG_MAIN)
        .replace('#include <roughnessmap_fragment>', DECAL_ROUGHNESS)
        .replace('#include <metalnessmap_fragment>', DECAL_METALNESS)
        .replace('#include <normal_fragment_maps>', DECAL_NORMAL)
        .replace('#include <lights_fragment_end>', DECAL_LIGHT);
    };
    patcher.apply(material, hook, 'decals');
    this.mesh = new THREE.InstancedMesh(geometry, material, MAX_DECALS);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = -10;
    this.matrices = this.mesh.instanceMatrix.array as Float32Array;
    this.data = this.extra.array as Float32Array;
    // An empty slot is a quad of no size (all zeros), so the draw can run to the last slot in use without drawing it.
    this.matrices.fill(0);
    let base = 0;
    for (const name of DECAL_RINGS) {
      const capacity = RING_CAPACITY[name];
      this.rings.push({ name, base, capacity, limit: capacity, cursor: 0, live: 0, retired: 0, dirtyStart: -1, dirtyCount: 0, flush: 0 });
      base += capacity;
    }
    for (const kind of Object.keys(RING_OF) as DecalKind[]) this.ringOf[kind] = this.rings[DECAL_RINGS.indexOf(RING_OF[kind])]!;
  }

  /** How many decals a ring holds now. */
  live(ring: DecalRing): number {
    return this.ring(ring).live;
  }

  /** Decals in all rings together. `mesh.count` is not this: it is how far the draw runs. */
  get total(): number {
    let n = 0;
    for (const r of this.rings) n += r.live;
    return n;
  }

  /** A ring's first slot in the buffer. */
  base(ring: DecalRing): number {
    return this.ring(ring).base;
  }

  /** How many a ring may hold: `capacity` unless `setLimit` lowered it. */
  limit(ring: DecalRing): number {
    return this.ring(ring).limit;
  }

  /** Decals of a ring overwritten by newer ones since the last `clear`: 0 means nothing has been erased yet. */
  retired(ring: DecalRing): number {
    return this.ring(ring).retired;
  }

  /**
   * Sets how many slots of a ring are in use, 1 to its capacity. Lowering it drops what lay past the new end (without
   * `onRetire`: the player asked for less) and the ring goes on from its start.
   */
  setLimit(ring: DecalRing, limit: number): void {
    const r = this.ring(ring);
    const next = Math.max(1, Math.min(r.capacity, Math.floor(limit)));
    if (next === r.limit) return;
    if (r.live > next) {
      this.matrices.fill(0, (r.base + next) * 16, (r.base + r.live) * 16);
      r.flush = Math.max(r.flush, r.live);
      r.live = next;
    }
    // A ring with room left always writes at its end; a full one that is given room goes on from there.
    if (r.cursor >= next || r.live < next) r.cursor = r.live % next;
    // Writes waiting to be sent were counted against the old limit: send the ring whole instead.
    if (r.dirtyCount > 0) {
      r.flush = Math.max(r.flush, r.limit);
      r.dirtyStart = -1;
      r.dirtyCount = 0;
    }
    r.limit = next;
  }

  private ring(name: DecalRing): RingState {
    return this.rings[DECAL_RINGS.indexOf(name)]!;
  }

  /** The draw covers every slot up to the last one in use. */
  private recount(): void {
    let end = 0;
    for (const r of this.rings) if (r.live > 0) end = r.base + r.live;
    this.mesh.count = end;
  }

  add(kind: DecalKind, position: THREE.Vector3, normal: THREE.Vector3, size: number, rotation = Math.random() * Math.PI * 2): void {
    const [first, variants] = KIND_CELLS[kind];
    this.lay(this.ringOf[kind], first + Math.floor(Math.random() * variants), flagOf(kind), position, normal, size, size, rotation);
  }

  /** How many cells the sheet has. */
  readonly cellCount = CELL_COUNT;

  /** One named cell of the sheet, `age` seconds old. For the sheet's own pictures and tests. */
  stamp(cell: number, position: THREE.Vector3, normal: THREE.Vector3, size: number, rotation = 0, age = 0, thin = 0.5): void {
    const flag = isBloodCell(cell) ? Flag.Blood : Flag.Mark;
    const now = this.now;
    this.now = now - age;
    const ring = cell >= CELL.scorch ? 'scorch' : flag === Flag.Mark ? 'mark' : cell >= CELL.burst ? 'big' : 'blood';
    this.lay(this.ring(ring), cell, flag, position, normal, size, size, rotation, thin, 0);
    this.now = now;
  }

  /** A quad of `wide` by `long` lying on the surface, its +X turned `rotation` from the surface's own tangent. */
  private lay(
    r: RingState, cell: number, flag: Flag, position: THREE.Vector3, normal: THREE.Vector3, long: number, wide: number, rotation: number,
    thin = 0.42 + Math.random() * 0.16, flips = -1,
  ): void {
    const inv = 1 / Math.hypot(normal.x, normal.y, normal.z);
    const nx = normal.x * inv, ny = normal.y * inv, nz = normal.z * inv;
    // Tangent from whichever world axis is least aligned with the normal.
    let tx: number, ty: number, tz: number;
    if (Math.abs(ny) < 0.9) {
      const l = 1 / Math.hypot(nz, nx);
      tx = nz * l;
      ty = 0;
      tz = -nx * l;
    } else {
      const l = 1 / Math.hypot(ny, nz);
      tx = 0;
      ty = -nz * l;
      tz = ny * l;
    }
    const bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;
    const c = Math.cos(rotation), s = Math.sin(rotation);
    this.write(
      r, cell, flag, position, nx, ny, nz,
      (tx * c + bx * s) * long, (ty * c + by * s) * long, (tz * c + bz * s) * long,
      (-tx * s + bx * c) * wide, (-ty * s + by * c) * wide, (-tz * s + bz * c) * wide,
      lipOf(cell, Math.min(long, wide)), thin, flips,
    );
  }

  splat(position: THREE.Vector3, normal: THREE.Vector3, size: number, velocity: THREE.Vector3, how: SplatHow = 'drop'): void {
    const inv = 1 / Math.hypot(normal.x, normal.y, normal.z);
    const nx = normal.x * inv, ny = normal.y * inv, nz = normal.z * inv;
    const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
    const into = -(velocity.x * nx + velocity.y * ny + velocity.z * nz);
    let tx = velocity.x + nx * into, ty = velocity.y + ny * into, tz = velocity.z + nz * into;
    const skim = Math.hypot(tx, ty, tz);
    if (how === 'drop') this.feedRun(position, normal, ny, size);
    const pick = chooseSplat(size, skim < 0.01 ? 0 : speed, into, Math.random(), how);
    if (speed < 0.01 || skim < 0.01) {
      this.lay(this.ringOf.blood, pick.cell, Flag.Blood, position, normal, pick.long, pick.wide, Math.random() * Math.PI * 2);
      return;
    }
    tx /= skim;
    ty /= skim;
    tz /= skim;
    const { long, wide, cell } = pick;
    const off = pick.lead * long;
    _at.set(position.x + tx * off, position.y + ty * off, position.z + tz * off);
    this.write(
      this.ringOf.blood, cell, Flag.Blood, _at, nx, ny, nz,
      tx * long, ty * long, tz * long,
      (ny * tz - nz * ty) * wide, (nz * tx - nx * tz) * wide, (nx * ty - ny * tx) * wide,
      lipOf(cell, Math.min(long, wide)),
    );
  }

  big(kind: BigKind, position: THREE.Vector3, normal: THREE.Vector3, size: number, dir?: THREE.Vector3, minor = false): void {
    const r = this.ring(minor ? 'blood' : 'big');
    const [first, variants] = BIG_CELLS[kind];
    const cell = first + Math.floor(Math.random() * variants);
    const inv = 1 / Math.hypot(normal.x, normal.y, normal.z);
    const nx = normal.x * inv, ny = normal.y * inv, nz = normal.z * inv;
    const long = size;
    const wide = kind === 'drag' ? size / DRAG_ASPECT : size;
    let tx = 0, ty = 0, tz = 0;
    const wall = Math.abs(ny) < 0.6;
    if (kind === 'sheet' && wall) {
      // Across the wall, so the cell's own up is the world's and its runs hang down.
      const l = 1 / Math.hypot(nz, nx);
      tx = nz * l;
      tz = -nx * l;
    } else if (dir) {
      const into = dir.x * nx + dir.y * ny + dir.z * nz;
      tx = dir.x - nx * into;
      ty = dir.y - ny * into;
      tz = dir.z - nz * into;
    }
    const tl = Math.hypot(tx, ty, tz);
    if (tl < 1e-3) {
      this.lay(r, cell, Flag.Blood, position, normal, long, wide, Math.random() * Math.PI * 2);
      return;
    }
    tx /= tl;
    ty /= tl;
    tz /= tl;
    // A fan and a drag are drawn from their left edge: the caller's point is where they start.
    const off = BIG_ROOT[kind] * long;
    _at.set(position.x + tx * off, position.y + ty * off, position.z + tz * off);
    this.write(
      r, cell, Flag.Blood, _at, nx, ny, nz,
      tx * long, ty * long, tz * long,
      (ny * tz - nz * ty) * wide, (nz * tx - nx * tz) * wide, (nx * ty - ny * tx) * wide,
      lipOf(cell, wide),
    );
  }

  print(position: THREE.Vector3, normal: THREE.Vector3, size: number, dir: THREE.Vector3, left: boolean, fade: number): void {
    const inv = 1 / Math.hypot(normal.x, normal.y, normal.z);
    const nx = normal.x * inv, ny = normal.y * inv, nz = normal.z * inv;
    const into = dir.x * nx + dir.y * ny + dir.z * nz;
    let tx = dir.x - nx * into, ty = dir.y - ny * into, tz = dir.z - nz * into;
    const tl = Math.hypot(tx, ty, tz);
    if (tl < 1e-3) return;
    tx /= tl;
    ty /= tl;
    tz /= tl;
    // Now and then the foot slid as it came down. The sole is a third as wide as it is long; the cell is square.
    const cell = CELL.print + (Math.random() < 0.2 ? 1 : 0);
    this.write(
      this.ringOf.blood, cell, Flag.Blood, position, nx, ny, nz,
      tx * size, ty * size, tz * size,
      (ny * tz - nz * ty) * size, (nz * tx - nx * tz) * size, (nx * ty - ny * tx) * size,
      lipOf(cell, size), printThin(fade), left ? 2 : 0,
    );
  }

  wipe(position: THREE.Vector3, normal: THREE.Vector3, size: number, rotation: number, thin: number): void {
    const [first, variants] = KIND_CELLS.bloodSmear;
    this.lay(this.ringOf.blood, first + Math.floor(Math.random() * variants), Flag.Blood, position, normal, size, size, rotation, thin);
  }

  /** A big enough stain on a wall runs. Bigger stains feed more runs. */
  private feedRun(position: THREE.Vector3, normal: THREE.Vector3, ny: number, size: number): void {
    if (Math.abs(ny) > RUN_WALL || size < RUN_FROM) return;
    const odds = (size - RUN_FROM) / (RUN_SURE - RUN_FROM);
    let runs = Math.floor(odds) + (Math.random() < odds % 1 ? 1 : 0);
    runs = Math.min(runs, 3);
    for (let i = 0; i < runs; i++) {
      _at.copy(position);
      if (i > 0) _at.y += (Math.random() - 0.5) * size * 0.3;
      this.run(_at, normal, size * (i === 0 ? 1 : 0.6));
    }
  }

  run(position: THREE.Vector3, normal: THREE.Vector3, size: number): void {
    const inv = 1 / Math.hypot(normal.x, normal.y, normal.z);
    const nx = normal.x * inv, ny = normal.y * inv, nz = normal.z * inv;
    if (Math.abs(ny) > RUN_WALL) return;
    // Down the wall: gravity with the part into the wall taken out.
    let dx = ny * nx, dy = -1 + ny * ny, dz = ny * nz;
    const dl = Math.hypot(dx, dy, dz);
    dx /= dl;
    dy /= dl;
    dz /= dl;
    const long = Math.min(Math.max(size * (2 + Math.random() * 3.5), 0.18), 1.4);
    const wide = Math.min(Math.max(size * (0.08 + Math.random() * 0.1), 0.014), 0.08);
    // Off to one side of the stain and starting inside it, so it reads as running out of it.
    const side = (Math.random() - 0.5) * size * 0.45;
    // Across it: the normal crossed with down, so the quad faces out of the wall.
    const sx = ny * dz - nz * dy, sy = nz * dx - nx * dz, sz = nx * dy - ny * dx;
    const start = long * 0.5 - size * 0.12;
    _at.set(
      position.x + dx * start + sx * side,
      position.y + dy * start + sy * side,
      position.z + dz * start + sz * side,
    );
    this.write(
      this.ringOf.blood, 0, Flag.Run, _at, nx, ny, nz,
      dx * long, dy * long, dz * long,
      sx * wide, sy * wide, sz * wide,
      long / wide, 0.5, 0,
    );
  }

  /**
   * Writes one instance. `a` and `b` are the quad's edges, already scaled. `w` is the wet lip's width for blood
   * (`lipOf`) or a run's length over its width. `thin`: 0.5 is the outline as drawn, less is fuller, more is thinner.
   * `flips`: 1 mirrors the cell in X, 2 in Y; -1 picks from what the cell allows.
   */
  private write(
    r: RingState, cell: number, flag: Flag, position: THREE.Vector3, nx: number, ny: number, nz: number,
    ax: number, ay: number, az: number, bx: number, by: number, bz: number, w: number,
    thin = 0.42 + Math.random() * 0.16, flips = -1,
  ): void {
    const i = r.base + r.cursor;
    if (r.live === r.limit) {
      r.retired++;
      if (this.onRetire) this.onRetire(r.name, this.matrices, this.data, i);
    } else {
      r.live++;
      const end = r.base + r.live;
      if (end > this.mesh.count) this.mesh.count = end;
    }
    const m = this.matrices;
    const o = i * 16;
    m[o] = ax;
    m[o + 1] = ay;
    m[o + 2] = az;
    m[o + 3] = 0;
    m[o + 4] = bx;
    m[o + 5] = by;
    m[o + 6] = bz;
    m[o + 7] = 0;
    m[o + 8] = nx;
    m[o + 9] = ny;
    m[o + 10] = nz;
    m[o + 11] = 0;
    m[o + 12] = position.x + nx * 0.002;
    m[o + 13] = position.y + ny * 0.002;
    m[o + 14] = position.z + nz * 0.002;
    m[o + 15] = 1;
    if (flips < 0) flips = flipsOf(cell) & Math.floor(Math.random() * 4);
    const d = i * 4;
    this.data[d] = cell + Math.min(Math.max(thin, 0), 1) * 0.9;
    this.data[d + 1] = this.now;
    // Whole part: what it is and how it is mirrored. Fraction: this decal's own seed for the shader.
    this.data[d + 2] = flag + flips * 4 + Math.random() * 0.99;
    this.data[d + 3] = w;

    if (r.dirtyStart < 0) r.dirtyStart = r.cursor;
    r.dirtyCount = Math.min(r.dirtyCount + 1, r.limit);
    r.cursor = (r.cursor + 1) % r.limit;
  }

  clear(): void {
    for (const r of this.rings) {
      if (r.live > 0) {
        this.matrices.fill(0, r.base * 16, (r.base + r.live) * 16);
        r.flush = Math.max(r.flush, r.live);
      }
      r.dirtyStart = -1;
      r.dirtyCount = 0;
      r.cursor = 0;
      r.live = 0;
      r.retired = 0;
    }
    // The zeroed slots still have to reach the GPU, so the draw keeps its length until `update` has sent them.
  }

  /** Uploads what changed and prepares the draw. */
  update(worldTime: number, depth: THREE.Texture, camera: THREE.PerspectiveCamera): void {
    this.now = worldTime;
    this.time.value = worldTime;
    this.depth.value = depth;
    const e = camera.projectionMatrix.elements;
    this.proj.value.set(e[10]!, e[14]!);
    let any = false;
    for (const r of this.rings) {
      if (r.dirtyCount === 0 && r.flush === 0) continue;
      if (!any) {
        this.mesh.instanceMatrix.clearUpdateRanges();
        this.extra.clearUpdateRanges();
        any = true;
      }
      if (r.flush > 0) {
        this.mesh.instanceMatrix.addUpdateRange(r.base * 16, r.flush * 16);
        this.extra.addUpdateRange(r.base * 4, r.flush * 4);
        r.flush = 0;
      }
      if (r.dirtyCount > 0) {
        // A ring's dirty stretch can wrap past its end: then it is two ranges.
        const start = r.dirtyStart;
        const count = r.dirtyCount;
        const first = Math.min(count, r.limit - start);
        this.mesh.instanceMatrix.addUpdateRange((r.base + start) * 16, first * 16);
        this.extra.addUpdateRange((r.base + start) * 4, first * 4);
        if (first < count) {
          this.mesh.instanceMatrix.addUpdateRange(r.base * 16, (count - first) * 16);
          this.extra.addUpdateRange(r.base * 4, (count - first) * 4);
        }
        r.dirtyStart = -1;
        r.dirtyCount = 0;
      }
    }
    if (!any) return;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.extra.needsUpdate = true;
    this.recount();
  }
}
