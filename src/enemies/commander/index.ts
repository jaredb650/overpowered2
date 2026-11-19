/**
 * The Commander: section 16's enemy mind. An unseen officer who watches how the player fights and answers it, one new answer a wave,
 * and whose answers stay for the rest of the run. Rule-based on purpose. It works because it tells the player what it noticed and
 * then does something real about it.
 *
 *   adaptations.ts  every answer and trick, with its tell and counterplay, and the arc of a run
 *   tracker.ts      what the player did, as counts
 *   director.ts     what comes next, and who turns up for it
 *   units.ts        men with a job and a post, not a squad leader
 *   posts.ts        where they stand
 *   mortars.ts      fire missions
 *   devices.ts      mines, wires, charges, beacons, tubes
 *   traps.ts        what gets laid where, between waves
 *   jam.ts          what the sonar and the minimap may say
 *   smoke.ts, barricades.ts, props.ts, behaviours.ts   the rest of the kit
 *   person.ts       the end of a run
 *   orders.ts       on the radio mid-fight, directing men who visibly do as they are told
 *   lines.ts        every word, with its id, speaker and emotion
 *
 * The Outpost owns this and calls it at a handful of points. Off the contract none of it exists.
 */
import * as THREE from 'three';
import type { PlayerSystem } from '../../core/contracts';
import { isGuest } from '../../core/coop';
import { DEV_TOOLS } from '../../core/devflags';
import type { CallInId, EnemyId, KillEvent } from '../../core/gameplay';
import { clamp, rand } from '../../core/math';
import { isMelee } from '../../weapons/melee/data';
import type { AiWorld } from '../aiWorld';
import type { EnemyManager } from '../EnemyManager';
import { GIFT_SOURCES } from '../../progression/data';
import { MAX_SQUAD, waveStrength } from '../outpost/doctrine';
import type { Outpost } from '../outpost';
import type { CrowdPlayer, JamState, Note } from '../outpost/crowd';
import type { Soldier } from '../outpost/soldier';
import { soldierOf } from '../outpost/soldier';
import type { Door } from '../outpost/squad';
import { ADAPTATIONS, FINAL_WAVE, phaseOf, TRICKS, type AdaptationId, type Phase, type TrickId } from './adaptations';
import { Barricades } from './barricades';
import { Books } from './books';
import { Devices } from './devices';
import { isDesperate, isFinal, pickAdaptation, plansFor, refit, tricksFrom, type SquadPlan } from './director';
import './events';
import type { Briefing, StatusFlag } from './events';
import { SonarJam } from './jam';
import { NAMES, radioLine } from './lines';
import { Mortars } from './mortars';
import { RadioOrders } from './orders';
import { Person } from './person';
import { Posts } from './posts';
import { GEAR_HEAVY, Props } from './props';
import { Smoke } from './smoke';
import type { StyleTracker } from './tracker';
import { Traps } from './traps';
import { unitOf, Units } from './units';

/** Seconds between looks at the player. A habit is not a frame-rate thing. */
const WATCH_EVERY = 0.25;
/** Seconds the box may hold the next wave for, at the most. */
const BRIEFING_SECONDS = 14;
/** Long enough for his last words and the Council's receipt, and never reached. */
const RUN_OVER = 60;
/** Skipped, this is what is left of the break. */
const AFTER_SKIP = 3;
/** Men over the wave's strength a Commander may field. Past this, ordinary squads stay home. */
const OVER_STRENGTH = 2;
/** The player heard a voice. Seconds later, metres closer and within this of it: they went to look. */
const FOLLOW_WINDOW = 7;
const FOLLOW_MOVED = 5;
const FOLLOW_REACH = 14;
/** Air call-ins. An orbital laser cares very little about a man with a tube. */
const AIRCRAFT: ReadonlySet<CallInId> = new Set<CallInId>(['airstrike', 'warthog', 'doorGunner', 'attackChopper', 'ac130']);
const LOCK_SECONDS = 3;
/** Metres a man will not let the player inside, once he has been told to back off. */
const KEEP_OUT = 7;
const BACK_OFF = 9;
const BACK_OFF_REST = 2.4;
/** Blasts below this are footsteps. */
const BLAST_FLOOR = 18;
/** What a heavier helmet multiplies the head plate by. */
const HELMET_MULT = 3;
const HEAVY_HELMET_SCALE = 1.1;
/** Answers that change how men already in the fight behave. Everything else arrives with a wave built round it. */
const WORKS_IN_FIGHT: ReadonlySet<AdaptationId> = new Set<AdaptationId>(['spread', 'shotguns', 'smoke', 'helmets', 'noSurrender', 'falseSurrender', 'radioSilence']);
const NEEDS_A_WAVE: readonly AdaptationId[] = ADAPTATIONS.map(a => a.id).filter(id => !WORKS_IN_FIGHT.has(id));

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const FLAGS = DEV_TOOLS && typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;

