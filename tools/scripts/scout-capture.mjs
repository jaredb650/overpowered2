export default async function capture(page, helpers) {
  const sandbox = new URL(page.url()).searchParams.get('sandbox') === 'viewmodels';
  if (sandbox) {
    await page.waitForFunction(() => window.__vm, null, { timeout: 120000 });
    await page.evaluate(() => {
      const scene = window.__vm;
      if (!scene.rig.allDefs.awl) throw new Error('The dev server has not loaded the Awl model');
      scene.rig.equip('awl', 0.01);
      scene.ammo.magSize = scene.ammo.mag = 5;
      scene.step(0.6);
    });
    await helpers.shot('hip-studio');
    await page.evaluate(() => window.__vm.rig.fire(1));
    let elapsed = 0;
    for (const seconds of [0.12, 0.24, 0.3, 0.42, 0.65, 0.78, 0.9, 0.96]) {
      await page.evaluate(delta => window.__vm.step(delta), seconds - elapsed);
      elapsed = seconds;
      await helpers.sleep(80);
      await helpers.shot(`bolt-${Math.round(seconds * 1000)}`);
    }
    return page.evaluate(() => ({ triangles: window.__vm.rig.allDefs.awl.model.triangles, draws: window.__vm.rig.allDefs.awl.model.draws }));
  }
  await page.waitForFunction(() => window.__lab && window.__op2?.game?.state === 'playing', null, { timeout: 120000 });
  await page.mouse.click(300, 400);
  await page.evaluate(() => {
    const { ctx } = window.__op2;
    const player = ctx.player;
    const Vector = player.position.constructor;
    window.scout = {
      async wait(seconds) {
        const end = ctx.time.playerElapsed + seconds;
        while (ctx.time.playerElapsed < end) await new Promise(resolve => requestAnimationFrame(resolve));
      },
      async tap(action) {
        ctx.input.simulate(action, true);
        await this.wait(0.035);
        ctx.input.simulate(action, false);
        await this.wait(0.035);
      },
      place() {
        player.teleport(new Vector(-29, 0.1, 4.7), -Math.PI / 2);
        player.pitch = 0;
        player.velocity.set(0, 0, 0);
      },
      aimAt(at) {
        const delta = new Vector(...at).sub(player.position.clone().add(new Vector(0, 1.53, 0)));
        player.yaw = Math.atan2(-delta.x, -delta.z);
        player.pitch = Math.asin(delta.y / delta.length());
      },
    };
    player.modifiers.invulnerable = true;
    window.__lab.settings.overlay = false;
    window.__lab.settings.arsenal = false;
    ctx.time.paused = false;
    window.scout.place();
    ctx.weapons.give('awl');
    ctx.weapons.switchTo('awl');
    window.__lab.spawner.place('trooper', new Vector(26, 0.1, 4.7), 'off');
  });
  const wait = seconds => page.evaluate(seconds => window.scout.wait(seconds), seconds);
  const tap = action => page.evaluate(action => window.scout.tap(action), action);
  const shot = async name => {
    await page.evaluate(() => { window.__op2.ctx.time.paused = true; });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await helpers.shot(name);
    await page.evaluate(() => { window.__op2.ctx.time.paused = false; });
  };
  await wait(0.8);
  await shot('hip');
  await tap('aim');
  await wait(0.4);
  await shot('scope');
  await tap('aim');
  await page.evaluate(() => {
    const weapon = window.__op2.ctx.weapons;
    weapon.grantMod('awlAcog');
    weapon.fitMod('awlAcog', true);
  });
  await tap('aim');
  await wait(0.6);
  await shot('acog');
  await tap('aim');
  await page.evaluate(() => {
    const weapon = window.__op2.ctx.weapons;
    weapon.fitMod('awlAcog', false);
    weapon.grantMod('awlCan');
    weapon.fitMod('awlCan', true);
  });
  await wait(0.4);
  await shot('suppressor');
  return page.evaluate(() => ({ fov: window.__op2.ctx.render.camera.fov }));
}
