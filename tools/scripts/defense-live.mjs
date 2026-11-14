// Outpost Defense's economy on real keys: the loadout, the break on the HUD, each shop's menu, a purchase, a weapon refused
// under fire, and a lost shop with its rebuild.
//   node tools/shot.mjs --url "/?contract=defense&autostart=1" --script tools/scripts/defense-live.mjs --wait 500 --timeout 240 --dpr 2 --w 1440 --h 900 --out tools/out/economy/x.png
export default async function defenseLive(page, h) {
  const screen = () => page.evaluate(() => window.__op2?.ctx?.hud?.screens?.name ?? null);
  const state = () => page.evaluate(() => {
    const { ctx, game } = window.__op2;
    const d = ctx.contracts.defense;
    return {
      game: game.state, screen: ctx.hud.screens.name, credits: d.credits, wave: ctx.waves.wave, phase: ctx.waves.phase,
      next: Math.round(ctx.waves.nextWaveIn), owned: [...ctx.weapons.owned], stims: ctx.progression.stims.count,
      callIns: [...ctx.progression.callIns], lost: Object.fromEntries(Object.entries(d.shops).map(([k, s]) => [k, s.lost])),
      squad: ctx.allies?.allies.length ?? 0,
    };
  });
  const until = async (test, tries = 120) => {
    for (let i = 0; i < tries; i++) {
      if (await test()) return true;
      await h.sleep(250);
    }
    return false;
  };
  const out = {};
  out.loadoutUp = await until(async () => (await screen()) === 'loadout', 240);
  await h.sleep(600);
  await h.shot('loadout');
  // Up from Deploy is the Rivet, then the Judge: pick the Judge, see the change, then back to the Rivet.
  out.focus = await page.evaluate(() => document.querySelector('.scr-loadout .focus')?.textContent);
  await h.press('ArrowUp', 60);
  await h.press('ArrowUp', 60);
  await h.press('Enter', 60);
  await h.sleep(200);
  out.withJudge = await page.evaluate(() => document.querySelector('.scr-loadout .sp-wallet')?.textContent);
  await h.shot('loadout-judge');
  await h.press('ArrowDown', 60);
  await h.press('Enter', 60);
  await h.press('ArrowDown', 60);
  out.deployFocus = await page.evaluate(() => document.querySelector('.scr-loadout .focus')?.textContent);
  await h.press('Enter', 60);
  out.playing = await until(async () => (await page.evaluate(() => window.__op2.game.state)) === 'playing', 40);
  await h.sleep(800);
  out.deployed = await state();
  await h.shot('break-hud');

  const visit = async (x, z, name) => {
    await page.evaluate(([px, pz]) => {
      const { ctx } = window.__op2;
      ctx.player.teleport(new ctx.player.position.constructor(px, 0.1, pz - 1.6), Math.PI);
    }, [x, z]);
    await h.sleep(400);
    await h.shot(`${name}-counter`);
    await h.press('e', 80);
    return until(async () => (await screen()) === 'shop', 20);
  };
  const leave = async () => {
    await h.press('e', 80);
    await until(async () => (await page.evaluate(() => window.__op2.game.state)) === 'playing', 40);
    await h.sleep(300);
  };

  await page.evaluate(() => window.__defense.earn(4000));
  out.barracksOpen = await visit(-16, 21, 'barracks');
  await h.shot('barracks');
  await h.press('Enter', 60); // hires the rifleman on the first row
  await h.sleep(200);
  out.afterHire = await state();
  await h.shot('barracks-hired');
  await leave();

  out.armouryOpen = await visit(-8, 23, 'armoury');
  await h.shot('armoury');
  // Down to the first call-in and buy it.
  out.bought = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.scr-shop .sp-row')];
    const i = rows.findIndex(r => r.textContent.startsWith('AIRSTRIKE'));
    rows[i].click();
    return document.querySelector('.scr-shop .set-note')?.textContent;
  });
  await h.sleep(200);
  await h.shot('armoury-bought');
  await page.evaluate(() => document.querySelector('.scr-shop .sh-body').scrollTo(0, 99999));
  await h.shot('armoury-bottom');
  await leave();
  out.afterArmoury = await state();

  out.infirmaryOpen = await visit(0, 24, 'infirmary');
  await h.shot('infirmary');
  await h.press('Enter', 60);
  await h.sleep(200);
  out.afterStim = await state();
  await leave();

  // A wave: weapons are refused under fire.
  await page.evaluate(() => window.__defense.skipBreak());
  await until(async () => (await page.evaluate(() => window.__op2.ctx.waves.phase)) !== 'intermission', 40);
  await h.sleep(1500);
  await h.shot('wave-hud');
  await visit(-8, 23, 'armoury-wave');
  out.underFire = await page.evaluate(() => [...document.querySelectorAll('.scr-shop .sp-row')].slice(0, 3).map(r => r.textContent));
  await h.shot('armoury-wave');
  await leave();

  // Lose the infirmary and come back to it.
  await page.evaluate(() => window.__defense.damageShop('infirmary', 99999));
  await h.sleep(500);
  await h.shot('infirmary-lost-hud');
  await visit(0, 24, 'infirmary-lost');
  out.lostOffers = await page.evaluate(() => [...document.querySelectorAll('.scr-shop .sp-row')].map(r => r.textContent));
  await h.shot('infirmary-lost');
  await leave();
  out.end = await state();
  return out;
}
