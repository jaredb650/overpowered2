/**
 * 4-Pass Physics-Based Structural Integrity Solver (Red Faction: Guerrilla + The Finals inspired).
 *
 * Replaces pure 1-path graph connectivity (which let 4-legged towers float on 1 surviving stilt or
 * half a building hover in mid-air via a single sideways roof link) with four fast, deterministic checks:
 *   1. Load-Bearing Connectivity (BFS): infill nodes (drywall, glass, parapets, hazards) can be
 *      supported by load-bearing frames, but NEVER transmit vertical support to hold up upper slabs.
 *   2. Support-Polygon & Center-of-Mass Stability: checks every connected upper assembly against its
 *      surviving ground-anchored vertical supports. 1-of-4 legs left or 2-adjacent-legs left ALWAYS
 *      tips over in the exact direction of the missing supports.
 *   3. Cantilever Span Limit: horizontal slabs/roofs/decks that lose their underlying vertical
 *      supports and overhang past their material's max cantilever shear off for realistic partial
 *      corner collapses while the rest of the building stays standing.
 *   4. Vertical Load Overload Cascade: distributes upper mass onto surviving columns/bearing walls;
 *      damaged or overburdened columns buckle after a short groan delay, creating pancake collapses.
 */
import * as THREE from 'three';
import type { StructuralMaterial } from '../core/contracts';
import { STRUCTURAL_MATERIAL_PROPS } from './destructionMaterials';

export type SupportRole = 'load_bearing' | 'infill';

export interface SolverNodeView {
  readonly id: string;
  readonly state: 'intact' | 'tilting' | 'falling' | 'settled' | 'gone';
  readonly anchored: boolean;
  readonly kind: string;
  readonly supportRole: SupportRole;
  readonly structuralMaterial: StructuralMaterial;
  readonly basePos: THREE.Vector3;
  readonly half: THREE.Vector3;
  readonly mass: number;
  readonly loadCapacity: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly initialSupportCount: number;
  readonly initialAnchoredSupportCount: number;
}

export interface SolverClusterView {
  readonly nodes: readonly SolverNodeView[];
  readonly byId: ReadonlyMap<string, SolverNodeView>;
  readonly adjacency: ReadonlyMap<string, ReadonlySet<string>>;
}

export interface DetachedNodeDecision {
  readonly nodeId: string;
  readonly reason: 'disconnected' | 'tipping' | 'cantilever';
  /** Outward/downward world XZ collapse direction (normalized) when tipping/cantilevering. */
  readonly tipDirX: number;
  readonly tipDirZ: number;
}

export interface StructuralSolveResult {
  readonly detached: DetachedNodeDecision[];
  /** Surviving vertical supports whose carried load exceeds remaining structural capacity. */
  readonly overloaded: string[];
}

interface SupportFootprint {
  x: number;
  z: number;
  radius: number;
  count: number;
}

const HORIZONTAL_KINDS = new Set<string>(['slab', 'roof', 'catwalk']);
const VERTICAL_KINDS = new Set<string>(['column', 'wall', 'tower']);

/** Infers whether a node is load-bearing or non-structural infill. */
export function inferSupportRole(
  kind: string,
  material: StructuralMaterial,
  explicit?: SupportRole,
): SupportRole {
  if (explicit) return explicit;
  if (material === 'glass' || material === 'drywall') return 'infill';
  if (kind === 'hazard') return 'infill';
  return 'load_bearing';
}

/** Computes realistic physical mass (kg) from node box volume and material density. */
export function computeNodeMass(half: THREE.Vector3, material: StructuralMaterial): number {
  const vol = Math.max(0.02, half.x * half.y * half.z * 8);
  const density = STRUCTURAL_MATERIAL_PROPS[material].density;
  return vol * density;
}

/**
 * Computes compressive load capacity (kg) for a vertical support node (column / bearing wall).
 * Calibrated so a pristine building has ~2.1x safety factor, while losing half its columns or
 * severely cracking surviving columns triggers realistic buckling/pancake cascades.
 */
