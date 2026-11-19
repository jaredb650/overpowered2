/**
 * Fire on bodies. One list of everything alight or smouldering: the living (fed each frame by whoever keeps them
 * burning), corpses, and limbs cut from either. It is what makes fire finish the job: flames come off the whole body
 * and not one point on the chest, a corpse burns on for seconds and blackens the rest of the way, then smoulders for
 * half a minute with a fading glow in its cracks, and it leaves soot under it and not a red pool.
 *
 * Nothing here hurts anything: it is the look. Each screen runs its own from the same facts (burning is a synced status,
 * a death by fire arrives as its damage type), so nothing of it goes on the wire.
 *
 * Cost is held by caps: `max` things at once, the nearest `near` at the full rate, a budget of licks a second over all
 * of them, and a light and a shimmer for the nearest few only.
 */
import * as THREE from 'three';
import { CG, type CharacterInstance, type Ctx, type RayHit, type SeveredLimb } from '../core/contracts';
import { clamp, rand } from '../core/math';
import { DevFlags } from '../core/devflags';
import type { RigDef } from '../characters/rig';
import type { Rag } from './rag';
import { CAP_STRIDE, MAX_BONES, rigInfo, type RigInfo } from './rigInfo';

export const FireTuning = {
  /** Bodies and limbs alight or smouldering at once. A new fire past it takes the place of the coldest. */
  max: 40,
  /** Seconds a corpse burns on after death, and a limb. */
  corpseBurn: [5, 8] as readonly [number, number],
  limbBurn: [3, 5] as readonly [number, number],
  /** The last share of that in which the flames die down. */
  dieDown: 0.4,
  /** Seconds it smoulders once the flames are out. A man whose fire went out while he lived smokes for `putOut`. */
  smoulder: 30,
  putOut: 3,
  /** Licks of flame a second off a whole man at full heat. */
  rate: 26,
  /** The nearest this many burn at the full rate, the rest at `farRate` of it. */
  near: 6,
  farRate: 0.45,
  /** Licks a second over everything. Past it every fire thins alike. */
  budget: 300,
  /** The nearest this many throw a flickering light on what is round them, and a heat shimmer. */
  lights: 3,
  shimmers: 3,
  /** Candela and metres of that light at full heat on a man-sized body. */
  light: [2.6, 4.6] as readonly [number, number],
  lightRadius: 6.5,
  /** Char past which a body leaves soot and not blood where it comes to rest. */
  sootFrom: 0.5,
  /** Seconds without being fed before a living body's fire is taken to be out. */
  hold: 0.2,
  /**
   * A burning corpse draws up as it chars: elbows and knees bend, the thighs come up, the back rounds (the heat shortens
   * the muscles). `curl` is how far, 0..1; it happens over the first `curlBy` of the corpse's burning and is held `curlHold`
   * of it more so the limbs arrive, by joint drives of `curlDrive`; the nearest `curls` burning corpses do it, the rest lie
   * as they fell. Radians: elbow, knee, hip, spine.
   */
  curl: 1,
  curlBy: 0.55,
  curlDrive: 0.9,
  curlHold: 0.2,
  curls: 4,
  curlPose: { elbow: 2, knee: 1.25, hip: 0.75, spine: 0.3 },
  /**
   * The fire burns through the skin (F2; `setBurnThrough`, drawn by the skin shader). Alive, once the char is past
   * `eatFrom`, by `eatAlive` a second up to `eatAliveMax`: patches of bared muscle on a man who has burned for some seconds.
   * A corpse goes on to `eatMax` over its burning: muscle over most of it and bone where the fire caught.
   */
  eatFrom: 0.8,
  eatAlive: 0.09,
  eatAliveMax: 0.4,
  eatMax: 0.75,
};

const enum Phase { Alive, Corpse, Smoulder }

/**
 * The instance colour that says how burnt a rigid piece of a body is, 0..1: white is not at all. Plain materials (loose
 * meat, a cut face) are simply darkened by it; the skin's own material reads the char back out of it and burns the piece
 * as it burns a body (characters/material.ts, "a rigid piece of a burnt body"). `vary` breaks a heap of them up.
 */
