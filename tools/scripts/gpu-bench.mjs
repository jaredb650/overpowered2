// Where the GPU frame goes, in the real game on the real map. All timing is relative: every figure is the best
// of several rounds, and variants run round-robin against the base, so load from other programs hits them alike.
//
//   GB_PHASES=stages,variants,shots node tools/shot.mjs --url "/?map=killhouse&autostart=1" --dpr 2 --w 1440 --h 900 \
//     --wait 500 --timeout 200 --quiet --script tools/scripts/gpu-bench.mjs
//
// Leave out --out. A final Retina screenshot on a busy machine can time out and lose the report.
//
// Phases (GB_PHASES, comma list):
//   stages     Syncs the GPU between the stages of one frame. Each stage then carries its own CPU submission
//              and one sync floor, so read it as a share, not as a sum.
//   passes     Renderer.measurePasses().
//   variants   Whole-frame throughput with one thing changed at a time. Uses GB_VARIANTS, or all of them.
//   shots      Screenshot of each spot into tools/out/shot-<GB_TAG>-<spot>.png, with the HUD hidden.
//   fight      Live fight with the real game loop: holds GB_ENEMIES (14) alive around the player and fires for
//              GB_SECONDS (14), then reports the frame interval distribution.
// Env: GB_SPOTS (comma list, default all for the map), GB_TAG (shot name prefix, default "gb"), GB_N (frames per
// round, default 6), GB_ROUNDS (default 6), GB_CROWD (static enemies in view for stages and variants, default 8).
const PHASES = (process.env.GB_PHASES ?? 'stages,passes,variants').split(',');
const TAG = process.env.GB_TAG ?? 'gb';
const N = Number(process.env.GB_N ?? 6);
const ROUNDS = Number(process.env.GB_ROUNDS ?? 6);
const ENEMIES = Number(process.env.GB_ENEMIES ?? 14);
const SECONDS = Number(process.env.GB_SECONDS ?? 14);
const CROWD = Number(process.env.GB_CROWD ?? 8);

