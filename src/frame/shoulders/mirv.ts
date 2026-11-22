/**
 * MIRV Launcher shoulder plug-in (`MIRV_PLUGIN`).
 *
 * Hold shoulder key (G / V / B) to project a glowing ground target marker up to 200 m.
 * Release to launch a heavy MIRV bus straight UP to +70 m apex, pitch over into a steep top-attack dive,
 * and split at 25 m above the marker into 8 homing sub-missiles (5 m blast, 220 dmg each, 11 s reload).
 */
import * as THREE from 'three';
import { CG, type Ctx } from '../../core/contracts';
import type { EnemyInstance, MissileTarget, ProjectileSpec } from '../../core/gameplay';
import { TAU } from '../../core/math';
import { GroundRing } from '../../progression/callins/ground';
import type { MechKind } from '../../progression/callins/link';
import type { GunnerWeapon } from '../../vehicles/hud';
import type { FrameShoulderWeapon, ShoulderPlugin, ShoulderUpdateContext } from './types';

export const MIRV = {
  maxRange: 200,
  climbHeight: 70,
  splitHeight: 25,
  subCount: 8,
  acquireRadius: 22,
  maxPerEnemy: 2,
  ringRadius: 8,
  subBlastRadius: 5,
  subDamage: 220,
  reload: 11,
  climbSpeed: 58,
  diveSpeed: 76,
  subLaunchSpeed: 36,
  subTopSpeed: 56,
  subAccel: 34,
  subTurnRate: 10.5,
  subSteerDelay: 0.12,
  subLifetime: 4.5,
} as const;

const GROUND_NORMAL = 0.35;
const MAX_BUSES = 2;
const RING_TARGET_POOL_SIZE = 32;
const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);

const _launch = new THREE.Vector3();
const _from = new THREE.Vector3();
const _prev = new THREE.Vector3();
const _tan = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _fan = new THREE.Vector3();
const _v = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _queryScratch: EnemyInstance[] = [];
const _vehicleScratch: MissileTarget[] = [];
const _eligible: { target: MissileTarget; d2: number }[] = [];

export type MirvBusPhase = 'idle' | 'climb' | 'dive';

export interface MirvBusState {
  live: boolean;
  phase: MirvBusPhase;
  readonly pos: THREE.Vector3;
  readonly vel: THREE.Vector3;
  readonly target: THREE.Vector3;
  readonly diveStart: THREE.Vector3;
  readonly diveCtrl: THREE.Vector3;
  apexY: number;
  diveU: number;
  smokeClock: number;
  mesh: THREE.Group | null;
}

export interface MirvAssignment {
  /** Assigned alive enemy/vehicle, or null when landing on a ring ground point. */
  enemy: MissileTarget | null;
  /** World-space landing point (enemy center or ring ground point). */
  point: THREE.Vector3;
}

/** Module-level pooled ring targets for co-op remote playback (never allocates in hot path). */
const _remoteRingTargets: { center: THREE.Vector3; alive: boolean }[] = Array.from(
  { length: RING_TARGET_POOL_SIZE },
  () => ({ center: new THREE.Vector3(), alive: true }),
);
let _remoteRingCursor = 0;

function allocRemoteTarget(x: number, y: number, z: number): MissileTarget {
  const slot = _remoteRingTargets[_remoteRingCursor++ % RING_TARGET_POOL_SIZE]!;
  slot.center.set(x, y, z);
  slot.alive = true;
  return slot;
}

function makeSubMissileSpec(cosmetic: boolean): ProjectileSpec {
  return {
    origin: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    kind: 'rocket',
    team: 'player',
    damage: MIRV.subDamage,
    source: 'frame_mirv',
    trail: 'swarm',
    gib: true,
    severMult: 1,
    force: 95,
    turnRate: MIRV.subTurnRate,
    steerDelay: MIRV.subSteerDelay,
    weave: 0.03,
    accel: MIRV.subAccel,
    topSpeed: MIRV.subTopSpeed,
    size: 0.78,
    lifetime: MIRV.subLifetime,
    target: null,
    ghost: cosmetic || undefined,
    explosion: {
      radius: MIRV.subBlastRadius,
      damage: MIRV.subDamage,
      kind: 'rocket',
      selfDamage: 0.35,
      playerPush: 12,
      scale: 1.05,
      shake: 0.45,
      cosmetic: cosmetic || undefined,
      mirrored: true,
    },
  };
}

