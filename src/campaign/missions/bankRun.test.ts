/**
 * Mission 4 ("Bank Run", Form 7742-B) validation & bot playthrough test suite:
 *   1. Zero dangling marks/zones/doors/lines/beats (`validateMission(BANK_RUN) === []`).
 *   2. Starter weapon compatibility (`missionWithStarter` replaces key-1 `smg` cleanly across loadout & checkpoints).
 *   3. Full 4-act bot playthrough: opening -> rooftop -> drill -> plunder -> highway -> Mission Complete.
 *   4. Checkpoint death recovery across rooftop, drill, plunder, and highway beats.
 */
import { describe, expect, it } from 'vitest';
import { MissionRunner } from '../runner';
import { missionWithStarter } from '../starter';
import { FakeHost } from '../testkit';
import type { Step } from '../types';
import { validateMission } from '../validate';
import { BANK_RUN } from './bankRun';
import { REDEPLOY_LINES } from './bankRun.lines';

const FRAME = 1 / 30;
const GIVE_UP_SECONDS = 360;

function centerOf(zoneId: string): { x: number; y: number; z: number } {
  const z = BANK_RUN.zones[zoneId]!;
  return {
    x: (z.min[0] + z.max[0]) / 2,
    y: (z.min[1] + z.max[1]) / 2,
    z: (z.min[2] + z.max[2]) / 2,
  };
}

function advanceHost(host: FakeHost): void {
  for (const done of ['cutsceneDone', 'rideDone', 'sortieDone', 'frameDone', 'doorDone'] as const) {
    const fn = host[done];
    host[done] = null;
    (fn as ((skipped?: boolean) => void) | null)?.(false);
  }
}

