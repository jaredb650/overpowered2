// One quick look at the real game: boots /?autostart=1, walks forward and fires for a few seconds.
export default async function bootCheck(page, h) {
  const started = Date.now();
  let ready = false;
  while (!ready && Date.now() - started < 90000) {
    ready = await page.evaluate(() => window.__op2?.game?.state === 'playing');
    if (!ready) {
      const failed = await page.evaluate(() => document.body.innerText.includes('Boot failed'));
      if (failed) break;
      await h.sleep(1000);
    }
  }
  const bootSeconds = Math.round((Date.now() - started) / 1000);
  if (!ready) {
    await h.shot('fail');
    return { booted: false, bootSeconds, body: await page.evaluate(() => document.body.innerText.slice(0, 700)) };
  }
  await page.evaluate(() => {
    const { ctx } = window.__op2;
    ctx.input.simulate('forward', true);
    ctx.input.simulate('fire', true);
  });
  await h.sleep(5000);
  await h.shot('game');
  const state = await page.evaluate(() => {
    const { ctx, game } = window.__op2;
    const stub = s => { try { return String(s) .startsWith('stub') || typeof s === 'function' && !s.update && !s.init; } catch { return true; } };
    return {
      booted: true,
      state: game.state,
      stats: game.stats(),
      wave: ctx.waves?.wave,
      phase: ctx.waves?.phase,
      alive: ctx.enemies?.alive?.length,
      weapon: ctx.weapons?.current,
      ammo: ctx.weapons?.ammo?.(),
      pos: ctx.player?.position?.toArray?.(),
      hp: ctx.player?.health,
      score: ctx.progression?.score,
    };
  });
  return { bootSeconds, ...state };
}
