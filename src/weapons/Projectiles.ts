/**
 * Everything with travel time. Each projectile sweeps a ray along its whole step, so nothing tunnels
 * at any frame rate, and all of them share one fixed pool with oldest-out eviction.
 */
import * as THREE from 'three';
import { CG, type Ctx, type CorpseHit, type ExplosionKind, type RayHit } from '../core/contracts';
import { toldKill, type DamageResult, type EnemyInstance, type MissileTarget, type ProjectileSpec, type ProjectileTrail, type Team } from '../core/gameplay';
import { clamp, rand } from '../core/math';
import type { GoreRegion } from '../characters/rig';
import type { Combat } from './Combat';
import { SHAPED_CHARGE, SURFACE_SOUND, TUNING } from './data';
import { closestSegmentPoints } from './geometry';
import { damageKept, loadBudget, makeBudget, passBody, passWall, type Budget } from './penetration';
import { retarget, turnToward, weave } from './swarm';
import { helixOffset, type HelixSpec } from './helix';
import { ROCKET_LASER } from './laser';
import { ProjectileVisuals } from './ProjectileVisuals';
import { flakBurst, flakFuze, nearestAhead } from './flak';
import { WpCloud } from './wp';
import { checkClusterStandoff, detonateCluster } from './cluster';
import { isGuest } from '../core/coop';

const MAX_PROJECTILES = 256;
const UP = new THREE.Vector3(0, 1, 0);
const HELIX_SMOKE_STEP = 0.4;
const PLAYER_RADIUS = 0.45;
const WHIZZ_RADIUS = 3;
const GRENADE_RADIUS = 0.11;
/** A shot passing this close to a live grenade or rocket hits it. Generous, because it is a trick shot. */
const SHOOTABLE_RADIUS = 0.42;
/** Rockets go off this close to a body, so a skimming hit still reads as a hit. */
const PROXIMITY = 0.75;
/** Metres past this frame's move a rocket looks for a body it is on course to hit. Past anything the fuse can reach from. */
const ON_COURSE = PROXIMITY + 1;
/** Rings and puffs hold this spacing during a hit-stop, when the clock runs but the shell barely moves. */
const MIN_TRAIL_SPACING = 0.5;
/** Co-op guest: seconds after a stake stops in a body the host's word of the kill may still nail it up. */
const LATE_PIN = 1.5;
const MAX_PENDING_PINS = 8;
/** Metres an exploding bolt's centre stands back out of what it stuck in: its nose in, the shaft and its light out. */
const BOLT_SINK = 0.28;
/** Bodies one penetrating round can meet in a single step. */
const MAX_SWEEP = 12;
/** The `plasma` trail: metres of path between its sparks and between its rings, and seconds of flight before either. */
const PLASMA_WAKE = 1.4;
const PLASMA_RING = 4.2;
const PLASMA_WAKE_AFTER = 0.05;

interface SweptHit {
  enemy: EnemyInstance;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  bone: number;
  region: GoreRegion;
}

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
  bossDamage: number | undefined;
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
  /**
   * An exploding bolt (a stake with a `fuse`) that has stuck: `resting`, and goes with this bone when it stuck in a body,
   * at `stuckLocal` along `stuckAxis` in its space. `stuckNormal` is the face of a wall it is in, zero in a body.
   */
  stuckBone: THREE.Object3D | null;
  /** Enemy a sticky bomb is attached to (tracks position while alive; safely detaches when dead/despawned). */
  stuckEnemy: EnemyInstance | null;
  stuckOffset: THREE.Vector3;
  stuckLocal: THREE.Vector3;
  stuckAxis: THREE.Vector3;
  stuckNormal: THREE.Vector3;
  /** Milkor MGL sticky bomb: adheres to world geometry or enemies and awaits remote/swap detonation. */
  sticky: boolean;
  /** Beeps it has given, and seconds left of the light that blinks with each. */
  beeps: number;
  blink: number;
  /** Direct damage already spent on this enemy, so a stake does not hit one body twice. */
  lastHit: number;
  /** Penetration it has left. `full` 0 on everything that stops where it lands. */
  budget: Budget;
  /** Damage it left the barrel with: what it deals now is this times what its budget keeps. */
  baseDamage: number;
  armorPiercing: boolean;
  /** A guided missile's mark. Null on everything else, and on a missile flying dumb. */
  target: MissileTarget | null;
  /** Radians a second; above 0 makes it a guided missile. */
  turnRate: number;
  /** The line a guided missile with no mark flies and weaves about: its launch heading, or its heading when its mark died. */
  line: THREE.Vector3;
  steerDelay: number;
  weave: number;
  weavePhase: number;
  helix: HelixSpec | null;
  helixData: HelixSpec;
  helixTravel: number;
  helixRight: THREE.Vector3;
  helixUp: THREE.Vector3;
  helixOffset: THREE.Vector3;
  accel: number;
  topSpeed: number;
  /** Seconds since launch. */
  age: number;
  /** Drawn size. */
  size: number;
  /** Steers for ROCKET_LASER while it is on. */
  wired: boolean;
  blastScale: number | undefined;
  blastShake: number | undefined;
  /** Co-op: a call-in copy's round (ProjectileSpec.ghost), and whether this round's blast is drawn by the other screens' copies. */
  ghost: boolean;
  blastMirrored: boolean;
  /** An autocannon flak shell: a proximity fuze, and its blast is the flak's air burst and cone (flak.ts). */
  flak: boolean;
  /** White phosphorus rocket warhead: spawns a 6 m burning cloud for 12 s on detonation (wp.ts). */
  wp: boolean;
  /** Howitzer cluster shell: bursts ~7 m short of targets/walls into an 18-bomblet carpet (cluster.ts). */
  cluster: boolean;
  /**
   * Co-op: a copy of a projectile another browser owns: an enemy's on a guest, or a friend's round (ProjectileSpec.cosmetic).
   * It flies, trails, sticks, beeps and bursts here as the real one does there, stepped under `Combat.watching`, and hurts
   * and blows up nothing. The real one's blast comes from its owner (`boom`).
   */
  cosmetic: boolean;
  /** Co-op: the host's number for this enemy projectile (0: none), so its end can be told to the other screens. */
  netId: number;
  /** The laser a wired rocket steers for: the player's own (ROCKET_LASER), or the friend's whose rocket it is. */
  laser: { on: boolean; at: THREE.Vector3 };
  /** Co-op: the number a player's own round goes by between screens (ProjectileSpec.tag), 0 for none. */
  tag: number;
}

