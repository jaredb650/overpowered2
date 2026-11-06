/**
 * The Outpost: humans in squads, who see, hear, take cover, work as teams and lose their nerve. This is the faction's one
 * controller. EnemyManager calls it at a handful of points when `ACTIVE.def.ai` is 'outpost', and never otherwise, so the
 * swarm game runs none of it.
 *
 *   doctrine.ts   numbers, squad types, the levers The Commander will pull
 *   morale.ts     fear and Dread, as arithmetic
 *   perception.ts sight, hearing, the shared picture of the player
 *   cover.ts      cover spots derived from the map with physics rays
 *   routes.ts     A* to anywhere, avoiding ground the threat can see
 *   squad.ts      the squad's brain: who goes where
 *   behaviours.ts what a man does with his legs
 *   weapons.ts    what he does with his hands
 *   waves.ts      how they arrive
 *   comms.ts      what they say
 *   events.ts     what the rest of the game can listen to
 */
import * as THREE from 'three';
import type { DamageInfo } from '../../core/contracts';
import type { DamageResult, EnemyId, EnemyInstance, KillEvent } from '../../core/gameplay';
import { chance, rand, TAU } from '../../core/math';
import { Pool } from '../../core/pool';
import { ACTIVE } from '../../contracts/select';
import type { AiWorld } from '../aiWorld';
import { finishAttack } from '../brain';
import type { Enemy } from '../Enemy';
import type { EnemyManager } from '../EnemyManager';
import { SOLDIER_BEHAVIOURS } from './behaviours';
import { Comms } from './comms';
import { CoverMap, type CoverSpot, type SpotReading } from './cover';
import { CALLSIGNS, defaultDoctrine, fireRules, ROLE_OF, ROLES, type Doctrine } from './doctrine';
import { DroppedWeapons } from './dropped';
import './events';
import { Dread, DREAD_SPIKES, FEAR, moraleCeiling, moraleState, MONSTER_RANGE, RECOVER_AFTER, recoverRate, WITNESS_RANGE } from './morale';
import { hear, Intel, sense, SENSE_INTERVAL } from './perception';
import { RouteFinder, type NavGrid } from './routes';
import { discharge, enlist, Soldier, soldierOf, type Urgency } from './soldier';
import { OutpostSquad, type Door } from './squad';
import { soldierAttacks } from './weapons';
import { OutpostWaves, replaceWaves } from './waves';

export { soldierOf } from './soldier';

/** True when this page runs the Outpost's rules. */
export const outpostActive = (): boolean => ACTIVE.def.ai === 'outpost';

/** Routes worked out per frame. An order waits its turn, which is invisible at this scale. */
const ROUTES_PER_FRAME = 3;
const MORALE_TICK = 0.25;
const AID_TICK = 0.5;
const CROSSFIRE_TICK = 2;
const NOISE_TICK = 0.35;
/** Seconds for a sighting to go round the other squads. */
const RADIO_DELAY = 1.2;
/** How far a rescuer will go. */
const AID_REACH = 28;
/** Nobody walks up to a casualty with the monster standing over him. */
const AID_DANGER = 5;
/** Prisoners kept kneeling at once. Past that the longest held is let go. */
const MAX_PRISONERS = 8;
/** Inside this he has no time to run. */
const SURRENDER_RANGE = 8;
const REACHED_GATE = 2.2;
const FLASH_RANGE = 11;
const FLASH_SECONDS = 1.4;
/** Metres a shot is heard, a sword swing, a landing per metre fallen, and footfalls per metre per second. */
const SHOT_NOISE = 42;
const BLADE_NOISE = 7;
const LANDING_NOISE = 3;
const STEP_NOISE = 0.75;
const QUIET_SPEED = 5;
const GATE_MIN_PATH = 24;
const GATE_REST = 14;
/** Cosine of the half angle behind a man that counts as in the back: 60 degrees. */
const BACK_ARC = 0.5;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _heard = new THREE.Vector3();
const _reading: SpotReading = { hidden: false, canShoot: false, side: 0 };

