/**
 * Shock-Needle Launcher plug-in (`arcNeedle`).
 *
 * Fires a lightning-fast electromagnetic harpoon needle (240 dmg direct hitscan, 140 m range,
 * 3 charges, 4.2 s per-charge refill). The needle embeds into the target or impact point for 0.9 s
 * (pulsing electric sparks + warning ping) then detonates in an 11 m electric shockwave (260 dmg)
 * that chains cyan lightning bolts (`fx.tracer` + `fx.arc`) to up to 4 nearby enemies (160 dmg each
 * + brief stun/knockback).
 */
import * as THREE from 'three';
import { CG, type Ctx, type DamageInfo } from '../../core/contracts';
import type { EnemyInstance, ExplosionSpec, ShotSpec } from '../../core/gameplay';
import { clamp } from '../../core/math';
import type { MechKind } from '../../progression/callins/link';
import type { GunnerWeapon } from '../../vehicles/hud';
import { NEAR_SIGHT } from '../arms/shared';
import type { FrameShoulderWeapon, ShoulderPlugin, ShoulderUpdateContext } from './types';

export const ARC_NEEDLE = {
  maxCharges: 3,
  refillSeconds: 4.2,
  cadence: 0.32,
  range: 140,
  directDamage: 240,
  embedDelay: 0.9,
  pingInterval: 0.22,
  shockRadius: 11,
  shockDamage: 260,
  chainMaxTargets: 4,
  chainDamage: 160,
  chainKnockback: 195,
  maxEmbedded: 8,
} as const;

interface EmbeddedNeedle {
  active: boolean;
  host: EnemyInstance | null;
  readonly pos: THREE.Vector3;
  readonly offset: THREE.Vector3;
  readonly dir: THREE.Vector3;
  timer: number;
  pingClock: number;
  mesh: THREE.Group | null;
}

const UP = new THREE.Vector3(0, 1, 0);
const FORWARD_Z = new THREE.Vector3(0, 0, -1);

const _mount = new THREE.Vector3();
const _aimPoint = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _negDir = new THREE.Vector3();
const _hitPoint = new THREE.Vector3();
const _chainFrom = new THREE.Vector3();
const _chainDir = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _nearby: EnemyInstance[] = [];
const _candidates: { enemy: EnemyInstance; d2: number }[] = [];
const _rFrom = new THREE.Vector3();
const _rTo = new THREE.Vector3();

const _directDamage: DamageInfo = {
  amount: ARC_NEEDLE.directDamage,
  type: 'shock',
  point: new THREE.Vector3(),
  dir: new THREE.Vector3(),
  force: 95,
  source: 'frame_arc_needle',
  armorPiercing: true,
};

const _chainDamage: DamageInfo = {
  amount: ARC_NEEDLE.chainDamage,
  type: 'shock',
  point: new THREE.Vector3(),
  dir: new THREE.Vector3(),
  force: ARC_NEEDLE.chainKnockback,
  source: 'frame_arc_chain',
};

const _shockBlast: ExplosionSpec = {
  radius: ARC_NEEDLE.shockRadius,
  damage: ARC_NEEDLE.shockDamage,
  kind: 'plasmaBurst',
  source: 'frame_arc_shock',
  team: 'player',
  selfDamage: 0,
  playerPush: 0,
  scale: 1.15,
  shake: 0.24,
};

const _fallbackRayShot: ShotSpec = {
  damage: ARC_NEEDLE.directDamage,
  source: 'frame_arc_needle',
  team: 'player',
  maxDistance: ARC_NEEDLE.range,
  type: 'shock',
  tracer: 'rail',
  armorPiercing: true,
  force: 95,
};

let sharedSpikeGeo: THREE.BufferGeometry | null = null;
let sharedCoilGeo: THREE.BufferGeometry | null = null;
let sharedSpikeMat: THREE.MeshStandardMaterial | null = null;
let sharedCoilMat: THREE.MeshBasicMaterial | null = null;

