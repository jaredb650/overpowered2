/**
 * Every number the gunship is tuned by, in seconds, metres and enemy hit points. Its place on the ladder is in
 * ../data.ts with the others.
 */

import type { SeatPlan } from '../../vehicles/seat';

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
  /**
   * Fire control, the player's seat. The eye is the sensor ball under the nose, dead-locked on the ground (lock 1) so
   * the circle never drags the sight off its spot. Its clock is the time on station, which the strike writes.
   */
  seat: {
    label: 'SPECTRE // FIRE CONTROL',
    tone: 'gunship',
    seconds: 120,
    fov: 40,
    zoomFov: 15,
    aimZooms: true,
    arcCenter: Math.PI / 2,
    arcHalf: 1.15,
    pitchMin: -1.45,
    pitchMax: -0.3,
    lock: 1,
    roll: 0.2,
    eye: [0, 0, 0],
    reach: 900,
    outside: true,
    grade: null,
    enemyColor: '#ff6a30',
    grace: 2.5,
    shake: 0.35,
  } as SeatPlan,
  /**
   * Every gun has a magazine and its own crew reloading it, on its own clock, whichever gun is on the trigger. Ammunition
   * is unlimited: only magazines and reloads hold a gun back. `interval` is the least time between two shots of one gun.
   * `speed` is m/s, so a round from 245 m away is in the air for a second or more and a moving man has to be led.
   */
  gatling: {
    magazine: 120, reload: 4, interval: 1 / 18, speed: 190,
    /** Radians of cone on the player's stream. */
    spread: 0.0035,
    damage: 55,
    radius: 2.6,
    /** The crew's bursts, and the pause between them. */
    burst: [1.6, 2.8] as const,
    gap: 2.4,
    /** m/s the crew's aim walks. It starts short of the target, on the aircraft's side, so the stream is seen to walk on. */
    walkSpeed: 11,
    walkIn: 9,
    scatter: 1.1,
    /** With nobody in the box the crew rakes it anyway after this long, so the AI never goes dead. */
    reconAfter: 7,
    retry: 0.8,
  },
  bofors: {
    magazine: 12, reload: 4.5, interval: 0.32, speed: 130, spread: 0.002,
    /** The crew's string: shells in it, metres apart across the line of fire, scatter, and the pause after. */
    shells: 6, spacing: 3.4, scatter: 0.8, gap: 4.5, retry: 1,
    /** Bursts on the first surface: clears a rooftop. */
    he: { damage: 170, radius: 5 },
    /** Goes on through up to `walls` roofs and walls no thicker than `wall` metres each, and bursts small where it stops. */
    ap: { damage: 320, radius: 2.8, walls: 3, wall: 1.6, beyond: 30 },
    /**
     * Bursts `fuze` metres short of the first enemy or surface on its line and throws `pellets` heavy pellets forward in
     * a cone of `cone` radians, reaching `reach`: a giant shotgun for men behind low cover. The crew picks it for a knot
     * of `knot` or more in the open.
     */
    flak: { fuze: 2.5, damage: 60, radius: 2.5, pellets: 14, pelletDamage: 75, cone: 0.32, reach: 24, knot: 3 },
  },
  howitzer: {
    magazine: 2, reload: 7, interval: 1.6,
    /** Seconds in the air. Slow enough to watch one fall, and to get a whistle in. */
    flight: 4.6,
    /** Gently down out of the barrel and steep at the end. Any stronger and it would lob up out of a gun pointing down. */
    gravity: 14,
    /** It bursts this far over where it lands, so a wall beside the impact does not save the whole room behind it. */
    burstHeight: 5,
    /** The crew's scatter, and the pause after a magazine. */
    spread: 5,
    gap: 6,
    damage: 620,
    radius: 12,
    /**
     * The crew never fires it this close to the player: nothing would hurt, but nobody could see through it. Kept tight,
     * because enemies close on the player, and at 14 m the biggest gun was left shooting at stragglers.
     */
    noFire: 9,
    whistle: 2,
    retry: 1.5,
    /**
     * White phosphorus: a smaller blast, then a white cloud `cloud` metres across that burns for `seconds`. Anyone in it
     * is set alight for `burn` seconds, as by the Burner's fire. Never the player.
     */
    wp: { damage: 200, radius: 6, cloud: 8, seconds: 14, burn: 5, puffEvery: 0.2, streamers: 10 },
  },
  /**
   * One per sortie. The ramp takes `bay` seconds to open, the bomb falls free for `fall`, then glides at `speed` and
   * turns onto the laser at `turn`, all the way down. One of the biggest blasts in the game: the airstrike's finale is
   * 20 m, the nuke is the map.
   */
  bomb: {
    bay: 2.6, fall: 1, gravity: 9.8, speed: 55, turn: 2.6, life: 18, armWithin: 70,
    radius: 28, damage: 6000, shake: 1.6, whistle: 3,
    /** The crew drops it on a boss, or on a knot this big, once it has been on station this long. */
    after: 25, knot: 5,
  },
  /** Missile hits that bring it down and flares aboard (`antiAir.ts`). Bullets cannot hurt it. */
  armour: { hits: 3, flares: 3 },
  /**
   * Shot down: it noses over and falls from the circle, carried in toward its centre so it comes down on the map. See
   * crash.ts. `inward` and `along` are the m/s it starts the fall with, toward the centre and along the circle.
   */
  crash: { gravity: 9, spin: 0.5, spinUp: 0.4, pitchRate: 0.3, pitch: 0.8, belly: 3, radius: 16, damage: 900, wreck: 12, scale: 2.2, inward: 26, along: 22 },
  /** Thrown on arrival and on leaving, and by `Ac130.popFlares`. */
  flares: { pairs: 8, gap: 0.16, speed: 15, gravity: 9, drag: 0.55, life: 3.4 },
  /** Enemies within this of each other count as one target for the heavy guns. */
  clusterRadius: 8,
  /** Seconds left on station, and what the crew says about it. */
  countdown: [[60, 'SIXTY SECONDS ON STATION.'], [30, 'THIRTY SECONDS. BINGO FUEL.'], [10, 'TEN SECONDS. LAST ROUNDS.']] as const,
  /** Kills inside this window earn a line from the crew, at most this often. */
  praise: { kills: 3, window: 1.6, every: 11 },
} as const;
