/**
 * A guest's damage, as claims. A guest never hurts an enemy itself. Its game works out what it hit, as it does alone, and says
 * so: `hit` (damage on an enemy), `status` (fire, frost or a live bolt on an enemy) and `vhit` (a round or a blast on one of the
 * host's vehicles). The host checks each (authority.ts: favour the shooter) and applies it as that guest's own doing. What the
 * host's damage then did goes out from hits.ts (`hitfx`, `sever`, `kill`), which reads here whose claim is being applied
 * (`applying`, `applyingShot`) and who last hit an enemy (`lastHit`).
 *
 * A claim names its shot: `shot` is the shooter's own count of shots, swings and bursts, and `at` their clock when it was
 * claimed. The host's rate check runs on those, never on when the message happened to arrive. No claim ever makes up a `fire`
 * event: what the other players see and hear of a shot is remoteFire.ts's business alone.
 */
import * as THREE from 'three';
import { CG, type DamageInfo, type ExplosionKind } from '../../core/contracts';
import type { DamageResult, EnemyInstance, ExplosionSpec } from '../../core/gameplay';
import type { Enemy } from '../../enemies/Enemy';
import type { Vehicle } from '../../enemies/vehicles/vehicle';
import { EXPLOSIONS, bossHit } from '../../weapons/data';
import { claimClass, limitsOf, type RejectReason } from '../authority';
import { unpackDamage, type WorldContext, type WorldModule } from './context';
import type { Replicas } from './replicas';
import type { Targeting } from './targeting';
import { VehicleHits } from './vehicleHits';
import type { Vehicles } from './vehicles';
import { ENEMY_IDS, packDamage, type Vec, type WireDamage } from './wire';

/**
 * Guest to host: my shot `shot` hit enemy `target` like this. `at` is my clock (ms) when I claimed it, `origin` my eye then.
 * `hop`: the round did not come straight from my eye (a ricochet, a hop off another body, an arc, a fragment, a wall it went
 * through), so there is no straight line to test. `weapon` is the gun in my hands, for what it is worth: a round in flight
 * lands after a swap, and the host goes by `damage.source`.
 */
export interface HitClaim { t: 'hit'; shot: number; at?: number; target: number; weapon: string; origin: Vec; damage: WireDamage; hop?: 1 }
/** Guest to host: my weapon, call-in or perk set enemy `uid` alight, froze it, or left a live bolt in it, for `s` seconds. */
export interface StatusClaim { t: 'status'; uid: number; kind: StatusKind; s: number; at?: number }
export type StatusKind = 'burn' | 'freeze' | 'bolt';
/**
 * Guest to host: my round struck vehicle `id` on `part` at `point` (`kind`: a shaped charge's direct hit), or, with `radius`, my
 * blast went off at `point` and reaches every vehicle in it. Vehicles live on the host; a guest only has their shapes.
 */
export interface VehicleClaim { t: 'vhit'; id: number; part?: string; point: Vec; amount: number; source: string; at?: number; kind?: string; radius?: number; inst?: 1 }
export type ClaimEvent = HitClaim | StatusClaim | VehicleClaim;

/** A shot id is stale once nothing has fired for this long: the next claim (a round landing, a beam still on) starts a new one. */
const STALE_MS = 100;
/** Host: each enemy's centre is noted this often, this many times back (two seconds), for a hit on where he was (authority.ts `near`). */
const TRAIL_MS = 100, TRAIL = 20;
/** A status that is renewed every tick (standing in napalm) is sent this often at most, and once more when it stops. */
const STATUS_MS = 250;
/** Past this angle between the round's own direction and the line from the eye, the hit did not come straight from the eye. */
const STRAIGHT_COS = Math.cos(12 * Math.PI / 180);

const NOTHING: DamageResult = { dealt: 0, blocked: false, killed: false, headshot: false, severed: [] };
const _from = new THREE.Vector3(), _dir = new THREE.Vector3();

/** What the host's vehicles do for a guest's claim (enemies/vehicles/index.ts). */
interface VehicleBridge {
  /** A guest's round on this vehicle, as the host's own would land, without the host's hit marker. `point` is in the vehicle's frame. */
  claimed(vehicle: Vehicle, part: string | undefined, point: THREE.Vector3, amount: number, source: string, kind?: ExplosionKind): boolean;
  blast(center: THREE.Vector3, spec: ExplosionSpec): number;
}

