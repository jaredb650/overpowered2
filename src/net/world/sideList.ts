/**
 * Latest-wins lists that are not the enemies': the host's vehicles and its garrison, five times a second. They ride the
 * unreliable `world` lane as side packets (context.ts `sendSide`): a lost one is simply replaced by the next, where on the
 * reliable lane a lost one held every real event behind it and then arrived in a burst. A list is cut into parts that each
 * fit one packet; a guest draws a list once it has every part of one stamp, and drops a part older than the stamp it is on.
 */
import type { WorldContext } from './context';

/** The side packet kinds. Add at the end only. */
export const SIDE = { vehicles: 1, allies: 2, jets: 3 } as const;
/** Bytes of rows in one part: with the frame's head and the part's own fields it stays under the safe unreliable size (room.ts). */
export const PART_BYTES = 900;
const MOST_PARTS = 16;

interface Part { at: number; i: number; n: number; list: unknown[] }

/** Host: `rows`, stamped `at` (the host's clock, ms), to every guest. An empty list is one empty part: nothing is out now. */
export function sendList(w: WorldContext, kind: number, at: number, rows: readonly unknown[]): number {
  const groups: unknown[][] = [];
  let group: unknown[] = [], size = 0;
  for (const row of rows) {
    const bytes = JSON.stringify(row).length + 1;
    if (group.length && size + bytes > PART_BYTES) { groups.push(group); group = []; size = 0; }
    group.push(row);
    size += bytes;
  }
  groups.push(group);
  const n = Math.min(MOST_PARTS, groups.length);
  for (let i = 0; i < n; i++) w.sendSide(kind, { at, i, n, list: groups[i]! } satisfies Part);
  return n;
}

/** Guest: gathers the parts of one stamp. */
export class ListParts {
  private at = -1;
  private got = 0;
  private rows: unknown[] = [];
  /** The whole list once its last part is in, else null. `value` came from another browser. */
  take(value: unknown): { at: number; list: unknown[] } | null {
    const part = value as Partial<Part> | null;
    if (!part || typeof part.at !== 'number' || !Number.isFinite(part.at) || !Number.isInteger(part.i) || !Number.isInteger(part.n) || !Array.isArray(part.list)) return null;
    const { at, i, n, list } = part as Part;
    if (n < 1 || n > MOST_PARTS || i < 0 || i >= n) return null;
    if (at < this.at) {
      if (this.at - at <= 30_000) return null;
      this.at = at; this.got = 0; this.rows = [];
    } else if (at > this.at) {
      this.at = at; this.got = 0; this.rows = [];
    }
    const bit = 1 << i;
    if (this.got & bit) return null;
    this.got |= bit;
    for (const row of list) this.rows.push(row);
    return this.got === (1 << n) - 1 ? { at, list: this.rows } : null;
  }
}
