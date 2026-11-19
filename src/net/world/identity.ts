/**
 * Who each of the host's soldiers is (Endless Humans, the missions): his names, rank, seat, voice and squad. A guest's copy is
 * made by the same code as the host's man, which deals names and ranks at random, so without this every screen would know
 * him by a different name. The host says it once per man per guest, on the reliable lane, in small batches: a guest who joins
 * late is told about everyone alive.
 */
import type { Enemy } from '../../enemies/Enemy';
import { NAME_LIST } from '../../enemies/outpost/chatter/names';
import { RANKS, RANK_ORDER } from '../../enemies/outpost/rank';
import { soldierOf } from '../../enemies/outpost/soldier';
import type { WorldContext, WorldModule } from './context';
import type { Replicas } from './replicas';

/** Host: who these men are. Each row: uid, surname, designation, nickname (ids into `NAME_LIST`, -1 none), rank, seat, voice, bits (1 known by name, 2 leads his squad, 4 talks big), squad. */
export type WhoEvent = { t: 'who'; list: [number, number, number, number, number, number, number, number, string][] };

/** Ms between batches, and men in one. */
const EVERY_MS = 200;
const BATCH = 16;

export class Identity implements WorldModule {
  /** Host: the uids each guest has been told about. */
  private readonly told = new Map<string, Set<number>>();
  private next = 0;
  /** Guest: men whose identity has been applied. */
  applied = 0;

  constructor(private readonly w: WorldContext, private readonly replicas: Replicas) {
    w.router.guest('who', value => this.whoIn(value));
    w.snapshotSent.push(alive => {
      for (const set of this.told.values()) for (const uid of set) if (!alive.has(uid)) set.delete(uid);
    });
  }

  update(now: number): void {
    if (!this.w.hosting || now < this.next) return;
    this.next = now + EVERY_MS;
    const { manager, session } = this.w;
    for (const player of session.lobby.players) {
      if (player.host || player.away) continue;
      let told = this.told.get(player.id);
      if (!told) this.told.set(player.id, told = new Set());
      let list: WhoEvent['list'] | null = null;
      for (const enemy of manager.alive) {
        if (told.has(enemy.uid)) continue;
        const row = this.rowOf(enemy);
        told.add(enemy.uid);
        if (!row) continue;
        (list ??= []).push(row);
        if (list.length >= BATCH) break;
      }
      if (list) this.w.send({ t: 'who', list }, player.id);
    }
    for (const id of this.told.keys()) if (!session.lobby.players.some(player => player.id === id && !player.away)) this.told.delete(id);
  }

  private rowOf(enemy: Enemy): WhoEvent['list'][number] | null {
    const s = soldierOf(enemy);
    if (!s?.squad) return null;
    return [enemy.uid, s.name, s.desig, s.nick, RANK_ORDER.indexOf(s.rank), s.seat, s.voice, (s.known ? 1 : 0) | (s.isLeader ? 2 : 0) | (s.bravado ? 4 : 0), s.squad.name];
  }

  private whoIn(value: WhoEvent): void {
    if (!Array.isArray(value.list)) return;
    for (const row of value.list.slice(0, 64)) {
      if (!Array.isArray(row) || row.length !== 9 || !row.slice(0, 8).every(n => Number.isInteger(n)) || typeof row[8] !== 'string') continue;
      const [uid, name, desig, nick, rank, seat, voice, bits, squad] = row;
      if (uid <= 0 || [name, desig, nick].some(id => id < -1 || id >= NAME_LIST.length) || !RANK_ORDER[rank] || seat < 0 || seat > 99 || voice < -1 || voice > 255) continue;
      const squadName = squad.replace(/[^\w .'-]/g, '').slice(0, 24);
      // He may not be drawn here yet: his first state is on the unreliable lane, this is not.
      this.replicas.whenSeen(uid, enemy => {
        const s = soldierOf(enemy);
        if (!s) return;
        s.name = name; s.desig = desig; s.nick = nick;
        s.known = (bits & 1) !== 0;
        s.bravado = (bits & 4) !== 0;
        s.rank = RANK_ORDER[rank]!;
        s.rankDef = RANKS[s.rank];
        s.seat = seat;
        s.voice = voice;
        // A copy stands in a squad of its own, made when it was: that squad takes the host's name, and he leads it or not.
        if (s.squad) {
          (s.squad as { name: string }).name = squadName || s.squad.name;
          if (bits & 2) s.squad.leader = s;
          else if (s.squad.leader === s) s.squad.leader = null;
        }
        this.applied++;
      });
    }
  }

  dispose(): void {
    this.told.clear();
  }
}

/** For a peer that is behind: which of this module's events may be left out (net/pressure.ts). A fact never is. */
export const IDENTITY_WIRE: import('../pressure').WireClasses<WhoEvent> = { who: 'fact' };
