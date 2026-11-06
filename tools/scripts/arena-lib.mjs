export async function ready(page, h) {
  for (let i = 0; i < 90; i++) {
    if (await page.evaluate(() => !!window.__arena)) return;
    await h.sleep(500);
  }
  throw new Error('arena never booted');
}
