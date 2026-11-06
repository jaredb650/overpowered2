// Runs the map self-test and prints its report.
export default async function (page, { sleep }) {
  for (let i = 0; i < 240; i++) {
    if (await page.evaluate(() => !!window.__op2?.view)) break;
    await sleep(500);
  }
  return page.evaluate(() => window.__op2.verify());
}