interface Shooter {
  shootDown?(id: CallInId): boolean;
}

/** What hurt a player that the Commander put there, by the damage's source: a guest's hurt is told with it (`learn`). */
const HIS: ReadonlySet<string> = new Set(['mortar', 'mine', 'tripwire', 'claymore', 'snare', 'rigged', 'deadman', 'casualty', 'falseSurrender', 'sniper']);

export class Commander {
  /** What every player did (books.ts). Alone it is the one notebook, `tracker`. */
  readonly books = new Books();
  /** The host's own player's notebook, and alone the player's. */
  readonly tracker: StyleTracker = this.books.own;
  readonly devices: Devices;
  readonly mortars: Mortars;
  readonly units: Units;
  readonly jam: SonarJam;
  readonly smoke: Smoke;
  readonly traps: Traps;
  readonly barricades: Barricades;
  readonly person: Person;
  readonly props: Props;
  readonly posts: Posts;
  readonly orders: RadioOrders;
  /** In the order they were fielded. Nothing leaves this list during a run. */
  readonly fielded: AdaptationId[] = [];
  private readonly have = new Set<AdaptationId>();
  private readonly tricks = new Set<TrickId>();
  /** What a blast about to go off is, so the damage event can be pinned on it. */
  private cause: string | null = null;
  private readonly flags = new Map<StatusFlag, boolean>();
  private watchAt = 0;
  private wave = 0;
  private mapReady = false;
  private forcedDone = false;
  private nameAt = 0;
  private readonly names = new WeakMap<Soldier, string>();
  private readonly backedOffAt = new WeakMap<Soldier, number>();
  /** Men whose helmet is the heavy one (`thicken`). By body: a pooled body loses it at the gate (`onSpawn`). */
  private readonly heavy = new WeakSet<object>();
  /** Where the last voice on the radio was. If the player then walks there, they are listening. */
  private readonly heardAt = new THREE.Vector3();
  private heardFrom = 0;
  /** Co-op: how far each guest was from that voice (by lobby id), beside the host's own `heardFrom`. */
  private readonly heardFromOf = new Map<string, number>();
  private heardUntil = 0;
  private lockAt = -1;
  private lockFor: CallInId | null = null;
  /** Co-op: whose call-in the lock is on, by lobby slot. -1 is this player's own. */
  private lockSlot = -1;
  /** The room the player spent the last wave in. */
  lastRoom = '';
  /** Every door on the map, shut or not. What the tracker's numbers index. */
  doorList: readonly Door[] = [];

  constructor(readonly w: AiWorld, readonly o: Outpost, readonly manager: EnemyManager) {
    this.props = new Props(w.ctx);
    this.devices = new Devices(this);
    this.mortars = new Mortars(this);
    this.units = new Units(this);
    this.jam = new SonarJam(this);
    this.smoke = new Smoke(this);
    this.traps = new Traps(this);
    this.barricades = new Barricades(this);
    this.person = new Person(this);
    this.posts = new Posts(this);
    this.orders = new RadioOrders(this);
  }

