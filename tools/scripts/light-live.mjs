// The weapon light in the real game: stills with it on and off in the Office's server room (the darkest room) and the lit open
// office upstairs, and what it costs a frame. Timing is GPU-synced renders of a frozen frame, round-robin over three variants:
// no spotlight in the scene at all (before the mod), the boot-time spotlight dark (no light fitted), and the light on.
//   node tools/shot.mjs --port 5194 --url "/?contract=crucible&map=office&autostart=1&dev=1" --dpr 2 --w 1440 --h 900 \
//     --script tools/scripts/light-live.mjs --out tools/out/light/live.png --wait 500 --timeout 400
// LIGHT_N renders a round (default 8), LIGHT_ROUNDS (default 8).
const SPOTS = {
  server: { at: [-15.2, 0, -12.2], look: [-26, 1.2, -9.5] },
  open: { at: [8, 4.4, 6], look: [8, 5.4, -6] },
};

export default async function lightLive(page, h) {
  const started = Date.now();
  while (Date.now() - started < 150000) {
    if (await page.evaluate(() => window.__op2?.game?.state === 'playing')) break;
    await h.sleep(1000);
  }
  const go = async name => {
    const s = SPOTS[name];
    await page.evaluate(([at, look]) => {
      const { ctx } = window.__op2;
      ctx.enemies.killAll('test');
      const p = ctx.player;
      p.teleport(p.position.clone().set(at[0], at[1] + 0.1, at[2]), 0);
      p.yaw = Math.atan2(-(look[0] - at[0]), -(look[2] - at[2]));
      p.pitch = Math.atan2(look[1] - at[1] - 1.6, Math.hypot(look[0] - at[0], look[2] - at[2]));
    }, [s.at, s.look]);
    await h.sleep(2500);
  };
  const light = on => page.evaluate(v => {
    const w = window.__op2.ctx.weapons;
    const id = `${w.current}Light`;
    w.grantMod(id);
    w.fitMod(id, v);
    return { gun: w.current, fitted: w.fitted.has(id) };
  }, on);
  const gun = await page.evaluate(() => {
    const { ctx } = window.__op2;
    ctx.waves.update = () => {};
    ctx.player.modifiers.invulnerable = true;
    ctx.render.dynamicResolution.enabled = false;
    document.querySelector('.hud')?.style.setProperty('visibility', 'hidden');
    return ctx.weapons.current;
  });
  const stills = {};
  for (const spot of Object.keys(SPOTS)) {
    await go(spot);
    await light(false);
    await h.sleep(600);
    await h.shot(`${spot}-off`);
    stills[spot] = await light(true);
    await h.sleep(600);
    await h.shot(`${spot}-on`);
  }

  // Back in the server room, frozen, and timed.
  await go('server');
  const timing = await page.evaluate(async ({ n, rounds }) => {
    const { ctx, game } = window.__op2;
    const r = ctx.render;
    const gl = r.renderer.getContext();
    const torch = ctx.viewmodel.torch;
    const on = torch.intensity;
    // As gpu-bench.mjs: a read from a 1x1 target of its own, after a clear queued behind the frame, really waits for the GPU
    // (gl.finish is only a flush, and a read of the canvas waits for the display).
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
    game.frame = () => {};
    const raf = () => new Promise(res => requestAnimationFrame(res));
    const set = v => {
      if (v === 'none') r.scene.remove(torch, torch.target);
      else if (!torch.parent) r.scene.add(torch, torch.target);
      if (v === 'on') torch.intensity = on;
      else torch.intensity = 0;
    };
    const variants = ['none', 'dark', 'on'];
    const best = { none: Infinity, dark: Infinity, on: Infinity };
    const firstMs = {};
    for (let k = 0; k < rounds; k++) {
      for (const v of variants) {
        set(v);
        const t = performance.now();
        r.render();
        sync();
        if (k === 0) firstMs[v] = +(performance.now() - t).toFixed(1);
        for (let i = 0; i < 3; i++) { r.render(); sync(); }
        await raf();
        const t0 = performance.now();
        for (let i = 0; i < n; i++) { r.render(); sync(); }
        best[v] = Math.min(best[v], (performance.now() - t0) / n);
      }
    }
    set('on');
    delete game.frame;
    return { best: Object.fromEntries(Object.entries(best).map(([k, v]) => [k, +v.toFixed(2)])), firstMs, size: [r.renderer.domElement.width, r.renderer.domElement.height], scale: r.dynamicResolution.scale };
  }, { n: Number(process.env.LIGHT_N ?? 8), rounds: Number(process.env.LIGHT_ROUNDS ?? 8) });
  return { gun, stills, timing };
}
