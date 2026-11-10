/**
 * Everything on key 5: the katana and the four that sit beside it. One class swings all of them, reading the row in
 * MELEE for the weapon in hand. What a swing touches is sweep.ts: the slab the blade passes through, out to its reach,
 * with a world ray from the eye to every body it finds, so nothing behind cover is struck.
 *
 * Light swings land on the frame of the click, as in the first game, and stay live for `liveFraction` of the swing, so a
 * body the player runs onto is still struck. A body just past reach is stepped into, a short pull of `step` meters. Only
 * the katana dashes: out of a run at someone ahead (KATANA.dash). Its guard, charged sweep and finisher (SWORD) are its own.
 *
 * Decisions the first game left to accident (docs/original/04 section 17):
 *  - Wind-up charge matters: a tap is a weak sweep, 0.3 s of hold is the full one.
 *  - The finisher ends the chain, so its 650 ms loop is gone.
 *  - Blood Thirst and every other damage modifier applies to every attack.
 *  - Everything runs on player time, so swings stay full speed in SLOWMO.
 */
import * as THREE from 'three';
import { CG, type Ctx, type DamageType, type SlashKind } from '../../core/contracts';
import type { EnemyInstance, WeaponId, WeaponModifiers } from '../../core/gameplay';
import type { GoreRegion } from '../../characters/rig';
import { clamp, lerp, rand } from '../../core/math';
import { rigInfo } from '../../gore/rigInfo';
import type { Combat, GuardResult } from '../Combat';
import { SWORD, WEAPONS } from '../data';
import { closestOnSegment } from '../geometry';
import { BLADE_OLD, BODY_RADIUS, DOWNED_HEIGHT, KATANA, MELEE, REACH_DOWN, isMelee, type MeleeDef, type MeleeId, type MeleeSwing } from './data';
import { swingTouches, sweepDirection, type BodyShape, type SwingFrame, type SwingShape } from './sweep';

type State = 'idle' | 'swing' | 'windup' | 'area' | 'finisher';

const UP = new THREE.Vector3(0, 1, 0);
const MAX_LIST = 48;
/** Each extra target on one swing adds less stop, or a big cleave would hang the game. */
const STOP_PER_EXTRA = 0.012;
const STOP_MAX = 0.13;
/** Crescent sweep in radians. */
const LIGHT_ARC = 2.1;
/** Radians the crescent is opened toward the camera. The sweep's radius is big enough that more would bury its tips in the floor. */
const LIGHT_TILT = 0.5;
const AREA_TILT = 0.22;
/** A slice costs about 5 ms. Past this many on one frame the rest fall as ragdolls, so a big cleave cannot blow the frame. */
const MAX_SLICES_PER_FRAME = 3;
/** Meters inside its reach a step or a dash leaves a body, so the swing still live on arrival lands. */
const ARRIVE_INSIDE = 0.3;
/** Where a fling's push comes from, behind the struck body along the swing, and how far it reaches. */
const FLING_BACK = 0.8;
const FLING_RADIUS = 1.8;
/**
 * A club's flat swing lands on the side it comes from: rays at these shares of the body's radius out from the middle, the
 * first that meets the body, then the middle. The shoulder and the arm, not the throat: a ray at the middle of a Trooper
 * at a walking look meets the neck, which counts as the head. At 0.75 the ray went past a Trooper holding his rifle.
 */
const SIDE_BLOW = [0.55, 0.3] as const;

/** `?blade=old`: the katana's reach before it was measured. A cone from the eye, and anything this close is in the arc. */
const OLD_POINT_BLANK = 1.7;
const OLD_BODY_RADIUS = 0.35;

/** The parts of the real enemy a weapon may read and nothing else: whether it is in a state to defend itself. */
interface Balance {
  stagger?: number;
  downed?: boolean;
  rising?: number;
  fallIn?: number;
  def?: { radius?: number };
}

export class Melee {
  private id: MeleeId = 'sword';
  private def: MeleeDef = MELEE.sword;
  private state: State = 'idle';
  private timer = 0;
  private length = 0;
  private clock = 0;
  private lastAttackAt = -10;
  /** Index of the next swing in the chain. */
  private next = 0;
  private swing: MeleeSwing = MELEE.sword.chain[0]!;
  private swingIndex = 0;
  /** The swing in progress is the right click's. */
  private heavyOn = false;
  private fireBuffer = 0;
  private aimBuffer = 0;
  private power = 1;
  private blasted = false;
  private quick = false;

  /** A step or the katana's dash: who it pulls toward, for how long, how fast, and how close to their middle it stops. */
  private lungeTarget: EnemyInstance | null = null;
  private lungeLeft = 0;
  private lungeSpeed = 0;
  private lungeStop = 0;
  private lungeSeconds = 0;
  /** Seconds into the swing its blow lands, and whether it has. */
  private impactAt = 0;
  private landed = false;
  /** This swing stepped or dashed: it stays live for all of its length, so the body it carried the player to is struck. */
  private pulled = false;

