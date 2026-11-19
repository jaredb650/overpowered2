// One real trigger pull on a standing enemy, frame by frame, for the blood puff (docs/notes/fx.md, "The puff"): the real gun,
// the real map, a fixed 1/60 clock so a loaded machine cannot change what is on screen.
//
//   BP_TAG=after node tools/shot.mjs --port <port> --url "/?autostart=1" --dpr 2 --w 1440 --h 900 --wait 500 --timeout 400 \
//     --quiet --script tools/scripts/blood-puff-shots.mjs
//
// Writes, into BP_DIR (default tools/out/coop/gore):
//   puff-<tag>-<gun>-<dist>m.png        a contact sheet of the hit: one cell per frame (BP_FRAMES), BP_COLS to a row, cropped on the body
//   puff-<tag>-<gun>-<dist>m-f1.png     the whole screen on the frame the round lands (2880x1800 at dpr 2)
//   puff-<tag>.json                     blood particles alive on each captured frame, per gun and distance
//
// Env: BP_PUFF=0 (the same build with no puff: the "before"), BP_TAG (before|after), BP_GUNS (rivet,harrow,shotgun), BP_DIST (2.5,18), BP_FRAMES (1,2,3,4,6,9,14,24), BP_SPOT
// (a view of the map spec), BP_ENEMY (trooper), BP_DIR, BP_CELL (cell width, px), BP_PLATE=1 (a Brute's chest plate: sparks, no puff).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const TAG = process.env.BP_TAG ?? 'x';
const GUNS = (process.env.BP_GUNS ?? 'rivet,harrow,shotgun').split(',');
const DISTS = (process.env.BP_DIST ?? '2.5,18').split(',').map(Number);
const FRAMES = (process.env.BP_FRAMES ?? '1,2,3,4,6,9,14,24').split(',').map(Number);
const SPOT = process.env.BP_SPOT ?? 'transit_hall';
const PLATE = process.env.BP_PLATE === '1';
const ENEMY = process.env.BP_ENEMY ?? (PLATE ? 'brute' : 'trooper');
const DIR = process.env.BP_DIR ?? 'tools/out/coop/gore';
const CELL_W = Number(process.env.BP_CELL ?? 500);
const COLS = Number(process.env.BP_COLS ?? 4);
const CELL_H = CELL_W * 0.625;
const NO_PUFF = process.env.BP_PUFF === '0';

