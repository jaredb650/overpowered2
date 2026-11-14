// The wall run, gate and shacks on the Test Range: each stage worn by real blasts, an enemy walking through a breach,
// a flattened shack, a blown gate, and a repair.
//   node tools/shot.mjs --url "/?map=range" --script tools/scripts/walls-live.mjs --wait 500 --timeout 220 --dpr 2 --w 1440 --h 900 --out tools/out/walls/x.png
export default async function wallsLive(page, h) {
  for (let i = 0; i < 180; i++) {
    if (await page.evaluate(() => !!window.__lab && window.__op2?.game?.state === 'playing')) break;
    await h.sleep(500);
  }
  await page.evaluate(() => {
    const { ctx } = window.__op2;
    window.V = ctx.player.position.constructor;
    window.W = () => ctx.world.objects.structures;
    window.look = (px, pz, tx, tz) => ctx.player.teleport(new window.V(px, 0.1, pz), Math.atan2(-(tx - px), -(tz - pz)));
    window.boom = (x, y, z, radius = 8, damage = 100) => {
      ctx.combat.explode(new window.V(x, y, z), { radius, damage, kind: 'rocket', source: 'test', team: 'player' });
    };
    window.state = () => window.W().map(s => `${s.kind}#${s.id}:${s.stage}:${Math.round(s.health)}`).join(' ');
  });
  const out = {};
  await page.mouse.click(300, 400);
  await h.sleep(400);

  await page.evaluate(() => window.look(-12, 9, -16, -3));
  await h.sleep(900);
  await h.shot('intact');
  out.intact = await page.evaluate(() => window.state());

  // The segment at x -20: small blasts against its outer face, kept off the gate, until it is damaged.
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => window.boom(-20, 1.2, -0.8, 2.5, 110));
    await h.sleep(250);
  }
  await page.evaluate(() => window.look(-20, 6, -20, 0));
  await h.sleep(2600);
  await h.shot('damaged');
  out.damaged = await page.evaluate(() => window.state());

  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => window.boom(-20, 1.2, -0.8, 2.5, 110));
    await h.sleep(250);
  }
  await h.sleep(2600);
  await h.shot('breached');
  out.breached = await page.evaluate(() => window.state());

  // A husk outside, its AI on: the way to the player is the breach.
  await page.evaluate(() => {
    window.look(-15, 7, -21, -1);
    window.__lab.spawner.place('husk', new window.V(-21, 0, -6), 'on');
  });
  out.husk = [];
  for (let i = 1; i <= 4; i++) {
    await h.sleep(700);
    out.husk.push(await page.evaluate(() => window.__op2.ctx.enemies.alive.map(e => [+e.position.x.toFixed(1), +e.position.y.toFixed(2), +e.position.z.toFixed(1)])[0]));
    await h.shot(`walkthrough${i}`);
  }
  await page.evaluate(() => window.__op2.ctx.enemies.reset());

  // The plank shack: one rocket behind it.
  await page.evaluate(() => window.look(-4, -4, -10, -9));
  await h.sleep(500);
  await h.shot('shack');
  out.shackBefore = await page.evaluate(() => window.state());
  await page.evaluate(() => window.boom(-10.5, 0.6, -10.8));
  await h.sleep(2600);
  await h.shot('shack-flat');
  out.shackAfter = await page.evaluate(() => window.state());

  // The gate: five rockets.
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => window.boom(-16, 1.4, -0.9));
    await h.sleep(250);
  }
  await page.evaluate(() => window.look(-16, 7, -16, 0));
  await h.sleep(2600);
  await h.shot('gate-blown');
  out.blown = await page.evaluate(() => window.state());

  // Repair the breach, a stage at a time.
  await page.evaluate(() => window.look(-20, 6, -20, 0));
  out.repair = await page.evaluate(() => window.W().find(s => s.kind === 'wall' && s.stage === 'breached').repair(2));
  await h.sleep(2600);
  await h.shot('repaired');
  out.repaired = await page.evaluate(() => window.state());
  out.fps = await page.evaluate(() => Math.round(window.__op2.game.fps));
  return out;
}
