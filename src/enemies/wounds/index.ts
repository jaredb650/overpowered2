/**
 * Sections 14.1 and 14.6: what a hit does to a person short of killing him, and what he does about it afterwards. Only the human
 * faction comes through here, so the swarm's hits never read a line of it.
 *
 *   rules.ts     the table: every zone, every number
 *   zones.ts     where a hit landed, from the round's path through a bone
 *   injuries.ts  one man's wounds and clocks, as plain numbers
 *   crawl.ts     a man on the floor dragging himself away
 *   trail.ts     what he leaves behind
 *   sidearm.ts   the pistol he falls back on
 *   armour.ts    the plates he wears
 *
 * `DamageModel` asks this one question per hit, `take`, and carries out a fall if `mustFall` says so. Everything else runs on
 * the man's own time, from `update`, ahead of his brain and his legs.
 */
import * as THREE from 'three';
import { HumanoidBone as B, type GoreRegion } from '../../characters/rig';
import type { DamageInfo, DamageType } from '../../core/contracts';
import { chance, clamp, pick, rand } from '../../core/math';
import { FACTIONS } from '../../contracts/data';
import { ACTIVE } from '../../contracts/select';
import type { AiWorld } from '../aiWorld';
import type { Plate } from '../armor';
import { say } from '../attacks';
import type { Enemy } from '../Enemy';
import type { EnemyManager } from '../EnemyManager';
import { FEAR } from '../outpost/morale';
import type { Outpost } from '../outpost';
import { pose, soldierOf, type Soldier } from '../outpost/soldier';
import { CRACK_DROP, CRACK_TIP, CRACKED } from './armour';
import { crawlOn } from './crawl';
import { Injuries } from './injuries';
import { bursts, RINGING, SIDEARM_MAG, WoundTuning as T, ZONES, type Condition, type ZoneId } from './rules';
import { Sidearms } from './sidearm';
import { dripTrail } from './trail';
import { resolveZone, type ZoneHit } from './zones';

const LABEL_COLOR = '#ff5040';
/** Seconds between labels on screen, across every man, so a burst in a crowd stays readable. */
const LABEL_GAP = 0.45;
/** Hits that have a place on the body. A blast, a flame or a boot lands on the whole man. */
const PLACED: ReadonlySet<DamageType> = new Set<DamageType>(['bullet', 'pellet', 'slash']);
/** Multiplies a hit to the neck, which the rig counts as head. */
const NECK_DAMAGE = 1.2;
const GLANCE_DAMAGE = 0.4;
/** Share of a burn tick that lands on a man, so that he has time to panic and to throw himself down. */
const BURN_DAMAGE = 0.45;
/** Seconds of hand on a wound at a time. Refreshed well before it runs out. */
const HOLD_SECONDS = 1.6;
const HOLD_REFRESH = 0.8;
/** Seconds between stumbles for a man dying on his feet, from the start of it to the end. */
const STUMBLE_EARLY = 1.7;
const STUMBLE_LATE = 0.75;
const COUGH_SECONDS: readonly [number, number] = [1.3, 2.6];
/** Bleed share that shows as a jet and not a seep, and seconds between beats. */
const SPURT_FROM = 0.05;
const SPURT_SECONDS = 0.5;
/** Metres at which a man on the floor starts talking to the thing standing over him. */
const BEG_RANGE = 7;
/** Where the metal from a blast ends up. */
const SHRAPNEL: readonly ZoneId[] = ['thigh', 'gut', 'arm', 'shoulder'];
/** Share of health a blast must do to leave metal in him. */
const SHRAPNEL_FROM = 0.2;
/** Seconds a man who fell from the shock of a wound lies there, least and most. */
const FLOORED_LIE: readonly [number, number] = [1.1, 2.3];
/** Long enough for the clock to run out where he lies. */
const NO_CRAWL_LIE = 8;
/** Chance a second wound takes the good leg out from under a limping man. He gets up from this one. */
const LIMP_THEN_FALL = 0.6;

