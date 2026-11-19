// A first launch, in real time: an empty browser on the bare address, a click on the splash, a click on Play, and where that
// goes (Retraining's own page: docs/design/tutorial.md, contracts/firstLaunch.ts). Returns what the page showed at each step.
//
//   node tools/shot.mjs --port <yours> --url "/" --wait 0 --timeout 200 --script tools/scripts/first-launch.mjs --out tools/out/<you>/first.png
//
// Not a tools/scripts/solo-trace.mjs scenario: Play loads another page, and a trace ends where its page does.
export const before = async page => { await page.addInitScript(() => { if (!sessionStorage.getItem('fp')) { sessionStorage.setItem('fp', '1'); localStorage.clear(); } }); };
export default async function (page, { sleep }) {
  const out = { steps: [] };
  const read = async label => out.steps.push({ label, url: page.url().replace(/^https?:\/\/[^/]+/, ''), ...(await page.evaluate(() => ({ state: window.__op2?.game?.state ?? null, screen: window.__op2?.ctx?.hud?.screens?.name ?? null,
    mission: window.__op2?.campaign?.runner?.describe?.().mission ?? null, beat: window.__op2?.campaign?.runner?.describe?.().beat ?? null,
    menu: [...document.querySelectorAll('.scr-menu .mm-list .mi')].map(e => e.textContent.trim()).slice(0, 8), keys: Object.keys(localStorage).sort() })).catch(e => ({ error: String(e).slice(0, 80) }))) });
  await page.waitForFunction(() => window.__op2?.game?.state === 'menu', null, { timeout: 120000 });
  await sleep(1500); await read('loaded');
  await page.locator('.scr-splash').click(); await sleep(800); await read('after the splash');
  await page.getByRole('button', { name: 'Play', exact: true }).click().catch(async () => { await page.locator('.scr-menu .mm-list .mi').filter({ hasText: /^Play$/ }).first().click(); });
  await sleep(1000); await read('1 s after Play');
  await page.waitForFunction(() => window.__op2?.game?.state === 'playing', null, { timeout: 120000 }).catch(() => {});
  await sleep(1500); await read('in play');
  return out;
}
