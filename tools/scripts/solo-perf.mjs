// Frame times of a single-player fight in real time, every frame drawn, and every hitch with the shader programs that were
// compiled on it. For comparing two builds (run it against each one's dev server) and for hunting first-use stalls.
//
//   node tools/shot.mjs --port <yours> --url "/?contract=crucible&autostart=1" --wait 0 --timeout 300 --dpr 2 --w 1440 --h 900 \
//     --script tools/scripts/solo-perf.mjs --out tools/out/<you>/perf.png
//
// Settings (environment):
//   PERF_SECONDS   how long to play (default 60)
//   PERF_SCENARIO  whose bot to use, from tools/scripts/lib/solo-scenarios.mjs (default crucible: the fighter)
//   PERF_LABEL     goes into the file name: <outDir>/perf.<label>.json (default "run")
//   PERF_SEED      Math.random's seed (default 1): the same rosters and rolls on both builds, as far as real time allows
//   PERF_SKIP      seconds at the start left out of the figures (default 0); hitches are listed from the first frame
//   PERF_FLOW      "menu": start the run from the splash, as a player does, instead of with autostart=1 (see below)
// The page is a returning player's with default settings (music off). Returns the frame interval and the game's own work time
// per frame (median, 95th, 99th, worst), frames over 33 / 50 / 100 ms, draw calls and triangles, the JS heap and GPU memory at
// the end, and each hitch over 40 ms with the second of play it fell on and the programs linked on it or the frame before.
// Timings taken while the machine is busy prove nothing: check `uptime`, and run each build more than once, in turn.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as glmem from './lib/glmem.mjs';
import { mulberry32 } from './lib/steady.mjs';
import { SCENARIOS } from './lib/solo-scenarios.mjs';

const scenario = SCENARIOS[process.env.PERF_SCENARIO ?? 'crucible'];

