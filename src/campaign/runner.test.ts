/** The runner against a pretend game. Everything a mission can do, with no renderer, physics or DOM. */
import { describe, expect, it } from 'vitest';
import { MISSIONS } from './missions';
import { MissionRunner } from './runner';
import { FakeHost } from './testkit';
import type { Beat, Mission } from './types';
import { validateMission } from './validate';

const mission = (beats: Beat[], extra: Partial<Mission> = {}): Mission => ({
  id: 'test',
  title: 'Test',
  loadout: { weapons: ['smg'], grenades: 0 },
  zones: { yard: { min: [0, -1, 0], max: [10, 5, 10] } },
  marks: { a: { at: [1, 2, 3] }, b: { at: [4, 5, 6] } },
  routes: { road: ['a', 'b'] },
  doors: { gate: { at: [0, 0, 0], yaw: 0, width: 4, height: 4, kind: 'shutter', seconds: 2, start: 1 } },
  cutscenes: { open: { shots: [] } },
  lines: [
    { id: 'one', speaker: 'commander', emotion: 'smug', text: 'One.' },
    { id: 'two', speaker: 'council', emotion: 'deadpan', text: 'Two.' },
    { id: 'back', speaker: 'commander', emotion: 'smug', text: 'Back.' },
  ],
  redeployLines: ['back'],
  beats,
  ...extra,
});

function play(m: Mission): { host: FakeHost; run: MissionRunner; step(seconds?: number): void } {
  const host = new FakeHost();
  const run = new MissionRunner(m, host);
  run.start();
  return {
    host,
    run,
    step(seconds = 1 / 60) {
      for (let t = 0; t < seconds; t += 1 / 60) run.update(1 / 60);
    },
  };
}

