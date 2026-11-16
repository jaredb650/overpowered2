// The main menu's tree in the real game: every level by mouse, Esc and Back at each, the rules button's round trip, and a
// mode that starts. A screenshot of each level, and what each one lists, read back.
//   node tools/shot.mjs --url "/?unlock=0" --script tools/scripts/menu-tree.mjs --dpr 2 --w 1440 --h 900 --wait 500 --out tools/out/menu/x.png
export default async function menuTree(page, { sleep, shot }) {
  const log = [];
  const read = () => page.evaluate(() => ({
    screen: window.__op2?.ctx?.hud?.screens?.name ?? null,
    crumb: document.querySelector('.mm-crumb')?.style.display === 'none' ? '' : document.querySelector('.mm-crumb')?.textContent,
    list: [...document.querySelectorAll('.scr-menu .mm-list .mi')].map(t => `${t.textContent}${t.classList.contains('off') ? ' [off]' : ''}${t.classList.contains('focus') ? ' [focus]' : ''}`),
    notice: document.querySelector('.mm-brief')?.style.display === 'none' ? null : document.querySelector('.nt-subject')?.textContent ?? null,
    rules: getComputedStyle(document.querySelector('.mm-brief > .mi')).display !== 'none',
  }));
  const click = async label => {
    await page.locator('.scr-menu .mm-list .mi').filter({ has: page.getByText(label, { exact: true }) }).click();
    await sleep(300);
  };
  const key = async k => {
    await page.keyboard.press(k);
    await sleep(200);
  };
  const note = async (label, name) => {
    if (name) await shot(name);
    log.push({ [label]: await read() });
  };

  await page.waitForFunction(() => window.__op2?.ctx?.hud?.screens?.name === 'splash', null, { timeout: 120000 });
  // The splash ignores a click in its first moment, so click until the menu is up.
  for (let i = 0; i < 10 && (await page.evaluate(() => window.__op2.ctx.hud.screens.name)) !== 'menu'; i++) {
    await sleep(1000);
    await page.mouse.click(720, 450);
  }
  await sleep(1500);
  await note('root', 'root');
  await click('Play');
  await note('play', 'play');
  await click('Campaign');
  await note('campaign', 'campaign');
  await key('ArrowDown');
  await note('campaignDown', 'campaign-2');
  await key('Escape');
  await note('escFromCampaign');
  await click('Survival');
  await note('survival', 'survival');
  for (const map of ['Crucible', 'Kill House', 'Outpost']) {
    await click(map);
    await note(map, `survival-${map.toLowerCase().replace(' ', '')}`);
    await click('Back');
    await note(`backFrom${map}`);
  }
  await key('ArrowDown');
  await key('ArrowDown');
  await key('ArrowDown');
  await note('survivalWalk');
  await click('Back');
  await note('backFromSurvival');
  await key('Escape');
  await note('escFromPlay');
  await key('Escape');
  await note('escAtRoot');
  // Keys only: Play, Down to Multiplayer and Enter on it, then Up to Survival, the Crucible, and its rules and back.
  await key('Enter');
  await key('ArrowDown');
  await key('ArrowDown');
  await key('Enter');
  await note('multiplayerEnter');
  await key('ArrowUp');
  await key('Enter');
  await key('Enter');
  await key('ArrowDown');
  await note('onRules');
  await key('Enter');
  await sleep(500);
  await note('rulesOpen');
  await key('Escape');
  await sleep(500);
  await note('backFromRules');
  await key('ArrowUp');
  await key('Enter');
  await page.waitForFunction(() => window.__op2?.game?.state === 'playing', null, { timeout: 15000 });
  log.push({ started: await page.evaluate(() => ({ state: window.__op2.game.state, url: location.search })) });
  return log;
}
