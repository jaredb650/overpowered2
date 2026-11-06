/**
 * A squad's brain. It runs about once a second, looks at what the squad knows and gives each man one order. The men then
 * carry it out on their own, so all the tactics live here as a choice of where to send whom.
 *
 * The doctrine is base of fire and manoeuvre (section 16.1). A squad has two fire teams, and only one ever moves:
 *
 *   advance    Nothing in view. A long way off the squad jogs in file; inside BOUND_RANGE it goes by bounds, one team covering.
 *   engage     Team 0 is the base of fire. Team 1 swings round the threat. They swap, closing a little each cycle.
 *   stack      The threat went through a door. Men stack on both sides, a banger goes in, then they enter.
 *   fallback   Too hurt or too frightened to stay. The same bounds, going backwards, away from the threat.
 *   regroup    What is left gathers on the leader, gets its nerve back, and goes again.
 */
import * as THREE from 'three';
import type { KillEvent } from '../../core/gameplay';
import { clamp, lerp, rand, wrapAngle } from '../../core/math';
import type { Squad } from '../director';
import type { CoverSpot, SpotQuery, SpotReading } from './cover';
import { MAX_SQUAD, SUCCESSION, type Role } from './doctrine';
import { FEAR, RAPID_SECONDS, RAPID_SHARE } from './morale';
import type { Outpost } from './index';
import { Route } from './routes';
import type { Soldier, Urgency } from './soldier';

export type SquadMode = 'advance' | 'engage' | 'stack' | 'fallback' | 'regroup';

export interface Door {
  x: number;
  z: number;
  /** Unit travel direction through it. */
  dx: number;
  dz: number;
  w: number;
}

/** Seconds a team that has arrived holds and fires before the other team goes. */
const MANOEUVRE_REST = 4;
/** Seconds a sighting counts as contact. */
const CONTACT_MEMORY = 5;
/** Quiet this long and the next sighting is called out as new. */
const CALLOUT_GAP = 8;
/** Beyond this the squad moves in file. Inside it, one team always covers. */
const BOUND_RANGE = 34;
const COLUMN_LEG = 20;
const BOUND_LENGTH = 11;
/** Reached the place and found nothing. */
const ARRIVED = 9;
const FALLBACK_LENGTH = 13;
const FALLBACK_BOUNDS = 4;
/** Far enough away to stop and think. */
const CLEAR_OF_THREAT = 30;
const REGROUP_SECONDS = 9;
const REGROUP_RADIUS = 8;
const REGROUP_NERVE = 15;
/** Seconds a squad stands stunned after its leader goes down. */
const LEADERLESS_SECONDS = 2.2;
const ORDER_STAGGER = 0.28;
/** A team that has not arrived by now is not going to. Long enough that a bound normally finishes before the next begins. */
const STEP_TIMEOUT = 11;
const COVER_FIRE_SECONDS = 5.5;
/** How far a door may be from the squad, and the threat from the door. */
const STACK_REACH = 16;
const STACK_DEPTH = 13;
/** Quiet this long before the squad assumes the threat has gone to ground behind the door. */
const STACK_AFTER = 2.5;
const STACK_GATHER_SECONDS = 8;
const STACK_FUSE_SECONDS = 1.9;
const STACK_ENTRY_SECONDS = 3;
const STACK_COOLDOWN = 18;
const GRENADE_MIN = 8;
const GRENADE_MAX = 24;
/** Lost sight of it this recently: it is probably still behind that corner. */
const GRENADE_QUIET_FROM = 2;
const GRENADE_QUIET_TO = 7;
const GRENADE_COOLDOWN = 12;
/** The furthest a man will walk for one manoeuvre. Past this a flank is a lap of the building, and the fight is over before he arrives. */
const MAX_MANOEUVRE = 30;
/** A firing line lost for this long is not coming back. */
const NO_SHOT_PATIENCE = 4;
const PANIC_RETREAT = 12;
const PANIC_COOLDOWN = 6;

