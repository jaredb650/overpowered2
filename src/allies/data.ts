/**
 * Allies by type (docs/proposals/outpost-defense.md, piece 2). Every number an ally lives by is here: the body he wears, his
 * gun, how he holds a post, and the squad's rules. Plain data, so the Outpost Defense shop and the big mission can read it.
 */
import type { MuzzleKind, TracerKind } from '../core/contracts';
import type { EnemyId } from '../core/gameplay';

export type AllyType = 'rifleman' | 'gunner' | 'sniper' | 'rocketeer' | 'shotgunner' | 'riot' | 'medic';

/** How a man holds his post when nothing is happening. */
export type Stance = 'patrol' | 'hold' | 'high' | 'guard' | 'line' | 'medic';

export interface AllyGun {
  /** Every ally source starts `ally_`: progression pays nothing for it and audio confirms nothing (`ALLY_SOURCE`). */
  source: string;
  damage: number;
  /** Pellets in one round. */
  pellets: number;
  /** Radians of pellet spread, for a shotgun. */
  cone: number;
  burst: readonly [number, number];
  /** Seconds between rounds in a burst, and between bursts. */
  gap: number;
  rest: readonly [number, number];
  /** Miss in metres per metre of range, standing still and healthy. */
  spread: number;
  /** He engages out to this. */
  range: number;
  /** Inside this he is bad at it: spread x4 and rests twice as long. 0 for a gun that does not care. */
  closeBad: number;
  mag: number;
  reload: number;
  sound: string;
  pitch: number;
  muzzle: MuzzleKind;
  tracer: TracerKind;
  /** A rocket: flies at `speed` and bursts with `radius` and `damage` where it lands. */
  rocket?: { speed: number; radius: number; damage: number };
}

export interface AllyTypeDef {
  label: string;
  /** The soldier body he wears: the same bodies, rigs and animation as the enemy. */
  body: EnemyId;
  hp: number;
  gun: AllyGun;
  stance: Stance;
  firesOnTheMove: boolean;
  /** Metres from his target he likes to fight at. */
  near: number;
  far: number;
  /** How much a high cover spot is worth to him, 0 to 1. */
  height: number;
  /** Gets low (the crouch, not the prisoner's kneel) to fire when he has no cover to fire from. */
  kneels: boolean;
  /** Carries a shield: rounds from the front stop on it. */
  shield?: boolean;
  /** Carries stims of his own and goes to the downed. */
  medic?: { stims: number; seconds: number; reach: number };
  /** Shoots vehicles before men. */
  antiArmour?: boolean;
}

const rifle: AllyGun = {
  source: 'ally_rifle', damage: 11, pellets: 1, cone: 0, burst: [3, 4], gap: 0.1, rest: [0.45, 0.9], spread: 0.022, range: 48, closeBad: 0,
  mag: 30, reload: 2, sound: 'enemy_smg', pitch: 1.12, muzzle: 'carbine', tracer: 'carbine',
};

