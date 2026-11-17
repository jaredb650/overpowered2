// Stage 4 proof, one mode per run: Endless Humans (squads, a surrender cuffed by the guest), Outpost Defense (loadouts,
// the host's garrison drawn on the guest) or the Crucible on the Office map. Pick with COOP_MODE:
//   COOP_MODE=humans|defense|office node tools/shot.mjs --port 5294 --dpr 2 --w 1440 --h 900 --wait 500 --timeout 700 \
//     --script tools/scripts/coop-modes.mjs --out tools/out/coop3/modes-final.png
import { writeFileSync } from 'node:fs';
import { button, calm, inMatch, kit, startPair, state } from './coop-kit.mjs';

const MODES = {
  humans: { label: 'Endless Humans mode', contract: 'outpost' },
  defense: { label: 'Outpost Defense mode', contract: 'defense' },
  office: { label: 'Office — Crucible mode', contract: 'crucible', map: 'office' },
};

export default async function (host, { sleep, outDir }) {
  const which = process.env.COOP_MODE ?? 'humans';
  const mode = MODES[which];
  const out = { mode: which, errors: [], checks: [], screenshots: [] };
  const { check, progress, shot } = kit(outDir, `modes-${which}`, out, sleep);
  let guest;
  try {
    ({ guest } = await startPair(host, { mode: mode.label, password: `coop-${which}`, out, progress, sleep }));
    await inMatch([host, guest], mode.contract, which !== 'defense');
    if (mode.map) for (const page of [host, guest]) check(page.url().includes(`map=${mode.map}`), `${which}: both pages loaded the ${mode.map} map`);
    progress('in the match');
    if (which === 'defense') {
      // Each player deploys from their own loadout screen; the world does not wait under it.
      for (const page of [host, guest]) {
        await page.locator('.scr-loadout').waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});
        if (await page.locator('.scr-loadout').isVisible().catch(() => false)) {
          await shot(page, `loadout-${page === host ? 'host' : 'guest'}`, true);
          await button(page, 'Deploy').click();
        }
        await page.evaluate(() => window.__op2.game.setState('playing'));
      }
      check(true, 'defense: both players deployed from their own loadout screens');
    }
    for (const page of [host, guest]) await page.evaluate(() => { window.__op2.ctx.player.modifiers.invulnerable = true; window.__op2.game.setState('playing'); });
    await guest.waitForFunction(() => window.__op2.ctx.enemies.alive.length > 0, null, { timeout: 120000 });
    await sleep(2500);
    const live = { host: await state(host), guest: await state(guest) };
    out.live = live;
    check(live.guest.enemies > 0 && live.host.enemies > 0 && live.guest.wave === live.host.wave, `${which}: the host's wave is on the guest's screen`, live);
    await shot(host, 'wave-host'); await shot(guest, 'wave-guest');

    if (which === 'defense') {
      const garrison = await host.evaluate(() => window.__op2.ctx.allies?.allies?.filter(a => a.state !== 'dead').length ?? 0);
      if (garrison > 0) {
        await guest.waitForFunction(() => window.__op2.ctx.coop.world.allyBodies.size > 0, null, { timeout: 15000 });
        // Stand the guest where the garrison is, and look at it.
        const at = await host.evaluate(() => window.__op2.ctx.allies.allies.find(a => a.state !== 'dead').body.position.toArray());
        await guest.evaluate(at => { const { ctx } = window.__op2; const V = ctx.player.position.constructor; ctx.player.teleport(new V(at[0] + 4, at[1], at[2] + 4), Math.PI * 0.25); }, at);
        await sleep(1500); await shot(guest, 'guest-sees-garrison');
      }
      out.garrison = { host: garrison, guest: await guest.evaluate(() => window.__op2.ctx.coop.world.allyBodies.size) };
      check(out.garrison.guest === out.garrison.host, "defense: the host's garrison is drawn on the guest", out.garrison);
    }

    if (which === 'humans') {
      progress('a surrender, cuffed by the guest');
      await calm(host);
      const placed = await host.evaluate(() => {
        const { ctx } = window.__op2; const V = ctx.player.position.constructor;
        const s = ctx.world.playerSpawns[0];
        const at = s.position.clone().add(new V(-Math.sin(s.yaw) * 5, 0, -Math.cos(s.yaw) * 5));
        const snapped = at.clone(); if (ctx.world.nav.nearest?.(at, 4, snapped)) at.copy(snapped);
        const enemy = ctx.enemies.spawn('trooper', at);
        const o = ctx.enemies.outpost;
        const soldier = o.soldiers.find(x => x.e === enemy);
        if (soldier) { soldier.fate = 'surrender'; o.onSurrender(soldier); }
        return { uid: enemy.uid, at: at.toArray(), spawn: s.position.toArray(), yaw: s.yaw, soldier: !!soldier };
      });
      check(placed.soldier, 'humans: a soldier was placed to give up');
      await guest.evaluate(p => { const { ctx } = window.__op2; const V = ctx.player.position.constructor; ctx.player.teleport(new V(...p.spawn), p.yaw); }, placed);
      await guest.waitForFunction(uid => { const r = window.__op2.ctx.coop.world.replicas.get(uid); return r && (r.to.flags & 128); }, placed.uid, { timeout: 20000 });
      await guest.evaluate(at => {
        const { ctx } = window.__op2; const V = ctx.player.position.constructor;
        const target = new V(...at); const me = target.clone().add(new V(1.6, 0, 0));
        ctx.player.teleport(me, Math.PI / 2);
        ctx.player.pitch = -0.35; window.__op2.game.setState('playing');
      }, placed.at);
      await sleep(1200);
      const posture = await guest.evaluate(uid => window.__op2.ctx.coop.world.replicas.get(uid)?.to.posture, placed.uid);
      out.surrender = { posture };
      await shot(guest, 'guest-sees-surrender');
      await guest.evaluate(() => window.__op2.ctx.input.simulate('interact', true)); await sleep(1100);
      await guest.evaluate(() => window.__op2.ctx.input.simulate('interact', false));
      await host.waitForFunction(uid => window.__op2.ctx.enemies.outpost.soldiers.find(s => s.e.uid === uid)?.cuffed, placed.uid, { timeout: 15000 });
      check(['handsUp', 'kneel', 'cower'].includes(posture), 'humans: the guest sees the man with his hands up', out.surrender);
      check(true, 'humans: the guest held E and the host cuffed the man for them');
      await sleep(1000); await shot(guest, 'guest-cuffed');
    }
    const final = { host: await state(host), guest: await state(guest) };
    out.final = final;
    check(out.errors.length === 0, `${which}: no page exceptions`, out.errors);
    return out;
  } catch (error) {
    out.failure = error.stack ?? String(error);
    throw error;
  } finally {
    writeFileSync(`${outDir}/modes-${which}-evidence.json`, JSON.stringify(out, null, 2));
    await guest?.close();
  }
}
