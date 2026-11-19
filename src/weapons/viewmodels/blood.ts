/**
 * Blood on the weapon and the hands (the gore update's step B3).
 *
 * A close kill or a melee hit throws blood back at the player. Each surface that can take it (a gun, each glove) keeps a
 * `BloodCoat`: three layers, each one a spatter that arrived from one direction at one time. The shader (kit/materials.ts)
 * draws a layer as drops from a tiling field (`makeSpatter`), thresholded by how much blood the layer holds, how squarely a
 * surface faced where it came from, and how far forward on the gun it is. So it is spatter with a direction, not a tint:
 * round drops where it hit square on, long streaks down the surfaces it grazed, more of it toward the muzzle or the blade's
 * point. A layer is wet and bright when it lands, dries darker over a minute, and wears off after a few more.
 *
 * Nothing here knows three.js, so the rules are tested in Node.
 */
import { clamp, mulberry32, smoothstep } from '../../core/math';

/** The switch is `DevFlags.vmBlood` (core/devflags.ts): `?vmblood=0`, and the lab's "Blood on the weapon" row. */
export const VmBloodTuning = {
  /** Metres from the eye. A kill inside `near` throws all it has; past `reach` nothing gets to the gun. */
  near: 1.3,
  reach: 5,
  /** Seconds over which a layer goes from wet to dry: the floor stains' own curve (render/Decals.ts), a little sooner. */
  dryFrom: 4,
  dryTo: 55,
  /** Dry blood stays this long, then wears off over `wear` seconds. */
  hold: 150,
  wear: 120,
  /** Blood arriving this soon after the last lot is the same spatter: one layer, one direction. */
  merge: 1.2,
  /** What two old layers may add up to when they are folded into one to make room. */
  foldCap: 0.85,
  /** How much of a kill's blood reaches the gloves, which sit behind the gun. A blade puts more on the hand that holds it. */
  hands: 0.6,
  handsMelee: 0.75,
  /** The share of a layer that lands whatever the surface's place on the gun: the rest goes by how far forward it is. */
  evenShare: 0.3,
  evenShareMelee: 0.45,
  /** Blood falls: every spatter's direction is tipped this much toward straight above. */
  rain: 0.32,
  /** What one blow of a blade leaves on it, kill or not; a kill adds its own. */
  blow: 0.55,
  /** Metres round a gun's sight points that never take blood, and the width of the fade at its edge. */
  sightClear: 0.028,
  sightFade: 0.02,
};

export const BLOOD_LAYERS = 3;

/** How much blood a kill throws, 0 to 1, before distance. Fire and shock seal what they kill; a machine has none. */
export function killBlood(type: string, gibbed: boolean, headshot: boolean, sliced: boolean, vaporized: boolean): number {
  if (vaporized || type === 'fire' || type === 'shock') return 0;
  if (gibbed) return 1;
  if (sliced) return 0.95;
  const base = type === 'explosive' ? 0.85 : type === 'pellet' ? 0.75 : type === 'slash' ? 0.9 : type === 'melee' || type === 'crush' ? 0.75 : type === 'bullet' ? 0.42 : 0.3;
  return headshot ? Math.min(1, base + 0.25) : base;
}

/** The share of it that reaches a gun `distance` metres from the body. */
export function closeness(distance: number): number {
  return 1 - smoothstep(VmBloodTuning.near, VmBloodTuning.reach, distance);
}

const combine = (a: number, b: number): number => 1 - (1 - a) * (1 - b);

/** One surface's blood: a gun's, or a glove's. */
export class BloodCoat {
  /** Unit vectors toward where each layer's blood came from, in the surface's own space. */
  readonly dir = new Float32Array(BLOOD_LAYERS * 3);
  readonly amount = new Float32Array(BLOOD_LAYERS);
  /** The coat's clock when the layer landed. */
  readonly born = new Float32Array(BLOOD_LAYERS);
  /** 0 to 1: which drops of the field this layer shows. */
  readonly seed = new Float32Array(BLOOD_LAYERS);
  /** The share of the layer that ignores how far forward a surface is (`evenShare`). */
  readonly even = new Float32Array(BLOOD_LAYERS);
  /** 1: the surface was in the body (a blade), so every side of it is wet, whichever way it faced. */
  readonly through = new Float32Array(BLOOD_LAYERS);
  private readonly order = [0, 1, 2];

  /** What is left of layer `i` at `now`, after wear. */
  shown(i: number, now: number): number {
    const age = now - this.born[i]!;
    return this.amount[i]! * (1 - smoothstep(VmBloodTuning.hold, VmBloodTuning.hold + VmBloodTuning.wear, age));
  }

  /** 1 fresh, 0 dry. */
  wet(i: number, now: number): number {
    return 1 - smoothstep(VmBloodTuning.dryFrom, VmBloodTuning.dryTo, now - this.born[i]!);
  }

