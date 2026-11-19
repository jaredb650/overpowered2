// The villain's props are real for everyone (world-b, finding V2 props). Endless Humans with a host and two guests: a mine the
// host's villain lays is on both guests; a guest walks onto one and it goes off for all, hurting that guest; a guest shoots
// one with its own gun and it is gone for all; a tripwire and a claymore trip under a guest; a snare's cable is cut by a
// guest's round; a shutter drops across a door as a real wall on every screen and a guest's two blasts take it down; smoke is
// on every screen; and a late joiner gets everything standing.
//   node tools/shot.mjs --port 5390 --dpr 2 --w 1440 --h 900 --wait 500 --timeout 600 --script tools/scripts/coop-worldb-props.mjs --out tools/out/coop/world-b/props.png
//   COOP_SIM=lag:120,jitter:40,loss:0.05 for the bad network; COOP_PLAYERS=2 for one guest.
import { writeFileSync } from 'node:fs';
import { ahead, give, inMatch, kit, live, startParty, teleport } from './coop-kit.mjs';
import { lateJoin, lookAt, waits } from './coop-worldb-kit.mjs';

/** The villain's props as this page has them. */
const props = page => page.evaluate(() => {
  const c = window.__op2.ctx.enemies.outpost.commander;
  const r = n => Math.round(n * 100) / 100;
  return {
    devices: c.devices.live.map(d => [d.id, d.kind, r(d.position.x), r(d.position.y), r(d.position.z), d.lit ? 1 : 0]).sort((a, b) => a[0] - b[0]),
    shutters: c.barricades.count, smoke: c.smoke.standing.length, guest: c.devices.link?.guest ?? null,
  };
});
const devicesOf = async page => (await props(page)).devices.map(d => d.slice(0, 5));
const host$ = (host, fn, arg) => host.evaluate(fn, arg);

