// The co-op baseline: a pair through a live Crucible wave with a scripted guest shooting, measured on a clean network and
// then on a bad one (lag 80 ms, jitter 30 ms, loss 3%, each way), and written as JSON. The numbers every later lane is
// compared against: frame rates, the gaps between enemy snapshots at the guest, bytes a second per lane, round trips, loss.
//
//   node tools/shot.mjs --port <port> --w 1280 --h 720 --wait 500 --timeout 300 \
//     --script tools/scripts/coop-baseline.mjs --out tools/out/coop/<you>/baseline.png
//   COOP_NET=rtc  the same over real WebRTC (also proves the unreliable data channel really carries the poses)
//   BASELINE_SECONDS=20 (per network), BASELINE_SIM=lag:80,jitter:30,loss:0.03, COOP_FPS=15 for a slow host
//
// Writes baseline-<transport>.json beside --out. `summary` in it is the short table; `clean` and `bad` are the full reads.
import { writeFileSync } from 'node:fs';
import { cpus, loadavg } from 'node:os';
import { kit, live, measure, rtcChannels, setNet, shootLoop, skipBreak, startPair, stopShooting } from './coop-kit.mjs';

const BAD = process.env.BASELINE_SIM ?? 'lag:80,jitter:30,loss:0.03';

/** The short table for one measuring window. */
function summarise(window) {
  const { host } = window, guest = window.guests[0];
  const lanes = side => Object.fromEntries(Object.entries(side.lanes).map(([name, lane]) => [name, {
    kind: lane.unreliable ? 'unreliable' : 'reliable', outBytesPerSecond: lane.out.bytesPerSecond, outPerSecond: lane.out.packetsPerSecond,
    ...(lane.unreliable ? { lossPercentIn: lane.lossPercent, fellBackToReliable: lane.fallback, skippedBehind: lane.skipped } : {}),
  }]));
  const rtt = side => Object.values(side.rtt)[0] ?? null;
  const trip = r => r && { unreliable: { p50: r.fast.p50, p90: r.fast.p90, max: r.fast.max, n: r.fast.n }, reliable: { p50: r.reliable.p50, p90: r.reliable.p90, max: r.reliable.max, n: r.reliable.n } };
  const gap = lane => lane && { p50: lane.gap.p50, p90: lane.gap.p90, max: lane.gap.max, perSecond: lane.in.packetsPerSecond };
  return {
    seconds: window.seconds,
    fps: { host: host.fps, guest: guest.fps },
    enemies: { host: host.enemies, guest: guest.enemies },
    snapshotGapAtGuestMs: gap(guest.lanes.world),
    poseGapAtGuestMs: gap(guest.lanes.pose),
    poseGapAtHostMs: gap(host.lanes.pose),
    eventGapAtGuestMs: gap(guest.lanes.action),
    hostOut: lanes(host), guestOut: lanes(guest),
    totalsBytesPerSecond: { hostOut: host.totals.outBytesPerSecond, guestOut: guest.totals.outBytesPerSecond },
    roundTripMs: { fromHost: trip(rtt(host)), fromGuest: trip(rtt(guest)) },
    unreliablePathUp: { host: Object.values(host.peers).every(p => p.fast), guest: Object.values(guest.peers).every(p => p.fast) },
    coopCostMs: { host: host.coopMs, guest: guest.coopMs },
    sim: { host: host.sim, guest: guest.sim },
  };
}

