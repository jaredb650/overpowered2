// Foreclosure's skeleton in real Chrome: the gunship sortie with the squad below, a battle beside the wall, the sky shut in the stacks,
// and the menu's tab shut until the Outpost is won.
//
//   node tools/shot.mjs --url "/?contract=foreclosure&beat=overwatch&autostart=1" --script tools/scripts/foreclosure-live.mjs \
//     --out tools/out/foreclosure/f.png --wait 500 --timeout 240 --dpr 2 --w 1440 --h 900
export default async function foreclosureLive(page, h) {
  const log = [];
  const read = () => page.evaluate(() => {
    const op2 = window.__op2;
    const d = op2?.campaign?.runner?.describe();
    if (!d) return null;
    const { ctx } = op2;
    return { ...d, parked: ctx.player.parked, allies: ctx.allies?.allies.length ?? null, sky: ctx.progression.callInsManager?.shut ?? null };
  });
  const until = async (beat, seconds) => {
    for (let t = 0; t < seconds * 4; t++) {
      const d = await read();
      if (d?.beat === beat) return d;
      await h.sleep(250);
    }
    throw new Error(`timed out waiting for ${beat}: ${JSON.stringify(await read())}`);
  };
  const at = async (beat, wait, name) => {
    if (beat !== 'overwatch') await page.goto(page.url().replace(/beat=[a-z]+/, `beat=${beat}`));
    await until(beat, 60);
    await h.sleep(wait);
    await h.shot(name);
    log.push({ name, ...(await read()) });
  };

  await at('overwatch', 6000, '1-overwatch');
  await at('wall', 8000, '2-wall');
  await at('stacks', 3000, '3-stacks');
  await page.goto(page.url().replace(/\?.*$/, '?contract=foreclosure&unlock=0'));
  await h.sleep(4000);
  log.push({ name: 'menu', shut: await page.evaluate(() => [...document.querySelectorAll('.lock')].map(e => e.textContent?.trim().slice(0, 40))) });
  await h.shot('4-menu');
  return log;
}
