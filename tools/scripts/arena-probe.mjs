export default async function (page, h) {
  const t0 = Date.now();
  for (let i = 0; i < 60; i++) {
    const ready = await page.evaluate(() => !!window.__arena);
    if (ready) break;
    await h.sleep(1000);
  }
  const boot = Date.now() - t0;
  const out = { boot };
  out.s0 = await page.evaluate(() => window.__arena.stats());
  await h.sleep(2000);
  out.list = await page.evaluate(() => window.__arena.list());
  await h.shot('a');
  await h.sleep(2500);
  out.s1 = await page.evaluate(() => window.__arena.stats());
  out.list2 = await page.evaluate(() => window.__arena.list());
  await h.shot('b');
  return out;
}
