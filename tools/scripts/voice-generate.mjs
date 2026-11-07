// Records docs/voice/commander-script.csv (the fight's lines) and docs/voice/mission-script.csv (the campaign's, cutscenes included) into
// public/audio/voice/ with ElevenLabs. Refresh both CSVs first with tools/scripts/voice-script.ts.
//
//   node --env-file=<file outside this repo> tools/scripts/voice-generate.mjs --only cmd.door.smug.office~50,council.smug.extinctions
//   node --env-file=<file outside this repo> tools/scripts/voice-generate.mjs --concurrency 3 --radio "<account voice name>"
//
// The pilot's lines are the CSVs' "radio crew" voice. They are recorded only when --radio names the account voice to use for him, and
// otherwise left as subtitles, so a run without it still records everything else.
//
// The key comes from ELEVENLABS_API_KEY in the environment only. Takes that already have a non-empty mp3 are skipped, so a rerun resumes and
// picks up new lines. The manifest is rewritten after every take, so a stopped run still leaves working audio.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const CSVS = ['docs/voice/commander-script.csv', 'docs/voice/mission-script.csv'];
const OUT = 'public/audio/voice';
const API = 'https://api.elevenlabs.io';
const MODEL = 'eleven_v3';
const FORMAT = 'mp3_44100_128';
const VOICES = { 'the void': 'VOID', shodan: 'Shodan' }; // CSV voice -> account voice name, confirmed by the user
const RADIO = 'radio crew';
const ORDER = ['council', 'intercept', 'commander', 'radio'];
const TRIES = 6;

const key = process.env.ELEVENLABS_API_KEY;
if (!key) throw new Error('ELEVENLABS_API_KEY is not set');
const arg = name => {
  const i = process.argv.indexOf(name);
  return i < 0 ? undefined : process.argv[i + 1];
};
const only = arg('--only')?.split(',');
const concurrency = Number(arg('--concurrency') ?? 3);
const radio = arg('--radio');
if (radio) VOICES[RADIO] = radio;

function parseCsv(s) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (s[i + 1] === '"') { field += '"'; i++; } else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; } else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; } else field += c;
  }
  return rows;
}

const takes = CSVS.flatMap(csv => {
  const [head, ...rows] = parseCsv(readFileSync(csv, 'utf8'));
  if (head.join() !== 'file,speaker,voice,tag,text') throw new Error(`unexpected CSV columns in ${csv}: ${head}`);
  return rows.map(([file, speaker, voice, tag, text]) => ({ file, speaker, voice, tag, text }));
});
for (const t of takes) {
  const voiced = t.voice in VOICES || t.voice === RADIO;
  if (!t.text || !t.tag || !/^[\w.~-]+$/.test(t.file) || !voiced || !ORDER.includes(t.speaker)) throw new Error(`bad row: ${JSON.stringify(t)}`);
}
const unvoiced = takes.filter(t => !(t.voice in VOICES));
if (unvoiced.length) console.log(`${unvoiced.length} pilot lines skipped: pass --radio "<account voice name>" to record them`);
if (new Set(takes.map(t => t.file)).size !== takes.length) throw new Error('duplicate file names in the CSV');

const mp3 = file => join(OUT, `${file}.mp3`);
const recorded = file => existsSync(mp3(file)) && statSync(mp3(file)).size > 0;

function writeManifest() {
  const clips = readdirSync(OUT).filter(n => n.endsWith('.mp3')).map(n => n.slice(0, -4)).filter(recorded).sort();
  const tmp = join(OUT, 'manifest.json.tmp');
  writeFileSync(tmp, `${JSON.stringify({ clips }, null, 2)}\n`);
  renameSync(tmp, join(OUT, 'manifest.json'));
}

async function api(path, init) {
  return fetch(API + path, { ...init, headers: { 'xi-api-key': key, ...init?.headers } });
}

