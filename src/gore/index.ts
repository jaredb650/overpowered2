/**
 * GoreSystem: everything that happens to a body once the shot has landed.
 *
 * One death path, chosen once. A character enters here through ragdoll, gib, slice or headshot and from
 * then on is owned by this system until it is released. Repeat calls on an owned character are absorbed,
 * which is what stops the first game's ragdoll-and-dismember double solver from coming back.
 */
import * as THREE from 'three';
import { ARCHETYPES } from '../characters/archetypes';
import type { GoreRegion } from '../characters/rig';
import type {
  CapsuleHit, CharacterInstance, CorpseHit, Ctx, DamageInfo, DamageType, EmitterHandle, GoreSystem, RagdollOptions,
  SeveredLimb, SeverResult,
} from '../core/contracts';
import { clamp, rand, randomInCone, randomUnit } from '../core/math';
import { BloodField, BloodTuning } from './blood';
import { ChunkField, scatter } from './chunks';
import { ImpactEvents, impactKind, ImpactTuning } from './impacts';
import { CollapseDrive, impactStrength, MuscleTuning, type CollapseOptions } from './muscles';
import { BodyFilter, fillVelocity, LimbFilter, measureAnimVelocity, Rag, SEED_STRIDE } from './rag';
import { boneRay, boneRayContact, nextCapsuleHit, rayBones, rayNearSphere } from './raycast';
import { Crawler } from './crawl';
import { markSevered, markSubtree, MAX_BONES, rigInfo, type RigInfo } from './rigInfo';
import { SliceField } from './sliced';

export const GoreTuning = {
  /** Simulated ragdolls. Past this the oldest freezes. */
  maxRagdolls: 14,
  /** Bodies still holding themselves up. Past this a collapse is just a ragdoll. */
  maxCollapses: 4,
  /** Frozen and simulated bodies together. Past this the oldest sinks away. */
  maxCorpses: 40,
  /** Loose limbs in the world, and how many of them may be simulating. */
  maxLimbs: 48,
  maxLiveLimbs: 22,
  /**
   * Limbs of one archetype. The character library pools 24 and takes the oldest back when asked for more,
   * which would leave us driving a part it has already given to someone else. Stay under it and evict first.
   */
  maxLimbsPerArchetype: 22,
  maxStumps: 32,
  /** Speed and spin below which a chain counts as still. */
  calmSpeed: 0.35,
  calmSpin: 1.1,
  /** Seconds still before freezing. */
  settleTime: 0.45,
  /** A body stops simulating after this long no matter what. Pinned bodies get longer to swing out. */
  maxSimTime: 7,
  maxPinnedSimTime: 14,
  sinkSeconds: 2.2,
  sinkDepth: 1.2,
  /** Heartbeat of a stump. A strong beat, a weaker echo, then a pause that stretches as pressure falls. */
  beatPeriod: 0.62,
  beatEcho: 0.2,
  stumpSeconds: 4.5,
  /** Damage at or above this bursts the head. Below it the head pops off whole. */
  headBurstDamage: 40,
  /** The beat a headless body stands there before anything gives. */
  headHoldSeconds: 0.32,
  /** How long a headless body stumbles when the head pops off whole, and there are no muscles to do it with. */
  headStumbleSeconds: 1.1,
  /** How long a headless body takes to go down once it starts to. */
  headCollapseSeconds: 1.15,
  /** Even a clean cut sets a limb tumbling, whatever the strength of the hit. */
  limbImpactFloor: 0.3,
  /** The first game's accidental frame drop, on purpose. */
  hitStopSeconds: 0.05,
  hitStopScale: 0.03,
  /** Fraction of DamageInfo.force that a severed limb takes. The rest went into the wound. */
  limbForceShare: 0.45,
  /** Damage a corpse limb takes before it comes off. */
  corpseLimbHealth: 60,
  /** Damage a loose limb takes before it bursts into chunks. */
  limbBurstHealth: 90,
  /** How long a top half keeps dragging itself along. */
  crawlSeconds: 7,
};

const DEFAULT_FORCE: Record<DamageType, number> = {
  bullet: 170, pellet: 120, explosive: 560, melee: 280, slash: 220, fire: 15, shock: 50, crush: 320, true: 150,
};

const forceOf = (d: DamageInfo): number => (d.force > 0 ? d.force : DEFAULT_FORCE[d.type]);

const MAX_STAKES = 3;

const machines = new Set(ARCHETYPES.filter(a => a.stumps === 'machine').map(a => a.id));
/** Drones and skitters spark where everything else bleeds. */
const isMachine = (char: CharacterInstance): boolean => machines.has(char.archetype);

/** Which limbs a gib throws as real parts, in order. */
const GIB_REGIONS: readonly GoreRegion[] = ['head', 'armL', 'armR', 'legL', 'legR'];
const GIB_LOWER: Partial<Record<GoreRegion, GoreRegion>> = {
  armL: 'forearmL', armR: 'forearmR', legL: 'shinL', legR: 'shinR',
};

/** A character that has died and is in our care. */
class DeadBody {
  rag: Rag | null = null;
  /** World time the collapse starts, while a headless body is still on its feet. */
  holdUntil = -1;
  holdAnim = false;
  /** Shot during the hold: it just drops. */
  holdBroken = false;
  holdVelocity = new THREE.Vector3();
  readonly stakes: Stake[] = [];
  sinking = -1;
  sinkFrom = 0;
  smearLeft = 7;
  readonly smearAt = new THREE.Vector3();
  pooled = false;
  /** Bones gone from this body. */
  readonly skip = new Uint8Array(MAX_BONES);
  readonly damage = new Float32Array(MAX_BONES);
  constructor(readonly char: CharacterInstance, readonly info: RigInfo) {}
}

/**
 * True when the character library has taken this instance back from under us, which it does when an archetype
 * runs out of instances. A ragdoll keeps the hips at the root's origin, and a reset puts them back at standing
 * height, so that tells a corpse from a recycled enemy without any cooperation from the library.
 */
function reclaimed(b: DeadBody): boolean {
  if (b.rag === null) return false;
  return b.char.root.parent === null || b.char.bones[0]!.position.lengthSq() > 1e-6;
}

/** A piece cut from a character. Lives on after the character is gone. */
class LooseLimb {
  sinking = -1;
  sinkFrom = 0;
  /** Distance since the last trail drop. */
  trail = 0;
  smear = 0;
  readonly smearAt = new THREE.Vector3();
  prevSpeed = 0;
  dripAt = 0;
  emitter: EmitterHandle | null = null;
  /** Short arterial spray from the cut end of the limb. */
  endSpray: EmitterHandle | null = null;
  /** Present on a top half that is still pulling itself along. */
  crawler: Crawler | null = null;
  machine = false;
  readonly stakes: Stake[] = [];
  health = GoreTuning.limbBurstHealth;
  readonly lastPos = new THREE.Vector3();
  readonly skip = new Uint8Array(MAX_BONES);
  constructor(
    readonly piece: SeveredLimb,
    readonly rag: Rag,
    readonly rootBone: number,
    readonly info: RigInfo,
    readonly born: number,
    readonly archetype: string,
  ) {
    for (let i = 0; i < info.count; i++) this.skip[i] = rag.mask[i] === 1 ? 0 : 1;
    this.lastPos.copy(rag.center);
  }
}

