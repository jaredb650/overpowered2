/**
 * The gunship's four guns, and the crew that fires them when the player does not.
 *
 *   Magazine     one gun's rounds and its own reload clock, pure, for the tests
 *   Battery      all four: magazines, the round chosen on the 40 and the 105, and the one way any round leaves the ship.
 *                The seat and the crew both fire through it, so the AI is limited exactly as the player is
 *   FireControl  the crew: who each gun shoots, with which round, and when
 *
 *   25mm      the nearest man, a stream that walks on to him and then along to the next
 *   40mm      the thickest knot, a string of shells laid across it: AP under a roof, flak on a crowd, HE otherwise
 *   105mm     the thickest knot, never near the player, HE and white phosphorus by turns
 *   bomb      once, on a boss or a big knot, steered onto him all the way down
 */
import * as THREE from 'three';
import type { Ctx, LoopHandle, PlayOptions } from '../../core/contracts';
import type { EnemyInstance } from '../../core/gameplay';
import { rand, TAU } from '../../core/math';
import type { GunnerWeapon } from '../../vehicles/hud';
import type { Airframe } from './airframe';
import { flightDelay, soundPoint } from './airframe';
import { AC130 as A } from './ac130Data';
import type { Ac130Mount } from './ac130Model';
import type { Ac130Rounds, RoundKind } from './ac130Rounds';
import type { GroundProbe } from './ground';
import type { Radio } from './radio';

const G = A.gatling;
const B = A.bofors;
const H = A.howitzer;
const M = A.bomb;

export type GunId = 'g25' | 'g40' | 'g105' | 'bomb';
export const GUN_ORDER: readonly GunId[] = ['g25', 'g40', 'g105', 'bomb'];
export type Round40 = 'g40' | 'ap' | 'flak';
export type Round105 = 'g105' | 'wp';
const ROUNDS_40: readonly Round40[] = ['g40', 'ap', 'flak'];
const ROUNDS_105: readonly Round105[] = ['g105', 'wp'];
const ROUND_NAMES: Readonly<Record<Round40 | Round105, string>> = { g40: 'HE', ap: 'AP', flak: 'FLAK', g105: 'HE', wp: 'WP' };

/** Close enough to pan with the aircraft, far enough for the room to take the edge off it. */
const REPORT_RANGE = 30;
/** Most targets to test a line to in one go. */
const LINE_TESTS = 6;
/** Metres short of a wall that a round goes live, so it is sure to strike it. */
const WALL_MARGIN = 3;
/** Metres of open air over a man that make him under a roof, to the crew picking a 40 mm round. */
const ROOF_LOOK = 30;
/** The ship's speed on its circle, which the bomb leaves the ramp with. */
const RAMP_SPEED = 30;

const _from = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _lead = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _d = new THREE.Vector3();
const _report = new THREE.Vector3();
const _play: PlayOptions = {};

/** Seconds a round takes over `distance` metres. The 105 is lobbed on a fixed time, whatever the range. */
export function flightSeconds(kind: RoundKind, distance: number): number {
  switch (kind) {
    case 'g25': return distance / G.speed;
    case 'g105': case 'wp': return H.flight;
    default: return distance / B.speed;
  }
}

/** One gun's magazine and the crew reloading it. Ammunition never runs out, only the magazine does. */
export class Magazine {
  ammo: number;
  /** Seconds left of a reload, or -1 with none running. */
  reloading = -1;
  private wait = 0;

  /** `reload` 0 is a gun that is never reloaded: the glide bomb, one per sortie. */
  constructor(readonly size: number, readonly reload: number, readonly interval: number) {
    this.ammo = size;
  }

  get ready(): boolean {
    return this.ammo > 0 && this.wait <= 0;
  }

  /** 0..1 through the reload, or -1 with none running. */
  get progress(): number {
    return this.reloading < 0 ? -1 : 1 - this.reloading / this.reload;
  }

  update(dt: number): void {
    this.wait -= dt;
    if (this.reloading < 0) return;
    this.reloading -= dt;
    if (this.reloading > 0) return;
    this.reloading = -1;
    this.ammo = this.size;
  }

  /** Spends a round if one is ready. An empty magazine goes straight to its crew. */
  take(): boolean {
    if (!this.ready) return false;
    this.ammo--;
    this.wait = this.interval;
    if (this.ammo === 0 && this.reload > 0) this.reloading = this.reload;
    return true;
  }
}

