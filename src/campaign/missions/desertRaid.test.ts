/**
 * Mission 5 ("Desert Raid" — Surplus) validation, dialogue, director, Saltblood styler & 8-section playthrough tests:
 *   1. `validateMission(DESERT_RAID)` returns zero problems (zero unused marks/zones/doors).
 *   2. Starter weapon compatibility & Thermal brain chip preserved across all 8 checkpoints.
 *   3. All 8 beats exist with dense combat rosters; zero Council speakers or Council story references in `DESERT_RAID.lines`.
 *   4. Every draft Quist & Marr line from `DESERT-RAID.md` is present verbatim, plus new Terraces/Cave/Escort lines.
 *   5. Every `dr.*` call in `DESERT_RAID` is handled by `DesertRaid.call` with zero warnings.
 *   6. Full 8-section playthrough (including `high_terraces`, `salt_cave`, bulkhead door slam/override, cuffed escort stragglers & captured Quist ending lines).
 *   7. Director escort boarding (`boardCapturedQuistToConvoy`, `enterEndingCruise`, `getQuistBedPosition`, `getTruckYaw`) AND `onEscortLost('crushed' | 'shot')` flipping `quistCaptured` to `false`.
 *   8. Checkpoint death recovery across all 8 beats with Sergeant Marr redeploy lines.
 *   9. `SaltbloodStyler` attaches cosmetics once per enemy `uid` without duplicates & cleans up on `clear()`.
 *  10. Quist lines over `CampaignHud` pulse the nearest loudspeaker pole.
 */
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { Ctx } from '../../core/contracts';
import type { EnemyId, EnemyInstance } from '../../core/gameplay';
import { DESERT_Z, WARREN_MINIGUN } from '../../world/map/desert/plan';
import { DESERT_RAID_CALLS, DesertRaid } from '../desertRaid';
import { SaltbloodStyler } from '../desert/saltbloods';
import type { QuistHooks } from '../desert/types';
import type { CampaignHud } from '../hud';
import { MissionRunner } from '../runner';
import { missionWithStarter } from '../starter';
import { FakeHost } from '../testkit';
import type { Script } from '../types';
import { validateMission } from '../validate';
import { DESERT_RAID } from './desertRaid';
import { REDEPLOY_LINES } from './desertRaid.lines';

const FRAME = 1 / 30;
const GIVE_UP_SECONDS = 480;

