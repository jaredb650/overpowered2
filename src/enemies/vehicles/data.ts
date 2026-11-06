/**
 * Every number the enemy vehicles are tuned by, in metres, seconds and hit points. Models follow airframe.ts: nose along +Z, up +Y,
 * so the left side is +X. docs/notes/vehicles.md has why each is what it is.
 */
import type { VehicleKind } from '../../campaign/types';
import type { SurfaceKind } from '../../core/contracts';
import type { EnemyId } from '../../core/gameplay';

export type Point = readonly [number, number, number];

export type PartId = 'engine' | 'cab' | 'bed' | 'hull' | 'trackLeft' | 'trackRight' | 'turret' | 'cockpit' | 'body' | 'tail' | 'rotor';

export interface PartDef {
  id: PartId;
  /** Middle of the box, in model space. */
  at: Point;
  half: Point;
  /** Multiplies whatever lands here. */
  scale: number;
  /** Hit points of its own. It breaks at 0, and hits go on counting against the whole vehicle. 0 means it cannot break. */
  pool: number;
  /** Turns with the turret. */
  turns?: boolean;
}

export interface DriveDef {
  /** m/s. */
  top: number;
  accel: number;
  brake: number;
  /** Metres between axles: how tight it can turn at speed. 0 steers on its tracks. */
  wheelbase: number;
  /** Largest wheel angle, or radians per second for tracks. */
  steer: number;
  /** How fast the wheels follow the driver. */
  steerRate: number;
  /** Metres ahead on the route it looks. */
  lookahead: number;
  /** Radians of pitch and roll per m/s². This, and the spring, is the weight. */
  dive: number;
  lean: number;
  /** Spring rate and damping on the chassis, as per second. A heavy thing is slow and barely bounces. */
  spring: number;
  damping: number;
}

export interface MountDef {
  /** Damage of one round. */
  damage: number;
  /** Rounds per second. */
  rate: number;
  /** Rounds in a burst, and seconds between bursts. */
  burst: readonly [number, number];
  rest: readonly [number, number];
  /** Radians of scatter when a burst opens and when it has settled. */
  spreadOpen: number;
  spreadSettled: number;
  /** Rounds it takes to settle. */
  settle: number;
  range: number;
  /** Radians per second the gun swings. */
  slew: number;
  /** Seconds of watching before the first round, so the barrel coming round is the warning. */
  acquire: number;
}

export interface CannonDef {
  damage: number;
  radius: number;
  speed: number;
  /** Seconds it holds still on the mark with the laser up. The player's chance to move. */
  lay: number;
  reload: number;
  range: number;
  /** Radians per second the turret turns, and the gun lifts. */
  traverse: number;
  elevate: number;
  /** Share of the player's motion it leads by. */
  lead: number;
}

export interface WreckDef {
  /** The blast when it goes. Player caught in it takes the barrel's rules. */
  blastRadius: number;
  blastDamage: number;
  blastScale: number;
  /** Seconds it stays alight, and the reach of the flames past its sides. */
  burnSeconds: number;
  burnReach: number;
  /** Seconds after the blast at which it cooks off again. */
  cookOffs: readonly number[];
  /** Metres per second it leaves the ground. */
  hop: number;
}

export interface VehicleDef {
  kind: VehicleKind;
  name: string;
  /** True: bullets stop here, and only blasts and shells count. */
  armoured: boolean;
  health: number;
  score: number;
  /** Half its width and length on the ground, and the height of the roof, for anything that has to walk round it. */
  halfWidth: number;
  halfLength: number;
  roof: number;
  surface: SurfaceKind;
  parts: readonly PartDef[];
  wreck: WreckDef;
  /** Hits from a moving one: damage at top speed, and the throw in m/s. */
  ram: { damage: number; throw: number };
  /** Men it brings along when an order names none. They are extras: they hold nothing up. */
  crew: readonly EnemyId[];
}

