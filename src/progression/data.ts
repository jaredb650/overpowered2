/**
 * Every number the progression system is tuned by. The ladder thresholds, durations and call-in timelines come from
 * docs/original (05 sections 12-15, 06 sections 7, 13, 14). Anything else is new for the sequel.
 */
import type { GradeName } from '../core/contracts';
import type { CallInId, PerkId, PickupKind, PowerupId, WeaponId } from '../core/gameplay';

export type EffectId = PerkId | PowerupId;

/** What a second trigger does while the effect already runs. */
export type Retrigger =
  /** Nothing. The counter keeps its kills, so the perk re-arms on the first kill after it ends. */
  | 'ignore'
  /** Back to full duration. */
  | 'refresh'
  /** One more stack, and back to full duration. All stacks fall together at expiry. */
  | 'stack';

export interface Moment {
  /** post.flash intensity, duration. */
  flash: readonly [number, number];
  /** post.chromatic amount, duration. */
  chromatic: readonly [number, number];
  /** post.radialBlur amount, duration. */
  blur: readonly [number, number];
  /** camera.fovPunch degrees, duration. */
  fov: readonly [number, number];
  trauma: number;
  hitStop?: number;
}

const MINOR: Moment = { flash: [0.28, 0.25], chromatic: [0.4, 0.3], blur: [0.12, 0.25], fov: [5, 0.3], trauma: 0.25 };
const MAJOR: Moment = { flash: [0.55, 0.35], chromatic: [0.8, 0.45], blur: [0.3, 0.4], fov: [9, 0.45], trauma: 0.45, hitStop: 0.05 };
const HUGE: Moment = { flash: [0.9, 0.5], chromatic: [1.2, 0.6], blur: [0.55, 0.55], fov: [14, 0.6], trauma: 0.7, hitStop: 0.08 };
const CAPSULE_MOMENT: Moment = { flash: [0.22, 0.2], chromatic: [0.3, 0.25], blur: [0.08, 0.2], fov: [3, 0.25], trauma: 0.12 };

export interface EffectDef {
  id: EffectId;
  /** Live countdown text on the HUD. */
  label: string;
  /** Screen label on activation. */
  banner: string;
  tagline: string;
  color: string;
  seconds: number;
  retrigger: Retrigger;
  maxStacks: number;
  grade: GradeName | null;
  /** Higher wins when several effects want the screen. */
  gradeRank: number;
  sound: string;
  moment: Moment;
}

const perk = (
  id: PerkId, label: string, banner: string, tagline: string, color: string, seconds: number,
  retrigger: Retrigger, grade: GradeName | null, gradeRank: number, moment: Moment, maxStacks = 1,
): EffectDef => ({ id, label, banner, tagline, color, seconds, retrigger, maxStacks, grade, gradeRank, moment, sound: `perk_${id}` });

const power = (
  id: PowerupId, label: string, tagline: string, color: string, seconds: number,
  grade: GradeName | null = null, gradeRank = 0,
): EffectDef => ({
  id, label, banner: label, tagline, color, seconds, retrigger: 'refresh', maxStacks: 1, grade, gradeRank, moment: CAPSULE_MOMENT, sound: `powerup_${id}`,
});

