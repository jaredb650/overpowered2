/**
 * The cast. One row per enemy; a role is a list of behaviours and a list of attacks.
 * Numbers are wave-1 values. Waves scale health and damage on top, and speed only slightly.
 *
 * Motion is a design rule, not a side effect. The swarm is a tide: slow, heavy, easy to line up, dangerous in number.
 * accel and turn near 3.5 take about a second to reach full speed or finish turning, which is what reads as weight.
 * The Stalker is the one exception and the only body allowed to be quick and evasive. Keep it that way: it only
 * reads as a ninja because nothing else moves like it.
 *
 * Health keeps the first game's arithmetic on purpose: a Husk is 50, so one SMG headshot (25 x 2) always pops it.
 */
import { DroneBone, HumanoidBone as B, type GoreRegion } from '../characters/rig';
import type { EnemyId } from '../core/gameplay';
import type { PlatePaint, PlateSpec } from './armor';
import type { AttackDef, Behaviour } from './brain';
import type { Enemy } from './Enemy';
import type { AiWorld } from './aiWorld';
import { flamer, gun, lunge, melee, rocket, shotgun, sniperShot, stream, hasGun } from './attacks';
import {
  advance, backOff, crawl, dodge, engage, flank, headbuttCharge, keepAway, lost, panic, plant, press, relocate,
  rushWhenDisarmed, seekCover, shieldWall, support, surround, wriggle, type Band,
} from './behaviours';
import { fuse, hover, pounce, skitterPounce, wallCling } from './roles';
import { JUGGERNAUT_ATTACKS, JUGGERNAUT_BEHAVIOURS, TITAN_ATTACKS, TITAN_BEHAVIOURS, juggernautController, titanController, type BossController } from './bosses';

export interface TankSpec {
  /** Regions that count as hitting the tank. */
  regions: readonly GoreRegion[];
  /** Only shots from behind reach it. */
  rearOnly: boolean;
  radius: number;
  damage: number;
  /** Chance it goes up when the enemy dies by any other means. */
  onDeath: number;
}

/** What it sounds like. `pitch` scales every line, so size reads in the voice. */
export interface Voice {
  /** Idle chatter while it hunts. */
  bark: string;
  /** Winding up to hurt you. */
  attack: string;
  pain: string;
  die: string;
  pitch: number;
}

/** Heavy bodies are heard before they are seen. */
export interface Footfall {
  sound: string;
  pitch: number;
  volume: number;
  /** Radial shove on loose bodies around each plant. Zero for none. A corpse takes about 0.13 m/s per point. */
  impulse: number;
}

export interface EnemyDef {
  id: EnemyId;
  name: string;
  hp: number;
  /** Run speed in m/s. */
  speed: number;
  /** Rate of velocity change, 1/s. */
  accel: number;
  /** Rate of turning, 1/s. */
  turn: number;
  /** Separation radius. */
  radius: number;
  eyeHeight: number;
  /** Centre of mass above the feet. */
  chest: number;
  score: number;
  /** Fraction of max health in one window that staggers. */
  poise: number;
  /** Fraction of max health in each limb pool. */
  limbFrac: number;
  /** Head pool as a fraction of health, or a fixed amount that wave scaling leaves alone. */
  headPool: number;
  headPoolFixed?: boolean;
  ranged: boolean;
  /** Pulls a backup weapon with the off hand when the gun arm goes. */
  sidearm: boolean;
  crawlPace: number;
  /** Bone the shots leave from, and how far past it. */
  muzzleBone: number;
  muzzleForward: number;
  behaviours: Behaviour[];
  attacks: AttackDef[];
  voice: Voice;
  footfall?: Footfall;
  /** Fraction of the player's speed a body stops on contact. 0 is shouldered aside, 1 is a wall. */
  mass: number;
  /** Radius of the part the player can run into, when that is narrower than the room the body takes in a crowd. */
  contactRadius?: number;
  /** Rotors, legs: runs for as long as it lives. */
  loop?: string;
  plates?: readonly PlateSpec[];
  tank?: TankSpec;
  /** Not flesh: no maimed behaviour, sparks instead of blood reactions. */
  machine?: boolean;
  /** Takes no damage from burning. */
  fireproof?: boolean;
  /** Keeps hit-stop style death spectacle and a health bar. */
  boss?: (e: Enemy, w: AiWorld) => BossController;
  /** Forearm and shin hits count toward the whole limb. */
  wholeLimbs?: boolean;
  /** Cut lower than the pool that emptied, such as at the knee so a Titan keeps its thighs. */
  severAt?: Partial<Record<GoreRegion, GoreRegion>>;
  onLimbLost?(e: Enemy, w: AiWorld, region: GoreRegion): void;
}

