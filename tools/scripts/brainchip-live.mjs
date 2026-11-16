// Brain chips on key T (src/contracts/chips.ts) in the real Crucible: the T badge for each chip, a hold of T switching chips,
// Thermal on at ground level with a crowd in front, Focus running, the shop's chip rows, and Thermal's cost.
//
//   node tools/shot.mjs --port 5285 --url "/?autostart=1" --script tools/scripts/brainchip-live.mjs --wait 500 --timeout 420 \
//     --dpr 2 --w 1440 --h 900 --quiet --out tools/out/brainchip/chip.png
//
// BC_STEPS (comma list, default all): badges, thermal, focus, shop, cost.
const STEPS = (process.env.BC_STEPS ?? 'badges,thermal,focus,shop,cost').split(',');

function prelude() {
  const frame = () => new Promise(r => requestAnimationFrame(r));
  window.bc = {
    frame,
    async frames(n) { for (let i = 0; i < n; i++) await frame(); },
    get ctx() { return window.__op2.ctx; },
    get chips() { return window.__op2.ctx.contracts.chips; },
    badge() {
      const el = document.querySelector('.ci.sn');
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, text: el.textContent, cooling: el.classList.contains('cooling') };
    },
  };
}

async function until(page, h, test, tries = 160, ms = 250) {
  for (let i = 0; i < tries; i++) {
    if (await page.evaluate(test)) return true;
    await h.sleep(ms);
  }
  return false;
}

/** The badge and the call-ins around it, cropped. */
async function badgeShot(page, h, name) {
  const b = await page.evaluate(() => window.bc.badge());
  const pad = 24;
  const file = `${h.outDir}/badge-${name}.png`;
  await page.screenshot({ path: file, clip: { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: b.w + pad * 2 + 120, height: b.h + pad * 2 } });
  return { file, text: b.text, cooling: b.cooling };
}

/** The player at the spawn, facing a crowd of husks at 6 to 30 m, the waves held. */
async function stage(page, count = 10) {
  return page.evaluate(async count => {
    const { ctx } = window.__op2;
    const P = ctx.player;
    const V = P.eye.constructor;
    ctx.waves.update = () => {};
    P.modifiers.invulnerable = true;
    ctx.enemies.killAll?.('bench');
    for (const e of [...ctx.enemies.alive]) e.health = 0;
    await window.bc.frames(10);
    const s = ctx.world.playerSpawns[0];
    P.teleport(s.position.clone(), 0);
    P.pitch = -0.03;
    await window.bc.frames(10);
    const ground = (x, y, z) => {
      const hit = { point: new V(), normal: new V(), distance: 0, surface: 'concrete', collider: null };
      return ctx.physics.raycastInto(new V(x, y + 1.5, z), new V(0, -1, 0), 40, 1, hit) ? hit.point.clone() : new V(x, y, z);
    };
    const f = P.forward;
    for (let i = 0; i < count; i++) {
      const d = 6 + (i % 5) * 6, side = (i - count / 2) * 1.6;
      ctx.enemies.spawn('husk', ground(P.eye.x + f.x * d - f.z * side, P.eye.y, P.eye.z + f.z * d + f.x * side));
    }
    await window.bc.frames(30);
    return { alive: ctx.enemies.alive.length };
  }, count);
}

