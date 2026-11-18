/**
 * Retraining's hands (campaign/missions/retraining.ts, docs/design/tutorial.md): what no system already does, reached by the mission's
 * `tut.*` calls. Subjects held standing with their hands up, begging, as targets; the shop opened outside a break; drills with a retry;
 * the voluntary exit, whose door works from anywhere in the run.
 */
import * as THREE from 'three';
import type { Ctx } from '../core/contracts';
import type { CallInId, ModId, WeaponSystem } from '../core/gameplay';
import { markRetrainingSeen } from '../contracts/firstLaunch';
import type { Enemy } from '../enemies/Enemy';
import type { EnemyManager } from '../enemies/EnemyManager';
import type { CommsKind } from '../enemies/outpost/events';
import { pose, soldierOf } from '../enemies/outpost/soldier';
import { IMPLANTS, type ImplantId, type Loadout as Implants } from '../progression/implants';
import type { CampaignHud } from './hud';
import type { MissionRunner } from './runner';
import type { Mark, Zone } from './types';
import { RETRAINING_LINES } from './missions/retraining.lines';

/** Seconds between a held subject's pleas, and how near the player must be to hear them. */
const BARK = [3.5, 7] as const;
const HEAR = 32;
const PLEAS: readonly CommsKind[] = ['beg', 'surrender', 'panic', 'beg'];
/** How much deeper a sturdy subject's health runs until `tut.mortal`. */
const STURDY = 40;
/** Seconds the last man of his squad fights on alone before he gives up (`tut.yield`). */
const LONE = 4;
/** Rounds the plate has to stop before the shop is offered. */
const STOPPED = 3;
/** Seconds the exit fades over, and the parting line holds the picture before the menu. */
const FADE = 1.6;
const PARTING = 5;
const HOME_FADE = 1.2;
/** Seconds after the nuke goes off that the shock front reaches the shacks. */
const FLATTEN = 1.6;
/** Beats in order, for which parting line the door gets. */
const EARLY = 'crouch', HALF = 'lane', LATE = 'surrender', DONE = 'after';
/** The Jump Jet implant: fitted for its tower, taken off after, so the player learns it is sold at the pod. */
const JET = 'jumpJet';

const NONE: never[] = [];
const _v = new THREE.Vector3();

type Weapons = WeaponSystem & { readonly mods: ReadonlySet<ModId>; readonly fitted: ReadonlySet<ModId>; grantMod(id: ModId): void; fitMod(id: ModId, on: boolean): boolean };

const inside = (z: Zone, p: THREE.Vector3): boolean =>
  p.x >= z.min[0] && p.x <= z.max[0] && p.y >= z.min[1] && p.y <= z.max[1] && p.z >= z.min[2] && p.z <= z.max[2];

export class Retraining {
  /** Held subjects by group, by uid while they live. */
  private readonly groups = new Map<string, Map<number, Enemy>>();
  private readonly told = new Set<string>();
  private readonly awaits = new Set<string>();
  private readonly stopped = new Map<string, number>();
  /** Health each sturdy subject goes back to when he is made mortal again. */
  private readonly sturdy = new Map<number, number>();
  private drill: 'slide' | 'slam' | null = null;
  /** The mission tag whose last man kneels after `LONE` seconds (`tut.yield`): a lesson must not wait on a dice roll. Null is off. */
  private yielding: string | null = null;
  private readonly lone = new Map<number, number>();
  private slid = false;
  private barkIn: number = BARK[0];
  private leaving = -1;
  private homeIn = -1;
  private flattenIn = -1;
  private readonly zero = new THREE.Vector3();

