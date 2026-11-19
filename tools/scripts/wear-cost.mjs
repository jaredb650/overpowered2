// What wear you can see costs to draw: 20 Troopers at 5 to 13 m on the Test Range, all at full detail (a real clock: it times).
// The same frame timed with a GPU sync at each end, best of 8 rounds of 30: bodies clean on the plain skin, clean on the
// wounded skin (one graze each, so the wear code is compiled in but idle), and every limb, the trunk and the head worn.
//
//   node tools/shot.mjs --port <yours> --url "/?map=range" --wait 500 --script tools/scripts/wear-cost.mjs --dpr 2 --w 1440 --h 900 \
//     --timeout 300 --out tools/out/<you>/wear-cost.png
export default async function cost(page, h) {
  for (let i = 0; i < 180; i++) {
    if (await page.evaluate(() => !!window.__lab && window.__op2?.game?.state === 'playing')) break;
    await h.sleep(500);
  }
  await page.evaluate(() => {
    const { ctx } = window.__op2;
    window.__lab.settings.overlay = false;
    window.__lab.changed();
    ctx.enemies.reset();
    const eye = ctx.player.position, f = ctx.player.forward;
    const yaw = Math.atan2(f.x, f.z);
    window.crew = [];
    for (let i = 0; i < 20; i++) {
      const dist = 5 + (i % 5) * 2, a = yaw + (Math.floor(i / 5) - 1.5) * 0.22;
      const at = eye.clone();
      at.x += Math.sin(a) * dist;
      at.z += Math.cos(a) * dist;
      const e = window.__lab.spawner.place('trooper', at, 'off');
      if (e) window.crew.push(e);
    }
  });
  await h.sleep(1500);
  const time = () => page.evaluate(() => {
    const render = window.__op2.ctx.render;
    const gl = render.renderer.getContext();
    let best = Infinity;
    for (let round = 0; round < 8; round++) {
      gl.finish();
      const t0 = performance.now();
      for (let i = 0; i < 30; i++) { render.render(); gl.finish(); }
      best = Math.min(best, (performance.now() - t0) / 30);
    }
    return +best.toFixed(3);
  });
  const out = { bodies: await page.evaluate(() => window.crew.length) };
  out.clean = await time();
  await page.evaluate(() => { for (const e of window.crew) e.char.addWound(2, e.center.clone(), 0.02); });
  await h.sleep(200);
  out.woundedSkinNoWear = await time();
  await page.evaluate(() => { for (const e of window.crew) for (const r of ['head', 'chest', 'abdomen', 'armL', 'forearmL', 'armR', 'forearmR', 'legL', 'shinL', 'legR', 'shinR']) e.char.setWear(r, 0.8, 0); });
  await h.sleep(200);
  out.allWorn = await time();
  await h.shot('worn');
  out.added = +(out.allWorn - out.woundedSkinNoWear).toFixed(3);
  return out;
}