/** The arterial end of a wound. Follows a bone and beats. */
class Stump {
  emitter: EmitterHandle | null = null;
  nextBeat = 0;
  beat = 0;
  ends = 0;
  started = 0;
  power = 1;
  readonly offset = new THREE.Vector3();
  readonly axis = new THREE.Vector3();
  target: THREE.Object3D | null = null;
  /** The character's root. Stumps die with it, whoever released it. */
  owner: THREE.Object3D | null = null;
  machine = false;
}

type PinTarget = DeadBody | LooseLimb;

/** A stake through a bone. Survives a freeze, so a pinned corpse that wakes stays on the wall. */
interface Stake {
  bone: number;
  anchor: THREE.Vector3;
}

interface PendingPin {
  target: PinTarget;
  stake: Stake;
  until: number;
}

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _seeds = new Float32Array(MAX_BONES * SEED_STRIDE);
const _mask = new Uint8Array(MAX_BONES);
const _skip = new Uint8Array(MAX_BONES);
const _up = new THREE.Vector3(0, 1, 0);

/** Corpse hits, like capsule hits, come from a ring so a shot can hold one while testing the next. */
const corpseRing: CorpseHit[] = Array.from({ length: 16 }, () => ({
  distance: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(), handle: null, bone: 0, region: 'chest' as GoreRegion,
}));
let corpseAt = 0;

export class Gore implements GoreSystem {
  private bodies: DeadBody[] = [];
  private readonly owned = new Map<CharacterInstance, DeadBody>();
  private limbs: LooseLimb[] = [];
  private readonly stumps: Stump[] = Array.from({ length: GoreTuning.maxStumps }, () => new Stump());
  private stumpAt = 0;
  private pins: PendingPin[] = [];
  readonly blood: BloodField;
  readonly chunks: ChunkField;
  readonly sliced: SliceField;
  private readonly impacts: ImpactEvents;
  private ready = false;
  private readonly onPreStep = (dt: number): void => this.preStep(dt);
  private readonly onRadial = (center: THREE.Vector3, radius: number, strength: number): void =>
    this.blast(center, radius, strength);

  constructor(private readonly ctx: Ctx) {
    this.blood = new BloodField(ctx);
    this.impacts = new ImpactEvents(ctx);
    this.chunks = new ChunkField(ctx, this.blood, this.impacts);
    this.sliced = new SliceField(ctx, this.blood, this.impacts);
  }

  init(): void {
    if (this.ready) return;
    this.ready = true;
    this.ctx.physics.preStep.add(this.onPreStep);
    this.ctx.physics.radialListeners.add(this.onRadial);
  }

  // -------------------------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------------------------

  /** True once a character has died into this system. Its animation must no longer be updated. */
  owns(char: CharacterInstance): boolean {
    return this.owned.has(char);
  }

  raycastCharacter(char: CharacterInstance, origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): CapsuleHit | null {
    const info = rigInfo(char.rig);
    const hips = char.bones[0]!.matrixWorld.elements;
    if (!rayNearSphere(
      origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, hips[12]!, hips[13]!, hips[14]!, info.reach[0]!, maxDist,
    )) return null;
    let skip: Uint8Array | null = null;
    if (char.severed.size > 0) {
      markSevered(info, char.severed, _skip);
      skip = _skip;
    }
    if (!rayBones(info, char.bones, skip, origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, maxDist)) return null;
    const hit = nextCapsuleHit();
    boneRayContact(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, hit.point, hit.normal);
    hit.distance = boneRay.distance;
    hit.bone = boneRay.bone;
    hit.region = char.rig.bones[boneRay.bone]!.region;
    return hit;
  }

  raycastCorpses(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): CorpseHit | null {
    let best = maxDist;
    let bestHandle: DeadBody | LooseLimb | null = null;
    let bestBone = -1;
    const ox = origin.x;
    const oy = origin.y;
    const oz = origin.z;
    const dx = dir.x;
    const dy = dir.y;
    const dz = dir.z;
    const out = corpseRing[corpseAt = (corpseAt + 1) % corpseRing.length]!;
    for (let i = 0; i < this.bodies.length; i++) {
      const b = this.bodies[i]!;
      if (b.sinking >= 0) continue;
      const hips = b.char.bones[0]!.matrixWorld.elements;
      if (!rayNearSphere(ox, oy, oz, dx, dy, dz, hips[12]!, hips[13]!, hips[14]!, b.info.reach[0]!, best)) continue;
      if (rayBones(b.info, b.char.bones, b.skip, ox, oy, oz, dx, dy, dz, best)) {
        best = boneRay.distance;
        bestHandle = b;
        bestBone = boneRay.bone;
        boneRayContact(ox, oy, oz, dx, dy, dz, out.point, out.normal);
      }
    }
    for (let i = 0; i < this.limbs.length; i++) {
      const l = this.limbs[i]!;
      if (l.sinking >= 0) continue;
      const c = l.rag.center;
      if (!rayNearSphere(ox, oy, oz, dx, dy, dz, c.x, c.y, c.z, l.info.reach[l.rootBone]!, best)) continue;
      if (rayBones(l.info, l.piece.bones, l.skip, ox, oy, oz, dx, dy, dz, best)) {
        best = boneRay.distance;
        bestHandle = l;
        bestBone = boneRay.bone;
        boneRayContact(ox, oy, oz, dx, dy, dz, out.point, out.normal);
      }
    }
    const slice = this.sliced.raycast(origin, dir, best, out.point, out.normal);
    if (slice) {
      out.distance = this.sliced.lastDistance;
      out.handle = slice;
      out.bone = -1;
      out.region = 'chest';
      return out;
    }
    if (!bestHandle) return null;
    out.distance = best;
    out.handle = bestHandle;
    out.bone = bestBone;
    out.region = bestHandle.info.rig.bones[bestBone]!.region;
    return out;
  }

  // -------------------------------------------------------------------------------------------
  // Ragdolls
  // -------------------------------------------------------------------------------------------

  ragdoll(char: CharacterInstance, options?: RagdollOptions): void {
    const existing = this.owned.get(char);
    if (existing) {
      if (existing.rag?.active) {
        // Rapid further hits kill outright, and a repeat death call on a body going down is exactly that.
        existing.rag.muscle?.dropNow();
        if (options?.impulses) {
          for (const i of options.impulses) existing.rag.applyImpulse(i.bone, i.point, i.impulse);
        }
        this.strike(existing.rag, options, MuscleTuning.corpseImpact);
      } else if (existing.rag === null && options?.velocity) {
        existing.holdVelocity.copy(options.velocity);
      }
      return;
    }
    const body = this.adopt(char);
    this.startRag(body, options);
  }

  collapse(char: CharacterInstance, options?: CollapseOptions): void {
    if (this.owned.has(char)) return;
    const body = this.adopt(char);
    this.beginCollapse(body, options?.duration ?? MuscleTuning.collapseSeconds, options?.velocity, options?.twitch);
  }

