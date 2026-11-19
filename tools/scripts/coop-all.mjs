#!/usr/bin/env node
// Every co-op browser proof, one command: the regression suite for co-op (docs/notes/coop.md, "Testing").
//
//   node tools/scripts/coop-all.mjs --port <your port> [--suite clean,bad] [--only <text or /regex/>] [--lane team,session]
//
// It lists every proof with its parameters (players, mode, map, transport, network), runs them through tools/shot.mjs (so
// the machine's browser slots are honoured), one at a time unless --jobs 2, each with its own time limit, and writes one
// table: results.json and results.md in --out (default tools/out/coop/all/). Each run gets a folder of its own there with
// the proof's evidence JSON, its screenshots, shot.mjs's report (report.json), its log (log.txt) and what it cost (cost.json).
//
//   --port <n>        the Vite server to use. If nothing answers there, one is started (HMR off) and stopped at the end.
//                     Never 5173. A server left running across an edit or a rebase serves old modules: let this start it.
//   --suite <names>   clean   every proof on the loopback transport, clean network (the default)
//                     bad     the same under lag:120,jitter:40,loss:0.05 (proofs that take a network)
//                     rtc     each lane's main proof over real WebRTC and the public relays (spaced out, one at a time)
//                     four    each lane's main proof with four pages
//                     guest   every mode from a guest's seat (coop-guest-seat.mjs), at 1440x900 dpr 2 with pictures
//                     legacy  the five oldest proofs (their own pages over the real relays)
//                     all     everything
//   --only <text>     runs whose id contains the text, or matches /regex/
//   --lane <names>    only these lanes (session, team, gore, weapons-fx, call-ins, world-a, world-b, time, enemy-attacks,
//                     enemy-motion, claims, missions, old, guest)
//   --list            print the list and stop
//   --ledger          print the results so far as a table for a document (no folders), and stop
//   --jobs <1|2>      runs at once (default 1; never more than 2: the machine is shared, the queue allows 3 in all)
//   --retry <mode>    harness (default): a failed run is run once more if it failed for a harness reason: it hit its time
//                     limit, a page was starved (the kit's frame figures in the evidence, or the machine's load), the
//                     browser died, or on rtc the lobby never formed (relays). all: any failure once more. none.
//   --force           run again what already passed
//   --any-commit      a pass on an older game or proof counts as done (the table still says which commit)
//   --max-load <n>    wait while the 1-minute load is above this before starting a run (default 16)
//   --out <dir>       results folder
//
// Resumable: a run that already passed on the same game and the same proof is skipped, so stopping and starting again
// carries on. "The same game" is the tree of src/ at HEAD plus any uncommitted change to it (a commit that touches only
// docs or tools does not make the game new); "the same proof" is the text of its script and of the kits. The table names
// the commit each row was run on. Exit code 0 when nothing failed, 1 otherwise.
//
// Reading the table: `pass`, `FAIL`, `pass (2nd try)` with the first try's reason kept, `not run`. "Checks" is passed/failed:
// a proof stops at its first failed check, so failed is 1 unless the proof is a matrix that goes on (fx, call-ins, claims,
// attacks). Adding a proof: one line in PROOFS below.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BAD = 'lag:120,jitter:40,loss:0.05';

// ---- The list -------------------------------------------------------------------------------------------------------
// One entry per proof case. `env` is what the proof itself reads; `sim` names the variable that takes the bad network
// (a function gives the proof's own spelling), `count` the variable that takes the player count. `suites` says where it
// runs; `rtc` and `four` mark a lane's main proof(s). `slow`: the proof stalls, caps or hides a page on purpose, so low
// frame figures are not a starved machine. `t` is the time limit in seconds once the browser is up.
const size = { w: 1280, h: 720, dpr: 1 };
const look = { w: 1440, h: 900, dpr: 2 };
const sim = name => net => ({ [name]: net });
const coopSim = sim('COOP_SIM');
const teamNet = () => ({ TEAM_NET: 'bad' });
const P = (id, lane, script, o = {}) => ({ id, lane, script: `tools/scripts/${script}.mjs`, players: 2, mode: 'crucible', map: '', env: {}, t: 600, sim: coopSim, ...size, ...o });

const smokeModes = [['crucible'], ['outpost'], ['defense'], ['crucible', 'office'], ['outpost', 'office'], ['campaign'], ['foreclosure']];

