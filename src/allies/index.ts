/**
 * Allies: friendly soldiers who hold an area, follow on E, fight what they see, go down and get revived. Outpost Defense piece 2
 * (docs/proposals/outpost-defense.md) and the hive mission's Bailiffs (docs/notes/hive-mission-plan.md, stage 2). docs/notes/allies.md.
 *
 *   data.ts    types, guns, the squad's numbers
 *   rules.ts   the rules as arithmetic: follow slots, the crosshair, the E key, what a hit does
 *   ally.ts    one man
 *   fire.ts    their guns, which only ever test the enemy
 *   orders.ts  the E key
 *   props.ts   the pack, the beacon and the bands that say "ours"
 *
 * They wear the enemy's soldier bodies and walk on the enemy's steering (`updateMovement`), routes and cover map, and take hits
 * through the wound system's zones and `Injuries`. They are not in `enemies.alive`, so `Combat` never sees them: the player's
 * rounds and blasts pass through (fact 11), and a line through one gets a green spark and CHECK FIRE. Enemy soldiers turn on
 * them through `Soldier.foe` (src/enemies/outpost/weapons.ts).
 */
import * as THREE from 'three';
import { CG, type Ctx, type DamageInfo, type DamageType, type GameSystem } from '../core/contracts';
import type { EnemyInstance } from '../core/gameplay';
import type { GoreRegion } from '../characters/rig';
import { clamp, damp, dampAngle, rand, randInt, TAU } from '../core/math';
import { DEV_TOOLS } from '../core/devflags';
import { Pool } from '../core/pool';
import { PlayerSense, type AiWorld } from '../enemies/aiWorld';
import { ENEMIES } from '../enemies/data';
import type { Director } from '../enemies/director';
import type { Enemy } from '../enemies/Enemy';
import type { EnemyManager } from '../enemies/EnemyManager';
import { updateMovement } from '../enemies/movement';
import { CoverMap, type CoverSpot, type SpotQuery, type SpotReading } from '../enemies/outpost/cover';
import { RouteFinder, type NavGrid } from '../enemies/outpost/routes';
import { soldierOf } from '../enemies/outpost/soldier';
import type { Telegraphs } from '../enemies/telegraph';
import { WoundTuning, ZONES } from '../enemies/wounds/rules';
import { resolveZone, type ZoneHit } from '../enemies/wounds/zones';
import type { PostureName } from '../characters/animation/postures';
import { Ally, type Order } from './ally';
import { ALLY, ALLY_DOWN_COLOR, ALLY_ORDER, ALLY_TEXT, ALLY_TYPES, CHECK_FIRE_TEXT, type AllyType } from './data';
import './events';
import { AllyGuns } from './fire';
import { AllyLab } from './lab';
import { Orders } from './orders';
import { AllyProps } from './props';
import { followSlot, prefersAlly, revive, takeHit } from './rules';

export { ALLY_SOURCE, ALLY_TYPES, type AllyType } from './data';
export type { Ally } from './ally';

declare module '../core/contracts' {
  interface Ctx {
    /** Friendly soldiers. Optional: a stand-in context may not have them. */
    allies?: AllySystem;
  }
}

/** Ally bodies take uids from here, so a cover spot they claim never reads as an enemy's. */
const UID_BASE = 1_000_000;
const WAYPOINT = 0.7;
const STALL_SECONDS = 1.2;
const STALL_METRES = 0.4;
const DOWN_TAG = 'MAN DOWN';
const LOD_NEAR = 26;
const LOD_FAR = 60;
/** Seconds one blast flinches a man, and what share of its radius reaches him. */
const BLAST_REACH = 0.9;
const MAX_CANDIDATES = 6;
/** A down tag shows within this, so a fight's worth of them do not cover the screen. */
const TAG_RANGE = 70;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _slot = { x: 0, z: 0 };
const _reading: SpotReading = { hidden: false, canShoot: false, side: 0 };
const _zone: ZoneHit = { zone: 'thigh', side: 0, behind: false, glancing: false };
const UP = new THREE.Vector3(0, 1, 0);

export interface AllyRayHit {
  ally: Ally;
  distance: number;
  point: THREE.Vector3;
}

interface Posed {
  setPosture?(name: PostureName): void;
}

export class AllySystem implements GameSystem {
  readonly allies: Ally[] = [];
  readonly props: AllyProps;
  /** A riot line's mark: the gap they block, and which way is out. */
  breach: { point: THREE.Vector3; yaw: number } | null = null;
  /** Milliseconds this system took last frame, for the bench. */
  cpuMs = 0;

  /** Cleared when handed out, not when given back: whoever still holds a dead man reads him as dead. */
  private readonly pool = new Pool<Ally>(() => new Ally());
  private readonly sense = new PlayerSense();
  private readonly w: AiWorld;
  private readonly bodies: Enemy[] = [];
  private readonly guns: AllyGuns;
  private readonly orders: Orders;
  private routes: RouteFinder | null = null;
  private cover: CoverMap | null = null;
  private uid = UID_BASE;
  private foeAt = 0;
  private foeCursor = 0;
  private foesSet = false;
  private checkFireAt = -99;
  private readonly candidates: EnemyInstance[] = [];
  private readonly ranked: EnemyInstance[] = [];
  private readonly rankScore: number[] = [];
  private readonly downTags = new Map<Ally, () => void>();
  private readonly query: SpotQuery = {
    anchor: new THREE.Vector3(), radius: 0, threat: new THREE.Vector3(), near: 0, far: 0, bearing: Number.NaN, bearingSlack: 0,
    needShot: true, spacing: 1.6, uid: 0, from: new THREE.Vector3(), height: 0, anyFloor: false,
  };
  private readonly loco = { speed: 0, moveX: 0, moveZ: 0, aimYaw: 0, aimPitch: 0, grounded: true };
  private readonly hurtInfo: DamageInfo = { amount: 0, type: 'bullet', point: new THREE.Vector3(), dir: new THREE.Vector3(), force: 0, source: '' };