const maimedBehaviours = (): Behaviour[] => [crawl(), wriggle(), headbuttCharge(), rushWhenDisarmed(), panic(), lost()];

/** Attacks every body falls back on once limbs are missing. */
const maimedAttacks = (damage: number): AttackDef[] => [
  melee({ name: 'bite', reach: 1.5, damage: damage * 0.8, windup: 0.5, moveMul: 0, requires: e => e.maim.legs === 0 }),
  melee({ name: 'headbutt', reach: 1.9, damage: damage * 1.2, windup: 0.45, requires: e => e.maim.arms === 0 && e.maim.legs > 0 }),
  melee({
    name: 'oneArmClub', reach: 2, damage, windup: 0.5,
    requires: e => e.def.ranged && !e.maim.gunArm && !e.def.sidearm && e.maim.legs > 0 && e.maim.arms > 0,
  }),
];

/** Fired left-handed and worse once the gun arm is gone. */
const offhandPistol = (damage: number): AttackDef => gun({
  name: 'sidearm', range: [1.5, 18], shots: 1, gap: 0.1, damage, speed: 42, windup: 0.5, cooldown: [1.2, 1.9],
  lead: 0.3, missStill: 0.6, missFast: 5, sound: 'enemy_pistol', muzzle: 'enemy',
  requires: e => !e.maim.gunArm && e.maim.offArm,
});

const husk: EnemyDef = {
  id: 'husk', name: 'Husk', hp: 50, speed: 4, accel: 3.5, turn: 3.5, radius: 0.42, eyeHeight: 1.6, chest: 1.2, score: 100,
  poise: 0.5, limbFrac: 0.5, headPool: 50, headPoolFixed: true, ranged: false, sidearm: false, crawlPace: 0.6,
  muzzleBone: B.handR, muzzleForward: 0,
  voice: { bark: 'vox_husk_growl', attack: 'vox_husk_snarl', pain: 'vox_pain', die: 'vox_death', pitch: 1 }, mass: 0,
  behaviours: [advance(1, 0.08), press(2), ...maimedBehaviours()],
  attacks: [
    melee({ name: 'claw', reach: 2, damage: 6, windup: 0.5, cooldown: [1.2, 1.7], requires: e => e.maim.arms > 0 && e.maim.legs > 0 }),
    lunge({ name: 'lurch', range: [2.4, 4.4], damage: 9, windup: 0.6, flight: 0.6, cooldown: [4, 6.5], requires: e => e.maim.legs === 2 }),
    ...maimedAttacks(6),
  ],
};

const trooperBand: Band = { engage: 30, hold: 15, backOff: 13 };
const trooper: EnemyDef = {
  id: 'trooper', name: 'Trooper', hp: 70, speed: 3.8, accel: 4, turn: 4, radius: 0.45, eyeHeight: 1.62, chest: 1.2, score: 100,
  poise: 0.45, limbFrac: 0.5, headPool: 0.85, ranged: true, sidearm: true, crawlPace: 0.55,
  muzzleBone: B.handR, muzzleForward: 0.3,
  voice: { bark: 'vox_radio', attack: 'vox_alert', pain: 'vox_pain', die: 'vox_death', pitch: 1 }, mass: 0,
  behaviours: [advance(1, 0), engage(trooperBand), backOff(trooperBand), flank(17), seekCover(), ...maimedBehaviours()],
  attacks: [
    gun({
      name: 'burst', range: [1.5, 30], shots: 3, gap: 0.11, damage: 4, speed: 46, windup: 0.42, cooldown: [1.9, 3], lead: 0.5,
      missStill: 0.35, missFast: 4.4, sound: 'enemy_smg', muzzle: 'enemy',
    }),
    offhandPistol(3),
    ...maimedAttacks(6),
  ],
};