const SIDEARM_DRAW = 0.9;
/** A round stopped by a plate still lands like a punch. */
const BLUNT_SECONDS = 0.4;
const BLUNT_STRENGTH = 0.3;
const BLUNT_REEL = 1.2;
/** Chance a man who loses his gun to a hand wound goes after it instead of drawing. */
const SCRAMBLE = 0.5;
const LAST_STAND_RANGE = 18;
/** Seconds between calls from a man on the floor with no worse reason of his own. */
const FLOORED_SCREAM = 6;
/** The same as the swarm's open stump, for a man who lost a limb and is still going. */
const STUMP_BLEED = 0.022;

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _dir = new THREE.Vector3();
/** Bit for each zone, so a man pays each one once. */
const ZONE_BIT: Record<ZoneId, number> = { thigh: 0, innerThigh: 1, hand: 2, arm: 3, shoulder: 3, lung: 4, heart: 5, gut: 6, carotid: 7, spine: 8, pelvis: 9, head: 10 };
const RINGING_BIT = 11;
/** Seconds a man on fire rolls once he is down, least and most. */
const FIRE_ROLL: readonly [number, number] = [1.5, 2.5];

export class WoundSystem {
  private readonly hit: ZoneHit = { zone: 'thigh', side: 0, behind: false, glancing: false };
  /** The hit he does not get up from: a clock running out, not a round. */
  private readonly final: DamageInfo = {
    amount: 0, type: 'true', point: new THREE.Vector3(), dir: new THREE.Vector3(0, -1, 0), force: 0, source: 'bleed',
  };
  private readonly sidearms: Sidearms;
  /** The contract's rule data can turn all of this off, and then a man dies when his health runs out. */
  private readonly anatomy = ACTIVE.def.wounds === 'anatomy' && FACTIONS[ACTIVE.def.faction].anatomy;
  private labelAt = -Infinity;
  private fallDue = false;

  constructor(private readonly w: AiWorld, private readonly o: Outpost, private readonly manager: EnemyManager) {
    this.sidearms = new Sidearms(w.ctx);
  }

  init(): void {
    this.sidearms.init();
  }

  bodyOf(e: Enemy): Injuries | null {
    return this.anatomy ? soldierOf(e)?.injuries ?? null : null;
  }

  /** A man through the gate: a body the pool may have given a pistol in another life. */
  onSpawn(s: Soldier): void {
    s.baseSpeed = s.e.speedMul;
    this.sidearms.holster(s.e);
  }

  // -------------------------------------------------------------------------------------------
  // The hit
  // -------------------------------------------------------------------------------------------

  /** Where it landed. Null for a hit with no place on the body. */
  read(e: Enemy, d: DamageInfo, region: GoreRegion): ZoneHit | null {
    if (!PLACED.has(d.type)) return null;
    const bone = d.bone === undefined ? undefined : e.char.bones[d.bone];
    return resolveZone(bone, d.bone, region, d.point, d.dir, e.char.rig.height / 1.85, this.hit);
  }

  /** Hands up on his knees: no plate is in the way and there is nothing to take the hit but him. */
  kneeling(e: Enemy): boolean {
    const s = soldierOf(e);
    return s !== undefined && s.surrendered && !s.collared;
  }

  /** The damage model priced a neck or a skid as a head hit, which neither is. A man also lasts longer alight than a husk does. */
  priced(hit: ZoneHit | null, d: DamageInfo, amount: number, region: GoreRegion, kneeling: boolean): number {
    if (kneeling) return amount * T.kneeling;
    if (d.source === 'burn') return amount * BURN_DAMAGE;
    if (!hit) return amount;
    if (hit.glancing) return d.amount * GLANCE_DAMAGE;
    return region === 'head' && hit.zone !== 'head' ? d.amount * NECK_DAMAGE : amount;
  }

