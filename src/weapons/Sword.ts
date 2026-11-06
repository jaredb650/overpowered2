/**
 * The sword. Light swings land on the frame of the click, as in the first game, and stay live for most
 * of the swing, because a player moving at 30 m/s reaches targets the blade has not finished with.
 *
 * Decisions the first game left to accident (docs/original/04 section 17):
 *  - Wind-up charge matters: a tap is a weak sweep, 0.3 s of hold is the full one.
 *  - The finisher ends the chain, so its 650 ms loop is gone.
 *  - Blood Thirst and every other damage modifier applies to all three attack types.
 *  - Everything runs on player time, so swings stay full speed in SLOWMO.
 */
import * as THREE from 'three';
import { CG, type Ctx, type SlashKind } from '../core/contracts';
import type { EnemyInstance, WeaponModifiers } from '../core/gameplay';
import type { GoreRegion } from '../characters/rig';
import { clamp, lerp, rand } from '../core/math';
import type { Combat, GuardResult } from './Combat';
import { SWORD, WEAPONS, type SwingDef } from './data';
import { closestOnSegment } from './geometry';

type SwordState = 'idle' | 'swing' | 'windup' | 'area' | 'finisher';

const UP = new THREE.Vector3(0, 1, 0);
const MAX_LIST = 48;
/** Inside this range the cone test is skipped: an enemy on top of you is always in the arc. */
const POINT_BLANK = 1.7;
const BODY_RADIUS = 0.35;
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

export class Sword {
  private state: SwordState = 'idle';
  private timer = 0;
  private length = 0;
  private clock = 0;
  private lastAttackAt = -10;
  /** Index of the next swing in the chain. */
  private next = 0;
  private swing: SwingDef = SWORD.chain[0]!;
  private swingIndex = 0;
  private fireBuffer = 0;
  private aimBuffer = 0;
  private power = 1;
  private blasted = false;
  private quick = false;
  private lungeTarget: EnemyInstance | null = null;
  private lungeLeft = 0;

  private readonly struck: EnemyInstance[] = [];
  private readonly list: EnemyInstance[] = [];
  private hitCount = 0;
  private killCount = 0;
  private slicesLeft = 0;

  /** Swing plane for the current attack, in world space. */
  private readonly planeNormal = new THREE.Vector3();
  private readonly sweepDir = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly camUp = new THREE.Vector3();
  private readonly vA = new THREE.Vector3();
  private readonly vB = new THREE.Vector3();
  private readonly vC = new THREE.Vector3();
  private readonly vD = new THREE.Vector3();
  private readonly push = new THREE.Vector3();

  constructor(private readonly ctx: Ctx, private readonly combat: Combat, private readonly modifiers: WeaponModifiers) {}

  /** The finisher has been committed to and not landed. Switching now would drop the blast. */
  get committed(): boolean {
    return this.state === 'finisher' && !this.blasted;
  }

  get step(): number {
    return this.clock - this.lastAttackAt > SWORD.comboWindow ? 0 : this.next;
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
    this.lungeTarget = null;
  }

  reset(): void {
    this.cancel();
    this.clock = 0;
    this.lastAttackAt = -10;
  }

  /** One swing from any weapon, on the melee key. */
  quickStrike(): void {
    this.next = 0;
    this.quick = true;
    this.startLight();
  }

  get inQuickStrike(): boolean {
    return this.quick && this.state === 'swing';
  }

  /** Runs every frame for the clock and the lunge, whether or not the sword is out. */
  tick(dt: number): void {
    this.clock += dt;
    this.holdLunge(dt);
  }

  /** Quick strikes run with no button logic: one swing and hand the gun back. */
  updateQuick(dt: number): void {
    this.timer += dt;
    if (this.timer < this.length * SWORD.liveFraction) this.lightScan();
    if (this.timer >= this.length) {
      this.state = 'idle';
      this.quick = false;
    }
  }

