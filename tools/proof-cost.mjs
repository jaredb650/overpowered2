#!/usr/bin/env node
// What a browser proof costs the machine: runs a command (a shot.mjs run) and samples every process under it once a second.
//
//   node tools/proof-cost.mjs [--json out.json] [--label name] -- node tools/shot.mjs --port 5430 --script tools/scripts/coop-smoke.mjs ...
//
// Prints one JSON line on stderr at the end (and writes it to --json):
//   wallSeconds        the whole run, the wait for a browser slot included
//   waitSeconds        of that, the time before the first Chrome process existed (the slot queue, a private Vite starting)
//   peakMb             the most memory all Chrome processes held at once (PSS: shared pages counted once)
//   peakByType         the same at that moment, by Chrome process type (browser, gpu-process, renderer, utility, zygote)
//   renderers          how many renderer processes there were at the peak
//   cpuSeconds         user + system time of every Chrome process over the run; cpuByType splits it
//   cpuByThread        the same CPU by process type and thread name, the top twelve (CrRendererMain is a page's own
//                      thread: the game loop, style and layout; DedicatedWorker a web worker; VizCompositor, CrGpuMain the GPU side)
//   nodeCpuSeconds     the harness's own (shot.mjs and a private Vite)
//   load               the machine's 1-minute load at the start and the end (a number far above the core count means the
//                      timings prove nothing: measure again)
// Linux only (it reads /proc). The command's own output passes through untouched.
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';

const argv = process.argv.slice(2);
const cut = argv.indexOf('--');
if (cut < 0 || cut === argv.length - 1) {
  console.error('usage: node tools/proof-cost.mjs [--json file] [--label name] -- <command> [args...]');
  process.exit(64);
}
const own = argv.slice(0, cut), command = argv.slice(cut + 1);
const flag = name => { const i = own.indexOf(`--${name}`); return i < 0 ? undefined : own[i + 1]; };

const TICK = 100; // clock ticks a second in /proc/<pid>/stat on Linux
const read = path => { try { return readFileSync(path, 'utf8'); } catch { return ''; } };

/** Every process under `root`: { pid, type ('node' or Chrome's --type, 'browser' for the main one), cpu seconds, pss kB }. */
function tree(root) {
  const parent = new Map(), stat = new Map();
  for (const name of readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    const text = read(`/proc/${name}/stat`);
    const close = text.lastIndexOf(')');
    if (close < 0) continue;
    const rest = text.slice(close + 2).split(' ');
    parent.set(Number(name), Number(rest[1]));
    stat.set(Number(name), (Number(rest[11]) + Number(rest[12])) / TICK);
  }
  const out = [];
  const under = pid => { for (let p = pid, n = 0; p > 1 && n < 64; p = parent.get(p) ?? 0, n++) if (p === root) return true; return false; };
  for (const pid of parent.keys()) {
    if (pid === root || !under(pid)) continue;
    const cmd = read(`/proc/${pid}/cmdline`).split(/[\0 ]/); // Chrome's children rewrite theirs with spaces
    const chrome = /chrom|headless_shell/i.test(cmd[0] ?? '');
    const type = chrome ? (cmd.find(a => a.startsWith('--type='))?.slice(7) ?? 'browser') : 'node';
    out.push({ pid, type, chrome, cpu: stat.get(pid) ?? 0, pss: chrome ? Number(/^Pss:\s+(\d+)/m.exec(read(`/proc/${pid}/smaps_rollup`))?.[1] ?? 0) : 0 });
  }
  return out;
}

const started = Date.now();
const loadStart = loadavg()[0];
const child = spawn(command[0], command.slice(1), { stdio: 'inherit' });
const cpu = new Map(); // pid -> { type, cpu }: kept after the process has gone
const threads = new Map(); // tid -> { key: 'type/thread name', cpu }
let peak = 0, peakByType = {}, renderers = 0, firstChrome = 0, samples = 0;
/** CPU seconds of each thread of a Chrome process, by name (numbers in pool names dropped). */
function threadCpu(p) {
  let tids = [];
  try { tids = readdirSync(`/proc/${p.pid}/task`); } catch { return; }
  for (const tid of tids) {
    const text = read(`/proc/${p.pid}/task/${tid}/stat`);
    const open = text.indexOf('('), close = text.lastIndexOf(')');
    if (close < 0) continue;
    const rest = text.slice(close + 2).split(' ');
    const seen = threads.get(tid);
    threads.set(tid, { key: seen?.key ?? `${p.type}/${text.slice(open + 1, close).replace(/[\d/:]+$/, '')}`, cpu: Math.max(seen?.cpu ?? 0, (Number(rest[11]) + Number(rest[12])) / TICK) });
  }
}
const sample = () => {
  let total = 0; const byType = {}; let r = 0;
  for (const p of tree(child.pid)) {
    // A process on its way out has an empty command line: keep the type it had.
    const seen = cpu.get(p.pid);
    if (seen && seen.type !== 'node' && p.type === 'node') p.type = seen.type;
    cpu.set(p.pid, { type: p.type, cpu: Math.max(p.cpu, seen?.cpu ?? 0) });
    if (p.type === 'node') continue;
    if (p.chrome) threadCpu(p);
    firstChrome ||= Date.now();
    total += p.pss;
    byType[p.type] = (byType[p.type] ?? 0) + p.pss;
    if (p.type === 'renderer') r++;
  }
  samples++;
  if (total > peak) { peak = total; peakByType = byType; renderers = r; }
};
const timer = setInterval(sample, 1000);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => child.kill(sig));
child.on('exit', (code, signal) => {
  clearInterval(timer);
  const mb = kb => Math.round(kb / 1024);
  const cpuByType = {};
  for (const { type, cpu: seconds } of cpu.values()) cpuByType[type] = Math.round(10 * ((cpuByType[type] ?? 0) + seconds)) / 10;
  const byThread = {};
  for (const { key, cpu: seconds } of threads.values()) byThread[key] = (byThread[key] ?? 0) + seconds;
  const cpuByThread = Object.fromEntries(Object.entries(byThread).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => [k, Math.round(v * 10) / 10]));
  const chromeCpu = Object.entries(cpuByType).filter(([type]) => type !== 'node').reduce((a, [, s]) => a + s, 0);
  const report = {
    label: flag('label') ?? '', exit: code ?? signal,
    wallSeconds: Math.round((Date.now() - started) / 100) / 10,
    waitSeconds: Math.round(((firstChrome || Date.now()) - started) / 100) / 10,
    peakMb: mb(peak), peakByType: Object.fromEntries(Object.entries(peakByType).map(([k, v]) => [k, mb(v)])), renderers,
    cpuSeconds: Math.round(chromeCpu * 10) / 10, cpuByType, cpuByThread, nodeCpuSeconds: cpuByType.node ?? 0,
    load: [Math.round(loadStart), Math.round(loadavg()[0])], samples,
  };
  delete report.cpuByType.node;
  if (flag('json')) writeFileSync(flag('json'), JSON.stringify(report, null, 2) + '\n');
  console.error(`[proof-cost] ${JSON.stringify(report)}`);
  process.exit(typeof code === 'number' ? code : 1);
});
