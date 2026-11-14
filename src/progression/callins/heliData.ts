/**
 * Every number the two helicopters are tuned by, in seconds, metres and enemy hit points. Their places on the ladder are
 * in ../data.ts with the others.
 *
 * Each flight has a plan for the Kill House and one for the Crucible. The Kill House is the hard one: its invisible walls
 * stand 26 m over a 35 m half-width, and a line of fire from beyond them bursts in mid-air, so it has to fly over the map
 * and above them. `SMALL_MAP` is the half-width below which the tight plan applies.
 */
import type { EngineSoundPlan, OrbitPlan, Point } from './airframe';
import type { PilotPlan } from '../../vehicles/pilot';
import type { SeatPlan } from '../../vehicles/seat';
import type { MuzzleKind } from '../../core/contracts';
import type { BurstSpec } from '../../core/gameplay';

export const SMALL_MAP = 80;

/** `?doorgun=old` puts the M134 back in the Packmule's door: sixty light rounds a second that neither burst nor go through anything. */
export const DOORGUN_OLD = typeof location !== 'undefined' && new URLSearchParams(location.search).get('doorgun') === 'old';

/** The Packmule's door gun, in the same units as a row of the weapon table. */
export interface DoorGunPlan {
  /** What the gunner's panel calls the belt. */
  name: string;
  rounds: number;
  roundsPerSecond: number;
  /** At most this many leave on one frame. A long frame loses rounds and not its pace. */
  perFrame: number;
  spinUp: number;
  spinDown: number;
  /** Below this spin the barrels turn but nothing leaves them. */
  fireAt: number;
  /** Radians per second at full spin. */
  barrelRate: number;
  spread: number;
  damage: number;
  severMult: number;
  force: number;
  /** Each round goes off where it first strikes and where it stops: src/weapons/burst.ts. Null for a round that does not. */
  burst: BurstSpec | null;
  /** Metres of concrete a round goes on through, and what a body costs it. 0 stops at the first thing it meets. */
  penetrate: number;
  bodyCost: number;
  /** One tracer in this many, as a real belt is loaded. */
  tracerEvery: number;
  flashEvery: number;
  casingEvery: number;
  flash: MuzzleKind;
  casing: 'rifle' | 'cannon';
  impactScale: number;
  range: number;
  /** How hard the stream shakes the view, and the walk it puts on the barrels. */
  trauma: number;
  kick: number;
  /** `minigun_fire_loop` is cut at 25 rounds a second: this turns it to the gun's own rate. */
  loopPitch: number;
}

/**
 * The door gun: a 20 mm rotary cannon. It is the one gun in the game whose rounds do both things: they burst where they
 * land, as the rotary cannon's do on foot, and they go on through, as the heavy machine gun's do. The men it is fired at
 * are under a roof or behind a wall more often than not. 1.4 m is a roof or an inner wall and the man beneath it; an outer
 * wall of 1.6 m still stops it. Half the old gun's rate and nearly three times its round, so it is a third more damage a
 * second, in rounds that can be seen landing. The burst is half as big again as the one on foot, to read from the air.
 */
const DOOR_GUN: DoorGunPlan = {
  name: '20MM HEI-AP',
  rounds: 1000,
  roundsPerSecond: 30,
  perFrame: 3,
  spinUp: 0.5,
  spinDown: 1.1,
  fireAt: 0.8,
  barrelRate: 46,
  spread: 0.007,
  damage: 60,
  severMult: 3,
  force: 34,
  burst: { radius: 0.6, damage: 16, scale: 1.5 },
  penetrate: 1.4,
  bodyCost: 0.3,
  tracerEvery: 2,
  // The muzzle is a metre under the sight. The on-foot gun's flash there, every round, sat on the target: a rifle's, every other.
  flashEvery: 2,
  casingEvery: 2,
  flash: 'rifle',
  casing: 'cannon',
  impactScale: 1.6,
  range: 420,
  trauma: 0.55,
  kick: 0.0012,
  loopPitch: 30 / 25,
};

