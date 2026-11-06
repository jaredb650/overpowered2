// Section 14.6 on the Test Range, frame by frame, one contact sheet per zone. Real rays against the real capsules, so each case
// proves the zone as well as the reaction.
//   WOUND=carotid,gut node tools/shot.mjs --url "/?map=range&contract=outpost" --script tools/scripts/wounds-seq.mjs --dpr 2 --w 1440 --h 900 --wait 500 --timeout 170 --out tools/out/wounds.png
// Sheets land next to --out as wound-<case>.png. Every case runs on world frames through the lab's own step, so a sheet shows the
// same moments however slow the machine is. Add WOUND_AI=on to spawn with the brain running.
const only = (process.env.WOUND ?? '').split(',').filter(Boolean);
const TILE_W = 480;
const TILE_H = 300;
const COLUMNS = 4;
const LONG = [0, 6, 12, 20, 30, 45, 70, 100, 140, 200, 280, 400];

// `at`: bone, then a point on it in bone axes. `from`: 'front', 'back', 'left', 'right' of the man.
const CASES = {
  thigh: { shots: [{ at: [11, 0.06, -0.2, 0.09], from: 'front' }], walk: true, steps: LONG },
  thigh3: { shots: [{ at: [11, 0.06, -0.2, 0.09], from: 'front' }, { at: [11, 0.06, -0.25, 0.09], from: 'front', wait: 8 }, { at: [11, 0.06, -0.3, 0.09], from: 'front', wait: 8 }], steps: LONG },
  femoral: { shots: [{ at: [14, 0.038, -0.1, 0.09], from: 'front' }], steps: [0, 10, 30, 60, 120, 240, 360, 480, 540, 600, 660, 780] },
  hand: { shots: [{ at: [10, 0, -0.06, 0.05], from: 'front' }], steps: LONG },
  arm: { shots: [{ at: [6, 0.04, -0.12, 0.05], from: 'front' }], steps: LONG },
  shoulder: { shots: [{ at: [8, -0.02, -0.04, 0.06], from: 'front' }], steps: LONG },
  botharms: { shots: [{ at: [8, -0.05, -0.2, 0.06], from: 'front' }, { at: [5, 0.05, -0.2, 0.06], from: 'front', wait: 10 }], steps: LONG },
  lung: { shots: [{ at: [2, -0.14, 0.1, 0.15], from: 'front' }], steps: [0, 10, 30, 60, 100, 150, 220, 300, 360, 420, 500, 620] },
  heart: { shots: [{ at: [2, 0.035, 0.11, 0.17], from: 'front' }], steps: LONG },
  gut: { shots: [{ at: [1, 0.05, 0.1, 0.13], from: 'front' }], walk: true, steps: LONG },
  carotid: { shots: [{ at: [3, 0.05, 0.04, 0.05], from: 'front' }], steps: [0, 8, 16, 26, 40, 60, 90, 120, 150, 180, 210, 260] },
  spine: { shots: [{ at: [1, 0, 0.1, -0.13], from: 'back' }], steps: LONG },
  pelvis: { shots: [{ at: [0, 0, -0.06, 0.12], from: 'front' }], steps: LONG },
  head: { shots: [{ at: [4, 0, 0.09, 0.12], from: 'front' }], steps: LONG },
  glance: { shots: [{ at: [4, 0.104, 0.09, 0.03], from: 'front' }], steps: LONG },
  blast: { blast: 3.5, steps: LONG },
  rocket: { blast: 0.5, damage: 200, steps: LONG },
  burst: { burst: 8, steps: [0, 4, 8, 12, 18, 24, 34, 50, 80, 120, 180, 260] },
  fire: { fire: true, steps: LONG },
  crawl: { id: 'trooper', shots: [{ at: [0, 0, -0.06, 0.12], from: 'front' }], steps: [0, 40, 80, 120, 160, 200, 240, 300, 360, 420, 480, 560] },
};

