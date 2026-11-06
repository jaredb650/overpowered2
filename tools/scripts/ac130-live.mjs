// The AC-130 in the real game. One mode per run:
//
//   AC_MODE=model node tools/shot.mjs --url "/?map=range" --script tools/scripts/ac130-live.mjs --dpr 2 --w 1440 --h 900 --wait 500 --out tools/out/ac-model.png
//   AC_MODE=sky   node tools/shot.mjs --url "/?map=killhouse&autostart=1" --script tools/scripts/ac130-live.mjs --dpr 2 --w 1440 --h 900 --wait 500 --out tools/out/ac-sky.png --timeout 200
//   AC_MODE=full  node tools/shot.mjs --url "/?map=killhouse&autostart=1" --script tools/scripts/ac130-live.mjs --wait 500 --out tools/out/ac-full.png --timeout 200
//   AC_MODE=reset node tools/shot.mjs --url "/?map=range" --script tools/scripts/ac130-live.mjs --wait 500 --out tools/out/ac-reset.png
//
// model  the airframe parked in front of the camera, from several sides
// sky    a real call-in, then the siege seen from the ground in real time at each stage, jumping between them
// full   all two minutes on a fast clock with nothing drawn: what fired, what died, and whether the player was touched
// reset  a new run during a live siege leaves nothing behind
const mode = process.env.AC_MODE ?? 'full';
const SPAWNS = Number(process.env.AC_SPAWNS ?? 14);

/** Runs in the page. */
function prelude() {
  const { ctx, game } = window.__op2;
  const log = { radio: [], banners: [], kills: {}, killers: 0, playerHits: [], sounds: {}, fx: {}, shots: {}, peak: 0 };
  window.__ac = log;
  const hud = ctx.hud;
  const feed = hud.feed.bind(hud);
  hud.feed = (text, color) => {
    if (text.startsWith('SPECTRE')) log.radio.push(`${Number((window.__acT?.() ?? 0).toFixed(1))} ${text}`);
    return feed(text, color);
  };
  const banner = hud.banner.bind(hud);
  hud.banner = (text, sub, color) => {
    log.banners.push(`${text} / ${sub ?? ''}`);
    return banner(text, sub, color);
  };
  ctx.events.on('enemy:killed', e => { log.kills[e.damage.source] = (log.kills[e.damage.source] ?? 0) + 1; });
  ctx.events.on('player:damaged', e => log.playerHits.push({ amount: e.amount, type: e.type }));
  const play = ctx.audio.play.bind(ctx.audio);
  ctx.audio.play = (id, o) => {
    log.sounds[id] = (log.sounds[id] ?? 0) + 1;
    return play(id, o);
  };
  const explosion = ctx.fx.explosion.bind(ctx.fx);
  ctx.fx.explosion = (p, o) => {
    log.fx[o.kind] = (log.fx[o.kind] ?? 0) + 1;
    return explosion(p, o);
  };

  /** Skips ahead with nothing drawn. Every system runs, on the same clock a slow frame would give it. */
  window.__skip = seconds => {
    const render = ctx.render.render;
    ctx.render.render = () => undefined;
    const end = ctx.time.realElapsed + seconds;
    while (ctx.time.realElapsed < end && game.state === 'playing') {
      ctx.time.tick(1 / 30);
      game.frame();
      ctx.input.endFrame?.();
    }
    ctx.render.render = render;
  };

  /** Presses an action for one frame, the way a key press lands. */
  window.__tap = async action => {
    ctx.input.simulate(action, true);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    ctx.input.simulate(action, false);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  };

  window.__spawn = (count, near) => {
    const p = ctx.player.position;
    const ids = ['husk', 'husk', 'trooper', 'brute', 'gunner'];
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const r = near + (i % 3) * 3;
      const at = p.clone();
      at.x += Math.cos(a) * r;
      at.z += Math.sin(a) * r;
      ctx.world.nav.nearest(at, 12, at);
      ctx.enemies.spawn(ids[i % ids.length], at);
    }
  };
}

async function booted(page, h) {
  for (let i = 0; i < 120; i++) {
    if (await page.evaluate(() => window.__op2?.game?.state === 'playing')) return true;
    await h.sleep(1000);
  }
  return false;
}

/** Key to enter, aim down, click to confirm. Returns what targeting said at each step. */
async function callIn(page) {
  return page.evaluate(async () => {
    const { ctx } = window.__op2;
    ctx.player.pitch = -0.55;
    ctx.progression.grantCallIn('ac130');
    const before = ctx.progression.targeting;
    await window.__tap('callinAc130');
    const entering = ctx.progression.targeting;
    await new Promise(r => setTimeout(r, 200));
    await window.__tap('fire');
    return { before, entering, after: ctx.progression.targeting, held: [...ctx.progression.callIns], cooldown: ctx.progression.callInCooldown('ac130') };
  });
}

