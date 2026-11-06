#!/usr/bin/env node
// Headless GPU harness: opens a page in real Chrome (ANGLE/Metal), runs an optional script,
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
//   --script <file>    ES module whose default export is async (page, helpers) => any
//   --shots <n>        Take n screenshots spaced by --every ms (out-1.png, out-2.png, ...)
//   --every <ms>       Spacing for --shots (default 500)
//   --quiet            Only print the final JSON
//   --timeout <s>      Kill the run after this many seconds (default 150)
//
// Only one browser runs at a time, at low priority, capped at 60 Hz. Other runs queue for the slot.
//
// The script helpers: { sleep, shot(name), keyDown(k), keyUp(k), press(k, ms), mouseMove(dx, dy),
// click(ms), outDir }.
// Exit code 0 unless the page failed to load. Uncaught errors are listed in the JSON report.
import { chromium } from 'playwright-core';
import { mkdirSync, rmSync, statSync, writeFileSync, readFileSync } from 'node:fs';
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

// This machine has 8 GB and is someone's working computer. Run at the lowest priority (Chrome inherits it),
// allow one browser at a time, and never let a run hold the slot forever.
setPriority(0, 19);
const LOCK = resolve('tools/out/.browser-lock');
const maxRunMs = Number(opt.timeout ?? 150) * 1000;
const lockHolderAlive = () => {
  try {
    process.kill(Number(readFileSync(join(LOCK, 'pid'), 'utf8')), 0);
    return Date.now() - statSync(LOCK).mtimeMs < 15 * 60 * 1000;
  } catch {
    return false;
  }
};
mkdirSync(dirname(LOCK), { recursive: true });
for (let told = false; ;) {
  try {
    mkdirSync(LOCK);
    writeFileSync(join(LOCK, 'pid'), String(process.pid));
    break;
  } catch {
    if (!lockHolderAlive()) {
      rmSync(LOCK, { recursive: true, force: true });
      continue;
    }
    if (!told) {
      console.error('[shot] waiting for the browser slot');
      told = true;
    }
    await sleep(1000);
  }
}
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

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: [
    '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--use-gl=angle',
    '--autoplay-policy=no-user-gesture-required',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
  ],
});
setTimeout(async () => {
  console.error(`[shot] exceeded ${maxRunMs / 1000}s, closing the browser`);
  await browser.close().catch(() => {});
  process.exit(2);
}, maxRunMs).unref();
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: Number(opt.dpr ?? 1) });

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

  if (opt.script) {
    const mod = await import(pathToFileURL(resolve(String(opt.script))).href);
    try {
      report.scriptResult = await mod.default(page, helpers);
    } catch (e) {
      errors.push(`[script] ${e.stack ?? e}`);
    }
  }
  if (opt.eval) {
    report.eval = await page.evaluate(String(opt.eval));
  }
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

  report.stats = await page.evaluate(() => {
    const g = window.__op2;
    return g?.stats ? g.stats() : null;
  }).catch(() => null);
}

report.logs = logs.slice(-40);
await browser.close();
await devServer?.close();
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
