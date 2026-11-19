// Team rules proof 2: the break between waves. On every page:
//   - the dead and the downed are back on their feet when the wave is cleared, so everyone shops;
//   - the break is 45 s for a team (the host's clock, and what every guest reads);
//   - the next-wave key is a ready vote: one player alone never cuts the break, a guest's key counts, the dead do not hold
//     the team up, a player in the shop can vote from there, and when every living player has voted it drops to 3 s;
//   - the HUD shows the vote ("1/2 READY") and the shop screen shows the true clock and shuts itself when the wave starts.
//
//   TEAM_PLAYERS=3 (default; 4 for the four-player run), TEAM_NET=bad, COOP_NET=rtc: see coop-team-kit.mjs.
//   node tools/shot.mjs --port 5310 --dpr 2 --w 1440 --h 900 --wait 500 --timeout 600 \
//     --script tools/scripts/coop-team-break.mjs --out tools/out/team/break-final.png
import { writeFileSync } from 'node:fs';
import { kit, skipBreak } from './coop-kit.mjs';
import { BAD_NET, bleedOut, clearWave, down, hudText, invulnerable, netName, players, said, teamParty, waitSaid, world } from './coop-team-kit.mjs';

const PLAYERS = players(3);

export default async function (host, { sleep, outDir }) {
  const out = { players: PLAYERS, net: netName(), transport: process.env.COOP_NET ?? 'loop', errors: [], checks: [], screenshots: [] };
  const tag = `break-${PLAYERS}p${BAD_NET ? '-bad' : ''}`;
  const { check, progress, shot } = kit(outDir, tag, out, sleep);
  let pages = [host];
  const all = fn => Promise.all(pages.map(fn));
  const settle = () => sleep(BAD_NET ? 1400 : 700);
  try {
    ({ pages } = await teamParty(host, { mode: 'crucible', count: PLAYERS, out, progress, sleep }));
    const [, dead, shopper] = [pages[0], pages[1], pages[pages.length - 1]];
    const slots = await all(p => p.evaluate(() => window.__op2.ctx.coop.lobby.me.slot));
    const deadSlot = slots[1];
    await invulnerable(pages, true);
    await skipBreak(host);
    await host.waitForFunction(() => window.__op2.ctx.waves.wave >= 1 && window.__op2.ctx.waves.phase !== 'intermission', null, { timeout: 60000 });
    const first = await world(host);
    check(first.rest.on === false, 'The first countdown of a run is not a break: no vote', first.rest);

    progress('one guest bleeds out mid-wave');
    await down(dead);
    await host.waitForFunction(slot => [...window.__op2.ctx.coop.world.team.cards.values()].some(c => c.slot === slot && c.state === 'down'), deadSlot, { timeout: 15000 });
    await bleedOut(host, deadSlot);
    await dead.waitForFunction(() => window.__op2.ctx.coop.world.team.myState === 'dead', null, { timeout: 15000 });
    await waitSaid(host, /BLED OUT · back when the wave is cleared/);
    await sleep(900);
    await shot(dead, 'dead-spectating');
    check((await said(dead, /WATCHING .* back when the wave is cleared/)).length > 0, 'The dead player is told they are back when the wave is cleared');

    progress('the wave is cleared: everyone is up, the team break is on');
    await clearWave(host);
    await host.waitForFunction(() => window.__op2.ctx.waves.phase === 'intermission' && window.__op2.ctx.coop.world.team.rest.on, null, { timeout: 20000 });
    await dead.waitForFunction(() => window.__op2.ctx.player.alive === true, null, { timeout: BAD_NET ? 6000 : 3000 });
    await settle();
    const cleared = await all(world);
    out.cleared = cleared;
    check(cleared[1].alive && cleared[1].health > 0 && !cleared[1].downed, 'The dead player is back on their feet at wave clear', cleared[1]);
    check(cleared[0].cards.every(c => c.state === 'up'), 'Every card reads up at the start of the break', cleared[0].cards);
    check(cleared[0].left > 40 && cleared[0].left <= 45.5, 'The host\'s break is the team\'s 45 s', cleared[0].left);
    cleared.forEach((w, i) => check(w.phase === 'intermission' && w.left > 38 && w.rest.on && w.rest.need === PLAYERS && w.rest.ready.length === 0,
      `Page ${i} is in the break with the team's clock and an empty vote of ${PLAYERS}`, w));
    const chips = await all(hudText);
    chips.forEach((h, i) => check(new RegExp(`NEXT WAVE IN \\d+ s0/${PLAYERS} READY\\[L\\] READY UP`).test(h.rest), `Page ${i} shows the break's clock and the vote on the HUD`, h.rest));
    await shot(host, 'hud-break-host'); await shot(shopper, 'hud-break-guest');

    progress('one player dead in the break, one in the shop');
    await down(dead);
    await host.waitForFunction(slot => [...window.__op2.ctx.coop.world.team.cards.values()].some(c => c.slot === slot && c.state === 'down'), deadSlot, { timeout: 15000 });
    await bleedOut(host, deadSlot);
    await host.waitForFunction(n => window.__op2.ctx.coop.world.team.rest.need === n, PLAYERS - 1, { timeout: 15000 });
    // The shop goes up over the live world, as E at the pod does.
    await shopper.evaluate(() => window.__op2.ctx.events.emit('shop:open', {}));
    await shopper.locator('.scr-procurement').waitFor({ state: 'visible', timeout: 15000 });
    await settle();
    const shop0 = (await hudText(shopper)).shop;
    await sleep(2200);
    const shop1 = (await hudText(shopper)).shop;
    const secs = text => Number(/in (\d+) s/.exec(text ?? '')?.[1] ?? NaN);
    out.shop = { shop0, shop1 };
    check(/The clock is running/.test(shop0) && !/when you leave/.test(shop0) && new RegExp(`0/${PLAYERS - 1} ready`).test(shop0), 'The shop screen says the clock is running and shows the vote', shop0);
    check(secs(shop1) < secs(shop0) && secs(shop0) - secs(shop1) <= 4, 'The shop screen\'s clock counts down in real time while the shop is open', { shop0, shop1 });
    const strip = await hudText(host);
    check(strip.strip.some(s => /SHOPPING/.test(s)) && strip.strip.some(s => /DEAD/.test(s)), 'The host\'s strip shows who is shopping and who is dead', strip.strip);
    await shot(shopper, 'shop-clock', true);

    progress('the vote');
    const before = (await world(host)).left;
    await host.keyboard.press('KeyL');
    await settle();
    const one = await all(world);
    check(one[0].left > before - 4 && one[0].left > 20, 'One player alone does not cut the break', { before, after: one[0].left });
    one.forEach((w, i) => check(w.rest.ready.length === 1 && w.rest.ready[0] === 0 && w.rest.need === PLAYERS - 1, `Page ${i} sees the host's vote: 1/${PLAYERS - 1}`, w.rest));
    check((await said(shopper, /HOST-ONE is ready for the next wave \(1\//)).length === 1, 'A guest\'s feed names the host\'s vote');
    check((await said(host, /You are ready for the next wave \(1\//)).length === 1, 'The host\'s own feed says so too');
    check(new RegExp(`1/${PLAYERS - 1} ready`).test((await hudText(shopper)).shop), 'The open shop shows the vote moving');
    // The dead player's key is not a vote and holds nobody up.
    await dead.keyboard.press('KeyL');
    // With four, the third living player votes from the field.
    for (const page of pages.slice(2, -1)) await page.keyboard.press('KeyL');
    await settle();
    const mid = await world(host);
    check(mid.rest.ready.length === PLAYERS - 2 && mid.left > 15, 'The dead player\'s key is not a vote, and the break still runs', mid);
    await shot(host, 'hud-vote-host');
    // The last living player votes from inside the shop.
    await shopper.keyboard.press('KeyL');
    await host.waitForFunction(() => window.__op2.ctx.waves.nextWaveIn <= 3.05 || window.__op2.ctx.waves.phase !== 'intermission', null, { timeout: 8000 });
    const cut = await world(host);
    check(cut.left <= 3.05, 'When every living player has voted the break drops to its last three seconds', cut);
    for (const page of pages) await waitSaid(page, /EVERYONE READY/);
    check(true, 'Every page is told everyone is ready');

    progress('the next wave: the shop shuts itself and the dead are back');
    await host.waitForFunction(() => window.__op2.ctx.waves.phase !== 'intermission' && window.__op2.ctx.waves.wave === 2, null, { timeout: 15000 });
    await waitSaid(shopper, /WAVE 2 · the shop is shut/);
    await shopper.waitForFunction(() => getComputedStyle(document.querySelector('.scr-procurement')).display === 'none', null, { timeout: 8000 });
    await dead.waitForFunction(() => window.__op2.ctx.player.alive === true, null, { timeout: 6000 });
    await settle();
    const next = await all(world);
    check(next.every(w => w.rest.on === false && w.rest.ready.length === 0), 'The vote is cleared on every page as the wave starts', next.map(w => w.rest));
    check(next[1].alive, 'A player who died in the break is up again as the next wave starts', next[1]);
    check((await hudText(host)).rest === '', 'The break chip is gone from the HUD in a wave');
  } catch (error) {
    out.errors.push(String(error?.stack ?? error));
    for (const [i, page] of pages.entries()) await page.screenshot({ path: `${outDir}/${tag}-fail-${i}.png` }).catch(() => {});
  }
  out.ok = out.errors.length === 0;
  writeFileSync(`${outDir}/${tag}.json`, JSON.stringify(out, null, 2));
  for (const page of pages.slice(1)) await page.close().catch(() => {});
  return { ok: out.ok, checks: out.checks.length, errors: out.errors };
}
