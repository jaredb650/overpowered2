// A real fight for the small batch: a bot with real weapons through real input, shotgun, rocket, autocannon and thrown grenades at whatever it can see.
//   node tools/shot.mjs --url "/?autostart=1" --script tools/scripts/batch-fight.mjs --dpr 2 --w 1440 --h 900 --wait 500 --timeout 120 --out tools/out/fight-swarm.png
//   node tools/shot.mjs --url "/?map=killhouse&autostart=1&dev=1" --script tools/scripts/batch-fight.mjs --dpr 2 --w 1440 --h 900 --wait 500 --timeout 120 --out tools/out/fight-house.png
// FIGHT_SECONDS sets the length. Reports the outcome of every blast roll, kills by kind, knockdowns, and frame times. Mid-fight stills land next to --out.
const seconds = Number(process.env.FIGHT_SECONDS ?? 50);

export default async function fight(page, h) {
  const started = Date.now();
  while (Date.now() - started < 60000) {
    if (await page.evaluate(() => window.__op2?.game?.state === 'playing')) break;
    await h.sleep(500);
  }
  await page.evaluate(() => {
    const { ctx } = window.__op2;
    const p = ctx.player;
    p.maxHealth = p.health = 1e6;
    for (const id of ['shotgun', 'rocket', 'autocannon']) if (!ctx.weapons.owned.has(id)) ctx.weapons.give(id);
    const log = { rolls: {}, kills: 0, gibs: 0, heads: 0, downed: 0, rose: 0, severed: 0, waist: 0, fired: {}, frames: [], peakKnock: 0, peakRags: 0, peakStep: 0 };
    window.fightLog = log;
    const model = ctx.enemies.model;
    const rolled = model.rolled;
    model.rolled = function (e, d, a) {
      const r = rolled.call(this, e, d, a);
      if (r) log.rolls[r.outcome] = (log.rolls[r.outcome] ?? 0) + 1;
      return r;
    };
    ctx.events.on('enemy:killed', e => { log.kills++; if (e.gibbed) log.gibs++; if (e.headshot) log.heads++; });
    ctx.events.on('enemy:severed', e => { log.severed++; if (e.region === 'abdomen') log.waist++; });
    const was = new Map();
    const guns = ['shotgun', 'rocket', 'autocannon', 'shotgun'];
    let gun = 0, clock = 0, pin = 0, last = performance.now();
    const tick = now => {
      requestAnimationFrame(tick);
      log.frames.push(now - last);
      last = now;
      if (window.__op2.game.state !== 'playing') return;
      const s = ctx.gore.stats();
      log.peakKnock = Math.max(log.peakKnock, s.knockdowns);
      log.peakRags = Math.max(log.peakRags, s.ragdolls);
      log.peakStep = Math.max(log.peakStep, ctx.physics.stepMs);
      for (const e of ctx.enemies.alive) {
        const down = e.downed;
        if (was.get(e.uid) === true && !down) log.rose++;
        if (was.get(e.uid) === false && down) log.downed++;
        was.set(e.uid, down);
      }
      let best = null, bestD = 45;
      for (const e of ctx.enemies.alive) {
        const d = e.position.distanceTo(p.position);
        if (d < bestD && (e.hasLos ?? true)) { best = e; bestD = d; }
      }
      if (best) {
        const dx = best.center.x - p.eye.x, dy = best.center.y - p.eye.y, dz = best.center.z - p.eye.z;
        p.yaw = Math.atan2(-dx, -dz);
        p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
      }
      clock -= ctx.time.playerDt ?? 1 / 60;
      if (clock > 0) {
        if (pin > 0 && --pin === 0) { ctx.input.simulate('fire', false); ctx.input.simulate('grenade', false); }
        return;
      }
      clock = 0.9;
      if (!best) return;
      const id = guns[gun++ % guns.length];
      ctx.weapons.addAmmo(1);
      if (gun % 5 === 0 && ctx.weapons.grenades > 0) {
        ctx.input.simulate('grenade', true);
        log.fired.grenade = (log.fired.grenade ?? 0) + 1;
        ctx.weapons.addGrenades?.(1);
      } else {
        ctx.weapons.switchTo(id);
        ctx.input.simulate('fire', true);
        log.fired[id] = (log.fired[id] ?? 0) + 1;
      }
      pin = 20;
    };
    requestAnimationFrame(tick);
  });
  const third = seconds * 1000 / 3;
  await h.sleep(third);
  await h.shot('fight-a');
  await h.sleep(third);
  await h.shot('fight-b');
  await h.sleep(third);
  return page.evaluate(() => {
    const { ctx } = window.__op2;
    const { frames, ...log } = window.fightLog;
    const sorted = frames.slice(30).sort((a, b) => a - b);
    const at = q => +(sorted[Math.floor(sorted.length * q)] ?? 0).toFixed(1);
    return { ...log, peakStep: +log.peakStep.toFixed(1), frames: { n: sorted.length, p50: at(0.5), p95: at(0.95), p99: at(0.99), max: +(sorted[sorted.length - 1] ?? 0).toFixed(1) }, state: window.__op2.game.state, alive: ctx.enemies.alive.length, wave: ctx.waves.wave ?? ctx.waves.current ?? null };
  });
}
