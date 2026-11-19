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
import { cardinal, contactReport, radioLoss } from './radio';
import { breaking, revenge, tickOutcomes } from './outcomes';
import { FAKE_RANGE, FUMBLE_SECONDS, plotting } from '../flight';
import { HABIT_AT, PlayerMemory, rememberPlayer } from './memory';
import { Offers } from './offers';
import { VOICE_COUNT } from './voices';
import * as THREE from 'three';
import { OutpostSquad } from '../squad';
import { RULES } from './lines';
import { NAME_LIST, NAME_POOLS, NameRoll, callName, poolOf, speakerTag } from './names';
import { ChatterMemory, SPEAK_RATE, TIER_OF, rowsFor, type ChatterFacts, type Tier } from './rules';

vi.mock('../../attacks', async original => ({ ...(await original<object>()), say: vi.fn(), shout: vi.fn() }));

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

describe('the radio net', () => {
  function net() {
    const timers: (() => void)[] = [];
    const comms = { say: vi.fn(), silence: vi.fn(), after: (_: number, run: () => void) => timers.push(run) };
    const o = { w: { player: { position: new THREE.Vector3(0, 0, 40) } }, squads: [] as OutpostSquad[], comms, scare: vi.fn(), memory: new PlayerMemory() };
    const squad = (name: string, roles: string[], z: number) => {
      const q = new OutpostSquad(o.squads.length + 1, name, o as unknown as Outpost);
      for (const role of roles) {
        const s = new Soldier();
        s.role = role as Soldier['role'];
        s.e = { position: new THREE.Vector3(0, 0, z) } as unknown as Soldier['e'];
        q.join(s);
      }
      o.squads.push(q);
      return q;
    };
    return { o, timers, comms, squad };
  }

  it('reads the compass with north as -z', () => {
    expect([cardinal(0, -1), cardinal(1, 0), cardinal(0, 1), cardinal(-1, 0), cardinal(1, -1)]).toEqual(['north', 'east', 'south', 'west', 'north-east']);
  });

  it('gives the radio to the first rifleman who is not the leader, and reports contact to the nearest other squad', () => {
    const { o, comms, squad } = net();
    const charlie = squad('Charlie', ['machinegun', 'rifle', 'rifle'], 0);
    squad('Bravo', ['shotgun', 'rifle'], 10);
    const op = charlie.radioman!;
    expect(op.role).toBe('rifle');
    expect(op).not.toBe(charlie.leader);
    contactReport(o as unknown as Outpost, charlie);
    expect(comms.say).toHaveBeenCalledWith('contactReport', op, null, { slots: { squad: 'Charlie', to: 'Bravo', range: '40 metres', cardinal: 'south' } });
  });

  it('looks for a dead operator on the net, and loses the squad when nobody answers', () => {
    const { o, timers, comms, squad } = net();
    const charlie = squad('Charlie', ['rifle', 'rifle'], 0);
    const bravo = squad('Bravo', ['rifle', 'rifle'], 10);
    const op = charlie.radioman!;
    charlie.leave(op);
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.99);
    radioLoss(o as unknown as Outpost, charlie, op);
    for (const t of timers) t();
    random.mockRestore();
    expect(comms.say.mock.calls.map(c => c[0])).toEqual(['sayAgain', 'radioCheck', 'radioLost']);
    expect(comms.say.mock.calls[0]![1]).toBe(bravo.radioman);
    expect(o.scare).toHaveBeenCalled();
  });

  it('has a survivor pick the set up, or reports the squad wiped', () => {
    const { o, timers, comms, squad } = net();
    const charlie = squad('Charlie', ['rifle', 'rifle', 'rifle'], 0);
    squad('Bravo', ['rifle', 'rifle'], 10);
    const op = charlie.radioman!;
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.1);
    radioLoss(o as unknown as Outpost, charlie, op);
    for (const t of timers) t();
    random.mockRestore();
    expect(comms.say.mock.calls.at(-1)![0]).toBe('radioGrab');
    expect(charlie.radioman).not.toBe(op);
    charlie.members.length = 0;
    radioLoss(o as unknown as Outpost, charlie, null);
    expect(comms.say.mock.calls.at(-1)![0]).toBe('squadWiped');
  });
});