  /** The most any layer shows. Zero is a clean surface, and the shader skips all of this. */
  most(now: number): number {
    let m = 0;
    for (let i = 0; i < BLOOD_LAYERS; i++) m = Math.max(m, this.shown(i, now));
    return m;
  }

  clear(): void {
    this.amount.fill(0);
  }

  /** Blood arrives from (`dx`, `dy`, `dz`), a unit vector in this surface's space. `random` gives the new layer its drops. */
  add(dx: number, dy: number, dz: number, amount: number, now: number, even: number, random: () => number, through = 0): void {
    if (!(amount > 0.004)) return;
    amount = Math.min(1, amount);
    const T = VmBloodTuning;
    let newest = -1;
    for (let i = 0; i < BLOOD_LAYERS; i++) {
      if (this.shown(i, now) > 0.004 && (newest < 0 || this.born[i]! > this.born[newest]!)) newest = i;
    }
    if (newest >= 0 && now - this.born[newest]! < T.merge) {
      // The same burst: one spatter, from between the two directions, as wet as it was.
      const a = this.amount[newest]!;
      const o = newest * 3;
      let x = this.dir[o]! * a + dx * amount, y = this.dir[o + 1]! * a + dy * amount, z = this.dir[o + 2]! * a + dz * amount;
      const l = Math.hypot(x, y, z);
      if (l > 1e-4) { x /= l; y /= l; z /= l; } else { x = dx; y = dy; z = dz; }
      this.dir[o] = x; this.dir[o + 1] = y; this.dir[o + 2] = z;
      this.amount[newest] = combine(a, amount);
      this.even[newest] = Math.max(this.even[newest]!, even);
      this.through[newest] = Math.max(this.through[newest]!, through);
      return;
    }
    let slot = -1;
    for (let i = 0; i < BLOOD_LAYERS; i++) if (this.shown(i, now) <= 0.004) { slot = i; break; }
    if (slot < 0) {
      // Full: the two oldest are both long dry and look alike. The oldest takes the other's blood, and its place is free.
      const by = this.sorted();
      const keep = by[0]!, drop = by[1]!;
      this.amount[keep] = Math.min(T.foldCap, combine(this.shown(keep, now), this.shown(drop, now) * 0.6));
      this.born[keep] = Math.min(this.born[keep]!, now - T.dryTo);
      slot = drop;
    }
    const o = slot * 3;
    this.dir[o] = dx; this.dir[o + 1] = dy; this.dir[o + 2] = dz;
    this.amount[slot] = amount;
    this.born[slot] = now;
    this.seed[slot] = random();
    this.even[slot] = even;
    this.through[slot] = through;
  }

  /** Layer indices, oldest first: the order the shader paints them in, so fresh blood lies over dry. */
  sorted(): readonly number[] {
    const o = this.order;
    o.sort((a, b) => this.born[a]! - this.born[b]!);
    return o;
  }

  /**
   * Fills the shader's two rows of three: `a` is direction and seed, `b` is amount, wetness, the even share and `through`.
   * Returns the most any layer shows.
   */
  write(now: number, a: { set(x: number, y: number, z: number, w: number): unknown }[], b: { set(x: number, y: number, z: number, w: number): unknown }[]): number {
    const by = this.sorted();
    let most = 0;
    for (let k = 0; k < BLOOD_LAYERS; k++) {
      const i = by[k]!;
      const o = i * 3;
      const shown = this.shown(i, now);
      most = Math.max(most, shown);
      a[k]!.set(this.dir[o]!, this.dir[o + 1]!, this.dir[o + 2]!, this.seed[i]!);
      b[k]!.set(shown, this.wet(i, now), this.even[i]!, this.through[i]!);
    }
    return most;
  }
}

// --- The drops -----------------------------------------------------------------------------------

/** Voxels a side. One tile covers `SPATTER_TILE` metres of gun. */
export const SPATTER_SIZE = 128;
export const SPATTER_TILE = 0.15;
/** The same field read again this many times finer gives the small drops. */
export const SPATTER_FINE = 3.7;
/** How much of the scale a drop takes to grow from a point to its full size. */
const GROW = 0.1;
/** Past its edge a drop's field falls away this fast, so the threshold cuts a clean outline at any magnification. */
const EDGE = 1.3;

/**
 * The field the shader thresholds: one byte a voxel, tiling in all three directions. It is a block of space with blobs in
 * it, and a surface shows the blobs it passes through, so a drop is the same drop across an edge, round a barrel and on a
 * rail's teeth, with no seam (a flat sheet of drops projected onto a gun paints whole faces). A voxel is blood where its
 * value is over `1 - amount`, so each blob carries its own moment: the small ones come with the first blood, the big blots
 * only when there is a lot of it.
 */
