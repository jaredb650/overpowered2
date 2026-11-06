/**
 * Every number that makes a weapon feel like itself. Tune here; the code reads this and nothing else.
 *
 * Shake values are the first game's `addScreenShake` intensities (docs/original/03 section 10), kept in those
 * units because the 60x spread between an SMG shot and a Hellfire rocket is the feel worth protecting.
 * Feel.shake converts them to camera trauma.
 */
import type { ExplosionKind, MuzzleKind, SurfaceKind, TracerKind } from '../core/contracts';
import type { SwordMove, WeaponId } from '../core/gameplay';

export type FireMode = 'auto' | 'semi' | 'charge' | 'spin' | 'stream' | 'melee';
export type CasingKind = 'pistol' | 'rifle' | 'shotgun' | 'cannon';

/** Ids come from docs/notes/audio.md. Levels are balanced there, so `volume` is only for gameplay scaling. */
export interface SoundLayer {
  id: string;
  volume?: number;
  pitch?: number;
  pitchJitter?: number;
}

/** A foley sample at a fraction of the reload. */
export type ReloadCue = readonly [at: number, id: string];

export interface WeaponDef {
  id: WeaponId;
  name: string;
  /** The number key. Sits in `weapon<slot>` of the input actions. */
  slot: number;
  mode: FireMode;
  magSize: number;
  /** Rounds in reserve at the start of a run or when unlocked. */
  reserve: number;
  maxReserve: number;
  reloadTime: number;
  drawTime: number;
  /** Seconds between shots. */
  interval: number;
  damage: number;
  pellets: number;
  /** Half-angle of the cone, radians. */
  spread: number;
  /** Multiplier on limb damage. */
  severMult: number;
  /** Push on ragdolls and severed parts, in newton-seconds per hit. 0 takes the default for bullets. A body is about 85 kg. */
  force: number;
  headshotMult: number;
  muzzle: MuzzleKind;
  tracer: TracerKind;
  casing: CasingKind | null;
  sounds: readonly SoundLayer[];
  reloadFoley: readonly ReloadCue[];
  drawSound: string;
  /** Viewmodel recoil strength passed to viewmodel.fire. */
  recoil: number;
  /** Camera kick in radians. Springs back, so aim stays true. */
  kick: number;
  /** First-game shake intensity. */
  shake: number;
  fovPunch: number;
}

const MAG_RELOAD: readonly ReloadCue[] = [[0.05, 'reload_mag_out'], [0.55, 'reload_mag_in'], [0.82, 'reload_bolt']];

