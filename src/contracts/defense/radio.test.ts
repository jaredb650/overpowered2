/**
 * Outpost Defense's radio: the Council names where a wave comes from, one speaker at a time with her warnings never dropped, the
 * Commander says only his fort lines, those lines are text with no recording, and the player's men call out on the feed.
 */
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { Ctx, GameEvents } from '../../core/contracts';
import { EventBus } from '../../core/events';
import { mulberry32 } from '../../core/math';
import { DIR_WORDS, FIRST, isDefenseLine, lineById, LINES, orderLine, PLAYER_DOWN, sidesWord, slotsOf, textOnly } from '../../enemies/commander/lines';
import type { CommsLine } from '../../enemies/outpost/events';
import { spoken } from '../../ui/commander/pick';
import { SHOP_ORDER, SHOPS } from './data';
import { airtime, Airwaves, DefenseRadio } from './radio';
import { planWave } from './waves';

interface Said { at: number; id: string; text: string }

const FRAME = 1 / 60;

function rig(fronts: number[] = [0, 1], seed = 3) {
  const events = new EventBus<GameEvents>();
  const time = { realDt: FRAME };
  const shops = Object.fromEntries(SHOP_ORDER.map(id => [id, { health: SHOPS[id].health, get lost() { return this.health <= 0; } }]));
  const director = {
    wave: 0, phase: 'intermission', nextWaveIn: 20, plan: null as ReturnType<typeof planWave> | null, fronts,
    siege: { satchels: [], teams: [], pads: [], covers: [], counts: { salvos: 0 } },
  };
  const up = (label: string, x: number, z: number) => ({ state: 'up', def: { label }, center: new THREE.Vector3(x, 1, z), reloadUntil: 0 });
  const allies = { allies: [up('Rifleman', 0, -52), up('Machine gunner', 52, 0)] };
  const ctx = {
    events, time, waves: director, allies,
    contracts: { defense: { needLoadout: false, shops } },
    world: { objects: { structures: [] } },
    enemies: { vehicles: { live: [] } },
  } as unknown as Ctx;
  const radio = new DefenseRadio(ctx, mulberry32(seed));
  radio.init();
  radio.reset();
  const said: Said[] = [];
  const feed: CommsLine[] = [];
  let clock = 0;
  events.on('commander:bark', e => said.push({ at: clock, id: e.id, text: spoken(lineById(e.id)!, e.vars ?? {}, null).text }));
  events.on('comms:line', e => feed.push({ ...e, position: e.position.clone() }));
  const run = (seconds: number) => {
    for (let t = 0; t < seconds; t += FRAME) {
      clock += FRAME;
      radio.update();
    }
  };
  const start = (wave: number) => {
    director.wave = wave;
    director.plan = planWave(wave, mulberry32(wave));
    director.phase = 'spawning';
    events.emit('wave:start', { wave, total: 10, boss: director.plan.boss !== null });
  };
  return { ctx, events, radio, director, said, feed, run, start, allies };
}

describe('the Council on the fort', () => {
  it('names the wave and every side it comes from when it starts', () => {
    const r = rig([3, 0]);
    r.run(1);
    r.start(4);
    r.run(15);
    const council = r.said.filter(s => s.id.startsWith('council.def.wave.'));
    expect(council).toHaveLength(1);
    expect(council[0]!.text).toContain('north and west');
    expect(council[0]!.text).toContain('Wave 4');
    // He threatens first, then she says what is actually coming.
    const i = r.said.findIndex(s => s.id.startsWith('council.def.wave.'));
    expect(r.said[i - 1]!.id).toMatch(/^cmd\.def\.(wave|long)\./);
  });

  it('names a boss wave for what it is', () => {
    const r = rig([0, 1, 2, 3]);
    r.run(1);
    r.start(5);
    r.run(15);
    const line = r.said.find(s => s.id === 'council.def.boss.tanks');
    expect(line?.text).toBe('Wave 5. Armour. Tanks will come up the roads. Infantry from the north, east, south and west.');
    expect(r.said.some(s => s.id === 'cmd.def.armour.bitch')).toBe(true);
  });

  it('says the sides in compass order, every set of them', () => {
    expect(sidesWord([2, 0])).toBe('north and south');
    expect(sidesWord([3, 1, 0])).toBe('north, east and west');
    expect(new Set(DIR_WORDS).size).toBe(15);
  });

  it('calls a breach by ring and side, a tank by its road, and a shop under attack', () => {
    const r = rig();
    r.run(1);
    r.start(7);
    r.run(14);
    (r.ctx.enemies as unknown as { vehicles: { live: object[] } }).vehicles.live.push({ def: { kind: 'tank' }, position: new THREE.Vector3(0, 0, 110) });
    (r.ctx.contracts.defense as unknown as { shops: Record<string, { health: number }> }).shops.armoury!.health -= 40;
    r.run(30);
    const ids = r.said.map(s => s.id);
    expect(r.said.find(s => s.id.startsWith('council.def.tank.'))?.text).toMatch(/south/);
    expect(ids).toContain('council.def.shop.armoury');
    expect(r.feed.some(l => l.kind === 'ally' && /Tank|Armour/.test(l.text) && /south|South/.test(l.text))).toBe(true);
  });
});

