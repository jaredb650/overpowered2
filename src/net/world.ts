/**
 * The co-op world: what the rest of the game calls (`ctx.coop.world`). It holds no feature itself. Each feature is a module
 * under `world/` with its own state, its own events on the wire and its own handlers; this class builds them, runs them each
 * frame and hands calls on. The layout and how to add an event are in docs/notes/coop.md, "Code layout".
 */
import type RAPIER from '@dimforge/rapier3d-compat';
import type * as THREE from 'three';
import type { Ctx, DamageInfo, ExplosionKind, MuzzleKind, PlayerDamage, PlayerSystem, TracerKind } from '../core/contracts';
import type { CallInId, DamageResult, EnemyInstance, ExplosionSpec, ProjectileSpec } from '../core/gameplay';
import type { Enemy } from '../enemies/Enemy';
import type { PlayerSense } from '../enemies/aiWorld';
import type { ClaimValidator } from './authority';
import type { CoopSession } from './index';
import { COOP_FEEL } from './feel';
import { CoopMission } from './mission';
import { Team } from './team';
import { Skyhook } from './world/airlift';
import { Allies } from './world/allies';
import { EnemyAttacks } from './world/attacks';
import { Booms } from './world/booms';
import { Callins } from './world/callins';
import { Capture } from './world/capture';
import { Chatter } from './world/chatter';
import { Claims, type StatusKind } from './world/claims';
import { Clock } from './world/clock';
import { Credit } from './world/credit';
import { Crowd } from './world/crowd';
import type { SlowKind } from './world/slow';
import { WorldContext, type WorldModule } from './world/context';
import { EnemyFire } from './world/enemyFire';
import { Fort } from './world/fort';
import { Guns, type GunEvent } from './world/guns';
import { Hits } from './world/hits';
import { Identity } from './world/identity';
import { Late } from './world/late';
import { Moves } from './world/moves';
import { Pods, type PodEvent } from './world/pods';
import { VillainProps } from './world/villainProps';
import { Props } from './world/props';
import { RemoteFire } from './world/remoteFire';
import { WATCHED } from '../weapons/watch';
import { Replicas } from './world/replicas';
import { SharedSonar } from './world/sonar';
import { Targeting } from './world/targeting';
import { Vehicles } from './world/vehicles';
import { Villain } from './world/villain';
import { Warnings } from './world/warnings';

export class CoopWorld {
  readonly stats: WorldContext['stats'];
  readonly team: Team;
  readonly mission: CoopMission;
  readonly validator: ClaimValidator;
  /** Enemy attacks on every screen: the brain tells it what the host's enemies do (enemies/brain.ts). */
  readonly attacks: EnemyAttacks;
  /** Ground rings, shocks, shells and the lasers of things that are not an enemy's attack (enemies/telegraph.ts). */
  readonly warnings: Warnings;
  /** What enemies fire, for the browser proofs. */
  readonly enemyFire: EnemyFire;
  /** The Commander's words on guests, for the browser proofs. */
  readonly villain: Villain;
  private readonly w: WorldContext;
  private readonly enemies: Replicas;
  private readonly targeting: Targeting;
  private readonly shots: RemoteFire;
  private readonly claims: Claims;
  private readonly hits: Hits;
  private readonly credit: Credit;
  private readonly booms: Booms;
  private readonly guns: Guns;
  private readonly pods: Pods;
  private readonly props: Props;
  private readonly capture: Capture;
  private readonly vehicles: Vehicles;
  private readonly garrison: Allies;
  private readonly fort: Fort;
  private readonly villainProps: VillainProps;
  private readonly crowd: Crowd;
  private readonly time: Clock;
  private readonly calls: Callins;
  private readonly hook: Skyhook;
  /** Host: a guest's events kept for a moment until that guest's body is in the world (world/late.ts). */
  private readonly late: Late;
  /** Run every frame in this order (`update`), and disposed in it. The snapshot goes out last. */
  private readonly modules: WorldModule[];
  /** Every module, for the seat hooks (`lostSeat`, `forgetPeer`): the ones above and those with no frame of their own. */
  private readonly parts: WorldModule[];
  /** Host: players who came in before this page's own world began; they are caught up as it begins. */
  private readonly early = new Map<string, boolean>();
  private readonly offSeats: (() => void)[] = [];

