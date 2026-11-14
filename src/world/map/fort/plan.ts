/**
 * The fort of Outpost Defense on paper: piece 6 of docs/proposals/outpost-defense.md, drawn in docs/notes/fort.md. x runs east, z south,
 * y up, and the field is y 0. Three square rings round the origin, each authored as its north side and turned clockwise a quarter at a time.
 *
 * Behind every wall is a rampart: an earth-filled firing step whose top is the catwalk, at WALL.catwalk. A breach opens onto its face,
 * which a man can vault (nav links any ledge up to 1.9 m), so a breach is a way in and the catwalk is still one solid walk.
 *
 * Everything another system needs is plain data at the bottom of this file: shops, ally posts, spawns, lanes, mortar spots, landing zones.
 */
import type { AllyType } from '../../../allies/data';
import { WALL } from '../../structures';

export type Vec = readonly [number, number, number];
export type Rgb = readonly [number, number, number];
export type RingId = 'core' | 'middle' | 'outer';

/** A point authored on the north side, turned clockwise by `i` quarters: 1 is east, 2 south, 3 west. */
export function rot(i: number, x: number, z: number): [number, number] {
  switch (i & 3) {
    case 1: return [-z, x];
    case 2: return [-x, -z];
    case 3: return [z, -x];
    default: return [x, z];
  }
}

/** A camera's yaw (0 looks down -Z, north) authored on the north side, turned with it. */
export const turnYaw = (i: number, yaw = 0): number => yaw - (i * Math.PI) / 2;

/** Every floor a man stands on. Nothing else is floor: roofs, cover tops and sandbags are not. */
export const LEVEL = { ground: 0, deck: WALL.catwalk, gun: 2.3, tower: 4.7 } as const;

/** Half the ground. Nav and the minimap stop here. */
export const EDGE = 120;
/** The fence round the field, and the containment on it. */
export const FENCE = 114;
export const SKY = 40;

/** The rampart behind a wall, measured in from the wall's line. It starts inside the pillars' back face, so nothing gets between. */
export const RAMPART = { from: 0.27, to: 3.4 } as const;
/** A corner tower: a square of rampart raised to LEVEL.tower, this far in from both walls, with a roof this high over its top. */
export const BASTION = { reach: 4.4, roof: 2.5 } as const;
/** Runs: down from a rampart end beside a gate, up from the catwalk to a bastion, up from the yard to the catwalk. */
export const STAIR = { gate: 3, tower: 4.4, yard: 3, width: 2.4 } as const;
/** A gun's raised pad on the rampart: half its length, the ramp each end, and the tripod's foot in from the wall line. */
export const GUN_PAD = { half: 1.8, ramp: 1.6, back: 1.1 } as const;

interface GateAt { side: number; u: number; w: number }
interface Along { side: number; u: number }

export interface RingDef {
  id: RingId;
  name: string;
  /** Half the square, to the walls' centre line. */
  half: number;
  /** Paint for this ring's signs, bands and minimap. */
  paint: Rgb;
  /** Each gate: the side, its middle along the side (local x), pillar to pillar. */
  gates: readonly GateAt[];
  /** Corners with a bastion. Corner `i` is the west (left) end of side `i`, so 0 is north-west. */
  bastions: readonly number[];
  /** Gun pads on the rampart. */
  guns: readonly Along[];
  /** Stairs straight up from the yard to the catwalk, besides the ones at the gates. */
  stairs: readonly Along[];
}

const SIDES = [0, 1, 2, 3] as const;

export const RINGS: readonly RingDef[] = [
  {
    id: 'outer', name: 'OUTER RING', half: 52, paint: [0.86, 0.62, 0.16],
    gates: SIDES.map(side => ({ side, u: 0, w: 6 })), bastions: [0, 1, 2, 3],
    guns: SIDES.map(side => ({ side, u: 26 })), stairs: SIDES.map(side => ({ side, u: -26 })),
  },
  {
    id: 'middle', name: 'MIDDLE RING', half: 32, paint: [0.3, 0.62, 0.9],
    gates: [{ side: 0, u: 14, w: 4.8 }, { side: 2, u: 14, w: 4.8 }], bastions: [1, 3],
    guns: [{ side: 1, u: -14 }, { side: 3, u: -14 }], stairs: [{ side: 0, u: -14 }, { side: 1, u: 14 }, { side: 2, u: -14 }, { side: 3, u: 14 }],
  },
  {
    id: 'core', name: 'THE CORE', half: 14, paint: [0.86, 0.2, 0.18],
    gates: [{ side: 1, u: 0, w: 4 }, { side: 3, u: 0, w: 4 }], bastions: [], guns: [], stairs: [{ side: 0, u: 5 }, { side: 2, u: 5 }],
  },
];