describe('triggers', () => {
  it('moves on when the player walks into a zone, and not before', () => {
    const { host, run, step } = play(mission([
      { id: 'a', title: 'A', until: { zone: 'yard' } },
      { id: 'b', title: 'B', until: { after: 99 } },
    ]));
    host.feet = { x: -5, y: 0, z: 5 };
    step();
    expect(run.beat?.id).toBe('a');
    host.feet = { x: 5, y: 0, z: 5 };
    step();
    expect(run.beat?.id).toBe('b');
  });

  it('counts its clock from when it was armed', () => {
    const { run, step } = play(mission([
      { id: 'a', title: 'A', until: { after: 2 } },
      { id: 'b', title: 'B', until: { after: 2 } },
      { id: 'c', title: 'C', until: { after: 99 } },
    ]));
    step(1.9);
    expect(run.beat?.id).toBe('a');
    step(0.2);
    expect(run.beat?.id).toBe('b');
    step(1.8);
    expect(run.beat?.id).toBe('b');
    step(0.3);
    expect(run.beat?.id).toBe('c');
  });

  it('counts kills by tag and by weapon', () => {
    const { run, step } = play(mission([
      { id: 'a', title: 'A', start: [{ do: 'squad', tag: 'alpha', men: ['trooper', 'trooper', 'trooper'], at: 'a' }], until: { kills: 2, tag: 'alpha', by: 'rocket' } },
      { id: 'b', title: 'B', until: { after: 99 } },
    ]));
    run.unitGone('alpha', true, 'smg');
    run.noteKill(null, 'rocket');
    step();
    expect(run.beat?.id).toBe('a');
    run.unitGone('alpha', true, 'rocket');
    run.unitGone('alpha', true, 'rocket_splash');
    step();
    expect(run.beat?.id).toBe('b');
  });

  it('calls a tag cleared only once every body has gone, and never before anything was spawned', () => {
    const { run, step } = play(mission([
      {
        id: 'a',
        title: 'A',
        cues: [{ when: { after: 1 }, run: [{ do: 'squad', tag: 'late', men: ['trooper', 'gunner'], at: 'a' }] }],
        until: { cleared: 'late' },
      },
      { id: 'b', title: 'B', until: { after: 99 } },
    ]));
    step(0.5);
    expect(run.beat?.id).toBe('a');
    step(0.6);
    run.unitGone('late', true, 'smg');
    step();
    expect(run.beat?.id).toBe('a');
    // A man who gives up is out of the fight too.
    run.unitGone('late', false, '');
    step();
    expect(run.beat?.id).toBe('b');
  });

  it('counts a vehicle and its crew under their own tags', () => {
    const { run, step } = play(mission([
      { id: 'a', title: 'A', start: [{ do: 'vehicle', tag: 'truck', kind: 'humvee', at: 'a', route: 'road', crew: ['trooper', 'trooper'], crewTag: 'crew' }], until: { cleared: ['truck', 'crew'] } },
      { id: 'b', title: 'B', until: { after: 99 } },
    ]));
    run.unitGone('truck', true, 'rocket');
    step();
    expect(run.beat?.id).toBe('a');
    expect(run.left('crew')).toBe(2);
    run.unitGone('crew', true, 'smg');
    run.unitGone('crew', true, 'smg');
    step();
    expect(run.beat?.id).toBe('b');
  });

  it('reads a boss by share of health', () => {
    const { host, run, step } = play(mission([
      { id: 'a', title: 'A', start: [{ do: 'boss', tag: 'him', at: 'a' }], until: { below: 0.5, tag: 'him' } },
      { id: 'b', title: 'B', until: { after: 99 } },
    ]));
    host.bodies = 0.8;
    step();
    expect(run.beat?.id).toBe('a');
    host.bodies = 0.4;
    step();
    expect(run.beat?.id).toBe('b');
  });

  it('hears signals and game events, and compares fields', () => {
    const { host, run, step } = play(mission([
      { id: 'a', title: 'A', until: { event: 'weapon:unlocked', where: { weapon: 'rocket' } } },
      { id: 'b', title: 'B', until: { signal: 'go' } },
      { id: 'c', title: 'C', until: { after: 99 } },
    ]));
    host.bus.emit('weapon:unlocked', { weapon: 'shotgun' });
    step();
    expect(run.beat?.id).toBe('a');
    host.bus.emit('weapon:unlocked', { weapon: 'rocket' });
    step();
    expect(run.beat?.id).toBe('b');
    run.signal('stop');
    step();
    expect(run.beat?.id).toBe('b');
    run.signal('go');
    step();
    expect(run.beat?.id).toBe('c');
  });

  it('waits for all of them, and any one of them, and a clock inside keeps running', () => {
    const { run, step } = play(mission([
      { id: 'a', title: 'A', until: { all: [{ signal: 'x' }, { after: 1 }] } },
      { id: 'b', title: 'B', until: { any: [{ signal: 'y' }, { after: 1 }] } },
      { id: 'c', title: 'C', until: { after: 99 } },
    ]));
    run.signal('x');
    step(0.5);
    expect(run.beat?.id).toBe('a');
    step(0.6);
    expect(run.beat?.id).toBe('b');
    step(1.1);
    expect(run.beat?.id).toBe('c');
  });
});

