import * as THREE from 'three';
import { beforeEach, expect, it, vi } from 'vitest';
import type { Ctx } from '../../core/contracts';
import type { EnemyInstance } from '../../core/gameplay';
import { RULES } from '../../enemies/outpost/chatter/lines';
import { VOICED, VOICE_INDEX, clipFor } from '../../enemies/outpost/chatter/voices';
import type { CommsLine } from '../../enemies/outpost/events';
import type { Settings } from '../settings';
import { ChatterVoices, EARSHOT, VOICE_POOL } from './voices';

class FakeAudio {
  src = '';
  preload = '';
  paused = true;
  volume = 1;
  currentTime = 0.5;
  pause = vi.fn(() => { this.paused = true; });
  play = vi.fn(() => { this.paused = false; return Promise.resolve(); });
  addEventListener = vi.fn();
}

const row = (id: string) => RULES.findIndex(r => r.id === id);
const FRAG = row('ch.garrison.frag.pro.1');
const MOVING = row('ch.garrison.moving.pro.1');
const HIT = row('ch.garrison.hit.pro.1');
const RADIO = row('ch.garrison.radioCheck.all.1');
const FIX = RULES.findIndex(r => r.concept === 'fix' && r.radio);

function setup() {
  const camera = new THREE.PerspectiveCamera();
  camera.updateMatrixWorld();
  const ctx = { render: { camera }, player: { eye: new THREE.Vector3() } } as unknown as Ctx;
  const settings = { master: 1, sfx: 1, voices: 1 } as Settings;
  const audios: FakeAudio[] = [];
  const voices = new ChatterVoices(ctx, settings, {
    audio: () => { const a = new FakeAudio(); audios.push(a); return a as unknown as HTMLAudioElement; },
    list: async () => ({ clips: [] }),
    context: () => null,
  });
  return { voices, audios, settings };
}

const man = (z: number) => ({ center: new THREE.Vector3(0, 1.6, -z) }) as unknown as EnemyInstance;
const line = (r: number, enemy: EnemyInstance | null, voice: number, slots: Record<string, string> | null = null): CommsLine =>
  ({ kind: RULES[r]!.concept, text: '', squad: 'Alpha', speaker: '', enemy, position: new THREE.Vector3(), row: r, dead: -1, slots, voice });

beforeEach(() => {
  VOICED.clips.clear();
  VOICED.ext = 'mp3';
  for (const r of [FRAG, MOVING, HIT, FIX]) for (const v of ['t2', 't3']) VOICED.clips.add(`${RULES[r]!.id}.${v}`);
  VOICED.clips.add(`${RULES[RADIO]!.id}~Charlie.t2`);
});

it('plays his take in his own voice, and nothing for a line with no take', () => {
  const { voices, audios } = setup();
  expect(voices.say(line(MOVING, man(10), 1))).toBe(true);
  expect(audios[0]!.src).toBe(`audio/chatter/${encodeURIComponent(RULES[MOVING]!.id)}.t3.mp3`);
  expect(voices.say(line(row('ch.garrison.lost.pro.1'), man(10), 0))).toBe(false);
});

it('picks the take the voice pass made for a blank it rendered once', () => {
  expect(clipFor(RADIO, { squad: 'Charlie' }, 0)).toBe(`${RULES[RADIO]!.id}~Charlie.t2`);
  expect(clipFor(RADIO, { squad: 'Charlie' }, 1)).toBeNull();
  const report = row('ch.garrison.contactReport.pro.2');
  VOICED.clips.add(`${RULES[report]!.id}~south-50metres-Alpha-Allunits.t2`);
  expect(clipFor(report, { to: 'Bravo', squad: 'Alpha', range: '120 metres', cardinal: 'south' }, 0)).toBe(`${RULES[report]!.id}~south-50metres-Alpha-Allunits.t2`);
});