const _c = new THREE.Vector3();
const _anchor = new THREE.Vector3();
const _p = new THREE.Vector3();
const _reading: SpotReading = { hidden: false, canShoot: false, side: 0 };
const _query: SpotQuery = {
  anchor: _anchor, radius: 8, threat: new THREE.Vector3(), near: 0, far: 60, bearing: NaN, bearingSlack: 0.4, needShot: false, spacing: 2, uid: 0, from: new THREE.Vector3(),
};

export class OutpostSquad implements Squad {
  size = 0;
  bearing = 0;
  readonly members: Soldier[] = [];
  leader: Soldier | null = null;
  mode: SquadMode = 'advance';
  /** Men it set out with. */
  strength = 0;

  readonly threat = new THREE.Vector3();
  knownAt = -99;
  seenAt = -99;

  /** Which team moves next. */
  movingTeam: 0 | 1 = 1;
  /** The current step's time limit. */
  stepUntil = 0;
  /** Bearing from the threat this squad's base sits on. Spread by the Outpost so two squads make a crossfire. */
  sector = NaN;
  flankSide: 1 | -1 = 1;
  cycle = 0;
  coverFireUntil = 0;
  thinkAt = 0;
  /** A long way off: moving in file, not by bounds. */
  filing = false;
  /** Answers to the Commander: its men have posts, so this brain stays out of it. */
  directed = false;

  private stunnedUntil = 0;
  private readonly axis = new Route();
  private readonly rally = new THREE.Vector3();
  private bounds = 0;
  private regroupUntil = 0;
  private fallbackReadyAt = 0;
  private grenadeReadyAt = 0;
  private readonly lossTimes: number[] = [];

  private door: Door | null = null;
  /** +1 or -1 along the door's travel direction, pointing at the far side. */
  private doorInto = 1;
  private stackStage = 0;
  private stackUntil = 0;
  private stackReadyAt = 0;

  constructor(readonly id: number, readonly name: string, private readonly o: Outpost) {}

  // -------------------------------------------------------------------------------------------
  // Membership
  // -------------------------------------------------------------------------------------------

  join(s: Soldier): void {
    s.squad = this;
    this.members.push(s);
    s.seat = this.size = this.members.length;
    this.strength = Math.max(this.strength, this.members.length);
    // The base of fire is team 0, so a squad's heavy weapon never gets sent round the side. Everyone else alternates.
    s.team = s.def.base ? 0 : ((this.members.length & 1) as 0 | 1);
    if (!this.leader || this.outranks(s.role, this.leader.role)) this.leader = s;
  }

  private outranks(a: Role, b: Role): boolean {
    return SUCCESSION.indexOf(a) < SUCCESSION.indexOf(b);
  }

  /** He is gone from the squad: dead, broken or off the map. */
  leave(s: Soldier): void {
    const i = this.members.indexOf(s);
    if (i < 0) return;
    this.members.splice(i, 1);
    this.size = this.members.length;
    if (this.leader === s) this.promote();
  }

  private promote(): void {
    this.leader = null;
    let best = Infinity;
    for (const m of this.members) {
      const rank = SUCCESSION.indexOf(m.role);
      if (m.fighting && rank < best) {
        best = rank;
        this.leader = m;
      }
    }
  }

  /** A death in this squad. It frightens them, and the leader's frightens them more. */
  onLoss(kill: KillEvent, wasLeader: boolean): void {
    const { o } = this;
    const now = o.w.now;
    this.lossTimes.push(now);
    if (wasLeader && this.leader) {
      this.stunnedUntil = now + LEADERLESS_SECONDS;
      o.comms.say('leaderDown', this.leader);
      for (const m of this.members) o.scare(m, FEAR.leaderDown);
      this.leader.morale += 12;
      o.comms.say('takingCommand', this.leader);
    } else if (this.members.length > 0) {
      o.comms.say('manDown', this.members[0]!);
    }
    while (this.lossTimes.length > 0 && now - this.lossTimes[0]! > RAPID_SECONDS) this.lossTimes.shift();
    if (this.lossTimes.length >= Math.ceil(this.strength * RAPID_SHARE) && this.members.length > 0) {
      // A squad cut down this fast leaves survivors who have just watched it happen.
      this.lossTimes.length = 0;
      for (const m of this.members) o.scare(m, FEAR.rapidLosses);
      o.squadShattered(this, kill);
    }
  }