export function burnTint(out: THREE.Color, burn: number, vary = 0): THREE.Color {
  const k = clamp(burn) * (1 - vary * Math.random());
  return out.setRGB(1 - k * 0.94, 1 - k * 0.95, 1 - k * 0.95);
}

/**
 * A rigid piece of a body that burns: a blade's half, a piece of a burst trunk (sliced.ts). It has no bones, so its flames
 * come off its own box, and its char is its own to draw (`setBurn`).
 */
export interface BurningPiece {
  /** The mesh. Out of the scene, its fire is over. */
  readonly root: THREE.Object3D;
  /** 0..1 char, as a body's. */
  readonly burn: number;
  setBurn(amount: number): void;
  /** Its box, in the mesh's own frame. */
  readonly min: THREE.Vector3;
  readonly max: THREE.Vector3;
}

/**
 * What is left of a fire while its body is baked into the far batch (far.ts): a baked body has no skin to char or glow, so
 * its entry only smokes, from the points it lies at, and is handed back to the body when it is stood up again.
 */
export class ParkedFire {
  readonly root: THREE.Object3D;
  burn = 1;
  constructor(root: THREE.Object3D, readonly points: Float32Array) {
    this.root = root;
  }
}

/** What can burn: a body, a limb cut from one, a rigid piece of one, or a baked body's parked fire. */
type Burnable = CharacterInstance | SeveredLimb | BurningPiece | ParkedFire;
type Skinned = CharacterInstance | SeveredLimb;
const isPiece = (s: Burnable): s is BurningPiece => (s as BurningPiece).min !== undefined;

class Fire {
  live = false;
  source: Burnable | null = null;
  /** The body, when it is one: a corpse is only ours while gore has it. */
  body: CharacterInstance | null = null;
  info: RigInfo | null = null;
  scale = 1;
  phase: Phase = Phase.Alive;
  fedAt = 0;
  since = 0;
  /** Seconds this phase lasts: the corpse's burning, then its smouldering. */
  lasts = 0;
  charFrom = 0;
  fireproof = false;
  /** It is dead: a corpse or a limb. Only those burn on by themselves. */
  dead = false;
  /** 0..1, the flames now. */
  heat = 1;
  /** Among the nearest, so at the full rate. */
  near = true;
  acc = 0;
  smokeAcc = 0;
  nextLight = 0;
  nextShimmer = 0;
  nextGlow = 0;
  nextSpit = 0;
  scorched = false;
  scorchTries = 0;
  nextScorch = 0;
  dist2 = 0;
  readonly at = new THREE.Vector3();
  /** Capsules of the rig still on it, and the running total of their weights. */
  readonly caps = new Uint8Array(MAX_BONES);
  readonly weights = new Float32Array(MAX_BONES);
  capCount = 0;
  /** Its share of a whole body of its rig, by skin, times the square of that body's size: 1 is a whole man. */
  amount = 1;
  /** 0..1, how far the fire has burnt through its skin, and where that stood when it died. */
  eaten = 0;
  eatenFrom = 0;
  /** 0..1, how far the heat has drawn this corpse up, and whether it is one of the few still doing so. */
  curl = 0;
  curling = false;
  /** A rigid piece: flames come off its box, not off capsules. */
  piece: BurningPiece | null = null;
  /** A baked body: smoke comes off the points it lies at. */
  parked: ParkedFire | null = null;
}

const _p = new THREE.Vector3();
const _o = new THREE.Vector3();
const _down = new THREE.Vector3(0, -1, 0);
const _up = new THREE.Vector3(0, 1, 0);
const _hit: RayHit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0, surface: 'concrete', collider: null };
const LIGHT = 0xff7a30;
const X_AXIS = new THREE.Vector3(1, 0, 0);

/** The skin of a whole body of this rig, in the measure `FireField.measure` weighs capsules by. */
const skins = new WeakMap<RigInfo, number>();
function wholeSkin(info: RigInfo): number {
  let total = skins.get(info);
  if (total === undefined) {
    total = 0;
    for (let c = 0; c < info.capCount; c++) total += capSkin(info, c);
    skins.set(info, total);
  }
  return total || 1;
}

function capSkin(info: RigInfo, c: number): number {
  const o = c * CAP_STRIDE;
  const caps = info.caps;
  const r = caps[o + 6]!;
  return (Math.hypot(caps[o + 3]! - caps[o]!, caps[o + 4]! - caps[o + 1]!, caps[o + 5]! - caps[o + 2]!) + 2 * r) * r;
}

