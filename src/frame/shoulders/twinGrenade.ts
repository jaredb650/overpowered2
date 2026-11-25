/**
 * Twin Shoulder Grenade Cannon plug-in (`twinGrenade`).
 *
 * Fires a simultaneous twin-barrel barrage of 2 heavy 80 mm arcing shells on press.
 * Tap `3`/`4`/`5` (`hasCycle: true`) to toggle between `HE` (280 blast dmg, 8 m radius)
 * and `NAPALM` (140 blast dmg + lingering 7.5 m napalm carpet via `combat.napalmBurst`).
 * 4 twin-salvos (8 shells total), 0.85 s between salvos, 4.5 s full reload.
 */
import * as THREE from 'three';
import { CG, type Ctx } from '../../core/contracts';
import type { ExplosionSpec } from '../../core/gameplay';
import { clamp } from '../../core/math';
import type { MechKind } from '../../progression/callins/link';
import type { GunnerWeapon } from '../../vehicles/hud';
import { NEAR_SIGHT } from '../arms/shared';
import type { FrameShoulderWeapon, ShoulderPlugin, ShoulderUpdateContext } from './types';

export const TWIN_GRENADE_MODES = ['HE', 'NAPALM'] as const;
export type TwinGrenadeMode = (typeof TWIN_GRENADE_MODES)[number];

export const TWIN_GRENADE = {
  salvos: 4,
  shellsPerSalvo: 2,
  totalShells: 8,
  cadence: 0.85,
  reload: 4.5,
  launchSpeed: 68,
  gravity: 24,
  maxLifetime: 5.0,
  barrelOffset: 0.26,
  barrelSpread: 0.024,
  heDamage: 280,
  heRadius: 8.0,
  napalmDamage: 140,
  napalmRadius: 7.5,
  maxActiveShells: 16,
} as const;

type CombatWithNapalm = Ctx['combat'] & {
  napalmBurst?: (
    center: THREE.Vector3,
    velocity: THREE.Vector3,
    source: string,
    radius: number,
    cosmetic?: boolean,
  ) => void;
};

interface ArcShell {
  active: boolean;
  mode: TwinGrenadeMode;
  readonly pos: THREE.Vector3;
  readonly vel: THREE.Vector3;
  age: number;
  floorY: number;
  trailClock: number;
  mesh: THREE.Mesh | null;
}

const UP = new THREE.Vector3(0, 1, 0);
const FORWARD_Z = new THREE.Vector3(0, 0, -1);

const _mount = new THREE.Vector3();
const _right = new THREE.Vector3();
const _aimPoint = new THREE.Vector3();
const _toTarget = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _next = new THREE.Vector3();
const _step = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _rFrom = new THREE.Vector3();
const _rVel = new THREE.Vector3();
const _rDir = new THREE.Vector3();

const _heBlast: ExplosionSpec = {
  radius: TWIN_GRENADE.heRadius,
  damage: TWIN_GRENADE.heDamage,
  kind: 'grenade',
  source: 'frame_twin_he',
  team: 'player',
  selfDamage: 0,
  playerPush: 0,
  scale: 1.35,
  shake: 0.24,
};

const _napalmBlast: ExplosionSpec = {
  radius: TWIN_GRENADE.napalmRadius,
  damage: TWIN_GRENADE.napalmDamage,
  kind: 'grenade',
  source: 'frame_twin_napalm',
  team: 'player',
  selfDamage: 0,
  playerPush: 0,
  scale: 1.1,
  shake: 0.16,
};

let sharedShellGeo: THREE.BufferGeometry | null = null;
let sharedHeMat: THREE.MeshStandardMaterial | null = null;
let sharedNapalmMat: THREE.MeshStandardMaterial | null = null;

function makeShellMesh(mode: TwinGrenadeMode): THREE.Mesh {
  if (!sharedShellGeo) {
    sharedShellGeo = new THREE.CylinderGeometry(0.055, 0.075, 0.34, 8);
    sharedShellGeo.rotateX(Math.PI / 2);
  }
  if (!sharedHeMat) {
    sharedHeMat = new THREE.MeshStandardMaterial({
      color: '#d89b38',
      emissive: '#ff8820',
      emissiveIntensity: 0.8,
      metalness: 0.5,
      roughness: 0.35,
    });
  }
  if (!sharedNapalmMat) {
    sharedNapalmMat = new THREE.MeshStandardMaterial({
      color: '#c8341c',
      emissive: '#ff4414',
      emissiveIntensity: 1.1,
      metalness: 0.4,
      roughness: 0.35,
    });
  }
  return new THREE.Mesh(sharedShellGeo, mode === 'NAPALM' ? sharedNapalmMat : sharedHeMat);
}

