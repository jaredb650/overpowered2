/**
 * Every number that makes a weapon feel like itself. Tune here; the code reads this and nothing else.
 *
 * Shake values are the first game's `addScreenShake` intensities (docs/original/03 section 10), kept in those
 * units because the 60x spread between an SMG shot and a Hellfire rocket is the feel worth protecting.
 * Feel.shake converts them to camera trauma.
 */
import type { ExplosionKind, MuzzleKind, SurfaceKind, TracerKind } from '../core/contracts';
import type { BurstSpec, SwordMove, WeaponId } from '../core/gameplay';

/** `paint` is the Quiver's: hold to mark targets, let go to fire the salvo at them. Its numbers are `TUNING.quiver`. */
export type FireMode = 'auto' | 'semi' | 'charge' | 'spin' | 'stream' | 'melee' | 'paint';
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
  /**
   * The number key. Sits in `weapon<slot>` of the input actions. Weapons that share a slot are one family: pressing the key
   * again steps to the next member, in the order of the rows below. See families.ts.
   */
  slot: number;
  /** The weapon this one comes with: owned whenever its base is. Unset for a weapon that is unlocked by itself. */
  base?: WeaponId;
  /** How the trigger works, and with it which code fires the gun. A second member of a family is whatever its row says here. */
  mode: FireMode;
  /** What leaves the barrel, for a gun that does not fire a hitscan round. Unset is hitscan. */
  round?: 'rocket' | 'shell' | 'stake';
  magSize: number;
  /** Rounds in reserve at the start of a run or when unlocked. */
  reserve: number;
  maxReserve: number;
  reloadTime: number;
  drawTime: number;
  /** Seconds between shots. On a `paint` gun, between the missiles of a salvo. */
  interval: number;
  damage: number;
  pellets: number;
  /** Half-angle of the cone, radians. */
  spread: number;
  /** Multiplier on limb damage. */
  severMult: number;
  /** Can its rounds take a limb off? False wears no limb at all, whatever `severMult` says. The Always Sever perk overrides it. */
  canSever: boolean;
  /**
   * Penetration budget in meters of concrete, 0 for a round that stops at the first thing it meets. Walls cost their
   * thickness times PENETRATION.surface, bodies cost `bodyCost`. Hitscan rounds only: a projectile sets its own on the spec.
   */
  penetration: number;
  /** Budget one body costs this round. Unset takes PENETRATION.body. */
  bodyCost?: number;
  /** Goes through armour plates as if they were not there. */
  armorPiercing?: boolean;
  /** Damage holds to `from` meters, then falls in a line to `floor` of itself at `to`. Unset: full damage at any range. */
  falloff?: { readonly from: number; readonly to: number; readonly floor: number };
  /** After a headshot the round jumps to this many more heads, as the Judge's does. */
  headHops?: number;
  /** Right click raises the scope, as on the autocannon. */
  scope?: boolean;
  /** Hit-stop on a kill, seconds. */
  killStop?: number;
  /**
   * Real climb: radians each shot moves the aim itself, up and at random to either side, for the player to pull back down.
   * Unlike `kick`, it does not spring back. `?climb=0` takes it out.
   */
  climb?: { readonly pitch: number; readonly yaw: number };
  /**
   * Each round goes off where it lands: a flash, a crack and fragments inside `radius`. Not an explosion, and nothing like
   * the autocannon's: see src/weapons/burst.ts. `?burst=0` takes it out.
   */
  burst?: BurstSpec;
  /** Chance that a kill by one of its rounds bursts the body, 0 to 1. Unset, a kill leaves a body as any bullet's does. */
  gib?: number;
  /**
   * Ground speed while it fires, as a share of run speed: a gun too heavy to run with. Unset does not slow the player.
   * How it comes on and what it leaves alone is src/weapons/handling.ts. `?slow=0` takes it out.
   */
  slow?: number;
  /** Multiplies impact effects and decals on the world. */
  impactScale?: number;
  /** Push on ragdolls and severed parts, in newton-seconds per hit. 0 takes the default for bullets. A body is about 85 kg. */
  force: number;
  headshotMult: number;
  muzzle: MuzzleKind;
  tracer: TracerKind;
  casing: CasingKind | null;
  sounds: readonly SoundLayer[];
  reloadFoley: readonly ReloadCue[];
  /** Sounds after each shot, at seconds after it, for a gun that is cycled by hand between shots. */
  cycleFoley?: readonly ReloadCue[];
  drawSound: string;
  /** Viewmodel recoil strength passed to viewmodel.fire. */
  recoil: number;
  /** Camera kick in radians. Springs back, so aim stays true. */
  kick: number;
  /** First-game shake intensity. */
  shake: number;
  fovPunch: number;
}

/** Same number as HIT_STOP.heavyKill, which is declared after the table that needs it. */
const HEAVY_KILL_STOP = 0.05;

const MAG_RELOAD: readonly ReloadCue[] = [[0.05, 'reload_mag_out'], [0.55, 'reload_mag_in'], [0.82, 'reload_bolt']];

const BASE = {
  pellets: 1, spread: 0, severMult: 1, canSever: true, penetration: 0, force: 0, headshotMult: 2, casing: null, fovPunch: 0,
  reloadFoley: MAG_RELOAD, drawSound: 'weapon_draw',
} as const;

