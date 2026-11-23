/**
 * Next-Gen Structural Fracture, Progressive DMM Deformation & Pooled 3D Splinter Engine.
 *
 * Inspired by *The Finals* (localized jagged punch-through panels + gradual hinged sagging) and
 * *Star Wars: The Force Unleashed* Digital Molecular Matter (DMM: wood bending/twisting/splintering,
 * metal denting/edge-buckling, concrete cratering/spalling).
 *
 * All geometry deformations mutate cached rest-state vertex buffers in place on damaged nodes only
 * (zero per-frame idle cost, zero per-hit geometry or material allocations).
 */
import * as THREE from 'three';
import { clamp } from '../core/math';
import type { Mat } from './kit/geo';
import type { StructuralNodeKind, StructuralNodeSpec } from './destruction';

export type MaterialClass = 'wood' | 'metal' | 'concrete' | 'stone';

/** Cap on simultaneously active pooled 3D splinters / shards / masonry chunks. */
export const MAX_SPLINTERS = 90;

const _c = new THREE.Color();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _v = new THREE.Vector3();

// ---------------------------------------------------------------------------------------------
// Material Classification & Deterministic Hashing
// ---------------------------------------------------------------------------------------------

export function inferMaterialClass(mat: Mat, explicit?: MaterialClass): MaterialClass {
  if (explicit) return explicit;
  switch (mat) {
    case 'plywood':
      return 'wood';
    case 'steel':
    case 'steelDark':
    case 'rust':
    case 'grate':
    case 'panel':
    case 'hazard':
      return 'metal';
    case 'dirt':
      return 'stone';
    case 'concrete':
    case 'concreteDark':
    case 'plaster':
    case 'tile':
    case 'paintWhite':
    case 'paintRed':
    case 'paintYellow':
    case 'asphalt':
    default:
      return 'concrete';
  }
}

