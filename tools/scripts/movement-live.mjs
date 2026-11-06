// The real game in real Chrome: boots /?autostart=1, drives the keys for a few seconds and reads what the screen
// shows. Proves the view is level at any time the feet are on the ground, at the real frame rate and pixel ratio.
//
//   node tools/shot.mjs --url "/?autostart=1" --script tools/scripts/movement-live.mjs --out tools/out/live.png --wait 500
//   node tools/shot.mjs --url "/?autostart=1&map=crucible" --dpr 2 --w 1440 --h 900 --script tools/scripts/movement-live.mjs --out tools/out/live-2x.png --wait 500 --timeout 200

export default async function run(page, h) {
  // On a busy machine a Retina screenshot can time out. The numbers are the point, so a lost picture must not lose them.
  const shot = name => h.shot(name).catch(e => console.error(`shot ${name} failed: ${e.message.split('\n')[0]}`));
  const started = Date.now();
  let ready = false;
  while (!ready && Date.now() - started < 120000) {
    ready = await page.evaluate(() => window.__op2?.game?.state === 'playing');
    if (!ready) await h.sleep(1000);
  }
  if (!ready) {
    await h.shot('fail');
    return { booted: false, body: await page.evaluate(() => document.body.innerText.slice(0, 500)) };
  }

  await page.evaluate(() => {
    const { ctx } = window.__op2;
    ctx.player.modifiers.invulnerable = true;
    const peak = { roll: 0, fov: 0, n: 0 };
    window.__live = { peak };
    const sample = () => {
      peak.roll = Math.max(peak.roll, Math.abs(ctx.render.camera.rotation.z));
      peak.fov = Math.max(peak.fov, ctx.camera.fov);
      peak.n++;
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });

  const key = (a, down) => page.evaluate(([x, d]) => window.__op2.ctx.input.simulate(x, d), [a, down]);
  const read = () => page.evaluate(() => {
    const { ctx } = window.__op2;
    const { peak } = window.__live;
    const out = {
      rollNow: ctx.render.camera.rotation.z,
      rollPeakDeg: Math.round(peak.roll * 180 / Math.PI * 1000) / 1000,
      fovPeak: Math.round(peak.fov * 100) / 100,
      frames: peak.n,
      speed: Math.round(ctx.player.speed * 100) / 100,
      state: ctx.player.state,
      pos: ctx.player.position.toArray().map(v => Math.round(v * 10) / 10),
    };
    peak.roll = 0;
    peak.fov = 0;
    peak.n = 0;
    return out;
  });

  const out = { bootSeconds: Math.round((Date.now() - started) / 1000) };
  await h.sleep(800);
  out.rest = await read();
  await shot('rest');

  for (const side of ['left', 'right']) {
    await key(side, true);
    await h.sleep(700);
    await shot(`strafe-${side}`);
    await key(side, false);
    out[`strafing_${side}`] = await read();
    await h.sleep(500);
    out[`after_${side}`] = await read();
  }

  await key('forward', true);
  await h.sleep(700);
  out.running = await read();
  await shot('run');
  await key('forward', false);
  await h.sleep(500);
  out.after_run = await read();

  // Real key events, not simulate: a tap of Space must jump, and holding it must jump once.
  const peakY = async ms => {
    await page.evaluate(() => {
      const { ctx } = window.__op2;
      window.__live.y0 = ctx.player.position.y;
      window.__live.jumps = 0;
      window.__live.off?.();
      window.__live.off = ctx.events.on('player:jumped', () => { window.__live.jumps++; });
      window.__live.top = 0;
      const follow = () => {
        window.__live.top = Math.max(window.__live.top, ctx.player.position.y - window.__live.y0);
        if (window.__live.y0 !== null) requestAnimationFrame(follow);
      };
      requestAnimationFrame(follow);
    });
    await h.sleep(ms);
    return page.evaluate(() => {
      const r = { top: Math.round(window.__live.top * 100) / 100, jumps: window.__live.jumps };
      window.__live.y0 = null;
      return r;
    });
  };
  await h.press('Space', 60);
  out.key_tap = await peakY(900);
  await page.keyboard.down('Space');
  out.key_hold_2s = await peakY(2000);
  await page.keyboard.up('Space');

  await page.evaluate(() => window.__op2.ctx.camera.addTrauma(1));
  await h.sleep(1000);
  out.after_shake = await read();
  await shot('settled');
  out.stats = await page.evaluate(() => window.__op2.stats());
  return out;
}