/** Runs in the page. */
function install({ n, rounds }) {
  const { ctx, game } = window.__op2;
  const r = ctx.render;
  const renderer = r.renderer;
  const gl = renderer.getContext();
  r.dynamicResolution.enabled = false;
  ctx.waves.update = () => {};
  ctx.player.modifiers.invulnerable = true;
  ctx.weapons.modifiers.bottomlessMag = true;

  // gl.finish() in Chrome is only a flush. A read from a framebuffer of its own, after a clear queued behind the
  // work, is the one thing that really waits, and it leaves three's state cache alone.
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

  const ground = (x, y, z) => {
    const hit = { point: new V(), normal: new V(), distance: 0, surface: 'concrete', collider: null };
    return ctx.physics.raycastInto(new V(x, y + 1.5, z), new V(0, -1, 0), 40, 1, hit) ? hit.point.clone() : new V(x, y, z);
  };
  const spots = {
    killhouse: {
      court: [-6.6, 0.1, 2.6, 0.9, -0.04], yard: [-20, 0.1, 31, 2.4, -0.02], deck: [14.5, 4.6, 14.5, 3.9, -0.14], room4: [19, 0.1, 8, 1.2, -0.06],
    },
    crucible: {
      spawn: [...ctx.world.playerSpawns[0].position.toArray(), 0, -0.04],
      far: [...ctx.world.playerSpawns[Math.min(1, ctx.world.playerSpawns.length - 1)].position.toArray(), 2.2, -0.05],
    },
  };
  const map = new URLSearchParams(location.search).get('map') === 'killhouse' ? 'killhouse' : 'crucible';

  /** Ahead of the camera, on the floor, in a loose group, so a crowd is on screen at the distances a fight happens. */
  const crowd = count => {
    const f = P.forward;
    for (let i = 0; i < count; i++) {
      const d = 5 + (i % 4) * 3, side = (i - count / 2) * 1.1;
      const p = ground(P.eye.x + f.x * d - f.z * side, P.eye.y, P.eye.z + f.z * d + f.x * side);
      ctx.enemies.spawn('husk', p);
    }
  };

  const goTo = async (name, count) => {
    thaw();
    ctx.enemies.killAll?.('bench');
    ctx.gore.clear();
    ctx.render.decals.clear();
    const [x, y, z, yaw, pitch] = spots[map][name];
    P.teleport(new V(x, y, z), yaw);
    P.pitch = pitch;
    await raf(8);
    if (count) crowd(count);
    await raf(50);
    freeze();
    await raf(2);
    return { spot: name, pos: [x, y, z], live: ctx.enemies.alive.length, calls: r.drawCalls(), tris: r.triangles() };
  };

  const frameCost = (frames, renders = 1) => {
    sync();
    const t0 = performance.now();
    for (let i = 0; i < frames; i++) for (let k = 0; k < renders; k++) r.render();
    sync();
    return (performance.now() - t0) / frames;
  };

  const rounded = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v * 100) / 100]));
  const median = a => [...a].sort((x, y) => x - y)[a.length >> 1];

  /** Stage cost by syncing at each boundary. */
  const stages = () => {
    const best = {};
    const all = {};
    let t = 0;
    const mark = name => {
      sync();
      const now = performance.now();
      all[name] ??= [];
      all[name].push(now - t);
      t = now;
    };
    const wraps = [];
    const after = (obj, key, name) => {
      const f = obj[key];
      wraps.push([obj, key, f, Object.hasOwn(obj, key)]);
      obj[key] = function (...a) { const v = f.apply(this, a); mark(name); return v; };
    };
    const before = (obj, key, name, nameAfter) => {
      const f = obj[key];
      wraps.push([obj, key, f, Object.hasOwn(obj, key)]);
      obj[key] = function (...a) { mark(name); const v = f.apply(this, a); if (nameAfter) mark(nameAfter); return v; };
    };
    after(r.shadows, 'update', 'shadows');
    before(renderer, 'copyTextureToTexture', 'scene+resolve', 'depthCopy');
    before(r.gtao, 'renderDepth', 'decals', 'halfDepth');
    after(r.gtao, 'renderAo', 'ao');
    after(r.fogPass, 'render', 'fog');
    after(r.ssr, 'render', 'ssr');
    after(r.combine, 'render', 'combine');
    before(r.bloom, 'render', 'transparent', 'bloom');
    after(r.composite, 'render', 'composite');
    for (let i = 0; i < n * 2; i++) {
      sync();
      t = performance.now();
      r.render();
    }
    for (const [o, k, f, own] of wraps) { if (own) o[k] = f; else delete o[k]; }
    for (const k in all) best[k] = Math.min(...all[k].slice(2));
    const med = Object.fromEntries(Object.entries(all).map(([k, v]) => [k, median(v.slice(2))]));
    return { best: rounded(best), median: rounded(med) };
  };

  const engine = r.engine;
  const realloc = change => {
    return {
      on() { this.q = r.quality; r.quality = { ...this.q, ...change }; r.allocateTargets(); },
      off() { r.quality = this.q; r.allocateTargets(); },
    };
  };
  const toggle = key => ({ on() { r.passes[key] = false; }, off() { r.passes[key] = true; } });
  const hide = group => ({ on() { group.visible = false; }, off() { group.visible = true; } });
  const render0 = renderer.render;
  const basic = r.shadows.depthMaterial.clone();
  basic.colorWrite = true;
  basic.polygonOffset = false;
  basic.side = 0;
  basic.color.set(0x444444);
  const allVariants = {
    base: { on() {}, off() {} },
    noAo: toggle('ao'),
    noFog: toggle('fog'),
    noSsr: toggle('ssr'),
    noBloom: toggle('bloom'),
    noShadows: toggle('shadows'),
    noDecals: toggle('decals'),
    noPost: {
      on() { for (const k of ['ao', 'fog', 'ssr', 'bloom']) r.passes[k] = false; },
      off() { for (const k of ['ao', 'fog', 'ssr', 'bloom']) r.passes[k] = true; },
    },
    taps1: { on() { this.t = engine.opShadowTaps.value; engine.opShadowTaps.value = 1; }, off() { engine.opShadowTaps.value = this.t; } },
    noView: hide(r.viewScene),
    // The lit shaders replaced by one colour. What remains is geometry, MSAA and the render pass itself.
    flatWorld: {
      on() {
        renderer.render = function (s, c) {
          if ((s === r.scene || s === r.viewScene) && r.listMode === 'opaque') {
            s.overrideMaterial = basic;
            render0.call(this, s, c);
            s.overrideMaterial = null;
          } else render0.call(this, s, c);
        };
      },
      off() { renderer.render = render0; },
    },
    // Hides the sample count from the world pass, which is the one that resolves. Wrong image, true cost.
    noResolve: {
      on() {
        renderer.render = function (s, c) {
          const t = r.sceneTarget;
          const n = t.samples;
          if (s === r.scene && r.listMode === 'opaque') t.samples = 0;
          render0.call(this, s, c);
          t.samples = n;
        };
      },
      off() { renderer.render = render0; },
    },
    noDepthResolve: { on() { r.sceneTarget.resolveDepthBuffer = false; }, off() { r.sceneTarget.resolveDepthBuffer = true; } },
    msaa2: realloc({ msaa: 2 }),
    msaa0: realloc({ msaa: 0 }),
    res85: realloc({ resolution: 0.85 }),
    res70: realloc({ resolution: 0.7 }),
  };

  const eachLit = fn => {
    const seen = new Set();
    for (const scene of [r.scene, r.viewScene]) {
      scene.traverse(o => {
        const m = o.material;
        if (m && !Array.isArray(m) && m.isMeshStandardMaterial && !seen.has(m)) { seen.add(m); fn(m); }
      });
    }
  };
  const define = name => ({
    on() { eachLit(m => { m.defines = { ...m.defines, [name]: 1 }; m.needsUpdate = true; }); },
    off() { eachLit(m => { delete m.defines[name]; m.needsUpdate = true; }); },
  });
  for (const x of ['X_NOWET', 'X_NOMACRO', 'X_NOSHADOW', 'X_NOSH', 'X_NODOM', 'X_NOENV', 'X_NOPOINT']) allVariants[x] = define(x);
  const anisotropy = value => {
    const ext = gl.getExtension('EXT_texture_filter_anisotropic');
    const state = renderer.state;
    const set = v => {
      for (const s of r.worldMaterials.sets.values()) {
        for (const t of [s.albedo, s.surface]) {
          state.bindTexture(gl.TEXTURE_2D, renderer.properties.get(t).__webglTexture);
          gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, v);
        }
      }
    };
    return { on() { set(value); }, off() { set(8); } };
  };
  allVariants.aniso1 = anisotropy(1);
  allVariants.aniso4 = anisotropy(4);

  /** Names join with + to stack changes, as in msaa0+res70. */
  const variants = names => {
    const samples = Object.fromEntries(names.map(v => [v, []]));
    for (let round = 0; round < rounds; round++) {
      for (const v of names) {
        const parts = v.split('+').map(p => allVariants[p]);
        for (const x of parts) x.on();
        frameCost(2);
        samples[v].push(frameCost(n));
        for (const x of parts.reverse()) x.off();
      }
    }
    const best = Object.fromEntries(names.map(v => [v, Math.min(...samples[v])]));
    const med = Object.fromEntries(names.map(v => [v, median(samples[v])]));
    const saved = Object.fromEntries(names.map(v => [v, med.base - med[v]]));
    return { best: rounded(best), median: rounded(med), savedByMedian: rounded(saved) };
  };

  /** Keeps a crowd alive around the player and fires at it through the real game loop. */
  const fight = async (enemies, seconds) => {
    thaw();
    const intervals = [];
    const renderMs = [];
    const render = r.render;
    r.render = function () {
      const t = performance.now();
      render.call(this);
      renderMs.push(performance.now() - t);
    };
    let last = performance.now();
    let live = true;
    const eye = P.eye.clone(), dir = P.eye.clone();
    const tick = now => {
      if (!live) return;
      requestAnimationFrame(tick);
      intervals.push(now - last);
      last = now;
      const alive = ctx.enemies.alive.filter(e => e.dying === 0);
      if (alive.length < enemies) crowd(Math.min(3, enemies - alive.length));
      let best = null, bestD = Infinity;
      for (const e of alive) {
        const d = e.position.distanceToSquared(P.position);
        if (d >= bestD) continue;
        eye.copy(P.eye);
        dir.subVectors(e.center, eye);
        const len = dir.length();
        dir.divideScalar(len);
        if (ctx.physics.raycast(eye, dir, len) === null) { bestD = d; best = e; }
      }
      if (best) {
        const dx = best.center.x - P.eye.x, dy = best.center.y - P.eye.y, dz = best.center.z - P.eye.z;
        P.yaw = Math.atan2(-dx, -dz);
        P.pitch = Math.atan2(dy, Math.hypot(dx, dz));
      }
      ctx.input.simulate('fire', best !== null);
    };
    requestAnimationFrame(tick);
    await new Promise(res => setTimeout(res, seconds * 1000));
    live = false;
    ctx.input.simulate('fire', false);
    delete r.render;
    const s = intervals.slice(30);
    const sorted = [...s].sort((a, b) => a - b);
    const q = p => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
    const rs = [...renderMs].sort((a, b) => a - b);
    return {
      frames: s.length, p50: q(0.5), p90: q(0.9), p99: q(0.99), worst: sorted[sorted.length - 1],
      over20: s.filter(x => x > 20).length, over34: s.filter(x => x > 34).length,
      seconds: s.reduce((a, b) => a + b, 0) / 1000, renderCpuP50: rs[rs.length >> 1],
      drs: r.dynamicResolution.scale, renderSize: r.renderSize(), stats: window.__op2.stats(),
    };
  };

  window.__gb = {
    goTo, stages, variants, fight, frameCost, sync, spotNames: Object.keys(spots[map]), freeze, thaw, raf, allVariants: Object.keys(allVariants),
    passes: () => r.measurePasses(6, 6),
    drawing: () => { const v = renderer.getDrawingBufferSize(new (r.tanHalf.constructor)()); return { canvas: [v.x, v.y], ...r.renderSize(), dpr: devicePixelRatio }; },
  };
}

