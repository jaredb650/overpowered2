/**
 * What is wrong with one man, as plain numbers: his wounds, what they add up to, and the clocks running on him. No three.js and no
 * game state, so everything section 14 says about stacking can be read and tested on its own. `WoundSystem` carries it out.
 */
import { CHARACTER, HEAVY_BLEED, HEAVY_ROUND, WoundTuning, ZONES, type Condition, type ZoneId } from './rules';
import type { DamageType } from '../../core/contracts';

const MAX_WOUNDS = 8;

export interface Wound {
  zone: ZoneId;
  side: 1 | -1 | 0;
  /** Bone, and the entry point on it, for the hand that goes there. */
  bone: number;
  x: number;
  y: number;
  z: number;
  /** Share of his health per second, before pressure. */
  bleed: number;
  /** Share of his health it has taken. */
  severity: number;
  dressed: boolean;
}

const blank = (): Wound => ({ zone: 'thigh', side: 0, bone: 0, x: 0, y: 0, z: 0, bleed: 0, severity: 0, dressed: false });

export class Injuries {
  condition: Condition = 'healthy';
  readonly wounds: Wound[] = Array.from({ length: MAX_WOUNDS }, blank);
  count = 0;
  /** The wound a hand is on. */
  held: Wound | null = null;

  /** Limbs that no longer answer. A leg's number is how far it is to giving way. */
  armL = false;
  armR = false;
  handL = false;
  handR = false;
  legL = 0;
  legR = 0;
  legGone = false;
  paralysed = false;

  /** On the ground and not getting up by himself. Soldier.downed follows this. */
  floored = false;
  /** Must not get up. Spine, pelvis, or a leg that is not there. */
  nonAmbulant = false;

  /** Multipliers, and the flags, that the wounds add up to. See `refresh`. */
  speed = 1;
  aim = 1;
  bleed = 0;
  mute = false;
  breathless = false;
  hunched = false;
  /** 1 or -1 for the bad leg. */
  limp: 1 | -1 | 0 = 0;
  /** Seconds between screams. Zero for a man with nothing to scream about or no way to do it. */
  screams = 0;

  mortalFrom = 0;
  mortalUntil = Infinity;
  bleedsOutAt = Infinity;
  /** A medic has been and cannot do more. Nobody is sent a second time. */
  stabilised = false;
  /** Who did this, so a man who bleeds out still counts as someone's kill. */
  source = 'bleed';

  /** Mortal hits landing faster than they fade. */
  private rapid = 0;
  private rapidAt = 0;

  concussedUntil = 0;
  /** Glancing head hit. Stunned, on his feet, and no use to anybody. */
  ringingUntil = 0;
  nextStumble = 0;
  nextScream = 0;
  nextCough = 0;
  nextHold = 0;
  nextDrip = 0;
  nextSpurt = 0;
  /** Where the last drop landed. */
  dripX = 0;
  dripZ = 0;
  /** Set for a man on fire: when he throws himself down. */
  rollAt = 0;
  /** Self-aid: when it finishes, and when he will next try. */
  aidUntil = 0;
  aidReadyAt = 0;
  /** A sidearm in his hand as he goes, or a grenade with the pin out. */
  lastStand: 'none' | 'sidearm' | 'grenade' = 'none';
  /** Which labels he has already earned, as bits. */
  labelled = 0;

  clear(): void {
    this.condition = 'healthy';
    this.count = 0;
    this.held = null;
    this.armL = this.armR = this.handL = this.handR = false;
    this.legL = this.legR = 0;
    this.legGone = this.paralysed = this.floored = this.nonAmbulant = false;
    this.speed = this.aim = 1;
    this.bleed = 0;
    this.mute = this.breathless = this.hunched = false;
    this.limp = 0;
    this.screams = 0;
    this.mortalFrom = 0;
    this.mortalUntil = this.bleedsOutAt = Infinity;
    this.stabilised = false;
    this.source = 'bleed';
    this.rapid = this.rapidAt = 0;
    this.concussedUntil = this.ringingUntil = 0;
    this.nextStumble = this.nextScream = this.nextCough = this.nextHold = this.nextDrip = this.nextSpurt = 0;
    this.dripX = this.dripZ = 0;
    this.rollAt = this.aidUntil = this.aidReadyAt = 0;
    this.lastStand = 'none';
    this.labelled = 0;
  }

  /** Nothing to run for him this frame. */
  get whole(): boolean {
    return this.condition === 'healthy' && this.concussedUntil === 0 && this.ringingUntil === 0;
  }

  get canStand(): boolean {
    return !this.nonAmbulant && !this.legGone;
  }

  /** Both arms are gone from the fight. */
  get armless(): boolean {
    return (this.armL || this.handL) && (this.armR || this.handR);
  }