function createNeedleMesh(): THREE.Group {
  if (!sharedSpikeGeo) {
    sharedSpikeGeo = new THREE.CylinderGeometry(0.015, 0.04, 0.9, 6);
    sharedSpikeGeo.rotateX(Math.PI / 2);
  }
  if (!sharedCoilGeo) {
    sharedCoilGeo = new THREE.CylinderGeometry(0.055, 0.055, 0.14, 8);
    sharedCoilGeo.rotateX(Math.PI / 2);
  }
  if (!sharedSpikeMat) {
    sharedSpikeMat = new THREE.MeshStandardMaterial({ color: '#788492', metalness: 0.85, roughness: 0.28 });
  }
  if (!sharedCoilMat) {
    sharedCoilMat = new THREE.MeshBasicMaterial({ color: '#40f0ff', toneMapped: false, fog: false });
  }
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(sharedSpikeGeo, sharedSpikeMat);
  g.add(shaft);
  const coil = new THREE.Mesh(sharedCoilGeo, sharedCoilMat);
  coil.position.z = 0.25;
  g.add(coil);
  return g;
}

export class ArcNeedleShoulder implements FrameShoulderWeapon {
  readonly kind = 'arcNeedle' as const;

  charges: number = ARC_NEEDLE.maxCharges;
  private refillIn = 0;
  private cadence = 0;

  private readonly embedded: EmbeddedNeedle[] = Array.from({ length: ARC_NEEDLE.maxEmbedded }, () => ({
    active: false,
    host: null,
    pos: new THREE.Vector3(),
    offset: new THREE.Vector3(),
    dir: new THREE.Vector3(0, 0, -1),
    timer: 0,
    pingClock: 0,
    mesh: null,
  }));

  constructor(private readonly ctx: Ctx) {}

  get embeddedCount(): number {
    let n = 0;
    for (let i = 0; i < this.embedded.length; i++) if (this.embedded[i]!.active) n++;
    return n;
  }

  get refillProgress(): number {
    return this.charges < ARC_NEEDLE.maxCharges
      ? clamp(1 - this.refillIn / ARC_NEEDLE.refillSeconds, 0, 1)
      : -1;
  }

  update(dt: number, u: ShoulderUpdateContext): void {
    this.tickClocks(dt);

    if (u.pressed) {
      if (!u.online || this.charges <= 0 || this.cadence > 1e-6) {
        this.ctx.audio?.play?.('weapon_dry');
      } else {
        this.fireNeedle(u);
      }
    }

    this.stepEmbedded(dt, u.onNews);
  }

  idleUpdate(dt: number): void {
    this.tickClocks(dt);
    this.stepEmbedded(dt, null);
  }

  fillRow(row: GunnerWeapon, keyLabel: string, _cycleKeyLabel: string, online: boolean): void {
    row.max = ARC_NEEDLE.maxCharges;
    row.selected = this.embeddedCount > 0;
    if (!online) {
      row.name = `${keyLabel} ARC NEEDLE // OFFLINE`;
      row.ammo = 0;
      row.reload = -1;
      return;
    }
    const armed = this.embeddedCount;
    row.name = armed > 0
      ? `${keyLabel} ARC NEEDLE [${armed} ARMED]`
      : `${keyLabel} ARC NEEDLE`;
    row.ammo = this.charges;
    row.reload = this.refillProgress;
  }

  silence(): void {
    // No persistent loops.
  }

  reset(): void {
    this.charges = ARC_NEEDLE.maxCharges;
    this.refillIn = 0;
    this.cadence = 0;
    for (let i = 0; i < this.embedded.length; i++) {
      this.retireNeedle(this.embedded[i]!);
    }
  }

