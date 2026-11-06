/**
 * Every number the gunship is tuned by, in seconds, metres and enemy hit points. Its place on the ladder is in
 * ../data.ts with the others.
 */

/** What the guns are doing at each stage of the siege. A gap of 0 means that gun has not come up yet. */
export interface SiegePhase {
  /** Seconds on station. */
  at: number;
  /** Said as the phase opens. */
  line: string;
  /** Seconds between 25mm bursts. */
  gatlingGap: number;
  boforsGap: number;
  /** Shells in one 40mm string. */
  boforsShells: number;
  howitzerGap: number;
  /** Shots in one 105mm salvo. */
  howitzerShots: number;
  hellfireGap: number;
}

export const AC130 = {
  callsign: 'SPECTRE',
  /**
   * A 33 s lap at about 39 m/s. Far lower and closer than the real thing: at a true slant range the ship is under a
   * hundred pixels on a Retina screen, and this keeps it about 33 degrees up, where it crosses the top of a level view.
   */
  orbit: {
    radius: 205, altitude: 135, rate: -0.19, bank: 0.5,
    entrySeconds: 9, entryReach: 480, holdSeconds: 120, exitSeconds: 12, exitReach: 620, exitClimb: 150,
  },
  engine: {
    near: 260, far: 1100,
    /** Two close pitches of one loop beat against each other, the drone of props never quite in step. */
    layers: [
      { id: 'drone_rotor_loop', volume: 1.5, pitch: 0.42 },
      { id: 'drone_rotor_loop', volume: 1.1, pitch: 0.467 },
    ],
    /** The level rises and falls by this much around each lap, as wind and the turn carry the sound about. */
    swell: 0.35,
  },
  /** Enemies this far out of the ring still get shot. They rarely stand still in it. */
  scanMargin: 8,
  scanEvery: 0.25,
  /** Anything in the way above this height over the target is a roof, not a wall, and rounds go in under it. */
  roofHeight: 8,
  gatling: {
    speed: 190,
    roundsPerSecond: 12,
    burst: [1.6, 2.8] as const,
    /** m/s the aim walks. It starts short of the target, on the aircraft's side, so the stream is seen to walk on. */
    walkSpeed: 11,
    walkIn: 13,
    scatter: 1.1,
    damage: 55,
    radius: 2.6,
    /** With nobody in the box the 25mm rakes it anyway after this long, so the siege never goes dead. */
    reconAfter: 7,
    retry: 0.8,
  },
  bofors: { speed: 130, gap: 0.3, spacing: 3.4, scatter: 0.8, damage: 170, radius: 5, retry: 1 },
  howitzer: {
    /** Seconds in the air. Slow enough to watch one fall, and to get a whistle in. */
    flight: 4.6,
    /** Close to level out of the barrel and steep at the end. Any stronger and it would lob up out of a gun pointing down. */
    gravity: 11,
    gap: 2.7,
    spread: 5,
    damage: 620,
    radius: 12,
    /** It never fires this close to the player. Nothing would hurt, but nobody could see through it either. */
    noFire: 14,
    whistle: 2,
    retry: 1.5,
  },
  hellfire: { drop: 0.7, speed: 130, turn: 3.4, damage: 1100, radius: 7, life: 9, whistle: 1.4, retry: 2 },
  flares: { pairs: 8, gap: 0.16, speed: 15, gravity: 9, drag: 0.55, life: 3.4, every: 27 },
  /** Enemies within this of each other count as one target for the heavy guns. */
  clusterRadius: 8,
  phases: [
    {
      at: 0, line: 'TWO-FIVE TRACKING. GUNS HOT.',
      gatlingGap: 3.4, boforsGap: 0, boforsShells: 0, howitzerGap: 0, howitzerShots: 0, hellfireGap: 0,
    },
    {
      at: 24, line: 'FOUR-ZERO ONLINE. WALKING IT IN.',
      gatlingGap: 3, boforsGap: 7, boforsShells: 5, howitzerGap: 0, howitzerShots: 0, hellfireGap: 0,
    },
    {
      at: 54, line: 'ONE-OH-FIVE UP. KEEP YOUR HEAD DOWN.',
      gatlingGap: 2.6, boforsGap: 6, boforsShells: 6, howitzerGap: 15, howitzerShots: 3, hellfireGap: 12,
    },
    {
      at: 92, line: 'ALL GUNS. EVERYTHING WE HAVE LEFT.',
      gatlingGap: 1.8, boforsGap: 4, boforsShells: 8, howitzerGap: 9.5, howitzerShots: 4, hellfireGap: 7,
    },
  ] as readonly SiegePhase[],
  /** Seconds left on station, and what the crew says about it. */
  countdown: [[60, 'SIXTY SECONDS ON STATION.'], [30, 'THIRTY SECONDS. BINGO FUEL.'], [10, 'TEN SECONDS. LAST ROUNDS.']] as const,
  /** Kills inside this window earn a line from the crew, at most this often. */
  praise: { kills: 3, window: 1.6, every: 11 },
} as const;
