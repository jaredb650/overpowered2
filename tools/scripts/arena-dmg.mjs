import { ready } from './arena-lib.mjs';
export default async function (page, h) {
  await ready(page, h);
  await page.evaluate(() => {
    const a = window.__arena;
    window.__log = [];
    a.ctx.events.on('player:damaged', e => window.__log.push([+a.ctx.time.elapsed.toFixed(2), e.amount, e.type, a.enemies.alive.filter(x => x.attack).map(x => x.attack.name + ':' + x.attackPhase).join(',')]));
  });
  await h.sleep(6000);
  return await page.evaluate(() => ({ log: window.__log.slice(0, 30), s: window.__arena.stats() }));
}