  constructor(private readonly ctx: Ctx) {
    this.props = new AllyProps(ctx);
    // Steering reads a director only for its wall probe and ledge leaps, which allies never use (`probeAt`, `footbound`).
    const director = { spendRay: () => false } as unknown as Director;
    this.w = { ctx, director, telegraphs: null as unknown as Telegraphs, get enemies() { return ctx.enemies as unknown as EnemyManager; }, player: this.sense, now: 0 };
    this.guns = new AllyGuns(ctx, (point, radius, damage, source) => this.hostileBlast(point, radius, damage, source));
    this.orders = new Orders(ctx, this);
  }

  private get enemies(): EnemyManager {
    return this.ctx.enemies as unknown as EnemyManager;
  }

  /** The player's stims (progression/stims.ts), or null on a page that has none: then a revive is free. */
  get stims(): { count: number; spend(): boolean } | null {
    return (this.ctx.progression as unknown as { stims?: { count: number; spend(): boolean } }).stims ?? null;
  }

  /** Metres to the man E would address now, or Infinity. For anything else that wants E. */
  get focusDistance(): number {
    return this.orders.focusDistance;
  }

  init(): void {
    const { events, physics } = this.ctx;
    events.on('weapon:fired', f => this.checkFire(f.origin, f.dir));
    // A body handed to anyone comes back with nothing of ours on it.
    events.on('enemy:spawned', e => this.props.strip(e.enemy.char));
    physics.radialListeners.add((center, radius) => this.flinchFromBlast(center, radius));
    if (DEV_TOOLS) new AllyLab(this.ctx, this).install();
  }

  reset(): void {
    for (let i = this.allies.length - 1; i >= 0; i--) this.release(this.allies[i]!, true);
    this.allies.length = 0;
    this.bodies.length = 0;
    this.breach = null;
    this.guns.reset();
    this.orders.reset();
    this.clearFoes();
    this.cover?.release();
  }

  // -------------------------------------------------------------------------------------------
  // The map's routes and cover: the Outpost's when it runs, our own otherwise
  // -------------------------------------------------------------------------------------------

  private prepare(): boolean {
    if (this.routes) return true;
    const nav = this.ctx.world.nav as unknown as NavGrid;
    if (!nav?.nodeCount) return false;
    const o = this.enemies.outpost;
    if (o?.routes.ready) {
      this.routes = o.routes;
      this.cover = o.cover;
      return true;
    }
    this.routes = new RouteFinder();
    this.routes.build(nav);
    this.cover = new CoverMap(this.ctx.physics);
    this.cover.build(nav);
    return true;
  }

  // -------------------------------------------------------------------------------------------
  // Spawning and orders
  // -------------------------------------------------------------------------------------------

  /** One man at `at`, holding a post there (or at `post`) of `radius`. Null past the cap or off the map. */
  spawn(type: AllyType, at: THREE.Vector3, post?: THREE.Vector3, radius: number = ALLY.postRadius, yaw = Number.NaN): Ally | null {
    if (this.allies.length >= ALLY.maxAlive || !this.prepare()) return null;
    const { ctx } = this;
    const def = ALLY_TYPES[type];
    const a = this.pool.get();
    a.clear();
    const e = a.body;
    e.reset();
    const char = ctx.characters.spawn(def.body);
    e.uid = ++this.uid;
    e.id = def.body;
    e.def = ENEMIES[def.body];
    e.char = char;
    e.alive = true;
    e.position.copy(at);
    e.groundY = at.y;
    e.groundSampleAt.set(at.x, at.z);
    e.lastProgress.copy(at);
    e.mode = 'hold';
    e.face = 'move';
    e.footbound = true;
    e.probeAt = Infinity;
    e.speedMul = rand(0.95, 1.05);
    e.shield = def.shield === true;
    e.yaw = Number.isNaN(yaw) ? ctx.player.yaw + Math.PI : yaw;
    ctx.render.scene.add(char.root);
    this.props.fit(char);
    a.type = type;
    a.def = def;
    a.maxHealth = a.health = def.hp;
    a.post.copy(post ?? at);
    a.postRadius = radius;
    a.postYaw = yaw;
    a.dest.copy(a.post);
    a.mag = def.gun.mag;
    a.stims = def.medic?.stims ?? 0;
    a.seat = this.allies.length;
    a.thinkAt = ctx.time.elapsed + rand(0, ALLY.think);
    a.shotAt = (from, damage, miss, source) => this.shotAt(a, from, damage, miss, source);
    a.blast = (at2, r, damage, delay, source) => this.guns.incoming(at2, r, damage, delay, source, this.ctx.time.elapsed);
    this.allies.push(a);
    this.bodies.push(e);
    this.place(a);
    return a;
  }

  /**
   * A squad of `count`, stood round `center` and posted in an arc `ahead` metres out along `yaw`, each with his own patch.
   * Types run rifleman, machine gunner, rifleman, medic, sniper, shotgunner, rocketeer, riot, unless `types` says otherwise.
   */
  spawnSquad(count: number, center: THREE.Vector3, yaw: number, ahead = 7, types?: readonly AllyType[]): Ally[] {
    const order: readonly AllyType[] = types ?? ['rifleman', 'gunner', 'rifleman', 'medic', 'sniper', 'shotgunner', 'rocketeer', 'riot'];
    const n = Math.min(count, ALLY.squadMax);
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const out: Ally[] = [];
    const nav = this.ctx.world.nav;
    for (let i = 0; i < n; i++) {
      const type = order[i % order.length]!;
      const across = (i - (n - 1) / 2) * 3.4;
      const back = type === 'sniper' || type === 'medic' ? -5 : type === 'shotgunner' || type === 'riot' ? -2 : 0;
      _a.set(center.x + fx * (ahead + back) - fz * across, center.y + 1, center.z + fz * (ahead + back) + fx * across);
      if (!nav.nearest(_a, 6, _b)) continue;
      _a.set(center.x - fz * across * 0.5 - fx * 1.5, center.y + 1, center.z + fx * across * 0.5 - fz * 1.5);
      const at = nav.nearest(_a, 6, _dir) ? _dir : _b;
      const a = this.spawn(type, at.clone(), _b.clone(), type === 'shotgunner' ? 4 : 5, yaw);
      if (a) out.push(a);
    }
    return out;
  }

