// What wounds cost the GPU, in the real game on the Test Range: 20 bodies on screen, frozen, timed round-robin with
// a GPU sync at each end, so load from other programs hits every case alike. Every figure is ms per whole frame.
//
//   node tools/shot.mjs --url "/?map=range" --dpr 2 --w 1440 --h 900 --wait 500 --timeout 170 --quiet \
//     --script tools/scripts/wound-bench.mjs
//
// Env: WB_N frames per round (6), WB_ROUNDS (8), WB_TYPE archetype (trooper).
const N = Number(process.env.WB_N ?? 6);
const ROUNDS = Number(process.env.WB_ROUNDS ?? 8);
const TYPE = process.env.WB_TYPE ?? 'trooper';

function install({ n, rounds, type }) {
  const { ctx, game } = window.__op2;
  const lab = window.__lab;
  const r = ctx.render;
  const gl = r.renderer.getContext();
  r.dynamicResolution.enabled = false;
  const V = ctx.player.position.constructor;

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
    const f = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    const mask = gl.getParameter(gl.COLOR_WRITEMASK);
    const scissor = gl.isEnabled(gl.SCISSOR_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.colorMask(true, true, true, true);
    if (scissor) gl.disable(gl.SCISSOR_TEST);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    if (scissor) gl.enable(gl.SCISSOR_TEST);
    gl.colorMask(mask[0], mask[1], mask[2], mask[3]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
  };
  const raf = k => new Promise(res => {
    const step = () => (--k <= 0 ? res() : requestAnimationFrame(step));
    requestAnimationFrame(step);
  });
  const frameCost = frames => {
    sync();
    const t0 = performance.now();
    for (let i = 0; i < frames; i++) r.render();
    sync();
    return (performance.now() - t0) / frames;
  };
  const stat = a => {
    const s = [...a].sort((x, y) => x - y);
    return { best: +s[0].toFixed(2), median: +s[s.length >> 1].toFixed(2) };
  };

  const bodies = [];
  const setup = async () => {
    ctx.player.teleport(new V(0, 0.1, 16), 0);
    ctx.player.pitch = -0.05;
    for (let i = 0; i < 20; i++) {
      const row = Math.floor(i / 5);
      const e = lab.spawner.place(type, new V((i % 5 - 2) * 1.5 + row * 0.35, 0, 11.5 - row * 2.6), 'off');
      if (e) bodies.push(e);
    }
    await raf(60);
    game.frame = () => {};
    await raf(3);
    return { bodies: bodies.length, calls: r.drawCalls(), tris: r.triangles() };
  };

  // Hit points in world space on the body's own bones, spread so that most of the skin has a wound near it.
  const sites = [
    [2, 0.05, 0.12, 0.15], [2, -0.1, 0.05, 0.15], [1, 0.06, 0.08, 0.13], [1, -0.08, 0.02, 0.13], [2, 0.14, 0.2, 0.12], [0, -0.1, -0.02, 0.13],
    [11, 0.02, -0.2, 0.08], [14, -0.02, -0.25, 0.08], [12, 0, -0.2, 0.06], [15, 0, -0.15, 0.06], [5, 0.04, -0.14, 0.05], [8, -0.04, -0.14, 0.05],
    [6, 0.04, -0.12, 0.04], [9, -0.04, -0.12, 0.04], [2, 0.02, 0.28, 0.13], [4, 0.04, 0.1, 0.1],
  ];
  const p = new V();
  const addWounds = (count, radius) => {
    for (const e of bodies) {
      for (let i = 0; i < count; i++) {
        const [bone, x, y, z] = sites[i % sites.length];
        const b = e.char.bones[bone];
        b.updateWorldMatrix(true, false);
        p.set(x, y, z).applyMatrix4(b.matrixWorld);
        e.char.addWound(bone, p, radius);
      }
    }
  };

  /** Real cuts, where the build has them: holes, one crater and one exit each. */
  const addCuts = (holes, deep) => {
    if (!bodies[0].char.wound) return false;
    const dir = new V();
    for (const e of bodies) {
      const cut = (kind, bone, x, y, z, radius, depth, ragged) => {
        const b = e.char.bones[bone];
        b.updateWorldMatrix(true, false);
        p.set(x, y, z).applyMatrix4(b.matrixWorld);
        dir.set(0, 0, -1).transformDirection(b.matrixWorld);
        e.char.wound({ kind, bone, point: p, dir, radius, depth, ragged });
      };
      for (let i = 0; i < holes; i++) {
        const [bone, x, y, z] = sites[i % sites.length];
        cut(0, bone, x, y, z, 0.0125, 0.05, 0.4);
      }
      if (deep) {
        cut(2, 2, 0, 0.1, 0.16, 0.12, 0.13, 1);
        cut(2, 1, 0.02, 0.08, 0.13, 0.08, 0.1, 1);
      }
    }
    return true;
  };

  const measure = cases => {
    const out = Object.fromEntries(cases.map(c => [c.name, []]));
    for (const c of cases) { c.on?.(); frameCost(2); c.off?.(); }
    for (let k = 0; k < rounds; k++) {
      for (const c of cases) {
        c.on?.();
        frameCost(1);
        out[c.name].push(frameCost(n));
        c.off?.();
      }
    }
    return Object.fromEntries(cases.map(c => [c.name, stat(out[c.name])]));
  };

  const hide = {
    name: 'no bodies',
    on() { for (const e of bodies) e.char.root.visible = false; },
    off() { for (const e of bodies) e.char.root.visible = true; },
  };
  window.__wb = { setup, addWounds, addCuts, measure, hide, bodies, r, raf };
}

export default async function bench(page, h) {
  for (let i = 0; i < 180; i++) {
    if (await page.evaluate(() => !!window.__lab && window.__op2?.game?.state === 'playing')) break;
    await h.sleep(500);
  }
  await page.evaluate(install, { n: N, rounds: ROUNDS, type: TYPE });
  const load = await page.evaluate(() => window.__wb.setup());
  const out = { load };
  out.healthy = await page.evaluate(() => {
    const w = window.__wb;
    return w.measure([w.hide, { name: 'healthy' }]);
  });
  await page.evaluate(() => window.__wb.addWounds(8, 0.05));
  out.wounds8 = await page.evaluate(() => {
    const w = window.__wb;
    return w.measure([w.hide, { name: '8 wounds' }]);
  });
  await page.evaluate(() => window.__wb.addWounds(8, 0.05));
  out.wounds16 = await page.evaluate(() => {
    const w = window.__wb;
    return w.measure([w.hide, { name: '16 wounds' }]);
  });
  if (await page.evaluate(() => window.__wb.addCuts(8, false))) {
    out.holes8 = await page.evaluate(() => {
      const w = window.__wb;
      return w.measure([w.hide, { name: '16 paint + 8 holes' }]);
    });
    await page.evaluate(() => window.__wb.addCuts(0, true));
    out.deep = await page.evaluate(() => {
      const w = window.__wb;
      return w.measure([w.hide, { name: '+ chest and belly open' }]);
    });
    out.load2 = await page.evaluate(() => ({ calls: window.__wb.r.drawCalls(), tris: window.__wb.r.triangles() }));
  }
  await page.evaluate(() => new Promise(res => requestAnimationFrame(() => { window.__op2.ctx.render.render(); requestAnimationFrame(res); })));
  await h.shot('bench');
  return out;
}
