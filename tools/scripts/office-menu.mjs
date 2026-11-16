// Play / Survival / Office in the real menu: both modes listed, each with its own notice, and choosing one loads the Office.
//   node tools/shot.mjs --port 5293 --url "/" --script tools/scripts/office-menu.mjs --dpr 2 --w 1440 --h 900 --wait 500 --out tools/out/office/menu.png
export default async function officeMenu(page, { sleep, shot }) {
  const read = () => page.evaluate(() => ({
    crumb: document.querySelector('.mm-crumb')?.textContent,
    list: [...document.querySelectorAll('.scr-menu .mm-list .mi')].map(t => t.textContent),
    notice: document.querySelector('.nt-subject')?.textContent ?? null,
    ref: document.querySelector('.nt-ref')?.textContent ?? null,
  }));
  const item = label => page.locator('.scr-menu .mm-list .mi').filter({ has: page.getByText(label, { exact: true }) });
  await page.waitForFunction(() => window.__op2?.ctx?.hud?.screens?.name === 'splash', null, { timeout: 120000 });
  for (let i = 0; i < 10 && (await page.evaluate(() => window.__op2.ctx.hud.screens.name)) !== 'menu'; i++) {
    await sleep(1000);
    await page.mouse.click(720, 450);
  }
  const out = {};
  for (const label of ['Play', 'Survival']) { await item(label).click(); await sleep(300); }
  await item('Office').hover(); await sleep(300);
  out.survival = await read();
  await shot('survival');
  await item('Office').click(); await sleep(300);
  await item('The Crucible').hover(); await sleep(400);
  out.crucible = await read();
  await shot('crucible');
  await item('Endless Humans').hover(); await sleep(400);
  out.humans = await read();
  await shot('humans');
  await item('Endless Humans').click(); await sleep(400);
  out.starter = await read();
  const deploy = item('Deploy');
  if (await deploy.count()) {
    await deploy.click();
    await page.waitForFunction(() => location.search.includes('map=office'), null, { timeout: 20000 }).catch(() => {});
  }
  out.url = await page.evaluate(() => location.search);
  return out;
}
