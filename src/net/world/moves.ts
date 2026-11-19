/**
 * Enemy moves: the clips and falls a guest cannot work out from where an enemy is. Positions come unreliably, 20 times a
 * second (replicas.ts); a move is a fact, so it goes on the reliable lane, once, stamped with the host's clock:
 *
 * - `stagger`, `stumble`, `daze`: it lost its balance (a shove, an electric floor, a blast that left it standing, a boss
 *   breaking another's guard);
 * - `roar`, `land`, `leap`, `block`: a boss arriving and changing phase, a leaper leaving the ground, a body dropping in;
 * - `down`: knocked off its feet and alive. The guest knocks its own copy down with the same push (gore.knockdown), so the
 *   fall is a real ragdoll there too, landing where its own physics puts it;
 * - `getUp`: it is getting up. A copy lying in its own ragdoll is told to rise; one that never fell plays the clip.
 *
 * **Host.** Nothing in the enemy code sends these. This module listens at the animator and at gore: every enemy's
 * `play`, `stumble`, `daze` and `getUp`, and gore's `knockdown`, are wrapped while a match is hosted, and put back after.
 * Attack clips (`attackMelee`, `attackHeavy`, `shoot`, `throw`) are not sent from here: they belong to the attack events.
 *
 * **Guest.** A move waits until the enemy's playhead reaches its stamp, so it starts where the motion shows it starting,
 * and briefly for an enemy not drawn yet. The gore on a guest starts staggers and knockdowns of its own from the hits it
 * sees (its own shots at once, others' from `hitfx`): a move never restarts a clip of the same kind that began in the last
 * `SAME_KIND_MS` on that copy, whoever began it.
 */
import * as THREE from 'three';
import type { AnimAction, CharacterAnimation, CharacterInstance } from '../../core/contracts';
import type { GetUpKind } from '../../characters/animation/getUp';
import type { Enemy } from '../../enemies/Enemy';
import type { KnockdownOptions } from '../../gore/muscles';
import type { WorldContext, WorldModule } from './context';
import { motionSample } from './motion';
import type { Replicas } from './replicas';

/** What an enemy did. `a` is the move's own numbers (see `Moves.play`). `at` is the host's clock, ms. */
export type MoveEvent = { t: 'move'; uid: number; at: number; m: MoveName; a: number[] };

export const MOVES = ['stagger', 'stumble', 'daze', 'roar', 'land', 'leap', 'block', 'getUp', 'down'] as const;
export type MoveName = typeof MOVES[number];
/** The animator's actions that are moves, by name. The attack clips are not. */
const PLAYED: readonly AnimAction[] = ['stagger', 'roar', 'land', 'leap', 'block'];
const GET_UPS: readonly GetUpKind[] = ['prone', 'supine', 'crawl'];

/** A move never restarts a clip of its own kind begun this recently on the copy (the gore lane's contract). */
export const SAME_KIND_MS = 400;
/** Host: the same move on the same enemy is not sent twice within this. */
const REPEAT_MS = 120;
/** Host: moves a second at most, all enemies together. The rest are dropped: positions still tell the story. */
export const MOVES_PER_SECOND = 90;
/** Guest: a move plays at the latest this long after it came, wherever the playhead is; and waits this long for an unseen enemy. */
const LATE_MS = 700;
const UNSEEN_MS = 1500;
const QUEUE_MAX = 256;
/** Guest: a copy's own ragdoll lies longer than the host's, so only the host's word gets it up (`getUp`), by this much. */
const LIE_EXTRA = 2.5;

type Kind = 'stagger' | 'down' | 'other';
const kindOf = (move: MoveName): Kind => (move === 'stagger' || move === 'stumble' ? 'stagger' : move === 'down' ? 'down' : 'other');

interface Tappable extends CharacterAnimation {
  stumble?(dir: THREE.Vector3, strength: number, bone: number): void;
  daze?(seconds: number): void;
  getUp?(kind: GetUpKind, seconds: number, hurt: number, startU?: number): number;
}
interface Began { stagger: number; down: number; sent: Map<MoveName, number> }
type Gore = WorldContext['ctx']['gore'] & { rouse?(char: CharacterInstance): void };

const round = (value: number): number => Math.round(value * 1000) / 1000;
const _dir = new THREE.Vector3();
const _a = motionSample(), _b = motionSample();

