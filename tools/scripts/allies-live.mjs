// Allies on the Test Range: a squad against an enemy squad, the green crosshair, CHECK FIRE, orders on E, a revive, and the
// frame cost of eight.
//   node tools/shot.mjs --url "/?map=range&contract=outpost&allies=6&foes=5" --script tools/scripts/allies-live.mjs \
//     --wait 500 --timeout 220 --dpr 2 --w 1440 --h 900 --out tools/out/allies/x.png
// Other agents' edits can make the dev server reload the page mid-run, so every step reinstalls what it needs.
function install() {
  if (window.sum) return;
  const { ctx } = window.__op2;
  const A = window.__allies.system;
  window.V = ctx.player.position.constructor;
  window.lookAt = (x, y, z) => {
    const p = ctx.player.eye;
    const dx = x - p.x, dy = y - p.y, dz = z - p.z;
    ctx.player.yaw = Math.atan2(-dx, -dz);
    ctx.player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  };
  window.sum = () => ({
    allies: A.allies.map(a => ({
      t: a.type, s: a.state, o: a.order, hp: Math.round(a.health), x: +a.body.position.x.toFixed(1), z: +a.body.position.z.toFixed(1),
      tgt: a.target ? a.target.id : a.hasArmour ? 'armour' : null, spot: !!a.spot, mag: a.mag,
    })),
    enemies: ctx.enemies.alive.length,
    foes: (ctx.enemies.outpost?.soldiers ?? []).filter(s => s.foe).length,
    score: ctx.progression.score ?? null,
    combo: ctx.progression.combo ?? null,
    reticle: document.querySelector('.xh-reticle')?.className ?? null,
  });
  // Watch who kills whom.
  window.kills = { ally: 0, other: 0 };
  ctx.events.on('enemy:killed', k => { if (/^ally_/.test(k.damage.source)) window.kills.ally++; else window.kills.other++; });
  window.allyEvents = [];
  for (const n of ['ally:down', 'ally:revived', 'ally:dead', 'ally:order', 'ally:checkFire']) ctx.events.on(n, e => window.allyEvents.push(`${n}:${e.ally.type}`));
  // God mode on, so the run is about the allies; the player never fires unless told to.
  window.__lab.settings.god = true;
  window.__lab.changed();
}

