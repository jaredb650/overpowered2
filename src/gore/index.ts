/**
 * GoreSystem: everything that happens to a body once the shot has landed.
 *
 * One death path, chosen once. A character enters here through ragdoll, gib, slice or headshot and from
 * then on is owned by this system until it is released. Repeat calls on an owned character are absorbed,
 * which is what stops the first game's ragdoll-and-dismember double solver from coming back.
 */
import * as THREE from 'three';
import { ARCHETYPES } from '../characters/archetypes';
import { HumanoidBone, type GoreRegion } from '../characters/rig';
import {
  CG, DEFAULT_FORCE, type CapsuleHit, type CharacterInstance, type CorpseHit, type Ctx, type DamageInfo, type EmitterHandle,
  HEAD_VOLLEY, type GoreSystem, type HeadOutcome, type RagdollOptions, type RayHit, type SeveredLimb, type SeverResult,
} from '../core/contracts';
import { DevFlags } from '../core/devflags';
import { clamp, rand, randomInCone, randomUnit } from '../core/math';
import { WEAPONS } from '../weapons/data';
import { BloodField, BloodTuning } from './blood';
import { Tracks } from './tracks';
import { FireField, FireTuning, type ParkedFire } from './fire';
import { DryTuning, tickFlesh } from './cooked';
import { ChunkField, scatter, type ChunkKind } from './chunks';
import { ImpactEvents, impactKind, ImpactTuning } from './impacts';
import { CollapseDrive, impactStrength, MASS_PASS, MuscleTuning, STAND_PASS, STRENGTH_PASS, WEIGHT_PASS, type CollapseOptions, type DownedBody, type KnockdownOptions, type LimbStrength } from './muscles';
import { BodyFilter, fillVelocity, LimbFilter, measureAnimVelocity, Rag, SEED_STRIDE } from './rag';
import { boneRay, boneRayContact, nextCapsuleHit, rayBones, rayNearSphere } from './raycast';
import { Reflex, ReflexTuning } from './reflex';
import { Stand, StandTuning, strengthBudget } from './stand';
import { Crawler } from './crawl';
import { HUMAN_MASS, markSevered, markSubtree, MAX_BONES, rigInfo, type RigInfo } from './rigInfo';
import { SliceField } from './sliced';
import { WoundPlanner, WoundTuning } from './wounds';
import { RopeField } from './rope';
import { SpurtField } from './spurt';
import { GibTrail, TrailTuning, type Ribbon } from './trail';
import { blowsOut, buildKit, buildLimb, buildWreck, KIT_LIMBS, kitPieces, placeAt, placePiece, planGib, seedOf, spillsGuts, TorsoTuning, triangleSet, TRUNK_EXITS, type GibPlan, type TorsoKit, type TorsoPiece } from './torso';
import { SlabTuning } from './slabs';
import { mulberry32 } from '../core/math';
import { WoundKind } from '../characters/anatomy/wounds';
import type { OrganKind, RibKind } from './organs';
import { MESS, messBudget, MessField, MessTuning } from './mess';
import { FarBatch, FarTuning, type CorpseSnapshot, type FarBakeable, type FarSource } from './far';

/**
 * The baked stand-ins for the head on a partial head wound (docs/proposals/partial-head-wounds.md), by archetype: the side
 * blown away (baked on +X, mirrored for the other side) and the crown and upper face blown open. The rest burst a
 * 'partial', as does an archetype whose heads have not loaded yet. `?headpartial=0` bursts them all, to compare.
 */
const PARTIAL_HEADS: Readonly<Record<string, readonly [side: string, top: string]>> =
  typeof location !== 'undefined' && new URLSearchParams(location.search).get('headpartial') === '0'
    ? {}
    : Object.fromEntries(['trooper', 'gunner', 'husk', 'brute'].map(a => [a, [`${a}HeadPartialSide`, `${a}HeadPartialTop`] as const]));
/** A round this far off the head's sideways axis, or nearer, takes the side off; anything else the top. */
const PARTIAL_SIDE = 0.55;
/** What a partial wound throws out, and each piece's size against the head's hit radius. */
const PARTIAL_PIECES: readonly (readonly [ChunkKind, number])[] = [['cranium', 0.55], ['cranium', 0.4], ['brain', 0.5], ['meat', 0.3], ['meat', 0.25]];

/**
 * Vaporized bodies (`Gore.vaporize`): the Lance's beam and giant ball. A body sags for `sag` seconds on its own weight, then
 * rises on `lift` of world gravity turned upward, slowed by `drag`, turning at up to `spin` rad/s, and burns away over
 * `seconds`. `max` at once, each a live chain that never freezes; past it a body is ash on the spot.
 */
export const VaporTuning = {
  max: 10,
  seconds: [1.6, 2.3] as const,
  sag: 0.14,
  rise: 1.1,
  lift: 0.03,
  drag: 1.3,
  spin: 1.1,
  spinDrag: 0.4,
  /** Of the speed it died with, what it keeps along the floor. */
  keep: 0.25,
  /** Seconds between spits of sparks off a body. Embers come every frame. */
  ashEvery: 0.09,
};

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
  /**
   * Bodies still holding themselves up. Past this a collapse is just a ragdoll. 8 since the gore update's R4 (it was 4, and
   * is with `?carry=0`): a burst that kills six had the fifth and sixth drop as plain ragdolls beside four that died on their
   * feet. Each is a chain either way; what a collapse adds is its animator and its joint drives for about a second.
   */
  maxCollapses: 8,
  maxCollapsesBefore: 4,
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
  /**
   * Frozen and simulated bodies together. Past this the oldest out of sight goes, and one in sight only well past it
   * (`MessField.policy`). The "Mess" setting writes it (`applyMess`, 120 at Standard); a mission may lower it.
   */
  maxCorpses: MESS.standard.corpses,
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
   * limbs take `Rag.throwScale` of it, since they fall on the tempo dial. Chunks keep world gravity and all of it. With
   * `GibThrow.on` this only sizes a machine's scrap: flesh is thrown by `GibThrow`.
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

/**
 * How a burst body's pieces leave it (the gore update's G2). The owner's rule: the fireball is not touched, and the pieces
 * are thrown with force out of it, at full weight, so the player sees the body come apart. A rocket's fireball is about
 * 3 m wide and 2.5 m tall for 0.2 s, with dark smoke in its place to 0.8 s: thrown at 3 to 7 m/s as before, everything
 * was on the floor inside it by 0.5 s. So each piece goes up hard and out along the blast: at 8 m/s up from chest height
 * it is over the fireball's top by 0.25 s, at the top of its arc (2.9 m) at 0.42 s and down at 0.95 s, 3 to 6 m off.
 *
 * Each class is `[out, up]`, m/s along the floor and upward at `power` 1, each a range a piece is drawn from; `along` is
 * how much of its heading is the blast's against straight out from the trunk's middle. `power` is the square root of the
 * kill's force over `force`, kept inside `power`: a rocket's fireball is 1, a boss's death the most.
 * `?gibthrow=0` (and the lab's switch) puts the old launch back, to compare.
 */
type ThrowClass = 'trunk' | 'half' | 'limb' | 'ribs' | 'organ' | 'slab' | 'meat' | 'gut';
type Range = readonly [number, number];
export const GibThrow: {
  on: boolean; force: number; power: Range; along: number; fan: number; spin: number; spinLight: number;
} & Record<ThrowClass, readonly [out: Range, up: Range]> = {
  on: typeof location === 'undefined' || new URLSearchParams(location.search).get('gibthrow') !== '0',
  force: 80,
  power: [0.85, 1.35],
  along: 0.3,
  /** Radians a heading is turned by, at most, either way. */
  fan: 1.1,
  trunk: [[2.5, 5.5], [7.5, 10.5]],
  /** A waist tear's two halves are a body's worth of weight each: they part, and the chest goes over. */
  half: [[2.5, 4], [5, 7.5]],
  limb: [[2.5, 6], [6.5, 10]],
  ribs: [[2.5, 6.5], [6, 10.5]],
  organ: [[2.5, 6], [6.5, 11]],
  slab: [[2.5, 7], [6.5, 11]],
  meat: [[1.5, 8], [3, 11]],
  gut: [[2.5, 6], [6, 9.5]],
  /** Turns a second, at most, about each axis: a trunk piece, and a lighter one. */
  spin: 10,
  spinLight: 16,
};

/** The gore update's launch is on: not switched off by the URL or by the lab's panel. */
const thrownOut = (): boolean => GibThrow.on && DevFlags.gibThrow;

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

/** Where a ray enters a box, in metres along it, or -1 if it misses. 0 from inside. */
function rayBox(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, lo: THREE.Vector3, hi: THREE.Vector3): number {
  let t0 = 0;
  let t1 = Infinity;
  if (Math.abs(dx) < 1e-9) {
    if (ox < lo.x || ox > hi.x) return -1;
  } else {
    const n = (lo.x - ox) / dx, f = (hi.x - ox) / dx;
    t0 = Math.max(t0, Math.min(n, f));
    t1 = Math.min(t1, Math.max(n, f));
  }
  if (Math.abs(dy) < 1e-9) {
    if (oy < lo.y || oy > hi.y) return -1;
  } else {
    const n = (lo.y - oy) / dy, f = (hi.y - oy) / dy;
    t0 = Math.max(t0, Math.min(n, f));
    t1 = Math.min(t1, Math.max(n, f));
  }
  if (Math.abs(dz) < 1e-9) {
    if (oz < lo.z || oz > hi.z) return -1;
  } else {
    const n = (lo.z - oz) / dz, f = (hi.z - oz) / dz;
    t0 = Math.max(t0, Math.min(n, f));
    t1 = Math.min(t1, Math.max(n, f));
  }
  return t0 <= t1 ? t0 : -1;
}
/** What a dead body counts as having, for how big a wound one hit makes. */
const CORPSE_HEALTH = 100;
/** Real seconds between the knocks of rounds into the dead, a living hit's shortest gap, so a Buzzsaw sweep is a beat. */
const CORPSE_KNOCK_GAP = 0.07;

const machines = new Set(ARCHETYPES.filter(a => a.stumps === 'machine').map(a => a.id));
/** Drones and skitters spark where everything else bleeds. */
const isMachine = (char: CharacterInstance): boolean => machines.has(char.archetype);
const humanoidBones = Object.entries(HumanoidBone);
/** Regions are shared by every rig; only flesh humanoids have a torso that can crawl. */
const canCrawl = (char: CharacterInstance): boolean => !isMachine(char)
  && humanoidBones.every(([name, bone]) => char.rig.bones[bone]?.name === name);

/** Which limbs a gib throws as real parts, in order. */
const GIB_REGIONS: readonly GoreRegion[] = ['head', 'armL', 'armR', 'legL', 'legR'];
const GIB_LOWER: Partial<Record<GoreRegion, GoreRegion>> = {
  armL: 'forearmL', armR: 'forearmR', legL: 'shinL', legR: 'shinR',
};
/** An organ's size, metres across on a 1.85 m body, and where in the trunk it starts: 0 the hips, 1 the chest. */
/** Half as big again as they were (the gore update's O1): at 6 to 10 cm an organ was a dot at 8 m. */
const ORGAN_SIZE: Record<OrganKind, number> = { lung: 0.15, liver: 0.14, heart: 0.09, stomach: 0.117 };
const ORGAN_AT: Record<OrganKind, number> = { lung: 1.1, liver: 0.6, heart: 1, stomach: 0.55 };
/** Pieces of one shape of one archetype's limb in the world at once (`Gore.cutLimbs`): four destroyed limbs' worth. */
const PARTS_PER_SHAPE = 4;
/** The two ribcage fragments a blow-out throws, by the side the round came out of (his left is +X). */
const BLOWN_RIBS: Record<string, readonly RibKind[]> = { L: ['ribsLL', 'ribsUL'], R: ['ribsLR', 'ribsUR'] };

/** A character that has died and is in our care. */
class DeadBody {
  /** How dry its blood is drawn, 0..1, in the steps gore has written to its skin (`Gore.dryTheDead`). */
  dry = 0;
  rag: Rag | null = null;
  readonly stakes: Stake[] = [];
  sinking = -1;
  sinkFrom = 0;
  smearLeft = 7;
  readonly smearAt = new THREE.Vector3();
  pooled = false;
  /** World time it was vaporized, or -1. `vaporFor` is how long it takes to go. */
  vapor = -1;
  vaporFor = 0;
  lifted = false;
  bare = false;
  ashAt = 0;
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
  /** 0 drawn as in life, 1 settled: mess.ts decides, and holds the shadows it took (`shade`). */
  tier = 0;
  shade: THREE.Object3D[] | null = null;
  /** World time before which it stays a character, whatever the caps say: something is still happening on it (`Gore.hold`). */
  holdUntil = 0;
  constructor(readonly char: CharacterInstance, readonly info: RigInfo) {}
}

