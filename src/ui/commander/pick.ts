/**
 * Decides what gets said between waves. No DOM here, so a test can feed it a round and read the script. The rules are few: gloat if a
 * trap landed, otherwise quote the most striking thing the player did, then announce the next answer, then let the Council file it.
 */
import { TONE_OF, type AdaptationId, type Tone } from '../../enemies/commander/adaptations';
import type { Briefing } from '../../enemies/commander/events';
import {
  answer, bandFor, councilFor, councilOn, COUNT_BANDS, gloat, LAST, lineById, order, reactions, textOnly, trickOrder, trickSay, UNVOICED_WEAPONS,
  weaponWord,
  type Line, type Speaker, type Topic, type TrapCause,
} from '../../enemies/commander/lines';
import type { RoundReport } from '../../enemies/commander/tracker';

/** One line, ready to show and to play. */
export interface Spoken {
  id: string;
  text: string;
  /** The recording that says this, or null if it stays text. */
  clip: string | null;
}

export interface Page {
  speaker: Speaker;
  tone: Tone;
  parts: Spoken[];
}

interface Filled {
  n?: number;
  weapon?: string;
  room?: string;
  name?: string;
  squad?: string;
}

/** Under this a topic is not worth bringing up, and the Commander fills the silence instead. */
const WORTH_SAYING = 0.3;
/** A reaction and an answer share a page if both fit comfortably. */
const ONE_PAGE = 118;
/** How often the Council bothers, when it has nothing specific to file. */
const COUNCIL_CHANCE = 0.6;
const TOPIC_CHANCE = 0.5;
/** Each time a topic comes up it is worth this share of what it was. */
const STALE = 0.55;
const QUICK_ROUND = 45;
const SLOW_ROUND = 150;

const CAUSES: readonly string[] = ['mortar', 'mine', 'tripwire', 'claymore', 'snare', 'rigged', 'deadman', 'sniper', 'falseSurrender', 'manpads'];

/** Each row is one thing a Commander might notice, how striking it is from 0 to 1, and what it quotes. */
const RULES: readonly { topic: Topic; score(r: RoundReport): number; fill?(r: RoundReport): Filled }[] = [
  { topic: 'gift', score: r => (r.gifts > 0 ? 0.92 : 0), fill: r => ({ n: r.gifts }) },
  { topic: 'executions', score: r => (r.executions > 0 ? 0.88 : 0), fill: r => ({ n: r.executions }) },
  { topic: 'door', score: r => (r.doorShots >= 40 ? Math.min(0.3 + r.doorShots / 200, 0.95) : 0), fill: r => ({ n: Math.round(r.doorShots) }) },
  { topic: 'camp', score: r => (r.stillSeconds >= 12 ? Math.min(0.3 + r.stillSeconds / 80, 0.9) : 0), fill: r => ({ n: Math.round(r.stillSeconds) }) },
  { topic: 'fallen', score: r => (r.fallen.length > 0 ? 0.6 : 0), fill: r => ({ name: r.fallen[r.fallen.length - 1]! }) },
  { topic: 'untouched', score: r => (r.damageTaken < 6 && r.kills >= 4 ? 0.78 : 0) },
  { topic: 'hurt', score: r => (r.damageTaken >= 70 ? Math.min(0.3 + r.damageTaken / 300, 0.8) : 0), fill: r => ({ n: Math.round(r.damageTaken) }) },
  { topic: 'headshots', score: r => (r.headshots >= 3 ? Math.min(0.25 + r.headshots / 20, 0.8) : 0), fill: r => ({ n: r.headshots }) },
  { topic: 'limbs', score: r => (r.limbs >= 3 ? Math.min(0.3 + r.limbs / 20, 0.8) : 0), fill: r => ({ n: r.limbs }) },
  { topic: 'melee', score: r => (r.meleeKills >= 3 ? Math.min(0.35 + r.meleeKills / 16, 0.85) : 0), fill: r => ({ n: r.meleeKills }) },
  { topic: 'callIns', score: r => (r.callIns >= 1 ? 0.55 + Math.min(r.callIns * 0.1, 0.3) : 0), fill: r => ({ n: r.callIns }) },
  { topic: 'sonar', score: r => (r.pings >= 4 ? Math.min(0.3 + r.pings / 16, 0.8) : 0), fill: r => ({ n: r.pings }) },
  { topic: 'pickups', score: r => (r.pickups >= 4 ? Math.min(0.25 + r.pickups / 16, 0.7) : 0), fill: r => ({ n: r.pickups }) },
  { topic: 'weapon', score: r => (r.favouriteShots >= 30 && r.favouriteShots / Math.max(r.shots, 1) > 0.7 ? 0.5 : 0), fill: r => ({ weapon: r.favouriteWeapon }) },
  { topic: 'highGround', score: r => (r.highSeconds >= 15 ? Math.min(0.3 + r.highSeconds / 90, 0.75) : 0) },
  { topic: 'speed', score: r => (r.fastSeconds >= 15 ? Math.min(0.3 + r.fastSeconds / 90, 0.7) : 0) },
  { topic: 'room', score: r => (r.room && r.roomShare > 0.6 ? 0.42 : 0), fill: r => ({ room: r.room }) },
  { topic: 'accuracy', score: r => (r.shots >= 120 && r.kills / r.shots < 0.05 ? 0.5 : 0), fill: r => ({ n: r.shots }) },
  { topic: 'range', score: r => (r.longestKill >= 30 ? Math.min(r.longestKill / 80, 0.65) : 0), fill: r => ({ n: Math.round(r.longestKill) }) },
  { topic: 'quick', score: r => (r.seconds < QUICK_ROUND && r.kills > 0 ? 0.48 : 0), fill: r => ({ n: Math.round(r.seconds) }) },
  { topic: 'slow', score: r => (r.seconds > SLOW_ROUND ? 0.4 : 0), fill: r => ({ n: Math.round(r.seconds) }) },
];