export const ring = (id: RingId): RingDef => RINGS.find(r => r.id === id)!;

/** The ring a ground point is inside, by the walls' centre lines, or null out in the field. */
export function ringAt(x: number, z: number): RingId | null {
  const d = Math.max(Math.abs(x), Math.abs(z));
  for (let i = RINGS.length - 1; i >= 0; i--) if (d < RINGS[i]!.half) return RINGS[i]!.id;
  return null;
}

/** Where a side's rampart starts and ends (local x), leaving out the bastions at either end. */
export function rampartSpan(r: RingDef, side: number): [number, number] {
  const H = r.half;
  const left = r.bastions.includes(side) ? -H + BASTION.reach : -H + RAMPART.from;
  const right = r.bastions.includes((side + 1) & 3) ? H - BASTION.reach : H - RAMPART.to;
  return [left, right];
}

// ---- buildings ---------------------------------------------------------------------------------------------------

export interface BuildingDef {
  id: 'barracks' | 'armoury' | 'infirmary';
  ring: RingId;
  /** Footprint, outside faces. */
  x0: number; z0: number; x1: number; z1: number;
  /** Eaves. */
  h: number;
  /** The door: which face, its middle along x, and its width and head. */
  door: { face: 'n' | 's'; x: number; w: number; h: number };
  sign: 'BARRACKS' | 'ARMOURY' | 'INFIRMARY';
}

/** Each stands flush against a rampart or in a corner of one, so nothing behind it is a nook. */
export const BUILDINGS: readonly BuildingDef[] = [
  { id: 'barracks', ring: 'outer', x0: -36, z0: 41.4, x1: -20, z1: 48.6, h: 3.4, door: { face: 'n', x: -28, w: 2.4, h: 2.5 }, sign: 'BARRACKS' },
  { id: 'armoury', ring: 'middle', x0: -7, z0: -28.6, x1: 7, z1: -21.4, h: 3.6, door: { face: 's', x: 0, w: 3.2, h: 2.8 }, sign: 'ARMOURY' },
  { id: 'infirmary', ring: 'core', x0: -10.6, z0: -10.6, x1: -2, z1: -4.4, h: 3.3, door: { face: 's', x: -6.3, w: 2.4, h: 2.5 }, sign: 'INFIRMARY' },
];
/** The core's magazine: a sandbagged bunker beside the infirmary, sold from the same counter. */
export const MAGAZINE = { x0: 4.4, z0: 5, x1: 10.6, z1: 10.6, h: 2.2 } as const;

export interface FortShop {
  id: BuildingDef['id'];
  ring: RingId;
  name: string;
  /** Where the buyer stands, on the floor at the counter. */
  anchor: Vec;
  /** A camera's yaw from the anchor to the counter. */
  yaw: number;
  /** The doorway's middle, on the floor. */
  door: Vec;
  /** What the attackers aim at and the shop's health belongs to: the building's box. */
  target: { min: Vec; max: Vec };
}

const SHOP_NAMES: Record<BuildingDef['id'], string> = { barracks: 'BARRACKS', armoury: 'ARMOURY', infirmary: 'INFIRMARY AND MAGAZINE' };

/** One shop per ring. Losing the ring loses its shop. */
export const FORT_SHOPS: readonly FortShop[] = BUILDINGS.map(b => {
  const north = b.door.face === 'n';
  // The counter runs along the back wall; the buyer stands 1.3 m in front of it.
  const back = north ? b.z1 : b.z0;
  const anchorZ = back + (north ? -2.4 : 2.4);
  return {
    id: b.id, ring: b.ring, name: SHOP_NAMES[b.id],
    anchor: [b.door.x, 0, anchorZ], yaw: north ? Math.PI : 0,
    door: [b.door.x, 0, north ? b.z0 : b.z1],
    target: { min: [b.x0, 0, b.z0], max: [b.x1, b.h, b.z1] },
  };
});

/** Where a new hire gathers before he goes to his post: the yard outside the barracks door. */
export const FORT_RALLY: Vec = [-28, 0, 37];

