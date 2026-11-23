/**
 * Overgrowth-style gravity-driven surface blood walker & 3-tier bleeding emitter manager.
 *
 * Active bleeding wounds on flesh humanoids (humans AND husks; never machines) do three things together:
 *   1. Grow a seamless 3D soaking collar around the wound into the character's pooled UV blood layer.
 *   2. Spawn surface droplets that walk triangle-by-triangle down the live posed 3D mesh under world-space gravity,
 *      crossing UV seams cleanly and painting crisp trickling trails. When a character falls or crawls, old streaks stay
 *      locked to the body while new drips bend sideways toward the floor.
 *   3. Detach droplets into real falling world drops (`BloodField.drip` / `droplet`) when they reach a downward overhang,
 *      hem, or local minimum, feeding floor stains and pools.
 *
 * Tier 1 (flesh wound):   tight collar + slow short rivulets.
 * Tier 2 (mortal / heavy): wide creeping soak + multiple steady rivulets down the torso and legs.
 * Tier 3 (arterial spurt): heartbeat-pulsing `SpurtField` rope + fast drenching stain + clutching-hand damping & staining.
 */
import * as THREE from 'three';
import {
  BLOOD_MAP_LAYERS,
  BloodSurfacePool,
  clampBarycentric,
  findNearestTri,
  findStepDownTri,
  triBarycentric,
  type BloodTier,
  type WalkMesh,
} from '../characters/anatomy/bloodSurface';
import type { CharacterInstance, Ctx } from '../core/contracts';
import { clamp, rand } from '../core/math';
import type { BloodField } from './blood';
import type { SpurtField } from './spurt';

export const SurfaceBloodTuning = {
  maxBodies: BLOOD_MAP_LAYERS,
  maxEmittersPerBody: 6,
  maxDroplets: 192,
  /** Maximum triangle crossings a single droplet may traverse in one frame. */
  maxCrossingsPerStep: 4,
  /** Dot(triNormal, bindGravity) past which a droplet hangs on an underside and detaches into the air. */
  overhangDot: 0.56,
  /** Minimum tangential gravity magnitude before a droplet slows and pools on a flat top surface. */
  flatFloor: 0.14,
  /** Seconds a stalled droplet pools before absorbing completely. */
  stallLife: 0.45,
  /** Minimum interval between floor-soak passes on the same crawling body. */
  soakInterval: 0.35,
  /** Clutching hand pressure multiplier on arterial jet speed. */
  clutchSpurtScale: 0.46,
  /** Clutching hand multiplier on surface droplet spawn rate (higher = slower interval). */
  clutchIntervalScale: 1.55,
};

interface TierSpec {
  initRadius: number;
  maxRadius: number;
  growPerSec: number;
  dropEvery: readonly [number, number];
  dropSpeed: readonly [number, number];
  dropWidth: readonly [number, number];
  dropVolume: readonly [number, number];
  collarAmount: number;
  fresh: number;
  duration: readonly [number, number];
  spurtPower: number;
}

const TIERS: Record<BloodTier, TierSpec> = {
  1: {
    initRadius: 0.038,
    maxRadius: 0.078,
    growPerSec: 0.006,
    dropEvery: [0.85, 1.35],
    dropSpeed: [0.12, 0.19],
    dropWidth: [1.35, 1.75],
    dropVolume: [0.55, 0.78],
    collarAmount: 0.65,
    fresh: 0.66,
    duration: [8, 13],
    spurtPower: 0,
  },
  2: {
    initRadius: 0.068,
    maxRadius: 0.21,
    growPerSec: 0.018,
    dropEvery: [0.22, 0.40],
    dropSpeed: [0.21, 0.34],
    dropWidth: [1.9, 2.7],
    dropVolume: [1.05, 1.45],
    collarAmount: 0.88,
    fresh: 0.92,
    duration: [16, 26],
    spurtPower: 0,
  },
  3: {
    initRadius: 0.088,
    maxRadius: 0.28,
    growPerSec: 0.026,
    dropEvery: [0.12, 0.22],
    dropSpeed: [0.28, 0.44],
    dropWidth: [2.25, 3.15],
    dropVolume: [1.25, 1.65],
    collarAmount: 0.98,
    fresh: 1.0,
    duration: [14, 24],
    spurtPower: 0.68,
  },
};

export interface BleedWoundOptions {
  /** Rig bone index the wound lives on. */
  bone: number;
  /** World-space wound position. */
  point: THREE.Vector3;
  /** Outward direction for Tier 3 arterial spurts (optional; derived from bone center if omitted). */
  normal?: THREE.Vector3;
  /** 1 = flesh wound, 2 = mortal/heavy ooze, 3 = arterial spurt. */
  tier: BloodTier;
  /** Optional zone identifier (e.g. 'carotid', 'innerThigh', 'lung') for upgrade/clutch/dress targeting. */
  zone?: string;
  /** Override duration in seconds. */
  duration?: number;
  /** Override arterial spurt power multiplier (Tier 3 only). */
  spurtPower?: number;
  /** Set false to suppress the 3D hose spurt even on Tier 3 (e.g. when startStump already started one). */
  withSpurt?: boolean;
}

