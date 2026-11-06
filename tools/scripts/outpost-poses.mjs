// Every soldier posture on real bodies, standing still, for looking at. Two rows, two angles each.
//
//   node tools/shot.mjs --url "/?contract=outpost&autostart=1" --dpr 2 --w 1440 --h 900 --script tools/scripts/outpost-poses.mjs --out tools/out/outpost-poses.png --wait 500 --timeout 120
const ROWS = {
  ready: ['stand', 'crouch', 'cover', 'peek', 'leanLeft', 'leanRight'],
  broken: ['handsUp', 'kneel', 'cower', 'flee', 'drag', 'revive', 'downed'],
};
const UNARMED = new Set(['handsUp', 'kneel', 'cower', 'flee']);

export default async function poses(page, h) {
  const started = Date.now();
  while (Date.now() - started < 90000) {
    if (await page.evaluate(() => window.__op2?.game?.state === 'playing')) break;
    await h.sleep(1000);
  }
  await page.evaluate(() => {
    const { ctx } = window.__op2;
    ctx.waves.update = () => {};
    ctx.player.modifiers.invulnerable = true;
    ctx.weapons.setHolstered(true);
    const hud = document.querySelector('#hud');
    if (hud) hud.style.display = 'none';
  });
  const out = {};
  for (const [name, row] of Object.entries(ROWS)) {
    await page.evaluate(({ row, unarmed }) => {
      const { ctx } = window.__op2;
      const em = ctx.enemies;
      for (const e of [...em.alive]) em.withdraw(e);
      ctx.hud.showScreen?.('none');
      const at = ctx.player.position.clone();
      row.forEach((posture, i) => {
        const id = i % 3 === 2 ? 'brute' : i % 3 === 1 ? 'gunner' : 'trooper';
        at.set(-5 + i * (10 / (row.length - 1)), 0.05, -20.6);
        const e = em.spawn(id, at);
        e.behaviours = [];
        e.attacks = [];
        e.dummy = true;
        e.yaw = 0;
        e.face = 'lock';
        e.mode = 'hold';
        e.char.anim.setPosture(posture);
        if (unarmed.includes(posture)) {
          e.char.anim.disarm();
          for (const p of e.char.props) if (p.bone === 7 || p.bone === 10) p.object.visible = false;
        }
      });
      at.set(0, 0.1, -15.6);
      ctx.player.teleport(at, 0);
      ctx.player.yaw = 0;
      ctx.player.pitch = -0.16;
    }, { row, unarmed: [...UNARMED] });
    await h.sleep(1400);
    await h.shot(`${name}-front`);
    await page.evaluate(() => {
      const { ctx } = window.__op2;
      const at = ctx.player.position.clone().set(-7.5, 0.1, -17.2);
      ctx.player.teleport(at, 0);
      ctx.player.yaw = -Math.PI / 2 - 0.42;
      ctx.player.pitch = -0.14;
    });
    await h.sleep(600);
    await h.shot(`${name}-side`);
    out[name] = await page.evaluate(() => window.__op2.ctx.enemies.alive.length);
  }
  return out;
}
