#!/usr/bin/env node
// Headless GPU harness: opens a page in Playwright's Chromium on the GPU (ANGLE: Metal on a Mac, OpenGL on Linux), runs an optional script,
// takes screenshots, and reports console errors plus frame timing.
//
//   node tools/shot.mjs --url "/?sandbox=gore" --out tools/out/gore.png --wait 4000
//   node tools/shot.mjs --url "/?autoplay=1" --script tools/scripts/foo.mjs --out tools/out/foo.png
//
// Options:
//   --url <path|url>   Path on the dev server, or a full URL (default "/")
//   --port <n>         Dev server port (default 5173, or $OP2_PORT). If nothing answers there, a private
//                      Vite server is started for this run and closed afterwards.
//   --out <file.png>   Screenshot path (default tools/out/shot.png)
//   --wait <ms>        Time to wait after load, before the script and screenshot (default 3000)
//   --w/--h <px>       Viewport size (default 1280x720)
//   --dpr <n>          Device pixel ratio (default 1). Use 2 to test a Retina screen
//   --eval <js>        Evaluate a JS expression in the page after --wait and print the JSON result
//   --script <file>    ES module whose default export is async (page, helpers) => any. It may also export
//                      before(page, { sleep, outDir }): run before the page loads (fake clock, injected scripts;
//                      see tools/scripts/lib/steady.mjs)
//   --shots <n>        Take n screenshots spaced by --every ms (out-1.png, out-2.png, ...)
//   --every <ms>       Spacing for --shots (default 500)
//   --quiet            Only print the final JSON
//   --timeout <s>      Kill the run after this many seconds (default 150)
//
// Runs share a fixed number of browser slots across the whole machine (see SLOTS below), at low priority. Others queue,
// first come first served, and no run starts while the machine is short of memory. tools/proof-cost.mjs measures a run.
//
// The script helpers: { sleep, shot(name), keyDown(k), keyUp(k), press(k, ms), mouseMove(dx, dy),
// click(ms), outDir }.
// Exit code 0 unless the page failed to load. Uncaught errors are listed in the JSON report.
import { chromium } from 'playwright-core';
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync, readFileSync } from 'node:fs';
import { setPriority } from 'node:os';
import { dirname, resolve, basename, extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const argv = process.argv.slice(2);
const opt = {};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith('--')) continue;
  const k = a.slice(2);
  const next = argv[i + 1];
  if (next === undefined || next.startsWith('--')) opt[k] = true;
  else { opt[k] = next; i++; }
}