const _remoteBusSpec: ProjectileSpec = {
  origin: new THREE.Vector3(),
  velocity: new THREE.Vector3(),
  kind: 'rocket',
  team: 'player',
  damage: 0,
  source: 'frame_mirv',
  trail: 'big',
  turnRate: 3.4,
  steerDelay: 1.15,
  weave: 0,
  size: 1.9,
  lifetime: 3.2,
  target: null,
  ghost: true,
};
const _remoteSubSpec: ProjectileSpec = makeSubMissileSpec(true);

/**
 * Resolves the MIRV ground marker along `(origin, aim)` up to `maxRange` m (`200 m`).
 * Returns false when aiming at open sky or beyond range.
 */
export function solveMirvMarker(
  physics: Ctx['physics'],
  origin: THREE.Vector3,
  aim: THREE.Vector3,
  out: THREE.Vector3,
  maxRange: number = MIRV.maxRange,
): boolean {
  const hit = physics.raycast(origin, aim, maxRange, CG.World);
  if (!hit) return false;
  if (hit.normal.y >= GROUND_NORMAL) {
    out.copy(hit.point);
    return true;
  }
  _from.copy(hit.point).addScaledVector(hit.normal, 0.6);
  const floor = physics.raycast(_from, DOWN, 120, CG.World);
  out.copy(floor ? floor.point : hit.point);
  return true;
}

/**
 * Assigns `count` (8) MIRV sub-missiles to alive candidates within `radius` (22 m) of `marker`:
 * round-robin across different targets up to `maxPerEnemy` (2) per target, with any remaining
 * sub-missiles (or all 8 when 0 enemies are present) distributed evenly in a clean ring around `marker`.
 */
export function assignMirvTargets(
  candidates: readonly MissileTarget[],
  marker: THREE.Vector3,
  count: number = MIRV.subCount,
  radius: number = MIRV.acquireRadius,
  maxPerEnemy: number = MIRV.maxPerEnemy,
  ringRadius: number = MIRV.ringRadius,
): MirvAssignment[] {
  const r2 = radius * radius;
  _eligible.length = 0;
  for (let i = 0; i < candidates.length; i++) {
    const t = candidates[i]!;
    if (!t.alive) continue;
    const dx = t.center.x - marker.x;
    const dz = t.center.z - marker.z;
    const dy = Math.abs(t.center.y - marker.y);
    const h2 = dx * dx + dz * dz;
    if (h2 <= r2 && dy <= radius) {
      _eligible.push({ target: t, d2: h2 + dy * dy });
    }
  }
  _eligible.sort((a, b) => a.d2 - b.d2);

  const out: MirvAssignment[] = [];
  for (let pass = 0; pass < maxPerEnemy && out.length < count; pass++) {
    for (let i = 0; i < _eligible.length && out.length < count; i++) {
      const t = _eligible[i]!.target;
      out.push({ enemy: t, point: t.center.clone() });
    }
  }
  const rem = count - out.length;
  for (let i = 0; i < rem; i++) {
    const a = (i / rem) * TAU;
    out.push({
      enemy: null,
      point: new THREE.Vector3(marker.x + Math.cos(a) * ringRadius, marker.y, marker.z + Math.sin(a) * ringRadius),
    });
  }
  _eligible.length = 0;
  return out;
}

