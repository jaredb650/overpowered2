/**
 * Enemy attacks on every screen.
 *
 * An attack is data the enemy's brain runs (enemies/brain.ts `AttackDef`): `begin` (the pose, the voice, the muzzle star, the
 * laser), `windupTick` (the laser following its target), `fire` (the swing, the flash, the shot and its sound), `activeTick`,
 * `end`. The host runs it for real and says three things on the reliable lane:
 *
 * - `atk`: enemy `uid` started attack `a` (its name in that enemy's list) at player slot `to`, with a wind-up of `w` seconds,
 *   at host time `ht`; plus the point or direction the attack locked, if it has one.
 * - `atkf`: its shot number `n` went off, with the projectiles and rays that shot made (`sh`: enemyFire.ts).
 * - `atke`: it stopped (`i`: cut short by a stagger, a death, a lost arm).
 *
 * A guest runs the very same `AttackDef` on its copy of the enemy, on the same timeline, against a world that cannot hurt
 * (`cosmetic`): the player it reads is the one the host named, damage and knock-back do nothing (the host sends `hurt` and
 * `shove`), a projectile it would spawn becomes a harmless copy of the host's, and anything only the host may decide (a blast,
 * a trample, a ground ring) is a no-op. So every star, laser, flash, clip and sound is made by the code single player uses.
 * A wind-up that arrived late starts that far in (hostTime.ts), so the shot lands when the host's `hurt` does.
 *
 * A stream that is only for show (a Burner's flame: `AttackDef.local`) sends its first shot alone; each screen then makes its
 * own globs from the timeline. Also here: a line an enemy says outside an attack (`say`), and what a boss's phase change looks
 * and sounds like (`bossfx`).
 */
import * as THREE from 'three';
import { CATALOG } from '../../audio/catalog';
import { PlayerSense, type AiWorld } from '../../enemies/aiWorld';
import { BOSS_FX, type BossFxKind } from '../../enemies/bosses';
import type { AttackDef } from '../../enemies/brain';
import type { Enemy } from '../../enemies/Enemy';
import { soldierOf } from '../../enemies/outpost/soldier';
import type { WorldContext, WorldModule } from './context';
import { MAX_SHOTS, type EnemyFire, type WireShot } from './enemyFire';
import { HostTime, hostStamp } from './hostTime';
import type { Replicas } from './replicas';
import type { Targeting } from './targeting';
import { validVec, type Vec } from './wire';

export type AttackEvent =
  | { t: 'atk'; uid: number; a: string; w: number; to: number; ht: number; ap?: Vec; ad?: Vec }
  | { t: 'atkf'; uid: number; a: string; n: number; to: number; sh?: WireShot[]; ap?: Vec; ad?: Vec }
  | { t: 'atke'; uid: number; i?: 1 }
  /** An enemy said a line outside an attack: a bark, a taunt, a choke. */
  | { t: 'say'; uid: number; l: string; v: number }
  /** A boss changed phase: the roar, the sound and the screen effect of it. */
  | { t: 'bossfx'; uid: number; k: string };

/** Seconds a guest's copy waits past its wind-up, or past a shot, for the host's word before it gives the attack up. */
const FIRE_WAIT = 1.2;
const SAYS_PER_SECOND = 20;
/** Seconds a start is kept for an enemy this screen has not drawn yet (it spawned and attacked inside one snapshot). */
const BEGIN_WAIT = 0.6;
const LOG_SIZE = 400;

/** Enemy-system calls only the host may make. A guest's copy of an attack does nothing where the host's does one of these. */
const HOST_ONLY: ReadonlySet<string> = new Set(['strike', 'selfDestruct', 'trample', 'reinforce', 'wardNearby', 'dropWard', 'killAll', 'killAllExcept',
  'crashDrone', 'startCrash', 'rescue', 'stagger', 'spawn', 'spawnBoss', 'applyDamage', 'withdraw', 'detach', 'retire', 'holdForDeath']);

const round3 = (n: number): number => Math.round(n * 1000) / 1000;
const round2 = (n: number): number => Math.round(n * 100) / 100;
const pack = (v: THREE.Vector3): Vec => [round2(v.x), round2(v.y), round2(v.z)];
const noop = (): void => {};