export const EFFECTS: Readonly<Record<EffectId, EffectDef>> = {
  bloodthirst: perk('bloodthirst', 'BLOOD THIRST', 'BLOOD THIRST', '2X DAMAGE // BOTTOMLESS', '#ff0000', 10, 'ignore', 'bloodthirst', 50, MINOR),
  hellfire: perk('hellfire', 'HELLFIRE', 'HELLFIRE', 'EVERYTHING EXPLODES', '#ff6600', 5, 'ignore', 'hellfire', 80, MAJOR),
  adrenaline: perk('adrenaline', 'ADRENALINE', 'ADRENALINE', 'FASTER', '#00ff00', 5, 'stack', 'adrenaline', 30, MINOR, 3),
  berserk: perk('berserk', 'BERSERK!', 'BERSERK', 'YOU CANNOT DIE', '#ff0000', 10, 'ignore', 'berserk', 90, HUGE),
  slowmo: perk('slowmo', 'SLOWMO', 'SLOWMO', 'THE WORLD CRAWLS', '#00ffff', 5, 'ignore', 'slowmo', 70, MAJOR),
  sentinels: perk('sentinels', 'SENTINELS', 'SENTINELS', 'THREE GUNS ON YOUR SIDE', '#7fd4ff', 20, 'refresh', null, 0, MAJOR),
  chainStorm: perk('chainStorm', 'CHAIN STORM', 'CHAIN STORM', 'EVERY KILL ARCS', '#8a7dff', 12, 'refresh', 'slowmo', 40, MAJOR),
  butcher: perk('butcher', 'BUTCHER', 'BUTCHER', 'EVERY HIT SEVERS', '#ff2f55', 8, 'refresh', 'bloodthirst', 45, MINOR),
  skyfall: perk('skyfall', 'SKYFALL', 'SKYFALL', 'UNLIMITED AIR DASH // SLAM DETONATES', '#49b6ff', 8, 'refresh', 'adrenaline', 35, MINOR),
  chainReaction: perk('chainReaction', 'CHAIN REACTION', 'CHAIN REACTION', 'THE DEAD DETONATE', '#ffb000', 6, 'refresh', 'hellfire', 55, MAJOR),
  overdrive: perk('overdrive', 'OVERDRIVE', 'OVERDRIVE', 'SPEED IS DAMAGE', '#ffe500', 10, 'refresh', 'overdrive', 60, HUGE),

  quad: power('quad', 'QUAD DAMAGE', '4X DAMAGE', '#4a7dff', 15),
  haste: power('haste', 'HASTE', '1.5X SPEED AND FIRE RATE', '#ffd400', 15),
  vampire: power('vampire', 'VAMPIRE', 'KILLS HEAL', '#c4122f', 15),
  ricochet: power('ricochet', 'RICOCHET', 'BULLETS BOUNCE', '#37e0a0', 15),
  shock: power('shock', 'SHOCK ROUNDS', 'BULLETS ARC', '#6df2ff', 15),
  ghost: power('ghost', 'GHOST', 'THEY LOSE YOU PAST 15 M', '#c6d2dc', 15),
  magnet: power('magnet', 'MAGNET', 'PICKUPS COME TO YOU', '#ff7ad9', 15),
  regen: power('regen', 'REGEN', 'HEALTH AND AMMO FLOOD BACK', '#58ff7a', 15),
  frostNova: power('frostNova', 'FROST NOVA', 'THE FROZEN SHATTER', '#9fe8ff', 0),
  timeWarp: power('timeWarp', 'TIME WARP', 'THE WORLD CRAWLS', '#e0b3ff', 5, 'slowmo', 65),
};

/** Stacking, in one place. Damage and speed multiply across effects, which is what lets a good run feel like cheating. */
export const STACK = {
  damage: { bloodthirst: 2, berserk: 5, quad: 4 },
  fireRate: { berserk: 3, haste: 1.5 },
  /** 12 pellets with Blood Thirst, 18 with Berserk, 36 with both, as in the first game. */
  pellets: { bloodthirst: 2, berserk: 3 },
  /** Added per stack on top of 1. The first game aimed at 10% and landed on 3%. */
  adrenalinePerStack: 0.15,
  speed: { berserk: 2, haste: 1.5 },
  /** Beyond this the controller's ground acceleration outruns collision substeps. */
  maxSpeed: 3.5,
  /** Hellfire rockets: 8 x 2.5 = 20 m, instakill. */
  hellfireBlast: 2.5,
  ricochetBounces: 3,
  /** Overdrive damage climbs from 1x at ground top speed to this at the air speed target. */
  overdriveMaxDamage: 3,
  overdriveFloorSpeed: 17,
  overdriveTopSpeed: 45,
} as const;

/** Tracer override priority while a perk runs. */
export const TRACER_ORDER = ['berserk', 'hellfire', 'bloodthirst'] as const;
/** Per-shot layers. Every active one plays on every trigger pull. */
export const SHOT_LAYERS: readonly (readonly [EffectId, string])[] = [
  ['bloodthirst', 'bloodthirsty_shot'],
  ['hellfire', 'hellfire_shot'],
  ['berserk', 'berserk_shot'],
];

// ---------------------------------------------------------------------------------------------
// Triggers
// ---------------------------------------------------------------------------------------------

export const COMBO_WINDOW = 5;

/** Sliding-window triggers. `clears` empties the window on activation, as the first game did for sword and headshots. */
export const WINDOWS = {
  bloodthirst: { need: 4, span: 5, clears: false },
  hellfire: { need: 10, span: 10, clears: false },
  adrenaline: { need: 3, span: 3, clears: true },
  slowmo: { need: 3, span: 3, clears: true },
  butcher: { need: 3, span: 2, clears: true },
  skyfall: { need: 3, span: 4, clears: true },
  overdrive: { need: 5, span: 10, clears: true },
} as const;

