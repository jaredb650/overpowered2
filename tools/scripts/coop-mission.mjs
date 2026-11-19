// Stage 5 proof: campaign mission 1 (The Outpost) together. The host runs the mission; the guest hears and reads the same
// lines, gets the same objectives, and rides in on the door gun with the host.
//   node tools/shot.mjs --port 5294 --dpr 2 --w 1440 --h 900 --wait 500 --timeout 800 \
//     --script tools/scripts/coop-mission.mjs --out tools/out/coop3/mission-final.png
// Runs on the loopback transport by default (fast, offline); COOP_NET=rtc runs it over real WebRTC. See coop-kit.mjs.
import { writeFileSync } from 'node:fs';
import { inMatch, kit, startPair, state } from './coop-kit.mjs';

export default async function (host, { sleep, outDir }) {
  const out = { errors: [], checks: [], screenshots: [], timeline: [] };
  const { check, progress, shot } = kit(outDir, 'mission', out, sleep);
  const look = page => page.evaluate(() => {
    const { ctx } = window.__op2;
    const c = window.__op2.campaign ?? ctx.campaign;
    return { objectives: document.querySelector('.ms-objs')?.textContent ?? '', line: document.querySelector('.ms-line, .ms-say, .ms-sub')?.textContent ?? '',
      parked: ctx.player.parked, beat: c?.runner?.beat?.title ?? null, mirrored: ctx.coop?.world?.mission?.mirrored ?? 0, running: c?.runner?.state ?? null, enemies: ctx.enemies.alive.length };
  });
  let guest;
  try {
    ({ guest } = await startPair(host, { mode: 'Mission 1: The Outpost', password: 'coop-mission', out, progress, sleep }));
    await inMatch([host, guest], 'campaign', false);
    progress('both in mission 1');
    for (const page of [host, guest]) await page.evaluate(() => { window.__op2.ctx.player.modifiers.invulnerable = true; });
    // Watch the opening play out on both.
    for (let i = 0; i < 30; i++) {
      await sleep(4000);
      out.timeline.push({ t: (i + 1) * 4, host: await look(host), guest: await look(guest) });
      if (i === 3) { await shot(host, 'opening-host', true); await shot(guest, 'opening-guest', true); }
      if (out.timeline.at(-1).host.beat === 'Door gunner' && !out.rideShot && (out.rideWait = (out.rideWait ?? 0) + 1) > 2) { out.rideShot = true; await shot(guest, 'ride-guest', true); await shot(host, 'ride-host', true); }
    }
    const last = out.timeline.at(-1);
    check(last.host.running === 'running', 'mission 1: the host runs the mission', last.host);
    check(last.guest.running !== 'running', "mission 1: the guest's own runner never starts", last.guest);
    check(last.guest.mirrored > 5, "mission 1: the host's lines, music and cutscene play on the guest", last.guest);
    check(out.timeline.some(t => t.guest.objectives && t.guest.objectives === t.host.objectives),
      "mission 1: the guest's objectives are the host's", out.timeline.map(t => [t.host.objectives, t.guest.objectives]));
    check(out.timeline.some(t => t.guest.parked) === out.timeline.some(t => t.host.parked), 'mission 1: whoever rides, everyone rides the door gun in',
      out.timeline.map(t => [t.host.parked, t.guest.parked]));
    await shot(host, 'later-host', true); await shot(guest, 'later-guest', true);
    out.final = { host: await state(host), guest: await state(guest) };
    check(out.errors.length === 0, 'mission 1: no page exceptions', out.errors);
    return out;
  } catch (error) {
    out.failure = error.stack ?? String(error);
    throw error;
  } finally {
    writeFileSync(`${outDir}/mission-evidence.json`, JSON.stringify(out, null, 2));
    await guest?.close();
  }
}
