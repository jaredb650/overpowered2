/**
 * Web Audio does not exist under Node, so what is tested here is everything around it: the catalogue, the voice
 * rules, the distance model, the analysis itself and, when a browser run has left it behind, the measurements of
 * every real render in tools/out/audio-report.json.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PerkId, PickupKind, PowerupId } from '../core/gameplay';
import type { SurfaceKind } from '../core/contracts';
import { arbitrate, type VoiceSlot } from './allocator';
import { analyze, checkStats, loudness, type AudioStats } from './analyze';
import { audibleSpan } from './bank';
import { LoadGovernor, VOICE_BUDGETS, quietFloor, repeatGap } from './budget';
import { ALIASES, CATALOG, lookup, renderRank } from './catalog';
import { ROOMS, ROOM_IDS, generateImpulse, measureT60, roomForZone } from './reverb';
import { airCutoff, attenuation, wetness } from './voices';

const RATE = 48000;

function sine(freq: number, seconds: number, envelope: (t: number) => number = () => 1): Float32Array {
  const out = new Float32Array(Math.floor(seconds * RATE));
  for (let i = 0; i < out.length; i++) out[i] = Math.sin((2 * Math.PI * freq * i) / RATE) * envelope(i / RATE);
  return out;
}

describe('catalogue', () => {
  it('resolves every alias, group member and stack layer', () => {
    for (const [alias, target] of Object.entries(ALIASES)) expect(CATALOG.has(target), `${alias} -> ${target}`).toBe(true);
    for (const def of CATALOG.values()) {
      for (const member of def.members ?? []) expect(lookup(member), `${def.id} member ${member}`).toBeDefined();
      for (const layer of def.layers ?? []) expect(lookup(layer.id), `${def.id} layer ${layer.id}`).toBeDefined();
    }
  });

  it('covers every id built from a string', () => {
    const surfaces: SurfaceKind[] = ['concrete', 'metal', 'grate', 'dirt', 'glass', 'flesh', 'armor', 'energy', 'lava'];
    const perks: PerkId[] = ['bloodthirst', 'hellfire', 'berserk', 'adrenaline', 'slowmo', 'sentinels', 'chainStorm', 'butcher', 'skyfall', 'chainReaction', 'overdrive'];
    const powerups: PowerupId[] = ['quad', 'haste', 'vampire', 'ricochet', 'shock', 'ghost', 'magnet', 'regen', 'frostNova', 'timeWarp'];
    const pickups: PickupKind[] = ['health', 'ammo', 'armor', 'megaHealth', 'heavyArmor', 'weaponCache', ...powerups];
    const zones = ROOM_IDS as readonly string[];
    const ids = [
      ...surfaces.map(s => `impact_${s}`), ...surfaces.map(s => `footstep_${s}`), ...perks.map(p => `perk_${p}`),
      ...powerups.map(p => `powerup_${p}`), ...pickups.map(p => `pickup_${p}`), ...zones.map(z => `amb_${z}`),
    ];
    for (const id of ids) expect(lookup(id), id).toBeDefined();
  });

  it('resolves every sound id used anywhere in the game', () => {
    const root = join(__dirname, '..');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
          if (name !== 'audio' && name !== 'sandbox') walk(path);
        } else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) files.push(path);
      }
    };
    walk(root);
    // Anything on a line that reaches audio, or fills a field that later does. Ids always contain an underscore.
    const audible = /audio|[sS]ound|Foley|voice|[lL]oop\b|say\(|tell|extra|shockwave\(/;
    const notIds = /^(fx|ui|hud|sfx|run|wave|player|enemy|perk|world|combo|score|weapon|pickup|callin)_?$/;
    const unknown: string[] = [];
    for (const file of files) {
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        if (!audible.test(line) || line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) continue;
        for (const m of line.matchAll(/'([a-zA-Z0-9]+_[a-zA-Z0-9_]+)'/g)) {
          const id = m[1]!;
          if (!notIds.test(id) && !lookup(id)) unknown.push(`${file.slice(root.length + 1)}: ${id}`);
        }
      }
    }
    expect(unknown).toEqual([]);
  });

  it('matches the published list in docs/notes/audio.md', () => {
    const doc = readFileSync(join(__dirname, '../../docs/notes/audio.md'), 'utf8');
    const named = new Set([...doc.matchAll(/`([a-zA-Z0-9_]+)`/g)].map(m => m[1]!));
    const missing = [...CATALOG.keys()].filter(id => !named.has(id));
    expect(missing).toEqual([]);
  });

  it('renders what a run reaches first before what it reaches last', () => {
    const rank = (id: string) => renderRank(CATALOG.get(id)!, 0);
    expect(rank('impact_concrete')).toBeLessThan(rank('limb_sever'));
    expect(rank('limb_sever')).toBeLessThan(rank('perk_sentinels'));
    expect(rank('perk_sentinels')).toBeLessThan(rank('titan_roar'));
    expect(renderRank(CATALOG.get('impact_concrete')!, 1)).toBeLessThan(rank('limb_sever'));
  });
});

describe('sample trimming', () => {
  it('starts enemy_headshot3 style samples on their attack, skipping the silence', () => {
    const seconds = 2;
    const data = new Float32Array(seconds * RATE);
    const onset = Math.floor(0.8 * RATE);
    for (let i = onset; i < RATE * 1.4; i++) data[i] = Math.sin(i * 0.05) * Math.exp(-(i - onset) / (RATE * 0.2)) * 0.7;
    const { start, end } = audibleSpan([data], RATE);
    expect(start / RATE).toBeGreaterThan(0.79);
    expect(start / RATE).toBeLessThanOrEqual(0.8);
    expect(end / RATE).toBeLessThan(1.5);
  });
});

describe('voice rules', () => {
  const slot = (over: Partial<VoiceSlot>): VoiceSlot => ({
    soundId: 'a', family: undefined, priority: 5, critical: false, order: 0, loudness: 0.5, releasing: false, loop: false, ...over,
  });
  const free = () => slot({ soundId: null });
  const request = { id: 'a', maxVoices: 2, priority: 5, critical: false };

  it('retriggers the oldest voice at an id cap, which is the first game SMG and shell stutter', () => {
    const voices = [slot({ order: 3 }), slot({ order: 1 }), free(), free()];
    const d = arbitrate(voices, request);
    expect(d.kind).toBe('steal');
    if (d.kind === 'steal') expect(d.victim.order).toBe(1);
  });

  it('never lets a weak sound cut a strong one when the pool is full', () => {
    const voices = [slot({ soundId: 'x', priority: 9 }), slot({ soundId: 'y', priority: 9 })];
    expect(arbitrate(voices, { ...request, maxVoices: 4, priority: 3 }).kind).toBe('drop');
    expect(arbitrate(voices, { ...request, maxVoices: 4, priority: 9 }).kind).toBe('steal');
  });

  it('never refuses a critical sound, whatever the mix is full of', () => {
    const shot = { id: 'gun', maxVoices: 4, priority: 8, critical: true };
    const blasts = [slot({ soundId: 'x', priority: 10 }), slot({ soundId: 'y', priority: 10 })];
    expect(arbitrate(blasts, shot).kind).toBe('steal');
    const allCritical = [slot({ soundId: 'x', priority: 9, critical: true }), slot({ soundId: 'y', priority: 9, critical: true })];
    expect(arbitrate(allCritical, shot).kind).toBe('steal');
    const allFading = [slot({ soundId: 'x', releasing: true }), slot({ soundId: 'y', releasing: true })];
    expect(arbitrate(allFading, shot).kind).toBe('steal');
    expect(arbitrate(allFading, request).kind).toBe('drop');
  });

  it('protects critical voices from everything that is not critical', () => {
    const voices = [slot({ soundId: 'gun', priority: 1, critical: true }), slot({ soundId: 'x', priority: 9 })];
    const d = arbitrate(voices, { ...request, id: 'b', maxVoices: 4, priority: 9 });
    expect(d.kind).toBe('steal');
    if (d.kind === 'steal') expect(d.victim.soundId).toBe('x');
    const guarded = [slot({ soundId: 'gun', priority: 1, critical: true })];
    expect(arbitrate(guarded, { ...request, id: 'b', maxVoices: 4, priority: 9 }).kind).toBe('drop');
  });

  it('treats a spent budget like a full pool, even with free voices left', () => {
    const voices = [slot({ soundId: 'x', priority: 2 }), slot({ soundId: 'y', priority: 6 }), free(), free()];
    expect(arbitrate(voices, { ...request, id: 'b', maxVoices: 4 }, 4).kind).toBe('free');
    const d = arbitrate(voices, { ...request, id: 'b', maxVoices: 4 }, 2);
    expect(d.kind).toBe('steal');
    if (d.kind === 'steal') expect(d.victim.soundId).toBe('x');
    expect(arbitrate(voices, { ...request, id: 'b', maxVoices: 4, priority: 1 }, 2)).toEqual({ kind: 'drop', reason: 'budget' });
  });

  it('caps a family, cutting its weakest and sparing better sounds', () => {
    const voices = [slot({ soundId: 'x', family: 'f', priority: 2 }), slot({ soundId: 'y', family: 'f', priority: 6 }), free()];
    const d = arbitrate(voices, { ...request, family: 'f', familyMax: 2, maxVoices: 4, priority: 4 });
    expect(d.kind).toBe('steal');
    if (d.kind === 'steal') expect(d.victim.soundId).toBe('x');
  });
});

describe('budget', () => {
  it('leaves a normal fight alone and thins a full one', () => {
    expect(quietFloor(0.5)).toBe(quietFloor(0));
    expect(repeatGap(0.5)).toBe(0);
    expect(quietFloor(1)).toBeGreaterThan(quietFloor(0.8));
    expect(quietFloor(0.8)).toBeGreaterThan(quietFloor(0.5));
    expect(repeatGap(1)).toBeGreaterThan(repeatGap(0.8));
    expect(repeatGap(3)).toBe(repeatGap(1));
  });

  it('gives voices up when the clock falls behind, and takes them back slowly', () => {
    const g = new LoadGovernor();
    g.sample(1, 1, 0);
    expect(g.budget).toBe(VOICE_BUDGETS[0]);
    g.sample(0.9, 1, 0.5);
    expect(g.budget).toBe(VOICE_BUDGETS[1]);
    g.sample(0.9, 1, null);
    expect(g.budget).toBe(VOICE_BUDGETS[2]);
    g.sample(0.5, 1, 0.9);
    expect(g.budget).toBe(VOICE_BUDGETS[2]);
    g.sample(1, 1, null);
    expect(g.step).toBe(2);
    for (let i = 0; i < 5; i++) g.sample(1, 1, 0);
    expect(g.step).toBe(1);
    for (let i = 0; i < 6; i++) g.sample(1, 1, 0);
    expect(g.step).toBe(0);
  });

  it('believes counted underruns over a clock read across one long frame', () => {
    const g = new LoadGovernor();
    g.sample(0.9, 1, 0);
    expect(g.step).toBe(0);
  });

  it('ignores a window with no time in it', () => {
    const g = new LoadGovernor();
    g.sample(0, 0, null);
    expect(g.step).toBe(0);
  });
});

describe('sample packs', () => {
  const packs = [...CATALOG.values()].filter(d => d.files);
  const credits = readFileSync(join(__dirname, '../../docs/CREDITS.md'), 'utf8');

  it('exist on disk, are credited, and have a synthesized way out', () => {
    expect(packs.length).toBeGreaterThan(10);
    for (const def of packs) {
      expect(lookup(def.fallback!)?.kind, `${def.id} fallback`).toBe('synth');
      expect(def.files!.length, def.id).toBeGreaterThanOrEqual(3);
      for (const file of def.files!) {
        expect(statSync(join(__dirname, '../../public/audio/sfx', file)).size, file).toBeGreaterThan(1000);
        expect(credits, file).toContain(file.split('/').pop()!);
      }
    }
  });

  it('leaves nothing in the folder that the catalogue does not use', () => {
    const used = new Set(packs.flatMap(d => d.files!.map(f => f.split('/').pop()!)));
    const onDisk = readdirSync(join(__dirname, '../../public/audio/sfx/gore')).filter(f => f.endsWith('.mp3'));
    expect(onDisk.filter(f => !used.has(f))).toEqual([]);
  });

  it('never stand in the way of what must be heard', () => {
    for (const def of packs) expect(def.critical, def.id).toBe(false);
    for (const id of ['smg_fire', 'hit_marker', 'hit_marker_head', 'enemy_headshot', 'perk_slowmo', 'perk_overdrive', 'minigun_fire_loop']) {
      expect(lookup(id)!.critical, id).toBe(true);
    }
  });
});

describe('distance', () => {
  it('is flat inside near, falls after it, and is silent at far', () => {
    expect(attenuation(3, 5, 90)).toBe(1);
    expect(attenuation(40, 5, 90)).toBeLessThan(attenuation(20, 5, 90));
    expect(attenuation(90, 5, 90)).toBe(0);
  });

  it('darkens with range', () => {
    expect(airCutoff(100)).toBeLessThan(airCutoff(20));
    expect(airCutoff(5000)).toBeGreaterThanOrEqual(500);
  });

  it('gets wetter against the direct sound with range, but the room itself still fades', () => {
    const near = 5;
    const far = 90;
    const ratio = (d: number) => wetness(d, near, attenuation(d, near, far)) / attenuation(d, near, far);
    expect(ratio(60)).toBeGreaterThan(ratio(20));
    expect(wetness(80, near, attenuation(80, near, far))).toBeLessThan(wetness(6, near, attenuation(6, near, far)));
    expect(wetness(far, near, 0)).toBe(0);
  });
});

describe('rooms', () => {
  it('measure close to their spec, and the Foundry is the longest', () => {
    const times = ROOM_IDS.map(id => {
      const [left] = generateImpulse(ROOMS[id], RATE, 7);
      const t60 = measureT60(left, RATE);
      expect(t60, id).toBeGreaterThan(ROOMS[id].t60[1] * 0.7);
      expect(t60, id).toBeLessThan(Math.max(...ROOMS[id].t60) * 1.25);
      return { id, t60 };
    });
    expect(times.sort((a, b) => b.t60 - a.t60)[0]!.id).toBe('foundry');
  });

  it('map every world zone', () => {
    for (const id of ROOM_IDS) expect(roomForZone(id)).toBe(id);
    expect(roomForZone(null)).toBe('core');
  });
});

describe('analysis', () => {
  it('reads level and envelope from a known decaying tone', () => {
    const s = analyze([sine(1000, 1, t => 0.8 * Math.exp(-t * 12))], RATE);
    expect(s.peak).toBeGreaterThan(0.75);
    expect(s.peak).toBeLessThan(0.81);
    expect(s.attackMs).toBeLessThan(5);
    expect(s.decaySeconds).toBeGreaterThan(0.25);
    expect(s.decaySeconds).toBeLessThan(0.5);
    expect(Math.abs(s.centroid - 1000)).toBeLessThan(150);
  });

  it('reads a slow swell as a slow attack', () => {
    expect(analyze([sine(440, 1, t => t * 0.8)], RATE).attackMs).toBeGreaterThan(700);
  });

  it('fails silence, clipping, NaN and DC', () => {
    const fails = (data: Float32Array) => checkStats(analyze([data], RATE), undefined, false, 0.89);
    expect(fails(new Float32Array(RATE)).join()).toMatch(/silent/);
    const clipped = sine(200, 0.5, () => 1.4).map(v => Math.max(-1, Math.min(1, v)));
    expect(fails(clipped).join()).toMatch(/clipped/);
    const nan = sine(200, 0.5, () => 0.89);
    nan[100] = Number.NaN;
    expect(fails(nan).join()).toMatch(/non-finite/);
    expect(fails(sine(200, 0.5, () => 0.6).map(v => v + 0.29)).join()).toMatch(/dc offset/);
  });

  it('finds a sustained tone louder than a click of the same peak', () => {
    const click = new Float32Array(RATE / 2);
    click[1000] = 0.9;
    expect(loudness([sine(1000, 0.5, () => 0.9)], RATE)).toBeGreaterThan(loudness([click], RATE) * 5);
  });
});

/** Written by tools/scripts/audio-report.mjs from real renders in Chrome. */
const reportPath = join(__dirname, '../../tools/out/audio-report.json');
const report = existsSync(reportPath)
  ? JSON.parse(readFileSync(reportPath, 'utf8')) as { failures: number; lines: { id: string; kind: string; stats: AudioStats[]; failures: string[] }[] }
  : null;