export class TwinGrenadeShoulder implements FrameShoulderWeapon {
  readonly kind = 'twinGrenade' as const;
  readonly hasCycle = true;

  salvos: number = TWIN_GRENADE.salvos;
  modeIndex = 0;
  cooldown = 0;
  reloading = -1;

  private readonly pool: ArcShell[] = Array.from({ length: TWIN_GRENADE.maxActiveShells }, () => ({
    active: false,
    mode: 'HE',
    pos: new THREE.Vector3(),
    vel: new THREE.Vector3(),
    age: 0,
    floorY: 0,
    trailClock: 0,
    mesh: null,
  }));

  constructor(private readonly ctx: Ctx) {}

  get mode(): TwinGrenadeMode {
    return TWIN_GRENADE_MODES[this.modeIndex]!;
  }

  /** Remaining shells across all salvos (`0..8`). */
  get shells(): number {
    return this.salvos * TWIN_GRENADE.shellsPerSalvo;
  }

  /** Number of currently airborne 80 mm shells. */
  get activeShellCount(): number {
    let n = 0;
    for (let i = 0; i < this.pool.length; i++) if (this.pool[i]!.active) n++;
    return n;
  }

  get reloadProgress(): number {
    return this.reloading < 0 ? -1 : clamp(1 - this.reloading / TWIN_GRENADE.reload, 0, 1);
  }

  cycleMode(): TwinGrenadeMode {
    this.modeIndex = (this.modeIndex + 1) % TWIN_GRENADE_MODES.length;
    return this.mode;
  }

  update(dt: number, u: ShoulderUpdateContext): void {
    this.tickTimers(dt);

    if (u.cyclePressed) {
      const next = this.cycleMode();
      this.ctx.audio?.play?.('veh_seat_click', { pitch: next === 'NAPALM' ? 1.14 : 0.92, volume: 0.6 });
    }

    if (u.pressed) {
      if (!u.online || this.reloading >= 0 || this.salvos <= 0 || this.cooldown > 1e-6) {
        this.ctx.audio?.play?.('weapon_dry');
      } else {
        this.fireSalvo(u);
      }
    }

    this.stepShells(dt);
  }

  idleUpdate(dt: number): void {
    this.tickTimers(dt);
    this.stepShells(dt);
  }

  fillRow(row: GunnerWeapon, keyLabel: string, cycleKeyLabel: string, online: boolean): void {
    row.max = TWIN_GRENADE.totalShells;
    row.selected = false;
    if (!online) {
      row.name = `${keyLabel} TWIN 80MM // OFFLINE`;
      row.ammo = 0;
      row.reload = -1;
      return;
    }
    if (this.reloading >= 0) {
      row.name = `${keyLabel} TWIN 80MM [${this.mode}] // RELOAD`;
      row.ammo = 0;
      row.reload = this.reloadProgress;
      return;
    }
    row.name = `${keyLabel} TWIN 80MM [${this.mode}] // ${cycleKeyLabel}`;
    row.ammo = this.shells;
    row.reload = -1;
  }

  silence(): void {
    // No persistent loops to stop; airborne shells finish cleanly.
  }

  reset(): void {
    this.salvos = TWIN_GRENADE.salvos;
    this.modeIndex = 0;
    this.cooldown = 0;
    this.reloading = -1;
    for (let i = 0; i < this.pool.length; i++) {
      this.retireShell(this.pool[i]!);
    }
  }

