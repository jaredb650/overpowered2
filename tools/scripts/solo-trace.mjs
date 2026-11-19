// One scripted single-player run, recorded frame by frame, for comparing two builds of the game (tools/solo-compare.mjs).
// Frozen clock, randomness seeded per calling function, a bot in the page. docs/notes/devtools.md, "Comparing two builds".
//
//   SOLO_SCENARIO=crucible SOLO_LABEL=tip node tools/shot.mjs --port <yours> --url "/" --wait 0 --timeout 900 \
//     --script tools/scripts/solo-trace.mjs --out tools/out/<you>/solo.png
//
// The page it opens is the scenario's own (--url is ignored). Run it once against each build's dev server (the old build is a
// second worktree with its own Vite), then: node tools/solo-compare.mjs <a>.trace.json <b>.trace.json
//
// Settings (environment):
//   SOLO_SCENARIO  a name from tools/scripts/lib/solo-scenarios.mjs (default crucible), or several with commas: they are played
//                  one after another in the one browser, each from a clean browser storage, and each writes its own trace
//   SOLO_LABEL     goes into the file name: <outDir>/<scenario>.<label>.trace.json (default "run")
//   SOLO_FRAMES    frames of 16 ms to play (default: the scenario's)
//   SOLO_SEED      seed (default 1)
//   SOLO_SHOTS     a screenshot every this many frames (default 0: only the last frame)
//   SOLO_QUERY     switches added to the scenario's address, e.g. "gibthrow=0&messrest=0" (default none)
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as steady from './lib/steady.mjs';
import { keyedRandom, recorder } from './lib/solotrace.mjs';
import { SCENARIOS } from './lib/solo-scenarios.mjs';
import { fakeLock } from './coop-kit.mjs';

const names = (process.env.SOLO_SCENARIO ?? 'crucible').split(',').map(n => n.trim()).filter(Boolean);
const seed = Number(process.env.SOLO_SEED ?? 1);
const flying = { n: 0 };
const wait = ms => new Promise(r => setTimeout(r, ms));
const withQuery = url => (process.env.SOLO_QUERY ? `${url}${url.includes('?') ? '&' : '?'}${process.env.SOLO_QUERY}` : url);

