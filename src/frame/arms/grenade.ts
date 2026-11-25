/**
 * 60 mm Dual-Mode Grenade Launcher arm weapon plug-in (`src/frame/arms/grenade.ts`).
 *
 *   - 6-round revolving drum magazine, 0.62 s fire interval, 2.6 s drum reload (`R` manual reload when < 6).
 *   - Tap `1` (left arm) / `2` (right arm) switches cleanly between `HE` (High Explosive) and `NAPALM` (Incendiary).
 *   - Fires arcing 60 mm ballistic grenades (`52 m/s`, `gravity: 16`) tracked with `physics.raycastInto` and enemy
 *     proximity tests so HE blasts and Napalm carpets (`combat.napalmBurst`) trigger deterministically on impact.
 *   - Indexes the 6-chamber revolving drum by `Math.PI / 3` (60°) per shot via `u.arm.turn`.
 */
import * as THREE from 'three';
import { CG, type Ctx, type DamageInfo, type PlayOptions, type RayHit } from '../../core/contracts';
import type { EnemyInstance, ExplosionSpec } from '../../core/gameplay';
import { TAU, clamp, rand } from '../../core/math';
import { Magazine } from '../../progression/callins/ac130Guns';
import type { MechKind } from '../../progression/callins/link';
import type { GunnerWeapon } from '../../vehicles/hud';
import { NEAR_SIGHT } from './shared';
import type { ArmPlugin, ArmUpdateContext, FrameArmGun } from './types';

export type GrenadeMode = 'HE' | 'NAPALM';

export const GRENADE_LAUNCHER = {
  magazine: 6,
  interval: 0.62,
  reload: 2.6,
  speed: 52,
  gravity: 16,
  maxLifetime: 6.0,
  proxRadius: 1.15,
  /** Slight upward loft added to straight-line aim so 60 mm shells arc cleanly over low cover. */
  loft: 0.09,
  he: {
    directDamage: 260,
    blastDamage: 240,
    radius: 7.5,
    force: 95,
  },
  napalm: {
    impactDamage: 120,
    blastRadius: 5.5,
    napalmRadius: 7.0,
    force: 45,
  },
  recoilSlide: 0.42,
  trauma: 0.24,
  kick: 0.024,
} as const;

interface CombatWithNapalm {
  napalmBurst?(
    center: THREE.Vector3,
    velocity: THREE.Vector3,
    source: string,
    radius: number,
    cosmetic?: boolean,
  ): void;
}

interface FlightGrenade {
  active: boolean;
  mode: GrenadeMode;
  cosmetic: boolean;
  readonly pos: THREE.Vector3;
  readonly prev: THREE.Vector3;
  readonly vel: THREE.Vector3;
  age: number;
  trailAccum: number;
  mesh: THREE.Mesh | null;
}

const MAX_ACTIVE_GRENADES = 12;
const UP = new THREE.Vector3(0, 1, 0);

// Scratch vectors & structures (zero per-frame allocations in hot loops).
const _muzzle = new THREE.Vector3();
const _bore = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _seg = new THREE.Vector3();
const _segDir = new THREE.Vector3();
const _at = new THREE.Vector3();
const _hitPt = new THREE.Vector3();
const _hitNormal = new THREE.Vector3();
const _play: PlayOptions = {};
const _rayHit: RayHit = {
  point: new THREE.Vector3(),
  normal: new THREE.Vector3(),
  distance: 0,
  surface: 'concrete',
  collider: null,
};
const _directDmg: DamageInfo = {
  amount: 0,
  type: 'explosive',
  point: new THREE.Vector3(),
  dir: new THREE.Vector3(),
  force: GRENADE_LAUNCHER.he.force,
  source: 'frame_grenade_he',
};

const HE_BLAST: ExplosionSpec = {
  kind: 'grenade',
  source: 'frame_grenade_he',
  radius: GRENADE_LAUNCHER.he.radius,
  damage: GRENADE_LAUNCHER.he.blastDamage,
  shake: 0.08,
  team: 'player',
  selfDamage: 0,
  playerPush: 0,
  worldObject: true,
};

