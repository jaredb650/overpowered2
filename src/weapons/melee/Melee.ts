/**
 * Everything on key 5: the katana and the four that sit beside it. One class swings all of them, reading the row in
 * MELEE for the weapon in hand. What a swing touches is sweep.ts: the slab the blade passes through, out to its reach,
 * with a world ray from the eye to every body it finds, so nothing behind cover is struck.
 *
 * Light swings land on the frame of the click, as in the first game, and stay live for `liveFraction` of the swing, so a
 * body the player runs onto is still struck. A body just past reach is stepped into, a short pull of `step` meters. Only
 * the katana dashes: out of a run at someone ahead (KATANA.dash), and on a stab in a chain at someone just past its slashes
 * (KATANA.lock). Its right click is a stab, held it is the guard, and chains of slashes and stabs spell its combo moves
 * (combo.ts): the cleave, the tornado, the flying slash and the flurry.
 *
 *  - Blood Thirst and every other damage modifier applies to every attack.
 *  - Everything runs on player time, so swings stay full speed in SLOWMO.
 */
import * as THREE from 'three';
import { CG, type Ctx, type DamageType, type LoopHandle, type SlashKind } from '../../core/contracts';
import { toldKill, type EnemyInstance, type WeaponId, type WeaponModifiers } from '../../core/gameplay';
import type { GoreRegion } from '../../characters/rig';
import { clamp, rand } from '../../core/math';
import { rigInfo } from '../../gore/rigInfo';
import { MOVE } from '../../player/tuning';
import type { Combat, GuardResult, StrikeOptions } from '../Combat';
import { SWORD, WEAPONS } from '../data';
import { closestOnSegment } from '../geometry';
import { readCombo, type KatanaMove } from './combo';
import { BLADE_OLD, BODY_RADIUS, DOWNED_HEIGHT, ENERGY, KATANA, MELEE, REACH_DOWN, isMelee, type MeleeDef, type MeleeId, type MeleeSwing } from './data';
import { swingTouches, sweepDirection, type BodyShape, type SwingFrame, type SwingShape } from './sweep';

type State = 'idle' | 'swing' | 'guard';
/** What the katana's swing in progress is, past a plain slash. */
type Special = 'stab' | KatanaMove | null;

