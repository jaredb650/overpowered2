/**
 * Mortars. A tube in the yard, a crew on it, and a spotter somewhere with eyes on the player.
 *
 * The order of events is the fairness: a red line from the spotter, a marker round, red smoke, then shells, each with its own ring on
 * the floor. A player who moves when the line appears takes nothing. A player who stands in red smoke deserves what comes next. Kill
 * the spotter and the tubes are blind, kill the crew and they are silent, blow up the tube and it is over for the wave.
 *
 * Sacrifice and danger close are the same fire mission with a different reason, and no spotter, because the men asking are the ones
 * standing in it.
 */
import * as THREE from 'three';
import { rand, TAU } from '../../core/math';
import type { Device } from './devices';
import type { Commander } from './index';
import type { Unit } from './units';

/** Seconds the spotter has to hold the player before the call goes in. */
const LOCK_SECONDS = 1.9;
/** How long he can lose sight of the player without starting again. */
const LOCK_SLACK = 0.7;
/** Seconds the marker round is in the air. */
const MARKER_FLIGHT = 1.5;
/** Seconds of red smoke before the first shell. This is the warning. */
const SMOKE_LEAD = 2.8;
const SHELL_GAP = 0.7;
const SHELLS = 4;
/** Each shell shows its own ring this long before landing. */
const RING_LEAD = 1.2;
const SHELL_RADIUS = 6;
const SHELL_DAMAGE = 55;
/** Metres the shells wander from the smoke. */
const SCATTER = 3.4;
/** Seconds between fire missions, and in Desperation, when nobody is counting rounds. */
const RELOAD = 15;
const RELOAD_DESPERATE = 9;
const SMOKE_EVERY = 0.13;
const MARKER_COLOR = 0xff2a12;
/** Danger close has no marker round. The man drops smoke at his own feet, and shells are already on the way. */
const CLOSE_LEAD = 2.4;
const MAX_SHELLS = 8;

const _a = new THREE.Vector3();
const _sky = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

type Stage = 'idle' | 'lasing' | 'flight' | 'smoke' | 'reload';

interface Shell {
  live: boolean;
  at: number;
  ringed: boolean;
  whistled: boolean;
  readonly point: THREE.Vector3;
}

export class Mortars {
  stage: Stage = 'idle';
  /** Missions flown this run, for the numbers. */
  missions = 0;
  /** Where the tube stands this wave. */
  readonly site = new THREE.Vector3();
  siteReady = false;
  /** Cleared when a blast takes the tube. Nothing fires until the next wave. */
  private tube: Device | null = null;
  private readonly target = new THREE.Vector3();
  private readonly shells: Shell[] = Array.from({ length: MAX_SHELLS }, () => ({ live: false, at: 0, ringed: false, whistled: false, point: new THREE.Vector3() }));
  private clock = 0;
  private lostAt = 0;
  private laser = -1;
  private smokeAt = 0;
  private smokeUntil = 0;
  private count = SHELLS;
  private spotted: Unit | null = null;
  private cause = 'mortar';

  constructor(private readonly c: Commander) {}

  reset(): void {
    this.endLaser();
    this.stage = 'idle';
    this.missions = 0;
    this.siteReady = false;
    this.tube = null;
    this.clock = this.smokeUntil = 0;
    for (const s of this.shells) s.live = false;
  }

  /** The new wave's crew needs ground. As far from the player as a gate gets, because a mortar outranges everything he can see. */
  chooseSite(): void {
    const { w } = this.c;
    if (!this.c.farGate(_a)) return;
    this.site.copy(_a);
    this.siteReady = true;
    if (this.tube) this.c.devices.disarm(this.tube);
    this.tube = this.c.devices.tube(this.site, Math.atan2(w.player.position.x - _a.x, w.player.position.z - _a.z));
  }

  tubeLost(d: Device): void {
    if (d !== this.tube) return;
    this.tube = null;
    this.c.radio('radio.mortar.tubeLost', this.c.units.first('mortar')?.s ?? null);
  }

  /** True while anyone is left to drop a round down the tube. */
  get manned(): boolean {
    return this.tube !== null && this.c.units.count('mortar') > 0;
  }

  get busy(): boolean {
    return this.stage !== 'idle' && this.stage !== 'reload';
  }

  /** A fire mission with no spotter, on ground the men themselves have marked. False if the crew cannot answer. */
  call(at: THREE.Vector3, cause: string, shells: number): boolean {
    if (!this.manned || this.busy || (this.stage === 'reload' && this.clock > RELOAD_DESPERATE * 0.5)) return false;
    this.endLaser();
    this.target.copy(at);
    this.count = shells;
    this.cause = cause;
    this.missions++;
    this.thump();
    this.startSmoke(CLOSE_LEAD);
    return true;
  }

  update(dt: number): void {
    const { w } = this.c;
    const now = w.now;
    this.tickShells(now);
    this.tickSmoke(now);
    switch (this.stage) {
      case 'idle': this.watch(); break;
      case 'lasing': this.lase(now, dt); break;
      case 'flight':
        this.clock -= dt;
        if (this.clock <= 0) this.startSmoke(SMOKE_LEAD);
        break;
      case 'smoke':
        this.clock -= dt;
        if (this.clock <= 0) this.salvo(now);
        break;
      case 'reload':
        this.clock -= dt;
        if (this.clock <= 0) this.stage = 'idle';
        break;
    }
  }

