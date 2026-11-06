import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../core/math';
import { readingSeconds, Script, spoken } from '../../ui/commander/pick';
import { ADAPTATIONS, FINAL_WAVE, phaseOf, TONE_OF, TRICKS, type AdaptationId, type HabitId } from './adaptations';
import { pickAdaptation, plansFor, refit, tricksFrom } from './director';
import type { Briefing } from './events';
import { bandFor, COUNT_BANDS, councilFor, lineById, LINES, reactions, slotsOf, textOnly, type Topic } from './lines';
import { StyleTracker, type RoundReport } from './tracker';

const none = (): Record<HabitId, number> => ({
  camping: 0, sonar: 0, routes: 0, pickups: 0, explosives: 0, melee: 0, speed: 0, highGround: 0, callIns: 0, headshots: 0, executions: 0, baiting: 0, chatter: 0, range: 0,
});
const steady = () => 0.5;

const report = (over: Partial<RoundReport> = {}): RoundReport => {
  const t = new StyleTracker();
  return { ...t.closeRound(1), ...over };
};

const briefing = (over: Partial<Briefing> = {}): Briefing => ({
  wave: 1, next: 2, phase: 'contact', report: report({ kills: 8, damageTaken: 30, seconds: 80 }), adaptation: null, tricks: [], fielded: [], seconds: 13, ...over,
});

describe('the table', () => {
  it('gives every answer and trick a tell and a counterplay', () => {
    for (const row of [...ADAPTATIONS, ...TRICKS]) {
      expect(row.tell.length, row.id).toBeGreaterThan(10);
      expect(row.counterplay.length, row.id).toBeGreaterThan(5);
    }
  });

  it('follows section 16.4 across a run and ends on the last stand', () => {
    expect(phaseOf(1)).toBe('contact');
    expect(phaseOf(3)).toBe('adaptation');
    expect(phaseOf(6)).toBe('desperation');
    expect(phaseOf(FINAL_WAVE)).toBe('lastStand');
    expect(TONE_OF.lastStand).toBe('cracked');
  });
});

describe('the director', () => {
  const answerFor = (habit: HabitId): AdaptationId | null => pickAdaptation({ ...none(), [habit]: 1 }, new Set(), 2, steady);

  it('answers each habit with its own row of section 16.2', () => {
    expect(answerFor('camping')).toBe('mortars');
    expect(answerFor('sonar')).toBe('jammers');
    expect(answerFor('routes')).toBe('mines');
    expect(answerFor('pickups')).toBe('riggedPickups');
    expect(answerFor('explosives')).toBe('spread');
    expect(answerFor('melee')).toBe('shotguns');
    expect(answerFor('speed')).toBe('crossfire');
    expect(answerFor('highGround')).toBe('smoke');
    expect(answerFor('callIns')).toBe('manpads');
    expect(answerFor('headshots')).toBe('helmets');
    expect(answerFor('executions')).toBe('noSurrender');
  });

  it('moves down a habit\'s answers as they are used', () => {
    const taken = new Set<AdaptationId>(['mortars']);
    expect(pickAdaptation({ ...none(), camping: 1 }, taken, 2, steady)).toBe('snipers');
    taken.add('snipers');
    // Nothing left for camping, so it falls back on standing orders rather than repeating itself.
    expect(pickAdaptation({ ...none(), camping: 1 }, taken, 2, steady)).toBe('mines');
  });

  it('prefers an unanswered habit to a second answer to an old one', () => {
    const taken = new Set<AdaptationId>(['jammers']);
    expect(pickAdaptation({ ...none(), sonar: 0.9, routes: 0.8 }, taken, 4, steady)).toBe('mines');
  });

  it('still fields something for a player with no habits', () => {
    expect(pickAdaptation(none(), new Set(), 2, steady)).toBe('mortars');
  });

  it('keeps one new thing a wave for a whole run, and never repeats', () => {
    const roll = mulberry32(3);
    const taken = new Set<AdaptationId>();
    for (let wave = 2; wave <= FINAL_WAVE; wave++) {
      const id = pickAdaptation({ ...none(), camping: 0.8, sonar: 0.5 }, taken, wave, roll);
      expect(id).not.toBeNull();
      expect(taken.has(id!)).toBe(false);
      taken.add(id!);
    }
    expect(taken.size).toBe(FINAL_WAVE - 1);
  });

  it('holds back tricks to their wave', () => {
    expect(tricksFrom(2)).toEqual([]);
    expect(tricksFrom(6)).toContain('sacrifice');
    expect(tricksFrom(6)).toContain('dangerClose');
  });

  it('fields a spotter with any mortar, because a mortar without one is blind', () => {
    const plans = plansFor(3, new Set(['mortars']), new Set());
    expect(plans.some(p => p.jobs.includes('mortar'))).toBe(true);
    expect(plans.some(p => p.jobs.includes('spotter'))).toBe(true);
    for (const p of plansFor(8, new Set(ADAPTATIONS.map(a => a.id)), new Set(TRICKS.map(t => t.id)))) expect(p.jobs.length).toBe(p.members.length);
  });

  it('swaps rifles for shotguns in pairs', () => {
    const squads: ('trooper' | 'gunner')[][] = [['trooper', 'trooper', 'trooper']];
    refit(squads, new Set(['shotguns']), 3);
    expect(squads[0]).toEqual(['gunner', 'gunner', 'trooper']);
  });
});

