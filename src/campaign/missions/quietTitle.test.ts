/**
 * Mission 3 ("Quiet Title") validation & bot playthrough test suite:
 *   1. Zero dangling names/marks/zones/doors (`validateMission(QUIET_TITLE) === []`).
 *   2. Locked stealth starting loadout (`ultramag`, `gimlet`, `knife`, `exclusiveMods`, 5 mods, `thermal` chip).
 *   3. East Bell-Tower Sniper Perch rack has `awl` with all 4 stacking mods (`awl50`, `awlCan`, `awlAp`, `awlBarrel`).
 *   4. Bot playthrough 1 (Ghost Sniper / Silent CQB): kills Vane during `infiltration` -> skips `lockdown` -> finishes in `exfil`.
 *   5. Bot playthrough 2 (Lockdown + Bunker Breach): triggers `qt:lockdown` -> blast shutters slam shut -> enters `lockdown` -> breaches bunker & kills Vane -> finishes in `exfil`.
 *   6. Bot playthrough 3 (Checkpoint death recovery): dies once in `infiltration` and once in `lockdown` and still finishes cleanly.
 */
import { describe, expect, it } from 'vitest';
import { MissionRunner } from '../runner';
import { FakeHost } from '../testkit';
import type { Step } from '../types';
import { validateMission } from '../validate';
import { QUIET_TITLE } from './quietTitle';
import { REDEPLOY_LINES } from './quietTitle.lines';
import { VANE_STATIONS } from './quietTitle.places';

const FRAME = 1 / 30;
const GIVE_UP_SECONDS = 300;

