/**
 * Walls, gates and shacks that blasts wear down in stages and repairs put back: piece 4 of docs/proposals/outpost-defense.md.
 *
 * Every piece is a few boxes per stage. The same boxes make its mesh and its colliders, so what you see is what stops you,
 * and a stage change swaps one group of meshes and one set of colliders for the next. Nothing here is in the static map:
 * pieces go up after the nav sample (`attach`), so the floor under them is on the graph and a breach only has to unblock it
 * (NavGraph.setBlocked). Pillars between segments never fall and stay blocked.
 */
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Ctx, Structure, StructureStage, SurfaceKind } from '../core/contracts';
import type { EnemyInstance } from '../core/gameplay';
import { mulberry32 } from '../core/math';
import { Debris, type DebrisMat } from './debris';
import { Geo, type Mat } from './kit/geo';
import type { NavGraph } from './nav';

export const WALL = {
  height: 3, thick: 0.5, pillar: 0.8, segment: 4,
  /** Deck height for a catwalk behind a wall: a standing eye (1.62 m) then clears the top by about 0.3 m. */
  catwalk: 1.7,
} as const;
export const GATE = { height: 2.9, thick: 0.2 } as const;
export const SHACK = { width: 3.2, depth: 2.6, height: 2.3 } as const;

/** Health of each stage that has one, by kind. The last stage, breached, has none. */
export const HEALTH = { wall: [300, 300], gate: [400], shack: [120] } as const;
/** Small arms never wear a wall or a gate. On a shack they count at this share, and a blast counts double. */
export const SHACK_BULLET = 0.25;
export const SHACK_BLAST = 1.5;
/** A tank shell is made for walls: its blast counts this many times over on one. */
export const SOURCE_MULT: Readonly<Record<string, number>> = { tank_cannon: 4 };
/** Share of a blast still felt by a piece at the edge of its radius. */
export const EDGE = 0.4;
export const REPAIR_SECONDS = 4;
/** Low enough to walk over: the player steps 0.45 m, enemies 0.75 m. */
const RUBBLE = 0.22;

export type StructureKind = Structure['kind'];

/**
 * How a wall is built when it is not the plain WALL. The fort's are 5.65 m with a battlement: a body up to `sill`, then a merlon either
 * side of one crenel (a gap to fire through) in each segment, each merlon with a loophole slit. `port` is the body alone, a low wall for a
 * mounted gun to fire over. Pillars rise with the wall.
 */
export interface WallStyle {
  height: number;
  thick: number;
  pillar: number;
  top: 'crenels' | 'port';
  /** The crenel's floor, and the whole height of a port. */
  sill: number;
  /** Width of the crenel in each segment, and of the loophole in each merlon; the slit's foot and head over the sill. */
  crenel: number;
  slit: { w: number; y0: number; y1: number };
}

/** What a map places. Centre of the base, yaw as the kit's (local +X along the length), length end to end. */
export interface StructureSpec {
  kind: StructureKind;
  x: number;
  y: number;
  z: number;
  yaw: number;
  length: number;
  look?: 'planks' | 'sheet';
  /** A gate on a lift: it rises for the player or an ally near it and drops behind them once the gap is clear. */
  opens?: boolean;
  /** A wall (or the pillars beside a gate) built to this instead of WALL. */
  style?: WallStyle;
}

/** A lift gate rises for a friend within this many metres of its middle, and drops when none is within `GATE_SHUT`. */
export const GATE_OPEN = 4.5;
export const GATE_SHUT = 6;
/**
 * Pieces are drawn in squares, one mesh per material each, so a fort of two hundred is a few dozen draw calls. The squares are the
 * static map's (Geo cuts concrete and steel 5 across from -180), so no square's meshes are cut again.
 */
const CHUNK = 72;
const CHUNK_MIN = -180;

/** A box in the piece's frame: x along, y up from its base, z across. Tilted parts are only for show. */
interface Part {
  x: number; y: number; z: number;
  hx: number; hy: number; hz: number;
  mat: Mat;
  solid?: boolean;
  /** Collider only. */
  hidden?: boolean;
  bevel?: number;
  tint?: number;
  yaw?: number; pitch?: number; roll?: number;
}

const STAGES: Record<StructureKind, readonly StructureStage[]> = {
  wall: ['intact', 'damaged', 'breached'], gate: ['intact', 'breached'], shack: ['intact', 'breached'],
};
const SURFACE: Record<StructureKind, SurfaceKind> = { wall: 'concrete', gate: 'metal', shack: 'dirt' };
const CHIPS: Record<StructureKind, number> = { wall: 0x8c877d, gate: 0x4a4d52, shack: 0x8a6a45 };

const box = (x: number, y: number, z: number, hx: number, hy: number, hz: number, mat: Mat, more: Partial<Part> = {}): Part =>
  ({ x, y, z, hx, hy, hz, mat, ...more });
/** A box from its x and y extents, the full thickness of the wall. */
const slab = (x0: number, x1: number, y0: number, y1: number, t: number, mat: Mat = 'concrete'): Part =>
  box((x0 + x1) / 2, (y0 + y1) / 2, 0, (x1 - x0) / 2, (y1 - y0) / 2, t, mat, { solid: true, bevel: 0.03 });

