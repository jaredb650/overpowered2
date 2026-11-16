#!/usr/bin/env node
// Squad comms voices (docs/design/squad-comms.md; stage I). Offline: renders text takes with ElevenLabs Eleven v3 into audio files the
// game loads. The game never talks to ElevenLabs.
//
//   node tools/scripts/chatter-voices.mjs --plan <jobs.json>                 every row of lines.json, both voices, as a job list
//   node tools/scripts/chatter-voices.mjs --jobs <jobs.json> --out <dir> [--dry] [--format mp3_44100_64] [--cap 140000]
//   node tools/scripts/chatter-voices.mjs --encode <raw dir> --to public/audio/chatter    web files and manifest.json, by ffmpeg
//
// The web files are mono MP3 at 24 kHz, 32 kbps (every browser plays them, Safari included), with the silence before and after the
// words cut off and the level set to -18 LUFS, so a line starts the moment it is said and no voice is louder than another.
//
// jobs.json is a list of { file, voice, text, stability }: `file` the name to write (e.g. `ch.garrison.frag.pro.1.t2.mp3`),
// `voice` trooper2 or trooper3 (the owner's voices, looked up by name), `text` with any v3 audio tags. The plan puts every fixed line
// in both voices first, then the slot expansions, so a run cut short still voices most of what is said.
//
// A quota or credit refusal stops the run at once, with no retries; so does passing `--cap` credits billed in this run.
//
// Resumable: a file that already exists is skipped, so a crash or a stop never pays for a take twice. Each take is appended to
// <out>/takes.jsonl with its character count and the cost header ElevenLabs returns, if any.
//
// The API key is read at run time from ~/.config/op2/elevenlabs.key and sent only as the xi-api-key header. It is never printed,
// logged or written anywhere.
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  return i < 0 ? d : argv[i + 1] ?? true;
};

// --- The plan: rows x blanks x voices. Mirrors src/enemies/outpost/chatter/voices.ts (VOICES, VOICED_SLOTS, clipKey). ---
const VOICES = [['t2', 'trooper2'], ['t3', 'trooper3']];
const NICKS = ['Brick', 'Patch', 'Spark', 'Kid', 'Ghost', 'Wall', 'Buck', 'Moth', 'Tick', 'Lucky', 'Gravel', 'Ace'];
const NATO = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel'];
const VALUES = {
  dead: NICKS, buddy: NICKS, clock: Array.from({ length: 12 }, (_, i) => `${i + 1} o'clock`), squad: NATO, lost: NATO,
  cardinal: ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'],
  count: ['one', 'two'], range: ['50 metres'], to: ['All units'],
};
/** The v3 audio tag for a row's emotion, and how free the take is. */
const TAG = { calm: '', urgent: '[shouting]', cocky: '[smug]', afraid: '[nervous]', panic: '[panicked]', pain: '[in pain]', pleading: '[pleading]', defiant: '[angry]', hushed: '[whispers]', grief: '[crying]' };
const tagOf = r => (r.concept === 'dying' ? '[exhausted]' : r.channel === 'scream' && r.emotion === 'pain' ? '[screaming]' : TAG[r.emotion] ?? '');
const steady = r => r.morale_tier.some(t => t === 'high' || t === 'medium') && ['calm', 'urgent', 'hushed', 'cocky'].includes(r.emotion);
if (arg('plan')) {
  const rows = JSON.parse(readFileSync(new URL('../../src/enemies/outpost/chatter/lines.json', import.meta.url), 'utf8'));
  const fixed = [];
  const slotted = [];
  for (const r of rows) {
    const keys = [...new Set([...r.text.matchAll(/\{(\w+)\}/g)].map(m => m[1]))].sort();
    let combos = [{}];
    for (const k of keys) combos = combos.flatMap(c => VALUES[k].map(v => ({ ...c, [k]: v })));
    for (const c of combos) {
      const text = r.text.replace(/\{(\w+)\}/g, (_, k) => c[k]);
      const key = keys.length ? `${r.id}~${keys.map(k => c[k].replace(/\s+/g, '')).join('-')}` : r.id;
      const tag = tagOf(r);
      for (const [suffix, voice] of VOICES) {
        (keys.length ? slotted : fixed).push({ file: `${key}.${suffix}.mp3`, voice, text: tag ? `${tag} ${text}` : text, stability: steady(r) ? 0.5 : 0 });
      }
    }
  }
  const all = [...fixed, ...slotted];
  writeFileSync(arg('plan'), JSON.stringify(all));
  console.log(JSON.stringify({ fixed: fixed.length, slotted: slotted.length, characters: all.reduce((n, j) => n + j.text.length, 0) }));
  process.exit(0);
}

