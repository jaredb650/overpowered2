#!/usr/bin/env node
// Runs coop-motion-measure.mjs over the whole table: 20 and 48 enemies, the host uncapped and at 20 fps, a clean network
// and two bad ones. One run at a time, each through tools/shot.mjs (so it waits its turn for a browser like every other
// proof). Give two ports and each case is run on both, one after the other: the old code and the new, which is how the
// table in docs/notes/coop.md was made.
//
//   node tools/scripts/coop-motion-matrix.mjs --ports 5320 --tags after --out tools/out/coop/enemy-motion
//   node tools/scripts/coop-motion-matrix.mjs --ports 5321,5320 --tags baseline,after --out <dir> [--only 48e-20fps] [--seconds 20]
//
// Each port must already serve the game (OP2_NO_HMR=1 npx vite --port <n> --strictPort). Writes one JSON per run,
// motion-results.json, and motion-table-<tag>.md per tag, and prints the tables.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(`--${name}`); return i < 0 ? undefined : args[i + 1]; };
const ports = String(opt('ports') ?? '5320').split(',').map(Number);
const tags = String(opt('tags') ?? 'after').split(',');
const outDir = resolve(opt('out') ?? 'tools/out/coop/enemy-motion');
const seconds = Number(opt('seconds') ?? 20);
const only = opt('only');
mkdirSync(outDir, { recursive: true });

const NETS = ['', 'lag:80,jitter:30,loss:0.03', 'lag:150,jitter:60,loss:0.08'];
const cases = [];
for (const enemies of [20, 48]) for (const hostFps of [0, 20]) for (const net of NETS) cases.push({ enemies, hostFps, net });
const label = c => `${c.enemies}e-${c.hostFps || 60}fps-${c.net ? c.net.replace(/[^a-z0-9.]+/gi, '_') : 'clean'}`;

function run(port, tag, c) {
  const env = { ...process.env, MOTION_ENEMIES: String(c.enemies), MOTION_NET: c.net, MOTION_HOST_FPS: String(c.hostFps), MOTION_SECONDS: String(seconds), MOTION_TAG: tag };
  spawnSync(process.execPath, ['tools/shot.mjs', '--port', String(port), '--w', '1280', '--h', '720', '--wait', '500', '--timeout', '300', '--quiet',
    '--script', 'tools/scripts/coop-motion-measure.mjs', '--out', `${outDir}/measure.png`], { env, stdio: ['ignore', 'ignore', 'inherit'] });
  try { return JSON.parse(readFileSync(`${outDir}/motion-${tag}-${label(c)}.json`, 'utf8')).result ?? null; } catch { return null; }
}

/**
 * A run only counts if the pages really ran: now and then a guest's window is drawn at a frame or two a second (a headless
 * browser quirk, worse on a busy machine), and a busy machine can starve an uncapped host. Such a run is done again, three
 * times at most, and the best one kept.
 */
const sound = (r, c) => !!r && r.guestFps >= 45 && r.hostFps >= (c.hostFps ? c.hostFps * 0.8 : 45);
function steady(port, tag, c) {
  let best = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = run(port, tag, c);
    if (r && (!best || r.guestFps + r.hostFps > best.guestFps + best.hostFps)) best = r;
    if (sound(r, c)) break;
    console.error(`[matrix] ${tag} ${label(c)}: try ${attempt} ran at guest ${r?.guestFps ?? '?'} / host ${r?.hostFps ?? '?'} fps${attempt < 3 ? ', again' : ''}`);
  }
  return best;
}

const results = tags.map(() => []);
for (const c of cases) {
  if (only && !label(c).includes(only)) continue;
  console.error(`[matrix] ${label(c)}`);
  ports.forEach((port, i) => results[i].push({ c, result: steady(port, tags[i] ?? `p${port}`, c) }));
  writeFileSync(`${outDir}/motion-results${only ? `-${only}` : ''}.json`, JSON.stringify(Object.fromEntries(tags.map((tag, i) => [tag, results[i]])), null, 1));
}

const cm = v => (Number.isFinite(v) ? (v * 100).toFixed(1) : '-');
function table(rows) {
  const lines = ['| Enemies | Host fps (measured; guest) | Network | Drawn behind, ms | Error p50 / p95 / max, cm | Yaw error p50 / p95, deg | Stalled frames | Stalls a minute (crowd / per enemy) | Step p95 / max, cm | Snapshot B/s | All lanes B/s |',
    '|---:|---|---|---:|---|---|---:|---|---|---:|---:|'];
  for (const { c, result: r } of rows) {
    if (!r) { lines.push(`| ${c.enemies} | ${c.hostFps || 'uncapped'} | ${c.net || 'clean'} | failed | | | | | | | |`); continue; }
    const e = r.declared?.error ?? r.error, y = r.declared?.yaw ?? r.yaw;
    const behind = r.declared ? `${Math.round(r.declared.behindMs.p50)} (p95 ${Math.round(r.declared.behindMs.p95)})` : `${r.delay}`;
    lines.push(`| ${c.enemies} | ${c.hostFps || 'uncapped'} (${r.hostFps}, guest ${r.guestFps}) | ${c.net || 'clean'} | ${behind} | ${cm(e.p50)} / ${cm(e.p95)} / ${cm(e.max)} | ${y.p50.toFixed(1)} / ${y.p95.toFixed(1)} | ${r.stalls.frames} (${r.stalls.percent}%) | ${r.stalls.perMinute} / ${r.stalls.perEnemyMinute} | ${cm(r.step.p95)} / ${cm(r.step.max)} | ${r.bytes.snapshotsPerSecond} | ${r.bytes.hostAllLanesPerSecond} |`);
  }
  return lines.join('\n');
}
tags.forEach((tag, i) => {
  const text = table(results[i]);
  writeFileSync(`${outDir}/motion-table-${tag}${only ? `-${only}` : ''}.md`, `${text}\n`);
  console.log(`\n## ${tag}\n\n${text}`);
});
