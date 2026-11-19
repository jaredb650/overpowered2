/**
 * The Commander's notebooks. Alone there is one, `own`, and every method here is that notebook's own answer, number for
 * number. In co-op the host keeps one a player (the host's is still `own`), because a habit is one player's: the one who
 * camps is the camper, however the other three move.
 *
 * What he does with several:
 *   - **What he answers** (`habits`): each habit at the strength of whoever leans on it hardest. Never a sum: four players who
 *     each ping once a minute are not one sonar addict. `leader` names that player, so the answer can be aimed at them.
 *   - **Where he lays things** (`hotDoors`, `hotCells`): every player's crossings and footfalls added up, so a door three
 *     players use outranks one that one player uses. That is the routes the team actually takes, weighted by who takes them.
 *   - **What the box quotes** (`closeRound` then `report`): one player's round, never a blend, so every number in it is true
 *     of somebody.
 */
import type { HabitId } from './adaptations';
import { cellKey, StyleTracker, type Cell, type DoorMark, type RoundReport } from './tracker';

export class Books {
  /** The host's own player's, and the only one alone. */
  readonly own = new StyleTracker();
  private readonly others = new Map<string, StyleTracker>();
  private readonly reports = new Map<string, RoundReport>();
  private ownReport: RoundReport | null = null;
  private doors: readonly DoorMark[] = [];
  /** Who leans hardest on each habit, as of the last `habits()`: a lobby id, or null for the host's own player. */
  readonly leader = new Map<HabitId, string | null>();

  /** True while there is more than the one notebook. */
  get shared(): boolean {
    return this.others.size > 0;
  }

  /** A player's notebook: `null` is the host's own. A guest's is opened the first time it is asked for. */
  of(id: string | null): StyleTracker {
    if (id === null) return this.own;
    let book = this.others.get(id);
    if (!book) {
      book = new StyleTracker();
      book.setDoors(this.doors);
      this.others.set(id, book);
    }
    return book;
  }

  setDoors(doors: readonly DoorMark[]): void {
    this.doors = doors;
    this.own.setDoors(doors);
    for (const book of this.others.values()) book.setDoors(doors);
  }

  /** A new run: the host's is wiped and the guests' are thrown away. */
  reset(): void {
    this.own.reset();
    this.others.clear();
    this.reports.clear();
    this.ownReport = null;
    this.leader.clear();
  }

  /** Players who have left take their notebooks with them: a habit nobody here has is not answered. */
  keep(ids: ReadonlySet<string>): void {
    for (const id of this.others.keys()) if (!ids.has(id)) this.others.delete(id);
  }

  /** Closes the wave in every notebook. Returns the host's own round. */
  closeRound(wave: number): RoundReport {
    this.reports.clear();
    for (const [id, book] of this.others) this.reports.set(id, book.closeRound(wave));
    return (this.ownReport = this.own.closeRound(wave));
  }

  /** The round just closed, as `id` played it (`null`: the host's own player). */
  report(id: string | null): RoundReport | null {
    return (id === null ? this.ownReport : this.reports.get(id)) ?? this.ownReport;
  }

  /** How strongly the team leans on each habit: for each, the player who leans on it most. */
  habits(): Record<HabitId, number> {
    const best = this.own.habits();
    this.leader.clear();
    for (const [id, book] of this.others) {
      const theirs = book.habits();
      for (const key of Object.keys(theirs) as HabitId[]) {
        if (theirs[key] <= best[key]) continue;
        best[key] = theirs[key];
        this.leader.set(key, id);
      }
    }
    return best;
  }

  /** The doors the players go through most, busiest first: every player's crossings added up. */
  hotDoors(limit: number): number[] {
    if (this.others.size === 0) return this.own.hotDoors(limit);
    const total = (i: number): number => {
      let n = this.own.doorCrossings(i);
      for (const book of this.others.values()) n += book.doorCrossings(i);
      return n;
    };
    const order: number[] = [];
    for (let i = 0; i < this.own.doorCount; i++) if (total(i) > 0) order.push(i);
    order.sort((a, b) => total(b) - total(a));
    return order.slice(0, limit);
  }

  /** The squares the players stand in most: every player's visits added up. */
  hotCells(limit: number): Cell[] {
    if (this.others.size === 0) return this.own.hotCells(limit);
    const all = new Map<number, Cell>();
    const add = (book: StyleTracker): void => {
      for (const c of book.cellsSeen()) {
        const key = cellKey(c.x, c.z);
        const have = all.get(key);
        if (have) have.visits += c.visits;
        else all.set(key, { x: c.x, y: c.y, z: c.z, visits: c.visits });
      }
    };
    add(this.own);
    for (const book of this.others.values()) add(book);
    return [...all.values()].sort((a, b) => b.visits - a.visits).slice(0, limit);
  }
}