function hashString(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

/** Deterministic pseudo-random float in [-1, 1]. */
function hashSigned(seed: number, a: number, b: number): number {
  let h = (seed ^ Math.imul(a + 374761393, 668265263) ^ Math.imul(b + 1274126177, 2246822519)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return (h / 0xffffffff) * 2 - 1;
}

function resolveColorRGB(color?: number | readonly [number, number, number]): [number, number, number] {
  if (typeof color === 'number') {
    _c.setHex(color);
    return [_c.r, _c.g, _c.b];
  }
  if (Array.isArray(color)) {
    return [color[0], color[1], color[2]];
  }
  return [1, 1, 1];
}

// ---------------------------------------------------------------------------------------------
// Watertight Irregular Jagged Panel Subdivision
// ---------------------------------------------------------------------------------------------

export interface FractureGridPlan {
  readonly cols: number;
  readonly rows: number;
  readonly uAxis: 0 | 1 | 2;
  readonly vAxis: 0 | 1 | 2;
  readonly nAxis: 0 | 1 | 2;
  readonly handedness: 1 | -1;
}

export interface PolyPoint2D {
  readonly u: number;
  readonly v: number;
  /** True when the edge starting at this vertex lies on an interior fracture seam. */
  readonly interiorEdge: boolean;
}

export interface FractureCellSpec {
  readonly cellIndex: number;
  readonly col: number;
  readonly row: number;
  readonly id: string;
  /** Local centroid offset in parent node space. */
  readonly localOffset: THREE.Vector3;
  /** Bounding half-extents of the cell in parent node axes. */
  readonly half: THREE.Vector3;
  /** Whether this cell is ground-anchored. */
  readonly anchored: boolean;
  /** 2D CCW polygon boundary in (u, v) centered around the cell centroid. */
  readonly polygon: readonly PolyPoint2D[];
  /** Extrusion half-thickness along nAxis. */
  readonly halfN: number;
  readonly plan: FractureGridPlan;
}

const FRACTURABLE_KINDS = new Set<StructuralNodeKind>(['wall', 'roof', 'slab']);

/**
 * Determines whether a node should be subdivided into a watertight irregular jagged fracture grid.
 * Subdivides when `fractureGrid` is specified OR automatically for broad thin Tier-0/1 walls/roofs/slabs
 * (two largest full dimensions >= 2.2m, thin axis <= 0.75m). Never subdivides columns, posts, or small trim.
 */
export function resolveFractureGrid(
  spec: StructuralNodeSpec,
  half: THREE.Vector3,
): FractureGridPlan | null {
  if (!FRACTURABLE_KINDS.has(spec.kind)) return null;

  const hArr: readonly [number, number, number] = [half.x, half.y, half.z];
  // Thin axis is the axis with minimum half-extent
  let nAxis: 0 | 1 | 2 = 0;
  if (hArr[1] < hArr[nAxis]) nAxis = 1;
  if (hArr[2] < hArr[nAxis]) nAxis = 2;

  // Consistent (uAxis, vAxis) so vertical walls ALWAYS have vAxis === 1 (Y = up)
  let uAxis: 0 | 1 | 2;
  let vAxis: 0 | 1 | 2;
  if (nAxis === 2) {
    uAxis = 0;
    vAxis = 1;
  } else if (nAxis === 0) {
    uAxis = 2;
    vAxis = 1;
  } else {
    uAxis = 0;
    vAxis = 2;
  }

  const handedness: 1 | -1 = nAxis === 2 ? 1 : -1;

  if (spec.fractureGrid) {
    const cols = clamp(Math.round(spec.fractureGrid[0]), 1, 4);
    const rows = clamp(Math.round(spec.fractureGrid[1]), 1, 4);
    if (cols * rows <= 1) return null;
    return { cols, rows, uAxis, vAxis, nAxis, handedness };
  }

  // Automatic subdivision: large thin Tier-0/1 panels only (keeps heavy Tier-2/3 structures & collider budgets tight)
  if (spec.tier > 1) return null;
  const fullN = hArr[nAxis] * 2;
  const fullU = hArr[uAxis] * 2;
  const fullV = hArr[vAxis] * 2;
  if (fullN > 0.75 || fullU < 2.2 || fullV < 2.2) return null;

  let cols = fullU >= 5.2 ? 3 : 2;
  let rows = fullV >= 5.2 ? 3 : 2;
  // Cap automatic cell count at <= 6 (e.g., 2x2 or 3x2) for blazing runtime performance
  if (cols * rows > 6) {
    if (fullU >= fullV) rows = 2;
    else cols = 2;
  }
  return { cols, rows, uAxis, vAxis, nAxis, handedness };
}

/**
 * Generates a watertight irregular jagged cell partition for a broad structural panel.
 * Shared interior edges use identical perturbed jagged polylines so adjacent cells interlock
 * with zero gaps when intact and expose sharp jagged edges when punched out.
 */
export function planPanelFracture(
  spec: StructuralNodeSpec,
  half: THREE.Vector3,
  plan: FractureGridPlan,
): FractureCellSpec[] {
  const { cols, rows, uAxis, vAxis, nAxis } = plan;
  const hArr = [half.x, half.y, half.z];
  const halfU = hArr[uAxis]!;
  const halfV = hArr[vAxis]!;
  const halfN = hArr[nAxis]!;
  const cellW = (halfU * 2) / cols;
  const cellH = (halfV * 2) / rows;
  const seed = hashString(spec.id);

  // Build (rows + 1) x (cols + 1) perturbed lattice of cell corners
  const grid: { u: number; v: number }[][] = [];
  for (let r = 0; r <= rows; r++) {
    const rowPts: { u: number; v: number }[] = [];
    for (let c = 0; c <= cols; c++) {
      let u = -halfU + c * cellW;
      let v = -halfV + r * cellH;
      if (c > 0 && c < cols) {
        const amp = r === 0 || r === rows ? 0.16 : 0.24;
        u += hashSigned(seed, c * 17 + 3, r * 31 + 5) * cellW * amp;
      }
      if (r > 0 && r < rows) {
        const amp = c === 0 || c === cols ? 0.16 : 0.24;
        v += hashSigned(seed, c * 29 + 11, r * 13 + 7) * cellH * amp;
      }
      rowPts.push({ u, v });
    }
    grid.push(rowPts);
  }

  // Canonical interior jagged polylines (2 zigzag points per interior edge, 1 midpoint on outer edge)
  const sampleEdge = (
    a: { u: number; v: number },
    b: { u: number; v: number },
    isInterior: boolean,
    edgeKeyA: number,
    edgeKeyB: number,
    reverse: boolean,
  ): { u: number; v: number }[] => {
    const du = b.u - a.u;
    const dv = b.v - a.v;
    const len = Math.hypot(du, dv);
    if (len < 1e-4) return [];

    if (!isInterior) {
      // Flush straight outer boundary with midpoint for smooth deformation
      return [{ u: (a.u + b.u) * 0.5, v: (a.v + b.v) * 0.5 }];
    }

    const pu = -dv / len;
    const pv = du / len;
    const maxOffset = Math.min(cellW, cellH) * 0.11;
    const raw1 = hashSigned(seed, edgeKeyA * 19 + 1, edgeKeyB * 43 + 3);
    const sign1 = raw1 >= 0 ? 1 : -1;
    const amp1 = Math.min(maxOffset, len * (0.065 + 0.045 * Math.abs(raw1))) * sign1;
    const raw2 = hashSigned(seed, edgeKeyA * 37 + 7, edgeKeyB * 53 + 11);
    const amp2 = -Math.min(maxOffset, len * (0.065 + 0.045 * Math.abs(raw2))) * sign1;

    const p1 = { u: a.u + du * 0.34 + pu * amp1, v: a.v + dv * 0.34 + pv * amp1 };
    const p2 = { u: a.u + du * 0.66 + pu * amp2, v: a.v + dv * 0.66 + pv * amp2 };
    return reverse ? [p2, p1] : [p1, p2];
  };

  const cells: FractureCellSpec[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const pBL = grid[r]![c]!;
      const pBR = grid[r]![c + 1]!;
      const pTR = grid[r + 1]![c + 1]!;
      const pTL = grid[r + 1]![c]!;

      const polyRaw: PolyPoint2D[] = [];
      const pushEdge = (
        start: { u: number; v: number },
        mids: { u: number; v: number }[],
        isInterior: boolean,
      ) => {
        polyRaw.push({ u: start.u, v: start.v, interiorEdge: isInterior });
        for (const m of mids) {
          polyRaw.push({ u: m.u, v: m.v, interiorEdge: isInterior });
        }
      };

      // Bottom edge (canonical: pBL -> pBR)
      const bottomInt = r > 0;
      pushEdge(pBL, sampleEdge(pBL, pBR, bottomInt, r * 100 + c, 1, false), bottomInt);

      // Right edge (canonical: pBR -> pTR)
      const rightInt = c < cols - 1;
      pushEdge(pBR, sampleEdge(pBR, pTR, rightInt, r * 100 + (c + 1), 2, false), rightInt);

      // Top edge (canonical: pTL -> pTR, traversed reversed pTR -> pTL)
      const topInt = r < rows - 1;
      pushEdge(pTR, sampleEdge(pTL, pTR, topInt, (r + 1) * 100 + c, 1, true), topInt);

      // Left edge (canonical: pBL -> pTL, traversed reversed pTL -> pBL)
      const leftInt = c > 0;
      pushEdge(pTL, sampleEdge(pBL, pTL, leftInt, r * 100 + c, 2, true), leftInt);

      // Centroid from corners (strictly interior for star-shaped triangulation)
      const cu = (pBL.u + pBR.u + pTR.u + pTL.u) * 0.25;
      const cv = (pBL.v + pBR.v + pTR.v + pTL.v) * 0.25;

      let minU = Infinity;
      let maxU = -Infinity;
      let minV = Infinity;
      let maxV = -Infinity;
      const polygon: PolyPoint2D[] = polyRaw.map(pt => {
        const lu = pt.u - cu;
        const lv = pt.v - cv;
        if (lu < minU) minU = lu;
        if (lu > maxU) maxU = lu;
        if (lv < minV) minV = lv;
        if (lv > maxV) maxV = lv;
        return { u: lu, v: lv, interiorEdge: pt.interiorEdge };
      });

      const localOffset = new THREE.Vector3();
      localOffset.setComponent(uAxis, cu);
      localOffset.setComponent(vAxis, cv);
      localOffset.setComponent(nAxis, 0);

      const cellHalf = new THREE.Vector3();
      cellHalf.setComponent(uAxis, Math.max(0.12, (maxU - minU) * 0.5));
      cellHalf.setComponent(vAxis, Math.max(0.12, (maxV - minV) * 0.5));
      cellHalf.setComponent(nAxis, halfN);

      const cellIndex = r * cols + c;
      // Vertical anchored walls anchor ONLY the bottom row so blasting out bottom cells drops upper cells!
      const anchored = !spec.anchored ? false : nAxis !== 1 ? r === 0 : true;

      cells.push({
        cellIndex,
        col: c,
        row: r,
        id: `${spec.id}#${cellIndex}`,
        localOffset,
        half: cellHalf,
        anchored,
        polygon,
        halfN,
        plan,
      });
    }
  }

  return cells;
}

// ---------------------------------------------------------------------------------------------
// Geometry Builders (Fracture Shards + Subdivided Deformable Cuboids)
// ---------------------------------------------------------------------------------------------

function mapUVN(
  u: number,
  v: number,
  n: number,
  uAxis: 0 | 1 | 2,
  vAxis: 0 | 1 | 2,
  nAxis: 0 | 1 | 2,
  out: [number, number, number],
): void {
  out[uAxis] = u;
  out[vAxis] = v;
  out[nAxis] = n;
}

/**
 * Builds an extruded jagged shard geometry for a single fracture cell, with:
 * - 2-ring spiderweb face subdivision on front & back faces for smooth DMM bending/denting
 * - Mid-thickness jagged beveled interior fracture cross-sections with darkened exposed core shading
 * - Seamless planar UVs matching parent panel coordinates
 */
export function buildFractureCellGeometry(
  cell: FractureCellSpec,
  color?: number | readonly [number, number, number],
  materialClass: MaterialClass = 'concrete',
): THREE.BufferGeometry {
  const { polygon, halfN, plan, localOffset } = cell;
  const { uAxis, vAxis, nAxis, handedness } = plan;
  const N = polygon.length;
  const [cr, cg, cb] = resolveColorRGB(color);
  const cuOff = localOffset.getComponent(uAxis);
  const cvOff = localOffset.getComponent(vAxis);
  const uvScale = 0.35;

  // Exposed interior fracture cross-section shade (raw splintered wood / sheared metal / masonry core)
  const coreMul = materialClass === 'wood' ? 0.72 : materialClass === 'metal' ? 0.76 : 0.68;
  const outerSideMul = 0.92;

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const tmp: [number, number, number] = [0, 0, 0];
  const nrm: [number, number, number] = [0, 0, 0];

  const pushVert = (
    u: number,
    v: number,
    n: number,
    nu: number,
    nv: number,
    nn: number,
    uv0: number,
    uv1: number,
    shade: number,
  ): number => {
    const idx = positions.length / 3;
    mapUVN(u, v, n, uAxis, vAxis, nAxis, tmp);
    mapUVN(nu, nv, nn, uAxis, vAxis, nAxis, nrm);
    positions.push(tmp[0], tmp[1], tmp[2]);
    normals.push(nrm[0], nrm[1], nrm[2]);
    uvs.push(uv0, uv1);
    colors.push(
      clamp(Math.round(cr * shade * 255), 0, 255),
      clamp(Math.round(cg * shade * 255), 0, 255),
      clamp(Math.round(cb * shade * 255), 0, 255),
      255,
    );
    return idx;
  };

  const pushTri = (a: number, b: number, c: number, flip: boolean) => {
    if (flip) indices.push(a, c, b);
    else indices.push(a, b, c);
  };

  // Front (+halfN) and Back (-halfN) faces with 2-ring subdivision (center -> midRing -> outerRing)
  for (const side of [1, -1] as const) {
    const nPos = side * halfN;
    // Flip winding when (side * handedness < 0) so outward normal ALWAYS matches `side * nAxis`
    const flip = side * handedness < 0;
    const shade = side > 0 ? 1.0 : 0.96;

    const centerIdx = pushVert(0, 0, nPos, 0, 0, side, cuOff * uvScale, cvOff * uvScale, shade);
    const midStart = positions.length / 3;
    for (let i = 0; i < N; i++) {
      const p = polygon[i]!;
      const mu = p.u * 0.52;
      const mv = p.v * 0.52;
      pushVert(mu, mv, nPos, 0, 0, side, (cuOff + mu) * uvScale, (cvOff + mv) * uvScale, shade);
    }
    const outStart = positions.length / 3;
    for (let i = 0; i < N; i++) {
      const p = polygon[i]!;
      pushVert(p.u, p.v, nPos, 0, 0, side, (cuOff + p.u) * uvScale, (cvOff + p.v) * uvScale, shade);
    }

    for (let i = 0; i < N; i++) {
      const next = (i + 1) % N;
      const m0 = midStart + i;
      const m1 = midStart + next;
      const o0 = outStart + i;
      const o1 = outStart + next;
      pushTri(centerIdx, m0, m1, flip);
      pushTri(m0, o0, o1, flip);
      pushTri(m0, o1, m1, flip);
    }
  }

  // Perimeter side walls with mid-thickness jagged fracture cross-section ridge on interior cracks
  const sideFlip = handedness < 0;
  const seed = hashString(cell.id);
  let arc = 0;

  for (let i = 0; i < N; i++) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % N]!;
    const du = b.u - a.u;
    const dv = b.v - a.v;
    const len = Math.hypot(du, dv);
    if (len < 1e-5) continue;

    // Outward 2D normal for CCW edge a -> b is (+dv, -du)
    const nu = dv / len;
    const nv = -du / len;
    const isCrack = a.interiorEdge;
    const shade = isCrack ? coreMul : outerSideMul;

    // Subtle jagged mid-thickness bevel on interior cracked edges (keeps outer silhouette watertight)
    const jagA = isCrack ? hashSigned(seed, i * 11, 3) * Math.min(0.035, halfN * 0.25) : 0;
    const jagB = isCrack ? hashSigned(seed, ((i + 1) % N) * 11, 3) * Math.min(0.035, halfN * 0.25) : 0;

    const u0 = arc * uvScale;
    const u1 = (arc + len) * uvScale;
    arc += len;

    const b0 = pushVert(a.u, a.v, -halfN, nu, nv, 0, u0, -halfN * uvScale, shade);
    const b1 = pushVert(b.u, b.v, -halfN, nu, nv, 0, u1, -halfN * uvScale, shade);
    const m0 = pushVert(a.u + nu * jagA, a.v + nv * jagA, 0, nu, nv, 0, u0, 0, shade * (isCrack ? 0.9 : 1));
    const m1 = pushVert(b.u + nu * jagB, b.v + nv * jagB, 0, nu, nv, 0, u1, 0, shade * (isCrack ? 0.9 : 1));
    const f0 = pushVert(a.u, a.v, halfN, nu, nv, 0, u0, halfN * uvScale, shade);
    const f1 = pushVert(b.u, b.v, halfN, nu, nv, 0, u1, halfN * uvScale, shade);

    // Quad strip: (-halfN -> 0) and (0 -> +halfN)
    pushTri(b0, b1, m1, sideFlip);
    pushTri(b0, m1, m0, sideFlip);
    pushTri(m0, m1, f1, sideFlip);
    pushTri(m0, f1, f0, sideFlip);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
  g.setAttribute('color', new THREE.BufferAttribute(new Uint8Array(colors), 4, true));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/**
 * Builds a subdivided cuboid BufferGeometry with 4-6 segments along long beams/columns and
 * 2-3 segments along broad faces so wood bending/twisting and metal denting deform cleanly in real time.
 */
export function buildSubdividedBoxGeometry(
  half: THREE.Vector3,
  color?: number | readonly [number, number, number],
): THREE.BufferGeometry {
  const maxH = Math.max(half.x, half.y, half.z);
  const segFor = (h: number): number => {
    const full = h * 2;
    if (h >= maxH * 0.85 && full >= 1.4) return clamp(Math.round(full / 0.72), 4, 6);
    if (full >= 0.9) return 3;
    if (full >= 0.32) return 2;
    return 1;
  };

  const sx = segFor(half.x);
  const sy = segFor(half.y);
  const sz = segFor(half.z);
  const [cr, cg, cb] = resolveColorRGB(color);
  const r8 = clamp(Math.round(cr * 255), 0, 255);
  const g8 = clamp(Math.round(cg * 255), 0, 255);
  const b8 = clamp(Math.round(cb * 255), 0, 255);

  const box = new THREE.BoxGeometry(half.x * 2, half.y * 2, half.z * 2, sx, sy, sz);
  const posAttr = box.getAttribute('position') as THREE.BufferAttribute;
  const nrmAttr = box.getAttribute('normal') as THREE.BufferAttribute;
  const uvAttr = box.getAttribute('uv') as THREE.BufferAttribute;
  const vCount = posAttr.count;

  // Match world-scale UVs & Uint8 normalized vertex colors expected by kit materials
  const uvScale = 0.35;
  for (let i = 0; i < vCount; i++) {
    const nx = Math.abs(nrmAttr.getX(i));
    const ny = Math.abs(nrmAttr.getY(i));
    const px = posAttr.getX(i);
    const py = posAttr.getY(i);
    const pz = posAttr.getZ(i);
    if (nx > 0.5) uvAttr.setXY(i, pz * uvScale, py * uvScale);
    else if (ny > 0.5) uvAttr.setXY(i, px * uvScale, pz * uvScale);
    else uvAttr.setXY(i, px * uvScale, py * uvScale);
  }
  uvAttr.needsUpdate = true;

  const colArr = new Uint8Array(vCount * 4);
  for (let i = 0; i < vCount; i++) {
    const o = i * 4;
    colArr[o] = r8;
    colArr[o + 1] = g8;
    colArr[o + 2] = b8;
    colArr[o + 3] = 255;
  }
  box.setAttribute('color', new THREE.BufferAttribute(colArr, 4, true));
  box.computeBoundingSphere();
  return box;
}

// ---------------------------------------------------------------------------------------------
// DMM-Inspired Real-Time Progressive Deformation (Zero Allocations, In-Place Buffer Mutation)
// ---------------------------------------------------------------------------------------------

export interface DeformNodeParams {
  readonly geom: THREE.BufferGeometry;
  readonly restPos: Float32Array;
  readonly restCol: Uint8Array;
  readonly half: THREE.Vector3;
  readonly materialClass: MaterialClass;
  /** Local-space impact point (will be clamped inside box bounds). */
  readonly localHit: THREE.Vector3;
  /** Local-space impact push direction (unit vector into/through node). */
  readonly localDir: THREE.Vector3;
  /** Total damage ratio `1 - hp / maxHp` in (0, 1]. */
  readonly damageFrac: number;
  /** Incremental damage ratio of this hit in (0, 1]. */
  readonly hitFrac: number;
  /** Mutable accumulated bend direction in local space (updated for wood elastic whip). */
  readonly bendDirAccum: THREE.Vector3;
}

/**
 * Progressively deforms a node's vertex positions and crack/crease vertex colors in place:
 * - Wood: parabolic beam bending perpendicular to impact + axial torsional twist + grain-crack darkening
 * - Metal: localized inward dent crater around impact + outward edge buckling/warping + crease shading
 * - Concrete / Stone: angular spall crater around impact + darkened radiating crack lines
 */
export function deformNodeGeometry(params: DeformNodeParams): void {
  const { geom, restPos, restCol, half, materialClass, damageFrac, hitFrac, bendDirAccum } = params;
  const posAttr = geom.getAttribute('position') as THREE.BufferAttribute | undefined;
  const colAttr = geom.getAttribute('color') as THREE.BufferAttribute | undefined;
  if (!posAttr || !colAttr) return;

  const posArr = posAttr.array as Float32Array;
  const colArr = colAttr.array as Uint8Array;
  const vCount = posAttr.count;
  const strain = clamp(damageFrac, 0.08, 1);

  const hx = Math.max(0.08, half.x);
  const hy = Math.max(0.08, half.y);
  const hz = Math.max(0.08, half.z);

  const hitX = clamp(params.localHit.x, -hx, hx);
  const hitY = clamp(params.localHit.y, -hy, hy);
  const hitZ = clamp(params.localHit.z, -hz, hz);

  let dx = params.localDir.x;
  let dy = params.localDir.y;
  let dz = params.localDir.z;
  const dLen = Math.hypot(dx, dy, dz);
  if (dLen > 1e-4) {
    dx /= dLen;
    dy /= dLen;
    dz /= dLen;
  } else {
    // Default inward along thin axis
    if (hx <= hy && hx <= hz) dx = 1;
    else if (hy <= hx && hy <= hz) dy = -1;
    else dz = 1;
  }

  if (materialClass === 'wood') {
    // Identify long axis of wooden beam/plank/wall
    const hVals = [hx, hy, hz];
    let longAxis: 0 | 1 | 2 = 0;
    if (hVals[1]! > hVals[longAxis]!) longAxis = 1;
    if (hVals[2]! > hVals[longAxis]!) longAxis = 2;
    const a1 = ((longAxis + 1) % 3) as 0 | 1 | 2;
    const a2 = ((longAxis + 2) % 3) as 0 | 1 | 2;

    // Bend direction is impact push projected perpendicular to the long axis
    const dirArr = [dx, dy, dz];
    dirArr[longAxis] = 0;
    let bLen = Math.hypot(dirArr[0]!, dirArr[1]!, dirArr[2]!);
    if (bLen < 0.15) {
      // Impact was along long axis -> bow toward the thinnest cross-section axis
      const thin = hVals[a1]! <= hVals[a2]! ? a1 : a2;
      dirArr[0] = 0;
      dirArr[1] = 0;
      dirArr[2] = 0;
      dirArr[thin] = 1;
      bLen = 1;
    }
    dirArr[0]! /= bLen;
    dirArr[1]! /= bLen;
    dirArr[2]! /= bLen;

    // Blend into accumulated bend direction so repeated hits bow coherently & store whip direction
    bendDirAccum.x = bendDirAccum.x * 0.55 + dirArr[0]! * 0.45;
    bendDirAccum.y = bendDirAccum.y * 0.55 + dirArr[1]! * 0.45;
    bendDirAccum.z = bendDirAccum.z * 0.55 + dirArr[2]! * 0.45;
    if (bendDirAccum.lengthSq() > 1e-4) bendDirAccum.normalize();
    else bendDirAccum.set(dirArr[0]!, dirArr[1]!, dirArr[2]!);

    const longHalf = hVals[longAxis]!;
    const hitCoords = [hitX, hitY, hitZ];
    const sHit = clamp(hitCoords[longAxis]! / longHalf, -0.85, 0.85);
    const maxBend = clamp(longHalf * 0.18, 0.14, 0.48) * Math.pow(strain, 0.85);
    const twistSign = (hitCoords[a1]! + hitCoords[a2]! >= 0 ? 1 : -1);
    const maxTwist = (0.12 + 0.24 * strain) * twistSign;

    for (let i = 0; i < vCount; i++) {
      const o = i * 3;
      const rx = restPos[o]!;
      const ry = restPos[o + 1]!;
      const rz = restPos[o + 2]!;
      const rArr = [rx, ry, rz];

      const s = clamp(rArr[longAxis]! / longHalf, -1, 1);
      // Parabolic arch deflection + local kink around hit point
      const arch = 1 - s * s * 0.82;
      const ds = s - sHit;
      const kink = Math.exp(-2.6 * ds * ds);
      const bend = maxBend * (0.55 * arch + 0.45 * kink);

      // Torsional twist around long axis
      const theta = maxTwist * s * (0.4 + 0.6 * kink);
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);
      const v1 = rArr[a1]!;
      const v2 = rArr[a2]!;
      rArr[a1] = v1 * cosT - v2 * sinT;
      rArr[a2] = v1 * sinT + v2 * cosT;

      posArr[o] = rArr[0]! + bendDirAccum.x * bend;
      posArr[o + 1] = rArr[1]! + bendDirAccum.y * bend;
      posArr[o + 2] = rArr[2]! + bendDirAccum.z * bend;

      // Darken grain cracks along strain zone
      const grain = 0.5 + 0.5 * Math.sin(rArr[a1]! * 18 + rArr[a2]! * 13);
      const crackFactor = clamp(kink * strain * (0.42 + 0.28 * grain), 0, 0.55);
      const shade = 1 - crackFactor;
      const co = i * 4;
      colArr[co] = Math.round(restCol[co]! * shade);
      colArr[co + 1] = Math.round(restCol[co + 1]! * (shade * 0.96));
      colArr[co + 2] = Math.round(restCol[co + 2]! * (shade * 0.9));
    }
  } else if (materialClass === 'metal') {
    // Metal: localized inward dent around impact + outward rim/edge buckling + crease shading
    const maxSpan = Math.max(hx, hy, hz);
    const minSpan = Math.min(hx, hy, hz);
    const dentR = clamp(maxSpan * 0.78, 0.65, 2.0);
    const rimR = dentR * 1.85;
    const hitScale = clamp(0.65 + hitFrac * 1.4, 0.65, 1.35);
    const dentDepth = clamp((0.16 + 0.26 * strain) * hitScale, 0.12, 0.44);
    const maxDisp = clamp(Math.min(0.55, maxSpan * 0.38), 0.2, 0.55);

    // On flat panels/sheets, strongly bias dent direction perpendicular INTO the struck face
    let dentX = dx;
    let dentY = dy;
    let dentZ = dz;
    if (minSpan <= maxSpan * 0.45) {
      if (hx <= hy && hx <= hz) {
        const inward = Math.abs(hitX) > 1e-3 ? -Math.sign(hitX) : (dx >= 0 ? 1 : -1);
        dentX = dentX * 0.25 + inward * 0.95;
        dentY *= 0.25;
        dentZ *= 0.25;
      } else if (hy <= hx && hy <= hz) {
        const inward = Math.abs(hitY) > 1e-3 ? -Math.sign(hitY) : (dy >= 0 ? 1 : -1);
        dentX *= 0.25;
        dentY = dentY * 0.25 + inward * 0.95;
        dentZ *= 0.25;
      } else {
        const inward = Math.abs(hitZ) > 1e-3 ? -Math.sign(hitZ) : (dz >= 0 ? 1 : -1);
        dentX *= 0.25;
        dentY *= 0.25;
        dentZ = dentZ * 0.25 + inward * 0.95;
      }
    }
    const dnLen = Math.hypot(dentX, dentY, dentZ) || 1;
    dentX /= dnLen;
    dentY /= dnLen;
    dentZ /= dnLen;

    for (let i = 0; i < vCount; i++) {
      const o = i * 3;
      const rx = restPos[o]!;
      const ry = restPos[o + 1]!;
      const rz = restPos[o + 2]!;
      const dist = Math.hypot(rx - hitX, ry - hitY, rz - hitZ);

      let push = 0;
      let shadeMul = 1;
      if (dist < dentR) {
        const u = dist / dentR;
        const crater = Math.pow(1 - u * u, 1.4);
        push = dentDepth * crater;
        shadeMul = 1 - 0.28 * crater;
      } else if (dist < rimR) {
        // Outward buckling & sheet-metal oil-canning warp around crater rim
        const rt = (dist - dentR) / (rimR - dentR);
        const rimWave = Math.sin(rt * Math.PI);
        const buckle = 0.75 + 0.25 * Math.sin((rx + ry + rz) * 4.5);
        push = -dentDepth * 0.34 * rimWave * buckle;
        shadeMul = 1 + 0.1 * rimWave;
      }

      if (push !== 0) {
        const nx = posArr[o]! + dentX * push;
        const ny = posArr[o + 1]! + dentY * push;
        const nz = posArr[o + 2]! + dentZ * push;
        const ox = nx - rx;
        const oy = ny - ry;
        const oz = nz - rz;
        const oLen = Math.hypot(ox, oy, oz);
        if (oLen > maxDisp) {
          const s = maxDisp / oLen;
          posArr[o] = rx + ox * s;
          posArr[o + 1] = ry + oy * s;
          posArr[o + 2] = rz + oz * s;
        } else {
          posArr[o] = nx;
          posArr[o + 1] = ny;
          posArr[o + 2] = nz;
        }

        const co = i * 4;
        colArr[co] = clamp(Math.round(colArr[co]! * shadeMul), 0, 255);
        colArr[co + 1] = clamp(Math.round(colArr[co + 1]! * shadeMul), 0, 255);
        colArr[co + 2] = clamp(Math.round(colArr[co + 2]! * shadeMul), 0, 255);
      }
    }
  } else {
    // Concrete / Stone: angular spall crater around impact + darkened radiating crack lines
    const maxSpan = Math.max(hx, hy, hz);
    const craterR = clamp(maxSpan * 0.52, 0.42, 1.5);
    const crackR = craterR * 1.95;
    const depth = clamp(0.08 + 0.18 * strain, 0.06, 0.28);
    const maxDisp = clamp(Math.min(0.36, maxSpan * 0.25), 0.12, 0.36);

    for (let i = 0; i < vCount; i++) {
      const o = i * 3;
      const rx = restPos[o]!;
      const ry = restPos[o + 1]!;
      const rz = restPos[o + 2]!;
      const vx = rx - hitX;
      const vy = ry - hitY;
      const vz = rz - hitZ;
      const dist = Math.hypot(vx, vy, vz);

      if (dist < craterR) {
        const t = 1 - dist / craterR;
        const angular = 0.65 + 0.35 * Math.abs(Math.sin(vx * 9.3 + vy * 7.1 + vz * 11.7));
        const push = depth * t * angular;
        const nx = posArr[o]! + dx * push;
        const ny = posArr[o + 1]! + dy * push;
        const nz = posArr[o + 2]! + dz * push;
        const ox = nx - rx;
        const oy = ny - ry;
        const oz = nz - rz;
        const oLen = Math.hypot(ox, oy, oz);
        if (oLen > maxDisp) {
          const s = maxDisp / oLen;
          posArr[o] = rx + ox * s;
          posArr[o + 1] = ry + oy * s;
          posArr[o + 2] = rz + oz * s;
        } else {
          posArr[o] = nx;
          posArr[o + 1] = ny;
          posArr[o + 2] = nz;
        }
      }

      if (dist < crackR) {
        const ang = Math.atan2(vy + vz * 0.5, vx + 1e-4);
        const ray = Math.pow(Math.abs(Math.sin(ang * 3.5 + hitX * 2.1)), 6);
        const radial = 1 - dist / crackR;
        const crackDark = clamp(radial * (0.22 + 0.32 * ray) * strain, 0, 0.45);
        const shade = 1 - crackDark;
        const co = i * 4;
        colArr[co] = Math.round(restCol[co]! * shade);
        colArr[co + 1] = Math.round(restCol[co + 1]! * shade);
        colArr[co + 2] = Math.round(restCol[co + 2]! * shade);
      }
    }
  }

  posAttr.needsUpdate = true;
  colAttr.needsUpdate = true;
  geom.computeVertexNormals();
  geom.computeBoundingSphere();
}

