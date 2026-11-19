// Session fixes, proof 3: call-ins for players who arrive late, come back, or fall behind; the jammer; the skyhook
// (fix-session item 6; checklist C16). Endless Humans, a host and two guests, then a fourth player who joins late.
//
//   skyhook   the host cuffs a man, then a guest does: every page flies the drone to him and lifts its copy of him
//   jammer    the host's uplink goes down: a guest's call-ins are held as the host's are, and free again when it lifts
//   running   the host has a gunship up and a guest an AA sentry. A player who joins late has both on their screen at
//             once, the gunship where the host's is and as old; a screen that stood still for three seconds catches its
//             copy up; an enemy's missile at the gunship is flown on the watchers' screens
//   return    the guest with the sentry loses its line: its copy goes on the other screens with the seat, and is back,
//             as old as the caller's, when the same page returns and says again what it has up
//
//   FIX_ONLY=skyhook,jammer,running,return   COOP_SIM='lag:120,jitter:40,loss:0.05'   COOP_NET=rtc
//   node tools/shot.mjs --port 5510 --w 1280 --h 720 --wait 500 --timeout 1200 \
//     --script tools/scripts/coop-fixsession-callins.mjs --out tools/out/coop/fix-session/callins.png
import { inMatch, lateGuest, live, startParty, teleport } from './coop-kit.mjs';
import { SIM, immortal, proof, stall } from './coop-session-kit.mjs';

const ONLY = (process.env.FIX_ONLY ?? '').split(',').filter(Boolean);
const part = name => ONLY.length === 0 || ONLY.includes(name);

const waitFor = async (read, test, what, timeout, sleep) => {
  const end = Date.now() + timeout * (SIM ? 2 : 1);
  let last;
  for (;;) {
    last = await read().catch(error => ({ unread: String(error.message ?? error).slice(0, 120) }));
    let ok = false; try { ok = test(last); } catch { ok = false; }
    if (ok) return last;
    if (Date.now() > end) throw new Error(`Timed out waiting for: ${what} :: ${JSON.stringify(last)?.slice(0, 900)}`);
    await sleep(200);
  }
};

const slotOf = page => page.evaluate(() => window.__op2.ctx.coop.lobby.me.slot);
/** A page's own running call-ins and its copies of every other player's, with ages and places. */
const callins = page => page.evaluate(() => {
  const { ctx } = window.__op2;
  const link = ctx.progression.callinLink;
  const own = link.runningOrders().map((o, i) => ({ id: o.id, n: o.n, age: o.age, where: link.running[i]?.where?.toArray() ?? null }));
  const copies = {};
  for (let slot = 0; slot < 4; slot++) {
    const flown = link.mirror.copies(slot);
    copies[slot] = link.copyOrders(slot).map((o, i) => ({ id: o.id, n: o.n, age: o.age, where: flown[i]?.strike.where.toArray() ?? null }));
  }
  const hangars = link.mirror.hangars ?? [];
  return { own, copies, missiles: hangars.map(h => h?.missiles.length ?? 0), jammed: link.uplinkDown === true, stats: { ...link.mirror.stats } };
});
const dist = (a, b) => (a && b ? Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) : Infinity);
const spawnPoint = page => page.evaluate(() => window.__op2.ctx.world.playerSpawns[0].position.toArray());