describe('the tracker', () => {
  const doors = [{ x: 0, z: 0, dx: 1, dz: 0 }, { x: 20, z: 0, dx: 1, dz: 0 }];

  const run = (bot: (t: StyleTracker, i: number) => void, seconds = 120): StyleTracker => {
    const t = new StyleTracker();
    t.setDoors(doors);
    for (let i = 0; i < seconds * 4; i++) bot(t, i);
    return t;
  };

  it('reads a camper', () => {
    const t = run(u => u.sample(0.25, 5, 0.1, 5, 0, true, 'CRATES'));
    expect(t.habits().camping).toBe(1);
    expect(t.habits().speed).toBe(0);
    expect(t.campX).toBe(5);
  });

  it('does not read a walker as a camper', () => {
    const t = run((u, i) => u.sample(0.25, Math.sin(i / 8) * 30, 0.1, Math.cos(i / 8) * 30, 5, true, 'YARD'));
    expect(t.habits().camping).toBeLessThan(0.1);
  });

  it('counts a repeated door', () => {
    const t = run((u, i) => u.sample(0.25, i % 16 < 8 ? -2 : 2, 0.1, 0, 5, true, null));
    expect(t.hotDoors(1)).toEqual([0]);
    expect(t.habits().routes).toBe(1);
  });

  it('forgets an old habit as the player changes', () => {
    const t = run(u => u.sample(0.25, 5, 0.1, 5, 0, true, null), 60);
    for (let wave = 1; wave <= 4; wave++) {
      t.closeRound(wave);
      for (let i = 0; i < 400; i++) t.sample(0.25, i * 2, 0.1, wave * 40, 14, true, null);
    }
    expect(t.habits().camping).toBeLessThan(0.6);
  });

  it('reports the round in numbers a line can quote', () => {
    const t = new StyleTracker();
    t.setDoors(doors);
    for (let i = 0; i < 212; i++) t.shot('smg', 0, 1);
    t.kill('smg', 12, true);
    t.trapped('mine', 40);
    t.trapped('mine', 20);
    t.named('Dennis');
    const r = t.closeRound(3);
    expect(r.doorShots).toBe(212);
    expect(r.favouriteWeapon).toBe('smg');
    expect(r.headshots).toBe(1);
    expect(r.trapHits).toEqual([{ cause: 'mine', hits: 2, damage: 60 }]);
    expect(r.fallen).toEqual(['Dennis']);
    expect(t.round.shots).toBe(0);
  });
});

