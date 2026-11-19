// Every way a body is destroyed, on the Test Range, frame by frame from the player's eye: one contact sheet a case, and for
// each moment a count of what is in the world and in the air (docs/notes/gore-update.md, the "gibs" lane).
//
//   GIB=rocket1,grenade GIB_DIST=6 node tools/shot.mjs --port <yours> --url "/?map=range" --script tools/scripts/gib-seq.mjs \
//     --dpr 2 --w 1440 --h 900 --wait 500 --timeout 240 --out tools/out/<you>/gib.png
//
// Sheets land next to --out as gib-<case>-<dist>m.png, with <case>-<dist>m-f<frame>.png stills for GIB_STILLS frames.
// Every case runs on world frames through the lab's own step (1/60 s each), and the dice are seeded per case (GIB_SEED), so
// a sheet shows the same moments however slow the machine is and before and after are the same scene.
//
//   GIB        cases, comma separated (default: all). See CASES.
//   GIB_ID     the archetype (default trooper): husk, gunner, brute, ...
//   GIB_DIST   metres from the player's eye to the body (default 6)
//   GIB_SEED   Math.random seed (default 7)
//   GIB_STILLS frames to keep as full stills as well, comma separated (default none)
//   GIB_ZOOM   1 crops the sheet's tiles to the middle of the view (default at 15 m and over)
//   GIB_TAG    added to the sheet's name
import { PNG } from 'pngjs';

const only = (process.env.GIB ?? '').split(',').filter(Boolean);
const ID = process.env.GIB_ID ?? 'trooper';
const DIST = Number(process.env.GIB_DIST ?? 6);
const SEED = Number(process.env.GIB_SEED ?? 7);
const STILLS = (process.env.GIB_STILLS ?? '').split(',').filter(Boolean).map(Number);
const ZOOM = process.env.GIB_ZOOM ? process.env.GIB_ZOOM === '1' : DIST >= 12;
const TAG = process.env.GIB_TAG ? `-${process.env.GIB_TAG}` : '';
const TILE_W = 480;
const TILE_H = 300;
const COLUMNS = 4;
// 0, 0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 1.0, 1.5 s.
const BLAST_STEPS = [0, 3, 6, 9, 12, 18, 24, 30, 36, 48, 60, 90];

const rocket = { radius: 8, damage: 100, kind: 'rocket' };
const grenade = { radius: 7, damage: 190, kind: 'grenade' };
const barrel = { radius: 5, damage: 110, kind: 'barrel' };
const shell = { radius: 5, damage: 400, kind: 'shell' };

