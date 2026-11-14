/**
 * Walkable-node navigation across every level of the map.
 *
 * Nodes come from sampling the physics world: a vertical ray per 1 m column reports the top of every collider it
 * crosses, and a capsule test keeps the ones a body can stand on. That gives a true multi-level graph, so a floor
 * under a catwalk and the catwalk itself are separate nodes in the same column.
 *
 * One flow field serves every enemy. It is a Dijkstra pass outward from the target, run a slice per frame and
 * written in place: nodes near the target are refreshed first, which is exactly where staleness would show.
 * Far nodes keep following the previous pass, which is safe because a stale pointer still leads to a node that
 * leads to the target.
 */
import * as THREE from 'three';
import { CG, type NavLinkKind, type NavQuery, type PhysicsSystem } from '../core/contracts';

const CELL = 1;
const TOP_Y = 118;
const BOTTOM_Y = -19;
/** Lower half of the body is lifted so steps and slopes do not read as blocked. */
const BODY_RADIUS = 0.4;
const BODY_HALF = 0.35;
const BODY_LIFT = 1.1;
const STEP = 0.62;
const SLOPE_STEP = 1.08;
const MIN_NORMAL_Y = 0.68;
const MAX_DROP = 17;
const NEAR_LIMIT = 700;
const FULL_EVERY = 6;
const BUCKETS = 2048;
const INF = 0x3fffffff;

export const LINK_WALK = 0, LINK_DROP = 1, LINK_JUMP = 2, LINK_PAD = 3;
const KIND_NAMES: readonly NavLinkKind[] = ['walk', 'drop', 'jump', 'pad'];

/** Authored link between two spots, snapped to the graph at build time. */
export interface DesignatedLink {
  a: THREE.Vector3;
  b: THREE.Vector3;
  kind: 'jump' | 'pad';
  twoWay?: boolean;
}

export interface NavBuildStats {
  nodes: number;
  links: number;
  removed: number;
  ms: number;
}

export interface NavBuildOptions {
  /** Also drop nodes that cannot be reached from the hub, not just those that cannot reach it. */
  mutual?: boolean;
  /** Heights flat floor may have. Tops of cover and walls are not floors on a map that lists its levels. */
  levels?: readonly number[];
}

const _dir = new THREE.Vector3();

export class NavGraph implements NavQuery {
  minX = 0;
  minZ = 0;
  nx = 0;
  nz = 0;
  /** CSR: nodes of a column, in ascending height. */
  colStart = new Int32Array(1);
  colNodes = new Int32Array(0);
  px = new Float32Array(0);
  py = new Float32Array(0);
  pz = new Float32Array(0);
  /** Surface slope, so groundHeight stays exact on ramps. */
  slopeX = new Float32Array(0);
  slopeZ = new Float32Array(0);
  clearance = new Uint8Array(0);
  /**
   * How many things stand on each node since the sample: walls, gates and shacks go up after it, so the floor under them is
   * on the graph and a breach only has to clear the count. A blocked node is no floor and no step for the flow field,
   * `locate`, `groundHeight` and RouteFinder.
   */
  blocked = new Uint8Array(0);
  nodeCount = 0;

  private linkStart = new Int32Array(1);
  private linkTo = new Int32Array(0);
  private linkCost = new Uint16Array(0);
  private linkKind = new Uint8Array(0);
  private inStart = new Int32Array(1);
  private inFrom = new Int32Array(0);
  private inCost = new Uint16Array(0);
  private inKind = new Uint8Array(0);

  private dist = new Int32Array(0);
  private next = new Int32Array(0);
  private nextKind = new Uint8Array(0);

  private tent = new Int32Array(0);
  private tentNext = new Int32Array(0);
  private tentKind = new Uint8Array(0);
  private stamp = new Int32Array(0);
  private doneStamp = new Int32Array(0);
  private heads = new Int32Array(BUCKETS);
  private entryNode = new Int32Array(0);
  private entryNext = new Int32Array(0);
  private entryCount = 0;
  private cursor = 0;
  private queued = 0;
  private pass = 0;
  private passCount = 0;
  private passLimit = INF;
  private running = false;
  private lastSeed = -1;
  private readonly target = new THREE.Vector3();
  private readonly passTarget = new THREE.Vector3();
  private hasTarget = false;
  private levels: readonly number[] | null = null;
  private dirty = false;
  /** A blocker changed: the next full pass also forgets every node it could not reach, so none keeps a way through. */
  private forget = false;
  /** Node expansions per frame. */
  budget = 4500;

