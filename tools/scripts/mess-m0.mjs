// M0 of the gore update: what the mess costs to draw, measured in the real game.
//
//   node tools/shot.mjs --port <yours> --url "/?autostart=1" --dpr 2 --w 1440 --h 900 --wait 500 --timeout 580 --quiet \
//     --script tools/scripts/mess-m0.mjs
//
// Leave out --out, or point it somewhere you do not mind: the report is the script's result, also written to
// M0_DIR/m0.json. Phases (M0_PHASES, comma list):
//   corpses   frame cost with 0, 20, 40 and 80 corpses lying in view (M0_COUNTS), as they are and with one thing
//             changed: shadows off, interiors off, the next two levels of detail, the bodies hidden. Draw calls and
//             triangles for each. Half the bodies are opened with a shotgun round first, so interiors are really drawn.
//   bake      `bakePose` on a corpse of each archetype in M0_ARCH, in ms.
//   decals    frame cost of the blood ring: spread over the floor, and with a thousand stacked on one spot in view.
//   crowd     eight living husks at 5 to 14 m: the scene `docs/notes/render.md` timed on the laptop, for scale.
//
// All timing is relative, as in gpu-bench.mjs: the frame is rendered between GPU syncs with the game stopped, the best
// of M0_ROUNDS rounds of M0_N frames is kept, and a figure taken while the machine is overloaded proves nothing.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PHASES = (process.env.M0_PHASES ?? 'crowd,corpses,bake,decals').split(',');
const COUNTS = (process.env.M0_COUNTS ?? '0,20,40,80,150').split(',').map(Number);
const ARCH = (process.env.M0_ARCH ?? 'trooper,husk,brute').split(',');
const DIR = process.env.M0_DIR ?? 'tools/out/mess';
const N = Number(process.env.M0_N ?? 10);
const ROUNDS = Number(process.env.M0_ROUNDS ?? 8);
const SPOT = process.env.M0_SPOT ?? 'core_floor';

