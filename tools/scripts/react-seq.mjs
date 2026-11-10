// Hit reactions on the Test Range, frame by frame, one contact sheet per reaction.
//   REACT=stagger,fall node tools/shot.mjs --url "/?map=range" --script tools/scripts/react-seq.mjs --wait 500 --timeout 150 --out tools/out/react.png
// Every case runs on world frames through the lab's own step, so a sheet shows the same moments however slow the machine is.
// Sheets land next to --out as react-<case>.png. REACT_DPR=2 is set with --dpr 2 --w 1440 --h 900.
const only = (process.env.REACT ?? '').split(',').filter(Boolean);
const TILE_W = 480;
const TILE_H = 300;
const COLUMNS = 4;

const CASES = {
  // A hard shot in the chest that does not kill.
  stagger: { id: 'trooper', steps: [0, 4, 8, 12, 18, 24, 30, 38, 46, 56, 70, 90], act: r => r.hit('chest', 18, 34, r.shock(0.85)) },
  // The same, on a shot leg.
  stagleg: { id: 'trooper', steps: [0, 4, 8, 12, 18, 24, 30, 38, 46, 56, 70, 90], act: r => r.hit('legL', 18, 34, r.shock(0.85)) },
  // Shot in the leg at a run.
  trip: { id: 'trooper', ai: 'patrol', pace: 1.35, settle: 40, steps: [0, 6, 12, 18, 24, 30, 36, 44, 52, 60, 76, 96], act: r => r.tripLeg() },
  // Staggered past saving: steps, then a fall, face down or face up by which way the shot goes.
  fall: { id: 'trooper', steps: [0, 8, 16, 24, 32, 40, 50, 60, 75, 90, 110, 130], act: r => r.hit('chest', 18, 60, r.shock(9)) },
  fallback: { id: 'trooper', flip: true, steps: [0, 8, 16, 24, 32, 40, 50, 60, 75, 90, 110, 130], act: r => r.hit('chest', 18, 60, r.shock(9)) },
  // Lying, and getting up. Starts from the end of `fall`.
  rise: { id: 'trooper', lead: 110, steps: [0, 16, 32, 48, 64, 80, 96, 112, 128, 144, 160, 190], act: r => r.hit('chest', 18, 60, r.shock(9)) },
  riseback: { id: 'trooper', flip: true, lead: 110, steps: [0, 16, 32, 48, 64, 80, 96, 112, 128, 144, 160, 190], act: r => r.hit('chest', 18, 60, r.shock(9)) },
  // The same from the moment it starts to get up: the push up on its arms, or to sitting up, and the clip after it. With
  // `?struggle=0` from the moment it gathers for the clip.
  struggle: { id: 'trooper', steps: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 100, 130], act: async r => { r.hit('chest', 18, 60, r.shock(9)); await r.until(() => r.rising(), 600); } },
  struggleback: { id: 'trooper', flip: true, steps: [0, 10, 20, 30, 40, 50, 60, 80, 100, 120, 150, 190], act: async r => { r.hit('chest', 18, 60, r.shock(9)); await r.until(() => r.rising(), 600); } },
  huskup: { id: 'husk', steps: [0, 6, 12, 18, 24, 30, 36, 42, 50, 60, 75, 90], act: async r => { r.hit('chest', 12, 60, r.shock(9)); await r.until(() => r.rising(), 600); } },
  // A shotgun shell in the chest half way through the face-down clip, kneeling, four pellets on one frame that do not kill it:
  // it goes back down from the clip's pose.
  riseshot: { id: 'trooper', flip: true, steps: [0, 2, 4, 6, 8, 10, 12, 15, 20, 26, 34, 50], act: async r => { r.hit('chest', 18, 60, r.shock(9)); await r.until(e => e.rising > 0 && e.char.anim.clipU >= 0.5, 900); r.target.health = r.target.maxHealth; r.shell('chest', 4, 15, 18); } },
  // A rocket that does not kill.
  thrown: { id: 'trooper', steps: [0, 3, 6, 10, 15, 20, 26, 34, 44, 56, 72, 90], act: r => r.blast(3.2) },
  thrownup: { id: 'gunner', lead: 60, steps: [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330], act: r => r.blast(3.2) },
  // Twenty rounds a second into a body that dies on the third.
  dance: { id: 'trooper', steps: [0, 6, 12, 18, 24, 30, 36, 42, 50, 58, 66, 78], act: r => r.stream(3, 72) },
  husk: { id: 'husk', steps: [0, 8, 16, 24, 32, 40, 50, 60, 75, 90, 110, 130], act: r => r.hit('chest', 12, 60, r.shock(9)) },
  maimed: { id: 'trooper', maim: ['armL'], steps: [0, 12, 24, 36, 48, 60, 80, 100, 120, 140, 170, 200], act: r => r.hit('chest', 10, 60, r.shock(9)) },
  oneleg: { id: 'trooper', maim: ['shinR'], steps: [0, 12, 24, 36, 48, 60, 80, 100, 120, 140, 170, 200], act: r => r.hit('chest', 10, 60, r.shock(9)) },
  noleg: { id: 'trooper', maim: ['legR', 'legL'], steps: [0, 12, 24, 36, 48, 60, 80, 100, 120, 140, 170, 200], act: r => r.hit('chest', 10, 60, r.shock(9)) },
};

