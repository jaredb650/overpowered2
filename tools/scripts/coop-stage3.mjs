// Stage 3 proof: the Crucible together over real WebRTC. Lobby (ping, countdown), weapon props, kill credit to the
// killer, down and revive, bleed-out and spectate, respawn on the next wave, the live shop, a call-in's damage and its
// explosion on the other screen, the host's tab hidden, and the team wipe back to the lobby.
//   node tools/shot.mjs --port 5294 --dpr 2 --w 1440 --h 900 --wait 500 --timeout 900 \
//     --script tools/scripts/coop-stage3.mjs --out tools/out/coop3/stage3-final.png
import { writeFileSync } from 'node:fs';
import { aimAt, button, calm, dummy, inMatch, kit, startPair, state } from './coop-kit.mjs';

export default async function (host, { sleep, outDir }) {
  const out = { errors: [], checks: [], screenshots: [] };
  const { check, progress, shot } = kit(outDir, 'stage3', out, sleep);
  let guest;
  try {
    ({ guest } = await startPair(host, { mode: 'The Crucible', password: 'coop-stage3', out, progress, sleep, startNow: false }));
    await host.waitForFunction(() => /\d+ ms/.test(document.querySelector('.co-ping:not(:empty)')?.textContent ?? ''), null, { timeout: 15000 });
    await shot(host, 'lobby-ping', true);
    await button(host, 'The Crucible').click(); await button(host, 'Start').click();
    await guest.waitForFunction(() => /Starting in/.test(document.querySelector('.scr-coop .nt-ref')?.textContent ?? ''), null, { timeout: 8000 });
    await shot(guest, 'lobby-countdown', true);
    check(true, 'Lobby shows ping and a start countdown on the guest');
    await inMatch([host, guest], 'crucible');
    progress('in the Crucible');
    for (const page of [host, guest]) await page.evaluate(() => { window.__op2.ctx.player.modifiers.invulnerable = true; });
    await guest.waitForFunction(() => window.__op2.ctx.waves.wave >= 1 && window.__op2.ctx.enemies.alive.length > 0, null, { timeout: 60000 });
    await sleep(1500);
    await shot(host, 'wave-host'); await shot(guest, 'wave-guest');

    progress('kill credit goes to the killer');
    await calm(host);
    const spawn = await host.evaluate(() => { const s = window.__op2.ctx.world.playerSpawns[0]; return { at: s.position.toArray(), yaw: s.yaw }; });
    const ahead = (d, side = 0) => [spawn.at[0] - Math.sin(spawn.yaw) * d + Math.cos(spawn.yaw) * side, spawn.at[1], spawn.at[2] - Math.cos(spawn.yaw) * d - Math.sin(spawn.yaw) * side];
    for (const [page, side] of [[host, 2], [guest, -2]]) await page.evaluate(([at, yaw]) => {
      const { ctx } = window.__op2; const V = ctx.player.position.constructor;
      ctx.player.teleport(new V(...at), yaw); ctx.weapons.give('smg'); ctx.weapons.switchTo('smg'); ctx.weapons.refillMagazines();
    }, [ahead(-4, side), spawn.yaw]);
    const before = { host: await state(host), guest: await state(guest) };
    const target = await dummy(host, ahead(6));
    await guest.waitForFunction(uid => window.__op2.ctx.enemies.alive.some(e => e.uid === uid), target, { timeout: 15000 });
    await sleep(700);
    await aimAt(guest, target); await sleep(300);
    await shot(guest, 'guest-aims'); await shot(host, 'host-sees-guest-gun');
    await guest.mouse.down(); await sleep(1100); await guest.mouse.up();
    await host.waitForFunction(uid => !window.__op2.ctx.enemies.alive.some(e => e.uid === uid), target, { timeout: 15000 });
    await sleep(800);
    const after = { host: await state(host), guest: await state(guest) };
    out.killCredit = { before, after };
    check(after.guest.kills === before.guest.kills + 1 && after.guest.credits > before.guest.credits, 'Guest kill pays and scores on the guest', out.killCredit);
    check(after.host.kills === before.host.kills && after.host.credits === before.host.credits, 'Host is not paid for the guest kill', out.killCredit);

    progress('guest goes down; host revives with E');
    await guest.evaluate(() => { window.__op2.ctx.player.modifiers.invulnerable = false; (w => { w.receivingDamage = true; window.__op2.ctx.player.takeDamage({ amount: 500, type: 'bullet', source: 'trooper' }); w.receivingDamage = false; })(window.__op2.ctx.coop.world); });
    await host.waitForFunction(() => [...window.__op2.ctx.coop.world.team.cards.values()].some(c => c.slot === 1 && c.state === 'down'), null, { timeout: 10000 });
    const down = await state(guest);
    check(down.downed === true && down.alive === false, 'Guest at 0 health is downed and crawling, not dead', down);
    // The guest crawls a little.
    await guest.evaluate(() => window.__op2.ctx.input.simulate('forward', true)); await sleep(1200);
    await guest.evaluate(() => window.__op2.ctx.input.simulate('forward', false));
    await shot(guest, 'guest-downed'); await shot(host, 'host-sees-downed');
    const guestAt = await guest.evaluate(() => window.__op2.ctx.player.position.toArray());
    await host.evaluate(at => { const { ctx } = window.__op2; const V = ctx.player.position.constructor; ctx.player.teleport(new V(at[0] + 1, at[1], at[2]), 0); }, guestAt);
    await sleep(600);
    await host.evaluate(() => window.__op2.ctx.input.simulate('interact', true));
    await sleep(500); await shot(host, 'host-reviving');
    await sleep(1400);
    await host.evaluate(() => window.__op2.ctx.input.simulate('interact', false));
    await guest.waitForFunction(() => window.__op2.ctx.player.alive && !window.__op2.ctx.player.downed, null, { timeout: 10000 });
    out.revive = await state(guest);
    check(out.revive.health > 0 && out.revive.health <= 40, 'Host held E and revived the guest where they lay', out.revive);
    await shot(guest, 'guest-revived');

    progress('bleed-out, spectate, respawn on the next wave');
    await guest.evaluate(() => (w => { w.receivingDamage = true; window.__op2.ctx.player.takeDamage({ amount: 500, type: 'bullet', source: 'trooper' }); w.receivingDamage = false; })(window.__op2.ctx.coop.world));
    await host.waitForFunction(() => [...window.__op2.ctx.coop.world.team.lives.values()].some(l => l.state === 'down'), null, { timeout: 10000 });
    await host.evaluate(() => { for (const life of window.__op2.ctx.coop.world.team.lives.values()) if (life.state === 'down') life.bleedUntil = performance.now(); });
    await guest.waitForFunction(() => [...window.__op2.ctx.coop.world.team.cards.values()].some(c => c.slot === 1 && c.state === 'dead'), null, { timeout: 10000 });
    await sleep(1200);
    await shot(guest, 'guest-spectating');
    const dead = await state(host);
    check(dead.state !== 'gameover' && dead.team.some(c => c.slot === 0 && c.state === 'up'), 'A bled-out guest spectates while the host plays on', dead.team);
    await host.evaluate(() => window.__op2.ctx.events.emit('wave:start', { wave: window.__op2.ctx.waves.wave + 1, total: 0, boss: false }));
    await guest.waitForFunction(() => window.__op2.ctx.player.alive, null, { timeout: 10000 });
    check(true, 'The dead come back when the next wave starts');
    await guest.evaluate(() => { window.__op2.ctx.player.modifiers.invulnerable = true; });

    progress('the shop over a live world');
    const shopBefore = await host.evaluate(() => window.__op2.ctx.time.elapsed);
    await guest.evaluate(() => window.__op2.ctx.events.emit('shop:open', {}));
    await guest.locator('.scr-procurement, .scr-shop, [class*=procure]').first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
    await sleep(1500);
    const shopping = { guest: await state(guest), hostTime: await host.evaluate(() => window.__op2.ctx.time.elapsed),
      guestPaused: await guest.evaluate(() => window.__op2.ctx.time.paused) };
    out.shop = shopping;
    check(shopping.guest.state === 'paused' && !shopping.guestPaused && shopping.hostTime > shopBefore, 'The guest shops while the world runs on', shopping);
    await shot(guest, 'guest-shop', true);
    await guest.evaluate(() => window.__op2.game.setState('playing'));

    progress('a call-in by the guest: damage on the host, explosion on both');
    const strikeTarget = await dummy(host, ahead(14, 3));
    await guest.waitForFunction(uid => window.__op2.ctx.enemies.alive.some(e => e.uid === uid), strikeTarget, { timeout: 15000 });
    const booms = await host.evaluate(() => { window.__booms = 0; const fx = window.__op2.ctx.fx; const real = fx.explosion.bind(fx); fx.explosion = (...a) => { window.__booms++; return real(...a); }; return 0; });
    await guest.evaluate(uid => {
      const { ctx } = window.__op2; const enemy = ctx.enemies.alive.find(e => e.uid === uid);
      ctx.events.emit('callin:used', { id: 'airstrike', position: enemy.position.clone() });
      setTimeout(() => ctx.combat.explode(enemy.position.clone().setY(enemy.position.y + 0.6), { radius: 7, damage: 900, source: 'airstrike', team: 'player', kind: 'rocket' }), 300);
    }, strikeTarget);
    await host.waitForFunction(uid => !window.__op2.ctx.enemies.alive.some(e => e.uid === uid), strikeTarget, { timeout: 15000 })
      .catch(async error => { out.callinDebug = { host: await state(host), guest: await state(guest) }; throw error; });
    out.callin = { host: await host.evaluate(() => ({ booms: window.__booms, accepted: window.__op2.ctx.coop.world.stats.accepted })), booms };
    check(out.callin.host.booms > 0, "The guest's strike is drawn on the host and kills there", out.callin);
    await sleep(300); await shot(host, 'host-sees-guest-strike');

    progress('host tab hidden: the world keeps running');
    const hiddenStart = { host: await host.evaluate(() => window.__op2.ctx.time.elapsed), seq: await guest.evaluate(() => window.__op2.ctx.coop.world.receivedSeq ?? 0) };
    await host.evaluate(() => window.__coopHide(true));
    await sleep(5000);
    const hiddenEnd = { host: await host.evaluate(() => window.__op2.ctx.time.elapsed), seq: await guest.evaluate(() => window.__op2.ctx.coop.world.receivedSeq ?? 0),
      notice: await guest.evaluate(() => window.__op2.ctx.coop.lobby.chat.some(l => /background tab/.test(l.text))) };
    await host.evaluate(() => window.__coopHide(false));
    out.hidden = { hiddenStart, hiddenEnd };
    check(hiddenEnd.host - hiddenStart.host > 2 && hiddenEnd.seq - hiddenStart.seq > 15 && hiddenEnd.notice, 'Hidden host keeps ticking and sending snapshots; guests are told', out.hidden);

    progress('team wipe and back to the lobby');
    for (const page of [guest, host]) await page.evaluate(() => { const p = window.__op2.ctx.player; p.modifiers.invulnerable = false; const w = window.__op2.ctx.coop.world; w.receivingDamage = true; p.takeDamage({ amount: 900, type: 'bullet', source: 'trooper' }); w.receivingDamage = false; });
    await host.evaluate(() => { for (const life of window.__op2.ctx.coop.world.team.lives.values()) if (life.state === 'down') life.bleedUntil = performance.now(); });
    for (const page of [host, guest]) await page.locator('.cq-end').waitFor({ state: 'visible', timeout: 15000 });
    await shot(host, 'wipe-host', true); await shot(guest, 'wipe-guest', true);
    await host.keyboard.press('Enter');
    for (const page of [host, guest]) await page.locator('.co-code').waitFor({ state: 'visible', timeout: 20000 });
    await sleep(800);
    await shot(guest, 'back-in-lobby', true);
    const lobby = await guest.evaluate(() => ({ crumb: document.querySelector('.scr-coop .mm-crumb')?.textContent, players: document.querySelectorAll('.co-player').length }));
    check(lobby.players === 2 && /Multiplayer \/ [A-Z0-9]{6}/.test(lobby.crumb), 'After the wipe both land in the same lobby, ready for another', lobby);
    check(out.errors.length === 0, 'No page exceptions on either page', out.errors);
    return out;
  } catch (error) {
    out.failure = error.stack ?? String(error);
    throw error;
  } finally {
    writeFileSync(`${outDir}/stage3-evidence.json`, JSON.stringify(out, null, 2));
    await guest?.close();
  }
}
