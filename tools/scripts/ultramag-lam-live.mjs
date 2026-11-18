// The Ultramag's laser module in the real game, locked to the crosshair: the Office's server room (the darkest room) and the lit open
// office. Stills at the hip, aimed (the dot over the sights), and with the akimbo pair; a short sequence turning hard while
// strafing; and, every rendered frame through that motion, how far the dot sits from the screen's centre and how far each
// beam's start sits from its emitter's pixel. Then what the laser costs a frame.
//   node tools/shot.mjs --port 5207 --url "/?contract=crucible&map=office&autostart=1&dev=1" --dpr 2 --w 1440 --h 900 \
//     --script tools/scripts/ultramag-lam-live.mjs --out tools/out/ulam/live.png --wait 500 --timeout 400
const SPOTS = {
  server: { at: [-15.2, 0, -12.2], look: [-26, 1.2, -9.5] },
  open: { at: [8, 4.4, 6], look: [8, 5.4, -6] },
};

export default async function lamLive(page, h) {
  const started = Date.now();
  while (Date.now() - started < 150000) {
    if (await page.evaluate(() => window.__op2?.game?.state === 'playing').catch(() => false)) break;
    await h.sleep(1000);
  }
  await page.mouse.click(300, 400);
  const wait = seconds => page.evaluate(async s => {
    const { ctx } = window.__op2;
    const frame = () => new Promise(r => requestAnimationFrame(r));
    const end = ctx.time.playerElapsed + s;
    while (ctx.time.playerElapsed < end) await frame();
  }, seconds);
  const still = async name => {
    await page.evaluate(() => { window.__op2.ctx.time.paused = true; });
    await h.sleep(200);
    await h.shot(name);
    await page.evaluate(() => { window.__op2.ctx.time.paused = false; });
  };
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
    await wait(1.2);
  };
  const fit = ids => page.evaluate(list => {
    const w = window.__op2.ctx.weapons;
    for (const id of list) { w.grantMod(id); w.fitMod(id, true); }
    return [...w.fitted].filter(id => id.startsWith('ultramag'));
  }, ids);
  // Aim is a toggle: press until the weapons say it is where it should be.
  const aim = async on => {
    for (let i = 0; i < 3; i++) {
      if ((await page.evaluate(() => window.__op2.ctx.weapons.aim > 0.5)) === on) return;
      await page.evaluate(() => window.__op2.ctx.input.simulate('aim', true));
      await wait(0.05);
      await page.evaluate(() => window.__op2.ctx.input.simulate('aim', false));
      await wait(0.6);
    }
  };
  // Every rendered frame from now until stopped: the dot's offset from the centre and each beam start's from its emitter, in
  // device pixels, measured after the frame drew with the cameras it drew with.
  const measure = () => page.evaluate(() => {
    const { ctx } = window.__op2;
    const lam = ctx.viewmodel.lam;
    const r = ctx.render;
    const V = ctx.player.position.constructor;
    const out = { frames: 0, dot: [], beam: [] };
    window.__lamMeasure = out;
    const tick = () => {
      if (!window.__lamMeasure) return;
      requestAnimationFrame(tick);
      const W = r.renderer.domElement.width;
      const H = r.renderer.domElement.height;
      const px = v => [v.x * W / 2, v.y * H / 2];
      out.frames++;
      if (lam.hit) {
        const [x, y] = px(lam.dotAt.clone().project(r.camera));
        out.dot.push(Math.hypot(x, y));
      }
      const u = lam.mesh.material.uniforms;
      for (const [slot, name] of [[0, 'uFrom0'], [1, 'uFrom1']]) {
        const socket = lam.sockets[slot];
        if (!socket || !(lam.strength[slot] > 0)) continue;
        const [ax, ay] = px(u[name].value.clone().project(r.camera));
        const [bx, by] = px(new V().setFromMatrixPosition(socket.matrixWorld).project(r.viewCamera));
        out.beam.push(Math.hypot(ax - bx, ay - by));
      }
    };
    requestAnimationFrame(tick);
  });
  const stopMeasure = () => page.evaluate(() => {
    const m = window.__lamMeasure;
    delete window.__lamMeasure;
    const stat = a => a.length ? { n: a.length, max: +Math.max(...a).toFixed(2), mean: +(a.reduce((s, v) => s + v, 0) / a.length).toFixed(2) } : null;
    return { frames: m.frames, dotFromCentrePx: stat(m.dot), beamFromEmitterPx: stat(m.beam) };
  });
  // Turning hard (yaw at `rate` rad/s) while strafing right for `seconds`, stills along the way.
  const turn = async (prefix, rate, seconds, shots) => {
    await page.evaluate(() => window.__op2.ctx.input.simulate('right', true));
    const step = seconds / shots;
    for (let i = 0; i < shots; i++) {
      await page.evaluate(async ([r, s]) => {
        const { ctx } = window.__op2;
        const frame = () => new Promise(res => requestAnimationFrame(res));
        const end = ctx.time.playerElapsed + s;
        let last = ctx.time.playerElapsed;
        while (ctx.time.playerElapsed < end) {
          await frame();
          ctx.player.yaw += r * (ctx.time.playerElapsed - last);
          last = ctx.time.playerElapsed;
        }
      }, [rate, step]);
      await still(`${prefix}-${i + 1}`);
    }
    await page.evaluate(() => window.__op2.ctx.input.simulate('right', false));
  };
  await page.evaluate(() => {
    const { ctx } = window.__op2;
    ctx.waves.update = () => {};
    ctx.player.modifiers.invulnerable = true;
    ctx.render.dynamicResolution.enabled = false;
    ctx.render.renderer.setPixelRatio(2);
    ctx.weapons.give('ultramag');
    ctx.weapons.switchTo('ultramag');
  });
  const out = { fitted: await fit(['ultramagLam', 'ultramagComp']), motion: {} };
  await wait(0.8);
  for (const spot of Object.keys(SPOTS)) {
    await go(spot);
    await still(`${spot}-hip`);
    await aim(true);
    await wait(0.5);
    await still(`${spot}-ads`);
    await aim(false);
    await wait(0.5);
  }
  // Fast turns while strafing, at the hip and aimed, in the dark.
  await go('server');
  await measure();
  await turn('server-turn', 2.4, 0.6, 4);
  out.motion.hip = await stopMeasure();
  await go('server');
  await aim(true);
  await measure();
  await turn('server-turn-ads', -1.6, 0.45, 3);
  out.motion.ads = await stopMeasure();
  await aim(false);

  // Timing, frozen in the server room with the beam and its dot up.
  await go('server');
  out.timing = await page.evaluate(async ({ n, rounds }) => {
    const { ctx, game } = window.__op2;
    const r = ctx.render;
    const rig = ctx.viewmodel;
    const lam = rig.lam;
    const def = rig.def;
    // The CPU side a frame: the slot updates and the shot's ray (walls, then men).
    const cam = r.camera;
    const o = cam.position.clone();
    const d = cam.getWorldDirection(o.clone());
    const once = () => { rig.updateLam(def, 0, 1); lam.target(o.setFromMatrixPosition(cam.matrixWorld), cam.getWorldDirection(d), rig.lamCast); };
    for (let i = 0; i < 200; i++) once();
    const c0 = performance.now();
    const calls = 5000;
    for (let i = 0; i < calls; i++) once();
    const cpuUs = ((performance.now() - c0) / calls) * 1000;
    const gl = r.renderer.getContext();
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
    const best = { off: Infinity, on: Infinity };
    for (let k = 0; k < rounds; k++) {
      for (const v of ['off', 'on']) {
        lam.mesh.visible = lam.overlay.visible = v === 'on';
        for (let i = 0; i < 3; i++) { r.render(); sync(); }
        await raf();
        const t0 = performance.now();
        for (let i = 0; i < n; i++) { r.render(); sync(); }
        best[v] = Math.min(best[v], (performance.now() - t0) / n);
      }
    }
    lam.mesh.visible = lam.overlay.visible = true;
    delete game.frame;
    return { cpuUsPerFrame: +cpuUs.toFixed(2), gpuMs: Object.fromEntries(Object.entries(best).map(([k, v]) => [k, +v.toFixed(2)])), size: [r.renderer.domElement.width, r.renderer.domElement.height] };
  }, { n: 8, rounds: 8 });

  // Akimbo: a beam from each gun to the one dot.
  out.akimbo = await fit(['ultramagAkimbo']);
  await wait(1);
  for (const spot of Object.keys(SPOTS)) {
    await go(spot);
    await still(`${spot}-akimbo`);
  }
  await go('server');
  await measure();
  await turn('server-akimbo-turn', 2.4, 0.4, 2);
  out.motion.akimbo = await stopMeasure();
  return out;
}
