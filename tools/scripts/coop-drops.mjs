// Selling a gun back and dropping one for a friend, in a real two-page Crucible match (weapons/dropped.ts, contracts/shop).
// The host sells a bought gun back at the shop (the confirm shown), then drops a modded Deuce; the guest sees it with its
// prompt, takes it, and holds it with the host's mods and rounds. Then the guest drops it and the host sees that drop.
//   node tools/shot.mjs --port 5204 --dpr 2 --w 1440 --h 900 --wait 500 --timeout 600 \
//     --script tools/scripts/coop-drops.mjs --out tools/out/drops/x.png
// Runs on the loopback transport by default (fast, offline); COOP_NET=rtc runs it over real WebRTC. See coop-kit.mjs.
import { writeFileSync } from 'node:fs';
import { calm, inMatch, kit, startPair } from './coop-kit.mjs';

/** Presses `action` until `done` holds on the page: at a few frames a second one press can fall inside a draw. */
const press = async (page, action, sleep, done) => {
  for (let i = 0; i < 12; i++) {
    await page.evaluate(a => { window.__op2.game.setState('playing'); window.__op2.ctx.input.simulate(a, true); }, action);
    await sleep(700);
    await page.evaluate(a => window.__op2.ctx.input.simulate(a, false), action);
    await sleep(700);
    if (await page.evaluate(done)) return;
  }
  throw new Error(`${action} never took`);
};