/** Builds a lightweight reusable MIRV bus missile visual mesh (nose along +Y). */
function createBusMesh(): THREE.Group {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: '#2b313a', metalness: 0.72, roughness: 0.42, flatShading: true });
  const noseMat = new THREE.MeshStandardMaterial({ color: '#586270', metalness: 0.65, roughness: 0.38, flatShading: true });
  const bandMat = new THREE.MeshStandardMaterial({ color: '#a5894b', metalness: 0.8, roughness: 0.32, flatShading: true });
  const flareMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color('#ff9a2e').multiplyScalar(5.0),
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });

  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.20, 1.35, 8), bodyMat);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.52, 8), noseMat);
  nose.position.y = 0.93;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.09, 8), bandMat);
  band.position.y = 0.48;
  const flare = new THREE.Mesh(new THREE.ConeGeometry(0.20, 1.35, 8), flareMat);
  flare.rotation.x = Math.PI;
  flare.position.y = -1.32;
  g.add(body, nose, band, flare);

  for (let i = 0; i < 4; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.34, 0.24), noseMat);
    const a = (i * Math.PI) / 2;
    fin.position.set(Math.sin(a) * 0.22, -0.48, Math.cos(a) * 0.22);
    fin.rotation.y = a;
    g.add(fin);
  }
  g.visible = false;
  return g;
}

/** Evaluates quadratic Bezier position `out` and derivative `tanOut` at parameter `u`. */
function evalDiveCurve(
  p0: THREE.Vector3,
  p1: THREE.Vector3,
  p2: THREE.Vector3,
  u: number,
  out: THREE.Vector3,
  tanOut: THREE.Vector3,
): void {
  const m = 1 - u;
  const m2 = m * m;
  const um2 = 2 * m * u;
  const u2 = u * u;
  out.set(
    m2 * p0.x + um2 * p1.x + u2 * p2.x,
    m2 * p0.y + um2 * p1.y + u2 * p2.y,
    m2 * p0.z + um2 * p1.z + u2 * p2.z,
  );
  tanOut.set(
    2 * m * (p1.x - p0.x) + 2 * u * (p2.x - p1.x),
    2 * m * (p1.y - p0.y) + 2 * u * (p2.y - p1.y),
    2 * m * (p1.z - p0.z) + 2 * u * (p2.z - p1.z),
  );
}

/** Gathers alive enemies (and paintable vehicles if available) within `MIRV.acquireRadius` of `marker`. */
function gatherNearbyTargets(ctx: Ctx, marker: THREE.Vector3): MissileTarget[] {
  const list: MissileTarget[] = [];
  const enemies = ctx.enemies;
  if (enemies) {
    if (typeof enemies.query === 'function') {
      const n = enemies.query(marker, MIRV.acquireRadius + 2, _queryScratch) || 0;
      for (let i = 0; i < n; i++) {
        const e = _queryScratch[i]!;
        if (e.alive) list.push(e);
      }
      _queryScratch.length = 0;
    } else if (Array.isArray(enemies.alive)) {
      for (let i = 0; i < enemies.alive.length; i++) {
        const e = enemies.alive[i]!;
        if (e.alive) list.push(e);
      }
    }
    const v = enemies.vehicles;
    if (v && typeof v.paintable === 'function') {
      const m = v.paintable(_vehicleScratch);
      for (let i = 0; i < m; i++) {
        const veh = _vehicleScratch[i]!;
        if (veh.alive) list.push(veh);
      }
      _vehicleScratch.length = 0;
    }
  }
  return list;
}

/** Probes ground height beneath `(x, y, z)` so ring sub-missiles dive cleanly into the floor. */
function probeFloorY(ctx: Ctx, x: number, y: number, z: number): number {
  if (!ctx.physics?.raycast) return y;
  _from.set(x, y + 12, z);
  const hit = ctx.physics.raycast(_from, DOWN, 48, CG.World);
  return hit ? hit.point.y : y;
}