/** Broken lumps lying about, for show. */
function chunks(rng: () => number, n: number, halfX: number, halfZ: number, mat: Mat, size = 0.22, z0 = 0): Part[] {
  const out: Part[] = [];
  for (let i = 0; i < n; i++) {
    const s = size * (0.6 + rng() * 0.9);
    out.push(box((rng() * 2 - 1) * halfX, s * 0.6, z0 + (rng() * 2 - 1) * halfZ, s, s * 0.7, s * (0.6 + rng() * 0.5), mat, {
      yaw: rng() * 3, pitch: (rng() - 0.5) * 0.9, roll: (rng() - 0.5) * 0.9, tint: 0.75 + rng() * 0.3, bevel: 0.04,
    }));
  }
  return out;
}

/** A fort wall: the body, and the battlement on it; damaged, holed and bitten; breached, a gap between stubs. */
function styledWallStages(length: number, rng: () => number, st: WallStyle): Part[][] {
  const P = length - st.pillar, h = P / 2, t = st.thick / 2, H = st.height, S = st.sill;
  const capT = 0.1;
  const intact: Part[] = [slab(-h, h, 0, S - capT, t)];
  // A sill stone under the crenel, a stone on each merlon: tinted, so a standing wall is still one material.
  intact.push(box(0, S - capT / 2, 0, h, capT / 2, t + 0.03, 'concrete', { tint: 0.62, solid: true }));
  if (st.top === 'crenels') {
    const c = st.crenel / 2, sw = st.slit.w / 2, s0 = S + st.slit.y0, s1 = S + st.slit.y1;
    for (const side of [-1, 1]) {
      const a = side < 0 ? -h : c, b = side < 0 ? -c : h, m = (a + b) / 2;
      intact.push(
        slab(a, b, S, s0, t), slab(a, m - sw, s0, s1, t), slab(m + sw, b, s0, s1, t), slab(a, b, s1, H - capT, t),
        box(m, H - capT / 2, 0, (b - a) / 2 + 0.02, capT / 2, t + 0.03, 'concrete', { tint: 0.62, solid: true }),
        // The slit's dark throat, so it reads as a hole from the field.
        box(m, (s0 + s1) / 2, 0, sw + 0.01, (s1 - s0) / 2 + 0.01, t - 0.04, 'concreteDark', { tint: 0.3 }),
      );
    }
  }
  // A hole knocked through low, a merlon gone, the body bitten, and what came off it at the foot. Still no way through.
  const a0 = -P * 0.32, a1 = a0 + 0.6, b0 = P * 0.1, b1 = b0 + 0.5, low = Math.min(2.4, S - 1.4);
  const damaged: Part[] = [
    slab(-h, h, 0, 1, t), slab(-h, a0, 1, low, t), slab(a1, b0, 1, low, t), slab(b1, h, 1, low, t),
    slab(-h, 0.2, low, S - 0.3, t), slab(0.2, h, low, S - 0.9, t),
    box(-h / 2 + 0.1, S - 0.36, 0, h / 2 + 0.1, 0.07, t + 0.03, 'concreteDark'),
    ...[0.15, 0.3, 0.45].map((dx, i) => box(0.2 + dx, S - 0.6, (i - 1) * 0.14, 0.014, 0.28, 0.014, 'steelDark', { roll: 0.3 * (i - 1) })),
    ...chunks(rng, 6, h * 0.9, 0.4, 'concrete', 0.24, -t - 0.4),
    ...chunks(rng, 5, h * 0.9, 0.35, 'concrete', 0.2, t + 0.35),
  ];
  if (st.top === 'crenels') damaged.push(slab(-h, -st.crenel / 2, S - 0.3, H - 0.2, t));
  const stub = 0.35;
  const breached: Part[] = [
    box(0, RUBBLE / 2, 0, h, RUBBLE / 2, t + 0.45, 'concreteDark', { solid: true, bevel: 0.08 }),
    slab(-h, -h + stub, 0, S * 0.55, t), slab(h - stub, h, 0, S * 0.32, t),
    ...[0, 1, 2].map(i => box(-h + stub + 0.04, S * 0.5 + i * 0.15, (i - 1) * 0.15, 0.014, 0.22, 0.014, 'steelDark', { pitch: -0.5 - i * 0.2 })),
    ...chunks(rng, 14, h * 0.95, t + 0.4, 'concrete', 0.3),
    ...chunks(rng, 6, h * 0.8, 0.7, 'concreteDark', 0.18, -t - 0.7),
  ];
  return [intact, damaged, breached];
}