/**
 * The way a body or a limb lies along the floor, as the turn about up that a decal's long axis takes (render/Decals.ts
 * `lay`): from its first bone to its last. Anything with no bones lies no particular way.
 */
function lieOf(source: Burnable): number {
  const bones = (source as Skinned).bones;
  if (!bones || bones.length < 2) return rand(0, Math.PI * 2);
  const a = bones[0]!.matrixWorld.elements;
  // The head end of a body, the far end of a limb: bone 1 onward are its chain, and the first far enough off will do.
  for (let i = bones.length - 1; i > 0; i--) {
    const b = bones[i]!.matrixWorld.elements;
    const dx = b[12]! - a[12]!, dz = b[14]! - a[14]!;
    if (dx * dx + dz * dz > 0.04) return Math.atan2(dx, dz);
  }
  return rand(0, Math.PI * 2);
}

export class FireField {
  private readonly fires: Fire[] = Array.from({ length: FireTuning.max }, () => new Fire());
  private readonly by = new Map<Burnable, Fire>();
  /** Licks drawn in the last frame, for the checks. */
  licks = 0;
  /** Which of an entry's capsules `pointOn` last chose. */
  private lastCap = 0;

  /**
   * @param isCorpse True while gore has this body as a corpse: dead, not being vaporized, not handed back.
   * @param ragOf That corpse's ragdoll while it is still simulated, for the heat's curl.
   */
  constructor(
    private readonly ctx: Ctx,
    private readonly isCorpse: (char: CharacterInstance) => boolean,
    private readonly ragOf: (char: CharacterInstance) => Rag | null = () => null,
  ) {}

  /**
   * The heat is still drawing this corpse up: gore keeps its ragdoll awake until it is done, and then freezes it as it
   * lies, which is what holds the pose.
   */
  curling(char: CharacterInstance): boolean {
    return this.by.get(char)?.curling === true;
  }

  /**
   * Draws a burning corpse's limbs up by `f.curl`, through its own joint muscles: each named joint is given a flexed
   * target and a share of drive. Flesh humanoids only: the names are the humanoid rig's, and anything else has none of them.
   */
  private drawUp(f: Fire): void {
    const rag = f.body ? this.ragOf(f.body) : null;
    if (!rag?.active) {
      f.curling = false;
      return;
    }
    const t = FireTuning;
    const pose = t.curlPose;
    const bones = f.info!.rig.bones;
    const drive = f.curl * t.curlDrive;
    for (const c of rag.parts) {
      const m = c.muscle;
      if (!c.parent || !m || m.broken) continue;
      const name = bones[c.bone]!.name;
      if (name.startsWith('foreArm')) m.pose.setFromAxisAngle(m.hingeAxis, clamp(-pose.elbow * f.curl, m.lo, m.hi));
      else if (name.startsWith('shin')) m.pose.setFromAxisAngle(m.hingeAxis, clamp(pose.knee * f.curl, m.lo, m.hi));
      else if (name.startsWith('thigh')) m.pose.setFromAxisAngle(X_AXIS, -pose.hip * f.curl);
      else if (name === 'spine' || name === 'chest') m.pose.setFromAxisAngle(X_AXIS, pose.spine * f.curl);
      else if (name.startsWith('upperArm') && m.hasRelax) m.pose.copy(m.relax);
      else continue;
      m.drive = Math.max(m.drive, drive);
    }
    // A body at rest is asleep, and a sleeping chain's muscles are not stepped.
    for (const c of rag.parts) if (c.body.isSleeping()) c.body.wakeUp();
  }

  /** A living body is alight this frame. Call it every frame it burns. */
  feed(char: CharacterInstance, fireproof = false): void {
    if (!DevFlags.fire) return;
    let f = this.by.get(char) ?? null;
    if (!f) {
      f = this.take(char, char, char.rig, fireproof);
      if (!f) return;
      // Lit by something with no point of its own (a patch he stood in, the man beside him): it catches somewhere on him.
      // A flame that struck him has already said where (`setBurnOrigin` keeps the first).
      if (f.capCount > 0 && char.setBurnOrigin) {
        this.pointOn(f, _p);
        char.setBurnOrigin(f.info!.capBone[f.caps[this.lastCap]!]!, _p);
      }
    } else if (f.phase !== Phase.Alive) {
      // Lit again while it smoked.
      f.phase = Phase.Alive;
      f.heat = 1;
    }
    f.fedAt = this.ctx.time.elapsed;
  }