/**
 * `?slot4=old` puts key 4 back as the families stream left it: the explosive autocannon first and from the start, the Sabot
 * beside it and owned with it, and no autocannon in a weapon cache. `?families=0` implies it, so that switch still gives
 * the game from before families: key 4 is the explosive autocannon alone, from the start.
 */
export const SLOT4_OLD = typeof location !== 'undefined' && (() => {
  const q = new URLSearchParams(location.search);
  return q.get('slot4') === 'old' || q.get('families') === '0';
})();

/**
 * `?lance=old` puts the Lance back as it was: one charge with a fizzle on a tap, four cells, 420 damage, no plasma ball and
 * no bursts. The code that fires it is src/weapons/lance.ts when this is off, and `Weapons.updateCharge` when it is on.
 */
export const LANCE_OLD = typeof location !== 'undefined' && new URLSearchParams(location.search).get('lance') === 'old';

/**
 * `?slot8=old` puts key 8 back as it was: the BUZZSAW by name and by its numbers (50 light rounds a second, no bursts, the
 * old spin and slowdown), in its old model, and no PILEDRIVER beside it. The sounds stay the new ones.
 */
export const SLOT8_OLD = typeof location !== 'undefined' && new URLSearchParams(location.search).get('slot8') === 'old';

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  smg: {
    ...BASE, id: 'smg', name: 'SMG', slot: 1, mode: 'auto',
    magSize: 30, reserve: 360, maxReserve: 720, reloadTime: 1.0, drawTime: 0.16,
    // 800 rounds a minute.
    interval: 0.075, damage: 25,
    // A short barrel: past this it is the Harrow's work. `?reach=0` takes range out of every gun.
    falloff: { from: 35, to: 80, floor: 0.5 },
    muzzle: 'smg', tracer: 'bullet', casing: 'pistol',
    sounds: [{ id: 'smg_shot', pitchJitter: 0.03 }],
    reloadFoley: [[0.02, 'smg_reload']],
    recoil: 1, kick: 0.0016, shake: 0.004,
  },
  // The SMG's big brother: 500 rounds a minute to its 800, twice the round, and all of it at any range. It goes through one body, or a
  // sheet of cover, and takes limbs.
  harrow: {
    ...BASE, id: 'harrow', name: 'HARROW', slot: 1, base: 'smg', mode: 'auto',
    magSize: 24, reserve: 144, maxReserve: 288, reloadTime: 1.35, drawTime: 0.22,
    interval: 0.12, damage: 50, severMult: 1.8, canSever: true, force: 14, headshotMult: 2,
    penetration: 0.5,
    muzzle: 'carbine', tracer: 'carbine', casing: 'rifle',
    sounds: [{ id: 'harrow_shot', pitchJitter: 0.03 }],
    recoil: 1, kick: 0.0058, shake: 0.01, fovPunch: 0.5, impactScale: 1.25,
  },
  shotgun: {
    ...BASE, id: 'shotgun', name: 'SHOTGUN', slot: 2, mode: 'semi',
    magSize: 6, reserve: 36, maxReserve: 72, reloadTime: 1.25, drawTime: 0.2,
    interval: 0.3, damage: 20, pellets: 6, spread: 0.05, severMult: 2.4, force: 18,
    muzzle: 'shotgun', tracer: 'bullet', casing: 'shotgun',
    sounds: [{ id: 'pump_shotgun_shot', pitchJitter: 0.04 }],
    // On the viewmodel's pump (shotgun.ts clip): back by 0.15 s after the shot, home again by 0.27 s.
    cycleFoley: [[0.14, 'pump_rack_back'], [0.26, 'pump_rack_forward']],
    reloadFoley: [[0.1, 'reload_shell_in'], [0.32, 'reload_shell_in'], [0.54, 'reload_shell_in'], [0.86, 'reload_pump']],
    recoil: 1, kick: 0.014, shake: 0.02, fovPunch: 1.6,
  },
  // The shotgun that does not stop: a drum of twenty, five a second. Fewer pellets a shell than the pump, so the pump stays
  // the one hard hit, and a climb that walks the barrel up a burst for the player to hold down. `force` 16 is the least that
  // clears BLAST.pointBlankForce (100) at point blank, so a trunk kill up close can tear a body in two as the pump's does.
  thresher: {
    ...BASE, id: 'thresher', name: 'THRESHER', slot: 2, base: 'shotgun', mode: 'auto',
    magSize: 20, reserve: 60, maxReserve: 120, reloadTime: 2.7, drawTime: 0.28,
    interval: 0.2, damage: 20, pellets: 4, spread: 0.062, severMult: 2.4, force: 16,
    muzzle: 'shotgun', tracer: 'bullet', casing: 'shotgun',
    sounds: [{ id: 'auto_shotgun_shot', pitchJitter: 0.04 }],
    reloadFoley: [[0.04, 'drum_out'], [0.52, 'drum_in'], [0.84, 'reload_bolt']], drawSound: 'weapon_draw_heavy',
    recoil: 0.85, kick: 0.011, shake: 0.016, fovPunch: 1.1,
    climb: { pitch: 0.011, yaw: 0.0035 },
  },
  rocket: {
    ...BASE, id: 'rocket', name: 'ROCKET', slot: 3, mode: 'semi', round: 'rocket',
    magSize: 1, reserve: 10, maxReserve: 20, reloadTime: 1.5, drawTime: 0.26,
    interval: 0.5, damage: 100, force: 90,
    muzzle: 'rocket', tracer: 'heavy',
    sounds: [{ id: 'rocket_fire', pitchJitter: 0.03 }],
    reloadFoley: [[0.15, 'reload_rocket'], [0.8, 'reload_bolt']], drawSound: 'weapon_draw_heavy',
    recoil: 1, kick: 0.022, shake: 0.04, fovPunch: 2.2,
  },
  // Four tubes in a block. Hold to paint up to four marks, let go and they leave one tube after another and home on them.
  // Each is a small ROCKET: the same blast rules for the player, a third of the reach. How it flies is TUNING.quiver.
  quiver: {
    ...BASE, id: 'quiver', name: 'QUIVER', slot: 3, base: 'rocket', mode: 'paint', round: 'rocket',
    magSize: 4, reserve: 16, maxReserve: 32, reloadTime: 2.8, drawTime: 0.32,
    interval: 0.1, damage: 110, force: 70,
    muzzle: 'quiver', tracer: 'heavy',
    sounds: [{ id: 'quiver_fire', pitchJitter: 0.05 }],
    reloadFoley: [[0.06, 'reload_mag_out'], [0.24, 'quiver_load'], [0.4, 'quiver_load'], [0.56, 'quiver_load'], [0.72, 'quiver_load'], [0.88, 'reload_bolt']],
    drawSound: 'weapon_draw_heavy',
    recoil: 0.6, kick: 0.012, shake: 0.022, fovPunch: 1,
  },
  // First on the key: the cannon loaded with darts. No blast, so the round goes on through walls and everyone in line.
  sabot: {
    ...BASE, id: 'sabot', name: 'SABOT', slot: 4, mode: 'semi',
    magSize: 5, reserve: 15, maxReserve: 30, reloadTime: 1.0, drawTime: 0.28,
    interval: 0.45, damage: 600, severMult: 6, force: 140, headshotMult: 2,
    penetration: 5, bodyCost: 0.12, armorPiercing: true,
    muzzle: 'sabot', tracer: 'sabot', casing: 'cannon',
    sounds: [{ id: 'sabot_shot', pitchJitter: 0.02 }],
    drawSound: 'weapon_draw_heavy', scope: true,
    recoil: 1.1, kick: 0.034, shake: 0.034, fovPunch: 3.4, killStop: HEAVY_KILL_STOP, impactScale: 2.2,
  },
  // The upgrade on key 4: the same cannon with its high-explosive belt. Not owned with the Sabot: a weapon cache brings it
  // (CACHE_ORDER in progression), so it has no `base`.
  autocannon: {
    ...BASE, id: 'autocannon', name: 'AUTOCANNON', slot: 4, mode: 'semi', round: 'shell',
    magSize: 5, reserve: 20, maxReserve: 40, reloadTime: 1.0, drawTime: 0.28,
    interval: 0.15, damage: 99999, force: 90,
    muzzle: 'autocannon', tracer: 'heavy', casing: 'cannon',
    sounds: [{ id: 'autocannon_blast' }],
    drawSound: 'weapon_draw_heavy', scope: true,
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
  // Key 5's family. Swings, reach and what each does to a body are MELEE in melee/data.ts; these rows are what every weapon
  // has. `force` is the blow's push in N·s, which is what src/enemies/reactions.ts staggers and floors a body by.
  knife: {
    ...BASE, id: 'knife', name: 'SHIV', slot: 5, base: 'sword', mode: 'melee',
    magSize: 0, reserve: 0, maxReserve: 0, reloadTime: 0, drawTime: 0.08,
    interval: 0.17, damage: 32, canSever: false, force: 25,
    muzzle: 'smg', tracer: 'bullet',
    sounds: [], reloadFoley: [], drawSound: 'weapon_draw_blade',
    recoil: 0, kick: 0, shake: 0.006,
  },
  crowbar: {
    ...BASE, id: 'crowbar', name: 'PRYBAR', slot: 5, base: 'sword', mode: 'melee',
    magSize: 0, reserve: 0, maxReserve: 0, reloadTime: 0, drawTime: 0.2,
    interval: 0.4, damage: 60, canSever: false, force: 110, headshotMult: 1.5,
    muzzle: 'smg', tracer: 'bullet',
    sounds: [], reloadFoley: [], drawSound: 'weapon_draw_heavy',
    recoil: 0, kick: 0, shake: 0.018,
  },
  shovel: {
    ...BASE, id: 'shovel', name: 'SPADE', slot: 5, base: 'sword', mode: 'melee',
    magSize: 0, reserve: 0, maxReserve: 0, reloadTime: 0, drawTime: 0.3,
    interval: 0.58, damage: 60, severMult: 1.2, canSever: true, force: 300, headshotMult: 1.5,
    muzzle: 'smg', tracer: 'bullet',
    sounds: [], reloadFoley: [], drawSound: 'weapon_draw_heavy',
    recoil: 0, kick: 0, shake: 0.03,
  },
  baton: {
    ...BASE, id: 'baton', name: 'COSH', slot: 5, base: 'sword', mode: 'melee',
    magSize: 0, reserve: 0, maxReserve: 0, reloadTime: 0, drawTime: 0.12,
    interval: 0.23, damage: 10, canSever: false, force: 95, headshotMult: 1.5,
    muzzle: 'smg', tracer: 'bullet',
    sounds: [], reloadFoley: [], drawSound: 'weapon_draw',
    recoil: 0, kick: 0, shake: 0.008,
  },
  judge: {
    ...BASE, id: 'judge', name: 'JUDGE', slot: 6, mode: 'semi',
    magSize: 6, reserve: 30, maxReserve: 60, reloadTime: 1.5, drawTime: 0.22,
    interval: 0.42, damage: 120, severMult: 1.6, force: 40, headshotMult: 2.5,
    headHops: 2, killStop: HEAVY_KILL_STOP, impactScale: 1.6,
    muzzle: 'revolver', tracer: 'heavy', casing: null,
    sounds: [{ id: 'revolver_shot', pitchJitter: 0.02 }],
    reloadFoley: [[0.04, 'revolver_open'], [0.34, 'revolver_load'], [0.74, 'revolver_close'], [0.9, 'revolver_cock']],
    recoil: 1, kick: 0.03, shake: 0.03, fovPunch: 2.4,
  },
  // The Judge is six slow verdicts. This is fifteen quick ones: out first, as fast as the finger, and nothing at long range.
  rivet: {
    ...BASE, id: 'rivet', name: 'RIVET', slot: 6, base: 'judge', mode: 'semi',
    magSize: 15, reserve: 90, maxReserve: 180, reloadTime: 0.8, drawTime: 0.1,
    interval: 0.105, damage: 30, canSever: false, force: 5, headshotMult: 3,
    falloff: { from: 25, to: 55, floor: 0.5 },
    muzzle: 'pistol', tracer: 'pistol', casing: 'pistol',
    sounds: [{ id: 'pistol_shot', pitchJitter: 0.04 }],
    reloadFoley: [[0.05, 'reload_mag_out'], [0.5, 'reload_mag_in'], [0.82, 'reload_bolt']],
    recoil: 1, kick: 0.0062, shake: 0.006, fovPunch: 0.3,
  },
  // A tap is a plasma ball, a hold is a beam: how it charges, what each stage fires and the bursts a beam leaves are
  // TUNING.lance. The cell holds twelve: a ball takes one, a beam two, a full beam three. `interval` is between balls,
  // and `damage`, `kick`, `shake` and `fovPunch` are the full beam's.
  lance: {
    ...BASE, id: 'lance', name: 'LANCE', slot: 7, mode: 'charge',
    magSize: 12, reserve: 48, maxReserve: 96, reloadTime: 1.7, drawTime: 0.3,
    interval: 0.24, damage: 1000, severMult: 1000, force: 120, headshotMult: 2,
    muzzle: 'railgun', tracer: 'rail',
    sounds: [{ id: 'railgun_fire' }, { id: 'railgun_beam' }],
    reloadFoley: [[0.12, 'reload_cell'], [0.78, 'reload_bolt']], drawSound: 'weapon_draw_heavy',
    recoil: 1.3, kick: 0.075, shake: 0.14, fovPunch: 7,
  },
  // The 20 mm rotary cannon. Big rounds, twenty-five a second once the barrels are turning, each one going off where it
  // lands (`burst`: a flash, a crack and fragments inside half a metre, never a blast). It goes through nothing. `force` 34
  // is over the 30 a body can die on its feet under, so what it kills is knocked down. Spin-up, the climb of its rate and
  // the slowdown while spun are TUNING.buzzsaw; `slow` is while it fires. The id is the old name's: saves, caches and the
  // Commander know the gun by it.
  buzzsaw: {
    ...BASE, id: 'buzzsaw', name: 'TROMMEL', slot: 8, mode: 'spin',
    magSize: 120, reserve: 240, maxReserve: 360, reloadTime: 2.4, drawTime: 0.38,
    interval: 0.04, damage: 32, spread: 0.012, severMult: 2.6, force: 34,
    burst: { radius: 0.45, damage: 10 }, slow: 0.5, impactScale: 1.5,
    muzzle: 'rotary', tracer: 'heavy', casing: 'cannon',
    sounds: [],
    drawSound: 'weapon_draw_heavy',
    recoil: 1, kick: 0.0042, shake: 0.03, fovPunch: 0.35,
  },
  // The heavy machine gun beside it: a third of the rate and three times the round. It goes through walls and everyone in
  // line on the penetration budget (2.4 m: an inner wall and the men behind it), takes off any limb it touches, and a kill
  // can burst the body (`gib`). It kicks, it climbs, and it slows the player less than the cannon. Owned with the cannon.
  // 90 at `severMult` 5 is 450 a round on a corpse, over the 420 a waist lasts (GoreTuning.corpseTrunkHealth): one round
  // cuts a dead body in two and the next bursts a half. `force` is 48 and not more: measured at 38, 48 and 85, what a round
  // throws is the pieces it cut, as far at 38 as at 85, so the number is set by what it does to the living, which is to
  // stagger a Brute with its second round and not with every one.
  piledriver: {
    ...BASE, id: 'piledriver', name: 'PILEDRIVER', slot: 8, base: 'buzzsaw', mode: 'auto',
    magSize: 50, reserve: 100, maxReserve: 150, reloadTime: 3, drawTime: 0.4,
    interval: 0.12, damage: 90, spread: 0.004, severMult: 5, force: 48, headshotMult: 2,
    penetration: 2.4, bodyCost: 0.3, gib: 0.3, slow: 0.72, killStop: 0.03, impactScale: 1.8,
    muzzle: 'hmg', tracer: 'heavy', casing: 'cannon',
    sounds: [{ id: 'hmg_shot', pitchJitter: 0.03 }],
    reloadFoley: [[0.05, 'reload_mag_out'], [0.5, 'reload_mag_in'], [0.8, 'piledriver_charge']], drawSound: 'weapon_draw_heavy',
    recoil: 1, kick: 0.016, shake: 0.045, fovPunch: 1.3,
    climb: { pitch: 0.0028, yaw: 0.0016 },
  },
  kiln: {
    ...BASE, id: 'kiln', name: 'KILN', slot: 9, mode: 'stream',
    magSize: 150, reserve: 300, maxReserve: 600, reloadTime: 1.8, drawTime: 0.26,
    interval: 1 / 30, damage: 9, severMult: 0, canSever: false, force: 1, headshotMult: 1,
    muzzle: 'flame', tracer: 'bullet',
    sounds: [],
    reloadFoley: [[0.1, 'reload_cell'], [0.72, 'reload_bolt']], drawSound: 'weapon_draw_heavy',
    recoil: 0.14, kick: 0, shake: 0.0015,
  },
  stakegun: {
    ...BASE, id: 'stakegun', name: 'STAKEGUN', slot: 0, mode: 'semi', round: 'stake',
    magSize: 5, reserve: 20, maxReserve: 40, reloadTime: 1.6, drawTime: 0.24,
    interval: 0.55, damage: 140, severMult: 2.6, force: 110,
    muzzle: 'rifle', tracer: 'heavy',
    sounds: [{ id: 'stake_fire', pitchJitter: 0.03 }],
    reloadFoley: [[0.1, 'stake_reload'], [0.84, 'reload_bolt']],
    recoil: 1, kick: 0.024, shake: 0.024, fovPunch: 1.4,
  },
};