const gunnerBand: Band = { engage: 13, hold: 8, backOff: 3 };
const gunner: EnemyDef = {
  id: 'gunner', name: 'Gunner', hp: 90, speed: 4.2, accel: 4, turn: 4, radius: 0.5, eyeHeight: 1.66, chest: 1.25, score: 150,
  poise: 0.45, limbFrac: 0.5, headPool: 0.85, ranged: true, sidearm: false, crawlPace: 0.38,
  muzzleBone: B.handR, muzzleForward: 0.45,
  voice: { bark: 'vox_grunt', attack: 'vox_alert', pain: 'vox_pain', die: 'vox_death', pitch: 0.92 }, mass: 0,
  behaviours: [advance(1, 0), engage(gunnerBand, 0.95), seekCover(0.8), ...maimedBehaviours()],
  attacks: [
    shotgun({ name: 'blast', range: [0.5, 13], pellets: 6, damage: 3.2, speed: 62, windup: 0.5, cooldown: [1.7, 2.5] }),
    ...maimedAttacks(8),
  ],
};

/** The same painted iron as the baked suit, so a plate reads as more armour rather than as a prop. */
const BRUTE_PAINT: PlatePaint = { body: 0x4e2420, rib: 0x5c2c26, edge: 0x6c4a44, bolt: 0x9aa2aa, stripe: 0xc02a18 };
const JUGGERNAUT_PAINT: PlatePaint = { body: 0x2e323c, rib: 0x383d48, edge: 0x565c68, bolt: 0xa0a8b4, stripe: 0xc8501a };

const brute: EnemyDef = {
  id: 'brute', name: 'Brute', hp: 260, speed: 3, accel: 3, turn: 3, radius: 0.72, eyeHeight: 2.05, chest: 1.5, score: 200,
  poise: 0.5, limbFrac: 0.42, headPool: 0.7, ranged: true, sidearm: false, crawlPace: 0.5,
  muzzleBone: B.handR, muzzleForward: 0.7,
  voice: { bark: 'vox_brute_grunt', attack: 'vox_brute_grunt', pain: 'vox_pain', die: 'vox_death', pitch: 0.7 },
  mass: 0.8, contactRadius: 0.62, footfall: { sound: 'juggernaut_step', pitch: 1.35, volume: 0.5, impulse: 0 },
  behaviours: [advance(1, 0), engage({ engage: 34, hold: 16, backOff: 0 }, 0.55), ...maimedBehaviours()],
  attacks: [
    stream({ name: 'minigun', range: [2.5, 34], damage: 2.8, rate: 12, duration: 2.2, speed: 58, windup: 1.05, cooldown: [3, 4.4], track: 0.8 }),
    melee({ name: 'smash', reach: 3, damage: 18, windup: 0.6, anim: 'attackHeavy', knock: 10, cooldown: [2, 3], requires: e => e.maim.legs > 0 && e.maim.arms > 0 }),
    ...maimedAttacks(10),
  ],
  plates: [
    { regions: ['chest'], bone: B.chest, hp: 0.3, shape: 'slab', paint: BRUTE_PAINT, size: [0.56, 0.4, 0.09], offset: [0, 0.02, 0.27], tilt: [-0.06, 0, 0], facing: 'front' },
    { regions: ['chest', 'abdomen'], bone: B.chest, hp: 0.28, shape: 'slab', paint: BRUTE_PAINT, size: [0.62, 0.56, 0.09], offset: [0, 0.03, -0.47], tilt: [0.04, Math.PI, 0], facing: 'back' },
    { regions: ['abdomen'], bone: B.spine, hp: 0.22, shape: 'slab', paint: BRUTE_PAINT, size: [0.46, 0.24, 0.07], offset: [0, 0.03, 0.22], facing: 'front' },
    { regions: ['armL'], bone: B.upperArmL, hp: 0.14, shape: 'sleeve', paint: BRUTE_PAINT, size: [0.2, 0.26, 0.03], offset: [0.1, -0.2, 0], tilt: [0, Math.PI / 2, 0.34] },
    { regions: ['armR'], bone: B.upperArmR, hp: 0.14, shape: 'sleeve', paint: BRUTE_PAINT, size: [0.2, 0.26, 0.03], offset: [-0.1, -0.2, 0], tilt: [0, -Math.PI / 2, -0.34] },
    { regions: ['head'], bone: B.head, hp: 0.16, shape: 'slab', paint: BRUTE_PAINT, size: [0.17, 0.3, 0.07], offset: [0, 0.2, 0.03], tilt: [-Math.PI / 2, 0, 0] },
  ],
};

