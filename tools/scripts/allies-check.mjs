// One ally standing still on the Test Range: the green crosshair on him, CHECK FIRE through him, a tap and a hold of E, and a revive.
//   node tools/shot.mjs --url "/?map=range&contract=outpost" --script tools/scripts/allies-check.mjs --wait 500 --timeout 150 \
//     --dpr 2 --w 1440 --h 900 --out tools/out/allies/check.png
export default async function alliesCheck(page, h) {
  for (let i = 0; i < 180; i++) {
    if (await page.evaluate(() => !!window.__allies && window.__op2?.game?.state === 'playing')) break;
    await h.sleep(500);
  }
  const setup = () => page.evaluate(() => {
    const { ctx } = window.__op2;
    window.V = ctx.player.position.constructor;
    window.lookAt = (x, y, z) => {
      const p = ctx.player.eye;
      const dx = x - p.x, dy = y - p.y, dz = z - p.z;
      ctx.player.yaw = Math.atan2(-dx, -dz);
      ctx.player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    };
    window.one = () => window.__allies.system.allies[0];
    window.aimAt = () => { const a = window.one(); window.lookAt(a.body.center.x, a.body.center.y + 0.1, a.body.center.z); };
  });
  await setup();
  await page.mouse.click(300, 400);
  const out = {};
  out.spawned = await page.evaluate(() => {
    const { ctx } = window.__op2;
    window.__allies.clear();
    ctx.player.teleport(new window.V(0, 0.1, 15));
    const a = window.__allies.system.spawn('rifleman', new window.V(0, 0, 7), undefined, 0.5, Math.PI);
    window.__lab.settings.god = true;
    window.__lab.changed();
    return !!a;
  });
  await h.sleep(1500);
  await page.evaluate(() => window.aimAt());
  await h.sleep(400);
  out.reticle = await page.evaluate(() => document.querySelector('.xh-reticle')?.className);
  out.ray = await page.evaluate(() => { const { ctx } = window.__op2; const r = ctx.allies.raycast(ctx.player.eye, ctx.player.forward, 250); return r ? +r.distance.toFixed(2) : null; });
  await h.shot('green');

  const hp = await page.evaluate(() => window.one().health);
  await page.mouse.down();
  await h.sleep(160);
  await page.mouse.up();
  await h.sleep(120);
  await h.shot('checkfire');
  out.fireThrough = await page.evaluate(hp0 => ({ before: hp0, after: window.one().health, state: window.one().state }), hp);

  await page.evaluate(() => { window.__op2.ctx.player.teleport(new window.V(0, 0.1, 9.4)); });
  await h.sleep(150);
  await page.evaluate(() => window.aimAt());
  await h.sleep(300);
  await h.shot('prompt');
  await h.press('e', 90);
  await h.sleep(200);
  out.tap = await page.evaluate(() => window.one().order);
  await h.press('e', 800);
  await h.sleep(200);
  out.hold = await page.evaluate(() => window.one().order);

  await page.evaluate(() => window.__allies.downNearest());
  await h.sleep(1500);
  await page.evaluate(() => { const a = window.one(); window.lookAt(a.body.position.x, a.body.position.y + 0.3, a.body.position.z); });
  await h.sleep(300);
  out.down = await page.evaluate(() => ({ state: window.one().state, stims: window.__allies.system.stims?.count ?? 'none' }));
  await h.shot('down');
  await h.press('e', 1400);
  await h.sleep(600);
  out.revived = await page.evaluate(() => ({ state: window.one().state, hp: window.one().health, stims: window.__allies.system.stims?.count ?? 'none' }));
  await h.shot('revived');
  return out;
}
