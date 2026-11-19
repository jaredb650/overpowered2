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
const begin = page => page.evaluate(() => { window.__op2.net.metrics.reset(); });
const read = page => page.evaluate(() => {
  const { ctx } = window.__op2, net = window.__op2.net.snapshot();
  const action = net.lanes.action, world = net.lanes.world;
  return { fps: window.__op2.stats().fps, seconds: net.seconds, enemies: ctx.enemies.alive.length,
    actionIn: action ? { perSecond: action.in.packetsPerSecond, bytesPerSecond: action.in.bytesPerSecond, gapP50: action.gap.p50, gapP90: action.gap.p90, gapMax: action.gap.max } : null,
    worldIn: world ? { perSecond: world.in.packetsPerSecond, gapP90: world.gap.p90 } : null,
    // Its own hit claims sent in the window: it is still fighting.
    hits: net.events.hit?.out.n ?? 0, shots: net.events.fire?.out.n ?? 0, state: ctx.coop.lobby.me?.state ?? 'in',
    line: document.querySelector('.cs-line')?.textContent ?? '', saidBehind: !!window.__saidBehind, lines: window.__lines ?? [] };
});
/** The host's view of one guest: what is queued for it, what the rule says, and the seat. */
const hostView = (host, id) => host.evaluate(id => {
  const { ctx } = window.__op2, lobby = ctx.coop.lobby, net = window.__op2.net.snapshot();
  const player = lobby.players.find(p => p.id === id);
  return { queued: net.peers[id]?.bufferedReliable ?? 0, verdict: lobby.pressure.of(id), dropped: lobby.pressure.stats.dropped, stalls: lobby.pressure.stats.stalls,
    seat: player ? (player.state ?? 'in') : 'gone', away: !!player?.away, fps: window.__op2.stats().fps, simPending: net.sim.pending,
    saidBehind: lobby.chat.filter(c => /fell behind/.test(c.text)).length,
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
    // The squeezed guest's own screen is watched from the start: its notice may only show for a moment.
    // Every distinct status line the slow guest's screen shows, with when (so a run that never says "fell behind" shows what it said instead).
    await slow.evaluate(() => {
      window.__lines = [];
      setInterval(() => {
        const el = document.querySelector('.cs-line'), text = el && el.style.display !== 'none' ? (el.textContent ?? '').replace(/\d+/g, 'N') : '';
        if (/fell behind/i.test(text)) window.__saidBehind = true;
        if (window.__lines.at(-1)?.[1] !== text && window.__lines.length < 60) window.__lines.push([Math.round(performance.now()), text]);
      }, 30);
    });
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

    // 3. Held out: nothing more is queued for it (its queue only drains), and the other two play on as before. The link is
    // let go at once; what is queued still leaves at the squeezed speed, so the guest is out for as long as that takes.
    progress('the guest is held out; the link is let go; the others play on');
    await host.evaluate(id => window.__op2.net.sim.throttle(id, 0), slowId);
    const atCut = await hostView(host, slowId);
    let grew = 0, last = atCut.queued, back = null;
    for (let i = 0; i < 240 && !back; i++) {
      await sleep(500);
      if (i % 2 === 0) await skipBreak(host);
      const view = await hostView(host, slowId);
      out.timeline.push({ at: Date.now() - started, queued: view.queued, verdict: view.verdict, seat: view.seat });
      if (view.seat === 'lost') { grew = Math.max(grew, view.queued - last); last = Math.min(last, view.queued); peak = Math.max(peak, view.queued); }
      else if (view.seat === 'in') back = { at: Date.now() - started, chat: view.chat };
    }
    out.held = { atCut, peak, grewWhileOut: grew, back, others: await Promise.all(others.map(read)) };
    check(peak < STALLED_BYTES + 16 * 1024, `The host never queued more than the stalled mark for it (peak ${Math.round(peak / 1024)} KB)`, peak);
    // The lobby still pings it and sends it the list: a few hundred bytes, never the game.
    check(grew < 2048, 'While it was held out nothing of the game was queued for it: its queue only drained', { grew, atCut: atCut.queued });
    check(!!back, 'Once its queue has drained the guest is back in the match', out.timeline.slice(-6));
    out.others = out.held.others.map((now, i) => ({ before: out.healthy.others[i], during: now }));
    for (const [i, o] of out.others.entries()) {
      check(o.during.fps >= o.before.fps * 0.8 - 2, `Guest ${i + 1} kept its frame rate through the other's stall`, [o.before.fps, o.during.fps]);
      check(o.during.actionIn.gapP90 <= o.before.actionIn.gapP90 * 2 + 25, `Guest ${i + 1} kept getting events as often`, [o.before.actionIn, o.during.actionIn]);
      check(o.during.worldIn.perSecond >= o.before.worldIn.perSecond * 0.75, `Guest ${i + 1} kept getting snapshots`, [o.before.worldIn, o.during.worldIn]);
      check(o.during.hits > 0 || o.during.shots > 0, `Guest ${i + 1} kept fighting`, o.during);
    }
    const hostNow = await hostView(host, slowId);
    check(hostNow.fps >= out.healthy.host.fps * 0.8 - 2, 'The host kept its frame rate', [out.healthy.host.fps, hostNow.fps]);
    await shot(others[0], 'other-guest');

    // 4. Back, with the world as it is now, and healthy from here on.
    progress('the guest is back');
    for (const page of party.pages) await begin(page);
    for (let i = 0; i < 8; i++) { await sleep(1000); await skipBreak(host); }
    out.after = { host: await hostView(host, slowId), slow: await read(slow), hostEnemies: await host.evaluate(() => window.__op2.ctx.enemies.alive.length) };
    check(out.after.slow.state === 'in' && out.after.slow.actionIn?.perSecond > 5 && out.after.slow.worldIn?.perSecond > 5, 'It gets events and snapshots again', out.after.slow);
    check(Math.abs(out.after.slow.enemies - out.after.hostEnemies) <= 8, 'Its world is the host\'s again', [out.after.slow.enemies, out.after.hostEnemies]);
    check(out.after.host.verdict === 'ok' && out.after.host.stalls === 1 && out.after.host.saidBehind === 1 && out.after.host.seat === 'in', 'It is judged healthy and was cut once, not again', out.after.host);
    check(out.after.host.chat.some(text => /is back|reconnected/.test(text)), 'The lobby says it is back', out.after.host.chat);
    check(out.after.slow.saidBehind, 'While held out, its own screen said its connection had fallen behind', out.after.slow);
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
