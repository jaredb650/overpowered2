/**
 * Autonomous Laser Orbit Drones plug-in (`laserOrbit`).
 *
 * Press G / V / B to deploy 2 autonomous floating gun-drones that visibly hover & orbit around the
 * Frame's shoulders (±2.4 m out, +4.2 m up, bobbing & banking toward targets) for 14 s (16 s cooldown
 * after expiry; press again while active to recall early and save partial cooldown).
 * Each drone independently acquires alive enemies within 48 m (prioritizing enemies near the pilot's
 * sightline) and fires crisp cyan/amber laser pulses every 0.42 s (75 dmg per bolt).
 */
import * as THREE from 'three';
import { CG, type Ctx, type DamageInfo } from '../../core/contracts';
import type { EnemyInstance, ShotSpec } from '../../core/gameplay';
import { clamp } from '../../core/math';
import type { MechKind } from '../../progression/callins/link';
import type { GunnerWeapon } from '../../vehicles/hud';
import type { FrameShoulderWeapon, ShoulderPlugin, ShoulderUpdateContext } from './types';

export const LASER_ORBIT = {
  droneCount: 2,
  duration: 14,
  cooldown: 16,
  minRecallCooldownFrac: 0.15,
  range: 48,
  fireInterval: 0.42,
  damage: 75,
  orbitRadiusX: 2.4,
  orbitHeightY: 4.2,
  orbitSwayZ: 0.65,
  bobAmp: 0.28,
} as const;

interface OrbitDrone {
  readonly side: -1 | 1;
  readonly pos: THREE.Vector3;
  readonly desiredPos: THREE.Vector3;
  readonly vel: THREE.Vector3;
  fireTimer: number;
  target: EnemyInstance | null;
  mesh: THREE.Group | null;
  core: THREE.Mesh | null;
}

const UP = new THREE.Vector3(0, 1, 0);
const _mount = new THREE.Vector3();
const _right = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _toEnemy = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _negDir = new THREE.Vector3();
const _targetPos = new THREE.Vector3();
const _nearby: EnemyInstance[] = [];
const _rFrom = new THREE.Vector3();
const _rTo = new THREE.Vector3();
const _rNeg = new THREE.Vector3();

const _laserDamage: DamageInfo = {
  amount: LASER_ORBIT.damage,
  type: 'shock',
  point: new THREE.Vector3(),
  dir: new THREE.Vector3(),
  force: 28,
  source: 'frame_laser_orbit',
};

const _fallbackShot: ShotSpec = {
  damage: LASER_ORBIT.damage,
  source: 'frame_laser_orbit',
  team: 'player',
  maxDistance: LASER_ORBIT.range,
  type: 'shock',
  force: 28,
};

interface SharedOrbitAssets {
  bodyGeo: THREE.BufferGeometry;
  wingGeo: THREE.BufferGeometry;
  prongGeo: THREE.BufferGeometry;
  coreGeo: THREE.BufferGeometry;
  bodyMat: THREE.MeshStandardMaterial;
  plateMat: THREE.MeshStandardMaterial;
  cyanCoreMat: THREE.MeshBasicMaterial;
  amberCoreMat: THREE.MeshBasicMaterial;
}

let sharedAssets: SharedOrbitAssets | null = null;

function getOrbitAssets(): SharedOrbitAssets {
  if (sharedAssets) return sharedAssets;
  const bodyGeo = new THREE.CylinderGeometry(0.18, 0.24, 0.16, 6);
  const wingGeo = new THREE.BoxGeometry(0.68, 0.045, 0.24);
  const prongGeo = new THREE.CylinderGeometry(0.028, 0.036, 0.34, 6);
  prongGeo.rotateX(Math.PI / 2);
  const coreGeo = new THREE.OctahedronGeometry(0.11, 0);

  const bodyMat = new THREE.MeshStandardMaterial({ color: '#1a2028', metalness: 0.78, roughness: 0.36 });
  const plateMat = new THREE.MeshStandardMaterial({ color: '#4c5664', metalness: 0.72, roughness: 0.32 });
  const cyanCoreMat = new THREE.MeshBasicMaterial({ color: '#38e8ff', toneMapped: false, fog: false });
  const amberCoreMat = new THREE.MeshBasicMaterial({ color: '#ffaa30', toneMapped: false, fog: false });

  sharedAssets = { bodyGeo, wingGeo, prongGeo, coreGeo, bodyMat, plateMat, cyanCoreMat, amberCoreMat };
  return sharedAssets;
}

