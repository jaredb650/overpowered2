/**
 * The attackers' side of Outpost Defense: how humans who cannot walk to the player besiege a fort (docs/proposals/outpost-defense.md,
 * piece 7). The Outpost's squad brain hunts a player it can reach; behind shut gates it has nowhere to go and stands at the fence. So
 * every man here is in a directed squad, and this tells him where to be:
 *
 *   assault  the squad goes for the shop in the ring it is in, then for a way into the next ring (a breach, a blown gate, a jump pad),
 *            and with none, takes cover facing that wall and shoots. In the player's own ring the squad brain takes over.
 *   sapper   runs a satchel charge to the nearest wall or gate of the next ring and sets it. Shoot him first.
 *   engineer builds a jump pad over a damaged wall, or a sandbag wall in the field for the rest to fight from.
 *   crew     two men and a tube in a pit in the field. They set up, then shell the fort; they cannot fire while moving.
 *
 * Bosses and bombers run the swarm's brain, which follows the flow field to the player. Sealed in, it has none, so `SIEGE` walks
 * them to the wall in the way: a bomber blows himself up against it, a Juggernaut or a Titan beats on it until it gives.
 */
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Ctx, Structure } from '../../core/contracts';
import { rand } from '../../core/math';
import type { Behaviour } from '../../enemies/brain';
import type { Device } from '../../enemies/commander/devices';
import type { Enemy } from '../../enemies/Enemy';
import type { EnemyManager } from '../../enemies/EnemyManager';
import { leapTo } from '../../enemies/movement';
import type { Outpost } from '../../enemies/outpost';
import type { CoverSpot, SpotQuery, SpotReading } from '../../enemies/outpost/cover';
import { Route } from '../../enemies/outpost/routes';
import type { Soldier } from '../../enemies/outpost/soldier';
import type { OutpostSquad } from '../../enemies/outpost/squad';
import { ModelBuilder, ModelMaterials } from '../../progression/modelkit';
import { FORT_MORTARS, FORT_SHOPS, LEVEL, RAMPART, ring, type FortShop, type RingId } from '../../world/map/fort/plan';
import type { StructureSpec, Structures } from '../../world/structures';
import { DEPTH_RING, depthAt, FIELD_MORTAR, MortarCrew, nextRing, onRing, outward, SATCHEL, satchelBlast } from './field';
import { Shells } from './shells';

const TICK = 0.4;
/** Metres from the destination that count as there. */
const ARRIVED = 1.6;
/** Seconds before an order that could not be routed is tried again. */
const RETRY = 2.5;
/** Seconds a squad sits with no way in before one of its riflemen is handed a charge. A wave must not stall on a sealed fort. */
const NO_WAY_SAPPER = 30;
/** Metres out from the next ring's wall that a squad with no way in takes cover: out in the field, and in a yard. */
const HOLD_FIELD = 20;
const HOLD_YARD = 7;
/** Damage a second each man at a shop does to it, and how close to its walls he has to be. */
const SHOP_DPS = 10;
const SHOP_REACH = 6;
/** Engineers: seconds of work, and the most of each kind of work on the field at once. */
const BUILD_SECONDS = 5;
const MAX_COVERS = 10;
const MAX_PADS = 6;
const COVER_HP = 2;
const COVER = { length: 3.2, height: 1.15, depth: 0.8 } as const;
const PAD_REACH = 1.5;
/** Seconds of a pad's leap, and the extra rise that clears a 3 m wall. */
const PAD_FLIGHT = 0.95;
const PAD_APEX = 4;
/** What a boss against a wall does to it a second, and a bomber's last act. */
const BASH: Partial<Record<string, number>> = { juggernaut: 70, titan: 140 };
const BOMBER_WALL = 380;
const BOSS_REACH = 3;
const MARK = '#ff5a3a';
const RED = 0xff2a12;
const SIEGE_SCORE = 8;
/** Metres from the player inside which a squad in his ring fights him with its own brain. */
const RELEASE_RANGE = 30;
/** Nodes a siege route may open: the long way round a ring, about 140 m of yard or field. */
const ROUTE_BUDGET = 30000;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _n = new THREE.Vector3();
const _m = new THREE.Vector3();
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);

export type JobKind = 'assault' | 'sapper' | 'engineer' | 'crew';

type Piece = Structure & { readonly spec: StructureSpec };

interface Job {
  kind: JobKind;
  s: Soldier;
  uid: number;
  readonly dest: THREE.Vector3;
  /** What he was last sent to do: a new one is an order, the same one is left alone. */
  key: string;
  retryAt: number;
  /** Kneeling at a job until then, or 0. */
  workUntil: number;
  piece: Piece | null;
  pad: Pad | null;
  team: Team | null;
  /** An engineer's cover spot, chosen once. */
  readonly site: THREE.Vector3;
  siteSet: boolean;
  restUntil: number;
}

interface Pad {
  piece: Piece;
  readonly out: THREE.Vector3;
  readonly land: THREE.Vector3;
  mesh: THREE.Object3D;
}

interface Cover {
  readonly at: THREE.Vector3;
  mesh: THREE.Object3D;
  collider: RAPIER.Collider;
  hp: number;
}

interface Satchel {
  d: Device;
  piece: Piece;
  readonly at: THREE.Vector3;
  fuseAt: number;
}

export interface Team {
  pit: number;
  readonly pos: THREE.Vector3;
  yaw: number;
  readonly crew: MortarCrew;
  men: Soldier[];
  tube: Device | null;
  unmark: (() => void) | null;
  live: boolean;
}

