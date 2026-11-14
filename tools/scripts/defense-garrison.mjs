// Outpost Defense's free garrison and the minimap's friendlies and shops, then the cost of a full squad of twenty in a fight.
//   node tools/shot.mjs --url "/?contract=defense&autostart=1" --script tools/scripts/defense-garrison.mjs --wait 500 --timeout 300 \
//     --dpr 2 --w 1440 --h 900 --out tools/out/defense2/g.png        (WAVE=5 SECONDS=45)
export default async function defenseGarrison(page, h) {
  const wave = Number(process.env.WAVE ?? 5);
  const seconds = Number(process.env.SECONDS ?? 45);
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
  await h.sleep(2500);
  const squad = () => page.evaluate(() => window.__op2.ctx.allies.allies.map(a => ({
    type: a.type, state: a.state, at: [a.body.position.x, a.body.position.z].map(v => Math.round(v)),
  })));
  out.start = await squad();
  await h.shot('start');

  await page.evaluate(() => {
    const { ctx } = window.__op2;
    if (window.__lab) {
      window.__lab.settings.god = true;
      window.__lab.changed();
    }
    // Stand by the outer ring's nearest rifleman, so the downed man is in view and on the map.
    const a = ctx.allies.allies[0];
    const V = ctx.player.position.constructor;
    ctx.player.teleport(new V(a.body.position.x * 0.8, a.body.position.y + 0.1, a.body.position.z * 0.8));
    window.__allies.downNearest();
  });
  await h.sleep(800);
  out.down = (await squad()).filter(a => a.state === 'down');
  await h.shot('down');

  // Revive him, fill the squad to its cap, and fight.
  out.hired = await page.evaluate(() => {
    const { ctx } = window.__op2;
    const d = window.__defense;
    for (const a of ctx.allies.allies) if (a.state === 'down') ctx.allies.playerRevive(a);
    d.earn(50000);
    const types = ['rifleman', 'gunner', 'shotgunner', 'sniper', 'rocketeer', 'medic', 'riot'];
    const why = [];
    for (let i = 0; i < 16; i++) why.push(d.buy('barracks', { kind: 'ally', type: types[i % types.length] }));
    return { squad: ctx.allies.allies.length, refusals: why.filter(Boolean) };
  });
  await h.sleep(8000);
  await page.evaluate(w => {
    const { ctx } = window.__op2;
    ctx.waves.jumpTo(w);
    window.ms = [];
    window.frames = [];
    let last = performance.now();
    const tick = now => {
      window.frames.push(now - last);
      last = now;
      window.ms.push(ctx.allies.cpuMs);
      if (window.frames.length < 1e5) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, wave);
  await h.sleep(seconds * 1000);
  await h.shot('fight');
  out.fight = await page.evaluate(() => {
    const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return +s[Math.floor(p * (s.length - 1))].toFixed(2); };
    const { ctx } = window.__op2;
    const A = ctx.allies.allies;
    return {
      samples: window.ms.length, allyMedian: q(window.ms, 0.5), allyP95: q(window.ms, 0.95), allyMax: q(window.ms, 1),
      frameMedian: q(window.frames, 0.5), frameP95: q(window.frames, 0.95),
      enemies: ctx.enemies.alive.length, wave: ctx.waves.wave, up: A.filter(a => a.state === 'up').length, down: A.filter(a => a.state === 'down').length,
      firing: A.filter(a => a.target).length,
    };
  });
  return out;
}
