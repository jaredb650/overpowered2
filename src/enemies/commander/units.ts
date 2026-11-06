/**
 * The men who work for the Commander and not for a squad leader. A squad with `directed` set skips its own brain, and everything it
 * does comes from here: go to this post, stay there, do this job. They still see, hear, bleed and break like anyone else, because the
 * whole point of a spotter is that he is a man you can kill.
 *
 * When the rest of the wave is gone the posts are abandoned and they hunt the player as a normal squad, because a wave must never
 * stall on a man sitting in a far corner of the yard.
 */
import * as THREE from 'three';
import type { PostureName } from '../../characters/animation/postures';
import { HumanoidBone as B } from '../../characters/rig';
import { chance, rand, TAU } from '../../core/math';
import type { Enemy } from '../Enemy';
import { pose, type Soldier } from '../outpost/soldier';
import { soldierAttacks } from '../outpost/weapons';
import type { SquadPlan, UnitKind } from './director';
import type { Commander } from './index';
import type { PropKind } from './props';

/** Seconds between looks at the job, per man. Staggered, and far slower than a frame: a post does not need a frame. */
const TICK = 0.4;
/** Close enough to the post to call it arrived. */
const AT_POST = 2.2;
/** Seconds without sight of the player before an observer finds new ground. */
const OBSERVER_PATIENCE = 7;
const SNIPER_PATIENCE = 11;
/** A man with a job puts it down and picks up his rifle inside this. */
const SELF_DEFENCE = 13;
const SPOTTER_RANGE: readonly [number, number] = [16, 48];
const SNIPER_RANGE: readonly [number, number] = [22, 62];
/** The shortest line an observer will settle for, and how long before he looks for one again if there is nothing at all. */
const CLOSEST_LINE = 10;
const LOOK_AGAIN = 2;
/** Hiders hold their fire until the player is this close, or has walked past them. */
const AMBUSH_RANGE = 7.5;
/** A radio click, just loud enough to warn someone listening. */
const AMBUSH_WARNING = 14;
/** A man who has been lying still for this long has been forgotten by everyone but the player. Nothing holds a wave open for ever. */
const HIDE_LIMIT = 75;
const LANE_FIRE_REACH = 5;
/** Metres from the bait at which the trap closes. */
const BAIT_RANGE = 17;
const BAIT_SHELLS = 6;
const POSSUM_RANGE = 7;
const CASUALTY_RANGE = 5;
const CASUALTY_FUSE = 1.1;
const CASUALTY_BLAST = 6.5;
const CASUALTY_DAMAGE = 50;
const SCREAM_EVERY = 3.4;
const FEIGN_RANGE = 6;
const PIN_SECONDS = 1;
const FEIGN_LIMIT = 28;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

/** What each job wears. */
const WORN: Partial<Record<UnitKind, PropKind>> = { spotter: 'designator', jammer: 'whip', radio: 'mast', hider: 'foil', casualty: 'vest', feign: 'grenade' };

export class Unit {
  kind: UnitKind = 'guard';
  s!: Soldier;
  readonly post = new THREE.Vector3();
  /** A post has been chosen. */
  placed = false;
  arrived = false;
  /** Set while the Commander holds his body in one pose. */
  pose: PostureName | null = null;
  tickAt = 0;
  /** Last time he saw the player. */
  sawAt = 0;
  /** What step of a trick he is on. */
  step = 0;
  /** When that step ends. */
  until = 0;
  /** A laser, for a man holding a line. */
  laser = -1;
  /** Index of the door a lane covers. */
  door = -1;
  /** A spot to watch, when it is not the player. */
  readonly watch = new THREE.Vector3();
}

const UNITS = new WeakMap<Soldier, Unit>();
export const unitOf = (s: Soldier): Unit | undefined => UNITS.get(s);

export class Units {
  readonly list: Unit[] = [];
  /** The plan for each directed squad this wave, by its place in the queue. */
  private plans: (SquadPlan | null)[] = [];
  private forming: SquadPlan | null = null;
  private seat = 0;
  private released = false;

  constructor(private readonly c: Commander) {}