export const PROOFS = [
  // session: the life of a session (docs/notes/coop.md, "The life of a session")
  P('session-start', 'session', 'coop-session-start', { players: 3, count: 'COOP_PLAYERS', rtc: true, four: true, t: 700 }),
  P('session-modes', 'session', 'coop-session-modes', { mode: 'every mode', t: 900 }),
  P('session-late', 'session', 'coop-session-late', { t: 700 }),
  P('session-noshow', 'session', 'coop-session-noshow', { t: 700 }),
  P('session-password', 'session', 'coop-session-password', { t: 500 }),
  P('session-reload', 'session', 'coop-session-reload', { players: 3, t: 900 }),
  P('session-three', 'session', 'coop-session-three', { players: 3, t: 900, slow: true }),
  P('session-hostquit', 'session', 'coop-session-hostquit', { players: 3, t: 700 }),
  P('session-blip', 'session', 'coop-session-blip', { t: 600, slow: true }),
  P('session-drop', 'session', 'coop-session-drop', { suites: [], rtc: true, t: 600 }),

  // team: endings, the break, seats, the co-op HUD ("The team's rules")
  P('team-endings/wipe', 'team', 'coop-team-endings', { env: { TEAM_CASE: 'wipe' }, sim: teamNet, count: 'TEAM_PLAYERS', rtc: true, four: true, t: 900 }),
  P('team-endings/humans', 'team', 'coop-team-endings', { mode: 'outpost', env: { TEAM_CASE: 'humans' }, sim: teamNet, count: 'TEAM_PLAYERS', t: 900 }),
  P('team-endings/mission', 'team', 'coop-team-endings', { mode: 'campaign', env: { TEAM_CASE: 'mission' }, sim: teamNet, count: 'TEAM_PLAYERS', t: 900 }),
  P('team-break', 'team', 'coop-team-break', { players: 3, sim: teamNet, count: 'TEAM_PLAYERS', four: true, t: 700 }),
  P('team-rejoin', 'team', 'coop-team-rejoin', { sim: teamNet, count: 'TEAM_PLAYERS', rtc: true, t: 700 }),
  P('team-ui', 'team', 'coop-team-ui', { sim: teamNet, count: 'TEAM_PLAYERS', t: 700 }),
  P('team-solo', 'team', 'coop-team-solo', { players: 1, transport: 'none', url: '/?contract=crucible&autostart=1', wait: 3000, sim: null, t: 300 }),

  // gore: the cosmetic damage model on every screen ("Gore on every screen")
  P('gore-shots', 'gore', 'coop-gore-shots', { players: 3, rtc: true, t: 900 }),
  P('gore-bytes', 'gore', 'coop-gore-bytes', { players: 3, sim: null, t: 500 }),

  // weapons-fx: every weapon as the other players see it ("Weapons on other screens")
  P('fx-matrix', 'weapons-fx', 'coop-fx-matrix', { players: 3, sim: sim('FX_NET'), env: { FX_SHOTS: '0' }, rtc: true, t: 1800 }),

  // call-ins ("Call-ins on every screen")
  P('callins-matrix', 'call-ins', 'coop-callins-matrix', { players: 3, sim: sim('CALLINS_SIM'), count: 'CALLINS_PLAYERS', tag: 'CALLINS_TAG', rtc: true, four: true, t: 1800 }),

  // world-a: pods, dropped guns, things that break ("The shared world")
  P('world-pods', 'world-a', 'coop-world-pods', { count: 'COOP_PLAYERS', rtc: true, four: true }),
  P('world-pods/outpost', 'world-a', 'coop-world-pods', { mode: 'outpost', env: { COOP_MODE: 'outpost' }, count: 'COOP_PLAYERS' }),
  P('world-drops', 'world-a', 'coop-world-drops', { players: 3, count: 'COOP_PLAYERS', rtc: true }),
  P('world-props', 'world-a', 'coop-world-props', { count: 'COOP_PLAYERS' }),
  P('world-props/office', 'world-a', 'coop-world-props', { map: 'office', env: { COOP_MAP: 'office' }, count: 'COOP_PLAYERS' }),
  P('world-cache/campaign', 'world-a', 'coop-world-cache', { mode: 'campaign', env: { COOP_MODE: 'campaign' }, count: 'COOP_PLAYERS' }),
  P('world-cache/foreclosure', 'world-a', 'coop-world-cache', { mode: 'foreclosure', env: { COOP_MODE: 'foreclosure' }, count: 'COOP_PLAYERS' }),

  // world-b: Outpost Defense, the villain's props, prisoners, vehicles
  P('worldb-defense', 'world-b', 'coop-worldb-defense', { mode: 'defense', count: 'COOP_PLAYERS', rtc: true, four: true, t: 900 }),
  P('worldb-props', 'world-b', 'coop-worldb-props', { mode: 'outpost', players: 3, count: 'COOP_PLAYERS', t: 700 }),
  P('worldb-prisoners', 'world-b', 'coop-worldb-prisoners', { mode: 'outpost', players: 3, count: 'COOP_PLAYERS', t: 900 }),
  P('worldb-vehicles', 'world-b', 'coop-worldb-vehicles', { mode: 'defense', count: 'COOP_PLAYERS', t: 900 }),

  // time: the team's slow motion
  P('time-team', 'time', 'coop-time-team', { count: 'COOP_PLAYERS', rtc: true, four: true, t: 700 }),
  P('time-slowhost', 'time', 'coop-time-slowhost', { sim: null, t: 400, slow: true }),
  P('time-solo', 'time', 'coop-time-solo', { players: 1, transport: 'none', url: '/?contract=crucible&autostart=1', wait: 3000, sim: null, t: 300 }),

  // enemy-attacks ("Enemy attacks on guests")
  P('attacks-crucible', 'enemy-attacks', 'coop-attacks-crucible', { count: 'COOP_PLAYERS', rtc: true, t: 1200 }),
  P('attacks-humans', 'enemy-attacks', 'coop-attacks-humans', { mode: 'outpost', count: 'COOP_PLAYERS', t: 1200 }),
  P('attacks-hazards', 'enemy-attacks', 'coop-attacks-hazards', { players: 3, count: 'COOP_PLAYERS', four: true, t: 800 }),
  P('attacks-shots', 'enemy-attacks', 'coop-attacks-shots', { sim: null, ...look, t: 500 }),

  // enemy-motion (the smoothness matrix is coop-motion-matrix.mjs, a runner of its own)
  P('motion-moves', 'enemy-motion', 'coop-motion-moves', { sim: sim('MOVES_NET'), rtc: true, t: 500 }),
  P('motion-moves/outpost', 'enemy-motion', 'coop-motion-moves', { mode: 'outpost', env: { MOVES_MODE: 'outpost' }, sim: sim('MOVES_NET'), t: 500 }),

  // claims: a guest's honest shots are never lost
  P('claims-matrix', 'claims', 'coop-claims-matrix', { mode: 'outpost', tag: 'CLAIMS_TAG', rtc: true, t: 1800 }),
  P('claims-matrix/hitch', 'claims', 'coop-claims-matrix', { mode: 'outpost', env: { CLAIMS_HITCH: '1' }, tag: 'CLAIMS_TAG', sim: null, t: 1800, slow: true }),

  // missions: both, first line to the team board, films skipped by vote (the lane's own long run let them play)
  P('missions-play/campaign', 'missions', 'coop-missions-play', { mode: 'campaign', env: { COOP_MISSION: 'campaign', COOP_ACTOR: 'guest', COOP_EXTRAS: 'skip', COOP_SHOTS: '0' }, count: 'COOP_PLAYERS', tag: 'COOP_TAG', rtc: true, t: 1700, slow: true }),
  P('missions-play/foreclosure', 'missions', 'coop-missions-play', { mode: 'foreclosure', env: { COOP_MISSION: 'foreclosure', COOP_ACTOR: 'guest', COOP_EXTRAS: 'skip', COOP_SHOTS: '0' }, count: 'COOP_PLAYERS', tag: 'COOP_TAG', t: 1700, slow: true }),

  // old: the proofs from before the overhaul, kept as regression tests
  ...smokeModes.map(([mode, map]) => P(`smoke/${mode}${map ? `@${map}` : ''}`, 'old', 'coop-smoke', { mode, map: map ?? '', env: { COOP_MODE: mode, ...(map ? { COOP_MAP: map } : {}) }, count: 'COOP_PLAYERS', t: 400,
    ...(mode === 'crucible' && !map ? { rtc: true, four: true } : {}) })),
  P('stage3', 'old', 'coop-stage3', { rtc: true, t: 900, slow: true }),
  P('drops', 'old', 'coop-drops', { t: 600 }),
  P('robust', 'old', 'coop-robust', { sim: null, t: 700 }),
  P('modes/humans', 'old', 'coop-modes', { mode: 'outpost', env: { COOP_MODE: 'humans' }, t: 700 }),
  P('modes/defense', 'old', 'coop-modes', { mode: 'defense', env: { COOP_MODE: 'defense' }, t: 700 }),
  P('modes/office', 'old', 'coop-modes', { map: 'office', env: { COOP_MODE: 'office' }, t: 700 }),
  P('mission', 'old', 'coop-mission', { mode: 'campaign', t: 800 }),
  P('baseline', 'old', 'coop-baseline', { sim: null, t: 400 }),
  P('lobby', 'old', 'coop-lobby', { rtc: true, t: 300 }),

  // legacy: the four oldest proofs still as they were written, each its own two pages over the real relays, before the kit
  P('stage1', 'old', 'coop-stage1', { suites: ['legacy'], transport: 'rtc', sim: null, ...look, t: 450 }),
  P('stage2', 'old', 'coop-stage2', { suites: ['legacy'], transport: 'rtc', sim: null, ...look, t: 700 }),
  P('picker/desktop', 'old', 'coop-picker', { suites: ['legacy'], transport: 'rtc', sim: null, env: { GUEST: 'desktop' }, ...look, t: 600 }),
  P('picker/phone', 'old', 'coop-picker', { suites: ['legacy'], transport: 'rtc', sim: null, env: { GUEST: 'phone' }, ...look, t: 600 }),
  P('dad/ready', 'old', 'coop-dad', { suites: ['legacy'], transport: 'rtc', sim: null, env: { FLOW: 'ready' }, ...look, t: 600 }),
  P('dad/force', 'old', 'coop-dad', { suites: ['legacy'], transport: 'rtc', sim: null, env: { FLOW: 'force' }, ...look, t: 600 }),

  // guest: every mode from a guest's seat, the nearest thing to a playtest (pictures at the owner's screen size)
  ...[['crucible'], ['outpost'], ['outpost', 'office'], ['defense'], ['campaign'], ['foreclosure']].map(([mode, map]) =>
    P(`guest-seat/${mode}${map ? `@${map}` : ''}`, 'guest', 'coop-guest-seat', { mode, map: map ?? '', players: 3, env: { COOP_MODE: mode, ...(map ? { COOP_MAP: map } : {}) }, count: 'COOP_PLAYERS', suites: ['guest'], ...look, t: 1500, slow: true })),
];