  init(): void {
    const { ctx } = this.w;
    const { events } = ctx;
    this.jam.init();
    events.on('weapon:fired', f => {
      this.tracker.shot(f.weapon, f.origin.x, f.origin.z);
      // A blade or a club reaches nothing, and a rocket or a Quiver missile arrives as a blast, not along the crosshair.
      if (!isMelee(f.weapon) && f.weapon !== 'rocket' && f.weapon !== 'quiver') this.devices.onShot(f.origin, f.dir);
    });
    events.on('enemy:killed', k => this.onKilled(k));
    events.on('enemy:severed', () => { this.book().round.limbs++; });
    events.on('enemy:executed', () => { this.book().round.executions++; });
    events.on('sonar:ping', () => { this.tracker.round.pings++; });
    events.on('pickup:collected', p => {
      this.tracker.round.pickups++;
      this.traps.onPickup(p.kind, p.position);
    });
    events.on('callin:used', c => this.onCallIn(c.id));
    // Co-op: a teammate's aircraft is answered as the host's own is.
    events.on('callin:teammate', c => this.onCallIn(c.id, c.slot));
    events.on('player:damaged', d => {
      this.tracker.round.damageTaken += d.amount;
      if (this.cause) this.tracker.trapped(this.cause, d.amount);
      else if (d.from && this.fromSniper(d.from)) this.tracker.trapped('sniper', d.amount);
    });
    events.on('comms:line', l => this.onHeard(l.position, l.speaker !== null));
    events.on('commander:skipped', () => {
      // Co-op: the break is the team's to end, by its ready vote (net/teamBreak.ts). Pressing through his briefing is this
      // player's vote: it says "I am ready", as it does alone, and never ends the break for anyone by itself.
      if (ctx.coop?.world) {
        ctx.coop.world.team.rest.readyUp();
        return;
      }
      const { waves } = this.o;
      if (waves.phase === 'intermission') waves.nextWaveIn = Math.min(waves.nextWaveIn, AFTER_SKIP);
    });
    ctx.physics.radialListeners.add((center, radius, strength) => {
      if (strength < BLAST_FLOOR) return;
      this.devices.onBlast(center, radius);
      this.barricades.onBlast(center, radius);
    });
  }

  reset(): void {
    if (!this.mapReady && this.o.doors.length > 0) {
      this.mapReady = true;
      this.doorList = this.o.doors;
      this.books.setDoors(this.doorList);
    }
    this.books.reset();
    this.heardFromOf.clear();
    this.units.reset();
    this.devices.clear();
    this.mortars.reset();
    this.jam.reset();
    this.smoke.reset();
    this.traps.reset();
    this.barricades.reset();
    this.person.reset();
    this.orders.reset();
    this.have.clear();
    this.tricks.clear();
    this.fielded.length = 0;
    this.flags.clear();
    this.cause = null;
    this.watchAt = 0;
    this.wave = 0;
    this.nameAt = 0;
    this.heardUntil = 0;
    this.lockAt = -1;
    this.lockFor = null;
    this.forcedDone = false;
    this.lastRoom = '';
  }

  get phase(): Phase {
    return phaseOf(Math.max(this.wave, 1));
  }

  get desperate(): boolean {
    return isDesperate(this.wave);
  }

  /** The player is up on the decks, which changes which spots see them. */
  get highGround(): boolean {
    return this.w.player.position.y > 3;
  }

  has(id: AdaptationId): boolean {
    return this.have.has(id);
  }

  hasTrick(id: TrickId): boolean {
    return this.tricks.has(id);
  }

  /** The call-in uplink is down. Progression reads this. */
  get callInDelay(): number {
    return this.units.count('radio') > 0 ? 1 : 0;
  }

  // -------------------------------------------------------------------------------------------
  // The wave
  // -------------------------------------------------------------------------------------------