  fighters(): number {
    let n = 0;
    for (const m of this.members) if (m.fighting) n++;
    return n;
  }

  private centroid(out: THREE.Vector3): THREE.Vector3 {
    out.set(0, 0, 0);
    let n = 0;
    for (const m of this.members) {
      if (!m.fighting) continue;
      out.add(m.e.position);
      n++;
    }
    return n > 0 ? out.multiplyScalar(1 / n) : out;
  }

  private meanMorale(): number {
    let sum = 0;
    let n = 0;
    for (const m of this.members) {
      if (!m.fighting) continue;
      sum += m.morale;
      n++;
    }
    return n > 0 ? sum / n : 0;
  }

  private teamBusy(): boolean {
    for (const m of this.members) if (m.fighting && (m.task === 'move' || m.hasOrder)) return true;
    return false;
  }

  // -------------------------------------------------------------------------------------------
  // Knowledge
  // -------------------------------------------------------------------------------------------

  get inContact(): boolean {
    return this.o.w.now - this.seenAt < CONTACT_MEMORY;
  }

  /** Someone in the squad saw or heard something. It goes round the squad at once and out on the radio. */
  report(s: Soldier, at: THREE.Vector3, seen: boolean): void {
    const { o } = this;
    const now = o.w.now;
    // Noise is no reason to doubt what somebody can see.
    if (!seen && now - this.seenAt < 3) return;
    const stale = now - this.knownAt;
    this.threat.copy(at);
    this.knownAt = now;
    if (seen) {
      if (now - this.seenAt > CALLOUT_GAP) o.comms.say('contact', s);
      this.seenAt = now;
    } else if (stale > 6) o.comms.say('noise', s);
    o.radio(at, seen);
  }

  /** The radio has something newer than this squad knows. */
  adopt(at: THREE.Vector3, time: number): void {
    if (time <= this.knownAt) return;
    this.threat.copy(at);
    this.knownAt = time;
  }

  // -------------------------------------------------------------------------------------------
  // Thinking
  // -------------------------------------------------------------------------------------------

  think(): void {
    const { o } = this;
    const now = o.w.now;
    this.thinkAt = now + rand(0.6, 0.9);
    if (this.directed || now < this.stunnedUntil || this.knownAt < 0 || this.fighters() === 0) return;
    this.chooseMode(now);
    this.checkPanic(now);
    switch (this.mode) {
      case 'advance': this.advance(now); break;
      case 'engage': this.engage(now); break;
      case 'stack': this.stack(now); break;
      case 'fallback': this.fallBack(now); break;
      case 'regroup': this.regroup(now); break;
    }
  }

  private chooseMode(now: number): void {
    const { o } = this;
    if (this.mode !== 'fallback' && this.mode !== 'regroup' && now >= this.fallbackReadyAt && this.shouldFallBack()) {
      this.startFallback();
      return;
    }
    if (this.mode === 'advance' && this.inContact) this.startEngage();
    // Flankers are out of sight by design, so a quiet moment mid-manoeuvre is no reason to call them back.
    else if (this.mode === 'engage' && !this.inContact && !this.teamBusy()) {
      this.mode = 'advance';
      this.sector = NaN;
      this.stepUntil = 0;
      if (this.leader) o.comms.say('lost', this.leader);
    }
    if (o.doctrine.stacks && (this.mode === 'advance' || this.mode === 'engage') && now >= this.stackReadyAt && now - this.seenAt > STACK_AFTER) this.tryStack(now);
  }

  private startEngage(): void {
    this.mode = 'engage';
    this.cycle = 0;
    this.stepUntil = 0;
    this.sector = this.bearingFromThreat();
    this.flankSide = this.id % 2 === 0 ? 1 : -1;
  }