  /** True if this hit kills him outright. Otherwise he lives, however bad it is, and `fatal` means only that his health ran out. */
  take(e: Enemy, b: Injuries, hit: ZoneHit | null, d: DamageInfo, amount: number, fatal: boolean): boolean {
    const s = soldierOf(e)!;
    this.fallDue = false;
    if (d.source === 'bleed') {
      this.bledOut(s, b);
      return false;
    }
    if (d.source !== 'burn') b.source = d.source;
    // A man with his hands up has no last stand, no crawl and no clock. Whatever took his health took him.
    if (fatal && s.surrendered) return true;
    const dead = hit ? this.takePlaced(s, b, hit, d, amount / e.maxHealth, fatal, amount) : this.takeArea(s, b, d, amount, fatal);
    if (dead) return true;
    if (fatal) e.health = Math.max(e.health, e.maxHealth * T.lastBlood);
    this.syncBody(s, b);
    return false;
  }

  /** A plate took it. He felt it, and it shows on the plate. */
  onPlate(e: Enemy, plate: Plate, d: DamageInfo, region: GoreRegion): void {
    const s = soldierOf(e);
    if (!s) return;
    if (plate.hp > 0 && plate.hp < plate.spec.hp * e.maxHealth * CRACKED) {
      // Still on him, hanging by what is left of the straps.
      // A worn helmet sits at the bone's origin, so it tips from there.
      plate.mesh.position.y = (plate.worn ? 0 : plate.spec.offset[1]) - CRACK_DROP;
      plate.mesh.rotation.x = (plate.worn ? 0 : plate.spec.tilt?.[0] ?? 0) + CRACK_TIP;
    }
    if (d.type === 'explosive') {
      // A plate stops metal. It does nothing about the pressure.
      if (d.amount / e.maxHealth >= T.concussionFrom) this.concuss(s, s.injuries);
    } else if (region === 'head') this.ring(s, s.injuries, d);
    else if (PLACED.has(d.type)) this.manager.model.stagger(e, BLUNT_SECONDS, d.dir, BLUNT_STRENGTH, B.chest, BLUNT_REEL);
  }

  /** Read once after the hit, by the reaction: the wound has decided this man is going over. */
  mustFall(e: Enemy): boolean {
    const due = this.fallDue && this.bodyOf(e) !== null;
    this.fallDue = false;
    return due;
  }

  private takePlaced(s: Soldier, b: Injuries, hit: ZoneHit, d: DamageInfo, share: number, fatal: boolean, amount: number): boolean {
    const zone = hit.zone;
    if (zone === 'head' && hit.glancing) {
      this.ring(s, b, d);
      return fatal;
    }
    if (zone === 'head') return true;
    if (zone === 'heart') {
      this.mark(s, b, zone, d);
      return true;
    }
    const legs = zone === 'thigh' || zone === 'innerThigh';
    const limb = legs || zone === 'hand' || zone === 'arm' || zone === 'shoulder';
    if (!limb && share >= T.overwhelming) return true;
    if (fatal && d.slicePlaneNormal) return true;
    if (share < T.graze && !fatal) return false;
    if (b.condition === 'mortal' || b.floored) {
      if (b.piledOn(share, this.w.now)) return true;
      if (b.floored && fatal) return true;
    }
    this.record(s, b, zone, hit.side, d, share, amount);
    this.mark(s, b, zone, d);
    const rule = ZONES[zone];
    if (rule.hunches) pose(s.e, 'stand');
    if (rule.disables) this.loseLimb(s, b, hit.side, rule.disables);
    if (legs) {
      this.manager.model.updateMaim(s.e);
      if (b.legDestroyed) {
        b.legGone = true;
        this.floor(s, b);
      } else this.fallDue = b.count > 1 && chance(LIMP_THEN_FALL);
    }
    if (rule.floors) this.floor(s, b);
    else if (rule.mortal || fatal) this.goMortal(s, b);
    if (!b.floored) this.cry(s, b);
    return false;
  }

  private takeArea(s: Soldier, b: Injuries, d: DamageInfo, amount: number, fatal: boolean): boolean {
    const e = s.e;
    const share = amount / e.maxHealth;
    if (d.type === 'fire') {
      this.burn(s, b);
      return fatal;
    }
    if (d.type !== 'explosive') return fatal;
    if (bursts(d) || share >= T.blastKills) return true;
    if ((b.condition === 'mortal' || b.floored) && (fatal || b.piledOn(share, this.w.now))) return true;
    if (share >= T.concussionFrom) this.concuss(s, b);
    if (share >= SHRAPNEL_FROM) {
      this.record(s, b, pick(SHRAPNEL), chance(0.5) ? 1 : -1, d, share * 0.5, amount);
      this.cry(s, b);
    }
    if (fatal) this.floor(s, b);
    return false;
  }