  setOrder(a: Ally, order: Order): void {
    if (a.state !== 'up' || a.order === order) return;
    a.order = order;
    a.thinkAt = 0;
    a.patrolAt = 0;
    this.ctx.hud.floatText(_a.copy(a.body.center).setY(a.body.center.y + 1.1), order === 'follow' ? 'ON ME' : 'HOLDING POST', ALLY_TEXT);
    this.ctx.events.emit('ally:order', { ally: a, order });
  }

  toggle(a: Ally): void {
    this.setOrder(a, a.order === 'follow' ? 'post' : 'follow');
    this.ctx.audio.play('ui_confirm', { volume: 0.6 });
  }

  /** Anyone still on his post: everyone follows. Everyone already following: back to posts. */
  toggleSquad(): void {
    let posted = false;
    for (const a of this.allies) if (a.state === 'up' && a.order === 'post') posted = true;
    const order: Order = posted ? 'follow' : 'post';
    for (const a of this.allies) this.setOrder(a, order);
    this.ctx.hud.feed(order === 'follow' ? 'SQUAD: ON ME' : 'SQUAD: BACK TO POSTS', ALLY_TEXT);
    this.ctx.audio.play('ui_confirm', { volume: 0.8 });
  }

  /** The riot line's gap. `yaw` is which way is out, toward the attackers. */
  markBreach(point: THREE.Vector3, yaw: number): void {
    this.breach = { point: point.clone(), yaw };
    for (const a of this.allies) if (a.def.stance === 'line') a.thinkAt = 0;
  }

  clearBreach(): void {
    this.breach = null;
  }

  /** The player's own stim into a downed man. False if he has none, or the man is not down. */
  playerRevive(a: Ally): boolean {
    const kit = this.stims;
    if (a.state !== 'down') return false;
    if (kit && !kit.spend()) {
      this.ctx.audio.play('ui_error');
      this.ctx.hud.feed('NO STIMS', ALLY_TEXT);
      return false;
    }
    this.reviveAlly(a);
    return true;
  }

  // -------------------------------------------------------------------------------------------
  // Frame
  // -------------------------------------------------------------------------------------------

  update(): void {
    const t0 = performance.now();
    const { ctx, w } = this;
    const dt = ctx.time.dt;
    const now = ctx.time.elapsed;
    w.now = now;
    this.sensePlayer();
    this.orders.update(ctx.time.playerDt ?? dt);
    if (this.allies.length === 0) {
      if (this.foesSet) this.clearFoes();
      this.cpuMs = 0;
      return;
    }
    if (now >= this.foeAt) this.assignFoes(now);
    for (let i = this.allies.length - 1; i >= 0; i--) {
      const a = this.allies[i]!;
      if (a.state === 'down') this.updateDown(a, now);
      else this.updateUp(a, dt, now);
      if (a.state === 'dead') continue;
      this.place(a);
      this.animate(a, dt);
    }
    this.guns.update(now);
    this.cpuMs = performance.now() - t0;
  }

  private sensePlayer(): void {
    const p = this.sense;
    const src = this.ctx.player;
    p.position.copy(src.position);
    p.eye.copy(src.eye);
    p.chest.copy(src.position);
    p.chest.y += 1;
    p.velocity.copy(src.velocity);
    p.forward.copy(src.forward);
    p.alive = src.alive;
  }

  private updateUp(a: Ally, dt: number, now: number): void {
    const e = a.body;
    const inj = a.injuries;
    if (inj.bleed > 0) {
      const lost = inj.bleed * a.maxHealth * dt;
      if (takeHit(a, lost, false) === 'down') this.goDown(a, now);
      if (a.state !== 'up') return;
    }
    if (now >= a.thinkAt) this.think(a, now);
    if (a.state !== 'up') return;
    this.steer(a, now);
    e.flowUntil = 0;
    updateMovement(e, this.w, dt, this.bodies);
    // A stalled point move asks for the flow field, which leads to the player. Ours handle their own stalls.
    if (e.flowUntil > now) {
      e.flowUntil = 0;
      this.reroute(a);
    }
    this.face(a, dt);
    this.shoot(a, now);
    this.posture(a, now);
  }

  // -------------------------------------------------------------------------------------------
  // Thinking: what to shoot, where to stand
  // -------------------------------------------------------------------------------------------

  private think(a: Ally, now: number): void {
    a.thinkAt = now + ALLY.think * rand(0.8, 1.2);
    if (a.patient && a.patient.state !== 'down') this.dropPatient(a);
    if (a.def.medic && !a.patient && a.stims > 0) this.findPatient(a);
    if (!a.patient) this.acquire(a, now);
    this.chooseDest(a, now);
  }

  /** The enemy's living, minus prisoners and the downed: nobody on our side finishes a man on the floor. */
  private shootable(e: EnemyInstance): boolean {
    if (!e.alive) return false;
    const s = soldierOf(e);
    return !s || (!s.surrendered && !s.downed && s.fate !== 'surrender');
  }

  private eye(a: Ally, out: THREE.Vector3): THREE.Vector3 {
    out.copy(a.body.position);
    out.y += a.body.def.eyeHeight;
    return out;
  }

  private clearLine(from: THREE.Vector3, to: THREE.Vector3): boolean {
    _dir.subVectors(to, from);
    const d = _dir.length();
    if (d < 0.3) return true;
    _dir.divideScalar(d);
    return !this.ctx.physics.raycast(from, _dir, d - 0.3, CG.World);
  }

