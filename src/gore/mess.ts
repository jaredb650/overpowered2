/**
 * The mess that stays: what the dead cost once they lie still, and what moves them again.
 *
 * A body at rest is cheap and is not a ghost. It keeps a fixed capsule where each of its own lay (`Rag.freeze(true)`), so
 * the next body lands on it and a heap is as high as its bodies; its skeleton is no longer worked out or sent to the GPU;
 * and past the newest few it casts no shadow of its own and drops a level of detail beyond arm's reach. It never blocks or
 * lifts the player, whose capsule only sees the world, and it is not walked through untouched either: whoever pushes
 * into it (the player, an enemy, a body falling on it, a blast) wakes it as a ragdoll, shoves it, and it settles again.
 *
 * Every number here is a budget, set by the "Mess" setting, and cites `docs/notes/gore.md`, "The mess: measured budgets".
 * Each screen keeps its own mess: nothing here is sent in co-op, and nothing here changes what a bullet or a player meets.
 */
import * as THREE from 'three';
import type { CharacterInstance, Ctx } from '../core/contracts';
import type { Rag } from './rag';
import type { RigInfo } from './rigInfo';

export type MessLevel = 'low' | 'break' | 'standard' | 'everything';
export const MESS_LEVELS: readonly MessLevel[] = ['low', 'break', 'standard', 'everything'];

export interface MessBudget {
  /** Bodies and blood are cleared when a wave ends. */
  clearAtBreak: boolean;
  /** Bodies kept, at rest and moving together. Past it the oldest out of sight goes first. */
  corpses: number;
  /** The newest bodies drawn as in life: their own shadow, every level of detail. The rest are "settled". */
  full: number;
  /** Bodies drawn as characters at all. Past it the oldest and furthest are baked into the far batch (far.ts). */
  drawn: number;
  /** Loose limbs kept. */
  limbs: number;
  /** Loose limbs at rest drawn as themselves. Past it the furthest are baked into the limbs' batch (far.ts). */
  limbsDrawn: number;
  /** Trunk pieces and sword halves kept, and the count past which the oldest goes whatever. */
  halves: number;
  halvesHard: number;
  /** Slots for loose pieces (meat, bone, organs, ribs) in use, as a share of `ChunkTuning.capacity` (`ChunkTuning.share`). */
  pieces: number;
  /** Seconds a still piece lies before it shrinks away. Infinity: until its slot is needed. */
  pieceLinger: number;
  /** Slots of each decal ring in use (`Decals.setLimit`). */
  blood: number;
  marks: number;
  scorches: number;
  big: number;
  /** Layers of blood a spot of floor takes before a new small stain there is skipped (`Decals.soak`). */
  soak: number;
}

/**
 * The caps, from the measurements (`docs/notes/gore.md`, "The mess: measured budgets"). On the laptop a full corpse in
 * view is about 0.18 ms, a settled one 0.06, a baked far one 0.007, and twenty layers of blood under the player's feet
 * 1.4 ms. So, every body in view at once, which is the worst a heap can be:
 *
 * - `low`: 6 full + 14 settled + 20 far = 2.1 ms. A thousand stains.
 * - `standard` (and `break`, the same until the wave ends): 8 + 24 + 88 = 3.5 ms for 120 bodies, against 7.2 ms for the
 *   40 full ones the game drew before; fixed capsules for all of them are 1,800, inside the 2,250 that cost nothing.
 * - `everything`: 12 + 28 + 160 = 5.0 ms for 200 bodies. For a desktop card: on the laptop it will not hold 60 in a heap.
 *
 * `drawn` plus the 48 that may be alive stays under the 96 instances the library keeps of one archetype, at every level.
 */
export const MESS: Readonly<Record<MessLevel, MessBudget>> = {
  low: { clearAtBreak: false, corpses: 40, full: 6, drawn: 20, limbs: 24, limbsDrawn: 6, halves: 14, halvesHard: 22, pieces: 0.2, pieceLinger: 20, blood: 2048, marks: 512, scorches: 96, big: 64, soak: 4 },
  break: { clearAtBreak: true, corpses: 120, full: 8, drawn: 32, limbs: 48, limbsDrawn: 12, halves: 28, halvesHard: 44, pieces: 0.5, pieceLinger: Infinity, blood: 8192, marks: 1536, scorches: 256, big: 192, soak: 6 },
  standard: { clearAtBreak: false, corpses: 120, full: 8, drawn: 32, limbs: 48, limbsDrawn: 12, halves: 28, halvesHard: 44, pieces: 0.5, pieceLinger: Infinity, blood: 8192, marks: 1536, scorches: 256, big: 192, soak: 6 },
  everything: { clearAtBreak: false, corpses: 200, full: 12, drawn: 40, limbs: 64, limbsDrawn: 20, halves: 40, halvesHard: 56, pieces: 1, pieceLinger: Infinity, blood: 12288, marks: 1536, scorches: 256, big: 256, soak: 10 },
};

