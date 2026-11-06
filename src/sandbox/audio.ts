/**
 * Audio test bench. Nobody can listen to a headless build, so everything here produces numbers or
 * pictures:
 *   /?sandbox=audio                plays every id in order, then runs the polyphony load
 *   /?sandbox=audio&mode=sheet&p=0 spectrogram contact sheet, one tile per id
 * window.__audio exposes each test for tools/scripts/audio-*.mjs.
 */
import * as THREE from 'three';
import { AudioEngine, CATALOG } from '../audio';
import { analyze, checkStats, spectra, mixdown, type AudioStats } from '../audio/analyze';
import type { SoundDef } from '../audio/catalog';
import { ROOM_IDS, ROOMS, generateImpulse, measureT60 } from '../audio/reverb';
import { makeCtx, runLoop } from './harness';

interface Line {
  id: string;
  kind: string;
  variants: number;
  stats: AudioStats[];
  failures: string[];
  /** Perceived loudness at the level the id really plays at, for comparing across the mix. */
  mixLoud: number;
  leadTrimMs: number;
}

const channelsOf = (b: AudioBuffer) => Array.from({ length: b.numberOfChannels }, (_, c) => b.getChannelData(c));

function buildReport(engine: AudioEngine): { lines: Line[]; failures: number; seconds: number; bytes: number } {
  const lines: Line[] = [];
  let failures = 0;
  let seconds = 0;
  let bytes = 0;
  for (const def of CATALOG.values()) {
    if (def.kind === 'group' || def.kind === 'stack') continue;
    const buffers = engine.buffersOf(def.id);
    const stats = buffers.map(b => analyze(channelsOf(b), b.sampleRate));
    for (const b of buffers) {
      seconds += b.duration;
      bytes += b.length * b.numberOfChannels * 4;
    }
    const lineFailures: string[] = [];
    if (buffers.length === 0) lineFailures.push('no buffer');
    if (def.kind === 'synth') {
      const recipe = def.recipe!;
      if (buffers.length !== recipe.n) lineFailures.push(`expected ${recipe.n} variants, got ${buffers.length}`);
      stats.forEach((s, v) => {
        for (const f of checkStats(s, recipe.expect, recipe.loop, recipe.peak)) lineFailures.push(`v${v}: ${f}`);
      });
    }
    failures += lineFailures.length;
    const mean = stats.reduce((sum, s) => sum + s.loud, 0) / Math.max(1, stats.length);
    lines.push({
      id: def.id, kind: def.kind, variants: buffers.length, stats, failures: lineFailures,
      mixLoud: mean * engine.levelOf(def.id), leadTrimMs: (engine.leadTrim.get(def.id) ?? 0) * 1000,
    });
  }
  return { lines, failures, seconds, bytes };
}

/** Colour ramp from silence through blue to hot white, in the game's own palette. */
function heat(v: number): [number, number, number] {
  const t = Math.min(1, Math.max(0, v));
  return [Math.min(255, t * t * 520), Math.min(255, t * t * t * 320), Math.min(255, 40 + t * 170)];
}

/** One tile: log-frequency spectrogram with the waveform's envelope over it. */
function drawTile(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, def: SoundDef, buffer: AudioBuffer): void {
  const mono = mixdown(channelsOf(buffer));
  const image = g.createImageData(w, h);
  const hop = Math.max(64, Math.floor(mono.length / w));
  let col = 0;
  const nyquist = buffer.sampleRate / 2;
  spectra(mono, buffer.sampleRate, hop, bins => {
    if (col >= w) return;
    for (let row = 0; row < h; row++) {
      const f = 30 * Math.pow(Math.min(nyquist, 20000) / 30, 1 - row / (h - 1));
      const bin = Math.min(bins.length - 1, Math.floor((f / nyquist) * bins.length));
      const db = 10 * Math.log10(bins[bin]! + 1e-12);
      const [r, gr, b] = heat((db + 50) / 75);
      const o = (row * w + col) * 4;
      image.data[o] = r;
      image.data[o + 1] = gr;
      image.data[o + 2] = b;
      image.data[o + 3] = 255;
    }
    col++;
  });
  g.putImageData(image, x, y);
  g.fillStyle = '#fff';
  g.font = '10px monospace';
  g.fillText(def.id, x + 2, y + 10);
  g.fillStyle = '#7fd';
  g.fillText(`${buffer.duration.toFixed(2)}s`, x + 2, y + h - 3);
}

