/**
 * Section 14.6 as data: what each part of a man does when it is hit, and how weapons differ. Nothing here touches the game, so
 * the table can be read, tuned and tested on its own. Bleed rates are shares of max health per second.
 */
import type { FactionRules } from '../../contracts/data';
import type { DamageInfo, DamageType } from '../../core/contracts';

/** Section 14.1 for humans, sections 8 and 15 for the swarm: whether a killing hit bursts the body or leaves one. */
export function bursts(rules: FactionRules, d: DamageInfo, maxHealth: number, overkill: boolean): boolean {
  const explosive = d.type === 'explosive';
  const flagged = d.gib === true;
  // Struck by the thing itself, not just near it. Combat flags a rocket's own impact and every blast round it the same way.
  if (flagged && (!explosive || d.bone !== undefined)) return true;
  if (flagged && !rules.pointBlankOnly) return true;
  if (!explosive) return false;
  if (rules.pointBlankOnly) return flagged && d.amount >= maxHealth * rules.blastBurst;
  return overkill || d.amount >= maxHealth * rules.blastBurst;
}

/** Section 14.1. */
export type Condition = 'healthy' | 'wounded' | 'mortal' | 'downed' | 'dead';

export type ZoneId =
  | 'thigh' | 'innerThigh' | 'hand' | 'arm' | 'shoulder' | 'lung' | 'heart' | 'gut' | 'carotid' | 'spine' | 'pelvis' | 'head';

export interface ZoneRule {
  /** The word that floats over him. A glancing head hit has its own, `RINGING`. */
  label: string;
  /** Style points, paid by whoever listens to `enemy:wounded`. */
  bonus: number;
  bleed: number;
  /** Multiplies his speed while the wound is open. */
  speed: number;
  /** Multiplies his miss radius. */
  aim: number;
  /** Puts him on the floor at once. */
  floors?: boolean;
  /** Legs stop answering. He can only drag himself, and nobody stands him back up. */
  paralyses?: boolean;
  /** Fatal, but he has a few seconds on his feet. */
  mortal?: boolean;
  /** Bad enough on the leg to show in every step. */
  limps?: boolean;
  /** Takes the use of that arm, or hand. */
  disables?: 'arm' | 'hand';
  /** Doubled over. */
  hunches?: boolean;
  /** No voice, no radio. */
  mute?: boolean;
  /** No breath to run with. */
  breathless?: boolean;
  /** Seconds between screams, frightening anyone near. */
  screams?: number;
  /** Caps the bleed clock once he is down. */
  gone?: number;
  /** A body with this wound can never be stood back up. */
  nonAmbulant?: boolean;
}

export const ZONES: Record<ZoneId, ZoneRule> = {
  thigh: { label: 'KNEECAPPED', bonus: 40, bleed: 0.004, speed: 0.62, aim: 1.25, limps: true, screams: 8 },
  innerThigh: { label: 'FEMORAL', bonus: 90, bleed: 0.14, speed: 0.5, aim: 1.5, limps: true, screams: 6 },
  hand: { label: 'DISARMED', bonus: 75, bleed: 0.003, speed: 1, aim: 1.3, disables: 'hand' },
  arm: { label: 'ARM SHOT', bonus: 50, bleed: 0.006, speed: 0.95, aim: 1.7, disables: 'arm' },
  shoulder: { label: 'ARM SHOT', bonus: 50, bleed: 0.01, speed: 0.9, aim: 1.7, disables: 'arm' },
  lung: { label: 'LUNG SHOT', bonus: 70, bleed: 0.02, speed: 0.6, aim: 2.2, mortal: true, mute: true, breathless: true },
  heart: { label: 'HEART SHOT', bonus: 150, bleed: 0, speed: 1, aim: 1 },
  gut: { label: 'GUT SHOT', bonus: 60, bleed: 0.012, speed: 0.42, aim: 2.4, hunches: true, screams: 4 },
  carotid: { label: 'CAROTID', bonus: 120, bleed: 0.3, speed: 0.4, aim: 4, floors: true, mute: true, gone: 3 },
  spine: { label: 'SPINED', bonus: 110, bleed: 0.012, speed: 0, aim: 3, floors: true, paralyses: true, nonAmbulant: true, screams: 5 },
  pelvis: { label: 'PELVIS', bonus: 80, bleed: 0.02, speed: 0, aim: 2.5, floors: true, paralyses: true, nonAmbulant: true, screams: 4 },
  head: { label: 'HEADSHOT', bonus: 0, bleed: 0, speed: 1, aim: 1 },
};

