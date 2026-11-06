// A grenade into a crowd on the Test Range, several tries on one sheet: a row per try, a column per moment. AI off, real rings, real gore.
//   BLAST_TRIES=4 node tools/shot.mjs --url "/?map=range" --script tools/scripts/blast-seq.mjs --dpr 2 --w 1440 --h 900 --wait 500 --timeout 170 --out tools/out/blast.png
// BLAST_ID picks the body, BLAST_KIND the blast, BLAST_NAME the sheet, which lands at <name>-sheet.png next to --out. On the Outpost add &contract=outpost.
const tries = Number(process.env.BLAST_TRIES ?? 4);
const id = process.env.BLAST_ID ?? 'trooper';
const kind = process.env.BLAST_KIND ?? 'grenade';
const SPREAD = Number(process.env.BLAST_SPREAD ?? 5);
const STEPS = [0, 6, 16, 34, 80, 200, 420];
const TILE_W = 320;
const TILE_H = 200;
const SPEC = { grenade: { radius: 7, damage: 190 }, rocket: { radius: 8, damage: 100 } }[kind];

export default async function blastSeq(page, h) {
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
    lab.settings.overlay = false;
    ctx.player.modifiers.invulnerable = true;
    ctx.render.viewScene.visible = false;
    const canvas = document.querySelector('canvas');
    for (const el of document.body.children) if (!el.contains(canvas)) el.style.visibility = 'hidden';
    for (const el of canvas.parentElement.children) if (el !== canvas) el.style.visibility = 'hidden';
    const frame = () => new Promise(r => requestAnimationFrame(r));
    const model = ctx.enemies.model;
    const rolled = model.rolled.bind(model);
    const r = {
      V, crowd: [], rolls: [], kills: 0, gibs: 0,
      async walk(frames) {
        lab.step(frames);
        while (lab.steps > 0) await frame();
        await frame();
      },
      async start(bodyId, spread) {
        ctx.enemies.killAll('lab');
        ctx.enemies.reset();
        lab.spawner.clearBodies();
        if (lab.paused) lab.togglePause();
        ctx.player.park(new V(0, 7.5, 14));
        await frame();
        r.crowd = [];
        r.rolls = [];
        r.kills = r.gibs = 0;
        for (let i = 0; i < 12; i++) {
          const a = i * 2.399963;
          const d = spread * Math.sqrt((i + 0.5) / 12);
          r.crowd.push(lab.spawner.place(bodyId, new V(Math.cos(a) * d, 0, Math.sin(a) * d), 'off'));
        }
        const d = new V(0, 0.8, 0).sub(ctx.player.eye);
        ctx.player.yaw = Math.atan2(-d.x, -d.z);
        ctx.player.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
        lab.togglePause();
        await r.walk(20);
      },
      go(blastKind, spec) {
        ctx.combat.explode(new V(0.4, 0.3, -0.3), { ...spec, kind: blastKind, source: 'test', team: 'player' });
      },
      state() {
        const o = ctx.enemies.outpost;
        const alive = r.crowd.filter(e => e.alive);
        return {
          alive: alive.length,
          down: alive.filter(e => e.downed).length,
          rising: alive.filter(e => e.rising > 0).length,
          up: alive.filter(e => !e.downed && e.rising <= 0 && e.maim.legs === 2 && !(o?.soldierOf(e)?.injuries.floored)).length,
          crawling: alive.filter(e => e.maim.legs === 0 || o?.soldierOf(e)?.injuries.floored).length,
          burning: alive.filter(e => e.burning > 0).length,
          stats: ctx.gore.stats(),
        };
      },
    };
    model.rolled = (e, d, amount) => {
      const roll = rolled(e, d, amount);
      if (roll) r.rolls.push(`${roll.outcome}${roll.fatal ? '+' : ''}@${d.reach.toFixed(2)}`);
      return roll;
    };
    ctx.events.on('enemy:killed', k => {
      r.kills++;
      if (k.gibbed) r.gibs++;
    });
    window.__r = r;
  });

  const size = page.viewportSize();
  const clip = { x: size.width * 0.1, y: size.height * 0.08, width: size.width * 0.8, height: size.height * 0.84 };
  const rows = [];
  const results = [];
  for (let t = 0; t < tries; t++) {
    await page.evaluate(async ({ id, spread }) => { await window.__r.start(id, spread); }, { id, spread: SPREAD });
    const worst = await page.evaluate(({ kind, spec }) => {
      const t0 = performance.now();
      window.__r.go(kind, spec);
      return +(performance.now() - t0).toFixed(1);
    }, { kind, spec: SPEC });
    const tiles = [];
    const states = [];
    let at = 0;
    for (const f of STEPS) {
      if (f > at) await page.evaluate(n => window.__r.walk(n), f - at);
      at = f;
      await h.sleep(40);
      tiles.push((await page.screenshot({ type: 'jpeg', quality: 70, clip })).toString('base64'));
      states.push(await page.evaluate(() => window.__r.state()));
    }
    rows.push(tiles);
    const last = states[states.length - 1];
    results.push({
      rolls: await page.evaluate(() => window.__r.rolls), kills: await page.evaluate(() => window.__r.kills), gibs: await page.evaluate(() => window.__r.gibs), blastMs: worst,
      first: states[1], last,
    });
  }
  const context = await page.context().browser().newContext();
  const sheet = await context.newPage();
  await sheet.setViewportSize({ width: TILE_W * STEPS.length, height: TILE_H * rows.length });
  await sheet.setContent(`<body style="margin:0;background:#000;display:grid;grid-template-columns:repeat(${STEPS.length},${TILE_W}px);font:bold 14px sans-serif;color:#ff0">${rows.flatMap((tiles, r) => tiles.map((t, i) =>
    `<div style="position:relative;width:${TILE_W}px;height:${TILE_H}px;overflow:hidden"><img src="data:image/jpeg;base64,${t}" style="width:100%;height:100%;object-fit:cover"><span style="position:absolute;left:4px;top:2px">${r + 1} f${STEPS[i]}</span></div>`)).join('')}</body>`);
  await sheet.waitForTimeout(150);
  await sheet.screenshot({ path: `${h.outDir}/${process.env.BLAST_NAME ?? 'blast'}-sheet.png` });
  await context.close();
  return results;
}
