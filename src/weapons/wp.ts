/**
 * White Phosphorus burning cloud (`rocketWp` alternate ammo on the Rocket launcher, toggled with hold R).
 *
 * On impact a WP rocket leaves a billowing 6 m-diameter (3 m-radius) chemical cloud lasting 12 s. Unlike a floor-only
 * napalm patch, the WP cloud tests enemies against the full 3D sphere of the cloud (feet-to-head capsule segment), so
 * it catches enemies at chest height, on stairs, and on elevated walkways as they walk through, igniting them with
 * burn status and chemical-fire ticks. Co-op cosmetic playback (`cosmetic = true`) draws the full white smoke plumes,
 * embers, and ground fire while skipping all damage and status affliction.
 */
import * as THREE from 'three';
import { CG, type Ctx, type DamageInfo, type RayHit } from '../core/contracts';
import type { EnemyInstance } from '../core/gameplay';
import { clamp, rand } from '../core/math';
import { closestOnSegment } from './geometry';

export const WP = {
  /** Cloud diameter across, metres. */
  diameter: 6,
  /** Cloud 3D sphere radius, metres (6 m across). */
  radius: 3,
  /** How long each burning WP cloud persists, seconds. */
  duration: 12,
  /** Trailing fade-out window at the end of `duration`, seconds. */
  fade: 2.5,
  /** Small initial WP impact blast radius, metres (for caller's impact explosion tuning). */
  impactRadius: 3.5,
  /** Small initial WP impact blast damage (for caller's impact explosion tuning). */
  impactDamage: 65,
  /** Seconds between burn/damage checks for enemies inside the 3D cloud. */
  tick: 0.25,
  /** Direct chemical-fire damage applied on each tick inside the cloud. */
  tickDamage: 14,
  /** Burn affliction duration refreshed whenever an enemy is inside the cloud, seconds. */
  burnSeconds: 6,
  /** Seconds between billowing white smoke & ember puffs per cloud. */
  puffEvery: 0.16,
  /** Seconds between cool white-hot light pulses per cloud. */
  lightEvery: 0.35,
  /** Capsule padding around enemy bodies, metres. */
  bodyPad: 0.35,
  /** Default enemy standing height fallback when `char.rig.height` is absent (headless mocks), metres. */
  defaultHeight: 1.8,
  /** Pooled simultaneous clouds (oldest evicted when full). */
  maxClouds: 16,
} as const;

interface CloudSlot {
  live: boolean;
  serial: number;
  age: number;
  duration: number;
  radius: number;
  cosmetic: boolean;
  source: string;
  tickIn: number;
  puffIn: number;
  lightIn: number;
  hasFloor: boolean;
  center: THREE.Vector3;
  floorPos: THREE.Vector3;
}

const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
const _pt = new THREE.Vector3();
const _feet = new THREE.Vector3();
const _head = new THREE.Vector3();
const _closest = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _near: EnemyInstance[] = [];
const _hit: RayHit = {
  point: new THREE.Vector3(),
  normal: new THREE.Vector3(),
  distance: 0,
  surface: 'concrete',
  collider: null,
};
const _dmg: DamageInfo = {
  amount: WP.tickDamage,
  type: 'fire',
  point: new THREE.Vector3(),
  dir: new THREE.Vector3(0, 1, 0),
  force: 0.5,
  source: 'rocket_wp',
};

function makeSlot(): CloudSlot {
  return {
    live: false,
    serial: 0,
    age: 0,
    duration: WP.duration,
    radius: WP.radius,
    cosmetic: false,
    source: 'rocket_wp',
    tickIn: 0,
    puffIn: 0,
    lightIn: 0,
    hasFloor: false,
    center: new THREE.Vector3(),
    floorPos: new THREE.Vector3(),
  };
}

/**
 * Pooled White Phosphorus burning cloud manager.
 *
 * Hook into `Weapons.ts` / `Projectiles.ts` / `watch.ts`:
 * - `spawn(center, source, cosmetic?)` on WP rocket detonation
 * - `update(dt)` each world step
 * - `reset()` on level/match reset
 */