/** All four guns. Every round either the seat or the crew fires leaves through here. */
export class Battery {
  readonly mags: Readonly<Record<GunId, Magazine>> = {
    g25: new Magazine(G.magazine, G.reload, G.interval),
    g40: new Magazine(B.magazine, B.reload, B.interval),
    g105: new Magazine(H.magazine, H.reload, H.interval),
    bomb: new Magazine(1, 0, 0),
  };
  selected: GunId = 'g25';
  round40: Round40 = 'g40';
  round105: Round105 = 'g105';
  /** The player's, while seated: reports are in the head and every shot kicks the view. The crew's are heard from below. */
  seated = false;
  /** For the panel, in key order. */
  readonly weapons: GunnerWeapon[] = GUN_ORDER.map(() => ({ name: '', ammo: 0, max: 1, reload: -1, selected: false }));
  /** Seconds left of the ramp opening, or -1. */
  private bay = -1;
  private stream: LoopHandle | null = null;
  private streaming = false;

  constructor(
    private readonly ctx: Ctx,
    readonly probe: GroundProbe,
    private readonly airframe: Airframe<Ac130Mount>,
    private readonly rounds: Ac130Rounds,
  ) {}

  /** Where the glide bomb steers. Whoever is firing moves it every frame. */
  get laser(): THREE.Vector3 {
    return this.rounds.laser;
  }

  ready(gun: GunId): boolean {
    return this.mags[gun].ready && (gun !== 'bomb' || this.bay < 0);
  }

  /** True from the bomb's release until it lands. Where it steers is `rounds.laser`. */
  get guiding(): boolean {
    return this.bay >= 0 || this.rounds.bombLive;
  }

  /** The next round on a gun that has a choice. Returns false for one that does not. */
  cycle(gun: GunId): boolean {
    if (gun === 'g40') this.round40 = ROUNDS_40[(ROUNDS_40.indexOf(this.round40) + 1) % ROUNDS_40.length]!;
    else if (gun === 'g105') this.round105 = ROUNDS_105[(ROUNDS_105.indexOf(this.round105) + 1) % ROUNDS_105.length]!;
    else return false;
    return true;
  }

  update(dt: number): void {
    for (const gun of GUN_ORDER) {
      const mag = this.mags[gun];
      const wasLoading = mag.reloading >= 0;
      mag.update(dt);
      if (wasLoading && mag.reloading < 0 && this.seated) this.ctx.audio.play(gun === 'g105' ? 'reload_rocket' : 'reload_shell_in', { volume: 0.6 });
    }
    if (!this.streaming) this.endStream();
    this.streaming = false;
    if (this.bay >= 0) {
      this.bay -= dt;
      if (this.bay < 0) this.release();
    }
    this.label();
  }

  private label(): void {
    for (let i = 0; i < GUN_ORDER.length; i++) {
      const gun = GUN_ORDER[i]!;
      const mag = this.mags[gun];
      const w = this.weapons[i]!;
      w.ammo = mag.ammo;
      w.max = mag.size;
      w.reload = mag.progress;
      w.selected = gun === this.selected;
    }
    this.weapons[0]!.name = '1 25MM GATLING';
    this.weapons[1]!.name = this.round40 === 'g40' ? '2 40MM HE' : this.round40 === 'ap' ? '2 40MM AP' : '2 40MM FLAK';
    this.weapons[2]!.name = this.round105 === 'g105' ? '3 105MM HE' : '3 105MM WP';
    this.weapons[3]!.name = this.bay >= 0 ? '4 BAY OPENING' : this.rounds.bombLive ? '4 GUIDING' : '4 GLIDE BOMB';
  }

  /** Blasts need air under them: a ray from an exact floor point reaches nobody. See aboveFloor in shared.ts. */
  ground(p: THREE.Vector3): void {
    const h = this.probe.heightAt(p.x, p.y + 4, p.z, 30);
    if (!Number.isNaN(h)) p.y = h + 0.35;
  }

  /**
   * How close to its aim a round starts to collide with the world, for a shot arriving along a unit direction that
   * points back up its path. A wall in the way stops a round, as it should. A roof would stop the crew's every round, so
   * one that high is left out of it, as the Warthog's shells do, unless the round is AP and is meant to meet it. A round
   * is never armed further out than this line was tested. The probe and the rounds both pass the maps' invisible
   * containment (CG.Air): the ship flies outside it, and its rounds once burst on its outer faces in mid-air.
   */
  armRange(aim: THREE.Vector3, dx: number, dy: number, dz: number, reach: number, meetRoofs = false): number {
    const open = this.probe.clearance(aim.x, aim.y + 0.3, aim.z, dx, dy, dz, reach);
    if (open >= reach) return reach;
    return open * dy > A.roofHeight && !meetRoofs ? open : open + WALL_MARGIN;
  }

