// The held-breath zoom (src/weapons/adsZoom.ts) in the real game, on the Test Range: aimed, then aimed with the dash key
// held, for an iron-sight gun, a red-dot gun and the Awl's scope, plus the bar and dimmed hint during a cooldown.
//
//   OP2_NO_HMR=1 node tools/shot.mjs --port 5199 --url "/?map=range" --script tools/scripts/adszoom-live.mjs --dpr 2 \
//     --w 1440 --h 900 --wait 500 --timeout 280 --out tools/out/adszoom/live.png
//
// Stills: <out>-<gun or mod>-ads.png, -<gun or mod>-zoom.png, -cool.png.
const GUNS = [['rivet', null], ['gimlet', 'gimletDot'], ['gimlet', 'gimletAcog'], ['awl', null]];

function prelude() {
  const { ctx } = window.__op2;
  const P = ctx.player;
  const V = P.position.constructor;
  const input = ctx.input;
  const frame = () => new Promise(r => requestAnimationFrame(r));
  window.z = {
    release() { for (const k of ['forward', 'back', 'left', 'right', 'jump', 'dash', 'slide', 'fire', 'aim']) input.simulate(k, false); },
    async place() {
      this.release();
      input.consumeLook();
      ctx.time.paused = false;
      P.teleport(new V(-29.0, 0.1, 4.7), 0);
      P.pitch = -0.02;
      for (let i = 0; i < 12; i++) await frame();
    },
    async wait(seconds) {
      const end = performance.now() + seconds * 1000;
      while (performance.now() < end) await frame();
    },
    async equip(id, mod) {
      const w = ctx.weapons;
      w.give(id);
      if (mod) {
        w.grantMod(mod);
        w.fitMod(mod, true);
      }
      w.switchTo(id);
      await this.wait(0.8);
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
    state() {
      const r = n => Math.round(n * 1000) / 1000;
      const w = ctx.weapons;
      return { gun: w.current, aim: r(w.aim), scoped: w.scoped, aimHeld: w.aimHeld, zoom: w.adsZoom.on, mag: r(w.adsZoom.mag),
        cool: r(w.adsZoom.cool), fov: r(ctx.render.camera.fov), lookScale: r(P.lookScale), dashing: P.dashing };
    },
  };
  P.modifiers.invulnerable = true;
  // Hold to aim, so letting the key go between guns drops the aim (src/weapons/adsZoom.test.ts covers toggle too).
  ctx.weapons.aimHold = true;
}

export default async function adsZoomLive(page, h) {
  for (let i = 0; i < 180; i++) {
    if (await page.evaluate(() => !!window.__lab && window.__op2?.game?.state === 'playing').catch(() => false)) break;
    await h.sleep(500);
  }
  await page.mouse.click(300, 400);
  await h.sleep(300);
  await page.evaluate(prelude);
  await h.sleep(600);
  const still = async name => {
    await page.evaluate(() => { window.__op2.ctx.time.paused = true; });
    await h.sleep(150);
    await h.shot(name);
    await page.evaluate(() => { window.__op2.ctx.time.paused = false; });
  };
  const out = {};
  for (const [gun, mod] of GUNS) {
    const id = mod ?? gun;
    out[id] = {};
    out[id].hip = await page.evaluate(async ([g, m]) => {
      const k = window.z;
      await k.equip(g, m);
      await k.place();
      k.troopers();
      await k.wait(0.6);
      return k.state();
    }, [gun, mod]);
    out[id].ads = await page.evaluate(async () => {
      window.__op2.ctx.input.simulate('aim', true);
      await window.z.wait(0.6);
      return window.z.state();
    });
    await still(`${id}-ads`);
    out[id].zoom = await page.evaluate(async () => {
      window.__op2.ctx.input.simulate('dash', true);
      await window.z.wait(0.8);
      return window.z.state();
    });
    await still(`${id}-zoom`);
    if (id === 'gimletDot') {
      out[id].cool = await page.evaluate(async () => {
        await window.z.wait(0.6);
        window.__op2.ctx.input.simulate('dash', false);
        await window.z.wait(0.35);
        return window.z.state();
      });
      await still('cool');
    }
    await page.evaluate(async () => { window.z.release(); await window.z.wait(0.6); });
  }
  // From the hip the key still dashes.
  out.hipDash = await page.evaluate(async () => {
    const k = window.z;
    // A switch drops the Awl's toggled scope, so this is from the hip.
    await k.equip('rivet');
    await k.place();
    await k.wait(3);
    window.__op2.ctx.input.simulate('dash', true);
    let dashed = false;
    for (let i = 0; i < 12; i++) { await new Promise(r => requestAnimationFrame(r)); dashed ||= window.__op2.ctx.player.dashing; }
    window.__op2.ctx.input.simulate('dash', false);
    return dashed;
  });
  return out;
}
