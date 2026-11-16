import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../../core/events';
import type { GameEvents } from '../../../core/contracts';
import { mulberry32 } from '../../../core/math';
import type { AiWorld } from '../../aiWorld';
import { Comms } from '../comms';
import type { CommsLine } from '../events';
import type { Outpost } from '../index';
import { Soldier } from '../soldier';
import { OutpostSquad } from '../squad';
import { RULES } from './lines';
import { NAME_LIST, NAME_POOLS, NameRoll, speakerTag } from './names';
import { ChatterMemory, ROW_GAP, rowsFor, type ChatterFacts, type ChatterState } from './rules';

vi.mock('../../attacks', () => ({ say: vi.fn() }));

const PRO = /\b(it|its|that thing|monster)\b/i;
const SWEAR = /\b(fuck\w*|shit|hell|bloody|christ|damn|god)\b/i;
const PROFESSIONAL = /\b(tango|hostile|subject)\b/i;
const STATES: readonly ChatterState[] = ['confident', 'steady', 'shaken', 'panicked', 'broken'];
const CONCEPTS = [...new Set(RULES.map(r => r.concept))];
const scared = (s: ChatterState) => s === 'shaken' || s === 'panicked' || s === 'broken';

const facts = (state: ChatterState, over: Partial<ChatterFacts> = {}): ChatterFacts =>
  ({ faction: 'garrison', state, role: 'rifle', rank: 'regular', leader: false, buddy: false, flags: { dead: false }, ...over });