export class WpCloud {
  private readonly pool: CloudSlot[] = Array.from({ length: WP.maxClouds }, makeSlot);
  private _activeCount = 0;
  private serial = 0;

  constructor(private readonly ctx: Ctx) {}

  /** Number of currently burning WP clouds. */
  get activeCount(): number {
    return this._activeCount;
  }

  /** Spawns a 6 m (radius 3 m) burning WP cloud at `center` lasting 12 s, plus its initial white-hot WP burst FX. */
  spawn(center: THREE.Vector3, source: string, cosmetic = false): void {
    let slot: CloudSlot | null = null;
    let oldest = this.pool[0]!;
    for (let i = 0; i < WP.maxClouds; i++) {
      const s = this.pool[i]!;
      if (!s.live) {
        slot = s;
        this._activeCount++;
        break;
      }
      if (s.serial < oldest.serial) oldest = s;
    }
    const c = slot ?? oldest;
    c.live = true;
    c.serial = ++this.serial;
    c.age = 0;
    c.duration = WP.duration;
    c.radius = WP.radius;
    c.cosmetic = cosmetic;
    c.source = source || 'rocket_wp';
    c.tickIn = 0;
    c.puffIn = 0;
    c.lightIn = 0;
    c.center.copy(center);
    c.hasFloor = this.probeFloor(center, c.floorPos);

    this.burstFx(c);
  }

  /** Advances all active WP clouds by `dt` seconds, emitting white plumes/fire and igniting enemies in 3D range. */
  update(dt: number): void {
    if (dt <= 0 || this._activeCount === 0) return;
    const ctx = this.ctx;
    const thin = Math.min(1, 3 / Math.max(1, this._activeCount));

    for (let i = 0; i < WP.maxClouds; i++) {
      const c = this.pool[i]!;
      if (!c.live) continue;
      c.age += dt;
      if (c.age >= c.duration) {
        c.live = false;
        this._activeCount--;
        continue;
      }

      const heat = clamp((c.duration - c.age) / WP.fade);

      // Reuse Kiln ground burning flames when a floor sits underneath the cloud.
      if (c.hasFloor) {
        ctx.fx?.napalm?.(c.floorPos, UP, c.radius * 0.85, heat * thin * 0.5);
      }

      // Billowing bright white phosphorus chemical smoke plumes + white-hot embers throughout the 3D sphere.
      c.puffIn -= dt;
      if (c.puffIn <= 0) {
        c.puffIn = WP.puffEvery;
        const theta = rand(0, Math.PI * 2);
        const u = rand(-0.6, 1.0);
        const rHoriz = Math.sqrt(Math.max(0, 1 - u * u)) * Math.cbrt(Math.random()) * c.radius * 0.85;
        _pt.set(
          c.center.x + Math.cos(theta) * rHoriz,
          c.center.y + u * c.radius * 0.65,
          c.center.z + Math.sin(theta) * rHoriz,
        );
        ctx.fx?.smoke?.(_pt, 0xf4f7fa, c.radius * rand(0.45, 0.72) * (0.45 + 0.55 * heat), rand(2.2, 3.8));
        if (Math.random() < heat) {
          ctx.fx?.sparks?.(_pt, UP, 3, '#f6faff');
          ctx.fx?.embers?.(_pt, 3, c.radius * 0.55);
        }
      }

      // Periodic cool white-hot glow illuminating the smoke cloud (visible from afar).
      c.lightIn -= dt;
      if (c.lightIn <= 0) {
        c.lightIn = WP.lightEvery;
        _pt.set(c.center.x, c.center.y + 0.8, c.center.z);
        ctx.render?.lights?.flash?.(_pt, 0xf0f6ff, 13 * heat * thin, c.radius * 2.8, WP.lightEvery + 0.04);
      }

      // Airborne 3D sphere/capsule check: catches enemies at chest height, on stairs, and on elevated walkways.
      c.tickIn -= dt;
      if (c.tickIn <= 0) {
        c.tickIn = WP.tick;
        if (!c.cosmetic) this.burnInCloud(c);
      }
    }
  }