export const MessTuning = {
  level: 'standard' as MessLevel,
  /**
   * Fixed capsules in the world for bodies and limbs at rest, all together. Fourteen ragdolls landing on 2,250 cost the
   * step 1.3 ms against 1.0 on none, and on 4,500 4.1 (M0). Past this the oldest body at rest gives its capsules up and is
   * a ghost again, as every body was before.
   */
  maxShapes: 2600,
  /** Resting bodies woken in one frame by being walked into, by a body landing on them, or by losing what they lay on. */
  wakesPerFrame: 2,
  /**
   * Chains that may be simulating before a push by the living wakes another, counted from `GoreTuning.maxRagdolls`: the
   * player's push may run this many over the budget for a moment, an enemy's or a landing must leave this many free for
   * the next death.
   */
  playerOver: 4,
  othersUnder: 4,
  /** How wide and tall whoever pushes is, in metres, past their own radius. */
  reach: 0.12,
  /** What a push gives a part: metres a second for standing in it, more for each m/s of closing on it, up to a ceiling. */
  pushBase: 0.7,
  pushPerSpeed: 0.5,
  pushMax: 5,
  /** Upward share of a push, so a part rides over what it is shoved against. */
  pushLift: 0.22,
  /**
   * An enemy's push against the player's, and the seconds between bodies at rest that the enemies, all of them together,
   * may wake. A horde running down one lane at the player would otherwise plough every heap in it flat: measured, 150
   * kills on one spot left hips a hand's width off the floor, as before there were heaps at all. So the living jostle the
   * dead and stir a body now and then; it is the player who ploughs.
   */
  enemyPush: 0.4,
  enemyWakeEvery: 0.6,
  /** Enemies further than this from the player push nothing. */
  enemyRange: 30,
  /** A falling chain wakes the body it lands on when it hits at this speed, m/s. */
  landSpeed: 2.2,
  /** A body lies on another when its hips, or its highest point, are this far above the other's, m. */
  onTop: 0.06,
  /** What it lay on has moved this far, m: it is woken to fall. */
  slipped: 0.14,
  /** Seconds a body waits to hear what the one under it did. */
  supportWait: 4,
  /** Metres within which a settled body keeps its finest level of detail and what is under its skin. */
  nearDetail: 7,
  /**
   * The same while more bodies are drawn as characters than the setting means to draw (`crowded`): a long fight on one
   * spot, where bodies are disturbed again before they have lain long enough to be baked. Measured at Standard after 150
   * kills on one spot: 69 characters, 2.0 M triangles, nearly all of them inside 7 m of the player.
   */
  nearCrowded: 4,
  /**
   * Crowded by `bakeOver` three times over, bodies are baked after this share of `bakeAfter` at rest and twice as many a
   * look: the heap is growing faster than it is being baked.
   */
  hurry: 0.4,
  /** Seconds between looks at who is in view and who is over the caps. */
  policyEvery: 0.25,
  /** Past the cap by this many, the oldest goes even in plain sight. */
  hardOver: 12,
  /** Beyond this a body is out of sight whatever the camera says, m. */
  farAway: 70,
  /**
   * A body is baked into the far batch, or stood up out of it, where the change cannot be seen: out of the camera's
   * sight, or at least this far from it, m. Nearer and in sight it waits, unless the bodies drawn as characters are
   * `bakeOver` past their cap.
   */
  swapFar: 11,
  /** Seconds a body lies at rest before it may be baked: its pool is still spreading, a stump still beating. */
  bakeAfter: 3,
  /**
   * Characters past their cap at which the oldest is baked even in plain sight. Left at `hardOver` (12), a 150-kill
   * fight on one spot ended with 77 characters drawn at Standard, 4.2 M triangles, more than the 40 corpses of the game
   * before: the bodies never left the player's sight to be baked.
   */
  bakeOver: 4,
  /** Bodies baked in one look, and how much nearer a baked body must be than a drawn one for the two to change places, m. */
  bakesPerLook: 2,
  swapGain: 4,
  /** `?messfar=0`: nothing is baked. Past the cap for bodies drawn as characters, the oldest go as they did. */
  far: typeof location === 'undefined' || new URLSearchParams(location.search).get('messfar') !== '0',
  /** `?messpush=0`: bodies at rest are never woken by being walked into (they still heap). */
  push: typeof location === 'undefined' || new URLSearchParams(location.search).get('messpush') !== '0',
  /** `?messrest=0`: bodies at rest keep no capsules, so nothing lands on them: the flat carpet from before. */
  rest: typeof location === 'undefined' || new URLSearchParams(location.search).get('messrest') !== '0',
  /**
   * The settings' and the automatic step-down's say on the same thing (`applyLoad`, gore/load.ts): false at Mess Low, and
   * while frames are being missed on the processor. A body comes to rest with capsules only when this and `rest` are true.
   */
  heaps: true,
  /** The level's caps as the automatic step-down has cut them (`drawn`, `full`), or null: the level's own. */
  eased: null as MessBudget | null,
};

/** The caps in force. */
export const messBudget = (): MessBudget => MessTuning.eased ?? MESS[MessTuning.level];

/** A body or a limb coming to rest now leaves its capsules: the URL's switch, the setting and the step-down all agree. */
export const leavesCapsules = (): boolean => MessTuning.rest && MessTuning.heaps;

/** What mess needs to know of a body or a limb in gore's care. Gore's own classes fit it. */
export interface MessChain {
  rag: Rag | null;
  sinking: number;
  readonly stakes: readonly unknown[];
}
/** A loose limb: a chain with something drawn of its own. */
export interface MessLimb extends MessChain {
  readonly piece: { readonly root: THREE.Object3D };
  /** Its slot in the limbs' batch while it is baked, or -1 (gore/index.ts `bakeLimb`). */
  readonly slot?: number;
  /** World time it last came to rest. */
  readonly restedAt?: number;
}
export interface MessBody extends MessChain {
  readonly char: CharacterInstance;
  readonly info: RigInfo;
  down: unknown;
  vapor: number;
  freshAt: number;
  /** 0 drawn as in life, 1 settled. Mess's to write. */
  tier: number;
  /** Shadows it cast before it was settled, to give back. */
  shade: THREE.Object3D[] | null;
  /** World time before which it stays a character whatever the caps say. */
  holdUntil: number;
}

/** What gore does for mess. */
export interface MessHost {
  readonly bodies: readonly MessBody[];
  readonly limbs: readonly MessLimb[];
  /** Bodies baked into the far batch: at rest with their capsules, and no character until one is stood up. */
  readonly far: readonly MessChain[];
  /** Bakes a body at rest into the far batch. False if it cannot be. */
  bake(body: MessBody): boolean;
  /** Stands a baked body up as a character again, at rest. False if it cannot be. */
  standUp(far: MessChain): boolean;
  /** Takes a baked body out of the world at once. */
  removeFar(far: MessChain): void;
  /** Thaws a chain and keeps the ragdoll budget, as a round into a corpse does. */
  wake(target: MessChain): void;
  /** Chains simulating now. */
  simulating(): number;
  maxRagdolls(): number;
  /** Bodies kept: `GoreTuning.maxCorpses`, which the setting writes and a mission may lower. */
  maxCorpses(): number;
  /** Takes a body out of the world at once: it is out of sight. */
  remove(body: MessBody): void;
  /** Sinks a body through the floor, in sight. */
  sink(body: MessBody): void;
  /** A push landed on this chain: it is not to be frozen for its age. */
  pushed(target: MessChain): void;
  /** Loose pieces and trunk halves lying at `at` are knocked away along `vx, vz`. */
  kick(at: THREE.Vector3, radius: number, vx: number, vz: number): void;
  /** Takes a loose limb out of the world at once (out of sight), or sinks it (in sight). */
  removeLimb(limb: MessChain): void;
  sinkLimb(limb: MessChain): void;
  maxLimbs(): number;
  /**
   * Bakes a loose limb at rest into the limbs' batch, and puts one back as the piece it is. False if it cannot be (it
   * burns, it trails guts, what it carries does not fit a slot).
   */
  bakeLimb?(limb: MessLimb): boolean;
  unbakeLimb?(limb: MessLimb): boolean;
  /**
   * A chain's capsules have left the world (it woke, sank, burst), and they filled this box: loose pieces, halves and
   * strands of gut that lay on it have nothing under them now.
   */
  unsettled?(lo: THREE.Vector3, hi: THREE.Vector3): void;
}