export default async (host, { sleep, outDir }) => {
  const { out, run, check, progress, shot } = proof('coop-fixsession-callins', outDir, sleep);
  let party = null;
  return run(async () => {
    party = await startParty(host, { mode: 'outpost', players: 3, net: SIM, out, progress, sleep });
    const [a, b] = party.guests;
    await live(party);
    await immortal(party.pages);
    const base = await spawnPoint(host);
    const slots = { host: await slotOf(host), a: await slotOf(a), b: await slotOf(b) };
    // The wave stands still: nothing kills a kneeling man or a sentry while the proof looks.
    const hold = () => host.evaluate(() => { for (const e of window.__op2.ctx.enemies.alive) { e.behaviours = []; e.attacks = []; e.mode = 'hold'; } });
    await hold();

    if (part('skyhook')) {
      progress('skyhook: the host cuffs a man, then a guest does');
      const kneel = offset => host.evaluate(([at, offset]) => {
        const { ctx } = window.__op2; const V = ctx.player.position.constructor; const o = ctx.enemies.outpost;
        const p = new V(at[0] + offset, at[1], at[2] - 9); ctx.world.nav.nearest?.(p, 4, p);
        const e = ctx.enemies.spawn('trooper', p);
        const s = o.soldiers.find(x => x.e === e);
        o.collapse(s, 'surrender');
        return [e.uid, p.x, p.y, p.z];
      }, [base, offset]);
      const flown = page => page.evaluate(() => {
        const { ctx } = window.__op2;
        const hook = ctx.coop.world.skyhook;
        return { flying: hook.flying, drones: hook.drones.map(d => d.toArray()) };
      });
      for (const who of ['host', 'guest']) {
        const man = await kneel(who === 'host' ? -4 : 4);
        for (const page of party.guests) await page.waitForFunction(uid => window.__op2.ctx.enemies.alive.some(e => e.uid === uid), man[0], { timeout: 20000 });
        const y0 = await Promise.all(party.guests.map(page => page.evaluate(uid => window.__op2.ctx.enemies.alive.find(e => e.uid === uid)?.position.y ?? null, man[0])));
        if (who === 'host') {
          await host.evaluate(uid => { const o = window.__op2.ctx.enemies.outpost; o.captives.cuffFor(o.soldiers.find(x => x.e.uid === uid), null); }, man[0]);
        } else {
          // The guest stands by him and its key goes to the host, as the game sends it.
          await teleport(a, [man[1], man[2], man[3] + 1.6], 0);
          await sleep(SIM ? 1200 : 500);
          await a.evaluate(uid => { window.__op2.ctx.coop.world.w.send({ t: 'capture', uid }); }, man[0]);
        }
        await waitFor(() => host.evaluate(uid => window.__op2.ctx.enemies.outpost.soldiers.find(x => x.e.uid === uid)?.cuffed === true, man[0]), v => v === true, `the man cuffed on the host (${who})`, 15000, sleep);
        // Every guest flies the drone for him.
        for (const page of party.guests) {
          const f = await waitFor(() => flown(page), v => v.flying >= 1, `a drone on a guest's screen for the ${who}'s prisoner`, 90000, sleep);
          check(f.flying >= 1, `a guest flies the skyhook's drone for the ${who}'s prisoner`, f);
        }
        if (who === 'host') await shot(a, 'skyhook-inbound');
        // And lifts its own copy of the man as the hook takes him: he rises, then he is gone, on every screen.
        const lifted = await Promise.all(party.guests.map((page, i) => page.waitForFunction(([uid, y]) => {
          const e = window.__op2.ctx.enemies.alive.find(x => x.uid === uid);
          if (e && e.position.y > y + 2.5) window.__lifted = true;
          return window.__lifted === true && !e;
        }, [man[0], y0[i] ?? 0], { timeout: 180000, polling: 100 }).then(() => true, () => false)));
        check(lifted.every(Boolean), `every guest saw the ${who}'s prisoner lifted off the floor and carried away`, lifted);
        for (const page of party.guests) await page.evaluate(() => { window.__lifted = false; });
        await waitFor(() => host.evaluate(uid => !window.__op2.ctx.enemies.alive.some(e => e.uid === uid), man[0]), v => v === true, 'the man gone from the host too', 60000, sleep);
      }
    }

    if (part('jammer')) {
      progress('jammer: the host\'s uplink goes down');
      // The host's own truth is set (its count of radio men, through `callInDelay`), not just the flag: the Commander works the
      // flag out again from that on every look round, so a flag set by hand lasts a moment, which a clean link carries to a
      // guest's next poll and a slow one does not (on and off arrive together).
      const jam = on => host.evaluate(on => {
        const commander = window.__op2.ctx.enemies.outpost.commander;
        if (on) Object.defineProperty(commander, 'callInDelay', { configurable: true, get: () => 1 });
        else delete commander.callInDelay;
        commander.status('uplink', on);
      }, on);
      check(!(await callins(a)).jammed, 'before: a guest\'s uplink is clear', null);
      await jam(true);
      for (const page of party.guests) await waitFor(() => callins(page), c => c.jammed, 'the guest\'s uplink jammed by the host\'s word', 10000, sleep);
      check(true, 'the jammer holds every guest\'s call-ins, as it holds the host\'s');
      // A call made now is held, and says so, on the guest's own screen.
      const said = await a.evaluate(() => {
        const { ctx } = window.__op2; const lines = [];
        const feed = ctx.hud.feed.bind(ctx.hud); ctx.hud.feed = (text, ...rest) => { lines.push(String(text)); return feed(text, ...rest); };
        const link = ctx.progression.callinLink;
        link.mark.point.copy(ctx.player.position); link.hold('airstrike');
        ctx.hud.feed = feed;
        return { lines, calling: link.calling === true };
      });
      check(said.calling && said.lines.some(l => /HELD: UPLINK JAMMED/.test(l)), 'a guest\'s call under the jammer is held, and its screen says why', said);
      await jam(false);
      for (const page of party.guests) await waitFor(() => callins(page), c => !c.jammed, 'the guest\'s uplink clear again', 10000, sleep);
      const went = await waitFor(() => a.evaluate(() => window.__op2.ctx.progression.callinLink.calling === true), v => v === false, 'the held call going out once the jammer stops', 15000, sleep);
      check(went === false, 'the held call goes the moment the jammer stops', went);
      await sleep(9000);
    }

    let late = null;
    if (part('running') || part('return')) {
      progress('the host calls a gunship in and a guest an AA sentry');
      // The sentry stands for 60 s (`SENTRY.life`). Under the bad network the late joiner, the stall, the missile and the
      // 20 s a lost seat is kept took longer than that, and the sentry powered down on its own page before its caller came
      // back (the old build as well): the check then waited for a sentry that no longer existed. It stands ten minutes here.
      for (const page of [host, a, b]) await page.evaluate(async () => { (await import('/src/progression/data.ts')).SENTRY.life = 600; });
      const mark = [base[0], base[1], base[2] - 30];
      await host.evaluate(at => { const { ctx } = window.__op2, V = ctx.player.position.constructor; ctx.progression.callinLink.callAt('ac130', new V(...at), new V(1, 0, 0.35), true); }, mark);
      await a.evaluate(at => { const { ctx } = window.__op2, V = ctx.player.position.constructor; ctx.progression.callinLink.callAt('sentry', new V(at[0] + 6, at[1], at[2] + 18), new V(1, 0, 0), true); }, mark);
      await waitFor(() => callins(b), c => c.copies[slots.host].some(o => o.id === 'ac130') && c.copies[slots.a].some(o => o.id === 'sentry'), 'both call-ins on the other guest\'s screen', 20000, sleep);
      await sleep(7000);
    }

    if (part('running')) {
      progress('running: a fourth player joins while both are up');
      late = await lateGuest(party, 'GUEST-FOUR');
      // Through the deploy gate and into the world: only then is there a screen to look at.
      await inMatch([late], party.mode.contract);
      await immortal([late]);
      const seen = await waitFor(() => callins(late), c => c.copies[slots.host].some(o => o.id === 'ac130') && c.copies[slots.a].some(o => o.id === 'sentry'),
        'the late joiner having the gunship and the sentry on its screen', 30000, sleep);
      check(true, 'a player who joins late has every call-in already running on their screen', seen.copies);
      await sleep(1500);
      const [mine, theirs] = await Promise.all([callins(host), callins(late)]);
      const own = mine.own.find(o => o.id === 'ac130'), copy = theirs.copies[slots.host].find(o => o.id === 'ac130');
      out.lateJoin = { hostAge: own?.age, copyAge: copy?.age, apart: dist(own?.where, copy?.where) };
      check(own && copy && Math.abs(own.age - copy.age) < (SIM ? 2 : 1.2), 'the late joiner\'s gunship is as old as the host\'s, not newly called', out.lateJoin);
      check(dist(own?.where, copy?.where) < 60, 'and it is where the host\'s is on its circle', out.lateJoin);
      const sentry = theirs.copies[slots.a].find(o => o.id === 'sentry');
      check(sentry && sentry.age > 5, 'the other guest\'s sentry came with its age too', sentry);
      await shot(late, 'late-joiner');

      progress('running: a screen stands still for three seconds');
      await stall(b, 3000);
      await sleep(600);
      const [h2, b2] = await Promise.all([callins(host), callins(b)]);
      const hostNow = h2.own.find(o => o.id === 'ac130'), behind = b2.copies[slots.host].find(o => o.id === 'ac130');
      out.afterStall = { hostAge: hostNow?.age, copyAge: behind?.age, apart: dist(hostNow?.where, behind?.where) };
      check(hostNow && behind && Math.abs(hostNow.age - behind.age) < (SIM ? 1.5 : 0.8), 'the copy on the screen that stood still has caught up with its caller\'s clock', out.afterStall);

      progress('running: an enemy\'s missile at the host\'s gunship');
      const before = await Promise.all([a, b].map(callins));
      await host.evaluate(() => {
        const { ctx } = window.__op2; const link = ctx.progression.callinLink;
        // The gunship is the one strike of the host's that is high in the air.
        const ship = link.running.find(s => s.where && s.where.y > 40) ?? link.running[0];
        const from = ctx.player.position.clone(); from.y += 1;
        link.antiAir.fire(from, ship, 0.4);
      });
      for (const page of [a, b]) {
        const flew = await waitFor(() => callins(page), c => c.missiles[slots.host] >= 1, 'the missile on a watcher\'s screen', 20000, sleep);
        check(flew.missiles[slots.host] >= 1, 'a watcher sees the missile leave for the host\'s aircraft', flew.missiles);
      }
      await shot(a, 'missile');
      for (const page of [a, b]) await waitFor(() => callins(page), c => c.missiles[slots.host] === 0, 'the watcher\'s missile bursting', 40000, sleep);
      check(true, 'and it bursts on every watcher\'s screen when the caller\'s does');
      void before;
    }

    if (part('return')) {
      progress('return: the guest with the sentry loses its line');
      const had = await callins(host);
      check(had.copies[slots.a].some(o => o.id === 'sentry'), 'before the cut the host flies the guest\'s sentry', had.copies[slots.a]);
      await a.evaluate(() => { window.__op2.net.sim.cut(true); });
      const gone = await waitFor(() => callins(host), c => c.copies[slots.a].length === 0, 'the lost guest\'s copies leaving the host\'s screen', 45000, sleep);
      check(gone.copies[slots.a].length === 0, 'a lost player\'s call-in copies go with their seat, not a minute later', gone.copies[slots.a]);
      const goneB = await waitFor(() => callins(b), c => c.copies[slots.a].length === 0, 'and leaving the other guest\'s screen', 15000, sleep);
      check(goneB.copies[slots.a].length === 0, 'on the other guest\'s screen too', goneB.copies[slots.a]);
      const still = await callins(a);
      check(still.own.some(o => o.id === 'sentry'), 'the sentry is still running on its caller\'s own page', still.own);
      await a.evaluate(() => { window.__op2.net.sim.cut(false); });
      for (const page of [host, b]) {
        const back = await waitFor(() => callins(page), c => c.copies[slots.a].some(o => o.id === 'sentry'), 'the sentry back on the others\' screens once its caller returns', 45000, sleep);
        const mine = (await callins(a)).own.find(o => o.id === 'sentry');
        const copy = back.copies[slots.a].find(o => o.id === 'sentry');
        check(mine && copy && Math.abs(mine.age - copy.age) < (SIM ? 3 : 2), 'and as old as its caller\'s, not newly called', [mine?.age, copy?.age]);
      }
      await shot(host, 'returned');
    }
    if (late) await late.close().catch(() => {});
  }, () => party);
};
