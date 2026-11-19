// Team rules proof 1: how a co-op run ends. On every page: the team board, never the solo game-over or "complete" screen;
// working buttons; the host's world still running under it; everyone back in one lobby; the host's "Start again".
//
//   TEAM_CASE=wipe      the Crucible: everyone down, the board, the host's Start again, a second wipe, a guest's own
//                       Back to lobby, the host's Back to lobby (everyone).
//   TEAM_CASE=humans    Endless Humans: jump to wave 10 with the dev hooks, a guest kills the Commander, CONTRACT FULFILLED.
//   TEAM_CASE=mission   Mission 1: the mission is won (`campaign:complete` on the host), MISSION COMPLETE.
//                       Before it: the pause menu (a guest has no checkpoint item; the host's End match asks first).
//   TEAM_PLAYERS=2|3|4, TEAM_NET=bad (lag 120, jitter 40, 5% loss), COOP_NET=rtc for real WebRTC: see coop-team-kit.mjs.
//
//   TEAM_CASE=wipe node tools/shot.mjs --port 5310 --dpr 2 --w 1440 --h 900 --wait 500 --timeout 900 \
//     --script tools/scripts/coop-team-endings.mjs --out tools/out/team/endings-final.png
import { writeFileSync } from 'node:fs';
import { button, fireAt, kit } from './coop-kit.mjs';
import { BAD_NET, allIn, backInLobby, down, ending, invulnerable, netName, players, teamParty, world } from './coop-team-kit.mjs';

const CASE = process.env.TEAM_CASE ?? 'wipe';
const PLAYERS = players(2);
const MODES = { wipe: 'crucible', humans: 'outpost', mission: 'campaign' };

