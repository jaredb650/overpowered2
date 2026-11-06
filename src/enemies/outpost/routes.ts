/**
 * Routes to anywhere. The world's flow field answers one question, the way to the player, and a flank is exactly the
 * route that is not that. This is A* over the same nav nodes, with one extra cost: ground the threat can see.
 *
 * The graph is rebuilt from the nav grid's public arrays rather than its private links, walks only: soldiers do not use
 * jump links or pads.
 */
import * as THREE from 'three';

/** Where a walker may step from flat floor, and from a slope. Matches nav.ts. */
const STEP = 0.62;
const SLOPE_STEP = 1.08;
/** A route passes through at most this many points. Past that it is cut short and the walker asks again on arrival. */
const MAX_POINTS = 40;
/** Hard stop on one search, so no query can take a frame. */
const MAX_EXPANSIONS = 7000;
/** Cost of a metre of open ground in view of the threat, against 1 for a metre out of it. */
const EXPOSED_COST = 5;
/** Walls cost a little, so a route runs down the middle of a corridor. */
const WALL_COST = 0.12;
/** Sampling step along a straight cut across open floor, and how far each side of the line has to be floor as well. */
const CUT_STEP = 0.5;
const BODY_HALF = 0.45;

/** The parts of the nav graph a route needs. `ctx.world.nav` is one of these on every real map. */
export interface NavGrid {
  readonly nodeCount: number;
  readonly px: Float32Array;
  readonly py: Float32Array;
  readonly pz: Float32Array;
  readonly slopeX: Float32Array;
  readonly slopeZ: Float32Array;
  readonly clearance: Uint8Array;
  readonly minX: number;
  readonly minZ: number;
  readonly nx: number;
  readonly nz: number;
  readonly colStart: Int32Array;
  locate(p: THREE.Vector3, ring?: number): number;
}

/** Anything that can say whether a point on the map is in the enemy's view. */
export interface Exposure {
  exposed(x: number, z: number): boolean;
}

/** A walked path. Fixed size, so a soldier keeps one for life. */
export class Route {
  readonly x = new Float32Array(MAX_POINTS);
  readonly y = new Float32Array(MAX_POINTS);
  readonly z = new Float32Array(MAX_POINTS);
  count = 0;
  /** Index of the point being walked to. */
  next = 0;
  /** Metres from first point to last. */
  length = 0;

  clear(): void {
    this.count = this.next = 0;
    this.length = 0;
  }

  get done(): boolean {
    return this.next >= this.count;
  }

  /** Writes the point `distance` metres along the route, stopping at its end. */
  pointAt(distance: number, out: THREE.Vector3): THREE.Vector3 {
    if (this.count === 0) return out;
    let left = distance;
    for (let i = 1; i < this.count; i++) {
      const dx = this.x[i]! - this.x[i - 1]!, dy = this.y[i]! - this.y[i - 1]!, dz = this.z[i]! - this.z[i - 1]!;
      const d = Math.hypot(dx, dy, dz);
      if (left <= d && d > 0) {
        const t = left / d;
        return out.set(this.x[i - 1]! + dx * t, this.y[i - 1]! + dy * t, this.z[i - 1]! + dz * t);
      }
      left -= d;
    }
    const last = this.count - 1;
    return out.set(this.x[last]!, this.y[last]!, this.z[last]!);
  }

  push(x: number, y: number, z: number): boolean {
    if (this.count >= MAX_POINTS) return false;
    if (this.count > 0) {
      const i = this.count - 1;
      this.length += Math.hypot(x - this.x[i]!, y - this.y[i]!, z - this.z[i]!);
    }
    this.x[this.count] = x;
    this.y[this.count] = y;
    this.z[this.count] = z;
    this.count++;
    return true;
  }
}

export class RouteFinder {
  private nav: NavGrid | null = null;
  private start = new Int32Array(1);
  private to = new Int32Array(0);
  private cost = new Float32Array(0);
  private g = new Float32Array(0);
  private cameFrom = new Int32Array(0);
  private stamp = new Int32Array(0);
  private heapNode = new Int32Array(0);
  private heapKey = new Float32Array(0);
  private heapSize = 0;
  private trail = new Int32Array(0);
  private pass = 0;
  /** Nodes a barricade has taken off the graph. */
  private closed = new Uint8Array(0);

  get ready(): boolean {
    return this.nav !== null;
  }

