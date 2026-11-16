#!/usr/bin/env node
// Squad comms voices (docs/design/squad-comms.md; stage I). Offline: renders text takes with ElevenLabs Eleven v3 into audio files the
// game loads. The game never talks to ElevenLabs.
//
//   node tools/scripts/chatter-voices.mjs --jobs <jobs.json> --out <dir> [--dry] [--format mp3_44100_96]
//
// jobs.json is a list of { file, voice, text, stability }: `file` the name to write (e.g. `ch.garrison.frag.pro.1.t2.mp3`),
// `voice` one of trooper1 trooper2 trooper3 (the owner's voices, looked up by name), `text` with any v3 audio tags.
//
// Resumable: a file that already exists is skipped, so a crash or a stop never pays for a take twice. Each take is appended to
// <out>/takes.jsonl with its character count and the cost header ElevenLabs returns, if any.
//
// The API key is read at run time from ~/.config/op2/elevenlabs.key and sent only as the xi-api-key header. It is never printed,
// logged or written anywhere.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  return i < 0 ? d : argv[i + 1] ?? true;
};
const jobs = JSON.parse(readFileSync(arg('jobs'), 'utf8'));
const out = arg('out');
const dry = argv.includes('--dry');
const format = arg('format', 'mp3_44100_96');
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
async function take(j) {
  if (blocked.has(j.voice)) return;
  for (let attempt = 0; attempt < 5; attempt++) {
    const r = await api(`/v1/text-to-speech/${ids[j.voice]}?output_format=${format}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'audio/mpeg' },
      body: JSON.stringify({ text: j.text, model_id: 'eleven_v3', voice_settings: { stability: j.stability ?? 0.5 } }),
    });
    if (r.status === 429 || r.status >= 500) {
      await sleep(2000 * (attempt + 1));
      continue;
    }
    if (!r.ok) {
      const body = clean((await r.text()).slice(0, 300));
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
    appendFileSync(join(out, 'takes.jsonl'), `${JSON.stringify({ file: j.file, voice: j.voice, chars: j.text.length, cost: Number.isFinite(cost) ? cost : null, bytes: audio.length })}\n`);
    done++;
    return;
  }
  throw new Error(`${j.file}: gave up after retries`);
}
// Two at a time: well inside the concurrency of any plan, and a stop loses at most two takes.
const queue = [...todo];
await Promise.all([0, 1].map(async () => {
  while (queue.length) await take(queue.shift());
}));
console.log(JSON.stringify({ written: done, costReported: spent || null, blocked: Object.fromEntries(blocked) }));