  /**
   * It died burning or by fire: the corpse burns on, blackens the rest of the way, then smoulders. Call it before the
   * body is handed over (`ragdoll`, `collapse`, `gib`...), so a limb or a piece thrown off by that death burns too.
   */
  burnOn(char: CharacterInstance, fireproof = false): void {
    if (!DevFlags.fire) return;
    const f = this.by.get(char) ?? this.take(char, char, char.rig, fireproof);
    if (!f) return;
    this.toCorpse(f, FireTuning.corpseBurn);
  }

  /**
   * A limb has just come off `char`, with its skin as the body's was. If the body is burning or smoking the limb goes on
   * doing so; and the body's own flames stop coming from what it lost.
   */
  split(char: CharacterInstance, piece: SeveredLimb, onPiece: Uint8Array): void {
    const from = this.by.get(char);
    if (!from) return;
    this.measure(from, null);
    const f = this.take(piece, null, char.rig, from.fireproof, onPiece);
    if (!f) return;
    f.heat = from.heat;
    if (from.phase === Phase.Smoulder) {
      f.phase = Phase.Smoulder;
      f.since = from.since;
      f.lasts = from.lasts;
      f.charFrom = piece.burn ?? 0;
    } else {
      this.toCorpse(f, FireTuning.limbBurn);
    }
  }

  /**
   * A rigid piece has just been cut or broken from `char` (a blade's half, a piece of a burst trunk), drawn with the
   * body's char. If the body is burning or smoking, the piece goes on doing so: a body cut in two while it burns is two
   * burning halves. `share` is how much of the body's fire it takes, 0..1.
   */
  pieceOf(char: CharacterInstance, piece: BurningPiece, share = 1): void {
    const from = this.by.get(char);
    if (!from || !DevFlags.fire) return;
    const f = this.take(piece, null, null, from.fireproof);
    if (!f) return;
    f.heat = from.heat;
    f.amount *= share;
    if (from.phase === Phase.Smoulder) {
      f.phase = Phase.Smoulder;
      f.dead = true;
      f.since = from.since;
      f.lasts = from.lasts;
      f.charFrom = piece.burn;
    } else {
      this.toCorpse(f, FireTuning.limbBurn);
    }
  }

  /**
   * `char` is about to be baked into the far batch (gore/far.ts) while it smoulders: its fire is parked on the points it
   * lies at (`points`, world, three floats each) and goes on smoking there. Null if it has no fire, or flames still on it
   * (a baked copy cannot burn: gore does not bake those). Hand the result to `resume` when the body is stood up again.
   */
  park(char: CharacterInstance, root: THREE.Object3D, points: Float32Array): ParkedFire | null {
    const f = this.by.get(char);
    if (!f || f.phase !== Phase.Smoulder || points.length < 3) return null;
    const parked = new ParkedFire(root, points);
    parked.burn = char.burn ?? 1;
    this.by.delete(char);
    this.by.set(parked, f);
    f.source = parked;
    f.parked = parked;
    f.body = null;
    f.info = null;
    f.capCount = 1;
    return parked;
  }

  /**
   * A baked body has been stood up again as `char`: its parked fire is its own again, where it had got to. With none left
   * (it went cold while it was baked) the glow its skin was baked with is put out.
   */
  resume(parked: ParkedFire | null, char: CharacterInstance): void {
    const f = parked ? this.by.get(parked) : undefined;
    if (!f || !parked) {
      char.setEmber?.(0);
      return;
    }
    this.by.delete(parked);
    this.by.set(char, f);
    f.source = char;
    f.parked = null;
    f.body = char;
    f.info = rigInfo(char.rig);
    f.scale = char.rig.height / 1.85;
    this.measure(f, null);
  }

  /** The body, limb or piece is gone from the world, or is somebody else's now. */
  forget(source: Burnable): void {
    const f = this.by.get(source);
    if (f) this.drop(f);
  }

