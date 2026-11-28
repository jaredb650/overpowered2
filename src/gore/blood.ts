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
import { HumanoidBone } from '../characters/rig';
import { CG, type BloodPuffKind, type CharacterInstance, type Ctx, type DamageInfo, type DecalKind, type RayHit } from '../core/contracts';
import { DevFlags } from '../core/devflags';
import { clamp, TAU, randomInCone } from '../core/math';
import type { BigKind, SplatHow } from '../render/decalSheet';
import { isSmallArm } from './wounds';

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
  /** Impact puffs from the later pellets of one blast on one body, after the blast's own, and their size against it. */
  puffPellets: 3,
  puffPelletScale: 0.62,
  /** A blast's first puff on a body, against a single round of the same weight: it stands for all the pellets. */
  puffBlastScale: 1.15,
  /** How much blood the gore setting asks for: 1 at Full. Scales the big stains' sizes and a round's own mark. */
  amount: 1,
  /** Big stains waiting for their ray at once. One more is dropped: the small drops still land. */
  maxBig: 16,
  /** A round's fan on the floor past the body, m: the lightest round's, and what a full-weight one adds. */
  hitFan: 0.5,
  hitFanHeavy: 1.1,
  /** Seconds after the hit that fan is laid: the time the spray takes to reach the floor. */
  hitFanDelay: 0.14,
  /** Bursts this close together in time (s) and space (m) are one blast: the second lays a ring round them all. */
  ringWindow: 0.25,
  ringReach: 4.5,
  /** A wounded man who has walked this far (m) since his wound's last drop leaves a trail of them, not one. */
  trailFrom: 0.9,
  /** Places remembered as wet: what a foot can step in and a falling piece can splash in. The oldest is forgotten. */
  maxWet: 32,
  /** Seconds a big stain or a pool stays wet enough to step in or splash. */
  wetFor: 75,
  /** Points that drip at once: blood on a ceiling, a pool at a ledge. */
  maxDrippers: 16,
  /** Splashes a frame. */
  splashesPerFrame: 2,
};

/**
 * The weight of a round's impact puff on the body-hit scale (`hitWeight`), or -1 for a hit that knocks none out: only a
 * bullet or a pellet does (a blade opens, a blast bursts, fire and shock draw no blood). Pure, for its test.
 */
export function puffOf(d: Pick<DamageInfo, 'amount' | 'type' | 'force'>): number {
  return d.type === 'bullet' || d.type === 'pellet' ? hitWeight(d.amount, d.type, d.force) : -1;
}

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
  /** Where its last drop fell from, to tell a man who is walking. `far`: none yet. */
  lx: number;
  lz: number;
  far: boolean;
}

/** Blood somewhere it can only fall from: a ceiling, the lip of a ledge. Drips until it has run out. */
interface Dripper {
  x: number; y: number; z: number;
  start: number;
  until: number;
  next: number;
  every: number;
}