interface PostureHost {
  disarm?(): void;
}

interface Planned {
  spec?: { plan?: { doors: readonly Door[] } | null };
}

interface Bang {
  at: number;
  position: THREE.Vector3;
  live: boolean;
}

export class Outpost {
  readonly cover: CoverMap;
  readonly routes = new RouteFinder();
  readonly intel: Intel;
  readonly comms: Comms;
  readonly dread = new Dread();
  /** The Commander's lever. Changes take effect on the next decision that reads them. */
  doctrine: Doctrine = defaultDoctrine();
  doors: readonly Door[] = [];
  readonly squads: OutpostSquad[] = [];
  readonly soldiers: Soldier[] = [];
  readonly waves: OutpostWaves;
  /** Men kneeling. They stay in `alive`, because they can still be shot, but they no longer count. */
  prisoners = 0;

  private readonly dropped: DroppedWeapons;
  private readonly pool = new Pool<Soldier>(() => new Soldier(), s => s.clear());
  private readonly leaving: Soldier[] = [];
  private gates: THREE.Vector3[] = [];
  private readonly gateUsedAt = new Map<THREE.Vector3, number>();
  private forming: OutpostSquad | null = null;
  private gate: THREE.Vector3 | null = null;
  private squadSerial = 0;
  private mapReady = false;
  private routesLeft = 0;
  private moraleAt = 0;
  private aidAt = 0;
  private crossfireAt = 0;
  private noiseAt = 0;
  private nextFixAt = 0;
  private radioAt = -1;
  private radioSeen = false;
  private readonly radioPosition = new THREE.Vector3();
  private readonly bangs: Bang[] = [
    { at: 0, position: new THREE.Vector3(), live: false }, { at: 0, position: new THREE.Vector3(), live: false }, { at: 0, position: new THREE.Vector3(), live: false },
  ];

  constructor(readonly w: AiWorld, private readonly manager: EnemyManager) {
    this.cover = new CoverMap(w.ctx.physics);
    this.intel = new Intel(w.ctx.physics);
    this.comms = new Comms(w);
    this.dropped = new DroppedWeapons(w.ctx);
    this.waves = new OutpostWaves(w.ctx, this, manager);
  }

  init(): void {
    const { ctx } = this.w;
    replaceWaves(ctx.waves, this.waves);
    const { events } = ctx;
    events.on('enemy:killed', k => this.onKilled(k));
    events.on('enemy:hit', h => this.onHit(h.enemy, h.damage, h.result));
    events.on('enemy:severed', s => this.onSevered(s.enemy));
    events.on('perk:start', p => this.spike(p.id));
    events.on('callin:used', c => this.spike(c.id));
    events.on('weapon:fired', f => this.onFired(f.weapon, f.origin));
    events.on('player:landed', l => this.noise(this.w.player.position, l.impact * LANDING_NOISE));
    events.on('player:slam', s => this.noise(s.position, s.radius * 4));
  }

  /** The map does not exist until after every system's init, so all of this waits for the first run. */
  private prepareMap(): void {
    if (this.mapReady) return;
    const { world } = this.w.ctx;
    const nav = world.nav as unknown as NavGrid;
    if (!nav?.nodeCount) return;
    this.mapReady = true;
    this.routes.build(nav);
    this.cover.build(nav);
    this.doors = (world as unknown as Planned).spec?.plan?.doors ?? [];
    const points = world.spawnPoints;
    const gates = points.filter(p => p.kind === 'gate');
    this.gates = (gates.length > 0 ? gates : points.filter(p => p.kind === 'ground')).map(p => p.position);
  }

  reset(): void {
    this.prepareMap();
    for (const s of this.soldiers) {
      discharge(s.e);
      this.pool.release(s);
    }
    this.soldiers.length = 0;
    this.flushLeaving();
    this.squads.length = 0;
    this.forming = this.gate = null;
    this.squadSerial = this.prisoners = 0;
    this.cover.release();
    this.intel.reset();
    this.comms.reset();
    this.dread.reset();
    this.dropped.clear();
    this.gateUsedAt.clear();
    this.nextFixAt = 0;
    this.radioAt = -1;
    this.doctrine = defaultDoctrine();
    for (const b of this.bangs) b.live = false;
  }