export class Claims implements WorldModule {
  /** The local player's latest shot id: counts shots, swings and bursts from 1. A claim carries it; gore matches answers by it. */
  shot = 0;
  /** Every refused claim by reason, as the validator counted it, plus `gone` (the enemy was already dead on the host). */
  readonly refused: Partial<Record<RejectReason | 'gone', number>>;
  /** Guest: the hit boxes of the host's vehicles, and what lands on them (vehicleHits.ts). Run and cleared with this module. */
  readonly vehicleHits: VehicleHits;
  /** Guest: claims sent, by kind, for the proofs. */
  readonly sent = { hit: 0, status: 0, vhit: 0 };
  /** Host: the last player to land a claim on each enemy, for a kill by bleeding or fire after the hit. */
  private readonly lastHitter = new Map<number, string>();
  /** Host: the guest whose claim is being applied right now (lobby id), and its shot. */
  private current: string | null = null;
  private currentShot = 0;
  /** Host: where each enemy's centre has been lately, as x, y, z triples in a ring. */
  private readonly trails = new Map<number, { at: Float32Array; count: number; next: number }>();
  private trailAt = -Infinity;
  /** Guest: when the shot id last moved, and the frame's clock when it was last used. */
  private bumpedAt = -Infinity;
  /** Guest: statuses lately sent, by enemy and kind, with what is still owed (`pending` seconds, 0 for none). */
  private readonly statuses = new Map<string, { sentAt: number; uid: number; kind: StatusKind; pending: number }>();

  constructor(private readonly w: WorldContext, private readonly replicas: Replicas, private readonly targeting: Targeting, private readonly vehicles: Vehicles) {
    this.refused = w.validator.refused;
    this.vehicleHits = new VehicleHits(w, vehicles, this);
    // Every real shot and swing is a new shot id. Heard before remoteFire.ts hears it (this module is built first).
    w.listen('weapon:fired', () => this.next(performance.now()));
    w.router.host('hit', (value, from, now) => this.hitIn(value, from, now));
    w.router.host('status', (value, from, now) => this.statusIn(value, from, now));
    w.router.host('vhit', (value, from, now) => this.vhitIn(value, from, now));
    w.snapshotSent.push(alive => {
      for (const uid of this.lastHitter.keys()) if (!alive.has(uid)) this.lastHitter.delete(uid);
      for (const uid of this.trails.keys()) if (!alive.has(uid)) this.trails.delete(uid);
    });
  }

  /** Host: a guest set this enemy burning or freezing (no hit event says so): credit.ts keeps who, for the kill it may cause. */
  onStatus: (uid: number, from: string) => void = () => {};
  /** Host: the guest whose claim is being applied right now (lobby id), or null. */
  get applying(): string | null { return this.current; }
  /** Host: the shot id of the claim being applied right now (that guest's own count), 0 when none is. */
  get applyingShot(): number { return this.current === null ? 0 : this.currentShot; }
  /** Host: the last guest to land a claim on this enemy (lobby id). */
  lastHit(uid: number): string | undefined { return this.lastHitter.get(uid); }

  private next(now: number): number {
    this.bumpedAt = now;
    return ++this.shot;
  }

  // -------------------------------------------------------------------------------------------
  // Guest: saying what I hit
  // -------------------------------------------------------------------------------------------

  /** Guest: the local player's damage on an enemy becomes a claim; the result is a guess at what the host will say. */
  claim(enemy: EnemyInstance, damage: DamageInfo): DamageResult {
    const { ctx } = this.w;
    if (ENEMY_IDS.some(id => id === damage.source) || ['bleed', 'hazard', 'trample', 'coop'].includes(damage.source)) return NOTHING;
    const now = performance.now();
    // A round that lands long after its shot, or a beam that is still on, with nothing fired since: its own shot.
    if (now - this.bumpedAt > STALE_MS) this.next(now);
    const eye = ctx.player.eye;
    const claim: HitClaim = { t: 'hit', shot: this.shot, at: Math.round(now), target: enemy.uid, weapon: ctx.weapons.current,
      origin: eye.toArray() as Vec, damage: packDamage(damage) };
    if (this.bent(eye, damage)) claim.hop = 1;
    this.w.send(claim);
    this.sent.hit++;
    const body = enemy as Enemy;
    const region = damage.region ?? 'chest';
    const facing = Math.sin(enemy.yaw) * damage.dir.x + Math.cos(enemy.yaw) * damage.dir.z;
    const shield = body.shield && facing <= -0.35 && !['armR', 'forearmR', 'shinL', 'shinR'].includes(region);
    const plate = body.plates.find(plate => plate.hp > 0 && plate.spec.regions.includes(region)
      && (!plate.spec.facing || (facing > 0) === (plate.spec.facing === 'back')));
    const flags = this.replicas.flags(enemy.uid);
    const armoured = !!plate || shield || (flags & 96) !== 0;
    const blocked = (flags & 96) !== 0 || (shield && !damage.armorPiercing)
      || (!!plate && !damage.pierces && !damage.armorPiercing && !['ap', 'api', 'flechette'].includes(damage.load!));
    return { dealt: blocked ? 0 : damage.amount, blocked, killed: false, headshot: damage.region === 'head', severed: [], armour: armoured ? blocked ? 'stopped' : 'through' : undefined };
  }

