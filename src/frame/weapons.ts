/**
 * The Frame's three guns, its smoke, and the blows its body lands. The AC-130's idea brought down to the ground: every gun
 * has its own magazine and its own clock, so the juggle is the game.
 *
 *   Rotary   left arm, LMB. The door gun's 20 mm round at 20 a second, with the mounted gun's Heat: about 7 s to overheat
 *   Cannon   right arm, RMB, R for the round. The gunship's 40 mm, its Magazine and its three rounds, fired flat from the arm
 *   Pod      right shoulder, G held to paint and let go. The Quiver's Painter on six tubes, one salvo, then 10 s
 *   Smoke    Q. The seats' flares and a wall of smoke, three a beat
 *
 * The four clocks are plain classes with no world, for the tests. `FrameGuns` fires them into the world. The blows (stomp,
 * charge, backhand, a planted foot) are functions on the enemies alone, so a test can count who they knock down.
 */
import * as THREE from 'three';
import type { Ctx, DamageInfo, LoopHandle, PlayOptions } from '../core/contracts';
import type { EnemyInstance, EnemySystem, ExplosionSpec, MissileTarget, ProjectileSpec, ShotSpec } from '../core/gameplay';
import { clamp, lerp, rand, randomInCone, wrapAngle } from '../core/math';
import { Magazine, type Round40 } from '../progression/callins/ac130Guns';
import { AC130 } from '../progression/callins/ac130Data';
import { flakCone, type Ac130Rounds, type ImpactKind } from '../progression/callins/ac130Rounds';
import { Heat } from '../vehicles/emplacement';
import type { GunnerWeapon } from '../vehicles/hud';
import type { GunnerSeat } from '../vehicles/seat';
import { CG } from '../core/contracts';
import { Painter, angleOff, type PaintCandidate } from '../weapons/swarm';
import { TUNING } from '../weapons/data';
import { FRAME } from './data';

const R = FRAME.rotary;
const C = FRAME.cannon;
const P = FRAME.pod;
const B = AC130.bofors;

// ---- the clocks -------------------------------------------------------------------------------------------------

/** The rotary's spin and heat. `update` says how many rounds leave this frame. */
export class Rotary {
  readonly heat = new Heat(R);
  spin = 0;
  private roundIn = 0;
  /** True on the frame the heat locked the trigger. */
  overheatedNow = false;

  update(dt: number, held: boolean): number {
    const want = held && !this.heat.overheated;
    this.spin = clamp(this.spin + (want ? dt / R.spinUp : -dt / R.spinDown));
    const shooting = want && this.spin >= R.fireAt;
    let n = 0;
    this.overheatedNow = false;
    if (shooting) {
      this.roundIn -= dt;
      while (this.roundIn <= 0 && n < 4) {
        this.roundIn += 1 / R.rate;
        n++;
        if (this.heat.shot()) {
          this.overheatedNow = true;
          break;
        }
      }
      // A long frame's debt is forgiven, so the rate never bursts to catch up.
      if (this.roundIn < 0) this.roundIn = 0;
    } else {
      this.roundIn = Math.max(0, this.roundIn - dt);
    }
    this.heat.cool(dt, shooting);
    return n;
  }

  get firing(): boolean {
    return this.spin >= R.fireAt && !this.heat.overheated;
  }

  reset(): void {
    this.heat.value = 0;
    this.heat.overheated = false;
    this.spin = this.roundIn = 0;
  }
}

const ROUNDS: readonly Round40[] = ['g40', 'ap', 'flak'];
export const ROUND_NAMES: Readonly<Record<Round40, string>> = { g40: 'HE', ap: 'AP', flak: 'FLAK' };

/** The 40 mm: the gunship's Magazine, and the round the next shell is. */
export class Cannon {
  readonly mag = new Magazine(C.magazine, C.reload, C.interval);
  round: Round40 = 'g40';

  cycle(): void {
    this.round = ROUNDS[(ROUNDS.indexOf(this.round) + 1) % ROUNDS.length]!;
  }

  reset(): void {
    this.mag.ammo = this.mag.size;
    this.mag.reloading = -1;
    this.round = 'g40';
  }
}