/** Structural view of `Character` internals needed by the surface walker without circular imports. */
interface SurfaceCharHost extends CharacterInstance {
  readonly a?: {
    readonly walkMesh: WalkMesh | null;
    readonly interior: THREE.BufferGeometry | null;
    readonly bindPositions: readonly THREE.Vector3[];
    readonly bloodPool: BloodSurfacePool;
  };
  isHidden?(boneIndex: number): boolean;
  setBloodMapLayer?(layer: number, active: number, soak: number): void;
}

interface BleedEmitter {
  active: boolean;
  bone: number;
  tri: number;
  bx: number;
  by: number;
  bz: number;
  tier: BloodTier;
  zone: string;
  soakRadius: number;
  maxRadius: number;
  growPerSec: number;
  collarAmount: number;
  fresh: number;
  started: number;
  ends: number;
  nextDrop: number;
  nextSoak: number;
  held: boolean;
  spurtId: number;
  baseSpurtPower: number;
}

interface BodyTrack {
  active: boolean;
  char: SurfaceCharHost | null;
  mesh: WalkMesh | null;
  bindPositions: readonly THREE.Vector3[] | null;
  layer: number;
  soakLevel: number;
  lastSoakAt: number;
  dead: boolean;
  readonly emitters: BleedEmitter[];
}

interface SurfaceDroplet {
  active: boolean;
  bodyIdx: number;
  tri: number;
  prevTri: number;
  b0: number;
  b1: number;
  b2: number;
  volume: number;
  speed: number;
  width: number;
  fresh: number;
  wobble: number;
  stuck: number;
  age: number;
  maxAge: number;
  detachedDropSize: number;
}

function makeEmitter(): BleedEmitter {
  return {
    active: false, bone: 0, tri: -1, bx: 0, by: 0, bz: 0,
    tier: 1, zone: '', soakRadius: 0, maxRadius: 0, growPerSec: 0,
    collarAmount: 0, fresh: 0, started: 0, ends: 0, nextDrop: 0, nextSoak: 0,
    held: false, spurtId: -1, baseSpurtPower: 0,
  };
}

function makeBody(): BodyTrack {
  return {
    active: false, char: null, mesh: null, bindPositions: null,
    layer: -1, soakLevel: 0, lastSoakAt: -10, dead: false,
    emitters: Array.from({ length: SurfaceBloodTuning.maxEmittersPerBody }, makeEmitter),
  };
}

function makeDroplet(): SurfaceDroplet {
  return {
    active: false, bodyIdx: -1, tri: -1, prevTri: -1,
    b0: 0, b1: 0, b2: 0, volume: 0, speed: 0, width: 1.5, fresh: 1,
    wobble: 0, stuck: 0, age: 0, maxAge: 0, detachedDropSize: 1,
  };
}

const _inv = new THREE.Matrix4();
const _qInv = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _localOff = new THREE.Vector3();
const _localAxis = new THREE.Vector3();
const _worldPos = new THREE.Vector3();
const _worldVel = new THREE.Vector3();
const _bary = new Float32Array(3);
const _nbary = new Float32Array(3);

export class SurfaceBloodField {
  private readonly bodies: BodyTrack[] = Array.from({ length: SurfaceBloodTuning.maxBodies }, makeBody);
  private readonly byChar = new Map<object, number>();
  private readonly droplets: SurfaceDroplet[] = Array.from({ length: SurfaceBloodTuning.maxDroplets }, makeDroplet);
  private dropCursor = 0;
  private pool: BloodSurfacePool | null = null;
  private poolWired = false;

  /** Counters for unit tests and diagnostics. */
  dropletsSpawned = 0;
  dropletsDetached = 0;
  spurtsStarted = 0;

  constructor(
    private readonly ctx: Ctx,
    private readonly blood: BloodField,
    private readonly spurts: SpurtField,
    overridePool: BloodSurfacePool | null = null,
  ) {
    this.pool = overridePool;
  }

  /** Lazily resolves the shared `BloodSurfacePool` from `CharacterLibraryImpl` or a character's `ArchetypeData`. */
  private resolvePool(host?: SurfaceCharHost): BloodSurfacePool | null {
    if (!this.pool) {
      const lib = this.ctx.characters as unknown as { bloodPool?: BloodSurfacePool } | undefined;
      this.pool = lib?.bloodPool ?? host?.a?.bloodPool ?? null;
    }
    if (this.pool && !this.poolWired) {
      this.poolWired = true;
      this.pool.onEvict = owner => this.onLayerEvicted(owner);
    }
    return this.pool;
  }