  /** Whether anything is still burning or smoking on this. */
  has(source: Burnable): boolean {
    return this.by.has(source);
  }

  /** Burnt enough that what it leaves where it lies is soot. */
  sooted(source: Burnable): boolean {
    return DevFlags.fire && (source.burn ?? 0) >= FireTuning.sootFrom;
  }

  /** Whether this thing has flames on it now. */
  flaming(source: Burnable): boolean {
    const f = this.by.get(source);
    return !!f && f.phase !== Phase.Smoulder;
  }

  /**
   * A burnt body or limb has come to rest at `at`: the soot under it, if its fire has not left it already. `size`
   * is the mark's, metres.
   */
  rest(source: Burnable, at: THREE.Vector3, size: number): void {
    const f = this.by.get(source);
    if (f?.scorched) return;
    if (this.scorch(at, size, lieOf(source)) && f) f.scorched = true;
  }

  /** Soot on the floor under `at` with no body to lie in it: where a burnt body burst. */
  sootAt(at: THREE.Vector3, size: number): void {
    if (DevFlags.fire) this.scorch(at, size);
  }

  private take(source: Burnable, body: CharacterInstance | null, rig: RigDef | null, fireproof: boolean, only: Uint8Array | null = null): Fire | null {
    let f: Fire | null = null;
    let coldest: Fire | null = null;
    for (const c of this.fires) {
      if (!c.live) {
        f = c;
        break;
      }
      // The one to give up is smouldering and nearest its end; failing that, the corpse that has burnt longest.
      if (c.phase === Phase.Alive) continue;
      if (!coldest || c.phase > coldest.phase || (c.phase === coldest.phase && c.since < coldest.since)) coldest = c;
    }
    if (!f) {
      if (!coldest) return null;
      this.drop(coldest, true);
      f = coldest;
    }
    const now = this.ctx.time.elapsed;
    f.live = true;
    f.source = source;
    f.body = body;
    f.info = rig ? rigInfo(rig) : null;
    f.scale = rig ? rig.height / 1.85 : 1;
    f.piece = isPiece(source) ? source : null;
    f.parked = null;
    f.phase = Phase.Alive;
    f.dead = false;
    f.near = true;
    f.fedAt = now;
    f.since = now;
    f.lasts = 0;
    f.charFrom = source.burn ?? 0;
    f.fireproof = fireproof;
    f.heat = 1;
    f.acc = Math.random();
    f.smokeAcc = 0;
    f.nextLight = f.nextShimmer = f.nextGlow = 0;
    f.nextSpit = now + rand(0.1, 0.5);
    f.eaten = f.eatenFrom = (source as Skinned).burnThrough ?? 0;
    f.curl = 0;
    f.curling = false;
    f.scorched = false;
    f.scorchTries = 0;
    f.nextScorch = now + 0.7;
    this.measure(f, only);
    this.by.set(source, f);
    return f;
  }

  /** Which capsules of the rig are still on it, weighted by their skin: a trunk burns more than a hand. */
  private measure(f: Fire, only: Uint8Array | null): void {
    if (f.piece) {
      // By the skin of its box against a man's (about two square metres), and never much: it is a piece.
      const p = f.piece;
      const x = p.max.x - p.min.x, y = p.max.y - p.min.y, z = p.max.z - p.min.z;
      f.capCount = 1;
      f.amount = clamp((x * y + y * z + z * x) / 1.3, 0.08, 1);
      return;
    }
    if (!f.info) return;
    const info = f.info;
    const body = f.body as (CharacterInstance & { isHidden?(bone: number): boolean }) | null;
    let n = 0;
    let total = 0;
    for (let c = 0; c < info.capCount; c++) {
      const bone = info.capBone[c]!;
      if (only ? only[bone] !== 1 : body?.isHidden?.(bone)) continue;
      total += capSkin(info, c);
      f.caps[n] = c;
      f.weights[n] = total;
      n++;
    }
    f.capCount = n;
    f.amount = n > 0 ? clamp((total / wholeSkin(info)) * f.scale * f.scale, 0.06, 3) : 0;
  }