  private beginCollapse(body: DeadBody, duration: number, velocity?: THREE.Vector3, twitch?: number): void {
    const { char } = body;
    // Short of GoreTuning.maxSimTime, with time left over to land.
    const seconds = clamp(duration, 0.3, 5);
    let drive: CollapseDrive | null = null;
    if (MuscleTuning.enabled && this.collapsing() < GoreTuning.maxCollapses) {
      // A first call only asks how long the action runs, so it can be stretched over the whole collapse.
      const natural = char.anim.play('deathStumble');
      if (natural > 0) char.anim.play('deathStumble', natural / seconds);
      drive = new CollapseDrive(char.anim, char.root, char.bones, seconds, velocity);
    }
    this.startRag(body, { velocity, twitch });
    const muscle = body.rag!.muscle;
    if (drive && muscle?.canStand()) muscle.startCollapse(drive);
  }

  private collapsing(): number {
    let n = 0;
    for (const b of this.bodies) if (b.rag?.muscle?.collapse) n++;
    return n;
  }

  /** The limbs' share of a hit, from what the caller said or else from the impulses themselves. */
  private strike(rag: Rag, options: RagdollOptions | undefined, scale: number): void {
    const muscle = rag.muscle;
    if (!muscle) return;
    if (options?.impact) {
      muscle.kick(options.impact.dir, options.impact.strength * scale);
      return;
    }
    if (!options?.impulses) return;
    _v.set(0, 0, 0);
    for (const i of options.impulses) _v.add(i.impulse);
    const force = _v.length();
    if (force > 1) muscle.kick(_v, impactStrength(force, rag.info.mass) * scale);
  }

  private adopt(char: CharacterInstance): DeadBody {
    const body = new DeadBody(char, rigInfo(char.rig));
    markSevered(body.info, char.severed, body.skip);
    this.owned.set(char, body);
    this.bodies.push(body);
    return body;
  }

  private startRag(body: DeadBody, options?: RagdollOptions): void {
    const { char, info } = body;
    measureAnimVelocity(char, char.anim, options?.velocity, _seeds);
    for (let i = 0; i < info.count; i++) _mask[i] = body.skip[i] === 1 ? 0 : 1;
    body.rag = new Rag(this.ctx.physics, char, {
      chainRoot: 0,
      mask: _mask,
      seeds: _seeds,
      membership: BodyFilter.membership,
      collidesWith: BodyFilter.collidesWith,
      restitution: 0.02,
      friction: 0.72,
      muscles: options?.muscles ?? MuscleTuning.enabled,
    });
    body.smearAt.copy(body.rag.center);
    if (options?.impulses) {
      for (const i of options.impulses) {
        body.rag.applyImpulse(i.bone, i.point, i.impulse);
        // The wall behind the shot takes what came through.
        const force = i.impulse.length();
        if (force < 1 || !Number.isFinite(force)) continue;
        _v.copy(i.impulse).divideScalar(force);
        this.bleed(char, i.point, _v, 5, 6, 0.42);
      }
    }
    this.strike(body.rag, options, 1);
    const twitch = options?.twitch ?? (char.severed.has('head') ? 1 : 0);
    if (twitch > 0 && !isMachine(char)) body.rag.muscle?.startTwitch(twitch);
    this.enforceBudget();
  }

  /** Blood down a line, unless this is a machine, which sparks instead. */
  private bleed(char: CharacterInstance, at: THREE.Vector3, dir: THREE.Vector3, count: number, reach: number, size: number): void {
    if (isMachine(char)) {
      this.ctx.fx.sparks(at, dir, count * 3);
      return;
    }
    this.blood.splatterAlong(at, dir, count, reach, size);
    this.blood.spray(at, dir, count, 8, 0.5, size * 0.26);
  }

  /** `keep` has just been woken and is about to be used, so it is the one chain that may not freeze here. */
  private enforceBudget(keep?: PinTarget): void {
    let live = 0;
    for (const b of this.bodies) if (b.rag?.active && b.sinking < 0) live++;
    for (let i = 0; i < this.bodies.length && live > GoreTuning.maxRagdolls; i++) {
      const b = this.bodies[i]!;
      // Frozen mid-collapse, a body would stand there for good.
      if (b !== keep && b.rag?.active && b.stakes.length === 0 && !b.rag.muscle?.collapse) {
        this.freezeBody(b);
        live--;
      }
    }
    let corpses = 0;
    for (const b of this.bodies) if (b.sinking < 0) corpses++;
    for (let i = 0; i < this.bodies.length && corpses > GoreTuning.maxCorpses; i++) {
      const b = this.bodies[i]!;
      if (b.sinking >= 0) continue;
      this.sinkBody(b);
      corpses--;
    }
    let limbs = 0;
    let liveLimbs = 0;
    for (const l of this.limbs) {
      if (l.sinking >= 0) continue;
      limbs++;
      if (l.rag.active) liveLimbs++;
    }
    for (let i = 0; i < this.limbs.length && (limbs > GoreTuning.maxLimbs || liveLimbs > GoreTuning.maxLiveLimbs); i++) {
      const l = this.limbs[i]!;
      if (l.sinking >= 0) continue;
      if (l.rag.active) {
        if (liveLimbs > GoreTuning.maxLiveLimbs && l !== keep) {
          this.freezeLimb(l);
          liveLimbs--;
        }
      }
      if (limbs > GoreTuning.maxLimbs) {
        this.sinkLimb(l);
        limbs--;
      }
    }
  }

  private freezeBody(b: DeadBody): void {
    b.rag?.freeze();
    if (!b.pooled && !isMachine(b.char)) {
      b.pooled = true;
      this.blood.pool(b.rag ? b.rag.center : _v.setFromMatrixPosition(b.char.bones[0]!.matrixWorld), rand(1.2, 1.9), 4.5);
    }
  }

  private sinkBody(b: DeadBody): void {
    b.rag?.freeze();
    b.sinking = this.ctx.time.elapsed;
    b.sinkFrom = b.char.root.position.y;
  }

  private freezeLimb(l: LooseLimb): void {
    l.rag.freeze();
    this.stopLimbEmitters(l);
    if (!l.machine) this.blood.pool(l.rag.center, rand(0.32, 0.55), 2.5);
  }

  private stopLimbEmitters(l: LooseLimb): void {
    l.emitter?.stop();
    l.endSpray?.stop();
    l.emitter = null;
    l.endSpray = null;
    l.crawler?.kill();
  }

  private sinkLimb(l: LooseLimb): void {
    l.rag.freeze();
    this.stopLimbEmitters(l);
    l.sinking = this.ctx.time.elapsed;
    l.sinkFrom = l.piece.root.position.y;
  }

  private preStep(dt: number): void {
    const { bodies, limbs } = this;
    for (let i = 0; i < bodies.length; i++) {
      const rag = bodies[i]!.rag;
      if (rag?.active) rag.preStep(dt);
    }
    for (let i = 0; i < limbs.length; i++) {
        const limb = limbs[i]!;
      if (!limb.rag.active) continue;
      limb.rag.preStep(dt);
      limb.crawler?.step(dt);
    }
  }