  private readonly struck: EnemyInstance[] = [];
  private readonly list: EnemyInstance[] = [];
  private hitCount = 0;
  private killCount = 0;
  private slicesLeft = 0;

  /** Swing plane for the current attack, in world space. */
  private readonly planeNormal = new THREE.Vector3();
  private readonly sweepDir = new THREE.Vector3();
  private readonly frame: SwingFrame = { eye: new THREE.Vector3(), forward: new THREE.Vector3(), sweep: new THREE.Vector3() };
  private readonly shape: SwingShape = { reach: 0, arc: 0, width: 0, pointBlank: 0, thrust: false };
  private readonly body: BodyShape = { base: new THREE.Vector3(), height: 1.8, radius: 0.35 };
  private readonly contact = new THREE.Vector3();
  private readonly vA = new THREE.Vector3();
  private readonly vB = new THREE.Vector3();
  private readonly vC = new THREE.Vector3();
  private readonly vD = new THREE.Vector3();
  private readonly push = new THREE.Vector3();
  private readonly neck = new THREE.Vector3();
  private readonly neckNormal = new THREE.Vector3();

  constructor(private readonly ctx: Ctx, private readonly combat: Combat, private readonly modifiers: WeaponModifiers) {}

  /** The weapon whose swings these are. */
  get weapon(): MeleeId {
    return this.id;
  }

  /** Takes up a weapon of key 5. Anything else is ignored, so a caller can pass whatever was drawn. */
  equip(id: WeaponId): void {
    if (!isMelee(id) || id === this.id) return;
    this.cancel();
    this.id = id;
    this.def = MELEE[id];
    this.next = 0;
  }

  /** The finisher has been committed to and not landed. Switching now would drop the blast. */
  get committed(): boolean {
    return this.state === 'finisher' && !this.blasted;
  }

  get step(): number {
    return this.clock - this.lastAttackAt > this.def.comboWindow ? 0 : this.next;
  }

  /** Swing time shrinks with fire rate, but only by the square root: Berserk's 3x would blur the animation. */
  private seconds(base: number): number {
    return base / Math.sqrt(Math.max(this.modifiers.fireRate, 0.1));
  }

  cancel(): void {
    this.state = 'idle';
    this.timer = 0;
    this.fireBuffer = this.aimBuffer = 0;
    this.next = 0;
    this.quick = false;
    this.heavyOn = false;
    this.lungeTarget = null;
  }

  reset(): void {
    this.cancel();
    this.clock = 0;
    this.lastAttackAt = -10;
  }

  /** One swing of `id` from any weapon, on the melee key. */
  quickStrike(id: WeaponId = this.id): void {
    this.equip(id);
    this.next = 0;
    this.quick = true;
    this.startLight();
  }

  get inQuickStrike(): boolean {
    return this.quick && this.state === 'swing';
  }

  /** Runs every frame for the clock and the pull, whether or not a blade is out. */
  tick(dt: number): void {
    this.clock += dt;
    this.holdLunge(dt);
  }

  /** Quick strikes run with no button logic: one swing and hand the gun back. */
  updateQuick(dt: number): void {
    this.timer += dt;
    this.landSwing();
    if (this.timer >= this.length) {
      this.state = 'idle';
      this.quick = false;
    }
  }

  /** The swing still cuts: inside its live share, or for as long as a step or a dash is carrying the player in. */
  private live(): boolean {
    if (this.timer < this.impactAt) return false;
    const t = this.timer - this.impactAt;
    return t < this.length * this.def.liveFraction || this.lungeTarget !== null || (this.pulled && this.timer < this.length);
  }

  /** The blow lands at `impact` into the swing (the frame of the click for most), and cuts for as long as it is live. */
  private landSwing(): void {
    if (this.timer < this.impactAt) return;
    const first = !this.landed;
    this.landed = true;
    if (this.live()) this.swingScan();
    if (first) this.wallHit();
  }

  private get guarded(): boolean {
    return this.id === 'sword';
  }