function wallStages(length: number, rng: () => number, style?: WallStyle): Part[][] {
  if (style) return styledWallStages(length, rng, style);
  const P = length - WALL.pillar, h = P / 2, t = WALL.thick / 2, H = WALL.height;
  // The cap is concrete in shadow, not concreteDark: a standing wall then costs one draw call per chunk, not two.
  const intact = [slab(-h, h, 0, H, t), box(0, H - 0.05, 0, h, 0.05, t + 0.04, 'concrete', { tint: 0.62 })];
  // Two loopholes through the middle band, a bite out of the top, and what fell out of them at the foot.
  const a0 = -P * 0.3, a1 = a0 + 0.55, b0 = P * 0.12, b1 = b0 + 0.45, bite = P * 0.08;
  const damaged = [
    slab(-h, h, 0, 1, t), slab(-h, a0, 1, 2, t), slab(a1, b0, 1, 2, t), slab(b1, h, 1, 2, t),
    slab(-h, bite, 2, H - 0.25, t), slab(bite, h, 2, 2.45, t),
    box(-h / 2 + bite / 2, H - 0.32, 0, (h + bite) / 2 - 0.05, 0.07, t + 0.03, 'concreteDark'),
    ...[0.15, 0.3, 0.45].map((dx, i) => box(bite + dx, 2.62, (i - 1) * 0.12, 0.012, 0.2, 0.012, 'steelDark', { roll: 0.3 * (i - 1) })),
    ...chunks(rng, 5, h * 0.9, 0.35, 'concrete', 0.2, -t - 0.35),
    ...chunks(rng, 4, h * 0.9, 0.3, 'concrete', 0.18, t + 0.3),
  ];
  // A gap with jagged stubs at each end and rubble low enough to walk over.
  const stub = 0.35;
  const breached = [
    box(0, RUBBLE / 2, 0, h, RUBBLE / 2, t + 0.35, 'concreteDark', { solid: true, bevel: 0.08 }),
    slab(-h, -h + stub, 0, 1.7, t), slab(h - stub, h, 0, 1.15, t),
    ...[0, 1, 2].map(i => box(-h + stub + 0.04, 1.5 + i * 0.15, (i - 1) * 0.13, 0.012, 0.18, 0.012, 'steelDark', { pitch: -0.5 - i * 0.2 })),
    ...chunks(rng, 14, h * 0.95, t + 0.3, 'concrete', 0.26),
    ...chunks(rng, 6, h * 0.8, 0.6, 'concreteDark', 0.16, -t - 0.6),
  ];
  return [intact, damaged, breached];
}

/** How far a lift gate's leaf rises: its foot then clears a tall man. */
const LIFT = 3.4;

/** The leaf, shut, `lift` metres up. Up, it stops nobody. */
function leaf(h: number, lift: number): Part[] {
  const t = GATE.thick / 2, H = GATE.height;
  return [
    box(0, lift + H / 2, 0, h, H / 2, t, 'steelDark', { solid: lift === 0, bevel: 0.02 }),
    box(0, lift + 0.4, 0, h - 0.02, 0.16, t + 0.012, 'hazard'),
    ...[-0.66, -0.33, 0, 0.33, 0.66].map(f => box(f * h, lift + H / 2 + 0.2, 0, 0.05, H / 2 - 0.45, t + 0.03, 'steel')),
    box(0, lift + H - 0.12, 0, h - 0.02, 0.06, t + 0.03, 'steel'),
  ];
}

/** Shut, blown, and for a lift gate open as well. A lift gate carries its guides and the head beam on top of the pillars. */
function gateStages(length: number, opens: boolean, style?: WallStyle): { stages: Part[][]; open: Part[] } {
  const P = length - (style?.pillar ?? WALL.pillar), h = P / 2, t = GATE.thick / 2, top = LIFT + GATE.height + 0.2;
  const wallTop = style?.height ?? WALL.height;
  const frame = opens ? [
    ...[-1, 1].map(s => box(s * (length / 2), (wallTop + 0.3 + top) / 2, 0, 0.16, (top - wallTop - 0.3) / 2, 0.22, 'steelDark')),
    box(0, top + 0.18, 0, length / 2 + 0.2, 0.18, 0.26, 'steelDark'),
    box(0, top + 0.18, 0, length / 2 - 0.4, 0.07, 0.27, 'hazard'),
  ] : [];
  // Torn off its hinges and thrown flat, with the hinge plates left on the pillars.
  const blown = [
    box(0.2, 0.25, -1.3, h * 0.95, 0.08, 1.2, 'steelDark', { pitch: 0.06, roll: 0.18, yaw: 0.12 }),
    box(0.2, 0.36, -1.3, h * 0.9, 0.03, 0.12, 'hazard', { pitch: 0.06, roll: 0.18, yaw: 0.12 }),
    ...[0.6, 2.2].map(y => box(-h + 0.05, y, 0, 0.06, 0.12, t + 0.02, 'steel')),
    ...[0.6, 2.2].map(y => box(h - 0.05, y, 0, 0.06, 0.12, t + 0.02, 'steel')),
    ...frame,
  ];
  return { stages: [[...leaf(h, 0), ...frame], blown], open: [...leaf(h, LIFT), ...frame] };
}