  // -------------------------------------------------------------------------------------------
  // Severing
  // -------------------------------------------------------------------------------------------

  sever(char: CharacterInstance, region: GoreRegion, damage: DamageInfo, velocity?: THREE.Vector3): SeverResult | null {
    const info = rigInfo(char.rig);
    const bone = info.severBone.get(region);
    if (bone === undefined) return null;
    const body = this.owned.get(char);
    if (body) {
      if (body.skip[bone] === 1) return null;
    } else {
      markSevered(info, char.severed, _skip);
      if (_skip[bone] === 1) return null;
    }

    if (body?.rag?.active) {
      body.rag.writeSeeds(_seeds);
    } else if (body?.rag) {
      fillVelocity(info.count, null, _seeds);
    } else {
      measureAnimVelocity(char, char.anim, velocity, _seeds);
    }

    const stump = new THREE.Vector3().setFromMatrixPosition(char.bones[bone]!.matrixWorld);
    const piece = this.takePiece(char, bone);
    markSubtree(info, bone, _mask);
    if (body?.rag) {
      this.wake(body);
      body.rag.cut(_mask);
    }
    const limb = this.addLimb(char, piece, bone, _mask, _seeds);
    char.hideLimb(bone);
    const torso = region === 'abdomen' && !body ? this.startCrawl(limb) : undefined;

    const regions: GoreRegion[] = [];
    for (let i = 0; i < info.count; i++) {
      if (_mask[i] !== 1) continue;
      const r = char.rig.bones[i]!.region;
      if (!regions.includes(r)) regions.push(r);
      if (body) body.skip[i] = 1;
    }

    // The limb takes the shot at the point it was struck, which is what starts it spinning.
    const force = forceOf(damage) * GoreTuning.limbForceShare;
    _v.copy(damage.dir).multiplyScalar(force);
    _v.y += force * 0.35;
    limb.rag.applyImpulse(damage.bone !== undefined && _mask[damage.bone] === 1 ? damage.bone : bone, damage.point, _v);
    const impact = impactStrength(forceOf(damage), info.mass);
    limb.rag.muscle?.kick(damage.dir, Math.max(impact, GoreTuning.limbImpactFloor));
    body?.rag?.muscle?.dropNow();
    body?.rag?.muscle?.kick(damage.dir, impact * MuscleTuning.corpseImpact);

    this.startStump(char, bone, 1);
    this.woundEffects(char, bone, stump, damage);
    this.enforceBudget();
    return torso ? { regions, stump, torso } : { regions, stump };
  }

  /** A severed part from the pool, after making room for it among limbs of the same archetype. */
  private takePiece(char: CharacterInstance, bone: number): SeveredLimb {
    let count = 0;
    let oldest: LooseLimb | null = null;
    for (const l of this.limbs) {
      if (l.archetype !== char.archetype) continue;
      count++;
      oldest ??= l;
    }
    if (oldest && count >= GoreTuning.maxLimbsPerArchetype) this.removeLimb(oldest);
    const piece = char.spawnSevered(bone);
    if (!piece.root.parent) this.ctx.render.scene.add(piece.root);
    return piece;
  }

  private startCrawl(limb: LooseLimb): Crawler {
    const player = this.ctx.player?.position;
    const target = player?.isVector3 === true ? player : null;
    const crawler = new Crawler(limb.rag, target, this.ctx.time.elapsed + rand(GoreTuning.crawlSeconds * 0.7, GoreTuning.crawlSeconds * 1.2));
    limb.crawler = crawler;
    return crawler;
  }

  private addLimb(char: CharacterInstance, piece: SeveredLimb, bone: number, mask: Uint8Array, seeds: Float32Array): LooseLimb {
    const info = rigInfo(char.rig);
    const rag = new Rag(this.ctx.physics, { rig: char.rig, root: piece.root, bones: piece.bones }, {
      chainRoot: bone,
      mask,
      seeds,
      membership: LimbFilter.membership,
      collidesWith: LimbFilter.collidesWith,
      restitution: 0.28,
      friction: 0.62,
      muscles: MuscleTuning.enabled,
    });
    const limb = new LooseLimb(piece, rag, bone, info, this.ctx.time.elapsed, char.archetype);
    limb.machine = isMachine(char);
    limb.emitter = this.ctx.fx.attachEmitter(piece.bones[bone]!, limb.machine ? 'sparkTrail' : 'bloodTrail', undefined, 3) ?? null;
    if (!limb.machine) {
      // The limb's own cut end spits back the way it came, for a moment.
      const a = info.axis;
      _v4.set(-a[bone * 3]!, -a[bone * 3 + 1]!, -a[bone * 3 + 2]!).multiplyScalar(0.02);
      limb.endSpray = this.ctx.fx.attachEmitter(piece.bones[bone]!, 'stumpSpray', _v4, 1.3) ?? null;
    }
    this.limbs.push(limb);
    return limb;
  }

  private woundEffects(char: CharacterInstance, bone: number, at: THREE.Vector3, damage: DamageInfo): void {
    const { fx, audio } = this.ctx;
    const def = char.rig.bones[bone]!;
    if (isMachine(char)) {
      fx.sparks(at, damage.dir, 24);
      audio.play('impact_armor', { position: at, volume: 0.6, pitchJitter: 0.1 });
      return;
    }
    _v.copy(damage.dir);
    fx.bloodHit(at, _v, 1.4);
    this.bleed(char, at, damage.dir, 6, 6, 0.42);
    const parent = char.bones[def.parent];
    if (parent) char.addWound(def.parent, at, (def.hit?.radius ?? 0.06) * 1.8);
    char.setBloodiness(0.14);
    char.hitFlash(1);
    audio.play('enemy_hit', { position: at, volume: 0.6, pitchJitter: 0.08 });
    audio.playOneOf(['bullet_hit1', 'bullet_hit2'], { position: at, volume: 0.35, pitch: 0.7 });
  }

  /** Starts an arterial stump on the parent side of a cut. `power` scales the whole show. */
  private startStump(char: CharacterInstance, bone: number, power: number): void {
    const def = char.rig.bones[bone]!;
    if (def.parent < 0) return;
    const s = this.stumps[this.stumpAt = (this.stumpAt + 1) % this.stumps.length]!;
    s.emitter?.stop();
    const parent = char.bones[def.parent]!;
    s.target = parent;
    s.owner = char.root;
    s.offset.set(def.offset[0], def.offset[1], def.offset[2]);
    s.axis.copy(s.offset).normalize();
    s.started = this.ctx.time.elapsed;
    s.ends = s.started + GoreTuning.stumpSeconds * (0.8 + power * 0.2);
    s.nextBeat = s.started;
    s.beat = 0;
    s.power = power;
    s.machine = isMachine(char);
    s.emitter = this.ctx.fx.attachEmitter(parent, s.machine ? 'sparkTrail' : 'stumpSpray', s.offset, GoreTuning.stumpSeconds) ?? null;
  }