  /** After the director has set its swarm numbers. */
  setWave(wave: number): void {
    const { limit, gap } = fireRules(wave);
    this.w.director.setFireRules(limit, gap);
  }

  /** Enemies still in the fight. */
  get hostile(): number {
    return this.manager.alive.length - this.prisoners;
  }

  // -------------------------------------------------------------------------------------------
  // Arrivals
  // -------------------------------------------------------------------------------------------

  onWaveStart(): void {
    this.fix(true);
  }

  /** Opens a new squad at a gate of its own, out of the player's sight and a walk away. */
  formSquad(size: number): void {
    const name = CALLSIGNS[this.squadSerial % CALLSIGNS.length]!;
    const squad = new OutpostSquad(++this.squadSerial, name, this);
    squad.size = size;
    squad.thinkAt = this.w.now + 1.5;
    this.squads.push(squad);
    this.forming = squad;
    this.gate = this.pickGate();
    this.gateUsedAt.set(this.gate, this.w.now);
    squad.adopt(this.intel.position, this.intel.at);
  }

  private pickGate(): THREE.Vector3 {
    const { w } = this;
    const nav = w.ctx.world.nav;
    let best = this.gates[0]!;
    let bestScore = -Infinity;
    for (const g of this.gates) {
      const path = nav.pathDistance(g);
      const rested = w.now - (this.gateUsedAt.get(g) ?? -99) > GATE_REST;
      _a.copy(g);
      _a.y += 1.6;
      const seen = w.director.clearLine(_a, w.player.eye);
      const score = (path >= GATE_MIN_PATH ? 40 : 0) + (rested ? 25 : 0) + (seen ? -60 : 0) + Math.random() * 30 - Math.max(0, path - 60) * 0.3;
      if (score > bestScore) {
        bestScore = score;
        best = g;
      }
    }
    return best;
  }

  /** One man through the gate. */
  sendIn(id: EnemyId): void {
    if (this.gate) this.manager.spawn(id, this.gate);
  }

  /** Called by EnemyManager for every spawn. Anything without a soldier's role keeps the AI it came with. */
  onSpawn(e: Enemy): void {
    const role = ROLE_OF[e.id];
    if (!role) return;
    const s = this.pool.get();
    const def = ROLES[role];
    s.e = e;
    s.role = role;
    s.def = def;
    s.morale = s.baseMorale = def.morale;
    s.mag = def.mag;
    s.grenades = this.doctrine.grenades;
    s.senseAt = this.w.now + rand(0, SENSE_INTERVAL);
    s.known.copy(e.position);
    s.aim.copy(e.position);
    enlist(e, s);
    this.soldiers.push(s);
    let squad = this.forming;
    if (!squad) {
      // Spawned from outside a wave, by a test or the lab.
      this.formSquad(1);
      squad = this.forming!;
      this.forming = null;
    }
    squad.join(s);
    e.squad = squad;
    e.behaviours = SOLDIER_BEHAVIOURS;
    e.attacks = soldierAttacks(e.id);
    e.barkAt = Infinity;
    // Routes are checked against the graph when they are made, so soldiers never need the swarm's wall probe.
    e.probeAt = Infinity;
    e.yaw = Math.atan2(-e.position.x, -e.position.z);
  }

  // -------------------------------------------------------------------------------------------
  // Frame
  // -------------------------------------------------------------------------------------------

