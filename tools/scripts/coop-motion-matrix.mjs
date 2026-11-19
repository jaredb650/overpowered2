#!/usr/bin/env node
// The enemy-motion table, unattended, from one command. Runs coop-motion-measure.mjs over 12 cases (20 and 48 enemies; the
// host uncapped and at 20 fps; a clean network, lag:80,jitter:30,loss:0.03 and lag:150,jitter:60,loss:0.08), one run at a
// time, each through tools/shot.mjs (so it takes a browser slot like every other proof and never bypasses the queue).
//
//   node tools/scripts/coop-motion-matrix.mjs                       this checkout only
//   node tools/scripts/coop-motion-matrix.mjs --baseline d9ecffb    this checkout against an older commit, case by case
//
// It sets up what it needs and takes it down again: a Vite server for this checkout (port 5320) if none answers there, and
// with --baseline a worktree of that commit in the temp folder (npm ci on first use) with its own Vite (port 5321). A server
// that already answers on a port is used as it is and left running.
//
// A case only counts if its pages really ran. A page that got under 40 frames a second (the host: under 80% of its cap when
// it is capped) was starved by the machine, and what it measured is the machine, not the netcode: that run is thrown away
// and tried again (--tries, default 3). A case with no clean run is written as "not measured", never as numbers.
//
//   --baseline <rev>   also measure this commit (the old lane was last at d9ecffb)
//   --ports <a,b>      ports for the baseline and for this checkout (default 5321,5320; one port without --baseline)
//   --out <dir>        where the evidence goes (default tools/out/coop/enemy-motion/matrix)
//   --tries <n>        runs per case at most (default 3)
//   --seconds <n>      seconds recorded per run (default 20)
//   --budget <min>     stop starting runs after this many minutes; the rest are written as not measured
//   --only <text>      only cases whose name has this in it (e.g. 48e, 20fps, clean)
//   --max-load <n>     before each run, wait until the machine's 1-minute load is at or under this (default 12; at most
//                      --load-wait minutes, default 20, then the run goes ahead and its row says what the load was)
//   --keep             leave the baseline worktree in place afterwards
//   --baseline-dir <d> where the baseline's worktree goes (default: the temp folder)
//
// Writes, in --out: one JSON per run, motion-results.json (every case, measured or not, with why) and motion-table.md (the
// tables docs/notes/coop.md carries: one yardstick for both builds, then near and far enemies apart, then what the new lane
// says of itself). Prints them. Exit code 0 if every case was measured, 3 if some were not.
//   node tools/scripts/coop-motion-matrix.mjs --table <motion-results.json>   prints the tables of an earlier run again
//   node tools/scripts/coop-motion-matrix.mjs --reanalyse --out <dir>         measures an earlier run's recordings again
//                                                                             (after a change to the yardstick), no browser
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import { gunzipSync } from 'node:zlib';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(`--${name}`); return i < 0 ? undefined : args[i + 1] ?? ''; };
const baseline = opt('baseline');
const ports = String(opt('ports') ?? (baseline ? '5321,5320' : '5320')).split(',').map(Number);
const outDir = resolve(opt('out') ?? 'tools/out/coop/enemy-motion/matrix');
const tries = Math.max(1, Number(opt('tries') ?? 3));
const seconds = Number(opt('seconds') ?? 20);
const budgetMs = opt('budget') ? Number(opt('budget')) * 60_000 : Infinity;
const only = opt('only');
const maxLoad = Number(opt('max-load') ?? 12);
const loadWaitMs = Number(opt('load-wait') ?? 20) * 60_000;
const keep = args.includes('--keep');
if (baseline && ports.length < 2) throw new Error('--baseline needs two ports: --ports <baseline>,<this checkout>');
mkdirSync(outDir, { recursive: true });

/** The builds measured: the baseline first, so the two runs of a case sit side by side in time. */
const builds = baseline ? [{ tag: 'baseline', label: `old (${baseline})`, port: ports[0], dir: resolve(opt('baseline-dir') ?? join(tmpdir(), `op2-motion-baseline-${baseline.replace(/[^\w.-]/g, '_')}`)) },
  { tag: 'after', label: 'new', port: ports[1], dir: process.cwd() }] : [{ tag: 'after', label: 'this checkout', port: ports[0], dir: process.cwd() }];