/** The pod: paint while held, a salvo of every tube on release (spares on the marks, as the Quiver's), then a reload. */
export class Pod {
  readonly painter = new Painter(P.paintEvery);
  ammo: number = P.tubes;
  /** Seconds left of the reload, or -1. */
  reloading = -1;
  /** One per tube still to leave, its target or null for a dumb one. Read and emptied by the owner. */
  readonly queue: (MissileTarget | null)[] = [];
  private salvo: (MissileTarget | null)[] = [];
  private gap = 0;

  get progress(): number {
    return this.reloading < 0 ? -1 : 1 - this.reloading / P.reload;
  }

  /** `look` answers who is in the cone and in sight now. Returns the target marked this frame, or null. */
  update(dt: number, held: boolean, look: () => readonly PaintCandidate[]): MissileTarget | null {
    const p = this.painter;
    if (this.reloading >= 0) {
      this.reloading -= dt;
      if (this.reloading < 0) {
        this.reloading = -1;
        this.ammo = P.tubes;
      }
    }
    this.queue.length = 0;
    if (this.salvo.length > 0) {
      this.gap -= dt;
      while (this.salvo.length > 0 && this.gap <= 0) {
        this.queue.push(this.salvo.shift()!);
        this.gap += P.gap;
      }
      if (this.salvo.length === 0) this.reloading = P.reload;
      return null;
    }
    if (!p.painting) {
      if (held && this.ammo === P.tubes) p.begin(P.tubes);
      return null;
    }
    if (held) return p.update(dt, look);
    p.release(this.salvo, this.ammo, look());
    this.ammo = 0;
    this.gap = 0;
    return null;
  }

  reset(): void {
    this.painter.cancel();
    this.ammo = P.tubes;
    this.reloading = -1;
    this.salvo.length = 0;
    this.queue.length = 0;
  }
}

/** Three pops a beat, and none within the lockout of the last. */
export class Smoke {
  count: number = FRAME.smoke.count;
  private wait = 0;

  update(dt: number): void {
    this.wait = Math.max(0, this.wait - dt);
  }

  pop(): boolean {
    if (this.count <= 0 || this.wait > 0) return false;
    this.count--;
    this.wait = FRAME.smoke.lockout;
    return true;
  }

  reset(): void {
    this.count = FRAME.smoke.count;
    this.wait = 0;
  }
}

// ---- the blows ----------------------------------------------------------------------------------------------------

const _hits: EnemyInstance[] = [];
const blow: DamageInfo = { amount: 0, type: 'crush', point: new THREE.Vector3(), dir: new THREE.Vector3(), force: 0, source: 'frame_stomp' };

/**
 * The big slam at twice the size: damage from `center` at the middle falling to `edge` at the ring, and everyone within
 * `knock` thrown off their feet. A stomp from lower than `big` is a smaller one. Returns how many it reached.
 */
export function stomp(enemies: EnemySystem, at: THREE.Vector3, height: number): number {
  const S = FRAME.stomp;
  const k = height >= S.big ? 1 : S.small;
  const radius = S.radius * k;
  const n = Math.min(enemies.query(at, radius, _hits) || 0, _hits.length);
  for (let i = 0; i < n; i++) {
    const e = _hits[i]!;
    if (!e.alive) continue;
    const d = Math.hypot(e.position.x - at.x, e.position.z - at.z);
    const knocked = d < S.knock * k;
    blow.source = 'frame_stomp';
    blow.amount = lerp(S.center, S.edge, clamp(d / radius)) * k;
    blow.point.copy(e.center);
    blow.dir.set(e.position.x - at.x, 0, e.position.z - at.z).normalize().setY(knocked ? 0.65 : 0.35).normalize();
    blow.force = knocked ? S.knockForce * (k < 1 ? 0.8 : 1) : S.knockForce * 0.3;
    enemies.applyDamage(e, blow);
  }
  return n;
}