it('hears shouts out to earshot, and the radio from anywhere (including Command with no body)', () => {
  const { voices } = setup();
  expect(voices.say(line(MOVING, man(EARSHOT + 5), 0))).toBe(false);
  expect(voices.say(line(RADIO, man(EARSHOT + 50), 0, { squad: 'Charlie' }))).toBe(true);
  expect(voices.pool.find(p => p.playing)!.radio).toBe(true);
  expect(voices.say(line(FIX, null, -1))).toBe(true);
  expect(voices.pool.some(p => p.playing && !p.enemy && p.radio)).toBe(true);
});

it('stops a man cut off mid-word, in a fade too short to click', () => {
  const { voices } = setup();
  const e = man(10);
  voices.say(line(MOVING, e, 0));
  voices.cut(e);
  voices.update(0.01, false);
  expect(voices.pool[0]!.playing).toBe(true);
  voices.update(0.05, false);
  expect(voices.pool[0]!.playing).toBe(false);
});

it('mixes a warning over the chatter, and a full pool gives way to a higher line, never to a lower one', () => {
  const { voices, audios } = setup();
  for (let i = 0; i < VOICE_POOL; i++) voices.say(line(MOVING, man(5 + i), 0));
  expect(voices.say(line(HIT, man(9), 0))).toBe(false);
  expect(voices.say(line(FRAG, man(4), 0))).toBe(true);
  voices.update(0, false);
  const frag = voices.pool.find(p => p.audio.src.includes('frag'))!;
  expect((frag.audio as unknown as FakeAudio).volume).toBe(1);
  const under = audios.filter(a => a.src.includes('moving') && !a.paused);
  expect(under.length).toBe(VOICE_POOL - 1);
  for (const a of under) expect(a.volume).toBeLessThan(0.4);
});

it('does not let an aborted play() from a previous clip kill a newly assigned clip on the same slot', async () => {
  const { voices, audios } = setup();
  let rejectFirst!: (err: Error) => void;
  audios[0]!.play
    .mockImplementationOnce(() => {
      audios[0]!.paused = false;
      return new Promise<void>((_res, rej) => { rejectFirst = rej; });
    })
    .mockImplementationOnce(() => {
      audios[0]!.paused = false;
      return Promise.resolve();
    });
  const e = man(6);
  expect(voices.say(line(MOVING, e, 0))).toBe(true);
  expect(voices.say(line(FRAG, e, 0))).toBe(true);
  rejectFirst(new DOMException('aborted', 'AbortError'));
  await Promise.resolve();
  expect(voices.pool[0]!.playing).toBe(true);
  expect(audios[0]!.paused).toBe(false);
});

it('is silent with the enemy voices turned down', () => {
  const { voices, settings } = setup();
  settings.voices = 0;
  expect(voices.say(line(MOVING, man(5), 0))).toBe(false);
});

it('plays relayed radio, fake-chatter, and spatial siege clips when present in the manifest', () => {
  const { voices, audios } = setup();
  VOICED.clips.add('radio.spotter.eyes.a.t2');
  VOICED.clips.add('chatter.pinned~TYRES.t3');
  VOICED.clips.add('siege.charge.t2');

  const relay = (clip: string, radio: boolean, enemy: EnemyInstance | null, voice: number): CommsLine => ({
    kind: 'order', text: '', squad: 'Command', speaker: null, enemy, position: new THREE.Vector3(), row: -1, voice, clip, radio,
  });

  // Bodiless fake-chatter / radio plays map-wide on the radio channel.
  expect(voices.say(relay('chatter.pinned~TYRES', true, null, 1))).toBe(true);
  expect(audios[0]!.src).toBe(`audio/chatter/${encodeURIComponent('chatter.pinned~TYRES.t3')}.mp3`);
  expect(voices.pool[0]!.radio).toBe(true);

  // Soldier radio beyond earshot is still heard on the radio.
  expect(voices.say(relay('radio.spotter.eyes.a', true, man(EARSHOT + 40), 0))).toBe(true);
  expect(voices.pool[1]!.radio).toBe(true);

  // Siege engineer shout respects earshot and plays dry from his body.
  expect(voices.say(relay('siege.charge', false, man(EARSHOT + 10), 0))).toBe(false);
  expect(voices.say(relay('siege.charge', false, man(12), 0))).toBe(true);
  expect(audios[2]!.src).toBe('audio/chatter/siege.charge.t2.mp3');
  expect(voices.pool[2]!.radio).toBe(false);

  // Unrecorded relay stays silent.
  expect(voices.say(relay('radio.missing', true, null, 0))).toBe(false);
});