if (arg('encode')) {
  const from = arg('encode');
  const to = arg('to');
  mkdirSync(to, { recursive: true });
  const raw = readdirSync(from).filter(f => /\.t\d\.mp3$/.test(f));
  const todo = raw.filter(f => !existsSync(join(to, f)));
  const trim = 'silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.03';
  const filter = `${trim},areverse,${trim},areverse,loudnorm=I=-18:TP=-2:LRA=11`;
  const run = f => new Promise((ok, bad) => {
    const p = spawn('ffmpeg', ['-v', 'error', '-y', '-i', join(from, f), '-af', filter, '-ac', '1', '-ar', '24000', '-c:a', 'libmp3lame', '-b:a', '32k', join(to, f)]);
    p.on('exit', code => (code === 0 ? ok() : bad(new Error(`ffmpeg ${f}: ${code}`))));
  });
  const queue = [...todo];
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (queue.length) await run(queue.shift());
  }));
  const clips = readdirSync(to).filter(f => /\.t\d\.mp3$/.test(f)).sort();
  writeFileSync(join(to, 'manifest.json'), JSON.stringify({ ext: 'mp3', clips: clips.map(f => f.slice(0, -4)) }));
  const bytes = clips.reduce((n, f) => n + statSync(join(to, f)).size, 0);
  console.log(JSON.stringify({ encoded: todo.length, clips: clips.length, megabytes: +(bytes / 1048576).toFixed(1) }));
  process.exit(0);
}

const jobs = JSON.parse(readFileSync(arg('jobs'), 'utf8'));
const out = arg('out');
const dry = argv.includes('--dry');
const format = arg('format', 'mp3_44100_64');
const cap = Number(arg('cap', Infinity));
mkdirSync(out, { recursive: true });

const todo = jobs.filter(j => !existsSync(join(out, j.file)));
const chars = todo.reduce((n, j) => n + j.text.length, 0);
console.log(JSON.stringify({ jobs: jobs.length, todo: todo.length, characters: chars }));
if (dry || todo.length === 0) process.exit(0);

const key = readFileSync(join(homedir(), '.config/op2/elevenlabs.key'), 'utf8').trim();
const clean = s => String(s).split(key).join('[redacted]');
const api = (path, init = {}) => fetch(`https://api.elevenlabs.io${path}`, { ...init, headers: { ...init.headers, 'xi-api-key': key } });

const listed = await api('/v1/voices');
if (!listed.ok) throw new Error(clean(`voices: HTTP ${listed.status}`));
const ids = Object.fromEntries((await listed.json()).voices.map(v => [v.name.toLowerCase(), v.voice_id]));
for (const v of new Set(todo.map(j => j.voice))) if (!ids[v]) throw new Error(`no voice named ${v}`);

const sleep = ms => new Promise(r => setTimeout(r, ms));
let done = 0;
let spent = 0;
/** Voices ElevenLabs refused (an unverified clone): reported, and the rest carry on. */
const blocked = new Map();
/** Set when the run must end now: a quota refusal, or the cap. */
let halt = null;
async function take(j) {
  if (blocked.has(j.voice) || halt) return;
  for (let attempt = 0; attempt < 5; attempt++) {
    const r = await api(`/v1/text-to-speech/${ids[j.voice]}?output_format=${format}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'audio/mpeg' },
      body: JSON.stringify({ text: j.text, model_id: 'eleven_v3', voice_settings: { stability: j.stability ?? 0.5 } }),
    });
    if (!r.ok) {
      const body = clean((await r.text()).slice(0, 300));
      // Out of credits or over quota: stop now, never retry into it.
      if (/quota|credit|insufficient|payment/i.test(body) || r.status === 402) {
        halt = `refused: HTTP ${r.status} ${body}`;
        return;
      }
      if (r.status === 429 || r.status >= 500) {
        await sleep(2000 * (attempt + 1));
        continue;
      }
      if (r.status === 401 && body.includes('voice_access_denied')) {
        blocked.set(j.voice, body.match(/"message":"([^"]+)"/)?.[1] ?? 'refused');
        return;
      }
      throw new Error(clean(`${j.file}: HTTP ${r.status} ${body}`));
    }
    const audio = Buffer.from(await r.arrayBuffer());
    writeFileSync(join(out, j.file), audio);
    const cost = Number(r.headers.get('character-cost') ?? r.headers.get('x-character-count') ?? NaN);
    if (Number.isFinite(cost)) spent += cost;
    if (spent > cap) halt = `cap: ${spent} credits billed this run, over ${cap}`;
    appendFileSync(join(out, 'takes.jsonl'), `${JSON.stringify({ file: j.file, voice: j.voice, chars: j.text.length, cost: Number.isFinite(cost) ? cost : null, bytes: audio.length })}\n`);
    done++;
    if (done % 100 === 0) console.log(JSON.stringify({ written: done, of: todo.length, credits: spent }));
    return;
  }
  throw new Error(`${j.file}: gave up after retries`);
}
// A few at a time (`--parallel`, default 3): inside the concurrency of any paid plan, and a stop loses at most that many takes.
const queue = [...todo];
await Promise.all(Array.from({ length: Number(arg('parallel', 3)) }, async () => {
  while (queue.length && !halt) await take(queue.shift());
}));
console.log(JSON.stringify({ written: done, credits: spent, left: queue.length, halted: halt, blocked: Object.fromEntries(blocked) }));
if (halt) process.exit(2);
