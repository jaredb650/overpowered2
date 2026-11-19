// Enemy vehicles on a guest's screen are real (world-b, audit B). Outpost Defense's open field, a host and a guest (and a
// late joiner; COOP_PLAYERS=3 is a host and two guests). A scout car drives past: on the guest its wheels turn, it has its roof
// gun, and it cannot be walked or shot through. A tank lays its gun on the guest and fires: the guest's copy has the turret
// round on it and the gun lifted. A track is thrown and the engine catches on the host: gone and burning on the guest. Both
// are destroyed: each becomes a wreck on the guest where it died, as cover, the tank's turret thrown clear. The attack
// helicopter flies on the guest, loses its tail when the host's does and comes down as a wreck. A player who joins late has
// every wreck.
//   node tools/shot.mjs --port 5390 --dpr 2 --w 1440 --h 900 --wait 500 --timeout 900 --script tools/scripts/coop-worldb-vehicles.mjs --out tools/out/coop/world-b/vehicles.png
//   COOP_SIM=lag:120,jitter:40,loss:0.05 for the bad network.
import { writeFileSync } from 'node:fs';
import { inMatch, kit, live, startParty, teleport } from './coop-kit.mjs';
import { lateJoin, lookAt, waits } from './coop-worldb-kit.mjs';

/** Host: the live vehicles, with the ids the guests know them by. */
const fleet = host => host.evaluate(() => {
  const { ctx } = window.__op2; const net = ctx.coop.world.vehicles;
  return ctx.enemies.vehicles.live.map(v => ({ id: net.ids.get(v), kind: v.def.kind, at: v.position.toArray().map(n => Math.round(n * 10) / 10), turret: v.turretYaw, speed: v.drive?.speed ?? 0,
    health: Math.round(v.health), stage: v.stage ?? null }));
});
/** Guest: its copies. */
const copies = page => page.evaluate(() => {
  const net = window.__op2.ctx.coop.world.vehicles;
  return { puppets: [...net.puppets].map(([id, p]) => ({ id, kind: p.kind, at: p.model.root.position.toArray().map(n => Math.round(n * 10) / 10), turret: p.model.turret?.rotation.y ?? 0, ...net.parts(id) })),
    wrecks: [...net.wrecks].map(([wid, w]) => ({ wid, at: w.wreck.root.position.toArray().map(n => Math.round(n * 10) / 10), burning: w.wreck.burnLeft > 0, flung: !!w.flung })) };
});
const order = (kind, x, z, route, parked = false) => ({ kind, order: { x, y: 0, z, route, tag: null, crew: [], crewTag: null, holds: false, holdYaw: NaN, parked } });