if (SLOT4_OLD) WEAPONS.sabot.base = 'autocannon';
if (SLOT8_OLD) {
  // The BUZZSAW's row as it was. With no base and no cache, the PILEDRIVER is never handed out, and families.ts leaves it
  // off key 8, so one the lab's arsenal hands over anyway is never drawn.
  Object.assign(WEAPONS.buzzsaw, {
    name: 'BUZZSAW', magSize: 200, reserve: 400, maxReserve: 800, reloadTime: 2.2, drawTime: 0.34, interval: 0.02, damage: 13,
    spread: 0.008, severMult: 2.2, force: 6, burst: undefined, slow: undefined, impactScale: undefined, muzzle: 'minigun',
    tracer: 'bullet', casing: 'rifle', recoil: 0.5, kick: 0.0009, shake: 0.0035, fovPunch: 0,
  });
  WEAPONS.piledriver.base = undefined;
}
if (LANCE_OLD) {
  Object.assign(WEAPONS.lance, {
    magSize: 4, reserve: 16, maxReserve: 32, interval: 0.35, damage: 420, recoil: 1, kick: 0.05, shake: 0.06, fovPunch: 5,
  });
}

/**
 * Slot order, and inside a slot the order its key steps through: the order of the rows above, so a new family member is
 * placed by where its row goes, after its base.
 */
