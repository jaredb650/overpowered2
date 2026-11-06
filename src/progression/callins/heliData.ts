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

export const SMALL_MAP = 80;

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
}

const ROTOR = 'drone_rotor_loop';

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
    pitchMax: -0.06,
    lock: 0.92,
    roll: 0.35,
    eye: [0, 0.56, 0.2],
    reach: 450,
    grade: 'thermal',
    enemyColor: '#ffd9a0',
    grace: 2.5,
    shake: 0.45,
  },
  engine: {
    near: 70, far: 520,
    layers: [{ id: ROTOR, volume: 1.5, pitch: 0.34 }, { id: ROTOR, volume: 1.1, pitch: 0.39 }],
  },
  boardSeconds: 2.8,
  chase: [-5.5, 4.5, -19],
  departSeconds: 11,
  knotRadius: 11,
  winchester: 1.5,
  praise: { kills: 3, window: 1.6, every: 9 },
  /** How long the pilot takes to change his mind about where the fight is, as a rate. */
  focusRate: 0.9,
  scanEvery: 0.5,
  floorEvery: 0.15,
  /** Seconds ahead along the flight that the ground is read, so it climbs before the wall and not at it. */
  floorAhead: 1.8,
  /** How far outside the map it starts, and how far it is told to go when leaving. */
  entryReach: 110,
  exitReach: 700,
  exitClimb: 70,
  small: {
    standoff: 25, altitude: 31, clearance: 14, cruise: 13, dash: 46, response: 1.3, climb: 1.1, turn: 2.2,
    lean: 0.024, maxRoll: 0.5, maxPitch: 0.32, reverse: [13, 22], limit: 31,
  } as PilotPlan,
  large: {
    standoff: 46, altitude: 34, clearance: 26, cruise: 20, dash: 62, response: 1.1, climb: 1, turn: 1.8,
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
    pitchMax: -0.04,
    lock: 0.9,
    roll: 0.55,
    eye: [0, 0.3, 0.74],
    reach: 420,
    grade: null,
    enemyColor: '#ff7a30',
    grace: 2.5,
    shake: 0.5,
  },
  engine: {
    near: 70, far: 520,
    layers: [{ id: ROTOR, volume: 1.5, pitch: 0.3 }, { id: ROTOR, volume: 1.1, pitch: 0.345 }],
  },
  boardSeconds: 3.2,
  chase: [13, 3.5, -17],
  departSeconds: 10,
  knotRadius: 11,
  winchester: 1.5,
  praise: { kills: 4, window: 1.4, every: 9 },
  /** How fast the circle slides toward the fight, as a rate. Slow, so the lap stays a lap. */
  focusRate: 0.22,
  scanEvery: 0.5,
  floorEvery: 0.2,
  small: {
    radius: 27, altitude: 31, rate: -0.42, bank: 0.24,
    entrySeconds: 4, entryReach: 170, holdSeconds: 60, exitSeconds: 10, exitReach: 420, exitClimb: 55,
  } as OrbitPlan,
  large: {
    radius: 56, altitude: 44, rate: -0.3, bank: 0.3,
    entrySeconds: 4, entryReach: 230, holdSeconds: 60, exitSeconds: 10, exitReach: 480, exitClimb: 55,
  } as OrbitPlan,
  /** The circle's edge stays this far inside the map, on the small plan's numbers. See the note at the top. */
  limit: { small: 3, large: 70 },
  /** Metres above whatever it is over. */
  clearance: 22,
  gun: {
    rounds: 1800,
    roundsPerSecond: 60,
    /** At most this many leave on one frame. A long frame loses rounds and not its pace. */
    perFrame: 4,
    spinUp: 0.42,
    spinDown: 0.95,
    /** Below this spin the barrels turn but nothing leaves them. */
    fireAt: 0.8,
    /** Radians per second at full spin. */
    barrelRate: 62,
    spread: 0.0065,
    damage: 22,
    severMult: 1.6,
    force: 6,
    /** One tracer in this many, as a real belt is loaded. Every round would join into a solid beam at this rate. */
    tracerEvery: 4,
    flashEvery: 2,
    casingEvery: 3,
    impactScale: 1.5,
    range: 420,
    /** How hard the stream shakes the view, and the walk it puts on the barrels. */
    trauma: 0.11,
    kick: 0.0006,
  },
} as const satisfies HeliPlan & Record<string, unknown>;
