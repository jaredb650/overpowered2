/** The Outpost as a whole: its numbers against the proved ones, its words against the plan, and every beat played to the end by a bot. */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Line } from '../../enemies/commander/lines';
import { GAP_SECONDS, readSeconds } from '../airtime';
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

const MP3_RATES = [44100, 48000, 32000];
const MP3_KBPS = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];

/**
 * Seconds of sound in one of the takes, counted frame by frame. MPEG-1 layer III, which is what the takes are: it agrees with afinfo
 * to the sample on all of them. Null for a line nobody has recorded.
 */
function takeSeconds(id: string): number | null {
  const file = `public/audio/voice/${id}.mp3`;
  if (!existsSync(file)) return null;
  const b = readFileSync(file);
  let i = b.toString('latin1', 0, 3) === 'ID3' ? 10 + ((b[6]! << 21) | (b[7]! << 14) | (b[8]! << 7) | b[9]!) : 0;
  let frames = 0;
  let rate = 0;
  for (let first = true; i + 4 <= b.length;) {
    const kbps = MP3_KBPS[b[i + 2]! >> 4] ?? 0;
    const sr = MP3_RATES[(b[i + 2]! >> 2) & 3];
    if (b[i] !== 0xff || (b[i + 1]! & 0xfe) !== 0xfa || !kbps || !sr) {
      i++;
      continue;
    }
    rate = sr;
    // The first frame of a constant-rate file is an Info tag with no sound in it.
    const side = b[i + 3]! >> 6 === 3 ? 17 : 32;
    const tag = b.toString('latin1', i + 4 + side, i + 8 + side);
    if (!(first && (tag === 'Info' || tag === 'Xing'))) frames++;
    first = false;
    i += Math.floor((144 * kbps * 1000) / sr) + ((b[i + 2]! >> 1) & 1);
  }
  return rate ? (frames * 1152) / rate : null;
}