// ---- ally posts --------------------------------------------------------------------------------------------------

export type PostType = AllyType | 'mortar';

export interface FortPost {
  id: string;
  type: PostType;
  ring: RingId;
  pos: Vec;
  /** A camera's yaw: which way he watches. */
  yaw: number;
  /** For a machine gunner on a gun: its index in `spec.emplacements` (and the order of `FORT_GUNS`). */
  gun?: number;
}

/** A mounted gun's tripod foot and facing, in the order the map places them. */
export interface FortGun { ring: RingId; pos: Vec; yaw: number; arc: number }

/** The catwalk's middle, in from the wall line: clear of the pillars and the band a wall blocks on the nav. */
const DECK_IN = 2;

function onSide(r: RingDef, side: number, u: number, inward: number, y: number): Vec {
  const [x, z] = rot(side, u, -r.half + inward);
  return [x, y, z];
}

export const FORT_GUNS: readonly FortGun[] = RINGS.flatMap(r => r.guns.map(g => ({
  ring: r.id, pos: onSide(r, g.side, g.u, GUN_PAD.back, LEVEL.gun), yaw: turnYaw(g.side), arc: 1.15,
})));

/** Free stretches of each ring's catwalk, as local x on a side, for the riflemen. */
const RIFLE_AT: Record<RingId, readonly Along[]> = {
  outer: SIDES.flatMap(side => [-34, -14, 14].map(u => ({ side, u }))),
  middle: [{ side: 0, u: -22 }, { side: 1, u: 4 }, { side: 2, u: -22 }, { side: 3, u: 4 }],
  core: [{ side: 0, u: -6 }, { side: 2, u: -6 }],
};

function buildPosts(): FortPost[] {
  const out: FortPost[] = [];
  const add = (type: PostType, ring: RingId, pos: Vec, yaw: number, gun?: number) =>
    out.push({ id: `${type}-${ring}-${out.filter(p => p.type === type && p.ring === ring).length + 1}`, type, ring, pos, yaw, ...(gun === undefined ? {} : { gun }) });
  for (const r of RINGS) {
    for (const a of RIFLE_AT[r.id]) add('rifleman', r.id, onSide(r, a.side, a.u, DECK_IN, LEVEL.deck), turnYaw(a.side));
    // Snipers on the bastions, looking out across the corner.
    for (const c of r.bastions) add('sniper', r.id, onSide(r, c, -r.half + 2, 2, LEVEL.tower), turnYaw(c, Math.PI / 4));
    // Rocketeers on the rampart just past the top of a gate's stairs.
    for (const g of r.gates) add('rocketeer', r.id, onSide(r, g.side, g.u + g.w / 2 + 0.4 + STAIR.gate + 1.4, DECK_IN, LEVEL.deck), turnYaw(g.side));
    // Machine gunners on rampart corners with no bastion.
    for (const c of SIDES) {
      if (r.id === 'core' || r.bastions.includes(c)) continue;
      add('gunner', r.id, onSide(r, c, -r.half + 1.8, 1.8, LEVEL.deck), turnYaw(c, Math.PI / 4));
    }
  }
  FORT_GUNS.forEach((g, i) => {
    // Behind the tripod, where the gun's seat is.
    const back = 0.95;
    add('gunner', g.ring, [g.pos[0] + Math.sin(g.yaw) * back, g.pos[1], g.pos[2] + Math.cos(g.yaw) * back], g.yaw, i);
  });
  for (const shop of FORT_SHOPS) {
    // A shotgunner three metres outside each shop's door, facing away from it.
    const out3 = shop.yaw === 0 ? 3 : -3;
    add('shotgunner', shop.ring, [shop.door[0] + 1.6, 0, shop.door[2] + out3], shop.yaw === 0 ? Math.PI : 0);
  }
  add('medic', 'core', [-1.5, 0, -2], -Math.PI / 2);
  for (const [x, z] of [[-21, -21], [21, 21], [21, -19], [-21, 21]] as const) add('mortar', 'middle', [x, 0, z], Math.atan2(x, z));
  return out;
}

/** Where each type holds, by ring. Mortar teams are the player's own (piece 8), not an ally type. */
export const FORT_POSTS: readonly FortPost[] = buildPosts();