  private onLayerEvicted(owner: object): void {
    const idx = this.byChar.get(owner);
    if (idx === undefined) return;
    this.dropTrack(idx, false);
  }

  /** True if `char` is a flesh humanoid eligible for dynamic blood staining (excludes machines/drones/skitters/Titan). */
  private resolveHost(char: CharacterInstance): { host: SurfaceCharHost; mesh: WalkMesh; bind: readonly THREE.Vector3[]; pool: BloodSurfacePool } | null {
    const host = char as SurfaceCharHost;
    const a = host.a;
    if (!a || !a.interior || !a.walkMesh) return null;
    const pool = this.resolvePool(host);
    if (!pool) return null;
    return { host, mesh: a.walkMesh, bind: a.bindPositions, pool };
  }

  private ensureTrack(char: CharacterInstance, priority: number): { idx: number; track: BodyTrack; pool: BloodSurfacePool } | null {
    const resolved = this.resolveHost(char);
    if (!resolved) return null;
    const { host, mesh, bind, pool } = resolved;
    const now = this.ctx.time.elapsed;

    let idx = this.byChar.get(char);
    if (idx !== undefined) {
      const t = this.bodies[idx]!;
      const layer = pool.acquire(char, priority, now);
      t.layer = layer;
      host.setBloodMapLayer?.(layer + 1, this.maxActiveTier(t) / 3, t.soakLevel);
      return { idx, track: t, pool };
    }

    const layer = pool.acquire(char, priority, now);
    idx = -1;
    for (let i = 0; i < this.bodies.length; i++) {
      if (!this.bodies[i]!.active) {
        idx = i;
        break;
      }
    }
    if (idx < 0) return null;

    const t = this.bodies[idx]!;
    t.active = true;
    t.char = host;
    t.mesh = mesh;
    t.bindPositions = bind;
    t.layer = layer;
    t.soakLevel = 0;
    t.lastSoakAt = -10;
    t.dead = false;
    for (const em of t.emitters) {
      em.active = false;
      em.spurtId = -1;
    }
    this.byChar.set(char, idx);
    host.setBloodMapLayer?.(layer + 1, 0, 0);
    return { idx, track: t, pool };
  }

  private maxActiveTier(t: BodyTrack): number {
    let best = 0;
    for (const em of t.emitters) if (em.active && em.tier > best) best = em.tier;
    return best;
  }