const BASE = {
  pellets: 1, spread: 0, severMult: 1, force: 0, headshotMult: 2, casing: null, fovPunch: 0,
  reloadFoley: MAG_RELOAD, drawSound: 'weapon_draw',
} as const;

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  smg: {
    ...BASE, id: 'smg', name: 'SMG', slot: 1, mode: 'auto',
    magSize: 30, reserve: 360, maxReserve: 720, reloadTime: 1.0, drawTime: 0.16,
    interval: 0.05, damage: 25,
    muzzle: 'smg', tracer: 'bullet', casing: 'pistol',
    sounds: [{ id: 'smg_fire', pitchJitter: 0.03 }],
    reloadFoley: [[0.02, 'smg_reload']],
    recoil: 1, kick: 0.0016, shake: 0.004,
  },
  shotgun: {
    ...BASE, id: 'shotgun', name: 'SHOTGUN', slot: 2, mode: 'semi',
    magSize: 6, reserve: 36, maxReserve: 72, reloadTime: 1.25, drawTime: 0.2,
    interval: 0.3, damage: 20, pellets: 6, spread: 0.05, severMult: 2.4, force: 30,
    muzzle: 'shotgun', tracer: 'bullet', casing: 'shotgun',
    sounds: [{ id: 'shotgun_fire', pitchJitter: 0.04 }],
    reloadFoley: [[0.1, 'reload_shell_in'], [0.32, 'reload_shell_in'], [0.54, 'reload_shell_in'], [0.86, 'reload_pump']],
    recoil: 1, kick: 0.014, shake: 0.02, fovPunch: 1.6,
  },
  rocket: {
    ...BASE, id: 'rocket', name: 'ROCKET', slot: 3, mode: 'semi',
    magSize: 1, reserve: 10, maxReserve: 20, reloadTime: 1.5, drawTime: 0.26,
    interval: 0.5, damage: 100, force: 90,
    muzzle: 'rocket', tracer: 'heavy',
    sounds: [{ id: 'rocket_fire', pitchJitter: 0.03 }],
    reloadFoley: [[0.15, 'reload_rocket'], [0.8, 'reload_bolt']], drawSound: 'weapon_draw_heavy',
    recoil: 1, kick: 0.022, shake: 0.04, fovPunch: 2.2,
  },
  autocannon: {
    ...BASE, id: 'autocannon', name: 'AUTOCANNON', slot: 4, mode: 'semi',
    magSize: 5, reserve: 20, maxReserve: 40, reloadTime: 1.0, drawTime: 0.28,
    interval: 0.15, damage: 99999, force: 90,
    muzzle: 'autocannon', tracer: 'heavy', casing: 'cannon',
    sounds: [{ id: 'autocannon_shot' }],
    drawSound: 'weapon_draw_heavy',
    recoil: 1, kick: 0.03, shake: 0.03, fovPunch: 3,
  },
  sword: {
    ...BASE, id: 'sword', name: 'SWORD', slot: 5, mode: 'melee',
    magSize: 0, reserve: 0, maxReserve: 0, reloadTime: 0, drawTime: 0.14,
    interval: 0.25, damage: 75, severMult: 3.5, force: 60,
    muzzle: 'smg', tracer: 'bullet',
    sounds: [], reloadFoley: [], drawSound: 'weapon_draw_blade',
    recoil: 0, kick: 0, shake: 0.01,
  },
  judge: {
    ...BASE, id: 'judge', name: 'JUDGE', slot: 6, mode: 'semi',
    magSize: 6, reserve: 30, maxReserve: 60, reloadTime: 1.5, drawTime: 0.22,
    interval: 0.42, damage: 120, severMult: 1.6, force: 40, headshotMult: 2.5,
    muzzle: 'revolver', tracer: 'heavy', casing: null,
    sounds: [{ id: 'revolver_fire', pitchJitter: 0.02 }],
    reloadFoley: [[0.04, 'revolver_open'], [0.34, 'revolver_load'], [0.74, 'revolver_close'], [0.9, 'revolver_cock']],
    recoil: 1, kick: 0.03, shake: 0.03, fovPunch: 2.4,
  },
  lance: {
    ...BASE, id: 'lance', name: 'LANCE', slot: 7, mode: 'charge',
    magSize: 4, reserve: 16, maxReserve: 32, reloadTime: 1.7, drawTime: 0.3,
    interval: 0.35, damage: 420, severMult: 1000, force: 120, headshotMult: 2,
    muzzle: 'railgun', tracer: 'rail',
    sounds: [{ id: 'railgun_fire' }, { id: 'railgun_beam' }],
    reloadFoley: [[0.12, 'reload_cell'], [0.78, 'reload_bolt']], drawSound: 'weapon_draw_heavy',
    recoil: 1, kick: 0.05, shake: 0.06, fovPunch: 5,
  },
  buzzsaw: {
    ...BASE, id: 'buzzsaw', name: 'BUZZSAW', slot: 8, mode: 'spin',
    magSize: 200, reserve: 400, maxReserve: 800, reloadTime: 2.2, drawTime: 0.34,
    interval: 0.02, damage: 13, spread: 0.008, severMult: 2.2, force: 6,
    muzzle: 'minigun', tracer: 'bullet', casing: 'rifle',
    sounds: [],
    drawSound: 'weapon_draw_heavy',
    recoil: 0.5, kick: 0.0009, shake: 0.0035,
  },
  kiln: {
    ...BASE, id: 'kiln', name: 'KILN', slot: 9, mode: 'stream',
    magSize: 150, reserve: 300, maxReserve: 600, reloadTime: 1.8, drawTime: 0.26,
    interval: 1 / 30, damage: 9, severMult: 0, force: 1, headshotMult: 1,
    muzzle: 'flame', tracer: 'bullet',
    sounds: [],
    reloadFoley: [[0.1, 'reload_cell'], [0.72, 'reload_bolt']], drawSound: 'weapon_draw_heavy',
    recoil: 0.14, kick: 0, shake: 0.0015,
  },
  stakegun: {
    ...BASE, id: 'stakegun', name: 'STAKEGUN', slot: 0, mode: 'semi',
    magSize: 5, reserve: 20, maxReserve: 40, reloadTime: 1.6, drawTime: 0.24,
    interval: 0.55, damage: 140, severMult: 2.6, force: 110,
    muzzle: 'rifle', tracer: 'heavy',
    sounds: [{ id: 'stake_fire', pitchJitter: 0.03 }],
    reloadFoley: [[0.1, 'stake_reload'], [0.84, 'reload_bolt']],
    recoil: 1, kick: 0.024, shake: 0.024, fovPunch: 1.4,
  },
};