function shackStages(look: 'planks' | 'sheet', rng: () => number): Part[][] {
  const { width: W, depth: D, height: H } = SHACK;
  const w = W / 2, d = D / 2;
  const wallMat: Mat = look === 'planks' ? 'plywood' : 'rust';
  const board = look === 'planks' ? 0.24 : 0.16;
  const standing: Part[] = [box(0, H / 2, 0, w, H / 2, d, wallMat, { solid: true, hidden: true })];
  // Boards on every face, each its own shade, the sheet kind ribbed in and out.
  const face = (along: number, fixed: number, onX: boolean) => {
    const n = Math.round((along * 2) / board);
    for (let i = 0; i < n; i++) {
      const u = -along + (i + 0.5) * (along * 2 / n);
      const out = look === 'sheet' && i % 2 ? 0.025 : 0;
      const tint = 0.78 + rng() * 0.3;
      const f = fixed + Math.sign(fixed) * out;
      standing.push(onX
        ? box(f, H / 2, u, 0.02, H / 2, along / n - 0.006, wallMat, { tint })
        : box(u, H / 2, f, along / n - 0.006, H / 2, 0.02, wallMat, { tint }));
    }
  };
  face(w, d - 0.02, false);
  face(w, -d + 0.02, false);
  face(d, w - 0.02, true);
  face(d, -w + 0.02, true);
  standing.push(
    box(0, H + 0.05, 0, w + 0.2, 0.03, d + 0.25, 'rust', { roll: 0.08, tint: 0.9 }),
    box(0.7, 0.95, d + 0.01, 0.42, 0.95, 0.02, 'steelDark'),
    ...[-1, 1].flatMap(sx => [-1, 1].map(sz => box(sx * (w - 0.06), H / 2, sz * (d - 0.06), 0.07, H / 2, 0.07, 'steelDark'))),
  );
  // Flat: the floor's splinters and one corner post still up. The walls and the roof fly off as debris (debris.ts).
  const flat: Part[] = [
    box(0, 0.11, 0, w, 0.11, d, wallMat, { solid: true, hidden: true }),
    box(0, 0.03, 0, w - 0.1, 0.03, d - 0.1, wallMat, { tint: 0.45 }),
    box(-w + 0.06, 0.45, -d + 0.06, 0.07, 0.45, 0.07, 'steelDark', { pitch: 0.2 }),
  ];
  for (let i = 0; i < 6; i++) {
    const l = 0.6 + rng() * 1.2;
    flat.push(box((rng() * 2 - 1) * w, 0.08 + rng() * 0.12, (rng() * 2 - 1) * (d + 0.5), l / 2, 0.02, board / 2, wallMat, {
      yaw: rng() * 3.1, pitch: (rng() - 0.5) * 0.3, roll: (rng() - 0.5) * 0.4, tint: 0.7 + rng() * 0.3,
    }));
  }
  return [standing, flat];
}

function pillarParts(style?: WallStyle): Part[] {
  const H = (style?.height ?? WALL.height) + 0.25, p = (style?.pillar ?? WALL.pillar) / 2;
  return [box(0, H / 2, 0, p, H / 2, p, 'concrete', { solid: true, bevel: 0.05 }), box(0, H + 0.06, 0, p + 0.05, 0.06, p + 0.05, 'concrete', { tint: 0.62 })];
}

const UP = new THREE.Vector3(0, 1, 0);
const _c = new THREE.Vector3();
const _h = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _v = new THREE.Vector3();
const _e = new THREE.Euler();
const _pq = new THREE.Quaternion();
const _half = new THREE.Vector3();

type Listener = (stage: StructureStage, from: StructureStage) => void;

/** One square of the map's pieces and pillars, drawn as one mesh per material and redrawn when any of them changes. */
interface Chunk {
  readonly pieces: Piece[];
  readonly pillars: StructureSpec[];
  group: THREE.Group | null;
}

/** One wall segment, gate or shack. The manager does the work; this is its state and the API a shop calls. */
class Piece implements Structure {
  readonly stages: readonly StructureStage[];
  index = 0;
  health: number;
  repairing = -1;
  repairSeconds = REPAIR_SECONDS;
  repairTick = 0;
  colliders: RAPIER.Collider[] = [];
  /** A lift gate that is up. Only ever true at the first stage. */
  open = false;
  /** Whether its nav block is on: standing and shut. */
  blocking = false;
  chunk: Chunk | null = null;
  readonly listeners = new Set<Listener>();
  readonly ux: number;
  readonly uz: number;
  /** Half the length that falls and half the depth, for blasts, nav and repairs. */
  readonly halfLength: number;
  readonly halfDepth: number;
  readonly height: number;
  /** Health against the plain 4 m segment's: a wall's scales with its length, so a breach costs the same whatever its height. */
  readonly scale: number;

  constructor(readonly id: number, readonly kind: StructureKind, readonly spec: StructureSpec, readonly parts: Part[][], readonly openParts: Part[] | null) {
    this.stages = STAGES[kind];
    this.scale = kind === 'wall' ? spec.length / WALL.segment : 1;
    this.health = HEALTH[kind][0] * this.scale;
    this.ux = Math.cos(spec.yaw);
    this.uz = -Math.sin(spec.yaw);
    const shack = kind === 'shack';
    const st = spec.style;
    this.halfLength = shack ? SHACK.width / 2 : (spec.length - (st?.pillar ?? WALL.pillar)) / 2;
    this.halfDepth = shack ? SHACK.depth / 2 : (kind === 'gate' ? GATE.thick : st?.thick ?? WALL.thick) / 2;
    this.height = shack ? SHACK.height : kind === 'gate' ? GATE.height : st?.height ?? WALL.height;
  }

  get stage(): StructureStage {
    return this.stages[this.index]!;
  }

  /** What stands now: the stage's parts, or the raised leaf of an open gate. */
  get current(): readonly Part[] {
    return this.open && this.openParts ? this.openParts : this.parts[this.index]!;
  }

