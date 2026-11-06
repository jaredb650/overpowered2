import { ready } from './arena-lib.mjs';
export default async function (page, h) {
  await ready(page, h);
  await h.sleep(2500);
  await page.evaluate(() => {
    const a = window.__arena;
    a.ctx.player.modifiers.invulnerable = true;
    const nav = a.ctx.world.nav;
    const points = a.ctx.world.spawnPoints.filter(s => s.kind === 'ground');
    const withPath = points.map(s => ({ s, d: nav.pathDistance(s.position) })).filter(x => Number.isFinite(x.d)).sort((p, q) => q.d - p.d);
    for (const f of withPath.slice(0, 12)) for (let i = 0; i < 2; i++) a.enemies.spawn('husk', f.s.position);
  });
  await h.sleep(26000);
  return await page.evaluate(() => {
    const a = window.__arena;
    const nav = a.ctx.world.nav;
    const v = a.ctx.player.position.clone();
    const out = [];
    for (const e of a.enemies.alive) {
      const d = nav.pathDistance(e.position);
      const flow = v.clone();
      const ok = nav.flowDirection(e.position, flow);
      const link = v.clone();
      const kind = nav.linkAhead(e.position, link, 3);
      const ahead = nav.groundHeight(e.position.x + flow.x * 0.5, e.position.y + 1.15, e.position.z + flow.z * 0.5);
      const here = nav.groundHeight(e.position.x, e.position.y + 1.15, e.position.z);
      out.push({ id: e.uid, pos: e.position.toArray().map(x => +x.toFixed(1)), d: Math.round(d), mode: e.mode, flowOk: ok, flow: [+flow.x.toFixed(2), +flow.z.toFixed(2)], kind, link: link.toArray().map(x => +x.toFixed(1)), ahead: +ahead.toFixed(2), here: +here.toFixed(2), air: e.airborne, b: e.behaviour?.name });
    }
    return { out: out.sort((p, q) => q.d - p.d) };
  });
}