  private shouldFallBack(): boolean {
    const dread = this.o.dread.value;
    const morale = this.meanMorale();
    const lost = this.strength - this.members.length;
    return (lost * 2 >= this.strength && morale < 72) || morale < 45 + dread * 0.3;
  }

  /** A panicking man stops waiting for orders. */
  private checkPanic(now: number): void {
    const { o } = this;
    for (const s of this.members) {
      if (s.state !== 'panicked' || !s.fighting || s.task !== 'hold' || s.hasOrder || now < s.orderAt + PANIC_COOLDOWN) continue;
      const away = Math.atan2(s.e.position.x - this.threat.x, s.e.position.z - this.threat.z) + rand(-0.7, 0.7);
      _anchor.set(s.e.position.x + Math.sin(away) * PANIC_RETREAT, s.e.position.y, s.e.position.z + Math.cos(away) * PANIC_RETREAT);
      if (!o.w.ctx.world.nav.nearest(_anchor, 7, _anchor)) continue;
      const spot = this.seek(s, 9, 16, 60, NaN, false);
      s.orderAt = now;
      if (spot && spot !== s.spot) {
        this.send(s, spot, 2, 0);
        o.comms.say('panic', s);
      }
    }
  }

  private seek(s: Soldier, radius: number, near: number, far: number, bearing: number, needShot: boolean): CoverSpot | null {
    const q = _query;
    q.radius = radius;
    q.threat.copy(this.threat);
    q.near = near;
    q.far = far;
    q.bearing = bearing;
    q.needShot = needShot;
    q.spacing = this.o.doctrine.spacing;
    q.uid = s.e.uid;
    q.from.copy(s.e.position);
    return this.o.cover.pick(q, _reading);
  }

  private send(s: Soldier, spot: CoverSpot, urgency: Urgency, delay: number): void {
    this.o.order(s, spot.position, spot, urgency, delay);
    this.o.fireFrom(s, spot, _reading);
  }

  /** Near `_anchor`, or at it when no cover is to be had: nobody stays where he was just because there is no wall. */
  private moveUp(s: Soldier, urgency: Urgency, delay: number, radius: number): boolean {
    const spot = s.role === 'shield' ? null : this.seek(s, radius, s.def.near, s.def.far, NaN, false);
    if (spot === s.spot && spot !== null) return false;
    if (spot) this.send(s, spot, urgency, delay);
    else this.o.order(s, _anchor, null, urgency, delay);
    return true;
  }

  private advance(now: number): void {
    const { o } = this;
    if (now < this.stepUntil && this.teamBusy()) return;
    this.centroid(_c);
    if (!o.routes.find(_c, this.threat, this.axis)) return;
    const left = this.axis.length;
    this.filing = left > BOUND_RANGE;
    if (left < ARRIVED) {
      // Nothing here. Only Command can say where to look next.
      o.lostTheTrail();
      return;
    }
    if (this.filing) {
      this.axis.pointAt(COLUMN_LEG, _anchor);
      let i = 0;
      for (const s of this.members) if (s.fighting) this.moveUp(s, 1, i++ * ORDER_STAGGER, 7);
      this.stepUntil = now + STEP_TIMEOUT;
      return;
    }
    this.movingTeam = this.movingTeam === 0 ? 1 : 0;
    this.axis.pointAt(BOUND_LENGTH, _anchor);
    let moved = 0;
    for (const s of this.members) {
      if (!s.fighting) continue;
      if (s.team === this.movingTeam) {
        if (this.moveUp(s, 1, moved * ORDER_STAGGER, 7)) moved++;
      }
    }
    if (moved > 0) {
      o.comms.say('moving', this.pick(this.movingTeam));
      this.bounds++;
    }
    this.stepUntil = now + STEP_TIMEOUT;
  }

  /** Someone on `team`, preferring a man who is not moving. */
  private pick(team: 0 | 1): Soldier | null {
    let any: Soldier | null = null;
    for (const s of this.members) {
      if (!s.fighting || s.team !== team) continue;
      if (s.task === 'hold') return s;
      any = s;
    }
    return any;
  }