export const WEAPON_ORDER: readonly WeaponId[] = (Object.keys(WEAPONS) as WeaponId[]).map(id =>
  SLOT4_OLD && id === 'sabot' ? 'autocannon' : SLOT4_OLD && id === 'autocannon' ? 'sabot' : id);
/** Key 4 starts with the Sabot. The explosive autocannon beside it is earned: see CACHE_ORDER in src/progression/data.ts. */
export const STARTING_WEAPONS: readonly WeaponId[] = ['smg', 'shotgun', 'rocket', SLOT4_OLD ? 'autocannon' : 'sabot', 'sword'];

/** Per-weapon behaviour that does not fit every row of the table. */
export const TUNING = {
  /** Newton-seconds on the struck bone per point of a blast's radial strength. Most of the throw is the radial itself. */
  blastForce: 0.875,
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
    /**
     * Which gun takes over, first with ammo wins. Rockets come last: a dry player is usually in close. Weapons that are
     * unlocked by themselves: a family member with a `base` takes its turn straight after it, so it needs no entry here.
     * The autocannon is earned on its own, so it has one.
     */
    fallback: ['buzzsaw', 'smg', 'shotgun', 'judge', 'stakegun', 'kiln', 'sabot', 'autocannon', 'lance', 'rocket', 'sword'] as readonly WeaponId[],
    /** Magazines paid into the last-held gun per sword kill. */
    swordKillMags: 0.5,
    /** Fraction of max reserve every owned gun is lifted to when a wave clears. */
    waveFloor: 0.2,
  },
  rocket: { speed: 40, radius: 8, selfDamage: 0.14, playerPush: 27 },
  /**
   * The Quiver. Hold to paint, let go to fire. A mark lands every `paintEvery` on the enemy nearest the crosshair inside
   * `cone` that is in sight and not yet marked; with nobody new in view it stacks on one already marked, a boss or a
   * vehicle first, then the one nearest the crosshair. A press shorter than `paintEvery` leaves no mark and dumb-fires.
   */
  quiver: {
    marks: 4,
    paintEvery: 0.2,
    /** Half-angle around the crosshair, radians, and how far a mark reaches. */
    cone: 0.16,
    range: 150,
    /** After a salvo, before the next press counts. The reload is usually what waits. */
    recover: 0.25,
    /** A missile leaves the tube slow, lights and climbs to `topSpeed`. */
    launchSpeed: 24,
    accel: 80,
    topSpeed: 58,
    /** Radians a second the nose can turn: about a 15 m circle at top speed. */
    turnRate: 3.6,
    /** Seconds of straight flight before it steers, so the four leave in a fan. */
    steerDelay: 0.14,
    /** Radians each tube's missile leaves off the line of the crosshair, outward from the block's centre. */
    fan: 0.05,
    /** Cone of a dumb salvo, fired with no marks, around each tube's own line. */
    dumbSpread: 0.04,
    /**
     * Radians the line a missile steers for swings either side of its mark, side to side and half that up and down. It is
     * the heading's offset, so it is also about how far the heading swings: at 0.22 a low missile dived into the floor.
     */
    weave: 0.1,
    /** Its blast: a third of the ROCKET's reach and most of its punch. Self-damage and push are the ROCKET's. */
    radius: 3.5,
    blastDamage: 90,
    blastScale: 0.6,
    blastShake: 0.022,
    /** How far a missile whose target died looks for another, ahead of it. */
    retargetRange: 45,
    size: 0.6,
  },
  autocannon: {
    speed: 200, radius: 5, bossDamage: 900,
    scopeFov: 30, zoomRate: 16,
    /** Zoom past which the viewmodel is hidden and the scope overlay reads as up. */
    scopeShowAt: 0.6,
  },
  hellfireRounds: { radius: 2, damageMult: 1.25 },
  shotgun: {
    /** Under this range pellets count as point-blank: more sever, more push. */
    pointBlank: 6, pointBlankSever: 3, pointBlankForce: 6.6,
  },
  /** How many heads it hops to is `headHops` in its row. */
  judge: { ricochetRange: 28, ricochetDamage: 0.8 },
  /**
   * The Lance. A press let go before the first stage is a plasma ball. Held, the charge climbs through `stages`, and
   * letting go fires the beam of the last one reached. Every body a beam strikes sets off a plasma burst, one after
   * another down the line. The rules are src/weapons/lance.ts. `minCharge`, `minDamage`, `maxTargets` and `cleave` are the
   * old gun's, which `?lance=old` brings back.
   */
  lance: {
    /** Seconds from the start of the charge to the last stage. */
    chargeTime: LANCE_OLD ? 0.85 : 1,
    /** Below this the trigger release is a fizzle, not a shot. */
    minCharge: 0.22,
    minDamage: 90,
    /** A fully charged shot punches through walls up to this thick, whatever they are made of. Bodies are `maxTargets`. */
    penetration: 1.6,
    /** And through this many of them. */
    walls: 2,
    maxTargets: 24,
    /** A full charge splits this many bodies along the beam. Each costs about 5 ms, so a long line ends in ragdolls. */
    cleave: 3,
    /** A press this short shows and sounds no charge at all, so a tap is clean. The charge starts after it. */
    tapTime: 0.1,
    /** Seconds after a full beam before the next press counts. A weaker beam waits by its `weight`, a ball `interval`. */
    recover: 0.5,
    /** Degrees the view narrows by at full charge. */
    fovPull: 7,
    /**
     * Seconds a beam's FOV punch (the row's `fovPunch` by the stage's `weight`) takes to fall back, on the real clock. It is
     * thrown from the charge's narrowed view, so a full beam opens the view from 83 to 97 degrees in a frame.
     */
    punchTime: 0.2,
    /** Metres a second a full beam shoves the player back along the shot. */
    push: 2.5,
    /**
     * The tap: a concussion shot. `force` on the body it hits and the blast rings on those beside it floor light bodies
     * and stagger heavy ones (src/enemies/reactions.ts, blast.ts). `radius` and `splash` are its burst, `size` how big it is
     * drawn against the 0.2 m plasma body.
     */
    ball: {
      cost: 1, speed: 80, life: 2, damage: 60, force: 95, severMult: 1, killStop: 0.03,
      radius: 2.2, splash: 40, scale: 0.6, size: 1.3,
      recoil: 0.4, kick: 0.008, shake: 0.008, fovPunch: 0.7,
    },
    /**
     * `at` is the charge a stage is reached at and `cost` what its beam takes from the cell. `damage` is a share of the
     * row's. `pierce` is how many bodies it goes on through after the first, `walls` how many walls of `penetration`
     * thickness, `cleave` how many kills it splits. `burst` is the radius of the plasma burst at each body it strikes and
     * `burstDamage` its centre. `weight` scales kick, shake, recoil and the wait after; `width` and `linger` are the beam.
     * `pierces` is armour: plates and a carried shield do not stop it, as they do not stop the Sabot's dart.
     */
    stages: [
      { at: 0.3, cost: 2, damage: 0.2, pierce: 1, walls: 0, cleave: 0, pierces: false, burst: 1.8, burstDamage: 60, weight: 0.4, width: 0.05, linger: 0.4 },
      { at: 0.65, cost: 2, damage: 0.45, pierce: 4, walls: 0, cleave: 1, pierces: false, burst: 2.2, burstDamage: 100, weight: 0.65, width: 0.08, linger: 0.55 },
      { at: 1, cost: 3, damage: 1, pierce: 31, walls: 2, cleave: 3, pierces: true, burst: 2.8, burstDamage: 160, weight: 1, width: 0.13, linger: 0.95 },
    ],
    /** A full beam's first flash is this many times its width, for a tenth of a second. */
    sheath: 3.5,
    /**
     * A full beam strikes this many bodies a frame and carries on from the last of them the next, and splits `cleave` of
     * its kills a frame, so a line of twenty dies over seven frames inside the hit-stop and not in one long frame.
     */
    sweep: { perFrame: 3, cleave: 1 },
    /**
     * The bursts go off `first` after the shot and `gap` apart, nearest first, on the world clock, and no more than
     * `perFrame` in one frame, so a long line is a ripple and never one frame's work. `max` is the pool.
     */
    chain: { first: 0.04, gap: 0.035, perFrame: 2, max: 32, scale: 0.8, shake: 0.014 },
  },
  /** The rotary cannon's barrels. `?slot8=old` puts the spin times and `moveSpeed` back as the BUZZSAW had them. */
  buzzsaw: {
    spinUp: SLOT8_OLD ? 0.55 : 0.7, spinDown: SLOT8_OLD ? 0.85 : 1.1,
    /** Below this spin the barrels turn but nothing leaves them. */
    fireAt: 0.8,
    /** The fire rate climbs from this fraction of full over the rest of the spin. */
    minRate: 0.45,
    /** Ground speed cap while the barrels turn and nothing leaves them, as a fraction of MOVE.runSpeed. Firing is the row's `slow`. */
    moveSpeed: SLOT8_OLD ? 0.62 : 0.8,
  },
  /**
   * How a gun's `slow` comes on and goes, for every gun that has one: see src/weapons/handling.ts. The cap eases in at
   * `rise` a second from the first round and out at `fall` once `hold` has passed with none.
   */
  handling: {
    rise: 9, fall: 4, hold: 0.16,
    /** Past this many times run speed the player was thrown or earned it: a pad, a blast, a slide hop. The gun leaves that alone. */
    leave: 1.5,
    /**
     * Speed a move left under `leave` (a dash ends at 13 m/s, a dash-jump at 18) bleeds down to the cap this many m/s a
     * second, net of what the legs give back, rather than being cut the frame the move ends: 13 to the cannon's cap in a
     * fifth of a second, 18 in four tenths.
     */
    carry: 30,
  },
  /** What every cannon round's burst shares. Its radius, fragments and size are on the round: `WeaponDef.burst`. */
  burst: {
    /** Push of a fragment, newton-seconds. */
    force: 8,
    /** First-game shake at the burst, fading to nothing `shakeRange` metres from the eye. */
    shake: 0.008, shakeRange: 7,
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
  /** Skips line-of-sight checks. */
  ignoresCover: boolean;
  /** Near-player post effects. */
  flash: number;
  fovPunch: number;
  /** Its kills do not stop the clock: for a burst that comes in a chain, where a stop a burst would read as a stutter. */
  noKillStop?: boolean;
}

