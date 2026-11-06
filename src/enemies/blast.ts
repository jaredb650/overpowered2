/**
 * What a blast does to a body, as one table: how far out it stood picks the ring, and how much of its health the blast took
 * shapes the roll inside that ring. The fireball bursts what it kills. Round it is a ring that maims, usually fatally, and past
 * that a ring that throws, which a healthy body lives through. A body that the fireball does not kill counts as the ring's
 * inner edge. Nothing here touches the game, so the table can be read, tuned and tested on its own. `DamageModel` carries a
 * roll out, and every contract comes through here: what differs between factions is what a limb or a wound means afterwards.
 */
import type { DamageInfo, ExplosionKind } from '../core/contracts';
import type { GoreRegion } from '../characters/rig';
import { clamp, lerp } from '../core/math';

export type BlastOutcome =
  | 'gib' | 'waist' | 'head' | 'limbs' | 'armLeg' | 'arm' | 'burn' | 'flesh'
  | 'limb' | 'scorch' | 'thrown' | 'dazed'
  | 'parts' | 'sparks';

export interface OutcomeRule {
  /** Weight at the inner and at the outer edge of the ring that maims. */
  maim: readonly [number, number];
  /** The same for the ring that throws. */
  toss: readonly [number, number];
  /** Share of max health the blast must do for full weight. Under it the weight falls with the square. */
  from: number;
  /** Chance a blast with the damage to kill does kill. Otherwise it leaves `BLAST.spared` of his health. */
  kills: number;
  /** The end of him whatever his health, so it needs at least half of `from` to be rolled at all. */
  ends?: boolean;
  /** Whole limbs of each kind it takes, and limbs of either kind. Any of them can go at the lower joint instead. */
  arms?: number;
  legs?: number;
  any?: number;
  /** Seconds on fire. */
  fire?: number;
  /** A body that takes this stays on its feet, unless the blast had the force to throw it anyway. */
  stands?: boolean;
  /** Rolled for machines, and only for machines. They lose parts and spark. There is nothing in them to bleed or burn. */
  machine?: boolean;
}

export const OUTCOMES: Readonly<Record<BlastOutcome, OutcomeRule>> = {
  gib: { maim: [0, 0], toss: [0, 0], from: 0, kills: 1, ends: true },

  waist: { maim: [3, 1], toss: [0, 0], from: 0.9, kills: 1, ends: true },
  head: { maim: [3, 2], toss: [0, 0], from: 0.9, kills: 1, ends: true },
  limbs: { maim: [4, 2], toss: [0, 0], from: 0.7, kills: 0.85, any: 3 },
  armLeg: { maim: [4, 3], toss: [0, 0], from: 0.55, kills: 0.7, arms: 1, legs: 1 },
  arm: { maim: [2, 4], toss: [0, 0], from: 0.35, kills: 0.5, arms: 1 },
  burn: { maim: [3, 4], toss: [0, 0], from: 0.2, kills: 0, fire: 5 },
  flesh: { maim: [3, 4], toss: [0, 0], from: 0.3, kills: 0.6 },

  limb: { maim: [0, 0], toss: [3, 1], from: 0.2, kills: 0, any: 1 },
  scorch: { maim: [0, 0], toss: [3, 1.5], from: 0.15, kills: 0, fire: 1.6 },
  thrown: { maim: [0.4, 0.8], toss: [6, 6], from: 0, kills: 1 },
  dazed: { maim: [0, 0], toss: [2, 4], from: 0, kills: 0, stands: true },

  parts: { maim: [6, 4], toss: [2, 0.5], from: 0.3, kills: 0.8, any: 2, machine: true },
  sparks: { maim: [2, 4], toss: [6, 6], from: 0, kills: 0.5, stands: true, machine: true },
};

const IDS = Object.keys(OUTCOMES) as BlastOutcome[];
/** Slots a `seen` array needs. */
export const OUTCOME_COUNT = IDS.length;

/** A fireball and a ring that maims, each ending at this share of the radius. The ring that throws runs out to the radius itself. */
type Rings = readonly [fireball: number, maim: number];

