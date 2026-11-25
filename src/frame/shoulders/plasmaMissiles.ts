/**
 * Vertical Plasma Missile Rack plug-in (`plasmaMissiles`).
 *
 * Hold G / V / B to paint up to 6 targets (`u.gatherTargets(110, Math.cos(0.42))` — respects
 * Head `lockRangeMult` automatically). Release to launch 6 vertical-launch missiles straight UP
 * out of the shoulder VLS cells that pitch over and rain down onto painted targets (or the
 * crosshair point if tapped without holding).
 * Each missile detonates into a lingering 5.0 m violet/cyan plasma dome for 2.4 s (150 impact
 * + 90 DPS inside dome), 5.5 s reload.
 */
import * as THREE from 'three';
import { CG, type Ctx, type DamageInfo } from '../../core/contracts';
import type { EnemyInstance, ExplosionSpec, MissileTarget } from '../../core/gameplay';
import { clamp, TAU } from '../../core/math';
import type { MechKind } from '../../progression/callins/link';
import type { GunnerWeapon } from '../../vehicles/hud';
import { Painter } from '../../weapons/swarm';
import { NEAR_SIGHT } from '../arms/shared';
import type { FrameShoulderWeapon, ShoulderPlugin, ShoulderUpdateContext } from './types';

export const PLASMA_MISSILES = {
  cells: 6,
  paintRange: 110,
  paintConeCos: Math.cos(0.42),
  paintEvery: 0.22,
  salvoGap: 0.08,
  reload: 5.5,
  climbSpeed: 42,
  climbDuration: 0.36,
  diveSpeed: 58,
  turnRate: 9.5,
  maxLifetime: 6.5,
  contactRadius: 1.4,
  impactDamage: 150,
  domeRadius: 5.0,
  domeDuration: 2.4,
  domeDps: 90,
  domeTickInterval: 0.25,
  maxMissiles: 12,
  maxDomes: 12,
} as const;

interface VlsMissile {
  active: boolean;
  readonly pos: THREE.Vector3;
  readonly vel: THREE.Vector3;
  readonly fallbackPoint: THREE.Vector3;
  target: MissileTarget | null;
  age: number;
  floorY: number;
  trailClock: number;
  mesh: THREE.Mesh | null;
}

interface PlasmaDome {
  active: boolean;
  readonly center: THREE.Vector3;
  remaining: number;
  tickClock: number;
  fxClock: number;
  mesh: THREE.Group | null;
}

const UP = new THREE.Vector3(0, 1, 0);
const FORWARD_Z = new THREE.Vector3(0, 0, -1);

const _mount = new THREE.Vector3();
const _right = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _aimPoint = new THREE.Vector3();
const _dest = new THREE.Vector3();
const _toDest = new THREE.Vector3();
const _curDir = new THREE.Vector3();
const _desDir = new THREE.Vector3();
const _next = new THREE.Vector3();
const _step = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _nearby: EnemyInstance[] = [];
const _rPos = new THREE.Vector3();

const _impactBlast: ExplosionSpec = {
  radius: PLASMA_MISSILES.domeRadius,
  damage: PLASMA_MISSILES.impactDamage,
  kind: 'plasma',
  source: 'frame_plasma_missile',
  team: 'player',
  selfDamage: 0,
  playerPush: 0,
  scale: 1.15,
  shake: 0.14,
  vaporize: true,
};

const _domeDamage: DamageInfo = {
  amount: PLASMA_MISSILES.domeDps * PLASMA_MISSILES.domeTickInterval,
  type: 'shock',
  point: new THREE.Vector3(),
  dir: new THREE.Vector3(0, 1, 0),
  force: 12,
  source: 'frame_plasma_dome',
  vaporize: true,
};

interface SharedPlasmaAssets {
  missileGeo: THREE.BufferGeometry;
  missileMat: THREE.MeshStandardMaterial;
  domeGeo: THREE.BufferGeometry;
  wireGeo: THREE.BufferGeometry;
  domeMat: THREE.MeshBasicMaterial;
  wireMat: THREE.MeshBasicMaterial;
}

let sharedAssets: SharedPlasmaAssets | null = null;