  private burn(s: Soldier, b: Injuries): void {
    b.cauterise();
    if (b.condition === 'healthy') {
      b.condition = 'wounded';
      this.announce(s.e, 'wounded');
    }
    if (b.rollAt === 0) b.rollAt = this.w.now + rand(T.fireRoll[0], T.fireRoll[1]);
  }

  /** Set alight by something that was not a flame: a blast. He panics the same. */
  caughtFire(e: Enemy): void {
    const b = this.bodyOf(e);
    if (b) this.burn(soldierOf(e)!, b);
  }

  /** Writes a wound down, with where on the bone it is. */
  private record(s: Soldier, b: Injuries, zone: ZoneId, side: 1 | -1 | 0, d: DamageInfo, share: number, amount: number): void {
    const e = s.e;
    const bone = d.bone ?? BONE_FOR[zone](side);
    const object = e.char.bones[bone];
    if (object) object.worldToLocal(_v.copy(d.point));
    else _v.set(0, 0, 0);
    const before = b.condition;
    b.add(zone, side, bone, _v.x, _v.y, _v.z, share, d.type, amount);
    if (before !== b.condition) this.announce(e, b.condition);
  }

  private announce(e: Enemy, condition: Condition): void {
    this.w.ctx.events.emit('enemy:condition', { enemy: e, condition });
  }

  /** The word over his head, once per man per zone, and the hook that pays for it. */
  private mark(s: Soldier, b: Injuries, zone: ZoneId, d: DamageInfo): void {
    if (!b.firstTime(ZONE_BIT[zone])) return;
    const rule = ZONES[zone];
    this.label(s, zone, rule.label, rule.bonus, d);
  }

  private label(s: Soldier, zone: ZoneId, label: string, bonus: number, d: DamageInfo): void {
    const { ctx, now } = this.w;
    ctx.events.emit('enemy:wounded', { enemy: s.e, zone, label, bonus, damage: d });
    if (now - this.labelAt < LABEL_GAP) return;
    this.labelAt = now;
    ctx.hud.floatText(s.e.center, label, LABEL_COLOR);
  }

  private cry(s: Soldier, b: Injuries): void {
    if (b.mute) say(s.e, this.w, 'vox_choke', 0.6);
    else this.o.comms.say('hit', s);
  }

  /** Skidded off the skull. He stays up, but nobody is home for a while. */
  private ring(s: Soldier, b: Injuries, d: DamageInfo): void {
    const { w } = this;
    const e = s.e;
    if (b.firstTime(RINGING_BIT)) this.label(s, 'head', RINGING.label, RINGING.bonus, d);
    if (b.condition === 'healthy') {
      b.condition = 'wounded';
      this.announce(e, 'wounded');
    }
    b.ringingUntil = w.now + RINGING.stun;
    s.hasOrder = false;
    e.char.anim.daze?.(RINGING.stun);
  }

  private concuss(s: Soldier, b: Injuries): void {
    const { w } = this;
    const seconds = rand(T.concussion[0], T.concussion[1]);
    b.concussedUntil = Math.max(b.concussedUntil, w.now + seconds);
    if (b.condition === 'healthy') {
      b.condition = 'wounded';
      this.announce(s.e, 'wounded');
    }
    s.hasOrder = false;
    s.e.char.anim.daze?.(seconds);
  }

