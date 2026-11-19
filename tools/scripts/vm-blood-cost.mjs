// What blood on the weapon costs to draw: the view scene timed with a GPU sync each frame, clean against soaked (three full
// layers on the gun and both gloves), best of 6 rounds of 40 frames.
//
//   node tools/shot.mjs --port <yours> --url "/?sandbox=viewmodels&manual=1&engine=1&weapon=smg" --script tools/scripts/vm-blood-cost.mjs \
//     --dpr 2 --w 1440 --h 900 --wait 1500 --out tools/out/<you>/cost.png
export default async function cost(page, h) {
  for (let i = 0; i < 60; i++) {
    if (await page.evaluate(() => !!window.__vm?.rig)) break;
    await h.sleep(300);
  }
  return page.evaluate(async () => {
    const v = window.__vm;
    const render = v.ctx.render;
    const gl = render.renderer.getContext();
    const time = () => {
      let best = Infinity;
      for (let round = 0; round < 6; round++) {
        gl.finish();
        const t0 = performance.now();
        for (let i = 0; i < 40; i++) { render.render(); gl.finish(); }
        best = Math.min(best, (performance.now() - t0) / 40);
      }
      return +best.toFixed(3);
    };
    const out = {};
    for (const id of ['smg', 'lance', 'sword']) {
      v.rig.cleanBlood();
      v.rig.equip(id, 0.01);
      v.step(0.4);
      const clean = time();
      for (const d of [[0.2, 0.1, -1], [-0.6, 0.2, -0.8], [0.7, -0.1, -0.7]]) {
        v.rig.spatterView({ x: d[0], y: d[1], z: d[2] }, 1);
        v.rig.bloodClock += 5;
      }
      v.step(0.05);
      const soaked = time();
      out[id] = { clean, soaked, added: +(soaked - clean).toFixed(3) };
    }
    return out;
  });
}
