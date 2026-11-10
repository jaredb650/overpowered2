/**
 * How a living body answers a hit that does not kill it. One rule for every enemy, read from three things: how much
 * damage, where it landed, and how hard the weapon pushes. Hits add up in `Enemy.shock`, which fades in about a second,
 * so sustained fire topples what one round would not.
 *
 * This only decides. `DamageModel` carries it out. Section 14's wounds sit on top: a wound that puts a man down overrules
 * this answer through `mustFall`, and everything else a wound does happens on his own time, in src/enemies/wounds.
 */
import { KNOCK_PASS } from '../gore/muscles';
import { rigInfo } from '../gore/rigInfo';
import type { GoreRegion } from '../characters/rig';
import type { DamageInfo } from '../core/contracts';
import type { EnemyId } from '../core/gameplay';
import { chance, clamp, smoothstep } from '../core/math';
import type { Enemy } from './Enemy';
import { HEAVY_ROUND } from './wounds/rules';

export interface ReactionProfile {
  /** Shock at which it staggers, and at which a stagger is a fall. Chance rises either side of these. */
  stagger: number;
  fall: number;
  /** Shock from a blast that takes it off its feet. */
  thrown: number;
  /** Metres per second of the first catch step, before strength. */
  reel: number;
  /** Chance of tripping on a shot leg at a run. */
  trip: number;
  /** Seconds on the floor, least and most. */
  lie: readonly [number, number];
  /** Seconds to get up. */
  rise: number;
  /** 0 feels nothing, 1 feels everything. Anything under `ReflexTuning.painFrom` never clutches a wound. */
  pain: number;
  /** Seconds it stands there afterwards at full strength. */
  daze: number;
  /** Seconds before it can be staggered again. Otherwise an SMG holds a body in place for as long as the magazine lasts. */
  cooldown: number;
}

const FLESH: ReactionProfile = {
  stagger: 0.75, fall: 1.7, thrown: 1, reel: 1.5, trip: 0.7, lie: [0.7, 1.9], rise: 2.5, pain: 1, daze: 1.5, cooldown: 0.9,
};
/** Zombie types: they feel nothing, so they shrug off what would stop a person, and they are up again at once. */
const UNDEAD: ReactionProfile = {
  stagger: 1.15, fall: 2.6, thrown: 1.25, reel: 1, trip: 0.4, lie: [0.1, 0.35], rise: 1.05, pain: 0, daze: 0, cooldown: 1.3,
};
const NIMBLE: ReactionProfile = { ...FLESH, reel: 1.9, lie: [0.2, 0.6], rise: 1.15, daze: 0.4, cooldown: 1.2 };
const HEAVY: ReactionProfile = {
  stagger: 0.8, fall: 2, thrown: 1.1, reel: 0.8, trip: 0.3, lie: [0.8, 1.6], rise: 3, pain: 0.8, daze: 0.9, cooldown: 1.6,
};

const BODIES: Partial<Record<EnemyId, ReactionProfile>> = {
  husk: UNDEAD, leaper: UNDEAD, bomber: UNDEAD, stalker: NIMBLE, brute: HEAVY,
};

/** Null for anything that is not a person falling over: bosses and machines stagger by `poise`, the old way. */
export function profileOf(e: Enemy): ReactionProfile | null {
  if (e.isBoss || e.def.machine) return null;
  return BODIES[e.id] ?? FLESH;
}

/** How much of a hit reaches balance. An arm can take it. A leg is what the body was standing on. */
const REGION_SHOCK: Record<GoreRegion, number> = {
  head: 1.2, chest: 1, abdomen: 1.15, armL: 0.5, armR: 0.5, forearmL: 0.35, forearmR: 0.35, legL: 1, legR: 1, shinL: 0.9, shinR: 0.9,
};
/** Shock per metre per second the hit would give the whole body, and per share of health it took. */
const SHOCK_PER_SPEED = 1;
const SHOCK_PER_HEALTH = 1.1;
/** Slowest a body can be going and still trip over a shot leg. */
const TRIP_SPEED = 2.2;
/** Share of a leg's pool gone before it starts to give way under a body that is only standing on it. */
const LEG_FAILS_FROM = 0.45;

/** `felled` goes over on this frame with no steps to catch itself, where `fall` staggers first. */
export type ReactionLevel = 'flinch' | 'stagger' | 'fall' | 'felled' | 'thrown';

export interface Reaction {
  level: ReactionLevel;
  /** 0..1, how hard it plays. */
  strength: number;
  /** A shot leg took it out from under a moving body, so it goes the way it was going, not the way the shot was. */
  tripped: boolean;
  /** Felled by a shotgun or a heavy round to the head: knocked cold, it goes over like a sack (`KnockdownOptions.knockout`). */
  knockout: boolean;
}

