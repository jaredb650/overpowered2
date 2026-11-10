/**
 * Web Audio does not exist under Node, so what is tested here is everything around it: the catalogue, the voice
 * rules, the distance model, the analysis itself and, when a browser run has left it behind, the measurements of
 * every real render in tools/out/audio-report.json.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { DamageResult, EnemyInstance, PerkId, PickupKind, PowerupId } from '../core/gameplay';
import type { AudioSystem, Ctx, DamageType, PlayOptions, SurfaceKind } from '../core/contracts';
import { makeCtx } from '../sandbox/harness';
import { arbitrate, type VoiceSlot } from './allocator';
import { analyze, checkStats, loudness, type AudioStats } from './analyze';
import { audibleSpan } from './bank';
import { LoadGovernor, VOICE_BUDGETS, quietFloor, repeatGap } from './budget';
import { ALIASES, CATALOG, lookup, renderRank, type SoundDef } from './catalog';
import { MIX } from './mix';
import { Reactions, bodyHitLevels, hitWeight } from './reactions';
import { ROOMS, ROOM_IDS, generateImpulse, measureT60, roomForZone } from './reverb';
import { trimFor } from './synth/render';
import { airCutoff, attenuation, wetness } from './voices';
import { TUNING, WEAPONS } from '../weapons/data';

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

/** A weapon's round as the hit sees it: its damage, pellets as pellets, and its push. */
function weightOf(id: keyof typeof WEAPONS, force: number = WEAPONS[id].force): number {
  const w = WEAPONS[id];
  return hitWeight(w.damage, w.pellets > 1 ? 'pellet' : 'bullet', force);
}