  private engage(now: number): void {
    const { o } = this;
    const nav = o.w.ctx.world.nav;
    this.takeCover();
    this.considerGrenade(now);
    if (this.teamBusy() ? now < this.stepUntil : now < this.stepUntil - MANOEUVRE_REST) return;
    this.fixFiringLines(now);
    this.movingTeam = this.movingTeam === 0 ? 1 : 0;
    this.cycle++;
    const flanking = this.movingTeam === 1;
    const bearing = flanking ? this.sector + (this.flankSide * o.doctrine.flankAngle * Math.PI) / 180 : this.sector;
    // Each exchange brings them closer, because a squad that only stands and shoots is not trying to win.
    const press = clamp(1 - this.cycle * 0.16, 0.25, 1);
    let moved = 0;
    for (const s of this.members) {
      if (!s.fighting || s.team !== this.movingTeam) continue;
      if (s.def.base && s.canShoot && s.spot) continue;
      const range = lerp(s.def.near, s.def.far, press * 0.7);
      _anchor.set(this.threat.x + Math.sin(bearing) * range, s.e.position.y, this.threat.z + Math.cos(bearing) * range);
      if (!nav.nearest(_anchor, 7, _anchor)) continue;
      if (s.role === 'shield') {
        // He is the cover. He walks to the ground the team wants, and the others can use him.
        o.order(s, _anchor, null, 1, moved++ * ORDER_STAGGER);
        continue;
      }
      const spot = this.seek(s, 9, s.def.near, s.def.far, bearing, false);
      if (!spot || spot === s.spot || !this.withinReach(s, spot)) continue;
      this.send(s, spot, 2, moved * ORDER_STAGGER);
      moved++;
    }
    if (moved > 0) {
      this.coverFireUntil = now + COVER_FIRE_SECONDS;
      const mover = this.pick(this.movingTeam);
      if (mover) o.comms.say(flanking ? 'flanking' : 'moving', mover);
      const cover = this.pick(this.movingTeam === 0 ? 1 : 0);
      if (cover) o.comms.say('covering', cover);
    }
    this.stepUntil = now + rand(5.5, 8.5);
  }

  private withinReach(s: Soldier, spot: CoverSpot): boolean {
    return this.o.routes.find(s.e.position, spot.position, this.axis, this.o.intel) && this.axis.length <= MAX_MANOEUVRE;
  }

  /** Nobody stays in the open by choice. A shield is its own cover. */
  private takeCover(): void {
    for (const s of this.members) {
      if (!s.fighting || s.task !== 'hold' || s.hasOrder || s.spot || s.role === 'shield') continue;
      _anchor.copy(s.e.position);
      const spot = this.seek(s, 9, s.def.near * 0.6, s.def.far, NaN, true);
      if (spot) this.send(s, spot, 2, 0);
    }
  }

  /** Between manoeuvres: a man who cannot see the fight from where he is should go somewhere he can. */
  private fixFiringLines(now: number): void {
    const { o } = this;
    for (const s of this.members) {
      if (!s.fighting || s.task !== 'hold' || s.hasOrder) continue;
      if (s.canShoot || s.noShotSince === 0 || now - s.noShotSince < NO_SHOT_PATIENCE) continue;
      _anchor.copy(s.e.position);
      s.noShotSince = now;
      const spot = this.seek(s, 11, s.def.near, s.def.far, NaN, true);
      if (spot && spot !== s.spot && this.withinReach(s, spot)) this.send(s, spot, 1, 0);
      else o.fireFrom(s, s.spot, _reading);
    }
  }

  private considerGrenade(now: number): void {
    const quiet = now - this.seenAt;
    if (now < this.grenadeReadyAt || quiet < GRENADE_QUIET_FROM || quiet > GRENADE_QUIET_TO) return;
    for (const s of this.members) {
      if (!s.fighting || s.grenades <= 0 || s.task !== 'hold' || s.throwKind) continue;
      const d = s.e.position.distanceTo(this.threat);
      if (d < GRENADE_MIN || d > GRENADE_MAX) continue;
      s.throwKind = 'frag';
      s.throwAt.copy(this.threat);
      this.grenadeReadyAt = now + GRENADE_COOLDOWN;
      return;
    }
  }