export class Moves implements WorldModule {
  /** Which enemy an animator, and a body, is at the moment. Bodies are pooled: the same one is another enemy later. */
  private readonly owner = new WeakMap<object, Enemy>();
  /** When a clip of each kind last began on an enemy (guest), and when each move was last sent for it (host). */
  private readonly began = new WeakMap<Enemy, Began>();
  private readonly restore: (() => void)[] = [];
  private readonly tapped = new WeakSet<object>();
  /** Guest: moves waiting for their moment. */
  private readonly queue: { event: MoveEvent; came: number }[] = [];
  /** Guest: true while this module is itself starting a clip, so its own taps do not count it twice. */
  private playing = false;
  private second = 0;
  private sentThisSecond = 0;
  /** Sent, played, and left out (host: over the cap; guest: a clip of that kind had just begun, or the enemy never came). */
  readonly counts = { sent: 0, capped: 0, played: 0, covered: 0, expired: 0 };

  constructor(private readonly w: WorldContext, private readonly replicas: Replicas) {
    w.listen('enemy:spawned', event => this.tap(event.enemy as Enemy));
    w.router.guest('move', (value, _from, now) => this.moveIn(value, now));
    this.tapGore();
  }

  private stateOf(enemy: Enemy): Began {
    let state = this.began.get(enemy);
    if (!state) this.began.set(enemy, state = { stagger: -Infinity, down: -Infinity, sent: new Map() });
    return state;
  }

  // -------------------------------------------------------------------------------------------
  // The taps: both sides wrap the same calls. The host sends what it hears; a guest only notes when a clip began.
  // -------------------------------------------------------------------------------------------

  private tap(enemy: Enemy): void {
    const anim = enemy.char.anim as Tappable;
    this.owner.set(anim, enemy);
    this.owner.set(enemy.char, enemy);
    this.began.delete(enemy);
    if (this.tapped.has(anim)) return;
    this.tapped.add(anim);
    const { play, stumble, daze, getUp } = anim;
    anim.play = (action, speed) => {
      const seconds = play.call(anim, action, speed);
      if (PLAYED.includes(action)) this.heard(anim, action as MoveName, speed ?? 1);
      return seconds;
    };
    if (stumble) anim.stumble = (dir, strength, bone) => {
      stumble.call(anim, dir, strength, bone);
      this.heard(anim, 'stumble', dir.x, dir.y, dir.z, strength, bone);
    };
    if (daze) anim.daze = seconds => {
      daze.call(anim, seconds);
      this.heard(anim, 'daze', seconds);
    };
    if (getUp) anim.getUp = (kind, seconds, hurt, startU) => {
      const left = getUp.call(anim, kind, seconds, hurt, startU);
      this.heard(anim, 'getUp', GET_UPS.indexOf(kind), seconds, hurt, startU ?? 0);
      return left;
    };
    this.restore.push(() => {
      anim.play = play;
      if (stumble) anim.stumble = stumble;
      if (daze) anim.daze = daze;
      if (getUp) anim.getUp = getUp;
    });
  }

  private tapGore(): void {
    const gore = this.w.ctx.gore as Gore | undefined;
    const knockdown = gore?.knockdown;
    if (!gore || !knockdown) return;
    gore.knockdown = (char, options) => {
      // A further hit on a body already down is not a new fall.
      const fresh = !gore.downed(char);
      const done = knockdown.call(gore, char, options);
      if (done && fresh) this.fell(char, options);
      return done;
    };
    this.restore.push(() => { gore.knockdown = knockdown; });
  }

  /** An animator began something. */
  private heard(anim: object, move: MoveName, ...a: number[]): void {
    const enemy = this.owner.get(anim);
    if (!enemy?.alive || enemy.char.anim !== anim) return;
    const now = performance.now();
    const kind = kindOf(move);
    if (!this.w.hosting) {
      if (kind !== 'other' && !this.playing) this.stateOf(enemy)[kind] = now;
      return;
    }
    this.send(enemy, move, a, now);
  }

