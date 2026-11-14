/**
 * Who defends what on the fort (Outpost Defense). Every man the economy puts on a post is enlisted here with his home post; a few
 * times a second, in a wave, this moves posts (allies/ally.ts `post`) and the allies' own brains do the rest:
 *
 *   - men on the sides the wave comes from (the director's `fronts`) hold their posts;
 *   - riflemen on a quiet side, past the first on that side of their ring, shift to the threatened side of the same ring;
 *   - shotgunners go to the breach the riot police are holding (riot police form their line by themselves, `markBreach`);
 *   - machine gunners posted on a mounted gun man it (`Ally.mount`);
 *   - when a ring is overrun (`GARRISON.overrun` attackers inside its yard) everyone posted in it falls back to the next ring in, until
 *     the wave is over.
 *
 * In a break everyone goes home. Plain arithmetic over a handful of posts: twenty men at most.
 */
import * as THREE from 'three';
import type { Ally, AllyMount } from '../../allies/ally';
import { FORT_POSTS, ringAt, type FortPost, type RingId } from '../../world/map/fort/plan';

export const GARRISON = {
  /** Seconds between plans. */
  tick: 0.5,
  /** Attackers inside a ring's yard at once that make it overrun. */
  overrun: 4,
  /** Riflemen a quiet side of a ring keeps when the rest shift. */
  keep: 1,
  /** Metres along the wall between two riflemen sent to one stretch. */
  spacing: 3.5,
} as const;

const RINGS_IN: readonly RingId[] = ['outer', 'middle', 'core'];

/** The side of the fort a point is on: 0 north (-z), 1 east, 2 south, 3 west. */
export const sideOf = (x: number, z: number): number => (Math.abs(x) >= Math.abs(z) ? (x >= 0 ? 1 : 3) : z < 0 ? 0 : 2);

interface Home {
  uid: number;
  readonly pos: THREE.Vector3;
  yaw: number;
  radius: number;
  ring: RingId;
  side: number;
  mount: AllyMount | null;
}

interface Station {
  readonly pos: THREE.Vector3;
  yaw: number;
  radius: number;
}

/** Snaps a point to the floor graph; false off it. The world's `nav.nearest`. */
export type Snap = (p: THREE.Vector3, radius: number, out: THREE.Vector3) => boolean;

export class Garrison {
  readonly homes = new Map<Ally, Home>();
  /** Sides the wave comes from; empty in a break. */
  fronts: readonly number[] = [];
  /** Rings overrun this wave. */
  readonly overrun = new Set<RingId>();
  /** In the yard behind the breach the riot line holds, or null. */
  breach: THREE.Vector3 | null = null;
  private tickAt = 0;
  private readonly station: Station = { pos: new THREE.Vector3(), yaw: 0, radius: 0 };
  private readonly shifted = new Map<string, number>();
  private readonly kept = new Map<string, number>();

  constructor(private readonly snap: Snap) {}

  /** A man on his home post. `mount` is the gun at it, if any: he mans it. */
  enlist(a: Ally, mount: AllyMount | null = null): void {
    const p = a.post;
    this.homes.set(a, {
      uid: a.body.uid, pos: p.clone(), yaw: a.postYaw, radius: a.postRadius, ring: ringAt(p.x, p.z) ?? 'outer', side: sideOf(p.x, p.z), mount,
    });
    a.mount = mount;
  }

  reset(): void {
    this.homes.clear();
    this.fronts = [];
    this.overrun.clear();
    this.breach = null;
    this.tickAt = 0;
  }

  /** A wave is over: everyone goes home. */
  stand(allies: readonly Ally[]): void {
    this.fronts = [];
    this.overrun.clear();
    this.plan(allies);
  }

  /** Counts attackers by ring; a ring with enough in its yard is overrun for the rest of the wave. */
  watch(attackers: Iterable<{ readonly position: THREE.Vector3; readonly alive: boolean }>): void {
    let outer = 0, middle = 0, core = 0;
    for (const e of attackers) {
      if (!e.alive) continue;
      const r = ringAt(e.position.x, e.position.z);
      if (r === 'outer') outer++;
      else if (r === 'middle') middle++;
      else if (r === 'core') core++;
    }
    if (outer >= GARRISON.overrun) this.overrun.add('outer');
    if (middle >= GARRISON.overrun) this.overrun.add('middle');
    if (core >= GARRISON.overrun) this.overrun.add('core');
  }