  private tickTimers(dt: number): void {
    if (this.cooldown > 0) this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.reloading >= 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) {
        this.reloading = -1;
        this.salvos = TWIN_GRENADE.salvos;
        this.ctx.audio?.play?.('reload_rocket', { volume: 0.85, pitch: 0.92 });
      }
    }
  }

  private fireSalvo(u: ShoulderUpdateContext): void {
    const { audio, fx, camera, render } = this.ctx;
    this.salvos--;
    this.cooldown = TWIN_GRENADE.cadence;
    if (this.salvos <= 0) {
      this.reloading = TWIN_GRENADE.reload;
    }

    u.mountPos(_mount);
    _right.crossVectors(u.sight.aim, UP);
    if (_right.lengthSq() < 1e-4) _right.set(1, 0, 0);
    else _right.normalize();

    if (Number.isFinite(u.sight.range) && u.sight.range > NEAR_SIGHT) {
      _aimPoint.copy(u.sight.point);
    } else {
      _aimPoint.copy(u.sight.view.position).addScaledVector(u.sight.aim, 55);
    }

    const mode = this.mode;
    const modeIdx = this.modeIndex;

    for (let b = 0; b < TWIN_GRENADE.shellsPerSalvo; b++) {
      const side = b === 0 ? -1 : 1;
      const slot = this.acquireShell();
      if (!slot) break;

      slot.active = true;
      slot.mode = mode;
      slot.age = 0;
      slot.trailClock = 0;
      slot.floorY = u.feet.y;
      slot.pos.copy(_mount).addScaledVector(_right, side * TWIN_GRENADE.barrelOffset);

      // Compute ballistic launch velocity with gravity arc compensation toward `_aimPoint`.
      _toTarget.subVectors(_aimPoint, slot.pos);
      const dist = _toTarget.length();
      if (dist > 1e-3) {
        _dir.copy(_toTarget).divideScalar(dist);
      } else {
        _dir.copy(u.sight.aim).normalize();
      }
      _dir.addScaledVector(_right, side * TWIN_GRENADE.barrelSpread).normalize();

      const speed = TWIN_GRENADE.launchSpeed;
      const horizDist = Math.hypot(_toTarget.x, _toTarget.z);
      const flightEst = clamp(horizDist / speed, 0.12, 2.2);
      const arcLift = 0.5 * TWIN_GRENADE.gravity * flightEst;

      slot.vel.copy(_dir).multiplyScalar(speed);
      slot.vel.y += arcLift;

      this.attachShellMesh(slot);
      u.onNews?.('twinGrenade', [
        modeIdx,
        slot.pos.x, slot.pos.y, slot.pos.z,
        slot.vel.x, slot.vel.y, slot.vel.z,
      ]);

      fx?.muzzleFlash?.(slot.pos, _dir, 'rocket');
      fx?.smoke?.(slot.pos, mode === 'NAPALM' ? 0x663826 : 0xb8b2a8, 0.95, 1.1);
    }

    render?.lights?.flash?.(_mount, mode === 'NAPALM' ? 0xff5518 : 0xffaa38, 6.5, 11, 0.1);
    audio?.play?.('mgl_shot', { position: _mount, volume: 1.0, pitch: 0.72 });
    audio?.play?.('mortar_tube', { position: _mount, volume: 0.65, pitch: 1.08 });
    camera?.addTrauma?.(0.18);
  }

  private acquireShell(): ArcShell | null {
    for (let i = 0; i < this.pool.length; i++) {
      if (!this.pool[i]!.active) return this.pool[i]!;
    }
    return null;
  }

  private attachShellMesh(slot: ArcShell): void {
    const scene = this.ctx.render?.scene;
    if (!scene || typeof scene.add !== 'function') return;
    if (!slot.mesh) {
      slot.mesh = makeShellMesh(slot.mode);
    } else if (sharedHeMat && sharedNapalmMat) {
      slot.mesh.material = slot.mode === 'NAPALM' ? sharedNapalmMat : sharedHeMat;
    }
    if (slot.mesh.parent !== scene) scene.add(slot.mesh);
    slot.mesh.visible = true;
    slot.mesh.position.copy(slot.pos);
  }

  private retireShell(slot: ArcShell): void {
    slot.active = false;
    slot.age = 0;
    if (slot.mesh) {
      slot.mesh.visible = false;
      slot.mesh.parent?.remove(slot.mesh);
    }
  }

  private stepShells(dt: number): void {
    if (dt <= 0) return;
    const { physics, enemies, fx } = this.ctx;

    for (let i = 0; i < this.pool.length; i++) {
      const s = this.pool[i]!;
      if (!s.active) continue;

      s.age += dt;
      s.vel.y -= TWIN_GRENADE.gravity * dt;
      _next.copy(s.pos).addScaledVector(s.vel, dt);
      _step.subVectors(_next, s.pos);
      const stepDist = _step.length();

      if (stepDist > 1e-4) {
        _dir.copy(_step).divideScalar(stepDist);

        // Enemy direct hit check.
        const enemyHit = enemies?.raycast?.(s.pos, _dir, stepDist + 0.35);
        if (enemyHit && enemyHit.enemy.alive) {
          this.detonateShell(s, enemyHit.point, enemyHit.normal);
          continue;
        }

        // World geometry collision check.
        const wall = physics?.raycast?.(s.pos, _dir, stepDist + 0.25, CG.World);
        if (wall) {
          this.detonateShell(s, wall.point, wall.normal);
          continue;
        }
      }

      // Ground fallback & max lifetime detonation.
      if (_next.y <= s.floorY || s.age >= TWIN_GRENADE.maxLifetime) {
        _next.y = Math.max(_next.y, s.floorY);
        this.detonateShell(s, _next, UP);
        continue;
      }

      s.pos.copy(_next);
      if (s.mesh) {
        s.mesh.position.copy(s.pos);
        if (stepDist > 1e-4) {
          _quat.setFromUnitVectors(FORWARD_Z, _dir);
          s.mesh.quaternion.copy(_quat);
        }
      }

      s.trailClock += dt;
      if (s.trailClock >= 0.045) {
        s.trailClock = 0;
        fx?.smoke?.(s.pos, s.mode === 'NAPALM' ? 0xff6a22 : 0xc8c2b8, 0.55, 0.45);
      }
    }
  }

  private detonateShell(shell: ArcShell, hit: THREE.Vector3, normal: THREE.Vector3): void {
    const { combat, fx, audio, render, camera } = this.ctx;
    _normal.copy(normal);
    if (_normal.lengthSq() < 1e-4) _normal.copy(UP);

    if (shell.mode === 'HE') {
      _heBlast.normal = _normal;
      combat?.explode?.(hit, _heBlast);
      fx?.explosion?.(hit, { kind: 'grenade', radius: TWIN_GRENADE.heRadius, scale: 1.3, normal: _normal });
      fx?.ring?.(hit, _normal, '#ffaa40', TWIN_GRENADE.heRadius * 1.4);
      fx?.sparks?.(hit, _normal, 24, '#ffcc66');
      render?.lights?.flash?.(hit, 0xffaa38, 10, 14, 0.22);
      audio?.play?.('30mmshell_explode', { position: hit, volume: 1.0, pitch: 0.78 });
    } else {
      _napalmBlast.normal = _normal;
      combat?.explode?.(hit, _napalmBlast);
      (combat as CombatWithNapalm)?.napalmBurst?.(
        hit,
        shell.vel,
        'frame_twin_napalm',
        TWIN_GRENADE.napalmRadius,
      );
      fx?.explosion?.(hit, { kind: 'grenade', radius: TWIN_GRENADE.napalmRadius, scale: 1.15, normal: _normal });
      fx?.ring?.(hit, _normal, '#ff4818', TWIN_GRENADE.napalmRadius * 1.5);
      fx?.sparks?.(hit, _normal, 26, '#ff6820');
      render?.lights?.flash?.(hit, 0xff5218, 11, 15, 0.28);
      audio?.play?.('30mmshell_explode', { position: hit, volume: 0.9, pitch: 0.68 });
    }

    camera?.addTrauma?.(0.14);
    this.retireShell(shell);
  }
}

