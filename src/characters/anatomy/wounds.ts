/**
 * The wounds on one body, in bind space, stored where the shaders read them: spare texels at the end of the bone
 * texture, which is uploaded per skeleton already. Pure data, with no three.js, so merging can be tested in Node.
 *
 * A wound is a slot cut through the body along `axis`, not a sphere. Hit capsules only roughly follow the skin, so a
 * sphere at the hit point can sit under the surface and cut nothing, or sit proud of it. A slot only has to be right
 * sideways, which the shot's own line is, and it needs nothing on the CPU to find the skin.
 */

/** Three texels each: `a` and radius; `b` and raggedness; axis times depth, and a code. */
export const WOUND_TEXELS = 3;
/** With 37 bones a 16 x 16 bone texture has room for 35 of these. Going past that makes every skeleton's upload bigger. */
export const MAX_WOUNDS = 32;

export const WoundKind = {
  /** A clean puncture. */
  hole: 0,
  /** Where a round came out: ragged, and pushed out and open. */
  exit: 1,
  /** Tissue gone. The surface round it sinks in. */
  crater: 2,
  /** Long, straight and clean. `a` to `b` runs along the skin. */
  gash: 3,
  /** Charred and split, nothing removed. */
  burn: 4,
  /** Blood and bruising, nothing removed. */
  graze: 5,
  /** Machines: the plating is punched in. Nothing to see behind it, so nothing is removed. */
  dent: 6,
} as const;
export type WoundKindId = (typeof WoundKind)[keyof typeof WoundKind];

/** Which parts of the body a wound may touch. In the A-pose an arm lies inside a chest wound's slot, and a thigh inside the other's. */
export const WoundRegion = { trunk: 1, armL: 2, armR: 4, legL: 8, legR: 16, all: 31 } as const;

/** One wound on its way in. All in bind space, and `axis` is a unit vector pointing into the body. */
export interface WoundSpec {
  kind: WoundKindId;
  ax: number; ay: number; az: number;
  /** The far end of a gash. Equal to `a` for anything round. */
  bx: number; by: number; bz: number;
  nx: number; ny: number; nz: number;
  radius: number;
  depth: number;
  /** 0 a clean edge, 1 torn. */
  ragged: number;
  regions: number;
  /** The largest this may grow to by merging. */
  limit: number;
}

export const newWoundSpec = (): WoundSpec => ({
  kind: WoundKind.hole, ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, nx: 0, ny: 0, nz: 1, radius: 0.02, depth: 0.05, ragged: 0, regions: WoundRegion.all, limit: 0.2,
});

/** Radius a merged hole has to reach before it counts as tissue gone. */
const CRATER_FROM = 0.03;
/** Holes this much closer than their combined radii are one hole. */
const MERGE_REACH = 0.85;
const MERGE_SLACK = 0.006;
/** Share of a new wound's area that a merge adds. Under 1, because most of it lands on what is already gone. */
const MERGE_AREA = 0.8;
/** The two sides of a limb lie close together in bind space. A wound on the far side must stay its own. */
const MERGE_FACING = -0.15;
/** Each merge digs deeper by this share of what it added. */
const MERGE_DIG = 0.3;
const MAX_DEPTH = 0.2;

const cuts = (kind: number): boolean => kind <= WoundKind.crater;

export class WoundBook {
  count = 0;
  /** Wounds that took something away, so that there is an inside to draw. */
  open = 0;
  private readonly limits = new Float32Array(MAX_WOUNDS);

  /**
   * @param data The bone texture's array.
   * @param base Float offset of the first wound.
   * @param onCount Told whenever the count changes, so the shaders can read it.
   */
  constructor(private readonly data: Float32Array, private readonly base: number, private readonly onCount: (count: number) => void) {}

  private at(i: number): number {
    return this.base + i * WOUND_TEXELS * 4;
  }

