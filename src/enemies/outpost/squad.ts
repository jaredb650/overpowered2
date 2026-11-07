/**
 * A squad's brain. It runs about twice a second, reads what it believes into facts, picks a goal and asks the planner for the cheapest
 * drills that get there. The men then carry out one order each, so all the tactics live here as a choice of where to send whom.
 *
 * The doctrine is base of fire and manoeuvre (section 16.1), and only ever one fire team moves at a time. Drills, from planner.ts:
 *
 *   search      Nothing in view. Both teams go, a beat apart, with the pace set by how fresh the trail is.
 *   baseOfFire  Men with a line lay rounds on the threat and the guns work its lane, whether or not they can see it.
 *   flank       Team 1 goes round on a hidden route, re-aiming as the threat moves, while team 0 keeps it busy.
 *   cutOff      The threat is running. Men go to the exit it is heading for, not to where it was.
 *   frag, flash The threat has dug in or the squad wants a way in. It gets a grenade, and the squad goes in behind it.
 *   breach      The threat went through a door. Men stack on both sides, a banger goes in, then they enter.
 *   rush        There is an opening. Everyone goes in, firing, and the guns cover it.
 *   setAmbush, lieInWait  Men cover a door in silence, holding fire, until it comes through.
 *   retreat, regroup      Too hurt to stay: bounds backwards to better ground, then form up and go again.
 *
 * A squad says what it is doing, out loud, because a player gives credit only for what he hears announced.
 */
import * as THREE from 'three';
import type { KillEvent } from '../../core/gameplay';
import { lerp, rand, wrapAngle } from '../../core/math';
import type { Squad } from '../director';
import type { CoverSpot, SpotQuery, SpotReading } from './cover';
import { MAX_SQUAD, SUCCESSION, type Role } from './doctrine';
import { FEAR, RAPID_SECONDS, RAPID_SHARE } from './morale';
import type { Outpost } from './index';
import {
  ACTION_COUNT, actionBit, ACTIONS, actionIndex, basePrices, CAMPING, CONTACT, DOOR, FORMED, GOALS, HAS_FLASH, HAS_FRAG, LOCATED, makePlan, MAX_PLAN, OPENING, PINNED, RUNNING, SAFE, SHIELDED, WAITING,
  type ActionId, type GoalId,
} from './planner';
import type { Rank } from './rank';
import { Route } from './routes';
import type { Grenade, Soldier, Urgency } from './soldier';

export type SquadMode = 'advance' | 'engage' | 'stack' | 'fallback' | 'regroup' | 'rush' | 'flush' | 'cutoff' | 'ambush';

/** What one drill did on this tick. */
const GOING = 0;
const DONE = 1;
const FAILED = 2;
type StepResult = typeof GOING | typeof DONE | typeof FAILED;

export interface Door {
  x: number;
  z: number;
  /** Unit travel direction through it. */
  dx: number;
  dz: number;
  w: number;
}

/** Seconds a sighting counts as contact, and a position as worth acting on. */
const CONTACT_MEMORY = 3;
const LOCATED_MEMORY = 14;
/** Quiet this long and the next sighting is called out as new. */
const CALLOUT_GAP = 8;
/** Beyond this the squad moves in file. */
const BOUND_RANGE = 34;
const COLUMN_LEG = 22;
const BOUND_LENGTH = 15;
/** Reached the place and found nothing. */
const ARRIVED = 7;
const FALLBACK_LENGTH = 13;
const FALLBACK_BOUNDS = 4;
/** Far enough away to stop and think. */
const CLEAR_OF_THREAT = 30;
const REGROUP_SECONDS = 7;
const REGROUP_RADIUS = 8;
const REGROUP_NERVE = 15;
/** Seconds a squad stands stunned after its leader goes down. */
const LEADERLESS_SECONDS = 1.4;
const ORDER_STAGGER = 0.22;
/** A team that has not arrived by now is not going to. */
const STEP_TIMEOUT = 7;
const FLANK_TIMEOUT = 13;
const COVER_FIRE_SECONDS = 5;
/** Seconds of drill before a base of fire counts as laid, whoever has fired. */
const BASE_SETTLE = 2;
/** How far a door may be from the squad, and the threat from the door. */
const STACK_REACH = 16;
const STACK_DEPTH = 13;
/** Quiet this long before the squad assumes the threat has gone to ground behind the door. */
const STACK_AFTER = 2.5;
const STACK_GATHER_SECONDS = 6;
const STACK_FUSE_SECONDS = 1.4;
const STACK_ENTRY_SECONDS = 3;
const STACK_COOLDOWN = 14;
const GRENADE_MIN = 6;
const GRENADE_MAX = 28;
/** Seconds between grenades from one squad. A second one straight after the first is a thing a player cannot read. */
const GRENADE_COOLDOWN = 8;
/** Seconds a throw may take before the squad stops waiting for it. */
const THROW_PATIENCE = 2.6;
/** The furthest a man will walk for one manoeuvre. Past this a flank is a lap of the building, and the fight is over before he arrives. */
const MAX_MANOEUVRE = 56;
/** A firing line lost for this long is not coming back. */
const NO_SHOT_PATIENCE = 1.6;
const PANIC_RETREAT = 12;
const PANIC_COOLDOWN = 6;
/** The threat moved this far and flankers re-aim, no more often than this. */
const REAIM_METRES = 7;
const REAIM_SECONDS = 2.6;
/** Radians between the two teams, seen from the threat, before a flank counts. */
const FLANK_SUCCESS = 0.8;
/** Seconds an opening stays open. */
const OPENING_SECONDS = 6;
const RUSH_SECONDS = 6;
/** Metres from the threat a man in a rush stops at. */
const RUSH_STAND = 9;
const RUSH_STAND_CLOSE = 3.2;
const RUSH_REAIM: readonly [number, number] = [0.9, 1.5];
/** Seconds a drill that failed stays off the table. */
const BLOCK_SECONDS = 9;
/** A plan is thrown away and thought through again this often even if nothing went wrong. */
const PLAN_LIFE = 16;
/** After losing sight of it, a man keeps firing on the place for this long. */
const LAST_SEEN_FIRE = 3;
/** Metres above the threat that count as a commanding position, and how far a gunner will go to find one. */
const HIGH_GROUND = 2.5;
const CLIMB_REACH = 24;
/** Seconds since anyone saw it that covering fire stops being covering anything. */
const COVER_FIRE_STALE = 7;
/** How wide and how fast a gun works its lane when it cannot see. */
const LANE_WIDTH = 3.4;
const LANE_RATE = 1.7;
/** Metres the squad looks past a runner's last position, along its heading. */
const LEAD_THE_TRAIL = 7;
/** An ambush: how long the men wait, how close it gets before they open up, and how long a man can stare at it before he fires anyway. */
const AMBUSH_SECONDS = 15;
const AMBUSH_RANGE = 15;
/** The same, for men told to hold their fire until they hear the word. */
const AMBUSH_ARM_LENGTH = 3;
const AMBUSH_STARE = 2.2;
const AMBUSH_NEAR = 6;
const AMBUSH_FAR = 19;
/** How far from its mark a mission's squad will shift to find cover. */
const LYING_RADIUS = 7;
/** Seconds of silence a sprung ambush buys the squad before it may lie in wait again. */
const AMBUSH_REST = 40;
/** Chance per thought that a squad with a door to hand and a friend still pushing sets up on it. */
const AMBUSH_CHANCE = 0.2;
/** How near the door the threat has to be, and how squarely it has to be heading for it, for waiting there to be any use. */
const AMBUSH_THREAT_REACH = 24;
const AMBUSH_HEADING = 0.35;
/** Chance a squad that fell back and formed up waits for whoever followed it. */
const AMBUSH_AFTER_RETREAT = 0.6;
/** Seconds a retreat stays off the table once the squad has re-formed. */
const FALLBACK_REST = 20;
/** Seconds a threat has to stay put before it is camping, and what it has to be doing to count as running. */
const CAMP_SECONDS = 4;
const RUN_SPEED = 7.5;
/** Seconds ahead of a runner that a cut-off aims for, and how far from there a door still counts as its exit. */
const CUT_SECONDS = 2.2;
const CUT_DOOR_REACH = 11;
/** Further off than this and it will be gone before anyone arrives. */
const CUT_REACH = 32;
/** A price that loses to any plan at all. */
const NEVER = 99;
/** Seconds a base of fire counts as laid once it has been. */
const PINNED_MEMORY = 5;
/** What a change in the facts has to be for the squad to drop what it is doing and think again. */
const REACT_TO = OPENING | CAMPING | SHIELDED;
const GRIP_ON_THREAT = 0.8;

