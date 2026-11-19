// Team rules proof 5: single player is untouched. One page, no lobby: the Crucible's own break after a cleared wave is still
// the shop's 25 s (not the team's 45), the HUD still offers "L: START NOW", L still cuts it to 3 s on its own with "NEXT WAVE
// CALLED IN", the shop screen still says the clock waits "when you leave" and the run really is paused under it, and there is
// no co-op HUD on the page.
//   node tools/shot.mjs --port 5310 --url "/?contract=crucible&autostart=1" --dpr 2 --w 1440 --h 900 --wait 3000 --timeout 300 \
//     --script tools/scripts/coop-team-solo.mjs --out tools/out/team/solo-final.png
import { writeFileSync } from 'node:fs';

export default async function (page, { sleep, outDir }) {
  const out = { errors: [], checks: [], screenshots: [] };
  const check = (ok, message, detail) => { if (!ok) throw new Error(`${message}${detail === undefined ? '' : ` :: ${JSON.stringify(detail)}`}`); out.checks.push(message); };
  const until = (fn, arg, timeout = 60000) => page.waitForFunction(fn, arg, { timeout, polling: 250 });
  try {
    await until(() => window.__op2?.game?.state === 'playing' || window.__op2?.game?.state === 'paused', null, 120000);
    await page.evaluate(() => {
      const { ctx, game } = window.__op2;
      game.setState('playing');
      ctx.player.modifiers.invulnerable = true;
      window.__said = [];
      const feed = ctx.hud.feed.bind(ctx.hud);
      ctx.hud.feed = (text, color) => { window.__said.push(text); feed(text, color); };
      if (ctx.waves.phase === 'intermission') ctx.waves.nextWaveIn = 0.2;
    });
    check(await page.evaluate(() => !window.__op2.ctx.coop && !document.querySelector('.cq')), 'A solo page has no co-op session and no co-op HUD');
    await until(() => window.__op2.ctx.waves.wave >= 1 && window.__op2.ctx.waves.phase !== 'intermission');
    await page.evaluate(() => {
      const { ctx } = window.__op2; const waves = ctx.waves;
      for (const enemy of [...ctx.enemies.alive]) ctx.enemies.withdraw(enemy);
      waves.queueCursor = waves.queue.length; waves.bossIds.length = 0; ctx.enemies.queued = 0;
    });
    await until(() => window.__op2.ctx.waves.phase === 'intermission' && window.__op2.ctx.waves.nextWaveIn > 10);
    await sleep(400);
    const rest = await page.evaluate(() => ({ left: window.__op2.ctx.waves.nextWaveIn, hint: document.querySelector('.df-next')?.textContent ?? '' }));
    out.rest = rest;
    check(rest.left > 20 && rest.left <= 25.05, 'The solo break is the shop\'s own 25 s, not the team\'s 45', rest);
    check(/L: START NOW/.test(rest.hint), 'The HUD still offers L: START NOW', rest.hint);
    // The shop: the run waits under it, and the screen says so.
    await page.evaluate(() => window.__op2.ctx.events.emit('shop:open', {}));
    await page.locator('.scr-proc').waitFor({ state: 'visible', timeout: 15000 });
    const open = await page.evaluate(() => ({ text: document.querySelector('.pc-phase').textContent, left: window.__op2.ctx.waves.nextWaveIn, state: window.__op2.game.state, paused: window.__op2.ctx.time.paused }));
    await sleep(2500);
    const later = await page.evaluate(() => ({ text: document.querySelector('.pc-phase').textContent, left: window.__op2.ctx.waves.nextWaveIn }));
    out.shop = { open, later };
    check(/when you leave\.$/.test(open.text) && !/clock is running/.test(open.text), 'The solo shop screen still says the clock waits until you leave', open.text);
    check(open.paused === true && Math.abs(later.left - open.left) < 0.01, 'The run is paused under the solo shop: the break does not run down', { open: open.left, later: later.left });
    await page.screenshot({ path: `${outDir}/solo-shop.png` }); out.screenshots.push(`${outDir}/solo-shop.png`);
    await page.evaluate(() => window.__op2.game.setState('playing'));
    await sleep(300);
    await page.keyboard.press('KeyL');
    await until(() => window.__op2.ctx.waves.nextWaveIn <= 3.05, null, 10000);
    const said = await page.evaluate(() => window.__said);
    check(said.includes('NEXT WAVE CALLED IN') && !said.some(line => /ready \(/.test(line)), 'L alone still calls the next wave in, with the solo line and no vote', said.slice(-6));
  } catch (error) {
    out.errors.push(String(error?.stack ?? error));
    await page.screenshot({ path: `${outDir}/solo-fail.png` }).catch(() => {});
  }
  out.ok = out.errors.length === 0;
  writeFileSync(`${outDir}/solo.json`, JSON.stringify(out, null, 2));
  return { ok: out.ok, checks: out.checks.length, errors: out.errors };
}
