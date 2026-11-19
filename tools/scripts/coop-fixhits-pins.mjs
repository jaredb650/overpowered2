// Co-op proof: what a guest's kill does to the body it kills (fix-hits, checklist C14).
//
// Two pages. The guest, on its own screen:
//   - nails a man to the wall behind him with a stake (the body dies on the host's word, so the pin is made when the `kill`
//     comes: Projectiles.nailLate), with kill prediction off and with it on (the death is played at once and the stake
//     takes the corpse with it as on the host);
//   - flings a body with a shovel's blow (Melee's late fling), the same two ways;
//   - splits the Lance's rail past each body it kills and gets its kill stop (the shot's kill count goes by the guest's guess).
//
//   OP2_NO_HMR=1 npx vite --port 5500 --strictPort
//   node tools/shot.mjs --port 5500 --w 640 --h 400 --wait 500 --timeout 900 --quiet \
//     --script tools/scripts/coop-fixhits-pins.mjs --out tools/out/coop/fix-hits/pins.png
//   PINS_SIM=lag:120,jitter:40,loss:0.05   the network simulator on both pages
//   PINS_MODES=on|off                      only with kill prediction on (the game's default), or only with it off
import { writeFileSync } from 'node:fs';
import { calm, give, kit, live, startParty, state } from './coop-kit.mjs';

const SIM = process.env.PINS_SIM ?? '';
const TAG = SIM ? 'lag' : 'clean';

/** Runs in the guest: counts pins made, flings given, and the shot's own kill stops. */
function record() {
  const { ctx } = window.__op2;
  const rec = window.__pins = { pins: 0, flings: 0, stops: [], deaths: 0 };
  const gore = ctx.gore;
  const pin = gore.pin?.bind(gore);
  if (pin) gore.pin = (...args) => { rec.pins++; return pin(...args); };
  const impulse = ctx.physics.radialImpulse.bind(ctx.physics);
  ctx.physics.radialImpulse = (...args) => { rec.flings++; return impulse(...args); };
  const feel = ctx.combat.feel, stop = feel.stop.bind(feel);
  feel.stop = (seconds, ...rest) => { rec.stops.push(+seconds.toFixed(3)); return stop(seconds, ...rest); };
  for (const death of ['ragdoll', 'collapse', 'headshot', 'gib', 'slice']) {
    const real = gore[death]?.bind(gore);
    if (real) gore[death] = (...args) => { rec.deaths++; return real(...args); };
  }
}