const BLAST: ExplosionDef = {
  shake: 0.06, shakeRange: 34, sounds: [{ id: 'rocket_explosion', pitchJitter: 0.05 }],
  edgeDamage: 0.5, selfDamage: 0.5, selfCap: 60, playerPush: 12, impulse: 12, friendlyFire: 0.5, ignoresCover: false, flash: 0.16, fovPunch: 2.4,
};

/** How a shaped charge treats armour. Only a body with a plate left is armoured, and anything else takes the blast as written. */
export interface ShapedCharge {
  /** Multiplies a direct hit on armour, which also goes through the plates as if they were not there. */
  direct: number;
  /** Multiplies its splash on armour. A jet punches through what it strikes, and has little left for what stands beside it. */
  splash: number;
  /** Most its splash can count for on armour before that, so the autocannon's instakill is a number there. */
  most: number;
}

export const SHAPED_CHARGE: Partial<Record<ExplosionKind, ShapedCharge>> = {
  rocket: { direct: 2, splash: 0.4, most: 300 },
  shell: { direct: 2, splash: 0.35, most: 300 },
};

export const EXPLOSIONS: Record<ExplosionKind, ExplosionDef> = {
  rocket: { ...BLAST, selfDamage: TUNING.rocket.selfDamage, selfCap: 16, playerPush: TUNING.rocket.playerPush },
  grenade: {
    ...BLAST, shake: 0.07, selfDamage: 0.45, selfCap: 70, playerPush: 18,
    sounds: [{ id: 'grenade_explode', pitchJitter: 0.05 }],
  },
  hellfire: {
    ...BLAST, shake: 0.24, shakeRange: 70, selfDamage: 0.14, selfCap: 20, playerPush: 34, impulse: 15,
    sounds: [{ id: 'hellfire_rocket_blast' }], flash: 0.4, fovPunch: 7,
  },
  hellfireBullet: {
    ...BLAST, shake: 0.012, shakeRange: 16, selfDamage: 0, selfCap: 0, playerPush: 0, impulse: 5,
    sounds: [{ id: 'hellfirebullet_explode', volume: 0.6, pitchJitter: 0.08 }], flash: 0, fovPunch: 0,
  },
  shell: {
    ...BLAST, shake: 0.03, shakeRange: 30, selfDamage: 0, selfCap: 0, playerPush: 8, impulse: 9,
    sounds: [{ id: '30mmshell_explode', pitchJitter: 0.04 }], flash: 0.1, fovPunch: 1.2,
  },
  plasma: {
    ...BLAST, shake: 0.03, shakeRange: 22, selfDamage: 0.3, selfCap: 30, playerPush: 10, impulse: 9,
    sounds: [{ id: 'explosion_small', pitch: 1.2 }], flash: 0.08, fovPunch: 1,
  },
  // The Lance's: a plasma ball's splash, and the burst a beam leaves at every body it strikes. Twenty can go off inside a
  // second, so it is quiet on the camera: no flash, no FOV punch, no hit-stop of its own. Its size is on the spec. A ball
  // let off at arm's length stings and does not throw the player; a beam's bursts set their own share to nothing.
  plasmaBurst: {
    ...BLAST, shake: 0.02, shakeRange: 18, selfDamage: 0.15, selfCap: 6, playerPush: 0, impulse: 10,
    sounds: [{ id: 'plasma_burst', pitchJitter: 0.1 }], flash: 0, fovPunch: 0, noKillStop: true,
  },
  enemy: { ...BLAST, selfDamage: 1, selfCap: 999, playerPush: 16, flash: 0.2 },
  barrel: {
    ...BLAST, shake: 0.09, shakeRange: 40, selfDamage: 0.6, selfCap: 80, playerPush: 22,
    sounds: [{ id: 'explosion_barrel', pitchJitter: 0.06 }, { id: 'explosion_debris' }],
  },
  finisher: {
    ...BLAST, shake: 0.15, shakeRange: 30, selfDamage: 0, selfCap: 0, playerPush: 0, impulse: 14,
    sounds: [{ id: 'rocket_explosion' }], flash: 0, fovPunch: 3.5,
  },
  nuke: {
    ...BLAST, shake: 0.5, shakeRange: 400, edgeDamage: 1, selfDamage: 0, selfCap: 0, playerPush: 0,
    impulse: 20, sounds: [{ id: 'nuke_blast' }], ignoresCover: true, flash: 1, fovPunch: 12,
  },
};