  get maxHealth(): number {
    return ((HEALTH[this.kind] as readonly number[])[this.index] ?? 0) * this.scale;
  }

  repair(seconds = REPAIR_SECONDS): boolean {
    if (this.repairing >= 0 || (this.index === 0 && this.health >= this.maxHealth)) return false;
    this.repairing = 0;
    this.repairSeconds = Math.max(0.01, seconds);
    this.repairTick = 0;
    return true;
  }

  onStageChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Writes a point of the piece's frame (x along, y up, z across) in world space. */
  toWorld(x: number, y: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    const s = this.spec;
    return out.set(s.x + x * this.ux - z * this.uz, s.y + y, s.z + x * this.uz + z * this.ux);
  }
}

export class Structures {
  readonly root = new THREE.Group();
  readonly all: Piece[] = [];
  private readonly byCollider = new Map<number, Piece>();
  private readonly pillars = new Map<string, StructureSpec>();
  private readonly chunks = new Map<string, Chunk>();
  private readonly dirty = new Set<Chunk>();
  private readonly gates: Piece[] = [];
  private nav: NavGraph | null = null;
  private attached = false;
  private readonly near: EnemyInstance[] = [];
  /** What flies when a shack or a wall falls. */
  readonly debris: Debris;
  /** The blast being dealt out now, if any: debris flies away from it. */
  private blastAt: THREE.Vector3 | null = null;
  private blastPower = 0;

  constructor(private readonly ctx: Ctx, private readonly specs: readonly StructureSpec[], private readonly material: (m: Mat) => THREE.Material) {
    this.root.name = 'structures';
    this.debris = new Debris(ctx, material);
  }

  /** Puts every piece up. Call once, after the nav sample, so the floor under each one is on the graph. */
  attach(nav: NavGraph | null): void {
    if (this.attached) return;
    this.attached = true;
    this.nav = nav;
    for (const s of this.specs) this.build(s);
    this.redraw();
  }

  /** A piece placed after load, as the lab does. Before `attach` it waits for it. */
  place(spec: StructureSpec): Structure | null {
    if (!this.attached) {
      (this.specs as StructureSpec[]).push(spec);
      return null;
    }
    const piece = this.build(spec);
    this.redraw();
    return piece;
  }

  private chunkAt(x: number, z: number): Chunk {
    const key = `${Math.floor((x - CHUNK_MIN) / CHUNK)},${Math.floor((z - CHUNK_MIN) / CHUNK)}`;
    let c = this.chunks.get(key);
    if (!c) this.chunks.set(key, (c = { pieces: [], pillars: [], group: null }));
    this.dirty.add(c);
    return c;
  }

  private build(s: StructureSpec): Piece {
    const rng = mulberry32(0x5ca1 + this.all.length * 977);
    const gate = s.kind === 'gate' ? gateStages(s.length, s.opens === true, s.style) : null;
    const parts = s.kind === 'wall' ? wallStages(s.length, rng, s.style) : gate ? gate.stages : shackStages(s.look ?? 'planks', rng);
    const piece = new Piece(this.all.length, s.kind, s, parts, s.opens && gate ? gate.open : null);
    this.all.push(piece);
    if (piece.openParts) this.gates.push(piece);
    piece.chunk = this.chunkAt(s.x, s.z);
    piece.chunk.pieces.push(piece);
    if (s.kind !== 'shack') {
      for (const end of [-1, 1]) {
        piece.toWorld((end * s.length) / 2, 0, 0, _p);
        const key = `${Math.round(_p.x * 10)},${Math.round(_p.y * 10)},${Math.round(_p.z * 10)}`;
        if (this.pillars.has(key)) continue;
        const pillar = { ...s, x: _p.x, z: _p.z };
        this.pillars.set(key, pillar);
        this.chunkAt(pillar.x, pillar.z).pillars.push(pillar);
        this.addColliders(pillarParts(s.style), pillar, null);
        // A body's width round the pillar, so the gap beside a breach starts where the stubs do.
        const ph = (s.style?.pillar ?? WALL.pillar) / 2 + 0.6;
        this.nav?.setBlocked(_p.x, _p.z, s.y, piece.ux, piece.uz, ph, ph, true);
      }
    }
    this.addColliders(parts[0]!, s, piece);
    this.block(piece, true);
    return piece;
  }

  /** Redraws every chunk something changed in since the last call. */
  private redraw(): void {
    for (const c of this.dirty) {
      const geo = new Geo();
      for (const p of c.pillars) this.draw(geo, pillarParts(p.style), p);
      for (const q of c.pieces) this.draw(geo, q.current, q.spec);
      if (c.group) {
        this.root.remove(c.group);
        for (const m of c.group.children) (m as THREE.Mesh).geometry.dispose();
      }
      c.group = geo.finish(this.material);
      this.root.add(c.group);
    }
    this.dirty.clear();
  }