describe('morale outcomes', () => {
  function setup() {
    const timers: (() => void)[] = [];
    const comms = { say: vi.fn(), silence: vi.fn(), after: (_: number, run: () => void) => timers.push(run) };
    const spawnProjectile = vi.fn();
    const o = {
      comms, soldiers: [] as Soldier[], memory: new PlayerMemory(),
      w: { now: 0, telegraphs: { zone: vi.fn(), glint: vi.fn() }, ctx: { player: { health: 100, maxHealth: 100 }, audio: { play: vi.fn() }, combat: { spawnProjectile } } },
    };
    const squad = new OutpostSquad(1, 'Alpha', o as unknown as Outpost);
    const man = () => {
      const s = new Soldier();
      squad.join(s);
      s.e = { alive: true, dist: 5, hasLos: true, damageMul: 1, center: new THREE.Vector3(), char: { anim: { play: vi.fn() } } } as unknown as Soldier['e'];
      o.soldiers.push(s);
      return s;
    };
    return { o: o as unknown as Outpost, comms, timers, spawnProjectile, squad, man };
  }

  it('rarely, and said aloud, a man refuses to break; otherwise a runner says he is going', () => {
    const { o, comms, man } = setup();
    const s = man();
    s.rank = 'elite';
    let random = vi.spyOn(Math, 'random').mockReturnValue(0.01);
    expect(breaking(o, s, 'flee')).toBe(true);
    expect(comms.say).toHaveBeenLastCalledWith('holdout', s);
    expect(s.holdout).toBe(true);
    random.mockRestore();
    const t = man();
    random = vi.spyOn(Math, 'random').mockReturnValue(0.99);
    expect(breaking(o, t, 'flee')).toBe(false);
    expect(comms.say).toHaveBeenLastCalledWith('flee', t);
    random.mockRestore();
  });

  it('a fake surrender waits for the player to come close, fumbles at his vest (the tell), then the shout, the pin and the grenade', () => {
    const { o, comms, spawnProjectile, man } = setup();
    const s = man();
    s.surrendered = true;
    s.surrenderedAt = 0;
    s.grenades = 1;
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.01);
    tickOutcomes(o, 5);
    random.mockRestore();
    expect(s.fake).toBe('waiting');
    // Not close enough to take him yet: nothing happens.
    plotting(o, s, 5);
    expect(s.fake).toBe('waiting');
    s.e.dist = FAKE_RANGE - 1;
    plotting(o, s, 6);
    expect(s.fake).toBe('fumbling');
    expect(o.w.telegraphs.glint).toHaveBeenCalledOnce();
    expect(o.w.ctx.audio.play).toHaveBeenCalledWith('gear_rustle', expect.anything());
    expect(comms.say).not.toHaveBeenCalledWith('fakeOut', s);
    plotting(o, s, 6 + FUMBLE_SECONDS);
    expect(comms.say).toHaveBeenCalledWith('fakeOut', s);
    expect(spawnProjectile).not.toHaveBeenCalled();
    plotting(o, s, 6 + FUMBLE_SECONDS + 1);
    expect(spawnProjectile).toHaveBeenCalledOnce();
    // Rolled once: never again for him.
    tickOutcomes(o, 10);
    expect(s.fake).toBe(null);
    expect(comms.say.mock.calls.filter(c => c[0] === 'fakeOut')).toHaveLength(1);
  });

  it('a man taken into cuffs while he fumbles never gets the pin out', () => {
    const { o, comms, spawnProjectile, man } = setup();
    const s = man();
    s.surrendered = true;
    s.grenades = 1;
    s.fake = 'waiting';
    s.e.dist = 2;
    plotting(o, s, 1);
    s.cuffed = true;
    plotting(o, s, 1 + FUMBLE_SECONDS + 2);
    expect(comms.say).not.toHaveBeenCalledWith('fakeOut', s);
    expect(spawnProjectile).not.toHaveBeenCalled();
  });

  it('takes a buddy\'s death out on the player, sometimes, and talks big while his nerve goes', () => {
    const { o, comms, squad, man } = setup();
    const a = man();
    const b = man();
    const open = vi.spyOn(squad, 'opening');
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.01);
    revenge(o, a, b);
    expect(comms.say).toHaveBeenLastCalledWith('revenge', a, b, null);
    expect(open).toHaveBeenCalled();
    a.bravado = true;
    a.state = 'shaken';
    a.sees = true;
    tickOutcomes(o, 1);
    random.mockRestore();
    expect(comms.say).toHaveBeenLastCalledWith('taunt', a, null, { flags: { bravado: true } });
  });
});

describe('memory of the player, this match only', () => {
  it('notices a habit once, adapts, says why, and forgets it all with the run', () => {
    const events = new EventBus<GameEvents>();
    const comms = { say: vi.fn() };
    const doctrine = { spacing: 2.2, stacks: true, keepOut: 0 };
    const o = { w: { ctx: { events }, player: { position: new THREE.Vector3() } }, memory: new PlayerMemory(), doctrine, comms, squads: [] as OutpostSquad[] };
    const squad = new OutpostSquad(1, 'Alpha', o as unknown as Outpost);
    const lead = new Soldier();
    squad.join(lead);
    Object.defineProperty(squad, 'inContact', { value: true });
    o.squads.push(squad);
    rememberPlayer(o as unknown as Outpost);
    const kill = () => {
      const s = new Soldier();
      s.e = { position: new THREE.Vector3() } as unknown as Soldier['e'];
      enlist(s.e, s);
      events.emit('enemy:killed', { enemy: s.e, headshot: false, damage: { source: 'smg', type: 'explosive' } } as never);
    };
    for (let i = 0; i < HABIT_AT * 2; i++) kill();
    expect(comms.say.mock.calls.filter(c => c[0] === 'habit')).toEqual([['habit', lead, null, { flags: { blasts: true } }]]);
    expect(doctrine.spacing).toBeGreaterThan(5);
    expect(doctrine.stacks).toBe(false);
    o.memory.reset();
    expect(o.memory.counts.blasts).toBe(0);
    expect(o.memory.noticed.size).toBe(0);
  });
});