describe('body hits', () => {
  const def = (id: string): SoundDef => lookup(id)!;

  it('weighs a round by what it is: Buzzsaw, SMG, pellets, Judge, then the heaviest', () => {
    const buzzsaw = weightOf('buzzsaw');
    const smg = weightOf('smg');
    const pellets = weightOf('shotgun');
    const judge = weightOf('judge');
    const stake = weightOf('stakegun');
    expect(buzzsaw).toBeLessThan(smg);
    expect(smg).toBeLessThan(pellets);
    expect(pellets).toBeLessThan(judge);
    expect(judge).toBeLessThan(stake);
    expect(weightOf('lance')).toBe(1);
    expect(smg).toBeLessThan(0.35);
    // A point-blank blast carries its full push, and lands as one of the heaviest things in the game.
    expect(weightOf('shotgun', WEAPONS.shotgun.force * TUNING.shotgun.pointBlankForce)).toBeGreaterThan(0.95);
    expect(hitWeight(0, 'bullet', 0)).toBe(0);
    expect(hitWeight(Number.NaN, 'bullet', 0)).toBe(0);
  });

  it('lands heavier rounds louder and lower, under one curve', () => {
    let last = bodyHitLevels(0);
    for (let w = 0.1; w <= 1.0001; w += 0.1) {
      const l = bodyHitLevels(w);
      expect(l.punchVolume).toBeGreaterThan(last.punchVolume);
      expect(l.punchPitch).toBeLessThan(last.punchPitch);
      expect(l.confirmVolume).toBeGreaterThan(last.confirmVolume);
      expect(l.gap).toBeLessThanOrEqual(last.gap);
      last = l;
    }
    expect(bodyHitLevels(2)).toEqual(bodyHitLevels(1));
  });

  it('plays every SMG round, even a frame early, and turns the Buzzsaw stream into a beat', () => {
    const frame = 1 / 60;
    expect(bodyHitLevels(weightOf('smg')).gap).toBeLessThan(WEAPONS.smg.interval - frame);
    expect(bodyHitLevels(weightOf('judge')).gap).toBeLessThan(WEAPONS.judge.interval);
    const buzzsaw = bodyHitLevels(weightOf('buzzsaw')).gap;
    expect(buzzsaw / WEAPONS.buzzsaw.interval).toBeGreaterThan(5);
    expect(1 / buzzsaw).toBeLessThan(10);
  });

  it('keeps a hit 30 m away inside hearing, where the old curve had it at an eighth', () => {
    expect(attenuation(30, 5, 55)).toBeLessThan(0.13);
    expect(attenuation(30, def('bullet_body').near, def('bullet_body').far)).toBeGreaterThan(0.25);
    expect(attenuation(30, def('hit_punch').near, def('hit_punch').far)).toBeGreaterThan(0.38);
    expect(attenuation(30, def('machine_clang').near, def('machine_clang').far)).toBeGreaterThan(0.3);
    expect(attenuation(60, def('hit_punch').near, def('hit_punch').far)).toBeGreaterThan(0.15);
  });

  it('gives body hits their own voices, one transient a frame, above landings and below blasts', () => {
    const living = ['bullet_body', 'hit_punch', 'hit_confirm', 'machine_clang'];
    for (const id of living) {
      const d = def(id);
      expect(d.family, id).toBeUndefined();
      expect(d.priority, id).toBeGreaterThan(MIX.flesh.priority);
      expect(d.priority, id).toBeLessThan(MIX.blast.priority);
      expect(d.maxVoices, id).toBeLessThanOrEqual(3);
      // A shotgun blast is one hit. A second wet layer on its frame only added level, and at point blank pushed the limiter.
      expect(d.perFrame, id).toBe(1);
    }
    // The dead are struck on the same frames under ids of their own, so they cannot take a living hit's start or voices.
    for (const id of ['corpse_body', 'corpse_punch']) {
      const d = def(id);
      expect(d.family, id).toBe('flesh');
      for (const hit of living) expect(d.priority, `${id} under ${hit}`).toBeLessThan(def(hit).priority);
    }
    // Under the headshot's own layers, which are what a head is meant to sound like.
    expect(def('hit_punch').priority).toBeLessThan(def('enemy_headshot').priority);
    expect(def('hit_confirm').priority).toBeLessThan(def('enemy_headshot').priority);
  });

  it('leaves the world its metal: doors, shutters, snares and rams keep the clank they had', () => {
    const world = def('metal_clang');
    expect({ ...world, recipe: undefined }).toEqual({ ...MIX.impact, volume: 0.46, send: 0.22, id: 'metal_clang', kind: 'synth', loop: false, recipe: undefined });
    // The same plate, rendered by the same build.
    expect(def('machine_clang').recipe!.build).toBe(world.recipe!.build);
  });

  it('builds the layers from approved recordings and a metal that is not flesh', () => {
    expect(def('hit_punch').files!.every(f => /^gore\/limb_thud_\d\.mp3$/.test(f))).toBe(true);
    expect(def('hit_confirm').files!.every(f => /^gore\/wet_slap_[1-4]\.mp3$/.test(f))).toBe(true);
    expect(def('corpse_body').files).toEqual(def('bullet_body').files);
    expect(def('corpse_punch').files).toEqual(def('hit_punch').files);
    const machine = def('machine_hit');
    expect(machine.kind).toBe('stack');
    expect(machine.layers!.map(l => l.id)).toEqual(['machine_clang']);
    expect(machine.layers![0]!.duration).toBeLessThan(0.3);
    expect(def('machine_clang').kind).toBe('synth');
  });
});