  /** Scores the enemy he would rather shoot. Higher is better; -Infinity for never. */
  private rate(a: Ally, e: EnemyInstance, dist: number): number {
    const def = a.def;
    if (dist > def.gun.range) return -Infinity;
    let score = -dist;
    if (def.gun.closeBad > 0 && dist < def.gun.closeBad) score -= 30;
    if (def.stance === 'high') score += (e.id === 'sniper' || e.id === 'rocketeer' ? 25 : 0) + dist * 1.5;
    if (def.antiArmour) score += e.isBoss || e.id === 'brute' || e.id === 'juggernaut' ? 40 : 0;
    // The man the player is already on is his. Riflemen take what he is not shooting.
    _a.subVectors(e.center, this.ctx.player.eye).normalize();
    if (_a.dot(this.ctx.player.forward) > 0.985) score -= 8;
    if (e === a.target) score += 6;
    return score;
  }

  private acquire(a: Ally, now: number): void {
    const { enemies } = this;
    const def = a.def;
    const eye = this.eye(a, _b);
    a.hasArmour = false;
    if (def.antiArmour && this.findArmour(a, eye)) {
      a.target = null;
      a.seenAt = now;
      return;
    }
    const n = enemies.query(a.body.position, def.gun.range, this.candidates);
    const ranked = this.ranked;
    const score = this.rankScore;
    ranked.length = score.length = 0;
    for (let i = 0; i < n; i++) {
      const e = this.candidates[i]!;
      if (!this.shootable(e)) continue;
      const s = this.rate(a, e, e.position.distanceTo(a.body.position));
      if (!Number.isFinite(s)) continue;
      let at = Math.min(ranked.length, MAX_CANDIDATES - 1);
      if (ranked.length === MAX_CANDIDATES && s <= score[at]!) continue;
      if (ranked.length < MAX_CANDIDATES) ranked.length = score.length = ranked.length + 1;
      while (at > 0 && score[at - 1]! < s) {
        ranked[at] = ranked[at - 1]!;
        score[at] = score[at - 1]!;
        at--;
      }
      ranked[at] = e;
      score[at] = s;
    }
    let rays: number = ALLY.raysPerThink;
    for (let i = 0; i < ranked.length && rays > 0; i++) {
      const e = ranked[i]!;
      rays--;
      if (!this.clearLine(eye, e.center)) continue;
      a.target = e;
      a.seenAt = now;
      a.lastSeen.copy(e.center);
      return;
    }
    if (a.target && (!this.shootable(a.target) || now - a.seenAt > ALLY.memory)) a.target = null;
  }

  /** A rocketeer's first look is for a vehicle in range and in sight. */
  private findArmour(a: Ally, eye: THREE.Vector3): boolean {
    const v = this.enemies.vehicles;
    if (!v) return false;
    let best = a.def.gun.range;
    for (const car of v.live) {
      if (!car.alive) continue;
      const d = car.position.distanceTo(a.body.position);
      if (d >= best || d < a.def.gun.closeBad) continue;
      _a.copy(car.position);
      _a.y += 1.2;
      if (!this.clearLine(eye, _a)) continue;
      best = d;
      a.armour.copy(_a);
      a.hasArmour = true;
    }
    return a.hasArmour;
  }

