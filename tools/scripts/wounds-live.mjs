// Wounds with the real AI on the Kill House. A bot stands in the yard and puts one SMG round at a time into what it can see, at a
// random bone, through the real ray test, so the conditions, rescues and bleed-outs below come out of a real fight.
//
//   node tools/shot.mjs --url "/?map=killhouse&autostart=1&dev=1" --dpr 2 --w 1440 --h 900 --script tools/scripts/wounds-live.mjs --out tools/out/wounds-live.png --wait 500 --timeout 170
//
// Env: WOUND_SECONDS (default 70), WOUND_GAP seconds between rounds (default 0.7). Writes tools/out/wounds-live.json.
// Shots land next to --out: the first crawl, a drag, a mortal man firing, and a sidearm.
import { writeFileSync } from 'node:fs';

const seconds = Number(process.env.WOUND_SECONDS ?? 70);
const gap = Number(process.env.WOUND_GAP ?? 0.7);

export default async function live(page, h) {
  const started = Date.now();
  while (Date.now() - started < 90000) {
    if (await page.evaluate(() => window.__op2?.game?.state === 'playing')) break;
    await h.sleep(1000);
  }
  const boot = Math.round((Date.now() - started) / 1000);
  await page.evaluate(({ gap }) => {
    const { ctx } = window.__op2;
    const o = ctx.enemies.outpost;
    const p = ctx.player;
    p.maxHealth = p.health = 1e6;
    p.teleport(p.position.clone().set(0, 0.1, -19), 0);
    const V = p.position.constructor;
    const log = [], frames = [], clocks = [], crawled = new Map(), seen = {};
    const rec = (type, fn) => ctx.events.on(type, e => log.push({ t: +ctx.time.elapsed.toFixed(2), type, ...fn(e) }));
    rec('enemy:wounded', e => ({ uid: e.enemy.uid, zone: e.zone, label: e.label }));
    rec('enemy:condition', e => ({ uid: e.enemy.uid, condition: e.condition }));
    rec('enemy:killed', e => ({ uid: e.enemy.uid, id: e.enemy.id, gibbed: e.gibbed, headshot: e.headshot, source: e.damage.source }));
    rec('enemy:broken', e => ({ uid: e.enemy.uid, fate: e.fate }));
    rec('wave:start', e => e);
    rec('wave:clear', e => e);
    rec('comms:line', e => ({ kind: e.kind, text: e.text, who: e.speaker ?? e.squad }));
    let hurt = 0;
    ctx.events.on('player:damaged', e => { hurt += e.amount; });
    let clock = 0, last = performance.now();
    const hit = (e) => {
      const bones = e.char.bones;
      const b = bones[Math.floor(Math.random() * bones.length)];
      if (!b) return;
      const aim = new V().setFromMatrixPosition(b.matrixWorld);
      const dir = aim.clone().sub(p.eye).normalize();
      const r = ctx.enemies.raycast(p.eye, dir, 90);
      if (!r || r.enemy !== e) return;
      ctx.events.emit('weapon:fired', { weapon: 'smg', origin: p.eye.clone(), dir: dir.clone() });
      ctx.enemies.applyDamage(e, { amount: 25, type: 'bullet', point: r.point.clone(), dir, force: 0, source: 'smg', region: r.region, bone: r.bone, headshotMult: 2, severMult: 1 });
    };
    const tick = now => {
      requestAnimationFrame(tick);
      const dt = (now - last) / 1000;
      last = now;
      frames.push(dt * 1000);
      clock -= ctx.time.dt;
      for (const e of ctx.enemies.alive) {
        const s = o.soldierOf(e);
        if (!s) continue;
        const b = s.injuries;
        seen[b.condition] = (seen[b.condition] ?? 0) + 1;
        if (b.floored && !e.downed) {
          const c = crawled.get(e.uid) ?? { from: e.position.clone(), away0: e.position.distanceTo(p.position), far: 0 };
          c.far = Math.max(c.far, e.position.distanceTo(c.from));
          c.away1 = e.position.distanceTo(p.position);
          c.dragged = c.dragged || s.rescuer?.aidStage === 'drag';
          crawled.set(e.uid, c);
        }
      }
      if (clock > 0) return;
      clock = gap;
      let best = null, bestD = 60;
      for (const e of ctx.enemies.alive) {
        const s = o.soldierOf(e);
        // Leave the fallen alone: they are what is under test.
        if (!e.hasLos || e.dist >= bestD || s?.surrendered || s?.injuries.floored || s?.injuries.condition === 'mortal') continue;
        best = e;
        bestD = e.dist;
      }
      if (best) hit(best);
    };
    requestAnimationFrame(tick);
    window.__out = { log, frames, clocks, crawled, seen, hurt: () => hurt };
    window.__find = kind => {
      for (const e of ctx.enemies.alive) {
        const s = o.soldierOf(e);
        if (!s) continue;
        const b = s.injuries;
        const yes = kind === 'crawl' ? b.floored && s.crawling && !e.downed
          : kind === 'drag' ? s.rescuer?.aidStage === 'drag'
            : kind === 'mortal' ? b.condition === 'mortal'
              : kind === 'sidearm' ? s.weapon === 'sidearm' : false;
        if (!yes) continue;
        const d = e.center.clone().sub(p.eye);
        p.yaw = Math.atan2(-d.x, -d.z);
        p.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
        return true;
      }
      return false;
    };
  }, { gap });

  const wanted = new Set(['crawl', 'drag', 'mortal', 'sidearm']);
  const until = Date.now() + seconds * 1000;
  while (Date.now() < until) {
    await h.sleep(1500);
    for (const kind of wanted) {
      if (await page.evaluate(k => window.__find(k), kind)) {
        await h.sleep(150);
        await h.shot(`wounds-live-${kind}`).catch(() => {});
        wanted.delete(kind);
        break;
      }
    }
  }
  const out = await page.evaluate(() => {
    const o = window.__out;
    const sorted = [...o.frames].sort((a, b) => a - b);
    return {
      log: o.log, seen: o.seen, hurt: Math.round(o.hurt()),
      frames: { n: sorted.length, median: sorted[sorted.length >> 1], p95: sorted[Math.floor(sorted.length * 0.95)] },
      crawled: [...o.crawled.entries()].map(([uid, c]) => ({ uid, far: +c.far.toFixed(1), away0: +c.away0.toFixed(1), away1: +c.away1.toFixed(1), dragged: !!c.dragged })),
    };
  });
  writeFileSync('tools/out/wounds-live.json', JSON.stringify(out));
  const count = {};
  for (const l of out.log) {
    const k = l.type === 'enemy:condition' ? l.condition : l.type === 'enemy:wounded' ? l.label : l.type === 'comms:line' ? `say:${l.kind}` : l.type;
    count[k] = (count[k] ?? 0) + 1;
  }
  return { boot, count, seen: out.seen, crawled: out.crawled, frames: out.frames, hurt: out.hurt };
}
