// Per-frame timeline around blood events in the real game, on the real map:
//
//   BB_DUMP=tools/out/bb.json node tools/shot.mjs --url "/?autostart=1" --dpr 2 --w 1440 --h 900 --wait 500 \
//     --timeout 240 --quiet --script tools/scripts/blood-bench.mjs
//
// Leave out --out: a final screenshot of a page this busy can time out and lose the report.
//
// Env:
//   BB_REPS=3         Repeats per event type. The first shows first-use cost, the rest the steady cost.
//   BB_SYNC=1         Blocks on the GPU after each render: frame cost includes GPU work, but the frame
//                     interval no longer means anything. Without it, interval is real and GPU is hidden.
//   BB_ROTATE=a,b,c   One round of events per entry, with that thing hidden: none, smoke, chips, flashes,
//                     decals, lens, draws (all of them). Emission still runs, so a difference is pure GPU cost.
//   BB_GLSLOW=1       Lists every GL call over 2 ms, by name. Wraps all of GL, so frame times suffer.
//   BB_EVENTS=a,b     Subset of hit,jet,sever,head,gib,stump.
//   BB_DIST=3         Meters from the eye to the event. Husks and the sword fight at 1 to 2.
//   BB_DR=1           Turns dynamic resolution on. It is off under automation, on for the owner.
//   BB_TRACE=1        Chrome trace of GC around the events.
//   BB_PROFILE=1      CPU profile of everything after the first round, so first-use cost stays out of it.
//   BB_DUMP=file      Writes the raw frames as JSON.
//   BB_LIMIT=120      Seconds the scenario may run before it reports what it has.
import { writeFileSync } from 'node:fs';

const REPS = Number(process.env.BB_REPS ?? 3);
const SYNC = process.env.BB_SYNC === '1';
const ROTATE = (process.env.BB_ROTATE ?? '').split(',').filter(Boolean);
const GLSLOW = process.env.BB_GLSLOW === '1';
const EVENTS = (process.env.BB_EVENTS ?? 'hit,jet,sever,head,gib,stump').split(',');
const TRACE = process.env.BB_TRACE === '1';
const DIST = Number(process.env.BB_DIST ?? 3);
const PROFILE = process.env.BB_PROFILE === '1';
const DR = process.env.BB_DR === '1';
const DUMP = process.env.BB_DUMP;
const LIMIT = Number(process.env.BB_LIMIT ?? 120);

/** Frames kept either side of an event. */
const PRE = 18;
const POST = 42;

