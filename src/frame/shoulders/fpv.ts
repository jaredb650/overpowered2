/**
 * FPV Drone Hive shoulder plug-in (`fpv`).
 *
 *   Stock & rebuild   Holds up to 4 kamikaze quadcopters; rebuilds 1 every 4.0 s (even while parked).
 *   Launch            Press G / V / B to launch all ready drones staggered 0.15 s apart.
 *                     Hold the key so drones prefer alive enemies nearest the crosshair ray / sight point.
 *   Flight & combat   28 m/s cruise/dive, 60 m search radius, distinct target assignment (no stacking unless
 *                     fewer enemies exist), weaves slightly upward on launch then dives aggressively into
 *                     its target. Detonates on contact with target or obstacle: 4 m blast, 200 damage.
 *   Shootable         20 HP; enemy gunfire or nearby blasts destroy the drone mid-air in a spark pop
 *                     without triggering its warhead.
 *   Pool & co-op      Fixed pool of 4 active per mech and 16 globally across co-op (zero per-frame
 *                     allocations). Emits `'fpv'` MechKind news so teammates see pooled cosmetic drones.
 */
import * as THREE from 'three';
import { CG, type Ctx, type LoopHandle } from '../../core/contracts';
import type { EnemyInstance, ExplosionSpec } from '../../core/gameplay';
import { clamp, TAU } from '../../core/math';
import type { MechKind } from '../../progression/callins/link';
import type { GunnerWeapon } from '../../vehicles/hud';
import type { Projectile } from '../../weapons/Projectiles';
import { NEAR_SIGHT } from '../arms/shared';
import type { FrameShoulderWeapon, ShoulderPlugin, ShoulderUpdateContext } from './types';

export const FPV_MAX_STOCK = 4;
export const FPV_REBUILD_SECONDS = 4.0;
export const FPV_LAUNCH_STAGGER = 0.15;
export const FPV_MAX_PER_MECH = 4;
export const FPV_MAX_GLOBAL = 16;
export const FPV_SPEED = 28;
export const FPV_SEARCH_RADIUS = 60;
export const FPV_BLAST_RADIUS = 4;
export const FPV_BLAST_DAMAGE = 200;
export const FPV_DRONE_HP = 20;
const FPV_MAX_LIFETIME = 5.5;
const FPV_CONTACT_RADIUS = 0.95;
const FPV_HIT_RADIUS = 1.2;
const FPV_TURN_RATE = 10.5;
const FPV_CLIMB_TIME = 0.28;

const UP = new THREE.Vector3(0, 1, 0);
const FORWARD_Z = new THREE.Vector3(0, 0, -1);

// Scratch vectors — zero per-frame heap allocations.
const _mount = new THREE.Vector3();
const _right = new THREE.Vector3();
const _aimDir = new THREE.Vector3();
const _launchDir = new THREE.Vector3();
const _toTarget = new THREE.Vector3();
const _desired = new THREE.Vector3();
const _curDir = new THREE.Vector3();
const _nextPos = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _tmp2 = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _nearby: EnemyInstance[] = [];

const _blastSpec: ExplosionSpec = {
  radius: FPV_BLAST_RADIUS,
  damage: FPV_BLAST_DAMAGE,
  kind: 'grenade',
  source: 'frame_fpv',
  team: 'player',
  selfDamage: 0.25,
  playerPush: 0.35,
  scale: 0.85,
  shake: 0.35,
  mirrored: true,
};

const _remoteBlastSpec: ExplosionSpec = {
  radius: FPV_BLAST_RADIUS,
  damage: 0,
  kind: 'grenade',
  source: 'frame_fpv',
  team: 'player',
  selfDamage: 0,
  playerPush: 0,
  scale: 0.85,
  shake: 0.2,
  cosmetic: true,
};

// Shared pooled quadcopter visual geometry/materials (lazily built once).
interface DroneMeshRig {
  readonly group: THREE.Group;
  readonly rotors: readonly THREE.Mesh[];
}

interface SharedDroneAssets {
  bodyGeo: THREE.BufferGeometry;
  armGeo: THREE.BufferGeometry;
  warheadGeo: THREE.BufferGeometry;
  rotorGeo: THREE.BufferGeometry;
  ledGeo: THREE.BufferGeometry;
  bodyMat: THREE.MeshStandardMaterial;
  armMat: THREE.MeshStandardMaterial;
  rotorMat: THREE.MeshBasicMaterial;
  ledMat: THREE.MeshBasicMaterial;
}