describe('scripts', () => {
  it('runs steps in order, and only waiting steps hold it up', () => {
    const { host, step } = play(mission([{
      id: 'a',
      title: 'A',
      start: [
        { do: 'banner', text: 'first' },
        { do: 'wait', seconds: 1 },
        { do: 'banner', text: 'second' },
        { do: 'until', when: { signal: 'go' } },
        { do: 'banner', text: 'third' },
      ],
      until: { after: 99 },
    }]));
    expect(host.log).toEqual(['banner first']);
    step(1.1);
    expect(host.log).toEqual(['banner first', 'banner second']);
  });

  it('fires a cue once, while its beat lasts', () => {
    const { host, run, step } = play(mission([
      { id: 'a', title: 'A', cues: [{ when: { signal: 'hit' }, run: [{ do: 'banner', text: 'cue' }] }], until: { signal: 'next' } },
      { id: 'b', title: 'B', until: { after: 99 } },
    ]));
    run.signal('hit');
    step();
    run.signal('hit');
    step();
    expect(host.log).toEqual(['banner cue']);
    run.signal('next');
    step();
    run.signal('hit');
    step();
    expect(host.log).toEqual(['banner cue']);
  });

  it('stops a beat\'s scripts when it ends', () => {
    const { host, run, step } = play(mission([
      { id: 'a', title: 'A', start: [{ do: 'wait', seconds: 5 }, { do: 'banner', text: 'too late' }], until: { signal: 'next' } },
      { id: 'b', title: 'B', until: { after: 99 } },
    ]));
    run.signal('next');
    step(6);
    expect(host.log).toEqual([]);
  });

  it('jumps with goto, and finishes', () => {
    const { host, run, step } = play(mission([
      { id: 'a', title: 'A', start: [{ do: 'goto', beat: 'c' }] },
      { id: 'b', title: 'B', start: [{ do: 'banner', text: 'skipped' }], until: { after: 1 } },
      { id: 'c', title: 'C', start: [{ do: 'wait', seconds: 1 }, { do: 'finish' }] },
    ]));
    expect(run.beat?.id).toBe('c');
    expect(host.log).toEqual([]);
    step(1.1);
    expect(run.state).toBe('won');
    expect(host.finishedCount).toBe(1);
  });

  it('ends the mission after the last row', () => {
    const { host, run, step } = play(mission([{ id: 'a', title: 'A', until: { after: 1 } }]));
    step(1.1);
    expect(run.state).toBe('won');
    expect(host.finishedCount).toBe(1);
  });

  it('holds on a door, a cutscene and a ride until they report back', () => {
    const { host, step } = play(mission([{
      id: 'a',
      title: 'A',
      start: [
        { do: 'door', door: 'gate', open: 0, wait: true },
        { do: 'banner', text: 'shut' },
        { do: 'cutscene', id: 'open' },
        { do: 'banner', text: 'seen' },
        { do: 'ride', seat: 'doorGunner' },
        { do: 'banner', text: 'landed' },
      ],
      until: { after: 99 },
    }]));
    step();
    expect(host.log).toEqual([]);
    expect(host.doorStates.gate).toBe(0);
    host.doorDone!();
    step();
    expect(host.log).toEqual(['banner shut']);
    host.cutsceneDone!(false);
    step();
    expect(host.log).toEqual(['banner shut', 'banner seen']);
    host.rideDone!();
    step();
    expect(host.log).toEqual(['banner shut', 'banner seen', 'banner landed']);
  });

  it('keeps objectives until they are ticked', () => {
    const { host, step } = play(mission([{
      id: 'a',
      title: 'A',
      start: [
        { do: 'objective', id: 'x', text: 'Do X', at: 'a' },
        { do: 'objective', id: 'y', text: 'Do Y' },
        { do: 'wait', seconds: 1 },
        { do: 'done', id: 'x' },
      ],
      until: { after: 99 },
    }]));
    expect(host.objectiveText).toEqual(['Do X', 'Do Y']);
    step(1.1);
    expect(host.objectiveText).toEqual(['Do Y']);
  });
});

describe('the radio', () => {
  it('says lines one at a time, in order, and holds a script that asks it to', () => {
    const m = mission([{
      id: 'a',
      title: 'A',
      start: [{ do: 'say', line: 'one' }, { do: 'say', line: 'two', wait: true }, { do: 'banner', text: 'after' }],
      until: { after: 99 },
    }]);
    const host = new FakeHost();
    host.autoSpeak = false;
    const run = new MissionRunner(m, host);
    run.start();
    run.update(1 / 60);
    expect(host.said).toEqual(['one']);
    host.speaking!();
    run.update(1 / 60);
    expect(host.said).toEqual(['one', 'two']);
    expect(host.log).toEqual([]);
    host.speaking!();
    run.update(1 / 60);
    expect(host.log).toEqual(['banner after']);
  });

  it('drops the queue when a cutscene is skipped', () => {
    const m = mission([{
      id: 'a',
      title: 'A',
      start: [{ do: 'say', line: 'one' }, { do: 'say', line: 'two' }, { do: 'cutscene', id: 'open' }, { do: 'banner', text: 'on' }],
      until: { after: 99 },
    }]);
    const host = new FakeHost();
    host.autoSpeak = false;
    const run = new MissionRunner(m, host);
    run.start();
    host.cutsceneDone!(true);
    run.update(1 / 60);
    run.update(1 / 60);
    expect(host.said).toEqual(['one']);
    expect(host.log).toEqual(['banner on']);
  });
});

