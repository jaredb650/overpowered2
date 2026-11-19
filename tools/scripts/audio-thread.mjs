// What the browser's audio thread costs, and whose cost it is: the test browser's or the game's. Linux only (reads /proc).
//
//   node tools/shot.mjs --port <yours> --url "/?contract=crucible&autostart=1" --wait 0 --timeout 240 \
//     --script tools/scripts/audio-thread.mjs --out tools/out/<you>/audio-thread.png
//
// It measures the CPU of every Chrome thread (by name) over a few seconds in each of these, in one browser:
//   1. an empty page with no AudioContext
//   2. the same page with an AudioContext running and nothing connected
//   3. the same with one silent source playing
//   4. the game standing in a Crucible break (music off)      5. the game in a fight      6. the game with its context suspended
// and, for the game, Chrome's own figure for how much of each render quantum the graph uses (`AudioContext.renderCapacity`:
// 1.0 means the graph needs all the time there is). A thread that is busy with nothing connected is the browser's doing (the
// test harness runs Chrome with --mute-audio, so the output is a fake device); a graph load near zero means a real player's
// audio thread has almost nothing to do.
import { readFileSync, readdirSync } from 'node:fs';
import { SCENARIOS } from './lib/solo-scenarios.mjs';

const read = path => { try { return readFileSync(path, 'utf8'); } catch { return ''; } };

/** CPU seconds so far of every thread of every Chrome process under this node process, keyed "type/thread name". */
function threads() {
  const parent = new Map();
  for (const name of readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    const text = read(`/proc/${name}/stat`);
    const close = text.lastIndexOf(')');
    if (close >= 0) parent.set(Number(name), Number(text.slice(close + 2).split(' ')[1]));
  }
  const mine = pid => { for (let p = pid, n = 0; p > 1 && n < 64; p = parent.get(p) ?? 0, n++) if (p === process.pid) return true; return false; };
  const out = new Map();
  for (const pid of parent.keys()) {
    if (pid === process.pid || !mine(pid)) continue;
    const cmd = read(`/proc/${pid}/cmdline`).split(/[\0 ]/);
    if (!/chrom|headless_shell/i.test(cmd[0] ?? '')) continue;
    const type = cmd.find(a => a.startsWith('--type='))?.slice(7) ?? 'browser';
    let tids = [];
    try { tids = readdirSync(`/proc/${pid}/task`); } catch { /* gone */ }
    for (const tid of tids) {
      const text = read(`/proc/${pid}/task/${tid}/stat`);
      const open = text.indexOf('('), close = text.lastIndexOf(')');
      if (close < 0) continue;
      const rest = text.slice(close + 2).split(' ');
      const key = `${type}/${text.slice(open + 1, close)}`;
      out.set(key, (out.get(key) ?? 0) + (Number(rest[11]) + Number(rest[12])) / 100);
    }
  }
  return out;
}

/** Cores used by each thread over `ms`, the audio ones and the busiest others. */
async function measure(ms, sleep) {
  const a = threads();
  const started = Date.now();
  await sleep(ms);
  const b = threads(), seconds = (Date.now() - started) / 1000;
  const rows = [];
  for (const [key, cpu] of b) { const used = (cpu - (a.get(key) ?? 0)) / seconds; if (used > 0.005) rows.push([key, Math.round(used * 1000) / 1000]); }
  rows.sort((x, y) => y[1] - x[1]);
  const audio = rows.filter(([key]) => /audio/i.test(key));
  return { audioThreads: Object.fromEntries(audio), audioCores: Math.round(audio.reduce((s, r) => s + r[1], 0) * 1000) / 1000, busiest: Object.fromEntries(rows.slice(0, 5)) };
}

/** Chrome's own account of the graph's load on the page's context `window.__ac`, over `ms`. */
const capacity = (page, ms) => page.evaluate(ms => new Promise(done => {
  const ac = window.__ac, rc = ac?.renderCapacity;
  if (!rc) return done({ supported: false, state: ac?.state ?? null });
  const seen = [];
  rc.onupdate = e => seen.push([e.averageLoad, e.peakLoad, e.underrunRatio]);
  rc.start({ updateInterval: 1 });
  setTimeout(() => {
    rc.stop();
    const r = v => Math.round(v * 10000) / 10000;
    done({ supported: true, state: ac.state, sampleRate: ac.sampleRate, baseLatency: r(ac.baseLatency ?? 0), updates: seen.length,
      averageLoad: r(seen.reduce((s, v) => s + v[0], 0) / Math.max(1, seen.length)), peakLoad: r(Math.max(0, ...seen.map(v => v[1]))), underrunRatio: r(Math.max(0, ...seen.map(v => v[2]))) });
  }, ms);
}), ms);

export default async function (page, { sleep }) {
  const game = page.url();
  const out = {};
  await page.goto('about:blank');
  out['1 empty page, no AudioContext'] = await measure(5000, sleep);
  await page.evaluate(() => { window.__ac = new AudioContext({ latencyHint: 'interactive' }); return window.__ac.resume(); });
  out['2 empty page, AudioContext running, nothing connected'] = { ...(await measure(5000, sleep)), graph: await capacity(page, 3000) };
  await page.evaluate(() => { const ac = window.__ac, o = ac.createOscillator(), g = ac.createGain(); g.gain.value = 0; o.connect(g).connect(ac.destination); o.start(); });
  out['3 empty page, one silent source playing'] = { ...(await measure(5000, sleep)), graph: await capacity(page, 3000) };

  await page.addInitScript(() => { try { localStorage.setItem('op2.played.v1', '1'); localStorage.setItem('op2.settings.v1', JSON.stringify({ music: 0 })); } catch { /* storage off */ } });
  await page.goto(game, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__op2?.game?.state === 'playing', null, { timeout: 150000 });
  const found = await page.evaluate(() => {
    const { ctx } = window.__op2;
    ctx.waves.nextWaveIn = 1e9;
    const seen = new Set();
    const find = (o, depth) => {
      if (!o || typeof o !== 'object' || seen.has(o) || depth > 3) return null;
      seen.add(o);
      if (o instanceof AudioContext) return o;
      for (const k of Object.keys(o)) { let v; try { v = o[k]; } catch { continue; } const hit = find(v, depth + 1); if (hit) return hit; }
      return null;
    };
    window.__ac = find(ctx.audio, 0);
    return { found: !!window.__ac, state: window.__ac?.state };
  });
  out.gameContext = found;
  await sleep(4000);
  const line = () => page.evaluate(() => window.__op2.stats().audio ?? window.__op2.ctx.audio.stats?.() ?? null).catch(() => null);
  out['4 game, standing in a break'] = { ...(await measure(6000, sleep)), graph: await capacity(page, 4000), game: await line() };
  await page.evaluate(source => {
    const { ctx, game } = window.__op2, bot = (0, eval)(`(${source})`), memo = {};
    ctx.waves.nextWaveIn = 0.5;
    let n = 0;
    const tick = () => { if (window.__stopBot) return; requestAnimationFrame(tick); try { bot(ctx, game, n++, memo); } catch { /* go on */ } };
    tick();
  }, String(SCENARIOS.crucible.bot));
  await sleep(6000);
  out['5 game, in a fight'] = { ...(await measure(8000, sleep)), graph: await capacity(page, 5000), game: await line() };
  await page.evaluate(() => { window.__stopBot = true; return window.__ac.suspend(); });
  await sleep(500);
  out['6 game, context suspended'] = await measure(4000, sleep);
  return out;
}
