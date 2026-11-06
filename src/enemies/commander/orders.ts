/**
 * The Commander on the radio, in the middle of the fight. Section 22: he is always there in endless, directing the soldiers, the player
 * hears him and they obey. So an order here is not a line of colour: it prices a drill at nothing in that squad's planner, and the squad
 * goes and does it. A player who listens gets a few seconds' notice of where the next move is coming from, and that is the deal.
 *
 * A mission writes his words itself, so none of this runs there.
 */
import { MISSION_ID } from '../../campaign/select';
import { rand } from '../../core/math';
import type { OutpostSquad } from '../outpost/squad';
import type { Commander } from './index';
import { orderLine, type OrderDrill } from './lines';

/** Seconds between orders. He has men to think about, and a box on screen every few seconds is noise. */
const EVERY: readonly [number, number] = [12, 18];
const FIRST_AFTER = 8;
/** Seconds a squad is held to it, and seconds it has to start before it counts as disobedience. */
const STANDS_FOR = 12;
const START_WITHIN = 10;
const RUN_SPEED = 7.5;
const CAMP_SECONDS = 4;

export class RadioOrders {
  /** For anyone measuring whether the men do as they are told. */
  issued = 0;
  obeyed = 0;
  private nextAt = 0;
  private squad: OutpostSquad | null = null;
  private drill: OrderDrill = 'flank';
  private givenAt = 0;

  constructor(private readonly c: Commander) {}

  reset(): void {
    this.issued = this.obeyed = 0;
    this.nextAt = FIRST_AFTER;
    this.squad = null;
  }

  update(now: number): void {
    const { o } = this.c;
    if (MISSION_ID || o.doctrine.radioSilence) return;
    this.watch(now);
    if (now < this.nextAt) return;
    const q = this.pickSquad();
    if (!q) {
      this.nextAt = now + 2;
      return;
    }
    this.nextAt = now + rand(EVERY[0], EVERY[1]);
    this.give(q, this.decide(q), now);
  }

  /** Whether the squad he spoke to has started. It answers when it does, so that the words and the move land together. */
  private watch(now: number): void {
    const q = this.squad;
    if (!q) return;
    if (q.drill === this.drill) {
      this.obeyed++;
      this.squad = null;
      if (q.leader) this.c.o.comms.say('obey', q.leader);
      this.c.w.ctx.events.emit('commander:obeyed', { squad: q.name, drill: this.drill, seconds: now - this.givenAt });
    } else if (now - this.givenAt > START_WITHIN) this.squad = null;
  }

  /** The squad doing the least, because the Commander can see that too. */
  private pickSquad(): OutpostSquad | null {
    let best: OutpostSquad | null = null;
    let bestScore = -Infinity;
    for (const q of this.c.o.squads) {
      if (q.directed || q.goal !== 'destroy' || q.fighters() < 2) continue;
      const score = q.fighters() + (q.inContact ? 0 : 3) + rand(0, 2);
      if (score > bestScore) {
        bestScore = score;
        best = q;
      }
    }
    return best;
  }

  /** What he would do with them, from what the player is doing. */
  private decide(q: OutpostSquad): OrderDrill {
    const { o } = this.c;
    if (o.captives.held) return 'flank';
    if (o.stillFor >= CAMP_SECONDS) return q.leader && q.leader.flashes > 0 ? 'flash' : 'frag';
    if (o.track.speed >= RUN_SPEED) return 'cutOff';
    if (o.hostile <= 4 && q.inContact) return 'rush';
    return q.inContact && !q.flanking ? 'baseOfFire' : 'flank';
  }

  private give(q: OutpostSquad, drill: OrderDrill, now: number): void {
    const { w } = this.c;
    this.issued++;
    this.squad = q;
    this.drill = drill;
    this.givenAt = now;
    q.obey(drill, STANDS_FOR);
    w.ctx.events.emit('commander:bark', { id: orderLine(drill).id, vars: { squad: q.name } });
    w.ctx.events.emit('commander:order', { squad: q.name, drill });
  }
}