  // -------------------------------------------------------------------------------------------
  // Door stacks
  // -------------------------------------------------------------------------------------------

  private tryStack(now: number): void {
    const { o } = this;
    if (this.fighters() < 3) return;
    this.centroid(_c);
    let best: Door | null = null;
    let bestD = Infinity;
    let into = 1;
    for (const d of o.doors) {
      if (o.doorTaken(d, this)) continue;
      const ours = (_c.x - d.x) * d.dx + (_c.z - d.z) * d.dz;
      const theirs = (this.threat.x - d.x) * d.dx + (this.threat.z - d.z) * d.dz;
      if (ours * theirs >= 0) continue;
      const reach = Math.hypot(_c.x - d.x, _c.z - d.z);
      const depth = Math.hypot(this.threat.x - d.x, this.threat.z - d.z);
      if (reach > STACK_REACH || depth > STACK_DEPTH || reach + depth >= bestD) continue;
      bestD = reach + depth;
      best = d;
      into = theirs > 0 ? 1 : -1;
    }
    if (!best) return;
    this.door = best;
    this.doorInto = into;
    this.mode = 'stack';
    this.stackStage = 0;
    this.stackUntil = now + STACK_GATHER_SECONDS;
    let i = 0;
    for (const s of this.members) {
      if (!s.fighting) continue;
      const side = i % 2 === 0 ? 1 : -1;
      const rank = Math.floor(i / 2);
      // Either side of the frame, on the near side, so nobody stands in the doorway.
      const back = 1.4 + rank * 1.1;
      const across = best.w / 2 + 0.9;
      _anchor.set(best.x - best.dx * into * back - best.dz * side * across, s.e.position.y, best.z - best.dz * into * back + best.dx * side * across);
      if (o.w.ctx.world.nav.nearest(_anchor, 2.2, _anchor)) o.order(s, _anchor, null, 1, i * ORDER_STAGGER);
      i++;
    }
    if (this.leader) o.comms.say('breach', this.leader);
  }

  private stack(now: number): void {
    const { o } = this;
    const door = this.door;
    if (!door) {
      this.mode = 'advance';
      return;
    }
    const seenAgain = now - this.seenAt < 1;
    if (this.stackStage < 2 && seenAgain) {
      this.endStack(now);
      return;
    }
    if (this.stackStage === 0) {
      let ready = 0;
      for (const s of this.members) if (s.fighting && s.task === 'hold' && !s.hasOrder) ready++;
      if (ready < Math.min(3, this.fighters()) && now < this.stackUntil) return;
      const thrower = this.leader;
      if (thrower?.fighting) {
        thrower.throwKind = 'flash';
        thrower.throwAt.set(door.x + door.dx * this.doorInto * 4, thrower.e.position.y + 0.3, door.z + door.dz * this.doorInto * 4);
      }
      this.stackStage = 1;
      this.stackUntil = now + STACK_FUSE_SECONDS;
    } else if (this.stackStage === 1 && now >= this.stackUntil) {
      let i = 0;
      for (const s of this.members) {
        if (!s.fighting) continue;
        const side = i % 2 === 0 ? 1 : -1;
        const deep = 3 + (i >> 1) * 1.6;
        _anchor.set(door.x + door.dx * this.doorInto * deep - door.dz * side * 1.6, s.e.position.y, door.z + door.dz * this.doorInto * deep + door.dx * side * 1.6);
        if (o.w.ctx.world.nav.nearest(_anchor, 2.5, _anchor)) o.order(s, _anchor, null, 2, i * 0.35);
        i++;
      }
      if (this.leader) o.comms.say('breach', this.leader);
      this.stackStage = 2;
      this.stackUntil = now + STACK_ENTRY_SECONDS;
    } else if (this.stackStage === 2 && now >= this.stackUntil) {
      this.endStack(now);
    }
  }

