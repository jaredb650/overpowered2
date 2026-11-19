// The far batch, proved in the real game: a body as a character, the same body baked into the batch, and the same body
// stood up again, photographed from one place with the game stopped, and compared.
//
//   node tools/shot.mjs --port <yours> --url "/?autostart=1" --dpr 2 --w 1440 --h 900 --wait 500 --timeout 500 --quiet \
//     --script tools/scripts/mess-far.mjs --out tools/out/<you>/last.png
//
// Writes into FAR_DIR (tools/out/mess), names starting FAR_TAG (far):
//   <tag>-<metres>m-1-character.png, -2-baked.png, -3-stood-up.png   one row of bodies seen from that far, three ways
//   <tag>-<metres>m-strip.png        the three side by side, cropped to the bodies and enlarged
//   <tag>-rocket.png                 contact sheet: a rocket into a heap of baked bodies, one frame every 48 ms
//   <tag>.json                       how many pixels change at each swap (tools/diff.mjs's count), how far any bone is from
//                                    where it was after a body is stood up again, what a bake and a stand-up cost in ms,
//                                    draw calls and triangles for 60 bodies as characters and with all but 8 baked
//
// FAR_DISTANCES (6,11,18): how far the row lies. The policy only swaps a body out of sight or past 11 m
// (`MessTuning.swapFar`); the nearer rows are here to show what a forced swap in plain sight would look like.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { layout, sheetHtml } from '../lib/sheet-layout.mjs';

const DIR = resolve(process.env.FAR_DIR ?? 'tools/out/mess');
const TAG = process.env.FAR_TAG ?? 'far';
const DISTANCES = (process.env.FAR_DISTANCES ?? '6,11,18').split(',').map(Number);
const SPOT = process.env.FAR_SPOT ?? 'core_floor';

