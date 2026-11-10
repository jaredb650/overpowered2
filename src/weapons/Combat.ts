/**
 * Hit resolution. Rays, blasts and everything that touches an enemy pass through here, so damage
 * numbers, feedback and kill credit have one code path instead of the first game's seven.
 */
import * as THREE from 'three';
import { CG, type CorpseHit, type Ctx, type DamageInfo, type DamageType, type ExplosionKind, type ExplosionOptions, type SurfaceKind } from '../core/contracts';
import type {
  CombatSystem, DamageResult, EnemyInstance, ExplosionSpec, ProjectileSpec, ShotResult, ShotSpec, StruckList,
} from '../core/gameplay';
import type { GoreRegion } from '../characters/rig';
import type { MuzzleKind } from '../core/contracts';
import { clamp, rand } from '../core/math';
import { BURST_ON, Bursts } from './burst';
import { EXPLOSIONS, HIT_STOP, PENETRATION, SHAPED_CHARGE, SURFACE_SOUND, SWORD, TUNING, type ShapedCharge, type SoundLayer } from './data';
import { Feel } from './Feel';
import { Flames } from './Flames';
import { closestOnSegment, closestSegmentPoints } from './geometry';
import { damageKept, loadBudget, makeBudget, passBody, passWall, perWall, type Budget } from './penetration';
import { Projectiles } from './Projectiles';

const MAX_RANGE = 800;
/** Walls passed plus bounces. A sabot through a row of sheet metal is what needs the room. */
const MAX_SEGMENTS = 12;
/** Re-entrant calls happen when a kill's listeners fire guns. Deeper than this is a feedback loop. */
const MAX_RAY_DEPTH = 4;
const DAMAGE_RING = 128;
const MAX_PIERCE_SLOTS = 32;
const MAX_QUEUED_BLASTS = 48;
/** Blasts set off by a blast wait this long, so a row of barrels ripples instead of popping at once. */
const CHAIN_DELAY = 0.07;
const WALL_BLOOD_REACH = 5;
const PLAYER_RADIUS = 0.45;
const WHIZZ_RADIUS = 3;
const SHOCK = { range: 9, targets: 3, damage: 0.4 };
const INSTAKILL = 9999;
/** Quad size of the crater a round leaves coming out of a wall, at impact scale 1. The pale spall is about half of it. */
const EXIT_CRATER = 0.3;
/** Rounds this heavy light the far face up as they leave it. */
const EXIT_FLASH_SCALE = 1.5;
/** Kills closer than this put blood on the lens, scaled up as the range closes. */
const LENS_BLOOD_RANGE = 3.5;

/** Field by field on purpose: Object.assign leaves a recycled spec's old `instakill` behind when the new one omits it. */
function copyBlast(to: ExplosionSpec, from: ExplosionSpec): void {
  to.radius = from.radius;
  to.damage = from.damage;
  to.kind = from.kind;
  to.source = from.source;
  to.team = from.team;
  to.instakill = from.instakill;
  to.selfDamage = from.selfDamage;
  to.playerPush = from.playerPush;
  to.scale = from.scale;
  to.shake = from.shake;
  to.worldObject = from.worldObject;
}

interface HitSlot {
  enemy: EnemyInstance;
  distance: number;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  bone: number;
  region: GoreRegion;
}

/** Per-depth scratch, so a listener calling fireRay mid-shot cannot corrupt the shot in progress. */
interface RayState {
  origin: THREE.Vector3;
  dir: THREE.Vector3;
  from: THREE.Vector3;
  end: THREE.Vector3;
  hits: HitSlot[];
  result: ShotResult;
  /** Penetration left on the shot in progress. */
  budget: Budget;
  exit: THREE.Vector3;
  /** The way the face it left looks. */
  exitNormal: THREE.Vector3;
}

export interface StrikeOptions {
  type: DamageType;
  source: string;
  force: number;
  severMult: number;
  headshotMult: number;
  gib: boolean;
  slicePlaneNormal: THREE.Vector3 | undefined;
  explosionId: number | undefined;
  /** Hit-stop on a kill, 0 for none. */
  killStop: number;
  /** Per-hit sound, marker and blood stay off. The caller summarises instead. */
  quiet: boolean;
  /** A blast's splash: how far out the body stood, as a share of the radius, and what went off. */
  reach: number | undefined;
  blastKind: ExplosionKind | undefined;
  /** A shaped charge landing on the body itself. */
  charge: ShapedCharge | undefined;
  /** An armour-piercing round: neither plates nor a carried shield stop it. */
  pierces: boolean;
}

interface QueuedBlast {
  at: number;
  position: THREE.Vector3;
  normal: THREE.Vector3;
  hasNormal: boolean;
  spec: ExplosionSpec;
}

/** Deflection result reported by the sword. */
export type GuardResult = 'none' | 'block' | 'parry';

/** Implemented by WeaponSystem. Combat asks before an enemy shot lands. */
export interface Guard {
  guard(incoming: THREE.Vector3): GuardResult;
}

const UP = new THREE.Vector3(0, 1, 0);

export class Combat implements CombatSystem {
  private ctx!: Ctx;
  readonly feel: Feel;
  readonly projectiles: Projectiles;
  readonly flames: Flames;
  /** Small cannon rounds going off where they land: `ShotSpec.burst`. Never a blast. See burst.ts. */
  readonly bursts: Bursts;

  private readonly damageRing: DamageInfo[] = [];
  private damageHead = 0;
  private readonly stack: RayState[] = [];
  private rayDepth = 0;
  private exploding = false;
  private explosionSerial = 0;
  private readonly queue: QueuedBlast[] = [];
  private queueLen = 0;
  private readonly blastList: EnemyInstance[] = [];
  private readonly hopList: EnemyInstance[] = [];
  private readonly hopHit: EnemyInstance[] = [];

  private readonly opts: StrikeOptions = {
    type: 'bullet', source: '', force: 0, severMult: 1, headshotMult: 2, gib: false,
    slicePlaneNormal: undefined, explosionId: undefined, killStop: 0, quiet: false, reach: undefined, blastKind: undefined, charge: undefined, pierces: false,
  };