/** Somewhere wet: `r` metres round (x, y, z), until `until`. */
interface WetSpot {
  x: number; y: number; z: number;
  r: number;
  until: number;
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

/** A big stain, or a pattern laid along a direction, waiting for its ray. */
interface BigRay {
  ox: number; oy: number; oz: number;
  dx: number; dy: number; dz: number;
  maxDist: number;
  size: number;
  kind: BigKind | SplatHow | 'print';
  /** The way it was thrown: what the stain is turned along. */
  ax: number; ay: number; az: number;
  /** World time it is laid at. */
  at: number;
  /** One round's mark, not a kill's: it goes with the small stains (`decals.big`). */
  minor: boolean;
  /** A footprint: how faint, 0..1, and whether it is the left foot's. */
  fade: number;
  left: boolean;
}

const BIG_KINDS: ReadonlySet<string> = new Set<BigKind>(['burst', 'fan', 'soak', 'sheet', 'drag', 'ring']);
const DOWN = new THREE.Vector3(0, -1, 0);

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
  private readonly bigs: BigRay[] = Array.from({ length: BloodTuning.maxBig }, () => ({
    ox: 0, oy: 0, oz: 0, dx: 0, dy: -1, dz: 0, maxDist: 0, size: 0, kind: 'burst' as BigKind | SplatHow | 'print', ax: 0, ay: 0, az: 0, at: 0, minor: false, fade: 0, left: false,
  }));
  private bigLen = 0;
  /** Big stains laid since the last `clear`. For checks. */
  bigLaid = 0;
  /** The last burst: where and when, and how many have gone off beside it since. */
  private readonly burstPoint = new THREE.Vector3();
  private burstAt = -1;
  private burstCount = 0;
  private readonly pools: Pool[] = Array.from({ length: BloodTuning.maxPools }, () => ({
    x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, size: 0, stage: POOL_STAGES, nextAt: 0, interval: 0, rotation: 0,
  }));
  private poolAt = 0;
  private rays = 0;
  private budgetReset = false;
  raysUsed = 0;
  private readonly bleeders: Bleeder[] = Array.from({ length: BloodTuning.maxBleeders }, () => ({
    target: null, owner: null, local: new THREE.Vector3(), until: 0, next: 0, every: 1, start: 0, lx: 0, lz: 0, far: true,
  }));
  private readonly drippers: Dripper[] = Array.from({ length: BloodTuning.maxDrippers }, () => ({ x: 0, y: 0, z: 0, start: 0, until: -1, next: 0, every: 1 }));
  private dripperAt = 0;
  private readonly wetSpots: WetSpot[] = Array.from({ length: BloodTuning.maxWet }, () => ({ x: 0, y: 0, z: 0, r: 0, until: -1 }));
  private wetSpotAt = 0;
  private splashes = 0;
  /** Splashes thrown and footprints laid since the last `clear`. For checks. */
  splashed = 0;
  printed = 0;
  private bleederAt = 0;
  private drips = 0;
  private sprays = 0;
  private sheets = 0;
  /** Drops let fall since the last `clear`. For checks. */
  dripped = 0;
  /** How wet each body is, 0..1, as `setBloodiness` has it. */
  private readonly wet = new WeakMap<CharacterInstance, number>();
  /** The last body a spray came off, and when: a shotgun's pellets on one body are one spray. */
  private sprayChar: CharacterInstance | null = null;
  private sprayAt = -1;
  /** Pellet puffs the body `sprayChar` has had from the blast at `sprayAt`. */
  private pelletPuffs = 0;

  private readonly hit: RayHit = {
    point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0, surface: 'concrete', collider: null,
  };
  private readonly o = new THREE.Vector3();
  private readonly d = new THREE.Vector3();
  private readonly t = new THREE.Vector3();
  private readonly n = new THREE.Vector3();

  constructor(private readonly ctx: Ctx) {}

  /** Resets the per-frame raycast budget before pre-update blood raycasts run. */
  resetBudget(): void {
    this.rays = 0;
    this.budgetReset = true;
  }

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
    // What stains the floor under it has just landed on it: in a pool, that is a splash.
    this.splash(point, size * 2);
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
   * A big stain (`decals.big`) or a pattern (`cast`, `arc`, `trail`: `decals.splat`) where a ray from `origin` along
   * `dir` first meets the world, turned along `along` (the way the blood was thrown; `dir` if not given), `delay`
   * seconds from now. Queued like `splatRay`: it costs ray budget, not frame time. A wall sheet shrinks with the
   * distance the blood flew to reach it. A big stain on a floor that reaches a wall is carried up the wall as a sheet,
   * since a decal is flat and is cut off at the corner.
   */
  bigRay(kind: BigKind | SplatHow | 'print', origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, size: number, along: THREE.Vector3 = dir, delay = 0, minor = false): void {
    if (this.bigLen >= BloodTuning.maxBig || (!DevFlags.bigBlood && !minor && BIG_KINDS.has(kind))) return;
    const q = this.bigs[this.bigLen++]!;
    q.ox = origin.x;
    q.oy = origin.y;
    q.oz = origin.z;
    q.dx = dir.x;
    q.dy = dir.y;
    q.dz = dir.z;
    q.maxDist = maxDist;
    q.size = size;
    q.kind = kind;
    q.ax = along.x;
    q.ay = along.y;
    q.az = along.z;
    q.at = this.ctx.time.elapsed + delay;
    q.minor = minor;
    q.fade = 0;
    q.left = false;
  }