/** Runs in the page. */
async function install({ spot }) {
  const { ctx, game } = window.__op2;
  const r = ctx.render;
  const gore = await import('/src/gore/index.ts');
  const mess = await import('/src/gore/mess.ts');
  const data = await import('/src/progression/data.ts');
  for (const table of Object.values(data)) if (table && typeof table === 'object' && 'dropChance' in table) table.dropChance = 0;
  r.dynamicResolution.enabled = false;
  ctx.waves.update = () => {};
  ctx.waves.start = () => {};
  ctx.player.modifiers.invulnerable = true;
  r.viewScene.visible = false;
  const css = document.createElement('style');
  css.textContent = '.hud { visibility: hidden !important; }';
  document.head.appendChild(css);
  const raf = k => new Promise(res => {
    const step = () => (--k <= 0 ? res() : requestAnimationFrame(step));
    requestAnimationFrame(step);
  });
  const P = ctx.player;
  const V = P.eye.constructor;
  const hitOf = () => ({ point: new V(), normal: new V(), distance: 0, surface: 'concrete', collider: null });
  const ground = (x, y, z) => {
    const h = hitOf();
    return ctx.physics.raycastInto(new V(x, y + 1.5, z), new V(0, -1, 0), 40, 1, h) ? h.point.clone() : new V(x, y, z);
  };
  const view = ctx.world.spec.views[spot];
  const origin = new V(...view.pos);
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
  const home = ground(origin.x, origin.y, origin.z);
  const along = (d, s = 0) => ground(origin.x + fwd.x * d + side.x * s, origin.y, origin.z + fwd.z * d + side.z * s);
  const stand = () => {
    P.teleport(home, Math.atan2(-fwd.x, -fwd.z));
    P.yaw = Math.atan2(-fwd.x, -fwd.z);
    P.pitch = -0.12;
  };
  const g = ctx.gore;
  const corpses = () => g.bodies.filter(b => b.sinking < 0 && !b.down);
  const settle = async seconds => {
    const end = performance.now() + seconds * 1000;
    while (performance.now() < end) {
      await raf(6);
      const s = g.stats();
      if (s.ragdolls === 0 && s.liveLimbs === 0) return true;
    }
    return false;
  };
  const freeze = () => { game.frame = () => {}; };
  const thaw = () => { delete game.frame; };
  /** A row of bodies `metres` ahead, six across, a Trooper, a Husk and a Gunner in turn, every other one opened by a shell. */
  const row = async (metres, count = 6, deep = 1) => {
    thaw();
    // Nothing is baked or stood up but by this script.
    mess.MessTuning.far = false;
    ctx.enemies.killAll?.('far');
    g.clear();
    r.decals.clear();
    gore.GoreTuning.maxCorpses = 400;
    stand();
    await raf(4);
    const kinds = ['trooper', 'husk', 'gunner', 'husk', 'trooper', 'brute'];
    for (let i = 0; i < count * deep; i++) {
      const e = ctx.enemies.spawn(kinds[i % kinds.length], along(metres + Math.floor(i / count) * 1.4, ((i % count) - (count - 1) / 2) * 1.25));
      if (!e) continue;
      e.attacks = [];
      e.behaviours = [];
      e.speedMul = 0;
      if (ctx.enemies.alive.length >= 40) {
        await raf(3);
        ctx.enemies.killAll('far');
        await settle(12);
      }
    }
    await raf(3);
    ctx.enemies.killAll('far');
    await settle(12);
    const list = corpses();
    const at = new V();
    for (let i = 0; i < list.length; i += 2) {
      at.setFromMatrixPosition(list[i].char.bones[2].matrixWorld);
      const hit = g.raycastCorpses(new V(at.x, at.y + 1.2, at.z), new V(0, -1, 0), 3);
      if (hit) g.damageCorpse(hit, { amount: 34, type: 'pellet', point: hit.point.clone(), dir: new V(0, -1, 0), force: 5, source: 'shotgun' });
    }
    await settle(12);
    // Pools spread and stumps stop before anything is compared.
    await raf(360);
    freeze();
    await raf(2);
    r.render();
    return { bodies: corpses().length };
  };
  const bonesOf = () => corpses().map(b => b.char.bones.map(bone => new V().setFromMatrixPosition(bone.matrixWorld)));
  const pctl = (a, p) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] ?? 0;
  /** Bakes every body there is. Returns what each bake cost. */
  const bakeAll = () => {
    const times = [];
    for (const b of [...corpses()]) {
      b.tier = 1;
      const t0 = performance.now();
      const ok = g.bake(b);
      if (ok) times.push(performance.now() - t0);
    }
    r.render();
    return { baked: g.farBodies.length, left: corpses().length, ms: { median: +pctl(times, 0.5).toFixed(3), worst: +pctl(times, 1).toFixed(3) }, triangles: g.far.triangles };
  };
  const standAll = () => {
    const times = [];
    for (const f of [...g.farBodies]) {
      const t0 = performance.now();
      if (g.standUp(f)) times.push(performance.now() - t0);
    }
    r.render();
    return { stood: times.length, ms: { median: +pctl(times, 0.5).toFixed(3), worst: +pctl(times, 1).toFixed(3) } };
  };
  /** How far the worst bone of each body is from where it was, matching bodies by where their hips lie. */
  const moved = was => {
    let worst = 0;
    for (const now of bonesOf()) {
      let best = null;
      let bestD = Infinity;
      for (const old of was) {
        const d = old[0].distanceTo(now[0]);
        if (d < bestD) {
          bestD = d;
          best = old;
        }
      }
      if (best) now.forEach((p, i) => { worst = Math.max(worst, p.distanceTo(best[i])); });
    }
    return +worst.toFixed(5);
  };
  /** The screen rectangle that holds every body, in CSS pixels, with a margin. */
  const frameOf = () => {
    const cam = r.camera;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const p = new V();
    const take = v => {
      p.copy(v).project(cam);
      const x = (p.x * 0.5 + 0.5) * innerWidth, y = (-p.y * 0.5 + 0.5) * innerHeight;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    };
    for (const b of corpses()) for (const bone of b.char.bones) take(new V().setFromMatrixPosition(bone.matrixWorld));
    for (const f of g.farBodies) { take(f.rag.restMin); take(f.rag.restMax); }
    const m = 40;
    x0 = Math.max(0, Math.floor(x0 - m)); y0 = Math.max(0, Math.floor(y0 - m));
    x1 = Math.min(innerWidth, Math.ceil(x1 + m)); y1 = Math.min(innerHeight, Math.ceil(y1 + m));
    return { x: x0, y: y0, width: Math.max(8, x1 - x0), height: Math.max(8, y1 - y0) };
  };
  const cost = () => {
    r.render();
    return { calls: r.drawCalls(), tris: r.triangles() };
  };
  /** A rocket into the middle of the baked bodies. */
  const rocket = metres => {
    thaw();
    // Seen from 5 m, a little to one side.
    P.teleport(along(metres - 5, 1.5), Math.atan2(-fwd.x, -fwd.z));
    P.pitch = -0.2;
    const at = along(metres + 0.7);
    ctx.combat.explode(new V(at.x, at.y + 0.3, at.z), { radius: 5, damage: 200, kind: 'rocket', source: 'rocket', team: 'player' });
  };
  window.__far = { row, bakeAll, standAll, bonesOf, moved, frameOf, cost, rocket, raf, freeze, thaw, stats: () => ({ ...g.stats(), mess: g.mess.stats(), farTris: g.far.triangles }), keep: null };
  return { size: r.renderSize(), longest: +longest.toFixed(1) };
}

