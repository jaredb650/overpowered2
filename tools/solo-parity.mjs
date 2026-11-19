#!/usr/bin/env node
// "Did this branch change single player?" in one command: every scenario of tools/scripts/lib/solo-scenarios.mjs played on two
// builds of the game and compared frame by frame (tools/scripts/solo-trace.mjs, tools/solo-compare.mjs).
// docs/notes/devtools.md, "Comparing two builds".
//
//   # the old build: a second worktree with its own Vite; the new one: this checkout's
//   git worktree add <scratch>/old-ref <old commit> && (cd <scratch>/old-ref && npm ci && OP2_NO_HMR=1 npx vite --port 5471 --strictPort &)
//   OP2_NO_HMR=1 npx vite --port 5470 --strictPort &
//   node tools/solo-parity.mjs --old 5471 --new 5470 --out tools/out/<you>/parity
//
// --only a,b,c     just these scenarios          --skip a,b      all but these
// --group <n>      scenarios per browser run (default 6). A run takes one of the machine's browser slots however many it
//                  plays, and the two builds run side by side: two slots at a time.
// --long           also the two runs to the round-10 ending and the shop to round 10 (about 10 minutes each a build)
// Prints one line a scenario and writes parity.json and each comparison's text to --out. Exit code 0 when nothing differs
// that is not listed under EXPECTED below.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { SCENARIOS } from './scripts/lib/solo-scenarios.mjs';

/** Differences that are meant to be there (co-op overhaul, 2026-11): the scenario still runs, and its line says so. */
const EXPECTED = {
  drops: 'intended: a dropped gun comes to rest on the ground (it hung in the air off a ledge), 1 cm lower on the flat',
  menus: 'the Guide\'s key list: "Next wave now" also says "co-op: ready up", and one new row, "Co-op only: mark a spot for the team"',
  'menus-humans': 'the Guide\'s key list (see menus)',
  'menus-campaign': 'the Guide\'s key list (see menus)',
  'menu-tree': 'the Guide\'s key list (see menus)',
};
/** Events the newer build has that the older has not, with no single-player listener: set aside everywhere. */
const NEW_EVENTS = ['weapon:loop'];
/** Too long for an ordinary pass. */
const LONG = ['humans-waves', 'office-waves', 'humans-shop'];
/** Not comparisons: the frame-time scene and the leftover probe. */
const NOT_PARITY = ['perf-crowd', 'idle'];

const argv = process.argv.slice(2);
const flag = name => { const i = argv.indexOf(`--${name}`); return i < 0 ? undefined : argv[i + 1] ?? ''; };
const oldPort = Number(flag('old')), newPort = Number(flag('new'));
if (!oldPort || !newPort) { console.error('usage: node tools/solo-parity.mjs --old <port> --new <port> [--out dir] [--only a,b] [--skip a,b] [--group n] [--long]'); process.exit(64); }
const out = resolve(flag('out') ?? 'tools/out/solo-parity');
mkdirSync(out, { recursive: true });
const only = flag('only')?.split(',').filter(Boolean), skip = new Set(flag('skip')?.split(',') ?? []);
const per = Math.max(1, Number(flag('group') ?? 6));
let names = Object.keys(SCENARIOS).filter(n => !NOT_PARITY.includes(n) && !skip.has(n));
if (only) names = names.filter(n => only.includes(n));
else if (!argv.includes('--long')) names = names.filter(n => !LONG.includes(n));
// Long ones alone, the rest in groups.
const groups = [];
for (const n of names.filter(n => LONG.includes(n))) groups.push([n]);
const rest = names.filter(n => !LONG.includes(n));
for (let i = 0; i < rest.length; i += per) groups.push(rest.slice(i, i + per));

const run = (label, port, list, tag) => new Promise(done => {
  const child = spawn(process.execPath, ['tools/shot.mjs', '--port', String(port), '--url', '/', '--wait', '0', '--timeout', '3000', '--quiet',
    '--script', 'tools/scripts/solo-trace.mjs', '--out', join(out, `run-${tag}-${label}.png`)], { env: { ...process.env, SOLO_SCENARIO: list.join(','), SOLO_LABEL: label }, stdio: ['ignore', 'pipe', 'pipe'] });
  let text = '';
  child.stdout.on('data', d => { text += d; });
  child.stderr.on('data', d => { text += d; });
  child.on('close', code => { writeFileSync(join(out, `run-${tag}-${label}.log`), text); done(code); });
});
const compare = name => new Promise(done => {
  const a = join(out, `${name}.old.trace.json`), b = join(out, `${name}.new.trace.json`);
  if (!existsSync(a) || !existsSync(b)) return done({ missing: true });
  const child = spawn(process.execPath, ['tools/solo-compare.mjs', a, b, '--skip-random', 'audio/,npm:three', '--skip-events', NEW_EVENTS.join(','), '--context', '3'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let text = '';
  child.stdout.on('data', d => { text += d; });
  child.on('close', code => { writeFileSync(join(out, `${name}.compare.txt`), text); done({ same: code === 0, bodies: code === 3, text }); });
});

const table = [];
let bad = 0;
for (let g = 0; g < groups.length; g++) {
  const list = groups[g];
  console.error(`[parity] ${g + 1}/${groups.length}: ${list.join(', ')}`);
  await Promise.all([run('old', oldPort, list, g), run('new', newPort, list, g)]);
  for (const name of list) {
    const r = await compare(name);
    let frames = 0, events = 0, end = '';
    try { const t = JSON.parse(readFileSync(join(out, `${name}.new.trace.json`), 'utf8')); frames = t.frames.length; events = t.events.length; const f = t.frames.at(-1); end = f ? `${f.state}${f.run?.[0] != null ? `, wave ${f.run[0]}, ${f.run[3]} kills` : ''}` : ''; } catch { /* no trace */ }
    let verdict;
    if (r.missing) { verdict = 'NO TRACE (see the run logs)'; bad++; }
    else if (r.same) verdict = 'same: every frame, every event';
    else if (r.bodies) verdict = 'same play: every frame and event; only how the dead lie differs (see the compare file)';
    else {
      const first = /FIRST DIFFERENCE at frame (\d+)[^\n]*\n\s*([^\n]*)/.exec(r.text);
      const what = first ? `differs from frame ${first[1]}: ${first[2].slice(0, 140)}` : r.text.split('\n').find(l => /lengths differ|notebook|End state/.test(l))?.slice(0, 160) ?? 'differs';
      if (EXPECTED[name]) verdict = `${what}  (expected: ${EXPECTED[name]})`;
      else { verdict = `DIFFERS: ${what}`; bad++; }
    }
    table.push({ scenario: name, frames, events, end, verdict });
    console.log(`${name.padEnd(26)} ${String(frames).padStart(6)} frames ${String(events).padStart(6)} events  ${end.padEnd(34)} ${verdict}`);
  }
}
writeFileSync(join(out, 'parity.json'), JSON.stringify({ old: oldPort, new: newPort, unexpected: bad, table }, null, 2));
console.log(bad ? `\n${bad} scenario(s) differ unexpectedly: read <scenario>.compare.txt in ${out}` : '\nNothing differs that is not expected.');
process.exit(bad ? 1 : 0);
