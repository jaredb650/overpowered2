// The Ultramag's laser module beam in the real game: the Office's server room (the darkest room) and the lit open office, at
// the hip and aimed, with the compensator on; a frame of the slide racking and of the reload; the akimbo pair with a beam each;
// and what the beam costs a frame (the CPU of its ray and buffer write, and GPU-synced renders with the beam drawn and not).
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
  const dot = () => page.evaluate(() => {
    const lam = window.__op2.ctx.viewmodel.lam;
    return [lam.dotOn(0), lam.dotOn(1)];
  });
  await page.evaluate(() => {
    const { ctx } = window.__op2;
    ctx.waves.update = () => {};
    ctx.player.modifiers.invulnerable = true;
    ctx.render.dynamicResolution.enabled = false;
    ctx.render.renderer.setPixelRatio(2);
    ctx.weapons.give('ultramag');
    ctx.weapons.switchTo('ultramag');
  });
  const out = { fitted: await fit(['ultramagLam', 'ultramagComp']), dots: {} };
  await wait(0.8);
  for (const spot of Object.keys(SPOTS)) {
    await go(spot);
    await still(`${spot}-hip`);
    out.dots[`${spot}-hip`] = await dot();
    await aim(true);
    await wait(0.7);
    await still(`${spot}-ads`);
    out.dots[`${spot}-ads`] = await dot();
    await aim(false);
    await wait(0.5);
  }
  // The slide at full travel 60 ms after a shot, and the reload half done and racking: in the lit office, at its wall (a shot
  // down the server room sets off a rack).
  await go('open');
  await page.evaluate(() => window.__op2.ctx.input.simulate('fire', true));
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.evaluate(() => window.__op2.ctx.input.simulate('fire', false));
  await wait(0.06);
  await still('open-rack');
  await wait(0.5);
  await page.evaluate(() => window.__op2.ctx.input.simulate('reload', true));
  await wait(0.05);
  await page.evaluate(() => window.__op2.ctx.input.simulate('reload', false));
  await wait(0.35);
  await still('open-reload-mid');
  await wait(0.5);
  await still('open-reload-rack');
  await wait(1.2);

  // Timing, frozen in the server room with the beam and its dot up.
  await go('server');
  out.timing = await page.evaluate(async ({ n, rounds }) => {
    const { ctx, game } = window.__op2;
    const r = ctx.render;
    const rig = ctx.viewmodel;
    const lam = rig.lam;
    // The CPU side: the ray and the buffer write, as the rig does them a frame.
    const def = rig.def;
    for (let i = 0; i < 200; i++) rig.updateLam(def, 0, 1);
    const c0 = performance.now();
    const calls = 5000;
    for (let i = 0; i < calls; i++) rig.updateLam(def, 0, 1);
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
        lam.mesh.visible = v === 'on';
        for (let i = 0; i < 3; i++) { r.render(); sync(); }
        await raf();
        const t0 = performance.now();
        for (let i = 0; i < n; i++) { r.render(); sync(); }
        best[v] = Math.min(best[v], (performance.now() - t0) / n);
      }
    }
    lam.mesh.visible = true;
    delete game.frame;
    return { cpuUsPerGun: +cpuUs.toFixed(2), gpuMs: Object.fromEntries(Object.entries(best).map(([k, v]) => [k, +v.toFixed(2)])), size: [r.renderer.domElement.width, r.renderer.domElement.height] };
  }, { n: 8, rounds: 8 });

  // Akimbo: a beam and a dot from each gun.
  out.akimbo = await fit(['ultramagAkimbo']);
  await wait(1);
  for (const spot of Object.keys(SPOTS)) {
    await go(spot);
    await still(`${spot}-akimbo`);
    out.dots[`${spot}-akimbo`] = await dot();
  }
  return out;
}