export class Script {
  private readonly said = new Set<string>();
  private readonly topics = new Map<Topic, number>();
  private first = true;

  constructor(private readonly roll: () => number = Math.random) {}

  reset(): void {
    this.said.clear();
    this.topics.clear();
    this.first = true;
  }

  /** The next thing from `list` nobody has heard this run. Once they all have, anything but the last. */
  private fresh(list: readonly Line[]): Line | null {
    if (list.length === 0) return null;
    const unsaid = list.filter(l => !this.said.has(l.id));
    const from = unsaid.length > 0 ? unsaid : list;
    const line = from[Math.floor(this.roll() * from.length)]!;
    this.said.add(line.id);
    return line;
  }

  private strongest(r: RoundReport): { topic: Topic; fill: Filled } | null {
    let best: (typeof RULES)[number] | null = null;
    let bestScore = WORTH_SAYING;
    for (const rule of RULES) {
      const score = rule.score(r) * STALE ** (this.topics.get(rule.topic) ?? 0);
      if (score > bestScore) {
        bestScore = score;
        best = rule;
      }
    }
    return best ? { topic: best.topic, fill: best.fill?.(r) ?? {} } : null;
  }

  private react(b: Briefing, tone: Tone): { part: Spoken | null; topic: Topic | null } {
    const r = b.report;
    for (const hit of r.trapHits) {
      if (!CAUSES.includes(hit.cause)) continue;
      const line = gloat(hit.cause as TrapCause, tone);
      if (line && !this.said.has(line.id)) {
        this.said.add(line.id);
        return { part: spoken(line, {}, null), topic: null };
      }
    }
    const found = this.strongest(r);
    if (found) {
      this.topics.set(found.topic, (this.topics.get(found.topic) ?? 0) + 1);
      const line = this.fresh(reactions(found.topic, tone));
      if (line) return { part: spoken(line, found.fill, found.topic), topic: found.topic };
    }
    const line = this.fresh(reactions('generic', tone));
    return { part: line ? spoken(line, {}, null) : null, topic: null };
  }