function getPlasmaAssets(): SharedPlasmaAssets {
  if (sharedAssets) return sharedAssets;
  const missileGeo = new THREE.CylinderGeometry(0.05, 0.085, 0.56, 8);
  missileGeo.rotateX(Math.PI / 2);
  const missileMat = new THREE.MeshStandardMaterial({
    color: '#6b40d8',
    emissive: '#9b50ff',
    emissiveIntensity: 1.4,
    metalness: 0.5,
    roughness: 0.3,
  });
  const domeGeo = new THREE.SphereGeometry(PLASMA_MISSILES.domeRadius, 14, 10, 0, TAU, 0, Math.PI * 0.6);
  const wireGeo = new THREE.IcosahedronGeometry(PLASMA_MISSILES.domeRadius * 0.98, 1);
  const domeMat = new THREE.MeshBasicMaterial({
    color: '#8e44ff',
    transparent: true,
    opacity: 0.24,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    fog: false,
  });
  const wireMat = new THREE.MeshBasicMaterial({
    color: '#38e8ff',
    wireframe: true,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    fog: false,
  });
  sharedAssets = { missileGeo, missileMat, domeGeo, wireGeo, domeMat, wireMat };
  return sharedAssets;
}

function createDomeGroup(): THREE.Group {
  const a = getPlasmaAssets();
  const group = new THREE.Group();
  const shell = new THREE.Mesh(a.domeGeo, a.domeMat);
  const wire = new THREE.Mesh(a.wireGeo, a.wireMat);
  group.add(shell, wire);
  return group;
}

export class PlasmaMissilesShoulder implements FrameShoulderWeapon {
  readonly kind = 'plasmaMissiles' as const;
  readonly painter = new Painter(PLASMA_MISSILES.paintEvery);

  ammo: number = PLASMA_MISSILES.cells;
  reloading = -1;

  private readonly salvo: (MissileTarget | null)[] = [];
  private salvoGap = 0;
  private cellCursor = 0;
  private readonly blindPoint = new THREE.Vector3();
  private blindFloorY = 0;

  private readonly missiles: VlsMissile[] = Array.from({ length: PLASMA_MISSILES.maxMissiles }, () => ({
    active: false,
    pos: new THREE.Vector3(),
    vel: new THREE.Vector3(),
    fallbackPoint: new THREE.Vector3(),
    target: null,
    age: 0,
    floorY: 0,
    trailClock: 0,
    mesh: null,
  }));

  private readonly domes: PlasmaDome[] = Array.from({ length: PLASMA_MISSILES.maxDomes }, () => ({
    active: false,
    center: new THREE.Vector3(),
    remaining: 0,
    tickClock: 0,
    fxClock: 0,
    mesh: null,
  }));

  constructor(private readonly ctx: Ctx) {}

  get marks(): readonly MissileTarget[] {
    return this.painter.marks;
  }

  get activeMissileCount(): number {
    let n = 0;
    for (let i = 0; i < this.missiles.length; i++) if (this.missiles[i]!.active) n++;
    return n;
  }

  get activeDomeCount(): number {
    let n = 0;
    for (let i = 0; i < this.domes.length; i++) if (this.domes[i]!.active) n++;
    return n;
  }

  get reloadProgress(): number {
    return this.reloading < 0 ? -1 : clamp(1 - this.reloading / PLASMA_MISSILES.reload, 0, 1);
  }

  update(dt: number, u: ShoulderUpdateContext): void {
    const { audio } = this.ctx;

    if (this.reloading >= 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) {
        this.reloading = -1;
        this.ammo = PLASMA_MISSILES.cells;
        audio?.play?.('reload_rocket', { volume: 0.85, pitch: 1.08 });
      }
    }