/** Every run of the asked suites: a proof case at a player count, on a transport and a network. */
export function runs(suites) {
  const out = [];
  const add = (p, suite, { players = p.players, transport = p.transport ?? 'loop', net = '' } = {}) => {
    const env = { ...p.env };
    if (transport !== 'none') env.COOP_NET = transport;
    if (net && p.sim) Object.assign(env, p.sim(net));
    if (p.count && players !== p.players) env[p.count] = String(players);
    const id = `${p.id} ${players}p ${transport === 'none' ? 'solo' : transport} ${net ? 'bad' : 'clean'}`;
    if (p.tag) env[p.tag] = id.replace(/[^a-z0-9]+/gi, '-');
    out.push({ ...p, id, proof: p.id, suite, players, transport, net, env });
  };
  for (const p of PROOFS) {
    const own = p.suites ?? ['clean', 'bad'];
    if (suites.has('clean') && own.includes('clean')) add(p, 'clean');
    if (suites.has('bad') && own.includes('bad') && p.sim) add(p, 'bad', { net: BAD });
    if (suites.has('guest') && own.includes('guest')) add(p, 'guest');
    if (suites.has('legacy') && own.includes('legacy')) add(p, 'legacy');
    if (suites.has('rtc') && p.rtc) add(p, 'rtc', { transport: 'rtc' });
    if (suites.has('four') && p.four && p.count) add(p, 'four', { players: 4 });
  }
  return out;
}

