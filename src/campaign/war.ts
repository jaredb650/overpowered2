/**
 * The war beside the player's fight (docs/proposals/mission-2-plan.md, section 0: "a war, not a squad walk"). The host owns one and the
 * mission reaches it through `battle`, `stop` and a few `call`s. Nothing here knows Holdfast: it is handed marks, tags and guns.
 *
 *   fronts   another Bailiff squad and the militia across from it. The militia are taken off their squad brain (which plans round the
 *            player) and held on cover by their own ground, facing the Bureau, so the two sides shoot it out where they stand. When the
 *            player walks within JOIN of it, the militia's brain gets them back and the player is in that fight too.
 *   crews    militiamen on mounted guns: the man booked under a tag nearest the gun mans it as an enemy (`occupy(man, true)`), and works
 *            it on the player or on a Bailiff in its arc. His rounds at the player are the gun's; at a Bailiff, `shotAt` at the gun's pace.
 *   charge   one of the player's own walks to a mark, and sets a breaching charge that blows the wall CHARGE.seconds later if he lives.
 *   watch    walls and gates near some marks: the first to be breached, by the charge or by rockets, raises `war:breached`.
 *   calls    both sides' call-outs on the comms feed, text with stable ids (foreclosure.lines.ts, CALLS). Nothing is said out loud.
 */
import * as THREE from 'three';
import type { Ally } from '../allies';
import { CG, type Ctx } from '../core/contracts';
import { rand } from '../core/math';
import type { Enemy } from '../enemies/Enemy';
import type { EnemyManager } from '../enemies/EnemyManager';
import type { SpotQuery, SpotReading } from '../enemies/outpost/cover';
import type { CommsLine } from '../enemies/outpost/events';
import { soldierOf, type Soldier } from '../enemies/outpost/soldier';
import type { Emplacement } from '../vehicles/emplacement';
import type { Callout, CallKind, CallSide, Mark } from './types';

const TICK = 0.4;
/** Metres from either side of a front inside which the player is in that fight, and the militia fight him with their own brain. */
const JOIN = 32;
/** A militiaman further than this from his ground is ordered back to it. */
const GROUND = 9;
/** A gunner: how near the gun a man booked for it has to be to be picked, and to take it. */
const CREW = { pick: 14, take: 1.1, reach: 85, burst: [1.2, 2] as const, rest: [0.7, 1.3] as const, gap: 0.16, damage: 9, miss: 1.4 } as const;
/** The breaching charge: seconds kneeling at the wall once he is there, how near counts as there, and what it does to the wall. */
export const CHARGE = { seconds: 10, there: 1.6, retry: 5, reach: 3.5, wall: 900, radius: 6, damage: 160 } as const;
/** Metres from a watched mark to a wall piece's middle. */
const WATCH = 7;
/** Seconds between any two call-outs, and between two of one front's. Only fights within EARSHOT are heard. */
const CALL_GAP = 2.6;
const FRONT_GAP = 7;
const EARSHOT = 140;

/** What the war needs from the host: whose tag a body is under, and the player's own men. */
export interface WarHost {
  tagOf(uid: number): string | undefined;
  readonly squadMen: readonly Ally[];
  release(tag: string): void;
  signal(name: string): void;
  /** Co-op: a look for the other screens (host.ts, `cue`). Does nothing alone. */
  cue?(name: string, ...args: unknown[]): void;
  /** Co-op: every living player's feet. Unset alone, when the war reads the one player. */
  crowd?(): readonly { x: number; y: number; z: number }[] | undefined;
}

interface Front {
  id: string;
  name: string;
  place: string;
  at: THREE.Vector3;
  from: THREE.Vector3;
  men: Ally[];
  joined: boolean;
  /** Militia seen on this front so far, so a new man after the first lot is a counter-attack. */
  seen: Set<number>;
  calledAt: number;
}

interface Crew {
  gun: Emplacement;
  tag: string;
  man: Enemy | null;
  /** What he is shooting: the player, a Bailiff, or nothing. */
  target: Ally | 'player' | null;
  /** Co-op: the feet of the player he is on, when it is not this screen's own. */
  other: { x: number; y: number; z: number } | null;
  burstUntil: number;
  restUntil: number;
  shotAt: number;
}