/**
 * Penetration, for every round that has a budget: hitscan through Combat.playerRay, projectiles through Projectiles.step.
 * A budget is meters of concrete. A wall costs its measured thickness times its surface's factor, a body costs `body`
 * (or the round's own `bodyCost`), and the round's damage falls with the budget it has left.
 *
 * The Lance does not pay by the meter. It is on the older per-wall rule (`TUNING.lance.walls`), where none of the costs
 * below apply: see `Budget.walls` in penetration.ts.
 */
export const PENETRATION = {
  /** Budget one body costs, unless the round says otherwise. */
  body: 0.4,
  /** A body whose armour or shield blocked the round costs this many times more. */
  blocked: 2,
  /** Cost per meter by surface. Infinity never lets a round through. */
  surface: {
    concrete: 1, metal: 1.5, grate: 0.3, dirt: 1.2, glass: 0.2, flesh: 0.5, armor: 2, energy: Infinity, lava: Infinity,
  } as Record<SurfaceKind, number>,
  /** Spacing of the probes that look for the far side of a wall. Two walls closer together than this count as one. */
  step: 0.15,
  /** No single wall thicker than this is ever passed, whatever the budget. Also the cap on probes per wall. */
  maxWall: 3,
  /** Share of its damage a round keeps when its budget is all but spent. With the budget untouched it keeps all of it. */
  keep: 0.55,
  /** How far past a body the exit spray starts. */
  bodyDepth: 0.35,
} as const;

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
  /** A full beam that struck any body at all. Each kill adds `lancePerExtraKill`, up to `lanceMax`. */
  lanceShot: 0.06,
  explosionNear: 0.04,
  explosionKills: 0.012,
  explosionMax: 0.09,
  parry: 0.09,
  /** Shortest gap between two stops, so an SMG burst does not turn into a stutter. */
  minGap: 0.09,
} as const;
