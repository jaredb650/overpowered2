// Random-hands stress test on the real Crucible, at full simulation speed with no rendering.
//   node tools/shot.mjs --url "/?sandbox=movement&map=1&seconds=300" --script tools/scripts/movement-map.mjs --out tools/out/movement-map.png --wait 1000
export default async function run(page, helpers) {
  await page.waitForFunction(() => window.__movement !== undefined, undefined, { timeout: 170000 });
  const stats = await page.evaluate(() => window.__movement.runFast('mapstress', 60));
  await helpers.shot('end');
  return stats;
}