const _c = new THREE.Vector3();
const _anchor = new THREE.Vector3();
const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const _reading: SpotReading = { hidden: false, canShoot: false, side: 0 };
const _query: SpotQuery = {
  anchor: _anchor, radius: 8, threat: new THREE.Vector3(), near: 0, far: 60, bearing: NaN, bearingSlack: 0.4, needShot: false, spacing: 2, uid: 0, from: new THREE.Vector3(), height: 0, anyFloor: false,
};

export class OutpostSquad implements Squad {
  size = 0;
  bearing = 0;
  readonly members: Soldier[] = [];
  leader: Soldier | null = null;
  mode: SquadMode = 'advance';
  /** Men it set out with. */
  strength = 0;
  /** What its men are. The leader sits a step above. */
  grade: Rank = 'regular';

  readonly threat = new THREE.Vector3();
  knownAt = -99;
  seenAt = -99;

  /** Which team moves next. */
  movingTeam: 0 | 1 = 1;
  /** Bearing from the threat this squad's base sits on. Spread by the Outpost so two squads make a crossfire. */
  sector = NaN;
  flankSide: 1 | -1 = 1;
  coverFireUntil = 0;
  thinkAt = 0;
  /** A long way off: moving in file, not by bounds. */
  filing = false;
  /** Answers to the Commander: its men have posts, so this brain stays out of it. */
  directed = false;

  /** What it wants, and the drill it is on, for anyone reading the fight. */
  goal: GoalId = 'destroy';
  drill: ActionId | null = null;
  /** The last drill it started, and when, because a short one can be over between two looks. */
  lastDrill: ActionId | null = null;
  lastDrillAt = -99;
  /** Where silent men point their guns. */
  readonly watch = new THREE.Vector3();

  private stunnedUntil = 0;
  private readonly axis = new Route();
  private readonly rally = new THREE.Vector3();
  private bounds = 0;
  private fallbackReadyAt = 0;
  private grenadeReadyAt = 0;
  private readonly lossTimes: number[] = [];

  private readonly plan = new Int8Array(MAX_PLAN);
  private planLength = 0;
  private planStep = 0;
  private planAt = -99;
  private readonly prices = new Float32Array(ACTION_COUNT);
  private readonly blockedUntil = new Float64Array(ACTION_COUNT);
  private lastFacts = 0;
  private drillAt = 0;
  private stepUntil = 0;
  private stage = 0;
  private openUntil = 0;
  private pinnedUntil = 0;
  private safe = false;
  private formed = false;
  private waiting = false;
  /** Set by a mission: lie still on this mark until something happens. */
  private lying = false;
  private patient = false;
  private ambushUntil = 0;
  private ambushReadyAt = 0;
  private sightedSince = 0;
  private firedOn = false;
  /** The drill the Commander wants, and for how long. */
  private ordered: ActionId | null = null;
  private orderedUntil = 0;
  private readonly flankAim = new THREE.Vector3();
  private reaimAt = 0;
  private readonly trail = new THREE.Vector3();

  private door: Door | null = null;
  /** +1 or -1 along the door's travel direction, pointing at the far side. */
  private doorInto = 1;
  private stackReadyAt = 0;

  constructor(readonly id: number, readonly name: string, readonly outpost: Outpost) {}

  // -------------------------------------------------------------------------------------------
  // Membership
  // -------------------------------------------------------------------------------------------

  join(s: Soldier): void {
    s.squad = this;
    // The base of fire is team 0, so a squad's heavy weapon never gets sent round the side. Everyone else evens up the teams.
    s.team = s.def.base ? 0 : this.teamSize(0) > this.teamSize(1) ? 1 : 0;
    this.members.push(s);
    s.seat = this.size = this.members.length;
    s.silent = this.lying;
    this.strength = Math.max(this.strength, this.members.length);
    if (!this.leader || this.outranks(s.role, this.leader.role)) this.leader = s;
  }

  private teamSize(team: 0 | 1): number {
    let n = 0;
    for (const m of this.members) if (m.team === team) n++;
    return n;
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
    const { outpost: o } = this;
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
    return this.teamCentre(out, -1);
  }