  update(dt: number): void {
    const { w } = this;
    const now = w.now;
    this.flushLeaving();
    this.dread.update(dt);
    this.routesLeft = ROUTES_PER_FRAME;
    for (let i = 0; i < this.soldiers.length; i++) {
      const s = this.soldiers[i]!;
      // Movement falls back on the flow field when a point move stalls. That leads to the player, and a man falling back
      // must not be walked into him, so soldiers handle their own stalls.
      s.e.flowUntil = 0;
      if (s.fighting && now >= s.senseAt) {
        s.senseAt = now + SENSE_INTERVAL;
        sense(s, w, SENSE_INTERVAL);
      }
      if (s.hasOrder && now >= s.orderAt && this.routesLeft > 0) this.depart(s);
    }
    this.updateRadio(now);
    if (this.intel.at >= 0) {
      this.intel.refreshFan(now);
      if (this.soldiers.length > 0 && now - this.intel.at > this.doctrine.fixAfter) this.fix(false);
    }
    for (let i = 0; i < this.squads.length; i++) {
      const q = this.squads[i]!;
      if (now >= q.thinkAt) q.think();
    }
    if (now >= this.moraleAt) this.tickMorale(now);
    if (now >= this.aidAt) this.assignAid(now);
    if (now >= this.crossfireAt) this.spreadSectors(now);
    if (now >= this.noiseAt) this.listenToFeet(now);
    this.updateBangs(now);
    this.dropped.update(dt);
  }

  /** Soldiers leave the roster a frame late, because `enemy:killed` still reads them after the body has gone. */
  private flushLeaving(): void {
    for (const s of this.leaving) {
      discharge(s.e);
      this.pool.release(s);
    }
    this.leaving.length = 0;
    for (let i = this.squads.length - 1; i >= 0; i--) if (this.squads[i]!.members.length === 0 && this.squads[i] !== this.forming) this.squads.splice(i, 1);
  }

  /** Called by EnemyManager when a body leaves `alive`, for any reason. */
  onDetach(e: Enemy): void {
    const s = soldierOf(e);
    if (!s) return;
    const i = this.soldiers.indexOf(s);
    if (i < 0) return;
    this.soldiers.splice(i, 1);
    if (s.surrendered) this.prisoners--;
    if (s.spot) s.spot.claimedBy = 0;
    if (s.patient) s.patient.rescuer = null;
    if (s.rescuer) s.rescuer.patient = null;
    s.wasLeader = s.squad.leader === s;
    s.squad.leave(s);
    this.leaving.push(s);
  }

  // -------------------------------------------------------------------------------------------
  // Orders
  // -------------------------------------------------------------------------------------------

  order(s: Soldier, dest: THREE.Vector3, spot: CoverSpot | null, urgency: Urgency, delay: number): void {
    if (s.spot && s.spot !== spot) s.spot.claimedBy = 0;
    s.spot = spot;
    if (spot) spot.claimedBy = s.e.uid;
    s.dest.copy(dest);
    s.urgency = urgency;
    s.hasOrder = true;
    s.orderAt = this.w.now + delay;
    s.canShoot = false;
  }

  /** Where he stands to shoot from this spot. */
  fireFrom(s: Soldier, spot: CoverSpot | null, reading: SpotReading): void {
    s.canShoot = reading.canShoot;
    s.fireSide = reading.side;
    if (!spot) return;
    const lean = reading.side < 0 ? spot.leanLeft : reading.side > 0 ? spot.leanRight : null;
    s.firePoint.copy(lean ?? spot.position);
  }

  private depart(s: Soldier): void {
    this.routesLeft--;
    s.hasOrder = false;
    if (this.walkTo(s, s.dest, this.intel)) s.task = 'move';
  }

  private walkTo(s: Soldier, to: THREE.Vector3, avoid: Intel | null): boolean {
    if (!this.routes.find(s.e.position, to, s.route, avoid)) return false;
    s.route.next = Math.min(1, s.route.count - 1);
    s.progressAt = this.w.now + 1.3;
    s.progressFrom.copy(s.e.position);
    s.stalls = 0;
    return true;
  }

  /** Stuck on something. Same destination, fresh route from where he actually is. */
  reroute(s: Soldier): void {
    this.walkTo(s, s.dest, null);
  }