describe('checkpoints', () => {
  const beats: Beat[] = [
    { id: 'a', title: 'A', start: [{ do: 'give', weapon: 'shotgun' }], until: { after: 1 } },
    {
      id: 'b',
      title: 'B',
      checkpoint: { at: 'a', loadout: { weapons: ['smg', 'shotgun'], grenades: 2 } },
      start: [
        { do: 'say', line: 'one' },
        { do: 'door', door: 'gate', open: 0, seconds: 0 },
        { do: 'objective', id: 'x', text: 'Kill them' },
        { do: 'squad', tag: 'alpha', men: ['trooper', 'trooper'], at: 'b' },
      ],
      until: { cleared: 'alpha' },
    },
    { id: 'c', title: 'C', start: [{ do: 'door', door: 'gate', open: 1, seconds: 0 }], until: { after: 99 } },
  ];

  it('comes back to the top of the beat, with its men spawned afresh and the kit it promised', () => {
    const { host, run, step } = play(mission(beats));
    step(1.1);
    expect(run.beat?.id).toBe('b');
    run.unitGone('alpha', true, 'smg');
    run.down();
    expect(run.state).toBe('down');
    step(5);
    expect(run.beat?.id).toBe('b');
    run.redeploy();
    expect(run.state).toBe('running');
    expect(run.deaths).toBe(1);
    expect(host.deployed).toEqual({ at: '1,2,3', weapons: 'smg,shotgun' });
    expect(run.left('alpha')).toBe(2);
    expect(host.log.filter(l => l.startsWith('squad'))).toHaveLength(2);
  });

  it('does not repeat a speech, and greets the player instead', () => {
    const { host, run, step } = play(mission(beats));
    step(1.1);
    expect(host.said).toEqual(['one']);
    run.down();
    run.redeploy();
    step();
    expect(host.said).toEqual(['one', 'back']);
  });

  it('restores doors and objectives as they stood at the checkpoint', () => {
    const { host, run, step } = play(mission([
      { id: 'a', title: 'A', start: [{ do: 'objective', id: 'main', text: 'Main' }, { do: 'door', door: 'gate', open: 0.5, seconds: 0 }], until: { after: 1 } },
      { id: 'b', title: 'B', checkpoint: { at: 'b', loadout: { weapons: ['smg'], grenades: 0 } }, start: [{ do: 'wait', seconds: 1 }, { do: 'door', door: 'gate', open: 1, seconds: 0 }, { do: 'done', id: 'main' }], until: { after: 99 } },
    ]));
    step(2.5);
    expect(host.doorStates.gate).toBe(1);
    expect(host.objectiveText).toEqual([]);
    run.down();
    run.redeploy();
    expect(host.doorStates.gate).toBe(0.5);
    expect(host.objectiveText).toEqual(['Main']);
  });

  it('with no checkpoint yet, goes back to the start with the opening kit', () => {
    const { host, run } = play(mission([{ id: 'a', title: 'A', start: [{ do: 'squad', tag: 'alpha', men: ['trooper'], at: 'a' }], until: { after: 99 } }]));
    run.down();
    run.redeploy();
    expect(host.deployed).toEqual({ at: null, weapons: 'smg' });
    expect(run.left('alpha')).toBe(1);
  });

  it('ignores a dead cue and a closed door script from before the restart', () => {
    const { host, run, step } = play(mission([{
      id: 'a',
      title: 'A',
      cues: [{ when: { after: 1 }, run: [{ do: 'banner', text: 'once' }] }],
      until: { after: 99 },
    }]));
    run.down();
    step(5);
    expect(host.log).toEqual([]);
    run.redeploy();
    step(1.1);
    expect(host.log).toEqual(['banner once']);
  });
});

describe('what survives a restart', () => {
  it('brings back a tag that was alive at the save with `ensure`, and leaves one already dead alone', () => {
    const { host, run, step } = play(mission([
      {
        id: 'a',
        title: 'A',
        start: [{ do: 'squad', tag: 'dead', men: ['trooper'], at: 'a' }, { do: 'vehicle', tag: 'tank', kind: 'tank', at: 'a' }],
        until: { signal: 'go' },
      },
      {
        id: 'b',
        title: 'B',
        checkpoint: { at: 'a', loadout: { weapons: ['smg'], grenades: 0 } },
        start: [{ do: 'squad', tag: 'dead', men: ['trooper'], at: 'a', ensure: true }, { do: 'vehicle', tag: 'tank', kind: 'tank', at: 'a', ensure: true }],
        until: { cleared: ['dead', 'tank'] },
      },
    ]));
    run.unitGone('dead', true, 'smg');
    run.signal('go');
    step();
    expect(host.log.filter(l => l.startsWith('vehicle'))).toHaveLength(1);
    run.down();
    run.redeploy();
    expect(host.log.filter(l => l.startsWith('vehicle'))).toHaveLength(2);
    expect(host.log.filter(l => l.startsWith('squad'))).toHaveLength(1);
    run.unitGone('tank', true, 'rocket');
    step();
    expect(run.state).toBe('won');
  });

  it('keeps a weapon taken from a rack, and does not lay it out twice', () => {
    const { host, run, step } = play(mission([
      {
        id: 'a',
        title: 'A',
        checkpoint: { at: 'a', loadout: { weapons: ['smg'], grenades: 0 } },
        start: [{ do: 'rack', weapon: 'kiln', at: 'a', optional: true }],
        until: { after: 99 },
      },
    ]));
    host.racks[0]!();
    step();
    run.down();
    run.redeploy();
    expect(host.deployed?.weapons).toBe('smg,kiln');
    expect(host.racks).toHaveLength(1);
  });

  it('repeats a cue that asks to, every time its trigger comes true', () => {
    const { host, step } = play(mission([{
      id: 'a',
      title: 'A',
      cues: [{ when: { after: 1 }, repeat: true, run: [{ do: 'banner', text: 'again' }] }],
      until: { after: 99 },
    }]));
    step(3.2);
    expect(host.log).toEqual(['banner again', 'banner again', 'banner again']);
  });
});

