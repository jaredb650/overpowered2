/**
 * Time in co-op. The world is the host's, so slow motion is the team's: one player slows everyone, and every screen says who
 * and with what (slowNotice.ts). The rules are slow.ts (`SlowBoard`, on the host); this module is the plumbing.
 *
 *  - Every slow-mo request the game makes (`ctx.time.pushScale` / `popScale`) comes here instead of the clock, on host and guest
 *    alike (`TimeGate`). The ones a team shares are Focus, SLOWMO, Time Warp and a boss's death; the rest (hit-stop, the
 *    Judge's fan, the death beat, the dev panel) do nothing in co-op.
 *  - A guest's request goes to the host as `slow`. The host's board decides, and its answer is `slowstate`: everything slowing
 *    the world now, who caused each, its scale and how long it has left. It goes out on every change, four times a second while
 *    the world is slow and every 2 s otherwise, so a lost message or a late joiner is put right. A refusal is `slowno`.
 *  - Every screen applies that list to its own clock (`ctx.time.share`): the world clock `dt` slows (replica animation, enemy
 *    projectiles, physics, ragdolls, gore, particles, audio pitch), the player's own clock `playerDt` never does. A guest's
 *    screen therefore behaves exactly as a single-player screen in slow-mo. Each entry also ends by itself on its own deadline.
 *  - A guest's own request is applied at once on its own screen and confirmed by the host's next state, so the key has no lag.
 *  - The host cuts a long frame into several world steps (`ctx.time.hostSteps`, core/time.ts), so a slow host does not run the
 *    world in slow motion for everyone.
 */
import type { GradeName } from '../../core/contracts';
import type { KillEvent } from '../../core/gameplay';
import type { TimeGate } from '../../core/time';
import { FOCUS } from '../../contracts/chips';
import { EFFECTS } from '../../progression/data';
import type { WorldContext, WorldModule } from './context';
import { PLAYER_SLOW, SLOW, SlowBoard, isSlowKind, slowKey, type SlowEntry, type SlowKind, type SlowRefusal } from './slow';
import { SlowNotice } from './slowNotice';

/** One entry of the host's list on the wire: kind, causer's slot, scale, ms left, ms it was granted, a boss's name. */
type WireSlow = { k: SlowKind; s: number; sc: number; ms: number; of: number; nm?: string };
export type SlowEvent =
  /** Guest to host: my slow-mo started (`on`, for about `s` seconds) or ended. */
  | { t: 'slow'; id: string; on: boolean; s?: number }
  /** Host to guests: everything slowing the world now, and how long until the team may slow it again (`lock`, ms; 0: now). */
  | { t: 'slowstate'; list: WireSlow[]; lock: number }
  /** Host to one guest: no. `ms` until the team's budget allows it again. */
  | { t: 'slowno'; id: string; why: SlowRefusal; ms: number };

/** The game's own request ids (core/time.ts pushScale) that are a team's slow-mo. Any other id does nothing in co-op. */
const KIND_OF: Readonly<Record<string, SlowKind>> = { focus: 'focus', slowmo: 'slowmo', timeWarp: 'timeWarp', bossDeath: 'bossDeath' };
/** How often the host repeats the state: while the world is slow, and while it is not. */
const STATE_MS = 250;
const IDLE_MS = 2000;
/** Guest: how long its own request stands on its own screen before the host's state must have confirmed it. */
const PREDICT_MS = 700;
/** Guest: how long after letting go the host's state may still list the request (the `off` is on its way). */
const RELEASE_MS = 700;
/** Guest: an entry that has outlived its deadline by this much ends by itself (its end never arrived). */
const OVERDUE_MS = 500;

type Slowed = Extract<SlowEvent, { t: 'slowstate' }>;
type Refusal = { kind: SlowKind; why: SlowRefusal | 'ended'; seconds: number };

export class Clock implements WorldModule, TimeGate {
  /** Host: the rules. */
  readonly board = new SlowBoard();
  /** What is slowing the world on this screen now: the host's board, or what the host last said (plus a guest's own, unconfirmed). */
  active: readonly SlowEntry[] = [];
  /** My own requests that are running: kind, and when I asked. */
  private readonly mine = new Map<SlowKind, number>();
  /** Guest: kinds I just let go of, and until when the host's state may still list them. */
  private readonly released = new Map<SlowKind, number>();
  /** The request ids on `ctx.time`, by entry key, with the frame they were last wanted. */
  private readonly applied = new Map<string, { id: string; kind: SlowKind; seen: number }>();
  private stamp = 0;
  private refusal: Refusal | null = null;
  /** Guest: the host's word on when the team may slow the world again. */
  private lockUntil = 0;
  private sentVersion = -1;
  private nextState = 0;
  private notice: SlowNotice | null = null;
  /** Host: the boss that died last, for the notice of its death. */
  private boss: { slot: number; label: string; at: number } | null = null;
  private grade: GradeName | null = null;
  private strangers = 0;