  constructor(private readonly ctx: Ctx, private readonly runner: MissionRunner, private readonly ui: CampaignHud) {
    const { events } = ctx;
    const gone = (uid: number): void => {
      for (const [group, men] of this.groups) {
        if (!men.delete(uid)) continue;
        if (men.size === 0 && !this.told.has(group)) {
          this.told.add(group);
          this.runner.signal(`clear:${group}`);
        }
      }
    };
    events.on('enemy:killed', e => gone(e.enemy.uid));
    events.on('enemy:escaped', e => gone(e.enemy.uid));
    events.on('enemy:hit', e => {
      if (e.result.armour !== 'stopped') return;
      for (const [group, men] of this.groups) {
        if (!men.has(e.enemy.uid)) continue;
        const n = (this.stopped.get(group) ?? 0) + 1;
        this.stopped.set(group, n);
        if (n === STOPPED) this.runner.signal(`stopped:${group}`);
      }
    });
    events.on('player:slam', e => {
      if (this.drill !== 'slam') return;
      if (e.big) this.drill = null;
      else this.retry('slamTop', 'Higher. Jump off the top, then press {slide} in the air: a slam from six metres or more is a big one.');
    });
    events.on('player:landed', () => {
      if (this.drill === 'slam' && inside(this.runner.zone('slamPit'), this.ctx.player.position)) {
        this.retry('slamTop', 'That was a landing. In the air, press {slide} to slam.');
      }
    });
    events.on('callin:used', e => {
      if (e.id !== 'nuke') return;
      this.zero.copy(e.position);
      this.flattenIn = FLATTEN;
    });
  }

  private get manager(): EnemyManager {
    return this.ctx.enemies as EnemyManager;
  }

  private get weapons(): Weapons {
    return this.ctx.weapons as Weapons;
  }

  private mark(id: string): Mark {
    const m = this.runner.mission.marks[id];
    if (!m) throw new Error(`retraining: no mark ${id}`);
    return m;
  }

  private retry(at: string, text: string): void {
    const m = this.mark(at);
    this.ctx.player.teleport(_v.set(...m.at), m.yaw);
    this.ui.hint(text, 7);
  }

  call(name: string, arg = ''): void {
    const { ctx } = this;
    switch (name) {
      case 'tut.begin':
        markRetrainingSeen(EARLY);
        return;
      // `group:light|plated:mark,mark,...`
      case 'tut.held': {
        const [group = 'held', armour = 'light', list = ''] = arg.split(':');
        for (const id of list.split(',').filter(Boolean)) this.hold(group, this.mark(id), armour === 'plated');
        return;
      }
      case 'tut.town':
        for (const id of arg.split(',').filter(Boolean)) this.hold('town', this.mark(id), false);
        return;
      case 'tut.sweep':
        this.sweep();
        return;
      case 'tut.drill':
        this.drill = arg === 'slam' ? 'slam' : 'slide';
        this.slid = false;
        return;
      case 'tut.fit':
        this.weapons.grantMod(arg as ModId);
        this.weapons.fitMod(arg as ModId, true);
        return;
      case 'tut.unfit':
        this.weapons.fitMod(arg as ModId, false);
        return;
      case 'tut.credits':
        (ctx.contracts as unknown as { shop?: { earn(n: number): void } | null }).shop?.earn(Number(arg));
        return;
      case 'tut.pod':
        (ctx.progression as unknown as { pods: { call(at: THREE.Vector3): void } }).pods.call(new THREE.Vector3(...this.mark(arg).at));
        return;
      case 'tut.drain':
        for (const id of this.weapons.owned) {
          const a = this.weapons.ammo(id);
          a.mag = a.reserve = 0;
        }
        return;
      case 'tut.refill':
        for (const id of this.weapons.owned) {
          const a = this.weapons.ammo(id);
          a.mag = a.magSize;
          a.reserve = a.maxReserve;
        }
        return;
      case 'tut.hurt':
        ctx.player.health = Math.min(ctx.player.health, Number(arg));
        ctx.events.emit('player:damaged', { amount: 1, type: 'shock' });
        return;
      case 'tut.callin':
        (ctx.progression as unknown as { grantCallIn(id: CallInId): void }).grantCallIn(arg as CallInId);
        return;
      // A lesson's subject who must not die of the wrong round: a deep pool now, his own health back with `tut.mortal`.
      case 'tut.sturdy':
        for (const e of this.groups.get(arg)?.values() ?? []) {
          this.sturdy.set(e.uid, e.maxHealth);
          e.maxHealth *= STURDY;
          e.health = e.maxHealth;
        }
        return;
      case 'tut.mortal':
        for (const e of this.groups.get(arg)?.values() ?? []) {
          const base = this.sturdy.get(e.uid);
          if (base === undefined) continue;
          e.maxHealth = base;
          e.health = Math.min(e.health, base);
        }
        return;
      case 'tut.await':
        this.awaits.add(arg);
        return;
      case 'tut.yield':
        this.yielding = arg === 'off' ? null : arg;
        this.lone.clear();
        return;
      case 'tut.jumpjet':
        this.jet(arg === 'on');
        return;
      // Names the mission's validator should know this file reads (validate.ts counts a call's arguments as used).
      case 'tut.zones':
        return;
      case 'tut.home':
        this.homeIn = HOME_FADE;
        this.ui.curtain(1);
        return;
      default:
        console.warn(`[retraining] no call ${name}`);
    }
  }