  // Scratch. Each is used within one function and never held across a call that could re-enter it.
  private readonly vA = new THREE.Vector3();
  private readonly vB = new THREE.Vector3();
  private readonly vC = new THREE.Vector3();
  private readonly vD = new THREE.Vector3();
  private readonly vE = new THREE.Vector3();
  private readonly vF = new THREE.Vector3();
  private readonly blastCenter = new THREE.Vector3();
  private readonly playPosition = { position: undefined as THREE.Vector3 | undefined, volume: 1, pitch: 1, pitchJitter: 0 };

  constructor(ctx: Ctx) {
    this.ctx = ctx;
    this.feel = new Feel(ctx);
    this.projectiles = new Projectiles(ctx, this);
    this.flames = new Flames(ctx, this);
    this.bursts = new Bursts(ctx, this);
    for (let i = 0; i < DAMAGE_RING; i++) {
      this.damageRing.push({ amount: 0, type: 'bullet', point: new THREE.Vector3(), dir: new THREE.Vector3(), force: 0, source: '' });
    }
    for (let i = 0; i < MAX_RAY_DEPTH; i++) {
      const hits: HitSlot[] = [];
      for (let h = 0; h < MAX_PIERCE_SLOTS; h++) {
        hits.push({
          enemy: null as unknown as EnemyInstance, distance: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(), bone: 0, region: 'chest',
        });
      }
      this.stack.push({
        origin: new THREE.Vector3(), dir: new THREE.Vector3(), from: new THREE.Vector3(), end: new THREE.Vector3(), hits,
        result: { hitEnemy: false, headshot: false, killed: false, kills: 0, end: new THREE.Vector3() },
        budget: makeBudget(), exit: new THREE.Vector3(), exitNormal: new THREE.Vector3(),
      });
    }
    for (let i = 0; i < MAX_QUEUED_BLASTS; i++) {
      this.queue.push({
        at: 0, position: new THREE.Vector3(), normal: new THREE.Vector3(), hasNormal: false,
        spec: { radius: 0, damage: 0, kind: 'rocket', source: '', team: 'player' },
      });
    }
  }

  init(ctx: Ctx): void {
    this.ctx = ctx;
    this.projectiles.init();
    this.flames.init();
    ctx.events.on('world:explosion', e => {
      // Its own scratch: this fires from inside blast(), which may still be reading scratchBlast.
      const blast = this.worldBlast;
      blast.radius = e.radius;
      blast.damage = e.damage;
      blast.source = e.source;
      this.explode(e.position, blast);
    });
    ctx.events.on('enemy:killed', e => {
      if (e.distance >= LENS_BLOOD_RANGE || e.enemy.id === 'skitter' || e.enemy.id === 'drone' || ctx.player.parked) return;
      const close = 1 - e.distance / LENS_BLOOD_RANGE;
      ctx.fx.lensBlood(close * close);
    });
  }

  update(): void {
    const dt = this.ctx.time.dt;
    this.drainBlasts();
    this.projectiles.update(dt);
    this.flames.update(dt);
  }

  reset(): void {
    this.projectiles.clear();
    this.flames.clear();
    this.bursts.reset();
    this.feel.reset();
    this.queueLen = 0;
    this.exploding = false;
    this.rayDepth = 0;
  }

  /** A DamageInfo that stays valid for the next DAMAGE_RING hits, long enough for anything that keeps it briefly. */
  private nextDamage(): DamageInfo {
    const d = this.damageRing[this.damageHead]!;
    this.damageHead = (this.damageHead + 1) % DAMAGE_RING;
    d.region = undefined;
    d.bone = undefined;
    d.slicePlaneNormal = undefined;
    d.gib = undefined;
    d.severMult = undefined;
    d.explosionId = undefined;
    d.headshotMult = undefined;
    d.reach = undefined;
    d.blastKind = undefined;
    d.pierces = undefined;
    d.armorPiercing = undefined;
    return d;
  }

  private sound(layer: SoundLayer, position?: THREE.Vector3): void {
    const p = this.playPosition;
    p.position = position;
    p.volume = layer.volume ?? 1;
    p.pitch = layer.pitch ?? 1;
    p.pitchJitter = layer.pitchJitter ?? 0;
    this.ctx.audio.play(layer.id, p);
  }

  private play(id: string, position?: THREE.Vector3, volume = 1, pitchJitter = 0): void {
    const p = this.playPosition;
    p.position = position;
    p.volume = volume;
    p.pitch = 1;
    p.pitchJitter = pitchJitter;
    this.ctx.audio.play(id, p);
  }

  // -------------------------------------------------------------------------------------------
  // Touching an enemy
  // -------------------------------------------------------------------------------------------

  /** Scratch options for strike(). Fill it and pass it straight back. */
  strikeOptions(type: DamageType, source: string): StrikeOptions {
    const o = this.opts;
    o.type = type;
    o.source = source;
    o.force = 0;
    o.severMult = 1;
    o.headshotMult = 2;
    o.gib = false;
    o.slicePlaneNormal = undefined;
    o.explosionId = undefined;
    o.killStop = 0;
    o.quiet = false;
    o.reach = undefined;
    o.blastKind = undefined;
    o.charge = undefined;
    o.pierces = false;
    return o;
  }