const stalker: EnemyDef = {
  id: 'stalker', name: 'Stalker', hp: 120, speed: 11, accel: 12, turn: 12, radius: 0.42, eyeHeight: 1.72, chest: 1.3, score: 200,
  poise: 0.6, limbFrac: 0.5, headPool: 0.85, ranged: false, sidearm: false, crawlPace: 0.45,
  muzzleBone: B.handR, muzzleForward: 0,
  voice: { bark: 'vox_stalker_hiss', attack: 'vox_stalker_hiss', pain: 'vox_pain', die: 'vox_death', pitch: 1.1 }, mass: 0,
  behaviours: [advance(1, 0.5), surround(5, 0.95), dodge(21, 1.15), ...maimedBehaviours()],
  attacks: [
    melee({ name: 'twinSlash', reach: 2.4, damage: 8, windup: 0.26, hits: 2, gap: 0.16, cooldown: [1.1, 1.6], sound: 'enemy_blade', requires: e => e.maim.arms > 0 && e.maim.legs > 0 }),
    lunge({ name: 'gapClose', range: [5, 13], damage: 11, windup: 0.3, flight: 0.45, apex: 0.4, cooldown: [2.4, 3.6], requires: e => e.maim.legs === 2 }),
    ...maimedAttacks(9),
  ],
};

const rocketeer: EnemyDef = {
  id: 'rocketeer', name: 'Rocketeer', hp: 90, speed: 3.4, accel: 3.5, turn: 3.5, radius: 0.5, eyeHeight: 1.64, chest: 1.22, score: 150,
  poise: 0.5, limbFrac: 0.5, headPool: 0.85, ranged: true, sidearm: false, crawlPace: 0.36,
  muzzleBone: B.handR, muzzleForward: 0.5,
  voice: { bark: 'vox_radio', attack: 'vox_alert', pain: 'vox_pain', die: 'vox_death', pitch: 0.9 }, mass: 0,
  behaviours: [advance(1, 0), keepAway(20), engage({ engage: 52, hold: 32, backOff: 0 }, 0.6), seekCover(0.7), ...maimedBehaviours()],
  attacks: [
    rocket({ name: 'rocket', range: [10, 56], damage: 26, radius: 5, speed: 26, windup: 0.95, cooldown: [3.6, 5.2] }),
    ...maimedAttacks(7),
  ],
  tank: { regions: ['chest', 'abdomen'], rearOnly: true, radius: 5, damage: 110, onDeath: 0.25 },
};

const sniper: EnemyDef = {
  id: 'sniper', name: 'Sniper', hp: 70, speed: 3.6, accel: 4, turn: 3.5, radius: 0.42, eyeHeight: 1.78, chest: 1.3, score: 150,
  poise: 0.4, limbFrac: 0.5, headPool: 0.8, ranged: true, sidearm: true, crawlPace: 0.36,
  muzzleBone: B.handR, muzzleForward: 0.7,
  voice: { bark: 'vox_radio', attack: 'vox_alert', pain: 'vox_pain', die: 'vox_death', pitch: 1.05 }, mass: 0,
  behaviours: [advance(1, 0), keepAway(26), plant(120), relocate(8, 18, 2), ...maimedBehaviours()],
  attacks: [
    sniperShot({ name: 'snipe', range: [16, 130], damage: 38, windup: 1.9, lock: 0.3, cooldown: [2.4, 3.4] }),
    offhandPistol(3),
    ...maimedAttacks(6),
  ],
};

const riot: EnemyDef = {
  id: 'riot', name: 'Riot', hp: 130, speed: 3.2, accel: 3.5, turn: 2.8, radius: 0.58, eyeHeight: 1.7, chest: 1.26, score: 150,
  poise: 0.6, limbFrac: 0.45, headPool: 0.85, ranged: true, sidearm: false, crawlPace: 0.36,
  muzzleBone: B.handR, muzzleForward: 0.25,
  voice: { bark: 'vox_radio', attack: 'vox_grunt', pain: 'vox_pain', die: 'vox_death', pitch: 0.95 }, mass: 0.35,
  behaviours: [advance(0.9, 0), shieldWall(), ...maimedBehaviours()],
  attacks: [
    melee({ name: 'bash', reach: 2.7, damage: 12, windup: 0.5, knock: 11, anim: 'attackHeavy', cooldown: [1.8, 2.8], requires: e => e.shield }),
    gun({
      name: 'pistol', range: [4, 24], shots: 2, gap: 0.2, damage: 4, speed: 44, windup: 0.5, cooldown: [2, 3.2], lead: 0.4,
      missStill: 0.4, missFast: 4.5, sound: 'enemy_pistol', muzzle: 'enemy', moveMul: 0.8,
    }),
    melee({ name: 'rage', reach: 2.1, damage: 10, windup: 0.45, cooldown: [1, 1.5], requires: e => !e.shield && e.maim.legs > 0 && e.maim.arms > 0 }),
    ...maimedAttacks(8),
  ],
};