describe.skipIf(!report)('real renders', () => {
  const synths = report?.lines.filter(l => l.kind === 'synth') ?? [];

  it('covers every synthesized id', () => {
    const expected = [...CATALOG.values()].filter(d => d.kind === 'synth').map(d => d.id).sort();
    expect(synths.map(l => l.id).sort()).toEqual(expected);
  });

  it('passes every recipe check', () => {
    expect(report!.lines.filter(l => l.failures.length > 0).map(l => `${l.id}: ${l.failures.join('; ')}`)).toEqual([]);
  });

  it('keeps level inside bounds and every envelope finite', () => {
    for (const line of synths) {
      for (const s of line.stats) {
        expect(s.nan, line.id).toBe(0);
        expect(s.peak, line.id).toBeLessThan(1);
        expect(s.rms, line.id).toBeGreaterThan(0.002);
        expect(s.seconds, line.id).toBeGreaterThanOrEqual(0.015);
      }
    }
  });

  it('lets a hit ring out rather than get cut off', () => {
    for (const line of synths) {
      // A radio clicks off, which is the one hit that is meant to end on a hard edge.
      if (CATALOG.get(line.id)!.loop || line.id === 'vox_radio') continue;
      for (const s of line.stats) if (s.attackMs < 30) expect(s.tail, line.id).toBeLessThan(0.5);
    }
  });
});
