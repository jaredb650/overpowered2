/**
 * Blood that never has to go (the gore update's P2). The decal rings are finite: a long fight overwrites its oldest
 * stains. So once a stain on a flat floor has dried, it is drawn once into a floor tile: a square of texture that covers
 * 15.9 m of one floor level and is shown by one quad in the decal draw. When the stain's own decal is later overwritten,
 * the tile still holds it, and nothing changes on screen. A tile costs the same however many stains are in it.
 *
 * - **What is kept:** the stain's outline field, at 3.2 cm a texel. Shapes from about 10 cm up survive; fine spatter
 *   does not. A tile is drawn as dried blood by the decal shader, lit like every other stain.
 * - **Levels, stairs and ramps:** a tile belongs to one floor height (to 2 cm) and its quad passes the decals' own
 *   depth test, so it shows on that floor and nowhere above or below. Only stains lying flat are baked. Blood on a
 *   ramp, a stair or a wall stays a decal and is overwritten in its turn, as before.
 * - **Sixteen tiles** in one 2048 x 2048 single-channel texture (5.6 MB with mipmaps): about 65 m by 65 m of floor in
 *   all. When a seventeenth is needed, the tile least recently added to is wiped and moved.
 * - **Switch:** `?bloodmap=0` (`DevFlags.bloodMap`) stops stains going in.
 * - **When:** a few times a second a batch of dry, not yet baked stains is drawn in; a stain overwritten before it
 *   had dried is baked on its way out.
 */
import * as THREE from 'three';
import { DevFlags } from '../core/devflags';
import { FullscreenPass } from './fullscreen';
import { Flag, cellRect, isBloodCell } from './decalSheet';

export const MapTuning = {
  /** Tiles across the texture, and pixels across a tile. */
  side: 4,
  tilePx: 512,
  /** Metres a texel. */
  texel: 0.032,
  /** Empty pixels round a tile, so mipmaps do not carry one tile's blood into the next. */
  guard: 8,
  /** Metres between floor levels that count as different. */
  level: 0.02,
  /** A stain this many seconds old has dried and can be baked with no change to how it looks. */
  dryAge: 100,
  /** Stains smaller than this (quad edge, m) are below what a tile can hold. */
  minSize: 0.09,
  /** Seconds between batches, and the stains in one. */
  every: 0.4,
  perBatch: 40,
  /** Slots looked at for dry stains each batch. */
  scan: 512,
};

export const TILES = MapTuning.side * MapTuning.side;
/** Metres of floor a tile covers. */
export const TILE_SPAN = (MapTuning.tilePx - 2 * MapTuning.guard) * MapTuning.texel;

/** The tile a floor point belongs to: its column, row and level. */
export function tileKey(x: number, y: number, z: number): [number, number, number] {
  return [Math.floor(x / TILE_SPAN), Math.floor(z / TILE_SPAN), Math.round(y / MapTuning.level)];
}

/**
 * True for a decal a tile can hold: liquid blood from the sheet (not a run, which is drawn in the shader, and not a
 * mark), lying flat, and big enough. `m` and `d` are the decal buffers, `slot` its place in them.
 */
export function bakeable(m: Float32Array, d: Float32Array, slot: number): boolean {
  const o = slot * 16;
  if (m[o + 15] !== 1 || m[o + 9]! < 0.999) return false;
  const kind = Math.floor(d[slot * 4 + 2]!) % 8;
  if (kind !== Flag.Blood && kind !== Flag.Grow) return false;
  if (!isBloodCell(Math.floor(d[slot * 4]!))) return false;
  const long = Math.hypot(m[o]!, m[o + 1]!, m[o + 2]!), wide = Math.hypot(m[o + 4]!, m[o + 5]!, m[o + 6]!);
  return Math.max(long, wide) >= MapTuning.minSize;
}

interface Tile {
  /** -1 while unused. */
  ix: number; iz: number; iy: number;
  used: number;
  live: boolean;
}

/** What the map needs from the decal system that owns it. */
export interface MapHost {
  readonly matrices: Float32Array;
  readonly data: Float32Array;
  /** World time of the decals' clock. */
  now(): number;
  /** First slot and slots in use of the rings that hold blood. */
  ranges(): readonly [number, number][];
  /** Shows tile `i` as a quad of `span` metres centred on (x, y, z), or hides it (`span` 0). */
  tile(i: number, x: number, y: number, z: number, span: number): void;
}

const FRAG = /* glsl */ `
uniform sampler2D tSheet;
uniform vec4 uCell;
uniform vec4 uQuad;
uniform vec4 uAxes;
uniform vec3 uHow;
in vec2 vUv;
out vec4 outColor;
void main() {
  // Metres from the stain's middle, then along its two edges.
  vec2 d = (vUv - uQuad.xy) * uQuad.zw;
  vec2 q = vec2(dot(d, uAxes.xy) / dot(uAxes.xy, uAxes.xy), dot(d, uAxes.zw) / dot(uAxes.zw, uAxes.zw)) + 0.5;
  if (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) discard;
  q = mix(q, 1.0 - q, uHow.yz);
  float field = texture(tSheet, uCell.xy + q * uCell.zw).a;
  // The tile keeps the outline as the sheet does: 0.5 is the edge.
  float f = clamp(0.5 + (field - uHow.x), 0.0, 1.0);
  if (f < 0.12) discard;
  outColor = vec4(f, 0.0, 0.0, 1.0);
}`;

