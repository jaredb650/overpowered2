// Smoke proof for the kit itself: a party on a fresh browser profile reaches a live wave, with each page's frame rate, the
// renderer, and the network counters. The quickest check that the rig works.
//   node tools/shot.mjs --port <port> --w 1280 --h 720 --wait 500 --timeout 300 --script tools/scripts/coop-smoke.mjs --out tools/out/coop/<you>/smoke.png
//   COOP_NET=rtc (real WebRTC), COOP_PLAYERS=2..4, COOP_MODE=crucible|outpost|defense|campaign|foreclosure, COOP_MAP=office, COOP_SIM=lag:80,loss:0.03
import { writeFileSync } from 'node:fs';
import { kit, live, measure, startParty } from './coop-kit.mjs';

export default async function (host, { sleep, outDir }) {
  const out = { errors: [], checks: [], screenshots: [] };
  const players = Number(process.env.COOP_PLAYERS ?? 2);
  const mode = process.env.COOP_MODE ?? 'crucible', map = process.env.COOP_MAP || undefined;
  const tag = `smoke-${process.env.COOP_NET ?? 'loop'}-${mode}${map ? `-${map}` : ''}-${players}p`;
  const { check, progress, shot } = kit(outDir, tag, out, sleep);
  let party;
  try {
    out.renderer = await host.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2'); const e = gl?.getExtension('WEBGL_debug_renderer_info');
      return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown';
    });
    const started = Date.now();
    party = await startParty(host, { mode, map, players, net: process.env.COOP_SIM, out, progress, sleep });
    out.live = await live(party);
    out.secondsToFight = (Date.now() - started) / 1000;
    check(true, 'A fresh profile reaches the match: the host was not sent to Retraining');
    check(out.live.every(s => s.enemies > 0 && s.wave === out.live[0].wave), "The host's wave is on every screen", out.live.map(s => [s.wave, s.enemies]));
    const window = await measure(party, 5);
    out.fps = [window.host.fps, ...window.guests.map(g => g.fps)];
    out.net = window;
    check(window.guests.every(g => g.lanes.world?.in.packets > 0), 'Every guest is getting snapshots', window.guests.map(g => g.lanes.world?.in));
    check(window.guests.every(g => g.lanes.pose?.in.packets > 0) && window.host.lanes.pose?.in.packets > 0, 'Poses flow both ways', window.host.lanes.pose?.in);
    await shot(host, 'host'); await shot(party.guest, 'guest');
    check(out.errors.length === 0, 'No page exceptions', out.errors);
    return out;
  } catch (error) {
    out.failure = error.stack ?? String(error);
    throw error;
  } finally {
    writeFileSync(`${outDir}/${tag}-evidence.json`, JSON.stringify(out, null, 2));
    for (const guest of party?.guests ?? []) await guest.close().catch(() => {});
  }
}