/** Anyone in the way of a charge: flung on along it and up. `hit` keeps who has been struck, so each is once a charge. */
export function shove(enemies: EnemySystem, front: THREE.Vector3, dir: THREE.Vector3, hit: Set<number>): number {
  const H = FRAME.charge;
  const n = Math.min(enemies.query(front, H.reach, _hits) || 0, _hits.length);
  let struck = 0;
  for (let i = 0; i < n; i++) {
    const e = _hits[i]!;
    if (!e.alive || hit.has(e.uid)) continue;
    hit.add(e.uid);
    blow.source = 'frame_charge';
    blow.amount = H.damage;
    blow.point.copy(e.center);
    blow.dir.copy(dir).setY(0.55).normalize();
    blow.force = H.force;
    enemies.applyDamage(e, blow);
    struck++;
  }
  return struck;
}

/**
 * The arm swept across the front: everyone in `arc` of the view and within `reach` of the hull's middle, thrown off to the
 * side the swing goes. Returns how many.
 */
export function backhand(enemies: EnemySystem, at: THREE.Vector3, yaw: number): number {
  const H = FRAME.backhand;
  const n = Math.min(enemies.query(at, H.reach + 1, _hits) || 0, _hits.length);
  let struck = 0;
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  for (let i = 0; i < n; i++) {
    const e = _hits[i]!;
    const dx = e.position.x - at.x;
    const dz = e.position.z - at.z;
    const d = Math.hypot(dx, dz);
    if (!e.alive || d > H.reach || Math.abs(wrapAngle(Math.atan2(-dx, -dz) - yaw)) > H.arc / 2) continue;
    blow.source = 'frame_backhand';
    blow.amount = H.damage;
    blow.point.copy(e.center);
    // From right to left across the front: out to the left and on away.
    blow.dir.set(fz * 0.8 + fx * 0.4, 0.5, -fx * 0.8 + fz * 0.4).normalize();
    blow.force = H.force;
    enemies.applyDamage(e, blow);
    struck++;
  }
  return struck;
}

/** A foot coming down on someone. */
export function crush(enemies: EnemySystem, foot: THREE.Vector3): number {
  const K = FRAME.crush;
  const n = Math.min(enemies.query(foot, K.radius + 0.5, _hits) || 0, _hits.length);
  let struck = 0;
  for (let i = 0; i < n; i++) {
    const e = _hits[i]!;
    if (!e.alive || Math.hypot(e.position.x - foot.x, e.position.z - foot.z) > K.radius) continue;
    blow.source = 'frame_foot';
    blow.amount = K.damage;
    blow.point.copy(e.center);
    blow.dir.set(0, -1, 0);
    blow.force = 200;
    blow.gib = true;
    enemies.applyDamage(e, blow);
    blow.gib = false;
    struck++;
  }
  return struck;
}

// ---- into the world -------------------------------------------------------------------------------------------------

/** The arms the guns hang on, as the owner places them each frame. */
export interface Arm {
  muzzle(out: THREE.Vector3): THREE.Vector3;
  bore(out: THREE.Vector3): THREE.Vector3;
  turn(radians: number): void;
  recoil(metres: number): void;
}

/** Where the Frame aims from and at: the seat, as it has it this frame. */
export type Sight = Pick<GunnerSeat, 'view' | 'aim' | 'point' | 'range'>;

/** The 40 mm's blasts are the gunship's, under the Frame's own names so its kills are the player's. */
function blast(source: string, radius: number, damage: number): ExplosionSpec {
  return { kind: 'shell', source, radius, damage, shake: 0.02, team: 'player', selfDamage: 0, playerPush: 0, worldObject: true };
}
const BLASTS: Readonly<Record<Round40, ExplosionSpec>> = {
  g40: blast('frame_40mm', B.he.radius, B.he.damage),
  ap: blast('frame_40mm_ap', B.ap.radius, B.ap.damage),
  flak: blast('frame_flak', B.flak.radius, B.flak.damage),
};
const PELLET: ShotSpec = {
  damage: B.flak.pelletDamage, source: 'frame_flak', team: 'player', maxDistance: B.flak.reach, force: 14, severMult: 2.2, impactScale: 1.4,
};