export default async function (host, { sleep, outDir }) {
  const out = { case: CASE, players: PLAYERS, net: netName(), transport: process.env.COOP_NET ?? 'loop', errors: [], checks: [], screenshots: [] };
  const tag = `endings-${CASE}-${PLAYERS}p${BAD_NET ? '-bad' : ''}`;
  const { check, progress, shot } = kit(outDir, tag, out, sleep);
  const contract = MODES[CASE];
  let pages = [host];
  // The board on every page, and nothing solo: the heart of every case.
  const boardEverywhere = async (big, label, buttons = true) => {
    for (const page of pages) await page.waitForFunction(() => !!document.querySelector('.cq-over .cq-big')?.textContent, null, { timeout: 60000, polling: 250 });
    await sleep(600);
    const seen = await Promise.all(pages.map(ending));
    out[label] = seen;
    seen.forEach((e, i) => {
      check(e.board && e.big === big, `${label}: page ${i} shows the team board "${big}"`, e);
      check(!e.soloGameOver && !e.soloComplete && !e.pause, `${label}: page ${i} shows no solo game-over, complete or pause screen`, e);
      check(e.state !== 'gameover' && !e.paused, `${label}: page ${i} never enters the solo gameover state and its clock is not paused`, e);
      check(e.rows === pages.length, `${label}: page ${i} lists all ${pages.length} players on the board`, e);
      check(!e.locked, `${label}: page ${i} has the mouse free for the buttons`, e);
      if (buttons) check(i === 0 ? e.buttons.join('|') === 'Back to lobby (everyone)|Start again' : e.buttons.join('|') === 'Back to lobby', `${label}: page ${i} has the right buttons`, e.buttons);
    });
    // The host's world must keep running under the board, and the guests keep hearing it.
    const before = await Promise.all(pages.map(world));
    const seq = await Promise.all(pages.slice(1).map(p => p.evaluate(() => window.__op2.ctx.coop.world.receivedSeq)));
    await sleep(1500);
    const after = await Promise.all(pages.map(world));
    const seq2 = await Promise.all(pages.slice(1).map(p => p.evaluate(() => window.__op2.ctx.coop.world.receivedSeq)));
    check(after[0].time - before[0].time > 1.0, `${label}: the host's world clock keeps running under the board`, { before: before[0].time, after: after[0].time });
    seq.forEach((s, i) => check(seq2[i] > s, `${label}: guest ${i + 1} keeps getting the host's snapshots under the board`, { before: s, after: seq2[i] }));
  };
  try {
    ({ pages } = await teamParty(host, { mode: contract, count: PLAYERS, out, progress, sleep }));
    progress(`in ${contract} with ${pages.length} players${BAD_NET ? ' on a bad network' : ''}`);

    if (CASE === 'wipe') {
      await host.waitForFunction(() => window.__op2.ctx.waves.wave >= 1, null, { timeout: 60000, polling: 250 });
      await invulnerable(pages, true);
      // Everyone but the host goes down, then bleeds out or stays down; the host last.
      for (const page of pages.slice(1)) await down(page);
      await host.waitForFunction(n => [...window.__op2.ctx.coop.world.team.cards.values()].filter(c => c.state !== 'up').length === n, pages.length - 1, { timeout: 30000, polling: 250 });
      const mid = await Promise.all(pages.map(ending));
      check(mid.every(e => !e.board && !e.soloGameOver), 'With the host still up there is no board and no solo screen', mid);
      await shot(pages[1], 'guest-down-before-wipe');
      await down(host);
      await boardEverywhere('TEAM WIPED', 'wipe');
      await shot(host, 'board-host', true); await shot(pages[1], 'board-guest', true);

      progress('host presses Start again');
      const matchBefore = await host.evaluate(() => window.__op2.ctx.coop.match.id);
      await host.locator('.cq-over .cq-btn', { hasText: 'Start again' }).click();
      // Each page loads the new match's map and stops at "Click to deploy"; allIn presses it.
      for (const page of pages) await page.waitForFunction(id => !!window.__op2?.ctx?.coop?.match && window.__op2.ctx.coop.match.id !== id, matchBefore, { timeout: 180000, polling: 250 });
      await allIn(pages, contract);
      const again = await Promise.all(pages.map(p => p.evaluate(() => ({ id: window.__op2.ctx.coop.match.id, mode: window.__op2.ctx.coop.match.mode, wave: window.__op2.ctx.waves.wave,
        board: !!document.querySelector('.cq-over .cq-big')?.textContent, players: window.__op2.ctx.coop.lobby.players.length }))));
      out.again = again;
      check(again.every(a => a.id === again[0].id && a.id !== matchBefore && a.mode === 'crucible' && a.players === pages.length && !a.board),
        'Start again puts every player in one new match of the same mode, with no board left over', again);
      await shot(host, 'again-host');

      progress('second wipe: a guest leaves on its own, then the host takes the rest');
      await host.waitForFunction(() => window.__op2.ctx.waves.wave >= 1, null, { timeout: 60000, polling: 250 });
      for (const page of pages) await down(page);
      await boardEverywhere('TEAM WIPED', 'wipe2');
      await pages[1].locator('.cq-over .cq-btn', { hasText: 'Back to lobby' }).click();
      await pages[1].waitForFunction(() => window.__op2.game.state === 'menu' && getComputedStyle(document.querySelector('.scr-coop')).display !== 'none', null, { timeout: 30000, polling: 250 });
      const hostStill = await ending(host);
      check(hostStill.board && hostStill.coop, 'A guest going back to the lobby leaves the host on the board, still in the match', hostStill);
      // The host uses the keyboard: Enter on the focused "Back to lobby (everyone)".
      await host.keyboard.press('Enter');
      await backInLobby(pages);
      check(true, 'The host\'s Back to lobby takes everyone to the same lobby page');
      await shot(host, 'lobby-after', true);
    }

    if (CASE === 'humans') {
      await invulnerable(pages, true);
      await host.waitForFunction(() => window.__op2.ctx.waves.wave >= 1, null, { timeout: 60000, polling: 250 });
      progress('dev hooks: jump to wave 10 and bring the Commander down');
      await host.evaluate(() => {
        const { ctx } = window.__op2;
        for (const enemy of [...ctx.enemies.alive]) ctx.enemies.withdraw(enemy);
        ctx.waves.jumpTo(10);
      });
      await host.waitForFunction(() => window.__op2.ctx.waves.wave === 10 && window.__op2.ctx.waves.phase !== 'intermission', null, { timeout: 30000, polling: 250 });
      await host.evaluate(() => window.__op2.ctx.enemies.outpost.commander.person.summon());
      await host.waitForFunction(() => !!window.__op2.ctx.enemies.outpost.commander.person.body?.alive, null, { timeout: 30000, polling: 250 });
      const boss = await host.evaluate(() => window.__op2.ctx.enemies.outpost.commander.person.body.uid);
      const killer = pages[pages.length - 1];
      await killer.waitForFunction(uid => window.__op2.ctx.enemies.alive.some(e => e.uid === uid), boss, { timeout: 30000, polling: 250 });
      await shot(killer, 'commander-on-guest');
      const before = await Promise.all(pages.map(ending));
      check(before.every(e => !e.board), 'No board while the Commander lives', before);
      // The host's dev hooks leave him one burst from dead and standing still; the last guest finishes him with its own gun.
      await host.evaluate(() => {
        const body = window.__op2.ctx.enemies.outpost.commander.person.body;
        body.behaviours = []; body.attacks = []; body.mode = 'hold';
        body.health = 60; body.armor = 0;
        for (const plate of body.plates ?? []) plate.hp = 0;
      });
      const kills0 = await killer.evaluate(() => window.__op2.ctx.progression.kills);
      await killer.evaluate(uid => {
        const { ctx } = window.__op2;
        const enemy = ctx.enemies.alive.find(e => e.uid === uid);
        const V = ctx.player.position.constructor;
        // A spot 6 m off with a clear line to him.
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2;
          const at = new V(enemy.position.x + Math.cos(a) * 6, enemy.position.y, enemy.position.z + Math.sin(a) * 6);
          const eye = at.clone(); eye.y += 1.6;
          const dir = enemy.center.clone().sub(eye); const range = dir.length();
          if (!ctx.physics.raycast(eye, dir.divideScalar(range), range - 1)) { ctx.player.teleport(at, 0); return; }
        }
        ctx.player.teleport(new V(enemy.position.x, enemy.position.y, enemy.position.z + 5), 0);
      }, boss);
      await sleep(900);
      for (let i = 0; i < 40; i++) {
        const alive = await host.evaluate(uid => window.__op2.ctx.enemies.alive.some(e => e.uid === uid), boss);
        if (!alive) break;
        await fireAt(killer, boss, 700, sleep);
        await sleep(BAD_NET ? 500 : 200);
      }
      const dead = await host.evaluate(uid => !window.__op2.ctx.enemies.alive.some(e => e.uid === uid), boss);
      check(dead, 'The guest\'s claims kill the Commander on the host');
      progress('the Commander is dead: his last words, then the board');
      await boardEverywhere('CONTRACT FULFILLED', 'fulfilled');
      const kills1 = await killer.evaluate(() => window.__op2.ctx.progression.kills);
      check(kills1 === kills0 + 1, 'The kill of the Commander is the guest\'s own', { kills0, kills1 });
      await shot(host, 'board-host', true); await shot(killer, 'board-guest', true);
      await host.locator('.cq-over .cq-btn', { hasText: 'Back to lobby (everyone)' }).click();
      await backInLobby(pages);
      check(true, 'Everyone lands back in the same lobby after the win');
      await shot(host, 'lobby-after', true);
    }

    if (CASE === 'mission') {
      await invulnerable(pages, true);
      await sleep(2500);
      progress('the pause menu in a mission');
      const menu = page => page.evaluate(() => {
        const shown = el => getComputedStyle(el).display !== 'none';
        return { open: shown(document.querySelector('.scr-pause')), items: [...document.querySelectorAll('.scr-pause .mi')].filter(shown).map(el => el.textContent),
          hint: shown(document.querySelector('.pz-hint')) ? document.querySelector('.pz-hint').textContent : '', inMatch: !!window.__op2.ctx.coop?.lobby.match };
      });
      const guest = pages[1];
      await guest.evaluate(() => window.__op2.ctx.hud.pause());
      const guestMenu = await menu(guest);
      check(guestMenu.open && !guestMenu.items.some(i => /checkpoint/i.test(i)) && guestMenu.items.includes('Leave match (to lobby)'),
        'A guest\'s pause menu in a mission has no checkpoint item, and leaves to the lobby', guestMenu);
      await shot(guest, 'pause-guest', true);
      await guest.evaluate(() => window.__op2.game.setState('playing'));
      await host.evaluate(() => window.__op2.ctx.hud.pause());
      const hostMenu = await menu(host);
      check(hostMenu.items.includes('Checkpoint (whole team)') && hostMenu.items.includes('End match (all to lobby)'), 'The host\'s pause menu says the checkpoint is the whole team\'s', hostMenu);
      await button(host, 'End match (all to lobby)').click();
      await sleep(400);
      const asked = await menu(host);
      check(asked.inMatch && asked.items.includes('End it for everyone? Press again') && /whole team/.test(asked.hint), 'End match asks first: one press does not end it', asked);
      await shot(host, 'pause-host-asks', true);
      await sleep(4300);
      const lapsed = await menu(host);
      check(lapsed.inMatch && lapsed.items.includes('End match (all to lobby)'), 'The question lapses after four seconds, the match still on', lapsed);
      await host.evaluate(() => window.__op2.game.setState('playing'));
      progress('the host\'s mission is won');
      await host.evaluate(() => window.__op2.ctx.events.emit('campaign:complete', {}));
      await boardEverywhere('MISSION COMPLETE', 'mission');
      await sleep(1500);
      const late = await Promise.all(pages.map(ending));
      check(late.every(e => e.board && !e.soloComplete && e.state !== 'gameover'), 'Two seconds on, still the board and no solo "complete" screen', late);
      await shot(host, 'board-host', true); await shot(pages[1], 'board-guest', true);
      // Left alone, the board takes everyone back when its clock runs out.
      progress('waiting out the board\'s clock');
      await backInLobby(pages);
      check(true, 'The board\'s own clock takes everyone back to the same lobby');
    }
  } catch (error) {
    out.errors.push(String(error?.stack ?? error));
    for (const [i, page] of pages.entries()) await page.screenshot({ path: `${outDir}/${tag}-fail-${i}.png` }).catch(() => {});
  }
  out.ok = out.errors.length === 0;
  writeFileSync(`${outDir}/${tag}.json`, JSON.stringify(out, null, 2));
  for (const page of pages.slice(1)) await page.close().catch(() => {});
  return { ok: out.ok, checks: out.checks.length, errors: out.errors };
}