/** Spawns the 8 homing sub-missiles from `splitPos` onto enemies/ring around `marker`. */
function spawnSubMissiles(
  ctx: Ctx,
  splitPos: THREE.Vector3,
  marker: THREE.Vector3,
  spec: ProjectileSpec,
  allocRingTarget: (x: number, y: number, z: number) => MissileTarget,
): void {
  const candidates = gatherNearbyTargets(ctx, marker);
  const assignments = assignMirvTargets(candidates, marker, MIRV.subCount, MIRV.acquireRadius, MIRV.maxPerEnemy, MIRV.ringRadius);

  for (let i = 0; i < assignments.length; i++) {
    const a = assignments[i]!;
    const angle = (i / assignments.length) * TAU;
    // Fan outward cleanly in a floral ring while diving steeply downward.
    _fan.set(Math.cos(angle) * 0.52, -0.85, Math.sin(angle) * 0.52).normalize();
    spec.origin.copy(splitPos).addScaledVector(_fan, 0.6);
    spec.velocity.copy(_fan).multiplyScalar(MIRV.subLaunchSpeed);
    if (a.enemy) {
      spec.target = a.enemy;
    } else {
      const floorY = probeFloorY(ctx, a.point.x, a.point.y, a.point.z);
      // Aim slightly beneath floor surface so world collision always detonates on the ground plane.
      spec.target = allocRingTarget(a.point.x, floorY - 0.4, a.point.z);
    }
    ctx.combat.spawnProjectile(spec);
  }
}

export class MirvShoulder implements FrameShoulderWeapon {
  readonly kind = 'mirv' as const;
  aiming = false;
  valid = false;
  reloadLeft = 0;
  readonly marker = new THREE.Vector3();
  readonly buses: MirvBusState[] = [];

  private markerClock = 0;
  private markerRange = 0;
  private ring: GroundRing | null = null;
  private readonly subSpec: ProjectileSpec = makeSubMissileSpec(false);
  private readonly ringTargets: { center: THREE.Vector3; alive: boolean }[] = Array.from(
    { length: RING_TARGET_POOL_SIZE },
    () => ({ center: new THREE.Vector3(), alive: true }),
  );
  private ringCursor = 0;
  private onNews: ((kind: MechKind, values: number[]) => void) | null = null;

  constructor(private readonly ctx: Ctx) {
    const hasScene = Boolean(ctx.render?.scene && typeof ctx.render.scene.add === 'function');
    if (hasScene) {
      this.ring = new GroundRing(ctx);
    }
    for (let i = 0; i < MAX_BUSES; i++) {
      const mesh = hasScene ? createBusMesh() : null;
      if (mesh) ctx.render.scene.add(mesh);
      this.buses.push({
        live: false,
        phase: 'idle',
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        target: new THREE.Vector3(),
        diveStart: new THREE.Vector3(),
        diveCtrl: new THREE.Vector3(),
        apexY: 0,
        diveU: 0,
        smokeClock: 0,
        mesh,
      });
    }
  }

  get progress(): number {
    return this.reloadLeft > 0 ? 1 - this.reloadLeft / MIRV.reload : -1;
  }

  update(dt: number, u: ShoulderUpdateContext): void {
    this.onNews = u.onNews;
    this.tickReload(dt);
    this.stepBuses(dt);

    if (!u.online) {
      if (this.aiming) this.cancelAim();
      if (u.pressed) this.ctx.audio?.play('weapon_dry');
      return;
    }

    if (u.held) {
      if (!this.aiming) {
        if (this.reloadLeft > 0) {
          if (u.pressed) this.ctx.audio?.play('weapon_dry');
          return;
        }
        this.aiming = true;
        this.markerClock = 0;
        this.ctx.audio?.play('quiver_arm', { pitch: 0.92 });
      }
      this.markerClock += dt;
      this.valid = solveMirvMarker(this.ctx.physics, u.sight.view.position, u.sight.aim, this.marker, MIRV.maxRange);
      this.markerRange = this.valid ? u.sight.view.position.distanceTo(this.marker) : 0;
      this.updateMarkerVisual();
      return;
    }

    if (this.aiming) {
      const canFire = this.valid && this.reloadLeft <= 0;
      this.aiming = false;
      this.ring?.hide();
      if (canFire) {
        u.mountPos(_launch);
        this.launchBus(_launch, this.marker);
        this.reloadLeft = MIRV.reload;
        u.onNews?.('mirv', [_launch.x, _launch.y, _launch.z, this.marker.x, this.marker.y, this.marker.z]);
      } else {
        this.ctx.audio?.play('quiver_cancel');
      }
      return;
    }

    if (u.pressed && this.reloadLeft > 0) {
      this.ctx.audio?.play('weapon_dry');
    }
  }

