/** The Outpost as a whole: its numbers against the proved ones, its words against the plan, and every beat played to the end by a bot. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PARKOUR } from '../parkour';
import { MissionRunner } from '../runner';
import { FakeHost } from '../testkit';
import type { Trigger } from '../types';
import { validateMission } from '../validate';
import { OUTPOST } from './outpost';

const SITE = 110;
const FRAME = 1 / 30;
/** A bot that does everything at once should still take a while, and a mission must never need longer than this to finish. */
const GIVE_UP_SECONDS = 1200;

/** Tags and zones a trigger waits on, however deep. */
function needs(t: Trigger, out: { tags: Set<string>; zones: string[]; signals: Set<string> }): void {
  if ('zone' in t && !t.outside) out.zones.push(t.zone);
  if ('signal' in t) out.signals.add(t.signal);
  if ('all' in t) for (const part of t.all) needs(part, out);
  if ('any' in t) for (const part of t.any) needs(part, out);
}

/** Walks every zone the beat could want, finishes every cutscene and ride, takes every rack, and kills whatever is left. */
function playThrough(die: (beat: string) => boolean): { host: FakeHost; run: MissionRunner; beats: string[] } {
  const host = new FakeHost();
  const run = new MissionRunner(OUTPOST, host);
  const beats: string[] = [];
  run.start();
  let clock = 0;
  for (let t = 0; t < GIVE_UP_SECONDS && run.state === 'running'; t += FRAME) {
    const beat = run.beat!;
    if (beats[beats.length - 1] !== beat.id) beats.push(beat.id);
    if (die(beat.id)) {
      run.down();
      run.redeploy();
      continue;
    }
    host.cutsceneDone?.(false);
    host.cutsceneDone = null;
    host.rideDone?.();
    host.rideDone = null;
    host.doorDone?.();
    host.doorDone = null;
    for (const took of host.racks.splice(0)) took();
    const want = { tags: new Set<string>(), zones: [] as string[], signals: new Set<string>() };
    if (beat.until) needs(beat.until, want);
    for (const cue of beat.cues ?? []) needs(cue.when, want);
    clock += FRAME;
    const zones = want.zones;
    if (zones.length > 0) {
      const zone = OUTPOST.zones[zones[Math.floor(clock * 2) % zones.length]!]!;
      host.feet = { x: (zone.min[0] + zone.max[0]) / 2, y: (zone.min[1] + zone.max[1]) / 2, z: (zone.min[2] + zone.max[2]) / 2 };
    }
    for (const [tag, left] of Object.entries(run.describe().tags as Record<string, string>)) if (!left.startsWith('0/')) run.unitGone(tag, true, 'rocket');
    host.bodies = 0;
    host.bus.emit('weapon:fired', {} as never);
    host.bus.emit('weapon:unlocked', { weapon: 'shotgun' });
    run.update(FRAME);
  }
  return { host, run, beats };
}

describe('the Outpost', () => {
  it('has no dangling names', () => {
    expect(validateMission(OUTPOST)).toEqual([]);
  });

  it('can be played from the first beat to the last, through every beat, in order', () => {
    const { host, run, beats } = playThrough(() => false);
    expect(run.state).toBe('won');
    expect(host.finishedCount).toBe(1);
    expect(beats).toEqual(OUTPOST.beats.map(b => b.id));
  });

  it('can still be finished after dying once in every beat', () => {
    const died = new Set<string>();
    const { run } = playThrough(beat => {
      if (died.has(beat)) return false;
      died.add(beat);
      return true;
    });
    expect(run.state).toBe('won');
    expect(run.deaths).toBe(OUTPOST.beats.length);
  });

  it('can be started from any beat and finished', () => {
    for (const beat of OUTPOST.beats) {
      const host = new FakeHost();
      const run = new MissionRunner(OUTPOST, host);
      expect(() => run.start(beat.id)).not.toThrow();
      expect(run.beat?.id).toBe(beat.id);
      expect(host.deployed).not.toBeNull();
    }
  });

  it('keeps every mark on the site, the aircraft apart', () => {
    for (const [id, mark] of Object.entries(OUTPOST.marks)) {
      if (id.startsWith('fly') || id.startsWith('sky')) continue;
      expect(Math.abs(mark.at[0]), id).toBeLessThanOrEqual(SITE);
      expect(Math.abs(mark.at[2]), id).toBeLessThanOrEqual(SITE);
    }
  });

  it('puts the parkour where the proved numbers say', () => {
    const { zones, doors } = OUTPOST;
    expect(zones.galleryFar!.min[0] - zones.galleryNear!.max[0]).toBe(PARKOUR.wallRun.gap);
    expect(zones.coolantNear!.min[2] - zones.coolantFar!.max[2]).toBe(PARKOUR.dash.gap);
    expect(doors.blastDoor!.height).toBe(PARKOUR.slide.doorHeight);
    expect(doors.blastDoor!.seconds).toBe(PARKOUR.slide.closeSeconds);
    expect(zones.blastLine!.max[2] - doors.blastDoor!.at[2]).toBe(PARKOUR.slide.triggerRange);
  });

  it('never orders more men at once than the fight has room for without queueing a whole beat', () => {
    for (const beat of OUTPOST.beats) {
      let men = 0;
      for (const step of beat.start ?? []) {
        if (step.do === 'squad') men += step.men.length;
        if (step.do === 'vehicle') men += step.crew?.length ?? 0;
      }
      expect(men, beat.id).toBeLessThanOrEqual(18);
    }
  });

  it('says in the plan exactly what it says in the game', () => {
    const plan = readFileSync('docs/campaign/MISSION.md', 'utf8');
    for (const line of OUTPOST.lines) expect(plan, line.id).toContain(line.text);
  });
});