  private updateStumps(): void {
    const now = this.ctx.time.elapsed;
    const { fx } = this.ctx;
    for (let i = 0; i < this.stumps.length; i++) {
      const s = this.stumps[i]!;
      if (!s.target) continue;
      if (now >= s.ends || s.owner?.parent === null) {
        s.target = null;
        s.emitter?.stop();
        s.emitter = null;
        continue;
      }
      if (now < s.nextBeat || s.machine) continue;
      const life = (now - s.started) / (s.ends - s.started);
      const pressure = (1 - life) ** 1.4;
      const strong = s.beat % 2 === 0;
      s.beat++;
      s.nextBeat = now + (strong
        ? GoreTuning.beatEcho
        : GoreTuning.beatPeriod * (1 + life * 0.9) - GoreTuning.beatEcho);
      s.target.updateWorldMatrix(true, false);
      _v.copy(s.offset).applyMatrix4(s.target.matrixWorld);
      s.target.getWorldQuaternion(_q);
      _v2.copy(s.axis).applyQuaternion(_q);
      // The cut end whips about a little. A real jet never holds still.
      _v3.set(rand(-0.22, 0.22), rand(-0.22, 0.22), rand(-0.22, 0.22));
      _v2.add(_v3).normalize();
      // The first beat is the artery letting go at full pressure. After that the emitter carries the rhythm.
      if (s.beat === 1) fx.bloodJet(_v, _v2, 0.5 * s.power);
      if (strong) this.blood.spray(_v, _v2, 3, 7 * (0.5 + pressure), 0.16, 0.1);
    }
  }

  // -------------------------------------------------------------------------------------------
  // Headshots
  // -------------------------------------------------------------------------------------------

  headshot(char: CharacterInstance, damage: DamageInfo, velocity?: THREE.Vector3): void {
    const info = rigInfo(char.rig);
    const neck = info.severBone.get('head');
    if (neck === undefined || this.owned.has(char) || char.severed.has('head')) {
      if (!this.owned.has(char)) this.ragdoll(char, { velocity });
      return;
    }
    const { fx, audio, time } = this.ctx;
    char.root.updateMatrixWorld(true);
    const headBone = info.children[neck]![0] ?? neck;
    const head = _v4.setFromMatrixPosition(char.bones[headBone]!.matrixWorld);
    head.y += (char.rig.bones[headBone]!.hit?.radius ?? 0.1) * 0.8;
    const at = head.clone();

    // Same frame, in this order: chips, sound, stutter. Nothing here waits on anything.
    audio.play('enemy_headshot', { position: at, volume: 0.75 });
    audio.play('enemy_headshot2', { position: at, volume: 0.5625 });
    audio.play('enemy_headshot3', { position: at, volume: 0.75 });
    time.hitStop(GoreTuning.hitStopSeconds, GoreTuning.hitStopScale);

    const burst = damage.amount >= GoreTuning.headBurstDamage;
    if (burst) {
      fx.headBurst(at, damage.dir);
      this.burstSkull(at, damage.dir);
      char.hideLimb(neck);
      this.startStump(char, neck, 1.7);
      fx.bloodMist(at, 0.3);
      this.blood.splatterAlong(at, damage.dir, 9, 8, 0.6);
      this.blood.spray(at, _up, 10, 11, 0.32, 0.12);
    } else {
      this.sever(char, 'head', damage, velocity);
      fx.bloodHit(at, damage.dir, 1.2);
    }

    const body = this.adopt(char);
    // With muscles the stumble is the collapse. Without them the animation has to play it out alone.
    const stumble = MuscleTuning.enabled ? 0 : GoreTuning.headStumbleSeconds;
    body.holdUntil = time.elapsed + (burst ? GoreTuning.headHoldSeconds : stumble);
    body.holdAnim = !burst;
    if (velocity) body.holdVelocity.copy(velocity);
    if (!burst && !MuscleTuning.enabled) char.anim.play('deathStumble');
    audio.play('enemy_die', { position: at, volume: 0.5 });
  }

  private burstSkull(at: THREE.Vector3, dir: THREE.Vector3): void {
    const c = this.chunks;
    const n = 7;
    for (let i = 0; i < n; i++) {
      scatter(dir, 5, 4.5, 8, _v);
      c.spawn('skull', at.x, at.y, at.z, _v.x, _v.y + 2, _v.z, rand(0.03, 0.055));
    }
    for (let i = 0; i < 3; i++) {
      scatter(dir, 3.5, 3.5, 6, _v);
      c.spawn('brain', at.x, at.y, at.z, _v.x, _v.y + 2, _v.z, rand(0.03, 0.05));
    }
    for (let i = 0; i < 3; i++) {
      scatter(dir, 4, 4, 7, _v);
      c.spawn('meat', at.x, at.y, at.z, _v.x, _v.y, _v.z, rand(0.03, 0.05));
    }
  }

  // -------------------------------------------------------------------------------------------
  // Gibs
  // -------------------------------------------------------------------------------------------

  gib(char: CharacterInstance, center: THREE.Vector3, force: number): void {
    const body = this.owned.get(char);
    if (body?.sinking !== undefined && body.sinking >= 0) return;
    const info = rigInfo(char.rig);
    const { fx, audio } = this.ctx;
    const push = force > 0 ? force : DEFAULT_FORCE.explosive;
    const machine = isMachine(char);
    char.root.updateMatrixWorld(true);
    const hips = new THREE.Vector3().setFromMatrixPosition(char.bones[0]!.matrixWorld);
    const chestBone = info.children[0]!.length > 0 ? this.firstBody(info) : 0;
    const chest = new THREE.Vector3().setFromMatrixPosition(char.bones[chestBone]!.matrixWorld);
    const away = _v.copy(chest).sub(center);
    if (away.lengthSq() < 1e-4) randomUnit(away);
    away.normalize();
    away.y = Math.max(away.y, 0.25);
    away.normalize();
    const blastDir = new THREE.Vector3().copy(away);

    // Speed comes from impulse over a body's mass, with a floor so a gib never looks like a stumble.
    const launch = clamp(push / 34, 9, 24);
    const damage: DamageInfo = {
      amount: 999, type: 'explosive', point: chest.clone(), dir: blastDir.clone(), force: 1, source: 'gib',
    };
    if (body?.rag?.active) body.rag.writeSeeds(_seeds);
    else if (body?.rag) fillVelocity(info.count, null, _seeds);
    else measureAnimVelocity(char, char.anim, null, _seeds);
    const seeds = _seeds.slice();

    for (const region of GIB_REGIONS) {
      const lower = GIB_LOWER[region];
      const use = lower && Math.random() < 0.35 ? lower : region;
      const bone = info.severBone.get(use);
      if (bone === undefined) continue;
      markSevered(info, char.severed, _skip);
      if (_skip[bone] === 1 || body?.skip[bone] === 1) continue;
      const piece = this.takePiece(char, bone);
      markSubtree(info, bone, _mask);
      const limb = this.addLimb(char, piece, bone, _mask, seeds);
      char.hideLimb(bone);
      const p = limb.rag.center;
      _v2.copy(p).sub(center);
      if (_v2.lengthSq() < 1e-4) randomUnit(_v2);
      _v2.normalize().multiplyScalar(launch * rand(0.65, 1.15));
      _v2.y += launch * rand(0.25, 0.6);
      for (const part of limb.rag.parts) {
        part.body.setLinvel(_v2, true);
        randomUnit(_v3).multiplyScalar(rand(8, 18));
        part.body.setAngvel(_v3, true);
      }
      limb.rag.muscle?.kick(_v2, 1);
    }

    if (machine) this.scrapBurst(chest, blastDir, launch);
    else this.fleshBurst(chest, hips, blastDir, launch, push);

    if (body) this.dropBody(body);
    char.release();
    this.enforceBudget();
  }