  build(nav: NavGrid): void {
    this.nav = nav;
    const n = nav.nodeCount;
    const start = new Int32Array(n + 1);
    const to: number[] = [];
    const cost: number[] = [];
    const walkable = (a: number, cx: number, cz: number): number => {
      if (cx < 0 || cz < 0 || cx >= nav.nx || cz >= nav.nz) return -1;
      const c = cz * nav.nx + cx;
      const steep = this.sloped(a);
      let best = -1;
      let bestD = Infinity;
      for (let i = nav.colStart[c]!; i < nav.colStart[c + 1]!; i++) {
        const d = Math.abs(nav.py[i]! - nav.py[a]!);
        if (d <= (steep || this.sloped(i) ? SLOPE_STEP : STEP) && d < bestD) {
          bestD = d;
          best = i;
        }
      }
      return best;
    };
    const DX = [1, 0, -1, 0, 1, -1, -1, 1], DZ = [0, 1, 0, -1, 1, 1, -1, -1];
    const side = [0, 0, 0, 0];
    for (let a = 0; a < n; a++) {
      start[a] = to.length;
      const cx = Math.floor(nav.px[a]! - nav.minX), cz = Math.floor(nav.pz[a]! - nav.minZ);
      for (let d = 0; d < 4; d++) side[d] = walkable(a, cx + DX[d]!, cz + DZ[d]!);
      for (let d = 0; d < 8; d++) {
        // Diagonals only through open corners, as in nav.ts, so no step clips a wall end.
        const b = d < 4 ? side[d]! : side[d - 4]! >= 0 && side[(d - 3) & 3]! >= 0 ? walkable(a, cx + DX[d]!, cz + DZ[d]!) : -1;
        if (b < 0) continue;
        to.push(b);
        cost.push((d < 4 ? 1 : Math.SQRT2) + (3 - nav.clearance[b]!) * WALL_COST);
      }
    }
    start[n] = to.length;
    this.start = start;
    this.to = Int32Array.from(to);
    this.cost = Float32Array.from(cost);
    this.g = new Float32Array(n);
    this.cameFrom = new Int32Array(n);
    this.stamp = new Int32Array(n);
    this.heapNode = new Int32Array(to.length + 2);
    this.heapKey = new Float32Array(to.length + 2);
    this.trail = new Int32Array(n);
    this.closed = new Uint8Array(n);
    this.pass = 0;
  }

  /** Takes a door off the graph, or puts it back. Only the door's own frame goes: the rooms either side stay as they were. */
  setClosed(x: number, z: number, dx: number, dz: number, width: number, shut: boolean): void {
    const nav = this.nav;
    if (!nav) return;
    const reach = Math.ceil(width / 2) + 1;
    const cx = Math.floor(x - nav.minX), cz = Math.floor(z - nav.minZ);
    for (let az = cz - reach; az <= cz + reach; az++) {
      for (let ax = cx - reach; ax <= cx + reach; ax++) {
        if (ax < 0 || az < 0 || ax >= nav.nx || az >= nav.nz) continue;
        const c = az * nav.nx + ax;
        for (let i = nav.colStart[c]!; i < nav.colStart[c + 1]!; i++) {
          const along = Math.abs((nav.px[i]! - x) * dx + (nav.pz[i]! - z) * dz);
          const across = Math.abs((nav.px[i]! - x) * dz - (nav.pz[i]! - z) * dx);
          if (along < 1 && across <= width / 2 + 0.5 && nav.py[i]! < 2) this.closed[i] = shut ? 1 : 0;
        }
      }
    }
  }

  private sloped(i: number): boolean {
    const nav = this.nav!;
    return Math.abs(nav.slopeX[i]!) + Math.abs(nav.slopeZ[i]!) > 0.05;
  }