function createProjectile(): Projectile {
  return {
    live: false, serial: 0, kind: 'bullet', team: 'player', damage: 0, bossDamage: undefined, source: '',
    position: new THREE.Vector3(), velocity: new THREE.Vector3(), gravity: 0, life: 0, fuse: 0, homing: 0,
    trail: 'none', ringClock: 0, smokeClock: 0, lastTrail: new THREE.Vector3(),
    visualOffset: new THREE.Vector3(), visualHold: 0, whizzed: false, resting: false, spin: 0,
    gib: false, severMult: 1, force: 0, headshotMult: 2, killStop: 0,
    stuckBone: null, stuckEnemy: null, stuckOffset: new THREE.Vector3(), stuckLocal: new THREE.Vector3(), stuckAxis: new THREE.Vector3(), stuckNormal: new THREE.Vector3(), sticky: false, beeps: 0, blink: 0,
    explosive: false, blastRadius: 0, blastDamage: 0, blastKind: 'rocket', blastInstakill: false,
    blastSelf: undefined, blastPush: undefined, pinned: false, lastHit: -1,
    budget: makeBudget(), baseDamage: 0, armorPiercing: false,
    target: null, turnRate: 0, line: new THREE.Vector3(), steerDelay: 0, weave: 0, weavePhase: 0, accel: 0, topSpeed: 0, age: 0, size: 1, wired: false,
    blastScale: undefined, blastShake: undefined, flak: false, wp: false, cluster: false, cosmetic: false, netId: 0, laser: ROCKET_LASER, tag: 0, ghost: false, blastMirrored: false,
    helix: null, helixData: { phase: 0, reach: 0, radius: 0, pitch: 0, startRadius: 0, convergence: 0 }, helixTravel: 0, helixRight: new THREE.Vector3(), helixUp: new THREE.Vector3(), helixOffset: new THREE.Vector3(),
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
  private readonly exit = new THREE.Vector3();
  private readonly exitNormal = new THREE.Vector3();
  private readonly inverse = new THREE.Matrix4();
  private readonly nearby: EnemyInstance[] = [];
  /** A missile's retarget candidates: the enemies near it, then every live vehicle and aircraft. */
  private readonly candidates: MissileTarget[] = [];
  private readonly hulls: MissileTarget[] = [];
  private readonly want = new THREE.Vector3();
  private readonly swept: SweptHit[] = [];
  private readonly pendingPins: PendingPin[] = [];
  private pendingCount = 0;
  private readonly shotResult = { projectile: null as unknown as Projectile, at: 0 };
  private readonly ahead: [number, number] = [Infinity, 0];
  private readonly blastSpec = {
    radius: 0, damage: 0, kind: 'rocket' as ExplosionKind, source: '', team: 'player' as Team,
    instakill: undefined as boolean | undefined, selfDamage: undefined as number | undefined,
    playerPush: undefined as number | undefined, normal: undefined as THREE.Vector3 | undefined,
    scale: undefined as number | undefined, shake: undefined as number | undefined,
    cosmetic: undefined as boolean | undefined, mirrored: undefined as boolean | undefined,
  };

  readonly wp: WpCloud;

  constructor(private readonly ctx: Ctx, private readonly combat: Combat) {
    this.visuals = new ProjectileVisuals(ctx);
    this.wp = new WpCloud(ctx);
    for (let i = 0; i < MAX_PROJECTILES; i++) {
      this.free.push(createProjectile());
    }
    for (let i = 0; i < MAX_SWEEP; i++) {
      this.swept.push({ enemy: null as unknown as EnemyInstance, point: new THREE.Vector3(), normal: new THREE.Vector3(), bone: 0, region: 'chest' });
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
    this.wp.reset();
    this.visuals.clear();
  }

  get count(): number {
    return this.live.length;
  }

  /** Live projectiles, for tests. */
  get active(): readonly Projectile[] {
    return this.live;
  }

  /** `netId` is co-op's number for an enemy projectile the other screens fly a copy of (net/world/enemyFire.ts). */
  spawn(spec: ProjectileSpec, netId = 0): void {
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
    p.bossDamage = spec.bossDamage;
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
    loadBudget(p.budget, kind === 'grenade' ? 0 : spec.penetrate, spec.bodyCost);
    p.baseDamage = spec.damage;
    p.armorPiercing = spec.armorPiercing ?? false;
    p.target = spec.target ?? null;
    p.turnRate = spec.turnRate ?? 0;
    p.line.copy(spec.velocity).normalize();
    p.steerDelay = spec.steerDelay ?? 0;
    p.weave = spec.weave ?? 0;
    p.weavePhase = rand(0, 6.28);
    if (spec.helix) {
      const hd = p.helixData;
      hd.phase = spec.helix.phase;
      hd.reach = spec.helix.reach;
      hd.radius = spec.helix.radius;
      hd.pitch = spec.helix.pitch;
      hd.startRadius = spec.helix.startRadius;
      hd.convergence = spec.helix.convergence;
      p.helix = hd;
    } else {
      p.helix = null;
    }
    p.helixTravel = 0;
    p.helixOffset.set(0, 0, 0);
    if (p.helix) {
      p.helixRight.crossVectors(p.line, UP).normalize();
      p.helixUp.crossVectors(p.helixRight, p.line).normalize();
      helixOffset(p.helixOffset, p.helixRight, p.helixUp, p.helix, 0);
    }
    p.accel = spec.accel ?? 0;
    p.topSpeed = spec.topSpeed ?? 0;
    p.age = 0;
    p.size = spec.size ?? 1;
    p.wired = spec.wired ?? false;
    p.flak = spec.flak ?? false;
    p.wp = spec.wp ?? false;
    p.cluster = spec.cluster ?? false;
    p.cosmetic = spec.cosmetic ?? false;
    p.netId = netId;
    p.laser = spec.laser ?? ROCKET_LASER;
    p.tag = spec.tag ?? 0;
    p.sticky = spec.sticky ?? false;
    p.stuckEnemy = null;
    p.stuckBone = null;
    p.stuckOffset.set(0, 0, 0);
    p.stuckNormal.set(0, 0, 0);
    p.visualHold = 0;
    p.visualOffset.set(0, 0, 0);
    if (spec.visualFrom) {
      p.visualOffset.subVectors(spec.visualFrom, spec.origin);
      p.visualHold = 0.12;
    }
    const blast = spec.explosion;
    p.explosive = !!blast;
    p.ghost = spec.ghost === true;
    p.blastMirrored = blast?.mirrored === true;
    if (blast) {
      p.blastRadius = blast.radius;
      p.blastDamage = blast.damage;
      p.blastKind = blast.kind;
      p.blastInstakill = blast.instakill ?? false;
      p.blastSelf = blast.selfDamage;
      p.blastPush = blast.playerPush;
      p.blastScale = blast.scale;
      p.blastShake = blast.shake;
    }
    this.visuals.tint(p, spec.tracer);
    this.live.push(p);
  }

  private retire(index: number): void {
    const p = this.live[index]!;
    p.live = false;
    // Co-op: the host's enemy projectile is gone, so its copies go too (a copy that ends says nothing).
    if (p.netId && !p.cosmetic) this.ctx.coop?.world?.projectileGone(p.netId);
    p.netId = 0;
    // A pooled missile must not keep a dead enemy reachable.
    p.target = null;
    p.stuckBone = null;
    p.stuckEnemy = null;
    p.sticky = false;
    p.wp = false;
    p.cluster = false;
    p.laser = ROCKET_LASER;
    const last = this.live.pop()!;
    if (index < this.live.length) this.live[index] = last;
    this.free.push(p);
  }

  update(dt: number): void {
    this.drainPins();
    this.wp.update(dt);
    const realDt = this.ctx.time.realDt;
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i]!;
      p.life -= dt;
      // A friend's round (co-op): everything it does this step is for the eye and the ear only.
      const watched = p.cosmetic;
      if (watched) this.combat.watching++;
      try {
        if (p.kind === 'grenade') this.stepGrenade(p, dt);
        else if (p.resting) {
          if (p.sticky) this.stepSticky(p, dt);
          else this.stepBomb(p, dt);
        } else this.step(p, dt);
        if (p.live && p.life <= 0) this.expire(p);
      } finally {
        if (watched) this.combat.watching--;
      }
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
    p.age += dt;
    if (p.wired) {
      if (p.laser.on) this.wire(p, dt);
    } else if (p.turnRate > 0) this.guide(p, dt);
    else if (p.homing > 0) this.steer(p, dt);
    if (p.gravity > 0) p.velocity.y -= p.gravity * dt;

    const speed = p.velocity.length();
    if (speed < 1e-3) return;
    const dir = this.dir.copy(p.velocity).divideScalar(speed);
    let len = speed * dt;
    if (p.helix) {
      p.helixTravel += len;
      const next = helixOffset(this.want, p.helixRight, p.helixUp, p.helix, p.helixTravel);
      dir.multiplyScalar(len).add(next).sub(p.helixOffset);
      p.helixOffset.copy(next);
      len = dir.length();
      if (len > 0) dir.divideScalar(len);
    }
    if (len <= 0) return;

    if (p.flak && this.flakFuze(p, dir, len)) return;
    if (p.cluster && this.clusterFuze(p, dir, speed, dt)) return;
    const wall = c.physics.raycast(p.position, dir, len, CG.World);
    const limit = wall ? wall.distance : len;
    if (p.ghost) {
      // A call-in copy's round: it bursts on the first body or wall in its way, as its caller's does, and hurts neither.
      const body = p.team === 'player' ? c.enemies.raycast(p.position, dir, limit) : null;
      if (body) {
        p.position.copy(body.point);
        if (p.explosive) this.explode(p, undefined);
        p.live = false;
        return;
      }
      if (!wall) {
        p.position.addScaledVector(dir, len);
        return;
      }
      p.position.copy(wall.point);
      if (p.explosive) this.explode(p, wall.normal);
      else c.fx.impact(wall.point, wall.normal, wall.surface, 0.7);
      p.live = false;
      return;
    }

    if (p.team === 'player') {
      // A stake that punched through stops short for this frame, so the next enemy on the line still gets swept.
      if (this.sweepEnemies(p, dir, limit)) return;
      if (p.kind === 'stake' && !p.cosmetic) this.sweepCorpses(p, dir, limit);
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

  /** Wire guidance, HL2's: the nose turns toward wherever the laser dot is now, at `laserTurn`, so it arcs onto it. */
  private wire(p: Projectile, dt: number): void {
    const want = this.want.subVectors(p.laser.at, p.position);
    const dist = want.length();
    if (dist < 1e-3) return;
    const rate = p.turnRate > 0 ? p.turnRate : TUNING.rocket.laserTurn;
    turnToward(p.velocity, want.divideScalar(dist), rate * dt);
  }

  /**
   * A guided missile. It lights and speeds up, flies straight for `steerDelay` so a salvo leaves in a fan, then turns its
   * nose at `turnRate` toward its mark, weaving less as it closes. A mark that dies hands it to the nearest live enemy
   * ahead of it; with nobody there it flies on straight, a dumb rocket.
   */
  private guide(p: Projectile, dt: number): void {
    if (p.accel > 0) {
      const speed = p.velocity.length();
      if (speed < p.topSpeed && speed > 1e-3) p.velocity.multiplyScalar(Math.min(p.topSpeed, speed + p.accel * dt) / speed);
    }
    if (p.age < p.steerDelay) return;
    if (p.target && !p.target.alive) {
      const n = this.ctx.enemies.query(p.position, TUNING.quiver.retargetRange, this.nearby) || 0;
      const cands = this.candidates;
      cands.length = 0;
      for (let i = 0; i < n; i++) cands.push(this.nearby[i]!);
      // Vehicles and the chopper too: retarget() keeps only those in range and ahead.
      const v = this.ctx.enemies.vehicles;
      if (v && typeof v.paintable === 'function') {
        const m = v.paintable(this.hulls);
        for (let i = 0; i < m; i++) cands.push(this.hulls[i]!);
        this.hulls.length = 0;
      }
      p.target = retarget(p.position, p.velocity, cands, TUNING.quiver.retargetRange);
      cands.length = 0;
      // Nobody to take over: straight on from here.
      if (!p.target) p.line.copy(p.velocity).normalize();
    }
    const t = p.target;
    const want = this.want;
    if (t) {
      want.copy(t.center);
      want.y += t.aimLift ?? 0;
      want.sub(p.position);
    } else {
      // A fixed line, not the heading it has now: weaving about its own heading would wander off in a spiral.
      want.copy(p.line);
    }
    const dist = want.length();
    if (dist < 1e-3) return;
    want.divideScalar(dist);
    // The weave fades inside 12 m, so the last of the run is straight at the mark and the fuse gets its chance.
    p.weavePhase += dt * 7;
    weave(want, p.weavePhase, p.weave * (t ? Math.min(1, dist / 12) : 0.35));
    turnToward(p.velocity, want, p.turnRate * dt);
  }

  /**
   * A round with a budget meets everyone on this step's line in order, nearest first, and goes on until one of them
   * stops it. Returns true when one did.
   */
  private sweepThrough(p: Projectile, dir: THREE.Vector3, limit: number): boolean {
    const c = this.ctx;
    const list = c.enemies.raycastAll(p.position, dir, limit, MAX_SWEEP);
    if (!list) return false;
    // The list is the enemy system's own scratch and a strike can re-enter it, so the hits are copied out first.
    const n = Math.min(list.length, MAX_SWEEP);
    for (let i = 0; i < n; i++) {
      const from = list[i]!;
      const to = this.swept[i]!;
      to.enemy = from.enemy;
      to.point.copy(from.point);
      to.normal.copy(from.normal);
      to.bone = from.bone;
      to.region = from.region;
    }
    for (let i = 0; i < n; i++) {
      const h = this.swept[i]!;
      if (h.enemy.uid === p.lastHit || !h.enemy.alive) continue;
      const res = this.strikeDirect(p, h.enemy, h.point, h.normal, dir, h.bone, h.region);
      p.lastHit = h.enemy.uid;
      if (passBody(p.budget, res.blocked)) {
        this.combat.exitBody(h.point, dir, res.blocked || h.enemy.machine);
        p.damage = p.baseDamage * damageKept(p.budget);
        continue;
      }
      p.position.copy(h.point);
      if (p.explosive) this.explode(p, undefined);
      p.live = false;
      return true;
    }
    return false;
  }

  private sweepEnemies(p: Projectile, dir: THREE.Vector3, limit: number): boolean {
    const c = this.ctx;
    if (p.budget.left > 0 && p.kind !== 'stake' && p.kind !== 'rocket') return this.sweepThrough(p, dir, limit);
    const isRocket = p.kind === 'rocket';
    // Rockets cast once out to `limit + ON_COURSE`: a hit within `limit` is direct contact, and any hit beyond `limit`
    // means the rocket is still on course so the proximity fuse holds off.
    const hit = c.enemies.raycast(p.position, dir, isRocket ? limit + ON_COURSE : limit);
    if (hit) {
      if (hit.distance <= limit && hit.enemy.uid !== p.lastHit) {
        p.position.copy(hit.point);
        this.hitEnemy(p, hit.enemy, hit.point, hit.normal, dir, hit.bone, hit.region);
        return true;
      }
      if (isRocket) return false;
    }
    if (!isRocket) return false;
    const end = this.end.copy(p.position).addScaledVector(dir, limit);
    const n = c.enemies.query(end, PROXIMITY + 1, this.nearby) || 0;
    // A guided missile's fuse is for its own mark: it may pass close by others on the way, and only a body square in its
    // path (the contact ray above) stops it short.
    const mark = p.turnRate > 0 ? p.target : null;
    const prox2 = (PROXIMITY + 0.5) * (PROXIMITY + 0.5);
    for (let i = 0; i < n; i++) {
      const e = this.nearby[i]!;
      if (mark && e !== mark) continue;
      if (e.alive && e.center.distanceToSquared(end) < prox2) {
        p.position.copy(end);
        this.explode(p, undefined);
        p.live = false;
        return true;
      }
    }
    return false;
  }

  private strikeDirect(
    p: Projectile, enemy: EnemyInstance, point: THREE.Vector3, normal: THREE.Vector3, dir: THREE.Vector3,
    bone: number | undefined, region: GoreRegion | undefined,
  ): DamageResult {
    const combat = this.combat;
    // Only rockets are area damage on contact. A shell or stake to the head has to read as a headshot.
    const o = combat.strikeOptions(p.kind === 'rocket' ? 'explosive' : 'bullet', p.source);
    o.force = p.force;
    o.severMult = p.severMult;
    o.headshotMult = p.headshotMult;
    o.gib = p.sticky ? false : p.gib;
    o.killStop = p.killStop;
    o.charge = p.explosive && !p.sticky ? SHAPED_CHARGE[p.blastKind] : undefined;
    o.pierces = p.armorPiercing;
    o.bossDamage = p.bossDamage;
    return combat.strike(enemy, point, normal, dir, bone, region, p.damage, o);
  }

  private hitEnemy(
    p: Projectile, enemy: EnemyInstance, point: THREE.Vector3, normal: THREE.Vector3, dir: THREE.Vector3,
    bone: number | undefined, region: GoreRegion | undefined,
  ): void {
    // A friend's stake (co-op): whether it stopped in this body or went on through it is the shooter's to say, since the
    // body may stand somewhere else on their screen. The copy flies on, and ends where they say theirs did (`land`).
    if (p.cosmetic && p.kind === 'stake' && p.fuse <= 0 && !p.explosive) {
      p.lastHit = enemy.uid;
      return;
    }
    const res = this.strikeDirect(p, enemy, point, normal, dir, bone, region);

    if (p.kind === 'stake') {
      if (p.fuse > 0) {
        this.stickBomb(p, point, dir, null, enemy, bone);
        return;
      }
      if (p.explosive) this.explode(p, undefined);
      this.stakeThrough(p, enemy, res, point, dir);
      p.lastHit = enemy.uid;
      return;
    }
    if (p.sticky) {
      this.stickCharge(p, point, normal, enemy, bone);
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
    // (`toldKill`: a co-op guest whose kill was played at once, ahead of the host's word, has the corpse on the line too.)
    if (toldKill(res) || res.severed.length > 0) {
      const back = this.w.copy(point).addScaledVector(dir, -1.2);
      // A burst skull leaves nothing on the stake's line, so a head kill takes the body by the hips. Aimed at the bone
      // itself, because gore tests last frame's pose and enemy.center has already moved on.
      const line = res.headshot ? this.v.setFromMatrixPosition(enemy.char.bones[0]!.matrixWorld).sub(back).normalize() : dir;
      const corpse = this.ctx.gore.raycastCorpses(back, line, 2.6);
      if (corpse) {
        this.nail(p, corpse, point, dir);
        return;
      }
    }
    // Nothing came loose, so a live body stops the stake.
    if (!res.killed) {
      p.live = false;
      // Co-op: the others' copies of it stop here too (an exploding stake has already said where it went off).
      if (p.tag !== 0 && !p.cosmetic && !p.explosive) this.ctx.coop?.world?.landed(p.tag, point);
    }
    // A co-op guest's enemy dies on the host's word: the body is nailed up when that comes, if it comes soon.
    const c = this.ctx;
    if (!res.killed && !res.blocked && isGuest(c)) {
      const from = point.clone();
      const along = dir.clone();
      const head = res.headshot;
      const until = c.time.realElapsed + LATE_PIN;
      c.coop.world.whenKilled(enemy, body => { if (c.time.realElapsed < until) this.nailLate(body, from, along, head); });
    }
  }

  /** The stake that killed it has stopped in it: the body goes to the wall behind as it would have with the stake. */
  private nailLate(enemy: EnemyInstance, point: THREE.Vector3, dir: THREE.Vector3, headshot: boolean): void {
    const c = this.ctx;
    const back = this.w.copy(point).addScaledVector(dir, -1.2);
    const line = headshot ? this.v.setFromMatrixPosition(enemy.char.bones[0]!.matrixWorld).sub(back).normalize() : dir;
    const corpse = c.gore.raycastCorpses(back, line, 2.6);
    const wall = corpse ? c.physics.raycast(point, dir, TUNING.stake.pinReach, CG.World) : null;
    if (!corpse || !wall || this.pendingCount >= MAX_PENDING_PINS) return;
    c.audio.play('stake_hit_flesh', { position: point });
    c.audio.play('stake_twang', { position: wall.point });
    this.visuals.stick(wall.point, dir, TUNING.stake.stuckSeconds);
    const pin = this.pendingPins[this.pendingCount++]!;
    pin.hit.distance = corpse.distance;
    pin.hit.point.copy(corpse.point);
    pin.hit.normal.copy(corpse.normal);
    pin.hit.handle = corpse.handle;
    pin.hit.bone = corpse.bone;
    pin.hit.region = corpse.region;
    pin.anchor.copy(wall.point);
  }

  private sweepCorpses(p: Projectile, dir: THREE.Vector3, limit: number): void {
    // An exploding bolt goes past the dead to stick in the living, or in the wall.
    if (p.pinned || p.fuse > 0) return;
    const hit = this.ctx.gore.raycastCorpses(p.position, dir, limit);
    if (hit) this.nail(p, hit, hit.point, dir);
  }

  /** The pin itself goes in next frame, which keeps a freshly made corpse from being pinned before its first physics step. */
  private nail(p: Projectile, corpse: CorpseHit, from: THREE.Vector3, dir: THREE.Vector3): void {
    const c = this.ctx;
    const wall = c.physics.raycast(from, dir, TUNING.stake.pinReach, CG.World);
    c.audio.play('stake_hit_flesh', { position: from });
    // Set either way: with no wall in reach the stake flies on, and it must not re-nail the same body next frame.
    p.pinned = true;
    if (!wall) return;
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
    const end = this.end.copy(p.position).addScaledVector(dir, limit);
    const remoteHit = c.coop?.world?.enemyRay(p.position, end, p.explosive ? 0 : p.damage, p.source, false);
    if (remoteHit) {
      p.position.copy(remoteHit);
      if (p.explosive) this.explode(p, undefined);
      p.live = false;
      return true;
    }
    if (!player.alive) return false;
    const hit = closestSegmentPoints(p.position, end, player.position, player.eye);
    if (hit.dist2 < PLAYER_RADIUS * PLAYER_RADIUS) {
      p.position.lerp(end, hit.s);
      // A copy stops here and no more: whether it hurt is the host's to say (`hurt`).
      if (p.cosmetic) {
        p.live = false;
        return true;
      }
      const guard = this.combat.guard(dir, p.damage, { armorPiercing: p.armorPiercing, explosive: p.explosive });
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
    if (p.sticky) {
      this.stickCharge(p, wall.point, wall.normal, null, undefined);
      return;
    }
    // A stake's business with a wall is to stay in it.
    if (p.budget.left > 0 && p.kind !== 'stake' && this.goThrough(p, wall)) return;
    switch (p.kind) {
      case 'stake':
        this.stakeLands(p, wall);
        if (p.resting) return;
        break;
      case 'bullet':
        c.fx.impact(wall.point, wall.normal, wall.surface, 0.7);
        c.audio.play(SURFACE_SOUND[wall.surface], { position: wall.point, volume: 0.7, pitchJitter: 0.08 });
        if (p.cosmetic) break;
        c.world.objects?.damageExplosive(wall.collider, p.damage, p.source);
        if (p.team === 'player') c.enemies.vehicles?.shot(wall.collider, wall.point, p.damage, p.source);
        break;
      default:
        if (p.explosive) {
          if (p.team === 'player' && !p.cosmetic) c.enemies.vehicles?.direct(wall.collider, wall.point, p.damage, p.blastKind, p.source);
          this.explode(p, wall.normal);
        }
    }
    p.live = false;
  }

  /**
   * A round with budget left meets a wall. It marks the near face, comes out of the far one and flies on from there next
   * frame. A vehicle takes the round instead: its parts are not cover.
   */
  private goThrough(p: Projectile, wall: RayHit): boolean {
    const c = this.ctx;
    const dir = this.dir;
    if (p.team === 'player' && !p.cosmetic && c.enemies.vehicles?.shot(wall.collider, wall.point, p.damage, p.source) === true) {
      p.live = false;
      return true;
    }
    if (!passWall(c.physics, p.budget, wall, dir, this.exit, this.exitNormal)) return false;
    c.fx.impact(wall.point, wall.normal, wall.surface, 1);
    c.audio.play(SURFACE_SOUND[wall.surface], { position: wall.point, volume: 0.8, pitchJitter: 0.08 });
    if (!p.cosmetic) c.world.objects?.damageExplosive(wall.collider, p.damage, p.source);
    this.combat.exitWall(this.exit, dir, this.exitNormal, wall.surface, 1);
    p.position.copy(this.exit).addScaledVector(dir, 0.02);
    p.damage = p.baseDamage * damageKept(p.budget);
    // Whoever stood against the near face has had their turn. Beyond the wall the round is new to everyone.
    p.lastHit = -1;
    return true;
  }

  private stakeLands(p: Projectile, wall: RayHit): void {
    const c = this.ctx;
    const bomb = p.fuse > 0;
    if (!bomb) this.visuals.stick(wall.point, this.dir, TUNING.stake.stuckSeconds);
    c.fx.impact(wall.point, wall.normal, wall.surface, 1.2);
    c.render.decals.add('crack', wall.point, wall.normal, 0.5, rand(0, 6.28));
    c.audio.play('stake_hit_wall', { position: wall.point });
    if (!p.cosmetic) c.world.objects?.damageExplosive(wall.collider, p.damage, p.source);
    if (bomb) {
      this.stickBomb(p, wall.point, this.dir, wall.normal, null, undefined);
      return;
    }
    if (p.explosive) this.explode(p, wall.normal);
    if (p.pinned) {
      c.audio.play('stake_twang', { position: wall.point });
      this.combat.feel.stop(0.03);
    }
  }

  /**
   * An exploding bolt sticks: in the wall at `normal`, or in `enemy` by `bone`, where it rides his body, alive or a
   * ragdoll, until it goes off. Sunk nose first as a stake in a wall is, most of the shaft showing.
   */
  private stickBomb(
    p: Projectile, point: THREE.Vector3, dir: THREE.Vector3, normal: THREE.Vector3 | null, enemy: EnemyInstance | null,
    bone: number | undefined,
  ): void {
    p.resting = true;
    p.age = 0;
    p.beeps = 0;
    p.blink = 0;
    p.life = p.fuse + 1;
    p.position.copy(point).addScaledVector(dir, -BOLT_SINK);
    p.velocity.copy(dir).multiplyScalar(0.01);
    if (normal) p.stuckNormal.copy(normal);
    else p.stuckNormal.set(0, 0, 0);
    const b = enemy && bone !== undefined ? enemy.char.bones[bone] : undefined;
    p.stuckBone = b ?? null;
    if (!b || !enemy) return;
    const inv = this.inverse.copy(b.matrixWorld).invert();
    p.stuckLocal.copy(p.position).applyMatrix4(inv);
    p.stuckAxis.copy(dir).transformDirection(inv);
    // A friend's bolt rides his body here too; whether he panics is the host's word.
    if (!p.cosmetic) this.ctx.enemies.afflict(enemy, 'bolt', p.fuse);
  }

  /** A stuck exploding bolt: it follows its bone, beeps quicker and quicker, then goes off. */
  private stepBomb(p: Projectile, dt: number): void {
    const b = p.stuckBone;
    if (b) {
      p.position.copy(p.stuckLocal).applyMatrix4(b.matrixWorld);
      p.velocity.copy(p.stuckAxis).transformDirection(b.matrixWorld).multiplyScalar(0.01);
    }
    p.age += dt;
    p.blink -= dt;
    const beeps = TUNING.stake.bomb.beeps;
    while (p.beeps < beeps.length && p.age >= beeps[p.beeps]!) {
      const c = this.ctx;
      c.audio.play('stake_beep', { position: p.position, pitch: 1 + 0.06 * p.beeps });
      c.render.lights.flash(p.position, 0xff2a1a, 3, 3, 0.09);
      p.blink = 0.09;
      p.beeps++;
    }
    if (p.age < p.fuse) return;
    this.explode(p, p.stuckNormal.lengthSq() > 0 ? p.stuckNormal : undefined);
    p.live = false;
  }

  /**
   * A Milkor MGL sticky bomb latches onto a world surface (flush to `normal`) or onto a struck enemy (tracking
   * their bone/world position while alive and safely staying at the last world point if they die or despawn).
   */
  private stickCharge(
    p: Projectile, point: THREE.Vector3, normal: THREE.Vector3, enemy: EnemyInstance | null, bone: number | undefined,
  ): void {
    const c = this.ctx;
    p.resting = true;
    p.age = 0;
    p.blink = 1;
    p.life = 600;
    p.trail = 'none';
    const out = this.w.copy(normal);
    if (out.lengthSq() < 1e-6) out.set(0, 1, 0);
    else out.normalize();
    p.position.copy(point).addScaledVector(out, p.source === 'satchel' ? 0.055 : 0.045);
    p.velocity.copy(out).multiplyScalar(0.01);
    p.stuckNormal.copy(enemy ? this.v.set(0, 0, 0) : out);
    p.stuckEnemy = enemy && enemy.alive ? enemy : null;
    p.stuckBone = null;
    if (p.stuckEnemy) {
      p.stuckOffset.copy(p.position).sub(p.stuckEnemy.position);
      const b = bone !== undefined ? p.stuckEnemy.char?.bones?.[bone] : undefined;
      if (b && b.parent) {
        p.stuckBone = b;
        const inv = this.inverse.copy(b.matrixWorld).invert();
        p.stuckLocal.copy(p.position).applyMatrix4(inv);
        p.stuckAxis.copy(out).transformDirection(inv);
      }
    }
    if (p.source === 'satchel') {
      p.beeps = 0;
      c.audio.play('body_thud', { position: p.position, volume: 0.65, pitch: 0.8 });
      c.audio.play('mgl_stick', { position: p.position, pitch: 0.78 });
      c.audio.play('stake_beep', { position: p.position, volume: 0.45, pitch: 1.15 });
      c.fx.sparks(point, out, 4, 0xff5522);
    } else {
      c.audio.play('mgl_stick', { position: p.position });
      c.fx.sparks(point, out, 3, 0xffaa44);
    }
  }

  /** Planted sticky bomb or satchel charge: tracks a live stuck enemy and pulses its armed LED until remote detonation. */
  private stepSticky(p: Projectile, dt: number): void {
    const e = p.stuckEnemy;
    if (e) {
      if (!e.alive) {
        // Enemy died or despawned: cleanly detach and remain at the last known world position.
        p.stuckEnemy = null;
        p.stuckBone = null;
      } else if (p.stuckBone) {
        p.position.copy(p.stuckLocal).applyMatrix4(p.stuckBone.matrixWorld);
        p.velocity.copy(p.stuckAxis).transformDirection(p.stuckBone.matrixWorld).multiplyScalar(0.01);
      } else {
        p.position.copy(e.position).add(p.stuckOffset);
      }
    }
    p.age += dt;
    if (p.source === 'satchel') {
      const interval = TUNING.satchel.beepInterval;
      p.blink = (p.age % interval) < 0.24 ? 1 : 0;
      if (p.age >= (p.beeps + 1) * interval) {
        p.beeps++;
        if (!p.cosmetic) this.ctx.audio.play('stake_beep', { position: p.position, volume: 0.28, pitch: 1.15 });
      }
    } else {
      p.blink = (p.age * 2.2) % 1 < 0.38 ? 1 : 0;
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

  /** A flak shell's fuze over this step: true when it went off. */
  private flakFuze(p: Projectile, dir: THREE.Vector3, len: number): boolean {
    const wall = this.ctx.physics.raycast(p.position, dir, len + 1, CG.World);
    const [along, off] = nearestAhead(this.ctx, p.position, dir, len, this.ahead);
    const at = flakFuze(len, wall ? wall.distance : Infinity, along, off);
    if (at < 0) return false;
    p.position.addScaledVector(dir, at);
    this.explode(p, undefined);
    p.live = false;
    return true;
  }

  /** A Howitzer cluster shell's standoff fuze (~7 m short of walls/enemies): true when it bursts into bomblets. */
  private clusterFuze(p: Projectile, dir: THREE.Vector3, speed: number, dt: number): boolean {
    const at = checkClusterStandoff(this.ctx, p.position, dir, speed, dt, this.w);
    if (!at) return false;
    p.position.copy(at);
    this.explode(p, undefined);
    p.live = false;
    return true;
  }

  explode(p: Projectile, normal: THREE.Vector3 | undefined): void {
    // Co-op: the others' copy of this round ends here and now, wherever it has got to on their screens.
    if (p.tag !== 0 && !p.cosmetic) this.ctx.coop?.world?.landed(p.tag, p.position);
    // A friend's flak, cluster or WP round bursts for the eye and the ear (stepped under `Combat.watching`).
    if (p.cosmetic && !p.flak && !p.cluster && !p.wp) return;
    if (p.flak) {
      flakBurst(this.ctx, this.combat, p.position, this.v.copy(p.velocity).normalize(), p.source);
      return;
    }
    if (p.cluster) {
      detonateCluster(this.ctx, p.position, this.v.copy(p.velocity).normalize(), `${p.source}_cluster`, p.cosmetic);
      return;
    }
    if (p.wp) {
      this.wp.spawn(p.position, `${p.source}_wp`, p.cosmetic);
      if (p.cosmetic) return;
    }
    const b = this.blastSpec;
    b.radius = p.blastRadius;
    b.damage = p.blastDamage;
    b.kind = p.blastKind;
    b.source = p.source;
    b.team = p.team;
    b.instakill = p.blastInstakill;
    b.selfDamage = p.blastSelf;
    b.playerPush = p.blastPush;
    b.scale = p.blastScale;
    b.shake = p.blastShake;
    b.cosmetic = p.ghost;
    b.mirrored = p.blastMirrored;
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
      case 'howitzer': {
        // Super-charged autocannon supersonic Mach vapor-ring tunnel: rapid expanding dual rings + crisp slipstream.
        if (p.ringClock >= 0.024 && moved) {
          const steps = Math.min(3, Math.floor(p.ringClock / 0.024));
          const ringScale = Math.max(1.2, (p.size || 1) * 0.68);
          for (let k = 1; k <= steps; k++) {
            at.lerpVectors(p.lastTrail, p.position, k / steps);
            if (fx.vaporRing) fx.vaporRing(at, p.velocity, ringScale);
            else fx.ring(at, p.velocity, 0xfff4d6, 2.4 * ringScale);
          }
          p.ringClock -= steps * 0.024;
          p.lastTrail.copy(p.position);
        }
        if (p.smokeClock >= 0.022) {
          p.smokeClock = 0;
          fx.smoke(this.behind(p, 0.35, at), 0xc8ccd0, 0.16, 0.55);
        }
        break;
      }
      case 'swarm':
        if (p.helix) {
          const gap = p.lastTrail.distanceTo(p.position);
          const samples = Math.min(8, Math.floor(gap / HELIX_SMOKE_STEP));
          if (samples === 0) break;
          for (let sample = 1; sample <= samples; sample++) {
            at.lerpVectors(p.lastTrail, p.position, sample * HELIX_SMOKE_STEP / gap);
            fx.smoke(at, 0xd2d0cc, 0.2, 0.9);
          }
          p.lastTrail.lerp(p.position, samples * HELIX_SMOKE_STEP / gap);
          break;
        }
        // Thin and quick, so four of them are four lines and not one cloud.
        if (p.smokeClock >= 0.035 && p.position.distanceToSquared(p.lastTrail) > 0.09) {
          p.smokeClock = 0;
          p.lastTrail.copy(p.position);
          fx.smoke(this.behind(p, 0.2, at), 0xd2d0cc, 0.2, 0.9);
        }
        break;
      case 'sparks':
        if (p.smokeClock >= 0.03 && moved) {
          p.smokeClock = 0;
          p.lastTrail.copy(p.position);
          fx.sparks(this.behind(p, 0.2, at), p.velocity, 1, 0x66ccff);
        }
        break;
      case 'plasma': {
        // The Lance's ball. Sparks every `PLASMA_WAKE` metres of the path and a ring pulse every `PLASMA_RING`, laid along the
        // stretch flown since the last and not only where the ball is now, so the wake is as dense at 30 fps as at 144.
        // Nothing in the first few metres, where a ring would be a frame round the whole view. `ringClock` counts metres here.
        const gap = p.lastTrail.distanceTo(p.position);
        const n = Math.min(4, Math.floor(gap / PLASMA_WAKE));
        if (n === 0) {
          p.ringClock -= realDt;
          break;
        }
        for (let i = 1; i <= n; i++) {
          if (p.age < PLASMA_WAKE_AFTER) continue;
          at.lerpVectors(p.lastTrail, p.position, (i * PLASMA_WAKE) / gap);
          fx.sparks(at, p.velocity, 3, 0x66ccff);
          p.ringClock += PLASMA_WAKE;
          if (p.ringClock < PLASMA_RING) continue;
          p.ringClock = 0;
          fx.ring(at, p.velocity, 0x59d0ff, 0.1);
        }
        p.ringClock -= realDt;
        p.lastTrail.lerp(p.position, (n * PLASMA_WAKE) / gap);
        break;
      }
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
      // A friend's own round is not for shooting down; the copy of an enemy's rocket is (the host is asked: `netId`).
      if ((p.cosmetic && p.netId === 0) || (p.kind !== 'grenade' && !(p.kind === 'rocket' && p.team === 'enemy'))) continue;
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

  /** Co-op: the live projectile with this number, if any. */
  byNetId(netId: number): Projectile | null {
    for (let i = 0; i < this.live.length; i++) if (this.live[i]!.netId === netId) return this.live[i]!;
    return null;
  }

  /** Co-op guest: the host's projectile is gone, so its copy goes with it, quietly. */
  dropCopy(netId: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i]!;
      if (p.cosmetic && p.netId === netId) this.retire(i);
    }
  }

  /** Blows a shootable up where it is. */
  detonate(p: Projectile): void {
    if (!p.live) return;
    // Co-op guest: the shot hit a copy. The host is asked to blow the real one up; the copy just goes.
    if (p.cosmetic) {
      if (p.netId) this.ctx.coop?.world?.projectileShot(p.netId);
      p.live = false;
      const copy = this.live.indexOf(p);
      if (copy >= 0) this.retire(copy);
      return;
    }
    p.team = 'player';
    this.explode(p, undefined);
    p.live = false;
    const at = this.live.indexOf(p);
    if (at >= 0) this.retire(at);
  }

  /**
   * Co-op: a friend's own round `tag` went off at `at` on their screen. Its copy here ends there too, if it is still flying
   * (a body it met there may stand somewhere else here): a flak shell bursts there, anything else just goes, and the blast
   * itself is drawn from the shooter's own word.
   */
  land(tag: number, at: THREE.Vector3): void {
    for (let i = 0; i < this.live.length; i++) {
      const p = this.live[i]!;
      if (!p.cosmetic || p.tag !== tag) continue;
      p.position.copy(at);
      if (p.flak || p.cluster || p.wp) {
        this.combat.watching++;
        try {
          this.explode(p, undefined);
        } finally {
          this.combat.watching--;
        }
      }
      p.live = false;
      this.retire(i);
      return;
    }
  }

  /** Grenades in a blast cook off a moment later. */
  caughtInBlast(center: THREE.Vector3, radius: number): void {
    const r2 = radius * radius;
    for (let i = 0; i < this.live.length; i++) {
      const p = this.live[i]!;
      if (p.kind === 'grenade' && !p.cosmetic && p.fuse > 0.08 && p.position.distanceToSquared(center) < r2) p.fuse = 0.08;
    }
  }

  /** Number of currently planted (stuck & armed) sticky bombs for `source` (or all sources if omitted). */
  stickyCount(source?: string): number {
    let n = 0;
    for (let i = 0; i < this.live.length; i++) {
      const p = this.live[i]!;
      if (p.live && p.sticky && p.resting && !p.cosmetic && (!source || p.source === source)) n++;
    }
    return n;
  }

  /**
   * Immediately detonates all sticky bombs for `source` (planted only, or including in-flight when `includeInFlight` is true).
   * Returns how many stickies were detonated.
   */
  detonateStickies(source?: string, includeInFlight = false): number {
    const targets: Projectile[] = [];
    for (let i = 0; i < this.live.length; i++) {
      const p = this.live[i]!;
      if (p.live && p.sticky && !p.cosmetic && (includeInFlight || p.resting) && (!source || p.source === source)) {
        targets.push(p);
      }
    }
    let count = 0;
    for (let i = 0; i < targets.length; i++) {
      const p = targets[i]!;
      if (!p.live) continue;
      count++;
      // Mark dead before exploding so re-entrant chain blasts cannot detonate this sticky twice.
      p.live = false;
      this.explode(p, p.stuckNormal.lengthSq() > 0 ? p.stuckNormal : undefined);
      const at = this.live.indexOf(p);
      if (at >= 0) this.retire(at);
    }
    return count;
  }

  /** Silently removes sticky bombs without detonating or dealing damage (used on match/weapon reset). */
  clearStickies(source?: string): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i]!;
      if (p.sticky && (!source || p.source === source)) this.retire(i);
    }
  }

  /**
   * Active protection (Point Defence): intercepts up to `max` live enemy rockets, grenades, or shells within `radius` m
   * of `center` (or heading toward the sphere within `radius * 1.5` m). Retires them without detonating.
   * Allocation-free: `onIntercept` receives a scratch vector valid only during the callback.
   */
  interceptEnemyProjectiles(
    center: THREE.Vector3,
    radius: number,
    max: number,
    onIntercept?: (at: THREE.Vector3) => void,
  ): number {
    if (max <= 0 || radius <= 0) return 0;
    const r2 = radius * radius;
    const lookR2 = (radius * 1.5) * (radius * 1.5);
    let count = 0;
    for (let i = this.live.length - 1; i >= 0 && count < max; i--) {
      const p = this.live[i]!;
      if (!p.live || p.team !== 'enemy') continue;
      if (p.kind !== 'rocket' && p.kind !== 'grenade' && p.kind !== 'shell') continue;
      if (p.cosmetic && p.netId === 0) continue;
      const to = this.w.subVectors(center, p.position);
      const d2 = to.lengthSq();
      let threat = d2 <= r2;
      if (!threat && d2 <= lookR2) {
        const v2 = p.velocity.lengthSq();
        if (v2 > 1e-4) {
          const dot = to.dot(p.velocity);
          if (dot > 0) {
            const perp2 = d2 - (dot * dot) / v2;
            threat = perp2 <= r2;
          }
        }
      }
      if (!threat) continue;
      this.end.copy(p.position);
      if (p.cosmetic && p.netId) this.ctx.coop?.world?.projectileShot(p.netId);
      this.retire(i);
      onIntercept?.(this.end);
      count++;
    }
    return count;
  }

  /** True when any live enemy rocket is within `radius` m of `center` (Countermeasure Rack auto-flares). */
  hasIncomingEnemyMissile(center: THREE.Vector3, radius: number): boolean {
    if (radius <= 0) return false;
    const r2 = radius * radius;
    for (let i = 0; i < this.live.length; i++) {
      const p = this.live[i]!;
      if (!p.live || p.team !== 'enemy' || p.kind !== 'rocket') continue;
      if (p.cosmetic && p.netId === 0) continue;
      if (p.position.distanceToSquared(center) <= r2) return true;
    }
    return false;
  }
}
