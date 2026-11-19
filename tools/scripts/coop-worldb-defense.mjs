// Outpost Defense is one fort for the whole team (world-b, finding M1). A host and a guest (COOP_PLAYERS, default 2; 3 adds a second guest) play a
// whole wave cycle from a guest's seat: the wave on every screen, a wall worn by the host, by a guest's own explosion and
// breached, the same health and stage on every page; a guest walks through the breach it sees; a guest boards the wall up by
// hand (held E) and is paid; a guest hires a rifleman and buys a work crew at the Barracks with its own credits; a shop is
// lost and a guest rebuilds it in the break, with the next wave's line on its HUD; the attackers' sandbags and a jump pad
// are on the guests; lift gates rise for a guest; and a player who joins late gets the fort as it stands.
//   node tools/shot.mjs --port 5390 --dpr 2 --w 1440 --h 900 --wait 500 --timeout 600 --script tools/scripts/coop-worldb-defense.mjs --out tools/out/coop/world-b/defense.png
//   COOP_SIM=lag:120,jitter:40,loss:0.05 for the bad network, COOP_NET=rtc for real WebRTC, COOP_PLAYERS=2..4.
import { writeFileSync } from 'node:fs';
import { inMatch, kit, live, shootLoop, startParty, stopShooting, teleport } from './coop-kit.mjs';
import { lateJoin } from './coop-worldb-kit.mjs';

/** Turns the seated player's view a quarter of a radian, as a mouse would. */
const page_turn = page => page.evaluate(() => { const seat = window.__op2.ctx.progression.callInsManager.emplacements.all[0].seat; if (seat) seat.yaw += 0.25; else window.__op2.ctx.player.yaw += 0.25; });

/** Every piece that is not whole and shut, as [index, stage, health, gate up], and the fort's facts, as this page has them. */
const fort = page => page.evaluate(() => {
  const { ctx } = window.__op2;
  const walls = ctx.world.objects.walls, d = ctx.contracts.defense;
  return {
    pieces: walls.all.filter(p => p.stage !== 'intact' || p.health < p.maxHealth).map(p => [p.id, p.stage, Math.round(p.health)]),
    open: walls.all.filter(p => walls.isOpen(p)).map(p => p.id),
    credits: d.credits, shops: Object.fromEntries(Object.entries(d.shops).map(([id, s]) => [id, Math.round(s.health)])),
    squad: d.view().squad, mortars: d.mortars.count, mounts: d.view().mounts.map(m => m.level), preview: d.preview, inBreak: d.inBreak,
    guest: walls.link?.guest ?? null, allies: ctx.coop.hosting ? ctx.allies.allies.length : ctx.coop.world.allyBodies.size,
  };
});

/** A wall segment of the outer ring's north side, and the yard just inside it. */
const pickWall = (host, x) => host.evaluate(x => {
  const walls = window.__op2.ctx.world.objects.walls;
  let best = null;
  for (const p of walls.all) {
    if (p.kind !== 'wall' || p.spec.z > -40 || p.stage !== 'intact') continue;
    if (!best || Math.abs(p.spec.x - x) < Math.abs(best.spec.x - x)) best = p;
  }
  return { id: best.id, x: best.spec.x, z: best.spec.z, y: best.spec.y, max: best.maxHealth };
}, x);