  routeTo(s: Soldier, to: THREE.Vector3): boolean {
    s.dest.copy(to);
    return this.walkTo(s, to, null);
  }

  /** Nearest way off the map that does not lead past the player. */
  routeToGate(s: Soldier): boolean {
    const e = s.e;
    const p = this.w.player.position;
    let best: THREE.Vector3 | null = null;
    let bestScore = Infinity;
    for (const g of this.gates) {
      const mine = e.position.distanceTo(g);
      const theirs = p.distanceTo(g);
      const score = mine + (theirs < mine ? (mine - theirs) * 2.5 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = g;
      }
    }
    return best !== null && this.routeTo(s, best);
  }

  /** The nearest hidden spot, if the casualty needs moving at all. */
  routeToShelter(s: Soldier, patient: Soldier, reach: number): boolean {
    const p = patient.e.position;
    if (this.intel.at < 0 || !this.intel.exposed(p.x, p.z)) return false;
    let best: CoverSpot | null = null;
    let bestD = reach * reach;
    for (const spot of this.cover.spots) {
      const d = spot.position.distanceToSquared(p);
      if (d >= bestD || spot.claimedBy !== 0 || Math.abs(spot.position.y - p.y) > 1) continue;
      if (this.intel.exposed(spot.position.x, spot.position.z)) continue;
      best = spot;
      bestD = d;
    }
    return best !== null && this.routeTo(s, best.position);
  }

  /** Writes the way out for a squad falling back: a gate on its side of the threat, as far from the threat as it can get. */
  fallbackPoint(from: THREE.Vector3, threat: THREE.Vector3, out: THREE.Vector3): void {
    let bestScore = -Infinity;
    for (const g of this.gates) {
      const score = g.distanceTo(threat) - g.distanceTo(from) * 0.8;
      if (score > bestScore) {
        bestScore = score;
        out.copy(g);
      }
    }
  }

  // -------------------------------------------------------------------------------------------
  // Knowledge
  // -------------------------------------------------------------------------------------------

  radio(at: THREE.Vector3, seen: boolean): void {
    // One report in flight at a time. A sighting replaces a noise on its way out, and nothing replaces a sighting.
    if (this.radioAt >= 0 && (this.radioSeen || !seen)) return;
    this.radioPosition.copy(at);
    this.radioSeen = seen;
    if (this.radioAt < 0) this.radioAt = this.w.now + RADIO_DELAY;
  }

  private updateRadio(now: number): void {
    if (this.radioAt < 0 || now < this.radioAt) return;
    this.intel.report(this.radioPosition, now, this.radioSeen);
    for (const q of this.squads) q.adopt(this.radioPosition, now);
    this.radioAt = -1;
  }

  /** Command's thermal pass: a rough position, so that nobody can win by hiding. */
  private fix(opening: boolean): void {
    const { w, doctrine } = this;
    const now = w.now;
    if (now < this.nextFixAt) return;
    this.nextFixAt = now + doctrine.fixAfter * 0.5;
    const a = rand(0, TAU);
    const r = rand(0.3, 1) * doctrine.fixError;
    _a.set(w.player.position.x + Math.sin(a) * r, w.player.position.y, w.player.position.z + Math.cos(a) * r);
    if (!w.ctx.world.nav.nearest(_a, 12, _a)) _a.copy(w.player.position);
    _a.y += 1;
    this.intel.report(_a, now, false);
    for (const q of this.squads) q.adopt(_a, now);
    if (!opening) this.comms.say('fix', null);
  }

  /** A squad got where it was going and found nobody. */
  lostTheTrail(): void {
    if (this.w.now - this.intel.at > 3) this.fix(false);
  }

  noise(at: THREE.Vector3, radius: number): void {
    const r2 = radius * radius;
    for (const s of this.soldiers) {
      if (!s.fighting) continue;
      const d2 = s.e.position.distanceToSquared(at);
      if (d2 < r2) hear(s, this.w, at, Math.sqrt(d2), _heard);
    }
  }

