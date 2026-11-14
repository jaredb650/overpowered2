// Outpost Defense, the owner's first playtest: boarding up a wall by hand, the men with charges marked, a machine gunner on a mounted
// gun, the garrison shifting to the threatened side, the shopkeepers and the shop menus with icons. On real keys where it matters
// (E at a counter, E held at a wall).
//   node tools/shot.mjs --url "/?contract=defense&autostart=1" --script tools/scripts/defense-board.mjs --wait 500 --timeout 300 \
//     --dpr 2 --w 1440 --h 900 --out tools/out/defense3/b.png
export default async function defenseBoard(page, h) {
  const until = async (test, tries = 160) => {
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
  await page.evaluate(() => {
    const { ctx } = window.__op2;
    const V = ctx.player.position.constructor;
    window.V = V;
    if (window.__lab) {
      window.__lab.settings.god = true;
      window.__lab.changed();
    }
    window.__defense.earn(20000);
    // Hold the break open while we look round.
    window.hold = setInterval(() => { if (ctx.waves.phase === 'intermission' && window.holdBreak) ctx.waves.nextWaveIn = 25; }, 200);
    window.holdBreak = true;
    window.aimAt = (x, y, z) => {
      const p = ctx.player;
      const dx = x - p.eye.x, dy = y - p.eye.y, dz = z - p.eye.z;
      p.yaw = Math.atan2(-dx, -dz);
      p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    };
  });

  // BOARD_STEP=bomber goes straight to the wave.
  if (process.env.BOARD_STEP !== 'bomber') await looks(page, h, until, out);
  return wave(page, h, out);
}

async function looks(page, h, until, out) {
  // ---- 1. A shopkeeper behind the Barracks' counter, turned to the player.
  out.keeper = await page.evaluate(() => {
    const { ctx } = window.__op2;
    const d = window.__defense;
    const a = d.anchors.barracks;
    ctx.player.teleport(new window.V(a.position.x, a.position.y + 0.1, a.position.z), a.yaw + Math.PI);
    const k = d.keepers?.men?.[0];
    if (!k) return null;
    const p = k.char.root.position;
    return { at: [p.x, p.y, p.z].map(v => +v.toFixed(2)), men: d.keepers.men.length };
  });
  await h.sleep(1500);
  if (out.keeper) await page.evaluate(k => window.aimAt(k.at[0], k.at[1] + 1.3, k.at[2]), out.keeper);
  await h.sleep(600);
  await h.shot('keeper');

  // ---- 2. The Barracks' menu on E, then the Armoury's.
  await h.press('e', 90);
  out.barracksOpen = await until(() => window.__op2.ctx.hud.screens.name === 'shop', 20);
  await h.sleep(700);
  await h.press('ArrowDown', 60);
  await h.sleep(300);
  await h.shot('shop-barracks');
  await h.press('Escape', 60);
  await h.sleep(600);
  await page.mouse.click(300, 400);
  await h.sleep(500);
  await page.evaluate(() => {
    const { ctx } = window.__op2;
    const a = window.__defense.anchors.armoury;
    ctx.player.teleport(new window.V(a.position.x, a.position.y + 0.1, a.position.z), a.yaw + Math.PI);
    window.__defense.buy('armoury', { kind: 'weapon', id: 'smg' });
  });
  await h.sleep(800);
  await h.press('e', 90);
  out.armouryOpen = await until(() => window.__op2.ctx.hud.screens.name === 'shop', 20);
  await h.sleep(700);
  await h.shot('shop-armoury');
  await h.press('Escape', 60);
  await h.sleep(600);
  await page.mouse.click(300, 400);
  await h.sleep(500);

  // ---- 3. Board up a breached stretch of the outer north wall by hand, from the catwalk.
  out.wall = await page.evaluate(() => {
    const { ctx } = window.__op2;
    const walls = ctx.world.objects.walls;
    const piece = walls.all
      .filter(p => p.kind === 'wall' && Math.abs(p.spec.z + 52) < 1 && Math.abs(p.spec.x + 20) < 6)
      .sort((a, b) => Math.abs(a.spec.x + 20) - Math.abs(b.spec.x + 20))[0];
    if (!piece) return null;
    window.piece = piece;
    walls.damage(piece, 1000);
    const at = new window.V(piece.spec.x + 0.6, 1.9, piece.spec.z + 2.2);
    ctx.player.teleport(at, 0);
    return { stage: piece.stage, at: [piece.spec.x, piece.spec.z], credits: window.__defense.credits };
  });
  await h.sleep(900);
  await page.evaluate(() => window.aimAt(window.piece.spec.x, 1.6, window.piece.spec.z));
  await h.sleep(500);
  out.prompt = await page.evaluate(() => ({ piece: !!window.__defense.repair.piece }));
  await h.shot('repair-prompt');
  await h.keyDown('e');
  await h.sleep(1600);
  await h.shot('repair-ring');
  await h.sleep(5200);
  await h.keyUp('e');
  out.repaired = await page.evaluate(() => ({
    stage: window.piece.stage, credits: window.__defense.credits, stages: window.__defense.repair.stages,
  }));
  await h.shot('repair-done');

  // ---- 4. A machine gunner hired goes to a mounted gun and mans it.
  out.gunner = await page.evaluate(() => [1, 2, 3].map(() => window.__defense.buy('barracks', { kind: 'ally', type: 'gunner' })));
  out.manned = await until(() => window.__op2.ctx.allies.allies.some(a => a.manning), 240);
  const gun = await page.evaluate(() => {
    const { ctx } = window.__op2;
    const a = ctx.allies.allies.find(x => x.manning) ?? ctx.allies.allies.find(x => x.type === 'gunner');
    const g = a?.mount;
    if (!g) return null;
    // Along the rampart from him, on the deck, looking at him.
    const ux = Math.cos(g.spec.yaw), uz = -Math.sin(g.spec.yaw);
    const back = { x: Math.sin(g.spec.yaw), z: Math.cos(g.spec.yaw) };
    ctx.player.teleport(new window.V(g.standAt.x + ux * 5 + back.x * 1.2, g.standAt.y + 0.1, g.standAt.z + uz * 5 + back.z * 1.2), 0);
    return { at: [g.pivot.x, g.pivot.y, g.pivot.z], occupant: g.occupant === a, man: a.body.position.toArray().map(v => +v.toFixed(1)) };
  });
  out.gun = gun;
  await h.sleep(800);
  if (gun) await page.evaluate(g => window.aimAt(g.at[0], g.at[1] - 0.2, g.at[2]), gun);
  await h.sleep(600);
  await h.shot('gun');
}

async function wave(page, h, out) {
  // ---- 5. A wave: the garrison mans its fronts; a bomber and sappers come in marked.
  await page.evaluate(() => {
    window.holdBreak = false;
    window.__op2.ctx.waves.jumpTo(2);
  });
  await h.sleep(3000);
  out.fronts = await page.evaluate(() => {
    const { ctx } = window.__op2;
    const side = (x, z) => (Math.abs(x) >= Math.abs(z) ? (x >= 0 ? 1 : 3) : z < 0 ? 0 : 2);
    return {
      fronts: [...window.__defense.garrison.fronts],
      riflemen: ctx.allies.allies.filter(a => a.type === 'rifleman').map(a => side(a.post.x, a.post.z)),
    };
  });
  // A bomber spawned in the field off the first front, the player on that side's catwalk looking out at him.
  out.bomber = await page.evaluate(() => {
    const { ctx } = window.__op2;
    const side = window.__defense.garrison.fronts[0] ?? 0;
    const dir = [[0, -1], [1, 0], [0, 1], [-1, 0]][side];
    const along = [[1, 0], [0, 1], [1, 0], [0, 1]][side];
    const at = new window.V(dir[0] * 78 + along[0] * 12, 1, dir[1] * 78 + along[1] * 12);
    ctx.world.nav.nearest(at, 6, at);
    const e = ctx.enemies.spawn('bomber', at);
    // On the catwalk behind that side's wall: the deck nearest a point just inside it.
    const deck = new window.V(dir[0] * 49.5 + along[0] * 9, 4.5, dir[1] * 49.5 + along[1] * 9);
    ctx.world.nav.nearest(deck, 3, deck);
    deck.y += 0.1;
    ctx.player.teleport(deck, [0, -Math.PI / 2, Math.PI, Math.PI / 2][side]);
    window.bomber = e;
    return { side, spawned: !!e };
  });
  await h.sleep(2500);
  await page.evaluate(() => {
    const e = window.bomber;
    if (e?.alive) window.aimAt(e.position.x, e.position.y + 1, e.position.z);
  });
  await h.sleep(300);
  out.carriers = await page.evaluate(() => [...window.__defense.carriers].length);
  await h.shot('bomber');
  await h.sleep(250);
  await h.shot('bomber-blink');
  out.gunners = await page.evaluate(() => window.__op2.ctx.allies.allies.filter(a => a.type === 'gunner').map(a => ({
    manning: a.manning, at: a.body.position.toArray().map(v => Math.round(v)), gun: a.mount?.standAt.toArray().map(v => Math.round(v)),
  })));
  out.errors = await page.evaluate(() => window.__op2.errors?.length ?? null).catch(() => null);
  return out;
}