  constructor(private readonly physics: PhysicsSystem) {}

  // ---- build -------------------------------------------------------------------------------------------------

  async build(
    bounds: THREE.Box3, links: readonly DesignatedLink[], hub: THREE.Vector3,
    onProgress: (f: number) => Promise<void>, options: NavBuildOptions = {},
  ): Promise<NavBuildStats> {
    const t0 = performance.now();
    const { physics } = this;
    const world = physics.world;
    const R = physics.R;
    const groups = ((0xffff << 16) | CG.World) >>> 0;
    this.minX = Math.floor(bounds.min.x);
    this.minZ = Math.floor(bounds.min.z);
    this.nx = Math.ceil((bounds.max.x - this.minX) / CELL);
    this.nz = Math.ceil((bounds.max.z - this.minZ) / CELL);
    const nx = this.nx, nz = this.nz;
    const { mutual = false, levels } = options;
    this.levels = levels ?? null;

    const ray = new R.Ray({ x: 0, y: TOP_Y, z: 0 }, { x: 0, y: -1, z: 0 });
    const capsule = new R.Capsule(BODY_HALF, BODY_RADIUS);
    const rot = { x: 0, y: 0, z: 0, w: 1 };
    const pos = { x: 0, y: 0, z: 0 };

    let capX = 1 << 18;
    let sx = new Float32Array(capX), sy = new Float32Array(capX), sz = new Float32Array(capX);
    let ssx = new Float32Array(capX), ssz = new Float32Array(capX);
    let col = new Int32Array(capX);
    let count = 0;
    const hitY: number[] = [], hitNx: number[] = [], hitNy: number[] = [], hitNz: number[] = [];
    const collect = (hit: { timeOfImpact: number; normal: { x: number; y: number; z: number } }): boolean => {
      hitY.push(TOP_Y - hit.timeOfImpact);
      hitNx.push(hit.normal.x); hitNy.push(hit.normal.y); hitNz.push(hit.normal.z);
      return true;
    };

    for (let iz = 0; iz < nz; iz++) {
      const z = this.minZ + iz + 0.5;
      for (let ix = 0; ix < nx; ix++) {
        const x = this.minX + ix + 0.5;
        ray.origin.x = x; ray.origin.z = z; ray.origin.y = TOP_Y;
        hitY.length = 0; hitNx.length = 0; hitNy.length = 0; hitNz.length = 0;
        world.intersectionsWithRay(ray, TOP_Y - BOTTOM_Y, true, collect, undefined, groups);
        for (let h = 0; h < hitY.length; h++) {
          if (hitNy[h]! < MIN_NORMAL_Y) continue;
          const y = hitY[h]!;
          if (hitNy[h]! > 0.999 && !this.onLevel(y)) continue;
          pos.x = x; pos.y = y + BODY_LIFT; pos.z = z;
          if (world.intersectionWithShape(pos, rot, capsule, undefined, groups)) continue;
          if (count === capX) {
            capX *= 2;
            const grow = (a: Float32Array) => { const b = new Float32Array(capX); b.set(a); return b; };
            sx = grow(sx); sy = grow(sy); sz = grow(sz); ssx = grow(ssx); ssz = grow(ssz);
            const c = new Int32Array(capX); c.set(col); col = c;
          }
          sx[count] = x; sy[count] = y; sz[count] = z;
          ssx[count] = -hitNx[h]! / hitNy[h]!;
          ssz[count] = -hitNz[h]! / hitNy[h]!;
          col[count] = iz * nx + ix;
          count++;
        }
      }
      if ((iz & 15) === 0) await onProgress((iz / nz) * 0.6);
    }

    // Columns in CSR form, ascending height, duplicates (stacked coplanar colliders) merged.
    const order = new Int32Array(count);
    for (let i = 0; i < count; i++) order[i] = i;
    order.sort((a, b) => (col[a]! - col[b]!) || (sy[a]! - sy[b]!));
    const keep: number[] = [];
    for (let i = 0; i < count; i++) {
      const n = order[i]!;
      const prev = keep.length ? keep[keep.length - 1]! : -1;
      if (prev >= 0 && col[prev] === col[n] && sy[n]! - sy[prev]! < 0.35) { keep[keep.length - 1] = n; continue; }
      keep.push(n);
    }
    const n0 = keep.length;
    const px = new Float32Array(n0), py = new Float32Array(n0), pz = new Float32Array(n0);
    const slx = new Float32Array(n0), slz = new Float32Array(n0);
    const colOf = new Int32Array(n0);
    for (let i = 0; i < n0; i++) {
      const s = keep[i]!;
      px[i] = sx[s]!; py[i] = sy[s]!; pz[i] = sz[s]!; slx[i] = ssx[s]!; slz[i] = ssz[s]!; colOf[i] = col[s]!;
    }
    let colStart = new Int32Array(nx * nz + 1);
    for (let i = 0; i < n0; i++) colStart[colOf[i]! + 1]!++;
    for (let i = 0; i < nx * nz; i++) colStart[i + 1]! += colStart[i]!;
    // Nodes are already sorted by column, so node ids are the CSR payload.

    const linkA: number[] = [], linkB: number[] = [], linkC: number[] = [], linkK: number[] = [];
    const addLink = (a: number, b: number, cost: number, kind: number) => {
      linkA.push(a); linkB.push(b); linkC.push(Math.min(BUCKETS - 2, Math.max(1, Math.round(cost)))); linkK.push(kind);
    };
    const hasWalk = (a: number, cx: number, cz: number): number => {
      if (cx < 0 || cz < 0 || cx >= nx || cz >= nz) return -1;
      const c = cz * nx + cx;
      const y = py[a]!;
      const sloped = Math.abs(slx[a]!) + Math.abs(slz[a]!) > 0.05;
      let best = -1, bestD = 1e9;
      for (let i = colStart[c]!; i < colStart[c + 1]!; i++) {
        const d = Math.abs(py[i]! - y);
        const lim = sloped || Math.abs(slx[i]!) + Math.abs(slz[i]!) > 0.05 ? SLOPE_STEP : STEP;
        if (d <= lim && d < bestD) { bestD = d; best = i; }
      }
      return best;
    };

    const DX = [1, 0, -1, 0, 1, -1, -1, 1], DZ = [0, 1, 0, -1, 1, 1, -1, -1];
    const nbr = new Int32Array(8);
    for (let a = 0; a < n0; a++) {
      const cx = colOf[a]! % nx, cz = (colOf[a]! / nx) | 0;
      for (let d = 0; d < 4; d++) nbr[d] = hasWalk(a, cx + DX[d]!, cz + DZ[d]!);
      for (let d = 0; d < 8; d++) {
        let b: number;
        if (d < 4) b = nbr[d]!;
        else {
          // Diagonals only through open corners, so no link clips a wall end.
          const s0 = nbr[d - 4]!, s1 = nbr[(d - 3) & 3]!;
          b = s0 >= 0 && s1 >= 0 ? hasWalk(a, cx + DX[d]!, cz + DZ[d]!) : -1;
        }
        if (b >= 0) addLink(a, b, d < 4 ? 10 : 14, LINK_WALK);
      }
      if ((a & 8191) === 0) await onProgress(0.6 + (a / n0) * 0.08);
    }

    // Drops off ledges. Walkers just run off the edge, so these are one-way and need no action.
    for (let a = 0; a < n0; a++) {
      const cx = colOf[a]! % nx, cz = (colOf[a]! / nx) | 0;
      for (let d = 0; d < 4; d++) {
        if (hasWalk(a, cx + DX[d]!, cz + DZ[d]!) >= 0) continue;
        for (let reach = 1; reach <= 2; reach++) {
          const tx = cx + DX[d]! * reach, tz = cz + DZ[d]! * reach;
          if (tx < 0 || tz < 0 || tx >= nx || tz >= nz) break;
          const c = tz * nx + tx;
          let b = -1;
          for (let i = colStart[c + 1]! - 1; i >= colStart[c]!; i--) {
            if (py[i]! < py[a]! - STEP) { b = i; break; }
          }
          if (b < 0) continue;
          const drop = py[a]! - py[b]!;
          if (drop > MAX_DROP) break;
          pos.x = px[b]!; pos.y = py[a]! + BODY_LIFT; pos.z = pz[b]!;
          if (world.intersectionWithShape(pos, rot, capsule, undefined, groups)) break;
          addLink(a, b, 10 * reach + drop * 4, LINK_DROP);
          // A short ledge can be vaulted back up.
          if (drop <= 1.9) addLink(b, a, 10 * reach + drop * 14 + 10, LINK_JUMP);
          break;
        }
      }
      if ((a & 8191) === 0) await onProgress(0.68 + (a / n0) * 0.12);
    }

    this.px = px; this.py = py; this.pz = pz; this.colStart = colStart; this.colNodes = new Int32Array(n0);
    for (let i = 0; i < n0; i++) this.colNodes[i] = i;
    this.nodeCount = n0;
    for (const l of links) {
      const a = this.locate(l.a, 8), b = this.locate(l.b, 8);
      if (a < 0 || b < 0) {
        console.warn('nav: designated link not on the graph', l.kind, l.a.toArray(), l.b.toArray());
        continue;
      }
      const d = l.a.distanceTo(l.b) * 10;
      const kind = l.kind === 'pad' ? LINK_PAD : LINK_JUMP;
      addLink(a, b, d * 0.6 + 20, kind);
      if (l.twoWay) addLink(b, a, d * 0.6 + 20, kind);
    }

    // Keep only nodes that can reach the hub, so any enemy on the graph has a route.
    const m0 = linkA.length;
    const rStart = new Int32Array(n0 + 1);
    for (let i = 0; i < m0; i++) rStart[linkB[i]! + 1]!++;
    for (let i = 0; i < n0; i++) rStart[i + 1]! += rStart[i]!;
    const rFill = rStart.slice();
    const rFrom = new Int32Array(m0);
    for (let i = 0; i < m0; i++) rFrom[rFill[linkB[i]!]!++] = linkA[i]!;
    const alive = new Uint8Array(n0);
    const stack = new Int32Array(n0);
    const hubNode = this.locate(hub, 8);
    let top = 0;
    if (hubNode >= 0) { stack[top++] = hubNode; alive[hubNode] = 1; }
    while (top > 0) {
      const u = stack[--top]!;
      for (let i = rStart[u]!; i < rStart[u + 1]!; i++) {
        const v = rFrom[i]!;
        if (!alive[v]) { alive[v] = 1; stack[top++] = v; }
      }
    }
    if (mutual && hubNode >= 0) {
      // A wall top can be dropped from but not walked to. Without this a player standing on one seeds a field no enemy
      // can follow, so nodes must also be reachable from the hub.
      const fStart = new Int32Array(n0 + 1);
      for (let i = 0; i < m0; i++) fStart[linkA[i]! + 1]!++;
      for (let i = 0; i < n0; i++) fStart[i + 1]! += fStart[i]!;
      const fFill = fStart.slice();
      const fTo = new Int32Array(m0);
      for (let i = 0; i < m0; i++) fTo[fFill[linkA[i]!]!++] = linkB[i]!;
      const reached = new Uint8Array(n0);
      reached[hubNode] = 1;
      stack[top++] = hubNode;
      while (top > 0) {
        const u = stack[--top]!;
        for (let i = fStart[u]!; i < fStart[u + 1]!; i++) {
          const v = fTo[i]!;
          if (!reached[v]) { reached[v] = 1; stack[top++] = v; }
        }
      }
      for (let i = 0; i < n0; i++) alive[i] = alive[i]! & reached[i]!;
    }

    const remap = new Int32Array(n0).fill(-1);
    let n1 = 0;
    for (let i = 0; i < n0; i++) if (alive[i]) remap[i] = n1++;
    const qx = new Float32Array(n1), qy = new Float32Array(n1), qz = new Float32Array(n1);
    const qsx = new Float32Array(n1), qsz = new Float32Array(n1);
    colStart = new Int32Array(nx * nz + 1);
    for (let i = 0; i < n0; i++) {
      const j = remap[i]!;
      if (j < 0) continue;
      qx[j] = px[i]!; qy[j] = py[i]!; qz[j] = pz[i]!; qsx[j] = slx[i]!; qsz[j] = slz[i]!;
      colStart[colOf[i]! + 1]!++;
    }
    for (let i = 0; i < nx * nz; i++) colStart[i + 1]! += colStart[i]!;
    this.px = qx; this.py = qy; this.pz = qz; this.slopeX = qsx; this.slopeZ = qsz;
    this.colStart = colStart;
    this.colNodes = new Int32Array(n1);
    for (let i = 0; i < n1; i++) this.colNodes[i] = i;
    this.nodeCount = n1;

    let m1 = 0;
    const deg = new Int32Array(n1 + 1), inDeg = new Int32Array(n1 + 1);
    for (let i = 0; i < m0; i++) {
      const a = remap[linkA[i]!]!, b = remap[linkB[i]!]!;
      if (a < 0 || b < 0) continue;
      deg[a + 1]!++; inDeg[b + 1]!++; m1++;
    }
    for (let i = 0; i < n1; i++) { deg[i + 1]! += deg[i]!; inDeg[i + 1]! += inDeg[i]!; }
    const fillOut = deg.slice(), fillIn = inDeg.slice();
    this.linkStart = deg; this.inStart = inDeg;
    this.linkTo = new Int32Array(m1); this.linkCost = new Uint16Array(m1); this.linkKind = new Uint8Array(m1);
    this.inFrom = new Int32Array(m1); this.inCost = new Uint16Array(m1); this.inKind = new Uint8Array(m1);
    for (let i = 0; i < m0; i++) {
      const a = remap[linkA[i]!]!, b = remap[linkB[i]!]!;
      if (a < 0 || b < 0) continue;
      const o = fillOut[a]!++;
      this.linkTo[o] = b; this.linkCost[o] = linkC[i]!; this.linkKind[o] = linkK[i]!;
      const r = fillIn[b]!++;
      this.inFrom[r] = a; this.inCost[r] = linkC[i]!; this.inKind[r] = linkK[i]!;
    }
    await onProgress(0.9);
    this.computeClearance();

    this.blocked = new Uint8Array(n1);
    this.dist = new Int32Array(n1).fill(INF);
    this.next = new Int32Array(n1).fill(-1);
    this.nextKind = new Uint8Array(n1);
    this.tent = new Int32Array(n1);
    this.tentNext = new Int32Array(n1);
    this.tentKind = new Uint8Array(n1);
    this.stamp = new Int32Array(n1);
    this.doneStamp = new Int32Array(n1);
    this.entryNode = new Int32Array(m1 + 8);
    this.entryNext = new Int32Array(m1 + 8);
    await onProgress(1);
    return { nodes: n1, links: m1, removed: n0 - n1, ms: performance.now() - t0 };
  }