  /** An arm or a hand stops answering. What he can still do about it depends on what he was carrying. */
  private loseLimb(s: Soldier, b: Injuries, side: 1 | -1 | 0, kind: 'arm' | 'hand'): void {
    const e = s.e;
    const left = side > 0;
    if (kind === 'hand') {
      if (left) b.handL = true;
      else b.handR = true;
    } else {
      if (left) b.armL = true;
      else b.armR = true;
      e.char.fracture(left ? B.upperArmL : B.upperArmR, 'limp');
    }
    const shielded = left && e.shield;
    this.manager.model.updateMaim(e);
    if (shielded) this.o.dropShield(s);
    if (b.armless) {
      this.o.dropWeapon(s, false);
      this.o.breakNerve(s);
      return;
    }
    // The right hand holds everything he owns, and the left is only needed for what takes two.
    const holding = !left || (s.def.twoHanded && s.weapon === 'primary');
    if (!holding || s.weapon === 'none') return;
    const scramble = kind === 'hand' && s.weapon === 'primary' && chance(SCRAMBLE);
    this.o.dropWeapon(s, scramble);
    if (scramble) return;
    if (s.def.sidearm && !s.spentSidearm) this.drawSidearm(s, b);
    else this.o.breakNerve(s);
  }

  /** Backup. One-handed, and with whichever hand he has left. */
  drawSidearm(s: Soldier, b: Injuries): void {
    const right = !b.armR && !b.handR;
    s.weapon = 'sidearm';
    s.spentSidearm = true;
    s.sidearmLeft = !right;
    s.mag = SIDEARM_MAG;
    s.reloadUntil = this.w.now + SIDEARM_DRAW;
    this.sidearms.draw(s.e, right);
    pose(s.e, 'stand');
  }

  // -------------------------------------------------------------------------------------------
  // Conditions
  // -------------------------------------------------------------------------------------------

  private goMortal(s: Soldier, b: Injuries): void {
    if (b.condition === 'mortal' || b.floored) return;
    const { now } = this.w;
    if (!b.canStand) {
      this.floor(s, b);
      return;
    }
    b.condition = 'mortal';
    b.mortalFrom = now;
    b.dyingFrom = Math.min(b.dyingFrom, now);
    b.mortalUntil = now + rand(T.mortal[0], T.mortal[1]);
    this.rollLastStand(s, b);
    this.announce(s.e, 'mortal');
    this.o.comms.say('dying', s);
  }

  /** Some men have one more thing in them. */
  private rollLastStand(s: Soldier, b: Injuries): void {
    if (b.lastStand !== 'none' || !chance(T.lastStand)) return;
    if (s.grenades > 0 && !b.armless && chance(T.lastGrenade)) b.lastStand = 'grenade';
    else if (s.def.sidearm && !b.armless) b.lastStand = 'sidearm';
  }

  /** He cannot go on standing. The fall itself is the damage model's: this makes him a man on the floor. */
  private floor(s: Soldier, b: Injuries): void {
    if (b.floored) return;
    const e = s.e;
    const { now } = this.w;
    const wasMortal = b.condition === 'mortal';
    b.floored = true;
    b.condition = 'downed';
    b.dyingFrom = Math.min(b.dyingFrom, now);
    b.mortalUntil = Infinity;
    let clock = rand(T.bleedOut[0], T.bleedOut[1]) * (wasMortal ? 0.6 : 1);
    for (let i = 0; i < b.count; i++) {
      const gone = ZONES[b.wounds[i]!.zone].gone;
      if (gone !== undefined) clock = Math.min(clock, gone);
    }
    b.bleedsOutAt = now + clock;
    this.rollLastStand(s, b);
    // Nobody crawls with a rifle. It goes down with him, and it is there if someone gets him back up.
    if (s.weapon === 'primary') this.o.dropWeapon(s, false);
    this.o.setDowned(e, true);
    this.manager.model.updateMaim(e);
    this.fallDue = true;
    if (e.downed) pose(e, 'downed');
    s.crawlPlanAt = now + 0.2;
    this.announce(e, 'downed');
  }

  /** He is going down for good, so whatever takes him there must not stand him back up. */
  stayDown(e: Enemy): void {
    pose(e, 'downed');
  }

  /** How long he lies where he fell before he starts to drag himself. */
  lieSeconds(b: Injuries): number {
    return b.bleedsOutAt - this.w.now < NO_CRAWL_LIE ? NO_CRAWL_LIE : rand(FLOORED_LIE[0], FLOORED_LIE[1]);
  }