  /** `killer`: the slot of whoever killed an enemy that died this frame, -1 nobody's (credit.ts). */
  constructor(private readonly w: WorldContext, private readonly killer: (uid: number) => number = () => -1) {
    const time = w.ctx.time;
    time.gate = this;
    if (w.hosting) {
      time.hostSteps = true;
      w.listen('enemy:killed', event => this.bossKilled(event));
    }
    w.router.host('slow', (value, from, now) => this.asked(value, from, now));
    w.router.guest('slowstate', (value, _from, now) => this.told(value, now));
    w.router.guest('slowno', (value, _from, now) => {
      if (!isSlowKind(value.id) || !this.mine.has(value.id)) return;
      this.refuse(value.id, value.why === 'down' ? 'down' : 'spent', Number.isFinite(value.ms) ? Math.max(0, Math.min(60_000, value.ms)) : 0, now);
    });
  }

  private get slot(): number { return this.w.session.lobby.me?.slot ?? 0; }

  // --- TimeGate: the local game asks for slow-mo, or lets go -------------------------------------------------------------

  push(id: string, scale: number): void {
    const kind = KIND_OF[id];
    if (!kind) return;
    const { w } = this;
    const now = performance.now();
    if (w.hosting) {
      if (kind === 'bossDeath') {
        const boss = this.boss && now - this.boss.at < 1500 ? this.boss : null;
        this.board.request(now, boss?.slot ?? -1, kind, true, Infinity, scale, boss?.label ?? '');
        return;
      }
      const no = this.board.request(now, this.slot, kind, this.up(), this.length(kind));
      if (no) this.refuse(kind, no, this.board.lockMs, now);
      else this.mine.set(kind, now);
      return;
    }
    // A guest never runs a boss, and its own player's state is checked here first so a refusal does not flash on and off.
    if (kind === 'bossDeath') return;
    if (!this.up()) return this.refuse(kind, 'down', 0, now);
    if (now < this.lockUntil) return this.refuse(kind, 'spent', this.lockUntil - now, now);
    // Asked again while it runs (a second Time Warp): the host restarts its clock, but "just asked" stays the first ask, so
    // when the host ends it this screen lets go at once instead of waiting for an answer that has already come.
    const again = this.mine.has(kind);
    if (!again) this.mine.set(kind, now);
    this.released.delete(kind);
    w.send({ t: 'slow', id: kind, on: true, s: this.length(kind) });
    // On my own screen at once; the host's next state confirms it (or `slowno` takes it back).
    if (!again) this.predict(kind, now);
  }

  pop(id: string): void {
    const kind = KIND_OF[id];
    if (!kind) return;
    if (this.w.hosting) {
      if (kind === 'bossDeath') this.board.release(-1, kind);
      else if (this.mine.delete(kind)) this.board.release(this.slot, kind);
      return;
    }
    if (!this.mine.delete(kind)) return;
    const now = performance.now();
    this.w.send({ t: 'slow', id: kind, on: false });
    this.released.set(kind, now + RELEASE_MS);
    const key = slowKey(this.slot, kind);
    this.active = this.active.filter(entry => entry.key !== key);
  }

  /** Is my own request of this kind still slowing the world (or still on its way to the host)? */
  held(kind: SlowKind): boolean { return this.mine.has(kind); }

  /** Why my last request of this kind was refused or cut short, once. */
  takeRefusal(kind: SlowKind): Refusal | null {
    const refusal = this.refusal;
    if (!refusal || refusal.kind !== kind) return null;
    this.refusal = null;
    return refusal;
  }

  /** What the notice reads right now, for the proofs. */
  readNotice(): { lines: string[]; state: string } { return this.notice?.read() ?? { lines: [], state: '' }; }

  // --- the wire ----------------------------------------------------------------------------------------------------------

  /** Host: a guest's slow-mo started or ended. */
  private asked(value: Extract<SlowEvent, { t: 'slow' }>, from: string, now: number): void {
    const kind = value.id;
    if (!isSlowKind(kind) || !PLAYER_SLOW.includes(kind) || typeof value.on !== 'boolean') return;
    const player = this.w.session.lobby.players.find(p => p.id === from);
    if (!player) return;
    if (!value.on) return this.board.release(player.slot, kind);
    const seconds = typeof value.s === 'number' && Number.isFinite(value.s) && value.s > 0 ? value.s : Infinity;
    const no = this.board.request(now, player.slot, kind, this.w.life(from).state === 'up', seconds);
    if (no) this.w.send({ t: 'slowno', id: kind, why: no, ms: Math.round(this.board.lockMs) }, from);
  }