  /**
   * Walking distance from the nearest edge in hops, capped at 3. Costs use it to keep paths off the walls
   * and big enemies can use it to refuse narrow spots.
   */
  private computeClearance(): void {
    const n = this.nodeCount;
    const c = new Uint8Array(n).fill(3);
    let frontier: number[] = [];
    for (let i = 0; i < n; i++) {
      let walks = 0;
      for (let l = this.linkStart[i]!; l < this.linkStart[i + 1]!; l++) if (this.linkKind[l] === LINK_WALK) walks++;
      if (walks < 8) { c[i] = 0; frontier.push(i); }
    }
    for (let level = 1; level < 3; level++) {
      const nextF: number[] = [];
      for (const u of frontier) {
        for (let l = this.linkStart[u]!; l < this.linkStart[u + 1]!; l++) {
          const v = this.linkTo[l]!;
          if (this.linkKind[l] === LINK_WALK && c[v]! > level) { c[v] = level; nextF.push(v); }
        }
      }
      frontier = nextF;
    }
    this.clearance = c;
    for (let i = 0; i < this.linkTo.length; i++) {
      if (this.linkKind[i] === LINK_WALK) this.linkCost[i]! += (3 - c[this.linkTo[i]!]!) * 2;
    }
    for (let v = 0; v < n; v++) {
      for (let r = this.inStart[v]!; r < this.inStart[v + 1]!; r++) {
        if (this.inKind[r] === LINK_WALK) this.inCost[r]! += (3 - c[v]!) * 2;
      }
    }
  }