const _rect: [number, number, number, number] = [0, 0, 0, 0];
const _clear = new THREE.Color(0, 0, 0);

export class BloodMap {
  readonly target: THREE.WebGLRenderTarget;
  private readonly tiles: Tile[] = Array.from({ length: TILES }, () => ({ ix: 0, iz: 0, iy: 0, used: -1, live: false }));
  private readonly baked: Uint8Array;
  /** Stains waiting to be drawn in: 20 floats each, a copy of the decal's matrix and data. */
  private readonly queue: Float32Array;
  private queued = 0;
  private cursor = 0;
  private nextAt = 0;
  private readonly pass: FullscreenPass;
  /** Stains drawn into tiles, and tiles wiped to make room, since the last `clear`. For checks. */
  bakedCount = 0;
  evicted = 0;

  constructor(private readonly host: MapHost, sheet: THREE.Texture | null, slots: number) {
    const px = MapTuning.side * MapTuning.tilePx;
    this.target = new THREE.WebGLRenderTarget(px, px, {
      format: THREE.RedFormat, type: THREE.UnsignedByteType, depthBuffer: false, generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
    });
    this.target.texture.name = 'bloodMap';
    this.baked = new Uint8Array(slots);
    this.queue = new Float32Array(MapTuning.perBatch * 4 * 20);
    this.pass = new FullscreenPass(FRAG, {
      tSheet: { value: sheet }, uCell: { value: new THREE.Vector4() }, uQuad: { value: new THREE.Vector4() },
      uAxes: { value: new THREE.Vector4() }, uHow: { value: new THREE.Vector3() },
    });
    const m = this.pass.material;
    // A texel keeps the most blood any stain put there.
    m.blending = THREE.CustomBlending;
    m.blendEquation = THREE.MaxEquation;
    m.blendSrc = THREE.OneFactor;
    m.blendDst = THREE.OneFactor;
  }

  get texture(): THREE.Texture {
    return this.target.texture;
  }

  /** Stains waiting to be drawn into a tile. */
  get pending(): number {
    return this.queued;
  }

  /** Where tile `i` is: its column, row and level, or null while it is unused. */
  tileAt(i: number): [number, number, number] | null {
    const t = this.tiles[i]!;
    return t.live ? [t.ix, t.iz, t.iy] : null;
  }

  /** Tiles holding blood now. */
  get liveTiles(): number {
    let n = 0;
    for (const t of this.tiles) if (t.live) n++;
    return n;
  }

  /** The decal in `slot` is about to be overwritten: if it never got into a tile, it goes in now. */
  retire(slot: number): void {
    if (DevFlags.bloodMap && !this.baked[slot] && bakeable(this.host.matrices, this.host.data, slot)) this.enqueue(slot);
    this.baked[slot] = 0;
  }

  private enqueue(slot: number): boolean {
    if (this.queued * 20 >= this.queue.length) return false;
    const o = this.queued++ * 20;
    this.queue.set(this.host.matrices.subarray(slot * 16, slot * 16 + 16), o);
    this.queue.set(this.host.data.subarray(slot * 4, slot * 4 + 4), o + 16);
    return true;
  }

  /** Looks through a stretch of the blood rings for stains that have dried and are not in a tile yet. */
  private scan(now: number): void {
    const { matrices, data } = this.host;
    let total = 0;
    const ranges = this.host.ranges();
    for (const [, live] of ranges) total += live;
    if (total === 0) return;
    let left = Math.min(MapTuning.scan, total);
    while (left-- > 0 && this.queued < MapTuning.perBatch) {
      // The cursor runs over the rings' live slots as one list.
      let k = this.cursor++ % total;
      let slot = -1;
      for (const [base, live] of ranges) {
        if (k < live) {
          slot = base + k;
          break;
        }
        k -= live;
      }
      if (slot < 0 || this.baked[slot] || now - data[slot * 4 + 1]! < MapTuning.dryAge) continue;
      if (!bakeable(matrices, data, slot)) {
        // Never will be: not looked at again until the slot is rewritten.
        this.baked[slot] = 1;
        continue;
      }
      if (this.enqueue(slot)) this.baked[slot] = 1;
    }
  }

  /** The tile for a key, moved there from wherever it was least lately used if there is none. -1 when the map is off. */
  private tileFor(ix: number, iz: number, iy: number, now: number, renderer: THREE.WebGLRenderer): number {
    let oldest = 0;
    for (let i = 0; i < TILES; i++) {
      const t = this.tiles[i]!;
      if (t.live && t.ix === ix && t.iz === iz && t.iy === iy) {
        t.used = now;
        return i;
      }
      if (!t.live) oldest = i;
      else if (this.tiles[oldest]!.live && t.used < this.tiles[oldest]!.used) oldest = i;
    }
    const t = this.tiles[oldest]!;
    if (t.live) this.evicted++;
    t.ix = ix;
    t.iz = iz;
    t.iy = iy;
    t.used = now;
    t.live = true;
    // Wiped, guard band and all.
    const n = MapTuning.tilePx;
    this.wipe(renderer, (oldest % MapTuning.side) * n, Math.floor(oldest / MapTuning.side) * n, n, n);
    this.host.tile(oldest, (ix + 0.5) * TILE_SPAN, iy * MapTuning.level, (iz + 0.5) * TILE_SPAN, TILE_SPAN);
    return oldest;
  }

