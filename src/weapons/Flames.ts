/**
 * Fire as gameplay. Two kinds ride through here.
 *
 * The Burner's fire: invisible bodies in the stream fx.flame draws, each swelling as it travels, so his is a cone.
 *
 * The Kiln's napalm: globs of burning liquid on a ring, oldest out. Each falls under gravity, so the stream is an arc, and
 * the chain of globs in firing order is the hose fx.hose draws, bending as the aim swings. A glob that reaches the world
 * splashes and feeds a burning patch there, on floors and walls alike. Patches are pooled and burn on for seconds,
 * setting alight anyone who stands in them. They never look for the player: his own napalm does not hurt him, as his
 * flames never did.
 */
import * as THREE from 'three';
import { CG, type Ctx, type PlayerSystem } from '../core/contracts';
import type { EnemyInstance, ProjectileSpec, Team } from '../core/gameplay';
import { clamp, lerp, rand } from '../core/math';
import type { Combat } from './Combat';
import { TUNING } from './data';
import { closestOnSegment, closestSegmentPoints } from './geometry';

const MAX_FLAMES = 160;
/** 30 globs a second for `napalm.life` seconds is 66, a lob that long. A flat shot lands in 0.6 s, 18 globs. */
const MAX_GLOBS = 72;
const MAX_HITS = 3;
/** A flame loses this much of its bite each time it licks something. */
const BITE_DECAY = 0.7;
const BODY_RADIUS = 0.35;
const PLAYER_RADIUS = 0.45;
const SCORCH_GAP = 0.12;
const MARKER_GAP = 0.14;
const SPLASH_SOUND_GAP = 0.13;
/** Globs fired further apart than this are two strands, not one hose. */
const STRAND_GAP = 0.09;
/** The hose leaves the nozzle and slides onto the true path, from the eye, over this long. */
const SLIDE = 0.16;
/** Floats a chain point: x y z, age, the glob's serial (the texture rides on it), and 1 where a strand starts. */
export const HOSE_STRIDE = 6;
/** Past this many burning patches each one burns thinner on screen, so a floor of them costs what twelve do. */
const PATCH_BUDGET = 12;

interface Flame {
  live: boolean;
  serial: number;
  team: Team;
  napalm: boolean;
  damage: number;
  source: string;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  /** Napalm only: from the true path to the nozzle at birth, slid away over SLIDE. */
  offset: THREE.Vector3;
  born: number;
  rise: number;
  age: number;
  life: number;
  hits: number[];
  hitCount: number;
}

export interface Patch {
  live: boolean;
  serial: number;
  position: THREE.Vector3;
  normal: THREE.Vector3;
  radius: number;
  /** Seconds since the last glob fed it. */
  age: number;
  source: string;
}

function makeFlame(): Flame {
  return {
    live: false, serial: 0, team: 'player', napalm: false, damage: 0, source: '', position: new THREE.Vector3(),
    velocity: new THREE.Vector3(), offset: new THREE.Vector3(), born: 0, rise: 0, age: 0, life: 0,
    hits: new Array<number>(MAX_HITS).fill(-1), hitCount: 0,
  };
}

export class Flames {
  private readonly pool: Flame[] = [];
  private readonly globs: Flame[] = [];
  readonly patches: Patch[] = [];
  private serial = 0;
  private count = 0;
  private globHead = 0;
  private globCount = 0;
  private patchCount = 0;
  private patchSerial = 0;
  private clock = 0;
  private hoseDrawn = false;
  /** The live muzzle the weapon passes as `visualFrom`. Read every frame, so the hose stays on the nozzle. */
  private nozzle: THREE.Vector3 | null = null;
  private readonly chain = new Float32Array((MAX_GLOBS + 1) * HOSE_STRIDE);
  private readonly nearby: EnemyInstance[] = [];
  private readonly dir = new THREE.Vector3();
  private readonly near = new THREE.Vector3();
  private readonly head = new THREE.Vector3();
  private readonly end = new THREE.Vector3();
  private readonly drawn = new THREE.Vector3();
  private scorchClock = 0;
  private markerClock = 0;
  private splashClock = 0;

  constructor(private readonly ctx: Ctx, private readonly combat: Combat) {
    for (let i = 0; i < MAX_FLAMES; i++) this.pool.push(makeFlame());
    for (let i = 0; i < MAX_GLOBS; i++) this.globs.push(makeFlame());
    for (let i = 0; i < TUNING.napalm.patch.max; i++) {
      this.patches.push({ live: false, serial: 0, position: new THREE.Vector3(), normal: new THREE.Vector3(), radius: 0, age: 0, source: '' });
    }
  }

  init(): void {}

  clear(): void {
    for (const f of this.pool) f.live = false;
    for (const g of this.globs) g.live = false;
    for (const p of this.patches) p.live = false;
    this.count = this.globCount = this.patchCount = 0;
    if (this.hoseDrawn) this.ctx.fx.hose?.(this.chain, 0);
    this.hoseDrawn = false;
  }