/** Builds a real hovering diamond/winglet 3D gun-drone `THREE.Group` with glowing optic core. */
export function createOrbitDroneMesh(index: number): { group: THREE.Group; core: THREE.Mesh } {
  const a = getOrbitAssets();
  const group = new THREE.Group();
  group.name = `laser_orbit_drone_${index}`;

  const body = new THREE.Mesh(a.bodyGeo, a.bodyMat);
  group.add(body);

  // Swept diamond winglet blades.
  const wingL = new THREE.Mesh(a.wingGeo, a.plateMat);
  wingL.position.set(-0.26, 0.04, 0.06);
  wingL.rotation.set(0, 0.28, 0.26);
  group.add(wingL);

  const wingR = new THREE.Mesh(a.wingGeo, a.plateMat);
  wingR.position.set(0.26, 0.04, 0.06);
  wingR.rotation.set(0, -0.28, -0.26);
  group.add(wingR);

  // Twin ventral laser emitter prongs pointing along +Z (for `lookAt` alignment).
  for (const s of [-1, 1]) {
    const prong = new THREE.Mesh(a.prongGeo, a.plateMat);
    prong.position.set(s * 0.1, -0.08, 0.22);
    group.add(prong);
  }

  // Glowing optic core (cyan on drone 0, amber on drone 1).
  const core = new THREE.Mesh(a.coreGeo, index % 2 === 0 ? a.cyanCoreMat : a.amberCoreMat);
  core.position.set(0, 0.02, 0.14);
  group.add(core);

  return { group, core };
}

export class LaserOrbitShoulder implements FrameShoulderWeapon {
  readonly kind = 'laserOrbit' as const;

  active = false;
  remaining = 0;
  cooldown = 0;
  private cooldownMax: number = LASER_ORBIT.cooldown;
  private orbitTime = 0;

  readonly drones: readonly OrbitDrone[] = [
    this.makeDrone(-1),
    this.makeDrone(1),
  ];

  constructor(private readonly ctx: Ctx) {}

  get activeDroneCount(): number {
    return this.active ? LASER_ORBIT.droneCount : 0;
  }

  get cooldownProgress(): number {
    if (this.cooldown <= 0 || this.cooldownMax <= 0) return -1;
    return clamp(1 - this.cooldown / this.cooldownMax, 0, 1);
  }

  update(dt: number, u: ShoulderUpdateContext): void {
    if (!this.active && this.cooldown > 0) {
      this.cooldown = Math.max(0, this.cooldown - dt);
      if (this.cooldown === 0) {
        this.ctx.audio?.play?.('reload_cell', { volume: 0.75, pitch: 1.1 });
      }
    }

    if (!u.online) {
      if (this.active) this.recallEarly(false);
      if (u.pressed) this.ctx.audio?.play?.('weapon_dry');
      return;
    }

    if (u.pressed) {
      if (this.active) {
        this.recallEarly(true);
      } else if (this.cooldown <= 1e-6) {
        this.deploy(u);
      } else {
        this.ctx.audio?.play?.('weapon_dry');
      }
    }

    if (!this.active) return;

    this.remaining -= dt;
    this.orbitTime += dt;
    if (this.remaining <= 0) {
      this.expire();
      return;
    }

    this.updateDrones(dt, u);
  }

  idleUpdate(dt: number): void {
    if (this.active) {
      this.remaining -= dt;
      this.orbitTime += dt;
      if (this.remaining <= 0) {
        this.expire();
      }
    } else if (this.cooldown > 0) {
      this.cooldown = Math.max(0, this.cooldown - dt);
    }
  }

  fillRow(row: GunnerWeapon, keyLabel: string, _cycleKeyLabel: string, online: boolean): void {
    row.max = LASER_ORBIT.duration;
    row.selected = this.active;
    if (!online) {
      row.name = `${keyLabel} LASER ORBITS // OFFLINE`;
      row.ammo = 0;
      row.reload = -1;
      return;
    }
    if (this.active) {
      row.name = `${keyLabel} LASER ORBITS // ACTIVE (${Math.ceil(this.remaining)}s)`;
      row.ammo = Math.ceil(this.remaining);
      row.reload = clamp(this.remaining / LASER_ORBIT.duration, 0, 1);
      return;
    }
    if (this.cooldown > 0) {
      row.name = `${keyLabel} LASER ORBITS // RECHARGE`;
      row.ammo = 0;
      row.reload = this.cooldownProgress;
      return;
    }
    row.name = `${keyLabel} LASER ORBITS // READY`;
    row.ammo = LASER_ORBIT.duration;
    row.reload = -1;
  }