  reset(): void {
    this.list.length = 0;
    this.plans = [];
    this.forming = null;
    this.seat = 0;
    this.released = false;
  }

  /** `plans` lines up with the wave's squads: null for a squad that thinks for itself. */
  setPlans(plans: (SquadPlan | null)[]): void {
    this.plans = plans;
    this.forming = null;
    this.released = false;
  }

  /** The wave loop opened a squad at this place in its queue. */
  onSquadFormed(index: number): void {
    const plan = this.plans[index] ?? null;
    this.forming = plan;
    this.seat = 0;
    if (plan) this.c.o.squads[this.c.o.squads.length - 1]!.directed = true;
  }

  /** A man came through the gate. If his squad is directed he has a job. */
  onSpawn(s: Soldier): void {
    const plan = this.forming;
    if (!plan || !s.squad.directed) return;
    const kind = plan.jobs[this.seat++] ?? 'guard';
    this.enrol(s, kind);
  }

  enrol(s: Soldier, kind: UnitKind): Unit {
    const u = new Unit();
    u.kind = kind;
    u.s = s;
    u.tickAt = this.c.w.now + rand(0.1, TICK);
    u.sawAt = this.c.w.now;
    UNITS.set(s, u);
    this.list.push(u);
    const prop = WORN[kind];
    if (prop) this.c.props.fit(s.e.char, prop);
    if (kind === 'spotter' || kind === 'jammer' || kind === 'radio' || kind === 'hider') s.e.attacks = [];
    return u;
  }

  /** A man leaves the list, for any reason. */
  drop(s: Soldier): void {
    const u = UNITS.get(s);
    if (!u) return;
    this.endLaser(u);
    UNITS.delete(s);
    const i = this.list.indexOf(u);
    if (i >= 0) this.list.splice(i, 1);
  }

  /** The first man still doing this job. */
  first(kind: UnitKind): Unit | null {
    for (const u of this.list) if (u.kind === kind && u.s.fighting && u.s.e.alive) return u;
    return null;
  }

  count(kind: UnitKind): number {
    let n = 0;
    for (const u of this.list) if (u.kind === kind && u.s.fighting && u.s.e.alive) n++;
    return n;
  }

  /** The man's head. A spotter's line has to leave from something you can aim at. */
  eyeOf(u: Unit, out: THREE.Vector3): THREE.Vector3 {
    const head = u.s.e.char.bones[B.head];
    if (head) head.getWorldPosition(out);
    else out.copy(u.s.e.center);
    return out;
  }

  /** How many men on the field still take orders from their own squad. */
  private regulars(): number {
    let n = 0;
    for (const q of this.c.o.squads) if (!q.directed) n += q.fighters();
    return n;
  }

  update(): void {
    const { c } = this;
    const now = c.w.now;
    for (let i = this.list.length - 1; i >= 0; i--) {
      // An ambush going off takes several men off this list at once, so the slot may already be empty.
      const u = this.list[i];
      if (!u) continue;
      if (u.laser >= 0) this.holdLaser(u);
      if (now < u.tickAt) continue;
      u.tickAt = now + TICK;
      if (!u.s.e.alive || (!u.s.fighting && u.kind !== 'casualty')) {
        this.drop(u.s);
        continue;
      }
      this.tick(u, now);
    }
    if (!this.released && c.o.waves.phase === 'clearing' && this.list.length > 0 && this.regulars() === 0) this.abandonPosts();
  }

  /** Nobody is left to hold the line for. Everyone with a post comes looking. */
  private abandonPosts(): void {
    const { c } = this;
    this.released = true;
    c.radio('radio.posts.abandon', null);
    for (const u of [...this.list]) {
      if (u.kind === 'casualty') this.detonate(u);
      else this.stand(u);
    }
  }

  /** Back to being an ordinary man in an ordinary squad. */
  private stand(u: Unit): void {
    const s = u.s;
    s.squad.directed = false;
    s.e.attacks = soldierAttacks(s.e.id);
    s.e.thinkAt = 0;
    s.e.behaviourUntil = 0;
    u.pose = null;
    this.drop(s);
  }

