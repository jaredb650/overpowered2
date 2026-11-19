// Co-op proof: every player is in the same danger, and a guest's own moves count. Three players by default: the host stands
// far off, guest A is the one the enemy goes for, guest B stands beside A.
//
//  slam     a Juggernaut's ground slam hurts and throws BOTH guests in the ring (before: only its target, never thrown)
//  jump     A jumps the next slam and takes nothing; B, on the ground, takes it
//  dodge    A steps out of a Husk's swing at the last moment: the host spares them (a few tries; it is a timing window)
//  ghost    A's Ghost power-up is known to the host, and comes off again
//  rocket   A shoots an enemy rocket out of the air: the host's real one blows up early and the copy goes
//  watcher  B, who is not the target, sees and hears the attacks on A (laser, flash, bodies)
//
//   node tools/shot.mjs --port <port> --w 1280 --h 720 --wait 500 --timeout 600 --script tools/scripts/coop-attacks-hazards.mjs --out <dir>/hazards.png
//   COOP_PLAYERS=3|2   COOP_SIM=lag:120,jitter:40,loss:0.05   PARTS=slam,jump,dodge,ghost,rocket,watcher
import { writeFileSync } from 'node:fs';
import { ahead, calm, kit, live, startParty } from './coop-kit.mjs';
import { put, readRecord, record, stage, unstage } from './coop-attacks-kit.mjs';

const has = (events, k, test = () => true) => events.some(e => e.k === k && test(e));