  /** The pages for one break between waves. */
  compose(b: Briefing): Page[] {
    const tone = TONE_OF[b.phase];
    const late = tone === 'rattled' || tone === 'cracked';
    const { part: reaction, topic } = this.react(b, tone);
    const after: Spoken[] = [];
    if (b.adaptation) after.push(spoken(announce(b.adaptation, late, topic), {}, null));
    // Two tricks can start on one wave. He mentions one, and the intercept has both.
    if (b.tricks[0]) after.push(spoken(trickSay(b.tricks[0]), {}, null));
    if (b.next >= 10) {
      const last = this.fresh(LAST);
      if (last) after.push(spoken(last, {}, null));
    }

    const pages: Page[] = [];
    const parts = reaction ? [reaction] : [];
    const room = (reaction?.text.length ?? 0) + (after[0]?.text.length ?? 0);
    if (after.length === 1 && room <= ONE_PAGE) parts.push(after[0]!);
    if (parts.length > 0) pages.push({ speaker: 'commander', tone, parts });
    if (parts.length < 2 || after.length > 1) {
      const rest = after.length === 1 && room <= ONE_PAGE ? [] : after;
      if (rest.length > 0) pages.push({ speaker: 'commander', tone, parts: rest });
    }

    const council = this.council(tone, topic);
    if (council) pages.push({ speaker: 'council', tone, parts: [spoken(council, {}, null)] });

    const orders: Spoken[] = [];
    if (b.adaptation) orders.push(spoken(order(b.adaptation), {}, null));
    for (const t of b.tricks) orders.push(spoken(trickOrder(t), {}, null));
    if (orders.length > 0) pages.push({ speaker: 'intercept', tone, parts: orders });
    this.first = false;
    return pages;
  }

  private council(tone: Tone, topic: Topic | null): Line | null {
    if (this.first) return lineById('council.smug.casenumber') ?? null;
    if (topic && this.roll() < TOPIC_CHANCE) {
      const filed = councilOn(topic);
      if (filed && !this.said.has(filed.id)) {
        this.said.add(filed.id);
        return filed;
      }
    }
    return this.roll() < COUNCIL_CHANCE ? this.fresh(councilFor(tone)) : null;
  }
}

/** A door round ends on the owner's line, if the answer is mines: it only makes sense straight after the door has been mentioned. */
function announce(id: AdaptationId, late: boolean, topic: Topic | null): Line {
  if (id === 'mines' && topic === 'door') return lineById('cmd.answer.mines.door')!;
  return answer(id, late);
}

const WORD = /\{(n|weapon|room|name|squad)\}/g;

/** Fills the slots. The text keeps the true number; the clip name carries the band a recording was made at. */
export function spoken(line: Line, fill: Filled, topic: Topic | null): Spoken {
  let key = '';
  let unvoiced = false;
  const text = line.text.replace(WORD, (_, slot: string) => {
    if (slot === 'n') {
      const n = fill.n ?? 0;
      const bands = topic ? COUNT_BANDS[topic] : undefined;
      if (bands) key = String(bandFor(bands, n)[0]);
      return String(n);
    }
    if (slot === 'weapon') {
      key = fill.weapon ?? '';
      if (UNVOICED_WEAPONS.has(key)) unvoiced = true;
      return weaponWord(key);
    }
    const word = slot === 'room' ? fill.room : slot === 'squad' ? fill.squad : fill.name;
    key = word ?? '';
    return word ?? '';
  });
  return { id: line.id, text, clip: textOnly(line) || unvoiced ? null : key ? `${line.id}~${key.replace(/ /g, '_')}` : line.id };
}

/** Seconds a page stays up if there is no recording to time it by. */
export function readingSeconds(page: Page): number {
  let chars = 0;
  for (const p of page.parts) chars += p.text.length;
  return Math.min(Math.max(1.4 + chars * 0.034, 2.4), 6.5);
}
