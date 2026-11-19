/**
 * The decal sheet's layout and the choice of shape. The sheet is one texture pair, drawn at load by
 * `materials/decalAtlas.glsl.ts`: 48 small cells (8 across, 6 down, 256 px) over 20 big ones (4 across, 5 down, 512 px).
 * Small cells hold what is drawn small (a drop, a bullet hole); big cells hold whole compositions drawn at one to
 * three metres (a burst, a fan, a wall sheet), which stand in for dozens of small stains.
 *
 * Blood cells are not pictures. Each holds the stain's outline as a distance to its edge, its thickness and a haze of
 * mist round it, and the decal shader draws the liquid from those: a crisp edge at any size, a raised wet lip, thin
 * blood that lets the floor show, thick blood that stays wet longest. So "which cell" is only "which shape": this file
 * picks it from how the drop arrived.
 */
import type { DecalKind } from '../core/contracts';

export const SHEET = {
  /** Pixels at full quality. */
  width: 2048,
  height: 4096,
  smallCols: 8,
  smallRows: 6,
  bigCols: 4,
  bigRows: 5,
} as const;

export const SMALL_CELLS = SHEET.smallCols * SHEET.smallRows;
export const CELL_COUNT = SMALL_CELLS + SHEET.bigCols * SHEET.bigRows;

/** First cell of each group. The order is the atlas shader's (`surface_decals`). */
export const CELL = {
  bulletConcrete: 0,
  bulletMetal: 2,
  bulletGlass: 4,
  exit: 6,
  /** Round drops that fell or hit square on: clean, scalloped, crowned with spines, a gout of several. */
  drop: 8,
  /** Drops that came in at an angle, travelling along +X: a short oval, a tadpole, a long streak, a cluster of streaks. */
  oval: 12,
  mist: 16,
  /** A line of evenly spaced drops off a swung blade or a thrown limb, along +X. */
  cast: 18,
  /** An arterial arc: a wave of big stains along +X. */
  arc: 20,
  /** Drops under a wounded man walking along +X. */
  trail: 22,
  wipe: 24,
  pool: 27,
  print: 30,
  slash: 32,
  crack: 34,
  soot: 36,
  /** A tile of fine detail the decal shader repeats at real size: dried cracks, blotches, mist specks. */
  detail: 47,
  burst: 48,
  fan: 51,
  soak: 54,
  sheet: 57,
  drag: 60,
  ring: 62,
  scorch: 65,
} as const;

/**
 * How the decal shader treats a cell. `Mark`: a picture, albedo and coverage as stored. `Blood`: liquid. `Run`: a run
 * down a wall, drawn in the shader. `Grow`: blood that spreads to its outline over a few seconds (a pool).
 */
export const Flag = { Mark: 0, Blood: 1, Run: 2, Grow: 3 } as const;
export type Flag = (typeof Flag)[keyof typeof Flag];

/**
 * What the shader needs to know about a blood cell's field. `gain`: how many units of stored field one cell half-width
 * of distance is (the atlas shader's `bloodOut` gain), which sets how wide the wet lip is in the field's own units.
 * `half`: the half width of the stain's body in the cell (-1..1 across), so a caller's "size" can mean the stain and
 * not the quad. `aspect`: length over width of a shape drawn along +X.
 */
export interface CellShape {
  gain: number;
  half: number;
  aspect: number;
}

const DROP: CellShape = { gain: 10, half: 0.55, aspect: 1 };
const SHAPES: Partial<Record<number, CellShape>> = {
  [CELL.drop]: { gain: 10, half: 0.6, aspect: 1 },
  [CELL.drop + 1]: { gain: 10, half: 0.55, aspect: 1 },
  [CELL.drop + 2]: { gain: 10, half: 0.42, aspect: 1 },
  [CELL.drop + 3]: { gain: 10, half: 0.55, aspect: 1 },
  [CELL.oval]: { gain: 10, half: 0.36, aspect: 1.5 },
  [CELL.oval + 1]: { gain: 10, half: 0.2, aspect: 3.4 },
  [CELL.oval + 2]: { gain: 10, half: 0.11, aspect: 7 },
  [CELL.oval + 3]: { gain: 10, half: 0.5, aspect: 1.8 },
  [CELL.pool]: { gain: 1.5, half: 0.7, aspect: 1 },
  [CELL.pool + 1]: { gain: 1.5, half: 0.7, aspect: 1 },
  [CELL.pool + 2]: { gain: 1.5, half: 0.7, aspect: 1 },
};

export function shapeOf(cell: number): CellShape {
  return SHAPES[cell] ?? DROP;
}

