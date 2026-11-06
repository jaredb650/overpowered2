// Boots the real game on either map and reports how long the world took, for comparing maps under the same conditions:
//   node tools/shot.mjs --url "/?map=killhouse&autostart=1" --script tools/scripts/killhouse-boot.mjs --out tools/out/kh-boot.png --wait 200
export default async function boot(page, h) {
  const started = Date.now();
  let ready = false;
  while (!ready && Date.now() - started < 100000) {
    ready = await page.evaluate(() => window.__op2?.game?.state === 'playing');
    if (!ready) await h.sleep(250);
  }
  const bootSeconds = Math.round((Date.now() - started) / 100) / 10;
  if (!ready) return { booted: false, bootSeconds };
  await h.sleep(4000);
  return page.evaluate(seconds => {
    const { ctx, game } = window.__op2;
    const r = ctx.world.report;
    return {
      booted: true, bootSeconds: seconds, map: ctx.world.def.id, state: game.state, wave: ctx.waves?.wave, alive: ctx.enemies.alive.length,
      world: { authorMs: r.authorMs, bakeMs: r.bakeMs, navMs: r.navMs, buildMs: r.buildMs, lightBakeMs: r.lightBakeMs, totalMs: r.totalMs, triangles: r.triangles, colliders: r.colliders, lights: r.lights },
      draws: ctx.render.drawCalls(), tris: ctx.render.triangles(),
    };
  }, bootSeconds);
}
