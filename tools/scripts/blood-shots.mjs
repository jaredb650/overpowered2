// Frame sequences of blood in the real game, on the real map, on a fixed 1/60 clock so a loaded machine
// cannot change what is on screen:
//
//   BS_SPOT=transit_hall BS_TAG=before node tools/shot.mjs --url "/?autostart=1" --dpr 2 --w 1440 --h 900 \
//     --wait 500 --timeout 240 --quiet --script tools/scripts/blood-shots.mjs
//
// Writes one contact sheet per distance: <tag>-<spot>-<dist>m.png, one row per effect.
//
// Env:
//   BS_SPOT=name       A view preset from the map spec. Comma list for several.
//   BS_TAG=before      Prefix of the sheets.
//   BS_DIST=3,15       Meters from the eye to the target.
//   BS_EFFECTS=a,b     Rows: hit, jet, sever, head, gib, mist, lens.
//   BS_FRAMES=1,3,..   Columns.
//   BS_DIR=path        Where the sheets go.
//   BS_PREVIEW=1       One frame per spot with its mean luminance, to find dark and bright places.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SPOTS = (process.env.BS_SPOT ?? 'tunnel').split(',');
const TAG = process.env.BS_TAG ?? 'x';
const DISTS = (process.env.BS_DIST ?? '3,15').split(',').map(Number);
const EFFECTS = (process.env.BS_EFFECTS ?? 'hit,jet,sever,head,gib').split(',');
const FRAMES = (process.env.BS_FRAMES ?? '1,3,6,12,24,60,120').split(',').map(Number);
const PREVIEW = process.env.BS_PREVIEW === '1';
const DIR = process.env.BS_DIR ?? 'tools/out/blood';
const CELL_W = 400;
const CELL_H = 250;

