/**
 * Fear, as arithmetic. No three.js and no game state, so the numbers can be read and tested on their own.
 *
 * Morale is per man and runs from about 100 to 0. Dread is one global number from 0 to 100, the player's rampage so far.
 * Dread does not take morale away: it raises the bars morale has to clear, so the same man breaks sooner on a bad day.
 */
export type MoraleState = 'steady' | 'shaken' | 'panicked' | 'broken';

const SHAKEN_AT = 60;
const PANICKED_AT = 35;
const BROKEN_AT = 12;
/** How far full Dread lifts every bar. */
const DREAD_LIFT = 0.3;

export function moraleState(morale: number, dread: number): MoraleState {
  const lift = dread * DREAD_LIFT;
  if (morale <= BROKEN_AT + lift) return 'broken';
  if (morale <= PANICKED_AT + lift) return 'panicked';
  if (morale <= SHAKEN_AT + lift) return 'shaken';
  return 'steady';
}

/** Morale lost, by cause. */
export const FEAR = {
  /** A squadmate or anyone close by goes down. */
  allyDown: 10,
  /** On top of that when it was ugly: blown apart, cut in two, head gone. */
  brutal: 7,
  leaderDown: 18,
  /** Seeing a man who surrendered get shot. */
  execution: 20,
  /** Share of max health lost in one hit, times this. */
  wound: 55,
  limbLost: 30,
  /** Per second at full pressure from rounds going past. */
  underFire: 5,
  /** Per second with the monster inside MONSTER_RANGE. */
  monsterClose: 7,
  /** On every survivor of a squad that lost RAPID_SHARE of its men inside RAPID_SECONDS. */
  rapidLosses: 55,
  /** On everyone who can hear it when a perk spikes Dread, per point of spike. */
  spike: 0.45,
} as const;

/** Metres. */
export const WITNESS_RANGE = 14;
export const MONSTER_RANGE = 6;
export const RAPID_SECONDS = 7;
/**
 * Share of a squad's strength that must fall inside RAPID_SECONDS. Section 14.3's "one or two survivors": this is 3 of 4, 3 of
 * 5 and 4 of 6. Half would be 2 of 4, which any player with an SMG manages on first contact, and no squad would ever fight.
 */
export const RAPID_SHARE = 0.6;

/** Morale back per second when nothing bad has happened for RECOVER_AFTER seconds. */
const RECOVER_RATE = 2;
export const RECOVER_AFTER = 6;
/** With a living leader in voice range. */
const LEADER_BONUS = 1.5;

export const recoverRate = (leaderNear: boolean): number => RECOVER_RATE * (leaderNear ? LEADER_BONUS : 1);

/** Morale never climbs back past this. A man who has seen what the player does stays changed for as long as Dread is up. */
export const moraleCeiling = (base: number, dread: number): number => base - dread * 0.35;

/** Multiplies the miss radius. A frightened man shoots badly, and a panicking one barely aims. */
export const AIM_BY_STATE: Record<MoraleState, number> = { steady: 1, shaken: 1.7, panicked: 3.2, broken: 4 };
/** Multiplies the wait between peeks. Shaken men hug cover. */
export const PEEK_WAIT_BY_STATE: Record<MoraleState, number> = { steady: 1, shaken: 2, panicked: 3, broken: 3 };

const DECAY = 0.7;
/** Kills further apart than this do not feed each other. */
const SPREE_WINDOW = 5;
const SPREE_GAIN = 0.35;

export interface KillBrutality {
  gibbed: boolean;
  sliced: boolean;
  headshot: boolean;
  severed: number;
}

/** What a kill adds, before the spree multiplier. */
export function killDread(k: KillBrutality): number {
  return 2.5 + (k.gibbed ? 4 : 0) + (k.sliced ? 3 : 0) + (k.headshot ? 1.5 : 0) + Math.min(k.severed, 3) * 1.5;
}

/** Spikes by perk and call-in id. Section 14.3 names Berserk and Hellfire as the two that make men run. */
export const DREAD_SPIKES: Readonly<Record<string, number>> = {
  berserk: 45, hellfire: 35, bloodthirst: 12, butcher: 15, overdrive: 10, chainStorm: 15, skyfall: 8,
  airstrike: 18, warthog: 22, orbital: 30, blackSun: 35, nuke: 50,
};

export class Dread {
  value = 0;
  private lastKillAt = -99;
  private spree = 0;

  reset(): void {
    this.value = 0;
    this.lastKillAt = -99;
    this.spree = 0;
  }

  update(dt: number): void {
    this.value = Math.max(0, this.value - DECAY * dt);
  }

  add(amount: number): void {
    this.value = Math.min(100, this.value + amount);
  }

  /** Fast kills compound: the fifth man in five seconds frightens far more than the first. */
  onKill(k: KillBrutality, now: number): void {
    this.spree = now - this.lastKillAt < SPREE_WINDOW ? this.spree + 1 : 0;
    this.lastKillAt = now;
    this.add(killDread(k) * (1 + this.spree * SPREE_GAIN));
  }

  /** Reinforcements wait this many times longer. */
  get hesitation(): number {
    return 1 + this.value / 50;
  }
}