  private draw(geo: Geo, parts: readonly Part[], s: StructureSpec): void {
    geo.push(s.x, s.y, s.z, s.yaw);
    for (const p of parts) {
      if (p.hidden) continue;
      geo.use(p.mat).tint(p.tint ?? 1);
      const tilted = p.yaw !== undefined || p.pitch !== undefined || p.roll !== undefined;
      if (tilted) geo.push(p.x, p.y, p.z, p.yaw ?? 0, p.pitch ?? 0, p.roll ?? 0);
      const x = tilted ? 0 : p.x, y = tilted ? 0 : p.y, z = tilted ? 0 : p.z;
      if (p.bevel) geo.bevel(x, y, z, p.hx, p.hy, p.hz, p.bevel);
      else geo.box(x, y, z, p.hx, p.hy, p.hz);
      if (tilted) geo.pop();
    }
    geo.pop();
  }

  private addColliders(parts: readonly Part[], s: StructureSpec, piece: Piece | null): void {
    const { physics } = this.ctx;
    _q.setFromAxisAngle(UP, s.yaw);
    const c = Math.cos(s.yaw), sn = Math.sin(s.yaw);
    for (const p of parts) {
      if (!p.solid) continue;
      _c.set(s.x + p.x * c + p.z * sn, s.y + p.y, s.z - p.x * sn + p.z * c);
      const collider = physics.addStaticBox(_c, _h.set(p.hx, p.hy, p.hz), _q, SURFACE[piece?.kind ?? 'wall']);
      if (!piece) continue;
      piece.colliders.push(collider);
      this.byCollider.set(collider.handle, piece);
    }
  }

  private block(piece: Piece, on: boolean): void {
    if (piece.blocking === on) return;
    piece.blocking = on;
    const s = piece.spec;
    const shack = piece.kind === 'shack';
    // Across: a cell either side of a thin wall, so no link can step over it, whichever way the wall runs.
    this.nav?.setBlocked(s.x, s.z, s.y, piece.ux, piece.uz, piece.halfLength + (shack ? 0.3 : 0), shack ? piece.halfDepth + 0.3 : Math.max(1, piece.halfDepth + 0.5), on);
  }

  /** The collider of a piece, if `collider` is one. */
  pieceOf(collider: RAPIER.Collider | null): Structure | null {
    return collider ? this.byCollider.get(collider.handle) ?? null : null;
  }

  /** A round or a blade on a collider. Only a shack feels it. */
  hit(collider: RAPIER.Collider | null, amount: number): void {
    const piece = collider ? this.byCollider.get(collider.handle) : undefined;
    if (piece?.kind === 'shack') this.damage(piece, amount * SHACK_BULLET);
  }

  /** A blast. Each piece takes `amount` by its distance to the nearest point of it, down to EDGE at `radius`. */
  blast(center: THREE.Vector3, radius: number, amount: number, source: string): void {
    this.blastAt = center;
    this.blastPower = amount * (SOURCE_MULT[source] ?? 1);
    try {
      for (const piece of this.all) {
        if (piece.index === piece.stages.length - 1) continue;
        const d = this.distance(piece, center);
        if (d > radius) continue;
        const scale = (1 - (d / radius) * (1 - EDGE)) * (SOURCE_MULT[source] ?? 1) * (piece.kind === 'shack' ? SHACK_BLAST : 1);
        this.damage(piece, amount * scale);
      }
    } finally {
      this.blastAt = null;
    }
  }

  /** Metres from `p` to the nearest point of the piece's standing box. */
  distance(piece: Structure, p: THREE.Vector3): number {
    const q = piece as Piece;
    const s = q.spec;
    const dx = p.x - s.x, dz = p.z - s.z;
    const along = dx * q.ux + dz * q.uz, across = dz * q.ux - dx * q.uz, up = p.y - s.y;
    const ex = Math.max(0, Math.abs(along) - q.halfLength);
    const ez = Math.max(0, Math.abs(across) - q.halfDepth);
    const ey = up < 0 ? -up : Math.max(0, up - q.height);
    return Math.hypot(ex, ey, ez);
  }

  /** Wears a piece by `amount`. What a stage cannot take carries into the next, so a big enough blast goes straight through. */
  damage(piece: Structure, amount: number): void {
    const q = piece as Piece;
    const last = q.stages.length - 1;
    if (amount <= 0 || q.index === last) return;
    q.repairing = -1;
    q.health -= amount;
    if (q.health > 0) return;
    let index = q.index;
    while (q.health <= 0 && index < last) {
      const carry = -q.health;
      index++;
      q.health = ((HEALTH[q.kind] as readonly number[])[index] ?? 0) * q.scale - carry;
    }
    if (index === last) q.health = 0;
    const health = q.health;
    this.setStage(q, index, true);
    q.health = health;
  }

  /** Puts a piece in a stage at once, with full health for it. `loud` plays the dust and the sound. */
  setStage(piece: Structure, index: number, loud = false): void {
    const q = piece as Piece;
    const from = q.index;
    if (index === from) {
      q.health = q.maxHealth;
      return;
    }
    const was = q.stage;
    q.index = index;
    q.health = q.maxHealth;
    if (index > 0) q.open = false;
    this.refit(q);
    if (loud) this.effects(q, index > from);
    for (const fn of q.listeners) fn(q.stage, was);
  }