const NAPALM_BLAST: ExplosionSpec = {
  kind: 'shell',
  source: 'frame_grenade_napalm',
  radius: GRENADE_LAUNCHER.napalm.blastRadius,
  damage: GRENADE_LAUNCHER.napalm.impactDamage,
  shake: 0.05,
  team: 'player',
  selfDamage: 0,
  playerPush: 0,
  worldObject: true,
};

let _shellGeo: THREE.BufferGeometry | null = null;
let _heShellMat: THREE.MeshBasicMaterial | null = null;
let _napalmShellMat: THREE.MeshBasicMaterial | null = null;

function ensureShellAssets(): {
  geo: THREE.BufferGeometry;
  heMat: THREE.MeshBasicMaterial;
  napalmMat: THREE.MeshBasicMaterial;
} {
  if (!_shellGeo) {
    _shellGeo = new THREE.SphereGeometry(0.14, 8, 6);
    _shellGeo.scale(0.85, 0.85, 1.85);
  }
  if (!_heShellMat) {
    _heShellMat = new THREE.MeshBasicMaterial({ color: 0xffcc55, toneMapped: false, fog: false });
  }
  if (!_napalmShellMat) {
    _napalmShellMat = new THREE.MeshBasicMaterial({ color: 0xff4414, toneMapped: false, fog: false });
  }
  return { geo: _shellGeo, heMat: _heShellMat, napalmMat: _napalmShellMat };
}

/** Pure clock for the 6-round revolving drum grenade launcher and HE / NAPALM selector. */
export class GrenadeClock {
  readonly mag = new Magazine(
    GRENADE_LAUNCHER.magazine,
    GRENADE_LAUNCHER.reload,
    GRENADE_LAUNCHER.interval,
  );
  mode: GrenadeMode = 'HE';

  toggleMode(): GrenadeMode {
    this.mode = this.mode === 'HE' ? 'NAPALM' : 'HE';
    return this.mode;
  }

  /** Starts a manual reload when partially spent (< 6 rounds). Returns true if a reload began. */
  startReload(): boolean {
    if (this.mag.reloading >= 0 || this.mag.ammo >= this.mag.size) return false;
    this.mag.ammo = 0;
    this.mag.reloading = this.mag.reload;
    return true;
  }

  reset(): void {
    this.mag.ammo = this.mag.size;
    this.mag.reloading = -1;
    this.mode = 'HE';
  }
}