    // Drain staggered 6-missile VLS launch salvo.
    if (this.salvo.length > 0) {
      this.salvoGap -= dt;
      while (this.salvo.length > 0 && this.salvoGap <= 1e-6) {
        const nextTarget = this.salvo.shift()!;
        this.launchCell(nextTarget, u);
        this.salvoGap += PLASMA_MISSILES.salvoGap;
      }
      if (this.salvo.length === 0) {
        this.reloading = PLASMA_MISSILES.reload;
      }
    } else if (!u.online) {
      if (this.painter.painting) {
        this.painter.cancel();
        audio?.play?.('quiver_cancel', { volume: 0.7 });
      }
      if (u.pressed) audio?.play?.('weapon_dry');
    } else {
      if (u.pressed && (this.reloading >= 0 || this.ammo < PLASMA_MISSILES.cells)) {
        audio?.play?.('weapon_dry');
      }

      if (!this.painter.painting) {
        if (u.held && this.ammo === PLASMA_MISSILES.cells && this.reloading < 0) {
          this.painter.begin(PLASMA_MISSILES.cells);
          audio?.play?.('quiver_arm', { pitch: 1.15 });
        }
      } else if (u.held) {
        const marked = this.painter.update(dt, () =>
          u.gatherTargets(PLASMA_MISSILES.paintRange, PLASMA_MISSILES.paintConeCos),
        );
        if (marked) {
          audio?.play?.('quiver_lock', { pitch: 1.05 + (this.painter.marks.length - 1) * 0.11 });
          if (this.painter.full) audio?.play?.('quiver_full', { pitch: 1.1 });
        }
      } else {
        // Released trigger: launch 6 vertical plasma missiles onto painted targets (or crosshair point).
        const inView = u.gatherTargets(PLASMA_MISSILES.paintRange, PLASMA_MISSILES.paintConeCos);
        this.painter.release(this.salvo, this.ammo, inView);
        this.ammo = 0;
        this.salvoGap = 0;

        if (Number.isFinite(u.sight.range) && u.sight.range > NEAR_SIGHT) {
          this.blindPoint.copy(u.sight.point);
        } else {
          this.blindPoint.copy(u.sight.view.position).addScaledVector(u.sight.aim, 60);
        }
        this.blindFloorY = u.feet.y;

        // Immediately fire first VLS cell on release frame for crisp feel.
        if (this.salvo.length > 0) {
          const first = this.salvo.shift()!;
          this.launchCell(first, u);
          this.salvoGap = PLASMA_MISSILES.salvoGap;
          if (this.salvo.length === 0) {
            this.reloading = PLASMA_MISSILES.reload;
          }
        }
      }
    }