/** Runs in the page. */
async function install({ n, rounds, spot }) {
  const { ctx, game } = window.__op2;
  const r = ctx.render;
  const renderer = r.renderer;
  const gl = renderer.getContext();
  const gore = await import('/src/gore/index.ts');
  r.dynamicResolution.enabled = false;
  ctx.waves.update = () => {};
  ctx.waves.start = () => {};
  ctx.player.modifiers.invulnerable = true;
  ctx.render.viewScene.visible = false;
  const hud = document.getElementById('hud');
  if (hud) hud.style.display = 'none';

  // gl.finish() in Chrome is only a flush. A read from a framebuffer of its own, after a clear queued behind the work,
  // is the one thing that really waits.
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
    const mask = gl.getParameter(gl.COLOR_WRITEMASK);
    const scissor = gl.isEnabled(gl.SCISSOR_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.colorMask(true, true, true, true);
    if (scissor) gl.disable(gl.SCISSOR_TEST);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    if (scissor) gl.enable(gl.SCISSOR_TEST);
    gl.colorMask(mask[0], mask[1], mask[2], mask[3]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
  };
  const raf = k => new Promise(res => {
    const step = () => (--k <= 0 ? res() : requestAnimationFrame(step));
    requestAnimationFrame(step);
  });
  const freeze = () => { game.frame = () => {}; };
  const thaw = () => { delete game.frame; };
  const P = ctx.player;
  const V = P.eye.constructor;
  const hitOf = () => ({ point: new V(), normal: new V(), distance: 0, surface: 'concrete', collider: null });
  const ground = (x, y, z) => {
    const h = hitOf();
    return ctx.physics.raycastInto(new V(x, y + 1.5, z), new V(0, -1, 0), 40, 1, h) ? h.point.clone() : new V(x, y, z);
  };
  const view = ctx.world.spec.views[spot];
  const origin = new V(...view.pos);
  // The longest clear run of floor from the spot: the bodies lie along it and the camera looks down it.
  let heading = 0;
  let longest = 0;
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    const h = hitOf();
    const d = ctx.physics.raycastInto(new V(origin.x, origin.y + 1, origin.z), new V(Math.sin(a), 0, Math.cos(a)), 40, 1, h) ? h.distance : 40;
    if (d > longest) {
      longest = d;
      heading = a;
    }
  }
  const fwd = new V(Math.sin(heading), 0, Math.cos(heading));
  const side = new V(fwd.z, 0, -fwd.x);
  const stand = () => {
    P.teleport(ground(origin.x, origin.y, origin.z), Math.atan2(-fwd.x, -fwd.z));
    P.yaw = Math.atan2(-fwd.x, -fwd.z);
    P.pitch = -0.2;
  };

  const frameCost = frames => {
    sync();
    const t0 = performance.now();
    for (let i = 0; i < frames; i++) r.render();
    sync();
    return (performance.now() - t0) / frames;
  };
  /** Best of the rounds, with the draw calls and triangles of the last frame. */
  const cost = () => {
    let best = Infinity;
    for (let i = 0; i < rounds; i++) best = Math.min(best, frameCost(n));
    return { ms: +best.toFixed(2), calls: r.drawCalls(), tris: r.triangles() };
  };
  /** Runs `variants` round-robin against the frame as it is, so load from other programs hits them alike. */
  const compare = variants => {
    const names = ['base', ...Object.keys(variants)];
    const best = Object.fromEntries(names.map(k => [k, Infinity]));
    const cpu = Object.fromEntries(names.map(k => [k, Infinity]));
    const load = {};
    for (let round = 0; round < rounds; round++) {
      for (const name of names) {
        const undo = name === 'base' ? null : variants[name]();
        r.render();
        best[name] = Math.min(best[name], frameCost(n));
        // The script's own share: the frame submitted and not waited for. What is left of `ms` is the GPU's.
        sync();
        const t0 = performance.now();
        for (let i = 0; i < n; i++) r.render();
        cpu[name] = Math.min(cpu[name], (performance.now() - t0) / n);
        sync();
        load[name] = [r.drawCalls(), r.triangles()];
        undo?.();
        r.render();
      }
    }
    return Object.fromEntries(names.map(k => [k, { ms: +best[k].toFixed(3), cpu: +cpu[k].toFixed(3), calls: load[k][0], tris: load[k][1] }]));
  };

  const corpsesOf = () => ctx.gore.bodies.filter(b => b.sinking < 0 && !b.down);
  const settle = async seconds => {
    const end = performance.now() + seconds * 1000;
    while (performance.now() < end) {
      await raf(6);
      const s = ctx.gore.stats();
      if (s.ragdolls === 0 && s.liveLimbs === 0) return true;
    }
    return false;
  };
  /** `count` bodies lying in rows from 4 m to about 18 m down the run of floor, `kinds` in turn. */
  const lay = async (count, kinds) => {
    thaw();
    ctx.enemies.killAll?.('m0');
    ctx.gore.clear();
    r.decals.clear();
    gore.GoreTuning.maxCorpses = 400;
    stand();
    await raf(4);
    const perRow = 10;
    // The game holds 48 alive at once, so they are laid and killed forty at a time.
    for (let from = 0; from < count; from += 40) {
      for (let i = from; i < Math.min(count, from + 40); i++) {
        const row = Math.floor(i / perRow);
        const col = (i % perRow) - (perRow - 1) / 2;
        const d = Math.min(4 + row * 1.4, longest - 1.5);
        const at = ground(origin.x + fwd.x * d + side.x * col * 1.1, origin.y, origin.z + fwd.z * d + side.z * col * 1.1);
        const e = ctx.enemies.spawn(kinds[i % kinds.length], at);
        if (!e) continue;
        e.attacks = [];
        e.behaviours = [];
        e.speedMul = 0;
      }
      await raf(3);
      ctx.enemies.killAll('m0');
      await settle(14);
    }
    // Every other body takes a shotgun round in the chest from above, the real way a body is opened.
    const bodies = corpsesOf();
    const hips = new V();
    for (let i = 0; i < bodies.length; i += 2) {
      hips.setFromMatrixPosition(bodies[i].char.bones[2].matrixWorld);
      const from = new V(hips.x, hips.y + 1.2, hips.z);
      const hit = ctx.gore.raycastCorpses(from, new V(0, -1, 0), 3);
      if (!hit) continue;
      ctx.gore.damageCorpse(hit, { amount: 34, type: 'pellet', point: hit.point.clone(), dir: new V(0, -1, 0), force: 6, source: 'shotgun' });
      if (i % 12 === 0) await raf(1);
    }
    const settled = await settle(14);
    await raf(30);
    for (const b of corpsesOf()) b.char.setLod?.(0, true);
    await raf(4);
    freeze();
    await raf(2);
    const opened = corpsesOf().filter(b => b.char.inside?.visible).length;
    return { bodies: corpsesOf().length, opened, settled, decals: r.decals.total };
  };

  const hide = (list, on) => {
    for (const b of list) b.char.root.visible = on;
  };
  const corpseVariants = () => {
    const list = corpsesOf();
    return {
      // No body casts a shadow: what tier 1 of the plan would save.
      noCorpseShadows: () => {
        const was = [];
        for (const b of list) b.char.root.traverse(o => { if (o.castShadow) { was.push(o); o.castShadow = false; } });
        return () => { for (const o of was) o.castShadow = true; };
      },
      noShadowsAtAll: () => { r.passes.shadows = false; return () => { r.passes.shadows = true; }; },
      noInteriors: () => {
        const was = [];
        for (const b of list) if (b.char.inside?.visible) { was.push(b.char.inside); b.char.inside.visible = false; }
        return () => { for (const o of was) o.visible = true; };
      },
      lod1: () => { for (const b of list) b.char.setLod(1, true); return () => { for (const b of list) b.char.setLod(0, true); }; },
      lod2: () => { for (const b of list) b.char.setLod(2, true); return () => { for (const b of list) b.char.setLod(0, true); }; },
      lod3: () => { for (const b of list) b.char.setLod(3, true); return () => { for (const b of list) b.char.setLod(0, true); }; },
      // The skeleton is neither worked out nor sent again: a body that lies still has nothing new to send.
      stillSkeleton: () => {
        const was = [];
        for (const b of list) { was.push([b.char.skeleton, b.char.skeleton.update]); b.char.skeleton.update = () => {}; }
        return () => { for (const [sk] of was) delete sk.update; };
      },
      // The plan's tier 1 in one: the next level of detail, no shadow of its own, nothing under the skin, a still skeleton.
      tier1: () => {
        const undo = [];
        for (const b of list) {
          b.char.setLod(1, true);
          if (b.char.inside?.visible) { const o = b.char.inside; o.visible = false; undo.push(() => { o.visible = true; }); }
          b.char.root.traverse(o => { if (o.castShadow) { o.castShadow = false; undo.push(() => { o.castShadow = true; }); } });
          const sk = b.char.skeleton;
          sk.update = () => {};
          undo.push(() => { delete sk.update; });
        }
        return () => { for (const u of undo) u(); for (const b of list) b.char.setLod(0, true); };
      },
      hidden: () => { hide(list, false); return () => hide(list, true); },
      noDecals: () => { r.passes.decals = false; return () => { r.passes.decals = true; }; },
    };
  };

  const bake = async kinds => {
    const out = {};
    for (const kind of kinds) {
      await lay(2, [kind]);
      const b = corpsesOf()[0];
      if (!b) continue;
      const times = [];
      let verts = 0;
      let tris = 0;
      for (let i = 0; i < 24; i++) {
        const t0 = performance.now();
        const g = b.char.bakePose();
        times.push(performance.now() - t0);
        verts = g.attributes.position.count;
        tris = g.index.count / 3;
        g.dispose();
      }
      times.sort((a, c) => a - c);
      const lods = b.char.a.model.lods.map(g => ({ verts: g.attributes.position.count, tris: (g.index ? g.index.count : g.attributes.position.count) / 3 }));
      out[kind] = { best: +times[0].toFixed(2), median: +times[12].toFixed(2), verts, tris, lods, bones: b.char.bones.length };
    }
    return out;
  };

  /** Blood decals spread over the run of floor in view, then `stacked` more on one 3 m spot 6 m ahead. */
  const decals = async (spread, stacked, down = false) => {
    thaw();
    ctx.enemies.killAll?.('m0');
    ctx.gore.clear();
    r.decals.clear();
    stand();
    await raf(4);
    let seed = 9;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const up = new V(0, 1, 0);
    const kinds = ['blood', 'blood', 'blood', 'bloodPool', 'bloodSmear'];
    const reach = Math.min(longest - 1, 22);
    for (let i = 0; i < spread; i++) {
      const d = 2 + rnd() * (reach - 2);
      const s = (rnd() - 0.5) * 10;
      const at = ground(origin.x + fwd.x * d + side.x * s, origin.y, origin.z + fwd.z * d + side.z * s);
      const kind = kinds[i % kinds.length];
      r.decals.add(kind, at, up, kind === 'bloodPool' ? 1 + rnd() : 0.15 + rnd() * 0.5);
    }
    for (let i = 0; i < stacked; i++) {
      const a = rnd() * Math.PI * 2;
      const q = Math.sqrt(rnd()) * 1.5;
      const at = ground(origin.x + fwd.x * 6 + Math.cos(a) * q, origin.y, origin.z + fwd.z * 6 + Math.sin(a) * q);
      const kind = kinds[i % kinds.length];
      r.decals.add(kind, at, up, kind === 'bloodPool' ? 1 + rnd() : 0.2 + rnd() * 0.6);
    }
    if (down) {
      // Standing on the soaked spot and looking at one's feet: the stack fills the screen.
      P.teleport(ground(origin.x + fwd.x * 6, origin.y, origin.z + fwd.z * 6), Math.atan2(-fwd.x, -fwd.z));
      P.pitch = -1.35;
    }
    await raf(6);
    freeze();
    await raf(2);
    const res = compare({ noDecals: () => { r.passes.decals = false; return () => { r.passes.decals = true; }; } });
    return { spread, stacked, down, total: r.decals.total, ...res };
  };

  const crowd = async count => {
    thaw();
    ctx.enemies.killAll?.('m0');
    ctx.gore.clear();
    r.decals.clear();
    stand();
    await raf(6);
    for (let i = 0; i < count; i++) {
      const d = 5 + (i % 4) * 3, s = (i - count / 2) * 1.1;
      const e = ctx.enemies.spawn('husk', ground(origin.x + fwd.x * d + side.x * s, origin.y, origin.z + fwd.z * d + side.z * s));
      if (e) { e.attacks = []; e.behaviours = []; e.speedMul = 0; }
    }
    await raf(40);
    freeze();
    await raf(2);
    return { live: ctx.enemies.alive.length, ...compare({}).base };
  };

  window.__m0 = { lay, compare, cost, corpseVariants, bake, decals, crowd, thaw, freeze, raf, size: () => r.renderSize(), longest: () => longest, quality: () => r.quality };
  return { size: r.renderSize(), longest: +longest.toFixed(1), limits: { blood: r.decals.limit?.('blood') } };
}