  /** The one place this system hands damage to an enemy. */
  strike(
    enemy: EnemyInstance, point: THREE.Vector3, normal: THREE.Vector3, dir: THREE.Vector3,
    bone: number | undefined, region: GoreRegion | undefined, amount: number, o: StrikeOptions,
  ): DamageResult {
    const c = this.ctx;
    const d = this.nextDamage();
    // Instakill values are for grunts. A boss takes a heavy hit, never the end of the fight.
    d.amount = enemy.isBoss && amount >= INSTAKILL ? TUNING.autocannon.bossDamage : amount;
    d.type = o.type;
    d.point.copy(point);
    d.dir.copy(dir);
    d.force = o.force;
    d.source = o.source;
    d.region = region;
    d.bone = bone;
    d.severMult = o.severMult;
    d.headshotMult = o.headshotMult;
    d.gib = o.gib || undefined;
    d.slicePlaneNormal = o.slicePlaneNormal;
    d.explosionId = o.explosionId;
    d.reach = o.reach;
    d.blastKind = o.blastKind;
    if (o.charge && enemy.armor > 0) {
      d.amount *= o.charge.direct;
      d.pierces = true;
    }
    if (o.pierces) {
      d.armorPiercing = true;
      if (enemy.armor > 0) d.pierces = true;
    }
    const killStop = o.killStop;
    const quiet = o.quiet;
    const result = c.enemies.applyDamage(enemy, d);
    if (!result) return NO_DAMAGE;

    if (result.blocked) {
      if (!quiet) {
        c.fx.impact(point, normal, 'armor');
        this.play('impact_armor', point, 0.9, 0.05);
        c.hud.hitMarker('armor');
      }
      return result;
    }

    if (!quiet) {
      if (result.headshot) {
        // The yellow chips and the triple layer are the signature of the whole game. Never positional.
        c.fx.chips(point, 0xffff00, 20);
        this.play('headshot');
        c.hud.hitMarker(result.killed ? 'kill' : 'head');
        this.feel.stop(result.killed ? HIT_STOP.headshotKill : HIT_STOP.headshot);
      } else {
        c.fx.bloodHit(point, dir, 1);
        // The material of the hit. Its weight by round, and the 2D confirmation, are layered by audio from the same enemy:hit.
        this.play(enemy.machine ? 'machine_hit' : 'bullet_body', point, 1, 0.06);
        c.hud.hitMarker(result.killed ? 'kill' : 'body');
      }
      if (result.killed && killStop > 0) this.feel.stop(killStop);
      else if (result.severed.length > 0) {
        this.play('limb_sever', point, 1, 0.06);
        this.feel.stop(HIT_STOP.sever);
      }
    }
    return result;
  }

  // -------------------------------------------------------------------------------------------
  // Hitscan
  // -------------------------------------------------------------------------------------------

  fireRay(origin: THREE.Vector3, dir: THREE.Vector3, spec: ShotSpec): ShotResult {
    const depth = this.rayDepth;
    if (depth >= MAX_RAY_DEPTH) {
      const r = this.stack[MAX_RAY_DEPTH - 1]!.result;
      r.hitEnemy = r.headshot = r.killed = false;
      r.kills = 0;
      r.end.copy(origin);
      return r;
    }
    this.rayDepth = depth + 1;
    const st = this.stack[depth]!;
    st.origin.copy(origin);
    st.dir.copy(dir).normalize();
    st.from.copy(spec.tracerFrom ?? origin);
    const r = st.result;
    r.hitEnemy = r.headshot = r.killed = false;
    r.kills = 0;
    try {
      if (spec.team === 'enemy') this.enemyRay(st, spec);
      else this.playerRay(st, spec);
    } finally {
      this.rayDepth = depth;
    }
    r.end.copy(st.end);
    return r;
  }

  /**
   * `skip` is the list of a round that is resolved in more than one ray (the Lance's beam, a few bodies a frame): a body
   * already in it is not met again, so a later ray can start where the last one stopped without striking a survivor twice.
   */
  private collectHits(st: RayState, limit: number, pierce: number, skip?: StruckList): number {
    const c = this.ctx;
    const hits = st.hits;
    if (pierce > 0 || skip) {
      const want = Math.min(pierce + 1, MAX_PIERCE_SLOTS);
      const list = c.enemies.raycastAll(st.origin, st.dir, limit, skip ? MAX_PIERCE_SLOTS : want);
      if (!list) return 0;
      let n = 0;
      for (let i = 0; i < list.length && n < want; i++) {
        const h = list[i]!;
        if (skip && wasStruck(skip, h.enemy)) continue;
        const s = hits[n++]!;
        s.enemy = h.enemy;
        s.distance = h.distance;
        s.point.copy(h.point);
        s.normal.copy(h.normal);
        s.bone = h.bone;
        s.region = h.region;
      }
      return n;
    }
    const h = c.enemies.raycast(st.origin, st.dir, limit);
    if (!h) return 0;
    const s = hits[0]!;
    s.enemy = h.enemy;
    s.distance = h.distance;
    s.point.copy(h.point);
    s.normal.copy(h.normal);
    s.bone = h.bone;
    s.region = h.region;
    return 1;
  }