    this.stepMissiles(dt, u.onNews);
    this.stepDomes(dt);
  }

  idleUpdate(dt: number): void {
    if (this.painter.painting) this.painter.cancel();
    if (this.reloading >= 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) {
        this.reloading = -1;
        this.ammo = PLASMA_MISSILES.cells;
      }
    }
    this.stepMissiles(dt, null);
    this.stepDomes(dt);
  }

  fillRow(row: GunnerWeapon, keyLabel: string, _cycleKeyLabel: string, online: boolean): void {
    row.max = PLASMA_MISSILES.cells;
    row.selected = this.painter.painting || this.salvo.length > 0;
    if (!online) {
      row.name = `${keyLabel} PLASMA VLS // OFFLINE`;
      row.ammo = 0;
      row.reload = -1;
      return;
    }
    if (this.reloading >= 0) {
      row.name = `${keyLabel} PLASMA VLS // RELOAD`;
      row.ammo = 0;
      row.reload = this.reloadProgress;
      return;
    }
    if (this.painter.painting) {
      row.name = `${keyLabel} PLASMA VLS // PAINTING ${this.painter.marks.length}`;
      row.ammo = this.painter.marks.length;
      row.reload = -1;
      return;
    }
    row.name = `${keyLabel} PLASMA VLS // HOLD TO PAINT`;
    row.ammo = this.ammo;
    row.reload = -1;
  }

  silence(): void {
    if (this.painter.painting) this.painter.cancel();
  }

  reset(): void {
    this.painter.cancel();
    this.ammo = PLASMA_MISSILES.cells;
    this.reloading = -1;
    this.salvo.length = 0;
    this.salvoGap = 0;
    this.cellCursor = 0;
    for (let i = 0; i < this.missiles.length; i++) this.retireMissile(this.missiles[i]!);
    for (let i = 0; i < this.domes.length; i++) this.retireDome(this.domes[i]!);
  }

  private launchCell(target: MissileTarget | null, u: ShoulderUpdateContext): void {
    const { fx, audio, render, camera } = this.ctx;
    const slot = this.acquireMissile();
    if (!slot) return;

    const cell = this.cellCursor++ % PLASMA_MISSILES.cells;
    const col = (cell % 3) - 1;
    const row = cell < 3 ? -1 : 1;

    u.mountPos(_mount);
    const sinY = Math.sin(u.torsoYaw);
    const cosY = Math.cos(u.torsoYaw);
    _right.set(cosY, 0, -sinY);
    _fwd.set(-sinY, 0, -cosY);

    slot.active = true;
    slot.age = 0;
    slot.trailClock = 0;
    slot.target = target;
    slot.floorY = this.blindFloorY;
    slot.pos
      .copy(_mount)
      .addScaledVector(_right, col * 0.28)
      .addScaledVector(_fwd, -row * 0.2);
    slot.pos.y += 0.85;

    // Slight radial spread for untargeted blind salvos so the 6 plasma domes blanket the crosshair zone.
    if (target) {
      slot.fallbackPoint.copy(target.center);
    } else {
      const ang = (cell / PLASMA_MISSILES.cells) * TAU;
      const spreadR = 2.6;
      slot.fallbackPoint.set(
        this.blindPoint.x + Math.cos(ang) * spreadR,
        this.blindPoint.y,
        this.blindPoint.z + Math.sin(ang) * spreadR,
      );
    }

    // Launch straight UP out of the VLS shoulder cell with tiny cell fan.
    slot.vel.set(
      _right.x * col * 3.5 + _fwd.x * -row * 2.2,
      PLASMA_MISSILES.climbSpeed,
      _right.z * col * 3.5 + _fwd.z * -row * 2.2,
    );

    this.attachMissileMesh(slot);
    fx?.smoke?.(slot.pos, 0x9b68ff, 0.85, 1.0);
    fx?.sparks?.(slot.pos, UP, 6, '#b060ff');
    render?.lights?.flash?.(slot.pos, 0x9b50ff, 4.5, 9, 0.08);
    audio?.play?.('quiver_fire', { position: slot.pos, volume: 0.72, pitch: 1.15, pitchJitter: 0.06 });
    camera?.addTrauma?.(0.05);

    u.onNews?.('plasmaMissiles', [0, slot.pos.x, slot.pos.y, slot.pos.z]);
  }

  private acquireMissile(): VlsMissile | null {
    for (let i = 0; i < this.missiles.length; i++) {
      if (!this.missiles[i]!.active) return this.missiles[i]!;
    }
    return null;
  }

  private attachMissileMesh(m: VlsMissile): void {
    const scene = this.ctx.render?.scene;
    if (!scene || typeof scene.add !== 'function') return;
    if (!m.mesh) {
      const a = getPlasmaAssets();
      m.mesh = new THREE.Mesh(a.missileGeo, a.missileMat);
    }
    if (m.mesh.parent !== scene) scene.add(m.mesh);
    m.mesh.visible = true;
    m.mesh.position.copy(m.pos);
  }

  private retireMissile(m: VlsMissile): void {
    m.active = false;
    m.target = null;
    m.age = 0;
    if (m.mesh) {
      m.mesh.visible = false;
      m.mesh.parent?.remove(m.mesh);
    }
  }

  private stepMissiles(dt: number, onNews: ShoulderUpdateContext['onNews']): void {
    if (dt <= 0) return;
    const { physics, enemies, fx } = this.ctx;

    for (let i = 0; i < this.missiles.length; i++) {
      const m = this.missiles[i]!;
      if (!m.active) continue;

      m.age += dt;
      if (m.target && m.target.alive) {
        _dest.copy(m.target.center);
        _dest.y += m.target.aimLift ?? 0;
        m.fallbackPoint.copy(_dest);
      } else {
        m.target = null;
        _dest.copy(m.fallbackPoint);
      }

      // Vertical climb phase -> pitch over and dive onto target.
      if (m.age >= PLASMA_MISSILES.climbDuration) {
        const curSpeed = m.vel.length();
        if (curSpeed > 1e-4) _curDir.copy(m.vel).divideScalar(curSpeed);
        else _curDir.copy(UP);

        _toDest.subVectors(_dest, m.pos);
        const dist = _toDest.length();
        if (dist > 1e-4) _desDir.copy(_toDest).divideScalar(dist);
        else _desDir.copy(_curDir);

        const maxTurn = (dist < 12 ? PLASMA_MISSILES.turnRate * 1.9 : PLASMA_MISSILES.turnRate) * dt;
        const dot = clamp(_curDir.dot(_desDir), -1, 1);
        const angle = Math.acos(dot);
        if (angle <= maxTurn || angle < 1e-4) {
          _curDir.copy(_desDir);
        } else {
          _curDir.lerp(_desDir, maxTurn / angle).normalize();
        }
        const nextSpeed = Math.min(PLASMA_MISSILES.diveSpeed, curSpeed + 45 * dt);
        m.vel.copy(_curDir).multiplyScalar(nextSpeed);
      }

      _next.copy(m.pos).addScaledVector(m.vel, dt);
      _step.subVectors(_next, m.pos);
      const stepDist = _step.length();
      if (stepDist > 1e-4) _curDir.copy(_step).divideScalar(stepDist);

      // Proximity contact with destination point.
      _aimPoint.subVectors(_dest, m.pos);
      const proj = clamp(_aimPoint.dot(_curDir), 0, stepDist);
      _toDest.copy(m.pos).addScaledVector(_curDir, proj);
      if (_toDest.distanceToSquared(_dest) <= PLASMA_MISSILES.contactRadius * PLASMA_MISSILES.contactRadius) {
        this.detonateMissile(m, _dest, onNews);
        continue;
      }

      // Enemy or world collision after vertical launch clearance.
      if (m.age >= PLASMA_MISSILES.climbDuration * 0.6 && stepDist > 1e-4) {
        const eHit = enemies?.raycast?.(m.pos, _curDir, stepDist + 0.4);
        if (eHit && eHit.enemy.alive) {
          this.detonateMissile(m, eHit.point, onNews);
          continue;
        }
        const wHit = physics?.raycast?.(m.pos, _curDir, stepDist + 0.3, CG.World);
        if (wHit) {
          this.detonateMissile(m, wHit.point, onNews);
          continue;
        }
      }

      if (m.age >= PLASMA_MISSILES.maxLifetime || (m.age > PLASMA_MISSILES.climbDuration && _next.y <= m.floorY)) {
        this.detonateMissile(m, _next, onNews);
        continue;
      }

      m.pos.copy(_next);
      if (m.mesh) {
        m.mesh.position.copy(m.pos);
        if (stepDist > 1e-4) {
          _quat.setFromUnitVectors(FORWARD_Z, _curDir);
          m.mesh.quaternion.copy(_quat);
        }
      }

      m.trailClock += dt;
      if (m.trailClock >= 0.05) {
        m.trailClock = 0;
        fx?.smoke?.(m.pos, 0x8e54ff, 0.42, 0.38);
      }
    }
  }

  private detonateMissile(
    m: VlsMissile,
    at: THREE.Vector3,
    onNews: ShoulderUpdateContext['onNews'],
  ): void {
    const { combat, fx, audio, render, camera } = this.ctx;

    combat?.explode?.(at, _impactBlast);
    fx?.explosion?.(at, { kind: 'plasma', radius: PLASMA_MISSILES.domeRadius, scale: 1.15 });
    fx?.ring?.(at, UP, '#9b50ff', PLASMA_MISSILES.domeRadius * 1.9);
    fx?.ring?.(at, UP, '#38e8ff', PLASMA_MISSILES.domeRadius * 1.2);
    fx?.sparks?.(at, UP, 20, '#b060ff');
    render?.lights?.flash?.(at, 0x9b50ff, 9, 14, 0.25);
    audio?.play?.('plasma_burst', { position: at, volume: 0.85, pitch: 0.96, pitchJitter: 0.08 });
    camera?.addTrauma?.(0.1);

    onNews?.('plasmaMissiles', [1, at.x, at.y, at.z]);
    this.spawnPlasmaDome(at);
    this.retireMissile(m);
  }

  private spawnPlasmaDome(center: THREE.Vector3): void {
    let slot: PlasmaDome | null = null;
    for (let i = 0; i < this.domes.length; i++) {
      if (!this.domes[i]!.active) {
        slot = this.domes[i]!;
        break;
      }
    }
    if (!slot) slot = this.domes[0]!;

    slot.active = true;
    slot.center.copy(center);
    slot.remaining = PLASMA_MISSILES.domeDuration;
    slot.tickClock = PLASMA_MISSILES.domeTickInterval;
    slot.fxClock = 0;

    const scene = this.ctx.render?.scene;
    if (scene && typeof scene.add === 'function') {
      if (!slot.mesh) slot.mesh = createDomeGroup();
      if (slot.mesh.parent !== scene) scene.add(slot.mesh);
      slot.mesh.visible = true;
      slot.mesh.position.copy(center);
      slot.mesh.scale.setScalar(1);
    }
  }

  private retireDome(d: PlasmaDome): void {
    d.active = false;
    d.remaining = 0;
    d.tickClock = 0;
    d.fxClock = 0;
    if (d.mesh) {
      d.mesh.visible = false;
      d.mesh.parent?.remove(d.mesh);
    }
  }

  private stepDomes(dt: number): void {
    if (dt <= 0) return;
    const { enemies, fx, render } = this.ctx;
    const r2 = PLASMA_MISSILES.domeRadius * PLASMA_MISSILES.domeRadius;

    for (let i = 0; i < this.domes.length; i++) {
      const d = this.domes[i]!;
      if (!d.active) continue;

      d.remaining -= dt;
      if (d.remaining <= 0) {
        this.retireDome(d);
        continue;
      }

      // Animate dome shimmer & shrink slightly as it collapses.
      if (d.mesh) {
        const lifeFrac = clamp(d.remaining / PLASMA_MISSILES.domeDuration, 0, 1);
        const s = lifeFrac < 0.25 ? 0.35 + (lifeFrac / 0.25) * 0.65 : 1 + Math.sin(d.remaining * 14) * 0.03;
        d.mesh.scale.setScalar(s);
        d.mesh.rotation.y += dt * 0.85;
      }

      // Deal 90 DPS in crisp 0.25 s ticks to all alive enemies inside the 5.0 m plasma dome.
      d.tickClock -= dt;
      while (d.tickClock <= 1e-6) {
        d.tickClock += PLASMA_MISSILES.domeTickInterval;
        if (enemies && typeof enemies.applyDamage === 'function') {
          _nearby.length = 0;
          if (enemies.alive && enemies.alive.length > 0) {
            for (let j = 0; j < enemies.alive.length; j++) {
              const e = enemies.alive[j]!;
              if (!e.alive) continue;
              if (e.center.distanceToSquared(d.center) <= r2) _nearby.push(e);
            }
          } else if (typeof enemies.query === 'function') {
            const count = enemies.query(d.center, PLASMA_MISSILES.domeRadius, _nearby) || 0;
            if (_nearby.length > count) _nearby.length = count;
          }

          for (let j = 0; j < _nearby.length; j++) {
            const e = _nearby[j]!;
            if (!e.alive) continue;
            _domeDamage.amount = PLASMA_MISSILES.domeDps * PLASMA_MISSILES.domeTickInterval;
            _domeDamage.point.copy(e.center);
            enemies.applyDamage(e, _domeDamage);
          }
        }
      }

      // Periodic violet/cyan plasma crackle FX inside lingering dome.
      d.fxClock += dt;
      if (d.fxClock >= 0.35) {
        d.fxClock -= 0.35;
        fx?.sparks?.(d.center, UP, 5, '#38e8ff');
        render?.lights?.flash?.(d.center, 0x8e44ff, 4.2, 8.5, 0.14);
      }
    }
  }
}

