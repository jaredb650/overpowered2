/**
 * The Distraint Frame's loadout (owner, 2026-11-22): the Frame is built from parts, one per slot, as a contractor wears implants.
 *
 *   leftArm, rightArm   an arm weapon each, per side (LMB fires the left, RMB the right)
 *   shoulder            as many as the cockpit allows (`cockpit.shoulders`); today one, the six-tube pod
 *   legs                later: how it moves (springy legs jump high, heavy legs stomp harder, treads, a fast runner)
 *   cockpit             how many shoulder slots there are
 *   engine              later: how it travels (a jet engine hovers and flies, with a fast jet dash that drains quickly)
 *
 * Only parts that exist in the game are listed: the three arm weapons on either side, the pod, and the standard legs, cockpit
 * and engine. The default reproduces the Frame as it always was: the rotary on the left, the 40 mm on the right, the pod.
 *
 * The stats a part carries (`LegStats`, `EngineStats`, `CockpitStats`) are what movement and the slot count read through
 * `frameStats`. The standard parts are all 1, so nothing moves differently until a new part says otherwise.
 *
 * On the wire (co-op) a loadout is `kitIds`: one short list of numbers, each a place in `FRAME_PART_ORDER`, never a model.
 * That order is append-only: a new part goes on the end, or other players read the wrong part.
 *
 * Pure: no three.js, no DOM beyond localStorage. Tested in loadout.test.ts.
 */

export type FrameSlot = 'leftArm' | 'rightArm' | 'shoulder' | 'legs' | 'cockpit' | 'engine';
export type ArmSide = 'left' | 'right';
/** What an arm carries: the 20 mm rotary, the 40 mm autocannon, the 105 mm howitzer (weapons.ts). */
export type ArmKind = 'rotary' | 'cannon40' | 'howitzer105';

/** How the legs move it. Every number multiplies the standard Frame's (`FRAME` in data.ts). */
export interface LegStats {
  /** Walk speed. */
  walk: number;
  /** The jets' launch speed off the ground. */
  jump: number;
  /** The stomp's ring, damage and push. Not read yet: the first heavy legs will. */
  stomp: number;
  /** The gait, for the movement a later part brings. Only 'walker' exists. */
  gait: 'walker' | 'springer' | 'heavy' | 'treads' | 'runner';
}

/** How the engine drives it. */
export interface EngineStats {
  /** Base speed, on top of the legs'. */
  speed: number;
  /** 'jets' is the standard hop and hover. 'hover' and 'flight' are for the engines to come (a jump-jet frame, a helicopter, a jet). */
  drive: 'jets' | 'hover' | 'flight';
  /** The charge (Shift)'s speed. Not read yet. */
  dash: number;
}

export interface CockpitStats {
  /** Shoulder slots. The standard cockpit has one; an upgraded one later has two. */
  shoulders: number;
}

export interface FramePart {
  id: FramePartId;
  slot: FrameSlot;
  /** The name on the loadout screen. */
  name: string;
  /** What it does, plainly. */
  does: string;
  /** The catalogue's line, in the Office's voice. */
  lore: string;
  /** An arm weapon: which side it hangs on, and what it is. */
  side?: ArmSide;
  arm?: ArmKind;
  legs?: LegStats;
  engine?: EngineStats;
  cockpit?: CockpitStats;
}

export const FRAME_PART_ORDER = [
  'rotaryL', 'rotaryR', 'cannonL', 'cannonR', 'howitzerL', 'howitzerR', 'pod6', 'legsStandard', 'cockpitStandard', 'engineStandard',
] as const;
export type FramePartId = (typeof FRAME_PART_ORDER)[number];

const ROTARY = {
  name: '20 mm Rotary',
  does: 'Six barrels, 24 rounds a second after a quarter-second spin. Overheats after about 6.7 s of fire. Hold 1 for airburst rounds.',
  lore: 'The Office measures enthusiasm in rounds per second. This arm is very enthusiastic.',
};
const CANNON = {
  name: '40 mm Autocannon',
  does: 'Ten shells a magazine, 0.28 s apart, 3.8 s to reload. R cycles high explosive, armour piercing and flak.',
  lore: 'Three kinds of shell, for the three kinds of problem the Council recognises.',
};
const HOWITZER = {
  name: '105 mm Howitzer',
  does: 'One shell at a time: a 15 m blast and a 22 m shockwave. 3.1 s to load the next.',
  lore: 'Field artillery, bolted to a forearm. Approved on the understanding that nobody stands in front of it.',
};
const arm = (id: FramePartId, side: ArmSide, kind: ArmKind, copy: typeof ROTARY): FramePart =>
  ({ id, slot: side === 'left' ? 'leftArm' : 'rightArm', side, arm: kind, ...copy });