export const OVERDRIVE_MIN_SPEED = 25;
export const CHAIN_REACTION_KILLS = 3;

/**
 * Combo perks. Berserk no longer resets the combo, so each rung climbs by `rearm` after firing.
 * That keeps the first game's cadence of one Berserk per 15 kills.
 */
export const COMBO_PERKS: readonly { perk: PerkId; at: number; rearm: number }[] = [
  { perk: 'berserk', at: 15, rearm: 15 },
  { perk: 'sentinels', at: 20, rearm: 20 },
  { perk: 'chainStorm', at: 30, rearm: 30 },
];

export interface CallInDef {
  id: CallInId;
  /** Combo needed. The combo is not consumed, as in the first game. */
  combo: number;
  cooldown: number;
  name: string;
  key: string;
  color: string;
  /** True blast radius, shown by the targeting preview. */
  radius: number;
  hint: string;
  /** Viewmodel device while targeting. */
  device: 'walkie' | 'designator';
}

export const CALLINS: Readonly<Record<CallInId, CallInDef>> = {
  airstrike: {
    id: 'airstrike', combo: 8, cooldown: 30, name: 'AIRSTRIKE', key: 'X', color: '#ff6600', radius: 20,
    hint: 'CLICK TO CALL AIRSTRIKE // RMB CANCEL', device: 'walkie',
  },
  warthog: {
    id: 'warthog', combo: 12, cooldown: 45, name: 'WARTHOG', key: 'Z', color: '#00ff00', radius: 5,
    hint: 'CLICK FOR A GUN RUN, DRAG TO SET THE HEADING // RMB CANCEL', device: 'walkie',
  },
  orbital: {
    id: 'orbital', combo: 25, cooldown: 60, name: 'ORBITAL LANCE', key: 'V', color: '#ff2fb0', radius: 6,
    hint: 'CLICK TO FIRE, THEN STEER THE BEAM // RMB CANCEL', device: 'designator',
  },
  blackSun: {
    id: 'blackSun', combo: 40, cooldown: 90, name: 'BLACK SUN', key: 'B', color: '#a56bff', radius: 36,
    hint: 'CLICK TO OPEN THE SINGULARITY // RMB CANCEL', device: 'designator',
  },
  nuke: {
    id: 'nuke', combo: 50, cooldown: 180, name: 'TACTICAL NUKE', key: 'N', color: '#ffffff', radius: 90,
    hint: 'CLICK TO MARK GROUND ZERO // RMB CANCEL', device: 'designator',
  },
};

/** Original check order on one kill, extended upward. */
export const CALLIN_ORDER: readonly CallInId[] = ['airstrike', 'warthog', 'orbital', 'blackSun', 'nuke'];

// ---------------------------------------------------------------------------------------------
// Call-in timelines (seconds after the confirming click)
// ---------------------------------------------------------------------------------------------

export const AIRSTRIKE = {
  activateAt: 3,
  rocketsAt: 4,
  rockets: 15,
  rocketGap: 0.1,
  scatter: 12,
  rocketHeight: [30, 35],
  rocketSpeed: 50,
  rocketDamage: 100,
  rocketRadius: 6,
  rocketDrift: 0.05,
  /** Player takes this share of a rocket's blast, about 25-50 HP as in the first game. */
  rocketSelfDamage: 0.5,
  finaleAt: 6.5,
  finaleHeight: 35,
  finaleSpeed: 60,
  finaleRadius: 20,
  /** The first game's finale was lethal at 20 m while the ring showed 12. It only throws you now. */
  finalePlayerPush: 22,
  markerUntil: 7.3,
} as const;

export const WARTHOG = {
  activateAt: 2,
  shellsAt: 4,
  shells: 50,
  shellGap: 0.05,
  /** The map is nine times the first game's area, so the 40 m corridor grows with it. 1.2 m spacing against a 5 m blast. */
  length: 60,
  scatter: 1.5,
  spawnHeight: 50,
  spawnBack: 20,
  shellSpeed: 200,
  shellDamage: 150,
  shellRadius: 5,
  flybyAt: 6.5,
  markerUntil: 8.5,
  jetAltitude: 46,
  jetSpeed: 118,
  /** Overhead a little before the roar, the jet outruns its own sound. */
  jetOverheadAt: 6.0,
} as const;

