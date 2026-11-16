// Single player after co-op: the Crucible alone still pauses under its shop, pays its kills, slows time, and ends on death.
//   node tools/shot.mjs --port <port> --url "/?contract=crucible&autostart=1" --dpr 2 --w 1440 --h 900 --wait 4000 --timeout 300 \
//     --script tools/scripts/coop-solo-check.mjs --out tools/out/coop3/solo-final.png
import { writeFileSync } from 'node:fs';

export default async function (page, { sleep, outDir }) {
  const out = { checks: [] };
  const check = (ok, message, detail) => { if (!ok) throw new Error(`${message} :: ${JSON.stringify(detail)}`); out.checks.push(message); };
  try {
    await page.waitForFunction(() => window.__op2?.game?.state === 'playing' && window.__op2.ctx.enemies.alive.length > 0, null, { timeout: 120000 });
    const s0 = await page.evaluate(() => ({ coop: !!window.__op2.ctx.coop, credits: window.__op2.ctx.contracts.wallet?.credits, pickups: window.__op2.ctx.progression.pickups.length }));
    check(!s0.coop && s0.credits === 0, 'Solo: no co-op session, an empty purse at the start', s0);
    const kill = await page.evaluate(() => {
      const { ctx } = window.__op2; const e = ctx.enemies.alive[0];
      ctx.enemies.applyDamage(e, { amount: 9999, type: 'bullet', source: 'smg', point: e.center.clone(), dir: e.center.clone().sub(ctx.player.eye).normalize(), force: 10, region: 'head' });
      return { kills: ctx.progression.kills, credits: ctx.contracts.wallet.credits, score: ctx.progression.score };
    });
    check(kill.kills === 1 && kill.credits > 0 && kill.score > 0, 'Solo: a kill scores and pays', kill);
    const slow = await page.evaluate(async () => {
      const { ctx } = window.__op2; ctx.progression.grant('slowmo');
      await new Promise(r => setTimeout(r, 1200));
      return ctx.time.slowmo;
    });
    check(slow < 0.9, 'Solo: SLOWMO still slows the world', slow);
    const shop = await page.evaluate(async () => {
      const { ctx, game } = window.__op2; ctx.events.emit('shop:open', {});
      await new Promise(r => setTimeout(r, 300));
      return { state: game.state, paused: ctx.time.paused };
    });
    check(shop.state === 'paused' && shop.paused, 'Solo: the shop still pauses the run', shop);
    await page.evaluate(() => window.__op2.game.setState('playing'));
    await page.evaluate(() => window.__op2.ctx.player.takeDamage({ amount: 9999, type: 'true', source: 'husk' }));
    await page.waitForFunction(() => window.__op2.game.state === 'gameover' || document.querySelector('.scr-gameover')?.offsetParent, null, { timeout: 20000 });
    check(true, 'Solo: death still ends the run on the game over screen');
    await page.screenshot({ path: `${outDir}/solo-gameover.png` });
    return out;
  } finally {
    writeFileSync(`${outDir}/solo-evidence.json`, JSON.stringify(out, null, 2));
  }
}
