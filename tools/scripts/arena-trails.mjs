import { ready } from './arena-lib.mjs';
import { writeFileSync } from 'node:fs';
// Spawns a mix and records trails plus the behaviour each enemy is in. Writes JSON for plotting.
const q = new URLSearchParams(process.env.ARENA_Q ?? '');
export default async function (page, h) {
  await ready(page, h);
  await h.sleep(2000);
  await page.evaluate((args) => {
    const a = window.__arena;
    a.ctx.player.modifiers.invulnerable = true;
    window.__trails = {};
    window.__behav = {};
    const ids = args.ids.split(',');
    const dist = args.dist;
    for (let i = 0; i < args.count; i++) a.spawn(ids[i % ids.length], dist, (i / args.count) * 1.6 + 0.4);
    window.__sample = () => {
      for (const e of a.enemies.alive) {
        const t = (window.__trails[e.uid] ??= { id: e.id, pts: [] });
        t.pts.push([+e.position.x.toFixed(2), +e.position.z.toFixed(2), e.behaviour?.name ?? '-', e.attack?.name ?? '', e.hasLos ? 1 : 0]);
      }
    };
  }, { ids: q.get('ids') ?? 'trooper', count: Number(q.get('count') ?? 6), dist: Number(q.get('dist') ?? 40) });
  const n = Number(q.get('samples') ?? 40);
  for (let i = 0; i < n; i++) {
    await page.evaluate(() => window.__sample());
    await h.sleep(300);
    if (i === Math.floor(n * 0.5)) await h.shot('mid');
  }
  const out = await page.evaluate(() => ({ trails: window.__trails, player: window.__arena.ctx.player.position.toArray(), stats: window.__arena.stats() }));
  writeFileSync(`tools/out/trails.json`, JSON.stringify(out));
  const summary = {};
  for (const t of Object.values(out.trails)) for (const p of t.pts) summary[p[2]] = (summary[p[2]] ?? 0) + 1;
  return { summary, stats: out.stats };
}