  /** Out of blood on his feet. It reaches him where he stands. */
  private bledOut(s: Soldier, b: Injuries): void {
    const e = s.e;
    e.health = e.maxHealth * T.lastBlood;
    if (b.floored || b.condition === 'mortal') return;
    this.floor(s, b);
    this.fallDue = false;
    this.manager.model.drop(e, 0.7, b.held?.bone ?? B.spine);
  }

  /** The end of a clock. On his feet that is a collapse, on the floor it is the last of him going out. */
  private finish(s: Soldier, b: Injuries): void {
    const e = s.e;
    const f = this.final;
    f.amount = e.health + 1;
    f.source = b.source;
    f.point.copy(e.center);
    this.manager.model.kill(e, f, 'chest', null);
  }

  /** True for the hit a clock ended on, so the damage model can let him take his time going. */
  isBleedOut(d: DamageInfo): boolean {
    return d === this.final;
  }

  /** He had a grenade with the pin out, and now nobody is holding it. */
  onDeath(s: Soldier): void {
    const b = s.injuries;
    if (b.lastStand === 'grenade' && s.grenades > 0) this.o.dropLiveGrenade(s);
  }

  /** Back on his feet, with a medic's work on him. Only ever called on a man who can stand. */
  revive(s: Soldier, health: number): void {
    const e = s.e;
    const b = s.injuries;
    b.dressAll();
    if (!b.canStand) {
      b.stabilised = true;
      b.bleedsOutAt += T.stabilised;
      return;
    }
    b.floored = false;
    b.condition = 'wounded';
    b.bleedsOutAt = Infinity;
    e.health = Math.max(e.health, health);
    this.o.setDowned(e, false);
    this.manager.model.updateMaim(e);
    pose(e, 'stand');
    this.manager.model.standUp(e);
    this.rearm(s, b);
    this.syncBody(s, b);
    this.announce(e, 'wounded');
  }

  /** Back up with empty hands: the gun where he dropped it if he can still use one, or the pistol, or nothing and he runs. */
  private rearm(s: Soldier, b: Injuries): void {
    if (s.weapon !== 'none') return;
    const usable = !b.armless && (!s.def.twoHanded || (!b.armL && !b.armR && !b.handL && !b.handR));
    if (usable && s.droppedAt) s.scramble = s.droppedAt;
    else if (s.def.sidearm && !s.spentSidearm) this.drawSidearm(s, b);
    else this.o.breakNerve(s);
  }

  // -------------------------------------------------------------------------------------------
  // On his own time
  // -------------------------------------------------------------------------------------------

  /** Runs before he thinks or moves. */
  update(): void {
    const { now } = this.w;
    const list = this.o.soldiers;
    for (let i = list.length - 1; i >= 0; i--) {
      const s = list[i];
      if (!s || s.injuries.whole) continue;
      this.tick(s, s.injuries, now);
    }
  }

  private tick(s: Soldier, b: Injuries, now: number): void {
    const e = s.e;
    if (b.concussedUntil > 0 && now >= b.concussedUntil) b.concussedUntil = 0;
    if (b.ringingUntil > 0 && now >= b.ringingUntil) b.ringingUntil = 0;
    if (b.floored) this.tickFloored(s, b, now);
    else this.tickStanding(s, b, now);
    if (!e.alive) return;
    this.holdWorst(s, b, now);
    this.bleedVisibly(s, b, now);
    dripTrail(e, b, this.w, now);
    this.voice(s, b, now);
    this.syncBody(s, b);
  }

  private tickStanding(s: Soldier, b: Injuries, now: number): void {
    const e = s.e;
    if (b.condition === 'mortal') {
      if (now >= b.mortalUntil) {
        this.endMortal(s, b);
        return;
      }
      if (now >= b.nextStumble && !e.downed && e.fallIn <= 0) {
        const left = b.mortalProgress(now);
        b.nextStumble = now + STUMBLE_EARLY + (STUMBLE_LATE - STUMBLE_EARLY) * left;
        this.stumble(e, 0.2 + left * 0.45, b);
      }
    } else if (b.concussed(now) && now >= b.nextStumble && !e.downed) {
      b.nextStumble = now + rand(0.9, 1.9);
      this.stumble(e, 0.3, b);
    } else if (b.limp !== 0 && !e.downed) this.limp(e, b);
    if (e.burning > 0 && b.rollAt > 0 && now >= b.rollAt && !e.downed) {
      // Stop, drop: the floor is the first thing anyone thinks of, and it does put the fire out.
      b.rollAt = 0;
      e.burning = Math.min(e.burning, 0.7);
      this.manager.model.drop(e, 0.6, B.chest, rand(FIRE_ROLL[0], FIRE_ROLL[1]));
    }
  }

