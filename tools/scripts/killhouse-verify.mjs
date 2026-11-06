// Static proof, capsule sweeps and room shots for The Kill House, in one browser run. On a loaded machine run the proof with
// tools/scripts/killhouse-headless.ts instead and use OP2_SKIP=1 here for pictures only:
//   OP2_VIEWS=court,room1 node tools/shot.mjs --url "/?sandbox=map&map=killhouse" --script tools/scripts/killhouse-verify.mjs --out tools/out/kh.png --wait 1500 --timeout 280
// OP2_VIEWS is a comma list of views to shoot, "all" for every view. OP2_SKIP=1 skips the proof and only shoots.
export default async function (page, { sleep, shot }) {
  for (let i = 0; i < 240; i++) {
    if (await page.evaluate(() => !!window.__op2?.view)) break;
    await sleep(500);
  }
  const all = await page.evaluate(() => window.__op2.views());
  const wanted = process.env.OP2_VIEWS === 'all' ? all : (process.env.OP2_VIEWS ?? '').split(',').filter(Boolean);
  for (const v of wanted) {
    await page.evaluate(n => window.__op2.view(n), v);
    await sleep(Number(process.env.OP2_SETTLE ?? 500));
    // A screenshot can time out when the machine is busy. One lost picture must not lose the rest.
    await shot(v).catch(e => console.error(`shot ${v} failed: ${e.message.split('\n')[0]}`));
  }
  if (process.env.OP2_SKIP) return { views: wanted };
  const verify = await page.evaluate(() => window.__op2.verify());
  const sweep = await page.evaluate(() => window.__op2.sweep());
  const fuzz = await page.evaluate(() => window.__op2.fuzz(90));
  return { verify, sweep, fuzz };
}