export default async function brainchip(page, h) {
  await page.evaluate(prelude);
  const out = {};
  out.playing = await until(page, h, () => window.__op2?.game?.state === 'playing' && window.__op2.ctx.contracts.chips != null);
  out.stage = await stage(page);

  if (STEPS.includes('badges')) {
    out.sonarReady = await badgeShot(page, h, 'sonar-ready');
    await h.press('KeyT', 60);
    await h.sleep(900);
    out.sonarCooling = await badgeShot(page, h, 'sonar-cooling');
    await page.evaluate(() => {
      const r = window.bc.chips.rack;
      r.openSlot();
      r.fit('thermal', true);
    });
    await h.sleep(200);
    out.twoSlots = await badgeShot(page, h, 'sonar-two-slots');
    // Hold T: to Thermal, with the callout.
    await h.keyDown('KeyT');
    await until(page, h, () => window.bc.chips.current === 'thermal', 60, 30);
    // The callout lasts under a second; hold its animation where it is fully up for the still.
    await page.evaluate(() => document.querySelectorAll('.callout, .callout-bar').forEach(el => el.getAnimations().forEach(a => { a.pause(); a.currentTime = 300; })));
    await h.shot('switch-callout');
    await page.evaluate(() => document.querySelectorAll('.callout, .callout-bar').forEach(el => el.getAnimations().forEach(a => a.play())));
    await h.keyUp('KeyT');
    out.afterHold = await page.evaluate(() => ({ current: window.bc.chips.current, thermal: window.bc.chips.thermal }));
    out.thermalOff = await badgeShot(page, h, 'thermal-off');
    await h.press('KeyT', 60);
    await h.sleep(300);
    out.thermalOn = await badgeShot(page, h, 'thermal-on');
    out.afterTap = await page.evaluate(() => ({ thermal: window.bc.chips.thermal, filter: window.__op2.ctx.render.renderer.domElement.style.filter }));
  }

  if (STEPS.includes('thermal')) {
    await page.evaluate(() => {
      const c = window.bc.chips;
      c.rack.fit('thermal', true);
      c.index = c.rack.fitted.indexOf('thermal');
      c.setThermal(true);
    });
    out.stage2 = await stage(page, 12);
    await h.sleep(500);
    await h.shot('thermal-ground');
    await page.evaluate(() => window.bc.chips.setThermal(false));
    await h.sleep(400);
    await h.shot('thermal-off-same-view');
  }

  if (STEPS.includes('focus')) {
    await page.evaluate(() => {
      const c = window.bc.chips;
      c.setThermal(false);
      c.rack.fit('focus', true);
      c.index = c.rack.fitted.indexOf('focus');
    });
    out.stage3 = await stage(page, 10);
    out.focusFull = await badgeShot(page, h, 'focus-full');
    // A tap through the bots' path: the real key is shown working in the badges step.
    await page.evaluate(async () => {
      const i = window.__op2.ctx.input;
      i.simulate('sonar', true);
      await window.bc.frames(2);
      i.simulate('sonar', false);
      await window.bc.frames(1);
    });
    await h.sleep(900);
    out.focusRun = await page.evaluate(() => ({ focus: window.bc.chips.focus, meter: window.bc.chips.meter, slowmo: window.__op2.ctx.time.slowmo }));
    await h.shot('focus-active');
    out.focusDraining = await badgeShot(page, h, 'focus-draining');
    await h.sleep(3000);
    out.focusDry = await page.evaluate(() => ({ focus: window.bc.chips.focus, meter: window.bc.chips.meter, slowmo: window.__op2.ctx.time.slowmo }));
    out.focusEmpty = await badgeShot(page, h, 'focus-empty');
    await h.sleep(6000);
    out.focusRefill = await page.evaluate(() => ({ meter: window.bc.chips.meter }));
    out.focusRefilling = await badgeShot(page, h, 'focus-refilling');
  }

  if (STEPS.includes('cost')) out.cost = await cost(page, h);

  if (STEPS.includes('shop')) {
    await page.evaluate(async () => {
      const { ctx } = window.__op2;
      const c = window.bc.chips;
      c.setFocus(false);
      c.rack.reset();
      // The thermal picture up as the shop opens: the studio must come up clean.
      c.thermal = true;
      c.updateThermal();
      const before = ctx.render.renderer.domElement.style.filter;
      ctx.enemies.killAll?.('bench');
      for (const e of [...ctx.enemies.alive]) e.health = 0;
      ctx.waves.wave = 10;
      ctx.waves.phase = 'intermission';
      ctx.waves.nextWaveIn = 600;
      ctx.contracts.shop.credits = 4200;
      ctx.events.emit('shop:open', {});
      window.bc.filterBefore = before;
    });
    await h.sleep(1200);
    await page.evaluate(() => [...document.querySelectorAll('.pc-tab')][2]?.click());
    await h.sleep(800);
    // Rows: two implant slots and eight implants, then chip slot 2, Sonar, Thermal, Focus.
    for (let i = 0; i < 10; i++) await h.press('ArrowDown', 40);
    await h.sleep(700);
    await h.shot('shop-chip-slot');
    await h.press('Enter', 60);
    await h.sleep(300);
    for (let i = 0; i < 2; i++) await h.press('ArrowDown', 40);
    await h.sleep(700);
    await h.shot('shop-thermal');
    await h.press('Enter', 60);
    await h.sleep(300);
    await h.press('ArrowDown', 40);
    await h.sleep(700);
    await h.shot('shop-focus');
    out.shop = await page.evaluate(() => ({
      rows: [...document.querySelectorAll('.pc-row')].slice(-4).map(r => r.textContent),
      slots: [...document.querySelectorAll('.pc-chips .pc-slot')].map(r => r.textContent),
      credits: window.__op2.ctx.contracts.shop.credits,
      fitted: [...window.bc.chips.rack.fitted],
      filterBeforeOpen: window.bc.filterBefore,
      canvasFilter: window.__op2.ctx.render.renderer.domElement.style.filter,
    }));
  }
  return out;
}