function centerOf(zoneId: string): { x: number; y: number; z: number } {
  const z = DESERT_RAID.zones[zoneId]!;
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

function collectDrCalls(script: Script | undefined, out: Set<string>): void {
  for (const step of script ?? []) {
    if (step.do === 'call' && step.name.startsWith('dr.')) {
      out.add(step.name);
    }
  }
}

function countBeatEnemies(beatId: string): number {
  const beat = DESERT_RAID.beats.find(b => b.id === beatId)!;
  let total = 0;
  for (const step of beat.start ?? []) {
    if (step.do === 'squad') total += step.men.length;
  }
  for (const cue of beat.cues ?? []) {
    for (const step of cue.run) {
      if (step.do === 'squad') total += step.men.length;
    }
  }
  return total;
}

function makeFakeCtx(placeMock?: ReturnType<typeof vi.fn>): Ctx {
  const scene = new THREE.Scene();
  return {
    render: { scene, materials: { patch: <T>(m: T) => m } },
    player: {
      position: new THREE.Vector3(0, 0, DESERT_Z.approachStart),
      velocity: new THREE.Vector3(),
      yaw: 0,
      pitch: 0,
      teleport: () => {},
      park: () => {},
      unpark: () => {},
      damage: () => {},
    },
    camera: { setSeat: () => {}, clearSeat: () => {}, setZoom: () => {}, setZoomFov: () => {}, addTrauma: () => {} },
    hud: { seat: () => {}, setHint: () => {}, showPrompt: () => {} },
    weapons: { holster: () => {} },
    input: { isDown: () => false, wasPressed: () => false, consume: () => false },
    physics: { addBox: () => null, remove: () => {}, raycast: () => null },
    fx: { dust: () => {}, sparks: () => {}, burst: () => {}, tracer: () => {}, muzzleFlash: () => {}, explosion: () => {}, megaBlast: () => {}, smokeTrail: () => null },
    world: { objects: { destruction: { damageAt: () => false, blast: () => {}, nukeSweep: () => {} } } },
    allies: { spawn: () => null },
    progression: { award: () => {}, callInsManager: { emplacements: { place: placeMock ?? (() => ({})) } } },
    enemies: { alive: [], vehicles: { addExtra: () => {}, removeExtra: () => {} } },
    audio: { has: () => false, play: () => {}, loop: () => ({ stop: () => {}, setVolume: () => {}, setPitch: () => {}, setPosition: () => {} }) },
    events: { on: () => () => {}, emit: () => {} },
  } as unknown as Ctx;
}

function makeFakeEnemy(uid: number, id: EnemyId, z: number, withBones = true): EnemyInstance {
  const root = new THREE.Group();
  const bones: THREE.Bone[] = [];
  if (withBones) {
    for (let i = 0; i < 17; i++) {
      const b = new THREE.Bone();
      b.name = `bone_${i}`;
      root.add(b);
      bones.push(b);
    }
  }
  return {
    uid,
    id,
    char: {
      archetype: 'human',
      rig: { id: 'human', bones: [], height: 1.85 },
      root,
      bones,
      mesh: new THREE.SkinnedMesh(),
      anim: {} as EnemyInstance['char']['anim'],
    } as unknown as EnemyInstance['char'],
    position: new THREE.Vector3(0, 0, z),
    velocity: new THREE.Vector3(),
    yaw: 0,
    health: 100,
    maxHealth: 100,
    armor: 0,
    alive: true,
    score: 100,
    center: new THREE.Vector3(0, 1, z),
    isBoss: false,
    frozen: 0,
    burning: 0,
    machine: false,
  };
}

describe('Desert Raid (Mission 5 — 8-Section Campaign)', () => {
  it('passes validateMission with zero problems across all 8 beats', () => {
    expect(validateMission(DESERT_RAID)).toEqual([]);
  });

  it('has all 8 sections with checkpoints, dense combat rosters, starter weapon support & Thermal chip', () => {
    expect(DESERT_RAID.beats.map(b => b.id)).toEqual([
      'approach',
      'the_wall',
      'the_warren',
      'pump_yard',
      'high_terraces',
      'salt_cave',
      'the_plane',
      'exfil',
    ]);
    expect(DESERT_RAID.loadout.chip).toBe('thermal');
    for (const beat of DESERT_RAID.beats) {
      expect(beat.checkpoint, `beat ${beat.id} checkpoint`).toBeDefined();
      expect(beat.checkpoint!.loadout.chip).toBe('thermal');
    }

    // Verify dense human combat counts across all 8 sections
    expect(countBeatEnemies('approach')).toBe(10);
    expect(countBeatEnemies('the_wall')).toBe(16);
    expect(countBeatEnemies('the_warren')).toBe(24);
    expect(countBeatEnemies('pump_yard')).toBe(23); // 12 Pump Yard + 11 Storm Sewer
    expect(countBeatEnemies('high_terraces')).toBeGreaterThanOrEqual(20);
    expect(countBeatEnemies('salt_cave')).toBe(14);
    expect(countBeatEnemies('the_plane')).toBe(16);
    expect(countBeatEnemies('exfil')).toBe(5);

    // Verify elevated wall marks & relocated northern Plane Canyon coordinates
    expect(DESERT_RAID.marks.wallWestTop!.at[1]).toBe(3.6);
    expect(DESERT_RAID.marks.wallCenterTop!.at[1]).toBe(3.6);
    expect(DESERT_RAID.marks.wallEastTop!.at[1]).toBe(3.6);
    expect(DESERT_RAID.marks.planeEntry!.at[2]).toBe(DESERT_Z.planeForecourt);
    expect(DESERT_RAID.marks.quistTail!.at[2]).toBe(DESERT_Z.planeTail);

    const withHarrow = missionWithStarter(DESERT_RAID, 'harrow');
    expect(validateMission(withHarrow)).toEqual([]);
    expect(withHarrow.loadout.weapons[0]).toBe('harrow');
    expect(withHarrow.loadout.chip).toBe('thermal');
    for (const beat of withHarrow.beats) {
      expect(beat.checkpoint!.loadout.weapons[0]).toBe('harrow');
      expect(beat.checkpoint!.loadout.chip).toBe('thermal');
    }
  });

  it('contains zero Council lines or references and preserves all draft Quist/Marr dialogue verbatim', () => {
    const allowedSpeakers = new Set(['quist', 'marr', 'radio']);
    for (const line of DESERT_RAID.lines) {
      expect(allowedSpeakers.has(line.speaker), `unexpected speaker ${line.speaker} on ${line.id}`).toBe(true);
      expect(line.id).toMatch(/^mission\.desert_raid\.(quist|marr|radio)\.[a-z0-9.]+$/);
      expect(line.id.toLowerCase()).not.toContain('council');
      expect(line.text.toLowerCase()).not.toContain('council');
    }

    expect(REDEPLOY_LINES.length).toBeGreaterThanOrEqual(3);
    for (const id of REDEPLOY_LINES) {
      const found = DESERT_RAID.lines.find(l => l.id === id);
      expect(found, `missing redeploy line ${id}`).toBeDefined();
      expect(found!.speaker).toBe('marr');
    }

    const byKey = (key: string) => DESERT_RAID.lines.find(l => l.id === `mission.desert_raid.${key}`)?.text;

    // Agreed verbatim lines from docs/campaign/DESERT-RAID.md
    expect(byKey('quist.approach.warn')).toBe("You're a long way from water. Turn around and I'll let you die of thirst instead.");
    expect(byKey('quist.wall.gate')).toBe('You can scratch my walls all day. That gate held off an army.');
    expect(byKey('marr.wall.breached')).toBe("Gate's down. On foot. Go.");
    expect(byKey('quist.warren.bounty')).toBe('A year of water to whoever brings me one of their heads.');
    expect(byKey('quist.pump.tower')).toBe('You came for water. Have all of it.');
    expect(byKey('marr.pump.sewer')).toBe("Street's gone. Storm grate, west side. Thermal on.");
    expect(byKey('quist.sewer.dark.1')).toBe('Down in the drains. Come out where I can see you.');

    // Quist's 15-20s cornered speech (4 crisp lines)
    expect(byKey('quist.speech.1')).toBe('Eleven years I kept this town alive. Water, food, order.');
    expect(byKey('quist.speech.2')).toBe(
      "You think the people here hate me? They need me. When you leave, they'll be killing each other over a bucket by morning.",
    );
    expect(byKey('quist.speech.3')).toBe("You didn't come here to free anyone. You came to break something.");
    expect(byKey('quist.speech.4')).toBe('Well. Look around. You did.');

    // Tap-E replies & ending outcome lines
    expect(byKey('quist.reply.1')).toBe("Who sent you? Doesn't matter. Somebody always does.");
    expect(byKey('quist.reply.2')).toBe("No. I won't beg.");
    expect(byKey('quist.suicide')).toBe('Not by your hand.');
    expect(byKey('quist.grenade')).toBe("Come closer. I'll tell you a secret.");
    expect(byKey('quist.captured')).toBeDefined();

    // New 8-section dialogue lines (Jackal HMG+AGL, Sewer, High Terraces, Salt Cave, Live Cuffed Escort)
    expect(byKey('marr.approach.start')).toContain('fifty-cal');
    expect(byKey('marr.terraces.start')).toBeDefined();
    expect(byKey('quist.terraces.mock')).toBeDefined();
    expect(byKey('marr.cave.start')).toBeDefined();
    expect(byKey('quist.cave.warn')).toBeDefined();
    expect(byKey('marr.escort.start')).toBeDefined();
    expect(byKey('marr.escort.crushed')).toBeDefined();
    expect(byKey('marr.escort.shot')).toBeDefined();

    // Captured Quist ending lines
    expect(byKey('quist.ending.1')).toBeDefined();
    expect(byKey('quist.ending.2')).toBeDefined();
    expect(byKey('quist.ending.3')).toBeDefined();
  });

  it('handles every dr.* call used across all 8 beats in DesertRaid.call with zero warnings', () => {
    const usedCalls = new Set<string>();
    for (const beat of DESERT_RAID.beats) {
      collectDrCalls(beat.start, usedCalls);
      for (const cue of beat.cues ?? []) collectDrCalls(cue.run, usedCalls);
    }
    expect(usedCalls.has('dr.terracesStart')).toBe(true);
    expect(usedCalls.has('dr.caveStart')).toBe(true);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const placeMock = vi.fn(() => ({}) as unknown);
    const fakeCtx = makeFakeCtx(placeMock);
    const host = new FakeHost();
    const runner = new MissionRunner(DESERT_RAID, host);
    const fakeUi = { speak: vi.fn(), talking: false } as unknown as CampaignHud;
    const director = new DesertRaid(fakeCtx, runner, fakeUi);

    for (const callName of usedCalls) {
      expect(DESERT_RAID_CALLS.has(callName), `missing ${callName} in DESERT_RAID_CALLS`).toBe(true);
      director.call(callName);
    }

    expect(warnSpy).not.toHaveBeenCalled();
    expect(placeMock).toHaveBeenCalledTimes(1);
    const spec = (placeMock.mock.calls as unknown[][])[0]![0] as { pos: THREE.Vector3; level: number };
    expect(spec.level).toBe(3);
    expect(spec.pos.x).toBe(WARREN_MINIGUN.pos[0]);
    expect(spec.pos.y).toBe(WARREN_MINIGUN.pos[1]);
    expect(spec.pos.z).toBe(WARREN_MINIGUN.pos[2]);

    warnSpy.mockRestore();
  });

  it('plays through all 8 sections cleanly with terraces, salt cave, bulkhead overrides & cuffed Quist escort ending', () => {
    const host = new FakeHost();
    const run = new MissionRunner(DESERT_RAID, host);
    const beats: string[] = [];
    const sent = new Set<string>();
    const fireOnce = (sig: string) => {
      if (sent.has(sig)) return false;
      sent.add(sig);
      run.signal(sig);
      return true;
    };

    run.start();
    for (let t = 0; t < GIVE_UP_SECONDS && run.state === 'running'; t += FRAME) {
      const beat = run.beat!;
      if (beats[beats.length - 1] !== beat.id) beats.push(beat.id);
      advanceHost(host);

      if (beat.id === 'approach') {
        if (host.said.includes('mission.desert_raid.quist.approach.warn')) {
          host.feet = centerOf('wallFront');
          fireOnce('dr:approach_done');
        }
      } else if (beat.id === 'the_wall') {
        if (host.calls.some(([n]) => n === 'dr.sideTruckEast')) fireOnce('dr:wall_shredded');
        if (host.calls.some(([n]) => n === 'dr.warthogGate')) fireOnce('dr:gate_breached');
      } else if (beat.id === 'the_warren') {
        if (!sent.has('w_south')) {
          sent.add('w_south');
          host.feet = centerOf('warrenSouth');
        } else if (!sent.has('w_mid')) {
          sent.add('w_mid');
          host.feet = centerOf('warrenMid');
          for (let i = 0; i < 4; i++) run.unitGone('warren_south', true, 'smg');
          for (let i = 0; i < 4; i++) run.unitGone('warren_east_alley', true, 'smg');
        } else {
          host.feet = centerOf('pumpApproach');
        }
      } else if (beat.id === 'pump_yard') {
        if (!sent.has('dr:tower_dropped')) {
          host.feet = centerOf('pumpTrigger');
          fireOnce('dr:tower_dropped');
        } else if (!sent.has('in_sewer')) {
          sent.add('in_sewer');
          host.feet = centerOf('sewer');
        } else {
          host.feet = centerOf('terracesEntry');
        }
      } else if (beat.id === 'high_terraces') {
        if (!sent.has('in_terrace_mid')) {
          sent.add('in_terrace_mid');
          host.feet = centerOf('terraceMidZone');
        } else {
          host.feet = centerOf('caveEntry');
        }
      } else if (beat.id === 'salt_cave') {
        if (!sent.has('in_cave_mid')) {
          sent.add('in_cave_mid');
          host.feet = centerOf('caveMidZone');
        } else {
          host.feet = centerOf('planeForecourtZone');
        }
      } else if (beat.id === 'the_plane') {
        if (!sent.has('dr:door1_slam')) {
          fireOnce('dr:door1_slam');
        } else if (!sent.has('clear:plane_bay1')) {
          sent.add('clear:plane_bay1');
          for (let i = 0; i < 4; i++) run.unitGone('plane_bay1', true, 'smg');
        } else if (host.doorStates['plane.door1'] === 1 && !sent.has('in_mid')) {
          sent.add('in_mid');
          host.feet = centerOf('planeMid');
          fireOnce('dr:door2_slam');
        } else if (sent.has('in_mid') && !sent.has('clear:plane_bay2')) {
          sent.add('clear:plane_bay2');
          for (let i = 0; i < 4; i++) run.unitGone('plane_bay2', true, 'smg');
        } else if (sent.has('clear:plane_bay2') && host.doorStates['plane.door2'] === 1 && !sent.has('dr:quist_done')) {
          host.feet = centerOf('planeTail');
          fireOnce('dr:quist_captured');
          fireOnce('dr:quist_done');
        }
      } else if (beat.id === 'exfil') {
        if (host.calls.some(([n]) => n === 'dr.exfilArrive')) {
          fireOnce('dr:escort_active');
          fireOnce('dr:exfil_boarded');
        }
        if (host.calls.some(([n]) => n === 'dr.exfilChase')) fireOnce('dr:exfil_clear');
        if (host.calls.some(([n]) => n === 'dr.endingCutscene')) {
          fireOnce('dr:ending_quist_captured');
          fireOnce('dr:ending_done');
        }
      }

      run.update(FRAME);
    }

    expect(run.state).toBe('won');
    expect(host.finishedCount).toBe(1);
    expect(beats).toEqual([
      'approach',
      'the_wall',
      'the_warren',
      'pump_yard',
      'high_terraces',
      'salt_cave',
      'the_plane',
      'exfil',
    ]);
    expect(host.doorStates['plane.door1']).toBe(1);
    expect(host.doorStates['plane.door2']).toBe(1);

    // Check staged approach waves, side trucks, terraces, cave, and exfil arg '6'
    expect(host.calls).toContainEqual(['dr.banditsApproach', '4']);
    expect(host.calls).toContainEqual(['dr.banditsApproach', '5']);
    expect(host.calls).toContainEqual(['dr.sideTruckWest', undefined]);
    expect(host.calls).toContainEqual(['dr.sideTruckEast', undefined]);
    expect(host.calls).toContainEqual(['dr.terracesStart', undefined]);
    expect(host.calls).toContainEqual(['dr.caveStart', undefined]);
    expect(host.calls).toContainEqual(['dr.exfilChase', '6']);

    expect(host.said).toContain('mission.desert_raid.quist.approach.warn');
    expect(host.said).toContain('mission.desert_raid.quist.wall.gate');
    expect(host.said).toContain('mission.desert_raid.marr.wall.breached');
    expect(host.said).toContain('mission.desert_raid.quist.warren.bounty');
    expect(host.said).toContain('mission.desert_raid.quist.pump.tower');
    expect(host.said).toContain('mission.desert_raid.marr.pump.sewer');
    expect(host.said).toContain('mission.desert_raid.quist.sewer.dark.1');
    expect(host.said).toContain('mission.desert_raid.marr.terraces.start');
    expect(host.said).toContain('mission.desert_raid.quist.terraces.mock');
    expect(host.said).toContain('mission.desert_raid.marr.cave.start');
    expect(host.said).toContain('mission.desert_raid.quist.cave.warn');
    expect(host.said).toContain('mission.desert_raid.marr.door1.open');
    expect(host.said).toContain('mission.desert_raid.marr.door2.open');
    expect(host.said).toContain('mission.desert_raid.marr.quist.captured');
    expect(host.said).toContain('mission.desert_raid.marr.escort.start');
    expect(host.said).toContain('mission.desert_raid.quist.ending.1');
    expect(host.said).toContain('mission.desert_raid.quist.ending.3');
  });

  it('wires cuffed Quist escort boarding, ending cruise, and onEscortLost(crushed/shot) cleanly in DesertRaid director', () => {
    const fakeCtx = makeFakeCtx();
    const host = new FakeHost();
    const runner = new MissionRunner(DESERT_RAID, host);
    const spoken: string[] = [];
    const fakeUi = {
      speak: vi.fn((line: { id: string }, done: () => void) => {
        spoken.push(line.id);
        done();
      }),
      talking: false,
    } as unknown as CampaignHud;
    const director = new DesertRaid(fakeCtx, runner, fakeUi);

    let capturedHooks: QuistHooks | null = null;
    vi.spyOn(director.setpieces, 'startPlaneChase').mockImplementation((hooks: QuistHooks) => {
      capturedHooks = hooks;
    });

    const boardSpy = vi.fn();
    director.setpieces.boardCapturedQuistToConvoy = boardSpy;

    const enterCruiseSpy = vi.fn();
    const setQuistCapturedSpy = vi.fn();
    const getQuistBedPositionSpy = vi.fn((out: THREE.Vector3) => out.set(0, 1.4, -190));
    director.convoy.enterEndingCruise = enterCruiseSpy;
    director.convoy.setQuistCaptured = setQuistCapturedSpy;
    director.convoy.getQuistBedPosition = getQuistBedPositionSpy;
    const startChaseSpy = vi.spyOn(director.convoy, 'startExfilChase').mockImplementation(() => {});
    const arriveSpy = vi.spyOn(director.convoy, 'arriveForExfil').mockImplementation(() => {});
    const spawnBanditsSpy = vi.spyOn(director.convoy, 'spawnBanditWave').mockImplementation(() => {});

    const callOrder: string[] = [];
    enterCruiseSpy.mockImplementation(() => callOrder.push('enterEndingCruise'));
    const endingSpy = vi.spyOn(director.airAndSquads, 'startEndingCutscene').mockImplementation(
      (getPos, captured, onDone, getBedPos, getYaw) => {
        callOrder.push('startEndingCutscene');
        expect(typeof getPos).toBe('function');
        expect(captured).toBe(true);
        expect(typeof getBedPos).toBe('function');
        expect(typeof getYaw).toBe('function');
        getBedPos!(new THREE.Vector3());
        getYaw!();
        onDone();
      },
    );

    // Scenario A: Quist captured and safely escorted to truck -> boarded -> ending cruise -> bed camera
    director.call('dr.planeStart');
    expect(capturedHooks).not.toBeNull();
    capturedHooks!.onOutcome('captured');
    expect(director.quistCaptured).toBe(true);

    director.call('dr.exfilArrive');
    expect(arriveSpy).toHaveBeenCalledWith(true);

    director.call('dr.exfilChase', '6');
    expect(boardSpy).toHaveBeenCalledTimes(1);
    expect(setQuistCapturedSpy).toHaveBeenCalledWith(true);
    expect(startChaseSpy).toHaveBeenCalledWith(true);
    expect(spawnBanditsSpy).toHaveBeenCalledWith('exfil', 6);

    director.call('dr.endingCutscene');
    expect(callOrder).toEqual(['enterEndingCruise', 'startEndingCutscene']);
    expect(getQuistBedPositionSpy).toHaveBeenCalledTimes(1);
    expect(endingSpy).toHaveBeenCalledTimes(1);

    // Scenario B: Quist captured, then crushed by falling debris during escort -> flips quistCaptured false
    director.reset();
    spoken.length = 0;
    setQuistCapturedSpy.mockClear();
    endingSpy.mockImplementation((_getPos, captured, onDone) => {
      expect(captured).toBe(false);
      onDone();
    });

    director.call('dr.planeStart');
    capturedHooks!.onOutcome('captured');
    expect(director.quistCaptured).toBe(true);

    director.call('dr.exfilArrive');
    capturedHooks!.onEscortLost?.('crushed');
    expect(director.quistCaptured).toBe(false);
    expect(setQuistCapturedSpy).toHaveBeenCalledWith(false);
    expect(spoken).toContain('mission.desert_raid.marr.escort.crushed');

    director.call('dr.exfilChase', '6');
    expect(startChaseSpy).toHaveBeenLastCalledWith(false);
    director.call('dr.endingCutscene');

    // Scenario C: Quist captured, then shot by player during escort -> flips quistCaptured false
    director.reset();
    spoken.length = 0;
    director.call('dr.planeStart');
    capturedHooks!.onOutcome('captured');
    capturedHooks!.onEscortLost?.('shot');
    expect(director.quistCaptured).toBe(false);
    expect(spoken).toContain('mission.desert_raid.marr.escort.shot');
  });

  it('recovers cleanly from checkpoint deaths across all 8 beats and plays Marr redeploy lines', () => {
    const host = new FakeHost();
    const run = new MissionRunner(DESERT_RAID, host);
    const died = new Set<string>();
    const sent = new Set<string>();
    const fireOnce = (sig: string) => {
      if (sent.has(sig)) return;
      sent.add(sig);
      run.signal(sig);
    };

    const allBeatIds = DESERT_RAID.beats.map(b => b.id);

    run.start();
    for (let t = 0; t < GIVE_UP_SECONDS && run.state === 'running'; t += FRAME) {
      const beat = run.beat!;
      if (!died.has(beat.id)) {
        died.add(beat.id);
        run.down();
        run.redeploy();
        continue;
      }

      advanceHost(host);
      if (beat.id === 'approach') {
        if (host.calls.some(([n]) => n === 'dr.approachStart')) fireOnce('dr:approach_done');
      } else if (beat.id === 'the_wall') {
        fireOnce('dr:wall_shredded');
        if (host.calls.some(([n]) => n === 'dr.warthogGate')) fireOnce('dr:gate_breached');
      } else if (beat.id === 'the_warren') {
        fireOnce('dr:pump_reached');
      } else if (beat.id === 'pump_yard') {
        fireOnce('dr:tower_dropped');
        host.feet = centerOf('terracesEntry');
      } else if (beat.id === 'high_terraces') {
        host.feet = centerOf('caveEntry');
      } else if (beat.id === 'salt_cave') {
        host.feet = centerOf('planeForecourtZone');
      } else if (beat.id === 'the_plane') {
        fireOnce('dr:quist_killed');
        fireOnce('dr:quist_done');
      } else if (beat.id === 'exfil') {
        if (host.calls.some(([n]) => n === 'dr.exfilArrive')) fireOnce('dr:exfil_boarded');
        if (host.calls.some(([n]) => n === 'dr.exfilChase')) fireOnce('dr:exfil_clear');
        if (host.calls.some(([n]) => n === 'dr.endingCutscene')) fireOnce('dr:ending_done');
      }

      run.update(FRAME);
    }

    expect(run.state).toBe('won');
    expect(died.size).toBe(allBeatIds.length);
    expect(run.deaths).toBe(8);
    expect(host.finishedCount).toBe(1);
    expect(host.said).toContain('mission.desert_raid.marr.redeploy.1');
    expect(host.said).toContain('mission.desert_raid.marr.redeploy.2');
    expect(host.said).toContain('mission.desert_raid.marr.redeploy.3');
  });

  it('SaltbloodStyler styles raiders & heavy Plane guards once per uid without duplicates', () => {
    const raider = makeFakeEnemy(101, 'trooper', 24, true);
    const planeGuard = makeFakeEnemy(102, 'warden', DESERT_Z.planeRamp - 6, true);
    const fallbackEnemy = makeFakeEnemy(103, 'gunner', 10, false);
    const alive: EnemyInstance[] = [raider, planeGuard, fallbackEnemy];

    const fakeCtx = {
      enemies: { alive },
      render: { materials: { patch: <T>(m: T) => m } },
    } as unknown as Ctx;

    const styler = new SaltbloodStyler(fakeCtx);
    const countGear = (root: THREE.Object3D): number => {
      let n = 0;
      root.traverse(obj => {
        if (obj.name === 'saltblood-gear') n++;
      });
      return n;
    };

    styler.update();
    expect(styler.styledCount).toBe(3);
    expect(styler.isStyled(101)).toBe(true);
    expect(styler.isStyled(102)).toBe(true);
    expect(styler.isStyled(103)).toBe(true);

    const raiderGear = countGear(raider.char.root);
    const heavyGear = countGear(planeGuard.char.root);
    const fallbackGear = countGear(fallbackEnemy.char.root);
    // Standard raider: scarf + goggles + chest + 1 pauldron = 4; heavy guard has dual pauldrons = 5
    expect(raiderGear).toBe(4);
    expect(heavyGear).toBe(5);
    expect(fallbackGear).toBe(4);

    // Calling update() repeatedly must NOT attach duplicate gear
    styler.update();
    styler.update();
    expect(countGear(raider.char.root)).toBe(raiderGear);
    expect(countGear(planeGuard.char.root)).toBe(heavyGear);
    expect(countGear(fallbackEnemy.char.root)).toBe(fallbackGear);

    // Clear detaches every cosmetic group cleanly
    styler.clear();
    expect(styler.styledCount).toBe(0);
    expect(countGear(raider.char.root)).toBe(0);
    expect(countGear(planeGuard.char.root)).toBe(0);
    expect(countGear(fallbackEnemy.char.root)).toBe(0);
  });

  it('pulses loudspeakers when Quist speaks over CampaignHud', () => {
    const fakeCtx = makeFakeCtx();
    const host = new FakeHost();
    const runner = new MissionRunner(DESERT_RAID, host);
    const speakSpy = vi.fn((_line: unknown, done: () => void) => done());
    const fakeUi = { speak: speakSpy, talking: false } as unknown as CampaignHud;
    const director = new DesertRaid(fakeCtx, runner, fakeUi);
    const pulseSpy = vi.spyOn(director.setpieces, 'pulseLoudspeaker');

    director.ensureBuilt();
    const quistLine = DESERT_RAID.lines.find(l => l.speaker === 'quist')!;
    const marrLine = DESERT_RAID.lines.find(l => l.speaker === 'marr')!;

    fakeUi.speak(marrLine, () => {});
    expect(pulseSpy).toHaveBeenCalledTimes(0);

    fakeUi.speak(quistLine, () => {});
    expect(pulseSpy).toHaveBeenCalledTimes(1);
    expect(speakSpy).toHaveBeenCalledTimes(2);
  });
});
