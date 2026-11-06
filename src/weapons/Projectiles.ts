/**
 * Everything with travel time. Each projectile sweeps a ray along its whole step, so nothing tunnels
 * at any frame rate, and all of them share one fixed pool with oldest-out eviction.
 */
import * as THREE from 'three';
import { CG, type Ctx, type CorpseHit, type ExplosionKind, type RayHit } from '../core/contracts';
import type { DamageResult, EnemyInstance, ProjectileSpec, ProjectileTrail, Team } from '../core/gameplay';
import { clamp, rand } from '../core/math';
import type { GoreRegion } from '../characters/rig';
import type { Combat } from './Combat';
import { SURFACE_SOUND, TUNING } from './data';
import { closestSegmentPoints } from './geometry';
import { ProjectileVisuals } from './ProjectileVisuals';

const MAX_PROJECTILES = 256;
const PLAYER_RADIUS = 0.45;
const WHIZZ_RADIUS = 3;
const GRENADE_RADIUS = 0.11;
/** A shot passing this close to a live grenade or rocket hits it. Generous, because it is a trick shot. */
const SHOOTABLE_RADIUS = 0.42;
/** Rockets go off this close to a body, so a skimming hit still reads as a hit. */
const PROXIMITY = 0.75;
/** Rings and puffs hold this spacing during a hit-stop, when the clock runs but the shell barely moves. */
const MIN_TRAIL_SPACING = 0.5;
const MAX_PENDING_PINS = 8;

/** A pin waiting for the frame after the stake struck. CorpseHits are ring-allocated, so this keeps its own copy. */
interface PendingPin {
  hit: CorpseHit;
  anchor: THREE.Vector3;
}

export type ProjectileKind = Exclude<ProjectileSpec['kind'], 'flame'>;

export interface Projectile {
  live: boolean;
  serial: number;
  kind: ProjectileKind;
  team: Team;
  damage: number;
  source: string;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  gravity: number;
  life: number;
  fuse: number;
  homing: number;
  trail: ProjectileTrail;
  ringClock: number;
  smokeClock: number;
  lastTrail: THREE.Vector3;
  /** Where the mesh is drawn relative to the true path. Shrinks to zero so shots leave the muzzle but fly true. */
  visualOffset: THREE.Vector3;
  visualHold: number;
  whizzed: boolean;
  resting: boolean;
  spin: number;
  gib: boolean;
  severMult: number;
  force: number;
  headshotMult: number;
  killStop: number;
  explosive: boolean;
  blastRadius: number;
  blastDamage: number;
  blastKind: ExplosionKind;
  blastInstakill: boolean;
  blastSelf: number | undefined;
  blastPush: number | undefined;
  /** Stake only: it has already nailed something, so it just carries on to the wall. */
  pinned: boolean;
  /** Direct damage already spent on this enemy, so a stake does not hit one body twice. */
  lastHit: number;
}

function createProjectile(): Projectile {
  return {
    live: false, serial: 0, kind: 'bullet', team: 'player', damage: 0, source: '',
    position: new THREE.Vector3(), velocity: new THREE.Vector3(), gravity: 0, life: 0, fuse: 0, homing: 0,
    trail: 'none', ringClock: 0, smokeClock: 0, lastTrail: new THREE.Vector3(),
    visualOffset: new THREE.Vector3(), visualHold: 0, whizzed: false, resting: false, spin: 0,
    gib: false, severMult: 1, force: 0, headshotMult: 2, killStop: 0,
    explosive: false, blastRadius: 0, blastDamage: 0, blastKind: 'rocket', blastInstakill: false,
    blastSelf: undefined, blastPush: undefined, pinned: false, lastHit: -1,
  };
}

const DEFAULT_TRAIL: Record<ProjectileKind, ProjectileTrail> = {
  rocket: 'smoke', shell: 'rings', grenade: 'none', bullet: 'none', plasma: 'sparks', stake: 'none',
};

const DEFAULT_LIFE: Record<ProjectileKind, number> = {
  rocket: 6, shell: 5, grenade: 8, bullet: 5, plasma: 5, stake: 3,
};

