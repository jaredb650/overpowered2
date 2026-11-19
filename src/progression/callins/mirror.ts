/**
 * Other players' call-ins, flown on this screen (co-op). The owner's rule: everyone can call them in, and it is global.
 *
 * A caller's game says what it called (`CallOrder`: which, where, which way, a seed) and what happens to it afterwards that
 * the order could not say (`CallNews`). This plays each one through the very strike class the caller runs, on a context
 * that hurts nothing (ghost.ts): the same aircraft model on the same path, the same guns and tracers, the same rounds and
 * bombs in flight, the same beams, flashes, shockwave, aftermath and sounds, placed in the world. Damage stays the caller's:
 * its own game claims every hit with the host, and a copy never deals any.
 *
 * Each player has their own set of the things a strike borrows (the jet, the missiles, the gunship and its rounds, the two
 * helicopters and their guns, the sentry, the Frame), built the first time they call something that needs it, so two
 * players' gunships can be up at once. Nothing is built for a player who never calls anything in.
 *
 * How each call-in is kept the same on every screen:
 *   airstrike, Warthog        the order's seed: the same scatter, so the same rockets and shells on the same spots
 *   Black Sun, nuke           the order alone: they are a place and a clock
 *   Orbital Lance             the caller's aim on the ground, ten times a second, steered at the same speed; and the let-go
 *   AC-130                    its circle is the order (centre and side); every round, the ramp, the laser, flares, a shoot-down
 *   the two helicopters       their pose ten times a second with the guns' aim and triggers; flares, a shoot-down
 *   AA sentry                 the order: the same pod on the same spot; it tracks and fires on what flies by itself
 *   the Frame                 the drop is the order; the Frame itself is its pilot's pose and news (frame/puppet.ts)
 */
import * as THREE from 'three';
import type { Ctx } from '../../core/contracts';
import type { CallInId } from '../../core/gameplay';
import { rand, randomUnit } from '../../core/math';
import { FramePuppet } from '../../frame/puppet';
import { ATTACK_AIRFRAME, type AttackMount } from '../../vehicles/attackModel';
import { CHIN_CANNON, Gun, M134 } from '../../vehicles/guns';
import type { SeatRig } from '../../vehicles/seat';
import { UTILITY_AIRFRAME, type UtilityMount } from '../../vehicles/utilityModel';
import type { ModelMaterials } from '../modelkit';
import { Ac130, Ac130Rig } from './ac130';
import { Ac130Rounds } from './ac130Rounds';
import { Airframe } from './airframe';
import { Airstrike } from './airstrike';
import { ANTI_AIR } from './antiAir';
import { AttackChopper } from './attackChopper';
import { BlackSun } from './blacksun';
import { DoorGunner } from './doorGunner';
import { FrameDrop } from './frameDrop';
import { ghostCtx, type GhostStats } from './ghost';
import { GroundProbe } from './ground';
import type { Ride } from './gunnerStrike';
import type { CallNews, CallOrder, MechKind } from './link';
import { Nuke, type NukeAftermath } from './nuke';
import { Orbital } from './orbital';
import { Ordnance } from './ordnance';
import { Sentry, SentryRig } from './sentry';
import { isAircraft, type Strike, type StrikeKit, type StrikeNet, type StrikeOrder } from './shared';
import { Warthog, warthogModel } from './warthog';

/** Most copies one player may have running here at once. A caller who somehow has more loses the oldest. */
export const MAX_COPIES = 6;
/** Players in a lobby. */
const SLOTS = 4;
const NO_MISSILES = { missiles: [] };
const NOWHERE = { solve: () => false };
const D = ANTI_AIR.decoy;

interface Copy {
  n: number;
  id: CallInId;
  strike: Strike;
  /** Seconds of the strike's own clock it has been run through here. */
  age: number;
  /** The order it was begun from, kept for a player who arrives while it runs. */
  order: CallOrder;
  /** When its caller's began, on this screen's wall clock (`performance.now()`): what `age` is kept up with. */
  born: number;
}

/**
 * A copy more than this far behind its caller's is run forward without being drawn or heard. Under it, an ordinary frame's
 * own step is close enough.
 */
export const BEHIND_S = 0.25;
/** The steps of that catching up, and the most strike time made up in one frame (a late joiner's gunship takes a few frames). */
const CATCH_STEP = 1 / 30, CATCH_MOST = 20;
/** An enemy's missile at a player's aircraft, as the watchers see it (antiAir.ts flies the caller's own). */
interface AaMissile { n: number; body: THREE.Object3D; velocity: THREE.Vector3; age: number; end: THREE.Vector3 | null }
const AA = ANTI_AIR.missile;

