/**
 * Cover derived from the map at load, so a new map needs no hand-placed nodes.
 *
 * Every nav node near an edge is ringed with rays at crouch and standing height. What comes back says which bearings are
 * blocked and how tall the blocker is: low means duck behind it and fire over the top, tall means fire round the end.
 * At the moment of choosing, two or three real rays confirm a spot against the actual threat.
 */
import * as THREE from 'three';
import { CG, type PhysicsSystem, type RayHit } from '../../core/contracts';
import type { NavGrid } from './routes';

const SECTORS = 12;
const SECTOR_ANGLE = (Math.PI * 2) / SECTORS;
/** How close a blocker has to be to shelter a crouching man. */
const REACH = 1.7;
const CROUCH_Y = 0.85;
const STAND_Y = 1.55;
/** A man stands no closer to the next spot than this. */
const SPOT_SPACING = 1.7;
/** Sidestep out from behind tall cover. */
const LEAN = 1.2;
/** Clearance is hops from the nearest edge: 0 is hard against something, 1 is a step off it. */
const MAX_CLEARANCE = 1;
const GRID = 4;
/** Candidates that get real rays when choosing. */
const VERIFY_TOP = 4;
/** What a metre over the threat is worth to a man who wants height, up to a tower's platform. */
const HEIGHT_SCORE = 1.1;
const MAX_HEIGHT_WORTH = 10;

const _dir = new THREE.Vector3();
const _from = new THREE.Vector3();
const _to = new THREE.Vector3();
const _hit: RayHit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0, surface: 'concrete', collider: null };

export interface CoverSpot {
  readonly id: number;
  readonly position: THREE.Vector3;
  /** Bit per bearing: something solid within reach at crouch height. */
  readonly low: number;
  /** The same at standing height. */
  readonly tall: number;
  /** Floor points to step to and lean out from. Null where a wall or a drop is in the way. */
  readonly leanLeft: THREE.Vector3 | null;
  readonly leanRight: THREE.Vector3 | null;
  /** Soldier uid holding it, or 0. */
  claimedBy: number;
}

export interface SpotQuery {
  /** Where the spot should be. */
  anchor: THREE.Vector3;
  radius: number;
  threat: THREE.Vector3;
  /** Wanted distance band from the threat. */
  near: number;
  far: number;
  /** Bearing from the threat the spot should lie on, or NaN for any. */
  bearing: number;
  /** Radians of error on `bearing` before it starts to cost. */
  bearingSlack: number;
  /** Must be able to fire on the threat from it. */
  needShot: boolean;
  /** Stay this far from other claimed spots. */
  spacing: number;
  /** Who is asking, so a man can keep the spot he has. */
  uid: number;
  /** Where he is now. A spot a short walk away beats a slightly better one across the map. */
  from: THREE.Vector3;
  /** How much height is worth to him. 0 for a rifleman, 1 for a man who wants a tower. */
  height: number;
  /** Looks on other floors too. The asker has to prove he can walk there: a column of the map holds every floor, and a route does not. */
  anyFloor: boolean;
}

export interface SpotReading {
  /** Crouched here, the threat cannot see you. */
  hidden: boolean;
  /** A place to fire from exists. */
  canShoot: boolean;
  /** -1 lean left, 0 up over the top, 1 lean right. */
  side: number;
}

const sectorOf = (angle: number): number => {
  const s = Math.round(angle / SECTOR_ANGLE) % SECTORS;
  return s < 0 ? s + SECTORS : s;
};

const bits = (mask: number): number => {
  let n = 0;
  for (let m = mask; m !== 0; m &= m - 1) n++;
  return n;
};

const wrap = (a: number): number => {
  const w = (a + Math.PI) % (Math.PI * 2);
  return (w < 0 ? w + Math.PI * 2 : w) - Math.PI;
};

export class CoverMap {
  spots: CoverSpot[] = [];
  private grid: CoverSpot[][] = [];
  private cols = 0;
  private rows = 0;
  private minX = 0;
  private minZ = 0;
  private readonly best: CoverSpot[] = [];
  private readonly bestScore: number[] = [];

  constructor(private readonly physics: PhysicsSystem) {}

  private ring(x: number, y: number, z: number, height: number): number {
    let mask = 0;
    _from.set(x, y + height, z);
    for (let i = 0; i < SECTORS; i++) {
      const a = i * SECTOR_ANGLE;
      _dir.set(Math.sin(a), 0, Math.cos(a));
      if (this.physics.raycastInto(_from, _dir, REACH, CG.World, _hit)) mask |= 1 << i;
    }
    return mask;
  }