describe('one speaker at a time', () => {
  it('never puts a line up before the last has had its time, and drops none of her warnings', () => {
    const sent: { at: number; id: string; text: string }[] = [];
    let clock = 0;
    const air = new Airwaves((id, vars) => sent.push({ at: clock, id, text: spoken(lineById(id)!, vars ?? {}, null).text }));
    const warn = ['council.def.breach.outer', 'council.def.tank.a', 'council.def.shop.barracks', 'council.def.mortar.a', 'council.def.chopper.a'];
    air.push('cmd.def.armour.bitch', undefined, false);
    air.push('council.def.tank.a', { dir: 'north' }, true);
    air.update(FRAME);
    for (let k = 0; k < 6; k++) air.push(`cmd.def.wave.${['shed', 'key', 'lunch', 'again', 'memo', 'cooks'][k]}`, undefined, false);
    for (const id of warn) air.push(id, { dir: 'east' }, true);
    for (let t = 0; t < 60; t += FRAME) {
      clock += FRAME;
      air.update(FRAME);
    }
    for (let i = 1; i < sent.length; i++) expect(sent[i]!.at - sent[i - 1]!.at).toBeGreaterThanOrEqual(airtime(sent[i - 1]!.text));
    for (const id of warn) expect(sent.some(s => s.id === id), id).toBe(true);
    expect(sent[0]!.id).toBe('cmd.def.armour.bitch');
    expect(sent.filter(s => s.id.startsWith('cmd.')).length).toBeLessThan(7);
  });

  it('keeps a busy wave paced: nothing overlaps over a long fight', () => {
    const r = rig([0, 1, 2]);
    r.run(1);
    for (let wave = 1; wave <= 12; wave++) {
      r.start(wave);
      for (let k = 0; k < 30; k++) r.events.emit('enemy:killed', {} as GameEvents['enemy:killed']);
      r.events.emit('vehicle:destroyed', { kind: 'tank', source: 'player', position: new THREE.Vector3() });
      r.run(5);
      r.director.phase = 'intermission';
      r.events.emit('wave:clear', { wave, bonus: 0 });
      r.run(8);
    }
    for (let i = 1; i < r.said.length; i++) expect(r.said[i]!.at - r.said[i - 1]!.at).toBeGreaterThanOrEqual(airtime(r.said[i - 1]!.text));
    expect(r.said.filter(s => s.id.startsWith('council.def.wave.') || s.id.startsWith('council.def.boss.'))).toHaveLength(12);
  });
});

describe('the Commander on the fort', () => {
  it('says only his fort lines, never one twice in a run until he has used them all', () => {
    const r = rig();
    r.run(1);
    for (let wave = 1; wave <= 9; wave++) {
      r.start(wave);
      r.run(20);
      r.director.phase = 'intermission';
      r.events.emit('wave:clear', { wave, bonus: 0 });
      r.run(20);
    }
    const his = r.said.filter(s => lineById(s.id)!.speaker === 'commander').map(s => s.id);
    expect(his.length).toBeGreaterThan(9);
    for (const id of his) expect(id).toMatch(/^cmd\.def\./);
    const waves = his.filter(id => id.startsWith('cmd.def.wave.'));
    expect(new Set(waves).size).toBe(waves.length);
  });

  it('keeps the Kill House off the fort: the box refuses his old lines there', () => {
    for (const l of [...FIRST, ...PLAYER_DOWN, orderLine('flank'), lineById('cmd.door.smug.office')!]) expect(isDefenseLine(l.id), l.id).toBe(false);
    expect(lineById('cmd.def.armour.bitch')?.text).toBe('I\'m putting armour on your bitch ass.');
  });

  it('has dozens of lines, every one text with no take yet, and only slots a session could record', () => {
    const fort = LINES.filter(l => isDefenseLine(l.id));
    const his = fort.filter(l => l.speaker === 'commander');
    expect(his.length).toBeGreaterThanOrEqual(60);
    expect(new Set(his.map(l => l.emotion)).size).toBe(4);
    const clips = new Set((JSON.parse(readFileSync('public/audio/voice/manifest.json', 'utf8')) as { clips: string[] }).clips);
    for (const l of fort) {
      const slots = slotsOf(l.text);
      expect(l.text.length, l.id).toBeLessThan(140);
      expect(textOnly(l) || slots.every(s => s === 'dir'), l.id).toBe(true);
      for (const dir of [undefined, ...DIR_WORDS]) {
        const clip = spoken(l, { n: 4, dir }, null).clip;
        expect(clip === null || !clips.has(clip), l.id).toBe(true);
      }
      expect([...clips].some(c => c.startsWith(l.id)), l.id).toBe(false);
    }
  });
});

describe('the player\'s men on the feed', () => {
  it('call contact by side once, a man down at once, and nothing when nobody is standing', () => {
    const r = rig();
    r.run(1);
    r.start(2);
    const spawn = (x: number, z: number) => r.events.emit('enemy:spawned', { enemy: { id: 'trooper', position: new THREE.Vector3(x, 0, z) } as never });
    spawn(-20, -106);
    r.run(0.1);
    spawn(20, -107);
    r.run(3);
    const contacts = r.feed.filter(l => /Contact|Movement|Eyes on/.test(l.text));
    expect(contacts).toHaveLength(1);
    expect(contacts[0]!.text.toLowerCase()).toContain('north');
    expect(contacts[0]!.speaker).toBe('Rifleman');
    expect(contacts[0]!.kind).toBe('ally');
    r.events.emit('ally:down', { ally: { def: { label: 'Machine gunner' }, center: new THREE.Vector3(52, 1, 0) } as never });
    expect(r.feed[r.feed.length - 1]!.text).toMatch(/Man down|hit|medic/);
    for (const a of r.allies.allies) a.state = 'down';
    const before = r.feed.length;
    spawn(110, 0);
    r.run(1);
    expect(r.feed).toHaveLength(before);
  });
});