export default async function (host, { sleep, outDir }) {
  const transport = process.env.COOP_NET ?? 'loop';
  const seconds = Number(process.env.BASELINE_SECONDS ?? 20);
  const out = { transport, badNetwork: BAD, seconds, date: new Date().toISOString(), errors: [], checks: [], screenshots: [] };
  const { check, progress, shot } = kit(outDir, `baseline-${transport}`, out, sleep);
  let party;
  try {
    out.renderer = await host.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2'); const e = gl?.getExtension('WEBGL_debug_renderer_info');
      return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown';
    });
    out.viewport = { ...host.viewportSize(), dpr: await host.evaluate(() => window.devicePixelRatio) };
    party = await startPair(host, { mode: 'crucible', out, progress, sleep });
    const { guest } = party;
    await live(party, { enemies: 6 });
    await shootLoop(guest, { weapon: 'smg' });
    // The guest clears waves; the host never waits out a break, so there is always a fight to measure.
    const everySecond = () => skipBreak(host);
    const kills = () => guest.evaluate(() => window.__op2.ctx.progression.kills);
    const claims = () => host.evaluate(() => ({ accepted: window.__op2.ctx.coop.world.stats.accepted, rejected: window.__op2.ctx.coop.world.stats.rejected }));
    // Warm up: the first kills compile shaders and build pools, which stalls frames for a moment.
    await sleep(Number(process.env.BASELINE_WARMUP ?? 10) * 1000);

    for (const [name, net] of [['clean', 'off'], ['bad', BAD]]) {
      progress(`measuring ${seconds} s on a ${name} network`);
      for (const page of party.pages) await setNet(page, net);
      await sleep(1500);
      const before = { kills: await kills(), claims: await claims() };
      const window = await measure(party, seconds, { everySecond });
      const after = { kills: await kills(), claims: await claims() };
      out[name] = window;
      // How busy the machine was (1-minute load against its cores): other work on it shows in frame rates and in every p90.
      out[name].machine = { load1m: Math.round(loadavg()[0] * 10) / 10, cores: cpus().length };
      out[name].guestKills = after.kills - before.kills;
      out[name].hostClaims = { accepted: after.claims.accepted - before.claims.accepted, rejected: after.claims.rejected - before.claims.rejected };
      if (transport === 'rtc') out[name].rtcChannels = { host: await rtcChannels(host), guest: await rtcChannels(guest) };
      await shot(guest, `${name}-guest`);
    }
    await stopShooting(guest);
    for (const page of party.pages) await setNet(page, 'off');
    const short = window => ({ ...summarise(window), guestKills: window.guestKills, hostClaims: window.hostClaims, machine: window.machine });
    out.summary = { clean: short(out.clean), bad: short(out.bad) };

    const { clean, bad } = out.summary;
    check(clean.snapshotGapAtGuestMs?.perSecond > 5 && bad.snapshotGapAtGuestMs?.perSecond > 5, 'The guest gets snapshots on both networks', [clean.snapshotGapAtGuestMs, bad.snapshotGapAtGuestMs]);
    check(clean.unreliablePathUp.host && clean.unreliablePathUp.guest, 'The unreliable path is up both ways', clean.unreliablePathUp);
    check(clean.hostOut.pose.fellBackToReliable === 0 && clean.guestOut.pose.fellBackToReliable === 0, 'Poses travel on the unreliable lane, none by the reliable fallback', [clean.hostOut.pose, clean.guestOut.pose]);
    check(clean.hostOut.pose.lossPercentIn === 0 && clean.guestOut.pose.lossPercentIn === 0, 'A clean network loses no poses', [clean.hostOut.pose, clean.guestOut.pose]);
    check(bad.hostOut.pose.lossPercentIn > 0.5 && bad.hostOut.pose.lossPercentIn < 10, 'The bad network really loses unreliable packets, about the asked share', bad.hostOut.pose);
    check(bad.roundTripMs.fromGuest.unreliable.p50 >= 150, 'The bad network shows in the round trip', bad.roundTripMs.fromGuest);
    check(clean.guestKills > 0 && bad.guestKills > 0, "The guest's shots kill on both networks", [clean.guestKills, bad.guestKills]);
    if (transport === 'rtc') {
      const fast = out.bad.rtcChannels.guest['op2-fast'];
      check(fast?.messagesSent > 100 && fast.messagesReceived > 100, 'On real WebRTC the unreliable data channel carries the traffic both ways', out.bad.rtcChannels.guest);
    }
    check(out.errors.length === 0, 'No page exceptions', out.errors);
    return out;
  } catch (error) {
    out.failure = error.stack ?? String(error);
    throw error;
  } finally {
    writeFileSync(`${outDir}/baseline-${transport}.json`, JSON.stringify(out, null, 2));
    for (const guest of party?.guests ?? []) await guest.close().catch(() => {});
  }
}
