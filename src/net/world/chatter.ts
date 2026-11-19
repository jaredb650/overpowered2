/**
 * The soldiers' radio chatter (Endless Humans), the same on every screen: the host's rule table picks a line and sends ids only
 * (`chatter`); a guest rebuilds the words from the same table and emits `comms:line` as if its own men had spoken. A line cut
 * off mid-word is `chatcut`. Lines a caller wrote by hand (no row) stay the host's.
 */
import * as THREE from 'three';
import { soldierOf } from '../../enemies/outpost/soldier';
import { RULES } from '../../enemies/outpost/chatter/lines';
import { NAME_LIST, speakerTag } from '../../enemies/outpost/chatter/names';
import { lineText } from '../../enemies/outpost/chatter/rules';
import { VOICE_COUNT } from '../../enemies/outpost/chatter/voices';
import type { CommsLine } from '../../enemies/outpost/events';
import { RANKS, type Rank } from '../../enemies/outpost/rank';
import type { WorldContext } from './context';
import type { Replicas } from './replicas';

export type ChatterEvent =
  /** A line the host's rule table chose (src/enemies/outpost/chatter). Ids only: row, speaker, his name, rank and squad, and the dead man's name. */
  | { t: 'chatter'; uid: number; line: number; name: number; dead: number; rank: number; squad: string; slots?: Record<string, string>; voice?: number }
  /** The speaker `uid` was cut off `at` characters into his line. */
  | { t: 'chatcut'; uid: number; at: number; radio?: boolean };

const RANK_IDS = Object.keys(RANKS) as Rank[];
const nameId = (id: unknown): number => typeof id === 'number' && Number.isInteger(id) && NAME_LIST[id] !== undefined ? id : -1;

export class Chatter {
  private readonly heard: CommsLine = { kind: 'contact', text: '', squad: '', speaker: null, enemy: null, position: new THREE.Vector3(), row: -1, name: -1, dead: -1 };

  constructor(private readonly w: WorldContext, private readonly replicas: Replicas) {
    if (w.hosting) {
      // Every player hears the same man say the same words. Lines a caller wrote by hand stay the host's.
      w.listen('comms:line', line => {
        if (line.row === undefined || line.row < 0) return;
        const rank = line.enemy ? soldierOf(line.enemy)?.rank : undefined;
        w.send({ t: 'chatter', uid: line.enemy?.uid ?? 0, line: line.row, name: line.name ?? -1, dead: line.dead ?? -1,
          rank: rank ? RANK_IDS.indexOf(rank) : -1, squad: line.squad, voice: line.voice ?? -1, ...(line.slots ? { slots: line.slots } : {}) });
      });
      w.listen('comms:cut', cut => w.send({ t: 'chatcut', uid: cut.enemy.uid, at: cut.at, radio: cut.radio }));
    }
    w.router.guest('chatter', value => this.hear(value));
    w.router.guest('chatcut', value => {
      const enemy = replicas.enemy(value.uid);
      if (enemy && Number.isInteger(value.at) && value.at >= 0) w.ctx.events.emit('comms:cut', { enemy, at: value.at, radio: value.radio === true });
    });
  }

  private hear(value: Extract<ChatterEvent, { t: 'chatter' }>): void {
    const { ctx } = this.w;
    const row = Number.isInteger(value.line) ? RULES[value.line] : undefined;
    if (!row || typeof value.squad !== 'string' || value.squad.length > 16) return;
    const line = this.heard;
    const enemy = value.uid ? this.replicas.enemy(value.uid) ?? null : null;
    const rank = RANK_IDS[value.rank];
    line.kind = row.concept;
    line.row = value.line;
    line.name = nameId(value.name);
    line.dead = nameId(value.dead);
    const slots: Record<string, string> = {};
    // Only short words for known blanks: the host's slots fill a row, they never carry text of their own.
    for (const [k, v] of Object.entries(value.slots ?? {})) if (/^[a-z]{1,12}$/.test(k) && typeof v === 'string' && v.length <= 32) slots[k] = v;
    if (line.dead >= 0) slots.dead = NAME_LIST[line.dead]!;
    line.slots = value.slots ?? null;
    line.why = '';
    // The same man in the same voice on every machine.
    line.voice = Number.isInteger(value.voice) && value.voice! >= 0 && value.voice! < VOICE_COUNT ? value.voice! : -1;
    line.text = lineText(value.line, slots);
    line.squad = value.uid ? value.squad : 'Command';
    line.speaker = value.uid ? speakerTag(line.name, rank ? RANKS[rank].label : '', value.squad) : null;
    line.enemy = enemy;
    line.position.copy(enemy?.center ?? ctx.player.position);
    ctx.events.emit('comms:line', line);
  }
}

/** For a peer that is behind: which of this module's events may be left out (net/pressure.ts). A fact never is. */
export const CHATTER_WIRE: import('../pressure').WireClasses<ChatterEvent> = { chatter: 'cosmetic', chatcut: 'cosmetic' };
