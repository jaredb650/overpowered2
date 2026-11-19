// Short scenes for the owner's eye, one for each thing the gore update set out to change: triggers for tools/sheet.mjs. Each
// is played with the real guns from the player's eye in the Crucible at night, on a frozen clock with the bot's own dice,
// and uses only what the game before the update has too, so the same command against an old build's server is "before".
//
//   LOOK_SCENE=react node tools/sheet.mjs --port <yours> --url "/?contract=crucible&autostart=1" \
//     --until "window.__op2?.game?.state==='playing'" --script tools/scripts/gore-look-scenes.mjs \
//     --dpr 2 --w 1440 --h 900 --frames 70 --every 64 --pick 24 --cols 6 --tile 480 --crop 360,250,720,450 --timeout 900 \
//     --out tools/out/<you>/react-on.png
//
// Scenes (LOOK_SCENE), each with the frames and crop that suit it (`SCENES` below; tools/scripts/gore-look-all.sh runs them all):
//   react   one Trooper 4.5 m off with four times his health, so each hit is seen: a round in the chest, one in the gun arm,
//           one in a leg, a burst of five, then held fire until he is dead: every round's reaction, the struck arm, the
//           stagger and the death on his feet
//   gib     one rocket at the feet of three Troopers 7 m off: what comes out of the fireball, and what is on the floor after
//   fire    the Kiln held for a second and a half on two Troopers and a Husk 5 m off, then left to burn for ten seconds
//   wear    single rounds into one arm and then one leg of a Trooper 3.5 m off, half a second apart, until each comes off
// LOOK_HUD=1 leaves the HUD on.
export const SCENES = {
  react: { frames: 80, every: 64, crop: '330,210,780,490', pick: 24 },
  gib: { frames: 64, every: 48, crop: '', pick: 24 },
  fire: { frames: 72, every: 160, crop: '280,180,880,560', pick: 24 },
  wear: { frames: 66, every: 96, crop: '430,120,580,660', pick: 24 },
};