/** One player's own set of what strikes borrow. Every part is built on first use. */
class Hangar {
  readonly copies: Copy[] = [];
  readonly missiles: AaMissile[] = [];
  private kitMade: StrikeKit | null = null;
  private gunshipMade: Ac130Rig | null = null;
  private harrowMade: Ride<AttackMount> | null = null;
  private packmuleMade: Ride<UtilityMount> | null = null;
  private sentryMade: SentryRig | null = null;
  private frameMade: FramePuppet | null = null;
  private skyMade: Ac130Rounds | null = null;

  constructor(private readonly ctx: Ctx, private readonly real: Ctx, private readonly materials: ModelMaterials) {}

  get kit(): StrikeKit {
    if (this.kitMade) return this.kitMade;
    const { ctx, materials } = this;
    const jet = warthogModel(materials);
    jet.visible = false;
    ctx.render.scene.add(jet);
    return this.kitMade = { ctx, probe: new GroundProbe(ctx), materials, ordnance: new Ordnance(ctx, materials), jet, cosmetic: true, all: this.real.hud };
  }
  get gunship(): Ac130Rig { return this.gunshipMade ??= new Ac130Rig(this.ctx, this.materials); }
  get harrow(): Ride<AttackMount> {
    const { scene } = this.ctx.render;
    return this.harrowMade ??= { frame: new Airframe(this.materials, scene, ATTACK_AIRFRAME), gun: new Gun(this.materials, scene, CHIN_CANNON) };
  }
  get packmule(): Ride<UtilityMount> {
    const { scene } = this.ctx.render;
    return this.packmuleMade ??= { frame: new Airframe(this.materials, scene, UTILITY_AIRFRAME), gun: new Gun(this.materials, scene, M134) };
  }
  get sentry(): SentryRig { return this.sentryMade ??= new SentryRig(this.materials, this.ctx.render.scene); }
  get frame(): FramePuppet { return this.frameMade ??= new FramePuppet(this.ctx, this.materials); }
  /** The frame, if this player has ever had one here. */
  get framed(): FramePuppet | null { return this.frameMade; }
  /** Sparks for the flares a helicopter throws. */
  get sky(): Ac130Rounds { return this.skyMade ??= new Ac130Rounds(this.ctx, this.materials); }

  update(dt: number, world: number): void {
    this.kitMade?.ordnance.update(world);
    this.skyMade?.update(world);
    this.frameMade?.update(dt);
  }

  /** The rounds and missiles in flight alone, for a copy being run forward (they are the strike's, and it may wait on them). */
  advance(world: number): void {
    this.kitMade?.ordnance.update(world);
    this.skyMade?.update(world);
  }

  clear(): void {
    for (const copy of this.copies) copy.strike.dispose();
    this.copies.length = 0;
    for (const m of this.missiles) this.real.render.scene.remove(m.body);
    this.missiles.length = 0;
    this.kitMade?.ordnance.clear();
    this.skyMade?.clear();
    this.frameMade?.clear();
  }
}

const _point = new THREE.Vector3();
const _v = new THREE.Vector3();

export class CallinMirror {
  /** What the copies drew, in all: the proofs read it on a watcher to see that the blasts and the fire arrived. */
  readonly stats: GhostStats & { orders: number; news: number } = { blasts: 0, projectiles: 0, rays: 0, orders: 0, news: 0 };
  private readonly ghost: Ctx;
  private readonly hangars: (Hangar | null)[] = [null, null, null, null];
  private readonly order: StrikeOrder = { point: new THREE.Vector3(), heading: new THREE.Vector3(1, 0, 0), seed: 0, yaw: 0 };

  constructor(private readonly ctx: Ctx, private readonly materials: ModelMaterials, private readonly seats: SeatRig, private readonly aftermath: NukeAftermath) {
    this.ghost = ghostCtx(ctx, this.stats);
  }

  private hangar(slot: number): Hangar | null {
    if (!Number.isInteger(slot) || slot < 0 || slot >= SLOTS) return null;
    return this.hangars[slot] ??= new Hangar(this.ghost, this.ctx, this.materials);
  }

  /** For the proofs and for anything that must know where another player's aircraft or Frame is. */
  copies(slot: number): readonly Copy[] {
    return this.hangars[slot]?.copies ?? [];
  }
  frameOf(slot: number): FramePuppet | null {
    return this.hangars[slot]?.framed ?? null;
  }
  /** True while that player is in a Frame: their own body is inside the puppet and is not drawn. */
  inFrame(slot: number): boolean {
    return this.hangars[slot]?.framed?.occupied === true;
  }