export default async function (host, { sleep, outDir }) {
  const out = { tag: TAG, sim: SIM || 'off', errors: [], checks: [], screenshots: [], cases: [] };
  const { check, progress } = kit(outDir, `pins-${TAG}`, out, sleep);
  let party;
  try {
    party = await startParty(host, { mode: 'crucible', players: 2, net: SIM || undefined, out, progress, sleep });
    await live(party, { enemies: 1 });
    const guest = party.pages[1];
    await guest.evaluate(record);
    await host.evaluate(() => { const { waves } = window.__op2.ctx; waves.update = () => {}; });
    await calm(host);
    for (const page of party.pages) await page.evaluate(() => { window.__op2.ctx.player.takeDamage = () => {}; });
    // A wall 16 to 30 m from the spawn, to stand men in front of.
    const lane = await host.evaluate(() => {
      const { ctx } = window.__op2; const V = ctx.player.position.constructor;
      const s = ctx.world.playerSpawns[0];
      let best = null;
      for (let i = 0; i < 48; i++) {
        const yaw = s.yaw + (i / 48) * Math.PI * 2;
        const dir = new V(-Math.sin(yaw), 0, -Math.cos(yaw));
        const eye = s.position.clone(); eye.y += 1.4;
        const hit = ctx.physics.raycast(eye, dir, 80, 1);
        if (!hit) continue;
        const score = -Math.abs(hit.distance - 20);
        if (!best || score > best.score) best = { score, d: hit.distance, yaw, dir: dir.toArray(), origin: s.position.toArray() };
      }
      return best;
    });
    out.lane = lane;
    const P = (along, side = 0) => [lane.origin[0] + lane.dir[0] * along - lane.dir[2] * side, lane.origin[1], lane.origin[2] + lane.dir[2] * along + lane.dir[0] * side];

    /** Host: `count` held men in a row `fromWall` m in front of the wall (or in a line toward it), each with `health`. */
    const men = async (count, health, places) => {
      await calm(host);
      const uids = await host.evaluate(([places, health]) => {
        const { ctx } = window.__op2, V = ctx.player.position.constructor;
        return places.map(at => {
          const enemy = ctx.enemies.spawn('husk', new V(...at));
          enemy.behaviours = []; enemy.attacks = []; enemy.mode = 'hold'; enemy.dummy = true;
          enemy.health = enemy.maxHealth = health;
          return enemy.uid;
        });
      }, [places.slice(0, count), health]);
      await guest.waitForFunction(n => window.__op2.ctx.enemies.alive.length >= n, uids.length, { timeout: 30000 });
      await sleep(SIM ? 1200 : 500);
      return uids;
    };
    const stand = (at, look) => guest.evaluate(([at, look]) => {
      const { ctx, game } = window.__op2; const V = ctx.player.position.constructor;
      const p = new V(...at), l = new V(...look);
      ctx.player.teleport(p, Math.atan2(-(l.x - p.x), -(l.z - p.z)));
      ctx.player.velocity.set(0, 0, 0);
      const eye = p.clone(); eye.y += 1.62;
      ctx.player.yaw = Math.atan2(-(l.x - p.x), -(l.z - p.z));
      ctx.player.pitch = Math.atan2(l.y - eye.y, Math.hypot(l.x - eye.x, l.z - eye.z));
      if (game.state !== 'playing') game.setState('playing');
    }, [at, look]);
    const reset = () => guest.evaluate(() => { const r = window.__pins; r.pins = r.flings = r.deaths = 0; r.stops = []; return { ...window.__op2.ctx.coop.world.hitsSeen }; });
    const read = () => guest.evaluate(() => ({ ...window.__pins, seen: { ...window.__op2.ctx.coop.world.hitsSeen }, alive: window.__op2.ctx.enemies.alive.length, kills: window.__op2.ctx.progression.kills }));
    const press = async (action, ms) => { await guest.evaluate(a => window.__op2.ctx.input.simulate(a, true), action); await sleep(ms); await guest.evaluate(a => window.__op2.ctx.input.simulate(a, false), action); };
    const ready = weapon => guest.waitForFunction(w => { const s = window.__op2.ctx.weapons; return s.current === w && s.drawLeft <= 0 && !s.reloading; }, weapon, { timeout: 15000 });
    const predict = on => guest.evaluate(on => { window.__op2.ctx.coop.world.feel.predictKills = on; }, on);

    // PINS_MODES=on|off runs one of the two (kill prediction is on in the game; off is the switch's other side).
    for (const predicting of [false, true].filter(on => !process.env.PINS_MODES || process.env.PINS_MODES === (on ? 'on' : 'off'))) {
      await predict(predicting);
      const mode = predicting ? 'prediction on' : 'prediction off';

      // ---- a stake nails the man it kills to the wall behind him ------------------------------------------------------
      await men(1, 20, [P(lane.d - 2.2)]);
      await give(guest, 'stakegun'); await ready('stakegun');
      await stand(P(lane.d - 9), [...P(lane.d - 2.2).slice(0, 1), lane.origin[1] + 1.25, P(lane.d - 2.2)[2]]);
      await sleep(300);
      await reset();
      const kills0 = (await read()).kills;
      await press('fire', 80);
      await host.waitForFunction(() => window.__op2.ctx.enemies.alive.length === 0, null, { timeout: 15000 }).catch(() => {});
      await sleep(SIM ? 2500 : 1200);
      const stake = await read();
      out.cases.push({ what: 'stake', mode, ...stake, kills: stake.kills - kills0 });
      check(stake.kills - kills0 === 1, `${mode}: the guest's stake kills the man, and the kill is the guest's`, stake);
      check(stake.pins >= 1, `${mode}: the body is nailed to the wall behind it on the guest's screen (${stake.pins} pin)`, stake);
      if (predicting) check(stake.seen.deaths >= 1 && stake.seen.deathsWrong === 0, `${mode}: the death was played at the shot and the host confirmed it`, stake.seen);

      // ---- a shovel's blow flings the body it kills ----------------------------------------------------------------------
      await men(1, 20, [P(8)]);
      await give(guest, 'shovel'); await ready('shovel');
      await stand(P(6.6), [P(8)[0], lane.origin[1] + 1.2, P(8)[2]]);
      await sleep(300);
      await reset();
      const kills1 = (await read()).kills;
      await press('fire', 80);
      await host.waitForFunction(() => window.__op2.ctx.enemies.alive.length === 0, null, { timeout: 15000 }).catch(() => {});
      await sleep(SIM ? 2500 : 1200);
      const blow = await read();
      out.cases.push({ what: 'fling', mode, ...blow, kills: blow.kills - kills1 });
      check(blow.kills - kills1 === 1, `${mode}: the guest's shovel kills the man`, blow);
      check(blow.flings >= 1, `${mode}: the body is flung by the blow on the guest's screen (${blow.flings} impulse)`, blow);
    }

    // ---- the Lance's rail splits past each body it kills, and stops for them, on a guest -----------------------------------
    await predict(false);
    await men(3, 20, [P(8), P(10.5), P(13)]);
    await give(guest, 'lance'); await ready('lance');
    await guest.evaluate(() => { const w = window.__op2.ctx.weapons; if (w.lance.mode === 'ball') w.lance.toggle(); w.refillMagazines(); });
    await stand(P(2), [P(8)[0], lane.origin[1] + 1.2, P(8)[2]]);
    await sleep(400);
    await reset();
    const kills2 = (await read()).kills;
    await press('fire', 60);
    await host.waitForFunction(() => window.__op2.ctx.enemies.alive.length === 0, null, { timeout: 15000 }).catch(() => {});
    await sleep(SIM ? 2500 : 1200);
    const rail = await read();
    const biggest = Math.max(0, ...rail.stops);
    out.cases.push({ what: 'lance', ...rail, kills: rail.kills - kills2, biggestStop: biggest });
    check(rail.kills - kills2 === 3, `the guest's rail kills all three men in the line (${rail.kills - kills2})`, rail);
    // Hit-stop itself does nothing in co-op (the time rule), but the shot still asks for the stop its kills earn: 0.06 s for
    // a rail that struck a body and 0.018 s more a kill (weapons/data.ts HIT_STOP). On a guest it asked for 0.06 whatever it
    // killed, because the shot's kill count read the host-only `killed`.
    check(biggest >= 0.06 + 3 * 0.018 - 0.002, `the rail asks for the stop three kills earn on the guest (${biggest} s; 0.06 with no kill counted)`, rail.stops);
    out.final = await Promise.all(party.pages.map(state));
    const books = await host.evaluate(() => JSON.parse(JSON.stringify(window.__op2.ctx.coop.world.claimBooks)));
    out.books = books;
    check(books.refusedTotal === 0, `the host refused no claim (${books.received.hit} hits received)`, books.refusals);
    check(out.errors.length === 0, 'No page exceptions', out.errors);
    return out;
  } catch (error) {
    out.failure = error.stack ?? String(error);
    throw error;
  } finally {
    writeFileSync(`${outDir}/pins-${TAG}-evidence.json`, JSON.stringify(out, null, 2));
    for (const guest of party?.guests ?? []) await guest.close().catch(() => {});
  }
}