  /** A gun's report: in the head from the seat, from the aircraft and late by the sound's fall on the ground. */
  report(id: string, muzzle: THREE.Vector3, volume: number, pitch: number): void {
    _play.volume = volume;
    _play.pitch = pitch;
    if (this.seated) {
      _play.position = undefined;
      _play.delay = 0;
    } else {
      _play.delay = flightDelay(soundPoint(muzzle, this.ctx.player.eye, REPORT_RANGE, _report));
      _play.position = _report;
    }
    this.ctx.audio.play(id, _play);
  }

  private kick(trauma: number): void {
    if (this.seated) this.ctx.camera.addTrauma(trauma);
  }

  /**
   * One 25 mm round at `aim`, opened by `spread` radians. False with the magazine empty or between rounds. Call every
   * frame the trigger is held: the stream's sound runs while it is.
   */
  fire25(aim: THREE.Vector3, spread: number): boolean {
    const mag = this.mags.g25;
    if (mag.ammo > 0) this.openStream();
    if (!mag.take()) return false;
    this.airframe.mount('gun25', _from);
    const r = _from.distanceTo(aim) * spread;
    _aim.copy(aim);
    _aim.x += rand(-r, r);
    _aim.z += rand(-r, r);
    this.ground(_aim);
    this.shoot('g25', _aim, false);
    this.rounds.flash(_from, 1, 0.05, 5, 9, 6, 2.4);
    this.kick(0.05);
    return true;
  }

  private openStream(): void {
    this.streaming = true;
    if (this.stream) return;
    this.airframe.mount('gun25', _from);
    soundPoint(_from, this.ctx.player.eye, REPORT_RANGE, _report);
    this.stream = this.ctx.audio.startLoop('enemy_minigun_loop', { position: this.seated ? undefined : _report, volume: 0.75, pitch: 0.6, fadeIn: 0.05 });
  }

  private endStream(): void {
    this.stream?.stop(0.12);
    this.stream = null;
  }

  /** One 40 mm shell of the chosen round. AP is aimed on past what the sight is on, since it is meant to go through it. */
  fire40(aim: THREE.Vector3, spread: number): boolean {
    if (!this.mags.g40.take()) return false;
    const round = this.round40;
    this.airframe.mount('gun40', _from);
    _aim.copy(aim);
    const r = _from.distanceTo(aim) * spread;
    _aim.x += rand(-r, r);
    _aim.z += rand(-r, r);
    if (round === 'ap') _aim.addScaledVector(_d.subVectors(_aim, _from).normalize(), B.ap.beyond);
    this.shoot(round, _aim, round === 'ap');
    this.rounds.flash(_from, 2.4, 0.08, 9, 10, 5, 1.4);
    this.report('autocannon_fire', _from, 1.6, round === 'ap' ? 0.8 : 0.72);
    this.kick(0.12);
    return true;
  }

  /** A 105 on a real arc, onto `aim` in `H.flight` seconds. */
  fire105(aim: THREE.Vector3): boolean {
    if (!this.mags.g105.take()) return false;
    this.airframe.mount('gun105', _from);
    // Arrives along its tangent, which is steep, so the arm test is on that line and not on the one back to the gun.
    _d.subVectors(_from, aim).divideScalar(H.flight);
    _d.y += 0.5 * H.gravity * H.flight;
    _d.normalize();
    this.rounds.fire(this.round105, _from, aim, H.flight, H.gravity, this.armRange(aim, _d.x, _d.y, _d.z, 160));
    this.rounds.flash(_from, 6, 0.12, 22, 12, 8, 3);
    this.ctx.fx.smoke(_from, 0xb4bcc4, 3.2, 2.2);
    this.report('rocket_fire', _from, 2, 0.5);
    this.report('explosion_distant', _from, 0.5, 1.2);
    this.kick(0.45);
    return true;
  }

  /** The glide bomb: the ramp opens, and it falls out `M.bay` seconds later. False once it has gone. */
  dropBomb(aim: THREE.Vector3): boolean {
    if (this.bay >= 0 || !this.mags.bomb.take()) return false;
    this.bay = M.bay;
    this.rounds.laser.copy(aim);
    this.airframe.mount('ramp', _from);
    this.report('metal_groan', _from, 0.9, 0.7);
    return true;
  }