  private onFired(weapon: string, origin: THREE.Vector3): void {
    if (this.w.now < this.noiseAt - NOISE_TICK * 0.5) return;
    this.noise(origin, weapon === 'sword' ? BLADE_NOISE : SHOT_NOISE);
  }

  private listenToFeet(now: number): void {
    this.noiseAt = now + NOISE_TICK;
    const p = this.w.player;
    if (p.grounded && p.speed > QUIET_SPEED) this.noise(p.position, p.speed * STEP_NOISE);
  }

  /** Gives squads in the same fight different sides of the threat, so their fire crosses. */
  private spreadSectors(now: number): void {
    this.crossfireAt = now + CROSSFIRE_TICK;
    let engaged = 0;
    for (const q of this.squads) if (q.mode === 'engage') engaged++;
    if (engaged < 2) return;
    let first: OutpostSquad | null = null;
    let i = 0;
    for (const q of this.squads) {
      if (q.mode !== 'engage') continue;
      if (!first) first = q;
      else q.shiftSector(first.sector + (i * TAU) / engaged);
      i++;
    }
  }

  // -------------------------------------------------------------------------------------------
  // Fear
  // -------------------------------------------------------------------------------------------

  scare(s: Soldier, amount: number): void {
    s.morale -= amount;
    s.scaredAt = this.w.now;
  }

  private spike(cause: string): void {
    const amount = DREAD_SPIKES[cause];
    if (!amount) return;
    this.dread.add(amount);
    this.w.ctx.events.emit('dread:spike', { dread: this.dread.value, cause });
    for (const s of this.soldiers) if (s.fighting) this.scare(s, amount * FEAR.spike);
    const first = this.soldiers[0];
    if (first) this.comms.say('fear', first);
  }

  private tickMorale(now: number): void {
    this.moraleAt = now + MORALE_TICK;
    const dread = this.dread.value;
    for (let i = 0; i < this.soldiers.length; i++) {
      const s = this.soldiers[i]!;
      if (!s.fighting) continue;
      const e = s.e;
      if (e.pressure > 0.25) s.morale -= FEAR.underFire * e.pressure * MORALE_TICK;
      if (e.dist < MONSTER_RANGE && e.hasLos) this.scare(s, FEAR.monsterClose * MORALE_TICK * (1 + dread / 50));
      if (now - s.scaredAt > RECOVER_AFTER) {
        const lead = s.squad.leader;
        const near = lead !== null && lead !== s && lead.e.position.distanceToSquared(e.position) < 225;
        const ceiling = moraleCeiling(s.baseMorale, dread);
        if (s.morale < ceiling) s.morale = Math.min(ceiling, s.morale + recoverRate(near) * MORALE_TICK);
      }
      const was = s.state;
      s.state = moraleState(s.morale, dread);
      if (s.state === was) continue;
      if (s.state === 'broken') this.collapse(s);
      else if (s.state === 'panicked') this.comms.say('panic', s);
      else if (s.state === 'shaken' && was === 'steady') this.comms.say('fear', s);
    }
  }

  /** The end of a man's nerve: the gun goes down and he runs, or he gives up. */
  private collapse(s: Soldier): void {
    if (!s.fighting) return;
    const { w, doctrine } = this;
    const e = s.e;
    if (e.attack) finishAttack(e, w, true);
    s.squad.leave(s);
    if (s.spot) s.spot.claimedBy = 0;
    s.spot = null;
    s.hasOrder = false;
    s.exposed = false;
    s.task = 'hold';
    s.stage = 'peek';
    s.throwKind = null;
    if (s.patient) s.patient.rescuer = null;
    s.patient = null;
    this.dropped.drop(e);
    (e.char.anim as unknown as PostureHost).disarm?.();
    e.attacks = [];
    e.shield = false;
    const cornered = e.dist < SURRENDER_RANGE;
    s.fate = doctrine.surrender && (cornered || chance(doctrine.surrenderChance)) ? 'surrender' : 'flee';
    // Force the change now: a man mid-burst should not finish his think tick first.
    e.thinkAt = 0;
    e.behaviourUntil = 0;
    w.ctx.events.emit('enemy:broken', { enemy: e, fate: s.fate });
  }