function contactSheet(engine: AudioEngine, page: number): void {
  const cols = 6;
  const rows = 8;
  const tileW = 208;
  const tileH = 84;
  const canvas = document.createElement('canvas');
  canvas.width = cols * tileW;
  canvas.height = rows * tileH;
  canvas.style.cssText = 'position:fixed;left:0;top:0;z-index:10;background:#000';
  document.body.appendChild(canvas);
  const g = canvas.getContext('2d')!;
  const defs = [...CATALOG.values()].filter(d => d.kind === 'synth' || d.kind === 'sample');
  const slice = defs.slice(page * cols * rows, (page + 1) * cols * rows);
  slice.forEach((def, i) => {
    const buffer = engine.buffersOf(def.id)[0];
    if (buffer) drawTile(g, (i % cols) * tileW, Math.floor(i / cols) * tileH, tileW - 2, tileH - 2, def, buffer);
  });
  canvas.dataset.sheet = 'done';
}

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export default async function audioSandbox(params: URLSearchParams): Promise<void> {
  const camera = new THREE.PerspectiveCamera();
  const ctx = makeCtx();
  (ctx as unknown as { render: unknown }).render = { camera };
  const engine = new AudioEngine(ctx);
  ctx.audio = engine;
  engine.init();
  await engine.opened;
  engine.mixerForTests!.enableMeters();
  engine.unlock();
  const started = performance.now();
  await engine.ready;
  const loadMs = performance.now() - started;

  runLoop(ctx, () => engine.update(), () => ({ audio: engine.stats() }));

  const here = new THREE.Vector3();
  const fwd = new THREE.Vector3(0, 0, -1);
  const up = new THREE.Vector3(0, 1, 0);
  engine.setListener(here, fwd, up);

  const api = {
    engine,
    ctx,
    loadMs,
    report: () => buildReport(engine),

    /** Plays every id once. Long ones overlap, which is a harsher test than waiting. */
    async playAll(gapMs = 18): Promise<{ played: number; ids: number }> {
      const ids = [...CATALOG.keys()];
      const before = engine.stats().played;
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i]!;
        const def = CATALOG.get(id)!;
        if (def.loop) {
          const h = engine.startLoop(id, { position: i % 2 ? new THREE.Vector3(8, 0, -8) : undefined });
          h.setVolume(0.8);
          h.setPitch(1.1);
          h.setPosition(new THREE.Vector3(-6, 1, -3));
          await wait(gapMs);
          h.stop(0.05);
          h.stop(0.05);
        } else {
          engine.play(id, { position: i % 3 === 0 ? new THREE.Vector3(10, 0, -5) : undefined });
          await wait(gapMs);
        }
      }
      return { played: engine.stats().played - before, ids: ids.length };
    },

    /**
     * A worst-case fight: every heavy thing at once, for `seconds`. The listener moves and every 3D voice gets rewritten,
     * because a still graph never reaches Chrome's expensive path. This test once reported 78 clean voices while the
     * same mix in the real game ran the render thread out of time. Only `clockRate` and `underrunShare` can show that.
     */
    async load(seconds = 6): Promise<Record<string, unknown>> {
      const mixer = engine.mixerForTests!;
      mixer.peakPost = 0;
      mixer.peakPre = 0;
      const p = new THREE.Vector3();
      const end = performance.now() + seconds * 1000;
      let peakVoices = 0;
      let shots = 0;
      let last = performance.now();
      let smgClock = 0;
      let shellClock = 0;
      let blastClock = 0;
      let spamClock = 0;
      const before = engine.stats();
      let worstClock = 1;
      let worstUnderrun = 0;
      while (performance.now() < end) {
        const now = performance.now();
        const dt = now - last;
        last = now;
        here.set(Math.sin(now / 700) * 12, 1, Math.cos(now / 900) * 12);
        fwd.set(Math.sin(now / 500), 0, -Math.cos(now / 500));
        engine.setListener(here, fwd, up);
        smgClock += dt;
        shellClock += dt;
        blastClock += dt;
        spamClock += dt;
        while (smgClock >= 50) {
          smgClock -= 50;
          shots++;
          engine.play('smg_fire');
          engine.play('bloodthirsty_shot');
          engine.play('berserk_shot');
          engine.play('hellfire_shot');
        }
        while (shellClock >= 50) {
          shellClock -= 50;
          p.set(Math.random() * 60 - 30, 0, -Math.random() * 40);
          engine.play('30mmshell_explode', { position: p });
          engine.play('30mmShell_flyBy', { position: p });
        }
        while (blastClock >= 300) {
          blastClock -= 300;
          p.set(Math.random() * 30 - 15, 0, -10);
          engine.play('hellfire_rocket_blast', { position: p });
          engine.play('headshot', { position: p });
          engine.play('explosion_barrel', { position: p });
        }
        while (spamClock >= 16) {
          spamClock -= 16;
          for (let i = 0; i < 24; i++) {
            p.set(Math.random() * 40 - 20, 0, -Math.random() * 40);
            engine.playOneOf(['impact_metal', 'impact_concrete', 'impact_flesh', 'vox_pain', 'vox_grunt', 'enemy_smg', 'gib_squelch', 'bone_crack'], { position: p });
          }
        }
        const s = engine.stats();
        peakVoices = Math.max(peakVoices, s.voices2d + s.voices3d);
        worstClock = Math.min(worstClock, s.clockRate);
        worstUnderrun = Math.max(worstUnderrun, s.underrunShare);
        await wait(4);
      }
      const after = engine.stats();
      return {
        seconds, shots, peakVoices,
        played: after.played - before.played,
        stolen: after.stolen - before.stolen,
        dropped: after.dropped - before.dropped,
        collapsed: after.collapsed - before.collapsed,
        thinned: after.thinnedQuiet + after.thinnedRepeat - before.thinnedQuiet - before.thinnedRepeat,
        budget: after.budget,
        loadStep: after.loadStep,
        worstClock,
        worstUnderrun,
        peakBeforeLimiter: mixer.peakPre,
        peakAfterLimiter: mixer.peakPost,
        gainReduction: mixer.filters.gainReduction,
      };
    },

    impulseTimes(): Record<string, { spec: readonly number[]; measured: number; wet: number }> {
      const out: Record<string, { spec: readonly number[]; measured: number; wet: number }> = {};
      for (const id of ROOM_IDS) {
        const spec = ROOMS[id];
        const [left] = generateImpulse(spec, 48000, 7);
        out[id] = { spec: spec.t60, measured: measureT60(left, 48000), wet: spec.wet };
      }
      return out;
    },
  };
  (window as unknown as { __audio: typeof api }).__audio = api;

  const mode = params.get('mode');
  if (mode === 'sheet') {
    contactSheet(engine, Number(params.get('p') ?? 0));
    return;
  }
  if (mode === 'idle') return;
  await api.playAll();
  await api.load(4);
}