  private endMortal(s: Soldier, b: Injuries): void {
    const e = s.e;
    if (e.downed || chance(T.mortalDropsDead)) {
      this.finish(s, b);
      return;
    }
    this.floor(s, b);
    this.fallDue = false;
    this.manager.model.drop(e, 0.8, b.held?.bone ?? B.spine);
  }

  private stumble(e: Enemy, strength: number, b: Injuries): void {
    _dir.set(Math.sin(e.yaw) + rand(-0.9, 0.9), 0, Math.cos(e.yaw) + rand(-0.9, 0.9)).normalize();
    this.manager.model.stagger(e, 0.3 + strength * 0.4, _dir, strength, b.held?.bone ?? B.spine, 0.9);
  }

  /** The bad leg gives a little every time it takes his weight, in step with the pulse movement puts in his gait. */
  private limp(e: Enemy, b: Injuries): void {
    const beat = Math.sin(e.gaitPhase) > 0;
    if (beat === b.limpBeat) return;
    b.limpBeat = beat;
    if (!beat || Math.hypot(e.velocity.x, e.velocity.z) < 0.5) return;
    _dir.set(e.velocity.x, 0, e.velocity.z).normalize();
    e.char.anim.stumble?.(_dir, 0.08, b.limp > 0 ? B.thighL : B.thighR);
  }

  private tickFloored(s: Soldier, b: Injuries, now: number): void {
    const e = s.e;
    const treating = s.rescuer?.aidStage === 'treat';
    // Hands on him: the clock stops, because that is what the hands are for.
    if (treating) b.bleedsOutAt += this.w.ctx.time.dt;
    if (now >= b.bleedsOutAt) {
      this.finish(s, b);
      return;
    }
    if (e.downed || e.fallIn > 0) return;
    pose(e, 'downed');
    if (b.bleedsOutAt - now > 1.2) crawlOn(s, b, this.w, this.o);
    else {
      e.mode = 'hold';
      e.face = 'lock';
    }
    if (b.lastStand === 'sidearm' && s.weapon === 'none' && !s.spentSidearm && !b.armless && e.hasLos && e.dist < LAST_STAND_RANGE) {
      this.drawSidearm(s, b);
      this.o.comms.say('lastStand', s);
    }
    if (s.weapon === 'sidearm') {
      s.sees = e.hasLos;
      if (s.reloadUntil > 0 && now >= s.reloadUntil) s.reloadUntil = 0;
    }
  }

  private holdWorst(s: Soldier, b: Injuries, now: number): void {
    if (now < b.nextHold) return;
    b.nextHold = now + HOLD_REFRESH;
    const e = s.e;
    // One arm gone and a pistol in the other: there is no hand left to put on anything.
    const busy = s.weapon === 'sidearm' && (b.armL || b.armR || b.handL || b.handR);
    const w = b.armless || busy ? null : b.worst();
    if (w !== b.held) {
      b.held = w;
      b.refresh();
    }
    if (!w || e.downed) return;
    const bone = e.char.bones[w.bone];
    if (!bone) return;
    e.char.anim.holdWound?.(w.bone, _v.set(w.x, w.y, w.z).applyMatrix4(bone.matrixWorld), HOLD_SECONDS);
  }