interface Charge {
  at: THREE.Vector3;
  man: Ally | null;
  setAt: number;
  retryAt: number;
  label: (() => void) | null;
  shown: number;
  done: boolean;
}

const fill = (text: string, words: Readonly<Record<string, string>>): string =>
  text.replace(/\{(\w+)\}/g, (_, k: string) => {
    const w = words[k.toLowerCase()] ?? '';
    return k[0] === k[0]!.toUpperCase() ? w.charAt(0).toUpperCase() + w.slice(1) : w;
  });

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _dir = new THREE.Vector3();

export class War {
  private readonly fronts = new Map<string, Front>();
  private readonly crews: Crew[] = [];
  private charge: Charge | null = null;
  private readonly watching: (() => void)[] = [];
  private tickIn = 0;
  private calledAt = -99;
  private readonly lastCall = new Map<string, number>();
  private readonly line: CommsLine = { kind: 'ally', text: '', squad: '', speaker: null, enemy: null, position: new THREE.Vector3() };
  private readonly query: SpotQuery = {
    anchor: new THREE.Vector3(), radius: 10, threat: new THREE.Vector3(), near: 8, far: 55, bearing: Number.NaN, bearingSlack: 0,
    needShot: true, spacing: 2.2, uid: 0, from: new THREE.Vector3(), height: 0.3, anyFloor: false,
  };
  private readonly reading: SpotReading = { hidden: false, canShoot: false, side: 0 };
  /** For a test: every call made, by id. */
  readonly said: string[] = [];

  constructor(
    private readonly ctx: Ctx,
    private readonly host: WarHost,
    private readonly calls: readonly Callout[],
    /** Squad names and place words by front id. */
    private readonly names: Readonly<Record<string, { name: string; place: string }>>,
  ) {
    ctx.events.on('ally:down', e => this.onAlly(e.ally, 'down'));
    ctx.events.on('ally:revived', e => this.onAlly(e.ally, 'up'));
    ctx.events.on('ally:dead', e => this.onAlly(e.ally, 'dead'));
  }

  private get now(): number {
    return this.ctx.time.elapsed;
  }

  // -------------------------------------------------------------------------------------------
  // Orders from the mission
  // -------------------------------------------------------------------------------------------

  front(id: string, at: Mark, from: Mark, men: Ally[]): void {
    for (const a of men) a.detached = true;
    const known = this.names[id] ?? { name: 'Bailiffs', place: 'street' };
    this.fronts.set(id, {
      id, name: known.name, place: known.place, at: new THREE.Vector3(...at.at), from: new THREE.Vector3(...from.at), men, joined: false,
      seen: new Set(), calledAt: -99,
    });
    this.say('bureau', 'contact', _a.set(...at.at), id, men[0]?.def.label ?? '', known.name, true);
  }

  end(id: string): void {
    this.fronts.delete(id);
  }

  /** `tag`'s nearest man to `gun` mans it for as long as he lives. */
  crew(gun: Emplacement, tag: string): void {
    if (this.crews.some(c => c.gun === gun)) return;
    this.crews.push({ gun, tag, man: null, target: null, other: null, burstUntil: 0, restUntil: 0, shotAt: 0 });
  }

  /** One of the player's own sets a charge on `at`: the wall there goes CHARGE.seconds after he gets to it, if he lives that long. */
  breach(at: Mark): void {
    if (this.charge && !this.charge.done) return;
    this.charge = { at: new THREE.Vector3(...at.at), man: null, setAt: 0, retryAt: 0, label: null, shown: -1, done: false };
  }

  /** Raises `war:breached` when a wall or gate within WATCH metres of any of these marks is breached, however it went. */
  watch(marks: readonly Mark[]): void {
    let raised = false;
    const breached = (): void => {
      if (raised) return;
      raised = true;
      this.host.signal('war:breached');
    };
    for (const piece of this.ctx.world.objects.structures ?? []) {
      if (piece.kind === 'shack') continue;
      const { x, z } = (piece as unknown as { spec: { x: number; z: number } }).spec;
      if (!marks.some(m => Math.hypot(m.at[0] - x, m.at[2] - z) < WATCH)) continue;
      if (piece.stage === 'breached') breached();
      else this.watching.push(piece.onStageChange(stage => stage === 'breached' && breached()));
    }
  }