  /**
   * Starts or upgrades a bleeding wound on `char`: paints its initial 3D collar, seeds walking gravity droplets, and on
   * Tier 3 launches a beating arterial `SpurtField` blood rope.
   */
  bleedWound(char: CharacterInstance, opts: BleedWoundOptions): boolean {
    const bone = char.bones[opts.bone];
    if (!bone) return false;
    const res = this.ensureTrack(char, opts.tier === 3 ? 4 : opts.tier === 2 ? 3 : 2);
    if (!res) return false;
    const { idx, track, pool } = res;
    const mesh = track.mesh!;
    const bind = track.bindPositions!;
    const now = this.ctx.time.elapsed;

    // Transform world hit point into bone-local, then bind space (bind rotations are identity).
    bone.updateWorldMatrix(true, false);
    _inv.copy(bone.matrixWorld).invert();
    _localOff.copy(opts.point).applyMatrix4(_inv);
    const bindPos = bind[opts.bone];
    if (!bindPos) return false;
    const bx = _localOff.x + bindPos.x;
    const by = _localOff.y + bindPos.y;
    const bz = _localOff.z + bindPos.z;

    const tri = findNearestTri(mesh, opts.bone, bx, by, bz, _bary);
    if (tri < 0) return false;

    const spec = TIERS[opts.tier];

    // Reuse an existing emitter on the same zone or within 5 cm on the same bone (prevents stacking duplicate ropes).
    let em: BleedEmitter | null = null;
    for (const e of track.emitters) {
      if (!e.active) continue;
      const sameZone = opts.zone !== undefined && e.zone === opts.zone && opts.zone !== '';
      const nearSameBone = e.bone === opts.bone && Math.hypot(e.bx - bx, e.by - by, e.bz - bz) < 0.065;
      if (sameZone || nearSameBone) {
        em = e;
        break;
      }
    }
    if (!em) {
      for (const e of track.emitters) {
        if (!e.active) {
          em = e;
          break;
        }
      }
    }
    if (!em) {
      // Replace the lowest-tier / oldest emitter on this body.
      em = track.emitters[0]!;
      for (const e of track.emitters) {
        if (e.tier < em.tier || (e.tier === em.tier && e.started < em.started)) em = e;
      }
      if (em.spurtId > 0) this.spurts.stop(em.spurtId);
      em.spurtId = -1;
    }

    const upgrade = em.active && opts.tier > em.tier;
    const keepTier = em.active ? (Math.max(em.tier, opts.tier) as BloodTier) : opts.tier;
    const effSpec = TIERS[keepTier];

    em.active = true;
    em.bone = opts.bone;
    em.tri = tri;
    em.bx = bx;
    em.by = by;
    em.bz = bz;
    em.tier = keepTier;
    if (opts.zone) em.zone = opts.zone;
    em.soakRadius = Math.max(em.soakRadius, effSpec.initRadius);
    em.maxRadius = Math.max(em.maxRadius, effSpec.maxRadius);
    em.growPerSec = Math.max(em.growPerSec, effSpec.growPerSec);
    em.collarAmount = Math.max(em.collarAmount, effSpec.collarAmount);
    em.fresh = Math.max(em.fresh, effSpec.fresh);
    em.started = now;
    const dur = opts.duration ?? rand(effSpec.duration[0], effSpec.duration[1]);
    em.ends = Math.max(em.ends, now + dur);
    em.nextDrop = now + 0.04;
    em.nextSoak = now + 0.25;

    // Immediate visible wound collar + initial trickle seed.
    pool.paintCollar(
      track.layer, mesh, tri, bx, by, bz, em.soakRadius, em.collarAmount, em.fresh,
      keepTier === 1 ? 0.3 : 0.55,
      this.nearbyBonesFor(char, opts.bone),
    );
    const seedDrops = keepTier === 3 ? 3 : keepTier === 2 ? 2 : 1;
    for (let i = 0; i < seedDrops; i++) {
      this.spawnDroplet(idx, tri, _bary, keepTier, em.fresh);
    }

    // Tier 3 arterial spurt rope (unless caller suppressed it or one is already running on this emitter).
    if (keepTier === 3 && opts.withSpurt !== false && (em.spurtId <= 0 || upgrade)) {
      if (em.spurtId > 0) this.spurts.stop(em.spurtId);
      if (opts.normal && opts.normal.lengthSq() > 1e-6) {
        bone.getWorldQuaternion(_qInv).invert();
        _localAxis.copy(opts.normal).normalize().applyQuaternion(_qInv);
      } else {
        // Default outward away from the bone's center line, tilted slightly up.
        _localAxis.set(_localOff.x, Math.max(0.18, _localOff.y * 0.25 + 0.18), _localOff.z);
        if (_localAxis.lengthSq() < 1e-4) _localAxis.set(0, 0.25, 1);
        _localAxis.normalize();
      }
      const power = opts.spurtPower ?? effSpec.spurtPower;
      em.baseSpurtPower = power;
      const effPower = em.held ? power * SurfaceBloodTuning.clutchSpurtScale : power;
      em.spurtId = this.spurts.start(bone, _localOff, _localAxis, char.root, Math.min(dur, 18), effPower, 0.22);
      this.spurtsStarted++;
    }

    track.char?.setBloodMapLayer?.(track.layer + 1, this.maxActiveTier(track) / 3, track.soakLevel);
    return true;
  }

  /**
   * Marks which bone/zone is currently clutched by a wounded soldier's hand: damps arterial jet power by ~55%,
   * slows surface drip rate, and stains the clutching hand/forearm with fresh blood.
   */
  setClutch(char: CharacterInstance, heldBone: number | null, handBone?: number, forearmBone?: number): void {
    const idx = this.byChar.get(char);
    if (idx === undefined) return;
    const track = this.bodies[idx]!;
    const pool = this.resolvePool(track.char ?? undefined);
    let clutchedActive = false;

    for (const em of track.emitters) {
      if (!em.active) continue;
      const shouldHold = heldBone !== null && em.bone === heldBone;
      if (shouldHold) clutchedActive = true;
      if (shouldHold !== em.held) {
        em.held = shouldHold;
        if (em.spurtId > 0) {
          this.spurts.setPower(em.spurtId, shouldHold ? em.baseSpurtPower * SurfaceBloodTuning.clutchSpurtScale : em.baseSpurtPower);
        }
      }
    }

    // Blood transfers onto the clutching hand and forearm.
    if (clutchedActive && pool && track.mesh && track.layer >= 0) {
      if (handBone !== undefined) pool.paintBone(track.layer, track.mesh, handBone, 0.85, 0.95);
      if (forearmBone !== undefined) pool.paintBone(track.layer, track.mesh, forearmBone, 0.45, 0.7);
    }
  }

  /**
   * Stops active bleeding emitters on `char` (e.g. wound dressed, medic revived, or fire cauterised).
   * Existing blood stains remain on the model and gradually lose their fresh sheen.
   */
  stopBleeding(char: CharacterInstance, zone?: string): void {
    const idx = this.byChar.get(char);
    if (idx === undefined) return;
    const track = this.bodies[idx]!;
    for (const em of track.emitters) {
      if (!em.active) continue;
      if (zone !== undefined && em.zone !== zone) continue;
      em.active = false;
      em.held = false;
      if (em.spurtId > 0) {
        this.spurts.stop(em.spurtId);
        em.spurtId = -1;
      }
    }
    track.char?.setBloodMapLayer?.(track.layer + 1, this.maxActiveTier(track) / 3, track.soakLevel);
  }

