/**
 * The team's slow motion: the rules, with no game in them (clock.ts runs them, slow.test.ts tests them).
 *
 * One world, the host's, so slow-mo is everyone's: any player can cause it with what causes it alone (the Focus brain chip, the
 * SLOWMO perk, a Time Warp capsule), and a boss's death causes it for the world. The host keeps the list (`SlowBoard`) and
 * every screen applies the same list, so the world slows for all and each player keeps their own full speed.
 *
 * Rules:
 *  - The deepest scale wins; everyone slowing the world at that moment is named.
 *  - Asking again while yours runs (a second Time Warp capsule) resets its clock to full. It never adds.
 *  - Each request has a length it cannot outlive (`cap`), so a player who drops off the network cannot leave the world slow.
 *  - A player who is down or dead cannot slow the world, and what they had running ends.
 *  - The team's budget (`TEAM_SLOW`): players can keep the world slow for 12 s in a row. The budget fills again at one second
 *    for each second at full speed. Run dry, the world goes back to full speed and nothing new starts until 3 s are back.
 *    A boss's death is the world's own: it is never refused and spends none of the budget.
 */
export const SLOW_KINDS = ['focus', 'slowmo', 'timeWarp', 'bossDeath'] as const;
export type SlowKind = typeof SLOW_KINDS[number];
/** The kinds a player causes (a guest may ask for these; never for a boss's death). */
export const PLAYER_SLOW: readonly SlowKind[] = ['focus', 'slowmo', 'timeWarp'];
export const isSlowKind = (value: unknown): value is SlowKind => SLOW_KINDS.includes(value as SlowKind);

/**
 * Each kind's world speed, blend in and out (seconds of real time) and the longest it may run (`cap`, seconds of real time).
 * Scales and blend-ins are single player's (chips.ts FOCUS, progression/index.ts, enemies/bosses.ts). The blend out is half a
 * second or more for all of them, so the world eases back on every screen.
 */
export const SLOW: Readonly<Record<SlowKind, { scale: number; fadeIn: number; fadeOut: number; cap: number }>> = {
  focus: { scale: 0.35, fadeIn: 0.12, fadeOut: 0.5, cap: 4.5 },
  slowmo: { scale: 0.25, fadeIn: 0.18, fadeOut: 0.5, cap: 5.5 },
  timeWarp: { scale: 0.25, fadeIn: 0.18, fadeOut: 0.5, cap: 5.5 },
  bossDeath: { scale: 0.4, fadeIn: 0.05, fadeOut: 0.6, cap: 9 },
};

/** The team's budget, in seconds of real time. */
export const TEAM_SLOW = {
  /** The longest the players can keep the world slow in a row. */
  bank: 12,
  /** Seconds of budget back for each second the world runs at full speed. */
  refill: 1,
  /** Run dry, this much has to be back before anyone can slow the world again. */
  restart: 3,
} as const;

/** Why the host said no: the player is down or dead, or the team's budget is spent. */
export type SlowRefusal = 'down' | 'spent';

/** One thing slowing the world, as every screen keeps it. `until` is on that screen's own clock (`performance.now()`). */
export interface SlowEntry {
  /** One per player and kind; a boss's death is the world's (`boss`). */
  key: string;
  kind: SlowKind;
  /** Who caused it: a player's slot, or -1 for the world. */
  slot: number;
  scale: number;
  until: number;
  /** How long it was granted for, ms: the notice's bar drains against it. */
  total: number;
  /** A boss's death: the boss's name. */
  label: string;
}

export const slowKey = (slot: number, kind: SlowKind): string => kind === 'bossDeath' ? 'boss' : `${slot}:${kind}`;

/** The host's list of what is slowing the world, and the team's budget. All times are the host's `performance.now()`. */
export class SlowBoard {
  /** What is slowing the world now. Rebuilt only when it changes. */
  list: SlowEntry[] = [];
  /** Goes up whenever the list or the lock changes: the host sends the state again. */
  version = 0;
  /** Seconds of budget left. */
  bank: number = TEAM_SLOW.bank;
  private dry = false;
  private last = -1;
  private readonly entries = new Map<string, SlowEntry>();