  private tickClocks(dt: number): void {
    if (this.cadence > 0) this.cadence = Math.max(0, this.cadence - dt);
    if (this.charges < ARC_NEEDLE.maxCharges) {
      this.refillIn -= dt;
      while (this.refillIn <= 1e-6 && this.charges < ARC_NEEDLE.maxCharges) {
        this.charges++;
        this.refillIn = this.charges < ARC_NEEDLE.maxCharges
          ? this.refillIn + ARC_NEEDLE.refillSeconds
          : 0;
        this.ctx.audio?.play?.('reload_cell', { volume: 0.72, pitch: 1.18 });
      }
    } else {
      this.refillIn = 0;
    }
  }

  private fireNeedle(u: ShoulderUpdateContext): void {
    const { enemies, physics, combat, fx, audio, render, camera } = this.ctx;
    const wasFull = this.charges === ARC_NEEDLE.maxCharges;
    this.charges--;
    this.cadence = ARC_NEEDLE.cadence;
    if (wasFull) this.refillIn = ARC_NEEDLE.refillSeconds;

    u.mountPos(_mount);
    if (Number.isFinite(u.sight.range) && u.sight.range > NEAR_SIGHT) {
      _aimPoint.copy(u.sight.point);
    } else {
      _aimPoint.copy(u.sight.view.position).addScaledVector(u.sight.aim, ARC_NEEDLE.range);
    }

    _dir.subVectors(_aimPoint, _mount);
    if (_dir.lengthSq() > 1e-4) _dir.normalize();
    else _dir.copy(u.sight.aim).normalize();
    _negDir.copy(_dir).negate();

    // Fast hitscan resolution: enemy vs world geometry up to 140 m.
    const wallHit = physics?.raycast?.(_mount, _dir, ARC_NEEDLE.range, CG.World) ?? null;
    const enemyLimit = wallHit ? wallHit.distance : ARC_NEEDLE.range;
    const enemyHit = enemies?.raycast?.(_mount, _dir, enemyLimit) ?? null;

    let host: EnemyInstance | null = null;
    if (enemyHit && enemyHit.enemy.alive) {
      host = enemyHit.enemy;
      _hitPoint.copy(enemyHit.point);
      _directDamage.amount = ARC_NEEDLE.directDamage;
      _directDamage.point.copy(_hitPoint);
      _directDamage.dir.copy(_dir);
      enemies?.applyDamage?.(host, _directDamage);
    } else if (wallHit) {
      _hitPoint.copy(wallHit.point);
      enemies?.vehicles?.shot?.(wallHit.collider, _hitPoint, ARC_NEEDLE.directDamage, 'frame_arc_needle');
    } else if (typeof combat?.fireRay === 'function') {
      _fallbackRayShot.tracerFrom = _mount;
      const res = combat.fireRay(_mount, _dir, _fallbackRayShot);
      _hitPoint.copy(res.end);
    } else {
      const dist = clamp(
        Number.isFinite(u.sight.range) && u.sight.range > NEAR_SIGHT ? _mount.distanceTo(_aimPoint) : ARC_NEEDLE.range,
        4,
        ARC_NEEDLE.range,
      );
      _hitPoint.copy(_mount).addScaledVector(_dir, dist);
    }

    // Visual & audio firing signature.
    fx?.tracer?.(_mount, _hitPoint, 'rail');
    fx?.beam?.(_mount, _hitPoint, 'rail', 0.08, 0.14);
    fx?.muzzleFlash?.(_mount, _dir, 'railgun');
    fx?.sparks?.(_hitPoint, _negDir, 14, '#40f0ff');
    render?.lights?.flash?.(_mount, 0x38e8ff, 7, 12, 0.1);
    audio?.play?.('railgun_fire', { position: _mount, volume: 0.88, pitch: 1.38 });
    camera?.addTrauma?.(0.14);

    u.onNews?.('arcNeedle', [0, _mount.x, _mount.y, _mount.z, _hitPoint.x, _hitPoint.y, _hitPoint.z]);

    // Embed the needle for 0.9 s delayed chain-lightning detonation.
    const slot = this.acquireNeedle();
    if (slot) {
      slot.active = true;
      slot.host = host;
      slot.pos.copy(_hitPoint);
      slot.dir.copy(_dir);
      if (host) slot.offset.subVectors(_hitPoint, host.center);
      else slot.offset.set(0, 0, 0);
      slot.timer = ARC_NEEDLE.embedDelay;
      slot.pingClock = 0;
      this.attachNeedleMesh(slot);
    }
  }