  idleUpdate(dt: number): void {
    this.tickReload(dt);
    this.stepBuses(dt);
  }

  fillRow(row: GunnerWeapon, keyLabel: string, _cycleKeyLabel: string, online: boolean): void {
    row.max = 1;
    if (!online) {
      row.name = `${keyLabel} MIRV // OFFLINE`;
      row.ammo = 0;
      row.reload = -1;
      return;
    }
    if (this.aiming) {
      row.name = this.valid
        ? `${keyLabel} MIRV // MARKED ${Math.round(this.markerRange)}M`
        : `${keyLabel} MIRV // OUT OF RANGE`;
      row.ammo = 1;
      row.reload = -1;
      return;
    }
    if (this.reloadLeft > 0) {
      row.name = `${keyLabel} MIRV // RELOADING`;
      row.ammo = 0;
      row.reload = this.progress;
      return;
    }
    row.name = `${keyLabel} MIRV // HOLD TO MARK`;
    row.ammo = 1;
    row.reload = -1;
  }

  silence(): void {
    if (this.aiming) this.cancelAim();
  }

  reset(): void {
    this.cancelAim();
    this.reloadLeft = 0;
    this.valid = false;
    this.markerRange = 0;
    for (let i = 0; i < this.buses.length; i++) {
      const b = this.buses[i]!;
      b.live = false;
      b.phase = 'idle';
      if (b.mesh) b.mesh.visible = false;
    }
  }

  private cancelAim(): void {
    this.aiming = false;
    this.valid = false;
    this.ring?.hide();
  }

  private updateMarkerVisual(): void {
    if (!this.ring) return;
    if (!this.valid) {
      this.ring.hide();
      return;
    }
    this.ring.show(this.marker, MIRV.acquireRadius, MIRV.ringRadius);
    this.ring.setColor('#ff9428', 2.4);
    this.ring.setOpacity(0.82 + Math.sin(this.markerClock * 8) * 0.14);
    this.ring.tick(this.markerClock);
  }

  private tickReload(dt: number): void {
    if (this.reloadLeft <= 0) return;
    this.reloadLeft -= dt;
    if (this.reloadLeft <= 0) {
      this.reloadLeft = 0;
      this.ctx.audio?.play('reload_rocket', { volume: 0.85, pitch: 0.9 });
    }
  }

  private allocRingTarget(x: number, y: number, z: number): MissileTarget {
    const slot = this.ringTargets[this.ringCursor++ % RING_TARGET_POOL_SIZE]!;
    slot.center.set(x, y, z);
    slot.alive = true;
    return slot;
  }

  private launchBus(from: THREE.Vector3, target: THREE.Vector3): void {
    let slot = this.buses.find(b => !b.live);
    if (!slot) slot = this.buses[0]!;
    slot.live = true;
    slot.phase = 'climb';
    slot.pos.copy(from);
    slot.vel.set(0, MIRV.climbSpeed, 0);
    slot.target.copy(target);
    slot.apexY = Math.max(from.y, target.y) + MIRV.climbHeight;
    slot.diveU = 0;
    slot.smokeClock = 0;
    if (slot.mesh) {
      slot.mesh.visible = true;
      slot.mesh.position.copy(from);
      slot.mesh.quaternion.identity();
    }

    const { audio, camera, fx, render } = this.ctx;
    fx?.smoke?.(from, 0xd8d4cc, 1.8, 1.9);
    fx?.sparks?.(from, DOWN, 16, 0xffaa38);
    fx?.ring?.(from, UP, 0xff9a30, 3.4);
    render?.lights?.flash?.(from, 0xff9a30, 7, 18, 0.18);
    audio?.play('rocket_fire', { position: from, pitch: 0.72, volume: 1.15 });
    audio?.play('mortar_tube', { position: from, pitch: 0.88, volume: 0.75 });
    camera?.addTrauma?.(0.18);
  }