export const WEAPON_ORDER: readonly WeaponId[] = [
  'smg', 'shotgun', 'rocket', 'autocannon', 'sword', 'judge', 'lance', 'buzzsaw', 'kiln', 'stakegun',
];
export const STARTING_WEAPONS: readonly WeaponId[] = ['smg', 'shotgun', 'rocket', 'autocannon', 'sword'];

/** Per-weapon behaviour that does not fit every row of the table. */
export const TUNING = {
  /** Newton-seconds on the struck bone per point of a blast's radial strength. Most of the throw is the radial itself. */
  blastForce: 1.5,
  /** A press stays live this long, so semi-auto weapons fire on the first legal frame. */
  pressBuffer: 0.14,
  /** Delay before an empty magazine starts reloading by itself. */
  autoReloadDelay: 0.14,

  /**
   * The guns can run dry, the player cannot. A gun that empties hands over to the next loaded one, sword kills feed the
   * gun you last held, and every wave break lifts each reserve to a floor. Drops stay the main income.
   */
  ammo: {
    /** Long enough to hear the dry click before the hands move. */
    swapDelay: 0.2,
    /** Which gun takes over, first with ammo wins. Rockets come last: a dry player is usually in close. */
    fallback: ['buzzsaw', 'smg', 'shotgun', 'judge', 'stakegun', 'kiln', 'autocannon', 'lance', 'rocket', 'sword'] as readonly WeaponId[],
    /** Magazines paid into the last-held gun per sword kill. */
    swordKillMags: 0.5,
    /** Fraction of max reserve every owned gun is lifted to when a wave clears. */
    waveFloor: 0.2,
  },
  rocket: { speed: 40, radius: 8, selfDamage: 0.14, playerPush: 27 },
  autocannon: {
    speed: 200, radius: 5, bossDamage: 900,
    scopeFov: 30, zoomRate: 16,
    /** Zoom past which the viewmodel is hidden and the scope overlay reads as up. */
    scopeShowAt: 0.6,
  },
  hellfireRounds: { radius: 2, damageMult: 1.25 },
  shotgun: {
    /** Under this range pellets count as point-blank: more sever, more push. */
    pointBlank: 6, pointBlankSever: 3, pointBlankForce: 3.2,
  },
  judge: { ricochetRange: 28, ricochets: 2, ricochetDamage: 0.8 },
  lance: {
    chargeTime: 0.85,
    /** Below this the trigger release is a fizzle, not a shot. */
    minCharge: 0.22,
    minDamage: 90,
    /** Fully charged shots punch through this much solid. */
    penetration: 1.6,
    maxTargets: 24,
    /** A full charge splits this many bodies along the beam. Each costs about 5 ms, so a long line ends in ragdolls. */
    cleave: 3,
  },
  buzzsaw: {
    spinUp: 0.55, spinDown: 0.85,
    /** Below this spin the barrels turn but nothing leaves them. */
    fireAt: 0.8,
    /** The fire rate climbs from this fraction of full over the rest of the spin. */
    minRate: 0.45,
    /** Ground speed cap while the barrels turn, as a fraction of MOVE.runSpeed. */
    moveSpeed: 0.62,
    /** Air and slide speed bleeds much more gently: momentum still belongs to the player. */
    airDrag: 0.6,
  },
  kiln: {
    speed: 26, life: 0.5, drag: 1.6, startRadius: 0.16, endRadius: 1.05,
    burnSeconds: 4,
  },
  stake: {
    speed: 120, gravity: 7, stuckSeconds: 24, maxStuck: 40,
    /** Gore drags a pinned bone at 26 m/s for 0.3 s. Past that it would hang off the wall on nothing. */
    pinReach: 7.5,
  },
  grenade: {
    fuse: 2.6, throwSpeed: 25, throwUp: 6.5, inherit: 0.75, gravity: -22, restitution: 0.42, friction: 0.72,
    radius: 7, damage: 190, start: 3, max: 6, cookSound: 0.8,
  },
} as const;

// ---------------------------------------------------------------------------------------------
// Sword
// ---------------------------------------------------------------------------------------------

