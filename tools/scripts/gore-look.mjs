// The whole gore update in one fight, for the eye: a trigger for tools/sheet.mjs. The same seeded 30 seconds in the Crucible
// at night, from the player's eye with the gun in hand: SMG into men walking at you, the shotgun up close, rockets into a
// group, the Kiln, bullets again onto the heap, then a walk through it and a look back.
//
//   node tools/sheet.mjs --port <yours> --url "/?contract=crucible&autostart=1" --script tools/scripts/gore-look.mjs \
//     --until "window.__op2?.game?.state==='playing'" --dpr 2 --w 1440 --h 900 --frames 900 --every 33 --pick 30 --cols 6 --tile 480 --timeout 2400 \
//     --video tools/out/<you>/fight-on.mp4 --out tools/out/<you>/fight-on.png
//
// Frozen clock and seeded dice (sheet.mjs), and the bot has dice of its own, so two builds, or one build with and without
// the update's switches (`GC_OFF` in gore-cost.mjs is all of them off), fight the same enemies in the same order.
// LOOK_SECONDS (30) stretches the timeline; LOOK_HUD=1 leaves the HUD on.
const SECONDS = Number(process.env.LOOK_SECONDS ?? 30);

async function install({ seconds, hud }) {
  const { ctx, game } = window.__op2;
  const P = ctx.player;
  const V = P.eye.constructor;
  ctx.render.dynamicResolution.enabled = false;
  ctx.waves.update = () => {};
  ctx.waves.start = () => {};
  P.modifiers.invulnerable = true;
  ctx.weapons.modifiers.bottomlessMag = true;
  try {
    const data = await import('/src/progression/data.ts');
    for (const table of Object.values(data)) if (table && typeof table === 'object' && 'dropChance' in table) table.dropChance = 0;
    (await import('/src/core/devflags.ts')).DevFlags.progression = false;
  } catch { /* a production build */ }
  for (const id of ['smg', 'shotgun', 'rocket', 'kiln']) if (!ctx.weapons.owned.has(id)) ctx.weapons.give(id);
  for (const e of [...ctx.enemies.alive]) ctx.enemies.applyDamage(e, { amount: 99999, type: 'true', point: e.center.clone(), dir: new V(0, 0, 1), force: 0, source: 'smg' });
  if (!hud) {
    const css = document.createElement('style');
    css.textContent = '.hud { visibility: hidden !important; }';
    document.head.appendChild(css);
  }
  let seed = 4242;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const hitOf = () => ({ point: new V(), normal: new V(), distance: 0, surface: 'concrete', collider: null });
  const ground = (x, y, z) => {
    const h = hitOf();
    return ctx.physics.raycastInto(new V(x, y + 1.5, z), new V(0, -1, 0), 40, 1, h) ? h.point.clone() : new V(x, y, z);
  };
  const views = ctx.world.spec.views ?? {};
  const view = views.core_floor ?? views.court ?? null;
  const origin = view ? new V(...view.pos) : P.position.clone();
  let heading = 0;
  let longest = 0;
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    const h = hitOf();
    const d = ctx.physics.raycastInto(new V(origin.x, origin.y + 1, origin.z), new V(Math.sin(a), 0, Math.cos(a)), 40, 1, h) ? h.distance : 40;
    if (d > longest) {
      longest = d;
      heading = a;
    }
  }
  const fwd = new V(Math.sin(heading), 0, Math.cos(heading));
  const side = new V(fwd.z, 0, -fwd.x);
  const home = ground(origin.x, origin.y, origin.z);
  const yaw = Math.atan2(-fwd.x, -fwd.z);
  const along = (d, s = 0) => ground(origin.x + fwd.x * d + side.x * s, origin.y, origin.z + fwd.z * d + side.z * s);
  const look = (t, ease = 1) => {
    const d = new V().subVectors(t, P.eye);
    const wantYaw = Math.atan2(-d.x, -d.z);
    const wantPitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
    // Eased, so the picture pans as a hand would and does not snap from man to man.
    let dy = wantYaw - P.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    P.yaw += dy * ease;
    // Never at the ceiling or the boots: a target on a ledge or at the feet would swing the whole picture.
    P.pitch += (Math.max(-0.55, Math.min(0.3, wantPitch)) - P.pitch) * ease;
  };
  P.teleport(home, yaw);

  const k = seconds / 30;
  // The fight's parts, in seconds of a 30 s fight: [from, weapon].
  const PARTS = [[0, 'smg'], [7, 'shotgun'], [11, 'rocket'], [15, 'kiln'], [18.5, 'smg'], [22, 'walk'], [28, 'back']];
  // Mostly men, who stand off and shoot: a hall of Husks is in the player's face in three seconds and the picture is a mouth.
  const KINDS = ['trooper', 'trooper', 'husk', 'trooper', 'gunner', 'trooper', 'husk', 'trooper', 'trooper', 'brute', 'trooper', 'husk'];
  let shell = { damage: 9, force: 30, pellets: 8 };
  try {
    const w = (await import('/src/weapons/data.ts')).WEAPONS.shotgun;
    shell = { damage: w.damage, force: w.force, pellets: w.pellets };
  } catch { /* the numbers above */ }
  const fwdAim = along(8).add(new V(0, 1, 0));
  const bot = { t: 0, on: false, spawned: 0, weapon: '', switchT: 0, held: false, lastSpawn: -9, target: null, hold: 0 };
  const born = new WeakMap();
  const fire = on => {
    if (bot.held === on) return;
    bot.held = on;
    ctx.input.simulate('fire', on);
  };
  const part = t => {
    let p = PARTS[0];
    for (const q of PARTS) if (t >= q[0] * k) p = q;
    return p[1];
  };
  const step = dt => {
    if (!bot.on) return;
    bot.t += dt;
    const alive = ctx.enemies.alive;
    const what = part(bot.t);
    const fighting = what !== 'walk' && what !== 'back';
    // A dozen at a time, coming down the hall: thicker for the rockets and the Kiln, which want a group.
    const want = what === 'rocket' || what === 'kiln' ? 12 : fighting ? 8 : 0;
    if (alive.length < want && bot.t - bot.lastSpawn > 0.3) {
      const e = ctx.enemies.spawn(KINDS[bot.spawned % KINDS.length], along(12 + rnd() * 4, (rnd() - 0.5) * 6));
      bot.lastSpawn = bot.t;
      if (e) {
        bot.spawned++;
        born.set(e, bot.t);
      }
    }
    // Whoever gets within arm's reach takes a shell's worth in the chest, whatever is in the hands: the picture is of the
    // fight, and one body filling the screen hides it.
    for (const e of alive) {
      if (e.center.distanceTo(P.eye) > 2.6 || (born.get(e) ?? 0) === -1) continue;
      born.set(e, -1);
      const dir = new V().subVectors(e.center, P.eye).normalize();
      for (let i = 0; i < shell.pellets; i++) ctx.enemies.applyDamage(e, { amount: shell.damage * 3, type: 'pellet', point: e.center.clone(), dir: dir.clone(), force: shell.force, source: 'shotgun' });
    }
    if (fighting) {
      if (P.position.distanceTo(home) > 0.6) P.teleport(home, P.yaw);
      if (what !== bot.weapon) {
        bot.weapon = what;
        bot.switchT = bot.t + 0.6;
        ctx.weapons.switchTo(what);
        fire(false);
      }
      // One man at a time, held until he is down, so a body is seen taking its rounds; the shotgun waits for them close.
      if (!bot.target || !bot.target.alive || bot.t > bot.hold) {
        let best = 99;
        bot.target = null;
        for (const e of alive) {
          const d = e.center.distanceTo(P.eye);
          if (d < best) {
            best = d;
            bot.target = e;
          }
        }
        bot.hold = bot.t + 1.6;
      }
      const e = bot.target;
      if (e && bot.t >= bot.switchT) {
        const d = e.center.distanceTo(P.eye);
        const feet = new V(e.position.x, e.position.y + 0.15, e.position.z);
        look(what === 'rocket' ? feet : e.center, 0.22);
        const near = what === 'shotgun' ? d < 8 : what === 'kiln' ? d < 10 : what === 'rocket' ? d > 5 : true;
        // The SMG in long bursts with a breath between, so a body's answer is seen; the Kiln in two squirts, not a hose.
        const burst = what === 'smg' ? (bot.t * 1.1) % 1 < 0.8 : what === 'kiln' ? (bot.t - 15 * k) % 1.75 < 1.1 : Math.floor(bot.t * 7.5) % 2 === 0;
        fire(near && burst);
      } else {
        fire(false);
        if (!e) look(fwdAim, 0.08);
      }
    } else {
      fire(false);
      const to = what === 'walk' ? along(9) : home;
      const d = new V().subVectors(to, P.position);
      d.y = 0;
      if (what === 'walk') {
        if (d.length() > 0.5) {
          // Eyes on the floor a few steps ahead: what is being walked through.
          look(new V(P.position.x + fwd.x * 3.5, P.position.y + 0.2, P.position.z + fwd.z * 3.5), 0.08);
          ctx.input.simulate('forward', true);
        } else ctx.input.simulate('forward', false);
      } else {
        // Stops and turns to look back over what was done.
        ctx.input.simulate('forward', false);
        look(new V(home.x, home.y + 0.3, home.z), 0.06);
      }
    }
  };
  const inner = game.frame.bind(game);
  game.frame = (...a) => {
    step(1 / 60);
    return inner(...a);
  };
  bot.on = true;
  window.__look = { bot, counts: () => ({ t: bot.t, spawned: bot.spawned, alive: ctx.enemies.alive.length, gore: ctx.gore.stats(), decals: ctx.render.decals.total ?? ctx.render.decals.mesh.count }) };
  return { home: home.toArray(), longest };
}

export default async function (page, h) {
  const result = await page.evaluate(install, { seconds: SECONDS, hud: process.env.LOOK_HUD === '1' });
  // A few frames before the first picture, so it is from where the bot put the player.
  await h.sleep(96);
  return result;
}
