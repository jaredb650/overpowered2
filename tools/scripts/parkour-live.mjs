// Every move on the Test Range's parkour strip, in the real game, frozen mid-move for a still.
//
//   node tools/shot.mjs --url "/?map=range" --script tools/scripts/parkour-live.mjs --dpr 2 --w 1440 --h 900 \
//     --wait 500 --timeout 280 --out tools/out/parkour/pk.png
//
// PK_WEAPON=shotgun picks the gun (default smg). PK_ONLY=vault,mantle runs some stations. PK_SHOTS=0 skips the stills.
// Each station reports what the player did, the most the camera's centre left the look (the crosshair against the shot),
// the most roll, and whether the layer came back to rest.
const weapon = process.env.PK_WEAPON ?? 'smg';
const only = process.env.PK_ONLY?.split(',');
const stills = process.env.PK_SHOTS !== '0';

function prelude(gun) {
  const { ctx } = window.__op2;
  const P = ctx.player;
  const V = P.position.constructor;
  const input = ctx.input;
  const cam = ctx.render.camera;
  const K = ['forward', 'back', 'left', 'right', 'jump', 'dash', 'slide', 'fire'];
  const frame = () => new Promise(r => requestAnimationFrame(r));
  const watch = { aim: 0, roll: 0, minSpeed: 99, fired: 0, sounds: {} };
  const fwd = new V();
  const sample = () => {
    // Angle between where the camera's centre points and where a shot would go.
    cam.getWorldDirection(fwd);
    watch.aim = Math.max(watch.aim, Math.acos(Math.min(1, fwd.dot(P.forward))));
    watch.roll = Math.max(watch.roll, Math.abs(cam.rotation.z));
    watch.minSpeed = Math.min(watch.minSpeed, P.speed);
  };
  ctx.events.on('weapon:fired', () => { watch.fired++; });
  const play = ctx.audio.play.bind(ctx.audio);
  ctx.audio.play = (id, o) => {
    if (/hand_plant|boot_scuff|vault_over|gear_rustle|mantle|wall_kick|wallrun_start/.test(id)) watch.sounds[id] = (watch.sounds[id] ?? 0) + 1;
    return play(id, o);
  };
  window.pk = {
    P, watch,
    release() { for (const k of K) input.simulate(k, false); },
    async place(x, y, z, yaw = 0, pitch = 0) {
      this.release();
      input.consumeLook();
      ctx.time.paused = false;
      P.teleport(new V(x, y, z), yaw);
      P.pitch = pitch;
      P.dashCharges = 2;
      for (let i = 0; i < 12; i++) await frame();
      Object.assign(watch, { aim: 0, roll: 0, minSpeed: 99, fired: 0, sounds: {} });
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
    hook: null,
    /**
     * Holds the whole game still on the first game frame where `test` is true. It is checked inside the frame, not from
     * a poll beside it: this machine is shared, a run can drop to a few frames a second, and a vault is over in a fifth
     * of one. Resolves with whether the moment was caught.
     */
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
    async settle() {
      await frame();
      await frame();
    },
    thaw() { ctx.time.paused = false; },
    async rest() {
      this.release();
      await this.wait(1.3);
      return P.moveAnim.idle && cam.rotation.z === 0;
    },
    report(extra = {}) {
      const r = n => Math.round(n * 1000) / 1000;
      return { aimOffDeg: r(watch.aim * 57.2958), rollDeg: r(watch.roll * 57.2958), minSpeed: r(watch.minSpeed), fired: watch.fired, sounds: { ...watch.sounds }, ...extra };
    },
    pose() {
      const m = P.moveAnim;
      const r = n => Math.round(n * 1000) / 1000;
      return { hand: r(m.handW), gunY: r(m.gunY), gunRoll: r(m.gunRoll), camRoll: r(m.camRoll), legs: r(m.legsW), legsMode: m.legsMode };
    },
  };
  // Sampled and hooked once a game frame, after the camera has been placed.
  const update = ctx.camera.update.bind(ctx.camera);
  ctx.camera.update = () => {
    update();
    if (ctx.time.paused) return;
    sample();
    window.pk.hook?.();
  };
  ctx.weapons.switchTo(gun);
  P.modifiers.invulnerable = true;
}

export default async function parkourLive(page, h) {
  for (let i = 0; i < 180; i++) {
    if (await page.evaluate(() => !!window.__lab && window.__op2?.game?.state === 'playing')) break;
    await h.sleep(500);
  }
  await page.mouse.click(300, 400);
  await h.sleep(300);
  await page.evaluate(prelude, weapon);
  await h.sleep(600);

  const out = { weapon };
  /** The game is already frozen by `freezeWhen`. Takes the still and lets it go. */
  const still = async name => {
    await page.evaluate(() => window.pk.settle());
    if (stills) await h.shot(name);
    await page.evaluate(() => window.pk.thaw());
  };
  const run = async (name, fn) => {
    if (only && !only.includes(name)) return;
    try {
      out[name] = await fn();
    } catch (e) {
      out[name] = { error: String(e) };
    }
  };

  // Thin cover, level eyes and looking down. A shot is fired half way over.
  await run('vault', async () => {
    const res = {};
    for (const [tag, pitch] of [['level', 0], ['down', -0.55]]) {
      await page.evaluate(async pitch => {
        const k = window.pk;
        await k.place(-29.5, 0.1, 24.5, 0, pitch);
        window.__op2.ctx.input.simulate('forward', true);
        await k.until(() => k.P.position.z < 19.4);
        window.pk.entry = k.P.speed;
        k.tap('jump');
        await k.freezeWhen(() => k.P.vaulting && k.P.vaultProgress >= 0.55, 1);
      }, pitch);
      const mid = await page.evaluate(() => ({ vaulting: window.pk.P.vaulting, p: window.pk.P.vaultProgress, pose: window.pk.pose() }));
      await still(`vault-${tag}`);
      res[tag] = await page.evaluate(async mid => {
        const k = window.pk;
        window.__op2.ctx.input.simulate('fire', true);
        await k.until(() => !k.P.vaulting, 1);
        window.__op2.ctx.input.simulate('fire', false);
        const z = k.P.position.z;
        await k.wait(0.25);
        const r = k.report({ mid, entry: k.entry, zAtEnd: z, grounded: k.P.grounded, speedAfter: k.P.speed });
        r.rest = await k.rest();
        return r;
      }, mid);
    }
    return res;
  });

  await run('slide', async () => {
    const res = {};
    for (const [tag, pitch] of [['level', 0], ['down', -0.6]]) {
      await page.evaluate(async pitch => {
        const k = window.pk;
        await k.place(-29.5, 0.1, 16.8, 0, pitch);
        window.__op2.ctx.input.simulate('forward', true);
        await k.until(() => k.P.position.z < 14.6);
        window.__op2.ctx.input.simulate('slide', true);
        await k.freezeWhen(() => k.P.position.z < 13.2, 1);
      }, pitch);
      const mid = await page.evaluate(() => ({ sliding: window.pk.P.sliding, pose: window.pk.pose() }));
      await still(`slide-${tag}`);
      res[tag] = await page.evaluate(async mid => {
        const k = window.pk;
        await k.until(() => k.P.position.z < 11.2, 1.5);
        const under = k.P.position.z < 11.3 && k.P.sliding;
        // Slide-jump out.
        await k.tap('jump');
        await k.wait(0.06);
        const hop = k.pose();
        const r = k.report({ mid, wentUnder: under, hop });
        r.rest = await k.rest();
        return r;
      }, mid);
    }
    return res;
  });

  // The deep crate: more time over the top.
  await run('crate', async () => {
    await page.evaluate(async () => {
      const k = window.pk;
      await k.place(-29.5, 0.1, 10.6, 0, -0.25);
      window.__op2.ctx.input.simulate('forward', true);
      await k.until(() => k.P.position.z < 8.3);
      k.tap('jump');
      await k.freezeWhen(() => k.P.vaulting && k.P.vaultProgress >= 0.45, 1);
    });
    const mid = await page.evaluate(() => ({ vaulting: window.pk.P.vaulting, p: window.pk.P.vaultProgress, pose: window.pk.pose() }));
    await still('crate');
    return page.evaluate(async mid => {
      const k = window.pk;
      await k.until(() => !k.P.vaulting, 1);
      const r = k.report({ mid, zAtEnd: k.P.position.z });
      r.rest = await k.rest();
      return r;
    }, mid);
  });

  // West wall on the left, then a kick across to the corridor wall on the right.
  await run('wall', async () => {
    await page.evaluate(async () => {
      const k = window.pk;
      await k.place(-30.6, 0.1, 4.7, 0, 0);
      const input = window.__op2.ctx.input;
      input.simulate('forward', true);
      await k.wait(0.2);
      k.look(0.32);
      await k.wait(0.05);
      await k.tap('jump');
      await k.until(() => k.P.wallRunning, 1.5);
      await k.freezeAfter(0.16);
    });
    const left = await page.evaluate(() => ({ running: window.pk.P.wallRunning, side: window.pk.P.wallSide, pose: window.pk.pose() }));
    await still('wallrun-left');
    await page.evaluate(async () => {
      const k = window.pk;
      k.look(-0.7);
      k.tap('jump');
      await k.freezeWhen(() => k.P.kickSide !== 0 && !k.P.wallRunning && k.P.moveAnim.handX < -0.4, 0.5);
    });
    const kick = await page.evaluate(() => ({ kickSide: window.pk.P.kickSide, pose: window.pk.pose() }));
    await still('wallkick');
    await page.evaluate(async () => {
      const k = window.pk;
      await k.until(() => k.P.wallRunning && k.P.wallSide > 0, 1.2);
      await k.wait(0.12);
    });
    // Whether the kick carried into a run on the far wall. No still: with the wall on the gun's side the hand stays put.
    const right = await page.evaluate(() => ({ running: window.pk.P.wallRunning, side: window.pk.P.wallSide, pose: window.pk.pose() }));
    return page.evaluate(async parts => {
      const k = window.pk;
      const r = k.report(parts);
      r.rest = await k.rest();
      return r;
    }, { left, kick, right });
  });

  // The 2 m block: reach, pull, top out, then walk off the far edge and land.
  await run('mantle', async () => {
    await page.evaluate(async () => {
      const k = window.pk;
      await k.place(-30, 0.1, -6.5, 0, 0);
      window.__op2.ctx.input.simulate('forward', true);
      await k.until(() => k.P.position.z < -10.6);
      k.tap('jump');
      await k.freezeWhen(() => k.P.mantling && k.P.mantleProgress >= 0.3, 1.5);
    });
    const early = await page.evaluate(() => ({ mantling: window.pk.P.mantling, p: window.pk.P.mantleProgress, pose: window.pk.pose() }));
    await still('mantle-reach');
    await page.evaluate(() => window.pk.freezeWhen(() => window.pk.P.mantling && window.pk.P.mantleProgress >= 0.85, 1));
    const late = await page.evaluate(() => ({ mantling: window.pk.P.mantling, p: window.pk.P.mantleProgress, pose: window.pk.pose() }));
    await still('mantle-pull');
    const top = await page.evaluate(async () => {
      const k = window.pk;
      await k.until(() => !k.P.mantling, 1);
      await k.wait(0.03);
      const at = { y: k.P.position.y, grounded: k.P.grounded, speed: k.P.speed };
      await k.freezeWhen(() => !k.P.grounded && k.P.velocity.y < -3.5, 2);
      return at;
    });
    const drop = await page.evaluate(() => window.pk.pose());
    await still('ledge-drop');
    return page.evaluate(async parts => {
      const k = window.pk;
      await k.until(() => k.P.grounded, 1.5);
      const r = k.report(parts);
      r.rest = await k.rest();
      return r;
    }, { early, late, top, drop });
  });

  // A double jump in the open, a jump and climb onto the 3 m deck, then a slam back to the floor.
  await run('deck', async () => {
    await page.evaluate(async () => {
      const k = window.pk;
      await k.place(0, 0.1, 12, 0, 0);
      window.__op2.ctx.input.simulate('forward', true);
      await k.wait(0.2);
      await k.tap('jump');
      await k.wait(0.25);
      k.tap('jump');
      await k.freezeAfter(0.1);
    });
    const dbl = await page.evaluate(() => window.pk.pose());
    await still('double-jump');
    const up = await page.evaluate(async () => {
      const k = window.pk;
      await k.place(-30, 0.1, -16.2, 0, 0);
      window.__op2.ctx.input.simulate('forward', true);
      await k.wait(0.12);
      await k.tap('jump');
      await k.until(() => k.P.grounded && k.P.position.y > 2.9, 2.5);
      const at = { y: k.P.position.y, grounded: k.P.grounded };
      k.release();
      await k.place(-12, 3.1, -21.5, Math.PI, -0.3);
      window.__op2.ctx.input.simulate('forward', true);
      await k.wait(0.25);
      await k.tap('jump');
      await k.wait(0.3);
      await k.tap('slide');
      await k.freezeWhen(() => k.P.slamming && k.P.velocity.y < -36, 0.6);
      return at;
    });
    const fall = await page.evaluate(() => ({ slamming: window.pk.P.slamming, pose: window.pk.pose() }));
    await still('slam-fall');
    await page.evaluate(async () => {
      const k = window.pk;
      await k.until(() => k.P.grounded, 1.5);
      await k.freezeAfter(0.2);
    });
    const land = await page.evaluate(() => window.pk.pose());
    await still('slam-land');
    return page.evaluate(async parts => {
      const k = window.pk;
      const r = k.report(parts);
      r.rest = await k.rest();
      return r;
    }, { dbl, up, fall, land });
  });

  // A side dash and a hard landing, in the open.
  await run('dash', async () => {
    await page.evaluate(async () => {
      const k = window.pk;
      await k.place(0, 0.1, 10, 0, 0);
      const input = window.__op2.ctx.input;
      input.simulate('right', true);
      await k.wait(0.2);
      k.tap('dash');
      await k.freezeAfter(0.09);
    });
    const dash = await page.evaluate(() => window.pk.pose());
    await still('dash-right');
    await page.evaluate(async () => {
      const k = window.pk;
      k.release();
      await k.place(0, 9, 8, 0, 0);
      await k.until(() => k.P.grounded, 2.5);
      await k.freezeAfter(0.07);
    });
    const land = await page.evaluate(() => window.pk.pose());
    await still('hard-landing');
    return page.evaluate(async parts => {
      const k = window.pk;
      const r = k.report(parts);
      r.rest = await k.rest();
      return r;
    }, { dash, land });
  });

  return out;
}