export default async function (host, { sleep, outDir }) {
  const out = { errors: [], checks: [], screenshots: [] };
  const players = Number(process.env.COOP_PLAYERS ?? 2);
  const sim = process.env.COOP_SIM || undefined;
  const tag = `vehicles-${process.env.COOP_NET ?? 'loop'}-${players}p${sim ? '-badnet' : ''}`;
  const { check, progress, shot } = kit(outDir, tag, out, sleep);
  const { until } = waits({ check, sleep, dump: p => p.evaluate(() => !!window.__op2.ctx.coop.hosting).then(h => (h ? fleet(p) : copies(p))) });
  let party;
  try {
    party = await startParty(host, { mode: 'defense', players, net: sim, out, progress, sleep });
    await live(party, { enemies: 3 });
    const { guests, pages } = party, guest = guests[0];
    // The wave's own men and machines are sent home: this proof brings its own.
    await host.evaluate(() => {
      const { ctx } = window.__op2; ctx.waves.running = false;
      for (const e of [...ctx.enemies.alive]) ctx.enemies.withdraw(e);
      for (const v of [...ctx.enemies.vehicles.live]) v.remove();
      // The garrison would shoot the crews; it stands down for this.
      for (const a of [...(ctx.allies?.allies ?? [])]) a.body && ctx.allies.dismiss?.(a);
    });
    /** Spawns one on the host and returns the id the guests will know it by (given on the host's next send). */
    const spawn = async o => {
      await host.evaluate(o => { window.__spawned = window.__op2.ctx.enemies.vehicles.spawnGround(o.kind, o.order); }, o);
      await host.waitForFunction(() => window.__op2.ctx.coop.world.vehicles.ids.get(window.__spawned) !== undefined, null, { timeout: 60000 });
      return host.evaluate(() => window.__op2.ctx.coop.world.vehicles.ids.get(window.__spawned));
    };

    // Everyone out on the north field, the host off to the side and far back so the machines go for the guest.
    await teleport(host, [60, 0, -100], 0);
    await teleport(guest, [0, 0, -78], Math.PI);
    for (const g of guests.slice(1)) await teleport(g, [-12, 0, -78], Math.PI);

    // --- A scout car drives across the guest's front -----------------------------------------------------------------------
    await spawn(order('humvee', -40, -98, [{ x: 40, z: -98, hold: 0 }]));
    await until(guest, () => window.__op2.ctx.coop.world.vehicles.puppets.size === 1, null, 'The scout car is on the guest');
    const car = (await copies(guest)).puppets[0];
    await sleep(1200);
    const a = (await copies(guest)).puppets[0];
    await sleep(1200);
    const b = (await copies(guest)).puppets[0];
    check(Math.abs(b.wheelTurn - a.wheelTurn) > 1 && Math.abs(b.speed) > 1, "On the guest its wheels turn as it drives", { a: a.wheelTurn, b: b.wheelTurn, speed: b.speed });
    check(Math.abs(b.at[0] - a.at[0]) > 2, 'and it moves along the road', [a.at, b.at]);
    check(b.roofGun === true, 'It carries its roof gun on the guest', b);
    await lookAt(guest, [b.at[0], 1.4, b.at[2]]);
    await shot(guest, 'guest-scout-car');
    // It stops at the end of its road: cover on the guest's own physics, and nothing to walk through.
    await until(host, () => Math.abs(window.__op2.ctx.enemies.vehicles.live[0].drive.speed) < 0.05, null, 'It comes to a stop');
    await sleep(1200);
    const parked = (await copies(guest)).puppets[0];
    const blocked = await guest.evaluate(at => {
      const { ctx } = window.__op2; const V = ctx.player.position.constructor;
      ctx.physics.flushQueries?.();
      return ctx.physics.raycast(new V(at[0], 1.2, at[2] + 8), new V(0, 0, -1), 16, 1) !== null;
    }, parked.at);
    check(blocked, "A round on the guest stops on the scout car's hull");
    await teleport(guest, [parked.at[0], 0, parked.at[2] + 6], 0);
    await guest.evaluate(() => { window.__op2.game.setState('playing'); window.__op2.ctx.player.yaw = 0; window.__op2.ctx.input.simulate('forward', true); });
    await sleep(2500);
    await guest.evaluate(() => window.__op2.ctx.input.simulate('forward', false));
    const stopped = await guest.evaluate(() => window.__op2.ctx.player.position.toArray());
    check(stopped[2] > parked.at[2] + 0.8, 'A guest walking at it is stopped by it, not through it', { player: stopped, car: parked.at });

    // --- A tank lays on the guest and fires ----------------------------------------------------------------------------------
    await teleport(guest, [3, 0, -86], Math.PI);
    const tankId = await spawn(order('tank', 0, -112, [{ x: 0, z: -104, hold: 0 }]));
    await until(guest, id => window.__op2.ctx.coop.world.vehicles.puppets.has(id), tankId, 'The tank is on the guest');
    await lookAt(guest, [0, 2, -104]);
    await host.evaluate(() => { const { ctx } = window.__op2; window.__shells = 0; const spawn = ctx.combat.spawnProjectile.bind(ctx.combat); ctx.combat.spawnProjectile = s => { if (s.source === 'tank_cannon') window.__shells++; return spawn(s); }; });
    await guest.evaluate(() => { const { ctx } = window.__op2; window.__flashes = 0; const flash = ctx.fx.muzzleFlash.bind(ctx.fx); ctx.fx.muzzleFlash = (...a) => { if (a[2] === 'autocannon') window.__flashes++; return flash(...a); }; });
    // For the picture, the guest's clock runs slow as the gun is laid, so the flash is on the screen when it is taken.
    await until(host, id => { const v = window.__op2.ctx.enemies.vehicles.live.find(v => window.__op2.ctx.coop.world.vehicles.ids.get(v) === id); return v?.stage === 'laying' && v.layLeft < 0.5; }, tankId, "The host's tank lays its gun on the guest", 120000);
    await guest.evaluate(() => { const t = window.__op2.ctx.time; window.__slow = setInterval(() => t.share('proof-shot', 0.03, 0, 0), 4); });
    await until(host, () => window.__shells >= 1, null, "The host's tank fires", 60000);
    await until(guest, () => window.__flashes >= 1, null, "The guest sees the tank's muzzle flash", 60000);
    await shot(guest, 'guest-tank-firing');
    await guest.evaluate(() => { clearInterval(window.__slow); window.__op2.ctx.time.unshare('proof-shot'); });
    const aimed = { host: (await fleet(host)).find(v => v.id === tankId), guest: (await copies(guest)).puppets.find(p => p.id === tankId) };
    out.aimed = aimed;
    const off = Math.abs(Math.atan2(Math.sin(aimed.host.turret - aimed.guest.turret), Math.cos(aimed.host.turret - aimed.guest.turret)));
    check(off < 0.25, "The guest's copy has its turret round where the host's is", aimed);

    // --- A thrown track and an engine fire ---------------------------------------------------------------------------------------
    await host.evaluate(id => {
      const { ctx } = window.__op2; const v = ctx.enemies.vehicles.live.find(v => ctx.coop.world.vehicles.ids.get(v) === id);
      for (const name of ['trackLeft', 'engine']) { const part = v.parts.find(p => p.def.id === name); v.take(part.pool + 1, part, 'rocket', v.position.clone()); }
    }, tankId);
    await until(guest, id => { const p = window.__op2.ctx.coop.world.vehicles.parts(id); return !!p && p.tracks[0] === false && (p.flags & 4) !== 0; }, tankId, 'The thrown track is gone and the engine burns on the guest');
    await sleep(1500);
    await shot(guest, 'guest-tank-burning');

    // --- Wrecks -------------------------------------------------------------------------------------------------------------------
    await host.evaluate(() => { const { ctx } = window.__op2; for (const v of [...ctx.enemies.vehicles.live]) v.take(1e6, null, 'rocket', v.position.clone()); });
    // The scout car burns for a few seconds before it goes up; the tank goes at once.
    await until(host, () => window.__op2.ctx.enemies.vehicles.live.length === 0 && window.__op2.ctx.enemies.vehicles.wrecks.length === 2, null, 'Both are destroyed on the host', 120000);
    for (const g of guests) await until(g, () => { const n = window.__op2.ctx.coop.world.vehicles; return n.puppets.size === 0 && n.wrecks.size === 2; }, null, 'Both are wrecks on the guest, and nothing is still driving', 60000);
    const wrecks = (await copies(guest)).wrecks;
    let hostWrecks = await host.evaluate(() => window.__op2.ctx.enemies.vehicles.wrecks.map(w => w.root.position.toArray().map(n => Math.round(n * 10) / 10)));
    check(wrecks.every(w => hostWrecks.some(h => Math.hypot(h[0] - w.at[0], h[2] - w.at[2]) < 1.5)), 'Each wreck lies where the host\'s does', { wrecks, hostWrecks });
    check(wrecks.some(w => w.flung), "The tank's turret is thrown clear on the guest", wrecks);
    check(wrecks.some(w => w.burning), 'The wrecks burn on the guest', wrecks);
    await sleep(3500);
    const tankWreck = wrecks.find(w => w.flung);
    const cover = await guest.evaluate(at => {
      const { ctx } = window.__op2; const V = ctx.player.position.constructor;
      ctx.physics.flushQueries?.();
      return ctx.physics.raycast(new V(at[0], 1.4, at[2] + 10), new V(0, 0, -1), 20, 1) !== null;
    }, tankWreck.at);
    check(cover, 'The wreck is cover on the guest: a round stops on it');
    await teleport(guest, [tankWreck.at[0] + 5, 0, tankWreck.at[2] + 14], 0);
    await lookAt(guest, [tankWreck.at[0], 1.5, tankWreck.at[2]]);
    await sleep(1200);
    await shot(guest, 'guest-wrecks');

    // --- The attack helicopter ------------------------------------------------------------------------------------------------------
    await host.evaluate(() => {
      const { ctx } = window.__op2; const V = ctx.player.position.constructor;
      window.__heli = ctx.enemies.vehicles.spawnChopper(new V(-60, 30, -110), [new V(-20, 0, -90), new V(20, 0, -90)], null);
    });
    await until(guest, () => window.__op2.ctx.coop.world.vehicles.chopper?.visible === true, null, 'The attack helicopter flies on the guest', 60000);
    await sleep(2500);
    const heli = { host: await host.evaluate(() => window.__heli.position.toArray()), guest: await guest.evaluate(() => window.__op2.ctx.coop.world.vehicles.chopper) };
    check(Math.hypot(heli.host[0] - heli.guest.at[0], heli.host[1] - heli.guest.at[1], heli.host[2] - heli.guest.at[2]) < 12 && heli.guest.tail, "It is where the host's is, tail and all", heli);
    await lookAt(guest, heli.guest.at);
    await shot(guest, 'guest-helicopter');
    // Its tail is shot off on the host: off on the guest, and it spins down into a wreck on both.
    await host.evaluate(() => { const v = window.__heli; const tail = v.parts.find(p => p.def.id === 'tail'); v.take(tail.pool + 1, tail, 'rocket', v.position.clone()); });
    await until(guest, () => window.__op2.ctx.coop.world.vehicles.chopper?.tail === false, null, "The helicopter's tail is gone on the guest", 60000);
    await until(host, () => window.__op2.ctx.enemies.vehicles.wrecks.length === 3, null, 'It comes down on the host', 120000);
    for (const g of guests) await until(g, () => { const n = window.__op2.ctx.coop.world.vehicles; return n.wrecks.size === 3 && !n.chopper; }, null, 'Its wreck lies on the guest and nothing is left flying', 60000);

    // --- A late joiner has the wrecks -----------------------------------------------------------------------------------------------
    hostWrecks = await host.evaluate(() => window.__op2.ctx.enemies.vehicles.wrecks.map(w => w.root.position.toArray().map(n => Math.round(n * 10) / 10)));
    if (players === 2) {
      const late = await lateJoin(party, 'LATE-JOIN');
      await inMatch([late], 'defense', false);
      await late.locator('.scr-loadout').waitFor({ state: 'visible', timeout: 60000 }).catch(() => {});
      if (await late.locator('.scr-loadout').isVisible().catch(() => false)) await late.getByRole('button', { name: 'Deploy', exact: true }).click();
      await late.evaluate(() => { window.__op2.ctx.player.modifiers.invulnerable = true; window.__op2.game.setState('playing'); });
      await until(late, () => window.__op2.ctx.coop.world.vehicles.wrecks.size === 3, null, 'The late joiner has all three wrecks', 90000);
      const theirs = (await copies(late)).wrecks;
      check(theirs.every(w => hostWrecks.some(h => Math.hypot(h[0] - w.at[0], h[2] - w.at[2]) < 1.5)), "The late joiner's wrecks lie where the host's do", theirs);
    }
    out.final = { host: await fleet(host), guest: await copies(guest) };
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