const leaper: EnemyDef = {
  id: 'leaper', name: 'Leaper', hp: 80, speed: 6.5, accel: 5, turn: 5, radius: 0.4, eyeHeight: 1.5, chest: 1.1, score: 150,
  poise: 0.55, limbFrac: 0.5, headPool: 0.85, ranged: false, sidearm: false, crawlPace: 0.5,
  muzzleBone: B.handR, muzzleForward: 0,
  voice: { bark: 'vox_leaper_shriek', attack: 'vox_leaper_shriek', pain: 'vox_pain', die: 'vox_death', pitch: 1.15 }, mass: 0,
  behaviours: [advance(1, 0), press(3), wallCling(), ...maimedBehaviours()],
  attacks: [
    pounce(16),
    melee({ name: 'rake', reach: 2.3, damage: 8, windup: 0.42, cooldown: [1.2, 1.7], requires: e => e.maim.arms > 0 && e.maim.legs > 0 }),
    lunge({ name: 'lowLeap', range: [4, 9], damage: 11, windup: 0.5, flight: 0.62, cooldown: [2.5, 3.8], requires: e => e.maim.legs === 2 }),
    ...maimedAttacks(7),
  ],
};

const bomber: EnemyDef = {
  id: 'bomber', name: 'Bomber', hp: 45, speed: 7, accel: 4.5, turn: 4, radius: 0.46, eyeHeight: 1.6, chest: 1.2, score: 100,
  poise: 0.9, limbFrac: 0.6, headPool: 45, headPoolFixed: true, ranged: false, sidearm: false, crawlPace: 0.5,
  muzzleBone: B.chest, muzzleForward: 0,
  voice: { bark: 'vox_bomber_cackle', attack: 'vox_bomber_cackle', pain: 'vox_pain', die: 'vox_death', pitch: 1 }, mass: 0,
  behaviours: [advance(1, 0), crawl(), wriggle(), lost()],
  attacks: [fuse(0.7)],
  tank: { regions: ['chest', 'abdomen'], rearOnly: false, radius: 7, damage: 180, onDeath: 1 },
};

const burner: EnemyDef = {
  fireproof: true,
  id: 'burner', name: 'Burner', hp: 140, speed: 3.4, accel: 3.5, turn: 3.5, radius: 0.54, eyeHeight: 1.66, chest: 1.25, score: 150,
  poise: 0.55, limbFrac: 0.45, headPool: 0.85, ranged: true, sidearm: false, crawlPace: 0.36,
  muzzleBone: B.handR, muzzleForward: 0.55,
  voice: { bark: 'vox_burner_breath', attack: 'vox_burner_breath', pain: 'vox_pain', die: 'vox_death', pitch: 0.9 }, mass: 0.2,
  behaviours: [advance(1, 0), engage({ engage: 12, hold: 7, backOff: 0 }, 0.9), ...maimedBehaviours()],
  attacks: [
    flamer({ name: 'flame', range: [0.5, 10.5], damage: 5, duration: 2.2, windup: 0.6, cooldown: [2.4, 3.4] }),
    ...maimedAttacks(8),
  ],
  tank: { regions: ['chest', 'abdomen'], rearOnly: true, radius: 6.5, damage: 140, onDeath: 0.5 },
};