  constructor(private readonly ctx: Ctx, private readonly session: CoopSession) {
    const w = this.w = new WorldContext(ctx, session);
    this.stats = w.stats;
    this.validator = w.validator;
    this.team = w.team = new Team(ctx, session, (event, to) => w.send(event, to));
    // A mission's rides are everyone's: each guest's door gun counts through the host as a call-in.
    this.team.onArrived = id => { this.mission.catchUp(id); this.catchUp(id); this.villain.catchUp(id); this.shots.catchUp(id); };
    this.mission = new CoopMission(ctx, session, (event, to) => w.send(event, to), this.team,
      () => { for (const p of session.lobby.players) if (!p.host) this.validator.callIn(p.id, performance.now()); },
      // A guest going back to a checkpoint rebuilds its run: its copies of the host's enemies and vehicles go first, and come
      // back from the next snapshot.
      () => { this.enemies.dispose(); this.vehicles.dispose(); });
    this.team.plug(w.router);
    this.mission.plug(w.router);
    // Each module adds its own game listeners and event handlers as it is built. Listeners on one game event run in the order
    // added: Credit must hear `enemy:killed` before Hits and before any system does (who killed it is known first), which holds
    // because it is built before Hits and the world is built before systems init.
    this.late = new Late(w);
    this.targeting = new Targeting(w);
    this.enemies = new Replicas(w, this.targeting);
    // Before Claims, which lets a guest's rounds hurt them; after Replicas, whose clock their copies are drawn by.
    this.vehicles = new Vehicles(w, this.enemies);
    // Before RemoteFire: a shot's id moves on `weapon:fired`, and claims.ts must hear that first.
    this.claims = new Claims(w, this.enemies, this.targeting, this.vehicles);
    this.shots = new RemoteFire(w, this.late);
    this.calls = new Callins(w);
    this.hook = new Skyhook(w);
    // Sonar is shared; Thermal is each player's own and never sent. Focus slows the world for everyone (world/clock.ts).
    new SharedSonar(w);
    this.credit = new Credit(w, this.claims);
    this.hits = new Hits(w, this.enemies, this.credit, this.claims);
    // After Credit: a boss's death names its killer, which Credit works out on the same `enemy:killed`.
    this.time = new Clock(w, uid => this.credit.slot(uid));
    new Chatter(w, this.enemies);
    this.capture = new Capture(w, this.enemies, this.targeting, this.late);
    this.enemyFire = new EnemyFire(w, this.targeting);
    this.attacks = new EnemyAttacks(w, this.enemies, this.targeting, this.enemyFire);
    this.warnings = new Warnings(w, this.enemyFire);
    this.villain = new Villain(w);
    this.booms = new Booms(w, this.targeting);
    this.guns = new Guns(w);
    this.garrison = new Allies(w, this.enemies, this.targeting);
    this.fort = new Fort(w, this.targeting);
    this.villainProps = new VillainProps(w, this.targeting);
    // Every player, for the host's soldiers and their Commander; what a guest tells the host of itself.
    this.crowd = new Crowd(w, this.targeting, () => this.claims.applying);
    this.warnings.onBlinded = () => this.crowd.blinded();
    this.pods = new Pods(w);
    this.props = new Props(w, this.credit, this.targeting);
    // A guest says so as its world comes up, and again once a second until the host has settled its seat (team.ts): the
    // spare for the session's own arrival word, which a host still booting does not hear. Every catch-up is safe twice.
    w.router.host('worldsync', (_, from) => this.team.asked(from));
    // Moves and identities ride the reliable lane beside the enemies' unreliable states (replicas.ts).
    const moves = new Moves(w, this.enemies), identity = new Identity(w, this.enemies);
    this.modules = [this.late, this.capture, this.vehicles, this.garrison, this.fort, this.villainProps, this.crowd, this.targeting, this.claims, this.credit, this.hits, this.shots, this.props, this.attacks, this.warnings, this.calls, this.hook, w.later, this.time, moves, identity, this.enemies];
    this.parts = [...this.modules, this.booms, this.pods];
    // Guest: the host's `sync` means it has this player in the world: everything said once is said again (context.ts `resay`).
    this.team.onSynced = () => {
      this.mission.resay();
      for (const part of this.parts) {
        try { part.resay?.(); } catch (error) { console.warn('[coop] Saying it again to the host failed', error); }
      }
    };
    // The one listener of the session's seat hooks (seats.ts). Everything a module owes a player who arrives, drops or goes
    // is driven from these three; a stand-in session without them (a unit test's) has only the team's first-card path.
    const hooks = session as Partial<Pick<CoopSession, 'onArrived' | 'onLost' | 'onForget'>>;
    if (session.hosting) {
      if (hooks.onArrived) this.offSeats.push(hooks.onArrived.add((id, info) => this.arrived(id, info.same)));
      if (hooks.onLost) this.offSeats.push(hooks.onLost.add(id => this.lost(id)));
      if (hooks.onForget) this.offSeats.push(hooks.onForget.add(id => this.forget(id)));
    }
  }