/** Shared detonation handler for both local player grenades and co-op cosmetic grenades. */
export function detonateGrenade(
  ctx: Ctx,
  mode: GrenadeMode,
  point: THREE.Vector3,
  normal: THREE.Vector3,
  vel: THREE.Vector3,
  directEnemy: EnemyInstance | null,
  cosmetic = false,
): void {
  const { combat, fx, audio, enemies, physics, world, render } = ctx;
  _at.copy(point).addScaledVector(normal, 0.25);

  if (mode === 'HE') {
    if (!cosmetic) {
      if (directEnemy && directEnemy.alive) {
        _directDmg.amount = GRENADE_LAUNCHER.he.directDamage;
        _directDmg.type = 'explosive';
        _directDmg.point.copy(point);
        _directDmg.dir.copy(vel);
        if (_directDmg.dir.lengthSq() > 1e-6) _directDmg.dir.normalize();
        else _directDmg.dir.copy(UP);
        _directDmg.force = GRENADE_LAUNCHER.he.force;
        _directDmg.source = 'frame_grenade_he';
        _directDmg.gib = true;
        enemies?.applyDamage?.(directEnemy, _directDmg);
        _directDmg.gib = false;
      }
      HE_BLAST.normal = normal;
      HE_BLAST.cosmetic = false;
      combat?.explode?.(_at, HE_BLAST);
      physics?.radialImpulse?.(_at, GRENADE_LAUNCHER.he.radius, GRENADE_LAUNCHER.he.force);
      world?.objects?.damageExplosivesInRadius?.(
        _at,
        GRENADE_LAUNCHER.he.radius,
        GRENADE_LAUNCHER.he.blastDamage,
        'frame_grenade_he',
      );
      enemies?.vehicles?.frameBlow?.(
        _at,
        GRENADE_LAUNCHER.he.radius,
        GRENADE_LAUNCHER.he.directDamage,
        normal,
        'frame_grenade_he',
      );
    }

    fx?.explosion?.(point, { kind: 'grenade', radius: GRENADE_LAUNCHER.he.radius, scale: 1.25, normal });
    fx?.ring?.(point, normal, '#ffaa38', GRENADE_LAUNCHER.he.radius * 1.25);
    fx?.sparks?.(point, normal, 26, '#ffcc66');
    fx?.chips?.(point, 0x6a645d, 22);
    fx?.smoke?.(_at, 0x3b3835, 3.2, 2.2);
    render?.decals?.add?.('scorch', point, normal, 5.4, rand(0, TAU));
    render?.lights?.flash?.(_at, 0xffa838, 12, 16, 0.22);
    audio?.play?.('30mmshell_explode', { position: point, volume: 1.05, pitch: 0.72 });
    audio?.play?.('explosion_debris', { position: point, volume: 0.85, pitch: 0.86 });
    return;
  }

  // NAPALM mode: fiery impact + persistent burning napalm pool carpet.
  if (!cosmetic) {
    if (directEnemy && directEnemy.alive) {
      _directDmg.amount = GRENADE_LAUNCHER.napalm.impactDamage;
      _directDmg.type = 'fire';
      _directDmg.point.copy(point);
      _directDmg.dir.copy(vel);
      if (_directDmg.dir.lengthSq() > 1e-6) _directDmg.dir.normalize();
      else _directDmg.dir.copy(UP);
      _directDmg.force = GRENADE_LAUNCHER.napalm.force;
      _directDmg.source = 'frame_grenade_napalm';
      _directDmg.gib = false;
      enemies?.applyDamage?.(directEnemy, _directDmg);
    }
    NAPALM_BLAST.normal = normal;
    NAPALM_BLAST.cosmetic = false;
    combat?.explode?.(_at, NAPALM_BLAST);
    world?.objects?.damageExplosivesInRadius?.(
      _at,
      GRENADE_LAUNCHER.napalm.blastRadius,
      GRENADE_LAUNCHER.napalm.impactDamage,
      'frame_grenade_napalm',
    );
    enemies?.vehicles?.frameBlow?.(
      _at,
      GRENADE_LAUNCHER.napalm.blastRadius,
      GRENADE_LAUNCHER.napalm.impactDamage,
      normal,
      'frame_grenade_napalm',
    );
  }

  const napalmCombat = combat as unknown as CombatWithNapalm | undefined;
  napalmCombat?.napalmBurst?.(
    point,
    vel,
    'frame_grenade_napalm',
    GRENADE_LAUNCHER.napalm.napalmRadius,
    cosmetic,
  );

  fx?.explosion?.(point, { kind: 'shell', radius: GRENADE_LAUNCHER.napalm.blastRadius, scale: 1.05, normal });
  fx?.ring?.(point, normal, '#ff4818', GRENADE_LAUNCHER.napalm.napalmRadius * 1.15);
  fx?.sparks?.(point, normal, 28, '#ff6e24');
  fx?.flame?.(point, normal, 10);
  fx?.embers?.(point, 18, 2.4);
  fx?.heatShimmer?.(point, GRENADE_LAUNCHER.napalm.napalmRadius, 2.0);
  render?.decals?.add?.('soot', point, normal, 6.2, rand(0, TAU));
  render?.lights?.flash?.(_at, 0xff5518, 14, 18, 0.32);
  audio?.play?.('flame_ignite', { position: point, volume: 0.96, pitch: 0.78 });
  audio?.play?.('30mmshell_explode', { position: point, volume: 0.82, pitch: 0.64 });
}

export class GrenadeArmGun implements FrameArmGun {
  readonly kind = 'grenade' as const;
  readonly clock = new GrenadeClock();
  private readonly pool: FlightGrenade[] = Array.from({ length: MAX_ACTIVE_GRENADES }, () => ({
    active: false,
    mode: 'HE',
    cosmetic: false,
    pos: new THREE.Vector3(),
    prev: new THREE.Vector3(),
    vel: new THREE.Vector3(),
    age: 0,
    trailAccum: 0,
    mesh: null,
  }));
  private glowPulse = 0;