/** In the page, before the game: every shader program link is noted with the time and what the fragment shader declares. */
function watchLinks() {
  const links = window.__links = [];
  const proto = WebGL2RenderingContext.prototype, link = proto.linkProgram;
  proto.linkProgram = function (program) {
    let uniforms = '';
    try {
      const frag = (this.getAttachedShaders(program) || []).find(sh => this.getShaderParameter(sh, this.SHADER_TYPE) === this.FRAGMENT_SHADER);
      const source = frag ? this.getShaderSource(frag) || '' : '';
      const names = [...source.matchAll(/uniform\s+\w+\s+(\w+)/g)].map(x => x[1]).filter(n => !/^(viewMatrix|cameraPosition|isOrthographic|toneMappingExposure|opacity|diffuse|emissive|roughness|metalness|envMap\w*|fog\w*|ambientLightColor|lightProbe|directionalLights?\w*|pointLights?\w*|spotLights?\w*|hemisphereLights?\w*|rectAreaLights?\w*|ltc_\d|receiveShadow|\w*ShadowMap|\w*ShadowMatrix|clippingPlanes)$/.test(n));
      uniforms = [...new Set(names)].slice(0, 14).join(',');
      const defines = [...source.matchAll(/#define\s+(USE_\w+|\w*SKINN\w*|STANDARD|PHYSICAL|\w*INSTANC\w*)/g)].map(x => x[1]);
      uniforms += ` | ${[...new Set(defines)].slice(0, 10).join(',')}`;
    } catch { /* a lost context */ }
    links.push([Math.round(performance.now()), uniforms]);
    return link.call(this, program);
  };
}

export const before = async page => {
  await glmem.inject(page);
  await page.addInitScript(`(${watchLinks})();`);
  await page.addInitScript(`Math.random = (${mulberry32})(${Number(process.env.PERF_SEED ?? 1)});`);
  await page.addInitScript(() => {
    if (sessionStorage.getItem('perf.set')) return;
    sessionStorage.setItem('perf.set', '1');
    localStorage.clear();
    localStorage.setItem('op2.settings.v1', JSON.stringify({ music: 0 }));
    localStorage.setItem('op2.played.v1', '1');
  });
};

export default async function (page, { sleep, outDir }) {
  const seconds = Number(process.env.PERF_SECONDS ?? 60);
  const origin = new URL(page.url()).origin;
  // PERF_FLOW=menu: as a player arrives, not as a test does. The page loads with no `autostart`, sits on the splash for
  // PERF_MENU seconds (default 4) with the game drawing behind it, and the run is started from there. A test's `autostart=1`
  // has no splash, so everything the game warms up on its first drawn frames lands in the first frames of play instead.
  const fromMenu = process.env.PERF_FLOW === 'menu';
  await page.goto(origin + (fromMenu ? scenario.url.replace(/[?&]autostart=1/, m => (m[0] === '?' ? '?' : '')).replace(/\?$/, '').replace('?&', '?') : scenario.url), { waitUntil: 'load', timeout: 60000 });
  if (fromMenu) {
    await page.waitForFunction(() => window.__op2?.game?.state === 'menu' && window.__op2.ctx.hud.screens?.name === 'splash', null, { timeout: 150000 });
    await sleep(Number(process.env.PERF_MENU ?? 4) * 1000);
    await page.evaluate(() => window.__op2.ctx.hud.startRun());
  }
  await page.waitForFunction(() => window.__op2?.game?.state === 'playing', null, { timeout: 150000 });
  if (scenario.setup) await page.evaluate(`window.__solo = { memo: {} }; (${scenario.setup})(window.__op2.ctx, window.__op2.game)`);
  await page.evaluate(([botSource]) => {
    const { ctx, game } = window.__op2;
    const bot = botSource ? (0, eval)(`(${botSource})`) : null;
    const memo = window.__solo?.memo ?? {};
    const renderer = ctx.render.renderer;
    const perf = window.__perf = { frames: [], programs: [], start: performance.now(), on: true, programsAtStart: renderer.info.programs?.length ?? 0, linksBefore: (window.__links ?? []).length };
    let last = performance.now(), n = 0, known = new Set((renderer.info.programs ?? []).map(p => p.id));
    const tick = now => {
      if (!perf.on) return;
      requestAnimationFrame(tick);
      const interval = now - last;
      last = now;
      if (bot) { try { bot(ctx, game, n, memo); } catch { /* the run goes on */ } }
      const list = renderer.info.programs ?? [];
      let fresh = null;
      if (list.length !== known.size) {
        fresh = [];
        for (const p of list) if (!known.has(p.id)) { known.add(p.id); fresh.push(p.name || p.type || `#${p.id}`); }
        perf.programs.push([n, Math.round(now - perf.start), fresh]);
      }
      perf.frames.push([Math.round(interval * 100) / 100, Math.round((game.cpuMs ?? 0) * 100) / 100, renderer.info.render.calls, renderer.info.render.triangles, ctx.enemies.alive.length]);
      n++;
    };
    requestAnimationFrame(tick);
  }, [scenario.bot ? String(scenario.bot) : null]);
  await sleep(seconds * 1000);
  const perf = await page.evaluate(() => { const p = window.__perf; p.on = false; p.links = (window.__links ?? []).slice(p.linksBefore).map(([t, what]) => [Math.round((t - p.start) / 100) / 10, what]); return p; });
  const mem = await glmem.sample(page);
  const state = await page.evaluate(() => { const { ctx, game } = window.__op2; return { state: game.state, wave: ctx.waves?.wave, kills: ctx.progression?.kills, score: ctx.progression?.score, programs: ctx.render.renderer.info.programs?.length ?? 0 }; });

  const q = (list, f) => list.length ? list[Math.min(list.length - 1, Math.floor(list.length * f))] : 0;
  // PERF_SKIP seconds at the start are left out of the figures (the crowd arriving, programs linking), not out of `hitches`.
  const skipMs = Number(process.env.PERF_SKIP ?? 0) * 1000;
  let passed = 0;
  const all = perf.frames.slice(1);
  const frames = all.filter(f => (passed += f[0]) > skipMs);
  const intervals = frames.map(f => f[0]).sort((a, b) => a - b), work = frames.map(f => f[1]).sort((a, b) => a - b);
  const mean = list => list.length ? Math.round(list.reduce((s, v) => s + v, 0) / list.length * 100) / 100 : 0;
  const linkedAt = new Map(perf.programs.map(([n, , names]) => [n, names]));
  const hitches = [];
  let t = 0;
  all.forEach((f, i) => {
    t += f[0];
    if (f[0] < 40) return;
    const n = i + 1;
    const linked = [...(linkedAt.get(n) ?? []), ...(linkedAt.get(n - 1) ?? []), ...(linkedAt.get(n + 1) ?? [])];
    hitches.push({ second: Math.round(t / 100) / 10, intervalMs: f[0], workMs: f[1], enemies: f[4], linked });
  });
  const result = {
    label: process.env.PERF_LABEL ?? 'run', seconds, frames: frames.length, fps: Math.round(frames.length / (intervals.reduce((s, v) => s + v, 0) / 1000) * 10) / 10,
    intervalMs: { mean: mean(intervals), median: q(intervals, 0.5), p95: q(intervals, 0.95), p99: q(intervals, 0.99), worst: intervals.at(-1) },
    workMs: { mean: mean(work), median: q(work, 0.5), p95: q(work, 0.95), p99: q(work, 0.99), worst: work.at(-1) },
    over: { ms33: intervals.filter(v => v > 33.4).length, ms50: intervals.filter(v => v > 50).length, ms100: intervals.filter(v => v > 100).length },
    drawCalls: { mean: Math.round(mean(frames.map(f => f[2]))), worst: Math.max(...frames.map(f => f[2])) },
    triangles: { mean: Math.round(mean(frames.map(f => f[3]))), worst: Math.max(...frames.map(f => f[3])) },
    enemies: { mean: mean(frames.map(f => f[4])), worst: Math.max(...frames.map(f => f[4])) },
    programs: { atStart: perf.programsAtStart, atEnd: state.programs, linkedInPlay: perf.programs.map(([n, ms, names]) => ({ second: Math.round(ms / 100) / 10, frameIntervalMs: perf.frames[n]?.[0], names })) },
    memory: { heapMB: Math.round(mem.heap / 1048576), gpuMB: Math.round(mem.gpuTotal / 1048576), textures: mem.nTexture, buffers: mem.nBuffer, glPrograms: mem.nProgram },
    hitches, state,
    // Every program linked once play began: the second it fell on, and what its fragment shader declares (to tell which it is).
    linked: perf.links,
  };
  writeFileSync(join(outDir, `perf.${result.label}.json`), JSON.stringify({ ...result, raw: perf.frames }));
  return result;
}
