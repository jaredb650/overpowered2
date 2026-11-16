// A breakable going off in the real game, as a frame sequence: the waves are held, the player stands and looks, one prop is hit hard
// and the chain runs. Writes <out>-<scene>-0..N.png.
//
//   OFFICE_BOOM=break node tools/shot.mjs --port 5293 --url "/?contract=crucible&map=office&autostart=1&dev=1" --dpr 2 --w 1440 --h 900 \
//     --script tools/scripts/office-boom.mjs --out tools/out/office/boom.png --wait 500 --timeout 200
//
// Scenes: break (vending, cooler, microwave, chairs), server (a rack row), copy (copiers), yard (gas line and generator), glass.
const SCENES = {
  break: { at: [-22, 0, 16.5], look: [-17.5, 1.1, 6], hit: p => p.kind === 'vending' && p.spec.z > 9 },
  server: { at: [-15.2, 0, -12.2], look: [-26, 1.2, -9.5], hit: p => p.kind === 'rack' && p.spec.y === 0 && p.spec.x > -18 && p.spec.z < -12 },
  copy: { at: [-8, 0, -8], look: [-10, 1, -17], hit: p => p.kind === 'copier' && p.spec.y === 0 && p.spec.x < -10 },
  yard: { at: [-52, 0, 8], look: [-34, 1.5, -8], hit: p => p.kind === 'gasline' && p.spec.x < -28 && p.spec.z > 0 },
  glass: { at: [4, 4.4, 12], look: [-6, 5.8, 13], hit: null },
};

export default async function boom(page, h) {
  const name = process.env.OFFICE_BOOM ?? 'break';
  const scene = SCENES[name];
  const t0 = Date.now();
  while (Date.now() - t0 < 120000 && !(await page.evaluate(() => window.__op2?.game?.state === 'playing'))) await h.sleep(1000);
  await page.evaluate(([at, look]) => {
    const { ctx } = window.__op2;
    ctx.waves.update = () => {};
    for (const e of [...ctx.enemies.alive]) ctx.enemies.withdraw?.(e);
    const p = ctx.player;
    p.modifiers.invulnerable = true;
    p.teleport(p.position.clone().set(at[0], at[1] + 0.1, at[2]), 0);
    p.yaw = Math.atan2(-(look[0] - at[0]), -(look[2] - at[2]));
    p.pitch = Math.atan2(look[1] - (at[1] + 1.6), Math.hypot(look[0] - at[0], look[2] - at[2]));
  }, [scene.at, scene.look]);
  await h.sleep(1200);
  await h.shot(`${name}-0`);
  const fired = await page.evaluate(src => {
    const { ctx } = window.__op2;
    const props = ctx.world.objects.props;
    if (!src) {
      // Glass: shoot every pane of the meeting room's partition.
      let n = 0;
      for (const p of props.props) if (p.kind === 'pane' && p.alive && Math.abs(p.spec.x + 4) < 0.1 && p.spec.y > 4) { ctx.world.objects.damageExplosive(p.collider, 50, 'test'); n++; }
      return { panes: n };
    }
    const hit = new Function('return ' + src)();
    const target = props.props.find(hit);
    if (!target) return { none: true };
    ctx.world.objects.damageExplosive(target.collider, 1000, 'smg');
    return { kind: target.kind, at: [target.spec.x, target.spec.z] };
  }, scene.hit ? scene.hit.toString() : null);
  for (let i = 1; i <= 8; i++) {
    await h.sleep(i < 4 ? 90 : 260);
    await h.shot(`${name}-${i}`);
  }
  await h.sleep(2500);
  await h.shot(`${name}-after`);
  const stats = await page.evaluate(() => ({ ...window.__op2.ctx.world.objects.props.stats }));
  return { scene: name, fired, stats };
}