export interface GroundDef extends VehicleDef {
  drive: DriveDef;
  /** Where men leave it, in model space. The first is for the driver. */
  exits: readonly Point[];
  /** Where the mounted gunner's feet go, relative to the gun's pivot. */
  rider?: Point;
  mount: MountDef;
  cannon?: CannonDef;
}

export const SOFT_BLAST = { radius: 6.5, damage: 110 };

export const HUMVEE: GroundDef = {
  kind: 'humvee', name: 'SCOUT CAR', armoured: false, health: 520, score: 400,
  halfWidth: 1.15, halfLength: 2.55, roof: 2, surface: 'metal',
  parts: [
    { id: 'engine', at: [0, 1.05, 1.65], half: [1.05, 0.45, 0.85], scale: 1.5, pool: 0 },
    { id: 'cab', at: [0, 1.4, 0.15], half: [1.1, 0.6, 0.72], scale: 0.7, pool: 0 },
    { id: 'bed', at: [0, 1.15, -1.5], half: [1.15, 0.52, 1.02], scale: 0.7, pool: 0 },
  ],
  wreck: { blastRadius: 6.5, blastDamage: 110, blastScale: 1.3, burnSeconds: 22, burnReach: 1.3, cookOffs: [2.4], hop: 5.5 },
  ram: { damage: 35, throw: 9 },
  crew: [],
  drive: {
    top: 13, accel: 3.6, brake: 6.5, wheelbase: 3, steer: 0.55, steerRate: 5, lookahead: 7,
    dive: 0.011, lean: 0.017, spring: 34, damping: 7.5,
  },
  exits: [[1.7, 0, 0.5], [-1.7, 0, 0.5], [1.7, 0, -0.9], [-1.7, 0, -0.9]],
  rider: [0, -1.34, -0.42],
  mount: {
    damage: 6, rate: 8, burst: [6, 11], rest: [1.3, 2.4], spreadOpen: 0.05, spreadSettled: 0.017, settle: 6, range: 75, slew: 1.8, acquire: 0.9,
  },
};

export const TRUCK: GroundDef = {
  kind: 'truck', name: 'TROOP TRUCK', armoured: false, health: 680, score: 500,
  halfWidth: 1.32, halfLength: 4.05, roof: 3.3, surface: 'metal',
  parts: [
    { id: 'engine', at: [0, 1.35, 3.25], half: [1.05, 0.6, 0.8], scale: 1.5, pool: 0 },
    { id: 'cab', at: [0, 1.75, 1.8], half: [1.25, 0.95, 0.7], scale: 0.7, pool: 0 },
    { id: 'bed', at: [0, 1.95, -1.5], half: [1.32, 1.3, 2.55], scale: 0.55, pool: 0 },
  ],
  wreck: { blastRadius: 7.5, blastDamage: 120, blastScale: 1.5, burnSeconds: 28, burnReach: 1.5, cookOffs: [2, 4.5], hop: 4 },
  ram: { damage: 50, throw: 11 },
  crew: [],
  drive: {
    top: 11, accel: 2.4, brake: 4.6, wheelbase: 4.6, steer: 0.5, steerRate: 3.6, lookahead: 9,
    dive: 0.016, lean: 0.022, spring: 22, damping: 5,
  },
  exits: [[0.7, 1.15, -4.2], [-0.7, 1.15, -4.2], [0, 1.15, -4.3], [1.7, 0, 1.8], [-1.7, 0, 1.8]],
  rider: [0, -1.34, -0.42],
  mount: {
    damage: 6, rate: 8, burst: [7, 12], rest: [1.2, 2.2], spreadOpen: 0.055, spreadSettled: 0.02, settle: 7, range: 75, slew: 1.5, acquire: 1,
  },
};