  /** The torso does not survive as a piece: it comes apart into everything it was holding. */
  private fleshBurst(chest: THREE.Vector3, hips: THREE.Vector3, blastDir: THREE.Vector3, launch: number, push: number): void {
    const { fx, audio } = this.ctx;
    for (let i = 0; i < 13; i++) {
      randomUnit(_v2);
      _v3.copy(chest).addScaledVector(_v2, 0.18);
      _v2.addScaledVector(blastDir, 1.1).normalize().multiplyScalar(launch * rand(0.5, 1.1));
      _v2.y += rand(1, 7);
      this.chunks.spawn('meat', _v3.x, _v3.y, _v3.z, _v2.x, _v2.y, _v2.z, rand(0.05, 0.13));
    }
    for (let i = 0; i < 5; i++) {
      randomUnit(_v2);
      _v3.copy(hips).addScaledVector(_v2, 0.12);
      _v3.y += 0.12;
      _v2.addScaledVector(blastDir, 1).normalize().multiplyScalar(launch * rand(0.3, 0.8));
      _v2.y += rand(1, 5);
      this.chunks.spawn('viscera', _v3.x, _v3.y, _v3.z, _v2.x, _v2.y, _v2.z, rand(0.06, 0.1));
    }
    for (let i = 0; i < 5; i++) {
      randomUnit(_v2);
      _v3.copy(chest).addScaledVector(_v2, 0.15);
      _v2.addScaledVector(blastDir, 1.2).normalize().multiplyScalar(launch * rand(0.6, 1.2));
      _v2.y += rand(1, 6);
      this.chunks.spawn('bone', _v3.x, _v3.y, _v3.z, _v2.x, _v2.y, _v2.z, rand(0.03, 0.055));
    }
    fx.gibBurst(chest, blastDir, clamp(push / 40, 6, 20));
    // Three spurts away from the blast, each slightly off the others, as the first game fired them.
    for (let i = 0; i < 3; i++) {
      randomInCone(blastDir, 0.32, _v2);
      fx.bloodJet(chest, _v2, 2);
    }
    this.blood.splatterAround(chest, blastDir, 18, 7, 1.15);
    this.blood.spray(chest, blastDir, 14, 12, 0.7, 0.14);
    this.blood.pool(hips, rand(1.4, 2.1), 1.6);
    audio.play('enemy_explode', { position: chest, volume: 0.6, pitchJitter: 0.06 });
  }

  private scrapBurst(at: THREE.Vector3, blastDir: THREE.Vector3, launch: number): void {
    const { fx, audio } = this.ctx;
    for (let i = 0; i < 12; i++) {
      randomUnit(_v2);
      _v3.copy(at).addScaledVector(_v2, 0.12);
      _v2.addScaledVector(blastDir, 1).normalize().multiplyScalar(launch * rand(0.4, 1));
      _v2.y += rand(1, 6);
      this.chunks.spawn('scrap', _v3.x, _v3.y, _v3.z, _v2.x, _v2.y, _v2.z, rand(0.03, 0.08));
    }
    fx.sparks(at, blastDir, 40);
    audio.play('impact_armor', { position: at, volume: 0.9, pitch: 0.8 });
  }

  /** First body bone below the root: the chest on a humanoid, where a blast does its work. */
  private firstBody(info: RigInfo): number {
    for (let i = 1; i < info.count; i++) if (info.rig.bones[i]!.ragdoll === 'body') return i;
    return 0;
  }

  private dropBody(b: DeadBody): void {
    b.rag?.destroy();
    this.owned.delete(b.char);
    const at = this.bodies.indexOf(b);
    if (at >= 0) this.bodies.splice(at, 1);
  }

  // -------------------------------------------------------------------------------------------
  // Slicing
  // -------------------------------------------------------------------------------------------

  slice(char: CharacterInstance, point: THREE.Vector3, normal: THREE.Vector3, damage: DamageInfo): void {
    const body = this.owned.get(char);
    this.sliced.cut(char, point, normal, damage);
    this.ctx.audio.playOneOf(['sword_hit1', 'sword_hit2'], { position: point, volume: 0.7 });
    this.ctx.audio.play('enemy_hit', { position: point, volume: 0.5 });
    if (body) this.dropBody(body);
    char.release();
  }

  // -------------------------------------------------------------------------------------------
  // Bodies stay shootable
  // -------------------------------------------------------------------------------------------

  damageCorpse(hit: CorpseHit, damage: DamageInfo): void {
    const target = hit.handle;
    const { fx, audio } = this.ctx;
    const machine = (target instanceof DeadBody && isMachine(target.char)) || (target instanceof LooseLimb && target.machine);
    if (machine) {
      fx.sparks(hit.point, damage.dir, 8);
    } else {
      fx.bloodHit(hit.point, damage.dir, 0.8);
      this.blood.spray(hit.point, damage.dir, 3, 7, 0.4, 0.09);
    }
    if (target instanceof DeadBody) {
      const { char } = target;
      if (damage.gib) {
        this.gib(char, hit.point, forceOf(damage));
        return;
      }
      if (target.rag === null) {
        // Shot while still on its feet: that ends the hold at once.
        target.holdUntil = this.ctx.time.elapsed;
        target.holdBroken = true;
      } else if (!target.rag.active) {
        this.wake(target);
        target.pooled = false;
        target.smearLeft = 3;
        target.smearAt.copy(target.rag.center);
      }
      target.rag?.applyImpulse(hit.bone, hit.point, _v.copy(damage.dir).multiplyScalar(forceOf(damage)));
      target.rag?.muscle?.dropNow();
      target.rag?.muscle?.kick(damage.dir, impactStrength(forceOf(damage), target.info.mass) * MuscleTuning.corpseImpact);
      char.addWound(hit.bone, hit.point, 0.05);
      audio.play('enemy_hit', { position: hit.point, volume: 0.4, pitchJitter: 0.1 });
      target.damage[hit.bone] = target.damage[hit.bone]! + damage.amount * (damage.severMult ?? 1);
      // Damage on a bone counts toward the nearest severable joint at or above it.
      const defs = char.rig.bones;
      let b = hit.bone;
      while (b >= 0 && !defs[b]!.severable) b = defs[b]!.parent;
      if (b >= 0 && target.damage[hit.bone]! >= GoreTuning.corpseLimbHealth) {
        target.damage[hit.bone] = 0;
        this.sever(char, defs[b]!.region, damage);
      }
    } else if (target instanceof LooseLimb) {
      if (target.sinking < 0) this.wake(target);
      target.rag.applyImpulse(hit.bone, hit.point, _v.copy(damage.dir).multiplyScalar(forceOf(damage) * 0.4));
      target.rag.muscle?.kick(damage.dir, impactStrength(forceOf(damage), target.info.mass) * MuscleTuning.corpseImpact);
      target.crawler?.kill();
      target.health -= damage.amount * (damage.severMult ?? 1);
      audio.play('enemy_hit', { position: hit.point, volume: 0.3, pitchJitter: 0.12 });
      if (target.health <= 0) this.burstLimb(target, damage);
    } else {
      this.sliced.damage(target, hit.point, _v.copy(damage.dir).multiplyScalar(forceOf(damage)));
    }
  }