export const ORBITAL = {
  chargeTime: 0.9,
  burnTime: 6,
  steerSpeed: 34,
  damagePerSecond: 420,
  tick: 0.1,
  coreRadius: 2.6,
  burnSeconds: 3,
  scorchSpacing: 2.2,
  height: 260,
} as const;

export const BLACK_SUN = {
  height: 7,
  growTime: 1,
  pullTime: 5.2,
  collapseTime: 0.55,
  pullRadius: 36,
  /** m/s of drag on the living at the rim, rising to `pullMax` at the centre. */
  pullMin: 3,
  pullMax: 30,
  /** m/s^2 on corpses and limbs. */
  bodyAccel: 75,
  crushRadius: 4.5,
  crushDamagePerSecond: 220,
  implodeRadius: 28,
  implodeImpulse: 260,
  playerTug: 16,
} as const;

export const NUKE = {
  sirenTime: 6,
  /** Metres per second of the shock front, so it crosses the Crucible in about three seconds. */
  frontSpeed: 150,
  maxRadius: 420,
  whiteoutSeconds: 3.2,
  skyHold: 45,
  skyFade: 25,
  cloudLife: 70,
  ragdollImpulse: 150,
  /** Everything ragdolls, but the crater keeps its heart. Inside this radius bodies are gibbed. */
  gibRadius: 40,
} as const;

// ---------------------------------------------------------------------------------------------
// Perks with world effects
// ---------------------------------------------------------------------------------------------

export const SENTINEL = {
  count: 3,
  orbitRadius: 2.4,
  orbitHeight: 0.5,
  orbitSpeed: 1.8,
  range: 55,
  damage: 30,
  /** Shots per second per drone. */
  fireRate: 6,
  scanRate: 6,
} as const;

export const CHAIN_STORM = {
  range: 16,
  arcs: 3,
  hops: 3,
  damage: 80,
  hopDelay: 0.07,
  maxPending: 24,
} as const;

export const CHAIN_REACTION = {
  radius: 7,
  damage: 150,
  delay: 0.09,
  maxPending: 12,
} as const;

export const SKYFALL = {
  baseRadius: 7,
  /** Extra radius per unit of slam impact, capped. */
  radiusPerImpact: 0.25,
  maxRadius: 16,
  damage: 220,
} as const;

// ---------------------------------------------------------------------------------------------
// Powerups and pickups
// ---------------------------------------------------------------------------------------------

export const POWERUPS: readonly PowerupId[] = [
  'quad', 'haste', 'vampire', 'ricochet', 'shock', 'ghost', 'magnet', 'regen', 'frostNova', 'timeWarp',
];

export const VAMPIRE_HEAL = 12;
export const REGEN = { healthPerSecond: 14, ammoPerSecond: 0.04, tick: 0.25 } as const;
export const FROST = { radius: 34, freezeSeconds: 7, frontSpeed: 60 } as const;
export const MEGA = { heal: 100, overhealFactor: 2, decayPerSecond: 2 } as const;

export const PICKUP = {
  dropChance: 0.3,
  /** Live drop cap. Oldest goes first. */
  maxDrops: 24,
  dropLife: 28,
  blinkAt: 5,
  collectRadius: 1.9,
  attractRadius: 5,
  attractSpeed: 15,
  magnetRadius: 45,
  magnetSpeed: 42,
  spinRate: 2,
  bobHeight: 0.3,
  bobRate: 3,
  hover: 1.1,
  health: 25,
  armor: 25,
  /** Reserve fraction per ammo pickup. */
  ammo: 0.25,
  grenades: 1,
  heavyArmor: 100,
  megaRespawn: 45,
  armorRespawn: 35,
  megaSpots: 3,
  armorSpots: 3,
  /** Ambient supply drip, as in the first game: every 10 s, 70%, only while few are around. */
  supplyEvery: 10,
  supplyChance: 0.7,
  supplyMaxLive: 3,
  supplyRange: 70,
} as const;

export const CAPSULE = {
  firstAt: 25,
  every: [32, 48],
  life: 30,
  maxLive: 3,
  /** Far enough that fetching one is a decision. */
  minDistance: 35,
} as const;

export const DROP_POD = {
  everyWaves: 2,
  height: 150,
  speed: 90,
  warnSeconds: 3,
  impactRadius: 7,
  impactDamage: 160,
  life: 90,
} as const;