  /**
   * Called when a bleeding body dies: heart pressure drops so arterial ropes taper off over ~2 s,
   * while existing surface droplets keep walking under gravity in the new fallen pose.
   */
  onDeath(char: CharacterInstance): void {
    const idx = this.byChar.get(char);
    if (idx === undefined) return;
    const track = this.bodies[idx]!;
    track.dead = true;
    const now = this.ctx.time.elapsed;
    for (const em of track.emitters) {
      if (!em.active) continue;
      em.held = false;
      // Heart stops pumping: residual ooze tapers off over a few seconds.
      em.ends = Math.min(em.ends, now + (em.tier === 3 ? 4.5 : 3.0));
      if (em.spurtId > 0) {
        this.spurts.clampRemaining(em.spurtId, 2.0, 0.65);
      }
    }
    this.resolvePool(track.char ?? undefined)?.setPriority(char, 1);
  }

  /**
   * Soaks the floor-facing side of a downed, crawling, or settled body lying in wet blood.
   */
  soakPool(char: CharacterInstance, floorY: number, amount = 0.72, maxHeight = 0.22): boolean {
    const res = this.ensureTrack(char, 1);
    if (!res) return false;
    const { track, pool } = res;
    const now = this.ctx.time.elapsed;
    if (now - track.lastSoakAt < SurfaceBloodTuning.soakInterval) return false;
    track.lastSoakAt = now;

    char.root.updateMatrixWorld(true);
    const soaked = pool.paintFloorSoak(track.layer, track.mesh!, char.bones, track.bindPositions!, floorY, maxHeight, amount, 0.55);
    if (soaked) {
      track.soakLevel = Math.min(1, track.soakLevel + amount * 0.45);
      track.char?.setBloodMapLayer?.(track.layer + 1, this.maxActiveTier(track) / 3, track.soakLevel);
    }
    return soaked;
  }

  /** Drops tracking when a character leaves the scene or is reclaimed/baked. */
  forget(char: CharacterInstance): void {
    const idx = this.byChar.get(char);
    if (idx !== undefined) this.dropTrack(idx, true);
  }

  private dropTrack(idx: number, releaseLayer: boolean): void {
    const track = this.bodies[idx]!;
    if (!track.active) return;
    const char = track.char;
    for (const em of track.emitters) {
      if (em.spurtId > 0) this.spurts.stop(em.spurtId);
      em.active = false;
      em.spurtId = -1;
    }
    for (const d of this.droplets) {
      if (d.active && d.bodyIdx === idx) d.active = false;
    }
    if (char) {
      this.byChar.delete(char);
      char.setBloodMapLayer?.(0, 0, 0);
      if (releaseLayer) this.resolvePool(char)?.release(char);
    }
    track.active = false;
    track.char = null;
    track.mesh = null;
    track.bindPositions = null;
    track.layer = -1;
  }

  private spawnDroplet(bodyIdx: number, tri: number, bary: Float32Array, tier: BloodTier, fresh: number): void {
    let slot: SurfaceDroplet | null = null;
    for (let i = 0; i < this.droplets.length; i++) {
      const k = (this.dropCursor + i) % this.droplets.length;
      if (!this.droplets[k]!.active) {
        slot = this.droplets[k]!;
        this.dropCursor = (k + 1) % this.droplets.length;
        break;
      }
    }
    if (!slot) {
      slot = this.droplets[this.dropCursor]!;
      this.dropCursor = (this.dropCursor + 1) % this.droplets.length;
    }
    const spec = TIERS[tier];
    slot.active = true;
    slot.bodyIdx = bodyIdx;
    slot.tri = tri;
    slot.prevTri = -1;
    // Slight barycentric jitter so consecutive rivulets take slightly different paths down the torso/legs.
    let b0 = Math.max(0.05, bary[0]! + rand(-0.18, 0.18));
    let b1 = Math.max(0.05, bary[1]! + rand(-0.18, 0.18));
    let b2 = Math.max(0.05, bary[2]! + rand(-0.18, 0.18));
    const sum = b0 + b1 + b2;
    slot.b0 = b0 / sum;
    slot.b1 = b1 / sum;
    slot.b2 = b2 / sum;
    slot.volume = rand(spec.dropVolume[0], spec.dropVolume[1]);
    slot.speed = rand(spec.dropSpeed[0], spec.dropSpeed[1]);
    slot.width = rand(spec.dropWidth[0], spec.dropWidth[1]);
    slot.fresh = fresh;
    slot.wobble = rand(0, Math.PI * 2);
    slot.stuck = 0;
    slot.age = 0;
    slot.maxAge = tier === 3 ? rand(5.5, 9.0) : tier === 2 ? rand(4.0, 7.0) : rand(2.2, 4.0);
    slot.detachedDropSize = tier === 3 ? 1.25 : tier === 2 ? 1.0 : 0.72;
    this.dropletsSpawned++;
  }

