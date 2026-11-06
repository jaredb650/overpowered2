// Full-game playtest bot. Run through the harness against /?autostart=1:
//
//   node tools/shot.mjs --url "/?autostart=1" --script tools/scripts/playtest.mjs --wait 8000 --out tools/out/playtest.png
//
// Env: PT_SECONDS (default 60), PT_SHOT_EVERY (default 10), PT_WEAPONS=1 cycles weapons, PT_GOD=1 keeps the bot alive.
// The bot aims at the nearest enemy, holds fire and keeps moving. It reports frame times, game state
// over time, and anything that throws.
const seconds = Number(process.env.PT_SECONDS ?? 60);
const shotEvery = Number(process.env.PT_SHOT_EVERY ?? 10);
const cycleWeapons = process.env.PT_WEAPONS === '1';
const god = process.env.PT_GOD === '1';

export default async function playtest(page, h) {
  for (let i = 0; i < 90; i++) {
    if (await page.evaluate(() => window.__op2?.game?.state === 'playing')) break;
    await h.sleep(1000);
  }
  await page.evaluate(({ cycleWeapons, god }) => {
    const { ctx, game } = window.__op2;
    const log = { frames: [], samples: [], errors: [] };
    window.__pt = log;
    window.addEventListener('error', e => log.errors.push(String(e.message)));
    window.addEventListener('unhandledrejection', e => log.errors.push(String(e.reason)));
    const weapons = ['weapon1', 'weapon2', 'weapon3', 'weapon4', 'weapon5', 'weapon6', 'weapon7', 'weapon8', 'weapon9', 'weapon0'];
    let last = performance.now();
    let t = 0;
    let weaponTimer = 0;
    let wi = 0;
    const tick = now => {
      requestAnimationFrame(tick);
      const dt = (now - last) / 1000;
      last = now;
      log.frames.push(dt * 1000);
      t += dt;
      const p = ctx.player;
      if (god && p.health !== undefined) {
        p.health = p.maxHealth;
      }
      const alive = ctx.enemies.alive ?? [];
      let best = null;
      let bestD = Infinity;
      for (const e of alive) {
        const d = e.position.distanceToSquared(p.position);
        if (d < bestD) {
          bestD = d;
          best = e;
        }
      }
      if (best && p.eye) {
        const dx = best.center.x - p.eye.x;
        const dy = best.center.y - p.eye.y;
        const dz = best.center.z - p.eye.z;
        p.yaw = Math.atan2(-dx, -dz);
        p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
        ctx.input.simulate('fire', true);
        ctx.input.simulate('forward', Math.sqrt(bestD) > 12);
      } else {
        ctx.input.simulate('fire', false);
        ctx.input.simulate('forward', true);
      }
      ctx.input.simulate('left', Math.sin(t * 0.9) > 0.2);
      ctx.input.simulate('right', Math.sin(t * 0.9) < -0.2);
      ctx.input.simulate('jump', Math.sin(t * 2.3) > 0.7);
      ctx.input.simulate('dash', Math.sin(t * 1.1) > 0.97);
      ctx.input.simulate('slide', Math.sin(t * 0.7) > 0.93);
      if (cycleWeapons) {
        weaponTimer += dt;
        if (weaponTimer > 4) {
          weaponTimer = 0;
          ctx.input.simulate(weapons[wi % weapons.length], true);
          setTimeout(() => ctx.input.simulate(weapons[wi % weapons.length], false), 60);
          wi++;
        }
      }
    };
    requestAnimationFrame(tick);
    setInterval(() => {
      const s = game.stats();
      const g = ctx.progression ?? {};
      log.samples.push({
        t: Math.round(t), ...s, score: g.score, combo: g.combo, kills: g.kills, wave: ctx.waves?.wave,
        hp: ctx.player.health, speed: ctx.player.velocity ? Math.hypot(ctx.player.velocity.x, ctx.player.velocity.z) : undefined,
        pos: ctx.player.position?.toArray?.().map(n => Math.round(n)),
      });
    }, 2000);
  }, { cycleWeapons, god });

  const shots = Math.floor(seconds / shotEvery);
  for (let i = 1; i <= shots; i++) {
    await h.sleep(shotEvery * 1000);
    await h.shot(`t${i * shotEvery}`);
  }
  await h.sleep((seconds - shots * shotEvery) * 1000);

  return page.evaluate(() => {
    const { frames, samples, errors } = window.__pt;
    const sorted = [...frames].sort((a, b) => a - b);
    const q = f => sorted[Math.floor(sorted.length * f)]?.toFixed(1);
    return {
      frames: frames.length,
      frameMs: { p50: q(0.5), p95: q(0.95), p99: q(0.99), max: sorted.at(-1)?.toFixed(1) },
      over33ms: frames.filter(f => f > 33.4).length,
      errors: errors.slice(0, 20),
      samples: samples.filter((_, i) => i % 5 === 0),
      last: samples.at(-1),
    };
  });
}