  update(dt: number): void {
    const input = this.ctx.input;
    // A press during a swing is held until the swing ends: a queued attack never expires, as in the first game. Outside
    // a swing it has a short life, so a stray click does not fire a second later.
    const decay = this.state === 'swing' ? 0 : dt;
    const clicked = input.pressed('fire') || input.pressed('melee');
    this.fireBuffer = clicked ? SWORD.buffer : Math.max(0, this.fireBuffer - decay);
    this.aimBuffer = input.pressed('aim') ? SWORD.buffer : Math.max(0, this.aimBuffer - decay);
    const fireDown = input.isDown('fire');
    const aimDown = input.isDown('aim');
    const heavy = this.def.heavy;

    switch (this.state) {
      case 'idle':
        // A fresh click beats a held button on either side; a held LMB auto-chains, as in the first game.
        if (this.fireBuffer > 0) this.startLight();
        else if (this.guarded && (this.aimBuffer > 0 || aimDown)) this.startWindup();
        else if (heavy && (this.aimBuffer > 0 || aimDown)) this.startHeavy(heavy);
        else if (fireDown) this.startLight();
        break;

      case 'swing':
        this.timer += dt;
        this.landSwing();
        if (this.timer >= this.length) {
          // The finisher needs swing 2 or 3 behind it. A press during swing 1 falls through to a wind-up.
          const canFinish = this.guarded && !this.heavyOn && this.swingIndex >= 1;
          if (canFinish && (this.aimBuffer > 0 || aimDown)) this.startFinisher();
          else if (this.fireBuffer > 0 || fireDown) this.startLight();
          else if (heavy && (this.aimBuffer > 0 || aimDown)) this.startHeavy(heavy);
          else this.state = 'idle';
        }
        break;

      case 'windup': {
        this.timer += dt;
        this.ctx.viewmodel.setCharge(clamp(this.timer / SWORD.windup.full));
        if (!aimDown) this.startArea();
        break;
      }

      case 'area':
        this.timer += dt;
        if (this.timer < this.length * 0.5) this.areaScan();
        if (this.timer >= this.length) this.state = 'idle';
        break;

      case 'finisher':
        this.timer += dt;
        if (!this.blasted && this.timer >= this.seconds(SWORD.finisher.delay)) this.finisherBlast();
        if (this.timer >= this.length) {
          this.state = 'idle';
          this.next = 0;
        }
        break;
    }
  }

  // -------------------------------------------------------------------------------------------
  // Attacks
  // -------------------------------------------------------------------------------------------

  private beginAttack(state: State, seconds: number): void {
    this.state = state;
    this.timer = 0;
    this.length = seconds;
    this.struck.length = 0;
    this.hitCount = this.killCount = 0;
    this.fireBuffer = this.aimBuffer = 0;
    this.pulled = false;
  }

  /** Builds the swing plane from the view. `sx`, `sy` is the blade's direction across the screen. */
  private setPlane(sx: number, sy: number): void {
    const fwd = this.ctx.player.forward;
    sweepDirection(fwd, sx, sy, this.sweepDir);
    this.planeNormal.crossVectors(fwd, this.sweepDir).normalize();
  }

  private emitFired(): void {
    const { player, events } = this.ctx;
    events.emit('weapon:fired', { weapon: this.id, origin: player.eye, dir: player.forward });
  }

  /**
   * The cut happens on the true swing plane, but that plane contains the eye, so a crescent drawn on it is a hairline
   * from first person. This one is turned about the blade's direction by `tilt`, which opens it to the camera, and is
   * placed so its apex crosses the view `apex` meters ahead with both tips trailing off the edges of the screen.
   */
  private crescent(arc: number, apex: number, radius: number, tilt: number, kind: SlashKind): void {
    const { player, fx } = this.ctx;
    const fwd = player.forward;
    const reach = this.vC.copy(fwd).multiplyScalar(Math.cos(tilt)).addScaledVector(this.planeNormal, Math.sin(tilt));
    const normal = this.vD.crossVectors(reach, this.sweepDir);
    // Led by the player's velocity, or a fast mover outruns their own swing.
    const center = this.vA.copy(player.eye).addScaledVector(fwd, apex).addScaledVector(reach, -radius).addScaledVector(player.velocity, 0.08);
    const half = arc / 2;
    const start = this.vB.copy(reach).multiplyScalar(Math.cos(half)).addScaledVector(this.sweepDir, -Math.sin(half));
    fx.slash(center, normal, start, arc, radius, kind);
  }

  private startLight(): void {
    const d = this.def;
    if (this.clock - this.lastAttackAt > d.comboWindow) this.next = 0;
    this.swingIndex = this.next % d.chain.length;
    this.next = (this.swingIndex + 1) % d.chain.length;
    this.lastAttackAt = this.clock;
    this.heavyOn = false;
    this.beginSwing(d.chain[this.swingIndex]!);
  }

  private startHeavy(swing: MeleeSwing): void {
    this.heavyOn = true;
    // The heavy ends the chain: the next click starts it again.
    this.next = 0;
    this.lastAttackAt = this.clock;
    this.beginSwing(swing);
  }

  private beginSwing(swing: MeleeSwing): void {
    const c = this.ctx;
    this.swing = swing;
    const seconds = this.seconds(swing.seconds);
    this.beginAttack('swing', seconds);
    this.setPlane(swing.sweep[0], swing.sweep[1]);
    c.viewmodel.swing(swing.move, seconds);
    c.audio.play(swing.sound, { pitch: swing.pitch ?? 1, pitchJitter: 0.05 });
    if (this.id === 'sword') {
      const extra = SWORD.chain[this.swingIndex]?.extra;
      if (extra) c.audio.play(extra);
      this.crescent(LIGHT_ARC, 2.2, 2.5 + this.swingIndex * 0.25, LIGHT_TILT, this.swingIndex === 2 ? 'heavy' : 'light');
    } else if (this.def.type === 'slash' && !swing.thrust) {
      // A short blade leaves a short, low trail. Clubs leave none: a crescent says edge.
      this.crescent(1.6, 1.3, 1.5, LIGHT_TILT, 'light');
    }
    if (swing.fov) c.camera.fovPunch(swing.fov, 0.14);
    c.camera.kick(swing.kick[0], swing.kick[1], swing.kick[2]);

    this.approach(swing);
    this.impactAt = seconds * (swing.impact ?? 0);
    this.landed = false;
    this.landSwing();
    this.emitFired();
  }