  /** A subject on his mark, hands up, facing the player: no fight, no flight, no surrender to take, the armour he came with. */
  private hold(group: string, at: Mark, plated: boolean): void {
    const { player } = this.ctx;
    _v.set(...at.at);
    let e: Enemy | null = null;
    // A plated lesson needs a man who came with plates: not every role wears a carrier.
    for (let tries = 0; tries < 8; tries++) {
      e = this.manager.spawn('trooper', _v) as Enemy | null;
      if (!e || !plated || e.plates.length > 0) break;
      this.manager.withdraw(e);
      e = null;
    }
    if (!e) return;
    e.attacks = [];
    e.behaviours = NONE;
    e.barkAt = Infinity;
    e.mode = 'hold';
    e.face = 'player';
    e.dummy = true;
    e.yaw = Math.atan2(player.position.x - _v.x, player.position.z - _v.z);
    const s = soldierOf(e);
    if (s) s.holdout = true;
    pose(e, 'handsUp');
    if (!plated) {
      for (const plate of e.plates) plate.mesh.visible = false;
      e.plates = [];
      e.armor = 0;
    }
    let men = this.groups.get(group);
    if (!men) this.groups.set(group, (men = new Map()));
    this.told.delete(group);
    men.set(e.uid, e);
  }

  /** Every held subject off the map, unseen: the next station's are about to need the room. */
  private sweep(): void {
    for (const men of this.groups.values()) {
      for (const e of men.values()) if (e.alive) this.manager.withdraw(e);
      men.clear();
    }
    this.groups.clear();
  }

  /**
   * The last man of the yielding tag still on his feet, fighting or running, kneels after `LONE` seconds. By the mission's own books,
   * not his squad's: a lone survivor merges into another squad, and a broken man runs (flight.ts) rather than fights.
   */
  private watchYield(dt: number): void {
    const o = this.manager.outpost;
    const tag = this.yielding;
    if (!tag || !o || this.runner.left(tag) !== 1) {
      this.lone.clear();
      return;
    }
    const tagOf = (this.runner.host as unknown as { tagOf: ReadonlyMap<number, string> }).tagOf;
    for (const s of o.soldiers) {
      const up = s.e.alive && !s.e.dummy && !s.surrendered && !s.released && !s.cuffed && (s.fighting || s.fate === 'flee');
      if (!up || tagOf.get(s.e.uid) !== tag) continue;
      const t = (this.lone.get(s.e.uid) ?? 0) + dt;
      this.lone.set(s.e.uid, t);
      if (t < LONE) continue;
      this.lone.delete(s.e.uid);
      if (s.fighting) o.collapse(s, 'surrender');
      else {
        s.fate = 'surrender';
        s.e.thinkAt = 0;
      }
    }
  }

  private jet(on: boolean): void {
    if (!Object.hasOwn(IMPLANTS, JET)) return;
    const loadout = (this.ctx.progression as unknown as { loadout?: Implants }).loadout;
    if (!loadout) return;
    // A Move implant needs a slot of its own beside the issued Blood Thirst: the station opens one.
    if (on && !loadout.fit(JET as ImplantId, true) && loadout.openSlot()) loadout.fit(JET as ImplantId, true);
    if (!on) loadout.fit(JET as ImplantId, false);
  }