let sharedAssets: SharedDroneAssets | null = null;

function getDroneAssets(): SharedDroneAssets {
  if (sharedAssets) return sharedAssets;
  const bodyGeo = new THREE.CylinderGeometry(0.11, 0.13, 0.08, 6);
  const armGeo = new THREE.BoxGeometry(0.46, 0.028, 0.04);
  const warheadGeo = new THREE.CylinderGeometry(0.055, 0.07, 0.2, 8);
  warheadGeo.rotateX(Math.PI / 2);
  const rotorGeo = new THREE.CylinderGeometry(0.11, 0.11, 0.012, 8);
  const ledGeo = new THREE.BoxGeometry(0.06, 0.036, 0.036);

  const bodyMat = new THREE.MeshStandardMaterial({ color: '#1b2028', metalness: 0.7, roughness: 0.4 });
  const armMat = new THREE.MeshStandardMaterial({ color: '#39414c', metalness: 0.75, roughness: 0.35 });
  const rotorMat = new THREE.MeshBasicMaterial({ color: '#9aa6b5', transparent: true, opacity: 0.55 });
  const ledMat = new THREE.MeshBasicMaterial({ color: '#ff2a1a', toneMapped: false, fog: false });

  sharedAssets = { bodyGeo, armGeo, warheadGeo, rotorGeo, ledGeo, bodyMat, armMat, rotorMat, ledMat };
  return sharedAssets;
}

function createDroneMeshRig(): DroneMeshRig {
  const a = getDroneAssets();
  const group = new THREE.Group();
  group.visible = false;

  const body = new THREE.Mesh(a.bodyGeo, a.bodyMat);
  group.add(body);

  const armA = new THREE.Mesh(a.armGeo, a.armMat);
  armA.rotation.y = Math.PI / 4;
  group.add(armA);

  const armB = new THREE.Mesh(a.armGeo, a.armMat);
  armB.rotation.y = -Math.PI / 4;
  group.add(armB);

  const warhead = new THREE.Mesh(a.warheadGeo, a.armMat);
  warhead.position.set(0, -0.06, -0.04);
  group.add(warhead);

  const led = new THREE.Mesh(a.ledGeo, a.ledMat);
  led.position.set(0, 0.01, -0.15);
  group.add(led);

  const rotors: THREE.Mesh[] = [];
  const off = 0.16;
  const coords: readonly (readonly [number, number])[] = [
    [-off, -off], [off, -off], [-off, off], [off, off],
  ];
  for (let i = 0; i < 4; i++) {
    const r = new THREE.Mesh(a.rotorGeo, a.rotorMat);
    r.position.set(coords[i]![0], 0.045, coords[i]![1]);
    group.add(r);
    rotors.push(r);
  }
  return { group, rotors };
}

export interface FpvDrone {
  active: boolean;
  cosmetic: boolean;
  owner: FpvHiveShoulder | null;
  ctx: Ctx | null;
  readonly pos: THREE.Vector3;
  readonly vel: THREE.Vector3;
  readonly targetPoint: THREE.Vector3;
  target: EnemyInstance | null;
  hp: number;
  age: number;
  weavePhase: number;
  bayIndex: number;
  rotorAngle: number;
  loop: LoopHandle | null;
  rig: DroneMeshRig | null;
}

function makeDroneSlot(): FpvDrone {
  return {
    active: false,
    cosmetic: false,
    owner: null,
    ctx: null,
    pos: new THREE.Vector3(),
    vel: new THREE.Vector3(),
    targetPoint: new THREE.Vector3(),
    target: null,
    hp: FPV_DRONE_HP,
    age: 0,
    weavePhase: 0,
    bayIndex: 0,
    rotorAngle: 0,
    loop: null,
    rig: null,
  };
}

/** Global 16-drone fixed pool shared across local and remote co-op Frames. */
const GLOBAL_POOL: readonly FpvDrone[] = Array.from({ length: FPV_MAX_GLOBAL }, makeDroneSlot);
let remoteStepAttachedCtx: Ctx | null = null;
const remotePreStep = (dt: number): void => {
  stepRemoteFpvDrones(dt);
};

/** Number of currently active drones across all Frames globally (cap 16). */
export function activeFpvDroneCount(): number {
  let n = 0;
  for (let i = 0; i < GLOBAL_POOL.length; i++) if (GLOBAL_POOL[i]!.active) n++;
  return n;
}

