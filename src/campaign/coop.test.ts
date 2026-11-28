/**
 * Nothing a mission can do is left unclassified for co-op. These fail when someone adds a host operation, a step, a `call`, a cue or
 * an event trigger without saying where it happens (coop.ts) and carrying it (net/mission.ts).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MIRRORED, REPORTS } from '../net/mission';
import { CALLS, CUES, EVENTS, OPS, TRIGGERS, arrivalZones, countedGuns, matches, plainFields, playerEvents, steps, triggers, type HostOp } from './coop';
import { DEPRECATION } from './missions/deprecation';
import { FORECLOSURE } from './missions/foreclosure';
import { OUTPOST } from './missions/outpost';
import type { Step, Trigger } from './types';

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');
const HOST = read('./host.ts');
const WAR = read('./war.ts');
const NET = read('../net/mission.ts');

/** The host operations each step ends in. A new step is a compile error here until it names its own. */
const STEP_OPS = {
  say: ['speak', 'hush'],
  objective: ['objectives'],
  done: ['objectives'],
  hint: ['hint'],
  banner: ['banner'],
  door: ['door'],
  squad: ['squad'],
  release: ['release'],
  sweep: ['sweep'],
  drill: ['drill', 'speak'],
  place: ['place'],
  vehicle: ['vehicle'],
  boss: ['boss'],
  give: ['give'],
  grenades: ['grenades'],
  rack: ['rack'],
  drop: ['drop'],
  // These three never leave the runner: its own clock, its own triggers (below), its own signals.
  wait: [],
  until: [],
  signal: [],
  cutscene: ['cutscene', 'hush'],
  ride: ['ride'],
  sortie: ['sortie'],
  frame: ['frame'],
  roster: ['roster'],
  callins: ['callins'],
  battle: ['battle'],
  stop: ['stop'],
  adapt: ['adapt'],
  field: ['field'],
  threat: ['threat'],
  music: ['music'],
  call: ['call'],
  goto: ['saved', 'deploy'],
  finish: ['finished'],
} as const satisfies Record<Step['do'], readonly HostOp[]>;

/** The key that names each kind of trigger: every key of the union, less the ones that only narrow a kind. */
type KeysOf<T> = T extends unknown ? keyof T : never;
type TriggerKind = Exclude<KeysOf<Trigger>, 'outside' | 'tag' | 'by' | 'where' | 'under'>;

/** Every kind of trigger has a rule for whom it counts. A new kind is a compile error here until it has one. */
const TRIGGER_RULES = {
  zone: ['zone', 'zone outside', 'zone that ends a section'],
  after: ['after'],
  kills: ['kills'],
  cleared: ['cleared'],
  left: ['left'],
  below: ['below'],
  // The three that only combine others.
  not: [],
  all: [],
  any: [],
  signal: ['signal'],
  event: ['event'],
  ammo: ['ammo'],
} as const satisfies Record<TriggerKind, readonly string[]>;

const casesOf = (source: string, method: RegExp): string[] => {
  const start = source.search(method);
  expect(start).toBeGreaterThan(-1);
  // To the end of the method: the first line that closes at its indent.
  const body = source.slice(start, source.indexOf('\n  }\n', start));
  return [...body.matchAll(/case '([\w.]+)':/g)].map(m => m[1]!);
};

