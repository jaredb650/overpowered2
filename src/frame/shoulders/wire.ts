/**
 * Guided Heavy Missile shoulder plug-in (`WIRE_PLUGIN`).
 *
 * Fires one fat, slow (16 m/s), high-agility laser-guided heavy missile from the shoulder mount that steers
 * continuously toward `u.sight.point` while the Frame moves freely. On impact with world geometry, enemy,
 * or vehicle (or 18 s timeout), detonates with `megaBlast(ctx, hitPos, 1, { source: 'wireBomb' })`. 28 s reload.
 */
import * as THREE from 'three';
import { CG, type Ctx, type LoopHandle } from '../../core/contracts';
import type { EnemyInstance, MissileTarget, ProjectileSpec } from '../../core/gameplay';
import { clamp } from '../../core/math';
import { megaBlast } from '../../fx/recipes/megaBlast';
import type { MechKind } from '../../progression/callins/link';
import type { GunnerWeapon } from '../../vehicles/hud';
import { turnToward } from '../../weapons/swarm';
import type { FrameShoulderWeapon, ShoulderPlugin, ShoulderUpdateContext } from './types';

export const WIRE = {
  speed: 16,
  /** Radians/s: at 16 m/s yields a ~3.5 m turn radius, rounding 90° street corners cleanly. */
  turnRate: 4.6,
  reload: 28,
  maxFlight: 18,
  proximityRadius: 0.95,
  surfaceOffset: 0.25,
} as const;

const UP = new THREE.Vector3(0, 1, 0);
const _launch = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _want = new THREE.Vector3();
const _end = new THREE.Vector3();
const _hit = new THREE.Vector3();
const _trailAt = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _enemyScratch: EnemyInstance[] = [];
const _vehicleScratch: MissileTarget[] = [];

const _remoteMissileSpec: ProjectileSpec = {
  origin: new THREE.Vector3(),
  velocity: new THREE.Vector3(),
  kind: 'rocket',
  team: 'player',
  damage: 0,
  source: 'wireBomb',
  trail: 'big',
  size: 2.4,
  lifetime: WIRE.maxFlight,
  cosmetic: true,
  ghost: true,
};

export interface WireMissileState {
  live: boolean;
  readonly pos: THREE.Vector3;
  readonly vel: THREE.Vector3;
  age: number;
  smokeClock: number;
  ringClock: number;
}

/** Builds a fat, high-visibility heavy cruise missile mesh with bright tail flare (nose along +Y). */
function createHeavyMissileMesh(): THREE.Group {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: '#2b313a', metalness: 0.74, roughness: 0.4, flatShading: true });
  const noseMat = new THREE.MeshStandardMaterial({ color: '#586270', metalness: 0.65, roughness: 0.36, flatShading: true });
  const bandMat = new THREE.MeshStandardMaterial({ color: '#a5894b', metalness: 0.82, roughness: 0.3, flatShading: true });
  const redGlow = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff2a1a').multiplyScalar(4.4), toneMapped: false });
  const flareMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color('#ff9628').multiplyScalar(5.5),
    transparent: true,
    opacity: 0.92,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });

  // Fat heavy fuselage + protruding ogive warhead nose + brass fuze ring.
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.25, 1.55, 10), bodyMat);
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.10, 10), bandMat);
  collar.position.y = 0.72;
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.62, 10), noseMat);
  nose.position.y = 1.08;
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.255, 0.255, 0.05, 10), redGlow);
  ring.position.y = 0.56;

  // Bright guidance flare cone at the tail so the missile stays readable at long distance.
  const flare = new THREE.Mesh(new THREE.ConeGeometry(0.28, 1.55, 10), flareMat);
  flare.rotation.x = Math.PI;
  flare.position.y = -1.52;
  g.add(body, collar, nose, ring, flare);

  // Cruciform stabilizer fins.
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.42, 0.30), noseMat);
    fin.position.set(Math.sin(a) * 0.28, -0.54, Math.cos(a) * 0.28);
    fin.rotation.y = a;
    g.add(fin);
  }
  g.visible = false;
  return g;
}

/** Subtle glowing laser-guidance reticle dot on the live aim point while guiding. */
function createGuidanceDotMesh(): THREE.Mesh {
  const mat = new THREE.MeshBasicMaterial({
    color: new THREE.Color('#ff3420').multiplyScalar(4.4),
    transparent: true,
    opacity: 0.88,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 8), mat);
  dot.visible = false;
  return dot;
}

