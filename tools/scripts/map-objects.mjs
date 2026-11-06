// Exercises explosives, then samples the timed hazards over several seconds.
export default async function (page, { sleep, shot }) {
  for (let i = 0; i < 240; i++) {
    if (await page.evaluate(() => !!window.__op2?.view)) break;
    await sleep(500);
  }
  const fired = await page.evaluate(() => window.__op2.testObjects());
  const samples = [];
  for (let i = 0; i < 14; i++) {
    await sleep(700);
    samples.push(await page.evaluate(() => window.__op2.objectState()));
  }
  await page.evaluate(() => window.__op2.view('foundry_press'));
  await sleep(500);
  await shot('press');
  return { fired, samples };
}