describe('the rule table', () => {
  it('keeps every id unique and every old line, word for word, in the scared rows', () => {
    expect(new Set(RULES.map(r => r.id)).size).toBe(RULES.length);
    const ported = RULES.filter(r => r.id.includes('.scared.'));
    // 43 kinds less `order` and `ally`, which never had lines of their own.
    expect(ported).toHaveLength(154);
    for (const r of ported) expect(r.who?.states).toEqual(['shaken', 'panicked', 'broken']);
    expect(ported.find(r => r.concept === 'fear')!.text).toBe('What IS that thing?');
  });

  it('holds each register to its words', () => {
    for (const r of RULES) {
      const states = r.who!.states!;
      if (states.every(s => !scared(s))) {
        expect(r.text, r.id).not.toMatch(PRO);
        expect(r.text, r.id).not.toMatch(SWEAR);
      } else expect(r.text, r.id).not.toMatch(PROFESSIONAL);
      if (r.id.includes('.panicked.')) expect(r.text, r.id).toMatch(/fuck|shit|that thing|monster|\bit\b/i);
    }
  });

  it('has something for every man to say, whatever his nerve', () => {
    for (const concept of CONCEPTS) {
      for (const state of STATES) {
        const f = facts(state);
        const n = rowsFor(concept, 'garrison').filter(i => (RULES[i]!.when === undefined) && RULES[i]!.who!.states!.includes(state)).length;
        expect(n, `${concept} ${state}`).toBeGreaterThanOrEqual(concept === 'fix' && scared(state) ? 2 : 3);
        expect(new ChatterMemory().pick(concept, f, 0, () => 0.99), `${concept} ${state}`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('picks the most specific row: a name beats a plain line, and a buddy row beats a name', () => {
    const m = new ChatterMemory();
    const named = m.pick('manDown', facts('steady', { flags: { dead: true } }), 0);
    expect(RULES[named]!.text).toContain('{dead}');
    expect(RULES[named]!.id).toContain('.namedPro.');
    const buddy = m.pick('manDown', facts('panicked', { buddy: true, flags: { dead: true } }), 0);
    expect(RULES[buddy]!.id).toContain('.buddy.');
    // No name, no named rows.
    expect(RULES[m.pick('manDown', facts('steady'), 0)]!.text).not.toContain('{dead}');
  });

  it('lends the garrison its rows to a faction whose set is not written yet', () => {
    expect(rowsFor('contact', 'holdfast')).toEqual(rowsFor('contact', 'garrison'));
    expect(new ChatterMemory().pick("contact", facts("steady", { faction: "holdfast" }), 0, () => 0.99)).toBeGreaterThanOrEqual(0);
  });

  it('never lets a scared man say tango, nor a steady one say it', () => {
    const m = new ChatterMemory();
    const random = mulberry32(3);
    for (let t = 0; t < 4000; t += 0.5) {
      const state = STATES[Math.floor(random() * STATES.length)]!;
      const concept = CONCEPTS[Math.floor(random() * CONCEPTS.length)]!;
      const row = m.pick(concept, facts(state), t, random);
      if (row < 0) continue;
      expect(RULES[row]!.text).not.toMatch(scared(state) ? PROFESSIONAL : PRO);
    }
  });
});

describe('not repeating', () => {
  it('runs ten minutes of a fight and never says a row inside its gap, nor one twice before its siblings once', () => {
    const m = new ChatterMemory();
    const random = mulberry32(11);
    const last = new Map<number, number>();
    let lines = 0;
    // A line wanted every quarter second, which is faster than any real fight asks.
    for (let t = 0; t < 600; t += 0.25) {
      const state = STATES[Math.floor(random() * STATES.length)]!;
      const concept = CONCEPTS[Math.floor(random() * CONCEPTS.length)]!;
      const f = facts(state);
      const row = m.pick(concept, f, t, random);
      if (row < 0) continue;
      lines++;
      const before = last.get(row);
      if (before !== undefined) expect(t - before, RULES[row]!.id).toBeGreaterThanOrEqual(RULES[row]!.gap ?? ROW_GAP);
      last.set(row, t);
      // A row comes round again only once every row he could have said instead has had its turn.
      const pool = rowsFor(concept, 'garrison').filter(i => RULES[i]!.who!.states!.includes(state) && !RULES[i]!.when);
      if (m.said[row]! > 1) expect(pool.every(i => m.said[i]! > 0), RULES[row]!.id).toBe(true);
    }
    expect(lines).toBeGreaterThan(500);
  });

  it('is silent once every row of a moment is on its gap, and talks again after', () => {
    const m = new ChatterMemory();
    const f = facts('steady');
    const pool = rowsFor('frag', 'garrison').filter(i => RULES[i]!.who!.states!.includes('steady'));
    for (let i = 0; i < pool.length; i++) expect(m.pick('frag', f, i)).toBeGreaterThanOrEqual(0);
    expect(m.pick('frag', f, pool.length)).toBe(-1);
    expect(m.pick('frag', f, ROW_GAP + 1)).toBeGreaterThanOrEqual(0);
    m.reset();
    expect(m.pick('frag', f, 0)).toBeGreaterThanOrEqual(0);
  });
});

describe('names', () => {
  it('never gives two living men one name, rests the dead, and wakes the longest rested when the pool runs out', () => {
    const roll = new NameRoll();
    const random = mulberry32(5);
    const n = NAME_POOLS.garrison.length;
    const ids = Array.from({ length: n }, () => roll.draw('garrison', random));
    expect(new Set(ids).size).toBe(n);
    for (const id of ids) expect(id).toBeLessThan(n);
    const marsh = ids[0]!;
    roll.died(marsh);
    roll.free(marsh);
    const pike = ids[1]!;
    roll.free(pike);
    // Pike walked off alive, so his name is free; Marsh's rests.
    expect(roll.draw('garrison', random)).toBe(pike);
    expect(roll.draw('garrison', random)).toBe(marsh);
  });

  it('draws the militia from its own pool and tags the feed by faction', () => {
    const roll = new NameRoll();
    const id = roll.draw('holdfast');
    expect(NAME_POOLS.holdfast).toContain(NAME_LIST[id]);
    expect(speakerTag(id, 'Cpl', 'Alpha')).toBe(`${NAME_LIST[id]} · Holdfast`);
    expect(speakerTag(0, 'Cpl', 'Alpha')).toBe('Cpl Marsh · Alpha');
  });

  it('pairs each man with the next, and the odd man out one way with the leader', () => {
    const squad = new OutpostSquad(1, 'Alpha', {} as Outpost);
    const men = Array.from({ length: 5 }, () => new Soldier());
    for (const s of men) squad.join(s);
    const [a, b, c, d, e] = men as [Soldier, Soldier, Soldier, Soldier, Soldier];
    expect(a.buddy).toBe(b);
    expect(b.buddy).toBe(a);
    expect(c.buddy).toBe(d);
    expect(d.buddy).toBe(c);
    expect(e.buddy).toBe(squad.leader);
    expect(squad.leader!.buddy).not.toBe(e);
  });
});

describe('comms asks the rules', () => {
  function world(hosting = true) {
    const events = new EventBus<GameEvents>();
    const heard: CommsLine[] = [];
    events.on('comms:line', l => heard.push({ ...l }));
    const w = {
      now: 0, player: { position: { x: 0, y: 0, z: 0 } },
      enemies: { outpost: { doctrine: { radioSilence: false } } },
      ctx: { events, coop: hosting ? undefined : { world: {}, hosting: false } },
    } as unknown as AiWorld;
    return { w, heard, comms: new Comms(w) };
  }
  function man(squad: OutpostSquad, name: number, state: ChatterState): Soldier {
    const s = new Soldier();
    squad.join(s);
    s.name = name;
    s.state = state === 'confident' ? 'steady' : state;
    s.e = { center: { x: 0, y: 1, z: 0 }, def: { voice: { attack: 'x' } } } as unknown as Soldier['e'];
    return s;
  }

  it('says the row the nerve asks for, with the names on the feed', () => {
    const { w, heard, comms } = world();
    const squad = new OutpostSquad(1, 'Alpha', {} as Outpost);
    const steady = man(squad, 0, 'steady');
    const shaken = man(squad, 1, 'shaken');
    for (let i = 0; i < 40; i++) {
      w.now = i * 10;
      comms.say('contact', i % 2 ? shaken : steady);
    }
    expect(heard.length).toBeGreaterThan(20);
    for (const l of heard) {
      const pro = l.speaker!.includes('Marsh');
      expect(l.text).not.toMatch(pro ? PRO : PROFESSIONAL);
      expect(l.speaker).toBe(pro ? 'Cpl Marsh · Alpha' : 'Cpl Novak · Alpha');
      expect(RULES[l.row!]!.concept).toBe('contact');
    }
  });

  it('names the dead, and lets his pair grieve', () => {
    const { w, heard, comms } = world();
    const squad = new OutpostSquad(1, 'Alpha', {} as Outpost);
    const marsh = man(squad, 0, 'steady');
    const novak = man(squad, 1, 'panicked');
    w.now = 100;
    comms.say('manDown', novak, marsh);
    expect(heard[0]!.text).toContain('Marsh');
    expect(heard[0]!.dead).toBe(0);
    expect(RULES[heard[0]!.row!]!.id).toContain('.buddy.');
  });

  it('keeps a co-op guest quiet: the host decides every line', () => {
    const { heard, comms } = world(false);
    const squad = new OutpostSquad(1, 'Alpha', {} as Outpost);
    comms.say('contact', man(squad, 0, 'steady'));
    comms.relay('Words.', null, 'Command');
    expect(heard).toHaveLength(0);
  });
});