const CASES = {
  // A rocket at one man's feet; into three standing together; a grenade among three; a barrel; a tank shell.
  rocket1: { steps: BLAST_STEPS, act: r => r.explode(0.25, 0.25, r.spec.rocket) },
  rocket3: { crowd: 3, steps: BLAST_STEPS, act: r => r.explode(0.2, 0.25, r.spec.rocket) },
  grenade: { crowd: 3, steps: BLAST_STEPS, act: r => r.explode(0.2, 0.15, r.spec.grenade) },
  barrel: { steps: BLAST_STEPS, act: r => r.explode(0.5, 0.6, r.spec.barrel) },
  shell: { steps: BLAST_STEPS, act: r => r.explode(0.3, 0.3, r.spec.shell) },
  // A rocket's direct hit: the round itself, which bursts him whatever the rings say.
  direct: { steps: BLAST_STEPS, act: r => r.hit('chest', 300, 90, { type: 'explosive', source: 'rocket' }) },
  // A heavy round that obliterates (the Trommel's `gib`), and a frozen body shattering.
  heavy: { steps: BLAST_STEPS, act: r => r.hit('chest', 300, 60, { gib: true, source: 'buzzsaw' }) },
  frozen: { steps: BLAST_STEPS, act: r => { r.target.frozen = 5; r.hit('chest', 300, 30, {}); } },
  // A shotgun at point blank: the blow-out, and the tear at the waist it sometimes is.
  shotgun: { near: 2.6, steps: BLAST_STEPS, act: r => r.shell('chest', 8, 22, 110) },
  shotgunwaist: { near: 2.6, steps: BLAST_STEPS, act: r => r.low(() => r.shell('abdomen', 8, 22, 110)) },
  // Heads: burst, the partial wound, and off whole.
  headburst: { steps: BLAST_STEPS, act: r => r.hit('head', 400, 60, { source: 'sabot' }) },
  headpartial: { steps: BLAST_STEPS, act: r => r.hit('head', 60, 30, { source: 'judge' }) },
  headoff: { steps: BLAST_STEPS, act: r => r.gore(g => g.sever(r.target.char, 'head', r.damage('head', 30, 60, {}))) },
  // Each limb cut off a living man, and a loose limb destroyed outright.
  armL: { steps: BLAST_STEPS, act: r => r.cut('armL') },
  armR: { steps: BLAST_STEPS, act: r => r.cut('armR') },
  forearmL: { steps: BLAST_STEPS, act: r => r.cut('forearmL') },
  legL: { steps: BLAST_STEPS, act: r => r.cut('legL') },
  legR: { steps: BLAST_STEPS, act: r => r.cut('legR') },
  shinR: { steps: BLAST_STEPS, act: r => r.cut('shinR') },
  limbburst: { steps: BLAST_STEPS, act: async r => { r.cut('armL'); await r.walk(50); r.burstLimbs(); } },
  legburst: { steps: BLAST_STEPS, act: async r => { r.cut('legL'); await r.walk(50); r.burstLimbs(); } },
  // The blade: a slice through the chest; and the waist cut that leaves a top half crawling.
  slice: { steps: BLAST_STEPS, act: r => r.hit('chest', 400, 60, { type: 'slash', source: 'katana', slicePlaneNormal: new r.V(0.25, 1, 0.1).normalize() }) },
  waist: { steps: BLAST_STEPS, act: r => r.gore(g => g.sever(r.target.char, 'abdomen', r.damage('abdomen', 60, 60, { type: 'slash' }))) },
  // The Lance: meant to leave nothing.
  vaporize: { steps: [0, 6, 12, 24, 36, 48, 60, 80, 100, 120, 140, 160], act: r => r.hit('chest', 400, 30, { vaporize: true, source: 'lance' }) },
  // A corpse on the floor gibbed by a second rocket.
  corpse: { steps: BLAST_STEPS, act: async r => { r.hit('chest', 400, 20, {}); await r.walk(110); r.explode(0.3, 0.25, r.spec.rocket); } },
};

function redShare(buffer) {
  const png = PNG.sync.read(buffer);
  let red = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    const R = png.data[i], G = png.data[i + 1], B = png.data[i + 2];
    // Blood and meat: clearly red, not the fireball's orange and yellow.
    if (R > 70 && R > G * 2.2 && R > B * 1.8) red++;
  }
  return +(red / (png.data.length / 4) * 100).toFixed(2);
}