  private burstLimb(limb: LooseLimb, damage: DamageInfo): void {
    const c = limb.rag.center;
    this.ctx.fx.bloodMist(c, 0.25);
    this.ctx.fx.bloodHit(c, damage.dir, 1.4);
    for (let i = 0; i < 6; i++) {
      scatter(damage.dir, 5, 4, 6, _v);
      this.chunks.spawn(i < 2 ? 'bone' : 'meat', c.x, c.y, c.z, _v.x, _v.y, _v.z, rand(0.04, 0.08));
    }
    this.blood.stainBelow(c, 0.8);
    this.removeLimb(limb);
  }

  private removeLimb(limb: LooseLimb): void {
    limb.rag.destroy();
    this.stopLimbEmitters(limb);
    limb.piece.release();
    const at = this.limbs.indexOf(limb);
    if (at >= 0) this.limbs.splice(at, 1);
  }

  pin(hit: CorpseHit, anchor: THREE.Vector3): void {
    const target = hit.handle;
    if (!(target instanceof DeadBody) && !(target instanceof LooseLimb)) {
      this.sliced.pin(target, hit.point, anchor);
      return;
    }
    const rag = target.rag;
    if (!rag || target.stakes.length >= MAX_STAKES) return;
    this.wake(target);
    rag.muscle?.dropNow();
    const stake = { bone: hit.bone, anchor: anchor.clone() };
    target.stakes.push(stake);
    this.pins.push({ target, stake, until: this.ctx.time.elapsed + 0.3 });
  }

  /** Whether a frozen chain can wake without another having to freeze for it. */
  private hasRoom(target: PinTarget): boolean {
    let live = 0;
    if (target instanceof DeadBody) {
      for (const b of this.bodies) if (b.rag?.active && b.sinking < 0) live++;
      return live < GoreTuning.maxRagdolls;
    }
    for (const l of this.limbs) if (l.rag.active && l.sinking < 0) live++;
    return live < GoreTuning.maxLiveLimbs;
  }

  /** Thaws a frozen chain, stakes and all. */
  private wake(target: PinTarget): void {
    const rag = target.rag;
    if (!rag || rag.active) return;
    rag.wake();
    for (const stake of target.stakes) this.nail(rag, stake);
    this.enforceBudget(target);
  }

  /** Ties the struck bone to the wall. The point it hangs from is wherever the bone is right now. */
  private nail(rag: Rag, stake: Stake): void {
    const { physics } = this.ctx;
    const part = rag.partFor(stake.bone);
    part.body.translation(part.p);
    part.body.rotation(part.q);
    _v2.copy(stake.anchor).sub(part.p).applyQuaternion(_q.copy(part.q).conjugate());
    const joint = physics.world.createImpulseJoint(
      physics.R.JointData.spherical(_v2, stake.anchor), part.body, physics.anchorBody, true,
    );
    joint.setContactsEnabled(false);
  }

  /** The stake is on its way: drag the struck bone to the anchor, then lock it there. */
  private updatePins(): void {
    const now = this.ctx.time.elapsed;
    for (let i = this.pins.length - 1; i >= 0; i--) {
      const pin = this.pins[i]!;
      const rag = pin.target.rag;
      if (!rag?.active) {
        this.pins.splice(i, 1);
        continue;
      }
      const part = rag.partFor(pin.stake.bone);
      part.body.translation(part.p);
      _v.copy(pin.stake.anchor).sub(part.p);
      const dist = _v.length();
      if (dist < 0.12 || now >= pin.until) {
        this.nail(rag, pin.stake);
        this.pins.splice(i, 1);
        continue;
      }
      _v.multiplyScalar(Math.min(26, dist / 0.05) / dist);
      part.body.setLinvel(_v, true);
    }
  }

  /**
   * Wakes corpses caught in a blast and throws them. Physics.radialImpulse cannot do the throwing here: its
   * shape query only sees colliders from the last step, so anything woken just now is invisible to it. The
   * same goes for an enemy the blast killed a moment ago in this very frame.
   */
  blast(center: THREE.Vector3, radius: number, strength: number): void {
    for (let i = 0; i < this.bodies.length; i++) {
      const b = this.bodies[i]!;
      if (b.sinking < 0 && b.rag) this.throwFromBlast(b, b.rag, center, radius, strength);
    }
    for (let i = 0; i < this.limbs.length; i++) {
      const l = this.limbs[i]!;
      if (l.sinking < 0) this.throwFromBlast(l, l.rag, center, radius, strength);
    }
    this.enforceBudget();
  }

  private throwFromBlast(target: PinTarget, rag: Rag, center: THREE.Vector3, radius: number, strength: number): void {
    const distance = rag.center.distanceTo(center);
    if (distance > radius) return;
    // With no room a wake only swaps places with a chain already moving, and that one comes back at rest.
    if (!rag.active && !this.hasRoom(target)) return;
    // A chain that has already stepped is in the query structures, so Physics finds it, but what it applies from
    // inside that query is lost (see "Known bug" in docs/notes/gore.md). The muscle layer throws its own, along one line.
    if (!rag.active || rag.age <= 0 || rag.muscle) {
      this.wake(target);
      rag.radialImpulse(center, radius, strength);
    }
    rag.muscle?.dropNow();
    const reach = strength * (1 - distance / radius);
    rag.muscle?.kick(_v.copy(rag.center).sub(center), clamp(reach / MuscleTuning.blastFull));
  }

  // -------------------------------------------------------------------------------------------
  // Frame
  // -------------------------------------------------------------------------------------------

