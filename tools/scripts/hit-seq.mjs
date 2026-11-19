// What one hit does to a living enemy, from the player's eye, frame by frame: one contact sheet per case, with numbers.
// The look-check of the gore update's "react" lane (docs/notes/gore-update.md): every hit must read at a glance at 12 m.
//
//   HIT=smg:trooper:chest:12,shotgun:brute:armL:5 node tools/shot.mjs --port <yours> --url "/?map=range" \
//     --script tools/scripts/hit-seq.mjs --wait 500 --timeout 600 --dpr 2 --w 1440 --h 900 --out tools/out/<you>/hit.png
//
// A case is `weapon:enemy:region:metres[:option...]`. The weapon's real damage, force and type go through the real damage
// model (`ctx.enemies.applyDamage`), along the line from the player's eye to the struck bone. Options: `x3` three rounds at
// the weapon's own interval (`x0` holds fire to the end of the sheet), `p2` only two pellets of a shell land, `ai` leaves the
// enemy's AI on, `walk` has it patrol across the line of fire, `hp3` gives it three times its health (so held fire is seen),
// `back` shoots it from behind, `side` from its left, `oL` / `oR` land a trunk hit toward its left or right shoulder.
// HIT_SET=<name> runs a named list (SETS below) in place of HIT. HIT_LABEL=<text> goes into each file name (before/after).
// HIT_STILLS=4,10 also saves the whole screen at those frames. HIT_CROWD=<n> is the crowd case: n enemies with their AI on,
// 8 to 16 m off, and the SMG swept across them for 2 s.
//
// Sheets land next to --out as hit-<label>-<case>.png: tiles are the player's own view cropped round the enemy, at the true
// size on a 1440x900 Retina screen for 12 m and 25 m, and at half size for 5 m (HIT_ZOOM=2 doubles every tile). Frames are world frames (60 a second), stepped
// through the lab, so a loaded machine cannot change them; Math.random is seeded.
// The result's `peak` per case: degrees each part turned from where it was the frame before the hit, when that peaked, how
// far the head, hands and hips moved on screen in pixels (at 1440 wide), when the pose was back within a tenth of its peak,
// and `past`: how far it swung past rest the other way as a share of the peak (the wobble the flinch must not have).
import { mulberry32 } from './lib/steady.mjs';

const SETS = {
  // The brief's matrix, cut to what one run can hold: each weapon into the chest at each range on the Trooper, then each
  // region at 12 m, then the other bodies.
  ranges: ['rivet', 'smg', 'harrow', 'shotgun:p2'].flatMap(w => [5, 12, 25].map(d => { const [id, o] = w.split(':'); return `${id}:trooper:chest:${d}${o ? `:${o}` : ''}`; })),
  regions: ['chest:12:oL', 'chest:12:oR', 'chest', 'abdomen', 'armL', 'armR', 'forearmR', 'legL', 'legR', 'shinL', 'head'].map(r => `smg:trooper:${r.includes(':') ? r : `${r}:12`}`),
  bodies: ['trooper', 'gunner', 'brute', 'husk'].flatMap(e => ['chest', 'armL', 'legR'].map(r => `smg:${e}:${r}:12`)),
  weapons: ['rivet', 'smg', 'harrow', 'judge', 'shotgun:p2', 'shotgun'].map(w => { const [id, o] = w.split(':'); return `${id}:brute:chest:12${o ? `:${o}` : ''}`; }),
  held: ['smg:trooper:chest:12:x0:hp3', 'smg:brute:chest:12:x0', 'smg:husk:chest:12:x0:hp3', 'smg:trooper:armR:12:x0:hp3', 'smg:trooper:legL:12:x0:hp3'],
  short: ['smg:trooper:chest:12:oL', 'smg:trooper:armL:12', 'smg:trooper:legR:12', 'smg:brute:chest:12', 'rivet:trooper:chest:25', 'shotgun:trooper:chest:5:p2'],
};

