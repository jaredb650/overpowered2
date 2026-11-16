// Robustness proof, the Crucible: 150-300 ms of lag with 5% resend stalls on every message both ways (a kill and the
// team still work), bandwidth and the cost of co-op itself, a guest's tab dying mid-wave and the guest rejoining the
// match in progress by the invite link (credits restored), and a guest stepping out to the lobby and back in.
//   node tools/shot.mjs --port 5294 --dpr 2 --w 1440 --h 900 --wait 500 --timeout 900 \
//     --script tools/scripts/coop-robust.mjs --out tools/out/coop3/robust-final.png
import { writeFileSync } from 'node:fs';
import { aimAt, button, calm, dummy, harness, inMatch, joinFromSplash, kit, quiet, startPair, state, traffic } from './coop-kit.mjs';

export default async function (host, { sleep, outDir }) {
  const out = { errors: [], checks: [], screenshots: [] };
  const { check, progress, shot } = kit(outDir, 'robust', out, sleep);
  let guest, invite;
  const lag = (page, net) => page.evaluate(net => { window.__coopNet = net; }, net);
  try {
    ({ guest, invite } = await startPair(host, { mode: 'The Crucible', password: 'coop-robust', out, progress, sleep }));
    await inMatch([host, guest], 'crucible');
    for (const page of [host, guest]) await page.evaluate(() => { window.__op2.ctx.player.modifiers.invulnerable = true; });
    await guest.waitForFunction(() => window.__op2.ctx.enemies.alive.length >= 12, null, { timeout: 90000 });

    progress('a live wave under 150-300 ms lag and resend stalls');
    const net = process.env.SKIP_LAG ? { lag: 0, jitter: 0, stall: 0 } : { lag: 150, jitter: 150, stall: 0.05 };
    await lag(host, net); await lag(guest, net);
    await host.evaluate(() => {
      const { ctx } = window.__op2; const enemy = ctx.enemies.alive[0];
      const delta = enemy.center.clone().sub(ctx.player.eye);
      ctx.player.yaw = Math.atan2(-delta.x, -delta.z); ctx.player.pitch = Math.atan2(delta.y, Math.hypot(delta.x, delta.z));
      ctx.weapons.refillMagazines(); ctx.input.simulate('fire', true);
    });
    const start = { host: await traffic(host), guest: await traffic(guest) };
    await sleep(process.env.SKIP_LAG ? 1000 : 15000);
    await host.evaluate(() => window.__op2.ctx.input.simulate('fire', false));
    const end = { host: await traffic(host), guest: await traffic(guest) };
    const seconds = (end.host.time - start.host.time) / 1000;
    const perf = await host.evaluate(() => ({ game: window.__op2.stats(), coopMs: window.__op2.ctx.coop.cpuMs }));
    out.bandwidth = { seconds, enemies: [start.host.enemies, end.host.enemies],
      snapshotBytesPerSecond: Math.round((end.host.world.snapshotBytes - start.host.world.snapshotBytes) / seconds),
      eventBytesPerSecond: Math.round((end.host.world.eventBytes - start.host.world.eventBytes) / seconds),
      hostSentBytesPerSecond: Math.round((end.host.sent - start.host.sent) / seconds),
      guestSentBytesPerSecond: Math.round((end.guest.sent - start.guest.sent) / seconds),
      snapshotsPerSecond: (end.host.world.snapshotPackets - start.host.world.snapshotPackets) / seconds, hostPerf: perf };
    await shot(guest, 'lagged-wave-guest');
    const pings = await guest.evaluate(() => [...window.__op2.ctx.coop.world.team.cards.values()].map(c => c.ping));
    out.pings = pings;
    if (!process.env.SKIP_LAG) check(Math.max(...pings) >= 150, 'Lag shows in the ping the players see', pings);

    progress('a kill and its pay under lag');
    await calm(host);
    const spawn = await host.evaluate(() => { const s = window.__op2.ctx.world.playerSpawns[0]; return { at: s.position.toArray(), yaw: s.yaw }; });
    const ahead = d => [spawn.at[0] - Math.sin(spawn.yaw) * d, spawn.at[1], spawn.at[2] - Math.cos(spawn.yaw) * d];
    await guest.evaluate(([at, yaw]) => { const { ctx } = window.__op2; const V = ctx.player.position.constructor; ctx.player.teleport(new V(...at), yaw);
      ctx.weapons.give('smg'); ctx.weapons.switchTo('smg'); ctx.weapons.refillMagazines(); }, [ahead(-4), spawn.yaw]);
    const before = await state(guest);
    const target = await dummy(host, ahead(6));
    await guest.waitForFunction(uid => window.__op2.ctx.enemies.alive.some(e => e.uid === uid), target, { timeout: 15000 });
    await sleep(800); await aimAt(guest, target); await sleep(300);
    await guest.mouse.down(); await sleep(1400); await guest.mouse.up();
    await guest.waitForFunction(uid => !window.__op2.ctx.enemies.alive.some(e => e.uid === uid), target, { timeout: 20000 });
    await sleep(1500);
    const after = await state(guest);
    out.laggedKill = { before, after };
    check(after.kills === before.kills + 1 && after.credits > before.credits, 'Under lag the guest still kills, and is paid for it', out.laggedKill);
    await lag(host, { lag: 0, jitter: 0, stall: 0 });

    progress("the guest's tab dies mid-wave; they rejoin by the invite link");
    const credits = after.credits;
    await host.evaluate(() => { window.__op2.ctx.waves.start?.(); });
    await guest.close(); guest = null;
    await host.waitForFunction(() => window.__op2.ctx.coop.lobby.players.length === 1, null, { timeout: 40000 });
    await host.waitForFunction(() => window.__op2.ctx.enemies.alive.length > 0, null, { timeout: 60000 });
    check(true, 'The host plays on when a guest drops');
    guest = await host.context().browser().newPage({ viewport: host.viewportSize(), deviceScaleFactor: 2 });
    guest.on('pageerror', error => out.errors.push(`guest2: ${error.message}`));
    await guest.addInitScript(harness); await guest.addInitScript(quiet);
    // The same player's browser keeps their callsign; a new test page is a new browser profile, so it is set here.
    await guest.addInitScript(() => localStorage.setItem('op2_coop_name', 'GUEST-TWO'));
    await guest.goto(invite);
    await guest.locator('.scr-splash').waitFor({ state: 'visible', timeout: 120000 }); await guest.locator('.scr-splash').click();
    await guest.locator('input[type=password]').fill('coop-robust'); await button(guest, 'Join').click();
    await guest.locator('.co-field input').first().fill('GUEST-TWO').catch(() => {});
    await inMatch([guest], 'crucible');
    await guest.waitForFunction(() => window.__op2.ctx.enemies.alive.length > 0, null, { timeout: 30000 });
    await guest.waitForFunction(c => (window.__op2.ctx.contracts.wallet?.credits ?? 0) >= c, credits, { timeout: 20000 }).catch(() => {});
    const rejoined = { guest: await state(guest), host: await state(host),
      purses: await host.evaluate(() => [...window.__op2.ctx.coop.world.team.purses.entries()].map(([n, c]) => [n, c.credits])),
      names: await host.evaluate(() => window.__op2.ctx.coop.lobby.players.map(p => p.name)),
      feed: await guest.evaluate(() => [...document.querySelectorAll('.feed-ln')].map(e => e.textContent).slice(-8)) };
    out.rejoin = rejoined;
    check(rejoined.guest.enemies > 0 && rejoined.guest.wave === rejoined.host.wave, 'A late joiner lands in the wave in progress, with the full enemy state', rejoined);
    check(rejoined.guest.credits >= credits, "The rejoining guest's credits come back", { credits, now: rejoined.guest.credits });
    await shot(guest, 'rejoined-guest');

    progress('the guest steps out to the lobby and back in');
    await guest.keyboard.press('Escape');
    await guest.evaluate(() => window.__op2.ctx.hud.pause?.());
    await guest.locator('.scr-pause').waitFor({ state: 'visible', timeout: 10000 });
    await button(guest, 'Leave match (to lobby)').click();
    await guest.locator('.co-code').waitFor({ state: 'visible', timeout: 20000 });
    await sleep(800);
    await shot(guest, 'guest-left-to-lobby', true);
    await button(guest, 'Rejoin match').click();
    await inMatch([guest], 'crucible');
    check(true, 'A guest who left the match for the lobby can rejoin it');
    out.final = { host: await state(host), guest: await state(guest) };
    check(out.errors.length === 0, 'No page exceptions', out.errors);
    return out;
  } catch (error) {
    out.failure = error.stack ?? String(error);
    throw error;
  } finally {
    writeFileSync(`${outDir}/robust-evidence.json`, JSON.stringify(out, null, 2));
    await guest?.close();
  }
}