/**
 * Thermal's cost. GPU: the frozen frame rendered with and without the thermal grade and the crowd's silhouettes, round robin,
 * synced by a read-back. The CSS filter is the compositor's, outside WebGL, so it shows only in the live frame intervals, held
 * with and without it.
 */
async function cost(page, h) {
  await stage(page, 14);
  const gpu = await page.evaluate(async () => {
    const { ctx, game } = window.__op2;
    const r = ctx.render;
    r.dynamicResolution.enabled = false;
    const gl = r.renderer.getContext();
    const fbo = gl.createFramebuffer();
    const tex = gl.createTexture();
    const prevTex = gl.getParameter(gl.TEXTURE_BINDING_2D);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindTexture(gl.TEXTURE_2D, prevTex);
    const prevFbo = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, prevFbo);
    const px = new Uint8Array(4);
    const sync = () => {
      const f = gl.getParameter(gl.FRAMEBUFFER_BINDING);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    };
    game.frame = () => {};
    await window.bc.frames(3);
    const meshes = ctx.enemies.alive.map(e => e.char.mesh);
    const time = (thermal, frames = 8) => {
      sync();
      const t0 = performance.now();
      for (let i = 0; i < frames; i++) {
        if (thermal) r.highlight(meshes, '#ffffff', 1);
        r.render();
      }
      sync();
      return (performance.now() - t0) / frames;
    };
    const off = [], on = [];
    r.post.setGrade('default', 0);
    for (let k = 0; k < 8; k++) {
      r.post.setGrade('default', 0);
      off.push(time(false));
      r.post.setGrade('thermal', 0);
      on.push(time(true));
    }
    r.post.setGrade('default', 0);
    delete game.frame;
    const best = a => Math.min(...a);
    const med = a => [...a].sort((x, y) => x - y)[a.length >> 1];
    return { enemies: meshes.length, offBest: best(off), onBest: best(on), offMed: med(off), onMed: med(on) };
  });
  // Live: the real loop, Thermal on and off by turns, 4 s each, three times.
  const live = await page.evaluate(async () => {
    const c = window.bc.chips;
    c.rack.fit('thermal', true);
    const sample = async ms => {
      const iv = [];
      let last = performance.now();
      const end = last + ms;
      while (performance.now() < end) {
        await window.bc.frame();
        const now = performance.now();
        iv.push(now - last);
        last = now;
      }
      const mean = iv.reduce((a, b) => a + b, 0) / iv.length;
      return { mean, slow: iv.filter(x => x > 20).length / iv.length, cpu: window.__op2.game.cpuMs };
    };
    const off = [], on = [];
    for (let k = 0; k < 3; k++) {
      c.setThermal(false);
      await window.bc.frames(20);
      off.push(await sample(4000));
      c.setThermal(true);
      await window.bc.frames(20);
      on.push(await sample(4000));
    }
    c.setThermal(false);
    const avg = (a, k) => a.reduce((s, x) => s + x[k], 0) / a.length;
    return { offMean: avg(off, 'mean'), onMean: avg(on, 'mean'), offSlow: avg(off, 'slow'), onSlow: avg(on, 'slow') };
  });
  const r2 = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? Math.round(v * 100) / 100 : v]));
  return { gpu: r2(gpu), live: r2(live) };
}
