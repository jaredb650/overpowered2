// Backpressure on the reliable lane, proven: four players in the heaviest fight, and the host's link to ONE guest squeezed
// until that guest cannot keep up. The host must first leave the cosmetics out for it, then cut it, never queue for it
// without bound, and bring it back with the world caught up once the link is let go. The other two guests must not notice.
//
//   node tools/shot.mjs --port <port> --w 960 --h 540 --wait 500 --timeout 600 \
//     --script tools/scripts/coop-wire-stall.mjs --out tools/out/coop/<you>/stall.png
//   STALL_KBPS=16 the squeezed link (kbit/s)   STALL_PLAYERS=4   COOP_NET=rtc is not supported (the squeeze is the simulator's)
//
// Writes stall.json beside --out.
import { writeFileSync } from 'node:fs';
import { cpus, loadavg } from 'node:os';
import { kit, live, skipBreak, startParty, stopShooting } from './coop-kit.mjs';
import { heavyFight, stopFill } from './coop-wire-kit.mjs';

const KBPS = Number(process.env.STALL_KBPS ?? 16);
const PLAYERS = Number(process.env.STALL_PLAYERS ?? 4);
// src/net/pressure.ts
const SLOW_BYTES = 16 * 1024, STALLED_BYTES = 128 * 1024;

/** One page's reading over a window: its frame rate, the events it got, the gaps between them, its kills. */
const begin = page => page.evaluate(() => { window.__op2.net.metrics.reset(); window.__stallKills = window.__op2.ctx.progression.kills; });
const read = page => page.evaluate(() => {
  const { ctx } = window.__op2, net = window.__op2.net.snapshot();
  const action = net.lanes.action, world = net.lanes.world;
  return { fps: window.__op2.stats().fps, seconds: net.seconds, enemies: ctx.enemies.alive.length,
    actionIn: action ? { perSecond: action.in.packetsPerSecond, bytesPerSecond: action.in.bytesPerSecond, gapP50: action.gap.p50, gapP90: action.gap.p90, gapMax: action.gap.max } : null,
    worldIn: world ? { perSecond: world.in.packetsPerSecond, gapP90: world.gap.p90 } : null,
    kills: ctx.progression.kills - (window.__stallKills ?? 0), state: ctx.coop.lobby.me?.state ?? 'in',
    line: document.querySelector('.cs-line')?.textContent ?? '' };
});
/** The host's view of one guest: what is queued for it, what the rule says, and the seat. */
const hostView = (host, id) => host.evaluate(id => {
  const { ctx } = window.__op2, lobby = ctx.coop.lobby, net = window.__op2.net.snapshot();
  const player = lobby.players.find(p => p.id === id);
  return { queued: net.peers[id]?.bufferedReliable ?? 0, verdict: lobby.pressure.of(id), dropped: lobby.pressure.stats.dropped, stalls: lobby.pressure.stats.stalls,
    seat: player ? (player.state ?? 'in') : 'gone', away: !!player?.away, fps: window.__op2.stats().fps, simPending: net.sim.pending,
    heapMB: Math.round((performance.memory?.usedJSHeapSize ?? 0) / 1048576), chat: lobby.chat.slice(-4).map(c => c.text) };
}, id);