/**
 * Pure steering step for the Guided Heavy Missile: smoothly turns `velocity` toward `aimPoint`
 * at `turnRate` rad/s while preserving constant `speed` (`16 m/s`).
 */
export function steerWireMissile(
  position: THREE.Vector3,
  velocity: THREE.Vector3,
  aimPoint: THREE.Vector3,
  dt: number,
  speed: number = WIRE.speed,
  turnRate: number = WIRE.turnRate,
): void {
  if (dt <= 0) return;
  _want.subVectors(aimPoint, position);
  const dist = _want.length();
  if (dist > 1e-3) {
    _want.divideScalar(dist);
    if (velocity.lengthSq() < 1e-6) {
      velocity.copy(_want).multiplyScalar(speed);
    } else {
      turnToward(velocity, _want, turnRate * dt);
      velocity.setLength(speed);
    }
  }
}

export class WireShoulder implements FrameShoulderWeapon {
  readonly kind = 'wire' as const;
  reloadLeft = 0;
  readonly missile: WireMissileState = {
    live: false,
    pos: new THREE.Vector3(),
    vel: new THREE.Vector3(),
    age: 0,
    smokeClock: 0,
    ringClock: 0,
  };

  private mesh: THREE.Group | null = null;
  private dot: THREE.Mesh | null = null;
  private motorLoop: LoopHandle | null = null;
  private guideLoop: LoopHandle | null = null;
  private onNews: ((kind: MechKind, values: number[]) => void) | null = null;

  constructor(private readonly ctx: Ctx) {
    if (ctx.render?.scene && typeof ctx.render.scene.add === 'function') {
      this.mesh = createHeavyMissileMesh();
      this.dot = createGuidanceDotMesh();
      ctx.render.scene.add(this.mesh);
      ctx.render.scene.add(this.dot);
    }
  }

  get progress(): number {
    return this.reloadLeft > 0 ? 1 - this.reloadLeft / WIRE.reload : -1;
  }

  update(dt: number, u: ShoulderUpdateContext): void {
    this.onNews = u.onNews;
    this.tickReload(dt);

    if (this.missile.live) {
      this.stepMissile(dt, u.sight.point);
    } else if (this.dot) {
      this.dot.visible = false;
    }

    if (u.pressed) {
      if (!u.online || this.missile.live || this.reloadLeft > 0) {
        this.ctx.audio?.play('weapon_dry');
        return;
      }
      u.mountPos(_launch);
      this.launch(_launch, u.sight.point, u.sight.aim, u.onNews);
    }
  }

  idleUpdate(dt: number): void {
    this.tickReload(dt);
    if (this.missile.live) {
      // Pilot exited mid-flight: missile flies straight along its last heading until impact or timeout.
      this.stepMissile(dt, null);
    }
    if (this.dot) this.dot.visible = false;
  }

  fillRow(row: GunnerWeapon, keyLabel: string, _cycleKeyLabel: string, online: boolean): void {
    row.max = 1;
    if (!online) {
      row.name = `${keyLabel} GUIDED MISSILE // OFFLINE`;
      row.ammo = 0;
      row.reload = -1;
      return;
    }
    if (this.missile.live) {
      row.name = `${keyLabel} GUIDED MISSILE // GUIDING`;
      row.ammo = 0;
      row.reload = this.progress;
      return;
    }
    if (this.reloadLeft > 0) {
      row.name = `${keyLabel} GUIDED MISSILE // RELOADING`;
      row.ammo = 0;
      row.reload = this.progress;
      return;
    }
    row.name = `${keyLabel} GUIDED MISSILE // READY`;
    row.ammo = 1;
    row.reload = -1;
  }

  silence(): void {
    this.stopLoops();
    if (this.dot) this.dot.visible = false;
  }

  reset(): void {
    this.stopLoops();
    this.missile.live = false;
    this.missile.age = 0;
    this.reloadLeft = 0;
    if (this.mesh) this.mesh.visible = false;
    if (this.dot) this.dot.visible = false;
  }

  private tickReload(dt: number): void {
    if (this.reloadLeft <= 0) return;
    this.reloadLeft -= dt;
    if (this.reloadLeft <= 0) {
      this.reloadLeft = 0;
      this.ctx.audio?.play('reload_rocket', { volume: 0.9, pitch: 0.78 });
    }
  }