  /** A player called something in: the same thing starts here. */
  begin(slot: number, o: CallOrder): void {
    const hangar = this.hangar(slot);
    if (!hangar) return;
    // The same number again is the same call told twice.
    if (hangar.copies.some(c => c.n === o.n)) return;
    if (hangar.copies.length >= MAX_COPIES) hangar.copies.shift()!.strike.dispose();
    const order = this.order;
    order.point.set(o.at[0], o.at[1], o.at[2]);
    order.heading.set(Math.cos(o.yaw), 0, Math.sin(o.yaw));
    order.seed = o.seed;
    order.yaw = o.yaw;
    const strike = this.launch(hangar, o, order);
    if (!strike) return;
    this.stats.orders++;
    // `age`: its caller's has been running that long (this player arrived part-way, or the caller is saying it again):
    // the copy is born in the past and `update` runs it forward to now.
    const age = Number.isFinite(o.age) && o.age > 0 ? o.age : 0;
    hangar.copies.push({ n: o.n, id: o.id, strike, age: 0, order: { ...o, at: [o.at[0], o.at[1], o.at[2]], age: 0 }, born: performance.now() - age * 1000 });
  }

  /** That player's copies as orders with their age now: what a player arriving on the host is sent (net/world/callins.ts). */
  orders(slot: number): CallOrder[] {
    const now = performance.now();
    return (this.hangars[slot]?.copies ?? []).map(copy => ({ ...copy.order, age: Math.max(0, (now - copy.born) / 1000) }));
  }

  private launch(hangar: Hangar, o: CallOrder, order: StrikeOrder): Strike | null {
    const { kit } = hangar;
    const net: StrikeNet = { puppet: true };
    switch (o.id) {
      case 'airstrike': return new Airstrike(kit, order);
      case 'warthog': return new Warthog(kit, order);
      case 'blackSun': return new BlackSun(kit, order);
      case 'nuke': return new Nuke(kit, order, this.aftermath);
      case 'orbital': return new Orbital(kit, order, NOWHERE, net);
      case 'sentry': return new Sentry(kit, order, hangar.sentry, NO_MISSILES);
      case 'ac130': return new Ac130(kit, order, hangar.gunship, this.seats, true, net);
      case 'attackChopper':
        net.flares = from => this.flares(hangar, from);
        return new AttackChopper(kit, this.seats, hangar.harrow, true, net);
      case 'doorGunner':
        net.flares = from => this.flares(hangar, from);
        return new DoorGunner(kit, this.seats, hangar.packmule, null, true, null, net);
      case 'frame': return new FrameDrop(kit, hangar.frame, { feet: order.point, yaw: o.yaw });
      default: return null;
    }
  }

  /** What a caller's own call-in did, for the copy with its number. */
  news(slot: number, news: CallNews): void {
    const hangar = this.hangars[slot];
    const copy = hangar?.copies.find(c => c.n === news.n);
    if (!hangar || !copy) return;
    this.stats.news++;
    // An enemy's missile at the caller's aircraft: flown here from the same spot at this screen's copy of it.
    if (news.k === 'aa' || news.k === 'aax') return this.missile(hangar, copy, news.k === 'aa', news.v ?? []);
    // Shot down, and not an aircraft that falls: the caller's is simply gone, and so is this.
    if (news.k === 'down' && !isAircraft(copy.strike)) {
      copy.strike.dispose();
      hangar.copies.splice(hangar.copies.indexOf(copy), 1);
      return;
    }
    copy.strike.news?.(news.k, news.v ?? []);
  }

  mech(slot: number, pose: readonly number[] | null): void {
    // Nothing is built for a leave from a player who was never seen in one.
    if (!pose) this.hangars[slot]?.framed?.pose(null);
    else this.hangar(slot)?.frame.pose(pose);
  }

  mechNews(slot: number, kind: MechKind, values: readonly number[]): void {
    const frame = this.hangars[slot]?.framed;
    if (frame?.occupied) frame.news(kind, values);
  }

  /** Decoys out from under an aircraft, as anti-air draws them for the player's own (antiAir.ts `flared`). */
  private flares(hangar: Hangar, from: THREE.Vector3): void {
    for (let i = 0; i < D.count; i++) {
      randomUnit(_v).setY(0).normalize().multiplyScalar(D.speed * rand(0.6, 1.1));
      _v.y = -rand(3, 9);
      hangar.sky.flare(_point.copy(from).setY(from.y - D.under), _v, D.life * rand(0.85, 1.1));
    }
  }

