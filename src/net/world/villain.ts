/**
 * The Commander talks to everyone. The villain runs on the host (enemies/commander); what he says there goes to every guest as
 * `cmd` and is raised on the guest as the same game event, so the guest's own dialogue box and warning chips (ui/commander)
 * show it exactly as the host's do: the briefing between rounds, a bark mid-wave, a chip going up or down, his arrival in
 * person, his last words. A guest who arrives late is told which chips are up and whether he is on the field.
 *
 * His physical props (shutters, mines, wires, smoke) are another module's (lane "world-b").
 */
import type { Briefing, StatusFlag } from '../../enemies/commander/events';
import type { WorldContext } from './context';

export type VillainEvent =
  | { t: 'cmd'; k: 'briefing'; b: Briefing }
  | { t: 'cmd'; k: 'bark'; id: string; vars?: Record<string, string>; hold?: number }
  | { t: 'cmd'; k: 'status'; flag: string; on: boolean }
  | { t: 'cmd'; k: 'person'; on: boolean }
  | { t: 'cmd'; k: 'fulfilled' }
  | { t: 'cmd'; k: 'quiet' };

const FLAGS: readonly StatusFlag[] = ['painted', 'jammed', 'uplink', 'aaLock'];
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max;
const count = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) < 1e7;
const texts = (value: unknown, most: number): value is string[] => Array.isArray(value) && value.length <= most && value.every(item => text(item, 48));

/** A briefing as it came from the host: the right shape and nothing oversized, or null. The box only reads numbers and names from it. */
export function cleanBriefing(value: unknown): Briefing | null {
  const b = value as Briefing | null;
  if (!b || typeof b !== 'object' || !count(b.wave) || !count(b.next) || !count(b.seconds) || !text(b.phase, 16)) return null;
  if (!(b.adaptation === null || text(b.adaptation, 24)) || !texts(b.tricks, 16) || !texts(b.fielded, 32)) return null;
  const r = b.report as unknown as Record<string, unknown> | null;
  if (!r || typeof r !== 'object' || !text(r.favouriteWeapon, 32) || !text(r.room, 48) || !texts(r.fallen, 48)) return null;
  if (!Array.isArray(r.trapHits) || r.trapHits.length > 32
    || !r.trapHits.every((hit: unknown) => !!hit && typeof hit === 'object' && text((hit as { cause: unknown }).cause, 32)
      && count((hit as { hits: unknown }).hits) && count((hit as { damage: unknown }).damage))) return null;
  for (const key in r) {
    const field = r[key];
    if (typeof field === 'number' && !count(field)) return null;
  }
  return b;
}

export class Villain {
  /** Guest: how many of each were shown, for the browser proofs. */
  readonly seen = { briefings: 0, barks: 0, statuses: 0 };
  /** Host: the chips that are up and whether he has come down himself, for a guest who arrives late. */
  private readonly flags = new Map<string, boolean>();
  private person = false;
  /** Guest: true while an event from the host is being raised here, so it is not taken for the local game's own. */
  private relaying = false;

  constructor(private readonly w: WorldContext) {
    if (w.hosting) {
      w.listen('commander:briefing', b => w.send({ t: 'cmd', k: 'briefing', b }));
      w.listen('commander:bark', e => w.send({ t: 'cmd', k: 'bark', id: e.id, ...(e.vars ? { vars: { ...e.vars } } : {}), ...(e.hold !== undefined ? { hold: e.hold } : {}) }));
      w.listen('commander:status', e => { this.flags.set(e.flag, e.on); w.send({ t: 'cmd', k: 'status', flag: e.flag, on: e.on }); });
      w.listen('commander:person', e => { this.person = e.arrived; w.send({ t: 'cmd', k: 'person', on: e.arrived }); });
      w.listen('commander:fulfilled', () => w.send({ t: 'cmd', k: 'fulfilled' }));
      w.listen('commander:quiet', () => w.send({ t: 'cmd', k: 'quiet' }));
      w.listen('run:start', () => { this.flags.clear(); this.person = false; });
    }
    w.router.guest('cmd', value => this.hear(value));
  }

  /** Host: a guest has arrived in the match (their first card): what is up right now. */
  catchUp(id: string): void {
    if (!this.w.hosting) return;
    for (const [flag, on] of this.flags) if (on) this.w.send({ t: 'cmd', k: 'status', flag, on }, id);
    if (this.person) this.w.send({ t: 'cmd', k: 'person', on: true }, id);
  }

  private hear(value: VillainEvent): void {
    const { events } = this.w.ctx;
    if (this.relaying) return;
    this.relaying = true;
    try {
      switch (value.k) {
        case 'briefing': {
          const briefing = cleanBriefing(value.b);
          if (!briefing) return;
          this.seen.briefings++;
          events.emit('commander:briefing', briefing);
          return;
        }
        case 'bark': {
          if (!text(value.id, 64)) return;
          const vars: Record<string, string> = {};
          for (const [key, word] of Object.entries(value.vars ?? {})) if (/^[a-zA-Z]{1,16}$/.test(key) && text(word, 48)) vars[key] = word;
          this.seen.barks++;
          events.emit('commander:bark', { id: value.id, vars, ...(typeof value.hold === 'number' && value.hold >= 0 && value.hold < 60 ? { hold: value.hold } : {}) });
          return;
        }
        case 'status':
          if (!FLAGS.includes(value.flag as StatusFlag)) return;
          this.seen.statuses++;
          events.emit('commander:status', { flag: value.flag as StatusFlag, on: value.on === true });
          return;
        case 'person': events.emit('commander:person', { arrived: value.on === true }); return;
        case 'fulfilled': events.emit('commander:fulfilled', {}); return;
        case 'quiet': events.emit('commander:quiet', {}); return;
      }
    } finally { this.relaying = false; }
  }
}

/** For a peer that is behind: which of this module's events may be left out (net/pressure.ts). A fact never is. */
export const VILLAIN_WIRE: import('../pressure').WireClasses<VillainEvent> = { cmd: 'fact' };