export default async function (host, { sleep, outDir }) {
  const out = { errors: [], checks: [], screenshots: [] };
  const players = Number(process.env.COOP_PLAYERS ?? 2);
  const sim = process.env.COOP_SIM || undefined;
  const tag = `defense-${process.env.COOP_NET ?? 'loop'}-${players}p${sim ? '-badnet' : ''}`;
  const { check, progress, shot } = kit(outDir, tag, out, sleep);
  /** Waits until `read` (run on each page) gives the same answer on every page, and returns it. */
  const agree = async (pages, read, what, timeout = 60000) => {
    let last = [];
    for (const until = Date.now() + timeout; Date.now() < until;) {
      last = await Promise.all(pages.map(read));
      if (last.every(v => JSON.stringify(v) === JSON.stringify(last[0]))) return last[0];
      await sleep(100);
    }
    check(false, `${what}: every page agrees`, last);
  };
  const until = async (page, fn, arg, what, timeout = 150000) => {
    try { await page.waitForFunction(fn, arg, { timeout }); } catch {
      const repair = await party.guests[0].evaluate(() => { const { ctx } = window.__op2; const r = ctx.contracts.defense.repair; const p = r.piece;
        return { piece: p?.id ?? null, stage: p?.stage, health: p?.health, progress: r.progress, working: r.working, blocked: r.blocked, locked: r.locked, askIn: r.askIn,
          down: ctx.input.isDown('interact'), state: window.__op2.game.state, pos: ctx.player.position.toArray().map(n => Math.round(n * 10) / 10), prompted: ctx.contracts.defense.prompted?.id ?? null, gun: ctx.contracts.defense.gunNear() }; });
      check(false, what, { host: await fort(page), repair });
    }
    check(true, what);
  };
  const piecesOf = async page => (await fort(page)).pieces;
  let party;
  try {
    party = await startParty(host, { mode: 'defense', players, net: sim, out, progress, sleep });
    const states = await live(party, { enemies: 3 });
    const { guests, pages } = party, guest = guests[0], other = guests[1] ?? guests[0];
    check(states.every(s => s.wave === 1 && s.enemies > 0), 'Wave 1 is on every screen', states.map(s => [s.wave, s.enemies]));
    for (const g of guests) check((await fort(g)).guest === true, "A guest's walls answer to the host");
    check((await fort(host)).guest === false, "The host's walls are the fort");
    await agree(pages, async p => (await fort(p)).allies, 'The six free riflemen stand on every screen');
    check((await fort(guest)).allies === 6, 'A guest sees the garrison: six men', await fort(guest));

    // The wave's own men are sent home while the walls are checked, so nobody walks into the breach mid-step; the director is
    // let go again for the fight and the break below.
    await host.evaluate(() => {
      const { ctx } = window.__op2;
      ctx.waves.running = false;
      for (const e of [...ctx.enemies.alive]) ctx.enemies.withdraw(e);
      for (const v of [...(ctx.enemies.vehicles?.live ?? [])]) v.remove();
    });
    await sleep(1500);
    out.fieldAfterClear = await Promise.all(pages.map(p => p.evaluate(() => window.__op2.ctx.enemies.alive.map(e => [e.uid, e.id, e.alive, Math.round(e.position.x), Math.round(e.position.z)]))));
    await until(guest, () => window.__op2.ctx.enemies.alive.length === 0, null, 'The field is clear on the guest too');
    const radio = await guest.evaluate(() => { const r = window.__op2.ctx.contracts.radio; return { queued: r.air.queue.length, now: r.now }; });
    check(radio.queued === 0 && radio.now === 0, "A guest's own Defense radio stays quiet: the host's lines are the ones it hears", radio);

    // --- Damage: the host's, a guest's own explosion, and a breach --------------------------------------------------
    const wall = await pickWall(host, 14);
    progress(`wall ${wall.id} at ${wall.x.toFixed(1)}, ${wall.z.toFixed(1)}`);
    await host.evaluate(w => {
      const { ctx } = window.__op2; const V = ctx.player.position.constructor;
      ctx.world.objects.damageExplosivesInRadius(new V(w.x, 1.5, w.z - 0.6), 3, 120, 'rocket');
    }, wall);
    let now = await agree(pages, piecesOf, 'A wall the host wore down');
    const worn = now.find(p => p[0] === wall.id);
    check(worn && worn[1] === 'intact' && worn[2] < wall.max, 'The host\'s blast chipped the wall, and every page has its health', { worn, max: wall.max });

    // A guest's own rocket-sized blast at the same wall, through the game's own explosion code.
    await guest.evaluate(w => {
      const { ctx } = window.__op2; const V = ctx.player.position.constructor;
      ctx.combat.explode(new V(w.x, 1.5, w.z + 0.7), { radius: 4, damage: 150, kind: 'rocket', source: 'rocket', team: 'player' });
    }, wall);
    await until(host, ([id, hp]) => window.__op2.ctx.world.objects.walls.all[id].health < hp || window.__op2.ctx.world.objects.walls.all[id].stage !== 'intact', [wall.id, worn[2]], "A guest's explosion wears the host's wall");
    now = await agree(pages, piecesOf, "A wall a guest's explosion wore down");
    out.afterGuestBlast = now.find(p => p[0] === wall.id);

    // The breach: a charge's worth on the host, as a sapper's satchel does it.
    await host.evaluate(w => {
      const { ctx } = window.__op2; const V = ctx.player.position.constructor;
      ctx.world.objects.damageExplosivesInRadius(new V(w.x, 0.5, w.z - 0.5), 2, 4000, 'satchel');
    }, wall);
    now = await agree(pages, piecesOf, 'A breached wall');
    check(now.find(p => p[0] === wall.id)?.[1] === 'breached', 'The wall is breached on every screen', now.find(p => p[0] === wall.id));
    // What the guest sees is what stops it: nothing stands in the gap on its own physics.
    const through = await guest.evaluate(w => {
      const { ctx } = window.__op2; const V = ctx.player.position.constructor;
      ctx.physics.flushQueries?.();
      return ctx.physics.raycast(new V(w.x, 1.6, w.z + 4), new V(0, 0, -1), 8, 1) === null;
    }, wall);
    check(through, "The guest's own wall no longer blocks a shot through the breach");
    await teleport(guest, [wall.x - 2.5, wall.y, wall.z + 7], 0);
    await guest.evaluate(w => { const { ctx } = window.__op2; ctx.player.yaw = Math.atan2(-(w.x - ctx.player.position.x), -(w.z - ctx.player.position.z)); ctx.player.pitch = 0.1; }, wall);
    await sleep(3500);
    await shot(guest, 'guest-breach');

    // --- A guest boards it up by hand: two stages, paid each --------------------------------------------------------
    const before = await Promise.all(pages.map(fort));
    await teleport(guest, [wall.x, wall.y, wall.z + 1.9], 0);
    await sleep(300);
    const prompt = await guest.evaluate(() => { const r = window.__op2.ctx.contracts.defense.repair; return { piece: r.piece?.id ?? null }; });
    check(prompt.piece === wall.id, 'The guest gets the board-up prompt at the breach', prompt);
    await guest.evaluate(() => window.__op2.ctx.input.simulate('interact', true));
    await until(host, id => window.__op2.ctx.world.objects.walls.all[id].stage === 'damaged', wall.id, "Held E: the guest's first stage goes up on the host", 300000);
    await sleep(400);
    await shot(guest, 'guest-boarding');
    await until(host, id => window.__op2.ctx.world.objects.walls.all[id].stage === 'intact', wall.id, "Held E: the guest's second stage goes up on the host", 300000);
    await guest.evaluate(() => window.__op2.ctx.input.simulate('interact', false));
    now = await agree(pages, piecesOf, 'The wall a guest boarded up');
    check(!now.some(p => p[0] === wall.id && p[1] !== 'intact'), 'The wall stands again on every screen', now);
    const after = await Promise.all(pages.map(fort));
    check(after[1].credits - before[1].credits === 40, 'The guest was paid 20 a stage, 40 for the breach', [before[1].credits, after[1].credits]);
    check(after[0].credits === before[0].credits, 'The host was not paid for the guest\'s work', [before[0].credits, after[0].credits]);
    const blocked = await guest.evaluate(() => { window.__op2.ctx.physics.flushQueries?.(); return true; })
      && await guest.evaluate(w => { const { ctx } = window.__op2; const V = ctx.player.position.constructor; return ctx.physics.raycast(new V(w.x, 1.6, w.z + 4), new V(0, 0, -1), 8, 1) !== null; }, wall);
    check(blocked, "The guest's wall is solid again");

    // --- The Barracks, with the guest's own credits -----------------------------------------------------------------
    await pages.reduce((p, page) => p.then(() => page.evaluate(() => { window.__op2.ctx.contracts.defense.credits = 1500; })), Promise.resolve());
    const shopAt = await guest.evaluate(() => { const a = window.__op2.ctx.contracts.defense.anchors.barracks; return [a.position.x, a.position.y, a.position.z, a.yaw]; });
    await teleport(guest, shopAt.slice(0, 3), shopAt[3] + Math.PI);
    await sleep(500);
    const counter = await guest.evaluate(() => document.querySelector('.hud')?.textContent?.includes('BARRACKS') ?? false);
    check(counter, 'A guest at the Barracks counter gets its prompt');
    await guest.evaluate(() => window.__op2.ctx.input.simulate('interact', true)); await sleep(120);
    await guest.evaluate(() => window.__op2.ctx.input.simulate('interact', false));
    await guest.locator('.scr-shop:not(.scr-loadout)').waitFor({ state: 'visible', timeout: 8000 });
    check(true, 'E opens the Barracks for a guest');
    await sleep(300);
    await shot(guest, 'guest-barracks', true);
    const price = await guest.evaluate(() => window.__op2.ctx.contracts.defense.offers('barracks').find(o => o.act.kind === 'ally' && o.act.type === 'rifleman').price);
    const hire = await guest.evaluate(() => window.__op2.ctx.contracts.defense.buy('barracks', { kind: 'ally', type: 'rifleman' }));
    check(hire === null, 'The guest hires a rifleman', hire);
    await until(host, () => window.__op2.ctx.allies.allies.length === 7, null, "The host's garrison is seven");
    await until(guest, () => window.__op2.ctx.coop.world.allyBodies.size === 7 && window.__op2.ctx.contracts.defense.view().squad === 7, null, 'The guest sees seven men and its shop counts them');
    const hired = await Promise.all(pages.map(fort));
    check(hired[1].credits === 1500 - price && hired[0].credits === 1500, `The guest paid ${price} from its own credits, the host nothing`, [hired[0].credits, hired[1].credits]);
    await guest.evaluate(() => window.__op2.game.setState('playing'));

    // --- The fight: a guest's kills are the guest's pay ------------------------------------------------------------------
    // In the core, out of the garrison's sight: a man the riflemen on the walls kill pays nobody, and they shoot first.
    await teleport(guest, [0, 0, 8], 0);
    const targets = await host.evaluate(() => {
      const { ctx } = window.__op2; const V = ctx.player.position.constructor;
      // Whose each kill is, as the host's world announces it (`coop:kill`, raised before any system hears `enemy:killed`).
      window.__kills = [];
      ctx.events.on('coop:kill', k => { window.__kills.push({ by: k.by, id: k.id }); });
      const uids = [];
      for (let i = 0; i < 3; i++) {
        const p = new V(-2 + i * 2, 0, 0); ctx.world.nav.nearest?.(p, 4, p);
        const e = ctx.enemies.spawn('trooper', p);
        if (!e) continue;
        e.behaviours = []; e.attacks = []; e.mode = 'hold'; e.dummy = true;
        uids.push(e.uid);
      }
      return uids;
    });
    await until(guest, n => window.__op2.ctx.enemies.alive.length >= n, targets.length, 'Three attackers stand in front of the guest');
    const purse = await Promise.all(pages.map(fort));
    const killsBefore = await guest.evaluate(() => window.__op2.ctx.progression.kills);
    await shootLoop(guest, { range: 40, weapon: 'harrow' });
    await until(host, uids => !window.__op2.ctx.enemies.alive.some(e => uids.includes(e.uid)), targets, "The guest's rifle kills all three on the host", 300000);
    await stopShooting(guest);
    await until(guest, k => window.__op2.ctx.progression.kills >= k + 3, killsBefore, 'The three kills are the guest\'s own');
    const paid = await Promise.all(pages.map(fort));
    out.kills = await host.evaluate(() => window.__kills);
    check(out.kills.length === 3 && out.kills.every(k => k.by === 1), 'The host credits all three to the guest', out.kills);
    check(paid[1].credits - purse[1].credits >= 30, "The guest's three kills paid the guest 10 each (15 a head)", [purse.map(f => f.credits), paid.map(f => f.credits)]);
    check(paid[0].credits === purse[0].credits, "The host was not paid for the guest's kills", [purse.map(f => f.credits), paid.map(f => f.credits)]);

    // A work crew, bought by the other guest, mends a chipped wall on the host.
    const second = await pickWall(host, -14);
    await host.evaluate(w => { const { ctx } = window.__op2; const V = ctx.player.position.constructor; ctx.world.objects.damageExplosivesInRadius(new V(w.x, 1.5, w.z - 0.6), 1.5, 140, 'rocket'); }, second);
    await until(other, id => window.__op2.ctx.world.objects.walls.all[id].health < window.__op2.ctx.world.objects.walls.all[id].maxHealth, second.id, 'Another guest sees the second wall chipped');
    const crew = await other.evaluate(id => window.__op2.ctx.contracts.defense.buy('barracks', { kind: 'repair', index: id }), second.id);
    check(crew === null, 'A guest buys a work crew for it', crew);
    await until(host, id => window.__op2.ctx.world.objects.walls.all[id].repairing >= 0, second.id, "The host's crew starts on it");
    await until(guest, id => window.__op2.ctx.world.objects.walls.all[id].repairing >= 0, second.id, 'A guest sees it under repair');
    await until(host, id => { const p = window.__op2.ctx.world.objects.walls.all[id]; return p.repairing < 0 && p.health >= p.maxHealth; }, second.id, 'The crew finishes on the host', 300000);
    now = await agree(pages, piecesOf, 'The wall the crew mended');

    // A purchase the host must refuse comes back: a mortar team with every post manned.
    const posts = await host.evaluate(() => { const m = window.__op2.ctx.contracts.defense.mortars; while (!m.add()); return m.count; });
    await until(guest, n => window.__op2.ctx.contracts.defense.mortars.count === n, posts, `The host's ${posts} mortar teams stand on a guest`);
    const refused = await guest.evaluate(() => { const d = window.__op2.ctx.contracts.defense; const c = d.credits; d.link.buy(777, 'barracks', { kind: 'mortar' }); d.pending.set(777, { price: 600, label: 'Mortar team', at: window.__op2.ctx.time.elapsed }); d.credits -= 600; return c; });
    await until(guest, c => window.__op2.ctx.contracts.defense.credits === c, refused, 'A purchase the host refuses is refunded');

    // --- The attackers' works: sandbags and a jump pad -----------------------------------------------------------------
    const works = await host.evaluate(w => {
      const { ctx } = window.__op2; const V = ctx.player.position.constructor;
      const siege = ctx.waves.siege, walls = ctx.world.objects.walls;
      siege.buildCover(new V(w.x + 6, 0, w.z - 22));
      walls.setStage(walls.all[w.id], 1, true);
      siege.buildPad(walls.all[w.id]);
      return siege.wire();
    }, wall);
    check(works.covers.length === 1 && works.pads.length === 1, 'The host has a sandbag wall and a jump pad', works);
    for (const g of guests) await until(g, () => { const s = window.__op2.ctx.waves.siege; return s.covers.length === 1 && s.pads.length === 1; }, null, "A guest has the attackers' sandbags and jump pad");
    const cover = await guest.evaluate(c => { const { ctx } = window.__op2; const V = ctx.player.position.constructor; ctx.physics.flushQueries?.(); return ctx.physics.raycast(new V(c[0], 0.6, c[2] - 4), new V(0, 0, 1), 8, 1) !== null; }, works.covers[0]);
    check(cover, 'The sandbags stop a round on the guest');
    // A guest's blast knocks them down on the host (two hits), and so on every screen.
    for (let i = 0; i < 2; i++) {
      await guest.evaluate(c => { const { ctx } = window.__op2; const V = ctx.player.position.constructor; ctx.combat.explode(new V(c[0], 0.6, c[2]), { radius: 4, damage: 150, kind: 'rocket', source: 'rocket', team: 'player' }); }, works.covers[0]);
      await sleep(400);
    }
    await until(host, () => window.__op2.ctx.waves.siege.covers.length === 0, null, "A guest's two blasts knock the sandbags down on the host");
    for (const g of guests) await until(g, () => window.__op2.ctx.waves.siege.covers.length === 0, null, 'The sandbags are gone on a guest');

    // --- A lift gate rises for a guest ---------------------------------------------------------------------------------
    const gate = await host.evaluate(() => { const g = window.__op2.ctx.world.objects.walls.all.find(p => p.kind === 'gate' && p.spec.opens && p.spec.z < -40); return { id: g.id, x: g.spec.x, y: g.spec.y, z: g.spec.z }; });
    for (const page of pages) await teleport(page, [gate.x + 20, gate.y, gate.z + 20], 0);
    await until(host, id => !window.__op2.ctx.world.objects.walls.isOpen(window.__op2.ctx.world.objects.walls.all[id]), gate.id, 'The gate is down with nobody near');
    await teleport(other, [gate.x, gate.y, gate.z + 2.5], 0);
    for (const page of pages) await until(page, id => window.__op2.ctx.world.objects.walls.isOpen(window.__op2.ctx.world.objects.walls.all[id]), gate.id, 'The gate rises for a guest, on every screen');
    await teleport(other, [gate.x + 20, gate.y, gate.z + 20], 0);
    for (const page of pages) await until(page, id => !window.__op2.ctx.world.objects.walls.isOpen(window.__op2.ctx.world.objects.walls.all[id]), gate.id, 'It drops behind them, on every screen');

    // --- A mounted gun: one gunner on every screen ------------------------------------------------------------------------------
    const gunAt = await guest.evaluate(() => { const g = window.__op2.ctx.progression.callInsManager.emplacements.all[0]; return [g.standAt.x, g.standAt.y, g.standAt.z]; });
    await teleport(host, [gunAt[0] + 30, 0, gunAt[2] + 30], 0);
    await teleport(guest, gunAt, 0);
    await until(guest, () => (document.querySelector('.hud')?.textContent ?? '').includes('MAN GUN'), null, 'A guest at a mounted gun is offered it');
    await guest.evaluate(() => window.__op2.ctx.input.simulate('interact', true)); await sleep(120);
    await guest.evaluate(() => window.__op2.ctx.input.simulate('interact', false));
    await until(guest, () => window.__op2.ctx.progression.callInsManager.emplacements.all[0].occupant === 'player', null, 'The guest is on the gun');
    await until(host, () => { const g = window.__op2.ctx.progression.callInsManager.emplacements.all[0]; return g.occupant !== null && g.remote === true; }, null, "On the host the gun is taken, as somebody else's");
    const slot = await guest.evaluate(() => window.__op2.ctx.coop.lobby.me.slot);
    await until(host, slot => window.__op2.ctx.contracts.defense.state().guns[0][0] === slot, slot, "The fort's word names the guest as its gunner");
    // The host walks up to it: no prompt, the gun is manned.
    await teleport(host, gunAt, 0);
    await sleep(600);
    check(!(await host.evaluate(() => (document.querySelector('.hud')?.textContent ?? '').includes('MAN GUN'))), 'The host is not offered a gun a guest is on');
    await teleport(host, [gunAt[0] + 30, 0, gunAt[2] + 30], 0);
    // The guest swings it and fires: the host's copy follows and is seen firing.
    const before0 = await host.evaluate(() => window.__op2.ctx.progression.callInsManager.emplacements.all[0].aimYaw);
    await guest.evaluate(() => { window.__op2.game.setState('playing'); window.__op2.ctx.input.simulate('fire', true); });
    await page_turn(guest);
    await until(host, y => { const g = window.__op2.ctx.progression.callInsManager.emplacements.all[0]; return Math.abs(g.aimYaw - y) > 0.08 && g.shooting; }, before0, "The host sees the guest's gun swing and fire");
    await guest.evaluate(() => window.__op2.ctx.input.simulate('fire', false));
    await guest.evaluate(() => window.__op2.ctx.input.simulate('interact', true)); await sleep(120);
    await guest.evaluate(() => window.__op2.ctx.input.simulate('interact', false));
    await until(host, () => window.__op2.ctx.progression.callInsManager.emplacements.all[0].occupant === null, null, 'The guest steps off and the gun is free on the host');

    // --- A shop lost, the break, the preview, the rebuild ---------------------------------------------------------------
    await host.evaluate(() => window.__op2.ctx.contracts.defense.damageShop('armoury', 1e6));
    for (const g of guests) await until(g, () => window.__op2.ctx.contracts.defense.shops.armoury.lost, null, 'A guest sees the Armoury lost');
    check(await guest.evaluate(() => window.__op2.ctx.contracts.defense.offers('armoury').length === 1), 'A lost Armoury offers the guest only its rebuild');
    // The fight: the guests shoot what is left of the wave, and the host's director clears it.
    await host.evaluate(() => { const w = window.__op2.ctx.waves; w.running = true; w.queue.length = 0; w.cursor = 0; w.machines.length = 0; w.bosses.length = 0; w.choppers = w.bombers = 0; w.manager.queued = 0; for (const e of [...window.__op2.ctx.enemies.alive]) window.__op2.ctx.enemies.withdraw(e); for (const v of [...(window.__op2.ctx.enemies.vehicles?.live ?? [])]) v.remove(); });
    for (const page of pages) await until(page, () => window.__op2.ctx.contracts.defense.inBreak, null, 'The break is on every screen', 300000);
    const preview = await agree(pages, async p => (await fort(p)).preview, 'The next wave\'s line');
    check(typeof preview === 'string' && preview.length > 8 && !/placeholder/i.test(preview), "A guest's HUD has the host's line about the next wave", preview);
    // The HUD's panel is redrawn a moment after the state it reads: wait for it rather than read it in the same instant
    // (with four pages the line had just changed and the panel still showed the one before).
    await guest.waitForFunction(head => (document.querySelector('.df')?.textContent ?? '').includes(head), preview.slice(0, 12), { timeout: 8000, polling: 100 }).catch(() => {});
    const hud = await guest.evaluate(() => document.querySelector('.df')?.textContent ?? '');
    check(hud.includes(preview.slice(0, 12)), "It is on the guest's screen", { hud, preview });
    const rebuilt = await guest.evaluate(() => { const d = window.__op2.ctx.contracts.defense; d.credits = 3000; return d.buy('armoury', { kind: 'rebuild', shop: 'armoury' }); });
    check(rebuilt === null, 'A guest rebuilds the Armoury in the break', rebuilt);
    for (const page of pages) await until(page, () => !window.__op2.ctx.contracts.defense.shops.armoury.lost, null, 'The Armoury is back on every screen');
    await agree(pages, async p => (await fort(p)).shops, "The shops' health");

    // --- A late joiner gets the fort as it stands ----------------------------------------------------------------------
    if (players === 2) {
      await host.evaluate(w => { const { ctx } = window.__op2; const V = ctx.player.position.constructor; ctx.world.objects.damageExplosivesInRadius(new V(w.x, 0.5, w.z - 0.5), 2, 4000, 'satchel'); }, wall);
      const late = await lateJoin(party, 'LATE-JOIN');
      await inMatch([late], 'defense', false);
      await late.locator('.scr-loadout').waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});
      if (await late.locator('.scr-loadout').isVisible().catch(() => false)) await late.getByRole('button', { name: 'Deploy', exact: true }).click();
      await late.evaluate(() => { window.__op2.ctx.player.modifiers.invulnerable = true; window.__op2.game.setState('playing'); });
      const all = await agree([host, late], piecesOf, 'The late joiner\'s walls', 60000);
      check(all.some(p => p[0] === wall.id && p[1] === 'breached'), 'The late joiner has the breach', all);
      const facts = await agree([host, late], async p => { const f = await fort(p); return [f.squad, f.mortars, f.mounts, f.shops]; }, "The late joiner's fort facts", 60000);
      out.late = facts;
    }
    out.final = await Promise.all(party.pages.map(fort));
    await shot(host, 'host-end'); await shot(guest, 'guest-end');
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
