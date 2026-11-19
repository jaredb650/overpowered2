/**
 * The co-op world: what the rest of the game calls (`ctx.coop.world`). It holds no feature itself. Each feature is a module
 * under `world/` with its own state, its own events on the wire and its own handlers; this class builds them, runs them each
 * frame and hands calls on. The layout and how to add an event are in docs/notes/coop.md, "Code layout".
 */
import type * as THREE from 'three';
import type { Ctx, DamageInfo, ExplosionKind, PlayerDamage, PlayerSystem } from '../core/contracts';
import type { DamageResult, EnemyInstance, ExplosionSpec } from '../core/gameplay';
import type { Enemy } from '../enemies/Enemy';
import type { PlayerSense } from '../enemies/aiWorld';
import type { ClaimValidator } from './authority';
import type { CoopSession } from './index';
import { CoopMission } from './mission';
import { Team } from './team';
import { Allies } from './world/allies';
import { Booms } from './world/booms';
import { Callins } from './world/callins';
import { Capture } from './world/capture';
import { Chatter } from './world/chatter';
import { Claims, type StatusKind } from './world/claims';
import { Clock } from './world/clock';
import { WorldContext, type WorldModule } from './world/context';
import { EnemyFire } from './world/enemyFire';
import { Guns, type GunEvent } from './world/guns';
import { Hits } from './world/hits';
import { RemoteFire } from './world/remoteFire';
import { Replicas } from './world/replicas';
import { SharedSonar } from './world/sonar';
import { Targeting } from './world/targeting';
import { Vehicles } from './world/vehicles';

export class CoopWorld {
  readonly stats: WorldContext['stats'];
  readonly team: Team;
  readonly mission: CoopMission;
  readonly validator: ClaimValidator;
  private readonly w: WorldContext;
  private readonly enemies: Replicas;
  private readonly targeting: Targeting;
  private readonly shots: RemoteFire;
  private readonly claims: Claims;
  private readonly hits: Hits;
  private readonly enemyFire: EnemyFire;
  private readonly booms: Booms;
  private readonly guns: Guns;
  private readonly capture: Capture;
  private readonly vehicles: Vehicles;
  private readonly garrison: Allies;
  private readonly time: Clock;
  /** Run every frame in this order (`update`), and disposed in it. The snapshot goes out last. */
  private readonly modules: WorldModule[];

  constructor(private readonly ctx: Ctx, private readonly session: CoopSession) {
    const w = this.w = new WorldContext(ctx, session);
    this.stats = w.stats;
    this.validator = w.validator;
    this.team = w.team = new Team(ctx, session, (event, to) => w.send(event, to));
    // A mission's rides are everyone's: each guest's door gun counts through the host as a call-in.
    this.team.onArrived = id => { this.mission.catchUp(id); this.guns.catchUp(id); };
    this.mission = new CoopMission(ctx, session, (event, to) => w.send(event, to), this.team,
      () => { for (const p of session.lobby.players) if (!p.host) this.validator.callIn(p.id, performance.now()); });
    this.team.plug(w.router);
    this.mission.plug(w.router);
    // Each module adds its own game listeners and event handlers as it is built. Listeners on one game event run in the order
    // added: Hits must hear `enemy:killed` before any system does, which holds because the world is built before systems init.
    this.enemies = new Replicas(w);
    this.targeting = new Targeting(w);
    // Before RemoteFire: a shot's id moves on `weapon:fired`, and claims.ts must hear that first.
    this.claims = new Claims(w, this.enemies, this.targeting);
    this.shots = new RemoteFire(w);
    new Callins(w);
    // Sonar is shared; Thermal and Focus are each player's own and never sent.
    new SharedSonar(w);
    this.time = new Clock(w);
    this.hits = new Hits(w, this.enemies, this.claims);
    new Chatter(w, this.enemies);
    this.capture = new Capture(w, this.enemies);
    this.enemyFire = new EnemyFire(w, this.targeting);
    this.booms = new Booms(w, this.targeting);
    this.guns = new Guns(w);
    this.vehicles = new Vehicles(w);
    this.garrison = new Allies(w);
    this.modules = [this.capture, this.vehicles, this.garrison, this.targeting, this.claims, this.hits, w.later, this.enemies];
  }