/** Below this the sight is on something right under the arm, and a round goes down the bore instead. */
const NEAR_SIGHT = 6;
/** The rotary's spin loop with the barrels barely turning, and its fire loop's written rate. */
const SPIN_PITCH = 0.45;
const LOOP_RATE = 25;
const UP = new THREE.Vector3(0, 1, 0);
const WALL_STANDOFF = 0.5;
const MAX_IN_VIEW = 24;

const _muzzle = new THREE.Vector3();
const _bore = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _at = new THREE.Vector3();
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _right = new THREE.Vector3();
const _pellets = Array.from({ length: B.flak.pellets }, () => new THREE.Vector3());
const _play: PlayOptions = {};

export class FrameGuns {
  readonly rotary = new Rotary();
  readonly cannon = new Cannon();
  readonly pod = new Pod();
  readonly smoke = new Smoke();
  /** For the panel: 40 mm, pod, smoke. The owner adds its own rows after these. */
  readonly rows: GunnerWeapon[] = [
    { name: '', ammo: 0, max: C.magazine, reload: -1 },
    { name: '', ammo: 0, max: P.tubes, reload: -1 },
    { name: '', ammo: 0, max: FRAME.smoke.count },
  ];
  private fired = 0;
  private tube = 0;
  private spinLoop: LoopHandle | null = null;
  private fireLoop: LoopHandle | null = null;
  private readonly shot: ShotSpec = {
    damage: R.damage, source: 'frame_rotary', team: 'player', maxDistance: R.range, tracerFrom: _muzzle,
    force: R.force, severMult: R.severMult, impactScale: R.impactScale, burst: R.burst, penetrate: R.penetrate, bodyCost: R.bodyCost,
  };
  private readonly inView: PaintCandidate[] = [];
  private readonly pool: PaintCandidate[] = [];
  private readonly paintables: MissileTarget[] = [];
  private sight: Sight | null = null;
  private readonly look = (): readonly PaintCandidate[] => this.gather();

  constructor(
    private readonly ctx: Ctx,
    private readonly rounds: Ac130Rounds,
    private readonly left: Arm,
    private readonly right: Arm,
    /** Where the pod's tubes are, in the world, this frame. */
    private readonly tubes: (out: THREE.Vector3) => THREE.Vector3,
  ) {
    rounds.onImpact = (kind, point, normal, dir) => this.impact(kind, point, normal, dir);
  }

  update(dt: number, sight: Sight): void {
    const { input, audio } = this.ctx;
    this.sight = sight;
    // The rotary.
    const n = this.rotary.update(dt, input.isDown('fire'));
    this.left.turn(this.rotary.spin * R.barrelRate * dt);
    this.spinSound(input.isDown('fire') && !this.rotary.heat.overheated);
    if (this.rotary.firing && input.isDown('fire')) {
      this.fireLoop ??= audio.startLoop('minigun_fire_loop', { fadeIn: 0.03, pitch: R.rate / LOOP_RATE });
      for (let i = 0; i < n; i++) this.round(sight);
    } else {
      this.ceaseFire();
    }
    if (this.rotary.overheatedNow) audio.play('steam_burst', { volume: 0.9 });
    if (input.pressed('fire') && this.rotary.heat.overheated) audio.play('weapon_dry');
    // The 40 mm.
    const mag = this.cannon.mag;
    const loading = mag.reloading >= 0;
    mag.update(dt);
    if (loading && mag.reloading < 0) audio.play('reload_shell_in', { volume: 0.8, pitch: 0.8 });
    if (input.pressed('reload')) {
      this.cannon.cycle();
      audio.play('reload_bolt', { pitch: 0.75 });
    }
    if (input.isDown('aim') && mag.ready) this.shell(sight);
    else if (input.pressed('aim') && mag.ammo === 0) audio.play('weapon_dry');
    // The pod.
    const pod = this.pod;
    const wasPainting = pod.painter.painting;
    const wasLoading = pod.reloading >= 0;
    const marked = pod.update(dt, input.isDown('grenade'), this.look);
    if (!wasPainting && pod.painter.painting) audio.play('quiver_arm');
    if (marked) {
      audio.play('quiver_lock', { pitch: 1 + (pod.painter.marks.length - 1) * 0.12 });
      if (pod.painter.full) audio.play('quiver_full');
    }
    for (const target of pod.queue) this.missile(target, sight);
    if (wasLoading && pod.reloading < 0) audio.play('reload_rocket', { volume: 0.8 });
    if (input.pressed('grenade') && pod.ammo < P.tubes) audio.play('weapon_dry');
    // Smoke.
    this.smoke.update(dt);
    this.rounds.update(dt);
    this.label();
  }