  private startWindup(): void {
    const c = this.ctx;
    this.beginAttack('windup', 0);
    c.viewmodel.swing('windup', SWORD.windup.full);
    c.audio.play('sword_windup');
  }

  private startArea(): void {
    const c = this.ctx;
    const a = SWORD.area;
    this.power = lerp(SWORD.windup.tapPower, 1, clamp(this.timer / SWORD.windup.full));
    const seconds = this.seconds(a.seconds);
    this.beginAttack('area', seconds);
    c.viewmodel.setCharge(0);
    this.setPlane(-1, 0);
    c.viewmodel.swing('area', seconds);
    c.audio.play('sword_swing');
    c.audio.play('sword_sweep');
    const reach = BLADE_OLD ? a.reach : KATANA.area.reach + 0.6;
    this.crescent(a.halfArc * 2, BLADE_OLD ? 3 : 2.4, reach * lerp(0.6, 0.92, this.power), AREA_TILT, 'sweep');
    // Shakes on a whiff too: the first game's 15x contrast lives on the swing, not the contact.
    this.combat.feel.shake(a.shake * this.power);
    c.camera.fovPunch(4 * this.power, 0.2);
    c.camera.kick(0, -0.03, 0.025);
    this.areaScan();
    this.emitFired();
  }

  private startFinisher(): void {
    const c = this.ctx;
    const f = SWORD.finisher;
    const seconds = this.seconds(f.seconds);
    this.beginAttack('finisher', seconds);
    this.blasted = false;
    this.setPlane(0, -1);
    c.viewmodel.swing('finisher', seconds);
    c.audio.play('sword_swing');
    c.audio.play('sword_slam');
    this.crescent(2.6, 2.4, 3.2, LIGHT_TILT, 'finisher');
    c.camera.kick(0.03, 0, 0);
    this.emitFired();
  }

  private finisherBlast(): void {
    const c = this.ctx;
    const f = SWORD.finisher;
    this.blasted = true;
    this.next = 0;
    const { player } = c;
    const fwd = player.forward;
    // Lands on what the blade would strike: the floor ahead, or a wall if one is closer.
    const at = this.vA;
    const reach = c.physics.raycast(player.eye, fwd, f.ahead, CG.World);
    if (reach) at.copy(reach.point).addScaledVector(reach.normal, 0.2);
    else at.copy(player.eye).addScaledVector(fwd, f.ahead);
    const floor = c.physics.raycast(at, this.vB.set(0, -1, 0), 8, CG.World);
    if (floor && !reach) at.copy(floor.point).addScaledVector(floor.normal, 0.2);

    c.camera.fovPunch(-6, 0.22);
    c.camera.kick(-0.05, 0, 0);
    c.render.post.flash(0xffffff, 0.45, 0.16);
    c.render.post.radialBlur(0.3, 0.2);
    this.combat.explode(at, {
      radius: f.radius, damage: f.damage * this.modifiers.damage, kind: 'finisher', source: 'sword_finisher', team: 'player',
      selfDamage: 0, playerPush: 0, normal: floor?.normal,
    });
    this.combat.feel.stop(f.hitStop, true);
    // Heavy shake is never distance-scaled for the sword: the player is always at the blast.
    this.combat.feel.shake(f.shake);
  }

  // -------------------------------------------------------------------------------------------
  // Closing the gap
  // -------------------------------------------------------------------------------------------

  /** A step for a body just out of reach, or, with the katana out of a run, the dash. */
  private approach(swing: MeleeSwing): void {
    if (this.id === 'sword' && BLADE_OLD) {
      this.lungeOld();
      return;
    }
    if (this.id === 'sword' && !this.heavyOn && this.dash(swing)) return;
    this.stepIn(swing);
  }

  /** The nearest body the swing would reach with the step taken, and not without it, pulled toward. */
  private stepIn(swing: MeleeSwing): void {
    const d = this.def;
    if (d.step <= 0) return;
    this.fillShape(swing, swing.reach + d.step);
    const c = this.ctx;
    const eye = c.player.eye;
    const n = Math.min(c.enemies.query(eye, swing.reach + d.step + 3, this.list) || 0, MAX_LIST);
    let best: EnemyInstance | null = null;
    let bestSurface = Infinity;
    let bestRadius = 0;
    for (let i = 0; i < n; i++) {
      const e = this.list[i]!;
      if (!e.alive) continue;
      const surface = this.touch(e);
      if (surface < 0 || surface <= swing.reach || surface >= bestSurface) continue;
      if (this.blocked(eye, this.contact, this.body.radius)) continue;
      best = e;
      bestSurface = surface;
      bestRadius = this.body.radius;
    }
    if (!best) return;
    this.pull(best, d.stepSpeed, d.step / d.stepSpeed + 0.06, swing.reach - ARRIVE_INSIDE + bestRadius);
  }