/** Passes everything on to `target`, except the named members. Methods run on the real object, never on the stand-in. */
function standIn<T extends object>(target: T, swap: (key: string) => unknown): T {
  const bound = new Map<PropertyKey, { of: unknown; fn: unknown }>();
  return new Proxy(target, {
    get(real, key) {
      const swapped = typeof key === 'string' ? swap(key) : undefined;
      if (swapped !== undefined) return swapped;
      const value = Reflect.get(real, key);
      if (typeof value !== 'function') return value;
      let entry = bound.get(key);
      // Bound once per method, and again if the method itself was replaced (a test's recorder).
      if (!entry || entry.of !== value) { entry = { of: value, fn: (value as (...args: unknown[]) => unknown).bind(real) }; bound.set(key, entry); }
      return entry.fn;
    },
  });
}

interface Run { uid: number; enemy: Enemy; attack: AttackDef; to: number }
/** One line of what happened, for the browser proofs: wall-clock ms (the same clock on every page of one machine). */
export interface AttackLog { at: number; uid: number; a: string; p: 'begin' | 'fire' | 'end'; n?: number }

export class EnemyAttacks implements WorldModule {
  /** What was sent (host) or played (guest), newest last, for the browser proofs. */
  readonly log: AttackLog[] = [];
  /** Guest: counts of what has been played. */
  readonly seen = { begun: 0, fired: 0, ended: 0, says: 0, bossFx: 0, failed: 0 };
  private readonly clock = new HostTime();
  private readonly runs = new Map<number, Run>();
  /** Guest: starts that arrived before their enemy was drawn here, with the seconds each has waited. */
  private readonly early = new Map<number, { value: Extract<AttackEvent, { t: 'atk' }>; waited: number }>();
  private readonly senses = [new PlayerSense(), new PlayerSense(), new PlayerSense(), new PlayerSense()];
  private copyWorld: AiWorld | null = null;
  private second = 0;
  private says = 0;
  private warned = false;