  private stopLoops(): void {
    this.motorLoop?.stop(0.08);
    this.motorLoop = null;
    this.guideLoop?.stop(0.08);
    this.guideLoop = null;
  }

  private launch(
    from: THREE.Vector3,
    aimPoint: THREE.Vector3,
    aimDir: THREE.Vector3,
    onNews: ((kind: MechKind, values: number[]) => void) | null,
  ): void {
    _dir.subVectors(aimPoint, from);
    if (_dir.lengthSq() < 4) _dir.copy(aimDir);
    if (_dir.lengthSq() < 1e-4) _dir.set(0, 0, -1);
    _dir.normalize();

    const m = this.missile;
    m.live = true;
    m.pos.copy(from);
    m.vel.copy(_dir).multiplyScalar(WIRE.speed);
    m.age = 0;
    m.smokeClock = 0;
    m.ringClock = 0;
    this.reloadLeft = WIRE.reload;

    if (this.mesh) {
      this.mesh.visible = true;
      this.mesh.position.copy(from);
      _quat.setFromUnitVectors(UP, _dir);
      this.mesh.quaternion.copy(_quat);
    }
    if (this.dot) {
      this.dot.visible = true;
      this.dot.position.copy(aimPoint);
    }

    const { audio, camera, fx, render } = this.ctx;
    fx?.smoke?.(from, 0xd4d0c8, 1.9, 2.0);
    fx?.sparks?.(from, _want.copy(_dir).negate(), 18, 0xffaa38);
    fx?.ring?.(from, _dir, 0xff9428, 3.6);
    render?.lights?.flash?.(from, 0xff9428, 8, 20, 0.2);
    audio?.play('rocket_fire', { position: from, pitch: 0.58, volume: 1.25 });
    audio?.play('mortar_tube', { position: from, pitch: 0.68, volume: 0.8 });
    audio?.play('rocket_laser', { pitch: 1.1 });
    camera?.addTrauma?.(0.24);

    this.stopLoops();
    if (audio && typeof audio.startLoop === 'function') {
      this.motorLoop = audio.startLoop('flame_loop', { position: from, volume: 0.42, pitch: 0.62, fadeIn: 0.05 });
      this.guideLoop = audio.startLoop('judge_fan_tension', { volume: 0.12, pitch: 1.32, fadeIn: 0.06 });
    }

    onNews?.('wire', [0, from.x, from.y, from.z, _dir.x, _dir.y, _dir.z]);
  }

  private stepMissile(dt: number, aimPoint: THREE.Vector3 | null): void {
    if (dt <= 0) return;
    const m = this.missile;
    m.age += dt;

    if (aimPoint) {
      steerWireMissile(m.pos, m.vel, aimPoint, dt, WIRE.speed, WIRE.turnRate);
      if (this.dot) {
        this.dot.visible = true;
        this.dot.position.copy(aimPoint);
      }
    }

    const speed = m.vel.length();
    if (speed < 1e-3) {
      this.detonate(m.pos);
      return;
    }
    _dir.copy(m.vel).divideScalar(speed);
    const stepLen = speed * dt;
    _end.copy(m.pos).addScaledVector(_dir, stepLen);

    // 1. World geometry sweep.
    const wall = this.ctx.physics?.raycast(m.pos, _dir, stepLen, CG.World) ?? null;
    const limit = wall ? wall.distance : stepLen;

    // 2. Direct enemy raycast sweep.
    const enemyHit = this.ctx.enemies?.raycast?.(m.pos, _dir, limit) ?? null;
    if (enemyHit) {
      _hit.copy(enemyHit.point);
      this.detonate(_hit);
      return;
    }

    // 3. Close proximity fuse for enemies & paintable vehicles along the step end.
    if (this.checkProximity(_end, _hit)) {
      this.detonate(_hit);
      return;
    }

    // 4. World or vehicle collider hit.
    if (wall) {
      this.ctx.enemies?.vehicles?.direct?.(wall.collider, wall.point, 1400, 'shell', 'wireBomb');
      _hit.copy(wall.point).addScaledVector(wall.normal, WIRE.surfaceOffset);
      this.detonate(_hit);
      return;
    }

    // Advance missile position.
    m.pos.copy(_end);

    // 5. Max flight timeout (~18 s).
    if (m.age >= WIRE.maxFlight) {
      this.detonate(m.pos);
      return;
    }

    // Update visuals, contrail, and guidance audio.
    if (this.mesh) {
      this.mesh.position.copy(m.pos);
      _quat.setFromUnitVectors(UP, _dir);
      this.mesh.quaternion.copy(_quat);
    }
    this.motorLoop?.setPosition(m.pos);
    if (this.guideLoop && aimPoint) {
      const dist = m.pos.distanceTo(aimPoint);
      this.guideLoop.setPitch(1.22 + (1 - clamp(dist / 120)) * 0.42);
    }

    m.smokeClock += dt;
    if (m.smokeClock >= 0.035) {
      m.smokeClock = 0;
      _trailAt.copy(m.pos).addScaledVector(_dir, -1.1);
      this.ctx.fx?.smoke?.(_trailAt, 0xddd9d0, 1.05, 1.85);
      this.ctx.fx?.sparks?.(_trailAt, _want.copy(_dir).negate(), 3, 0xffaa38);
    }
    m.ringClock += dt;
    if (m.ringClock >= 0.24) {
      m.ringClock = 0;
      _trailAt.copy(m.pos).addScaledVector(_dir, -1.0);
      this.ctx.fx?.ring?.(_trailAt, _dir, 0xffaa44, 1.2);
      this.ctx.render?.lights?.flash?.(_trailAt, 0xff9428, 4.5, 12, 0.12);
    }
  }

