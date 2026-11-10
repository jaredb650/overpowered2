/**
 * Every number of key 5: how far each blade and club reaches, the swings it has, what it does to a body. Tune here;
 * `Melee.ts` reads this and nothing else. The row in WEAPONS holds what every weapon has (damage, force, draw), this
 * holds what only a swung one has. The katana's specials, its guard, charged sweep and finisher blast, are `SWORD` in
 * ../data.ts, apart from the reach of its sweep, which is here.
 *
 * Reach is meters from the eye to the nearest surface of a body, with the swing's own step in it, so a 2.2 m reach and a
 * 0.8 m step cut a body whose front is 3 m away. A body is an upright capsule; see sweep.ts for what a swing touches.
 */
import type { DamageType, DecalKind } from '../../core/contracts';
import type { SwordMove, WeaponId } from '../../core/gameplay';
import { SWORD, type ShapedCharge } from '../data';

/**
 * `?blade=old` puts the katana back as it was before reach was measured: a 5 m cone of 120 degrees from the eye, a lunge
 * from 10 m on every swing whether the player is moving or not, and an 8 m charged sweep. The four new weapons do not
 * change with it.
 */
export const BLADE_OLD = typeof location !== 'undefined' && new URLSearchParams(location.search).get('blade') === 'old';

export type MeleeId = 'sword' | 'knife' | 'crowbar' | 'shovel' | 'baton';

export interface MeleeSwing {
  /** The viewmodel clip this swing plays. Each model reads `light1`..`light3` and `heavy` as its own. */
  move: SwordMove;
  seconds: number;
  /**
   * Share of the swing before the blow lands, for the wind-up of a heavy one. Unset is 0: on the frame of the click, as
   * the katana's always have. The model's clip winds up over the same share (viewmodels/models/melee.ts).
   */
  impact?: number;
  /** Multiplies the row's damage. */
  mult: number;
  /** Which way the blade crosses the screen, x right and y up. The swing's plane holds it and the crosshair. */
  sweep: readonly [number, number];
  /** Meters from the eye to a body's surface, standing still. The step adds to it. */
  reach: number;
  /** Radians the blade covers in its plane, centred on the crosshair. A thrust's cone, full angle. */
  arc: number;
  /** Half thickness of the slab it sweeps, meters. */
  width: number;
  /** Straight out along the crosshair, not across it. */
  thrust?: boolean;
  /** What this swing does in place of the weapon's own: the spade's edge is a cut, its face a blow. */
  type?: DamageType;
  /** Newton-seconds, in place of the row's `force`. */
  force?: number;
  /** In place of the row's `severMult`. 0 takes no limb, whatever the row says. */
  sever?: number;
  /** Throws a body it kills along the swing as a blast would throw it: the strength of `Physics.radialImpulse`. */
  fling?: number;
  shake: number;
  /** Hit-stop on a hit, and on a kill. */
  hitStop: number;
  killStop: number;
  /** Camera kick, pitch, yaw, roll. */
  kick: readonly [number, number, number];
  fov: number;
  /** The swing's own sound and pitch, on a hit or a miss. */
  sound: string;
  pitch?: number;
}

export interface MeleeDef {
  /** Left click. Held, it chains; a press during a swing waits for the next. */
  chain: readonly MeleeSwing[];
  /** Right click, for a weapon with no guard. */
  heavy?: MeleeSwing;
  /** Seconds after a swing starts that the next click still continues the chain. */
  comboWindow: number;
  /** Share of a swing during which anything crossing it is still struck. */
  liveFraction: number;
  /** Meters the body steps in, at `stepSpeed`, for a body just past reach. Part of the reach, not a dash. */
  step: number;
  stepSpeed: number;
  /** A body whose surface is this close and not behind the eye is struck by any swing. */
  pointBlank: number;
  type: DamageType;
  /** False: a hit on the head counts as the chest, as a sword cut always has. True: a head hit is a head hit. */
  heads: boolean;
  /** A kill is split on the swing's plane (the katana). */
  slices: boolean;
  /** A kill on the head with a cutting swing takes it off at the neck (the spade's edge). */
  beheads?: boolean;
  /** Against a body with a plate left: multiplies the hit and goes through the plates, as a shaped charge's direct hit. */
  armour?: ShapedCharge;
  /** Multiplies a hit on a body that cannot defend itself: struck from behind, staggering, falling, on the floor or getting up. */
  bonus?: {
    mult: number;
    /** Cos of how far round behind it the strike must come from. 0.3 is a back and both flanks behind the shoulders. */
    behind: number;
  };
  /** Sounds on contact: on flesh, on a machine, on a plate, on a wall. */
  flesh: string;
  machine: string;
  armourSound: string;
  wall: string;
  wallDecal: DecalKind;
  /** Sparks on a wall, a plate or a machine. */
  sparks: number;
}

