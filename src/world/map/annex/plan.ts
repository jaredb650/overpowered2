/**
 * The Retraining Annex (docs/design/tutorial.md): every number, so the map (index.ts) and the mission
 * (campaign/missions/retraining.ts) read one source. No three.js here. x east, y up, z south; the route runs north, along -z.
 *
 *   Intake           z 15..0     the clone bay; the voluntary exit behind the spawn
 *   Parkour hall     z 0..-132   duct, vault, slide slot, mantle, dash gap, wall-run pit, chimney, slam pit, rocket ledge
 *   Gallery          z -133..-200  the lane, hollow points, the armoured man, the supply pod, grenades, the stim
 *   Blade room       z -201..-226
 *   Quiet room       z -228..-270  lights out, sonar, Gun Kata
 *   Yard             z -271..-334  outdoors: surrender, questioning, release, capture
 *   Balcony and town z -334..-404  the nuke
 */

/** Hall walls: tall enough that the chimney is the only way up. */
export const WALL = 20;
export const PIT = -4;
/** Raised floors in the parkour hall. */
export const DECK = 2.8;
export const CHIMNEY_TOP = 14.8;
export const LEDGE = 7;
/** Low enough, and with a glass parapet, that the whole town is in view from the rail. */
export const BALCONY = 6;

export const BOUNDS = { x0: -50, x1: 50, z0: -410, z1: 24 } as const;

export const INTAKE = { x0: -7, x1: 7, z0: 0, z1: 14, h: 4.2, door: 1.6 } as const;
/** The dark corridor behind the exit door, and the white panel at its end. */
export const EXIT = { x0: -1.6, x1: 1.6, z0: 14, z1: 22 } as const;

/** The parkour hall, x -8..8. Each obstacle's z span, north being more negative. */
export const HALL = { x0: -8, x1: 8 } as const;
export const DUCT = { z0: -12, z1: -6, gap: 1.2 } as const;
export const VAULT = { z0: -18.8, z1: -18, h: 1 } as const;
export const SLOT = { z0: -34, z1: -26, gap: 1.15 } as const;
/** The mantle wall, whose top is the dash take-off. */
export const MANTLE = { z0: -46, z1: -40 } as const;
/** Jump and double jump cross 14 m: this needs a dash. */
export const DASH_PIT = { z0: -62, z1: -46 } as const;
export const DASH_LAND = { z0: -68, z1: -62 } as const;
/** Wider than a jump, double jump and two dashes (23.8 m): this needs a wall run. */
export const WALL_PIT = { z0: -94, z1: -68 } as const;
export const WALL_LAND = { z0: -100, z1: -94 } as const;
/** A 2.4 m shaft between two blocks, 12 m up from the deck. */
export const CHIMNEY = { x0: -1.2, x1: 1.2, z0: -103, z1: -100, side: 1.8, back: 3 } as const;
export const SLAM_PIT = { z0: -124, z1: -106, cx: 0, cz: -115 } as const;
/** Out of reach of every move but a blast: no-climb faces. */
export const ROCKET_LEDGE = { z0: -132, z1: -126 } as const;
/** On the ledge, a tower seven metres higher still, no-climb: the Jump Jet's. */
export const JET_TOWER = { x0: -8, x1: -3.6, z0: -131, z1: -127, h: 7 } as const;

export const GALLERY = { x0: -12, x1: 12, z0: -200, z1: -133, landing: -137, foot: -151 } as const;
export const BLADE = { x0: -10, x1: 10, z0: -226, z1: -201 } as const;
export const QUIET = { x0: -14, x1: 14, z0: -270, z1: -227 } as const;
export const YARD = { x0: -30, x1: 30, z0: -334, z1: -271 } as const;
/** The shed where the hidden squad waits: walls, no roof, so the drone can lift a man out of it. */
export const SHED = { x0: 14, x1: 24, z0: -324, z1: -314, h: 3 } as const;
export const STAND = { x0: -10, x1: 10, z0: -342, z1: -334 } as const;
export const TOWN = { x0: -46, x1: 46, z0: -404, z1: -346, cx: 0, cz: -372 } as const;

/** The balcony's stairs come up off the middle, so the blast throws the contractor into the back wall rather than down them. */
export const STAIRS_X = -6;

/** Where each door between stations stands: on the floor, travelling north. */
export const DOORS = {
  hall: { x: 0, y: 0, z: 0, w: 4 },
  gallery: { x: 0, y: LEDGE, z: -132.5, w: 4 },
  blade: { x: 0, y: 0, z: -200.5, w: 4 },
  quiet: { x: 0, y: 0, z: -226.5, w: 4 },
  yard: { x: 0, y: 0, z: -270.5, w: 5 },
} as const;

/** Shacks in the town, x, z, yaw. */
export const SHACKS: readonly (readonly [number, number, number])[] = [
  [-24, -356, 0.2], [-9, -360, -0.1], [9, -358, 0.15], [24, -362, -0.25],
  [-30, -374, 0.1], [-14, -378, -0.2], [14, -376, 0.3], [30, -372, -0.1],
  [-20, -392, 0.25], [0, -388, 0], [20, -394, -0.2],
];