  onSurrender(s: Soldier): void {
    if (s.surrendered) return;
    s.surrendered = true;
    s.surrenderedAt = this.w.now;
    this.prisoners++;
    this.w.ctx.events.emit('enemy:surrendered', { enemy: s.e });
    if (this.prisoners > MAX_PRISONERS) this.releaseOldest();
  }

  /** Gets up and walks to a gate, hands still in the air. Still shootable, still a prisoner. */
  release(s: Soldier): void {
    s.released = true;
    s.fate = 'flee';
    s.e.thinkAt = 0;
  }

  private releaseOldest(): void {
    let oldest: Soldier | null = null;
    for (const s of this.soldiers) {
      if (s.surrendered && !s.released && (!oldest || s.surrenderedAt < oldest.surrenderedAt)) oldest = s;
    }
    if (oldest) this.release(oldest);
  }

  /** He got out. No kill, no score. */
  escape(s: Soldier): void {
    const e = s.e;
    if (!e.alive || e.position.distanceTo(s.dest) > REACHED_GATE) return;
    this.w.ctx.events.emit('enemy:escaped', { enemy: e });
    this.manager.withdraw(e);
  }

  squadShattered(squad: OutpostSquad, kill: KillEvent): void {
    this.dread.add(kill.gibbed ? 10 : 7);
    this.w.ctx.events.emit('squad:broken', { squad: squad.name, survivors: squad.members.length });
    this.w.ctx.events.emit('dread:spike', { dread: this.dread.value, cause: 'squad' });
    if (squad.members[0]) this.comms.say('squadGone', squad.members[0]);
  }

  private onKilled(k: KillEvent): void {
    const s = soldierOf(k.enemy);
    if (!s) return;
    const { dread, w } = this;
    const severed = k.severedCount;
    dread.onKill({ gibbed: k.gibbed, sliced: k.sliced, headshot: k.headshot, severed }, w.now);
    const brutal = k.gibbed || k.sliced || k.headshot || severed > 0;
    const fear = s.surrendered ? FEAR.execution : FEAR.allyDown + (brutal ? FEAR.brutal : 0);
    const r2 = WITNESS_RANGE * WITNESS_RANGE;
    for (const o of this.soldiers) {
      if (o.fighting && (o.squad === s.squad || o.e.position.distanceToSquared(k.enemy.position) < r2)) this.scare(o, fear);
    }
    if (s.surrendered) w.ctx.events.emit('enemy:executed', { kill: k });
    else s.squad.onLoss(s, k, s.wasLeader);
    this.adoptOrphans(s.squad);
  }

  /** A last man joins whoever is left, rather than carrying on a squad of one. */
  private adoptOrphans(squad: OutpostSquad): void {
    if (squad.members.length !== 1) return;
    const last = squad.members[0]!;
    if (!last.fighting) return;
    for (const q of this.squads) {
      if (q === squad || !q.absorb(last)) continue;
      squad.leave(last);
      last.e.squad = q;
      return;
    }
  }

  private onHit(enemy: EnemyInstance, d: DamageInfo, res: DamageResult): void {
    const s = soldierOf(enemy);
    if (!s || res.killed) return;
    const { w } = this;
    const e = s.e;
    s.alertUntil = w.now + 6;
    if (res.dealt > 0 && !res.blocked) this.scare(s, (res.dealt / e.maxHealth) * FEAR.wound);
    if (s.fighting && !s.sees && d.source in ROLE_OF === false) {
      // Rounds have a direction. He knows roughly where that came from even if he never saw it.
      _a.copy(d.point).addScaledVector(d.dir, -Math.min(e.dist, 30));
      s.squad.report(s, _a, false);
    }
    if (Math.sin(e.yaw) * d.dir.x + Math.cos(e.yaw) * d.dir.z > BACK_ARC) {
      w.ctx.events.emit('enemy:backshot', { enemy, damage: d, result: res, fleeing: s.fate === 'flee' });
    }
  }