/** Co-op playback for teammates when a Vertical Plasma Missile launches or bursts. */
export function playRemotePlasmaMissiles(ctx: Ctx, kind: MechKind, values: number[]): void {
  if (kind !== 'plasmaMissiles' || values.length < 4) return;
  const phase = values[0]!;
  _rPos.set(values[1]!, values[2]!, values[3]!);
  if (phase < 0.5) {
    ctx.fx?.smoke?.(_rPos, 0x9b68ff, 0.8, 0.9);
    ctx.audio?.play?.('quiver_fire', { position: _rPos, volume: 0.65, pitch: 1.15 });
  } else {
    ctx.fx?.explosion?.(_rPos, { kind: 'plasma', radius: PLASMA_MISSILES.domeRadius, scale: 1.1 });
    ctx.fx?.ring?.(_rPos, UP, '#9b50ff', PLASMA_MISSILES.domeRadius * 1.8);
    ctx.render?.lights?.flash?.(_rPos, 0x9b50ff, 8, 13, 0.22);
    ctx.audio?.play?.('plasma_burst', { position: _rPos, volume: 0.78, pitch: 0.96 });
  }
}

export const PLASMA_MISSILES_PLUGIN: ShoulderPlugin = {
  kind: 'plasmaMissiles',
  newsKinds: ['plasmaMissiles'],
  create: ctx => new PlasmaMissilesShoulder(ctx),
  remoteNews: playRemotePlasmaMissiles,
};

export const PLASMA_MISSILES_SHOULDER = PLASMA_MISSILES_PLUGIN;