/**
 * Applies dramatic break-time split-end jagged fiber tear (wood) or curled edge warp (metal)
 * right as a node tears free into a dynamic rigid body.
 */
export function applyBreakFractureDeform(
  geom: THREE.BufferGeometry,
  half: THREE.Vector3,
  materialClass: MaterialClass,
): void {
  const posAttr = geom.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (!posAttr) return;
  const posArr = posAttr.array as Float32Array;
  const vCount = posAttr.count;
  const hx = Math.max(0.08, half.x);
  const hy = Math.max(0.08, half.y);
  const hz = Math.max(0.08, half.z);

  if (materialClass === 'wood') {
    const hVals = [hx, hy, hz];
    let longAxis: 0 | 1 | 2 = 0;
    if (hVals[1]! > hVals[longAxis]!) longAxis = 1;
    if (hVals[2]! > hVals[longAxis]!) longAxis = 2;
    const longH = hVals[longAxis]!;
    for (let i = 0; i < vCount; i++) {
      const o = i * 3;
      const coord = posArr[o + longAxis]!;
      // Jagged splintered teeth at the broken ends
      if (Math.abs(coord) >= longH * 0.72) {
        const jag = Math.sin(i * 12.9898) * 0.14 * Math.min(0.6, longH);
        posArr[o + longAxis] = coord + jag;
      }
    }
  } else if (materialClass === 'metal') {
    // Curl outer edges of torn sheet-metal slightly for bent shrapnel silhouette
    const thinAxis: 0 | 1 | 2 = hx <= hy && hx <= hz ? 0 : hy <= hx && hy <= hz ? 1 : 2;
    const maxSpan = Math.max(hx, hy, hz);
    for (let i = 0; i < vCount; i++) {
      const o = i * 3;
      const dist = Math.hypot(posArr[o]!, posArr[o + 1]!, posArr[o + 2]!);
      const edgeFrac = clamp(dist / Math.max(0.2, maxSpan), 0, 1);
      if (edgeFrac > 0.55) {
        posArr[o + thinAxis] = posArr[o + thinAxis]! + (edgeFrac - 0.55) * (edgeFrac - 0.55) * 0.45;
      }
    }
  } else {
    return;
  }

  posAttr.needsUpdate = true;
  geom.computeVertexNormals();
}

