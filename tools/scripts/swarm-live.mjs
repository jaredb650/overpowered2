// The Quiver, the Thresher and the new order on key 4, in the real game on the Test Range: real keys and a real trigger
// through pointer lock, real enemies, real projectiles. Reports what each step measured and takes stills of the lock
// markers, the salvo in the air and the Thresher mid-burst.
//
//   node tools/shot.mjs --url "/?map=range" --script tools/scripts/swarm-live.mjs --wait 500 --timeout 300 \
//     --dpr 2 --w 1440 --h 900 --out tools/out/swarm/live.png
//
// SWARM_ONLY=keys,paint,stack,heavy,tank,tap,thresher reruns named steps.
const only = (process.env.SWARM_ONLY ?? '').split(',').filter(Boolean);
const wants = step => only.length === 0 || only.includes(step);

export default async function swarmLive(page, h) {
  for (let i = 0; i < 180; i++) {
    if (await page.evaluate(() => !!window.__lab && window.__op2?.game?.state === 'playing')) break;
    await h.sleep(500);
  }
  await page.evaluate(() => {
    const { ctx } = window.__op2;
    window.frame = () => new Promise(r => requestAnimationFrame(r));
    window.world = async seconds => {
      const end = ctx.time.elapsed + seconds;
      while (ctx.time.elapsed < end) await window.frame();
    };
    window.wipe = async () => {
      ctx.enemies.reset();
      window.__lab.spawner.clearBodies();
      await window.frame();
    };
    /** Points the view at a world point. */
    window.aimAt = (x, y, z) => {
      const p = ctx.player;
      const dx = x - p.eye.x;
      const dy = y - p.eye.y;
      const dz = z - p.eye.z;
      p.yaw = Math.atan2(-dx, -dz);
      p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    };
    /** Stands the player back where the run started, looking down the range. */
    window.start = { at: ctx.player.position.clone(), yaw: ctx.player.yaw };
    window.home = () => {
      const p = ctx.player;
      p.teleport(window.start.at.clone().setY(window.start.at.y + 0.1), window.start.yaw);
      p.pitch = 0;
    };
    /** A point on the floor `d` metres down the range from the start. */
    window.ahead = d => {
      const y = window.start.yaw;
      return window.start.at.clone().add(new ctx.player.position.constructor(-Math.sin(y) * d, 0, -Math.cos(y) * d));
    };
    /** Frame times in ms while `fn` runs and for `seconds` after. */
    window.frames = async (seconds, fn) => {
      const times = [];
      let last = performance.now();
      let on = true;
      const tick = () => {
        const now = performance.now();
        times.push(now - last);
        last = now;
        if (on) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      await fn();
      await window.world(seconds);
      on = false;
      times.sort((a, b) => a - b);
      return { n: times.length, p50: +times[Math.floor(times.length / 2)].toFixed(1), max: +times[times.length - 1].toFixed(1) };
    };
    window.setSpawn = (id, ai = 'off') => {
      const lab = window.__lab;
      Object.assign(lab.settings, { spawn: id, ai, arsenal: false });
      lab.changed();
    };
  });
  const out = {};
  const key = async code => {
    await h.press(code, 60);
    await h.sleep(500);
    return page.evaluate(() => window.__op2.ctx.weapons.current);
  };
  const draw = id => page.evaluate(async w => {
    window.__lab.draw(w);
    await window.world(0.6);
  }, id);

  await page.mouse.click(400, 500);
  await h.sleep(500);

  if (wants('keys')) {
    await page.evaluate(() => {
      window.__lab.settings.arsenal = false;
      window.__lab.changed();
      window.__op2.ctx.weapons.reset();
    });
    await h.sleep(400);
    const seq = [];
    for (const code of ['Digit3', 'Digit3', 'Digit3', 'Digit2', 'Digit2', 'Digit4', 'Digit4']) {
      seq.push(`${code.replace('Digit', '')}:${await key(code)}`);
    }
    out.ownsAutocannonAtStart = await page.evaluate(() => window.__op2.ctx.weapons.owned.has('autocannon'));
    await page.evaluate(() => window.__op2.ctx.weapons.give('autocannon'));
    await h.sleep(300);
    seq.push(`4:${await key('Digit4')}`);
    seq.push(`4:${await key('Digit4')}`);
    out.keys = seq.join(' ');
    out.strip = await page.evaluate(() => [...document.querySelectorAll('.arm-strip .slot')].map(s =>
      `${s.querySelector('.slot-key')?.textContent}${s.classList.contains('active') ? '*' : ''}${[...s.querySelectorAll('.slot-pip')].map(p => (p.classList.contains('on') ? '#' : 'o')).join('')}`).join(' '));
    await h.shot('hud-keys');
  }

  // Five troopers in an arc, painted in one hold and hit by the salvo.
  if (wants('paint')) {
    const r = {};
    await page.evaluate(async () => {
      await window.wipe();
      window.home();
      window.setSpawn('trooper');
      await window.world(0.3);
      window.crew = [];
      const before = new Set(window.__op2.ctx.enemies.alive);
      window.__lab.swarm();
      await window.world(0.8);
      window.crew = window.__op2.ctx.enemies.alive.filter(e => !before.has(e));
      // Aim at the middle of the arc.
      const c = window.crew.reduce((a, e) => [a[0] + e.center.x, a[1] + e.center.y, a[2] + e.center.z], [0, 0, 0]).map(v => v / window.crew.length);
      window.aimAt(c[0], c[1], c[2]);
      await window.world(0.2);
    });
    r.placed = await page.evaluate(() => window.crew.length);
    r.current = await page.evaluate(() => window.__op2.ctx.weapons.current);
    await page.mouse.down();
    const marks = [];
    for (const ms of [120, 250, 250, 250, 250]) {
      await h.sleep(ms);
      marks.push(await page.evaluate(() => window.__op2.ctx.weapons.paint?.marks.length ?? -1));
      if (marks.length === 3) await h.shot('paint-two');
    }
    r.marksOverTime = marks.join(',');
    r.distinct = await page.evaluate(() => new Set(window.__op2.ctx.weapons.paint?.marks ?? []).size);
    r.lockBoxes = await page.evaluate(() => [...document.querySelectorAll('.lk-box')].filter(b => b.style.display !== 'none').length);
    r.label = await page.evaluate(() => document.querySelector('.lk-label')?.textContent);
    await h.shot('paint-full');
    const timing = page.evaluate(() => window.frames(1.2, async () => {}));
    await page.mouse.up();
    await h.sleep(260);
    await h.shot('salvo-air');
    await h.sleep(250);
    await h.shot('salvo-closing');
    r.frames = await timing;
    await page.evaluate(() => window.world(1.5));
    r.dead = await page.evaluate(() => window.crew.filter(e => !e.alive).length);
    r.mag = await page.evaluate(() => window.__op2.ctx.weapons.ammo('quiver').mag);
    await h.shot('salvo-after');
    out.paint = r;
  }

  // One target in view: all four marks stack on it.
  if (wants('stack') || wants('heavy')) {
    const r = {};
    r.juggernaut = await page.evaluate(async () => {
      const ctx = window.__op2.ctx;
      await window.wipe();
      window.home();
      window.setSpawn('juggernaut');
      await window.world(0.3);
      const at = window.ahead(22);
      const e = window.__lab.spawner.place('juggernaut', at, 'off');
      await window.world(0.6);
      window.target = e;
      window.aimAt(e.center.x, e.center.y, e.center.z);
      window.__lab.draw('quiver');
      ctx.weapons.ammo('quiver').mag = 4;
      await window.world(0.6);
      return { hp: Math.round(e.health), max: Math.round(e.maxHealth), armor: Math.round(e.armor ?? 0), boss: e.isBoss };
    });
    await page.mouse.down();
    await h.sleep(1000);
    r.marks = await page.evaluate(() => (window.__op2.ctx.weapons.paint?.marks ?? []).map(m => (m === window.target ? 'J' : '?')).join(''));
    r.count = await page.evaluate(() => document.querySelector('.lk-n')?.textContent);
    await h.shot('stack-juggernaut');
    await page.mouse.up();
    await page.evaluate(() => window.world(2.5));
    r.after = await page.evaluate(() => ({ hp: Math.round(window.target.health), alive: window.target.alive }));
    out.heavy = r;
  }

  // A tank: painted on its hull, and what the salvo takes off it.
  if (wants('tank')) {
    out.tank = await page.evaluate(async () => {
      const ctx = window.__op2.ctx;
      const v = ctx.enemies.vehicles;
      if (!v) return 'no vehicles here';
      await window.wipe();
      window.home();
      window.__lab.spawner.vehicle('tank', 'off');
      await window.world(3);
      const list = [];
      v.paintable(list);
      const tank = list[0];
      if (!tank) return 'no tank stood';
      window.aimAt(tank.center.x, tank.center.y + tank.aimLift, tank.center.z);
      window.__lab.draw('quiver');
      ctx.weapons.ammo('quiver').mag = 4;
      await window.world(0.6);
      window.tank = tank;
      return { health: Math.round(tank.health), at: Math.round(tank.center.distanceTo(ctx.player.eye)) };
    });
    if (typeof out.tank === 'object') {
      await page.mouse.down();
      await h.sleep(1000);
      out.tank.marks = await page.evaluate(() => (window.__op2.ctx.weapons.paint?.marks ?? []).filter(m => m === window.tank).length);
      await h.shot('stack-tank');
      await page.mouse.up();
      await page.evaluate(() => window.world(3));
      out.tank.after = await page.evaluate(() => ({ health: Math.round(window.tank.health), alive: window.tank.alive }));
    }
  }

  // A tap: four straight out in a loose spread.
  if (wants('tap')) {
    await page.evaluate(async () => {
      await window.wipe();
      window.home();
      window.__lab.draw('quiver');
      window.__op2.ctx.weapons.ammo('quiver').mag = 4;
      await window.world(0.6);
    });
    await h.click(30);
    await h.sleep(220);
    out.tap = await page.evaluate(() => {
      const list = window.__op2.ctx.combat.projectiles.active.filter(p => p.source === 'quiver');
      return { missiles: list.length, aimed: list.filter(p => p.target).length };
    });
    await h.sleep(150);
    await h.shot('tap');
  }

  if (wants('thresher')) {
    const r = await page.evaluate(async () => {
      const ctx = window.__op2.ctx;
      await window.wipe();
      window.home();
      window.setSpawn('trooper');
      await window.world(0.3);
      const at = window.ahead(9);
      const e = window.__lab.spawner.place('trooper', at, 'off');
      window.target = e;
      window.__lab.draw('thresher');
      await window.world(0.6);
      window.aimAt(e.center.x, e.center.y, e.center.z);
      return { pitch0: ctx.player.pitch };
    });
    const before = await page.evaluate(() => window.__op2.ctx.weapons.ammo('thresher').mag);
    await page.mouse.down();
    await h.sleep(230);
    await h.shot('thresher-burst');
    await h.sleep(770);
    await page.mouse.up();
    r.shots = before - (await page.evaluate(() => window.__op2.ctx.weapons.ammo('thresher').mag));
    r.climb = await page.evaluate(p0 => +(window.__op2.ctx.player.pitch - p0).toFixed(3), r.pitch0);
    r.target = await page.evaluate(() => ({ alive: window.target.alive, severed: [...(window.target.char?.severed ?? [])].length }));
    out.thresher = r;
  }
  return out;
}
