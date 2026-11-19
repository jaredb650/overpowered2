// Shared steps for the team-rules proofs (coop-team-*.mjs), on top of the co-op kit (coop-kit.mjs `startParty`).
//
//   TEAM_PLAYERS=2|3|4   pages in the party (each proof has its own default; 4 only where the proof is about four)
//   TEAM_NET=bad         every page under the game's network simulator: lag 120 ms, jitter 40 ms, 5% loss
//   COOP_NET=rtc|loop    the transport (the kit's own switch): loopback by default, real WebRTC with rtc
//
// One run at a time per lane (the machine is shared): `pgrep -fa "shot.mjs --port <your port>"` before starting one.
import { startParty } from './coop-kit.mjs';

export const BAD_NET = process.env.TEAM_NET === 'bad';
export const NET = 'lag:120,jitter:40,loss:0.05';
export const players = fallback => Math.max(2, Math.min(4, Number(process.env.TEAM_PLAYERS ?? fallback)));
export const netName = () => (BAD_NET ? NET : 'clean');

/** A party in a match of `mode`, every world up and every guest's seat settled, feeds recorded. */
export async function teamParty(host, { mode, count = 2, out, progress, sleep, password = 'team-rules' }) {
  const party = await startParty(host, { players: count, mode, net: BAD_NET ? NET : undefined, password, out, progress, sleep });
  await allIn(party.pages, party.mode.contract);
  return party;
}

/** Every page in the match, its world up, every other player's body in it, every guest's seat settled, the feed recorded. */
export async function allIn(pages, contract, others = pages.length - 1) {
  for (const page of pages) {
    await page.waitForURL(new RegExp(`contract=${contract}`), { timeout: 120000 });
    await page.waitForFunction(n => window.__op2?.ctx?.coop?.world && window.__op2.game.state !== 'menu' && window.__op2.ctx.coop.remotes.size >= n
      && [...window.__op2.ctx.coop.remotes.values()].every(r => r.char.root.visible), others, { timeout: 180000 });
    await page.evaluate(() => { window.__op2.game.setState('playing'); });
    await record(page);
  }
  // A guest's seat is settled once the host's `restore` has come back: cards and kits count from here.
  for (const page of pages) await page.waitForFunction(() => window.__op2.ctx.coop.world.team.settled === true, null, { timeout: 30000 });
}

/** Keeps every feed line, banner and callout a page shows from now on, in `window.__said`. */
export const record = page => page.evaluate(() => {
  if (window.__said) return;
  const said = (window.__said = []);
  const hud = window.__op2.ctx.hud;
  for (const name of ['feed', 'banner', 'callout']) {
    const real = hud[name].bind(hud);
    hud[name] = (...args) => { said.push(`${name}: ${args.filter(a => typeof a === 'string' && !a.startsWith('#')).join(' | ')}`); return real(...args); };
  }
});
export const said = (page, pattern) => page.evaluate(source => (window.__said ?? []).filter(line => new RegExp(source).test(line)), pattern.source);
export const waitSaid = (page, pattern, timeout = 15000) => page.waitForFunction(source => (window.__said ?? []).some(line => new RegExp(source).test(line)), pattern.source, { timeout });

/** Takes a page's player to 0 health through the same door the host's damage comes in by. */
export const down = page => page.evaluate(() => {
  const { ctx } = window.__op2;
  ctx.player.modifiers.invulnerable = false;
  const world = ctx.coop.world;
  world.receivingDamage = true;
  ctx.player.takeDamage({ amount: 5000, type: 'bullet', source: 'trooper' });
  world.receivingDamage = false;
});

/** Host: the downed player in `slot` bleeds out now. */
export const bleedOut = (host, slot) => host.evaluate(slot => {
  const { lobby, world } = window.__op2.ctx.coop;
  const id = lobby.players.find(p => p.slot === slot).id;
  world.team.life(id).bleedUntil = 0;
}, slot);

export const invulnerable = (pages, on = true) => Promise.all(pages.map(page => page.evaluate(v => { window.__op2.ctx.player.modifiers.invulnerable = v; }, on)));

/** Host: the wave is cleared, the game's own way: nothing left to feed and nobody left alive, so the director says so. */
export const clearWave = host => host.evaluate(() => {
  const { ctx } = window.__op2;
  const waves = ctx.waves;
  for (const enemy of [...ctx.enemies.alive]) ctx.enemies.withdraw(enemy);
  if (Array.isArray(waves.queue)) { if ('queueCursor' in waves) waves.queueCursor = waves.queue.length; if ('cursor' in waves) waves.cursor = waves.queue.length; }
  if (Array.isArray(waves.bossIds)) waves.bossIds.length = 0;
  ctx.enemies.queued = 0;
});

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
      && getComputedStyle(document.querySelector('.scr-coop')).display !== 'none', n, { timeout: 40000 });
  }
}

export const world = page => page.evaluate(() => {
  const { ctx } = window.__op2;
  const team = ctx.coop?.world?.team;
  return { time: ctx.time.elapsed, wave: ctx.waves.wave, phase: ctx.waves.phase, left: ctx.waves.nextWaveIn, enemies: ctx.enemies.alive.length,
    alive: ctx.player.alive, downed: ctx.player.downed === true, health: ctx.player.health,
    rest: team ? { on: team.rest.on, ready: [...team.rest.ready], need: team.rest.need } : null,
    cards: team ? [...team.cards.values()].map(c => ({ slot: c.slot, state: c.state, menu: c.menu, cheats: c.cheats })) : [] };
});

/** The co-op HUD as the page draws it: the break chip, the strip, the kill feed, the world markers. */
export const hudText = page => page.evaluate(() => {
  const shown = el => !!el && getComputedStyle(el).display !== 'none';
  const text = sel => [...document.querySelectorAll(sel)].filter(shown).map(el => el.textContent);
  return { rest: shown(document.querySelector('.cq-rest')) ? document.querySelector('.cq-rest').textContent : '', strip: text('.cq-mate'), kills: text('.cq-kill'),
    marks: text('.wl .mk').filter(Boolean), shop: shown(document.querySelector('.scr-procurement')) ? document.querySelector('.pc-phase')?.textContent ?? '' : null };
});