  /**
   * A boot print on the floor under `at`, toe along `dir`, `fade` 0 (straight out of the pool) to 1 (the last of the
   * blood). One ray from the budget; dropped when the queue is full.
   */
  printAt(at: THREE.Vector3, dir: THREE.Vector3, size: number, left: boolean, fade: number): void {
    const n = this.bigLen;
    this.bigRay('print', at, DOWN, 0.6, size, dir);
    if (this.bigLen === n) return;
    const q = this.bigs[n]!;
    q.fade = fade;
    q.left = left;
  }

  /** True where a foot would come down in wet blood: inside a pool, a soaked patch or a fresh burst. */
  wetAt(x: number, y: number, z: number): boolean {
    const now = this.ctx.time.elapsed;
    for (const w of this.wetSpots) {
      if (now >= w.until) continue;
      const dx = x - w.x, dz = z - w.z;
      if (dx * dx + dz * dz < w.r * w.r && Math.abs(y - w.y) < 0.6) return true;
    }
    return false;
  }

  /** Remembers that the floor is wet `r` metres round a point, for `wetFor` seconds. */
  private wetSpot(x: number, y: number, z: number, r: number): void {
    const w = this.wetSpots[this.wetSpotAt]!;
    this.wetSpotAt = (this.wetSpotAt + 1) % BloodTuning.maxWet;
    w.x = x;
    w.y = y;
    w.z = z;
    w.r = r;
    w.until = this.ctx.time.elapsed + BloodTuning.wetFor;
  }

  /**
   * Blood at `point` that can only fall: it drips from there for `seconds`, a drop every `every` seconds at first and
   * slower as it runs out. Capped at `maxDrippers`, oldest first.
   */
  dripFrom(point: THREE.Vector3, seconds: number, every = 0.6, delay = 0): void {
    const d = this.drippers[this.dripperAt]!;
    this.dripperAt = (this.dripperAt + 1) % BloodTuning.maxDrippers;
    const now = this.ctx.time.elapsed;
    d.x = point.x;
    d.y = point.y;
    d.z = point.z;
    d.start = now + delay;
    d.until = now + delay + seconds;
    d.every = every;
    d.next = now + delay + every * Math.random();
  }

  /** Points dripping now. For checks. */
  get dripping(): number {
    const now = this.ctx.time.elapsed;
    let n = 0;
    for (const d of this.drippers) if (now < d.until) n++;
    return n;
  }

  /**
   * Something landed at `point`. If that is in wet blood it throws a splash: a crown of strands, and drops that stain
   * the floor round it. `size` is how big the thing is, 0..1 or so. True when it splashed.
   */
  splash(point: THREE.Vector3, size: number): boolean {
    if (this.splashes >= BloodTuning.splashesPerFrame || !this.wetAt(point.x, point.y, point.z)) return false;
    this.splashes++;
    this.splashed++;
    const s = clamp(size, 0.2, 1.2);
    this.ctx.fx.bloodHit?.(point, this.t.set(0, 1, 0), 0.5 + s);
    this.spray(point, this.t, 4 + Math.round(4 * s), 2.6 + 1.6 * s, 1.1, 0.04 + 0.03 * s);
    return true;
  }

  /** A body that has come to rest in blood that is not its own soaks it up: it is as bloody as a body gets. */
  soakBody(char: CharacterInstance, at: THREE.Vector3): boolean {
    if (!this.wetAt(at.x, at.y, at.z)) return false;
    const wet = Math.max(this.wet.get(char) ?? 0, 0.9);
    this.wet.set(char, wet);
    char.setBloodiness(wet);
    return true;
  }