  private playerRay(st: RayState, spec: ShotSpec): void {
    const c = this.ctx;
    const r = st.result;
    let left = spec.maxDistance ?? MAX_RANGE;
    /** The round's damage before range and penetration take their share. Bounces cut it. */
    let damage = spec.damage;
    let pierce = spec.pierce ?? 0;
    let bounces = spec.ricochet ?? 0;
    let cleave = spec.cleave ?? 0;
    /** Meters flown before this segment, for falloff. */
    let flown = 0;
    const blood = spec.force ?? 0;
    const budget = loadBudget(st.budget, spec.penetrate, spec.bodyCost, spec.penetrateKeep, spec.penetrateWalls);
    const falloff = spec.falloff;
    const scale = spec.impactScale ?? 1;
    // A cannon round bursts on the first thing it strikes and again where it stops, if it went on: two at most. A round
    // with a real blast of its own (Hellfire Rounds) has that instead.
    const burst = BURST_ON && !spec.blastRadius ? spec.burst : undefined;
    let burstFirst = burst !== undefined;

    for (let segment = 0; segment < MAX_SEGMENTS; segment++) {
      const wall = c.physics.raycast(st.origin, st.dir, left, CG.World);
      const limit = wall ? wall.distance : left;
      // Bodies this round could still go through: the free ones, plus what its budget buys.
      let through = pierce;
      if (budget.left > 0) through += budget.body > 0 ? Math.floor(budget.left / budget.body + 1e-6) : MAX_PIERCE_SLOTS;
      const count = this.collectHits(st, limit, Math.min(through, MAX_PIERCE_SLOTS - 1), spec.struck);
      const stopsOnEnemy = count > 0 && count > through;
      const firstStop = stopsOnEnemy ? st.hits[count - 1]!.distance : limit;

      const shot = this.projectiles.shootable(st.origin, st.dir, count > 0 ? st.hits[0]!.distance : limit);
      if (shot) {
        st.end.copy(st.origin).addScaledVector(st.dir, shot.at);
        if (spec.tracer) c.fx.tracer(st.from, st.end, spec.tracer);
        this.projectiles.detonate(shot.projectile);
        return;
      }

      if (!spec.skipCorpses) this.hitCorpses(st, firstStop, damage * damageKept(budget), spec);

      let stopped = false;
      let hopFrom: HitSlot | null = null;
      let dealt = damage;
      for (let i = 0; i < count; i++) {
        const h = st.hits[i]!;
        dealt = damage * damageKept(budget);
        if (falloff) dealt *= rangeFalloff(falloff, flown + h.distance);
        const o = this.strikeOptions(spec.type ?? (spec.source === 'shotgun' ? 'pellet' : 'bullet'), spec.source);
        o.force = blood;
        o.severMult = spec.severMult ?? 1;
        o.headshotMult = spec.headshotMult ?? 2;
        o.killStop = spec.killStop ?? 0;
        o.gib = spec.gib ?? false;
        o.pierces = spec.armorPiercing ?? false;
        const splits = cleave > 0 && h.region !== 'head';
        // Vertical, through the line of the shot, so the two halves fall away either side of it.
        if (splits) o.slicePlaneNormal = this.vE.crossVectors(st.dir, UP).normalize();
        const res = this.strike(h.enemy, h.point, h.normal, st.dir, h.bone, h.region, dealt, o);
        r.hitEnemy = true;
        // For a weapon that does something at every body its round struck: the Lance sets a plasma burst off at each.
        const list = spec.struck;
        if (list && list.count < list.points.length) {
          list.points[list.count]!.copy(h.point);
          list.enemies[list.count++] = h.enemy;
        }
        if (res.headshot) r.headshot = true;
        if (res.killed) {
          r.killed = true;
          r.kills++;
          if (splits) cleave--;
        }
        if (!res.blocked && wall && wall.distance - h.distance < WALL_BLOOD_REACH) {
          c.render.decals.add('blood', wall.point, wall.normal, rand(0.5, 1.1) * (res.killed ? 1.5 : 1), rand(0, 6.28));
        }
        if (spec.shock && !res.blocked) this.arc(h.point, h.enemy, dealt * SHOCK.damage, spec);
        if (pierce > 0) {
          pierce--;
          continue;
        }
        // Read now: a burst below strikes other bodies, and the results come from a ring.
        const headshot = res.headshot;
        const blocked = res.blocked;
        // False for a body an earlier burst of this same round already killed.
        const struck = res.killed || h.enemy.alive;
        if (passBody(budget, blocked)) {
          this.exitBody(h.point, st.dir, blocked || h.enemy.machine);
          // Hellfire Rounds go off on every body the round struck, not only the one that stops it: a round that goes
          // through its target would otherwise burst on whatever is behind, or on nothing.
          if (spec.blastRadius && struck) this.bulletBlast(h.point, h.normal, dealt, spec);
          else if (burst && burstFirst) this.bursts.at(h.point, h.normal, burst, spec.source, h.enemy);
          burstFirst = false;
          continue;
        }
        stopped = true;
        hopFrom = h;
        if (spec.headHops && headshot) this.hopHeads(h.point, h.enemy, spec.headHops, dealt, spec);
        break;
      }

      if (stopped) {
        const h = hopFrom!;
        st.end.copy(h.point);
        if (bounces > 0) {
          bounces--;
          if (this.hopNearest(st, h, dealt * 0.8, spec, bounces)) bounces = 0;
        }
        if (spec.tracer) c.fx.tracer(st.from, st.end, spec.tracer);
        if (spec.blastRadius) this.bulletBlast(st.end, h.normal, dealt, spec);
        else if (burst) this.bursts.at(st.end, h.normal, burst, spec.source, h.enemy);
        return;
      }

      if (!wall) {
        st.end.copy(st.origin).addScaledVector(st.dir, left);
        if (spec.tracer) c.fx.tracer(st.from, st.end, spec.tracer);
        return;
      }

      const atWall = damage * damageKept(budget);
      st.end.copy(wall.point);
      if (spec.tracer) c.fx.tracer(st.from, st.end, spec.tracer);
      this.impact(wall.point, wall.normal, wall.surface, scale);
      c.world.objects?.damageExplosive(wall.collider, atWall, spec.source);
      const vehicle = c.enemies.vehicles?.shot(wall.collider, wall.point, atWall, spec.source) === true;
      left -= wall.distance;
      flown += wall.distance;

      // A vehicle is not cover to shoot through: its parts take the round and that is the end of it. The per-wall rule
      // is older than that and keeps what it did.
      if (budget.left > 0 && (!vehicle || perWall(budget)) && passWall(c.physics, budget, wall, st.dir, st.exit, st.exitNormal)) {
        const thickness = st.exit.distanceTo(wall.point);
        if (spec.struck) spec.struck.walls++;
        if (burst && burstFirst) this.bursts.at(wall.point, wall.normal, burst, spec.source, null);
        burstFirst = false;
        this.exitWall(st.exit, st.dir, st.exitNormal, wall.surface, scale);
        left -= thickness;
        flown += thickness;
        st.from.copy(st.exit);
        st.origin.copy(st.exit).addScaledVector(st.dir, 0.02);
        if (left > 0.05) continue;
        return;
      }

      if (bounces > 0 && left > 1) {
        bounces--;
        damage *= 0.8;
        this.reflect(st, wall.normal);
        st.origin.copy(wall.point).addScaledVector(wall.normal, 0.02);
        st.from.copy(wall.point);
        this.play('ricochet', wall.point, 0.8, 0.08);
        c.fx.sparks(wall.point, st.dir, 6, 0xffee88);
        continue;
      }

      if (spec.blastRadius) this.bulletBlast(wall.point, wall.normal, atWall, spec);
      else if (burst) this.bursts.at(wall.point, wall.normal, burst, spec.source, null);
      return;
    }
  }

