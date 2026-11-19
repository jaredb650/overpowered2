// What a gib costs, and what the first one of a session costs over the rest (the stall): a row of bodies on the Test Range,
// each burst by a rocket of its own with the world stepped between, timing the call and the frames after it.
//
//   node tools/shot.mjs --port <yours> --url "/?map=range" --script tools/scripts/gib-cost.mjs --dpr 2 --w 1440 --h 900 \
//     --wait 500 --timeout 240 --quiet --out tools/out/<you>/cost.png
//
// GIB_ID the archetype (trooper), GIB_N how many in the row (8), GIB_CROWD bodies burst by each rocket (1).
// Reports per gib: `call` ms inside `combat.explode` (the damage, the gib and every piece it throws), `frame` ms the
// slowest of the next four frames took (where a program compiling or a texture uploading shows), the draw calls and the
// physics bodies at the peak. The first row is the first gib since the page loaded.
const ID = process.env.GIB_ID ?? 'trooper';
const N = Number(process.env.GIB_N ?? 8);
const CROWD = Number(process.env.GIB_CROWD ?? 1);

export default async function gibCost(page, h) {
  for (let i = 0; i < 180; i++) {
    if (await page.evaluate(() => !!window.__lab && window.__op2?.game?.state === 'playing')) break;
    await h.sleep(500);
  }
  const rows = await page.evaluate(async ({ ID, N, CROWD }) => {
    const lab = window.__lab;
    const { ctx, game } = window.__op2;
    const V = ctx.player.position.constructor;
    lab.settings.progression = false;
    lab.flags.progression = false;
    ctx.player.modifiers.invulnerable = true;
    const frame = () => new Promise(r => requestAnimationFrame(r));
    const walk = async frames => {
      lab.step(frames);
      while (lab.steps > 0) await frame();
      await frame();
    };
    ctx.enemies.killAll('lab');
    ctx.enemies.reset();
    lab.spawner.clearBodies();
    ctx.player.teleport(new V(0, 0.1, 12), 0);
    await frame();
    if (!lab.paused) lab.togglePause();
    const rows = [];
    for (let i = 0; i < N; i++) {
      const x = (i - (N - 1) / 2) * 2.6;
      for (let k = 0; k < CROWD; k++) lab.spawner.place(ID, new V(x + (k % 2) * 0.7, 0, 2 - Math.floor(k / 2) * 0.7), 'off');
      await walk(30);
      const info = ctx.render.renderer.info;
      const before = { calls: info.render.calls, bodies: ctx.physics.world.bodies.len(), programs: info.programs.length, names: new Set(info.programs.map(p => p.cacheKey)) };
      const t0 = performance.now();
      ctx.combat.explode(new V(x + 0.2, 0.25, 2.1), { radius: 8, damage: 100, kind: 'rocket', source: 'test', team: 'player' });
      const call = performance.now() - t0;
      let worst = 0;
      let calls = 0;
      let bodies = 0;
      lab.step(4);
      for (let f = 0; f < 4; f++) {
        const a = performance.now();
        await frame();
        worst = Math.max(worst, performance.now() - a);
        calls = Math.max(calls, info.render.calls);
        bodies = Math.max(bodies, ctx.physics.world.bodies.len());
      }
      const s = ctx.gore.stats();
      const fresh = info.programs.filter(p => !before.names.has(p.cacheKey)).map(p => `${p.name || p.type}:${p.cacheKey.replace(/\s+/g, ' ').slice(0, 140)}`);
      rows.push({ i, call: +call.toFixed(1), frame: +worst.toFixed(1), programs: info.programs.length - before.programs, fresh, calls: calls - before.calls, bodies: bodies - before.bodies, halves: s.halves, chunkBodies: s.chunkBodies, limbs: s.limbs });
      await walk(80);
    }
    void game;
    return rows;
  }, { ID, N, CROWD });
  const rest = rows.slice(1);
  const mid = a => [...a].sort((x, y) => x - y)[a.length >> 1];
  return { first: rows[0], p50: { call: mid(rest.map(r => r.call)), frame: mid(rest.map(r => r.frame)), calls: mid(rest.map(r => r.calls)), bodies: mid(rest.map(r => r.bodies)) }, rows };
}