/**
 * A body at rest that has been baked into the far batch (far.ts). Its character has gone back to the library; its chain,
 * with its fixed capsules, stays in the world, so it is still part of its heap. `was` is the body it was, for what a
 * round into it had worn down.
 */
class FarBody {
  sinking = -1;
  readonly stakes: readonly Stake[] = [];
  /** It was smouldering when it was baked: its fire, smoking on where it lies until the body is stood up again. */
  fire: ParkedFire | null = null;
  constructor(
    readonly rag: Rag, readonly snap: CorpseSnapshot, readonly slot: number, readonly info: RigInfo,
    readonly parent: THREE.Object3D | null, readonly was: DeadBody,
  ) {}
}

/** What a character on the floor is waiting to do. */
/** The rig's chest bone (HumanoidBone.chest), where a line takes hold. */
const CHEST = 2;
const _tugAt = new THREE.Vector3();
const _tugV = new THREE.Vector3();

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
  /** The ribbon of blood it trails while it flies (trail.ts). */
  ribbon: Ribbon | null = null;
  emitter: EmitterHandle | null = null;
  /** Short arterial spray from the cut end of the limb. */
  endSpray: EmitterHandle | null = null;
  /** Present on a top half that is still pulling itself along. */
  crawler: Crawler | null = null;
  machine = false;
  /**
   * Baked into the limbs' batch (far.ts): its slot there, and what its piece hung under, which it has left for as long
   * as it is baked. -1: it is drawn as the piece it is.
   */
  slot = -1;
  parent: THREE.Object3D | null = null;
  /** World time it last came to rest. */
  restedAt = 0;
  /** How dry its blood is drawn, as a body's. */
  dry = 0;
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

/** A vaporized body's helmet and gear do not burn on the skin's dissolve, so they go first. A reset shows them again. */
const hideProp = (o: THREE.Object3D): void => {
  if ((o as THREE.Mesh).isMesh && !(o as THREE.SkinnedMesh).isSkinnedMesh) o.visible = false;
};

export class Gore implements GoreSystem {
  private bodies: DeadBody[] = [];
  private readonly owned = new Map<CharacterInstance, DeadBody>();
  private limbs: LooseLimb[] = [];
  private readonly stumps: Stump[] = Array.from({ length: GoreTuning.maxStumps }, () => new Stump());
  private stumpAt = 0;
  private pins: PendingPin[] = [];
  readonly blood: BloodField;
  /** Blood carried on feet: prints and slide smears. */
  readonly tracks: Tracks;
  readonly chunks: ChunkField;
  readonly sliced: SliceField;
  /** Guts: loose strands from a gib, and strands hanging from opened bellies (rope.ts). */
  readonly ropes: RopeField;
  /** Arterial jets out of necks and stumps (spurt.ts). */
  readonly spurts: SpurtField;
  /** The blood a flying piece trails (trail.ts): one budget for trunk pieces, limbs and loose pieces. */
  readonly trail: GibTrail;
  /** Everything alight or smouldering: the living, corpses and limbs (fire.ts). */
  readonly fire: FireField;
  /** Each archetype's trunk, cut once into the pieces it breaks into (torso.ts). */
  private readonly kits = new Map<string, TorsoKit>();
  /** Each machine's hull in the pieces it breaks into (torso.ts `buildWreck`), cut at load or on its first burst. */
  private readonly wrecks = new Map<string, TorsoPiece[]>();
  /** Each archetype's skin material, for its kit's pieces thrown when no body of it is to hand. */
  private readonly kitSkin = new Map<string, THREE.Material>();
  private gibFrame = -1;
  private gibsThisFrame = 0;
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
  /** The dead at rest: heaps, pushing them aside, and the caps (mess.ts). */
  readonly mess: MessField;
  /** Old and distant bodies, baked into one mesh (far.ts), and what each needs to be stood up again. */
  readonly far: FarBatch;
  /** Loose limbs at rest, baked: their own batch of small slots, one draw for all of them. */
  readonly farLimbs: FarBatch;
  private farBodies: FarBody[] = [];
  /** World time the baked bodies began to sink with the rest of the floor (`sweep`), or -1. */
  private farSweep = -1;
  /** Baked bodies stood up on this frame for a round or a blast, and the frame. */
  private stoodFrame = -1;
  private stood = 0;
  private readonly onPreStep = (dt: number): void => this.preStep(dt);
  private readonly onRadial = (center: THREE.Vector3, radius: number, strength: number): void =>
    this.blast(center, radius, strength);

  constructor(private readonly ctx: Ctx) {
    this.blood = new BloodField(ctx);
    this.tracks = new Tracks(ctx, this.blood);
    this.impacts = new ImpactEvents(ctx);
    this.trail = new GibTrail(ctx);
    this.chunks = new ChunkField(ctx, this.blood, this.impacts, this.trail);
    this.chunks.ensure();
    this.wounds = new WoundPlanner(ctx, isMachine, (char, bone) => this.owned.get(char)?.rag?.breakJoint(bone));
    this.sliced = new SliceField(ctx, this.blood, this.impacts, this.trail);
    this.ropes = new RopeField(ctx, this.blood);
    this.ropes.ensure();
    this.spurts = new SpurtField(ctx, this.blood, this.trail);
    const gore = this;
    this.far = new FarBatch(ctx);
    this.farLimbs = new FarBatch(ctx, FarTuning.limb.slots, FarTuning.limb, 'gore.farLimbs');
    this.mess = new MessField(ctx, {
      get bodies() { return gore.bodies; },
      get limbs() { return gore.limbs; },
      get far() { return gore.farBodies; },
      wake: target => {
        // A baked body is stood up first, on a fresh character, and that is what wakes.
        const real = target instanceof FarBody ? this.standUp(target) : target as PinTarget;
        if (real) this.wake(real);
      },
      bake: body => this.bake(body as DeadBody),
      standUp: far => this.standUp(far as FarBody) !== null,
      removeFar: far => this.removeFar(far as FarBody),
      simulating: () => {
        let live = 0;
        for (const b of this.bodies) if (b.rag?.active && b.sinking < 0) live++;
        return live;
      },
      maxRagdolls: () => GoreTuning.maxRagdolls,
      maxCorpses: () => GoreTuning.maxCorpses,
      remove: body => this.removeBody(body as DeadBody),
      sink: body => this.sinkBody(body as DeadBody),
      pushed: target => {
        if (target instanceof DeadBody) target.freshAt = this.ctx.time.elapsed;
      },
      kick: (at, radius, vx, vz) => {
        this.chunks.shove(at, radius, vx, vz);
        this.sliced.shove(at, radius, vx, vz);
      },
      removeLimb: limb => this.removeLimb(limb as LooseLimb),
      sinkLimb: limb => this.sinkLimb(limb as LooseLimb),
      maxLimbs: () => GoreTuning.maxLimbs,
      // What lay on a body that has gone falls: loose pieces, trunk pieces and halves, strands of gut.
      bakeLimb: limb => this.bakeLimb(limb as LooseLimb),
      unbakeLimb: limb => this.unbakeLimb(limb as LooseLimb),
      unsettled: (lo, hi) => {
        this.chunks.unsettle(lo, hi);
        this.sliced.unsettle(lo, hi);
        this.ropes.unsettle(lo, hi);
      },
    });
    this.sliced.inView = (at, radius) => this.mess.sees(at, radius);
    this.fire = new FireField(ctx, char => {
      const b = this.owned.get(char);
      return b !== undefined && !b.down && b.vapor < 0;
    }, char => this.owned.get(char)?.rag ?? null);
  }

  alight(char: CharacterInstance, fireproof?: boolean): void {
    this.fire.feed(char, fireproof);
  }

  burnOn(char: CharacterInstance, fireproof?: boolean): void {
    this.fire.burnOn(char, fireproof);
  }

  init(): void {
    if (this.ready) return;
    this.ready = true;
    const lib = this.ctx.characters as unknown as { prop?(id: string): Promise<THREE.Mesh> } | undefined;
    for (const id of Object.values(PARTIAL_HEADS).flat()) {
      // A test's stub library may answer with nothing at all.
      void Promise.resolve(lib?.prop?.(id)).then(mesh => mesh && this.standIns.set(id, mesh), () => {});
    }
    this.ctx.physics.preStep.add(this.onPreStep);
    this.ctx.physics.radialListeners.add(this.onRadial);
    // "Clear at wave break": the floor is swept when the wave ends. Each screen sweeps its own.
    this.ctx.events.on?.('wave:clear', () => {
      if (messBudget().clearAtBreak) this.sweep();
    });
  }

  /**
   * Clears the floor in plain sight without a pop: the dead and their limbs sink, pieces shrink, blood fades, all over a
   * couple of seconds. The living, down or up, are left alone.
   */
  sweep(): void {
    for (const b of this.bodies) if (b.sinking < 0 && !b.down && b.vapor < 0) this.sinkBody(b);
    for (const l of this.limbs) if (l.sinking < 0) this.sinkLimb(l);
    this.chunks.dismiss();
    this.sliced.dismiss();
    this.ropes.clear();
    // The baked ones sink together, as one mesh.
    if (this.farBodies.length > 0) {
      this.farSweep = this.ctx.time.elapsed;
      for (const f of this.farBodies) {
        f.sinking = this.farSweep;
        f.rag.dropRest();
      }
    }
    (this.ctx.render.decals as { fadeOut?(seconds: number): void }).fadeOut?.(GoreTuning.sinkSeconds);
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
    if (this.farBodies.length > 0) this.standOnRay(ox, oy, oz, dx, dy, dz, maxDist);
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
    // An organ on the floor is shot before what lies behind it: it bursts (`damageCorpse`).
    const organ = this.chunks.raycastOrgan(origin, dir, best);
    if (organ >= 0 && !this.sliced.raycast(origin, dir, organ, out.point, out.normal)) {
      out.distance = organ;
      out.point.copy(origin).addScaledVector(dir, organ);
      out.normal.copy(dir).negate();
      out.handle = this.chunks.organHit;
      out.bone = -1;
      out.region = 'chest';
      return out;
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
      // Killed while it was on its feet on its muscles (R4): the same ragdoll goes on, dying on its feet.
      if (existing.down && !(DevFlags.carry && this.dieStanding(existing, options))) this.endDown(existing);
      return;
    }
    const body = this.adopt(char);
    this.beginCollapse(body, options?.duration ?? MuscleTuning.collapseSeconds, options?.velocity, options?.twitch, options?.hit, options?.strength);
  }

  /** How many bodies may die on their feet at once. */
  private collapseRoom(): number {
    return DevFlags.carry ? GoreTuning.maxCollapses : GoreTuning.maxCollapsesBefore;
  }

  /**
   * A kill on a living body that gore has on its feet (catching its balance, or losing it): the drive it was standing on
   * becomes a death's (`MuscleState.dieOnFeet`), on the same chain at the same speeds, so the reaction it was in the middle
   * of carries into the death with nothing rebuilt. The round that killed it lands as it does on any body dying on its feet.
   * False, and nothing done, when it was not on its feet or there is no room: the caller drops it where it is, as before.
   */
  private dieStanding(body: DeadBody, options?: CollapseOptions): boolean {
    const rag = body.rag;
    const muscle = rag?.muscle;
    const drive = muscle?.collapse;
    if (!rag?.active || !muscle || !drive?.alive || this.collapsing() >= this.collapseRoom()) return false;
    const { char, info } = body;
    const seconds = clamp(options?.duration ?? MuscleTuning.collapseSeconds, 0.3, 5);
    if (!muscle.dieOnFeet(seconds)) return false;
    body.down = null;
    body.freshAt = this.ctx.time.elapsed;
    body.holding = true;
    // Time it spent alive does not count against time to settle.
    rag.age = Math.min(rag.age, 1);
    const natural = char.anim.play('deathStumble');
    if (natural > 0) char.anim.play('deathStumble', natural / seconds);
    if (options?.strength) muscle.strengthen(options.strength);
    const hit = options?.hit;
    if (hit) {
      const dv = (hit.force * DevFlags.force) / info.mass;
      // Most of the round into where its feet are heading, as for any round on a body on its feet (`strikeDown`).
      rag.applyImpulse(hit.bone, hit.point, _v.copy(hit.dir).multiplyScalar(hit.force * (1 - MuscleTuning.carryShare)));
      drive.carry(hit.dir, dv);
      drive.away.set(hit.dir.x, 0, hit.dir.z).normalize();
      const region = info.rig.bones[hit.bone]!.region;
      if (region.startsWith('leg') || region.startsWith('shin')) drive.shotLeg = drive.weakLeg = region.endsWith('L') ? 1 : -1;
      muscle.jolt(hit.bone, hit.point, hit.dir, joltOf(hit.force, info.mass));
      char.anim.holdWound?.(hit.bone, hit.point, seconds);
    }
    if ((options?.twitch ?? 0) > 0 && !isMachine(char)) muscle.startTwitch(options!.twitch!);
    return true;
  }

