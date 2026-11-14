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
import {
  CG, DEFAULT_FORCE, type CapsuleHit, type CharacterInstance, type CorpseHit, type Ctx, type DamageInfo, type EmitterHandle,
  HEAD_VOLLEY, type GoreSystem, type HeadOutcome, type RagdollOptions, type RayHit, type SeveredLimb, type SeverResult,
} from '../core/contracts';
import { DevFlags } from '../core/devflags';
import { clamp, rand, randomInCone, randomUnit } from '../core/math';
import { WEAPONS } from '../weapons/data';
import { BloodField, BloodTuning } from './blood';
import { ChunkField, scatter } from './chunks';
import { ImpactEvents, impactKind, ImpactTuning } from './impacts';
import { CollapseDrive, impactStrength, MASS_PASS, MuscleTuning, STAND_PASS, STRENGTH_PASS, WEIGHT_PASS, type CollapseOptions, type DownedBody, type KnockdownOptions, type LimbStrength } from './muscles';
import { BodyFilter, fillVelocity, LimbFilter, measureAnimVelocity, Rag, SEED_STRIDE } from './rag';
import { boneRay, boneRayContact, nextCapsuleHit, rayBones, rayNearSphere } from './raycast';
import { Reflex, ReflexTuning } from './reflex';
import { Stand, StandTuning, strengthBudget } from './stand';
import { Crawler } from './crawl';
import { HUMAN_MASS, markSevered, markSubtree, MAX_BONES, rigInfo, type RigInfo } from './rigInfo';
import { SliceField } from './sliced';
import { WoundPlanner } from './wounds';

export const GoreTuning = {
  /** Simulated ragdolls. Past this the oldest at rest freezes. */
  maxRagdolls: 14,
  /**
   * What the budget may freeze: a body dead (or awake, thrown or shot again) at least this many seconds and slower than
   * `freezeSpeed` m/s (`Rag.speed`, its fastest part). One still moving it leaves for `overSeconds` more, and then it may
   * freeze with a limb still moving, once the body as a whole is that slow (`Rag.massSpeed`). Freezing the oldest whatever
   * it was doing stopped a body killed this very frame on its feet, or one a grenade had thrown, in mid-air for good; a
   * grenade's throw is still 1.4 m up at 0.6 s. With nothing at rest to freeze, bodies run over the budget until they are,
   * or until their time is up. 0, no limit and 0 with `?mass=0`.
   */
  freezeMinAge: MASS_PASS ? 0.6 : 0,
  freezeSpeed: MASS_PASS ? 1 : Infinity,
  overSeconds: MASS_PASS ? 1 : 0,
  /** Bodies still holding themselves up. Past this a collapse is just a ragdoll. */
  maxCollapses: 4,
  /**
   * Living bodies on physics at once. Past this a knockdown is refused and the caller staggers it instead. Sized for a grenade in
   * a crowd of 12, which can leave 11 to throw: at 6, every survivor after the sixth stood still in the blast that threw his neighbours.
   */
  maxKnockdowns: 12,
  /**
   * Living bodies losing their balance on their muscles at once (`KnockdownOptions.stumble`), counted inside `maxKnockdowns`.
   * Past this a stumble is refused, and the caller staggers the body and knocks it down the old way. Each one is a chain
   * that starts up to half a second before its knockdown would have.
   */
  maxStumbles: 4,
  /**
   * Living bodies catching their balance on their muscles at once (`KnockdownOptions.stumble.budget`), counted inside
   * `maxKnockdowns` and apart from `maxStumbles`. Past this one is refused, and the caller's animated stagger stands.
   */
  maxStanding: 6,
  /** Seconds on the floor and seconds to rise, for a knockdown that does not say. */
  knockdownLie: 1.2,
  knockdownRise: 2.4,
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
  /**
   * Twitching after a lethal headshot, 0..1. A body dropped like a sack lies still: twitching kept one stirring for 3 to 4 s
   * after it landed. A head lost any other way, to a blade, still twitches. 1 with `?weight=0`.
   */
  headshotTwitch: WEIGHT_PASS ? 0 : 1,
  /** Even a clean cut sets a limb tumbling, whatever the strength of the hit. */
  limbImpactFloor: 0.3,
  /** Hit strength of losing a limb, to a body going down. */
  limbLossShock: 0.35,
  /** The first game's accidental frame drop, on purpose. */
  hitStopSeconds: 0.025,
  hitStopScale: 0.03,
  /**
   * Fraction of a hard hit that moves the whole body, not only the bone it struck. All of it on a bone just folds a
   * standing body at the knees, on the spot, however hard the hit was. A light hit keeps all of it on the bone, because
   * rocking a limb is what a bullet is for. The share grows between these two forces.
   */
  bodyShare: 0.85,
  bodyShareFrom: 20,
  bodyShareFull: 90,
  /**
   * Upward push on that share, as a fraction of it. Under doubled gravity a standing body's feet stop it within 0.3 m
   * of anything short of a rocket, so a hard hit has to take the weight off them before it can carry a body back.
   */
  bodyLift: 0.6,
  /** Fraction of DamageInfo.force that a severed limb takes. The rest went into the wound. */
  limbForceShare: 0.45,
  /**
   * A gib flies at its force over this, between these speeds in m/s. Lighter than a body, so it goes further than one. Its
   * limbs take `Rag.throwScale` of it, since they fall on the tempo dial. Chunks keep world gravity and all of it.
   */
  gibForcePerSpeed: 30,
  gibSpeedMin: 6,
  gibSpeedMax: 15,
  /** Metres to a body at which it drops to the next level of detail. These match the living. */
  bodyLodNear: 26,
  bodyLodFar: 60,
  /** Damage a corpse limb takes before it comes off. */
  corpseLimbHealth: 60,
  /** The same for the waist. It is where most rounds land, and at limb strength an SMG cut a body in two with its third. */
  corpseTrunkHealth: 420,
  /** Damage a loose limb takes before it bursts into chunks. */
  limbBurstHealth: 90,
  /** How long a top half keeps dragging itself along. */
  crawlSeconds: 7,
};

const forceOf = (d: DamageInfo): number => (d.force > 0 ? d.force : DEFAULT_FORCE[d.type]);
/**
 * A body's share of a jolt or a blast's spin, from its mass: 1 for anything man-sized, up to 1.3 for a small one, and on a
 * Juggernaut 0.30 of a jolt and 0.20 of a blast's spin.
 */
