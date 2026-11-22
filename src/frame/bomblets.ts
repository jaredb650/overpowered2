/**
 * Shared bomblet carpet submunition simulator used by both the Bomblet Cannon (`arms/cluster.ts`) and the Mortar Rack's
 * cluster round (`shoulders/mortar.ts`).
 *
 * Each bomblet is pooled (zero per-frame allocations), traces a ballistic trajectory with a single wall/geometry bounce
 * (restitution 0.45) before settling on the ground, and detonates in a staggered ripple across `spec.ripple` (0.7 s).
 *
 * In live gameplay (solo and co-op `remoteNews`), active bomblet fields automatically attach to `ctx.physics.preStep`
 * and detach the instant all bomblets finish. Pure unit tests without `preStep` step via `updateBomblets(dt)` or
 * `stepBombletsIfUnhooked(dt, ctx)`.
 */
import * as THREE from 'three';
import { CG, type Ctx, type RayHit } from '../core/contracts';
import type { ExplosionSpec } from '../core/gameplay';
import { clamp, rand } from '../core/math';

export interface BombletSpec {
  /** Number of bomblets in the carpet (e.g. 28 for Bomblet Cannon, 32 for Mortar Cluster). */
  count: number;
  /** Forward length of the carpet in metres (e.g. 14). */
  length: number;
  /** Side-to-side width of the carpet in metres (e.g. 9), or diameter when `circular` is true. */
  width: number;
  /** Ripple duration in seconds over which bomblets detonate (e.g. 0.7). */
  ripple: number;
  /** Blast radius per bomblet in metres (e.g. 2.4). */
  blastRadius: number;
  /** Blast damage per bomblet (e.g. 70). */
  damage: number;
  /** True for a mortar's overhead circular shower; false for a forward-thrown fan. */
  circular?: boolean;
  /** Damage source string. */
  source: string;
  /** Co-op cosmetic-only playback (no damage). */
  cosmetic?: boolean;
}

export const MAX_BOMBLETS = 128;
export const BOMBLET_GRAVITY = 24;
export const BOMBLET_RESTITUTION = 0.45;

const GOLDEN_RATIO = 0.61803398875;
const GOLDEN_ANGLE = 2.399963229728653;
const SKIN = 0.08;
const FLOOR_NORMAL_Y = 0.65;
const MAX_LIGHTS_PER_STEP = 2;
const MAX_FX_PER_STEP = 4;
const CRACKLE_GAP = 0.055;
const RAGDOLL_PUSH_SCALE = 1.65;
const RAGDOLL_PUSH_FORCE = 92;

interface Bomblet {
  live: boolean;
  serial: number;
  age: number;
  detonateAt: number;
  bounced: boolean;
  settled: boolean;
  blastRadius: number;
  damage: number;
  source: string;
  cosmetic: boolean;
  trailIn: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  normal: THREE.Vector3;
}

const UP = new THREE.Vector3(0, 1, 0);
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _step = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _hit: RayHit = {
  point: new THREE.Vector3(),
  normal: new THREE.Vector3(),
  distance: 0,
  surface: 'concrete',
  collider: null,
};
const _mat = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _color = new THREE.Color();
const _blast: ExplosionSpec = {
  radius: 2.4,
  damage: 70,
  kind: 'grenade',
  source: 'frame_cluster',
  team: 'player',
  selfDamage: 0,
  playerPush: 0,
  scale: 0.55,
  shake: 0.015,
};

/** Reflects `vel` across unit `normal` scaled by `restitution` (default 0.45). Mutates and returns `vel`. */
export function reflectBombletVelocity(
  vel: THREE.Vector3,
  normal: THREE.Vector3,
  restitution: number = BOMBLET_RESTITUTION,
): THREE.Vector3 {
  const vn = vel.dot(normal);
  if (vn < 0) vel.addScaledVector(normal, -2 * vn);
  vel.multiplyScalar(restitution);
  return vel;
}

function makeBomblet(): Bomblet {
  return {
    live: false,
    serial: 0,
    age: 0,
    detonateAt: 0,
    bounced: false,
    settled: false,
    blastRadius: 2.4,
    damage: 70,
    source: 'frame_cluster',
    cosmetic: false,
    trailIn: 0,
    pos: new THREE.Vector3(),
    vel: new THREE.Vector3(),
    normal: new THREE.Vector3(0, 1, 0),
  };
}

