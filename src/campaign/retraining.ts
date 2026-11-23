/**
 * Retraining's hands (campaign/missions/retraining.ts, docs/design/tutorial.md): what no system already does, reached by the mission's
 * `tut.*` calls. Subjects held standing with their hands up, begging, as targets; the shop opened outside a break; drills with a retry;
 * continuous anti-softlock watchdogs across every station (mobility pits, rocket ammo, shop credits, grenades, stim regen cap, Gun Kata
 * ring reset, and full Yard surrender/question/release/capture recovery with bleedout stabilization); and the voluntary exit door.
 */
import * as THREE from 'three';
import type { Ctx } from '../core/contracts';
import type { CallInId, ModId, WeaponId, WeaponSystem } from '../core/gameplay';
import { markRetrainingSeen } from '../contracts/firstLaunch';
import type { Enemy } from '../enemies/Enemy';
import type { EnemyManager } from '../enemies/EnemyManager';
import type { CommsKind } from '../enemies/outpost/events';
import { pose, soldierOf, type Soldier } from '../enemies/outpost/soldier';
import { IMPLANTS, type ImplantId, type Loadout as Implants } from '../progression/implants';
import { ROCKET_LEDGE } from '../world/map/annex/plan';
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
const LONE = 2.0;
/** Rounds the plate has to stop before the shop is offered. */
const STOPPED = 3;
/** Cost of SMG AP rounds in Procurement (contracts/shop/data.ts). */
const SMG_AP_PRICE = 400;
/** Seconds the exit fades over, and the parting line holds the picture before the menu. */
const FADE = 1.6;
const PARTING = 5;
const HOME_FADE = 1.2;
/** Seconds after the nuke detonates that the shock front vaporizes town dressing (inside peak flash). */
const FLATTEN = 0.25;
/** Beats in order, for which parting line the door gets. */
const EARLY = 'crouch', HALF = 'lane', LATE = 'surrender', DONE = 'after';
/** The Jump Jet implant: fitted for its tower, taken off after, so the player learns it is sold at the pod. */
const JET = 'jumpJet';
const MARKER_PRISONER = '#59e0ff';

const NONE: never[] = [];
const _v = new THREE.Vector3();

type Weapons = WeaponSystem & {
  readonly mods: ReadonlySet<ModId>;
  readonly fitted: ReadonlySet<ModId>;
  grantMod(id: ModId): void;
  fitMod(id: ModId, on: boolean): boolean;
};

type ShopView = { readonly credits: number; earn(n: number): void };

const inside = (z: Zone, p: THREE.Vector3): boolean =>
  p.x >= z.min[0] && p.x <= z.max[0] && p.y >= z.min[1] && p.y <= z.max[1] && p.z >= z.min[2] && p.z <= z.max[2];

export class Retraining {
  /** Held subjects by group, by uid while they live. */
  private readonly groups = new Map<string, Map<number, Enemy>>();
  private readonly told = new Set<string>();
  private readonly awaits = new Set<string>();
  private readonly stopped = new Map<string, number>();
  private readonly missPlate = new Map<string, number>();
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