  /**
   * The far side of a wall a round went through: the surface's own impact off the face it left, a spall crater, and a puff
   * of what the wall is made of thrown on along the shot. `normal` is that face's, from the probe: marks laid along the
   * shot instead stand off a wall it left at a slant, and the decal pass cuts away whatever stands off.
   */
  exitWall(exit: THREE.Vector3, dir: THREE.Vector3, normal: THREE.Vector3, surface: SurfaceKind, scale: number): void {
    const c = this.ctx;
    const face = this.vF.copy(normal);
    this.impact(exit, face, surface, scale);
    // Spall: the far face breaks away far wider than the hole going in, and what is under the paint is pale. It is the one
    // pale mark in the atlas, so it shows on a wall in shadow, where a scorch or a bullet hole is black on black.
    if (surface !== 'glass' && surface !== 'grate' && surface !== 'energy' && surface !== 'lava') {
      c.render.decals.add('exit', exit, face, EXIT_CRATER * scale, rand(0, 6.28));
    }
    const out = this.vA.copy(exit).addScaledVector(dir, 0.12);
    c.fx.smoke(out, EXIT_DUST[surface], 0.3 * Math.sqrt(scale), 0.8);
    if (scale >= EXIT_FLASH_SCALE) c.render.lights.flash(out, 0xffd9a8, 2.5 * scale, 5, 0.18);
  }

  /** The back of a body a round went through. `point` is where it went in. */
  exitBody(point: THREE.Vector3, dir: THREE.Vector3, sparks: boolean): void {
    const c = this.ctx;
    const out = this.vA.copy(point).addScaledVector(dir, PENETRATION.bodyDepth);
    if (sparks) c.fx.sparks(out, dir, 6, 0xffee88);
    else c.fx.bloodHit(out, dir, 1.3);
  }

  /** Bends a reflected shot toward anything close to its new line, so a bounce reads as skill, not noise. */
  private reflect(st: RayState, normal: THREE.Vector3): void {
    const c = this.ctx;
    st.dir.addScaledVector(normal, -2 * st.dir.dot(normal)).normalize();
    const n = c.enemies.query(st.end, 30, this.hopList) || 0;
    let best = 0.94;
    let target: EnemyInstance | null = null;
    for (let i = 0; i < n; i++) {
      const e = this.hopList[i]!;
      if (!e.alive) continue;
      const dot = this.vA.subVectors(e.center, st.end).normalize().dot(st.dir);
      if (dot > best) {
        best = dot;
        target = e;
      }
    }
    if (target) st.dir.subVectors(target.center, st.end).normalize();
  }

  private bulletBlast(point: THREE.Vector3, normal: THREE.Vector3, damage: number, spec: ShotSpec): void {
    const blast = this.scratchBlast;
    blast.radius = spec.blastRadius!;
    blast.damage = damage;
    blast.kind = 'hellfireBullet';
    blast.source = spec.source;
    blast.team = spec.team;
    blast.normal = normal;
    blast.selfDamage = undefined;
    blast.playerPush = undefined;
    blast.instakill = undefined;
    blast.scale = undefined;
    this.explode(point, blast);
  }

  private readonly scratchBlast: ExplosionSpec = { radius: 0, damage: 0, kind: 'hellfireBullet', source: '', team: 'player' };
  private readonly worldBlast: ExplosionSpec = { radius: 0, damage: 0, kind: 'barrel', source: '', team: 'player', worldObject: true };

  private hitCorpses(st: RayState, limit: number, damage: number, spec: ShotSpec): void {
    const c = this.ctx;
    const tries = spec.pierce || spec.penetrate ? 3 : 1;
    const from = this.vC.copy(st.origin);
    let left = limit;
    for (let i = 0; i < tries; i++) {
      const hit = c.gore.raycastCorpses(from, st.dir, left);
      if (!hit) return;
      const d = this.nextDamage();
      d.amount = damage;
      d.type = spec.type ?? 'bullet';
      d.point.copy(hit.point);
      d.dir.copy(st.dir);
      d.force = spec.force ?? 0;
      d.source = spec.source;
      d.severMult = spec.severMult ?? 1;
      c.gore.damageCorpse(hit, d);
      c.fx.bloodHit(hit.point, st.dir, 0.6);
      left -= hit.distance + 0.25;
      if (left <= 0) return;
      from.addScaledVector(st.dir, hit.distance + 0.25);
    }
  }

  /** Writes the middle of `enemy`'s head into `out`. Anything without a head offers its chest. */
  private headOf(enemy: EnemyInstance, out: THREE.Vector3): THREE.Vector3 {
    const rig = enemy.char.rig;
    for (let i = 0; i < rig.bones.length; i++) {
      const def = rig.bones[i]!;
      if (def.name !== 'head') continue;
      const hit = def.hit;
      if (!hit) break;
      out.set((hit.from[0] + hit.to[0]) / 2, (hit.from[1] + hit.to[1]) / 2, (hit.from[2] + hit.to[2]) / 2);
      return enemy.char.bones[i]!.localToWorld(out);
    }
    return out.copy(enemy.center);
  }

  private boneIndex(enemy: EnemyInstance, name: string): number {
    const bones = enemy.char.rig.bones;
    for (let i = 0; i < bones.length; i++) if (bones[i]!.name === name) return i;
    return 0;
  }