class BombletField {
  readonly pool: Bomblet[] = Array.from({ length: MAX_BOMBLETS }, makeBomblet);
  active = 0;
  hooked = false;
  private serial = 0;
  private soundClock = 0;
  private mesh: THREE.InstancedMesh | null = null;
  private readonly onPreStep = (dt: number): void => {
    this.step(dt);
  };

  constructor(private readonly ctx: Ctx) {}

  private ensureMesh(): THREE.InstancedMesh | null {
    if (this.mesh) return this.mesh;
    const scene = this.ctx.render?.scene;
    if (!scene || typeof scene.add !== 'function') return null;
    const geo = new THREE.OctahedronGeometry(0.15, 1);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    const mesh = new THREE.InstancedMesh(geo, mat, MAX_BOMBLETS);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.visible = false;
    mesh.name = 'frame.bomblets';
    scene.add(mesh);
    this.mesh = mesh;
    return mesh;
  }

  private attach(): void {
    if (this.hooked) return;
    const preStep = this.ctx.physics?.preStep;
    if (preStep && typeof preStep.add === 'function') {
      preStep.add(this.onPreStep);
      this.hooked = true;
    }
  }

  private detach(): void {
    if (!this.hooked) return;
    const preStep = this.ctx.physics?.preStep;
    if (preStep && typeof preStep.delete === 'function') preStep.delete(this.onPreStep);
    this.hooked = false;
  }

  private alloc(): Bomblet {
    let oldest = this.pool[0]!;
    for (let i = 0; i < MAX_BOMBLETS; i++) {
      const b = this.pool[i]!;
      if (!b.live) {
        this.active++;
        return b;
      }
      if (b.serial < oldest.serial) oldest = b;
    }
    return oldest;
  }

  spawnCarpet(origin: THREE.Vector3, dir: THREE.Vector3, spec: BombletSpec): void {
    const count = Math.max(1, Math.min(MAX_BOMBLETS, Math.round(spec.count)));
    const ripple = Math.max(0, spec.ripple);
    const circular = spec.circular === true;
    const cosmetic = spec.cosmetic === true;

    _fwd.set(dir.x, 0, dir.z);
    if (_fwd.lengthSq() < 1e-4) _fwd.set(0, 0, -1);
    else _fwd.normalize();
    _right.crossVectors(_fwd, UP).normalize();

    const seedOffset = Math.random();
    const seedAngle = Math.random() * Math.PI * 2;
    const baseDelay = circular ? 0.45 : 0.18;

    for (let i = 0; i < count; i++) {
      const b = this.alloc();
      b.live = true;
      b.serial = ++this.serial;
      b.age = 0;
      b.bounced = false;
      b.settled = false;
      b.blastRadius = spec.blastRadius;
      b.damage = spec.damage;
      b.source = spec.source;
      b.cosmetic = cosmetic;
      b.trailIn = rand(0.02, 0.07);
      b.pos.copy(origin);
      b.normal.copy(UP);

      const order = count === 1 ? 0 : i / (count - 1);
      b.detonateAt = baseDelay + order * ripple;

      if (circular) {
        // Sunflower phyllotaxis over a `width` m diameter circular patch (radius = width * 0.5) dropped from ~18 m.
        const rNorm = Math.sqrt((i + 0.5) / count);
        const radius = rNorm * (spec.width * 0.5) * rand(0.9, 1.02);
        const theta = i * GOLDEN_ANGLE + seedAngle;
        const vy = -12 - 5 * (1 - rNorm) + rand(-1.0, 1.0);
        // Exact fall time from an 18 m overhead burst under BOMBLET_GRAVITY, plus brief post-landing hop.
        const tFall = (vy + Math.sqrt(vy * vy + 2 * BOMBLET_GRAVITY * 18)) / BOMBLET_GRAVITY;
        const effTime = Math.max(0.45, tFall + 0.14);
        const vx = (Math.cos(theta) * radius) / effTime;
        const vz = (Math.sin(theta) * radius) / effTime;
        b.vel.set(vx, vy, vz);
      } else {
        // Forward-thrown fan carpeting a ~length × width patch ahead of `origin` along `dir`.
        const u = clamp((i + 0.5) / count + rand(-0.025, 0.025), 0.05, 1.0);
        const v = (((i * GOLDEN_RATIO + seedOffset) % 1) - 0.5) + rand(-0.04, 0.04);
        const along = (0.1 + 0.9 * u) * spec.length;
        const across = clamp(v, -0.5, 0.5) * spec.width;
        const flight = 0.34 + 0.24 * u;
        const speedHoriz = along / flight;
        b.vel
          .copy(_fwd)
          .multiplyScalar(speedHoriz)
          .addScaledVector(_right, across / flight);
        // Gentle upward lob so bomblets arc visibly out of the airburst before dropping onto the carpet.
        b.vel.y = dir.y * speedHoriz * 0.35 + 0.5 * BOMBLET_GRAVITY * flight * 0.35 + rand(0.6, 1.8);
      }
    }

    if (this.active > 0) {
      this.attach();
      this.syncMesh();
    }
  }