  silence(): void {
    this.detachDroneMeshes();
  }

  reset(): void {
    this.active = false;
    this.remaining = 0;
    this.cooldown = 0;
    this.cooldownMax = LASER_ORBIT.cooldown;
    this.orbitTime = 0;
    for (let i = 0; i < this.drones.length; i++) {
      this.drones[i]!.target = null;
      this.drones[i]!.fireTimer = 0;
    }
    this.detachDroneMeshes();
  }

  private makeDrone(side: -1 | 1): OrbitDrone {
    return {
      side,
      pos: new THREE.Vector3(),
      desiredPos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      fireTimer: 0,
      target: null,
      mesh: null,
      core: null,
    };
  }

  private deploy(u: ShoulderUpdateContext): void {
    this.active = true;
    this.remaining = LASER_ORBIT.duration;
    this.orbitTime = 0;
    u.mountPos(_mount);

    const sinY = Math.sin(u.torsoYaw);
    const cosY = Math.cos(u.torsoYaw);
    _right.set(cosY, 0, -sinY);

    const scene = this.ctx.render?.scene;
    const canAttach = Boolean(scene && typeof scene.add === 'function');

    for (let i = 0; i < this.drones.length; i++) {
      const d = this.drones[i]!;
      d.target = null;
      d.fireTimer = i === 0 ? 0.06 : LASER_ORBIT.fireInterval * 0.55;
      d.pos.set(
        u.feet.x + _right.x * d.side * LASER_ORBIT.orbitRadiusX,
        u.feet.y + LASER_ORBIT.orbitHeightY,
        u.feet.z + _right.z * d.side * LASER_ORBIT.orbitRadiusX,
      );
      d.desiredPos.copy(d.pos);

      if (canAttach && scene) {
        if (!d.mesh) {
          const built = createOrbitDroneMesh(i);
          d.mesh = built.group;
          d.core = built.core;
        }
        if (d.mesh.parent !== scene) scene.add(d.mesh);
        d.mesh.visible = true;
        d.mesh.position.copy(d.pos);
      }
    }

    this.ctx.fx?.sparks?.(_mount, UP, 10, '#38e8ff');
    this.ctx.audio?.play?.('drone_alert', { position: _mount, volume: 0.75, pitch: 1.25 });
    this.ctx.audio?.play?.('quiver_arm', { volume: 0.65, pitch: 1.15 });
  }

  private recallEarly(playAudio: boolean): void {
    const usedFrac = clamp(
      1 - this.remaining / LASER_ORBIT.duration,
      LASER_ORBIT.minRecallCooldownFrac,
      1,
    );
    this.active = false;
    this.remaining = 0;
    this.cooldown = LASER_ORBIT.cooldown * usedFrac;
    this.cooldownMax = this.cooldown;
    for (let i = 0; i < this.drones.length; i++) {
      this.drones[i]!.target = null;
    }
    this.detachDroneMeshes();
    if (playAudio) {
      this.ctx.audio?.play?.('quiver_cancel', { volume: 0.7, pitch: 1.12 });
    }
  }

  private expire(): void {
    this.active = false;
    this.remaining = 0;
    this.cooldown = LASER_ORBIT.cooldown;
    this.cooldownMax = LASER_ORBIT.cooldown;
    for (let i = 0; i < this.drones.length; i++) {
      this.drones[i]!.target = null;
    }
    this.detachDroneMeshes();
    this.ctx.audio?.play?.('drone_alert', { volume: 0.55, pitch: 0.78 });
  }

  private detachDroneMeshes(): void {
    for (let i = 0; i < this.drones.length; i++) {
      const d = this.drones[i]!;
      if (d.mesh) {
        d.mesh.visible = false;
        d.mesh.parent?.remove(d.mesh);
      }
    }
  }