  /** Steps all active wound emitters, walking surface droplets, freshness decay, and GPU partial layer uploads. */
  update(dt: number): void {
    const pool = this.resolvePool();
    if (!pool) return;
    const stepDt = Math.min(Math.max(dt, 0), 0.05);
    const now = this.ctx.time.elapsed;

    // 1. Tick emitters & prune departed/reclaimed bodies.
    for (let i = 0; i < this.bodies.length; i++) {
      const t = this.bodies[i]!;
      if (!t.active) continue;
      const char = t.char!;
      if (!char.root.parent || !char.root.visible || pool.layerOf(char) !== t.layer) {
        this.dropTrack(i, false);
        continue;
      }

      let anyActive = false;
      for (const em of t.emitters) {
        if (!em.active) continue;
        if (now >= em.ends || char.isHidden?.(em.bone)) {
          em.active = false;
          if (em.spurtId > 0) {
            this.spurts.stop(em.spurtId);
            em.spurtId = -1;
          }
          continue;
        }
        anyActive = true;

        // Creeping soak collar around the active wound.
        if (now >= em.nextSoak) {
          em.nextSoak = now + 0.35;
          const growth = em.growPerSec * 0.35 * (em.held ? 0.55 : 1);
          if (em.soakRadius < em.maxRadius) em.soakRadius = Math.min(em.maxRadius, em.soakRadius + growth);
          const life = clamp((now - em.started) / Math.max(0.01, em.ends - em.started));
          pool.paintCollar(
            t.layer, t.mesh!, em.tri, em.bx, em.by, em.bz,
            em.soakRadius, em.collarAmount * (1 - life * 0.25), em.fresh * (1 - life * 0.35),
            em.tier === 1 ? 0.3 : 0.65,
            this.nearbyBonesFor(char, em.bone),
          );
        }

        // Spawn gravity-walking surface droplets.
        if (now >= em.nextDrop) {
          const spec = TIERS[em.tier];
          const life = clamp((now - em.started) / Math.max(0.01, em.ends - em.started));
          const heldMul = em.held ? SurfaceBloodTuning.clutchIntervalScale : 1;
          const clotMul = 1 + life * 1.4;
          em.nextDrop = now + rand(spec.dropEvery[0], spec.dropEvery[1]) * heldMul * clotMul;
          triBarycentric(t.mesh!, em.tri, em.bx, em.by, em.bz, _bary);
          clampBarycentric(_bary);
          this.spawnDroplet(i, em.tri, _bary, em.tier, em.fresh * (1 - life * 0.3));
        }
      }

      const activeTier = anyActive ? this.maxActiveTier(t) / 3 : 0;
      char.setBloodMapLayer?.(t.layer + 1, activeTier, t.soakLevel);
    }

    // 2. Step surface-walking droplets along live posed world gravity.
    if (stepDt > 0) {
      for (let i = 0; i < this.droplets.length; i++) {
        const d = this.droplets[i]!;
        if (!d.active) continue;
        this.stepDroplet(d, stepDt, pool);
      }
      // 3. Gently dull bright fresh sheen once pumping stops.
      pool.decayFreshness(stepDt);
    }

    // 4. Upload only dirty layers to GPU.
    pool.flush();
  }