/** Read-only view of the global 16-drone pool (for inspection and tests). */
export function fpvDronePool(): readonly FpvDrone[] {
  return GLOBAL_POOL;
}

/** Resets all slots in the global 16-drone pool (stops audio loops, hides meshes). */
export function resetFpvGlobalPool(): void {
  for (let i = 0; i < GLOBAL_POOL.length; i++) retireDrone(GLOBAL_POOL[i]!);
  detachRemoteStepper();
}

function detachRemoteStepper(): void {
  if (remoteStepAttachedCtx?.physics?.preStep) {
    remoteStepAttachedCtx.physics.preStep.delete(remotePreStep);
  }
  remoteStepAttachedCtx = null;
}

function ensureRemoteStepper(ctx: Ctx): void {
  if (!ctx.physics?.preStep) return;
  if (remoteStepAttachedCtx === ctx) return;
  detachRemoteStepper();
  ctx.physics.preStep.add(remotePreStep);
  remoteStepAttachedCtx = ctx;
}

function countActiveForOwner(owner: FpvHiveShoulder): number {
  let n = 0;
  for (let i = 0; i < GLOBAL_POOL.length; i++) {
    const d = GLOBAL_POOL[i]!;
    if (d.active && d.owner === owner) n++;
  }
  return n;
}

function countActiveRemote(): number {
  let n = 0;
  for (let i = 0; i < GLOBAL_POOL.length; i++) {
    const d = GLOBAL_POOL[i]!;
    if (d.active && d.cosmetic) n++;
  }
  return n;
}

function acquireSlot(): FpvDrone | null {
  for (let i = 0; i < GLOBAL_POOL.length; i++) {
    if (!GLOBAL_POOL[i]!.active) return GLOBAL_POOL[i]!;
  }
  return null;
}

function attachRig(d: FpvDrone, ctx: Ctx): void {
  const scene = ctx.render?.scene;
  if (!scene) return;
  if (!d.rig) d.rig = createDroneMeshRig();
  if (d.rig.group.parent !== scene) scene.add(d.rig.group);
  d.rig.group.visible = true;
}

function syncRig(d: FpvDrone, dt: number): void {
  const rig = d.rig;
  if (!rig) return;
  rig.group.position.copy(d.pos);
  const spdSq = d.vel.lengthSq();
  if (spdSq > 1e-4) {
    _curDir.copy(d.vel).multiplyScalar(1 / Math.sqrt(spdSq));
    _quat.setFromUnitVectors(FORWARD_Z, _curDir);
    rig.group.quaternion.copy(_quat);
  }
  d.rotorAngle = (d.rotorAngle + dt * 48) % TAU;
  for (let i = 0; i < 4; i++) {
    rig.rotors[i]!.rotation.y = i % 2 === 0 ? d.rotorAngle : -d.rotorAngle;
  }
}

function stopDroneAudio(d: FpvDrone): void {
  if (d.loop) {
    d.loop.stop?.(0.05);
    d.loop = null;
  }
}

function retireDrone(d: FpvDrone): void {
  stopDroneAudio(d);
  if (d.rig) d.rig.group.visible = false;
  d.active = false;
  d.cosmetic = false;
  d.owner = null;
  d.ctx = null;
  d.target = null;
  d.hp = FPV_DRONE_HP;
  d.age = 0;
}

/** Destroys a drone mid-air with a crisp spark pop (no warhead blast). */
function shootDownDrone(d: FpvDrone): void {
  const ctx = d.ctx;
  if (ctx) {
    ctx.fx?.sparks?.(d.pos, UP, 14, 0xffaa30);
    ctx.fx?.smoke?.(d.pos, 0x333840, 0.55, 0.65);
    ctx.audio?.play?.('drone_crash', { position: d.pos, volume: 0.45, pitch: 1.7 });
  }
  retireDrone(d);
}

/** Detonates a drone's warhead (4 m, 200 damage) at `at`. */
function detonateDrone(d: FpvDrone, at: THREE.Vector3): void {
  const ctx = d.ctx;
  const cosmetic = d.cosmetic;
  stopDroneAudio(d);
  if (ctx) {
    if (cosmetic) {
      ctx.combat?.explode?.(at, _remoteBlastSpec);
    } else {
      ctx.combat?.explode?.(at, _blastSpec);
    }
  }
  retireDrone(d);
}

