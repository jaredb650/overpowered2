/**
 * Mission: **Deprecation** (`Form 7742-A`) validation, line-coverage, call-in lock/unlock,
 * full 10-section headless bot playthrough, and per-checkpoint restart parity test suite.
 */
import { describe, expect, it } from 'vitest';
import { CALLS } from '../coop';
import { DEPRECATION_CALLS } from '../deprecation/director';
import { MissionRunner } from '../runner';
import { missionWithStarter } from '../starter';
import { FakeHost } from '../testkit';
import type { Step } from '../types';
import { validateMission } from '../validate';
import { DEPRECATION } from './deprecation';
import { LINES, REDEPLOY_LINES } from './deprecation.lines';

const FRAME = 1 / 30;
const GIVE_UP_SECONDS = 480;

const EXPECTED_BEATS = [
  'briefing',
  'skyline_drop',
  'glass_run',
  'office_breach',
  'elevator_drop',
  'datacenter',
  'breakout',
  'boss_stage1',
  'boss_stage2',
  'boss_stage3',
] as const;

const CHECKPOINT_BEATS = EXPECTED_BEATS.slice(1);

function centerOf(zoneId: string): { x: number; y: number; z: number } {
  const z = DEPRECATION.zones[zoneId]!;
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

function collectAllSteps(): Step[] {
  const out: Step[] = [];
  for (const beat of DEPRECATION.beats) {
    for (const s of beat.start ?? []) out.push(s);
    for (const cue of beat.cues ?? []) {
      for (const s of cue.run) out.push(s);
    }
  }
  return out;
}

/** Drives the FakeHost bot through the current Deprecation beat cleanly. */
function stepBot(
  run: MissionRunner,
  host: FakeHost,
  sent: Set<string>,
  triggerOptionalCues: boolean,
): void {
  const beat = run.beat!;
  const hasObj = (sub: string) => host.objectiveText.some(o => o.includes(sub));
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

  if (beat.id === 'skyline_drop') {
    if (hasObj('Canyon Zipline')) {
      if (triggerOptionalCues && !sent.has('dp:zipline_snapped')) {
        host.feet = centerOf('tower1.zipline');
        fireOnce('dp:zipline_snapped');
      } else if (triggerOptionalCues && !sent.has('dp:zipline_saved')) {
        fireOnce('dp:zipline_saved');
      } else {
        host.feet = centerOf('tower2.deck');
      }
    } else if (hasObj('Tower 2 Security')) {
      if (triggerOptionalCues && !sent.has('dp:chopper_grappled')) {
        fireOnce('dp:chopper_grappled');
      } else {
        clearSquads([
          ['t2_guards', 3],
          ['t2_heavy', 2],
          ['t2_sniper', 1],
          ['sky_chopper', 1],
        ]);
      }
    }
  } else if (beat.id === 'glass_run') {
    if (hasObj('Closing Roof Shutter')) {
      if (!sent.has('entered_runup')) {
        sent.add('entered_runup');
        host.feet = centerOf('tower3.runup');
      } else {
        host.feet = centerOf('tower3.beyondShutter');
      }
    } else if (hasObj('Lightwell Chimney')) {
      if (!sent.has('reached_launch')) {
        sent.add('reached_launch');
        host.feet = centerOf('tower3.launch');
      } else {
        host.feet = centerOf('office.exec');
      }
    }
  } else if (beat.id === 'office_breach') {
    if (hasObj('Executive Floor')) {
      clearSquads([
        ['exec_w', 3],
        ['exec_e', 3],
        ['exec_riot', 2],
      ]);
    } else if (hasObj('Service Lobby')) {
      if (!sent.has('entered_mezz')) {
        sent.add('entered_mezz');
        host.feet = centerOf('office.mezz');
      } else {
        host.feet = centerOf('office.lobby');
      }
    }
  } else if (beat.id === 'elevator_drop') {
    if (hasObj('Hold the Service Lobby')) {
      fireOnce('dp:elev_arrived');
    } else if (hasObj('Board the Freight Elevator')) {
      fireOnce('dp:elev_jammed');
    } else if (hasObj('Hydraulic Brake Clamps')) {
      fireOnce('dp:elev_vault');
    }
  } else if (beat.id === 'datacenter') {
    if (hasObj('Compute Clusters')) {
      if (!sent.has('dp:vault_clusters_done')) fireOnce('dp:vault_clusters_done');
      else fireOnce('dp:vault_cleared');
    }
  } else if (beat.id === 'breakout') {
    if (hasObj('Concrete Breach Ramp')) {
      host.feet = centerOf('boulevard.plaza');
    }
    // `frame: kneel` resolves automatically via `advanceHost(host)`.
  } else if (beat.id === 'boss_stage1') {
    if (hasObj('Shoulder Relay Fins')) {
      if (triggerOptionalCues && !sent.has('dp:shield_broken')) fireOnce('dp:shield_broken');
      else fireOnce('dp:stage1_done');
    }
  } else if (beat.id === 'boss_stage2') {
    if (hasObj('Corner Columns')) {
      if (!sent.has('entered_inter')) {
        sent.add('entered_inter');
        host.feet = centerOf('boulevard.intersection');
      } else if (triggerOptionalCues && !sent.has('dp:orion_staggered')) {
        fireOnce('dp:orion_staggered');
      } else {
        fireOnce('dp:stage2_done');
      }
    }
  } else if (beat.id === 'boss_stage3') {
    if (hasObj('Substation Grid Conduits')) {
      if (!sent.has('entered_spire')) {
        sent.add('entered_spire');
        host.feet = centerOf('boulevard.spire');
      } else if (triggerOptionalCues && !sent.has('dp:conduits_down')) {
        fireOnce('dp:conduits_down');
      } else {
        fireOnce('dp:emp_eject');
      }
    } else if (hasObj('Exposed Neural Core')) {
      fireOnce('dp:orion_dead');
    }
  }
}

describe('Deprecation (Form 7742-A)', () => {
  it('passes validateMission with zero problems and supports starter weapon selection', () => {
    expect(validateMission(DEPRECATION)).toEqual([]);
    expect(DEPRECATION.beats.map(b => b.id)).toEqual([...EXPECTED_BEATS]);

    const withHarrow = missionWithStarter(DEPRECATION, 'harrow');
    expect(validateMission(withHarrow)).toEqual([]);
    expect(withHarrow.loadout.weapons[0]).toBe('harrow');
    for (const beat of withHarrow.beats) {
      if (beat.checkpoint) expect(beat.checkpoint.loadout.weapons[0]).toBe('harrow');
    }
  });

  it('registers every dp.* call in DEPRECATION_CALLS and co-op CALLS, and references all 39 voiced lines', () => {
    const allSteps = collectAllSteps();
    const usedCalls = new Set<string>();
    const usedLines = new Set<string>(REDEPLOY_LINES);

    for (const s of allSteps) {
      if (s.do === 'call') {
        usedCalls.add(s.name);
        expect(DEPRECATION_CALLS.has(s.name), `missing in DEPRECATION_CALLS: ${s.name}`).toBe(true);
        expect(CALLS[s.name], `missing in coop CALLS: ${s.name}`).toBeDefined();
      }
      if (s.do === 'say') usedLines.add(s.line);
    }

    for (const callName of DEPRECATION_CALLS) {
      expect(usedCalls.has(callName), `unused dp.* call: ${callName}`).toBe(true);
    }

    expect(LINES.length).toBe(39);
    for (const line of LINES) {
      expect(line.id).toMatch(/^mission\.deprecation\.(council|faultman|orion)\.[a-zA-Z0-9.]+$/);
      expect(usedLines.has(line.id), `unreferenced line: ${line.id}`).toBe(true);
    }
  });

  it('plays cleanly through all 10 sections with call-in hold/unlock transition and full dialogue coverage', () => {
    const host = new FakeHost();
    const run = new MissionRunner(DEPRECATION, host);
    const beats: string[] = [];
    const sent = new Set<string>();
    const callinsByBeat = new Map<string, boolean>();

    const origCallins = host.callins.bind(host);
    host.callins = (held: boolean) => {
      origCallins(held);
      if (run.beat) callinsByBeat.set(run.beat.id, held);
    };

    run.start();
    for (let t = 0; t < GIVE_UP_SECONDS && run.state === 'running'; t += FRAME) {
      const beat = run.beat!;
      if (beats[beats.length - 1] !== beat.id) beats.push(beat.id);
      advanceHost(host);
      stepBot(run, host, sent, true);
      run.update(FRAME);
    }

    expect(run.state).toBe('won');
    expect(host.finishedCount).toBe(1);
    expect(beats).toEqual([...EXPECTED_BEATS]);

    // Tower 3 shutter closed to slide clearance gap
    expect(host.doorStates['tower3.shutter']).toBeCloseTo(0.34, 2);

    // Call-ins held in Sections 1-8, unlocked in Sections 9-10
    for (const b of ['briefing', 'skyline_drop', 'glass_run', 'office_breach', 'elevator_drop', 'datacenter', 'breakout', 'boss_stage1']) {
      expect(callinsByBeat.get(b), `${b} callins held`).toBe(true);
    }
    expect(callinsByBeat.get('boss_stage2')).toBe(false);
    expect(callinsByBeat.get('boss_stage3')).toBe(false);

    // Key dialogue lines across Ram Faultman, ORION-0, and the Galactic Council
    for (const expectedLine of [
      'mission.deprecation.council.brief.1',
      'mission.deprecation.faultman.drop.1',
      'mission.deprecation.faultman.zipline.snap',
      'mission.deprecation.faultman.zipline.save',
      'mission.deprecation.faultman.chopper.grapple',
      'mission.deprecation.faultman.shutter',
      'mission.deprecation.faultman.glass.shatter',
      'mission.deprecation.faultman.elevator.jam',
      'mission.deprecation.faultman.vault.clusters',
      'mission.deprecation.orion.awake',
      'mission.deprecation.faultman.street.ally',
      'mission.deprecation.council.frame.fee',
      'mission.deprecation.orion.stage1.shieldDown',
      'mission.deprecation.orion.stage1.break',
      'mission.deprecation.faultman.stage2.jammer',
      'mission.deprecation.faultman.stage2.staggerHit',
      'mission.deprecation.faultman.stage3.vulnerable',
      'mission.deprecation.faultman.stage3.eject',
      'mission.deprecation.orion.death',
      'mission.deprecation.faultman.outro',
      'mission.deprecation.council.outro',
    ]) {
      expect(host.said, `expected line ${expectedLine}`).toContain(expectedLine);
    }
  });

  it('recovers cleanly with checkpoint parity across every single checkpoint section', () => {
    const host = new FakeHost();
    const run = new MissionRunner(DEPRECATION, host);
    const diedAt = new Set<string>();
    const sent = new Set<string>();

    run.start();
    for (let t = 0; t < GIVE_UP_SECONDS && run.state === 'running'; t += FRAME) {
      const beat = run.beat!;
      if (beat.checkpoint && !diedAt.has(beat.id)) {
        diedAt.add(beat.id);
        // Clear any signals/zones already spent for this beat so the restarted beat plays afresh
        sent.clear();
        run.down();
        run.redeploy();
        continue;
      }

      advanceHost(host);
      stepBot(run, host, sent, false);
      run.update(FRAME);
    }

    expect(run.state).toBe('won');
    expect(run.deaths).toBe(CHECKPOINT_BEATS.length);
    expect(diedAt.size).toBe(CHECKPOINT_BEATS.length);
    expect(host.finishedCount).toBe(1);
    expect(host.said).toContain('mission.deprecation.council.redeploy.1');
    expect(host.said).toContain('mission.deprecation.council.redeploy.2');
  });

  it('opens the freight lift immediately when both lobby QRF waves are cleared', () => {
    const host = new FakeHost();
    const run = new MissionRunner(DEPRECATION, host);
    run.start('elevator_drop');
    run.update(FRAME);
    expect(host.objectiveText.some(o => o.includes('Hold the Service Lobby'))).toBe(true);

    // Clear qrf_1 -> qrf_2 spawns immediately.
    for (let i = 0; i < 4; i++) run.unitGone('qrf_1', true, 'smg');
    run.update(FRAME);
    // Clear qrf_2 -> hold_lobby completes and dp.elevatorRide runs without waiting out the 25 s timer.
    for (let i = 0; i < 4; i++) run.unitGone('qrf_2', true, 'smg');
    run.update(FRAME);

    expect(host.calls.map(([name]) => name)).toContain('dp.elevatorRide');
    expect(host.objectiveText.some(o => o.includes('Board the Freight Elevator'))).toBe(true);
  });

  it('advances cleanly to datacenter if the player drops down the shaft into Sub-Level 4 during office_breach or elevator_drop', () => {
    for (const startBeat of ['office_breach', 'elevator_drop'] as const) {
      const host = new FakeHost();
      const run = new MissionRunner(DEPRECATION, host);
      run.start(startBeat);
      run.update(FRAME);

      host.feet = centerOf('vault.floor');
      for (let i = 0; i < 10; i++) run.update(FRAME);

      expect(run.beat?.id, `dropping into vault.floor from ${startBeat}`).toBe('datacenter');
      expect(host.calls.map(([name]) => name)).toContain('dp.datacenter');
      expect(host.objectiveText.some(o => o.includes('Compute Clusters'))).toBe(true);
      expect(host.objectiveText.some(o => o.includes('Service Lobby'))).toBe(false);
    }
  });
});