  private acquireNeedle(): EmbeddedNeedle | null {
    for (let i = 0; i < this.embedded.length; i++) {
      if (!this.embedded[i]!.active) return this.embedded[i]!;
    }
    return this.embedded[0]!;
  }

  private attachNeedleMesh(slot: EmbeddedNeedle): void {
    const scene = this.ctx.render?.scene;
    if (!scene || typeof scene.add !== 'function') return;
    if (!slot.mesh) slot.mesh = createNeedleMesh();
    if (slot.mesh.parent !== scene) scene.add(slot.mesh);
    slot.mesh.visible = true;
    slot.mesh.position.copy(slot.pos);
    _quat.setFromUnitVectors(FORWARD_Z, slot.dir);
    slot.mesh.quaternion.copy(_quat);
  }

  private retireNeedle(slot: EmbeddedNeedle): void {
    slot.active = false;
    slot.host = null;
    slot.timer = 0;
    slot.pingClock = 0;
    if (slot.mesh) {
      slot.mesh.visible = false;
      slot.mesh.parent?.remove(slot.mesh);
    }
  }

  private stepEmbedded(dt: number, onNews: ShoulderUpdateContext['onNews']): void {
    if (dt <= 0) return;
    const { fx, audio, render } = this.ctx;

    for (let i = 0; i < this.embedded.length; i++) {
      const n = this.embedded[i]!;
      if (!n.active) continue;

      if (n.host && n.host.alive) {
        n.pos.copy(n.host.center).add(n.offset);
      }
      if (n.mesh) {
        n.mesh.position.copy(n.pos);
      }

      n.timer -= dt;
      if (n.timer <= 1e-6) {
        this.detonateNeedle(n, onNews);
        continue;
      }

      // Pulsing electric warning sparks & rising pitch ping while embedded.
      n.pingClock += dt;
      if (n.pingClock >= ARC_NEEDLE.pingInterval) {
        n.pingClock -= ARC_NEEDLE.pingInterval;
        const progress = clamp(1 - n.timer / ARC_NEEDLE.embedDelay, 0, 1);
        fx?.sparks?.(n.pos, UP, 7, '#40f0ff');
        render?.lights?.flash?.(n.pos, 0x38e8ff, 4.5 + progress * 4, 8, 0.08);
        audio?.play?.('quiver_lock', { position: n.pos, volume: 0.55, pitch: 1.35 + progress * 0.65 });
      }
    }
  }