  /** What the eye gets: an artery beats, and a lung comes up through the mouth. */
  private bleedVisibly(s: Soldier, b: Injuries, now: number): void {
    const e = s.e;
    const { fx } = this.w.ctx;
    if (now >= b.nextSpurt) {
      b.nextSpurt = now + SPURT_SECONDS;
      const w = b.worst();
      const bone = w && e.char.bones[w.bone];
      if (w && bone && w.bleed >= SPURT_FROM) {
        _v.set(w.x, w.y, w.z).applyMatrix4(bone.matrixWorld);
        _n.set(w.x, 0.15, w.z).normalize().transformDirection(bone.matrixWorld);
        fx.bloodJet(_v, _n, clamp(w.bleed * 3, 0.25, 0.8));
      }
    }
    if (b.breathless && now >= b.nextCough) {
      b.nextCough = now + rand(COUGH_SECONDS[0], COUGH_SECONDS[1]);
      const head = e.char.bones[B.head];
      if (!head) return;
      _v.setFromMatrixPosition(head.matrixWorld);
      _n.set(0, -0.15, 1).transformDirection(head.matrixWorld);
      _v.addScaledVector(_n, 0.12);
      fx.bloodJet(_v, _n, 0.25);
      say(e, this.w, 'vox_choke', 0.55);
    }
  }

  /** Screams carry, frighten whoever hears them, and bring people. */
  private voice(s: Soldier, b: Injuries, now: number): void {
    const e = s.e;
    const every = b.floored ? b.screams || FLOORED_SCREAM : b.screams;
    if (b.mute || every === 0 || now < b.nextScream) return;
    b.nextScream = now + every * rand(0.8, 1.3);
    if (b.floored && e.dist < BEG_RANGE && e.hasLos) {
      this.o.comms.say('beg', s);
      return;
    }
    say(e, this.w, 'vox_scream', 0.9);
    this.o.comms.say('scream', s);
    s.calledAt = now;
    const r2 = T.screamRange * T.screamRange;
    for (const other of this.o.soldiers) {
      if (other !== s && other.fighting && other.e.position.distanceToSquared(e.position) < r2) this.o.scare(other, FEAR.scream);
    }
  }

  /** Writes what the wounds add up to onto the body that movement and the health clock read. */
  private syncBody(s: Soldier, b: Injuries): void {
    const e = s.e;
    const pace = b.floored ? 1 : b.speed * (b.condition === 'mortal' ? 1 - 0.45 * b.mortalProgress(this.w.now) : 1);
    e.speedMul = s.baseSpeed * pace;
    const stumps = e.char.severed.size > 0 ? this.stumpBleed(e) : 0;
    e.bleed = b.floored || b.condition === 'mortal' ? 0 : (b.bleed + stumps) * e.maxHealth;
    // A body gore has alive goes on as weak as he is.
    if (e.downed) this.w.ctx.gore.setStrength(e.char, this.manager.model.strengthOf(e));
  }

  private stumpBleed(e: Enemy): number {
    return (4 - e.maim.legs - e.maim.arms) * STUMP_BLEED;
  }

  /** A limb came off, which is the worst thing that can happen to one. */
  onSevered(e: Enemy, region: GoreRegion): void {
    const s = soldierOf(e);
    if (!s) return;
    const b = s.injuries;
    if (b.condition === 'healthy') {
      b.condition = 'wounded';
      this.announce(e, 'wounded');
    }
    if (region.startsWith('leg') || region.startsWith('shin')) {
      b.legGone = true;
      this.floor(s, b);
    } else if (region.startsWith('arm') || region.startsWith('forearm')) {
      this.loseLimb(s, b, region.endsWith('L') ? 1 : -1, 'arm');
    }
  }
}

/** Where a wound with no bone of its own goes. Blasts have no struck bone. */
const BONE_FOR: Record<ZoneId, (side: 1 | -1 | 0) => number> = {
  thigh: s => (s > 0 ? B.thighL : B.thighR),
  innerThigh: s => (s > 0 ? B.thighL : B.thighR),
  hand: s => (s > 0 ? B.handL : B.handR),
  arm: s => (s > 0 ? B.foreArmL : B.foreArmR),
  shoulder: s => (s > 0 ? B.upperArmL : B.upperArmR),
  lung: () => B.chest,
  heart: () => B.chest,
  gut: () => B.spine,
  carotid: () => B.neck,
  spine: () => B.spine,
  pelvis: () => B.hips,
  head: () => B.head,
};
