// Plays the stub mission through in real Chrome: every beat, a death and a redeploy, the door, the rack and the ending.
//
//   node tools/shot.mjs --url "/?mission=stub&map=killhouse&autostart=1" --script tools/scripts/campaign-live.mjs --out tools/out/campaign.png --wait 500 --timeout 140
//   add --dpr 2 --w 1440 --h 900 for the owner's screen
export default async function campaignLive(page, h) {
  const log = [];
  const read = () => page.evaluate(() => window.__op2?.campaign?.runner.describe() ?? null);
  const note = async label => {
    const d = await read();
    log.push({ label, beat: d?.beat, state: d?.state, deaths: d?.deaths, objectives: d?.objectives, tags: d?.tags, doors: d?.doors });
    return d;
  };
  const until = async (test, seconds, label) => {
    for (let t = 0; t < seconds * 4; t++) {
      const d = await read();
      if (d && test(d)) return d;
      await h.sleep(250);
    }
    throw new Error(`timed out waiting for ${label}: ${JSON.stringify(await read())}`);
  };
  const press = action => page.evaluate(async a => {
    const { input } = window.__op2.ctx;
    input.simulate(a, true);
    await new Promise(r => setTimeout(r, 120));
    input.simulate(a, false);
  }, action);
  const goto = (x, y, z) => page.evaluate(([x, y, z]) => {
    const { player } = window.__op2.ctx;
    player.teleport(player.position.clone().set(x, y, z));
  }, [x, y, z]);

  await until(d => d.beat === 'briefing', 60, 'briefing');
  await h.sleep(2500);
  await h.shot('1-cutscene');
  await note('cutscene');
  await press('interact');

  await until(d => d.beat === 'insertion', 8, 'insertion');
  await h.sleep(5000);
  await h.shot('2-doorgun');
  await note('door gun');
  await press('interact');

  await until(d => d.beat === 'lockout', 10, 'lockout');
  await h.sleep(800);
  await h.shot('3-lockout');
  await note('lockout');
  await goto(-3.5, 0.1, -7.5);
  await until(d => d.beat === 'contact', 8, 'contact');
  await h.sleep(1500);
  await h.shot('4-door-shut');
  await note('door shut');
  const blocked = await page.evaluate(() => {
    const { physics, player } = window.__op2.ctx;
    const from = player.position.clone().set(-3.5, 1.2, -7.5);
    const dir = player.position.clone().set(0, 0, -1);
    return physics.raycast(from, dir, 3)?.distance ?? null;
  });
  log.push({ label: 'ray through the shut door stops at', blocked });

  await h.sleep(5000);
  await note('squads in');
  const men = await page.evaluate(() => window.__op2.ctx.enemies.alive.length);
  log.push({ label: 'men alive', men });
  await h.shot('5-contact');

  await page.evaluate(() => window.__op2.ctx.player.takeDamage({ amount: 9999, type: 'true', source: 'test' }));
  await h.sleep(600);
  await h.shot('6-dead');
  await until(d => d.state === 'running' && d.deaths === 1, 8, 'redeploy');
  await h.sleep(900);
  log.push({ label: 'radio', radio: await page.evaluate(() => { const b = document.querySelector('.ms-radio'); return b ? [b.className, b.textContent, getComputedStyle(b).display] : null; }) });
  await h.shot('7-redeployed');
  await note('redeployed');
  log.push({ label: 'kit after the restart', ...(await page.evaluate(() => {
    const { weapons, player, progression } = window.__op2.ctx;
    return { owned: [...weapons.owned], health: player.health, alive: player.alive, score: progression.score, state: window.__op2.game.state };
  })) });

  await h.sleep(5000);
  for (let i = 0; i < 12; i++) {
    await page.evaluate(() => window.__op2.ctx.enemies.killAll('test'));
    await h.sleep(500);
    if ((await read()).beat === 'armoury') break;
  }
  await until(d => d.beat === 'armoury', 10, 'armoury');
  await h.sleep(1200);
  await h.shot('8-rack');
  await note('rack');
  await goto(0, 0.1, 5);
  await until(d => d.state === 'won', 12, 'the end');
  await h.sleep(1200);
  await h.shot('9-won');
  await note('won');
  await h.sleep(3000);
  log.push({ label: 'screen', state: await page.evaluate(() => window.__op2.game.state) });
  await h.shot('10-over');
  return log;
}