const UP = new THREE.Vector3(0, 1, 0);
const MAX_LIST = 48;
/** Each extra target on one swing adds less stop, or a big cleave would hang the game. */
const STOP_PER_EXTRA = 0.012;
const STOP_MAX = 0.13;
/** Crescent sweep in radians. */
const LIGHT_ARC = 2.1;
/** Radians the crescent is opened toward the camera. The sweep's radius is big enough that more would bury its tips in the floor. */
const LIGHT_TILT = 0.5;
/** A stab in a chain locks on to a body past this: the longest of the katana's slashes. */
const SLASH_REACH = Math.max(...MELEE.sword.chain.map(s => s.reach));
/** Meters of flight between two drawings of the flying slash. */
const WAVE_DRAW = 0.55;
/** Meters out before the flying slash is drawn at all: any nearer, it fills the view. */
const WAVE_SHOWN = 2;
/** The flying slash drawn: radians of its crescent, its radius, and how far it is opened toward the camera. */
const WAVE_ARC = 2.0;
const WAVE_RADIUS = 2.4;
const WAVE_TILT = 0.95;
const STAB_GLOW = 0xbfeeff;
/** The energy blade's light: what a cauterized cut spits instead of blood. */
const ENERGY_GLOW = 0x8fe6ff;
const WAVE_GLOW = 0x66e0ff;
/** A slice costs about 5 ms. Past this many on one frame the rest fall as ragdolls, so a big cleave cannot blow the frame. */
const MAX_SLICES_PER_FRAME = 3;
/** Meters inside its reach a step or a dash leaves a body, so the swing still live on arrival lands. */
const ARRIVE_INSIDE = 0.3;
/** Co-op guest: seconds after the blow the host's word of the kill may still throw the body. */
const LATE_FLING = 1.5;
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
  private fireBuffer = 0;
  private aimBuffer = 0;
  private quick = false;
  /** The katana's chain of inputs toward a combo move, and the special in progress. */
  private combo = '';
  private special: Special = null;
  /** The body a stab in a chain locked on to: the swing is aimed at him, wherever the crosshair is. */
  private aimAt: EnemyInstance | null = null;
  /** The flurry's stab last struck, 0 up. */
  private jab = 0;

  /** The flying slash in flight: where its leading edge is, its line, the way it lies across it, its plane, who it has cut. */
  private readonly wave = {
    on: false, travelled: 0, drawn: 0,
    pos: new THREE.Vector3(), dir: new THREE.Vector3(), across: new THREE.Vector3(), normal: new THREE.Vector3(),
    struck: [] as EnemyInstance[],
  };
  private readonly tip = new THREE.Vector3();

  /** A step or the katana's dash: who it pulls toward, for how long, how fast, and how close to their middle it stops. */
  private lungeTarget: EnemyInstance | null = null;
  private lungeLeft = 0;
  private lungeSpeed = 0;
  private lungeStop = 0;
  private lungeSeconds = 0;
  /** Speed along the pull the player keeps on arrival: the energy blade's long fast pull ends at a run, not past the body. */
  private lungeKeep = Infinity;
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
  /** The energy blade's hum while it is out, and whether it is pitched up for a swing. */
  private hum: LoopHandle | null = null;
  private humUp = false;

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

  /** The cleave has been swung and not landed. Switching now would drop it. */
  get committed(): boolean {
    return this.state === 'swing' && this.special === 'cleave' && !this.landed;
  }

  get step(): number {
    return this.clock - this.lastAttackAt > this.comboWindow ? 0 : this.next;
  }

  /** The katana with the energy blade fitted (ENERGY). */
  get energy(): boolean {
    return this.id === 'sword' && this.ctx.weapons?.fitted?.has('swordEnergy') === true;
  }

  /** The energy blade's swings take 1/ENERGY.speed of the time, so its chain window shrinks with them. */
  private get comboWindow(): number {
    return this.def.comboWindow / (this.energy ? ENERGY.speed : 1);
  }

  /** Swing time shrinks with fire rate, but only by the square root: Berserk's 3x would blur the animation. */
  private seconds(base: number): number {
    return base / Math.sqrt(Math.max(this.modifiers.fireRate, 0.1)) / (this.energy ? ENERGY.speed : 1);
  }

  cancel(): void {
    if (this.state === 'guard') this.ctx.viewmodel.setCharge(0);
    this.state = 'idle';
    this.timer = 0;
    this.fireBuffer = this.aimBuffer = 0;
    this.next = 0;
    this.quick = false;
    this.combo = '';
    this.special = null;
    this.lungeTarget = null;
    this.aimAt = null;
  }

  reset(): void {
    this.cancel();
    this.hum?.stop(0.1);
    this.hum = null;
    this.wave.on = false;
    this.clock = 0;
    this.lastAttackAt = -10;
  }

  /** One swing of `id` from any weapon, on the melee key. */
  quickStrike(id: WeaponId = this.id): void {
    this.equip(id);
    this.next = 0;
    this.quick = true;
    this.special = null;
    this.startLight();
  }

  get inQuickStrike(): boolean {
    return this.quick && this.state === 'swing';
  }

  /** Runs every frame for the clock and the pull, whether or not a blade is out. */
  tick(dt: number): void {
    this.clock += dt;
    this.holdLunge(dt);
    if (this.wave.on) this.flyWave(dt);
    this.humTick();
  }

  /** The energy blade hums while it is in hand, a little higher through a swing. */
  private humTick(): void {
    const H = ENERGY.hum;
    const out = this.energy && this.ctx.weapons.current === 'sword';
    if (!out) {
      if (this.hum) this.hum.stop(0.15);
      this.hum = null;
      return;
    }
    if (!this.hum?.alive) {
      this.hum = this.ctx.audio.startLoop?.(H.id, { volume: H.volume, pitch: H.rest, fadeIn: 0.25 }) ?? null;
      this.humUp = false;
    }
    const up = this.state === 'swing';
    if (up === this.humUp || !this.hum) return;
    this.humUp = up;
    this.hum.setPitch(up ? H.swing : H.rest, up ? 0.04 : 0.25);
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
    if (first) this.landFx();
    // The flurry strikes once a stab, at each stab (jabs), not for as long as it is live.
    if (this.special === 'flurry' ? first : this.live()) this.swingScan();
    if (first) this.wallHit();
  }

  private get katana(): boolean {
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
        // A fresh click beats a held button on either side; a held LMB auto-chains, as in the first game. The katana's
        // right click stabs on the press, and held past the stab it guards.
        if (this.fireBuffer > 0) this.startLight();
        else if (this.katana && this.aimBuffer > 0) this.startStab();
        else if (this.katana && aimDown) this.startGuard();
        else if (heavy && (this.aimBuffer > 0 || aimDown)) this.startHeavy(heavy);
        else if (fireDown) this.startLight();
        break;

      case 'swing':
        this.timer += dt;
        if (this.special === 'flurry') this.jabs();
        this.landSwing();
        if (this.timer >= this.length) {
          this.special = null;
          if (this.katana && this.aimBuffer > 0) this.startStab();
          else if (this.fireBuffer > 0 || fireDown) this.startLight();
          else if (heavy && (this.aimBuffer > 0 || aimDown)) this.startHeavy(heavy);
          else this.state = 'idle';
        }
        break;

      case 'guard':
        this.timer += dt;
        if (!aimDown || this.fireBuffer > 0) {
          this.ctx.viewmodel.setCharge(0);
          this.state = 'idle';
          if (this.fireBuffer > 0) this.startLight();
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
    this.aimAt = null;
  }

  /** Builds the swing plane from the view. `sx`, `sy` is the blade's direction across the screen. */
  private setPlane(sx: number, sy: number, fwd = this.ctx.player.forward): void {
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
    const { player } = this.ctx;
    // Led by the player's velocity, or a fast mover outruns their own swing.
    this.tip.copy(player.eye).addScaledVector(player.forward, apex).addScaledVector(player.velocity, 0.08);
    this.drawCrescent(this.tip, player.forward, this.planeNormal, this.sweepDir, arc, radius, tilt, kind);
  }

  /** A crescent whose apex is at `tip`, ahead along `fwd`, sweeping along `sweep`, opened by `tilt` toward `side`. */
  private drawCrescent(
    tip: THREE.Vector3, fwd: THREE.Vector3, side: THREE.Vector3, sweep: THREE.Vector3, arc: number, radius: number, tilt: number,
    kind: SlashKind,
  ): void {
    const reach = this.vC.copy(fwd).multiplyScalar(Math.cos(tilt)).addScaledVector(side, Math.sin(tilt));
    const normal = this.vD.crossVectors(reach, sweep);
    const center = this.vA.copy(tip).addScaledVector(reach, -radius);
    const half = arc / 2;
    const start = this.vB.copy(reach).multiplyScalar(Math.cos(half)).addScaledVector(sweep, -Math.sin(half));
    this.ctx.fx.slash(center, normal, start, arc, radius, kind);
  }

  /** A new attack outside the combo window starts the chain and the combo again. Answers whether it was chained. */
  private chainOn(): boolean {
    const chained = this.clock - this.lastAttackAt <= this.comboWindow;
    if (!chained) {
      this.next = 0;
      this.combo = '';
    }
    this.lastAttackAt = this.clock;
    return chained;
  }

  private startLight(): void {
    const d = this.def;
    this.chainOn();
    if (this.katana && !this.quick) {
      const read = readCombo(this.combo, 's');
      this.combo = read.chain;
      if (read.move) return this.startMove(read.move, null);
    }
    this.swingIndex = this.next % d.chain.length;
    this.next = (this.swingIndex + 1) % d.chain.length;
    this.special = null;
    this.beginSwing(d.chain[this.swingIndex]!);
  }

  /**
   * The katana's right click. It leaves the slashes' place in the chain alone, so a stab between slashes extends it. In a
   * chain it locks on to a body just past the slashes and dashes at him.
   */
  private startStab(): void {
    const chained = this.chainOn();
    const read = readCombo(this.combo, 't');
    this.combo = read.chain;
    const lock = chained && read.move !== 'tornado' ? this.lockOn() : null;
    if (read.move) return this.startMove(read.move, lock);
    this.special = 'stab';
    this.beginSwing(KATANA.stab, lock);
  }

  /** A combo move: it ends the chain, so the next slash is the first again. */
  private startMove(move: KatanaMove, lock: EnemyInstance | null): void {
    const m = KATANA.moves[move];
    this.next = 0;
    this.special = move;
    this.jab = 0;
    this.beginSwing(m.swing, lock);
    this.ctx.hud.callout?.(m.name);
    this.ctx.audio.play('katana_shing', { pitchJitter: 0.03 });
  }

  private startHeavy(swing: MeleeSwing): void {
    // The heavy ends the chain: the next click starts it again.
    this.next = 0;
    this.lastAttackAt = this.clock;
    this.special = null;
    this.beginSwing(swing);
  }

  private beginSwing(swing: MeleeSwing, lock: EnemyInstance | null = null): void {
    const c = this.ctx;
    const energy = this.energy;
    // The energy blade's thrusts reach further: a copy a click, as a thrust is a click.
    if (energy && swing.thrust) swing = { ...swing, reach: swing.reach + ENERGY.thrust };
    this.swing = swing;
    const seconds = this.seconds(swing.seconds);
    this.beginAttack('swing', seconds);
    this.aimAt = lock;
    if (swing.move === 'spin') {
      // A full turn on the level, whatever the look: the plane is flat, and a kill is cut across the waist.
      const f = this.vA.set(c.player.forward.x, 0, c.player.forward.z);
      if (f.lengthSq() < 1e-6) f.set(-Math.sin(c.player.yaw), 0, -Math.cos(c.player.yaw));
      this.setPlane(swing.sweep[0], swing.sweep[1], f.normalize());
      this.planeNormal.copy(UP);
    } else this.setPlane(swing.sweep[0], swing.sweep[1]);
    c.viewmodel.swing(swing.move, seconds);
    c.audio.play(swing.sound, { pitch: (swing.pitch ?? 1) * (energy ? 1.12 : 1), pitchJitter: 0.05 });
    // Light has no edge to whistle: the energy blade's swing is a zap over the cut of the air.
    if (energy) c.audio.play('lance_plasma', { pitch: 1.35, volume: 0.35, pitchJitter: 0.08 });
    if (this.katana && this.special === null) {
      const extra = SWORD.chain[this.swingIndex]?.extra;
      if (extra) c.audio.play(extra);
    }
    if (swing.fov) c.camera.fovPunch(swing.fov, 0.14);
    c.camera.kick(swing.kick[0], swing.kick[1], swing.kick[2]);

    this.approach(swing, lock);
    this.impactAt = seconds * (swing.impact ?? 0);
    this.landed = false;
    this.landSwing();
    this.emitFired();
  }

  /** Right click held past the stab: the blade across the body. Its first moments parry (SWORD.windup). */
  private startGuard(): void {
    this.beginAttack('guard', 0);
    this.ctx.viewmodel.swing('windup', 0.3);
    this.ctx.viewmodel.setCharge(1);
  }

  /** What the blade draws as its blow lands: the crescent, the stab's thrust, each move's own. */
  private landFx(): void {
    const c = this.ctx;
    if (!this.katana) {
      // A short blade leaves a short, low trail. Clubs leave none: a crescent says edge.
      if (this.def.type === 'slash' && !this.swing.thrust) this.crescent(1.6, 1.3, 1.5, LIGHT_TILT, 'light');
      return;
    }
    switch (this.special) {
      case null:
        this.crescent(LIGHT_ARC, 2.2, 2.5 + this.swingIndex * 0.25, LIGHT_TILT, this.swingIndex === 2 ? 'heavy' : 'light');
        break;
      case 'stab':
      case 'flurry':
        this.stabFx(this.special === 'stab' ? 1 : 0.6);
        break;
      case 'cleave':
        this.cleaveFx();
        break;
      case 'tornado': {
        const p = c.player.position;
        const flat = this.vB.set(c.player.forward.x, 0, c.player.forward.z).normalize();
        // Well under the eye, so the rings read as rings and not as a line across the view.
        const at = this.vA.set(p.x, p.y + 0.55, p.z).addScaledVector(c.player.velocity, 0.08);
        c.fx.slash(at, UP, flat, Math.PI * 2, 2.7, 'sweep');
        at.y += 0.4;
        c.fx.slash(at, UP, flat, Math.PI * 2, 2.2, 'light');
        at.y = p.y + 0.08;
        c.fx.ring(at, UP, 0x88ccff, 3);
        c.fx.dust(at, UP, 2);
        this.combat.feel.shake(0.025);
        break;
      }
      case 'wave':
        this.crescent(2.4, 2.3, 2.8, LIGHT_TILT, 'light');
        this.launchWave();
        break;
    }
  }

  /** The stab: speed lines down the blade and a ring where its point stops. */
  private stabFx(size: number): void {
    const c = this.ctx;
    const eye = c.player.eye;
    const fwd = this.aimAt ? this.vB.subVectors(this.aimAt.center, eye).normalize() : c.player.forward;
    const reach = Math.min(this.swing.reach, c.physics.raycast(eye, fwd, this.swing.reach, CG.World)?.distance ?? Infinity);
    this.tip.copy(eye).addScaledVector(fwd, reach);
    c.fx.ring(this.tip, fwd, STAB_GLOW, 0.7 * size);
    this.tip.copy(eye).addScaledVector(fwd, 0.4);
    if (size >= 1) c.fx.dashStreaks(this.tip, fwd);
  }

  /** The cleave's blow: a tall crescent straight down, and the floor ahead split where the blade goes in. */
  private cleaveFx(): void {
    const c = this.ctx;
    const { player } = c;
    this.crescent(2.4, 2.4, 3.2, 0.35, 'finisher');
    const flat = this.vB.set(player.forward.x, 0, player.forward.z);
    if (flat.lengthSq() < 1e-6) return;
    flat.normalize();
    const from = this.tip.copy(player.eye).addScaledVector(flat, 2.2);
    const floor = c.physics.raycast(from, this.vC.set(0, -1, 0), 4, CG.World);
    if (!floor) return;
    c.fx.slam(floor.point, 0.65);
    c.render.decals.add('slash', floor.point, floor.normal, 2.2, Math.atan2(flat.x, flat.z));
    c.fx.sparks(floor.point, floor.normal, 22, 0xfff2cc);
    c.audio.play('katana_cleave_land', { position: floor.point, pitchJitter: 0.05 });
    this.combat.feel.shake(0.05);
    c.camera.kick(-0.025, 0, 0);
  }

  /** The flurry's stabs past the first: each one strikes anew, a little off the line, rising in pitch. */
  private jabs(): void {
    const n = KATANA.flurryStabs;
    const j = Math.min(n - 1, Math.floor(this.timer / (this.length / n)));
    if (j <= this.jab) return;
    this.jab = j;
    this.struck.length = 0;
    const c = this.ctx;
    c.audio.play('katana_stab', { pitch: 1 + j * 0.06, pitchJitter: 0.04, volume: 0.8 });
    c.camera.kick(-0.004, rand(-0.006, 0.006), rand(-0.006, 0.006));
    this.stabFx(j === n - 1 ? 1 : 0.6);
    this.swingScan();
  }

  // -------------------------------------------------------------------------------------------
  // The flying slash
  // -------------------------------------------------------------------------------------------

  private launchWave(): void {
    const { player } = this.ctx;
    const w = this.wave;
    w.on = true;
    w.travelled = 0;
    w.drawn = WAVE_DRAW;
    w.struck.length = 0;
    // It lies on the plane of the cut that threw it, so it slices on that plane too.
    w.dir.copy(player.forward);
    w.across.copy(this.sweepDir);
    w.normal.copy(this.planeNormal);
    w.pos.copy(player.eye).addScaledVector(w.dir, 1.2).addScaledVector(UP, -0.15);
  }

  /** One frame of flight: cut what it crossed, draw it, and burst on a wall or fade at the end of its range. */
  private flyWave(dt: number): void {
    const c = this.ctx;
    const W = KATANA.wave;
    const w = this.wave;
    let step = Math.min(W.speed * dt, W.range - w.travelled);
    const wall = c.physics.raycast(w.pos, w.dir, step, CG.World);
    if (wall) step = wall.distance;
    this.waveScan(step);
    w.drawn += step;
    if (w.travelled >= WAVE_SHOWN && w.drawn >= WAVE_DRAW) {
      w.drawn = 0;
      this.drawCrescent(w.pos, w.dir, w.normal, w.across, WAVE_ARC, WAVE_RADIUS, WAVE_TILT, 'wave');
    }
    w.pos.addScaledVector(w.dir, step);
    w.travelled += step;
    if (wall) this.waveBurst(wall.point, wall.normal);
    else if (w.travelled >= W.range - 1e-3) {
      w.on = false;
      c.fx.ring(w.pos, w.dir, WAVE_GLOW, 1.4);
    }
  }

  /** Every body the flying slash crossed this frame: inside its width and its thickness, between here and `step` on. */
  private waveScan(step: number): void {
    const c = this.ctx;
    const W = KATANA.wave;
    const w = this.wave;
    const mid = this.vA.copy(w.pos).addScaledVector(w.dir, step / 2);
    const n = Math.min(c.enemies.query(mid, W.half + step / 2 + 2, this.list) || 0, MAX_LIST);
    let slices = MAX_SLICES_PER_FRAME;
    for (let i = 0; i < n; i++) {
      const e = this.list[i]!;
      if (!e.alive || w.struck.includes(e)) continue;
      const r = this.radiusOf(e);
      const rel = this.vB.subVectors(e.position, w.pos);
      const along = rel.dot(w.dir);
      if (along < -r || along > step + r) continue;
      if (Math.abs(rel.dot(w.across)) > W.half + r) continue;
      // The height of the slash where it crosses him, against his feet and his head.
      const y = w.pos.y + w.dir.y * along;
      const height = e.char.rig.height;
      if (y < e.position.y - W.tall || y > e.position.y + height + W.tall) continue;
      w.struck.push(e);
      const at = this.contact.set(e.position.x, clamp(y, e.position.y + 0.3, e.position.y + height - 0.15), e.position.z);
      this.waveCut(e, at, slices-- > 0);
    }
  }

  private waveCut(e: EnemyInstance, at: THREE.Vector3, slice: boolean): void {
    const c = this.ctx;
    const W = KATANA.wave;
    const row = WEAPONS.sword;
    const dir = this.wave.dir;
    const o = this.combat.strikeOptions('slash', 'sword_wave');
    o.force = W.force;
    o.headshotMult = row.headshotMult;
    o.severMult = this.modifiers.alwaysSever ? 1000 : row.canSever ? row.severMult : 0;
    o.quiet = true;
    this.burn(o);
    if (slice) o.slicePlaneNormal = this.wave.normal;
    const res = this.combat.strike(e, at, this.vD.copy(dir).negate(), dir, undefined, undefined, row.damage * W.mult * this.modifiers.damage, o);
    const d = this.def;
    if (res.blocked || e.machine) {
      c.fx.sparks(at, this.vD, d.sparks + 8, 0xfff2cc);
      c.audio.play(res.blocked ? d.armourSound : d.machine, { position: at, pitchJitter: 0.08 });
    } else {
      c.audio.play(d.flesh, { position: at, pitchJitter: 0.04 });
      c.audio.play('flesh_slice', { position: at });
      if (o.vaporize) this.sear(at, dir);
      else {
        c.fx.bloodHit(at, dir, toldKill(res) ? 1.6 : 1.1);
        if (toldKill(res)) c.fx.bloodJet(at, dir, 1);
      }
    }
    c.hud.hitMarker(toldKill(res) ? 'kill' : 'body');
    this.combat.feel.stop(toldKill(res) ? 0.045 : 0.025, true);
  }

  /** The flying slash meets a wall: it goes off there, and cuts the wall. */
  private waveBurst(point: THREE.Vector3, normal: THREE.Vector3): void {
    const c = this.ctx;
    const B = KATANA.wave.burst;
    const w = this.wave;
    w.on = false;
    const at = this.vA.copy(point).addScaledVector(normal, 0.25);
    c.render.decals.add('slash', point, normal, 2.6, 0);
    c.fx.ring(at, normal, WAVE_GLOW, 3);
    this.combat.explode(at, {
      radius: B.radius, damage: B.damage * this.modifiers.damage, kind: 'finisher', source: 'sword_wave', team: 'player',
      selfDamage: 0, playerPush: 0, normal, scale: 0.9, shake: 0.06,
    });
  }

  // -------------------------------------------------------------------------------------------
  // Closing the gap
  // -------------------------------------------------------------------------------------------

  /** A step for a body just out of reach, or, with the katana, the dash out of a run or the lock of a stab in a chain. */
  private approach(swing: MeleeSwing, lock: EnemyInstance | null): void {
    if (lock) {
      const L = KATANA.lock;
      const e = this.energy;
      this.pull(lock, L.speed * (e ? ENERGY.pull.speed : 1), L.seconds * (e ? ENERGY.pull.seconds : 1), L.stop + this.radiusOf(lock), e ? MOVE.runSpeed : Infinity);
      const c = this.ctx;
      c.camera.fovPunch(L.fov, 0.18);
      c.audio.play('blade_dash', { pitchJitter: 0.04 });
      c.fx.dashStreaks(c.player.eye, c.player.forward);
      return;
    }
    // The tornado turns where it stands and the flying slash leaves the blade: neither steps in.
    if (this.special === 'tornado' || this.special === 'wave') return;
    if (this.katana && BLADE_OLD) {
      this.lungeOld();
      return;
    }
    if (this.katana && this.special === null && this.dash(swing)) return;
    this.stepIn(swing);
  }

  /** The body a stab in a chain locks on to: past every slash's reach, inside the lock's range and cone, in sight. */
  private lockOn(): EnemyInstance | null {
    const L = KATANA.lock;
    const range = L.range * this.reachMult;
    const c = this.ctx;
    const eye = c.player.eye;
    const fwd = c.player.forward;
    const n = Math.min(c.enemies.query(eye, range + 2, this.list) || 0, MAX_LIST);
    let best: EnemyInstance | null = null;
    let bestScore = 0;
    for (let i = 0; i < n; i++) {
      const e = this.list[i]!;
      if (!e.alive) continue;
      const to = this.vA.subVectors(e.center, eye);
      const dist = to.length();
      const radius = this.radiusOf(e);
      const surface = dist - radius;
      if (surface <= SLASH_REACH || surface > range) continue;
      const dot = to.dot(fwd) / dist;
      const score = dot / dist;
      if (dot < L.cone || score <= bestScore) continue;
      if (c.physics.raycast(eye, to.divideScalar(dist), surface, CG.World)) continue;
      best = e;
      bestScore = score;
    }
    return best;
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
  /** The energy blade's dash and lock find a body ENERGY.reach times as far. */
  private get reachMult(): number {
    return this.energy ? ENERGY.reach : 1;
  }

  private dash(swing: MeleeSwing): boolean {
    const D = KATANA.dash;
    const range = D.range * this.reachMult;
    const c = this.ctx;
    const player = c.player;
    const fwd = player.forward;
    const flat = this.vB.set(fwd.x, 0, fwd.z);
    if (flat.lengthSq() < 1e-6) return false;
    flat.normalize();
    if (player.velocity.dot(flat) < D.from) return false;
    const eye = player.eye;
    const n = c.enemies.query(eye, range, this.list) || 0;
    let best: EnemyInstance | null = null;
    let bestScore = 0;
    for (let i = 0; i < n; i++) {
      const e = this.list[i]!;
      if (!e.alive) continue;
      const to = this.vA.subVectors(e.center, eye);
      const dist = to.length();
      if (dist < 1e-3 || dist > range) continue;
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
    const e = this.energy;
    this.pull(best, D.speed * (e ? ENERGY.pull.speed : 1), D.seconds * (e ? ENERGY.pull.seconds : 1), stop, e ? MOVE.runSpeed : Infinity);
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

  private pull(target: EnemyInstance, speed: number, seconds: number, stop: number, keep = Infinity): void {
    this.lungeTarget = target;
    this.lungeKeep = keep;
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
      const along = dist > 1e-4 ? player.velocity.dot(to.divideScalar(dist)) : 0;
      if (along > this.lungeKeep) player.velocity.addScaledVector(to, this.lungeKeep - along);
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
    if (this.aimAt?.alive) {
      // Locked on: the swing goes at him, wherever the crosshair has drifted.
      f.forward.subVectors(this.aimAt.center, f.eye).normalize();
      sweepDirection(f.forward, swing.sweep[0], swing.sweep[1], f.sweep);
    } else if (swing.move === 'spin') {
      f.forward.y = 0;
      if (f.forward.lengthSq() < 1e-6) f.forward.crossVectors(this.sweepDir, UP);
      f.forward.normalize();
    }
  }

  /** Meters from the eye to where the current shape meets `e`, or -1. Leaves the struck point in `contact`. */
  private touch(e: EnemyInstance): number {
    const b = this.body;
    b.base.copy(e.position);
    // `downed` also means gore holds a body still on its feet (stumbling or catching its balance): that one is full height.
    const low = (e as unknown as Balance).downed === true && this.ctx.gore.downed?.(e.char)?.standing !== true;
    b.height = low ? Math.min(DOWNED_HEIGHT, e.char.rig.height) : e.char.rig.height;
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
    const source = this.special ? `sword_${this.special}` : this.id;
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
    const type: DamageType = swing.type ?? d.type;
    const blunt = type === 'melee';
    const ray = this.vD.copy(dir);
    let hit: ReturnType<Ctx['gore']['raycastCharacter']> = null;
    if (blunt && !swing.thrust) {
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
    // The cleave goes through the man, not the arm in its way.
    if (!hit || (region === 'head' && !d.heads) || this.special === 'cleave') {
      region = 'chest';
      bone = undefined;
    }
    let amount = damage;
    if (d.bonus && this.openTo(e, dir, d.bonus.behind)) amount *= d.bonus.mult;

    const point = hit ? hit.point : near;
    const o = this.combat.strikeOptions(type, source);
    o.force = force ?? swing.force ?? row.force;
    o.headshotMult = row.headshotMult;
    const sever = swing.sever ?? row.severMult;
    // A blow takes nothing off, Butcher or not: a club breaks what it lands on. A blade under Butcher takes everything.
    o.severMult = blunt ? 0 : this.modifiers.alwaysSever ? 1000 : row.canSever ? sever : 0;
    o.charge = d.armour;
    o.quiet = true;
    this.burn(o);
    // A stab goes in, it does not split: the body comes off the blade whole.
    if (d.slices && this.slicesLeft > 0 && !swing.thrust) o.slicePlaneNormal = this.planeNormal;
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
      // The flurry throws only on its last stab.
      if (swing.fling && (this.special !== 'flurry' || this.jab === KATANA.flurryStabs - 1)) this.fling(e, push, swing.fling);
    } else if (res.killSoon) this.killCount++;
    if (!res.killed && swing.fling && c.coop?.world && !c.coop.hosting && (this.special !== 'flurry' || this.jab === KATANA.flurryStabs - 1)) {
      // A co-op guest's enemy dies on the host's word: the body is thrown when that comes, if it comes soon.
      const way = push.clone();
      const strength = swing.fling;
      const until = c.time.realElapsed + LATE_FLING;
      c.coop.world.whenKilled(e, body => { if (c.time.realElapsed < until) this.fling(body, way, strength); });
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
      if (o.vaporize) this.sear(point, push);
      else {
        c.fx.bloodHit(point, push, res.killed ? 1.6 : 1.1);
        if (res.killed && d.slices) c.fx.bloodJet(point, push, 1);
      }
      // Run through: the point comes out of his back.
      if (this.special === 'stab' && res.killed) c.fx.ring(this.vA.copy(point).addScaledVector(dir, 0.35), dir, STAB_GLOW, 0.4);
    } else {
      // A blow: little blood, a lot of weight. The bone, if one goes, is gore's sound.
      c.fx.bloodHit(point, push, res.killed ? 0.8 : 0.45);
      if (region === 'head') c.audio.play('head_thud', { position: point, pitchJitter: 0.06 });
    }
  }

  /**
   * The energy blade's strike (ENERGY): its kills are vaporized, a slice's halves too, and it goes through plates.
   */
  private burn(o: StrikeOptions): void {
    if (!this.energy) return;
    o.vaporize = true;
    o.charge = ENERGY.armour;
  }

  /** A cauterized cut: a spit of light and embers where the blood would be. */
  private sear(at: THREE.Vector3, dir: THREE.Vector3): void {
    this.ctx.fx.sparks(at, dir, 8, ENERGY_GLOW);
    this.ctx.fx.embers(at, 4, 0.25);
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
    if (this.state !== 'guard') return 'none';
    const w = SWORD.windup;
    const energy = this.energy;
    if (-incoming.dot(this.ctx.player.forward) < (energy ? ENERGY.cone : w.cone)) return 'none';
    const parry = this.timer <= w.parryWindow * (energy ? ENERGY.parry : 1);
    this.ctx.viewmodel.swing('block', 0.16);
    return parry ? 'parry' : 'block';
  }
}
