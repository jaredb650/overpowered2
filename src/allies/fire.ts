/**
 * What an ally's gun does. Fact 10 of docs/notes/hive-mission-plan.md: an ally's round never goes through `combat.fireRay`, which
 * ticks the player's hit marker and pays for kills. It tests the world and `enemies.raycast` itself and hands the hit to
 * `enemies.applyDamage` with an `ally_` source. Nothing here can reach the player or another ally: the only bodies it tests are
 * the enemy's. A rocket is the same: its burst is resolved here, never through `combat.explode`, so it has no self damage, no
 * push and no hit marker.
 */
import * as THREE from 'three';
import { CG, type Ctx, type DamageInfo } from '../core/contracts';
import type { EnemyInstance } from '../core/gameplay';
import { rand, randomUnit } from '../core/math';
import { muzzleOf } from '../enemies/attacks';
import type { EnemyManager } from '../enemies/EnemyManager';
import type { Ally } from './ally';
import { SURFACE_SOUND } from '../weapons/data';
import type { AllyGun } from './data';

const _muzzle = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _end = new THREE.Vector3();
const _rand = new THREE.Vector3();
const _to = new THREE.Vector3();
const _n = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** Metres either side of the line of fire the player has to be clear by, or the man holds his burst. */
const PLAYER_CLEAR = 0.75;
const BLAST_IMPULSE = 12;
const MAX_ROCKETS = 8;

interface Rocket {
  live: boolean;
  at: number;
  readonly from: THREE.Vector3;
  readonly point: THREE.Vector3;
  radius: number;
  damage: number;
  source: string;
  /** Enemy rockets at an ally land on allies. An ally's lands on the enemy. */
  hostile: boolean;
  smokeAt: number;
  flight: number;
  started: number;
}

export class AllyGuns {
  private readonly hits: EnemyInstance[] = [];
  private readonly rockets: Rocket[] = Array.from({ length: MAX_ROCKETS }, () => ({
    live: false, at: 0, from: new THREE.Vector3(), point: new THREE.Vector3(), radius: 0, damage: 0, source: '', hostile: false, smokeAt: 0, flight: 0, started: 0,
  }));
  private readonly damage: DamageInfo = { amount: 0, type: 'bullet', point: new THREE.Vector3(), dir: new THREE.Vector3(), force: 0, source: '' };

  constructor(private readonly ctx: Ctx, private readonly onHostileBlast: (point: THREE.Vector3, radius: number, damage: number, source: string) => void) {}

  private get enemies(): EnemyManager {
    return this.ctx.enemies as unknown as EnemyManager;
  }

  reset(): void {
    for (const r of this.rockets) r.live = false;
  }

  /** True when the player stands in the line from the muzzle to the target and nearer than it. */
  playerInLine(from: THREE.Vector3, to: THREE.Vector3): boolean {
    const p = this.ctx.player.position;
    _dir.subVectors(to, from);
    const len = _dir.length();
    if (len < 0.01) return false;
    _dir.divideScalar(len);
    _to.subVectors(p, from);
    _to.y += 1;
    const t = _to.dot(_dir);
    if (t <= 0 || t >= len) return false;
    _to.addScaledVector(_dir, -t);
    return Math.hypot(_to.x, _to.z) < PLAYER_CLEAR && Math.abs(_to.y) < 1.1;
  }

  /** One trigger pull at `target`, from where his gun is. `miss` multiplies his spread. False if he held it. */
  fire(a: Ally, target: THREE.Vector3, miss: number, now: number): boolean {
    const g = a.def.gun;
    const e = a.body;
    muzzleOf(e, _muzzle);
    if (this.playerInLine(_muzzle, target)) return false;
    const dist = _muzzle.distanceTo(target);
    const close = g.closeBad > 0 && dist < g.closeBad ? 4 : 1;
    const radius = 0.1 + dist * g.spread * miss * close;
    const { audio, fx } = this.ctx;
    if (g.rocket) {
      randomUnit(_rand);
      _aim.copy(target).addScaledVector(_rand, radius);
      _aim.y -= 0.6;
      this.launch(_muzzle, _aim, g, now);
    } else {
      for (let i = 0; i < g.pellets; i++) {
        randomUnit(_rand);
        _aim.copy(target).addScaledVector(_rand, radius * Math.sqrt(Math.random()));
        _dir.subVectors(_aim, _muzzle).normalize();
        if (g.cone > 0) {
          randomUnit(_rand);
          _dir.addScaledVector(_rand, g.cone * Math.random()).normalize();
        }
        this.round(_muzzle, _dir, g, i === 0);
      }
    }
    _dir.subVectors(target, _muzzle).normalize();
    fx.muzzleFlash(_muzzle, _dir, g.muzzle);
    audio.play(g.sound, { position: _muzzle, pitch: g.pitch, pitchJitter: 0.06, volume: 0.85 });
    e.char.anim.play('shoot', g.pellets > 1 || g.rocket ? 0.8 : 1.3);
    return true;
  }

