// Captures each view named in OP2_VIEWS (comma list), or all of them, into tools/out/map-<name>.png.
export default async function (page, { sleep, shot }) {
  for (let i = 0; i < 240; i++) {
    if (await page.evaluate(() => !!window.__op2?.view)) break;
    await sleep(500);
  }
  const all = await page.evaluate(() => window.__op2.views());
  const want = process.env.OP2_VIEWS ? process.env.OP2_VIEWS.split(',') : all;
  const stats = await page.evaluate(() => window.__op2.stats());
  for (const v of want) {
    await page.evaluate(n => window.__op2.view(n), v);
    await sleep(Number(process.env.OP2_SETTLE ?? 700));
    await shot(v);
  }
  const verify = process.env.OP2_VERIFY ? await page.evaluate(() => ({ ...window.__op2.verify(), nav: window.__op2.navCost() })) : null;
  return { all, stats, verify };
}