describe('the script', () => {
  it('has a stable, unique id on every line', () => {
    const ids = LINES.map(l => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-zA-Z0-9.]+$/);
  });

  it('has a voice\'s worth of lines and every emotion the arc needs', () => {
    expect(LINES.length).toBeGreaterThan(380);
    const topics: Topic[] = ['door', 'camp', 'weapon', 'headshots', 'limbs', 'executions', 'untouched', 'fallen', 'gift', 'generic'];
    for (const topic of topics) for (const tone of ['smug', 'irritated', 'rattled', 'cracked'] as const) expect(reactions(topic, tone).length, `${topic} ${tone}`).toBeGreaterThan(0);
    for (const tone of ['smug', 'irritated', 'rattled', 'cracked'] as const) expect(councilFor(tone).length).toBeGreaterThan(5);
  });

  it('keeps the owner\'s own lines word for word', () => {
    expect(lineById('cmd.generic.rattled.giftshop')?.text).toBe('Please. We have families. We have a gift shop.');
    expect(lineById('council.smug.extinctions')?.text).toBe('Your appeal has been received. Processing time is 6-8 extinctions.');
    expect(lineById('cmd.answer.mines.door')?.text).toBe('There are mines in it now.');
  });

  it('every line is short enough to read in the box', () => {
    for (const l of LINES) expect(l.text.length, l.id).toBeLessThan(190);
  });

  it('allows one slot per recorded line, and marks the rest as text', () => {
    for (const l of LINES) {
      const slots = slotsOf(l.text);
      expect(textOnly(l), l.id).toBe(slots.length > 1);
      expect(l.id.startsWith('cmd') || l.id.startsWith('council') || l.id.startsWith('intercept') || l.id.startsWith('radio') || l.id.startsWith('chatter')).toBe(true);
    }
  });

  it('records a number at the band it reached', () => {
    expect(bandFor(COUNT_BANDS.door!, 212)[0]).toBe(200);
    expect(bandFor(COUNT_BANDS.door!, 7)[0]).toBe(50);
    const part = spoken(lineById('cmd.door.smug.office')!, { n: 212 }, 'door');
    expect(part.text).toBe('212 shots from that same doorway. We\'ve started calling it your office.');
    expect(part.clip).toBe('cmd.door.smug.office~200');
  });

  it('names the weapon, the room and the man in the clip', () => {
    expect(spoken(lineById('cmd.weapon.smug.others')!, { weapon: 'rocket' }, 'weapon').clip).toBe('cmd.weapon.smug.others~rocket');
    expect(spoken(lineById('cmd.weapon.smug.others')!, { weapon: 'rocket' }, 'weapon').text).toContain('rocket launcher');
    expect(spoken(lineById('cmd.fallen.smug.roster')!, { name: 'Big Tom' }, 'fallen').clip).toBe('cmd.fallen.smug.roster~Big_Tom');
  });
});

describe('the box', () => {
  const compose = (over: Partial<Briefing>, seed = 1) => new Script(mulberry32(seed)).compose(briefing(over));
  const text = (over: Partial<Briefing>, seed = 1) => compose(over, seed).flatMap(p => p.parts.map(x => x.text)).join(' ');

  it('ends up saying the owner\'s line about the door', () => {
    const r = report({ doorShots: 212, kills: 8, damageTaken: 30, seconds: 80 });
    const pages = compose({ report: r, adaptation: 'mines' });
    expect(pages[0]!.parts[0]!.text).toContain('212');
    expect(pages[0]!.parts.map(p => p.text).join(' ')).toContain('There are mines in it now.');
  });

  it('gloats when a trap landed', () => {
    const r = report({ doorShots: 212, trapHits: [{ cause: 'mine', hits: 1, damage: 40 }] });
    expect(text({ report: r })).toContain('mines');
    expect(compose({ report: r })[0]!.parts[0]!.id).toBe('cmd.gloat.mine.smug');
  });

  it('speaks in the tone of the wave to come', () => {
    for (const [phase, tone] of [['contact', 'smug'], ['adaptation', 'irritated'], ['desperation', 'rattled'], ['lastStand', 'cracked']] as const) {
      expect(compose({ phase })[0]!.tone).toBe(tone);
      expect(compose({ phase })[0]!.parts[0]!.id).toContain(tone);
    }
  });

  it('always tells the player what changed, as an intercept, last', () => {
    const pages = compose({ adaptation: 'jammers', tricks: ['dangerClose'] });
    const last = pages[pages.length - 1]!;
    expect(last.speaker).toBe('intercept');
    expect(last.parts.map(p => p.id)).toEqual(['intercept.jammers', 'intercept.trick.dangerClose']);
  });

  it('opens a run with the Council refusing to take his call', () => {
    expect(compose({}).find(p => p.speaker === 'council')?.parts[0]?.id).toBe('council.smug.casenumber');
  });

  it('never runs long', () => {
    for (let seed = 1; seed < 40; seed++) {
      const pages = compose({ adaptation: 'falseSurrender', tricks: ['sacrifice', 'dangerClose'], phase: 'desperation', next: 6 }, seed);
      expect(pages.length).toBeLessThanOrEqual(4);
      let seconds = 0;
      for (const p of pages) seconds += readingSeconds(p);
      expect(seconds).toBeLessThan(20);
    }
  });

  it('does not repeat itself inside a run', () => {
    const s = new Script(mulberry32(5));
    const seen = new Set<string>();
    for (let wave = 1; wave < 9; wave++) {
      for (const p of s.compose(briefing({ wave, next: wave + 1, phase: phaseOf(wave + 1) }))) {
        if (p.speaker !== 'commander') continue;
        for (const part of p.parts) {
          expect(seen.has(part.id), part.id).toBe(false);
          seen.add(part.id);
        }
      }
    }
  });
});