  private detonateNeedle(needle: EmbeddedNeedle, onNews: ShoulderUpdateContext['onNews']): void {
    const { combat, enemies, fx, audio, render, camera } = this.ctx;
    const center = needle.pos;

    // 11 m electric shockwave (260 dmg).
    combat?.explode?.(center, _shockBlast);
    fx?.ring?.(center, UP, '#40f0ff', ARC_NEEDLE.shockRadius * 1.35);
    fx?.sparks?.(center, UP, 30, '#60f6ff');
    render?.lights?.flash?.(center, 0x38e8ff, 12, 18, 0.26);
    audio?.play?.('lightning_strike', { position: center, volume: 1.0, pitch: 1.05 });
    camera?.addTrauma?.(0.2);

    onNews?.('arcNeedle', [1, center.x, center.y, center.z, 0, 0, 0]);

    // Chain cyan lightning bolts to up to 4 nearby enemies (160 dmg each + stun/knockback).
    if (enemies) {
      _nearby.length = 0;
      const r2 = ARC_NEEDLE.shockRadius * ARC_NEEDLE.shockRadius;
      if (enemies.alive && enemies.alive.length > 0) {
        for (let i = 0; i < enemies.alive.length; i++) {
          const e = enemies.alive[i]!;
          if (!e.alive || e === needle.host) continue;
          if (e.center.distanceToSquared(center) <= r2) _nearby.push(e);
        }
      } else if (typeof enemies.query === 'function') {
        const count = enemies.query(center, ARC_NEEDLE.shockRadius, _nearby) || 0;
        if (_nearby.length > count) _nearby.length = count;
      }

      _candidates.length = 0;
      for (let i = 0; i < _nearby.length; i++) {
        const e = _nearby[i]!;
        if (!e.alive || e === needle.host) continue;
        const d2 = e.center.distanceToSquared(center);
        if (d2 <= r2) _candidates.push({ enemy: e, d2 });
      }
      _candidates.sort((a, b) => a.d2 - b.d2);

      const chainCount = Math.min(_candidates.length, ARC_NEEDLE.chainMaxTargets);
      _chainFrom.copy(center);

      for (let i = 0; i < chainCount; i++) {
        const target = _candidates[i]!.enemy;
        _chainDir.subVectors(target.center, center);
        if (_chainDir.lengthSq() > 1e-4) _chainDir.normalize();
        else _chainDir.copy(UP);

        // Cyan lightning tracer + forked arc bolt.
        fx?.tracer?.(_chainFrom, target.center, 'rail');
        fx?.arc?.(_chainFrom, target.center, '#40f0ff', 0.28, 0.14);
        fx?.sparks?.(target.center, _chainDir, 10, '#60f6ff');
        audio?.play?.('lightning_arc', { position: target.center, volume: 0.72, pitch: 1.0 + i * 0.08 });

        // 160 shock damage + brief stun/knockback.
        _chainDamage.amount = ARC_NEEDLE.chainDamage;
        _chainDamage.point.copy(target.center);
        _chainDamage.dir.copy(_chainDir);
        _chainDamage.force = ARC_NEEDLE.chainKnockback;
        enemies.applyDamage?.(target, _chainDamage);

        // Apply brief electric stagger/knockback impulse.
        if (target.alive) {
          target.velocity?.addScaledVector?.(_chainDir, 5.5);
          if (target.velocity) target.velocity.y = Math.max(target.velocity.y, 2.2);
          target.char?.anim?.play?.('stagger', 1.15);
        }

        _chainFrom.copy(target.center);
      }
    }

    this.retireNeedle(needle);
  }
}

/** Co-op playback for teammates when an Arc Needle fires or detonates. */
export function playRemoteArcNeedle(ctx: Ctx, kind: MechKind, values: number[]): void {
  if (kind !== 'arcNeedle' || values.length < 7) return;
  const phase = values[0]!;
  _rFrom.set(values[1]!, values[2]!, values[3]!);
  if (phase < 0.5) {
    _rTo.set(values[4]!, values[5]!, values[6]!);
    ctx.fx?.tracer?.(_rFrom, _rTo, 'rail');
    ctx.fx?.beam?.(_rFrom, _rTo, 'rail', 0.07, 0.12);
    ctx.fx?.sparks?.(_rTo, UP, 10, '#40f0ff');
    ctx.audio?.play?.('railgun_fire', { position: _rFrom, volume: 0.78, pitch: 1.38 });
  } else {
    ctx.fx?.ring?.(_rFrom, UP, '#40f0ff', ARC_NEEDLE.shockRadius * 1.3);
    ctx.fx?.sparks?.(_rFrom, UP, 24, '#60f6ff');
    ctx.render?.lights?.flash?.(_rFrom, 0x38e8ff, 11, 16, 0.24);
    ctx.audio?.play?.('lightning_strike', { position: _rFrom, volume: 0.9, pitch: 1.05 });
  }
}

export const ARC_NEEDLE_PLUGIN: ShoulderPlugin = {
  kind: 'arcNeedle',
  newsKinds: ['arcNeedle'],
  create: ctx => new ArcNeedleShoulder(ctx),
  remoteNews: playRemoteArcNeedle,
};

export const ARC_NEEDLE_SHOULDER = ARC_NEEDLE_PLUGIN;
