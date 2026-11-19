/**
 * The damage model: the only code that takes health off an enemy, and the only code that kills one.
 *
 * Order of a hit: ward, riot shield, tank, region multiplier, armour plate, boss filter, health, wounds, limb pool.
 * Everything a kill should do happens in `kill`, once, so the first game's seven drifting kill paths cannot return.
 *
 * A body with anatomy (FACTIONS, src/contracts/data.ts) does not simply die when its health is gone. `WoundSystem.take` says
 * whether this hit is the end of him. Bodies without it never reach that line, which is what keeps the swarm as it was.
 */
import * as THREE from 'three';
import { DroneBone, HumanoidBone as B, type GoreRegion } from '../characters/rig';
import { DEFAULT_FORCE, HEAD_VOLLEY, type AmmoLoad, type DamageInfo, type DamageType, type HeadOutcome } from '../core/contracts';
import { DevFlags } from '../core/devflags';
import type { ArmourOutcome, DamageResult, KillEvent } from '../core/gameplay';
import { chance, clamp, lerp, pick, rand, smoothstep } from '../core/math';
import { FACTIONS, type FactionRules } from '../contracts/data';
import { ACTIVE } from '../contracts/select';
import { KNOCK_PASS, MASS_PASS, STAND_PASS, STRENGTH_PASS, WEIGHT_PASS, type LimbStrength } from '../gore/muscles';
import { standBudget, StandTuning } from '../gore/stand';
import { STRUGGLE_PASS } from '../gore/reflex';
import { bursts, HEAVY_ROUND } from './wounds/rules';
import type { ZoneHit } from './wounds/zones';
import { blowsOut } from '../gore/torso';
import { BLAST, OUTCOME_COUNT, OUTCOMES, rollBlast, tearsWaist, type BlastBody, type BlastOutcome, type BlastRoll, type OutcomeRule } from './blast';
import { CHECK_CARRY, CHECK_MIN, CHECK_TOPPLE_MAX, CHECK_TOPPLE_MIN, checkStrength, SLIDE_KICK, SLIDE_TOPPLE } from './contact';
import { ENEMIES, LIMB_SIZE, REGION_DAMAGE } from './data';
import { AMMO, WEAPONS, type ArmourClass } from '../weapons/data';
import type { WeaponId } from '../core/gameplay';
import { say } from './attacks';
import { finishAttack } from './brain';
import { chooseReaction, mustFall, profileOf, reactionSeed, type ReactionLevel, type ReactionProfile } from './reactions';
import { dropOff } from './roles';
import type { Enemy } from './Enemy';
import type { Plate } from './armor';
import type { AiWorld } from './aiWorld';
import type { EnemyManager } from './EnemyManager';

/** Metres per second of knockback on the living, per newton-second per point of health, and the most one hit gives. */
const SHOVE_GAIN = 1.35;
const SHOVE_MAX = 4;
/** Seconds a stagger lasts, at no strength and at full. */
const STAGGER_MIN = 0.45;
const STAGGER_MAX = 1.05;
/** Seconds of failing to catch itself before a fall, least and most. */
const FALL_LEAD_MIN = 0.16;
const FALL_LEAD_MAX = 0.42;
/**
 * A fall the player can see goes down on its muscles from the hit (`KnockdownOptions.stumble`): it takes its catch steps
 * physically and goes over when its weight gets past its feet, at the latest the fall's lead plus this many seconds. Only
 * within `STUMBLE_RANGE` metres, in view and at full detail, where a fall reads; anything else keeps the timer. `?stand=0`
 * puts the timer back everywhere.
 */
const STUMBLE_EXTRA = 0.35;
const STUMBLE_RANGE = 20;
/**
 * A stagger at least this strong, where a fall would be seen, is taken on the body's muscles too, and it may catch itself
 * (`KnockdownOptions.stumble.budget`, `gore/stand.ts`): it is gore's for up to `StandTuning.maxSeconds`, unable to attack,
 * and comes back standing or goes over. Weaker, refused, or with `?stand=0`, the stagger is the animation's, as before.
 */
const STAND_FROM = 0.35;
/** What a head hit costs a body catching its balance, as a share of its health: at `StandTuning.hitCost`, any budget. */
const HEAD_COST = 2;
/**
 * Not faster than this, in m/s, with its stride, the reel and the knockback added up. A Trooper's hardest stagger from a
 * standstill is 4.05, which it catches in five steps; harder than that the body decides. Shot along its patrol at 2.5 m/s
 * it reels at 6.5, and on its muscles lost its feet to that six frames later without a step, every time: that is a trip,
 * and the rule asked for a stagger. Shot against its run the two cancel, and it is taken.
 */
const STAND_MAX_SPEED = 5;
/** What full strength adds to a catch step. */
const REEL_GAIN = 1.4;
/** Sideways push toward a weak leg added to a stagger's unit direction, times what its wounds took off it: up to 39°. */
const WEAK_TURN = 0.8;
/** Share of a limb's pool gone before it starts to weaken, as `reactions.ts` reads a leg giving way; and a broken limb. */
const POOL_WEAK_FROM = 0.45;
const FRACTURED = 0.15;
/** Metres per second tipping the upper body over the feet, at no strength and at full. Less is a body that folds up. */
const TOPPLE_MIN = 1.2;
const TOPPLE_MAX = 2.2;
/** Seconds a co-op guest's copy would lie if nothing ever told it to get up: the host's body getting up is what does. */
export const REPLICA_LIE = 20;
/** Share of a body's shock left after each kind of reaction, so one burst does not fell it twice. */
const SHOCK_AFTER_STAGGER = 0.5;
/** Knocked cold by a head hit, it lies this much longer, and gets up dazed for its whole `daze`. */
const KNOCKOUT_LIE = 1.5;
/**
 * Share of the get-up clip a body with all four limbs pushes itself through on the floor first (gore's struggle, `reflex.ts`),
 * which the clip then does not have to: the mean of the two frames it pushes for, 0.24 face down and 0.3 face up.
 */
const RISE_PUSHED = 0.27;

/** How a knockdown goes over, where the default from its direction and strength will not do. */
interface Knock {
  /** m/s on the upper body. Left out, along the hit by its strength. Null, none: it drops from the pose it is in. */
  topple?: THREE.Vector3 | null;
  /** How hard the limbs are thrown, along the knockdown's direction. Left out, by its strength. */
  impact?: number;
  /** Knocked cold by a head hit (`KnockdownOptions.knockout`), at `point`. */
  knockout?: boolean;
  point?: THREE.Vector3;
  /** Seconds it may stumble on its muscles before it goes over (`KnockdownOptions.stumble`). Needs `topple: null`. */
  stumble?: number;
  /** With `stumble`: what it has to catch itself with, 0..1. Left out, it can only fall. */
  budget?: number;
  /** On fire: seconds it rolls once down (`KnockdownOptions.roll`). */
  roll?: number;
}
const _stumble: { seconds: number; budget?: number } = { seconds: 0 };
/** Weapons light enough that a body takes a moment to die of them, on its feet. Anything harder drops it. */
const DIES_ON_FEET: ReadonlySet<DamageType> = new Set<DamageType>(['bullet', 'fire', 'shock', 'true']);
const DIES_ON_FEET_FORCE = 30;
const COLLAPSE_MIN = 0.85;
const COLLAPSE_MAX = 1.4;
/** A man who bled out on his feet takes longer about it than one who was shot dead on them. */
const BLEED_COLLAPSE_MIN = 1.6;
const BLEED_COLLAPSE_MAX = 2.6;
/** How hard a body with anatomy twitches after a death that took it all at once, and one that came as a relief. */
const SUDDEN_TWITCH = 1;
const SLOW_TWITCH = 0.45;
/** A lethal headshot drops him like a sack, and he lies still. A sudden death's twitch with `?weight=0`. */
const HEADSHOT_TWITCH = WEIGHT_PASS ? 0 : SUDDEN_TWITCH;
/**
 * The living flinch, from the share of health a hit took: `base + share * gain`, at most `max`. The animator already sizes
 * it by build (`HumanoidAnimator.flinch`), so mass is not counted again here. As it was before, with `?mass=0`, an SMG round
 * rocked a Trooper's chest 0.26 rad and the springs under it rang past rest by a seventh of that. A machine (a drone, a
 * skitter) keeps the old size: its animator sizes nothing by build and its tilt spring was not made to settle, so the
 * smaller one would only be a smaller reaction.
 */
const FLINCH = MASS_PASS ? { base: 0.2, gain: 2.2, max: 1.4 } : { base: 0.35, gain: 3, max: 1.6 };
const MACHINE_FLINCH = { base: 0.35, gain: 3, max: 1.6 };
export const flinchSize = (share: number, machine = false): number => {
  const f = machine ? MACHINE_FLINCH : FLINCH;
  return clamp(f.base + share * f.gain, f.base, f.max);
};
/**
 * Most of its stagger and knockback a body keeps when it dies, in m/s. The living shed both within a second; a corpse
 * slides on with whatever it is given. Kept whole, a stagger from the round before made an SMG kill at 8 m land twice as
 * far, and the pellets of one shot added up to 10 m/s (that part is `unmoved` now). At 0.6, above
 * `MuscleTuning.stumbleOnward`, a body killed mid-stagger still stumbles on the way it was going, and an SMG kill at 8 m
 * lands about 0.3 m further than with none (`lab.md`).
 */
const DEATH_CARRY = 0.6;

/** How hard each damage type works a limb pool, on top of the weapon's severMult. */
const SEVER_FACTOR: Record<DamageType, number> = {
  bullet: 1, pellet: 1.2, explosive: 0.7, melee: 0.8, slash: 2.4, fire: 0, shock: 0, crush: 1, true: 0,
};

/** Damage types that ignore where they land. */
const AREA_TYPES: ReadonlySet<DamageType> = new Set<DamageType>(['explosive', 'fire', 'shock', 'crush', 'true']);

/** Limbs that can come off, for blasts that have no struck region. */
const BLAST_LIMBS: readonly GoreRegion[] = ['armL', 'armR', 'legL', 'legR', 'forearmL', 'forearmR', 'shinL', 'shinR'];
const BLAST_ARMS: readonly GoreRegion[] = ['armL', 'armR', 'forearmL', 'forearmR'];
const BLAST_LEGS: readonly GoreRegion[] = ['legL', 'legR', 'shinL', 'shinR'];
/** How far round the body a second opening goes, for a blast that opened it up. */
const FLESH_TURN = 1.1;

const REGION_BONE: Record<GoreRegion, number> = {
  head: B.head, chest: B.chest, abdomen: B.spine,
  armL: B.upperArmL, forearmL: B.foreArmL, armR: B.upperArmR, forearmR: B.foreArmR,
  legL: B.thighL, shinL: B.shinL, legR: B.thighR, shinR: B.shinR,
};

const WHOLE_LIMB: Partial<Record<GoreRegion, GoreRegion>> = { forearmL: 'armL', forearmR: 'armR', shinL: 'legL', shinR: 'legR' };

/** A killing round of this much damage or more is a severe headshot. Below it he keeps his head, with a hole in it. */
const HEAD_BURST_DAMAGE = 40;
/** Severe headshots on these get a partial head wound (docs/proposals/partial-head-wounds.md); gore says which are built. */
const PARTIAL_HEADS: ReadonlySet<string> = new Set(['trooper', 'gunner', 'husk', 'brute']);
/** Rounds that burst any head they kill: the very damaging tier, with four pellets of a blast and the Judge up close. */
const HEAD_BURSTERS: ReadonlySet<string> = new Set(['autocannon', 'sabot']);
const JUDGE_BURST_RANGE = 8;