  private raycastWorld(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): boolean {
    const physics = this.ctx.physics;
    if (!physics) return false;
    if (typeof physics.raycastInto === 'function') {
      return physics.raycastInto(origin, dir, maxDist, CG.World, _hit);
    }
    if (typeof physics.raycast === 'function') {
      const h = physics.raycast(origin, dir, maxDist, CG.World);
      if (!h) return false;
      _hit.point.copy(h.point);
      _hit.normal.copy(h.normal);
      _hit.distance = h.distance;
      _hit.surface = h.surface;
      _hit.collider = h.collider;
      return true;
    }
    return false;
  }

  step(dt: number): void {
    if (dt <= 0 || this.active === 0) return;
    const c = this.ctx;
    this.soundClock = Math.max(0, this.soundClock - dt);

    let lightsThisStep = 0;
    let fxThisStep = 0;

    for (let i = 0; i < MAX_BOMBLETS; i++) {
      const b = this.pool[i]!;
      if (!b.live) continue;
      b.age += dt;

      if (!b.settled) {
        b.vel.y -= BOMBLET_GRAVITY * dt;
        _step.copy(b.vel).multiplyScalar(dt);
        const dist = _step.length();
        if (dist > 1e-5) {
          _dir.copy(_step).divideScalar(dist);
          if (this.raycastWorld(b.pos, _dir, dist + SKIN)) {
            b.pos.copy(_hit.point).addScaledVector(_hit.normal, SKIN);
            b.normal.copy(_hit.normal);
            const isFloor = _hit.normal.y >= FLOOR_NORMAL_Y;
            if (!b.bounced) {
              // Single bounce off wall/geometry (0.45 restitution on walls, tighter hop on ground).
              reflectBombletVelocity(b.vel, _hit.normal, isFloor ? 0.3 : BOMBLET_RESTITUTION);
              b.bounced = true;
              if (isFloor && Math.abs(b.vel.y) < 1.8) {
                b.vel.set(0, 0, 0);
                b.settled = true;
              } else if (!isFloor && fxThisStep < MAX_FX_PER_STEP) {
                fxThisStep++;
                c.fx?.sparks?.(b.pos, _hit.normal, 4, '#ffbb55');
              }
            } else if (isFloor) {
              // Already bounced once: settle cleanly on the ground.
              b.vel.set(0, 0, 0);
              b.settled = true;
            } else {
              // Second wall contact after bouncing: slide/drop cleanly without tunneling or bouncing again.
              const vn = b.vel.dot(_hit.normal);
              if (vn < 0) b.vel.addScaledVector(_hit.normal, -vn);
              b.vel.multiplyScalar(0.2);
            }
          } else {
            b.pos.add(_step);
          }
        }

        b.trailIn -= dt;
        if (b.trailIn <= 0) {
          b.trailIn = 0.08;
          if (fxThisStep < MAX_FX_PER_STEP) {
            fxThisStep++;
            c.fx?.smoke?.(b.pos, 0xc8ccd2, 0.24, 0.35);
          }
        }
      }

      if (b.age >= b.detonateAt) {
        b.live = false;
        this.active--;

        _blast.radius = b.blastRadius;
        _blast.damage = b.damage;
        _blast.source = b.source;
        _blast.normal = b.normal;
        _blast.cosmetic = b.cosmetic;
        _blast.mirrored = !b.cosmetic;
        c.combat.explode(b.pos, _blast);

        // Strong ragdoll push across the carpet.
        c.physics?.radialImpulse?.(b.pos, b.blastRadius * RAGDOLL_PUSH_SCALE, RAGDOLL_PUSH_FORCE);

        if (fxThisStep < MAX_FX_PER_STEP) {
          fxThisStep++;
          c.fx?.sparks?.(b.pos, b.normal, 10, '#ffc464');
          c.fx?.ring?.(b.pos, b.normal, '#ff9a38', b.blastRadius * 1.45);
        }
        if (lightsThisStep < MAX_LIGHTS_PER_STEP) {
          lightsThisStep++;
          c.render?.lights?.flash?.(b.pos, 0xffaa44, 7.5, b.blastRadius * 3.2, 0.08);
        }
        if (this.soundClock <= 0) {
          this.soundClock = CRACKLE_GAP;
          c.audio?.play?.('hellfirebullet_explode', { position: b.pos, volume: 0.72, pitch: rand(0.88, 1.18) });
        }
      }
    }

    this.syncMesh();
    if (this.active <= 0) {
      this.active = 0;
      this.detach();
    }
  }

