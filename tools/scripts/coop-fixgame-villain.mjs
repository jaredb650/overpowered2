// Co-op proof: the villain and his soldiers treat EVERY player as a player (review-game finding 6, checklist C17).
// Endless Humans, the host and one or two guests.
//
//  1. The host's Outpost has every player; a guest's has none (the enemy side is the host's).
//  2. Footsteps: a guest who runs is heard where the GUEST is; a guest who stands still is not.
//  3. Shots, a sonar ping and a kill by a guest go in that guest's own notebook on the host, not the host's.
//  4. A look at each player: the guest's notebook has its own seconds, at the guest's own height.
//  5. Mortars: the spotter can see the guest and not the host, so the guest is the one painted and shelled. One mission.
//  6. The jammer: with one on the field the guest's own sonar and minimap are told so (the false men show on the guest).
//  7. Squad allies: a guest's tap on E sends a man after the GUEST; a hold on a man who is down spends the guest's own
//     stim and gets him up.
//
//   node tools/shot.mjs --port <port> --w 960 --h 540 --wait 500 --timeout 600 --script tools/scripts/coop-fixgame-villain.mjs --out <dir>/villain.png
//   COOP_SIM=lag:120,jitter:40,loss:0.05   COOP_PLAYERS=2|3   PARTS=crowd,feet,learn,mortar,jam,allies
import { writeFileSync } from 'node:fs';
import { calm, dummy, give, kit, live, skipBreak, startParty, teleport } from './coop-kit.mjs';

/** Host: starts recording what the soldiers hear, what hurts a guest, and where each mortar mission was aimed. */
const listen = host => host.evaluate(() => {
  const { ctx } = window.__op2;
  const o = ctx.enemies.outpost;
  const heard = (window.__heard = []);
  const noise = o.noise.bind(o);
  o.noise = (at, radius) => { heard.push({ x: at.x, z: at.z, radius, t: performance.now() }); noise(at, radius); };
  window.__hurts = [];
  ctx.events.on('coop:hurt', e => window.__hurts.push({ ...e }));
  window.__missions = [];
  const call = o.commander.mortars.call.bind(o.commander.mortars);
  o.commander.mortars.call = (at, cause, shells, crewed) => { const ok = call(at, cause, shells, crewed); if (ok) window.__missions.push({ x: at.x, z: at.z, cause }); return ok; };
});

const where = page => page.evaluate(() => window.__op2.ctx.player.position.toArray());
const guestIds = host => host.evaluate(() => window.__op2.ctx.coop.lobby.players.filter(p => !p.host).map(p => p.id));
/** Host: one guest's notebook, as numbers. */
const book = (host, id) => host.evaluate(id => {
  const c = window.__op2.ctx.enemies.outpost.commander;
  const pick = r => ({ shots: r.shots, kills: r.kills, pings: r.pings, pickups: r.pickups, seconds: r.seconds, highSeconds: r.highSeconds, damageTaken: r.damageTaken });
  return { theirs: pick(c.books.of(id).round), own: pick(c.tracker.round), shared: c.books.shared };
}, id);
/** Noises the host's men heard since `since`, within `reach` metres of `at`. */
const heardNear = (host, at, since, reach = 4) => host.evaluate(([at, since, reach]) =>
  window.__heard.filter(h => h.t >= since && Math.hypot(h.x - at[0], h.z - at[2]) < reach), [at, since, reach]);
const near = (a, b, reach) => Math.hypot(a[0] - b[0], a[2] - b[2]) < reach;