  /** Guest: the host's list. */
  private told(value: Slowed, now: number): void {
    if (!Array.isArray(value.list) || value.list.length > 12) return;
    const me = this.slot;
    const next: SlowEntry[] = [];
    for (const item of value.list) {
      if (!item || !isSlowKind(item.k) || !Number.isInteger(item.s) || item.s < -1 || item.s > 3) continue;
      if (![item.sc, item.ms, item.of].every(n => typeof n === 'number' && Number.isFinite(n))) continue;
      // Mine, and I am not holding it: I let go and the host has not heard yet. It stays off this screen; if the host still
      // lists it after the grace, my word was lost (or this page was reloaded), so it is said again.
      if (item.s === me && item.k !== 'bossDeath' && !this.mine.has(item.k)) {
        if ((this.released.get(item.k) ?? 0) <= now) {
          this.w.send({ t: 'slow', id: item.k, on: false });
          this.released.set(item.k, now + RELEASE_MS);
        }
        continue;
      }
      const cap = SLOW[item.k].cap * 1000;
      const left = Math.max(0, Math.min(cap, item.ms));
      next.push({ key: slowKey(item.s, item.k), kind: item.k, slot: item.s, scale: Math.max(0.2, Math.min(1, item.sc)), until: now + left,
        total: Math.max(left, Math.min(cap, item.of)), label: typeof item.nm === 'string' ? item.nm.slice(0, 24) : '' });
    }
    for (const [kind, at] of this.mine) {
      const key = slowKey(me, kind);
      if (next.some(entry => entry.key === key)) continue;
      // Asked a moment ago: the host's answer is still on its way, so mine stays up. Older than that, the host has ended it.
      const own = this.active.find(entry => entry.key === key);
      if (now - at < PREDICT_MS && own) next.push(own);
      else if (now - at >= PREDICT_MS) this.refuse(kind, 'ended', 0, now);
    }
    this.active = next;
    this.lockUntil = Number.isFinite(value.lock) && value.lock > 0 ? now + Math.min(60_000, value.lock) : 0;
  }

  // --- every frame -------------------------------------------------------------------------------------------------------

  /** Before the clock ticks (Game.run): the list is brought up to date and applied to this screen's clock. */
  clock(): void {
    const { w } = this;
    const time = w.ctx.time;
    const now = performance.now();
    if (w.hosting) {
      this.board.update(now);
      this.police();
      this.active = this.board.list;
    } else if (this.active.length > 0) {
      // An entry whose end never arrived ends on its own deadline; my own unconfirmed one when the host stays silent.
      let stale = false;
      for (const entry of this.active) if (now > entry.until + OVERDUE_MS) stale = true;
      if (stale) this.active = this.active.filter(entry => now <= entry.until + OVERDUE_MS);
    }
    if (this.active.length === 0 && this.applied.size === 0) return;
    this.stamp++;
    let grade: GradeName | null = null, strangers = 0;
    const me = this.slot;
    for (const entry of this.active) {
      let applied = this.applied.get(entry.key);
      if (!applied) {
        this.applied.set(entry.key, applied = { id: `coop:${entry.key}`, kind: entry.kind, seen: 0 });
        // Someone else's slow-mo has a sound of its own; the causer hears what single player plays.
        if (entry.slot !== me) w.ctx.audio.play('time_warp_in');
      }
      applied.seen = this.stamp;
      const def = SLOW[entry.kind];
      time.share?.(applied.id, entry.scale, def.fadeIn, def.fadeOut);
      // The SLOWMO look is the perk's in single player; a teammate's SLOWMO or Time Warp gives it to every screen.
      if (entry.kind === 'slowmo' || entry.kind === 'timeWarp') grade = 'slowmo';
      if (entry.slot !== me) strangers++;
    }
    for (const [key, applied] of this.applied) if (applied.seen !== this.stamp) {
      time.unshare?.(applied.id);
      this.applied.delete(key);
    }
    if (strangers === 0 && this.strangers > 0) w.ctx.audio.play('time_warp_out');
    this.strangers = strangers;
    if (grade !== this.grade) {
      this.grade = grade;
      (w.ctx.progression as { shareGrade?(grade: GradeName | null): void } | undefined)?.shareGrade?.(grade);
    }
  }