  private effects(q: Piece, falling: boolean): void {
    const { fx, audio } = this.ctx;
    const mid = q.toWorld(0, q.height * (falling ? 0.5 : 0.3), 0, _p);
    _n.set(-q.uz, 0, q.ux);
    for (let i = -1; i <= 1; i++) {
      q.toWorld(i * q.halfLength * 0.7, falling ? 1.2 : 0.2, 0, _c);
      fx.dust(_c, _n, falling ? 2.4 : 1.2);
      if (falling) fx.chips(_c, CHIPS[q.kind], 16);
    }
    if (!falling) {
      audio.play('metal_clang', { position: mid, volume: 0.6, pitch: 0.8 });
      return;
    }
    fx.smoke(mid, 0x8a8478, q.kind === 'shack' ? 2.5 : 3.5, 2.5);
    if (q.kind === 'gate') {
      audio.play('metal_groan', { position: mid, volume: 0.9 });
      audio.play('metal_clang', { position: mid, pitch: 0.6 });
    } else {
      audio.play(q.kind === 'wall' ? 'concrete_crumble' : 'impact_metal', { position: mid, pitch: q.kind === 'shack' ? 0.7 : 1 });
      audio.play('explosion_debris', { position: mid, volume: 0.8 });
    }
    // Last: these use the same scratch vectors as `mid`.
    if (q.kind === 'shack' && q.index === q.stages.length - 1) this.throwShack(q);
    else if (q.kind === 'wall') this.throwLumps(q, q.index === q.stages.length - 1 ? 14 : 7);
  }

  /**
   * The shack comes apart: every board, sheet, post and the roof of its standing stage is thrown as a real body from where it stood.
   * Boards go in pairs and some break in two, so a shack is about forty pieces. A blast throws them away from it, harder the closer
   * and bigger it was; a shack shot to pieces just falls in.
   */
  private throwShack(q: Piece): void {
    const parts = q.parts[0]!;
    const centre = q.toWorld(0, SHACK.height / 2, 0, _c).clone();
    const at = this.blastAt;
    const power = at ? Math.min(1.4, 0.5 + this.blastPower / 200) : 0;
    // Two neighbouring boards of one face fly as one piece.
    const pieces: Part[] = [];
    let pair: Part | null = null;
    const board = (p: Part) => p.hy > 1 && Math.min(p.hx, p.hz) < 0.05 && p.mat !== 'steelDark';
    for (const p of parts) {
      if (p.hidden) continue;
      if (!board(p)) { pieces.push(p); continue; }
      const alongX = p.hx > p.hz;
      if (pair && (pair.hx > pair.hz) === alongX && Math.abs(alongX ? p.z - pair.z : p.x - pair.x) < 0.1) {
        pieces.push(alongX
          ? { ...p, x: (p.x + pair.x) / 2, hx: Math.abs(p.x - pair.x) / 2 + p.hx }
          : { ...p, z: (p.z + pair.z) / 2, hz: Math.abs(p.z - pair.z) / 2 + p.hz });
        pair = null;
      } else {
        if (pair) pieces.push(pair);
        pair = p;
      }
    }
    if (pair) pieces.push(pair);
    for (const p of pieces) {
      // Some boards break across, for shorter pieces.
      const split = board(p) && Math.random() < 0.55;
      const cut = split ? 0.35 + Math.random() * 0.3 : 1;
      for (const [y0, y1] of split ? [[0, cut], [cut, 1]] : [[0, 1]]) {
        const hy = p.hy * (y1! - y0!);
        _pq.setFromEuler(_e.set(p.pitch ?? 0, (p.yaw ?? 0) + q.spec.yaw, p.roll ?? 0, 'YXZ'));
        q.toWorld(p.x, p.y - p.hy + p.hy * 2 * y0! + hy, p.z, _p);
        _half.set(p.hx, hy, p.hz);
        this.fling(_p, centre, at, power, _v);
        this.debris.throw(p.mat as DebrisMat, _p, _pq, _half, _v, at ? 14 : 5, p.tint ?? 1);
      }
    }
  }

  /** Lumps knocked off a wall's faces, mostly away from the blast. */
  private throwLumps(q: Piece, n: number): void {
    const centre = q.toWorld(0, q.height / 2, 0, _c).clone();
    const at = this.blastAt;
    const power = at ? Math.min(1.2, 0.4 + this.blastPower / 300) : 0.3;
    for (let i = 0; i < n; i++) {
      const s = 0.12 + Math.random() * 0.22;
      q.toWorld((Math.random() * 2 - 1) * q.halfLength, 0.6 + Math.random() * (q.height - 1), (Math.random() * 2 - 1) * q.halfDepth, _p);
      _pq.setFromEuler(_e.set(Math.random() * 3, Math.random() * 3, Math.random() * 3));
      _half.set(s, s * (0.5 + Math.random() * 0.5), s * (0.6 + Math.random() * 0.6));
      this.fling(_p, centre, at, power, _v);
      this.debris.throw('concrete', _p, _pq, _half, _v, 12, 0.7 + Math.random() * 0.3);
    }
  }