const _out: Reaction = { level: 'flinch', strength: 0, tripped: false, knockout: false };

/**
 * How hard a head hit that puts a body down plays, at the least: a shotgun or a heavy round, which knock it cold, and any
 * other real round, which tips it over at 1.7 m/s.
 */
const HEAD_KNOCK = 0.7;
const HEAD_KNOCK_LIGHT = 0.5;
/**
 * Newton-seconds from which any round to the head that does not kill puts the body on the floor. The owner's rule: every
 * non-fatal head hit from a real gun, so the SMG (20) counts, and the Buzzsaw (6) and the Kiln (1) only rattle. Above 20 it
 * leaves the SMG out again, and at Infinity only a shotgun or a heavy round floors a body, as with `?knock=0`.
 */
export const HEAD_KNOCK_FORCE = KNOCK_PASS ? 15 : Infinity;

/** A wound decided it: he is going over, cooldown or no cooldown, and a blast throws him there. */
export function mustFall(r: Reaction, d: DamageInfo): void {
  if (r.level !== 'thrown' && r.level !== 'felled') r.level = d.type === 'explosive' ? 'thrown' : 'fall';
  r.strength = Math.max(r.strength, 0.6);
}

/**
 * A head hit it lives through that puts it on the floor: a shotgun, a heavy round, or anything else that pushes with
 * `HEAD_KNOCK_FORCE`. A helmet stops the metal and none of the rest. In the Campaign a clean head hit always kills, so
 * this only ever meets glances and helmets there.
 */
function knocksOut(d: DamageInfo, region: GoreRegion, force: number): boolean {
  return region === 'head' && d.type !== 'explosive' && (knocksCold(d) || force >= HEAD_KNOCK_FORCE);
}

/** The ones that knock it cold. */
function knocksCold(d: DamageInfo): boolean {
  return d.type === 'pellet' || d.amount >= HEAVY_ROUND;
}

function isLeg(region: GoreRegion): boolean {
  return region.startsWith('leg') || region.startsWith('shin');
}

function legGone(e: Enemy, region: GoreRegion): number {
  const left = e.limbHp.get(region);
  const whole = e.maxHealth * e.def.limbFrac;
  return left === undefined ? 0 : smoothstep(LEG_FAILS_FROM, 1, 1 - left / whole);
}

/**
 * Adds the hit to the body's shock and says what it does about it. `force` is what the hit pushes with, and `now` is
 * the world clock. A level above a flinch starts the cooldown, so the caller can take it at its word.
 */
export function chooseReaction(e: Enemy, d: DamageInfo, profile: ReactionProfile, region: GoreRegion, amount: number, force: number, now: number): Reaction {
  const area = d.type === 'explosive';
  const speed = force / rigInfo(e.char.rig).mass;
  const share = amount / e.maxHealth;
  const power = (speed * SHOCK_PER_SPEED + share * SHOCK_PER_HEALTH) * (area ? 1 : REGION_SHOCK[region]);
  e.shock += power;
  const out = _out;
  out.level = 'flinch';
  out.strength = clamp(e.shock / profile.fall);
  out.tripped = false;
  out.knockout = false;
  // A body with no legs has nothing left to fall off. It flinches and keeps crawling.
  if (e.maim.legs === 0) return out;
  if (knocksOut(d, region, force)) {
    out.level = 'felled';
    out.knockout = KNOCK_PASS && knocksCold(d);
    out.strength = Math.max(out.strength, knocksCold(d) ? HEAD_KNOCK : HEAD_KNOCK_LIGHT);
    return out;
  }
  if (e.rising > 0 && !area) return out;
  if (area && e.shock >= profile.thrown) {
    out.level = 'thrown';
    return out;
  }
  if (now < e.reactAt) return out;
  if (isLeg(region)) {
    const running = Math.hypot(e.velocity.x, e.velocity.z);
    const trip = running >= TRIP_SPEED ? profile.trip : 0;
    if (chance(Math.max(trip, legGone(e, region) * profile.trip))) {
      out.level = 'fall';
      out.tripped = running >= TRIP_SPEED;
      out.strength = Math.max(out.strength, 0.5);
      return out;
    }
  }
  if (chance(smoothstep(profile.fall * 0.75, profile.fall * 1.25, e.shock))) out.level = 'fall';
  // A head hit that does not kill always rattles them.
  else if (region === 'head' || chance(smoothstep(profile.stagger * 0.7, profile.stagger * 1.2, e.shock))) out.level = 'stagger';
  return out;
}