  /** Takes the wave the Outpost would have sent and returns the one the Commander is sending. */
  compose(wave: number, base: EnemyId[][]): EnemyId[][] {
    this.wave = wave;
    this.applyForced();
    for (const t of TRICKS) if (t.from <= wave) this.tricks.add(t.id);
    refit(base, this.have, wave);
    const plans = plansFor(wave, this.have, this.tricks);
    let men = 0;
    for (const p of plans) men += p.members.length;
    const room = waveStrength(wave) + OVER_STRENGTH - men;
    const squads: EnemyId[][] = [];
    const table: (SquadPlan | null)[] = [];
    for (const p of plans) {
      squads.push([...p.members]);
      table.push(p);
    }
    let kept = 0;
    for (const squad of base) {
      // One ordinary squad always comes. Men with posts are no use with nobody to fight for them.
      if (kept > 0 && kept + squad.length > room) continue;
      kept += squad.length;
      squads.push(squad.slice(0, MAX_SQUAD));
      table.push(null);
    }
    this.units.setPlans(table);
    return squads;
  }

  onSquadFormed(index: number): void {
    this.units.onSquadFormed(index);
  }

  /** Called with the wave open, once the banner is up. */
  onWaveStart(): void {
    const { o } = this;
    if (this.has('mortars') || this.hasTrick('sacrifice') || this.hasTrick('dangerClose')) this.mortars.chooseSite();
    const phases: Phase[] = ['contact', 'adaptation', 'desperation', 'lastStand'];
    this.traps.layout(phases.indexOf(this.phase));
    if (isFinal(this.wave)) this.person.arm();
    if (this.has('radioSilence')) o.doctrine.radioSilence = true;
  }

  /**
   * The wave is clear. Writes up the round, picks the answer and returns how long the break is. A mission has no wave to build an answer
   * into, so with `inFight` he promises only what changes for men already out there: nothing he says may fail to happen.
   */
  intermission(wave: number, base: number, inFight = false): number {
    // Nothing comes after the last wave. The box is already saying goodbye.
    if (this.person.dead) return RUN_OVER;
    // Co-op: every player's round is closed, and a player who has left takes their habits along.
    const crowd = this.o.crowd?.players();
    if (crowd) this.books.keep(new Set(crowd.map(p => p.id)));
    let report = this.books.closeRound(wave);
    const next = wave + 1;
    let adaptation: AdaptationId | null = null;
    const tricks = inFight ? [] : tricksFrom(next);
    for (const t of tricks) this.tricks.add(t);
    if (next <= FINAL_WAVE) {
      adaptation = pickAdaptation(this.books.habits(), inFight ? new Set([...this.have, ...NEEDS_A_WAVE]) : this.have, next);
      if (adaptation) this.adopt(adaptation);
    }
    // Co-op: the box quotes the round of the player whose habit he is answering, so every number in it is true of someone.
    if (crowd && adaptation) {
      const habit = ADAPTATIONS.find(a => a.id === adaptation)?.habit;
      const lead = habit ? this.books.leader.get(habit) ?? null : null;
      report = this.books.report(lead) ?? report;
    }
    this.lastRoom = report.room;
    const seconds = clamp(base + 5, base, BRIEFING_SECONDS);
    const briefing: Briefing = { wave, next, phase: phaseOf(next), report, adaptation, tricks, fielded: this.fielded, seconds };
    this.w.ctx.events.emit('commander:briefing', briefing);
    return seconds;
  }

  /** Puts an answer into play, for good. */
  adopt(id: AdaptationId): void {
    if (this.have.has(id)) return;
    this.have.add(id);
    this.fielded.push(id);
    const { doctrine } = this.o;
    switch (id) {
      case 'spread':
        doctrine.spacing = 5.5;
        doctrine.stacks = false;
        break;
      case 'shotguns':
        doctrine.keepOut = KEEP_OUT;
        break;
      case 'smoke':
        doctrine.flankAngle = 130;
        break;
      case 'noSurrender':
      case 'falseSurrender':
        doctrine.surrender = false;
        break;
      case 'radioSilence':
        doctrine.radioSilence = true;
        break;
      default:
        break;
    }
  }

  /** `?dev=1&cmd=mortars,jammers&cmdwave=6`: fields answers and jumps to a wave, for tests. */
  private applyForced(): void {
    if (this.forcedDone) return;
    this.forcedDone = true;
    const asked = FLAGS?.get('cmd');
    if (asked) for (const id of asked.split(',')) if (ADAPTATIONS.some(a => a.id === id)) this.adopt(id as AdaptationId);
  }

