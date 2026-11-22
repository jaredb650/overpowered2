/**
 * The Distraint Frame's loadout (owner, 2026-11-22): the Frame is built from parts, one per slot, as a contractor wears implants.
 *
 *   leftArm, rightArm   an arm weapon each, per side (LMB fires the left, RMB the right; 1 / 2 cycles each arm's rounds)
 *   shoulder            as many as the cockpit allows (`cockpit.shoulders`, up to 3: G, V, B fire; 3, 4, 5 cycle rounds)
 *   legs                how it moves and fights on its feet (gait plug-in + leg stats)
 *   cockpit             how many shoulder slots there are, canopy armour, exposed seat, or wall-seeing sensors
 *   engine              how it travels (drive plug-in + speed, dash, fuel)
 *
 * The default reproduces the Frame as it always was: the rotary on the left, the 40 mm on the right, the six-tube pod,
 * standard legs, cockpit and engine. With standard parts every multiplier is 1 and every special flag is false / 0.
 *
 * On the wire (co-op) a loadout is `kitIds`: one short list of numbers, each a place in `FRAME_PART_ORDER`, never a model.
 * That order is append-only: a new part goes on the end, or other players read the wrong part.
 *
 * Pure: no three.js, no DOM beyond localStorage. Tested in loadout.test.ts.
 */

export type FrameSlot = 'leftArm' | 'rightArm' | 'shoulder' | 'legs' | 'cockpit' | 'engine';
export type ArmSide = 'left' | 'right';
/** What an arm carries (`src/frame/arms/`). */
export type ArmKind = 'rotary' | 'cannon40' | 'howitzer105' | 'vulcan30' | 'beam' | 'cluster' | 'shotgun';
/** What a shoulder mount carries (`src/frame/shoulders/`). */
export type ShoulderKind = 'pod6' | 'storm' | 'mirv' | 'wire' | 'mortar' | 'fpv' | 'pointdef' | 'flares';
/** Movement gait plug-in (`src/frame/move/gait/`). */
export type GaitKind = 'walker' | 'sprinter' | 'heavy' | 'treads' | 'spider';
/** Travel drive plug-in (`src/frame/move/drive/`). */
export type DriveKind = 'jets' | 'flight' | 'hover' | 'afterburner' | 'overcharge' | 'diesel';

/** How the legs move it. Every multiplier is relative to the standard Frame (`FRAME` in data.ts). */
export interface LegStats {
  /** Walk speed. */
  walk: number;
  /** The jets' launch speed off the ground. */
  jump: number;
  /** The stomp's ring radius multiplier. */
  stomp: number;
  /** The stomp's damage and push multiplier (defaults to `stomp` if omitted, or 1 for standard). */
  stompPower?: number;
  /** The gait plug-in (`src/frame/move/gait/`). */
  gait: GaitKind;
  /** Leg armour multiplier (defaults to 1). */
  legArmor?: number;
  /** Hull armour multiplier contributed by the legs (defaults to 1). */
  hullScale?: number;
  /** Lateral strafe speed multiplier (defaults to 1). */
  strafe?: number;
  /** Hull turn rate multiplier (defaults to 1). */
  turnRate?: number;
  /** Suppresses view recoil kick when firing heavy arms (Spider Legs). */
  noRecoil?: boolean;
  /** Suppresses movement aim sway (Treads). */
  noSway?: boolean;
  /** Immune to enemy knockback impulses (Pile-Driver Legs). */
  immuneKnockback?: boolean;
  /** Replaces landing stomp with a 360° 5 m leg sweep knockdown (Spider Legs). */
  legSweep?: boolean;
  /** Crushes enemies driven over on flat ground instead of stomping (Treads). */
  crushOnDrive?: boolean;
}

/** How the engine drives it. */
export interface EngineStats {
  /** Base walk speed multiplier, on top of the legs'. */
  speed: number;
  /** The drive plug-in (`src/frame/move/drive/`). */
  drive: DriveKind;
  /** The charge (Shift)'s speed multiplier. */
  dash: number;
  /** Jet/flight fuel capacity multiplier (defaults to 1). */
  fuelScale?: number;
  /** Damage multiplier taken by the hull while airborne (defaults to 1; Rotor Engine is 1.25). */
  airborneDamageMult?: number;
}

