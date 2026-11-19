// Team rules proof 3: dropping out and coming back. A guest buys a kit, its page dies, and the same browser comes back (a
// reload): guns, mods, rounds, grenades, implants, brain chips, call-ins, credits, score and kills are back, kept on the
// host under the browser's id. Then the same again after bleeding out: a rejoin is not a free revive, and the player gets up
// with the rest of the team when the wave is cleared.
//
//   TEAM_PLAYERS=2 (default), TEAM_NET=bad, COOP_NET=rtc: see coop-team-kit.mjs.
//   node tools/shot.mjs --port 5310 --dpr 2 --w 1440 --h 900 --wait 500 --timeout 600 \
//     --script tools/scripts/coop-team-rejoin.mjs --out tools/out/team/rejoin-final.png
import { writeFileSync } from 'node:fs';
import { kit, skipBreak } from './coop-kit.mjs';
import { BAD_NET, allIn, bleedOut, clearWave, down, invulnerable, netName, players, said, teamParty, world } from './coop-team-kit.mjs';

const PLAYERS = players(2);

/** The whole kit as the page holds it, for comparing before and after. */
const kitOf = page => page.evaluate(() => {
  const { ctx } = window.__op2;
  const w = ctx.weapons, p = ctx.progression;
  return {
    guns: [...w.owned].sort(), current: w.current, mods: [...w.mods].sort(), fitted: [...w.fitted].sort(), grenades: w.grenades,
    ammo: Object.fromEntries([...w.owned].sort().map(id => [id, [w.ammo(id).mag, w.ammo(id).reserve]])),
    implants: [...p.loadout.fitted].sort(), implantSlots: p.loadout.slots, chips: [...ctx.contracts.chips.rack.fitted], chipSlots: ctx.contracts.chips.rack.slots,
    callIns: [...p.callIns].sort(), stims: p.stims.count, credits: ctx.contracts.wallet.credits, score: Math.round(p.score), kills: p.kills,
    alive: ctx.player.alive, health: Math.round(ctx.player.health),
  };
});