  /**
   * What a body coming apart leaves under it: one burst `size` metres across on the floor below `at`, thrown along
   * `dir`. Several in one blast (`ringWindow`, `ringReach`) are one event: the second lays a ring round them all and
   * the rest are smaller.
   */
  burst(at: THREE.Vector3, dir: THREE.Vector3, size: number): void {
    const t = BloodTuning;
    const now = this.ctx.time.elapsed;
    let s = size * t.amount;
    if (now - this.burstAt < t.ringWindow && at.distanceTo(this.burstPoint) < t.ringReach) {
      if (++this.burstCount === 2) {
        this.o.copy(at).add(this.burstPoint).multiplyScalar(0.5);
        this.o.y = Math.max(at.y, this.burstPoint.y);
        this.bigRay('ring', this.o, DOWN, 3.5, Math.max(s * 1.6, at.distanceTo(this.burstPoint) + 2.4));
      }
      s *= 0.75;
    } else {
      this.burstCount = 1;
      this.burstPoint.copy(at);
      this.burstAt = now;
    }
    this.bigRay('burst', at, DOWN, 3.5, s, dir);
  }

  /**
   * What a shot throws out of the far side of a body: a fan `size` metres long on the floor past `at`, along `dir`,
   * and a sheet on the wall behind if there is one within reach. `delay`: seconds until it lands.
   */
  fan(at: THREE.Vector3, dir: THREE.Vector3, size: number, delay = 0): void {
    const s = size * BloodTuning.amount;
    this.bigRay('fan', at, DOWN, 3.5, s, dir, delay);
    this.bigRay('sheet', at, dir, 1.2 + s * 2, s, dir, delay);
  }

  /** The wall behind a killing shot: one sheet on it, if it is within `reach`. Two a frame; a shotgun's pellets are one kill. */
  sheetBehind(at: THREE.Vector3, dir: THREE.Vector3, size: number, reach = 3.2): void {
    if (this.sheets >= 2) return;
    this.sheets++;
    this.bigRay('sheet', at, dir, reach, size * BloodTuning.amount);
  }

  /** The patch a body soaks into the floor where it lies, `size` metres long, along `along` if given. The pool grows from it. */
  soak(at: THREE.Vector3, size: number, along?: THREE.Vector3): void {
    this.o.copy(at);
    this.o.y += 0.25;
    this.bigRay('soak', this.o, DOWN, 1.8, size * BloodTuning.amount, along ?? DOWN);
  }

  /** The long smear of a body sliding `length` metres along (moveX, moveZ), from under `at`. */
  drag(at: THREE.Vector3, moveX: number, moveZ: number, length: number): void {
    this.o.copy(at);
    this.o.y += 0.15;
    this.bigRay('drag', this.o, DOWN, 0.9, length, this.t.set(moveX, 0, moveZ).normalize());
  }

  /**
   * Drops thrown off something swung or flung along `dir` at `at`: a line of them, `length` metres, on the surface
   * `reach` metres along `toward` (straight down if not given).
   */
  castOff(at: THREE.Vector3, dir: THREE.Vector3, length: number, toward: THREE.Vector3 = DOWN, reach = 3): void {
    this.bigRay('cast', at, toward, reach, length * BloodTuning.amount, dir);
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
    this.wetSpot(p.x, p.y, p.z, size * 0.36);
    this.overLedge(p.x, p.y, p.z, size * 0.4, seconds);
  }

  /** Places a known-ground blood pool directly at (x, y, z) and registers its wet spot for footprints, splashes, and soaking. */
  placePool(x: number, y: number, z: number, radius = 0.6): void {
    this.t.set(x, y, z);
    this.n.set(0, 1, 0);
    this.ctx.render.decals.add('bloodPool', this.t, this.n, radius, Math.random() * TAU);
    this.wetSpot(x, y, z, Math.max(0.2, radius * 0.45));
  }