  /** Once the world has begun: the host's state goes out, and the notice is drawn. */
  update(now: number): void {
    const { w } = this;
    if (w.hosting && (this.board.version !== this.sentVersion || now >= this.nextState)) {
      this.sentVersion = this.board.version;
      this.nextState = now + (this.board.list.length > 0 ? STATE_MS : IDLE_MS);
      w.send({ t: 'slowstate', lock: Math.round(this.board.lockMs), list: this.board.list.map(entry => ({ k: entry.kind, s: entry.slot, sc: entry.scale,
        ms: Math.max(0, Math.round(entry.until - now)), of: Math.round(entry.total), ...(entry.label ? { nm: entry.label } : {}) })) });
    }
    if (!this.notice && typeof document !== 'undefined' && (this.active.length > 0)) {
      this.notice = new SlowNotice(w.ctx, { name: slot => w.session.lobby.players.find(p => p.slot === slot)?.name ?? '', me: this.slot });
    }
    this.notice?.update(this.active, now);
  }

  dispose(): void {
    const time = this.w.ctx.time;
    if (time.gate === this) time.gate = null;
    time.hostSteps = false;
    for (const applied of this.applied.values()) time.unshare?.(applied.id);
    this.applied.clear();
    if (this.grade) (this.w.ctx.progression as { shareGrade?(grade: GradeName | null): void } | undefined)?.shareGrade?.(null);
    this.notice?.dispose();
  }

  // --- helpers -----------------------------------------------------------------------------------------------------------

  /** This player is on their feet. */
  private up(): boolean {
    const { w } = this;
    const player = w.ctx.player as typeof w.ctx.player & { downed?: boolean };
    return player.alive && !player.downed && (!w.hosting || w.life(w.session.lobby.you).state === 'up');
  }

  /** How long a request of mine means to run, seconds: what Focus has on its meter, a perk's length. */
  private length(kind: SlowKind): number {
    if (kind === 'focus') {
      const meter = (this.w.ctx.contracts as { chips?: { meter?: number } } | undefined)?.chips?.meter;
      return typeof meter === 'number' ? meter * FOCUS.seconds + 0.25 : SLOW.focus.cap;
    }
    return kind === 'slowmo' || kind === 'timeWarp' ? EFFECTS[kind].seconds + 0.25 : SLOW[kind].cap;
  }

  /** Guest: my own request on my own screen, until the host's state lists it. */
  private predict(kind: SlowKind, now: number): void {
    const key = slowKey(this.slot, kind);
    if (this.active.some(entry => entry.key === key)) return;
    const total = Math.min(SLOW[kind].cap, this.length(kind)) * 1000;
    this.active = [...this.active, { key, kind, slot: this.slot, scale: SLOW[kind].scale, until: now + total, total, label: '' }];
  }

  /** My request was refused, or the host ended it: it comes off this screen, and its owner is told why. */
  private refuse(kind: SlowKind, why: Refusal['why'], ms: number, now: number): void {
    const { ctx } = this.w;
    this.mine.delete(kind);
    this.refusal = { kind, why, seconds: Math.ceil(ms / 1000) };
    if (!this.w.hosting) {
      const key = slowKey(this.slot, kind);
      this.active = this.active.filter(entry => entry.key !== key);
      if (why === 'spent') this.lockUntil = Math.max(this.lockUntil, now + ms);
    }
    if (why === 'ended') return;
    ctx.audio.play('ui_error');
    ctx.hud.callout?.(why === 'down' ? 'NO SLOW-MO WHILE DOWN' : `TEAM SLOW-MO SPENT · ${Math.max(1, Math.ceil(ms / 1000))} S`);
  }

  /** Host: nobody who is down, dead or gone keeps the world slow; and a request the board ended is its owner's to hear of. */
  private police(): void {
    const { w, board } = this;
    for (const entry of board.list) {
      if (entry.kind === 'bossDeath') continue;
      const player = w.session.lobby.players.find(p => p.slot === entry.slot);
      if (!player || w.life(player.id).state !== 'up') board.drop(entry.slot);
    }
    for (const kind of this.mine.keys()) {
      if (board.list.some(entry => entry.slot === this.slot && entry.kind === kind)) continue;
      this.refuse(kind, board.locked ? 'spent' : 'ended', board.lockMs, performance.now());
    }
  }

  /** Host: a boss died. Its death's slow-mo names it, and whoever killed it. */
  private bossKilled(event: KillEvent): void {
    const enemy = event.enemy as KillEvent['enemy'] & { def?: { name?: string; boss?: unknown } };
    if (!enemy.def?.boss) return;
    const slot = this.killer(enemy.uid);
    this.boss = { slot, label: enemy.def.name ?? enemy.id, at: performance.now() };
    this.board.name(slot, this.boss.label);
  }
}