/** HIT_FRAMES=0,2,4,8 picks the frames (and so a sheet narrow enough to be looked at pixel for pixel). */
const FRAMES = process.env.HIT_FRAMES ? process.env.HIT_FRAMES.split(',').map(Number) : [0, 1, 2, 3, 4, 6, 8, 10, 13, 16, 20, 25, 30, 38, 48, 60, 75, 90];
const COLUMNS = Math.min(9, FRAMES.length);
const TILE_W = 320;
const TILE_H = 400;
/** HIT_ZOOM=2 crops half as much and shows it twice the size: for looking closely, not for judging the read. */
const zoom = Number(process.env.HIT_ZOOM ?? 1);
const label = process.env.HIT_LABEL ?? 'now';
const stills = (process.env.HIT_STILLS ?? '').split(',').filter(Boolean).map(Number);
const crowd = Number(process.env.HIT_CROWD ?? 0);

export const before = async page => {
  await page.addInitScript(`Math.random = (${mulberry32})(${Number(process.env.HIT_SEED ?? 7)});`);
};

async function sheetOf(page, tiles, marks, file) {
  const context = await page.context().browser().newContext();
  const sheet = await context.newPage();
  const rows = Math.ceil(tiles.length / COLUMNS);
  await sheet.setViewportSize({ width: TILE_W * COLUMNS, height: TILE_H * rows });
  await sheet.setContent(`<body style="margin:0;background:#000;display:grid;grid-template-columns:repeat(${COLUMNS},${TILE_W}px);font:bold 17px sans-serif;color:#ff0">${tiles.map((t, i) =>
    `<div style="position:relative;width:${TILE_W}px;height:${TILE_H}px;overflow:hidden"><img src="data:image/jpeg;base64,${t}" style="width:100%;height:100%;object-fit:cover"><span style="position:absolute;left:8px;top:6px;text-shadow:0 0 4px #000">${marks[i]}</span></div>`).join('')}</body>`);
  await sheet.waitForTimeout(150);
  await sheet.screenshot({ path: file });
  await context.close();
}