/** How long a line holds the radio in the game: its take or its words, whichever is longer. */
const airtime = (line: Line): number => Math.max(takeSeconds(line.id) ?? 0, readSeconds(line.text));

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

  it('brings the blast door back up for as long as the player keeps missing it', () => {
    const host = new FakeHost();
    const run = new MissionRunner(OUTPOST, host);
    run.start('breach');
    const line = OUTPOST.zones.blastLine!;
    host.feet = { x: 0, y: 0, z: (line.min[2] + line.max[2]) / 2 };
    let rises = 0;
    let was = host.doorStates.blastDoor;
    for (let t = 0; t < 60; t += FRAME) {
      host.doorDone?.();
      host.doorDone = null;
      run.update(FRAME);
      if (host.doorStates.blastDoor === 0.4 && was !== 0.4) rises++;
      was = host.doorStates.blastDoor;
    }
    expect(rises).toBeGreaterThanOrEqual(3);
  });

  it('never leaves a player who walked past the barracks fight on a beat they have left behind', () => {
    const host = new FakeHost();
    const run = new MissionRunner(OUTPOST, host);
    run.start('barracks');
    for (let t = 0; t < 30; t += FRAME) run.update(FRAME);
    const near = OUTPOST.zones.coolantNear!;
    host.feet = { x: (near.min[0] + near.max[0]) / 2, y: 0, z: (near.min[2] + near.max[2]) / 2 };
    run.update(FRAME);
    expect(run.beat?.id).toBe('coolant');
  });

  it('puts men with no plate behind the plated line, or a rocket has no lesson to teach', () => {
    const plates = OUTPOST.beats.find(b => b.id === 'plates')!;
    const behind = plates.start!.find(s => s.do === 'squad' && s.tag === 'plate.back');
    expect(behind).toMatchObject({ light: true });
  });

  it('never has him talking in two boxes at once', () => {
    for (const beat of OUTPOST.beats) {
      const steps = beat.start ?? [];
      const box = steps.findIndex(s => s.do === 'adapt');
      for (const step of steps.slice(0, Math.max(box, 0))) if (step.do === 'say') expect(step.wait, `${beat.id} ${step.line}`).toBe(true);
    }
  });

  it('shows the player where the armour is, because nothing on the minimap does', () => {
    const turn = OUTPOST.beats.find(b => b.id === 'turn')!;
    const marked = (turn.start ?? []).flatMap(s => (s.do === 'call' && s.name === 'mark' ? [s.arg] : []));
    expect(marked).toEqual(['heavy.tank1', 'heavy.tank2', 'turn.chopper']);
  });

  it('runs each film for as long as the lines said over it, and starts the fade after the last word', () => {
    for (const id of ['briefing', 'ending']) {
      const steps = OUTPOST.beats.find(b => b.start?.some(s => s.do === 'cutscene' && s.id === id))!.start!;
      const lines: Line[] = [];
      for (let i = steps.findIndex(s => s.do === 'cutscene') - 1; i >= 0; i--) {
        const step = steps[i]!;
        if (step.do !== 'say') break;
        lines.unshift(OUTPOST.lines.find(l => l.id === step.line)!);
      }
      expect(lines.length, id).toBeGreaterThan(2);
      const words = lines.reduce((t, l) => t + airtime(l), 0) + GAP_SECONDS * (lines.length - 1);
      const { shots } = OUTPOST.cutscenes[id]!;
      const length = shots.reduce((t, shot) => t + shot.seconds, 0);
      // A second spare for the takes starting a little late, as a new recording does.
      expect(words + 1, id).toBeLessThanOrEqual(length - (shots[shots.length - 1]!.fadeOut ?? 0));
      expect(length - words, id).toBeLessThan(6);
    }
  });

  it('cuts in with an order given as a door shuts, whatever else is being said', () => {
    for (const [beat, zone, line] of [['lockout', 'gateApproach', 'mission.cmd.lz.gate'], ['breach', 'blastLine', 'mission.cmd.breach.seal']] as const) {
      const host = new FakeHost();
      host.autoSpeak = false;
      const run = new MissionRunner(OUTPOST, host);
      run.start(beat);
      run.update(FRAME);
      expect(host.speaking, beat).not.toBeNull();
      const z = OUTPOST.zones[zone]!;
      host.feet = { x: (z.min[0] + z.max[0]) / 2, y: (z.min[1] + z.max[1]) / 2, z: (z.min[2] + z.max[2]) / 2 };
      run.update(FRAME);
      expect(host.said[host.said.length - 1], beat).toBe(line);
    }
  });

  it('has him read the file in the pit before the pilot signs off', () => {
    const host = new FakeHost();
    host.autoSpeak = false;
    const run = new MissionRunner(OUTPOST, host);
    run.start('lockout');
    run.update(FRAME);
    expect(host.said).toEqual(['mission.cmd.lz.file']);
    const done = host.speaking!;
    host.speaking = null;
    done();
    run.update(FRAME);
    expect(host.said).toEqual(['mission.cmd.lz.file', 'mission.radio.in.rental']);
  });

  it('saves at the gate before the trucks are called, and holds the first truck for the call without bunching the rest', () => {
    const host = new FakeHost();
    host.autoSpeak = false;
    const run = new MissionRunner(OUTPOST, host);
    run.start('lockout');
    const say = (): void => {
      const done = host.speaking!;
      host.speaking = null;
      done();
      run.update(FRAME);
    };
    const gate = OUTPOST.zones.gateApproach!;
    host.feet = { x: 0, y: 0, z: (gate.min[2] + gate.max[2]) / 2 };
    run.update(FRAME);
    host.doorDone?.();
    host.doorDone = null;
    run.update(FRAME);
    say();
    expect(host.said[host.said.length - 1]).toBe('mission.cmd.lz.hours');
    say();
    expect(run.beat?.id).toBe('softskins');
    expect(host.log).toContain('saved softskins');
    expect(host.said[host.said.length - 1]).toBe('mission.cmd.lz.trucks');
    host.feet = { x: 999, y: 999, z: 999 };
    for (let t = 0; t < 30; t += FRAME) run.update(FRAME);
    expect(host.log).not.toContain('vehicle soft.truck1');
    say();
    expect(host.log).toContain('vehicle soft.truck1');
    for (let t = 0; t < 23; t += FRAME) run.update(FRAME);
    expect(host.log).not.toContain('vehicle soft.truck2');
    for (let t = 0; t < 2; t += FRAME) run.update(FRAME);
    expect(host.log).toContain('vehicle soft.truck2');
  });

  it('springs the mess hall on the word, however long the lines before it run', () => {
    const host = new FakeHost();
    host.autoSpeak = false;
    const run = new MissionRunner(OUTPOST, host);
    run.start('mess');
    const hall = OUTPOST.zones.messHall!;
    host.feet = { x: (hall.min[0] + hall.max[0]) / 2, y: 0, z: (hall.min[2] + hall.max[2]) / 2 };
    const say = (): void => {
      const done = host.speaking!;
      host.speaking = null;
      done();
    };
    for (let t = 0; t < 10; t += FRAME) run.update(FRAME);
    expect(host.log).not.toContain('release mess.floor');
    while (host.said[host.said.length - 1] !== 'mission.cmd.mess.now') say();
    run.update(FRAME);
    expect(host.log).not.toContain('release mess.floor');
    say();
    run.update(FRAME);
    expect(host.log).toContain('release mess.floor');
  });

  it('says in the plan exactly what it says in the game', () => {
    const plan = readFileSync('docs/campaign/MISSION.md', 'utf8');
    for (const line of OUTPOST.lines) expect(plan, line.id).toContain(line.text);
  });
});