export const ALLY_TYPES: Record<AllyType, AllyTypeDef> = {
  rifleman: { label: 'Rifleman', body: 'trooper', hp: 150, gun: rifle, stance: 'patrol', firesOnTheMove: true, near: 8, far: 30, height: 0.2, kneels: true },
  gunner: {
    label: 'Machine gunner', body: 'brute', hp: 260, stance: 'hold', firesOnTheMove: false, near: 12, far: 40, height: 0.4, kneels: false,
    gun: {
      ...rifle, source: 'ally_mg',
      damage: 9, burst: [10, 18], gap: 0.075, rest: [0.6, 1.1], spread: 0.03, range: 55, mag: 100, reload: 3.4, sound: 'enemy_smg', pitch: 0.82, muzzle: 'minigun', tracer: 'heavy' },
  },
  sniper: {
    label: 'Sniper', body: 'sniper', hp: 120, stance: 'high', firesOnTheMove: false, near: 22, far: 60, height: 1, kneels: true,
    gun: {
      ...rifle, source: 'ally_sniper',
      damage: 70, burst: [1, 1], gap: 0.1, rest: [1.6, 2.4], spread: 0.004, range: 90, closeBad: 10, mag: 5, reload: 2.6, sound: 'sniper_fire', pitch: 1, muzzle: 'railgun', tracer: 'sabot' },
  },
  rocketeer: {
    label: 'Rocketeer', body: 'rocketeer', hp: 140, stance: 'hold', firesOnTheMove: false, near: 14, far: 45, height: 0.3, kneels: true, antiArmour: true,
    gun: {
      ...rifle, source: 'ally_rocket',
      damage: 0, burst: [1, 1], gap: 0.1, rest: [3, 4.2], spread: 0.012, range: 60, closeBad: 8, mag: 2, reload: 3.4, sound: 'enemy_rocket_fire', pitch: 1, muzzle: 'rocket', tracer: 'heavy', rocket: { speed: 38, radius: 5, damage: 120 } },
  },
  shotgunner: {
    label: 'Shotgunner', body: 'gunner', hp: 170, stance: 'guard', firesOnTheMove: true, near: 2, far: 10, height: 0, kneels: false,
    gun: {
      ...rifle, source: 'ally_shotgun',
      damage: 9, pellets: 8, cone: 0.06, burst: [1, 1], gap: 0.1, rest: [0.75, 1.1], spread: 0.01, range: 16, mag: 6, reload: 2.5, sound: 'enemy_shotgun', pitch: 1, muzzle: 'shotgun', tracer: 'pistol' },
  },
  riot: {
    label: 'Riot police', body: 'riot', hp: 200, stance: 'line', firesOnTheMove: true, near: 2, far: 12, height: 0, kneels: false, shield: true,
    gun: {
      ...rifle, source: 'ally_pistol',
      damage: 10, burst: [2, 2], gap: 0.2, rest: [0.8, 1.3], spread: 0.03, range: 18, mag: 12, reload: 2, sound: 'enemy_pistol', pitch: 1, muzzle: 'pistol', tracer: 'pistol' },
  },
  medic: {
    label: 'Medic', body: 'warden', hp: 140, stance: 'medic', firesOnTheMove: false, near: 10, far: 26, height: 0.2, kneels: true,
    medic: { stims: 3, seconds: 3.5, reach: 32 },
    gun: {
      ...rifle, source: 'ally_carbine',
      damage: 9, burst: [2, 3], gap: 0.13, rest: [0.8, 1.4], range: 34, mag: 20, sound: 'enemy_pistol', pitch: 0.85 },
  },
};

export const ALLY_ORDER: readonly AllyType[] = ['rifleman', 'gunner', 'sniper', 'rocketeer', 'shotgunner', 'riot', 'medic'];

/** Damage sources that belong to allies. They pay no score, move no combo and tick no hit marker. */
export const ALLY_SOURCE = /^ally_/;

export const ALLY = {
  /** Squad cap for the range test. Outpost Defense will set its own. */
  squadMax: 8,
  /** Most allies alive at once, any squad. */
  maxAlive: 20,
  /** Seconds between thinks, and the jitter that spreads them. */
  think: 0.25,
  /** How far he looks for something to shoot, and how many sight rays one think may spend. */
  sight: 60,
  raysPerThink: 3,
  /** Seconds a target he cannot see is kept. */
  memory: 2.5,
  /** Followers: a ring behind the player. */
  followNear: 4,
  followFar: 8,
  /** Past this from his slot a follower runs. */
  catchUp: 12,
  runPace: 1.65,
  /** Metres of cover search round a follower's slot and round a post. */
  followCover: 7,
  /** A post with no radius given. */
  postRadius: 6,
  /** Seconds between patrol points. */
  patrolEvery: [5, 9] as const,
  /** Down: seconds before he bleeds out, and the health pool he lies on. A hit that empties it kills. */
  downSeconds: 45,
  downPool: 0.3,
  /** One hit of this share of his health or more kills where he stands. */
  overwhelming: 1.6,
  /** Health he gets back from a revive, as a share. */
  reviveHealth: 0.5,
  /** The E key: past `hold` is a hold, and anything shorter a tap. Reviving takes `revive` held. */
  hold: 0.55,
  revive: 1.1,
  /** Reach and cone for the player to address one man. */
  reach: 3.6,
  reachCos: 0.82,
  /** A hold reaches the squad if any of it is this close. */
  squadReach: 60,
  /** Seconds between CHECK FIRE calls. */
  checkFireGap: 3,
  /** Enemy soldiers: how often they look for an ally to shoot, how far, and how many rays a look may spend. */
  foeTick: 0.4,
  foeRange: 55,
  foeRays: 8,
  /** Riot line: metres between shields. */
  lineGap: 1.05,
  /** Medic: metres he treats from. */
  treatReach: 1.4,
} as const;

/** Cold cyan, the HUD's friendly accent on the body (never green: green is the husk's and the Warthog's). The crosshair is green. */
export const ALLY_COLOR = 0x39e0ff;
export const ALLY_BEACON = 0xdfefff;
export const ALLY_DOWN_COLOR = 0xffb030;
export const ALLY_TEXT = '#39e0ff';
export const CHECK_FIRE_TEXT = '#3dff7a';
