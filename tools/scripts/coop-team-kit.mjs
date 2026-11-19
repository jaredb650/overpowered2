// Shared steps for the team-rules proofs (coop-team-*.mjs): a party of 2 to 4 pages in one browser over real WebRTC, each
// page its own browser context (its own localStorage, so its own stable player id), the bad-network switch, and the small
// things every proof does (go down, bleed out, wait for the board).
//
//   TEAM_PLAYERS=2|3|4   pages in the party (default 2)
//   TEAM_NET=bad         every page sends under lag 120 ms, jitter 40 ms, 5% loss (as resend stalls)
import { button, harness, joinFromSplash, quiet, readyUp, returning, startPair, DEFAULT_FPS } from './coop-kit.mjs';

export const PLAYERS = Math.max(2, Math.min(4, Number(process.env.TEAM_PLAYERS ?? 2)));
export const BAD_NET = process.env.TEAM_NET === 'bad';
/** lag:120, jitter:40, loss:0.05. The channels are reliable, so a lost packet arrives as a 400 ms resend stall. */
export const BAD = { lag: 120, jitter: 40, stall: 0.05 };
export const NAMES = ['HOST-ONE', 'GUEST-TWO', 'GUEST-THREE', 'GUEST-FOUR'];

/** One more guest on its own browser context, joined by the invite link, named and ready. */
export async function addGuest(host, invite, password, name, out, fps = Number(process.env.COOP_FPS ?? DEFAULT_FPS)) {
  const page = await host.context().browser().newPage({ viewport: host.viewportSize(), deviceScaleFactor: 2 });
  page.on('pageerror', error => out.errors.push(`${name}: ${error.message}`));
  await page.addInitScript(harness, fps); await page.addInitScript(quiet); await page.addInitScript(returning);
  await page.goto(invite);
  await joinFromSplash(page, password);
  await page.locator('.co-field input').first().fill(name); await page.locator('.co-field input').first().press('Enter');
  await readyUp(page);
  return page;
}

/** A lobby of `players` pages on `mode`, started. Returns every page, host first, and the invite link. */
export async function startParty(host, { mode, password, out, progress, sleep, players = PLAYERS }) {
  const { guest, invite } = await startPair(host, { mode, password, out, progress, sleep, startNow: false });
  const pages = [host, guest];
  for (let i = 2; i < players; i++) pages.push(await addGuest(host, invite, password, NAMES[i], out));
  await host.waitForFunction(n => document.querySelectorAll('.co-player').length >= n, players, { timeout: 60000 });
  await sleep(800);
  await button(host, mode).click(); await button(host, 'Start').click();
  progress(`countdown to ${mode} with ${players} players`);
  return { pages, invite };
}

/** Every page in the match, its world up, every other player's body in it. */
export async function allIn(pages, contract) {
  for (const page of pages) {
    await page.waitForURL(new RegExp(`contract=${contract}`), { timeout: 120000 });
    await page.waitForFunction(n => window.__op2?.ctx.coop?.world && window.__op2.ctx.coop.remotes.size >= n - 1
      && [...window.__op2.ctx.coop.remotes.values()].every(r => r.char.root.visible), pages.length, { timeout: 180000 });
    await page.evaluate(() => { window.__op2.game.setState('playing'); });
  }
  // Every guest's seat is settled (the host's `restore` came back): cards and kits count from here.
  for (const page of pages.slice(1)) await page.waitForFunction(() => window.__op2.ctx.coop.world.team.settled === true, null, { timeout: 30000 });
}

export const badNet = (pages, on = BAD_NET) => Promise.all(pages.map(page => page.evaluate(net => { Object.assign(window.__coopNet, net); }, on ? BAD : { lag: 0, jitter: 0, stall: 0 })));

/** Takes a page's player to 0 health through the same door the host's damage comes in by. */
export const down = page => page.evaluate(() => {
  const { ctx } = window.__op2;
  ctx.player.modifiers.invulnerable = false;
  const world = ctx.coop.world;
  world.receivingDamage = true;
  ctx.player.takeDamage({ amount: 5000, type: 'bullet', source: 'trooper' });
  world.receivingDamage = false;
});

export const invulnerable = (pages, on = true) => Promise.all(pages.map(page => page.evaluate(v => { window.__op2.ctx.player.modifiers.invulnerable = v; }, on)));

/** What a page shows of the run's end: the board, the solo screens (which must never show), the game's state. */
export const ending = page => page.evaluate(() => {
  const shown = sel => { const el = document.querySelector(sel); return !!el && getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0; };
  const { ctx, game } = window.__op2;
  return {
    board: shown('.cq-over .cq-end'), big: document.querySelector('.cq-over .cq-big')?.textContent ?? '', sub: document.querySelector('.cq-over .cq-sub')?.textContent ?? '',
    rows: document.querySelectorAll('.cq-over .cq-row:not(.cq-headrow)').length,
    buttons: [...document.querySelectorAll('.cq-over .cq-btn')].map(b => b.textContent),
    foot: document.querySelector('.cq-over .cq-foot')?.textContent ?? '',
    soloGameOver: shown('.scr-gameover:not(.scr-complete)'), soloComplete: shown('.scr-complete'), pause: shown('.scr-pause'),
    state: game.state, locked: !!document.pointerLockElement, time: ctx.time.elapsed, paused: ctx.time.paused === true,
    ending: ctx.coop?.world?.team.ending ?? null, coop: !!ctx.coop,
  };
});

/** Every page back on the lobby page of the same room, with `n` players listed. */
export async function backInLobby(pages, n = pages.length) {
  for (const page of pages) {
    await page.waitForFunction(count => window.__op2.game.state === 'menu' && document.querySelectorAll('.scr-coop .co-player').length === count
      && getComputedStyle(document.querySelector('.scr-coop')).display !== 'none', n, { timeout: 30000 });
  }
}

export const world = page => page.evaluate(() => {
  const { ctx } = window.__op2;
  return { time: ctx.time.elapsed, wave: ctx.waves.wave, phase: ctx.waves.phase, left: ctx.waves.nextWaveIn, enemies: ctx.enemies.alive.length };
});
