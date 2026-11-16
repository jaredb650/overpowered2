import * as THREE from 'three';
import { beforeEach, expect, it, vi } from 'vitest';
import type { Ctx } from '../../core/contracts';
import type { EnemyInstance } from '../../core/gameplay';
import { RULES } from '../../enemies/outpost/chatter/lines';
import { VOICED, clipFor } from '../../enemies/outpost/chatter/voices';
import type { CommsLine } from '../../enemies/outpost/events';
import type { Settings } from '../settings';
import { ChatterVoices, EARSHOT } from './voices';

class FakeAudio {
  src = '';
  preload = '';
  paused = true;
  volume = 1;
  pause = vi.fn(() => { this.paused = true; });
  play = vi.fn(() => { this.paused = false; return Promise.resolve(); });
  addEventListener = vi.fn();
}

const row = (id: string) => RULES.findIndex(r => r.id === id);
const FRAG = row('ch.garrison.frag.pro.1');
const MOVING = row('ch.garrison.moving.pro.1');
const HIT = row('ch.garrison.hit.pro.1');
const RADIO = row('ch.garrison.radioCheck.all.1');

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
const line = (r: number, enemy: EnemyInstance, voice: number, slots: Record<string, string> | null = null): CommsLine =>
  ({ kind: RULES[r]!.concept, text: '', squad: 'Alpha', speaker: '', enemy, position: new THREE.Vector3(), row: r, dead: -1, slots, voice });

beforeEach(() => {
  VOICED.clips.clear();
  VOICED.ext = 'mp3';
  for (const r of [FRAG, MOVING, HIT]) for (const v of ['t2', 't3']) VOICED.clips.add(`${RULES[r]!.id}.${v}`);
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

it('hears shouts out to earshot, and the radio from anywhere', () => {
  const { voices } = setup();
  expect(voices.say(line(MOVING, man(EARSHOT + 5), 0))).toBe(false);
  expect(voices.say(line(RADIO, man(EARSHOT + 50), 0, { squad: 'Charlie' }))).toBe(true);
  expect(voices.pool.find(p => p.playing)!.radio).toBe(true);
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
  for (let i = 0; i < 3; i++) voices.say(line(MOVING, man(5 + i), 0));
  expect(voices.say(line(HIT, man(9), 0))).toBe(false);
  expect(voices.say(line(FRAG, man(4), 0))).toBe(true);
  voices.update(0, false);
  const frag = voices.pool.find(p => p.audio.src.includes('frag'))!;
  expect((frag.audio as unknown as FakeAudio).volume).toBe(1);
  const under = audios.filter(a => a.src.includes('moving') && !a.paused);
  expect(under.length).toBe(2);
  for (const a of under) expect(a.volume).toBeLessThan(0.4);
});

it('is silent with the enemy voices turned down', () => {
  const { voices, settings } = setup();
  settings.voices = 0;
  expect(voices.say(line(MOVING, man(5), 0))).toBe(false);
});
