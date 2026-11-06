/**
 * Fire control: who each gun shoots and when. The crew works alone, so every gun has its own rhythm and its own idea of
 * a good target, and the player only ever hears about it on the radio.
 *
 *   25mm     the nearest man, a stream that walks on to him and then along to the next
 *   40mm     the thickest knot, a string of shells laid across it
 *   105mm    the thickest knot, a few slow shells on real arcs, never near the player
 *   Hellfire whoever has the most armour and health
 */
import * as THREE from 'three';
import type { Ctx, LoopHandle, PlayOptions } from '../../core/contracts';
import type { EnemyInstance } from '../../core/gameplay';
import { rand, TAU } from '../../core/math';
import type { Airframe } from './airframe';
import { flightDelay, soundPoint } from './airframe';
import { AC130 as A, type SiegePhase } from './ac130Data';
import type { Ac130Mount } from './ac130Model';
import type { Ac130Rounds } from './ac130Rounds';
import type { GroundProbe } from './ground';
import type { Radio } from './radio';

const G = A.gatling;
const B = A.bofors;
const H = A.howitzer;
const M = A.hellfire;

/** Close enough to pan with the aircraft, far enough for the room to take the edge off it. */
const REPORT_RANGE = 30;
/** Most targets to test a line to in one go. */
const LINE_TESTS = 6;
/** Metres short of a wall that a round goes live, so it is sure to strike it. */
const WALL_MARGIN = 3;

const _from = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _lead = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _d = new THREE.Vector3();
const _report = new THREE.Vector3();
const _play: PlayOptions = {};

export class FireControl {
  private readonly targets: EnemyInstance[] = [];
  private count = 0;
  private scanIn = 0;
  /** Seconds since anyone was in the box. */
  private quiet = 0;
  private toldQuiet = false;

  private readonly g25 = {
    wait: 0, left: 0, shotIn: 0, aim: new THREE.Vector3(), drift: new THREE.Vector3(), target: null as EnemyInstance | null, loop: null as LoopHandle | null,
  };
  private readonly g40 = { wait: 0, left: 0, shotIn: 0, next: new THREE.Vector3(), step: new THREE.Vector3() };
  private readonly g105 = { wait: 0, left: 0, shotIn: 0, splashIn: 0 };
  private hellfireWait = 0;
  private rail = false;

  constructor(
    private readonly ctx: Ctx,
    private readonly probe: GroundProbe,
    private readonly airframe: Airframe<Ac130Mount>,
    private readonly rounds: Ac130Rounds,
    private readonly center: THREE.Vector3,
    private readonly radius: number,
    private readonly radio: Radio,
    private readonly prisoners: ReadonlySet<number>,
  ) {
    this.g25.aim.copy(center);
  }

  update(dt: number, phase: SiegePhase): void {
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
    this.gatling(dt, phase.gatlingGap);
    if (phase.boforsGap > 0) this.bofors(dt, phase);
    if (phase.howitzerGap > 0) this.howitzer(dt, phase);
    if (phase.hellfireGap > 0) this.hellfire(dt, phase.hellfireGap);
    this.splash(dt);
  }

  /** Off station: what is in the air still lands, nothing new leaves. */
  ceaseFire(): void {
    this.g25.left = 0;
    this.stopStream();
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
    if (e.id !== 'drone') this.ground(out);
    return out;
  }

  /** Blasts need air under them: a ray from an exact floor point reaches nobody. See aboveFloor in shared.ts. */
  private ground(p: THREE.Vector3): void {
    const h = this.probe.heightAt(p.x, p.y + 4, p.z, 30);
    if (!Number.isNaN(h)) p.y = h + 0.35;
  }

  /**
   * How close to its aim a round starts to collide with the world, for a shot arriving along a unit direction that
   * points back up its path. A wall in the way stops a round, as it should. A roof would stop every round for two
   * minutes, so one that high is left out of it, as the Warthog's shells do. A round is never armed further out than
   * this line was tested: the ship flies outside both maps' invisible walls, and a round live from the muzzle would burst
   * on their outer faces in mid-air.
   */
  private armRange(aim: THREE.Vector3, dx: number, dy: number, dz: number, reach: number): number {
    const open = this.probe.clearance(aim.x, aim.y + 0.3, aim.z, dx, dy, dz, reach);
    if (open >= reach) return reach;
    return open * dy > A.roofHeight ? open : open + WALL_MARGIN;
  }