interface Pending {
  /** The chain that lay on `under`. */
  on: MessChain;
  under: Rag;
  x: number;
  y: number;
  z: number;
  until: number;
  retries: number;
}

/** What a still skeleton needs, read off a character or a severed part without asking the library for anything. */
interface Skinned {
  root?: THREE.Object3D;
  skeleton?: THREE.Skeleton;
  bones: readonly THREE.Bone[];
}

const _v = new THREE.Vector3();
const _t = { x: 0, y: 0, z: 0 };
const _lv = { x: 0, y: 0, z: 0 };
const _frustum = new THREE.Frustum();
const _m = new THREE.Matrix4();
const _sphere = new THREE.Sphere();
const STILL = Symbol('mess.still');
type StillSkeleton = THREE.Skeleton & { [STILL]?: () => void };

/** Where a skeleton's bones are, as one number: any bone moving changes it. */
function poseSum(bones: readonly THREE.Bone[]): number {
  let sum = 0;
  for (let i = 0; i < bones.length; i++) {
    const e = bones[i]!.matrixWorld.elements;
    sum += (e[12]! + e[13]! * 1.7 + e[14]! * 2.9 + e[0]! * 0.31 + e[5]! * 0.53 + e[10]! * 0.71) * (i + 1);
  }
  return sum;
}

/**
 * A skeleton that lies still is not worked out again, and its texture is sent only when something has written to the
 * rest of it (a wound, a burn, a flash: the texels after the bones). A third of what a corpse costs the frame (M0).
 *
 * It ends by itself. Each frame it looks at where its bones are, and the moment any has moved (the body woke, is sinking,
 * or the library has given the instance to a living enemy) it is an ordinary skeleton again, on that frame. So nobody
 * who takes a body away has to remember to say so; `still: false` only does it a frame sooner.
 */
export function stillSkeleton(source: Skinned, still: boolean): void {
  const skeleton = source.skeleton as StillSkeleton | undefined;
  if (!skeleton?.boneTexture || !skeleton.boneMatrices) return;
  if (!still) {
    skeleton[STILL]?.();
    return;
  }
  if (skeleton[STILL]) return;
  const root = source.root ?? source.bones[0]?.parent ?? null;
  // Once more as it lies, so what is sent is the pose it stopped in.
  root?.updateMatrixWorld(true);
  skeleton.update();
  const data = skeleton.boneMatrices;
  const bones = skeleton.bones;
  const from = bones.length * 16;
  const pose = poseSum(bones);
  let wrote = NaN;
  let rootFrozen = false;

  const restoreRoot = (): void => {
    if (!rootFrozen || !root) return;
    rootFrozen = false;
    root.matrixAutoUpdate = true;
    delete (root as { updateMatrixWorld?: unknown }).updateMatrixWorld;
  };
  const restoreAll = (): void => {
    restoreRoot();
    if (skeleton[STILL]) {
      delete skeleton[STILL];
      delete (skeleton as { update?: unknown }).update;
    }
  };

  if (root) {
    const rx = root.position.x, ry = root.position.y, rz = root.position.z;
    const qx = root.quaternion.x, qy = root.quaternion.y, qz = root.quaternion.z, qw = root.quaternion.w;
    const sx = root.scale.x, sy = root.scale.y, sz = root.scale.z;
    const b0 = bones[0];
    const bx = b0 ? b0.position.x : 0, by = b0 ? b0.position.y : 0, bz = b0 ? b0.position.z : 0;
    const protoUpdate = THREE.Object3D.prototype.updateMatrixWorld;
    root.matrixAutoUpdate = false;
    rootFrozen = true;
    root.updateMatrixWorld = function (force?: boolean): void {
      if (
        this.position.x !== rx || this.position.y !== ry || this.position.z !== rz
        || this.quaternion.x !== qx || this.quaternion.y !== qy || this.quaternion.z !== qz || this.quaternion.w !== qw
        || this.scale.x !== sx || this.scale.y !== sy || this.scale.z !== sz
        || (b0 !== undefined && (b0.position.x !== bx || b0.position.y !== by || b0.position.z !== bz))
      ) {
        restoreRoot();
        protoUpdate.call(this, force);
        return;
      }
      if (force) protoUpdate.call(this, true);
    };
  }

  skeleton[STILL] = restoreAll;
  skeleton.update = () => {
    if (poseSum(bones) !== pose) {
      restoreAll();
      skeleton.update();
      return;
    }
    let sum = 0;
    for (let i = from; i < data.length; i++) sum += data[i]! * ((i & 7) + 1);
    if (sum === wrote) return;
    wrote = sum;
    skeleton.boneTexture!.needsUpdate = true;
  };
}

export class MessField {
  private readonly pending: Pending[] = [];
  /** Chains at rest with their capsules, oldest first. */
  private readonly rests: Rag[] = [];
  private shapes = 0;
  private wakes = 0;
  private policyAt = 0;
  /** The shadows taken from each settled limb, to give back. */
  private readonly limbShade = new Map<MessLimb, THREE.Object3D[]>();
  /** World time the enemies may next wake a body at rest. */
  private enemyWakeAt = 0;
  private readonly onUnrest = (rag: Rag): void => this.unrested(rag);
  /** Counters since the last clear, for checks and the debug overlay. */
  readonly count = { pushWakes: 0, landWakes: 0, slipWakes: 0, ghosted: 0, removed: 0, sunk: 0, baked: 0, stoodUp: 0, bakedLimbs: 0, unbakedLimbs: 0 };

