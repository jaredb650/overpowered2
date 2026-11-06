// Can you read an enemy in the darkest corners of The Kill House? Stands a trooper and a husk in each spot and takes the shot
// from the player's eye:
//
//   node tools/shot.mjs --url "/?map=killhouse&autostart=1" --dpr 2 --w 1440 --h 900 --script tools/scripts/killhouse-read.mjs --out tools/out/kh-read.png --wait 500 --timeout 150
const SPOTS = [
  // name, player x z, enemies x z
  ['plywood-strip', 12.6, 16.2, 6, 16.6],
  ['plant-bay', -18, 12, -23, 6.5],
  ['lanes-bay', -12, -18, -7, -23.5],
  ['yard-lane', -3, -33.4, -11.5, -33.6],
  ['gate-bay', 6, -31, 0, -36.2],
  ['corridor', -11.75, 8, -11.7, 0.5],
];

export default async function read(page, h) {
  const shot = name => h.shot(name).catch(e => console.error(`shot ${name} failed: ${e.message.split('\n')[0]}`));
  const started = Date.now();
  let ready = false;
  while (!ready && Date.now() - started < 90000) {
    ready = await page.evaluate(() => window.__op2?.game?.state === 'playing');
    if (!ready) await h.sleep(1000);
  }
  if (!ready) return { booted: false };
  await page.evaluate(() => { window.__op2.ctx.player.modifiers.invulnerable = true; });
  const placed = [];
  for (const [name, px, pz, ex, ez] of SPOTS) {
    placed.push(await page.evaluate(([x, z, tx, tz]) => {
      const { ctx } = window.__op2;
      const p = ctx.player;
      // Nothing gets killed between spots: a streak would tint the picture with its colour grade and spoil the test.
      p.teleport(p.position.clone().set(x, 0.1, z), Math.atan2(-(tx - x), -(tz - z)));
      p.pitch = 0;
      const at = p.position.clone().set(tx, 0.1, tz);
      const a = ctx.enemies.spawn('trooper', at);
      const b = ctx.enemies.spawn('husk', at.clone().setX(tx + 1.2));
      return [a?.def.id, b?.def.id];
    }, [px, pz, ex, ez]));
    await h.sleep(450);
    await shot(name);
  }
  return { placed };
}