/**
 * What a killing round does to a head (docs/proposals/partial-head-wounds.md): a hole under 40, a burst for the very
 * damaging (`heavy`), and between the two a partial wound on the enemies in `PARTIAL_HEADS`, a burst on the rest. Never
 * off whole: that is a blast's and the katana's.
 */
export function headOutcome(round: number, heavy: boolean, enemy: string): HeadOutcome {
  if (heavy) return 'burst';
  if (round < HEAD_BURST_DAMAGE) return 'hole';
  return PARTIAL_HEADS.has(enemy) ? 'partial' : 'burst';
}
/**
 * Co-op kill prediction (`sureKill`). A guest drops a body for dead when its hit is over what the body has left by this
 * share of its whole health (and at least `SURE_MARGIN_MIN`), and plays the whole death itself when the hit is this many
 * times what is left with this share of its whole health to spare.
 */
export const SURE_MARGIN = 0.15, SURE_MARGIN_MIN = 6, SURE_KILL_TIMES = 3, SURE_KILL_OVER = 0.5;
/** The force of a round that drops a body for dead at full strength; a light one still drops it at `FELL_MIN`. */
const FELL_FORCE = 60, FELL_MIN = 0.35;
const RESULT_RING = 16;
/** Seconds between cries of pain. Under an SMG every hit would otherwise be one. */
const PAIN_GAP = 0.7;
const BOSS_PAIN_GAP = 6;
/** A tank the player did not set off, as a share of a full blast. */
export const STRAY_TANK_DAMAGE = 0.17;
/** The Piledriver shreds armour: a plate takes its rounds at this many times their worth. */
export const PILEDRIVER_SHRED = 2;
/** A light round wears a plate by this share of its own damage: an SMG round takes about half of a trooper's helmet. */
export const LIGHT_WEAR = 0.5;

/** A gun's own class, else light under HEAVY_ROUND damage and heavy at or over it (melee, call-in guns, the sentry). */
export function classOf(source: string, round: number): ArmourClass {
  const def = Object.hasOwn(WEAPONS, source) ? WEAPONS[source as WeaponId] : null;
  return def?.armour ?? (round >= HEAVY_ROUND ? 'heavy' : 'light');
}

/**
 * One round on one plate. `round` is the round's own damage, `amount` what it would do where it struck. Light is stopped
 * and wears the plate by half the round; medium is stopped but wrecks the plate; heavy wears it by the round (twice for
 * a shredder) and half of what it would have done gets through either way. An ammo mod (`load`, AMMO) overrides the class:
 * AP wears it as heavy and gets `AMMO.ap.plate` through, HP is stopped and barely marks it.
 */
export function armourHit(cls: ArmourClass, plateHp: number, round: number, amount: number, shred = 1, load?: AmmoLoad): { wear: number; through: number } {
  if (load === 'ap' || load === 'api') return { wear: round * shred, through: amount * AMMO.ap.plate };
  if (load === 'flechette') return { wear: round * shred, through: amount * AMMO.flechette.plate };
  if (load === 'hp') return { wear: round * AMMO.hp.wear, through: 0 };
  if (cls === 'medium') return { wear: plateHp, through: 0 };
  if (cls === 'light') return { wear: round * LIGHT_WEAR, through: 0 };
  return { wear: round * shred, through: amount * 0.5 };
}
/** Blood a hit of `amount` leaves to bleed on: a flechette's share (AMMO.flechette), none for any other round. */
export const dartBleed = (load: AmmoLoad | undefined, amount: number): number => (load === 'flechette' ? amount * AMMO.flechette.bleed : 0);
/** What of a flechette pool bleeds out over `dt`: 1 / AMMO.flechette.bleedSeconds of it a second, never under 1 hp a second, so it ends. */
export const drainDarts = (pool: number, dt: number): number => Math.min(pool, Math.max(pool / AMMO.flechette.bleedSeconds, 1) * dt);
/** Whether a round that reached flesh sets the man alight, for a roll in 0..1: an API round, AMMO.api.ignite of the time. */
export const ignites = (load: AmmoLoad | undefined, roll: number): boolean => load === 'api' && roll < AMMO.api.ignite;
export const STRAY_TANK_RADIUS = 0.8;
/** Share of a shot tank's blast that reaches the player who shot it. Too close is a mistake, not a death sentence. */
const TANK_SELF_DAMAGE = 0.35;
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _dying = new THREE.Vector3();
const _check = new THREE.Vector3();
const _checkTopple = new THREE.Vector3();
const _fall = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

const _knock: Knock = {};
/** The one `Knock` every caller fills, all of it each time. */
function knockAs(topple: THREE.Vector3 | null | undefined, impact: number | undefined, knockout: boolean, point: THREE.Vector3 | undefined, stumble?: number, budget?: number, roll?: number): Knock {
  _knock.topple = topple;
  _knock.impact = impact;
  _knock.knockout = knockout;
  _knock.point = point;
  _knock.stumble = stumble;
  _knock.budget = budget;
  _knock.roll = roll;
  return _knock;
}

const _strength: LimbStrength = { legL: 1, legR: 1, armL: 1, armR: 1, trunk: 1, neck: 1 };
const _turn = new THREE.Vector3();

/** What is left of a limb's pool, as strength: whole until `POOL_WEAK_FROM` of it is gone, nothing when all of it is. */
function poolStrength(e: Pick<Enemy, 'limbHp' | 'maxHealth' | 'def'>, region: GoreRegion): number {
  const left = e.limbHp.get(region);
  if (left === undefined) return 1;
  const whole = e.maxHealth * e.def.limbFrac * (LIMB_SIZE[region] ?? 1);
  return 1 - smoothstep(POOL_WEAK_FROM, 1, 1 - left / whole);
}

/**
 * Stage 8, the Crucible's rule: what the limb pools leave each limb, the weaker of its two pools, and a broken one
 * `FRACTURED`. Trunk and neck have no pools of their own. Exported for its test.
 */
export function poolStrengths(e: Pick<Enemy, 'limbHp' | 'maxHealth' | 'def' | 'char'>, out: LimbStrength): LimbStrength {
  const c = e.char;
  const limb = (upper: GoreRegion, lower: GoreRegion, a: number, b: number) =>
    c.isFractured(a) || c.isFractured(b) ? FRACTURED : Math.min(poolStrength(e, upper), poolStrength(e, lower));
  out.legL = limb('legL', 'shinL', B.thighL, B.shinL);
  out.legR = limb('legR', 'shinR', B.thighR, B.shinR);
  out.armL = limb('armL', 'forearmL', B.upperArmL, B.foreArmL);
  out.armR = limb('armR', 'forearmR', B.upperArmR, B.foreArmR);
  out.trunk = out.neck = 1;
  return out;
}

/**
 * How fast a body was really going when it died: its stride, the reel it was in and the knockback it was taking, and in the
 * air, how fast it was falling. Movement steps by all three on the ground, so a body killed mid-stagger keeps going the way
 * it was, up to `DEATH_CARRY`. What hits at world time `now` added, it has not stepped with yet, and does not keep. In the
 * air only the stride moves it. With `?weight=0`, the stride alone, as before the weight pass.
 */
export function deathVelocity(e: Enemy, out: THREE.Vector3, now = Number.NaN): THREE.Vector3 {
  if (!WEIGHT_PASS) return out.copy(e.velocity);
  out.set(e.velocity.x, e.airborne ? e.verticalSpeed : e.velocity.y, e.velocity.z);
  if (e.airborne) return out;
  let x = e.reel.x + e.push.x;
  let z = e.reel.z + e.push.z;
  if (e.unmovedAt === now) {
    const ux = x - e.unmoved.x;
    const uz = z - e.unmoved.z;
    // A knockdown or a trip since may have cleared or turned it: then nothing it stepped with is left.
    if (ux * x + uz * z > 0) {
      x = ux;
      z = uz;
    } else x = z = 0;
  }
  const k = Math.min(1, DEATH_CARRY / Math.max(Math.hypot(x, z), 1e-6));
  out.x += x * k;
  out.z += z * k;
  return out;
}

/**
 * Both arms and both legs there to push itself up with, none of them broken at the shoulder, elbow, hip or knee: what gore's
 * struggle asks (`Reflex.canPush`), or a body that gathers for the whole clip would play it in the pushed one's time.
 */
function pushesUp(e: Enemy): boolean {
  const s = e.char.severed;
  if (s.has('armL') || s.has('armR') || s.has('forearmL') || s.has('forearmR') || s.has('legL') || s.has('legR') || s.has('shinL') || s.has('shinR')) return false;
  const c = e.char;
  return !c.isFractured(B.upperArmL) && !c.isFractured(B.foreArmL) && !c.isFractured(B.upperArmR) && !c.isFractured(B.foreArmR)
    && !c.isFractured(B.thighL) && !c.isFractured(B.shinL) && !c.isFractured(B.thighR) && !c.isFractured(B.shinR);
}

/** Reel or knockback a hit adds at world time `now`, which the body has not stepped with until its next frame. */
function unmoved(e: Enemy, now: number, x: number, z: number): void {
  if (e.unmovedAt !== now) {
    e.unmovedAt = now;
    e.unmoved.set(0, 0, 0);
  }
  e.unmoved.x += x;
  e.unmoved.z += z;
}

function newResult(): DamageResult {
  return { dealt: 0, killed: false, headshot: false, severed: [], blocked: false };
}

/** What stopped a hit short of the body, if anything did. */
export type HitStop = 'none' | 'plate' | 'shield' | 'ward' | 'entrance';

/**
 * What the model found a hit did, beyond its `DamageResult`. On the machine that decides (solo, or a co-op host) it is
 * written by every `apply` (`DamageModel.found`) and sent to the other screens; there it comes back in as what a hit they
 * did not decide is shown by (`DamageModel.show`). Everything a screen needs to draw the same hit and nothing it could work
 * out for itself.
 */
export interface HitFacts {
  /** Health the hit took, after every multiplier and whatever armour let through: the wound's severity and the reaction's size. For a stopped round, what it would have taken. */
  amount: number;
  stop: HitStop;
  armour: ArmourOutcome | undefined;
  /** The plate it met, as an index into the body's plates, or -1; and whether that broke it. */
  plate: number;
  broke: boolean;
  headshot: boolean;
  /** What the body did about it (reactions.ts), after wounds and blasts had their say. */
  level: ReactionLevel;
  strength: number;
  knockout: boolean;
  tripped: boolean;
  /** What a blast's ring rolled for this body, or null. */
  blast: BlastOutcome | null;
}

export function newFacts(): HitFacts {
  return { amount: 0, stop: 'none', armour: undefined, plate: -1, broke: false, headshot: false, level: 'flinch', strength: 0, knockout: false, tripped: false, blast: null };
}

function copyFacts(to: HitFacts, from: HitFacts): HitFacts {
  to.amount = from.amount;
  to.stop = from.stop;
  to.armour = from.armour;
  to.plate = from.plate;
  to.broke = from.broke;
  to.headshot = from.headshot;
  to.level = from.level;
  to.strength = from.strength;
  to.knockout = from.knockout;
  to.tripped = from.tripped;
  to.blast = from.blast;
  return to;
}

/** What the deciding machine found about a kill that the others cannot work out: see `DamageModel.killShown`. */
export interface KillFacts {
  /** Health the killing hit took, for the wound it leaves on the way (0: it left none). Left out, none. */
  wound?: number;
  blast: BlastOutcome | null;
  /** It was frozen: it shatters. */
  shatter: boolean;
  /** A very damaging round to the head (`heavyHead`): it bursts. */
  heavyHead: boolean;
}

