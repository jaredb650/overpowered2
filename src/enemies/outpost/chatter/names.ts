/**
 * Every man's names (docs/design/squad-comms.md, "Soldier identity"). The garrison is a space-age army: each man has a designation
 * (K-17, Seven), a short hard surname (Voss, Kade) and sometimes a nickname (Brick, Patch, Spark, Kid). Two registers: the radio
 * says his designation, his buddy his nickname, everyone else his surname. Holdfast's militia are dockside locals with plain names.
 *
 * Only some men are "known" to the others by name: the leader, anyone with a nickname, and about half the rest. A man nobody knows
 * dies as "man down", unless his buddy or the leader is the one who says it.
 *
 * Names are drawn at random when a man enlists, never two alike alive, and a dead man's name rests, so a new Voss never walks in after
 * the old one died. A long run spends a pool: then the name that has rested longest comes back first.
 */
import { ACTIVE } from '../../../contracts/select';
import type { Role } from '../doctrine';
import type { Rank } from '../rank';
import type { Faction } from './rules';

export type NamePool = 'surname' | 'designation' | 'nickname' | 'holdfast' | 'bureau';

export const NAME_POOLS: Record<NamePool, readonly string[]> = {
  surname: ['Voss', 'Kade', 'Rook', 'Tash', 'Orin', 'Hale', 'Dace', 'Sable', 'Vance', 'Juno', 'Brandt', 'Kell', 'Marr', 'Pike', 'Quill', 'Varga', 'Holt', 'Fenn', 'Corr', 'Strand'],
  designation: ['K-17', 'Dex-4', 'Seven', 'Nine', 'KR-7', 'Vex-2', 'Tal-6', 'Rho-5', 'Ten', 'J-3', 'Mox-8', 'Sig-1', 'Ash-9', 'Four', 'Ix-12', 'Vo-11', 'Kay-3', 'Six', 'Zed-5', 'Lin-2'],
  nickname: ['Brick', 'Patch', 'Spark', 'Kid', 'Ghost', 'Wall', 'Buck', 'Moth', 'Tick', 'Lucky', 'Gravel', 'Ace'],
  holdfast: ['Big Teo', 'Little Teo', 'Ma Corran', 'Wick', 'Anya', 'Fitch', 'Old Baz', 'Juno', 'Mags', 'Dray', 'Ossie', 'Pell', 'Rook', 'Sabine', 'Hatch', 'Coll'],
  // The allies' pool, for when the Bailiffs get their lines.
  bureau: ['Grell 4471', 'Ambry 0912', 'Voss 3306', 'Teague 1180', 'Mott 5521', 'Penner 2049', 'Lusk 6614', 'Dorne 8802', 'Fenwick 0337', 'Haber 4190', 'Stile 9055', 'Ibsen 7730'],
};

const POOLS = Object.keys(NAME_POOLS) as NamePool[];
/** Every name in one list. A name id is an index into it, which is what goes over the wire in co-op. */
export const NAME_LIST: readonly string[] = POOLS.flatMap(p => NAME_POOLS[p]);
const FIRST = {} as Record<NamePool, number>;
POOLS.reduce((at, p) => (FIRST[p] = at) + NAME_POOLS[p].length, 0);
const nick = (n: string): number => FIRST.nickname + NAME_POOLS.nickname.indexOf(n);

export const poolOf = (id: number): NamePool => {
  for (let i = POOLS.length - 1; i >= 0; i--) if (id >= FIRST[POOLS[i]!]) return POOLS[i]!;
  return 'surname';
};

/** Who the Outpost's brain is fielding on this page. Foreclosure's men are Holdfast's militia. */
export const FACTION: Faction = ACTIVE.def.id === 'foreclosure' ? 'holdfast' : 'garrison';

/** The nickname a role brings with it, and the rookie's. Anyone else has a fair chance of one of the rest. */
const ROLE_NICK: Partial<Record<Role, string>> = { machinegun: 'Brick', medic: 'Patch', rocket: 'Spark', marksman: 'Ghost', shield: 'Wall', shotgun: 'Buck' };
const SPARE_NICKS = ['Moth', 'Tick', 'Lucky', 'Gravel', 'Ace'];

/** How a man comes up on the feed: `Cpl Voss · Alpha`, his designation alone on the radio, or `Wick · Holdfast` for the militia. */
export function speakerTag(name: number, rank: string, squad: string): string {
  const who = NAME_LIST[name];
  if (who === undefined) return `${rank} ${squad}`;
  const pool = poolOf(name);
  if (pool === 'holdfast') return `${who} · Holdfast`;
  if (pool === 'designation') return `${who} · ${squad}`;
  return `${rank} ${who} · ${squad}`;
}

/** The names one man carries. */
export interface Named {
  name: number;
  desig: number;
  nick: number;
  known: boolean;
}

/** The name `who` goes by in a line said by `by`: designation on the radio, nickname between buddies, surname otherwise. */
export function callName(who: Named, radio: boolean, buddies: boolean): number {
  if (radio && who.desig >= 0) return who.desig;
  if (buddies && who.nick >= 0) return who.nick;
  return who.name;
}

export class NameRoll {
  private readonly alive = new Set<number>();
  /** Dead men's names, oldest first. */
  private readonly rested: number[] = [];

  reset(): void {
    this.alive.clear();
    this.rested.length = 0;
  }

  /** Names for a new man. `squadNicks` are the nicknames his squad already has, which he will not share. */
  enlist(s: Named, faction: Faction, role: Role, rank: Rank, leads: boolean, squadNicks: readonly number[], random: () => number = Math.random): void {
    if (faction !== 'garrison') {
      s.name = this.draw(faction === 'holdfast' ? 'holdfast' : 'bureau', random);
      s.desig = s.nick = -1;
      s.known = leads || random() < 0.5;
      return;
    }
    s.name = this.draw('surname', random);
    s.desig = this.draw('designation', random);
    const want = ROLE_NICK[role] ?? (rank === 'conscript' && random() < 0.5 ? 'Kid' : random() < 0.25 ? SPARE_NICKS[Math.floor(random() * SPARE_NICKS.length)]! : null);
    s.nick = want && !squadNicks.includes(nick(want)) ? nick(want) : -1;
    s.known = leads || s.nick >= 0 || random() < 0.5;
  }

  draw(pool: NamePool, random: () => number = Math.random): number {
    const first = FIRST[pool];
    const n = NAME_POOLS[pool].length;
    let free = 0;
    for (let i = first; i < first + n; i++) if (!this.alive.has(i) && !this.rested.includes(i)) free++;
    if (free === 0) {
      // Spent: wake the longest-rested name nobody alive is carrying.
      const back = this.rested.findIndex(i => i >= first && i < first + n && !this.alive.has(i));
      if (back < 0) return this.take(first + Math.floor(random() * n));
      this.rested.splice(back, 1);
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

  /** He died: his names rest. */
  died(s: Named): void {
    for (const id of [s.name, s.desig]) if (id >= 0 && !this.rested.includes(id)) this.rested.push(id);
  }

  /** He left the roster, dead or not. */
  free(s: Named): void {
    this.alive.delete(s.name);
    this.alive.delete(s.desig);
  }
}