export default async function m0(page, h) {
  await page.waitForFunction('!!window.__op2 && window.__op2.game && window.__op2.game.state === "playing"', null, { timeout: 120000 });
  await h.sleep(1500);
  const report = { phases: PHASES, n: N, rounds: ROUNDS };
  report.setup = await page.evaluate(install, { n: N, rounds: ROUNDS, spot: SPOT });
  const shots = [];
  if (PHASES.includes('crowd')) report.crowd = await page.evaluate(() => window.__m0.crowd(8));
  if (PHASES.includes('corpses')) {
    report.corpses = [];
    for (const count of COUNTS) {
      const laid = await page.evaluate(([c, kinds]) => window.__m0.lay(c, kinds), [count, ['trooper', 'husk', 'trooper', 'gunner']]);
      const res = await page.evaluate(() => window.__m0.compare(window.__m0.corpseVariants()));
      report.corpses.push({ count, ...laid, ...res });
      await page.evaluate(() => window.__op2.ctx.render.render());
      const file = join(DIR, `m0-corpses-${count}.png`);
      mkdirSync(DIR, { recursive: true });
      await page.screenshot({ path: file });
      shots.push(file);
    }
  }
  if (PHASES.includes('bake')) report.bake = await page.evaluate(k => window.__m0.bake(k), ARCH);
  if (PHASES.includes('decals')) {
    report.decals = [];
    for (const [spread, stacked, down] of [[0, 0, 0], [2048, 0, 0], [8192, 0, 0], [7192, 1000, 0], [0, 250, 1], [0, 1000, 1], [0, 4000, 1], [0, 8192, 1]]) {
      report.decals.push(await page.evaluate(([a, b, c]) => window.__m0.decals(a, b, !!c), [spread, stacked, down]));
      await page.evaluate(() => window.__op2.ctx.render.render());
      const file = join(DIR, `m0-decals-${spread}-${stacked}${down ? '-down' : ''}.png`);
      mkdirSync(DIR, { recursive: true });
      await page.screenshot({ path: file });
      shots.push(file);
    }
  }
  await page.evaluate(() => window.__m0.thaw());
  report.shots = shots;
  mkdirSync(DIR, { recursive: true });
  writeFileSync(join(DIR, 'm0.json'), JSON.stringify(report, null, 1));
  return report;
}