  update(dt: number): void {
    const input = this.ctx.input;
    // A press during a swing is held until the swing ends: a queued attack never expires, as in the
    // first game. Outside a swing it has a short life, so a stray click does not fire a second later.
    const decay = this.state === 'swing' ? 0 : dt;
    const clicked = input.pressed('fire') || input.pressed('melee');
    this.fireBuffer = clicked ? SWORD.buffer : Math.max(0, this.fireBuffer - decay);
    this.aimBuffer = input.pressed('aim') ? SWORD.buffer : Math.max(0, this.aimBuffer - decay);
    const fireDown = input.isDown('fire');
    const aimDown = input.isDown('aim');

    switch (this.state) {
      case 'idle':
        // A fresh click beats a held button on either side; a held LMB auto-chains, as in the first game.
        if (this.fireBuffer > 0) this.startLight();
        else if (this.aimBuffer > 0 || aimDown) this.startWindup();
        else if (fireDown) this.startLight();
        break;

      case 'swing':
        this.timer += dt;
        if (this.timer < this.length * SWORD.liveFraction) this.lightScan();
        if (this.timer >= this.length) {
          // The finisher needs swing 2 or 3 behind it. A press during swing 1 falls through to a wind-up.
          const canFinish = this.swingIndex >= 1;
          if (canFinish && (this.aimBuffer > 0 || aimDown)) this.startFinisher();
          else if (this.fireBuffer > 0 || fireDown) this.startLight();
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

  private beginAttack(state: SwordState, seconds: number): void {
    this.state = state;
    this.timer = 0;
    this.length = seconds;
    this.struck.length = 0;
    this.hitCount = this.killCount = 0;
    this.fireBuffer = this.aimBuffer = 0;
  }

  /** Builds the swing plane from the view. `sweep` is the blade's direction across the screen. */
  private setPlane(sx: number, sy: number): void {
    const fwd = this.ctx.player.forward;
    this.right.crossVectors(fwd, UP);
    if (this.right.lengthSq() < 1e-4) this.right.set(1, 0, 0);
    this.right.normalize();
    this.camUp.crossVectors(this.right, fwd).normalize();
    this.sweepDir.copy(this.right).multiplyScalar(sx).addScaledVector(this.camUp, sy).normalize();
    this.planeNormal.crossVectors(fwd, this.sweepDir).normalize();
  }

  private emitFired(): void {
    const { player, events } = this.ctx;
    events.emit('weapon:fired', { weapon: 'sword', origin: player.eye, dir: player.forward });
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
    const c = this.ctx;
    if (this.clock - this.lastAttackAt > SWORD.comboWindow) this.next = 0;
    this.swingIndex = this.next;
    this.swing = SWORD.chain[this.swingIndex]!;
    this.next = (this.next + 1) % SWORD.chain.length;
    this.lastAttackAt = this.clock;

    const seconds = this.seconds(this.swing.seconds);
    this.beginAttack('swing', seconds);
    this.setPlane(this.swing.sweep[0], this.swing.sweep[1]);
    c.viewmodel.swing(this.swing.move, seconds);
    c.audio.play('sword_swing', { pitchJitter: 0.05 });
    if (this.swing.extra) c.audio.play(this.swing.extra);
    this.crescent(LIGHT_ARC, 2.2, 2.5 + this.swingIndex * 0.25, LIGHT_TILT, this.swingIndex === 2 ? 'heavy' : 'light');
    if (this.swing.fov) c.camera.fovPunch(this.swing.fov, 0.14);
    c.camera.kick(this.swing.kick[0], this.swing.kick[1], this.swing.kick[2]);

    this.lunge();
    this.lightScan();
    this.wallCut();
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
    this.crescent(a.halfArc * 2, 3, a.reach * lerp(0.6, 0.92, this.power), AREA_TILT, 'sweep');
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

  /** Picks who the swing is aimed at. The pull itself runs from tick(), for as long as the dash lasts. */
  private lunge(): void {
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
    this.lungeTarget = best;
    this.lungeLeft = L.seconds;
    this.holdLunge(0);
  }

  /**
   * Ground friction takes a one-off shove back within a few ticks, about a meter of travel, so the pull is renewed every
   * frame of the dash and follows the target. Written to velocity because launch() would throw the player off the floor
   * and end a slide.
   */
  private holdLunge(dt: number): void {
    const target = this.lungeTarget;
    if (!target) return;
    this.lungeLeft -= dt;
    const L = SWORD.lunge;
    const { player } = this.ctx;
    const to = this.vA.subVectors(target.center, player.eye);
    to.y = 0;
    const dist = to.length();
    if (!target.alive || this.lungeLeft <= 0 || dist <= L.stopShort) {
      this.lungeTarget = null;
      return;
    }
    to.divideScalar(dist);
    const want = Math.min(L.speed, (dist - L.stopShort) / L.seconds);
    const need = want - player.velocity.dot(to);
    if (need > 0) player.velocity.addScaledVector(to, need);
  }

  private lightScan(): void {
    const c = this.ctx;
    const n = this.hitCount;
    const k = this.killCount;
    const damage = WEAPONS.sword.damage * this.swing.mult * this.modifiers.damage;
    this.scan(SWORD.reach, SWORD.halfArc, damage, 'sword', WEAPONS.sword.force);
    if (this.hitCount === n) return;
    const kills = this.killCount - k;
    const extra = this.hitCount - n - 1;
    const stop = (kills > 0 ? this.swing.killStop : this.swing.hitStop) + extra * STOP_PER_EXTRA;
    this.combat.feel.stop(Math.min(stop, STOP_MAX), true);
    // Only on contact, and only once per swing: this restraint is what makes the heavy attacks land.
    if (n === 0) this.combat.feel.shake(this.swing.shake);
    c.hud.hitMarker(kills > 0 ? 'kill' : 'body');
  }

  private areaScan(): void {
    const c = this.ctx;
    const a = SWORD.area;
    const n = this.hitCount;
    const k = this.killCount;
    const reach = a.reach * lerp(0.7, 1, this.power);
    const damage = a.damage * this.power * this.modifiers.damage;
    this.scan(reach, a.halfArc, damage, 'sword_area', a.force);
    if (this.hitCount === n) return;
    const kills = this.killCount - k;
    const extra = this.hitCount - n - 1;
    this.combat.feel.stop(Math.min((kills > 0 ? a.killStop : a.hitStop) + extra * STOP_PER_EXTRA, STOP_MAX), true);
    c.hud.hitMarker(kills > 0 ? 'kill' : 'body');
  }

  private scan(reach: number, halfArc: number, damage: number, source: string, force: number): void {
    const c = this.ctx;
    const player = c.player;
    const eye = player.eye;
    const fwd = player.forward;
    const cos = Math.cos(halfArc);
    const n = Math.min(c.enemies.query(eye, reach + 2.5, this.list) || 0, MAX_LIST);
    const near = this.vA;
    const top = this.vB;
    const dir = this.vC;
    this.slicesLeft = MAX_SLICES_PER_FRAME;
    for (let i = 0; i < n; i++) {
      const e = this.list[i]!;
      if (!e.alive || this.struck.includes(e)) continue;
      // Against the nearest point of the body, not the feet. That first-game test missed a target you were standing on.
      top.copy(e.position);
      top.y += e.char.rig.height;
      closestOnSegment(eye, e.position, top, near);
      const dist = eye.distanceTo(near);
      if (dist > reach + BODY_RADIUS) continue;
      dir.subVectors(near, eye);
      if (dist > 1e-3) dir.divideScalar(dist);
      else dir.copy(fwd);
      if (dist > POINT_BLANK && clamp(dir.dot(fwd), -1, 1) < cos) continue;
      if (c.physics.raycast(eye, dir, dist, CG.World)) continue;
      this.struck.push(e);
      this.cut(e, near, dir, damage, source, force);
    }
  }

  /** Which part the blade found. Heads are chest hits: a swing is not a headshot, as in the first game. */
  private cut(e: EnemyInstance, near: THREE.Vector3, dir: THREE.Vector3, damage: number, source: string, force: number): void {
    const c = this.ctx;
    const eye = c.player.eye;
    const to = this.vD.subVectors(e.center, eye).normalize();
    const hit = c.gore.raycastCharacter(e.char, eye, to, eye.distanceTo(e.center) + 1.5);
    let region: GoreRegion | undefined = hit?.region;
    let bone = hit?.bone;
    if (!hit || region === 'head') {
      region = 'chest';
      bone = undefined;
    }

    const point = hit ? hit.point : near;
    const o = this.combat.strikeOptions('slash', source);
    o.force = force;
    o.severMult = this.modifiers.alwaysSever ? 1000 : WEAPONS.sword.severMult;
    o.slicePlaneNormal = this.slicesLeft > 0 ? this.planeNormal : undefined;
    o.quiet = true;
    // The push goes along the blade, so a sideways cut throws the body sideways.
    const push = this.push.copy(this.sweepDir).multiplyScalar(0.7).add(dir).normalize();
    const res = this.combat.strike(e, point, this.vD.copy(dir).negate(), push, bone, region, damage, o);
    this.hitCount++;

    if (res.blocked) {
      c.fx.sparks(point, this.vD, 14, 0xfff2cc);
      c.audio.play('impact_armor', { position: point, pitchJitter: 0.08 });
      return;
    }
    if (res.killed) {
      this.killCount++;
      this.slicesLeft--;
    }
    // The first game's stack: a blade, a blade and a body, every one of them on every enemy touched.
    c.audio.play('sword_contact', { position: point, pitchJitter: 0.04 });
    c.audio.play('flesh_slice', { position: point });
    c.fx.bloodHit(point, push, res.killed ? 1.6 : 1.1);
    if (res.killed) c.fx.bloodJet(point, push, 1);
  }

  /** A swing that finds no body but does find a wall leaves a mark and bites back. */
  private wallCut(): void {
    if (this.hitCount > 0) return;
    const c = this.ctx;
    const eye = c.player.eye;
    const wall = c.physics.raycast(eye, c.player.forward, 3.2, CG.World);
    if (!wall) return;
    c.world.objects?.damageExplosive(wall.collider, WEAPONS.sword.damage * this.swing.mult * this.modifiers.damage, 'sword');
    c.render.decals.add('slash', wall.point, wall.normal, rand(0.9, 1.3), Math.atan2(this.sweepDir.y, this.sweepDir.x));
    c.fx.sparks(wall.point, wall.normal, 12, 0xfff2cc);
    c.audio.play('sword_hit2', { position: wall.point, volume: 0.7, pitchJitter: 0.08 });
    c.camera.kick(0.006, 0, 0);
  }

  /**
   * Blocks a shot arriving from the front while the guard is up. The first moments of a press parry it
   * back; after that the blade just stops it.
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