export default async function hitSeq(page, h) {
  for (let i = 0; i < 240; i++) {
    if (await page.evaluate(() => !!window.__lab && window.__op2?.game?.state === 'playing')) break;
    await h.sleep(500);
  }
  await page.evaluate(() => {
    const lab = window.__lab;
    const { ctx } = window.__op2;
    const V = ctx.player.position.constructor;
    const Q = ctx.render.camera.quaternion.constructor;
    lab.settings.progression = false;
    lab.flags.progression = false;
    lab.settings.overlay = false;
    ctx.player.modifiers.invulnerable = true;
    ctx.render.viewScene.visible = false;
    const canvas = document.querySelector('canvas');
    for (const el of document.body.children) if (!el.contains(canvas)) el.style.visibility = 'hidden';
    for (const el of canvas.parentElement.children) if (el !== canvas) el.style.visibility = 'hidden';
    const frame = () => new Promise(r => requestAnimationFrame(r));
    const BONES = { hips: 0, spine: 1, chest: 2, neck: 3, head: 4, upperArmL: 5, foreArmL: 6, handL: 7, upperArmR: 8, foreArmR: 9, handR: 10, thighL: 11, shinL: 12, footL: 13, thighR: 14, shinR: 15, footR: 16 };
    const r = {
      V, target: null, others: [], log: [], rest: null, trace: [], fire: null, at: 0,
      async walk(frames) {
        lab.step(frames);
        while (lab.steps > 0) await frame();
        await frame();
      },
      look(t) {
        const d = new V().subVectors(t, ctx.player.eye);
        ctx.player.yaw = Math.atan2(-d.x, -d.z);
        ctx.player.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
      },
      async start(c) {
        ctx.enemies.killAll('lab');
        ctx.enemies.reset();
        lab.spawner.clearBodies();
        if (lab.paused) lab.togglePause();
        r.trace = [];
        r.fire = null;
        r.at = 0;
        ctx.player.teleport(new V(0, 0.1, 8 + c.metres / 2), 0);
        await frame();
        const at = new V(0, 0, 8 - c.metres / 2);
        const e = lab.spawner.place(c.enemy, at, c.ai ? 'on' : c.walk ? 'patrol' : 'off');
        if (!e) throw new Error(`no ${c.enemy}`);
        // Facing the player, as an enemy that is shooting at him does; `back` and `side` turn it.
        e.yaw = Math.atan2(ctx.player.position.x - at.x, ctx.player.position.z - at.z) + (c.back ? Math.PI : c.side ? -Math.PI / 2 : 0);
        if (c.hp > 1) e.health = e.maxHealth = e.maxHealth * c.hp;
        r.target = e;
        e.stagger = 0;
        r.look(new V(0, 1, at.z));
        lab.togglePause();
        await r.walk(c.walk ? 50 : 24);
        r.rest = r.pose();
      },
      /** Each bone's world rotation and where the head, hands, hips and shoulders are, in the world and on the screen. */
      pose() {
        const c = r.target.char;
        const cam = ctx.render.camera;
        const q = {};
        const p = {};
        const s = {};
        for (const [name, i] of Object.entries(BONES)) {
          const b = c.bones[i];
          if (!b) continue;
          q[name] = b.getWorldQuaternion(new Q());
          const w = new V().setFromMatrixPosition(b.matrixWorld);
          p[name] = w.clone();
          const n = w.project(cam);
          s[name] = { x: (n.x * 0.5 + 0.5) * innerWidth, y: (0.5 - n.y * 0.5) * innerHeight };
        }
        return { q, p, s };
      },
      record() {
        const e = r.target;
        const now = r.pose();
        const deg = {};
        const px = {};
        for (const name of Object.keys(now.q)) {
          deg[name] = +(now.q[name].angleTo(r.rest.q[name]) * 180 / Math.PI).toFixed(2);
          px[name] = { x: +(now.s[name].x - r.rest.s[name].x).toFixed(2), y: +(now.s[name].y - r.rest.s[name].y).toFixed(2) };
        }
        const gore = ctx.gore;
        r.trace.push({ f: r.at, deg, px, alive: e.alive, down: e.downed, stag: +e.stagger.toFixed(2), shock: +e.shock.toFixed(2), owned: !!gore.owned?.get(e.char), sway: gore.sways?.of?.(e.char)?.weight ?? null, ms: ctx.physics.stepMs });
      },
      /** One trigger pull: the weapon's rounds (a shell's pellets together) into the struck bone, along the line from the eye. */
      shoot(c) {
        const e = r.target;
        if (!e.alive) return;
        const w = c.def;
        const bone = e.char.rig.bones.findIndex(b => b.region === c.region);
        const at = new V().setFromMatrixPosition(e.char.bones[Math.max(bone, 0)].matrixWorld);
        // A little down the bone from its joint, where a round would land, and to the outside of the trunk on a chest hit.
        if (c.region === 'chest') at.y += 0.12;
        if (c.region === 'abdomen') at.y -= 0.02;
        if (/arm|leg|shin/.test(c.region)) at.y -= 0.12;
        const dir = new V().subVectors(at, ctx.player.eye).normalize();
        if (c.back || c.side) dir.set(0, 0, -1);
        const pellets = c.pellets ?? w.pellets;
        for (let i = 0; i < pellets; i++) {
          const point = at.clone();
          if (w.pellets > 1) point.add(new V((Math.random() - 0.5) * 0.24, (Math.random() - 0.5) * 0.3, 0));
          else if (c.oL || c.oR) point.addScaledVector(new V(Math.cos(e.yaw), 0, -Math.sin(e.yaw)), c.oL ? 0.13 : -0.13);
          r.log.push(ctx.enemies.applyDamage(e, { amount: w.damage, type: w.pellets > 1 ? 'pellet' : 'bullet', point, dir: dir.clone(), force: w.force, source: w.id, region: c.region, bone: bone >= 0 ? bone : undefined, severMult: w.severMult, headshotMult: w.headshotMult }).dealt);
        }
      },
      async advance(n, c) {
        for (let i = 0; i < n; i++) {
          const f = r.fire;
          if (f && f.left !== 0 && r.at >= f.next) {
            r.shoot(c);
            f.next = r.at + f.gap;
            f.left--;
          }
          await r.walk(1);
          r.at++;
          r.record();
        }
      },
      /** Where the enemy is on the screen: the middle of its trunk. */
      centre() {
        const e = r.target;
        const cam = ctx.render.camera;
        const hips = new V().setFromMatrixPosition(e.char.bones[0].matrixWorld);
        // The crop stays where the body stood, so what moves in the tile is the body.
        const n = new V(r.rest.p.hips.x, r.rest.p.hips.y, r.rest.p.hips.z).project(cam);
        return { x: (n.x * 0.5 + 0.5) * innerWidth, y: (0.5 - n.y * 0.5) * innerHeight, hipsY: hips.y };
      },
    };
    window.__r = r;
  });

  const weapons = await page.evaluate(async () => {
    const mod = await import('/src/weapons/data.ts');
    const out = {};
    for (const [id, w] of Object.entries(mod.WEAPONS)) out[id] = { id, damage: w.damage, force: w.force, pellets: w.pellets, interval: w.interval, severMult: w.severMult, headshotMult: w.headshotMult };
    return out;
  });

  const list = (process.env.HIT_SET ? SETS[process.env.HIT_SET] : (process.env.HIT ?? SETS.short.join(',')).split(',')).filter(Boolean);
  const results = {};
  const size = page.viewportSize();
  for (const text of list) {
    const [weapon, enemy, region, metres, ...opts] = text.split(':');
    const c = { weapon, enemy, region, metres: Number(metres), def: weapons[weapon] };
    if (!c.def) throw new Error(`no weapon ${weapon}`);
    let rounds = 1;
    for (const o of opts) {
      if (/^x\d+$/.test(o)) rounds = Number(o.slice(1));
      else if (/^p\d+$/.test(o)) c.pellets = Number(o.slice(1));
      else if (/^hp\d+$/.test(o)) c.hp = Number(o.slice(2));
      else c[o] = true;
    }
    await page.evaluate(c => window.__r.start(c), c);
    // The crop: true size at 12 m and beyond, half size up close.
    const scale = (c.metres < 8 ? 2 : 1) / zoom;
    const cw = (TILE_W / 2) * scale;
    const ch = (TILE_H / 2) * scale;
    const centre = await page.evaluate(() => window.__r.centre());
    const clip = { x: Math.max(0, Math.min(size.width - cw, centre.x - cw / 2)), y: Math.max(0, Math.min(size.height - ch, centre.y - ch * 0.5)), width: cw, height: ch };
    await page.evaluate(({ rounds, gap }) => { window.__r.fire = { left: rounds === 0 ? -1 : rounds, gap, next: 0 }; window.__r.record(); }, { rounds, gap: Math.max(1, Math.round(c.def.interval * 60)) });
    const tiles = [];
    const marks = [];
    let at = 0;
    for (const f of FRAMES) {
      // Frame 0 is the pose before the hit; the hit lands at the start of frame 1.
      if (f > at) await page.evaluate(({ n, c }) => window.__r.advance(n, c), { n: f - at, c });
      at = f;
      await h.sleep(40);
      tiles.push((await page.screenshot({ type: 'jpeg', quality: 80, clip })).toString('base64'));
      marks.push(`${f} · ${(f / 60).toFixed(2)} s`);
      if (stills.includes(f)) await page.screenshot({ path: `${h.outDir}/hit-${label}-${text.replaceAll(':', '-')}-f${f}.png` });
    }
    const trace = await page.evaluate(() => window.__r.trace.splice(0));
    const log = await page.evaluate(() => window.__r.log.splice(0));
    results[text] = { dealt: log, ...summarise(trace) };
    await sheetOf(page, tiles, marks, `${h.outDir}/hit-${label}-${text.replaceAll(':', '-')}.png`);
  }

  if (crowd > 0) results.crowd = await crowdCase(page, h, weapons.smg, size);
  return results;
}

