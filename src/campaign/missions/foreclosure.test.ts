/** Foreclosure's skeleton: its names, its sixteen beats in the plan's order, and every beat played to the end by a bot, from the top, after a death, and from any beat. */
import { describe, expect, it } from 'vitest';
import { MissionRunner } from '../runner';
import { FakeHost } from '../testkit';
import type { Trigger } from '../types';
import { validateMission } from '../validate';
import { FORECLOSURE } from './foreclosure';
import { REUSED } from './foreclosure.lines';

const FRAME = 1 / 30;
const GIVE_UP_SECONDS = 1200;

/** docs/proposals/mission-2-plan.md, "The shape". */
const PLAN_BEATS = [
  'briefing', 'overwatch', 'landing', 'wall', 'market', 'courier', 'stacks', 'quay',
  'slip', 'mount', 'foreclosure', 'flak', 'pans', 'mother', 'deck', 'ending',
];

function zones(t: Trigger, out: string[]): void {
  if ('zone' in t && !t.outside) out.push(t.zone);
  if ('all' in t) for (const part of t.all) zones(part, out);
  if ('any' in t) for (const part of t.any) zones(part, out);
}

interface Seen {
  /** The squad and the sky as each beat opened. */
  roster: string;
  sky: boolean;
}

/** Finishes every film, ride, sortie and Frame act, takes every rack, walks to every zone wanted and kills whatever is left. */
function playThrough(die: (beat: string) => boolean, from?: string): { host: FakeHost; run: MissionRunner; beats: string[]; seen: Map<string, Seen> } {
  const host = new FakeHost();
  const run = new MissionRunner(FORECLOSURE, host);
  const beats: string[] = [];
  const seen = new Map<string, Seen>();
  run.start(from);
  for (let t = 0; t < GIVE_UP_SECONDS && run.state === 'running'; t += FRAME) {
    const beat = run.beat!;
    if (beats[beats.length - 1] !== beat.id) {
      beats.push(beat.id);
      if (!seen.has(beat.id)) seen.set(beat.id, { roster: host.rosterMen.join(','), sky: host.skyHeld });
    }
    if (die(beat.id)) {
      run.down();
      run.redeploy();
      continue;
    }
    for (const done of ['cutsceneDone', 'rideDone', 'sortieDone', 'frameDone', 'doorDone'] as const) {
      const fn = host[done];
      host[done] = null;
      (fn as ((skipped?: boolean) => void) | null)?.(false);
    }
    for (const took of host.racks.splice(0)) took();
    const want: string[] = [];
    if (beat.until) zones(beat.until, want);
    for (const cue of beat.cues ?? []) zones(cue.when, want);
    if (want.length > 0) {
      const zone = FORECLOSURE.zones[want[Math.floor(t * 2) % want.length]!]!;
      host.feet = { x: (zone.min[0] + zone.max[0]) / 2, y: (zone.min[1] + zone.max[1]) / 2, z: (zone.min[2] + zone.max[2]) / 2 };
    }
    for (const [tag, left] of Object.entries(run.describe().tags as Record<string, string>)) if (!left.startsWith('0/')) run.unitGone(tag, true, 'rocket');
    host.bodies = 0;
    run.update(FRAME);
  }
  return { host, run, beats, seen };
}

describe('Foreclosure', () => {
  it('has no dangling names', () => {
    expect(validateMission(FORECLOSURE)).toEqual([]);
  });

  it('has the plan\'s sixteen beats, in its order', () => {
    expect(FORECLOSURE.beats.map(b => b.id)).toEqual(PLAN_BEATS);
  });

  it('keeps its own words under its own ids, and the Outpost\'s takes under theirs', () => {
    for (const line of FORECLOSURE.lines) {
      if ((REUSED as readonly string[]).includes(line.id)) continue;
      expect(line.id).toMatch(/^mission\.foreclosure\.(council|harbour|radio)\.[a-z.]+$/);
    }
    for (const id of REUSED) expect(FORECLOSURE.lines.some(l => l.id === id), id).toBe(true);
  });

  it('can be played from the first beat to the last, through every beat, in order', () => {
    const { host, run, beats } = playThrough(() => false);
    expect(run.state).toBe('won');
    expect(host.finishedCount).toBe(1);
    expect(beats).toEqual(PLAN_BEATS);
    expect(host.log).toContain('battle eastStreet 4v3');
    expect(host.log).toContain('stop eastStreet');
    expect(host.log.filter(l => l.startsWith('frame '))).toEqual(['frame kneel', 'frame board', 'frame board', 'frame board', 'frame eject']);
  });

  it('can still be finished after dying once in every beat', () => {
    const died = new Set<string>();
    const { run } = playThrough(beat => {
      if (died.has(beat)) return false;
      died.add(beat);
      return true;
    });
    expect(run.state).toBe('won');
    expect(run.deaths).toBe(PLAN_BEATS.length);
  });

  it('can be started from any beat and finished', () => {
    for (const beat of PLAN_BEATS) {
      const { host, run, beats } = playThrough(() => false, beat);
      expect(beats[0], beat).toBe(beat);
      expect(host.deployed, beat).not.toBeNull();
      expect(run.state, beat).toBe('won');
    }
  });

  it('says the squad and the sky at every checkpoint, so a restart there has what the mission had', () => {
    const { seen } = playThrough(() => false);
    for (const beat of FORECLOSURE.beats) {
      if (!beat.checkpoint) continue;
      // A restart is a run rebuilt with nobody in it, so what the beat says as it opens is all the player gets back.
      const host = new FakeHost();
      new MissionRunner(FORECLOSURE, host).start(beat.id);
      expect({ roster: host.rosterMen.join(','), sky: host.skyHeld }, beat.id).toEqual(seen.get(beat.id));
    }
  });
});