export class Projectiles {
  private readonly free: Projectile[] = [];
  private readonly live: Projectile[] = [];
  private serial = 0;
  readonly visuals: ProjectileVisuals;

  private readonly dir = new THREE.Vector3();
  private readonly end = new THREE.Vector3();
  private readonly v = new THREE.Vector3();
  private readonly w = new THREE.Vector3();
  private readonly nearby: EnemyInstance[] = [];
  private readonly pendingPins: PendingPin[] = [];
  private pendingCount = 0;
  private readonly shotResult = { projectile: null as unknown as Projectile, at: 0 };
  private readonly blastSpec = {
    radius: 0, damage: 0, kind: 'rocket' as ExplosionKind, source: '', team: 'player' as Team,
    instakill: undefined as boolean | undefined, selfDamage: undefined as number | undefined,
    playerPush: undefined as number | undefined, normal: undefined as THREE.Vector3 | undefined,
  };

  constructor(private readonly ctx: Ctx, private readonly combat: Combat) {
    this.visuals = new ProjectileVisuals(ctx);
    for (let i = 0; i < MAX_PROJECTILES; i++) {
      this.free.push(createProjectile());
    }
    for (let i = 0; i < MAX_PENDING_PINS; i++) {
      this.pendingPins.push({
        hit: { distance: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(), handle: null, bone: 0, region: 'chest' },
        anchor: new THREE.Vector3(),
      });
    }
  }

  init(): void {
    this.visuals.init();
  }

  clear(): void {
    for (let i = this.live.length - 1; i >= 0; i--) this.retire(i);
    this.pendingCount = 0;
    this.visuals.clear();
  }

  get count(): number {
    return this.live.length;
  }

  /** Live projectiles, for tests. */
  get active(): readonly Projectile[] {
    return this.live;
  }

  spawn(spec: ProjectileSpec): void {
    const kind = spec.kind as ProjectileKind;
    let p = this.free.pop();
    if (!p) {
      // Oldest-out: at the cap a new shot beats an old one that has probably left the fight.
      let oldest = 0;
      for (let i = 1; i < this.live.length; i++) if (this.live[i]!.serial < this.live[oldest]!.serial) oldest = i;
      this.retire(oldest);
      p = this.free.pop()!;
    }
    p.live = true;
    p.serial = ++this.serial;
    p.kind = kind;
    p.team = spec.team;
    p.damage = spec.damage;
    p.source = spec.source;
    p.position.copy(spec.origin);
    p.velocity.copy(spec.velocity);
    p.gravity = spec.gravity === undefined ? 0 : Math.abs(spec.gravity);
    p.life = spec.lifetime ?? DEFAULT_LIFE[kind];
    p.fuse = spec.fuse ?? 0;
    p.homing = spec.homing ?? 0;
    p.trail = spec.trail ?? DEFAULT_TRAIL[kind];
    p.ringClock = p.smokeClock = 0;
    p.lastTrail.copy(spec.origin);
    p.whizzed = p.resting = false;
    p.spin = rand(0, 6.28);
    p.gib = spec.gib ?? false;
    p.severMult = spec.severMult ?? 1;
    p.force = spec.force ?? 0;
    p.headshotMult = spec.headshotMult ?? 2;
    p.killStop = spec.killStop ?? 0;
    p.pinned = false;
    p.lastHit = -1;
    p.visualHold = 0;
    p.visualOffset.set(0, 0, 0);
    if (spec.visualFrom) {
      p.visualOffset.subVectors(spec.visualFrom, spec.origin);
      p.visualHold = 0.12;
    }
    const blast = spec.explosion;
    p.explosive = !!blast;
    if (blast) {
      p.blastRadius = blast.radius;
      p.blastDamage = blast.damage;
      p.blastKind = blast.kind;
      p.blastInstakill = blast.instakill ?? false;
      p.blastSelf = blast.selfDamage;
      p.blastPush = blast.playerPush;
    }
    this.visuals.tint(p, spec.tracer);
    this.live.push(p);
  }

  private retire(index: number): void {
    const p = this.live[index]!;
    p.live = false;
    const last = this.live.pop()!;
    if (index < this.live.length) this.live[index] = last;
    this.free.push(p);
  }