const massShare = (mass: number, exponent: number): number => Math.min(1.3, (HUMAN_MASS / mass) ** exponent);
/**
 * How hard a hit of this force jolts a body of this mass, 0..1.3. Bullets have to count, so this is not `impactStrength`.
 * A jolt is a spin per joint, which on its own is blind to mass, so the mass comes in here.
 */
const joltOf = (force: number, mass: number): number =>
  clamp((force * DevFlags.force) / MuscleTuning.joltFull) ** MuscleTuning.joltCurve * massShare(mass, MuscleTuning.joltMassExp);

const MAX_STAKES = 3;
/** What a dead body counts as having, for how big a wound one hit makes. */
const CORPSE_HEALTH = 100;
/** Real seconds between the knocks of rounds into the dead, a living hit's shortest gap, so a Buzzsaw sweep is a beat. */
const CORPSE_KNOCK_GAP = 0.07;

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
  readonly stakes: Stake[] = [];
  sinking = -1;
  sinkFrom = 0;
  smearLeft = 7;
  readonly smearAt = new THREE.Vector3();
  pooled = false;
  /** Bones gone from this body. */
  readonly skip = new Uint8Array(MAX_BONES);
  readonly damage = new Float32Array(MAX_BONES);
  /** Set while it is alive and only here for a while. Its character is still somebody else's. */
  down: Knockdown | null = null;
  /**
   * World time it died, woke, stopped holding itself up, or was last thrown or shot: the ragdoll budget leaves it alone for
   * `GoreTuning.freezeMinAge` after, and while it moves for `overSeconds` more.
   */
  freshAt = 0;
  /** A collapse was holding it up when last looked at. The end of one is where its fall starts. */
  holding = false;
  constructor(readonly char: CharacterInstance, readonly info: RigInfo) {}
}