// ---------------------------------------------------------------------------------------------
// Pooled 3D Splinter, Metal Shard & Masonry Chunk Ring Buffer (Zero Material Leaks)
// ---------------------------------------------------------------------------------------------

export type SplinterKind = 'wood' | 'metal' | 'concrete';

interface SplinterSlot {
  active: boolean;
  kind: SplinterKind;
  px: number;
  py: number;
  pz: number;
  vx: number;
  vy: number;
  vz: number;
  rx: number;
  ry: number;
  rz: number;
  ax: number;
  ay: number;
  az: number;
  sx: number;
  sy: number;
  sz: number;
  age: number;
  maxAge: number;
  colorHex: number;
}

function buildWoodSplinterGeometry(): THREE.BufferGeometry {
  // Elongated jagged wooden splinter (~0.56m long, pointed split ends, triangular/trapezoidal cross-section)
  const positions = new Float32Array([
    // Tip -X
    -0.30, 0.005, 0.0,
    // Mid-left ring
    -0.12, -0.022, -0.042,
    -0.12, 0.024, -0.030,
    -0.12, 0.018, 0.040,
    -0.12, -0.020, 0.036,
    // Mid-right ring (slightly twisted & narrower)
    0.13, -0.018, -0.032,
    0.13, 0.022, -0.020,
    0.13, 0.016, 0.034,
    0.13, -0.016, 0.026,
    // Jagged tip +X
    0.29, -0.004, 0.014,
  ]);
  const indices = new Uint16Array([
    // Tip -X cap
    0, 2, 1, 0, 3, 2, 0, 4, 3, 0, 1, 4,
    // Shaft quads
    1, 2, 6, 1, 6, 5,
    2, 3, 7, 2, 7, 6,
    3, 4, 8, 3, 8, 7,
    4, 1, 5, 4, 5, 8,
    // Tip +X cap
    9, 5, 6, 9, 6, 7, 9, 7, 8, 9, 8, 5,
  ]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setIndex(new THREE.BufferAttribute(indices, 1));
  g.computeVertexNormals();
  return g;
}

function buildMetalShardGeometry(): THREE.BufferGeometry {
  // Curled jagged sheet-metal fragment (~0.36m x 0.22m with bend along X)
  const positions = new Float32Array([
    // Front curled sheet
    -0.18, -0.09, 0.045,
    0.0, -0.11, -0.01,
    0.17, -0.06, 0.05,
    0.19, 0.08, 0.06,
    -0.02, 0.12, -0.008,
    -0.16, 0.07, 0.04,
    // Back face (-0.022 thickness)
    -0.18, -0.09, 0.023,
    0.0, -0.11, -0.032,
    0.17, -0.06, 0.028,
    0.19, 0.08, 0.038,
    -0.02, 0.12, -0.030,
    -0.16, 0.07, 0.018,
  ]);
  const indices = new Uint16Array([
    // Front
    0, 1, 4, 0, 4, 5, 1, 2, 3, 1, 3, 4,
    // Back
    6, 10, 7, 6, 11, 10, 7, 9, 8, 7, 10, 9,
    // Perimeter
    0, 6, 7, 0, 7, 1,
    1, 7, 8, 1, 8, 2,
    2, 8, 9, 2, 9, 3,
    3, 9, 10, 3, 10, 4,
    4, 10, 11, 4, 11, 5,
    5, 11, 6, 5, 6, 0,
  ]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setIndex(new THREE.BufferAttribute(indices, 1));
  g.computeVertexNormals();
  return g;
}

function buildMasonryChunkGeometry(): THREE.BufferGeometry {
  const g = new THREE.OctahedronGeometry(0.14, 0);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const sx = 0.78 + 0.44 * Math.abs(Math.sin(i * 4.3 + 1.1));
    const sy = 0.72 + 0.42 * Math.abs(Math.cos(i * 3.1 + 0.7));
    const sz = 0.8 + 0.4 * Math.abs(Math.sin(i * 5.7 + 2.3));
    pos.setXYZ(i, pos.getX(i) * sx, pos.getY(i) * sy, pos.getZ(i) * sz);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * Pooled ring buffer of up to `MAX_SPLINTERS` (90) 3D flying splinters/shards rendered in at most
 * 3 InstancedMesh draw calls using 3 shared MeshStandardMaterials (zero per-hit material leaks).
 */
export class SplinterPool {
  readonly root = new THREE.Group();
  private readonly slots: SplinterSlot[] = [];
  private cursor = 0;
  private _activeCount = 0;
  private _totalSpawned = 0;
  private _woodSpawned = 0;
  private _metalSpawned = 0;
  private _concreteSpawned = 0;

  private readonly woodGeo: THREE.BufferGeometry;
  private readonly metalGeo: THREE.BufferGeometry;
  private readonly concreteGeo: THREE.BufferGeometry;
  private readonly woodMat: THREE.MeshStandardMaterial;
  private readonly metalMat: THREE.MeshStandardMaterial;
  private readonly concreteMat: THREE.MeshStandardMaterial;
  private readonly woodMesh: THREE.InstancedMesh;
  private readonly metalMesh: THREE.InstancedMesh;
  private readonly concreteMesh: THREE.InstancedMesh;

  constructor(private readonly cap = MAX_SPLINTERS) {
    this.root.name = 'destruction-splinters';
    this.woodGeo = buildWoodSplinterGeometry();
    this.metalGeo = buildMetalShardGeometry();
    this.concreteGeo = buildMasonryChunkGeometry();

    this.woodMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.88,
      metalness: 0.04,
    });
    this.metalMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.42,
      metalness: 0.74,
    });
    this.concreteMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.92,
      metalness: 0.02,
    });

    const makeInst = (geo: THREE.BufferGeometry, mat: THREE.MeshStandardMaterial, name: string) => {
      const m = new THREE.InstancedMesh(geo, mat, this.cap);
      m.name = name;
      m.frustumCulled = false;
      m.castShadow = false;
      m.receiveShadow = true;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.count = 0;
      m.visible = false;
      // Initialize instanceColor buffer once so Three.js binds color attribute cleanly
      _c.setHex(0xffffff);
      for (let i = 0; i < this.cap; i++) m.setColorAt(i, _c);
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      return m;
    };

    this.woodMesh = makeInst(this.woodGeo, this.woodMat, 'wood-splinters');
    this.metalMesh = makeInst(this.metalGeo, this.metalMat, 'metal-shards');
    this.concreteMesh = makeInst(this.concreteGeo, this.concreteMat, 'masonry-chunks');
    this.root.add(this.woodMesh, this.metalMesh, this.concreteMesh);

    for (let i = 0; i < this.cap; i++) {
      this.slots.push({
        active: false,
        kind: 'wood',
        px: 0,
        py: 0,
        pz: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        rx: 0,
        ry: 0,
        rz: 0,
        ax: 0,
        ay: 0,
        az: 0,
        sx: 1,
        sy: 1,
        sz: 1,
        age: 0,
        maxAge: 2,
        colorHex: 0x9c7448,
      });
    }
  }

  get activeCount(): number {
    return this._activeCount;
  }

  get totalSpawned(): number {
    return this._totalSpawned;
  }

  get woodSpawned(): number {
    return this._woodSpawned;
  }

  get metalSpawned(): number {
    return this._metalSpawned;
  }

  get concreteSpawned(): number {
    return this._concreteSpawned;
  }

  /** Spawns a burst of 3D flying splinters/shards into the fixed-size ring buffer. */
  spawnBurst(
    pos: THREE.Vector3,
    dir: THREE.Vector3,
    kind: SplinterKind,
    count: number,
    colorHex: number,
    speed = 7.5,
  ): void {
    const dirLen = dir.length();
    const bx = dirLen > 1e-4 ? dir.x / dirLen : 0;
    const by = dirLen > 1e-4 ? dir.y / dirLen : 0.6;
    const bz = dirLen > 1e-4 ? dir.z / dirLen : 0;

    for (let i = 0; i < count; i++) {
      const slot = this.slots[this.cursor]!;
      this.cursor = (this.cursor + 1) % this.cap;
      if (!slot.active) this._activeCount++;

      slot.active = true;
      slot.kind = kind;
      slot.px = pos.x + (Math.random() - 0.5) * 0.45;
      slot.py = pos.y + (Math.random() - 0.5) * 0.45;
      slot.pz = pos.z + (Math.random() - 0.5) * 0.45;

      const sp = speed * (0.55 + Math.random() * 0.85);
      slot.vx = (bx + (Math.random() - 0.5) * 1.45) * sp;
      slot.vy = Math.max(1.2, (by + 0.35 + Math.random() * 0.9) * sp);
      slot.vz = (bz + (Math.random() - 0.5) * 1.45) * sp;

      slot.rx = Math.random() * Math.PI * 2;
      slot.ry = Math.random() * Math.PI * 2;
      slot.rz = Math.random() * Math.PI * 2;
      const spin = kind === 'wood' ? 14 : kind === 'metal' ? 12 : 9;
      slot.ax = (Math.random() - 0.5) * spin;
      slot.ay = (Math.random() - 0.5) * spin;
      slot.az = (Math.random() - 0.5) * spin;

      if (kind === 'wood') {
        // Elongated narrow jagged wood splinters
        slot.sx = 0.8 + Math.random() * 1.25;
        slot.sy = 0.65 + Math.random() * 0.65;
        slot.sz = 0.65 + Math.random() * 0.65;
        this._woodSpawned++;
      } else if (kind === 'metal') {
        slot.sx = 0.7 + Math.random() * 0.9;
        slot.sy = 0.7 + Math.random() * 0.9;
        slot.sz = 0.8 + Math.random() * 0.5;
        this._metalSpawned++;
      } else {
        const u = 0.65 + Math.random() * 0.85;
        slot.sx = u;
        slot.sy = u * (0.75 + Math.random() * 0.45);
        slot.sz = u;
        this._concreteSpawned++;
      }

      slot.age = 0;
      slot.maxAge = 1.6 + Math.random() * 1.2;
      slot.colorHex = colorHex;
      this._totalSpawned++;
    }

    this.syncInstances();
  }

  update(dt: number): void {
    if (this._activeCount === 0 || dt <= 0) return;

    const gravity = -19;
    let remaining = 0;

    for (let i = 0; i < this.cap; i++) {
      const s = this.slots[i]!;
      if (!s.active) continue;
      s.age += dt;
      if (s.age >= s.maxAge) {
        s.active = false;
        continue;
      }

      s.vy += gravity * dt;
      s.px += s.vx * dt;
      s.py += s.vy * dt;
      s.pz += s.vz * dt;

      if (s.py < 0.05) {
        s.py = 0.05;
        if (s.vy < -0.8) {
          s.vy = -s.vy * 0.28;
          s.vx *= 0.6;
          s.vz *= 0.6;
          s.ax *= 0.45;
          s.ay *= 0.45;
          s.az *= 0.45;
        } else {
          s.vy = 0;
          s.vx *= 0.82;
          s.vz *= 0.82;
          s.ax *= 0.7;
          s.ay *= 0.7;
          s.az *= 0.7;
        }
      }

      s.rx += s.ax * dt;
      s.ry += s.ay * dt;
      s.rz += s.az * dt;
      remaining++;
    }

    this._activeCount = remaining;
    this.syncInstances();
  }

  private syncInstances(): void {
    let wCount = 0;
    let mCount = 0;
    let cCount = 0;

    for (let i = 0; i < this.cap; i++) {
      const s = this.slots[i]!;
      if (!s.active) continue;

      const fade = s.age > s.maxAge - 0.35 ? clamp((s.maxAge - s.age) / 0.35, 0.01, 1) : 1;
      _v.set(s.px, s.py, s.pz);
      _e.set(s.rx, s.ry, s.rz);
      _q.setFromEuler(_e);
      _s.set(s.sx * fade, s.sy * fade, s.sz * fade);
      _m.compose(_v, _q, _s);
      _c.setHex(s.colorHex);

      if (s.kind === 'wood') {
        this.woodMesh.setMatrixAt(wCount, _m);
        this.woodMesh.setColorAt(wCount, _c);
        wCount++;
      } else if (s.kind === 'metal') {
        this.metalMesh.setMatrixAt(mCount, _m);
        this.metalMesh.setColorAt(mCount, _c);
        mCount++;
      } else {
        this.concreteMesh.setMatrixAt(cCount, _m);
        this.concreteMesh.setColorAt(cCount, _c);
        cCount++;
      }
    }

    this.woodMesh.count = wCount;
    this.woodMesh.visible = wCount > 0;
    if (wCount > 0) {
      this.woodMesh.instanceMatrix.needsUpdate = true;
      if (this.woodMesh.instanceColor) this.woodMesh.instanceColor.needsUpdate = true;
    }

    this.metalMesh.count = mCount;
    this.metalMesh.visible = mCount > 0;
    if (mCount > 0) {
      this.metalMesh.instanceMatrix.needsUpdate = true;
      if (this.metalMesh.instanceColor) this.metalMesh.instanceColor.needsUpdate = true;
    }

    this.concreteMesh.count = cCount;
    this.concreteMesh.visible = cCount > 0;
    if (cCount > 0) {
      this.concreteMesh.instanceMatrix.needsUpdate = true;
      if (this.concreteMesh.instanceColor) this.concreteMesh.instanceColor.needsUpdate = true;
    }
  }

  clear(): void {
    for (let i = 0; i < this.cap; i++) {
      this.slots[i]!.active = false;
    }
    this._activeCount = 0;
    this.cursor = 0;
    this.woodMesh.count = 0;
    this.woodMesh.visible = false;
    this.metalMesh.count = 0;
    this.metalMesh.visible = false;
    this.concreteMesh.count = 0;
    this.concreteMesh.visible = false;
  }

  dispose(): void {
    this.clear();
    this.woodGeo.dispose();
    this.metalGeo.dispose();
    this.concreteGeo.dispose();
    this.woodMat.dispose();
    this.metalMat.dispose();
    this.concreteMat.dispose();
  }
}
