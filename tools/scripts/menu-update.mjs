// The menu update (owner, 2026-11-22), in the real game with a real mouse and keyboard.
//
// MENU_STEP=shop (default), in the Crucible: Procurement in the shops' order on each page, a row selected by hovering (card and
// model follow the mouse), the confirm form (Esc cancels, a click outside cancels, Enter buys), and Esc out of the shop and out
// of the pause menu with no "click" message left up.
//   node tools/shot.mjs --port 5281 --url "/?autostart=1" --script tools/scripts/menu-update.mjs --wait 500 --timeout 240 --dpr 2 --w 1440 --h 900 --out tools/out/menu-update/shop.png
//
// MENU_STEP=frame: the Frame's loadout screen from the main menu, fitted by keys and mouse, kept in storage; then the Test Range
// with `?frame=1` boards a Frame built from it, and the arms fire as fitted.
//   MENU_STEP=frame node tools/shot.mjs --port 5281 --url "/" --script tools/scripts/menu-update.mjs --wait 500 --timeout 240 --dpr 2 --w 1440 --h 900 --out tools/out/menu-update/frame.png
export default async function menuUpdate(page, h) {
  return process.env.MENU_STEP === 'frame' ? frame(page, h) : shop(page, h);
}

async function until(page, h, test, tries = 160) {
  for (let i = 0; i < tries; i++) {
    if (await page.evaluate(test)) return true;
    await h.sleep(250);
  }
  return false;
}

const state = page => page.evaluate(() => {
  const { ctx, game } = window.__op2;
  const rows = [...document.querySelectorAll('.scr-proc:not(.scr-frame) .pc-list > *')].map(el => el.classList.contains('pc-group')
    ? `# ${el.textContent}` : `${el.querySelector('.pc-k')?.textContent} | ${el.querySelector('.pc-v')?.textContent}${el.classList.contains('shut') ? ' (grey)' : ''}`);
  return {
    game: game.state, screen: ctx.hud.screens.name, locked: ctx.input.locked, credits: ctx.contracts.shop?.credits,
    focus: document.querySelector('.pc-row.focus .pc-k')?.textContent ?? null, card: document.querySelector('.scr-proc .pc-name')?.textContent ?? null,
    confirm: getComputedStyle(document.querySelector('.scr-proc .cf') ?? document.body).display !== 'none' && !!document.querySelector('.scr-proc .cf'),
    confirmText: document.querySelector('.scr-proc .cf-q')?.textContent ?? null,
    touch: document.querySelector('.touch-hint')?.style.display === '',
    hints: [...document.querySelectorAll('.pz-hint, .pc-note')].filter(e => e.offsetParent && e.textContent).map(e => e.textContent),
    rows,
  };
});

async function rowBox(page, name) {
  return page.evaluate(n => {
    const el = [...document.querySelectorAll('.scr-proc .pc-row')].find(r => r.querySelector('.pc-k')?.textContent === n);
    if (!el) return null;
    el.scrollIntoView({ block: 'nearest' });
    const b = el.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }, name);
}