describe('co-op: every mission operation has a class', () => {
  it('names an operation of the host for every step, and every one of those has a row', () => {
    for (const ops of Object.values(STEP_OPS)) for (const op of ops) expect(OPS[op], op).toBeDefined();
    for (const rule of Object.values(OPS)) expect(rule.why.length, rule.why).toBeGreaterThan(8);
  });

  it('puts every mirrored and shared operation on the wire, and nothing of the host\'s own', () => {
    const carried = Object.entries(OPS).filter(([, rule]) => rule.class !== 'host').map(([op]) => op).sort();
    // The Frame's stand-in goes as a cue (its banner) and a place (the eject's landing).
    expect([...MIRRORED, 'frame'].sort()).toEqual(carried);
    for (const op of MIRRORED) expect(OPS[op].class, op).not.toBe('host');
    // A guest plays each of them, and the host wraps each of them.
    const played = casesOf(NET, /private play\(/);
    for (const op of MIRRORED) {
      expect(played, `net/mission.ts play() has no case for ${op}`).toContain(op);
      expect(NET, `net/mission.ts wrap() does not send ${op}`).toMatch(new RegExp(`parts\\.${op} = |'${op}'[^\\n]*\\] as const\\) \\{`));
    }
    for (const op of ['beat', 'reset', 'taken']) expect(played).toContain(op);
    // What a guest may tell the host, and nothing else.
    expect(casesOf(NET, /private report\(/).sort()).toEqual([...REPORTS].sort());
  });

  it('classes every `call` the host knows, and every one a mission makes', () => {
    const known = casesOf(HOST, /^ {2}call\(name: string/m);
    expect(known.sort()).toEqual(Object.keys(CALLS).sort());
    for (const mission of [OUTPOST, FORECLOSURE, DEPRECATION]) {
      steps(mission, step => {
        if (step.do === 'call') expect(CALLS[step.name], `${mission.id}: call ${step.name}`).toBeDefined();
      });
    }
  });

  it('knows every cue a set piece sends, and a guest plays every one', () => {
    const sent = new Set<string>();
    for (const source of [HOST, WAR, NET]) for (const m of source.matchAll(/cue\??\.?\(\s*'(\w+)'|op: 'cue', args: \['(\w+)'/g)) sent.add(m[1] ?? m[2]!);
    expect([...sent].sort()).toEqual(Object.keys(CUES).sort());
    const shown = casesOf(HOST, /^ {2}show\(name: string/m);
    expect(shown.sort()).toEqual(Object.keys(CUES).sort());
  });

  it('says for every event a mission waits on whether it is a player\'s or the world\'s', () => {
    for (const mission of [OUTPOST, FORECLOSURE, DEPRECATION]) {
      triggers(mission, t => {
        if ('event' in t) expect(EVENTS[t.event], `${mission.id}: event ${t.event}`).toBeDefined();
      });
    }
  });

  it('has a rule for how each kind of trigger counts players', () => {
    for (const rules of Object.values(TRIGGER_RULES)) for (const rule of rules) expect(TRIGGERS[rule], rule).toBeDefined();
  });
});

describe('co-op: reading a mission', () => {
  it('finds what the Outpost waits on from a player, and the gun it counts rounds for', () => {
    expect(playerEvents(OUTPOST)).toEqual([
      { event: 'weapon:unlocked', where: { weapon: 'shotgun' } },
      { event: 'weapon:fired', where: null },
    ]);
    expect(countedGuns(OUTPOST)).toEqual(['rocket']);
    expect(playerEvents(FORECLOSURE)).toEqual([]);
    expect(countedGuns(FORECLOSURE)).toEqual([]);
  });

  it('finds the zones that end a section: where the team regroups', () => {
    expect(arrivalZones(OUTPOST)).toEqual(['easternApron', 'sallyHall', 'northCorridor', 'coolantNear', 'coolantFar', 'galleryFar', 'stackTop']);
    expect(arrivalZones(FORECLOSURE)).toEqual(['westGate']);
  });

  it('sends only an event\'s plain fields, and compares them as the runner does', () => {
    const payload = { weapon: 'shotgun', n: 3, on: true, at: { x: 1 }, list: [1], long: 'x'.repeat(41), nan: Number.NaN };
    expect(plainFields(payload)).toEqual({ weapon: 'shotgun', n: 3, on: true });
    expect(plainFields(null)).toEqual({});
    expect(matches(payload, { weapon: 'shotgun' })).toBe(true);
    expect(matches(payload, { weapon: 'smg' })).toBe(false);
    expect(matches(undefined, null)).toBe(true);
  });
});