  /**
   * The katana's own move: running at someone ahead, the swing carries the player to them at dash speed. Standing still it
   * never fires, so a swing never reaches further than a step.
   */
  private dash(swing: MeleeSwing): boolean {
    const D = KATANA.dash;
    const c = this.ctx;
    const player = c.player;
    const fwd = player.forward;
    const flat = this.vB.set(fwd.x, 0, fwd.z);
    if (flat.lengthSq() < 1e-6) return false;
    flat.normalize();
    if (player.velocity.dot(flat) < D.from) return false;
    const eye = player.eye;
    const n = c.enemies.query(eye, D.range, this.list) || 0;
    let best: EnemyInstance | null = null;
    let bestScore = 0;
    for (let i = 0; i < n; i++) {
      const e = this.list[i]!;
      if (!e.alive) continue;
      const to = this.vA.subVectors(e.center, eye);
      const dist = to.length();
      if (dist < 1e-3 || dist > D.range) continue;
      const dot = to.dot(fwd) / dist;
      if (dot < D.cone) continue;
      const score = dot / dist;
      if (score > bestScore) {
        bestScore = score;
        best = e;
      }
    }
    if (!best) return false;
    const radius = this.radiusOf(best);
    const to = this.vA.subVectors(best.center, eye);
    to.y = 0;
    const dist = to.length();
    const stop = swing.reach - ARRIVE_INSIDE + radius;
    if (dist <= stop + swing.reach * 0.25) return false;
    if (c.physics.raycast(eye, to.divideScalar(dist), dist - radius, CG.World)) return false;
    this.pull(best, D.speed, D.seconds, stop);
    c.camera.fovPunch(D.fov, 0.18);
    c.audio.play('blade_dash', { pitchJitter: 0.04 });
    return true;
  }

  /** The first game's lunge, for `?blade=old`: any swing, standing or not, pulls toward a target out to 10 m. */
  private lungeOld(): void {
    const c = this.ctx;
    const L = SWORD.lunge;
    const player = c.player;
    const eye = player.eye;
    const fwd = player.forward;
    const n = c.enemies.query(eye, L.range, this.list) || 0;
    let best: EnemyInstance | null = null;
    let bestScore = 0;
    for (let i = 0; i < n; i++) {
      const e = this.list[i]!;
      if (!e.alive) continue;
      const to = this.vA.subVectors(e.center, eye);
      const d = to.length();
      if (d < 1e-3) continue;
      const dot = to.dot(fwd) / d;
      if (dot < L.cone) continue;
      const score = dot / d;
      if (score > bestScore) {
        bestScore = score;
        best = e;
      }
    }
    if (!best) return;
    const to = this.vA.subVectors(best.center, eye);
    to.y = 0;
    const dist = to.length();
    if (dist <= L.stopShort) return;
    if (c.physics.raycast(eye, to.divideScalar(dist), dist, CG.World)) return;
    this.pull(best, L.speed, L.seconds, L.stopShort);
  }

  private pull(target: EnemyInstance, speed: number, seconds: number, stop: number): void {
    this.lungeTarget = target;
    this.lungeSpeed = speed;
    this.lungeSeconds = seconds;
    this.lungeLeft = seconds;
    this.lungeStop = stop;
    this.pulled = true;
    this.holdLunge(0);
  }

  /**
   * Ground friction takes a one-off shove back within a few ticks, about a meter of travel, so the pull is renewed every
   * frame and follows the target. Written to velocity because launch() would throw the player off the floor and end a slide.
   */
  private holdLunge(dt: number): void {
    const target = this.lungeTarget;
    if (!target) return;
    this.lungeLeft -= dt;
    const { player } = this.ctx;
    const to = this.vA.subVectors(target.center, player.eye);
    to.y = 0;
    const dist = to.length();
    if (!target.alive || this.lungeLeft <= 0 || dist <= this.lungeStop) {
      this.lungeTarget = null;
      return;
    }
    to.divideScalar(dist);
    // What is left over the time left, so a step arrives as its time runs out. The first game's lunge spread it over the
    // whole dash and never quite arrived; `?blade=old` keeps that.
    const over = BLADE_OLD && this.id === 'sword' ? this.lungeSeconds : Math.max(this.lungeLeft, 1 / 60);
    const want = Math.min(this.lungeSpeed, (dist - this.lungeStop) / over);
    const need = want - player.velocity.dot(to);
    if (need > 0) player.velocity.addScaledVector(to, need);
  }