  /** Clears all active WP clouds (e.g. on level restart). */
  reset(): void {
    for (let i = 0; i < WP.maxClouds; i++) this.pool[i]!.live = false;
    this._activeCount = 0;
  }

  private probeFloor(center: THREE.Vector3, out: THREE.Vector3): boolean {
    const physics = this.ctx.physics;
    _pt.set(center.x, center.y + 0.25, center.z);
    if (physics && typeof physics.raycastInto === 'function') {
      if (physics.raycastInto(_pt, DOWN, WP.radius + 1.2, CG.World, _hit)) {
        out.copy(_hit.point);
        return true;
      }
    } else if (physics && typeof physics.raycast === 'function') {
      const h = physics.raycast(_pt, DOWN, WP.radius + 1.2, CG.World);
      if (h) {
        out.copy(h.point);
        return true;
      }
    }
    return false;
  }

  private burstFx(c: CloudSlot): void {
    const ctx = this.ctx;
    ctx.fx?.ring?.(c.center, UP, '#f4f8ff', c.radius * 2.2);
    ctx.fx?.sparks?.(c.center, UP, 28, '#ffffff');
    ctx.fx?.embers?.(c.center, 14, c.radius * 0.7);
    ctx.fx?.smoke?.(_pt.copy(c.center).setY(c.center.y + 0.8), 0xf4f7fa, c.radius * 1.15, 3.6);
    ctx.render?.lights?.flash?.(c.center, 0xf4f8ff, 26, c.radius * 4, 0.4);
    if (c.hasFloor) {
      ctx.render?.decals?.add?.('scorch', c.floorPos, UP, c.radius * 0.85, rand(0, Math.PI * 2));
    }
    ctx.audio?.play?.('flame_ignite', { position: c.center, volume: 0.95 });
    ctx.audio?.play?.('char_sizzle', { position: c.center, volume: 0.85 });
  }

  private burnInCloud(c: CloudSlot): void {
    const enemies = this.ctx.enemies;
    if (!enemies) return;
    const reach = c.radius + WP.bodyPad;
    const reach2 = reach * reach;

    let list: readonly EnemyInstance[];
    let count: number;
    if (typeof enemies.query === 'function') {
      count = enemies.query(c.center, c.radius + 2.6, _near) || 0;
      list = _near;
    } else if (Array.isArray(enemies.alive)) {
      list = enemies.alive;
      count = list.length;
    } else {
      return;
    }

    for (let i = 0; i < count; i++) {
      const e = list[i]!;
      if (!e.alive) continue;
      _feet.copy(e.position);
      const height = e.char?.rig?.height ?? WP.defaultHeight;
      _head.copy(e.position);
      _head.y += height;
      // Ensure the test capsule always spans e.center as well if a mock places center separately.
      if (e.center) {
        const minY = Math.min(_feet.y, e.center.y - 0.5);
        const maxY = Math.max(_head.y, e.center.y + 0.5);
        _feet.y = minY;
        _head.y = maxY;
      }
      closestOnSegment(c.center, _feet, _head, _closest);
      if (_closest.distanceToSquared(c.center) > reach2) continue;

      enemies.afflict?.(e, 'burn', WP.burnSeconds);
      if (typeof enemies.applyDamage === 'function') {
        _dmg.amount = WP.tickDamage;
        _dmg.source = c.source;
        _dmg.point.copy(_closest);
        _dir.subVectors(_closest, c.center);
        if (_dir.lengthSq() > 1e-6) _dmg.dir.copy(_dir).normalize();
        else _dmg.dir.copy(UP);
        enemies.applyDamage(e, _dmg);
      }
    }
    _near.length = 0;
  }
}