describe('body hit reactions', () => {
  interface Played { id: string; volume: number; pitch: number; spatial: boolean }
  const rig = () => {
    const ctx = makeCtx({ enemies: { alive: [] } as unknown as Ctx['enemies'] });
    const plays: Played[] = [];
    const audio = {
      play: (id: string, o: PlayOptions = {}) => plays.push({ id, volume: o.volume ?? 1, pitch: o.pitch ?? 1, spatial: o.position !== undefined }),
    } as unknown as AudioSystem;
    const reactions = new Reactions(ctx, audio);
    const hit = (source: string, type: DamageType, amount: number, force: number, over: Partial<DamageResult> = {}, enemy = 'trooper') => {
      ctx.events.emit('enemy:hit', {
        enemy: { id: enemy, machine: enemy === 'drone', center: new Vector3() } as unknown as EnemyInstance,
        damage: { amount, type, point: new Vector3(4, 1, 20), dir: new Vector3(0, 0, 1), force, source },
        result: { dealt: amount, killed: false, headshot: false, severed: [], blocked: false, ...over },
      });
    };
    // Audio runs after Weapons and Combat, so the end of the frame is where a held hit lands.
    const endFrame = () => reactions.update(1 / 60, null);
    const frames = (n: number) => {
      for (let i = 0; i < n; i++) {
        endFrame();
        ctx.time.tick(1 / 60);
      }
    };
    const count = (id: string) => plays.filter(p => p.id === id).length;
    return { ctx, plays, hit, endFrame, frames, count };
  };

  it('lands an SMG round as a punch where it struck and a 2D confirmation, every round at 10 a second', () => {
    const r = rig();
    for (let i = 0; i < 10; i++) {
      r.hit('smg', 'bullet', WEAPONS.smg.damage, WEAPONS.smg.force);
      r.frames(6);
    }
    expect(r.count('hit_punch')).toBe(10);
    expect(r.count('hit_confirm')).toBe(10);
    expect(r.plays.find(p => p.id === 'hit_punch')!.spatial).toBe(true);
    expect(r.plays.find(p => p.id === 'hit_confirm')!.spatial).toBe(false);
    expect(r.count('hit_marker')).toBe(10);
  });

  it('hears six pellets on one frame as one heavier hit', () => {
    const r = rig();
    r.hit('smg', 'bullet', WEAPONS.smg.damage, 0);
    r.endFrame();
    const smg = r.plays.find(p => p.id === 'hit_punch')!;
    r.frames(30);
    r.plays.length = 0;
    for (let i = 0; i < 6; i++) r.hit('shotgun', 'pellet', WEAPONS.shotgun.damage, WEAPONS.shotgun.force);
    r.endFrame();
    expect(r.count('hit_punch')).toBe(1);
    expect(r.count('hit_confirm')).toBe(1);
    const pellets = r.plays.find(p => p.id === 'hit_punch')!;
    expect(pellets.volume).toBeGreaterThan(smg.volume);
    expect(pellets.pitch).toBeLessThan(smg.pitch);
  });

  it('turns a Buzzsaw stream into a beat', () => {
    const r = rig();
    for (let i = 0; i < 60; i++) {
      r.hit('buzzsaw', 'bullet', WEAPONS.buzzsaw.damage, WEAPONS.buzzsaw.force);
      r.frames(1);
    }
    expect(r.count('hit_punch')).toBeGreaterThanOrEqual(7);
    expect(r.count('hit_punch')).toBeLessThanOrEqual(10);
  });

  it('leaves headshots, blocked rounds, blades, fire, assists and enemies to their own sounds', () => {
    const r = rig();
    r.hit('smg', 'bullet', 25, 0, { headshot: true });
    r.hit('shotgun', 'pellet', 20, 18);
    r.frames(10);
    r.hit('smg', 'bullet', 25, 0, { blocked: true });
    r.hit('sword', 'slash', 75, 60);
    r.hit('kiln', 'fire', 9, 1);
    r.hit('rocket', 'explosive', 100, 90, { killed: true });
    r.hit('sentinel', 'bullet', 20, 5);
    r.hit('trooper', 'bullet', 10, 0);
    r.frames(10);
    expect(r.count('hit_punch')).toBe(0);
    expect(r.count('hit_confirm')).toBe(0);
  });

  it('keeps the headshot to itself whichever pellet of the blast landed first', () => {
    const r = rig();
    r.hit('shotgun', 'pellet', WEAPONS.shotgun.damage, WEAPONS.shotgun.force);
    r.hit('shotgun', 'pellet', WEAPONS.shotgun.damage, WEAPONS.shotgun.force, { headshot: true });
    r.hit('shotgun', 'pellet', WEAPONS.shotgun.damage, WEAPONS.shotgun.force);
    r.frames(1);
    expect(r.count('hit_punch')).toBe(0);
    expect(r.count('hit_confirm')).toBe(0);
    // The next blast, with no head in it, is a body hit again.
    r.frames(30);
    r.hit('shotgun', 'pellet', WEAPONS.shotgun.damage, WEAPONS.shotgun.force);
    r.endFrame();
    expect(r.count('hit_punch')).toBe(1);
  });

  it('drops a hit held over a pause rather than land it out of time', () => {
    const r = rig();
    r.hit('smg', 'bullet', WEAPONS.smg.damage, WEAPONS.smg.force);
    r.ctx.events.emit('game:state', { from: 'playing', to: 'paused' });
    r.frames(1);
    expect(r.count('hit_punch')).toBe(0);
  });

  it('gives a machine a lower, quieter punch under its clank and no flesh', () => {
    const r = rig();
    r.hit('smg', 'bullet', 25, 0);
    r.endFrame();
    const flesh = r.plays.find(p => p.id === 'hit_punch')!;
    r.frames(10);
    r.plays.length = 0;
    r.hit('smg', 'bullet', 25, 0, {}, 'drone');
    r.endFrame();
    expect(r.count('hit_confirm')).toBe(0);
    const metal = r.plays.find(p => p.id === 'hit_punch')!;
    expect(metal.volume).toBeLessThan(flesh.volume);
    expect(metal.pitch).toBeLessThan(flesh.pitch);
  });

  it('lands the killing round with its weight, and leaves the 2D confirmation to the kill marker', () => {
    const r = rig();
    r.hit('judge', 'bullet', 120, 40, { killed: true });
    r.endFrame();
    expect(r.count('hit_punch')).toBe(1);
    expect(r.count('hit_confirm')).toBe(0);
    expect(r.count('hit_marker')).toBe(0);
    // A blast whose first pellet wounds and a later one kills is a kill too.
    r.frames(30);
    r.hit('shotgun', 'pellet', WEAPONS.shotgun.damage, WEAPONS.shotgun.force);
    r.hit('shotgun', 'pellet', WEAPONS.shotgun.damage, WEAPONS.shotgun.force, { killed: true });
    r.endFrame();
    expect(r.count('hit_punch')).toBe(2);
    expect(r.count('hit_confirm')).toBe(0);
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

  /**
   * Levels from the report's own measurements of the recordings each layer reuses. A pack's level is its mean loudness
   * matched by `trimFor`, as the bank does at load. A 3D voice in front plays a mono buffer 3 dB down, as the panner does.
   */
  it('puts a body hit under the gun and the headshot up close, and keeps it heard at 30 m', () => {
    const line = (id: string) => report!.lines.find(l => l.id === id)!;
    const mixLoud = (id: string) => (line(id) as unknown as { mixLoud: number }).mixLoud;
    const packLevel = (id: string, recordings: string, count: number) => {
      const louds = line(recordings).stats.slice(0, count).map(s => s.loud);
      const mean = louds.reduce((a, b) => a + b, 0) / louds.length;
      return mean * trimFor(mean) * lookup(id)!.volume;
    };
    const front = Math.SQRT1_2;
    const smg = mixLoud('smg_fire');
    const headshot = Math.max(mixLoud('enemy_headshot'), mixLoud('enemy_headshot2'), mixLoud('enemy_headshot3'));
    const wet = packLevel('bullet_body', 'bullet_body', 6);
    const punch = packLevel('hit_punch', 'limb_thud', 5);
    const confirm = packLevel('hit_confirm', 'wet_slap', 4);
    const at = (id: string, d: number) => attenuation(d, lookup(id)!.near, lookup(id)!.far);
    // Loudness of layers that do not share a band adds as power.
    const hit = (w: number, d: number) => {
      const l = bodyHitLevels(w);
      return Math.hypot(wet * at('bullet_body', d) * front, punch * l.punchVolume * at('hit_punch', d) * front, confirm * l.confirmVolume);
    };
    const smgWeight = hitWeight(WEAPONS.smg.damage, 'bullet', 0);

    // The confirmation alone stays well under the gun and the headshot, at any weight.
    expect(confirm * bodyHitLevels(smgWeight).confirmVolume).toBeLessThan(smg * 0.4);
    expect(confirm * bodyHitLevels(1).confirmVolume).toBeLessThan(smg * 0.6);
    expect(hit(1, 3)).toBeLessThan(headshot);
    // Up close an SMG hit is about the shot's own size. Today's was 3 dB under it.
    expect(hit(smgWeight, 3) / smg).toBeGreaterThan(0.8);
    expect(hit(smgWeight, 3) / smg).toBeLessThan(1.25);
    // At 30 m it is under 9 dB down, where the old wet hit alone was 21 dB down.
    expect(hit(smgWeight, 30) / smg).toBeGreaterThan(0.35);
    expect((wet / lookup('bullet_body')!.volume) * 0.42 * 0.8 * attenuation(30, 5, 55) * front / smg).toBeLessThan(0.1);
    // A heavier round is a heavier hit at every range.
    for (const d of [3, 10, 30, 60]) expect(hit(weightOf('judge'), d), `${d} m`).toBeGreaterThan(hit(smgWeight, d) * 1.15);
  });

  it('lets a hit ring out rather than get cut off', () => {
    for (const line of synths) {
      // A radio clicks off, which is the one hit that is meant to end on a hard edge.
      if (CATALOG.get(line.id)!.loop || line.id === 'vox_radio') continue;
      for (const s of line.stats) if (s.attackMs < 30) expect(s.tail, line.id).toBeLessThan(0.5);
    }
  });
});