  constructor(private readonly w: WorldContext, private readonly replicas: Replicas, private readonly targeting: Targeting, private readonly fire: EnemyFire) {
    w.router.guest('atk', (value, _from, now) => this.beginIn(value, now));
    w.router.guest('atkf', value => this.fireIn(value));
    w.router.guest('atke', value => {
      this.early.delete(value.uid);
      const run = this.runs.get(value.uid);
      if (run) this.finish(run, value.i === 1);
    });
    w.router.guest('say', value => {
      const enemy = this.replicas.enemy(value.uid);
      if (!enemy || typeof value.l !== 'string' || !CATALOG.has(value.l) || !Number.isFinite(value.v)) return;
      this.seen.says++;
      w.ctx.audio.play(value.l, { position: enemy.center, volume: Math.max(0, Math.min(1.5, value.v)), pitch: enemy.def.voice.pitch, pitchJitter: 0.08 });
    });
    w.router.guest('bossfx', value => {
      const enemy = this.replicas.enemy(value.uid);
      const fx = typeof value.k === 'string' && Object.hasOwn(BOSS_FX, value.k) ? BOSS_FX[value.k as BossFxKind] : undefined;
      if (!enemy || !fx) return;
      this.seen.bossFx++;
      this.guard(enemy, () => fx(enemy, this.world(this.w.session.lobby.me?.slot ?? 0)));
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Host: called by the brain as it runs an attack (enemies/brain.ts)
  // ---------------------------------------------------------------------------------------------

  private get sending(): boolean { return this.w.hosting && this.w.ready; }

  /** Host: an attack's own code is about to run. Until `leave`, its flashes, stars and sounds are not sent one by one. */
  enter(): void { this.fire.enter(); }
  leave(): void { this.fire.leave(); }

  /** Host: `a.begin` has just run on `e`. */
  began(e: Enemy, a: AttackDef): void {
    if (!this.sending) return;
    this.w.send({ t: 'atk', uid: e.uid, a: a.name, w: round3(e.attackWindup), to: this.targeting.slotFor(e.uid), ht: hostStamp(), ...this.aimOf(e) });
    this.note(e.uid, a.name, 'begin');
  }

  /** Host: shot `index` is about to go off: what it spawns is gathered for its event. */
  firing(): void { this.fire.record(); }

  /** Host: shot `index` of `a` has just gone off on `e`. */
  fired(e: Enemy, a: AttackDef, index: number): void {
    const shots = this.fire.take();
    // A stream for show sends its first shot only: every screen makes the rest from the same timeline.
    if (!this.sending || (a.local && index > 0)) return;
    this.w.send({ t: 'atkf', uid: e.uid, a: a.name, n: index, to: this.targeting.slotFor(e.uid), ...(shots ? { sh: shots } : {}), ...this.aimOf(e) });
    this.note(e.uid, a.name, 'fire', index);
  }

  /** Host: the attack stopped. */
  ended(e: Enemy, a: AttackDef, interrupted: boolean): void {
    if (!this.sending) return;
    this.w.send({ t: 'atke', uid: e.uid, ...(interrupted ? { i: 1 as const } : {}) });
    this.note(e.uid, a.name, 'end');
  }

  /** Host: an enemy said `line` outside an attack. */
  said(e: Enemy, line: string, volume: number): void {
    if (!this.sending || this.fire.scoped) return;
    const second = Math.floor(performance.now() / 1000);
    if (second !== this.second) { this.second = second; this.says = 0; }
    if (++this.says <= SAYS_PER_SECOND) this.w.send({ t: 'say', uid: e.uid, l: line, v: round2(volume) });
  }

  /** Host: a boss's phase change was shown here; show it on the guests. */
  bossFx(e: Enemy, kind: BossFxKind): void {
    if (this.sending) this.w.send({ t: 'bossfx', uid: e.uid, k: kind });
  }

  /** The point and direction an attack has locked, when it has set them. */
  private aimOf(e: Enemy): { ap?: Vec; ad?: Vec } {
    const out: { ap?: Vec; ad?: Vec } = {};
    if (e.aimPoint.lengthSq() > 0) out.ap = pack(e.aimPoint);
    if (e.aimDir.x !== 0 || e.aimDir.y !== 0 || e.aimDir.z !== 1) out.ad = [round3(e.aimDir.x), round3(e.aimDir.y), round3(e.aimDir.z)];
    return out;
  }

  private note(uid: number, a: string, p: AttackLog['p'], n?: number): void {
    if (this.log.length >= LOG_SIZE) this.log.splice(0, LOG_SIZE / 2);
    this.log.push({ at: Date.now(), uid, a, p, ...(n !== undefined ? { n } : {}) });
  }

  // ---------------------------------------------------------------------------------------------
  // Guest: the same attack, played on the copy
  // ---------------------------------------------------------------------------------------------

  /** Guest: the copies with an attack running, for the browser proofs. */
  get running(): number { return this.runs.size; }

  private find(e: Enemy, name: unknown): AttackDef | undefined {
    return typeof name === 'string' ? e.attacks.find(attack => attack.name === name) ?? e.def.attacks.find(attack => attack.name === name) : undefined;
  }

  /**
   * The world a guest's copy of an attack runs against: the real effects, telegraphs and sounds, and nothing that can hurt or
   * decide. `slot` is the player the host said the attack is at.
   */
  private world(slot: number): AiWorld {
    const { ctx, manager } = this.w;
    if (!this.copyWorld) {
      const real = manager.aiWorld;
      const copies = this.fire.combat;
      const player = standIn(ctx.player, key => key === 'takeDamage' || key === 'launch' || key === 'push' ? noop : undefined);
      const combat = standIn(ctx.combat, key => key === 'spawnProjectile' ? copies.spawnProjectile : key === 'fireRay' ? copies.fireRay
        : key === 'enemyMuzzle' ? copies.enemyMuzzle : key === 'explode' ? noop : undefined);
      const copyCtx = new Proxy(ctx, { get: (target, key) => key === 'player' ? player : key === 'combat' ? combat : Reflect.get(target, key) });
      // A ground ring is the host's word (warnings.ts), never this screen's guess.
      const telegraphs = standIn(real.telegraphs, key => key === 'zone' ? noop : undefined);
      const enemies = standIn(manager, key => HOST_ONLY.has(key) ? noop : undefined);
      this.copyWorld = { ctx: copyCtx, director: real.director, telegraphs, enemies, player: this.senses[0]!, now: 0, cosmetic: true } as AiWorld;
    }
    const world = this.copyWorld as { -readonly [K in keyof AiWorld]: AiWorld[K] };
    world.player = this.sense(slot);
    world.now = ctx.time.elapsed;
    return world;
  }

  /** What the AI would sense of the player in `slot`: the local player, or a friend's body. */
  private sense(slot: number): PlayerSense {
    const { ctx, session } = this.w;
    const sense = this.senses[slot & 3]!;
    const roster = slot === session.lobby.me?.slot ? undefined : session.lobby.players.find(player => player.slot === slot);
    const remote = roster ? session.remotes.get(roster.id) : undefined;
    const pose = remote?.buffer.sample(performance.now());
    if (remote && pose) {
      sense.position.copy(remote.char.root.position);
      sense.eye.copy(sense.position).y += 1.6;
      sense.velocity.fromArray(pose.velocity);
      sense.forward.set(-Math.sin(pose.yaw), 0, -Math.cos(pose.yaw));
      sense.grounded = pose.move !== 'airborne' && pose.move !== 'jet' && pose.move !== 'wallrun' && pose.move !== 'wallrunR' && pose.move !== 'mantle';
      sense.alive = !remote.downed;
    } else {
      const p = ctx.player;
      sense.position.copy(p.position);
      sense.eye.copy(p.eye);
      sense.velocity.copy(p.velocity);
      sense.forward.copy(p.forward);
      sense.grounded = p.grounded;
      sense.alive = p.alive;
    }
    sense.chest.copy(sense.position).y += 1;
    sense.speed = Math.hypot(sense.velocity.x, sense.velocity.y * 0.5, sense.velocity.z);
    sense.evasion = Math.max(0, Math.min(1, (sense.speed - 3) / 8.5));
    sense.ghost = false;
    return sense;
  }

  /** Runs a piece of an attack's own code on a copy. A copy has less behind it than the host's enemy: a throw drops that piece only. */
  private guard(e: Enemy, run: () => void): void {
    try { run(); } catch (error) { this.failed(e, error); }
  }

  private failed(e: Enemy, error: unknown): void {
    this.seen.failed++;
    if (!this.warned) { this.warned = true; console.warn('[coop] An enemy attack could not be played on its copy', e.id, error); }
  }

  private setAim(e: Enemy, value: { ap?: Vec; ad?: Vec }): void {
    if (validVec(value.ap)) e.aimPoint.fromArray(value.ap);
    if (validVec(value.ad)) e.aimDir.fromArray(value.ad).normalize();
  }

  private slotOf(value: unknown): number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 3 ? value : this.w.session.lobby.me?.slot ?? 0;
  }

  private beginIn(value: Extract<AttackEvent, { t: 'atk' }>, now: number, waited = 0): void {
    if (!Number.isFinite(value.w) || value.w < 0 || value.w > 30) return;
    const e = this.replicas.enemy(value.uid);
    if (!e || !e.alive) {
      // Not drawn here yet: kept a moment, and started that far in once he is.
      if (waited === 0 && this.early.size < 48) this.early.set(value.uid, { value, waited: this.clock.late(value.ht, now) });
      return;
    }
    const a = this.find(e, value.a);
    if (!a) return;
    const old = this.runs.get(value.uid);
    if (old) this.finish(old, true);
    const to = this.slotOf(value.to);
    const run: Run = { uid: value.uid, enemy: e, attack: a, to };
    this.runs.set(value.uid, run);
    e.attack = a;
    e.attackPhase = 'windup';
    e.attackClock = 0;
    e.attackShots = 0;
    e.attackStage = 0;
    // Late by more than the link's usual delay: the wind-up is that much shorter, so the shot still lands with the host's.
    e.attackWindup = Math.max(0.05, value.w - (waited > 0 ? waited : this.clock.late(value.ht, now)));
    const world = this.world(to);
    this.guard(e, () => a.begin(e, world));
    this.setAim(e, value);
    this.seen.begun++;
    this.note(value.uid, a.name, 'begin');
  }

  private fireIn(value: Extract<AttackEvent, { t: 'atkf' }>): void {
    const e = this.replicas.enemy(value.uid);
    if (!e || !e.alive || !Number.isInteger(value.n) || value.n < 0 || value.n > 2048) return;
    this.early.delete(value.uid);
    let run = this.runs.get(value.uid);
    const a = run && run.attack.name === value.a ? run.attack : this.find(e, value.a);
    if (!a) return;
    if (!run || run.attack !== a) {
      // Its start never came (he was not drawn here yet): the attack is joined at this shot, without its wind-up.
      if (run) this.finish(run, true);
      run = { uid: value.uid, enemy: e, attack: a, to: this.slotOf(value.to) };
      this.runs.set(value.uid, run);
      e.attack = a;
      e.attackWindup = e.attackStage = e.attackShots = 0;
    }
    run.to = this.slotOf(value.to);
    const world = this.world(run.to);
    if (e.attackPhase !== 'active') {
      // The shot came before this copy's wind-up was over (this page's clock ran slow, or the start was late): the wind-up is
      // run to its end first, so what it leads up to (a laser going solid, a lane locking) has happened before the shot.
      if (e.attackPhase === 'windup' && a.windupTick && e.attackClock < e.attackWindup) {
        e.attackClock = e.attackWindup;
        this.guard(e, () => a.windupTick!(e, world, 0));
      }
      e.attackPhase = 'active';
      e.attackClock = 0;
    }
    this.setAim(e, value);
    const soldier = soldierOf(e);
    if (soldier) {
      // A copy's soldier is a shell: the host has decided he fires, so his magazine never reads empty here.
      soldier.mag = Math.max(soldier.mag, 2);
      e.hasLos = world.director.clearLine(e.center, this.w.ctx.player.eye);
    }
    this.fire.load(Array.isArray(value.sh) ? value.sh.slice(0, MAX_SHOTS) : null);
    this.guard(e, () => a.fire(e, world, value.n));
    this.fire.load(null);
    e.attackShots = value.n + 1;
    this.seen.fired++;
    this.note(value.uid, a.name, 'fire', value.n);
  }

  private finish(run: Run, interrupted: boolean): void {
    if (this.runs.get(run.uid) === run) this.runs.delete(run.uid);
    const { enemy: e, attack: a } = run;
    // The enemy system ended it first (he died, or left), or the body is another enemy's by now.
    if (e.uid !== run.uid || e.attack !== a) return;
    e.attack = null;
    e.attackPhase = 'idle';
    e.attackLoop?.stop(0.12);
    e.attackLoop = null;
    const world = this.world(run.to);
    this.guard(e, () => a.end?.(e, world, interrupted));
    this.seen.ended++;
    this.note(run.uid, a.name, 'end');
  }

  /** Guest, each frame after the copies are posed: every running attack moves along its timeline. */
  animate(dt: number): void {
    for (const [uid, early] of this.early) {
      early.waited += dt;
      if (early.waited > BEGIN_WAIT) this.early.delete(uid);
      else if (this.replicas.enemy(uid)?.alive) { this.early.delete(uid); this.beginIn(early.value, 0, early.waited); }
    }
    if (this.runs.size === 0) return;
    for (const run of this.runs.values()) {
      const { enemy: e, attack: a } = run;
      if (!e.alive || e.uid !== run.uid || e.attack !== a) { this.runs.delete(run.uid); continue; }
      try { this.step(run, e, a, dt); } catch (error) { this.failed(e, error); }
    }
  }

  private step(run: Run, e: Enemy, a: AttackDef, dt: number): void {
    const world = this.world(run.to);
    e.attackClock += dt;
    e.attackLoop?.setPosition(e.center);
    if (e.attackPhase === 'windup') {
      a.windupTick?.(e, world, dt);
      // The shot is the host's to call. If it never does, the attack was cut short and its end was lost.
      if (e.attackClock > e.attackWindup + FIRE_WAIT) this.finish(run, true);
      return;
    }
    if (e.attackPhase === 'active') {
      a.activeTick?.(e, world, dt);
      if (e.attack !== a) return;
      const shots = a.shots ?? 0;
      // A stream for show: this screen makes every glob after the first from the timeline.
      if (a.local) while (e.attackShots < shots && e.attackClock >= e.attackShots * a.active) a.fire(e, world, e.attackShots++);
      if (shots ? e.attackShots >= shots : e.attackClock >= a.active) {
        e.attackPhase = 'recover';
        e.attackClock = 0;
      } else if (shots && !a.local && e.attackClock > e.attackShots * a.active + FIRE_WAIT) this.finish(run, true);
      return;
    }
    if (e.attackClock >= a.recover + FIRE_WAIT) this.finish(run, false);
  }

  dispose(): void {
    for (const run of [...this.runs.values()]) this.finish(run, true);
    this.runs.clear();
    this.early.clear();
  }
}