/** Metres from a wet stain's edge to where its surface has levelled off: the raised lip that catches the light. */
const LIP = 0.0035;

/**
 * The lip's width in the stored field's units for a stain of `cell` drawn `size` metres across (the quad's shorter
 * edge). The field runs `gain` units a cell half-width, and a quad of `size` is 2.16 of the cell's units across.
 */
export function lipOf(cell: number, size: number): number {
  const lip = (LIP * shapeOf(cell).gain * 2.16) / Math.max(size, 0.01);
  return Math.min(Math.max(lip, 0.035), 0.5);
}

/** First cell and variant count per kind, for `decals.add`. */
export const KIND_CELLS: Record<DecalKind, readonly [number, number]> = {
  bullet: [CELL.bulletConcrete, 2],
  bulletMetal: [CELL.bulletMetal, 2],
  bulletGlass: [CELL.bulletGlass, 2],
  exit: [CELL.exit, 2],
  scorch: [CELL.scorch, 3],
  soot: [CELL.soot, 2],
  blood: [CELL.drop, 4],
  bloodPool: [CELL.pool, 3],
  bloodSmear: [CELL.wipe, 3],
  slash: [CELL.slash, 2],
  crack: [CELL.crack, 2],
};

export function flagOf(kind: DecalKind): Flag {
  return kind === 'bloodPool' ? Flag.Grow : kind === 'blood' || kind === 'bloodSmear' ? Flag.Blood : Flag.Mark;
}

/** True for every cell the shader draws as liquid. */
export function isBloodCell(cell: number): boolean {
  return (cell >= CELL.drop && cell < CELL.slash) || (cell >= CELL.burst && cell < CELL.scorch);
}

/**
 * How a cell may be laid mirrored, so one drawing gives up to four stains: bit 1 across X, bit 2 across Y. A shape
 * drawn along +X only mirrors across it; a wall sheet's runs must stay pointing down; a footprint is left or right by
 * the caller's word.
 */
export function flipsOf(cell: number): number {
  if (cell === CELL.print || cell === CELL.print + 1 || cell === CELL.detail) return 0;
  if (cell >= CELL.sheet && cell < CELL.drag) return 1;
  const along =
    (cell >= CELL.oval && cell < CELL.mist) || cell === CELL.mist + 1 || (cell >= CELL.cast && cell < CELL.pool) ||
    (cell >= CELL.slash && cell < CELL.crack) || (cell >= CELL.fan && cell < CELL.soak) || (cell >= CELL.drag && cell < CELL.ring);
  return along ? 2 : 3;
}

/**
 * How thin a boot print is drawn (the `thin` of a decal) for a sole that has lost `fade` of its blood, 0..1. A print's
 * lugs are narrow, so a small step in the threshold drops a row of them: the first print is whole, the twelfth a few
 * broken bars.
 */
export function printThin(fade: number): number {
  return 0.3 + 0.52 * Math.min(Math.max(fade, 0), 1);
}

/** What made a stain, for the choice of its shape. */
export type SplatHow = 'drop' | 'mist' | 'cast' | 'arc' | 'trail';

export interface Splat {
  cell: number;
  /** Quad edge across the travel, and along it, in metres. */
  wide: number;
  long: number;
  /** How far along its travel the quad's middle sits from where the drop landed, as a share of `long`: a fan starts there. */
  lead: number;
}

const _splat: Splat = { cell: 0, wide: 0, long: 0, lead: 0 };

/** A stain this big (quad edge, m) is no longer a drop: it is a splash, and gets a whole composition of its own. */
export const SPLASH_FROM = 0.34;

/** Length over width of the most glancing stain. Past this a drop has skimmed off, not landed. */
export const MAX_STRETCH = 4.5;

/**
 * The shape a drop leaves. `size` is the edge of the quad a round stain of this much blood would get, `speed` how fast
 * it arrived (m/s) and `into` the part of that straight into the surface, `dice` a 0..1 random number. A drop that
 * lands square is round: clean if it only fell, scalloped and then crowned with spines as it hits harder. A stain's
 * width over its length is the sine of the angle it came in at, so a glancing drop is a long oval with its tail
 * pointing the way it was going; the cell nearest that shape is taken and the quad makes up the rest. Returns a shared
 * object.
 */