  private syncMesh(): void {
    const mesh = this.ensureMesh();
    if (!mesh) return;
    if (this.active <= 0) {
      mesh.count = 0;
      mesh.visible = false;
      return;
    }
    let count = 0;
    for (let i = 0; i < MAX_BOMBLETS; i++) {
      const b = this.pool[i]!;
      if (!b.live) continue;
      const fuseFrac = clamp(b.age / Math.max(b.detonateAt, 0.01));
      const s = b.settled ? 0.95 + fuseFrac * 0.45 : 1.05;
      _scale.set(s, s, s);
      _quat.identity();
      _mat.compose(b.pos, _quat, _scale);
      mesh.setMatrixAt(count, _mat);
      // Warm amber while flying, pulsing brighter white-amber right before popping.
      _color.setRGB(1.8 + fuseFrac * 2.2, 0.95 + fuseFrac * 1.3, 0.25 + fuseFrac * 0.8);
      mesh.setColorAt(count, _color);
      count++;
    }
    mesh.count = count;
    mesh.visible = count > 0;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  clear(): void {
    for (let i = 0; i < MAX_BOMBLETS; i++) this.pool[i]!.live = false;
    this.active = 0;
    this.soundClock = 0;
    this.detach();
    if (this.mesh) {
      this.mesh.count = 0;
      this.mesh.visible = false;
    }
  }
}

const fields = new WeakMap<Ctx, BombletField>();
let lastCtx: Ctx | null = null;

function fieldOf(ctx: Ctx): BombletField {
  let f = fields.get(ctx);
  if (!f) {
    f = new BombletField(ctx);
    fields.set(ctx, f);
  }
  lastCtx = ctx;
  return f;
}

/** Releases a pooled carpet of wall-bouncing, timed-ripple bomblets from `origin` along `dir`. */
export function bombletCarpet(ctx: Ctx, origin: THREE.Vector3, dir: THREE.Vector3, spec: BombletSpec): void {
  fieldOf(ctx).spawnCarpet(origin, dir, spec);
}

/** Explicitly advances active bomblets for `ctx` (or the most recently used context) by `dt` seconds. */
export function updateBomblets(dt: number, ctx?: Ctx): void {
  const target = ctx ?? lastCtx;
  if (!target) return;
  fields.get(target)?.step(dt);
}

/**
 * Steps bomblets for `ctx` only when not already driven by `ctx.physics.preStep`.
 * Called by `arms/cluster.ts` and `shoulders/mortar.ts` in `update`/`idleUpdate` so headless/mock tests step cleanly
 * without double-stepping in live gameplay.
 */
export function stepBombletsIfUnhooked(dt: number, ctx: Ctx): void {
  const f = fields.get(ctx);
  if (f && !f.hooked && f.active > 0) f.step(dt);
}

/** Clears all live bomblets for `ctx` (or the most recently used context) and detaches any `preStep` hook. */
export function clearBomblets(ctx?: Ctx): void {
  const target = ctx ?? lastCtx;
  if (!target) return;
  fields.get(target)?.clear();
}

/** Returns the number of active in-flight / arming bomblets for `ctx` (or the most recently used context). */
export function activeBombletCount(ctx?: Ctx): number {
  const target = ctx ?? lastCtx;
  if (!target) return 0;
  return fields.get(target)?.active ?? 0;
}