const warden: EnemyDef = {
  id: 'warden', name: 'Warden', hp: 160, speed: 3.2, accel: 3.5, turn: 3.5, radius: 0.5, eyeHeight: 1.92, chest: 1.42, score: 200,
  poise: 0.7, limbFrac: 0.5, headPool: 0.85, ranged: true, sidearm: false, crawlPace: 0.36,
  muzzleBone: B.handR, muzzleForward: 0.6,
  voice: { bark: 'vox_warden_chant', attack: 'vox_warden_chant', pain: 'vox_pain', die: 'vox_death', pitch: 0.9 }, mass: 0,
  behaviours: [advance(1, 0), keepAway(13, 1.1), support(14, 70, 3), ...maimedBehaviours()],
  attacks: [
    gun({
      name: 'staffBolt', range: [3, 26], shots: 1, gap: 0.1, damage: 7, speed: 30, windup: 0.6, cooldown: [2.4, 3.6], lead: 0.25,
      missStill: 0.5, missFast: 5, sound: 'enemy_pistol', pitch: 0.6, muzzle: 'plasma', tracer: 'plasma',
    }),
    ...maimedAttacks(7),
  ],
};

const skitter: EnemyDef = {
  id: 'skitter', name: 'Skitter', hp: 22, speed: 7.5, accel: 5, turn: 5, radius: 0.34, eyeHeight: 0.5, chest: 0.42, score: 100,
  poise: 2, limbFrac: 0.45, headPool: 1, ranged: false, sidearm: false, crawlPace: 0.5,
  muzzleBone: 0, muzzleForward: 0, machine: true,
  voice: { bark: 'skitter_chirp', attack: 'skitter_chirp', pain: 'skitter_chirp', die: 'skitter_explode', pitch: 1 }, mass: 0, loop: 'skitter_legs_loop',
  behaviours: [advance(1, 0), lost()],
  attacks: [skitterPounce(0.35)],
  tank: { regions: ['chest', 'head'], rearOnly: false, radius: 3.6, damage: 60, onDeath: 1 },
  onLimbLost(e) {
    // Every lost leg costs speed; on the last few it can barely drag itself.
    e.speedMul *= 0.78;
  },
};

const drone: EnemyDef = {
  id: 'drone', name: 'Drone', hp: 70, speed: 5.5, accel: 2.5, turn: 3.5, radius: 0.7, eyeHeight: 0, chest: 0, score: 150,
  poise: 2, limbFrac: 0.25, headPool: 0.4, ranged: true, sidearm: false, crawlPace: 0,
  muzzleBone: DroneBone.gun, muzzleForward: 0.3, machine: true,
  voice: { bark: 'drone_alert', attack: 'drone_alert', pain: 'drone_alert', die: 'drone_crash', pitch: 1 }, mass: 0, loop: 'drone_rotor_loop',
  behaviours: [hover(17)],
  attacks: [
    gun({
      name: 'droneBurst', range: [2, 34], shots: 4, gap: 0.09, damage: 3, speed: 52, windup: 0.5, cooldown: [2, 3.2], lead: 0.45,
      missStill: 0.4, missFast: 4.5, sound: 'drone_gun', muzzle: 'enemy', laser: true, moveMul: 1, requires: hasGun,
    }),
  ],
  onLimbLost(e, w, region) {
    if (region === 'abdomen') e.maim.gunArm = false;
    else if (region !== 'head') {
      e.stage = 0;
      e.maim.legs--;
      // Two lost rotors is more than it can fly on.
      if (e.maim.legs <= 0) w.enemies.crashDrone(e);
    }
  },
};