  private tick(u: Unit, now: number): void {
    const s = u.s;
    if (s.sees) u.sawAt = now;
    switch (u.kind) {
      case 'mortar': this.crew(u); break;
      case 'spotter': this.observe(u, now, OBSERVER_PATIENCE, SPOTTER_RANGE); break;
      case 'sniper': this.observe(u, now, SNIPER_PATIENCE, SNIPER_RANGE); break;
      case 'jammer':
      case 'radio':
        this.backRoom(u);
        break;
      case 'manpads': this.backRoom(u); break;
      case 'guard': this.guard(u); break;
      case 'hider': this.hide(u, now); break;
      case 'lane': this.lane(u, now); break;
      case 'bait': this.bait(u); break;
      case 'possum': this.possum(u); break;
      case 'casualty': this.casualty(u, now); break;
      case 'feign': this.feign(u, now); break;
    }
  }

  private goTo(u: Unit, urgency: 0 | 1 | 2): void {
    const s = u.s;
    if (s.e.position.distanceTo(u.post) < AT_POST) {
      u.arrived = true;
      return;
    }
    u.arrived = false;
    if (s.task === 'move' || s.hasOrder) return;
    this.c.o.order(s, u.post, null, urgency, 0);
  }

  private crew(u: Unit): void {
    const { mortars } = this.c;
    if (!mortars.siteReady) return;
    if (!u.placed) {
      const a = rand(0, TAU);
      u.post.set(mortars.site.x + Math.sin(a) * 1.5, mortars.site.y, mortars.site.z + Math.cos(a) * 1.5);
      u.placed = true;
    }
    this.goTo(u, 1);
  }

  /** Wants a line on the player from a long way off, from somewhere the player is not looking. */
  private observe(u: Unit, now: number, patience: number, range: readonly [number, number]): void {
    const { c } = this;
    const s = u.s;
    const close = s.e.dist < SELF_DEFENCE;
    if (u.kind === 'spotter') s.e.attacks = close ? soldierAttacks(s.e.id) : [];
    if (close) return;
    if (!u.placed || (u.arrived && !s.sees && now - u.sawAt > patience)) {
      // A close line beats none. The far band is what he wants, and the near one is what a room full of walls may leave him.
      if (c.posts.overwatch(c.w.player.position, range[0], range[1], c.highGround, _a) || c.posts.overwatch(c.w.player.position, CLOSEST_LINE, range[0], true, _a)) {
        u.post.copy(_a);
        u.placed = true;
        u.arrived = false;
        u.sawAt = now;
      } else u.tickAt = now + LOOK_AGAIN;
    }
    if (u.placed) this.goTo(u, 2);
  }

  /** Somewhere a long walk from the player, inside the building, so finding him is a decision. */
  private backRoom(u: Unit): void {
    const { c } = this;
    if (!u.placed) {
      if (!c.posts.farRoom(u.kind === 'manpads' ? 18 : 30, _a)) return;
      u.post.copy(_a);
      u.placed = true;
    }
    this.goTo(u, 1);
  }

  private guard(u: Unit): void {
    const lead = u.s.squad.members[0];
    if (!lead || lead === u.s) return;
    const boss = unitOf(lead);
    if (!boss?.placed) return;
    const a = rand(0, TAU);
    if (!u.placed || u.post.distanceTo(boss.post) > 6) {
      _a.set(boss.post.x + Math.sin(a) * 2.6, boss.post.y, boss.post.z + Math.cos(a) * 2.6);
      if (this.c.w.ctx.world.nav.nearest(_a, 3, _b)) {
        u.post.copy(_b);
        u.placed = true;
      }
    }
    if (u.placed) this.goTo(u, 1);
  }