/** The gun as it was before the rework. */
const M134_GUN: DoorGunPlan = {
  name: 'M134 7.62',
  rounds: 1800,
  roundsPerSecond: 60,
  perFrame: 4,
  spinUp: 0.42,
  spinDown: 0.95,
  fireAt: 0.8,
  barrelRate: 62,
  spread: 0.0065,
  damage: 22,
  severMult: 1.6,
  force: 6,
  burst: null,
  penetrate: 0,
  bodyCost: 0.4,
  tracerEvery: 4,
  flashEvery: 2,
  casingEvery: 3,
  flash: 'minigun',
  casing: 'rifle',
  impactScale: 1.5,
  range: 420,
  trauma: 0.11,
  kick: 0.0006,
  loopPitch: 2,
};

/**
 * Highest either gun can point. From 31 m this still reaches the far wall of the Kill House, and any flatter the sight
 * would land on the invisible walls above it, with rounds bursting in the air over the perimeter.
 */
const PITCH_STOP = -0.36;

export interface HeliPlan {
  callsign: string;
  color: string;
  seat: SeatPlan;
  engine: EngineSoundPlan;
  /** Seconds of watching it fly in, before the cut to the seat. */
  boardSeconds: number;
  /** Where the camera rides for that, in the aircraft's frame. */
  chase: Point;
  /** After leaving the seat, how long until it is gone. */
  departSeconds: number;
  /** Enemies within this of each other count as one fight. */
  knotRadius: number;
  /** Seconds between looking for it. */
  scanEvery: number;
  /** Seconds of the last call before the view goes back, so an empty gun is heard running out. */
  winchester: number;
  /** Kills inside this window earn a line from the crew, at most this often. */
  praise: { kills: number; window: number; every: number };
  /**
   * Seconds from the call that the crew fights on with rounds left, seated time included. The one airframe has to be
   * home before the cooldown ends, so this and `departSeconds` fit inside it (heli.test.ts).
   */
  aiSeconds: number;
  /** The crew on the gun: seconds of each burst and of the pause after it, and the knot that earns the second weapon. */
  ai: { burst: readonly [number, number]; rest: readonly [number, number]; altKnot: number };
  /** Missile hits that bring it down, and flares aboard. Read by part 2 of the air support plan. */
  armour: { hits: number; flares: number };
}

const ROTOR = 'heli_rotor_loop';
const TURBINE = 'heli_turbine_loop';

export const ATTACK = {
  callsign: 'HARROW',
  color: '#ff5a3c',
  seat: {
    label: 'HARROW 1-1 // GUNNER',
    tone: 'thermal',
    seconds: 60,
    fov: 56,
    zoomFov: 22,
    aimZooms: false,
    arcCenter: 0,
    arcHalf: 1.95,
    pitchMin: -1.4,
    pitchMax: PITCH_STOP,
    lock: 0.92,
    roll: 0.35,
    eye: [0, 0.5, -0.6],
    reach: 450,
    grade: 'thermal',
    enemyColor: '#ffd9a0',
    grace: 2.5,
    shake: 0.45,
  },
  engine: {
    near: 70, far: 520,
    layers: [{ id: ROTOR, volume: 1.3, pitch: 1 }, { id: TURBINE, volume: 0.7, pitch: 1 }],
  },
  boardSeconds: 2.8,
  chase: [-8, 2.4, -17],
  departSeconds: 11,
  knotRadius: 11,
  winchester: 1.5,
  praise: { kills: 3, window: 1.6, every: 9 },
  aiSeconds: 120,
  ai: { burst: [0.6, 1.4], rest: [0.5, 1.2], altKnot: 3 },
  armour: { hits: 2, flares: 3 },
  /** How long the pilot takes to change his mind about where the fight is, as a rate. */
  focusRate: 0.9,
  scanEvery: 0.5,
  /** Seconds ahead along the flight that the map is read, so it climbs before the wall and not at it. */
  floorAhead: 2.4,
  /** How far outside the map it starts, and how far it is told to go when leaving. */
  entryReach: 110,
  exitReach: 700,
  exitClimb: 70,
  small: {
    standoff: 25, altitude: 31, clearance: 5, cruise: 13, dash: 46, response: 1.3, climb: 0.9, turn: 2.2,
    lean: 0.024, maxRoll: 0.5, maxPitch: 0.32, reverse: [13, 22], limit: 31,
  } as PilotPlan,
  large: {
    standoff: 46, altitude: 40, clearance: 14, cruise: 20, dash: 62, response: 1.1, climb: 0.8, turn: 1.8,
    lean: 0.019, maxRoll: 0.55, maxPitch: 0.34, reverse: [15, 26], limit: 132,
  } as PilotPlan,
  cannon: {
    rounds: 320, interval: 0.1, speed: 320, spread: 0.006, damage: 190, radius: 3.4, recoil: 0.2, kick: 0.0035, trauma: 0.13,
  },
  rockets: {
    rounds: 38, interval: 0.17, speed: 150, spread: 0.012, damage: 300, radius: 7.5, trauma: 0.22,
  },
} as const satisfies HeliPlan & Record<string, unknown>;