/** A level that puts the body on the floor. */
export const floors = (level: ReactionLevel): boolean => level === 'fall' || level === 'felled' || level === 'thrown';

export class DamageModel {
  private readonly results: DamageResult[] = Array.from({ length: RESULT_RING }, newResult);
  private head = 0;
  private readonly blastBody: BlastBody = { health: 0, maxHealth: 0, machine: false, fireproof: false };
  private readonly blastRoll: BlastRoll = { outcome: 'thrown', amount: 0, fatal: false };
  /** A guest is showing a death (`killShown`): nothing is cut on the way. */
  private dying = false;
  /** A guest is showing a cut its own player's shot made (`severShown`). */
  private mine = false;
  /** What has come up so far in the blast `seenIn`, so that one crowd does not all go the same way. */
  private readonly seen = new Uint8Array(OUTCOME_COUNT);
  private seenIn = -1;
  /** Pellets of the blast on this frame that have met each plate, so a blast's pellets are counted together. */
  private readonly volley = new Map<Plate, number>();
  private volleyAt = -1;
  /** Pellets of this frame's blast on the head the last hit struck, counting it. 0 for anything else. */
  private headVolley = 0;
  /** Limbs the blast `seenIn` has taken so far. */
  private cuts = 0;
  private readonly seam: DamageInfo = { amount: 0, type: 'explosive', point: new THREE.Vector3(), dir: new THREE.Vector3(), force: 0, source: '' };
  /**
   * False while a hit is only being shown (a co-op guest: `predict`, `show`, `severShown`, `killShown`): nothing the host
   * owns is touched then, no health, armour, limb pool, status or death, and nothing is cut or killed that the host has not
   * said. Everything that is seen and heard runs the same lines either way, which is what keeps the screens from drifting.
   */
  private facts = true;
  /**
   * Co-op guest: start a death this machine is sure of on the frame of the shot (net/world/hits.ts sets it from the player's
   * setting). Off, the body waits for the host's word as before, and `DamageResult.sure` is never set.
   */
  predictKills = false;
  /** The deciding machine's findings about the hit being shown, or null when this machine works them out (`apply`, `predict`). */
  private told: HitFacts | null = null;
  /** As `told`, for a death being shown. */
  private toldKill: KillFacts | null = null;
  /** What the last `apply` or `predict` found: read at once, before the next hit. */
  readonly found: HitFacts = newFacts();
  /** `found` as it stood when a tank went up inside a hit, one per blast in progress (`blowTank`). */
  private readonly foundKept: HitFacts[] = [newFacts(), newFacts(), newFacts(), newFacts()];
  private blowing = 0;
  /** What the last kill decided here found (`KillFacts`). */
  readonly foundKill: KillFacts = { blast: null, shatter: false, heavyHead: false, wound: 0 };
  /**
   * Co-op: the eye of whoever fired, when that is not the local player (the host applying a guest's claim, a guest shown a
   * teammate's hit). Null for the local player's own. Gore's choices by range go by it (`DamageInfo.from`).
   */
  shooter: THREE.Vector3 | null = null;

  constructor(private readonly w: AiWorld, private readonly m: EnemyManager) {}

  /**
   * What this body's wounds leave each limb (`LimbStrength`), for gore: a man's from his wounds (`Injuries.strength`), anything
   * else's from its limb pools, and a broken limb `FRACTURED` either way. One shared object, filled each call.
   */
  strengthOf(e: Enemy): LimbStrength {
    if (!STRENGTH_PASS) {
      _strength.legL = _strength.legR = _strength.armL = _strength.armR = _strength.trunk = _strength.neck = 1;
      return _strength;
    }
    const body = this.m.outpost?.wounds.bodyOf(e);
    if (!body) return poolStrengths(e, _strength);
    body.strength(this.w.now, _strength);
    const c = e.char;
    if (c.isFractured(B.thighL) || c.isFractured(B.shinL)) _strength.legL = Math.min(_strength.legL, FRACTURED);
    if (c.isFractured(B.thighR) || c.isFractured(B.shinR)) _strength.legR = Math.min(_strength.legR, FRACTURED);
    return _strength;
  }

  /** What can break this body. A husk on the Outpost is still a husk. */
  private rules(e: Enemy): FactionRules {
    return this.m.outpost?.wounds.bodyOf(e) ? FACTIONS[ACTIVE.def.faction] : FACTIONS.swarm;
  }

  private result(): DamageResult {
    const r = this.results[this.head]!;
    this.head = (this.head + 1) % RESULT_RING;
    r.dealt = 0;
    r.killed = r.headshot = r.blocked = false;
    r.armour = undefined;
    r.killSoon = r.doomed = undefined;
    r.sure = undefined;
    r.severed.length = 0;
    return r;
  }

  apply(e: Enemy, d: DamageInfo): DamageResult {
    return this.run(e, d);
  }

  /**
   * Co-op guest: the local player's own hit on a copy of the host's enemy, shown at once. The same lines as `apply` with the
   * facts left alone: the wound at its real size, blood, plate wear, the flinch, stagger or fall, the voice. No health,
   * armour or limb comes off and nothing dies: those are the host's, and its answer corrects what this guessed wrong.
   * `killSoon` on the result is the guess that the host will call it a kill.
   */
  predict(e: Enemy, d: DamageInfo): DamageResult {
    this.facts = false;
    try {
      return this.run(e, d);
    } finally {
      this.facts = true;
    }
  }

  /** Co-op guest: a hit the host decided (a teammate's, the host's own, the world's), shown from its findings. */
  show(e: Enemy, d: DamageInfo, told: HitFacts): DamageResult {
    this.facts = false;
    this.told = told;
    try {
      return this.run(e, d);
    } finally {
      this.facts = true;
      this.told = null;
    }
  }

  /**
   * Co-op guest: what the host's body did about a hit this machine has already drawn (its own, guessed otherwise): the
   * reaction alone, and what a blast's ring did that only the host could roll. No second wound.
   */
  reactShown(e: Enemy, d: DamageInfo, told: HitFacts, reaction = true): void {
    if (!e.alive) return;
    this.facts = false;
    this.told = told;
    try {
      let region: GoreRegion = d.region ?? 'chest';
      if (e.def.wholeLimbs) region = WHOLE_LIMB[region] ?? region;
      const blast = this.blastTold(told);
      if (blast) this.blastShown(e, d, blast);
      if (reaction) this.react(e, d, region, told.amount, this.result(), blast !== null && !OUTCOMES[blast.outcome].stands);
    } finally {
      this.facts = true;
      this.told = null;
    }
  }

  private run(e: Enemy, d: DamageInfo): DamageResult {
    const res = this.result();
    if (!e.alive) return res;
    const facts = this.facts;
    const told = this.told;
    const found = this.found;
    found.amount = 0;
    found.stop = 'none';
    found.armour = undefined;
    found.plate = -1;
    found.broke = found.headshot = found.knockout = found.tripped = false;
    found.level = 'flinch';
    found.strength = 0;
    found.blast = null;
    d.from = this.shooter ?? undefined;

    if (told ? told.stop === 'entrance' : e.entrance === 'boss') {
      found.stop = 'entrance';
      return this.blocked(e, d, res);
    }

    const area = AREA_TYPES.has(d.type);
    if (told ? told.stop === 'ward' : e.ward > 0 && d.type !== 'true' && d.type !== 'fire') {
      found.stop = 'ward';
      found.armour = 'stopped';
      this.hitWard(e, d, res);
      return res;
    }
    if (told ? told.stop === 'shield' : e.shield && this.shieldStops(e, d, res)) {
      found.stop = 'shield';
      found.armour = 'stopped';
      this.shieldHit(e, d, res);
      return res;
    }

    let region: GoreRegion = d.region ?? 'chest';
    if (e.def.wholeLimbs) region = WHOLE_LIMB[region] ?? region;

    // A tank going up is the host's blast: a guest hears of it as the kill and the explosion.
    if (facts && e.def.tank && !e.tankBlown && this.tankStruck(e, d, region)) {
      this.blowTank(e, d);
      // The tank going up is the kill. Fall through with enough damage to finish it.
      return this.lethal(e, d, res, region, false);
    }

    const wounds = this.m.outpost?.wounds ?? null;
    const body = wounds?.bodyOf(e) ?? null;
    const placed = body ? wounds!.read(e, d, region) : null;
    const headMul = d.headshotMult ?? REGION_DAMAGE.head;
    let amount = d.amount * (area ? 1 : region === 'head' ? headMul : REGION_DAMAGE[region]);
    const kneeling = body !== null && wounds!.kneeling(e);
    if (body) amount = wounds!.priced(placed, d, amount, region, kneeling);
    res.headshot = region === 'head' && !area && (placed === null || (placed.zone === 'head' && !placed.glancing));
    if (told) {
      amount = told.amount;
      res.headshot = told.headshot;
    }
    this.headVolley = region === 'head' && !area ? this.w.ctx.gore.headPellets(e.char, d) : 0;

    // A plate does nothing about a fire, or about blood that is already leaving.
    const reaches = (!body || d.type === 'explosive' || !area) && !kneeling;
    // A round that goes through armour takes the armour with it: the Sabot's dart deletes the piece it passes, a shaped
    // charge on the body strips every plate he wears (only the one it hit on a boss, so one rocket cannot skip his phases).
    if (reaches && d.pierces && (told ? told.armour === 'broken' : e.armor > 0)) this.tearOff(e, region, d, res);
    const plate = !reaches || d.pierces ? null : told ? e.plates[told.plate] ?? null : area ? this.blastPlate(e) : this.plateFor(e, region, d);
    if (plate) {
      const shred = d.source === 'piledriver' ? PILEDRIVER_SHRED : 1;
      // What the plate loses, and what of the round gets past it.
      let wear: number;
      let through: number;
      if (told) {
        wear = told.broke ? plate.hp : 0;
        through = told.stop === 'plate' ? 0 : amount;
      } else if (e.isBoss || area) {
        // Bosses keep the soak their phases were tuned on, and a blast chips whatever plate is left. What breaks through
        // only half lands; the rest went into tearing the plate off.
        const absorbed = Math.min(plate.hp / shred, amount);
        wear = absorbed * shred;
        through = (amount - absorbed) * 0.5;
      } else {
        // One rule in every mode, by the class of the round (docs/proposals/armour-and-headshots-plan.md, section 2).
        ({ wear, through } = armourHit(this.armourClass(plate, d), plate.hp, d.amount, amount, shred, d.load));
      }
      if (facts) e.armor = Math.max(0, e.armor - Math.min(wear, plate.hp));
      // A guest wears its own copy of the plate, as its best guess at the host's.
      plate.hp -= wear;
      const broken = told ? told.broke : plate.hp <= 0;
      if (broken) this.shootOff(e, plate, d);
      if (body && facts) wounds!.onPlate(e, plate, d, region);
      res.armour = broken ? 'broken' : through <= 0 ? 'stopped' : 'through';
      found.plate = e.plates.indexOf(plate);
      found.broke = broken;
      found.armour = res.armour;
      if (through <= 0) {
        res.blocked = true;
        res.headshot = false;
        res.dealt = amount;
        found.stop = 'plate';
        found.amount = amount;
        this.react(e, d, region, amount, res);
        this.emitHit(e, d, res);
        return res;
      }
      amount = through;
    }
    if (res.armour) found.armour = res.armour;

    if (!told) {
      if (e.frozen > 0 && amount >= 4) amount *= 3;
      // A boss's phases are the host's to move: a guest shows the hit at its plain size.
      if (e.boss && facts) amount = e.boss.filter(e, this.w, amount, d, region);
    }

    // A blast's ring is rolled once, by whoever decides: a guest's own blast shows as a plain hit until the host says.
    const blast = told ? this.blastTold(told) : facts ? this.rolled(e, d, amount) : null;
    if (blast && !told) amount = blast.amount;

    if (facts) {
      e.health -= amount;
      // A dart's hole bleeds on (EnemyManager drains it); an incendiary round sometimes lights him. Not a boss or a machine.
      if (!e.isBoss && !e.def.machine) e.darts += dartBleed(d.load, amount);
      if (e.health > 0 && !e.def.fireproof && ignites(d.load, Math.random())) this.ignite(e, AMMO.api.burn);
    }
    // Before the death is picked, so a killing shot leaves its mark on the body too.
    if (this.w.ctx.gore.wound(e.char, d, blast?.outcome === 'flesh' ? 1 : amount / e.maxHealth)) this.updateMaim(e);
    res.dealt = amount;
    found.amount = amount;
    found.headshot = res.headshot;
    found.blast = blast?.outcome ?? null;

    if (!facts) {
      // Health, the pools' cuts and the death are the host's. A guest keeps its own count of the pools, for how the body
      // carries itself, and guesses the kill for the shooter's ears and eyes alone.
      if (!told) {
        // Already reckoned dead by an earlier hit of this player's: this one met a corpse, as far as the shooter is told.
        if (!body && !e.isBoss && e.health - e.owed <= 0) res.doomed = true;
        else res.killSoon = body ? this.woundKills(placed, res) : this.wouldKill(e, false, region, amount);
        if (res.killSoon && this.predictKills) res.sure = this.sureKill(e, d, region, amount, res, body !== null, area);
      }
      if (blast) this.blastShown(e, d, blast);
      else if (!area && region !== 'head') this.spendLimb(e, region, d, res);
      // Sure of the kill: it goes down limp now, in place of the flinch a living body would give (the whole death, when it is
      // beyond doubt, is the caller's to start: `predictKill`). With no room on the floor it reacts as it would have.
      if (res.sure === 'fall' && !this.fellForDead(e, d, region, amount)) res.sure = undefined;
      if (!res.sure) this.react(e, d, region, amount, res, blast !== null && !OUTCOMES[blast.outcome].stands);
      this.emitHit(e, d, res);
      return res;
    }

    const headPool = region === 'head' ? this.spendPool(e, 'head', amount) : Infinity;
    const spent = e.health <= 0 || headPool <= 0;
    if (blast?.fatal || (body ? wounds!.take(e, body, placed, d, amount, spent) : spent)) return this.lethal(e, d, res, region, true, blast);

    if (blast) this.blastWound(e, d, res, blast);
    else if (area) this.blastLimb(e, d, res);
    else this.spendLimb(e, region, d, res);

    if (!e.alive) return res;
    this.react(e, d, region, amount, res, blast !== null && !OUTCOMES[blast.outcome].stands);
    this.emitHit(e, d, res);
    return res;
  }