  /** The Judge's signature: the slug leaves one skull for the next. Each hop is a real headshot. */
  private hopHeads(from: THREE.Vector3, first: EnemyInstance, hops: number, damage: number, spec: ShotSpec): void {
    const c = this.ctx;
    const seen = this.hopHit;
    seen.length = 0;
    seen.push(first);
    const at = this.vD.copy(from);
    const head = this.vE;
    let dealt = damage;
    for (let i = 0; i < hops; i++) {
      const target = this.nearestVisible(at, TUNING.judge.ricochetRange, seen, head);
      if (!target) return;
      seen.push(target);
      dealt *= TUNING.judge.ricochetDamage;
      this.headOf(target, head);
      const dir = this.vF.subVectors(head, at).normalize();
      if (spec.tracer) c.fx.tracer(at, head, spec.tracer);
      this.play('revolver_ricochet', at);
      c.fx.sparks(at, dir, 8, 0xffee88);
      const o = this.strikeOptions(spec.type ?? 'bullet', spec.source);
      o.force = spec.force ?? 0;
      o.severMult = spec.severMult ?? 1;
      o.headshotMult = spec.headshotMult ?? 2;
      this.strike(target, head, this.vA.copy(dir).negate(), dir, this.boneIndex(target, 'head'), 'head', dealt, o);
      this.feel.stop(HIT_STOP.judgeHeadshot, true);
      at.copy(head);
    }
  }

  private nearestVisible(from: THREE.Vector3, range: number, skip: EnemyInstance[], scratch: THREE.Vector3): EnemyInstance | null {
    const c = this.ctx;
    const n = c.enemies.query(from, range, this.hopList) || 0;
    let best: EnemyInstance | null = null;
    let bestD = Infinity;
    for (let i = 0; i < n; i++) {
      const e = this.hopList[i]!;
      if (!e.alive || skip.includes(e)) continue;
      const d = from.distanceToSquared(e.center);
      if (d >= bestD) continue;
      this.headOf(e, scratch);
      const dist = from.distanceTo(scratch);
      const dir = this.vB.subVectors(scratch, from).divideScalar(Math.max(dist, 1e-4));
      if (c.physics.raycast(from, dir, dist, CG.World)) continue;
      best = e;
      bestD = d;
    }
    return best;
  }

  /** A bounce off a body. Returns true when it landed on another enemy. */
  private hopNearest(st: RayState, from: HitSlot, damage: number, spec: ShotSpec, left: number): boolean {
    const c = this.ctx;
    const seen = this.hopHit;
    seen.length = 0;
    seen.push(from.enemy);
    const at = this.vD.copy(from.point);
    let dealt = damage;
    let hopped = false;
    for (let i = 0; i <= left; i++) {
      const target = this.nearestVisible(at, 24, seen, this.vE);
      if (!target) break;
      seen.push(target);
      const to = this.vE.copy(target.center);
      const dir = this.vF.subVectors(to, at).normalize();
      if (spec.tracer) c.fx.tracer(at, to, spec.tracer);
      this.play('ricochet', at, 0.8, 0.08);
      const o = this.strikeOptions(spec.type ?? 'bullet', spec.source);
      o.force = spec.force ?? 0;
      o.severMult = spec.severMult ?? 1;
      this.strike(target, to, this.vA.copy(dir).negate(), dir, undefined, undefined, dealt, o);
      at.copy(to);
      dealt *= 0.8;
      hopped = true;
    }
    if (hopped) st.from.copy(at);
    return hopped;
  }

  /** Shock Rounds: a bolt from the struck enemy to its nearest neighbours. */
  private arc(from: THREE.Vector3, first: EnemyInstance, damage: number, spec: ShotSpec): void {
    const c = this.ctx;
    const n = c.enemies.query(from, SHOCK.range, this.hopList) || 0;
    let struck = 0;
    for (let i = 0; i < n && struck < SHOCK.targets; i++) {
      const e = this.hopList[i]!;
      if (e === first || !e.alive) continue;
      struck++;
      const to = this.vE.copy(e.center);
      const dir = this.vF.subVectors(to, from).normalize();
      c.fx.arc(from, to, 0x88ddff);
      const o = this.strikeOptions('shock', spec.source);
      o.quiet = true;
      this.strike(e, to, this.vA.copy(dir).negate(), dir, undefined, undefined, damage, o);
    }
    if (struck > 0) this.play('lightning_arc', from, 0.7, 0.1);
  }

  private impact(point: THREE.Vector3, normal: THREE.Vector3, surface: SurfaceKind, scale: number): void {
    this.ctx.fx.impact(point, normal, surface, scale);
    this.play(SURFACE_SOUND[surface], point, 0.9, 0.06);
  }

  private enemyRay(st: RayState, spec: ShotSpec): void {
    const c = this.ctx;
    const r = st.result;
    const max = spec.maxDistance ?? MAX_RANGE;
    const wall = c.physics.raycast(st.origin, st.dir, max, CG.World);
    const limit = wall ? wall.distance : max;
    st.end.copy(st.origin).addScaledVector(st.dir, limit);

    const player = c.player;
    if (player.alive) {
      const eye = player.eye;
      const hit = closestSegmentPoints(st.origin, st.end, player.position, eye);
      if (hit.dist2 < PLAYER_RADIUS * PLAYER_RADIUS) {
        st.end.copy(st.origin).addScaledVector(st.dir, limit * hit.s);
        r.hitEnemy = true;
        const guard = this.guard(st.dir);
        if (spec.tracer) c.fx.tracer(st.from, st.end, spec.tracer);
        if (guard !== 'none') {
          this.deflected(st.end, st.dir, spec.damage, guard);
          return;
        }
        player.takeDamage({ amount: spec.damage, from: st.origin, type: 'bullet', source: spec.source });
        return;
      }
      if (hit.dist2 < WHIZZ_RADIUS * WHIZZ_RADIUS && hit.s > 0.02 && hit.s < 0.98) {
        this.play('bullet_whizz', this.vA.copy(st.origin).addScaledVector(st.dir, limit * hit.s), 0.7, 0.1);
      }
    }
    if (spec.tracer) c.fx.tracer(st.from, st.end, spec.tracer);
    if (wall) {
      c.fx.impact(wall.point, wall.normal, wall.surface, 0.7);
      this.play(SURFACE_SOUND[wall.surface], wall.point, 0.7, 0.08);
      c.world.objects?.damageExplosive(wall.collider, spec.damage, spec.source);
    }
  }