  private checkProximity(at: THREE.Vector3, out: THREE.Vector3): boolean {
    const enemies = this.ctx.enemies;
    if (!enemies) return false;
    if (typeof enemies.query === 'function') {
      const n = enemies.query(at, WIRE.proximityRadius + 1.2, _enemyScratch) || 0;
      for (let i = 0; i < n; i++) {
        const e = _enemyScratch[i]!;
        if (e.alive && e.center.distanceTo(at) <= WIRE.proximityRadius) {
          _enemyScratch.length = 0;
          out.copy(at);
          return true;
        }
      }
      _enemyScratch.length = 0;
    }
    const vehicles = enemies.vehicles;
    if (vehicles && typeof vehicles.paintable === 'function') {
      const m = vehicles.paintable(_vehicleScratch);
      for (let i = 0; i < m; i++) {
        const v = _vehicleScratch[i]!;
        const r = (v.paintRadius ?? 1.5) + 0.55;
        if (v.alive && v.center.distanceTo(at) <= r) {
          _vehicleScratch.length = 0;
          out.copy(at);
          return true;
        }
      }
      _vehicleScratch.length = 0;
    }
    return false;
  }

  private detonate(at: THREE.Vector3): void {
    this.missile.live = false;
    this.stopLoops();
    if (this.mesh) this.mesh.visible = false;
    if (this.dot) this.dot.visible = false;

    megaBlast(this.ctx, at, 1, { source: 'wireBomb' });
    this.onNews?.('wire', [1, at.x, at.y, at.z]);
  }
}

export const WIRE_PLUGIN: ShoulderPlugin = {
  kind: 'wire',
  newsKinds: ['wire'],
  create: ctx => new WireShoulder(ctx),
  remoteNews(ctx: Ctx, _kind: MechKind, values: number[]): void {
    if (values.length < 4) return;
    const phase = values[0]!;
    if (phase === 0 && values.length >= 7) {
      _launch.set(values[1]!, values[2]!, values[3]!);
      _dir.set(values[4]!, values[5]!, values[6]!);
      if (_dir.lengthSq() < 1e-4) _dir.set(0, 0, -1);
      else _dir.normalize();

      _remoteMissileSpec.origin.copy(_launch);
      _remoteMissileSpec.velocity.copy(_dir).multiplyScalar(WIRE.speed);
      ctx.combat.spawnProjectile(_remoteMissileSpec);

      ctx.fx?.smoke?.(_launch, 0xd4d0c8, 1.9, 2.0);
      ctx.fx?.sparks?.(_launch, _want.copy(_dir).negate(), 16, 0xffaa38);
      ctx.fx?.ring?.(_launch, _dir, 0xff9428, 3.4);
      ctx.audio?.play('rocket_fire', { position: _launch, pitch: 0.58, volume: 1.15 });
      ctx.audio?.play('mortar_tube', { position: _launch, pitch: 0.68, volume: 0.75 });
      return;
    }
    if (phase === 1) {
      _hit.set(values[1]!, values[2]!, values[3]!);
      megaBlast(ctx, _hit, 1, { source: 'wireBomb', cosmetic: true, mirrored: true });
    }
  },
};
