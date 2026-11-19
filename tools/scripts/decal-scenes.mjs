// The decal sheet's scenes, in the real game on a fixed 1/60 clock with seeded dice: the same kills every run, so two builds
// can be laid side by side. For each scene: a contact sheet over time from the player's eye, a full-size still from the eye and
// one from straight above.
//
//   DS_DIR=tools/out/<you>/scenes DS_TAG=new node tools/shot.mjs --port <yours> --url "/?autostart=1" --dpr 2 --w 1440 --h 900 \
//     --wait 500 --timeout 600 --quiet --script tools/scripts/decal-scenes.mjs --out tools/out/<you>/scenes/x.png
//
// Env: DS_SCENES (pistol,smg,shotgun,rocket,head,ten,sword,walk,prints; default the first seven), DS_DIR, DS_TAG (a prefix for the
// files: "old", "new"), DS_SPOT (a view preset of the map), DS_SEED.
// The scenes only use what both the old and the new sheet have, so the script runs unchanged on the build before the redraw.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SPOT = process.env.DS_SPOT ?? 'core_floor';
const SCENES = (process.env.DS_SCENES ?? 'pistol,smg,shotgun,rocket,head,ten,sword').split(',');
const DIR = process.env.DS_DIR ?? 'tools/out/decal-scenes';
const TAG = process.env.DS_TAG ?? 'ds';
const SEED = Number(process.env.DS_SEED ?? 7);