  private push(node: number, key: number): void {
    const { heapNode, heapKey } = this;
    let i = this.heapSize++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heapKey[p]! <= key) break;
      heapNode[i] = heapNode[p]!;
      heapKey[i] = heapKey[p]!;
      i = p;
    }
    heapNode[i] = node;
    heapKey[i] = key;
  }

  private pop(): number {
    const { heapNode, heapKey } = this;
    const top = heapNode[0]!;
    const n = --this.heapSize;
    const node = heapNode[n]!;
    const key = heapKey[n]!;
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= n) break;
      if (c + 1 < n && heapKey[c + 1]! < heapKey[c]!) c++;
      if (heapKey[c]! >= key) break;
      heapNode[i] = heapNode[c]!;
      heapKey[i] = heapKey[c]!;
      i = c;
    }
    heapNode[i] = node;
    heapKey[i] = key;
    return top;
  }

  /** Writes a route into `out`. False when there is none. With `avoid`, ground it can see costs EXPOSED_COST times more. */
  find(from: THREE.Vector3, to: THREE.Vector3, out: Route, avoid: Exposure | null = null): boolean {
    out.clear();
    const nav = this.nav;
    if (!nav) return false;
    const a = nav.locate(from, 4);
    const b = nav.locate(to, 4);
    if (a < 0 || b < 0) return false;
    const { px, py, pz } = nav;
    const { g, cameFrom, stamp, start, to: links, cost } = this;
    const pass = ++this.pass;
    const bx = px[b]!, by = py[b]!, bz = pz[b]!;
    this.heapSize = 0;
    g[a] = 0;
    cameFrom[a] = -1;
    stamp[a] = pass;
    this.push(a, 0);
    let found = false;
    let expansions = 0;
    while (this.heapSize > 0 && expansions++ < MAX_EXPANSIONS) {
      const u = this.pop();
      if (u === b) {
        found = true;
        break;
      }
      const gu = g[u]!;
      for (let l = start[u]!, end = start[u + 1]!; l < end; l++) {
        const v = links[l]!;
        if (this.closed[v]) continue;
        let step = cost[l]!;
        if (avoid && avoid.exposed(px[v]!, pz[v]!)) step *= EXPOSED_COST;
        const gv = gu + step;
        if (stamp[v] === pass && gv >= g[v]!) continue;
        stamp[v] = pass;
        g[v] = gv;
        cameFrom[v] = u;
        const dx = Math.abs(px[v]! - bx), dz = Math.abs(pz[v]! - bz);
        this.push(v, gv + Math.max(dx, dz) + 0.41 * Math.min(dx, dz) + Math.abs(py[v]! - by));
      }
    }
    if (!found) return false;
    this.smooth(a, b, out, avoid);
    if (out.count > 0 && out.count < MAX_POINTS) out.push(to.x, to.y, to.z);
    return out.count > 0;
  }

  /** Grid paths zigzag. Drops every node a straight walk can skip, so men cut across open floor as people do. */
  private smooth(a: number, b: number, out: Route, avoid: Exposure | null): void {
    const { trail, cameFrom } = this;
    const nav = this.nav!;
    let n = 0;
    for (let v = b; v >= 0; v = cameFrom[v]!) {
      trail[n++] = v;
      if (v === a) break;
    }
    let anchor = n - 1;
    out.push(nav.px[trail[anchor]!]!, nav.py[trail[anchor]!]!, nav.pz[trail[anchor]!]!);
    for (let i = n - 2; i >= 0; i--) {
      if (i > 0 && this.straight(trail[anchor]!, trail[i - 1]!, avoid)) continue;
      const v = trail[i]!;
      if (!out.push(nav.px[v]!, nav.py[v]!, nav.pz[v]!)) return;
      anchor = i;
    }
  }

  /**
   * True when a walk from node to node stays over walkable columns the whole way. With `avoid`, a cut may not step out into
   * view from cover either: straightening the route must not undo the detour the search just paid for.
   */
  private straight(a: number, b: number, avoid: Exposure | null): boolean {
    const nav = this.nav!;
    const ax = nav.px[a]!, ay = nav.py[a]!, az = nav.pz[a]!;
    const dx = nav.px[b]! - ax, dy = nav.py[b]! - ay, dz = nav.pz[b]! - az;
    const length = Math.hypot(dx, dz);
    const steps = Math.ceil(length / CUT_STEP);
    // Shoulders count. A line that only just clears a wall end has a man's arm through it.
    const sx = (-dz / length) * BODY_HALF, sz = (dx / length) * BODY_HALF;
    const open = avoid !== null && (avoid.exposed(ax, az) || avoid.exposed(ax + dx, az + dz));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const x = ax + dx * t, y = ay + dy * t, z = az + dz * t;
      if (!this.overFloor(x, y, z) || !this.overFloor(x + sx, y, z + sz) || !this.overFloor(x - sx, y, z - sz)) return false;
      if (avoid && !open && avoid.exposed(x, z)) return false;
    }
    return true;
  }

  private overFloor(x: number, y: number, z: number): boolean {
    const nav = this.nav!;
    const cx = Math.floor(x - nav.minX), cz = Math.floor(z - nav.minZ);
    if (cx < 0 || cz < 0 || cx >= nav.nx || cz >= nav.nz) return false;
    const c = cz * nav.nx + cx;
    for (let i = nav.colStart[c]!, end = nav.colStart[c + 1]!; i < end; i++) {
      if (Math.abs(nav.py[i]! - y) < SLOPE_STEP) return this.closed[i] === 0;
    }
    return false;
  }
}