  private watch(): void {
    if (!this.manned) return;
    const u = this.c.units.first('spotter');
    if (!u || !u.s.sees || !this.c.w.player.alive) return;
    this.spotted = u;
    this.stage = 'lasing';
    this.clock = LOCK_SECONDS;
    this.lostAt = this.c.w.now;
    const t = this.c.w.telegraphs;
    this.laser = t.acquireLaser(MARKER_COLOR, 0.8);
    this.c.status('painted', true);
    this.c.w.ctx.audio.play('sniper_charge', { position: u.s.e.center, pitch: 1.5, volume: 0.8 });
    this.c.radio('radio.spotter.eyes', u.s);
  }

  private lase(now: number, dt: number): void {
    const u = this.spotted;
    const { w } = this.c;
    if (!u || !u.s.fighting || !u.s.e.alive || !this.manned) {
      this.abort();
      return;
    }
    if (u.s.sees) this.lostAt = now;
    else if (now - this.lostAt > LOCK_SLACK) {
      this.abort();
      return;
    }
    this.c.units.eyeOf(u, _a);
    w.telegraphs.aimLaser(this.laser, _a, w.player.chest);
    this.clock -= dt;
    if (this.clock > 0) return;
    this.endLaser();
    this.target.copy(w.player.position);
    this.count = SHELLS;
    this.cause = 'mortar';
    this.missions++;
    this.stage = 'flight';
    this.clock = MARKER_FLIGHT;
    this.thump();
    this.c.radio('radio.spotter.fire', u.s);
  }

  /** Lost him, or lost the spotter. The line goes out, and the tubes wait for the next chance. */
  private abort(): void {
    this.endLaser();
    this.stage = 'reload';
    this.clock = 3;
  }

  private endLaser(): void {
    if (this.laser >= 0) this.c.w.telegraphs.releaseLaser(this.laser);
    this.laser = -1;
    this.c.status('painted', false);
  }

  /** The crack from the yard: heard from anywhere, and seen from the wall if the player is looking. */
  private thump(): void {
    const { ctx } = this.c.w;
    _a.copy(this.site);
    _a.y += 1.4;
    ctx.fx.smoke(_a, 0x9aa2aa, 1.2, 1.2);
    ctx.render.lights.flash(_a, 0xffb060, 8, 9, 0.12);
    ctx.audio.play('explosion_distant', { position: _a, volume: 0.9, pitch: 1.6 });
  }

  private startSmoke(lead: number): void {
    const { w } = this.c;
    const { ctx } = w;
    this.stage = 'smoke';
    this.clock = lead;
    this.smokeUntil = w.now + lead + (this.count - 1) * SHELL_GAP + 1.4;
    this.smokeAt = 0;
    w.telegraphs.zone(this.target, SHELL_RADIUS, lead, MARKER_COLOR);
    ctx.audio.play('grenade_bounce', { position: this.target, pitch: 0.6 });
    ctx.audio.play('steam_burst', { position: this.target, volume: 0.6 });
    _a.copy(this.target);
    _a.y += 0.3;
    ctx.fx.smoke(_a, MARKER_COLOR, 2.6, 1.6);
  }

  private tickSmoke(now: number): void {
    if (now >= this.smokeUntil || now < this.smokeAt) return;
    this.smokeAt = now + SMOKE_EVERY;
    const { fx } = this.c.w.ctx;
    const a = rand(0, TAU);
    _a.set(this.target.x + Math.sin(a) * 0.6, this.target.y + rand(0.2, 1.3), this.target.z + Math.cos(a) * 0.6);
    fx.smoke(_a, MARKER_COLOR, rand(2, 3.4), 2.2);
  }

  private salvo(now: number): void {
    const { o, w } = this.c;
    this.stage = 'reload';
    this.clock = this.c.desperate ? RELOAD_DESPERATE : RELOAD;
    const nav = w.ctx.world.nav;
    let placed = 0;
    for (const s of this.shells) {
      if (s.live) continue;
      if (placed >= this.count) break;
      const a = rand(0, TAU);
      const r = placed === 0 ? rand(0, 1) : rand(0.6, 1) * SCATTER;
      s.point.set(this.target.x + Math.sin(a) * r, this.target.y, this.target.z + Math.cos(a) * r);
      if (nav.nearest(s.point, 4, _a)) s.point.copy(_a);
      s.live = true;
      s.at = now + RING_LEAD + placed * SHELL_GAP;
      s.ringed = s.whistled = false;
      placed++;
    }
    // Nobody stays to watch this land, on either side.
    o.noise(this.target, 30);
  }

  private tickShells(now: number): void {
    const { w } = this.c;
    for (const s of this.shells) {
      if (!s.live) continue;
      if (!s.ringed && now >= s.at - RING_LEAD) {
        s.ringed = true;
        w.telegraphs.zone(s.point, SHELL_RADIUS, RING_LEAD);
      }
      if (!s.whistled && now >= s.at - 1) {
        s.whistled = true;
        w.ctx.audio.play('missile_incoming', { position: s.point, volume: 0.65, pitch: rand(1.2, 1.4) });
      }
      if (now >= s.at) this.land(s);
    }
  }

  private land(s: Shell): void {
    const { ctx } = this.c.w;
    s.live = false;
    _sky.copy(s.point);
    _sky.y += 34;
    ctx.fx.tracer(_sky, s.point, 'heavy');
    this.c.boom(s.point, SHELL_RADIUS, SHELL_DAMAGE, this.cause);
    ctx.render.decals.add('scorch', s.point, _up, SHELL_RADIUS * 0.5, rand(0, TAU));
  }
}