  constructor(private readonly ctx: Ctx) {}

  get firing(): boolean {
    return false;
  }

  /** Number of 60 mm grenades currently arcing through the air (useful for diagnostics/tests). */
  get activeProjectiles(): number {
    let n = 0;
    for (let i = 0; i < this.pool.length; i++) if (this.pool[i]!.active) n++;
    return n;
  }

  update(dt: number, u: ArmUpdateContext): void {
    const { audio } = this.ctx;
    const mag = this.clock.mag;
    const wasLoading = mag.reloading >= 0;
    mag.update(dt);
    this.stepGrenades(dt);

    if (wasLoading && mag.reloading < 0) {
      audio.play('reload_shell_in', { volume: 0.88, pitch: 0.72 });
      audio.play('metal_clang', { volume: 0.55, pitch: 1.05 });
    }

    if (u.cyclePressed) {
      const mode = this.clock.toggleMode();
      audio.play('reload_bolt', { pitch: mode === 'NAPALM' ? 0.94 : 0.78, volume: 0.86 });
      this.ctx.hud?.callout?.(
        mode === 'NAPALM' ? '60MM GL // NAPALM INCENDIARY' : '60MM GL // HIGH EXPLOSIVE',
      );
      this.glowPulse = 0.75;
    }

    if (u.reloadPressed && this.clock.startReload()) {
      audio.play('reload_bolt', { pitch: 0.64, volume: 0.82 });
    }

    if (u.held && mag.ready && mag.take()) {
      this.fire(u);
    } else if (u.pressed && mag.ammo === 0) {
      audio.play('weapon_dry', { pitch: 0.82 });
    }

    this.glowPulse = Math.max(0.2, this.glowPulse - dt * 1.8);
    u.arm.setActive?.(this.glowPulse, this.clock.mode === 'NAPALM' ? 1 : 0);
  }

  idleUpdate(dt: number): void {
    this.clock.mag.update(dt);
    this.stepGrenades(dt);
  }

  fillRow(row: GunnerWeapon, button: string, cycleKey: string): void {
    const mag = this.clock.mag;
    row.name = `${button} 60MM GL [${this.clock.mode}] // ${cycleKey}`;
    row.ammo = mag.ammo;
    row.max = GRENADE_LAUNCHER.magazine;
    row.reload = mag.progress;
    row.selected = this.clock.mode === 'NAPALM';
  }

  silence(): void {
    // No looping audio.
  }

  reset(): void {
    this.clock.reset();
    this.glowPulse = 0;
    for (let i = 0; i < this.pool.length; i++) {
      const g = this.pool[i]!;
      g.active = false;
      if (g.mesh) g.mesh.visible = false;
    }
  }

  /** Launches a single 60 mm grenade along the ballistic arc and indexes the revolving drum by 60°. */
  private fire(u: ArmUpdateContext): void {
    const { audio, camera, fx } = this.ctx;
    const mode = this.clock.mode;

    u.arm.muzzle(_muzzle);
    u.arm.bore(_bore);
    if (u.sight.range > NEAR_SIGHT) {
      _aim.copy(u.sight.point);
      _dir.subVectors(_aim, _muzzle).normalize();
    } else {
      _dir.copy(_bore).normalize();
    }

    // Crisp ballistic loft so shells arc gracefully over low walls while tracking near crosshair.
    const loftScale = clamp(u.sight.range / 48, 0.25, 1.25);
    _vel.copy(_dir).multiplyScalar(GRENADE_LAUNCHER.speed);
    _vel.y += GRENADE_LAUNCHER.speed * GRENADE_LAUNCHER.loft * loftScale;

    this.spawnGrenade(mode, _muzzle, _vel, false);

    // Index the 6-chamber revolving drum cylinder by 60° (Math.PI / 3).
    u.arm.turn(Math.PI / 3);
    u.arm.recoil(GRENADE_LAUNCHER.recoilSlide);
    this.glowPulse = 1.0;
    u.arm.setActive?.(1, mode === 'NAPALM' ? 1 : 0);

    fx?.muzzleFlash?.(_muzzle, _dir, 'autocannon');
    fx?.ring?.(_muzzle, _dir, mode === 'NAPALM' ? '#ff5418' : '#ffb840', 0.95);
    fx?.smoke?.(_at.copy(_muzzle).addScaledVector(_dir, 1.2), 0x8d939a, 0.85, 0.9);

    _play.volume = 1.1;
    _play.pitch = mode === 'NAPALM' ? 0.62 : 0.54;
    _play.position = undefined;
    audio.play('autocannon_fire', _play);
    audio.play('metal_clang', { volume: 0.35, pitch: 1.18 });

    if (u.recoilMult > 0) {
      camera.addTrauma?.(GRENADE_LAUNCHER.trauma * u.recoilMult);
      camera.kick?.(GRENADE_LAUNCHER.kick * u.recoilMult, rand(-0.004, 0.004) * u.recoilMult);
    }

    u.onNews?.('grenade', [
      mode === 'NAPALM' ? 1 : 0,
      _muzzle.x, _muzzle.y, _muzzle.z,
      _vel.x, _vel.y, _vel.z,
    ]);
  }