  /** Runs once per load. About 60k rays on the Kill House. */
  build(nav: NavGrid): void {
    interface Candidate { node: number; low: number; tall: number; quality: number }
    const found: Candidate[] = [];
    for (let i = 0; i < nav.nodeCount; i++) {
      if (nav.clearance[i]! > MAX_CLEARANCE) continue;
      if (Math.abs(nav.slopeX[i]!) + Math.abs(nav.slopeZ[i]!) > 0.05) continue;
      const low = this.ring(nav.px[i]!, nav.py[i]!, nav.pz[i]!, CROUCH_Y);
      if (low === 0) continue;
      const tall = this.ring(nav.px[i]!, nav.py[i]!, nav.pz[i]!, STAND_Y);
      // Corners first: a spot that shelters on more bearings is worth more than the same wall a metre along.
      found.push({ node: i, low, tall, quality: bits(low) });
    }
    found.sort((a, b) => b.quality - a.quality);

    this.minX = nav.minX;
    this.minZ = nav.minZ;
    this.cols = Math.ceil(nav.nx / GRID);
    this.rows = Math.ceil(nav.nz / GRID);
    this.grid = Array.from({ length: this.cols * this.rows }, () => []);
    this.spots = [];
    const at = new THREE.Vector3();
    for (const c of found) {
      at.set(nav.px[c.node]!, nav.py[c.node]!, nav.pz[c.node]!);
      if (this.crowded(at)) continue;
      const spot: CoverSpot = {
        id: this.spots.length, position: at.clone(), low: c.low, tall: c.tall,
        leanLeft: this.leanPoint(nav, at, c.low, -1), leanRight: this.leanPoint(nav, at, c.low, 1), claimedBy: 0,
      };
      this.spots.push(spot);
      this.cell(at.x, at.z)!.push(spot);
    }
  }

  private cell(x: number, z: number): CoverSpot[] | undefined {
    const cx = Math.floor((x - this.minX) / GRID), cz = Math.floor((z - this.minZ) / GRID);
    if (cx < 0 || cz < 0 || cx >= this.cols || cz >= this.rows) return undefined;
    return this.grid[cz * this.cols + cx];
  }