  /** The marks for the panel. */
  get marks(): readonly MissileTarget[] {
    return this.pod.painter.marks;
  }

  private label(): void {
    const [cannon, pod, smoke] = this.rows as [GunnerWeapon, GunnerWeapon, GunnerWeapon];
    const mag = this.cannon.mag;
    cannon.name = `RMB 40MM ${ROUND_NAMES[this.cannon.round]} // R`;
    cannon.ammo = mag.ammo;
    cannon.reload = mag.progress;
    const painting = this.pod.painter.painting;
    pod.name = painting ? `G POD // PAINTING ${this.pod.painter.marks.length}` : 'G POD // HOLD TO PAINT';
    pod.ammo = painting ? this.pod.painter.marks.length : this.pod.ammo;
    pod.reload = this.pod.progress;
    smoke.name = 'Q SMOKE';
    smoke.ammo = this.smoke.count;
  }

  // ---- the rotary ----

  /** The door gun's way: from the eye along the sight, so the reticle is the truth, with the tracer from the real muzzle. */
  private round(sight: Sight): void {
    const { combat, fx, camera } = this.ctx;
    this.fired++;
    this.left.muzzle(_muzzle);
    this.left.bore(_bore);
    randomInCone(sight.aim, R.spread, _dir);
    this.shot.tracer = this.fired % R.tracerEvery === 0 ? 'heavy' : undefined;
    combat.fireRay(sight.view.position, _dir, this.shot);
    if (this.fired % R.flashEvery === 0) fx.muzzleFlash(_muzzle, _bore, 'rotary');
    if (this.fired % 2 === 0) {
      _v.set(-_bore.z, 0, _bore.x).multiplyScalar(-2);
      _v.y = rand(1, 2.5);
      fx.shellCasing(_muzzle.addScaledVector(_bore, -1.2), _v, 'cannon');
    }
    camera.addTrauma(R.trauma);
    camera.kick(rand(0, R.kick), rand(-R.kick, R.kick));
  }

  private spinSound(want: boolean): void {
    const { audio } = this.ctx;
    if (want && !this.spinLoop) {
      audio.play('minigun_spinup');
      this.spinLoop = audio.startLoop('minigun_spin_loop', { fadeIn: 0.1 });
    } else if (!want && this.spinLoop) {
      this.spinLoop.stop(0.2);
      this.spinLoop = null;
      audio.play('minigun_spindown', { offset: (1 - this.rotary.spin) * R.spinDown });
    }
    this.spinLoop?.setPitch(SPIN_PITCH + (1 - SPIN_PITCH) * this.rotary.spin, 0.04);
  }

  private ceaseFire(): void {
    if (!this.fireLoop) return;
    this.fireLoop.stop(0.08);
    this.fireLoop = null;
    this.ctx.audio.play('minigun_fire');
  }

  // ---- the 40 mm ----

  /** Flat from the arm to where the sight is, or on down the bore at something under the arm. Armed from the muzzle. */
  private shell(sight: Sight): void {
    const { audio, camera, fx } = this.ctx;
    if (!this.cannon.mag.take()) return;
    const round = this.cannon.round;
    this.right.muzzle(_muzzle);
    this.right.bore(_bore);
    if (sight.range > NEAR_SIGHT) _aim.copy(sight.point);
    else _aim.copy(_muzzle).addScaledVector(_bore, 60);
    randomInCone(_dir.subVectors(_aim, _muzzle).normalize(), C.spread, _dir);
    const reach = _muzzle.distanceTo(_aim) + (round === 'ap' ? B.ap.beyond : 0);
    _aim.copy(_muzzle).addScaledVector(_dir, reach);
    this.rounds.fire(round, _muzzle, _aim, reach / C.speed, 0, Infinity);
    this.rounds.flash(_muzzle, 1.6, 0.07, 9, 10, 5, 1.4);
    fx.muzzleFlash(_muzzle, _bore, 'autocannon');
    // A puff well out ahead of the brake: at the muzzle, a metre from the eye, it filled half the screen.
    fx.smoke(_v.copy(_muzzle).addScaledVector(_bore, 3), 0xb4bcc4, 0.5, 0.8);
    _play.volume = 1.4;
    _play.pitch = round === 'ap' ? 0.8 : 0.72;
    _play.position = undefined;
    audio.play('autocannon_fire', _play);
    this.right.recoil(0.45);
    camera.addTrauma(C.trauma);
    camera.kick(C.kick, rand(-0.004, 0.004));
  }