const juggernaut: EnemyDef = {
  id: 'juggernaut', name: 'Juggernaut', hp: 2600, speed: 4.4, accel: 3, turn: 2.6, radius: 1.15, eyeHeight: 2.9, chest: 2.1, score: 2000,
  poise: 0.22, limbFrac: 0.2, headPool: Infinity, ranged: false, sidearm: false, crawlPace: 0.45,
  muzzleBone: B.chest, muzzleForward: 0.6, wholeLimbs: true,
  voice: { bark: 'vox_juggernaut_roar', attack: 'vox_juggernaut_roar', pain: 'vox_pain', die: 'vox_death', pitch: 0.85 },
  mass: 1, contactRadius: 1, footfall: { sound: 'juggernaut_step', pitch: 1, volume: 1, impulse: 3 },
  behaviours: JUGGERNAUT_BEHAVIOURS,
  attacks: JUGGERNAUT_ATTACKS,
  boss: juggernautController,
  plates: [
    { regions: ['chest'], bone: B.chest, hp: 0.13, shape: 'slab', paint: JUGGERNAUT_PAINT, size: [0.9, 0.62, 0.16], offset: [0, 0.16, 0.42], tilt: [-0.08, 0, 0], facing: 'front' },
    { regions: ['chest', 'abdomen'], bone: B.chest, hp: 0.13, shape: 'slab', paint: JUGGERNAUT_PAINT, size: [0.9, 0.72, 0.14], offset: [0, 0.2, -0.42], tilt: [0.08, Math.PI, 0], facing: 'back' },
    { regions: ['abdomen'], bone: B.spine, hp: 0.09, shape: 'slab', paint: JUGGERNAUT_PAINT, size: [0.74, 0.38, 0.12], offset: [0, 0.08, 0.38], facing: 'front' },
    { regions: ['armL', 'forearmL'], bone: B.upperArmL, hp: 0.07, shape: 'sleeve', paint: JUGGERNAUT_PAINT, size: [0.34, 0.46, 0.05], offset: [0.18, -0.26, 0], tilt: [0, Math.PI / 2, 0.34] },
    { regions: ['armR', 'forearmR'], bone: B.upperArmR, hp: 0.07, shape: 'sleeve', paint: JUGGERNAUT_PAINT, size: [0.34, 0.46, 0.05], offset: [-0.18, -0.26, 0], tilt: [0, -Math.PI / 2, -0.34] },
    { regions: ['legL', 'shinL'], bone: B.thighL, hp: 0.07, shape: 'slab', paint: JUGGERNAUT_PAINT, size: [0.34, 0.5, 0.1], offset: [0, -0.3, 0.26], facing: 'front' },
    { regions: ['legR', 'shinR'], bone: B.thighR, hp: 0.07, shape: 'slab', paint: JUGGERNAUT_PAINT, size: [0.34, 0.5, 0.1], offset: [0, -0.3, 0.26], facing: 'front' },
    { regions: ['head'], bone: B.head, hp: 0.06, shape: 'slab', paint: JUGGERNAUT_PAINT, size: [0.26, 0.46, 0.1], offset: [0, 0.34, 0.03], tilt: [-Math.PI / 2, 0, 0] },
  ],
};

const titan: EnemyDef = {
  id: 'titan', name: 'Titan', hp: 9000, speed: 3.6, accel: 2.5, turn: 1.5, radius: 2.4, eyeHeight: 6.4, chest: 4.8, score: 5000,
  poise: Infinity, limbFrac: 0.14, headPool: Infinity, ranged: false, sidearm: false, crawlPace: 0.4,
  muzzleBone: B.handR, muzzleForward: 0.8, wholeLimbs: true, severAt: { legL: 'shinL', legR: 'shinR' },
  voice: { bark: 'titan_roar', attack: 'titan_roar', pain: 'titan_roar', die: 'titan_fall', pitch: 1 },
  mass: 1, contactRadius: 1.3, footfall: { sound: 'titan_step', pitch: 1, volume: 1, impulse: 8 },
  behaviours: TITAN_BEHAVIOURS,
  attacks: TITAN_ATTACKS,
  boss: titanController,
};

export const ENEMIES: Record<EnemyId, EnemyDef> = {
  husk, trooper, gunner, brute, stalker, rocketeer, sniper, riot, leaper, bomber, burner, warden, skitter, drone, juggernaut, titan,
};

/** Base damage multipliers by region. Head stays at x2 from the first game; limbs take less but feed their own pools. */
export const REGION_DAMAGE: Record<GoreRegion, number> = {
  head: 2, chest: 1, abdomen: 1, armL: 0.75, armR: 0.75, forearmL: 0.6, forearmR: 0.6, legL: 0.75, legR: 0.75, shinL: 0.6, shinR: 0.6,
};

/** Size of each limb pool relative to the def's limbFrac. The lower joints are thinner. */
export const LIMB_SIZE: Partial<Record<GoreRegion, number>> = {
  armL: 1, armR: 1, forearmL: 0.7, forearmR: 0.7, legL: 1.2, legR: 1.2, shinL: 0.9, shinR: 0.9,
};

/**
 * Wave scaling. Late waves get harder through numbers, mix, health and damage. Speed barely moves: a tide that speeds
 * up stops being a tide, and the targets stop being ones you can line up.
 */
export const waveScale = (wave: number): { health: number; damage: number; speed: number } => ({
  health: 1 + 0.085 * (wave - 1),
  damage: Math.min(1 + 0.05 * (wave - 1), 2.6),
  speed: Math.min(1 + 0.006 * (wave - 1), 1.08),
});