// ---- A run's verdict ------------------------------------------------------------------------------------------------
const readJson = file => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } };
const firstLine = text => String(text ?? '').split('\n')[0].replace(/^\[script\]\s*/, '').replace(/^Error:\s*/, '').slice(0, 400);

/** What the run's folder says: checks passed, what failed first, the pages' frame figures. Pure, so it can be tested. */
export function verdict({ exit, report, evidence = [], cost, log = '', run, maxLoad = 16 }) {
  const result = report?.scriptResult;
  const all = [result, ...evidence].filter(v => v && typeof v === 'object');
  const count = v => Array.isArray(v?.checks) ? v.checks.length : typeof v?.checks === 'number' ? v.checks : 0;
  const passed = Math.max(0, ...all.map(count));
  const failures = [];
  const scriptError = (report?.errors ?? []).find(e => e.startsWith('[script]'));
  if (scriptError) failures.push(firstLine(scriptError));
  for (const v of all) {
    if (typeof v.failure === 'string') failures.push(firstLine(v.failure));
    if (typeof v.failed === 'string') failures.push(firstLine(v.failed));
    if (Array.isArray(v.failed)) for (const f of v.failed) failures.push(firstLine(typeof f === 'string' ? f : f.message ?? f.line ?? JSON.stringify(f)));
    if (v.ok === false && !v.failed) failures.push('the proof says it failed');
  }
  if (!report) failures.push(exit === 2 || /exceeded \d+s/.test(log) ? `hit its time limit of ${run?.t} s` : `shot.mjs gave no report (exit ${exit})`);
  else if (!result && !scriptError) failures.push((report.errors ?? []).find(e => e.startsWith('[goto]')) ? 'the page did not load' : 'the proof returned nothing');
  const unique = [...new Set(failures)];
  // A matrix that goes on counts each failed line; a proof that stops counts one.
  const matrix = all.some(v => Array.isArray(v.failed));
  const failed = unique.length === 0 ? 0 : matrix ? Math.max(1, ...all.map(v => Array.isArray(v.failed) ? v.failed.length : 0)) : 1;
  const frames = Object.assign({}, ...all.map(v => v.frames ?? {}));
  // Why a failure may be the harness's: its time limit, a starved page, the browser gone, the relays.
  let reason = '';
  if (failed) {
    const text = `${unique.join(' | ')} ${scriptError ?? ''}`;
    const starved = Object.entries(frames).filter(([, f]) => f.n >= 5 && f.low / f.n > 0.4).map(([tag, f]) => `${tag} ${f.mean}`);
    if (!report) reason = /exceeded \d+s/.test(log) || exit === 2 ? 'time limit' : 'no report';
    else if (/Target page, context or browser has been closed|Target closed|browser has been closed|Protocol error/.test(text)) reason = 'browser gone';
    else if (!run?.slow && starved.length) reason = `starved (${starved.join(', ')} frames a second)`;
    else if ((cost?.load?.[1] ?? 0) > maxLoad * 1.5) reason = `machine load ${cost.load[1]}`;
    else if (run?.transport === 'rtc' && passed === 0 && /startParty|joinFromSplash|openGuest|co-player|co-code|Join lobby|inMatch|waitForURL/.test(text)) reason = 'relays (the lobby or the match never formed)';
  }
  return { passed, failed, first: unique[0] ?? '', failures: unique.slice(0, 12), frames, reason };
}

