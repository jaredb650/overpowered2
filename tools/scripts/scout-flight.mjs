export default async function flight(page, helpers) {
  await page.waitForFunction(() => window.__lab && window.__op2?.game?.state === 'playing', null, { timeout: 120000 });
  await page.mouse.click(300, 400);
  await page.evaluate(() => {
    const { ctx } = window.__op2;
    const player = ctx.player;
    const Vector = player.position.constructor;
    window.flight = {
      async wait(seconds) {
        const end = ctx.time.playerElapsed + seconds;
        while (ctx.time.playerElapsed < end) await new Promise(resolve => requestAnimationFrame(resolve));
      },
      async tap(action, seconds = 0.02) {
        ctx.time.paused = false;
        ctx.input.simulate(action, true);
        await this.wait(0.02);
        ctx.input.simulate(action, false);
        await this.wait(seconds);
        ctx.time.paused = true;
      },
      place() {
        player.teleport(new Vector(-25, 7, -4), -Math.PI / 2);
        player.pitch = 0;
        player.velocity.set(0, 0, 0);
        player.park(player.position.clone());
      },
      observe(centre, distance) {
        const eye = centre.clone().add(new Vector(-2, 1, distance));
        player.teleport(eye.clone().add(new Vector(0, -1.53, 0)), 0);
        const delta = centre.clone().sub(eye);
        player.yaw = Math.atan2(-delta.x, -delta.z);
        player.pitch = Math.asin(delta.y / delta.length());
        player.velocity.set(0, 0, 0);
        ctx.viewmodel.setScoped(true);
      },
    };
    ctx.time.paused = false;
    player.modifiers.invulnerable = true;
    window.__lab.settings.overlay = false;
    window.__lab.settings.arsenal = false;
    ctx.weapons.give('awl');
    ctx.weapons.switchTo('awl');
    const tracer = ctx.fx.tracer.bind(ctx.fx);
    ctx.fx.tracer = (from, to, kind) => {
      if (kind === 'scout') window.flight.trace = { from: from.toArray(), to: to.toArray() };
      return tracer(from, to, kind);
    };
  });
  const wait = seconds => page.evaluate(seconds => window.flight.wait(seconds), seconds);
  const shot = async name => {
    await page.evaluate(() => { window.__op2.ctx.time.paused = true; });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await helpers.shot(name);
  };
  await wait(0.5);
  await page.evaluate(() => window.flight.place());
  await wait(0.02);
  await page.evaluate(() => window.flight.tap('fire'));
  await page.evaluate(() => {
    const Vector = window.__op2.ctx.player.position.constructor;
    const from = new Vector(...window.flight.trace.from);
    const to = new Vector(...window.flight.trace.to);
    window.flight.observe(from.lerp(to, 0.3), 6);
  });
  await shot('thin-trail');
  await page.evaluate(() => {
    const { ctx } = window.__op2;
    ctx.viewmodel.setScoped(false);
    ctx.weapons.give('quiver');
    ctx.weapons.switchTo('quiver');
    ctx.time.paused = false;
  });
  await wait(0.6);
  await page.evaluate(() => window.flight.place());
  await wait(0.02);
  await page.evaluate(() => window.flight.tap('aim', 0.43));
  const rockets = await page.evaluate(() => {
    const { ctx } = window.__op2;
    const Vector = ctx.player.position.constructor;
    const rockets = ctx.combat.projectiles.active.filter(rocket => rocket.source === 'quiver');
    const centre = rockets.reduce((sum, rocket) => sum.add(rocket.position), new Vector()).multiplyScalar(0.25);
    window.flight.observe(centre.clone().add(new Vector(-7, 0, 0)), 13);
    return rockets.map(rocket => ({ at: rocket.position.toArray(), helix: rocket.helix }));
  });
  await shot('quiver-helix');
  if (rockets.length !== 4) throw new Error(`Expected four rockets in clear air, saw ${rockets.length}`);
  return { rockets, trace: await page.evaluate(() => window.flight.trace) };
}