  private beginCollapse(body: DeadBody, duration: number, velocity?: THREE.Vector3, twitch?: number, hit?: CollapseOptions['hit'], strength?: LimbStrength): void {
    const { char, info } = body;
    // Short of GoreTuning.maxSimTime, with time left over to land.
    const seconds = clamp(duration, 0.3, 5);
    let drive: CollapseDrive | null = null;
    if (MuscleTuning.enabled && this.collapsing() < this.collapseRoom()) {
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

  tug(char: CharacterInstance, pull: (position: THREE.Vector3, velocity: THREE.Vector3) => void): THREE.Vector3 | null {
    const b = this.owned.get(char);
    const rag = b?.down ? b.rag : null;
    if (!rag?.active) return null;
    const part = rag.parts.find(p => p.bone === CHEST) ?? rag.parts[Math.min(1, rag.parts.length - 1)];
    if (!part) return null;
    const at = part.body.translation();
    const v = part.body.linvel();
    _tugAt.set(at.x, at.y, at.z);
    _tugV.set(v.x, v.y, v.z);
    pull(_tugAt, _tugV);
    part.body.setLinvel(_tugV, true);
    return _tugAt;
  }

  downed(char: CharacterInstance): DownedBody | null {
    return this.owned.get(char)?.down ?? null;
  }

  /** See net/world/moves.ts: a body that is down gets up as soon as it has come to rest, whatever time it had left to lie. */
  rouse(char: CharacterInstance): void {
    const body = this.owned.get(char);
    const reflex = body?.down ? body.rag?.muscle?.reflex : null;
    if (reflex) reflex.lie = 0;
  }

  /**
   * True once a body that is down has begun to get itself up (pushing up off the floor, or gathering for the clip), and until
   * it is handed back. Co-op: the host tells the others at this moment, so their copies start up with it (net/world/moves.ts).
   */
  rising(char: CharacterInstance): boolean {
    const body = this.owned.get(char);
    const phase = body?.down ? body.rag?.muscle?.reflex?.phase : undefined;
    return phase === 'struggle' || phase === 'gather';
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
    this.mess.forget(b);
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
    // A struck part that was on physics in the animator (`sway.ts`) has just been read, pose and speed, like the rest of the
    // body. From here the whole body is this ragdoll's, so what the animator still adds to its targets goes quickly.
    char.anim.easeSway?.(0.2);
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
    this.blood.sheetBehind(at, dir, 0.55 + size);
  }

  /** `keep` has just been woken and is about to be used, so it is the one chain that may not freeze here. */
  private enforceBudget(keep?: PinTarget): void {
    this.budgetRagdolls(keep);
    // How many bodies stay, and which go first, is the mess's (`MessField.policy`): the oldest out of sight.
    let limbs = 0;
    let liveLimbs = 0;
    for (const l of this.limbs) {
      if (l.sinking >= 0) continue;
      limbs++;
      if (l.rag.active) liveLimbs++;
    }
    // How many limbs stay is the mess's as well: here only how many may simulate.
    for (let i = 0; i < this.limbs.length && liveLimbs > GoreTuning.maxLiveLimbs; i++) {
      const l = this.limbs[i]!;
      if (l.sinking >= 0 || !l.rag.active || l === keep) continue;
      this.freezeLimb(l);
      liveLimbs--;
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
    return b !== keep && b.vapor < 0 && b.rag !== null && b.rag.active && b.stakes.length === 0 && !b.rag.muscle?.collapse && !b.down
      // The heat is still drawing a burning corpse up (fire.ts): frozen now, it would stop half way.
      && !this.fire.curling(b.char);
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
    b.rag?.freeze(MessTuning.rest && b.stakes.length === 0);
    this.mess.rested(b, b.char as never);
    if (!b.pooled && !isMachine(b.char)) {
      b.pooled = true;
      const at = b.rag ? b.rag.center : _v.setFromMatrixPosition(b.char.bones[0]!.matrixWorld);
      // A burnt body has nothing left to run out of it: soot and a scorch where it lies, not a red pool.
      if (this.fire.sooted(b.char)) this.fire.rest(b.char, at, rand(1.2, 1.6) * b.char.rig.height / 1.85);
      else {
        // Lying in blood that was there before it, it soaks it up.
        this.blood.soakBody(b.char, at);
        // The patch it has soaked into the floor is there at once; the pool then spreads out of it.
        this.blood.soak(at, rand(1.3, 1.8));
        this.blood.pool(at, rand(1.2, 1.9), 4.5);
      }
    }
  }

  private sinkBody(b: DeadBody): void {
    b.rag?.freeze();
    b.rag?.dropRest();
    // It moves again, if only down: a still skeleton would leave it drawn where it lay.
    this.mess.woke(b.char as never);
    b.sinking = this.ctx.time.elapsed;
    b.sinkFrom = b.char.root.position.y;
  }

  /** Out of sight and over the cap: gone at once, with nothing to watch. */
  private removeBody(b: DeadBody): void {
    const at = this.bodies.indexOf(b);
    if (at < 0) return;
    b.rag?.destroy();
    this.mess.forget(b);
    this.fire.forget(b.char);
    this.owned.delete(b.char);
    this.bodies.splice(at, 1);
    b.char.release();
  }

  /**
   * Bakes a body at rest into the far batch and gives its character back. False if it cannot be: it is moving, staked,
   * held, not a library character, too big for a slot, or the batch is full.
   */
  private bake(b: DeadBody): boolean {
    const rag = b.rag;
    if (!rag || rag.active || b.sinking >= 0 || b.down || b.vapor >= 0 || b.stakes.length > 0) return false;
    if (this.farSweep >= 0 || this.ctx.time.elapsed < b.holdUntil) return false;
    // A body with flames on it stays a character until they are out: a baked copy cannot burn.
    if (this.fire.flaming(b.char)) return false;
    const source = b.char as unknown as Partial<FarSource>;
    if (typeof source.bakeFar !== 'function' || typeof source.snapshot !== 'function') return false;
    const slot = this.far.add(source as FarSource);
    if (slot < 0) return false;
    const snap = source.snapshot();
    const parent = b.char.root.parent;
    const at = this.bodies.indexOf(b);
    this.mess.forget(b);
    // A body still smouldering goes on smoking where it lies, and takes its fire back when it is stood up.
    const smoke = this.far.object && rag.restPoints.length >= 3 ? this.fire.park(b.char, this.far.object, Float32Array.from(rag.restPoints)) : null;
    this.fire.forget(b.char);
    this.owned.delete(b.char);
    if (at >= 0) this.bodies.splice(at, 1);
    b.char.release();
    const far = new FarBody(rag, snap, slot, b.info, parent, b);
    far.fire = smoke;
    this.farBodies.push(far);
    return true;
  }

  /**
   * Stands a baked body up again as a character, exactly as it lay: a fresh instance from the library, posed, cut and
   * wounded from the snapshot, on the same chain and the same fixed capsules. At rest still; whoever asked wakes it.
   */
  private standUp(f: FarBody): DeadBody | null {
    const at = this.farBodies.indexOf(f);
    if (at < 0 || f.sinking >= 0) return null;
    let char: CharacterInstance;
    try {
      char = this.ctx.characters.spawn(f.snap.archetype);
    } catch {
      return null;
    }
    const source = char as unknown as Partial<FarSource> | undefined;
    if (typeof source?.restore !== 'function') {
      char?.release?.();
      return null;
    }
    (f.parent ?? this.ctx.render.scene).add(char.root);
    source.restore(f.snap);
    this.farBodies.splice(at, 1);
    this.far.remove(f.slot);
    const body = new DeadBody(char, f.info);
    body.skip.set(f.was.skip);
    body.damage.set(f.was.damage);
    body.pooled = f.was.pooled;
    body.bare = f.was.bare;
    body.dry = f.was.dry;
    body.smearLeft = 0;
    body.freshAt = this.ctx.time.elapsed;
    body.rag = f.rag;
    f.rag.adopt(char);
    this.owned.set(char, body);
    // It is as old as it ever was: at the front, where the caps look for the oldest.
    this.bodies.unshift(body);
    // Its fire is its own again where it had got to; gone cold meanwhile, the glow it was baked with is put out.
    this.fire.resume(f.fire, char);
    f.fire = null;
    this.mess.stoodUp(body, char as never);
    const d = _v.setFromMatrixPosition(char.bones[0]!.matrixWorld).distanceTo(this.ctx.player?.position?.isVector3 === true ? this.ctx.player.position : _v);
    (char as { setLod?(level: number, force?: boolean): void }).setLod?.(this.mess.lodFor(body, d, GoreTuning.bodyLodNear, GoreTuning.bodyLodFar), true);
    return body;
  }

  /** A baked body leaves the world: over the cap and out of sight, or swept. */
  private removeFar(f: FarBody): void {
    const at = this.farBodies.indexOf(f);
    if (at < 0) return;
    this.farBodies.splice(at, 1);
    this.far.remove(f.slot);
    if (f.fire) this.fire.forget(f.fire);
    f.rag.destroy();
  }

  /** May one more baked body be stood up this frame for a round or a blast? Six a frame: a stand-up is 0.1 ms. */
  private mayStand(): boolean {
    const frame = this.ctx.time.frame ?? 0;
    if (frame !== this.stoodFrame) {
      this.stoodFrame = frame;
      this.stood = 0;
    }
    return this.stood++ < 6;
  }

  /** A baked body the ray would meet is stood up, so that a round into a heap finds a body there to hit. */
  private standOnRay(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number): void {
    let best = maxDist;
    let found: FarBody | null = null;
    for (let i = 0; i < this.farBodies.length; i++) {
      const f = this.farBodies[i]!;
      if (f.sinking >= 0) continue;
      const c = f.rag.center;
      if (!rayNearSphere(ox, oy, oz, dx, dy, dz, c.x, c.y, c.z, f.info.reach[0]!, best)) continue;
      if (rayBox(ox, oy, oz, dx, dy, dz, f.rag.restMin, f.rag.restMax) < 0) continue;
      // The box is loose. The round has to pass through the body itself: within a limb's width of where a capsule lies.
      const p = f.rag.restPoints;
      for (let k = 0; k < p.length; k += 3) {
        const px = p[k]! - ox, py = p[k + 1]! - oy, pz = p[k + 2]! - oz;
        const t = px * dx + py * dy + pz * dz;
        if (t < 0 || t >= best) continue;
        const ex = px - dx * t, ey = py - dy * t, ez = pz - dz * t;
        if (ex * ex + ey * ey + ez * ez > 0.14 * 0.14) continue;
        best = t;
        found = f;
      }
    }
    if (found && this.mayStand()) this.standUp(found);
  }

  /**
   * Keeps a body a character for `seconds` more, whatever the caps say: something is still happening on it that a baked
   * copy could not show (it is burning, a line is on it). Nothing if gore does not have it.
   */
  hold(char: CharacterInstance, seconds: number): void {
    const body = this.owned.get(char);
    if (body) body.holdUntil = Math.max(body.holdUntil, this.ctx.time.elapsed + seconds);
  }

  /**
   * Bakes a loose limb at rest into the limbs' batch: its triangles as it lies, at the coarsest level of detail, in one
   * shared mesh, and its own piece taken out of the scene. The piece is kept, with its chain and its fixed capsules: a
   * round, a boot or a blast finds it exactly as before, and `unbakeLimb` is all it takes to have it back. False if it
   * cannot be: it moves, burns or smokes, trails guts, is staked, or what it carries does not fit a slot.
   */
  private bakeLimb(l: LooseLimb): boolean {
    if (l.slot >= 0 || l.rag.active || l.sinking >= 0 || l.stakes.length > 0 || this.farSweep >= 0) return false;
    if (l.crawler?.alive || this.fire.has(l.piece) || this.ropes.hangingFrom(l.piece.root) > 0) return false;
    const source = l.piece as unknown as Partial<FarBakeable>;
    if (typeof source.bakeFar !== 'function' || !source.farMaterial) return false;
    const slot = this.farLimbs.add(source as FarBakeable);
    if (slot < 0) return false;
    l.slot = slot;
    l.parent = l.piece.root.parent;
    l.piece.root.removeFromParent();
    return true;
  }

  /** A baked limb is the piece it was again, where it lay. Nothing if it is not baked. */
  private unbakeLimb(l: LooseLimb): boolean {
    if (l.slot < 0) return false;
    this.farLimbs.remove(l.slot);
    l.slot = -1;
    (l.parent ?? this.ctx.render.scene).add(l.piece.root);
    l.parent = null;
    return true;
  }

  private freezeLimb(l: LooseLimb): void {
    l.restedAt = this.ctx.time.elapsed;
    l.rag.freeze(MessTuning.rest && l.stakes.length === 0);
    this.mess.rested(l, l.piece as never);
    this.stopLimbEmitters(l);
    if (l.machine) return;
    if (this.fire.sooted(l.piece)) this.fire.rest(l.piece, l.rag.center, rand(0.45, 0.7));
    else this.blood.pool(l.rag.center, rand(0.32, 0.55), 2.5);
  }

  private stopLimbEmitters(l: LooseLimb): void {
    l.emitter?.stop();
    l.endSpray?.stop();
    l.emitter = null;
    l.endSpray = null;
    l.crawler?.kill();
  }

  private sinkLimb(l: LooseLimb): void {
    this.unbakeLimb(l);
    l.rag.freeze();
    l.rag.dropRest();
    this.mess.woke(l.piece as never);
    this.mess.forgetLimb(l);
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
    // A body burnt past the soot line is cooked through: what is cut from it is dry, and nothing sprays from either end.
    const dry = this.fire.sooted(char);
    const limb = this.addLimb(char, piece, bone, _mask, _seeds, body?.rag?.active ? body.rag.killedInAir : undefined, dry);
    char.hideLimb(bone);
    this.fire.split(char, piece, _mask);
    const torso = region === 'abdomen' && !body && canCrawl(char) ? this.startCrawl(limb) : undefined;
    if (region === 'abdomen' && canCrawl(char) && !dry) {
      // Guts out of both halves: the top half drags its own behind it as it crawls.
      const scale = char.rig.height / 1.85;
      this.ropes.hang(piece.bones[bone]!, _v5.set(0, -0.02 * scale, 0.04 * scale), piece.root, scale);
      this.ropes.hang(char.bones[0]!, _v5.set(0, 0.1 * scale, 0.05 * scale), char.root, scale * 0.8);
    }

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

    if (!dry) this.startStump(char, bone, 1);
    this.woundEffects(char, bone, stump, damage, dry);
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

  private addLimb(char: CharacterInstance, piece: SeveredLimb, bone: number, mask: Uint8Array, seeds: Float32Array, lofted?: boolean, dry = false): LooseLimb {
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
    if (!dry) limb.emitter = this.ctx.fx.attachEmitter(piece.bones[bone]!, limb.machine ? 'sparkTrail' : 'bloodTrail', undefined, 3) ?? null;
    if (!limb.machine && !dry) {
      // The limb's own cut end spits back the way it came, for a moment.
      const a = info.axis;
      _v4.set(-a[bone * 3]!, -a[bone * 3 + 1]!, -a[bone * 3 + 2]!).multiplyScalar(0.02);
      limb.endSpray = this.ctx.fx.attachEmitter(piece.bones[bone]!, 'stumpSpray', _v4, 1.3) ?? null;
      // Thrown hard, it draws its arc in blood from its cut end (trail.ts): a limb off a living man as much as a gib's.
      limb.ribbon = this.trail.open(limb);
    }
    this.limbs.push(limb);
    return limb;
  }

  wound(char: CharacterInstance, damage: DamageInfo, severity: number): boolean {
    this.gutShot(char, damage, severity);
    this.wounds.onBody(char, damage, severity);
    const broke = this.wounds.broke;
    // Burnt past the soot line, a body gives ash where it is struck: fire seals what it burns.
    if (isMachine(char)) return broke;
    if (this.fire.sooted(char)) {
      if (damage.type !== 'fire' && damage.type !== 'shock' && damage.type !== 'true') this.ashPuff(damage.point, 1);
    } else this.blood.onHit(char, damage, severity);
    return broke;
  }

  /**
   * A belly opened wide enough (`spillsGuts`) leaves a strand of gut hanging out of it, for as long as the body lasts: off a
   * man on his feet, and dragged behind one crawling. One a body. Tells the damage (`spill`), so a co-op guest hangs it too.
   */
  private gutShot(char: CharacterInstance, damage: DamageInfo, severity: number): void {
    // Cooked guts do not spill.
    if (WoundTuning.level === 0 || isMachine(char) || !canCrawl(char) || char.severed.has('abdomen') || this.fire.sooted(char)) return;
    char.root.updateMatrixWorld(true);
    const hips = char.bones[HumanoidBone.hips]!;
    const chest = char.bones[CHEST]!;
    const low = _v.setFromMatrixPosition(hips.matrixWorld).y - 0.08;
    const high = _v2.setFromMatrixPosition(chest.matrixWorld).y;
    // A blast has no bone of its own: it counts as the belly when it arrives at belly height.
    const belly = damage.bone === HumanoidBone.spine || damage.bone === HumanoidBone.hips
      || (damage.type === 'explosive' && damage.point.y > low && damage.point.y < high);
    // By how far off the shooter stood: in co-op that is not always the local player (`DamageInfo.from`).
    const eye = damage.from ?? this.ctx.player?.eye;
    const dist = eye?.isVector3 === true ? damage.point.distanceTo(eye) : Infinity;
    if (!spillsGuts(damage, belly, severity, dist) || this.ropes.hangingFrom(char.root) > 0) return;
    damage.spill = true;
    this.eviscerate(char, damage.point, damage.dir);
  }

  /** A strand of gut out of the front of the belly, where `at` opened it, hanging from the spine. */
  private eviscerate(char: CharacterInstance, at: THREE.Vector3, dir: THREE.Vector3): void {
    const spine = char.bones[HumanoidBone.spine]!;
    spine.updateWorldMatrix(true, false);
    const scale = char.rig.height / 1.85;
    // A loop out of the hole, its two ends a little inside it and spread across the belly, so it hangs as a heavy U.
    _v4.copy(at).addScaledVector(dir, 0.02);
    spine.worldToLocal(_v4);
    _v3.copy(_v4).add(_v2.set(0.15 * scale, -0.03 * scale, 0));
    _v4.x -= 0.13 * scale;
    this.ropes.hang(spine, _v4, char.root, scale, _v3);
    // `dir` may be one of the scratch vectors just used: the spray goes out and down whatever it was.
    this.blood.spray(at, _down, 6, 2, 0.6, 0.08);
  }

  private woundEffects(char: CharacterInstance, bone: number, at: THREE.Vector3, damage: DamageInfo, dry = false): void {
    const { fx, audio } = this.ctx;
    const def = char.rig.bones[bone]!;
    if (isMachine(char)) {
      fx.sparks(at, damage.dir, 24);
      audio.play('impact_armor', { position: at, volume: 0.6, pitchJitter: 0.1 });
      return;
    }
    _v.copy(damage.dir);
    if (dry) this.ashPuff(at, 1);
    else {
      fx.bloodHit(at, _v, 1.4);
      this.bleed(char, at, damage.dir, 6, 6, 0.42);
    }
    const parent = char.bones[def.parent];
    if (parent) char.addWound(def.parent, at, (def.hit?.radius ?? 0.06) * 1.8);
    if (!dry) char.setBloodiness(0.14);
    char.hitFlash(1);
    audio.play('enemy_hit', { position: at, volume: 0.6, pitchJitter: 0.08 });
    audio.playOneOf(['bullet_hit1', 'bullet_hit2'], { position: at, volume: 0.35, pitch: 0.7 });
  }

  /**
   * What a burnt thing gives off where it is struck, cut or broken, in place of blood: a breath of ash and a few embers.
   * `size` 1 is a round's worth; a body bursting is 4 or so.
   */
  private ashPuff(at: THREE.Vector3, size: number): void {
    const { fx } = this.ctx;
    fx.embers(at, Math.round(2 + size * 2), 0.25 + size * 0.08);
    fx.smokeWisp?.(at, 0.12 + size * 0.07, 0.7);
  }

  /**
   * The char on a body about to be cut or burst, 0..1, for the pieces it leaves (`burnTint`): they are as burnt as it was.
   * A body with flames on it and no char yet counts as a little burnt, so that its pieces can go on burning. With
   * `?fire=0` pieces are as they were before the gore update: never burnt.
   */
  private burnOf(char: CharacterInstance): number {
    if (!DevFlags.fire) return 0;
    return Math.max(clamp(char.burn ?? 0), this.fire.has(char) ? 0.03 : 0);
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
    // The jet itself: a rope of blood out of the stump that beats and dies away.
    if (!s.machine) this.spurts.start(parent, s.offset, s.axis, char.root, (s.ends - s.started) * 0.75, Math.min(1.35, power));
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
    const partial = what === 'partial' && (PARTIAL_HEADS[char.archetype]?.every(id => this.standIns.has(id)) ?? false);
    const burst = what === 'burst' || (what === 'partial' && !partial);
    const down = this.owned.get(char);
    // A body standing in a collapse keeps its head to a blast, as it always has; told what to do, it does it.
    if (down && neck !== undefined && !char.severed.has('head') && (down.down || outcome !== undefined)) {
      // Down, rising or dead already: nothing comes off whole, and a burst comes apart where the head lies.
      if (down.down) {
        this.endDown(down);
        down.rag?.goLimp();
      }
      if (burst) this.burstHead(char, neck, damage);
      else if (partial) this.partialHead(char, neck, damage);
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
    } else if (partial) {
      this.partialHead(char, neck, damage);
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
    // One fan past the body and a sheet on the wall behind stand for most of what was nine separate stains.
    this.blood.fan(at, damage.dir, 1.5);
    this.blood.splatterAlong(at, damage.dir, 5, 8, 0.6);
    this.blood.spray(at, _up, 10, 11, 0.32, 0.12);
  }

  /** Baked partial heads by prop id, loaded at init. */
  private readonly standIns = new Map<string, THREE.Mesh>();

  /**
   * A partial head wound: part of the head blown away and the rest left on the neck. The head's skin folds away and a baked
   * partial head (`PARTIAL_HEADS`) takes its place on the head bone, so it follows the ragdoll, comes off with the head if
   * the body is shot again and goes with the pooled body's reset. The round's side of the head goes if it came in from the
   * side, the crown and upper face otherwise. A piece of cranium and of brain are thrown out of it, with blood.
   */
  private partialHead(char: CharacterInstance, neck: number, damage: DamageInfo): void {
    const { fx } = this.ctx;
    const info = rigInfo(char.rig);
    const headBone = info.children[neck]![0] ?? neck;
    const r = char.rig.bones[headBone]!.hit?.radius ?? 0.1;
    const at = damage.point;
    const head = char.bones[headBone]!;
    const [side, top] = PARTIAL_HEADS[char.archetype]!;
    head.updateWorldMatrix(true, false);
    head.getWorldQuaternion(_q).invert();
    const along = _v.copy(damage.dir).applyQuaternion(_q);
    const sideways = Math.abs(along.x) >= PARTIAL_SIDE;
    const mesh = this.standIns.get(sideways ? side : top)!.clone();
    mesh.scale.setScalar(ARCHETYPES.find(a => a.id === char.archetype)?.proportions.scale ?? 1);
    // Baked with his left (+X) side gone: the side the round came in by, so a round travelling toward +X mirrors it.
    if (sideways && along.x > 0) mesh.scale.x = -mesh.scale.x;
    // A head already stood in for, or gone, keeps what it has.
    char.standIn?.(headBone, mesh);
    // Back out of the wound the way the round came, and up: what it blew out of the head.
    _v3.copy(damage.dir).negate().multiplyScalar(0.6).add(_up).normalize();
    for (const [kind, size] of PARTIAL_PIECES) {
      scatter(_v3, 2.5, 2, 3, _v);
      randomUnit(_v2);
      _q.setFromUnitVectors(_up, _v2);
      this.chunks.spawn(kind, at.x, at.y, at.z, _v.x, _v.y, _v.z, r * size, _q, 14);
    }
    fx.bloodHit(at, _v3, 1.4);
    fx.bloodMist(at, 0.22);
    // What is left of the head pumps out of the wound, up and back the way the round came.
    head.updateWorldMatrix(true, false);
    head.getWorldQuaternion(_q2).invert();
    this.spurts.start(head, head.worldToLocal(_v4.copy(at)), _v5.copy(_v3).applyQuaternion(_q2), char.root, 3, 0.85);
    this.bleed(char, at, damage.dir, 7, 6, 0.5);
    this.blood.spray(at, _v3, 8, 6, 0.4, 0.1);
    char.setBloodiness(0.3);
  }

  // -------------------------------------------------------------------------------------------
  // Gibs
  // -------------------------------------------------------------------------------------------

  gib(char: CharacterInstance, center: THREE.Vector3, force: number, damage?: DamageInfo): void {
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
    // The way the blast went, along the floor: the kill's own direction (a blast's runs from its centre through the
    // body, a round's along its shot). `center` is the body's own middle on most calls, and says nothing of it.
    const flat = this.gibFlat.copy(damage ? damage.dir : away).setY(0);
    if (flat.lengthSq() < 0.01) randomUnit(flat).setY(0);
    flat.normalize();
    this.gibMid.copy(hips).lerp(chest, 0.5);
    this.gibPower = clamp(Math.sqrt(push / GibThrow.force), GibThrow.power[0], GibThrow.power[1]) * DevFlags.force;
    if (thrownOut()) blastDir.set(flat.x, 0.6, flat.z).normalize();

    // Speed comes from impulse over a body's mass, with a floor so a gib never looks like a stumble.
    const t = GoreTuning;
    const launch = clamp(push / t.gibForcePerSpeed, t.gibSpeedMin, t.gibSpeedMax) * DevFlags.force;
    const killing = damage;
    damage = {
      amount: 999, type: 'explosive', point: chest.clone(), dir: blastDir.clone(), force: 1, source: 'gib',
    };
    if (body?.rag?.active) body.rag.writeSeeds(_seeds);
    else if (body?.rag) fillVelocity(info.count, null, _seeds);
    else measureAnimVelocity(char, char.anim, null, _seeds);
    const seeds = _seeds.slice();

    // Every limb leaves whole, or in two at its lower joint when there is room for the extra piece. It used to be the lower
    // part alone a third of the time, and the upper arm or the thigh it left behind was nowhere: on a Trooper up to 40 of
    // his 83 litres of limb (the volume audit, docs/notes/gore.md).
    // A burnt body bursts into burnt pieces, and one burnt past the soot line into dry ones: no red comes out of it.
    const burn = this.burnOf(char);
    const dry = burn >= FireTuning.sootFrom;
    let liveLimbs = 0;
    for (const l of this.limbs) if (l.rag.active) liveLimbs++;
    let spare = clamp(t.maxLiveLimbs - liveLimbs - GIB_REGIONS.length, 0, 2);
    // A machine's limbs are not a man's: a skitter's middle legs hang on what a man would call his forearms, and were
    // thrown only when the dice split an "arm" in two (a third of the time), and deleted with the body otherwise: 12 of
    // its 44 litres of leg (the volume audit, every archetype). Every limb a machine has leaves it.
    const throwLimb = (bone: number): void => {
      markSevered(info, char.severed, _skip);
      if (_skip[bone] === 1 || body?.skip[bone] === 1) return;
      const piece = this.takePiece(char, bone);
      markSubtree(info, bone, _mask);
      // What has already gone from under it (its own lower part, a moment ago) is not in this piece.
      for (let i = 0; i < info.count; i++) if (_skip[i] === 1 || body?.skip[i] === 1) _mask[i] = 0;
      // Thrown by the gib, not killed in the air, whatever its seed: it takes the dial, and `fling` holds the throw.
      const limb = this.addLimb(char, piece, bone, _mask, seeds, false, dry);
      char.hideLimb(bone);
      this.fire.split(char, piece, _mask);
      const p = limb.rag.center;
      // A limb falls on the tempo dial and lands as far as it would at full gravity. Chunks keep world gravity and `launch`.
      const fling = launch * limb.rag.throwScale;
      if (thrownOut()) this.throwOf('limb', p, _v2).multiplyScalar(limb.rag.throwScale);
      else {
        _v2.copy(p).sub(center);
        if (_v2.lengthSq() < 1e-4) randomUnit(_v2);
        _v2.normalize().multiplyScalar(fling * rand(0.65, 1.15));
        _v2.y += fling * rand(0.25, 0.6);
      }
      for (const part of limb.rag.parts) {
        part.body.setLinvel(_v2, true);
        randomUnit(_v3).multiplyScalar(rand(8, 18));
        part.body.setAngvel(_v3, true);
      }
      limb.rag.muscle?.kick(_v2, 1);
    };
    if (machine) {
      // By bone, not by region: two of a machine's limbs may hang on what the rig calls one region.
      for (let bone = 1; bone < info.count; bone++) if (char.rig.bones[bone]!.severable) throwLimb(bone);
    } else {
      for (const region of GIB_REGIONS) {
        const lower = GIB_LOWER[region];
        const inTwo = lower !== undefined && spare > 0 && Math.random() < 0.35;
        if (inTwo) spare--;
        for (const use of inTwo ? [lower, region] : [region]) {
          const bone = info.severBone.get(use);
          if (bone !== undefined) throwLimb(bone);
        }
      }
    }
    if (machine) {
      // Its limbs have left it: what is left is the hull, and that breaks into its own pieces.
      const thrown = this.breakHull(char, hips, blastDir, launch);
      this.scrapBurst(chest, blastDir, launch, thrown > 0 ? 7 : 12);
    } else {
      // Past `fullPerFrame` gibs this frame, the smallest version: the trunk's pieces are still there, little else is.
      const now = this.ctx.time.elapsed;
      if (this.gibFrame !== now) {
        this.gibFrame = now;
        this.gibsThisFrame = 0;
      }
      const full = this.gibsThisFrame++ < TorsoTuning.fullPerFrame;
      const plan = planGib(killing ?? damage, push, full);
      // Told, so a co-op guest replaying this kill breaks the trunk the same way.
      if (killing) killing.torso = plan.mode;
      // A pair of legs has no chest to throw a ribcage or a lung out of.
      if (char.severed.has('abdomen')) {
        plan.ribs = [];
        plan.organs = plan.organs.filter(o => o === 'liver' || o === 'stomach').slice(0, 1);
      }
      // Nothing out of this trunk starts under the floor it stood or lay on.
      const floor = this.floorUnder(hips);
      this.chunks.floor = floor;
      // A burnt body breaks into burnt pieces.
      this.chunks.char = burn;
      // Cooked guts do not string out: a burnt body throws none.
      if (dry) plan.ropes = 0;
      const broke = this.breakTrunk(char, plan, chest, blastDir, launch, floor, burn);
      this.spill(char, plan, chest, hips, blastDir, launch, floor);
      this.fleshBurst(chest, hips, blastDir, launch, push, broke ? (full ? 6 : 3) : 13, dry);
      this.chunks.floor = -Infinity;
      this.chunks.char = 0;
    }

    // Guts already out of him (a belly opened before this) are thrown clear with the rest, not taken with the body.
    if (!machine) this.ropes.drop(char.root, _v2.copy(blastDir).multiplyScalar(5 * this.gibPower).setY(6));
    // Its limbs and the pieces of its trunk have its fire now.
    this.fire.forget(char);
    if (body) this.dropBody(body);
    char.release();
    this.enforceBudget();
  }

  /** The gib being thrown: the blast's heading along the floor, the trunk's middle, and how hard (`GibThrow`). */
  private readonly gibFlat = new THREE.Vector3(1, 0, 0);
  private readonly gibMid = new THREE.Vector3();
  private gibPower = 1;

  /**
   * The velocity one piece of the body being burst leaves at (`GibThrow`), into `out`: along the floor it heads out from
   * the trunk's middle and on with the blast, turned by up to `fan` either way, and it goes up hard.
   */
  private throwOf(kind: ThrowClass, at: THREE.Vector3, out: THREE.Vector3, rnd: () => number = Math.random, fan = GibThrow.fan): THREE.Vector3 {
    const t = GibThrow;
    const [across, up] = t[kind];
    const flat = this.gibFlat;
    // Straight out from the trunk's middle. A piece at the middle has no such way and takes the blast's.
    let rx = at.x - this.gibMid.x;
    let rz = at.z - this.gibMid.z;
    const reach = Math.hypot(rx, rz);
    if (reach > 0.02) {
      rx /= reach;
      rz /= reach;
    } else {
      rx = flat.x;
      rz = flat.z;
    }
    const x = flat.x * t.along + rx * (1 - t.along);
    const z = flat.z * t.along + rz * (1 - t.along);
    const l = Math.hypot(x, z) || 1;
    const turn = (rnd() * 2 - 1) * fan;
    const c = Math.cos(turn);
    const s = Math.sin(turn);
    const speed = (across[0] + (across[1] - across[0]) * rnd()) * this.gibPower;
    return out.set(((x * c - z * s) / l) * speed, (up[0] + (up[1] - up[0]) * rnd()) * Math.sqrt(this.gibPower), ((x * s + z * c) / l) * speed);
  }

  /**
   * Cuts every flesh humanoid's kit now, at load, so no gib in play pays for a cut. Each archetype's spare instance is
   * borrowed while nobody is fighting, cut, and given back pristine.
   */
  warm(): void {
    // The blood rope every flying piece now trails: compiled here, not on the first gib.
    this.spurts.warm();
    const library = this.ctx.characters;
    if (!library?.archetypes) return;
    let warmed = false;
    for (const id of library.archetypes()) {
      if (this.kits.has(id)) continue;
      let char: CharacterInstance;
      try {
        char = library.spawn(id);
      } catch {
        continue;
      }
      const flesh = canCrawl(char);
      let kit: TorsoKit | null = null;
      if (flesh) {
        kit = this.kitFor(char);
        if (!warmed) {
          this.sliced.warm(kit.waist[0]!.side, char.skinMaterial);
          // The far batch too: its arrays are made and its program is linked here, not on the first body baked in a fight.
          const source = char as unknown as Partial<FarSource>;
          if (source.farMaterial && typeof source.bakeFar === 'function') this.far.warm(source as FarSource);
        }
        warmed = true;
      } else if (isMachine(char)) {
        // A machine's hull is cut here too, with its limbs folded away, so its first burst pays for no cut.
        char.rig.bones.forEach((def, bone) => { if (bone > 0 && def.severable) char.hideLimb(bone); });
        this.wreckFor(char);
      }
      char.release();
      if (kit) this.cutLimbs(id, kit);
    }
  }

  /** What cutting every archetype's limbs took at load, ms, for the notes. */
  limbMs = 0;

  /**
   * Cuts each limb of an archetype into the pieces it breaks into when it is destroyed outright (`buildLimb`), and
   * registers them to be drawn as instances. One borrowed body a limb: its bind copy has to be the trunk and that limb.
   */
  private cutLimbs(id: string, kit: TorsoKit): void {
    if (kit.limbs.length > 0) return;
    const library = this.ctx.characters;
    const started = performance.now();
    let trunk: Set<number> | null = null;
    try {
      const bare = library.spawn(id);
      for (const b of TRUNK_EXITS) bare.hideLimb(b);
      const g = bare.bakePose(true);
      trunk = triangleSet(g);
      g.dispose();
      bare.release();
    } catch {
      // A stub library: no limbs are cut, and one destroyed bursts into meat, as before.
    }
    KIT_LIMBS.forEach((bones, li) => {
      let parts: TorsoKit['limbs'][number] = [];
      try {
        if (!trunk) throw new Error('no trunk');
        const char = library.spawn(id);
        for (const b of TRUNK_EXITS) if (b !== bones[0]) char.hideLimb(b);
        parts = buildLimb(char, bones, trunk);
        parts.forEach((part, k) => this.chunks.register(
          `part:${id}:${li}:${k}`, part.side.geometry, [char.skinMaterial, this.sliced.flesh],
          _v.copy(part.side.max).sub(part.side.min).multiplyScalar(0.5), PARTS_PER_SHAPE,
        ));
        char.release();
      } catch {
        // A stub library, or a body it cannot lend: that limb bursts into meat, as before.
      }
      kit.limbs.push(parts);
    });
    this.limbMs += performance.now() - started;
  }

  /** The kit for this archetype, cut on its first gib if `warm` did not (torso.ts). Hides the trunk's exits. */
  kitFor(char: CharacterInstance): TorsoKit {
    let kit = this.kits.get(char.archetype);
    if (!kit) {
      for (const b of TRUNK_EXITS) char.hideLimb(b);
      kit = buildKit(char);
      this.kits.set(char.archetype, kit);
      this.kitSkin.set(char.archetype, char.skinMaterial);
      // Its slabs are drawn as instances, in his skin on one face and the cut face's meat on the other.
      kit.slabs.forEach((slab, i) => this.chunks.register(`slab:${char.archetype}:${i}`, slab.geometry, [char.skinMaterial, this.sliced.flesh], slab.half, SlabTuning.perShape));
    }
    return kit;
  }

  /**
   * The mid-size pieces of a burst trunk (slabs.ts): `plan.slabs` of the kit's, each from where it sits on his body at
   * this moment, thrown as the rest are. They fill the gap between the trunk's few big pieces and the small meat.
   */
  private throwSlabs(char: CharacterInstance, kit: TorsoKit, plan: GibPlan, blastDir: THREE.Vector3, launch: number): void {
    const n = kit.slabs.length;
    if (n === 0 || plan.slabs === 0) return;
    const rnd = mulberry32(plan.seed ^ 0x51ab51ab);
    const first = Math.floor(rnd() * n);
    for (let k = 0; k < Math.min(plan.slabs, n); k++) {
      // Every other one round the trunk, so a few of them still come from all sides of it.
      const i = (first + k * 2 + (k * 2 >= n ? 1 : 0)) % n;
      const slab = kit.slabs[i]!;
      placeAt(char, slab.bone, slab.at, _v3, _q);
      // Just clear of the skin it is a copy of, the way it faces.
      _v4.copy(slab.normal).applyQuaternion(_q);
      _v3.addScaledVector(_v4, 0.03);
      if (thrownOut()) this.throwOf('slab', _v3, _v2, rnd, 1.6);
      else _v2.copy(_v4).multiplyScalar(launch * (0.3 + rnd() * 0.3)).addScaledVector(blastDir, launch * 0.3).setY(_v2.y + 2 + rnd() * 3);
      this.chunks.spawn(`slab:${char.archetype}:${i}`, _v3.x, _v3.y, _v3.z, _v2.x, _v2.y, _v2.z, 1, _q, GibThrow.spinLight);
    }
  }

  /**
   * The trunk breaks into its kit's pieces where it stands, and they fly. False when it cannot: no flesh humanoid trunk
   * left to break (a machine, a skitter, legs whose top half has already gone).
   */
  /** Height of the world under `at`, looking from a little above it; minus infinity over nothing. */
  private floorUnder(at: THREE.Vector3): number {
    _v4.copy(at);
    _v4.y += 0.6;
    return this.ctx.physics.raycastInto(_v4, _down, 4, CG.World, _ground) ? _ground.point.y : -Infinity;
  }

  private breakTrunk(char: CharacterInstance, plan: GibPlan, chest: THREE.Vector3, blastDir: THREE.Vector3, launch: number, floor: number, burn = 0): boolean {
    if (!canCrawl(char) || char.severed.has('chest')) return false;
    // Cut at the waist already, what is left of the trunk is the pelvis: it goes as the kit's pelvis, not as nothing.
    const legsOnly = char.severed.has('abdomen');
    for (const b of TRUNK_EXITS) char.hideLimb(b);
    const kit = this.kitFor(char);
    const rnd = mulberry32(plan.seed);
    const scale = char.rig.height / 1.85;
    const waist = plan.mode === 'waist';
    let hung = false;
    for (const piece of legsOnly ? kit.waist.filter(p => p.bone === HumanoidBone.hips) : kitPieces(kit, plan)) {
      placePiece(char, piece, _v3, _q);
      // A body lying down has its pieces half in the floor: lift each until its lowest corner clears it.
      let low = Infinity;
      for (let k = 0; k < 8; k++) {
        _v5.set(k & 1 ? piece.side.max.x : piece.side.min.x, k & 2 ? piece.side.max.y : piece.side.min.y, k & 4 ? piece.side.max.z : piece.side.min.z);
        low = Math.min(low, _v5.applyQuaternion(_q).y);
      }
      _v3.y = Math.max(_v3.y, floor + 0.01 - low);
      // Out from the middle of the trunk and on with the blast: a waist tear parts, a crack flies.
      _v2.copy(_v3).sub(chest);
      _v2.y *= 0.5;
      if (_v2.lengthSq() < 1e-4) _v2.copy(blastDir);
      // The heavy pieces land within a few metres, where the gib was: thrown at full launch they scattered 8 to 12 m
      // and lay out of sight across the floor, small and far.
      const near = Math.min(launch, TorsoTuning.pieceSpeed);
      _v2.normalize().multiplyScalar(near * (waist ? 0.25 : 0.55) * (0.7 + rnd() * 0.5)).addScaledVector(blastDir, near * (waist ? 0.35 : 0.45));
      _v2.y += (waist ? 1 : 2) + rnd() * 2.5;
      // Thrown up and out of the fireball, tumbling (`GibThrow`).
      if (thrownOut()) this.throwOf(waist ? 'half' : 'trunk', _v3, _v2, rnd);
      const half = this.sliced.throwPiece(piece.side, char.skinMaterial, _v3, _q, _v2, thrownOut() ? (waist ? 4 : GibThrow.spin) : waist ? 3 : 7, burn);
      // Burst while it burned, each piece of the trunk flies on alight, with its share of the fire.
      if (burn > 0) this.fire.pieceOf(char, half, 0.35);
      // The guts hang out of the pelvis's broken face.
      if (plan.hang && !hung && !half.dry && piece.bone === HumanoidBone.hips) {
        hung = true;
        this.ropes.hang(half.mesh, piece.side.capCenter, half.mesh, scale);
      }
    }
    if (!legsOnly) this.throwSlabs(char, kit, plan, blastDir, launch);
    return !legsOnly;
  }

  /** What was inside: the ribcage bursting where it was, organs, and loose strands of gut, as the plan says. */
  private spill(char: CharacterInstance, plan: GibPlan, chest: THREE.Vector3, hips: THREE.Vector3, blastDir: THREE.Vector3, launch: number, floor: number): void {
    const rnd = mulberry32(plan.seed ^ 0x9e3779b9);
    const scale = char.rig.height / 1.85;
    if (plan.ribs.length > 0 && canCrawl(char)) {
      const bone = char.bones[CHEST]!;
      bone.updateWorldMatrix(true, false);
      bone.getWorldQuaternion(_q);
      // As wide as his chest: a broad archetype's ribcage is broader, so it fills the trunk it bursts out of.
      const cage = scale * clamp((char.rig.bones[CHEST]!.hit?.radius ?? 0.16) / 0.16, 1, 1.4);
      this.chunks.burstRibs(
        _v.setFromMatrixPosition(bone.matrixWorld), _q, cage, blastDir, plan.ribs, Math.min(launch, TorsoTuning.pieceSpeed) * 0.45, 1,
        thrownOut() ? (at, out) => this.throwOf('ribs', at, out, rnd) : undefined,
      );
    }
    for (const organ of plan.organs) {
      _v3.copy(hips).lerp(chest, ORGAN_AT[organ]);
      _v3.x += (rnd() - 0.5) * 0.12 * scale;
      _v3.z += (rnd() - 0.5) * 0.08 * scale;
      _v2.set(rnd() - 0.5, rnd() * 0.5, rnd() - 0.5).addScaledVector(blastDir, 1.2).normalize().multiplyScalar(Math.min(launch, TorsoTuning.pieceSpeed) * (0.3 + rnd() * 0.35));
      _v2.y += 1 + rnd() * 3;
      if (thrownOut()) this.throwOf('organ', _v3, _v2, rnd, 1.6);
      _q.setFromAxisAngle(_v4.set(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize(), rnd() * 6.28);
      this.chunks.spawn(organ, _v3.x, _v3.y, _v3.z, _v2.x, _v2.y, _v2.z, ORGAN_SIZE[organ] * scale, _q, 9);
    }
    for (let i = 0; i < plan.ropes; i++) {
      _v3.copy(hips).lerp(chest, 0.3);
      _v3.y = Math.max(_v3.y, floor + 0.25);
      _v2.set(rnd() - 0.5, 0.3, rnd() - 0.5).addScaledVector(blastDir, 1).normalize().multiplyScalar(launch * (0.2 + rnd() * 0.2));
      _v2.y += 1.5;
      if (thrownOut()) this.throwOf('gut', _v3, _v2, rnd, 1.6);
      this.ropes.spill(_v3, _v2, scale, plan.seed + i);
    }
  }

  /** A character's foot came down: if it is wet with blood it leaves a print. Enemies face +Z turned by their root. */
  footfall(char: CharacterInstance, x: number, y: number, z: number, strength: number): void {
    // Boots only: not a machine's feet, not a creature's many legs, not a crawling man's hands (the animator's lightest plants).
    if (strength <= 0.25 || !canCrawl(char)) return;
    const q = char.root.quaternion;
    // The root's +Z in the world, flat.
    this.tracks.footfall(char, x, y, z, 2 * (q.x * q.z + q.w * q.y), 1 - 2 * (q.x * q.x + q.y * q.y));
  }

  /**
   * A big round through the trunk (`blowsOut`): the body stays, and the far side opens on the ribs and the spine, with
   * pieces, two of the ribcage's fragments, an organ and blood thrown out of it. An opened belly is left with its guts out.
   */
  blowOut(char: CharacterInstance, damage: DamageInfo): void {
    if (isMachine(char) || !canCrawl(char) || char.severed.has('abdomen')) return;
    const { fx } = this.ctx;
    damage.torso = 'blowout';
    char.root.updateMatrixWorld(true);
    const belly = damage.bone === HumanoidBone.spine || damage.bone === HumanoidBone.hips || damage.region === 'abdomen';
    const bone = belly ? HumanoidBone.spine : CHEST;
    const scale = char.rig.height / 1.85;
    const rnd = mulberry32(seedOf(damage));
    const dir = _v5.copy(damage.dir).normalize();
    // Out the far side: the chord through the trunk from where it went in, across the bone's centre.
    const middle = _v.setFromMatrixPosition(char.bones[bone]!.matrixWorld);
    if (bone === CHEST) middle.y += 0.1 * scale;
    const exit = _v2.copy(damage.point).addScaledVector(dir, Math.max(0.12 * scale, 2 * _v3.copy(middle).sub(damage.point).dot(dir))).clone();
    if (WoundTuning.level > 0) {
      const into = _v3.copy(dir).negate();
      // Two craters over each other: a wide ragged mouth and a deep middle, so the inside shows to the spine.
      char.wound({ kind: WoundKind.crater, bone, point: exit, dir: into, radius: 0.105 * scale, depth: 0.2 * scale, ragged: 1 });
      char.wound({ kind: WoundKind.exit, bone, point: exit, dir: into, radius: 0.15 * scale, depth: 0.08 * scale, ragged: 1 });
      char.wound({ kind: WoundKind.crater, bone, point: damage.point, dir, radius: 0.04 * scale, depth: 0.1 * scale, ragged: 0.8 });
    }
    // What came out with it, along the round: as burnt as he is, and dry if he is burnt through.
    const dry = this.fire.sooted(char);
    this.chunks.char = this.burnOf(char);
    for (let i = 0; i < 5; i++) {
      randomInCone(dir, 0.45, _v4).multiplyScalar(rand(4, 8));
      _v4.y += rand(0.5, 2.5);
      this.chunks.spawn('meat', exit.x, exit.y, exit.z, _v4.x, _v4.y, _v4.z, rand(0.03, 0.06) * scale);
    }
    char.root.getWorldQuaternion(_q);
    const side = _v4.set(1, 0, 0).applyQuaternion(_q).dot(dir) >= 0 ? 'L' : 'R';
    for (const kind of BLOWN_RIBS[side]!.slice(0, 2)) {
      randomInCone(dir, 0.35, _v4).multiplyScalar(4 + rnd() * 3);
      _v4.y += 1 + rnd() * 2;
      _q2.setFromAxisAngle(_v3.set(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize(), rnd() * 6.28);
      this.chunks.spawn(kind, exit.x, exit.y, exit.z, _v4.x, _v4.y, _v4.z, scale, _q2, 12);
    }
    const organ: OrganKind = belly ? (rnd() < 0.5 ? 'liver' : 'stomach') : rnd() < 0.7 ? 'lung' : 'heart';
    randomInCone(dir, 0.3, _v4).multiplyScalar(3 + rnd() * 2);
    _v4.y += 1.2;
    this.chunks.spawn(organ, exit.x, exit.y, exit.z, _v4.x, _v4.y, _v4.z, ORGAN_SIZE[organ] * scale, undefined, 9);
    // And it is gone from the chest it came out of: the lung on the side the round left by.
    char.takeOrgan?.(organ, side === 'L');
    this.chunks.char = 0;
    if (dry) {
      this.ashPuff(exit, 3);
      return;
    }
    if (belly && this.ropes.hangingFrom(char.root) === 0) this.eviscerate(char, exit, _v3.copy(dir).negate());
    fx.bloodHit(exit, dir, 1.8);
    fx.bloodMist(exit, 0.35);
    fx.bloodSpray?.(exit, dir, 1);
    this.blood.fan(exit, dir, 2.1);
    this.blood.splatterAlong(exit, dir, 7, 9, 0.75);
    this.blood.spray(exit, dir, 12, 9, 0.35, 0.14);
    char.setBloodiness(0.6);
  }

  /** Torn meat, gut and bone off a trunk, `meat` lumps of it, with the blood. The trunk's own pieces are `breakTrunk`'s. */
  private fleshBurst(chest: THREE.Vector3, hips: THREE.Vector3, blastDir: THREE.Vector3, launch: number, push: number, meat: number, dry = false): void {
    const { fx, audio } = this.ctx;
    const few = meat < 13;
    for (let i = 0; i < meat; i++) {
      randomUnit(_v2);
      _v3.copy(chest).addScaledVector(_v2, 0.18);
      _v2.addScaledVector(blastDir, 1.1).normalize().multiplyScalar(launch * rand(0.5, 1.1));
      _v2.y += rand(1, 7);
      // All round, not only on with the blast: the small pieces are the cloud the big ones come out of.
      if (thrownOut()) this.throwOf('meat', _v3, _v2, Math.random, Math.PI);
      // Mostly small: a few big lumps would steal the eye from the trunk's pieces, the ribs and the organs.
      this.chunks.spawn('meat', _v3.x, _v3.y, _v3.z, _v2.x, _v2.y, _v2.z, 0.03 + 0.07 * Math.random() ** 2.2);
    }
    for (let i = 0; i < (few ? 1 : 5); i++) {
      randomUnit(_v2);
      _v3.copy(hips).addScaledVector(_v2, 0.12);
      _v3.y += 0.12;
      _v2.addScaledVector(blastDir, 1).normalize().multiplyScalar(launch * rand(0.3, 0.8));
      _v2.y += rand(1, 5);
      if (thrownOut()) this.throwOf('meat', _v3, _v2, Math.random, 2);
      this.chunks.spawn('viscera', _v3.x, _v3.y, _v3.z, _v2.x, _v2.y, _v2.z, rand(0.05, 0.08));
    }
    for (let i = 0; i < (few ? 2 : 5); i++) {
      randomUnit(_v2);
      _v3.copy(chest).addScaledVector(_v2, 0.15);
      _v2.addScaledVector(blastDir, 1.2).normalize().multiplyScalar(launch * rand(0.6, 1.2));
      _v2.y += rand(1, 6);
      if (thrownOut()) this.throwOf('meat', _v3, _v2, Math.random, 2);
      this.chunks.spawn('bone', _v3.x, _v3.y, _v3.z, _v2.x, _v2.y, _v2.z, rand(0.03, 0.055));
    }
    if (dry) {
      // Burnt through, there is no blood in it to throw: ash and embers where it burst, and soot on the floor under it.
      this.ashPuff(chest, 4);
      this.ashPuff(hips, 3);
      this.fire.sootAt(hips, rand(1.5, 2));
    } else {
      fx.gibBurst(chest, blastDir, clamp(push / 40, 6, 20));
      // Three spurts away from the blast, each slightly off the others, as the first game fired them.
      for (let i = 0; i < 3; i++) {
        randomInCone(blastDir, 0.32, _v2);
        fx.bloodJet(chest, _v2, 2);
      }
      // The burst is the coverage; the rays are what lands past its edge.
      this.blood.burst(chest, blastDir, clamp(1.5 + push / 400, 1.7, 3));
      this.blood.splatterAround(chest, blastDir, 10, 7, 1.15);
      this.blood.spray(chest, blastDir, 14, 12, 0.7, 0.14);
      this.blood.pool(hips, rand(1.4, 2.1), 1.6);
    }
    audio.play('enemy_explode', { position: chest, volume: 0.6, pitchJitter: 0.06 });
  }

  /** The wreck kit for this machine: `char` with every limb that leaves on its own folded away. Empty if it cannot be cut. */
  private wreckFor(char: CharacterInstance): TorsoPiece[] {
    let wreck = this.wrecks.get(char.archetype);
    if (!wreck) {
      try {
        wreck = buildWreck(char);
      } catch {
        // A stub's body, or a mesh the cut cannot close: it goes as scrap alone, as before.
        wreck = [];
      }
      this.wrecks.set(char.archetype, wreck);
    }
    return wreck;
  }

  /**
   * A machine's hull breaks into its kit's pieces where it is, and they fly: a drone or a skitter burst used to be its
   * limbs and a dozen scraps, with the body itself nowhere (the volume audit). Returns how many pieces.
   */
  private breakHull(char: CharacterInstance, hips: THREE.Vector3, blastDir: THREE.Vector3, launch: number): number {
    const info = rigInfo(char.rig);
    for (let bone = 1; bone < info.count; bone++) if (char.rig.bones[bone]!.severable) char.hideLimb(bone);
    const wreck = this.wreckFor(char);
    const floor = this.floorUnder(hips);
    for (const piece of wreck) {
      placePiece(char, piece, _v3, _q);
      let low = Infinity;
      for (let k = 0; k < 8; k++) {
        _v5.set(k & 1 ? piece.side.max.x : piece.side.min.x, k & 2 ? piece.side.max.y : piece.side.min.y, k & 4 ? piece.side.max.z : piece.side.min.z);
        low = Math.min(low, _v5.applyQuaternion(_q).y);
      }
      _v3.y = Math.max(_v3.y, floor + 0.01 - low);
      _v2.copy(_v3).sub(hips);
      if (_v2.lengthSq() < 1e-4) _v2.copy(blastDir);
      _v2.normalize().multiplyScalar(Math.min(launch, TorsoTuning.pieceSpeed) * rand(0.4, 0.7)).addScaledVector(blastDir, launch * 0.3);
      _v2.y += rand(2, 4.5);
      if (thrownOut()) this.throwOf('trunk', _v3, _v2);
      this.sliced.throwWreck(piece.side, char.skinMaterial, _v3, _q, _v2, GibThrow.spin);
    }
    return wreck.length;
  }

  private scrapBurst(at: THREE.Vector3, blastDir: THREE.Vector3, launch: number, scraps = 12): void {
    const { fx, audio } = this.ctx;
    for (let i = 0; i < scraps; i++) {
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
    this.mess.forget(b);
    this.owned.delete(b.char);
    const at = this.bodies.indexOf(b);
    if (at >= 0) this.bodies.splice(at, 1);
  }

  // -------------------------------------------------------------------------------------------
  // Vaporized
  // -------------------------------------------------------------------------------------------

  vaporize(char: CharacterInstance, velocity?: THREE.Vector3): void {
    const v = VaporTuning;
    let body = this.owned.get(char) ?? null;
    if (body && (body.vapor >= 0 || body.sinking >= 0)) return;
    let burning = 0;
    for (const b of this.bodies) if (b.vapor >= 0) burning++;
    if (burning >= v.max) {
      this.ashNow(char, body);
      return;
    }
    if (velocity) velocity.set(velocity.x * v.keep, Math.max(velocity.y, 0), velocity.z * v.keep);
    if (!body) {
      body = this.adopt(char);
      this.startRag(body, { limp: true, muscles: false, velocity });
    } else {
      if (body.down) this.endDown(body);
      if (!body.rag) this.startRag(body, { limp: true, muscles: false, velocity });
      else {
        body.rag.wake();
        body.rag.goLimp();
      }
    }
    const rag = body.rag;
    if (!rag?.active || rag.parts.length === 0) {
      this.ashNow(char, body);
      return;
    }
    // Its skin is the dissolve's from here: an ordinary fire on it would fight that for the same number.
    this.fire.forget(char);
    body.vapor = this.ctx.time.elapsed;
    body.vaporFor = rand(v.seconds[0], v.seconds[1]);
    body.lifted = false;
    body.bare = false;
    body.ashAt = 0;
    body.stakes.length = 0;
    const { fx, render, audio } = this.ctx;
    fx.sparks(rag.center, _up, 18, 0xbfeeff);
    render.lights.flash(rag.center, 0x9fe0ff, 6, 6, 0.35);
    audio.play('lance_vaporize', { position: rag.center, pitchJitter: 0.08 });
  }

  /** A vaporized body's frame: up off the floor once it has sagged, glowing and burning away, and gone at the end. */
  private burnAway(b: DeadBody, now: number): void {
    const v = VaporTuning;
    const age = now - b.vapor;
    const k = age / b.vaporFor;
    const rag = b.rag;
    const at = rag?.active ? rag.center : _v.setFromMatrixPosition(b.char.bones[0]!.matrixWorld);
    if (k >= 1) {
      this.ashNow(b.char, b, 0.5);
      return;
    }
    if (!b.lifted && age >= v.sag && rag?.active) {
      b.lifted = true;
      randomUnit(_v2).multiplyScalar(v.spin);
      for (const part of rag.parts) {
        part.body.setGravityScale(-v.lift, true);
        part.body.setLinearDamping(v.drag);
        part.body.setAngularDamping(v.spinDrag);
        part.body.linvel(part.v);
        part.v.y = Math.max(part.v.y, 0) + v.rise * rand(0.85, 1.15);
        part.body.setLinvel(part.v, true);
        part.body.angvel(part.w);
        part.body.setAngvel(part.w.multiplyScalar(0.3).add(_v2), true);
      }
    }
    // 1 to 2 on the skin is the dissolve (characters/material.ts): a glow, then holes that eat in from the edges.
    (b.char as unknown as { setBurn?(amount: number): void }).setBurn?.(1 + k * k * (3 - 2 * k));
    const { fx } = this.ctx;
    const part = rag?.active ? rag.parts[Math.floor(Math.random() * rag.parts.length)] : undefined;
    if (part) part.body.translation(part.p);
    _v3.copy(part ? part.p : at);
    fx.embers(_v3, k < 0.85 ? 3 : 1, 0.5);
    if (now >= b.ashAt) {
      b.ashAt = now + v.ashEvery;
      // Smoke is the first game's cubes, which read as boxes round a body: the ash is embers and sparks.
      fx.sparks(_v3, _up, k < 0.6 ? 3 : 1, k < 0.5 ? 0x9fe0ff : 0xffa050);
    }
    if (k > 0.65 && !b.bare) {
      b.bare = true;
      b.char.root.traverse(hideProp);
    }
  }

  /** Gone in a breath of ash: the end of a vaporized body, or one past the cap. */
  private ashNow(char: CharacterInstance, body: DeadBody | null, scale = 1): void {
    const { fx } = this.ctx;
    const at = body?.rag?.active ? _v4.copy(body.rag.center) : _v4.setFromMatrixPosition(char.bones[0]!.matrixWorld);
    fx.embers(at, Math.round(26 * scale), 1.2);
    fx.sparks(at, _up, Math.round(12 * scale), 0xffb060);
    if (body) this.dropBody(body);
    char.release();
  }

  // -------------------------------------------------------------------------------------------
  // Slicing
  // -------------------------------------------------------------------------------------------

  slice(char: CharacterInstance, point: THREE.Vector3, normal: THREE.Vector3, damage: DamageInfo): void {
    const body = this.owned.get(char);
    // A body with char on it is cut into halves as burnt, and one cut while it burns is two burning halves: the fire
    // was on the skin, and the skin is on both of them.
    const burn = damage.vaporize ? 0 : this.burnOf(char);
    const halves = this.sliced.cut(char, point, normal, damage, burn);
    if (burn > 0) for (const half of halves) this.fire.pieceOf(char, half, 0.6);
    this.fire.forget(char);
    this.ctx.audio.play('sword_flesh', { position: point, pitchJitter: 0.04 });
    // A cauterized cut does not spill: its halves hiss as they burn away. Nor does a body burnt through.
    if (damage.vaporize) this.ctx.audio.play('lance_vaporize', { position: point, pitchJitter: 0.08 });
    else if (burn < FireTuning.sootFrom) this.ctx.audio.play('blood_spill', { position: point, volume: 0.8 });
    if (body) this.dropBody(body);
    char.release();
  }

  // -------------------------------------------------------------------------------------------
  // Bodies stay shootable
  // -------------------------------------------------------------------------------------------

  damageCorpse(hit: CorpseHit, damage: DamageInfo): void {
    const target = hit.handle;
    const { fx } = this.ctx;
    // A loose organ: it bursts, and that is all of it.
    if (this.chunks.burstHit(target, damage.dir)) return;
    const machine = (target instanceof DeadBody && isMachine(target.char)) || (target instanceof LooseLimb && target.machine) || (target as { scrap?: boolean } | null)?.scrap === true;
    // Burnt past the soot line, the dead have no blood to give: a round knocks ash out of them.
    const dry = target instanceof DeadBody ? this.fire.sooted(target.char) : target instanceof LooseLimb ? this.fire.sooted(target.piece) : (target as { dry?: boolean } | null)?.dry === true;
    if (machine) {
      fx.sparks(hit.point, damage.dir, 8);
    } else if (dry) {
      this.ashPuff(hit.point, 1);
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
      // Fresh blood on it: wet again, and it dries from now.
      if (target.dry > 0 && !dry) {
        target.dry = 0;
        char.setDry?.(0);
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
      if (!machine && !dry) this.blood.onHit(char, damage, damage.amount / CORPSE_HEALTH, hit.bone, hit.point);
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

  /**
   * A loose limb destroyed outright: it comes apart into the pieces it is cut into at load (`cutLimbs`: two of the arm or
   * thigh, the forearm, the hand with its wrist or the boot with a shin in it), each from where that part of it lies, so
   * what flies adds up to the limb that was there. A top half goes as its chest's two pieces, its ribs, its head's kit and
   * its arms. Before, any of them became six lumps: a leg's 21 litres left 4.5 (the volume audit, docs/notes/gore.md).
   */
  private burstLimb(limb: LooseLimb, damage: DamageInfo): void {
    const c = limb.rag.center;
    // A burnt limb comes apart into burnt pieces, dry.
    const burn = limb.machine || !DevFlags.fire ? 0 : clamp(limb.piece.burn ?? 0);
    const dry = burn >= FireTuning.sootFrom;
    if (dry) this.ashPuff(c, 2);
    else {
      this.ctx.fx.bloodMist(c, 0.25);
      this.ctx.fx.bloodHit(c, damage.dir, 1.4);
    }
    this.chunks.char = burn;
    const parts = limb.machine ? 0 : this.throwParts(limb, damage, burn);
    for (let i = 0; i < (parts > 0 ? 4 : 6); i++) {
      scatter(damage.dir, 5, 4, 6, _v);
      this.chunks.spawn(i < 2 ? 'bone' : 'meat', c.x, c.y, c.z, _v.x, _v.y, _v.z, parts > 0 ? rand(0.03, 0.05) : rand(0.04, 0.08));
    }
    this.chunks.char = 0;
    if (!dry) this.blood.stainBelow(c, 0.8);
    // A top half's guts stay in the world when it goes: they drop where they hang, free.
    this.ropes.drop(limb.piece.root, _v.copy(damage.dir).multiplyScalar(2.5).setY(3));
    this.removeLimb(limb);
  }

  /** Throws the kit's pieces of whatever `limb` still has, from where each lies. Returns how many. */
  private throwParts(limb: LooseLimb, damage: DamageInfo, burn = 0): number {
    const kit = this.kits.get(limb.archetype);
    if (!kit) return 0;
    const has = (b: number): boolean => limb.rag.mask[b] === 1 && limb.skip[b] !== 1;
    const src = { bones: limb.piece.bones, rig: limb.info.rig };
    limb.piece.root.updateMatrixWorld(true);
    let n = 0;
    kit.limbs.forEach((parts, li) => parts.forEach((part, k) => {
      if (!has(part.bone)) return;
      placeAt(src, part.bone, part.side.origin, _v3, _q);
      scatter(damage.dir, 3, 2.5, 5, _v);
      this.chunks.spawn(`part:${limb.archetype}:${li}:${k}`, _v3.x, _v3.y, _v3.z, _v.x, _v.y + 1.5, _v.z, 1, _q, 12);
      n++;
    }));
    // A top half: the chest in its two pieces, the ribcage, two organs, and the head in the pieces a burst head is.
    const skin = this.kitSkin.get(limb.archetype);
    if (has(CHEST) && skin) {
      for (const piece of kit.crack3) {
        if (piece.bone !== HumanoidBone.chest) continue;
        placeAt(src, piece.bone, piece.side.origin, _v3, _q);
        scatter(damage.dir, 2.5, 2, 4, _v);
        this.sliced.throwPiece(piece.side, skin, _v3, _q, _v.setY(_v.y + 2), 6, burn);
        n++;
      }
      const chest = limb.piece.bones[CHEST]!;
      chest.getWorldQuaternion(_q);
      _v3.setFromMatrixPosition(chest.matrixWorld);
      const scale = limb.info.rig.height / 1.85;
      this.chunks.burstRibs(_v3, _q, scale, damage.dir, ['ribsUL', 'ribsUR', 'sternum', 'spine'], 2);
      for (const organ of ['lung', 'heart'] as const) {
        scatter(damage.dir, 3, 2.5, 5, _v);
        this.chunks.spawn(organ, _v3.x, _v3.y + 0.05, _v3.z, _v.x, _v.y + 1.5, _v.z, ORGAN_SIZE[organ] * scale, undefined, 9);
      }
      const neck = limb.info.severBone.get('head');
      const head = neck === undefined ? undefined : limb.info.children[neck]![0] ?? neck;
      if (head !== undefined && has(head)) {
        _v4.setFromMatrixPosition(limb.piece.bones[head]!.matrixWorld);
        limb.piece.root.getWorldQuaternion(_q2);
        this.chunks.burstHead(_v4, _q2, (limb.info.rig.bones[head]!.hit?.radius ?? 0.1) * 1.15, damage.dir);
      }
    }
    return n;
  }

  private removeLimb(limb: LooseLimb): void {
    this.unbakeLimb(limb);
    limb.rag.destroy();
    this.stopLimbEmitters(limb);
    this.fire.forget(limb.piece);
    this.mess.woke(limb.piece as never);
    this.mess.forgetLimb(limb);
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
    if (target instanceof LooseLimb) this.unbakeLimb(target);
    rag.wake();
    this.mess.woke((target instanceof DeadBody ? target.char : target.piece) as never);
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
    // The baked bodies it reaches are stood up to be thrown with the rest, the nearest few: the fireball covers the change.
    for (let n = 0; n < 6 && this.farBodies.length > 0; n++) {
      let near: FarBody | null = null;
      let best = radius;
      for (const f of this.farBodies) {
        const d = f.rag.center.distanceTo(center);
        if (f.sinking < 0 && d < best) {
          best = d;
          near = f;
        }
      }
      if (!near || !this.mayStand() || !this.standUp(near)) break;
    }
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

  /**
   * The blood and the bared flesh on the dead dry where they lie, as the blood on the floor round them does
   * (`DryTuning`, shared with the loose pieces' own drying in cooked.ts): from 14 s at rest, over 75 s more, in six steps,
   * each one write to the body's skin (a body at rest sends its texture only when something is written to it). A round
   * into it wets it again (`damageCorpse`). Twice a second, and nothing with the switch off.
   */
  private dryTheDead(now: number): void {
    if (now < this.dryAt) return;
    this.dryAt = now + 0.5;
    if (!DevFlags.dryFlesh) return;
    const step = (since: number): number => Math.floor(clamp((now - since - DryTuning.from) / DryTuning.over) * 6) / 6;
    for (const b of this.bodies) {
      if (b.down || b.sinking >= 0 || b.vapor >= 0 || b.rag?.active) continue;
      const dry = step(b.freshAt);
      if (dry <= b.dry) continue;
      b.dry = dry;
      b.char.setDry?.(dry);
    }
    for (const l of this.limbs) {
      if (l.sinking >= 0 || l.rag.active || l.slot >= 0 || l.machine) continue;
      const dry = step(l.restedAt);
      if (dry <= l.dry) continue;
      l.dry = dry;
      l.piece.setDry?.(dry);
    }
  }
  private dryAt = 0;

  update(): void {
    const { time } = this.ctx;
    const dt = time.dt;
    const now = time.elapsed;
    tickFlesh(now);
    this.dryTheDead(now);
    this.impacts.frame();
    this.updatePins();
    const t = GoreTuning;

    for (let i = this.bodies.length - 1; i >= 0; i--) {
      const b = this.bodies[i]!;
      if (reclaimed(b)) {
        // Never release it: the instance may already be somebody else's enemy. It must not keep a corpse's still skeleton.
        b.rag?.destroy();
        this.mess.forget(b);
        this.owned.delete(b.char);
        this.bodies.splice(i, 1);
        continue;
      }
      if (b.sinking >= 0) {
        const k = (now - b.sinking) / t.sinkSeconds;
        if (k >= 1) {
          this.mess.forget(b);
          this.owned.delete(b.char);
          this.bodies.splice(i, 1);
          b.char.release();
          continue;
        }
        b.char.root.position.y = b.sinkFrom - t.sinkDepth * k * k;
        continue;
      }
      const rag = b.rag;
      if (b.vapor >= 0) {
        if (rag?.active) {
          rag.drive();
          rag.measure(dt, t.calmSpeed, t.calmSpin);
        }
        this.burnAway(b, now);
        continue;
      }
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
      if (rag.speed > 1.2 && b.smearLeft > 0 && !this.fire.sooted(b.char)) {
        const moved = _v.copy(rag.center).sub(b.smearAt);
        moved.y = 0;
        if (moved.lengthSq() > BloodTuning.smearSpacing * BloodTuning.smearSpacing) {
          b.smearAt.copy(rag.center);
          b.smearLeft--;
          // Thrown hard, it leaves one long drag ahead of it in place of the next few marks.
          if (rag.speed > 3.2 && b.smearLeft > 3) {
            b.smearLeft -= 3;
            this.blood.drag(rag.center, moved.x, moved.z, clamp(rag.speed * 0.45, 1.4, 3.2));
          } else this.blood.smear(rag.center, moved.x, moved.z, rand(0.5, 0.8));
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
      if ((rag.calm > t.settleTime || rag.age > (b.stakes.length > 0 ? t.maxPinnedSimTime : t.maxSimTime)) && !this.fire.curling(b.char)) this.freezeBody(b);
    }
    // Over the ragdoll budget, what was too fresh or too fast to freeze is looked at again now it has been measured. With
    // `?mass=0` the budget was only ever kept when something died or woke, as before.
    if (MASS_PASS && this.over) this.budgetRagdolls();

    for (let i = this.limbs.length - 1; i >= 0; i--) {
      const l = this.limbs[i]!;
      if (l.sinking >= 0) {
        const k = (now - l.sinking) / t.sinkSeconds;
        if (k >= 1) {
          this.fire.forget(l.piece);
          this.mess.woke(l.piece as never);
          this.mess.forgetLimb(l);
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

    if (this.farSweep >= 0) {
      const k = (now - this.farSweep) / t.sinkSeconds;
      if (k >= 1) {
        for (let i = this.farBodies.length - 1; i >= 0; i--) if (this.farBodies[i]!.sinking >= 0) this.removeFar(this.farBodies[i]!);
        this.farSweep = -1;
        this.far.lower(0);
      } else this.far.lower(t.sinkDepth * k * k);
    }
    this.mess.update();
    this.updateBodyLod();
    this.updateStumps();
    this.fire.update(dt);
    this.ropes.update(dt);
    this.blood.update(dt);
    this.tracks.update(dt);
    this.chunks.update(dt);
    this.sliced.update(dt);
    // After everything that flies has said where it is: the ribbons move on, and the spurts' layer draws them with its own.
    this.trail.update(dt);
    this.spurts.update(dt);
  }

  /** Nobody else sets a body's detail once it is dead, and one that died at a distance can be walked up to. */
  private updateBodyLod(): void {
    const n = this.bodies.length;
    if (n === 0) return;
    this.lodAt = (this.lodAt + 1) % n;
    const body = this.bodies[this.lodAt]!;
    const { char } = body;
    const d = _v.setFromMatrixPosition(char.bones[0]!.matrixWorld).distanceTo(this.ctx.player.position);
    // A settled body steps down sooner (mess.ts).
    char.setLod?.(this.mess.lodFor(body, d, GoreTuning.bodyLodNear, GoreTuning.bodyLodFar));
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
      // A burnt limb is dry: it thuds and leaves nothing.
      if (!this.fire.sooted(l.piece)) this.blood.stainBelow(rag.center, clamp(0.2 + l.prevSpeed * 0.04, 0.2, 0.55), 'blood', 1.4);
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
    // Thrown hard, it draws its arc in blood from its cut end (trail.ts), a limb off a living man as much as a gib's.
    if (l.ribbon && speed > TrailTuning.minSpeed && rag.age < TrailTuning.seconds) {
      this.trail.feed(l.ribbon, l, l.piece.bones[l.rootBone]!.getWorldPosition(_v), rag.parts[0]!.v);
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
      this.mess.forget(b);
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
    this.fire.clear();
    this.farLimbs.clear();
    for (const l of this.limbs) {
      l.slot = -1;
      l.rag.destroy();
      this.stopLimbEmitters(l);
      this.mess.woke(l.piece as never);
      this.mess.forgetLimb(l);
      l.piece.release();
    }
    this.limbs = [];
    for (const f of this.farBodies) f.rag.destroy();
    this.farBodies = [];
    this.far.clear();
    this.farSweep = -1;
    this.mess.clear();
    this.pins = [];
    for (const s of this.stumps) {
      s.target = null;
      s.emitter?.stop();
      s.emitter = null;
    }
    this.blood.clear();
    this.tracks.clear();
    this.chunks.clear();
    this.sliced.clear();
    this.ropes.clear();
    this.trail.clear();
    this.spurts.clear();
  }

  reset(): void {
    this.clear();
  }

  /** Centre of the i-th loose limb, oldest first. */
  limbCenter(i: number, out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.limbs[i]!.rag.center);
  }

  /** Counts for the debug overlay and budget checks. */
  stats(): { ragdolls: number; corpses: number; far: number; farLimbs: number; limbs: number; liveLimbs: number; limbSpeed: number; chunkBodies: number; rays: number; halves: number; jointGap: number; collapses: number; knockdowns: number; stumbles: number; standing: number; guts: number; spurts: number } {
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
      ragdolls, corpses, far: this.farBodies.length, farLimbs: this.farLimbs.count, limbs: this.limbs.length, liveLimbs, limbSpeed, chunkBodies: this.chunks.bodies,
      rays: this.blood.raysUsed, halves: this.sliced.count, jointGap, collapses: this.collapsing(), knockdowns: this.knockedDown(), stumbles: this.stumbling(), standing: this.standing(),
      guts: this.ropes.live, spurts: this.spurts.live,
    };
  }
}

export function createGoreSystem(ctx: Ctx): Gore {
  return new Gore(ctx);
}