  private toCorpse(f: Fire, seconds: readonly [number, number]): void {
    const now = this.ctx.time.elapsed;
    f.phase = Phase.Corpse;
    f.dead = true;
    f.since = now;
    f.charFrom = f.source!.burn ?? 0;
    f.eatenFrom = f.eaten;
    // What has hardly burnt has more left to burn.
    f.lasts = seconds[0] + (seconds[1] - seconds[0]) * (1 - clamp(f.charFrom)) * rand(0.7, 1) + rand(0, 0.8);
    f.heat = 1;
  }

  private drop(f: Fire, keepLook = false): void {
    // Taken for another fire while it smoked: its glow goes out with it, or it would sit lit for good.
    if (keepLook && f.source) (f.source as Skinned).setEmber?.(0);
    if (f.source) this.by.delete(f.source);
    f.live = false;
    f.source = null;
    f.body = null;
    f.info = null;
    f.piece = null;
    f.parked = null;
  }

  /** A point on its skin, in the world: somewhere along one of its capsules, pushed out toward the surface. */
  private pointOn(f: Fire, out: THREE.Vector3): number {
    if (f.piece) {
      const p = f.piece;
      out.set(rand(p.min.x, p.max.x) * 0.8, rand(p.min.y, p.max.y) * 0.8, rand(p.min.z, p.max.z) * 0.8).applyMatrix4(p.root.matrixWorld);
      return 0.11;
    }
    if (f.parked) {
      const pts = f.parked.points;
      const i = Math.floor(Math.random() * (pts.length / 3)) * 3;
      out.set(pts[i]! + rand(-0.08, 0.08), pts[i + 1]! + rand(0, 0.08), pts[i + 2]! + rand(-0.08, 0.08));
      return 0.1;
    }
    const total = f.weights[f.capCount - 1]!;
    const pick = Math.random() * total;
    let i = 0;
    while (i < f.capCount - 1 && f.weights[i]! < pick) i++;
    const info = f.info!;
    const c = f.caps[i]!;
    this.lastCap = i;
    const o = c * CAP_STRIDE;
    const caps = info.caps;
    const t = Math.random();
    const r = caps[o + 6]!;
    out.set(
      caps[o]! + (caps[o + 3]! - caps[o]!) * t + rand(-r, r) * 0.7,
      caps[o + 1]! + (caps[o + 4]! - caps[o + 1]!) * t + rand(-r, r) * 0.7,
      caps[o + 2]! + (caps[o + 5]! - caps[o + 2]!) * t + rand(-r, r) * 0.7,
    );
    out.applyMatrix4((f.source as Skinned).bones[info.capBone[c]!]!.matrixWorld);
    return r * f.scale;
  }

  /**
   * What a fire leaves on the floor under what burned, at `at`: soot (the decal sheet's own shape for it: a soft-edged
   * black stain with no blast in it), drawn out the way the body lies (`along`, radians about up), a small burnt middle
   * where it lay longest and a smear of soot off to one side. A limb or a piece (under 0.9 m) leaves the soot alone.
   * False if there is no floor close under it.
   */
  private scorch(at: THREE.Vector3, size: number, along = rand(0, Math.PI * 2)): boolean {
    const { physics, render } = this.ctx;
    if (!physics.raycastInto(_o.set(at.x, at.y + 0.3, at.z), _down, 1.5, CG.World, _hit)) return false;
    if (_hit.normal.y < 0.5) return false;
    const decals = render.decals;
    decals.add('soot', _hit.point, _hit.normal, size * 1.3, along + rand(-0.25, 0.25));
    if (size < 0.9) return true;
    decals.add('scorch', _hit.point, _hit.normal, size * 0.55);
    const a = rand(0, Math.PI * 2);
    const d = size * rand(0.3, 0.5);
    _p.set(_hit.point.x + Math.cos(a) * d, _hit.point.y, _hit.point.z + Math.sin(a) * d);
    decals.add('soot', _p, _hit.normal, size * rand(0.55, 0.8), a);
    return true;
  }

