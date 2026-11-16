import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../../core/events';
import type { GameEvents } from '../../../core/contracts';
import { mulberry32 } from '../../../core/math';
import type { AiWorld } from '../../aiWorld';
import { Comms } from '../comms';
import type { CommsKind, CommsLine } from '../events';
import type { Outpost } from '../index';
import type { MoraleState } from '../morale';
import { enlist, Soldier } from '../soldier';
import { listenForWounds } from './reactions';
import { GUN_DOWN_HOLD, listenToEachOther } from './listeners';
import * as THREE from 'three';
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
    const ported = RULES.filter(r => r.id.includes('.scared.'));
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
        // A concept only one role says (the rocketeer's "Rocket out!") is checked as that role.
        const rows = rowsFor(concept, 'garrison');
        const role = rows.every(i => RULES[i]!.unit) ? RULES[rows[0]!]!.unit![0]! : 'rifle';
        const n = rows.filter(i => Object.keys(RULES[i]!.criteria).length === 0 && RULES[i]!.morale_tier.includes(tier) && (!RULES[i]!.unit || RULES[i]!.unit!.includes(role))).length;
        expect(n, `${concept} ${tier}`).toBeGreaterThanOrEqual(3);
        expect(new ChatterMemory().pick(concept, { ...facts(tier), role }, 0, () => 0.99), `${concept} ${tier}`).toBeGreaterThanOrEqual(0);
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
      const pool = rowsFor(concept, 'garrison').filter(i => RULES[i]!.morale_tier.includes(tier) && Object.keys(RULES[i]!.criteria).length === 0 && !RULES[i]!.unit);
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
      now: 0, player: { position: { x: 0, y: 0, z: -10 }, velocity: { x: 0, y: 0, z: 0 }, speed: 0 },
      enemies: { outpost: { doctrine: { radioSilence: false }, soldiers } },
      ctx: { events, player: { health: 100, maxHealth: 100 }, coop: hosting ? undefined : { world: {}, hosting: false } },
    } as unknown as AiWorld;
    return { w, events, heard, cuts, soldiers, comms: new Comms(w) };
  }
  function man(squad: OutpostSquad, soldiers: Soldier[], name: number, state: MoraleState, known = true): Soldier {
    const s = new Soldier();
    squad.join(s);
    s.name = name;
    s.known = known;
    s.state = state;
    s.e = {
      alive: true, maxHealth: 100, yaw: 0, center: { x: 0, y: 1, z: 0 }, position: { x: 0, y: 0, z: 0, distanceToSquared: () => 1 }, def: { voice: { attack: 'x' } },
    } as unknown as Soldier['e'];
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
    comms.say('lastStand', b);
    expect(cuts).toHaveLength(1);
    expect(heard.at(-1)!.kind).toBe('lastStand');
    w.now = 0.3;
    comms.say('manDown', a, null);
    expect(heard.at(-1)!.kind).toBe('lastStand');
    // Said once the critical call is over: looked up again when it is due.
    for (let t = 0.4; t < 5; t += 0.1) {
      w.now = t;
      comms.update();
    }
    expect(heard.map(l => l.kind)).toEqual(['flanking', 'lastStand', 'manDown']);
  });

  it('answers a call: "Frag out!" brings a word from another man once it is said', () => {
    const { w, heard, soldiers, comms } = world();
    const squad = new OutpostSquad(1, 'Alpha', {} as Outpost);
    man(squad, soldiers, 0, 'steady');
    const b = man(squad, soldiers, 1, 'steady');
    comms.say('frag', b);
    for (let t = 0.1; t < 5; t += 0.1) {
      w.now = t;
      comms.update();
    }
    expect(heard.map(l => l.kind)).toEqual(['frag', 'ack' satisfies CommsKind]);
    expect(heard[1]!.speaker).not.toBe(heard[0]!.speaker);
  });

  it('gives the armour, wound and gore events a voice, and has a crawling man call his buddy by name', () => {
    const { w, events, heard, soldiers, comms } = world();
    // No moment left unsaid by chance.
    const quiet = vi.spyOn(Math, 'random').mockReturnValue(0.99);
    listenForWounds(w, comms);
    const squad = new OutpostSquad(1, 'Alpha', {} as Outpost);
    const voss = man(squad, soldiers, 0, 'steady');
    const kade = man(squad, soldiers, 1, 'panicked');
    for (const s of [voss, kade]) {
      (s.e as unknown as { plates: { hp: number }[] }).plates = [{ hp: 10 }];
      (s.injuries as unknown as { condition: string }).condition = 'healthy';
      enlist(s.e, s);
      s.fate = 'none';
    }
    const said = () => RULES[heard.at(-1)!.row!]!;
    const hit = (s: Soldier, armour: string) => events.emit('enemy:hit', { enemy: s.e, damage: { source: 'smg' }, result: { killed: false, dealt: 5, severed: [], armour } } as never);
    w.now = 10;
    hit(voss, 'stopped');
    expect(said().concept).toBe('plateHeld');
    w.now = 20;
    hit(voss, 'broken');
    expect(said().concept).toBe('plateGone');
    w.now = 30;
    events.emit('enemy:severed', { enemy: kade.e, region: 'forearmR' } as never);
    expect(said().concept).toBe('limbLost');
    expect(said().criteria).toEqual({ arm: true });
    w.now = 40;
    events.emit('enemy:wounded', { enemy: voss.e, zone: 'carotid' } as never);
    expect(said().concept).toBe('artery');
    w.now = 50;
    comms.say('scream', kade);
    expect(heard.at(-1)!.text).toContain('Voss');
    expect(heard.at(-1)!.slots).toEqual({ buddy: 'Voss' });
    quiet.mockRestore();
  });

  it('calls where the player is by the clock, from where the speaker faces', () => {
    const { w, heard, soldiers, comms } = world();
    const voss = man(new OutpostSquad(1, 'Alpha', {} as Outpost), soldiers, 0, 'steady');
    // He faces +z; his right is -x, so the player at -x is at three o'clock.
    (w.player.position as { x: number; z: number }).x = -10;
    (w.player.position as { x: number; z: number }).z = 0;
    for (let i = 0; i < 30; i++) {
      w.now = i * 50;
      comms.say('contact', voss);
    }
    const clocked = heard.filter(l => l.slots?.clock);
    expect(clocked.length).toBeGreaterThan(0);
    for (const l of clocked) expect(l.text).toContain("3 o'clock");
    // Behind him: the rear rows win over the plain ones.
    (w.player.position as { x: number; z: number }).x = 0;
    (w.player.position as { x: number; z: number }).z = -10;
    w.now = 5000;
    const quiet = vi.spyOn(Math, 'random').mockReturnValue(0.99);
    comms.say('contact', voss);
    quiet.mockRestore();
    expect(RULES[heard.at(-1)!.row!]!.criteria).toEqual({ behind: true });
  });

  it('keeps a co-op guest quiet: the host decides every line', () => {
    const { heard, soldiers, comms } = world(false);
    comms.say('contact', man(new OutpostSquad(1, 'Alpha', {} as Outpost), soldiers, 0, 'steady'));
    comms.relay('Words.', null, 'Command');
    expect(heard).toHaveLength(0);
  });
});