  // ---- lookup ------------------------------------------------------------------------------------------------

  /** Closest node in a column at or below `y + 0.9`, or the closest above it. -1 when the column is empty. */
  private inColumn(ix: number, iz: number, y: number): number {
    if (ix < 0 || iz < 0 || ix >= this.nx || iz >= this.nz) return -1;
    const c = iz * this.nx + ix;
    const s = this.colStart[c]!, e = this.colStart[c + 1]!;
    if (s === e) return -1;
    const py = this.py;
    let best = -1, bestD = 1e9;
    for (let i = s; i < e; i++) {
      if (this.blocked[i]) continue;
      const d = py[i]! - y;
      // Prefer the floor under the feet to a ceiling just overhead.
      const cost = d > 0.9 ? d * 3 : -d;
      if (cost < bestD) { bestD = cost; best = i; }
    }
    return best;
  }

  /** Node at or near a position. `ring` is how many columns outward to search. */
  locate(p: THREE.Vector3, ring = 3): number {
    const ix = Math.floor(p.x - this.minX), iz = Math.floor(p.z - this.minZ);
    let n = this.inColumn(ix, iz, p.y);
    if (n >= 0 && Math.abs(this.py[n]! - p.y) < 3) return n;
    let best = n, bestD = n >= 0 ? Math.abs(this.py[n]! - p.y) * 1.5 : 1e9;
    for (let r = 1; r <= ring; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          n = this.inColumn(ix + dx, iz + dz, p.y);
          if (n < 0) continue;
          const d = Math.abs(this.py[n]! - p.y) * 1.5 + r;
          if (d < bestD) { bestD = d; best = n; }
        }
      }
      if (best >= 0 && bestD < r + 2) break;
    }
    return best;
  }

  /**
   * Adds or takes away one blocker on every node at floor height `y` inside a box centred on (x, z) whose length runs along
   * the unit (ux, uz). The next flow pass is a full one, so nothing keeps following a pointer through the change.
   */
  setBlocked(x: number, z: number, y: number, ux: number, uz: number, halfLength: number, halfDepth: number, on: boolean): void {
    const reach = Math.ceil(Math.hypot(halfLength, halfDepth)) + 1;
    const cx = Math.floor(x - this.minX), cz = Math.floor(z - this.minZ);
    for (let iz = cz - reach; iz <= cz + reach; iz++) {
      for (let ix = cx - reach; ix <= cx + reach; ix++) {
        if (ix < 0 || iz < 0 || ix >= this.nx || iz >= this.nz) continue;
        const c = iz * this.nx + ix;
        for (let i = this.colStart[c]!; i < this.colStart[c + 1]!; i++) {
          const dx = this.px[i]! - x, dz = this.pz[i]! - z;
          if (Math.abs(dx * ux + dz * uz) > halfLength || Math.abs(dz * ux - dx * uz) > halfDepth || Math.abs(this.py[i]! - y) > 1) continue;
          if (on) {
            this.blocked[i]!++;
            this.dist[i] = INF;
            this.next[i] = -1;
          } else if (this.blocked[i]! > 0) this.blocked[i]!--;
        }
      }
    }
    this.passCount = FULL_EVERY * Math.ceil(this.passCount / FULL_EVERY + 1) - 1;
    this.dirty = this.hasTarget;
    this.forget = true;
  }

  // ---- flow field --------------------------------------------------------------------------------------------

  setTarget(position: THREE.Vector3): void {
    this.target.copy(position);
    this.hasTarget = true;
    this.dirty = true;
  }

  private beginPass(seed: number): void {
    this.running = true;
    this.pass++;
    this.passCount++;
    this.passLimit = this.passCount % FULL_EVERY === 0 ? INF : NEAR_LIMIT;
    this.passTarget.copy(this.target);
    this.heads.fill(-1);
    this.entryCount = 0;
    this.cursor = 0;
    this.queued = 0;
    this.tent[seed] = 0;
    this.tentNext[seed] = -1;
    this.tentKind[seed] = LINK_WALK;
    this.stamp[seed] = this.pass;
    this.enqueue(seed, 0);
    this.lastSeed = seed;
  }

  private enqueue(node: number, d: number): void {
    const e = this.entryCount++;
    const b = d & (BUCKETS - 1);
    this.entryNode[e] = node;
    this.entryNext[e] = this.heads[b]!;
    this.heads[b] = e;
    this.queued++;
  }

  /** Advances the pass by up to `budget` node expansions. */
  private advance(budget: number): void {
    const { heads, entryNode, entryNext, tent, tentNext, tentKind, stamp, doneStamp, inStart, inFrom, inCost, inKind } = this;
    const pass = this.pass;
    let cursor = this.cursor;
    let spent = 0;
    while (spent < budget) {
      if (this.queued === 0) {
        this.running = false;
        if (this.forget && this.passLimit === INF) {
          this.forget = false;
          for (let i = 0; i < this.nodeCount; i++) if (doneStamp[i] !== pass) { this.dist[i] = INF; this.next[i] = -1; }
        }
        break;
      }
      const bi = cursor & (BUCKETS - 1);
      const e = heads[bi]!;
      if (e < 0) { cursor++; continue; }
      heads[bi] = entryNext[e]!;
      this.queued--;
      const u = entryNode[e]!;
      if (doneStamp[u] === pass) continue;
      const du = tent[u]!;
      if (du !== cursor) continue;
      if (du > this.passLimit) { this.running = false; break; }
      doneStamp[u] = pass;
      this.dist[u] = du;
      this.next[u] = tentNext[u]!;
      this.nextKind[u] = tentKind[u]!;
      spent++;
      for (let r = inStart[u]!, end = inStart[u + 1]!; r < end; r++) {
        const v = inFrom[r]!;
        if (doneStamp[v] === pass || this.blocked[v]) continue;
        const d = du + inCost[r]!;
        if (stamp[v] !== pass || d < tent[v]!) {
          stamp[v] = pass;
          tent[v] = d;
          tentNext[v] = u;
          tentKind[v] = inKind[r]!;
          this.enqueue(v, d);
        }
      }
    }
    this.cursor = cursor;
  }

  /** Call once per frame. */
  update(): void {
    if (!this.hasTarget || this.nodeCount === 0) return;
    if (!this.running && this.dirty) {
      const seed = this.locate(this.target, 8);
      if (seed >= 0 && (seed !== this.lastSeed || this.passCount % FULL_EVERY !== 0)) this.beginPass(seed);
      this.dirty = false;
    }
    if (this.running) this.advance(this.budget);
  }

  /** Finishes a full pass at once. For tests and the first frame of a run. */
  settle(): void {
    const seed = this.locate(this.target, 8);
    if (seed < 0) return;
    this.passCount = FULL_EVERY - 1;
    this.beginPass(seed);
    while (this.running) this.advance(1 << 20);
  }

  /** Flow direction on the horizontal plane. */
  flowDirection(position: THREE.Vector3, out: THREE.Vector3): boolean {
    const n = this.locate(position, 3);
    if (n < 0 || this.dist[n]! >= INF) return false;
    const next = this.next, nextKind = this.nextKind;
    let cur = n;
    // A few hops ahead smooths the 8-way grid into natural headings.
    for (let i = 0; i < 4; i++) {
      const v = next[cur]!;
      // A wall that went up since the last pass: stop short of it until the next pass routes round.
      if (v < 0 || this.blocked[v]) break;
      if (nextKind[cur] !== LINK_WALK) {
        if (cur === n) cur = v;
        break;
      }
      cur = v;
    }
    if (cur === n || next[cur]! < 0) _dir.set(this.passTarget.x - position.x, 0, this.passTarget.z - position.z);
    else _dir.set(this.px[cur]! - position.x, 0, this.pz[cur]! - position.z);
    const l = Math.hypot(_dir.x, _dir.z);
    if (l < 1e-4) {
      out.set(0, 0, 0);
      return true;
    }
    out.set(_dir.x / l, 0, _dir.z / l);
    return true;
  }

  pathDistance(position: THREE.Vector3): number {
    const n = this.locate(position, 3);
    if (n < 0) return Infinity;
    const d = this.dist[n]!;
    return d >= INF ? Infinity : d / 10;
  }

  /** First non-walk link within `hops` along the flow from `position`. Writes its landing point to `out`. */
  linkAhead(position: THREE.Vector3, out: THREE.Vector3, hops = 3): NavLinkKind {
    let cur = this.locate(position, 3);
    if (cur < 0) return 'walk';
    for (let i = 0; i < hops; i++) {
      const v = this.next[cur]!;
      if (v < 0) return 'walk';
      const k = this.nextKind[cur]!;
      if (k !== LINK_WALK) {
        out.set(this.px[v]!, this.py[v]!, this.pz[v]!);
        return KIND_NAMES[k]!;
      }
      cur = v;
    }
    return 'walk';
  }

  nearest(position: THREE.Vector3, maxDist: number, out: THREE.Vector3): boolean {
    const n = this.locate(position, Math.min(24, Math.ceil(maxDist)));
    if (n < 0) return false;
    const dx = this.px[n]! - position.x, dy = this.py[n]! - position.y, dz = this.pz[n]! - position.z;
    if (dx * dx + dy * dy + dz * dz > maxDist * maxDist) return false;
    out.set(this.px[n]!, this.py[n]!, this.pz[n]!);
    return true;
  }

  groundHeight(x: number, y: number, z: number): number {
    const ix = Math.floor(x - this.minX), iz = Math.floor(z - this.minZ);
    if (ix < 0 || iz < 0 || ix >= this.nx || iz >= this.nz) return NaN;
    const c = iz * this.nx + ix;
    let best = -1;
    for (let i = this.colStart[c]!, e = this.colStart[c + 1]!; i < e; i++) {
      if (this.py[i]! <= y + 0.5 && !this.blocked[i]) best = i;
    }
    if (best >= 0) {
      return this.py[best]! + this.slopeX[best]! * (x - this.px[best]!) + this.slopeZ[best]! * (z - this.pz[best]!);
    }
    // Off the graph (a wall top, a tight corner): ask physics.
    _dir.set(x, y + 0.5, z);
    const hit = this.physics.raycast(_dir, DOWN, 200, CG.World);
    if (!hit) return NaN;
    // On a map that lists its floors a wall top is not ground, or anything blocked by a wall would leap up and stand on it.
    return hit.normal.y > 0.999 && !this.onLevel(hit.point.y) ? NaN : hit.point.y;
  }

  /** True for any height on a map with no list of floors. */
  private onLevel(y: number): boolean {
    const { levels } = this;
    if (!levels) return true;
    for (let i = 0; i < levels.length; i++) if (Math.abs(y - levels[i]!) < 0.05) return true;
    return false;
  }

  /** The node with the longest path to the target after `settle()`. For the map verifier. */
  farthest(): { x: number; y: number; z: number; cost: number } {
    let best = -1, cost = -1;
    for (let i = 0; i < this.nodeCount; i++) {
      const d = this.dist[i]!;
      if (d < INF && d > cost) { cost = d; best = i; }
    }
    return { x: this.px[best]!, y: this.py[best]!, z: this.pz[best]!, cost: cost / 10 };
  }

  /** Walks the flow from a position. For tests and the debug overlay. */
  trace(from: THREE.Vector3, limit = 4000): { ok: boolean; hops: number; length: number; kinds: Record<NavLinkKind, number>; points: number[] } {
    const kinds: Record<NavLinkKind, number> = { walk: 0, drop: 0, jump: 0, pad: 0 };
    const points: number[] = [];
    let cur = this.locate(from, 8);
    if (cur < 0) return { ok: false, hops: 0, length: 0, kinds, points };
    const length = this.dist[cur]! / 10;
    let hops = 0;
    while (hops < limit) {
      points.push(this.px[cur]!, this.py[cur]!, this.pz[cur]!);
      const v = this.next[cur]!;
      if (v < 0) return { ok: this.dist[cur] === 0, hops, length, kinds, points };
      kinds[KIND_NAMES[this.nextKind[cur]!]!]++;
      cur = v;
      hops++;
    }
    return { ok: false, hops, length, kinds, points };
  }
}

const DOWN = new THREE.Vector3(0, -1, 0);
