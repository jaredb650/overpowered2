// First-use stalls: what the first of each thing costs against the ones after it, in real time with every frame drawn.
//
//   node tools/shot.mjs --port <yours> --url "/?contract=crucible&autostart=1" --wait 0 --timeout 300 --dpr 2 --w 1440 --h 900 \
//     --script tools/scripts/first-use.mjs --out tools/out/<you>/first-use.png
//
// In a Crucible break that never ends, on men who do not fight, five times each, a second apart: a gib (a rocket's blast on one
// body), a head shot kill, a sword cut that takes a limb, a shotgun body kill. For each event: the game's own work on that
// frame and the worst frame interval in the 6 frames from it, the shader programs linked in those frames, and the gore
// system's own timers where it has them. "first" against "later" (the median of the other four) is the stall.
// The page is a returning player's with default settings. Timings on a busy machine prove nothing: check `uptime`.
export const before = async page => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('first.set')) return;
    sessionStorage.setItem('first.set', '1');
    localStorage.clear();
    localStorage.setItem('op2.settings.v1', JSON.stringify({ music: 0 }));
    localStorage.setItem('op2.played.v1', '1');
  });
};

export default async function (page, { sleep }) {
  await page.waitForFunction(() => window.__op2?.game?.state === 'playing', null, { timeout: 150000 });
  await sleep(3000);
  const result = await page.evaluate(() => new Promise(done => {
    const { ctx, game } = window.__op2;
    const p = ctx.player, V = p.position.constructor, renderer = ctx.render.renderer;
    p.modifiers.invulnerable = true;
    const KINDS = {
      gib: { amount: 9999, type: 'explosive', source: 'rocket', force: 900, gib: true },
      headshot: { amount: 9999, type: 'bullet', source: 'smg', region: 'head', force: 10 },
      sever: { amount: 9999, type: 'slash', source: 'sword', region: 'armL', force: 60, severMult: 4 },
      body: { amount: 9999, type: 'pellet', source: 'shotgun', region: 'chest', force: 40 },
    };
    const plan = [];
    for (const kind of Object.keys(KINDS)) for (let i = 0; i < 5; i++) plan.push(kind);
    const out = [];
    let frame = 0, last = performance.now(), next = 60, live = null, known = new Set((renderer.info.programs ?? []).map(q => q.id));
    const tick = now => {
      const interval = now - last;
      last = now;
      ctx.waves.nextWaveIn = 1e9;
      if (game.state !== 'playing') game.setState('playing');
      const fresh = [];
      for (const q of renderer.info.programs ?? []) if (!known.has(q.id)) { known.add(q.id); fresh.push(q.name || q.type || `#${q.id}`); }
      if (live) {
        live.frames.push([Math.round(interval * 10) / 10, Math.round((game.cpuMs ?? 0) * 10) / 10]);
        live.linked.push(...fresh);
        if (live.frames.length >= 7) { out.push(live); live = null; }
      }
      if (!live && frame === next - 30 && plan.length) {
        // The man it will happen to, 8 m ahead, standing still.
        const fwd = new V(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
        const e = ctx.enemies.spawn('husk', p.position.clone().addScaledVector(fwd, 8));
        if (e) { e.behaviours = []; e.attacks = []; e.mode = 'hold'; e.dummy = true; }
        window.__first = e;
      }
      if (!live && frame === next && plan.length) {
        const kind = plan.shift(), e = window.__first;
        if (e && e.alive) {
          const t0 = performance.now();
          ctx.enemies.applyDamage(e, { ...KINDS[kind], point: e.center.clone(), dir: e.center.clone().sub(p.eye).normalize() });
          live = { kind, applyMs: Math.round((performance.now() - t0) * 10) / 10, frames: [], linked: [] };
        }
        next = frame + 75;
      }
      frame++;
      if (!plan.length && !live) return done(out);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }));
  const median = list => { const s = [...list].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
  const table = {};
  for (const kind of [...new Set(result.map(r => r.kind))]) {
    const rows = result.filter(r => r.kind === kind).map(r => ({ applyMs: r.applyMs, workMs: Math.max(...r.frames.map(f => f[1])), intervalMs: Math.max(...r.frames.slice(1).map(f => f[0])), linked: r.linked }));
    const later = rows.slice(1);
    table[kind] = {
      first: rows[0], later: { applyMs: median(later.map(r => r.applyMs)), workMs: median(later.map(r => r.workMs)), intervalMs: median(later.map(r => r.intervalMs)) },
      stallMs: Math.round((rows[0].workMs - median(later.map(r => r.workMs))) * 10) / 10, all: rows.map(r => `${r.applyMs}/${r.workMs}/${r.intervalMs}`).join('  '),
    };
  }
  return { note: 'each: applyDamage ms / worst game work ms in the 7 frames from it / worst frame interval ms', table };
}
