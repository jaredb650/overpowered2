/**
 * Fire as gameplay. The stream a player sees is fx.flame; these are the invisible bodies riding in it
 * that actually touch things. Each one swells as it travels, so the Kiln is a cone rather than a line.
 */
import * as THREE from 'three';
import { CG, type Ctx } from '../core/contracts';
import type { EnemyInstance, ProjectileSpec, Team } from '../core/gameplay';
import { lerp, rand } from '../core/math';
import type { Combat } from './Combat';
import { TUNING } from './data';
import { closestOnSegment, closestSegmentPoints } from './geometry';

const MAX_FLAMES = 160;
const MAX_HITS = 3;
/** A flame loses this much of its bite each time it licks something. */
const BITE_DECAY = 0.7;
const BODY_RADIUS = 0.35;
const PLAYER_RADIUS = 0.45;
const SCORCH_GAP = 0.12;
const MARKER_GAP = 0.14;

interface Flame {
  live: boolean;
  serial: number;
  team: Team;
  damage: number;
  source: string;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  rise: number;
  age: number;
  life: number;
  hits: number[];
  hitCount: number;
}

export class Flames {
  private readonly pool: Flame[] = [];
  private serial = 0;
  private count = 0;
  private readonly nearby: EnemyInstance[] = [];
  private readonly dir = new THREE.Vector3();
  private readonly near = new THREE.Vector3();
  private readonly head = new THREE.Vector3();
  private readonly end = new THREE.Vector3();
  private scorchClock = 0;
  private markerClock = 0;

  constructor(private readonly ctx: Ctx, private readonly combat: Combat) {
    for (let i = 0; i < MAX_FLAMES; i++) {
      this.pool.push({
        live: false, serial: 0, team: 'player', damage: 0, source: '', position: new THREE.Vector3(), velocity: new THREE.Vector3(),
        rise: 0, age: 0, life: 0, hits: new Array<number>(MAX_HITS).fill(-1), hitCount: 0,
      });
    }
  }

  init(): void {}

  clear(): void {
    for (const f of this.pool) f.live = false;
    this.count = 0;
  }

  get alive(): number {
    return this.count;
  }

  spawn(spec: ProjectileSpec): void {
    let f: Flame | undefined;
    let oldest = this.pool[0]!;
    for (let i = 0; i < MAX_FLAMES; i++) {
      const candidate = this.pool[i]!;
      if (!candidate.live) {
        f = candidate;
        break;
      }
      if (candidate.serial < oldest.serial) oldest = candidate;
    }
    if (!f) {
      f = oldest;
      this.count--;
    }
    f.live = true;
    f.serial = ++this.serial;
    f.team = spec.team;
    f.damage = spec.damage;
    f.source = spec.source;
    f.position.copy(spec.origin);
    f.velocity.copy(spec.velocity);
    f.rise = spec.gravity ?? 0;
    f.age = 0;
    f.life = spec.lifetime ?? TUNING.kiln.life;
    f.hitCount = 0;
    this.count++;
    if (!spec.silent) {
      // Enemy burners spawn flames on a tick rather than every frame, so each one carries a tick's worth of fire.
      const speed = spec.velocity.length();
      if (speed > 1e-3) this.ctx.fx.flame(spec.origin, this.dir.copy(spec.velocity).divideScalar(speed), 3);
    }
  }

  update(dt: number): void {
    if (this.count === 0 || dt <= 0) return;
    this.scorchClock -= dt;
    this.markerClock -= dt;
    const drag = Math.exp(-TUNING.kiln.drag * dt);
    for (let i = 0; i < MAX_FLAMES; i++) {
      const f = this.pool[i]!;
      if (!f.live) continue;
      f.age += dt;
      if (f.age >= f.life) {
        this.kill(f);
        continue;
      }
      f.velocity.multiplyScalar(drag);
      f.velocity.y += f.rise * dt;
      this.move(f, dt);
      if (!f.live) continue;
      if (f.team === 'player') this.lickEnemies(f);
      else this.lickPlayer(f);
    }
  }

  private kill(f: Flame): void {
    f.live = false;
    this.count--;
  }

  private radius(f: Flame): number {
    const k = TUNING.kiln;
    return lerp(k.startRadius, k.endRadius, f.age / f.life);
  }

  private move(f: Flame, dt: number): void {
    const c = this.ctx;
    const speed = f.velocity.length();
    if (speed < 1e-3) return;
    const dir = this.dir.copy(f.velocity).divideScalar(speed);
    const len = speed * dt;
    const wall = c.physics.raycast(f.position, dir, len, CG.World);
    if (!wall) {
      f.position.addScaledVector(dir, len);
      return;
    }
    f.position.copy(wall.point).addScaledVector(wall.normal, 0.05);
    // Fire does not bounce: it spreads along whatever it hit and dies quicker.
    f.velocity.addScaledVector(wall.normal, -f.velocity.dot(wall.normal)).multiplyScalar(0.45);
    f.age += (f.life - f.age) * 0.3;
    if (f.team === 'player' && f.damage > 0) c.world.objects?.damageExplosive(wall.collider, f.damage, f.source);
    if (this.scorchClock <= 0) {
      this.scorchClock = SCORCH_GAP;
      c.render.decals.add('scorch', wall.point, wall.normal, rand(0.5, 1), rand(0, 6.28));
    }
  }

  private lickEnemies(f: Flame): void {
    if (f.damage <= 0) return;
    const c = this.ctx;
    const radius = this.radius(f);
    const n = c.enemies.query(f.position, radius + 2.6, this.nearby) || 0;
    for (let i = 0; i < n && f.hitCount < MAX_HITS; i++) {
      const e = this.nearby[i]!;
      if (!e.alive || this.touched(f, e.uid)) continue;
      this.head.copy(e.position);
      this.head.y += e.char.rig.height;
      closestOnSegment(f.position, e.position, this.head, this.near);
      if (this.near.distanceTo(f.position) > radius + BODY_RADIUS) continue;
      f.hits[f.hitCount++] = e.uid;

      const o = this.combat.strikeOptions('fire', f.source);
      o.quiet = true;
      o.force = 1;
      this.dir.subVectors(this.near, f.position);
      if (this.dir.lengthSq() < 1e-6) this.dir.set(0, 1, 0);
      this.dir.normalize();
      const res = this.combat.strike(e, this.near, this.dir, this.dir, undefined, undefined, f.damage, o);
      f.damage *= BITE_DECAY;
      if (!res.blocked) e.burning = Math.max(e.burning, TUNING.kiln.burnSeconds);
      if (this.markerClock <= 0 || res.killed) {
        this.markerClock = MARKER_GAP;
        c.hud.hitMarker(res.killed ? 'kill' : res.blocked ? 'armor' : 'body');
      }
    }
  }

  private touched(f: Flame, uid: number): boolean {
    for (let i = 0; i < f.hitCount; i++) if (f.hits[i] === uid) return true;
    return false;
  }

  private lickPlayer(f: Flame): void {
    if (f.damage <= 0) return;
    const player = this.ctx.player;
    if (!player.alive) return;
    const reach = this.radius(f) + PLAYER_RADIUS;
    const hit = closestSegmentPoints(f.position, this.end.copy(f.position), player.position, player.eye);
    if (hit.dist2 > reach * reach) return;
    player.takeDamage({ amount: f.damage, from: f.position, type: 'fire', source: f.source });
    this.kill(f);
  }
}