export default async function woundsSeq(page, h) {
  for (let i = 0; i < 180; i++) {
    if (await page.evaluate(() => !!window.__lab && window.__op2?.game?.state === 'playing')) break;
    await h.sleep(500);
  }
  await page.evaluate(ai => {
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
      V, target: null, log: [],
      wounded: [],
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
        const e = lab.spawner.place(c.id ?? 'trooper', new V(0, 0, 3), c.walk ? 'patrol' : ai);
        e.yaw = -Math.PI / 2;
        r.target = e;
        look(new V(0, 1, 3));
        lab.togglePause();
        await r.walk(c.walk ? 50 : 20);
      },
      /** Writes the direction of a round coming from one side of him. */
      dirFrom(side) {
        const e = r.target;
        const front = new V(Math.sin(e.yaw), 0, Math.cos(e.yaw));
        const left = new V(front.z, 0, -front.x);
        if (side === 'front') return front.negate();
        if (side === 'back') return front;
        return side === 'left' ? left.negate() : left;
      },
      shoot(s) {
        const e = r.target;
        const [bone, x, y, z] = s.at;
        const b = e.char.bones[bone];
        b.updateWorldMatrix(true, false);
        const aim = new V(x, y, z).applyMatrix4(b.matrixWorld);
        const dir = r.dirFrom(s.from);
        const origin = aim.clone().addScaledVector(dir, -5);
        const hit = ctx.enemies.raycast(origin, dir, 9);
        if (!hit) {
          r.log.push({ miss: s.at });
          return;
        }
        r.log.push({ bone: hit.bone, region: hit.region });
        ctx.enemies.applyDamage(hit.enemy, {
          amount: s.amount ?? 25, type: s.type ?? 'bullet', point: hit.point.clone(), dir: dir.clone(), force: s.force ?? 0, source: 'smg', region: hit.region, bone: hit.bone, headshotMult: 2, severMult: 1,
        });
      },
      blast(distance, damage) {
        const e = r.target;
        ctx.combat.explode(new V(e.position.x - distance, 0.3, e.position.z), { radius: 8, damage: damage ?? 100, kind: 'rocket', source: 'test', team: 'player' });
      },
      burn() {
        r.target.burning = 6;
        ctx.enemies.applyDamage(r.target, { amount: 9, type: 'fire', point: r.target.center.clone(), dir: new V(1, 0, 0), force: 1, source: 'kiln' });
      },
      aim() {
        const hips = new V().setFromMatrixPosition(r.target.char.bones[0].matrixWorld);
        hips.y = Math.max(0.5, hips.y * 0.9);
        look(hips);
      },
      probe() {
        const e = r.target;
        const w = ctx.enemies.outpost?.soldierOf(e);
        return {
          alive: e.alive, c: w?.injuries.condition, hp: +e.health.toFixed(0), legs: e.maim.legs, arms: e.maim.arms, wp: w?.weapon, gd: e.downed, x: +e.position.x.toFixed(2), z: +e.position.z.toFixed(2),
          clock: w && Number.isFinite(w.injuries.bleedsOutAt) ? +(w.injuries.bleedsOutAt - ctx.time.elapsed).toFixed(1) : undefined,
          bleed: w ? +w.injuries.bleed.toFixed(3) : undefined,
          hipsY: +e.char.bones[0].matrixWorld.elements[13].toFixed(2),
        };
      },
    };
    ctx.events.on('enemy:wounded', x => r.log.push({ label: x.label, zone: x.zone }));
    ctx.events.on('enemy:condition', x => r.log.push({ condition: x.condition, at: +ctx.time.elapsed.toFixed(2) }));
    ctx.events.on('enemy:killed', x => r.log.push({ killed: true, gibbed: x.gibbed, at: +ctx.time.elapsed.toFixed(2) }));
    window.__r = r;
  }, process.env.WOUND_AI ?? 'off');

  const size = page.viewportSize();
  const clip = { x: size.width * 0.28, y: size.height * 0.26, width: size.width * 0.44, height: size.height * 0.48 };
  const results = {};
  for (const [name, c] of Object.entries(CASES)) {
    if (only.length > 0 && !only.includes(name)) continue;
    await page.evaluate(async c => { await window.__r.start(c); }, { id: c.id, walk: c.walk });
    for (const s of c.shots ?? []) {
      if (s.wait) await page.evaluate(n => window.__r.walk(n), s.wait);
      await page.evaluate(x => window.__r.shoot(x), s);
    }
    if (c.blast) await page.evaluate(({ d, m }) => window.__r.blast(d, m), { d: c.blast, m: c.damage });
    if (c.fire) await page.evaluate(() => window.__r.burn());
    if (c.burst) {
      for (let i = 0; i < c.burst; i++) {
        await page.evaluate(() => {
          const e = window.__r.target;
          if (e.alive) window.__r.shoot({ at: [2, (Math.random() - 0.5) * 0.3, 0.1, 0.15], from: 'front' });
        });
        await page.evaluate(() => window.__r.walk(3));
      }
    }
    const tiles = [];
    const notes = [];
    let at = 0;
    for (const f of c.steps) {
      if (f > at) await page.evaluate(n => window.__r.walk(n), f - at);
      at = f;
      await page.evaluate(() => window.__r.aim());
      await h.sleep(60);
      tiles.push((await page.screenshot({ type: 'jpeg', quality: 72, clip })).toString('base64'));
      notes.push(await page.evaluate(() => window.__r.probe()));
    }
    results[name] = { log: await page.evaluate(() => window.__r.log.splice(0)), notes: notes.map((n, i) => ({ f: c.steps[i], ...n })) };
    const context = await page.context().browser().newContext();
    const sheet = await context.newPage();
    await sheet.setViewportSize({ width: TILE_W * COLUMNS, height: TILE_H * Math.ceil(tiles.length / COLUMNS) });
    await sheet.setContent(`<body style="margin:0;background:#000;display:grid;grid-template-columns:repeat(${COLUMNS},${TILE_W}px);font:bold 18px sans-serif;color:#ff0">${tiles.map((t, i) =>
      `<div style="position:relative;width:${TILE_W}px;height:${TILE_H}px;overflow:hidden"><img src="data:image/jpeg;base64,${t}" style="width:100%;height:100%;object-fit:cover"><span style="position:absolute;left:6px;top:4px">${c.steps[i]} ${notes[i].c ?? 'dead'}</span></div>`).join('')}</body>`);
    await sheet.waitForTimeout(150);
    await sheet.screenshot({ path: `${h.outDir}/wound-${name}.png` });
    await context.close();
  }
  return results;
}