  // -------------------------------------------------------------------------------------------
  // Frame
  // -------------------------------------------------------------------------------------------

  update(dt: number): void {
    const now = this.now;
    this.tickIn -= dt;
    if (this.tickIn <= 0) {
      this.tickIn = TICK;
      for (const f of this.fronts.values()) this.hold(f, now);
      for (const c of this.crews) this.man(c, now);
    }
    for (const c of this.crews) this.work(c, now);
    if (this.charge) this.setCharge(this.charge, now);
  }

  clear(): void {
    this.fronts.clear();
    for (const c of this.crews) if (c.man) c.gun.vacate(c.man);
    this.crews.length = 0;
    this.charge?.label?.();
    this.charge = null;
    this.shownCharge?.();
    this.shownCharge = null;
    for (const off of this.watching) off();
    this.watching.length = 0;
    this.calledAt = -99;
    this.lastCall.clear();
  }

  // -------------------------------------------------------------------------------------------
  // Fronts
  // -------------------------------------------------------------------------------------------

  private militia(tag: string, out: Soldier[]): Soldier[] {
    out.length = 0;
    for (const e of this.ctx.enemies.alive) {
      if (this.host.tagOf(e.uid) !== tag) continue;
      const s = soldierOf(e);
      if (s?.fighting) out.push(s);
    }
    return out;
  }

  private readonly men: Soldier[] = [];

  private hold(f: Front, now: number): void {
    const o = (this.ctx.enemies as EnemyManager).outpost;
    if (!o) return;
    const militia = this.militia(f.id, this.men);
    for (let i = f.men.length - 1; i >= 0; i--) if (f.men[i]!.state === 'dead') f.men.splice(i, 1);
    // Co-op: any player walking up to it is in it.
    if (!f.joined && (this.near(f.from, JOIN) || this.near(f.at, JOIN))) {
      f.joined = true;
      for (const s of militia) s.squad.directed = false;
    }
    let fresh = 0;
    for (const s of militia) {
      if (!f.seen.has(s.e.uid)) {
        f.seen.add(s.e.uid);
        fresh++;
      }
    }
    if (fresh > 0 && f.seen.size > fresh) this.say('militia', 'counter', militia[0]!.e.center, f.id, '', 'Holdfast');
    else if (fresh > 0) this.say('militia', 'contact', militia[0]!.e.center, f.id, '', 'Holdfast');
    if (f.joined) {
      // The player is in it: anyone arriving later fights him with his own brain too.
      for (const s of militia) s.squad.directed = false;
      return;
    }
    if (militia.length > 0) this.host.release(f.id);
    for (const s of militia) {
      s.squad.directed = true;
      s.silent = false;
      if (s.hasOrder || s.task === 'move') continue;
      if (s.spot && s.e.position.distanceTo(f.from) < GROUND) continue;
      this.coverFor(s, f);
    }
    // The fight's own noise, from whichever side still has men in it.
    if (now - f.calledAt > FRONT_GAP + rand(0, 4) && militia.length > 0 && f.men.length > 0) {
      const bureau = Math.random() < 0.5;
      const who = bureau ? f.men[Math.floor(Math.random() * f.men.length)]! : null;
      if (this.say(bureau ? 'bureau' : 'militia', 'fire', bureau ? who!.body.center : militia[0]!.e.center, f.id, who?.def.label ?? '', bureau ? f.name : 'Holdfast')) {
        f.calledAt = now;
      }
    }
    if (militia.length === 0 && f.seen.size > 0 && f.men.length > 0 && now - f.calledAt > FRONT_GAP) {
      if (this.say('bureau', 'clear', f.at, f.id, f.men[0]!.def.label, f.name)) f.calledAt = now + 30;
    }
  }