  /** `enemy:hit`, for a hit decided or guessed here. A hit only shown (a teammate's) is not this player's news. */
  private emitHit(e: Enemy, d: DamageInfo, res: DamageResult): void {
    if (!this.told && !res.doomed) this.m.emitHit(e, d, res);
  }

  /**
   * A guest's guess that the host will call this hit a kill: its health as last heard, less what the guest's own hits still
   * unanswered should take (`Enemy.owed`), will not outlast it. Never for a body with anatomy (his wounds decide that, on
   * the host), a boss, or a body the host may be about to blow up.
   */
  /**
   * A guest's guess for a man with anatomy, whose death is his wounds' to decide on the host (wounds/index.ts
   * `takePlaced`): a round that reached his brain or his heart kills him outright there, whatever his health, and nothing
   * else is known from here. The claim carries the hit in the struck bone's own axes (net/world/claims.ts), so the host
   * reads the same place on its own body that this machine read on its copy.
   */
  private woundKills(placed: ZoneHit | null, res: DamageResult): boolean {
    if (!placed || res.blocked) return false;
    return (placed.zone === 'head' && !placed.glancing) || placed.zone === 'heart';
  }

  private wouldKill(e: Enemy, anatomy: boolean, region: GoreRegion, amount: number): boolean {
    if (anatomy || e.isBoss || amount <= 0) return false;
    if (region === 'head' && (e.limbHp.get('head') ?? Infinity) - amount <= 0) return true;
    return e.health - e.owed - amount <= 0;
  }

  /**
   * A guest's own hit that it has just guessed is a kill: is this machine sure enough to start the death now? Only for a
   * body whose death is plain arithmetic on the host: no anatomy (a man's wounds decide his death), no boss, nothing that
   * dies its own way (a drone's crash, a tank that may blow, a machine), no armour, shield, ward or frost in the sum, and
   * not a blast (the host rolls its ring).
   * `fall`: what is left of it, by the host's own answers less this player's hits still in the air, is under the hit by
   * `SURE_MARGIN` of its whole health. `kill`: by three times and half its health to spare, and nothing in the death is
   * the host's to roll (a blast's ring is).
   */
  private sureKill(e: Enemy, d: DamageInfo, region: GoreRegion, amount: number, res: DamageResult, anatomy: boolean, area: boolean): DamageResult['sure'] {
    if (anatomy || e.isBoss || !profileOf(e) || e.def.tank || e.def.id === 'drone') return undefined;
    if (res.blocked || res.armour !== undefined || e.ward > 0 || e.entrance !== 'none' || e.shield || e.frozen > 0 || e.pinned) return undefined;
    // A blast's ring is the host's to roll, and the roll sets what the blast does to this body, its damage with it
    // (`rolled`): this machine's sum is not the host's. In the noisy proof every body that got up again had been dropped
    // by a rocket's blast.
    if (d.reach !== undefined && d.blastKind !== undefined) return undefined;
    const head = region === 'head' && !area;
    const rest = Math.min(e.health - e.owed, head ? e.limbHp.get('head') ?? Infinity : Infinity);
    if (!(rest > 0)) return undefined;
    const over = amount - rest;
    if (over < Math.max(SURE_MARGIN_MIN, e.maxHealth * SURE_MARGIN)) return undefined;
    return !area && amount >= rest * SURE_KILL_TIMES && over >= e.maxHealth * SURE_KILL_OVER ? 'kill' : 'fall';
  }

  /**
   * A guest's copy drops for dead: off its feet at once and limp, by the hit that this machine is sure killed it. It is a
   * knockdown and not a corpse, because the death is still the host's word: `kill` turns it into the corpse where it lies,
   * and if the host says it lives it gets up from the floor (net/world/hits.ts, replicas.ts), as from any knockdown.
   * False when it could not go down (already down is true: it lies where it is).
   */
  private fellForDead(e: Enemy, d: DamageInfo, region: GoreRegion, amount: number): boolean {
    const profile = profileOf(e);
    if (!profile || !e.alive) return false;
    const char = e.char;
    const frac = clamp(amount / e.maxHealth, 0, 1);
    char.hitFlash(clamp(0.55 + frac * 2, 0.55, 1));
    if (d.type !== 'fire' && d.type !== 'shock') {
      e.blood = Math.min(1, e.blood + 0.08 + frac * 1.1);
      char.setBloodiness(e.blood);
    }
    if (e.downed) return true;
    const bone = d.bone ?? REGION_BONE[region] ?? 0;
    _fall.copy(d.dir).setY(0);
    if (_fall.lengthSq() < 1e-6) _fall.set(Math.sin(e.yaw), 0, Math.cos(e.yaw)).negate();
    const force = d.force || DEFAULT_FORCE[d.type];
    const strength = clamp(force / FELL_FORCE, FELL_MIN, 1);
    e.fallIn = 0;
    return this.knockDown(e, _fall.normalize(), strength, bone, profile, AREA_TYPES.has(d.type), knockAs(undefined, undefined, true, d.point));
  }

  /**
   * A guest's guess at what only the host finds about a death, for one this machine plays itself beyond doubt
   * (`sure: 'kill'`): no blast (never predicted), not frozen (never predicted), the head by the same rule the host uses.
   * Marks the round as the host would for a trunk it opens (`torso`).
   */
  guessKill(e: Enemy, d: DamageInfo, out: KillFacts): KillFacts {
    const region: GoreRegion = d.region ?? 'chest';
    out.blast = null;
    out.shatter = false;
    out.heavyHead = region === 'head' && !AREA_TYPES.has(d.type) && this.heavyHead(e, d);
    out.wound = 0;
    if (d.torso === undefined && !e.def.machine && blowsOut(d, e.position.distanceTo(this.w.player.position))) d.torso = 'blowout';
    return out;
  }

  /** The ring's roll as the host made it, for a hit being shown. */
  private blastTold(told: HitFacts): BlastRoll | null {
    if (told.blast === null) return null;
    const roll = this.blastRoll;
    roll.outcome = told.blast;
    roll.amount = told.amount;
    roll.fatal = false;
    return roll;
  }

  /** What the ring did to a body that lives, as far as it shows: the limbs it took come as cuts of their own. */
  private blastShown(e: Enemy, d: DamageInfo, blast: BlastRoll): void {
    const rule = OUTCOMES[blast.outcome];
    if (blast.outcome === 'flesh') this.open(e, d);
    if (rule.stands) {
      e.char.anim.daze?.(BLAST.dazed);
      this.stagger(e, BLAST.dazed);
    }
  }

  /** The ring this body stood in has its say, or null for anything but a blast's splash. Bosses only take the damage. */
  private rolled(e: Enemy, d: DamageInfo, amount: number): BlastRoll | null {
    if (d.reach === undefined || d.blastKind === undefined || e.isBoss) return null;
    if (d.explosionId !== this.seenIn) {
      this.seenIn = d.explosionId ?? -1;
      this.seen.fill(0);
      this.cuts = 0;
    }
    const body = this.blastBody;
    body.health = e.health;
    body.maxHealth = e.maxHealth;
    body.machine = e.def.machine === true;
    body.fireproof = e.def.fireproof === true;
    return rollBlast(body, d.blastKind, d.reach, amount, this.seen, this.blastRoll);
  }

  /** What the ring did to a body that lives. */
  private blastWound(e: Enemy, d: DamageInfo, res: DamageResult, blast: BlastRoll): void {
    const rule = OUTCOMES[blast.outcome];
    this.tear(e, d, res, rule);
    if (!e.alive) return;
    if (blast.outcome === 'flesh') this.open(e, d);
    if (rule.fire !== undefined) this.ignite(e, rule.fire);
    if (rule.stands) {
      e.char.anim.daze?.(BLAST.dazed);
      this.stagger(e, BLAST.dazed);
    }
  }

  /** Takes the limbs a roll asked for, skipping any already gone. */
  private tear(e: Enemy, d: DamageInfo, res: DamageResult | null, rule: OutcomeRule): void {
    if (!DevFlags.gibbing) return;
    if (rule.arms) this.takeLimbs(e, d, res, BLAST_ARMS, rule.arms);
    if (rule.legs) this.takeLimbs(e, d, res, BLAST_LEGS, rule.legs);
    if (rule.any) this.takeLimbs(e, d, res, BLAST_LIMBS, rule.any);
  }

  private takeLimbs(e: Enemy, d: DamageInfo, res: DamageResult | null, from: readonly GoreRegion[], count: number): void {
    const start = Math.floor(rand(0, from.length));
    for (let i = 0; i < from.length && count > 0 && this.cuts < BLAST.cuts; i++) {
      const region = from[(start + i) % from.length]!;
      if (!e.limbHp.has(region) || e.char.severed.has(region)) continue;
      this.sever(e, region, d, res);
      if (e.char.severed.has(region)) {
        count--;
        this.cuts++;
      }
    }
  }

