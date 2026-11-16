/**
 * Blood that stays. The FX system draws blood in the air; this system works out where it lands and leaves
 * decals there. Droplets here are invisible ballistic points that shadow the visible spray, so what the
 * player sees in the air and what ends up on the wall agree without particles having to talk to physics.
 *
 * Every raycast comes out of one per-frame budget. When a big fight runs out of rays, droplets simply fly
 * a little further between checks and the queue waits, so the cost per frame stays flat.
 */
import * as THREE from 'three';
import { hitWeight } from '../audio/reactions';
import { CG, type CharacterInstance, type Ctx, type DamageInfo, type DecalKind, type RayHit } from '../core/contracts';
import { clamp, TAU, randomInCone } from '../core/math';

export const BloodTuning = {
  /** Raycasts per frame across droplets, queued splats and smears. */
  raysPerFrame: 24,
  maxDroplets: 160,
  maxQueued: 96,
  maxPools: 24,
  /** Seconds a droplet flies between ray checks. */
  dropletCheck: 0.05,
  dropletGravity: -15,
  /** Droplets that never hit anything give up after this long. */
  dropletLife: 2.2,
  /** How far a dragged body travels between smear marks. */
  smearSpacing: 0.42,
  /** Speed a queued stain is taken to arrive at, along its ray, so it stretches along it like a drop that flew there. */
  queuedSpeed: 7,
  /** Wounds dripping at once. One more takes the oldest's place. */
  maxBleeders: 32,
  /** Exit sprays a frame. A grenade into a crowd sprays off the first few bodies, not all of them. */
  spraysPerFrame: 6,
  /** Drops a frame across every bleeder, gib and caller. Past it a drop waits for the next frame. */
  dripsPerFrame: 6,
  /** How much wetter a body gets per hit, plus its share of health that hit took. */
  wetPerHit: 0.1,
};

/**
 * A round's spray: its weight on the body-hit scale (`hitWeight`), and whether it is a blast's burst. Pure, so the
 * classes can be tested: a light round mists, a shotgun or heavy round splashes, a blast bursts every way.
 */
export function sprayOf(d: Pick<DamageInfo, 'amount' | 'type' | 'force'>): { weight: number; radial: boolean } | null {
  if (d.type === 'explosive') return { weight: clamp(0.6 + d.amount / 400), radial: true };
  if (d.type !== 'bullet' && d.type !== 'pellet') return null;
  return { weight: hitWeight(d.amount, d.type, d.force), radial: false };
}

/** A wound that drips for a while, from a point fixed on a bone. */
interface Bleeder {
  target: THREE.Object3D | null;
  owner: THREE.Object3D | null;
  local: THREE.Vector3;
  until: number;
  next: number;
  /** Seconds between drops at the start. It slows as the wound clots. */
  every: number;
  start: number;
}

interface Pool {
  x: number; y: number; z: number;
  nx: number; ny: number; nz: number;
  size: number;
  /** Grown to size * stage / stages so far. */
  stage: number;
  nextAt: number;
  interval: number;
  rotation: number;
}

interface QueuedRay {
  ox: number; oy: number; oz: number;
  dx: number; dy: number; dz: number;
  maxDist: number;
  size: number;
  kind: DecalKind;
}

const POOL_STAGES = 3;

const _splat = new THREE.Vector3();
const _at = new THREE.Vector3();
const _inv = new THREE.Matrix4();

export class BloodField {
  private readonly px = new Float32Array(BloodTuning.maxDroplets);
  private readonly py = new Float32Array(BloodTuning.maxDroplets);
  private readonly pz = new Float32Array(BloodTuning.maxDroplets);
  private readonly lx = new Float32Array(BloodTuning.maxDroplets);
  private readonly ly = new Float32Array(BloodTuning.maxDroplets);
  private readonly lz = new Float32Array(BloodTuning.maxDroplets);
  private readonly vx = new Float32Array(BloodTuning.maxDroplets);
  private readonly vy = new Float32Array(BloodTuning.maxDroplets);
  private readonly vz = new Float32Array(BloodTuning.maxDroplets);
  private readonly size = new Float32Array(BloodTuning.maxDroplets);
  private readonly life = new Float32Array(BloodTuning.maxDroplets);
  private readonly since = new Float32Array(BloodTuning.maxDroplets);
  private dropletAt = 0;
  private readonly queue: QueuedRay[] = Array.from({ length: BloodTuning.maxQueued }, () => ({
    ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: 0, maxDist: 0, size: 0, kind: 'blood' as DecalKind,
  }));
  private queueHead = 0;
  private queueLen = 0;
  private readonly pools: Pool[] = Array.from({ length: BloodTuning.maxPools }, () => ({
    x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, size: 0, stage: POOL_STAGES, nextAt: 0, interval: 0, rotation: 0,
  }));
  private poolAt = 0;
  private rays = 0;
  raysUsed = 0;
  private readonly bleeders: Bleeder[] = Array.from({ length: BloodTuning.maxBleeders }, () => ({
    target: null, owner: null, local: new THREE.Vector3(), until: 0, next: 0, every: 1, start: 0,
  }));
  private bleederAt = 0;
  private drips = 0;
  private sprays = 0;
  /** Drops let fall since the last `clear`. For checks. */
  dripped = 0;
  /** How wet each body is, 0..1, as `setBloodiness` has it. */
  private readonly wet = new WeakMap<CharacterInstance, number>();
  /** The last body a spray came off, and when: a shotgun's pellets on one body are one spray. */
  private sprayChar: CharacterInstance | null = null;
  private sprayAt = -1;