  // -------------------------------------------------------------------------------------------
  // What a swing touches
  // -------------------------------------------------------------------------------------------

  private radiusOf(e: EnemyInstance): number {
    const r = (e as unknown as Balance).def?.radius;
    if (r === undefined) return BODY_RADIUS.fallback;
    return clamp(r * BODY_RADIUS.share, BODY_RADIUS.least, BODY_RADIUS.most);
  }

  private fillShape(swing: MeleeSwing, reach: number): void {
    const s = this.shape;
    s.reach = reach;
    s.arc = swing.arc;
    s.width = swing.width;
    s.thrust = swing.thrust === true;
    s.pointBlank = this.def.pointBlank;
    s.dip = REACH_DOWN;
    const f = this.frame;
    f.eye.copy(this.ctx.player.eye);
    f.forward.copy(this.ctx.player.forward);
    f.sweep.copy(this.sweepDir);
  }

  /** Meters from the eye to where the current shape meets `e`, or -1. Leaves the struck point in `contact`. */
  private touch(e: EnemyInstance): number {
    const b = this.body;
    b.base.copy(e.position);
    b.height = (e as unknown as Balance).downed === true ? Math.min(DOWNED_HEIGHT, e.char.rig.height) : e.char.rig.height;
    b.radius = this.radiusOf(e);
    return swingTouches(this.shape, this.frame, b, this.contact);
  }

  /** A wall between the eye and the near side of the body. */
  private blocked(eye: THREE.Vector3, at: THREE.Vector3, radius: number): boolean {
    const dir = this.vC.subVectors(at, eye);
    const dist = dir.length();
    if (dist < 1e-3) return false;
    dir.divideScalar(dist);
    return this.ctx.physics.raycast(eye, dir, Math.max(0.05, dist - radius), CG.World) !== null;
  }

  private swingScan(): void {
    const swing = this.swing;
    const row = WEAPONS[this.id];
    const n = this.hitCount;
    const k = this.killCount;
    const source = this.id === 'sword' ? 'sword' : this.id;
    const damage = row.damage * swing.mult * this.modifiers.damage;
    if (this.id === 'sword' && BLADE_OLD) this.scanCone(SWORD.reach, SWORD.halfArc, damage, source, row.force);
    else {
      this.fillShape(swing, swing.reach);
      this.scan(damage, source);
    }
    if (this.hitCount === n) return;
    const kills = this.killCount - k;
    const extra = this.hitCount - n - 1;
    const stop = (kills > 0 ? swing.killStop : swing.hitStop) + extra * STOP_PER_EXTRA;
    this.combat.feel.stop(Math.min(stop, STOP_MAX), true);
    // Only on contact, and only once per swing: this restraint is what makes the heavy attacks land.
    if (n === 0) this.combat.feel.shake(swing.shake);
    this.ctx.hud.hitMarker(kills > 0 ? 'kill' : 'body');
  }

  private areaScan(): void {
    const c = this.ctx;
    const a = SWORD.area;
    const n = this.hitCount;
    const k = this.killCount;
    const damage = a.damage * this.power * this.modifiers.damage;
    if (BLADE_OLD) this.scanCone(a.reach * lerp(0.7, 1, this.power), a.halfArc, damage, 'sword_area', a.force);
    else {
      const s = this.shape;
      const A = KATANA.area;
      s.reach = A.reach * lerp(0.7, 1, this.power);
      s.arc = A.arc;
      s.width = A.width;
      s.thrust = false;
      s.pointBlank = this.def.pointBlank;
      s.dip = REACH_DOWN;
      this.frame.eye.copy(c.player.eye);
      this.frame.forward.copy(c.player.forward);
      this.frame.sweep.copy(this.sweepDir);
      this.scan(damage, 'sword_area', a.force);
    }
    if (this.hitCount === n) return;
    const kills = this.killCount - k;
    const extra = this.hitCount - n - 1;
    this.combat.feel.stop(Math.min((kills > 0 ? a.killStop : a.hitStop) + extra * STOP_PER_EXTRA, STOP_MAX), true);
    c.hud.hitMarker(kills > 0 ? 'kill' : 'body');
  }

  /** Every body the current shape touches and the eye can see, struck once a swing. */
  private scan(damage: number, source: string, force?: number): void {
    const c = this.ctx;
    const eye = c.player.eye;
    const n = Math.min(c.enemies.query(eye, this.shape.reach + 3, this.list) || 0, MAX_LIST);
    this.slicesLeft = MAX_SLICES_PER_FRAME;
    for (let i = 0; i < n; i++) {
      const e = this.list[i]!;
      if (!e.alive || this.struck.includes(e)) continue;
      if (this.touch(e) < 0) continue;
      const radius = this.body.radius;
      if (this.blocked(eye, this.contact, radius)) continue;
      const dir = this.vB.subVectors(this.contact, eye);
      const dist = dir.length();
      if (dist > 1e-3) dir.divideScalar(dist);
      else dir.copy(c.player.forward);
      this.struck.push(e);
      this.strike(e, this.contact, dir, damage, source, force);
    }
  }