export interface CockpitStats {
  /** Shoulder slots (1 to 3). */
  shoulders: number;
  /** Canopy hit-point multiplier (defaults to 1; 0 means no canopy). */
  canopyScale?: number;
  /** Hull hit-point multiplier contributed by the cockpit (defaults to 1). */
  hullScale?: number;
  /** Open Frame: no canopy; hits on the seat area route directly to the pilot as on foot. */
  openSeat?: boolean;
  /** Sensor Cockpit: shows every enemy within this range in metres through walls (0 = off). */
  sensorRange?: number;
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
  /** A shoulder weapon: which plug-in runs it. */
  shoulder?: ShoulderKind;
  legs?: LegStats;
  engine?: EngineStats;
  cockpit?: CockpitStats;
}

/**
 * Append-only wire table. Index = id on the co-op wire (`kitIds`). Never insert, reorder or remove.
 */
export const FRAME_PART_ORDER = [
  'rotaryL', 'rotaryR', 'cannonL', 'cannonR', 'howitzerL', 'howitzerR', 'pod6', 'legsStandard', 'cockpitStandard', 'engineStandard',
  'vulcan30L', 'vulcan30R', 'beamL', 'beamR', 'clusterL', 'clusterR', 'shotgunL', 'shotgunR',
  'stormPod', 'mirv', 'wireBomb', 'mortarRack', 'fpvHive', 'pointDefence', 'flareRack',
  'legsSprinter', 'legsHeavy', 'legsTreads', 'legsSpider',
  'cockpitTwin', 'cockpitOpen', 'cockpitSensor',
  'engineJet', 'engineRotor', 'engineAfterburner', 'engineOvercharge', 'engineDiesel',
] as const;
export type FramePartId = (typeof FRAME_PART_ORDER)[number];