  private findPatient(a: Ally): void {
    let best: Ally | null = null;
    let bestD: number = a.def.medic!.reach;
    for (const o of this.allies) {
      if (o === a || o.state !== 'down' || o.treatedBy) continue;
      const d = o.body.position.distanceTo(a.body.position);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    if (!best) return;
    a.patient = best;
    best.treatedBy = a;
    a.treatUntil = 0;
    a.target = null;
  }

  private dropPatient(a: Ally): void {
    if (a.patient?.treatedBy === a) a.patient.treatedBy = null;
    a.patient = null;
    a.treatUntil = 0;
  }

  /** Where his feet should go: the anchor his order gives him, and cover near it if he is in a fight. */
  private chooseDest(a: Ally, now: number): void {
    const p = this.ctx.player;
    const e = a.body;
    if (a.patient) {
      this.setDest(a, a.patient.body.position);
      return;
    }
    // The anchor: a slot behind the player, a place in the riot line, or the post.
    let radius = a.postRadius;
    const anchor = _a;
    if (a.order === 'follow') {
      let index = 0, count = 0;
      for (const o of this.allies) {
        if (o.state !== 'up' || o.order !== 'follow') continue;
        if (o === a) index = count;
        count++;
      }
      followSlot(index, count, p.position.x, p.position.z, p.forward.x, p.forward.z, _slot);
      anchor.set(_slot.x, p.position.y + 1, _slot.z);
      if (!this.ctx.world.nav.nearest(anchor, 4, anchor)) anchor.copy(p.position);
      radius = ALLY.followCover;
      e.pace = anchor.distanceTo(e.position) > ALLY.catchUp ? ALLY.runPace : 1.15;
    } else if (a.def.stance === 'line' && this.breach) {
      this.lineSlot(a, anchor);
      radius = 0;
      e.pace = 1.3;
    } else {
      anchor.copy(a.post);
      e.pace = a.target ? 1 : 0.6;
    }

    const threat = a.target ? a.target.position : a.hasArmour ? a.armour : null;
    if (threat && radius > 0 && this.cover) {
      const q = this.query;
      q.anchor.copy(anchor);
      q.radius = radius;
      q.threat.copy(threat);
      q.near = a.def.near;
      q.far = a.def.far;
      q.uid = e.uid;
      q.from.copy(e.position);
      q.height = a.def.height;
      const spot = this.keepSpot(a, threat) ?? this.cover.pick(q, _reading);
      if (spot !== a.spot) this.claim(a, spot);
      if (spot) {
        a.fireSide = _reading.side;
        const lean = _reading.side < 0 ? spot.leanLeft : _reading.side > 0 ? spot.leanRight : null;
        this.setDest(a, lean ?? spot.position);
        return;
      }
    } else if (!threat && a.spot) this.claim(a, null);

    if (threat) {
      // No cover: hold where he is if that is inside his ground, otherwise go to it.
      if (e.position.distanceTo(anchor) <= Math.max(radius, 1.5)) this.setDest(a, e.position);
      else this.setDest(a, anchor);
      return;
    }
    if (a.order === 'post' && (a.def.stance === 'patrol' || a.def.stance === 'guard') && radius > 0) {
      if (now < a.patrolAt && a.dest.distanceTo(a.post) <= radius + 0.5) return;
      a.patrolAt = now + rand(ALLY.patrolEvery[0], ALLY.patrolEvery[1]);
      const r = radius * (a.def.stance === 'guard' ? 0.5 : 1) * Math.sqrt(Math.random());
      const t = rand(0, TAU);
      _b.set(a.post.x + Math.sin(t) * r, a.post.y + 1, a.post.z + Math.cos(t) * r);
      if (this.ctx.world.nav.nearest(_b, 3, _b)) this.setDest(a, _b);
      return;
    }
    this.setDest(a, anchor);
  }

  /** The spot he has, while it still gives him a shot at the threat from inside his ground. */
  private keepSpot(a: Ally, threat: THREE.Vector3): CoverSpot | null {
    const s = a.spot;
    if (!s || !this.cover) return null;
    this.cover.read(s, threat, _reading);
    return _reading.canShoot ? s : null;
  }

  private claim(a: Ally, spot: CoverSpot | null): void {
    if (a.spot && a.spot.claimedBy === a.body.uid) a.spot.claimedBy = 0;
    a.spot = spot;
    if (spot) spot.claimedBy = a.body.uid;
  }

  /** Riot line: shields side by side across the gap, square to the way out. */
  private lineSlot(a: Ally, out: THREE.Vector3): void {
    const b = this.breach!;
    let index = 0, count = 0;
    for (const o of this.allies) {
      if (o.state !== 'up' || o.def.stance !== 'line' || o.order !== 'post') continue;
      if (o === a) index = count;
      count++;
    }
    const across = (index - (count - 1) / 2) * ALLY.lineGap;
    out.set(b.point.x + Math.cos(b.yaw) * across, b.point.y + 1, b.point.z - Math.sin(b.yaw) * across);
    if (!this.ctx.world.nav.nearest(out, 2, out)) out.copy(b.point);
  }

  private setDest(a: Ally, to: THREE.Vector3): void {
    if (a.dest.distanceTo(to) < 1.2 && a.route.count > 0) return;
    a.dest.copy(to);
    this.reroute(a);
  }

  private reroute(a: Ally): void {
    const e = a.body;
    if (!this.routes?.find(e.position, a.dest, a.route) || a.route.count === 0) {
      a.route.clear();
      a.route.push(a.dest.x, a.dest.y, a.dest.z);
    }
    a.route.next = 0;
    a.progressAt = this.w.now + STALL_SECONDS;
    a.progressFrom.copy(e.position);
  }

  // -------------------------------------------------------------------------------------------
  // Legs, eyes, hands
  // -------------------------------------------------------------------------------------------

  private steer(a: Ally, now: number): void {
    const e = a.body;
    const r = a.route;
    if (a.patient && a.body.position.distanceTo(a.patient.body.position) < ALLY.treatReach) {
      this.treat(a, now);
      e.mode = 'hold';
      return;
    }
    if (r.done) {
      e.mode = 'hold';
      return;
    }
    const last = r.next === r.count - 1;
    const d = Math.hypot(r.x[r.next]! - e.position.x, r.z[r.next]! - e.position.z);
    if (d < (last ? 0.4 : WAYPOINT)) {
      r.next++;
      if (r.done) {
        e.mode = 'hold';
        return;
      }
    }
    e.mode = 'point';
    e.moveTarget.set(r.x[r.next]!, r.y[r.next]!, r.z[r.next]!);
    if (now >= a.progressAt) {
      const moved = e.position.distanceTo(a.progressFrom);
      a.progressFrom.copy(e.position);
      a.progressAt = now + STALL_SECONDS;
      if (moved < STALL_METRES && e.stagger <= 0) {
        if (++a.stalls >= 3) {
          a.stalls = 0;
          if (this.ctx.world.nav.nearest(e.position, 3, _a)) {
            e.position.copy(_a);
            e.groundY = _a.y;
            e.groundSampleAt.set(_a.x, _a.z);
          }
        }
        this.reroute(a);
      } else a.stalls = 0;
    }
  }

  private aimPoint(a: Ally): THREE.Vector3 | null {
    if (a.hasArmour) return a.armour;
    return a.target ? a.target.center : null;
  }

  private face(a: Ally, dt: number): void {
    const e = a.body;
    const at = a.patient ? a.patient.body.position : this.aimPoint(a);
    if (at) {
      e.face = 'lock';
      e.yaw = dampAngle(e.yaw, Math.atan2(at.x - e.position.x, at.z - e.position.z), e.def.turn * 1.4, dt);
      return;
    }
    const moving = Math.hypot(e.velocity.x, e.velocity.z) > 0.5;
    if (moving) {
      e.face = 'move';
      return;
    }
    e.face = 'lock';
    // Standing: a riot line faces out, a follower faces where the player does, a post faces its own way.
    let yaw = a.postYaw;
    if (a.def.stance === 'line' && this.breach && a.order === 'post') yaw = this.breach.yaw;
    else if (a.order === 'follow') yaw = Math.atan2(this.ctx.player.forward.x, this.ctx.player.forward.z);
    if (!Number.isNaN(yaw)) e.yaw = dampAngle(e.yaw, yaw, e.def.turn * 0.6, dt);
  }

  private shoot(a: Ally, now: number): void {
    const at = this.aimPoint(a);
    const e = a.body;
    if (!at || a.patient || now - a.seenAt > ALLY.think * 2.5) {
      a.burstLeft = 0;
      return;
    }
    if (a.reloadUntil > 0) {
      if (now < a.reloadUntil) return;
      a.reloadUntil = 0;
      a.mag = a.def.gun.mag;
    }
    const g = a.def.gun;
    const moving = Math.hypot(e.velocity.x, e.velocity.z) > 0.8;
    if ((moving && !a.def.firesOnTheMove) || now < a.nextShotAt) return;
    // Turned far enough to have him in front.
    const want = Math.atan2(at.x - e.position.x, at.z - e.position.z);
    if (Math.abs(Math.atan2(Math.sin(want - e.yaw), Math.cos(want - e.yaw))) > 0.5) return;
    if (a.burstLeft <= 0) a.burstLeft = randInt(g.burst[0], g.burst[1]);
    const miss = a.injuries.aimNow(now) * (moving ? 1.8 : 1);
    if (!this.guns.fire(a, at, miss, now)) {
      a.nextShotAt = now + 0.3;
      return;
    }
    a.mag--;
    a.burstLeft--;
    a.nextShotAt = now + (a.burstLeft > 0 ? g.gap : this.guns.rest(g, at.distanceTo(e.position)));
    if (a.mag <= 0) {
      a.reloadUntil = now + g.reload;
      a.burstLeft = 0;
    }
  }

  private posture(a: Ally, now: number): void {
    const e = a.body;
    let want: PostureName = 'stand';
    const moving = Math.hypot(e.velocity.x, e.velocity.z) > 0.6;
    const engaged = this.aimPoint(a) !== null && now - a.seenAt < ALLY.memory;
    if (a.treatUntil > 0) want = 'revive';
    else if (engaged && !moving) {
      const firing = a.burstLeft > 0 || now >= a.nextShotAt - 0.15;
      if (a.spot && e.position.distanceTo(a.dest) < 0.8) {
        want = firing ? (a.fireSide < 0 ? 'leanLeft' : a.fireSide > 0 ? 'leanRight' : 'peek') : 'cover';
      // 'crouch', never 'kneel': that posture is a prisoner's, hands up.
      } else if (a.def.kneels) want = 'crouch';
    }
    if (a.injuries.hunched && (want === 'stand' || want === 'peek')) want = 'hunched';
    (e.char.anim as unknown as Posed).setPosture?.(want);
  }

  private place(a: Ally): void {
    const e = a.body;
    const root = e.char.root;
    root.position.copy(e.position);
    root.rotation.y = e.yaw;
    e.center.copy(e.position);
    e.center.y += a.state === 'down' ? 0.35 : e.def.chest;
  }

  private animate(a: Ally, dt: number): void {
    const e = a.body;
    const p = this.ctx.player.position;
    const dist = e.position.distanceTo(p);
    e.lod = dist < LOD_NEAR ? 0 : dist < LOD_FAR ? 1 : 2;
    const cos = Math.cos(e.yaw), sin = Math.sin(e.yaw);
    const vx = e.velocity.x, vz = e.velocity.z;
    const speed = a.state === 'down' ? 0 : Math.hypot(vx, vz);
    const l = this.loco;
    l.speed = speed;
    l.moveX = speed > 0.1 ? (vx * cos - vz * sin) / speed : 0;
    l.moveZ = speed > 0.1 ? (vx * sin + vz * cos) / speed : 0;
    const at = a.state === 'up' ? this.aimPoint(a) : null;
    if (at) {
      const dx = at.x - e.position.x, dz = at.z - e.position.z;
      let off = Math.atan2(dx, dz) - e.yaw;
      off = Math.atan2(Math.sin(off), Math.cos(off));
      l.aimYaw = clamp(off, -1.2, 1.2);
      l.aimPitch = clamp(Math.atan2(at.y - (e.position.y + e.def.eyeHeight), Math.hypot(dx, dz) || 1), -0.8, 0.8);
    } else l.aimYaw = l.aimPitch = 0;
    l.grounded = !e.airborne;
    e.char.anim.setLocomotion(l);
    e.char.anim.update(dt, e.lod);
    e.char.setLod?.(e.lod);
  }

  // -------------------------------------------------------------------------------------------
  // Hurt, down, revived, dead
  // -------------------------------------------------------------------------------------------

  /**
   * An enemy round at him: rolls where it goes, then tests the world and our bodies (his and anyone behind him) for it.
   * `miss` is the shooter's nerve and gun, about 1 for a steady rifleman.
   */
  private shotAt(a: Ally, from: THREE.Vector3, damage: number, miss: number, source: string): void {
    const { physics, fx } = this.ctx;
    const range = from.distanceTo(a.body.center);
    const radius = 0.3 + range * 0.022 * miss;
    _a.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize().multiplyScalar(radius * Math.sqrt(Math.random()));
    _a.add(a.body.center);
    _dir.subVectors(_a, from).normalize();
    const reach = range + 4;
    const wall = physics.raycast(from, _dir, reach, CG.World);
    const limit = wall ? wall.distance : reach;
    const hit = this.raycastBodies(from, _dir, limit, true);
    if (hit) {
      _b.copy(hit.point);
      const shield = hit.ally.def.shield && this.shieldStops(hit.ally, _dir);
      if (shield) fx.sparks(hit.point, _dir.clone().negate(), 6, 0xffee88);
      else this.hurt(hit.ally, damage, hit.point, _dir, hit.bone, hit.region, 'bullet', source);
    } else if (wall) {
      fx.impact(wall.point, wall.normal, wall.surface, 0.5);
      _b.copy(wall.point);
    } else _b.copy(from).addScaledVector(_dir, limit);
    fx.tracer(from, _b, 'enemy');
  }

  /** A riot shield takes what comes from the front half of him. */
  private shieldStops(a: Ally, dir: THREE.Vector3): boolean {
    return -(Math.sin(a.body.yaw) * dir.x + Math.cos(a.body.yaw) * dir.z) > 0.35;
  }

  /** An enemy rocket's burst, landed on allies only. The rocket itself already did the rest. */
  private hostileBlast(point: THREE.Vector3, radius: number, damage: number, source: string): void {
    for (let i = this.allies.length - 1; i >= 0; i--) {
      const a = this.allies[i]!;
      if (a.state === 'dead') continue;
      const d = a.body.center.distanceTo(point);
      if (d > radius || !this.clearLine(point, a.body.center)) continue;
      _dir.subVectors(a.body.center, point).add(UP).normalize();
      this.hurt(a, damage * (1 - (d / radius) * 0.5), a.body.center, _dir, undefined, 'chest', 'explosive', source);
    }
  }

  /** Any blast near him, ours included: he flinches from it and takes nothing. */
  private flinchFromBlast(center: THREE.Vector3, radius: number): void {
    for (const a of this.allies) {
      if (a.state !== 'up') continue;
      const d = a.body.center.distanceTo(center);
      if (d > radius * BLAST_REACH) continue;
      _dir.subVectors(a.body.center, center).normalize();
      a.body.char.anim.flinch(0, _dir, 0.6 * (1 - d / (radius * BLAST_REACH)));
    }
  }

  /**
   * What a hit does to him: the wound system's zones and `Injuries` price where it went, `takeHit` settles whether he stays up.
   * A head or heart hit is a hard hit rather than a death: he wears a helmet and he is worth reviving.
   */
  hurt(a: Ally, amount: number, point: THREE.Vector3, dir: THREE.Vector3, bone: number | undefined, region: GoreRegion, type: DamageType, source: string): void {
    if (a.state === 'dead' || amount <= 0) return;
    const { ctx } = this;
    const now = ctx.time.elapsed;
    const char = a.body.char;
    resolveZone(bone === undefined ? undefined : char.bones[bone], bone, region, point, dir, char.rig.height / 1.85, _zone);
    const rule = ZONES[_zone.zone];
    // The wound system kills on a head or heart hit. An ally's helmet and plate make those hits hard ones instead: he is
    // worth more alive, and a man the player can revive is the point of him.
    if (_zone.zone === 'head') amount *= _zone.glancing ? 0.6 : 1.6;
    else if (_zone.zone === 'heart') amount *= 2;
    if (a.state === 'up' && amount > a.maxHealth * WoundTuning.graze) {
      a.injuries.add(_zone.zone, _zone.side, bone ?? 0, 0, 0, 0, amount / a.maxHealth, type, amount);
      a.body.speedMul = Math.max(0.55, a.injuries.speed) * rand(0.95, 1.05);
    }
    const floors = (rule.floors === true && amount > a.maxHealth * WoundTuning.graze) || a.injuries.legDestroyed;
    const d = this.hurtInfo;
    d.amount = amount;
    d.type = type;
    d.point.copy(point);
    d.dir.copy(dir);
    d.source = source;
    d.region = region;
    d.bone = bone;
    ctx.gore.wound(char, d, amount / a.maxHealth);
    char.hitFlash(0.5);
    if (bone !== undefined) char.anim.flinch(bone, dir, 0.7);
    ctx.fx.bloodHit(point, dir, 0.7);
    const outcome = takeHit(a, amount, floors && a.state === 'up');
    if (outcome === 'down') this.goDown(a, now);
    else if (outcome === 'dead') this.die(a, dir);
  }

  private goDown(a: Ally, now: number): void {
    const e = a.body;
    a.bleedsOutAt = now + ALLY.downSeconds;
    a.target = null;
    a.hasArmour = false;
    a.burstLeft = 0;
    a.route.clear();
    e.mode = 'hold';
    e.velocity.set(0, 0, 0);
    this.claim(a, null);
    if (a.patient) this.dropPatient(a);
    (e.char.anim as unknown as Posed).setPosture?.('downed');
    this.props.setDown(e.char, true);
    this.ctx.audio.play(e.def.voice.pain, { position: e.center, pitch: e.def.voice.pitch });
    this.ctx.hud.feed(`${a.def.label.toUpperCase()} DOWN`, `#${ALLY_DOWN_COLOR.toString(16)}`);
    this.downTags.set(a, this.ctx.hud.follow(e.center, DOWN_TAG, `#${ALLY_DOWN_COLOR.toString(16)}`));
    this.ctx.events.emit('ally:down', { ally: a });
  }

  private updateDown(a: Ally, now: number): void {
    if (now >= a.bleedsOutAt && !a.treatedBy?.treatUntil) {
      a.state = 'dead';
      this.die(a, UP);
      return;
    }
    // The tag shows near enough to matter and goes when he is far off.
    const near = a.body.position.distanceTo(this.ctx.player.position) < TAG_RANGE;
    if (near !== this.downTags.has(a)) {
      if (near) this.downTags.set(a, this.ctx.hud.follow(a.body.center, DOWN_TAG, `#${ALLY_DOWN_COLOR.toString(16)}`));
      else this.untag(a);
    }
  }

  private untag(a: Ally): void {
    this.downTags.get(a)?.();
    this.downTags.delete(a);
  }

  /** A medic at his patient's side: kneels, works, and gets him up. */
  private treat(m: Ally, now: number): void {
    const p = m.patient!;
    if (m.treatUntil === 0) m.treatUntil = now + m.def.medic!.seconds;
    else if (now >= m.treatUntil) {
      m.stims--;
      this.reviveAlly(p);
      this.dropPatient(m);
    }
  }

  private reviveAlly(a: Ally): void {
    if (!revive(a)) return;
    a.injuries.clear();
    a.body.speedMul = rand(0.95, 1.05);
    a.thinkAt = 0;
    if (a.treatedBy) this.dropPatient(a.treatedBy);
    this.untag(a);
    (a.body.char.anim as unknown as Posed).setPosture?.('stand');
    this.props.setDown(a.body.char, false);
    this.ctx.hud.floatText(_a.copy(a.body.center).setY(a.body.center.y + 1.3), 'REVIVED', ALLY_TEXT);
    this.ctx.audio.play('ui_confirm', { position: a.body.center });
    this.ctx.events.emit('ally:revived', { ally: a });
  }

  /** Dead stays dead. The body goes to gore as a ragdoll and keeps his kit until the corpse is gone. */
  private die(a: Ally, dir: THREE.Vector3): void {
    const { ctx } = this;
    a.state = 'dead';
    this.ctx.audio.play(a.body.def.voice.die, { position: a.body.center, pitch: a.body.def.voice.pitch, volume: 0.7 });
    ctx.hud.feed(`${a.def.label.toUpperCase()} KILLED`, `#${ALLY_DOWN_COLOR.toString(16)}`);
    _b.copy(a.body.velocity).addScaledVector(dir, 1.5);
    ctx.gore.ragdoll(a.body.char, { velocity: _b });
    ctx.events.emit('ally:dead', { ally: a });
    this.release(a, false);
  }

  /** Off the roster. `keepBody` false: gore owns the body now. */
  private release(a: Ally, withBody: boolean): void {
    this.untag(a);
    this.claim(a, null);
    if (a.patient) this.dropPatient(a);
    if (a.treatedBy) this.dropPatient(a.treatedBy);
    for (const o of this.allies) if (o.patient === a) this.dropPatient(o);
    if (withBody) {
      this.props.strip(a.body.char);
      a.body.char.release();
    }
    const i = this.allies.indexOf(a);
    if (i >= 0) this.allies.splice(i, 1);
    const j = this.bodies.indexOf(a.body);
    if (j >= 0) this.bodies.splice(j, 1);
    this.clearFoesOn(a);
    a.body.alive = false;
    this.pool.release(a);
  }

  // -------------------------------------------------------------------------------------------
  // The enemy's side: who they shoot
  // -------------------------------------------------------------------------------------------

  /** A few enemy soldiers a tick look for the nearest ally in sight, and turn on him if the rule says so. */
  private assignFoes(now: number): void {
    this.foeAt = now + ALLY.foeTick;
    const o = this.enemies.outpost;
    if (!o) return;
    const list = o.soldiers;
    if (list.length === 0) return;
    this.foesSet = true;
    let rays: number = ALLY.foeRays;
    for (let k = 0; k < list.length && rays > 0; k++) {
      this.foeCursor = (this.foeCursor + 1) % list.length;
      const s = list[this.foeCursor]!;
      if (!s.fighting) {
        s.foe = null;
        continue;
      }
      let best: Ally | null = null;
      let bestD: number = ALLY.foeRange;
      for (const a of this.allies) {
        if (a.state !== 'up') continue;
        const d = a.body.position.distanceTo(s.e.position);
        if (d < bestD) {
          bestD = d;
          best = a;
        }
      }
      if (!best) {
        s.foe = null;
        continue;
      }
      rays--;
      _a.copy(s.e.position);
      _a.y += s.e.def.eyeHeight;
      const seen = this.clearLine(_a, best.body.center);
      s.foe = seen && prefersAlly(s.sees, s.e.dist, bestD) ? best : null;
    }
  }

  private clearFoes(): void {
    const o = this.enemies.outpost;
    if (o) for (const s of o.soldiers) s.foe = null;
    this.foesSet = false;
  }

  private clearFoesOn(a: Ally): void {
    const o = this.enemies.outpost;
    if (o) for (const s of o.soldiers) if (s.foe === a) s.foe = null;
  }

  // -------------------------------------------------------------------------------------------
  // Rays: the crosshair, CHECK FIRE, enemy rounds
  // -------------------------------------------------------------------------------------------

  private readonly rayOut: AllyRayHit & { bone: number | undefined; region: GoreRegion } = { ally: null as unknown as Ally, distance: 0, point: new THREE.Vector3(), bone: undefined, region: 'chest' };

  /**
   * The nearest of our bodies along a ray, up or down. A cheap upright capsule first, then the bones. The result is reused.
   * `upOnly` skips the downed, for enemy rounds, which have stopped aiming at them.
   */
  raycastBodies(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, upOnly = false): (AllyRayHit & { bone: number | undefined; region: GoreRegion }) | null {
    let best = maxDist;
    let found = false;
    const out = this.rayOut;
    for (const a of this.allies) {
      if (a.state === 'dead' || (upOnly && a.state !== 'up')) continue;
      const e = a.body;
      const h = a.state === 'down' ? 0.7 : e.char.rig.height;
      // Ray against a vertical segment: the closest approach, in the flat, then a height check.
      _a.subVectors(e.position, origin);
      const along = _a.dot(dir);
      if (along < 0 || along - 1.5 > best) continue;
      _b.copy(origin).addScaledVector(dir, along);
      const flat = Math.hypot(_b.x - e.position.x, _b.z - e.position.z);
      if (flat > e.def.radius + 0.6 || _b.y < e.position.y - 0.3 || _b.y > e.position.y + h + 0.3) continue;
      const hit = this.ctx.gore.raycastCharacter(e.char, origin, dir, best);
      if (!hit || hit.distance >= best) continue;
      best = hit.distance;
      found = true;
      out.ally = a;
      out.distance = hit.distance;
      out.point.copy(hit.point);
      out.bone = hit.bone;
      out.region = hit.region;
    }
    return found ? out : null;
  }

  /** For the crosshair: the nearest ally along the ray, before any wall in the way or not (the caller tests walls). */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): AllyRayHit | null {
    if (this.allies.length === 0) return null;
    return this.raycastBodies(origin, dir, maxDist);
  }