const port = Number(opt.port ?? process.env.OP2_PORT ?? 5173);
const out = resolve(String(opt.out ?? 'tools/out/shot.png'));
const wait = Number(opt.wait ?? 3000);
const width = Number(opt.w ?? 1280);
const height = Number(opt.h ?? 720);
mkdirSync(dirname(out), { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Browser slots, shared by every checkout and worktree on the machine. Many agents test at once, and each run holds
// two to four game pages: without a limit, 25 runs at once filled 62 GB and the swap. A run waits here for a free slot.
// OP2_SHOT_SLOTS sets the number (default 3 on Linux, 1 elsewhere: the owner's 8 GB Mac). Never bypass it.
//
// Why 3 (measured 2026-11-18 with tools/proof-cost.mjs, docs/notes/coop.md "What a proof costs"). The machine has 32 cores
// and 62 GB and is shared: 8 cores and 16 GB are another person's, and the agents' own compilers, test runs and dev servers
// take about 8 cores and 13 GB. That leaves the proofs 16 cores and 33 GB.
// - Memory: Chrome with one game page holds 1.6 GB (the page's own process 1.2 to 1.3 GB whatever the window size), so a
//   two-page run peaks at 3.0 to 3.4 GB and a four-page run at 6 to 7 GB, and runs grow when they are long (one two-page run
//   reached 11 GB). Three runs are 9 to 21 GB at their peaks, 33 at the worst seen: 3 fits; 4 fits only while runs are short.
// - CPU: a two-page run averages 2.1 to 2.7 cores over its life (a boot is about 30 CPU seconds and there are four), a
//   four-page run about twice that. Three runs are 6 to 16 cores: 3 fits; 4 four-page runs (22 cores) do not.
// The kit's fast mode cuts a run's CPU by a fifth to a quarter and not its memory, so it does not buy another slot.
//
// Two more rules keep that safe and fair:
// - Memory floor: a run does not start while the machine has less than OP2_SHOT_FREE_GB (default 20: the other person's 16
//   and this run's own) of memory available, whatever the slots say. It waits, at most 10 minutes, then goes ahead and says so.
// - First come, first served: waiting runs queue by arrival (a ticket file each), and only the one at the head may take a free
//   slot. Before this a run could wait 12 minutes while later ones went in (the wait was a random poll).
setPriority(0, 19);
const SLOTS = Math.max(1, Number(process.env.OP2_SHOT_SLOTS ?? (process.platform === 'linux' ? 3 : 1)));
const SLOT_DIR = process.env.OP2_SHOT_DIR ?? '/tmp/op2-shot-slots';
const FREE_GB = Number(process.env.OP2_SHOT_FREE_GB ?? 20);
const maxRunMs = Number(opt.timeout ?? 150) * 1000;
let LOCK = '';
const holderAlive = dir => {
  try {
    process.kill(Number(readFileSync(join(dir, 'pid'), 'utf8')), 0);
    return Date.now() - statSync(dir).mtimeMs < Math.max(15 * 60 * 1000, maxRunMs + 60_000);
  } catch {
    return false;
  }
};
/** Memory the machine can still give out, in GB (Linux; elsewhere unknown, so never a reason to wait). */
const availableGb = () => {
  try { return Number(/^MemAvailable:\s+(\d+)/m.exec(readFileSync('/proc/meminfo', 'utf8'))[1]) / 1048576; } catch { return Infinity; }
};
mkdirSync(SLOT_DIR, { recursive: true });
// The queue: a ticket named by arrival time, then pid. Tickets of dead processes are swept by whoever looks.
const QUEUE = join(SLOT_DIR, 'queue');
mkdirSync(QUEUE, { recursive: true });
const TICKET = `${String(Date.now()).padStart(15, '0')}-${process.pid}`;
writeFileSync(join(QUEUE, TICKET), '');
const leaveQueue = () => rmSync(join(QUEUE, TICKET), { force: true });
process.on('exit', leaveQueue);
const atHead = () => {
  for (const name of readdirSync(QUEUE).sort()) {
    if (name === TICKET) return true;
    try { process.kill(Number(name.split('-')[1]), 0); return false; } catch { rmSync(join(QUEUE, name), { force: true }); }
  }
  return true;
};
const queuedAt = Date.now();
for (let told = '', short = false; !LOCK;) {
  let why = `waiting for one of ${SLOTS} browser slots`;
  if (!atHead()) why = `waiting in the queue for one of ${SLOTS} browser slots`;
  else if (availableGb() < FREE_GB && Date.now() - queuedAt < 10 * 60 * 1000) { why = `waiting for memory: ${availableGb().toFixed(1)} GB available, ${FREE_GB} wanted`; short = true; }
  else {
    for (let i = 0; i < SLOTS && !LOCK; i++) {
      const dir = join(SLOT_DIR, `slot-${i}`);
      try {
        mkdirSync(dir);
        writeFileSync(join(dir, 'pid'), String(process.pid));
        LOCK = dir;
      } catch {
        // Taken. A holder that died or overran left it behind: clear it and let the next pass take it.
        try { if (Date.now() - statSync(dir).mtimeMs > 3000 && !holderAlive(dir)) rmSync(dir, { recursive: true, force: true }); } catch { /* gone already */ }
      }
    }
    if (LOCK) break;
  }
  if (told !== why.slice(0, 22)) {
    console.error(`[shot] ${why}`);
    told = why.slice(0, 22);
  }
  // The head of the queue looks often, so a freed slot is not lost to an older copy of this file that polls at random.
  await sleep(atHead() ? 250 : 1000);
  if (short && availableGb() >= FREE_GB) short = false;
}
leaveQueue();
if (Date.now() - queuedAt > 2000) console.error(`[shot] slot after ${Math.round((Date.now() - queuedAt) / 1000)} s`);
if (availableGb() < FREE_GB) console.error(`[shot] starting with only ${availableGb().toFixed(1)} GB of memory available`);
process.on('exit', () => rmSync(LOCK, { recursive: true, force: true }));
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => process.exit(1));

// Use the dev server if one is up. Otherwise run a private Vite for this run only, so tests never
// depend on a long-lived server.
let devServer = null;
let base = `http://127.0.0.1:${port}`;
const absolute = String(opt.url ?? '/').startsWith('http');
if (!absolute) {
  const up = await fetch(`${base}/`, { signal: AbortSignal.timeout(2000) }).then(r => r.ok, () => false);
  if (!up) {
    const { createServer } = await import('vite');
    devServer = await createServer({
      server: { host: '127.0.0.1', port: 5199, strictPort: false, hmr: false },
      logLevel: 'error',
    });
    await devServer.listen();
    base = `http://127.0.0.1:${devServer.httpServer.address().port}`;
  }
}
const url = absolute ? opt.url : `${base}${opt.url ?? '/'}`;

// The GPU: Metal on the Mac. On Linux '--use-angle=metal' means nothing and headless Chromium falls back to SwiftShader
// (software: about 1 frame a second for this game at 1440x900 dpr 2), so ask ANGLE for the machine's own OpenGL driver
// through EGL, which needs no display (60 frames a second on the dev box's RTX 4090). OP2_ANGLE picks another back end:
// 'vulkan' also reaches the card but lost its WebGL context in one run of three; 'swiftshader' is the old software path.
// Other systems keep the Mac's flags exactly.
const angle = process.env.OP2_ANGLE ?? (process.platform === 'linux' ? 'gl-egl' : 'metal');
const gpuArgs = [`--use-angle=${angle}`, ...(angle === 'vulkan' ? ['--enable-features=Vulkan'] : []), '--enable-gpu', '--ignore-gpu-blocklist', '--use-gl=angle'];

const browser = await chromium.launch({
  channel: 'chromium', // Playwright's own Chromium: the real Chrome app run headless hijacks the owner's Chrome (no windows open)
  headless: true,
  args: [
    ...gpuArgs,
    '--autoplay-policy=no-user-gesture-required',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
  ],
});
setTimeout(async () => {
  console.error(`[shot] exceeded ${maxRunMs / 1000}s, closing the browser`);
  await browser.close().catch(() => {});
  process.exit(2);
}, maxRunMs).unref();
// A context of its own rather than browser.newPage(): a script may open more pages in it (tabs of one profile, which the
// co-op kit's loopback transport needs), and browser.newPage()'s private context refuses a second page.
const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: Number(opt.dpr ?? 1) });
const page = await context.newPage();