  /**
   * True when a gun's round did not reach the enemy straight from my eye: it came from another direction (a ricochet, a hop
   * off a body, an arc, a fragment) or my own world has a wall on that line (a round that goes through walls). The host then
   * has no straight line to test, and does not.
   */
  private bent(eye: THREE.Vector3, damage: DamageInfo): boolean {
    const kind = claimClass(damage.source, damage.type);
    if ((kind !== 'gun' && kind !== 'mounted' && kind !== 'other') || limitsOf(damage.source)?.pierces) return false;
    const range = _dir.subVectors(damage.point, eye).length();
    if (range < 2) return false;
    _dir.divideScalar(range);
    if (_dir.dot(damage.dir) < STRAIGHT_COS * damage.dir.length()) return true;
    return !!this.w.ctx.physics.raycast(_from.copy(eye), _dir, Math.max(0, range - 1), CG.World);
  }

  /**
   * Guest: my weapon, call-in or perk set this enemy alight, froze it or put a live bolt in it (EnemyManager.afflict, which has
   * already marked my own copy). A status renewed every tick goes out every `STATUS_MS` and once more when it stops.
   */
  status(enemy: EnemyInstance, kind: StatusKind, seconds: number): void {
    if (this.w.hosting || !(seconds > 0)) return;
    const now = performance.now();
    const key = `${kind}:${enemy.uid}`;
    const last = this.statuses.get(key);
    if (last && now - last.sentAt < STATUS_MS) { last.pending = Math.max(last.pending, seconds); return; }
    if (last) { last.sentAt = now; last.pending = 0; } else this.statuses.set(key, { sentAt: now, uid: enemy.uid, kind, pending: 0 });
    this.w.send({ t: 'status', uid: enemy.uid, kind, s: seconds, at: Math.round(now) });
    this.sent.status++;
  }

  /** Guest: my round struck one of the host's vehicles (its shape on my screen), on this part, at `point` in the vehicle's own frame. */
  vehicleHit(id: number, part: string, point: THREE.Vector3, amount: number, source: string, kind?: ExplosionKind): void {
    if (this.w.hosting || !(amount > 0)) return;
    this.w.send({ t: 'vhit', id, part, point: point.toArray() as Vec, amount: Math.min(amount, 1e9), source, at: Math.round(performance.now()), ...(kind ? { kind } : {}) });
    this.sent.vhit++;
  }

  /** Guest: my explosion went off where the host's vehicles may stand. The host works out which it reaches. */
  vehicleBlast(center: THREE.Vector3, spec: ExplosionSpec): void {
    if (this.w.hosting || spec.team !== 'player' || !(spec.damage > 0 || spec.instakill)) return;
    this.w.send({ t: 'vhit', id: 1, point: center.toArray() as Vec, amount: Math.max(1, Math.min(spec.damage, 1e9)), source: spec.source, at: Math.round(performance.now()),
      kind: spec.kind, radius: spec.radius, ...(spec.instakill ? { inst: 1 as const } : {}) });
    this.sent.vhit++;
  }

  // -------------------------------------------------------------------------------------------
  // Host: checking and applying
  // -------------------------------------------------------------------------------------------

  private refuse(why: 'gone'): void {
    this.refused[why] = (this.refused[why] ?? 0) + 1;
  }

  /** Host: a guest's claim, checked and applied as that guest's damage. */
  private hitIn(value: HitClaim, from: string, now: number): void {
    const { ctx, stats, session } = this.w;
    const remote = this.w.sender(from, now);
    if (!remote) return;
    const enemy = Number.isSafeInteger(value?.target) ? ctx.enemies.alive.find(enemy => enemy.uid === value.target) as Enemy | undefined : undefined;
    // Dead on the host before the claim got here: nobody lost a hit, the man was already down.
    if (!enemy) { this.refuse('gone'); return; }
    const root = remote.char.root.position;
    const verdict = this.w.validator.check(from, value, now, {
      eye: [root.x, root.y + 1.6, root.z], target: enemy.center.toArray() as Vec, size: enemy.char.rig.height, speed: enemy.velocity.length(),
      ping: session.lobby.pingOf(from), down: this.w.life(from).down, visible: (origin, target) => this.w.visible(origin, target),
      near: point => this.nearTrail(enemy.uid, point),
    });
    if (!verdict.ok) { stats.rejected++; return; }
    stats.accepted++;
    const damage = unpackDamage(value.damage);
    if (damage.bone !== undefined && damage.bone >= enemy.char.rig.bones.length) damage.bone = undefined;
    damage.amount = bossHit(enemy.isBoss, damage.amount);
    this.targeting.targetPlayer = this.targeting.players().find(player => player.id === from)?.player ?? ctx.player;
    this.lastHitter.set(enemy.uid, from);
    this.current = from;
    this.currentShot = value.shot;
    try { this.w.manager.applyDamage(enemy, damage); }
    finally { this.targeting.targetPlayer = null; this.current = null; }
  }

