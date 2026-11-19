// Session fixes, proof 1: a dead line and the same page back (fix-session items 1 to 4).
//
// Three players in the Crucible. One guest's line goes dead (the simulator's `cut`: nothing leaves that page and nothing
// arrives, reliable lanes included) while every page keeps running, which is what a dropped connection is. While it is
// dead: the wave is cleared and the host votes, that guest switches Ghost on, picks up a gun and goes down. Then the
// line comes back, on the same page.
//
//   part 1  the host keeps the seat; the guest's slow-mo is let go; on return the guest gets the wave event it missed (its
//           pay, the break, the clock as it stands, the vote) and no second seat; what it said once is said again: the
//           host has it down, has its Ghost, has its newer kit, shows the others its gun
//   part 2  the last one standing loses their link: no wipe for ten seconds, and none at all if they are back in time
//   part 3  not back in time: the wipe, and no sooner
//
//   TEAM_PLAYERS=3 (default; 2 and 4 work), TEAM_NET=bad, COOP_NET=rtc: see coop-team-kit.mjs.
//   node tools/shot.mjs --port 5510 --w 1280 --h 720 --wait 500 --timeout 900 \
//     --script tools/scripts/coop-fixsession-return.mjs --out tools/out/coop/fix-session/return.png
import { writeFileSync } from 'node:fs';
import { give, kit, skipBreak } from './coop-kit.mjs';
import { BAD_NET, clearWave, down, ending, invulnerable, netName, players, said, teamParty, world } from './coop-team-kit.mjs';

const PLAYERS = players(3);
const ONLY = (process.env.FIX_ONLY ?? '').split(',').filter(Boolean);
const part = name => ONLY.length === 0 || ONLY.includes(name);

/** The host's word on one player: the lobby's row, the team's life, the flags the world keeps for them. */
const hostHas = (host, slot) => host.evaluate(slot => {
  const { ctx } = window.__op2;
  const { lobby, world } = ctx.coop;
  const p = lobby.players.find(player => player.slot === slot);
  if (!p) return { listed: false };
  const seat = world.team.seats.get(world.team.seatKey(p.id));
  return { listed: true, id: p.id, state: p.state ?? '', away: !!p.away, life: world.team.life(p.id).state, ghost: world.targeting.ghosts.has(p.id),
    kit: seat?.kit?.guns.map(g => g.weapon).sort() ?? [], held: world.shots.kits.get(p.id)?.weapon ?? '', body: ctx.coop.remotes.has(p.id),
    slows: world.slows.map(e => e.slot), ending: world.team.ending, wave: ctx.waves.wave, phase: ctx.waves.phase, left: ctx.waves.nextWaveIn };
}, slot);

const cut = (page, on) => page.evaluate(on => { window.__op2.net.sim.cut(on); }, on);
const credits = page => page.evaluate(() => window.__op2.ctx.contracts.wallet.credits);
const waitFor = async (read, test, what, timeout, sleep) => {
  const end = Date.now() + timeout;
  let last;
  for (;;) {
    last = await read();
    if (test(last)) return last;
    if (Date.now() > end) throw new Error(`Timed out waiting for: ${what} :: ${JSON.stringify(last).slice(0, 900)}`);
    await sleep(200);
  }
};