  /** The first game's test, for `?blade=old`: the nearest point of the body inside a cone from the eye. */
  private scanCone(reach: number, halfArc: number, damage: number, source: string, force: number): void {
    const c = this.ctx;
    const eye = c.player.eye;
    const fwd = c.player.forward;
    const cos = Math.cos(halfArc);
    const n = Math.min(c.enemies.query(eye, reach + 2.5, this.list) || 0, MAX_LIST);
    const near = this.vA;
    const top = this.vD;
    const dir = this.vB;
    this.slicesLeft = MAX_SLICES_PER_FRAME;
    for (let i = 0; i < n; i++) {
      const e = this.list[i]!;
      if (!e.alive || this.struck.includes(e)) continue;
      top.copy(e.position);
      top.y += e.char.rig.height;
      closestOnSegment(eye, e.position, top, near);
      const dist = eye.distanceTo(near);
      if (dist > reach + OLD_BODY_RADIUS) continue;
      dir.subVectors(near, eye);
      if (dist > 1e-3) dir.divideScalar(dist);
      else dir.copy(fwd);
      if (dist > OLD_POINT_BLANK && clamp(dir.dot(fwd), -1, 1) < cos) continue;
      if (c.physics.raycast(eye, dir, dist, CG.World)) continue;
      this.struck.push(e);
      this.contact.copy(near);
      this.strike(e, this.contact, dir, damage, source, force);
    }
  }

  /** Cannot defend itself: struck from behind, reeling, falling, down or getting up. Read off the real enemy when there is one. */
  private openTo(e: EnemyInstance, dir: THREE.Vector3, behind: number): boolean {
    const b = e as unknown as Balance;
    if ((b.stagger ?? 0) > 0 || b.downed === true || (b.rising ?? 0) > 0 || (b.fallIn ?? 0) > 0) return true;
    // Its facing is +Z turned by yaw. The strike going the way it faces is a strike in the back.
    const fx = Math.sin(e.yaw);
    const fz = Math.cos(e.yaw);
    const flat = Math.hypot(dir.x, dir.z);
    if (flat < 1e-4) return false;
    return (dir.x * fx + dir.z * fz) / flat >= behind;
  }

  /**
   * One body struck. Which part: a ray from the eye at the point the swing met it. A blade counts a head as the chest, as a
   * sword cut always has; a club lands where it lands, and the reactions and wounds take it from there.
   */
  private strike(e: EnemyInstance, near: THREE.Vector3, dir: THREE.Vector3, damage: number, source: string, force?: number): void {
    const c = this.ctx;
    const d = this.def;
    const swing = this.swing;
    const row = WEAPONS[this.id];
    const eye = c.player.eye;
    const type: DamageType = this.state === 'area' ? 'slash' : swing.type ?? d.type;
    const blunt = type === 'melee';
    const ray = this.vD.copy(dir);
    let hit: ReturnType<Ctx['gore']['raycastCharacter']> = null;
    if (blunt && !swing.thrust && this.state === 'swing') {
      // A club's flat swing comes in from the side: at the arm on that side, then the middle if the ray passes the body.
      const right = this.vC.set(-dir.z, 0, dir.x);
      if (right.lengthSq() > 1e-8) {
        right.normalize();
        const across = -this.sweepDir.dot(right) * this.radiusOf(e);
        for (let i = 0; i < SIDE_BLOW.length && !hit; i++) {
          const side = this.vA.copy(near).addScaledVector(right, across * SIDE_BLOW[i]!).sub(eye);
          const reach = side.length();
          if (reach > 1e-3) hit = c.gore.raycastCharacter(e.char, eye, side.divideScalar(reach), reach + 1.5);
        }
      }
    }
    hit ??= c.gore.raycastCharacter(e.char, eye, ray, eye.distanceTo(near) + 1.5);
    let region: GoreRegion | undefined = hit?.region;
    let bone = hit?.bone;
    if (!hit || (region === 'head' && !d.heads)) {
      region = 'chest';
      bone = undefined;
    }
    let amount = damage;
    if (d.bonus && this.state === 'swing' && this.openTo(e, dir, d.bonus.behind)) amount *= d.bonus.mult;

    const point = hit ? hit.point : near;
    const o = this.combat.strikeOptions(type, source);
    o.force = force ?? swing.force ?? row.force;
    o.headshotMult = row.headshotMult;
    const sever = this.state === 'swing' ? swing.sever ?? row.severMult : row.severMult;
    // A blow takes nothing off, Butcher or not: a club breaks what it lands on. A blade under Butcher takes everything.
    o.severMult = blunt ? 0 : this.modifiers.alwaysSever ? 1000 : row.canSever ? sever : 0;
    o.charge = d.armour;
    o.quiet = true;
    if (d.slices && this.slicesLeft > 0) o.slicePlaneNormal = this.planeNormal;
    else if (d.beheads && type === 'slash' && region === 'head' && this.neckOf(e)) {
      // An edge on the head takes it at the neck: the cut goes across the neck, whichever way the swing went.
      o.slicePlaneNormal = this.neckNormal;
      point.copy(this.neck);
    }
    // The push goes along the blade, so a sideways cut throws the body sideways.
    const push = this.push.copy(this.sweepDir).multiplyScalar(0.7).add(dir).normalize();
    const res = this.combat.strike(e, point, this.vD.copy(dir).negate(), push, bone, region, amount, o);
    this.hitCount++;

    if (res.blocked) {
      c.fx.sparks(point, this.vD, d.sparks + 8, 0xfff2cc);
      c.audio.play(d.armourSound, { position: point, pitchJitter: 0.08 });
      return;
    }
    if (res.killed) {
      this.killCount++;
      if (o.slicePlaneNormal) this.slicesLeft--;
      if (swing.fling && this.state === 'swing') this.fling(e, push, swing.fling);
    }
    if (e.machine) {
      c.fx.sparks(point, this.vD, d.sparks, 0xfff2cc);
      c.audio.play(d.machine, { position: point, pitchJitter: 0.06 });
      return;
    }
    // The first game's stack for a blade: a blade, a blade and a body, every one of them on every enemy touched.
    c.audio.play(d.flesh, { position: point, pitchJitter: 0.04 });
    if (type === 'slash') {
      if (this.id === 'sword' || res.killed) c.audio.play('flesh_slice', { position: point });
      c.fx.bloodHit(point, push, res.killed ? 1.6 : 1.1);
      if (res.killed && d.slices) c.fx.bloodJet(point, push, 1);
    } else {
      // A blow: little blood, a lot of weight. The bone, if one goes, is gore's sound.
      c.fx.bloodHit(point, push, res.killed ? 0.8 : 0.45);
      if (region === 'head') c.audio.play('head_thud', { position: point, pitchJitter: 0.06 });
    }
  }