export default async function (host, { sleep, outDir }) {
  const out = { errors: [], checks: [], screenshots: [] };
  const { check, progress, shot } = kit(outDir, 'drops', out, sleep);
  let guest;
  try {
    ({ guest } = await startPair(host, { mode: 'Crucible mode', password: 'drops', out, progress, sleep }));
    await inMatch([host, guest], 'crucible');
    await calm(host);
    progress('both in the match');

    // --- The shop: the host owns a Deuce with its loader, and sells it back.
    await host.evaluate(() => {
      const { ctx } = window.__op2;
      ctx.waves.phase = 'intermission'; ctx.waves.nextWaveIn = 60;
      const w = ctx.weapons;
      w.give('deuce'); w.grantMod('deuceLoader'); w.fitMod('deuceLoader', true);
      ctx.contracts.shop.credits = 2500;
      ctx.events.emit('shop:open', {});
    });
    await host.locator('.scr-proc').waitFor({ state: 'visible', timeout: 20000 });
    const index = await host.evaluate(() => [...document.querySelectorAll('.scr-proc .pc-list .pc-row .pc-k')].findIndex(e => e.textContent === 'Deuce'));
    check(index >= 0, 'the shop lists the Deuce', index);
    for (let i = 0; i < index; i++) { await host.keyboard.press('ArrowDown'); await sleep(60); }
    check(/Sell back/.test(await host.locator('.pc-sell').textContent()), 'an owned gun shows its Sell button');
    await host.keyboard.press('KeyX');
    await sleep(400);
    check(/Confirm: sell/.test(await host.locator('.pc-sell').textContent()), 'the first X asks for a confirm');
    out.note = await host.locator('.pc-note').textContent();
    await shot(host, '1-shop-sell-confirm', true);
    await host.keyboard.press('KeyX');
    await sleep(400);
    const sold = await host.evaluate(() => ({ credits: window.__op2.ctx.contracts.shop.credits, owned: window.__op2.ctx.weapons.owned.has('deuce'),
      loader: window.__op2.ctx.weapons.mods.has('deuceLoader') }));
    out.sold = sold;
    check(!sold.owned && !sold.loader, 'the Deuce and its loader are sold', sold);
    check(sold.credits === 2500 + Math.floor((1400 + 600) / 2), 'the refund is half of the gun and its mod', sold);
    // The SMG is issued: its button says so.
    const smg = await host.evaluate(() => [...document.querySelectorAll('.scr-proc .pc-list .pc-row .pc-k')].findIndex(e => e.textContent === 'SMG'));
    const at = await host.evaluate(() => [...document.querySelectorAll('.scr-proc .pc-list .pc-row')].findIndex(e => e.classList.contains('focus') || e.matches(':focus')));
    out.smgRow = { smg, at };
    await host.keyboard.press('Escape');
    await sleep(600);
    await host.evaluate(() => window.__op2.game.setState('playing'));

    // --- The drop: the host holds a Deuce with the quad, two shells in, nine spare, and drops it.
    await host.evaluate(() => {
      const { ctx } = window.__op2;
      const w = ctx.weapons;
      w.give('deuce'); w.grantMod('deuceQuad'); w.fitMod('deuceQuad', true);
      const a = w.ammo('deuce'); a.mag = 2; a.reserve = 9;
      w.switchTo('deuce');
    });
    await sleep(2000);
    await press(host, 'dropWeapon', sleep, () => window.__op2.ctx.weapons.dropped.list.length === 1);
    await host.waitForFunction(() => window.__op2.ctx.weapons.dropped.list.length === 1, null, { timeout: 20000 });
    await guest.waitForFunction(() => window.__op2.ctx.weapons.dropped.list.length === 1, null, { timeout: 20000 });
    const drop = await guest.evaluate(() => (({ weapon, mods, fitted, mag, reserve, id, at, by }) => ({ weapon, mods, fitted, mag, reserve, id, at, by }))(window.__op2.ctx.weapons.dropped.list[0]));
    out.drop = drop;
    check(drop.weapon === 'deuce' && drop.by === 'HOST-ONE' && drop.fitted.includes('deuceQuad') && drop.mag === 2 && drop.reserve === 9,
      'the guest sees the host\'s Deuce on the ground, named, with its mods and rounds', drop);
    check(await host.evaluate(() => !window.__op2.ctx.weapons.owned.has('deuce')), 'the host no longer owns the Deuce');

    // The guest walks up to it, two metres off, and looks at it.
    await guest.evaluate(at => {
      const { ctx, game } = window.__op2; const V = ctx.player.position.constructor;
      game.setState('playing');
      const gun = new V(at[0], at[1], at[2]);
      const stand = gun.clone().add(new V(1.7, 0, 0.6));
      ctx.player.teleport(stand, 0);
      const d = gun.clone().add(new V(0, 0.5, 0)).sub(ctx.player.eye);
      ctx.player.yaw = Math.atan2(-d.x, -d.z); ctx.player.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
    }, drop.at);
    await sleep(1500);
    const prompt = await guest.evaluate(() => [...document.querySelectorAll('body *')].map(e => e.childElementCount === 0 ? e.textContent : '').find(t => /Take Deuce/i.test(t ?? '')) ?? null);
    out.prompt = prompt;
    check(/\[E\] Take Deuce \(from HOST-ONE\)/i.test(prompt ?? ''), 'the guest sees the prompt over it', prompt);
    await shot(guest, '2-guest-sees-dropped-gun');

    await press(guest, 'interact', sleep, () => window.__op2.ctx.weapons.owned.has('deuce'));
    await guest.waitForFunction(() => window.__op2.ctx.weapons.owned.has('deuce'), null, { timeout: 20000 });
    await host.waitForFunction(() => window.__op2.ctx.weapons.dropped.list.length === 0, null, { timeout: 20000 });
    await sleep(1500);
    const held = await guest.evaluate(() => {
      const w = window.__op2.ctx.weapons;
      return { current: w.current, fitted: [...w.fitted].filter(m => m.startsWith('deuce')), ammo: { ...w.ammo('deuce') }, left: w.dropped.list.length };
    });
    out.held = held;
    check(held.current === 'deuce' && held.fitted.includes('deuceQuad') && held.ammo.mag === 2 && held.ammo.reserve === 9 && held.left === 0,
      'the guest holds the host\'s Deuce with the quad and its rounds, and it is gone from the ground', held);
    // Look a little down so the gun in hand fills the shot.
    await guest.evaluate(() => { window.__op2.game.setState('playing'); window.__op2.ctx.player.pitch = -0.15; });
    await sleep(600);
    await shot(guest, '3-guest-holds-host-gun');

    // --- And back: the guest drops it, and the host sees that drop.
    await sleep(2500);
    await press(guest, 'dropWeapon', sleep, () => !window.__op2.ctx.weapons.owned.has('deuce'));
    await host.waitForFunction(() => window.__op2.ctx.weapons.dropped.list.length === 1, null, { timeout: 20000 });
    const back = await host.evaluate(() => (({ weapon, mods, fitted, mag, reserve, id, at, by }) => ({ weapon, mods, fitted, mag, reserve, id, at, by }))(window.__op2.ctx.weapons.dropped.list[0]));
    out.back = back;
    check(back.by === 'GUEST-TWO' && back.weapon === 'deuce', 'the host sees the guest\'s drop', back);
    check(await guest.evaluate(() => !window.__op2.ctx.weapons.owned.has('deuce')), 'the guest no longer owns it');
    check(out.errors.length === 0, 'no page errors', out.errors);
  } catch (error) {
    out.failed = String(error?.stack ?? error);
    if (guest) await guest.screenshot({ path: `${outDir}/drops-fail-guest.png` }).catch(() => {});
    await host.screenshot({ path: `${outDir}/drops-fail-host.png` }).catch(() => {});
  } finally {
    writeFileSync(`${outDir}/drops.json`, JSON.stringify(out, null, 2));
    await guest?.close().catch(() => {});
  }
  return out;
}