export default async function (host, { sleep, outDir }) {
  const out = { errors: [], checks: [], screenshots: [] };
  const players = Number(process.env.COOP_PLAYERS ?? 3);
  const sim = process.env.COOP_SIM || '';
  const parts = new Set((process.env.PARTS ?? 'slam,jump,dodge,ghost,rocket,watcher').split(','));
  const tag = `attacks-hazards-${players}p${sim ? '-bad' : ''}`;
  const { check, progress, shot } = kit(outDir, tag, out, sleep);
  const lagMs = Number(/lag:(\d+)/.exec(sim)?.[1] ?? 0);
  let party;
  try {
    party = await startParty(host, { mode: 'crucible', players, net: sim || undefined, out, progress, sleep });
    await live(party, { enemies: 1 });
    await calm(host);
    const a = party.guests[0], b = party.guests[1] ?? null;
    for (const page of party.pages) await page.evaluate(record);
    const spot = await ahead(host, 0);
    const side = [spot.at[0] + Math.cos(spot.yaw) * 3, spot.at[1], spot.at[2] - Math.sin(spot.yaw) * 3];
    const place = async () => {
      await put(a, spot.at, spot.yaw);
      if (b) await put(b, side, spot.yaw);
      await put(host, (await ahead(host, -22)).at, spot.yaw);
      await sleep(400);
    };
    const until = async (page, since, test, ms) => {
      let r;
      for (let waited = 0; waited < ms; waited += 100) { await sleep(100); r = await readRecord(page, since); if (test(r)) break; }
      return r;
    };
    out.fps = await Promise.all(party.pages.map(page => page.evaluate(() => window.__op2.stats().fps)));

    if (parts.has('slam')) {
      await calm(host); await place();
      const since = Date.now();
      const uid = await stage(host, 'juggernaut', (await ahead(host, 6)).at, 'slam');
      const ra = await until(a, since, r => has(r.ev, 'hurt', e => e.type === 'crush'), 6000 + lagMs * 4);
      await sleep(500 + lagMs * 2);
      const rb = b ? await readRecord(b, since) : null;
      await unstage(host, uid);
      out.slam = { a: { hurt: ra.ev.find(e => e.k === 'hurt' && e.type === 'crush')?.amount ?? null, thrown: ra.ev.find(e => e.k === 'shove')?.v ?? null, ring: has(ra.ev, 'zone'), shock: ra.seen.warnings.shocks },
        b: rb && { hurt: rb.ev.find(e => e.k === 'hurt' && e.type === 'crush')?.amount ?? null, thrown: rb.ev.find(e => e.k === 'shove')?.v ?? null, ring: has(rb.ev, 'zone'), shock: rb.seen.warnings.shocks } };
      progress(`slam: ${JSON.stringify(out.slam)}`);
      check(out.slam.a.hurt > 0 && out.slam.a.thrown && out.slam.a.thrown[1] > 5, 'The slam hurts its target, a guest, and throws them into the air', out.slam.a);
      check(out.slam.a.ring && out.slam.a.shock > 0, 'The guest saw the warning ring and the shock', out.slam.a);
      if (b) check(out.slam.b.hurt > 0 && out.slam.b.thrown && out.slam.b.ring, 'The other guest in the ring, who was not the target, is hurt and thrown too, and saw the ring', out.slam.b);
    }

    if (parts.has('jump')) {
      await calm(host); await place();
      const since = Date.now();
      const uid = await stage(host, 'juggernaut', (await ahead(host, 6)).at, 'slam');
      // A jumps as the ring fills: the slam's wind-up is 1 s, a jump is in the air for longer than the rest of it.
      // Timed in the guest's own page, as a player's thumb is: 600 ms after it sees the wind-up start.
      await a.evaluate(uid => {
        const { ctx } = window.__op2;
        window.__jump = { at: 0, air: [] };
        const tick = () => {
          const begin = ctx.coop.world.attacks.log.find(e => e.uid === uid && e.p === 'begin');
          if (begin && !window.__jump.at && Date.now() >= begin.at + 600) {
            window.__jump.at = Date.now(); window.__jump.after = Date.now() - begin.at;
            ctx.input.simulate('jump', true); setTimeout(() => ctx.input.simulate('jump', false), 150);
          }
          if (window.__jump.at && Date.now() - window.__jump.at < 900) window.__jump.air.push(ctx.player.grounded ? 0 : 1);
          if (!window.__jump.at || Date.now() - window.__jump.at < 900) requestAnimationFrame(tick);
        };
        tick();
      }, uid);
      const ra = await until(a, since, r => r.log.some(e => e.uid === uid && e.p === 'fire'), 8000);
      await sleep(700 + lagMs * 2);
      const final = await readRecord(a, since);
      const rb = b ? await readRecord(b, since) : null;
      await unstage(host, uid);
      out.jump = { slammed: ra.log.some(e => e.uid === uid && e.p === 'fire'), aHurt: final.ev.filter(e => e.k === 'hurt' && e.type === 'crush').length,
        jump: await a.evaluate(() => ({ pressedAfterMs: window.__jump.after, framesInAir: window.__jump.air.reduce((n, x) => n + x, 0), frames: window.__jump.air.length })), bHurt: rb ? rb.ev.filter(e => e.k === 'hurt' && e.type === 'crush').length : null };
      progress(`jump: ${JSON.stringify(out.jump)}`);
      check(out.jump.slammed && out.jump.aHurt === 0, 'A guest who jumps the slam takes nothing', out.jump);
      if (b) check(out.jump.bHurt > 0, 'The guest who stayed on the ground took it', out.jump);
    }

    if (parts.has('dodge')) {
      const tries = [];
      const before = await host.evaluate(() => window.__op2.ctx.coop.world.dodges);
      // The claw's wind-up is 0.5 s. A steps 6 m back just before it lands, timed in its own page: the host still draws A in
      // reach (it draws a friend 100 ms behind their poses) while A's newest pose is already clear.
      const back = (await ahead(host, -6)).at;
      for (const after of [430, 400, 450, 380, 470, 420]) {
        await calm(host); await place();
        const since = Date.now();
        const uid = await stage(host, 'husk', (await ahead(host, 1.5)).at, 'claw');
        await a.evaluate(([uid, after, back]) => {
          const { ctx } = window.__op2;
          const tick = () => {
            const begin = ctx.coop.world.attacks.log.find(e => e.uid === uid && e.p === 'begin');
            if (begin && Date.now() >= begin.at + after) { ctx.player.teleport(new ctx.player.position.constructor(...back)); return; }
            requestAnimationFrame(tick);
          };
          tick();
        }, [uid, after, back]);
        await until(a, since, r => r.log.some(e => e.uid === uid && e.p === 'fire'), 6000);
        await sleep(500 + lagMs * 2);
        const r = await readRecord(a, since);
        await unstage(host, uid);
        tries.push({ after, hurt: r.ev.filter(e => e.k === 'hurt' && e.type === 'melee').length, dodges: await host.evaluate(() => window.__op2.ctx.coop.world.dodges) - before,
          fps: Math.min(...await Promise.all(party.pages.map(page => page.evaluate(() => window.__op2.stats().fps)))) });
      }
      out.dodge = { tries, spared: tries.at(-1).dodges };
      progress(`dodge: ${JSON.stringify(out.dodge)}`);
      // On a slow link the newest pose is as stale as the body: the rule then rightly spares nobody, and that is recorded.
      out.dodge.unhurt = tries.filter(t => t.hurt === 0).length;
      // A starved page sends its poses too slowly for any last-moment step to be seen: such a run is recorded and not judged.
      out.dodge.judged = !sim && tries.every(t => t.fps >= 45);
      if (out.dodge.judged) check(out.dodge.spared >= 1 && out.dodge.unhurt >= 1, 'A guest who got clear on their own screen at the last moment was spared by the host at least once in six', out.dodge);
    }

    if (parts.has('ghost')) {
      await calm(host); await place();
      const ghosts = () => host.evaluate(() => window.__op2.ctx.coop.world.targeting.ghosts.size);
      const before = await ghosts();
      await a.evaluate(() => window.__op2.ctx.progression.grant('ghost'));
      let on = before;
      for (let waited = 0; waited < 6000 && on === before; waited += 150) { await sleep(150); on = await ghosts(); }
      const active = await a.evaluate(() => window.__op2.ctx.progression.isActive('ghost'));
      // The host's enemies sense it: a husk picked for A reads `ghost`.
      const uid = await stage(host, 'husk', (await ahead(host, 8)).at, 'claw');
      await sleep(500);
      const sensed = await host.evaluate(uid => {
        const { ctx } = window.__op2; const e = ctx.enemies.alive.find(e => e.uid === uid);
        const sense = new ctx.enemies.aiWorld.player.constructor();
        ctx.coop.world.select(e, sense); ctx.coop.world.targetPlayer = null;
        return sense.ghost;
      }, uid);
      await unstage(host, uid);
      out.ghost = { before, on, active, sensed };
      progress(`ghost: ${JSON.stringify(out.ghost)}`);
      check(active && on === before + 1 && sensed === true, 'The host knows a guest holds Ghost, and its enemies sense them as hidden', out.ghost);
    }

    if (parts.has('rocket')) {
      await calm(host); await place();
      const since = Date.now();
      const uid = await stage(host, 'rocketeer', (await ahead(host, 34)).at, 'rocket');
      // A fires at the copy of the rocket for as long as there is one.
      await a.evaluate(() => {
        const { ctx } = window.__op2;
        window.__shotDown = 0;
        const tick = () => {
          if (window.__stopShooting) return;
          const copy = (ctx.combat.projectiles?.active ?? []).find(p => p.cosmetic && p.kind === 'rocket');
          if (copy) {
            const dir = copy.position.clone().sub(ctx.player.eye).normalize();
            ctx.combat.fireRay(ctx.player.eye, dir, { damage: 10, source: 'smg', team: 'player' });
            if (!copy.live) window.__shotDown++;
          }
          requestAnimationFrame(tick);
        };
        tick();
      });
      const ra = await until(a, since, r => has(r.ev, 'projGone'), 9000 + lagMs * 4);
      await sleep(500 + lagMs * 2);
      const rh = await readRecord(host, since);
      const downs = await a.evaluate(() => { window.__stopShooting = true; return window.__shotDown; });
      await unstage(host, uid);
      const flew = ra.ev.find(e => e.k === 'proj' && e.kind === 'rocket'), gone = ra.ev.find(e => e.k === 'projGone');
      out.rocket = { copyFlew: !!flew, shotDownOnGuest: downs, hostBoom: has(rh.ev, 'boom'), copyGone: !!gone, flightMs: flew && gone ? gone.at - flew.at : null,
        guestHurt: ra.ev.filter(e => e.k === 'hurt').length };
      progress(`rocket: ${JSON.stringify(out.rocket)}`);
      check(out.rocket.copyFlew && out.rocket.shotDownOnGuest >= 1 && out.rocket.hostBoom && out.rocket.copyGone, 'A guest shot an enemy rocket out of the air: the host\'s real one blew up', out.rocket);
      // 34 m at 26 m/s is 1.3 s to arrive: one shot down on the way goes off sooner.
      check(out.rocket.flightMs !== null && out.rocket.flightMs < 1150 + lagMs * 3, 'It went off short of the guest', out.rocket);
    }

    if (parts.has('watcher') && b) {
      // B is not the target: it must still see the sniper's laser, the shot and the tracer aimed at A.
      await calm(host); await place();
      const since = Date.now();
      const uid = await stage(host, 'sniper', (await ahead(host, 30)).at, 'snipe');
      const rb = await until(b, since, r => r.log.some(e => e.uid === uid && e.p === 'fire'), 7000 + lagMs * 4);
      await sleep(300);
      const final = await readRecord(b, since);
      const toA = await b.evaluate(uid => {
        const { ctx } = window.__op2;
        const e = ctx.enemies.alive.find(e => e.uid === uid);
        const friend = [...ctx.coop.remotes.values()].find(r => r.player.name === 'GUEST-TWO');
        return e && friend ? { aim: e.aimPoint.toArray(), friend: friend.char.root.position.toArray(), me: ctx.player.position.toArray() } : null;
      }, uid);
      await unstage(host, uid);
      const near = (p, q) => Math.hypot(p[0] - q[0], p[2] - q[2]);
      out.watcher = { fired: rb.log.some(e => e.uid === uid && e.p === 'fire'), laser: has(final.ev, 'laser'), tracer: has(final.ev, 'tracer', e => e.kind === 'snipe'),
        flash: has(final.ev, 'flash', e => e.kind === 'snipe'), hurt: final.ev.filter(e => e.k === 'hurt').length,
        aimToFriend: toA ? near(toA.aim, toA.friend) : null, aimToMe: toA ? near(toA.aim, toA.me) : null };
      progress(`watcher: ${JSON.stringify(out.watcher)}`);
      check(out.watcher.fired && out.watcher.laser && out.watcher.tracer && out.watcher.flash, 'A guest who is not the target sees the laser, the flash and the tracer', out.watcher);
      check(out.watcher.hurt === 0 && out.watcher.aimToFriend !== null && out.watcher.aimToFriend < 1.5 && out.watcher.aimToMe > 2, 'On their screen the laser sits on the friend it is aimed at, and the shot is not theirs to take', out.watcher);
    }

    const failed = await Promise.all(party.guests.map(page => page.evaluate(() => window.__op2.ctx.coop.world.attacks.seen.failed)));
    check(failed.every(n => n === 0), 'No attack code threw on a copy', failed);
    check(out.errors.length === 0, 'No page exceptions', out.errors);
    await shot(a, 'guest-end');
    return out;
  } catch (error) {
    out.failure = error.stack ?? String(error);
    throw error;
  } finally {
    writeFileSync(`${outDir}/${tag}-evidence.json`, JSON.stringify(out, null, 2));
    for (const guest of party?.guests ?? []) await guest.close().catch(() => {});
  }
}