  /**
   * Host: a player is in the world: a first arrival, a new page of a seat that was here, or (`same`) the same page back after
   * a drop. The team settles the seat and says where the waves stand, then every catch-up runs (`team.onArrived`).
   */
  private arrived(id: string, same: boolean): void {
    // Before this page's own world has begun there is nothing to hand over yet.
    if (!this.w.ready) { this.early.set(id, same); return; }
    this.team.arrive(id, same);
  }

  /** Host: a player's connection dropped. Their seat is kept; what they held in the world is let go, on every screen. */
  private lost(id: string): void {
    const slot = this.session.lobby.players.find(p => p.id === id)?.slot;
    if (slot === undefined) return;
    this.team.lost(id);
    for (const part of this.parts) {
      try { part.lostSeat?.(id, slot); } catch (error) { console.warn('[coop] Letting go of a lost player\'s things failed', error); }
    }
  }

  /** Host: a connection id that is gone for good. */
  private forget(id: string): void {
    this.early.delete(id);
    for (const part of this.parts) {
      try { part.forgetPeer?.(id); } catch (error) { console.warn('[coop] Forgetting a connection failed', error); }
    }
  }

  /** Read by the two-page proofs (tools/scripts/coop-*.mjs): the guest's enemy copies, last snapshot and garrison bodies. */
  get replicas(): Replicas['map'] { return this.enemies.map; }
  get receivedSeq(): number | null { return this.enemies.receivedSeq; }
  get allyBodies(): Allies['bodies'] { return this.garrison.bodies; }
  /** A guest's orders to the garrison: asked, carried out by the host, stims handed back (world/allies.ts), for the proofs. */
  get allyOrders(): Allies['counts'] { return this.garrison.counts; }

  /** The call-ins' wire (world/callins.ts): its cost meter, for the proofs. */
  get callins(): Callins { return this.calls; }
  /** A streak perk's effect in the world, for the other screens: Chain Storm's arc from `at` to `to`, Frost Nova's ring at `at`. */
  perkFx(kind: 'arc' | 'nova', at: THREE.Vector3, to?: THREE.Vector3): void { this.calls.perkFx(kind, at, to); }
  /** The capture skyhook as this screen flies it (world/airlift.ts), for the proofs. */
  get skyhook(): Skyhook { return this.hook; }
  /** How many `boom`s the budget has left out (world/booms.ts). */
  get boomsDropped(): number { return this.booms.dropped; }
  /** Host: the Commander's missile on the aircraft another player called in. That player's own game brings it down. */
  shootDown(slot: number, id: CallInId): boolean { return this.calls.shootDown(slot, id); }