/** Runs in the page. Columns are preallocated so the probe itself does not make garbage. */
function install({ sync, glslow, dr }) {
  const { ctx, game } = window.__op2;
  ctx.render.dynamicResolution.enabled = dr;
  const renderer = ctx.render.renderer;
  const gl = renderer.getContext();
  const CAP = 12000;
  const COLS = ['ts', 'js', 'emit', 'gore', 'fx', 'render', 'gpu', 'physics', 'rays', 'decals', 'link', 'bufBytes', 'bufMs', 'texCalls', 'texMs', 'calls', 'tris', 'scale', 'res'];
  const col = Object.fromEntries(COLS.map(c => [c, new Float64Array(CAP)]));
  let n = 0;
  const cur = Object.fromEntries(COLS.map(c => [c, 0]));
  const marks = [];
  const queue = [];
  const px = new Uint8Array(4);

  const timed = (obj, name, key) => {
    const f = obj[name];
    obj[name] = function (...a) {
      const t = performance.now();
      const r = f.apply(this, a);
      cur[key] += performance.now() - t;
      return r;
    };
  };
  for (const m of ['bloodHit', 'bloodJet', 'bloodMist', 'headBurst', 'gibBurst', 'lensBlood', 'attachEmitter']) timed(ctx.fx, m, 'emit');
  for (const m of ['sever', 'ragdoll', 'headshot', 'gib', 'slice']) timed(ctx.gore, m, 'gore');
  timed(ctx.fx, 'update', 'fx');
  timed(ctx.physics, 'step', 'physics');

  const render = ctx.render.render;
  ctx.render.render = function () {
    const t = performance.now();
    render.call(this);
    const t1 = performance.now();
    cur.render += t1 - t;
    if (sync) {
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      cur.gpu += performance.now() - t1;
    }
  };

  const raycastInto = ctx.physics.raycastInto;
  ctx.physics.raycastInto = function (...a) {
    cur.rays++;
    return raycastInto.apply(this, a);
  };
  const decalAdd = ctx.render.decals.add;
  ctx.render.decals.add = function (...a) {
    cur.decals++;
    return decalAdd.apply(this, a);
  };

  const slow = [];
  if (glslow) {
    for (const k in gl) {
      if (typeof gl[k] !== 'function') continue;
      const f = gl[k].bind(gl);
      gl[k] = (...a) => {
        const t = performance.now();
        const r = f(...a);
        const ms = performance.now() - t;
        if (ms > 2) slow.push({ frame: n, name: k, ms: Math.round(ms * 10) / 10 });
        return r;
      };
    }
  }

  const hookGl = (name, fn) => {
    const f = gl[name].bind(gl);
    gl[name] = (...a) => {
      const t = performance.now();
      const r = f(...a);
      fn(performance.now() - t, a);
      return r;
    };
  };
  hookGl('linkProgram', () => { cur.link++; });
  // three calls this on a program's first draw, and it blocks. Naming the program says who to talk to.
  const firstUse = [];
  hookGl('getProgramInfoLog', (ms, a) => {
    const p = renderer.info.programs.find(q => q.program === a[0]);
    firstUse.push({ frame: n, name: p?.name ?? '?', type: p?.type ?? '?', ms: Math.round(ms * 10) / 10 });
  });
  hookGl('bufferSubData', (ms, a) => {
    cur.bufMs += ms;
    cur.bufBytes += a.length >= 5 ? a[4] * (a[2].BYTES_PER_ELEMENT ?? 1) : a[2].byteLength;
  });
  for (const k of ['texImage2D', 'texSubImage2D', 'texImage3D', 'texSubImage3D', 'generateMipmap']) {
    hookGl(k, ms => { cur.texCalls++; cur.texMs += ms; });
  }

  const frame = game.frame;
  game.frame = function () {
    for (const k of COLS) cur[k] = 0;
    while (queue.length) {
      const fn = queue.shift();
      const t = performance.now();
      fn();
      // The game fires these from inside combat, so they belong to this frame's JS.
      marks[marks.length - 1].ms = performance.now() - t;
    }
    const t = performance.now();
    frame.call(this);
    cur.js = performance.now() - t;
    if (n < CAP) {
      cur.ts = clock;
      cur.calls = renderer.info.render.calls;
      cur.tris = renderer.info.render.triangles;
      cur.scale = ctx.time.realDt > 0 ? ctx.time.dt / ctx.time.realDt : 1;
      cur.res = ctx.render.dynamicResolution.scale;
      for (const k of COLS) col[k][n] = cur[k];
      n++;
    }
  };
  // The clock gets the raw rAF delta before any clamping, so the frame interval comes from here.
  let clock = 0;
  const tick = ctx.time.tick;
  ctx.time.tick = function (seconds) {
    clock += seconds * 1000;
    tick.call(this, seconds);
  };

  // Hides by layer, so emission, uploads and everything else in the frame still run.
  const core = ctx.fx.core;
  const hide = (mesh, hidden) => { mesh.layers.mask = hidden ? 0 : 1; };
  const chips = Object.values(core.chips.rings).map(r => r.object);
  const groups = {
    smoke: [core.smoke.ring.object], chips, flashes: [core.flashes.ring.object], lens: [core.lens.mesh],
  };
  const setOff = name => {
    for (const k in groups) for (const m of groups[k]) hide(m, name === k || name === 'draws');
    ctx.render.passes.decals = !(name === 'decals' || name === 'draws');
  };

  // The waves stay out of it, so what spikes is the event and nothing else.
  ctx.waves.update = () => {};
  ctx.player.modifiers.invulnerable = true;

  window.__bb = {
    col, COLS, marks, slow, firstUse, setOff, frames: () => n,
    fire(name, fn) {
      performance.mark(`bb:${name}:${marks.length}`);
      queue.push(fn);
      marks.push({ name, frame: n, ms: 0, off: window.__bb.off ?? 'none' });
    },
  };
}