  kind(i: number): number {
    return Math.floor(this.data[this.at(i) + 11]!) & 7;
  }

  radius(i: number): number {
    return this.data[this.at(i) + 3]!;
  }

  depth(i: number): number {
    const o = this.at(i);
    return Math.hypot(this.data[o + 8]!, this.data[o + 9]!, this.data[o + 10]!);
  }

  add(w: WoundSpec): void {
    if (this.mergeInto(w)) return;
    if (this.count === MAX_WOUNDS) this.makeRoom();
    this.write(this.count, w);
    this.limits[this.count] = w.limit;
    this.count++;
    this.recount();
  }

  /** Copies another book's wounds across, for a limb leaving its body. The caller has already copied the texels. */
  adopt(from: WoundBook): void {
    this.count = from.count;
    this.open = from.open;
    this.limits.set(from.limits);
  }

  clear(): void {
    this.count = 0;
    this.open = 0;
  }

  private recount(): void {
    let open = 0;
    for (let i = 0; i < this.count; i++) if (cuts(this.kind(i)) || this.kind(i) === WoundKind.gash) open++;
    this.open = open;
    this.onCount(this.count);
  }

  private write(i: number, w: WoundSpec): void {
    const d = this.data;
    const o = this.at(i);
    d[o] = w.ax; d[o + 1] = w.ay; d[o + 2] = w.az; d[o + 3] = w.radius;
    d[o + 4] = w.bx; d[o + 5] = w.by; d[o + 6] = w.bz; d[o + 7] = w.ragged;
    d[o + 8] = w.nx * w.depth; d[o + 9] = w.ny * w.depth; d[o + 10] = w.nz * w.depth;
    d[o + 11] = w.kind + w.regions * 8;
  }

  /** Whether wound `i` takes `kind` into itself. */
  private accepts(i: number, kind: number): boolean {
    const mine = this.kind(i);
    if (kind === WoundKind.gash || mine === WoundKind.gash) return false;
    if (cuts(kind)) return cuts(mine);
    return kind === mine;
  }

  private mergeInto(w: WoundSpec): boolean {
    const d = this.data;
    for (let i = 0; i < this.count; i++) {
      if (!this.accepts(i, w.kind)) continue;
      const o = this.at(i);
      if ((Math.floor(d[o + 11]!) >> 3 & w.regions) === 0) continue;
      const r = d[o + 3]!;
      const dist = Math.hypot(d[o]! - w.ax, d[o + 1]! - w.ay, d[o + 2]! - w.az);
      if (dist > (r + w.radius) * MERGE_REACH + MERGE_SLACK) continue;
      const depth = Math.hypot(d[o + 8]!, d[o + 9]!, d[o + 10]!) || 1;
      if ((d[o + 8]! * w.nx + d[o + 9]! * w.ny + d[o + 10]! * w.nz) / depth < MERGE_FACING) continue;
      this.merge(i, w.ax, w.ay, w.az, w.radius, w.depth, w.ragged, w.nx, w.ny, w.nz, w.kind, w.regions);
      this.recount();
      return true;
    }
    return false;
  }