  private endStack(now: number): void {
    this.door = null;
    this.stackReadyAt = now + STACK_COOLDOWN;
    if (this.inContact) this.startEngage();
    else {
      this.mode = 'advance';
      this.stepUntil = 0;
    }
  }

  /** The door this squad is stacked on, if any. */
  get stackedOn(): Door | null {
    return this.door;
  }

  // -------------------------------------------------------------------------------------------
  // Falling back
  // -------------------------------------------------------------------------------------------

  private startFallback(): void {
    const { o } = this;
    this.mode = 'fallback';
    this.bounds = 0;
    this.stepUntil = 0;
    this.door = null;
    this.centroid(_c);
    o.fallbackPoint(_c, this.threat, this.rally);
    if (this.leader) o.comms.say('fallback', this.leader);
  }

  private fallBack(now: number): void {
    const { o } = this;
    if (now < this.stepUntil && this.teamBusy()) return;
    this.centroid(_c);
    const clear = Math.hypot(_c.x - this.threat.x, _c.z - this.threat.z) > CLEAR_OF_THREAT;
    if (this.bounds >= FALLBACK_BOUNDS || clear || !o.routes.find(_c, this.rally, this.axis, o.intel) || this.axis.length < 6) {
      this.startRegroup(now);
      return;
    }
    this.movingTeam = this.movingTeam === 0 ? 1 : 0;
    this.axis.pointAt(FALLBACK_LENGTH, _anchor);
    let moved = 0;
    for (const s of this.members) {
      if (!s.fighting || s.team !== this.movingTeam) continue;
      const spot = this.seek(s, 8, 0, 80, NaN, false);
      if (spot && spot !== s.spot) this.send(s, spot, 2, moved * ORDER_STAGGER);
      else o.order(s, _anchor, null, 2, moved * ORDER_STAGGER);
      moved++;
    }
    // Whoever is not moving keeps the threat's head down: this is the difference between a withdrawal and a rout.
    this.coverFireUntil = now + COVER_FIRE_SECONDS;
    this.bounds++;
    this.stepUntil = now + STEP_TIMEOUT;
  }

  private startRegroup(now: number): void {
    const { o } = this;
    this.mode = 'regroup';
    this.regroupUntil = now + REGROUP_SECONDS;
    const lead = this.leader ?? this.members[0];
    if (!lead) return;
    this.rally.copy(lead.e.position);
    let i = 0;
    for (const s of this.members) {
      if (!s.fighting || s === lead) continue;
      _anchor.copy(this.rally);
      const spot = this.seek(s, 7, 0, 80, NaN, false);
      if (spot && spot !== s.spot) this.send(s, spot, 1, i++ * ORDER_STAGGER);
    }
    o.comms.say('regroup', lead);
  }

  private regroup(now: number): void {
    let scattered = 0;
    for (const s of this.members) {
      if (s.fighting && s.e.position.distanceToSquared(this.rally) > REGROUP_RADIUS * REGROUP_RADIUS) scattered++;
    }
    if (scattered > 0 && now < this.regroupUntil) return;
    for (const s of this.members) s.morale += REGROUP_NERVE;
    this.fallbackReadyAt = now + 20;
    this.mode = 'advance';
    this.sector = NaN;
    this.stepUntil = 0;
  }

  /** Spreads a survivor into a squad with room, so nobody fights on alone when there is someone left to fight beside. */
  absorb(s: Soldier): boolean {
    if (this.directed || s.squad.directed || this.members.length >= MAX_SQUAD || this.fighters() === 0) return false;
    this.join(s);
    return true;
  }

  /** Bearing from the threat to the squad's centre of mass, for spreading squads around it. */
  bearingFromThreat(): number {
    this.centroid(_p);
    return Math.atan2(_p.x - this.threat.x, _p.z - this.threat.z);
  }

  /** Moves the sector, keeping it the shortest way round. */
  shiftSector(to: number): void {
    this.sector = wrapAngle(to);
  }
}