describe('men hear each other', () => {
  function setup() {
    const events = new EventBus<GameEvents>();
    const soldiers: Soldier[] = [];
    const w = { now: 0, ctx: { events, world: { nav: { nearest: () => true } } } } as unknown as AiWorld;
    const o = { w, soldiers, order: vi.fn(), scare: vi.fn(), callForAid: vi.fn() };
    listenToEachOther(w, o as unknown as Outpost);
    const squad = new OutpostSquad(1, 'Alpha', o as unknown as Outpost);
    const at = (x: number, z: number) => {
      const s = new Soldier();
      squad.join(s);
      s.e = { position: new THREE.Vector3(x, 0, z), yaw: 0 } as unknown as Soldier['e'];
      enlist(s.e, s);
      soldiers.push(s);
      return s;
    };
    const hear = (kind: CommsKind, s: Soldier) => events.emit('comms:line', { kind, text: '', squad: 'Alpha', speaker: '', enemy: s.e, position: s.e.position } as never);
    return { o, squad, at, hear };
  }

  it('gets clear of a frag\'s landing spot, away from it and never onto it', () => {
    const { o, at, hear } = setup();
    const thrower = at(0, -20);
    const near = at(2, 0);
    at(20, 0);
    thrower.throwAt.set(0, 0, 0);
    hear('frag', thrower);
    expect(o.order).toHaveBeenCalledOnce();
    const [who, dest] = o.order.mock.calls[0]!;
    expect(who).toBe(near);
    expect(dest.length()).toBeGreaterThan(6.5);
    expect(dest.x).toBeGreaterThan(2);
  });

  it('steps out of the back blast when the rocket is called', () => {
    const { o, at, hear } = setup();
    const tube = at(0, 0);
    const behind = at(0.5, -2);
    at(0, 3);
    hear('rocketOut', tube);
    expect(o.order).toHaveBeenCalledOnce();
    expect(o.order.mock.calls[0]![0]).toBe(behind);
  });

  it('holds when the gun goes down, and hears a call for help at once', () => {
    const { o, squad, at, hear } = setup();
    const hold = vi.spyOn(squad, 'hold');
    const voice = at(0, 0);
    hear('gunDown', voice);
    expect(hold).toHaveBeenCalledWith(GUN_DOWN_HOLD);
    expect(o.scare).toHaveBeenCalled();
    hear('downed', voice);
    expect(o.callForAid).toHaveBeenCalledOnce();
  });
});