  /** The missile's launch (`from`), or its end (`at`): it has burst on the caller's screen. */
  private missile(hangar: Hangar, copy: Copy, launch: boolean, v: readonly number[]): void {
    if (v.length < 3 || !v.slice(0, 3).every(Number.isFinite)) return;
    const { audio, fx, render } = this.ctx;
    if (!launch) {
      const m = hangar.missiles.find(missile => missile.n === copy.n && !missile.end);
      if (m) m.end = new THREE.Vector3(v[0], v[1], v[2]);
      return;
    }
    if (hangar.missiles.length >= 4) return;
    const body = new THREE.Object3D();
    body.position.set(v[0]!, v[1]!, v[2]!);
    render.scene.add(body);
    _v.subVectors(copy.strike.where, body.position).setY(0).normalize().add(_point.set(0, 1.6, 0)).normalize();
    hangar.missiles.push({ n: copy.n, body, velocity: _v.clone().multiplyScalar(AA.boost), age: 0, end: null });
    fx.attachEmitter(body, 'airstrikeTrail');
    fx.muzzleFlash(body.position, _v, 'rocket');
    fx.smoke(body.position, 0xb8bcc0, 2.2, 2.5);
    audio.play('enemy_rocket_fire', { position: body.position, volume: 1 });
  }

  /** The watchers' missiles: each homes on this screen's copy of the aircraft until the caller says where its own burst. */
  private flyMissiles(hangar: Hangar, dt: number): void {
    const { audio, fx, render } = this.ctx;
    for (let i = hangar.missiles.length - 1; i >= 0; i--) {
      const m = hangar.missiles[i]!;
      const p = m.body.position;
      m.age += dt;
      const copy = hangar.copies.find(c => c.n === m.n);
      const aim = m.end ?? copy?.strike.where ?? null;
      const speed = Math.min(AA.speed, AA.boost + AA.accel * m.age);
      if (aim) {
        _v.copy(m.velocity).normalize();
        _point.subVectors(aim, p).normalize();
        const angle = _v.angleTo(_point);
        if (angle > 1e-4) _v.lerp(_point, Math.min(1, (AA.turn * (m.end ? 3 : 1) * dt) / angle)).normalize();
        m.velocity.copy(_v).multiplyScalar(speed);
      }
      p.addScaledVector(m.velocity, dt);
      // Burst where the caller's did; with no word of that, on reaching the copy, or spent.
      const there = aim ? p.distanceTo(aim) <= (m.end ? Math.max(AA.reach, speed * dt * 1.5) : AA.reach) : false;
      if (!there && aim && m.age < AA.life + 1) continue;
      fx.explosion(p, { radius: 3, kind: 'rocket', scale: 0.9 });
      fx.smoke(p, 0x3a3c40, 3, 3);
      audio.play('rocket_explosion', { position: p, volume: 0.9 });
      render.scene.remove(m.body);
      hangar.missiles.splice(i, 1);
    }
  }

  /**
   * Every frame, on the strike clock (`dt`, real seconds) like the player's own strikes. A copy is kept up with the wall
   * clock since its caller's began, not with the sum of this screen's frames: a screen that dropped frames, a tab that was
   * hidden, or a player who arrived while it was running would otherwise fly it late for the rest of its life (only the
   * gunship had a clock of its own to catch up by). What is skipped to get there is run without picture or sound.
   */
  update(dt: number): void {
    const world = this.ctx.time.dt;
    const now = performance.now();
    for (const hangar of this.hangars) {
      if (!hangar) continue;
      hangar.update(dt, world);
      if (hangar.missiles.length) this.flyMissiles(hangar, dt);
      const { copies } = hangar;
      for (let i = copies.length - 1; i >= 0; i--) {
        const copy = copies[i]!;
        let done = false;
        const behind = (now - copy.born) / 1000 - copy.age - dt;
        if (behind > BEHIND_S) {
          this.stats.quiet = true;
          try {
            for (let left = Math.min(behind, CATCH_MOST); left > 1e-4 && !done; left -= CATCH_STEP) {
              const step = Math.min(CATCH_STEP, left);
              copy.age += step;
              done = copy.strike.update(step);
              hangar.advance(step);
            }
          } catch (error) {
            // A strike that cannot be run forward blind is not shown part-way at all: the next one is seen whole.
            console.warn('[coop] A call-in copy could not be caught up, and is dropped', copy.id, error);
            done = true;
          } finally { this.stats.quiet = false; }
        }
        if (!done) {
          copy.age += dt;
          done = copy.strike.update(dt);
        }
        if (!done) continue;
        copy.strike.dispose();
        copies.splice(i, 1);
      }
    }
  }

  /** A player left: their strikes, aircraft and Frame go with them. */
  drop(slot: number): void {
    this.hangars[slot]?.clear();
  }

  /** A new run. */
  clear(): void {
    for (const hangar of this.hangars) hangar?.clear();
  }
}
