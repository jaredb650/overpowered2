// Blood that stays, in the real game on a fixed 1/60 clock: wall sprays behind a target for a pistol, a shotgun and a
// blast, runs down a wall, a pool under a body, drips from a wound. A man getting bloodier is gore-b-wet.mjs, in the models sandbox.
//
//   GB_SPOT=core_floor node tools/shot.mjs --port 5288 --url "/?autostart=1" --dpr 2 --w 1440 --h 900 \
//     --wait 500 --timeout 300 --quiet --script tools/scripts/gore-b.mjs
//
// Env: GB_SPOT (a view preset; core_floor has a lit block to spray at), GB_SCENES (spray,runs,pool,drips; bench returns
// frame times of a busy wave with the new blood on, off and on again), GB_DIR (tools/out/gore-b), GB_TAG.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SPOT = process.env.GB_SPOT ?? 'core_floor';
const SCENES = (process.env.GB_SCENES ?? 'spray,runs,pool,drips').split(',');
const DIR = process.env.GB_DIR ?? 'tools/out/gore-b';
const TAG = process.env.GB_TAG ?? 'gb';

function install({ spot }) {
  const { ctx, game } = window.__op2;
  const glCanvas = ctx.render.renderer.domElement;
  ctx.waves.update = () => {};
  ctx.waves.start = () => {};
  let steps = 0;
  let free = false;
  const tick = ctx.time.tick;
  ctx.time.tick = function (dt) {
    tick.call(this, free ? dt : steps > 0 ? 1 / 60 : 0);
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
  const hitOf = () => ({ point: new V(), normal: new V(), distance: 0, surface: 'concrete', collider: null });
  const ray = (o, d, max) => {
    const h = hitOf();
    return ctx.physics.raycastInto(o, d, max, 1, h) ? h : null;
  };
  /** Puts the eye at `eye` looking at `at`. */
  const look = (eye, at) => {
    const d = at.clone().sub(eye);
    const yaw = Math.atan2(-d.x, -d.z);
    ctx.player.teleport(new V(eye.x, eye.y - 1.7, eye.z), yaw);
    ctx.player.yaw = yaw;
    ctx.player.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
  };
  const view = ctx.world.spec.views[spot];
  const origin = new V(...view.pos);
  /** The nearest broad flat wall from the spot, 3 to 14 m away, with room in front of it for the camera. */
  const wall = () => {
    let best = null;
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * Math.PI * 2;
      const h = ray(origin, new V(Math.sin(a), 0, Math.cos(a)), 14);
      if (!h || h.distance < 3 || Math.abs(h.normal.y) > 0.1 || (best && h.distance >= best.distance)) continue;
      const n = h.normal.clone();
      const side = new V().crossVectors(n, new V(0, 1, 0)).normalize();
      // The same plane 1.5 m either side and a metre down, seen from 2 m out.
      const plane = n.dot(h.point);
      let flat = true;
      for (const [s, u] of [[1.5, 0], [-1.5, 0], [0, -1], [1.5, -1]]) {
        const o = h.point.clone().addScaledVector(n, 2).addScaledVector(side, s).add(new V(0, u, 0));
        const k = ray(o, n.clone().negate(), 3);
        if (!k || Math.abs(n.dot(k.point) - plane) > 0.05) flat = false;
      }
      const eye = h.point.clone().addScaledVector(n, 4.4).addScaledVector(side, 2.6);
      const clear = ray(h.point.clone().addScaledVector(n, 0.3), eye.clone().sub(h.point).normalize(), 5);
      if (flat && !clear) best = h;
    }
    return best;
  };
  ctx.render.viewScene.visible = false;
  const floorY = at => ray(at.clone().add(new V(0, 1, 0)), new V(0, -1, 0), 4)?.point.y ?? at.y;
  const clearAll = async () => {
    game.newRun();
    ctx.player.modifiers.invulnerable = true;
    ctx.render.decals.clear();
    await step(2);
  };
  const stand = (kind, at) => {
    const e = ctx.enemies.spawn(kind, at);
    e.speedMul = 0;
    e.attacks = [];
    e.behaviours = [];
    return e;
  };
  const damage = (e, over) => ({
    amount: 20, type: 'bullet', point: e.center.clone(), dir: new V(0, 0, -1), force: 0, source: 'rivet', ...over,
  });
  const sheet = document.createElement('canvas');
  const g = sheet.getContext('2d');
  /** One row per run of `fire`, one column per frame in `frames`, each a crop of `crop` px wide round the centre. */
  const capture = async (rows, frames, { cellW = 360, crop = 1500 } = {}) => {
    const cellH = Math.round(cellW * 0.625);
    sheet.width = cellW * frames.length;
    sheet.height = cellH * rows.length;
    g.fillStyle = '#000';
    g.fillRect(0, 0, sheet.width, sheet.height);
    g.font = '13px monospace';
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      await clearAll();
      await row.setup();
      await step(3);
      row.fire?.();
      let done = 0;
      for (let c = 0; c < frames.length; c++) {
        await step(Math.max(frames[c] - done, 1));
        done = frames[c];
        await row.each?.(c);
        const cw = Math.min(crop, glCanvas.width);
        const ch = cw * (cellH / cellW);
        g.drawImage(glCanvas, (glCanvas.width - cw) / 2, (glCanvas.height - ch) / 2, cw, ch, c * cellW, r * cellH, cellW, cellH);
        g.fillStyle = '#fff';
        g.fillText(`${row.name} ${(frames[c] / 60).toFixed(2)}s`, c * cellW + 6, r * cellH + 15);
      }
    }
    return sheet.toDataURL('image/png');
  };
  /** A man 1.3 m out from a wall, the camera off to one side of the line the round takes through him into it. */
  const sprayRow = (name, fire) => {
    let e = null;
    return {
      name,
      async setup() {
        const w = wall();
        const n = w.normal.clone();
        const side = new V().crossVectors(n, new V(0, 1, 0)).normalize();
        const foot = w.point.clone().addScaledVector(n, 1.3);
        foot.y = origin.y - 1.7;
        e = stand('husk', foot);
        this.e = e;
        e.yaw = Math.atan2(n.x, n.z);
        await step(2);
        const at = w.point.clone();
        at.y = foot.y + 1.15;
        look(at.clone().addScaledVector(n, 3.2).addScaledVector(side, 2.2).add(new V(0, 0.3, 0)), at.clone().addScaledVector(side, 0.35).add(new V(0, -0.2, 0)));
        this.n = n;
      },
      fire() { fire(e, this.n.clone().negate()); },
      // The last frame without the body, to see the whole mark.
      async each(c) { if (c === 5) { e.char.root.visible = false; await step(1); } },
    };
  };
  const shoot = (e, dir, amount, source, type = 'bullet', force = 0) => {
    ctx.enemies.applyDamage(e, damage(e, { amount, source, type, dir, force, point: e.center.clone().addScaledVector(dir, -0.15), region: 'chest' }));
  };

  window.__gb = {
    /**
     * A busy wave on the real clock: 24 husks round the player, a round into one every frame (SMG, a shotgun blast every
     * 10th, a grenade every 90th), kills replaced. Frame intervals and render time, with the new blood on and then off.
     */
    async bench() {
      const out = {};
      let mine = 0;
      const fx = ctx.fx;
      const keep = { spray: fx.bloodSpray, drip: fx.bloodDrip, run: ctx.render.decals.run };
      for (const mode of ['on', 'off', 'on2']) {
        await clearAll();
        if (mode === 'off') { fx.bloodSpray = () => {}; fx.bloodDrip = () => {}; ctx.render.decals.run = () => {}; }
        else {
          // Timed: what the new blood costs on the CPU, the field's own update included.
          const time = f => function (...a) { const t = performance.now(); const r = f.apply(this, a); mine += performance.now() - t; return r; };
          fx.bloodSpray = time(keep.spray);
          fx.bloodDrip = time(keep.drip);
          ctx.render.decals.run = time(keep.run);
          const field = ctx.gore.blood;
          if (!field.__timed) { field.__timed = true; field.update = time(field.update); }
        }
        mine = 0;
        const f = origin.clone();
        f.y -= 1.7;
        look(origin.clone(), origin.clone().add(new V(0, -0.3, -5)));
        const men = [];
        const spawn = i => {
          const a = (i / 24) * Math.PI - Math.PI / 2;
          const e = stand('husk', f.clone().add(new V(Math.sin(a) * (4 + (i % 3) * 2), 0, -Math.cos(a) * (4 + (i % 3) * 2) - 2)));
          return e;
        };
        for (let i = 0; i < 24; i++) men.push(spawn(i));
        await step(5);
        free = true;
        const times = [];
        let renderMs = 0;
        let frames = 0;
        const r = ctx.render.render;
        ctx.render.render = function () { const t = performance.now(); r.call(this); renderMs += performance.now() - t; };
        let last = performance.now();
        const end = last + 15000;
        let n = 0;
        while (performance.now() < end) {
          await raf();
          const now = performance.now();
          times.push(now - last);
          last = now;
          frames++;
          n++;
          const i = n % men.length;
          let e = men[i];
          if (!e || !e.alive) { e = men[i] = spawn(i); continue; }
          const dir = e.center.clone().sub(ctx.player.eye).normalize();
          if (n % 90 === 0) ctx.combat.explode(e.center.clone().add(new V(0, -1, 0)), { radius: 4, damage: 60, kind: 'grenade', source: 'grenade', team: 'player' });
          else if (n % 10 === 0) {
            for (let k = 0; k < 9; k++) ctx.enemies.applyDamage(e, damage(e, { amount: 20, type: 'pellet', source: 'shotgun', force: 30, dir, region: 'chest' }));
          } else ctx.combat.fireRay(ctx.player.eye, dir, { damage: 25, source: 'smg', team: 'player', maxDistance: 80, tracer: 'bullet' });
        }
        ctx.render.render = r;
        free = false;
        times.sort((a, b) => a - b);
        const mean = times.reduce((a, b) => a + b, 0) / times.length;
        out[mode] = {
          frames, meanMs: +mean.toFixed(2), p50: +times[Math.floor(times.length * 0.5)].toFixed(1), p95: +times[Math.floor(times.length * 0.95)].toFixed(1),
          p99: +times[Math.floor(times.length * 0.99)].toFixed(1), renderMs: +(renderMs / frames).toFixed(2),
          bloodCpuMs: +(mine / frames).toFixed(3), decals: ctx.render.decals.mesh.count, particles: fx.stats?.().particles, dripped: ctx.gore.blood?.dripped, bleeding: ctx.gore.blood?.bleeding,
        };
      }
      return out;
    },
    async spray() {
      return capture([
        sprayRow('pistol', (e, d) => shoot(e, d, 30, 'rivet')),
        sprayRow('shotgun', (e, d) => {
          for (let i = 0; i < 9; i++) {
            const j = d.clone().add(new V((Math.random() - 0.5) * 0.08, (Math.random() - 0.5) * 0.08, (Math.random() - 0.5) * 0.08)).normalize();
            ctx.enemies.applyDamage(e, damage(e, { amount: 20, source: 'shotgun', type: 'pellet', dir: j, force: 30,
              point: e.center.clone().add(new V((Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.25, 0)), region: 'chest' }));
          }
        }),
        sprayRow('blast', (e, d) => {
          const at = e.center.clone().addScaledVector(d, -1.4);
          at.y -= 0.6;
          ctx.combat.explode(at, { radius: 4, damage: 60, kind: 'grenade', source: 'grenade', team: 'player' });
        }),
      ], [2, 8, 20, 45, 90, 91], { crop: 560 });
    },
    async runs() {
      return capture([{
        name: 'runs',
        async setup() {
          const w = wall();
          const n = w.normal.clone();
          const at = w.point.clone();
          at.y = origin.y - 0.3;
          look(at.clone().addScaledVector(n, 2.2).add(new V(0, -0.2, 0)), at.clone().add(new V(0, -0.45, 0)));
          this.from = at.clone().addScaledVector(n, 1);
          this.dir = n.clone().negate();
        },
        fire() {
          ctx.fx.bloodSpray(this.from, this.dir, 0.9);
          ctx.fx.bloodSpray(this.from.clone().add(new V(0.5, 0.3, 0)), this.dir, 0.6);
        },
      }], [6, 20, 40, 70, 110, 180], { crop: 520 });
    },
    async pool() {
      let e = null;
      return capture([{
        name: 'pool',
        async setup() {
          const f = origin.clone();
          f.y -= 1.7;
          e = stand('husk', f.clone().add(new V(0, 0, -3)));
          await step(2);
        },
        fire() { ctx.enemies.applyDamage(e, damage(e, { amount: 400, source: 'judge', dir: new V(0.3, 0, -1).normalize(), force: 40, region: 'chest' })); },
        // Once he is down, from above and to one side of where he lies.
        async each(c) {
          if (c !== 0) return;
          const at = e.char.bones[0].getWorldPosition(new V());
          at.y = floorY(at);
          look(at.clone().add(new V(1.3, 1.9, 1.3)), at);
          await step(1);
        },
      }], [60, 120, 240, 360, 540, 900], { crop: 900 });
    },
    async drips() {
      let e = null;
      return capture([{
        name: 'drips',
        async setup() {
          const f = origin.clone();
          f.y -= 1.7;
          e = stand('husk', f.clone().add(new V(0, 0, -3)));
          e.health = 1e6;
          await step(2);
          const at = e.char.root.position.clone();
          const facing = new V(Math.sin(e.yaw), 0, Math.cos(e.yaw));
          const side = new V(facing.z, 0, -facing.x);
          this.front = facing;
          look(at.clone().addScaledVector(facing, 1.3).addScaledVector(side, 0.9).add(new V(0, 0.9, 0)), at.clone().addScaledVector(facing, 0.25).add(new V(0, 0.55, 0)));
        },
        fire() {
          for (const y of [1.25, 1.05, 0.85]) {
            const root = e.char.root.position;
            const p = root.clone().add(new V(0, y, 0)).addScaledVector(this.front, 2);
            const dir = this.front.clone().negate();
            const hit = ctx.gore.raycastCharacter(e.char, p, dir, 4);
            if (hit) ctx.enemies.applyDamage(e, damage(e, { amount: 70, source: 'judge', dir, point: hit.point.clone(), bone: hit.bone }));
          }
          e.health = 1e6;
        },
      }], [20, 40, 60, 90, 150, 300], { crop: 760 });
    },
  };
}

const save = (url, file) => writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));

export default async function run(page, h) {
  for (let i = 0; i < 120; i++) {
    if (await page.evaluate(() => window.__op2?.game?.state === 'playing')) break;
    await h.sleep(1000);
  }
  await page.evaluate(install, { spot: SPOT });
  mkdirSync(DIR, { recursive: true });
  const files = [];
  for (const scene of SCENES) {
    const url = await page.evaluate(s => window.__gb[s](), scene);
    const file = join(DIR, `${TAG}-${scene}.png`);
    if (typeof url === "string" && url.startsWith("data:")) save(url, file); else console.log(JSON.stringify(url));
    files.push(file);
  }
  return files;
}