  /** One round down a line. Walls stop it, enemies take it, and nothing else is tested. */
  private round(from: THREE.Vector3, dir: THREE.Vector3, g: AllyGun, tracer: boolean): void {
    const { physics, fx, audio } = this.ctx;
    const wall = physics.raycast(from, dir, g.range * 1.3, CG.World);
    const limit = wall ? wall.distance : g.range * 1.3;
    const hit = this.enemies.raycast(from, dir, limit);
    if (hit && hit.enemy.alive) {
      const d = this.damage;
      d.amount = g.damage;
      d.type = 'bullet';
      d.point.copy(hit.point);
      d.dir.copy(dir);
      d.force = 0;
      d.source = g.source;
      d.region = hit.region;
      d.bone = hit.bone;
      d.blastKind = undefined;
      d.reach = undefined;
      this.enemies.applyDamage(hit.enemy, d);
      if (hit.enemy.machine) fx.sparks(hit.point, dir, 5, 0xffee88);
      else fx.bloodHit(hit.point, dir, 0.8);
      _end.copy(hit.point);
    } else if (wall) {
      fx.impact(wall.point, wall.normal, wall.surface, 0.55);
      if (Math.random() < 0.3) audio.play(SURFACE_SOUND[wall.surface], { position: wall.point, volume: 0.35, pitchJitter: 0.1 });
      this.enemies.vehicles?.shot(wall.collider, wall.point, g.damage, g.source);
      _end.copy(wall.point);
    } else _end.copy(from).addScaledVector(dir, limit);
    if (tracer) fx.tracer(from, _end, g.tracer);
  }

  private take(): Rocket | null {
    for (const r of this.rockets) if (!r.live) return r;
    return null;
  }

  private launch(from: THREE.Vector3, at: THREE.Vector3, g: AllyGun, now: number): void {
    const spec = g.rocket!;
    const { physics } = this.ctx;
    _dir.subVectors(at, from);
    const len = _dir.length();
    _dir.divideScalar(len || 1);
    const wall = physics.raycast(from, _dir, len, CG.World);
    const r = this.take();
    if (!r) return;
    r.live = true;
    r.from.copy(from);
    r.point.copy(wall ? wall.point : at);
    r.flight = r.point.distanceTo(from) / spec.speed;
    r.started = now;
    r.at = now + r.flight;
    r.radius = spec.radius;
    r.damage = spec.damage;
    r.source = g.source;
    r.hostile = false;
    r.smokeAt = now;
  }

  /** An enemy rocket aimed at an ally: the enemy flies the real one, and this lands its blast on allies when it gets there. */
  incoming(point: THREE.Vector3, radius: number, damage: number, delay: number, source: string, now: number): void {
    const r = this.take();
    if (!r) return;
    r.live = true;
    r.hostile = true;
    r.point.copy(point);
    r.at = now + delay;
    r.radius = radius;
    r.damage = damage;
    r.source = source;
    r.flight = 0;
  }

  update(now: number): void {
    const { fx } = this.ctx;
    for (const r of this.rockets) {
      if (!r.live) continue;
      if (!r.hostile && now >= r.smokeAt && now < r.at) {
        r.smokeAt = now + 0.04;
        const t = (now - r.started) / Math.max(r.flight, 1e-3);
        _to.lerpVectors(r.from, r.point, t);
        fx.smoke(_to, 0xb8b8b8, 0.35, 0.7);
      }
      if (now < r.at) continue;
      r.live = false;
      if (r.hostile) this.onHostileBlast(r.point, r.radius, r.damage, r.source);
      else this.burst(r);
    }
  }

  private burst(r: Rocket): void {
    const { ctx } = this;
    const { fx, audio, physics } = ctx;
    fx.explosion(r.point, { radius: r.radius, kind: 'rocket' });
    audio.play('rocket_explosion', { position: r.point, pitchJitter: 0.05 });
    const n = this.enemies.query(r.point, r.radius + 1.5, this.hits);
    for (let i = 0; i < n; i++) {
      const e = this.hits[i]!;
      if (!e.alive) continue;
      _to.copy(e.center);
      const dist = _to.distanceTo(r.point);
      if (dist > r.radius) continue;
      _n.subVectors(_to, r.point);
      if (dist > 0.1) {
        _n.divideScalar(dist);
        if (physics.raycast(r.point, _n, dist, CG.World)) continue;
      } else _n.copy(UP);
      const d = this.damage;
      d.amount = r.damage * (1 - (dist / r.radius) * 0.5);
      d.type = 'explosive';
      d.point.copy(e.center);
      d.dir.copy(_n).add(UP).normalize();
      d.force = BLAST_IMPULSE * r.radius * (1 - dist / r.radius);
      d.source = r.source;
      d.region = undefined;
      d.bone = undefined;
      d.blastKind = 'rocket';
      d.reach = dist / r.radius;
      this.enemies.applyDamage(e, d);
    }
    this.enemies.vehicles?.blast(r.point, { radius: r.radius, damage: r.damage, kind: 'rocket', source: r.source, team: 'player' });
    physics.radialImpulse(r.point, r.radius * 1.35, BLAST_IMPULSE * r.radius);
  }

  /** Seconds a man rests after a burst. A man who is bad up close is slower to fire up close, too. */
  rest(g: AllyGun, dist: number): number {
    return rand(g.rest[0], g.rest[1]) * (g.closeBad > 0 && dist < g.closeBad ? 2 : 1);
  }
}