// ---- Running --------------------------------------------------------------------------------------------------------
const sleep = ms => new Promise(r => setTimeout(r, ms));
const git = (...args) => spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
const sha = text => createHash('sha1').update(text).digest('hex').slice(0, 6);
const GAME = ['src', 'public', 'index.html', 'vite.config.ts', 'package.json'];
/** The commit a result is written against: HEAD, marked when the game has uncommitted changes. */
export function commitId() {
  const head = git('rev-parse', '--short', 'HEAD');
  const dirty = git('diff', 'HEAD', '--', ...GAME);
  return dirty ? `${head}+${sha(dirty)}` : head;
}
/** The game a result belongs to: the tree of src/ at HEAD and any uncommitted change to the game. Not moved by docs or tools. */
export function gameId() {
  const dirty = git('diff', 'HEAD', '--', ...GAME);
  return git('rev-parse', '--short', 'HEAD:src') + (dirty ? `+${sha(dirty)}` : '');
}
/** The proof a result belongs to: its script and every kit, as they are on disk. */
export function proofId(run) {
  const kits = readdirSync(join(ROOT, 'tools/scripts')).filter(f => /^coop-.*kit\.mjs$/.test(f)).sort();
  return sha([run.script, ...kits.map(f => `tools/scripts/${f}`), 'tools/shot.mjs'].map(f => readFileSync(join(ROOT, f), 'utf8')).join('\0'));
}
const slug = id => id.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();

