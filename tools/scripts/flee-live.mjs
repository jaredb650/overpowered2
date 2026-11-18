// Broken men in Endless Humans, in real Chromium: one breaks (the dev panel's "Break nerve") and runs about the map without ever
// leaving it, then each cornered reaction is forced on a man in front of the player and photographed (outpost/flight.ts).
//
//   FLEE_CASES=run,surrender,cower,taunt,fight,fake,self node tools/shot.mjs --url "/?contract=outpost&autostart=1&dev=1" --port 5206 \
//     --dpr 2 --w 1440 --h 900 --script tools/scripts/flee-live.mjs --out tools/out/flee/flee.png --wait 500 --timeout 240
const cases = (process.env.FLEE_CASES ?? 'run,surrender,cower,taunt,fight,fake,self').split(',');

export default async function flee(page, h) {
  const out = {};
  const shot = name => h.shot(name).catch(e => console.error(`shot ${name} failed: ${e.message.split('\n')[0]}`));
  const until = async (test, ms = 60000, every = 100, arg = null) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (await page.evaluate(test, arg)) return true;
      await h.sleep(every);
    }
    return false;
  };
  out.playing = await until(() => window.__op2?.game?.state === 'playing', 90000, 500);
  await h.sleep(1500);
  out.setup = await page.evaluate(async () => {
    const { ctx } = window.__op2;
    const o = ctx.enemies.outpost;
    window.__ctx = ctx;
    window.__o = o;
    // The same module instance the game runs: Vite serves one URL per source file.
    window.__flight = await import('/src/enemies/outpost/flight.ts');
    ctx.player.maxHealth = ctx.player.health = 1e5;
    ctx.waves.update = () => {};
    for (const e of [...ctx.enemies.alive]) ctx.enemies.withdraw(e);
    window.__look = (x, y, z) => {
      const p = ctx.player;
      p.yaw = Math.atan2(-(x - p.position.x), -(z - p.position.z));
      p.pitch = Math.atan2(y - p.eye.y, Math.hypot(x - p.position.x, z - p.position.z));
    };
    window.__lookAt = (e, up = 1.2) => window.__look(e.position.x, e.position.y + up, e.position.z);
    // The spawn is boxed in by walls. Stand somewhere high and open instead, facing down its longest clear line.
    window.__vantage = (ground = false) => {
      const nav = ctx.world.nav, V = ctx.player.position.constructor;
      const from = new V(), dir = new V();
      let best = null;
      for (let i = 0; i < nav.nodeCount; i += 7) {
        if (ground && nav.py[i] > 0.3) continue;
        from.set(nav.px[i], nav.py[i] + 1.6, nav.pz[i]);
        let open = 0, far = 0, bearing = 0;
        for (let k = 0; k < 16; k++) {
          const a = (k / 16) * Math.PI * 2;
          dir.set(Math.sin(a), -0.04, Math.cos(a));
          const d = ctx.physics.raycast(from, dir, 45)?.distance ?? 45;
          open += d;
          if (d > far) { far = d; bearing = a; }
        }
        const score = open / 16 + (ground ? 0 : nav.py[i] * 1.5);
        if (!best || score > best.score) best = { score, x: nav.px[i], y: nav.py[i], z: nav.pz[i], bearing, far };
      }
      ctx.player.teleport(new V(best.x, best.y + 0.1, best.z), 0);
      window.__bearing = best.bearing;
      return best;
    };
    // One man of his own squad, `dz` metres ahead of the player down the vantage's open line, and `dx` to the side.
    window.__man = (dx, dz, grade = 'regular') => {
      const at = ctx.player.position.clone();
      const b = window.__bearing ?? Math.PI;
      at.x += Math.sin(b) * dz + Math.cos(b) * dx;
      at.z += Math.cos(b) * dz - Math.sin(b) * dx;
      ctx.world.nav.nearest(at, 4, at);
      o.formSquad(1, at);
      o.squads[o.squads.length - 1].grade = grade;
      const e = ctx.enemies.spawn('trooper', at);
      e.yaw = Math.atan2(ctx.player.position.x - at.x, ctx.player.position.z - at.z);
      return e;
    };
    window.__state = e => {
      const s = o.soldierOf(e);
      return s ? { alive: e.alive, fate: s.fate, corner: s.corner, fake: s.fake, surrendered: s.surrendered, weapon: s.weapon, morale: +s.morale.toFixed(1),
        at: e.position.toArray().map(v => +v.toFixed(1)), dist: +e.dist.toFixed(1), los: e.hasLos } : { alive: e.alive };
    };
    // A cornered reaction by name: the roll that lands in the middle of its share of the weights.
    window.__corner = (e, r) => {
      const F = window.__flight;
      const s = o.soldierOf(e);
      const w = F.cornerWeights(F.cornerFacts(o, s, false));
      let before = 0, total = 0;
      for (const x of F.REACTIONS) total += w[x];
      for (const x of F.REACTIONS) { if (x === r) break; before += w[x]; }
      if (!(w[r] > 0)) return { error: `${r} is not on the table`, w };
      return { picked: F.corner(o, s, false, (before + w[r] / 2) / total), w };
    };
    // Stand `d` metres from him wherever the line to his head is clear, and look at him.
    window.__face = (e, d = 4.5) => {
      const V = ctx.player.position.constructor, at = new V(), eye = new V(), head = e.position.clone();
      head.y += 1.4;
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        at.set(e.position.x + Math.sin(a) * d, e.position.y, e.position.z + Math.cos(a) * d);
        if (!ctx.world.nav.nearest(at, 1, at) || Math.abs(at.y - e.position.y) > 0.5) continue;
        eye.copy(at).y += 1.6;
        if (ctx.enemies.director.clearLine(eye, head)) {
          ctx.player.teleport(at.setY(at.y + 0.1), 0);
          window.__lookAt(e, 1);
          return true;
        }
      }
      return false;
    };
    window.__lines = [];
    ctx.events.on('comms:line', l => window.__lines.push(`${l.kind}: ${l.text}`));
    window.__clear = () => { for (const e of [...ctx.enemies.alive]) ctx.enemies.withdraw(e); };
    return { contract: ctx.contracts?.active?.id ?? null, soldiers: o.soldiers.length, vantage: window.__vantage() };
  });

  if (cases.includes('run')) {
    // Three men 20 m out. The panel's Break nerve, then one of them is followed while he runs.
    const men = await page.evaluate(() => [window.__man(-3, 20), window.__man(0, 21), window.__man(3, 20)].map((e, i) => (window[`__r${i}`] = e, i)));
    await h.sleep(1500);
    await page.keyboard.press('Backquote');
    await h.sleep(500);
    out.button = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent === 'Break nerve');
      b?.click();
      return !!b;
    });
    await page.keyboard.press('Backquote');
    await until(() => [0, 1, 2].some(k => window.__o.soldierOf(window[`__r${k}`])?.fate === 'flee'), 5000, 50);
    // A man can refuse to break (outcomes.ts); follow one who ran.
    await page.evaluate(() => { window.__r = [0, 1, 2].map(k => window[`__r${k}`]).find(e => window.__o.soldierOf(e)?.fate === 'flee'); });
    await page.evaluate(() => window.__ctx.camera.setZoom(40));
    const track = [];
    for (let i = 0; i < 24; i++) {
      await page.evaluate(() => window.__lookAt(window.__r, 1));
      if (i % 4 === 0) await shot(`run-${String(i / 4).padStart(2, '0')}`);
      track.push(await page.evaluate(() => [0, 1, 2].map(k => window.__state(window[`__r${k}`]))));
      await page.evaluate(() => (window.__track ??= []).push(window.__state(window.__r).at));
      await h.sleep(900);
    }
    await page.evaluate(() => window.__ctx.camera.setZoom(null));
    out.runLines = await page.evaluate(() => window.__lines.splice(0));
    out.run = {
      button: out.button,
      first: track[0], last: track.at(-1),
      everAlive: track.every(t => t.every(m => m.alive)),
      path: await page.evaluate(() => window.__track),
    };
    await page.evaluate(() => window.__clear());
    await h.sleep(800);
  }

  await page.evaluate(() => { window.__vantage(true); window.__ctx.camera.setZoom(38); });
  for (const r of ['surrender', 'cower', 'taunt', 'fight', 'fake', 'self']) {
    if (!cases.includes(r)) continue;
    const res = await page.evaluate(r => {
      const o = window.__o;
      const e = window.__man(0, 6, r === 'fight' ? 'veteran' : 'regular');
      window.__c = e;
      const s = o.soldierOf(e);
      s.grenades = Math.max(s.grenades, 1);
      if (r === 'taunt') e.health = e.maxHealth * 0.25;
      if (r === 'self') {
        o.captives.executed = 2;
      }
      o.collapse(s, 'flee');
      s.morale = 0;
      return true;
    }, r);
    await h.sleep(400);
    out[`${r}Faced`] = await page.evaluate(() => window.__face(window.__c, 6));
    await h.sleep(200);
    out[r] = await page.evaluate(r => window.__corner(window.__c, r), r);
    await page.evaluate(() => window.__lookAt(window.__c, 1));
    if (r === 'fake') {
      await h.sleep(1600);
      await page.evaluate(() => window.__lookAt(window.__c, 0.6));
      await shot('fake-kneel');
      // Walk in to take him: the hand goes to the vest.
      await page.evaluate(() => {
        const p = window.__ctx.player, e = window.__c;
        const at = p.position.clone().lerp(e.position, 1 - 3 / p.position.distanceTo(e.position));
        p.teleport(at.setY(e.position.y + 0.1), p.yaw);
        window.__lookAt(e, 0.6);
      });
      await until(() => window.__o.soldierOf(window.__c)?.fake === 'fumbling', 3000, 20);
      await page.evaluate(() => window.__lookAt(window.__c, 0.6));
      await h.sleep(250);
      await shot('fake-fumble');
      await until(() => window.__o.soldierOf(window.__c)?.fake === 'pinned', 3000, 20);
      await page.evaluate(() => window.__lookAt(window.__c, 0.6));
      await shot('fake-pin');
      out.fakeAfter = await page.evaluate(() => window.__state(window.__c));
      await h.sleep(2500);
    } else if (r === 'self') {
      await h.sleep(500);
      await shot('self-draw');
      await until(() => window.__o.soldierOf(window.__c)?.selfStage >= 2, 3000, 20);
      await h.sleep(450);
      await page.evaluate(() => window.__lookAt(window.__c, 1.3));
      await shot('self-temple');
      await until(() => !window.__c.alive, 4000, 20);
      await h.sleep(120);
      await shot('self-after');
      await h.sleep(1500);
      await page.evaluate(() => window.__lookAt(window.__c, 0.2));
      await shot('self-body');
    } else {
      for (let i = 0; i < 3; i++) {
        await h.sleep(r === 'fight' ? 900 : 700);
        await page.evaluate(() => window.__lookAt(window.__c, 1));
        await shot(`${r}-${i}`);
      }
    }
    out[`${r}State`] = await page.evaluate(() => window.__state(window.__c));
    out[`${r}Lines`] = await page.evaluate(() => window.__lines.splice(0));
    await page.evaluate(() => window.__clear());
    await page.evaluate(() => window.__vantage(true));
    await h.sleep(600);
  }
  return out;
}