/** Runs in the page. */
function install({ cellW, cellH }) {
  const { ctx, game } = window.__op2;
  const glCanvas = ctx.render.renderer.domElement;
  ctx.waves.update = () => {};
  ctx.waves.start = () => {};

  let steps = 0;
  const tick = ctx.time.tick;
  ctx.time.tick = function () {
    tick.call(this, steps > 0 ? 1 / 60 : 0);
    if (steps > 0) steps--;
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
  const g = sheet.getContext('2d', { willReadFrequently: false });

  const place = (view, dist) => {
    const [px, py, pz] = view.pos;
    const [lx, , lz] = view.look;
    const yaw = Math.atan2(-(lx - px), -(lz - pz));
    ctx.player.teleport(new V(px, py - 1.7, pz), yaw);
    ctx.player.yaw = yaw;
    // Looks at chest height on the target whatever the distance.
    ctx.player.pitch = -Math.atan2(0.5, dist);
  };

  const floorBelow = at => {
    const hit = { point: new V(), normal: new V(), distance: 0, surface: 'concrete', collider: null };
    return ctx.physics.raycastInto(new V(at.x, at.y + 1, at.z), new V(0, -1, 0), 30, 1, hit) ? hit.point.clone() : at.clone();
  };

  // A fresh run, not killAll: a row of kills between shots starts streaks and red screen effects.
  const clearAll = async () => {
    game.newRun();
    ctx.player.modifiers.invulnerable = true;
    await step(2);
  };

  const fire = {
    hit: e => {
      const dir = e.center.clone().sub(ctx.player.eye).normalize();
      ctx.combat.fireRay(ctx.player.eye, dir, { damage: 1, source: 'smg', team: 'player', maxDistance: 80, tracer: 'bullet' });
    },
    sever: e => ctx.enemies.applyDamage(e, damageTo(e, { region: 'armL', severMult: 1000 })),
    head: e => ctx.enemies.applyDamage(e, damageTo(e, { amount: 500, region: 'head' })),
    gib: e => ctx.enemies.applyDamage(e, damageTo(e, { amount: 5000, gib: true, region: 'chest' })),
    jet: e => ctx.fx.bloodJet(e.center.clone(), new V(0.75, 0.45, 0.2).normalize(), 1),
    mist: e => ctx.fx.bloodMist(e.center.clone(), 1),
    lens: () => ctx.fx.lensBlood(1),
  };
  const damageTo = (e, extra) => ({
    amount: 1, type: 'bullet', point: e.center.clone(), dir: e.center.clone().sub(ctx.player.eye).normalize(), force: 0, source: 'smg', ...extra,
  });

  window.__bs = {
    async preview(views) {
      const out = [];
      const small = document.createElement('canvas');
      small.width = 320;
      small.height = 200;
      const s = small.getContext('2d', { willReadFrequently: true });
      for (const name of views) {
        const view = ctx.world.spec?.views?.[name];
        if (!view) continue;
        place(view, 3);
        await step(3);
        s.drawImage(glCanvas, 0, 0, 320, 200);
        const px = s.getImageData(0, 0, 320, 200).data;
        let sum = 0;
        for (let i = 0; i < px.length; i += 4) sum += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
        out.push({ name, luma: Math.round(sum / (px.length / 4)), image: small.toDataURL('image/jpeg', 0.8) });
      }
      return out;
    },

    async sequence(viewName, dist, effects, frames) {
      const view = ctx.world.spec.views[viewName];
      sheet.width = cellW * frames.length;
      sheet.height = cellH * effects.length;
      g.fillStyle = '#000';
      g.fillRect(0, 0, sheet.width, sheet.height);
      g.font = '14px monospace';
      // Far effects are small, so the crop tightens with distance.
      const cw = dist >= 10 ? 520 : 1280;
      const ch = cw * (cellH / cellW);
      for (let row = 0; row < effects.length; row++) {
        const name = effects[row];
        await clearAll();
        place(view, dist);
        await step(4);
        const f = ctx.player.forward;
        const eye = ctx.player.eye;
        const at = floorBelow(new V(eye.x + f.x * dist, eye.y, eye.z + f.z * dist));
        const e = ctx.enemies.spawn('husk', at);
        // Stands there. A lunge would put the husk between the camera and the effect.
        e.speedMul = 0;
        e.attacks = [];
        e.behaviours = [];
        await step(2);
        fire[name](e);
        let done = 0;
        for (let col = 0; col < frames.length; col++) {
          await step(frames[col] - done);
          done = frames[col];
          const full = name === 'lens';
          const sw = full ? glCanvas.width : cw;
          const sh = full ? glCanvas.height : ch;
          g.drawImage(glCanvas, (glCanvas.width - sw) / 2, (glCanvas.height - sh) / 2, sw, sh, col * cellW, row * cellH, cellW, cellH);
          g.fillStyle = '#fff';
          g.fillText(`${name} f${frames[col]}`, col * cellW + 6, row * cellH + 16);
        }
      }
      return sheet.toDataURL('image/png');
    },
  };
}

const saveDataUrl = (url, file) => writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));

export default async function shots(page, h) {
  for (let i = 0; i < 120; i++) {
    if (await page.evaluate(() => window.__op2?.game?.state === 'playing')) break;
    await h.sleep(1000);
  }
  await page.evaluate(install, { cellW: CELL_W, cellH: CELL_H });
  mkdirSync(DIR, { recursive: true });

  if (PREVIEW) {
    const list = await page.evaluate(v => window.__bs.preview(v), SPOTS);
    for (const p of list) saveDataUrl(p.image, join(DIR, `preview-${p.name}.jpg`));
    return list.map(p => ({ name: p.name, luma: p.luma }));
  }

  const files = [];
  for (const spot of SPOTS) {
    for (const dist of DISTS) {
      const url = await page.evaluate(([s, d, e, f]) => window.__bs.sequence(s, d, e, f), [spot, dist, EFFECTS, FRAMES]);
      const file = join(DIR, `${TAG}-${spot}-${dist}m.png`);
      saveDataUrl(url, file);
      files.push(file);
    }
  }
  return files;
}
