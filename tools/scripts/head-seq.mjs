// A lethal headshot frame by frame on the Test Range, one contact sheet per case, on world frames through the lab's own step. Real rays at real capsules.
//   HEAD=stand,run,crouch node tools/shot.mjs --url "/?map=range" --script tools/scripts/head-seq.mjs --dpr 2 --w 1440 --h 900 --wait 500 --timeout 170 --out tools/out/head.png
// Add &contract=outpost for the human rules. Sheets land next to --out as head-<case>.png. HEAD_ROUND=120 is a burst, 25 a light round.
const only = (process.env.HEAD ?? 'stand,run,crouch').split(',').filter(Boolean);
const round = Number(process.env.HEAD_ROUND ?? 120);
const force = Number(process.env.HEAD_FORCE ?? 40);
const tag = process.env.HEAD_TAG ?? '';
const TILE_W = 320;
const TILE_H = 300;
const COLUMNS = 6;
const STEPS = [0, 2, 4, 6, 8, 10, 12, 15, 18, 22, 26, 32, 40, 55, 75, 110, 160, 240];

export default async function headSeq(page, h) {
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
    const look = t => {
      const d = new V().subVectors(t, ctx.player.eye);
      ctx.player.yaw = Math.atan2(-d.x, -d.z);
      ctx.player.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
    };
    const r = {
      target: null, log: [],
      async walk(frames) {
        lab.step(frames);
        while (lab.steps > 0) await frame();
        await frame();
      },
      async start(name) {
        ctx.enemies.killAll('lab');
        ctx.enemies.reset();
        lab.spawner.clearBodies();
        if (lab.paused) lab.togglePause();
        ctx.player.teleport(new V(1.5, 0.1, 7), 0);
        await frame();
        const e = lab.spawner.place('trooper', new V(0, 0, 2), name === 'run' ? 'patrol' : 'off');
        r.target = e;
        e.yaw = -Math.PI / 2;
        if (name === 'run') e.speedMul = 1.8;
        if (name === 'crouch') {
          const o = ctx.enemies.outpost;
          if (o) e.posture = 'crouch';
          e.char.anim.setPosture('crouch');
        }
        look(new V(0, 1, 2));
        lab.togglePause();
        await r.walk(name === 'run' ? 70 : 30);
      },
      shoot(amount, force) {
        const e = r.target;
        const b = e.char.bones[4];
        b.updateWorldMatrix(true, false);
        const aim = new V(0, 0.09, 0.08).applyMatrix4(b.matrixWorld);
        const dir = new V().subVectors(aim, ctx.player.eye).normalize();
        const hit = ctx.enemies.raycast(ctx.player.eye.clone(), dir, 30);
        if (!hit) return { miss: true };
        const speed = Math.hypot(e.velocity.x, e.velocity.z);
        const res = ctx.enemies.applyDamage(hit.enemy, {
          amount, type: 'bullet', point: hit.point.clone(), dir: dir.clone(), force, source: 'judge', region: hit.region, bone: hit.bone, headshotMult: 2.5, severMult: 1,
        });
        return { region: hit.region, killed: res.killed, headshot: res.headshot, speed: +speed.toFixed(2) };
      },
      aim() {
        const hips = new V().setFromMatrixPosition(r.target.char.bones[0].matrixWorld);
        hips.y = Math.max(0.6, hips.y);
        look(hips);
      },
      probe() {
        const c = r.target.char;
        const y = b => +c.bones[b].matrixWorld.elements[13].toFixed(2);
        const s = ctx.gore.stats();
        return { hips: y(0), chest: y(2), ragdolls: s.ragdolls, collapses: s.collapses };
      },
    };
    window.__r = r;
  });

  const size = page.viewportSize();
  const clip = { x: size.width * 0.28, y: size.height * 0.08, width: size.width * 0.44, height: size.height * 0.84 };
  const results = {};
  for (const name of only) {
    await page.evaluate(async n => { await window.__r.start(n); }, name);
    const shot = await page.evaluate(({ round, force }) => window.__r.shoot(round, force), { round, force });
    const tiles = [];
    const notes = [];
    let at = 0;
    for (const f of STEPS) {
      if (f > at) await page.evaluate(n => window.__r.walk(n), f - at);
      at = f;
      await page.evaluate(() => window.__r.aim());
      await h.sleep(50);
      tiles.push((await page.screenshot({ type: 'jpeg', quality: 72, clip })).toString('base64'));
      notes.push(await page.evaluate(() => window.__r.probe()));
    }
    results[name] = { shot, notes: notes.map((n, i) => `f${STEPS[i]} hips ${n.hips} chest ${n.chest} rag ${n.ragdolls} col ${n.collapses}`) };
    const context = await page.context().browser().newContext();
    const sheet = await context.newPage();
    await sheet.setViewportSize({ width: TILE_W * COLUMNS, height: TILE_H * Math.ceil(tiles.length / COLUMNS) });
    await sheet.setContent(`<body style="margin:0;background:#000;display:grid;grid-template-columns:repeat(${COLUMNS},${TILE_W}px);font:bold 16px sans-serif;color:#ff0">${tiles.map((t, i) =>
      `<div style="position:relative;width:${TILE_W}px;height:${TILE_H}px;overflow:hidden"><img src="data:image/jpeg;base64,${t}" style="width:100%;height:100%;object-fit:cover"><span style="position:absolute;left:6px;top:4px">f${STEPS[i]}</span></div>`).join('')}</body>`);
    await sheet.waitForTimeout(150);
    await sheet.screenshot({ path: `${h.outDir}/head-${tag}${name}.png` });
    await context.close();
  }
  return results;
}