  private teamCentre(out: THREE.Vector3, team: number): THREE.Vector3 {
    out.set(0, 0, 0);
    let n = 0;
    for (const m of this.members) {
      if (!m.fighting || (team >= 0 && m.team !== team)) continue;
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

  private moverBusy(): boolean {
    for (const m of this.members) if (m.fighting && m.team === this.movingTeam && (m.task === 'move' || m.hasOrder)) return true;
    return false;
  }

  /** Deaths empty one team faster than the other, and a squad with no team to send cannot flank. */
  private evenTeams(): void {
    let team1 = 0;
    let spare: Soldier | null = null;
    for (const m of this.members) {
      if (!m.fighting) continue;
      if (m.team === 1) team1++;
      else if (!m.def.base) spare = m;
    }
    if (team1 === 0 && spare && this.fighters() >= 2) spare.team = 1;
  }

  // -------------------------------------------------------------------------------------------
  // Knowledge
  // -------------------------------------------------------------------------------------------

  get inContact(): boolean {
    return this.outpost.w.now - this.seenAt < CONTACT_MEMORY;
  }

  /** Someone in the squad saw or heard something. It goes round the squad at once and out on the radio. */
  report(s: Soldier, at: THREE.Vector3, seen: boolean): void {
    const { outpost: o } = this;
    const now = o.w.now;
    // Noise is no reason to doubt what somebody can see.
    if (!seen && now - this.seenAt < 3) return;
    const stale = now - this.knownAt;
    this.threat.copy(at);
    this.knownAt = now;
    if (seen) {
      if (now - this.seenAt > CALLOUT_GAP) o.comms.say('contact', s);
      this.seenAt = now;
      this.trail.copy(o.track.velocity);
    } else if (stale > 6) o.comms.say('noise', s);
    o.radio(at, seen);
  }

  /** The radio has something newer than this squad knows. */
  adopt(at: THREE.Vector3, time: number): void {
    if (time <= this.knownAt) return;
    this.threat.copy(at);
    this.knownAt = time;
  }

  /** Somebody saw a moment worth having: the threat reloading, blinded or hurt. */
  opening(seconds: number): void {
    this.openUntil = Math.max(this.openUntil, this.outpost.w.now + seconds);
  }

  /** Rounds landed among the men. An ambush that has been found is an ambush no longer. */
  fired(): void {
    this.firedOn = true;
  }

  /**
   * The Commander says so. Prices the drill at nothing for a while and the planner does the rest. False if the squad has no way to do it,
   * and then nothing has changed: he must never be heard giving an order his men cannot carry out.
   */
  obey(drill: ActionId, seconds: number): boolean {
    const now = this.outpost.w.now;
    const facts = this.readFacts(now);
    this.ordered = drill;
    this.orderedUntil = now + seconds;
    const kept = this.goal;
    this.replan(now, 'destroy', facts);
    const index = actionIndex(drill);
    for (let i = 0; i < this.planLength; i++) if (this.plan[i] === index) return true;
    this.ordered = null;
    this.goal = kept;
    this.planLength = 0;
    return false;
  }

  /** A mission's 'hold': quiet, on this mark, until somebody comes close or starts shooting. `patient` lets the player walk right in first. */
  lieStill(patient = false): void {
    this.lying = true;
    this.patient = patient;
    this.goal = 'waylay';
    this.planLength = 0;
    this.ambushUntil = Infinity;
    for (const s of this.members) s.silent = true;
  }

  /** Let off the leash. */
  stopLying(): void {
    if (!this.lying) return;
    this.lying = false;
    this.ambushUntil = 0;
    this.spring();
  }

  // -------------------------------------------------------------------------------------------
  // Thinking
  // -------------------------------------------------------------------------------------------

  think(): void {
    const { outpost: o } = this;
    const now = o.w.now;
    this.thinkAt = now + rand(0.4, 0.6);
    if (this.directed || now < this.stunnedUntil || this.knownAt < 0 || this.fighters() === 0) return;
    this.checkPanic(now);
    const facts = this.readFacts(now);
    const goal = this.chooseGoal(now, facts);
    const fresh = facts & ~this.lastFacts & REACT_TO;
    this.lastFacts = facts;
    if (goal !== this.goal || fresh !== 0 || this.planStep >= this.planLength || now - this.planAt > PLAN_LIFE) this.replan(now, goal, facts);
    if (this.planStep >= this.planLength) return;
    if (this.goal === 'destroy' && this.drill !== 'rush') {
      this.takeCover();
      this.fixFiringLines(now);
    }
    this.run(now, facts);
  }

  /** What the squad believes, as bits. Everything it decides comes from these. */
  private readFacts(now: number): number {
    const { outpost: o } = this;
    let f = 0;
    if (now - this.knownAt < LOCATED_MEMORY) f |= LOCATED;
    if (this.inContact) f |= CONTACT;
    if (now < this.pinnedUntil || o.pinnedByAnother(this, now)) f |= PINNED;
    if (now < this.openUntil) f |= OPENING;
    if (o.stillFor >= CAMP_SECONDS) f |= CAMPING;
    if (o.track.speed >= RUN_SPEED) f |= RUNNING;
    if (this.waiting) f |= WAITING;
    if (this.safe) f |= SAFE;
    if (this.formed) f |= FORMED;
    if (o.captives.held) f |= SHIELDED;
    if (o.doctrine.stacks && now >= this.stackReadyAt && now - this.seenAt > STACK_AFTER && this.fighters() >= 3 && this.findDoor()) f |= DOOR;
    if (now >= this.grenadeReadyAt && f & LOCATED) {
      if (this.thrower('frag')) f |= HAS_FRAG;
      if (this.thrower('flash')) f |= HAS_FLASH;
    }
    return f;
  }

  private chooseGoal(now: number, facts: number): GoalId {
    if (this.lying) return 'waylay';
    if (this.goal === 'survive') return facts & SAFE ? 'recover' : 'survive';
    if (this.goal === 'recover') {
      if (!(facts & FORMED)) return 'recover';
      this.safe = this.formed = false;
      return Math.random() < AMBUSH_AFTER_RETREAT && this.ambushDoor(this.rally) ? this.startWaylay(now) : 'destroy';
    }
    if (now >= this.fallbackReadyAt && this.shouldFallBack()) return 'survive';
    if (this.goal === 'waylay') return now < this.ambushUntil && !(facts & CONTACT && !this.waiting) ? 'waylay' : 'destroy';
    if (this.wantsAmbush(now, facts)) return this.startWaylay(now);
    return 'destroy';
  }

  private startWaylay(now: number): GoalId {
    this.ambushUntil = now + AMBUSH_SECONDS;
    return 'waylay';
  }

  /** One squad waits while another pushes. A side that all sat on doors would be a side the player could walk away from. */
  private wantsAmbush(now: number, facts: number): boolean {
    if (facts & CONTACT || now < this.ambushReadyAt || this.fighters() < 3 || this.grade === 'conscript' || Math.random() > AMBUSH_CHANCE) return false;
    let pushing = 0;
    for (const q of this.outpost.squads) {
      if (q === this) continue;
      if (q.goal === 'waylay') return false;
      if (q.goal === 'destroy' && q.fighters() > 0 && !q.directed) pushing++;
    }
    this.centroid(_c);
    const door = pushing > 0 ? this.ambushDoor(_c) : null;
    return door !== null && this.comingThrough(door);
  }

  /** Waiting on a door is only worth anything if something is about to use it. */
  private comingThrough(door: Door): boolean {
    const { threat } = this;
    const v = this.outpost.track.velocity;
    const dx = door.x - threat.x, dz = door.z - threat.z;
    const reach = Math.hypot(dx, dz);
    const speed = Math.hypot(v.x, v.z);
    return reach < AMBUSH_THREAT_REACH && speed > 2 && (v.x * dx + v.z * dz) / (speed * reach || 1) > AMBUSH_HEADING;
  }

  private shouldFallBack(): boolean {
    const dread = this.outpost.dread.value;
    const morale = this.meanMorale();
    const lost = this.strength - this.members.length;
    return (lost * 2 >= this.strength && morale < 72) || morale < 45 + dread * 0.3;
  }

  private replan(now: number, goal: GoalId, facts: number): void {
    // The new goal first: what a drill leaves behind depends on whether the squad still means to lie in wait.
    this.goal = goal;
    if (this.drill) this.leaveDrill();
    this.evenTeams();
    const { prices } = this;
    basePrices(prices);
    // The same drills come out differently every time, because no two moments cost the same.
    for (let i = 0; i < ACTION_COUNT; i++) prices[i]! *= rand(0.88, 1.12);
    if (facts & CAMPING) {
      prices[actionIndex('frag')] = 1.1;
      prices[actionIndex('flash')] = 1.6;
    }
    if (facts & RUNNING) prices[actionIndex('cutOff')] = 1.2;
    this.centroid(_c);
    if (_c.distanceTo(this.threat) > CUT_REACH) prices[actionIndex('cutOff')] = NEVER;
    // Somebody is holding one of ours. The way past that is round the side.
    if (facts & SHIELDED) prices[actionIndex('flank')] = 0.5;
    if (this.fighters() < 3) prices[actionIndex('flank')]! *= 1.6;
    if (now < this.orderedUntil && this.ordered) prices[actionIndex(this.ordered)] = 0;
    this.planLength = makePlan(facts, GOALS[goal], this.blocked(now, goal), prices, this.plan);
    this.planStep = 0;
    this.planAt = now;
  }

  private blocked(now: number, goal: GoalId): number {
    let mask = 0;
    for (let i = 0; i < ACTION_COUNT; i++) if (now < this.blockedUntil[i]!) mask |= 1 << i;
    if (goal === 'waylay') {
      for (const a of ACTIONS) if (a.id !== 'setAmbush' && a.id !== 'lieInWait') mask |= actionBit(a.id);
      return mask & ~(actionBit('setAmbush') | actionBit('lieInWait'));
    }
    mask |= actionBit('setAmbush') | actionBit('lieInWait');
    if (goal === 'destroy') mask |= actionBit('retreat') | actionBit('regroup');
    return mask;
  }

  private run(now: number, facts: number): void {
    const index = this.plan[this.planStep]!;
    const action = ACTIONS[index]!;
    if (this.drill !== action.id) {
      // A drill whose ground has gone by the time its turn comes is no use. Think again.
      if ((facts & action.needs) !== action.needs) {
        this.planLength = 0;
        return;
      }
      this.enter(action.id, now);
    }
    const result = this.step(action.id, now);
    if (result === GOING) return;
    this.leaveDrill();
    this.outpost.w.ctx.events.emit('squad:drill', { squad: this.name, drill: action.id, done: result === DONE, seconds: now - this.drillAt });
    if (result === DONE) this.planStep++;
    else {
      this.blockedUntil[index] = now + BLOCK_SECONDS;
      this.planLength = 0;
    }
  }

  private enter(id: ActionId, now: number): void {
    this.drill = this.lastDrill = id;
    this.drillAt = this.lastDrillAt = now;
    this.stage = 0;
    this.stepUntil = 0;
    switch (id) {
      case 'search': this.mode = 'advance'; break;
      case 'baseOfFire': this.enterBaseOfFire(now); break;
      case 'flank': this.enterFlank(now); break;
      case 'cutOff': this.enterCutOff(now); break;
      case 'frag': this.enterThrow(now, 'frag'); break;
      case 'flash': this.enterThrow(now, 'flash'); break;
      case 'breach': this.enterBreach(now); break;
      case 'rush': this.enterRush(now); break;
      case 'setAmbush': this.enterSetAmbush(now); break;
      case 'lieInWait': this.mode = 'ambush'; break;
      case 'retreat': this.enterRetreat(); break;
      case 'regroup': this.enterRegroup(now); break;
    }
  }

  private step(id: ActionId, now: number): StepResult {
    switch (id) {
      case 'search': return this.stepSearch(now);
      case 'baseOfFire': return this.stepBaseOfFire(now);
      case 'flank': return this.stepFlank(now);
      case 'cutOff': return this.stepCutOff(now);
      case 'frag':
      case 'flash': return this.stepThrow(now);
      case 'breach': return this.stepBreach(now);
      case 'rush': return this.stepRush(now);
      case 'setAmbush': return this.stepSetAmbush(now);
      case 'lieInWait': return this.stepLieInWait(now);
      case 'retreat': return this.stepRetreat(now);
      case 'regroup': return this.stepRegroup(now);
    }
  }

  /** Whatever the drill left switched on, because a squad can be pulled out of one at any moment. */
  private leaveDrill(): void {
    if (this.drill === 'setAmbush' || this.drill === 'lieInWait') {
      if (!this.waiting || this.goal !== 'waylay') this.quietOff();
    }
    if (this.drill === 'breach') this.door = null;
    this.drill = null;
  }

  private quietOff(): void {
    this.waiting = false;
    for (const s of this.members) s.silent = false;
  }

  /** A panicking man stops waiting for orders. */
  private checkPanic(now: number): void {
    const { outpost: o } = this;
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

  private seek(s: Soldier, radius: number, near: number, far: number, bearing: number, needShot: boolean, target: THREE.Vector3 = this.threat): CoverSpot | null {
    const q = this.queryFor(s, radius, near, far, target);
    q.bearing = bearing;
    q.needShot = needShot;
    return this.outpost.cover.pick(q, _reading);
  }

  private queryFor(s: Soldier, radius: number, near: number, far: number, target: THREE.Vector3 = this.threat): SpotQuery {
    const q = _query;
    q.radius = radius;
    q.threat.copy(target);
    q.near = near;
    q.far = far;
    q.bearing = NaN;
    q.needShot = true;
    q.spacing = this.outpost.doctrine.spacing;
    q.uid = s.e.uid;
    q.from.copy(s.e.position);
    // A belt or a long rifle wants height.
    q.height = s.def.base ? 1 : 0;
    return q;
  }

  private send(s: Soldier, spot: CoverSpot, urgency: Urgency, delay: number): void {
    this.outpost.order(s, spot.position, spot, urgency, delay);
    this.outpost.fireFrom(s, spot, _reading);
  }

  /** Near `_anchor`, or at it when no cover is to be had: nobody stays where he was just because there is no wall. */
  private moveUp(s: Soldier, urgency: Urgency, delay: number, radius: number): boolean {
    const spot = s.role === 'shield' ? null : this.seek(s, radius, s.def.near, s.def.far, NaN, false);
    if (spot === s.spot && spot !== null) return false;
    if (spot) this.send(s, spot, urgency, delay);
    else this.outpost.order(s, _anchor, null, urgency, delay);
    return true;
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

  private withinReach(s: Soldier, to: THREE.Vector3): boolean {
    return this.outpost.routes.find(s.e.position, to, this.axis, this.outpost.intel) && this.axis.length <= MAX_MANOEUVRE;
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
    const { outpost: o } = this;
    for (const s of this.members) {
      if (!s.fighting || s.task !== 'hold' || s.hasOrder) continue;
      if (s.canShoot || s.noShotSince === 0 || now - s.noShotSince < NO_SHOT_PATIENCE) continue;
      _anchor.copy(s.e.position);
      s.noShotSince = now;
      const spot = this.seek(s, 11, s.def.near, s.def.far, NaN, true);
      if (spot && spot !== s.spot && this.withinReach(s, spot.position)) this.send(s, spot, 1, 0);
      else o.fireFrom(s, s.spot, _reading);
    }
  }

  /** Where a man with no view puts his rounds. A gun walks them across the lane the threat was last in, so the ground stays denied. */
  fireOnLane(s: Soldier, out: THREE.Vector3, now: number): void {
    out.copy(this.threat);
    if (!s.def.base) return;
    const dx = this.threat.x - s.e.position.x, dz = this.threat.z - s.e.position.z;
    const d = Math.hypot(dx, dz) || 1;
    const sway = Math.sin(now * LANE_RATE + s.seat * 1.7) * LANE_WIDTH;
    out.x += (-dz / d) * sway;
    out.z += (dx / d) * sway;
  }

  /** Whether a man with no view should be firing at all. A belt spent on a place nobody has looked at for a while is a belt thrown away. */
  firesBlind(now: number): boolean {
    const quiet = now - this.seenAt;
    return quiet < LAST_SEEN_FIRE || (now < this.coverFireUntil && quiet < COVER_FIRE_STALE);
  }

  // -------------------------------------------------------------------------------------------
  // Search
  // -------------------------------------------------------------------------------------------

  private stepSearch(now: number): StepResult {
    const { outpost: o } = this;
    if (this.inContact) return DONE;
    if (now < this.stepUntil && this.teamBusy()) return GOING;
    this.centroid(_c);
    // A runner keeps running. The place to go is ahead of where it was last seen, not the place itself.
    const fresh = now - this.seenAt < LOCATED_MEMORY;
    _p.copy(this.threat);
    if (fresh && Math.hypot(this.trail.x, this.trail.z) > RUN_SPEED) {
      const speed = Math.hypot(this.trail.x, this.trail.z);
      _p.x += (this.trail.x / speed) * LEAD_THE_TRAIL;
      _p.z += (this.trail.z / speed) * LEAD_THE_TRAIL;
      if (!o.w.ctx.world.nav.nearest(_p, 5, _p)) _p.copy(this.threat);
    }
    if (!o.routes.find(_c, _p, this.axis)) return FAILED;
    const left = this.axis.length;
    this.filing = left > BOUND_RANGE;
    if (left < ARRIVED) {
      // Nothing here. Only Command can say where to look next.
      o.lostTheTrail();
      this.stepUntil = now + 1;
      return GOING;
    }
    this.axis.pointAt(this.filing ? COLUMN_LEG : BOUND_LENGTH, _anchor);
    const pace: Urgency = fresh ? 2 : 1;
    let i = 0;
    for (const s of this.members) if (s.fighting && !this.holdsHeight(s) && this.moveUp(s, pace, i * ORDER_STAGGER + s.team * 0.8, 7)) i++;
    if (i > 0 && !this.filing && this.leader) o.comms.say('moving', this.leader);
    this.stepUntil = now + STEP_TIMEOUT;
    return GOING;
  }

  // -------------------------------------------------------------------------------------------
  // Base of fire
  // -------------------------------------------------------------------------------------------

  private enterBaseOfFire(now: number): void {
    const { outpost: o } = this;
    this.mode = 'engage';
    this.sector = this.bearingFromThreat();
    this.flankSide = this.id % 2 === 0 ? 1 : -1;
    this.coverFireUntil = now + COVER_FIRE_SECONDS;
    this.climb();
    const gun = this.pick(0);
    if (gun) o.comms.say('pinning', gun);
  }

  /** A gun on a tower owns a lane the whole way down. A man with a belt who can get up onto something goes and does it. */
  private climb(): void {
    for (const s of this.members) {
      if (!s.fighting || !s.def.base || s.task !== 'hold' || this.holdsHeight(s)) continue;
      _anchor.copy(s.e.position);
      _query.anyFloor = true;
      const spot = this.outpost.cover.pick(this.queryFor(s, CLIMB_REACH, s.def.near, s.def.far * 2), _reading);
      _query.anyFloor = false;
      if (spot && spot !== s.spot && spot.position.y - s.e.position.y >= HIGH_GROUND && this.walksTo(s, spot)) this.send(s, spot, 2, 0);
    }
  }

  /** A route to the foot of a tower is not a route up it. */
  private walksTo(s: Soldier, spot: CoverSpot): boolean {
    const { axis } = this;
    return this.withinReach(s, spot.position) && Math.abs(axis.y[axis.count - 1]! - spot.position.y) < 1;
  }

  /** On height with a gun: he has what he came for, and nobody walks him down off it to go looking. */
  private holdsHeight(s: Soldier): boolean {
    return s.def.base && s.e.position.y - this.threat.y >= HIGH_GROUND;
  }

  private stepBaseOfFire(now: number): StepResult {
    this.coverFireUntil = now + COVER_FIRE_SECONDS;
    let firing = false;
    for (const m of this.members) if (m.fighting && now - m.firedAt < 1.2) firing = true;
    if (!firing && now - this.drillAt < BASE_SETTLE) return GOING;
    this.pinnedUntil = now + PINNED_MEMORY;
    return DONE;
  }

  // -------------------------------------------------------------------------------------------
  // Flank
  // -------------------------------------------------------------------------------------------

  private enterFlank(now: number): void {
    const { outpost: o } = this;
    this.mode = 'engage';
    this.movingTeam = 1;
    // Wherever the base is now, which is not always where it was when the drill was planned.
    this.teamCentre(_p, 0);
    this.sector = Math.atan2(_p.x - this.threat.x, _p.z - this.threat.z);
    this.chooseFlankSide();
    this.coverFireUntil = now + COVER_FIRE_SECONDS;
    const moved = this.sendFlankers();
    this.stage = moved;
    this.stepUntil = now + FLANK_TIMEOUT;
    this.flankAim.copy(this.threat);
    this.reaimAt = now + REAIM_SECONDS;
    if (moved === 0) return;
    const mover = this.pick(1);
    if (mover) o.comms.say('flanking', mover);
    const cover = this.pick(0);
    if (cover) o.comms.say('covering', cover);
  }

  /** The side whose ground the threat cannot see, because a flank is worth nothing once it has been watched coming. */
  private chooseFlankSide(): void {
    const { outpost: o } = this;
    const nav = o.w.ctx.world.nav;
    this.centroid(_c);
    let best = Infinity;
    for (const side of [1, -1] as const) {
      const b = this.sector + (side * o.doctrine.flankAngle * Math.PI) / 180;
      _p.set(this.threat.x + Math.sin(b) * 14, _c.y, this.threat.z + Math.cos(b) * 14);
      if (!nav.nearest(_p, 7, _p) || !o.routes.find(_c, _p, this.axis, o.intel)) continue;
      if (this.axis.length < best) {
        best = this.axis.length;
        this.flankSide = side;
      }
    }
  }

  private sendFlankers(): number {
    const { outpost: o } = this;
    const nav = o.w.ctx.world.nav;
    const bearing = this.sector + (this.flankSide * o.doctrine.flankAngle * Math.PI) / 180;
    let moved = 0;
    for (const s of this.members) {
      if (!s.fighting || s.team !== 1) continue;
      const range = lerp(s.def.near, s.def.far, 0.3);
      _anchor.set(this.threat.x + Math.sin(bearing) * range, s.e.position.y, this.threat.z + Math.cos(bearing) * range);
      if (!nav.nearest(_anchor, 7, _anchor)) continue;
      if (s.role === 'shield') {
        // He is the cover. He walks to the ground the team wants, and the others can use him.
        o.order(s, _anchor, null, 1, moved++ * ORDER_STAGGER);
        continue;
      }
      const spot = this.seek(s, 9, s.def.near * 0.7, s.def.far, bearing, false);
      if (spot && spot !== s.spot && this.withinReach(s, spot.position)) this.send(s, spot, 2, moved++ * ORDER_STAGGER);
      else if (!spot && this.withinReach(s, _anchor)) o.order(s, _anchor, null, 2, moved++ * ORDER_STAGGER);
    }
    return moved;
  }

  private stepFlank(now: number): StepResult {
    if (this.stage === 0) return FAILED;
    this.coverFireUntil = now + COVER_FIRE_SECONDS;
    if (now >= this.reaimAt && this.flankAim.distanceToSquared(this.threat) > REAIM_METRES * REAIM_METRES) {
      this.reaimAt = now + REAIM_SECONDS;
      this.flankAim.copy(this.threat);
      this.sendFlankers();
    }
    const round = this.flankAngle();
    let eyes = false;
    for (const m of this.members) if (m.fighting && m.team === 1 && m.sees) eyes = true;
    if (round >= FLANK_SUCCESS && (eyes || !this.moverBusy())) {
      this.opening(OPENING_SECONDS);
      return DONE;
    }
    if (now < this.stepUntil && (this.moverBusy() || now - this.drillAt < 2)) return GOING;
    // They got there and it was not enough. Round the side still beats stood in front of it.
    if (round >= FLANK_SUCCESS * 0.6) {
      this.opening(OPENING_SECONDS * 0.5);
      return DONE;
    }
    return FAILED;
  }

  /** Radians between the two teams as the threat sees them. */
  flankAngle(): number {
    const { threat } = this;
    this.teamCentre(_p, 0);
    this.teamCentre(_q, 1);
    return Math.abs(wrapAngle(Math.atan2(_p.x - threat.x, _p.z - threat.z) - Math.atan2(_q.x - threat.x, _q.z - threat.z)));
  }

  // -------------------------------------------------------------------------------------------
  // Cut-off
  // -------------------------------------------------------------------------------------------

  private enterCutOff(now: number): void {
    const { outpost: o } = this;
    this.mode = 'cutoff';
    this.movingTeam = 1;
    const v = o.track.velocity;
    _p.set(this.threat.x + v.x * CUT_SECONDS, this.threat.y, this.threat.z + v.z * CUT_SECONDS);
    // It is going through a door, if there is one anywhere near where it is going.
    let best = CUT_DOOR_REACH;
    for (const d of o.doors) {
      const reach = Math.hypot(d.x - _p.x, d.z - _p.z);
      if (reach >= best) continue;
      best = reach;
      _p.x = d.x;
      _p.z = d.z;
    }
    let moved = 0;
    this.watch.copy(_p);
    for (const s of this.members) {
      if (!s.fighting || s.team !== 1) continue;
      _anchor.copy(_p);
      if (!o.w.ctx.world.nav.nearest(_anchor, 7, _anchor)) continue;
      const spot = this.seek(s, 11, 3, 16, NaN, false, _p);
      if (spot && this.withinReach(s, spot.position)) this.send(s, spot, 2, moved++ * ORDER_STAGGER);
      else if (this.withinReach(s, _anchor)) o.order(s, _anchor, null, 2, moved++ * ORDER_STAGGER);
    }
    this.stage = moved;
    this.coverFireUntil = now + COVER_FIRE_SECONDS;
    this.stepUntil = now + STEP_TIMEOUT;
    if (moved > 0 && this.leader) o.comms.say('cutoff', this.leader);
  }

  private stepCutOff(now: number): StepResult {
    if (this.stage === 0) return FAILED;
    this.coverFireUntil = now + 2;
    let eyes = false;
    for (const m of this.members) if (m.fighting && m.team === 1 && m.sees) eyes = true;
    if (eyes) this.opening(OPENING_SECONDS * 0.6);
    return eyes || !this.moverBusy() || now >= this.stepUntil ? DONE : GOING;
  }

  // -------------------------------------------------------------------------------------------
  // Grenades
  // -------------------------------------------------------------------------------------------

  /** A man in range with a clear throw. A grenade that hits the wall in front of him is the squad's own problem. */
  private thrower(kind: Grenade): Soldier | null {
    const { outpost: o } = this;
    let best: Soldier | null = null;
    let bestD = Infinity;
    _q.copy(this.threat);
    _q.y += GRIP_ON_THREAT;
    for (const s of this.members) {
      if (!s.fighting || s.throwKind || s.silent || s.e.maim.arms === 0) continue;
      if ((kind === 'frag' ? s.grenades : s.flashes) <= 0) continue;
      const d = s.e.position.distanceTo(this.threat);
      if (d < GRENADE_MIN || d > GRENADE_MAX || d + (s.task === 'hold' ? 0 : 4) >= bestD) continue;
      _p.copy(s.e.position);
      _p.y += 1.7;
      if (!o.w.director.clearLine(_p, _q)) continue;
      best = s;
      bestD = d;
    }
    return best;
  }

  private enterThrow(now: number, kind: Grenade): void {
    const { outpost: o } = this;
    this.mode = 'flush';
    this.coverFireUntil = now + COVER_FIRE_SECONDS;
    const s = this.thrower(kind);
    this.stage = s ? 1 : 0;
    if (!s) return;
    s.throwKind = kind;
    s.throwAt.copy(this.threat);
    this.grenadeReadyAt = now + GRENADE_COOLDOWN;
    this.stepUntil = now + THROW_PATIENCE;
    o.comms.say('flushing', s);
  }

  private stepThrow(now: number): StepResult {
    if (this.stage === 0) return FAILED;
    let waiting = false;
    for (const m of this.members) if (m.throwKind) waiting = true;
    if (waiting && now < this.stepUntil) return GOING;
    // The move it forces is the opening: the squad goes in behind it, not after it.
    this.opening(OPENING_SECONDS);
    return DONE;
  }

  // -------------------------------------------------------------------------------------------
  // Door breach
  // -------------------------------------------------------------------------------------------

  /** The nearest door with the threat behind it, written to `door`. */
  private findDoor(): boolean {
    const { outpost: o } = this;
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
    this.door = best;
    this.doorInto = into;
    return best !== null;
  }

  private enterBreach(now: number): void {
    const { outpost: o } = this;
    this.mode = 'stack';
    if (!this.door && !this.findDoor()) return;
    const door = this.door!;
    const into = this.doorInto;
    this.stepUntil = now + STACK_GATHER_SECONDS;
    let i = 0;
    for (const s of this.members) {
      if (!s.fighting) continue;
      const side = i % 2 === 0 ? 1 : -1;
      const rank = Math.floor(i / 2);
      // Either side of the frame, on the near side, so nobody stands in the doorway.
      const back = 1.4 + rank * 1.1;
      const across = door.w / 2 + 0.9;
      _anchor.set(door.x - door.dx * into * back - door.dz * side * across, s.e.position.y, door.z - door.dz * into * back + door.dx * side * across);
      if (o.w.ctx.world.nav.nearest(_anchor, 2.2, _anchor)) o.order(s, _anchor, null, 2, i * ORDER_STAGGER);
      i++;
    }
    if (this.leader) o.comms.say('breach', this.leader);
  }

  private stepBreach(now: number): StepResult {
    const { outpost: o } = this;
    const door = this.door;
    if (!door) return FAILED;
    if (this.stage < 2 && now - this.seenAt < 1) {
      this.stackReadyAt = now + STACK_COOLDOWN;
      return DONE;
    }
    if (this.stage === 0) {
      let ready = 0;
      for (const s of this.members) if (s.fighting && s.task === 'hold' && !s.hasOrder) ready++;
      if (ready < Math.min(3, this.fighters()) && now < this.stepUntil) return GOING;
      this.bang(door);
      this.stage = 1;
      this.stepUntil = now + STACK_FUSE_SECONDS;
    } else if (this.stage === 1 && now >= this.stepUntil) {
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
      this.stage = 2;
      this.stepUntil = now + STACK_ENTRY_SECONDS;
      this.opening(OPENING_SECONDS);
    } else if (this.stage === 2 && now >= this.stepUntil) {
      this.stackReadyAt = now + STACK_COOLDOWN;
      return DONE;
    }
    return GOING;
  }

  /** Something goes through the door first: a banger if anyone has one, a frag if not, and failing both the first man through. */
  private bang(door: Door): void {
    const s = this.leader?.fighting ? this.leader : this.pick(0);
    if (!s) return;
    const kind: Grenade | null = s.flashes > 0 ? 'flash' : s.grenades > 0 ? 'frag' : null;
    if (!kind) return;
    s.throwKind = kind;
    s.throwAt.set(door.x + door.dx * this.doorInto * 4, s.e.position.y + 0.3, door.z + door.dz * this.doorInto * 4);
  }

  /** Its rounds are going onto the threat right now, so that another squad can use them. */
  layingFire(now: number): boolean {
    return now < this.pinnedUntil && this.inContact;
  }

  /** Men are on their way round right now. */
  get flanking(): boolean {
    return this.drill === 'flank';
  }

  /** The door this squad is stacked on, if any. */
  get stackedOn(): Door | null {
    return this.drill === 'breach' ? this.door : null;
  }

  // -------------------------------------------------------------------------------------------
  // Rush
  // -------------------------------------------------------------------------------------------

  private enterRush(now: number): void {
    const { outpost: o } = this;
    this.mode = 'rush';
    this.stepUntil = now + RUSH_SECONDS;
    this.movingTeam = 1;
    for (const m of this.members) m.rushAt = 0;
    if (this.leader) o.comms.say('rushing', this.leader);
  }

  private stepRush(now: number): StepResult {
    const { outpost: o } = this;
    if (now >= this.stepUntil || !this.anyoneInTheOpen()) {
      this.openUntil = 0;
      return DONE;
    }
    const nav = o.w.ctx.world.nav;
    this.coverFireUntil = now + 1.5;
    let i = 0;
    for (const s of this.members) {
      if (!s.fighting || now < s.rushAt) continue;
      // The gun stays on its bipod and covers the rest in.
      if (s.def.base && s.canShoot) continue;
      s.rushAt = now + rand(RUSH_REAIM[0], RUSH_REAIM[1]);
      const close = s.role === 'shotgun' || s.role === 'shield';
      const stand = close ? RUSH_STAND_CLOSE : RUSH_STAND;
      if (s.e.position.distanceTo(this.threat) < stand + 1) continue;
      const a = Math.atan2(s.e.position.x - this.threat.x, s.e.position.z - this.threat.z) + rand(-0.6, 0.6);
      _anchor.set(this.threat.x + Math.sin(a) * stand, s.e.position.y, this.threat.z + Math.cos(a) * stand);
      if (nav.nearest(_anchor, 5, _anchor)) o.order(s, _anchor, null, 2, i++ * 0.15);
    }
    return GOING;
  }

  /** A rush is over once there is nobody left who has to get closer. */
  private anyoneInTheOpen(): boolean {
    const now = this.outpost.w.now;
    if (now - this.drillAt < 1) return true;
    for (const s of this.members) {
      if (s.fighting && (s.task === 'move' || s.hasOrder || s.e.dist > RUSH_STAND + 3)) return true;
    }
    return false;
  }

  // -------------------------------------------------------------------------------------------
  // Ambush
  // -------------------------------------------------------------------------------------------

  /** The door nearest `near` that has the threat beyond it. */
  private ambushDoor(near: THREE.Vector3): Door | null {
    let best: Door | null = null;
    let bestD = STACK_REACH + 6;
    for (const d of this.outpost.doors) {
      const reach = Math.hypot(near.x - d.x, near.z - d.z);
      if (reach >= bestD) continue;
      const ours = (near.x - d.x) * d.dx + (near.z - d.z) * d.dz;
      const theirs = (this.threat.x - d.x) * d.dx + (this.threat.z - d.z) * d.dz;
      if (ours * theirs >= 0) continue;
      bestD = reach;
      best = d;
    }
    return best;
  }

  private enterSetAmbush(now: number): void {
    const { outpost: o } = this;
    this.mode = 'ambush';
    this.centroid(_c);
    const door = this.ambushDoor(_c);
    this.stepUntil = now + STEP_TIMEOUT;
    // On a mark with no door, the men cover the way the threat will come.
    if (door) this.watch.set(door.x, _c.y + 1, door.z);
    else if (this.lying && o.routes.find(_c, this.threat, this.axis)) {
      this.axis.pointAt(AMBUSH_FAR * 0.7, this.watch);
      this.watch.y += 1;
    } else this.watch.copy(this.threat);
    let i = 0;
    for (const s of this.members) {
      if (!s.fighting) continue;
      s.silent = true;
      // A mission picked the ground, so the men stay on it. Anyone else chooses where to stand.
      _anchor.copy(this.lying ? s.e.position : this.watch);
      const spot = this.seek(s, this.lying ? LYING_RADIUS : AMBUSH_FAR, AMBUSH_NEAR, AMBUSH_FAR, NaN, true, this.watch);
      if (spot && spot !== s.spot && this.withinReach(s, spot.position)) this.send(s, spot, 2, i++ * ORDER_STAGGER);
    }
    if (this.leader) {
      // The last thing anyone says. It goes out before the men fall silent, on purpose: it is the player's one warning.
      this.leader.silent = false;
      o.comms.say('ambushSet', this.leader);
      this.leader.silent = true;
    }
  }

  private stepSetAmbush(now: number): StepResult {
    if (this.inContact && !this.lying) {
      this.spring();
      return FAILED;
    }
    if (this.teamBusy() && now < this.stepUntil) return GOING;
    this.waiting = true;
    this.sightedSince = 0;
    this.firedOn = false;
    return DONE;
  }

  private stepLieInWait(now: number): StepResult {
    const { outpost: o } = this;
    if (now >= this.ambushUntil) {
      this.quietOff();
      this.ambushReadyAt = now + AMBUSH_REST;
      this.goal = 'destroy';
      return DONE;
    }
    let closest = Infinity;
    for (const m of this.members) if (m.fighting && m.sees && m.e.dist < closest) closest = m.e.dist;
    if (closest < Infinity && this.sightedSince === 0) this.sightedSince = now;
    if (closest === Infinity) this.sightedSince = 0;
    const stared = !this.patient && this.sightedSince > 0 && now - this.sightedSince >= AMBUSH_STARE;
    if (this.firedOn || closest < (this.patient ? AMBUSH_ARM_LENGTH : AMBUSH_RANGE) || stared) {
      this.spring();
      this.ambushReadyAt = now + AMBUSH_REST;
      this.goal = 'destroy';
      this.lying = false;
      this.planLength = 0;
      o.radio(o.w.player.chest, true);
      return DONE;
    }
    return GOING;
  }

  /** Everyone at once. This is the moment the silence was for. */
  private spring(): void {
    const { outpost: o } = this;
    const now = o.w.now;
    this.waiting = false;
    this.coverFireUntil = now + COVER_FIRE_SECONDS;
    this.opening(OPENING_SECONDS);
    for (const s of this.members) {
      s.silent = false;
      if (!s.fighting) continue;
      s.alertUntil = now + 6;
      s.notice = 1;
      s.stage = 'peek';
      s.exposed = true;
      s.peekUntil = now + rand(3.5, 5);
    }
    if (this.leader) o.comms.say('spring', this.leader);
  }

  // -------------------------------------------------------------------------------------------
  // Falling back
  // -------------------------------------------------------------------------------------------

  private enterRetreat(): void {
    const { outpost: o } = this;
    this.mode = 'fallback';
    this.bounds = 0;
    this.stepUntil = 0;
    this.door = null;
    this.centroid(_c);
    o.betterGround(_c, this.threat, this.rally);
    if (this.leader) o.comms.say('fallback', this.leader);
  }

  private stepRetreat(now: number): StepResult {
    const { outpost: o } = this;
    if (now < this.stepUntil && this.teamBusy()) return GOING;
    this.centroid(_c);
    const clear = Math.hypot(_c.x - this.threat.x, _c.z - this.threat.z) > CLEAR_OF_THREAT;
    if (this.bounds >= FALLBACK_BOUNDS || clear || !o.routes.find(_c, this.rally, this.axis, o.intel) || this.axis.length < 6) {
      this.safe = true;
      return DONE;
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
    return GOING;
  }

  private enterRegroup(now: number): void {
    const { outpost: o } = this;
    this.mode = 'regroup';
    this.stepUntil = now + REGROUP_SECONDS;
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

  private stepRegroup(now: number): StepResult {
    let scattered = 0;
    for (const s of this.members) {
      if (s.fighting && s.e.position.distanceToSquared(this.rally) > REGROUP_RADIUS * REGROUP_RADIUS) scattered++;
    }
    if (scattered > 0 && now < this.stepUntil) return GOING;
    for (const s of this.members) s.morale += REGROUP_NERVE;
    this.fallbackReadyAt = now + FALLBACK_REST;
    this.formed = true;
    this.sector = NaN;
    return DONE;
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