/** The katana's dash: its own move, out of a run at a target ahead. Standing still, the sword only steps. */
export interface DashDef {
  /** Meters from the eye to the target's middle. */
  range: number;
  /** Speed along the crosshair the player must be moving at, m/s. A run is 12.5. */
  from: number;
  /** Cos of the cone a target must be in. */
  cone: number;
  speed: number;
  seconds: number;
  /** Degrees of FOV the dash punches, so it reads as a different move. */
  fov: number;
}

const SWORD_FEEL = { sound: 'sword_swing' } as const;

/** The three swings of the katana keep their first-game timing and damage from SWORD.chain; only the reach is new. */
const katana: MeleeDef = {
  chain: SWORD.chain.map((s, i) => ({
    ...SWORD_FEEL,
    move: s.move, seconds: s.seconds, mult: s.mult, sweep: s.sweep, shake: s.shake, hitStop: s.hitStop, killStop: s.killStop,
    kick: s.kick, fov: s.fov,
    // A blade of 0.86 m on an arm's length, and a step: 2.8 to 3 m to the front of a body, the long flat third the most.
    reach: [2.0, 2.1, 2.2][i]!, arc: [2.0, 2.1, 2.5][i]!, width: 0.5,
  })),
  comboWindow: SWORD.comboWindow,
  liveFraction: SWORD.liveFraction,
  step: 0.8, stepSpeed: 9,
  pointBlank: 0.55,
  type: 'slash', heads: false, slices: true,
  flesh: 'sword_contact', machine: 'impact_metal', armourSound: 'impact_armor', wall: 'sword_hit2', wallDecal: 'slash', sparks: 12,
};

