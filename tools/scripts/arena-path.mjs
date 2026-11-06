import { ready } from './arena-lib.mjs';
// Spawns a crowd from far away by path, then samples positions to see whether it arrives without getting stuck.
export default async function (page, h) {
  await ready(page, h);
  await h.sleep(2500);
  const out = await page.evaluate(() => {
    const a = window.__arena;
    a.ctx.player.modifiers.invulnerable = true;
    const nav = a.ctx.world.nav;
    const points = a.ctx.world.spawnPoints.filter(s => s.kind === 'ground');
    const withPath = points.map(s => ({ s, d: nav.pathDistance(s.position) })).filter(x => Number.isFinite(x.d)).sort((p, q) => q.d - p.d);
    const far = withPath.slice(0, 12);
    let n = 0;
    for (const f of far) for (let i = 0; i < 3; i++) { const e = a.enemies.spawn('husk', f.s.position); if (e) n++; }
    window.__track = [];
    return { spawned: n, points: points.length, maxPath: withPath[0]?.d, minPath: withPath[withPath.length - 1]?.d, player: a.ctx.player.position.toArray(), zones: far.map(f => f.s.zone) };
  });
  const samples = [];
  for (let i = 0; i < 12; i++) {
    await h.sleep(2500);
    samples.push(await page.evaluate(() => {
      const a = window.__arena;
      const nav = a.ctx.world.nav;
      const d = a.enemies.alive.map(e => Math.round(nav.pathDistance(e.position)));
      const air = a.enemies.alive.filter(e => e.airborne).length;
      const fl = a.enemies.alive.filter(e => e.flowUntil > a.ctx.time.elapsed).length;
      return { n: d.length, maxPath: Math.max(...d), med: d.sort((x, y) => x - y)[Math.floor(d.length / 2)], air, fl, fps: a.stats().fps };
    }));
    if (i === 3) await h.shot('mid');
  }
  return { out, samples };
}