  private readonly hit: RayHit = {
    point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0, surface: 'concrete', collider: null,
  };
  private readonly o = new THREE.Vector3();
  private readonly d = new THREE.Vector3();
  private readonly t = new THREE.Vector3();
  private readonly n = new THREE.Vector3();

  constructor(private readonly ctx: Ctx) {}

  private cast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number): boolean {
    this.rays++;
    return this.ctx.physics.raycastInto(this.o.set(ox, oy, oz), this.d.set(dx, dy, dz), maxDist, CG.World, this.hit);
  }

  private get budgetLeft(): boolean {
    return this.rays < BloodTuning.raysPerFrame;
  }

  /** A single flying drop that stains what it lands on. Oldest-out when the ring is full. */
  droplet(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number): void {
    const i = this.dropletAt;
    this.dropletAt = (i + 1) % BloodTuning.maxDroplets;
    this.px[i] = this.lx[i] = x;
    this.py[i] = this.ly[i] = y;
    this.pz[i] = this.lz[i] = z;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.vz[i] = vz;
    this.size[i] = size;
    this.life[i] = BloodTuning.dropletLife;
    this.since[i] = Math.random() * BloodTuning.dropletCheck;
  }

  /** A spray of droplets along `dir`, inside a cone of `spread` radians. */
  spray(origin: THREE.Vector3, dir: THREE.Vector3, count: number, speed: number, spread: number, size: number): void {
    for (let i = 0; i < count; i++) {
      randomInCone(dir, spread, this.t);
      const s = speed * (0.55 + Math.random() * 0.6);
      this.droplet(origin.x, origin.y, origin.z, this.t.x * s, this.t.y * s, this.t.z * s, size * (0.5 + Math.random()));
    }
  }

  /** Fires a ray at the world and stains what it hits. Queued, so it costs budget rather than frame time. */
  splatRay(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, size: number, kind: DecalKind = 'blood'): void {
    if (this.queueLen >= BloodTuning.maxQueued) return;
    const q = this.queue[(this.queueHead + this.queueLen) % BloodTuning.maxQueued]!;
    this.queueLen++;
    q.ox = origin.x;
    q.oy = origin.y;
    q.oz = origin.z;
    q.dx = dir.x;
    q.dy = dir.y;
    q.dz = dir.z;
    q.maxDist = maxDist;
    q.size = size;
    q.kind = kind;
  }

  /** Stains the first surface below a point. */
  stainBelow(point: THREE.Vector3, size: number, kind: DecalKind = 'blood', reach = 3): void {
    this.o.copy(point);
    this.splatRay(this.o, this.t.set(0, -1, 0), reach, size, kind);
  }

  /** The wall behind a kill: a cone of rays down the shot line, big close up and small far away. */
  splatterAlong(point: THREE.Vector3, dir: THREE.Vector3, count: number, reach: number, size: number): void {
    for (let i = 0; i < count; i++) {
      randomInCone(dir, 0.42, this.n);
      this.splatRay(point, this.n, reach, size * (0.6 + Math.random() * 0.9));
    }
  }

  /** Big stains on every nearby surface around a blast, weighted toward away from it. */
  splatterAround(point: THREE.Vector3, away: THREE.Vector3, count: number, reach: number, size: number): void {
    for (let i = 0; i < count; i++) {
      this.n.set(Math.random() * 2 - 1, Math.random() * 1.4 - 0.9, Math.random() * 2 - 1).normalize();
      this.n.addScaledVector(away, 0.7).normalize();
      this.splatRay(point, this.n, reach, size * (0.5 + Math.random()));
    }
  }

  /**
   * A pool that spreads over a few seconds. Decals have no update call, so growth is a short run of larger
   * overlapping decals, each spreading slowly in the shader. Three of them stay well inside the budget at the 40 corpse cap.
   */
  pool(point: THREE.Vector3, size: number, seconds: number): void {
    if (this.rays >= BloodTuning.raysPerFrame * 2) return;
    if (!this.cast(point.x, point.y + 0.25, point.z, 0, -1, 0, 1.6)) return;
    if (this.hit.normal.y < 0.5) return;
    const p = this.pools[this.poolAt]!;
    this.poolAt = (this.poolAt + 1) % BloodTuning.maxPools;
    p.x = this.hit.point.x;
    p.y = this.hit.point.y;
    p.z = this.hit.point.z;
    p.nx = this.hit.normal.x;
    p.ny = this.hit.normal.y;
    p.nz = this.hit.normal.z;
    p.size = size;
    p.stage = 0;
    p.interval = seconds / POOL_STAGES;
    p.nextAt = this.ctx.time.elapsed;
    p.rotation = Math.random() * TAU;
  }

  /**
   * Leaves blood on a surface at once, no ray: `point` on it, `normal` its normal, `amount` 0..1+ about how much (1 is
   * a hand-sized stain). A wall stain this big runs down the wall (`decals.run`).
   */
  bleedAt(point: THREE.Vector3, normal: THREE.Vector3, amount: number): void {
    if (!(amount > 0)) return;
    // Arriving straight in: a round mark. The size curve keeps a trickle a spot and a gush a splash.
    _splat.copy(normal).multiplyScalar(-1);
    this.ctx.render.decals.splat(point, normal, 0.12 + 0.3 * Math.sqrt(amount), _splat);
  }

  /** One drop falling from `point`, leaving a spot where it lands. Inside a per-frame budget; false when it was skipped. */
  drip(point: THREE.Vector3, velocity?: THREE.Vector3, size = 1): boolean {
    if (this.drips >= BloodTuning.dripsPerFrame) return false;
    this.drips++;
    this.dripped++;
    this.ctx.fx.bloodDrip?.(point, velocity, size);
    return true;
  }

  /**
   * A wound that drips for `seconds`: `point` in world space is pinned to `target` (a bone), so the drops follow it as
   * the body moves, falls and lies. `every` is the seconds between drops at first; the wound slows as it clots. It
   * stops by itself when `owner` (the body's root) leaves the scene. Capped at `maxBleeders`, oldest first.
   */
  bleed(target: THREE.Object3D, point: THREE.Vector3, seconds: number, every = 0.4, owner: THREE.Object3D | null = null): void {
    const b = this.bleeders[this.bleederAt]!;
    this.bleederAt = (this.bleederAt + 1) % BloodTuning.maxBleeders;
    target.updateWorldMatrix(true, false);
    b.target = target;
    b.owner = owner;
    b.local.copy(point).applyMatrix4(_inv.copy(target.matrixWorld).invert());
    const now = this.ctx.time.elapsed;
    b.start = now;
    b.until = now + seconds;
    b.every = every;
    b.next = now + every * (0.3 + Math.random() * 0.7);
  }

  /** Wounds dripping now. For checks. */
  get bleeding(): number {
    const now = this.ctx.time.elapsed;
    let n = 0;
    for (const b of this.bleeders) if (b.target && now < b.until) n++;
    return n;
  }

  /**
   * What a hit on a body leaves outside it: the spray off its far side onto what is behind, a wound that drips, and a
   * wetter body. Called for every round on the living and the dead, and on a co-op guest from the wound event alone.
   */
  onHit(char: CharacterInstance, d: DamageInfo, severity: number, bone = d.bone ?? -1, point = d.point): void {
    if (d.type === 'fire' || d.type === 'shock' || d.type === 'true') return;
    const now = this.ctx.time.elapsed;
    // The rest of a shotgun's pellets on one body are the same hit: one splash, one dripping wound.
    const again = d.type === 'pellet' && this.sprayChar === char && now - this.sprayAt < 0.05;
    const s = clamp(severity, 0, 1);
    const wet = Math.min(1, (this.wet.get(char) ?? 0) + (again ? s * 0.5 : BloodTuning.wetPerHit + s * 1.1));
    this.wet.set(char, wet);
    char.setBloodiness(wet);
    if (again) return;
    this.sprayChar = char;
    this.sprayAt = now;
    const spray = sprayOf(d);
    if (spray && this.sprays < BloodTuning.spraysPerFrame) {
      this.sprays++;
      this.ctx.fx.bloodSpray?.(point, d.dir, spray.weight, spray.radial);
    }
    if (bone < 0) return;
    const target = char.bones[bone];
    // A bigger wound drips faster and for longer.
    if (target) this.bleed(target, point, 4 + 10 * s + 3 * Math.random(), 0.55 - 0.35 * s, char.root);
  }

  /** Marks the floor under a dragged body. The caller spaces these out by distance. */
  smear(point: THREE.Vector3, moveX: number, moveZ: number, size: number): void {
    if (!this.budgetLeft) return;
    if (!this.cast(point.x, point.y + 0.15, point.z, 0, -1, 0, 0.75)) return;
    this.ctx.render.decals.add('bloodSmear', this.hit.point, this.hit.normal, size, Math.atan2(moveX, moveZ));
  }

  update(dt: number): void {
    this.rays = 0;
    const budget = BloodTuning.raysPerFrame;

    while (this.queueLen > 0 && this.rays < budget) {
      const q = this.queue[this.queueHead]!;
      this.queueHead = (this.queueHead + 1) % BloodTuning.maxQueued;
      this.queueLen--;
      if (this.cast(q.ox, q.oy, q.oz, q.dx, q.dy, q.dz, q.maxDist)) {
        // Blood thins out with distance from the wound.
        const fall = 1 - 0.55 * Math.min(1, this.hit.distance / q.maxDist);
        const v = BloodTuning.queuedSpeed;
        // Blood flew down the ray to get here, so it stretches along it and can run down a wall.
        if (q.kind === 'blood') this.ctx.render.decals.splat(this.hit.point, this.hit.normal, q.size * fall, _splat.set(q.dx * v, q.dy * v, q.dz * v));
        else this.ctx.render.decals.add(q.kind, this.hit.point, this.hit.normal, q.size * fall, Math.random() * TAU);
      }
    }

    this.updateDroplets(dt);

    const now = this.ctx.time.elapsed;
    this.drips = 0;
    this.sprays = 0;
    this.updateBleeders(now);
    for (let i = 0; i < BloodTuning.maxPools; i++) {
      const p = this.pools[i]!;
      if (p.stage >= POOL_STAGES || now < p.nextAt) continue;
      p.stage++;
      p.nextAt = now + p.interval;
      this.t.set(p.x, p.y, p.z);
      this.n.set(p.nx, p.ny, p.nz);
      this.ctx.render.decals.add('bloodPool', this.t, this.n, (p.size * p.stage) / POOL_STAGES, p.rotation + p.stage * 0.9);
    }
    this.raysUsed = this.rays;
  }

  private updateBleeders(now: number): void {
    for (let i = 0; i < BloodTuning.maxBleeders; i++) {
      const b = this.bleeders[i]!;
      if (!b.target || now < b.next) continue;
      if (now >= b.until || (b.owner && (!b.owner.parent || !b.owner.visible))) {
        b.target = null;
        continue;
      }
      // Clotting: drops come slower as the wound ages, and smaller.
      const age = (now - b.start) / Math.max(b.until - b.start, 0.01);
      _at.copy(b.local).applyMatrix4(b.target.matrixWorld);
      if (!this.drip(_at, undefined, 1.2 - 0.5 * age)) continue;
      b.next = now + b.every * (1 + 2 * age) * (0.6 + Math.random() * 0.8);
    }
  }

  private updateDroplets(dt: number): void {
    const g = BloodTuning.dropletGravity;
    const check = BloodTuning.dropletCheck;
    const { px, py, pz, lx, ly, lz, vx, vy, vz, life, since, size } = this;
    for (let i = 0; i < BloodTuning.maxDroplets; i++) {
      if (life[i]! <= 0) continue;
      life[i] = life[i]! - dt;
      vy[i] = vy[i]! + g * dt;
      px[i] = px[i]! + vx[i]! * dt;
      py[i] = py[i]! + vy[i]! * dt;
      pz[i] = pz[i]! + vz[i]! * dt;
      since[i] = since[i]! + dt;
      if (since[i]! < check || !this.budgetLeft) continue;
      since[i] = 0;
      const sx = px[i]! - lx[i]!;
      const sy = py[i]! - ly[i]!;
      const sz = pz[i]! - lz[i]!;
      const len = Math.hypot(sx, sy, sz);
      if (len < 1e-4) continue;
      if (this.cast(lx[i]!, ly[i]!, lz[i]!, sx / len, sy / len, sz / len, len)) {
        const hit = this.hit;
        // A drop arriving at a shallow angle or high speed spreads out further.
        const speed = Math.hypot(vx[i]!, vy[i]!, vz[i]!);
        const s = size[i]! * (1 + Math.min(1.2, speed * 0.05));
        this.ctx.render.decals.splat(hit.point, hit.normal, s, _splat.set(vx[i]!, vy[i]!, vz[i]!));
        life[i] = 0;
        continue;
      }
      lx[i] = px[i]!;
      ly[i] = py[i]!;
      lz[i] = pz[i]!;
    }
  }

  clear(): void {
    this.life.fill(0);
    this.queueLen = 0;
    for (const b of this.bleeders) b.target = null;
    this.dripped = 0;
    for (const p of this.pools) p.stage = POOL_STAGES;
  }
}