function centerOf(zoneId: string): { x: number; y: number; z: number } {
  const z = QUIET_TITLE.zones[zoneId]!;
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

describe('Quiet Title (Mission 3)', () => {
  it('passes validateMission with zero problems', () => {
    expect(validateMission(QUIET_TITLE)).toEqual([]);
  });

  it('uses stealth mode and the locked starting stealth loadout', () => {
    expect(QUIET_TITLE.stealth).toBe(true);
    expect(QUIET_TITLE.loadout).toEqual({
      weapons: ['ultramag', 'gimlet', 'knife'],
      grenades: 0,
      exclusiveMods: true,
      mods: ['ultramagCan', 'ultramagAp', 'gimletShort', 'gimletDot', 'gimletCan'],
      chip: 'thermal',
    });
  });

  it('places the fully modded .50 suppressed AWL on the East Bell-Tower Sniper Perch', () => {
    const infiltration = QUIET_TITLE.beats.find(b => b.id === 'infiltration')!;
    const racks = (infiltration.start ?? []).filter(
      (s): s is Extract<Step, { do: 'rack' }> => s.do === 'rack',
    );
    const awlRack = racks.find(r => r.weapon === 'awl');
    expect(awlRack).toBeDefined();
    expect(awlRack?.at).toBe('bellPerch');
    expect(awlRack?.optional).toBe(true);
    expect(awlRack?.label).toBe('AWL .50 SUPPRESSED');
    expect(awlRack?.mods).toEqual(['awl50', 'awlCan', 'awlAp', 'awlBarrel']);

    const satchelRack = racks.find(r => r.weapon === 'satchel');
    expect(satchelRack).toBeDefined();
    expect(satchelRack?.at).toBe('armoryRack');
    expect(satchelRack?.optional).toBe(true);
  });

  it('defines Vane\'s 75-second 4-station Upper Bureau routine and valid dialogue ids', () => {
    expect(VANE_STATIONS).toHaveLength(4);
    expect(VANE_STATIONS.reduce((sum, s) => sum + s.seconds, 0)).toBe(75);
    for (const line of QUIET_TITLE.lines) {
      expect(line.id).toMatch(/^mission\.quiet_title\.(council|vane|guard)\.[a-z0-9.]+$/);
    }
    for (const id of REDEPLOY_LINES) {
      expect(QUIET_TITLE.lines.some(l => l.id === id), id).toBe(true);
    }
  });

  it('Bot playthrough 1 (Ghost Sniper / Silent CQB): kills Vane in infiltration, skips lockdown, extracts via North Cliff', () => {
    const host = new FakeHost();
    const run = new MissionRunner(QUIET_TITLE, host);
    const beats: string[] = [];
    let tookAwl = false;
    let killedVane = false;

    run.start();
    for (let t = 0; t < GIVE_UP_SECONDS && run.state === 'running'; t += FRAME) {
      const beat = run.beat!;
      if (beats[beats.length - 1] !== beat.id) beats.push(beat.id);
      advanceHost(host);

      if (beat.id === 'infiltration') {
        if (!tookAwl) {
          host.feet = centerOf('bellTower');
          const awlIdx = host.rackGuns.indexOf('awl');
          if (awlIdx >= 0) {
            host.rackGuns.splice(awlIdx, 1);
            host.racks.splice(awlIdx, 1)[0]!();
            tookAwl = true;
          }
        } else if (!killedVane) {
          killedVane = true;
          run.signal('qt:vane_dead');
        }
      } else if (beat.id === 'exfil') {
        host.feet = centerOf('exfilCliff');
      }

      run.update(FRAME);
    }

    expect(run.state).toBe('won');
    expect(host.finishedCount).toBe(1);
    expect(beats).toEqual(['briefing', 'infiltration', 'exfil']);
    expect(beats).not.toContain('lockdown');
    expect(host.skyHeld).toBe(true);
    expect(host.said).toContain('mission.quiet_title.council.perch.4418');
    expect(host.said).toContain('mission.quiet_title.council.vane.dead');
    expect(host.said).toContain('mission.quiet_title.council.exfil.done');
  });

  it('Bot playthrough 2 (Lockdown + Bunker Breach): slams shutters, breaches bunker, eliminates Vane, extracts via Culvert', () => {
    const host = new FakeHost();
    const run = new MissionRunner(QUIET_TITLE, host);
    const beats: string[] = [];
    let trippedLockdown = false;
    let hubOverridden = false;
    let breachPlanted = false;
    let bunkerBreached = false;
    let killedVane = false;

    run.start();
    for (let t = 0; t < GIVE_UP_SECONDS && run.state === 'running'; t += FRAME) {
      const beat = run.beat!;
      if (beats[beats.length - 1] !== beat.id) beats.push(beat.id);
      advanceHost(host);

      if (beat.id === 'infiltration' && !trippedLockdown) {
        trippedLockdown = true;
        run.signal('qt:lockdown');
      } else if (beat.id === 'lockdown') {
        if (!hubOverridden) {
          hubOverridden = true;
          run.signal('qt:hub_overridden');
        } else if (!breachPlanted) {
          breachPlanted = true;
          run.signal('qt:breach_planted');
        } else if (!bunkerBreached) {
          bunkerBreached = true;
          run.signal('qt:bunker_breached');
        } else if (!killedVane) {
          killedVane = true;
          run.signal('qt:vane_dead');
        }
      } else if (beat.id === 'exfil') {
        host.feet = centerOf('exfilCulvert');
      }

      run.update(FRAME);
    }

    expect(run.state).toBe('won');
    expect(host.finishedCount).toBe(1);
    expect(beats).toEqual(['briefing', 'infiltration', 'lockdown', 'exfil']);
    expect(host.doorStates['shutter.south']).toBe(0);
    expect(host.doorStates['shutter.east']).toBe(0);
    expect(host.said).toContain('mission.quiet_title.vane.lockdown.retreat');
    expect(host.said).toContain('mission.quiet_title.council.hub.overridden');
    expect(host.said).toContain('mission.quiet_title.vane.breach.charge');
    expect(host.said).toContain('mission.quiet_title.council.bunker.breached');
    expect(host.said).toContain('mission.quiet_title.vane.bunker.breached');
    expect(host.said).toContain('mission.quiet_title.council.exfil.done');
  });

  it('Bot playthrough 3 (Checkpoint death recovery): dies once in infiltration and once in lockdown and still finishes cleanly', () => {
    const host = new FakeHost();
    const run = new MissionRunner(QUIET_TITLE, host);
    const died = new Set<string>();
    const beats: string[] = [];
    let trippedLockdown = false;
    let overloaded = false;
    let bunkerBreached = false;
    let killedVane = false;

    run.start();
    for (let t = 0; t < GIVE_UP_SECONDS && run.state === 'running'; t += FRAME) {
      const beat = run.beat!;
      if (beats[beats.length - 1] !== beat.id) beats.push(beat.id);

      if ((beat.id === 'infiltration' || beat.id === 'lockdown') && !died.has(beat.id)) {
        died.add(beat.id);
        run.down();
        run.redeploy();
        continue;
      }

      advanceHost(host);

      if (beat.id === 'infiltration' && !trippedLockdown) {
        trippedLockdown = true;
        run.signal('qt:lockdown');
      } else if (beat.id === 'lockdown') {
        if (!overloaded) {
          overloaded = true;
          run.signal('qt:overload_started');
        } else if (!bunkerBreached) {
          bunkerBreached = true;
          run.signal('qt:bunker_breached');
        } else if (!killedVane) {
          killedVane = true;
          run.signal('qt:vane_dead');
        }
      } else if (beat.id === 'exfil') {
        host.feet = centerOf('exfilCulvert');
      }

      run.update(FRAME);
    }

    expect(run.state).toBe('won');
    expect(run.deaths).toBe(2);
    expect(host.finishedCount).toBe(1);
    expect(host.said).toContain('mission.quiet_title.council.redeploy.1');
    expect(host.said).toContain('mission.quiet_title.council.redeploy.2');
    expect(host.said).toContain('mission.quiet_title.vane.overload.panic');
  });
});