export const BLAST = {
  /** Small enough that the fireball only takes a body or two out of a crowd. Most of a grenade's work is the ring round it. */
  rings: {
    rocket: [0.25, 0.65], grenade: [0.22, 0.62], hellfire: [0.3, 0.7], hellfireBullet: [0.3, 0.7], shell: [0.3, 0.7],
    plasma: [0.25, 0.65], enemy: [0.25, 0.65], barrel: [0.28, 0.68], finisher: [0.25, 0.65], nuke: [1, 1],
  } as Readonly<Record<ExplosionKind, Rings>>,
  /** Each time an outcome comes up in one blast its weight is divided by 1 plus this, so a crowd never all goes the same way. */
  repeat: 1.6,
  /** At or over this the blast kills whatever was rolled: Hellfire, and a shell on an unarmoured body. */
  certain: 9999,
  /** Share of max health a body keeps when it was spared. A body with less than the least of this is not spared. */
  spared: [0.1, 0.3] as const,
  /** Share of max health the ring that throws can take, so a healthy body survives it however big the blast. */
  tossHurt: [0.25, 0.55] as const,
  /** Seconds a body that stayed on its feet stands dazed. */
  dazed: 1.6,
  /** A pellet this hard is a point-blank shotgun, and a kill from one in the trunk tears the body in two this often. */
  pointBlankForce: 100,
  pointBlankWaist: 0.35,
} as const;

export interface BlastBody {
  health: number;
  maxHealth: number;
  /** Rolls the machine rows, and no others. */
  machine: boolean;
  /** Fire does nothing to it, so no fire is rolled. */
  fireproof: boolean;
}

export interface BlastRoll {
  outcome: BlastOutcome;
  /** What comes off his health, now the ring has had its say. */
  amount: number;
  fatal: boolean;
}

function weigh(rule: OutcomeRule, weights: readonly [number, number], t: number, share: number, body: BlastBody, seen: number): number {
  if ((rule.machine === true) !== body.machine || (rule.fire !== undefined && body.fireproof)) return 0;
  if (rule.ends && share < rule.from * 0.5) return 0;
  const damage = rule.from > 0 ? clamp(share / rule.from) ** 2 : 1;
  return (lerp(weights[0], weights[1], t) * damage) / (1 + BLAST.repeat * seen);
}

function pickOutcome(maim: boolean, t: number, share: number, body: BlastBody, seen: Uint8Array, rng: () => number): BlastOutcome {
  let total = 0;
  for (let i = 0; i < IDS.length; i++) {
    const rule = OUTCOMES[IDS[i]!];
    total += weigh(rule, maim ? rule.maim : rule.toss, t, share, body, seen[i]!);
  }
  let left = rng() * total;
  let last: BlastOutcome = body.machine ? 'sparks' : 'thrown';
  for (let i = 0; i < IDS.length; i++) {
    const rule = OUTCOMES[IDS[i]!];
    const w = weigh(rule, maim ? rule.maim : rule.toss, t, share, body, seen[i]!);
    if (w <= 0) continue;
    last = IDS[i]!;
    left -= w;
    if (left <= 0) break;
  }
  seen[IDS.indexOf(last)]!++;
  return last;
}

/**
 * Writes what this blast does to this body into `out`. `reach` is how far out it stood, as a share of the radius, and `amount` is
 * what the blast would take from it. `seen` holds this blast's rolls so far, one slot per outcome, and starts at zero for each blast.
 */
export function rollBlast(
  body: BlastBody, kind: ExplosionKind, reach: number, amount: number, seen: Uint8Array, out: BlastRoll, rng: () => number = Math.random,
): BlastRoll {
  const [fireball, maim] = BLAST.rings[kind];
  const share = amount / body.maxHealth;
  const lethal = amount >= body.health;
  const certain = amount >= BLAST.certain;
  out.amount = amount;
  if (reach < fireball && lethal) {
    out.outcome = 'gib';
    out.fatal = true;
    return out;
  }
  const inner = reach < maim;
  const t = inner ? clamp((reach - fireball) / Math.max(maim - fireball, 1e-3)) : clamp((reach - maim) / Math.max(1 - maim, 1e-3));
  out.outcome = pickOutcome(inner, t, share, body, seen, rng);
  const rule = OUTCOMES[out.outcome];
  if (!inner) {
    out.fatal = certain;
    if (!certain) out.amount = Math.min(amount, body.maxHealth * lerp(BLAST.tossHurt[0], BLAST.tossHurt[1], rng()));
    return out;
  }
  const spareable = body.health > body.maxHealth * BLAST.spared[0];
  out.fatal = certain || rule.ends === true || (lethal && (!spareable || rng() < rule.kills));
  if (lethal && !out.fatal) out.amount = Math.max(0, body.health - body.maxHealth * lerp(BLAST.spared[0], BLAST.spared[1], rng()));
  return out;
}

/** A point-blank shotgun can do by itself what the ring that maims does. Only a kill comes here. */
export function tearsWaist(d: DamageInfo, region: GoreRegion, force: number, rng: () => number = Math.random): boolean {
  return d.type === 'pellet' && force >= BLAST.pointBlankForce && (region === 'abdomen' || region === 'chest') && rng() < BLAST.pointBlankWaist;
}
