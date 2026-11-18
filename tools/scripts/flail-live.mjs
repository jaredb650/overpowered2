// The Flail in the real game on the Test Range: hip, aimed with its irons, the red dot and the ACOG (with the camera's zoom), a
// reload mid-way, and a friend holding one in third person (the co-op prop net/remote.ts draws for it).
//
//   OP2_NO_HMR=1 npx vite --port 5212 --strictPort
//   node tools/shot.mjs --port 5212 --url "/?map=range" --script tools/scripts/flail-live.mjs --dpr 2 \
//     --w 1440 --h 900 --wait 500 --timeout 300 --out tools/out/flail/live.png
function prelude() {
  const { ctx } = window.__op2;
  const P = ctx.player;
  const V = P.position.constructor;
  const input = ctx.input;
  const frame = () => new Promise(r => requestAnimationFrame(r));
  window.f = {
    async wait(seconds) {
      const end = performance.now() + seconds * 1000;
      while (performance.now() < end) await frame();
    },
    async place() {
      for (const k of ['forward', 'back', 'left', 'right', 'jump', 'dash', 'fire', 'aim']) input.simulate(k, false);
      input.consumeLook();
      P.teleport(new V(-29.0, 0.1, 4.7), 0);
      P.pitch = -0.02;
      await this.wait(0.3);
    },
    async equip(mods) {
      const w = ctx.weapons;
      w.give('flail');
      for (const m of ['flailDot', 'flailAcog', 'flailBox']) if (w.fitted.has(m)) w.fitMod(m, false);
      for (const m of mods) { w.grantMod(m); w.fitMod(m, true); }
      w.switchTo('flail');
      await this.wait(1);
    },
    state() {
      const w = ctx.weapons;
      return { gun: w.current, mag: w.ammo('flail').mag, aim: Math.round(w.aim * 100) / 100, fov: Math.round(ctx.render.camera.fov * 10) / 10 };
    },
    async friend() {
      const { RemotePlayer } = await import('/src/net/remote.ts');
      await ctx.characters.load(['bailiff', 'bailiffHeavy']);
      const at = (x, z, yaw, prop) => {
        const r = new RemotePlayer(ctx, { slot: 0, name: prop.toUpperCase() });
        r.arm(prop);
        r.char.root.visible = true;
        r.char.root.position.set(P.position.x + x, P.position.y, P.position.z + z);
        r.char.root.rotation.y = yaw;
        return r;
      };
      this.friends = [at(-0.75, -2.6, -1.1, 'flail'), at(0.75, -2.6, -1.1, 'piledriver')];
      // A lamp over them for the still: the range's corridor is dark.
      const lamp = new P.position.constructor().set(P.position.x, P.position.y + 2.4, P.position.z - 1.4);
      const L = new (await import('/node_modules/.vite/deps/three.js')).PointLight(0xdfe8ff, 18, 8, 1.6);
      L.position.copy(lamp);
      ctx.render.scene.add(L);
      const tick = () => {
        for (const r of this.friends) {
          r.char.anim.setLocomotion({ speed: 0, moveX: 0, moveZ: 0, aimYaw: 0, aimPitch: 0, grounded: true });
          r.char.anim.update(1 / 60, 0);
          r.char.root.updateMatrixWorld(true);
        }
        if (this.friends) requestAnimationFrame(tick);
      };
      tick();
    },
  };
  P.modifiers.invulnerable = true;
  ctx.weapons.aimHold = true;
}

export default async function flailLive(page, h) {
  for (let i = 0; i < 180; i++) {
    if (await page.evaluate(() => !!window.__lab && window.__op2?.game?.state === 'playing').catch(() => false)) break;
    await h.sleep(500);
  }
  await page.mouse.click(300, 400);
  await h.sleep(300);
  await page.evaluate(prelude);
  const still = async name => {
    await page.evaluate(() => { window.__op2.ctx.time.paused = true; });
    await h.sleep(150);
    await h.shot(name);
    await page.evaluate(() => { window.__op2.ctx.time.paused = false; });
  };
  const aim = on => page.evaluate(v => window.__op2.ctx.input.simulate('aim', v), on);
  const out = {};
  const only = process.env.FLAIL_LIVE ?? 'ads,reload,tp';
  if (only.includes('ads')) for (const [name, mods] of [['irons', []], ['dot', ['flailDot']], ['acog', ['flailAcog']]]) {
    await page.evaluate(async m => { await window.f.place(); await window.f.equip(m); }, mods);
    if (name === 'irons') await still('hip');
    await aim(true);
    await page.evaluate(() => window.f.wait(0.8));
    out[name] = await page.evaluate(() => window.f.state());
    await still(`ads-${name}`);
    await aim(false);
  }
  // A reload half way: the box off, the new one coming.
  if (only.includes('reload')) {
  await page.evaluate(async () => { await window.f.place(); await window.f.equip(['flailBox']); });
  await page.evaluate(() => window.__op2.ctx.input.simulate('reload', true));
  await page.evaluate(() => window.f.wait(0.1));
  await page.evaluate(() => window.__op2.ctx.input.simulate('reload', false));
  await page.evaluate(() => window.f.wait(3.1 * 0.47 - 0.1));
  await still('reload-mid');
  await page.evaluate(() => window.f.wait(3));
  out.afterReload = await page.evaluate(() => window.f.state());
  }
  if (!only.includes('tp')) return out;
  // Third person: a friend with the Flail beside one with the Piledriver's prop.
  await page.evaluate(async () => { await window.f.place(); window.__op2.ctx.weapons.switchTo('sword'); await window.f.friend(); await window.f.wait(1.2); });
  await still('third-person');
  return out;
}