  /** The neck of a body, and the line from it to the head: where a beheading cut goes. False for a body with no head left. */
  private neckOf(e: EnemyInstance): boolean {
    const info = rigInfo(e.char.rig);
    const neck = info.severBone.get('head');
    if (neck === undefined || e.char.severed.has('head')) return false;
    const headBone = info.children[neck]?.[0] ?? neck;
    const bones = e.char.bones;
    this.neck.setFromMatrixPosition(bones[neck]!.matrixWorld);
    this.neckNormal.setFromMatrixPosition(bones[headBone]!.matrixWorld).sub(this.neck);
    if (this.neckNormal.lengthSq() < 1e-6) this.neckNormal.copy(UP);
    this.neckNormal.normalize();
    this.neck.addScaledVector(this.neckNormal, 0.03);
    return true;
  }

  /** Throws a body the face of the spade killed, the way a blast throws one, from just behind it along the swing. */
  private fling(e: EnemyInstance, push: THREE.Vector3, strength: number): void {
    const at = this.vC.copy(e.center).addScaledVector(push, -FLING_BACK);
    at.y -= 0.3;
    this.ctx.physics.radialImpulse(at, FLING_RADIUS, strength);
  }

  /** A swing that finds no body but does find a wall within its reach leaves a mark and bites back. */
  private wallHit(): void {
    if (this.hitCount > 0) return;
    const c = this.ctx;
    const eye = c.player.eye;
    const d = this.def;
    const reach = this.id === 'sword' && BLADE_OLD ? 3.2 : this.swing.reach + 0.2;
    const wall = c.physics.raycast(eye, c.player.forward, reach, CG.World);
    if (!wall) return;
    const row = WEAPONS[this.id];
    c.world.objects?.damageExplosive(wall.collider, row.damage * this.swing.mult * this.modifiers.damage, this.id);
    const size = d.wallDecal === 'slash' ? rand(0.9, 1.3) * (this.id === 'knife' ? 0.5 : 1) : rand(0.35, 0.5);
    c.render.decals.add(d.wallDecal, wall.point, wall.normal, size, Math.atan2(this.sweepDir.y, this.sweepDir.x));
    c.fx.sparks(wall.point, wall.normal, d.sparks, 0xfff2cc);
    c.audio.play(d.wall, { position: wall.point, volume: 0.7, pitchJitter: 0.08 });
    c.camera.kick(0.006 * (row.damage / 75 + 0.5), 0, 0);
  }

  /**
   * Blocks a shot arriving from the front while the guard is up. The first moments of a press parry it back; after that
   * the blade just stops it. The katana's alone.
   */
  guard(incoming: THREE.Vector3): GuardResult {
    if (this.state !== 'windup') return 'none';
    const w = SWORD.windup;
    if (-incoming.dot(this.ctx.player.forward) < w.cone) return 'none';
    const parry = this.timer <= w.parryWindow;
    this.ctx.viewmodel.swing('block', 0.16);
    return parry ? 'parry' : 'block';
  }
}