  private spawnGrenade(
    mode: GrenadeMode,
    origin: THREE.Vector3,
    velocity: THREE.Vector3,
    cosmetic: boolean,
  ): void {
    let slot: FlightGrenade | null = null;
    for (let i = 0; i < this.pool.length; i++) {
      if (!this.pool[i]!.active) {
        slot = this.pool[i]!;
        break;
      }
    }
    if (!slot) {
      // Reclaim oldest in-flight grenade if pool is saturated.
      slot = this.pool[0]!;
      for (let i = 1; i < this.pool.length; i++) {
        if (this.pool[i]!.age > slot.age) slot = this.pool[i]!;
      }
    }

    slot.active = true;
    slot.mode = mode;
    slot.cosmetic = cosmetic;
    slot.pos.copy(origin);
    slot.prev.copy(origin);
    slot.vel.copy(velocity);
    slot.age = 0;
    slot.trailAccum = 0;

    const scene = this.ctx.render?.scene;
    if (scene && typeof scene.add === 'function') {
      const { geo, heMat, napalmMat } = ensureShellAssets();
      if (!slot.mesh) {
        slot.mesh = new THREE.Mesh(geo, mode === 'NAPALM' ? napalmMat : heMat);
        slot.mesh.frustumCulled = false;
        scene.add(slot.mesh);
      } else {
        slot.mesh.material = mode === 'NAPALM' ? napalmMat : heMat;
      }
      slot.mesh.position.copy(origin);
      slot.mesh.visible = true;
    }
  }