export default async function reactSeq(page, h) {
  for (let i = 0; i < 180; i++) {
    if (await page.evaluate(() => !!window.__lab && window.__op2?.game?.state === 'playing')) break;
    await h.sleep(500);
  }
  await page.evaluate(() => {
    const lab = window.__lab;
    const { ctx } = window.__op2;
    const V = ctx.player.position.constructor;
    lab.settings.progression = false;
    lab.flags.progression = false;
    lab.flags.gibbing = false;
    lab.settings.overlay = false;
    ctx.player.modifiers.invulnerable = true;
    ctx.render.viewScene.visible = false;
    const canvas = document.querySelector('canvas');
    for (const el of document.body.children) if (!el.contains(canvas)) el.style.visibility = 'hidden';
    for (const el of canvas.parentElement.children) if (el !== canvas) el.style.visibility = 'hidden';
    const frame = () => new Promise(r => requestAnimationFrame(r));
    const look = t => {
      const d = new V().subVectors(t, ctx.player.eye);
      ctx.player.yaw = Math.atan2(-d.x, -d.z);
      ctx.player.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
    };
    const r = {
      V, target: null, dir: new V(1, 0, 0), log: [],
      async walk(frames) {
        lab.step(frames);
        while (lab.steps > 0) await frame();
        await frame();
      },
      async start(c) {
        ctx.enemies.killAll('lab');
        ctx.enemies.reset();
        lab.spawner.clearBodies();
        if (lab.paused) lab.togglePause();
        ctx.player.teleport(new V(0, 0.1, 6.4), 0);
        await frame();
        const e = lab.spawner.place(c.id, new V(0, 0, 3), c.ai ?? 'off');
        e.yaw = c.flip ? Math.PI / 2 : -Math.PI / 2;
        r.target = e;
        r.dir.set(1, 0, 0);
        if (c.pace) e.pace = c.pace;
        for (const region of c.maim ?? []) {
          e.limbHp.set(region, 0.1);
          r.hit(region, 1, 0.1);
        }
        e.stagger = 0;
        look(new V(0, 1, 3));
        lab.togglePause();
        await r.walk(c.settle ?? 20);
      },
      shock(v) {
        r.target.shock = v;
        r.target.reactAt = 0;
        return v;
      },
      hit(region, amount, force) {
        const e = r.target;
        const bone = e.char.rig.bones.findIndex(b => b.region === region);
        const point = new V().setFromMatrixPosition(e.char.bones[Math.max(bone, 0)].matrixWorld);
        return ctx.enemies.applyDamage(e, { amount, type: 'bullet', point, dir: r.dir.clone(), force, source: 'test', region, bone: bone >= 0 ? bone : undefined });
      },
      /** Steps a frame at a time until `test(target)` holds, `frames` at most. */
      async until(test, frames) {
        for (let i = 0; i < frames && !test(r.target); i++) await r.walk(1);
      },
      /** Gore has started it getting up: fighting up, or gathering for the clip. */
      rising() {
        const reflex = r.reflex();
        return reflex !== null && (reflex.phase === 'struggle' || reflex.phase === 'gather');
      },
      reflex() {
        return ctx.gore.owned.get(r.target.char)?.rag?.muscle?.reflex ?? null;
      },
      /** A shell: `pellets` pellets on one frame, as Combat lands them. */
      shell(region, pellets, amount, force) {
        const e = r.target;
        const bone = e.char.rig.bones.findIndex(b => b.region === region);
        const point = new V().setFromMatrixPosition(e.char.bones[Math.max(bone, 0)].matrixWorld);
        r.log.push({ shell: { u: +(e.char.anim.clipU ?? 0).toFixed(2), rising: +e.rising.toFixed(2), of: +e.riseSeconds.toFixed(2) } });
        for (let i = 0; i < pellets; i++) {
          ctx.enemies.applyDamage(e, { amount, type: 'pellet', point, dir: r.dir.clone(), force, source: 'test', region, bone: bone >= 0 ? bone : undefined });
        }
      },
      tripLeg() {
        const e = r.target;
        const v = e.velocity.clone().setY(0);
        r.log.push({ speed: +v.length().toFixed(2) });
        r.dir.copy(v).normalize().negate();
        r.shock(0);
        const before = Math.random;
        Math.random = () => 0;
        r.hit('legL', 16, 20);
        Math.random = before;
      },
      blast(distance) {
        const e = r.target;
        ctx.combat.explode(new V(e.position.x - distance, 0.3, e.position.z), { radius: 6, damage: 90, kind: 'rocket', source: 'test', team: 'player' });
      },
      /** One round now and every three frames after, at the chest, by the same two tests a real shot makes. */
      async round() {
        const e = r.target;
        const c = e.char.bones[2];
        const point = new V().setFromMatrixPosition(c.matrixWorld);
        point.y += (Math.random() - 0.5) * 0.3;
        const origin = point.clone().addScaledVector(r.dir, -6);
        if (e.alive) {
          r.hit('chest', 25, 20);
          return;
        }
        const hit = ctx.gore.raycastCorpses(origin, r.dir, 9);
        if (hit) ctx.gore.damageCorpse(hit, { amount: 25, type: 'bullet', point: hit.point.clone(), dir: r.dir.clone(), force: 0, source: 'test' });
      },
      stream(gap, frames) {
        r.streaming = { gap, left: frames, at: 0 };
      },
      async advance(n) {
        const s = r.streaming;
        for (let i = 0; i < n; i++) {
          if (s && s.left > 0 && s.at % s.gap === 0) await r.round();
          if (s) {
            s.at++;
            s.left--;
          }
          if (s) await r.walk(1);
        }
        if (!s) await r.walk(n);
      },
      /** Keeps the body in frame, about chest height at rest and lower when it is down. */
      aim() {
        const hips = new V().setFromMatrixPosition(r.target.char.bones[0].matrixWorld);
        hips.y = Math.max(0.5, hips.y * 0.9);
        look(hips);
      },
      probe() {
        const e = r.target;
        const c = e.char;
        const y = c.bones.map(b => b.matrixWorld.elements[13]);
        const seen = y.filter((_, i) => !c.isHidden(i));
        const reflex = r.reflex();
        return {
          e: { x: +e.position.x.toFixed(2), z: +e.position.z.toFixed(2), down: e.downed, rise: +e.rising.toFixed(2), stag: +e.stagger.toFixed(2), alive: e.alive },
          reflex: reflex ? { ph: reflex.phase, tries: reflex.tries, fails: reflex.fails, knocks: reflex.knocks, up: +(reflex.progress ?? 0).toFixed(2) } : null,
          hips: +y[0].toFixed(2), head: +y[4].toFixed(2), low: +Math.min(...seen).toFixed(3),
        };
      },
    };
    window.__r = r;
  });

  const clip = { x: 0, y: 0, width: 0, height: 0 };
  const size = page.viewportSize();
  clip.x = size.width * 0.28;
  clip.y = size.height * 0.26;
  clip.width = size.width * 0.44;
  clip.height = size.height * 0.48;
  const results = {};
  for (const [name, c] of Object.entries(CASES)) {
    if (only.length > 0 && !only.includes(name)) continue;
    await page.evaluate(async ({ c }) => { await window.__r.start(c); }, { c: { id: c.id, ai: c.ai, pace: c.pace, settle: c.settle, flip: c.flip, maim: c.maim } });
    await page.evaluate(`(${c.act.toString()})(window.__r)`);
    if (c.lead) await page.evaluate(n => window.__r.advance(n), c.lead);
    const tiles = [];
    const notes = [];
    let at = 0;
    for (const f of c.steps) {
      if (f > at) await page.evaluate(n => window.__r.advance(n), f - at);
      at = f;
      await page.evaluate(() => window.__r.aim());
      await h.sleep(60);
      const buf = await page.screenshot({ type: 'jpeg', quality: 72, clip });
      tiles.push(buf.toString('base64'));
      notes.push(await page.evaluate(() => window.__r.probe()));
    }
    results[name] = { log: await page.evaluate(() => window.__r.log.splice(0)), notes: notes.map((n, i) => ({ f: c.steps[i], ...n })) };
    const context = await page.context().browser().newContext();
    const sheet = await context.newPage();
    const rows = Math.ceil(tiles.length / COLUMNS);
    await sheet.setViewportSize({ width: TILE_W * COLUMNS, height: TILE_H * rows });
    await sheet.setContent(`<body style="margin:0;background:#000;display:grid;grid-template-columns:repeat(${COLUMNS},${TILE_W}px);font:bold 18px sans-serif;color:#ff0">${tiles.map((t, i) =>
      `<div style="position:relative;width:${TILE_W}px;height:${TILE_H}px;overflow:hidden"><img src="data:image/jpeg;base64,${t}" style="width:100%;height:100%;object-fit:cover"><span style="position:absolute;left:6px;top:4px">${c.steps[i]}</span></div>`).join('')}</body>`);
    await sheet.waitForTimeout(150);
    await sheet.screenshot({ path: `${h.outDir}/react-${name}.png` });
    await context.close();
  }
  return results;
}