  update(dt: number): void {
    const t = FireTuning;
    const { time, fx, render } = this.ctx;
    const now = time.elapsed;
    this.licks = 0;
    // Nothing alight is nearly every frame of the game.
    if (this.by.size === 0) return;
    const cam = render.camera.matrixWorld.elements;

    for (const f of this.fires) {
      if (!f.live) continue;
      const source = f.source!;
      // Gone from the world, or taken back by the library and somebody else's body now.
      if (!source.root.parent || (f.dead && f.body && !this.isCorpse(f.body))) {
        this.drop(f);
        continue;
      }
      const skin = f.piece || f.parked ? null : source as Skinned;
      if (f.phase === Phase.Alive && now - f.fedAt > t.hold) {
        if (f.fireproof || (source.burn ?? 0) < 0.05 || f.body === null) {
          this.drop(f);
          continue;
        }
        // His fire is out and he lives: he smokes for a moment.
        f.phase = Phase.Smoulder;
        f.since = now;
        f.lasts = t.putOut;
        f.charFrom = source.burn ?? 0;
      }
      if (f.phase === Phase.Alive && !f.fireproof && dt > 0 && f.eaten < t.eatAliveMax && (source.burn ?? 0) >= t.eatFrom) {
        f.eaten = Math.min(t.eatAliveMax, f.eaten + dt * t.eatAlive);
        skin?.setBurnThrough?.(f.eaten);
      }
      if (f.phase === Phase.Corpse) {
        const k = (now - f.since) / f.lasts;
        if (k >= 1) {
          f.phase = Phase.Smoulder;
          f.since = now;
          f.lasts = t.smoulder;
          f.heat = 0;
          f.curling = false;
          if (!f.fireproof && !f.parked) (source as Skinned | BurningPiece).setBurn?.(1);
        } else {
          f.heat = k < 1 - t.dieDown ? 1 : 1 - 0.8 * (k - (1 - t.dieDown)) / t.dieDown;
          if (!f.fireproof && !f.parked) (source as Skinned | BurningPiece).setBurn?.(f.charFrom + (1 - f.charFrom) * k * (2 - k));
          // And burns through it, most of the way by the time the flames die down.
          if (!f.fireproof) {
            const e = clamp((k - 0.1) / 0.75);
            f.eaten = Math.max(f.eaten, f.eatenFrom + (t.eatMax - f.eatenFrom) * e * e * (3 - 2 * e));
            skin?.setBurnThrough?.(f.eaten);
          }
          // The heat draws it up as it blackens. Flesh only: what is built to burn does not shrink in it.
          const u = clamp(k / t.curlBy);
          f.curl = f.body && !f.fireproof ? t.curl * u * u * (3 - 2 * u) : 0;
        }
      }
      if (f.phase === Phase.Smoulder) {
        const k = (now - f.since) / f.lasts;
        // A reset body has no char: the library took it back and gave it to someone new.
        if (k >= 1 || (!f.fireproof && (source.burn ?? 0) < 0.05)) {
          skin?.setEmber?.(0);
          this.drop(f);
          continue;
        }
        // The glow in the cracks: bright as the flames leave, most of it gone in the first quarter.
        skin?.setEmber?.(0.6 * (1 - k) ** 3);
        f.heat = 0;
      } else {
        skin?.setEmber?.(1);
      }
      if (f.capCount === 0) continue;
      if (f.piece) {
        f.at.addVectors(f.piece.min, f.piece.max).multiplyScalar(0.5).applyMatrix4(f.piece.root.matrixWorld);
      } else if (f.parked) {
        const pts = f.parked.points;
        f.at.set(pts[0]!, pts[1]!, pts[2]!);
      } else {
        const first = skin!.bones[f.info!.capBone[f.caps[0]!]!]!.matrixWorld.elements;
        f.at.set(first[12]!, first[13]!, first[14]!);
      }
      const dx = f.at.x - cam[12]!, dy = f.at.y - cam[13]!, dz = f.at.z - cam[14]!;
      f.dist2 = dx * dx + dy * dy + dz * dz;
    }
    if (dt <= 0) return;

    // How much of its fire each gets: the budget, shared by how near each is.
    let all = 0;
    for (const f of this.fires) {
      if (!f.live || f.capCount === 0) continue;
      let nearer = 0;
      for (const o of this.fires) if (o.live && o !== f && o.heat > 0 && o.dist2 < f.dist2) nearer++;
      const flaming = f.heat > 0;
      const rank = flaming ? nearer : t.max;
      f.near = rank < t.near;
      if (flaming) all += t.rate * f.heat * f.amount * (f.near ? 1 : t.farRate);
      // The nearest few burning corpses draw up; one further off, or done, is left to lie and freeze as any body does.
      const draws = f.phase === Phase.Corpse && f.curl > 0 && (now - f.since) / f.lasts < t.curlBy + t.curlHold && rank < t.curls && DevFlags.fire;
      f.curling = draws;
      if (draws) this.drawUp(f);
      if (flaming && rank < t.lights && now >= f.nextLight) {
        f.nextLight = now + rand(0.11, 0.2);
        const size = Math.sqrt(f.amount);
        _p.copy(f.at).addScaledVector(_up, 0.35 * f.scale);
        render.lights.flash(_p, LIGHT, rand(t.light[0], t.light[1]) * f.heat * size, t.lightRadius * (0.6 + 0.4 * size), 0.26);
      }
      if (flaming && rank < t.shimmers && f.heat > 0.4 && now >= f.nextShimmer) {
        f.nextShimmer = now + 0.45;
        _p.copy(f.at).addScaledVector(_up, 0.5 * f.scale);
        fx.heatShimmer(_p, 0.85 * Math.sqrt(f.amount), 0.8);
      }
    }
    const thin = all > t.budget ? t.budget / all : 1;

    for (const f of this.fires) {
      if (!f.live || f.capCount === 0) continue;
      const near = f.near;
      const share = f.amount;
      if (f.heat > 0) {
        f.acc += dt * t.rate * f.heat * share * (near ? 1 : t.farRate) * thin;
        while (f.acc >= 1) {
          f.acc -= 1;
          const r = this.pointOn(f, _p);
          fx.flameLick?.(_p, (0.2 + r * 1.55) * (0.75 + 0.25 * f.heat), f.heat);
          this.licks++;
        }
        if (now >= f.nextSpit) {
          f.nextSpit = now + rand(0.12, 0.3) / Math.max(share, 0.25);
          this.pointOn(f, _p);
          if (Math.random() < 0.5) fx.embers(_p, 1, 0.35);
          else fx.fireSpit?.(_p);
        }
        // The pool of light on the floor under a body that is down and burning.
        if (f.phase === Phase.Corpse && near && now >= f.nextGlow) {
          f.nextGlow = now + 0.28;
          fx.fireGlow?.(_p.copy(f.at).addScaledVector(_up, 0.15), 0.8 * Math.sqrt(share), 0.55 * f.heat);
        }
      }
      // Smoke: thick off the dying flames, then a thread that thins as it goes cold.
      const smoke = f.phase === Phase.Smoulder ? 2.2 * (1 - (now - f.since) / f.lasts) + 0.25 : f.phase === Phase.Corpse ? 1.2 * (1.2 - f.heat) : 0;
      if (smoke > 0) {
        f.smokeAcc += dt * smoke * Math.max(share, 0.3) * (near ? 1 : 0.5);
        while (f.smokeAcc >= 1) {
          f.smokeAcc -= 1;
          const r = this.pointOn(f, _p);
          fx.smokeWisp?.(_p, 0.16 + r * 1.2, f.phase === Phase.Smoulder ? 1 - (now - f.since) / f.lasts : 1);
        }
      }
      // Lying and burning, it marks the floor. Tried a few times: it may still be in the air.
      if (f.phase !== Phase.Alive && !f.scorched && f.scorchTries < 8 && now >= f.nextScorch && f.source!.burn !== undefined && this.sooted(f.source!)) {
        f.nextScorch = now + 0.6;
        f.scorchTries++;
        if (f.at.y - this.floorUnder(f.at) < 0.45 * f.scale) f.scorched = this.scorch(f.at, rand(1.2, 1.6) * Math.sqrt(share), lieOf(f.source!));
      }
    }
  }

  private floorUnder(at: THREE.Vector3): number {
    return this.ctx.physics.raycastInto(_o.set(at.x, at.y + 0.3, at.z), _down, 2, CG.World, _hit) ? _hit.point.y : -Infinity;
  }

  clear(): void {
    for (const f of this.fires) if (f.live) this.drop(f);
  }

  stats(): { alight: number; smouldering: number; licks: number } {
    let alight = 0;
    let smouldering = 0;
    for (const f of this.fires) {
      if (!f.live) continue;
      if (f.phase === Phase.Smoulder) smouldering++;
      else alight++;
    }
    return { alight, smouldering, licks: this.licks };
  }
}