export function chooseSplat(size: number, speed: number, into: number, dice: number, how: SplatHow = 'drop'): Splat {
  const s = _splat;
  s.lead = 0;
  if (how === 'mist') {
    const stretch = speed > 0.01 ? Math.min(speed / Math.max(into, 1e-3), 2.2) : 1;
    s.cell = CELL.mist + (stretch > 1.35 ? 1 : 0);
    s.wide = size;
    s.long = size * (stretch > 1.35 ? Math.max(stretch / 1.5, 1) : 1);
    return s;
  }
  if (how === 'cast' || how === 'arc' || how === 'trail') {
    s.cell = (how === 'cast' ? CELL.cast : how === 'arc' ? CELL.arc : CELL.trail) + (dice < 0.5 ? 0 : 1);
    s.wide = size;
    s.long = size;
    return s;
  }
  const stretch = speed < 0.01 ? 1 : Math.min(speed / Math.max(into, 1e-3), MAX_STRETCH);
  const third = Math.min(Math.floor(dice * 3), 2);
  if (size >= SPLASH_FROM) {
    // A splash. Square on: a burst, fingers and satellites all round. At an angle: a fan thrown on from where it hit.
    if (stretch < 1.3) {
      s.cell = CELL.burst + third;
      s.wide = s.long = size * 1.2;
      return s;
    }
    s.cell = CELL.fan + third;
    s.wide = size * 1.1;
    s.long = s.wide * Math.min(Math.max(stretch / 1.5, 1), 2.2);
    s.lead = 0.4;
    return s;
  }
  // Faster drops spread further.
  const spread = 1 + Math.min(speed * 0.025, 0.5);
  if (stretch < 1.15) {
    // Square on. A drop that only fell is clean; the harder it lands the more its edge breaks up; a big one is a gout.
    const hard = Math.min(speed / 9, 1) + (dice - 0.5) * 0.5 + Math.min(size * 1.5, 0.3);
    const pick = size > 0.2 && dice > 0.6 ? 3 : hard < 0.4 ? 0 : hard < 0.8 ? 1 : 2;
    s.cell = CELL.drop + pick;
    // A drop that kept together fills its cell; one that broke up is mostly what it threw. Same blood, so the whole one is drawn smaller.
    s.wide = s.long = size * spread * (pick < 2 ? 0.62 : 1);
    return s;
  }
  let pick = stretch < 2.1 ? 0 : stretch < 4 ? 1 : 2;
  // Now and then a spray lands as a cluster of streaks.
  if (pick > 0 && dice > 0.8 && size > 0.12) pick = 3;
  const shape = shapeOf(CELL.oval + pick);
  s.cell = CELL.oval + pick;
  // The stain's body keeps the width a round one would have; the cell's own proportions do most of the stretch.
  const body = size * spread * 0.5;
  s.wide = body / (shape.half / 1.08);
  s.long = s.wide * Math.max(stretch / shape.aspect, 0.75);
  if (pick === 3) {
    s.wide = size * spread * 1.3;
    s.long = s.wide * Math.max(stretch / 2.4, 1);
  }
  return s;
}

/** The big compositions. */
export type BigKind = 'burst' | 'fan' | 'soak' | 'sheet' | 'drag' | 'ring';

export const BIG_CELLS: Record<BigKind, readonly [number, number]> = {
  burst: [CELL.burst, 3],
  fan: [CELL.fan, 3],
  soak: [CELL.soak, 3],
  sheet: [CELL.sheet, 3],
  drag: [CELL.drag, 2],
  ring: [CELL.ring, 3],
};

/** A drag is drawn to be laid this many times as long as it is wide. */
export const DRAG_ASPECT = 2.5;

/** How far along its own length a big decal's middle sits from the point it is laid at: a fan and a drag start there. */
export const BIG_ROOT: Record<BigKind, number> = { burst: 0, fan: 0.4, soak: 0, sheet: 0, drag: 0.36, ring: 0 };

/** The atlas rectangle of a cell: x, y, width, height in uv. The decal vertex shader does the same sum. */
export function cellRect(cell: number, out: [number, number, number, number]): [number, number, number, number] {
  if (cell < SMALL_CELLS) {
    out[0] = (cell % SHEET.smallCols) / SHEET.smallCols;
    out[1] = Math.floor(cell / SHEET.smallCols) / (SHEET.smallRows + SHEET.bigRows * 2);
    out[2] = 1 / SHEET.smallCols;
    out[3] = 1 / (SHEET.smallRows + SHEET.bigRows * 2);
  } else {
    const b = cell - SMALL_CELLS;
    out[0] = (b % SHEET.bigCols) / SHEET.bigCols;
    out[1] = (SHEET.smallRows + Math.floor(b / SHEET.bigCols) * 2) / (SHEET.smallRows + SHEET.bigRows * 2);
    out[2] = 1 / SHEET.bigCols;
    out[3] = 2 / (SHEET.smallRows + SHEET.bigRows * 2);
  }
  return out;
}
