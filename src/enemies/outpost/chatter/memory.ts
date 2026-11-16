/**
 * What the side remembers about the player this match (docs/design/squad-comms.md, "Memory and revenge"). Per match and side-wide
 * only, and cleared with the run: no man is promoted, no named enemy carries a grudge into the next run. The Nemesis patent's pattern
 * (a persistent hierarchy of procedurally made enemies who remember past encounters) is exactly what this is not.
 *
 *   habits   headshots, kills from above, explosives, the blade, shots in the back. Past a count, one leader says it, once a match:
 *            "He's going for heads, keep your visors down!". Two of them also change what the men do, and the line says that
 *            change: explosives spread the men out and stop them stacking, the blade has riflemen keep their distance
 *   squads   the callsigns of squads wiped this match, for revenge ("This is for Delta!")
 *   contact  a squad that loses him for a while and finds him again says so ("You again."); a man who has watched friends die
 *            to him warns the others
 */
import type { Outpost } from '../index';
import { ROLE_OF } from '../doctrine';
import { soldierOf, type Soldier } from '../soldier';
import { isMelee } from '../../../weapons/melee/data';

export type Habit = 'heads' | 'high' | 'blasts' | 'blade' | 'flanks';
/** Kills (or back shots) of one kind before it is noticed. */
export const HABIT_AT = 4;
/** Metres of height that make a kill "from above". */
const ABOVE = 2.5;
/** What the blade habit makes riflemen keep, and how far the men spread against explosives: the Commander's own answers. */
const KEEP_OUT = 7;
const SPREAD = 5.5;
/** Seconds without sight of him that make the next sighting "again". */
export const AGAIN_AFTER = 12;

export class PlayerMemory {
  readonly counts: Record<Habit, number> = { heads: 0, high: 0, blasts: 0, blade: 0, flanks: 0 };
  readonly noticed = new Set<Habit>();
  /** Callsigns of squads wiped this match, newest last. */
  readonly wiped: string[] = [];

  reset(): void {
    for (const h in this.counts) this.counts[h as Habit] = 0;
    this.noticed.clear();
    this.wiped.length = 0;
  }
}

/** The player's own kills, not the men's own grenades, bleeding or the floor. */
const byPlayer = (source: string): boolean => !(source in ROLE_OF) && source !== 'frag' && source !== 'bleed' && source !== 'hazard';

export function rememberPlayer(o: Outpost): void {
  const { w } = o;
  const events = w.ctx.events;
  events.on('enemy:killed', k => {
    if (!soldierOf(k.enemy) || !byPlayer(k.damage.source)) return;
    if (k.headshot) note(o, 'heads');
    if (w.player.position.y - k.enemy.position.y > ABOVE) note(o, 'high');
    if (k.damage.type === 'explosive') note(o, 'blasts');
    if (isMelee(k.damage.source)) note(o, 'blade');
  });
  events.on('enemy:backshot', b => {
    const s = soldierOf(b.enemy);
    if (s && !s.surrendered && !b.fleeing) note(o, 'flanks');
  });
}

function note(o: Outpost, habit: Habit): void {
  const { memory, doctrine } = o;
  if (++memory.counts[habit] < HABIT_AT || memory.noticed.has(habit)) return;
  let voice: Soldier | null = null;
  for (const q of o.squads) if (q.inContact && q.leader?.fighting) voice = q.leader;
  if (!voice) return;
  memory.noticed.add(habit);
  // Adapt, then explain: the change is made, and the line says it.
  if (habit === 'blasts') {
    doctrine.spacing = Math.max(doctrine.spacing, SPREAD);
    doctrine.stacks = false;
  } else if (habit === 'blade') doctrine.keepOut = Math.max(doctrine.keepOut, KEEP_OUT);
  o.comms.say('habit', voice, null, { flags: { [habit]: true } });
}