  constructor(private readonly ctx: Ctx, private readonly host: MessHost) {}

  /** A chain has just frozen: its capsules are in the world. */
  rested(target: MessChain, source: Skinned): void {
    const rag = target.rag;
    stillSkeleton(source, true);
    if (!rag?.resting) return;
    rag.onUnrest = this.onUnrest;
    this.rests.push(rag);
    this.shapes += rag.restCount;
    // Over the budget for capsules, the oldest at rest is a ghost again. What lay on it is woken by `unrested`.
    while (this.shapes > MessTuning.maxShapes && this.rests.length > 1) {
      this.count.ghosted++;
      this.rests[0]!.dropRest();
    }
  }

  /** True when resting chain `top` lies on top of resting chain `bottom`. */
  private restsOn(top: Rag, bottom: Rag): boolean {
    const lo = bottom.restMin;
    const hi = bottom.restMax;
    if (top.restMin.x > hi.x || top.restMax.x < lo.x || top.restMin.z > hi.z || top.restMax.z < lo.z) return false;
    // On it, not beside it. A body draped over another still has a hand or a foot on the floor, so its lowest point
    // says nothing: it lies on this one if its hips are higher, or if some part of it reaches higher than this one does.
    if (top.restMin.y > hi.y + 0.1) return false;
    return top.center.y >= bottom.center.y + MessTuning.onTop
      || top.restMax.y >= hi.y + MessTuning.onTop
      || top.restMin.y >= lo.y + MessTuning.onTop
      || top.center.y >= lo.y + 0.22;
  }

  /** Resting chains waiting to fall, plus anything stacked transitively on top of them. */
  private shedBlocked(): Set<Rag> | null {
    if (this.pending.length === 0) return null;
    const blocked = new Set<Rag>();
    for (const p of this.pending) if (p.on.rag) blocked.add(p.on.rag);
    let grew = true;
    while (grew) {
      grew = false;
      for (const r of this.rests) {
        if (blocked.has(r)) continue;
        for (const under of blocked) {
          if (this.restsOn(r, under)) {
            blocked.add(r);
            grew = true;
            break;
          }
        }
      }
    }
    return blocked;
  }

  /**
   * Takes the capsules of up to `count` chains at rest away, the longest at rest first: they are ghosts again. For when
   * heaps are turned off under the dead already lying (the Mess setting at Low, the automatic step-down). What lay on one
   * is woken as when any support goes (`unrested`), falls, and comes to rest without capsules; so a chain that is waiting
   * to fall — or resting on top of one that is — is passed over here, or it would be left hanging where it lay. Returns
   * how many are still at rest.
   */
  shed(count: number): number {
    let blocked = this.shedBlocked();
    let done = 0;
    for (let i = 0; i < this.rests.length && done < count; i++) {
      const rag = this.rests[i]!;
      if (blocked?.has(rag)) continue;
      const beforePending = this.pending.length;
      this.count.ghosted++;
      rag.dropRest();
      done++;
      i--;
      if (this.pending.length !== beforePending) blocked = this.shedBlocked();
    }
    return this.rests.length;
  }

  /** A chain is simulating again: its skeleton is live. */
  woke(source: Skinned): void {
    stillSkeleton(source, false);
  }

  /** A chain's capsules have left the world, however that came about. Whatever lay on it will want to fall. */
  private unrested(rag: Rag): void {
    const at = this.rests.indexOf(rag);
    if (at < 0) return;
    this.rests.splice(at, 1);
    this.shapes -= rag.restCount;
    const now = this.ctx.time.elapsed;
    const t = MessTuning;
    const lo = rag.restMin;
    const hi = rag.restMax;
    this.host.unsettled?.(lo, hi);
    const all = this.host.bodies as readonly MessChain[];
    const ghosted = !leavesCapsules();
    for (let pass = 0; pass < 3; pass++) {
      const list = pass === 0 ? all : pass === 1 ? this.host.limbs : this.host.far;
      for (let i = 0; i < list.length; i++) {
        const other = list[i]!;
        const o = other.rag;
        if (!o || o === rag || o.active || other.sinking >= 0) continue;
        if (o.resting) {
          if (!this.restsOn(o, rag)) continue;
        } else if (ghosted) {
          // While heaps are off, a body that fell onto a still-resting body froze without capsules (`!o.resting`).
          // Wake it when its support sheds so it cannot stay suspended in mid-air.
          const r = o.info.reach[o.build.chainRoot] ?? 0.9;
          if (o.center.x < lo.x - r || o.center.x > hi.x + r || o.center.z < lo.z - r || o.center.z > hi.z + r) continue;
          if ((o.center.y < rag.center.y + t.onTop && o.center.y < lo.y + 0.22) || o.center.y > hi.y + 0.6) continue;
        } else continue;
        if (this.pending.length >= 192) return;
        this.pending.push({ on: other, under: rag, x: rag.center.x, y: rag.center.y, z: rag.center.z, until: now + t.supportWait, retries: 0 });
      }
    }
  }

  /** Cached simulating chain count for the current `update()`, invalidated on `wake()`. */
  private simCount = -1;

  /** May one more chain be woken this frame? `over` is how far past the ragdoll budget it may take the count. */
  private room(over: number): boolean {
    if (this.wakes >= MessTuning.wakesPerFrame) return false;
    if (this.simCount < 0) this.simCount = this.host.simulating();
    return this.simCount < this.host.maxRagdolls() + over;
  }

  private wake(target: MessChain): void {
    this.wakes++;
    this.simCount = -1;
    this.host.wake(target);
  }

  update(): void {
    this.wakes = 0;
    this.simCount = -1;
    this.settleSupports();
    if (MessTuning.push) {
      this.landings();
      this.pushers();
    }
    const now = this.ctx.time.elapsed;
    if (now >= this.policyAt) {
      this.policyAt = now + MessTuning.policyEvery;
      this.policy();
    }
  }