describe('starting from a beat', () => {
  const beats: Beat[] = [
    { id: 'a', title: 'A', start: [{ do: 'door', door: 'gate', open: 0, seconds: 0 }], until: { after: 1 } },
    { id: 'b', title: 'B', checkpoint: { at: 'b', loadout: { weapons: ['smg', 'rocket'], grenades: 3 } }, until: { after: 1 } },
    { id: 'c', title: 'C', cues: [{ when: { after: 50 }, run: [{ do: 'door', door: 'gate', open: 1, seconds: 0 }] }], until: { after: 99 } },
    { id: 'd', title: 'D', until: { after: 99 } },
  ];

  it('hands over the last checkpoint\'s kit and leaves doors as earlier beats left them', () => {
    const host = new FakeHost();
    const run = new MissionRunner(mission(beats), host);
    run.start('c');
    expect(run.beat?.id).toBe('c');
    expect(host.deployed).toEqual({ at: '4,5,6', weapons: 'smg,rocket' });
    expect(host.doorStates.gate).toBe(0);
    run.start('d');
    expect(host.doorStates.gate).toBe(1);
  });
});

describe('validateMission', () => {
  it('passes every shipped mission', () => {
    for (const m of Object.values(MISSIONS)) expect(validateMission(m)).toEqual([]);
  });

  it('finds what would otherwise fail in play', () => {
    const problems = validateMission(mission([
      {
        id: 'a',
        title: 'A',
        start: [{ do: 'say', line: 'nobody' }, { do: 'door', door: 'nothing', open: 0 }, { do: 'squad', tag: 'x', men: ['trooper'], at: 'nowhere' }, { do: 'rack', weapon: 'rocket', at: 'a' }],
        cues: [{ when: { zone: 'moon' }, run: [] }],
        until: { cleared: 'ghosts' },
      },
      { id: 'b', title: 'B', checkpoint: { at: 'a', loadout: { weapons: ['smg'], grenades: 0 } } },
    ]));
    expect(problems.join('\n')).toMatch(/line nobody/);
    expect(problems.join('\n')).toMatch(/door nothing/);
    expect(problems.join('\n')).toMatch(/mark nowhere/);
    expect(problems.join('\n')).toMatch(/zone moon/);
    expect(problems.join('\n')).toMatch(/under ghosts/);
    expect(problems.join('\n')).toMatch(/takes away the rocket/);
    expect(problems.join('\n')).toMatch(/nothing ever ends/);
  });

  it('catches a trigger a restart could never satisfy', () => {
    const problems = validateMission(mission([
      { id: 'a', title: 'A', start: [{ do: 'squad', tag: 'x', men: ['trooper'], at: 'a' }], until: { after: 1 } },
      { id: 'b', title: 'B', checkpoint: { at: 'a', loadout: { weapons: ['smg'], grenades: 0 } }, until: { cleared: 'x' } },
    ]));
    expect(problems.join()).toMatch(/never brings back x/);
  });

  it('refuses a beat that spins', () => {
    expect(validateMission(mission([{ id: 'a', title: 'A', start: [{ do: 'goto', beat: 'a' }] }])).join()).toMatch(/goes back/);
  });
});