export function computeNodeLoadCapacity(
  half: THREE.Vector3,
  kind: string,
  material: StructuralMaterial,
  explicit?: number,
): number {
  if (explicit !== undefined && explicit > 0) return explicit;
  if (!VERTICAL_KINDS.has(kind)) return Infinity;
  const props = STRUCTURAL_MATERIAL_PROPS[material];
  if (props.loadCapacityPerM2 <= 0) return 0;
  const areaXZ = Math.max(0.12, half.x * 2 * half.z * 2);
  return areaXZ * props.loadCapacityPerM2;
}

/** Returns true if `support` sits beneath (or vertically carries) `upper`. */
function isVerticalSupportFor(support: SolverNodeView, upper: SolverNodeView): boolean {
  if (support.supportRole !== 'load_bearing') return false;
  if (!VERTICAL_KINDS.has(support.kind) && !support.anchored) return false;
  const supportBottom = support.basePos.y - support.half.y;
  const upperBottom = upper.basePos.y - upper.half.y;
  // Support must extend lower than the upper element's center and reach near/below its underside.
  return support.basePos.y < upper.basePos.y - 0.12 && supportBottom <= upperBottom + 0.45;
}

/** Merges nearby support nodes (e.g., subdivided cells of the same wall/pillar) into distinct support footprints. */
function clusterSupports(nodes: readonly SolverNodeView[], mergeDist = 1.05): SupportFootprint[] {
  const footprints: SupportFootprint[] = [];
  const mergeSq = mergeDist * mergeDist;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]!;
    const r = Math.max(0.22, Math.hypot(n.half.x, n.half.z));
    let merged = false;
    for (let j = 0; j < footprints.length; j++) {
      const fp = footprints[j]!;
      const dx = n.basePos.x - fp.x;
      const dz = n.basePos.z - fp.z;
      if (dx * dx + dz * dz <= mergeSq) {
        const w = fp.count + 1;
        fp.x = (fp.x * fp.count + n.basePos.x) / w;
        fp.z = (fp.z * fp.count + n.basePos.z) / w;
        fp.radius = Math.max(fp.radius, r);
        fp.count = w;
        merged = true;
        break;
      }
    }
    if (!merged) {
      footprints.push({ x: n.basePos.x, z: n.basePos.z, radius: r, count: 1 });
    }
  }
  return footprints;
}