  /** A second opening round the side of the first, so that it reads as a body laid open and not as one big hole. */
  private open(e: Enemy, d: DamageInfo): void {
    const seam = this.seam;
    seam.amount = d.amount;
    seam.source = d.source;
    seam.point.copy(d.point);
    seam.dir.copy(d.dir).applyAxisAngle(UP, chance(0.5) ? FLESH_TURN : -FLESH_TURN);
    this.w.ctx.gore.wound(e.char, seam, 1);
    e.blood = 1;
    e.char.setBloodiness(1);
  }

  ignite(e: Enemy, seconds: number): void {
    e.burning = Math.max(e.burning, seconds);
    this.m.outpost?.wounds.caughtFire(e);
  }

  private blocked(e: Enemy, d: DamageInfo, res: DamageResult): DamageResult {
    res.blocked = true;
    this.emitHit(e, d, res);
    return res;
  }

  private spendPool(e: Enemy, region: GoreRegion, amount: number): number {
    const left = (e.limbHp.get(region) ?? Infinity) - amount;
    e.limbHp.set(region, left);
    return left;
  }

  private spendLimb(e: Enemy, region: GoreRegion, d: DamageInfo, res: DamageResult): void {
    if (!e.limbHp.has(region) || region === 'head' || e.char.severed.has(region)) return;
    const hit = d.amount * (d.severMult ?? 1) * SEVER_FACTOR[d.type] * this.rules(e).limbWear;
    if (hit <= 0) return;
    // A guest keeps count and cuts nothing: the limb comes off when the host says it did.
    if (this.spendPool(e, region, hit) <= 0 && this.facts) this.sever(e, region, d, res);
  }

  /** An explosive hit with no ring to answer to, a rocket's own contact or a boss in a blast, works the limb pools. */
  private blastLimb(e: Enemy, d: DamageInfo, res: DamageResult): void {
    const rules = this.rules(e);
    if (d.type !== 'explosive' || e.def.machine || !chance(rules.blastLimb)) return;
    const region = pick(BLAST_LIMBS);
    if (e.limbHp.has(region) && !e.char.severed.has(region)) {
      const hit = d.amount * (d.severMult ?? 1) * SEVER_FACTOR.explosive * rules.limbWear;
      if (this.spendPool(e, region, hit) <= 0) this.sever(e, region, d, res);
    }
  }

  sever(e: Enemy, region: GoreRegion, d: DamageInfo, res: DamageResult | null): void {
    // Showing a death the host decided: the limbs it took with it came as cuts of their own, ahead of it.
    if (this.dying) return;
    const { ctx } = this.w;
    // The limb leaves at the speed the body was going, the same as the body it leaves when this is a death.
    const at = e.def.severAt?.[region] ?? region;
    const cut = ctx.gore.sever(e.char, at, d, deathVelocity(e, _dying, this.w.now));
    if (!cut) return;
    ctx.audio.play('limb_sever', { position: cut.stump, pitchJitter: 0.08 });
    if (!e.def.machine) say(e, this.w, 'vox_scream', 0.8);
    for (let i = 0; i < cut.regions.length; i++) {
      const r = cut.regions[i]!;
      e.limbHp.delete(r);
      res?.severed.push(r);
      // Decided here, or the shooter's own cut on a guest. A cut a teammate made is not this player's news.
      if (this.facts || this.mine) ctx.events.emit('enemy:severed', i === 0 ? { enemy: e, region: r, damage: d, cut: at } : { enemy: e, region: r, damage: d });
    }
    this.updateMaim(e);
    if (!this.facts) return;
    this.m.outpost?.wounds.onSevered(e, region);
    e.def.onLimbLost?.(e, this.w, region);
    e.boss?.onLimbLost(e, this.w, region);
  }

  /**
   * Co-op guest: a cut the host decided, made through the same path as the host's: the limb, its sound, the scream, and
   * what is left of the body read again (`updateMaim`: a body without legs crawls). `region` is where the cut was made.
   * `mine`: the local player's shot took it, so it is their `enemy:severed` (score, the run report, the sound).
   */
  severShown(e: Enemy, region: GoreRegion, d: DamageInfo, mine: boolean): void {
    if (e.char.severed.has(region)) return;
    this.facts = false;
    this.mine = mine;
    d.from = this.shooter ?? undefined;
    try {
      this.sever(e, region, d, null);
    } finally {
      this.facts = true;
      this.mine = false;
    }
  }

  /**
   * Co-op guest: the death the host decided, through the one kill flow, with what the host found that this machine cannot
   * (`KillFacts`): the ring's roll, so a body torn at the waist is torn here; that it was frozen, so it shatters; and
   * whether the round bursts a head. The ragdoll, the gibs and where they land are this machine's own.
   */
  killShown(e: Enemy, d: DamageInfo, told: KillFacts): void {
    this.facts = false;
    this.toldKill = told;
    d.from = this.shooter ?? undefined;
    const roll = told.blast === null ? null : this.blastRoll;
    if (roll) {
      roll.outcome = told.blast!;
      roll.amount = d.amount;
      roll.fatal = true;
    }
    try {
      // The killing round leaves its mark first, as it does where the kill was decided.
      if (told.wound && e.alive && this.w.ctx.gore.wound(e.char, d, told.blast === 'flesh' ? 1 : told.wound / e.maxHealth)) this.updateMaim(e);
      this.kill(e, d, d.region ?? 'chest', null, roll);
    } finally {
      this.facts = true;
      this.toldKill = null;
    }
  }

  /** Re-reads what is left of the body. The AI layers react through `requires` and scores; nothing else is needed. */
  updateMaim(e: Enemy): void {
    if (e.def.machine) return;
    const s = e.char.severed;
    const m = e.maim;
    const legL = s.has('legL') || s.has('shinL');
    const legR = s.has('legR') || s.has('shinR');
    const c = e.char;
    const body = this.m.outpost?.wounds.bodyOf(e) ?? null;
    const armL = s.has('armL') || s.has('forearmL') || c.isFractured(B.upperArmL) || c.isFractured(B.foreArmL) || (body?.armL ?? false) || (body?.handL ?? false);
    const armR = s.has('armR') || s.has('forearmR') || c.isFractured(B.upperArmR) || c.isFractured(B.foreArmR) || (body?.armR ?? false) || (body?.handR ?? false);
    m.legs = (legL ? 0 : 1) + (legR ? 0 : 1);
    // A broken leg still drags along. Crawling is for a body that has lost the legs, which the animator can see.
    if (m.legs > 1 && (c.isFractured(B.thighL) || c.isFractured(B.shinL) || c.isFractured(B.thighR) || c.isFractured(B.shinR))) m.legs = 1;
    // A wound takes the legs without taking them off. Everything that reads `legs` already knows what a man on the floor can do.
    if (body?.floored) m.legs = 0;
    else if (body && m.legs > 1 && body.limp !== 0) m.legs = 1;
    m.arms = (armL ? 0 : 1) + (armR ? 0 : 1);
    m.gunArm = !armR;
    m.offArm = !armL;
    m.head = !s.has('head');
    const open = 4 - m.legs - m.arms;
    // Wounds keep their own account of blood. See `WoundSystem.syncBody`.
    if (!body) e.bleed = e.isBoss ? 0 : open * e.maxHealth * 0.022;

    if (armL && e.shield) {
      // The shield went with the arm. It stops guarding and comes at you.
      e.shield = false;
      e.face = 'move';
      this.w.ctx.audio.play('riot_shield_break', { position: e.center });
    }
    if (e.attack?.requires && !e.attack.requires(e)) finishAttack(e, this.w, true);
    if (e.pinned && (m.legs < 2 || m.arms === 0)) dropOff(e);
    // Force a fresh choice now. Waiting for the next think would show a beat of the old behaviour on the new body.
    e.thinkAt = 0;
    e.behaviourUntil = 0;
  }

  private plateFor(e: Enemy, region: GoreRegion, d: DamageInfo): Plate | null {
    for (let i = 0; i < e.plates.length; i++) {
      const p = e.plates[i]!;
      if (p.hp <= 0 || !p.spec.regions.includes(region)) continue;
      if (p.spec.facing) {
        const behind = Math.sin(e.yaw) * d.dir.x + Math.cos(e.yaw) * d.dir.z > 0;
        if (behind !== (p.spec.facing === 'back')) continue;
      }
      return p;
    }
    return null;
  }

  /** An armour-piercing round or a shaped charge on the body: the armour in its way is gone, and the round lands in full. */
  private tearOff(e: Enemy, region: GoreRegion, d: DamageInfo, res: DamageResult): void {
    const all = !d.armorPiercing && !e.isBoss;
    // A dart only takes what covers the spot it hit; a charge on a boss takes the nearest plate it can find.
    const only = all ? null : this.plateFor(e, region, d) ?? (d.armorPiercing ? null : this.blastPlate(e));
    if (!all && !only) return;
    let torn = 0;
    for (let i = 0; i < e.plates.length; i++) {
      const p = e.plates[i]!;
      if (p.hp <= 0 || (only && p !== only)) continue;
      if (this.facts) e.armor = Math.max(0, e.armor - p.hp);
      this.shootOff(e, p, d);
      torn++;
    }
    if (torn === 0) return;
    res.armour = 'broken';
    // Any armour a direct rocket or shell tears off crunches, one plate or six. A dart's deletion is the broken cue alone.
    if (all) this.w.ctx.audio.play('armour_crunch', { position: e.center, pitchJitter: 0.05 });
  }

  /**
   * The class a round meets this plate as. A shotgun's pellets are counted per blast: the first on a piece bounces off, the
   * second wrecks it (medium), and the rest find nothing in their way.
   */
  private armourClass(plate: Plate, d: DamageInfo): ArmourClass {
    if (d.type === 'pellet') {
      if (this.volleyAt !== this.w.now) {
        this.volleyAt = this.w.now;
        this.volley.clear();
      }
      const hits = (this.volley.get(plate) ?? 0) + 1;
      this.volley.set(plate, hits);
      return hits >= 2 ? 'medium' : 'light';
    }
    return d.armour ?? classOf(d.source, d.amount);
  }

  /** A very damaging round to the head: one of `HEAD_BURSTERS`, four pellets of a blast, or the Judge up close. */
  private heavyHead(e: Enemy, d: DamageInfo): boolean {
    if (d.type === 'pellet') return this.headVolley >= HEAD_VOLLEY;
    if (HEAD_BURSTERS.has(d.source)) return true;
    return d.source === 'judge' && e.position.distanceTo(this.w.player.position) < JUDGE_BURST_RANGE;
  }

  /** A burst head throws off the helmet still on it, so none is left over the neck. */
  private throwHelmet(e: Enemy, d: DamageInfo): void {
    for (const plate of e.plates) {
      if (plate.hp <= 0 || !plate.spec.regions.includes('head')) continue;
      plate.hp = 0;
      this.m.debris.launch(plate, d.dir);
    }
  }

  /** Every plate still on him flies off ahead of what is about to happen to the body under it. */
  private platesOff(e: Enemy, dir: THREE.Vector3): void {
    for (const plate of e.plates) {
      if (plate.hp <= 0) continue;
      plate.hp = 0;
      this.m.debris.launch(plate, dir);
    }
  }

  /** A blast chips whichever plate is left. */
  private blastPlate(e: Enemy): Plate | null {
    for (let i = 0; i < e.plates.length; i++) {
      const p = e.plates[i]!;
      if (p.hp > 0) return p;
    }
    return null;
  }