  /** Grows wound `i` over another. The wound keeps its slot, so nothing new has to be found for it. */
  private merge(i: number, x: number, y: number, z: number, r2: number, depth2: number, ragged2: number, nx: number, ny: number, nz: number, kind2: number, regions2: number): void {
    const d = this.data;
    const o = this.at(i);
    const r1 = d[o + 3]!;
    const limit = this.limits[i]!;
    const w1 = r1 * r1;
    const w2 = r2 * r2;
    const share = w2 / (w1 + w2);
    const cx = d[o]! + (x - d[o]!) * share;
    const cy = d[o + 1]! + (y - d[o + 1]!) * share;
    const cz = d[o + 2]! + (z - d[o + 2]!) * share;
    // Wide enough to cover both, or the area of both, whichever is more.
    const reach = Math.hypot(x - d[o]!, y - d[o + 1]!, z - d[o + 2]!);
    const grown = Math.max(Math.sqrt(w1 + w2 * MERGE_AREA), (reach + r1 + r2) * 0.5);
    const radius = Math.min(Math.max(r1, limit), grown);
    const depth1 = Math.hypot(d[o + 8]!, d[o + 9]!, d[o + 10]!);
    const depth = Math.min(MAX_DEPTH, Math.max(depth1, depth2) + (radius - r1) * MERGE_DIG);
    let ax = d[o + 8]! / (depth1 || 1) * w1 + nx * w2;
    let ay = d[o + 9]! / (depth1 || 1) * w1 + ny * w2;
    let az = d[o + 10]! / (depth1 || 1) * w1 + nz * w2;
    const l = 1 / (Math.hypot(ax, ay, az) || 1);
    ax *= l; ay *= l; az *= l;
    const code = Math.floor(d[o + 11]!);
    let kind = code & 7;
    if (cuts(kind) && (radius >= CRATER_FROM || cuts(kind2) && kind2 === WoundKind.crater)) kind = WoundKind.crater;
    const regions = (code >> 3) | regions2;
    d[o] = cx; d[o + 1] = cy; d[o + 2] = cz; d[o + 3] = radius;
    d[o + 4] = cx; d[o + 5] = cy; d[o + 6] = cz;
    d[o + 7] = Math.max(d[o + 7]!, ragged2);
    d[o + 8] = ax * depth; d[o + 9] = ay * depth; d[o + 10] = az * depth;
    d[o + 11] = kind + regions * 8;
  }

  /** Full, with nothing near enough to merge. The faintest paint goes, or else the two closest wounds become one. */
  private makeRoom(): void {
    const d = this.data;
    let faint = -1;
    let faintR = Infinity;
    for (let i = 0; i < this.count; i++) {
      const kind = this.kind(i);
      if (kind === WoundKind.graze && this.radius(i) < faintR) {
        faint = i;
        faintR = this.radius(i);
      }
    }
    if (faint >= 0) {
      this.remove(faint);
      return;
    }
    let best = Infinity;
    let keep = -1;
    let drop = -1;
    for (let i = 0; i < this.count; i++) {
      for (let j = i + 1; j < this.count; j++) {
        if (!this.accepts(i, this.kind(j))) continue;
        const a = this.at(i);
        const b = this.at(j);
        const gap = Math.hypot(d[a]! - d[b]!, d[a + 1]! - d[b + 1]!, d[a + 2]! - d[b + 2]!) - d[a + 3]! - d[b + 3]!;
        if (gap < best) {
          best = gap;
          keep = this.radius(i) >= this.radius(j) ? i : j;
          drop = keep === i ? j : i;
        }
      }
    }
    if (keep < 0) {
      // Nothing can merge: all gashes, say. The smallest is the one that will be missed least.
      let small = 0;
      for (let i = 1; i < this.count; i++) if (this.radius(i) < this.radius(small)) small = i;
      this.remove(small);
      return;
    }
    const o = this.at(drop);
    const depth = Math.hypot(d[o + 8]!, d[o + 9]!, d[o + 10]!);
    const l = 1 / (depth || 1);
    const code = Math.floor(d[o + 11]!);
    this.merge(keep, d[o]!, d[o + 1]!, d[o + 2]!, d[o + 3]!, depth, d[o + 7]!, d[o + 8]! * l, d[o + 9]! * l, d[o + 10]! * l, code & 7, code >> 3);
    this.remove(drop);
  }

  /** Last into the gap: shaders loop to `count`, so the slots have to stay packed. */
  private remove(i: number): void {
    const last = this.count - 1;
    if (i !== last) {
      this.data.copyWithin(this.at(i), this.at(last), this.at(last) + WOUND_TEXELS * 4);
      this.limits[i] = this.limits[last]!;
    }
    this.count = last;
  }
}