  // Anti-softlock & guidance state.
  private lastBeat = '';
  private retryVoiceCd = 0;
  private pitRescueCd = 0;
  private grenadeRefillIn = -1;
  private kataResetIn = -1;
  private yardRecoverIn = -1;
  private sonarHintShown = false;
  private sonarPinged = false;
  private autoQuestionNext = false;
  private prisonerMarkUid = -1;
  private prisonerMarkText = '';
  private unmarkPrisoner: (() => void) | null = null;
  private readonly prisonerMarkPos = new THREE.Vector3();

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
      for (const [group, men] of this.groups) {
        if (!men.has(e.enemy.uid)) continue;
        if (e.result.armour === 'stopped') {
          const n = (this.stopped.get(group) ?? 0) + 1;
          this.stopped.set(group, n);
          if (n === STOPPED) this.runner.signal(`stopped:${group}`);
        } else if (group === 'armoured' && this.runner.beat?.id === 'armour') {
          const m = (this.missPlate.get(group) ?? 0) + 1;
          this.missPlate.set(group, m);
          if (m === 3) this.ui.hint('Aim for his chest plate — watch hollow points bounce off armour.', 7);
        }
      }
    });
    events.on('enemy:surrendered', e => {
      const s = soldierOf(e.enemy as Enemy);
      if (!s) return;
      this.stabilize(s);
      if (this.autoQuestionNext && this.runner.beat?.id === 'release') {
        s.questioned = true;
        this.autoQuestionNext = false;
      }
    });
    events.on('prisoner:freed', () => {
      if (this.awaits.delete('released')) this.runner.signal('released');
    });
    events.on('sonar:ping', () => {
      this.sonarPinged = true;
    });
    events.on('player:slam', e => {
      if (this.drill !== 'slam') return;
      if (e.big) this.drill = null;
      else this.retry('slamTop', 'Higher. Jump off the top, then press {slide} in the air: a slam from six metres or more is a big one.', 'm.slamAgain');
    });
    events.on('player:landed', () => {
      if (this.drill === 'slam' && inside(this.runner.zone('slamPit'), this.ctx.player.position)) {
        this.retry('slamTop', 'That was a landing. In the air, press {slide} to slam.', 'm.slamAgain');
      }
    });
    (events as unknown as { on(type: string, fn: (e: { position?: THREE.Vector3 }) => void): void }).on('nuke:detonated', e => {
      if (e.position) this.zero.copy(e.position);
      const objects = this.ctx.world.objects as (typeof this.ctx.world.objects & { nukeSweep?(c: THREE.Vector3, r?: number): void }) | undefined;
      objects?.damageExplosivesInRadius(this.zero, 180, 1e5, 'nuke');
      this.flattenIn = FLATTEN;
    });
    events.on('callin:used', e => {
      if (e.id === 'nuke') this.zero.copy(e.position);
    });
  }

  private get manager(): EnemyManager {
    return this.ctx.enemies as EnemyManager;
  }

  private get weapons(): Weapons {
    return this.ctx.weapons as Weapons;
  }

  private get shop(): ShopView | null {
    return (this.ctx.contracts as unknown as { shop?: ShopView | null }).shop ?? null;
  }

  private mark(id: string): Mark {
    const m = this.runner.mission.marks[id];
    if (!m) throw new Error(`retraining: no mark ${id}`);
    return m;
  }

  private speakLine(shortId: string): void {
    if (this.retryVoiceCd > 0) return;
    const spoken = RETRAINING_LINES.find(l => l.id === `mission.council.tut.${shortId}`);
    if (!spoken) return;
    this.retryVoiceCd = 3.5;
    this.ui.speak(spoken, () => {});
  }

  private retry(at: string, text: string, voiceLine?: string): void {
    const m = this.mark(at);
    this.ctx.player.teleport(_v.set(...m.at), m.yaw);
    this.ui.hint(text, 7);
    if (voiceLine) this.speakLine(voiceLine);
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
      case 'tut.equip':
        if (this.weapons.owned.has(arg as WeaponId)) this.weapons.switchTo(arg as WeaponId);
        return;
      case 'tut.credits':
        this.shop?.earn(Number(arg));
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
      case 'tut.hurt': {
        // Ensure the player always has at least one stim ready for the stim lesson.
        const stims = ctx.progression?.stims;
        if (stims && stims.count <= 0) stims.give(1);
        ctx.player.health = Math.min(ctx.player.health, Number(arg));
        ctx.events.emit('player:damaged', { amount: 1, type: 'shock' });
        return;
      }
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

  /** Stops all active bleeding and keeps a yielding/kneeling tutorial subject alive so a stray graze never bleeds him out. */
  private stabilize(s: Soldier): void {
    const b = s.injuries;
    b.dressAll();
    for (let i = 0; i < b.count; i++) b.wounds[i]!.bleed = 0;
    b.bleed = 0;
    b.bleedsOutAt = Infinity;
    b.mortalUntil = Infinity;
    if (b.condition === 'mortal') b.condition = 'wounded';
    b.stabilised = true;
    if (s.e.alive && s.e.health < s.e.maxHealth * 0.45) {
      s.e.health = s.e.maxHealth * 0.45;
    }
  }

  /**
   * The last man of the yielding tag still on his feet, fighting or running, kneels after `LONE` seconds. By the mission's own books,
   * not his squad's: a lone survivor merges into another squad, and a broken man runs (flight.ts) rather than fights.
   */
  private watchYield(dt: number): void {
    const o = this.manager.outpost;
    const tag = this.yielding;
    if (!tag || !o) {
      this.lone.clear();
      return;
    }
    const tagOf = (this.runner.host as unknown as { tagOf: ReadonlyMap<number, string> }).tagOf;
    const active: Soldier[] = [];
    for (const s of o.soldiers) {
      const up = s.e.alive && !s.e.dummy && !s.surrendered && !s.released && !s.cuffed && (s.fighting || s.fate === 'flee');
      if (up && tagOf.get(s.e.uid) === tag) active.push(s);
    }
    if (active.length !== 1) {
      this.lone.clear();
      return;
    }
    const s = active[0]!;
    // Stabilize the sole survivor so an accidental grazing shot doesn't bleed him out before he drops to his knees.
    this.stabilize(s);
    const t = (this.lone.get(s.e.uid) ?? 0) + dt;
    this.lone.set(s.e.uid, t);
    if (t < LONE) return;
    this.lone.delete(s.e.uid);
    s.refused = false;
    if (s.fighting) o.collapse(s, 'surrender');
    else {
      s.fate = 'surrender';
      s.e.thinkAt = 0;
      o.collapse(s, 'surrender');
    }
  }

  private clearPrisonerMarker(): void {
    this.unmarkPrisoner?.();
    this.unmarkPrisoner = null;
    this.prisonerMarkUid = -1;
    this.prisonerMarkText = '';
  }

  private markPrisoner(s: Soldier | null, label: string): void {
    if (!s || !s.e.alive) {
      if (this.unmarkPrisoner) this.clearPrisonerMarker();
      return;
    }
    this.prisonerMarkPos.copy(s.e.position);
    this.prisonerMarkPos.y += 1.65;
    if (this.prisonerMarkUid === s.e.uid && this.prisonerMarkText === label) return;
    this.clearPrisonerMarker();
    this.prisonerMarkUid = s.e.uid;
    this.prisonerMarkText = label;
    this.unmarkPrisoner = this.ctx.hud.follow(this.prisonerMarkPos, label, MARKER_PRISONER);
  }

  /**
   * Bulletproof Yard watchdog covering `surrender`, `question`, `release`, and `capture`:
   * - Stabilizes every kneeling prisoner so he never bleeds out on his knees.
   * - Freezes the 45s prisoner auto-walkout timeout while a beat is waiting on him.
   * - Keeps a crisp HUD wayfinding marker on the kneeling prisoner so players never lose him.
   * - Automatically recovers if the player kills everyone, shoots a kneeling prisoner, cuffs when asked to question/release,
   *   or releases when asked to capture — making every Yard softlock impossible!
   */
  private watchYard(dt: number, beat: string): void {
    const inYard = beat === 'surrender' || beat === 'question' || beat === 'release' || beat === 'capture';
    if (!inYard) {
      this.clearPrisonerMarker();
      this.yardRecoverIn = -1;
      return;
    }
    const o = this.manager.outpost;
    if (!o) return;
    const tagOf = (this.runner.host as unknown as { tagOf: ReadonlyMap<number, string> }).tagOf;
    const arrivals = (this.runner.host as unknown as { arrivals?: readonly { tag: string }[] }).arrivals ?? [];
    const tag = beat === 'capture' ? 'b' : 'a';
    const pendingTag = arrivals.some(a => a.tag === tag);

    // Keep guns from running completely dry during Yard retries.
    this.ensureAmmo('smg', 20);
    this.ensureAmmo('rivet', 12);

    // Find active kneeling prisoners and cuffed/airlifting prisoners.
    const kneeling: Soldier[] = [];
    let anyCuffed = false;
    let activeTagCount = 0;
    for (const s of o.soldiers) {
      if (!s.e.alive || s.e.dummy) continue;
      // Keep the shed squad ('b') steady while the player is still working on squad 'a' so witness fear never breaks them early.
      if (beat !== 'capture' && tagOf.get(s.e.uid) === 'b' && s.fighting) {
        s.morale = Math.max(s.morale, 100);
        s.witnessed = 0;
      }
      if (s.cuffed) anyCuffed = true;
      if (s.surrendered && !s.released && !s.cuffed && s.fate === 'surrender') {
        this.stabilize(s);
        // Keep him on his knees while the lesson waits on him.
        s.surrenderedAt = this.ctx.time.elapsed;
        s.watchedAt = this.ctx.time.elapsed;
        kneeling.push(s);
      }
      if (!s.surrendered && !s.released && !s.cuffed && (s.fighting || s.fate === 'flee') && tagOf.get(s.e.uid) === tag) {
        activeTagCount++;
      }
    }

    if (beat === 'surrender') {
      this.clearPrisonerMarker();
      if (kneeling.length > 0 || activeTagCount > 0 || pendingTag) {
        this.yardRecoverIn = -1;
        return;
      }
      this.scheduleYardRespawn(dt, 'a', 'yardA', 'All targets eliminated — sending a fresh pair. Kill one and stop shooting so the last one surrenders.');
      return;
    }

    if (beat === 'question') {
      const target = kneeling.find(s => !s.questioned) ?? kneeling[0] ?? null;
      if (target) {
        this.markPrisoner(target, 'TAP [E] TO QUESTION');
        this.yardRecoverIn = -1;
        return;
      }
      this.clearPrisonerMarker();
      this.yielding = 'a';
      if (activeTagCount > 0 || pendingTag) {
        this.yardRecoverIn = -1;
        return;
      }
      const msg = anyCuffed
        ? 'You held {interact} and cuffed him instead of tapping to question — sending a replacement squad.'
        : 'Prisoner lost before questioning — sending a fresh pair. Leave one alive to surrender, then tap {interact}.';
      this.scheduleYardRespawn(dt, 'a', 'yardA', msg);
      return;
    }

    if (beat === 'release') {
      const target = kneeling.find(s => s.questioned) ?? kneeling[0] ?? null;
      if (target) {
        if (!target.questioned) target.questioned = true;
        this.markPrisoner(target, 'TAP [E] TO RELEASE');
        this.yardRecoverIn = -1;
        return;
      }
      this.clearPrisonerMarker();
      this.yielding = 'a';
      this.autoQuestionNext = true;
      if (activeTagCount > 0 || pendingTag) {
        this.yardRecoverIn = -1;
        return;
      }
      const msg = anyCuffed
        ? 'You held {interact} and cuffed him instead of releasing — sending a replacement. Leave one alive, then tap {interact} to let him go.'
        : 'Prisoner lost before release — sending a replacement. Leave one alive to surrender, then tap {interact} to let him go.';
      this.scheduleYardRespawn(dt, 'a', 'yardA', msg);
      return;
    }

    // beat === 'capture'
    const target = kneeling[0] ?? null;
    if (target) {
      this.markPrisoner(target, 'HOLD [E] TO CAPTURE');
      this.yardRecoverIn = -1;
      return;
    }
    this.clearPrisonerMarker();
    if (anyCuffed || activeTagCount > 0 || pendingTag) {
      this.yardRecoverIn = -1;
      return;
    }
    this.yielding = 'b';
    this.scheduleYardRespawn(dt, 'b', 'shed', 'No live target left at the shed — sending reinforcements. Leave one alive, then HOLD {interact} to cuff him.');
  }

  private scheduleYardRespawn(dt: number, tag: 'a' | 'b', atMark: 'yardA' | 'shed', hint: string): void {
    if (this.yardRecoverIn < 0) {
      this.yardRecoverIn = 1.4;
      return;
    }
    this.yardRecoverIn -= dt;
    if (this.yardRecoverIn > 0) return;
    this.yardRecoverIn = -1;
    this.yielding = tag;
    this.ui.hint(hint, 8);
    this.speakLine('y.lesson');
    this.runner.host.squad({ do: 'squad', tag, men: ['trooper', 'trooper'], at: atMark, orders: 'hunt', light: true }, this.mark(atMark));
  }

  private ensureAmmo(id: WeaponId, minTotal: number): void {
    if (!this.weapons.owned.has(id)) return;
    const a = this.weapons.ammo(id);
    if (a.mag + a.reserve >= minTotal) return;
    a.reserve = a.maxReserve;
    if (a.mag === 0) a.mag = a.magSize;
  }

  /** Station-specific anti-softlock guards across Mobility, Gallery, Quiet Room, and Finale. */
  private watchSafety(dt: number, beat: string): void {
    const { player } = this.ctx;
    const p = player.position;

    // Reset per-beat timers when advancing.
    if (beat !== this.lastBeat) {
      this.lastBeat = beat;
      this.grenadeRefillIn = -1;
      this.kataResetIn = -1;
      this.yardRecoverIn = -1;
      this.sonarHintShown = false;
      if (beat === 'sonar') this.sonarPinged = false;
    }

    // 1. Universal Mobility Hall pit safety net (impossible to get trapped at the bottom of a pit).
    if (this.pitRescueCd > 0) this.pitRescueCd -= dt;
    if (p.y < -1.2 && p.z < 0 && p.z > ROCKET_LEDGE.z1 && this.pitRescueCd <= 0) {
      const target = beat === 'dash' ? 'dashStart' : beat === 'wallrun' ? 'wallStart' : beat === 'chimney' ? 'wallLand' : null;
      if (target) {
        this.pitRescueCd = 1.0;
        const msg = beat === 'wallrun'
          ? 'Run along the cyan track: {jump} toward the wall, hold {forward}, and steer gently into it.'
          : 'Jump, double-jump near the apex, then {dash}. You have two dashes.';
        this.retry(target, msg, 'm.pit');
      }
    }

    // 2. Rocket Jump & Jump Jet safety: never run out of rockets, never die to self-blast while learning.
    if (beat === 'rocket' || beat === 'jet') {
      this.ensureAmmo('rocket', 2);
      if (beat === 'rocket' && player.alive && player.health < 35) player.health = 35;
    }
    if (beat === 'lane' && p.z > ROCKET_LEDGE.z1 && p.y < 3.0) {
      this.retry('galleryLanding', 'Back up to the Gallery entrance.');
    }

    // 3. Gallery: ammo safety, Procurement stipend safety, grenade refill, and stim regen cap.
    if (beat === 'lane' || beat === 'armour' || beat === 'ap') {
      this.ensureAmmo('smg', 15);
    }
    if (beat === 'shop') {
      const hasMod = this.weapons.fitted.has('smgAp') || this.weapons.mods.has('smgAp');
      const shop = this.shop;
      if (!hasMod && shop && shop.credits < SMG_AP_PRICE) {
        shop.earn(SMG_AP_PRICE - shop.credits);
        this.ui.hint('Procurement stipend topped up — buy and fit SMG AP rounds.', 7);
      }
    }
    if (beat === 'grenade') {
      if (this.weapons.grenades <= 0 && !this.told.has('trench')) {
        if (this.grenadeRefillIn < 0) this.grenadeRefillIn = 2.2;
        else {
          this.grenadeRefillIn -= dt;
          if (this.grenadeRefillIn <= 0) {
            this.grenadeRefillIn = -1;
            this.weapons.addGrenades(2);
            this.ui.hint('Fresh grenades issued — hold {grenade} to cook, release to lob over the wall.', 7);
          }
        }
      } else this.grenadeRefillIn = -1;
    }
    if (beat === 'stim') {
      const stims = this.ctx.progression?.stims;
      if (stims && stims.count <= 0) stims.give(1);
      // Keep health below full so natural regen never blocks the stim injection with "HEALTH FULL".
      if (player.alive && player.health > 55) player.health = 55;
    }

    // 4. Quiet Room: Sonar reminder & Gun Kata auto-reset if all 8 subjects were shot manually.
    if (beat === 'sonar' && this.told.has('hidden') && !this.sonarPinged && !this.sonarHintShown) {
      this.sonarHintShown = true;
      this.ui.hint('Press {sonar} to ping your sonar and complete the check.', 9);
    }
    if (beat === 'kata') {
      this.ensureAmmo('rivet', 16);
      if (this.told.has('kata')) {
        if (this.kataResetIn < 0) this.kataResetIn = 1.2;
        else {
          this.kataResetIn -= dt;
          if (this.kataResetIn <= 0) {
            this.kataResetIn = -1;
            for (let i = 0; i < 8; i++) this.hold('kata', this.mark(`kata${i}`), false);
            if (this.weapons.owned.has('rivet')) this.weapons.switchTo('rivet');
            this.ui.hint('Ring reset — hold {sonar} with the akimbo pistols until Gun Kata charges, then release!', 9);
          }
        }
      } else this.kataResetIn = -1;
    }

    // 5. Graduation Nuke: keep the contractor alive on the balcony during the blast shockwave.
    if ((beat === 'nuke' || beat === 'after') && player.alive && player.health < 30) {
      player.health = 30;
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
    } else this.retry('slideStart', 'That was a walk. Run at the slot and press {slide} once before it, at full speed.', 'm.slideAgain');
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
      this.clearPrisonerMarker();
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
    if (this.retryVoiceCd > 0) this.retryVoiceCd -= dt;
    this.watchExit(dt);
    if (this.leaving >= 0) return;
    const beat = this.runner.beat?.id ?? '';
    this.plead(dt);
    this.watchDrill();
    this.watchAwaits();
    this.watchYield(dt);
    this.watchYard(dt, beat);
    this.watchSafety(dt, beat);
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
      // Right inside the blinding nuke detonation flash, vaporize the fragile string lights, bunting, poles, and canopies!
      if (this.flattenIn < 0) {
        const scene = this.ctx.render.scene as THREE.Scene | undefined;
        const fragile = scene?.getObjectByName('fragile-dressing');
        if (fragile) fragile.visible = false;
        const objects = this.ctx.world.objects as (typeof this.ctx.world.objects & { nukeSweep?(c: THREE.Vector3, r?: number): void }) | undefined;
        objects?.nukeSweep?.(this.zero, 260);
        objects?.damageExplosivesInRadius(this.zero, 180, 1e5, 'nuke');
      }
    }
  }

  clear(): void {
    this.groups.clear();
    this.told.clear();
    this.awaits.clear();
    this.stopped.clear();
    this.missPlate.clear();
    this.sturdy.clear();
    this.drill = null;
    this.yielding = null;
    this.lone.clear();
    this.leaving = this.homeIn = this.flattenIn = -1;
    this.lastBeat = '';
    this.retryVoiceCd = this.pitRescueCd = 0;
    this.grenadeRefillIn = this.kataResetIn = this.yardRecoverIn = -1;
    this.sonarHintShown = this.sonarPinged = this.autoQuestionNext = false;
    this.clearPrisonerMarker();
    const scene = this.ctx.render.scene as THREE.Scene | undefined;
    const fragile = scene?.getObjectByName('fragile-dressing');
    if (fragile) fragile.visible = true;
  }
}