  /** A spot by the militia's own ground with a shot at the Bureau's, or the ground itself. */
  private coverFor(s: Soldier, f: Front): void {
    const o = (this.ctx.enemies as EnemyManager).outpost!;
    const q = this.query;
    q.anchor.copy(f.from);
    q.threat.copy(f.at).setY(f.at.y + 1.5);
    q.uid = s.e.uid;
    q.from.copy(s.e.position);
    const spot = o.cover.pick(q, this.reading);
    if (spot) {
      o.order(s, spot.position, spot, 1, rand(0, 0.6));
      o.fireFrom(s, spot, this.reading);
      return;
    }
    _a.set(f.from.x + rand(-4, 4), f.from.y, f.from.z + rand(-4, 4));
    if (this.ctx.world.nav.nearest(_a, 6, _a)) o.order(s, _a, null, 1, rand(0, 0.6));
  }

  // -------------------------------------------------------------------------------------------
  // Gun crews
  // -------------------------------------------------------------------------------------------

  /** Keeps a man on the gun: picks one, walks him to it, puts him on it. */
  private man(c: Crew, now: number): void {
    const o = (this.ctx.enemies as EnemyManager).outpost;
    if (!o) return;
    const s = c.man ? soldierOf(c.man) : undefined;
    if (c.man && (!c.man.alive || !s?.fighting)) {
      c.gun.vacate(c.man);
      c.man = null;
      c.target = null;
    }
    if (!c.man) {
      let best: Enemy | null = null;
      let bestD: number = CREW.pick;
      for (const e of this.ctx.enemies.alive) {
        if (this.host.tagOf(e.uid) !== c.tag || this.crews.some(k => k.man === e)) continue;
        const d = e.position.distanceTo(c.gun.standAt);
        if (d < bestD && soldierOf(e)?.fighting) {
          bestD = d;
          best = e as Enemy;
        }
      }
      if (!best) return;
      c.man = best;
    }
    const man = soldierOf(c.man)!;
    man.squad.directed = true;
    man.silent = true;
    if (c.gun.occupant === c.man) {
      this.aim(c);
      return;
    }
    if (c.gun.occupant) return;
    if (c.man.position.distanceTo(c.gun.standAt) <= CREW.take) {
      if (c.gun.occupy(c.man, true)) this.say('militia', 'gun', c.gun.pivot, c.tag, '', 'Holdfast');
    } else if (!man.hasOrder) o.order(man, c.gun.standAt, null, 2, 0);
  }

  /** What he swings onto: the player in the arc and in sight, else the nearest Bailiff who is. */
  private aim(c: Crew): void {
    const { gun } = c;
    const { player } = this.ctx;
    c.target = null;
    c.other = null;
    if (player.alive && !player.parked && this.canSee(gun, player.eye)) {
      c.target = 'player';
      return;
    }
    // Co-op: the gun is the team's problem. Any other player in the arc and in sight will do.
    const crowd = this.host.crowd?.();
    for (let i = 0; crowd && i < crowd.length; i++) {
      const p = crowd[i]!;
      if (Math.abs(p.x - player.position.x) + Math.abs(p.z - player.position.z) < 0.5) continue;
      if (!this.canSee(gun, _a.set(p.x, p.y + 1.5, p.z))) continue;
      c.target = 'player';
      c.other = p;
      return;
    }
    let bestD: number = CREW.reach;
    for (const a of this.ctx.allies?.allies ?? []) {
      if (a.state !== 'up') continue;
      const d = a.body.center.distanceTo(gun.pivot);
      if (d < bestD && this.canSee(gun, a.body.center)) {
        bestD = d;
        c.target = a;
      }
    }
  }

  private canSee(gun: Emplacement, at: THREE.Vector3): boolean {
    _dir.subVectors(at, gun.pivot);
    const d = _dir.length();
    if (d > CREW.reach) return false;
    const yaw = Math.atan2(-_dir.x, -_dir.z);
    const off = Math.abs(Math.atan2(Math.sin(yaw - gun.spec.yaw), Math.cos(yaw - gun.spec.yaw)));
    if (off > gun.spec.arc) return false;
    _dir.divideScalar(d);
    // From just in front of the shield, so the gun's own plate does not block the look.
    _b.copy(gun.pivot).addScaledVector(_dir, 1.2);
    return !this.ctx.physics.raycast(_b, _dir, Math.max(0, d - 1.6), CG.World);
  }