function install({ spot, seed }) {
  const { ctx, game } = window.__op2;
  const glCanvas = ctx.render.renderer.domElement;
  ctx.waves.update = () => {};
  ctx.waves.start = () => {};
  let steps = 0;
  const tick = ctx.time.tick;
  ctx.time.tick = function (dt) {
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
  const dice = s => {
    let a = s >>> 0;
    Math.random = () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  const V = ctx.player.eye.constructor;
  const hitOf = () => ({ point: new V(), normal: new V(), distance: 0, surface: 'concrete', collider: null });
  const ray = (o, d, max) => {
    const h = hitOf();
    return ctx.physics.raycastInto(o, d, max, 1, h) ? h : null;
  };
  const look = (eye, at) => {
    const d = at.clone().sub(eye);
    const yaw = Math.atan2(-d.x, -d.z);
    ctx.player.teleport(new V(eye.x, eye.y - 1.7, eye.z), yaw);
    ctx.player.yaw = yaw;
    ctx.player.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
  };
  const view = ctx.world.spec.views[spot];
  const origin = new V(...view.pos);
  /** The nearest broad flat wall from the spot, 3 to 14 m away. */
  const wall = () => {
    let best = null;
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * Math.PI * 2;
      const h = ray(origin, new V(Math.sin(a), 0, Math.cos(a)), 14);
      if (!h || h.distance < 3 || Math.abs(h.normal.y) > 0.1 || (best && h.distance >= best.distance)) continue;
      const n = h.normal.clone();
      const side = new V().crossVectors(n, new V(0, 1, 0)).normalize();
      const plane = n.dot(h.point);
      let flat = true;
      for (const [s, u] of [[1.5, 0], [-1.5, 0], [0, -1], [1.5, -1]]) {
        const o = h.point.clone().addScaledVector(n, 2).addScaledVector(side, s).add(new V(0, u, 0));
        const k = ray(o, n.clone().negate(), 3);
        if (!k || Math.abs(n.dot(k.point) - plane) > 0.05) flat = false;
      }
      if (flat) best = h;
    }
    return best;
  };
  ctx.render.viewScene.visible = false;
  const hud = document.getElementById('hud') ?? document.querySelector('.hud');
  if (hud) hud.style.display = 'none';
  const reset = async s => {
    game.newRun();
    ctx.player.modifiers.invulnerable = true;
    ctx.render.decals.clear();
    dice(s);
    await step(2);
  };
  const stand = (kind, at, yaw) => {
    const e = ctx.enemies.spawn(kind, at);
    e.speedMul = 0;
    e.attacks = [];
    e.behaviours = [];
    if (yaw !== undefined) e.yaw = yaw;
    return e;
  };
  const damage = (e, over) => ({ amount: 20, type: 'bullet', point: e.center.clone(), dir: new V(0, 0, -1), force: 0, source: 'rivet', ...over });
  const shoot = (e, dir, amount, source, type = 'bullet', force = 0, over = {}) => {
    if (!e || e.dead) return;
    const from = e.center.clone().addScaledVector(dir, -2);
    const hit = ctx.gore.raycastCharacter?.(e.char, from, dir, 4);
    ctx.enemies.applyDamage(e, damage(e, {
      amount, source, type, dir, force, point: hit ? hit.point.clone() : e.center.clone().addScaledVector(dir, -0.15),
      bone: hit?.bone, region: 'chest', ...over,
    }));
  };
  const blast = (e, dir, pellets = 9, amount = 22) => {
    for (let i = 0; i < pellets; i++) {
      const j = dir.clone().add(new V((Math.random() - 0.5) * 0.09, (Math.random() - 0.5) * 0.09, (Math.random() - 0.5) * 0.09)).normalize();
      if (e.dead) break;
      ctx.enemies.applyDamage(e, damage(e, {
        amount, source: 'shotgun', type: 'pellet', dir: j, force: 30,
        point: e.center.clone().add(new V((Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.25, 0)).addScaledVector(dir, -0.12), region: 'chest',
      }));
    }
  };

  /**
   * The stage: a man's spot `out` metres off the nearest flat wall, the shot going into the wall, the eye off to one side
   * `back` metres out. Returns the pieces a scene needs.
   */
  const stage = (out = 1.4, back = 4.2, sideways = 2.4) => {
    const w = wall();
    const n = w.normal.clone();
    const side = new V().crossVectors(n, new V(0, 1, 0)).normalize();
    const foot = w.point.clone().addScaledVector(n, out);
    foot.y = origin.y - 1.7;
    const into = n.clone().negate();
    const mid = w.point.clone().addScaledVector(n, out * 0.5);
    mid.y = foot.y + 0.7;
    const eye = foot.clone().addScaledVector(n, back - out).addScaledVector(side, sideways).add(new V(0, 1.7, 0));
    const above = foot.clone().addScaledVector(n, 0.4).add(new V(0, 6, 0));
    return {
      n, side, foot, into, yaw: Math.atan2(n.x, n.z),
      eye: () => look(eye, mid),
      top: () => look(above, foot.clone().addScaledVector(n, 0.4).addScaledVector(side, 0.001)),
    };
  };

  const scenes = {
    pistol(s) {
      const e = stand('husk', s.foot, s.yaw);
      e.health = 1e6;
      return { fire: () => shoot(e, s.into, 30, 'rivet'), men: [e] };
    },
    smg(s) {
      const e = stand('husk', s.foot, s.yaw);
      let n = 0;
      return { fire: () => {}, each: f => { while (n < 7 && f >= n * 4) { shoot(e, s.into.clone().add(new V(0, (n % 3 - 1) * 0.05, 0)).normalize(), 14, 'smg'); n++; } }, men: [e] };
    },
    shotgun(s) {
      const e = stand('husk', s.foot, s.yaw);
      return { fire: () => blast(e, s.into, 12, 26), men: [e] };
    },
    rocket(s) {
      const men = [0, 1, 2].map(i => stand('husk', s.foot.clone().addScaledVector(s.side, (i - 1) * 0.9).addScaledVector(s.n, 1.2 + (i % 2) * 0.5), s.yaw));
      return {
        fire: () => {
          const at = s.foot.clone().addScaledVector(s.n, 2.6);
          at.y += 0.2;
          ctx.combat.explode(at, { radius: 5, damage: 400, kind: 'rocket', source: 'rocket', team: 'player' });
        },
        men,
      };
    },
    head(s) {
      const foot = s.foot.clone().addScaledVector(s.n, -0.6);
      const e = stand('husk', foot, s.yaw);
      return {
        fire: () => {
          const headBone = e.char.rig.bones.findIndex(b => b.name === 'head');
          const at = e.char.bones[headBone >= 0 ? headBone : 0].getWorldPosition(new V());
          ctx.enemies.applyDamage(e, damage(e, { amount: 400, source: 'judge', dir: s.into, force: 40, point: at.addScaledVector(s.into, -0.08), bone: headBone >= 0 ? headBone : undefined, region: 'head' }));
        },
        men: [e],
      };
    },
    ten(s) {
      const men = [];
      let n = 0;
      return {
        fire: () => {},
        each: f => {
          // One every 20 frames: spawned where the last fell, shot the frame after.
          if (n < 10 && f >= n * 20) {
            const at = s.foot.clone().addScaledVector(s.side, ((n * 7) % 5 - 2) * 0.35).addScaledVector(s.n, ((n * 3) % 4) * 0.35);
            const e = stand('husk', at, s.yaw);
            men.push(e);
            const k = n % 4;
            if (k === 0) blast(e, s.into, 12, 26);
            else if (k === 1) for (let i = 0; i < 6; i++) shoot(e, s.into, 14, 'smg');
            else if (k === 2) shoot(e, s.into, 400, 'judge', 'bullet', 40);
            else ctx.combat.explode(at.clone().addScaledVector(s.n, 1.2).add(new V(0, 0.3, 0)), { radius: 4, damage: 300, kind: 'grenade', source: 'grenade', team: 'player' });
            n++;
          }
        },
        men,
      };
    },
    sword(s) {
      const men = [0, 1, 2].map(i => stand('husk', s.foot.clone().addScaledVector(s.side, (i - 1) * 1.1).addScaledVector(s.n, 0.8), s.yaw));
      let n = 0;
      return {
        fire: () => {},
        each: f => {
          if (n < 3 && f >= n * 14) {
            const e = men[n];
            const o = ctx.combat.strikeOptions('slash', 'katana');
            o.severMult = 1000;
            // Across the body, tilted: each cut on its own plane.
            o.slicePlaneNormal = new V(0.25 * (n - 1), 1, 0.1).normalize();
            const sweep = s.side.clone().multiplyScalar(n % 2 ? -1 : 1);
            const at = e.center.clone().add(new V(0, 0.1 * (n - 1), 0));
            ctx.combat.strike(e, at, s.into.clone().negate(), sweep.clone().multiplyScalar(0.7).add(s.into).normalize(), undefined, 'chest', 400, o);
            n++;
          }
        },
        men,
      };
    },
    // Someone walks out of a pool: a dozen prints, each fainter. The steps are given to the tracker as a walker's would be.
    prints(s) {
      const at = s.foot.clone().addScaledVector(s.n, 1.2).addScaledVector(s.side, -1.6);
      const walker = { left: 0, leftFoot: false };
      let n = 0;
      return {
        fire: () => { ctx.gore.blood.pool(at.clone().add(new V(0, 0.1, 0)), 1.6, 1.5); },
        each: f => {
          if (!ctx.gore.tracks || f < 30 || (f - 30) % 6 !== 0 || n >= 16) return;
          const along = 0.1 + n * 0.62;
          const foot = at.clone().addScaledVector(s.side, along).addScaledVector(s.n, n % 2 ? 0.11 : -0.11);
          ctx.gore.tracks.step(walker, foot.x, foot.y, foot.z, s.side.x, s.side.z);
          n++;
        },
        men: [],
        // Looking back down the track toward the pool, and from above the middle of it.
        eye: () => look(at.clone().addScaledVector(s.side, 6.2).addScaledVector(s.n, 0.9).add(new V(0, 1.7, 0)), at.clone().addScaledVector(s.side, 2.6)),
        top: () => look(at.clone().addScaledVector(s.side, 3.2).add(new V(0, 4.2, 0)), at.clone().addScaledVector(s.side, 3.2).addScaledVector(s.n, 0.001)),
      };
    },
    // A wounded man who keeps coming: his own legs carry him toward the player, and his wound leaves a trail.
    walk(s) {
      const from = s.foot.clone().addScaledVector(s.side, -5).addScaledVector(s.n, 2.5);
      const e = ctx.enemies.spawn('husk', from);
      e.attacks = [];
      e.health = 1e6;
      const toEye = new V();
      return {
        fire: () => {
          toEye.copy(ctx.player.position).sub(e.center).setY(0).normalize();
          shoot(e, toEye.clone().negate(), 30, 'rivet');
          shoot(e, toEye.clone().negate(), 30, 'rivet', 'bullet', 0, { region: 'abdomen' });
          e.health = 1e6;
        },
        each: () => { e.health = 1e6; },
        men: [e],
        top: () => look(from.clone().addScaledVector(s.side, 2.5).add(new V(0, 6.5, 0)), from.clone().addScaledVector(s.side, 2.5).addScaledVector(s.n, 0.001)),
      };
    },
  };

  const sheet = document.createElement('canvas');
  const g = sheet.getContext('2d');
  let live = null;
  let frame = 0;
  const advance = async to => {
    while (frame < to) {
      frame++;
      live.each?.(frame);
      await step(1);
    }
  };
  window.__ds = {
    /** Sets a scene up and runs it to `frames`, drawing each onto one row. Leaves the scene standing at the last frame. */
    async run(name, frames, cellW = 480) {
      await reset(seed);
      const s = stage(name === 'rocket' ? 2.2 : 1.4, name === 'rocket' || name === 'ten' ? 5 : 3.3, name === 'rocket' || name === 'ten' ? 2.4 : 1.7);
      live = { ...scenes[name](s), stage: s };
      frame = 0;
      (live.eye ?? s.eye)();
      await step(3);
      live.fire();
      const cellH = Math.round(cellW * 0.625);
      sheet.width = cellW * frames.length;
      sheet.height = cellH;
      g.fillStyle = '#000';
      g.fillRect(0, 0, sheet.width, sheet.height);
      g.font = '15px monospace';
      for (let c = 0; c < frames.length; c++) {
        await advance(frames[c]);
        g.drawImage(glCanvas, 0, 0, glCanvas.width, glCanvas.height, c * cellW, 0, cellW, cellH);
        g.fillStyle = '#fff';
        g.fillText(`${name} ${(frames[c] / 60).toFixed(2)}s`, c * cellW + 8, 18);
      }
      return sheet.toDataURL('image/png');
    },
    async view(which, hide = false) {
      for (const e of live.men) if (e.char?.root) e.char.root.visible = !hide;
      (live[which] ?? live.stage[which])();
      await step(1);
      return { decals: ctx.render.decals.total ?? ctx.render.decals.mesh.count, big: ctx.gore.blood?.bigLaid };
    },
  };
}

const save = (url, file) => writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
const FRAMES = {
  pistol: [3, 9, 15, 30, 60, 150], smg: [6, 15, 30, 45, 90, 240], shotgun: [3, 9, 15, 30, 90, 300], rocket: [3, 12, 24, 45, 90, 300],
  head: [3, 9, 15, 30, 90, 300], ten: [40, 80, 120, 160, 220, 480], sword: [6, 20, 34, 50, 120, 300], walk: [6, 40, 80, 120, 160, 210],
  prints: [30, 50, 70, 90, 110, 140],
};

export default async function run(page, h) {
  for (let i = 0; i < 120; i++) {
    if (await page.evaluate(() => window.__op2?.game?.state === 'playing')) break;
    await h.sleep(1000);
  }
  await page.evaluate(install, { spot: SPOT, seed: SEED });
  mkdirSync(DIR, { recursive: true });
  const out = {};
  for (const scene of SCENES) {
    const url = await page.evaluate(([s, f]) => window.__ds.run(s, f), [scene, FRAMES[scene]]);
    save(url, join(DIR, `${TAG}-${scene}-sheet.png`));
    await page.evaluate(() => window.__ds.view('eye'));
    await page.screenshot({ path: join(DIR, `${TAG}-${scene}-eye.png`) });
    out[scene] = await page.evaluate(() => window.__ds.view('top'));
    await page.screenshot({ path: join(DIR, `${TAG}-${scene}-top.png`) });
  }
  console.log(JSON.stringify(out));
  return out;
}