  private stepGrenades(dt: number): void {
    if (dt <= 0) return;
    const { physics, enemies, fx } = this.ctx;
    const prox2 = GRENADE_LAUNCHER.proxRadius * GRENADE_LAUNCHER.proxRadius;

    for (let i = 0; i < this.pool.length; i++) {
      const g = this.pool[i]!;
      if (!g.active) continue;

      g.age += dt;
      g.prev.copy(g.pos);
      g.vel.y -= GRENADE_LAUNCHER.gravity * dt;
      g.pos.addScaledVector(g.vel, dt);

      _seg.subVectors(g.pos, g.prev);
      const segLen = _seg.length();
      if (segLen > 1e-5) {
        _segDir.copy(_seg).divideScalar(segLen);
      } else {
        _segDir.copy(g.vel);
        if (_segDir.lengthSq() > 1e-6) _segDir.normalize();
        else _segDir.set(0, -1, 0);
      }

      // Check world geometry impact along the step segment.
      let worldHitDist = Infinity;
      let hitWorld = false;
      if (segLen > 1e-5 && physics) {
        if (typeof physics.raycastInto === 'function') {
          if (physics.raycastInto(g.prev, _segDir, segLen, CG.World, _rayHit)) {
            worldHitDist = _rayHit.distance;
            _hitPt.copy(_rayHit.point);
            _hitNormal.copy(_rayHit.normal);
            hitWorld = true;
          }
        } else if (typeof physics.raycast === 'function') {
          const hit = physics.raycast(g.prev, _segDir, segLen, CG.World);
          if (hit) {
            worldHitDist = hit.distance;
            _hitPt.copy(hit.point);
            _hitNormal.copy(hit.normal);
            hitWorld = true;
          }
        }
      }

      // Check live enemies along the segment (closer than world impact).
      let directEnemy: EnemyInstance | null = null;
      let enemyHitDist = worldHitDist;
      const alive = enemies?.alive;
      if (!g.cosmetic && alive && alive.length > 0) {
        for (let k = 0; k < alive.length; k++) {
          const e = alive[k]!;
          if (!e.alive) continue;
          const dx = e.center.x - g.prev.x;
          const dy = e.center.y - g.prev.y;
          const dz = e.center.z - g.prev.z;
          const proj = clamp(dx * _segDir.x + dy * _segDir.y + dz * _segDir.z, 0, segLen);
          if (proj >= enemyHitDist) continue;
          const px = dx - _segDir.x * proj;
          const py = dy - _segDir.y * proj;
          const pz = dz - _segDir.z * proj;
          if (px * px + py * py + pz * pz <= prox2) {
            enemyHitDist = proj;
            directEnemy = e;
          }
        }
      }

      if (directEnemy) {
        _hitPt.copy(g.prev).addScaledVector(_segDir, enemyHitDist);
        _hitNormal.copy(_segDir).negate();
        this.retire(g);
        detonateGrenade(this.ctx, g.mode, _hitPt, _hitNormal, g.vel, directEnemy, g.cosmetic);
        continue;
      }

      if (hitWorld) {
        this.retire(g);
        detonateGrenade(this.ctx, g.mode, _hitPt, _hitNormal, g.vel, null, g.cosmetic);
        continue;
      }

      if (g.age >= GRENADE_LAUNCHER.maxLifetime) {
        _hitPt.copy(g.pos);
        _hitNormal.copy(UP);
        this.retire(g);
        detonateGrenade(this.ctx, g.mode, _hitPt, _hitNormal, g.vel, null, g.cosmetic);
        continue;
      }

      // Update visible glowing shell mesh & crisp incendiary/HE flight trail.
      if (g.mesh) {
        g.mesh.position.copy(g.pos);
        g.mesh.lookAt(g.pos.x + _segDir.x, g.pos.y + _segDir.y, g.pos.z + _segDir.z);
      }
      g.trailAccum += dt;
      if (g.trailAccum >= 0.032) {
        g.trailAccum = 0;
        if (g.mode === 'NAPALM') {
          fx?.tracer?.(g.prev, g.pos, 'dragon');
          fx?.flame?.(g.pos, _segDir, 2.5);
          fx?.embers?.(g.pos, 2, 0.35);
        } else {
          fx?.tracer?.(g.prev, g.pos, 'heavy');
          fx?.smoke?.(g.pos, 0xc8cdd4, 0.36, 0.55);
        }
      }
    }
  }

  private retire(g: FlightGrenade): void {
    g.active = false;
    if (g.mesh) g.mesh.visible = false;
  }
}

export const GRENADE_PLUGIN: ArmPlugin = {
  kind: 'grenade',
  newsKinds: ['grenade'],
  create: ctx => new GrenadeArmGun(ctx),
  remoteNews(ctx: Ctx, kind: MechKind, values: number[]): void {
    if (kind !== 'grenade' || values.length < 7) return;
    const mode: GrenadeMode = values[0]! >= 0.5 ? 'NAPALM' : 'HE';
    _muzzle.set(values[1]!, values[2]!, values[3]!);
    _vel.set(values[4]!, values[5]!, values[6]!);
    ctx.fx?.muzzleFlash?.(_muzzle, _dir.copy(_vel).normalize(), 'autocannon');
    _play.position = _muzzle;
    _play.volume = 0.85;
    _play.pitch = mode === 'NAPALM' ? 0.62 : 0.54;
    ctx.audio?.play?.('autocannon_fire', _play);
    // Estimate landing along arc and fire cosmetic impact immediately if remote player doesn't simulate flight.
    if (ctx.physics?.raycastInto && ctx.physics.raycastInto(_muzzle, _dir, 120, CG.World, _rayHit)) {
      detonateGrenade(ctx, mode, _rayHit.point, _rayHit.normal, _vel, null, true);
    }
  },
};