export default async function gibSeq(page, h) {
  for (let i = 0; i < 180; i++) {
    if (await page.evaluate(() => !!window.__lab && window.__op2?.game?.state === 'playing')) break;
    await h.sleep(500);
  }
  await page.evaluate(({ rocket, grenade, barrel, shell }) => {
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
    const seeded = seed => {
      let a = seed >>> 0;
      return () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    };
    const look = t => {
      const d = new V().subVectors(t, ctx.player.eye);
      ctx.player.yaw = Math.atan2(-d.x, -d.z);
      ctx.player.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
    };
    const AT = new V(0, 0, 3);
    const r = {
      V, spec: { rocket, grenade, barrel, shell }, target: null, crowd: [], centre: AT.clone(), log: [],
      async walk(frames) {
        lab.step(frames);
        while (lab.steps > 0) await frame();
        await frame();
      },
      async start(c) {
        ctx.enemies.killAll('lab');
        ctx.enemies.reset();
        lab.spawner.clearBodies();
        ctx.gore.clear();
        ctx.render.decals.clear?.();
        if (lab.paused) lab.togglePause();
        Math.random = seeded(c.seed);
        const dist = c.near ?? c.dist;
        ctx.player.teleport(new V(0, 0.1, AT.z + dist), 0);
        await frame();
        r.crowd = [];
        const spots = c.crowd === 3 ? [[0, 0], [-0.9, -0.5], [0.95, -0.35]] : [[0, 0]];
        for (const [x, z] of spots) {
          const e = lab.spawner.place(c.id, new V(AT.x + x, 0, AT.z + z), 'off');
          e.stagger = 0;
          r.crowd.push(e);
        }
        r.target = r.crowd[0];
        r.centre.copy(AT);
        r.log = [];
        look(new V(AT.x, c.lookY ?? 1.0, AT.z));
        lab.togglePause();
        await r.walk(c.settle ?? 20);
      },
      /** A blast `side` metres to the body's left on the floor and `y` up, as a rocket landing at his feet. */
      explode(side, y, spec) {
        const at = new V(AT.x + side, y, AT.z + 0.15);
        r.centre.copy(at);
        ctx.combat.explode(at, { ...spec, source: 'test', team: 'player' });
      },
      damage(region, amount, force, extra) {
        const e = r.target;
        const bone = e.char.rig.bones.findIndex(b => b.region === region);
        const point = new V().setFromMatrixPosition(e.char.bones[Math.max(bone, 0)].matrixWorld);
        const dir = new V(0, 0, -1);
        r.centre.copy(point);
        return { amount, type: 'bullet', point, dir, force, source: 'test', region, bone: bone >= 0 ? bone : undefined, ...extra };
      },
      hit(region, amount, force, extra) {
        return ctx.enemies.applyDamage(r.target, r.damage(region, amount, force, extra));
      },
      shell(region, pellets, amount, force) {
        for (let i = 0; i < pellets; i++) {
          const d = r.damage(region, amount, force, { type: 'pellet', source: 'shotgun' });
          d.point.x += (Math.random() - 0.5) * 0.12;
          d.point.y += (Math.random() - 0.5) * 0.12;
          if (r.target.alive) ctx.enemies.applyDamage(r.target, d);
        }
      },
      /** Runs `act` with the dice at their lowest, for a roll that has to come up. */
      low(act) {
        const before = Math.random;
        Math.random = () => 0.001;
        try { return act(); } finally { Math.random = before; }
      },
      gore(act) {
        return act(ctx.gore);
      },
      /** Cuts a limb off the living man, as a round that wears its pool through does. */
      cut(region) {
        const e = r.target;
        e.limbHp.set(region, 0.1);
        const d = r.damage(region, 30, 40, {});
        d.dir.set(region.endsWith('L') ? 0.5 : -0.5, 0.1, -0.85).normalize();
        ctx.enemies.applyDamage(e, d);
      },
      /** Destroys every loose limb outright, as rounds into it do. */
      burstLimbs() {
        const gore = ctx.gore;
        for (const limb of [...gore.limbs]) {
          r.centre.copy(limb.rag.center);
          gore.burstLimb(limb, { amount: 200, type: 'bullet', point: limb.rag.center.clone(), dir: new V(0, 0.2, -1).normalize(), force: 30, source: 'test' });
        }
      },
      aim(c) {
        look(new V(AT.x, c.lookY ?? 1.0, AT.z));
      },
      /** What is in the world now: counts, how much of it is in the air, and how far it has got from the blast. */
      stats() {
        const gore = ctx.gore;
        const c = r.centre;
        const out = { halves: 0, halvesAir: 0, limbs: 0, limbsAir: 0, chunks: 0, chunksAir: 0, kinds: {}, guts: 0, gutsLoose: 0, far: 0, bodies: 0 };
        const reach = [];
        for (const half of gore.sliced.halves) {
          if (half.sinking >= 0) continue;
          out.halves++;
          if (half.body && half.mesh.position.y > 0.45) out.halvesAir++;
          reach.push(Math.hypot(half.mesh.position.x - c.x, half.mesh.position.z - c.z));
        }
        for (const limb of gore.limbs) {
          out.limbs++;
          if (limb.rag.active && limb.rag.center.y > 0.45) out.limbsAir++;
          reach.push(Math.hypot(limb.rag.center.x - c.x, limb.rag.center.z - c.z));
        }
        for (const chunk of gore.chunks.all) {
          if (!chunk.alive) continue;
          out.chunks++;
          out.kinds[chunk.kind] = (out.kinds[chunk.kind] ?? 0) + 1;
          if (chunk.body) {
            chunk.body.translation(chunk.p);
            if (chunk.p.y > 0.45) out.chunksAir++;
          }
          reach.push(Math.hypot(chunk.p.x - c.x, chunk.p.z - c.z));
        }
        for (const rope of gore.ropes.ropes) {
          if (!rope.alive) continue;
          out.guts++;
          if (rope.target === null) out.gutsLoose++;
        }
        for (const b of gore.bodies) if (b.sinking < 0) out.bodies++;
        reach.sort((a, b) => a - b);
        out.far = reach.length ? +reach[reach.length - 1].toFixed(1) : 0;
        out.mid = reach.length ? +reach[reach.length >> 1].toFixed(1) : 0;
        return out;
      },
    };
    window.__r = r;
  }, { rocket, grenade, barrel, shell });

  const size = page.viewportSize();
  const clip = ZOOM
    ? { x: size.width * 0.3, y: size.height * 0.27, width: size.width * 0.4, height: size.height * 0.4 }
    : { x: size.width * 0.1, y: size.height * 0.0625, width: size.width * 0.8, height: size.height * 0.8 };
  const results = {};
  for (const [name, c] of Object.entries(CASES)) {
    if (only.length > 0 && !only.includes(name)) continue;
    const conf = { id: c.id ?? ID, crowd: c.crowd ?? 1, near: c.near, dist: DIST, seed: SEED, settle: c.settle, lookY: c.lookY };
    await page.evaluate(async conf => { await window.__r.start(conf); }, conf);
    const before = await page.evaluate(() => window.__r.stats());
    const callMs = await page.evaluate(`(async () => { const t0 = performance.now(); await (${c.act.toString()})(window.__r); return +(performance.now() - t0).toFixed(1); })()`);
    const tiles = [];
    const notes = [];
    let at = 0;
    for (const f of c.steps) {
      if (f > at) await page.evaluate(n => window.__r.walk(n), f - at);
      at = f;
      await page.evaluate(conf => window.__r.aim(conf), conf);
      await h.sleep(60);
      const png = await page.screenshot({ type: 'png', clip });
      tiles.push(png.toString('base64'));
      const note = await page.evaluate(() => window.__r.stats());
      note.red = redShare(png);
      notes.push({ f, t: +(f / 60).toFixed(2), ...note });
      if (STILLS.includes(f)) await page.screenshot({ path: `${h.outDir}/${name}-${DIST}m${TAG}-f${f}.png` });
    }
    results[name] = { callMs, before, notes };
    const context = await page.context().browser().newContext({ deviceScaleFactor: 2 });
    const sheet = await context.newPage();
    const rows = Math.ceil(tiles.length / COLUMNS);
    await sheet.setViewportSize({ width: TILE_W * COLUMNS, height: TILE_H * rows });
    await sheet.setContent(`<body style="margin:0;background:#000;display:grid;grid-template-columns:repeat(${COLUMNS},${TILE_W}px);font:bold 15px sans-serif;color:#ff0">${tiles.map((t, i) =>
      `<div style="position:relative;width:${TILE_W}px;height:${TILE_H}px;overflow:hidden"><img src="data:image/png;base64,${t}" style="width:100%;height:100%;object-fit:cover"><span style="position:absolute;left:6px;top:4px;text-shadow:0 0 3px #000">${(c.steps[i] / 60).toFixed(2)} s</span></div>`).join('')}</body>`);
    await sheet.waitForTimeout(200);
    await sheet.screenshot({ path: `${h.outDir}/gib-${name}-${DIST}m${TAG}.png` });
    await context.close();
  }
  return results;
}