  /** Bodies waiting on the one they lay on: woken once it has gone or moved away, forgotten once it lies still again. */
  private settleSupports(): void {
    const now = this.ctx.time.elapsed;
    const t = MessTuning;
    const ghosted = !leavesCapsules();
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i]!;
      const on = p.on.rag;
      let drop = !on || on.active || (!on.resting && !ghosted) || p.on.sinking >= 0;
      if (!drop) {
        const u = p.under;
        const gone = !u.active && !u.resting;
        const moved = gone || Math.hypot(u.center.x - p.x, u.center.y - p.y, u.center.z - p.z) > t.slipped;
        if (moved) {
          // Falling is not optional: it may run over the budget as far as the player's own push may.
          if (!this.room(t.playerOver)) continue;
          this.wake(p.on);
          if (!on || on.active || (!on.resting && !ghosted)) {
            this.count.slipWakes++;
            drop = true;
          } else if (++p.retries >= 16) {
            drop = true;
          }
        } else if (u.resting || now > p.until) drop = true;
      }
      if (drop) {
        this.pending[i] = this.pending[this.pending.length - 1]!;
        this.pending.pop();
      }
    }
  }

  /** A chain that comes down hard on a body at rest wakes it, so the heap gives under what lands on it. */
  private landings(): void {
    const t = MessTuning;
    const bodies = this.host.bodies;
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i]!;
      const rag = b.rag;
      if (!rag?.active || b.down || !rag.thudPart || rag.thudSpeed < t.landSpeed * rag.throwScale) continue;
      if (!this.room(-t.othersUnder)) return;
      const p = rag.thudPart.p;
      let best: MessChain | null = null;
      let bestD = Infinity;
      const far = this.host.far;
      for (let k = 0; k < bodies.length + far.length; k++) {
        const o = k < bodies.length ? bodies[k]! : far[k - bodies.length]!;
        const r = o.rag;
        if (o === b || !r?.resting || o.sinking >= 0) continue;
        if (p.x < r.restMin.x - 0.1 || p.x > r.restMax.x + 0.1 || p.z < r.restMin.z - 0.1 || p.z > r.restMax.z + 0.1) continue;
        if (p.y < r.restMin.y - 0.1 || p.y > r.restMax.y + 0.3) continue;
        const d = r.center.distanceToSquared(p);
        if (d < bestD) {
          bestD = d;
          best = o;
        }
      }
      if (best) {
        this.count.landWakes++;
        this.wake(best);
      }
    }
  }

  /** The player, and the living near the player, shove what they walk into. */
  private pushers(): void {
    const { player, enemies } = this.ctx;
    const t = MessTuning;
    if (player?.alive === true && player.position?.isVector3 === true) {
      this.pushFrom(player.position, player.velocity, 0.45 + t.reach, 1.8, 1, t.playerOver);
      // What is small enough to kick is kicked by the player alone: an enemy's feet are not watched that closely.
      const v = player.velocity;
      if (v.x * v.x + v.z * v.z > 1) this.host.kick(player.position, 0.45 + t.reach, v.x, v.z);
    }
    const alive = enemies?.alive;
    if (!Array.isArray(alive) || player?.position?.isVector3 !== true) return;
    const range2 = t.enemyRange * t.enemyRange;
    for (let i = 0; i < alive.length; i++) {
      const e = alive[i]! as unknown as { position: THREE.Vector3; velocity: THREE.Vector3; def?: { radius?: number }; char?: CharacterInstance };
      if (!e.position || !e.velocity) continue;
      if (e.position.distanceToSquared(player.position) > range2) continue;
      // One that stands still shoves nothing, and one that is down is a body itself.
      if (e.velocity.x * e.velocity.x + e.velocity.z * e.velocity.z < 0.36) continue;
      if (e.char && this.ctx.gore.downed?.(e.char)) continue;
      this.pushFrom(e.position, e.velocity, (e.def?.radius ?? 0.45) + t.reach, 1.7, t.enemyPush, -t.othersUnder, true);
    }
  }

  /**
   * One pusher: a standing cylinder at `at` (feet), `radius` wide and `height` tall, moving at `vel`. Chains at rest that it
   * has walked into are woken (if the budgets allow), and every part of a simulating chain inside it is given speed away
   * from its axis, one way only: a push can add speed up to a ceiling and never take any, so nothing can be squeezed into
   * flying.
   */
  private pushFrom(at: THREE.Vector3, vel: THREE.Vector3, radius: number, height: number, strength: number, over: number, enemy = false): void {
    const t = MessTuning;
    const speed = Math.hypot(vel.x, vel.z);
    const bodies = this.host.bodies as readonly MessChain[];
    let canWake = speed >= 0.5 && (!enemy || this.ctx.time.elapsed >= this.enemyWakeAt) && this.room(over);
    // Pass 2 (`host.far`) holds only resting baked bodies; skip it entirely when this pusher cannot wake anything.
    const passes = canWake ? 3 : 2;
    for (let pass = 0; pass < passes; pass++) {
      if (pass === 2 && !canWake) break;
      const list = pass === 0 ? bodies : pass === 1 ? this.host.limbs : this.host.far;
      const reverse = pass === 2;
      for (let i = reverse ? list.length - 1 : 0; reverse ? i >= 0 : i < list.length; reverse ? i-- : i++) {
        const target = list[i]!;
        const rag = target.rag;
        if (!rag || target.sinking >= 0) continue;
        if (!rag.active && !canWake) continue;
        if (pass === 0 && ((target as MessBody).down || (target as MessBody).vapor >= 0)) continue;
        const c = rag.center;
        const reach = rag.info.reach[rag.build.chainRoot]! + radius;
        const dx = c.x - at.x;
        const dz = c.z - at.z;
        if (dx * dx + dz * dz > reach * reach || c.y < at.y - 2.5 || c.y > at.y + height + 2.5) continue;
        let shoveTarget = target;
        if (!rag.active) {
          // At rest it takes someone moving to wake it: standing on a heap does not stir it.
          if (target.stakes.length > 0 || !rag.resting) continue;
          const lo = rag.restMin;
          const hi = rag.restMax;
          if (hi.y < at.y - 0.05 || lo.y > at.y + height) continue;
          const nx = Math.max(lo.x, Math.min(at.x, hi.x)) - at.x;
          const nz = Math.max(lo.z, Math.min(at.z, hi.z)) - at.z;
          if (nx * nx + nz * nz > radius * radius) continue;
          if (!this.touches(rag, at, radius, height) || !this.room(over)) continue;
          if (enemy) this.enemyWakeAt = this.ctx.time.elapsed + t.enemyWakeEvery;
          this.count.pushWakes++;
          this.wake(target);
          canWake = (!enemy || this.ctx.time.elapsed >= this.enemyWakeAt) && this.room(over);
          if (!rag.active) continue;
          if (pass === 2) {
            shoveTarget = (bodies[0]?.rag === rag ? bodies[0] : bodies.find(b => b.rag === rag)) ?? target;
          }
        }
        this.shove(shoveTarget, rag, at, vel, speed, radius, height, strength);
      }
    }
  }

  /** Does the pusher's cylinder reach any part of this chain at rest? The box said maybe. */
  private touches(rag: Rag, at: THREE.Vector3, radius: number, height: number): boolean {
    // Where its capsules lie, not its bones: a baked body has no bones until it is stood up again.
    const p = rag.restPoints;
    const r = radius + 0.14;
    for (let i = 0; i < p.length; i += 3) {
      const dx = p[i]! - at.x;
      const dz = p[i + 2]! - at.z;
      if (dx * dx + dz * dz < r * r && p[i + 1]! > at.y - 0.15 && p[i + 1]! < at.y + height) return true;
    }
    return false;
  }

  private shove(target: MessChain, rag: Rag, at: THREE.Vector3, vel: THREE.Vector3, speed: number, radius: number, height: number, strength: number): void {
    const t = MessTuning;
    let any = false;
    const scale = rag.throwScale;
    for (let k = 0; k < rag.parts.length; k++) {
      const part = rag.parts[k]!;
      const p = part.body.translation(_t as never) as unknown as { x: number; y: number; z: number };
      if (p.y < at.y - 0.2 || p.y > at.y + height) continue;
      let dx = p.x - at.x;
      let dz = p.z - at.z;
      const d = Math.hypot(dx, dz);
      const r = radius + 0.1;
      if (d > r) continue;
      if (d > 1e-3) {
        dx /= d;
        dz /= d;
      } else if (speed > 0.1) {
        dx = vel.x / speed;
        dz = vel.z / speed;
      } else continue;
      // How fast the pusher is closing on the part. Walking away from it pushes nothing.
      const closing = vel.x * dx + vel.z * dz;
      const depth = 1 - d / r;
      if (closing <= 0 && depth < 0.35) continue;
      const want = Math.min(t.pushMax, (t.pushBase * depth + t.pushPerSpeed * Math.max(closing, 0)) * strength) * scale;
      const lv = part.body.linvel(_lv as never) as unknown as { x: number; y: number; z: number };
      const have = lv.x * dx + lv.z * dz;
      if (have >= want) continue;
      const j = (want - have) * part.mass;
      _v.set(dx * j, j * t.pushLift, dz * j);
      part.body.applyImpulse(_v, true);
      any = true;
    }
    if (any) {
      rag.pushed = true;
      rag.invalidateVelocity();
      this.host.pushed(target);
    }
  }

  /** Who is settled, and who is over the cap: the oldest out of sight goes first, and one in sight only far past it. */
  private policy(): void {
    const budget = messBudget();
    const bodies = this.host.bodies;
    const cam = this.ctx.render?.camera;
    const seen = cam?.isPerspectiveCamera === true;
    if (seen) _frustum.setFromProjectionMatrix(_m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    let corpses = 0;
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i]!;
      if (b.sinking < 0 && !b.down) corpses++;
    }
    // Newest first: the last `full` of them are drawn as in life.
    let rank = 0;
    for (let i = bodies.length - 1; i >= 0; i--) {
      const b = bodies[i]!;
      if (b.sinking >= 0 || b.down || b.vapor >= 0) continue;
      rank++;
      const want = rank <= budget.full ? 0 : 1;
      if (want === b.tier) continue;
      // Settling a body in plain sight takes its shadow from under it: it waits until nobody is looking, or until twice
      // as many are full as should be.
      if (want === 1 && (b.rag?.active || (seen && rank <= budget.full * 2 && this.inView(b)))) continue;
      this.setTier(b, want);
    }
    this.crowd = MessTuning.far ? corpses - budget.drawn : 0;
    this.limbPolicy(seen);
    if (MessTuning.far) this.farPolicy(budget, corpses, seen);
    const far = this.host.far;
    let liveBodies = 0;
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i]!;
      if (b.sinking < 0 && !b.down && b.vapor < 0) liveBodies++;
    }
    let liveFar = 0;
    for (let i = 0; i < far.length; i++) if (far[i]!.sinking < 0) liveFar++;
    let over = liveBodies + liveFar - this.host.maxCorpses();
    if (over <= 0) return;
    // The baked ones are the oldest of all: out of sight, they go first.
    for (let i = 0; i < far.length && over > 0; i++) {
      const f = far[i]!;
      if (f.sinking >= 0 || (seen && this.sees(f.rag!.center, f.rag!.info.reach[0]! + 0.2))) continue;
      this.count.removed++;
      this.host.removeFar(f);
      i--;
      over--;
    }
    for (let i = 0; i < bodies.length && over > 0; i++) {
      const b = bodies[i]!;
      if (b.sinking >= 0 || b.down || b.vapor >= 0) continue;
      if (!seen || this.inView(b)) continue;
      this.count.removed++;
      this.host.remove(b);
      // `remove` took it out of the list.
      i--;
      over--;
    }
    // In sight, the oldest go only far past the cap (or always, where there is no camera to ask: a test).
    // Evict oldest baked far bodies before sinking drawn bodies so far batches cannot pin the cap forever.
    over -= seen ? MessTuning.hardOver : 0;
    for (let i = 0; i < far.length && over > 0; i++) {
      const f = far[i]!;
      if (f.sinking >= 0) continue;
      this.count.removed++;
      this.host.removeFar(f);
      i--;
      over--;
    }
    for (let i = 0; i < bodies.length && over > 0; i++) {
      const b = bodies[i]!;
      if (b.sinking >= 0 || b.down || b.vapor >= 0) continue;
      this.count.sunk++;
      this.host.sink(b);
      over--;
    }
  }

  /**
   * Which bodies are characters and which are baked. Past `drawn` characters the oldest settled ones are baked, where the
   * change cannot be seen. With room to draw more, the nearest baked body is stood up. And the two change places as the
   * player moves, so that the bodies nearest are the ones drawn in full.
   */
  private farPolicy(budget: MessBudget, corpses: number, seen: boolean): void {
    const t = MessTuning;
    const now = this.ctx.time.elapsed;
    const bodies = this.host.bodies;
    const far = this.host.far;
    const eye = seen ? this.ctx.render.camera.position : this.ctx.player?.position;
    if (eye?.isVector3 !== true) return;
    const hidden = (at: THREE.Vector3, radius: number): boolean => !seen || !this.sees(at, radius) || at.distanceToSquared(eye) > t.swapFar * t.swapFar;
    // The settled body furthest off that may be baked, and the baked one nearest.
    let out: MessBody | null = null;
    let outD = -1;
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i]!;
      if (!this.bakeable(b, now)) continue;
      const d = b.rag!.center.distanceToSquared(eye);
      if (d > outD) {
        outD = d;
        out = b;
      }
    }
    let near: MessChain | null = null;
    let nearD = Infinity;
    for (let i = 0; i < far.length; i++) {
      const f = far[i]!;
      if (f.sinking >= 0) continue;
      const d = f.rag!.center.distanceToSquared(eye);
      if (d < nearD) {
        nearD = d;
        near = f;
      }
    }
    if (corpses > budget.drawn) {
      // Over: the oldest that nobody can see change, a couple a look. Far past the cap, the oldest whoever is looking.
      let left = this.hurried ? t.bakesPerLook * 2 : t.bakesPerLook;
      for (let pass = 0; pass < 2 && left > 0; pass++) {
        if (pass === 1 && corpses <= budget.drawn + t.bakeOver) break;
        for (let i = 0; i < bodies.length && left > 0 && corpses > budget.drawn; i++) {
          const b = bodies[i]!;
          if (!this.bakeable(b, now) || (pass === 0 && !hidden(b.rag!.center, b.info.reach[0]! + 0.2))) continue;
          if (!this.host.bake(b)) continue;
          this.count.baked++;
          i--;
          corpses--;
          left--;
        }
      }
      return;
    }
    if (!near) return;
    const nearHidden = hidden(near.rag!.center, near.rag!.info.reach[0]! + 0.2);
    if (corpses < budget.drawn - 1) {
      if (nearHidden && this.host.standUp(near)) this.count.stoodUp++;
      return;
    }
    // Full: the nearest baked body takes the place of the furthest drawn one, if it is much the nearer.
    if (out && nearHidden && Math.sqrt(outD) > Math.sqrt(nearD) + t.swapGain && hidden(out.rag!.center, out.info.reach[0]! + 0.2)) {
      if (this.host.bake(out) && this.host.standUp(near)) this.count.stoodUp++;
    }
  }

  /** May this body be baked now? Settled, at rest long enough, with nothing holding it. */
  private bakeable(b: MessBody, now: number): boolean {
    return b.tier > 0 && b.sinking < 0 && !b.down && b.vapor < 0 && b.stakes.length === 0 && b.rag !== null && !b.rag.active
      && now - b.freshAt >= MessTuning.bakeAfter * (this.hurried ? MessTuning.hurry : 1) && now >= b.holdUntil;
  }

  /** Bodies drawn as characters past the number the setting means to draw, as of the last look. */
  private crowd = 0;
  /** More characters than the setting means to draw: settled ones keep their finest detail only close to. */
  get crowded(): boolean {
    return this.crowd > 0;
  }
  private get hurried(): boolean {
    return this.crowd > MessTuning.bakeOver * 3;
  }

  /** A baked body is a character again: settled as it was, and its skeleton still. */
  stoodUp(b: MessBody, source: Skinned): void {
    this.setTier(b, 1);
    stillSkeleton(source, true);
  }

  /** Loose limbs past their cap: out of sight first and at once, in sight they sink, oldest first. */
  private limbPolicy(seen: boolean): void {
    const limbs = this.host.limbs;
    let n = 0;
    for (let i = 0; i < limbs.length; i++) if (limbs[i]!.sinking < 0) n++;
    // All but the newest few at rest cast no shadow of their own, as settled bodies do not: forty-eight limbs were 198
    // draws, half of them shadows.
    const full = messBudget().full;
    for (let i = limbs.length - 1, rank = 0; i >= 0; i--) {
      const l = limbs[i]!;
      if (l.sinking >= 0) continue;
      rank++;
      const settle = rank > full && l.rag !== null && !l.rag.active;
      if (settle === this.limbShade.has(l)) continue;
      if (settle) {
        const shade: THREE.Object3D[] = [];
        l.piece.root.traverse(o => {
          if (!o.castShadow) return;
          o.castShadow = false;
          shade.push(o);
        });
        this.limbShade.set(l, shade);
      } else this.forgetLimb(l);
    }
    this.limbBatch(seen);
    let over = n - this.host.maxLimbs();
    for (let i = 0; i < limbs.length && over > 0 && seen; i++) {
      const l = limbs[i]!;
      if (l.sinking >= 0 || !l.rag || l.rag.active || this.sees(l.rag.center, 1)) continue;
      this.host.removeLimb(l);
      i--;
      over--;
    }
    for (let i = 0; i < limbs.length && over > 0; i++) {
      const l = limbs[i]!;
      if (l.sinking >= 0) continue;
      this.host.sinkLimb(l);
      over--;
    }
  }

  /**
   * Which loose limbs at rest are drawn as themselves and which are baked into the limbs' batch (far.ts): forty-eight
   * limbs lying about were 158 draws and 0.6 M triangles, more than every baked body together. One further than
   * `swapFar` is baked as soon as it has lain `bakeAfter`. Nearer, the newest `limbsDrawn` stay themselves and the rest
   * are baked furthest first, out of sight before in it (and in it only `bakeOver` past the number). A baked limb the
   * player has come near to is put back when nobody is looking and there is room. With no camera to ask (a test), the
   * count alone decides.
   */
  private limbBatch(seen: boolean): void {
    const host = this.host;
    if (!MessTuning.far || !host.bakeLimb || !host.unbakeLimb) return;
    const t = MessTuning;
    const limbs = host.limbs;
    const now = this.ctx.time.elapsed;
    const eye = seen ? this.ctx.render.camera.position : null;
    const far2 = t.swapFar * t.swapFar;
    const budget = messBudget().limbsDrawn;
    let drawn = 0;
    for (let i = 0; i < limbs.length; i++) {
      const l = limbs[i]!;
      if (l.sinking < 0 && (l.slot ?? -1) < 0 && l.rag && !l.rag.active) drawn++;
    }
    let left = t.bakesPerLook * 2;
    // Far off: any time.
    for (let i = 0; i < limbs.length && left > 0 && eye; i++) {
      const l = limbs[i]!;
      if (!this.limbBakeable(l, now) || this.limbRefused.has(l) || l.rag!.center.distanceToSquared(eye) < far2) continue;
      if (!host.bakeLimb(l)) {
        this.limbRefused.add(l);
        continue;
      }
      this.count.bakedLimbs++;
      drawn--;
      left--;
    }
    // Over the number drawn: the furthest that nobody can see change, then the furthest whoever is looking.
    for (let pass = 0; pass < 2 && left > 0; pass++) {
      const over = drawn - budget - (pass === 1 && eye ? t.bakeOver : 0);
      for (let k = 0; k < over && left > 0; k++) {
        let pick: MessLimb | null = null;
        let pickD = -1;
        for (let i = 0; i < limbs.length; i++) {
          const l = limbs[i]!;
          if (!this.limbBakeable(l, now) || this.limbRefused.has(l)) continue;
          if (pass === 0 && eye && this.sees(l.rag!.center, 0.6)) continue;
          // With no camera the oldest go first: the list is in the order they were cut.
          const d = eye ? l.rag!.center.distanceToSquared(eye) : limbs.length - i;
          if (d > pickD) {
            pickD = d;
            pick = l;
          }
        }
        if (!pick) break;
        if (host.bakeLimb(pick)) {
          this.count.bakedLimbs++;
          drawn--;
        } else this.limbRefused.add(pick);
        left--;
      }
    }
    // Come near to, a baked limb is itself again: where the change cannot be seen, one a look.
    if (!eye || drawn >= budget) return;
    const near = (t.swapFar - t.swapGain) * (t.swapFar - t.swapGain);
    for (let i = limbs.length - 1; i >= 0; i--) {
      const l = limbs[i]!;
      if ((l.slot ?? -1) < 0 || l.sinking >= 0 || !l.rag) continue;
      if (l.rag.center.distanceToSquared(eye) > near || this.sees(l.rag.center, 0.6)) continue;
      if (host.unbakeLimb(l)) this.count.unbakedLimbs++;
      break;
    }
  }

  /** Limbs the batch would not take (what they carry does not fit): not asked again. */
  private readonly limbRefused = new WeakSet<MessLimb>();

  private limbBakeable(l: MessLimb, now: number): boolean {
    return l.sinking < 0 && (l.slot ?? -1) < 0 && l.rag !== null && !l.rag.active && l.stakes.length === 0
      && now - (l.restedAt ?? now) >= MessTuning.bakeAfter;
  }

  /** Could the camera see a sphere there? Only as fresh as the last look (`policyEvery`). True with no camera to ask. */
  sees(at: THREE.Vector3, radius: number): boolean {
    const cam = this.ctx.render?.camera;
    if (cam?.isPerspectiveCamera !== true) return true;
    if (at.distanceToSquared(cam.position) > MessTuning.farAway * MessTuning.farAway) return false;
    _sphere.center.copy(at);
    _sphere.radius = radius;
    return _frustum.intersectsSphere(_sphere);
  }

  /** Could the camera see this body? Its hips, and a sphere that holds it in any pose. */
  inView(b: MessBody): boolean {
    const e = b.char.bones[0]!.matrixWorld.elements;
    _sphere.center.set(e[12]!, e[13]!, e[14]!);
    _sphere.radius = b.info.reach[0]! + 0.2;
    const cam = this.ctx.render.camera;
    if (_sphere.center.distanceToSquared(cam.position) > MessTuning.farAway * MessTuning.farAway) return false;
    return _frustum.intersectsSphere(_sphere);
  }

  /** Tier 1, settled: no shadow of its own. Its level of detail is `lodFor`. */
  private setTier(b: MessBody, tier: number): void {
    b.tier = tier;
    if (tier > 0) {
      if (b.shade) return;
      const shade: THREE.Object3D[] = [];
      b.char.root.traverse(o => {
        if (!o.castShadow) return;
        o.castShadow = false;
        shade.push(o);
      });
      b.shade = shade;
    } else this.unshade(b);
  }

  private unshade(b: MessBody): void {
    if (!b.shade) return;
    for (const o of b.shade) o.castShadow = true;
    b.shade = null;
  }

  /** A limb is leaving the world, or is to be drawn in full again: its shadows are given back. */
  forgetLimb(l: MessLimb): void {
    const shade = this.limbShade.get(l);
    if (!shade) return;
    for (const o of shade) o.castShadow = true;
    this.limbShade.delete(l);
  }

  /** A body is leaving gore's care: it is given back as it was lent. */
  forget(b: MessBody): void {
    this.unshade(b);
    b.tier = 0;
    stillSkeleton(b.char as unknown as Skinned, false);
  }

  /** The level of detail a dead body is drawn at, from how far off it is: a settled one steps down sooner. */
  lodFor(b: MessBody, distance: number, near: number, far: number): number {
    if (b.tier > 0 && !b.rag?.active) return distance < (this.crowd > 0 ? MessTuning.nearCrowded : MessTuning.nearDetail) ? 0 : distance < far ? 1 : 2;
    return distance < near ? 0 : distance < far ? 1 : 2;
  }

  clear(): void {
    this.pending.length = 0;
    this.rests.length = 0;
    this.shapes = 0;
    this.policyAt = 0;
    this.enemyWakeAt = 0;
    this.crowd = 0;
    for (const l of [...this.limbShade.keys()]) this.forgetLimb(l);
    this.count.pushWakes = this.count.landWakes = this.count.slipWakes = this.count.ghosted = this.count.removed = this.count.sunk = this.count.baked = this.count.stoodUp = this.count.bakedLimbs = this.count.unbakedLimbs = 0;
  }

  stats(): { resting: number; shapes: number; waiting: number; settled: number } & MessField['count'] {
    let settled = 0;
    for (const b of this.host.bodies) if (b.tier > 0) settled++;
    return { resting: this.rests.length, shapes: this.shapes, waiting: this.pending.length, settled, ...this.count };
  }
}