  private shootOff(e: Enemy, plate: Plate, d: DamageInfo): void {
    const { ctx } = this.w;
    plate.hp = 0;
    plate.mesh.getWorldPosition(_v);
    this.m.debris.launch(plate, _n.copy(d.dir).negate());
    ctx.fx.sparks(_v, _n, 18, 0xffe0a0);
    ctx.fx.ring(_v, _n, 0xffd0a0, 1.1);
    ctx.audio.play('armor_plate_off', { position: _v, pitchJitter: 0.08 });
    if (this.facts) e.boss?.onPlateLost?.(e, this.w);
  }

  private hitWard(e: Enemy, d: DamageInfo, res: DamageResult): void {
    const { ctx } = this.w;
    if (this.facts) e.ward -= d.amount;
    res.blocked = true;
    res.armour = 'stopped';
    this.w.telegraphs.flashWard(e.wardVisual);
    e.char.hitFlash(0.25);
    if (this.facts && e.ward <= 0) {
      this.m.dropWard(e);
      ctx.fx.ring(e.center, _n.set(0, 1, 0), 0xffe9a0, 1.8);
      ctx.fx.sparks(e.center, _n, 14, 0xffe9a0);
    }
    this.emitHit(e, d, res);
  }

  private shieldStops(e: Enemy, d: DamageInfo, res: DamageResult): boolean {
    const facing = Math.sin(e.yaw) * d.dir.x + Math.cos(e.yaw) * d.dir.z;
    // Angle of the incoming shot against the body. The shield covers a little over the front half.
    if (facing > -0.35) return false;
    // Shots at the exposed gun arm or the legs below the rim still land.
    const region = d.region;
    if (region === 'armR' || region === 'forearmR' || region === 'shinL' || region === 'shinR') return false;
    // An armour-piercing dart goes through the shield as it does a plate, and lands on the man behind it.
    if (d.armorPiercing) {
      this.w.ctx.audio.play('sabot_shield_pierce', { position: d.point, pitchJitter: 0.04 });
      res.armour = 'broken';
      return false;
    }
    return true;
  }

  /** The shield took it: its ring, the arm behind it jolted, and that arm worn a little further. */
  private shieldHit(e: Enemy, d: DamageInfo, res: DamageResult): void {
    res.blocked = true;
    res.armour = 'stopped';
    const { ctx } = this.w;
    ctx.audio.play('riot_shield_hit', { position: d.point, pitchJitter: 0.1 });
    e.char.anim.flinch(B.upperArmL, d.dir, 0.3);
    if (d.type === 'explosive' || d.amount >= 40) e.char.anim.play('block', 1.4);
    // Sustained fire batters the arm behind the shield: enough of it and the arm goes, shield and all.
    const left = this.spendPool(e, 'armL', d.amount * (d.type === 'explosive' ? 0.35 : 0.22));
    if (left <= 0 && this.facts) this.sever(e, 'armL', d, res);
    this.emitHit(e, d, res);
  }

  private tankStruck(e: Enemy, d: DamageInfo, region: GoreRegion): boolean {
    const t = e.def.tank!;
    if (!t.regions.includes(region) || d.type === 'fire') return false;
    if (d.type === 'explosive') return true;
    return !t.rearOnly || Math.sin(e.yaw) * d.dir.x + Math.cos(e.yaw) * d.dir.z > 0.2;
  }

  /**
   * Credited to whoever hit it, so a player who bursts a bomber in a pack gets the whole pack. One enemy setting off
   * another is a smaller thing: a full tank at the player's feet for a kill they had no part in would be a free death.
   */
  blowTank(e: Enemy, d: DamageInfo): void {
    const { ctx } = this.w;
    const t = e.def.tank!;
    e.tankBlown = true;
    const stray = d.source in ENEMIES || d.type === 'true' || d.type === 'crush';
    // The blast goes off inside this hit and runs every body it catches through this model before it returns, each one
    // writing `found`. This hit's own findings are put back after it: what a co-op host sends of the hit and the kill.
    const kept = this.blowing < this.foundKept.length ? copyFacts(this.foundKept[this.blowing]!, this.found) : null;
    this.blowing++;
    ctx.combat.explode(e.center, {
      radius: t.radius * (stray ? STRAY_TANK_RADIUS : 1), damage: t.damage * e.damageMul * (stray ? STRAY_TANK_DAMAGE : 1),
      kind: stray ? 'enemy' : 'barrel', source: stray ? e.id : d.source, team: stray ? 'enemy' : 'player', selfDamage: TANK_SELF_DAMAGE,
    });
    this.blowing--;
    if (kept) copyFacts(this.found, kept);
  }

  private lethal(e: Enemy, d: DamageInfo, res: DamageResult, region: GoreRegion, severNow: boolean, blast: BlastRoll | null = null): DamageResult {
    res.killed = true;
    // A vaporizing kill burns the whole of him: no limb is thrown off first, to lie there bleeding.
    if (severNow && !d.vaporize && region !== 'head' && e.limbHp.has(region)) {
      const left = (e.limbHp.get(region) ?? 0) - d.amount * (d.severMult ?? 1) * SEVER_FACTOR[d.type] * this.rules(e).limbWear;
      if (left <= 0) this.sever(e, region, d, res);
    }
    this.kill(e, d, region, res, blast);
    this.emitHit(e, d, res);
    return res;
  }

  /** The single kill flow. Picks one death, tells everyone once. */
  kill(e: Enemy, d: DamageInfo, region: GoreRegion, res: DamageResult | null, blast: BlastRoll | null = null): void {
    if (!e.alive) return;
    const { ctx, player } = this.w;
    const facts = this.facts;
    const told = this.toldKill;
    e.alive = false;
    e.health = 0;
    this.m.detach(e);
    // Shown on a guest: every limb this death took came ahead of it, as a cut of its own.
    this.dying = !facts;

    // The blast is the host's: a guest hears of it as an explosion.
    if (facts && e.def.tank && !e.tankBlown && chance(e.def.tank.onDeath)) this.blowTank(e, d);

    const force = d.force || DEFAULT_FORCE[d.type];
    const wounds = this.m.outpost?.wounds ?? null;
    const body = wounds?.bodyOf(e) ?? null;
    const slowly = wounds?.isBleedOut(d) ?? false;
    const headshot = region === 'head' && !AREA_TYPES.has(d.type);
    const shatter = told ? told.shatter : e.frozen > 0;
    const heavyHead = told ? told.heavyHead : headshot && this.heavyHead(e, d);
    const found = this.foundKill;
    found.blast = blast?.outcome ?? null;
    found.shatter = shatter;
    found.heavyHead = heavyHead;
    // The hit that is killing it, if a hit is (`run` wounds before the death is picked): the other screens wound for it too.
    found.wound = res ? this.found.amount : 0;
    const blownUp = e.tankBlown || blast?.outcome === 'gib' || bursts(d);
    let gibbed = false;
    let sliced = false;

    if (e.boss) {
      e.dyingKind = 'boss';
      e.dying = e.boss.deathSeconds;
      e.boss.onDeath(e, this.w, d);
    } else if (e.def.id === 'drone') {
      this.m.startCrash(e);
    } else if (d.vaporize && !d.slicePlaneNormal && !shatter && ctx.gore.vaporize) {
      // A vaporizing cut (the energy blade) still cuts: its halves burn away (gore/sliced.ts), below.
      ctx.gore.vaporize(e.char, deathVelocity(e, _dying, this.w.now));
    } else if (DevFlags.gibbing && (shatter || (blownUp && DevFlags.explosiveDeaths))) {
      gibbed = true;
      if (shatter) ctx.fx.sparks(e.center, _n.set(0, 1, 0), 40, 0xa0e8ff);
      else if (!e.def.machine) ctx.audio.play('gib_squelch', { position: e.center, pitchJitter: 0.1 });
      this.platesOff(e, _n.copy(e.center).sub(d.point).setY(0.4).normalize());
      ctx.gore.gib(e.char, e.center, force, d);
    } else if (d.slicePlaneNormal) {
      sliced = true;
      ctx.gore.slice(e.char, d.point, d.slicePlaneNormal, d);
    } else if (headshot && !e.def.machine && d.type === 'melee') {
      // A club kills a man and leaves him his head: key 5's blunt blows, the only hits on an enemy typed 'melee'. An edge
      // takes a head with a slice plane, above.
      this.ragdoll(e, d, force, body ? HEADSHOT_TWITCH : undefined, true);
    } else if (headshot && !e.def.machine) {
      // A bullet never takes a head off whole. Gore bursts a 'partial' on an enemy whose partial wound is not built yet.
      const outcome = headOutcome(d.amount, heavyHead, e.def.id);
      const burst = outcome !== 'hole';
      const down = e.rising > 0 || body?.floored === true;
      if (burst) this.throwHelmet(e, d);
      if (!down && (burst || !body)) {
        ctx.gore.headshot(e.char, d, deathVelocity(e, _dying, this.w.now), outcome);
        if (!burst) ctx.audio.play('vox_choke', { position: e.center, pitch: e.def.voice.pitch });
      } else {
        // A man keeps the death a light round gives him; one half up or lying down has the head opened where it lies.
        this.ragdoll(e, d, force, body ? HEADSHOT_TWITCH : undefined, true);
        if (burst) ctx.gore.headshot(e.char, d, undefined, outcome);
      }
    } else if (blast?.outcome === 'head' && DevFlags.gibbing) {
      ctx.gore.headshot(e.char, d, deathVelocity(e, _dying, this.w.now));
    } else {
      if (blownUp && !DevFlags.explosiveDeaths) this.blastMaim(e, d);
      // A big round through the trunk opens its far side (src/gore/torso.ts), by how far off the shooter stood. A co-op
      // guest shown the death does what the host did.
      if (!e.def.machine && !blast && DevFlags.gibbing && (facts ? blowsOut(d, e.position.distanceTo(player.position)) : d.torso === 'blowout')) {
        this.platesOff(e, d.dir);
        ctx.gore.blowOut?.(e.char, d);
      }
      if (blast) this.blastDeath(e, d, res, blast);
      else if (DevFlags.gibbing && !e.def.machine && tearsWaist(d, region, force)) this.sever(e, 'abdomen', d, res);
      const twitch = body ? (slowly ? SLOW_TWITCH : SUDDEN_TWITCH) : undefined;
      // Section 14.1: what kills a man all at once drops him where he is. Only a clock gives him time to go.
      if (!blownUp && this.diesOnFeet(e, d, force) && (!body || slowly)) this.collapse(e, d, region, force, slowly, twitch);
      else this.ragdoll(e, d, force, twitch);
    }

    if (res) res.headshot = headshot;

    const ev: KillEvent = {
      enemy: e,
      damage: d,
      headshot,
      gibbed,
      sliced,
      severedCount: e.char.severed.size,
      playerAirborne: !ctx.player.grounded,
      playerSliding: ctx.player.sliding,
      playerWallRunning: ctx.player.wallRunning,
      playerSpeed: player.speed,
      distance: e.position.distanceTo(player.position),
      explosionId: d.explosionId ?? null,
    };
    // A man who went mortal or down on an earlier frame has had his dying line (audio's `sayDying`): one voice per man.
    if (!headshot && !((body?.dyingFrom ?? Infinity) < this.w.now)) say(e, this.w, e.def.voice.die, 0.7);
    this.dying = false;
    // A guest's own kills are told to its own game by the co-op world, once it knows whose they were (net/world/hits.ts).
    if (facts) ctx.events.emit('enemy:killed', ev);
    if (e.dyingKind === 'none') this.m.retire(e);
    else this.m.holdForDeath(e);
  }