/** Runs in the page. */
function install({ cellW, cellH, enemyId, plate }) {
  const { ctx, game } = window.__op2;
  const glCanvas = ctx.render.renderer.domElement;
  ctx.waves.update = () => {};
  ctx.waves.start = () => {};

  let steps = 0;
  let enemy = null;
  let pin = null;
  let pinYaw = 0;
  const tick = ctx.time.tick;
  ctx.time.tick = function () {
    tick.call(this, steps > 0 ? 1 / 60 : 0);
    if (steps > 0) steps--;
    // It stands where it was put: a body that walks off between frames is a different shot each run.
    if (enemy && pin) { enemy.position.copy(pin); enemy.velocity.set(0, 0, 0); enemy.yaw = pinYaw; }
  };
  let onRendered = null;
  const render = ctx.render.render;
  ctx.render.render = function () {
    render.call(this);
    if (onRendered && steps === 0) {
      const f = onRendered;
      onRendered = null;
      f();
    }
  };
  const raf = () => new Promise(r => requestAnimationFrame(r));
  const step = async n => {
    steps = n;
    while (steps > 0) await raf();
    await new Promise(r => { onRendered = r; });
  };

  const V = ctx.player.eye.constructor;
  const sheet = document.createElement('canvas');
  const g = sheet.getContext('2d');
  const floorBelow = at => {
    const hit = { point: new V(), normal: new V(), distance: 0, surface: 'concrete', collider: null };
    return ctx.physics.raycastInto(new V(at.x, at.y + 1, at.z), new V(0, -1, 0), 30, 1, hit) ? hit.point.clone() : at.clone();
  };
  /** Live records in the blood ring (strands, mist and puffs). */
  const bloodAlive = () => ctx.fx.core.blood.ring.countLive(ctx.fx.core.bloodNow);

  window.__bp = {
    step,
    /** A fresh run, the gun in hand, one enemy standing `dist` metres down the view, the crosshair on its chest. */
    async stage(viewName, dist, gun) {
      enemy = pin = null;
      game.newRun();
      ctx.player.modifiers.invulnerable = true;
      await step(2);
      const view = ctx.world.spec.views[viewName] ?? Object.values(ctx.world.spec.views)[0];
      const [px, py, pz] = view.pos;
      const [lx, , lz] = view.look;
      const yaw = Math.atan2(-(lx - px), -(lz - pz));
      ctx.player.teleport(new V(px, py - 1.7, pz), yaw);
      ctx.player.yaw = yaw;
      ctx.player.pitch = 0;
      ctx.weapons.give(gun);
      ctx.weapons.switchTo(gun);
      ctx.weapons.refillMagazines();
      await step(50);
      const f = ctx.player.forward;
      const eye = ctx.player.eye;
      const at = floorBelow(new V(eye.x + f.x * dist, eye.y, eye.z + f.z * dist));
      enemy = ctx.enemies.spawn(enemyId, at);
      enemy.speedMul = 0;
      enemy.attacks = [];
      enemy.behaviours = [];
      // Enough health to live through any one trigger pull here, and no more: bleeding is a share of it.
      enemy.health = enemy.maxHealth = 3000;
      // Nor does a pellet in the face end him: the head and limb pools are out of reach for one pull.
      for (const region of [...enemy.limbHp.keys()]) enemy.limbHp.set(region, 1e6);
      pin = at.clone();
      pinYaw = Math.atan2(eye.x - at.x, eye.z - at.z);
      await step(30);
      const target = enemy.center.clone().add(new V(0, 0.12, 0));
      const to = target.sub(ctx.player.eye);
      ctx.player.yaw = Math.atan2(-to.x, -to.z);
      ctx.player.pitch = Math.atan2(to.y, Math.hypot(to.x, to.z));
      await step(4);
      return { enemy: enemy.id, health: enemy.health, range: enemy.center.distanceTo(ctx.player.eye) };
    },
    /**
     * Pulls the trigger and stops on the frame the round lands (frame 1), for the whole-screen still. The gun's own dice
     * are fixed by `seed`, so a shotgun's pattern is the same before and after.
     */
    async pullFirst(seed) {
      let a = seed >>> 0;
      Math.random = () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      const before = enemy.health;
      ctx.input.simulate('fire', true);
      let waited = 0;
      while (enemy.health === before && waited++ < 8) await step(1);
      ctx.input.simulate('fire', false);
      return waited;
    },
    /** Draws each frame in `frames` into the sheet, `cols` to a row; the first of them is already on screen (`pullFirst`). */
    async rest(frames, dist, label, cols) {
      sheet.width = cellW * cols;
      sheet.height = cellH * Math.ceil(frames.length / cols);
      g.fillStyle = '#000';
      g.fillRect(0, 0, sheet.width, sheet.height);
      g.font = '15px monospace';
      // The crop keeps the body about the same size on the sheet at either distance.
      const cw = Math.round(glCanvas.width * (dist >= 10 ? 0.2 : 0.62));
      const ch = cw * (cellH / cellW);
      const counts = [];
      // The screenshot before this was another frame of the browser's: draw this one again before reading it.
      await step(0);
      let done = 1;
      for (let i = 0; i < frames.length; i++) {
        if (frames[i] > done) await step(frames[i] - done);
        done = frames[i];
        const x = (i % cols) * cellW;
        const y = Math.floor(i / cols) * cellH;
        g.drawImage(glCanvas, (glCanvas.width - cw) / 2, (glCanvas.height - ch) / 2, cw, ch, x, y, cellW, cellH);
        g.fillStyle = '#fff';
        g.fillText(`${label} f${frames[i]}`, x + 6, y + 18);
        counts.push(bloodAlive());
      }
      return { sheet: sheet.toDataURL('image/png'), counts, health: enemy.maxHealth - enemy.health };
    },
  };
}

const save = (url, file) => writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));

export default async function shots(page, h) {
  for (let i = 0; i < 120; i++) {
    if (await page.evaluate(() => window.__op2?.game?.state === 'playing')) break;
    await h.sleep(1000);
  }
  await page.evaluate(install, { cellW: CELL_W, cellH: CELL_H, enemyId: ENEMY, plate: PLATE });
  // "Before" is this build with the puff left out: everything else on screen is the same code.
  // The record is never written, and the dice it would have rolled are rolled all the same, so the gun's pattern matches.
  if (NO_PUFF) await page.evaluate(() => { window.__op2.ctx.fx.core.blood.puff = () => { Math.random(); }; });
  mkdirSync(DIR, { recursive: true });
  const out = { tag: TAG, spot: SPOT, enemy: ENEMY, frames: FRAMES, rows: [] };
  for (const gun of GUNS) for (const dist of DISTS) {
    const staged = await page.evaluate(([spot, d, g]) => window.__bp.stage(spot, d, g), [SPOT, dist, gun]);
    const name = `puff-${TAG}-${gun}-${dist}m${PLATE ? '-plate' : ''}`;
    // The whole screen as the player sees it, HUD and all, on the frame of the hit: the clock is stopped, so it holds.
    await page.evaluate(seed => window.__bp.pullFirst(seed), 7 + GUNS.indexOf(gun) * 10 + DISTS.indexOf(dist));
    await page.screenshot({ path: join(DIR, `${name}-f1.png`), timeout: 120000 });
    const r = await page.evaluate(([f, d, label, cols]) => window.__bp.rest(f, d, label, cols), [FRAMES, dist, `${TAG} ${gun} ${dist} m`, COLS]);
    save(r.sheet, join(DIR, `${name}.png`));
    out.rows.push({ gun, dist, bloodAlive: r.counts, dealt: r.health });
    console.error(`[puff] ${name}: range ${staged.range.toFixed(2)} m, dealt ${r.health.toFixed(1)}, blood records ${r.counts.join(' ')}`);
  }
  writeFileSync(join(DIR, `puff-${TAG}${PLATE ? '-plate' : ''}.json`), JSON.stringify(out, null, 1));
  return out;
}
