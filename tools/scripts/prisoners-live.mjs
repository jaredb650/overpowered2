// A prisoner cuffed and snatched by the drone, in real Chrome: the cuffed man, the drone diving in with the hook, the yank (with the
// BOUNTY SECURED popup), and him ragdolling on the line. Outpost Defense by default, for the credits; `?contract=outpost` works too.
// Two men: the first is cuffed from behind for the close-up, the second is watched from the side of the pass. The pass is photographed
// at a fifth of world speed (`time.pushScale`, no grade), because a screenshot takes longer than the whole snatch.
//
//   node tools/shot.mjs --url "/?contract=defense&autostart=1" --dpr 2 --w 1440 --h 900 --script tools/scripts/prisoners-live.mjs --out tools/out/prisoners/prisoners.png --wait 500 --timeout 220
export default async function prisoners(page, h) {
  const out = {};
  const shot = name => h.shot(name).catch(e => console.error(`shot ${name} failed: ${e.message.split('\n')[0]}`));
  const until = async (test, ms = 60000, every = 100, arg = null) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (await page.evaluate(test, arg)) return true;
      await h.sleep(every);
    }
    return false;
  };
  await until(() => !!window.__op2?.ctx, 90000, 500);
  const defense = await page.evaluate(() => !!window.__op2.ctx.contracts?.defense);
  if (defense) {
    await until(() => window.__op2.ctx.hud?.screens?.name === 'loadout', 90000, 250);
    await h.sleep(600);
    // Focus starts on Deploy: the default loadout.
    await h.press('Enter', 60);
  }
  out.playing = await until(() => window.__op2.game.state === 'playing', 60000, 250);
  await h.sleep(800);
  out.setup = await page.evaluate(() => {
    const { ctx } = window.__op2;
    const o = ctx.enemies.outpost;
    window.__ctx = ctx;
    window.__o = o;
    ctx.player.maxHealth = ctx.player.health = 1e5;
    ctx.waves.update = () => {};
    for (const e of [...ctx.enemies.alive]) ctx.enemies.withdraw(e);
    window.__look = (x, y, z) => {
      const p = ctx.player;
      p.yaw = Math.atan2(-(x - p.position.x), -(z - p.position.z));
      p.pitch = Math.atan2(y - p.eye.y, Math.hypot(x - p.position.x, z - p.position.z));
    };
    window.__stand = (x, z) => {
      const at = ctx.player.position.clone().set(x, ctx.player.position.y, z);
      ctx.world.nav.nearest(at, 3, at);
      ctx.player.teleport(at.setY(at.y + 0.1), 0);
    };
    window.__held = man => o.captives.airlift.held.find(x => x.c.s.e === man);
    window.__feed = [];
    const feed = ctx.hud.feed.bind(ctx.hud);
    ctx.hud.feed = (text, color) => { window.__feed.push(text); feed(text, color); };
    window.__credits = ctx.contracts.wallet?.credits ?? null;
    // Two men kneeling in front of the player, 12 m apart.
    const p = ctx.player.position;
    const men = [-6, 6].map(dx => {
      const at = p.clone();
      at.x += dx;
      at.z -= 4;
      ctx.world.nav.nearest(at, 3, at);
      o.formSquad(1, at);
      o.squads[o.squads.length - 1].grade = 'veteran';
      const e = ctx.enemies.spawn('trooper', at);
      o.collapse(o.soldierOf(e), 'surrender');
      return e;
    });
    window.__men = men;
    return men.map(e => e.position.toArray().map(v => +v.toFixed(1)));
  });
  await h.sleep(1800);

  // The first, from behind: cuffed, hands behind his back.
  await page.evaluate(() => {
    const e = window.__men[0];
    window.__stand(e.position.x - Math.sin(e.yaw) * 1.4, e.position.z - Math.cos(e.yaw) * 1.4);
    window.__look(e.position.x, e.position.y + 0.5, e.position.z);
  });
  await h.sleep(400);
  await page.evaluate(() => window.__ctx.input.simulate('interact', true));
  await until(() => window.__o.soldierOf(window.__men[0])?.cuffed === true, 3000, 20);
  await page.evaluate(() => window.__ctx.input.simulate('interact', false));
  await until(() => (window.__held(window.__men[0])?.clicks ?? 0) >= 2, 3000, 20);
  await page.evaluate(() => window.__look(window.__men[0].position.x, window.__men[0].position.y + 0.45, window.__men[0].position.z));
  await shot('cuffed');
  out.first = await page.evaluate(() => ({ cuffed: window.__o.soldierOf(window.__men[0])?.cuffed }));
  await h.sleep(5000);

  // The second, from the side of the pass.
  await page.evaluate(() => {
    const e = window.__men[1];
    window.__stand(e.position.x, e.position.z + 2);
    window.__look(e.position.x, e.position.y + 0.6, e.position.z);
  });
  await h.sleep(500);
  await page.evaluate(() => window.__ctx.input.simulate('interact', true));
  await until(() => window.__o.soldierOf(window.__men[1])?.cuffed === true, 3000, 20);
  await page.evaluate(() => {
    const { ctx } = window.__op2;
    ctx.input.simulate('interact', false);
    ctx.time.pushScale('photo', 0.2, 0.01, 0.01);
    const held = window.__held(window.__men[1]);
    // Eight metres out to the side of the pass, a little ahead of where it takes him.
    const side = { x: held.dir.z, z: -held.dir.x };
    window.__stand(held.at.x + side.x * 8 + held.dir.x * 2, held.at.z + side.z * 8 + held.dir.z * 2);
    window.__look(held.at.x, held.at.y + 2, held.at.z);
  });
  const s = () => page.evaluate(() => {
    const held = window.__held(window.__men[1]);
    return held ? held.age - held.snatchAt : 99;
  });
  // Frame the hook and the drone together, `k` of the way up to the drone.
  const frame = k => page.evaluate(k => {
    const held = window.__held(window.__men[1]);
    const d = held?.drone;
    if (!d) return;
    const l = held.load;
    window.__look(l.x + (d.pos.x - l.x) * k, l.y + (d.pos.y - l.y) * k, l.z + (d.pos.z - l.z) * k);
  }, k);
  await until(async () => true, 1, 1);
  const t0 = Date.now();
  while (Date.now() - t0 < 20000 && (await s()) < -0.4) {
    await frame(0.3);
    await h.sleep(15);
  }
  await frame(0.3);
  await shot('zip');
  out.zip = await s();
  while (Date.now() - t0 < 25000 && (await s()) < 0.05) await h.sleep(15);
  await frame(0.25);
  await shot('yank');
  out.yank = await s();
  while (Date.now() - t0 < 30000 && (await s()) < 0.4) {
    await frame(0.2);
    await h.sleep(15);
  }
  await frame(0.2);
  await shot('ragdoll');
  out.ragdoll = await page.evaluate(() => {
    const held = window.__held(window.__men[1]);
    return { s: held ? +(held.age - held.snatchAt).toFixed(2) : null, limp: held?.limp, downed: window.__men[1].downed, phase: held?.c.phase };
  });
  await page.evaluate(() => window.__ctx.time.popScale('photo'));
  await h.sleep(6000);
  out.after = await page.evaluate(() => ({
    gone: window.__men.map(e => !e.alive), flying: window.__o.captives.airlift.flying, feed: window.__feed,
    credits: window.__ctx.contracts.wallet?.credits ?? null, before: window.__credits,
  }));
  return out;
}