  get alive(): number {
    return this.count + this.globCount;
  }

  /** Patches burning now. */
  get burning(): number {
    return this.patchCount;
  }

  spawn(spec: ProjectileSpec): void {
    // Only the Kiln fires player flames, and the Kiln fires napalm.
    if (spec.team === 'player') {
      this.spawnGlob(spec);
      return;
    }
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
    this.fill(f, spec);
    f.life = spec.lifetime ?? TUNING.kiln.life;
    this.count++;
    if (!spec.silent) {
      // Enemy burners spawn flames on a tick rather than every frame, so each one carries a tick's worth of fire.
      const speed = spec.velocity.length();
      if (speed > 1e-3) this.ctx.fx.flame(spec.origin, this.dir.copy(spec.velocity).divideScalar(speed), 3);
    }
  }

  private fill(f: Flame, spec: ProjectileSpec): void {
    f.live = true;
    f.serial = ++this.serial;
    f.team = spec.team;
    f.napalm = false;
    f.damage = spec.damage;
    f.source = spec.source;
    f.position.copy(spec.origin);
    f.velocity.copy(spec.velocity);
    f.offset.set(0, 0, 0);
    f.born = this.clock;
    f.rise = spec.gravity ?? 0;
    f.age = 0;
    f.hitCount = 0;
  }

  private spawnGlob(spec: ProjectileSpec): void {
    const n = TUNING.napalm;
    const g = this.globs[this.globHead]!;
    this.globHead = (this.globHead + 1) % MAX_GLOBS;
    if (!g.live) this.globCount++;
    this.fill(g, spec);
    g.napalm = true;
    g.rise = spec.gravity ?? n.gravity;
    g.life = spec.lifetime ?? n.life;
    // Two slow beats out of step, so the hose sways and never repeats a shape.
    const t = this.clock;
    g.velocity.x += Math.sin(t * 7.3) * n.wobble + rand(-0.12, 0.12);
    g.velocity.y += Math.sin(t * 5.1 + 1.7) * n.wobble * 0.7;
    g.velocity.z += Math.cos(t * 6.1) * n.wobble + rand(-0.12, 0.12);
    this.nozzle = spec.visualFrom ?? null;
    if (spec.visualFrom) g.offset.subVectors(spec.visualFrom, spec.origin);
  }

  update(dt: number): void {
    if (dt <= 0) return;
    this.clock += dt;
    this.scorchClock -= dt;
    this.markerClock -= dt;
    this.splashClock -= dt;
    if (this.count > 0) this.updateFlames(dt);
    if (this.globCount > 0 || this.hoseDrawn) this.updateGlobs(dt);
    if (this.patchCount > 0) this.updatePatches(dt);
  }