export default async function (host, { sleep, outDir }) {
  const out = { errors: [], checks: [], screenshots: [] };
  const players = Number(process.env.COOP_PLAYERS ?? 3);
  const sim = process.env.COOP_SIM || undefined;
  const tag = `props-${process.env.COOP_NET ?? 'loop'}-${players}p${sim ? '-badnet' : ''}`;
  const { check, progress, shot } = kit(outDir, tag, out, sleep);
  const { until, agree } = waits({ check, sleep, dump: props });
  let party;
  try {
    party = await startParty(host, { mode: 'outpost', players, net: sim, out, progress, sleep });
    await live(party, { enemies: 1 });
    const { guests, pages } = party, guest = guests[0], other = guests[1] ?? guests[0];
    // The squads are sent home: this proof is about what the villain leaves lying around.
    await host$(host, () => { const { ctx } = window.__op2; ctx.waves.reset?.(); for (const e of [...ctx.enemies.alive]) ctx.enemies.withdraw(e); });
    for (const g of guests) check((await props(g)).guest === true, "A guest's devices answer to the host");

    // Open floor in front of the spawn, on the nav mesh, for everything below.
    const base = await ahead(host, 9);
    const spot = (dx, dz) => host$(host, ([b, dx, dz]) => {
      const { ctx } = window.__op2; const V = ctx.player.position.constructor;
      const p = new V(b[0] + dx, b[1], b[2] + dz); ctx.world.nav.nearest?.(p, 4, p); return [p.x, p.y, p.z];
    }, [base.at, dx, dz]);
    for (const page of pages) await teleport(page, base.spawn, base.yaw);

    // --- A mine: seen, walked onto by a guest ---------------------------------------------------------------------------
    const mineAt = await spot(0, 0);
    const mine = await host$(host, at => { const { ctx } = window.__op2; const V = ctx.player.position.constructor; return ctx.enemies.outpost.commander.devices.mine(new V(...at)).id; }, mineAt);
    let now = await agree(pages, devicesOf, 'A mine the villain laid');
    check(now.length === 1 && now[0][0] === mine && now[0][1] === 'mine', 'The mine is on every screen, with the host\'s number', now);
    await teleport(guest, [mineAt[0] + 1.6, mineAt[1], mineAt[2] + 3.2], 0);
    await lookAt(guest, [mineAt[0], mineAt[1] + 0.1, mineAt[2]]);
    await sleep(1200);
    await shot(guest, 'guest-mine');
    const visible = await guest.evaluate(id => { const d = window.__op2.ctx.enemies.outpost.commander.devices.live.find(x => x.id === id); return !!d?.model?.visible && !!d.model.parent; }, mine);
    check(visible, "The mine's model is in the guest's scene");

    await other.evaluate(() => { window.__op2.ctx.player.modifiers.invulnerable = false; });
    const health = await other.evaluate(() => window.__op2.ctx.player.health + window.__op2.ctx.player.armor);
    await teleport(other, [mineAt[0] + 0.4, mineAt[1], mineAt[2]], 0);
    await until(host, id => !window.__op2.ctx.enemies.outpost.commander.devices.live.some(d => d.id === id), mine, 'A guest steps on the mine and the host sets it off');
    for (const page of pages) await until(page, () => window.__op2.ctx.enemies.outpost.commander.devices.live.length === 0, null, 'The mine is gone on every screen');
    await until(other, h => window.__op2.ctx.player.health + window.__op2.ctx.player.armor < h, health, 'The guest who stepped on it is hurt');
    await other.evaluate(() => { window.__op2.ctx.player.modifiers.invulnerable = true; });
    for (const page of pages) await teleport(page, base.spawn, base.yaw);

    // --- A mine shot by a guest's own gun -----------------------------------------------------------------------------------
    const second = await host$(host, at => { const { ctx } = window.__op2; const V = ctx.player.position.constructor; return ctx.enemies.outpost.commander.devices.mine(new V(...at)).id; }, mineAt);
    await agree(pages, devicesOf, 'A second mine');
    await give(guest, 'smg');
    await teleport(guest, base.spawn, base.yaw);
    await sleep(300);
    await lookAt(guest, [mineAt[0], mineAt[1] + 0.15, mineAt[2]]);
    await guest.evaluate(() => { window.__op2.game.setState('playing'); window.__op2.ctx.weapons.refillMagazines(); window.__op2.ctx.input.simulate('fire', true); });
    const aimer = setInterval(() => { lookAt(guest, [mineAt[0], mineAt[1] + 0.15, mineAt[2]]).catch(() => {}); }, 100);
    await until(host, id => !window.__op2.ctx.enemies.outpost.commander.devices.live.some(d => d.id === id), second, "A guest's SMG sets the mine off on the host");
    clearInterval(aimer);
    await guest.evaluate(() => window.__op2.ctx.input.simulate('fire', false));
    for (const page of pages) await until(page, () => window.__op2.ctx.enemies.outpost.commander.devices.live.length === 0, null, 'The shot mine is gone on every screen');

    // --- A tripwire and a claymore under a guest; a snare cut by a round ---------------------------------------------------------
    const a = await spot(-3, 0), b = await spot(3, 0), clay = await spot(0, 5);
    const laid = await host$(host, ([a, b, clay, spawn]) => {
      const { ctx } = window.__op2; const V = ctx.player.position.constructor; const d = ctx.enemies.outpost.commander.devices;
      const wire = d.tripwire(new V(...a), new V(...b)).id;
      const claymore = d.claymore(new V(...clay), new V(spawn[0] - clay[0], 0, spawn[2] - clay[2]).normalize()).id;
      return { wire, claymore };
    }, [a, b, clay, base.spawn]);
    now = await agree(pages, devicesOf, 'A tripwire and a claymore');
    check(now.length === 2, 'Both are on every screen', now);
    await teleport(guest, [mineAt[0] + 1.2, mineAt[1], mineAt[2] + 4], 0);
    await lookAt(guest, [mineAt[0], mineAt[1] + 0.3, mineAt[2]]);
    await sleep(900);
    await shot(guest, 'guest-tripwire');
    await teleport(other, [(a[0] + b[0]) / 2, a[1], (a[2] + b[2]) / 2], 0);
    await until(host, id => !window.__op2.ctx.enemies.outpost.commander.devices.live.some(d => d.id === id), laid.wire, 'A guest walks through the wire and it goes off on the host');
    await teleport(other, [clay[0] + (base.spawn[0] - clay[0]) * 0.4, clay[1], clay[2] + (base.spawn[2] - clay[2]) * 0.4], 0);
    await until(host, id => !window.__op2.ctx.enemies.outpost.commander.devices.live.some(d => d.id === id), laid.claymore, "A guest in the claymore's fan sets it off on the host");
    for (const page of pages) await until(page, () => window.__op2.ctx.enemies.outpost.commander.devices.live.length === 0, null, 'Both are gone on every screen');
    for (const page of pages) await teleport(page, base.spawn, base.yaw);

    const snare = await host$(host, ([a, b]) => { const { ctx } = window.__op2; const V = ctx.player.position.constructor; return ctx.enemies.outpost.commander.devices.snare(new V(...a), new V(...b)).id; }, [a, b]);
    await agree(pages, devicesOf, 'A snare');
    await teleport(other, base.spawn, base.yaw);
    await give(other, 'smg');
    await other.evaluate(() => { window.__op2.game.setState('playing'); window.__op2.ctx.weapons.refillMagazines(); window.__op2.ctx.input.simulate('fire', true); });
    const aim2 = setInterval(() => { lookAt(other, [a[0], a[1] + 0.15, a[2]]).catch(() => {}); }, 100);
    await until(host, id => !window.__op2.ctx.enemies.outpost.commander.devices.live.some(d => d.id === id), snare, "Another guest's rounds cut the cable at its post, on the host");
    clearInterval(aim2);
    await other.evaluate(() => window.__op2.ctx.input.simulate('fire', false));
    for (const page of pages) await until(page, () => window.__op2.ctx.enemies.outpost.commander.devices.live.length === 0, null, 'The cable is gone on every screen');

    // --- A shutter: a real wall on every screen, down to a guest's two blasts ----------------------------------------------------
    const door = await host$(host, () => {
      const { ctx } = window.__op2; const c = ctx.enemies.outpost.commander; const V = ctx.player.position.constructor;
      const b = c.barricades; const out = new V();
      // The door furthest from every player, as his own choice is made away from them.
      let best = null, bestD = -1;
      for (const d of c.doorList) { const dist = Math.hypot(d.x - ctx.player.position.x, d.z - ctx.player.position.z); if (dist > bestD && c.posts.doorFloor(d, out)) { best = d; bestD = dist; } }
      c.posts.doorFloor(best, out);
      b.shutters.push(b.build(best, out.y));
      c.o.routes.setClosed(best.x, best.z, best.dx, best.dz, best.w, true);
      b.link.dropped(best, out.y);
      return { x: best.x, z: best.z, dx: best.dx, dz: best.dz, w: best.w, floor: out.y };
    });
    for (const page of pages) await until(page, () => window.__op2.ctx.enemies.outpost.commander.barricades.count === 1, null, 'The shutter is down on every screen');
    const blocked = page => page.evaluate(d => {
      const { ctx } = window.__op2; const V = ctx.player.position.constructor;
      ctx.physics.flushQueries?.();
      // Through the doorway, along the way it faces.
      const n = Math.hypot(d.dx, d.dz) || 1; const dir = new V(d.dx / n, 0, d.dz / n);
      const from = new V(d.x - dir.x * 1.5, d.floor + 1.2, d.z - dir.z * 1.5);
      return ctx.physics.raycast(from, dir, 3, 1) !== null;
    }, door);
    await sleep(800);
    for (const g of guests) check(await blocked(g), "The guest's own shutter stops a round through the doorway");
    const n = Math.hypot(door.dx, door.dz) || 1;
    await teleport(guest, [door.x - (door.dx / n) * 5, door.floor, door.z - (door.dz / n) * 5], 0);
    await lookAt(guest, [door.x, door.floor + 1.6, door.z]);
    await sleep(900);
    await shot(guest, 'guest-shutter');
    for (let i = 0; i < 2; i++) {
      await guest.evaluate(d => { const { ctx } = window.__op2; const V = ctx.player.position.constructor; ctx.combat.explode(new V(d.x, d.floor + 1, d.z), { radius: 4, damage: 150, kind: 'rocket', source: 'rocket', team: 'player' }); }, door);
      await sleep(500);
    }
    for (const page of pages) await until(page, () => window.__op2.ctx.enemies.outpost.commander.barricades.count === 0, null, "A guest's two blasts take the shutter down on every screen");
    for (const g of guests) check(!(await blocked(g)), 'The doorway is open again on the guest');

    // --- Smoke -----------------------------------------------------------------------------------------------------------------
    const smokeAt = await spot(0, 2);
    await host$(host, at => { const { ctx } = window.__op2; const V = ctx.player.position.constructor; ctx.enemies.outpost.commander.smoke.pop(new V(...at)); }, smokeAt);
    for (const g of guests) await until(g, () => window.__op2.ctx.enemies.outpost.commander.smoke.standing.length === 1, null, "The villain's smoke is on a guest");
    await teleport(guest, base.spawn, base.yaw);
    await lookAt(guest, [smokeAt[0], smokeAt[1] + 1.5, smokeAt[2]]);
    await sleep(3500);
    await shot(guest, 'guest-smoke');

    // --- A late joiner ---------------------------------------------------------------------------------------------------------
    await host$(host, ([a, b, m]) => {
      const { ctx } = window.__op2; const V = ctx.player.position.constructor; const d = ctx.enemies.outpost.commander.devices;
      d.mine(new V(...m)); d.tripwire(new V(...a), new V(...b)); d.beacon(new V(m[0], m[1], m[2] + 3));
    }, [a, b, clay]);
    for (const page of pages) await teleport(page, base.spawn, base.yaw);
    if (players === 2) {
      // A cloud lasts 13 s, less than a page takes to load: for this step the host's is kept up until the newcomer is in.
      await host$(host, at => { const { ctx } = window.__op2; const V = ctx.player.position.constructor; const s = ctx.enemies.outpost.commander.smoke; s.pop(new V(...at)); for (const k of s.clouds) if (k.until > ctx.time.elapsed) k.until = ctx.time.elapsed + 600; }, smokeAt);
      const late = await lateJoin(party, 'LATE-JOIN');
      await inMatch([late], 'outpost', true);
      await late.evaluate(() => { window.__op2.ctx.player.modifiers.invulnerable = true; });
      const all = await agree([host, late], devicesOf, "The late joiner's devices");
      check(all.length === 3, 'The late joiner has the mine, the wire and the beacon', all);
      await until(late, () => window.__op2.ctx.enemies.outpost.commander.smoke.standing.length === 1, null, 'The late joiner has the smoke still up');
    }
    out.final = await Promise.all(party.pages.map(props));
    check(out.errors.length === 0, 'No page exceptions', out.errors);
    return out;
  } catch (error) {
    out.failure = error.stack ?? String(error);
    throw error;
  } finally {
    writeFileSync(`${outDir}/${tag}-evidence.json`, JSON.stringify(out, null, 2));
    for (const guest of party?.guests ?? []) await guest.close().catch(() => {});
  }
}