interface Sieger {
  e: Enemy;
  uid: number;
  readonly route: Route;
  readonly target: THREE.Vector3;
  piece: Piece | null;
  routedAt: number;
  arrived: boolean;
}

interface SquadState {
  key: string;
  noWaySince: number;
  released: boolean;
}

const SIEGERS = new WeakMap<Enemy, Sieger>();

/** Ahead of a boss's own behaviours while it has no path to the player: walk the route to the wall, then stand at it. */
const SIEGE: Behaviour = {
  name: 'siege',
  commit: 1,
  score: e => (SIEGERS.get(e)?.uid === e.uid && !Number.isFinite(e.pathDist) ? SIEGE_SCORE : 0),
  enter(e) {
    e.mode = 'point';
    e.face = 'move';
  },
  frame(e) {
    const g = SIEGERS.get(e);
    if (!g) return;
    e.flowUntil = 0;
    const r = g.route;
    while (!r.done && Math.hypot(r.x[r.next]! - e.position.x, r.z[r.next]! - e.position.z) < 1.2) r.next++;
    if (r.done) {
      e.mode = 'hold';
      e.face = 'player';
      return;
    }
    e.mode = 'point';
    e.moveTarget.set(r.x[r.next]!, r.y[r.next]!, r.z[r.next]!);
  },
};

const SHOP_OF: Record<RingId, FortShop> = Object.fromEntries(FORT_SHOPS.map(s => [s.ring, s])) as Record<RingId, FortShop>;

export class Siege {
  readonly jobs = new Map<Soldier, Job>();
  readonly pads: Pad[] = [];
  readonly covers: Cover[] = [];
  readonly satchels: Satchel[] = [];
  readonly teams: Team[] = [];
  readonly shells: Shells;
  /** For the bot and the notes: what has happened this run. */
  readonly counts = { planted: 0, blown: 0, defused: 0, pads: 0, covers: 0, leaps: 0, salvos: 0, shopHits: 0 };
  private readonly siegers: Sieger[] = [];
  private readonly squads = new Map<OutpostSquad, SquadState>();
  private pieces: Piece[] = [];
  private tickAt = 0;
  private materials: ModelMaterials | null = null;
  private readonly reading: SpotReading = { hidden: false, canShoot: false, side: 0 };
  private readonly query: SpotQuery = {
    anchor: new THREE.Vector3(), radius: 12, threat: new THREE.Vector3(), near: 10, far: 70, bearing: Number.NaN, bearingSlack: 0,
    needShot: false, spacing: 2.4, uid: 0, from: new THREE.Vector3(), height: 0, anyFloor: false,
  };

  constructor(private readonly ctx: Ctx, private readonly o: Outpost, private readonly manager: EnemyManager) {
    this.shells = new Shells(ctx, s => this.o.commander.boom(s.to, s.radius, s.damage, s.source), (at, r, t, c) => this.o.w.telegraphs.zone(at, r, t, c));
    ctx.physics.radialListeners.add((center, radius, strength) => {
      if (strength >= 18) this.onBlast(center, radius);
    });
  }

  private get walls(): Structures | null {
    return (this.ctx.world.objects as unknown as { walls?: Structures }).walls ?? null;
  }

  reset(): void {
    this.pieces = (this.walls?.all ?? []).filter(p => p.kind !== 'shack') as Piece[];
    this.jobs.clear();
    this.squads.clear();
    for (const p of this.pads) p.mesh.removeFromParent();
    this.pads.length = 0;
    for (const c of this.covers) this.removeCover(c);
    this.covers.length = 0;
    this.satchels.length = 0;
    for (const t of this.teams) t.unmark?.();
    this.teams.length = 0;
    this.siegers.length = 0;
    this.shells.reset();
    for (const k in this.counts) this.counts[k as keyof typeof this.counts] = 0;
  }

  // -------------------------------------------------------------------------------------------
  // Who does what
  // -------------------------------------------------------------------------------------------

  /** Takes a man on, with a job. His squad stops thinking for itself. */
  assign(s: Soldier, kind: JobKind, team: Team | null = null): void {
    s.squad.directed = true;
    this.jobs.set(s, {
      kind, s, uid: s.e.uid, dest: new THREE.Vector3(), key: '', retryAt: 0, workUntil: 0, piece: null, pad: null, team,
      site: new THREE.Vector3(), siteSet: false, restUntil: 0,
    });
    if (team) team.men.push(s);
  }