export default async function far(page, h) {
  mkdirSync(DIR, { recursive: true });
  await page.waitForFunction('!!window.__op2 && window.__op2.game && window.__op2.game.state === "playing"', null, { timeout: 120000 });
  await h.sleep(1500);
  const report = { tag: TAG, rows: [] };
  report.setup = await page.evaluate(install, { spot: SPOT });
  const shot = async (name, clip) => {
    const file = join(DIR, `${TAG}-${name}.png`);
    await page.screenshot({ path: file, clip });
    return file;
  };
  const diff = (a, b, name) => {
    try {
      const out = execFileSync('node', ['tools/diff.mjs', a, b, '--out', join(DIR, `${TAG}-${name}-diff.png`)], { encoding: 'utf8' });
      const line = out.trim().split('\n').filter(l => l.startsWith('{')).pop();
      const j = JSON.parse(line);
      return { percent: j.percent, changed: j.changed, box: j.box };
    } catch (e) {
      return { error: String(e.message ?? e).slice(0, 200) };
    }
  };
  for (const metres of DISTANCES) {
    const laid = await page.evaluate(m => window.__far.row(m), metres);
    await page.evaluate(() => { window.__far.keep = window.__far.bonesOf(); });
    const clip = await page.evaluate(() => window.__far.frameOf());
    const asCharacter = await page.evaluate(() => window.__far.cost());
    const a = await shot(`${metres}m-1-character`, clip);
    const baked = await page.evaluate(() => window.__far.bakeAll());
    const asBaked = await page.evaluate(() => window.__far.cost());
    const b = await shot(`${metres}m-2-baked`, clip);
    const stood = await page.evaluate(() => window.__far.standAll());
    const c = await shot(`${metres}m-3-stood-up`, clip);
    const bones = await page.evaluate(() => window.__far.moved(window.__far.keep));
    const row = {
      metres, ...laid, clip, baked, stood, worstBoneMoved: bones, asCharacter, asBaked,
      characterToBaked: diff(a, b, `${metres}m-bake`), characterToStoodUp: diff(a, c, `${metres}m-roundtrip`),
    };
    row.strip = await strip(page, [
      { src: a, text: `${metres} m: characters (settled)` },
      { src: b, text: `${metres} m: baked into the far batch` },
      { src: c, text: `${metres} m: stood up again` },
    ], join(DIR, `${TAG}-${metres}m-strip.png`), `${TAG}: one row of bodies ${metres} m off, three ways`, clip);
    report.rows.push(row);
    console.log(JSON.stringify({ metres, baked: baked.baked, bakeMs: baked.ms, standMs: stood.ms, bones, bake: row.characterToBaked.percent, roundtrip: row.characterToStoodUp.percent }));
  }

  // Sixty bodies: what they cost as characters, and with all of them baked.
  await page.evaluate(() => window.__far.row(7, 10, 6));
  const many = { asCharacters: await page.evaluate(() => window.__far.cost()) };
  many.bake = await page.evaluate(() => window.__far.bakeAll());
  many.asBaked = await page.evaluate(() => window.__far.cost());
  report.sixty = many;

  // A rocket into them: the baked ones it reaches stand up and are thrown.
  const tiles = [];
  await page.evaluate(() => window.__far.rocket(9));
  for (let i = 0; i < 18; i++) {
    const s = await page.evaluate(() => window.__far.stats());
    if (i === 0) await page.evaluate(() => window.__far.raf(2));
    tiles.push({ src: await shot(`rocket-${String(i).padStart(2, '0')}`), text: `#${i}   ${s.far} baked, ${s.corpses} characters, ${s.ragdolls} ragdolls awake` });
    await page.evaluate(() => window.__far.raf(3));
  }
  report.rocketEnd = await page.evaluate(() => window.__far.stats());
  report.rocketSheet = await strip(page, tiles, join(DIR, `${TAG}-rocket.png`), `${TAG}: a rocket into sixty baked bodies   ·   about one frame in three`, null, 6);
  writeFileSync(join(DIR, `${TAG}.json`), JSON.stringify(report, null, 1));
  return report;
}

/** Stills side by side with a line under each. A `clip` in CSS pixels says what each still's shape is. */
async function strip(page, tiles, out, title, clip, cols = 3) {
  const view = page.viewportSize();
  const frameW = clip?.width ?? view.width;
  const frameH = clip?.height ?? view.height;
  const grid = layout({ count: tiles.length, cols, tile: cols <= 3 ? 900 : 480, frameW, frameH });
  const names = tiles.map((t, i) => ({ src: `t${i}.png`, text: t.text, path: t.src }));
  const html = sheetHtml({ grid, tiles: names, title });
  const context = await page.context().browser().newContext({ viewport: { width: grid.width, height: grid.height }, deviceScaleFactor: 1 });
  try {
    const p = await context.newPage();
    await p.route('http://sheet.invalid/**', route => {
      const name = new URL(route.request().url()).pathname.slice(1);
      const tile = names.find(t => t.src === name);
      return tile ? route.fulfill({ path: tile.path, contentType: 'image/png' }) : route.fulfill({ contentType: 'text/html', body: html });
    });
    await p.goto('http://sheet.invalid/');
    await p.waitForFunction(() => [...document.images].every(img => img.complete && img.naturalWidth > 0), null, { timeout: 60000 });
    await p.screenshot({ path: out });
  } finally {
    await context.close();
  }
  return out;
}