  private release(): void {
    const { airframe, rounds } = this;
    airframe.mount('ramp', _from);
    this.report('casing_heavy', _from, 1, 0.8);
    airframe.root.getWorldDirection(_vel).multiplyScalar(RAMP_SPEED);
    _vel.y -= 3;
    rounds.drop(_from, _vel);
  }

  /** A straight round from the last mount read to `aim`. */
  private shoot(kind: RoundKind, aim: THREE.Vector3, meetRoofs: boolean): void {
    _d.subVectors(_from, aim);
    const reach = _d.length();
    _d.divideScalar(reach);
    this.rounds.fire(kind, _from, aim, flightSeconds(kind, reach), 0, this.armRange(aim, _d.x, _d.y, _d.z, reach, meetRoofs));
  }

  /** Off station or handed over: what is in the air still lands. */
  silence(): void {
    this.endStream();
  }
}

/** The crew: picks a target and a round for each gun, and fires them through the same Battery the seat does. */
export class FireControl {
  private readonly targets: EnemyInstance[] = [];
  private count = 0;
  private scanIn = 0;
  /** Seconds since anyone was in the box. */
  private quiet = 0;
  private toldQuiet = false;
  private wpNext = false;
  private bombTarget: EnemyInstance | null = null;

  private readonly g25 = { wait: 0, left: 0, aim: new THREE.Vector3(), drift: new THREE.Vector3(), target: null as EnemyInstance | null };
  private readonly g40 = { wait: 0, left: 0, next: new THREE.Vector3(), step: new THREE.Vector3() };
  private readonly g105 = { wait: 0, splashIn: 0 };

  constructor(
    private readonly ctx: Ctx,
    private readonly battery: Battery,
    private readonly airframe: Airframe<Ac130Mount>,
    private readonly center: THREE.Vector3,
    private readonly radius: number,
    private readonly radio: Radio,
    private readonly prisoners: ReadonlySet<number>,
  ) {
    this.g25.aim.copy(center);
  }

  /** `onStation` is seconds since the ship came on station, which holds the bomb back for a while. */
  update(dt: number, onStation: number): void {
    this.scanIn -= dt;
    if (this.scanIn <= 0) this.scan();
    if (this.count > 0) {
      this.quiet = 0;
      this.toldQuiet = false;
    } else {
      this.quiet += dt;
    }
    if (this.quiet > G.reconAfter && !this.toldQuiet) {
      this.toldQuiet = true;
      this.radio.say('NO MOVERS IN THE BOX. RAKING IT.');
    }
    this.gatling(dt);
    this.bofors(dt);
    this.howitzer(dt);
    this.bomb(onStation);
    this.splash(dt);
  }

  private scan(): void {
    this.scanIn = A.scanEvery;
    const list = this.targets;
    const n = this.ctx.enemies.query(this.center, this.radius + A.scanMargin, list) || 0;
    let kept = 0;
    for (let i = 0; i < n; i++) {
      const e = list[i]!;
      if (e.alive && !this.prisoners.has(e.uid)) list[kept++] = e;
    }
    this.count = kept;
  }

  // --- Solving where to shoot ---------------------------------------------------------------------------------------

  /** Where `e` will be in `seconds`, or as near as a straight line can say. Walkers stand on a floor and flyers do not. */
  private lead(e: EnemyInstance, seconds: number, out: THREE.Vector3): THREE.Vector3 {
    out.copy(e.id === 'drone' ? e.center : e.position).addScaledVector(e.velocity, Math.min(seconds, 2.5));
    if (e.id !== 'drone') this.battery.ground(out);
    return out;
  }

  private hasLine(e: EnemyInstance): boolean {
    this.airframe.mount('gun25', _from);
    _d.subVectors(_from, e.center);
    const reach = _d.length();
    _d.divideScalar(reach);
    const c = e.center;
    const open = this.battery.probe.clearance(c.x, c.y, c.z, _d.x, _d.y, _d.z, reach);
    return open >= reach || open * _d.y > A.roofHeight;
  }