  private updateFlames(dt: number): void {
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

  private updateGlobs(dt: number): void {
    const drag = Math.exp(-TUNING.napalm.drag * dt);
    for (let i = 0; i < MAX_GLOBS; i++) {
      const g = this.globs[i]!;
      if (!g.live) continue;
      g.age += dt;
      if (g.age >= g.life) {
        this.kill(g);
        continue;
      }
      g.velocity.multiplyScalar(drag);
      g.velocity.y += g.rise * dt;
      this.move(g, dt);
      if (g.live) this.lickEnemies(g);
    }
    this.drawHose();
  }

  /** Newest first, from the nozzle out. A dead glob or a pause in firing starts a new strand. */
  private drawHose(): void {
    const c = this.chain;
    let n = 0;
    let newer: Flame | null = null;
    for (let k = 1; k <= MAX_GLOBS; k++) {
      const g = this.globs[(this.globHead - k + MAX_GLOBS) % MAX_GLOBS]!;
      if (!g.live) {
        newer = null;
        continue;
      }
      const start = !newer || newer.born - g.born > STRAND_GAP;
      if (k === 1 && this.nozzle && this.clock - g.born < STRAND_GAP) {
        this.write(n++, this.nozzle, 0, g.serial + 1, 1);
        this.write(n++, this.place(g), g.age, g.serial, 0);
      } else {
        this.write(n++, this.place(g), g.age, g.serial, start ? 1 : 0);
      }
      newer = g;
    }
    if (n === 0 && !this.hoseDrawn) return;
    this.ctx.fx.hose?.(c, n);
    this.hoseDrawn = n > 0;
  }

  private place(g: Flame): THREE.Vector3 {
    const slide = Math.max(0, 1 - g.age / SLIDE);
    return this.drawn.copy(g.position).addScaledVector(g.offset, slide * slide);
  }

  private write(i: number, p: THREE.Vector3, age: number, serial: number, start: number): void {
    const c = this.chain;
    const o = i * HOSE_STRIDE;
    if (o + HOSE_STRIDE > c.length) return;
    c[o] = p.x;
    c[o + 1] = p.y;
    c[o + 2] = p.z;
    c[o + 3] = age;
    c[o + 4] = serial % 4096;
    c[o + 5] = start;
  }

  private kill(f: Flame): void {
    f.live = false;
    if (f.napalm) this.globCount--;
    else this.count--;
  }

  private radius(f: Flame): number {
    if (f.napalm) {
      const r = TUNING.napalm.radius;
      return lerp(r[0], r[1], f.age / f.life);
    }
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
    if (f.team === 'player' && f.damage > 0) c.world.objects?.damageExplosive(wall.collider, f.damage, f.source);
    if (f.napalm) {
      // Liquid does not slide off: it splashes and stays, burning.
      this.feed(wall.point, wall.normal, f.source);
      c.fx.napalmSplash?.(wall.point, wall.normal);
      if (this.splashClock <= 0) {
        this.splashClock = SPLASH_SOUND_GAP;
        c.audio.play('flame_splash', { position: wall.point, pitchJitter: 0.12 });
      }
      this.kill(f);
      return;
    }
    f.position.copy(wall.point).addScaledVector(wall.normal, 0.05);
    // Fire does not bounce: it spreads along whatever it hit and dies quicker.
    f.velocity.addScaledVector(wall.normal, -f.velocity.dot(wall.normal)).multiplyScalar(0.45);
    f.age += (f.life - f.age) * 0.3;
    if (this.scorchClock <= 0) {
      this.scorchClock = SCORCH_GAP;
      c.render.decals.add('scorch', wall.point, wall.normal, rand(0.5, 1), rand(0, 6.28));
    }
  }

  /** A glob landing: grows the patch it lands in, or lights a new one, putting out the oldest if the pool is full. */
  feed(point: THREE.Vector3, normal: THREE.Vector3, source: string): Patch {
    const t = TUNING.napalm.patch;
    let best: Patch | null = null;
    let bestD = Infinity;
    let free: Patch | null = null;
    let oldest = this.patches[0]!;
    for (const p of this.patches) {
      if (!p.live) {
        free ??= p;
        continue;
      }
      if (p.serial < oldest.serial) oldest = p;
      if (p.normal.dot(normal) < 0.7) continue;
      const d = p.position.distanceTo(point);
      if (d < bestD && d < t.merge + p.radius * 0.5) {
        best = p;
        bestD = d;
      }
    }
    if (best) {
      best.age = 0;
      best.radius = Math.min(t.maxRadius, best.radius + t.grow);
      return best;
    }
    const p = free ?? oldest;
    if (!free) this.patchCount--;
    p.live = true;
    p.serial = ++this.patchSerial;
    p.position.copy(point);
    p.normal.copy(normal);
    p.radius = t.radius;
    p.age = 0;
    p.source = source;
    this.patchCount++;
    this.ctx.render.decals.add('scorch', point, normal, rand(1.3, 1.8), rand(0, 6.28));
    return p;
  }

  private updatePatches(dt: number): void {
    const t = TUNING.napalm.patch;
    const tick = Math.floor((this.clock - dt) / t.tick) !== Math.floor(this.clock / t.tick);
    const thin = Math.min(1, PATCH_BUDGET / this.patchCount);
    for (const p of this.patches) {
      if (!p.live) continue;
      p.age += dt;
      if (p.age >= t.life) {
        p.live = false;
        this.patchCount--;
        continue;
      }
      const heat = clamp((t.life - p.age) / t.fade);
      this.ctx.fx.napalm?.(p.position, p.normal, p.radius, heat * thin);
      if (tick) this.ignite(p);
    }
  }

  /** As the white phosphorus does: anyone standing in it catches fire, and burns on after he leaves. */
  private ignite(p: Patch): void {
    const n = this.ctx.enemies.query(p.position, p.radius + 2.6, this.nearby) || 0;
    for (let i = 0; i < n; i++) {
      const e = this.nearby[i]!;
      if (!e.alive) continue;
      this.head.copy(e.position);
      this.head.y += e.char.rig.height;
      closestOnSegment(p.position, e.position, this.head, this.near);
      if (this.near.distanceTo(p.position) > p.radius + BODY_RADIUS) continue;
      this.ctx.enemies.afflict(e, 'burn', TUNING.kiln.burnSeconds);
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
      // Napalm sticks: a man the stream hits is coated in it.
      if (!res.blocked) c.enemies.afflict(e, 'burn', f.napalm ? TUNING.napalm.coatSeconds : TUNING.kiln.burnSeconds);
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
    // Co-op host: an enemy's flame burns whichever player it reaches, not only the host's own.
    const everyone = this.ctx.coop?.world?.hostPlayers();
    if (!everyone) {
      this.lick(f, this.ctx.player);
      return;
    }
    for (let i = 0; i < everyone.length && f.live; i++) this.lick(f, everyone[i]!);
  }

  private lick(f: Flame, player: PlayerSystem): void {
    if (!player.alive) return;
    const reach = this.radius(f) + PLAYER_RADIUS;
    const hit = closestSegmentPoints(f.position, this.end.copy(f.position), player.position, player.eye);
    if (hit.dist2 > reach * reach) return;
    player.takeDamage({ amount: f.damage, from: f.position, type: 'fire', source: f.source });
    this.kill(f);
  }
}
