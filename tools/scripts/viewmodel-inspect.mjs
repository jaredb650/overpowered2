// Turntable shots of viewmodel models in the sandbox studio, one page load for the whole list.
//
//   VM_IDS=shotgun,rocket node tools/shot.mjs --url "/?sandbox=viewmodels&view=inspect" \
//     --script tools/scripts/viewmodel-inspect.mjs --wait 1500 --out tools/out/vm/i.png
//
// VM_VIEWS is a JSON list of [name, yaw, pitch, dist, fx, fy, fz]. Screenshots: <out>-<id>-<view>.png.
const ids = (process.env.VM_IDS ?? 'smg').split(',').filter(Boolean);
const views = JSON.parse(process.env.VM_VIEWS ?? '[["l",155,12,0.85,0,0.02,-0.15],["r",-40,10,0.85,0,0.02,-0.15]]');

export default async function inspect(page, h) {
  for (let i = 0; i < 40; i++) {
    if (await page.evaluate(() => !!window.__vm)) break;
    await h.sleep(500);
  }
  const out = {};
  for (const id of ids) {
    out[id] = await page.evaluate(w => window.__vm.show(w), id);
    for (const [name, ...v] of views) {
      await page.evaluate(a => window.__vm.aim(...a), v);
      await h.sleep(250);
      await h.shot(`${id}-${name}`);
    }
  }
  return out;
}