async function install({ scene, hud }) {
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
  for (const id of ['smg', 'rocket', 'kiln']) if (!ctx.weapons.owned.has(id)) ctx.weapons.give(id);
  for (const e of [...ctx.enemies.alive]) ctx.enemies.withdraw ? ctx.enemies.withdraw(e) : ctx.enemies.applyDamage(e, { amount: 99999, type: 'true', point: e.center.clone(), dir: new V(0, 0, 1), force: 0, source: 'smg' });
  if (!hud) {
    const css = document.createElement('style');
    css.textContent = '.hud { visibility: hidden !important; }';
    document.head.appendChild(css);
  }
  const hitOf = () => ({ point: new V(), normal: new V(), distance: 0, surface: 'concrete', collider: null });
  const ground = (x, y, z) => {
    const h = hitOf();
    return ctx.physics.raycastInto(new V(x, y + 1.5, z), new V(0, -1, 0), 40, 1, h) ? h.point.clone() : new V(x, y, z);
  };
  const view = (ctx.world.spec.views ?? {}).core_floor;
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
  P.teleport(home, yaw);
  const look = t => {
    const d = new V().subVectors(t, P.eye);
    P.yaw = Math.atan2(-d.x, -d.z);
    P.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
  };
  /** A body that stands where it is put, facing the player, and does nothing: the hits are what moves it. */
  const stand = (kind, d, s, health = 1) => {
    const at = along(d, s);
    const e = ctx.enemies.spawn(kind, at);
    if (!e) return null;
    e.behaviours = [];
    e.attacks = [];
    e.mode = 'hold';
    e.dummy = true;
    e.yaw = Math.atan2(home.x - at.x, home.z - at.z);
    if (health !== 1) e.health = e.maxHealth = e.maxHealth * health;
    return e;
  };
  // The rounds of `react` and `wear` are the SMG's own numbers put through the game's damage model into a named part, along
  // the line from the eye (as tools/scripts/hit-seq.mjs does), so the camera can stay still and what moves is the body.
  let smg = { damage: 12, force: 14, interval: 0.08, severMult: 1, headshotMult: 2 };
  try {
    const w = (await import('/src/weapons/data.ts')).WEAPONS.smg;
    smg = { damage: w.damage, force: w.force, interval: w.interval, severMult: w.severMult, headshotMult: w.headshotMult };
  } catch { /* the numbers above */ }
  const round = (e, region, across = 0) => {
    if (!e?.alive) return;
    const bone = e.char.rig.bones.findIndex(b => b.region === region);
    const at = new V().setFromMatrixPosition(e.char.bones[Math.max(bone, 0)].matrixWorld);
    if (region === 'chest') at.y += 0.12;
    if (/arm|leg|shin/.test(region)) at.y -= 0.12;
    // `across`: metres toward the body's own left, so trunk rounds do not all land on the breastbone.
    at.addScaledVector(new V(Math.cos(e.yaw), 0, -Math.sin(e.yaw)), across);
    const dir = new V().subVectors(at, P.eye).normalize();
    ctx.enemies.applyDamage(e, { amount: smg.damage, type: 'bullet', point: at, dir, force: smg.force, source: 'smg', region, bone: bone >= 0 ? bone : undefined, severMult: smg.severMult, headshotMult: smg.headshotMult });
  };
  const bot = { t: 0, on: false, held: false, plan: [], shots: [], weapon: 'smg', centre: home.clone() };
  const fire = on => {
    if (bot.held === on) return;
    bot.held = on;
    ctx.input.simulate('fire', on);
  };
  /** The real gun: aimed at `aim()` with the trigger held from one second to another. */
  const say = (from, to, aim) => bot.plan.push({ from, to, aim });
  /** Single rounds at these seconds, and a burst of `n` at the gun's own rate. */
  const taps = (times, e, region, across = 0) => {
    for (const t of times) bot.shots.push({ t, e, region, across });
  };
  const burst = (from, n, e, region, across = 0) => taps(Array.from({ length: n }, (_, i) => from + i * smg.interval), e, region, across);

  if (scene === 'react') {
    // One man, close, and one thing at a time with room after each to see what it did to him.
    const trooper = stand('trooper', 4.5, 0, 4);
    bot.centre = along(4.5, 0).add(new V(0, 1, 0));
    taps([0.4], trooper, 'chest', 0.13);
    taps([1.0], trooper, 'armR');
    taps([1.6], trooper, 'legL');
    burst(2.2, 5, trooper, 'chest', -0.1);
    burst(3.0, 30, trooper, 'chest', 0.05);
  } else if (scene === 'gib') {
    const men = [stand('trooper', 7, -0.7), stand('trooper', 7.5, 0.5), stand('trooper', 6.6, 0.2)];
    bot.weapon = 'rocket';
    bot.centre = along(7, 0).add(new V(0, 1.0, 0));
    say(0.5, 0.56, () => new V(men[2].position.x, men[2].position.y + 0.1, men[2].position.z));
  } else if (scene === 'fire') {
    const men = [stand('trooper', 5, -1.1), stand('husk', 5.4, 0.2), stand('trooper', 5, 1.4)];
    bot.weapon = 'kiln';
    bot.centre = along(5, 0.15).add(new V(0, 0.9, 0));
    say(0.4, 0.9, () => men[0].center);
    say(0.9, 1.4, () => men[1].center);
    say(1.4, 1.9, () => men[2].center);
  } else if (scene === 'wear') {
    const trooper = stand('trooper', 3.5, 0, 6);
    bot.centre = along(3.5, 0).add(new V(0, 1.05, 0));
    taps([0.5, 1.0, 1.5, 2.0, 2.5, 3.0], trooper, 'armL');
    taps([3.6, 4.1, 4.6, 5.1, 5.6, 6.1], trooper, 'legR');
  }
  ctx.weapons.switchTo(bot.weapon);
  look(bot.centre);
  const step = dt => {
    if (!bot.on) return;
    const was = bot.t;
    bot.t += dt;
    if (P.position.distanceTo(home) > 0.4) P.teleport(home, P.yaw);
    for (const shot of bot.shots) if (shot.t > was && shot.t <= bot.t) round(shot.e, shot.region, shot.across);
    let now = null;
    for (const p of bot.plan) if (bot.t >= p.from && bot.t < p.to) now = p;
    look(now ? now.aim() : bot.centre);
    fire(!!now);
  };
  const inner = game.frame.bind(game);
  game.frame = (...a) => {
    step(1 / 60);
    return inner(...a);
  };
  bot.on = true;
  return { scene, home: home.toArray(), alive: ctx.enemies.alive.length };
}

export default async function (page, h) {
  const scene = process.env.LOOK_SCENE ?? 'react';
  if (!SCENES[scene]) throw new Error(`gore-look-scenes: no scene "${scene}". Known: ${Object.keys(SCENES).join(', ')}`);
  const result = await page.evaluate(install, { scene, hud: process.env.LOOK_HUD === '1' });
  // A few frames before the first picture: the camera is where the bot put the player, and the bodies stand in their poses.
  await h.sleep(160);
  return result;
}