  private impact(kind: ImpactKind, point: THREE.Vector3, normal: THREE.Vector3 | null, dir: THREE.Vector3): void {
    if (kind !== 'g40' && kind !== 'ap' && kind !== 'flak') return;
    const { combat, fx, audio } = this.ctx;
    _at.copy(point);
    if (normal) _at.addScaledVector(normal, WALL_STANDOFF);
    combat.explode(_at, BLASTS[kind]);
    if (kind === 'g40') {
      fx.explosion(point, { kind: 'shell', radius: B.he.radius, scale: 1, normal: normal ?? undefined });
      fx.ring(point, normal ?? UP, '#ffb040', B.he.radius * 1.5);
      audio.play('30mmshell_explode', { position: point, volume: 0.9 });
    } else if (kind === 'ap') {
      fx.explosion(point, { kind: 'hellfireBullet', radius: B.ap.radius, scale: 1.1, normal: normal ?? undefined });
      fx.sparks(point, normal ?? UP, 24, '#cfe4ff');
      audio.play('30mmshell_explode', { position: point, volume: 0.8, pitch: 1.25 });
    } else {
      fx.explosion(point, { kind: 'shell', radius: B.flak.radius, scale: 0.8 });
      fx.ring(point, dir, '#ff7030', B.flak.radius * 2);
      audio.play('30mmshell_explode', { position: point, pitch: 0.8 });
      audio.play('shotgun_fire', { position: point, volume: 0.7, pitch: 0.6 });
      flakCone(dir, B.flak.cone, _pellets);
      for (let i = 0; i < _pellets.length; i++) {
        PELLET.tracer = i % 3 === 0 ? 'heavy' : undefined;
        combat.fireRay(point, _pellets[i]!, PELLET);
      }
    }
  }

  // ---- the pod ----

  private missile(target: MissileTarget | null, sight: Sight): void {
    const { combat, fx, audio, camera } = this.ctx;
    const q = TUNING.quiver;
    const p = this.projectile;
    const dumb = target === null;
    const i = this.tube++ % P.tubes;
    this.tubes(p.origin);
    // Two rows of three: each tube a touch off the pod's line, so the six leave in a fan and then turn in.
    _right.crossVectors(sight.aim, UP).normalize();
    _w.crossVectors(_right, sight.aim).normalize();
    p.origin.addScaledVector(_right, ((i % 3) - 1) * 0.28).addScaledVector(_w, i < 3 ? 0.18 : -0.18);
    _dir.subVectors(sight.range > NEAR_SIGHT ? sight.point : _v.copy(sight.view.position).addScaledVector(sight.aim, 60), p.origin).normalize();
    const sx = (i % 3) - 1;
    const sy = i < 3 ? 1 : -1;
    if (dumb) {
      _dir.addScaledVector(_right, sx * q.fan * 0.5).addScaledVector(_w, (sy + 1) * q.fan * 0.4).normalize();
      randomInCone(_dir, q.dumbSpread, _dir);
    } else {
      _dir.addScaledVector(_right, sx * q.fan).addScaledVector(_w, sy * q.fan * 0.7 + q.fan * 0.9).normalize();
    }
    p.velocity.copy(_dir).multiplyScalar(q.launchSpeed);
    p.target = dumb ? null : target;
    p.explosion = { radius: P.radius, damage: P.blast, kind: 'rocket', selfDamage: 0, playerPush: 0, scale: q.blastScale, shake: q.blastShake };
    combat.spawnProjectile(p);
    fx.smoke(p.origin, 0xb9b4aa, 0.9, 1.4);
    fx.sparks(p.origin, _v.copy(_dir).negate(), 5, 0xffa040);
    audio.play('quiver_fire', { pitchJitter: 0.05, pitch: 0.85 });
    camera.addTrauma(0.06);
  }

