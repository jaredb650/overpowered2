/**
 * The blood a piece of a body trails while it flies (the gore update's G2), so a trunk piece, a limb, a slab or an organ
 * thrown out of a fireball draws a red arc the eye can follow. Two kinds, one budget each:
 *
 *  - a **ribbon** for the bigger pieces: a chain of globs left in the piece's path that keep a share of its speed and fall,
 *    drawn as one wet rope by the arterial spurts' own layer (`fx.bloodHose`, appended to their chain: `SpurtField.tail`).
 *    The rope runs from the piece back along where it has been.
 *  - a **strand** for the small ones (`fx.gibTrail`): a short streak, a few a frame over everything in flight.
 *
 * Fixed pools. A ribbon belongs to whoever opened it last (`owner`): past `TrailTuning.max` the oldest is taken, and the
 * piece that had it just stops trailing.
 */
import type * as THREE from 'three';
import type { Ctx } from '../core/contracts';

export const TrailTuning = {
  /** Ribbons at once, and globs in each. Two bodies burst at once is about forty. */
  max: 48,
  globs: 7,
  /** Seconds between a ribbon's globs, how long one lasts, and the share of the piece's speed it keeps. */
  every: 0.05,
  life: 0.4,
  keep: 0.3,
  gravity: 11,
  /** Seconds after it is thrown that a piece trails, and the speed under which it has landed or is rolling: no trail. */
  seconds: 1.3,
  minSpeed: 2.2,
  /** Strands a frame, over every small piece in flight, and the seconds between one piece's. */
  perFrame: 5,
  strandEvery: 0.09,
};

/** x y z vx vy vz age alive. */
const G = 8;
/** One point of the hose's chain: x y z age serial break. */
const STRIDE = 6;

export class Ribbon {
  owner: object | null = null;
  serial = 0;
  readonly globs = new Float32Array(TrailTuning.globs * G);
  head = 0;
  fired = 0;
  acc = 0;
  /** Where the piece is and how fast, as last fed, and the frame it was. */
  x = 0; y = 0; z = 0;
  vx = 0; vy = 0; vz = 0;
  fedAt = -1;
  live = false;
}

export class GibTrail {
  private readonly ribbons: Ribbon[] = Array.from({ length: TrailTuning.max }, () => new Ribbon());
  private serial = 0;
  private frame = -1;
  private used = 0;
  /** Strands and ribbons started since the start, for checks. */
  left = 0;
  opened = 0;

  /** Chain points this can add to the hose's chain. */
  readonly points = TrailTuning.max * (TrailTuning.globs + 1);

  constructor(private readonly ctx: Ctx) {}

  /** A ribbon for `owner`, a piece just thrown. The oldest in the world is taken when none is free. */
  open(owner: object): Ribbon {
    let r = this.ribbons.find(o => !o.live);
    if (!r) {
      r = this.ribbons[0]!;
      for (const o of this.ribbons) if (o.serial < r.serial) r = o;
    }
    r.owner = owner;
    r.serial = ++this.serial;
    r.live = true;
    r.head = 0;
    r.fired = 0;
    r.acc = TrailTuning.every;
    r.fedAt = -1;
    r.globs.fill(0);
    this.opened++;
    return r;
  }

  /** `owner`'s piece is at `p` moving at `v` this frame, and still trailing. Nothing if the ribbon has gone to another. */
  feed(r: Ribbon | null, owner: object, p: THREE.Vector3, v: THREE.Vector3): void {
    if (!r || r.owner !== owner || !r.live) return;
    r.x = p.x; r.y = p.y; r.z = p.z;
    r.vx = v.x; r.vy = v.y; r.vz = v.z;
    r.fedAt = this.ctx.time.elapsed;
  }

  /**
   * One strand behind a small piece at `p` moving at `v`; `size` 1 is a big lump's. False when this frame's are spent:
   * the caller asks again next frame.
   */
  leave(p: THREE.Vector3, v: THREE.Vector3, size: number): boolean {
    const { time, fx } = this.ctx;
    if (this.frame !== time.elapsed) {
      this.frame = time.elapsed;
      this.used = 0;
    }
    if (this.used >= TrailTuning.perFrame) return false;
    this.used++;
    this.left++;
    fx.gibTrail?.(p, v, size);
    return true;
  }

  /** Ribbons with anything still in the air. */
  get live(): number {
    let n = 0;
    for (const r of this.ribbons) if (r.live) n++;
    return n;
  }

  /** Moves every ribbon's globs on. After the pieces have fed theirs this frame. */
  update(dt: number): void {
    if (dt <= 0) return;
    const t = TrailTuning;
    const now = this.ctx.time.elapsed;
    for (const r of this.ribbons) {
      if (!r.live) continue;
      const fed = r.fedAt === now;
      if (fed) {
        r.acc += dt;
        if (r.acc >= t.every) {
          r.acc = 0;
          const g = r.head * G;
          r.head = (r.head + 1) % t.globs;
          r.globs[g] = r.x;
          r.globs[g + 1] = r.y;
          r.globs[g + 2] = r.z;
          r.globs[g + 3] = r.vx * t.keep;
          r.globs[g + 4] = r.vy * t.keep;
          r.globs[g + 5] = r.vz * t.keep;
          r.globs[g + 6] = 0;
          r.globs[g + 7] = 1;
          r.fired++;
        }
      }
      let any = fed;
      for (let i = 0; i < t.globs; i++) {
        const g = i * G;
        if (r.globs[g + 7] === 0) continue;
        r.globs[g + 4] = r.globs[g + 4]! - t.gravity * dt;
        r.globs[g] = r.globs[g]! + r.globs[g + 3]! * dt;
        r.globs[g + 1] = r.globs[g + 1]! + r.globs[g + 4]! * dt;
        r.globs[g + 2] = r.globs[g + 2]! + r.globs[g + 5]! * dt;
        r.globs[g + 6] = r.globs[g + 6]! + dt;
        if (r.globs[g + 6]! > t.life) r.globs[g + 7] = 0;
        else any = true;
      }
      if (!any) {
        r.live = false;
        r.owner = null;
      }
    }
  }

  /**
   * Adds every ribbon to the hose's `chain` after its first `count` points, newest point first: the piece, then each glob
   * in the order it was left. Returns the new count. `SpurtField` calls it before it draws.
   */
  append(chain: Float32Array, count: number): number {
    const t = TrailTuning;
    const now = this.ctx.time.elapsed;
    const room = chain.length / STRIDE;
    for (const r of this.ribbons) {
      if (!r.live) continue;
      let first = true;
      const put = (x: number, y: number, z: number, age: number, serial: number): void => {
        if (count >= room) return;
        const o = count * STRIDE;
        chain[o] = x;
        chain[o + 1] = y;
        chain[o + 2] = z;
        chain[o + 3] = age;
        chain[o + 4] = serial * 0.35;
        chain[o + 5] = first ? 1 : 0;
        first = false;
        count++;
      };
      if (r.fedAt === now) put(r.x, r.y, r.z, 0, r.fired);
      for (let k = 1; k <= t.globs; k++) {
        const g = ((r.head - k + t.globs) % t.globs) * G;
        // Globs go oldest first, so the first gap is the end of the rope.
        if (r.globs[g + 7] === 0) break;
        put(r.globs[g]!, r.globs[g + 1]!, r.globs[g + 2]!, r.globs[g + 6]!, r.fired - k);
      }
    }
    return count;
  }

  clear(): void {
    for (const r of this.ribbons) {
      r.live = false;
      r.owner = null;
    }
  }
}