/** Applies direct damage to an active FPV drone; destroys it in a spark pop if HP reaches 0. */
export function damageFpvDrone(d: FpvDrone, amount: number): boolean {
  if (!d.active || amount <= 0) return false;
  d.hp -= amount;
  if (d.hp <= 0) {
    shootDownDrone(d);
    return true;
  }
  d.ctx?.fx?.sparks?.(d.pos, UP, 4, 0xffcc55);
  return false;
}

/** Damages any active FPV drones within `radius` m of `center` (e.g. nearby blasts). Returns count destroyed. */
export function damageFpvDronesInRadius(center: THREE.Vector3, radius: number, damage: number): number {
  if (radius <= 0 || damage <= 0) return 0;
  const r2 = radius * radius;
  let killed = 0;
  for (let i = 0; i < GLOBAL_POOL.length; i++) {
    const d = GLOBAL_POOL[i]!;
    if (!d.active || d.cosmetic) continue;
    if (d.pos.distanceToSquared(center) <= r2) {
      if (damageFpvDrone(d, damage)) killed++;
    }
  }
  return killed;
}

/** Checks a gunfire ray against active FPV drones; hits the nearest drone within `hitRadius`. Returns true if a drone was hit. */
export function damageFpvDroneRay(
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  maxDist: number,
  damage: number,
  hitRadius = FPV_HIT_RADIUS,
): boolean {
  let best: FpvDrone | null = null;
  let bestT = maxDist;
  const r2 = hitRadius * hitRadius;
  for (let i = 0; i < GLOBAL_POOL.length; i++) {
    const d = GLOBAL_POOL[i]!;
    if (!d.active || d.cosmetic) continue;
    _tmp.subVectors(d.pos, origin);
    const t = _tmp.dot(dir);
    if (t < 0 || t > bestT) continue;
    const perp2 = _tmp.lengthSq() - t * t;
    if (perp2 <= r2) {
      best = d;
      bestT = t;
    }
  }
  if (!best) return false;
  damageFpvDrone(best, damage);
  return true;
}

/** Counts how many other active drones currently target `uid`. */
function assignedCountFor(uid: number, ignore: FpvDrone | null): number {
  let c = 0;
  for (let i = 0; i < GLOBAL_POOL.length; i++) {
    const d = GLOBAL_POOL[i]!;
    if (d.active && !d.cosmetic && d !== ignore && d.target && d.target.alive && d.target.uid === uid) c++;
  }
  return c;
}

/** Collects candidate alive enemies within `FPV_SEARCH_RADIUS` into `_nearby` (zero allocation). */
function gatherEnemiesInRange(ctx: Ctx, origin: THREE.Vector3): number {
  _nearby.length = 0;
  const enemies = ctx.enemies;
  if (!enemies) return 0;
  const r2 = FPV_SEARCH_RADIUS * FPV_SEARCH_RADIUS;
  const alive = enemies.alive;
  if (alive && alive.length > 0) {
    for (let i = 0; i < alive.length; i++) {
      const e = alive[i]!;
      if (!e.alive) continue;
      if (e.center.distanceToSquared(origin) <= r2) _nearby.push(e);
    }
    return _nearby.length;
  }
  if (typeof enemies.query === 'function') {
    const n = enemies.query(origin, FPV_SEARCH_RADIUS, _nearby) || 0;
    if (_nearby.length > n) _nearby.length = n;
    return n;
  }
  return 0;
}

/**
 * Picks the best alive enemy within 60 m of `from`, strictly preferring untaken enemies (minimum active
 * assignment count) so drones spread across distinct targets. When `crosshair` is provided (shoulder key held),
 * prefers enemies closest to the crosshair ray / sight point.
 */