const ROTARY = {
  name: '20 mm Rotary',
  does: 'Six barrels, 24 rounds a second after a quarter-second spin. Overheats after about 6.7 s of fire. Tap 1 (left) or 2 (right) for airburst rounds.',
  lore: 'The Office measures enthusiasm in rounds per second. This arm is very enthusiastic.',
};
const CANNON = {
  name: '40 mm Autocannon',
  does: 'Ten shells a magazine, 0.28 s apart, 3.8 s to reload (R reloads early). Tap 1 (left) or 2 (right) to cycle high explosive, armour piercing and flak.',
  lore: 'Three kinds of shell, for the three kinds of problem the Council recognises.',
};
const HOWITZER = {
  name: '105 mm Howitzer',
  does: 'One shell at a time: a 15 m blast and a 22 m shockwave. 3.1 s to load the next.',
  lore: 'Field artillery, bolted to a forearm. Approved on the understanding that nobody stands in front of it.',
};
const VULCAN30 = {
  name: '30 mm Rotary Cannon',
  does: 'Three heavy barrels firing 14 explosive shells a second after a 0.35 s spin; overheats in ~5 s (2.5 s vent). Tap 1 (left) or 2 (right) to cycle HE, AP and flak.',
  lore: 'The compromise between the 20 mm and the 40 mm was to fire the 40 mm as fast as the 20 mm.',
};
const BEAM = {
  name: 'Red Beam',
  does: 'Hold 1.6 s to charge (walk slows to 60%), release for a 1.0 s, 1.4 m red beam out to 180 m through 3 walls. Vaporizes targets; 9 s cooldown.',
  lore: 'Listed under "surface preparation" in the ledger. Nothing left on the surface afterwards.',
};
const CLUSTER = {
  name: 'Bomblet Cannon',
  does: 'Single standoff shell (3.6 s reload): bursts 7 m short of the target and carpets a 14 m × 9 m patch with 28 rippling bomblets.',
  lore: 'For when the notice must be served to an entire courtyard at once.',
};
const SHOTGUN = {
  name: 'Mech Shotgun',
  does: 'Six-shell tube, 0.42 s semi-auto, 26 heavy pellets in a 5.5° spread with massive knockback. Shell-by-shell reload (0.45 s each, interrupted by firing).',
  lore: 'Scaled up until the recoil bracket needed its own chassis audit.',
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
  vulcan30L: arm('vulcan30L', 'left', 'vulcan30', VULCAN30),
  vulcan30R: arm('vulcan30R', 'right', 'vulcan30', VULCAN30),
  beamL: arm('beamL', 'left', 'beam', BEAM),
  beamR: arm('beamR', 'right', 'beam', BEAM),
  clusterL: arm('clusterL', 'left', 'cluster', CLUSTER),
  clusterR: arm('clusterR', 'right', 'cluster', CLUSTER),
  shotgunL: arm('shotgunL', 'left', 'shotgun', SHOTGUN),
  shotgunR: arm('shotgunR', 'right', 'shotgun', SHOTGUN),

  pod6: {
    id: 'pod6', slot: 'shoulder', shoulder: 'pod6', name: 'Six-tube Missile Pod',
    does: 'Hold shoulder key (G / V / B) to paint up to six targets, let go to fire all six. 8.5 s to reload.',
    lore: 'Six opinions, delivered at once. The Office considers this efficient.',
  },
  stormPod: {
    id: 'stormPod', slot: 'shoulder', shoulder: 'storm', name: 'Metal Storm Pod',
    does: 'Hold shoulder key (G / V / B) to lock, charge and paint up to 8 targets; release for a snapping burst of 120 rounds per target. 7.5 s reload.',
    lore: 'No moving parts in the barrels; all the movement happens to whoever was painted.',
  },
  mirv: {
    id: 'mirv', slot: 'shoulder', shoulder: 'mirv', name: 'MIRV Launcher',
    does: 'Hold shoulder key (G / V / B) to mark ground out to 200 m; release to climb 70 m, dive, and split into 8 homing warheads at 25 m. 11 s reload.',
    lore: 'One filing at launch, eight separate enforcement actions on arrival.',
  },
  wireBomb: {
    id: 'wireBomb', slot: 'shoulder', shoulder: 'wire', name: 'Guided Heavy Missile',
    does: 'Fires a slow 16 m/s heavy missile steered to your crosshair all the way in. 26 m kill radius, 70 m shockwave. 28 s reload.',
    lore: 'Steered by hand so there can be no dispute about where it was meant to go.',
  },
  mortarRack: {
    id: 'mortarRack', slot: 'shoulder', shoulder: 'mortar', name: 'Mortar Rack',
    does: 'Hold shoulder key (G / V / B) to place a high-arc landing circle (25–180 m); 6 rounds, 6.5 s reload. Tap 3 / 4 / 5 to cycle HE, White Phosphorus and Cluster.',
    lore: 'For accounts settled from behind a wall.',
  },
  fpvHive: {
    id: 'fpvHive', slot: 'shoulder', shoulder: 'fpv', name: 'FPV Drone Hive',
    does: 'Press shoulder key (G / V / B) to launch 4 autonomous kamikaze drones (hold to bias toward crosshair). 4 m blast each; rebuilds 1 drone every 4 s.',
    lore: 'Four small contractors who do not submit expense reports.',
  },
  pointDefence: {
    id: 'pointDefence', slot: 'shoulder', shoulder: 'pointdef', name: 'Point Defence',
    does: 'Always on: shoots down incoming rockets, grenades and shells within 15 m (6 charges, 3 s refill) and clips infantry within 6 m.',
    lore: 'Declines incoming correspondence before it reaches the desk.',
  },
  flareRack: {
    id: 'flareRack', slot: 'shoulder', shoulder: 'flares', name: 'Countermeasure Rack',
    does: 'Doubles Q smoke to 6 charges, halves refill to 7 s, widens the screen by 50%, and auto-pops flares against incoming missiles every 5 s.',
    lore: 'Standard obscurity, now issued in commercial quantities.',
  },

  legsStandard: {
    id: 'legsStandard', slot: 'legs', name: 'Standard Legs',
    does: 'Reverse-jointed walker legs: 7 m/s ahead, the jets for a hop and a hover, the stomp from height.',
    lore: 'Two of them, which the Council considers the correct number.',
    legs: { walk: 1, jump: 1, stomp: 1, stompPower: 1, gait: 'walker', legArmor: 1, hullScale: 1, strafe: 1, turnRate: 1 },
  },
  legsSprinter: {
    id: 'legsSprinter', slot: 'legs', name: 'Sprinter Legs',
    does: 'Light reverse-jointed legs: walk ×1.30, jet launch ×1.6, stomp ×0.6, leg armour ×0.7.',
    lore: 'Trimmed of every gram not required to outrun an audit.',
    legs: { walk: 1.3, jump: 1.6, stomp: 0.6, stompPower: 0.6, gait: 'sprinter', legArmor: 0.7 },
  },
  legsHeavy: {
    id: 'legsHeavy', slot: 'legs', name: 'Pile-Driver Legs',
    does: 'Heavy legs: walk ×0.75, jet launch ×0.5, stomp ring ×1.5 with ×2.2 damage and push, leg armour ×1.6, immune to knockback.',
    lore: 'Puts the weight of the Office firmly behind every step.',
    legs: { walk: 0.75, jump: 0.5, stomp: 1.5, stompPower: 2.2, gait: 'heavy', legArmor: 1.6, immuneKnockback: true },
  },
  legsTreads: {
    id: 'legsTreads', slot: 'legs', name: 'Treads',
    does: 'Tank tracks: ×1.25 on flat ground, ×0.6 on slopes, slower hull turn (×0.5), no hop, no aim sway, hull ×1.2, crushes enemies driven over.',
    lore: 'No knees to break, no stairs to climb, no apologies to offer.',
    legs: { walk: 1.25, jump: 0, stomp: 0, stompPower: 0, gait: 'treads', hullScale: 1.2, turnRate: 0.5, noSway: true, crushOnDrive: true },
  },
  legsSpider: {
    id: 'legsSpider', slot: 'legs', name: 'Spider Legs',
    does: 'Four legs: strafe ×1.4, climbs 45° slopes and 2.2 m ledges, zero view recoil kick, and a 360° 5 m leg sweep instead of stomp.',
    lore: 'Four points of contact, none of which care what the floor looks like.',
    legs: { walk: 1, jump: 1, stomp: 1, stompPower: 1, gait: 'spider', strafe: 1.4, noRecoil: true, legSweep: true },
  },

  cockpitStandard: {
    id: 'cockpitStandard', slot: 'cockpit', name: 'Standard Cockpit',
    does: 'One seat, one canopy, one shoulder slot (G).',
    lore: 'Seats one. Comfort was considered and declined.',
    cockpit: { shoulders: 1, canopyScale: 1, hullScale: 1, openSeat: false, sensorRange: 0 },
  },
  cockpitTwin: {
    id: 'cockpitTwin', slot: 'cockpit', name: 'Twin-Mount Cockpit',
    does: 'Two shoulder slots (G and V). Thinner canopy cracks at ×0.7 damage.',
    lore: 'Room for a second mount, paid for out of the glass budget.',
    cockpit: { shoulders: 2, canopyScale: 0.7 },
  },
  cockpitOpen: {
    id: 'cockpitOpen', slot: 'cockpit', name: 'Open Frame',
    does: 'Three shoulder slots (G, V and B) with no canopy: seat hits hurt the pilot directly as on foot. Hull ×0.9.',
    lore: 'Maximum ordinance, minimum windscreen. Sign the waiver before boarding.',
    cockpit: { shoulders: 3, canopyScale: 0, hullScale: 0.9, openSeat: true },
  },
  cockpitSensor: {
    id: 'cockpitSensor', slot: 'cockpit', name: 'Sensor Cockpit',
    does: 'One shoulder slot (G). Highlights every enemy within 70 m through walls (shared with teammates in co-op). Hull ×0.9.',
    lore: 'Wired straight into the Thermal brain chip bus so walls stop pretending to be cover.',
    cockpit: { shoulders: 1, hullScale: 0.9, sensorRange: 70 },
  },

  engineStandard: {
    id: 'engineStandard', slot: 'engine', name: 'Standard Engine',
    does: 'Walks, charges with Shift, lifts on the jets for about 2.3 s of fuel.',
    lore: 'It runs on the same thing you do: regulations.',
    engine: { speed: 1, drive: 'jets', dash: 1, fuelScale: 1, airborneDamageMult: 1 },
  },
  engineJet: {
    id: 'engineJet', slot: 'engine', name: 'Jump-Jet Engine',
    does: 'Walk ×1.2. Hold Space for true flight (14 m/s air speed, 4 s fuel); Shift triggers a 32 m/s jet blast in any direction.',
    lore: 'Vertical mobility, billed by the second.',
    engine: { speed: 1.2, drive: 'flight', dash: 32 / 18, fuelScale: 4 / 2.3 },
  },
  engineRotor: {
    id: 'engineRotor', slot: 'engine', name: 'Rotor Engine',
    does: 'Walk ×0.9. Hold Space to climb up to 14 m and hover indefinitely (9 m/s air strafe, no Shift charge). Hull takes ×1.25 damage airborne.',
    lore: 'A quiet ceiling of 14 metres, for prolonged oversight.',
    engine: { speed: 0.9, drive: 'hover', dash: 0, fuelScale: 1, airborneDamageMult: 1.25 },
  },
  engineAfterburner: {
    id: 'engineAfterburner', slot: 'engine', name: 'Afterburner',
    does: 'Normal hop. Hold Shift in the air to fold into 48 m/s jet mode (7 s fuel, arms locked forward); stomp from jet mode dive-bombs at ×1.5.',
    lore: 'Approved as a ground vehicle under a footnote nobody has read.',
    engine: { speed: 1, drive: 'afterburner', dash: 1, fuelScale: 7 / 2.3 },
  },
  engineOvercharge: {
    id: 'engineOvercharge', slot: 'engine', name: 'Overcharge Engine',
    does: 'Fast ground build: walk ×1.45, 3 charges at 26 m/s (2.5 s refill each), jet fuel ×0.5.',
    lore: 'Every safety governor removed and filed under "non-essential".',
    engine: { speed: 1.45, drive: 'overcharge', dash: 26 / 18, fuelScale: 0.5 },
  },
  engineDiesel: {
    id: 'engineDiesel', slot: 'engine', name: 'Long-Haul Engine',
    does: 'Walk ×0.95. Hold Shift for a steady 11 m/s run up to 12 s (4 s refill) that tramples small enemies; jet fuel ×1.3.',
    lore: 'Built to outlast the shift, the riot, and the building.',
    engine: { speed: 0.95, drive: 'diesel', dash: 11 / 18, fuelScale: 1.3 },
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
export const MAX_SHOULDERS = 3;

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

/** The shoulder weapon kinds fitted in slots 0..N-1. */
export function shouldersOf(l: FrameLoadout, parts: Parts = FRAME_PARTS): ShoulderKind[] {
  const count = shoulderSlots(l, parts);
  const out: ShoulderKind[] = [];
  for (let i = 0; i < count; i++) {
    const id = l.shoulders[i];
    out.push((id ? parts[id]?.shoulder : undefined) ?? 'pod6');
  }
  return out;
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

/** What the parts add up to, for movement, durability, and slots. With the standard parts every multiplier is 1 and every flag is false / 0. */
export interface FrameStats {
  /** Walk speed: the legs' times the engine's. */
  walk: number;
  /** The jets' launch speed. */
  jump: number;
  /** The stomp's ring radius multiplier. */
  stomp: number;
  /** The stomp's damage and push multiplier. */
  stompPower: number;
  /** The charge speed multiplier. */
  dash: number;
  gait: GaitKind;
  drive: DriveKind;
  shoulders: number;
  /** The six-tube pod is in a shoulder slot. */
  pod: boolean;
  /** Combined hull hit-point multiplier (legs × cockpit). */
  hullScale: number;
  /** Leg armour multiplier. */
  legArmor: number;
  /** Canopy hit-point multiplier (0 = no canopy). */
  canopyScale: number;
  /** Open Frame: seat hits damage the pilot directly. */
  openSeat: boolean;
  /** Sensor Cockpit wall-seeing outline range in metres (0 = off). */
  sensorRange: number;
  /** Hull damage multiplier while airborne (Rotor Engine = 1.25). */
  airborneDamageMult: number;
  /** Suppresses view recoil kick (Spider Legs). */
  noRecoil: boolean;
  /** Suppresses movement aim sway (Treads). */
  noSway: boolean;
  /** Immune to enemy knockback (Pile-Driver Legs). */
  immuneKnockback: boolean;
  /** Replaces stomp with a 360° 5 m leg sweep (Spider Legs). */
  legSweep: boolean;
  /** Crushes enemies driven over on flat ground (Treads). */
  crushOnDrive: boolean;
  /** Lateral strafe speed multiplier (Spider Legs = 1.4). */
  strafe: number;
  /** Hull turn rate multiplier (Treads = 0.5). */
  turnRate: number;
  /** Jet/flight fuel capacity multiplier. */
  fuelScale: number;
}

export function frameStats(l: FrameLoadout, parts: Parts = FRAME_PARTS): FrameStats {
  const legs = parts[l.legs]?.legs ?? FRAME_PARTS.legsStandard.legs!;
  const engine = parts[l.engine]?.engine ?? FRAME_PARTS.engineStandard.engine!;
  const cockpit = parts[l.cockpit]?.cockpit ?? FRAME_PARTS.cockpitStandard.cockpit!;
  return {
    walk: legs.walk * engine.speed,
    jump: legs.jump,
    stomp: legs.stomp,
    stompPower: legs.stompPower ?? legs.stomp,
    dash: engine.dash,
    gait: legs.gait,
    drive: engine.drive,
    shoulders: shoulderSlots(l, parts),
    pod: l.shoulders.includes('pod6'),
    hullScale: (legs.hullScale ?? 1) * (cockpit.hullScale ?? 1),
    legArmor: legs.legArmor ?? 1,
    canopyScale: cockpit.canopyScale ?? 1,
    openSeat: cockpit.openSeat ?? false,
    sensorRange: cockpit.sensorRange ?? 0,
    airborneDamageMult: engine.airborneDamageMult ?? 1,
    noRecoil: legs.noRecoil ?? false,
    noSway: legs.noSway ?? false,
    immuneKnockback: legs.immuneKnockback ?? false,
    legSweep: legs.legSweep ?? false,
    crushOnDrive: legs.crushOnDrive ?? false,
    strafe: legs.strafe ?? 1,
    turnRate: legs.turnRate ?? 1,
    fuelScale: engine.fuelScale ?? 1,
  };
}

/** Numbers a loadout takes on the wire: the five single slots, then `MAX_SHOULDERS` shoulders (-1 for none). */
export const KIT_LENGTH = SINGLE_SLOTS.length + MAX_SHOULDERS;

/** Legacy 2-shoulder wire length (before `MAX_SHOULDERS` grew to 3). Accepted by `kitFrom` and co-op pose decoding. */
export const LEGACY_KIT_LENGTH = SINGLE_SLOTS.length + 2;

/** A loadout as one short list of part numbers (places in `FRAME_PART_ORDER`), for the co-op wire. */
export function kitIds(l: FrameLoadout): number[] {
  const out = SINGLE_SLOTS.map(s => FRAME_PART_ORDER.indexOf(l[s]));
  for (let i = 0; i < MAX_SHOULDERS; i++) out.push(l.shoulders[i] ? FRAME_PART_ORDER.indexOf(l.shoulders[i]!) : -1);
  return out;
}

/**
 * The loadout another player's numbers say, made safe: an unknown number is the default's part for that slot.
 * Accepts both the current 8-number list (3 shoulder slots) and the legacy 7-number list (2 shoulder slots).
 */
export function kitFrom(ids: ArrayLike<number>): FrameLoadout {
  const at = (i: number): FramePartId | undefined => {
    if (i >= ids.length) return undefined;
    const idx = Math.round(Number(ids[i]));
    return Number.isInteger(idx) && idx >= 0 ? FRAME_PART_ORDER[idx] : undefined;
  };
  const raw: Record<string, unknown> = {};
  SINGLE_SLOTS.forEach((s, i) => { raw[s] = at(i); });
  const shoulderCount = Math.min(MAX_SHOULDERS, Math.max(0, ids.length - SINGLE_SLOTS.length));
  raw.shoulders = Array.from({ length: shoulderCount }, (_, i) => at(SINGLE_SLOTS.length + i));
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