/** What a character on the floor is waiting to do. */
class Knockdown implements DownedBody {
  readonly center = new THREE.Vector3();
  standing = false;
  constructor(readonly rise: number, readonly hurt: number) {}
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
const _v5 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _seeds = new Float32Array(MAX_BONES * SEED_STRIDE);
const _mask = new Uint8Array(MAX_BONES);
const _skip = new Uint8Array(MAX_BONES);
const _up = new THREE.Vector3(0, 1, 0);
const _down = new THREE.Vector3(0, -1, 0);
const _ground: RayHit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0, surface: 'concrete', collider: null };

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
  private readonly wounds: WoundPlanner;
  /** Next body to look at for its level of detail. One a frame is plenty for things that lie still. */
  private lodAt = 0;
  private lastKnock = -1;
  /** Simulated bodies were over `maxRagdolls` with nothing yet fit to freeze, at the last look. */
  private over = false;
  private ready = false;
  /** How each character was last given back (`handedBack`). */
  private readonly back = new WeakMap<CharacterInstance, 'clip' | 'stand' | 'crawl'>();
  private readonly onPreStep = (dt: number): void => this.preStep(dt);
  private readonly onRadial = (center: THREE.Vector3, radius: number, strength: number): void =>
    this.blast(center, radius, strength);

  constructor(private readonly ctx: Ctx) {
    this.blood = new BloodField(ctx);
    this.impacts = new ImpactEvents(ctx);
    this.chunks = new ChunkField(ctx, this.blood, this.impacts);
    this.chunks.ensure();
    this.wounds = new WoundPlanner(ctx, isMachine, (char, bone) => this.owned.get(char)?.rag?.breakJoint(bone));
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
    const body = this.owned.get(char);
    return body !== undefined && body.down === null;
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
      // A body that is only down is still an enemy, and enemies have their own ray test.
      if (b.sinking >= 0 || b.down) continue;
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
      if (existing.down) this.endDown(existing);
      if (existing.rag?.active) {
        // Rapid further hits kill outright, and a repeat death call on a body going down is exactly that.
        existing.rag.muscle?.dropNow();
        if (options?.limp) existing.rag.goLimp();
        if (options?.impulses) {
          for (const i of options.impulses) this.push(existing.rag, i.bone, i.point, i.impulse);
        }
        this.strike(existing.rag, options, MuscleTuning.corpseImpact);
      }
      return;
    }
    const body = this.adopt(char);
    this.startRag(body, options);
  }

  collapse(char: CharacterInstance, options?: CollapseOptions): void {
    const existing = this.owned.get(char);
    if (existing) {
      if (existing.down) this.endDown(existing);
      return;
    }
    const body = this.adopt(char);
    this.beginCollapse(body, options?.duration ?? MuscleTuning.collapseSeconds, options?.velocity, options?.twitch, options?.hit, options?.strength);
  }

  private beginCollapse(body: DeadBody, duration: number, velocity?: THREE.Vector3, twitch?: number, hit?: CollapseOptions['hit'], strength?: LimbStrength): void {
    const { char, info } = body;
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
    const rag = body.rag!;
    if (hit) rag.applyImpulse(hit.bone, hit.point, _v.copy(hit.dir).multiplyScalar(hit.force));
    const muscle = rag.muscle;
    if (!muscle) return;
    if (strength) muscle.strengthen(strength, true);
    if (drive && muscle.canStand()) {
      // Its weaker leg goes first, unless a leg was shot just now.
      if (strength && strength.legL !== strength.legR) drive.shotLeg = strength.legL < strength.legR ? 1 : -1;
      if (hit) {
        drive.away.set(hit.dir.x, 0, hit.dir.z).normalize();
        const region = info.rig.bones[hit.bone]!.region;
        if (region.startsWith('leg') || region.startsWith('shin')) drive.shotLeg = region.endsWith('L') ? 1 : -1;
        char.anim.holdWound?.(hit.bone, hit.point, seconds);
      }
      muscle.startCollapse(drive);
      body.holding = true;
    }
    if (hit) muscle.jolt(hit.bone, hit.point, hit.dir, joltOf(hit.force, info.mass));
  }

  knockdown(char: CharacterInstance, options?: KnockdownOptions): boolean {
    const existing = this.owned.get(char);
    if (existing) {
      if (!existing.down || !existing.rag) return false;
      this.strikeDown(existing, existing.rag, options);
      return true;
    }
    if (!MuscleTuning.enabled || !char.anim.getUp || this.knockedDown() >= GoreTuning.maxKnockdowns) return false;
    this.back.delete(char);
    const t = GoreTuning;
    const stumble = options?.stumble;
    // Losing its balance takes two feet to lose it on, and one of the few places for it. Refused, the caller has the old way.
    // Catching it has places of its own, and takes level ground under both feet.
    const catching = stumble?.budget !== undefined;
    if (stumble && (!STAND_PASS || this.feetOf(char, catching) < 2)) return false;
    if (stumble && (catching ? this.standing() >= t.maxStanding : this.stumbling() >= t.maxStumbles)) return false;
    const hurt = options?.hurt ?? 0.6;
    const ground = char.root.position.y;
    // It reads the pose and the root, so before the ragdoll takes them over. The animator goes on with the stumble it was
    // given, against a root that drifts on at the speed the body had.
    const drive = stumble ? new CollapseDrive(char.anim, char.root, char.bones, clamp(stumble.seconds, 0.2, 3), options.velocity) : null;
    const strength = options?.strength;
    if (drive && catching) drive.stand = new Stand(stumble!.budget! * (strength ? strengthBudget(strength, hurt >= ReflexTuning.painFrom) : 1));
    const body = this.adopt(char);
    body.down = new Knockdown(options?.rise ?? t.knockdownRise, hurt);
    // On its feet nothing throws the limbs: the animation is doing the flailing, and a kick would take its feet off the floor.
    // Its feet are planted, so they start still, and its hips at the speed it was reeling.
    this.startRag(body, { velocity: options?.velocity, impact: drive ? undefined : options?.impact }, drive !== null);
    const rag = body.rag!;
    const muscle = rag.muscle!;
    // Its wounds are already on it, so they are there from the first frame.
    if (strength) muscle.strengthen(strength, true);
    const dir = options?.impact?.dir ?? options?.topple ?? null;
    const plank = !drive && options?.topple !== undefined;
    const reflex = new Reflex(rag, muscle, char.anim, { lie: options?.lie ?? t.knockdownLie, hurt, groundY: ground, dir, plank, knockout: !drive && options?.knockout });
    muscle.startReflex(reflex);
    if (drive) {
      // The Reflex waits (`MuscleState.sampleReflex`) while the same chain stumbles, held up less and less.
      drive.alive = true;
      const wound = options?.wound;
      const struck = wound ? body.info.rig.bones[wound.bone]?.region : undefined;
      if (struck && (struck.startsWith('leg') || struck.startsWith('shin'))) drive.shotLeg = struck.endsWith('L') ? 1 : -1;
      else if (strength && strength.legL !== strength.legR) drive.shotLeg = strength.legL < strength.legR ? 1 : -1;
      muscle.startCollapse(drive);
    }
    this.strikeDown(body, rag, options);
    if (!drive && options?.topple) muscle.tip(options.topple);
    if (reflex.knockout && dir && options?.wound) this.knockOut(rag, options.wound.point, dir);
    if (options?.roll && STRENGTH_PASS) reflex.roll(options.roll);
    body.down.center.copy(rag.center);
    body.down.standing = drive !== null;
    return true;
  }

  /** How many shins a character has left to stand on. With `level`, none if the ground under them is not level (stairs, a ledge). */
  private feetOf(char: CharacterInstance, level = false): number {
    const info = rigInfo(char.rig);
    markSevered(info, char.severed, _skip);
    let n = 0;
    for (let i = 0; i < info.count; i++) {
      const joint = info.rig.bones[i]!.joint;
      if (joint?.role !== 'leg' || joint.kind !== 'hinge' || _skip[i] === 1) continue;
      n++;
      if (level && !this.levelUnder(_v.setFromMatrixPosition(char.bones[info.children[i]![0] ?? i]!.matrixWorld), char.root.position.y)) return 0;
    }
    return n;
  }

  /** True if the ground under `at` is within `StandTuning.uneven` of `y`. */
  private levelUnder(at: THREE.Vector3, y: number): boolean {
    const reach = StandTuning.uneven;
    _v2.set(at.x, y + 0.5, at.z);
    return this.ctx.physics.raycastInto(_v2, _down, 0.5 + reach, CG.World, _ground) && Math.abs(_ground.point.y - y) <= reach;
  }

  /**
   * The round that knocked it cold snaps the head back on this frame, about the neck and away from the round, with nothing in
   * the neck to stop it (`ReflexTuning.koHead`). Torque across the one joint, so it moves the body as a whole no more than a
   * round does. As heavy as every other jolt (`MuscleTuning.joltMassExp`).
   */
  private knockOut(rag: Rag, point: THREE.Vector3, dir: THREE.Vector3): void {
    const head = rag.parts.find(p => p.muscle?.role === 'head');
    if (!head) return;
    head.body.translation(head.p);
    _v.copy(point).sub(head.p).cross(_v2.copy(dir).normalize());
    if (_v.lengthSq() < 1e-8) return;
    rag.muscle!.whip(head.bone, _v.normalize(), ReflexTuning.koWhip * massShare(rag.info.mass, MuscleTuning.joltMassExp));
  }

  /** A hit on a body that is down and alive. It is added to whatever the body was doing. */
  private strikeDown(body: DeadBody, rag: Rag, options: KnockdownOptions | undefined): void {
    const muscle = rag.muscle;
    if (options?.strength && rag.age > 0) muscle?.strengthen(options.strength);
    // Still on its feet in a stumble, with its hips held: as for a body dying on them (`damageCorpse`), most of a round goes
    // into where the feet are heading, or all of it on the bone only bends the body over the hold.
    const stumble = muscle?.collapse?.alive ? muscle.collapse : null;
    if (options?.impulses) {
      for (const i of options.impulses) {
        const force = i.impulse.length();
        if (stumble?.stand && force > 0) {
          // Catching its balance, all of it lands on the body, with no lift: it is standing. The hold gives way to a hit hard
          // enough (`Stand.hit`), its feet go after it, and its budget pays for it.
          const dv = (force * DevFlags.force) / rag.info.mass;
          this.push(rag, i.bone, i.point, i.impulse, 0);
          stumble.stand.hit(dv, options.cost ?? 0);
          stumble.carry(_v.copy(i.impulse).divideScalar(force), dv);
        } else if (stumble && force > 0) {
          this.push(rag, i.bone, i.point, _v.copy(i.impulse).multiplyScalar(1 - MuscleTuning.carryShare));
          stumble.carry(_v.copy(i.impulse).divideScalar(force), (force * DevFlags.force) / rag.info.mass);
        } else this.push(rag, i.bone, i.point, i.impulse);
        if (force > 0) muscle?.jolt(i.bone, i.point, _v.copy(i.impulse).divideScalar(force), joltOf(force, rag.info.mass));
        // How hard it was hit, for how long it stays down, not how far it moves: that is left as it was for every size.
        muscle?.reflex?.struck(joltOf(force, HUMAN_MASS));
      }
    }
    if (rag.age > 0) this.strike(rag, options, MuscleTuning.corpseImpact);
    const wound = options?.wound;
    if (wound && body.skip[wound.bone] !== 1) muscle?.reflex?.wound(wound.bone, wound.point);
  }

  setStrength(char: CharacterInstance, strength: LimbStrength): void {
    const b = this.owned.get(char);
    if (b?.down) b.rag?.muscle?.strengthen(strength);
  }

  downed(char: CharacterInstance): DownedBody | null {
    return this.owned.get(char)?.down ?? null;
  }

  handedBack(char: CharacterInstance): 'clip' | 'stand' | 'crawl' | null {
    return this.back.get(char) ?? null;
  }

  private knockedDown(): number {
    let n = 0;
    for (const b of this.bodies) if (b.down) n++;
    return n;
  }

  /** It died down there. The fall goes on from where it had got to, and this is a corpse from now on. */
  private endDown(b: DeadBody): void {
    b.down = null;
    b.freshAt = this.ctx.time.elapsed;
    const rag = b.rag;
    if (!rag) return;
    // Still stumbling, the death carries on from where the body is: the hold goes, and what the muscles had fades.
    rag.muscle?.loseFooting('dead');
    rag.muscle?.reflex?.die();
    // Time it spent alive does not count against time to settle.
    rag.age = Math.min(rag.age, 1);
  }

  /** Limbs are gathered. The animation takes over from exactly this pose, and the ragdoll goes. */
  private handBack(b: DeadBody): void {
    const { char } = b;
    const rag = b.rag!;
    const reflex = rag.muscle!.reflex!;
    const chest = rag.parts[Math.min(1, rag.parts.length - 1)]!;
    const hips = rag.parts[0]!;
    // Lying on its back the feet lie toward +Z, on its front the head does. See getUp.ts.
    _v.copy(chest.p).sub(hips.p).setY(0);
    if (_v.lengthSq() < 1e-3) _v.set(0, 1, 0).applyQuaternion(hips.q).setY(0);
    const away = reflex.kind === 'supine' ? -1 : 1;
    let yaw = Math.atan2(_v.x * away, _v.z * away);
    if (reflex.startU > 0) {
      // Pushed part of the way up, a body sat up has its chest over its hips. The turn that puts that frame's hips where the
      // real ones are says it instead: the part of `hips × frame⁻¹` about the vertical.
      _q2.copy(reflex.startHipsTurn).invert().premultiply(hips.q);
      yaw = 2 * Math.atan2(_q2.y, _q2.w);
    }
    _v2.copy(hips.p);
    _q.copy(hips.q);
    rag.destroy();
    this.release(b);

    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const start = reflex.startHips;
    const root = char.root;
    root.position.set(_v2.x - (start.x * c + start.z * s), reflex.groundY, _v2.z - (-start.x * s + start.z * c));
    root.rotation.set(0, yaw, 0);
    _v3.copy(_v2).sub(root.position).applyAxisAngle(_up, -yaw);
    char.bones[0]!.position.copy(_v3);
    char.bones[0]!.quaternion.copy(_q).premultiply(_q2.setFromAxisAngle(_up, -yaw));
    root.updateMatrixWorld(true);
    char.anim.getUp?.(reflex.kind, b.down!.rise, b.down!.hurt, reflex.startU);
    this.back.set(char, reflex.kind === 'crawl' ? 'crawl' : 'clip');
  }

  /**
   * It caught its balance (`Stand.caught`). The animation has been running under it all along, against the ghost root, so it
   * takes over mid-stride: the root goes where the ghost is, the bones stay as physics left them, and the animator blends
   * out of that pose. Nothing gets up, because nothing went down.
   */
  private handStanding(b: DeadBody, drive: CollapseDrive): void {
    const { char } = b;
    const hips = b.rag!.parts[0]!;
    _v2.copy(hips.p);
    _q.copy(hips.q);
    b.rag!.destroy();
    this.release(b);
    const root = char.root;
    const yaw = 2 * Math.atan2(drive.facing.y, drive.facing.w);
    root.position.copy(drive.ghost);
    root.rotation.set(0, yaw, 0);
    char.bones[0]!.position.copy(_v2).sub(root.position).applyAxisAngle(_up, -yaw);
    char.bones[0]!.quaternion.copy(_q).premultiply(_q2.setFromAxisAngle(_up, -yaw));
    root.updateMatrixWorld(true);
    char.anim.blendFrom?.(StandTuning.standBlend);
    this.back.set(char, 'stand');
  }

  /** Out of this system, with the instance left as it is. */
  private release(b: DeadBody): void {
    this.owned.delete(b.char);
    const at = this.bodies.indexOf(b);
    if (at >= 0) this.bodies.splice(at, 1);
  }

  /** Bodies dying on their feet. A living body's stumble runs on the same drive and is not one of them. */
  private collapsing(): number {
    let n = 0;
    for (const b of this.bodies) {
      const drive = b.rag?.muscle?.collapse;
      if (drive && !drive.alive) n++;
    }
    return n;
  }

  /** Living bodies losing their balance, still on their feet, that can only fall. */
  private stumbling(): number {
    let n = 0;
    for (const b of this.bodies) {
      const drive = b.rag?.muscle?.collapse;
      if (drive?.alive && !drive.stand) n++;
    }
    return n;
  }

  /** Living bodies catching their balance. */
  private standing(): number {
    let n = 0;
    for (const b of this.bodies) if (b.rag?.muscle?.collapse?.stand) n++;
    return n;
  }

  /** A hit on a body: some of it at the bone it struck, which is what turns it, and the rest on the whole body. */
  private push(rag: Rag, bone: number, point: THREE.Vector3, impulse: THREE.Vector3, lift = GoreTuning.bodyLift): void {
    const t = GoreTuning;
    const share = t.bodyShare * clamp((impulse.length() - t.bodyShareFrom) / (t.bodyShareFull - t.bodyShareFrom));
    rag.applyImpulse(bone, point, _v5.copy(impulse).multiplyScalar(1 - share));
    if (share <= 0) return;
    _v5.copy(impulse).multiplyScalar(share);
    _v5.y += _v5.length() * lift;
    rag.shove(_v5);
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
    body.freshAt = this.ctx.time.elapsed;
    markSevered(body.info, char.severed, body.skip);
    this.owned.set(char, body);
    this.bodies.push(body);
    return body;
  }

  /** `walk`: on its feet, so the speed it has is the root's and not every bone's (`measureAnimVelocity`). */
  private startRag(body: DeadBody, options?: RagdollOptions, walk = false): void {
    const { char, info } = body;
    measureAnimVelocity(char, char.anim, options?.velocity, _seeds, walk);
    for (let i = 0; i < info.count; i++) _mask[i] = body.skip[i] === 1 ? 0 : 1;
    body.rag = new Rag(this.ctx.physics, char, {
      chainRoot: 0,
      mask: _mask,
      seeds: _seeds,
      membership: BodyFilter.membership,
      collidesWith: BodyFilter.collidesWith,
      restitution: 0.02,
      // The same at every tempo: grip comes down with the weight, so a throw slowed to the dial slides as far. Raised to hold
      // grip (1.2 at 0.6) it did nothing for a collapse's feet, kept Judge kills on their heels longer and stopped a thrown
      // body short (gore.md, Forces).
      friction: 0.72,
      muscles: options?.muscles ?? MuscleTuning.enabled,
    });
    if (options?.limp) body.rag.goLimp();
    body.smearAt.copy(body.rag.center);
    if (options?.impulses) {
      for (const i of options.impulses) {
        this.push(body.rag, i.bone, i.point, i.impulse);
        // The wall behind the shot takes what came through.
        const force = i.impulse.length();
        if (force < 1 || !Number.isFinite(force)) continue;
        _v.copy(i.impulse).divideScalar(force);
        this.bleed(char, i.point, _v, 5, 6, 0.42);
      }
    }
    this.strike(body.rag, options, 1);
    const twitch = options?.twitch ?? (char.severed.has('head') ? (options?.limp ? GoreTuning.headshotTwitch : 1) : 0);
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
    this.budgetRagdolls(keep);
    let corpses = 0;
    for (const b of this.bodies) if (b.sinking < 0) corpses++;
    for (let i = 0; i < this.bodies.length && corpses > GoreTuning.maxCorpses; i++) {
      const b = this.bodies[i]!;
      if (b.sinking >= 0 || b.down) continue;
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

  /**
   * Holds simulated bodies to `maxRagdolls`, oldest first. It freezes a body at rest: one dead, awake, thrown or shot
   * `freezeMinAge` ago and slower than `freezeSpeed`. Then one that is down but has kept a limb moving for `overSeconds`
   * past that. Nothing younger freezes here, nor anything in the air, so a burst that kills more than the budget, or throws
   * what it has, runs over it for a moment. There is no ceiling on that: one that froze what was down whatever its limbs
   * did, past 22 chains, cut a grenade into 30 by a tenth and froze arms mid-swing. Those times are the body's own: on the
   * tempo dial it falls slower, and has longer. `update` looks again every frame until it is back inside.
   */
  private budgetRagdolls(keep?: PinTarget): void {
    const t = GoreTuning;
    let live = 0;
    for (const b of this.bodies) if (b.rag?.active && b.sinking < 0) live++;
    this.over = false;
    if (live <= t.maxRagdolls) return;
    const now = this.ctx.time.elapsed;
    const bodies = this.bodies;
    // At rest. A chain pushed since it was last measured is on its way somewhere, whatever it read then.
    for (let i = 0; i < bodies.length && live > t.maxRagdolls; i++) {
      const b = bodies[i]!;
      if (!this.freezable(b, keep) || this.fallen(b, now) < t.freezeMinAge) continue;
      if ((b.rag!.pushed ? Infinity : b.rag!.speed) > t.freezeSpeed) continue;
      this.freezeBody(b);
      live--;
    }
    // Out of time: down, though a limb may still be moving. Not one still going somewhere as a whole, which is a body in
    // the air, falling off a ledge, or sliding.
    for (let i = 0; i < bodies.length && live > t.maxRagdolls; i++) {
      const b = bodies[i]!;
      if (!this.freezable(b, keep) || this.fallen(b, now) < t.freezeMinAge + t.overSeconds) continue;
      if ((b.rag!.pushed ? Infinity : b.rag!.massSpeed) > t.freezeSpeed) continue;
      this.freezeBody(b);
      live--;
    }
    this.over = live > t.maxRagdolls;
  }

  /** Frozen mid-collapse, a body would stand there for good. Frozen alive, it would never get up. A staked one hangs. */
  private freezable(b: DeadBody, keep?: PinTarget): boolean {
    return b !== keep && b.rag !== null && b.rag.active && b.stakes.length === 0 && !b.rag.muscle?.collapse && !b.down;
  }

  /**
   * Seconds this body has been falling, in its own time: since it died, woke, was thrown or shot, or a collapse let go of
   * it, which is a body that has just started to fall, however long it took to die. Slowed by the tempo dial's pace.
   */
  private fallen(b: DeadBody, now: number): number {
    if (b.holding && !b.rag?.muscle?.collapse) {
      b.holding = false;
      b.freshAt = now;
    }
    return (now - b.freshAt) * (b.rag?.throwScale ?? 1);
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
      // A limb gone mid-stumble, the body is off its feet: its animator is about to change how it stands.
      body.rag.muscle?.loseFooting('limb');
      body.rag.cut(_mask);
    }
    // Cut from a chain in flight, the limb falls as that chain does: its seed is that chain's speed, already on the dial.
    const limb = this.addLimb(char, piece, bone, _mask, _seeds, body?.rag?.active ? body.rag.killedInAir : undefined);
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
    // A body that is losing limbs to gunfire is being shot, and that is no reason to stop showing it. Losing its head is:
    // one still on its feet drops on this frame.
    if (WEIGHT_PASS && region === 'head' && body?.rag?.muscle?.collapse) body.rag.goLimp();
    else body?.rag?.muscle?.struck(Math.max(impact, GoreTuning.limbLossShock));
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

  private addLimb(char: CharacterInstance, piece: SeveredLimb, bone: number, mask: Uint8Array, seeds: Float32Array, lofted?: boolean): LooseLimb {
    const info = rigInfo(char.rig);
    const rag = new Rag(this.ctx.physics, { rig: char.rig, root: piece.root, bones: piece.bones, isFractured: b => piece.isFractured(b) }, {
      chainRoot: bone,
      mask,
      seeds,
      lofted,
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

  wound(char: CharacterInstance, damage: DamageInfo, severity: number): boolean {
    this.wounds.onBody(char, damage, severity);
    return this.wounds.broke;
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

  headshot(char: CharacterInstance, damage: DamageInfo, velocity?: THREE.Vector3, outcome?: HeadOutcome): void {
    const info = rigInfo(char.rig);
    const neck = info.severBone.get('head');
    const what = outcome ?? (damage.amount >= GoreTuning.headBurstDamage ? 'burst' : 'off');
    // Step 2 of docs/proposals/partial-head-wounds.md gives a few bodies a partial wound; until then it bursts.
    const burst = what === 'burst' || what === 'partial';
    const down = this.owned.get(char);
    // A body standing in a collapse keeps its head to a blast, as it always has; told what to do, it does it.
    if (down && neck !== undefined && !char.severed.has('head') && (down.down || outcome !== undefined)) {
      // Down, rising or dead already: nothing comes off whole, and a burst comes apart where the head lies.
      if (down.down) {
        this.endDown(down);
        down.rag?.goLimp();
      }
      if (burst) this.burstHead(char, neck, damage);
      else if (what === 'off') this.sever(char, 'head', damage);
      return;
    }
    if (neck === undefined || down || char.severed.has('head')) {
      if (!down || down.down) this.ragdoll(char, { velocity, limp: true });
      return;
    }
    const { fx, audio, time } = this.ctx;
    const at = this.headAt(char, neck);

    // Same frame, in this order: chips, sound, stutter. Nothing here waits on anything.
    audio.play('enemy_headshot', { position: at, volume: 0.75 });
    audio.play('enemy_headshot2', { position: at, volume: 0.5625 });
    audio.play('enemy_headshot3', { position: at, volume: 0.75 });
    time.hitStop(GoreTuning.hitStopSeconds, GoreTuning.hitStopScale);

    if (burst) {
      this.burstHead(char, neck, damage);
    } else if (what === 'off') {
      this.sever(char, 'head', damage, velocity);
      fx.bloodHit(at, damage.dir, 1.2);
    } else {
      fx.bloodHit(damage.point, damage.dir, 1.2);
    }

    // Nothing is left to sell it with. The body goes on this frame, with whatever momentum it had.
    this.startRag(this.adopt(char), { velocity, limp: true });
    audio.play('enemy_die', { position: at, volume: 0.5 });
  }

  private readonly headVolley = new Map<CharacterInstance, number>();
  private headVolleyAt = -1;

  headPellets(char: CharacterInstance, damage: DamageInfo): number {
    if (damage.type !== 'pellet') return 0;
    const now = this.ctx.time.elapsed;
    if (this.headVolleyAt !== now) {
      this.headVolleyAt = now;
      this.headVolley.clear();
    }
    const n = (this.headVolley.get(char) ?? 0) + 1;
    this.headVolley.set(char, n);
    return n;
  }

  /** The middle of the head, a little above the head bone. */
  private headAt(char: CharacterInstance, neck: number): THREE.Vector3 {
    const info = rigInfo(char.rig);
    char.root.updateMatrixWorld(true);
    const headBone = info.children[neck]![0] ?? neck;
    const head = _v4.setFromMatrixPosition(char.bones[headBone]!.matrixWorld);
    head.y += (char.rig.bones[headBone]!.hit?.radius ?? 0.1) * 0.8;
    return head.clone();
  }

  /**
   * The Fallout burst: the head comes apart into the pieces it is made of, sized to it, and the neck is left a stump.
   * Works on a body gore already has, which loses the head's part of its ragdoll as a cut limb would.
   */
  private burstHead(char: CharacterInstance, neck: number, damage: DamageInfo): void {
    const { fx } = this.ctx;
    const info = rigInfo(char.rig);
    const headBone = info.children[neck]![0] ?? neck;
    const at = this.headAt(char, neck);
    const r = char.rig.bones[headBone]!.hit?.radius ?? 0.1;
    const body = this.owned.get(char);
    if (body?.rag) {
      markSubtree(info, neck, _mask);
      this.wake(body);
      body.rag.cut(_mask);
      for (let i = 0; i < info.count; i++) if (_mask[i] === 1) body.skip[i] = 1;
    }
    fx.headBurst(at, damage.dir);
    // A prone head faces wherever the body lies; standing, the body's facing is close enough for nine pieces in flight.
    char.root.getWorldQuaternion(_q);
    // The hit radius sits inside the skin, and a helmet bigger still: the pieces are a little over it.
    this.chunks.burstHead(at, _q, r * 1.15, damage.dir);
    for (let i = 0; i < 3; i++) {
      scatter(damage.dir, 4, 4, 7, _v);
      this.chunks.spawn('meat', at.x, at.y, at.z, _v.x, _v.y, _v.z, rand(0.03, 0.05));
    }
    char.hideLimb(neck);
    this.startStump(char, neck, 1.7);
    fx.bloodMist(at, 0.3);
    this.blood.splatterAlong(at, damage.dir, 9, 8, 0.6);
    this.blood.spray(at, _up, 10, 11, 0.32, 0.12);
  }

  // -------------------------------------------------------------------------------------------
  // Gibs
  // -------------------------------------------------------------------------------------------

  gib(char: CharacterInstance, center: THREE.Vector3, force: number): void {
    if (!DevFlags.gibbing) {
      this.ragdoll(char);
      return;
    }
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
    const t = GoreTuning;
    const launch = clamp(push / t.gibForcePerSpeed, t.gibSpeedMin, t.gibSpeedMax) * DevFlags.force;
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
      // Thrown by the gib, not killed in the air, whatever its seed: it takes the dial, and `fling` holds the throw.
      const limb = this.addLimb(char, piece, bone, _mask, seeds, false);
      char.hideLimb(bone);
      const p = limb.rag.center;
      // A limb falls on the tempo dial and lands as far as it would at full gravity. Chunks keep world gravity and `launch`.
      const fling = launch * limb.rag.throwScale;
      _v2.copy(p).sub(center);
      if (_v2.lengthSq() < 1e-4) randomUnit(_v2);
      _v2.normalize().multiplyScalar(fling * rand(0.65, 1.15));
      _v2.y += fling * rand(0.25, 0.6);
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
    this.ctx.audio.play('sword_flesh', { position: point, pitchJitter: 0.04 });
    this.ctx.audio.play('blood_spill', { position: point, volume: 0.8 });
    if (body) this.dropBody(body);
    char.release();
  }

  // -------------------------------------------------------------------------------------------
  // Bodies stay shootable
  // -------------------------------------------------------------------------------------------

  damageCorpse(hit: CorpseHit, damage: DamageInfo): void {
    const target = hit.handle;
    const { fx } = this.ctx;
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
      if (target.rag && !target.rag.active) {
        this.wake(target);
        target.pooled = false;
        target.smearLeft = 3;
        target.smearAt.copy(target.rag.center);
      }
      // A round is motion the budget cannot see once the frame has been measured: dated from its waking alone, a corpse
      // under fire froze and woke every 0.6 s, leaving a pool each time.
      target.freshAt = this.ctx.time.elapsed;
      const muscle = target.rag?.muscle;
      let drive = muscle?.collapse ?? null;
      // A round in the head of a body still on its feet drops it on this frame, and all of the round lands on the head:
      // nothing is left to carry it or flinch at it. Not with `?weight=0`, where it staggers on.
      if (WEIGHT_PASS && drive && hit.region === 'head') {
        target.rag!.goLimp();
        drive = null;
      }
      // On its feet the hips are held, so all of a round on the chest only bends it backward over them. Most of it goes
      // into where the feet are heading instead, and under sustained fire the body is walked back by it.
      const onBone = drive ? 1 - MuscleTuning.carryShare : 1;
      if (target.rag) this.push(target.rag, hit.bone, hit.point, _v.copy(damage.dir).multiplyScalar(forceOf(damage) * onBone));
      if (drive) drive.carry(damage.dir, (forceOf(damage) * DevFlags.force) / target.info.mass);
      const jolt = joltOf(forceOf(damage), target.info.mass);
      muscle?.struck(impactStrength(forceOf(damage), target.info.mass));
      muscle?.kick(damage.dir, impactStrength(forceOf(damage), target.info.mass) * MuscleTuning.corpseImpact);
      muscle?.jolt(hit.bone, hit.point, damage.dir, jolt);
      // Still on its feet, the animation it is following flinches too, and the muscles carry that as well. The animator
      // sizes a flinch by build itself (`HumanoidAnimator.flinch`), so this one is not scaled by mass again.
      muscle?.collapse?.flinch(hit.bone, damage.dir, MuscleTuning.collapseFlinch * joltOf(forceOf(damage), HUMAN_MASS));
      this.wounds.onBody(char, damage, damage.amount / CORPSE_HEALTH, hit.bone, hit.point);
      this.corpseSound(hit.point, damage, machine, false);
      target.damage[hit.bone] = target.damage[hit.bone]! + damage.amount * (damage.severMult ?? 1);
      // Damage on a bone counts toward the nearest severable joint at or above it.
      const defs = char.rig.bones;
      let b = hit.bone;
      while (b >= 0 && !defs[b]!.severable) b = defs[b]!.parent;
      const lasts = b >= 0 && defs[b]!.region === 'abdomen' ? GoreTuning.corpseTrunkHealth : GoreTuning.corpseLimbHealth;
      const head = b >= 0 && defs[b]!.region === 'head';
      // A shotgun's blast is one hit on a head: four of its pellets there, counting any that killed him, burst it. A head
      // worn through by pellets bursts too; anything else that wears it through shoots it off.
      const volley = head ? this.headPellets(char, damage) : 0;
      if (head && (volley >= HEAD_VOLLEY || (volley > 0 && target.damage[hit.bone]! >= lasts))) {
        target.damage[hit.bone] = 0;
        this.headshot(char, damage, undefined, 'burst');
      } else if (b >= 0 && target.damage[hit.bone]! >= lasts) {
        target.damage[hit.bone] = 0;
        this.sever(char, defs[b]!.region, damage);
      }
    } else if (target instanceof LooseLimb) {
      if (target.sinking < 0) this.wake(target);
      target.rag.applyImpulse(hit.bone, hit.point, _v.copy(damage.dir).multiplyScalar(forceOf(damage) * 0.4));
      target.rag.muscle?.kick(damage.dir, impactStrength(forceOf(damage), target.info.mass) * MuscleTuning.corpseImpact);
      target.crawler?.kill();
      this.wounds.onLimb(target.piece, target.info, damage, hit.bone, hit.point);
      target.health -= damage.amount * (damage.severMult ?? 1);
      this.corpseSound(hit.point, damage, machine, true);
      if (target.health <= 0 && DevFlags.gibbing) this.burstLimb(target, damage);
    } else {
      this.sliced.damage(target, hit.point, _v.copy(damage.dir).multiplyScalar(forceOf(damage)));
    }
  }

  /**
   * A round into the dead: a living body's hit, lower and without the 2D confirmation, because a corpse is something hit,
   * not a hit that counted. Its ids are its own, so it never takes a living hit's start on the frame or its voices. Flesh
   * keeps its wet on every round, as before hits had layers. The knock under it, a punch or a wreck's clank, is spaced
   * like a living hit, and the punch is the player's guns' alone, as it is on the living.
   */
  private corpseSound(at: THREE.Vector3, damage: DamageInfo, machine: boolean, limb: boolean): void {
    const { audio, time } = this.ctx;
    if (!machine) audio.play('corpse_body', { position: at, volume: limb ? 0.3 : 0.4, pitchJitter: limb ? 0.12 : 0.1 });
    const now = time.realElapsed;
    if (now - this.lastKnock < CORPSE_KNOCK_GAP || (!machine && !Object.hasOwn(WEAPONS, damage.source))) return;
    this.lastKnock = now;
    // A wreck is metal in the world: the plate under the world's voices, cut where a living machine's is.
    if (machine) audio.play('metal_clang', { position: at, volume: limb ? 0.36 : 0.45, pitch: limb ? 1.2 : 1, pitchJitter: 0.1, duration: 0.22 });
    // Less mass in a limb than a body, so higher and shorter.
    else audio.play('corpse_punch', { position: at, volume: limb ? 0.4 : 0.5, pitch: limb ? 1.5 : 1.3, pitchJitter: 0.08 });
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
    if (target instanceof DeadBody) target.freshAt = this.ctx.time.elapsed;
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
      rag.pushed = true;
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
      // A limb cut off by this same blast already left with its own speed. Thrown again it crossed the map.
      if (l.sinking < 0 && l.rag.age > 0) this.throwFromBlast(l, l.rag, center, radius, strength);
    }
    this.enforceBudget();
  }

  private throwFromBlast(target: PinTarget, rag: Rag, center: THREE.Vector3, radius: number, strength: number): void {
    const distance = rag.center.distanceTo(center);
    if (distance > radius) return;
    // Physics.radialImpulse throws a chain with no muscles itself, after this.
    rag.pushed = true;
    // With no room a wake only swaps places with a chain already moving, and that one comes back at rest.
    if (!rag.active && !this.hasRoom(target)) return;
    // A chain that has already stepped is in the query structures, so Physics finds it, but what it applies from
    // inside that query is lost (see `docs/notes/gore.md`). The muscle layer throws its own, along one line.
    if (!rag.active || rag.age <= 0 || rag.muscle) {
      this.wake(target);
      rag.radialImpulse(center, radius, strength);
    }
    // Thrown again, it starts its fall again: on the time from its death the ragdoll budget froze a body a second grenade
    // had thrown 2 m up.
    if (target instanceof DeadBody) target.freshAt = this.ctx.time.elapsed;
    // A living body it catches stumbling leaves its feet with the blast.
    rag.muscle?.loseFooting('thrown');
    rag.muscle?.dropNow();
    rag.muscle?.reflex?.thrown();
    const reach = strength * (1 - distance / radius);
    // The throw is shared out by mass already, but the limbs' spin was not: a Juggernaut's hands went five times as fast as
    // its hips. A loose limb has no trunk to go with, and its `info` is the whole body's, so it spins as it did.
    const spin = target instanceof DeadBody ? massShare(rag.info.mass, MuscleTuning.blastMassExp) : 1;
    rag.muscle?.kick(_v.copy(rag.center).sub(center), clamp(reach / MuscleTuning.blastFull) * spin);
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
      const rag = b.rag;
      if (!rag?.active) continue;
      // Catching its balance, the ground has to go on being there, where its animation is walking it.
      const walked = rag.muscle?.collapse;
      if (walked?.stand && !this.levelUnder(walked.ghost, rag.muscle!.reflex?.groundY ?? walked.ghost.y)) rag.muscle!.loseFooting('sunk');
      rag.muscle?.sampleCollapse(dt);
      if (b.holding) this.fallen(b, now);
      rag.drive();
      rag.measure(dt, t.calmSpeed, t.calmSpin);
      rag.muscle?.sampleReflex(dt);
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
      if (b.down) {
        b.down.center.copy(rag.center);
        b.down.standing = rag.muscle?.collapse?.alive === true;
        const drive = rag.muscle?.collapse;
        if (drive?.stand?.caught) this.handStanding(b, drive);
        else if (rag.muscle?.reflex?.ready) this.handBack(b);
        continue;
      }
      if (rag.calm > t.settleTime || rag.age > (b.stakes.length > 0 ? t.maxPinnedSimTime : t.maxSimTime)) this.freezeBody(b);
    }
    // Over the ragdoll budget, what was too fresh or too fast to freeze is looked at again now it has been measured. With
    // `?mass=0` the budget was only ever kept when something died or woke, as before.
    if (MASS_PASS && this.over) this.budgetRagdolls();

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

    this.updateBodyLod();
    this.updateStumps();
    this.blood.update(dt);
    this.chunks.update(dt);
    this.sliced.update(dt);
  }

  /** Nobody else sets a body's detail once it is dead, and one that died at a distance can be walked up to. */
  private updateBodyLod(): void {
    const n = this.bodies.length;
    if (n === 0) return;
    this.lodAt = (this.lodAt + 1) % n;
    const { char } = this.bodies[this.lodAt]!;
    const d = char.bones[0]!.getWorldPosition(_v).distanceTo(this.ctx.player.position);
    char.setLod?.(d < GoreTuning.bodyLodNear ? 0 : d < GoreTuning.bodyLodFar ? 1 : 2);
  }

  private updateLimb(l: LooseLimb, dt: number): void {
    const rag = l.rag;
    const t = GoreTuning;
    rag.drive();
    rag.measure(dt, t.calmSpeed, t.calmSpin);
    // As fast as it would be going at full gravity, so a landing under the tempo dial splats and sounds as it did.
    const speed = rag.speed / rag.throwScale;
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
    // Heard as it would land at full gravity: under the tempo dial the same fall lands slower, by `throwScale`.
    const k = rag.throwScale;
    const whole = rag.thud / rag.mass / k;
    const loose = rag.build.chainRoot !== 0;
    if (loose) rag.nextThud = this.impacts.land(own, whole, rag.thudSpeed / k, part.p, rag.nextThud);
    else if (own === 'body' || whole >= ImpactTuning.body.min) rag.nextThud = this.impacts.land('body', whole, rag.thudSpeed / k, part.p, rag.nextThud);
    else rag.nextPartThud = this.impacts.land(own, rag.thud / part.mass / k, rag.thudPartSpeed / k, part.p, rag.nextPartThud);
  }

  // -------------------------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------------------------

  clear(): void {
    for (const b of this.bodies) {
      const ground = b.rag?.muscle?.reflex?.groundY ?? 0;
      b.rag?.destroy();
      if (!b.down) b.char.release();
      else if (b.char.root.parent) {
        // The living are not ours to release. Whoever owns it finds it getting up.
        b.char.root.position.y = ground;
        b.char.anim.getUp?.('prone', 0, 0);
      }
    }
    this.bodies = [];
    this.owned.clear();
    this.over = false;
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
  stats(): { ragdolls: number; corpses: number; limbs: number; liveLimbs: number; limbSpeed: number; chunkBodies: number; rays: number; halves: number; jointGap: number; collapses: number; knockdowns: number; stumbles: number; standing: number } {
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
    let limbSpeed = 0;
    for (const l of this.limbs) {
      if (!l.rag.active) continue;
      liveLimbs++;
      limbSpeed = Math.max(limbSpeed, l.rag.speed);
    }
    return {
      ragdolls, corpses, limbs: this.limbs.length, liveLimbs, limbSpeed, chunkBodies: this.chunks.bodies,
      rays: this.blood.raysUsed, halves: this.sliced.count, jointGap, collapses: this.collapsing(), knockdowns: this.knockedDown(), stumbles: this.stumbling(), standing: this.standing(),
    };
  }
}

export function createGoreSystem(ctx: Ctx): Gore {
  return new Gore(ctx);
}