function pickDistinctTarget(
  ctx: Ctx,
  from: THREE.Vector3,
  self: FpvDrone | null,
  crosshair: { origin: THREE.Vector3; dir: THREE.Vector3; point: THREE.Vector3 } | null,
): EnemyInstance | null {
  const n = gatherEnemiesInRange(ctx, from);
  if (n === 0) return null;

  let best: EnemyInstance | null = null;
  let bestAssigned = Infinity;
  let bestScore = Infinity;

  for (let i = 0; i < n; i++) {
    const e = _nearby[i]!;
    if (!e.alive) continue;
    const assigned = assignedCountFor(e.uid, self);
    if (assigned > bestAssigned) continue;

    let score: number;
    if (crosshair) {
      const dPoint = e.center.distanceTo(crosshair.point);
      _tmp.subVectors(e.center, crosshair.origin);
      const t = _tmp.dot(crosshair.dir);
      if (t > 0) {
        const perp2 = Math.max(0, _tmp.lengthSq() - t * t);
        score = Math.sqrt(perp2) + dPoint * 0.15;
      } else {
        score = dPoint + 100;
      }
    } else {
      score = e.center.distanceTo(from);
    }

    if (assigned < bestAssigned || score < bestScore) {
      bestAssigned = assigned;
      bestScore = score;
      best = e;
    }
  }
  return best;
}

/** Checks active enemy projectiles passing near the drone (20 HP shootdown). */
function checkEnemyFireOnDrone(d: FpvDrone, dt: number): boolean {
  const combat = d.ctx?.combat as { projectiles?: { active?: readonly Projectile[] } } | undefined;
  const list = combat?.projectiles?.active;
  if (!list || list.length === 0) return false;
  const r2 = FPV_HIT_RADIUS * FPV_HIT_RADIUS;
  for (let i = 0; i < list.length; i++) {
    const p = list[i]!;
    if (!p.live || p.team !== 'enemy') continue;
    // Distance from drone to projectile's current segment.
    _tmp.subVectors(d.pos, p.position);
    const vLenSq = p.velocity.lengthSq();
    let d2: number;
    if (vLenSq > 1e-4) {
      const step = dt;
      const t = clamp(_tmp.dot(p.velocity) / (vLenSq * step + 1e-9), 0, 1);
      _tmp2.copy(p.position).addScaledVector(p.velocity, t * step);
      d2 = _tmp2.distanceToSquared(d.pos);
    } else {
      d2 = _tmp.lengthSq();
    }
    if (d2 <= r2) {
      const dmg = p.damage > 0 ? p.damage : FPV_DRONE_HP;
      if (p.kind === 'bullet') p.live = false;
      if (damageFpvDrone(d, dmg)) return true;
    }
  }
  return false;
}

/** Advances one active drone by `dt`. */
function stepDrone(
  d: FpvDrone,
  dt: number,
  crosshair: { origin: THREE.Vector3; dir: THREE.Vector3; point: THREE.Vector3 } | null,
): void {
  const ctx = d.ctx;
  if (!d.active || !ctx) return;

  d.age += dt;
  if (d.age >= FPV_MAX_LIFETIME) {
    detonateDrone(d, d.pos);
    return;
  }

  // Shootable check (20 HP against enemy gunfire / projectiles).
  if (!d.cosmetic && checkEnemyFireOnDrone(d, dt)) return;

  // Target maintenance for authoritative local drones.
  if (!d.cosmetic) {
    if (d.target && !d.target.alive) d.target = null;
    if (!d.target) {
      d.target = pickDistinctTarget(ctx, d.pos, d, crosshair);
    }
    if (d.target) {
      d.targetPoint.copy(d.target.center);
    }
  }

  // Compute desired heading: slight upward weave on launch, then aggressive dive into target.
  const speed = FPV_SPEED;
  const curLen = d.vel.length();
  if (curLen > 1e-4) _curDir.copy(d.vel).multiplyScalar(1 / curLen);
  else _curDir.set(0, 0, -1);

  const hasDest = d.cosmetic || d.target !== null;
  if (hasDest) {
    _toTarget.subVectors(d.targetPoint, d.pos);
    const dist = _toTarget.length();
    if (dist > 1e-4) _desired.copy(_toTarget).multiplyScalar(1 / dist);
    else _desired.copy(_curDir);

    if (d.age < FPV_CLIMB_TIME && dist > 6) {
      const lift = (1 - d.age / FPV_CLIMB_TIME) * 0.55;
      _desired.y += lift;
      _right.crossVectors(_desired, UP);
      if (_right.lengthSq() > 1e-4) {
        _right.normalize();
        const wobble = Math.sin(d.age * 16 + d.weavePhase) * 0.22 * (1 - d.age / FPV_CLIMB_TIME);
        _desired.addScaledVector(_right, wobble);
      }
      _desired.normalize();
    }
    // Smooth aggressive turn toward desired direction.
    const maxTurn = (dist < 10 ? FPV_TURN_RATE * 1.8 : FPV_TURN_RATE) * dt;
    const dot = clamp(_curDir.dot(_desired), -1, 1);
    const angle = Math.acos(dot);
    if (angle <= maxTurn || angle < 1e-4) {
      _curDir.copy(_desired);
    } else {
      const frac = maxTurn / angle;
      _curDir.lerp(_desired, frac).normalize();
    }
  }

  d.vel.copy(_curDir).multiplyScalar(speed);
  const stepDist = speed * dt;
  _nextPos.copy(d.pos).addScaledVector(_curDir, stepDist);

  // Check proximity / contact with target or enemies.
  if (hasDest) {
    // Closest point on this frame's segment to targetPoint.
    _tmp.subVectors(d.targetPoint, d.pos);
    const proj = clamp(_tmp.dot(_curDir), 0, stepDist);
    _tmp2.copy(d.pos).addScaledVector(_curDir, proj);
    if (_tmp2.distanceToSquared(d.targetPoint) <= FPV_CONTACT_RADIUS * FPV_CONTACT_RADIUS) {
      d.pos.copy(_tmp2);
      detonateDrone(d, d.pos);
      return;
    }
  }

  // Direct ray contact against any enemy in path (local authoritative drones).
  if (!d.cosmetic && ctx.enemies?.raycast) {
    const hit = ctx.enemies.raycast(d.pos, _curDir, stepDist + 0.35);
    if (hit && hit.enemy.alive) {
      d.pos.copy(hit.point);
      detonateDrone(d, d.pos);
      return;
    }
  }

  // Obstacle contact via world raycast.
  const wall = ctx.physics?.raycast?.(d.pos, _curDir, stepDist + 0.35, CG.World);
  if (wall) {
    d.pos.copy(wall.point);
    detonateDrone(d, d.pos);
    return;
  }

  d.pos.copy(_nextPos);
  syncRig(d, dt);
  if (d.loop) {
    d.loop.setPosition?.(d.pos);
    d.loop.setPitch?.(d.age > FPV_CLIMB_TIME ? 2.05 : 1.85);
  }
}