export const DOOR = {
  callsign: 'PACKMULE',
  color: '#ffc14a',
  seat: {
    label: 'PACKMULE 2-2 // LEFT DOOR',
    tone: 'door',
    seconds: 45,
    fov: 74,
    zoomFov: 42,
    aimZooms: true,
    arcCenter: Math.PI / 2,
    arcHalf: 1.2,
    pitchMin: -1.25,
    pitchMax: PITCH_STOP,
    lock: 0.9,
    roll: 0.55,
    eye: [0, 0.34, 0.8],
    reach: 420,
    grade: null,
    enemyColor: '#ff7a30',
    grace: 2.5,
    shake: 0.5,
  },
  engine: {
    near: 70, far: 520,
    layers: [{ id: ROTOR, volume: 1.3, pitch: 1.3 }, { id: TURBINE, volume: 0.8, pitch: 1.12 }],
  },
  boardSeconds: 3.2,
  chase: [13, 3.5, -17],
  departSeconds: 10,
  knotRadius: 11,
  winchester: 1.5,
  praise: { kills: 4, window: 1.4, every: 9 },
  aiSeconds: 90,
  ai: { burst: [1.2, 2.4], rest: [0.8, 1.6], altKnot: 99 },
  armour: { hits: 1, flares: 2 },
  /** How fast the circle slides toward the fight, as a rate. Slow, so the lap stays a lap. */
  focusRate: 0.22,
  scanEvery: 0.5,
  small: {
    radius: 27, altitude: 31, rate: -0.42, bank: 0.24,
    entrySeconds: 4, entryReach: 170, holdSeconds: 60, exitSeconds: 10, exitReach: 420, exitClimb: 55,
  } as OrbitPlan,
  large: {
    radius: 46, altitude: 40, rate: -0.34, bank: 0.3,
    entrySeconds: 4, entryReach: 230, holdSeconds: 60, exitSeconds: 10, exitReach: 480, exitClimb: 55,
  } as OrbitPlan,
  /** The circle's edge stays this far inside the map, on the small plan's numbers. See the note at the top. */
  limit: { small: 3, large: 70 },
  /** Metres above the tallest thing on the circle. The Kill House's figure is what clears its invisible walls at 31 m. */
  clearance: { small: 5, large: 14 },
  /** How fast the circle rises for something tall, as a rate. It settles back at a quarter of this. */
  liftRate: 2,
  /** On a mission's fixed flight: m/s, how far above the floor it comes to rest, and how fast it sinks there. */
  flightSpeed: 17,
  flightRest: 1.7,
  flightSink: 1.2,
  gun: DOORGUN_OLD ? M134_GUN : DOOR_GUN,
} as const satisfies HeliPlan & Record<string, unknown>;