const active = new Set();
function runOnce(run, { port, outRoot, attempt }) {
  const dir = join(outRoot, slug(run.id) + (attempt > 1 ? `.try${attempt}` : ''));
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const shot = ['tools/shot.mjs', '--port', String(port), '--quiet', '--w', String(run.w), '--h', String(run.h), '--dpr', String(run.dpr), '--wait', String(run.wait ?? 500),
    '--timeout', String(run.t), '--script', run.script, '--out', join(dir, 'x.png'), ...(run.url ? ['--url', run.url] : [])];
  const args = ['tools/proof-cost.mjs', '--json', join(dir, 'cost.json'), '--label', run.id, '--', process.execPath, ...shot];
  const started = Date.now();
  return new Promise(done => {
    const child = spawn(process.execPath, args, { cwd: ROOT, env: { ...process.env, ...run.env }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let stdout = '', log = '';
    active.add(child.pid);
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { log += d; });
    // A backstop over shot.mjs's own limit, which only counts from the browser's start: the slot queue may take a while.
    const backstop = setTimeout(() => { log += `\n[coop-all] no end after ${run.t + 1500} s: killed\n`; try { process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ } }, (run.t + 1500) * 1000);
    child.on('exit', code => {
      clearTimeout(backstop);
      active.delete(child.pid);
      try { process.kill(-child.pid, 'SIGKILL'); } catch { /* nothing left */ }
      let report = null;
      // shot.mjs prints its report last, as indented JSON: from the last line that is just an opening brace.
      try { report = JSON.parse(stdout.slice(stdout.search(/^\{$(?![\s\S]*^\{$)/m))); } catch { /* no report */ }
      writeFileSync(join(dir, 'log.txt'), log);
      if (report) writeFileSync(join(dir, 'report.json'), JSON.stringify(report, null, 2));
      const evidence = readdirSync(dir).filter(f => f.endsWith('.json') && !['report.json', 'cost.json'].includes(f)).map(f => readJson(join(dir, f)));
      const cost = readJson(join(dir, 'cost.json'));
      done({ dir, exit: code, report, evidence, cost, log, seconds: Math.round((Date.now() - started) / 1000) });
    });
  });
}

async function calm(maxLoad, say) {
  for (let told = false; loadavg()[0] > maxLoad; await sleep(15000)) {
    if (!told) { say(`waiting: the machine's load is ${loadavg()[0].toFixed(1)}, over ${maxLoad}`); told = true; }
  }
}

/** The table for a document: by lane, without the runs' folders (tools/out does not persist). `--ledger` prints it. */
export function ledger(results) {
  const rows = Object.values(results).sort((a, b) => a.lane.localeCompare(b.lane) || a.id.localeCompare(b.id));
  const cell = text => String(text ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const lines = ['| Lane | Proof | Players | Mode | Transport | Network | Result | Checks passed / failed | Commit | First failing check |', '|---|---|---:|---|---|---|---|---:|---|---|'];
  for (const r of rows) {
    lines.push(`| ${r.lane} | \`${r.proof}\` | ${r.players} | ${cell(r.mode)}${r.map ? ` (${r.map})` : ''} | ${r.transport === 'none' ? 'one page' : r.transport} | ${r.net ? 'bad' : 'clean'} | ${r.verdict}${r.note ? ` (${cell(r.note).slice(0, 120)})` : ''} | ${r.passed} / ${r.failed} | \`${r.commit}\` | ${cell(r.first).slice(0, 200)} |`);
  }
  const by = {};
  for (const r of rows) { const k = `${r.transport === 'none' ? 'one page' : r.transport}, ${r.net ? 'bad' : 'clean'} network, ${r.players} players`; (by[k] ??= [0, 0])[r.verdict === 'FAIL' ? 1 : 0]++; }
  const sums = Object.entries(by).sort().map(([k, [pass, fail]]) => `- ${k}: ${pass} passed${fail ? `, ${fail} failed` : ''}`);
  return `${rows.filter(r => r.verdict !== 'FAIL').length} of ${rows.length} runs passed.\n\n${sums.join('\n')}\n\n${lines.join('\n')}\n`;
}

export function table(results, { commit, suites } = {}) {
  const rows = Object.values(results).sort((a, b) => a.lane.localeCompare(b.lane) || a.id.localeCompare(b.id));
  const cell = text => String(text ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const lines = [
    `Co-op proofs: ${rows.filter(r => r.verdict !== 'FAIL').length} of ${rows.length} runs passed${commit ? ` (table written on \`${commit}\`${suites ? `, suites ${[...suites].join(', ')}` : ''})` : ''}.`,
    '',
    '| Proof | Players | Mode | Transport | Network | Result | Checks passed / failed | Seconds | Commit | First failing check | Evidence |',
    '|---|---:|---|---|---|---|---:|---:|---|---|---|',
  ];
  for (const r of rows) {
    lines.push(`| \`${r.proof}\` | ${r.players} | ${cell(r.mode)}${r.map ? ` (${r.map})` : ''} | ${r.transport === 'none' ? 'one page' : r.transport} | ${r.net ? 'bad' : 'clean'} | ${r.verdict}${r.note ? ` (${cell(r.note)})` : ''} | ${r.passed} / ${r.failed} | ${r.seconds} | \`${r.commit}\` | ${cell(r.first).slice(0, 260)} | \`${cell(r.evidence)}\` |`);
  }
  return lines.join('\n') + '\n';
}

async function main() {
  const argv = process.argv.slice(2), opt = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) opt[argv[i].slice(2)] = true; else { opt[argv[i].slice(2)] = next; i++; }
  }
  const asked = String(opt.suite ?? 'clean').split(',');
  const suites = new Set(asked.includes('all') ? ['clean', 'bad', 'rtc', 'four', 'guest', 'legacy'] : asked);
  const lanes = opt.lane ? new Set(String(opt.lane).split(',')) : null;
  const only = opt.only === undefined ? null : /^\/.*\/$/.test(opt.only) ? new RegExp(String(opt.only).slice(1, -1)) : null;
  let list = runs(suites).filter(r => (!lanes || lanes.has(r.lane)) && (opt.only === undefined || (only ? only.test(r.id) : r.id.includes(String(opt.only)))));
  if (opt.list) {
    for (const r of list) console.log(`${r.id.padEnd(48)} ${r.lane.padEnd(14)} ${String(r.t).padStart(5)} s  ${Object.entries(r.env).map(([k, v]) => `${k}=${v}`).join(' ')}`);
    console.log(`${list.length} runs`);
    return 0;
  }
  if (opt.ledger) {
    process.stdout.write(ledger(readJson(join(resolve(ROOT, String(opt.out ?? 'tools/out/coop/all')), 'results.json'))?.results ?? {}));
    return 0;
  }
  const port = Number(opt.port);
  if (!port || port === 5173) { console.error('--port <your own Vite port> is needed (never 5173)'); return 64; }
  const jobs = Math.max(1, Math.min(2, Number(opt.jobs ?? 1)));
  const retry = String(opt.retry ?? 'harness');
  const maxLoad = Number(opt['max-load'] ?? 16);
  const outRoot = resolve(ROOT, String(opt.out ?? 'tools/out/coop/all'));
  mkdirSync(outRoot, { recursive: true });
  const file = join(outRoot, 'results.json');
  const results = readJson(file)?.results ?? {};
  // The game is read again before every run: a rebase or an edit under a running sweep must not be written down as the old game.
  let commit = commitId(), game = gameId();
  const say = text => console.error(`[coop-all ${new Date().toTimeString().slice(0, 8)}] ${text}`);
  const save = () => {
    writeFileSync(file, JSON.stringify({ commit, written: new Date().toISOString(), results }, null, 2));
    writeFileSync(join(outRoot, 'results.md'), table(results, { commit, suites }));
  };

  // The server: this checkout's own, started here so it cannot be serving modules from before an edit.
  let vite = null;
  const up = () => fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2000) }).then(r => r.ok, () => false);
  if (await up()) say(`using the server already on port ${port} (if it was started before the last edit or rebase, it serves old modules)`);
  else {
    vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(port), '--strictPort'], { cwd: ROOT, env: { ...process.env, OP2_NO_HMR: '1' }, stdio: 'ignore', detached: true });
    for (let i = 0; i < 60 && !await up(); i++) await sleep(500);
    if (!await up()) { say(`Vite did not come up on port ${port}`); return 70; }
    say(`started Vite on port ${port}`);
  }
  const stop = () => {
    for (const pid of active) try { process.kill(-pid, 'SIGKILL'); } catch { /* gone */ }
    if (vite) try { process.kill(-vite.pid, 'SIGTERM'); } catch { /* gone */ }
  };
  process.on('exit', stop);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => process.exit(130));

  const done = r => results[r.id]?.verdict?.startsWith('pass') && (opt['any-commit'] || (results[r.id].game === game && results[r.id].proofId === proofId(r)));
  const todo = opt.force ? list : list.filter(r => !done(r));
  say(`${list.length} runs asked, ${list.length - todo.length} already passed on ${opt['any-commit'] ? 'some commit' : `this game (${commit})`}, ${todo.length} to run, ${jobs} at a time`);

  let lastRtc = 0;
  const one = async run => {
    let record = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      await calm(maxLoad, say);
      if (run.transport === 'rtc') {
        // The public relays throttle a client that connects again and again: space real-WebRTC runs out.
        const gap = Number(opt['rtc-gap'] ?? 45) * 1000 * attempt - (Date.now() - lastRtc);
        if (gap > 0) await sleep(gap);
      }
      commit = commitId(); game = gameId();
      const ran = { commit, game };
      say(`run  ${run.id}${attempt > 1 ? ' (second try)' : ''}`);
      const got = await runOnce(run, { port, outRoot, attempt });
      if (run.transport === 'rtc') lastRtc = Date.now();
      const v = verdict({ ...got, run, maxLoad });
      const tried = { attempt, verdict: v.failed ? 'FAIL' : 'pass', passed: v.passed, failed: v.failed, first: v.first, reason: v.reason, seconds: got.seconds, evidence: got.dir };
      record = {
        id: run.id, proof: run.proof, lane: run.lane, suite: run.suite, players: run.players, mode: run.mode, map: run.map, transport: run.transport, net: run.net,
        commit: ran.commit, game: ran.game, proofId: proofId(run), at: new Date().toISOString(), verdict: v.failed ? 'FAIL' : attempt > 1 ? 'pass (2nd try)' : 'pass', passed: v.passed, failed: v.failed, first: v.first, failures: v.failures,
        note: v.failed ? v.reason : attempt > 1 ? `first try: ${record.tries[0].reason || 'failed'}: ${record.tries[0].first}`.slice(0, 200) : '',
        seconds: got.seconds, wait: got.cost?.waitSeconds ?? null, cpu: got.cost?.cpuSeconds ?? null, peakMb: got.cost?.peakMb ?? null, load: got.cost?.load ?? null,
        frames: v.frames, evidence: got.dir, tries: [...(record?.tries ?? []), tried],
      };
      say(`${record.verdict.padEnd(5)} ${run.id}: ${v.passed} checks${v.failed ? `, FAILED ${v.failed}: ${v.first}${v.reason ? ` [${v.reason}]` : ''}` : ''} (${got.seconds} s)`);
      if (!v.failed || retry === 'none' || (retry === 'harness' && !v.reason)) break;
    }
    results[run.id] = record;
    save();
  };
  // rtc runs never overlap each other (one set of relays); everything else takes `jobs` at once.
  const queue = [...todo];
  let rtcBusy = false;
  const worker = async () => {
    for (;;) {
      const i = queue.findIndex(r => r.transport !== 'rtc' || !rtcBusy);
      if (i < 0) { if (!queue.length) return; await sleep(1000); continue; }
      const [run] = queue.splice(i, 1);
      if (run.transport === 'rtc') rtcBusy = true;
      try { await one(run); } finally { if (run.transport === 'rtc') rtcBusy = false; }
    }
  };
  await Promise.all(Array.from({ length: jobs }, worker));
  save();
  stop();
  const mine = list.map(r => results[r.id]).filter(Boolean);
  const failed = mine.filter(r => r.verdict === 'FAIL');
  say(`${mine.length - failed.length} of ${list.length} passed${failed.length ? `; failed: ${failed.map(r => r.id).join(', ')}` : ''}. Table: ${join(outRoot, 'results.md')}`);
  return failed.length || mine.length < list.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(await main());