  private readonly projectile: ProjectileSpec = {
    origin: new THREE.Vector3(), velocity: new THREE.Vector3(), kind: 'rocket', team: 'player', damage: P.damage,
    source: 'frame_pod', trail: 'swarm', gib: true, severMult: 1, force: 70,
    turnRate: TUNING.quiver.turnRate, steerDelay: TUNING.quiver.steerDelay, weave: TUNING.quiver.weave, accel: TUNING.quiver.accel,
    topSpeed: TUNING.quiver.topSpeed, size: 0.7, target: null,
  };

  /** Everyone near the sight with a clear line to them, enemies and then vehicles: the Quiver's rule, from the cockpit. */
  private gather(): readonly PaintCandidate[] {
    const out = this.inView;
    out.length = 0;
    const { enemies } = this.ctx;
    for (let i = 0; i < enemies.alive.length && out.length < MAX_IN_VIEW; i++) this.consider(enemies.alive[i]!);
    const v = enemies.vehicles;
    if (v && typeof v.paintable === 'function') {
      const n = v.paintable(this.paintables);
      for (let i = 0; i < n && out.length < MAX_IN_VIEW; i++) this.consider(this.paintables[i]!);
      this.paintables.length = 0;
    }
    return out;
  }

  private consider(target: MissileTarget): void {
    const sight = this.sight;
    if (!target.alive || !sight) return;
    const at = _v.copy(target.center);
    at.y += target.aimLift ?? 0;
    const angle = angleOff(sight.view.position, sight.aim, at, P.range, Math.cos(P.cone));
    if (angle < 0) return;
    const dir = _w.subVectors(at, sight.view.position);
    const dist = dir.length();
    dir.divideScalar(dist);
    const wall = this.ctx.physics.raycast(sight.view.position, dir, dist, CG.World);
    if (wall && wall.distance < dist - (target.paintRadius ?? 0.6)) return;
    const k = this.inView.length;
    const slot = this.pool[k] ?? (this.pool[k] = { target, angle });
    slot.target = target;
    slot.angle = angle;
    this.inView.push(slot);
  }

  // ---- smoke ----

  /** Flares up and out of the back, and a ring of smoke round the legs that lasts. False when none went. */
  popSmoke(at: THREE.Vector3, yaw: number): boolean {
    if (!this.smoke.pop()) return false;
    const { fx, audio } = this.ctx;
    const S = FRAME.smoke;
    for (let i = 0; i < 10; i++) {
      const a = yaw + Math.PI + ((i - 4.5) / 4.5) * 1.6;
      _v.set(-Math.sin(a) * rand(8, 14), rand(9, 15), -Math.cos(a) * rand(8, 14));
      _at.copy(at);
      _at.y += 5.4;
      this.rounds.flare(_at, _v, 2.6);
    }
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      _at.set(at.x + Math.cos(a) * 4, at.y + rand(1.5, 4), at.z + Math.sin(a) * 4);
      fx.smoke(_at, 0xc4c8cc, S.size * rand(0.8, 1.2), S.seconds);
    }
    audio.play('grenade_throw', { pitch: 0.6 });
    audio.play('steam_burst', { volume: 1, pitch: 0.7 });
    return true;
  }

  /** Off the trigger, quietly: a new run or out of the seat. Shells and missiles in the air still land. */
  silence(): void {
    this.ceaseFire();
    this.spinLoop?.stop(0.2);
    this.spinLoop = null;
  }

  reset(): void {
    this.silence();
    this.rotary.reset();
    this.cannon.reset();
    this.pod.reset();
    this.smoke.reset();
    this.rounds.clear();
  }
}