  /** Host: the player the enemy being updated is after (EnemyManager reads and clears it). */
  get targetPlayer(): PlayerSystem | null { return this.targeting.targetPlayer; }
  set targetPlayer(player: PlayerSystem | null) { this.targeting.targetPlayer = player; }
  get receivingDamage(): boolean { return this.targeting.receivingDamage; }
  set receivingDamage(on: boolean) { this.targeting.receivingDamage = on; }

  /**
   * Not this player's: a kill (by uid) or a hit landed by a teammate. Score, combo, perks, kill pay and the run report skip it,
   * so each player's own browser pays and scores only what they did. Solo and guests' own replays read false.
   */
  notMine(enemy?: { uid: number }): boolean { return this.credit.notMine(enemy); }
  /** Host: whose damage is being applied right now (a lobby id), for work put off to a later frame (Combat's queued blasts). */
  get crediting(): string | null { return this.credit.crediting; }
  /** Host: runs what follows as `owner`'s doing; returns what to pass back when it is done (credit.ts `as`). */
  creditAs(owner: string | null): string | null { return this.credit.as(owner); }
  /** Host: floating text for the hit being applied. True when it went to the guest whose hit it was instead. */
  labelFor(at: THREE.Vector3, text: string, color?: string): boolean { return this.credit.label(at, text, color); }
  /** Before the clock ticks: the team's slow-mo, as the host has it, is applied to this screen's clock (world/clock.ts). */
  clock(): void { this.time.clock(); }
  /** Is this player's own slow-mo of this kind (the Focus brain chip, a perk) still granted by the host, or on its way there? */
  slowHeld(kind: SlowKind): boolean { return this.time.held(kind); }
  /** Why this player's last slow-mo of this kind was refused or cut short, read once. */
  slowRefusal(kind: SlowKind): ReturnType<Clock['takeRefusal']> { return this.time.takeRefusal(kind); }
  /** What is slowing the world on this screen now, and what the notice reads (the proofs, tools/scripts/coop-time-*.mjs). */
  get slows(): Clock['active'] { return this.time.active; }
  get slowNotice(): ReturnType<Clock['readNotice']> { return this.time.readNotice(); }
  /** Host: the team's slow-mo rules and budget. */
  get slowBoard(): Clock['board'] { return this.time.board; }
  begin(): void {
    this.w.ready = true;
    this.mission.begin();
    this.enemies.begin();
    this.props.begin();
    if (!this.session.hosting) this.w.send({ t: 'worldsync' });
    for (const [id, same] of this.early) if (this.session.lobby.players.some(p => p.id === id && !p.away)) this.team.arrive(id, same);
    this.early.clear();
  }
  /** Host: what lies in the shared world now, for a guest who was loading, joined late or came back: pods, dropped guns, what is broken. */
  private catchUp(id: string): void {
    // Each on its own: one that fails must not cost the guest the others.
    for (const part of [this.pods, this.guns, this.props, this.fort, this.villainProps, this.capture, this.vehicles, this.calls, this.hook]) {
      try { part.catchUp(id); } catch (error) { console.warn('[coop] A catch-up for an arriving guest failed', error); }
    }
  }
  /**
   * Guest: the local player's damage on an enemy. It is sent to the host as a claim (claims.ts) and drawn here at once
   * (hits.ts `predict`); the result is this machine's guess at the host's. The world's own damage is neither.
   */
  claim(enemy: EnemyInstance, damage: DamageInfo): DamageResult {
    const own = this.hits.stamp(damage);
    const guess = this.claims.claim(enemy, damage);
    return own ? this.hits.predict(enemy as Enemy, damage) : guess;
  }
  /** Guest: runs `then` on the enemy's body once the host says this player killed it (a stake's pin, a blade's fling). */
  whenKilled(enemy: EnemyInstance, then: (enemy: EnemyInstance) => void): void { this.hits.whenKilled(enemy, then); }
  /** For the proofs: what this screen has drawn of its own and of others' hits, and the host's answer times. */
  get hitsSeen(): Hits['seen'] { return this.hits.seen; }
  /** Guest: my weapon, call-in or perk set this enemy alight, froze it or left a live bolt in it (EnemyManager.afflict). */
  status(enemy: EnemyInstance, kind: StatusKind, seconds: number): void {
    if (this.session.hosting) this.credit.lit(enemy.uid);
    else this.claims.status(enemy, kind, seconds);
  }
  /** Host: fire spread from one enemy to another: a death by it is whose the first fire was (world/credit.ts). */
  burnSpread(from: EnemyInstance, to: EnemyInstance): void { this.credit.spread(from.uid, to.uid); }
  /** Host: damage sources seen that the credit table does not name (world/credit.ts): empty in a healthy game. */
  get creditUnknown(): ReadonlySet<string> { return this.credit.unknown; }
  /**
   * Guest: my round landed on this collider (enemies/vehicles asks). True if it is the hit box of one of the host's vehicles:
   * the host is told. `kind`: a rocket or shell landing on it. False on the host and alone.
   */
  vehicleShot(collider: RAPIER.Collider | null, point: THREE.Vector3, amount: number, source: string, kind?: ExplosionKind): boolean {
    return !this.session.hosting && this.claims.vehicleHits.shot(collider, point, amount, source, kind);
  }
  /** Guest: my explosion, for the host's vehicles in it. True on a guest (nothing here to hurt), false on the host and alone. */
  vehicleBlast(center: THREE.Vector3, spec: ExplosionSpec): boolean {
    if (this.session.hosting) return false;
    this.claims.vehicleHits.blast(center, spec);
    return true;
  }
  /**
   * The claims' books, for the dev log and the proofs: what this guest sent; on the host what arrived, what was refused and
   * why (`refusedTotal` must stay 0 in an honest game), what was cut to its cap or passed a sight test on the allowance, and
   * `gone` (the enemy was already dead on the host: not a refusal).
   */
  get claimBooks() {
    const c = this.claims, v = this.validator;
    return { sent: c.sent, received: c.received, refusedTotal: c.refusedTotal, refused: c.refused, refusals: c.refusals, clamped: v.clamped, doubted: v.doubted,
      accepted: this.w.stats.accepted, late: this.late.books };
  }
  /** This player's own co-op feel switches (net/feel.ts): kill prediction. The dev panel and the proofs flip them here. */
  get feel(): typeof COOP_FEEL { return COOP_FEEL; }
  /** The shot id the local player's claims carry now (claims.ts), and on the host the claim being applied: whose, and its shot id. */
  get shot(): number { return this.claims.shot; }
  get applying(): string | null { return this.claims.applying; }
  get applyingShot(): number { return this.claims.applyingShot; }
  updateGuests(): void {
    const now = performance.now();
    this.vehicles.animate(now);
    this.enemies.animate(now);
    // After the copies are posed, so a muzzle is where its gun is.
    this.attacks.animate(this.ctx.time.dt);
  }
  select(enemy: Enemy, sense: PlayerSense): void { this.targeting.select(enemy, sense); }
  /** Every live player's eyes, for the host's fleeing men to run from (outpost/flight.ts). */
  playerEyes(): THREE.Vector3[] { return this.targeting.playerEyes(); }
  isRemoteTarget(): boolean { return this.targeting.isRemoteTarget(); }
  allowsLocalDamage(damage: PlayerDamage): boolean { return this.props.feeling || this.targeting.allowsLocalDamage(damage); }
  steer(enemy: Enemy, direction: THREE.Vector3): boolean { return this.targeting.steer(enemy, direction); }
  enemyRay(from: THREE.Vector3, to: THREE.Vector3, damage: number, source: string, trace = true, tracer?: TracerKind, whizz?: string): THREE.Vector3 | null {
    return this.enemyFire.enemyRay(from, to, damage, source, trace, tracer, whizz);
  }
  /** Host: an enemy launched a projectile; guests fly a copy. Returns its number if its end must be told, else 0. */
  projectile(spec: ProjectileSpec): number { return this.enemyFire.projectile(spec); }
  /** Host: enemy projectile `id` is gone. */
  projectileGone(id: number): void { this.enemyFire.gone(id); }
  /** Guest: the local player shot the copy of enemy projectile `id` out of the air. */
  projectileShot(id: number): void { this.enemyFire.shot(id); }
  /** Host: an enemy's muzzle flash, or a sound at a place, that is not part of an attack guests play themselves. */
  enemyFlash(position: THREE.Vector3, dir: THREE.Vector3, kind: MuzzleKind): void { this.enemyFire.flash(position, dir, kind); }
  enemySound(id: string, position: THREE.Vector3, volume?: number, pitch?: number): void { this.enemyFire.sound(id, position, volume, pitch); }
  /** The local player, whoever an enemy is after (`ctx.player` inside the enemy system can be a stand-in for a friend). */
  get me(): PlayerSystem { return this.ctx.player; }
  /** Host: every player in the world, the host's first, for dangers that must test them all. Null on a guest. */
  hostPlayers(): readonly PlayerSystem[] | null { return this.targeting.hostPlayers(); }
  /** What a guest has told the host of itself, and the host taken, by kind (world/crowd.ts): for the proofs. */
  get notes(): Crowd['counts'] { return this.crowd.counts; }
  /** Host: is this player hidden by their Ghost power-up (targeting.ts)? */
  ghosted(player: PlayerSystem): boolean { return this.targeting.ghosted(player); }
  /** Host: true if this guest's own screen had them clear of a melee swing from `from` (targeting.ts). */
  dodged(player: PlayerSystem, from: THREE.Vector3, reach: number): boolean { return this.targeting.dodged(player, from, reach); }
  /** Host: melee hits spared by that rule, for the proofs. */
  get dodges(): number { return this.targeting.dodges; }
  /** The local player's gun launched a projectile (Combat.spawnProjectile): the others fly a copy of it that hurts nothing. */
  launched(spec: ProjectileSpec): number { return this.shots.projectile(spec); }
  /** The local player's own round `tag` went off at `at`: the others' copies of it end there. */
  landed(tag: number, at: THREE.Vector3): void { this.shots.landed(tag, at); }
  /** What the local player is doing with their gun now, as the bits their pose carries (pose.ts DOING). */
  doing(): number { return this.shots.doing(); }
  /** What this player has sent of their weapons and drawn of the others', by kind (remoteFire.ts): for the proofs. */
  get weaponFx(): { sent: RemoteFire['sent']; drawn: RemoteFire['drawn']; watched: typeof WATCHED } { return { sent: this.shots.sent, drawn: this.shots.drawn, watched: WATCHED }; }
  blast(center: THREE.Vector3, spec: ExplosionSpec): void { this.booms.blast(center, spec); }
  /** A blast combat did not make (a map explosive its owner drew itself), shown on the other screens. It hurts nothing there. */
  boom(center: THREE.Vector3, kind: ExplosionKind, radius: number, scale?: number): void { this.booms.show(center, kind, radius, scale); }
  update(): void {
    if (!this.w.ready) return;
    const now = performance.now();
    this.team.update(now, this.ctx.time.realDt);
    this.mission.update();
    for (const module of this.modules) module.update?.(now);
  }
  /** A dropped gun's news (weapons/dropped.ts): a guest's drop or take goes to the host, the host's word to everyone. */
  sendGun(event: GunEvent, to?: string): void { this.guns.send(event, to); }
  /** The shared barrels and props: counters for the proofs (world/props.ts). */
  get propStats(): Props['stats'] { return this.props.stats; }
  /** A drop pod's news (progression/pickups/pods.ts): the host's call and its end to everyone, a guest's share to the host. */
  sendPod(event: PodEvent, to?: string): void { this.pods.send(event, to); }
  /** Host: an ally fired. Guests draw the tracer; it hurts nothing there. */
  allyShot(from: THREE.Vector3, to: THREE.Vector3): void { this.garrison.allyShot(from, to); }
  selfDestruct(enemy: Enemy): void { this.hits.selfDestruct(enemy); }
  dispose(): void {
    for (const off of this.offSeats) off();
    this.w.dispose();
    this.team.dispose();
    this.mission.dispose();
    for (const module of this.modules) module.dispose?.();
  }
}