/** Steps all cosmetic remote FPV drones (co-op). */
export function stepRemoteFpvDrones(dt: number): void {
  if (dt <= 0) return;
  let remaining = 0;
  for (let i = 0; i < GLOBAL_POOL.length; i++) {
    const d = GLOBAL_POOL[i]!;
    if (!d.active || !d.cosmetic) continue;
    stepDrone(d, dt, null);
    if (d.active && d.cosmetic) remaining++;
  }
  if (remaining === 0) detachRemoteStepper();
}

export class FpvHiveShoulder implements FrameShoulderWeapon {
  readonly kind = 'fpv' as const;
  stock: number = FPV_MAX_STOCK;
  private rebuildIn = 0;
  private launchQueue = 0;
  private staggerIn = 0;
  private nextBay = 0;
  private unsubBlast: (() => void) | null = null;

  constructor(private readonly ctx: Ctx) {
    if (ctx.events && typeof ctx.events.on === 'function') {
      this.unsubBlast = ctx.events.on('world:explosion', e => {
        damageFpvDronesInRadius(e.position, e.radius, e.damage);
      });
    }
  }

  /** Number of currently active airborne drones belonging to this Frame. */
  get activeCount(): number {
    return countActiveForOwner(this);
  }

  /** Number of drones waiting in the staggered launch queue. */
  get queuedCount(): number {
    return this.launchQueue;
  }

  /** 0..1 rebuild progress for the next drone, or -1 when full. */
  get rebuildProgress(): number {
    return this.stock < FPV_MAX_STOCK ? clamp(1 - this.rebuildIn / FPV_REBUILD_SECONDS, 0, 1) : -1;
  }