export const FRAME_PARTS: Readonly<Record<FramePartId, FramePart>> = {
  rotaryL: arm('rotaryL', 'left', 'rotary', ROTARY),
  rotaryR: arm('rotaryR', 'right', 'rotary', ROTARY),
  cannonL: arm('cannonL', 'left', 'cannon40', CANNON),
  cannonR: arm('cannonR', 'right', 'cannon40', CANNON),
  howitzerL: arm('howitzerL', 'left', 'howitzer105', HOWITZER),
  howitzerR: arm('howitzerR', 'right', 'howitzer105', HOWITZER),
  pod6: {
    id: 'pod6', slot: 'shoulder', name: 'Six-tube Missile Pod',
    does: 'Hold G to paint up to six targets, let go to fire all six. 8.5 s to reload.',
    lore: 'Six opinions, delivered at once. The Office considers this efficient.',
  },
  legsStandard: {
    id: 'legsStandard', slot: 'legs', name: 'Standard Legs',
    does: 'Reverse-jointed walker legs: 7 m/s ahead, the jets for a hop and a hover, the stomp from height.',
    lore: 'Two of them, which the Council considers the correct number.',
    legs: { walk: 1, jump: 1, stomp: 1, gait: 'walker' },
  },
  cockpitStandard: {
    id: 'cockpitStandard', slot: 'cockpit', name: 'Standard Cockpit',
    does: 'One seat, one canopy, one shoulder slot.',
    lore: 'Seats one. Comfort was considered and declined.',
    cockpit: { shoulders: 1 },
  },
  engineStandard: {
    id: 'engineStandard', slot: 'engine', name: 'Standard Engine',
    does: 'Walks, charges with Shift, lifts on the jets for about 2.3 s of fuel.',
    lore: 'It runs on the same thing you do: regulations.',
    engine: { speed: 1, drive: 'jets', dash: 1 },
  },
};

export interface FrameLoadout {
  leftArm: FramePartId;
  rightArm: FramePartId;
  /** One a shoulder slot, as many as the cockpit allows. */
  shoulders: FramePartId[];
  legs: FramePartId;
  cockpit: FramePartId;
  engine: FramePartId;
}

/** The Frame as it always was. */
export const DEFAULT_FRAME_LOADOUT: Readonly<FrameLoadout> = Object.freeze({
  leftArm: 'rotaryL', rightArm: 'cannonR', shoulders: Object.freeze(['pod6']) as unknown as FramePartId[],
  legs: 'legsStandard', cockpit: 'cockpitStandard', engine: 'engineStandard',
});

export const defaultLoadout = (): FrameLoadout => ({ ...DEFAULT_FRAME_LOADOUT, shoulders: [...DEFAULT_FRAME_LOADOUT.shoulders] });

/** The single slots, in the screen's order (the shoulders sit between the arms and the legs). */
export const SINGLE_SLOTS = ['leftArm', 'rightArm', 'legs', 'cockpit', 'engine'] as const;
export type SingleSlot = (typeof SINGLE_SLOTS)[number];

/** The most shoulder slots any cockpit has: the length the wire keeps for them. */
export const MAX_SHOULDERS = 2;

type Parts = Readonly<Partial<Record<string, FramePart>>>;

/** Every part for `slot`, in the catalogue's order. */
export const partsFor = (slot: FrameSlot, parts: Parts = FRAME_PARTS): FramePart[] =>
  Object.values(parts).filter((p): p is FramePart => !!p && p.slot === slot);

/** Shoulder slots this loadout's cockpit gives. */
export const shoulderSlots = (l: Pick<FrameLoadout, 'cockpit'>, parts: Parts = FRAME_PARTS): number =>
  Math.max(0, Math.min(MAX_SHOULDERS, parts[l.cockpit]?.cockpit?.shoulders ?? 1));

const fits = (id: unknown, slot: FrameSlot, parts: Parts): id is FramePartId =>
  typeof id === 'string' && parts[id]?.slot === slot;

/**
 * Anything (a saved loadout, a wire's ids decoded, a test's) made into a loadout that can be built: each slot keeps its part
 * only if that part exists and goes in that slot, else the default's; the shoulders are as many as the cockpit allows.
 */
export function normalizeLoadout(raw: unknown, parts: Parts = FRAME_PARTS): FrameLoadout {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof FrameLoadout, unknown>>;
  const d = DEFAULT_FRAME_LOADOUT;
  const pick = (slot: SingleSlot): FramePartId => (fits(r[slot], slot, parts) ? r[slot] : d[slot]);
  const out: FrameLoadout = {
    leftArm: pick('leftArm'), rightArm: pick('rightArm'), shoulders: [], legs: pick('legs'), cockpit: pick('cockpit'), engine: pick('engine'),
  };
  const given = Array.isArray(r.shoulders) ? r.shoulders : [];
  for (let i = 0; i < shoulderSlots(out, parts); i++) {
    const id = given[i];
    out.shoulders.push(fits(id, 'shoulder', parts) ? id : d.shoulders[0]!);
  }
  return out;
}