async function shop(page, h) {
  const out = {};
  out.playing = await until(page, h, () => window.__op2?.game?.state === 'playing' && window.__op2.ctx.contracts.shop != null);
  // A long break after wave 6 with 3,000 credits: some things affordable, some not, some still locked.
  await page.evaluate(() => {
    const { ctx } = window.__op2;
    ctx.waves.wave = 6;
    ctx.waves.phase = 'intermission';
    ctx.waves.nextWaveIn = 900;
    ctx.contracts.shop.credits = 3000;
    for (const e of [...ctx.enemies.alive]) e.health = 0;
  });
  // A real click takes the mouse first, as a player's does.
  await page.mouse.click(720, 450);
  await h.sleep(600);
  out.lockedBeforeShop = await page.evaluate(() => window.__op2.ctx.input.locked);
  // E at a pod opens it: the page lets the mouse go itself.
  await page.evaluate(() => window.__op2.ctx.events.emit('shop:open', {}));
  await h.sleep(900);
  out.weapons = await state(page);
  await h.shot('1-weapons');
  await page.keyboard.press('ArrowRight');
  await h.sleep(500);
  out.mods = await state(page);
  await h.shot('2-mods');
  await page.keyboard.press('ArrowRight');
  await h.sleep(500);
  out.implants = await state(page);
  await h.shot('3-implants');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await h.sleep(400);

  // Hover: the keyboard's focus on the first row, then the mouse over another one. The card and the model follow the mouse.
  const first = (await state(page)).focus;
  const target = out.weapons.rows.find(r => !r.startsWith('#') && !r.includes('(grey)') && !r.startsWith(first) && /^\S/.test(r) && !/Ammunition|Health|Armour/.test(r) && /\d/.test(r.split('|')[1] ?? ''));
  const targetName = target?.split(' | ')[0];
  const box = await rowBox(page, targetName);
  await page.mouse.move(box.x - 40, box.y - 3);
  await page.mouse.move(box.x, box.y, { steps: 4 });
  await h.sleep(700);
  out.hover = { from: first, to: targetName, ...(await page.evaluate(() => ({
    focus: document.querySelector('.pc-row.focus .pc-k')?.textContent, card: document.querySelector('.scr-proc .pc-name')?.textContent,
  }))) };
  await h.shot('4-hover');

  // A click asks; Esc cancels; nothing is spent.
  const before = (await state(page)).credits;
  await page.mouse.click(box.x, box.y);
  await h.sleep(400);
  out.asked = await state(page);
  await h.shot('5-confirm');
  await page.keyboard.press('Escape');
  await h.sleep(300);
  out.afterEsc = { ...(await state(page)), spent: before - (await state(page)).credits };
  // A click outside the form cancels too.
  await page.mouse.click(box.x, box.y);
  await h.sleep(300);
  await page.mouse.click(1400, 60);
  await h.sleep(300);
  out.afterOutside = { confirm: (await state(page)).confirm, spent: before - (await state(page)).credits, screen: (await state(page)).screen };
  // Enter buys exactly the row that was clicked.
  await page.mouse.click(box.x, box.y);
  await h.sleep(300);
  await page.keyboard.press('Enter');
  await h.sleep(500);
  const bought = await state(page);
  out.afterEnter = { spent: before - bought.credits, owned: await page.evaluate(n => [...window.__op2.ctx.weapons.owned].includes(
    Object.entries(window.__op2.ctx.weapons.defs ?? {}).find(([, d]) => d.name === n)?.[0]), targetName), rows: bought.rows.slice(0, 8), focus: bought.focus };
  await h.shot('6-bought');

  // Esc out of the shop: back to the fight, and the mouse comes back without a click (the page let it go).
  await page.keyboard.press('Escape');
  await h.sleep(1200);
  out.escShop = await state(page);
  await h.shot('7-esc-shop');
  // The player's own Esc in play (headless keeps the key, so the lock is ended as Chrome does): the pause menu.
  if (out.escShop.locked) {
    await page.evaluate(() => document.exitPointerLock());
    await h.sleep(600);
  }
  out.paused = await state(page);
  await h.shot('8-paused');
  // As if the click's activation had run out (headless Chrome keeps it longer than a desktop one), then Esc: the menu goes and
  // no "browser wants a click" message is left up.
  await page.evaluate(() => Object.defineProperty(navigator, 'userActivation', { configurable: true, get: () => ({ isActive: false, hasBeenActive: true }) }));
  out.activeBeforeEsc = await page.evaluate(() => navigator.userActivation?.isActive);
  await page.keyboard.press('Escape');
  await h.sleep(800);
  out.escPause = await state(page);
  await h.shot('9-esc-pause');
  // Esc again from the prompt: the pause menu back. Esc once more, then a key: the run back.
  if (out.escPause.touch) {
    await page.keyboard.press('Escape');
    await h.sleep(500);
    out.escAgain = await state(page);
    await page.keyboard.press('Escape');
    await h.sleep(500);
    await page.keyboard.press('KeyW');
    await h.sleep(1500);
    out.afterKey = await state(page);
  }
  for (const k of ['weapons', 'mods', 'implants', 'paused', 'escShop', 'escPause', 'escAgain', 'afterKey']) if (out[k]?.rows && !['weapons', 'mods', 'implants'].includes(k)) delete out[k].rows;
  return out;
}

