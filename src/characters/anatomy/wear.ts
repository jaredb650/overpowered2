/**
 * Wear you can see (the gore update's step W1): how far through its skin each of a body's regions is, kept where the skin
 * shader reads it, in three spare texels of the bone texture. One number a region, 0 whole to 1 about to come off, with
 * what did most of the damage packed into the same float. Whoever owns the region's health writes it (the damage model, from
 * the limb pools); the shader only draws it. It changes nothing about what a hit does.
 *
 * Pure data, with no three.js, so it is tested in Node.
 */
import type { GoreRegion } from '../rig';

/** The order the shader reads them in: `OP2_REGION_OF` in glsl.ts maps each humanoid bone onto one of these. */
export const WEAR_REGIONS: readonly GoreRegion[] = ['head', 'chest', 'abdomen', 'armL', 'forearmL', 'armR', 'forearmR', 'legL', 'shinL', 'legR', 'shinR'];
/** Three texels: eleven regions and one float to spare. */
export const WEAR_TEXELS = 3;

/**
 * What did most of a region's damage, which is how its skin comes away: rounds pit and tear it in patches, a blade opens
 * long cuts across it, a blast strips it in sheets with a scorched edge. Fire is fire's own to draw (the char and the
 * burn-through), so wear by fire shows nothing here.
 */
export const WearKind = { tear: 0, cut: 1, strip: 2, burn: 3 } as const;
export type WearKindId = (typeof WearKind)[keyof typeof WearKind];
const KINDS = 4;

/** Which kind a damage type wears as. */
export function wearKindOf(type: string): WearKindId {
  return type === 'slash' ? WearKind.cut : type === 'explosive' ? WearKind.strip : type === 'fire' ? WearKind.burn : WearKind.tear;
}

/** The float a region is stored as: the kind in the twos, the amount under 1. */
export const packWear = (amount: number, kind: number): number => kind * 2 + Math.min(Math.max(amount, 0), 0.999);
export const wearAmount = (packed: number): number => packed - Math.floor(packed * 0.5) * 2;
export const wearKind = (packed: number): number => Math.floor(packed * 0.5);

const INDEX = new Map<GoreRegion, number>(WEAR_REGIONS.map((r, i) => [r, i]));

export class WearBook {
  /** What each kind of damage has taken off each region, in shares of its pool: the largest names the region's kind. */
  private readonly by = new Float32Array(WEAR_REGIONS.length * KINDS);
  /** The most worn region, 0 on a whole body: the shaders skip everything at 0. */
  most = 0;

  /**
   * @param data The bone texture's array.
   * @param base Float offset of the first wear texel.
   * @param onMost Told when `most` changes, so the shaders can read it.
   */
  constructor(private readonly data: Float32Array, private readonly base: number, private readonly onMost: (most: number) => void) {}

  amount(region: GoreRegion): number {
    const i = INDEX.get(region);
    return i === undefined ? 0 : wearAmount(this.data[this.base + i]!);
  }

  kind(region: GoreRegion): number {
    const i = INDEX.get(region);
    return i === undefined ? 0 : wearKind(this.data[this.base + i]!);
  }

  /**
   * A region stands at `spent` of its pool, 0 to 1, after a hit of `kind`. Wear never heals: a lower figure than the one
   * held (a pool put back, a co-op guest's refund) leaves the skin as torn as it was.
   */
  set(region: GoreRegion, spent: number, kind: WearKindId): void {
    const i = INDEX.get(region);
    if (i === undefined) return;
    const was = wearAmount(this.data[this.base + i]!);
    const now = Math.min(Math.max(spent, was), 1);
    this.by[i * KINDS + kind] = this.by[i * KINDS + kind]! + Math.max(now - was, 0.0001);
    let top = -1;
    for (let k = 0; k < WearKind.burn; k++) {
      const v = this.by[i * KINDS + k]!;
      if (v > 0 && (top < 0 || v > this.by[i * KINDS + top]!)) top = k;
    }
    if (top < 0) top = WearKind.burn;
    this.data[this.base + i] = packWear(now, top);
    if (now > this.most) this.onMost(this.most = now);
  }

  /** Copies another book's count across, for a limb leaving its body. The caller has already copied the texels. */
  adopt(from: WearBook): void {
    this.by.set(from.by);
    this.most = from.most;
  }

  clear(): void {
    this.by.fill(0);
    this.most = 0;
    this.data.fill(0, this.base, this.base + WEAR_TEXELS * 4);
    this.onMost(0);
  }
}