/** Peak, time of peak, time back, and how far past rest it went, for the parts that carry the read. */
function summarise(t) {
  const out = { peak: {}, alive: t[t.length - 1].alive, down: t.some(p => p.down), owned: t.some(p => p.owned), sway: t.some(p => p.sway !== null), ms: +Math.max(...t.map(p => p.ms)).toFixed(2) };
  for (const part of ['chest', 'hips', 'head', 'upperArmL', 'foreArmL', 'handL', 'upperArmR', 'foreArmR', 'handR', 'thighL', 'shinL', 'thighR', 'shinR']) {
    if (t[0].deg[part] === undefined) continue;
    let peak = 0;
    let at = 0;
    for (const p of t) if (p.deg[part] > peak) { peak = p.deg[part]; at = p.f; }
    let back = -1;
    for (const p of t) if (p.f > at && p.deg[part] < Math.max(peak * 0.1, 0.5)) { back = p.f; break; }
    // On the screen: the furthest it got from where it was, and how far it came back past that point the other way.
    let far = 0;
    let fx = 0;
    let fy = 0;
    let farAt = 0;
    for (const p of t) {
      const d = Math.hypot(p.px[part].x, p.px[part].y);
      if (d > far) { far = d; fx = p.px[part].x / d; fy = p.px[part].y / d; farAt = p.f; }
    }
    let past = 0;
    for (const p of t) if (p.f > farAt) past = Math.min(past, p.px[part].x * fx + p.px[part].y * fy);
    out.peak[part] = `${peak.toFixed(1)}° at ${at}, back ${back}; ${far.toFixed(1)} px (${(fx * far).toFixed(0)},${(fy * far).toFixed(0)}) at ${farAt}, past ${far > 0.5 ? (-past / far).toFixed(2) : 0}`;
  }
  return out;
}