  update(dt: number): void {
    this.drainPins();
    const realDt = this.ctx.time.realDt;
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i]!;
      p.life -= dt;
      if (p.kind === 'grenade') this.stepGrenade(p, dt);
      else this.step(p, dt);
      if (p.live && p.life <= 0) this.expire(p);
      if (!p.live) {
        // A hit can retire others through a chain detonation, so find this one again by value.
        const at = this.live.indexOf(p);
        if (at >= 0) this.retire(at);
        i = Math.min(i, this.live.length);
        continue;
      }
      this.emitTrail(p, realDt);
    }
    this.visuals.draw(this.live, dt);
  }

  private expire(p: Projectile): void {
    if (p.explosive) this.explode(p, undefined);
    p.live = false;
  }

  private step(p: Projectile, dt: number): void {
    const c = this.ctx;
    if (p.homing > 0) this.steer(p, dt);
    if (p.gravity > 0) p.velocity.y -= p.gravity * dt;

    const speed = p.velocity.length();
    if (speed < 1e-3) return;
    const dir = this.dir.copy(p.velocity).divideScalar(speed);
    const len = speed * dt;
    if (len <= 0) return;

    const wall = c.physics.raycast(p.position, dir, len, CG.World);
    const limit = wall ? wall.distance : len;

    if (p.team === 'player') {
      // A stake that punched through stops short for this frame, so the next enemy on the line still gets swept.
      if (this.sweepEnemies(p, dir, limit)) return;
      if (p.kind === 'stake') this.sweepCorpses(p, dir, limit);
    } else if (this.sweepPlayer(p, dir, limit)) {
      return;
    }

    if (wall) {
      this.hitWorld(p, wall);
      return;
    }
    p.position.addScaledVector(dir, len);
  }

  /** Enemy team homes on the player, player team on the closest enemy. */
  private steer(p: Projectile, dt: number): void {
    const c = this.ctx;
    const to = this.w;
    if (p.team === 'enemy') {
      to.copy(c.player.eye);
    } else {
      const n = c.enemies.query(p.position, 40, this.nearby) || 0;
      if (n === 0) return;
      let best = Infinity;
      for (let i = 0; i < n; i++) {
        const e = this.nearby[i]!;
        const d = e.center.distanceToSquared(p.position);
        if (e.alive && d < best) {
          best = d;
          to.copy(e.center);
        }
      }
      if (best === Infinity) return;
    }
    const speed = p.velocity.length();
    to.sub(p.position).normalize().multiplyScalar(speed);
    p.velocity.lerp(to, 1 - Math.exp(-p.homing * dt));
    p.velocity.setLength(speed);
  }

  private sweepEnemies(p: Projectile, dir: THREE.Vector3, limit: number): boolean {
    const c = this.ctx;
    const hit = c.enemies.raycast(p.position, dir, limit);
    if (hit && hit.enemy.uid !== p.lastHit) {
      p.position.copy(hit.point);
      this.hitEnemy(p, hit.enemy, hit.point, hit.normal, dir, hit.bone, hit.region);
      return true;
    }
    if (p.kind !== 'rocket') return false;
    const end = this.end.copy(p.position).addScaledVector(dir, limit);
    const n = c.enemies.query(end, PROXIMITY + 1, this.nearby) || 0;
    for (let i = 0; i < n; i++) {
      const e = this.nearby[i]!;
      if (e.alive && e.center.distanceTo(end) < PROXIMITY + 0.5) {
        p.position.copy(end);
        this.explode(p, undefined);
        p.live = false;
        return true;
      }
    }
    return false;
  }

  private hitEnemy(
    p: Projectile, enemy: EnemyInstance, point: THREE.Vector3, normal: THREE.Vector3, dir: THREE.Vector3,
    bone: number | undefined, region: GoreRegion | undefined,
  ): void {
    const combat = this.combat;
    // Only rockets are area damage on contact. A shell or stake to the head has to read as a headshot.
    const o = combat.strikeOptions(p.kind === 'rocket' ? 'explosive' : 'bullet', p.source);
    o.force = p.force;
    o.severMult = p.severMult;
    o.headshotMult = p.headshotMult;
    o.gib = p.gib;
    o.killStop = p.killStop;
    const res = combat.strike(enemy, point, normal, dir, bone, region, p.damage, o);

    if (p.kind === 'stake') {
      if (p.explosive) this.explode(p, undefined);
      this.stakeThrough(p, enemy, res, point, dir);
      p.lastHit = enemy.uid;
      return;
    }
    if (p.explosive) this.explode(p, undefined);
    p.live = false;
  }

  /**
   * A stake that kills or cuts keeps flying, and whatever it cut loose is nailed to the wall ahead.
   * gore.pin drags the bone there itself, so the body arrives with the stake.
   */
  private stakeThrough(p: Projectile, enemy: EnemyInstance, res: DamageResult, point: THREE.Vector3, dir: THREE.Vector3): void {
    if (res.killed || res.severed.length > 0) {
      const back = this.w.copy(point).addScaledVector(dir, -1.2);
      // A burst skull leaves nothing on the stake's line, so a head kill takes the body by the hips. Aimed at the bone
      // itself, because gore tests last frame's pose and enemy.center has already moved on.
      const line = res.headshot ? this.v.setFromMatrixPosition(enemy.char.bones[0]!.matrixWorld).sub(back).normalize() : dir;
      const corpse = this.ctx.gore.raycastCorpses(back, line, 2.6);
      if (corpse) {
        this.nail(p, corpse, point, dir, res.killed && res.headshot);
        return;
      }
    }
    // Nothing came loose, so a live body stops the stake.
    if (!res.killed) p.live = false;
  }

  private sweepCorpses(p: Projectile, dir: THREE.Vector3, limit: number): void {
    if (p.pinned) return;
    const hit = this.ctx.gore.raycastCorpses(p.position, dir, limit);
    if (hit) this.nail(p, hit, hit.point, dir, false);
  }

  /**
   * gore.pin needs a ragdoll, and a body killed through the head stands in a scripted hold without one. So the hold is
   * ended here and the pin itself goes in next frame, by when gore has the ragdoll. Everything takes that one-frame
   * path, which also keeps a freshly made corpse from being pinned before its first physics step.
   */
  private nail(p: Projectile, corpse: CorpseHit, from: THREE.Vector3, dir: THREE.Vector3, standing: boolean): void {
    const c = this.ctx;
    const wall = c.physics.raycast(from, dir, TUNING.stake.pinReach, CG.World);
    c.audio.play('stake_hit_flesh', { position: from });
    // Set either way: with no wall in reach the stake flies on, and it must not re-nail the same body next frame.
    p.pinned = true;
    if (!wall) return;
    if (standing) this.combat.wakeCorpse(corpse, dir);
    if (this.pendingCount >= MAX_PENDING_PINS) return;
    const pin = this.pendingPins[this.pendingCount++]!;
    pin.hit.distance = corpse.distance;
    pin.hit.point.copy(corpse.point);
    pin.hit.normal.copy(corpse.normal);
    pin.hit.handle = corpse.handle;
    pin.hit.bone = corpse.bone;
    pin.hit.region = corpse.region;
    pin.anchor.copy(wall.point);
  }

  private drainPins(): void {
    for (let i = 0; i < this.pendingCount; i++) {
      const pin = this.pendingPins[i]!;
      this.ctx.gore.pin(pin.hit, pin.anchor);
      pin.hit.handle = null;
    }
    this.pendingCount = 0;
  }

  private sweepPlayer(p: Projectile, dir: THREE.Vector3, limit: number): boolean {
    const c = this.ctx;
    const player = c.player;
    if (!player.alive) return false;
    const end = this.end.copy(p.position).addScaledVector(dir, limit);
    const hit = closestSegmentPoints(p.position, end, player.position, player.eye);
    if (hit.dist2 < PLAYER_RADIUS * PLAYER_RADIUS) {
      p.position.lerp(end, hit.s);
      const guard = this.combat.guard(dir);
      if (guard !== 'none') {
        this.combat.deflected(p.position, dir, p.damage, guard);
        p.live = false;
        return true;
      }
      if (p.explosive) {
        this.explode(p, undefined);
      } else {
        player.takeDamage({ amount: p.damage, from: this.w.copy(p.position).addScaledVector(dir, -2), type: 'bullet', source: p.source });
      }
      p.live = false;
      return true;
    }
    if (!p.whizzed && hit.dist2 < WHIZZ_RADIUS * WHIZZ_RADIUS) {
      p.whizzed = true;
      c.audio.play('bullet_whizz', { position: this.w.copy(p.position).lerp(end, hit.s), volume: 0.8, pitchJitter: 0.1 });
    }
    return false;
  }

  private hitWorld(p: Projectile, wall: RayHit): void {
    const c = this.ctx;
    p.position.copy(wall.point);
    switch (p.kind) {
      case 'stake':
        this.stakeLands(p, wall);
        break;
      case 'bullet':
        c.fx.impact(wall.point, wall.normal, wall.surface, 0.7);
        c.audio.play(SURFACE_SOUND[wall.surface], { position: wall.point, volume: 0.7, pitchJitter: 0.08 });
        c.world.objects?.damageExplosive(wall.collider, p.damage, p.source);
        break;
      default:
        if (p.explosive) this.explode(p, wall.normal);
    }
    p.live = false;
  }

  private stakeLands(p: Projectile, wall: RayHit): void {
    const c = this.ctx;
    this.visuals.stick(wall.point, this.dir, TUNING.stake.stuckSeconds);
    c.fx.impact(wall.point, wall.normal, wall.surface, 1.2);
    c.render.decals.add('crack', wall.point, wall.normal, 0.5, rand(0, 6.28));
    c.audio.play('stake_hit_wall', { position: wall.point });
    c.world.objects?.damageExplosive(wall.collider, p.damage, p.source);
    if (p.explosive) this.explode(p, wall.normal);
    if (p.pinned) {
      c.audio.play('stake_twang', { position: wall.point });
      this.combat.feel.stop(0.03);
    }
  }

  private stepGrenade(p: Projectile, dt: number): void {
    const c = this.ctx;
    p.fuse -= dt;
    if (p.fuse <= 0) {
      this.explode(p, undefined);
      p.live = false;
      return;
    }
    if (p.resting) return;

    p.velocity.y -= p.gravity * dt;
    let left = dt;
    for (let bounce = 0; bounce < 4 && left > 0; bounce++) {
      const speed = p.velocity.length();
      if (speed < 1e-3) break;
      const dir = this.dir.copy(p.velocity).divideScalar(speed);
      const len = speed * left;
      const reach = len + GRENADE_RADIUS;
      if (p.team === 'player') {
        const hit = c.enemies.raycast(p.position, dir, len);
        if (hit) {
          // A frag to the face goes off there and then: bouncing off a target feels like a bug.
          p.position.copy(hit.point);
          this.explode(p, undefined);
          p.live = false;
          return;
        }
      }
      const wall = c.physics.raycast(p.position, dir, reach, CG.World);
      if (!wall) {
        p.position.addScaledVector(dir, len);
        break;
      }
      const travel = Math.max(0, wall.distance - GRENADE_RADIUS);
      p.position.addScaledVector(dir, travel);
      left -= travel / speed;

      const n = wall.normal;
      const into = p.velocity.dot(n);
      if (into >= 0) break;
      p.velocity.addScaledVector(n, -into);
      p.velocity.multiplyScalar(TUNING.grenade.friction);
      p.velocity.addScaledVector(n, -into * TUNING.grenade.restitution);
      if (-into > 1.5) c.audio.play('grenade_bounce', { position: p.position, volume: clamp(-into / 12), pitchJitter: 0.08 });
      if (p.velocity.lengthSq() < 0.6 && n.y > 0.5) {
        p.velocity.set(0, 0, 0);
        p.resting = true;
        break;
      }
    }
  }

  explode(p: Projectile, normal: THREE.Vector3 | undefined): void {
    const b = this.blastSpec;
    b.radius = p.blastRadius;
    b.damage = p.blastDamage;
    b.kind = p.blastKind;
    b.source = p.source;
    b.team = p.team;
    b.instakill = p.blastInstakill;
    b.selfDamage = p.blastSelf;
    b.playerPush = p.blastPush;
    b.normal = normal;
    // Lift the centre off the surface, or every line-of-sight ray starts inside the wall it hit.
    const at = this.v.copy(p.position);
    if (normal) at.addScaledVector(normal, 0.15);
    this.combat.explode(at, b);
  }

  private emitTrail(p: Projectile, realDt: number): void {
    if (p.trail === 'none') return;
    const fx = this.ctx.fx;
    p.ringClock += realDt;
    p.smokeClock += realDt;
    // Real time on purpose: at SLOWMO the shell crawls while rings keep coming, which coils the trail.
    const moved = p.position.distanceToSquared(p.lastTrail) > MIN_TRAIL_SPACING * MIN_TRAIL_SPACING;
    const at = this.v;
    switch (p.trail) {
      case 'smoke':
        if (p.smokeClock >= 0.06 && moved) {
          p.smokeClock = 0;
          p.lastTrail.copy(p.position);
          fx.smoke(this.behind(p, 0.3, at), 0xcccccc, 0.35, 1);
        }
        break;
      case 'big':
        if (p.smokeClock >= 0.06 && moved) {
          p.smokeClock = 0;
          p.lastTrail.copy(p.position);
          fx.smoke(this.behind(p, 0.3, at), 0xcccccc, 1, 1.8);
        }
        break;
      case 'hellfire':
        if (p.smokeClock >= 0.06 && moved) {
          p.smokeClock = 0;
          p.lastTrail.copy(p.position);
          fx.smoke(this.behind(p, 0.3, at), 0xff6600, 0.4, 1.2);
          if (Math.random() < 0.5) fx.smoke(at, 0xffaa00, 0.3, 0.8);
        }
        break;
      case 'rings':
        if (p.ringClock >= 0.06 && moved) {
          p.ringClock = 0;
          p.lastTrail.copy(p.position);
          fx.ring(this.behind(p, 0.2, at), p.velocity, 0xffff00, 0.1);
        }
        if (p.smokeClock >= 0.03) {
          p.smokeClock = 0;
          fx.smoke(this.behind(p, 0.3, at), 0xaaaaaa, 0.1, 2);
        }
        break;
      case 'sparks':
        if (p.smokeClock >= 0.03 && moved) {
          p.smokeClock = 0;
          p.lastTrail.copy(p.position);
          fx.sparks(this.behind(p, 0.2, at), p.velocity, 1, 0x66ccff);
        }
        break;
    }
  }

  private behind(p: Projectile, by: number, out: THREE.Vector3): THREE.Vector3 {
    const speed = p.velocity.length();
    return out.copy(p.position).addScaledVector(p.velocity, speed > 1e-3 ? -by / speed : 0);
  }

  /** The nearest grenade or rocket on a ray, for shooting them out of the air. */
  shootable(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): { projectile: Projectile; at: number } | null {
    let best: Projectile | null = null;
    let bestT = maxDist;
    const r2 = SHOOTABLE_RADIUS * SHOOTABLE_RADIUS;
    for (let i = 0; i < this.live.length; i++) {
      const p = this.live[i]!;
      if (p.kind !== 'grenade' && !(p.kind === 'rocket' && p.team === 'enemy')) continue;
      const to = this.w.subVectors(p.position, origin);
      const t = to.dot(dir);
      if (t < 0 || t > bestT) continue;
      const d2 = to.lengthSq() - t * t;
      if (d2 < r2) {
        best = p;
        bestT = t;
      }
    }
    if (!best) return null;
    this.shotResult.projectile = best;
    this.shotResult.at = bestT;
    return this.shotResult;
  }

  /** Blows a shootable up where it is. */
  detonate(p: Projectile): void {
    if (!p.live) return;
    p.team = 'player';
    this.explode(p, undefined);
    p.live = false;
    const at = this.live.indexOf(p);
    if (at >= 0) this.retire(at);
  }

  /** Grenades in a blast cook off a moment later. */
  caughtInBlast(center: THREE.Vector3, radius: number): void {
    const r2 = radius * radius;
    for (let i = 0; i < this.live.length; i++) {
      const p = this.live[i]!;
      if (p.kind === 'grenade' && p.fuse > 0.08 && p.position.distanceToSquared(center) < r2) p.fuse = 0.08;
    }
  }
}