async function model(page, h) {
  await page.evaluate(() => {
    const { ctx } = window.__op2;
    const g = ctx.render.scene.getObjectByName('ac130');
    window.__park = (dx, dy, dz, yaw, roll) => {
      const p = ctx.player.eye;
      const f = ctx.player.forward;
      g.visible = true;
      g.position.set(p.x + f.x * dz + dx, p.y + dy, p.z + f.z * dz);
      g.rotation.set(0, yaw, roll);
    };
    ctx.time.paused = false;
  });
  const views = [
    ['left', 0, 3, 34, Math.PI / 2 + Math.PI, 0],
    ['leftbelow', 0, 12, 34, Math.PI / 2 + Math.PI + 0.5, -0.45],
    ['front', 0, 2, 30, Math.PI, 0],
    ['below', 0, 16, 26, Math.PI / 2 + Math.PI + 0.25, -0.9],
  ];
  for (const [name, ...v] of views) {
    await page.evaluate(a => window.__park(...a), v);
    await h.sleep(500);
    await h.shot(name);
  }
  return page.evaluate(() => ({ tris: window.__op2.game.stats() }));
}

async function sky(page, h) {
  await page.evaluate(n => {
    const { ctx } = window.__op2;
    ctx.player.modifiers.invulnerable = false;
    window.__spawn(n, 16);
  }, SPAWNS);
  const ci = await callIn(page);
  await h.sleep(1200);
  await h.shot('t01');
  const stats = [];
  // Look at the plane, then shoot what the player would see at each stage. Skipping is cheap, so only the shots cost.
  const stage = async (name, seconds) => {
    await page.evaluate(([s, n]) => {
      window.__skip(s);
      window.__spawn(n, 18);
    }, [seconds, Math.ceil(SPAWNS / 2)]);
    await page.evaluate(() => {
      const { ctx } = window.__op2;
      const g = ctx.render.scene.getObjectByName('ac130');
      const e = ctx.player.eye;
      const dx = g.position.x - e.x, dy = g.position.y - e.y, dz = g.position.z - e.z;
      ctx.player.yaw = Math.atan2(-dx, -dz);
      ctx.player.pitch = Math.max(-1.2, Math.atan2(dy, Math.hypot(dx, dz)) - 0.25);
    });
    await h.sleep(1600);
    await h.shot(name);
    await h.sleep(900);
    await h.shot(`${name}b`);
    stats.push({ name, ...(await page.evaluate(() => window.__op2.game.stats())) });
  };
  await stage('t12', 10);
  await stage('t40', 26);
  await stage('t75', 32);
  await stage('t112', 32);
  return { ci, stats, log: await page.evaluate(() => window.__ac) };
}

async function full(page, h) {
  await page.evaluate(n => window.__spawn(n, 15), SPAWNS);
  const ci = await callIn(page);
  const result = await page.evaluate(n => {
    const { ctx, game } = window.__op2;
    const log = window.__ac;
    const scene = ctx.render.scene;
    const g = scene.getObjectByName('ac130');
    const health = [ctx.player.health, ctx.player.armor];
    const track = [];
    let t = 0;
    window.__acT = () => t;
    // Enemies arrive through the siege the way a wave would, so the guns always have something to find.
    for (let i = 0; i < 148; i++) {
      window.__skip(1);
      t = i + 1;
      if (i % 12 === 0) window.__spawn(n, 15 + (i % 3) * 4);
      ctx.player.health = Math.max(ctx.player.health, ctx.player.maxHealth);
      if (i % 10 === 0) {
        const dx = g.position.x - ctx.player.position.x, dz = g.position.z - ctx.player.position.z;
        track.push([t, Math.round(Math.hypot(dx, dz)), Math.round(g.position.y), g.visible ? 1 : 0]);
      }
    }
    return { track, health, end: [ctx.player.health, ctx.player.armor], state: game.state, cooldown: ctx.progression.callInCooldown('ac130'), visibleAtEnd: g.visible, combo: ctx.progression.combo, score: ctx.progression.score };
  }, Math.ceil(SPAWNS / 2));
  return { ci, ...result, log: await page.evaluate(() => window.__ac) };
}

async function reset(page, h) {
  await page.evaluate(n => window.__spawn(n, 14), 8);
  const ci = await callIn(page);
  await page.evaluate(() => window.__skip(70));
  await h.shot('live');
  const before = await page.evaluate(() => {
    const { ctx } = window.__op2;
    const rounds = ctx.render.scene.getObjectByName('ac130.rounds');
    return { plane: ctx.render.scene.getObjectByName('ac130').visible, rounds: rounds.count, kids: ctx.render.scene.children.length };
  });
  const after = await page.evaluate(async () => {
    const { ctx, game } = window.__op2;
    game.newRun();
    window.__skip(12);
    await new Promise(r => setTimeout(r, 300));
    const rounds = ctx.render.scene.getObjectByName('ac130.rounds');
    return { plane: ctx.render.scene.getObjectByName('ac130').visible, rounds: rounds.count, kids: ctx.render.scene.children.length, cooldown: ctx.progression.callInCooldown('ac130'), held: [...ctx.progression.callIns], radio: window.__ac.radio.length };
  });
  await h.shot('after');
  return { ci, before, after, sounds: await page.evaluate(() => window.__op2.audio?.loops ?? null) };
}

export default async function ac130(page, h) {
  if (!(await booted(page, h))) return { booted: false };
  await page.evaluate(prelude);
  const run = { model, sky, full, reset }[mode];
  return run(page, h);
}