  /** The wave a dev flag asked to start on, or 0. */
  static forcedWave(): number {
    return Number(FLAGS?.get('cmdwave') ?? 0);
  }

  // -------------------------------------------------------------------------------------------
  // The men
  // -------------------------------------------------------------------------------------------

  onSpawn(s: Soldier): void {
    this.props.strip(s.e.char);
    this.heavy.delete(s.e);
    this.units.onSpawn(s);
    this.backedOffAt.delete(s);
    this.names.delete(s);
    // Every squad's first man has a name, so that the box has someone to mourn.
    if (s.seat === 1 && !s.squad.directed) this.names.set(s, NAMES[this.nameAt++ % NAMES.length]!);
    // Co-op guest: this is a copy of the host's man. What he wears is the host's word (`wear`): this page's own roll of his
    // rank, and its own Commander, who fields nothing, would dress him wrongly.
    if (isGuest(this.w.ctx)) return;
    if (this.has('helmets')) this.heavyHelmet(s);
    // Rank has to read at 30 m, and all a man has at 30 m is a silhouette. A visor is a man to take seriously.
    else if (s.rank === 'elite') this.props.fit(s.e.char, 'visor');
    if (!unitOf(s)) this.traps.arm(s);
  }

  private heavyHelmet(s: Soldier): void {
    if (this.thicken(s)) this.props.fit(s.e.char, 'visor');
  }

  /** His helmet becomes the heavy one: three times the plate, and a size up. False if he has none. */
  private thicken(s: Soldier): boolean {
    const e = s.e;
    for (const p of e.plates) {
      if (!p.spec.regions.includes('head')) continue;
      e.armor += p.hp * (HELMET_MULT - 1);
      p.hp *= HELMET_MULT;
      // His own helmet, a size up, so the order reads before the first shot. fitPlates puts it back to size on respawn.
      if (p.worn) p.mesh.scale.multiplyScalar(HEAVY_HELMET_SCALE);
      this.heavy.add(e);
      return true;
    }
    return false;
  }

  /**
   * What this man wears that says what he is: his props as bits in `PROP_KINDS` order, and `GEAR_HEAVY` for the heavy helmet.
   * Co-op: the host tells its guests (net/world/identity.ts), because a guest's own Commander fields nothing and its own
   * roll of a man's rank is not the host's, so every tell (the jammer's whip, the spotter's designator, the rigged man's
   * vest, the visor, the thick helmet) was missing or on the wrong man on a guest's screen.
   */
  gearOf(s: Soldier): number {
    return this.props.mask(s.e.char) | (this.heavy.has(s.e) ? GEAR_HEAVY : 0);
  }

  /** Co-op guest: the host's word on what this copy wears. */
  wear(s: Soldier, gear: number): void {
    this.props.dress(s.e.char, gear & (GEAR_HEAVY - 1));
    if ((gear & GEAR_HEAVY) !== 0 && !this.heavy.has(s.e)) this.thicken(s);
  }

  onDetach(s: Soldier): void {
    const u = unitOf(s);
    if (!s.e.alive && s.fate !== 'flee') {
      if (u?.kind === 'casualty') this.units.casualtyShot(s);
      this.traps.onDead(s);
    }
    this.units.drop(s);
  }

  /** A broken man is about to drop his gun. True if the Commander has other plans for him. */
  feign(s: Soldier): boolean {
    return this.has('falseSurrender') && this.units.feignFor(s, 0.55);
  }

  private onKilled(k: KillEvent): void {
    const s = soldierOf(k.enemy);
    const source = k.damage.source;
    // Co-op: whoever's kill it is, it goes in their notebook (the host applies a guest's claim as that guest).
    const book = this.book();
    if (GIFT_SOURCES.test(source)) {
      book.round.gifts++;
      this.w.ctx.events.emit('commander:gift', { position: k.enemy.position, cause: source });
      return;
    }
    book.kill(source, k.distance, k.headshot);
    this.traps.onKilled(k);
    if (!s) return;
    const name = this.names.get(s);
    if (name) book.named(name);
    if (s.patient) book.round.rescuersKilled++;
  }