export default async function (host, { sleep, outDir }) {
  const out = { players: PLAYERS, net: netName(), transport: process.env.COOP_NET ?? 'loop', errors: [], checks: [], screenshots: [] };
  const tag = `rejoin-${PLAYERS}p${BAD_NET ? '-bad' : ''}`;
  const { check, progress, shot } = kit(outDir, tag, out, sleep);
  let pages = [host];
  try {
    const party = await teamParty(host, { mode: 'crucible', count: PLAYERS, out, progress, sleep });
    pages = party.pages;
    const guest = pages[1];
    await invulnerable(pages, true);
    await skipBreak(host);
    await host.waitForFunction(() => window.__op2.ctx.waves.wave >= 1 && window.__op2.ctx.waves.phase !== 'intermission', null, { timeout: 60000, polling: 250 });
    // The wave must not end on its own while pages reload: the host's enemies stand still and nothing on the map can kill them.
    await host.evaluate(() => { for (const e of window.__op2.ctx.enemies.alive) { e.behaviours = []; e.attacks = []; e.mode = 'hold'; e.invulnerable = true; } });
    const slot = await guest.evaluate(() => window.__op2.ctx.coop.lobby.me.slot);
    const seatOf = () => host.evaluate(slot => {
      const { lobby, world } = window.__op2.ctx.coop;
      const id = lobby.players.find(p => p.slot === slot)?.id;
      const seat = id ? world.team.seats.get(world.team.seatKey(id)) : null;
      return { key: id ? world.team.seatKey(id) : '', id, guns: seat?.kit?.guns.map(g => g.weapon).sort() ?? null, credits: seat?.purse?.credits ?? null, state: id ? world.team.life(id).state : null };
    }, slot);
    /** The guest's page dies and the same browser comes back: a reload, which rejoins the match by itself (the session's seat). */
    const rejoin = async () => {
      await guest.reload({ waitUntil: 'load', timeout: 120000 });
      await allIn([guest], 'crucible', PLAYERS - 1);
      await host.waitForFunction(n => window.__op2.ctx.coop.remotes.size >= n && [...window.__op2.ctx.coop.remotes.values()].every(r => r.char.root.visible), PLAYERS - 1, { timeout: 60000, polling: 250 });
    };

    progress('the guest kits up');
    await guest.evaluate(() => {
      const { ctx } = window.__op2;
      const w = ctx.weapons, p = ctx.progression;
      w.give('shotgun'); w.give('rocket');
      w.grantMod('suppressor'); w.fitMod('suppressor', true); w.grantMod('smgMag'); w.fitMod('smgMag', true); w.grantMod('shotgunChoke');
      w.switchTo('shotgun');
      Object.assign(w.ammo('shotgun'), { mag: 3, reserve: 17 }); Object.assign(w.ammo('smg'), { mag: 21, reserve: 133 });
      w.grenades = 5;
      p.loadout.openSlot(); p.loadout.fit('berserk', true); p.loadout.fit('jumpJet', true);
      ctx.contracts.chips.rack.openSlot(); ctx.contracts.chips.rack.fit('thermal', true);
      p.grantCallIn('airstrike'); p.grantCallIn('warthog');
      p.stims.give(2);
      ctx.contracts.wallet.credits = 2345;
      p.resume(7700, 31, 4);
    });
    await sleep(700);
    const before = await kitOf(guest);
    out.before = before;
    check(['rocket', 'shotgun', 'smg'].every(g => before.guns.includes(g)) && ['smgMag', 'suppressor'].every(m => before.fitted.includes(m)) && before.mods.includes('shotgunChoke')
      && before.credits === 2345, 'The guest holds the kit it bought, on top of what it was issued', before);
    await host.waitForFunction(slot => {
      const { lobby, world } = window.__op2.ctx.coop;
      const id = lobby.players.find(p => p.slot === slot)?.id;
      const seat = id && world.team.seats.get(world.team.seatKey(id));
      return seat?.kit?.guns.some(g => g.weapon === 'rocket') && seat.purse?.credits === 2345;
    }, slot, { timeout: 30000, polling: 250 });
    const kept = await seatOf();
    out.kept = kept;
    check(/^s:/.test(kept.key), 'The host keeps the kit under the player\'s seat, not the callsign', kept);
    await shot(guest, 'guest-kit-before');

    progress('the guest\'s page dies; the same browser comes back');
    await rejoin();
    await sleep(BAD_NET ? 1500 : 800);
    const after = await kitOf(guest);
    out.after = after;
    const same = key => JSON.stringify(after[key]) === JSON.stringify(before[key]);
    for (const key of ['guns', 'current', 'mods', 'fitted', 'grenades', 'ammo', 'implants', 'implantSlots', 'chips', 'chipSlots', 'callIns', 'stims', 'credits', 'score', 'kills']) {
      check(same(key), `After the rejoin the guest's ${key} are back`, { before: before[key], after: after[key] });
    }
    check(after.alive, 'They left alive, so they are back alive', after);
    check((await said(guest, /REJOINED · your kit and credits are back/)).length === 1, 'The guest is told its kit is back');
    const seat2 = await seatOf();
    check(seat2.key === kept.key && seat2.id !== kept.id, 'The same seat, under a new connection id', { kept, seat2 });
    await shot(guest, 'guest-kit-after');

    progress('not a free revive: the guest bleeds out, rejoins, and is still dead');
    await down(guest);
    await host.waitForFunction(slot => [...window.__op2.ctx.coop.world.team.cards.values()].some(c => c.slot === slot && c.state === 'down'), slot, { timeout: 30000, polling: 250 });
    await bleedOut(host, slot);
    await guest.waitForFunction(() => window.__op2.ctx.coop.world.team.myState === 'dead', null, { timeout: 30000, polling: 250 });
    await rejoin();
    await sleep(BAD_NET ? 1500 : 800);
    const dead = await kitOf(guest);
    const hostSees = await seatOf();
    out.dead = { dead, hostSees };
    check(!dead.alive && hostSees.state === 'dead', 'A player who left dead comes back dead, on both sides', { dead: dead.alive, hostSees });
    check(dead.guns.join() === before.guns.join() && dead.credits === before.credits, 'The kit and the purse still came back', dead);
    check((await said(guest, /YOU LEFT DOWN/)).length === 1, 'They are told why');
    await shot(guest, 'guest-back-dead');
    const waveNow = await world(host);
    check(waveNow.phase !== 'intermission', 'The wave is still on, so the team has not respawned since they left', waveNow);
    await clearWave(host);
    await guest.waitForFunction(() => window.__op2.ctx.player.alive === true, null, { timeout: 30000, polling: 250 });
    const up = await world(guest);
    check(up.alive && up.phase === 'intermission', 'They get up with the team when the wave is cleared', up);
  } catch (error) {
    out.errors.push(String(error?.stack ?? error));
    out.said = await Promise.all(pages.map(p => p.evaluate(() => (window.__said ?? []).slice(-40)).catch(() => [])));
    out.worlds = await Promise.all(pages.map(p => world(p).catch(() => null)));
    for (const [i, page] of pages.entries()) await page.screenshot({ path: `${outDir}/${tag}-fail-${i}.png` }).catch(() => {});
  }
  out.ok = out.errors.length === 0;
  writeFileSync(`${outDir}/${tag}.json`, JSON.stringify(out, null, 2));
  for (const page of pages.slice(1)) await page.close().catch(() => {});
  return { ok: out.ok, checks: out.checks.length, errors: out.errors };
}