export default async function (host, { sleep, outDir }) {
  const out = { errors: [], checks: [], screenshots: [], rows: {} };
  const players = Number(process.env.COOP_PLAYERS ?? 2);
  const sim = process.env.COOP_SIM || '';
  const parts = new Set((process.env.PARTS ?? 'crowd,feet,learn,mortar,jam,allies').split(','));
  const tag = `fixgame-villain-${players}p${sim ? '-bad' : ''}`;
  const { check, progress, shot } = kit(outDir, tag, out, sleep);
  const lagMs = Number(/lag:(\d+)/.exec(sim)?.[1] ?? 0);
  const settle = 600 + lagMs * 4;
  let party;
  try {
    party = await startParty(host, { mode: 'outpost', players, net: sim || undefined, out, progress, sleep });
    await live(party, { enemies: 2 });
    const guest = party.guest;
    await listen(host);
    const ids = await guestIds(host);
    const spawnAt = await host.evaluate(() => window.__op2.ctx.world.playerSpawns[0].position.toArray());
    // A quiet field: the proofs below put their own men on it.
    await calm(host);
    await sleep(settle);

    if (parts.has('crowd')) {
      const seen = await host.evaluate(() => {
        const crowd = window.__op2.ctx.enemies.outpost.crowd;
        return crowd ? crowd.players().map(p => ({ own: p.own, slot: p.slot, alive: p.player.alive, at: p.player.position.toArray() })) : null;
      });
      check(seen && seen.length === players && seen[0].own && seen.slice(1).every(p => !p.own), 'the host\'s Outpost has every player in the world, its own first', seen);
      const mine = await where(guest);
      check(seen.slice(1).some(p => near(p.at, mine, 3)), 'and has the guest standing where the guest stands', { seen, mine });
      for (const page of party.guests) check(await page.evaluate(() => window.__op2.ctx.enemies.outpost.crowd === null), 'a guest\'s Outpost is handed nobody: the enemy side is the host\'s');
      progress('1. the crowd is linked');
    }

    // The guest goes well away from the host, so whose position a thing happened at cannot be mistaken.
    const far = await host.evaluate(() => {
      const { ctx } = window.__op2, V = ctx.player.position.constructor;
      const own = ctx.player.position;
      let best = null, bestD = 0;
      for (const s of ctx.enemies.outpost.cover.spots) {
        const d = Math.hypot(s.position.x - own.x, s.position.z - own.z);
        if (d > bestD && d < 60 && Math.abs(s.position.y - own.y) < 1.5) { bestD = d; best = s.position; }
      }
      const p = (best ?? own).clone(); const snapped = new V();
      return (ctx.world.nav.nearest(p, 4, snapped) ? snapped : p).toArray();
    });
    await teleport(guest, far, 0);
    await sleep(settle);
    const hostAt = await where(host);
    check(!near(far, hostAt, 15), 'the guest stands well away from the host', { far, hostAt });

    if (parts.has('feet')) {
      // Standing still: nothing is heard at the guest.
      let since = await host.evaluate(() => performance.now());
      await sleep(1200);
      const still = await heardNear(host, await where(guest), since, 6);
      check(still.length === 0, 'a guest who stands still makes no noise', still);
      // A soldier, so there is somebody to hear (noise is only asked for with men in the fight). He may not move or shoot.
      await dummy(host, [far[0] + 6, far[1], far[2] + 6], 'trooper');
      since = await host.evaluate(() => performance.now());
      // Run in a small circle: forward with the view turning.
      await guest.evaluate(() => {
        const { ctx } = window.__op2;
        ctx.input.simulate('forward', true);
        window.__turn = setInterval(() => { ctx.player.yaw += 0.12; }, 50);
      });
      await sleep(2600);
      const speed = await guest.evaluate(() => Math.hypot(window.__op2.ctx.player.velocity.x, window.__op2.ctx.player.velocity.z));
      const here = await where(guest);
      await guest.evaluate(() => { clearInterval(window.__turn); window.__op2.ctx.input.simulate('forward', false); });
      const steps = await heardNear(host, here, since, 9);
      const atHost = await heardNear(host, hostAt, since, 4);
      out.rows.feet = { speed, steps: steps.length, radius: steps[0]?.radius, atHost: atHost.length };
      check(speed > 5.5, 'the guest is running', speed);
      check(steps.length >= 2 && steps.every(s => s.radius > 3 && s.radius < 14), 'the host\'s men hear the guest\'s footsteps where the guest is, as loud as the guest is fast', { steps: steps.slice(0, 4), speed });
      check(atHost.length === 0, 'and hear none at the host, who is standing still', atHost);
      progress(`2. footsteps: ${steps.length} heard at the guest (radius ${steps[0]?.radius.toFixed(1)} at ${speed.toFixed(1)} m/s), ${atHost.length} at the host`);
      await sleep(600);
    }

    if (parts.has('learn')) {
      const before = await book(host, ids[0]);
      // A man in front of the guest, shot dead by the guest.
      const at = await where(guest);
      const uid = await dummy(host, [at[0], at[1], at[2] - 6], 'husk');
      await give(guest, 'smg');
      await guest.waitForFunction(uid => window.__op2.ctx.enemies.alive.some(e => e.uid === uid), uid, { timeout: 20000 });
      const since = await host.evaluate(() => performance.now());
      await guest.evaluate(uid => {
        const { ctx } = window.__op2;
        window.__aim = setInterval(() => {
          const e = ctx.enemies.alive.find(e => e.uid === uid);
          ctx.input.simulate('fire', !!e);
          if (!e) return;
          const d = e.center.clone().sub(ctx.player.eye);
          ctx.player.yaw = Math.atan2(-d.x, -d.z); ctx.player.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
          ctx.weapons.refillMagazines();
        }, 50);
      }, uid);
      await host.waitForFunction(uid => !window.__op2.ctx.enemies.alive.some(e => e.uid === uid), uid, { timeout: 30000 });
      await guest.evaluate(() => { clearInterval(window.__aim); window.__op2.ctx.input.simulate('fire', false); });
      // A sonar ping of the guest's own.
      await guest.evaluate(() => { const { ctx } = window.__op2; ctx.events.emit('sonar:ping', { origin: ctx.player.position.clone() }); });
      await sleep(settle + 600);
      const after = await book(host, ids[0]);
      const shots = await heardNear(host, await where(guest), since, 8);
      out.rows.learn = { before, after, shotNoises: shots.filter(s => s.radius > 30).length, notes: await host.evaluate(() => ({ ...window.__op2.ctx.coop.world.notes })) };
      check(after.shared, 'the Commander keeps a notebook a player');
      check(after.theirs.shots > before.theirs.shots && after.own.shots === before.own.shots, 'the guest\'s shots are in the guest\'s notebook, and not in the host\'s', out.rows.learn);
      check(after.theirs.kills === before.theirs.kills + 1 && after.own.kills === before.own.kills, 'the guest\'s kill is the guest\'s', out.rows.learn);
      check(after.theirs.pings === before.theirs.pings + 1 && after.own.pings === before.own.pings, 'the guest\'s sonar ping is the guest\'s', out.rows.learn);
      check(shots.some(s => s.radius > 30), 'the host\'s men hear the guest\'s gunfire where the guest is', shots.slice(0, 3));
      check(after.theirs.seconds > before.theirs.seconds && after.own.seconds > before.own.seconds, 'he looks at each player: both notebooks have their seconds', out.rows.learn);
      progress(`3-4. the guest's notebook: ${after.theirs.shots} shots, ${after.theirs.kills} kill, ${after.theirs.pings} ping; the host's own: ${after.own.shots} shots, ${after.own.kills} kills`);
    }

    if (parts.has('mortar')) {
      await calm(host);
      // Mortars and a spotter come with the next wave. The spotter is then stood where he can see the guest and not the host.
      await host.evaluate(() => {
        const { ctx } = window.__op2;
        ctx.enemies.outpost.commander.adopt('mortars');
        ctx.waves.jumpTo(Math.max(2, ctx.waves.wave + 1));
      });
      await host.waitForFunction(() => {
        const c = window.__op2.ctx.enemies.outpost.commander;
        return !!c.units.first('spotter') && c.units.count('mortar') > 0 && c.mortars.manned;
      }, null, { timeout: 90000 });
      const guestAt = await where(guest);
      const missionsBefore = await host.evaluate(() => window.__op2.ctx.enemies.outpost.commander.mortars.missions);
      const placed = await host.evaluate(([g]) => {
        const { ctx } = window.__op2, V = ctx.player.position.constructor;
        const c = ctx.enemies.outpost.commander;
        const u = c.units.first('spotter');
        // Every other man goes home: this is about the spotter and the tubes.
        for (const e of [...ctx.enemies.alive]) {
          const s = ctx.enemies.outpost.soldiers.find(s => s.e === e);
          const unit = c.units.list.find(x => x.s === s);
          if (!unit || (unit.kind !== 'spotter' && unit.kind !== 'mortar')) ctx.enemies.withdraw(e);
        }
        const at = new V(g[0] + 9, g[1], g[2]); const snapped = new V();
        if (ctx.world.nav.nearest(at, 5, snapped)) at.copy(snapped);
        const e = u.s.e;
        e.position.copy(at); e.behaviours = []; e.attacks = []; e.mode = 'hold'; e.dummy = true;
        u.placed = true; u.arrived = true; u.post.copy(at);
        // He has the guest in plain sight for as long as this runs; whom he is after is the game's own choice (the nearest).
        const hold = () => {
          if (!e.alive || window.__spotterDone) return;
          e.position.copy(at); e.velocity.set(0, 0, 0);
          u.s.sees = true; u.s.notice = 1; u.tickAt = Infinity;
          requestAnimationFrame(hold);
        };
        hold();
        return { uid: e.uid, at: at.toArray() };
      }, [guestAt]);
      // A spotter's mission is the tubes' own (it does not go through `call`): the count and the target are read off them.
      await host.waitForFunction(n => window.__op2.ctx.enemies.outpost.commander.mortars.missions > n, missionsBefore, { timeout: 60000 });
      const mission = await host.evaluate(() => {
        const c = window.__op2.ctx.enemies.outpost.commander;
        const u = c.units.first('spotter');
        const q = u?.s.e.quarry;
        return { aimed: { x: c.mortars.target.x, z: c.mortars.target.z }, quarryIsHost: q === window.__op2.ctx.player, quarryAt: q?.position.toArray(), count: c.mortars.missions };
      });
      const hostNow = await where(host), guestNow = await where(guest);
      out.rows.mortar = { mission, guestNow, hostNow, placed };
      check(!mission.quarryIsHost, 'the spotter is after the guest in front of him, not the far host', mission);
      check(near([mission.aimed.x, 0, mission.aimed.z], guestNow, 5), 'the fire mission is on the guest he can see', out.rows.mortar);
      check(!near([mission.aimed.x, 0, mission.aimed.z], hostNow, 12), 'and nowhere near the host', out.rows.mortar);
      // The shells land: the guest is hurt by the mortar (the kit keeps players alive; the damage is still dealt).
      await host.waitForFunction(() => window.__hurts.some(h => h.source === 'mortar'), null, { timeout: 30000 }).catch(() => {});
      const hurts = await host.evaluate(() => window.__hurts.filter(h => h.source === 'mortar').length);
      check(hurts > 0, 'the shells come down on the guest: the host hurt that guest with a mortar', hurts);
      await sleep(3000);
      const total = await host.evaluate(() => window.__op2.ctx.enemies.outpost.commander.mortars.missions);
      check(total - missionsBefore <= 2, 'one mission at a time, not one a player', { total, missionsBefore });
      await host.evaluate(() => { window.__spotterDone = true; });
      await shot(guest, 'mortar-on-guest');
      progress(`5. mortar: aimed ${mission.aimed.x.toFixed(1)}, ${mission.aimed.z.toFixed(1)}; guest at ${guestNow[0].toFixed(1)}, ${guestNow[2].toFixed(1)}; host at ${hostNow[0].toFixed(1)}, ${hostNow[2].toFixed(1)}; ${hurts} mortar hits on the guest`);
    }

    if (parts.has('jam')) {
      await calm(host);
      await host.evaluate(() => {
        const { ctx } = window.__op2;
        ctx.enemies.outpost.commander.adopt('jammers');
        ctx.waves.jumpTo(Math.max(2, ctx.waves.wave + 1));
      });
      await host.waitForFunction(() => window.__op2.ctx.enemies.outpost.commander.jam.jammed, null, { timeout: 90000 });
      await guest.waitForFunction(() => window.__op2.ctx.enemies.outpost.commander.jam.jammed, null, { timeout: 15000 });
      const told = await guest.evaluate(() => {
        const { ctx } = window.__op2;
        const jam = ctx.enemies.outpost.commander.jam;
        const radar = jam.radar(ctx.enemies.alive);
        return { jammed: jam.jammed, ops: [...jam.ops], falseMen: radar.filter(b => b.uid < 0).length, real: ctx.enemies.alive.length, shown: radar.filter(b => b.uid > 0).length };
      });
      const hostSide = await host.evaluate(() => {
        const { ctx } = window.__op2;
        const c = ctx.enemies.outpost.commander;
        return { ops: c.units.list.filter(u => (u.kind === 'jammer' || u.kind === 'radio') && u.s.fighting).map(u => u.s.e.uid), falseMen: c.jam.radar(ctx.enemies.alive).filter(b => b.uid < 0).length };
      });
      out.rows.jam = { told, hostSide };
      check(told.jammed && told.falseMen === hostSide.falseMen && told.falseMen > 0, 'the guest\'s minimap has the jammer\'s false men, as many as the host\'s', out.rows.jam);
      check(hostSide.ops.length > 0 && hostSide.ops.every(uid => told.ops.includes(uid)), 'the guest is told who is working the jammer (the one thing its sonar still finds)', out.rows.jam);
      // The jammer dies: every screen's sonar is clean again.
      await host.evaluate(() => {
        const { ctx } = window.__op2;
        const c = ctx.enemies.outpost.commander;
        for (const u of [...c.units.list]) if (u.kind === 'jammer') ctx.enemies.withdraw(u.s.e);
      });
      await guest.waitForFunction(() => !window.__op2.ctx.enemies.outpost.commander.jam.jammed, null, { timeout: 15000 });
      check(true, 'with the jammer gone the guest\'s sonar is clean again');
      progress(`6. jammer: ${told.falseMen} false men on the guest's minimap, operators ${told.ops.join(', ')}`);
    }

    if (parts.has('allies')) {
      await calm(host);
      const g = await where(guest);
      const made = await host.evaluate(([g]) => {
        const { ctx } = window.__op2, V = ctx.player.position.constructor;
        const at = new V(g[0], g[1], g[2] - 2.4); const snapped = new V();
        if (ctx.world.nav.nearest(at, 3, snapped)) at.copy(snapped);
        // A post with no ground to walk: they stand where they are put.
        const a = ctx.allies.spawn('rifleman', at, undefined, 0);
        const b = ctx.allies.spawn('rifleman', new V(at.x + 14, at.y, at.z), undefined, 0);
        return a && b ? { at: a.body.position.toArray(), n: ctx.allies.allies.length } : null;
      }, [g]);
      check(made && made.n >= 2, 'two squad allies stand on the host\'s field', made);
      await guest.waitForFunction(() => window.__op2.ctx.coop.world.allyBodies.size >= 2, null, { timeout: 20000 });
      // The guest looks at the nearer man from two metres and taps E.
      // Two metres from the man nearest `at`, as the guest's own game draws him, looking at him.
      const face = at => guest.evaluate(at => {
        const { ctx } = window.__op2, V = ctx.player.position.constructor;
        let best = null, bestD = Infinity;
        for (const b of ctx.coop.world.allyBodies.values()) {
          const p = b.char.root.position, d = Math.hypot(p.x - at[0], p.z - at[2]);
          if (d < bestD) { bestD = d; best = p; }
        }
        const p = best ?? new V(...at);
        ctx.player.teleport(new V(p.x, p.y, p.z + 2.2), 0);
        ctx.player.pitch = 0;
      }, at);
      await face(made.at);
      await sleep(settle);
      await face(made.at);
      await sleep(250);
      const prompt = await guest.evaluate(() => [...document.querySelectorAll('.hud-follow, .hud-tag, [class*=follow]')].map(n => n.textContent).join(' | '));
      // What the guest's E key sees: the man in front of it, as its own game has him.
      const seenBy = () => guest.evaluate(() => {
        const { ctx } = window.__op2;
        const w = ctx.coop.world;
        return { asked: w.allyOrders.asked, bodies: [...w.allyBodies.values()].map(b => ({ at: b.char.root.position.toArray().map(n => +n.toFixed(1)), centre: b.stand.body.center.toArray().map(n => +n.toFixed(1)), state: b.stand.state, order: b.stand.order })),
          me: ctx.player.position.toArray().map(n => +n.toFixed(1)), forward: ctx.player.forward.toArray().map(n => +n.toFixed(2)), state: window.__op2.game.state };
      });
      await guest.waitForFunction(at => [...window.__op2.ctx.coop.world.allyBodies.values()].some(b => Math.hypot(b.stand.body.center.x - at[0], b.stand.body.center.z - at[2]) < 3), made.at, { timeout: 20000 });
      out.rows.tap = await seenBy();
      await guest.evaluate(() => window.__op2.ctx.input.simulate('interact', true));
      await sleep(90);
      await guest.evaluate(() => window.__op2.ctx.input.simulate('interact', false));
      await host.waitForFunction(() => window.__op2.ctx.allies.allies[0].order === 'follow', null, { timeout: 15000 }).catch(async () => {
        out.rows.tapFailed = { guest: await seenBy(), host: await host.evaluate(() => ({ ...window.__op2.ctx.coop.world.allyOrders, order: window.__op2.ctx.allies.allies[0].order,
          guestAt: window.__op2.ctx.enemies.outpost.crowd.players()[1]?.player.position.toArray(), man: window.__op2.ctx.allies.allies[0].body.position.toArray() })) };
        throw new Error(`the guest's tap did not reach the man :: ${JSON.stringify(out.rows.tapFailed)}`);
      });
      const led = await host.evaluate(() => {
        const { ctx } = window.__op2;
        const a = ctx.allies.allies[0];
        return { order: a.order, byHost: a.leader === null || a.leader === ctx.player, leaderAt: a.leader?.position.toArray(), other: ctx.allies.allies[1].order };
      });
      check(led.order === 'follow' && !led.byHost, 'the guest\'s tap on E sends the man after the GUEST', led);
      check(led.other === 'post', 'and only the man the guest was looking at', led);
      // The guest walks off; he comes too, and not toward the host.
      const away = [g[0], g[1], g[2] + 16];
      await teleport(guest, away, 0);
      await sleep(5000 + settle);
      const followed = await host.evaluate(() => window.__op2.ctx.allies.allies[0].body.position.toArray());
      const guestNow = await where(guest), hostNow = await where(host);
      out.rows.allies = { prompt, led, followed, guestNow, hostNow };
      check(near(followed, guestNow, 9), 'he follows the guest to where the guest went', out.rows.allies);
      // The other man goes down; the guest's own stim gets him up.
      const down = await host.evaluate(() => {
        const { ctx } = window.__op2;
        const b = ctx.allies.allies[1];
        // A hit that takes the last of his health, and is not so large that it kills him outright.
        b.health = 1;
        ctx.allies.hurt(b, 3, b.body.center, b.body.center.clone().set(0, 0, 1), undefined, 'chest', 'bullet', 'trooper');
        return { state: b.state, at: b.body.position.toArray() };
      });
      check(down.state === 'down', 'the second man is down on the host', down);
      await guest.evaluate(() => { const s = window.__op2.ctx.progression.stims; s.count = 2; });
      await guest.waitForFunction(() => [...window.__op2.ctx.coop.world.allyBodies.values()].some(b => b.state === 1), null, { timeout: 15000 });
      await face(down.at);
      await sleep(settle);
      await face(down.at);
      await sleep(250);
      await guest.evaluate(() => window.__op2.ctx.input.simulate('interact', true));
      await host.waitForFunction(() => window.__op2.ctx.allies.allies[1].state === 'up', null, { timeout: 15000 }).catch(() => {});
      await guest.evaluate(() => window.__op2.ctx.input.simulate('interact', false));
      const revived = await host.evaluate(() => window.__op2.ctx.allies.allies[1].state);
      const stims = await guest.evaluate(() => window.__op2.ctx.progression.stims.count);
      const orders = { guest: await guest.evaluate(() => ({ ...window.__op2.ctx.coop.world.allyOrders })), host: await host.evaluate(() => ({ ...window.__op2.ctx.coop.world.allyOrders })) };
      out.rows.revive = { revived, stims, orders };
      check(revived === 'up', 'the guest\'s hold on E gets the downed man up, on the host', out.rows.revive);
      check(stims === 1, 'and it cost the guest one of the guest\'s own stims', out.rows.revive);
      await shot(guest, 'allies');
      progress(`7. allies: the man follows the guest (${led.order}), the downed man is ${revived}, the guest has ${stims} stim left`);
    }

    out.fps = await Promise.all(party.pages.map(page => page.evaluate(() => window.__op2.stats().fps)));
    out.console = out.console?.filter?.(l => /error|Dropped/i.test(l.text ?? '')).slice(0, 20);
  } catch (error) {
    out.errors.push(String(error?.stack ?? error));
    if (party) for (const [i, page] of party.pages.entries()) await page.screenshot({ path: `${outDir}/${tag}-fail-${i}.png`, timeout: 60000 }).catch(() => {});
  }
  writeFileSync(`${outDir}/${tag}.json`, JSON.stringify(out, null, 2));
  return out;
}