/** A crowd with its AI on under two seconds of swept SMG fire: the sheet, the worst physics step, and who ended where. */
async function crowdCase(page, h, smg, size) {
  await page.evaluate(async ({ n }) => {
    const r = window.__r;
    const lab = window.__lab;
    const { ctx } = window.__op2;
    const V = r.V;
    ctx.enemies.killAll('lab');
    ctx.enemies.reset();
    lab.spawner.clearBodies();
    if (lab.paused) lab.togglePause();
    ctx.player.teleport(new V(0, 0.1, 14), 0);
    await new Promise(q => requestAnimationFrame(q));
    r.others = [];
    for (let i = 0; i < n; i++) {
      const col = i % 6;
      const row = Math.floor(i / 6);
      const id = i % 5 === 4 ? 'brute' : i % 3 === 2 ? 'gunner' : 'trooper';
      const e = lab.spawner.place(id, new V((col - 2.5) * 1.5, 0, 4 - row * 2.6), 'on');
      if (e) { e.health = e.maxHealth = e.maxHealth * 3; r.others.push(e); }
    }
    r.look(new V(0, 1, 2));
    lab.togglePause();
    await r.walk(20);
  }, { n: crowd });
  const tiles = [];
  const marks = [];
  const steps = [];
  let worst = 0;
  const context = { n: 0 };
  for (let f = 0; f <= 150; f++) {
    const ms = await page.evaluate(async ({ f, smg }) => {
      const r = window.__r;
      const { ctx } = window.__op2;
      const V = r.V;
      // 800 rounds a minute, swept left to right and back across the front rank.
      if (f < 120 && f % 4 === 0) {
        const live = r.others.filter(e => e.alive);
        const e = live[Math.floor((f / 4) % Math.max(live.length, 1))];
        if (e) {
          const regions = ['chest', 'chest', 'abdomen', 'armL', 'armR', 'legL', 'legR'];
          const region = regions[(f / 4) % regions.length | 0];
          const bone = e.char.rig.bones.findIndex(b => b.region === region);
          const at = new V().setFromMatrixPosition(e.char.bones[Math.max(bone, 0)].matrixWorld);
          const dir = new V().subVectors(at, ctx.player.eye).normalize();
          ctx.enemies.applyDamage(e, { amount: smg.damage, type: 'bullet', point: at, dir, force: smg.force, source: 'smg', region, bone });
        }
      }
      await r.walk(1);
      return { ms: ctx.physics.stepMs, sways: ctx.gore.sways?.count ?? 0, owned: ctx.gore.owned?.size ?? 0 };
    }, { f, smg });
    worst = Math.max(worst, ms.ms);
    steps.push(ms);
    if (f % 9 === 0 && tiles.length < 18) {
      context.n++;
      tiles.push((await page.screenshot({ type: 'jpeg', quality: 78, clip: { x: size.width * 0.14, y: size.height * 0.2, width: size.width * 0.72, height: size.width * 0.72 * (TILE_H / TILE_W) } })).toString('base64'));
      marks.push(`${f} · ${(f / 60).toFixed(2)} s · chains ${ms.sways} · bodies ${ms.owned}`);
    }
  }
  await sheetOf(page, tiles, marks, `${h.outDir}/hit-${label}-crowd${crowd}.png`);
  const sorted = steps.map(s => s.ms).sort((a, b) => a - b);
  return { frames: steps.length, stepMs: { median: +sorted[sorted.length >> 1].toFixed(2), p90: +sorted[Math.floor(sorted.length * 0.9)].toFixed(2), max: +worst.toFixed(2) }, mostChains: Math.max(...steps.map(s => s.sways)), mostBodies: Math.max(...steps.map(s => s.owned)) };
}