  /** A pit for a new enemy mortar team: a free one on the side the crew comes in from, or any free one. */
  newTeam(near: THREE.Vector3): Team | null {
    let best = -1;
    let bestD = Infinity;
    FORT_MORTARS.forEach((m, i) => {
      if (this.teams.some(t => t.live && t.pit === i)) return;
      const d = Math.hypot(m.pos[0] - near.x, m.pos[2] - near.z);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (best < 0) return null;
    const m = FORT_MORTARS[best]!;
    const t: Team = { pit: best, pos: new THREE.Vector3(...m.pos), yaw: m.yaw, crew: new MortarCrew(), men: [], tube: null, unmark: null, live: true };
    this.teams.push(t);
    return t;
  }

  /** A boss or a bomber: it walks to the wall in its way while it has no path to the player. */
  besiege(e: Enemy): void {
    e.behaviours = [SIEGE, ...e.behaviours];
    const g: Sieger = { e, uid: e.uid, route: new Route(), target: new THREE.Vector3(), piece: null, routedAt: -99, arrived: false };
    SIEGERS.set(e, g);
    this.siegers.push(g);
  }

  // -------------------------------------------------------------------------------------------
  // Frame
  // -------------------------------------------------------------------------------------------

  update(): void {
    const now = this.ctx.time.elapsed;
    this.shells.update();
    this.fuses(now);
    if (now < this.tickAt) return;
    this.tickAt = now + TICK;
    this.adopt();
    const pd = this.playerDepth;
    for (const [s, job] of this.jobs) {
      if (job.uid !== s.e.uid || !s.e.alive || !s.fighting) {
        this.jobs.delete(s);
        continue;
      }
      switch (job.kind) {
        case 'sapper': this.sapper(job, now, pd); break;
        case 'engineer': this.engineer(job, now, pd); break;
        case 'crew': this.crewman(job, now); break;
        default: break;
      }
    }
    this.assaults(now, pd);
    this.raids();
    this.mortarTeams();
    this.sieging(now, pd);
    this.prunePads();
  }

  private get playerDepth(): number {
    const p = this.ctx.player.position;
    return depthAt(p.x, p.z);
  }

  /** Men who arrived any other way, out of a truck or off a gun, join the assault. */
  private adopt(): void {
    for (const s of this.o.soldiers) {
      const job = this.jobs.get(s);
      if (job && job.uid === s.e.uid) continue;
      if (s.e.pinned || !s.fighting || !s.e.alive) continue;
      this.assign(s, 'assault');
    }
  }

  private send(job: Job, dest: THREE.Vector3, key: string, urgency: 0 | 1 | 2, now: number, spot: CoverSpot | null = null): void {
    const s = job.s;
    if (job.key === key && (now < job.retryAt || s.task === 'move' || s.hasOrder || this.near(s.e.position, job.dest, ARRIVED))) return;
    job.key = key;
    job.dest.copy(dest);
    // Round a corner first when the place is on another side of the walls: one long search round a ring is more than A* will do.
    const leg = this.via(s.e.position, dest, _v);
    job.retryAt = now + (this.go(s, leg ?? dest, leg ? null : spot, urgency) ? RETRY : TICK);
  }

  /** The corner of the band a man is in, between him and `to` on another side of the fort. Null on the same side. */
  private via(from: THREE.Vector3, to: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 | null {
    const depth = depthAt(from.x, from.z);
    const next = nextRing(depth);
    if (!next) return null;
    const n1 = outward(from.x, from.z, _n);
    const n2 = outward(to.x, to.z, _m);
    if (n1.x === n2.x && n1.z === n2.z) return null;
    const here = DEPTH_RING[depth];
    const r = here ? (ring(next).half + ring(here).half - RAMPART.to) / 2 : ring(next).half + 14;
    if (n1.x === -n2.x && n1.z === -n2.z) {
      // Straight across: round whichever corner of his own side is nearer.
      const mx = n1.z, mz = n1.x;
      const a = Math.hypot(from.x - (n1.x + mx) * r, from.z - (n1.z + mz) * r);
      const b = Math.hypot(from.x - (n1.x - mx) * r, from.z - (n1.z - mz) * r);
      n2.set(a < b ? mx : -mx, 0, a < b ? mz : -mz);
    }
    out.set((n1.x + n2.x) * r, 0, (n1.z + n2.z) * r);
    if (Math.hypot(out.x - from.x, out.z - from.z) < 6) return null;
    return this.ctx.world.nav.nearest(out, 8, out) ? out : null;
  }

  /**
   * `Outpost.order` with a bigger search. Its route finder gives up after a building's worth of floor, and the way round a fort's walls
   * to a breach, or across a yard to a shop, is longer than that. It shares the Outpost's routes a frame; false when none was left.
   */
  private go(s: Soldier, dest: THREE.Vector3, spot: CoverSpot | null, urgency: 0 | 1 | 2): boolean {
    const { o } = this;
    // Dazed by a blast, he does not know he was told anything.
    if (s.injuries.concussed(this.ctx.time.elapsed)) return true;
    if (!o.takeRoute()) return false;
    if (!o.routes.find(s.e.position, dest, s.route, null, ROUTE_BUDGET)) return true;
    if (s.spot && s.spot !== spot) s.spot.claimedBy = 0;
    s.spot = spot;
    if (spot) spot.claimedBy = s.e.uid;
    s.dest.copy(dest);
    s.urgency = urgency;
    s.hasOrder = false;
    s.canShoot = false;
    s.stalls = 0;
    s.route.next = 0;
    s.progressAt = this.ctx.time.elapsed + 1.3;
    s.progressFrom.copy(s.e.position);
    s.task = 'move';
    return true;
  }

  private near(a: THREE.Vector3, b: THREE.Vector3, r: number): boolean {
    return Math.hypot(a.x - b.x, a.z - b.z) < r;
  }

  // ---- the assault --------------------------------------------------------------------------------------------

  private assaults(now: number, pd: number): void {
    const seen = new Set<OutpostSquad>();
    for (const job of this.jobs.values()) {
      if (job.kind !== 'assault') continue;
      const q = job.s.squad;
      if (seen.has(q)) continue;
      seen.add(q);
      this.squad(q, now, pd);
    }
  }

  /** One decision a squad, read off its leader, and each of its assault men sent to carry it out. */
  private squad(q: OutpostSquad, now: number, pd: number): void {
    let st = this.squads.get(q);
    if (!st) this.squads.set(q, (st = { key: '', noWaySince: now, released: false }));
    const men: Job[] = [];
    let special = false;
    for (const s of q.members) {
      const job = this.jobs.get(s);
      if (!job || job.uid !== s.e.uid) continue;
      if (job.kind === 'assault') men.push(job);
      else special = true;
    }
    const lead = men[0];
    if (!lead) return;
    const p = lead.s.e.position;
    const depth = depthAt(p.x, p.z);
    const here = DEPTH_RING[depth];
    const shop = here ? SHOP_OF[here] : undefined;
    const defense = this.ctx.contracts.defense;
    if (shop && defense && !defense.shops[shop.id].lost) {
      this.hold(q, st, false);
      men.forEach((job, i) => this.send(job, this.shopSpot(shop, i, _a), `raid:${shop.id}`, 2, now));
      return;
    }
    if (depth >= pd) {
      // Close to the player: the squad's own brain fights him, unless a man with a job would be pulled off it. Further off its routes
      // fall short, so the siege walks them into range first.
      const near = Math.hypot(p.x - this.ctx.player.position.x, p.z - this.ctx.player.position.z) < RELEASE_RANGE * (st.released ? 1.5 : 1);
      if (!special && near) {
        this.hold(q, st, true);
        return;
      }
      this.hold(q, st, false);
      for (const job of men) {
        this.query.anchor.copy(this.ctx.player.position);
        this.query.near = 6;
        this.query.far = 26;
        this.cover(job, `hunt:${Math.round(now / 8)}`, now, true);
      }
      return;
    }
    this.hold(q, st, false);
    const way = this.wayInto(depth, p, _b);
    if (way) {
      st.noWaySince = now;
      for (const job of men) {
        if (way.pad && this.near(job.s.e.position, way.pad.out, PAD_REACH) && !job.s.e.airborne) {
          this.leap(job, way.pad);
          continue;
        }
        this.send(job, way.pad ? way.pad.out : _b, way.key, 2, now);
      }
      return;
    }
    if (now - st.noWaySince > NO_WAY_SAPPER) {
      st.noWaySince = now;
      const pick = men.find(j => j.s.role === 'rifle' || j.s.role === 'shotgun') ?? men[men.length - 1]!;
      pick.kind = 'sapper';
      pick.key = '';
    }
    // No way in: take cover facing the wall in the way, out of a rifle's easy reach, and fight from there.
    const next = nextRing(depth)!;
    outward(p.x, p.z, _n);
    const half = ring(next).half;
    const out = half + (depth === 0 ? HOLD_FIELD : HOLD_YARD);
    const lat = THREE.MathUtils.clamp(_n.x !== 0 ? p.z : p.x, -half + 6, half - 6);
    if (_n.x !== 0) this.query.anchor.set(_n.x * out, 0, lat);
    else this.query.anchor.set(lat, 0, _n.z * out);
    const side = `${_n.x},${_n.z}`;
    this.query.near = 12;
    this.query.far = 70;
    for (const job of men) this.cover(job, `hold:${next}:${side}`, now, false);
  }

  /** Lets the squad think for itself, or takes it back. */
  private hold(q: OutpostSquad, st: SquadState, release: boolean): void {
    if (st.released === release) return;
    st.released = release;
    q.directed = !release;
    for (const s of q.members) {
      const job = this.jobs.get(s);
      if (job) job.key = release ? 'free' : '';
    }
  }

  /** A spot from the cover map near `query.anchor`, or a sandbag wall an engineer put there, or the anchor itself. */
  private cover(job: Job, key: string, now: number, needShot: boolean): void {
    const s = job.s;
    if (job.key === key && (now < job.retryAt || s.task === 'move' || s.hasOrder)) return;
    const q = this.query;
    const anchor = q.anchor;
    // A built wall near the anchor is the best cover there is: it was put there for this.
    for (const c of this.covers) {
      if (c.at.distanceTo(anchor) > 16 || needShot) continue;
      outward(c.at.x, c.at.z, _n);
      _a.copy(c.at).addScaledVector(_n, 1.1);
      _a.x += rand(-1.2, 1.2) * Math.abs(_n.z);
      _a.z += rand(-1.2, 1.2) * Math.abs(_n.x);
      if (this.ctx.world.nav.nearest(_a, 2, _a) && !this.crowded(_a, s)) {
        this.send(job, _a, key, 1, now);
        return;
      }
    }
    q.threat.copy(this.ctx.player.position);
    q.threat.y += 1.5;
    q.needShot = needShot;
    q.uid = s.e.uid;
    q.from.copy(s.e.position);
    const spot = this.o.cover.pick(q, this.reading);
    if (spot) {
      if (job.key === key && s.spot === spot) return;
      this.send(job, spot.position, key, 1, now, spot);
      this.o.fireFrom(s, spot, this.reading);
      return;
    }
    _a.set(anchor.x + rand(-4, 4), 0, anchor.z + rand(-4, 4));
    if (this.ctx.world.nav.nearest(_a, 6, _a)) this.send(job, _a, key, 1, now);
  }

  private crowded(at: THREE.Vector3, me: Soldier): boolean {
    for (const job of this.jobs.values()) if (job.s !== me && job.dest.distanceToSquared(at) < 1.6 * 1.6) return true;
    return false;
  }

  /**
   * The nearest way into the ring after `depth`, from `from`: a breached wall or gate, written as a point inside it, or a jump pad.
   * Null while that ring is sealed.
   */
  private wayInto(depth: number, from: THREE.Vector3, out: THREE.Vector3): { key: string; pad: Pad | null } | null {
    const id = nextRing(depth);
    if (!id) return null;
    let best: Piece | null = null;
    let bestD = Infinity;
    for (const p of this.pieces) {
      if (p.stage !== 'breached' || !onRing(p.spec.x, p.spec.z, id)) continue;
      const d = Math.hypot(p.spec.x - from.x, p.spec.z - from.z);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    let pad: Pad | null = null;
    for (const q of this.pads) {
      if (!onRing(q.piece.spec.x, q.piece.spec.z, id)) continue;
      const d = Math.hypot(q.out.x - from.x, q.out.z - from.z);
      if (d < bestD) {
        bestD = d;
        pad = q;
      }
    }
    if (pad) return { key: `pad:${pad.piece.id}`, pad };
    if (!best) return null;
    outward(best.spec.x, best.spec.z, _n);
    out.set(best.spec.x, 0, best.spec.z).addScaledVector(_n, -(best.kind === 'gate' ? 5 : RAMPART.to + 3));
    if (!this.ctx.world.nav.nearest(out, 4, out)) return null;
    return { key: `way:${best.id}`, pad: null };
  }

  private leap(job: Job, pad: Pad): void {
    const { s } = job;
    const e = s.e;
    s.task = 'hold';
    s.hasOrder = false;
    s.route.clear();
    _a.copy(pad.land);
    outward(pad.piece.spec.x, pad.piece.spec.z, _n);
    _a.x += rand(-0.6, 0.6) * Math.abs(_n.z);
    _a.z += rand(-0.6, 0.6) * Math.abs(_n.x);
    leapTo(e, _a, PAD_FLIGHT, PAD_APEX);
    this.ctx.fx.jumpPad(pad.out, _up, 0xff8a2a);
    this.ctx.audio.play('jump_pad', { position: pad.out });
    job.key = '';
    this.counts.leaps++;
  }

  // ---- shops ---------------------------------------------------------------------------------------------------

  /** Where the `i`th man of a raid stands: in a fan outside the shop's door. */
  private shopSpot(shop: FortShop, i: number, out: THREE.Vector3): THREE.Vector3 {
    const t = shop.target;
    const outZ = shop.door[2] <= t.min[2] + 0.01 ? -1 : 1;
    out.set(shop.door[0] + ((i % 5) - 2) * 1.6, 0, shop.door[2] + outZ * (2.5 + Math.floor(i / 5) * 1.6));
    this.ctx.world.nav.nearest(out, 3, out);
    return out;
  }

  /** Men close to a live shop in their ring shoot it to pieces. */
  private raids(): void {
    const defense = this.ctx.contracts.defense;
    if (!defense) return;
    const { fx, audio } = this.ctx;
    for (const job of this.jobs.values()) {
      const e = job.s.e;
      const here = DEPTH_RING[depthAt(e.position.x, e.position.z)];
      const shop = here ? SHOP_OF[here] : undefined;
      if (!shop || defense.shops[shop.id].lost || e.airborne) continue;
      const t = shop.target;
      const dx = Math.max(t.min[0] - e.position.x, 0, e.position.x - t.max[0]);
      const dz = Math.max(t.min[2] - e.position.z, 0, e.position.z - t.max[2]);
      if (Math.hypot(dx, dz) > SHOP_REACH) continue;
      defense.damageShop(shop.id, SHOP_DPS * TICK);
      this.counts.shopHits++;
      _a.copy(e.center);
      _a.y += 0.3;
      _b.set(rand(t.min[0], t.max[0]), rand(0.6, t.max[1] - 0.4), rand(t.min[2], t.max[2]));
      // The face nearest him, not the middle of the roof.
      _b.x = THREE.MathUtils.clamp(e.position.x, t.min[0], t.max[0]);
      _b.z = THREE.MathUtils.clamp(e.position.z, t.min[2], t.max[2]);
      fx.tracer(_a, _b, 'enemy');
      fx.sparks(_b, _n.subVectors(_a, _b).normalize(), 5, 0xffd0a0);
      if (Math.random() < 0.35) audio.play('impact_metal', { position: _b, volume: 0.5 });
    }
  }

  // ---- sappers --------------------------------------------------------------------------------------------------

  private sapper(job: Job, now: number, pd: number): void {
    const { s } = job;
    const p = s.e.position;
    const depth = depthAt(p.x, p.z);
    const next = nextRing(depth);
    if (depth >= pd || !next) {
      job.kind = 'assault';
      return;
    }
    if (job.workUntil > 0) {
      if (now < job.workUntil) return;
      job.workUntil = 0;
      this.plant(job);
      return;
    }
    if (!job.piece || job.piece.stage === 'breached' || !onRing(job.piece.spec.x, job.piece.spec.z, next)) {
      job.piece = this.pieceFor(p, next, true);
      job.key = '';
      if (!job.piece) {
        job.kind = 'assault';
        return;
      }
    }
    this.faceOf(job.piece, p, SATCHEL.standOff + 0.4, _a);
    if (this.near(p, _a, ARRIVED) && s.task !== 'move') {
      job.workUntil = now + SATCHEL.plant;
      this.o.comms.relay('Setting the charge!', s, null);
      return;
    }
    if (!this.ctx.world.nav.nearest(_a, 3, _a)) return;
    this.send(job, _a, `sap:${job.piece.id}`, 2, now);
  }

  /** The nearest piece of `id` still standing. Gates count as closer, because one charge opens one. */
  private pieceFor(from: THREE.Vector3, id: RingId, gates: boolean): Piece | null {
    let best: Piece | null = null;
    let bestScore = Infinity;
    for (const p of this.pieces) {
      if (p.stage === 'breached' || !onRing(p.spec.x, p.spec.z, id)) continue;
      const score = Math.hypot(p.spec.x - from.x, p.spec.z - from.z) - (gates && p.kind === 'gate' ? 14 : 0) + (this.charged(p) ? 30 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = p;
      }
    }
    return best;
  }

  private charged(p: Piece): boolean {
    return this.satchels.some(x => x.piece === p);
  }

  /** A point `off` metres out from a piece's outer face, level with `from` along it. */
  private faceOf(p: Piece, from: THREE.Vector3, off: number, out: THREE.Vector3): THREE.Vector3 {
    const sp = p.spec;
    outward(sp.x, sp.z, _n);
    const half = sp.length / 2 - 0.3;
    if (_n.x !== 0) out.set(sp.x + _n.x * off, 0, THREE.MathUtils.clamp(from.z, sp.z - half, sp.z + half));
    else out.set(THREE.MathUtils.clamp(from.x, sp.x - half, sp.x + half), 0, sp.z + _n.z * off);
    return out;
  }

  private plant(job: Job): void {
    const { s } = job;
    const piece = job.piece;
    job.kind = 'assault';
    job.key = '';
    if (!piece) return;
    const devices = this.o.commander.devices;
    this.faceOf(piece, s.e.position, 0.35, _a);
    const d = devices.charge(_a, 'satchel', 0);
    devices.trigger(d, 999);
    this.satchels.push({ d, piece, at: _a.clone(), fuseAt: this.ctx.time.elapsed + SATCHEL.fuse });
    this.o.w.telegraphs.zone(_a, SATCHEL.radius, SATCHEL.fuse, RED);
    this.ctx.audio.play('grenade_pin', { position: _a, volume: 1 });
    this.counts.planted++;
    // Back out of his own blast before it goes.
    outward(_a.x, _a.z, _n);
    _b.copy(_a).addScaledVector(_n, 14);
    if (this.ctx.world.nav.nearest(_b, 4, _b)) this.o.order(s, _b, null, 2, 0);
  }

  private fuses(now: number): void {
    for (let i = this.satchels.length - 1; i >= 0; i--) {
      const x = this.satchels[i]!;
      if (!x.d.live) {
        // Shot, or set off early by a blast next to it: the small bang has already happened.
        this.satchels.splice(i, 1);
        this.counts.defused++;
        continue;
      }
      if (now < x.fuseAt) continue;
      this.satchels.splice(i, 1);
      this.o.commander.devices.disarm(x.d);
      this.o.commander.boom(x.at, SATCHEL.radius, SATCHEL.damage, 'satchel');
      satchelBlast(this.ctx.world.objects, x.at);
      this.counts.blown++;
    }
  }

  // ---- engineers ------------------------------------------------------------------------------------------------

  private engineer(job: Job, now: number, pd: number): void {
    const { s } = job;
    const p = s.e.position;
    const depth = depthAt(p.x, p.z);
    const next = nextRing(depth);
    if (depth >= pd || !next) {
      job.kind = 'assault';
      return;
    }
    if (now < job.restUntil) return;
    if (job.workUntil > 0) {
      if (now < job.workUntil) return;
      job.workUntil = 0;
      job.restUntil = now + 3;
      job.key = '';
      if (job.piece) this.buildPad(job.piece);
      else this.buildCover(job.site);
      job.piece = null;
      job.siteSet = false;
      return;
    }
    // A damaged wall with no pad over it is the job. Failing that, cover for the rest out in the field.
    if (!job.piece || job.piece.stage !== 'damaged' || this.pads.some(x => x.piece === job.piece)) {
      job.piece = this.pads.length < MAX_PADS ? this.damagedOn(next, p) : null;
      job.key = '';
    }
    if (job.piece) {
      this.faceOf(job.piece, p, 1.5, _a);
    } else {
      if (depth !== 0 || this.covers.length >= MAX_COVERS) {
        job.kind = 'assault';
        return;
      }
      if (!job.siteSet) {
        outward(p.x, p.z, _n);
        const half = ring('outer').half;
        const lat = THREE.MathUtils.clamp((_n.x !== 0 ? p.z : p.x) + rand(-14, 14), -half + 4, half - 4);
        const out = half + rand(16, 26);
        if (_n.x !== 0) job.site.set(_n.x * out, 0, lat);
        else job.site.set(lat, 0, _n.z * out);
        if (!this.ctx.world.nav.nearest(job.site, 4, job.site) || this.covers.some(c => c.at.distanceTo(job.site) < 7)) return;
        job.siteSet = true;
      }
      // He works from the fort's side of it, so the wall is between the stack and him only once it is up.
      outward(job.site.x, job.site.z, _n);
      _a.copy(job.site).addScaledVector(_n, 1.2);
    }
    if (this.near(p, _a, ARRIVED) && s.task !== 'move') {
      job.workUntil = now + BUILD_SECONDS;
      this.o.comms.relay(job.piece ? 'Building a way over!' : 'Digging in!', s, null);
      return;
    }
    if (!this.ctx.world.nav.nearest(_a, 3, _a)) {
      job.piece = null;
      job.siteSet = false;
      return;
    }
    this.send(job, _a, job.piece ? `pad:${job.piece.id}` : `dig:${Math.round(job.site.x)},${Math.round(job.site.z)}`, 2, now);
  }

  private damagedOn(id: RingId, from: THREE.Vector3): Piece | null {
    let best: Piece | null = null;
    let bestD = Infinity;
    for (const p of this.pieces) {
      if (p.kind !== 'wall' || p.stage !== 'damaged' || !onRing(p.spec.x, p.spec.z, id) || this.pads.some(x => x.piece === p)) continue;
      const d = Math.hypot(p.spec.x - from.x, p.spec.z - from.z);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  private model(b: ModelBuilder): THREE.Group {
    this.materials ??= new ModelMaterials(this.ctx);
    const g = this.materials.group(b);
    this.ctx.render.scene.add(g);
    return g;
  }

  private buildPad(piece: Piece): void {
    if (piece.stage !== 'damaged') return;
    const out = this.faceOf(piece, _b.set(piece.spec.x, 0, piece.spec.z), 1.5, new THREE.Vector3());
    outward(piece.spec.x, piece.spec.z, _n);
    const land = new THREE.Vector3(piece.spec.x, LEVEL.deck, piece.spec.z).addScaledVector(_n, -(RAMPART.from + RAMPART.to) / 2);
    const b = new ModelBuilder()
      .box(1.5, 0.12, 1.5, 0x3a4048, { at: [0, 0.06, 0] })
      .box(1.2, 0.2, 0.3, 0x55606a, { at: [0, 0.22, 0.45], rot: [0.5, 0, 0] })
      .glow(new THREE.BoxGeometry(1.1, 0.02, 0.16), 0xff8a2a, 4, { at: [0, 0.13, -0.2] })
      .glow(new THREE.BoxGeometry(1.1, 0.02, 0.16), 0xff8a2a, 4, { at: [0, 0.13, 0.15] });
    const mesh = this.model(b);
    mesh.position.copy(out);
    mesh.rotation.y = Math.atan2(_n.x, _n.z);
    this.pads.push({ piece, out, land, mesh });
    this.ctx.fx.jumpPad(out, _up, 0xff8a2a);
    this.ctx.audio.play('metal_clang', { position: out, pitch: 0.8 });
    this.ctx.hud.floatText(out.clone().setY(2), 'JUMP PAD', MARK);
    this.counts.pads++;
  }

  private buildCover(at: THREE.Vector3): void {
    outward(at.x, at.z, _n);
    const b = new ModelBuilder();
    // Three courses of bags, staggered, the long side across the line to the fort.
    for (let row = 0; row < 3; row++) {
      for (let i = 0; i < 4 - (row & 1); i++) {
        const x = (i - (3 - (row & 1)) / 2) * 0.8;
        b.box(0.78, 0.36, COVER.depth, row & 1 ? 0x6b6248 : 0x5f573f, { at: [x, 0.19 + row * 0.37, 0], rot: [0, rand(-0.06, 0.06), 0] });
      }
    }
    const mesh = this.model(b);
    mesh.position.copy(at);
    const yaw = Math.atan2(_n.x, _n.z) + Math.PI / 2;
    mesh.rotation.y = yaw;
    _q.setFromAxisAngle(_up, yaw);
    _a.set(at.x, at.y + COVER.height / 2, at.z);
    const collider = this.ctx.physics.addStaticBox(_a, _b.set(COVER.length / 2, COVER.height / 2, COVER.depth / 2), _q, 'dirt');
    this.covers.push({ at: at.clone(), mesh, collider, hp: COVER_HP });
    this.ctx.fx.dust(at, _up, 2);
    this.counts.covers++;
  }

  private removeCover(c: Cover): void {
    c.mesh.removeFromParent();
    this.ctx.physics.world.removeCollider(c.collider, true);
  }

  /** Blasts knock down sandbags and wreck pads. */
  private onBlast(center: THREE.Vector3, radius: number): void {
    for (let i = this.covers.length - 1; i >= 0; i--) {
      const c = this.covers[i]!;
      if (c.at.distanceTo(center) > radius + 1.6 || --c.hp > 0) continue;
      this.ctx.fx.dust(c.at, _up, 3);
      this.ctx.fx.chips(_a.copy(c.at).setY(0.8), 0x6b6248, 16);
      this.removeCover(c);
      this.covers.splice(i, 1);
    }
    for (let i = this.pads.length - 1; i >= 0; i--) {
      const q = this.pads[i]!;
      if (q.out.distanceTo(center) > radius + 1) continue;
      this.ctx.fx.sparks(q.out, _up, 18, 0xffb060);
      q.mesh.removeFromParent();
      this.pads.splice(i, 1);
    }
  }

  /** A breach is a better way than a pad over it. */
  private prunePads(): void {
    for (let i = this.pads.length - 1; i >= 0; i--) {
      const q = this.pads[i]!;
      if (q.piece.stage !== 'breached') continue;
      q.mesh.removeFromParent();
      this.pads.splice(i, 1);
    }
  }

  // ---- enemy mortar teams ------------------------------------------------------------------------------------------

  private crewman(job: Job, now: number): void {
    const t = job.team;
    if (!t || !t.live) {
      job.kind = 'assault';
      return;
    }
    const i = t.men.indexOf(job.s);
    // Either side of the tube, behind the sandbags.
    outward(t.pos.x, t.pos.z, _n);
    _a.copy(t.pos).addScaledVector(_n, 1);
    _a.x += (i === 0 ? -1.2 : 1.2) * Math.abs(_n.z);
    _a.z += (i === 0 ? -1.2 : 1.2) * Math.abs(_n.x);
    if (!this.ctx.world.nav.nearest(_a, 3, _a)) _a.copy(t.pos);
    this.send(job, _a, `pit:${t.pit}`, 2, now);
  }

  private mortarTeams(): void {
    const { player } = this.ctx;
    const devices = this.o.commander.devices;
    for (const t of this.teams) {
      if (!t.live) continue;
      t.men = t.men.filter(s => s.e.alive && s.fighting && this.jobs.get(s)?.team === t);
      if (t.men.length === 0 || (t.tube && !t.tube.live)) {
        this.endTeam(t);
        continue;
      }
      let at = false;
      let moving = false;
      for (const s of t.men) {
        if (!this.near(s.e.position, t.pos, FIELD_MORTAR.atPit)) continue;
        at = true;
        if (s.task === 'move' || Math.hypot(s.e.velocity.x, s.e.velocity.z) > 0.6 || s.e.airborne) moving = true;
      }
      const was = t.crew.stage;
      const fire = t.crew.tick(TICK, at, moving);
      if (was === 'moving' && t.crew.stage === 'setup' && !t.tube) {
        t.tube = devices.tube(t.pos, t.yaw + Math.PI);
        t.unmark = this.ctx.hud.follow(t.pos.clone().setY(2.2), 'MORTAR', MARK);
      }
      if (!fire) continue;
      this.counts.salvos++;
      const inside = depthAt(player.position.x, player.position.z) > 0;
      for (let k = 0; k < FIELD_MORTAR.salvo; k++) {
        if (inside && Math.random() < 0.6) _a.copy(player.position);
        else this.wallTarget(t, _a);
        const a = rand(0, Math.PI * 2), r = rand(0, FIELD_MORTAR.scatter);
        _a.x += Math.sin(a) * r;
        _a.z += Math.cos(a) * r;
        this.ctx.world.nav.nearest(_a, 4, _a);
        _b.copy(t.pos);
        _b.y += 1;
        this.shells.fire(_b, _a, { radius: FIELD_MORTAR.radius, damage: FIELD_MORTAR.damage, source: 'mortar', ring: RED, flight: FIELD_MORTAR.flight }, k * 0.8);
      }
    }
  }

  /** A point on the walls the team faces: along the catwalk, or just inside it. */
  private wallTarget(t: Team, out: THREE.Vector3): void {
    outward(t.pos.x, t.pos.z, _n);
    const half = ring('outer').half;
    const lat = rand(-half + 6, half - 6);
    const depth = half - rand(1, 12);
    if (_n.x !== 0) out.set(_n.x * depth, 0, lat);
    else out.set(lat, 0, _n.z * depth);
  }

  private endTeam(t: Team): void {
    t.live = false;
    t.unmark?.();
    t.unmark = null;
    if (t.tube?.live) this.o.commander.devices.disarm(t.tube);
    t.tube = null;
    for (const s of t.men) {
      const job = this.jobs.get(s);
      if (job) {
        job.kind = 'assault';
        job.team = null;
      }
    }
  }

  // ---- bosses and bombers -------------------------------------------------------------------------------------------

  private sieging(now: number, pd: number): void {
    const { world } = this.ctx;
    for (let i = this.siegers.length - 1; i >= 0; i--) {
      const g = this.siegers[i]!;
      const e = g.e;
      if (g.uid !== e.uid || !e.alive) {
        this.siegers.splice(i, 1);
        continue;
      }
      if (Number.isFinite(e.pathDist) || e.entrance !== 'none') continue;
      const p = e.position;
      const depth = depthAt(p.x, p.z);
      // The first ring still sealed between it and the player.
      let target: RingId | null = null;
      for (let d = depth + 1; d <= pd; d++) {
        const id = DEPTH_RING[d]!;
        if (!this.pieces.some(x => x.stage === 'breached' && onRing(x.spec.x, x.spec.z, id))) {
          target = id;
          break;
        }
      }
      if (!target) continue;
      if (!g.piece || g.piece.stage === 'breached' || !onRing(g.piece.spec.x, g.piece.spec.z, target) || now - g.routedAt > 12) {
        g.piece = this.pieceFor(p, target, false);
        if (!g.piece) continue;
        this.faceOf(g.piece, p, e.def.radius + 1.2, g.target);
        world.nav.nearest(g.target, 3, g.target);
        g.routedAt = now;
        g.arrived = false;
        if (!this.o.routes.find(p, g.target, g.route, null, ROUTE_BUDGET)) {
          g.route.clear();
          g.route.x[0] = g.target.x;
          g.route.y[0] = g.target.y;
          g.route.z[0] = g.target.z;
          g.route.count = 1;
        }
        g.route.next = 0;
      }
      if (!g.piece || this.walls!.distance(g.piece, p) > BOSS_REACH + e.def.radius) continue;
      if (e.id === 'bomber') {
        _a.copy(p);
        this.manager.selfDestruct(e);
        world.objects.damageExplosivesInRadius(_a, SATCHEL.reach, BOMBER_WALL, 'bomber');
        continue;
      }
      const bash = BASH[e.id];
      if (!bash) continue;
      world.objects.damageExplosivesInRadius(p, BOSS_REACH + e.def.radius, bash * TICK, e.id);
      this.faceOf(g.piece, p, 0.2, _a).setY(1.2);
      this.ctx.fx.dust(_a, _up, 1.6);
      if (!g.arrived) {
        g.arrived = true;
        this.ctx.audio.play('juggernaut_slam', { position: _a, volume: 0.8 });
      }
    }
  }

  describe(): Record<string, unknown> {
    const jobs: Record<string, number> = {};
    for (const j of this.jobs.values()) jobs[j.kind] = (jobs[j.kind] ?? 0) + 1;
    return {
      jobs, pads: this.pads.length, covers: this.covers.length, satchels: this.satchels.length,
      teams: this.teams.filter(t => t.live).map(t => ({ pit: t.pit, stage: t.crew.stage, men: t.men.length, salvos: t.crew.salvos })),
      siegers: this.siegers.length, counts: { ...this.counts },
    };
  }
}