export const MELEE: Record<MeleeId, MeleeDef> = {
  sword: katana,

  // Fast and short. Everything about it is the opening: a back turned, a man reeling or on the floor takes three times
  // the hit, and the thrust from behind ends nearly anything.
  knife: {
    chain: [
      { move: 'light1', seconds: 0.17, mult: 1, sweep: [-1, -0.25], reach: 1.6, arc: 1.7, width: 0.35, shake: 0.006, hitStop: 0.02, killStop: 0.035, kick: [-0.004, 0.006, 0.004], fov: 0, sound: 'knife_swing' },
      { move: 'light2', seconds: 0.18, mult: 1.1, sweep: [1, -0.15], reach: 1.6, arc: 1.7, width: 0.35, shake: 0.006, hitStop: 0.02, killStop: 0.035, kick: [-0.003, -0.006, -0.004], fov: 0, sound: 'knife_swing', pitch: 1.08 },
    ],
    heavy: {
      move: 'heavy', seconds: 0.3, impact: 0.12, mult: 2.4, sweep: [0, -1], reach: 1.8, arc: 0.5, width: 0.3, thrust: true,
      shake: 0.012, hitStop: 0.04, killStop: 0.07, kick: [0.01, 0, 0], fov: -1.2, sound: 'knife_swing', pitch: 0.82,
    },
    comboWindow: 0.45, liveFraction: 0.6,
    step: 0.6, stepSpeed: 9,
    pointBlank: 0.5,
    type: 'slash', heads: false, slices: false,
    bonus: { mult: 3, behind: 0.3 },
    flesh: 'knife_flesh', machine: 'impact_metal', armourSound: 'impact_armor', wall: 'impact_metal', wallDecal: 'slash', sparks: 6,
  },

  // Slow enough to mean it. It breaks the arm or leg it lands on: its 60 a blow is gore's break point for a man-sized limb
  // (`WoundTuning.breakAt`), and a blunt hit takes no limb off. It puts a body on its heels or the floor, and goes through
  // plate as if it were not there, for half again the blow.
  crowbar: {
    chain: [
      { move: 'light1', seconds: 0.4, impact: 0.08, mult: 1, sweep: [-1, -0.35], reach: 1.9, arc: 1.9, width: 0.4, shake: 0.018, hitStop: 0.045, killStop: 0.07, kick: [-0.008, 0.016, 0.01], fov: 0.4, sound: 'club_swing' },
      { move: 'light2', seconds: 0.44, impact: 0.08, mult: 1.1, sweep: [1, -0.25], reach: 1.9, arc: 1.9, width: 0.4, shake: 0.02, hitStop: 0.05, killStop: 0.075, kick: [-0.008, -0.016, -0.01], fov: 0.4, sound: 'club_swing', pitch: 0.94 },
    ],
    heavy: {
      move: 'heavy', seconds: 0.62, impact: 0.38, mult: 1.75, sweep: [-0.15, -1], reach: 2.0, arc: 2.0, width: 0.35, force: 190,
      shake: 0.04, hitStop: 0.07, killStop: 0.1, kick: [-0.03, 0, 0.008], fov: 1.6, sound: 'club_swing', pitch: 0.8,
    },
    comboWindow: 0.75, liveFraction: 0.55,
    step: 0.7, stepSpeed: 8,
    pointBlank: 0.5,
    type: 'melee', heads: true, slices: false,
    armour: { direct: 1.5, splash: 1, most: Infinity },
    flesh: 'club_hit', machine: 'impact_metal', armourSound: 'club_plate', wall: 'impact_metal', wallDecal: 'crack', sparks: 14,
  },

  // Slow, wide and heavy. The face is a blow that throws what it kills; the edge, on right click, is a cut that takes a
  // head off at the neck.
  shovel: {
    chain: [
      { move: 'light1', seconds: 0.58, impact: 0.2, mult: 1, sweep: [-1, 0.05], reach: 2.3, arc: 2.6, width: 0.55, sever: 0, fling: 120, shake: 0.03, hitStop: 0.06, killStop: 0.09, kick: [-0.006, 0.03, 0.02], fov: 1.2, sound: 'spade_swing' },
      { move: 'light2', seconds: 0.62, impact: 0.2, mult: 1.1, sweep: [1, 0.05], reach: 2.3, arc: 2.6, width: 0.55, sever: 0, fling: 120, shake: 0.03, hitStop: 0.06, killStop: 0.09, kick: [-0.006, -0.03, -0.02], fov: 1.2, sound: 'spade_swing', pitch: 0.94 },
    ],
    heavy: {
      move: 'heavy', seconds: 0.72, impact: 0.4, mult: 1.6, sweep: [0.15, -1], reach: 2.3, arc: 1.8, width: 0.35, type: 'slash', force: 140,
      shake: 0.05, hitStop: 0.08, killStop: 0.12, kick: [-0.04, 0, 0.006], fov: 2, sound: 'spade_swing', pitch: 0.85,
    },
    comboWindow: 0.95, liveFraction: 0.5,
    step: 0.7, stepSpeed: 7,
    pointBlank: 0.55,
    type: 'melee', heads: true, slices: false, beheads: true,
    flesh: 'spade_flat', machine: 'spade_flat', armourSound: 'spade_flat', wall: 'spade_wall', wallDecal: 'crack', sparks: 18,
  },

  // Light and quick. It barely hurts: it knocks people down. Two body blows inside a second put a man on the floor, and
  // one to the head floors him on its own (src/enemies/reactions.ts, from the push, not the damage).
  baton: {
    chain: [
      { move: 'light1', seconds: 0.23, mult: 1, sweep: [-1, -0.45], reach: 1.8, arc: 1.8, width: 0.4, shake: 0.008, hitStop: 0.03, killStop: 0.05, kick: [-0.005, 0.01, 0.008], fov: 0, sound: 'club_swing', pitch: 1.25 },
      { move: 'light2', seconds: 0.23, mult: 1, sweep: [1, -0.35], reach: 1.8, arc: 1.8, width: 0.4, shake: 0.008, hitStop: 0.03, killStop: 0.05, kick: [-0.005, -0.01, -0.008], fov: 0, sound: 'club_swing', pitch: 1.32 },
      { move: 'light3', seconds: 0.3, mult: 1.3, sweep: [-0.2, -1], reach: 1.8, arc: 1.9, width: 0.35, force: 120, shake: 0.014, hitStop: 0.045, killStop: 0.06, kick: [-0.016, 0, 0.004], fov: 0.6, sound: 'club_swing', pitch: 1.15 },
    ],
    heavy: {
      move: 'heavy', seconds: 0.36, impact: 0.1, mult: 1.2, sweep: [0, -1], reach: 1.9, arc: 0.6, width: 0.3, thrust: true, force: 150,
      shake: 0.016, hitStop: 0.05, killStop: 0.06, kick: [0.012, 0, 0], fov: -1, sound: 'club_swing', pitch: 1.1,
    },
    comboWindow: 0.5, liveFraction: 0.6,
    step: 0.6, stepSpeed: 8,
    pointBlank: 0.5,
    type: 'melee', heads: true, slices: false,
    flesh: 'baton_hit', machine: 'impact_metal', armourSound: 'impact_armor', wall: 'impact_metal', wallDecal: 'crack', sparks: 6,
  },
};

/** The katana's dash and its charged sweep. Specials, with their own reach, apart from the swings above. */
export const KATANA = {
  dash: { range: 7, from: 7, cone: 0.93, speed: 30, seconds: 0.15, fov: 5 } as DashDef,
  /** The charged sweep (`SWORD.area`), flat and wide: a long step into a full extension. */
  area: { reach: 3.2, arc: (160 * Math.PI) / 180, width: 0.6 },
};

/** Which of the weapon ids are swung. */
export function isMelee(id: WeaponId | string): id is MeleeId {
  return id === 'sword' || id === 'knife' || id === 'crowbar' || id === 'shovel' || id === 'baton';
}

/**
 * Radians any swing reaches down below the crosshair for a body wholly under its slab: a Skitter at the feet, a man on the
 * floor. 0.8 meets a Skitter's back half a meter out at a level look. sweep.ts `dip`. Its reach does not grow with it.
 */
export const REACH_DOWN = 0.8;
/** A body on the floor is this tall to a swing, not its standing height. */
export const DOWNED_HEIGHT = 0.6;

/** A body's radius for the swing test, from its row when it has one: a nav radius is a little wider than the body. */
export const BODY_RADIUS = { fallback: 0.35, share: 0.85, least: 0.25, most: 0.9 } as const;