  private stepDroplet(d: SurfaceDroplet, dt: number, pool: BloodSurfacePool): void {
    const track = this.bodies[d.bodyIdx];
    if (!track || !track.active || !track.char || !track.mesh || !track.bindPositions) {
      d.active = false;
      return;
    }
    d.age += dt;
    if (d.age >= d.maxAge || d.volume <= 0.05) {
      d.active = false;
      return;
    }

    const char = track.char;
    const mesh = track.mesh;
    const bind = track.bindPositions;
    let remaining = dt;

    for (let hop = 0; hop < SurfaceBloodTuning.maxCrossingsPerStep && remaining > 1e-4; hop++) {
      const tri = d.tri;
      const boneIdx = mesh.triBone[tri]!;
      const bone = char.bones[boneIdx];
      const bindPos = bind[boneIdx];
      if (!bone || !bindPos || char.isHidden?.(boneIdx)) {
        d.active = false;
        return;
      }

      // World gravity (0, -1, 0) pulled into this bone's bind space via R^T * (0, -1, 0) = (-m[1], -m[5], -m[9]).
      const me = bone.matrixWorld.elements;
      let gx = -me[1]!, gy = -me[5]!, gz = -me[9]!;
      const gl = Math.hypot(gx, gy, gz);
      if (gl < 1e-4) {
        d.active = false;
        return;
      }
      gx /= gl; gy /= gl; gz /= gl;

      const nc = tri * 3;
      const nx = mesh.triNormal[nc]!, ny = mesh.triNormal[nc + 1]!, nz = mesh.triNormal[nc + 2]!;
      const nDotG = nx * gx + ny * gy + nz * gz;

      // Current 3D bind position & UV.
      const tp = tri * 9;
      const px = mesh.triPos[tp]! * d.b0 + mesh.triPos[tp + 3]! * d.b1 + mesh.triPos[tp + 6]! * d.b2;
      const py = mesh.triPos[tp + 1]! * d.b0 + mesh.triPos[tp + 4]! * d.b1 + mesh.triPos[tp + 7]! * d.b2;
      const pz = mesh.triPos[tp + 2]! * d.b0 + mesh.triPos[tp + 5]! * d.b1 + mesh.triPos[tp + 8]! * d.b2;

      const tu = tri * 6;
      const u0 = mesh.triUv[tu]! * d.b0 + mesh.triUv[tu + 2]! * d.b1 + mesh.triUv[tu + 4]! * d.b2;
      const v0 = mesh.triUv[tu + 1]! * d.b0 + mesh.triUv[tu + 3]! * d.b1 + mesh.triUv[tu + 5]! * d.b2;

      // Overhang check: surface faces strongly downward -> droplet drips off into the air!
      if (nDotG > SurfaceBloodTuning.overhangDot && d.age > 0.14) {
        this.detachToWorld(bone, bindPos, px, py, pz, d);
        d.active = false;
        return;
      }

      // Project gravity onto triangle plane: flow = g - N * (N · g).
      let fx = gx - nx * nDotG;
      let fy = gy - ny * nDotG;
      let fz = gz - nz * nDotG;
      const fl = Math.hypot(fx, fy, fz);

      if (fl < SurfaceBloodTuning.flatFloor) {
        // Flat top surface (shoulder, chest lying face-up): pool slightly and slow down.
        d.stuck += remaining;
        pool.paintStreak(track.layer, u0, v0, u0, v0, d.width * 1.25, Math.min(0.9, d.volume * 0.65), d.fresh);
        d.volume -= remaining * 0.25;
        if (d.stuck >= SurfaceBloodTuning.stallLife) d.active = false;
        return;
      }

      d.stuck = 0;
      fx /= fl; fy /= fl; fz /= fl;

      // Subtle organic cloth-weave meander perpendicular to flow.
      d.wobble += remaining * 7.5;
      const sx = ny * fz - nz * fy;
      const sy = nz * fx - nx * fz;
      const sz = nx * fy - ny * fx;
      const sway = Math.sin(d.wobble) * 0.14;
      fx += sx * sway; fy += sy * sway; fz += sz * sway;
      const fl2 = Math.hypot(fx, fy, fz) || 1;
      fx /= fl2; fy /= fl2; fz /= fl2;

      const stepDist = d.speed * (0.4 + 0.6 * fl) * remaining;
      const npx = px + fx * stepDist;
      const npy = py + fy * stepDist;
      const npz = pz + fz * stepDist;

      triBarycentric(mesh, tri, npx, npy, npz, _nbary);
      const inside = _nbary[0]! >= 0 && _nbary[1]! >= 0 && _nbary[2]! >= 0;

      if (inside) {
        const u1 = mesh.triUv[tu]! * _nbary[0]! + mesh.triUv[tu + 2]! * _nbary[1]! + mesh.triUv[tu + 4]! * _nbary[2]!;
        const v1 = mesh.triUv[tu + 1]! * _nbary[0]! + mesh.triUv[tu + 3]! * _nbary[1]! + mesh.triUv[tu + 5]! * _nbary[2]!;
        const cov = clamp(d.volume * 0.85, 0.15, 0.96);
        pool.paintStreak(track.layer, u0, v0, u1, v1, d.width, cov, d.fresh);
        d.b0 = _nbary[0]!;
        d.b1 = _nbary[1]!;
        d.b2 = _nbary[2]!;
        d.volume -= stepDist * 0.42;
        d.width = Math.max(1.05, d.width - stepDist * 0.25);
        return;
      }

      // Crossed an edge: find the most-negative barycentric component to pick the exit edge.
      let edgeIdx = 0;
      let minB = _nbary[2]!; // edge 0 (v0-v1) corresponds to b2 < 0
      if (_nbary[0]! < minB) { minB = _nbary[0]!; edgeIdx = 1; } // edge 1 (v1-v2)
      if (_nbary[1]! < minB) { edgeIdx = 2; } // edge 2 (v2-v0)

      // Compute fraction along the step where it hit the edge, paint up to the edge cleanly.
      const startB = edgeIdx === 0 ? d.b2 : edgeIdx === 1 ? d.b0 : d.b1;
      const endB = edgeIdx === 0 ? _nbary[2]! : edgeIdx === 1 ? _nbary[0]! : _nbary[1]!;
      const denom = startB - endB;
      const frac = denom > 1e-6 ? clamp(startB / denom, 0.01, 1) : 1;

      const cpx = px + fx * stepDist * frac;
      const cpy = py + fy * stepDist * frac;
      const cpz = pz + fz * stepDist * frac;
      triBarycentric(mesh, tri, cpx, cpy, cpz, _nbary);
      clampBarycentric(_nbary);

      const u1 = mesh.triUv[tu]! * _nbary[0]! + mesh.triUv[tu + 2]! * _nbary[1]! + mesh.triUv[tu + 4]! * _nbary[2]!;
      const v1 = mesh.triUv[tu + 1]! * _nbary[0]! + mesh.triUv[tu + 3]! * _nbary[1]! + mesh.triUv[tu + 5]! * _nbary[2]!;
      pool.paintStreak(track.layer, u0, v0, u1, v1, d.width, clamp(d.volume * 0.85, 0.15, 0.96), d.fresh);
      d.volume -= stepDist * frac * 0.42;

      const nextTri = mesh.triAdj[tri * 3 + edgeIdx]!;
      if (nextTri < 0) {
        // Layered armor/vest/belt hem: hop onto an underlying or lower shell along gravity before detaching into air.
        const catchTri = findStepDownTri(mesh, tri, cpx, cpy, cpz, gx, gy, gz, 0.065, _nbary);
        if (catchTri >= 0 && catchTri !== d.prevTri) {
          d.prevTri = tri;
          d.tri = catchTri;
          d.b0 = _nbary[0]!;
          d.b1 = _nbary[1]!;
          d.b2 = _nbary[2]!;
          remaining *= Math.max(0, 1 - frac);
          continue;
        }
        this.detachToWorld(bone, bindPos, cpx, cpy, cpz, d);
        d.active = false;
        return;
      }
      if (nextTri === d.prevTri) {
        // Valley crease: detach into a real falling blood drop.
        this.detachToWorld(bone, bindPos, cpx, cpy, cpz, d);
        d.active = false;
        return;
      }

      // Seamlessly cross into `nextTri` by projecting the 3D crossing point onto `nextTri`'s corners.
      d.prevTri = tri;
      d.tri = nextTri;
      triBarycentric(mesh, nextTri, cpx, cpy, cpz, _nbary);
      clampBarycentric(_nbary);
      d.b0 = _nbary[0]!;
      d.b1 = _nbary[1]!;
      d.b2 = _nbary[2]!;
      remaining *= Math.max(0, 1 - frac);
    }
  }

