// Outpost Defense's shop in the shops' order, and its confirm form (Esc cancels, Enter buys).
//   node tools/shot.mjs --port 5281 --url "/?contract=defense&autostart=1" --script tools/scripts/menu-update-defense.mjs --wait 500 --timeout 200 --dpr 2 --w 1440 --h 900 --out tools/out/menu-update/defense.png
export default async function (page, h) {
  for (let i = 0; i < 200 && !(await page.evaluate(() => window.__op2?.ctx?.contracts?.defense && ['playing', 'paused'].includes(window.__op2.game.state))); i++) await h.sleep(250);
  await page.evaluate(() => { const { ctx } = window.__op2; ctx.contracts.defense.credits = 900; ctx.hud.screens.shop('armoury'); });
  await h.sleep(800);
  const rows = () => page.evaluate(() => [...document.querySelectorAll('.scr-shop:not(.scr-loadout) .set-list > *')].map(e => e.classList.contains('gd-h') ? `# ${e.textContent}`
    : `${e.querySelector('.row-k')?.textContent} | ${e.querySelector('.row-v')?.textContent}${e.classList.contains('off') ? ' (grey)' : ''}`));
  const out = { rows: await rows(), credits: await page.evaluate(() => window.__op2.ctx.contracts.defense.credits) };
  await h.shot('1-armoury');
  const first = out.rows.findIndex(r => !r.startsWith('#') && !r.includes('(grey)'));
  const nameOf = out.rows[first].split(' | ')[0];
  await page.evaluate(n => [...document.querySelectorAll('.scr-shop:not(.scr-loadout) .sp-row')].find(e => e.querySelector('.row-k')?.textContent === n).click(), nameOf);
  await h.sleep(300);
  out.asked = await page.evaluate(() => document.querySelector('.scr-shop:not(.scr-loadout) .cf-q')?.textContent);
  await h.shot('2-confirm');
  await page.keyboard.press('Escape');
  await h.sleep(300);
  out.afterEsc = { credits: await page.evaluate(() => window.__op2.ctx.contracts.defense.credits), screen: await page.evaluate(() => window.__op2.ctx.hud.screens.name) };
  await page.evaluate(n => [...document.querySelectorAll('.scr-shop:not(.scr-loadout) .sp-row')].find(e => e.querySelector('.row-k')?.textContent === n).click(), nameOf);
  await h.sleep(300);
  await page.keyboard.press('Enter');
  await h.sleep(300);
  out.afterEnter = { credits: await page.evaluate(() => window.__op2.ctx.contracts.defense.credits), bought: nameOf };
  return out;
}