  private hasLine(e: EnemyInstance): boolean {
    this.airframe.mount('gun25', _from);
    _d.subVectors(_from, e.center);
    const reach = _d.length();
    _d.divideScalar(reach);
    const c = e.center;
    const open = this.probe.clearance(c.x, c.y, c.z, _d.x, _d.y, _d.z, reach);
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
   * and `velocity`, and returns false when there is nobody to shoot.
   */
  private knot(out: THREE.Vector3, velocity: THREE.Vector3, safe: number): boolean {
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
    if (!best) return false;
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
    return true;
  }

  /** Somewhere in the box, for when there is nobody to shoot and the guns should not fall silent. */
  private anywhere(out: THREE.Vector3): void {
    const a = rand(0, TAU);
    const r = Math.sqrt(Math.random()) * this.radius;
    out.set(this.center.x + Math.cos(a) * r, this.center.y, this.center.z + Math.sin(a) * r);
    this.ground(out);
  }

  /** A gun's report, late by the time sound takes to come down. */
  private report(id: string, muzzle: THREE.Vector3, volume: number, pitch: number): void {
    const distance = soundPoint(muzzle, this.ctx.player.eye, REPORT_RANGE, _report);
    _play.position = _report;
    _play.volume = volume;
    _play.pitch = pitch;
    _play.delay = flightDelay(distance);
    this.ctx.audio.play(id, _play);
  }

  // --- 25mm ---------------------------------------------------------------------------------------------------------

  private gatling(dt: number, gap: number): void {
    const g = this.g25;
    if (g.left <= 0) {
      g.wait -= dt;
      if (g.wait > 0) return;
      if (!this.openBurst()) {
        g.wait = G.retry;
        return;
      }
    }
    g.left -= dt;
    this.walk(dt);
    g.shotIn -= dt;
    while (g.shotIn <= 0) {
      g.shotIn += 1 / G.roundsPerSecond;
      this.fire25();
    }
    if (g.left <= 0) {
      this.stopStream();
      g.wait = gap * rand(0.8, 1.2);
    }
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
    g.shotIn = 0;
    this.airframe.mount('gun25', _from);
    soundPoint(_from, this.ctx.player.eye, REPORT_RANGE, _report);
    g.loop = this.ctx.audio.startLoop('enemy_minigun_loop', { position: _report, volume: 0.75, pitch: 0.6, fadeIn: 0.05 });
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
      this.ground(g.aim);
    }
  }

  private fire25(): void {
    const g = this.g25;
    this.airframe.mount('gun25', _from);
    _aim.copy(g.aim);
    _aim.x += rand(-G.scatter, G.scatter);
    _aim.z += rand(-G.scatter, G.scatter);
    this.ground(_aim);
    _d.subVectors(_from, _aim);
    const reach = _d.length();
    _d.divideScalar(reach);
    this.rounds.fire('g25', _from, _aim, reach / G.speed, 0, this.armRange(_aim, _d.x, _d.y, _d.z, reach));
    this.rounds.flash(_from, 1, 0.05, 5, 9, 6, 2.4);
  }

  private stopStream(): void {
    this.g25.loop?.stop(0.12);
    this.g25.loop = null;
  }

  // --- 40mm ---------------------------------------------------------------------------------------------------------

  private bofors(dt: number, phase: SiegePhase): void {
    const g = this.g40;
    if (g.left <= 0) {
      g.wait -= dt;
      if (g.wait > 0) return;
      if (!this.openString(phase.boforsShells)) {
        g.wait = B.retry;
        return;
      }
    }
    g.shotIn -= dt;
    if (g.shotIn > 0) return;
    g.shotIn += B.gap;
    this.fire40();
    if (--g.left <= 0) g.wait = phase.boforsGap * rand(0.85, 1.15);
  }

  /** Lays the string across the line of fire, so it reads as a row of bursts stepping over the knot. */
  private openString(shells: number): boolean {
    const g = this.g40;
    if (!this.knot(_lead, _vel, 0)) return false;
    this.airframe.mount('gun40', _from);
    const flight = _from.distanceTo(_lead) / B.speed;
    _lead.addScaledVector(_vel, Math.min(flight, 2.5));
    _d.subVectors(_from, _lead).setY(0).normalize();
    const side = Math.random() < 0.5 ? B.spacing : -B.spacing;
    g.step.set(-_d.z * side, 0, _d.x * side);
    g.next.copy(_lead).addScaledVector(g.step, -(shells - 1) / 2);
    g.left = shells;
    g.shotIn = 0;
    return true;
  }