  update(): void {
    const { time } = this.ctx;
    const dt = time.dt;
    const now = time.elapsed;
    this.impacts.frame();
    this.updatePins();
    const t = GoreTuning;

    for (let i = this.bodies.length - 1; i >= 0; i--) {
      const b = this.bodies[i]!;
      if (reclaimed(b)) {
        // Never release it: the instance may already be somebody else's enemy.
        b.rag?.destroy();
        this.owned.delete(b.char);
        this.bodies.splice(i, 1);
        continue;
      }
      if (b.sinking >= 0) {
        const k = (now - b.sinking) / t.sinkSeconds;
        if (k >= 1) {
          this.owned.delete(b.char);
          this.bodies.splice(i, 1);
          b.char.release();
          continue;
        }
        b.char.root.position.y = b.sinkFrom - t.sinkDepth * k * k;
        continue;
      }
      if (b.rag === null) {
        if (now >= b.holdUntil) {
          if (b.holdBroken || !MuscleTuning.enabled) this.startRag(b, { velocity: b.holdVelocity });
          else this.beginCollapse(b, GoreTuning.headCollapseSeconds, b.holdVelocity);
        } else if (b.holdAnim) {
          b.char.anim.update(dt, 0);
        }
        continue;
      }
      const rag = b.rag;
      if (!rag.active) continue;
      rag.muscle?.sampleCollapse(dt);
      rag.drive();
      rag.measure(dt, t.calmSpeed, t.calmSpin);
      if (!isMachine(b.char)) this.hear(rag);
      if (rag.speed > 1.2 && b.smearLeft > 0) {
        const moved = _v.copy(rag.center).sub(b.smearAt);
        moved.y = 0;
        if (moved.lengthSq() > BloodTuning.smearSpacing * BloodTuning.smearSpacing) {
          b.smearAt.copy(rag.center);
          b.smearLeft--;
          this.blood.smear(rag.center, moved.x, moved.z, rand(0.5, 0.8));
        }
      }
      if (rag.calm > t.settleTime || rag.age > (b.stakes.length > 0 ? t.maxPinnedSimTime : t.maxSimTime)) this.freezeBody(b);
    }

    for (let i = this.limbs.length - 1; i >= 0; i--) {
      const l = this.limbs[i]!;
      if (l.sinking >= 0) {
        const k = (now - l.sinking) / t.sinkSeconds;
        if (k >= 1) {
          l.piece.release();
          this.limbs.splice(i, 1);
          continue;
        }
        l.piece.root.position.y = l.sinkFrom - 0.6 * k * k;
        continue;
      }
      if (!l.rag.active) continue;
      this.updateLimb(l, dt);
    }

    this.updateStumps();
    this.blood.update(dt);
    this.chunks.update(dt);
    this.sliced.update(dt);
  }

  private updateLimb(l: LooseLimb, dt: number): void {
    const rag = l.rag;
    const t = GoreTuning;
    rag.drive();
    rag.measure(dt, t.calmSpeed, t.calmSpin);
    const speed = rag.speed;
    const now = this.ctx.time.elapsed;

    // A hard stop against anything means it just hit something: leave a splat there.
    if (l.prevSpeed - speed > 2.2) {
      this.blood.stainBelow(rag.center, clamp(0.2 + l.prevSpeed * 0.04, 0.2, 0.55), 'blood', 1.4);
      this.ctx.audio.play('enemy_hit', { position: rag.center, volume: clamp(l.prevSpeed * 0.03, 0.05, 0.3), pitch: 0.6, pitchJitter: 0.1 });
    }
    l.prevSpeed = speed;

    // Dotted trail: droplets dropped by distance, so it stays even at any frame rate or speed.
    l.trail += _v.copy(rag.center).sub(l.lastPos).length();
    l.lastPos.copy(rag.center);
    if (l.trail > 0.45 && rag.age < 3.5) {
      l.trail = 0;
      const p = rag.parts[0]!;
      this.blood.droplet(rag.center.x, rag.center.y, rag.center.z, p.v.x * 0.15, p.v.y * 0.15, p.v.z * 0.15, rand(0.05, 0.11));
    }
    if (speed < 1.5 && now >= l.dripAt && rag.age < 5) {
      l.dripAt = now + rand(0.18, 0.4);
      this.blood.droplet(rag.center.x, rag.center.y, rag.center.z, 0, -0.5, 0, rand(0.03, 0.06));
    }
    const crawler = l.crawler;
    if (crawler?.alive) {
      const player = this.ctx.player?.position;
      if (player?.isVector3 === true) crawler.setTarget(player);
      if (now >= crawler.ends) crawler.kill();
      // The drag marks the floor all the way along.
      l.smear += _v.copy(rag.center).sub(l.smearAt).length();
      l.smearAt.copy(rag.center);
      if (l.smear > BloodTuning.smearSpacing) {
        l.smear = 0;
        this.blood.smear(rag.center, crawler.target.x - rag.center.x, crawler.target.z - rag.center.z, rand(0.45, 0.7));
      }
      return;
    }
    if (!l.machine) this.hear(rag);
    if (rag.calm > t.settleTime || rag.age > (l.stakes.length > 0 ? t.maxPinnedSimTime : t.maxSimTime)) this.freezeLimb(l);
  }

  /** Reports a chain that hit something this frame. A body landing as a whole outranks whichever part touched first. */
  private hear(rag: Rag): void {
    const part = rag.thudPart;
    if (!part || rag.muscle?.standing) return;
    const own = impactKind(rag.source.rig.bones[part.bone]!);
    const whole = rag.thud / rag.mass;
    const loose = rag.build.chainRoot !== 0;
    if (loose) rag.nextThud = this.impacts.land(own, whole, rag.thudSpeed, part.p, rag.nextThud);
    else if (own === 'body' || whole >= ImpactTuning.body.min) rag.nextThud = this.impacts.land('body', whole, rag.thudSpeed, part.p, rag.nextThud);
    else rag.nextPartThud = this.impacts.land(own, rag.thud / part.mass, rag.thudPartSpeed, part.p, rag.nextPartThud);
  }

  // -------------------------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------------------------

  clear(): void {
    for (const b of this.bodies) {
      b.rag?.destroy();
      b.char.release();
    }
    this.bodies = [];
    this.owned.clear();
    for (const l of this.limbs) {
      l.rag.destroy();
      this.stopLimbEmitters(l);
      l.piece.release();
    }
    this.limbs = [];
    this.pins = [];
    for (const s of this.stumps) {
      s.target = null;
      s.emitter?.stop();
      s.emitter = null;
    }
    this.blood.clear();
    this.chunks.clear();
    this.sliced.clear();
  }

  reset(): void {
    this.clear();
  }

  /** Centre of the i-th loose limb, oldest first. */
  limbCenter(i: number, out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.limbs[i]!.rag.center);
  }

  /** Counts for the debug overlay and budget checks. */
  stats(): { ragdolls: number; corpses: number; limbs: number; liveLimbs: number; chunkBodies: number; rays: number; halves: number; jointGap: number; collapses: number } {
    let ragdolls = 0;
    let corpses = 0;
    let jointGap = 0;
    for (const b of this.bodies) {
      if (b.sinking >= 0) continue;
      corpses++;
      if (b.rag?.active) {
        ragdolls++;
        jointGap = Math.max(jointGap, b.rag.jointGap());
      }
    }
    let liveLimbs = 0;
    for (const l of this.limbs) if (l.rag.active) liveLimbs++;
    return {
      ragdolls, corpses, limbs: this.limbs.length, liveLimbs, chunkBodies: this.chunks.bodies,
      rays: this.blood.raysUsed, halves: this.sliced.count, jointGap, collapses: this.collapsing(),
    };
  }
}

export function createGoreSystem(ctx: Ctx): Gore {
  return new Gore(ctx);
}