  /** Read by the two-page proofs (tools/scripts/coop-*.mjs): the guest's enemy copies, last snapshot and garrison bodies. */
  get replicas(): Replicas['map'] { return this.enemies.map; }
  get receivedSeq(): number | null { return this.enemies.receivedSeq; }
  get allyBodies(): Allies['bodies'] { return this.garrison.bodies; }

  /** Host: the player the enemy being updated is after (EnemyManager reads and clears it). */
  get targetPlayer(): PlayerSystem | null { return this.targeting.targetPlayer; }
  set targetPlayer(player: PlayerSystem | null) { this.targeting.targetPlayer = player; }
  get receivingDamage(): boolean { return this.targeting.receivingDamage; }
  set receivingDamage(on: boolean) { this.targeting.receivingDamage = on; }

  /**
   * Not this player's: a kill (by uid) or a hit landed by a teammate. Score, combo, perks, kill pay and the run report skip it,
   * so each player's own browser pays and scores only what they did. Solo and guests' own replays read false.
   */
  notMine(enemy?: { uid: number }): boolean { return this.hits.notMine(enemy); }
  /** Before the clock ticks: the host keeps the slow-mo everyone shares, a guest keeps none (its world is the host's). */
  clock(): void { this.time.clock(); }
  begin(): void {
    this.w.ready = true;
    this.mission.begin();
    this.enemies.begin();
  }
  claim(enemy: EnemyInstance, damage: DamageInfo): DamageResult { return this.claims.claim(enemy, damage); }
  /** Guest: my weapon, call-in or perk set this enemy alight, froze it or left a live bolt in it (EnemyManager.afflict). */
  status(enemy: EnemyInstance, kind: StatusKind, seconds: number): void { this.claims.status(enemy, kind, seconds); }
  /** Guest: my round struck the shape of one of the host's vehicles (world/vehicles.ts `shapeOf`), on this part. */
  vehicleHit(id: number, part: string, point: THREE.Vector3, amount: number, source: string, kind?: ExplosionKind): void {
    this.claims.vehicleHit(id, part, point, amount, source, kind);
  }
  /** The shot id the local player's claims carry now (claims.ts), and on the host the claim being applied: whose, and its shot id. */
  get shot(): number { return this.claims.shot; }
  get applying(): string | null { return this.claims.applying; }
  get applyingShot(): number { return this.claims.applyingShot; }
  updateGuests(): void {
    const now = performance.now();
    this.vehicles.animate(now);
    this.enemies.animate(now);
  }
  select(enemy: Enemy, sense: PlayerSense): void { this.targeting.select(enemy, sense); }
  /** Every live player's eyes, for the host's fleeing men to run from (outpost/flight.ts). */
  playerEyes(): THREE.Vector3[] { return this.targeting.playerEyes(); }
  isRemoteTarget(): boolean { return this.targeting.isRemoteTarget(); }
  allowsLocalDamage(damage: PlayerDamage): boolean { return this.targeting.allowsLocalDamage(damage); }
  steer(enemy: Enemy, direction: THREE.Vector3): boolean { return this.targeting.steer(enemy, direction); }
  enemyRay(from: THREE.Vector3, to: THREE.Vector3, damage: number, source: string, trace = true): THREE.Vector3 | null {
    return this.enemyFire.enemyRay(from, to, damage, source, trace);
  }
  projectile(from: THREE.Vector3, dir: THREE.Vector3): void { this.enemyFire.projectile(from, dir); }
  blast(center: THREE.Vector3, spec: ExplosionSpec): void { this.booms.blast(center, spec); }
  update(): void {
    if (!this.w.ready) return;
    const now = performance.now();
    this.team.update(now, this.ctx.time.realDt);
    this.mission.update();
    for (const module of this.modules) module.update?.(now);
  }
  /** A dropped gun's news (weapons/dropped.ts): a guest's drop or take goes to the host, the host's word to everyone. */
  sendGun(event: GunEvent, to?: string): void { this.guns.send(event, to); }
  /** Host: an ally fired. Guests draw the tracer; it hurts nothing there. */
  allyShot(from: THREE.Vector3, to: THREE.Vector3): void { this.garrison.allyShot(from, to); }
  selfDestruct(enemy: Enemy): void { this.hits.selfDestruct(enemy); }
  dispose(): void {
    this.w.dispose();
    this.team.dispose();
    for (const module of this.modules) module.dispose?.();
  }
}
