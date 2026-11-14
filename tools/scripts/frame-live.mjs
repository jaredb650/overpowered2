// The Distraint Frame on the Test Range: the cockpit walking, each gun, a jet, a stomp, a charge, a backhand, smoke; a
// stomp into a ring of men; the frame rate with 18 enemies fighting. FRAME_STEP=turn runs the turn check instead.
//   node tools/shot.mjs --url "/?map=range&frame=1" --script tools/scripts/frame-live.mjs --wait 500 --timeout 240 --dpr 2 --w 1440 --h 900 --out tools/out/frame/x.png
const STEP = process.env.FRAME_STEP ?? 'all';

export default async function frameLive(page, h) {
  for (let i = 0; i < 180; i++) {
    if (await page.evaluate(() => !!window.__lab && window.__op2?.game?.state === 'playing' && window.__op2.ctx.progression.frame?.occupied)) break;
    await h.sleep(500);
  }
  await page.evaluate(() => {
    const { ctx } = window.__op2;
    window.V = ctx.player.position.constructor;
    window.F = () => ctx.progression.frame;
    window.state = () => {
      const f = window.F();
      const w = f.walker;
      const g = f.guns;
      return {
        feet: w.feet.toArray().map(n => +n.toFixed(2)), speed: +w.speed.toFixed(2), grounded: w.grounded, legs: +w.legYaw.toFixed(3), view: +w.viewYaw.toFixed(3),
        fuel: +w.fuel.toFixed(2), charges: w.charges, heat: +g.rotary.heat.value.toFixed(2), mag: g.cannon.mag.ammo, round: g.cannon.round,
        pod: g.pod.ammo, marks: g.pod.painter.marks.length, smoke: g.smoke.count, alive: ctx.enemies.alive.length, fps: Math.round(window.__op2.game.fps),
        seated: document.querySelector('.hud')?.classList.contains('seated'), body: ctx.player.position.toArray().map(n => +n.toFixed(2)),
      };
    };
    window.ring = (n, r0, r1, ai) => {
      const f = window.F().walker.feet;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const r = r0 + ((i * 7) % n) / n * (r1 - r0);
        window.__lab.spawner.place(i % 5 === 4 ? 'gunner' : 'trooper', new window.V(f.x + Math.cos(a) * r, 0, f.z + Math.sin(a) * r), ai);
      }
    };
    // Puts the sight on a point, as the mouse would.
    window.aimAt = (x, y, z) => {
      const seat = ctx.progression.callInsManager.seats.seat;
      const e = seat.view.position;
      seat.yaw = Math.atan2(-(x - e.x), -(z - e.z));
      seat.pitch = Math.atan2(y - e.y, Math.hypot(x - e.x, z - e.z));
    };
    window.clear = () => {
      ctx.enemies.killAll('lab');
      window.__lab.spawner.clearBodies?.();
    };
  });
  const out = {};
  await page.mouse.click(300, 400);
  await h.sleep(400);
  out.start = await page.evaluate(() => window.state());

  if (STEP === 'turn') {
    // Sweep the mouse left hard for a second and see what the legs did.
    const legs0 = out.start.legs;
    for (let i = 0; i < 60; i++) {
      await h.mouseMove(-60, 0);
      await h.sleep(16);
    }
    out.turned = await page.evaluate(() => window.state());
    out.turnedBy = +(out.turned.legs - legs0).toFixed(3);
    out.viewOffLegs = +(out.turned.view - out.turned.legs).toFixed(3);
    await h.shot('turn');
    return out;
  }

  if (STEP === 'stomp') {
    // Three stomps from just over 4 m into twelve men within 10 m, each tough enough to live through it: who is down after?
    out.rounds = [];
    for (let round = 0; round < 3; round++) {
      await page.evaluate(() => {
        window.clear();
        window.ring(12, 2.5, 9.6, 'off');
        window.marked = window.__op2.ctx.enemies.alive.map(e => e.uid);
        for (const e of window.__op2.ctx.enemies.alive) e.health = e.maxHealth = 4000;
      });
      await h.sleep(800);
      await h.keyDown(' ');
      let top = 0;
      for (let i = 0; i < 60 && top < 4.2; i++) {
        await h.sleep(20);
        top = await page.evaluate(() => window.F().walker.clearance());
      }
      await h.keyUp(' ');
      await h.press('c', 40);
      await h.sleep(450);
      const count = () => page.evaluate(top => {
        const { ctx } = window.__op2;
        const f = window.F().walker.feet;
        const men = ctx.enemies.alive.filter(e => window.marked.includes(e.uid));
        const up = men.filter(e => !ctx.gore.downed(e.char)).map(e => `${Math.hypot(e.position.x - f.x, e.position.z - f.z).toFixed(1)}m fallIn ${(+e.fallIn || 0).toFixed(2)} rising ${(+e.rising || 0).toFixed(2)}`);
        return { from: +top.toFixed(2), men: men.length, down: men.filter(e => ctx.gore.downed(e.char)).length, dead: 12 - men.length, up };
      }, top);
      const early = await count();
      await h.sleep(500);
      out.rounds.push({ early, late: await count() });
      if (round === 0) await h.shot('stomp4');
      await h.sleep(3500);
    }
    return out;
  }

  // Men down the range to shoot at.
  await page.evaluate(() => {
    for (const [x, z] of [[-6, -6], [-2, -10], [3, -8], [8, -12], [-10, -14], [0, -18], [12, -4], [-14, -2]]) {
      window.__lab.spawner.place(x % 2 ? 'gunner' : 'trooper', new window.V(x, 0, z), 'off');
    }
  });
  await h.sleep(600);
  await h.shot('cockpit');

  // Walking: a shot mid-stride.
  await h.keyDown('w');
  await h.sleep(1600);
  await h.shot('walk');
  out.walking = await page.evaluate(() => window.state());
  await h.sleep(400);
  await page.evaluate(() => { window.__op2.ctx.progression.callInsManager.seats.seat.pitch = -0.9; });
  await h.sleep(500);
  await h.shot('feet');
  await h.keyUp('w');
  await page.evaluate(() => { window.__op2.ctx.progression.callInsManager.seats.seat.pitch = 0; });
  await h.sleep(800);

  // The rotary.
  await h.mouseMove(0, 40);
  await page.mouse.down();
  await h.sleep(1300);
  await h.shot('rotary');
  out.rotary = await page.evaluate(() => window.state());
  await page.mouse.up();
  await h.sleep(500);

  // The 40 mm, HE then AP.
  await page.mouse.down({ button: 'right' });
  await h.sleep(380);
  await h.shot('cannon');
  await h.sleep(500);
  await page.mouse.up({ button: 'right' });
  await h.press('r', 60);
  await h.sleep(200);
  await page.mouse.down({ button: 'right' });
  await h.sleep(250);
  await page.mouse.up({ button: 'right' });
  await h.sleep(300);
  out.cannon = await page.evaluate(() => window.state());

  // The pod: paint, then let go.
  await page.evaluate(() => {
    for (const [x, z] of [[-4, -22], [2, -24], [7, -20]]) window.__lab.spawner.place('trooper', new window.V(x, 0, z), 'off');
  });
  await page.evaluate(() => window.aimAt(2, 1.2, -22));
  await h.keyDown('g');
  await h.sleep(1100);
  await h.shot('paint');
  out.painting = await page.evaluate(() => window.state());
  await h.keyUp('g');
  await h.sleep(300);
  await h.shot('pod');
  await h.sleep(1500);
  out.pod = await page.evaluate(() => window.state());

  // A jet: up, a shot at the top, then the stomp on the way down.
  await page.evaluate(() => window.clear());
  await page.evaluate(() => {
    window.ring(12, 3, 9.6, 'off');
    // Tough enough to live through it, so what is counted is the knock and not the kill.
    for (const e of window.__op2.ctx.enemies.alive) e.health = e.maxHealth = 4000;
  });
  await h.sleep(500);
  await h.mouseMove(0, 140);
  await h.keyDown(' ');
  await h.sleep(900);
  await h.shot('jet');
  out.jet = await page.evaluate(() => window.state());
  await h.keyUp(' ');
  await h.press('c', 60);
  await h.sleep(260);
  await h.shot('stomp');
  await h.sleep(150);
  out.stomp = await page.evaluate(() => {
    const { ctx } = window.__op2;
    const f = window.F().walker.feet;
    let near = 0;
    let down = 0;
    for (const e of [...ctx.enemies.alive]) {
      if (Math.hypot(e.position.x - f.x, e.position.z - f.z) > 10) continue;
      near++;
      if (ctx.gore.downed(e.char)) down++;
    }
    return { ...window.state(), near, down };
  });
  await page.evaluate(() => {
    for (const e of window.__op2.ctx.enemies.alive) e.health = e.maxHealth = 100;
  });
  await h.sleep(800);

  // A charge into what is left.
  await page.evaluate(() => {
    const f = window.F().walker;
    const yaw = f.viewYaw;
    for (let i = 0; i < 4; i++) window.__lab.spawner.place('trooper', new window.V(f.feet.x - Math.sin(yaw) * (6 + i * 2) + (i % 2) * 1.2, 0, f.feet.z - Math.cos(yaw) * (6 + i * 2)), 'off');
  });
  await h.mouseMove(0, -100);
  await h.sleep(300);
  await h.press('Shift', 60);
  await h.sleep(250);
  await h.shot('charge');
  await h.sleep(700);
  out.charge = await page.evaluate(() => window.state());

  // A backhand and the smoke.
  await page.evaluate(() => {
    const f = window.F().walker;
    const yaw = f.viewYaw;
    for (const s of [-1, 0, 1]) window.__lab.spawner.place('trooper', new window.V(f.feet.x - Math.sin(yaw + s * 0.6) * 4, 0, f.feet.z - Math.cos(yaw + s * 0.6) * 4), 'off');
  });
  await h.sleep(300);
  await h.press('f', 60);
  await h.sleep(160);
  await h.shot('backhand');
  await h.sleep(600);
  await h.press('q', 60);
  await h.sleep(700);
  await h.shot('smoke');
  out.smoke = await page.evaluate(() => window.state());

  // 18 fighting, and the Frame walking and firing among them for 12 s.
  await page.evaluate(() => {
    window.clear();
    window.ring(18, 14, 24, 'on');
  });
  await h.sleep(1500);
  const fps = [];
  await h.keyDown('w');
  await page.mouse.down();
  for (let i = 0; i < 24; i++) {
    await h.mouseMove(18, 0);
    await h.sleep(500);
    fps.push(await page.evaluate(() => window.__op2.stats()));
    if (i === 8) await page.mouse.up();
  }
  await h.keyUp('w');
  out.fight = { fps: fps.map(s => s.fps), cpuMs: fps.map(s => s.cpuMs), draws: Math.max(...fps.map(s => s.drawCalls ?? 0)), tris: Math.max(...fps.map(s => s.triangles ?? 0)), alive: fps.at(-1)?.enemies };
  await h.shot('fight');
  out.end = await page.evaluate(() => window.state());
  return out;
}