  private stepBuses(dt: number): void {
    if (dt <= 0) return;
    for (let i = 0; i < this.buses.length; i++) {
      const b = this.buses[i]!;
      if (!b.live) continue;
      if (b.phase === 'climb') {
        this.stepClimb(b, dt);
      } else if (b.phase === 'dive') {
        this.stepDive(b, dt);
      }
      if (!b.live) continue;

      // Exhaust smoke & sparks plume.
      b.smokeClock += dt;
      if (b.smokeClock >= 0.035) {
        b.smokeClock = 0;
        const speed = b.vel.length();
        _dir.copy(b.vel).divideScalar(Math.max(1e-3, speed));
        _v.copy(b.pos).addScaledVector(_dir, -0.95);
        this.ctx.fx?.smoke?.(_v, b.phase === 'climb' ? 0xe0dcd4 : 0xffb050, b.phase === 'climb' ? 1.1 : 0.85, 1.5);
        this.ctx.fx?.sparks?.(_v, _dir.negate(), 3, 0xffaa38);
      }
      if (b.mesh) {
        b.mesh.position.copy(b.pos);
        const speed = b.vel.length();
        if (speed > 1e-3) {
          _dir.copy(b.vel).divideScalar(speed);
          _quat.setFromUnitVectors(UP, _dir);
          b.mesh.quaternion.copy(_quat);
        }
      }
    }
  }

  private stepClimb(b: MirvBusState, dt: number): void {
    b.vel.set(0, MIRV.climbSpeed, 0);
    b.pos.y += MIRV.climbSpeed * dt;
    if (b.pos.y >= b.apexY) {
      b.pos.y = b.apexY;
      b.phase = 'dive';
      b.diveStart.copy(b.pos);
      b.diveCtrl.set(b.target.x, b.apexY, b.target.z);
      b.diveU = 0;
      evalDiveCurve(b.diveStart, b.diveCtrl, b.target, 0.01, _v, _tan);
      if (_tan.lengthSq() > 1e-4) b.vel.copy(_tan).normalize().multiplyScalar(MIRV.diveSpeed);
      this.ctx.fx?.ring?.(b.pos, _dir.copy(b.vel).normalize(), 0xffaa30, 3.0);
      this.ctx.audio?.play('mortar_whistle', { position: b.pos, volume: 0.7, pitch: 1.12 });
    }
  }

  private stepDive(b: MirvBusState, dt: number): void {
    _prev.copy(b.pos);
    evalDiveCurve(b.diveStart, b.diveCtrl, b.target, b.diveU, _v, _tan);
    const tanLen = Math.max(1, _tan.length());
    b.diveU = Math.min(1, b.diveU + (MIRV.diveSpeed * dt) / tanLen);
    evalDiveCurve(b.diveStart, b.diveCtrl, b.target, b.diveU, b.pos, _tan);
    if (_tan.lengthSq() > 1e-4) b.vel.copy(_tan).normalize().multiplyScalar(MIRV.diveSpeed);

    // Check world obstruction on late dive so the bus splits cleanly before clipping into a roof.
    _dir.subVectors(b.pos, _prev);
    const stepLen = _dir.length();
    if (stepLen > 1e-3 && b.diveU > 0.15) {
      _dir.divideScalar(stepLen);
      const wall = this.ctx.physics?.raycast(_prev, _dir, stepLen, CG.World);
      if (wall) {
        b.pos.copy(wall.point).addScaledVector(wall.normal, 0.8);
        this.splitBus(b);
        return;
      }
    }

    const splitY = b.target.y + MIRV.splitHeight;
    if (b.pos.y <= splitY || b.diveU >= 0.99) {
      if (b.pos.y < splitY) b.pos.y = splitY;
      this.splitBus(b);
    }
  }

