// The guest-to-guest path, measured: what one guest sees of another goes through the host (one more hop). How long does a
// shot (`fire`, reliable) and a pose (unreliable) take from guest A's page to the host's and to guest B's, on a clean
// network and with 40 ms added to everything each page sends?
//
//   node tools/shot.mjs --port <port> --w 960 --h 540 --wait 500 --timeout 420 \
//     --script tools/scripts/coop-wire-relay.mjs --out tools/out/coop/<you>/relay.png
//   RELAY_LAG=40   RELAY_SECONDS=12   loopback only: the pages' clocks are compared, which needs one machine
//
// Writes relay.json beside --out. Each row: milliseconds from A's send to the arrival, p50 / p90 / max, and how many.
import { writeFileSync } from 'node:fs';
import { cpus, loadavg } from 'node:os';
import { kit, live, setNet, skipBreak, startParty, stopShooting } from './coop-kit.mjs';
import { fill, gunLoop, steady, stopFill } from './coop-wire-kit.mjs';

const LAG = Number(process.env.RELAY_LAG ?? 40);
const SECONDS = Number(process.env.RELAY_SECONDS ?? 12);

/** In a page: note when A's shots and poses leave (role 'a') or arrive (the host, and guest B). Times are wall-clock ms. */
const tap = (page, role, aId) => page.evaluate(([role, aId]) => {
  const { ctx } = window.__op2, lobby = ctx.coop.lobby, w = ctx.coop.world.w;
  const wall = () => performance.timeOrigin + performance.now();
  const key = e => `${e.origin?.join(',')}|${e.dir?.join(',')}`;
  const rec = window.__relay = { fire: [], pose: [] };
  if (role === 'a') {
    const send = w.send.bind(w);
    w.send = (event, to) => { if (event.t === 'fire') rec.fire.push([wall(), key(event)]); return send(event, to); };
    const sendPose = lobby.sendPose.bind(lobby);
    lobby.sendPose = pose => { rec.pose.push([wall(), pose.seq]); return sendPose(pose); };
    return;
  }
  const side = role === 'host' ? w.router.hostSide : w.router.guestSide;
  const handler = side.get('fire');
  side.set('fire', (event, from, now) => { rec.fire.push([wall(), key(event)]); return handler(event, from, now); });
  const onPose = lobby.onPose;
  lobby.onPose = (id, pose) => { if (id === aId) rec.pose.push([wall(), pose.seq]); return onPose(id, pose); };
}, [role, aId]);
const clear = page => page.evaluate(() => { window.__relay.fire.length = 0; window.__relay.pose.length = 0; });
const take = page => page.evaluate(() => window.__relay);

function delays(sent, got) {
  const at = new Map(sent.map(([t, k]) => [k, t]));
  const ms = got.map(([t, k]) => at.has(k) ? t - at.get(k) : null).filter(v => v !== null && v >= 0 && v < 5000).sort((x, y) => x - y);
  const q = p => ms.length ? Math.round(ms[Math.min(ms.length - 1, Math.floor(p * ms.length))] * 10) / 10 : null;
  return { n: ms.length, p50: q(0.5), p90: q(0.9), max: q(1) };
}

export default async function (host, { sleep, outDir }) {
  const out = { lag: LAG, seconds: SECONDS, date: new Date().toISOString(), errors: [], checks: [], screenshots: [] };
  const { check, progress } = kit(outDir, 'relay', out, sleep);
  let party;
  try {
    party = await startParty(host, { mode: 'crucible', players: 3, out, progress, sleep });
    await live(party, { enemies: 6 });
    await fill(host, 24);
    for (const page of party.pages) await steady(page);
    const [a, b] = party.guests;
    const aId = await a.evaluate(() => window.__op2.ctx.coop.lobby.you);
    await gunLoop(a, 'smg', 'hold');
    await tap(a, 'a', aId); await tap(host, 'host', aId); await tap(b, 'b', aId);
    for (let i = 0; i < 6; i++) { await sleep(1000); await skipBreak(host); }
    for (const [name, net] of [['clean', 'off'], [`lag ${LAG} ms each send`, `lag:${LAG}`]]) {
      progress(`measuring ${SECONDS} s, ${name}`);
      for (const page of party.pages) await setNet(page, net);
      await sleep(1500);
      for (const page of party.pages) await clear(page);
      for (let i = 0; i < SECONDS; i++) { await sleep(1000); await skipBreak(host); }
      // Let the last ones land before reading.
      await sleep(600);
      const [sa, sh, sb] = await Promise.all([take(a), take(host), take(b)]);
      const fps = await Promise.all(party.pages.map(page => page.evaluate(() => window.__op2.stats().fps)));
      out[name === 'clean' ? 'clean' : 'lagged'] = { fps,
        fire: { toHost: delays(sa.fire, sh.fire), toGuest: delays(sa.fire, sb.fire) },
        pose: { toHost: delays(sa.pose, sh.pose), toGuest: delays(sa.pose, sb.pose) } };
    }
    for (const page of party.pages) await setNet(page, 'off');
    await stopShooting(a); await stopFill(host);
    out.machine = { load1m: Math.round(loadavg()[0] * 10) / 10, cores: cpus().length };
    const { clean, lagged } = out;
    check(clean.fire.toGuest.n > 20 && clean.pose.toGuest.n > 100, 'Shots and poses of one guest reach the other', clean);
    // What the hop through the host adds on top of the two links: the host's own handling of it.
    out.relayCostMs = { fire: Math.round((clean.fire.toGuest.p50 - clean.fire.toHost.p50) * 10) / 10, pose: Math.round((clean.pose.toGuest.p50 - clean.pose.toHost.p50) * 10) / 10 };
    check(lagged.fire.toGuest.p50 >= LAG * 1.6 && lagged.fire.toGuest.p50 < LAG * 2 + 60, 'With lag on every link a relayed shot takes two links\' worth', lagged.fire);
    check(out.errors.length === 0, 'No page exceptions', out.errors);
    return out;
  } catch (error) {
    out.failure = error.stack ?? String(error);
    throw error;
  } finally {
    writeFileSync(`${outDir}/relay.json`, JSON.stringify(out, null, 2));
    for (const guest of party?.guests ?? []) await guest.close().catch(() => {});
  }
}
