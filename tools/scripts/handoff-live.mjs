// The left-hand hand-off (parkour update, part 2) on the Test Range's corridor wall, in the real game: every weapon held
// in the left hand on a wall run with the wall on the right, the hand-off mid-motion both ways, a burst fired through it,
// and a cling turned with the wall on the right.
//
//   node tools/shot.mjs --url "/?map=range" --script tools/scripts/handoff-live.mjs --dpr 2 --w 1440 --h 900 \
//     --wait 500 --timeout 280 --out tools/out/handoff/h.png
//
// HO_IDS=smg,sword picks the weapons (default every one the rig has). HO_STEPS=all,mid,fire,swing,cling picks the steps.
// Stills: <out>-w-<id>.png, -mid-in, -mid-out, -fire, -swing, -cling.
const only = process.env.HO_IDS?.split(',');
const steps = (process.env.HO_STEPS ?? 'all,mid,fire,cling').split(',');

function prelude() {
  const { ctx } = window.__op2;
  const P = ctx.player;
  const V = P.position.constructor;
  const input = ctx.input;
  const frame = () => new Promise(r => requestAnimationFrame(r));
  const K = ['forward', 'back', 'left', 'right', 'jump', 'dash', 'slide', 'fire'];
  window.ho = {
    P, fired: 0, hook: null,
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
    /** Holds the game still on the first frame `test` is true, checked inside the frame. */
    freezeWhen(test, seconds = 3) {
      const end = ctx.time.playerElapsed + seconds;
      return new Promise(res => {
        this.hook = () => {
          const hit = test();
          if (!hit && ctx.time.playerElapsed < end) return;
          ctx.time.paused = true;
          this.hook = null;
          res(hit);
        };
      });
    },
    freezeAfter(seconds) {
      const at = ctx.time.playerElapsed + seconds;
      return this.freezeWhen(() => ctx.time.playerElapsed >= at, seconds + 1);
    },
    async settle() { await frame(); await frame(); },
    thaw() { ctx.time.paused = false; },
    equip(id) {
      ctx.weapons.give(id);
      ctx.weapons.switchTo(id);
    },
    /** Down the corridor with its second wall on the right, and into a wall run on it. */
    async runRight() {
      await this.place(-29.0, 0.1, 4.7, 0, -0.05);
      input.simulate('forward', true);
      await this.wait(0.2);
      this.look(-0.32);
      await this.wait(0.05);
      await this.tap('jump');
      return this.until(() => P.wallRunning && P.wallSide > 0, 1.5);
    },
    state() {
      const m = P.moveAnim;
      const r = n => Math.round(n * 1000) / 1000;
      return { running: P.wallRunning, side: P.wallSide, clinging: !!P.clinging, swap: r(m.swap), handSide: m.handSide, handW: r(m.handW), gun: ctx.weapons.current };
    },
  };
  ctx.events.on('weapon:fired', () => { window.ho.fired++; });
  const update = ctx.camera.update.bind(ctx.camera);
  ctx.camera.update = () => {
    update();
    if (!ctx.time.paused) window.ho.hook?.();
  };
  P.modifiers.invulnerable = true;
}