  private hide(u: Unit, now: number): void {
    const { c } = this;
    const s = u.s;
    if (!u.placed) {
      if (!c.posts.ambush(s.seat, _a)) return;
      u.post.copy(_a);
      u.placed = true;
      u.until = now + HIDE_LIMIT;
    }
    if (u.step === 0) {
      this.goTo(u, 1);
      if (!u.arrived) return;
      u.step = 1;
      u.pose = 'cover';
      s.e.thinkAt = 0;
      s.e.behaviourUntil = 0;
      return;
    }
    const d = s.e.dist;
    if (u.step === 1 && d < AMBUSH_WARNING) {
      u.step = 2;
      c.w.ctx.audio.play('vox_radio', { position: s.e.center, volume: 0.28, pitch: 1.4 });
    }
    const shot = s.e.health < s.e.maxHealth || now < s.scaredAt + 0.5;
    if (d < AMBUSH_RANGE || shot || now >= u.until) this.spring(s.squad);
  }

  /** Everyone in the room at once, which is the only way an ambush works. */
  private spring(squad: Soldier['squad']): void {
    const { c } = this;
    c.radio('radio.ambush.spring', squad.members[0] ?? null);
    for (const u of [...this.list]) {
      if (u.s.squad === squad && u.kind === 'hider') {
        c.props.remove(u.s.e.char, 'foil');
        this.stand(u);
      }
    }
  }

  private lane(u: Unit, now: number): void {
    const { c } = this;
    const s = u.s;
    if (!u.placed) {
      if (!c.posts.lane(s.seat, u.watch, _a)) return;
      u.post.copy(_a);
      u.placed = true;
    }
    this.goTo(u, 1);
    if (!u.arrived) return;
    if (u.laser < 0) u.laser = c.w.telegraphs.acquireLaser(0xff2030, 0.28);
    // Told to keep this door shut. Holding fire on it is exactly the job `suppressing` was built for.
    const q = s.squad;
    q.threat.copy(u.watch);
    q.knownAt = now;
    s.team = 0;
    q.movingTeam = 1;
    q.coverFireUntil = c.w.player.position.distanceTo(u.watch) < LANE_FIRE_REACH ? now + 1.5 : 0;
  }

  private holdLaser(u: Unit): void {
    const t = this.c.w.telegraphs;
    this.eyeOf(u, _a);
    t.aimLaser(u.laser, _a, u.watch);
  }

  private endLaser(u: Unit): void {
    if (u.laser >= 0) this.c.w.telegraphs.releaseLaser(u.laser);
    u.laser = -1;
  }

  private bait(u: Unit): void {
    const { c } = this;
    const s = u.s;
    if (!u.placed) {
      if (!c.posts.openGround(s.seat, _a)) return;
      u.post.copy(_a);
      u.placed = true;
    }
    this.goTo(u, 1);
    if (u.step === 0 && u.arrived) {
      u.step = 1;
      c.radio('radio.bait.hold', s);
    }
    if (u.step === 1 && s.e.dist < BAIT_RANGE && c.mortars.call(s.e.position, 'mortar', BAIT_SHELLS)) {
      for (const o of this.list) if (o.kind === 'bait') o.step = 2;
      c.radio('radio.bait.sprung', s);
    }
  }

  /** Lies where he was put until the player's back is to him. */
  private possum(u: Unit): void {
    const { c } = this;
    const s = u.s;
    const p = c.w.player;
    if (s.e.health < s.e.maxHealth) {
      this.rise(u);
      return;
    }
    if (s.e.dist > POSSUM_RANGE) return;
    _a.subVectors(s.e.position, p.position).setY(0).normalize();
    if (_a.dot(p.forward) < 0.1) this.rise(u);
  }

  private rise(u: Unit): void {
    const s = u.s;
    const e = s.e;
    this.c.radio('radio.possum.rise', s);
    e.yaw = Math.atan2(this.c.w.player.position.x - e.position.x, this.c.w.player.position.z - e.position.z);
    s.alertUntil = this.c.w.now + 6;
    s.notice = 1;
    this.stand(u);
  }

