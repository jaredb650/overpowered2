// Dropped guns shared in co-op (docs/notes/coop.md, "The shared world"): a host's drop seen and taken by a guest, a guest's
// drop taken by another player, two players grabbing one gun on the same frame, a drop off a height, a drop the host refuses,
// and a drop made while a guest is still loading. Asserted on EVERY page. Every `[coop gun]` log line is kept in the evidence.
//
//   node tools/shot.mjs --port <port> --dpr 2 --w 1440 --h 900 --wait 500 --timeout 420 \
//     --script tools/scripts/coop-world-drops.mjs --out tools/out/coop/world-a/drops.png
//   COOP_PLAYERS=2|3 (2 adds the loading guest as a third page)  COOP_MODE=crucible|outpost  COOP_MAP=office
//   COOP_SIM=lag:120,jitter:40,loss:0.05  COOP_NET=rtc
import { writeFileSync } from 'node:fs';
import { calm, inMatch, kit, startParty, teleport } from './coop-kit.mjs';
import { lateGuest } from './coop-world-pods.mjs';

/** The guns a page has on the ground, as plain data. */
const drops = page => page.evaluate(() => window.__op2.ctx.weapons.dropped.drops.map(d => ({
  id: d.id, weapon: d.weapon, fitted: [...d.fitted], mag: d.mag, reserve: d.reserve, by: d.by, at: [...d.at], age: d.age, fall: d.fall,
  pending: d.pending, mine: d.mine, marker: !!d.mark?.visible, model: !!d.root?.parent, y: d.root?.position.y ?? null,
})));
const owns = (page, weapon) => page.evaluate(w => window.__op2.ctx.weapons.owned.has(w), weapon);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const core = list => list.map(({ id, weapon, fitted, mag, reserve, by, at }) => ({ id, weapon, fitted, mag, reserve, by, at }));

/** One press of an action, held for a few frames. */
const tap = async (page, action, sleep) => {
  await page.evaluate(a => { window.__op2.game.setState('playing'); window.__op2.ctx.input.simulate(a, true); }, action);
  await sleep(120);
  await page.evaluate(a => window.__op2.ctx.input.simulate(a, false), action);
};
/** Presses until `done` holds on the page (a press can fall on a frame where the hands are busy). */
const press = async (page, action, sleep, done, arg) => {
  for (let i = 0; i < 20; i++) {
    await tap(page, action, sleep);
    await sleep(250);
    if (await page.evaluate(done, arg)) return;
  }
  throw new Error(`${action} never took`);
};
/** A Deuce with the quad, two shells in, nine spare, in the hands. */
const armDeuce = page => page.evaluate(() => {
  const w = window.__op2.ctx.weapons;
  w.give('deuce'); w.grantMod('deuceQuad'); w.fitMod('deuceQuad', true);
  const a = w.ammo('deuce'); a.mag = 2; a.reserve = 9;
  w.switchTo('deuce');
});
const held = (page, weapon) => page.evaluate(weapon => {
  const w = window.__op2.ctx.weapons;
  return { owned: w.owned.has(weapon), fitted: [...w.fitted].filter(m => m.startsWith(weapon)), mag: w.owned.has(weapon) ? w.ammo(weapon).mag : null, reserve: w.owned.has(weapon) ? w.ammo(weapon).reserve : null };
}, 'deuce');
/** Stands a player `metres` from a point, looking at it. */
const lookAt = (page, at, metres, angle = 0) => page.evaluate(([at, metres, angle]) => {
  const { ctx, game } = window.__op2; const V = ctx.player.position.constructor;
  game.setState('playing');
  ctx.player.teleport(new V(at[0] + Math.sin(angle) * metres, at[1], at[2] + Math.cos(angle) * metres), 0);
  const d = new V(at[0], at[1] + 0.6, at[2]).sub(ctx.player.eye);
  ctx.player.yaw = Math.atan2(-d.x, -d.z); ctx.player.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
}, [at, metres, angle]);

