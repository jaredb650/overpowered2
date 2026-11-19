// Co-op lobby, two pages of one browser over the real Nostr relays: one hosts, one joins by the invite link, a wrong
// password fails, the right one gets in, names, ready and chat go through, and the host leaving sends the guest back.
//
//   node tools/shot.mjs --port 5266 --dpr 2 --w 1440 --h 900 --wait 1000 --timeout 280 \
//     --script tools/scripts/coop-lobby.mjs --out tools/out/coop/lobby.png
const PASSWORD = 'hunter2';

export default async function (host, { sleep, outDir }) {
  const out = {};
  const shot = (page, name) => page.screenshot({ path: `${outDir}/${name}.png` });
  const button = (page, name) => page.getByRole('button', { name, exact: true });
  const toMenu = async page => {
    await page.locator('.scr-splash').waitFor({ state: 'visible', timeout: 90000 });
    await sleep(500);
    await page.locator('.scr-splash').click();
  };

  await toMenu(host);
  // A fresh browser profile's first Play goes to Retraining (contracts/firstLaunch.ts); this page is a returning player.
  await host.evaluate(() => localStorage.setItem('op2.played.v1', '1'));
  await button(host, 'Play').click();
  await button(host, 'Multiplayer').click();
  await shot(host, '1-start');
  await button(host, 'Host a lobby').click();
  await host.keyboard.type(PASSWORD);
  await shot(host, '2-host-form');
  await host.keyboard.press('Enter');
  await host.locator('.co-code').waitFor({ state: 'visible' });
  const code = await host.locator('.co-code').textContent();
  out.code = code;
  out.link = await host.locator('.co-link').textContent();
  await shot(host, '3-host-lobby');

  // The guest: a second page of the same browser, in its own context (its own storage, so its own callsign).
  const guest = await host.context().browser().newPage({ viewport: host.viewportSize(), deviceScaleFactor: 2 });
  guest.on('pageerror', e => (out.guestErrors ??= []).push(e.message));
  await guest.goto(out.link.replace(/^https?:\/\/[^/]+/, new URL(host.url()).origin));
  await toMenu(guest);
  await guest.locator('.scr-coop .co-input').first().waitFor({ state: 'visible' });
  out.codeFilled = await guest.locator('.scr-coop .co-field input').first().inputValue();
  await shot(guest, '4-guest-join-page');

  const t0 = Date.now();
  await guest.keyboard.type('wrong-one');
  await guest.keyboard.press('Enter');
  await guest.locator('.co-err').waitFor({ state: 'visible', timeout: 60000 });
  out.wrongPassword = { text: await guest.locator('.co-err').textContent(), seconds: (Date.now() - t0) / 1000 };
  await shot(guest, '5-guest-wrong-password');
  await sleep(1500);
  out.hostAfterWrong = await host.locator('.co-chat').textContent();
  await shot(host, '6-host-saw-wrong-password');

  const t1 = Date.now();
  await guest.locator('.scr-coop .co-field input[type=password]').fill(PASSWORD);
  await guest.keyboard.press('Enter');
  await guest.locator('.co-player').nth(1).waitFor({ state: 'visible', timeout: 60000 });
  out.joinSeconds = (Date.now() - t1) / 1000;

  // The guest renames.
  const name = guest.locator('.co-field input').first();
  await name.fill('GUEST-7');
  await name.press('Enter');
  await guest.locator('.co-chat + .co-input').fill('hello from the guest');
  await guest.keyboard.press('Enter');
  await guest.locator('.co-readybtn:not(.on)').click();
  await host.locator('.co-chat + .co-input').fill('welcome in');
  await host.keyboard.press('Enter');
  await sleep(2000);
  out.hostPlayers = await host.locator('.co-player').allTextContents();
  out.guestPlayers = await guest.locator('.co-player').allTextContents();
  out.hostChat = await host.locator('.co-line').allTextContents();
  out.guestChat = await guest.locator('.co-line').allTextContents();
  out.guestStatus = await guest.locator('.co-panel .nt-ref').textContent();
  await shot(host, '7-host-with-guest');
  await shot(guest, '8-guest-in-lobby');

  await button(host, 'Leave').click();
  await guest.locator('.co-err').waitFor({ state: 'visible', timeout: 30000 });
  out.hostLeft = await guest.locator('.co-err').textContent();
  await shot(guest, '9-guest-host-left');
  await guest.close();
  return out;
}