/** Runs in the page, one event at a time. */
function scenario({ events, reps, rotate, dist }) {
  const { ctx } = window.__op2;
  const bb = window.__bb;
  const P = ctx.player;
  const V = P.eye.constructor;
  const raf = k => new Promise(r => {
    const step = () => (--k <= 0 ? r() : requestAnimationFrame(step));
    requestAnimationFrame(step);
  });
  const ahead = (d, side = 0) => {
    const f = P.forward;
    return new V(P.eye.x + f.x * d - f.z * side, P.eye.y, P.eye.z + f.z * d + f.x * side);
  };
  const ground = at => {
    const hit = { point: new V(), normal: new V(), distance: 0, surface: 'concrete', collider: null };
    return ctx.physics.raycastInto(new V(at.x, at.y + 1, at.z), new V(0, -1, 0), 30, 1, hit) ? hit.point.clone() : at.clone().setY(P.position.y);
  };
  const enemyAt = d => ctx.enemies.spawn('husk', ground(ahead(d)));
  const damage = (e, extra) => ({
    amount: 1, type: 'bullet', point: e.center.clone(), dir: e.center.clone().sub(P.eye).normalize(), force: 0, source: 'smg', ...extra,
  });

  const run = {
    async hit() {
      const e = enemyAt(dist);
      await raf(20);
      bb.fire('hit', () => {
        const dir = e.center.clone().sub(P.eye).normalize();
        ctx.combat.fireRay(P.eye, dir, { damage: 1, source: 'smg', team: 'player', maxDistance: 80, tracer: 'bullet' });
      });
    },
    async jet() {
      await raf(20);
      bb.fire('jet', () => {
        const at = ahead(dist, 0.4);
        at.y -= 0.2;
        ctx.fx.bloodJet(at, P.forward.clone().multiplyScalar(-0.6).add(new V(0.7, 0.3, 0)).normalize(), 1);
      });
    },
    async sever() {
      const e = enemyAt(dist);
      await raf(20);
      bb.fire('sever', () => ctx.enemies.applyDamage(e, damage(e, { region: 'armL', severMult: 1000 })));
    },
    async head() {
      const e = enemyAt(dist);
      await raf(20);
      bb.fire('head', () => ctx.enemies.applyDamage(e, damage(e, { amount: 500, region: 'head' })));
    },
    async gib() {
      const e = enemyAt(dist);
      await raf(20);
      bb.fire('gib', () => ctx.enemies.applyDamage(e, damage(e, { amount: 5000, gib: true, region: 'chest' })));
    },
    async stump() {
      await raf(20);
      const Object3D = Object.getPrototypeOf(ctx.render.scene.constructor);
      const o = new Object3D();
      o.position.copy(ahead(dist));
      ctx.render.scene.add(o);
      bb.fire('stump', () => ctx.fx.attachEmitter(o, 'stumpSpray', undefined, 2.5));
    },
  };

  const round = async label => {
    for (const name of events) {
      console.log(`[bb] ${label} ${name} frame ${bb.frames()}`);
      await run[name]();
      await raf(46);
      ctx.enemies.killAll?.('bench');
      await raf(14);
    }
    // Bodies and stains pile up and move the baseline, which is a separate question from one event's cost.
    ctx.gore.clear();
    ctx.render.decals.clear();
    await raf(6);
  };
  return (async () => {
    for (let r = 0; r < reps; r++) {
      await round(`rep ${r}`);
      if (r === 0) await window.__bbRoundDone?.();
    }
    for (const off of rotate) {
      bb.off = off;
      bb.setOff(off);
      await round(off);
    }
    bb.off = 'none';
    bb.setOff('none');
  })();
}