export interface SwingDef {
  move: SwordMove;
  seconds: number;
  /** Damage multiplier on the base 75. */
  mult: number;
  /** Direction the blade travels across the screen, in camera axes (x right, y up). The cut plane contains it. */
  sweep: readonly [number, number];
  shake: number;
  /** Hit-stop for connecting and for killing. */
  hitStop: number;
  killStop: number;
  kick: readonly [number, number, number];
  /** Extra layered sound on the swing itself, on a hit or not. */
  extra: string | null;
  /** Extra forward reach bought by the longer swings. */
  fov: number;
}

export const SWORD = {
  reach: 5,
  /** Half-arc in radians. 120 degrees total as in the first game. */
  halfArc: Math.PI / 3,
  /** Start-to-start, as in the first game. */
  comboWindow: 0.7,
  /** Clicks and RMB presses stay live this long while a swing plays. */
  buffer: 0.22,
  /** Fraction of the swing during which anything crossing the arc still gets cut. */
  liveFraction: 0.65,
  chain: [
    { move: 'light1', seconds: 0.25, mult: 1, sweep: [-0.3, -1], shake: 0.01, hitStop: 0.03, killStop: 0.05, kick: [-0.012, 0, 0.006], extra: null, fov: 0 },
    { move: 'light2', seconds: 0.3, mult: 1.25, sweep: [0.8, 0.6], shake: 0.012, hitStop: 0.035, killStop: 0.06, kick: [0.01, 0.012, -0.012], extra: null, fov: 0.6 },
    { move: 'light3', seconds: 0.35, mult: 1.5, sweep: [-1, 0.06], shake: 0.016, hitStop: 0.05, killStop: 0.085, kick: [-0.006, -0.03, 0.02], extra: 'sword_hit2', fov: 1.6 },
  ] as readonly SwingDef[],
  lunge: {
    /** Targets out to here pull the player in. */
    range: 10,
    /** Cos of the lock-on cone. */
    cone: 0.9,
    /** A short dash: the player's own is 34 m/s for 0.14 s. This covers the gap from the edge of `range` to sword reach. */
    speed: 30,
    seconds: 0.16,
    /** Leaves this much gap in front of the target. */
    stopShort: 1.5,
  },
  windup: {
    full: 0.3,
    /** A tap is still an area attack, but a weak one. */
    tapPower: 0.55,
    /** The press that starts blocking parries for this long. */
    parryWindow: 0.24,
    /** Cos of the block cone. */
    cone: 0.35,
    parryDamage: 3,
  },
  area: {
    seconds: 0.4, damage: 100, reach: 8, halfArc: (80 * Math.PI) / 180, shake: 0.15,
    hitStop: 0.07, killStop: 0.1, force: 110,
  },
  finisher: {
    seconds: 0.35, delay: 0.2, damage: 250, radius: 8, ahead: 3, shake: 0.15, hitStop: 0.12, force: 150,
  },
  quickMelee: { recover: 0.1 },
} as const;

// ---------------------------------------------------------------------------------------------
// Explosions
// ---------------------------------------------------------------------------------------------

export interface ExplosionDef {
  /** First-game shake intensity at the blast. */
  shake: number;
  /** Shake fades to nothing this far outside the blast radius. */
  shakeRange: number;
  sounds: readonly SoundLayer[];
  /** Damage at the edge as a fraction of the centre. The first game's 0.5. */
  edgeDamage: number;
  /** Fraction of damage reaching the player from their own blast. */
  selfDamage: number;
  /** Absolute cap on self-damage, so a huge strike cannot one-shot its caller. */
  selfCap: number;
  /** Player launch speed at the centre, when the spec does not set one. */
  playerPush: number;
  /** Radial strength per metre of radius. Newton-seconds on each body of a chain: about 0.13 m/s on a whole body per point. */
  impulse: number;
  /** Damage dealt to enemies by an enemy-team blast of this kind. */
  friendlyFire: number;
  /** Fraction of the radius in which a lethal hit gibs instead of ragdolling. */
  gibZone: number;
  /** Skips line-of-sight checks. */
  ignoresCover: boolean;
  /** Near-player post effects. */
  flash: number;
  fovPunch: number;
}

const BLAST: ExplosionDef = {
  shake: 0.06, shakeRange: 34, sounds: [{ id: 'rocket_explosion', pitchJitter: 0.05 }],
  edgeDamage: 0.5, selfDamage: 0.5, selfCap: 60, playerPush: 12, impulse: 7, friendlyFire: 0.5, gibZone: 0.45, ignoresCover: false, flash: 0.16, fovPunch: 2.4,
};

