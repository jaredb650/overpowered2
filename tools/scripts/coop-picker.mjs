// The live-site bug: the host starts while the guest is not ready and still picking a starter gun. The guest must land in
// the match with the gun they picked, never on the menu. GUEST=phone opens the guest as a phone (touch, no mouse) instead,
// which must be told it needs a computer and never get into the lobby.
//   GUEST=desktop|phone node tools/shot.mjs --port 5191 --dpr 2 --w 1440 --h 900 --wait 500 --timeout 600 \
//     --script tools/scripts/coop-picker.mjs --out tools/out/coop-picker/picker.png
import { writeFileSync } from 'node:fs';
import { button, harness, joinFromSplash, kit, quiet, readyUp } from './coop-kit.mjs';

export default async function (host, { sleep, outDir }) {
  const which = process.env.GUEST ?? 'desktop';
  const out = { which, errors: [], console: [], checks: [], screenshots: [] };
  const { check, progress, shot } = kit(outDir, `picker-${which}`, out, sleep);
  let guest;
  try {
    await host.waitForFunction(() => !!window.__op2?.ctx.render, null, { timeout: 120000 });
    await host.addInitScript(harness); await host.evaluate(harness);
    await host.addInitScript(quiet); await host.evaluate(() => window.__op2.ctx.render.setQuality(0));
    host.on('pageerror', error => out.errors.push(`host: ${error.message}`));
    await host.locator('.scr-splash').click();
    await button(host, 'Play').click(); await button(host, 'Multiplayer').click(); await button(host, 'Host a lobby').click();
    await host.locator('input[type=password]').fill('picker'); await button(host, 'Open lobby').click();
    await host.locator('.co-code').waitFor({ state: 'visible' });
    const link = (await host.locator('.co-link').textContent()).replace(/^https?:\/\/[^/]+/, new URL(host.url()).origin);

    const phone = which === 'phone';
    const context = phone
      ? await host.context().browser().newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
        userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36' })
      : null;
    guest = phone ? await context.newPage() : await host.context().browser().newPage({ viewport: host.viewportSize(), deviceScaleFactor: 2 });
    guest.on('pageerror', error => out.errors.push(`guest: ${error.message}`));
    guest.on('console', m => { if (/coop|error|warn/i.test(m.text()) || m.type() !== 'log') out.console.push(`${m.type()}: ${m.text()}`); });
    await guest.addInitScript(harness); await guest.addInitScript(quiet);
    await guest.goto(link);

    if (phone) {
      await guest.locator('.scr-splash').waitFor({ state: 'visible', timeout: 120000 });
      await shot(guest, 'phone-splash', true);
      await guest.locator('.scr-splash').tap();
      await guest.locator('input[type=password]').fill('picker'); await button(guest, 'Join').tap();
      await sleep(1500);
      const text = await guest.locator('.co-panel').textContent();
      await shot(guest, 'phone-join', true);
      check(/needs a computer with keyboard and mouse/.test(text), 'phone: the join page says the game needs a computer', text);
      check(await host.locator('.co-player').count() === 1, 'phone: the phone never got into the lobby');
      return out;
    }

    // Every status the join shows on its way in, in order.
    await guest.addInitScript(() => {
      window.__stages = [];
      setInterval(() => { const t = document.querySelector('.scr-coop .nt-ref')?.textContent; if (t && window.__stages.at(-1) !== t) window.__stages.push(t); }, 50);
    });
    await guest.reload();
    await joinFromSplash(guest, 'picker');
    out.stages = await guest.evaluate(() => window.__stages);
    progress(`guest in the lobby, not ready; join showed ${JSON.stringify(out.stages)}`);
    check(out.stages.some(t => /Looking for lobby|Contacting lobby servers|Connecting to host/.test(t)) && /Connected/.test(out.stages.at(-1)), 'the join showed its stages', out.stages);
    out.ice = out.console.filter(line => /Peer connection/.test(line));
    check(out.ice.length > 0, 'the guest logged the ICE candidate kinds', out.console);
    await button(host, 'The Crucible').click();
    // Start with the guest not ready: refused, and the host is told who it waits on.
    await button(host, 'Start').click(); await sleep(800);
    const refused = await host.evaluate(() => ({ count: window.__op2 && document.querySelector('.scr-coop .nt-ref')?.textContent, chat: document.querySelector('.co-chat')?.textContent ?? '' }));
    await shot(host, 'host-refused', true);
    check(/ready up/.test(refused.chat) && !/Starting in/.test(refused.count ?? ''), 'Start with a guest not ready is refused, with why', refused);

    // The guest readies, the countdown runs, and the guest un-readies to pick a gun: the count stops.
    await readyUp(guest); await sleep(800);
    await button(host, 'Start').click(); await sleep(1200);
    check(/Starting in/.test(await host.locator('.scr-coop .nt-ref').textContent()), 'with everyone ready the count runs');
    await guest.locator('.mi', { hasText: 'Ready: yes' }).click(); await sleep(1500);
    const stopped = await host.locator('.co-chat').textContent();
    check(/cancelled/i.test(stopped) && !/Starting in/.test(await host.locator('.scr-coop .nt-ref').textContent()), 'a guest going unready stops the count', stopped.slice(-200));

    // The exact live sequence: ready, count, and the guest clicks starter cards as it runs out.
    await readyUp(guest); await sleep(800);
    await button(host, 'Start').click();
    // In-page, so screenshots and a busy machine cannot push the picks past the count: Gimlet, Harrow, then Gimlet last.
    const picked = await guest.evaluate(async () => {
      const card = name => document.querySelector(`.starter-card[aria-label="Starter: ${name}" i]`);
      for (const name of ['GIMLET', 'HARROW', 'GIMLET']) { card(name).click(); await new Promise(r => setTimeout(r, 700)); }
      return document.querySelector('.scr-coop .nt-ref')?.textContent;
    });
    check(/Starting in/.test(picked), 'the guest picked while the count ran', picked);
    await shot(guest, 'guest-countdown', true).catch(() => {});
    progress('countdown ran out while the guest picked');
    for (const page of [host, guest]) await page.waitForURL(/contract=crucible/, { timeout: 90000 });
    await guest.waitForFunction(() => window.__op2?.ctx.coop?.world && window.__op2.ctx.coop.remotes.size >= 1, null, { timeout: 150000 });
    const landed = await guest.evaluate(() => ({ url: location.search, coop: !!window.__op2.ctx.coop, screen: document.querySelector('.scr.live, .scr[style=""]')?.className ?? null,
      gun: window.__op2.ctx.weapons.current, slots: window.__op2.ctx.weapons.owned ? [...window.__op2.ctx.weapons.owned] : null }));
    out.landed = landed;
    check(landed.coop && /starter=gimlet/.test(landed.url), 'the guest is in the match with the gun picked last', landed);
    await guest.evaluate(() => window.__op2.game.setState('playing')); await sleep(1500);
    await shot(guest, 'guest-in-match');
    check(out.errors.length === 0, 'no page exceptions', out.errors);
    return out;
  } catch (error) {
    out.failure = error.stack ?? String(error);
    if (guest) await shot(guest, 'failure', true).catch(() => {});
    throw error;
  } finally {
    writeFileSync(`${outDir}/picker-${which}-evidence.json`, JSON.stringify(out, null, 2));
    await guest?.close();
  }
}