  private updateDrones(dt: number, u: ShoulderUpdateContext): void {
    const sinY = Math.sin(u.torsoYaw);
    const cosY = Math.cos(u.torsoYaw);
    _right.set(cosY, 0, -sinY);
    _fwd.set(-sinY, 0, -cosY);

    const smooth = 1 - Math.exp(-8 * dt);
    const scene = this.ctx.render?.scene;
    const canAttach = Boolean(scene && typeof scene.add === 'function');

    for (let i = 0; i < this.drones.length; i++) {
      const d = this.drones[i]!;
      const phase = this.orbitTime * 1.55 + i * Math.PI;
      const lateral = d.side * LASER_ORBIT.orbitRadiusX + Math.cos(phase) * 0.32;
      const fore = Math.sin(phase) * LASER_ORBIT.orbitSwayZ;
      const bob = Math.sin(this.orbitTime * 2.8 + i * 2.1) * LASER_ORBIT.bobAmp;

      d.desiredPos.set(
        u.feet.x + _right.x * lateral + _fwd.x * fore,
        u.feet.y + LASER_ORBIT.orbitHeightY + bob,
        u.feet.z + _right.z * lateral + _fwd.z * fore,
      );
      d.vel.subVectors(d.desiredPos, d.pos);
      d.pos.lerp(d.desiredPos, smooth);

      // Independent target acquisition within 48 m (prefer enemies near pilot sightline & distinct targets).
      const otherTarget = this.drones[1 - i]!.target;
      d.target = this.acquireTarget(d.pos, u, otherTarget);

      // Update 3D drone mesh transform, banking, and pulsing optic core.
      if (canAttach && scene) {
        if (!d.mesh) {
          const built = createOrbitDroneMesh(i);
          d.mesh = built.group;
          d.core = built.core;
        }
        if (d.mesh.parent !== scene) scene.add(d.mesh);
        d.mesh.visible = true;
        d.mesh.position.copy(d.pos);
        if (d.target && d.target.alive) {
          d.mesh.lookAt(d.target.center);
        } else {
          _targetPos.copy(d.pos).add(u.sight.aim);
          d.mesh.lookAt(_targetPos);
        }
        d.mesh.rotation.z += clamp(-d.vel.dot(_right) * 0.25, -0.45, 0.45);
        if (d.core) {
          const pulse = 0.85 + 0.28 * Math.sin(this.orbitTime * 11 + i * Math.PI);
          d.core.scale.setScalar(pulse);
        }
      }

      // Autonomous laser pulse firing every 0.42 s.
      d.fireTimer -= dt;
      if (d.fireTimer <= 1e-6 && d.target && d.target.alive) {
        this.fireLaserPulse(d, i, d.target, u);
        d.fireTimer = Math.max(0, d.fireTimer) + LASER_ORBIT.fireInterval;
      } else if (d.fireTimer < 0) {
        d.fireTimer = 0;
      }
    }
  }

