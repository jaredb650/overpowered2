// A weapon cache in a mode without the shop (a mission), shared (docs/notes/coop.md, "The shared world"): the host's game
// calls it (as a mission's own `weaponCache` hand-out does), every page flies the same pod at the same spot, each player walks in
// and gets their own share once, and the pod goes for everyone only when all have had theirs. Asserted on EVERY page.
//
//   node tools/shot.mjs --port <port> --w 1280 --h 720 --wait 500 --timeout 420 \
//     --script tools/scripts/coop-world-cache.mjs --out tools/out/coop/world-a/cache.png
//   COOP_MODE=campaign|foreclosure  COOP_PLAYERS=2|3  COOP_SIM=lag:120,jitter:40,loss:0.05
import { writeFileSync } from 'node:fs';
import { ahead, kit, live, startParty, teleport } from './coop-kit.mjs';

const pods = page => page.evaluate(() => {
  const set = window.__op2.ctx.progression.pods;
  return set.pods.filter(p => p.phase !== 'spent').map(p => ({ id: p.id, phase: p.phase, at: p.entry.position.toArray(), taken: p.taken, supply: set.supply, visible: p.group.visible }));
});
const guns = page => page.evaluate(() => [...window.__op2.ctx.weapons.owned].sort());

export default async function (host, { sleep, outDir }) {
  const out = { errors: [], checks: [], screenshots: [] };
  const players = Number(process.env.COOP_PLAYERS ?? 2);
  const mode = process.env.COOP_MODE ?? 'campaign', sim = process.env.COOP_SIM || undefined;
  const tag = `cache-${mode}-${players}p${sim ? '-lag' : ''}`;
  const { check, progress, shot } = kit(outDir, tag, out, sleep);
  let party;
  try {
    party = await startParty(host, { mode, players, net: sim, out, progress, sleep });
    await live(party, { enemies: 1 });
    const { pages } = party;
    const where = await Promise.all(pages.map(p => p.evaluate(() => ({ state: window.__op2.game.state, parked: !!window.__op2.ctx.player.parked, supply: window.__op2.ctx.progression.pods.supply }))));
    out.where = where;
    check(where.every(w => !w.supply), 'This mode has no shop: its pods are weapon caches', where);
    // The mission's opening (a briefing, a ride) is not what is being proven: everyone is put on foot, in play.
    for (const page of pages) await page.evaluate(() => { window.__op2.game.setState('playing'); });
    const spot = (await ahead(host, 14)).at;
    progress('the host calls a cache');
    await host.evaluate(at => { const { ctx } = window.__op2; ctx.progression.spawnPickup('weaponCache', new (ctx.player.position.constructor)(...at)); }, spot);
    for (const page of pages) await page.waitForFunction(() => window.__op2.ctx.progression.pods.pods.some(p => p.phase !== 'spent'), null, { timeout: 20000 });
    const called = await Promise.all(pages.map(pods));
    out.called = called;
    check(called.every(s => s.length === 1 && s[0].id === called[0][0].id && s[0].id > 0 && s[0].at.every((n, i) => n === called[0][0].at[i])),
      "Every page flies the host's cache, at the same spot", called.map(s => s[0]));
    // Everyone stands well clear until it is open.
    for (const [i, page] of pages.entries()) await teleport(page, [called[0][0].at[0] + 14 + i * 2, called[0][0].at[1], called[0][0].at[2] + 10], 0);
    for (const page of pages) await page.waitForFunction(() => window.__op2.ctx.progression.pods.pods.some(p => p.phase === 'open'), null, { timeout: 40000 });
    const before = await Promise.all(pages.map(guns));
    const at = called[0][0].at;
    // Each player in turn walks in. Their share is theirs; the pod stands for the rest.
    const order = [...pages.slice(1), pages[0]];
    for (const [n, page] of order.entries()) {
      const who = pages.indexOf(page);
      await teleport(page, at, 0);
      await page.waitForFunction(k => window.__op2.ctx.weapons.owned.size > k, before[who].length, { timeout: 20000 });
      await sleep(sim ? 900 : 400);
      const now = await Promise.all(pages.map(guns));
      const have = await Promise.all(pages.map(pods));
      const took = order.slice(0, n + 1).map(p => pages.indexOf(p));
      check(now.every((g, i) => g.length === before[i].length + (took.includes(i) ? 1 : 0)), `Player ${who} took their own share; nobody who has not walked in got anything`, now.map(g => g.length));
      if (n < order.length - 1) {
        check(have.every(s => s.length === 1 && s[0].phase === 'open'), 'The cache still stands on every page for those who have not had theirs', have.map(s => s[0]?.phase));
        check(have[who][0].taken, 'and is marked taken for the one who has');
        if (n === 0) { await teleport(page, [at[0] + 6, at[1], at[2] + 6], Math.PI / 4); await sleep(500); await shot(page, '1-cache-taken-still-standing'); }
        // Standing in it gives nothing more.
        await teleport(page, at, 0);
        await sleep(600);
        check((await guns(page)).length === before[who].length + 1, 'Standing in it again gives nothing more');
        await teleport(page, [at[0] + 14, at[1], at[2] + 10], 0);
      }
    }
    for (const page of pages) await page.waitForFunction(() => window.__op2.ctx.progression.pods.pods.every(p => p.phase === 'spent'), null, { timeout: 20000 });
    check(true, 'Once every player has had their share the cache is gone on every page');
    out.guns = { before, after: await Promise.all(pages.map(guns)) };
    check(out.errors.length === 0, 'No page exceptions', out.errors);
    return out;
  } catch (error) {
    out.failure = error.stack ?? String(error);
    for (const [i, page] of (party?.pages ?? []).entries()) await page.screenshot({ path: `${outDir}/${tag}-fail-${i}.png` }).catch(() => {});
    throw error;
  } finally {
    writeFileSync(`${outDir}/${tag}-evidence.json`, JSON.stringify(out, null, 2));
    for (const guest of party?.guests ?? []) await guest.close().catch(() => {});
  }
}
