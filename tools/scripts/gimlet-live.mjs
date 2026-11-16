// The Gimlet in the real game (weapons-update plan section 11): hip, the ACOG aimed at a man far down the range, the red dot,
// the launcher raised, and the Harrow with its ACOG.
//
//   node tools/shot.mjs --port 5265 --url "/?map=range" --script tools/scripts/gimlet-live.mjs --dpr 2 --w 1440 --h 900 \
//     --wait 500 --timeout 200 --out tools/out/carbine/live.png
//
// GIMLET_ONLY=hip,acog,dot,launcher,harrow picks the stills (<out>-<name>.png). GIMLET_FAR is the man's distance, metres (55).
//
// GIMLET_ONLY=shop, in the Crucible (--url "/?autostart=1"): Procurement in a break with the Gimlet in focus, then the Mods page.
const only = (process.env.GIMLET_ONLY ?? 'hip,acog,dot,launcher,harrow').split(',');
const far = Number(process.env.GIMLET_FAR ?? 55);

function prelude(far) {
  const { ctx } = window.__op2;
  const P = ctx.player;
  const V = P.position.constructor;
  const input = ctx.input;
  const frame = () => new Promise(r => requestAnimationFrame(r));
  const w = ctx.weapons;
  window.gim = {
    async wait(seconds) {
      const end = ctx.time.playerElapsed + seconds;
      while (ctx.time.playerElapsed < end) await frame();
    },
    async hold(action, seconds) {
      input.simulate(action, true);
      await this.wait(seconds);
      input.simulate(action, false);
      await frame();
      await frame();
    },
    async place() {
      ctx.time.paused = false;
      // Down the long side of the range, the man at its far end.
      // Down the range's open 61 m along +x (yaw -pi/2), the man near its far end.
      P.teleport(new V(-29, 0.1, 4.7), -Math.PI / 2);
      P.pitch = -0.012;
      for (let i = 0; i < 10; i++) await frame();
    },
    man() {
      if (this.spawned) return;
      this.spawned = true;
      const f = P.forward;
      window.__lab.spawner.place('trooper', new V(P.position.x + f.x * far, P.position.y, P.position.z + f.z * far), 'off');
      window.__lab.spawner.place('trooper', new V(P.position.x + f.x * (far - 14) + 2.5, P.position.y, P.position.z + f.z * (far - 14) - 3), 'off');
    },
    equip(id) {
      w.give(id);
      w.switchTo(id);
    },
    fit(id, on = true) {
      w.grantMod(id);
      w.fitMod(id, on);
    },
    async aim(on) {
      if ((w.aim > 0.5) !== on) await this.hold('aim', 0.05);
      await this.wait(0.6);
    },
    state() {
      const r = n => Math.round(n * 1000) / 1000;
      return { gun: w.current, aim: r(w.aim), fov: r(ctx.render.camera.fov), mode: w.ammoMode, up: w.launcherUp, fitted: [...w.fitted], ammo: { ...w.ammo() } };
    },
  };
  P.modifiers.invulnerable = true;
  // The lab's per-man readout would sit over the picture.
  window.__lab.settings.overlay = false;
  // Rounds are spent, so the launcher reloads.
  window.__lab.settings.arsenal = false;
}

export default async function gimletLive(page, h) {
  for (let i = 0; i < 180; i++) {
    if (await page.evaluate(() => !!window.__lab && window.__op2?.game?.state === 'playing').catch(() => false)) break;
    await h.sleep(500);
  }
  await page.mouse.click(300, 400);
  await h.sleep(300);
  if (only.includes('shop')) return shop(page, h);
  await page.evaluate(prelude, far);
  await h.sleep(400);
  const still = async name => {
    await page.evaluate(() => { window.__op2.ctx.time.paused = true; });
    await h.sleep(150);
    await h.shot(name);
    await page.evaluate(() => { window.__op2.ctx.time.paused = false; });
  };
  const out = {};
  const run = (fn, arg) => page.evaluate(fn, arg);

  await run(async () => {
    const k = window.gim;
    k.equip('gimlet');
    await k.wait(0.8);
    await k.place();
    k.man();
    await k.wait(1);
  });
  if (only.includes('hip')) {
    out.hip = await run(() => window.gim.state());
    await still('hip');
  }
  if (only.includes('acog')) {
    out.acog = await run(async () => { await window.gim.aim(true); return window.gim.state(); });
    await still('acog');
    await run(() => window.gim.aim(false));
  }
  if (only.includes('dot')) {
    out.dot = await run(async () => {
      const k = window.gim;
      k.fit('gimletDot');
      await k.aim(true);
      return k.state();
    });
    await still('reddot');
    out.dotHip = await run(async () => { await window.gim.aim(false); return window.gim.state(); });
    await still('reddot-hip');
    await run(() => window.gim.fit('gimletAcog'));
  }
  if (only.includes('launcher')) {
    out.launcherHip = await run(async () => {
      const k = window.gim;
      k.fit('gimletGl');
      await k.wait(0.4);
      return k.state();
    });
    await still('launcher-fitted');
    out.launcher = await run(async () => {
      const k = window.gim;
      await k.hold('reload', 0.4);
      await k.wait(0.5);
      return k.state();
    });
    await still('launcher-up');
    out.launcherReload = await run(async () => {
      const k = window.gim;
      window.__op2.ctx.weapons.modifiers.bottomlessMag = false;
      await k.hold('fire', 0.05);
      await k.wait(0.9);
      return k.state();
    });
    await still('launcher-reload');
    await run(async () => {
      const k = window.gim;
      await k.wait(1.5);
      await k.hold('reload', 0.4);
      window.__op2.ctx.weapons.fitMod('gimletGl', false);
      await k.wait(0.4);
    });
  }
  if (only.includes('harrow')) {
    out.harrow = await run(async () => {
      const k = window.gim;
      k.equip('harrow');
      k.fit('harrowAcog');
      await k.wait(0.8);
      await k.place();
      await k.wait(0.4);
      return k.state();
    });
    await still('harrow-acog-hip');
    out.harrowAds = await run(async () => { await window.gim.aim(true); return window.gim.state(); });
    await still('harrow-acog');
  }
  return out;
}

async function shop(page, h) {
  for (let i = 0; i < 120 && !(await page.evaluate(() => window.__op2.ctx.contracts.shop != null)); i++) await h.sleep(250);
  await page.evaluate(() => {
    const { ctx } = window.__op2;
    ctx.waves.wave = 4;
    ctx.waves.phase = 'intermission';
    ctx.waves.nextWaveIn = 600;
    ctx.contracts.shop.credits = 2400;
    for (const e of [...ctx.enemies.alive]) e.health = 0;
    ctx.events.emit('shop:open', {});
  });
  await h.sleep(1500);
  const read = () => page.evaluate(() => ({
    rows: [...document.querySelectorAll('.pc-row')].map(r => r.textContent),
    focus: document.querySelector('.pc-row.focus .pc-k')?.textContent ?? null,
    listFits: (() => { const l = document.querySelector('.pc-row')?.parentElement; return l ? l.scrollHeight <= l.clientHeight + 1 : null; })(),
  }));
  const out = { weapons: await read() };
  await h.sleep(1200);
  await h.shot('shop-weapons');
  await h.press('ArrowRight', 60);
  await h.sleep(1200);
  out.mods = await read();
  await h.shot('shop-mods');
  return out;
}