  private acquireTarget(
    from: THREE.Vector3,
    u: ShoulderUpdateContext,
    otherTarget: EnemyInstance | null,
  ): EnemyInstance | null {
    const enemies = this.ctx.enemies;
    if (!enemies) return null;

    _nearby.length = 0;
    const r2 = LASER_ORBIT.range * LASER_ORBIT.range;
    if (enemies.alive && enemies.alive.length > 0) {
      for (let i = 0; i < enemies.alive.length; i++) {
        const e = enemies.alive[i]!;
        if (!e.alive) continue;
        if (e.center.distanceToSquared(from) <= r2) _nearby.push(e);
      }
    } else if (typeof enemies.query === 'function') {
      const n = enemies.query(from, LASER_ORBIT.range, _nearby) || 0;
      if (_nearby.length > n) _nearby.length = n;
    }
    if (_nearby.length === 0) return null;

    let best: EnemyInstance | null = null;
    let bestScore = Infinity;

    for (let i = 0; i < _nearby.length; i++) {
      const e = _nearby[i]!;
      if (!e.alive) continue;

      _toEnemy.subVectors(e.center, from);
      const dist = _toEnemy.length();
      if (dist > LASER_ORBIT.range) continue;

      // Line-of-sight check from drone position to enemy chest.
      if (dist > 0.5 && this.ctx.physics?.raycast) {
        _dir.copy(_toEnemy).divideScalar(dist);
        const wall = this.ctx.physics.raycast(from, _dir, dist, CG.World);
        if (wall && wall.distance < dist - 0.85) continue;
      }

      // Prioritize enemies near the player's sightline; slightly penalize target already tracked by sibling drone.
      _toEnemy.subVectors(e.center, u.sight.view.position);
      const t = _toEnemy.dot(u.sight.aim);
      let sightPenalty: number;
      if (t > 0) {
        const perp = Math.sqrt(Math.max(0, _toEnemy.lengthSq() - t * t));
        sightPenalty = perp * 2.2;
      } else {
        sightPenalty = 35 + dist;
      }
      const duplicatePenalty = otherTarget === e && _nearby.length > 1 ? 14 : 0;
      const score = sightPenalty + dist * 0.35 + duplicatePenalty;

      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    return best;
  }

  private fireLaserPulse(
    drone: OrbitDrone,
    index: number,
    target: EnemyInstance,
    u: ShoulderUpdateContext,
  ): void {
    const { enemies, combat, fx, audio, render } = this.ctx;
    _targetPos.copy(target.center);
    _dir.subVectors(_targetPos, drone.pos);
    const dist = _dir.length();
    if (dist > 1e-4) _dir.divideScalar(dist);
    else _dir.copy(u.sight.aim);
    _negDir.copy(_dir).negate();

    const isCyan = index % 2 === 0;
    const tracerKind = isCyan ? 'plasma' : 'raufoss';
    const sparkColor = isCyan ? '#38e8ff' : '#ffaa30';
    const lightColor = isCyan ? 0x38e8ff : 0xffaa30;

    if (typeof enemies?.applyDamage === 'function') {
      _laserDamage.amount = LASER_ORBIT.damage;
      _laserDamage.point.copy(_targetPos);
      _laserDamage.dir.copy(_dir);
      enemies.applyDamage(target, _laserDamage);
    } else if (typeof combat?.fireRay === 'function') {
      _fallbackShot.tracer = tracerKind;
      _fallbackShot.tracerFrom = drone.pos;
      combat.fireRay(drone.pos, _dir, _fallbackShot);
    }

    fx?.tracer?.(drone.pos, _targetPos, tracerKind);
    fx?.beam?.(drone.pos, _targetPos, 'laser', 0.045, 0.08);
    fx?.sparks?.(_targetPos, _negDir, 6, sparkColor);
    render?.lights?.flash?.(drone.pos, lightColor, 3.8, 7.5, 0.06);
    audio?.play?.('drone_gun', { position: drone.pos, volume: 0.45, pitch: isCyan ? 1.42 : 1.22 });
    u.onNews?.('orbit', [
      drone.pos.x, drone.pos.y, drone.pos.z,
      _targetPos.x, _targetPos.y, _targetPos.z,
      index,
    ]);
  }
}

/** Co-op playback for teammates when a Laser Orbit drone fires a bolt. */
export function playRemoteLaserOrbit(ctx: Ctx, kind: MechKind, values: number[]): void {
  if (kind !== 'orbit' || values.length < 7) return;
  _rFrom.set(values[0]!, values[1]!, values[2]!);
  _rTo.set(values[3]!, values[4]!, values[5]!);
  const isCyan = (values[6]! & 1) === 0;
  _rNeg.subVectors(_rFrom, _rTo);
  if (_rNeg.lengthSq() > 1e-4) _rNeg.normalize();
  else _rNeg.set(0, 1, 0);

  ctx.fx?.tracer?.(_rFrom, _rTo, isCyan ? 'plasma' : 'raufoss');
  ctx.fx?.sparks?.(_rTo, _rNeg, 6, isCyan ? '#38e8ff' : '#ffaa30');
  ctx.render?.lights?.flash?.(_rFrom, isCyan ? 0x38e8ff : 0xffaa30, 3.5, 7, 0.06);
  ctx.audio?.play?.('drone_gun', { position: _rFrom, volume: 0.4, pitch: isCyan ? 1.42 : 1.22 });
}

export const LASER_ORBIT_PLUGIN: ShoulderPlugin = {
  kind: 'laserOrbit',
  newsKinds: ['orbit'],
  create: ctx => new LaserOrbitShoulder(ctx),
  remoteNews: playRemoteLaserOrbit,
};

export const LASER_ORBIT_SHOULDER = LASER_ORBIT_PLUGIN;