  /** Plans on its tick. */
  update(now: number, allies: readonly Ally[]): void {
    if (now < this.tickAt) return;
    this.tickAt = now + GARRISON.tick;
    this.plan(allies);
  }

  /** Every enlisted man's post, now. */
  plan(allies: readonly Ally[]): void {
    this.shifted.clear();
    this.kept.clear();
    for (const [a, h] of this.homes) {
      if (a.state === 'dead' || a.body.uid !== h.uid || !allies.includes(a)) {
        this.homes.delete(a);
        continue;
      }
      const s = this.stationFor(a, h);
      a.mount = s === null ? h.mount : null;
      const at = s ?? { pos: h.pos, yaw: h.yaw, radius: h.radius };
      if (a.post.distanceTo(at.pos) < 0.8) continue;
      a.post.copy(at.pos);
      a.postYaw = at.yaw;
      a.postRadius = at.radius;
      // No `thinkAt = 0`: each man takes it on his own staggered think, so a wave's start is not every route search in one frame.
    }
  }

  /** Where he should be other than home, or null for home. */
  private stationFor(a: Ally, h: Home): Station | null {
    let ring = h.ring;
    while (this.overrun.has(ring) && ring !== 'core') ring = RINGS_IN[RINGS_IN.indexOf(ring) + 1]!;
    if (ring !== h.ring) return this.fallBack(h, ring);
    if (a.type === 'shotgunner' && this.breach) return this.set(this.breach, h.yaw, 3, 0);
    if (a.type !== 'rifleman' || this.fronts.length === 0 || this.fronts.includes(h.side)) return null;
    const key = `${ring}:${h.side}`;
    const kept = this.kept.get(key) ?? 0;
    if (kept < GARRISON.keep) {
      this.kept.set(key, kept + 1);
      return null;
    }
    return this.shift(h, ring);
  }

  /** A quiet side's spare rifleman: to the threatened side of his ring that has had the fewest sent to it. */
  private shift(h: Home, ring: RingId): Station | null {
    let side = -1, fewest = Infinity;
    for (const f of this.fronts) {
      const n = this.shifted.get(`${ring}:${f}`) ?? 0;
      if (n < fewest) {
        fewest = n;
        side = f;
      }
    }
    const posts = riflePosts(ring, side);
    if (posts.length === 0) return null;
    this.shifted.set(`${ring}:${side}`, fewest + 1);
    const base = posts[fewest % posts.length]!;
    // Beside the post along the wall, alternating either way, so two men sent to one stretch do not stand on each other.
    const k = Math.floor(fewest / posts.length) + 1;
    const off = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * GARRISON.spacing;
    const along = side === 0 || side === 2;
    return this.set(base.pos, base.yaw, 4, off, along) ?? null;
  }

  /** Into the next ring: the nearest post of any kind there, his own side first. */
  private fallBack(h: Home, ring: RingId): Station {
    let best: FortPost | null = null, bestD = Infinity;
    for (const p of FORT_POSTS) {
      if (p.ring !== ring || p.type === 'mortar') continue;
      const d = Math.hypot(p.pos[0] - h.pos.x, p.pos[2] - h.pos.z) + (sideOf(p.pos[0], p.pos[2]) === h.side ? 0 : 30);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best ? this.set(best.pos, best.yaw, 6, 0) ?? this.home(h) : this.home(h);
  }

  private home(h: Home): Station {
    const s = this.station;
    s.pos.copy(h.pos);
    s.yaw = h.yaw;
    s.radius = h.radius;
    return s;
  }

  /** A station at `at`, `off` metres along the wall (x for north and south, z for east and west), on the floor graph. */
  private set(at: THREE.Vector3 | readonly [number, number, number], yaw: number, radius: number, off: number, alongX = true): Station | null {
    const s = this.station;
    if (at instanceof THREE.Vector3) s.pos.copy(at);
    else s.pos.set(at[0], at[1], at[2]);
    if (alongX) s.pos.x += off;
    else s.pos.z += off;
    s.pos.y += 1;
    if (!this.snap(s.pos, 3, s.pos)) return null;
    s.yaw = yaw;
    s.radius = radius;
    return s;
  }
}

/** The rifleman posts on one side of a ring. */
function riflePosts(ring: RingId, side: number): FortPost[] {
  return FORT_POSTS.filter(p => p.type === 'rifleman' && p.ring === ring && sideOf(p.pos[0], p.pos[2]) === side);
}
