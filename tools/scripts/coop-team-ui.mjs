// Team rules proof 4: the co-op HUD a finished game has. On every page:
//   - a ping: one key, a marker in the world in the player's colour with their name, on every screen, gone after six seconds;
//   - the kill feed: who killed what, one player's quick kills on one line, a boss by name in the main feed too;
//   - kill credit: the guest's kills pay and score the guest, the host's the host;
//   - teammates on the minimap (screenshots), "IN A MENU" and "CHEATS" on the strip, and the cheats notice in every feed.
//
//   TEAM_PLAYERS=2 (default; 3 shows two teammates on the strip and the map), TEAM_NET=bad, COOP_NET=rtc.
//   node tools/shot.mjs --port 5310 --dpr 2 --w 1440 --h 900 --wait 500 --timeout 600 \
//     --script tools/scripts/coop-team-ui.mjs --out tools/out/team/ui-final.png
import { writeFileSync } from 'node:fs';
import { calm, dummy, fireAt, give, kit, skipBreak, state, teleport } from './coop-kit.mjs';
import { BAD_NET, hudText, invulnerable, netName, players, said, teamParty, waitSaid } from './coop-team-kit.mjs';

const PLAYERS = players(2);

export default async function (host, { sleep, outDir }) {
  const out = { players: PLAYERS, net: netName(), transport: process.env.COOP_NET ?? 'loop', errors: [], checks: [], screenshots: [] };
  const tag = `ui-${PLAYERS}p${BAD_NET ? '-bad' : ''}`;
  const { check, progress, shot } = kit(outDir, tag, out, sleep);
  let pages = [host];
  const all = fn => Promise.all(pages.map(fn));
  const settle = () => sleep(BAD_NET ? 1400 : 700);
  try {
    ({ pages } = await teamParty(host, { mode: 'crucible', count: PLAYERS, out, progress, sleep }));
    const guest = pages[1];
    await invulnerable(pages, true);
    await skipBreak(host);
    await host.waitForFunction(() => window.__op2.ctx.waves.wave >= 1 && window.__op2.ctx.waves.phase !== 'intermission', null, { timeout: 60000, polling: 250 });
    await calm(host);
    await sleep(800);
    // Everyone stands in a loose line at the spawn, looking the same way.
    const spawn = await host.evaluate(() => { const s = window.__op2.ctx.world.playerSpawns[0]; return { at: s.position.toArray(), yaw: s.yaw }; });
    const point = (d, side = 0) => [spawn.at[0] - Math.sin(spawn.yaw) * d + Math.cos(spawn.yaw) * side, spawn.at[1], spawn.at[2] - Math.cos(spawn.yaw) * d - Math.sin(spawn.yaw) * side];
    for (const [i, page] of pages.entries()) { await teleport(page, point(-3, (i - (pages.length - 1) / 2) * 3), spawn.yaw); await give(page, 'smg'); }
    await settle();

    progress('ping');
    const live = page => page.evaluate(() => window.__op2.ctx.coop.world.team.marks.live.map(m => ({ slot: m.slot, at: m.at.toArray().map(n => Math.round(n * 10) / 10) })));
    await guest.keyboard.press('KeyP');
    const own = await live(guest);
    const guestSlot = await guest.evaluate(() => window.__op2.ctx.coop.lobby.me.slot);
    check(own.length === 1 && own[0].slot === guestSlot, 'The pinger\'s own marker is up at once', own);
    await host.waitForFunction(() => window.__op2.ctx.coop.world.team.marks.live.length === 1, null, { timeout: 30000, polling: 250 });
    const seen = await all(live);
    out.ping = seen;
    seen.forEach((m, i) => check(m.length === 1 && m[0].slot === guestSlot && JSON.stringify(m[0].at) === JSON.stringify(own[0].at), `Page ${i} has the guest's ping at the same spot`, m));
    const labels = await all(hudText);
    check(labels[0].marks.some(t => /^PING · GUEST-TWO/.test(t)), 'The host\'s marker carries the guest\'s name', labels[0].marks);
    check(labels[1].marks.some(t => /^YOUR PING/.test(t)), 'The guest\'s own reads YOUR PING', labels[1].marks);
    const colour = await host.evaluate(() => { const el = [...document.querySelectorAll('.wl .mk')].find(e => /^PING · GUEST-TWO/.test(e.textContent)); return el ? el.style.getPropertyValue('--c') : ''; });
    check(colour === ['#39e0ff', '#ffb33d', '#c69bff', '#79f1ad'][guestSlot], 'The marker is in the guest\'s own colour', { colour, guestSlot });
    // The host looks at it for the picture.
    await host.evaluate(at => {
      const { ctx } = window.__op2; const V = ctx.player.position.constructor;
      const delta = new V(...at).sub(ctx.player.eye);
      ctx.player.yaw = Math.atan2(-delta.x, -delta.z); ctx.player.pitch = Math.atan2(delta.y, Math.hypot(delta.x, delta.z));
    }, own[0].at);
    await sleep(500);
    await shot(host, 'ping-host'); await shot(guest, 'ping-guest');
    await host.keyboard.press('KeyP'); await settle();
    check((await live(guest)).some(m => m.slot === 0), 'The host\'s ping reaches the guest', await live(guest));
    await sleep(6500);
    const gone = await all(live);
    check(gone.every(m => m.length === 0), 'Every ping is gone after six seconds, on every page', gone);
    await host.evaluate(yaw => { window.__op2.ctx.player.yaw = yaw; window.__op2.ctx.player.pitch = 0; }, spawn.yaw);

    progress('the kill feed and kill credit');
    const before = { host: await state(host), guest: await state(guest) };
    const husks = [await dummy(host, point(7, -1.5)), await dummy(host, point(7, 0)), await dummy(host, point(7, 1.5))];
    await guest.waitForFunction(uids => uids.every(uid => window.__op2.ctx.enemies.alive.some(e => e.uid === uid)), husks, { timeout: 30000, polling: 250 });
    await sleep(600);
    for (const uid of husks) {
      for (let i = 0; i < 12; i++) {
        if (!(await host.evaluate(uid => window.__op2.ctx.enemies.alive.some(e => e.uid === uid), uid))) break;
        await fireAt(guest, uid, 700, sleep); await sleep(BAD_NET ? 350 : 120);
      }
    }
    await host.waitForFunction(uids => uids.every(uid => !window.__op2.ctx.enemies.alive.some(e => e.uid === uid)), husks, { timeout: 30000, polling: 250 });
    await settle();
    const feeds = await all(hudText);
    out.kills = feeds.map(f => f.kills);
    check(feeds[0].kills.some(k => /^GUEST-TWOHUSK/.test(k)), 'The host\'s kill feed names the guest and what it killed', feeds[0].kills);
    check(feeds[1].kills.some(k => /^YOUHUSK/.test(k)), 'The guest\'s own kill feed says YOU', feeds[1].kills);
    for (const [i, f] of feeds.entries()) if (i > 1) check(f.kills.some(k => /^GUEST-TWOHUSK/.test(k)), `Page ${i} has the same line`, f.kills);
    await shot(host, 'killfeed-host'); await shot(guest, 'killfeed-guest');
    const after = { host: await state(host), guest: await state(guest) };
    out.credit = { before, after };
    check(after.guest.kills === before.guest.kills + 3 && after.guest.credits > before.guest.credits, 'The guest\'s three kills pay and score the guest', out.credit);
    check(after.host.kills === before.host.kills && after.host.credits === before.host.credits, 'The host is not paid for them', out.credit);
    // The host kills a boss: by name in every main feed.
    const boss = await dummy(host, point(9, 0), 'juggernaut');
    await guest.waitForFunction(uid => window.__op2.ctx.enemies.alive.some(e => e.uid === uid), boss, { timeout: 30000, polling: 250 });
    await host.evaluate(uid => {
      const { ctx } = window.__op2; const V = ctx.player.position.constructor;
      const enemy = ctx.enemies.alive.find(e => e.uid === uid);
      for (const plate of enemy.plates ?? []) plate.hp = 0;
      enemy.armor = 0; enemy.health = 1;
      ctx.enemies.applyDamage(enemy, { amount: 500, type: 'bullet', source: 'smg', point: enemy.center.clone(), dir: new V(0, 0, -1), force: 1, armorPiercing: true });
    }, boss);
    for (const page of pages) await waitSaid(page, /feed: (You|HOST-ONE) killed the Juggernaut/);
    check((await said(host, /feed: You killed the Juggernaut/)).length === 1 && (await said(guest, /feed: HOST-ONE killed the Juggernaut/)).length === 1,
      'A boss kill is named in every main feed, once');
    const hostKills = await state(host);
    check(hostKills.kills === after.host.kills + 1, 'The host\'s own kill is the host\'s', hostKills.kills);

    progress('the strip: in a menu, cheats');
    await guest.evaluate(() => window.__op2.ctx.hud.pause());
    await host.waitForFunction(() => [...document.querySelectorAll('.cq-mate')].some(el => /IN A MENU/.test(el.textContent)), null, { timeout: 30000, polling: 250 });
    check(true, 'The host\'s strip says the guest is in a menu');
    await guest.evaluate(() => window.__op2.game.setState('playing'));
    await guest.evaluate(async () => { (await import('/src/core/cheats.ts')).setCheats(true); });
    for (const page of pages) await waitSaid(page, /GUEST-TWO has cheats on · unranked/);
    await host.waitForFunction(() => [...document.querySelectorAll('.cq-mate')].some(el => /CHEATS/.test(el.textContent)), null, { timeout: 30000, polling: 250 });
    check((await said(host, /GUEST-TWO has cheats on/)).length === 1, 'Every page is told, once, that the guest turned cheats on, and the strip is tagged');
    await host.evaluate(() => window.__op2.ctx.input.simulate('scoreboard', true));
    await sleep(600);
    await shot(host, 'strip-cheats-board-host');
    const board = await host.evaluate(() => document.querySelector('.cq-board')?.textContent ?? '');
    check(/GUEST-TWO.*CHEATS/.test(board), 'The Tab board tags the player too', board.slice(0, 200));
    await host.evaluate(() => window.__op2.ctx.input.simulate('scoreboard', false));
    await guest.evaluate(async () => { (await import('/src/core/cheats.ts')).setCheats(false); });
  } catch (error) {
    out.errors.push(String(error?.stack ?? error));
    out.said = await Promise.all(pages.map(p => p.evaluate(() => (window.__said ?? []).slice(-30)).catch(() => [])));
    out.stats = await Promise.all(pages.map(p => p.evaluate(() => ({ ...window.__op2.ctx.coop?.world?.stats, enemies: window.__op2.ctx.enemies.alive.map(e => [e.uid, Math.round(e.health)]) })).catch(() => null)));
    for (const [i, page] of pages.entries()) await page.screenshot({ path: `${outDir}/${tag}-fail-${i}.png` }).catch(() => {});
  }
  out.ok = out.errors.length === 0;
  writeFileSync(`${outDir}/${tag}.json`, JSON.stringify(out, null, 2));
  for (const page of pages.slice(1)) await page.close().catch(() => {});
  return { ok: out.ok, checks: out.checks.length, errors: out.errors };
}