  /** What the ring left of a body it killed. The ragdoll takes whatever comes after this. */
  private blastDeath(e: Enemy, d: DamageInfo, res: DamageResult | null, blast: BlastRoll): void {
    const rule = OUTCOMES[blast.outcome];
    if (blast.outcome === 'waist' && DevFlags.gibbing && this.cuts < BLAST.cuts) {
      this.cuts++;
      this.sever(e, 'abdomen', d, res);
    }
    this.tear(e, d, res, rule);
    if (blast.outcome === 'flesh') this.open(e, d);
    if (rule.fire !== undefined) (e.char as unknown as { setBurn(amount: number): void }).setBurn(1);
  }

  /** With explosive deaths off, what would have been a gib leaves a thrown body short of a limb or two. */
  private blastMaim(e: Enemy, d: DamageInfo): void {
    if (e.def.machine) return;
    for (let i = 0; i < 2; i++) {
      const region = pick(BLAST_LIMBS);
      if (e.limbHp.has(region) && !e.char.severed.has(region)) this.sever(e, region, d, null);
    }
  }

  /** It needs its legs under it and a hit too light to knock them away. */
  private diesOnFeet(e: Enemy, d: DamageInfo, force: number): boolean {
    return DIES_ON_FEET.has(d.type) && force <= DIES_ON_FEET_FORCE && e.maim.legs === 2 && !e.downed && e.rising <= 0
      && !e.airborne && !e.pinned && !e.def.machine;
  }

  /** Shot dead standing up: it takes a moment to go, and goes on taking rounds on the way. */
  private collapse(e: Enemy, d: DamageInfo, region: GoreRegion, force: number, slowly: boolean, twitch: number | undefined): void {
    const o = this.m.collapseOptions;
    o.duration = slowly ? rand(BLEED_COLLAPSE_MIN, BLEED_COLLAPSE_MAX) : rand(COLLAPSE_MIN, COLLAPSE_MAX);
    o.twitch = twitch;
    deathVelocity(e, o.velocity, this.w.now);
    o.strength = this.strengthOf(e);
    if (AREA_TYPES.has(d.type)) o.hit = undefined;
    else {
      const hit = this.m.collapseHit;
      hit.bone = d.bone ?? REGION_BONE[region] ?? 0;
      hit.point.copy(d.point);
      hit.dir.copy(d.dir);
      hit.force = force;
      o.hit = hit;
    }
    this.w.ctx.gore.collapse(e.char, o);
  }

  ragdoll(e: Enemy, d: DamageInfo | null, force: number, twitch?: number, limp = false): void {
    const { ctx } = this.w;
    if (d) {
      const bone = d.bone ?? REGION_BONE[d.region ?? 'chest'] ?? 0;
      _v.copy(d.dir).multiplyScalar(force);
      _v.y += force * 0.15;
      this.m.ragdollOptions.impulses![0]!.bone = bone;
      this.m.ragdollOptions.impulses![0]!.point.copy(d.point);
      this.m.ragdollOptions.impulses![0]!.impulse.copy(_v);
    } else {
      this.m.ragdollOptions.impulses![0]!.impulse.set(0, 0, 0);
    }
    deathVelocity(e, this.m.ragdollOptions.velocity!, this.w.now);
    this.m.ragdollOptions.twitch = twitch;
    this.m.ragdollOptions.limp = limp;
    ctx.gore.ragdoll(e.char, this.m.ragdollOptions);
  }

  /** Non-lethal hits always answer, on the same frame. This is the first game's biggest missing feel. */
  private react(e: Enemy, d: DamageInfo, region: GoreRegion, amount: number, res: DamageResult, throws = false): void {
    const char = e.char;
    const frac = clamp(amount / e.maxHealth, 0, 1);
    const bone = d.bone ?? (e.def.machine ? DroneBone.body : REGION_BONE[region] ?? 0);
    const armoured = res.blocked;
    const flinch = flinchSize(frac, e.def.machine === true);
    const profile = profileOf(e);

    // A body with a profile, on its feet, flinches in `respond`, which knows first whether a head hit takes it to the floor.
    // Not one on its feet on its muscles: gore has its root, the animator would read its yaw as 0, and the round lands on the
    // body itself.
    if (!profile || (e.downed && !this.w.ctx.gore.downed(char)?.standing)) char.anim.flinch(bone, d.dir, flinch);
    char.hitFlash(armoured ? 0.35 : clamp(0.55 + frac * 2, 0.55, 1));
    if (!armoured && d.type !== 'fire' && d.type !== 'shock' && !e.def.machine) {
      e.blood = Math.min(1, e.blood + 0.08 + frac * 1.1);
      char.setBloodiness(e.blood);
    }

    const pushForce = d.force || DEFAULT_FORCE[d.type];
    e.pressure = Math.min(1, e.pressure + 0.22 + frac);
    if (e.downed) {
      // Catching its balance, a round costs it what it took of its health, and one in the head more than it has: it goes over.
      this.hitWhileDown(e, d, bone, pushForce, region === 'head' && !armoured ? HEAD_COST : frac);
      return;
    }
    // Getting up runs on keys from the root. Moved under it, the feet would slide.
    const shove = e.rising > 0 ? 0 : clamp((pushForce / e.def.hp) * SHOVE_GAIN, 0, SHOVE_MAX) * (e.isBoss ? 0.1 : 1);
    e.push.x += d.dir.x * shove;
    e.push.z += d.dir.z * shove;
    unmoved(e, this.w.now, d.dir.x * shove, d.dir.z * shove);

    if (e.pinned) dropOff(e);

    if (profile) {
      this.respond(e, d, profile, region, amount, pushForce, bone, armoured, throws, flinch);
      return;
    }
    e.poise += amount;
    if (e.poise >= e.def.poise * e.maxHealth) {
      e.poise = 0;
      this.stagger(e, d.type === 'explosive' ? 0.75 : 0.5);
    } else if (!armoured) this.cryOut(e);
  }

  private cryOut(e: Enemy): void {
    if (this.w.now < e.painAt) return;
    e.painAt = this.w.now + (e.isBoss ? BOSS_PAIN_GAP : rand(PAIN_GAP, PAIN_GAP * 2));
    say(e, this.w, e.def.voice.pain, 0.6);
  }

  /** The rule in reactions.ts, carried out. */
  private respond(e: Enemy, d: DamageInfo, profile: ReactionProfile, region: GoreRegion, amount: number, force: number, bone: number, armoured: boolean, throws: boolean, flinch: number): void {
    const anim = e.char.anim;
    // A co-op guest's own hit (drawn here now, or being decided on the host): both machines roll the same for it.
    const r = chooseReaction(e, d, profile, region, amount, force, this.w.now, d.claim ? reactionSeed(d.claim, e.uid) : 0);
    // Only a head hit goes to the floor through the cooldown or a get-up (`chooseReaction`), where anything else flinches.
    const early = r.level === 'felled' && (this.w.now < e.reactAt || e.rising > 0);
    const must = this.m.outpost?.wounds.mustFall(e) || (throws && e.maim.legs > 0);
    if (must) mustFall(r, d);
    const told = this.told;
    if (told) {
      // The host's body did this, so this one does: its own dice above only kept its shock in step.
      r.level = told.level;
      r.strength = told.strength;
      r.knockout = told.knockout;
      r.tripped = told.tripped;
    }
    const found = this.found;
    found.level = r.level;
    found.strength = r.strength;
    found.knockout = r.knockout;
    found.tripped = r.tripped;
    // Ice cannot stumble, and a body still arriving is on somebody else's clock.
    const held = e.frozen > 0 || e.entrance !== 'none';
    // Floored by a head hit, the fall is the whole reaction. A flinch and a guard on the animator first would be read into the
    // speed it goes down at, the head spinning against the chest and the hands thrown up at 10 m/s (gore.md, nothing a hit
    // does to the animation may land in one frame), as `contact.ts` does for a body check. With `?knock=0`, as before.
    const headDown = KNOCK_PASS && !held && r.level === 'felled' && region === 'head';
    // Felled on its way up, it goes over from the clip's pose, with nothing on the animator first either (`?struggle=0`: as
    // before, which only a head hit did).
    const riseDown = STRUGGLE_PASS && !held && r.level === 'felled' && e.rising > 0;
    const floors = headDown || riseDown;
    if (!floors) anim.flinch(bone, d.dir, flinch);
    if (held) return;
    const felt = profile.pain > 0;
    const blast = d.type === 'explosive';
    if (r.level === 'flinch') {
      if (!armoured) this.cryOut(e);
      return;
    }
    if (felt && !floors) {
      if (blast || region === 'head') anim.guard?.(0.5 + r.strength * 0.5);
      else if (!armoured) anim.holdWound?.(bone, d.point, 0.7 + r.strength);
    }
    if (felt && !armoured) say(e, this.w, e.def.voice.pain, 0.7);
    const reactAt = e.reactAt;
    e.reactAt = this.w.now + profile.cooldown;
    if (r.level === 'thrown' || r.level === 'felled') {
      // Only the rising rule drops it from the clip's pose with no topple. A head hit on a rising body goes over as any head
      // hit does, tipped along the round and, knocked cold, with legs and spine locked.
      const drops = riseDown && region !== 'head';
      const how = r.knockout || drops ? knockAs(drops ? null : undefined, undefined, r.knockout, r.knockout ? d.point : undefined) : undefined;
      if (this.knockDown(e, d.dir, r.strength, bone, profile, r.level === 'thrown', how)) {
        e.shock = 0;
        return;
      }
      if (floors) {
        anim.flinch(bone, d.dir, flinch);
        // Gore has no room for it. Inside the cooldown or a get-up a head hit only skipped them to go to the floor, so it
        // flinches as any other hit would there; staggered, an SMG would pin and shove a body for as long as it kept firing.
        // A body felled on its way up is always inside a get-up.
        if (early && !must) {
          e.reactAt = reactAt;
          return;
        }
        if (felt && headDown) anim.guard?.(0.5 + r.strength * 0.5);
      }
      // Past gore's budget. Staggering is what it would have done with one more foot under it.
      this.stagger(e, STAGGER_MAX, d.dir, r.strength, bone, profile.reel);
      e.shock = 0;
      return;
    }
    const seconds = lerp(STAGGER_MIN, STAGGER_MAX, r.strength);
    if (r.tripped) {
      // Stopped short by its own leg, with the rest of the body still going.
      _v.copy(e.velocity);
      e.reel.copy(_v);
      e.velocity.set(0, 0, 0);
      this.stagger(e, seconds, _v.normalize(), r.strength, bone, 0);
    } else {
      this.stagger(e, seconds, d.dir, r.strength, bone, profile.reel);
    }
    e.shock *= SHOCK_AFTER_STAGGER;
    // A trip goes the way it was running, which the stagger above left in `reel`.
    if (r.level === 'fall') this.fallFrom(e, r.tripped ? e.reel : d.dir, r.strength, bone, profile);
    else if (r.strength >= STAND_FROM) this.standFrom(e, d.dir, r.strength, bone, profile);
  }

  /** Where a body on its muscles and on its feet reads, and can be: near, in view, at full detail, on the ground on two legs. */
  private seenStanding(e: Enemy): boolean {
    return STAND_PASS && e.lod === 0 && e.inView && e.dist < STUMBLE_RANGE && !e.airborne && e.maim.legs === 2;
  }