it('tracks bodiless pilot/crew radio slots by speaker and cuts only the shot-down speaker mid-sentence', () => {
  const { voices, audios } = setup();
  const airRow = row('ch.garrison.airInbound.warthog.1');
  const allyRow = row('ch.garrison.airSplash.ally.1');
  VOICED.clips.add(`${RULES[airRow]!.id}.pcow`);
  VOICED.clips.add(`${RULES[allyRow]!.id}.patc`);
  VOICED.clips.add('callin.ac130.on_station.patc');

  const hog: CommsLine = {
    kind: 'airInbound', text: '', squad: 'CAS', speaker: 'Hog 2-1 · CAS',
    enemy: null, position: new THREE.Vector3(), row: airRow, dead: -1, slots: null, voice: VOICE_INDEX.pcow, radio: true,
  };
  const viper: CommsLine = {
    kind: 'airSplash', text: '', squad: 'Wingman', speaker: 'Viper 1 · Wingman',
    enemy: null, position: new THREE.Vector3(), row: allyRow, dead: -1, slots: null, voice: VOICE_INDEX.patc, radio: true, ally: true,
  };
  const spectre: CommsLine = {
    kind: 'ally', text: '', squad: 'SPECTRE 1-1', speaker: 'SPECTRE 1-1',
    enemy: null, position: new THREE.Vector3(), row: -1, voice: VOICE_INDEX.patc, clip: 'callin.ac130.on_station', radio: true, ally: true,
  };

  expect(voices.say(hog)).toBe(true);
  expect(voices.say(viper)).toBe(true);
  expect(voices.say(spectre)).toBe(true);
  expect(audios[2]!.src).toBe('audio/chatter/callin.ac130.on_station.patc.mp3');

  // Shooting down Hog 2-1 cuts only Hog 2-1's slot; Viper 1 and Spectre keep talking.
  voices.cut(null, 'Hog 2-1 · CAS');
  voices.update(0.05, false);
  const hogSlot = voices.pool.find(p => p.audio.src.includes('warthog'));
  const viperSlot = voices.pool.find(p => p.audio.src.includes('airSplash'));
  const spectreSlot = voices.pool.find(p => p.audio.src.includes('callin.ac130'));
  expect(hogSlot?.playing).toBe(false);
  expect(viperSlot?.playing).toBe(true);
  expect(spectreSlot?.playing).toBe(true);
});

it('ducks enemy radio and chopper chatter while campaign/mission dialogue is talking', () => {
  const camera = new THREE.PerspectiveCamera();
  camera.updateMatrixWorld();
  const campaign = { talking: true };
  const ctx = { render: { camera }, player: { eye: new THREE.Vector3() }, campaign } as unknown as Ctx;
  const settings = { master: 1, sfx: 1, voices: 1 } as Settings;
  const audios: FakeAudio[] = [];
  const voices = new ChatterVoices(ctx, settings, {
    audio: () => { const a = new FakeAudio(); audios.push(a); return a as unknown as HTMLAudioElement; },
    list: async () => ({ clips: [] }),
    context: () => null,
  });

  expect(voices.say(line(RADIO, man(EARSHOT + 50), 0, { squad: 'Charlie' }))).toBe(true);
  expect(audios[0]!.volume).toBeLessThan(0.3);

  campaign.talking = false;
  voices.update(0.016, false);
  expect(audios[0]!.volume).toBeCloseTo(1);
});