async function frame(page, h) {
  const out = {};
  await page.evaluate(() => localStorage.removeItem('op2.frame.loadout.v1'));
  await until(page, h, () => window.__op2?.ctx?.hud?.screens?.name === 'splash' || window.__op2?.ctx?.hud?.screens?.name === 'menu');
  await page.mouse.click(720, 450);
  await h.sleep(2500);
  const menuItems = await page.evaluate(() => [...document.querySelectorAll('.scr-menu .mm-list .mi')].map(e => e.textContent));
  out.menuItems = menuItems;
  const frameBtn = await page.evaluate(() => {
    const el = [...document.querySelectorAll('.scr-menu .mi')].find(e => e.textContent === 'Frame');
    const b = el?.getBoundingClientRect();
    return b ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null;
  });
  await page.mouse.click(frameBtn.x, frameBtn.y);
  await h.sleep(800);
  const read = () => page.evaluate(() => ({
    screen: window.__op2.ctx.hud.screens.name,
    slots: [...document.querySelectorAll('.scr-frame .pc-slot')].map(e => `${e.querySelector('.pc-slot-n').textContent}: ${e.querySelector('.pc-slot-v').textContent}`),
    focus: document.querySelector('.scr-frame .pc-row.focus .pc-k')?.textContent ?? null,
    card: document.querySelector('.scr-frame .pc-name')?.textContent ?? null,
    stored: localStorage.getItem('op2.frame.loadout.v1'),
  }));
  out.opened = await read();
  await h.shot('1-frame-default');
  // Keys: down to the left arm's 40 mm, Enter.
  await page.keyboard.press('ArrowDown');
  await h.sleep(150);
  await page.keyboard.press('Enter');
  await h.sleep(400);
  out.afterKeys = await read();
  // Mouse: hover the right arm's 105 mm (the card follows), click it.
  const box = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.scr-frame .pc-row')];
    const el = rows.filter(r => r.querySelector('.pc-k').textContent === '105 mm Howitzer')[1];
    const b = el.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });
  await page.mouse.move(box.x, box.y, { steps: 4 });
  await h.sleep(400);
  out.hover = await read();
  await page.mouse.click(box.x, box.y);
  await h.sleep(400);
  out.afterClick = await read();
  await h.shot('2-frame-fitted');
  await page.keyboard.press('Escape');
  await h.sleep(500);
  out.escBack = (await read()).screen;
  // The Test Range in a Frame: built from what was just fitted.
  await page.goto(page.url().replace(/\/(\?.*)?$/, '/?map=range&frame=1&autostart=1'));
  await until(page, h, () => window.__op2?.game?.state === 'playing' && !!window.__op2.ctx.progression?.callInsManager?.frame?.occupied
    || !!window.__op2?.ctx?.progression?.frame?.occupied);
  await h.sleep(1500);
  out.range = await page.evaluate(() => {
    const p = window.__op2.ctx.progression;
    const f = p.frame ?? p.callInsManager?.frame;
    return { occupied: f?.occupied, left: f?.guns.left.kind, right: f?.guns.right.kind, loadout: f?.loadout, rows: f?.guns.rows.map(r => r.name) };
  });
  await page.mouse.click(720, 450);
  await h.sleep(800);
  await h.shot('3-range-cockpit');
  return out;
}
