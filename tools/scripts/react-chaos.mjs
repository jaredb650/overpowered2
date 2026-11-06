// A crowd on the Test Range under fire and blasts, AI on, to find what the frame-by-frame sheets cannot: the budget, the
// handover under load, and bodies that never get up.
//   node tools/shot.mjs --url "/?map=range" --script tools/scripts/react-chaos.mjs --wait 500 --timeout 120 --out tools/out/chaos.png
export default async function chaos(page, h) {
  for (let i = 0; i < 180; i++) {
    if (await page.evaluate(() => !!window.__lab && window.__op2?.game?.state === 'playing')) break;
    await h.sleep(500);
  }
  const result = await page.evaluate(async () => {
    const lab = window.__lab;
    const { ctx, game } = window.__op2;
    const V = ctx.player.position.constructor;
    lab.settings.progression = false;
    lab.flags.progression = false;
    ctx.player.modifiers.invulnerable = true;
    ctx.player.teleport(new V(0, 0.1, 20), 0);
    const frame = () => new Promise(r => requestAnimationFrame(r));
    const until = async (test, seconds) => {
      const end = ctx.time.elapsed + seconds;
      while (ctx.time.elapsed < end && !test()) await frame();
    };
    const ids = ['trooper', 'gunner', 'husk', 'riot', 'stalker', 'brute', 'burner', 'warden'];
    const spawned = [];
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      spawned.push(lab.spawner.place(ids[i % ids.length], new V(Math.cos(a) * 9, 0, Math.sin(a) * 9), 'on'));
    }
    const peak = { knockdowns: 0, ragdolls: 0, collapses: 0, step: 0, cpu: 0 };
    let downs = 0;
    let rises = 0;
    const was = new Map();
    const watch = () => {
      const s = ctx.gore.stats();
      peak.knockdowns = Math.max(peak.knockdowns, s.knockdowns);
      peak.ragdolls = Math.max(peak.ragdolls, s.ragdolls);
      peak.collapses = Math.max(peak.collapses, s.collapses);
      peak.step = Math.max(peak.step, ctx.physics.stepMs);
      for (const e of ctx.enemies.alive) {
        const before = was.get(e) ?? false;
        if (e.downed && !before) downs++;
        if (!e.downed && before) rises++;
        was.set(e, e.downed);
      }
    };
    const end = ctx.time.elapsed + 12;
    let nextBlast = 0;
    while (ctx.time.elapsed < end) {
      await frame();
      watch();
      if (ctx.time.elapsed < nextBlast) continue;
      nextBlast = ctx.time.elapsed + 0.45;
      const list = ctx.enemies.alive;
      if (list.length === 0) break;
      const e = list[Math.floor(Math.random() * list.length)];
      const at = e.position.clone();
      at.x += (Math.random() - 0.5) * 6;
      at.z += (Math.random() - 0.5) * 6;
      at.y = 0.3;
      ctx.combat.explode(at, { radius: 5, damage: 26, kind: 'rocket', source: 'test', team: 'player' });
      for (let i = 0; i < 4; i++) {
        const o = list[Math.floor(Math.random() * list.length)];
        if (!o?.alive) continue;
        const region = ['chest', 'legL', 'armR', 'head', 'shinR', 'abdomen'][i + Math.floor(Math.random() * 3)];
        const bone = o.char.rig.bones.findIndex(b => b.region === region);
        const point = new V().setFromMatrixPosition(o.char.bones[Math.max(bone, 0)].matrixWorld);
        ctx.enemies.applyDamage(o, { amount: 9, type: 'bullet', point, dir: new V(0, 0, -1), force: 22, source: 'test', region, bone: bone >= 0 ? bone : undefined });
      }
    }
    const left = ctx.enemies.alive.length;
    await until(() => ctx.enemies.alive.every(e => !e.downed && e.rising <= 0), 9);
    watch();
    const floor = ctx.enemies.alive.filter(e => e.downed || e.rising > 0).length;
    const bad = ctx.enemies.alive.filter(e => !Number.isFinite(e.position.x + e.position.y + e.position.z) || e.position.y < -2 || e.position.y > 12).length;
    return { downs, rises, peak, left, stillDown: floor, bad, stats: game.stats() };
  });
  await h.shot('end');
  return result;
}