  private wipe(renderer: THREE.WebGLRenderer, x: number, y: number, w: number, h: number): void {
    this.target.scissorTest = true;
    this.target.scissor.set(x, y, w, h);
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(_clear, 0);
    renderer.clear(true, false, false);
  }

  /** Bakes what is waiting. Call once a frame, before the decals are drawn. */
  flush(renderer: THREE.WebGLRenderer): void {
    if (!DevFlags.bloodMap) return;
    const now = this.host.now();
    if (now < this.nextAt && this.queued * 20 < this.queue.length) return;
    this.nextAt = now + MapTuning.every;
    this.scan(now);
    if (this.queued === 0) return;
    const t = MapTuning;
    const px = t.side * t.tilePx;
    const u = this.pass.uniforms;
    const q = this.queue;
    const keepClear = renderer.getClearColor(new THREE.Color());
    const keepAlpha = renderer.getClearAlpha();
    const keepTarget = renderer.getRenderTarget();
    for (let n = 0; n < this.queued; n++) {
      const o = n * 20;
      const cx = q[o + 12]!, cy = q[o + 13]!, cz = q[o + 14]!;
      const ax = q[o]!, az = q[o + 2]!, bx = q[o + 4]!, bz = q[o + 6]!;
      // Half the stain's reach along world X and Z.
      const hx = (Math.abs(ax) + Math.abs(bx)) * 0.5, hz = (Math.abs(az) + Math.abs(bz)) * 0.5;
      const cell = Math.floor(q[o + 16]!);
      const bits = Math.floor(Math.floor(q[o + 18]!) / 8);
      cellRect(cell, _rect);
      (u.uCell!.value as THREE.Vector4).set(_rect[0], _rect[1], _rect[2], _rect[3]);
      (u.uAxes!.value as THREE.Vector4).set(ax, az, bx, bz);
      (u.uHow!.value as THREE.Vector3).set(0.32 + 0.4 * (q[o + 16]! % 1), bits & 1, bits & 2 ? 1 : 0);
      const iy = Math.round(cy / t.level);
      for (let ix = Math.floor((cx - hx) / TILE_SPAN); ix <= Math.floor((cx + hx) / TILE_SPAN); ix++) {
        for (let iz = Math.floor((cz - hz) / TILE_SPAN); iz <= Math.floor((cz + hz) / TILE_SPAN); iz++) {
          const i = this.tileFor(ix, iz, iy, now, renderer);
          // The tile's first texel of floor, in the texture, and the stain's box inside it.
          const tx = (i % t.side) * t.tilePx + t.guard, ty = Math.floor(i / t.side) * t.tilePx + t.guard;
          const inner = t.tilePx - 2 * t.guard;
          const x0 = Math.max(0, Math.floor((cx - hx - ix * TILE_SPAN) / t.texel)), x1 = Math.min(inner, Math.ceil((cx + hx - ix * TILE_SPAN) / t.texel));
          const z0 = Math.max(0, Math.floor((cz - hz - iz * TILE_SPAN) / t.texel)), z1 = Math.min(inner, Math.ceil((cz + hz - iz * TILE_SPAN) / t.texel));
          if (x1 <= x0 || z1 <= z0) continue;
          // Where the stain's middle falls in the whole texture, and metres a unit of uv.
          (u.uQuad!.value as THREE.Vector4).set(
            (tx + (cx - ix * TILE_SPAN) / t.texel) / px, (ty + (cz - iz * TILE_SPAN) / t.texel) / px, px * t.texel, px * t.texel,
          );
          this.target.scissorTest = true;
          this.target.scissor.set(tx + x0, ty + z0, x1 - x0, z1 - z0);
          this.pass.render(renderer, this.target, true);
        }
      }
      this.bakedCount++;
    }
    this.queued = 0;
    this.target.scissorTest = false;
    renderer.setClearColor(keepClear, keepAlpha);
    renderer.setRenderTarget(keepTarget);
  }

  /** Every tile emptied and hidden. The texture is wiped the next time a tile is used. */
  clear(): void {
    for (let i = 0; i < TILES; i++) {
      const t = this.tiles[i]!;
      if (t.live) this.host.tile(i, 0, 0, 0, 0);
      t.live = false;
      t.used = -1;
    }
    this.baked.fill(0);
    this.queued = 0;
    this.cursor = 0;
    this.nextAt = 0;
    this.bakedCount = 0;
    this.evicted = 0;
  }

  dispose(): void {
    this.target.dispose();
    this.pass.dispose();
  }
}
