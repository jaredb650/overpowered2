// Drives the real Player over pads, gaps and routes, and prints the results.
export default async function (page, { sleep }) {
  for (let i = 0; i < 240; i++) {
    if (await page.evaluate(() => !!window.__op2?.view)) break;
    await sleep(500);
  }
  return page.evaluate(() => ({ player: window.__op2.playerTests(), verify: window.__op2.verify(), nav: window.__op2.navCost() }));
}