/** Co-op visual playback when a teammate fires the Twin Grenade Cannon. */
export function playRemoteTwinGrenade(ctx: Ctx, kind: MechKind, values: number[]): void {
  if (kind !== 'twinGrenade' || values.length < 7) return;
  const isNapalm = values[0]! > 0.5;
  _rFrom.set(values[1]!, values[2]!, values[3]!);
  _rVel.set(values[4]!, values[5]!, values[6]!);
  const len = _rVel.length();
  if (len > 1e-4) _rDir.copy(_rVel).divideScalar(len);
  else _rDir.set(0, 0, -1);

  ctx.fx?.muzzleFlash?.(_rFrom, _rDir, 'rocket');
  ctx.fx?.smoke?.(_rFrom, isNapalm ? 0xff6a22 : 0xb8b2a8, 0.9, 1.0);
  ctx.render?.lights?.flash?.(_rFrom, isNapalm ? 0xff5518 : 0xffaa38, 5, 9, 0.08);
  ctx.audio?.play?.('mgl_shot', { position: _rFrom, volume: 0.85, pitch: 0.72 });
}

export const TWIN_GRENADE_PLUGIN: ShoulderPlugin = {
  kind: 'twinGrenade',
  newsKinds: ['twinGrenade'],
  create: ctx => new TwinGrenadeShoulder(ctx),
  remoteNews: playRemoteTwinGrenade,
};

export const TWIN_GRENADE_SHOULDER = TWIN_GRENADE_PLUGIN;