export default async function (host, { sleep, outDir }) {
  const out = { players: PLAYERS, net: netName(), transport: process.env.COOP_NET ?? 'loop', errors: [], checks: [], screenshots: [], times: {} };
  const tag = `return-${PLAYERS}p${BAD_NET ? '-bad' : ''}`;
  const { check, progress, shot } = kit(outDir, tag, out, sleep);
  let pages = [host];
  try {
    const party = await teamParty(host, { mode: 'crucible', count: PLAYERS, out, progress, sleep });
    pages = party.pages;
    const guest = pages[1];
    const others = pages.filter(page => page !== guest && page !== host);
    const slot = await guest.evaluate(() => window.__op2.ctx.coop.lobby.me.slot);
    const name = await guest.evaluate(() => window.__op2.ctx.coop.lobby.me.name);
    await invulnerable(pages, true);
    await skipBreak(host);
    await host.waitForFunction(() => window.__op2.ctx.waves.wave >= 1 && window.__op2.ctx.waves.phase !== 'intermission', null, { timeout: 60000, polling: 250 });
    // The wave ends only when the proof says so: the host's enemies stand still and cannot be hurt.
    const freeze = () => host.evaluate(() => { for (const e of window.__op2.ctx.enemies.alive) { e.behaviours = []; e.attacks = []; e.mode = 'hold'; e.invulnerable = true; } });
    await freeze();
    // Ghost by the page's own word: the perk's switch is the game's, the wire and the host's flag are what is proven.
    await guest.evaluate(() => {
      const p = window.__op2.ctx.progression;
      const real = p.isActive.bind(p);
      window.__ghost = false;
      p.isActive = id => (id === 'ghost' ? window.__ghost : real(id));
    });
    // Every wave event each page's game hears, in order.
    for (const page of pages) await page.evaluate(() => {
      const heard = (window.__waves = []);
      const { events } = window.__op2.ctx;
      events.on('wave:clear', e => heard.push(`clear ${e.wave} ${e.bonus}`));
      events.on('wave:start', e => heard.push(`start ${e.wave}`));
    });
    const wavesOf = page => page.evaluate(() => [...window.__waves]);
    await sleep(2500);

    if (part('return')) {
      progress('part 1: the guest slows the world, then its line goes dead');
      await guest.evaluate(() => { window.__op2.ctx.time.pushScale('timeWarp', 0.4, 0.2, 0.4); });
      await waitFor(() => hostHas(host, slot), h => h.slows.includes(slot), 'the host slowing the world for the guest', 10000, sleep);
      const before = { credits: await credits(guest), feed: (await said(guest, /./)).length, host: await hostHas(host, slot) };
      check(before.host.life === 'up' && !before.host.ghost && before.host.body, 'before the cut the host has the guest up, in the world, with no Ghost', before.host);
      const cutAt = Date.now();
      await cut(guest, true);
      const lost = await waitFor(() => hostHas(host, slot), h => h.state === 'lost', 'the host listing the guest as lost', 40000, sleep);
      out.times.lostAfter = (Date.now() - cutAt) / 1000;
      check(lost.away && !lost.body, 'the host keeps the seat and takes the body out of the world', lost);
      check(!lost.slows.includes(slot), 'the lost guest\'s slow-mo is let go at once', lost.slows);
      for (const other of others) {
        const row = await other.evaluate(slot => { const { lobby, remotes } = window.__op2.ctx.coop; const p = lobby.players.find(q => q.slot === slot); return { state: p?.state ?? '', body: !!p && remotes.has(p.id) }; }, slot);
        check(row.state === 'lost' && !row.body, 'the other guest sees the seat lost and no body', row);
      }
      const line = await guest.evaluate(() => { const el = document.querySelector('.cs-line'); return el && el.style.display !== 'none' ? el.textContent : ''; });
      check(/^Reconnecting to host… \d+$/.test(line), 'the cut-off guest reads "Reconnecting to host…"', line);

      progress('behind the dead line: Ghost on, a new gun (a rocket launcher), down; on the host: the wave is cleared and the host is ready');
      await guest.evaluate(() => { window.__op2.ctx.time.popScale('timeWarp'); window.__ghost = true; });
      await give(guest, 'rocket');
      await down(guest);
      await sleep(2600);
      await clearWave(host);
      await host.waitForFunction(() => window.__op2.ctx.waves.phase === 'intermission', null, { timeout: 30000, polling: 200 });
      await host.evaluate(() => { const { lobby, world } = window.__op2.ctx.coop; world.team.rest.vote(lobby.you); });
      await sleep(1500);
      const away = await hostHas(host, slot);
      check(away.life === 'up' && !away.ghost && !away.kit.includes('rocket'), 'the host has heard none of it: still up, no Ghost, the old kit', away);
      const guestAway = await world(guest);
      check(guestAway.downed && guestAway.phase !== 'intermission' && !guestAway.rest.on, 'the guest is down on its own screen and has not heard of the break', guestAway);

      progress('the line comes back, on the same page');
      const backAt = Date.now();
      await cut(guest, false);
      const back = await waitFor(() => hostHas(host, slot), h => h.listed && !h.state && !h.away && h.body, 'the host listing the guest as in again', 40000, sleep);
      out.times.backAfter = (Date.now() - backAt) / 1000;
      const url = await guest.evaluate(() => location.search);
      check(url.includes('contract=crucible'), 'the same page (no reload)', url);
      // The wave it missed: the break on its screen with the host's clock of now, the vote, and the wave's pay.
      const now = await waitFor(() => world(guest), w => w.phase === 'intermission' && w.rest.on, 'the break on the returning guest\'s screen', 15000, sleep);
      const hostNow = await world(host);
      check(Math.abs(now.left - hostNow.left) < 4 && now.wave === hostNow.wave, 'the break clock is the host\'s of now, not of when the wave was cleared', [now.left, hostNow.left]);
      check(now.rest.ready.includes(0), 'the host\'s vote is on the returning guest\'s screen', now.rest);
      const heard = { host: await wavesOf(host), guest: await wavesOf(guest) };
      const cleared = heard.host.filter(w => w.startsWith('clear'));
      check(cleared.length === 1 && JSON.stringify(heard.guest.filter(w => w.startsWith('clear'))) === JSON.stringify(cleared),
        'the wave event it missed is replayed on its own game, once, with the host\'s pay', heard);
      out.paidOnReturn = await credits(guest) - before.credits;
      const lines = (await said(guest, /./)).slice(before.feed);
      check(!lines.some(l => /joined late|REJOINED|YOU LEFT DOWN/.test(l)), 'it is not told it joined late, and no seat is put back over what it holds', lines);
      out.returnLines = lines;
      // What it said once behind the dead line is said again.
      const told = await waitFor(() => hostHas(host, slot), h => h.life === 'down' && h.ghost && h.kit.includes('rocket') && h.held === 'rocket',
        'the host having the guest down, its Ghost, its newer kit and the gun in its hands', 20000, sleep);
      out.times.resaidAfter = (Date.now() - backAt) / 1000;
      check(told.life === 'down', '"I am down" reached the host after the line came back', told);
      check(told.ghost, 'Ghost switched on behind the dead line is in force on the host', told);
      check(told.kit.includes('rocket'), 'the kit as it changed behind the dead line is the one the host keeps', told.kit);
      check(told.held === 'rocket', 'the gun in hand is the one the others are shown', told.held);
      for (const page of [host, ...others]) {
        const downLine = await said(page, new RegExp(`${name} IS DOWN`));
        if (page === host) check(downLine.length >= 1, 'the host\'s feed says the guest is down', downLine);
      }
      await guest.evaluate(() => { window.__ghost = false; });
      await waitFor(() => hostHas(host, slot), h => !h.ghost, 'the host dropping the Ghost when it ends', 10000, sleep);
      check(true, 'Ghost ends on the host when the guest\'s ends');
      await shot(host, 'back');
      // The next wave gets everyone up.
      await skipBreak(host);
      await waitFor(() => world(guest), w => w.alive && !w.downed, 'the guest on its feet as the next wave starts', 30000, sleep);
      await invulnerable(pages, true);
    }

    if (part('grace') || part('wipe')) {
      await host.waitForFunction(() => window.__op2.ctx.waves.phase !== 'intermission' && window.__op2.ctx.enemies.alive.length > 0, null, { timeout: 60000, polling: 250 });
      await freeze();
    }

    if (part('grace')) {
      progress('part 2: everyone else is down and the last one standing loses their line, then comes back');
      for (const page of pages) if (page !== guest) await down(page);
      await waitFor(() => host.evaluate(() => { const { world } = window.__op2.ctx.coop; return [...world.team.lives.values()].filter(l => l.state === 'down').length; }),
        n => n === PLAYERS - 1, 'the host having everyone but the guest down', 15000, sleep);
      // Nobody bleeds out while the proof waits on the silence rule.
      await host.evaluate(() => { for (const life of window.__op2.ctx.coop.world.team.lives.values()) life.bleedUntil = performance.now() + 600000; });
      const cutAt = Date.now();
      await cut(guest, true);
      const lost = await waitFor(() => hostHas(host, slot), h => h.state === 'lost', 'the host listing the last one standing as lost', 40000, sleep);
      const lostAt = Date.now();
      out.times.graceLostAfter = (lostAt - cutAt) / 1000;
      check(lost.ending === null, 'losing the last one standing is not a wipe on that frame', lost);
      await sleep(4000);
      const held = await hostHas(host, slot);
      const board = await ending(host);
      check(held.ending === null && !board.board, 'four seconds on there is still no wipe and no board', [held.ending, board.board]);
      const mended = Date.now();
      await cut(guest, false);
      await waitFor(() => hostHas(host, slot), h => h.listed && !h.state && !h.away, 'the last one standing back in the world', 40000, sleep);
      out.times.graceBackAfter = (Date.now() - mended) / 1000;
      await sleep(Math.max(0, 11000 - (Date.now() - lostAt)) + 2000);
      const after = await hostHas(host, slot);
      check(after.ending === null && !(await ending(host)).board, 'back in time: the run goes on, well past the ten seconds', after);
      await shot(host, 'grace');
      // Everyone up again for the next part.
      await host.evaluate(() => { window.__op2.ctx.coop.world.team.respawnAll(); });
      await waitFor(() => host.evaluate(() => [...window.__op2.ctx.coop.world.team.lives.values()].every(l => l.state === 'up')), all => all, 'everyone up again', 15000, sleep);
      await invulnerable(pages, true);
      await sleep(1000);
    }

    if (part('wipe')) {
      progress('part 3: the same, and the last one standing does not come back');
      for (const page of pages) if (page !== guest) await down(page);
      await waitFor(() => host.evaluate(() => { const { world } = window.__op2.ctx.coop; return [...world.team.lives.values()].filter(l => l.state === 'down').length; }),
        n => n === PLAYERS - 1, 'the host having everyone but the guest down', 15000, sleep);
      await host.evaluate(() => { for (const life of window.__op2.ctx.coop.world.team.lives.values()) life.bleedUntil = performance.now() + 600000; });
      await cut(guest, true);
      await waitFor(() => hostHas(host, slot), h => h.state === 'lost', 'the host listing the last one standing as lost', 40000, sleep);
      const lostAt = Date.now();
      await sleep(7000);
      check((await hostHas(host, slot)).ending === null, 'seven seconds after the loss: no wipe yet', null);
      const wiped = await waitFor(() => hostHas(host, slot), h => h.ending === 'wipe' || !h.listed, 'the wipe once the ten seconds are up', 15000, sleep);
      out.times.wipeAfterLoss = (Date.now() - lostAt) / 1000;
      check(wiped.ending === 'wipe' && out.times.wipeAfterLoss > 8.5 && out.times.wipeAfterLoss < 14, 'the wipe comes at ten seconds, not before and not much after', out.times.wipeAfterLoss);
      for (const page of pages) if (page !== guest) {
        await page.waitForFunction(() => { const el = document.querySelector('.cq-over .cq-end'); return !!el && getComputedStyle(el).display !== 'none'; }, null, { timeout: 20000, polling: 250 });
        const board = await ending(page);
        check(board.board && /WIPED/.test(board.big) && !board.soloGameOver, 'the team board on every page still connected', board);
      }
      await shot(host, 'wipe');
      // The cut-off page gets the board too when its line returns: the run ended while it was away.
      await cut(guest, false);
      const landed = await guest.waitForFunction(() => {
        const el = document.querySelector('.cq-over .cq-end');
        if (el && getComputedStyle(el).display !== 'none') return 'board';
        return window.__op2.game.state === 'menu' && document.querySelector('.scr-coop') ? 'lobby' : false;
      }, null, { timeout: 40000, polling: 250 }).then(handle => handle.jsonValue());
      out.cutOffGuestLanded = landed;
      check(landed === 'board' || landed === 'lobby', 'the guest whose line was dead gets the board when it is back (or the lobby, if the board\'s own clock ran out first)', landed);
    }
    out.ok = true;
  } catch (error) {
    out.ok = false;
    out.failed = String(error.stack ?? error).slice(0, 3000);
    for (const [i, page] of pages.entries()) await shot(page, `fail-${i}`).catch(() => {});
    throw new Error(`coop-fixsession-return FAILED after ${out.checks.length} checks: ${out.failed}`);
  } finally {
    writeFileSync(`${outDir}/coop-fixsession-${tag}.json`, JSON.stringify(out, null, 2));
    for (const page of pages.slice(1)) await page.close().catch(() => {});
  }
  return out;
}