export default async function (host, { sleep, outDir }) {
  const out = { errors: [], checks: [], screenshots: [], gunLog: [] };
  const players = Number(process.env.COOP_PLAYERS ?? 3);
  const mode = process.env.COOP_MODE ?? 'crucible', map = process.env.COOP_MAP || undefined, sim = process.env.COOP_SIM || undefined;
  const tag = `drops-${mode}${map ? `-${map}` : ''}-${players}p${sim ? '-lag' : ''}`;
  const { check, progress, shot } = kit(outDir, tag, out, sleep);
  const listen = (page, name) => page.on('console', m => { if (m.text().startsWith('[coop gun]')) out.gunLog.push(`${name}: ${m.text()}`); });
  let party;
  try {
    listen(host, 'host');
    party = await startParty(host, { mode, map, players, net: sim, out, progress, sleep });
    const { pages, guests } = party;
    guests.forEach((g, i) => listen(g, `guest${i + 1}`));
    await inMatch(pages, party.mode.contract);
    await calm(host);
    for (const page of pages) await page.evaluate(() => { window.__op2.ctx.player.modifiers.invulnerable = true; window.__op2.game.setState('playing'); });
    // A long quiet break to work in (test only).
    await host.evaluate(() => { const w = window.__op2.ctx.waves; w.phase = 'intermission'; w.nextWaveIn = 600; });
    const names = ['host', ...guests.map((_, i) => `guest${i + 1}`)];
    const [g1] = guests, other = guests[1] ?? host, otherName = guests[1] ? 'GUEST-THREE' : 'HOST-ONE';
    const spawn = await host.evaluate(() => window.__op2.ctx.world.playerSpawns[0].position.toArray());
    const wait = (page, fn, arg) => page.waitForFunction(fn, arg, { timeout: 20000 });
    progress(`${pages.length} pages in the match`);

    // --- 1. The host drops a modded Deuce: every page has it, at the same spot, with its mods and rounds and its marker.
    await teleport(host, spawn, 0);
    for (const [i, g] of guests.entries()) await teleport(g, [spawn[0] + 14 + i * 3, spawn[1], spawn[2] + 6], 0);
    await armDeuce(host);
    await sleep(1500);
    await press(host, 'dropWeapon', sleep, () => window.__op2.ctx.weapons.dropped.list.length === 1);
    for (const page of pages) await wait(page, () => window.__op2.ctx.weapons.dropped.drops.length === 1 && window.__op2.ctx.weapons.dropped.drops[0].mark?.visible);
    let seen = await Promise.all(pages.map(drops));
    out.hostDrop = seen;
    check(seen.every(s => same(core(s), core(seen[0]))), "The host's drop is the same gun at the same spot on every page", seen.map(core));
    check(seen[0][0].weapon === 'deuce' && seen[0][0].by === 'HOST-ONE' && seen[0][0].fitted.includes('deuceQuad') && seen[0][0].mag === 2 && seen[0][0].reserve === 9,
      'It carries its mods and rounds and the name of who dropped it', core(seen[0])[0]);
    check(seen.every(s => s[0].marker && s[0].model), 'Its model and its marker (light column and ring) are drawn on every page', seen.map(s => [s[0].model, s[0].marker]));
    check(!await owns(host, 'deuce'), 'The host no longer owns the Deuce');
    const gun = seen[0][0].at;
    for (const [i, page] of pages.entries()) await lookAt(page, gun, 5 + i, (i * Math.PI * 2) / 3 + 0.5);
    await sleep(900);
    for (const [i, page] of pages.entries()) await shot(page, `1-dropped-gun-${names[i]}`);

    // --- 2. A guest walks right over it: not taken. Then E: taken, with the mods and rounds, and gone everywhere.
    await teleport(g1, gun, 0);
    await sleep(1500);
    check(!await owns(g1, 'deuce') && (await drops(host)).length === 1, 'Walking over a friend\'s gun does not take it (co-op: E only)');
    const prompt = await g1.evaluate(() => [...document.querySelectorAll('body *')].map(e => e.childElementCount === 0 ? e.textContent : '').find(t => /Take DEUCE/i.test(t ?? '')) ?? null);
    check(/Take DEUCE \(from HOST-ONE\)/i.test(prompt ?? ''), 'The guest is shown the prompt over it', prompt);
    await press(g1, 'interact', sleep, () => window.__op2.ctx.weapons.owned.has('deuce'));
    for (const page of pages) await wait(page, () => window.__op2.ctx.weapons.dropped.list.length === 0);
    const taken = await held(g1);
    out.guestTook = taken;
    check(taken.owned && taken.fitted.includes('deuceQuad') && taken.mag === 2 && taken.reserve === 9, 'The guest holds the host\'s Deuce with its quad and its rounds', taken);
    check(!await owns(host, 'deuce') && !(guests[1] && await owns(guests[1], 'deuce')), 'Nobody else got one');

    // --- 3. The guest drops it; it lies there at once for the guest; another player takes it.
    await teleport(g1, [spawn[0] + 8, spawn[1], spawn[2]], 0);
    await sleep(2200);
    await g1.evaluate(() => window.__op2.ctx.weapons.switchTo('deuce'));
    await sleep(1500);
    await press(g1, 'dropWeapon', sleep, () => window.__op2.ctx.weapons.dropped.list.length === 1);
    for (const page of pages) await wait(page, () => window.__op2.ctx.weapons.dropped.drops.length === 1 && window.__op2.ctx.weapons.dropped.drops[0].id > 0);
    seen = await Promise.all(pages.map(drops));
    out.guestDrop = seen;
    check(seen.every(s => s.length === 1 && same(core(s), core(seen[0]))) && seen[0][0].by === 'GUEST-TWO', "A guest's drop is one gun, the same on every page, under the host's number", seen.map(core));
    await teleport(other, seen[0][0].at, 0);
    await sleep(700);
    await press(other, 'interact', sleep, () => window.__op2.ctx.weapons.owned.has('deuce'));
    for (const page of pages) await wait(page, () => window.__op2.ctx.weapons.dropped.list.length === 0);
    const shared = await held(other);
    check(shared.owned && shared.fitted.includes('deuceQuad') && shared.mag === 2 && shared.reserve === 9 && !await owns(g1, 'deuce'),
      `${otherName} took the guest's gun, mods and rounds, and the guest no longer has it`, shared);

    // --- 4. Two players grab the same gun on the same frame: exactly one gets it. The host drops it; with three players the
    // two guests race (the host settles it), with two the guest races the host.
    const far = [spawn[0] - 8, spawn[1], spawn[2] + 4];
    const lay = async page => {
      await teleport(page, far, 0);
      await sleep(2200);
      await page.evaluate(() => window.__op2.ctx.weapons.switchTo('deuce'));
      await sleep(1500);
      await press(page, 'dropWeapon', sleep, () => window.__op2.ctx.weapons.dropped.list.length === 1);
      for (const p of pages) await wait(p, () => window.__op2.ctx.weapons.dropped.drops.length === 1 && window.__op2.ctx.weapons.dropped.drops[0].id > 0);
    };
    if (other !== host) {
      // The gun goes back to the host first: a guest's drop taken by the host.
      await lay(other);
      await sleep(500);
      await press(host, 'interact', sleep, () => window.__op2.ctx.weapons.owned.has('deuce'));
      for (const page of pages) await wait(page, () => window.__op2.ctx.weapons.dropped.list.length === 0);
      check(await owns(host, 'deuce') && !await owns(other, 'deuce'), "The host took a guest's drop");
    }
    await lay(host);
    const prize = (await drops(host))[0].at;
    const rivals = guests.length >= 2 ? guests.slice(0, 2) : [host, g1];
    out.rivals = rivals.map(p => names[pages.indexOf(p)]);
    for (const [i, page] of rivals.entries()) await teleport(page, [prize[0] + (i ? 0.5 : -0.5), prize[1], prize[2]], 0);
    await sleep(900);
    await Promise.all(rivals.map(page => page.evaluate(() => { window.__op2.game.setState('playing'); window.__op2.ctx.input.simulate('interact', true); })));
    await sleep(200);
    await Promise.all(rivals.map(page => page.evaluate(() => window.__op2.ctx.input.simulate('interact', false))));
    for (const page of pages) await wait(page, () => window.__op2.ctx.weapons.dropped.list.length === 0);
    await sleep(sim ? 1200 : 500);
    const winners = await Promise.all(pages.map(p => owns(p, 'deuce')));
    out.race = winners;
    check(winners.filter(Boolean).length === 1, 'Two players pressed E on one gun together: exactly one has it, and it is off the ground for all', winners);
    const winner = pages[winners.indexOf(true)];

    // --- 5. Dropped from a height: it comes to rest on the ground below, the same on every page.
    await sleep(2200);
    await winner.evaluate(() => window.__op2.ctx.weapons.switchTo('deuce'));
    await sleep(1500);
    const ground = spawn[1];
    for (let i = 0; i < 12 && !(await drops(winner)).length; i++) {
      await winner.evaluate(([spawn]) => {
        const { ctx, game } = window.__op2; const V = ctx.player.position.constructor;
        game.setState('playing');
        ctx.player.teleport(new V(spawn[0] + 4, spawn[1] + 9, spawn[2] - 6), 0);
        ctx.input.simulate('dropWeapon', true);
        setTimeout(() => ctx.input.simulate('dropWeapon', false), 150);
      }, [spawn]);
      await sleep(600);
    }
    for (const page of pages) await wait(page, () => window.__op2.ctx.weapons.dropped.drops.length === 1 && window.__op2.ctx.weapons.dropped.drops[0].id > 0);
    await sleep(2000);
    seen = await Promise.all(pages.map(drops));
    out.highDrop = seen;
    check(seen.every(s => same(core(s), core(seen[0]))), 'A gun dropped from the air is at one spot on every page', seen.map(s => s[0]?.at));
    check(Math.abs(seen[0][0].at[1] - ground) < 0.3 && seen[0][0].fall > 3, 'It fell to the ground below instead of hanging in the air', { at: seen[0][0].at, fall: seen[0][0].fall, ground });
    check(seen.every(s => s[0].y !== null && Math.abs(s[0].y - (s[0].at[1] + 0.45)) < 0.2), 'It is drawn resting just over the ground on every page', seen.map(s => s[0].y));
    await lookAt(host, seen[0][0].at, 4, 1);
    await sleep(700);
    await shot(host, '2-fell-to-the-ground-host');
    // Clear it away: the host takes it.
    await teleport(host, seen[0][0].at, 0);
    await sleep(600);
    await press(host, 'interact', sleep, () => window.__op2.ctx.weapons.dropped.list.length === 0);
    for (const page of pages) await wait(page, () => window.__op2.ctx.weapons.dropped.list.length === 0);

    // --- 6. A drop the host refuses comes back to the guest's hands (the message is spoiled on its way out, test only).
    await g1.evaluate(() => {
      const { ctx } = window.__op2; const w = ctx.weapons;
      w.give('shotgun'); w.switchTo('shotgun');
      const world = ctx.coop.world, send = world.sendGun.bind(world);
      world.sendGun = (event, to) => { world.sendGun = send; send(event.op === 'drop' ? { ...event, gun: { ...event.gun, weapon: 'not-a-gun' } } : event, to); };
    });
    await teleport(g1, [spawn[0] + 8, spawn[1], spawn[2] + 8], 0);
    await sleep(2500);
    await press(g1, 'dropWeapon', sleep, () => true);
    await sleep(sim ? 1500 : 800);
    const refused = { guestOwns: await owns(g1, 'shotgun'), guestGround: (await drops(g1)).length, hostGround: (await drops(host)).length,
      line: await g1.evaluate(() => /REFUSED THAT DROP/.test(document.body.textContent)) };
    out.refused = refused;
    check(refused.guestOwns && refused.guestGround === 0 && refused.hostGround === 0, 'A drop the host refuses is back in the guest\'s hands, and nowhere on the ground', refused);

    // --- 7. A gun dropped while a guest is still loading is there when that guest arrives (two-player run: a third page joins).
    if (players === 2) {
      progress('a guest joins; the host drops a gun while it loads');
      await armDeuce(host);
      await teleport(host, spawn, 0);
      await sleep(1500);
      const joining = lateGuest(party, 'LATE-ONE');
      const late = await joining;
      listen(late, 'late');
      // The late page is on its way into the match now: its map is loading. The host drops in that window.
      await late.waitForURL(new RegExp(`contract=${party.mode.contract}`), { timeout: 90000 });
      const ready = await late.evaluate(() => !!window.__op2?.ctx?.coop?.world).catch(() => false);
      await press(host, 'dropWeapon', sleep, () => window.__op2.ctx.weapons.dropped.list.length === 1);
      out.loading = { lateWorldUpAtDrop: ready, hostDroppedAt: Date.now() };
      await inMatch([late], party.mode.contract);
      await wait(late, () => window.__op2.ctx.weapons.dropped.drops.length === 1 && window.__op2.ctx.weapons.dropped.drops[0].mark?.visible);
      const [h, l] = await Promise.all([drops(host), drops(late)]);
      out.loading.late = l; out.loading.host = h;
      check(!ready, 'The gun was dropped before the joining guest\'s world was up');
      check(same(core(h), core(l)), 'The guest that was loading has the gun, the same as the host', core(l));
      check(l[0].age > 1 && Math.abs(l[0].age - h[0].age) < 3, 'It arrived with its age (lying there, not thrown again)', [h[0].age, l[0].age]);
      await lookAt(late, l[0].at, 4, 2);
      await sleep(900);
      await shot(late, '3-dropped-while-loading-late-guest');
      await teleport(late, l[0].at, 0);
      await sleep(600);
      await press(late, 'interact', sleep, () => window.__op2.ctx.weapons.owned.has('deuce'));
      for (const page of party.pages) await wait(page, () => window.__op2.ctx.weapons.dropped.list.length === 0);
      check(await owns(late, 'deuce'), 'and takes it');
    }
    check(out.gunLog.length > 10 && out.gunLog.some(l => /host got drop/.test(l)) && out.gunLog.some(l => /guest got add/.test(l)), 'Every gun message was logged on both sides', out.gunLog.length);
    check(out.errors.length === 0, 'No page exceptions', out.errors);
    return out;
  } catch (error) {
    out.failure = error.stack ?? String(error);
    for (const [i, page] of (party?.pages ?? []).entries()) await page.screenshot({ path: `${outDir}/${tag}-fail-${i}.png` }).catch(() => {});
    throw error;
  } finally {
    writeFileSync(`${outDir}/${tag}-evidence.json`, JSON.stringify(out, null, 2));
    for (const guest of party?.guests ?? []) await guest.close().catch(() => {});
  }
}