  update(dt: number, u: ShoulderUpdateContext): void {
    this.tickRebuild(dt);

    // Handle press: queue up to all ready drones (capped by per-mech active limit 4).
    if (u.pressed) {
      if (!u.online || (this.stock <= 0 && this.launchQueue <= 0)) {
        this.ctx.audio?.play?.('weapon_dry');
      } else {
        const room = Math.max(0, FPV_MAX_PER_MECH - this.activeCount - this.launchQueue);
        const add = Math.min(this.stock - this.launchQueue, room);
        if (add > 0) {
          if (this.launchQueue === 0) this.staggerIn = 0;
          this.launchQueue += add;
        }
      }
    }

    const crosshair = u.held
      ? { origin: u.sight.view.position, dir: u.sight.aim, point: u.sight.point }
      : null;

    // Drain staggered launches (0.15 s apart).
    if (u.online && this.launchQueue > 0) {
      this.staggerIn -= dt;
      while (this.launchQueue > 0 && this.staggerIn <= 1e-6) {
        if (!this.launchOne(u, crosshair)) {
          // Pool or per-mech cap hit; drop remaining queue.
          this.launchQueue = 0;
          break;
        }
        this.launchQueue--;
        this.staggerIn = this.launchQueue > 0 ? this.staggerIn + FPV_LAUNCH_STAGGER : 0;
      }
    }

    // Step active drones owned by this Frame.
    this.stepOwnedDrones(dt, crosshair);
  }

  idleUpdate(dt: number): void {
    this.tickRebuild(dt);
    this.stepOwnedDrones(dt, null);
  }

  fillRow(row: GunnerWeapon, keyLabel: string, _cycleKeyLabel: string, online: boolean): void {
    row.max = FPV_MAX_STOCK;
    if (!online) {
      row.name = `${keyLabel} FPV HIVE // OFFLINE`;
      row.ammo = 0;
      row.reload = -1;
      return;
    }
    const live = this.activeCount;
    row.name = live > 0 ? `${keyLabel} FPV HIVE [${live} AIR]` : `${keyLabel} FPV HIVE`;
    row.ammo = this.stock;
    row.reload = this.rebuildProgress;
  }

  silence(): void {
    this.launchQueue = 0;
    this.staggerIn = 0;
    for (let i = 0; i < GLOBAL_POOL.length; i++) {
      const d = GLOBAL_POOL[i]!;
      if (d.active && d.owner === this) stopDroneAudio(d);
    }
  }

  reset(): void {
    this.launchQueue = 0;
    this.staggerIn = 0;
    this.stock = FPV_MAX_STOCK;
    this.rebuildIn = 0;
    this.nextBay = 0;
    for (let i = 0; i < GLOBAL_POOL.length; i++) {
      const d = GLOBAL_POOL[i]!;
      if (d.active && d.owner === this) retireDrone(d);
    }
  }

  dispose(): void {
    this.reset();
    this.unsubBlast?.();
    this.unsubBlast = null;
  }

  private tickRebuild(dt: number): void {
    if (this.stock >= FPV_MAX_STOCK) {
      this.rebuildIn = 0;
      return;
    }
    this.rebuildIn -= dt;
    while (this.rebuildIn <= 1e-6 && this.stock < FPV_MAX_STOCK) {
      this.stock++;
      this.rebuildIn = this.stock < FPV_MAX_STOCK ? this.rebuildIn + FPV_REBUILD_SECONDS : 0;
    }
  }

  private stepOwnedDrones(
    dt: number,
    crosshair: { origin: THREE.Vector3; dir: THREE.Vector3; point: THREE.Vector3 } | null,
  ): void {
    for (let i = 0; i < GLOBAL_POOL.length; i++) {
      const d = GLOBAL_POOL[i]!;
      if (d.active && d.owner === this) stepDrone(d, dt, crosshair);
    }
  }