export function makeSpatter(size = SPATTER_SIZE, seed = 0x0b100d): Uint8Array {
  const rng = mulberry32(seed);
  const field = new Uint8Array(size * size * size);
  const unit = size / SPATTER_SIZE;
  const wrap = (v: number) => ((v % size) + size) % size;

  /** One blob, wrapped at the tile's faces. `when` is the amount of blood it first shows at. */
  const blob = (cx: number, cy: number, cz: number, radius: number, when: number, lobes: number) => {
    const top = 1 - when;
    const p1 = rng() * 6.283, p2 = rng() * 6.283, p3 = rng() * 6.283;
    const far = radius * (1 + lobes * 1.6) * (1 + Math.max(0, top - GROW) / EDGE);
    const far2 = far * far;
    const reach = Math.ceil(far + 1);
    const z0 = Math.floor(cz - reach), y0 = Math.floor(cy - reach), x0 = Math.floor(cx - reach);
    for (let z = z0; z <= z0 + 2 * reach; z++) {
      const dz = z + 0.5 - cz;
      const oz = wrap(z) * size * size;
      for (let y = y0; y <= y0 + 2 * reach; y++) {
        const dy = y + 0.5 - cy;
        const dyz = dy * dy + dz * dz;
        if (dyz > far2) continue;
        const oy = oz + wrap(y) * size;
        for (let x = x0; x <= x0 + 2 * reach; x++) {
          const dx = x + 0.5 - cx;
          const d2 = dx * dx + dyz;
          if (d2 > far2) continue;
          const d = Math.sqrt(d2);
          let r = radius;
          // A scalloped outline: the radius wanders with direction.
          if (lobes > 0 && d > 0.01) r *= 1 + lobes * (Math.sin(dx / d * 3.3 + p1) * Math.sin(dy / d * 3.9 + p2) + 0.6 * Math.sin(dz / d * 4.7 + p3));
          const rho = d / r;
          const v = rho <= 1 ? top - GROW * rho * rho : top - GROW - EDGE * (rho - 1);
          if (v <= 0) continue;
          const b = v * 255;
          const i = oy + wrap(x);
          if (b > field[i]!) field[i] = b;
        }
      }
    }
  };

  // Many small, few large, and the large ones late.
  const BLOBS = 560;
  for (let k = 0; k < BLOBS; k++) {
    const when = 0.03 + 0.92 * (k + rng()) / BLOBS;
    const pick = rng();
    const radius = (2 + pick * pick * (3.5 + 9 * when)) * unit;
    const cx = rng() * size, cy = rng() * size, cz = rng() * size;
    blob(cx, cy, cz, radius, when, radius > 3.5 * unit ? 0.1 + rng() * 0.14 : 0);
    // What a big drop throws off as it lands: a few specks just beyond its edge.
    const satellites = radius > 4.5 * unit ? 2 + Math.floor(rng() * 4) : 0;
    for (let s = 0; s < satellites; s++) {
      const a = rng() * 6.283, e = Math.acos(rng() * 2 - 1);
      const d = radius * (1.35 + rng() * 0.9);
      blob(cx + Math.sin(e) * Math.cos(a) * d, cy + Math.sin(e) * Math.sin(a) * d, cz + Math.cos(e) * d, (1.2 + rng() * 0.9) * unit, Math.min(0.96, when + 0.02 + rng() * 0.06), 0);
    }
  }
  return field;
}

/** The share of space that is blood at `amount`, which is the share of a surface: it must never fill in to a coat of paint. */
export function coverage(field: Uint8Array, amount: number): number {
  const at = (1 - amount) * 255;
  let n = 0;
  for (let i = 0; i < field.length; i++) if (field[i]! > at) n++;
  return n / field.length;
}

// --- Where on the gun ----------------------------------------------------------------------------

/**
 * A vertex's place along the weapon as a byte for the `aBlood` attribute: 1 at the back of the stock or the pommel, 255 at
 * the muzzle or the blade's point (`-Z` is forward in every model). 0 is kept for geometry that never takes blood: a mesh
 * without the attribute reads 0, which is how the legs and the things in the left hand stay clean.
 */
export function reachByte(z: number, back: number, front: number): number {
  const f = clamp((back - z) / Math.max(back - front, 1e-4), 0, 1);
  return 1 + Math.round(f * 254);
}

/** How much blood a vertex may take, as a byte, by its distance from the nearest sight point: none right at it. */
export function clearByte(distance: number): number {
  return Math.round(255 * smoothstep(VmBloodTuning.sightClear, VmBloodTuning.sightClear + VmBloodTuning.sightFade, distance));
}

/** The same for a glove: all of the hand and fingers (`z` at or ahead of the wrist), falling away up the sleeve. */
export function sleeveByte(z: number, foreLen: number): number {
  const f = z <= 0.02 ? 1 : Math.max(0.12, 1 - 0.8 * (z - 0.02) / foreLen);
  return 1 + Math.round(f * 254);
}