describe('the shield wall: an offer across squads', () => {
  it('calls it, takes claims from any squad, breaks the shotguns out close, and scatters when the shield goes', () => {
    const comms = { say: vi.fn() };
    const o = { w: { player: { position: new THREE.Vector3(0, 0, -15) }, ctx: { world: { nav: { nearest: () => true } } } }, soldiers: [] as Soldier[], comms, order: vi.fn(), scare: vi.fn() };
    const squad = (n: number) => {
      const q = new OutpostSquad(n, n === 1 ? 'Alpha' : 'Bravo', o as unknown as Outpost);
      Object.defineProperty(q, 'inContact', { value: true });
      return q;
    };
    const alpha = squad(1);
    const bravo = squad(2);
    const man = (q: OutpostSquad, role: Soldier['role'], x: number) => {
      const s = new Soldier();
      s.role = role;
      q.join(s);
      // Facing -z, at the player.
      s.e = { alive: true, shield: role === 'shield', dist: 15, yaw: Math.PI, position: new THREE.Vector3(x, 0, 0) } as unknown as Soldier['e'];
      o.soldiers.push(s);
      return s;
    };
    const wall = man(alpha, 'shield', 0);
    const rifle = man(bravo, 'rifle', 3);
    const gun = man(bravo, 'shotgun', -3);
    const offers = new Offers();
    offers.tick(o as unknown as Outpost, 0);
    expect(comms.say.mock.calls.map(c => c[0])).toEqual(['shieldUp', 'stackOn', 'shieldPush']);
    expect(offers.cover[0]!.claims).toEqual([rifle, gun]);
    // His stack is placed behind him: +z, away from the player.
    const placed = o.order.mock.calls.filter(c => c[0] !== wall);
    expect(placed.length).toBe(2);
    for (const c of placed) expect(c[1].z).toBeGreaterThan(0);
    (wall.e as { dist: number }).dist = 5;
    offers.tick(o as unknown as Outpost, 1);
    expect(comms.say).toHaveBeenCalledWith('breakOut', gun);
    expect(offers.cover[0]!.claims).toEqual([rifle]);
    (wall.e as { shield: boolean }).shield = false;
    offers.tick(o as unknown as Outpost, 2);
    expect(comms.say).toHaveBeenLastCalledWith('shieldDown', rifle);
    expect(o.scare).toHaveBeenCalled();
    expect(offers.cover).toHaveLength(0);
  });
});

describe('one voice per man, for life', () => {
  it('deals the voices in turn through a squad, and buddies never share one', () => {
    const squad = new OutpostSquad(1, 'Alpha', {} as Outpost);
    const men = Array.from({ length: 6 }, () => new Soldier());
    for (const s of men) squad.join(s);
    expect(men.map(s => s.voice)).toEqual([0, 1, 0, 1, 0, 1]);
    for (const s of men) if (s.buddy?.buddy === s) expect(s.voice).not.toBe(s.buddy.voice);
    expect(VOICE_COUNT).toBe(2);
  });

  it('never changes his voice: not across many lines, a new squad, or the radio', () => {
    const events = new EventBus<GameEvents>();
    const heard: CommsLine[] = [];
    events.on('comms:line', l => heard.push({ ...l }));
    const soldiers: Soldier[] = [];
    const w = {
      now: 0, player: { position: { x: 0, y: 0, z: -10 }, velocity: { x: 0, y: 0, z: 0 }, speed: 0 },
      enemies: { outpost: { doctrine: { radioSilence: false }, soldiers, squads: [] } },
      ctx: { events, player: { health: 100, maxHealth: 100 } },
    } as unknown as AiWorld;
    const comms = new Comms(w);
    const alpha = new OutpostSquad(1, 'Alpha', {} as Outpost);
    const bravo = new OutpostSquad(2, 'Bravo', {} as Outpost);
    const body = () => ({ alive: true, maxHealth: 100, yaw: 0, center: { x: 0, y: 1, z: 0 }, position: { x: 0, y: 0, z: 0, distanceToSquared: () => 1 }, def: { voice: { attack: 'x' } } }) as unknown as Soldier['e'];
    const recruit = () => {
      const m = new Soldier();
      m.e = body();
      soldiers.push(m);
      return m;
    };
    const s = recruit();
    alpha.join(recruit());
    alpha.join(s);
    const voice = s.voice;
    const kinds = ['contact', 'moving', 'hit', 'scream', 'reloading', 'covering', 'frag', 'manDown', 'set', 'flanking'] as const;
    for (let i = 0; i < 60; i++) {
      w.now = i * 7;
      if (i === 20) {
        // Merged into another squad that already has a man of each voice.
        alpha.leave(s);
        bravo.join(recruit());
        bravo.join(s);
      }
      if (i === 40) s.squad.radioman = s;
      comms.say(kinds[i % kinds.length]!, s);
    }
    expect(heard.length).toBeGreaterThan(20);
    expect(new Set(heard.map(l => l.voice))).toEqual(new Set([voice]));
  });
});