  private plead(dt: number): void {
    this.barkIn -= dt;
    if (this.barkIn > 0) return;
    this.barkIn = BARK[0] + Math.random() * (BARK[1] - BARK[0]);
    const o = this.manager.outpost;
    if (!o) return;
    const near: Enemy[] = [];
    for (const men of this.groups.values()) {
      for (const e of men.values()) if (e.alive && e.position.distanceTo(this.ctx.player.position) < HEAR) near.push(e);
    }
    const e = near[Math.floor(Math.random() * near.length)];
    const s = e && soldierOf(e);
    if (s) o.comms.say(PLEAS[Math.floor(Math.random() * PLEAS.length)]!, s);
  }

  private watchDrill(): void {
    if (this.drill !== 'slide') return;
    const p = this.ctx.player.position;
    if (inside(this.runner.zone('slot'), p) && this.ctx.player.state === 'slide') this.slid = true;
    if (!inside(this.runner.zone('slotEnd'), p)) return;
    if (this.slid) {
      this.drill = null;
      this.runner.signal('ok:slide');
    } else this.retry('slideStart', 'That was a walk. Run at the slot and press {slide} once before it, at full speed.');
  }

  private watchAwaits(): void {
    for (const want of this.awaits) {
      const [kind, id] = want.split(':');
      const met = kind === 'fitted' ? this.weapons.fitted.has(id as ModId)
        : kind === 'clear' ? this.told.has(id ?? '')
        : kind === 'released' ? this.manager.outpost?.soldiers.some(s => s.released) === true : false;
      if (!met) continue;
      this.awaits.delete(want);
      this.runner.signal(want);
    }
  }

  /** The way out. Any time, from any station: the parting line, the fade, and the menu. */
  private watchExit(dt: number): void {
    if (this.leaving < 0) {
      if (!inside(this.runner.zone('exit'), this.ctx.player.position)) return;
      this.leaving = 0;
      const beat = this.runner.beat?.id ?? 'intake';
      const ids = this.runner.mission.beats.map(b => b.id);
      const at = ids.indexOf(beat);
      const line = at >= ids.indexOf(DONE) ? 'done' : at >= ids.indexOf(LATE) ? 'late' : at >= ids.indexOf(HALF) ? 'half' : at >= ids.indexOf(EARLY) ? 'early' : 'now';
      markRetrainingSeen(line === 'done' ? null : beat);
      this.runner.hush();
      const spoken = RETRAINING_LINES.find(l => l.id === `mission.council.tut.exit.${line}`);
      if (spoken) this.ui.speak(spoken, () => {});
      return;
    }
    this.leaving += this.ctx.time.realDt;
    this.ui.curtain(Math.min(1, this.leaving / FADE));
    if (this.leaving < PARTING) return;
    this.leaving = -1;
    (this.ctx.hud as unknown as { quitToMenu?(): void }).quitToMenu?.();
    void dt;
  }

  update(dt: number): void {
    this.watchExit(dt);
    if (this.leaving >= 0) return;
    this.plead(dt);
    this.watchDrill();
    this.watchAwaits();
    this.watchYield(dt);
    if (this.homeIn >= 0) {
      this.homeIn -= this.ctx.time.realDt;
      if (this.homeIn < 0) {
        const m = this.mark('exitFront');
        this.ctx.player.teleport(_v.set(...m.at), m.yaw);
        this.ui.lift(HOME_FADE);
      }
    }
    if (this.flattenIn >= 0) {
      this.flattenIn -= dt;
      // The nuke takes the people; the shacks go with the front.
      if (this.flattenIn < 0) this.ctx.world.objects?.damageExplosivesInRadius(this.zero, 140, 1e5, 'nuke');
    }
  }

  clear(): void {
    this.groups.clear();
    this.told.clear();
    this.awaits.clear();
    this.stopped.clear();
    this.sturdy.clear();
    this.drill = null;
    this.yielding = null;
    this.lone.clear();
    this.leaving = this.homeIn = this.flattenIn = -1;
  }
}