  /** The notebook of whoever did what is happening now: the guest whose claim the host is applying, else the host's own. */
  private book(): StyleTracker {
    const who = this.o.crowd?.applying();
    return who ? this.books.of(who.id) : this.tracker;
  }

  /** A player's notebook: the host's own player's is `tracker`. */
  private bookOf(p: CrowdPlayer): StyleTracker {
    return p.own ? this.tracker : this.books.of(p.id);
  }

  /** Co-op host: points everything that reads "the player" at `player` (null: the host's own back). Nothing alone. */
  focus(player: PlayerSystem | null): void {
    this.o.focus(player);
  }

  /**
   * Co-op host: what a guest did that he would have noted had the host's own player done it (outpost/crowd.ts `Note`).
   * Each lands in that guest's own notebook, by the same calls the host's own events make.
   */
  learn(who: CrowdPlayer, note: Note): void {
    const book = this.bookOf(who);
    switch (note.kind) {
      case 'shots':
        for (let i = 0; i < note.n; i++) book.shot(note.what, note.at.x, note.at.z);
        break;
      case 'ping':
        book.round.pings++;
        break;
      case 'pickup':
        book.round.pickups++;
        this.traps.onPickup(note.what as never, note.at);
        break;
      case 'hurt':
        book.round.damageTaken += note.n;
        break;
      default:
        break;
    }
  }

  /** Co-op host: one of his own things hurt a guest (the host's own player's is heard as `player:damaged`). */
  trapped(who: CrowdPlayer, cause: string, amount: number): void {
    if (!who.own && HIS.has(cause)) this.bookOf(who).trapped(cause, amount);
  }

  /** Co-op host: what the guests' sonar and minimap may say (jam.ts). */
  tellJam(state: JamState): void {
    this.o.crowd?.jam(state);
  }

  private fromSniper(at: THREE.Vector3): boolean {
    for (const s of this.o.soldiers) if (s.role === 'marksman' && s.e.position.distanceTo(at) < 3) return true;
    return false;
  }

  private onHeard(at: THREE.Vector3, real: boolean): void {
    if (!real || this.w.now < this.heardUntil) return;
    this.heardAt.copy(at);
    this.heardFrom = this.w.player.position.distanceTo(at);
    this.heardUntil = this.w.now + FOLLOW_WINDOW;
    // Co-op: each guest heard it from where they stood.
    const crowd = this.o.crowd?.players();
    if (crowd) for (const p of crowd) if (!p.own) this.heardFromOf.set(p.id, p.player.position.distanceTo(at));
  }

  private watchEars(): void {
    if (this.heardUntil === 0 || this.w.now < this.heardUntil) return;
    this.heardUntil = 0;
    const d = this.w.player.position.distanceTo(this.heardAt);
    if (this.heardFrom - d >= FOLLOW_MOVED && d < FOLLOW_REACH) this.tracker.round.chatterFollowed++;
    const crowd = this.o.crowd?.players();
    if (!crowd) return;
    // Co-op: whoever walked toward the voice is the one who is listening.
    for (const p of crowd) {
      const from = this.heardFromOf.get(p.id);
      if (p.own || from === undefined) continue;
      const now = p.player.position.distanceTo(this.heardAt);
      if (from - now >= FOLLOW_MOVED && now < FOLLOW_REACH) this.books.of(p.id).round.chatterFollowed++;
    }
    this.heardFromOf.clear();
  }

  private onCallIn(id: CallInId, slot = -1): void {
    // Co-op: a teammate's call-in goes in the teammate's notebook.
    const caller = slot >= 0 ? this.o.crowd?.bySlot(slot) : null;
    (caller ? this.bookOf(caller) : this.tracker).round.callIns++;
    if (!AIRCRAFT.has(id) || this.units.count('manpads') === 0) return;
    this.lockAt = this.w.now + LOCK_SECONDS;
    this.lockFor = id;
    this.lockSlot = slot;
    this.status('aaLock', true);
    this.radio('radio.manpads.lock', this.units.first('manpads')?.s ?? null);
  }