/** Unlock order for caches. */
export const CACHE_ORDER: readonly WeaponId[] = ['judge', 'lance', 'buzzsaw', 'kiln', 'stakegun'];

export const WEAPON_NAMES: Readonly<Record<WeaponId, string>> = {
  smg: 'SMG', shotgun: 'SHOTGUN', rocket: 'ROCKET LAUNCHER', autocannon: 'AUTOCANNON', sword: 'SWORD',
  judge: 'THE JUDGE', lance: 'THE LANCE', buzzsaw: 'THE BUZZSAW', kiln: 'THE KILN', stakegun: 'STAKEGUN',
};

export const PICKUP_LOOK: Readonly<Record<PickupKind, { label: string; color: string }>> = {
  health: { label: 'HEALTH', color: '#33ff66' },
  ammo: { label: 'AMMO', color: '#ffd400' },
  armor: { label: 'ARMOR', color: '#4aa8ff' },
  megaHealth: { label: 'MEGA HEALTH', color: '#00ff99' },
  heavyArmor: { label: 'HEAVY ARMOR', color: '#2f7dff' },
  weaponCache: { label: 'WEAPON CACHE', color: '#ffffff' },
  quad: { label: 'QUAD DAMAGE', color: EFFECTS.quad.color },
  haste: { label: 'HASTE', color: EFFECTS.haste.color },
  vampire: { label: 'VAMPIRE', color: EFFECTS.vampire.color },
  ricochet: { label: 'RICOCHET', color: EFFECTS.ricochet.color },
  shock: { label: 'SHOCK ROUNDS', color: EFFECTS.shock.color },
  ghost: { label: 'GHOST', color: EFFECTS.ghost.color },
  magnet: { label: 'MAGNET', color: EFFECTS.magnet.color },
  regen: { label: 'REGEN', color: EFFECTS.regen.color },
  frostNova: { label: 'FROST NOVA', color: EFFECTS.frostNova.color },
  timeWarp: { label: 'TIME WARP', color: EFFECTS.timeWarp.color },
};

// ---------------------------------------------------------------------------------------------
// Score
// ---------------------------------------------------------------------------------------------

export const SCORE = {
  headshot: 50,
  finisherMultiplier: 2,
  /** Combo at which the score multiplier steps up. */
  comboTiers: [[0, 1], [5, 1.5], [10, 2], [15, 3], [25, 4], [40, 5]] as readonly (readonly [number, number])[],
  /** Horizontal m/s at which the speed multiplier steps up. Ground top speed earns nothing extra. */
  speedTiers: [[0, 1], [20, 1.25], [30, 1.5], [40, 2], [50, 3]] as readonly (readonly [number, number])[],
  multiKillGap: 1.2,
  pointBlank: 3,
  longShot: 45,
  blurSpeed: 30,
  closeCallHealth: 25,
  storageKey: 'op2_highscore',
} as const;

/** Index is the multi-kill count, capped at the last entry. */
export const MULTI_KILLS: readonly { label: string; bonus: number }[] = [
  { label: '', bonus: 0 },
  { label: '', bonus: 0 },
  { label: 'DOUBLE KILL', bonus: 100 },
  { label: 'TRIPLE KILL', bonus: 200 },
  { label: 'MULTI KILL', bonus: 300 },
  { label: 'MEGA KILL', bonus: 450 },
  { label: 'ULTRA KILL', bonus: 600 },
  { label: 'MONSTER KILL', bonus: 800 },
  { label: 'RAMPAGE', bonus: 1000 },
];

export const STYLE = {
  dismember: { label: 'LIMB SHOT', bonus: 25 },
  sliced: { label: 'SLICED', bonus: 75 },
  gibbed: { label: 'PASTED', bonus: 25 },
  airborne: { label: 'AIRBORNE', bonus: 50 },
  slide: { label: 'SLIDE KILL', bonus: 50 },
  wallRun: { label: 'WALL RUN', bonus: 75 },
  pointBlank: { label: 'POINT BLANK', bonus: 50 },
  longShot: { label: 'LONG SHOT', bonus: 75 },
  blur: { label: 'BLUR', bonus: 50 },
  environment: { label: 'ENVIRONMENTAL', bonus: 100 },
  shatter: { label: 'SHATTERED', bonus: 75 },
  closeCall: { label: 'CLOSE CALL', bonus: 100 },
} as const;

export const STYLE_COLOR = '#ffd400';
export const HEADSHOT_COLOR = '#ffff00';
