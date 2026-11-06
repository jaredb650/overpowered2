// Stills of the Test Range: the panel, then bodies frame by frame through the lab's own pause and step.
//   node tools/shot.mjs --url "/?map=range" --script tools/scripts/lab-seq.mjs --dpr 2 --w 1440 --h 900 --wait 500 --timeout 120 --out tools/out/seq.png
export default async function seq(page, h) {
  for (let i = 0; i < 180; i++) {
    if (await page.evaluate(() => !!window.__lab && window.__op2?.game?.state === 'playing')) break;
    await h.sleep(500);
  }
  const step = async n => {
    await page.evaluate(n => window.__lab.step(n), n);
    await h.sleep(70 + n * 45);
  };
  await page.evaluate(() => {
    const lab = window.__lab;
    const { ctx } = window.__op2;
    const V = ctx.player.position.constructor;
    lab.settings.spawn = 'brute';
    lab.flags.gibbing = false;
    ctx.player.teleport(new V(0, 0.1, 13), 0);
    ctx.player.pitch = -0.06;
    window.__spawnAt = (id, x, z, ai = 'off') => lab.spawner.place(id, new V(x, 0, z), ai);
    for (let i = -2; i <= 2; i++) window.__spawnAt(['husk', 'trooper', 'brute', 'gunner', 'burner'][i + 2], i * 3, 6);
  });
  await h.sleep(700);
  await h.keyDown('F1');
  await h.keyUp('F1');
  await h.sleep(300);
  await h.shot('panel');
  await h.keyDown('F1');
  await h.keyUp('F1');
  await page.evaluate(() => {
    const { ctx } = window.__op2;
    const lab = window.__lab;
    const V = ctx.player.position.constructor;
    lab.togglePause();
    ctx.combat.explode(new V(3, 0.3, 7), { radius: 8, damage: 300, kind: 'rocket', source: 'test', team: 'player' });
  });
  await h.shot('blast-0');
  for (let i = 1; i <= 4; i++) {
    await step(9);
    await h.shot(`blast-${i}`);
  }
  await page.evaluate(() => {
    const lab = window.__lab;
    const { ctx } = window.__op2;
    ctx.enemies.reset();
    lab.spawner.clearBodies();
    window.__spawnAt('trooper', 0, 10);
    ctx.weapons.switchTo('shotgun');
    lab.togglePause();
  });
  await h.sleep(800);
  await page.evaluate(() => {
    const { ctx } = window.__op2;
    const V = ctx.player.position.constructor;
    const d = new V(0, 1.15, 10).sub(ctx.player.eye);
    ctx.player.yaw = Math.atan2(-d.x, -d.z);
    ctx.player.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
    window.__lab.togglePause();
    ctx.input.simulate('fire', true);
  });
  await h.sleep(250);
  await page.evaluate(() => window.__op2.ctx.input.simulate('fire', false));
  await h.shot('pb-0');
  for (let i = 1; i <= 4; i++) {
    await step(8);
    await h.shot(`pb-${i}`);
  }
  return page.evaluate(() => ({ throw: window.__lab.overlay.lastThrow, flags: window.__lab.flags }));
}