  /** The trigger, in bursts, on whatever `aim` chose. */
  private work(c: Crew, now: number): void {
    const { gun } = c;
    if (!c.man || gun.occupant !== c.man) return;
    const t = c.target;
    if (!t || (t !== 'player' && t.state !== 'up')) {
      gun.trigger(false);
      return;
    }
    if (t === 'player' && c.other) gun.aimAt(_a.set(c.other.x, c.other.y + 1.2, c.other.z));
    else gun.aimAt(t === 'player' ? _a.copy(this.ctx.player.position).setY(this.ctx.player.position.y + 1.2) : t.body.center);
    if (now >= c.burstUntil && now >= c.restUntil) {
      c.burstUntil = now + rand(...CREW.burst);
      c.restUntil = c.burstUntil + rand(...CREW.rest);
    }
    const firing = now < c.burstUntil && !gun.heat.overheated;
    gun.trigger(firing);
    // The gun's own rounds only meet the player, so a Bailiff under it is hit at its pace here.
    if (firing && t !== 'player' && now - c.shotAt >= CREW.gap) {
      c.shotAt = now;
      t.shotAt(gun.pivot, CREW.damage, CREW.miss, 'enemy_emplacement');
    }
  }

  // -------------------------------------------------------------------------------------------
  // The breaching charge
  // -------------------------------------------------------------------------------------------

  private setCharge(c: Charge, now: number): void {
    if (c.done) return;
    const allies = this.ctx.allies;
    if (!allies) return;
    if (c.man && c.man.state !== 'up') {
      // Down or dead with it in his hands: someone else goes when it is safe to.
      c.man = null;
      c.setAt = 0;
      c.retryAt = now + CHARGE.retry;
      this.unlabel(c);
    }
    if (!c.man) {
      if (now < c.retryAt) return;
      c.man = this.host.squadMen.find(a => a.state === 'up' && a.def.label !== 'Medic') ?? this.host.squadMen.find(a => a.state === 'up') ?? null;
      if (!c.man) return;
      c.man.post.copy(c.at);
      // No radius: straight to the wall, not into the nearest cover by it.
      c.man.postRadius = 0;
      allies.setOrder(c.man, 'post');
      c.man.thinkAt = 0;
      this.say('bureau', 'charge', c.man.body.center, '', c.man.def.label, '14th', true);
      return;
    }
    // His job, whatever the player has told him since.
    if (c.man.order !== 'post') allies.setOrder(c.man, 'post');
    if (c.setAt === 0) {
      if (c.man.body.position.distanceTo(c.at) > CHARGE.there) return;
      c.setAt = now;
      this.ctx.audio.play('grenade_pin', { position: c.at });
    }
    const left = Math.ceil(CHARGE.seconds - (now - c.setAt));
    if (left !== c.shown) {
      c.shown = left;
      this.unlabel(c);
      c.label = this.ctx.hud.follow(_a.copy(c.at).setY(c.at.y + 2.2), `CHARGE ${Math.max(0, left)}   KEEP HIM ALIVE`, '#ff5a3a');
      this.ctx.audio.play('bomber_beep', { position: c.at, volume: 0.7 });
      this.host.cue?.('charge', c.at.toArray(), Math.max(0, left));
    }
    if (now - c.setAt < CHARGE.seconds) return;
    this.blow(c);
  }

  private blow(c: Charge): void {
    const { ctx } = this;
    c.done = true;
    this.unlabel(c);
    _a.copy(c.at).setY(c.at.y + 0.8);
    ctx.combat.explode(_a, { radius: CHARGE.radius, damage: CHARGE.damage, kind: 'rocket', source: 'ally_charge', team: 'player', selfDamage: 0.4, scale: 1.6 });
    ctx.world.objects.damageExplosivesInRadius(c.at, CHARGE.reach, CHARGE.wall, 'satchel');
    if (c.man) {
      c.man.postRadius = 4;
      ctx.allies?.setOrder(c.man, 'follow');
    }
    this.say('bureau', 'breach', c.at, '', c.man?.def.label ?? '', '14th', true);
  }