  /** A piece's velocity: out from the blast (or the piece's own middle) and up, with some scatter. */
  private fling(p: THREE.Vector3, centre: THREE.Vector3, at: THREE.Vector3 | null, power: number, out: THREE.Vector3): THREE.Vector3 {
    if (at) {
      out.subVectors(p, at);
      const d = Math.max(0.6, out.length());
      out.multiplyScalar(1 / d);
      const speed = (4 + Math.random() * 5) * power * Math.min(1.4, 2.5 / d + 0.4);
      return out.multiplyScalar(speed).add(_n.set((Math.random() - 0.5) * 2.5, 2 + Math.random() * 3.5 * power, (Math.random() - 0.5) * 2.5));
    }
    out.subVectors(p, centre).setY(0);
    const d = Math.max(0.3, out.length());
    return out.multiplyScalar((0.8 + Math.random() * 1.6) / d).add(_n.set(0, 0.5 + Math.random() * 1.5, 0));
  }

  /** Colliders, nav and the drawing for what stands now. */
  private refit(q: Piece): void {
    for (const c of q.colliders) {
      this.byCollider.delete(c.handle);
      this.ctx.physics.world.removeCollider(c, false);
    }
    q.colliders.length = 0;
    this.addColliders(q.current, q.spec, q);
    this.block(q, q.index !== q.stages.length - 1 && !q.open);
    if (q.chunk) this.dirty.add(q.chunk);
  }

  /** Raises or drops a lift gate. False for anything else, a blown gate, or no change. Drop waits for nobody in the gap. */
  setOpen(piece: Structure, open: boolean): boolean {
    const q = piece as Piece;
    if (!q.openParts || q.index > 0 || q.open === open) return false;
    if (!open && this.occupied(q)) return false;
    q.open = open;
    this.refit(q);
    const mid = q.toWorld(0, GATE.height, 0, _p);
    this.ctx.audio.play('metal_clang', { position: mid, volume: 0.5, pitch: open ? 1.2 : 0.8 });
    return true;
  }

  isOpen(piece: Structure): boolean {
    return (piece as Piece).open;
  }

  /** Lift gates rise for the player or an ally near them, and drop once none is near. */
  private tendGates(): void {
    if (this.gates.length === 0) return;
    const player = this.ctx.player?.position instanceof THREE.Vector3 && this.ctx.player.alive ? this.ctx.player.position : null;
    const allies = (this.ctx as { allies?: { allies: readonly { state: string; body: { position: THREE.Vector3 } }[] } }).allies?.allies ?? [];
    for (const q of this.gates) {
      if (q.index > 0) continue;
      let near = Infinity;
      const at = (p: THREE.Vector3) => {
        if (Math.abs(p.y - q.spec.y) < 3) near = Math.min(near, Math.hypot(p.x - q.spec.x, p.z - q.spec.z));
      };
      if (player) at(player);
      for (const a of allies) if (a.state === 'up') at(a.body.position);
      if (!q.open && near < GATE_OPEN) this.setOpen(q, true);
      else if (q.open && near > GATE_SHUT) this.setOpen(q, false);
    }
  }

  /** True while the player or an enemy stands where the piece would be solid again. */
  occupied(piece: Structure): boolean {
    const q = piece as Piece;
    const pad = 0.5;
    const inside = (p: THREE.Vector3): boolean => {
      const dx = p.x - q.spec.x, dz = p.z - q.spec.z;
      return Math.abs(dx * q.ux + dz * q.uz) < q.halfLength + pad && Math.abs(dz * q.ux - dx * q.uz) < q.halfDepth + pad &&
        p.y > q.spec.y - 1 && p.y < q.spec.y + q.height;
    };
    const { player, enemies } = this.ctx;
    if (player?.position instanceof THREE.Vector3 && player.alive && inside(player.position)) return true;
    const n = enemies?.query?.(q.toWorld(0, 0, 0, _c), q.halfLength + 2, this.near) ?? 0;
    for (let i = 0; i < n; i++) if (this.near[i]!.alive && inside(this.near[i]!.position)) return true;
    return false;
  }

  /** Call once per frame: runs repairs, lifts gates and redraws what changed. */
  update(dt: number): void {
    this.tendGates();
    this.updateRepairs(dt);
    this.debris.update(dt);
    this.redraw();
  }

  private updateRepairs(dt: number): void {
    for (const q of this.all) {
      if (q.repairing < 0) continue;
      q.repairing = Math.min(1, q.repairing + dt / q.repairSeconds);
      q.repairTick -= dt;
      if (q.repairTick <= 0 && q.repairing < 1) {
        q.repairTick = 0.8;
        q.toWorld((Math.random() * 2 - 1) * q.halfLength, 0.3, 0, _p);
        this.ctx.fx.dust(_p, UP, 0.6);
        this.ctx.audio.play('impact_concrete', { position: _p, volume: 0.35, pitchJitter: 0.15 });
      }
      if (q.repairing < 1) continue;
      // Nobody gets walled in: the last moment waits until the gap is clear.
      if (q.index === q.stages.length - 1 && this.occupied(q)) continue;
      q.repairing = -1;
      if (q.index > 0) this.setStage(q, q.index - 1, true);
      else q.health = q.maxHealth;
    }
  }

  /** A new run: everything back up, whole. */
  reset(): void {
    for (const q of this.all) {
      q.repairing = -1;
      this.setStage(q, 0);
      if (q.open) this.setOpen(q, false);
      q.health = q.maxHealth;
    }
    this.debris.clear();
    this.redraw();
  }
}