  /** Gore took a living body off its feet. */
  private fell(char: CharacterInstance, o: KnockdownOptions | undefined): void {
    const enemy = this.owner.get(char);
    if (!enemy?.alive || enemy.char !== char) return;
    const now = performance.now();
    if (!this.w.hosting) {
      if (!this.playing) this.stateOf(enemy).down = now;
      return;
    }
    const p = enemy.position, v = o?.velocity, i = o?.impact, t = o?.topple, wound = o?.wound;
    // The wound's point travels as an offset from its feet: the copy stands somewhere a little different.
    this.send(enemy, 'down', [
      i?.dir.x ?? 0, i?.dir.y ?? 0, i?.dir.z ?? 0, i?.strength ?? 0,
      t ? 1 : 0, t?.x ?? 0, t?.y ?? 0, t?.z ?? 0,
      v?.x ?? 0, v?.y ?? 0, v?.z ?? 0,
      o?.lie ?? -1, o?.rise ?? -1, o?.hurt ?? -1,
      wound?.bone ?? -1, wound ? wound.point.x - p.x : 0, wound ? wound.point.y - p.y : 0, wound ? wound.point.z - p.z : 0,
      o?.knockout ? 1 : 0, o?.stumble?.seconds ?? 0, o?.stumble?.budget ?? -1, o?.roll ?? 0,
    ], now);
  }

  private send(enemy: Enemy, move: MoveName, a: number[], now: number): void {
    if (!this.w.ready) return;
    const state = this.stateOf(enemy);
    if (now - (state.sent.get(move) ?? -Infinity) < REPEAT_MS) return;
    const second = Math.floor(now / 1000);
    if (second !== this.second) { this.second = second; this.sentThisSecond = 0; }
    if (++this.sentThisSecond > MOVES_PER_SECOND) { this.counts.capped++; return; }
    state.sent.set(move, now);
    this.counts.sent++;
    this.w.send({ t: 'move', uid: enemy.uid, at: Math.round(now), m: move, a: a.map(round) });
  }

  // -------------------------------------------------------------------------------------------
  // Guest
  // -------------------------------------------------------------------------------------------