export default async function alliesLive(page, h) {
  const raw = page.evaluate.bind(page);
  page.evaluate = async (fn, arg) => {
    await raw(install).catch(() => {});
    return raw(fn, arg);
  };
  for (let i = 0; i < 180; i++) {
    if (await page.evaluate(() => !!window.__allies && window.__op2?.game?.state === 'playing' && window.__allies.system.allies.length > 0)) break;
    await h.sleep(500);
  }
  const out = {};
  await page.mouse.click(300, 400);
  await h.sleep(300);
  out.start = await page.evaluate(() => window.sum());
  // From beside the squad, looking along it at the enemy.
  await page.evaluate(() => {
    const A = window.__allies.system.allies;
    let x = 0, z = 0;
    for (const a of A) { x += a.body.position.x / A.length; z += a.body.position.z / A.length; }
    window.__op2.ctx.player.teleport(new window.V(x + 9, 0.1, z + 7));
    window.lookAt(x, 1.2, z - 3);
  });
  await h.sleep(1200);
  await h.shot('squad');

  await h.sleep(7000);
  out.fight7 = await page.evaluate(() => ({ ...window.sum(), kills: { ...window.kills } }));
  await h.shot('fight');
  await h.sleep(8000);
  out.fight15 = await page.evaluate(() => ({ ...window.sum(), kills: { ...window.kills }, events: window.allyEvents.slice() }));

  // The crosshair on an ally, from behind the squad.
  out.crosshair = await page.evaluate(() => {
    const a = window.__allies.system.allies.find(x => x.state === 'up');
    if (!a) return null;
    const { ctx } = window.__op2;
    ctx.player.teleport(new window.V(a.body.position.x + 1, 0.1, a.body.position.z + 6));
    return a.type;
  });
  await h.sleep(200);
  await page.evaluate(() => {
    const a = window.__allies.system.allies.find(x => x.state === 'up');
    if (a) window.lookAt(a.body.center.x, a.body.center.y, a.body.center.z);
  });
  await h.sleep(400);
  out.reticleOnAlly = await page.evaluate(() => document.querySelector('.xh-reticle')?.className);
  await h.shot('friendly');

  // Fire through him: no damage, CHECK FIRE.
  out.beforeFire = await page.evaluate(() => window.__allies.system.allies.map(a => Math.round(a.health)));
  await page.evaluate(() => {
    const a = window.__allies.system.allies.find(x => x.state === 'up');
    if (a) window.lookAt(a.body.center.x, a.body.center.y, a.body.center.z);
  });
  await page.mouse.down();
  await h.sleep(250);
  await page.mouse.up();
  await h.sleep(150);
  await h.shot('checkfire');
  out.afterFire = await page.evaluate(() => ({ hp: window.__allies.system.allies.map(a => Math.round(a.health)), events: window.allyEvents.filter(e => e.startsWith('ally:checkFire')).length }));

  // Orders: walk up to one, tap E. Then hold E for the squad, and walk off.
  await page.evaluate(() => {
    const a = window.__allies.system.allies.find(x => x.state === 'up');
    const { ctx } = window.__op2;
    ctx.player.teleport(new window.V(a.body.position.x, 0.1, a.body.position.z + 2.2));
  });
  await h.sleep(200);
  await page.evaluate(() => {
    const a = window.__allies.system.allies.find(x => x.state === 'up');
    window.lookAt(a.body.center.x, a.body.center.y, a.body.center.z);
  });
  await h.sleep(300);
  await h.shot('prompt');
  await h.press('e', 90);
  await h.sleep(300);
  out.tapped = await page.evaluate(() => window.__allies.system.allies.map(a => a.order));
  await h.press('e', 800);
  await h.sleep(300);
  out.held = await page.evaluate(() => window.__allies.system.allies.map(a => a.order));
  // Walk back toward the spawn: they should come along behind.
  await page.evaluate(() => {
    window.__op2.ctx.player.teleport(new window.V(0, 0.1, 18));
    window.lookAt(0, 1.4, 30);
  });
  await h.sleep(6000);
  out.following = await page.evaluate(() => window.sum().allies.map(a => ({ t: a.t, o: a.o, d: +Math.hypot(a.x, a.z - 18).toFixed(1) })));
  await page.evaluate(() => window.lookAt(0, 1.2, 8));
  await h.sleep(300);
  await h.shot('following');

  // A man down, and a revive by hand.
  await page.evaluate(() => window.__allies.downNearest());
  await h.sleep(800);
  out.downed = await page.evaluate(() => {
    const a = window.__allies.system.allies.find(x => x.state === 'down');
    if (!a) return null;
    const { ctx } = window.__op2;
    ctx.player.teleport(new window.V(a.body.position.x, 0.1, a.body.position.z + 1.8));
    return a.type;
  });
  await h.sleep(200);
  await page.evaluate(() => {
    const a = window.__allies.system.allies.find(x => x.state === 'down');
    if (a) window.lookAt(a.body.position.x, a.body.position.y + 0.3, a.body.position.z);
  });
  await h.sleep(400);
  await h.shot('down');
  out.stimsBefore = await page.evaluate(() => window.__allies.system.stims?.count ?? 'none');
  await h.press('e', 1400);
  await h.sleep(500);
  out.revived = await page.evaluate(() => ({ states: window.__allies.system.allies.map(a => a.state), stims: window.__allies.system.stims?.count ?? 'none' }));
  await h.shot('revived');

  // The cost of eight, in a fight.
  await page.evaluate(() => {
    window.__allies.clear();
    window.__op2.ctx.enemies.killAll('lab');
    window.__op2.ctx.player.teleport(new window.V(0, 0.1, 15));
    window.lookAt(0, 1.4, -10);
  });
  await h.sleep(300);
  await page.evaluate(() => { window.__allies.squad(8); window.__allies.foes(6); });
  await h.sleep(2000);
  out.cost = await page.evaluate(async () => {
    const A = window.__allies.system;
    const ally = [], frame = [];
    for (let i = 0; i < 180; i++) {
      await new Promise(r => requestAnimationFrame(r));
      ally.push(A.cpuMs);
      frame.push(window.__op2.game.stats().cpuMs);
    }
    const med = a => a.slice().sort((x, y) => x - y)[a.length >> 1];
    const p95 = a => a.slice().sort((x, y) => x - y)[Math.floor(a.length * 0.95)];
    return { allies: A.allies.length, allyMedian: +med(ally).toFixed(3), allyP95: +p95(ally).toFixed(3), frameMedian: med(frame), stats: window.__op2.game.stats() };
  });
  await h.shot('eight');
  out.end = await page.evaluate(() => ({ ...window.sum(), kills: { ...window.kills } }));
  return out;
}