  private fireManpads(): void {
    const { ctx } = this.w;
    const id = this.lockFor;
    const u = this.units.first('manpads');
    this.lockAt = -1;
    this.lockFor = null;
    this.status('aaLock', false);
    if (!u || !id) return;
    _a.copy(u.s.e.center);
    _a.y += 0.5;
    _b.set(rand(-4, 4), 42, rand(-4, 4));
    ctx.combat.spawnProjectile({
      origin: _a, velocity: _b, kind: 'rocket', team: 'enemy', damage: 0, source: 'manpads', gravity: 0, lifetime: 1.6, trail: 'smoke',
    });
    ctx.audio.play('enemy_rocket_fire', { position: _a, volume: 1 });
    // A teammate's (co-op): their own game brings it down, told by the host.
    const hit = this.lockSlot >= 0 ? ctx.coop?.world?.shootDown(this.lockSlot, id) ?? false
      : (ctx.progression as unknown as Shooter).shootDown?.(id) ?? false;
    if (hit) this.tracker.trapped('manpads', 0);
    this.radio(hit ? 'radio.manpads.hit' : 'radio.manpads.miss', u.s);
  }

  /** Men told to keep their distance take it: section 16.2's answer to a player who wants to be close. */
  private keepAway(now: number): void {
    const { o, w } = this;
    const keep = o.doctrine.keepOut;
    if (keep <= 0) return;
    for (const s of o.soldiers) {
      if (!s.fighting || s.role === 'shotgun' || s.role === 'shield' || s.e.dist > keep || s.task === 'move' || s.hasOrder || s.squad.directed) continue;
      if (now < (this.backedOffAt.get(s) ?? 0)) continue;
      this.backedOffAt.set(s, now + BACK_OFF_REST);
      // Co-op: away from the player he is too close to, who is the one he is after.
      const from = (s.e.quarry ?? w.player).position;
      const away = Math.atan2(s.e.position.x - from.x, s.e.position.z - from.z) + rand(-0.5, 0.5);
      _a.set(s.e.position.x + Math.sin(away) * BACK_OFF, s.e.position.y, s.e.position.z + Math.cos(away) * BACK_OFF);
      if (w.ctx.world.nav.nearest(_a, 5, _a)) o.order(s, _a, null, 2, 0);
    }
  }

  /** Too many men standing too close to the player, and a voice on the radio deciding that is acceptable. */
  private dangerClose(): void {
    const { o, w } = this;
    if (!this.hasTrick('dangerClose') || !this.mortars.manned || this.mortars.busy) return;
    let close: Soldier | null = null;
    let near = 0;
    let on = w.player.position;
    const crowd = o.crowd?.players();
    if (!crowd) {
      for (const s of o.soldiers) {
        if (!s.fighting || s.e.dist > 8) continue;
        near++;
        close = s;
      }
    } else {
      // Co-op: the men crowding one player are that player's problem. One call, on whoever has the most of them.
      for (const p of crowd) {
        if (!p.player.alive) continue;
        let count = 0;
        let last: Soldier | null = null;
        for (const s of o.soldiers) {
          if (!s.fighting || s.e.quarry !== p.player || s.e.dist > 8) continue;
          count++;
          last = s;
        }
        if (count <= near) continue;
        near = count;
        close = last;
        on = p.player.position;
      }
    }
    if (near < 3 || !close) return;
    if (!this.mortars.call(on, 'mortar', 5)) return;
    this.radio('radio.dangerClose', close);
    w.ctx.audio.play('vox_scream', { position: close.e.center, volume: 0.8 });
  }

  // -------------------------------------------------------------------------------------------
  // Frame
  // -------------------------------------------------------------------------------------------

  update(dt: number): void {
    const { w } = this;
    const now = w.now;
    if (now >= this.watchAt) {
      this.watchAt = now + WATCH_EVERY;
      this.watch(now);
    }
    this.units.update();
    this.mortars.update(dt);
    this.devices.update();
    this.jam.update();
    this.smoke.update(dt);
    this.traps.update();
    this.barricades.update(dt);
    this.person.update();
    this.orders.update(now);
    if (this.lockAt >= 0 && now >= this.lockAt) this.fireManpads();
  }