  /** Asks the sword whether it took the shot. */
  guard(incoming: THREE.Vector3): GuardResult {
    const g = this.ctx.weapons as unknown as Partial<Guard>;
    return g.guard?.(incoming) ?? 'none';
  }

  /**
   * A blocked shot stops dead with sparks. A parried one goes back along the crosshair, so good
   * timing plus good aim sends it into whoever you are looking at.
   */
  deflected(point: THREE.Vector3, incoming: THREE.Vector3, damage: number, guard: GuardResult): void {
    const c = this.ctx;
    this.play('sword_deflect', undefined, 1, 0.08);
    c.fx.sparks(point, this.vA.copy(incoming).negate(), guard === 'parry' ? 24 : 10, 0xfff2cc);
    if (guard !== 'parry') {
      this.feel.shake(0.01);
      return;
    }
    this.feel.shake(0.03);
    this.feel.stop(HIT_STOP.parry, true);
    c.render.post.chromatic(0.25, 0.12);
    this.fireRay(c.player.eye, c.player.forward, {
      damage: Math.max(damage, 15) * SWORD.windup.parryDamage,
      source: 'sword_deflect',
      team: 'player',
      tracer: 'heavy',
      tracerFrom: point,
      force: 40,
      headshotMult: 2,
    });
  }

  enemyMuzzle(position: THREE.Vector3, dir: THREE.Vector3, kind: MuzzleKind): void {
    const c = this.ctx;
    c.fx.muzzleFlash(position, dir, kind);
  }

  spawnProjectile(spec: ProjectileSpec): void {
    if (spec.kind === 'flame') {
      this.flames.spawn(spec);
      return;
    }
    this.projectiles.spawn(spec);
  }

  // -------------------------------------------------------------------------------------------
  // Explosions
  // -------------------------------------------------------------------------------------------

  explode(position: THREE.Vector3, spec: ExplosionSpec): void {
    // A blast that sets off another blast waits its turn: it keeps this one's scratch intact, and a
    // short ripple through a stack of barrels looks far better than one big pop.
    if (this.exploding) {
      // The map already showed its explosive going off, so its damage should not trail the flash.
      this.enqueueBlast(position, spec, spec.worldObject ? 0 : CHAIN_DELAY);
      return;
    }
    this.exploding = true;
    try {
      this.blast(position, spec);
    } finally {
      this.exploding = false;
    }
  }

  private enqueueBlast(position: THREE.Vector3, spec: ExplosionSpec, delay: number): void {
    if (this.queueLen >= MAX_QUEUED_BLASTS) return;
    const q = this.queue[this.queueLen++]!;
    q.at = this.ctx.time.elapsed + delay;
    q.position.copy(position);
    q.hasNormal = !!spec.normal;
    if (spec.normal) q.normal.copy(spec.normal);
    copyBlast(q.spec, spec);
  }

  private drainBlasts(): void {
    const now = this.ctx.time.elapsed;
    for (let i = 0; i < this.queueLen;) {
      const q = this.queue[i]!;
      if (q.at > now) {
        i++;
        continue;
      }
      const position = this.vA.copy(q.position);
      const hasNormal = q.hasNormal;
      const normal = this.vB.copy(q.normal);
      const spec = this.scratchChain;
      copyBlast(spec, q.spec);
      spec.normal = hasNormal ? normal : undefined;
      this.queueLen--;
      this.queue[i] = this.queue[this.queueLen]!;
      this.queue[this.queueLen] = q;
      this.explode(position, spec);
    }
  }

  private readonly scratchChain: ExplosionSpec = { radius: 0, damage: 0, kind: 'rocket', source: '', team: 'player' };

  private blast(position: THREE.Vector3, spec: ExplosionSpec): void {
    const c = this.ctx;
    const def = EXPLOSIONS[spec.kind];
    const radius = spec.radius;
    const id = ++this.explosionSerial;
    const center = this.blastCenter.copy(position);

    if (!spec.worldObject) {
      const look = this.fxBlast;
      look.radius = radius;
      look.kind = spec.kind;
      look.scale = spec.scale;
      look.normal = spec.normal;
      c.fx.explosion(center, look);
      for (let i = 0; i < def.sounds.length; i++) this.sound(def.sounds[i]!, center);
    }
    const hit = this.blastEnemies(center, spec, id);
    c.enemies.vehicles?.blast(center, spec);
    // After the damage, so a body this blast kills is thrown by it like any other, and not only the bodies already dead.
    c.physics.radialImpulse(center, radius * 1.35, def.impulse * radius);
    this.blastPlayer(center, spec);
    this.projectiles.caughtInBlast(center, radius);
    if (!spec.worldObject) c.world.objects?.damageExplosivesInRadius(center, radius, spec.damage, spec.source);

    // A parked body feels nothing, and the player's eyes are up in a seat, not beside it.
    const eyeDist = c.player.parked ? Infinity : c.player.eye.distanceTo(center);
    const reach = clamp(1 - Math.max(0, eyeDist - radius) / def.shakeRange);
    const closeness = reach * reach;
    this.feel.shake((spec.shake ?? def.shake) * closeness);
    if (def.fovPunch > 0 && closeness > 0.05) c.camera.fovPunch(def.fovPunch * closeness, 0.18);
    if (def.flash > 0 && closeness > 0.2) c.render.post.flash(0xffcc88, def.flash * closeness, 0.14);

    if (hit.count > 0) c.hud.hitMarker(hit.kills > 0 ? 'kill' : 'body');
    const near = closeness > 0.5 && def.fovPunch > 0 ? HIT_STOP.explosionNear : 0;
    const stop = Math.min(HIT_STOP.explosionMax, near + hit.kills * HIT_STOP.explosionKills);
    if (stop > 0 && spec.team === 'player' && !def.noKillStop) this.feel.stop(stop);
  }

