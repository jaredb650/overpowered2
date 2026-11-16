/**
 * Every man's name (docs/proposals/squad-chatter.md, 4.7). Random from his faction's pool when he enlists, never two alike alive,
 * and a dead man's name rests, so a new Marsh never walks in after the old one died. A long run spends the pool: then the name
 * that has rested longest comes back first.
 */
import { ACTIVE } from '../../../contracts/select';
import type { Faction } from './rules';

export const NAME_POOLS: Record<Faction, readonly string[]> = {
  garrison: ['Marsh', 'Novak', 'Okafor', 'Pike', 'Brandt', 'Sully', 'Hale', 'Reyes', 'Dennis', 'Kowal', 'Achebe', 'Lund', 'Ferro', 'Tash', 'Varga', 'Quill'],
  holdfast: ['Big Teo', 'Little Teo', 'Ma Corran', 'Wick', 'Anya', 'Fitch', 'Old Baz', 'Juno', 'Mags', 'Dray', 'Ossie', 'Pell', 'Rook', 'Sabine', 'Hatch', 'Coll'],
  // The allies' pool, for stage 7, when the Bailiffs get their lines.
  bureau: ['Grell 4471', 'Ambry 0912', 'Voss 3306', 'Teague 1180', 'Mott 5521', 'Penner 2049', 'Lusk 6614', 'Dorne 8802', 'Fenwick 0337', 'Haber 4190', 'Stile 9055', 'Ibsen 7730'],
};

const FACTIONS = Object.keys(NAME_POOLS) as Faction[];
/** Every name in one list. A name id is an index into it, which is what goes over the wire in co-op. */
export const NAME_LIST: readonly string[] = FACTIONS.flatMap(f => NAME_POOLS[f]);
const FIRST: Record<Faction, number> = { garrison: 0, holdfast: NAME_POOLS.garrison.length, bureau: NAME_POOLS.garrison.length + NAME_POOLS.holdfast.length };

export const factionOfName = (id: number): Faction => id >= FIRST.bureau ? 'bureau' : id >= FIRST.holdfast ? 'holdfast' : 'garrison';

/** Who the Outpost's brain is fielding on this page. Foreclosure's men are Holdfast's militia. */
export const FACTION: Faction = ACTIVE.def.id === 'foreclosure' ? 'holdfast' : 'garrison';

/** How a man comes up on the feed: `Cpl Marsh · Alpha`, or `Wick · Holdfast` for the militia, who hold no rank. */
export function speakerTag(name: number, rank: string, squad: string): string {
  const who = NAME_LIST[name];
  if (who === undefined) return `${rank} ${squad}`;
  return factionOfName(name) === 'holdfast' ? `${who} · Holdfast` : `${rank} ${who} · ${squad}`;
}

export class NameRoll {
  private readonly alive = new Set<number>();
  /** Dead men's names, oldest first. */
  private readonly rested: number[] = [];

  reset(): void {
    this.alive.clear();
    this.rested.length = 0;
  }

  draw(faction: Faction, random: () => number = Math.random): number {
    const first = FIRST[faction];
    const n = NAME_POOLS[faction].length;
    let free = 0;
    for (let i = first; i < first + n; i++) if (!this.alive.has(i) && !this.rested.includes(i)) free++;
    if (free === 0) {
      // Spent: wake the longest-rested name nobody alive is carrying.
      const back = this.rested.findIndex(i => i >= first && i < first + n && !this.alive.has(i));
      if (back >= 0) this.rested.splice(back, 1);
      else return this.take(first + Math.floor(random() * n));
      free = 1;
    }
    let k = Math.floor(random() * free);
    for (let i = first; i < first + n; i++) {
      if (this.alive.has(i) || this.rested.includes(i)) continue;
      if (k-- === 0) return this.take(i);
    }
    return this.take(first);
  }

  private take(id: number): number {
    this.alive.add(id);
    return id;
  }

  /** He died: his name rests. */
  died(id: number): void {
    if (id >= 0 && !this.rested.includes(id)) this.rested.push(id);
  }

  /** He left the roster, dead or not. */
  free(id: number): void {
    this.alive.delete(id);
  }
}