export async function before(page) {
  for (const name of names) if (!SCENARIOS[name]) throw new Error(`solo-trace: no scenario "${name}". Known: ${Object.keys(SCENARIOS).join(', ')}`);
  await steady.install(page, { seed });
  // After steady's own seeded Math.random, so this one wins: a stream per calling function.
  await page.addInitScript(`(${keyedRandom})(${seed});`);
  // A pointer lock is granted by the browser in its own time, and a menu's Resume waits for it: the kit's pretend lock is
  // granted on the page's (frozen) timers instead, so a resume lands on the same frame every run.
  await page.addInitScript(fakeLock);
  // The page shot.mjs loads first, before any scenario: a returning player with the music off.
  await page.addInitScript(() => {
    if (sessionStorage.getItem('solo.set')) return;
    sessionStorage.setItem('solo.set', '1');
    localStorage.clear();
    localStorage.setItem('op2.settings.v1', JSON.stringify({ music: 0 }));
    localStorage.setItem('op2.played.v1', '1');
  });
  // Recorded voices play through real <audio> elements, in real time, and a page of the Commander's words stays up until
  // its recording ends: on a frozen clock that end falls on a different frame every run (measured: 250 frames apart). So the
  // recordings are not served, and every line is text, timed by the game's own reading clock. SOLO_VOICES=1 serves them.
  if (process.env.SOLO_VOICES !== '1') await page.route(/\/audio\/(voice|chatter)\//, route => route.abort());
  page.on('request', () => { flying.n++; });
  const done = () => { flying.n = Math.max(0, flying.n - 1); };
  page.on('requestfinished', done);
  page.on('requestfailed', done);
}

/** A frame is only stepped while no download is in flight, so a late file lands on the same frame every run. */
async function quiet() {
  for (const end = Date.now() + 30000; flying.n > 0 && Date.now() < end;) await wait(5);
}

/** One scenario, start to finish, on a browser whose storage is set as that scenario wants it. Returns its summary line. */
async function play(page, name, outDir) {
  const scenario = SCENARIOS[name];
  const label = process.env.SOLO_LABEL ?? 'run';
  const origin = new URL(page.url()).origin;
  // A page of the same address with no game on it, to set the browser's storage from: the game writes there as it leaves.
  await page.goto(`${origin}/package.json`, { waitUntil: 'load', timeout: 60000 });
  await page.evaluate(([settings, fresh]) => {
    localStorage.clear();
    sessionStorage.clear();
    sessionStorage.setItem('solo.set', '1');
    if (settings) localStorage.setItem('op2.settings.v1', JSON.stringify(settings));
    // A first launch has nothing at all: saved settings count as having played (contracts/firstLaunch.ts).
    if (!fresh) localStorage.setItem('op2.played.v1', '1');
  }, [scenario.firstLaunch ? null : scenario.settings ?? { music: 0 }, !!scenario.firstLaunch]);
  flying.n = 0;
  await page.goto(origin + withQuery(scenario.url), { waitUntil: 'load', timeout: 60000 });
  // Before the game makes its first body: every body handed out from the start of a run on gets its idle phase from its
  // archetype and its turn (the first trooper, the second...), not from Math.random at the time it was built. Which bodies
  // sit in the pool differs between builds and between loads (the warm-up borrows some), and a body's phase moves its limbs,
  // so a round that grazed an arm on one build missed it on the other before the trace had begun.
  await steady.ready(page, { until: '!!window.__op2?.ctx?.characters && !!window.__op2?.ctx?.events', timeout: 150000 });
  await page.evaluate(seed => {
    const { ctx } = window.__op2, lib = ctx.characters, real = lib.spawn.bind(lib);
    const turns = new Map();
    let armed = false;
    const roll = (id, turn, which) => {
      let h = 2166136261 ^ seed;
      for (const ch of `${id}#${turn}#${which}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
      h = Math.imul(h ^ (h >>> 16), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
      return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    };
    ctx.events.on('run:start', () => { turns.clear(); armed = true; });
    lib.spawn = id => {
      const body = real(id);
      if (!armed) return body;
      const turn = (turns.get(id) ?? 0) + 1;
      turns.set(id, turn);
      const anim = body.anim;
      if (anim) {
        if (typeof anim.time === 'number') anim.time = roll(id, turn, 'time') * 10;
        if (typeof anim.seed === 'number') anim.seed = roll(id, turn, 'seed') * 100;
        if (typeof anim.tickCount === 'number') anim.tickCount = Math.floor(roll(id, turn, 'tick') * 4);
      }
      return body;
    };
  }, seed);
  const loading = await steady.ready(page, { until: scenario.until ?? "window.__op2?.game?.state === 'playing'", timeout: 150000 });
  // Level ground. Which archetype finished loading first differs from one load to the next (the downloads race), and with it
  // which one lent its spare body to the wound warm-up and so which bodies sit in the pool with which idle phases. So: a few
  // frames for the warm-up to hand its body back, then every spare body is dropped and every caller's random stream starts
  // again, and both builds make their bodies fresh, in the order the run asks for them.
  await steady.frames(page, 8);
  await page.evaluate(() => {
    const { ctx } = window.__op2;
    for (const entry of ctx.characters?.entries?.values?.() ?? []) entry.free.length = 0;
    window.__soloRandom.reset();
  });
  await page.evaluate(`(${recorder})()`);
  if (scenario.setup) await page.evaluate(`(${scenario.setup})(window.__op2.ctx, window.__op2.game)`);
  await page.evaluate(([bot, probe]) => {
    window.__soloBot = bot ? (0, eval)(`(${bot})`) : null;
    window.__soloProbe = probe ? (0, eval)(`(${probe})`) : null;
  }, [scenario.bot ? String(scenario.bot) : null, scenario.probe ? String(scenario.probe) : null]);
  const frames = Number(process.env.SOLO_FRAMES ?? scenario.frames ?? 1800);
  const every = Number(process.env.SOLO_SHOTS ?? 0);
  const trace = { scenario: name, label, seed, url: withQuery(scenario.url), loading, frames: [], events: [], random: [], errors: [], shots: [] };
  const started = Date.now();
  for (let f = 0; f < frames; f++) {
    await quiet();
    const stop = await page.evaluate(async () => {
      // The page went somewhere else (a menu's Play loads the mode's own page): the trace ends here.
      if (!window.__solo || !window.__op2) return 'gone';
      const { ctx, game } = window.__op2, solo = window.__solo;
      let stop = false;
      if (window.__soloBot) { try { stop = window.__soloBot(ctx, game, solo.frame, solo.memo) === 'stop'; } catch (e) { solo.errors.push([solo.frame, `bot: ${e.message}`]); } }
      await solo.step(1, null);
      return stop;
    }).catch(e => (/navigat|context was destroyed|Target closed/i.test(String(e)) ? 'gone' : Promise.reject(e)));
    if (every > 0 && (f + 1) % every === 0) {
      const file = join(outDir, `${name}.${label}.f${f + 1}.png`);
      await page.screenshot({ path: file, animations: 'disabled' }).catch(() => {});
      trace.shots.push(file);
    }
    if (stop === 'gone') { trace.wentTo = page.url().replace(/^https?:\/\/[^/]+/, ''); break; }
    if ((f + 1) % 300 === 0 || f === frames - 1 || stop) {
      const part = await page.evaluate(() => window.__solo.take());
      for (const key of ['frames', 'events', 'random', 'errors']) trace[key].push(...part[key]);
    }
    if (stop) break;
  }
  trace.memo = await page.evaluate(() => { try { return JSON.parse(JSON.stringify(window.__solo.memo)); } catch { return null; } }).catch(() => null);
  trace.randomTotals = await page.evaluate(() => window.__soloRandom.total()).catch(() => ({}));
  if (trace.wentTo) trace.after = { wentTo: trace.wentTo };
  else if (scenario.after) trace.after = await page.evaluate(`(${scenario.after})(window.__op2.ctx, window.__op2.game)`);
  const file = join(outDir, `${name}.${label}.trace.json`);
  writeFileSync(file, JSON.stringify(trace));
  // The last frame, for a look: what the run ended on.
  await page.screenshot({ path: join(outDir, `${name}.${label}.end.png`), animations: 'disabled' }).catch(() => {});
  const last = trace.frames.at(-1);
  return { scenario: name, label, frames: trace.frames.length, events: trace.events.length, errors: trace.errors.slice(0, 5), seconds: Math.round((Date.now() - started) / 1000),
    last: last ? { state: last.state, screen: last.screen, run: last.run, enemies: last.enemies.length, extra: last.extra } : null, memo: trace.memo, after: trace.after, file };
}

export default async function (page, { outDir }) {
  const results = [];
  for (const name of names) {
    try { results.push(await play(page, name, outDir)); } catch (e) { results.push({ scenario: name, failed: String(e.stack ?? e).slice(0, 600) }); }
    writeFileSync(join(outDir, `summary.${process.env.SOLO_LABEL ?? 'run'}.${names[0]}.json`), JSON.stringify(results));
  }
  return results.length === 1 ? results[0] : results;
}
