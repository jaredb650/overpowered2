// The AA sentry and the Distraint Frame call-ins on the Test Range: the sentry dropped by its key and a click, shooting drones
// down while two men stand under them; the Frame landing ahead of the player, boarded with E, and put out when its time runs down.
//   node tools/shot.mjs --url "/?map=range" --script tools/scripts/callins-live.mjs --wait 500 --timeout 300 --dpr 2 --w 1440 --h 900 --out tools/out/callins/x.png
// CALLS_STEP=sentry or frame runs one half.
const STEP = process.env.CALLS_STEP ?? 'all';

export default async function callinsLive(page, h) {
  for (let i = 0; i < 180; i++) {
    if (await page.evaluate(() => !!window.__lab && window.__op2?.game?.state === 'playing')) break;
    await h.sleep(500);
  }
  await page.mouse.click(300, 400);
  await h.sleep(500);
  await page.evaluate(() => {
    const { ctx } = window.__op2;
    window.V = ctx.player.position.constructor;
    window.M = () => ctx.progression.callInsManager;
    window.look = (yaw, pitch) => { ctx.player.yaw = yaw; ctx.player.pitch = pitch; };
    window.god = setInterval(() => { if (ctx.player.alive) ctx.player.heal?.(1000); }, 200);
  });
  const out = {};
  const state = () => page.evaluate(() => {
    const { ctx } = window.__op2;
    const drones = ctx.enemies.alive.filter(e => e.id === 'drone').length;
    const men = ctx.enemies.alive.filter(e => e.id !== 'drone').length;
    return { drones, men, held: [...window.M().held], player: ctx.player.position.toArray().map(n => +n.toFixed(1)), fps: Math.round(window.__op2.game.fps) };
  });

  if (STEP !== 'frame') {
    await page.evaluate(() => {
      const { ctx } = window.__op2;
      const p = ctx.player.position;
      window.look(0, -0.12);
      // Two men on the ground ahead and four drones hovering round the player (no guns), as the swarm's do.
      window.__lab.spawner.place('trooper', new window.V(p.x - 3, p.y, p.z - 16), 'off');
      window.__lab.spawner.place('trooper', new window.V(p.x + 4, p.y, p.z - 18), 'off');
      for (let i = 0; i < 4; i++) window.__lab.spawner.place('drone', new window.V(p.x - 18 + i * 12, p.y + 7, p.z - 24 - (i % 2) * 8), 'patrol');
      ctx.progression.grantCallIn('sentry');
    });
    await h.sleep(600);
    out.sentryBefore = await state();
    await h.press('KeyI');
    await h.sleep(500);
    await h.shot('sentry-aim');
    await h.click();
    await h.sleep(1800);
    await h.shot('sentry-fall');
    await h.sleep(1600);
    await h.shot('sentry-up');
    await h.sleep(1200);
    await h.shot('sentry-firing');
    await page.evaluate(() => window.look(0.15, 0.25));
    await h.sleep(900);
    await h.shot('sentry-sky');
    await h.sleep(3000);
    out.sentryAfter = await state();
    // A close look: stand beside it, looking at it.
    await page.evaluate(() => {
      const { ctx } = window.__op2;
      const s = window.M().sentryRig.root.position;
      ctx.player.teleport(new window.V(s.x + 3.2, s.y, s.z + 3.2), Math.PI / 4);
      window.look(Math.PI / 4, -0.32);
    });
    await h.sleep(700);
    await h.shot('sentry-close');
    await page.evaluate(() => {
      const { ctx } = window.__op2;
      const s = window.M().sentryRig.root.position;
      ctx.player.teleport(new window.V(s.x - 2.6, s.y, s.z - 4.2), Math.atan2(2.6, 4.2) + Math.PI);
      window.look(Math.atan2(-2.6, -4.2) + Math.PI, -0.18);
    });
    await h.sleep(700);
    await h.shot('sentry-close2');
  }

  if (STEP !== 'sentry') {
    await page.evaluate(() => {
      const { ctx } = window.__op2;
      ctx.enemies.killAll('lab');
      ctx.player.teleport(new window.V(0, 0, 20), 0);
      window.look(0, -0.05);
      ctx.progression.grantCallIn('frame');
    });
    await h.sleep(600);
    await h.press('KeyK');
    await h.sleep(1900);
    await h.shot('frame-fall');
    await h.sleep(1100);
    await h.shot('frame-landed');
    out.frameLanded = await page.evaluate(() => window.M().frameRig?.walker.feet.toArray().map(n => +n.toFixed(1)));
    // Walk up to it and climb in.
    await h.press('KeyW', 700);
    await h.sleep(300);
    await h.shot('frame-prompt');
    await h.press('KeyE');
    await h.sleep(900);
    out.boarded = await page.evaluate(() => ({ occupied: window.M().frame.occupied, left: window.M().seats.seat?.left }));
    await h.shot('frame-cockpit');
    // Run the clock down and see the player put out.
    await page.evaluate(() => { const s = window.M().seats.seat; if (s) s.left = 1; });
    await h.sleep(1800);
    out.after = await page.evaluate(() => ({ occupied: window.M().frame.occupied, player: window.__op2.ctx.player.position.toArray().map(n => +n.toFixed(1)) }));
    await h.shot('frame-out');
  }
  await page.evaluate(() => clearInterval(window.god));
  return out;
}