  /** Nearest to `ref` with a clear line, or just the nearest when the whole box is behind cover. */
  private nearest(ref: THREE.Vector3): EnemyInstance | null {
    let close: EnemyInstance | null = null;
    let closeD = Infinity;
    let clear: EnemyInstance | null = null;
    let clearD = Infinity;
    let tests = 0;
    for (let i = 0; i < this.count; i++) {
      const e = this.targets[i]!;
      if (!e.alive) continue;
      const d = e.position.distanceToSquared(ref);
      if (d < closeD) {
        closeD = d;
        close = e;
      }
      if (d < clearD && tests < LINE_TESTS) {
        tests++;
        if (this.hasLine(e)) {
          clearD = d;
          clear = e;
        }
      }
    }
    return clear ?? close;
  }

  /**
   * The middle of the thickest knot of enemies further than `safe` from the player, and how it is moving. Writes `out`
   * and `velocity`, and returns how many are in it: 0 when there is nobody to shoot.
   */
  private knot(out: THREE.Vector3, velocity: THREE.Vector3, safe: number): number {
    const eye = this.ctx.player.position;
    const r2 = A.clusterRadius * A.clusterRadius;
    let best: EnemyInstance | null = null;
    let bestN = 0;
    for (let i = 0; i < this.count; i++) {
      const e = this.targets[i]!;
      if (!e.alive || e.position.distanceTo(eye) < safe) continue;
      let n = 0;
      for (let j = 0; j < this.count; j++) if (this.targets[j]!.alive && this.targets[j]!.position.distanceToSquared(e.position) < r2) n++;
      if (n > bestN) {
        bestN = n;
        best = e;
      }
    }
    if (!best) return 0;
    out.set(0, 0, 0);
    velocity.set(0, 0, 0);
    let n = 0;
    for (let i = 0; i < this.count; i++) {
      const e = this.targets[i]!;
      if (!e.alive || e.position.distanceToSquared(best.position) >= r2) continue;
      out.add(e.position);
      velocity.add(e.velocity);
      n++;
    }
    out.divideScalar(n);
    velocity.divideScalar(n);
    return n;
  }

  /** Somewhere in the box, for when there is nobody to shoot and the guns should not fall silent. */
  private anywhere(out: THREE.Vector3): void {
    const a = rand(0, TAU);
    const r = Math.sqrt(Math.random()) * this.radius;
    out.set(this.center.x + Math.cos(a) * r, this.center.y, this.center.z + Math.sin(a) * r);
    this.battery.ground(out);
  }

  // --- 25mm ---------------------------------------------------------------------------------------------------------

  private gatling(dt: number): void {
    const g = this.g25;
    if (g.left <= 0) {
      g.wait -= dt;
      if (g.wait > 0 || !this.battery.ready('g25')) return;
      if (!this.openBurst()) {
        g.wait = G.retry;
        return;
      }
    }
    g.left -= dt;
    this.walk(dt);
    _aim.copy(g.aim);
    _aim.x += rand(-G.scatter, G.scatter);
    _aim.z += rand(-G.scatter, G.scatter);
    // A round per frame at most: the crew's stream is a little thinner than the seat's, which can be told apart.
    this.battery.fire25(_aim, 0);
    if (this.battery.mags.g25.ammo === 0) g.left = 0;
    if (g.left <= 0) g.wait = G.gap * rand(0.8, 1.2);
  }

  private openBurst(): boolean {
    const g = this.g25;
    g.target = this.nearest(g.aim);
    if (g.target) {
      this.lead(g.target, 1.3, _lead);
      this.airframe.mount('gun25', _from);
      _d.subVectors(_from, _lead).setY(0).normalize();
      g.aim.copy(_lead).addScaledVector(_d, G.walkIn);
    } else if (this.quiet > G.reconAfter) {
      this.anywhere(g.aim);
      const a = rand(0, TAU);
      g.drift.set(Math.cos(a), 0, Math.sin(a));
    } else {
      return false;
    }
    g.left = rand(G.burst[0], G.burst[1]);
    return true;
  }

  /** The aim is dragged, never set, so a new target means the stream visibly crossing the ground to reach him. */
  private walk(dt: number): void {
    const g = this.g25;
    if (g.target && !g.target.alive) g.target = this.nearest(g.aim);
    if (g.target) {
      _d.subVectors(this.lead(g.target, 1.3, _lead), g.aim);
      const far = _d.length();
      const step = G.walkSpeed * dt;
      if (far > step) g.aim.addScaledVector(_d, step / far);
      else g.aim.copy(_lead);
    } else {
      g.aim.addScaledVector(g.drift, G.walkSpeed * dt);
      this.battery.ground(g.aim);
    }
  }

  // --- 40mm ---------------------------------------------------------------------------------------------------------