  /** The player fired along this line. A round that meets one of ours passes through him: a green spark, a flinch, CHECK FIRE. */
  private checkFire(origin: THREE.Vector3, dir: THREE.Vector3): void {
    if (this.allies.length === 0) return;
    const { ctx } = this;
    const wall = ctx.physics.raycast(origin, dir, 200, CG.World);
    const hit = this.raycastBodies(origin, dir, wall ? wall.distance : 200);
    if (!hit) return;
    const a = hit.ally;
    _dir.copy(dir).negate();
    ctx.fx.sparks(hit.point, _dir, 8, 0x3dff7a);
    if (hit.bone !== undefined) a.body.char.anim.flinch(hit.bone, dir, 0.5);
    const now = ctx.time.elapsed;
    a.checkFireAt = now;
    if (now - this.checkFireAt < ALLY.checkFireGap) return;
    this.checkFireAt = now;
    ctx.hud.floatText(_a.copy(a.body.center).setY(a.body.center.y + 1.2), 'CHECK FIRE', CHECK_FIRE_TEXT);
    ctx.events.emit('ally:checkFire', { ally: a });
  }
}

export function createAllies(ctx: Ctx): AllySystem {
  return new AllySystem(ctx);
}

/** Types in the order the lab shows them. */
export { ALLY_ORDER };
