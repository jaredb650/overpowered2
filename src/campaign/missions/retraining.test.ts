/** Retraining's skeleton: clean names, the stations in order, and a bot that ends every beat, from the top and from any station. */
import { describe, expect, it } from 'vitest';
import type { GameEvents } from '../../core/contracts';
import { isFirstLaunch, markPlayed, markRetrainingSeen, SEEN_KEY } from '../../contracts/firstLaunch';
import { MissionRunner } from '../runner';
import { FakeHost } from '../testkit';
import type { Trigger } from '../types';
import { validateMission } from '../validate';
import { SHACKS, TOWN, TOWN_HOUSES, TOWN_SUBJECTS } from '../../world/map/annex/plan';
import { RETRAINING } from './retraining';
import { RETRAINING_LINES } from './retraining.lines';

const FRAME = 1 / 30;

const ORDER = [
  'intake', 'crouch', 'slide', 'dash', 'wallrun', 'chimney', 'slam', 'rocket',
  'jet', 'lane', 'armour', 'shop', 'ap', 'grenade', 'stim', 'blade', 'energy', 'sonar', 'kata',
  'surrender', 'question', 'release', 'capture', 'balcony', 'nuke', 'after',
];

/** Does what the trigger waits for: stands in its zone, raises its signal or event, takes the men off a tag. */
function satisfy(t: Trigger, host: FakeHost, run: MissionRunner): void {
  if ('zone' in t) {
    const z = run.zone(t.zone);
    host.feet = { x: (z.min[0] + z.max[0]) / 2, y: (z.min[1] + z.max[1]) / 2, z: (z.min[2] + z.max[2]) / 2 };
  } else if ('signal' in t) {
    if (t.signal !== 'never') run.signal(t.signal);
  } else if ('event' in t) {
    host.bus.emit(t.event as keyof GameEvents, { ...(t.where ?? {}) } as never);
  } else if ('cleared' in t || 'left' in t) {
    const tags = 'left' in t ? [t.tag] : typeof t.cleared === 'string' ? [t.cleared] : t.cleared;
    for (const tag of tags) for (let i = run.left(tag); i > 0; i--) run.unitGone(tag, true, 'smg');
  } else if ('all' in t) for (const part of t.all) satisfy(part, host, run);
  else if ('any' in t) satisfy(t.any[0]!, host, run);
}

function playThrough(from?: string): string[] {
  const host = new FakeHost();
  const run = new MissionRunner(RETRAINING, host);
  const beats: string[] = [];
  run.start(from);
  for (let t = 0; t < 600 && run.state === 'running'; t += FRAME) {
    const beat = run.beat!;
    if (beats[beats.length - 1] !== beat.id) beats.push(beat.id);
    if (beat.id === 'after') break;
    host.doorDone?.();
    if (beat.until) satisfy(beat.until, host, run);
    run.update(FRAME);
  }
  return beats;
}

describe('Retraining', () => {
  it('has no dangling names, and every line it says exists', () => {
    expect(validateMission(RETRAINING)).toEqual([]);
    const ids = new Set(RETRAINING_LINES.map(l => l.id));
    const said = JSON.stringify(RETRAINING.beats).match(/mission\.council\.tut\.[\w.]+/g) ?? [];
    for (const id of said) expect(ids.has(id), id).toBe(true);
  });

  it('plays its stations in order, each once, to the door', () => {
    expect(playThrough()).toEqual(ORDER);
  });

  it('starts cold at every checkpointed station', () => {
    const checkpoints = RETRAINING.beats.filter(b => b.checkpoint).map(b => b.id);
    expect(checkpoints).toEqual(['intake', 'dash', 'rocket', 'lane', 'blade', 'sonar', 'surrender', 'balcony']);
    for (const id of checkpoints) expect(playThrough(id)[0]).toBe(id);
  });

  it('places all 20 shantytown subjects inside town bounds and clear of buildings', () => {
    expect(TOWN_SUBJECTS).toHaveLength(20);
    for (const [sx, sz] of TOWN_SUBJECTS) {
      expect(sx).toBeGreaterThan(TOWN.x0);
      expect(sx).toBeLessThan(TOWN.x1);
      expect(sz).toBeGreaterThan(TOWN.z0);
      expect(sz).toBeLessThan(TOWN.z1);
      // Clear of central fountain at (TOWN.cx, TOWN.cz)
      expect(Math.hypot(sx - TOWN.cx, sz - TOWN.cz)).toBeGreaterThan(3.2);
      // Clear of every multi-piece shanty house
      for (const [hx, hz, hw, hd] of TOWN_HOUSES) {
        const inside = Math.abs(sx - hx) < hw / 2 + 0.5 && Math.abs(sz - hz) < hd / 2 + 0.5;
        expect(inside, `subject (${sx},${sz}) clips house (${hx},${hz})`).toBe(false);
      }
      // Clear of every shack
      for (const [kx, kz] of SHACKS) {
        expect(Math.hypot(sx - kx, sz - kz), `subject (${sx},${sz}) too close to shack (${kx},${kz})`).toBeGreaterThan(2.6);
      }
    }
  });
});

describe('first launch', () => {
  const fake = (keys: Record<string, string> = {}) => {
    const map = new Map(Object.entries(keys));
    return {
      get length() { return map.size; },
      key: (i: number) => [...map.keys()][i] ?? null,
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      map,
    };
  };

  it('is a first launch only with nothing a player writes', () => {
    expect(isFirstLaunch(fake())).toBe(true);
    expect(isFirstLaunch(fake({ op2_browser: '1', op2_coop_name: 'Ash', 'op2.lab.v1.dev': '{}', 'op2.cheats.v1': '{}' }))).toBe(true);
    expect(isFirstLaunch(fake({ 'op2_highscore.outpost': '900' }))).toBe(false);
    expect(isFirstLaunch(fake({ 'op2.settings.v1': '{}' }))).toBe(false);
    expect(isFirstLaunch(null)).toBe(false);
  });

  it('stops being one once played, or once Retraining is seen', () => {
    const a = fake();
    markPlayed(a);
    expect(isFirstLaunch(a)).toBe(false);
    const b = fake();
    markRetrainingSeen('crouch', b);
    expect(isFirstLaunch(b)).toBe(false);
    expect(JSON.parse(b.map.get(SEEN_KEY)!)).toEqual({ seen: true, finished: false, left: 'crouch' });
  });
});
