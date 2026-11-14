// Outpost Defense on the new fort, for its frame cost: the player stands at a few places (a crenel on the outer catwalk, a tower,
// the core) while the first wave comes, and the run reports draw calls, triangles and CPU ms at each, with a picture.
//   node tools/shot.mjs --url "/?map=fort&allies=6&autostart=1" --script tools/scripts/fort-game.mjs --wait 500 --timeout 300 --dpr 2 --w 1440 --h 900 --out tools/out/fort2/g.png
export default async function fortGame(page, h) {
  for (let i = 0; i < 240; i++) {
    if (await page.evaluate(() => window.__op2?.game?.state === 'playing')) break;
    await h.sleep(500);
  }
  // Through the loadout with what it offers, then straight into the first wave.
  for (let i = 0; i < 60; i++) {
    if (await page.evaluate(() => window.__op2?.ctx?.hud?.screens?.name === 'loadout')) break;
    await h.sleep(500);
  }
  await page.evaluate(() => [...document.querySelectorAll('.scr-loadout *')].find(e => e.children.length === 0 && e.textContent.trim() === 'Deploy')?.click());
  await h.sleep(600);
  if (await page.evaluate(() => window.__op2?.ctx?.hud?.screens?.name === 'loadout')) {
    for (let i = 0; i < 6; i++) await h.press('ArrowDown', 60);
    await h.press('Enter', 60);
  }
  await h.sleep(800);
  await page.mouse.click(700, 450);
  await page.evaluate(() => window.__defense?.skipBreak?.());
  await h.sleep(6000);
  const place = (x, y, z, yaw) => page.evaluate(([x, y, z, yaw]) => {
    const { ctx } = window.__op2;
    const V = ctx.player.position.constructor;
    ctx.player.teleport(new V(x, y, z), yaw);
  }, [x, y, z, yaw]);
  const sample = async seconds => {
    const out = [];
    for (let i = 0; i < seconds; i++) {
      await h.sleep(1000);
      out.push(await page.evaluate(() => window.__op2.stats()));
    }
    const pick = k => out.map(s => s[k]).filter(v => typeof v === 'number');
    const range = k => [Math.min(...pick(k)), Math.max(...pick(k))];
    return { draws: range('drawCalls'), tris: range('triangles'), cpuMs: range('cpuMs'), fps: range('fps'), enemies: range('enemies') };
  };
  const out = {};
  // At a crenel on the outer north catwalk, looking out; in the north-west tower; in the core.
  for (const [name, x, y, z, yaw] of [
    ['crenel', -17.3, 3.82, -50.95, 0], ['tower', -49.6, 7.02, -49.6, Math.PI / 4], ['core', 1, 0.05, 3, Math.PI], ['crenel2', -17.3, 3.82, -50.95, 0],
  ]) {
    await place(x, y, z, yaw);
    await h.sleep(600);
    out[name] = await sample(Number(process.env.FORT_SECONDS ?? 8));
    await h.shot(name);
  }
  return out;
}