const NETS = ['', 'lag:80,jitter:30,loss:0.03', 'lag:150,jitter:60,loss:0.08'];
// The crowd at the cap first: if the time runs out, the cases that say most are in.
const cases = [];
for (const hostFps of [0, 20]) for (const enemies of [48, 20]) for (const net of NETS) cases.push({ enemies, hostFps, net });
const label = c => `${c.enemies}e-${c.hostFps || 60}fps-${c.net ? c.net.replace(/[^a-z0-9.]+/gi, '_') : 'clean'}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = text => console.error(`[matrix] ${text}`);

// -----------------------------------------------------------------------------------------------
// Setting up and taking down
// -----------------------------------------------------------------------------------------------

const started = [];
let made = null;
let current = null;
const answers = port => fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2500) }).then(r => r.ok, () => false);

async function serve(build) {
  if (await answers(build.port)) { log(`${build.tag}: using the server already on port ${build.port}`); return; }
  if (build.tag === 'baseline') {
    if (!existsSync(build.dir)) {
      log(`baseline: a worktree of ${baseline} in ${build.dir}`);
      const add = spawnSync('git', ['worktree', 'add', '--detach', build.dir, baseline], { stdio: ['ignore', 'ignore', 'inherit'] });
      if (add.status !== 0) throw new Error(`Could not make a worktree of ${baseline}`);
      made = build.dir;
    }
    if (!existsSync(join(build.dir, 'node_modules'))) {
      log('baseline: npm ci (once)');
      if (spawnSync('npm', ['ci'], { cwd: build.dir, stdio: ['ignore', 'ignore', 'inherit'] }).status !== 0) throw new Error('npm ci failed in the baseline worktree');
    }
  }
  log(`${build.tag}: starting Vite on port ${build.port}`);
  // Vite itself, not through npx: a signal sent to npx stops npx and leaves the server it started running.
  const vite = spawn(process.execPath, [join(build.dir, 'node_modules/vite/bin/vite.js'), '--port', String(build.port), '--strictPort'], { cwd: build.dir, env: { ...process.env, OP2_NO_HMR: '1' }, stdio: 'ignore' });
  started.push(vite);
  for (let waited = 0; waited < 90_000; waited += 1000) { if (await answers(build.port)) return; await sleep(1000); }
  throw new Error(`Vite did not come up on port ${build.port}`);
}

function down() {
  current?.kill('SIGTERM');
  for (const vite of started) vite.kill('SIGTERM');
  started.length = 0;
  if (made && !keep) { spawnSync('git', ['worktree', 'remove', '--force', made], { stdio: 'ignore' }); rmSync(made, { recursive: true, force: true }); made = null; }
}
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => { down(); process.exit(1); });

// -----------------------------------------------------------------------------------------------
// One run, and one case
// -----------------------------------------------------------------------------------------------

function run(build, c) {
  const env = { ...process.env, MOTION_ENEMIES: String(c.enemies), MOTION_NET: c.net, MOTION_HOST_FPS: String(c.hostFps), MOTION_SECONDS: String(seconds), MOTION_TAG: build.tag };
  const file = `${outDir}/motion-${build.tag}-${label(c)}.json`;
  rmSync(file, { force: true });
  const loadBefore = loadavg()[0];
  return new Promise(done => {
    // The proof and the kit are this checkout's, whichever build's pages they drive.
    current = spawn(process.execPath, ['tools/shot.mjs', '--port', String(build.port), '--w', '1280', '--h', '720', '--wait', '500', '--timeout', '300', '--quiet',
      '--script', 'tools/scripts/coop-motion-measure.mjs', '--out', `${outDir}/measure.png`], { env, stdio: ['ignore', 'ignore', 'inherit'] });
    current.on('exit', () => {
      current = null;
      const load = { before: Math.round(loadBefore * 10) / 10, after: Math.round(loadavg()[0] * 10) / 10 };
      try { const out = JSON.parse(readFileSync(file, 'utf8')); done({ result: out.result ?? null, failure: out.failure ?? null, load }); } catch { done({ result: null, failure: 'the run wrote no evidence', load }); }
    });
  });
}

/** Did the pages really run? See the header. */
const clean = (r, c) => !!r && r.guestFps >= 40 && r.hostFps >= (c.hostFps ? c.hostFps * 0.8 : 40);
const began = Date.now();

/** The machine is shared: a run starts when it is quiet enough, or after `--load-wait` minutes whatever it is. */
async function quiet() {
  const from = Date.now();
  while (loadavg()[0] > maxLoad && Date.now() - from < loadWaitMs) {
    log(`load ${loadavg()[0].toFixed(1)} is over ${maxLoad}: waiting`);
    await sleep(15_000);
  }
}

async function measureCase(build, c) {
  let best = null, why = 'not tried';
  for (let attempt = 1; attempt <= tries; attempt++) {
    if (Date.now() - began > budgetMs) return { status: 'not measured', why: best ? why : 'the time budget ran out', best };
    await quiet();
    const { result, failure, load } = await run(build, c);
    if (clean(result, c)) return { status: 'measured', result, attempts: attempt, load };
    if (result && (!best || result.guestFps + result.hostFps > best.guestFps + best.hostFps)) best = { hostFps: result.hostFps, guestFps: result.guestFps, cost: result.run ? { host: result.run.host, guest: result.run.guest } : undefined };
    why = result ? `machine loaded: the pages ran at host ${result.hostFps} / guest ${result.guestFps} fps` : `the run failed: ${String(failure).split('\n')[0].slice(0, 160)}`;
    log(`${build.tag} ${label(c)}: try ${attempt} of ${tries} does not count (${why})`);
  }
  return { status: 'not measured', why, best };
}

// -----------------------------------------------------------------------------------------------
// The table
// -----------------------------------------------------------------------------------------------

const cm = v => (Number.isFinite(v) ? (v * 100).toFixed(1) : '-');
const ms = v => (Number.isFinite(v) ? String(Math.round(v)) : '-');
const head = row => `| ${row.c.enemies} | ${row.c.hostFps ? `${row.c.hostFps} fps` : 'uncapped'} | ${row.c.net || 'clean'} | ${row.build} |`;

/** One yardstick for both builds: everything here comes from the two recordings, nothing from what a lane says of itself. */
const CLASS_HEAD = ['Share | How old the picture is, ms (p50 / p95) | Off the host\'s true place now, cm (p50 / p95) | Off its path, cm (p50 / p95 / p99) | Speed error p95, m/s | Stood still, % of moving frames | Stalls a minute per enemy | Longest stall, ms | Jumps a minute per enemy | Back-steps a minute per enemy |',
  '---:|---|---|---|---:|---:|---:|---:|---:|---:|'];
const classCells = k => !k?.samples ? '0% | | | | | | | | | |'
  : `${Math.round(k.share * 100)}% | ${ms(k.lagMs.p50)} / ${ms(k.lagMs.p95)} | ${cm(k.nowError.p50)} / ${cm(k.nowError.p95)} | ${cm(k.offPath.p50)} / ${cm(k.offPath.p95)} / ${cm(k.offPath.p99)} | ${k.speedError.p95.toFixed(2)} | ${k.stall.percent} | ${k.stall.perEnemyMinute} | ${ms(k.stall.ms.max)} | ${k.jumps.perEnemyMinute} | ${k.backsteps.perEnemyMinute} |`;

function tableCommon(rows) {
  const lines = [`| Enemies | Host | Network | Build | Pages, fps (host / guest) | Load | ${CLASS_HEAD[0].replace('Share | ', '')} Snapshot B/s |`, `|---:|---|---|---|---|---:|${CLASS_HEAD[1].replace('---:|', '')}---:|`];
  for (const row of rows) {
    if (row.status !== 'measured') { lines.push(`${head(row)} not measured: ${row.why} | | | | | | | | | | | |`); continue; }
    const r = row.result;
    lines.push(`${head(row)} ${r.hostFps} / ${r.guestFps} | ${row.load?.before ?? '-'} | ${classCells(r.common.all).replace(/^\d+% \| /, '')} ${r.bytes.snapshotsPerSecond} |`);
  }
  return lines.join('\n');
}

/** The same columns for a part of the crowd: near and far by the host's rule, or on and off the guest's screen. */
function tableClasses(rows, classes) {
  const lines = [`| Enemies | Host | Network | Build | Which | ${CLASS_HEAD[0]}`, `|---:|---|---|---|---|${CLASS_HEAD[1]}`];
  for (const row of rows) {
    if (row.status !== 'measured') continue;
    for (const key of classes) lines.push(`${head(row)} ${key} | ${classCells(row.result.common[key])}`);
  }
  return lines.join('\n');
}

/** What each lane says of itself (the earlier table's columns): the new lane against its own playhead, the old at one best delay. */
function tableOwn(rows) {
  const lines = ['| Enemies | Host | Network | Build | Drawn behind, ms | Error p50 / p95 / p99, cm | Yaw error p50 / p95, deg | Stalled frames | Stalls a minute per enemy | Step p95, cm | Frame time p50 / p95 / max, ms (host; guest) | All lanes B/s |',
    '|---:|---|---|---|---:|---|---|---:|---:|---:|---|---:|'];
  for (const row of rows) {
    if (row.status !== 'measured') continue;
    const r = row.result;
    // Against the moment the guest says it is drawing, where it says (the new lane); else the one delay that fits best.
    const e = r.declared?.error ?? r.error, y = r.declared?.yaw ?? r.yaw;
    const behind = r.declared ? `${Math.round(r.declared.behindMs.p50)} (p95 ${Math.round(r.declared.behindMs.p95)})` : `${r.delay}`;
    const f = r.frames ? `${ms(r.frames.hostMs.p50)} / ${ms(r.frames.hostMs.p95)} / ${ms(r.frames.hostMs.max)}; ${ms(r.frames.guestMs.p50)} / ${ms(r.frames.guestMs.p95)} / ${ms(r.frames.guestMs.max)}` : '-';
    lines.push(`${head(row)} ${behind} | ${cm(e.p50)} / ${cm(e.p95)} / ${cm(e.p99)} | ${y.p50.toFixed(1)} / ${y.p95.toFixed(1)} | ${r.stalls.frames} (${r.stalls.percent}%) | ${r.stalls.perEnemyMinute} | ${cm(r.step.p95)} | ${f} | ${r.bytes.hostAllLanesPerSecond} |`);
  }
  return lines.join('\n');
}

const table = rows => `One yardstick for both builds, the whole crowd:\n\n${tableCommon(rows)}\n\nOn the guest's screen, just come onto it, and off it:\n\n${tableClasses(rows, ['seen', 'entered', 'unseen'])}\n\nNear and far by the host's rule:\n\n${tableClasses(rows, ['near', 'far'])}\n\nKnocked down (a ragdoll on each screen's own physics) and the 3 s after, kept out of the tables above:\n\n${tableClasses(rows, ['down', 'rising'])}\n\nWhat each lane says of itself:\n\n${tableOwn(rows)}`;

if (args.includes('--reanalyse')) {
  const { analyse } = await import('./coop-motion-measure.mjs');
  const saved = JSON.parse(readFileSync(`${outDir}/motion-results.json`, 'utf8'));
  for (const row of saved.rows) {
    if (row.status !== 'measured') continue;
    const raw = JSON.parse(gunzipSync(readFileSync(`${outDir}/motion-${row.tag}-${row.case}.raw.json.gz`)));
    row.result = { ...row.result, ...analyse(raw.host, raw.guest) };
  }
  writeFileSync(`${outDir}/motion-results.json`, JSON.stringify(saved, null, 1));
  writeFileSync(`${outDir}/motion-table.md`, `${table(saved.rows)}\n`);
  console.log(table(saved.rows));
  process.exit(0);
}
if (opt('table')) {
  console.log(table(JSON.parse(readFileSync(opt('table'), 'utf8')).rows));
  process.exit(0);
}

const rows = [];
const write = () => {
  writeFileSync(`${outDir}/motion-results.json`, JSON.stringify({ when: new Date().toISOString(), baseline: baseline ?? null, seconds, tries, rows }, null, 1));
  writeFileSync(`${outDir}/motion-table.md`, `${table(rows)}\n`);
};
try {
  for (const build of builds) await serve(build);
  for (const c of cases) {
    if (only && !label(c).includes(only)) continue;
    for (const build of builds) {
      log(`${label(c)} on ${build.tag}`);
      rows.push({ case: label(c), c, build: build.label, tag: build.tag, ...await measureCase(build, c) });
      write();
    }
  }
} finally {
  down();
}
write();
console.log(table(rows));
const missing = rows.filter(row => row.status !== 'measured').length;
log(`${rows.length - missing} of ${rows.length} measured; evidence in ${outDir}`);
process.exit(missing ? 3 : 0);
