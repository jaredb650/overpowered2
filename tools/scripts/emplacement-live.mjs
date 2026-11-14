// The mounted guns on the Test Range: on the range, manned, firing, overheated, at level 3, shot at, and off again.
//   node tools/shot.mjs --url "/?map=range" --script tools/scripts/emplacement-live.mjs --wait 500 --timeout 200 --dpr 2 --w 1440 --h 900 --out tools/out/emplacement/x.png
export default async function emplacementLive(page, h) {
  for (let i = 0; i < 180; i++) {
    if (await page.evaluate(() => !!window.__lab && window.__op2?.game?.state === 'playing')) break;
    await h.sleep(500);
  }
  await page.evaluate(() => {
    const { ctx } = window.__op2;
    window.V = ctx.player.position.constructor;
    window.guns = () => ctx.progression.callInsManager.emplacements;
    window.state = () => {
      const g = window.guns().all[0];
      return { count: window.guns().all.length, occupant: g.occupant, level: g.levelNumber, heat: +g.heat.value.toFixed(2), overheated: g.heat.overheated, parked: ctx.player.parked, health: Math.round(ctx.player.health), seated: document.querySelector('.hud')?.classList.contains('seated'), alive: ctx.enemies.alive.length, fps: Math.round(window.__op2.game.fps) };
    };
  });
  const out = {};
  await page.mouse.click(300, 400);
  await h.sleep(400);

  // Both guns from behind and to the side.
  await page.evaluate(() => {
    const { ctx } = window.__op2;
    ctx.player.teleport(new window.V(-1.5, 0.1, 14.5), Math.atan2(3.5, 4.5));
    for (const [x, z] of [[-5, -6], [-8, -12], [0, -14], [8, -10], [-14, -6]]) window.__lab.spawner.place('trooper', new window.V(x, 0, z), 'off');
  });
  await h.sleep(800);
  await h.shot('range');
  out.placed = await page.evaluate(() => window.state());

  // Walk on: stand behind the left gun and press E.
  await page.evaluate(() => window.__op2.ctx.player.teleport(new window.V(-5, 0.1, 11.2), 0));
  await h.sleep(300);
  await h.press('e', 80);
  await h.sleep(600);
  out.manned = await page.evaluate(() => window.state());
  await h.shot('manned');

  await page.mouse.down();
  await h.sleep(1500);
  await h.shot('firing');
  out.firing = await page.evaluate(() => window.state());
  await h.sleep(7500);
  out.overheated = await page.evaluate(() => window.state());
  await h.shot('overheated');
  await page.mouse.up();
  await h.sleep(500);

  // Exposed: a trooper with its AI on, in the open, gets a few seconds at the gunner.
  out.healthBefore = await page.evaluate(() => {
    // The range starts in god mode, which would hide whether the gunner can be hit.
    Object.assign(window.__lab.settings, { god: false });
    window.__lab.changed();
    window.__lab.spawner.place('trooper', new window.V(-5, 0, -8), 'on');
    return Math.round(window.__op2.ctx.player.health);
  });
  await h.sleep(5000);
  out.healthAfter = await page.evaluate(() => Math.round(window.__op2.ctx.player.health));
  await page.evaluate(() => {
    Object.assign(window.__lab.settings, { god: true });
    window.__lab.changed();
    window.__op2.ctx.player.heal(500);
  });

  await page.evaluate(() => {
    const g = window.guns().all[0];
    g.heat.value = 0;
    g.heat.overheated = false;
    g.upgrade(3);
    window.__op2.ctx.enemies.reset();
    for (const [x, z] of [[-5, -6], [-10, -12], [-4, -14], [2, -10], [-16, -6]]) window.__lab.spawner.place('trooper', new window.V(x, 0, z), 'off');
  });
  await h.sleep(400);
  await page.mouse.down();
  await h.sleep(1600);
  await h.shot('level3');
  out.level3 = await page.evaluate(() => window.state());
  await page.mouse.up();
  await h.sleep(400);

  await h.press('e', 80);
  await h.sleep(700);
  out.left = await page.evaluate(() => ({ ...window.state(), holstered: window.__op2.ctx.weapons.holstered ?? null }));
  return out;
}