  private readonly blastTally = { count: 0, kills: 0 };
  private readonly fxBlast: ExplosionOptions = { radius: 0 };

  private blastEnemies(center: THREE.Vector3, spec: ExplosionSpec, id: number): { count: number; kills: number } {
    const c = this.ctx;
    const def = EXPLOSIONS[spec.kind];
    const tally = this.blastTally;
    tally.count = tally.kills = 0;
    const radius = spec.radius;
    const list = this.blastList;
    const n = c.enemies.query(center, radius + 1.5, list) || 0;
    const foot = this.vD;
    const head = this.vE;
    const dir = this.vF;
    for (let i = 0; i < n; i++) {
      const e = list[i]!;
      if (!e.alive) continue;
      // Measured to the nearest part of the body, not the feet. The first game's feet test meant a
      // blast at chest height did less than one on the floor.
      foot.copy(e.position);
      head.copy(e.position);
      head.y += e.char.rig.height;
      const near = closestOnSegment(center, foot, head, dir);
      const dist = near.distanceTo(center);
      if (dist > radius) continue;
      if (!def.ignoresCover && !this.canReach(center, e)) continue;

      const falloff = 1 - (dist / radius) * (1 - def.edgeDamage);
      let amount = spec.instakill ? 99999 : spec.damage * falloff;
      if (spec.team === 'enemy') amount *= def.friendlyFire;
      const charge = SHAPED_CHARGE[spec.kind];
      if (charge && e.armor > 0) amount = Math.min(amount, charge.most) * charge.splash;

      dir.subVectors(e.center, center);
      dir.y += 0.6;
      dir.normalize();
      const o = this.strikeOptions('explosive', spec.source);
      o.force = TUNING.blastForce * def.impulse * radius * falloff;
      o.severMult = spec.team === 'player' && c.weapons.modifiers.alwaysSever ? 1000 : 1.5;
      o.reach = dist / radius;
      o.blastKind = spec.kind;
      o.explosionId = id;
      o.quiet = true;
      const res = this.strike(e, e.center, UP, dir, undefined, undefined, amount, o);
      tally.count++;
      if (res.blocked) continue;
      if (e.machine) c.fx.sparks(e.center, dir, 24);
      else c.fx.bloodHit(e.center, dir, 0.8);
      if (res.killed) {
        tally.kills++;
        if (Math.random() < 0.5) this.play('enemy_explode', e.center);
      } else {
        this.play(e.machine ? 'machine_hit' : 'enemy_hit', e.center, 0.8, 0.05);
      }
    }
    return tally;
  }

  /** Line of sight from a blast to either end of a body, so a sliver of cover does not save a target. */
  private canReach(center: THREE.Vector3, e: EnemyInstance): boolean {
    const c = this.ctx;
    const to = this.vA.copy(e.center);
    const dir = this.vB.subVectors(to, center);
    let dist = dir.length();
    if (dist < 0.05) return true;
    dir.divideScalar(dist);
    if (!c.physics.raycast(center, dir, dist, CG.World)) return true;
    to.copy(e.position);
    to.y += 0.3;
    dir.subVectors(to, center);
    dist = dir.length();
    if (dist < 0.05) return true;
    dir.divideScalar(dist);
    return !c.physics.raycast(center, dir, dist, CG.World);
  }

  private blastPlayer(center: THREE.Vector3, spec: ExplosionSpec): void {
    const c = this.ctx;
    const player = c.player;
    if (!player.alive) return;
    const def = EXPLOSIONS[spec.kind];
    const near = closestOnSegment(center, player.position, player.eye, this.vD);
    const dist = near.distanceTo(center);
    const radius = spec.radius;
    if (dist > radius) return;
    const dir = this.vB.subVectors(near, center);
    if (dist > 0.05) {
      dir.divideScalar(dist);
      if (!def.ignoresCover && c.physics.raycast(center, dir, dist, CG.World)) return;
    } else {
      dir.set(0, 1, 0);
    }

    const falloff = 1 - (dist / radius) * (1 - def.edgeDamage);
    // The cap is a mercy for the player's own blasts. An enemy rocket hits as hard as its spec says.
    const own = spec.team === 'player';
    const fraction = own ? spec.selfDamage ?? def.selfDamage : 1;
    const raw = spec.damage * falloff * fraction;
    const amount = own ? Math.min(raw, def.selfCap) : raw;
    if (amount > 0) player.takeDamage({ amount, from: center, type: 'explosive', source: spec.source });

    const push = (spec.playerPush ?? def.playerPush) * (1 - (dist / radius) * 0.65);
    if (push < 0.5) return;
    // Biased upward: a blast at your feet is a jump, and a blast in a wall still lifts you off the floor.
    dir.y += 0.45;
    dir.normalize();
    const v = this.vE.copy(dir).multiplyScalar(push);
    v.y += Math.max(player.velocity.y, 0);
    player.launch(v);
  }
}

/** True for a body the round that owns `list` has already struck. */
function wasStruck(list: StruckList, enemy: EnemyInstance): boolean {
  for (let i = 0; i < list.count; i++) if (list.enemies[i] === enemy) return true;
  return false;
}

/** Damage a round keeps at `distance`, by its falloff: all of it to `from`, `floor` of it from `to` on. */
export function rangeFalloff(f: NonNullable<ShotSpec['falloff']>, distance: number): number {
  if (distance <= f.from) return 1;
  if (distance >= f.to) return f.floor;
  return 1 - (1 - f.floor) * ((distance - f.from) / (f.to - f.from));
}

/** The puff on the far side of a wall, by what the wall is made of. */
const EXIT_DUST: Record<SurfaceKind, number> = {
  concrete: 0xb8b0a4, metal: 0x8a8d92, grate: 0x8a8d92, dirt: 0x8a7458, glass: 0xd8e4ea, flesh: 0x7a1010, armor: 0x8a8d92,
  energy: 0x88ddff, lava: 0xff7733,
};

const NO_DAMAGE: DamageResult = { dealt: 0, killed: false, headshot: false, severed: [], blocked: false };

