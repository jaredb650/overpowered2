// Every lab feature, driven on the Test Range. Takes one still of all 16 types standing with AI off.
//   node tools/shot.mjs --url "/?map=range" --script tools/scripts/lab-check.mjs --wait 500 --timeout 200 --out tools/out/labcheck.png
export default async function labCheck(page, h) {
  for (let i = 0; i < 180; i++) {
    if (await page.evaluate(() => !!window.__lab && window.__op2?.game?.state === 'playing')) break;
    await h.sleep(500);
  }
  const out = {};
  const prep = () => page.evaluate(() => {
    const lab = window.__lab;
    const { ctx } = window.__op2;
    window.V = ctx.player.position.constructor;
    window.frame = () => new Promise(r => requestAnimationFrame(r));
    window.world = async seconds => {
      const end = ctx.time.elapsed + seconds;
      while (ctx.time.elapsed < end) await window.frame();
    };
    window.real = async seconds => {
      const end = ctx.time.realElapsed + seconds;
      while (ctx.time.realElapsed < end) await window.frame();
    };
    window.wipe = async () => {
      ctx.enemies.reset();
      lab.spawner.clearBodies();
      await window.frame();
    };
    window.at = (id, x, z, ai = 'off') => lab.spawner.place(id, new window.V(x, 0, z), ai);
    window.set = changes => {
      Object.assign(lab.settings, changes);
      lab.changed();
    };
  });
  await prep();

  // Real keys, real pointer lock.
  await page.mouse.click(300, 400);
  await h.sleep(400);
  const locked0 = await page.evaluate(() => window.__op2.ctx.input.locked);
  await h.keyDown('F1');
  await h.keyUp('F1');
  await h.sleep(400);
  const open = await page.evaluate(() => ({ state: window.__op2.game.state, locked: window.__op2.ctx.input.locked, open: window.__lab.open, shown: getComputedStyle(document.querySelector('.lab-panel')).display }));
  const before = await page.evaluate(() => window.__op2.ctx.weapons.ammo().mag);
  await page.mouse.click(1150, 300);
  await h.sleep(200);
  const firedThroughPanel = before !== await page.evaluate(() => window.__op2.ctx.weapons.ammo().mag);
  await h.keyDown('Escape');
  await h.keyUp('Escape');
  await h.sleep(500);
  const closed = await page.evaluate(() => ({ state: window.__op2.game.state, open: window.__lab.open, shown: getComputedStyle(document.querySelector('.lab-panel')).display }));
  out.pointer = { locked0, open, firedThroughPanel, closed };

  out.types = await page.evaluate(async () => {
    const { ctx } = window.__op2;
    const lab = window.__lab;
    const ids = ['husk', 'trooper', 'gunner', 'brute', 'stalker', 'rocketeer', 'sniper', 'riot', 'leaper', 'bomber', 'burner', 'warden', 'skitter', 'drone', 'juggernaut', 'titan'];
    await window.wipe();
    ctx.player.teleport(new window.V(0, 0.1, 22), 0);
    ctx.player.pitch = -0.03;
    const row = ids.map((id, i) => {
      const e = window.at(id, -24 + (i % 8) * 6.8, i < 8 ? 10 : -2);
      return { id, e, x: e.position.x, z: e.position.z, y: e.position.y };
    });
    await window.world(3);
    const drift = row.map(r => +Math.hypot(r.e.position.x - r.x, r.e.position.z - r.z).toFixed(3));
    const heights = row.map(r => r.e.position.y);
    return { spawned: row.filter(r => r.e).length, worstDrift: Math.max(...drift), drone: heights[13], acting: row.filter(r => r.e.attack || r.e.behaviour).map(r => r.id) };
  });
  await h.shot('types');

  out.killAll = await page.evaluate(async () => {
    const { ctx } = window.__op2;
    const lab = window.__lab;
    const alive = ctx.enemies.alive.length;
    lab.spawner.killAll();
    await window.world(0.5);
    const after = ctx.enemies.alive.length;
    const stats = ctx.gore.stats();
    await window.world(5);
    lab.spawner.clearBodies();
    await window.frame();
    const cleared = ctx.gore.stats();
    return { alive, after, corpses: stats.corpses, cleared: cleared.corpses, limbs: cleared.limbs };
  });

  out.row = await page.evaluate(async () => {
    const { ctx } = window.__op2;
    const lab = window.__lab;
    await window.wipe();
    ctx.player.teleport(new window.V(0, 0.1, 18), 0);
    ctx.player.pitch = -0.2;
    await window.real(0.2);
    const n = lab.spawner.atCrosshair('husk', 'off', 6);
    const onFloor = ctx.enemies.alive.every(e => Math.abs(e.position.y) < 0.3);
    return { n, onFloor, xs: ctx.enemies.alive.map(e => +e.position.x.toFixed(1)), z: +ctx.enemies.alive[0].position.z.toFixed(1) };
  });

  out.ai = await page.evaluate(async () => {
    const { ctx } = window.__op2;
    await window.wipe();
    const walker = window.at('trooper', 0, 0, 'patrol');
    const hunter = window.at('husk', 8, 8, 'on');
    const walkerFrom = walker.position.x;
    const p = ctx.player.position.clone();
    const huntFrom = hunter.position.distanceTo(p);
    let far = 0;
    let turned = 0;
    let last = 0;
    const end = ctx.time.elapsed + 7;
    while (ctx.time.elapsed < end) {
      await window.frame();
      far = Math.max(far, Math.abs(walker.position.x - walkerFrom));
      const v = walker.velocity.x;
      if (Math.abs(v) > 1 && Math.sign(v) !== Math.sign(last) && last !== 0) turned++;
      if (Math.abs(v) > 1) last = v;
    }
    return { walkerWent: +far.toFixed(1), turned, attacks: !!walker.attack, hunterClosed: +(huntFrom - hunter.position.distanceTo(ctx.player.position)).toFixed(1) };
  });

  out.time = await page.evaluate(async () => {
    const { ctx } = window.__op2;
    const lab = window.__lab;
    await window.wipe();
    const rate = async () => {
      const w0 = ctx.time.elapsed;
      const r0 = ctx.time.realElapsed;
      await window.real(0.6);
      return +((ctx.time.elapsed - w0) / (ctx.time.realElapsed - r0)).toFixed(3);
    };
    lab.setSpeed(0.05);
    const slow = await rate();
    lab.setSpeed(0.25);
    const quarter = await rate();
    lab.setSpeed(1);
    await window.real(0.1);
    const full = await rate();
    lab.togglePause();
    await window.real(0.1);
    const held = await rate();
    const w0 = ctx.time.elapsed;
    lab.step(1);
    await window.real(0.15);
    const one = +(ctx.time.elapsed - w0).toFixed(4);
    const w1 = ctx.time.elapsed;
    lab.step(10);
    await window.real(0.5);
    const ten = +(ctx.time.elapsed - w1).toFixed(4);
    // The player walks a frozen world.
    const from = ctx.player.position.clone();
    ctx.input.simulate('forward', true);
    await window.real(0.4);
    ctx.input.simulate('forward', false);
    const walked = +ctx.player.position.distanceTo(from).toFixed(2);
    lab.togglePause();
    return { slow, quarter, full, held, one, ten, walked };
  });

  const kill = (id, gib, set) => page.evaluate(async ({ id, gib, set }) => {
    const { ctx } = window.__op2;
    const lab = window.__lab;
    await window.wipe();
    window.set(set);
    const e = window.at(id, 0, 0);
    const severed = [];
    const off = ctx.events.on('enemy:severed', s => severed.push(s.region));
    await window.frame();
    const d = new window.V(0, -0.1, -1).normalize();
    let killed = null;
    const stop = ctx.events.on('enemy:killed', k => { killed = { gibbed: k.gibbed }; });
    ctx.enemies.applyDamage(e, { amount: 9999, type: 'explosive', point: e.center.clone(), dir: d, force: 120, source: 'rocket', gib });
    off?.();
    stop?.();
    await window.frame();
    const s = ctx.gore.stats();
    return { ...killed, corpses: s.corpses, limbs: s.limbs, severed };
  }, { id, gib, set });
  out.gibOn = await kill('trooper', true, { gibbing: true, explosiveDeaths: true });
  out.gibOff = await kill('trooper', true, { gibbing: false, explosiveDeaths: true });
  out.explosiveOff = await kill('trooper', true, { gibbing: true, explosiveDeaths: false });

  out.perks = await page.evaluate(async () => {
    const { ctx } = window.__op2;
    await window.wipe();
    const count = async on => {
      window.set({ progression: on, gibbing: true, explosiveDeaths: true });
      const from = ctx.progression.kills;
      for (let i = 0; i < 3; i++) ctx.enemies.applyDamage(window.at('husk', i * 3, 0), { amount: 999, type: 'true', point: new window.V(), dir: new window.V(0, 1, 0), force: 0, source: 'lab' });
      await window.frame();
      return { kills: ctx.progression.kills - from, combo: ctx.progression.combo };
    };
    const off = await count(false);
    const on = await count(true);
    window.set({ progression: false });
    return { off, on };
  });

  out.muscles = await page.evaluate(async () => {
    const { ctx } = window.__op2;
    const has = async on => {
      await window.wipe();
      window.set({ muscles: on, gibbing: false });
      ctx.enemies.killAll('lab');
      const e = window.at('trooper', 0, 0);
      await window.frame();
      ctx.enemies.killAll('lab');
      await window.frame();
      return !!ctx.gore.bodies?.at?.(-1)?.rag?.muscle;
    };
    const on = await has(true);
    const off = await has(false);
    window.set({ muscles: true, gibbing: true });
    return { on, off };
  });

  out.forceDial = await page.evaluate(async () => {
    const { ctx } = window.__op2;
    const lab = window.__lab;
    const throwAt = async force => {
      await window.wipe();
      window.set({ force, gibbing: false });
      const e = window.at('trooper', 0, 0);
      await window.world(0.1);
      ctx.combat.explode(new window.V(0, 0.3, 2), { radius: 8, damage: 300, kind: 'rocket', source: 'test', team: 'player' });
      await window.world(3);
      return +lab.overlay.lastThrow.distance.toFixed(2);
    };
    const r = { zero: await throwAt(0), one: await throwAt(1), two: await throwAt(2) };
    window.set({ force: 1, gibbing: true });
    return r;
  });

  out.ammo = await page.evaluate(async () => {
    const { ctx } = window.__op2;
    await window.wipe();
    ctx.weapons.switchTo('rocket');
    await window.real(0.5);
    const mag0 = ctx.weapons.ammo('rocket').mag;
    ctx.player.teleport(new window.V(0, 0.1, 15), 0);
    ctx.input.simulate('fire', true);
    await window.real(1.6);
    ctx.input.simulate('fire', false);
    const owned = ctx.weapons.owned.size;
    const hp = ctx.player.health;
    return { mag0, mag1: ctx.weapons.ammo('rocket').mag, owned, reloading: ctx.weapons.reloading, hp, god: ctx.player.modifiers.invulnerable };
  });

  out.overlay = await page.evaluate(async () => {
    const { ctx } = window.__op2;
    await window.wipe();
    const e = window.at('brute', 0, 4);
    ctx.player.teleport(new window.V(0, 0.1, 12), 0);
    await window.real(0.2);
    const d = e.center.clone().sub(ctx.player.eye);
    ctx.player.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
    ctx.weapons.switchTo('smg');
    await window.real(0.3);
    ctx.input.simulate('fire', true);
    await window.real(0.3);
    ctx.input.simulate('fire', false);
    await window.real(0.25);
    return document.querySelector('.lab-aim').textContent;
  });
  await h.shot('overlay');

  // Settings survive a reload. The page reloads last, so it costs nothing else.
  await page.evaluate(() => window.set({ spawn: 'titan', row: 7, speed: 0.3, force: 1.5 }));
  await page.reload({ waitUntil: 'load' });
  for (let i = 0; i < 90; i++) {
    if (await page.evaluate(() => !!window.__lab && window.__op2?.game?.state === 'playing')) break;
    await h.sleep(500);
  }
  out.persisted = await page.evaluate(() => {
    const s = window.__lab.settings;
    const f = window.__lab.flags;
    const seen = { spawn: s.spawn, row: s.row, speed: s.speed, force: f.force };
    localStorage.removeItem('op2.lab.v1.range');
    return seen;
  });
  return out;
}