/** A glancing head hit: the round is gone and his ears are not. */
export const RINGING = { label: 'RINGING', bonus: 35, stun: 2.4 } as const;

export const WoundTuning = {
  /** Share of max health under which a hit is a graze: it stings and bleeds nothing worth a clock. */
  graze: 0.09,
  /** Seconds he keeps fighting once mortally hurt. */
  mortal: [3.2, 5.8] as const,
  /** Chance a mortal wound ends with him dead on his feet rather than down and crawling. */
  mortalDropsDead: 0.4,
  /** Mortal hits add their share of max health to this, which fades, and at 1 he drops dead. Three SMG rounds at wave 1. */
  rapidLimit: 0.95,
  rapidFade: 0.9,
  /** Share of max health in one hit that kills through the trunk, whatever it strikes. */
  overwhelming: 1.6,
  /** A blast this far past his health kills him where he stands. */
  blastKills: 3.5,
  /** Seconds on the floor before he bleeds out, per section 14.1. */
  bleedOut: [10, 20] as const,
  /** Share of a leg's strength in hits that destroys it. */
  legGives: 0.75,
  /** Share of the bleed that hand pressure stops. */
  pressure: 0.4,
  /** A hand on a wound is not on the gun. */
  holdAim: 1.3,
  /** Worst his aim gets from wounds alone, and from a mortal wound at its end. */
  aimCap: 6,
  mortalAim: 5,
  /** Share of his bleed left once a wound is dressed. */
  dressed: 0.12,
  /** Seconds to get a tourniquet or a seal on himself, and before he will try again after being interrupted. */
  selfAid: [2.6, 4.2] as const,
  selfAidRest: 5,
  /** Below this bleed he does not bother. */
  selfAidFrom: 0.006,
  /** Downed men who get help and still cannot stand: seconds added to the clock. */
  stabilised: 12,
  /** Health a downed man has once he is mortally hurt. Anything lands on him now. */
  lastBlood: 0.05,
  /** Chance a mortal or downed man goes for a last act, and that it is a grenade if he has one. */
  lastStand: 0.45,
  lastGrenade: 0.3,
  /** Seconds a concussed man stays stupid, and the share of health a blast must do to do it. */
  concussion: [3, 6] as const,
  concussionFrom: 0.05,
  concussionAim: 3.5,
  /** Seconds on fire before he throws himself down. */
  fireRoll: [1.5, 3] as const,
  /** Metres to anyone frightened by a scream. */
  screamRange: 13,
  /** Metres a downed man is heard calling, by those who might come for him. */
  baitRange: 42,
  /** Men who go along with the one sent to fetch him. */
  baitEscort: 2,
} as const;

/** Rounds in a pistol. */
export const SIDEARM_MAG = 9;

/** Section 14.6, weapon character: what each kind of hit does to the channel it leaves. */
export interface WeaponCharacter {
  /** Multiplies the zone's bleed. */
  bleed: number;
  /** Multiplies how far this counts toward destroying a limb. */
  tear: number;
  /** Stops bleeding where it touches, and sets him running. */
  cauterises?: boolean;
}

export const CHARACTER: Record<DamageType, WeaponCharacter> = {
  bullet: { bleed: 1, tear: 1 },
  pellet: { bleed: 1.5, tear: 1.6 },
  slash: { bleed: 1.8, tear: 0.8 },
  melee: { bleed: 0.3, tear: 0.5 },
  explosive: { bleed: 1.4, tear: 1.4 },
  crush: { bleed: 0.6, tear: 1.2 },
  fire: { bleed: 0, tear: 0, cauterises: true },
  shock: { bleed: 0, tear: 0 },
  true: { bleed: 0, tear: 0 },
};

/** A round this heavy is not a small channel any more: it counts for double. Autocannon, stakes and the Judge. */
export const HEAVY_ROUND = 60;
export const HEAVY_BLEED = 2;
