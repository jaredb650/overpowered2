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
   * A 33 s lap at about 31 m/s, far lower and closer than the real thing: at a true slant range the ship is under a
   * hundred pixels on a Retina screen. The 49 degree angle down is the number to protect. At 33 degrees a 4.2 m Kill
   * House wall shadowed most of a 10 m room, and 70% of the 25mm and every Hellfire hit a wall.
   */
  orbit: {
    radius: 160, altitude: 185, rate: -0.19, bank: 0.6,
    entrySeconds: 9, entryReach: 480, holdSeconds: 120, exitSeconds: 12, exitReach: 620, exitClimb: 150,
  },
  engine: {
    near: 260, far: 1100,
    /** A close second pitch beats against the first, the drone of props never quite in step. */
    layers: [
      { id: 'ac130_prop_loop', volume: 1.5, pitch: 1 },
      { id: 'ac130_prop_loop', volume: 0.8, pitch: 1.03 },
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
    walkIn: 9,
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
    /** Gently down out of the barrel and steep at the end. Any stronger and it would lob up out of a gun pointing down. */
    gravity: 14,
    /** It bursts this far over where it lands, so a wall beside the impact does not save the whole room behind it. */
    burstHeight: 5,
    gap: 2.7,
    spread: 5,
    damage: 620,
    radius: 12,
    /**
     * It never fires this close to the player: nothing would hurt, but nobody could see through it. Kept tight, because
     * enemies close on the player, and at 14 m the biggest gun was left shooting at stragglers.
     */
    noFire: 9,
    whistle: 2,
    retry: 1.5,
  },
  hellfire: {
    /** Seconds falling off the rail before the motor lights, and how hard it falls and then accelerates. */
    drop: 0.7, fall: 14, thrust: 208,
    speed: 130, turn: 3.4, damage: 1100, radius: 7, life: 9, whistle: 1.4, retry: 2,
    /** It steers for a point this many times its ground distance above the target, which folds the end of the flight into a dive. */
    topAttack: 2.2,
    /** It only meets the world this close to the target, by which point it is in the dive. */
    armWithin: 60,
  },
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
