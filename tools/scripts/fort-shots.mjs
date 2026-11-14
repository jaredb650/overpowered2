// The fort in the map sandbox: views, draw calls at each, and a shack blown apart frame by frame.
//   OP2_VIEWS=overview,crenel OP2_BLAST=1 node tools/shot.mjs --url "/?sandbox=map&map=fort" --script tools/scripts/fort-shots.mjs \
//     --out tools/out/fort2/v.png --wait 2500 --dpr 2 --w 1440 --h 900 --timeout 280
// OP2_VIEWS is a comma list of the map's views ("all" for every one). OP2_BLAST=1 adds the shack frames, OP2_WALL=1 a wall breach.
export default async function (page, { sleep, shot }) {
  for (let i = 0; i < 240; i++) {
    if (await page.evaluate(() => !!window.__op2?.view)) break;
    await sleep(500);
  }
  const all = await page.evaluate(() => window.__op2.views());
  const wanted = process.env.OP2_VIEWS === 'all' ? all : (process.env.OP2_VIEWS ?? '').split(',').filter(Boolean);
  const out = { report: await page.evaluate(() => window.__op2.world.report), views: {} };
  const stats = () => page.evaluate(() => {
    const s = window.__op2.stats();
    return { draws: s.draws, tris: s.tris, frameMs: +s.frameMs.toFixed(2), fps: +s.fps.toFixed(1) };
  });
  for (const v of wanted) {
    await page.evaluate(n => window.__op2.view(n), v);
    await sleep(Number(process.env.OP2_SETTLE ?? 700));
    out.views[v] = await stats();
    await shot(v).catch(e => console.error(`shot ${v} failed: ${e.message.split('\n')[0]}`));
  }
  const put = (name, pos, look) => page.evaluate(([n, p, l]) => {
    window.__op2.world.spec.views[n] = { pos: p, look: l };
    window.__op2.view(n);
  }, [name, pos, look]);
  const blast = (x, y, z, r, dmg) => page.evaluate(([x, y, z, r, dmg]) => {
    const w = window.__op2.world, V = w.bounds.max.constructor;
    const c = new V(x, y, z);
    w.objects.damageExplosivesInRadius(c, r, dmg, 'rocket');
    window.__op2.ctx.physics.radialImpulse(c, r, 900);
  }, [x, y, z, r, dmg]);
  const debris = () => page.evaluate(() => {
    const d = window.__op2.world.objects.walls.debris;
    return { bodies: d.bodies, pieces: d.pieces };
  });
  if (process.env.OP2_BLAST) {
    // The plank shack north of the fort at (17, -75): a rocket against its south-west corner.
    put('shackCam', [9.5, 2.6, -64.5], [17, 1, -76]);
    await sleep(600);
    await shot('shack-0');
    await blast(15.6, 0.6, -73.4, 6, 140);
    const frames = [];
    for (const [ms, name] of [[60, 'shack-1'], [180, 'shack-2'], [400, 'shack-3'], [900, 'shack-4'], [2600, 'shack-5']]) {
      await sleep(ms);
      frames.push({ name, ...(await debris()), ...(await stats()) });
      await shot(name);
    }
    out.shack = frames;
    // Three more shacks at once, for the caps.
    await blast(-20, 0.5, -73, 6, 160);
    await blast(-14, 0.5, -79, 6, 160);
    await blast(26, 0.5, -71, 6, 160);
    await sleep(300);
    out.caps = { ...(await debris()), ...(await stats()) };
    await sleep(9000);
    out.settled = { ...(await debris()), ...(await stats()) };
  }
  if (process.env.OP2_WALL) {
    // A segment of the outer north wall: two big blasts, the breach seen from the field and from the catwalk.
    put('wallCam', [-12, 1.7, -66], [-10, 3, -52]);
    await sleep(500);
    await blast(-10, 1.5, -53, 4, 700);
    await sleep(120);
    await shot('wall-1');
    await sleep(500);
    await shot('wall-2');
    await blast(-10, 1.5, -53, 4, 700);
    await sleep(2500);
    await shot('wall-3');
    put('wallDeck', [-6, 5.4, -50.8], [-11, 3, -56]);
    await sleep(600);
    await shot('wall-4');
    out.wall = { ...(await debris()), ...(await stats()) };
  }
  return out;
}