export default async function bench(page, h) {
  const t0 = Date.now();
  let ready = false;
  for (let i = 0; i < 120 && !ready; i++) {
    ready = await page.evaluate(() => window.__op2?.game?.state === 'playing');
    if (!ready) await h.sleep(1000);
  }
  if (!ready) return { booted: false };
  console.error(`[gb] playing after ${Date.now() - t0} ms`);
  await page.addStyleTag({ content: 'body > *:not(canvas):not(#game) { visibility: hidden !important; }' });
  await page.evaluate(install, { n: N, rounds: ROUNDS });
  const out = { drawing: await page.evaluate(() => window.__gb.drawing()), spots: {} };
  const names = (process.env.GB_SPOTS ?? (await page.evaluate(() => window.__gb.spotNames.join(',')))).split(',');
  for (const spot of names) {
    const crowded = PHASES.some(p => p === 'stages' || p === 'variants' || p === 'passes') ? CROWD : 0;
    const row = out.spots[spot] = await page.evaluate(([s, c]) => window.__gb.goTo(s, c), [spot, crowded]);
    console.error(`[gb] at ${spot} after ${Date.now()}`);
    if (PHASES.includes('stages')) row.stages = await page.evaluate(() => window.__gb.stages());
    if (PHASES.includes('passes')) row.passes = await page.evaluate(() => window.__gb.passes());
    if (PHASES.includes('variants')) {
      const list = process.env.GB_VARIANTS?.split(',') ?? await page.evaluate(() => window.__gb.allVariants);
      row.variants = await page.evaluate(v => window.__gb.variants(v), list);
    }
    if (PHASES.includes('shots')) {
      await page.evaluate(() => window.__gb.raf(2));
      await h.shot(`${TAG}-${spot}`).catch(e => console.error(`shot failed: ${e.message.split('\n')[0]}`));
    }
  }
  if (PHASES.includes('fight')) out.fight = await page.evaluate(([e, s]) => window.__gb.fight(e, s), [ENEMIES, SECONDS]);
  return out;
}