  private readonly nearBones: number[] = [];

  /** Returns the wound bone plus its parent and direct rig children (reused buffer) so layered shells soak together. */
  private nearbyBonesFor(char: CharacterInstance, bone: number): readonly number[] {
    const out = this.nearBones;
    out.length = 0;
    const defs = char.rig.bones;
    out.push(bone);
    const parent = defs[bone]?.parent ?? -1;
    if (parent >= 0) {
      out.push(parent);
      const grand = defs[parent]?.parent ?? -1;
      if (grand >= 0) out.push(grand);
    }
    for (let i = 0; i < defs.length; i++) {
      if (defs[i]!.parent === bone) out.push(i);
    }
    return out;
  }

  /** Converts a detaching surface droplet into a falling world drop that lands and stains the floor. */
  private detachToWorld(bone: THREE.Bone, bindPos: THREE.Vector3, px: number, py: number, pz: number, d: SurfaceDroplet): void {
    _v.set(px - bindPos.x, py - bindPos.y, pz - bindPos.z);
    _worldPos.copy(_v).applyMatrix4(bone.matrixWorld);
    _worldVel.set(rand(-0.18, 0.18), -0.4, rand(-0.18, 0.18));
    this.blood.drip(_worldPos, _worldVel, d.detachedDropSize);
    this.blood.droplet(_worldPos.x, _worldPos.y, _worldPos.z, _worldVel.x, _worldVel.y, _worldVel.z, 0.045 + 0.04 * d.detachedDropSize);
    this.dropletsDetached++;
  }

  /** Active tracked bodies count, for diagnostics and tests. */
  get activeBodies(): number {
    return this.byChar.size;
  }

  /** Active walking surface droplets count, for diagnostics and tests. */
  get activeDroplets(): number {
    let n = 0;
    for (const d of this.droplets) if (d.active) n++;
    return n;
  }

  clear(): void {
    for (let i = 0; i < this.bodies.length; i++) {
      if (this.bodies[i]!.active) this.dropTrack(i, false);
    }
    for (const d of this.droplets) d.active = false;
    this.byChar.clear();
    this.dropCursor = 0;
    this.dropletsSpawned = 0;
    this.dropletsDetached = 0;
    this.spurtsStarted = 0;
    this.pool?.clear();
  }
}