export default async function (host, { sleep, outDir }) {
  const out = { kbps: KBPS, players: PLAYERS, date: new Date().toISOString(), errors: [], checks: [], screenshots: [], timeline: [] };
  const { check, progress, shot } = kit(outDir, 'stall', out, sleep);
  let party;
  try {
    party = await startParty(host, { mode: 'crucible', players: PLAYERS, out, progress, sleep });
    await live(party, { enemies: 6 });
    await heavyFight(party);
    const slow = party.guests.at(-1), others = party.guests.slice(0, -1);
    const slowId = await slow.evaluate(() => window.__op2.ctx.coop.lobby.you);
    for (let i = 0; i < 10; i++) { await sleep(1000); await skipBreak(host); }

    // 1. Everyone healthy: the numbers the other guests must keep.
    progress('a healthy window');
    for (const page of party.pages) await begin(page);
    for (let i = 0; i < 8; i++) { await sleep(1000); await skipBreak(host); }
    out.healthy = { host: await hostView(host, slowId), others: await Promise.all(others.map(read)), slow: await read(slow) };
    check(out.healthy.host.verdict === 'ok' && out.healthy.host.dropped === 0, 'With every link healthy nothing is left out for anyone', out.healthy.host);

    // 2. The squeeze. The cosmetics go first, then the guest is cut; the queue never passes the stalled mark by much.
    progress(`the host's link to one guest at ${KBPS} kbit/s`);
    await host.evaluate(([id, kbps]) => window.__op2.net.sim.throttle(id, kbps), [slowId, KBPS]);
    for (const page of party.pages) await begin(page);
    let sawSlow = null, cut = null, peak = 0;
    const started = Date.now();
    for (let i = 0; i < 90 && !cut; i++) {
      await sleep(500);
      if (i % 2 === 0) await skipBreak(host);
      const view = await hostView(host, slowId);
      peak = Math.max(peak, view.queued);
      out.timeline.push({ at: Date.now() - started, queued: view.queued, verdict: view.verdict, dropped: view.dropped, seat: view.seat });
      if (!sawSlow && view.verdict === 'slow') sawSlow = { at: Date.now() - started, queued: view.queued };
      if (view.seat === 'lost') cut = { at: Date.now() - started, queued: view.queued, dropped: view.dropped, chat: view.chat };
    }
    out.slowAt = sawSlow; out.cutAt = cut;
    check(!!sawSlow && sawSlow.queued > SLOW_BYTES * 0.9, 'Past the slow mark the guest is judged slow', { sawSlow, timeline: out.timeline.slice(0, 12) });
    check(!!cut, 'A guest whose link cannot carry the facts is cut', out.timeline.slice(-6));
    check(cut.dropped > 0, 'Before the cut, cosmetic events were left out for it', cut);
    check(cut.chat.some(text => /fell behind/.test(text)), 'The lobby says who fell behind, and why', cut.chat);

    // 3. Held out: nothing more is queued for it, and the other two play on as before.
    progress('the guest is held out; the others play on');
    const atCut = await hostView(host, slowId);
    for (let i = 0; i < 10; i++) { await sleep(1000); await skipBreak(host); const view = await hostView(host, slowId); peak = Math.max(peak, view.queued); out.timeline.push({ at: Date.now() - started, queued: view.queued, verdict: view.verdict, seat: view.seat }); }
    const later = await hostView(host, slowId);
    out.held = { atCut, later, peak, others: await Promise.all(others.map(read)) };
    check(peak < STALLED_BYTES + 32 * 1024, `The host never queued more than the stalled mark for it (peak ${Math.round(peak / 1024)} KB)`, peak);
    check(later.queued < atCut.queued, 'After the cut its queue only drains', { atCut: atCut.queued, later: later.queued });
    out.others = out.held.others.map((now, i) => ({ before: out.healthy.others[i], during: now }));
    for (const [i, o] of out.others.entries()) {
      check(o.during.fps >= o.before.fps * 0.8 - 2, `Guest ${i + 1} kept its frame rate through the other's stall`, [o.before.fps, o.during.fps]);
      check(o.during.actionIn.gapP90 <= o.before.actionIn.gapP90 * 2 + 25, `Guest ${i + 1} kept getting events as often`, [o.before.actionIn, o.during.actionIn]);
      check(o.during.worldIn.perSecond >= o.before.worldIn.perSecond * 0.75, `Guest ${i + 1} kept getting snapshots`, [o.before.worldIn, o.during.worldIn]);
      check(o.during.kills > 0, `Guest ${i + 1} kept killing`, o.during.kills);
    }
    check(later.fps >= out.healthy.host.fps * 0.8 - 2, 'The host kept its frame rate', [out.healthy.host.fps, later.fps]);
    await shot(others[0], 'other-guest');

    // 4. The link is let go. The queue drains, the guest is told, and it is back with the world as it is now.
    progress('the link is let go');
    await host.evaluate(id => window.__op2.net.sim.throttle(id, 0), slowId);
    const toldLine = await slow.waitForFunction(() => /fell behind/.test(document.querySelector('.cs-line')?.textContent ?? ''), null, { timeout: 120000 }).then(() => true, () => false);
    out.slowScreenSaid = toldLine;
    await shot(slow, 'held-out');
    const back = await host.waitForFunction(id => { const p = window.__op2.ctx.coop.lobby.players.find(x => x.id === id); return !!p && !p.state && !p.away; }, slowId, { timeout: 150000 }).then(() => true, () => false);
    check(back, 'Once its queue has drained the guest is back in the match', await hostView(host, slowId));
    for (const page of party.pages) await begin(page);
    for (let i = 0; i < 6; i++) { await sleep(1000); await skipBreak(host); }
    out.after = { host: await hostView(host, slowId), slow: await read(slow), hostEnemies: await host.evaluate(() => window.__op2.ctx.enemies.alive.length) };
    check(out.after.slow.state === 'in' && out.after.slow.actionIn?.perSecond > 5 && out.after.slow.worldIn?.perSecond > 5, 'It gets events and snapshots again', out.after.slow);
    check(Math.abs(out.after.slow.enemies - out.after.hostEnemies) <= 8, 'Its world is the host\'s again', [out.after.slow.enemies, out.after.hostEnemies]);
    check(out.after.host.verdict === 'ok', 'And it is judged healthy', out.after.host);
    check(toldLine, 'While held out, its own screen said its connection had fallen behind', out.after.slow);
    await shot(slow, 'back');
    out.machine = { load1m: Math.round(loadavg()[0] * 10) / 10, cores: cpus().length };
    for (const page of party.pages) await stopShooting(page).catch(() => {});
    await stopFill(host);
    check(out.errors.length === 0, 'No page exceptions', out.errors);
    return out;
  } catch (error) {
    out.failure = error.stack ?? String(error);
    throw error;
  } finally {
    writeFileSync(`${outDir}/stall.json`, JSON.stringify(out, null, 2));
    for (const guest of party?.guests ?? []) await guest.close().catch(() => {});
  }
}
