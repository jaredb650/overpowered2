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
};

const enum Phase { Alive, Corpse, Smoulder }

/** What can burn: a body or a limb cut from one. */
type Burnable = CharacterInstance | SeveredLimb;

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
}

const _p = new THREE.Vector3();
const _o = new THREE.Vector3();
const _down = new THREE.Vector3(0, -1, 0);
const _up = new THREE.Vector3(0, 1, 0);
const _hit: RayHit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0, surface: 'concrete', collider: null };
const LIGHT = 0xff7a30;

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

export class FireField {
  private readonly fires: Fire[] = Array.from({ length: FireTuning.max }, () => new Fire());
  private readonly by = new Map<Burnable, Fire>();
  /** Licks drawn in the last frame, for the checks. */
  licks = 0;

  /**
   * @param isCorpse True while gore has this body as a corpse: dead, not being vaporized, not handed back.
   */
  constructor(private readonly ctx: Ctx, private readonly isCorpse: (char: CharacterInstance) => boolean) {}

  /** A living body is alight this frame. Call it every frame it burns. */
  feed(char: CharacterInstance, fireproof = false): void {
    if (!DevFlags.fire) return;
    let f = this.by.get(char) ?? null;
    if (!f) {
      f = this.take(char, char, char.rig, fireproof);
      if (!f) return;
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

  /** The body or limb is gone from the world, or is somebody else's now. */
  forget(source: Burnable): void {
    const f = this.by.get(source);
    if (f) this.drop(f);
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
   * A burnt body or limb has come to rest at `at`: the scorch under it, if its fire has not left one already. `size`
   * is the mark's, metres.
   */
  rest(source: Burnable, at: THREE.Vector3, size: number): void {
    const f = this.by.get(source);
    if (f?.scorched) return;
    if (this.scorch(at, size) && f) f.scorched = true;
  }

  private take(source: Burnable, body: CharacterInstance | null, rig: RigDef, fireproof: boolean, only: Uint8Array | null = null): Fire | null {
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
    f.info = rigInfo(rig);
    f.scale = rig.height / 1.85;
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
    f.scorched = false;
    f.scorchTries = 0;
    f.nextScorch = now + 0.7;
    this.measure(f, only);
    this.by.set(source, f);
    return f;
  }

  /** Which capsules of the rig are still on it, weighted by their skin: a trunk burns more than a hand. */
  private measure(f: Fire, only: Uint8Array | null): void {
    const info = f.info!;
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
    // What has hardly burnt has more left to burn.
    f.lasts = seconds[0] + (seconds[1] - seconds[0]) * (1 - clamp(f.charFrom)) * rand(0.7, 1) + rand(0, 0.8);
    f.heat = 1;
  }

  private drop(f: Fire, keepLook = false): void {
    // Taken for another fire while it smoked: its glow goes out with it, or it would sit lit for good.
    if (keepLook && f.source) f.source.setEmber?.(0);
    if (f.source) this.by.delete(f.source);
    f.live = false;
    f.source = null;
    f.body = null;
    f.info = null;
  }

  /** A point on its skin, in the world: somewhere along one of its capsules, pushed out toward the surface. */
  private pointOn(f: Fire, out: THREE.Vector3): number {
    const total = f.weights[f.capCount - 1]!;
    const pick = Math.random() * total;
    let i = 0;
    while (i < f.capCount - 1 && f.weights[i]! < pick) i++;
    const info = f.info!;
    const c = f.caps[i]!;
    const o = c * CAP_STRIDE;
    const caps = info.caps;
    const t = Math.random();
    const r = caps[o + 6]!;
    out.set(
      caps[o]! + (caps[o + 3]! - caps[o]!) * t + rand(-r, r) * 0.7,
      caps[o + 1]! + (caps[o + 4]! - caps[o + 1]!) * t + rand(-r, r) * 0.7,
      caps[o + 2]! + (caps[o + 5]! - caps[o + 2]!) * t + rand(-r, r) * 0.7,
    );
    out.applyMatrix4(f.source!.bones[info.capBone[c]!]!.matrixWorld);
    return r * f.scale;
  }

  /** Soot and a scorch on the floor under `at`. False if there is no floor close under it. */
  private scorch(at: THREE.Vector3, size: number): boolean {
    const { physics, render } = this.ctx;
    if (!physics.raycastInto(_o.set(at.x, at.y + 0.3, at.z), _down, 1.5, CG.World, _hit)) return false;
    if (_hit.normal.y < 0.5) return false;
    render.decals.add('scorch', _hit.point, _hit.normal, size);
    // Soot thrown out past the burn itself, so the mark is not one stamped disc.
    for (let i = 0; i < 2; i++) {
      const a = rand(0, Math.PI * 2);
      const d = size * rand(0.3, 0.5);
      _p.set(_hit.point.x + Math.cos(a) * d, _hit.point.y, _hit.point.z + Math.sin(a) * d);
      render.decals.add('scorch', _p, _hit.normal, size * rand(0.4, 0.6));
    }
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
      if (f.phase === Phase.Corpse) {
        const k = (now - f.since) / f.lasts;
        if (k >= 1) {
          f.phase = Phase.Smoulder;
          f.since = now;
          f.lasts = t.smoulder;
          f.heat = 0;
          if (!f.fireproof) source.setBurn?.(1);
        } else {
          f.heat = k < 1 - t.dieDown ? 1 : 1 - 0.8 * (k - (1 - t.dieDown)) / t.dieDown;
          if (!f.fireproof) source.setBurn?.(f.charFrom + (1 - f.charFrom) * k * (2 - k));
        }
      }
      if (f.phase === Phase.Smoulder) {
        const k = (now - f.since) / f.lasts;
        // A reset body has no char: the library took it back and gave it to someone new.
        if (k >= 1 || (!f.fireproof && (source.burn ?? 0) < 0.05)) {
          source.setEmber?.(0);
          this.drop(f);
          continue;
        }
        // The glow in the cracks: bright as the flames leave, most of it gone in the first quarter.
        source.setEmber?.(0.6 * (1 - k) ** 3);
        f.heat = 0;
      } else {
        source.setEmber?.(1);
      }
      if (f.capCount === 0) continue;
      const first = source.bones[f.info!.capBone[f.caps[0]!]!]!.matrixWorld.elements;
      f.at.set(first[12]!, first[13]!, first[14]!);
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
        if (f.at.y - this.floorUnder(f.at) < 0.45 * f.scale) f.scorched = this.scorch(f.at, rand(1.2, 1.6) * Math.sqrt(share));
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