  private onSevered(enemy: EnemyInstance): void {
    const s = soldierOf(enemy);
    if (!s || !s.fighting) return;
    this.scare(s, FEAR.limbLost);
    // No gun arm and nothing in the other hand: there is nothing left for him to fight with.
    if (!s.e.maim.gunArm && !s.e.def.sidearm) {
      s.morale = Math.min(s.morale, 0);
      s.scaredAt = this.w.now;
    }
  }

  // -------------------------------------------------------------------------------------------
  // Casualties
  // -------------------------------------------------------------------------------------------

  /**
   * The hook for the wound conditions: a man is on the floor, or back on his feet. The wounds work owns when that happens,
   * how long he lasts and what he does down there. This owns who comes for him: `Outpost.assignAid` sends the nearest
   * medic or squadmate, who drags him out of the open if he has to, and revives him.
   */
  setDowned(e: EnemyInstance, down: boolean): void {
    const s = soldierOf(e);
    if (!s || s.downed === down) return;
    s.downed = down;
    const body = s.e;
    if (down) {
      if (body.attack) finishAttack(body, this.w, true);
      s.exposed = false;
      s.task = 'hold';
      s.hasOrder = false;
      if (s.spot) s.spot.claimedBy = 0;
      s.spot = null;
      if (s.squad.leader === s) s.squad.leave(s);
      this.comms.say('medic', s);
    } else {
      s.rescuer = null;
      if (s.squad.members.indexOf(s) < 0) s.squad.join(s);
    }
    body.thinkAt = 0;
    body.behaviourUntil = 0;
  }

  private assignAid(now: number): void {
    this.aidAt = now + AID_TICK;
    const p = this.w.player.position;
    for (const hurt of this.soldiers) {
      if (!hurt.downed || hurt.rescuer) continue;
      if (hurt.e.position.distanceToSquared(p) < AID_DANGER * AID_DANGER) continue;
      let best: Soldier | null = null;
      let bestD = AID_REACH * AID_REACH;
      for (const s of this.soldiers) {
        if (!s.fighting || s.patient || s.state === 'panicked' || s.e.maim.legs < 2) continue;
        // A medic comes from further away than anybody else.
        const d = s.e.position.distanceToSquared(hurt.e.position) * (s.role === 'medic' ? 0.25 : 1);
        if (d < bestD) {
          bestD = d;
          best = s;
        }
      }
      if (best) {
        best.patient = hurt;
        hurt.rescuer = best;
      }
    }
  }

  // -------------------------------------------------------------------------------------------
  // Flashbangs
  // -------------------------------------------------------------------------------------------

  flashbang(at: THREE.Vector3, fuse: number): void {
    const b = this.bangs.find(x => !x.live);
    if (!b) return;
    b.live = true;
    b.at = this.w.now + fuse;
    b.position.copy(at);
  }

  private updateBangs(now: number): void {
    const { ctx, player, director } = this.w;
    for (const b of this.bangs) {
      if (!b.live || now < b.at) continue;
      b.live = false;
      ctx.audio.play('grenade_explode', { position: b.position, pitch: 1.6, volume: 0.8 });
      ctx.render.lights.flash(b.position, 0xffffff, 18, 12, 0.25);
      _b.copy(b.position);
      _b.y += 0.6;
      const d = player.eye.distanceTo(_b);
      if (d > FLASH_RANGE || !director.clearLine(_b, player.eye)) continue;
      // Looking at it costs more than having your back turned. It blinds; it never hurts.
      _a.subVectors(_b, player.eye).normalize();
      const facing = 0.45 + 0.55 * Math.max(0, _a.dot(player.forward));
      ctx.render.post.flash(0xffffff, (1 - d / FLASH_RANGE) * facing * 2.2, FLASH_SECONDS);
    }
  }
}

