import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../../core/events';
import type { GameEvents } from '../../../core/contracts';
import { mulberry32 } from '../../../core/math';
import type { AiWorld } from '../../aiWorld';
import { Comms } from '../comms';
import type { CommsKind, CommsLine } from '../events';
import type { Outpost } from '../index';
import type { MoraleState } from '../morale';
import { Soldier } from '../soldier';
import { OutpostSquad } from '../squad';
import { RULES } from './lines';
import { NAME_LIST, NAME_POOLS, NameRoll, callName, poolOf, speakerTag } from './names';
import { ChatterMemory, SPEAK_RATE, TIER_OF, rowsFor, type ChatterFacts, type Tier } from './rules';

vi.mock('../../attacks', () => ({ say: vi.fn() }));

const TIERS: readonly Tier[] = ['high', 'medium', 'low', 'desperate'];
const CONCEPTS = [...new Set(RULES.map(r => r.concept))];
/** What each tier may not call the player, and how it may not talk. */
const FORBID: Record<Tier, RegExp> = {
  high: /\b(it|its|that thing|monster|freak|piece of shit|fuck\w*|shit|hell|bloody|christ|damn|god)\b/i,
  medium: /\b(it|its|that thing|monster|freak|piece of shit|fuck\w*|shit)\b/i,
  low: /\b(tango|hostile|subject|target)\b/i,
  desperate: /\b(it|its|thing|monster|freak|tango|hostile|subject|target)\b/i,
};

const facts = (tier: Tier, flags: Record<string, boolean> = {}): ChatterFacts => ({ faction: 'garrison', tier, role: 'rifle', flags });