describe('Bank Run (Mission 4)', () => {
  it('passes validateMission with zero problems', () => {
    expect(validateMission(BANK_RUN)).toEqual([]);
  });

  it('supports starter weapon selection and preserves optional Sabot/MGL racks', () => {
    const withHarrow = missionWithStarter(BANK_RUN, 'harrow');
    expect(validateMission(withHarrow)).toEqual([]);
    expect(withHarrow.loadout.weapons[0]).toBe('harrow');
    for (const beat of withHarrow.beats) {
      if (beat.checkpoint) expect(beat.checkpoint.loadout.weapons[0]).toBe('harrow');
    }

    const drillBeat = BANK_RUN.beats.find(b => b.id === 'drill')!;
    const racks = (drillBeat.start ?? []).filter(
      (s): s is Extract<Step, { do: 'rack' }> => s.do === 'rack',
    );
    expect(racks.some(r => r.weapon === 'sabot' && r.optional)).toBe(true);
    expect(racks.some(r => r.weapon === 'mgl' && r.optional)).toBe(true);

    for (const line of BANK_RUN.lines) {
      expect(line.id).toMatch(/^mission\.bank_run\.(council|radio|governor)\.[a-z0-9.]+$/);
    }
    for (const id of REDEPLOY_LINES) {
      expect(BANK_RUN.lines.some(l => l.id === id), id).toBe(true);
    }
  });

  it('plays through all 4 acts from fast-rope insertion to AUDITOR-1 takedown', () => {
    const host = new FakeHost();
    const run = new MissionRunner(BANK_RUN, host);
    const beats: string[] = [];
    const sent = new Set<string>();
    const fireOnce = (sig: string) => {
      if (sent.has(sig)) return false;
      sent.add(sig);
      run.signal(sig);
      return true;
    };
    const clearSquads = (tags: readonly [string, number][]) => {
      for (const [tag, count] of tags) {
        if (sent.has(`clear:${tag}`)) continue;
        sent.add(`clear:${tag}`);
        for (let i = 0; i < count; i++) run.unitGone(tag, true, 'smg');
      }
    };

    run.start();
    for (let t = 0; t < GIVE_UP_SECONDS && run.state === 'running'; t += FRAME) {
      const beat = run.beat!;
      if (beats[beats.length - 1] !== beat.id) beats.push(beat.id);
      advanceHost(host);

      const hasObj = (sub: string) => host.objectiveText.some(o => o.includes(sub));

      if (beat.id === 'opening') {
        if (host.calls.some(([name]) => name === 'bk.fastRope')) fireOnce('bk:fastrope_done');
      } else if (beat.id === 'rooftop') {
        if (hasObj('Clear rooftop')) clearSquads([['roof_north', 3], ['roof_flank', 2]]);
        else if (hasObj('Blow the Atrium Skylight')) fireOnce('bk:skylight_blown');
        else if (hasObj('Drop into')) host.feet = centerOf('bankingHall');
      } else if (beat.id === 'drill') {
        if (hasObj('Plant Bureau Thermal Drill')) fireOnce('bk:drill_planted');
        else if (hasObj('Defend the Thermal Drill')) {
          if (!sent.has('bk:drill_25')) fireOnce('bk:drill_25');
          else if (!sent.has('bk:drill_jam1')) fireOnce('bk:drill_jam1');
          else if (!sent.has('bk:drill_50')) fireOnce('bk:drill_50');
          else if (!sent.has('bk:drill_jam2')) fireOnce('bk:drill_jam2');
          else if (!sent.has('bk:drill_75')) fireOnce('bk:drill_75');
          else if (!sent.has('bk:drill_done')) fireOnce('bk:drill_done');
        }
      } else if (beat.id === 'plunder') {
        if (hasObj('Load 4 Gold')) {
          if (!sent.has('bk:bag_packed')) fireOnce('bk:bag_packed');
          else fireOnce('bk:bags_quota');
        } else if (hasObj('Mount the Humvee')) {
          fireOnce('bk:mount_turret');
        }
      } else if (beat.id === 'highway') {
        if (hasObj('Police Interceptors')) fireOnce('bk:highway_wave1_done');
        else if (hasObj('SWAT BearCat')) fireOnce('bk:highway_wave2_done');
        else if (hasObj('AUDITOR-1')) {
          if (!sent.has('bk:boss_tail_damaged')) fireOnce('bk:boss_tail_damaged');
          else if (!sent.has('bk:boss_dying')) fireOnce('bk:boss_dying');
          else fireOnce('bk:boss_dead');
        } else if (host.calls.some(([name]) => name === 'bk.finishTunnel')) {
          fireOnce('bk:tunnel_complete');
        }
      }

      run.update(FRAME);
    }

    expect(run.state).toBe('won');
    expect(host.finishedCount).toBe(1);
    expect(beats).toEqual(['opening', 'rooftop', 'drill', 'plunder', 'highway']);
    expect(host.doorStates['roof.stair']).toBe(0);
    expect(host.said).toContain('mission.bank_run.governor.goggles.reveal');
    expect(host.said).toContain('mission.bank_run.governor.boss.arrive');
    expect(host.said).toContain('mission.bank_run.governor.boss.down');
    expect(host.said).toContain('mission.bank_run.council.complete');
  });

  it('recovers cleanly from checkpoint deaths during drill and highway', () => {
    const host = new FakeHost();
    const run = new MissionRunner(BANK_RUN, host);
    const died = new Set<string>();
    const sent = new Set<string>();
    const fireOnce = (sig: string) => {
      if (sent.has(sig)) return;
      sent.add(sig);
      run.signal(sig);
    };

    run.start();
    for (let t = 0; t < GIVE_UP_SECONDS && run.state === 'running'; t += FRAME) {
      const beat = run.beat!;
      if ((beat.id === 'drill' || beat.id === 'highway') && !died.has(beat.id)) {
        died.add(beat.id);
        run.down();
        run.redeploy();
        continue;
      }

      advanceHost(host);
      const hasObj = (sub: string) => host.objectiveText.some(o => o.includes(sub));

      if (beat.id === 'opening') {
        if (host.calls.some(([name]) => name === 'bk.fastRope')) fireOnce('bk:fastrope_done');
      } else if (beat.id === 'rooftop') {
        if (hasObj('Clear rooftop') && !sent.has('clear:roof')) {
          sent.add('clear:roof');
          for (let i = 0; i < 3; i++) run.unitGone('roof_north', true, 'smg');
          for (let i = 0; i < 2; i++) run.unitGone('roof_flank', true, 'smg');
        } else if (hasObj('Blow the Atrium Skylight')) {
          fireOnce('bk:skylight_blown');
        } else if (hasObj('Drop into')) {
          host.feet = centerOf('bankingHall');
        }
      } else if (beat.id === 'drill') {
        if (hasObj('Plant Bureau Thermal Drill')) fireOnce('bk:drill_planted');
        else if (hasObj('Defend the Thermal Drill')) fireOnce('bk:drill_done');
      } else if (beat.id === 'plunder') {
        if (hasObj('Load 4 Gold')) fireOnce('bk:bags_quota');
        else if (hasObj('Mount the Humvee')) fireOnce('bk:mount_turret');
      } else if (beat.id === 'highway') {
        if (hasObj('Police Interceptors')) fireOnce('bk:highway_wave1_done');
        else if (hasObj('SWAT BearCat')) fireOnce('bk:highway_wave2_done');
        else if (hasObj('AUDITOR-1')) fireOnce('bk:boss_dead');
        else if (host.calls.some(([name]) => name === 'bk.finishTunnel')) fireOnce('bk:tunnel_complete');
      }

      run.update(FRAME);
    }

    expect(run.state).toBe('won');
    expect(run.deaths).toBe(2);
    expect(host.finishedCount).toBe(1);
    expect(host.said).toContain('mission.bank_run.council.redeploy.1');
    expect(host.said).toContain('mission.bank_run.council.redeploy.2');
  });
});
