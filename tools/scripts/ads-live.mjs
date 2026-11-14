// Aim down sights in the real game, on the Test Range: hip and aimed for two guns with troopers down the corridor, the
// walk it slows to, aimed on a wall run with the wall on the right (the hand-off), a reload in the middle of it, and the
// settings rows.
//
//   node tools/shot.mjs --port 5191 --url "/?map=range" --script tools/scripts/ads-live.mjs --dpr 2 --w 1440 --h 900 \
//     --wait 500 --timeout 280 --out tools/out/ads/live.png
//
// ADS_GUNS=smg,judge picks the two guns. Stills: <out>-<id>-hip.png, -<id>-ads.png, -handoff.png, -settings.png.
const guns = (process.env.ADS_GUNS ?? 'smg,judge').split(',');

function prelude() {
  const { ctx } = window.__op2;
  const P = ctx.player;
  const V = P.position.constructor;
  const input = ctx.input;
  const frame = () => new Promise(r => requestAnimationFrame(r));
  const K = ['forward', 'back', 'left', 'right', 'jump', 'dash', 'slide', 'fire', 'aim'];
  window.ads = {
    P,
    release() { for (const k of K) input.simulate(k, false); },
    async place(x, y, z, yaw = 0, pitch = 0) {
      this.release();
      input.consumeLook();
      ctx.time.paused = false;
      P.teleport(new V(x, y, z), yaw);
      P.pitch = pitch;
      for (let i = 0; i < 12; i++) await frame();
    },
    async until(test, seconds = 4) {
      const end = ctx.time.playerElapsed + seconds;
      while (ctx.time.playerElapsed < end) {
        if (test()) return true;
        await frame();
      }
      return test();
    },
    async wait(seconds) {
      const end = ctx.time.playerElapsed + seconds;
      while (ctx.time.playerElapsed < end) await frame();
    },
    async tap(action) {
      input.simulate(action, true);
      await frame();
      await frame();
      input.simulate(action, false);
    },
    look(yaw, pitch = 0) {
      const s = P.sensitivity * P.lookScale;
      input.simulateLook(-yaw / s, -pitch / s);
    },
    equip(id) {
      ctx.weapons.give(id);
      ctx.weapons.switchTo(id);
    },
    /** Toggles ADS until it reads `on`. */
    async aim(on) {
      if ((ctx.weapons.aim > 0.5) !== on) await this.tap('aim');
      await this.wait(0.5);
    },
    troopers() {
      if (this.spawned) return;
      this.spawned = true;
      const f = P.forward;
      for (let i = 0; i < 3; i++) {
        const d = 16 + i * 6;
        window.__lab.spawner.place('trooper', new V(P.position.x + f.x * d + (i - 1) * 1.2, P.position.y, P.position.z + f.z * d), 'off');
      }
    },
    async walkSpeed() {
      input.simulate('forward', true);
      await this.wait(1.2);
      const v = P.velocity;
      const s = Math.hypot(v.x, v.z);
      input.simulate('forward', false);
      await this.wait(0.4);
      return Number(s.toFixed(2));
    },
    state() {
      const r = n => Math.round(n * 1000) / 1000;
      return { gun: ctx.weapons.current, aim: r(ctx.weapons.aim), fov: r(ctx.render.camera.fov), lookScale: r(P.lookScale), swap: r(P.moveAnim.swap), wall: P.wallRunning, side: P.wallSide, reloading: ctx.weapons.reloading };
    },
  };
  P.modifiers.invulnerable = true;
}

export default async function adsLive(page, h) {
  for (let i = 0; i < 180; i++) {
    if (await page.evaluate(() => !!window.__lab && window.__op2?.game?.state === 'playing').catch(() => false)) break;
    await h.sleep(500);
  }
  await page.mouse.click(300, 400);
  await h.sleep(300);
  await page.evaluate(prelude);
  await h.sleep(600);
  const out = { mode: await page.evaluate(() => ({ hold: window.__op2.ctx.weapons.aimHold, sens: window.__op2.ctx.weapons.aimSensitivity })) };
  const still = async name => {
    await page.evaluate(() => { window.__op2.ctx.time.paused = true; });
    await h.sleep(120);
    await h.shot(name);
    await page.evaluate(() => { window.__op2.ctx.time.paused = false; });
  };

  for (const id of guns) {
    out[id] = await page.evaluate(async w => {
      const k = window.ads;
      k.equip(w);
      await k.wait(0.8);
      await k.place(-29.0, 0.1, 4.7, 0, -0.02);
      k.troopers();
      await k.wait(0.8);
      return { hip: k.state() };
    }, id);
    await still(`${id}-hip`);
    out[id].ads = await page.evaluate(async () => { await window.ads.aim(true); return window.ads.state(); });
    await still(`${id}-ads`);
    out[id].walk = await page.evaluate(async () => {
      const k = window.ads;
      await k.aim(false);
      await k.place(-29.0, 0.1, 4.7, 0, -0.02);
      const hip = await k.walkSpeed();
      await k.place(-29.0, 0.1, 4.7, 0, -0.02);
      await k.aim(true);
      const ads = await k.walkSpeed();
      await k.aim(false);
      return { hip, ads };
    });
  }

  // A wall run with the wall on the right: aimed, the gun is held by the left hand and centred.
  out.handoff = await page.evaluate(async () => {
    const k = window.ads;
    const input = window.__op2.ctx.input;
    k.equip('smg');
    await k.wait(0.6);
    await k.place(-29.0, 0.1, 4.7, 0, -0.05);
    // Aimed, the player walks, too slow to take a wall: so onto the wall first, then aim.
    input.simulate('forward', true);
    await k.wait(0.2);
    k.look(-0.32);
    await k.wait(0.05);
    await k.tap('jump');
    const ran = await k.until(() => k.P.wallRunning && k.P.wallSide > 0, 1.5);
    await k.tap('aim');
    await k.wait(0.3);
    return { ran, ...k.state() };
  });
  await still('handoff');
  await page.evaluate(() => window.ads.release());

  // A reload drops the toggle's ADS and brings it back.
  out.reload = await page.evaluate(async () => {
    const k = window.ads;
    const w = window.__op2.ctx.weapons;
    await k.place(-29.0, 0.1, 4.7, 0, -0.02);
    await k.aim(true);
    // The lab's arsenal holds every magazine bottomless, which skips a reload.
    window.__lab.settings.arsenal = false;
    await k.wait(0.1);
    w.modifiers.bottomlessMag = false;
    w.ammo().mag = 3;
    await k.tap('reload');
    await k.wait(0.3);
    const during = k.state();
    await k.until(() => !w.reloading, 3);
    await k.wait(0.4);
    return { during, after: k.state() };
  });

  await page.evaluate(() => {
    window.ads.release();
    window.__op2.ctx.hud.screens.show('settings');
  });
  await h.sleep(500);
  await h.shot('settings');
  return out;
}