  /** Host: a guest's fire, frost or bolt on an enemy, applied as the host's own weapon would. */
  private statusIn(value: StatusClaim, from: string, now: number): void {
    if (!this.w.sender(from, now)) return;
    const enemy = Number.isSafeInteger(value?.uid) ? this.w.ctx.enemies.alive.find(enemy => enemy.uid === value.uid) : undefined;
    if (!enemy) { this.refuse('gone'); return; }
    const seconds = this.w.validator.status(from, value, now);
    if (seconds === null) { this.w.stats.rejected++; return; }
    this.w.stats.accepted++;
    this.lastHitter.set(enemy.uid, from);
    this.onStatus(enemy.uid, from);
    this.w.manager.afflict(enemy, value.kind, seconds);
  }

  /** Host: a guest's round or blast on the vehicles, applied as the host's own would be. */
  private vhitIn(value: VehicleClaim, from: string, now: number): void {
    const { ctx, stats } = this.w;
    if (!this.w.sender(from, now)) return;
    if (!this.w.validator.vehicle(from, value, now)) { stats.rejected++; return; }
    const vehicles = ctx.enemies.vehicles as unknown as VehicleBridge | null | undefined;
    if (!vehicles) { this.refuse('gone'); return; }
    const point = new THREE.Vector3(...value.point);
    const kind = value.kind !== undefined && Object.hasOwn(EXPLOSIONS, value.kind) ? value.kind as ExplosionKind : undefined;
    if (value.radius !== undefined) {
      if (!kind) { stats.rejected++; return; }
      stats.accepted++;
      vehicles.blast(point, { radius: value.radius, damage: Math.min(value.amount, 20000), kind, source: value.source, team: 'player', instakill: value.inst === 1 || undefined });
      return;
    }
    const vehicle = this.vehicles.find(value.id);
    // Wrecked on the host before the claim got here.
    if (vehicle && vehicles.claimed(vehicle, value.part, point, value.amount, value.source, kind)) stats.accepted++;
    else this.refuse('gone');
  }

  /** Host: metres from `point` to the nearest place this enemy's centre has been in the last two seconds. */
  private nearTrail(uid: number, point: Vec): number {
    const trail = this.trails.get(uid);
    let best = Infinity;
    if (trail) for (let i = 0; i < trail.count; i++) {
      best = Math.min(best, Math.hypot(trail.at[i * 3]! - point[0], trail.at[i * 3 + 1]! - point[1], trail.at[i * 3 + 2]! - point[2]));
    }
    return best;
  }

  update(now: number): void {
    if (this.w.hosting) {
      if (now - this.trailAt < TRAIL_MS) return;
      this.trailAt = now;
      for (const enemy of this.w.ctx.enemies.alive) {
        let trail = this.trails.get(enemy.uid);
        if (!trail) this.trails.set(enemy.uid, trail = { at: new Float32Array(TRAIL * 3), count: 0, next: 0 });
        const center = (enemy as Enemy).center;
        trail.at[trail.next * 3] = center.x; trail.at[trail.next * 3 + 1] = center.y; trail.at[trail.next * 3 + 2] = center.z;
        trail.next = (trail.next + 1) % TRAIL;
        trail.count = Math.min(TRAIL, trail.count + 1);
      }
      return;
    }
    this.vehicleHits.update();
    // What a throttled status still owes: the last word on how long it burns.
    for (const [key, entry] of this.statuses) {
      if (now - entry.sentAt < STATUS_MS) continue;
      if (entry.pending > 0) {
        this.w.send({ t: 'status', uid: entry.uid, kind: entry.kind, s: entry.pending, at: Math.round(now) });
        this.sent.status++;
        entry.sentAt = now;
        entry.pending = 0;
      } else if (now - entry.sentAt > 5000) this.statuses.delete(key);
    }
  }

  dispose(): void {
    this.vehicleHits.dispose();
  }
}