  /**
   * A pool that reaches a drop runs over it: from the first edge found within `r` (four rays), blood drips to
   * whatever is below for half a minute, once the pool has had `after` seconds to get there.
   */
  private overLedge(x: number, y: number, z: number, r: number, after: number): void {
    for (let i = 0; i < 4 && this.rays < BloodTuning.raysPerFrame * 2; i++) {
      const dx = i === 0 ? 1 : i === 1 ? -1 : 0, dz = i === 2 ? 1 : i === 3 ? -1 : 0;
      if (this.cast(x + dx * r, y + 0.2, z + dz * r, 0, -1, 0, 0.7)) continue;
      // Just past the lip, a hand under the floor: the drops start where the eye expects them.
      _at.set(x + dx * (r + 0.03), y - 0.04, z + dz * (r + 0.03));
      this.dripFrom(_at, 25 + 15 * Math.random(), 0.5, after * 0.6);
      return;
    }
  }

  /**
   * Leaves blood on a surface at once, no ray: `point` on it, `normal` its normal, `amount` 0..1+ about how much (1 is
   * a hand-sized stain). A wall stain this big runs down the wall (`decals.run`).
   */
  bleedAt(point: THREE.Vector3, normal: THREE.Vector3, amount: number, velocity?: THREE.Vector3): void {
    if (!(amount > 0)) return;
    // Arriving straight in when no velocity is given: a round mark. With velocity, stretches along impact direction.
    if (velocity && velocity.lengthSq() > 1e-6) _splat.copy(velocity);
    else _splat.copy(normal).multiplyScalar(-1);
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
    b.far = true;
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
    const hasMap = (char.bloodMapLayer ?? 0) > 0;
    const wetAdd = hasMap
      ? (again ? 0 : d.type === 'explosive' ? 0.3 : d.type === 'pellet' ? 0.08 : isSmallArm(d) ? 0 : s * 0.08)
      : (again ? s * 0.2 : BloodTuning.wetPerHit * 0.4 + s * 0.42);
    if (wetAdd > 0) {
      const wet = Math.min(1, (this.wet.get(char) ?? 0) + wetAdd);
      this.wet.set(char, wet);
      char.setBloodiness(wet);
    }
    // The impact puff + spritz, on the frame of the hit: scaled & shaped by round class, headshots, and shotgun spreads.
    const puff = puffOf(d);
    if (puff >= 0) {
      const t = BloodTuning;
      const head = d.region === 'head' || bone === HumanoidBone.head;
      const kind: BloodPuffKind = head ? 'headshot' : d.type === 'pellet' ? 'shotgun' : 'bullet';
      if (!again) {
        this.pelletPuffs = 0;
        const scale = d.type === 'pellet' ? t.puffBlastScale : head ? 1.2 : 1;
        this.ctx.fx.bloodPuff?.(point, d.dir, puff, scale, kind);
      } else if (this.pelletPuffs < t.puffPellets) {
        this.pelletPuffs++;
        this.ctx.fx.bloodPuff?.(point, d.dir, puff, t.puffPelletScale, kind);
      }
    }
    // A flechette's darts are each their own small hole, dripping on its own: one spray for the blast, a wound a dart.
    const dart = d.load === 'flechette';
    if (again && !dart) return;
    if (!again) {
      this.sprayChar = char;
      this.sprayAt = now;
    }
    const spray = again ? null : sprayOf(d);
    if (spray && this.sprays < BloodTuning.spraysPerFrame) {
      this.sprays++;
      this.ctx.fx.bloodSpray?.(point, d.dir, spray.weight, spray.radial);
      // The round's own mark: what it carried out of the far side, laid on the floor past the body as the spray lands.
      // A blast's burst is the gib's to leave.
      if (!spray.radial && DevFlags.hitBlood) {
        const t = BloodTuning;
        this.o.copy(point).addScaledVector(d.dir, 0.3);
        this.bigRay('fan', this.o, DOWN, 3, (t.hitFan + t.hitFanHeavy * spray.weight) * (0.85 + 0.3 * Math.random()) * t.amount, d.dir, t.hitFanDelay, true);
      }
    }
    if (bone < 0) return;
    const target = char.bones[bone];
    // A bigger wound drips faster and for longer.
    if (target) this.bleed(target, point, dart ? 3 + 3 * Math.random() : 4 + 10 * s + 3 * Math.random(), dart ? 0.45 : 0.55 - 0.35 * s, char.root);
  }