  /** True while the budget is spent: nothing a player asks for is granted. */
  get locked(): boolean { return this.dry; }
  /** How long until the team can slow the world again, ms. */
  get lockMs(): number { return this.dry ? Math.max(0, (TEAM_SLOW.restart - this.bank) / TEAM_SLOW.refill) * 1000 : 0; }
  /** The world's speed with everything on the list at full strength. */
  get scale(): number {
    let scale = 1;
    for (const entry of this.list) scale = Math.min(scale, entry.scale);
    return scale;
  }

  /**
   * A player (or the world, slot -1) asks to slow the world. `seconds` is how long it means to (Focus: what is left on its
   * meter); the kind's cap bounds it. Asking again while it runs starts its clock again. Returns why not, or null.
   */
  request(now: number, slot: number, kind: SlowKind, up: boolean, seconds = Infinity, scale: number = SLOW[kind].scale, label = ''): SlowRefusal | null {
    this.update(now);
    if (kind !== 'bossDeath') {
      if (!up) return 'down';
      if (this.dry) return 'spent';
    }
    const total = Math.max(0.1, Math.min(SLOW[kind].cap, Number.isFinite(seconds) ? seconds : SLOW[kind].cap)) * 1000;
    const key = slowKey(slot, kind);
    this.entries.set(key, { key, kind, slot, scale: Math.max(0.2, Math.min(0.95, scale)), until: now + total, total, label });
    this.changed();
    return null;
  }

  /** The player let go (Focus tapped off, the perk ran out, the boss finished dying). */
  release(slot: number, kind: SlowKind): void {
    if (this.entries.delete(slowKey(slot, kind))) this.changed();
  }

  /** Everything a player had running: they went down, died or left. */
  drop(slot: number): void {
    let any = false;
    for (const [key, entry] of this.entries) if (entry.slot === slot && entry.kind !== 'bossDeath') { this.entries.delete(key); any = true; }
    if (any) this.changed();
  }

  /** A boss's death learns who it was after the fact (the kill is announced after the boss starts dying). */
  name(slot: number, label: string): void {
    const entry = this.entries.get('boss');
    if (!entry || (entry.slot === slot && entry.label === label)) return;
    entry.slot = slot; entry.label = label;
    this.changed();
  }

  /** Every frame: ends what has run its length, and keeps the team's budget. */
  update(now: number): void {
    // A stalled host tab does not get to spend or bank the stall.
    const seconds = this.last < 0 ? 0 : Math.max(0, Math.min(0.25, (now - this.last) / 1000));
    this.last = now;
    let spending = false, any = false;
    for (const [key, entry] of this.entries) {
      if (now >= entry.until) { this.entries.delete(key); any = true; }
      else if (entry.kind !== 'bossDeath') spending = true;
    }
    if (spending) {
      this.bank = Math.max(0, this.bank - seconds);
      if (this.bank <= 0) {
        this.dry = true;
        for (const [key, entry] of this.entries) if (entry.kind !== 'bossDeath') this.entries.delete(key);
        any = true;
      }
    } else {
      this.bank = Math.min(TEAM_SLOW.bank, this.bank + seconds * TEAM_SLOW.refill);
      if (this.dry && this.bank >= TEAM_SLOW.restart) { this.dry = false; any = true; }
    }
    if (any) this.changed();
  }

  private changed(): void {
    this.list = [...this.entries.values()];
    this.version++;
  }
}

/** The notice's words for one entry: who, and what they did. `who` is empty when the world did it. */
export function slowLine(kind: SlowKind, name: string, label: string): { who: string; what: string } {
  switch (kind) {
    case 'focus': return { who: name, what: 'used Focus' };
    case 'slowmo': return { who: name, what: 'earned SLOWMO' };
    case 'timeWarp': return { who: name, what: 'took Time Warp' };
    case 'bossDeath': {
      const boss = (label || 'boss').toUpperCase();
      return name ? { who: name, what: `killed the ${boss}` } : { who: '', what: `The ${boss} is dead` };
    }
  }
}