  private unlabel(c: Charge): void {
    if (c.label) this.host.cue?.('charge', c.at.toArray(), -1);
    c.label?.();
    c.label = null;
    c.shown = -1;
  }

  /** Co-op, on a guest: the host's charge counting down over its man. Below 0 takes the label off. */
  private shownCharge: (() => void) | null = null;
  showCharge(at: THREE.Vector3, left: number): void {
    this.shownCharge?.();
    this.shownCharge = null;
    if (left < 0) return;
    this.shownCharge = this.ctx.hud.follow(at.clone().setY(at.y + 2.2), `CHARGE ${Math.min(99, Math.round(left))}   KEEP HIM ALIVE`, '#ff5a3a');
    this.ctx.audio.play('bomber_beep', { position: at, volume: 0.7 });
  }

  /** Co-op, on a guest: one of the host's call-outs, on this player's feed if the fight is in their earshot. */
  heard(text: string, speaker: string | null, squad: string, at: THREE.Vector3, bureau: boolean): void {
    if (at.distanceTo(this.ctx.player.position) > EARSHOT) return;
    const { line } = this;
    line.kind = bureau ? 'ally' : 'contact';
    line.text = text;
    line.squad = squad;
    line.speaker = speaker;
    line.position.copy(at);
    this.ctx.events.emit('comms:line', line);
  }

  /** The player within `metres` of a point: alone the one player, in co-op any living one. */
  private near(at: THREE.Vector3, metres: number): boolean {
    if (at.distanceTo(this.ctx.player.position) < metres) return true;
    const crowd = this.host.crowd?.();
    for (let i = 0; crowd && i < crowd.length; i++) {
      const p = crowd[i]!;
      if (Math.hypot(p.x - at.x, p.y - at.y, p.z - at.z) < metres) return true;
    }
    return false;
  }

  // -------------------------------------------------------------------------------------------
  // Call-outs
  // -------------------------------------------------------------------------------------------

  private onAlly(a: Ally, kind: 'down' | 'up' | 'dead'): void {
    for (const f of this.fronts.values()) {
      if (!f.men.includes(a)) continue;
      this.say('bureau', kind, a.body.center, f.id, a.def.label, f.name, kind !== 'up');
      return;
    }
  }

  /** One line, from `side`, unless it is too soon or too far off to be heard. True if it went out. */
  private say(side: CallSide, kind: CallKind, at: THREE.Vector3, front: string, label: string, who: string, urgent = false): boolean {
    const now = this.now;
    if (!urgent && now - this.calledAt < CALL_GAP) return false;
    // Co-op: said if any player is in earshot, and each hears it only if they are (`heard`).
    const mine = at.distanceTo(this.ctx.player.position) <= EARSHOT;
    if (!mine && !this.near(at, EARSHOT)) return false;
    const rows = this.calls.filter(c => c.side === side && c.kind === kind);
    if (rows.length === 0) return false;
    const key = `${side}.${kind}`;
    const last = this.lastCall.get(key) ?? -1;
    const i = rows.length < 2 ? 0 : (last + 1 + Math.floor(Math.random() * (rows.length - 1))) % rows.length;
    this.lastCall.set(key, i);
    this.calledAt = now;
    const row = rows[i]!;
    const { line } = this;
    line.kind = side === 'bureau' ? 'ally' : 'contact';
    line.text = fill(row.text, { label: label.toLowerCase(), place: this.fronts.get(front)?.place ?? this.names[front]?.place ?? 'street' });
    line.squad = who;
    line.speaker = side === 'bureau' && label ? `${label}, ${who}` : who;
    line.position.copy(at);
    this.said.push(row.id);
    if (mine) this.ctx.events.emit('comms:line', line);
    this.host.cue?.('callout', line.text, line.speaker, line.squad, at.toArray(), side === 'bureau');
    return true;
  }
}