describe('the rule table', () => {
  it('has the owner\'s fields, unique ids, and every old line word for word in the Low rows', () => {
    expect(new Set(RULES.map(r => r.id)).size).toBe(RULES.length);
    for (const r of RULES) {
      for (const k of ['id', 'concept', 'criteria', 'unit', 'personality', 'morale_tier', 'text', 'priority', 'cooldown', 'radio', 'interruptible']) expect(r, r.id).toHaveProperty(k);
    }
    const ported = RULES.filter(r => r.id.includes('.scared.') && !r.id.includes('.ack.'));
    expect(ported).toHaveLength(154);
    for (const r of ported) expect(r.morale_tier, r.id).toContain('low');
    expect(ported.find(r => r.concept === 'fear')!.text).toBe('What IS that thing?');
  });

  it('holds each tier to what it calls the player and how it talks', () => {
    for (const r of RULES) for (const t of r.morale_tier) expect(r.text, `${r.id} ${t}`).not.toMatch(FORBID[t]);
  });

  it('has something for every man to say, whatever his tier', () => {
    for (const concept of CONCEPTS) {
      for (const tier of TIERS) {
        const n = rowsFor(concept, 'garrison').filter(i => Object.keys(RULES[i]!.criteria).length === 0 && RULES[i]!.morale_tier.includes(tier)).length;
        expect(n, `${concept} ${tier}`).toBeGreaterThanOrEqual(3);
        expect(new ChatterMemory().pick(concept, facts(tier), 0, () => 0.99), `${concept} ${tier}`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('picks the most specific row: a name beats a plain line, and a buddy row beats a name', () => {
    const m = new ChatterMemory();
    const named = m.pick('manDown', facts('high', { dead: true }), 0);
    expect(RULES[named]!.text).toContain('{dead}');
    const buddy = m.pick('manDown', facts('low', { dead: true, buddy: true }), 0);
    expect(RULES[buddy]!.id).toContain('.buddy.');
    expect(RULES[m.pick('manDown', facts('high'), 0)]!.text).not.toContain('{dead}');
    expect(m.why.score).toBe(1);
  });

  it('maps nerve to the owner\'s four tiers', () => {
    const states: MoraleState[] = ['steady', 'shaken', 'panicked', 'broken'];
    expect(states.map(s => TIER_OF[s])).toEqual(['high', 'medium', 'low', 'desperate']);
  });

  it('never lets a scared man say tango, nor a steady one say it', () => {
    const m = new ChatterMemory();
    const random = mulberry32(3);
    for (let t = 0; t < 4000; t += 0.5) {
      const tier = TIERS[Math.floor(random() * TIERS.length)]!;
      const row = m.pick(CONCEPTS[Math.floor(random() * CONCEPTS.length)]!, facts(tier), t, random);
      if (row >= 0) expect(RULES[row]!.text).not.toMatch(FORBID[tier]);
    }
  });
});

describe('not repeating', () => {
  it('runs ten minutes of a fight and never says a row inside its cooldown, nor one twice before its siblings once', () => {
    const m = new ChatterMemory();
    const random = mulberry32(11);
    const last = new Map<number, number>();
    let lines = 0;
    for (let t = 0; t < 600; t += 0.25) {
      const tier = TIERS[Math.floor(random() * TIERS.length)]!;
      const concept = CONCEPTS[Math.floor(random() * CONCEPTS.length)]!;
      const row = m.pick(concept, facts(tier), t, random);
      if (row < 0) continue;
      lines++;
      const before = last.get(row);
      if (before !== undefined) expect(t - before, RULES[row]!.id).toBeGreaterThanOrEqual(RULES[row]!.cooldown);
      last.set(row, t);
      const pool = rowsFor(concept, 'garrison').filter(i => RULES[i]!.morale_tier.includes(tier) && Object.keys(RULES[i]!.criteria).length === 0);
      if (m.said[row]! > 1) expect(pool.every(i => m.said[i]! > 0), RULES[row]!.id).toBe(true);
    }
    expect(lines).toBeGreaterThan(500);
  });
});

describe('names', () => {
  it('gives a garrison man a designation, a surname and, by his role, a nickname, never two alike alive', () => {
    const roll = new NameRoll();
    const random = mulberry32(5);
    const men = Array.from({ length: 20 }, () => {
      const s = new Soldier();
      roll.enlist(s, 'garrison', 'rifle', 'regular', false, [], random);
      return s;
    });
    expect(new Set(men.map(s => s.name)).size).toBe(20);
    expect(new Set(men.map(s => s.desig)).size).toBe(20);
    for (const s of men) {
      expect(poolOf(s.name)).toBe('surname');
      expect(poolOf(s.desig)).toBe('designation');
    }
    const brute = new Soldier();
    roll.enlist(brute, 'garrison', 'machinegun', 'veteran', false, [], random);
    expect(NAME_LIST[brute.nick]).toBe('Brick');
    expect(brute.known).toBe(true);
    const second = new Soldier();
    roll.enlist(second, 'garrison', 'machinegun', 'veteran', false, [brute.nick], random);
    expect(second.nick).toBe(-1);
  });

  it('says the designation on the radio, the nickname between buddies and the surname otherwise', () => {
    const roll = new NameRoll();
    const s = new Soldier();
    roll.enlist(s, 'garrison', 'medic', 'regular', false, []);
    expect(NAME_LIST[callName(s, true, false)]).toBe(NAME_LIST[s.desig]);
    expect(NAME_LIST[callName(s, false, true)]).toBe('Patch');
    expect(NAME_LIST[callName(s, false, false)]).toBe(NAME_LIST[s.name]);
    expect(speakerTag(s.desig, 'Cpl', 'Bravo')).toBe(`${NAME_LIST[s.desig]} · Bravo`);
    expect(speakerTag(s.name, 'Cpl', 'Bravo')).toBe(`Cpl ${NAME_LIST[s.name]} · Bravo`);
  });

  it('rests a dead man\'s names and frees a living man\'s', () => {
    const roll = new NameRoll();
    const men = NAME_POOLS.surname.map(() => roll.draw('surname'));
    roll.died({ name: men[0]!, desig: -1, nick: -1, known: true });
    roll.free({ name: men[0]!, desig: -1, nick: -1, known: true });
    roll.free({ name: men[1]!, desig: -1, nick: -1, known: true });
    expect(roll.draw('surname')).toBe(men[1]);
    expect(roll.draw('surname')).toBe(men[0]);
  });

  it('keeps Holdfast\'s militia on their own plain names', () => {
    const s = new Soldier();
    new NameRoll().enlist(s, 'holdfast', 'rifle', 'regular', true, []);
    expect(NAME_POOLS.holdfast).toContain(NAME_LIST[s.name]);
    expect(s.desig).toBe(-1);
    expect(speakerTag(s.name, 'Cpl', 'Alpha')).toBe(`${NAME_LIST[s.name]} · Holdfast`);
  });

  it('pairs each man with the next, and the odd man out one way with the leader', () => {
    const squad = new OutpostSquad(1, 'Alpha', {} as Outpost);
    const men = Array.from({ length: 5 }, () => new Soldier());
    for (const s of men) squad.join(s);
    const [a, b, c, d, e] = men as [Soldier, Soldier, Soldier, Soldier, Soldier];
    expect([a.buddy, b.buddy, c.buddy, d.buddy]).toEqual([b, a, d, c]);
    expect(e.buddy).toBe(squad.leader);
  });
});

describe('comms: who speaks, and when a line is cut', () => {
  function world(hosting = true) {
    const events = new EventBus<GameEvents>();
    const heard: CommsLine[] = [];
    const cuts: { at: number }[] = [];
    events.on('comms:line', l => heard.push({ ...l }));
    events.on('comms:cut', c => cuts.push({ at: c.at }));
    const soldiers: Soldier[] = [];
    const w = {
      now: 0, player: { position: { x: 0, y: 0, z: 0 } },
      enemies: { outpost: { doctrine: { radioSilence: false }, soldiers } },
      ctx: { events, coop: hosting ? undefined : { world: {}, hosting: false } },
    } as unknown as AiWorld;
    return { w, events, heard, cuts, soldiers, comms: new Comms(w) };
  }
  function man(squad: OutpostSquad, soldiers: Soldier[], name: number, state: MoraleState, known = true): Soldier {
    const s = new Soldier();
    squad.join(s);
    s.name = name;
    s.known = known;
    s.state = state;
    s.e = { alive: true, maxHealth: 100, center: { x: 0, y: 1, z: 0 }, position: { distanceToSquared: () => 1 }, def: { voice: { attack: 'x' } } } as unknown as Soldier['e'];
    soldiers.push(s);
    return s;
  }

  it('says the row the tier asks for, with the names on the feed', () => {
    const { w, heard, soldiers, comms } = world();
    const squad = new OutpostSquad(1, 'Alpha', {} as Outpost);
    const steady = man(squad, soldiers, 0, 'steady');
    const panicked = man(new OutpostSquad(2, 'Bravo', {} as Outpost), soldiers, 1, 'panicked');
    for (let i = 0; i < 40; i++) {
      w.now = i * 10;
      comms.say('contact', i % 2 ? panicked : steady);
    }
    expect(heard.length).toBeGreaterThan(20);
    for (const l of heard) {
      const high = l.speaker!.includes('Voss');
      expect(l.text).not.toMatch(FORBID[high ? 'high' : 'low']);
      expect(l.speaker).toBe(high ? 'Cpl Voss · Alpha' : 'Cpl Kade · Bravo');
      expect(l.why).toContain(RULES[l.row!]!.id);
    }
  });

  it('names the dead only if he was known, and lets his buddy grieve', () => {
    const { w, heard, soldiers, comms } = world();
    const squad = new OutpostSquad(1, 'Alpha', {} as Outpost);
    const voss = man(squad, soldiers, 0, 'steady');
    const kade = man(squad, soldiers, 1, 'panicked');
    const stranger = man(squad, soldiers, 2, 'steady', false);
    man(squad, soldiers, 3, 'steady');
    w.now = 100;
    comms.say('manDown', kade, voss);
    expect(heard[0]!.text).toContain('Voss');
    expect(RULES[heard[0]!.row!]!.id).toContain('.buddy.');
    // Kade is neither the stranger's buddy nor the leader.
    w.now = 200;
    comms.say('manDown', kade, stranger);
    expect(heard[1]!.text).not.toContain('Rook');
    expect(heard[1]!.dead).toBe(-1);
  });

  it('cuts a man off mid-word when he dies, and only if he was still talking', () => {
    const { w, events, cuts, soldiers, comms } = world();
    const voss = man(new OutpostSquad(1, 'Alpha', {} as Outpost), soldiers, 0, 'steady');
    comms.say('cutoff', voss);
    w.now = 0.3;
    events.emit('enemy:killed', { enemy: voss.e } as never);
    expect(cuts).toEqual([{ at: Math.floor(0.3 / SPEAK_RATE) }]);
    comms.say('regroup', voss);
    w.now = 30;
    events.emit('enemy:killed', { enemy: voss.e } as never);
    expect(cuts).toHaveLength(1);
  });

  it('lets a critical call cut a tactical one, and makes a lower one wait its turn', () => {
    const { w, heard, cuts, soldiers, comms } = world();
    const squad = new OutpostSquad(1, 'Alpha', {} as Outpost);
    const a = man(squad, soldiers, 0, 'steady');
    const b = man(squad, soldiers, 1, 'steady');
    comms.say('flanking', a);
    w.now = 0.2;
    comms.say('frag', b);
    expect(cuts).toHaveLength(1);
    expect(heard.at(-1)!.kind).toBe('frag');
    w.now = 0.3;
    comms.say('manDown', a, null);
    expect(heard.at(-1)!.kind).toBe('frag');
    // Said once the frag call is over: looked up again when it is due.
    for (let t = 0.4; t < 6; t += 0.1) {
      w.now = t;
      comms.update();
    }
    const kinds = heard.map(l => l.kind);
    expect(kinds).toContain('manDown');
    // "Frag out!" brings an answer from another man.
    expect(kinds).toContain('ack' satisfies CommsKind);
  });

  it('keeps a co-op guest quiet: the host decides every line', () => {
    const { heard, soldiers, comms } = world(false);
    comms.say('contact', man(new OutpostSquad(1, 'Alpha', {} as Outpost), soldiers, 0, 'steady'));
    comms.relay('Words.', null, 'Command');
    expect(heard).toHaveLength(0);
  });
});