/** Computes signed distance from point (px, pz) outside the 2D convex hull of `pts` (<= 0 means inside). */
function distanceOutsideConvexHull(
  px: number,
  pz: number,
  pts: readonly SupportFootprint[],
): { dist: number; dirX: number; dirZ: number } {
  const n = pts.length;
  if (n === 0) return { dist: Infinity, dirX: 1, dirZ: 0 };
  if (n === 1) {
    const dx = px - pts[0]!.x;
    const dz = pz - pts[0]!.z;
    const d = Math.hypot(dx, dz);
    return {
      dist: Math.max(0, d - pts[0]!.radius),
      dirX: d > 1e-4 ? dx / d : 1,
      dirZ: d > 1e-4 ? dz / d : 0,
    };
  }
  if (n === 2) {
    const ax = pts[0]!.x, az = pts[0]!.z;
    const bx = pts[1]!.x, bz = pts[1]!.z;
    const abx = bx - ax, abz = bz - az;
    const ab2 = abx * abx + abz * abz;
    const t = ab2 > 1e-6 ? Math.max(0, Math.min(1, ((px - ax) * abx + (pz - az) * abz) / ab2)) : 0;
    const cx = ax + abx * t;
    const cz = az + abz * t;
    const dx = px - cx;
    const dz = pz - cz;
    const d = Math.hypot(dx, dz);
    const pad = Math.max(pts[0]!.radius, pts[1]!.radius);
    return {
      dist: Math.max(0, d - pad),
      dirX: d > 1e-4 ? dx / d : 1,
      dirZ: d > 1e-4 ? dz / d : 0,
    };
  }

  // Andrew's monotone chain 2D convex hull (small N, typically 3..16 supports)
  const sorted = [...pts].sort((a, b) => (a.x !== b.x ? a.x - b.x : a.z - b.z));
  const cross = (o: SupportFootprint, a: SupportFootprint, b: SupportFootprint) =>
    (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);

  const lower: SupportFootprint[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: SupportFootprint[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  const hull = lower.concat(upper);
  if (hull.length < 3) {
    // Collinear supports: treat as segment between extreme points
    return distanceOutsideConvexHull(px, pz, [sorted[0]!, sorted[sorted.length - 1]!]);
  }

  // In CCW hull, interior lies on the LEFT of every directed edge (a -> b), so cross(a, b, P) >= 0.
  let inside = true;
  let minEdgeDist = Infinity;
  let bestDx = 1;
  let bestDz = 0;

  for (let i = 0; i < hull.length; i++) {
    const a = hull[i]!;
    const b = hull[(i + 1) % hull.length]!;
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const c = ex * (pz - a.z) - ez * (px - a.x);
    if (c < -1e-5) inside = false;

    const e2 = ex * ex + ez * ez;
    const t = e2 > 1e-6 ? Math.max(0, Math.min(1, ((px - a.x) * ex + (pz - a.z) * ez) / e2)) : 0;
    const cx = a.x + ex * t;
    const cz = a.z + ez * t;
    const dx = px - cx;
    const dz = pz - cz;
    const d = Math.hypot(dx, dz);
    const pad = Math.max(a.radius, b.radius);
    const eff = Math.max(0, d - pad);
    if (eff < minEdgeDist) {
      minEdgeDist = eff;
      if (d > 1e-4) {
        bestDx = dx / d;
        bestDz = dz / d;
      }
    }
  }

  if (inside) return { dist: 0, dirX: 0, dirZ: 0 };
  return { dist: minEdgeDist, dirX: bestDx, dirZ: bestDz };
}

/**
 * Precomputes initial support counts on a freshly built cluster so the solver knows which
 * elements originally relied on multiple legs/columns vs intentional cantilevers (like crane booms).
 */
export function computeInitialSupportMetadata(
  cluster: SolverClusterView,
): Map<string, { directSupports: number; anchoredSupports: number }> {
  const meta = new Map<string, { directSupports: number; anchoredSupports: number }>();

  // 1. Direct vertical supports per node
  for (const node of cluster.nodes) {
    const neighbors = cluster.adjacency.get(node.id);
    const direct: SolverNodeView[] = [];
    if (neighbors) {
      for (const nid of neighbors) {
        const other = cluster.byId.get(nid);
        if (other && isVerticalSupportFor(other, node)) direct.push(other);
      }
    }
    const distinctDirect = clusterSupports(direct).length;
    meta.set(node.id, { directSupports: distinctDirect, anchoredSupports: 0 });
  }

  // 2. Distinct anchored foundation supports per connected non-anchored load-bearing assembly
  const seen = new Set<string>();
  const queue: string[] = [];
  for (const start of cluster.nodes) {
    if (start.anchored || start.supportRole !== 'load_bearing' || seen.has(start.id)) continue;
    const comp: SolverNodeView[] = [];
    const anchorNodes: SolverNodeView[] = [];
    const anchorSeen = new Set<string>();
    seen.add(start.id);
    queue.length = 0;
    queue.push(start.id);
    let head = 0;
    while (head < queue.length) {
      const curr = cluster.byId.get(queue[head++]!)!;
      comp.push(curr);
      const neighbors = cluster.adjacency.get(curr.id);
      if (!neighbors) continue;
      for (const nid of neighbors) {
        const next = cluster.byId.get(nid);
        if (!next || next.supportRole !== 'load_bearing') continue;
        if (next.anchored) {
          if (!anchorSeen.has(next.id)) {
            anchorSeen.add(next.id);
            anchorNodes.push(next);
          }
          continue;
        }
        if (!seen.has(next.id)) {
          seen.add(next.id);
          queue.push(next.id);
        }
      }
    }
    const anchoredFootprints = clusterSupports(anchorNodes).length;
    for (const n of comp) {
      const entry = meta.get(n.id)!;
      entry.anchoredSupports = anchoredFootprints;
    }
  }

  return meta;
}

/**
 * Evaluates structural integrity of `cluster` after any node breaks or takes heavy damage.
 * Returns every intact node that must detach immediately (disconnected, tipping, or over-cantilevered)
 * plus any surviving vertical supports that are now overloaded and should buckle.
 */
export function solveStructuralIntegrity(cluster: SolverClusterView): StructuralSolveResult {
  const detachedMap = new Map<string, DetachedNodeDecision>();
  const overloaded: string[] = [];

  const isIntact = (n: SolverNodeView): boolean => n.state === 'intact' && !detachedMap.has(n.id);

  // ---------------------------------------------------------------------------
  // Pass 1: Load-Bearing Ground Connectivity (BFS through load_bearing only)
  // ---------------------------------------------------------------------------
  const runConnectivityPass = () => {
    const supported = new Set<string>();
    const queue: string[] = [];

    for (let i = 0; i < cluster.nodes.length; i++) {
      const n = cluster.nodes[i]!;
      if (!isIntact(n)) continue;
      if (n.anchored) {
        supported.add(n.id);
        if (n.supportRole === 'load_bearing') queue.push(n.id);
      }
    }

    let head = 0;
    while (head < queue.length) {
      const currId = queue[head++]!;
      const neighbors = cluster.adjacency.get(currId);
      if (!neighbors) continue;
      for (const nextId of neighbors) {
        if (supported.has(nextId)) continue;
        const next = cluster.byId.get(nextId);
        if (!next || !isIntact(next)) continue;
        supported.add(nextId);
        // Only load-bearing elements transmit structural support onward!
        if (next.supportRole === 'load_bearing') {
          queue.push(nextId);
        }
      }
    }

    for (let i = 0; i < cluster.nodes.length; i++) {
      const n = cluster.nodes[i]!;
      if (!isIntact(n) || supported.has(n.id)) continue;
      detachedMap.set(n.id, { nodeId: n.id, reason: 'disconnected', tipDirX: 0, tipDirZ: 0 });
    }
  };

  runConnectivityPass();

  // ---------------------------------------------------------------------------
  // Pass 2: Support-Polygon & Center-of-Mass Stability (No Floating Towers!)
  // ---------------------------------------------------------------------------
  const visitedComp = new Set<string>();
  const compQueue: string[] = [];

  for (let i = 0; i < cluster.nodes.length; i++) {
    const start = cluster.nodes[i]!;
    if (!isIntact(start) || start.anchored || start.supportRole !== 'load_bearing' || visitedComp.has(start.id)) {
      continue;
    }

    const comp: SolverNodeView[] = [];
    const survivingAnchors: SolverNodeView[] = [];
    const anchorIds = new Set<string>();
    let maxInitialAnchors = 0;

    visitedComp.add(start.id);
    compQueue.length = 0;
    compQueue.push(start.id);
    let head = 0;
    while (head < compQueue.length) {
      const curr = cluster.byId.get(compQueue[head++]!)!;
      comp.push(curr);
      if (curr.initialAnchoredSupportCount > maxInitialAnchors) {
        maxInitialAnchors = curr.initialAnchoredSupportCount;
      }
      const neighbors = cluster.adjacency.get(curr.id);
      if (!neighbors) continue;
      for (const nid of neighbors) {
        const next = cluster.byId.get(nid);
        if (!next || !isIntact(next) || next.supportRole !== 'load_bearing') continue;
        if (next.anchored) {
          if (!anchorIds.has(next.id)) {
            anchorIds.add(next.id);
            survivingAnchors.push(next);
          }
          continue;
        }
        if (!visitedComp.has(next.id)) {
          visitedComp.add(next.id);
          compQueue.push(next.id);
        }
      }
    }

    // Only check tipping if the assembly has actually lost at least one foundation support!
    const footprints = clusterSupports(survivingAnchors);
    if (maxInitialAnchors < 2 || footprints.length >= maxInitialAnchors) continue;

    // Compute combined mass & XZ Center of Mass (include attached infill weight too)
    let totalMass = 0;
    let comX = 0;
    let comZ = 0;
    for (let j = 0; j < comp.length; j++) {
      const n = comp[j]!;
      const m = Math.max(1, n.mass);
      totalMass += m;
      comX += n.basePos.x * m;
      comZ += n.basePos.z * m;
    }
    if (totalMass <= 0) continue;
    comX /= totalMass;
    comZ /= totalMass;

    let tips = false;
    let tipDirX = 1;
    let tipDirZ = 0;

    if (footprints.length === 0) {
      tips = true;
    } else if (footprints.length === 1) {
      // Single surviving support out of >= 2 original supports (e.g. 1 of 4 watchtower stilts left!).
      // Can ONLY stay standing if the single support is a wide central core directly underneath CoM.
      const fp = footprints[0]!;
      const dx = comX - fp.x;
      const dz = comZ - fp.z;
      const d = Math.hypot(dx, dz);
      const maxOffset = Math.max(0.45, fp.radius * 0.95);
      if (d > maxOffset) {
        tips = true;
        tipDirX = d > 1e-4 ? dx / d : 1;
        tipDirZ = d > 1e-4 ? dz / d : 0;
      }
    } else if (footprints.length === 2) {
      // Two surviving supports (e.g., 2 adjacent legs of a 4-leg tower -> CoM hangs outside the line!).
      const res = distanceOutsideConvexHull(comX, comZ, footprints);
      const tipMargin = 0.45;
      if (res.dist > tipMargin) {
        tips = true;
        tipDirX = res.dirX;
        tipDirZ = res.dirZ;
      }
    } else {
      // 3+ supports: check if CoM falls significantly outside the convex hull of remaining supports.
      const res = distanceOutsideConvexHull(comX, comZ, footprints);
      const hullMargin = 0.85;
      if (res.dist > hullMargin) {
        tips = true;
        tipDirX = res.dirX;
        tipDirZ = res.dirZ;
      }
    }

    if (tips) {
      for (let j = 0; j < comp.length; j++) {
        const n = comp[j]!;
        detachedMap.set(n.id, { nodeId: n.id, reason: 'tipping', tipDirX, tipDirZ });
      }
    }
  }

  // Re-run connectivity so any infill attached to tipped assemblies also detaches cleanly.
  if (detachedMap.size > 0) runConnectivityPass();

  // ---------------------------------------------------------------------------
  // Pass 3: Cantilever Span Limit (Partial Corner / Bay Collapses)
  // ---------------------------------------------------------------------------
  // Collect all surviving vertical supports in this cluster for fast nearest-support checks.
  const intactVerticals: SolverNodeView[] = [];
  for (let i = 0; i < cluster.nodes.length; i++) {
    const n = cluster.nodes[i]!;
    if (isIntact(n) && n.supportRole === 'load_bearing' && (VERTICAL_KINDS.has(n.kind) || n.anchored)) {
      intactVerticals.push(n);
    }
  }

  let cantileverDetached = false;
  for (let i = 0; i < cluster.nodes.length; i++) {
    const n = cluster.nodes[i]!;
    if (!isIntact(n) || n.anchored || !HORIZONTAL_KINDS.has(n.kind)) continue;
    // Only apply cantilever check to slabs/roofs that originally rested on vertical supports and lost one.
    if (n.initialSupportCount === 0) continue;

    // Count surviving direct vertical supports linked to this horizontal node
    const neighbors = cluster.adjacency.get(n.id);
    const directSurviving: SolverNodeView[] = [];
    if (neighbors) {
      for (const nid of neighbors) {
        const other = cluster.byId.get(nid);
        if (other && isIntact(other) && isVerticalSupportFor(other, n)) {
          directSurviving.push(other);
        }
      }
    }
    const distinctDirect = clusterSupports(directSurviving).length;
    if (distinctDirect >= n.initialSupportCount) continue;

    // Lost at least one direct vertical support! Check horizontal distance to nearest surviving vertical below it.
    let nearestDist = Infinity;
    let nearX = n.basePos.x;
    let nearZ = n.basePos.z;
    for (let v = 0; v < intactVerticals.length; v++) {
      const sup = intactVerticals[v]!;
      if (!isVerticalSupportFor(sup, n)) continue;
      const dx = Math.max(0, Math.abs(n.basePos.x - sup.basePos.x) - sup.half.x);
      const dz = Math.max(0, Math.abs(n.basePos.z - sup.basePos.z) - sup.half.z);
      const d = Math.hypot(dx, dz);
      if (d < nearestDist) {
        nearestDist = d;
        nearX = sup.basePos.x;
        nearZ = sup.basePos.z;
      }
    }

    const maxCantilever = STRUCTURAL_MATERIAL_PROPS[n.structuralMaterial].maxCantilever;
    const lostAllDirect = distinctDirect === 0 && n.initialSupportCount >= 1;
    if (nearestDist > maxCantilever || (lostAllDirect && nearestDist > Math.min(maxCantilever * 0.72, 2.4))) {
      const dx = n.basePos.x - nearX;
      const dz = n.basePos.z - nearZ;
      const d = Math.hypot(dx, dz);
      detachedMap.set(n.id, {
        nodeId: n.id,
        reason: 'cantilever',
        tipDirX: d > 1e-4 ? dx / d : 0,
        tipDirZ: d > 1e-4 ? dz / d : 0,
      });
      cantileverDetached = true;
    }
  }

  if (cantileverDetached) runConnectivityPass();

  // ---------------------------------------------------------------------------
  // Pass 4: Vertical Load Overload Cascade (Red Faction Column Buckling)
  // ---------------------------------------------------------------------------
  // Only evaluate overload if the cluster has actually suffered structural damage/breaks.
  let hasAnyDamage = detachedMap.size > 0;
  if (!hasAnyDamage) {
    for (let i = 0; i < cluster.nodes.length; i++) {
      const n = cluster.nodes[i]!;
      if (n.state !== 'intact' || n.hp < n.maxHp) {
        hasAnyDamage = true;
        break;
      }
    }
  }

  if (hasAnyDamage) {
    const loadBySupport = new Map<string, number>();
    const activeColumns: SolverNodeView[] = [];
    for (let i = 0; i < cluster.nodes.length; i++) {
      const n = cluster.nodes[i]!;
      if (isIntact(n) && n.supportRole === 'load_bearing' && VERTICAL_KINDS.has(n.kind) && Number.isFinite(n.loadCapacity)) {
        activeColumns.push(n);
        loadBySupport.set(n.id, 0);
      }
    }

    if (activeColumns.length > 0) {
      // Distribute every intact upper node's mass downward onto nearby vertical supports beneath it
      for (let i = 0; i < cluster.nodes.length; i++) {
        const upper = cluster.nodes[i]!;
        if (!isIntact(upper) || upper.anchored) continue;

        let weightSum = 0;
        const candidates: { id: string; w: number }[] = [];
        for (let c = 0; c < activeColumns.length; c++) {
          const col = activeColumns[c]!;
          if (col.id === upper.id) continue;
          if (col.basePos.y >= upper.basePos.y - 0.1) continue;
          const dx = upper.basePos.x - col.basePos.x;
          const dz = upper.basePos.z - col.basePos.z;
          const d2 = dx * dx + dz * dz;
          if (d2 > 144) continue; // Only supports within 12 m carry this bay's tributary weight
          const w = 1 / (1 + d2 * 0.25);
          candidates.push({ id: col.id, w });
          weightSum += w;
        }
        if (weightSum > 0) {
          for (let k = 0; k < candidates.length; k++) {
            const c = candidates[k]!;
            loadBySupport.set(c.id, (loadBySupport.get(c.id) ?? 0) + upper.mass * (c.w / weightSum));
          }
        }
      }

      for (let c = 0; c < activeColumns.length; c++) {
        const col = activeColumns[c]!;
        const carried = loadBySupport.get(col.id) ?? 0;
        const hpFrac = Math.max(0, Math.min(1, col.hp / Math.max(1, col.maxHp)));
        // Damaged columns lose compressive strength quickly; pristine columns have full capacity.
        const effectiveCap = col.loadCapacity * (0.3 + 0.7 * hpFrac);
        if (carried > effectiveCap && effectiveCap > 0) {
          overloaded.push(col.id);
        }
      }
    }
  }

  return {
    detached: [...detachedMap.values()],
    overloaded,
  };
}
