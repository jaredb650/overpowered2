// Outpost Defense's garrison and shopkeepers in the Bailiffs' bodies (docs/proposals/mission-2-plan.md, stage 1): what every body
// on our side is, then a look at a rifleman on his post and at a shopkeeper behind his counter.
//   node tools/shot.mjs --url "/?contract=defense&autostart=1" --script tools/scripts/bureau-fort.mjs --wait 500 --timeout 240 \
//     --dpr 2 --w 1440 --h 900 --out tools/out/bureau/fort.png
export default async function bureauFort(page, h) {
  const until = async (test, tries = 240) => {
    for (let i = 0; i < tries; i++) {
      if (await page.evaluate(test).catch(() => false)) return true;
      await h.sleep(250);
    }
    return false;
  };
  const out = {};
  out.loadout = await until(() => window.__op2?.ctx?.hud?.screens?.name === 'loadout');
  await h.sleep(500);
  await h.press('Enter', 60);
  out.playing = await until(() => window.__op2.game.state === 'playing', 40);
  await page.mouse.click(300, 400);
  out.keepers = await until(() => (window.__defense?.keepers?.men?.length ?? 0) > 0, 80);
  await h.sleep(1500);
  out.bodies = await page.evaluate(() => {
    const { ctx } = window.__op2;
    return {
      garrison: ctx.allies.allies.map(a => `${a.type}:${a.body.char.archetype}`),
      keepers: (window.__defense.keepers?.men ?? []).map(m => `${m.id}:${m.char.archetype}`),
    };
  });
  // Stand 4 m off a man and look at him; then the same for a shopkeeper.
  const lookAt = (which) => page.evaluate(w => {
    const { ctx } = window.__op2;
    const V = ctx.player.position.constructor;
    const target = w === 'ally' ? ctx.allies.allies[0].body.position : window.__defense.keepers.men[0].char.root.position;
    // A rifleman from the fort's middle side of him (his post faces out), a shopkeeper from across his counter.
    const yaw = w === 'ally' ? Math.atan2(-target.x, -target.z) : window.__defense.keepers.men[0].at.yaw;
    const from = new V(target.x + Math.sin(yaw) * 4, target.y + 0.1, target.z + Math.cos(yaw) * 4);
    ctx.player.teleport(from);
    const eye = ctx.player.eye;
    const dx = target.x - eye.x, dy = target.y + 1.3 - eye.y, dz = target.z - eye.z;
    ctx.player.yaw = Math.atan2(-dx, -dz);
    ctx.player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  }, which);
  if (await page.evaluate(() => !!window.__lab)) await page.evaluate(() => { window.__lab.settings.god = true; window.__lab.changed(); });
  await lookAt('ally');
  await h.sleep(900);
  await h.shot('garrison');
  await lookAt('keeper');
  await h.sleep(900);
  await h.shot('keeper');
  return out;
}