/** The arm weapon each side carries. */
export function armsOf(l: FrameLoadout, parts: Parts = FRAME_PARTS): { left: ArmKind; right: ArmKind } {
  return { left: parts[l.leftArm]?.arm ?? 'rotary', right: parts[l.rightArm]?.arm ?? 'cannon40' };
}

/** The arm part for `kind` on `side`. */
export function armPart(side: ArmSide, kind: ArmKind): FramePartId {
  const p = Object.values(FRAME_PARTS).find(x => x.side === side && x.arm === kind);
  return p!.id;
}

/** `l` with `id` in its slot (a shoulder part in shoulder slot `at`), and the shoulders fitted to a new cockpit. */
export function fitPart(l: FrameLoadout, id: FramePartId, at = 0, parts: Parts = FRAME_PARTS): FrameLoadout {
  const p = parts[id];
  if (!p) return normalizeLoadout(l, parts);
  const next: FrameLoadout = { ...l, shoulders: [...l.shoulders] };
  if (p.slot === 'shoulder') next.shoulders[Math.max(0, at)] = id;
  else next[p.slot] = id;
  return normalizeLoadout(next, parts);
}

/** True when the two loadouts build the same Frame. */
export const sameLoadout = (a: FrameLoadout, b: FrameLoadout): boolean =>
  SINGLE_SLOTS.every(s => a[s] === b[s]) && a.shoulders.length === b.shoulders.length && a.shoulders.every((s, i) => s === b.shoulders[i]);

/** What the parts add up to, for movement and the slots. With the standard parts every multiplier is exactly 1. */
export interface FrameStats {
  /** Walk speed: the legs' times the engine's. */
  walk: number;
  /** The jets' launch speed. */
  jump: number;
  /** The stomp. Not read yet. */
  stomp: number;
  /** The charge. Not read yet. */
  dash: number;
  gait: LegStats['gait'];
  drive: EngineStats['drive'];
  shoulders: number;
  /** The six-tube pod is in a shoulder slot: G paints and fires. */
  pod: boolean;
}

export function frameStats(l: FrameLoadout, parts: Parts = FRAME_PARTS): FrameStats {
  const legs = parts[l.legs]?.legs ?? FRAME_PARTS.legsStandard.legs!;
  const engine = parts[l.engine]?.engine ?? FRAME_PARTS.engineStandard.engine!;
  return {
    walk: legs.walk * engine.speed, jump: legs.jump, stomp: legs.stomp, dash: engine.dash, gait: legs.gait, drive: engine.drive,
    shoulders: shoulderSlots(l, parts), pod: l.shoulders.includes('pod6'),
  };
}

/** Numbers a loadout takes on the wire: the five single slots, then `MAX_SHOULDERS` shoulders (-1 for none). */
export const KIT_LENGTH = SINGLE_SLOTS.length + MAX_SHOULDERS;

/** A loadout as one short list of part numbers (places in `FRAME_PART_ORDER`), for the co-op wire. */
export function kitIds(l: FrameLoadout): number[] {
  const out = SINGLE_SLOTS.map(s => FRAME_PART_ORDER.indexOf(l[s]));
  for (let i = 0; i < MAX_SHOULDERS; i++) out.push(l.shoulders[i] ? FRAME_PART_ORDER.indexOf(l.shoulders[i]!) : -1);
  return out;
}

/** The loadout another player's numbers say, made safe: an unknown number is the default's part for that slot. */
export function kitFrom(ids: ArrayLike<number>): FrameLoadout {
  const at = (i: number): FramePartId | undefined => FRAME_PART_ORDER[Math.round(Number(ids[i]))];
  const raw: Record<string, unknown> = {};
  SINGLE_SLOTS.forEach((s, i) => { raw[s] = at(i); });
  raw.shoulders = Array.from({ length: MAX_SHOULDERS }, (_, i) => at(SINGLE_SLOTS.length + i));
  return normalizeLoadout(raw);
}

// ---- kept between runs --------------------------------------------------------------------------------------------

export const FRAME_LOADOUT_KEY = 'op2.frame.loadout.v1';

type Store = Pick<Storage, 'getItem' | 'setItem'>;
const store = (): Store | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

/** The loadout this browser chose last, or the default. Bad or missing storage is the default, never an error. */
export function loadFrameLoadout(s: Store | null = store()): FrameLoadout {
  try {
    const raw = s?.getItem(FRAME_LOADOUT_KEY);
    return normalizeLoadout(raw ? JSON.parse(raw) : null);
  } catch {
    return defaultLoadout();
  }
}

export function saveFrameLoadout(l: FrameLoadout, s: Store | null = store()): void {
  try {
    s?.setItem(FRAME_LOADOUT_KEY, JSON.stringify(normalizeLoadout(l)));
  } catch {
    // Storage off: this page keeps it until reload.
  }
}
