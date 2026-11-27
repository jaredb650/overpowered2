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
import { ALL_VOICE_COUNT } from '../../enemies/outpost/chatter/voices';
import type { CommsLine } from '../../enemies/outpost/events';
import { RANKS, type Rank } from '../../enemies/outpost/rank';
import type { WorldContext } from './context';
import type { Replicas } from './replicas';

export type ChatterEvent =
  /** A line the host's rule table chose (src/enemies/outpost/chatter) or a voiced relay (`line: -1` with `clip` and `text`). */
  | { t: 'chatter'; uid: number; line: number; name: number; dead: number; rank: number; squad: string; slots?: Record<string, string>; voice?: number; speaker?: string; radio?: boolean; ally?: boolean; clip?: string; text?: string }
  /** The speaker `uid` (or bodiless callsign `speaker`) was cut off `at` characters into the line. */
  | { t: 'chatcut'; uid: number; at: number; radio?: boolean; speaker?: string };

const RANK_IDS = Object.keys(RANKS) as Rank[];
const nameId = (id: unknown): number => typeof id === 'number' && Number.isInteger(id) && NAME_LIST[id] !== undefined ? id : -1;
const SAFE_CLIP = /^[\w.~-]+$/;

export class Chatter {
  constructor(private readonly w: WorldContext, private readonly replicas: Replicas) {
    if (w.hosting) {
      // Every player hears the same man say the same words. Hand-written lines without a clip stay the host's.
      w.listen('comms:line', line => {
        const isRow = line.row !== undefined && line.row >= 0;
        const isRelay = !isRow && typeof line.clip === 'string' && line.clip.length > 0;
        if (!isRow && !isRelay) return;
        const soldier = line.enemy ? soldierOf(line.enemy) : undefined;
        const rank = soldier?.rank;
        const radio = (isRow && RULES[line.row!]?.radio === true) || line.radio === true;
        const sentName = radio && soldier && soldier.desig >= 0 ? soldier.desig : (line.name ?? -1);
        w.send({
          t: 'chatter',
          uid: line.enemy?.uid ?? 0,
          line: isRow ? line.row! : -1,
          name: sentName,
          dead: line.dead ?? -1,
          rank: rank ? RANK_IDS.indexOf(rank) : -1,
          squad: line.squad,
          voice: line.voice ?? -1,
          ...(isRow && line.slots ? { slots: line.slots } : {}),
          ...(isRelay ? { clip: line.clip!.slice(0, 64), text: line.text.slice(0, 160) } : {}),
          ...(!line.enemy && line.speaker ? { speaker: line.speaker } : {}),
          ...(line.radio ? { radio: true } : {}),
          ...(line.ally ? { ally: true } : {}),
        });
      });
      w.listen('comms:cut', cut => {
        w.send({
          t: 'chatcut',
          uid: cut.enemy?.uid ?? 0,
          at: cut.at,
          radio: cut.radio,
          ...(!cut.enemy && cut.speaker ? { speaker: cut.speaker } : {}),
        });
      });
    }
    w.router.guest('chatter', value => this.hear(value));
    w.router.guest('chatcut', value => {
      if (!Number.isInteger(value.at) || value.at < 0) return;
      const enemy = value.uid ? replicas.enemy(value.uid) ?? null : null;
      const speaker = !value.uid && typeof value.speaker === 'string' && value.speaker.length <= 40 ? value.speaker : null;
      if (enemy || speaker) w.ctx.events.emit('comms:cut', { enemy, ...(speaker ? { speaker } : {}), at: value.at, radio: value.radio === true });
    });
  }

  private hear(value: Extract<ChatterEvent, { t: 'chatter' }>): void {
    const { ctx } = this.w;
    const isRelay = value.line === -1
      && typeof value.clip === 'string'
      && value.clip.length > 0
      && value.clip.length <= 64
      && SAFE_CLIP.test(value.clip);
    const row = !isRelay && Number.isInteger(value.line) ? RULES[value.line] : undefined;
    if ((!row && !isRelay) || typeof value.squad !== 'string' || value.squad.length > 24) return;
    if (isRelay && (typeof value.text !== 'string' || value.text.length > 160)) return;
    const enemy = value.uid ? this.replicas.enemy(value.uid) ?? null : null;
    const radio = (row?.radio === true) || value.radio === true;
    // Drop non-radio local shouts when the speaker replica is missing on the guest instead of playing them at the guest's ear.
    if (value.uid && !enemy && !radio) return;
    const rank = RANK_IDS[value.rank];
    const name = nameId(value.name);
    const dead = nameId(value.dead);
    const slots: Record<string, string> = {};
    // Only short words for known blanks: the host's slots fill a row, they never carry text of their own.
    if (!isRelay) {
      for (const [k, v] of Object.entries(value.slots ?? {})) if (/^[a-z]{1,12}$/.test(k) && typeof v === 'string' && v.length <= 32) slots[k] = v;
      if (dead >= 0) slots.dead = NAME_LIST[dead]!;
    }
    const cleanSlots = Object.keys(slots).length ? slots : null;
    const airSpeaker = !value.uid && typeof value.speaker === 'string' && value.speaker.length <= 40 ? value.speaker : null;
    const line: CommsLine = {
      kind: row ? row.concept : 'order',
      row: isRelay ? -1 : value.line,
      name,
      dead,
      slots: cleanSlots,
      why: '',
      // The same man in the same voice on every machine.
      voice: Number.isInteger(value.voice) && value.voice! >= 0 && value.voice! < ALL_VOICE_COUNT ? value.voice! : -1,
      clip: isRelay ? value.clip! : null,
      text: isRelay ? value.text! : lineText(value.line, slots),
      squad: value.uid || airSpeaker ? value.squad : 'Command',
      speaker: value.uid ? speakerTag(name, rank ? RANKS[rank].label : '', value.squad) : airSpeaker,
      enemy,
      position: (enemy?.center ?? ctx.player.position).clone(),
      radio: value.radio === true,
      ally: value.ally === true,
    };
    ctx.events.emit('comms:line', line);
  }
}

/** For a peer that is behind: which of this module's events may be left out (net/pressure.ts). A fact never is. */
export const CHATTER_WIRE: import('../pressure').WireClasses<ChatterEvent> = { chatter: 'cosmetic', chatcut: 'cosmetic' };