  /** Marks the floor under a dragged body. The caller spaces these out by distance. */
  smear(point: THREE.Vector3, moveX: number, moveZ: number, size: number, fade = 0): void {
    if (!this.budgetLeft) return;
    if (!this.cast(point.x, point.y + 0.15, point.z, 0, -1, 0, 0.75)) return;
    const decals = this.ctx.render.decals;
    // `fade`: how much of the blood was already gone from what dragged it (a slide on wet boots), 0..1.
    if (fade > 0 && decals.wipe) decals.wipe(this.hit.point, this.hit.normal, size, Math.atan2(moveX, moveZ), 0.5 + 0.4 * fade);
    else decals.add('bloodSmear', this.hit.point, this.hit.normal, size, Math.atan2(moveX, moveZ));
  }

  update(dt: number): void {
    if (!this.budgetReset) this.rays = 0;
    this.budgetReset = false;
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
        if (q.kind === 'blood') {
          this.ctx.render.decals.splat(this.hit.point, this.hit.normal, q.size * fall, _splat.set(q.dx * v, q.dy * v, q.dz * v));
          // Enough of it on a ceiling comes back down, a drop at a time.
          if (this.hit.normal.y < -0.6 && q.size * fall > 0.3) this.dripFrom(_at.copy(this.hit.point).addScaledVector(this.hit.normal, 0.02), 6 + 8 * Math.random(), 0.7);
        } else {
          this.ctx.render.decals.add(q.kind, this.hit.point, this.hit.normal, q.size * fall, Math.random() * TAU);
        }
      }
    }

    const now = this.ctx.time.elapsed;
    for (let i = 0; i < this.bigLen && this.rays < budget; i++) {
      const q = this.bigs[i]!;
      if (now < q.at) continue;
      // Out of the list: the last one takes its place.
      const last = this.bigs[--this.bigLen]!;
      this.bigs[i] = last;
      this.bigs[this.bigLen] = q;
      i--;
      this.layBig(q);
    }

    this.updateDroplets(dt);

    this.drips = 0;
    this.sprays = 0;
    this.sheets = 0;
    this.splashes = 0;
    this.updateBleeders(now);
    this.updateDrippers(now);
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

  private layBig(q: BigRay): void {
    if (!this.cast(q.ox, q.oy, q.oz, q.dx, q.dy, q.dz, q.maxDist)) return;
    const decals = this.ctx.render.decals;
    const hit = this.hit;
    const along = this.t.set(q.ax, q.ay, q.az);
    if (q.kind === 'print') {
      if (hit.normal.y < 0.5) return;
      decals.print?.(hit.point, hit.normal, q.size, along, q.left, q.fade);
      this.printed++;
      return;
    }
    if (!BIG_KINDS.has(q.kind)) {
      // A pattern: laid along the throw, whatever the ray's own direction.
      const into = along.dot(hit.normal);
      along.addScaledVector(hit.normal, -into);
      if (along.lengthSq() < 1e-6) along.set(q.dx, q.dy, q.dz);
      decals.splat(hit.point, hit.normal, q.size, _splat.copy(along).normalize().multiplyScalar(5).addScaledVector(hit.normal, -0.5), q.kind as SplatHow);
      return;
    }
    let kind = q.kind as BigKind;
    let size = q.size;
    const floor = hit.normal.y > 0.6;
    if (kind === 'sheet') {
      // Thinner the further it flew. What a shot fired downward throws on the floor is a fan, and it is already there.
      if (floor) return;
      size *= 1 - 0.5 * Math.min(1, hit.distance / q.maxDist);
    } else if (!floor && hit.normal.y > -0.6 && kind !== 'drag') {
      kind = 'sheet';
    }
    decals.big?.(kind, hit.point, hit.normal, size, along, q.minor);
    this.bigLaid++;
    // A kill's stain on a floor is wet to step in; on a ceiling it can only drip.
    if (floor && !q.minor && kind !== 'drag') this.wetSpot(hit.point.x, hit.point.y, hit.point.z, size * (kind === 'soak' ? 0.34 : 0.22));
    else if (hit.normal.y < -0.6) this.dripFrom(_at.copy(hit.point).addScaledVector(hit.normal, 0.02), 10 + 12 * Math.random(), 0.45);
    if (floor && kind !== 'drag' && kind !== 'sheet') this.carryUpWalls(kind, size, along, q.minor);
  }

  /**
   * A decal is flat: the part of a big floor stain that would lie past a wall is cut off there. So where one reaches
   * a wall, what it would have thrown past the corner goes up the wall as a sheet. Reads `this.hit` (the floor point)
   * and may use up to three more rays.
   */
  private carryUpWalls(kind: BigKind, size: number, along: THREE.Vector3, minor: boolean): void {
    const fx = along.x, fz = along.z;
    const fl = Math.hypot(fx, fz);
    const ax = fl > 1e-3 ? fx / fl : 1, az = fl > 1e-3 ? fz / fl : 0;
    const reach = size * 0.45;
    // A fan lies ahead of its root; the rest are centred.
    const lead = kind === 'fan' ? size * 0.4 : 0;
    const cx = this.hit.point.x + ax * lead, cy = this.hit.point.y + 0.14, cz = this.hit.point.z + az * lead;
    for (let i = 0; i < 3 && this.rays < BloodTuning.raysPerFrame * 2; i++) {
      // Ahead, then to either side.
      const dx = i === 0 ? ax : i === 1 ? -az : az;
      const dz = i === 0 ? az : i === 1 ? ax : -ax;
      if (!this.cast(cx, cy, cz, dx, 0, dz, reach) || Math.abs(this.hit.normal.y) > 0.5) continue;
      const past = reach - this.hit.distance;
      if (past < 0.2) continue;
      const s = Math.min(Math.max(past * 2.4, 0.6), size * 0.85);
      // The sheet's impact sits above its middle: low on the wall, where the floor's blood met it.
      _at.copy(this.hit.point);
      _at.y += s * 0.22;
      this.ctx.render.decals.big?.('sheet', _at, this.hit.normal, s, undefined, minor);
      this.bigLaid++;
    }
  }

  private updateBleeders(now: number): void {
    const t = BloodTuning;
    for (let i = 0; i < t.maxBleeders; i++) {
      const b = this.bleeders[i]!;
      if (!b.target) continue;
      if (now >= b.until || (b.owner && (!b.owner.parent || !b.owner.visible))) {
        b.target = null;
        b.owner = null;
        continue;
      }
      _at.copy(b.local).applyMatrix4(b.target.matrixWorld);
      // A wounded man who walks leaves a trail: once his wound is a stride from where it last dripped, a line of drops
      // is laid along the way he came, whatever its timer says.
      const mx = _at.x - b.lx, mz = _at.z - b.lz;
      const moved = b.far ? 0 : Math.hypot(mx, mz);
      if (moved > 4) b.far = true;
      else if (moved >= t.trailFrom && this.drips < t.dripsPerFrame && DevFlags.hitBlood) {
        this.drips++;
        this.dripped++;
        this.o.set((b.lx + _at.x) * 0.5, _at.y, (b.lz + _at.z) * 0.5);
        this.bigRay('trail', this.o, DOWN, 2.6, Math.min(moved, 1.3) * 1.15, this.n.set(mx, 0, mz));
        this.markDrop(b.owner, b, _at);
        b.next = now + b.every;
        continue;
      }
      if (now < b.next) continue;
      // Clotting: drops come slower as the wound ages, and smaller.
      const age = (now - b.start) / Math.max(b.until - b.start, 0.01);
      if (!this.drip(_at, undefined, 1.2 - 0.5 * age)) continue;
      if (b.far || moved < t.trailFrom * 0.5) {
        b.lx = _at.x;
        b.lz = _at.z;
        b.far = false;
      }
      b.next = now + b.every * (1 + 2 * age) * (0.6 + Math.random() * 0.8);
    }
  }

  /** One wound's trail stands for the body's: its other wounds start their stride again from where they are now. */
  private markDrop(owner: THREE.Object3D | null, from: Bleeder, at: THREE.Vector3): void {
    from.lx = at.x;
    from.lz = at.z;
    if (!owner) return;
    for (const b of this.bleeders) {
      if (b === from || b.owner !== owner || !b.target || b.far) continue;
      _splat.copy(b.local).applyMatrix4(b.target.matrixWorld);
      b.lx = _splat.x;
      b.lz = _splat.z;
    }
  }

  private updateDrippers(now: number): void {
    for (const d of this.drippers) {
      if (now >= d.until || now < d.next) continue;
      const age = (now - d.start) / Math.max(d.until - d.start, 0.01);
      if (!this.drip(_at.set(d.x, d.y, d.z), undefined, 1.3 - 0.6 * age)) continue;
      d.next = now + d.every * (1 + 3 * age) * (0.6 + Math.random() * 0.8);
    }
  }

  private updateDroplets(dt: number): void {
    const g = BloodTuning.dropletGravity;
    const check = BloodTuning.dropletCheck;
    const { px, py, pz, lx, ly, lz, vx, vy, vz, life, since, size } = this;
    const camPos = (this.ctx.render?.camera as { position?: THREE.Vector3 } | undefined)?.position;
    const hasCam = camPos !== undefined;
    const camX = hasCam ? camPos.x : 0;
    const camY = hasCam ? camPos.y : 0;
    const camZ = hasCam ? camPos.z : 0;
    const maxRayDistSq = 75 * 75;
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
      if (hasCam) {
        const dx = px[i]! - camX;
        const dy = py[i]! - camY;
        const dz = pz[i]! - camZ;
        if (dx * dx + dy * dy + dz * dz > maxRayDistSq) {
          lx[i] = px[i]!;
          ly[i] = py[i]!;
          lz[i] = pz[i]!;
          continue;
        }
      }
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

  /** Stops transient in-flight droplets, queues, bleeders, drippers, wet spots, and growing pools without resetting counters. */
  sweep(): void {
    this.life.fill(0);
    this.queueHead = 0;
    this.queueLen = 0;
    this.bigLen = 0;
    for (const b of this.bleeders) {
      b.target = null;
      b.owner = null;
    }
    for (const d of this.drippers) d.until = -1;
    for (const w of this.wetSpots) w.until = -1;
    for (const p of this.pools) p.stage = POOL_STAGES;
    this.burstAt = -1;
    this.burstCount = 0;
  }

  clear(): void {
    this.sweep();
    this.dropletAt = 0;
    this.poolAt = 0;
    this.dripperAt = 0;
    this.wetSpotAt = 0;
    this.bleederAt = 0;
    this.rays = 0;
    this.raysUsed = 0;
    this.budgetReset = false;
    this.drips = 0;
    this.sprays = 0;
    this.sheets = 0;
    this.splashes = 0;
    this.sprayChar = null;
    this.sprayAt = -1;
    this.pelletPuffs = 0;
    this.dripped = 0;
    this.bigLaid = 0;
    this.splashed = 0;
    this.printed = 0;
  }
}