export const TANK: GroundDef = {
  kind: 'tank', name: 'MAIN BATTLE TANK', armoured: true, health: 1000, score: 1500,
  halfWidth: 1.85, halfLength: 4.1, roof: 3.05, surface: 'armor',
  parts: [
    { id: 'hull', at: [0, 1.3, 0.8], half: [1.2, 0.68, 3.1], scale: 1, pool: 0 },
    { id: 'engine', at: [0, 1.32, -3.05], half: [1.2, 0.64, 0.95], scale: 1.7, pool: 420 },
    { id: 'trackLeft', at: [1.56, 0.78, 0], half: [0.34, 0.74, 4.05], scale: 0.8, pool: 190 },
    { id: 'trackRight', at: [-1.56, 0.78, 0], half: [0.34, 0.74, 4.05], scale: 0.8, pool: 190 },
    { id: 'turret', at: [0, 2.45, -0.15], half: [1.32, 0.56, 2.05], scale: 1, pool: 460, turns: true },
  ],
  wreck: { blastRadius: 9, blastDamage: 140, blastScale: 2.1, burnSeconds: 45, burnReach: 1.8, cookOffs: [1.4, 2.6, 4.2, 7], hop: 1.2 },
  ram: { damage: 80, throw: 13 },
  crew: ['trooper', 'trooper', 'trooper'],
  drive: {
    top: 7.5, accel: 1.5, brake: 3.2, wheelbase: 0, steer: 0.62, steerRate: 2.2, lookahead: 8,
    dive: 0.016, lean: 0.006, spring: 15, damping: 4.4,
  },
  exits: [[0.7, 3, -0.6], [-0.7, 3, -0.6], [0, 3, -1.4]],
  mount: {
    damage: 7, rate: 9, burst: [8, 13], rest: [1.6, 3], spreadOpen: 0.05, spreadSettled: 0.02, settle: 8, range: 60, slew: 1.1, acquire: 0.8,
  },
  cannon: { damage: 60, radius: 6, speed: 95, lay: 1.15, reload: 5.2, range: 130, traverse: 0.62, elevate: 0.5, lead: 0.55 },
};

export interface ChopperDef extends VehicleDef {
  /** The plan handed to the Autopilot. */
  pilot: {
    standoff: number; altitude: number; clearance: number; cruise: number; dash: number; response: number; climb: number;
    turn: number; lean: number; maxRoll: number; maxPitch: number; reverse: readonly [number, number]; limit: number;
  };
  /** Stays this far under a friendly aircraft, because a gunner's seat cannot look up. */
  underFriendly: number;
  /** Seconds it presses the attack and seconds it swings wide to come in again. */
  press: readonly [number, number];
  breakOff: readonly [number, number];
  /** Metres either side of the player the first round lands, walking in at this speed. */
  walkFrom: number;
  walkRate: number;
  gun: MountDef;
  rockets: {
    damage: number; radius: number; speed: number; salvo: number; gap: number; every: readonly [number, number]; spread: number;
    /** Metres over the mark at which it stops firing: rockets go flat. */
    range: number;
  };
  /** Seat seconds a friendly aircraft loses to one burst that lands. */
  seatHit: number;
  /** m/s² it falls and radians per second² it spins, by what was shot off. */
  spinRate: number;
  spinFall: number;
  dropFall: number;
  diveFall: number;
}