  private moveIn(value: MoveEvent, now: number): void {
    if (!Number.isInteger(value.uid) || value.uid <= 0 || !Number.isFinite(value.at) || !MOVES.includes(value.m)) return;
    if (!Array.isArray(value.a) || value.a.length > 24 || !value.a.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 1e6)) return;
    if (this.replicas.dead.has(value.uid)) return;
    if (this.queue.length >= QUEUE_MAX) { this.queue.shift(); this.counts.expired++; }
    this.queue.push({ event: value, came: now });
  }

  /** Guest, each frame: the moves whose moment has come. */
  update(now: number): void {
    if (this.w.hosting || this.queue.length === 0) return;
    const queue = this.queue;
    for (let index = 0; index < queue.length; index++) {
      const { event, came } = queue[index]!;
      const replica = this.replicas.map.get(event.uid);
      const gone = this.replicas.dead.has(event.uid) || now - came > (replica ? LATE_MS * 2 : UNSEEN_MS);
      // Its moment: the copy is drawing the host's time the move was stamped with, or it has waited long enough.
      const due = !!replica && (replica.motion.playhead >= event.at || now - came > LATE_MS);
      if (!gone && !due) continue;
      queue.splice(index--, 1);
      if (gone || !replica) { this.counts.expired++; continue; }
      try { this.play(replica.enemy, event, now); } catch (error) { console.warn('[coop] Dropped an enemy move that could not be played', event.m, error); }
    }
  }

  private play(enemy: Enemy, event: MoveEvent, now: number): void {
    const { m: move, a } = event;
    const anim = enemy.char.anim as Tappable;
    const state = this.stateOf(enemy);
    const kind = kindOf(move);
    // The same kind of clip began on this copy a moment ago (its own gore, from a hit seen here): that one stands.
    if (kind !== 'other' && now - state[kind] < SAME_KIND_MS) { this.counts.covered++; return; }
    const gore = this.w.ctx.gore as Gore;
    const down = gore.downed?.(enemy.char) ?? null;
    this.playing = true;
    try {
      if (move === 'getUp') {
        // Lying in its own ragdoll: that gets up by itself now. Never fell here: the clip, from wherever it lies.
        // (Not one this player's own hit dropped for dead a moment ago: that waits for the host's answer to the hit, hits.ts.)
        if (down) { if (enemy.predead === 0) gore.rouse?.(enemy.char); }
        else anim.getUp?.(GET_UPS[a[0]!] ?? 'prone', Math.max(0.2, Math.min(6, a[1] ?? 1)), Math.max(0, Math.min(1, a[2] ?? 0.5)), Math.max(0, Math.min(0.9, a[3] ?? 0)));
      } else if (down) {
        // Gore has the body: an animator clip would fight it. A second fall on a body already down is nothing new.
      } else if (move === 'down') {
        if (this.knock(enemy, event)) state.down = now;
      } else if (move === 'stumble') {
        _dir.set(a[0] ?? 0, a[1] ?? 0, a[2] ?? 0);
        const bone = a[4] ?? 0;
        if (anim.stumble && _dir.lengthSq() > 1e-6 && Number.isInteger(bone) && bone >= 0 && bone < enemy.char.rig.bones.length) anim.stumble(_dir.normalize(), Math.max(0, Math.min(1, a[3] ?? 0.5)), bone);
        else anim.play('stagger', 1);
        state.stagger = now;
      } else if (move === 'daze') {
        anim.daze?.(Math.max(0, Math.min(10, a[0] ?? 1)));
      } else {
        anim.play(move, Math.max(0.2, Math.min(4, a[0] ?? 1)));
        if (move === 'stagger') state.stagger = now;
      }
      this.counts.played++;
    } finally { this.playing = false; }
  }

  /** The copy goes down as the host's did: the same push, its own physics. False if gore has no room: it lies in a posture. */
  private knock(enemy: Enemy, event: MoveEvent): boolean {
    const a = event.a;
    const gore = this.w.ctx.gore as Gore;
    const char = enemy.char;
    const n = (index: number, fallback = 0): number => a[index] ?? fallback;
    const o: KnockdownOptions = { velocity: new THREE.Vector3(n(8), n(9), n(10)) };
    const strength = Math.max(0, Math.min(4, n(3)));
    if (Math.hypot(n(0), n(1), n(2)) > 1e-3) o.impact = { dir: new THREE.Vector3(n(0), n(1), n(2)).normalize(), strength };
    if (n(4) === 1) o.topple = new THREE.Vector3(n(5), n(6), n(7)).clampLength(0, 12);
    // Thrown (a blast): the host's body is carried by its blast, which this page may not have. Where the host's body went
    // in the moments after says how hard: the copy is thrown the same way.
    const motion = this.replicas.map.get(enemy.uid)?.motion;
    if (motion && motion.newest >= event.at + 80) {
      const later = Math.min(motion.newest, event.at + 160);
      motion.read(event.at, _a); motion.read(later, _b);
      const seconds = (later - event.at) / 1000;
      if (_a.mode !== 2 && _b.mode !== 2 && seconds > 0.05) {
        _dir.set((_b.x - _a.x) / seconds, (_b.y - _a.y) / seconds, (_b.z - _a.z) / seconds).clampLength(0, 25);
        if (_dir.length() > o.velocity!.length() + 1.5) o.velocity!.copy(_dir);
      }
    }
    o.velocity!.clampLength(0, 25);
    // It lies until the host says it is getting up (`rouse`); without that word, about as long as the host's.
    if (n(11, -1) >= 0) o.lie = Math.min(30, n(11)) + (gore.rouse ? LIE_EXTRA : 0);
    if (n(12, -1) >= 0) o.rise = Math.max(0, Math.min(8, n(12)));
    if (n(13, -1) >= 0) o.hurt = Math.max(0, Math.min(1, n(13)));
    const bone = n(14, -1);
    if (Number.isInteger(bone) && bone >= 0 && bone < char.rig.bones.length) {
      o.wound = { bone, point: new THREE.Vector3(enemy.position.x + n(15), enemy.position.y + n(16), enemy.position.z + n(17)) };
      o.knockout = n(18) === 1;
    }
    if (n(19) > 0) o.stumble = { seconds: Math.min(3, n(19)), budget: n(20, -1) >= 0 ? Math.min(1, n(20)) : undefined };
    if (n(21) > 0) o.roll = Math.min(10, n(21));
    if (!gore.knockdown(char, o)) {
      // Refused as a stumble (no room for one more, uneven ground here): the plain fall, as the host's own code falls back.
      if (!o.stumble) return false;
      o.stumble = undefined;
      if (!o.topple && o.impact) o.topple = o.impact.dir.clone().multiplyScalar(2);
      if (!gore.knockdown(char, o)) return false;
    }
    enemy.downed = true;
    return true;
  }

  dispose(): void {
    for (const undo of this.restore) undo();
    this.restore.length = 0;
    this.queue.length = 0;
  }
}

declare module '../../core/contracts' {
  interface GoreSystem {
    /**
     * A body gore has down stops waiting out its time on the floor and gets up as soon as it has come to rest. Co-op: a
     * guest's copy lies until the host's has started to get up (net/world/moves.ts).
     */
    rouse?(char: CharacterInstance): void;
  }
}
