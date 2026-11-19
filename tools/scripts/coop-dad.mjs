// The non-gamer's co-op path, in two browser contexts. FLOW=ready: invite link → password → lobby → pick a gun → READY → host
// Start. FLOW=force: the guest never readies, the host Force starts (two presses), the guest comes in on the default SMG,
// and a sonar ping goes each way with its feed line.
//   FLOW=ready|force node tools/shot.mjs --port 5197 --dpr 2 --w 1440 --h 900 --wait 500 --timeout 600 \
//     --script tools/scripts/coop-dad.mjs --out tools/out/coop-dad/dad.png
import { writeFileSync } from 'node:fs';
import { button, harness, inMatch, kit, quiet } from './coop-kit.mjs';

export default async function (host, { sleep, outDir }) {
  const flow = process.env.FLOW ?? 'ready';
  const out = { flow, errors: [], checks: [], screenshots: [] };
  const { check, progress, shot } = kit(outDir, `dad-${flow}`, out, sleep);
  let guest;
  try {
    await host.waitForFunction(() => !!window.__op2?.ctx.render, null, { timeout: 120000 });
    await host.addInitScript(harness); await host.evaluate(harness);
    await host.addInitScript(quiet); await host.evaluate(() => window.__op2.ctx.render.setQuality(0));
    host.on('pageerror', error => out.errors.push(`host: ${error.message}`));
    await host.locator('.scr-splash').waitFor({ state: 'visible', timeout: 120000 });
    await host.locator('.scr-splash').click();
    // A fresh browser profile's first Play goes to Retraining (contracts/firstLaunch.ts); this page is a returning player.
    await host.evaluate(() => localStorage.setItem('op2.played.v1', '1'));
    await button(host, 'Play').click(); await button(host, 'Multiplayer').click(); await button(host, 'Host a lobby').click();
    await host.locator('input[type=password]').fill('dad'); await button(host, 'Open lobby').click();
    await host.locator('.co-code').waitFor({ state: 'visible' });
    await button(host, 'Crucible mode').click();
    const code = await host.locator('.co-code').textContent();
    const link = (await host.locator('.co-link').textContent()).replace(/^https?:\/\/[^/]+/, new URL(host.url()).origin);

    // A separate context: its own localStorage, so its own browser id and no saved starter (6dbdddd).
    const context = await host.context().browser().newContext({ viewport: host.viewportSize(), deviceScaleFactor: 2 });
    guest = await context.newPage();
    guest.on('pageerror', error => out.errors.push(`guest: ${error.message}`));
    await guest.addInitScript(harness); await guest.addInitScript(quiet);
    await guest.goto(link);
    progress('guest opened the invite link');

    const password = guest.locator('input[type=password]');
    await password.waitFor({ state: 'visible', timeout: 300000 });
    const page1 = await guest.evaluate(() => ({ title: document.querySelector('.co-panel .nt-title')?.textContent, text: document.querySelector('.co-panel')?.textContent,
      focused: document.activeElement?.getAttribute('type'), splash: getComputedStyle(document.querySelector('.scr-splash')).display, url: location.search }));
    out.page1 = page1;
    check(page1.title === `Joining lobby ${code}`, 'the invite opens on "Joining lobby CODE"', page1);
    check(page1.splash === 'none' && page1.focused === 'password', 'no splash, and the password field has focus', page1);
    check(/password the host gave you/.test(page1.text), 'it asks for the host\'s password', page1.text);
    await shot(guest, '1-invite-page', true);
    await password.pressSequentially('dad', { delay: 60 });
    await shot(guest, '2-password', true);
    await button(guest, 'Join lobby').click();
    await guest.locator('.co-player').nth(1).waitFor({ state: 'visible', timeout: 90000 });
    await sleep(800);

    const lobby = await guest.evaluate(() => ({ guide: document.querySelector('.co-guide')?.textContent, selected: document.querySelector('.starter-card.selected')?.getAttribute('aria-label'),
      ready: document.querySelector('.co-readybtn')?.textContent, list: [...document.querySelectorAll('.scr-coop .mm-list .mi')].map(e => e.textContent) }));
    out.guestLobby = lobby;
    check(/1\. Pick your weapon \(optional\).*2\. Press READY.*3\. The host starts the match: Crucible mode/.test(lobby.guide), 'the guest sees the three steps and the mode', lobby);
    check(lobby.selected === 'Starter: SMG', 'the SMG is picked for them', lobby);
    await shot(guest, '3-guest-lobby', true);
    const waiting = await host.evaluate(() => ({ guide: document.querySelector('.co-guide')?.textContent, startOff: [...document.querySelectorAll('.scr-coop .mm-list .mi')].find(e => e.textContent === 'Start')?.classList.contains('off'),
      list: [...document.querySelectorAll('.scr-coop .mm-list .mi')].map(e => e.textContent), rows: [...document.querySelectorAll('.co-ready')].map(e => e.textContent) }));
    out.hostWaiting = waiting;
    check(/Waiting for .* to ready up/.test(waiting.guide) && waiting.startOff && waiting.list.includes('Force start'), 'the host is told who it waits on, Start is dimmed, Force start is there', waiting);
    await shot(host, '4-host-waiting', true);

    if (flow === 'ready') {
      await guest.locator('.starter-card[aria-label="Starter: Gimlet" i]').click(); await sleep(400);
      check(await guest.locator('.co-callout').isVisible(), 'after a pick, the callout points at READY');
      await shot(guest, '5-picked-callout', true);
      await guest.locator('.co-readybtn:not(.on)').click(); await sleep(1500);
      const after = await guest.evaluate(() => ({ guide: document.querySelector('.co-guide .now')?.textContent, rows: [...document.querySelectorAll('.co-ready')].map(e => e.textContent), callout: getComputedStyle(document.querySelector('.co-callout')).display }));
      check(after.rows.includes('✓ READY') && after.callout === 'none' && /host starts/.test(after.guide), 'the guest shows as ready and waits on the host', after);
      await shot(guest, '6-guest-ready', true);
      const ready = await host.evaluate(() => ({ guide: document.querySelector('.co-guide')?.textContent, list: [...document.querySelectorAll('.scr-coop .mm-list .mi')].map(e => `${e.textContent}${e.classList.contains('off') ? ' [off]' : ''}`) }));
      check(/Everyone is ready/.test(ready.guide) && ready.list.includes('Start') && !ready.list.includes('Force start'), 'with everyone ready the host gets a live Start and no Force start', ready);
      await shot(host, '7-host-all-ready', true);
      await button(host, 'Start').click(); await sleep(1500);
      await shot(guest, '8-countdown', true);
      await inMatch([host, guest], 'crucible');
      const landed = await guest.evaluate(() => location.search);
      check(/starter=gimlet/.test(landed), 'the guest is in the match with the gun it picked', landed);
      await sleep(1500);
      await shot(guest, '9-guest-in-match');
    } else {
      await button(host, 'Force start').click(); await sleep(300);
      check(await button(host, 'Sure? Click again').isVisible(), 'Force start asks again first');
      await shot(host, '5-force-confirm', true);
      await button(host, 'Sure? Click again').click();
      await inMatch([host, guest], 'crucible');
      const landed = await guest.evaluate(() => location.search);
      check(/starter=smg/.test(landed), 'the unready guest is pulled in on the default SMG', landed);
      await sleep(2000);
      await shot(guest, '6-guest-in-match');
      // Sonar each way: the real press on one side, the lit enemies and a feed line on the other.
      const spawn = page => page.evaluate(() => { const { ctx } = window.__op2; const p = ctx.player.position; for (let i = 0; i < 3; i++) ctx.enemies.spawn?.('husk', p.clone().set(p.x + 6 + i * 2, p.y, p.z + 8)); });
      await spawn(host); await sleep(1500);
      const ping = page => page.evaluate(() => { const s = window.__op2.ctx.contracts.sonar; s.reset(); s.press(); });
      const seen = page => page.evaluate(() => ({ live: window.__op2.ctx.contracts.sonar.live, feed: /used sonar/.test(document.querySelector('.hud')?.textContent ?? ''), text: (document.querySelector('.hud')?.textContent.match(/[A-Z0-9-]+ used sonar/) ?? [''])[0] }));
      await ping(guest); await sleep(700);
      const onHost = await seen(host);
      out.hostSaw = onHost;
      check(onHost.live > 0 && onHost.feed, 'the guest pinged: the host sees the reveal and the line', onHost);
      await shot(host, '7-host-sees-guest-sonar');
      await sleep(4500);
      await ping(host); await sleep(700);
      const onGuest = await seen(guest);
      out.guestSaw = onGuest;
      check(onGuest.live > 0 && onGuest.feed, 'the host pinged: the guest sees the reveal and the line', onGuest);
      await shot(guest, '8-guest-sees-host-sonar');
    }
    check(out.errors.length === 0, 'no page exceptions', out.errors);
    return out;
  } catch (error) {
    out.failure = error.stack ?? String(error);
    if (guest) await shot(guest, 'failure', true).catch(() => {});
    await shot(host, 'failure-host', true).catch(() => {});
    throw error;
  } finally {
    writeFileSync(`${outDir}/dad-${flow}-evidence.json`, JSON.stringify(out, null, 2));
    await guest?.context().close();
  }
}