  /**
   * A hard stagger it might recover from (`STAND_FROM`). Where the player can see it, the body goes onto its muscles now, in
   * the stagger it was just given, and catches itself or does not. Refused, going too fast to catch, or already due to
   * fall, the stagger stands.
   */
  private standFrom(e: Enemy, dir: THREE.Vector3, strength: number, bone: number, profile: ReactionProfile): void {
    if (!this.seenStanding(e) || e.fallIn > 0 || this.m.outpost?.wounds.bodyOf(e)?.floored) return;
    if (Math.hypot(e.velocity.x + e.reel.x + e.push.x, e.velocity.z + e.reel.z + e.push.z) > STAND_MAX_SPEED) return;
    _fall.copy(dir).setY(0);
    if (_fall.lengthSq() < 1e-6) return;
    this.knockDown(e, _fall.normalize(), strength, bone, profile, false, knockAs(null, undefined, false, undefined, StandTuning.maxSeconds, standBudget(strength)));
  }

  /**
   * A stagger that turns into a fall. Where the player can see it, the body goes onto its muscles now, in the stagger it was
   * just given, and loses its balance physically (`STUMBLE_EXTRA`); anywhere else, or if gore has no room, it staggers on
   * its animation and is knocked down `FALL_LEAD_MIN` to `FALL_LEAD_MAX` seconds later (`fall`), as before.
   */
  private fallFrom(e: Enemy, dir: THREE.Vector3, strength: number, bone: number, profile: ReactionProfile | null, roll?: number): void {
    const lead = rand(FALL_LEAD_MIN, FALL_LEAD_MAX);
    if (profile && this.seenStanding(e)) {
      _fall.copy(dir).setY(0);
      if (_fall.lengthSq() < 1e-6) _fall.set(Math.sin(e.yaw), 0, Math.cos(e.yaw));
      if (this.knockDown(e, _fall.normalize(), strength, bone, profile, false, knockAs(null, undefined, false, undefined, lead + STUMBLE_EXTRA, undefined, roll))) return;
    }
    e.fallIn = lead;
    e.fallStrength = strength;
    e.fallBone = bone;
  }

  /** Wounds: nothing hit him, he has simply stopped being able to stand. He goes over the way he was facing. */
  drop(e: Enemy, strength: number, bone: number, roll?: number): void {
    if (e.downed || e.fallIn > 0 || !e.alive) return;
    _n.set(Math.sin(e.yaw), 0, Math.cos(e.yaw));
    this.stagger(e, STAGGER_MIN, _n, strength, bone, 0.5);
    this.fallFrom(e, _n, strength, bone, profileOf(e), roll);
  }

  /** Wounds: patched up and helped to his feet, from the crawl he was in. */
  standUp(e: Enemy): void {
    const profile = profileOf(e);
    if (!profile) return;
    e.char.anim.getUp?.('prone', profile.rise * 1.3, 0.9);
    e.rising = profile.rise * 1.3;
    e.stagger = e.rising + profile.daze;
    e.char.anim.daze?.(e.stagger);
  }

  /** Co-op guest: a copy's stagger turned into the fall it was heading for (`fall`), with the facts left alone. */
  fallShown(e: Enemy): void {
    this.facts = false;
    try {
      this.fall(e);
    } finally {
      this.facts = true;
    }
  }

  /** Staggering did not save it. */
  fall(e: Enemy): void {
    const profile = profileOf(e);
    if (!profile || !e.alive || e.downed) return;
    _v.copy(e.reel).setY(0);
    if (_v.lengthSq() < 1e-4) _v.set(Math.sin(e.yaw), 0, Math.cos(e.yaw)).negate();
    this.knockDown(e, _v.normalize(), e.fallStrength, e.fallBone, profile, false);
  }

  /**
   * The player ran into it (`contact.ts`). Fast enough, it goes off its feet along the run with some of the player's speed
   * in it, and gets up again; a slide takes its legs from under it, so they go with the player and it goes over backwards.
   * False when it did not go down: then contact staggers it as it always did. Bosses and machines, which have no
   * reaction profile, never go down here.
   */
  bodyCheck(e: Enemy, dir: THREE.Vector3, closing: number, sliding: boolean): boolean {
    const profile = profileOf(e);
    if (!KNOCK_PASS || !profile || e.downed || e.frozen > 0 || e.entrance !== 'none') return false;
    const s = checkStrength(closing, e.def.mass, sliding);
    if (s < CHECK_MIN) return false;
    // The shove contact just gave it is most of the player's speed, which on a corpse-to-be would be a throw.
    const px = e.push.x;
    const pz = e.push.z;
    const carry = Math.hypot(px, pz);
    if (carry > CHECK_CARRY) {
      e.push.x *= CHECK_CARRY / carry;
      e.push.z *= CHECK_CARRY / carry;
    }
    // Swept: `dir` is where the legs go, and the knockdown's own direction is where it falls, back along the slide.
    const way = sliding ? _check.copy(dir).negate() : _check.copy(dir);
    const topple = _checkTopple.copy(way).multiplyScalar(sliding ? SLIDE_TOPPLE : lerp(CHECK_TOPPLE_MIN, CHECK_TOPPLE_MAX, s));
    const how = knockAs(topple, sliding ? SLIDE_KICK : undefined, false, undefined);
    // Refused, `knockDown` calls off a fall the body already had coming, which is not this run's to call off.
    const fallIn = e.fallIn;
    if (this.knockDown(e, way, s, sliding ? B.thighL : B.chest, profile, false, how)) return true;
    e.push.x = px;
    e.push.z = pz;
    e.fallIn = fallIn;
    return false;
  }

  /** False if gore has no room for another body on the floor. */
  private knockDown(e: Enemy, dir: THREE.Vector3, strength: number, bone: number, profile: ReactionProfile, thrown: boolean, how?: Knock): boolean {
    const { ctx } = this.w;
    const m = this.m;
    const o = m.knockOptions;
    const cold = how?.knockout === true;
    o.velocity.set(e.velocity.x + e.reel.x + e.push.x, e.airborne ? e.verticalSpeed : 0, e.velocity.z + e.reel.z + e.push.z);
    m.knockImpact.dir.copy(dir);
    m.knockImpact.strength = how?.impact ?? strength * 0.4;
    o.impact = m.knockImpact;
    // A blast throws it by itself, once this returns and the blast reaches Physics. Knocked down on its way up, it goes over
    // from the clip's pose under its own weight, at the speed the clip had it moving (`measureAnimVelocity`).
    if (thrown || how?.topple === null) o.topple = undefined;
    else if (how?.topple) o.topple = m.knockTopple.copy(how.topple);
    else o.topple = m.knockTopple.copy(dir).multiplyScalar(lerp(TOPPLE_MIN, TOPPLE_MAX, strength));
    o.impulses = undefined;
    o.knockout = cold;
    // Losing its balance on its muscles, in the stagger it was given this frame. Refused, the caller has the timer.
    if (how?.stumble) {
      _stumble.seconds = how.stumble;
      _stumble.budget = how.budget;
      o.stumble = _stumble;
    } else o.stumble = undefined;
    o.cost = undefined;
    o.strength = this.strengthOf(e);
    o.roll = how?.roll;
    const wounds = m.outpost?.wounds ?? null;
    const floored = wounds?.bodyOf(e)?.floored ?? false;
    // Before gore has the body: what it hands back at the end depends on this.
    if (floored) wounds!.stayDown(e);
    o.hurt = floored ? 1 : profile.pain * (0.5 + strength * 0.5);
    o.lie = floored ? wounds!.lieSeconds(wounds!.bodyOf(e)!) : rand(profile.lie[0], profile.lie[1]) * (0.7 + strength * 0.6) * (cold ? KNOCKOUT_LIE : 1);
    // A guest's copy lies until the host's own gets up (net/world/replicas.ts rouses it), not by a clock of its own.
    if (!this.facts) o.lie = REPLICA_LIE;
    // With all four limbs it pushes itself part of the way up on the floor, and the clip plays the rest in the rest of the time.
    const pushes = STRUGGLE_PASS && pushesUp(e);
    e.riseSeconds = floored ? 0 : profile.rise * (0.85 + strength * 0.4) * (pushes ? 1 - RISE_PUSHED : 1);
    e.dazeSeconds = floored ? 0 : profile.daze * (thrown || cold ? 1 : strength);
    o.rise = e.riseSeconds;
    const wound = m.knockWound;
    wound.bone = bone;
    // Knocked cold, the head jolts back from where the round went in, and a hand goes there.
    if (how?.point) wound.point.copy(how.point);
    else wound.point.setFromMatrixPosition(e.char.bones[bone]!.matrixWorld);
    o.wound = wound;
    if (!ctx.gore.knockdown(e.char, o)) {
      e.fallIn = 0;
      return false;
    }
    if (e.attack) finishAttack(e, this.w, true);
    if (e.pinned) dropOff(e);
    e.downed = true;
    e.airborne = true;
    e.ballistic = false;
    e.fallIn = e.stagger = 0;
    e.verticalSpeed = e.flightLeft = 0;
    e.reel.set(0, 0, 0);
    e.push.set(0, 0, 0);
    e.velocity.set(0, 0, 0);
    return true;
  }

  /** It keeps taking hits on the floor, and every one lands on the body as it lies. */
  private hitWhileDown(e: Enemy, d: DamageInfo, bone: number, force: number, cost: number): void {
    const m = this.m;
    const o = m.knockOptions;
    const i = m.knockImpulses[0]!;
    i.bone = bone;
    i.point.copy(d.point);
    i.impulse.copy(d.dir).multiplyScalar(force);
    o.impulses = m.knockImpulses;
    o.impact = undefined;
    o.topple = undefined;
    o.knockout = false;
    o.stumble = undefined;
    o.cost = cost;
    o.strength = this.strengthOf(e);
    o.roll = undefined;
    const wound = m.knockWound;
    wound.bone = bone;
    wound.point.copy(d.point);
    o.wound = wound;
    this.w.ctx.gore.knockdown(e.char, o);
    this.cryOut(e);
  }

  /**
   * A stagger goes over toward a weak leg (stage 8): turned toward that side by `WEAK_TURN` times what its wounds took off the
   * weaker leg. On its feet on its muscles that is the side its knee gives on. A shared vector; `dir` is left as it was.
   */
  private towardWeakLeg(e: Enemy, dir: THREE.Vector3): THREE.Vector3 {
    if (e.def.machine) return dir;
    const s = this.strengthOf(e);
    const weak = Math.min(s.legL, s.legR);
    if (weak >= 1) return dir;
    // The body's left is its local +X, turned by its yaw.
    const side = s.legL < s.legR ? 1 : -1;
    const k = WEAK_TURN * (1 - weak) * side;
    _turn.set(dir.x, 0, dir.z);
    const len = _turn.length();
    if (len < 1e-6) return dir;
    _turn.divideScalar(len);
    _turn.x += Math.cos(e.yaw) * k;
    _turn.z -= Math.sin(e.yaw) * k;
    return _turn.lengthSq() < 1e-6 ? dir : _turn.normalize();
  }

  /** A hit that took its balance. With `dir` it takes real steps that way, `reel` metres per second at the start. */
  stagger(e: Enemy, seconds: number, dir?: THREE.Vector3, strength = 0.5, bone = REGION_BONE.chest, reel = 1.5): void {
    if (e.isBoss) return;
    e.stagger = Math.max(e.stagger, seconds);
    const anim = e.char.anim;
    if (dir && anim.stumble) {
      dir = this.towardWeakLeg(e, dir);
      anim.stumble(dir, strength, bone);
      const speed = reel * (1 + strength * REEL_GAIN);
      e.reel.x += dir.x * speed;
      e.reel.z += dir.z * speed;
      unmoved(e, this.w.now, dir.x * speed, dir.z * speed);
    } else {
      anim.play('stagger', 1);
    }
    if (e.attackPhase === 'windup') finishAttack(e, this.w, true);
  }
}