  private crowded(p: THREE.Vector3): boolean {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const list = this.cell(p.x + dx * GRID, p.z + dz * GRID);
        if (!list) continue;
        for (const s of list) {
          if (Math.abs(s.position.y - p.y) < 1.5 && s.position.distanceToSquared(p) < SPOT_SPACING * SPOT_SPACING) return true;
        }
      }
    }
    return false;
  }

  /** Along the blocker, at right angles to where it lies. */
  private leanPoint(nav: NavGrid, at: THREE.Vector3, low: number, side: -1 | 1): THREE.Vector3 | null {
    let sx = 0, sz = 0;
    for (let i = 0; i < SECTORS; i++) {
      if (!(low & (1 << i))) continue;
      sx += Math.sin(i * SECTOR_ANGLE);
      sz += Math.cos(i * SECTOR_ANGLE);
    }
    const len = Math.hypot(sx, sz);
    if (len < 0.01) return null;
    // Right of the direction facing the blocker.
    const p = new THREE.Vector3(at.x + (sz / len) * LEAN * side, at.y, at.z - (sx / len) * LEAN * side);
    const n = nav.locate(p, 1);
    if (n < 0 || Math.abs(nav.py[n]! - at.y) > 0.3 || Math.hypot(nav.px[n]! - p.x, nav.pz[n]! - p.z) > 1) return null;
    p.set(nav.px[n]!, nav.py[n]!, nav.pz[n]!);
    // Near a wall end the floor a sidestep away can be the far side of the wall. He walks there in a straight line.
    _to.set(p.x, p.y + CROUCH_Y, p.z);
    return this.clear(at.x, at.y + CROUCH_Y, at.z, _to) ? p : null;
  }

  /** Sheltered on the bearing to `threat`, going by the rings alone. */
  private sheltered(spot: CoverSpot, threat: THREE.Vector3): boolean {
    const a = Math.atan2(threat.x - spot.position.x, threat.z - spot.position.z);
    return (spot.low & (1 << sectorOf(a))) !== 0;
  }

  private clear(x: number, y: number, z: number, to: THREE.Vector3): boolean {
    _from.set(x, y, z);
    _dir.subVectors(to, _from);
    const d = _dir.length();
    if (d < 0.05) return true;
    _dir.multiplyScalar(1 / d);
    return !this.physics.raycastInto(_from, _dir, d - 0.1, CG.World, _hit);
  }

  /** Real rays against the real threat. Three at most. */
  read(spot: CoverSpot, threat: THREE.Vector3, out: SpotReading): SpotReading {
    const p = spot.position;
    out.hidden = !this.clear(p.x, p.y + CROUCH_Y, p.z, threat);
    out.side = 0;
    out.canShoot = this.clear(p.x, p.y + STAND_Y, p.z, threat);
    if (out.canShoot) return out;
    const l = spot.leanLeft;
    if (l && this.clear(l.x, l.y + STAND_Y, l.z, threat)) {
      out.side = -1;
      out.canShoot = true;
      return out;
    }
    const r = spot.leanRight;
    if (r && this.clear(r.x, r.y + STAND_Y, r.z, threat)) {
      out.side = 1;
      out.canShoot = true;
    }
    return out;
  }

  private rate(s: CoverSpot, q: SpotQuery): number {
    const p = s.position;
    const toThreat = Math.hypot(p.x - q.threat.x, p.z - q.threat.z);
    const fromAnchor = Math.hypot(p.x - q.anchor.x, p.z - q.anchor.z);
    let score = -fromAnchor * 0.45 - Math.hypot(p.x - q.from.x, p.z - q.from.z) * 0.12;
    if (toThreat < q.near) score -= (q.near - toThreat) * 1.3;
    else if (toThreat > q.far) score -= (toThreat - q.far) * 0.8;
    if (this.sheltered(s, q.threat)) score += 5;
    if (q.height > 0) score += Math.min(Math.max(p.y - q.threat.y, 0), MAX_HEIGHT_WORTH) * HEIGHT_SCORE * q.height;
    if (!Number.isNaN(q.bearing)) {
      const off = Math.abs(wrap(Math.atan2(p.x - q.threat.x, p.z - q.threat.z) - q.bearing));
      score -= Math.max(0, off - q.bearingSlack) * 7;
    }
    return score;
  }

  private spaced(s: CoverSpot, q: SpotQuery): boolean {
    const r = q.spacing;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const list = this.cell(s.position.x + dx * GRID, s.position.z + dz * GRID);
        if (!list) continue;
        for (const o of list) {
          if (o === s || o.claimedBy === 0 || o.claimedBy === q.uid) continue;
          if (o.position.distanceToSquared(s.position) < r * r) return false;
        }
      }
    }
    return true;
  }

  /** Best free spot for a query, confirmed with rays. `reading` holds the winner's. Null when nothing fits. */
  pick(q: SpotQuery, reading: SpotReading): CoverSpot | null {
    const { best, bestScore } = this;
    best.length = bestScore.length = 0;
    const reach = Math.ceil(q.radius / GRID);
    const r2 = q.radius * q.radius;
    for (let dz = -reach; dz <= reach; dz++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const list = this.cell(q.anchor.x + dx * GRID, q.anchor.z + dz * GRID);
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          const s = list[i]!;
          if (s.claimedBy !== 0 && s.claimedBy !== q.uid) continue;
          const px = s.position.x - q.anchor.x, pz = s.position.z - q.anchor.z;
          if (px * px + pz * pz > r2 || (!q.anyFloor && Math.abs(s.position.y - q.anchor.y) > 2.5)) continue;
          const score = this.rate(s, q);
          if (best.length === VERIFY_TOP && score <= bestScore[VERIFY_TOP - 1]!) continue;
          if (!this.spaced(s, q)) continue;
          let at = best.length < VERIFY_TOP ? best.length : VERIFY_TOP - 1;
          while (at > 0 && bestScore[at - 1]! < score) {
            best[at] = best[at - 1]!;
            bestScore[at] = bestScore[at - 1]!;
            at--;
          }
          best[at] = s;
          bestScore[at] = score;
        }
      }
    }
    let winner: CoverSpot | null = null;
    let top = -Infinity;
    for (let i = 0; i < best.length; i++) {
      const s = best[i]!;
      this.read(s, q.threat, reading);
      if (q.needShot && !reading.canShoot) continue;
      const score = bestScore[i]! + (reading.hidden ? 3 : -3) + (reading.canShoot ? 2 : 0);
      if (score > top) {
        top = score;
        winner = s;
      }
    }
    if (winner) this.read(winner, q.threat, reading);
    return winner;
  }

  /** Lets every spot go, for a new run. */
  release(): void {
    for (const s of this.spots) s.claimedBy = 0;
  }
}