export const EXPLOSIONS: Record<ExplosionKind, ExplosionDef> = {
  rocket: { ...BLAST, selfDamage: TUNING.rocket.selfDamage, selfCap: 16, playerPush: TUNING.rocket.playerPush },
  grenade: {
    ...BLAST, shake: 0.07, selfDamage: 0.45, selfCap: 70, playerPush: 18, gibZone: 0.4,
    sounds: [{ id: 'grenade_explode', pitchJitter: 0.05 }],
  },
  hellfire: {
    ...BLAST, shake: 0.24, shakeRange: 70, gibZone: 0.8, selfDamage: 0.14, selfCap: 20, playerPush: 34, impulse: 9,
    sounds: [{ id: 'hellfire_rocket_blast' }], flash: 0.4, fovPunch: 7,
  },
  hellfireBullet: {
    ...BLAST, shake: 0.012, shakeRange: 16, gibZone: 0.3, selfDamage: 0, selfCap: 0, playerPush: 0, impulse: 5,
    sounds: [{ id: 'hellfirebullet_explode', volume: 0.6, pitchJitter: 0.08 }], flash: 0, fovPunch: 0,
  },
  shell: {
    ...BLAST, shake: 0.03, shakeRange: 30, selfDamage: 0, selfCap: 0, playerPush: 8, impulse: 5, gibZone: 0.5,
    sounds: [{ id: '30mmshell_explode', pitchJitter: 0.04 }], flash: 0.1, fovPunch: 1.2,
  },
  plasma: {
    ...BLAST, shake: 0.03, shakeRange: 22, selfDamage: 0.3, selfCap: 30, playerPush: 10, impulse: 5,
    sounds: [{ id: 'explosion_small', pitch: 1.2 }], flash: 0.08, fovPunch: 1,
  },
  enemy: { ...BLAST, selfDamage: 1, selfCap: 999, playerPush: 16, flash: 0.2 },
  barrel: {
    ...BLAST, shake: 0.09, shakeRange: 40, selfDamage: 0.6, selfCap: 80, playerPush: 22, gibZone: 0.5,
    sounds: [{ id: 'explosion_barrel', pitchJitter: 0.06 }, { id: 'explosion_debris' }],
  },
  finisher: {
    ...BLAST, shake: 0.15, shakeRange: 30, selfDamage: 0, selfCap: 0, playerPush: 0, gibZone: 0.55, impulse: 8,
    sounds: [{ id: 'rocket_explosion' }], flash: 0, fovPunch: 3.5,
  },
  nuke: {
    ...BLAST, shake: 0.5, shakeRange: 400, edgeDamage: 1, selfDamage: 0, selfCap: 0, playerPush: 0, gibZone: 1,
    impulse: 12, sounds: [{ id: 'nuke_blast' }], ignoresCover: true, flash: 1, fovPunch: 12,
  },
};

/** Spelled out so a hit never builds a string. */
export const SURFACE_SOUND: Record<SurfaceKind, string> = {
  concrete: 'impact_concrete', metal: 'impact_metal', grate: 'impact_grate', dirt: 'impact_dirt', glass: 'impact_glass',
  flesh: 'impact_flesh', armor: 'impact_armor', energy: 'impact_energy', lava: 'impact_lava',
};

/** Hit-stop by event, seconds of frozen world. Tiny on purpose: 30 ms reads as a punch, 100 ms as a stumble. */
export const HIT_STOP = {
  /** The accidental one-frame freeze from the first game's non-lethal headshot, now on every headshot. */
  headshot: 0,
  headshotKill: 0.025,
  /** A limb coming off a target that lives. Buzzsaw shredding leans on minGap to stay a rhythm. */
  sever: 0,
  shotgunKill: 0.03,
  shotgunPointBlank: 0.045,
  heavyKill: 0.05,
  judgeHeadshot: 0.075,
  stakeKill: 0.05,
  lanceKill: 0.05,
  lancePerExtraKill: 0.018,
  lanceMax: 0.14,
  explosionNear: 0.04,
  explosionKills: 0.012,
  explosionMax: 0.09,
  parry: 0.09,
  /** Shortest gap between two stops, so an SMG burst does not turn into a stutter. */
  minGap: 0.09,
} as const;