  private splitBus(b: MirvBusState): void {
    b.live = false;
    b.phase = 'idle';
    if (b.mesh) b.mesh.visible = false;

    const { audio, fx, render } = this.ctx;
    _dir.copy(b.vel);
    if (_dir.lengthSq() < 1e-4) _dir.set(0, -1, 0);
    else _dir.normalize();

    fx?.ring?.(b.pos, _dir, 0xffb840, 7.0);
    fx?.sparks?.(b.pos, _dir, 24, 0xffcc55);
    fx?.smoke?.(b.pos, 0xe4dfd8, 2.2, 1.4);
    render?.lights?.flash?.(b.pos, 0xffaa30, 9, 28, 0.24);
    audio?.play('plasma_burst', { position: b.pos, pitch: 1.18, volume: 0.9 });
    audio?.play('quiver_fire', { position: b.pos, pitch: 0.95, volume: 0.95 });

    spawnSubMissiles(this.ctx, b.pos, b.target, this.subSpec, (x, y, z) => this.allocRingTarget(x, y, z));
    // Emit split phase note so co-op teammates see the exact 8-warhead airburst split too.
    this.onNews?.('mirv', [1, b.pos.x, b.pos.y, b.pos.z, b.target.x, b.target.y, b.target.z]);
  }
}

export const MIRV_PLUGIN: ShoulderPlugin = {
  kind: 'mirv',
  newsKinds: ['mirv'],
  create: ctx => new MirvShoulder(ctx),
  remoteNews(ctx: Ctx, _kind: MechKind, values: number[]): void {
    // Phase 1 split note: [1, sx, sy, sz, tx, ty, tz] -> split flash + 8 cosmetic sub-missiles.
    if (values.length >= 7 && values[0] === 1) {
      const splitPos = _launch.set(values[1]!, values[2]!, values[3]!);
      const targetPos = _from.set(values[4]!, values[5]!, values[6]!);
      ctx.fx?.ring?.(splitPos, DOWN, 0xffb840, 7.0);
      ctx.fx?.sparks?.(splitPos, DOWN, 20, 0xffcc55);
      ctx.fx?.smoke?.(splitPos, 0xe4dfd8, 2.2, 1.4);
      ctx.render?.lights?.flash?.(splitPos, 0xffaa30, 8, 26, 0.22);
      ctx.audio?.play('plasma_burst', { position: splitPos, pitch: 1.18, volume: 0.85 });
      ctx.audio?.play('quiver_fire', { position: splitPos, pitch: 0.95, volume: 0.9 });
      spawnSubMissiles(ctx, splitPos, targetPos, _remoteSubSpec, allocRemoteTarget);
      return;
    }

    // Launch note: [mx, my, mz, tx, ty, tz] (or [0, mx, my, mz, tx, ty, tz]).
    if (values.length < 6) return;
    const off = values.length >= 7 ? 1 : 0;
    const mx = values[off]!;
    const my = values[off + 1]!;
    const mz = values[off + 2]!;
    const tx = values[off + 3]!;
    const ty = values[off + 4]!;
    const tz = values[off + 5]!;

    _launch.set(mx, my, mz);
    const apexY = Math.max(my, ty) + MIRV.climbHeight;
    const climbSec = Math.max(0.4, (apexY - my) / MIRV.climbSpeed);
    const horiz = Math.hypot(tx - mx, tz - mz);
    const diveSec = Math.max(0.5, (horiz + (apexY - (ty + MIRV.splitHeight))) / MIRV.diveSpeed);

    _remoteBusSpec.origin.copy(_launch);
    _remoteBusSpec.velocity.set(0, MIRV.climbSpeed, 0);
    _remoteBusSpec.steerDelay = climbSec;
    _remoteBusSpec.lifetime = climbSec + diveSec;
    _remoteBusSpec.target = allocRemoteTarget(tx, ty + MIRV.splitHeight, tz);
    ctx.combat.spawnProjectile(_remoteBusSpec);

    ctx.fx?.smoke?.(_launch, 0xd8d4cc, 1.8, 1.9);
    ctx.fx?.sparks?.(_launch, DOWN, 14, 0xffaa38);
    ctx.fx?.ring?.(_launch, UP, 0xff9a30, 3.2);
    ctx.audio?.play('rocket_fire', { position: _launch, pitch: 0.72, volume: 1.05 });
    ctx.audio?.play('mortar_tube', { position: _launch, pitch: 0.88, volume: 0.7 });
  },
};