const median = a => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[s.length >> 1] : 0;
};
const r2 = x => Math.round(x * 100) / 100;

/** Self time by function and by source file, idle and GC split out. */
function summarise(p) {
  const byId = new Map(p.nodes.map(n => [n.id, n]));
  const self = new Map();
  for (let i = 0; i < p.samples.length; i++) {
    const dt = (p.timeDeltas[i] ?? 0) / 1000;
    self.set(p.samples[i], (self.get(p.samples[i]) ?? 0) + dt);
  }
  const fns = {};
  const files = {};
  let total = 0;
  for (const [id, ms] of self) {
    const f = byId.get(id).callFrame;
    if (f.functionName === '(idle)' || f.functionName === '(program)') continue;
    total += ms;
    const file = f.url.split('?')[0].split('/').slice(-2).join('/') || f.functionName;
    const key = `${f.functionName || '(anon)'} ${file}:${f.lineNumber}`;
    fns[key] = (fns[key] ?? 0) + ms;
    files[file] = (files[file] ?? 0) + ms;
  }
  const top = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => [k, r2(v)]);
  return { totalMs: r2(total), files: top(files, 24), functions: top(fns, 40) };
}

export default async function bench(page, h) {
  const t0 = Date.now();
  for (let i = 0; i < 120; i++) {
    if (await page.evaluate(() => window.__op2?.game?.state === 'playing')) break;
    await h.sleep(1000);
  }
  console.error(`[bb] playing after ${Date.now() - t0} ms`);
  page.on('console', m => { if (m.text().startsWith('[bb]')) console.error(m.text(), `t=${Date.now() - t0}`); });
  await page.evaluate(install, { sync: SYNC, glslow: GLSLOW, dr: DR });
  await page.evaluate(() => {
    const { ctx } = window.__op2;
    ctx.enemies.killAll?.('bench');
    ctx.player.pitch = -0.04;
  });
  await h.sleep(1500);

  let cdp = null;
  const trace = [];
  if (TRACE) {
    cdp = await page.context().newCDPSession(page);
    cdp.on('Tracing.dataCollected', e => {
      for (const t of e.value) {
        if (/GC|Scavenge|MarkCompact/.test(t.name) || (t.cat?.includes('user_timing') && t.name?.startsWith('bb:'))) trace.push(t);
        else if (t.ph === 'X' && t.dur >= 8000) trace.push(t);
      }
    });
    await cdp.send('Tracing.start', {
      transferMode: 'ReportEvents',
      traceConfig: { includedCategories: ['toplevel', 'v8', 'disabled-by-default-v8.gc', 'blink.user_timing', 'devtools.timeline', 'gpu'] },
    });
  }

  const profiler = PROFILE ? await page.context().newCDPSession(page) : null;
  if (profiler) {
    await profiler.send('Profiler.enable');
    await profiler.send('Profiler.setSamplingInterval', { interval: 500 });
    await page.exposeFunction('__bbRoundDone', () => profiler.send('Profiler.start'));
  }

  // A starved machine can stretch this far past the harness timeout, so stop and report what there is.
  await Promise.race([page.evaluate(scenario, { events: EVENTS, reps: REPS, rotate: ROTATE, dist: DIST }), h.sleep(LIMIT * 1000)]);
  const profile = profiler ? summarise((await profiler.send('Profiler.stop')).profile) : null;

  let gc = null;
  if (cdp) {
    const done = new Promise(r => cdp.once('Tracing.tracingComplete', r));
    await cdp.send('Tracing.end');
    await done;
    const marks = trace.filter(t => t.name.startsWith('bb:') && t.ph !== 'e').sort((a, b) => a.ts - b.ts);
    const gcs = trace.filter(t => t.ph === 'X' && /^(MinorGC|MajorGC|V8\.GCScavenger|V8\.GCFinalizeMC)$/.test(t.name));
    const near = marks.map(m => ({
      event: m.name,
      gcMs: r2(gcs.filter(g => g.ts >= m.ts - 50e3 && g.ts < m.ts + 500e3).reduce((s, g) => s + g.dur / 1000, 0)),
      longest: r2(Math.max(0, ...gcs.filter(g => g.ts >= m.ts - 50e3 && g.ts < m.ts + 500e3).map(g => g.dur / 1000))),
    }));
    gc = { total: gcs.length, totalMs: r2(gcs.reduce((s, g) => s + g.dur / 1000, 0)), longest: r2(Math.max(0, ...gcs.map(g => g.dur / 1000))), near };
    // What held any thread for 8 ms or more in the half second after each event, by thread and name.
    const tasks = trace.filter(t => t.ph === 'X' && t.dur >= 8000 && !gcs.includes(t));
    gc.tasks = marks.map(m => ({
      event: m.name,
      list: tasks.filter(t => t.ts >= m.ts && t.ts < m.ts + 700e3)
        .map(t => `${Math.round((t.ts - m.ts) / 1000)}ms ${t.name} ${r2(t.dur / 1000)} tid${t.tid % 1000}`),
    }));
  }

  const data = await page.evaluate(() => {
    const bb = window.__bb;
    const n = bb.frames();
    const out = {};
    for (const k of bb.COLS) out[k] = Array.from(bb.col[k].subarray(0, n));
    return { cols: out, marks: bb.marks, n, slow: bb.slow, firstUse: bb.firstUse };
  });
  if (DUMP) writeFileSync(DUMP, JSON.stringify({ ...data, profile, gc }));

  const { cols, marks } = data;
  const interval = i => cols.ts[i] - cols.ts[i - 1];
  const rows = marks.map(m => {
    const a = m.frame;
    const pre = [];
    const preCost = [];
    for (let i = Math.max(1, a - PRE); i < a; i++) {
      pre.push(interval(i));
      preCost.push(cols.js[i] + cols.gpu[i]);
    }
    const base = median(pre);
    const baseCost = median(preCost);
    const row = {
      event: m.name, off: m.off, baseMs: r2(base), baseCost: r2(baseCost), callMs: r2(m.ms),
      dropped: 0, worstMs: 0, excessMs: 0, worstAt: 0, peakJs: 0, peakFx: 0, peakRender: 0, peakGpu: 0, peakCost: 0, costExcess: 0,
      links: 0, bufKB: 0, bufMs: 0, tex: 0, texMs: 0, rays: 0, decals: 0, calls: 0,
    };
    for (let i = a; i < Math.min(a + POST, cols.ts.length); i++) {
      const d = interval(i);
      if (d > base * 1.5) row.dropped += Math.round(d / base) - 1;
      if (d > row.worstMs) { row.worstMs = d; row.worstAt = i - a; }
      row.excessMs += Math.max(0, d - base * 1.5);
      row.peakJs = Math.max(row.peakJs, cols.js[i]);
      row.peakFx = Math.max(row.peakFx, cols.fx[i]);
      row.peakRender = Math.max(row.peakRender, cols.render[i]);
      row.peakGpu = Math.max(row.peakGpu, cols.gpu[i]);
      const cost = cols.js[i] + cols.gpu[i];
      row.peakCost = Math.max(row.peakCost, cost);
      row.costExcess += Math.max(0, cost - baseCost);
      row.links += cols.link[i];
      row.bufKB += cols.bufBytes[i] / 1024;
      row.bufMs += cols.bufMs[i];
      row.tex += cols.texCalls[i];
      row.texMs += cols.texMs[i];
      row.rays += cols.rays[i];
      row.decals += cols.decals[i];
      row.calls = Math.max(row.calls, cols.calls[i]);
    }
    for (const k in row) if (typeof row[k] === 'number') row[k] = r2(row[k]);
    return row;
  });

  const all = [];
  for (let i = 1; i < cols.ts.length; i++) all.push(interval(i));
  return { frames: data.n, medianInterval: r2(median(all)), sync: SYNC, rows, gc, slow: data.slow, profile };
}
