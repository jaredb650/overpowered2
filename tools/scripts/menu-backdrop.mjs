// The main menu's background in the real game: reach the menu through a real click on the splash, take screenshots,
// time the frames, and walk menu -> run -> menu to check that nothing is left behind.
//
//   node tools/shot.mjs --url "/" --script tools/scripts/menu-backdrop.mjs --out tools/out/menubg/menu.png --dpr 2 --w 1440 --h 900 --wait 500 --timeout 170 --quiet
//
// MB_STEPS picks what runs, comma separated (default shots,time):
//   shots    three screenshots of the menu a few seconds apart, plus the splash
//   time     frame intervals and render() CPU on the menu for 6 s, then render() timed with the GPU's work included
//   trip     menu -> run -> menu twice, with GPU memory counts and the scene's object count at each stop
//   screens  guide, settings and rules, one screenshot each
// MB_TRIPS is how many round trips `trip` makes (default 2). MB_WAIT is the time on the menu before the first shot, in ms (default 2500).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const STEPS = (process.env.MB_STEPS ?? 'shots,time').split(',');
const WAIT = Number(process.env.MB_WAIT ?? 2500);

/** Runs in the page: resolves once the splash is up. */
async function splash() {
  const end = performance.now() + 120000;
  while (performance.now() < end) {
    if (window.__op2?.ctx?.hud?.screens?.name === 'splash') return true;
    await new Promise(r => setTimeout(r, 100));
  }
  return false;
}

/** Runs in the page: the state of the menu's background and the renderer's resources. */
function probe() {
  const { ctx, game } = window.__op2;
  const r = ctx.render;
  const info = r.renderer?.info;
  const backdrop = ctx.hud.backdrop?.stats?.() ?? null;
  let worldObjects = 0;
  r.scene.traverse(() => { worldObjects++; });
  return {
    state: game.state,
    screen: ctx.hud.screens.name,
    backdrop,
    geometries: info?.memory.geometries,
    textures: info?.memory.textures,
    programs: info?.programs?.length,
    calls: r.drawCalls?.(),
    triangles: r.triangles?.(),
    worldObjects,
    heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null,
  };
}

/** Runs in the page: frame intervals over `seconds`, and the CPU time of every render() call. */
async function time(seconds) {
  const r = window.__op2.ctx.render;
  const real = r.render.bind(r);
  const cpu = [];
  r.render = () => {
    const t0 = performance.now();
    real();
    cpu.push(performance.now() - t0);
  };
  const gaps = [];
  let last = performance.now();
  const end = last + seconds * 1000;
  await new Promise(done => {
    const tick = now => {
      gaps.push(now - last);
      last = now;
      if (now < end) requestAnimationFrame(tick);
      else done();
    };
    requestAnimationFrame(tick);
  });
  r.render = real;
  const q = (a, p) => {
    const s = [...a].sort((x, y) => x - y);
    return Number((s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0).toFixed(2));
  };
  return {
    frames: gaps.length,
    interval: { p50: q(gaps, 0.5), p90: q(gaps, 0.9), p99: q(gaps, 0.99) },
    renders: cpu.length,
    renderCpu: { p50: q(cpu, 0.5), p90: q(cpu, 0.9), max: q(cpu, 1) },
    calls: r.drawCalls?.(),
    triangles: r.triangles?.(),
  };
}

/**
 * Runs in the page: the whole render() with the GPU's work included, best and median of `rounds` runs of 8 calls,
 * each run between two one-pixel reads that wait for the GPU to finish.
 */
function gpu(rounds) {
  const r = window.__op2.ctx.render;
  const gl = r.renderer.getContext();
  const px = new Uint8Array(4);
  const sync = () => {
    r.renderer.setRenderTarget(null);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  };
  const runs = [];
  for (let i = 0; i < rounds; i++) {
    sync();
    const t0 = performance.now();
    for (let k = 0; k < 8; k++) r.render();
    sync();
    runs.push((performance.now() - t0) / 8);
  }
  runs.sort((a, b) => a - b);
  return { best: Number(runs[0].toFixed(2)), median: Number(runs[runs.length >> 1].toFixed(2)), calls: r.drawCalls?.(), triangles: r.triangles?.() };
}

export default async function run(page, { sleep, shot, outDir }) {
  mkdirSync(outDir, { recursive: true });
  const out = { steps: STEPS };
  if (!(await page.evaluate(splash))) return { error: 'no splash' };
  await sleep(1200);
  if (STEPS.includes('shots')) await shot('splash');
  await page.mouse.click(720, 450);
  await sleep(WAIT);
  out.menu = await page.evaluate(probe);
  if (STEPS.includes('shots')) {
    await shot('a');
    await sleep(3500);
    await shot('b');
    await sleep(5000);
    await shot('c');
  }
  if (STEPS.includes('time')) {
    out.time = await page.evaluate(time, 6);
    out.gpu = await page.evaluate(gpu, 12);
  }
  if (STEPS.includes('screens')) {
    for (const name of ['guide', 'settings', 'rules']) {
      await page.evaluate(n => window.__op2.ctx.hud.showScreen(n), name);
      await sleep(1500);
      await shot(name);
      out[name] = await page.evaluate(probe);
    }
    await page.evaluate(() => window.__op2.ctx.hud.showScreen('menu'));
    await sleep(800);
  }
  if (STEPS.includes('trip')) {
    out.trip = [await page.evaluate(probe)];
    for (let i = 0; i < Number(process.env.MB_TRIPS ?? 2); i++) {
      await page.evaluate(() => window.__op2.ctx.hud.startRun());
      await sleep(3000);
      out.trip.push(await page.evaluate(probe));
      await page.evaluate(() => window.__op2.ctx.hud.quitToMenu());
      await sleep(2500);
      out.trip.push(await page.evaluate(probe));
    }
    await shot('back');
  }
  writeFileSync(join(outDir, 'report.json'), JSON.stringify(out, null, 2));
  return out;
}