export default async function handoffLive(page, h) {
  // Other work on the dev server reloads the page now and then: wait for the game again and retry the step once.
  const ready = async () => {
    for (let i = 0; i < 180; i++) {
      if (await page.evaluate(() => !!window.__lab && window.__op2?.game?.state === 'playing').catch(() => false)) break;
      await h.sleep(500);
    }
    await page.mouse.click(300, 400);
    await h.sleep(300);
    await page.evaluate(prelude);
    await h.sleep(600);
  };
  const retry = async fn => {
    try {
      return await fn();
    } catch {
      await ready();
      return fn();
    }
  };
  await ready();
  const ids = only ?? await page.evaluate(() => Object.keys(window.__op2.ctx.viewmodel.allDefs).filter(id => id !== 'smgLeft'));
  const out = { ids };
  const still = async name => {
    await page.evaluate(() => window.ho.settle());
    await h.shot(name);
    await page.evaluate(() => window.ho.thaw());
  };
  const equip = async id => {
    await page.evaluate(async id => { window.ho.equip(id); await window.ho.wait(0.8); }, id);
  };

  if (steps.includes('all')) {
    out.all = {};
    for (const id of ids) {
      await retry(async () => {
        await equip(id);
        const ok = await page.evaluate(async () => {
          const k = window.ho;
          if (!(await k.runRight())) return false;
          return k.freezeAfter(0.32);
        });
        out.all[id] = { ok, ...(await page.evaluate(() => window.ho.state())) };
        await still(`w-${id}`);
        await page.evaluate(() => window.ho.release());
      });
    }
  }

  if (steps.includes('mid')) await retry(async () => {
    const id = ids.includes('autocannon') ? 'autocannon' : ids[0];
    await equip(id);
    await page.evaluate(async () => {
      const k = window.ho;
      await k.runRight();
      await k.freezeWhen(() => k.P.moveAnim.swap >= 0.5, 0.5);
    });
    out.midIn = await page.evaluate(() => window.ho.state());
    await still('mid-in');
    await page.evaluate(async () => {
      const k = window.ho;
      await k.until(() => !k.P.wallRunning, 3);
      await k.freezeWhen(() => k.P.moveAnim.swap <= 0.6, 0.5);
    });
    out.midOut = await page.evaluate(() => window.ho.state());
    await still('mid-out');
    await page.evaluate(() => window.ho.release());
  });

  if (steps.includes('fire')) await retry(async () => {
    const id = ids.includes('smg') ? 'smg' : ids[0];
    await equip(id);
    out.fire = await page.evaluate(async () => {
      const k = window.ho;
      const input = window.__op2.ctx.input;
      await k.place(-29.0, 0.1, 4.7, 0, -0.05);
      input.simulate('forward', true);
      await k.wait(0.2);
      k.look(-0.32);
      await k.wait(0.05);
      // The trigger is held from before the jump, through the hand-off and the run.
      input.simulate('fire', true);
      k.fired = 0;
      await k.tap('jump');
      await k.until(() => k.P.wallRunning && k.P.wallSide > 0, 1.5);
      const atStart = k.fired;
      let during = 0;
      let swapSeen = 0;
      const mid = await new Promise(res => {
        k.hook = () => {
          const s = k.P.moveAnim.swap;
          if (s > 0 && s < 1) { during = k.fired; swapSeen = Math.max(swapSeen, s); }
          if (s === 1 && k.fired > atStart + 2) {
            window.__op2.ctx.time.paused = true;
            k.hook = null;
            res(true);
          }
        };
      });
      return { mid, atStart, firedInHandoff: during - atStart, swapSeen, ...k.state() };
    });
    await still('fire');
    await page.evaluate(() => window.ho.release());
  });

  if (steps.includes('swing')) await retry(async () => {
    // A blow on the run is struck from the right hand: the sword comes back for it and goes over again after.
    await equip('sword');
    out.swing = await page.evaluate(async () => {
      const k = window.ho;
      await k.runRight();
      await k.until(() => k.P.moveAnim.swap === 1, 0.5);
      await k.tap('fire');
      await k.freezeAfter(0.05);
      return k.state();
    });
    await still('swing');
    await page.evaluate(() => window.ho.release());
  });

  if (steps.includes('cling')) await retry(async () => {
    const id = ids.includes('shotgun') ? 'shotgun' : ids[0];
    await equip(id);
    out.cling = await page.evaluate(async () => {
      const k = window.ho;
      const input = window.__op2.ctx.input;
      // Facing the room's west wall (11 m, too tall to top out) from 1.2 m in the corridor, W held: a climb and the cling.
      await k.place(-30.8, 0.1, -3, Math.PI / 2, 0);
      input.simulate('forward', true);
      await k.wait(0.1);
      await k.tap('jump');
      const clung = await k.until(() => k.P.clinging, 2);
      // Turned round with the wall on the right, looking back up the corridor.
      k.look(Math.PI / 2 - 0.15);
      await k.freezeAfter(0.3);
      return { clung, ...k.state() };
    });
    await still('cling');
    await page.evaluate(() => window.ho.release());
  });
  return out;
}