  private watch(now: number): void {
    const { o, w, tracker } = this;
    const crowd = o.crowd?.players();
    if (!crowd) {
      const p = w.player;
      tracker.sample(WATCH_EVERY, p.position.x, p.position.y, p.position.z, p.speed, o.hostile > 0, w.ctx.world.zoneAt(p.position)?.name ?? null);
    } else {
      // Co-op: one look at each living player, into their own notebook.
      for (const c of crowd) {
        const p = c.player;
        if (!p.alive) continue;
        const speed = Math.hypot(p.velocity.x, p.velocity.y * 0.5, p.velocity.z);
        this.bookOf(c).sample(WATCH_EVERY, p.position.x, p.position.y, p.position.z, speed, o.hostile > 0, w.ctx.world.zoneAt(p.position)?.name ?? null);
      }
    }
    this.watchEars();
    this.keepAway(now);
    this.dangerClose();
    this.status('uplink', this.callInDelay > 0);
  }

  // -------------------------------------------------------------------------------------------
  // Shared by everything in this folder
  // -------------------------------------------------------------------------------------------

  /** A blast of the Commander's making, on the floor at `at`. */
  boom(at: THREE.Vector3, radius: number, damage: number, cause: string): void {
    const { ctx } = this.w;
    _b.copy(at);
    _b.y += 0.7;
    this.cause = cause;
    ctx.combat.explode(_b, { radius, damage, kind: 'enemy', source: cause, team: 'enemy' });
    this.cause = null;
  }

  /** Damage that is no blast, and still the Commander's fault. `victim` is who it caught: in co-op any player (`hostPlayers`), not only the host's. */
  hurt(amount: number, from: THREE.Vector3, cause: string, victim: PlayerSystem = this.w.ctx.player): void {
    this.cause = cause;
    victim.takeDamage({ amount, from, type: 'crush', source: cause });
    this.cause = null;
  }

  /** A line from lines.ts over the squad radio. */
  radio(id: string, s: Soldier | null, vars?: Readonly<Record<string, string>>): void {
    const line = radioLine(id);
    if (!line) return;
    let text = line.text;
    if (vars) for (const key in vars) text = text.replaceAll(`{${key}}`, vars[key]!);
    this.o.comms.relay(text, s, null);
  }

  /** The Commander himself on the open channel. */
  bark(id: string): void {
    this.w.ctx.events.emit('commander:bark', { id });
  }

  status(flag: StatusFlag, on: boolean): void {
    if ((this.flags.get(flag) ?? false) === on) return;
    this.flags.set(flag, on);
    this.w.ctx.events.emit('commander:status', { flag, on });
  }

  /** Writes a place inside the gate furthest from the player. */
  farGate(out: THREE.Vector3): boolean {
    const { world } = this.w.ctx;
    const nav = world.nav;
    let best = -Infinity;
    let found = false;
    for (const g of world.spawnPoints) {
      if (g.kind !== 'gate') continue;
      // Co-op: furthest from every player, which is furthest from the nearest of them.
      const d = this.o.playerDistance(g.position) + rand(0, 8);
      if (d <= best) continue;
      // A few metres in from the gate, so the crew are not standing in the road the next squad walks through.
      _a.copy(g.position).multiplyScalar(0.86);
      if (!nav.nearest(_a, 6, _b)) continue;
      out.copy(_b);
      best = d;
      found = true;
    }
    return found;
  }

  /** Everything in play right now, in one read, for bots and tests. */
  describe(): Record<string, unknown> {
    const count: Record<string, number> = {};
    for (const u of this.units.list) count[u.kind] = (count[u.kind] ?? 0) + 1;
    const devices: Record<string, number> = {};
    for (const d of this.devices.live) devices[d.kind] = (devices[d.kind] ?? 0) + 1;
    return { wave: this.wave, phase: this.phase, fielded: [...this.fielded], tricks: [...this.tricks], units: count, devices, mortar: this.mortars.stage, missions: this.mortars.missions, jammed: this.jam.jammed };
  }
}