const logs = [];
const errors = [];
page.on('console', m => {
  const t = m.type();
  const line = `[${t}] ${m.text()}`;
  if (t === 'error') errors.push(line);
  else if (t === 'warning' || t === 'log' || t === 'info') logs.push(line);
});
page.on('pageerror', e => errors.push(`[pageerror] ${e.message}\n${(e.stack ?? '').split('\n').slice(0, 6).join('\n')}`));
page.on('requestfailed', r => errors.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText ?? ''}`));

const report = { url, screenshots: [], errors, logs: [] };
const script = opt.script ? await import(pathToFileURL(resolve(String(opt.script))).href) : null;
if (script?.before) {
  try {
    await script.before(page, { sleep, outDir: dirname(out) });
  } catch (e) {
    errors.push(`[script before] ${e.stack ?? e}`);
  }
}
let loaded = true;
try {
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
} catch (e) {
  loaded = false;
  errors.push(`[goto] ${e.message}`);
}

if (loaded) {
  await sleep(wait);
  const shot = async name => {
    const file = name
      ? join(dirname(out), `${basename(out, extname(out))}-${name}.png`)
      : out;
    await page.screenshot({ path: file });
    report.screenshots.push(file);
    return file;
  };
  const helpers = {
    sleep,
    shot,
    outDir: dirname(out),
    keyDown: k => page.keyboard.down(k),
    keyUp: k => page.keyboard.up(k),
    press: async (k, ms = 80) => { await page.keyboard.down(k); await sleep(ms); await page.keyboard.up(k); },
    mouseMove: (dx, dy) => page.evaluate(([x, y]) => {
      document.dispatchEvent(new MouseEvent('mousemove', { movementX: x, movementY: y, bubbles: true }));
    }, [dx, dy]),
    click: async (ms = 60) => { await page.mouse.down(); await sleep(ms); await page.mouse.up(); },
  };

  if (script) {
    try {
      report.scriptResult = await script.default(page, helpers);
    } catch (e) {
      errors.push(`[script] ${e.stack ?? e}`);
    }
  }
  if (opt.eval) {
    report.eval = await page.evaluate(String(opt.eval));
  }
  // A screenshot that times out must not take the process down: the browser below would be left running with nobody to close it.
  try {
    if (opt.shots) {
      const n = Number(opt.shots);
      const every = Number(opt.every ?? 500);
      for (let i = 1; i <= n; i++) {
        await shot(String(i));
        if (i < n) await sleep(every);
      }
    } else if (!opt.script || opt.out) {
      await shot();
    }
  } catch (e) {
    errors.push(`[shot] ${e.message}`);
  }

  report.stats = await page.evaluate(() => {
    const g = window.__op2;
    return g?.stats ? g.stats() : null;
  }).catch(() => null);
}

report.logs = logs.slice(-40);
await browser.close();
await devServer?.close();
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