export const CHOPPER: ChopperDef = {
  kind: 'chopper', name: 'ATTACK HELICOPTER', armoured: true, health: 620, score: 2000,
  halfWidth: 1.5, halfLength: 5.9, roof: 3.1, surface: 'armor',
  parts: [
    { id: 'cockpit', at: [0, -0.02, 4.1], half: [0.62, 0.86, 1.55], scale: 1.6, pool: 0 },
    { id: 'body', at: [0, 0.1, 0.7], half: [1.05, 1.1, 2.1], scale: 1, pool: 0 },
    { id: 'tail', at: [0, 0.95, -4.3], half: [0.46, 0.7, 2.75], scale: 1, pool: 200 },
    { id: 'rotor', at: [0, 2.35, 0.3], half: [3.9, 0.24, 3.9], scale: 1, pool: 240 },
  ],
  wreck: { blastRadius: 8.5, blastDamage: 130, blastScale: 1.9, burnSeconds: 34, burnReach: 1.6, cookOffs: [1.5, 3.4], hop: 0 },
  ram: { damage: 0, throw: 0 },
  crew: ['trooper'],
  pilot: {
    standoff: 42, altitude: 24, clearance: 12, cruise: 10, dash: 40, response: 1.05, climb: 0.8, turn: 1.7,
    lean: 0.02, maxRoll: 0.5, maxPitch: 0.3, reverse: [9, 16], limit: 104,
  },
  underFriendly: 16,
  press: [9, 13],
  breakOff: [5, 7],
  walkFrom: 13,
  walkRate: 11,
  gun: {
    damage: 7, rate: 11, burst: [14, 22], rest: [2.4, 3.6], spreadOpen: 0.03, spreadSettled: 0.012, settle: 10, range: 90, slew: 1.5, acquire: 1.2,
  },
  rockets: { damage: 42, radius: 5.5, speed: 62, salvo: 4, gap: 0.22, every: [7, 10], spread: 0.022, range: 95 },
  seatHit: 1.2,
  spinRate: 3.2,
  spinFall: 7,
  dropFall: 13,
  diveFall: 10,
};

export const VEHICLES: Readonly<Record<VehicleKind, VehicleDef>> = { humvee: HUMVEE, truck: TRUCK, tank: TANK, chopper: CHOPPER };

/** How much of a blast the armour lets count when the blast has no shaped-charge row of its own, such as a grenade or a bomb. */
export const ARMOUR_BLAST_SHARE = 0.4;
/** Most a single blast counts for on armour before that share. Keeps a perk's instakill a number. */
export const ARMOUR_BLAST_MOST = 600;
/** A soft-skin takes blasts at this many times their number: a rocket or a grenade ends one, as the mission promises. */
export const SOFT_BLAST_SCALE = 3.4;
/** Bullets into the cab go through the door. Hits it takes to reach the driver. */
export const DRIVER_HEALTH = 75;
/** At this share of health a soft-skin stops and its crew get out. It burns down from there unless something finishes it. */
export const SOFT_FIRE_AT = 0.28;
/** Seconds from there until the fuel goes. */
export const SOFT_FIRE_SECONDS = 4.5;
/** A round from an aimed autocannon into the cockpit, on top of everything else. One is enough. */
export const COCKPIT_SHELL_SCALE = 5;
/** The Harrow's cannon is 10 rounds a second, and full shaped-charge value on each would end a tank in under a second. */
export const SOURCE_SCALE: Readonly<Record<string, number>> = { chopper_cannon: 0.14 };
/** The one bullet that counts: the Packmule's gun on a chopper's thin skin, so the Door Gunner has a fight to be in. */
export const SKIN_BULLETS: Readonly<Record<string, number>> = { door_gun: 0.22 };
/** Parts of a chopper that SKIN_BULLETS can reach. */
export const SKIN_PARTS: ReadonlySet<PartId> = new Set<PartId>(['tail', 'rotor', 'cockpit']);
/** Tracks are broken at this share of the top speed: one side gone is a stop, and an engine fire is this. */
export const ENGINE_FIRE_SPEED = 0.45;
export const ENGINE_FIRE_RELOAD = 1.6;
/** Damage a second to the hull while the engine burns. */
export const ENGINE_FIRE_BLEED = 14;

/** Bodies the map can carry. The Outpost needs 11: past it the oldest wreck is cleared. */
export const MAX_WRECKS = 14;
/** Ground vehicles alive at once. Orders past this wait for a space. */
export const MAX_LIVE = 8;
/** Men leave a vehicle this far apart in time. */
export const EXIT_GAP = 0.55;
