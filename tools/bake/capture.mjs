// Contact sheets for the character sandbox, in one page load:
//   node tools/shot.mjs --url "/?sandbox=models&archetype=husk" --out tools/out/models.png --wait 8000 \
//     --script tools/bake/capture.mjs
// CAPTURE="husk,trooper" limits the cast, VIEWS="front,three,close" picks the views,
// GAIT="6" captures a run cycle at that speed instead of stills.
// ACTIONS="attackMelee,roar" captures three frames of each action.
// MAIM="legL;legL,legR;head" captures crawl and stumble cycles for each comma-separated cut set.
export default async function capture(page, { shot, sleep }) {
  const ids = process.env.CAPTURE?.split(',') ?? await page.evaluate(() => window.__m.archetypes);
  const views = (process.env.VIEWS ?? 'front,three,close').split(',');
  const gait = Number(process.env.GAIT ?? 0);
  const actions = process.env.ACTIONS?.split(',');
  const maim = process.env.MAIM?.split(';');
  await page.evaluate(() => window.__m.pause());
  for (const id of ids) {
    await page.evaluate(i => window.__m.show(i), id);
    if (actions) {
      for (const a of actions) {
        await page.evaluate(id2 => window.__m.show(id2), id);
        await page.evaluate(() => window.__m.camera(window.__view ?? 'three'));
        const dur = await page.evaluate(n => window.__m.playAction(n), a);
        for (const t of [0.25, 0.5, 0.75]) {
          await page.evaluate(([d]) => { const n = Math.round(d * 0.25 * 60); for (let i = 0; i < n; i++) window.__m.step(1 / 60); }, [dur]);
          await sleep(220);
          await shot(`${id}-${a}-${Math.round(t * 100)}`);
        }
      }
      continue;
    }
    if (maim) {
      for (const [i, set] of maim.entries()) {
        await page.evaluate(id2 => window.__m.show(id2), id);
        await page.evaluate(([cuts, s]) => {
          window.__m.cut(cuts.split(','));
          window.__m.setSpeed(s);
          window.__m.camera('three');
          for (let k = 0; k < 120; k++) window.__m.step(1 / 60);
        }, [set, Number(process.env.SPEED ?? 2.2)]);
        for (let f = 0; f < 3; f++) {
          await page.evaluate(() => { for (let k = 0; k < 11; k++) window.__m.step(1 / 60); });
          await sleep(220);
          await shot(`${id}-maim${i}-${f}`);
        }
      }
      continue;
    }
    if (gait) {
      await page.evaluate(s => { window.__m.setSpeed(s); window.__m.camera('side'); for (let i = 0; i < 90; i++) window.__m.step(1 / 60); }, gait);
      for (let f = 0; f < 6; f++) {
        await page.evaluate(() => { for (let i = 0; i < 4; i++) window.__m.step(1 / 60); });
        await sleep(250);
        await shot(`${id}-gait${f}`);
      }
      continue;
    }
    for (const v of views) {
      await page.evaluate(n => window.__m.camera(n), v);
      await sleep(300);
      await shot(`${id}-${v}`);
    }
  }
  return ids.length;
}