  private casualty(u: Unit, now: number): void {
    const s = u.s;
    const { audio } = this.c.w.ctx;
    if (now >= u.until && u.step === 0) {
      u.until = now + SCREAM_EVERY;
      this.c.o.comms.say('scream', s);
      audio.play('vox_scream', { position: s.e.center, volume: 0.85 });
      s.calledAt = now;
    }
    if (u.step === 1) {
      if (now >= u.until) this.detonate(u);
      else audio.play('bomber_beep', { position: s.e.center, pitch: 1.6 });
      return;
    }
    audio.play('bomber_beep', { position: s.e.center, volume: 0.35, pitch: 1.1 });
    if (s.e.dist < CASUALTY_RANGE) {
      u.step = 1;
      u.until = now + CASUALTY_FUSE;
    }
  }

  private detonate(u: Unit): void {
    const { c } = this;
    _a.copy(u.s.e.position);
    const e = u.s.e;
    this.drop(u.s);
    c.props.remove(e.char, 'vest');
    c.boom(_a, CASUALTY_BLAST, CASUALTY_DAMAGE, 'rigged');
  }

  /** A shot-up man with a vest on goes off where he lies, which is the counterplay. */
  casualtyShot(s: Soldier): void {
    const u = UNITS.get(s);
    if (u?.kind === 'casualty') this.detonate(u);
  }

  /** On his knees, hands high, one of them full. */
  private feign(u: Unit, now: number): void {
    const { c } = this;
    const s = u.s;
    if (u.step === 0) {
      u.step = 1;
      u.pose = 'handsUp';
      u.until = now + FEIGN_LIMIT;
      c.o.comms.say('surrender', s);
      s.e.thinkAt = 0;
      s.e.behaviourUntil = 0;
      return;
    }
    if (u.step === 1) {
      if (u.pose === 'handsUp' && s.e.dist < 12) u.pose = 'kneel';
      if (s.e.dist < 9) c.o.comms.say('surrender', s);
      if (s.e.dist < FEIGN_RANGE && s.e.hasLos) {
        u.step = 2;
        u.until = now + PIN_SECONDS;
        c.w.ctx.audio.play('grenade_pin', { position: s.e.center, volume: 1.2 });
        c.w.telegraphs.glint(s.e.center, 0xff2010, 0.55, PIN_SECONDS);
      } else if (now >= u.until) this.leaveFeign(u);
      return;
    }
    if (now >= u.until) {
      s.grenades = Math.max(s.grenades, 1);
      c.o.dropLiveGrenade(s);
      c.tracker.trapped('falseSurrender', 0);
      this.leaveFeign(u);
    }
  }

  /** It worked or nobody came, and either way he has left his squad. He runs for a gate like any other broken man. */
  private leaveFeign(u: Unit): void {
    const s = u.s;
    this.c.props.remove(s.e.char, 'grenade');
    this.drop(s);
    s.fate = 'flee';
    s.e.thinkAt = 0;
    s.e.behaviourUntil = 0;
  }

  /** The body the Commander put on the floor before the wave began. */
  placeBody(kind: 'possum' | 'casualty', at: THREE.Vector3): Enemy | null {
    const { o, manager } = this.c;
    o.formSquad(1);
    const squad = o.squads[o.squads.length - 1]!;
    squad.directed = true;
    this.forming = null;
    const e = manager.spawn('trooper', at);
    if (!e) return null;
    const s = o.soldierOf(e)!;
    const u = this.enrol(s, kind);
    u.placed = u.arrived = true;
    u.post.copy(at);
    u.pose = 'downed';
    u.until = this.c.w.now + rand(0.5, 1.5);
    e.attacks = [];
    pose(e, 'downed');
    e.thinkAt = 0;
    return e;
  }

  /** Called with a man whose nerve has gone. True if he is keeping the grenade. */
  feignFor(s: Soldier, odds: number): boolean {
    if (!chance(odds) || UNITS.has(s) || s.weapon !== 'primary') return false;
    s.squad.leave(s);
    if (s.spot) s.spot.claimedBy = 0;
    s.spot = null;
    s.hasOrder = false;
    s.task = 'hold';
    s.morale = 40;
    s.state = 'panicked';
    s.e.attacks = [];
    this.enrol(s, 'feign');
    s.e.thinkAt = 0;
    s.e.behaviourUntil = 0;
    return true;
  }
}