  /** Adds a wound, or deepens one already in that place: wounds stack. */
  add(zone: ZoneId, side: 1 | -1 | 0, bone: number, x: number, y: number, z: number, severity: number, type: DamageType, amount: number): Wound {
    const c = CHARACTER[type];
    const rule = ZONES[zone];
    const heavy = amount >= HEAVY_ROUND ? HEAVY_BLEED : 1;
    let w: Wound | null = null;
    for (let i = 0; i < this.count; i++) {
      const o = this.wounds[i]!;
      if (o.zone === zone && o.side === side) w = o;
    }
    if (!w) {
      // Past the list, the slightest wound makes way. It is still a man with eight holes in him.
      w = this.count < MAX_WOUNDS ? this.wounds[this.count++]! : this.slightest();
      w.zone = zone;
      w.side = side;
      w.bleed = 0;
      w.severity = 0;
      w.dressed = false;
    }
    w.bone = bone;
    w.x = x;
    w.y = y;
    w.z = z;
    w.bleed += rule.bleed * c.bleed * heavy;
    w.severity += severity;
    if (rule.limps) {
      const wear = severity * c.tear * heavy;
      if (side > 0) this.legL += wear;
      else this.legR += wear;
    }
    if (rule.paralyses) this.paralysed = true;
    if (rule.nonAmbulant) this.nonAmbulant = true;
    if (this.condition === 'healthy') this.condition = 'wounded';
    this.refresh();
    return w;
  }

  private slightest(): Wound {
    let w = this.wounds[0]!;
    for (let i = 1; i < this.count; i++) if (this.wounds[i]!.bleed < w.bleed) w = this.wounds[i]!;
    if (this.held === w) this.held = null;
    return w;
  }

  /** True when a leg has taken what a leg can take. */
  get legDestroyed(): boolean {
    return this.legL >= WoundTuning.legGives || this.legR >= WoundTuning.legGives;
  }

  /** What the wounds add up to. Runs when a wound changes, never per frame. */
  refresh(): void {
    let speed = 1, aim = 1, bleed = 0, screams = 0;
    let mute = false, breathless = false, hunched = false;
    let limp: 1 | -1 | 0 = 0;
    for (let i = 0; i < this.count; i++) {
      const w = this.wounds[i]!;
      const rule = ZONES[w.zone];
      speed = Math.min(speed, rule.speed);
      aim *= rule.aim;
      let flow = w.bleed * (w.dressed ? WoundTuning.dressed : 1);
      if (w === this.held) flow *= 1 - WoundTuning.pressure;
      bleed += flow;
      mute ||= rule.mute === true;
      breathless ||= rule.breathless === true;
      hunched ||= rule.hunches === true;
      if (rule.screams && (screams === 0 || rule.screams < screams)) screams = rule.screams;
      if (rule.limps && limp === 0) limp = w.side === 0 ? 1 : w.side;
    }
    if (this.held) aim *= WoundTuning.holdAim;
    this.speed = speed;
    this.aim = Math.min(aim, WoundTuning.aimCap);
    this.bleed = bleed;
    this.mute = mute;
    this.breathless = breathless;
    this.hunched = hunched;
    this.limp = limp;
    this.screams = mute ? 0 : screams;
  }

  /** The wound his hand should be on. Not one on the arm that would have to reach for it. */
  worst(): Wound | null {
    let best: Wound | null = null;
    for (let i = 0; i < this.count; i++) {
      const w = this.wounds[i]!;
      if (w.dressed || !w.bleed) continue;
      if (!best || w.bleed > best.bleed) best = w;
    }
    return best;
  }

  /** A hit on a man already mortally hurt. True once they have come too fast for him to stay up. */
  piledOn(share: number, now: number): boolean {
    this.rapid = Math.max(0, this.rapid - (now - this.rapidAt) * WoundTuning.rapidFade) + share;
    this.rapidAt = now;
    return this.rapid >= WoundTuning.rapidLimit;
  }

  /** 0 as a mortal wound starts, 1 as it ends. */
  mortalProgress(now: number): number {
    if (this.condition !== 'mortal') return 0;
    return Math.min(1, (now - this.mortalFrom) / Math.max(this.mortalUntil - this.mortalFrom, 0.01));
  }

  concussed(now: number): boolean {
    return now < this.concussedUntil || now < this.ringingUntil;
  }

  /** Multiplies the miss radius right now. */
  aimNow(now: number): number {
    let a = this.aim;
    if (this.condition === 'mortal') a *= 1 + (WoundTuning.mortalAim - 1) * this.mortalProgress(now);
    if (this.concussed(now)) a *= WoundTuning.concussionAim;
    return a;
  }

  /** The worst open wound gets a dressing. False if there was nothing to dress. */
  dressWorst(): boolean {
    const w = this.worst();
    if (!w) return false;
    w.dressed = true;
    if (this.held === w) this.held = null;
    this.refresh();
    return true;
  }

  /** Everything he has, for a medic who got to him. */
  dressAll(): void {
    for (let i = 0; i < this.count; i++) this.wounds[i]!.dressed = true;
    this.held = null;
    this.refresh();
  }

  /** Fire seals what it touches. What is left of the wound is burn, and burn does not bleed. */
  cauterise(): void {
    for (let i = 0; i < this.count; i++) this.wounds[i]!.bleed *= 0.1;
    this.refresh();
  }

  /** Bit for a label, so each man pays each zone once. */
  firstTime(bit: number): boolean {
    const mask = 1 << bit;
    if (this.labelled & mask) return false;
    this.labelled |= mask;
    return true;
  }
}