  private bofors(dt: number): void {
    const g = this.g40;
    if (g.left <= 0) {
      g.wait -= dt;
      if (g.wait > 0) return;
      if (!this.openString()) {
        g.wait = B.retry;
        return;
      }
    }
    if (!this.battery.ready('g40')) return;
    _aim.copy(g.next);
    _aim.x += rand(-B.scatter, B.scatter);
    _aim.z += rand(-B.scatter, B.scatter);
    this.battery.ground(_aim);
    g.next.add(g.step);
    this.battery.fire40(_aim, 0);
    if (--g.left <= 0) g.wait = B.gap * rand(0.85, 1.15);
  }

  /**
   * Picks the round, and lays the string across the line of fire so it reads as a row of bursts stepping over the knot.
   * Men under a roof get AP, a crowd in the open gets flak, anyone else HE.
   */
  private openString(): boolean {
    const g = this.g40;
    const n = this.knot(_lead, _vel, 0);
    if (n === 0) return false;
    this.airframe.mount('gun40', _from);
    const flight = _from.distanceTo(_lead) / B.speed;
    _lead.addScaledVector(_vel, Math.min(flight, 2.5));
    const roofed = this.battery.probe.clearance(_lead.x, _lead.y + 0.3, _lead.z, 0, 1, 0, ROOF_LOOK) < ROOF_LOOK;
    this.battery.round40 = roofed ? 'ap' : n >= B.flak.knot ? 'flak' : 'g40';
    _d.subVectors(_from, _lead).setY(0).normalize();
    const side = Math.random() < 0.5 ? B.spacing : -B.spacing;
    // A crowd in the open is one flak burst over its middle after another, not a line across it.
    if (this.battery.round40 === 'flak') g.step.set(0, 0, 0);
    else g.step.set(-_d.z * side, 0, _d.x * side);
    g.next.copy(_lead).addScaledVector(g.step, -(B.shells - 1) / 2);
    g.left = B.shells;
    return true;
  }

  // --- 105mm --------------------------------------------------------------------------------------------------------

  private howitzer(dt: number): void {
    const g = this.g105;
    g.wait -= dt;
    if (g.wait > 0 || !this.battery.ready('g105')) return;
    if (this.knot(_aim, _vel, H.noFire) === 0) {
      g.wait = H.retry;
      return;
    }
    _aim.addScaledVector(_vel, Math.min(H.flight, 2.5));
    _aim.x += rand(-H.spread, H.spread);
    _aim.z += rand(-H.spread, H.spread);
    this.battery.ground(_aim);
    const player = this.ctx.player.position;
    _d.subVectors(_aim, player).setY(0);
    if (_d.length() < H.noFire) _aim.copy(player).addScaledVector(_d.normalize(), H.noFire);
    this.battery.round105 = this.wpNext ? 'wp' : 'g105';
    this.wpNext = !this.wpNext;
    this.battery.fire105(_aim);
    g.wait = H.gap * rand(0.9, 1.1);
    if (g.splashIn <= 0) {
      this.radio.say(this.battery.round105 === 'wp' ? 'WILLIE PETE, SHOT.' : 'SHOT, OVER.');
      g.splashIn = H.flight - 1.6;
    }
  }

  /** The call that comes just before the shell, and why anyone on the ground would want it. */
  private splash(dt: number): void {
    const g = this.g105;
    if (g.splashIn <= 0) return;
    g.splashIn -= dt;
    if (g.splashIn <= 0) this.radio.say('SPLASH.');
  }

  // --- Glide bomb ---------------------------------------------------------------------------------------------------

  /** Once a sortie, on the biggest thing in the box. The laser stays on him all the way down. */
  private bomb(onStation: number): void {
    const { battery } = this;
    const laser = this.bombTarget;
    if (battery.guiding) {
      if (laser?.alive) this.lead(laser, 0.6, battery.laser);
      return;
    }
    this.bombTarget = null;
    if (onStation < M.after || !battery.ready('bomb')) return;
    const target = this.boss() ?? (this.knot(_aim, _vel, H.noFire) >= M.knot ? this.nearest(_aim) : null);
    if (!target) return;
    this.bombTarget = target;
    battery.dropBomb(this.lead(target, 0, _aim));
    this.radio.say('BOMB AWAY. LASER ON.');
  }

  private boss(): EnemyInstance | null {
    for (let i = 0; i < this.count; i++) {
      const e = this.targets[i]!;
      if (e.alive && e.isBoss) return e;
    }
    return null;
  }
}
