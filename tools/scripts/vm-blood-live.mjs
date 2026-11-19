// Blood on the weapon and the hands (src/weapons/viewmodels/blood.ts) in the real game, on the Test Range: real keys, real
// enemies with their AI off, real kills. Stills of the gun before and after, and what the rig holds after each step.
//
//   node tools/shot.mjs --port <yours> --url "/?map=range" --script tools/scripts/vm-blood-live.mjs --wait 500 --timeout 300 \
//     --dpr 2 --w 1440 --h 900 --out tools/out/<you>/live.png
//
// Steps: a shotgun kill at 1.5 m, a second from the right, the katana through a line, back to the shotgun (it kept its own
// blood), the same gun 80 s later (dried), a far kill (nothing new), and the lab's switch off.
export default async function bloodLive(page, h) {
  for (let i = 0; i < 180; i++) {
    if (await page.evaluate(() => !!window.__lab && window.__op2?.game?.state === 'playing')) break;
    await h.sleep(500);
  }
  await page.evaluate(() => {
    const { ctx } = window.__op2;
    window.frame = () => new Promise(r => requestAnimationFrame(r));
    window.world = async seconds => {
      const end = ctx.time.elapsed + seconds;
      while (ctx.time.elapsed < end) await window.frame();
    };
    window.kills = [];
    ctx.events.on('enemy:killed', k => window.kills.push(`${k.damage.source}:${k.damage.type}@${k.enemy.center.distanceTo(ctx.player.eye).toFixed(1)}`));
    // Every gun, loaded: the range starts with the issue weapons only.
    window.__lab.settings.arsenal = true;
    window.__lab.changed();
    window.start = ctx.player.position.clone();
    window.startYaw = ctx.player.yaw;
    window.line = async (yaw = 0) => {
      ctx.enemies.reset();
      window.__lab.spawner.clearBodies();
      ctx.player.teleport(window.start, window.startYaw);
      ctx.player.pitch = -0.1;
      await window.world(0.3);
      Object.assign(window.__lab.settings, { spawn: 'trooper', ai: 'off' });
      window.__lab.changed();
      window.__lab.melee(false);
      await window.world(0.5);
      ctx.player.yaw = window.startYaw + yaw;
      await window.world(0.2);
    };
    window.blood = () => {
      const b = ctx.viewmodel.mats.blood;
      const r = v => +v.toFixed(2);
      return { weapon: ctx.weapons.current, gun: r(b.gun.uBloodOn.value), handR: r(b.handR.uBloodOn.value), handL: r(b.handL.uBloodOn.value), handWet: b.handR.uBloodB.value.map(v => r(v.y)), kills: window.kills.splice(0) };
    };
  });
  const out = {};
  const draw = id => page.evaluate(async w => {
    window.__lab.draw(w);
    await window.world(0.6);
  }, id);
  // Held long enough to be seen by a frame however slow the page runs.
  const fire = async (ms = 260) => {
    await page.mouse.down();
    await h.sleep(ms);
    await page.mouse.up();
  };
  const read = () => page.evaluate(() => window.blood());
  /**
   * A killing shell into the nearest man's chest, through the game's own damage call: the same path a real shot takes from
   * the hit on, and it does not depend on a key being held across a frame of a slow page.
   */
  const killOne = () => page.evaluate(async () => {
    const { ctx } = window.__op2;
    const man = [...ctx.enemies.alive].sort((a, b) => a.center.distanceTo(ctx.player.eye) - b.center.distanceTo(ctx.player.eye))[0];
    const dir = man.center.clone().sub(ctx.player.eye).normalize();
    ctx.enemies.applyDamage(man, { amount: 400, type: 'pellet', point: man.center.clone(), dir, force: 0, source: 'shotgun' });
    await window.world(0.3);
  });
  await page.mouse.click(400, 500);
  await h.sleep(500);

  await page.evaluate(() => window.line());
  await draw('shotgun');
  await h.shot('1-shotgun-clean');
  out.clean = await read();
  await killOne();
  await h.shot('2-shotgun-one-kill');
  out.oneKill = await read();

  // A second man, standing off to the right of where the gun points, so his blood comes from that side.
  await page.evaluate(() => window.line(0.5));
  await page.evaluate(async () => { window.__op2.ctx.player.yaw = window.startYaw; await window.world(0.1); });
  await killOne();
  await h.shot('3-shotgun-two-kills');
  out.twoKills = await read();

  await page.evaluate(() => window.line());
  await draw('sword');
  await h.shot('4-sword-clean-hands-bloody');
  out.swordDrawn = await read();
  await page.mouse.down();
  await h.sleep(1000);
  await page.mouse.up();
  await h.sleep(700);
  await h.shot('5-sword-after-chain');
  out.swordAfter = await read();

  await draw('shotgun');
  await h.shot('6-shotgun-again');
  out.shotgunAgain = await read();
  await page.evaluate(async () => { window.__op2.ctx.viewmodel.bloodClock += 80; await window.world(0.1); });
  await h.shot('7-shotgun-dried');
  out.dried = await read();

  // A far kill leaves nothing: the last man of the line, 8 m off, with the Judge out.
  await page.evaluate(() => window.line());
  await draw('judge');
  await page.evaluate(async () => {
    const { ctx } = window.__op2;
    const man = [...ctx.enemies.alive].sort((a, b) => b.center.distanceTo(ctx.player.eye) - a.center.distanceTo(ctx.player.eye))[0];
    ctx.enemies.applyDamage(man, { amount: 400, type: 'bullet', point: man.center.clone(), dir: man.center.clone().sub(ctx.player.eye).normalize(), force: 0, source: 'judge' });
    await window.world(0.3);
  });
  out.farKill = await read();

  await draw('shotgun');
  await page.evaluate(async () => { window.__lab.settings.vmBlood = false; window.__lab.changed(); await window.world(0.1); });
  await h.shot('8-switch-off');
  out.switchedOff = await read();
  await page.evaluate(async () => { window.__lab.settings.vmBlood = true; window.__lab.changed(); await window.world(0.1); });
  return out;
}
