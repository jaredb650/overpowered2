// Frozen time and fixed randomness, so one script gives the same picture every run. For look-checks of single-player pages.
//
// In any tools/shot.mjs script:
//
//   import * as steady from './lib/steady.mjs';
//   export const before = page => steady.install(page, { seed: 1 });   // runs before the page loads
//   export default async (page, h0) => {
//     const h = steady.helpers(page, h0);     // h.sleep / h.press / h.click now move the frozen clock
//     await steady.ready(page);               // steps the page through its loading until window.__op2 exists
//     await steady.frames(page, 120);         // exactly 120 frames of 16 ms
//     await h.shot();
//   };
//
// Or with no script of your own:  node tools/shot.mjs --port <yours> --url "/?sandbox=gore" --wait 0 \
//   --script tools/scripts/steady-shot.mjs --out tools/out/<you>/a.png     (see that file for its STEADY_* settings)
//
// How it works: Playwright's Clock replaces the page's Date, performance.now, timers and requestAnimationFrame with a clock that
// only moves when told. It is paused before the page loads; every step is one 16 ms frame (62.5 a second: the fake
// requestAnimationFrame fires on 16 ms marks). Math.random is replaced by a seeded generator before any page code runs.
//
// What it does NOT freeze: sound, WebRTC, web workers (their own clock and Math.random), crypto.getRandomValues, and CSS
// animations and transitions in the DOM (HUD and menus fade in real time: pass { animations: 'disabled' } to page.screenshot
// for those). So: single-player look-checks, not co-op. A script that waits with its own setTimeout or page.waitForTimeout
// waits in real time while the page stands still: use the helpers' sleep instead.

/** The fake requestAnimationFrame fires on 16 ms marks, so a frame is 16 ms. */
export const FRAME_MS = 16;

/** A small seeded generator (mulberry32). Same seed, same numbers. Also injected into the page as Math.random. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const wait = ms => new Promise(r => setTimeout(r, ms));
const state = new WeakMap();

/**
 * Freezes the clock and seeds Math.random. Call it from a script's `before` export (before the page loads). Called later, it
 * loads the page again so the page starts frozen.
 */
export async function install(page, { seed = 1, time = '2026-01-01T12:00:00Z' } = {}) {
  await page.addInitScript(`Math.random = (${mulberry32})(${Number(seed)});`);
  await page.clock.install({ time });
  await page.clock.pauseAt(time);
  // Requests in flight: a step is only taken while none is, so a file that arrives late lands on the same frame every run.
  const s = { inflight: 0, frames: 0 };
  state.set(page, s);
  page.on('request', () => { s.inflight++; });
  const done = () => { s.inflight = Math.max(0, s.inflight - 1); };
  page.on('requestfinished', done);
  page.on('requestfailed', done);
  if (page.url() !== 'about:blank') await page.goto(page.url(), { waitUntil: 'load', timeout: 60000 });
}

/** Waits (real time) until no request has been in flight for `grace` ms. */
async function quiet(page, grace) {
  const s = state.get(page);
  if (!s) throw new Error('steady: call install(page) first');
  for (const end = Date.now() + 30000; Date.now() < end;) {
    if (s.inflight > 0) { await wait(10); continue; }
    if (grace <= 0) return;
    await wait(grace);
    if (s.inflight === 0) return;
  }
}

const step = (page, ms) => page.evaluate(t => globalThis.__pwClock.controller.runFor(t), ms);

/** Milliseconds of frozen time until the page's next timer or frame is due; a large number when it waits on none. */
const nextTimer = page => page.evaluate(() => {
  const c = globalThis.__pwClock?.controller;
  if (!c) return 1e9;
  if (!c._timers || !c._now) return c.countTimers() ? 0 : 1e9; // another Playwright: no look inside, step whenever any timer exists
  let soon = 1e9;
  for (const t of c._timers.values()) soon = Math.min(soon, t.callAt - c._now.ticks);
  return soon;
}).catch(() => 1e9);

/**
 * Steps the frozen page through its loading until `until` (a JS expression) is true. Between steps it lets real work finish
 * (downloads, plus `grace` ms for decoding and compiling), and it steps only when the page is waiting on a timer or frame due
 * within one frame: a far-off timer (a 5 s flush, a 30 s ping) must not move time while real work is still going.
 *
 * Loading still takes a different number of steps each run (three.js polls its shader compiles every 10 ms of page time, and
 * how long a compile takes is real time), so once ready the clock jumps to the next `mark` (a multiple of 8 s of page time):
 * every run then starts from the same clock reading. That jump fires each waiting timer once, like one long frame.
 * Returns the number of steps loading took.
 */
export async function ready(page, { until = '!!window.__op2', timeout = 90000, grace = 60, mark = 8000 } = {}) {
  const start = Date.now();
  let frames = 0;
  for (;;) {
    await quiet(page, grace);
    if (await page.evaluate(until).catch(() => false)) break;
    if (Date.now() - start > timeout) throw new Error(`steady: the page was not ready after ${timeout} ms (waiting for: ${until})`);
    if (await nextTimer(page) <= FRAME_MS) { await step(page, FRAME_MS); state.get(page).frames++; frames++; } else await wait(20);
  }
  if (mark > 0) {
    await page.evaluate(m => {
      const c = globalThis.__pwClock.controller;
      const now = performance.now();
      return c.fastForward((Math.floor(now / m) + 1) * m - now);
    }, mark);
  }
  return frames;
}

/** Advances exactly `n` frames of 16 ms. `grace` (real ms) is given before each frame for work that is not a download. */
export async function frames(page, n, { grace = 0 } = {}) {
  const s = state.get(page);
  for (let i = 0; i < n; i++) {
    await quiet(page, grace);
    await step(page, FRAME_MS);
    s.frames++;
  }
}

/** Advances at least `ms` of frozen time, in whole frames. Returns the time actually advanced. */
export async function advance(page, ms) {
  const n = Math.ceil(ms / FRAME_MS - 1e-9);
  await frames(page, n);
  return n * FRAME_MS;
}

/** Frames stepped on this page so far (loading included). */
export const stepped = page => state.get(page)?.frames ?? 0;

/** shot.mjs helpers whose waits move the frozen clock instead of the real one, so existing scripts run unchanged. */
export function helpers(page, h) {
  const sleep = ms => advance(page, ms);
  return {
    ...h,
    sleep,
    press: async (k, ms = 80) => { await page.keyboard.down(k); await sleep(ms); await page.keyboard.up(k); },
    click: async (ms = 60) => { await page.mouse.down(); await sleep(ms); await page.mouse.up(); },
  };
}