/** Riot police wait here, one per stretch of yard, and go to the nearest breach in their ring. */
export const FORT_BREACH_POINTS: readonly { ring: RingId; pos: Vec }[] = [
  ...SIDES.map(side => ({ ring: 'outer' as const, pos: onSide(ring('outer'), side, -6, RAMPART.to + 5, 0) })),
  ...SIDES.map(side => {
    const [x, z] = rot(side, -10, -18);
    return { ring: 'middle' as const, pos: [x, 0, z] as Vec };
  }),
  { ring: 'core', pos: [1, 0, 1] },
];

// ---- the field ---------------------------------------------------------------------------------------------------

/** Roads and the lanes vehicles come in on: centre lines and widths. A lane is kept clear for a tank its whole width. */
export interface Lane { id: string; points: readonly (readonly [number, number])[]; width: number }

const turnLine = (i: number, pts: readonly (readonly [number, number])[]) => pts.map(([x, z]) => rot(i, x, z) as readonly [number, number]);
const NAMES = ['north', 'east', 'south', 'west'] as const;
const CORNERS = ['northwest', 'northeast', 'southeast', 'southwest'] as const;

/** The track round the outside of the walls, 12 m out. Vehicles circle on it; nothing stands on it. */
export const TRACK = 64;

export const FORT_ROADS: readonly Lane[] = [
  ...SIDES.map(i => ({ id: NAMES[i], points: turnLine(i, [[0, -FENCE + 2], [0, -ring('outer').half - 3]]), width: i & 1 ? 8 : 10 })),
  { id: 'track', points: [[-TRACK, -TRACK], [TRACK, -TRACK], [TRACK, TRACK], [-TRACK, TRACK], [-TRACK, -TRACK]], width: 8 },
];

/** Approach lanes for trucks and tanks: up each road to the track, and in from each corner. */
export const FORT_LANES: readonly Lane[] = [
  ...SIDES.map(i => ({ id: NAMES[i], points: turnLine(i, [[0, -FENCE + 4], [0, -TRACK]]), width: 14 })),
  ...SIDES.map(i => ({ id: CORNERS[i], points: turnLine(i, [[-100, -100], [-TRACK - 2, -TRACK - 2]]), width: 12 })),
];

export interface FortSpawn { pos: Vec; yaw: number }

/** Infantry come in from the fence. Authored on the north side, turned. */
const FOOT_AT = [[-62, -106], [-24, -108], [22, -107], [60, -104]] as const;

export const FORT_SPAWNS: {
  foot: readonly FortSpawn[];
  /** At the start of each lane, facing in. */
  vehicle: readonly (FortSpawn & { lane: string })[];
  /** Where flyers appear, 30 m up over the fence. */
  air: readonly Vec[];
} = {
  foot: SIDES.flatMap(i => FOOT_AT.map(([u, z]) => {
    const [x, zz] = rot(i, u, z);
    return { pos: [x, 0, zz] as Vec, yaw: Math.atan2(x, zz) };
  })),
  vehicle: FORT_LANES.map(l => {
    const [ax, az] = l.points[0]!, [bx, bz] = l.points[1]!;
    return { lane: l.id, pos: [ax, 0, az] as Vec, yaw: Math.atan2(-(bx - ax), -(bz - az)) };
  }),
  air: SIDES.flatMap(i => [[0, -104], [-70, -96]].map(([u, z]) => {
    const [x, zz] = rot(i, u!, z!);
    return [x, 30, zz] as Vec;
  })),
};

/** Authored on the north side and turned: a landing zone, and the two mortar spots, each behind its sandbags. */
export const LZ_AT = [-48, -92] as const;
export const MORTAR_AT = [[-30, -84], [34, -90]] as const;

/** Clear ground for helicopters to set down on. Kept clear of cover. */
export const FORT_LZ: readonly { pos: Vec; radius: number }[] = SIDES.map(i => {
  const [x, z] = rot(i, LZ_AT[0], LZ_AT[1]);
  return { pos: [x, 0, z] as Vec, radius: 9 };
});

/** Enemy mortar spots: behind a sandbag crescent, out of a rifle's easy reach of the walls. `yaw` faces the fort. */
export const FORT_MORTARS: readonly FortSpawn[] = SIDES.flatMap(i => MORTAR_AT.map(([u, z]) => {
  const [x, zz] = rot(i, u!, z!);
  return { pos: [x, 0, zz] as Vec, yaw: Math.atan2(x, zz) };
}));