async function credits() {
  const r = await api('/v1/user/subscription');
  if (!r.ok) throw new Error(`subscription lookup failed: ${r.status}`);
  const s = await r.json();
  return s.character_limit - s.character_count;
}

async function voiceIds() {
  const r = await api('/v1/voices');
  if (!r.ok) throw new Error(`voice lookup failed: ${r.status}`);
  const { voices } = await r.json();
  return Object.fromEntries(Object.entries(VOICES).map(([csvName, accountName]) => {
    const found = voices.filter(v => v.name === accountName);
    if (found.length !== 1) throw new Error(`expected one voice named exactly ${accountName}, found ${found.length}`);
    return [csvName, found[0].voice_id];
  }));
}

const wait = ms => new Promise(done => setTimeout(done, ms));
class OutOfCredits extends Error {}

/** One take: the tag, a space, the text, exactly as written. Returns the characters billed, when the API says. */
async function record(take, ids) {
  for (let attempt = 1; ; attempt++) {
    const r = await api(`/v1/text-to-speech/${ids[take.voice]}?output_format=${FORMAT}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: `${take.tag} ${take.text}`, model_id: MODEL }),
    }).catch(e => {
      if (attempt === TRIES) throw e;
      return null; // a dropped connection retries like a 5xx
    });
    if (!r) {
      await wait(Math.min(60_000, 1000 * 2 ** attempt));
      continue;
    }
    if (r.ok) {
      const audio = Buffer.from(await r.arrayBuffer());
      if (audio.length === 0) throw new Error('empty audio');
      const tmp = `${mp3(take.file)}.tmp`;
      writeFileSync(tmp, audio);
      renameSync(tmp, mp3(take.file));
      return Number(r.headers.get('character-cost') ?? 0);
    }
    const body = await r.text();
    if (/quota_exceeded/.test(body)) throw new OutOfCredits(body.slice(0, 200));
    if ((r.status !== 429 && r.status < 500) || attempt === TRIES) throw new Error(`${r.status} ${body.slice(0, 200)}`);
    const after = Number(r.headers.get('retry-after'));
    await wait(after ? after * 1000 : Math.min(60_000, 1000 * 2 ** attempt) + Math.random() * 500);
  }
}

mkdirSync(OUT, { recursive: true });
for (const n of readdirSync(OUT)) if (n.endsWith('.tmp')) rmSync(join(OUT, n)); // left by a killed run

if (only) {
  const unknown = only.filter(f => !takes.some(t => t.file === f));
  if (unknown.length) throw new Error(`not in the CSV: ${unknown}`);
}
const queue = takes
  .filter(t => (only ? only.includes(t.file) : true) && t.voice in VOICES && !recorded(t.file))
  .sort((a, b) => ORDER.indexOf(a.speaker) - ORDER.indexOf(b.speaker));

const before = await credits();
const ids = await voiceIds();
const need = queue.reduce((n, t) => n + t.tag.length + 1 + t.text.length, 0);
console.log(`${takes.length} takes in the CSV, ${queue.length} to record, ${need} characters, ${before} credits left, concurrency ${concurrency}`);

const failed = [];
let done = 0, billed = 0, stopped = '';
await Promise.all(Array.from({ length: concurrency }, async () => {
  while (queue.length && !stopped) {
    const take = queue.shift();
    try {
      const cost = await record(take, ids); // awaited first: `billed += await` would lose updates from the other workers
      billed += cost;
      done++;
      writeManifest();
      if (done % 25 === 0) console.log(`${done} recorded, ${queue.length} queued`);
    } catch (e) {
      if (e instanceof OutOfCredits) { stopped = e.message; queue.unshift(take); } else { failed.push(take.file); console.log(`FAILED ${take.file}: ${e.message}`); }
    }
  }
}));

writeManifest();
const after = await credits();
console.log(JSON.stringify({ recorded: done, failed, notRecorded: queue.length, billedByHeader: billed, creditsUsed: before - after, creditsLeft: after, stopped }, null, 2));
if (stopped) process.exitCode = 2;