  private launchOne(
    u: ShoulderUpdateContext,
    crosshair: { origin: THREE.Vector3; dir: THREE.Vector3; point: THREE.Vector3 } | null,
  ): boolean {
    if (this.stock <= 0) return false;
    if (this.activeCount >= FPV_MAX_PER_MECH) return false;
    const slot = acquireSlot();
    if (!slot) return false;

    const wasFull = this.stock === FPV_MAX_STOCK;
    this.stock--;
    if (wasFull) this.rebuildIn = FPV_REBUILD_SECONDS;

    const bay = this.nextBay++ % FPV_MAX_STOCK;
    u.mountPos(_mount);
    _right.crossVectors(u.sight.aim, UP);
    if (_right.lengthSq() < 1e-4) _right.set(1, 0, 0);
    else _right.normalize();

    const bx = (bay % 2 === 0 ? -0.26 : 0.26);
    const by = (bay < 2 ? 0.14 : -0.12);
    slot.pos.copy(_mount).addScaledVector(_right, bx);
    slot.pos.y += by;

    // Pick a distinct target within 60 m (biased toward crosshair when held).
    const target = pickDistinctTarget(this.ctx, slot.pos, slot, crosshair);
    slot.target = target;
    if (target) {
      slot.targetPoint.copy(target.center);
    } else if (u.sight.range > NEAR_SIGHT) {
      slot.targetPoint.copy(u.sight.point);
    } else {
      slot.targetPoint.copy(u.sight.view.position).addScaledVector(u.sight.aim, FPV_SEARCH_RADIUS);
    }

    // Launch heading: slightly upward and fanned laterally by bay so 4 drones peel out cleanly.
    _aimDir.subVectors(slot.targetPoint, slot.pos);
    if (_aimDir.lengthSq() > 1e-4) _aimDir.normalize();
    else _aimDir.copy(u.sight.aim).normalize();

    _launchDir.copy(_aimDir).addScaledVector(_right, bx * 0.65);
    _launchDir.y += 0.35;
    _launchDir.normalize();

    slot.active = true;
    slot.cosmetic = false;
    slot.owner = this;
    slot.ctx = this.ctx;
    slot.vel.copy(_launchDir).multiplyScalar(FPV_SPEED);
    slot.hp = FPV_DRONE_HP;
    slot.age = 0;
    slot.bayIndex = bay;
    slot.weavePhase = bay * 1.57;
    slot.rotorAngle = 0;

    attachRig(slot, this.ctx);
    syncRig(slot, 0);

    // Whining small fast propeller audio (cleaned up on silence / detonation / shootdown).
    slot.loop = this.ctx.audio?.startLoop?.('drone_rotor_loop', {
      position: slot.pos,
      volume: 0.42,
      pitch: 1.85 + bay * 0.05,
      doppler: true,
    }) ?? null;

    this.ctx.audio?.play?.('grenade_throw', { position: slot.pos, volume: 0.5, pitch: 1.65 });
    this.ctx.audio?.play?.('drone_alert', { position: slot.pos, volume: 0.32, pitch: 1.5 });
    this.ctx.fx?.sparks?.(slot.pos, _launchDir, 5, 0xff9933);
    this.ctx.fx?.smoke?.(slot.pos, 0x9aa2ab, 0.45, 0.5);

    // Co-op news: emit [mx, my, mz, tx, ty, tz] for teammates' screens.
    u.onNews?.('fpv', [
      slot.pos.x, slot.pos.y, slot.pos.z,
      slot.targetPoint.x, slot.targetPoint.y, slot.targetPoint.z,
    ]);
    return true;
  }
}

/** Spawns a cosmetic pooled FPV drone on teammates' screens when co-op `'fpv'` news arrives. */
function remoteFpvNews(ctx: Ctx, _kind: MechKind, values: number[]): void {
  if (values.length < 6) return;
  const slot = acquireSlot();
  if (!slot) return;

  slot.active = true;
  slot.cosmetic = true;
  slot.owner = null;
  slot.ctx = ctx;
  slot.pos.set(values[0]!, values[1]!, values[2]!);
  slot.targetPoint.set(values[3]!, values[4]!, values[5]!);
  slot.target = null;

  _launchDir.subVectors(slot.targetPoint, slot.pos);
  if (_launchDir.lengthSq() > 1e-4) _launchDir.normalize();
  else _launchDir.set(0, 0, -1);
  _launchDir.y += 0.3;
  _launchDir.normalize();

  slot.vel.copy(_launchDir).multiplyScalar(FPV_SPEED);
  slot.hp = FPV_DRONE_HP;
  slot.age = 0;
  slot.bayIndex = countActiveRemote() % FPV_MAX_STOCK;
  slot.weavePhase = slot.bayIndex * 1.57;
  slot.rotorAngle = 0;

  attachRig(slot, ctx);
  syncRig(slot, 0);

  slot.loop = ctx.audio?.startLoop?.('drone_rotor_loop', {
    position: slot.pos,
    volume: 0.36,
    pitch: 1.85,
    doppler: true,
  }) ?? null;
  ctx.audio?.play?.('grenade_throw', { position: slot.pos, volume: 0.45, pitch: 1.65 });
  ctx.fx?.sparks?.(slot.pos, _launchDir, 4, 0xff9933);

  ensureRemoteStepper(ctx);
}

export const FPV_PLUGIN: ShoulderPlugin = {
  kind: 'fpv',
  newsKinds: ['fpv'],
  create: ctx => new FpvHiveShoulder(ctx),
  remoteNews: remoteFpvNews,
};