  private fire40(): void {
    const g = this.g40;
    this.airframe.mount('gun40', _from);
    _aim.copy(g.next);
    _aim.x += rand(-B.scatter, B.scatter);
    _aim.z += rand(-B.scatter, B.scatter);
    this.ground(_aim);
    g.next.add(g.step);
    _d.subVectors(_from, _aim);
    const reach = _d.length();
    _d.divideScalar(reach);
    this.rounds.fire('g40', _from, _aim, reach / B.speed, 0, this.armRange(_aim, _d.x, _d.y, _d.z, reach));
    this.rounds.flash(_from, 2.4, 0.08, 9, 10, 5, 1.4);
    this.report('autocannon_fire', _from, 1.6, 0.72);
  }

  // --- 105mm --------------------------------------------------------------------------------------------------------

  private howitzer(dt: number, phase: SiegePhase): void {
    const g = this.g105;
    if (g.left <= 0) {
      g.wait -= dt;
      if (g.wait > 0) return;
      g.left = phase.howitzerShots;
      g.shotIn = 0;
    }
    g.shotIn -= dt;
    if (g.shotIn > 0) return;
    if (this.fire105()) {
      g.shotIn = H.gap;
      if (--g.left <= 0) g.wait = phase.howitzerGap * rand(0.9, 1.1);
    } else {
      g.left = 0;
      g.wait = H.retry;
    }
  }

  private fire105(): boolean {
    const g = this.g105;
    if (!this.knot(_aim, _vel, H.noFire)) return false;
    _aim.addScaledVector(_vel, Math.min(H.flight, 2.5));
    _aim.x += rand(-H.spread, H.spread);
    _aim.z += rand(-H.spread, H.spread);
    this.ground(_aim);
    const player = this.ctx.player.position;
    _d.subVectors(_aim, player).setY(0);
    if (_d.length() < H.noFire) _aim.copy(player).addScaledVector(_d.normalize(), H.noFire);

    this.airframe.mount('gun105', _from);
    // Arrives along its tangent, which is steep, so the arm test is on that line and not on the one back to the gun.
    _d.subVectors(_from, _aim).divideScalar(H.flight);
    _d.y += 0.5 * H.gravity * H.flight;
    _d.normalize();
    this.rounds.fire('g105', _from, _aim, H.flight, H.gravity, this.armRange(_aim, _d.x, _d.y, _d.z, 160));
    this.rounds.flash(_from, 6, 0.12, 22, 12, 8, 3);
    this.ctx.fx.smoke(_from, 0xb4bcc4, 3.2, 2.2);
    this.report('rocket_fire', _from, 2, 0.5);
    this.report('explosion_distant', _from, 0.5, 1.2);

    if (g.splashIn <= 0) {
      this.radio.say('SHOT, OVER.');
      g.splashIn = H.flight - 1.6;
    }
    return true;
  }

  /** The call that comes just before the shell, and why anyone on the ground would want it. */
  private splash(dt: number): void {
    const g = this.g105;
    if (g.splashIn <= 0) return;
    g.splashIn -= dt;
    if (g.splashIn <= 0) this.radio.say('SPLASH.');
  }

  // --- Hellfire -----------------------------------------------------------------------------------------------------

  private hellfire(dt: number, gap: number): void {
    this.hellfireWait -= dt;
    if (this.hellfireWait > 0) return;
    const target = this.priority();
    if (!target) {
      this.hellfireWait = M.retry;
      return;
    }
    this.hellfireWait = gap * rand(0.85, 1.15);
    this.rail = !this.rail;
    this.airframe.mount(this.rail ? 'railLeft' : 'railRight', _from);
    this.airframe.root.getWorldDirection(_vel).multiplyScalar(40);
    _vel.y -= 6;
    // It arrives from almost straight above, so that is the line to test, not the one back to the rail.
    this.rounds.launch(_from, _vel, target, target.center, this.armRange(target.center, 0, 1, 0, M.armWithin));
    this.report('rocket_fire', _from, 1.4, 0.85);
    this.radio.say('RIFLE.');
  }

  /** Armour and health decide it, so a Brute is hunted before a Husk and a boss before anyone. */
  private priority(): EnemyInstance | null {
    let best: EnemyInstance | null = null;
    let score = -1;
    for (let i = 0; i < this.count; i++) {
      const e = this.targets[i]!;
      if (!e.alive || this.rounds.hunting(e)) continue;
      const worth = e.maxHealth + e.armor + (e.isBoss ? 1e6 : 0);
      if (worth > score) {
        score = worth;
        best = e;
      }
    }
    return best;
  }
}
