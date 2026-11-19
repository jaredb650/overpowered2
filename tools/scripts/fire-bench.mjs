// What fire on bodies costs: whole frames (update, render, and a GPU sync) timed in the real game on the Test Range, with
// ten men alight in view. Run it three times and compare: FIRE_CASE=tencold (nobody burning), FIRE_CASE=ten with
// "?fire=0" in the URL (fire as it was), FIRE_CASE=ten (the new fire); FIRE_CASE=tendead is ten corpses burning.
//
//   FIRE_CASE=ten node tools/shot.mjs --port <yours> --url "/?map=range" --dpr 2 --w 1440 --h 900 --wait 1500 --timeout 200 \
//     --script tools/scripts/fire-bench.mjs --out tools/out/<you>/bench-ten.png
//
// Env: FIRE_BENCH_FRAMES frames timed (default 360), FIRE_BENCH_WARM seconds before timing (default 2.5).
import fireLook from './fire-look.mjs';

const FRAMES = Number(process.env.FIRE_BENCH_FRAMES ?? 360);
const WARM = Number(process.env.FIRE_BENCH_WARM ?? 2.5);

export default async function fireBench(page, h) {
  const scene = await fireLook(page, h);
  await h.sleep(WARM * 1000);
  const result = await page.evaluate(frames => new Promise(resolve => {
    const { ctx, game } = window.__op2;
    const gl = ctx.render.renderer.getContext();
    // gl.finish() in Chrome is only a flush: a read from a framebuffer of its own is what really waits.
    const fbo = gl.createFramebuffer();
    const tex = gl.createTexture();
    const prevTex = gl.getParameter(gl.TEXTURE_BINDING_2D);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindTexture(gl.TEXTURE_2D, prevTex);
    const prevFbo = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, prevFbo);
    const px = new Uint8Array(4);
    const sync = () => {
      const was = gl.getParameter(gl.FRAMEBUFFER_BINDING);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      gl.bindFramebuffer(gl.FRAMEBUFFER, was);
    };
    const times = [];
    let calls = 0, licks = 0, alight = 0, particles = 0;
    const frame = game.frame.bind(game);
    game.frame = (...args) => {
      sync();
      const t0 = performance.now();
      frame(...args);
      sync();
      times.push(performance.now() - t0);
      calls = Math.max(calls, ctx.render.renderer.info.render.calls);
      const s = ctx.gore.fire?.stats?.();
      if (s) { licks += s.licks; alight = Math.max(alight, s.alight); }
      if (times.length === frames) {
        delete game.frame;
        particles = ctx.fx.stats?.().particles ?? 0;
        times.sort((a, b) => a - b);
        const mean = times.reduce((a, b) => a + b, 0) / times.length;
        resolve({
          frames, meanMs: +mean.toFixed(2), medianMs: +times[times.length >> 1].toFixed(2), p95Ms: +times[Math.floor(times.length * 0.95)].toFixed(2),
          worstMs: +times[times.length - 1].toFixed(2), drawCalls: calls, alight, licksPerFrame: +(licks / frames).toFixed(2), particles,
          living: window.__fire.made.filter(e => e.alive).length,
        });
      }
    };
  }), FRAMES);
  console.error('[fire-bench]', process.env.FIRE_CASE ?? 'slow', JSON.stringify(result));
  return { scene, result };
}
