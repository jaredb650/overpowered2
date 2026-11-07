// The Outpost map under the real mission: doors, racks and marks in the real game. Takes the beats to visit from OP2_BEAT.
//   OP2_BEAT=breach node tools/shot.mjs --url "/?contract=outpost&map=outpost&mission=outpost&beat=breach&autostart=1" --script tools/scripts/outpost-map-live.mjs --out tools/out/opl.png --wait 500 --timeout 150
const STOPS = {
  lockout: [['lz', -32, -3, 92, 0], ['rim', -32, 0, 71, 0.1], ['approach', 2, 0, 36, 0]],
  breach: [['mouth', 0, 0, 24, 0], ['yard', 0, 0, 8, 0], ['closing', 0, 0, 2, 0]],
  barracks: [['sally', 0, 0, -18, 0.6], ['corridor', -14, 0, -17.5, 1.57]],
  plates: [['armoury', 44, 0, -36, 3.14], ['hall', 30, 0, -24, 1.57]],
  commander: [['glass', 0, 10, -62, 0], ['room', 4, 10, -70, 1.57]],
};
export default async function live(page, h) {
  const beat = process.env.OP2_BEAT ?? 'breach';
  const log = [];
  for (let i = 0; i < 160; i++) {
    if (await page.evaluate(() => !!window.__op2?.campaign?.runner?.describe().beat)) break;
    await h.sleep(500);
  }
  const read = () => page.evaluate(() => {
    const d = window.__op2.campaign.runner.describe();
    return { beat: d.beat, state: d.state, doors: d.doors, tags: d.tags };
  });
  await h.sleep(3000);
  log.push(await read());
  for (const [name, x, y, z, yaw] of STOPS[beat] ?? []) {
    await page.evaluate(([x, y, z, yaw]) => {
      const { player } = window.__op2.ctx;
      player.teleport(player.position.clone().set(x, y, z), yaw);
    }, [x, y + 0.05, z, yaw]);
    await h.sleep(1600);
    await h.shot(`${beat}-${name}`).catch(e => console.error(e.message.split('\n')[0]));
    log.push({ name, ...(await read()) });
  }
  return log;
}
