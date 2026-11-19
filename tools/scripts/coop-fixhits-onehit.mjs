// Co-op diagnostic: one hit, on both screens, frame by frame (fix-hits: "a guest's gun does less work").
//
// Two pages. A still, unkillable man stands 8 m down a lane. One player fires single rounds at his chest, a few seconds
// apart; every 50 ms each page writes down how its own body of that man stands: whether gore has him, on his feet or on the
// floor, how high his chest is, what his reflex is doing. The same rounds are fired by the host (the guest watching) and by
// the guest (the host deciding). Printed per shot: what the damage model made of it on each screen (the reaction level) and
// for how long each screen's body was off its feet.
//
//   node tools/shot.mjs --port 5500 --w 640 --h 400 --wait 500 --timeout 900 --quiet \
//     --script tools/scripts/coop-fixhits-onehit.mjs --out tools/out/coop/fix-hits/onehit.png
//   ONEHIT_GUNS=ultramag,smg   ONEHIT_SHOTS=6   ONEHIT_SIM=lag:120,jitter:40,loss:0.05
import { writeFileSync } from 'node:fs';
import { calm, give, kit, live, startParty } from './coop-kit.mjs';

const GUNS = (process.env.ONEHIT_GUNS ?? 'ultramag,harrow,smg').split(',');
const SHOTS = Number(process.env.ONEHIT_SHOTS ?? 6);
const SIM = process.env.ONEHIT_SIM ?? '';
/** Rounds a "shot": more than one is a quick string of them (a trigger worked as fast as the script can), on a body still reacting to the last. */
const BURST = Number(process.env.ONEHIT_BURST ?? 1);
const TAG = SIM ? 'lag' : 'clean';

/** Runs in each page: a sampler of one enemy's body, and a note of every reaction the damage model chose here. */
function record() {
  const { ctx } = window.__op2;
  const rec = window.__one = { uid: 0, samples: [], levels: [], timer: 0 };
  const model = ctx.enemies.model;
  for (const name of ['apply', 'predict', 'show', 'reactShown']) {
    const real = model[name].bind(model);
    model[name] = (e, ...rest) => {
      const out = real(e, ...rest);
      if (e.uid === rec.uid) rec.levels.push({ t: Math.round(performance.now()), how: name, level: model.found.level, strength: +model.found.strength.toFixed(2), shock: +e.shock.toFixed(2), downed: e.downed });
      return out;
    };
  }
  // The enemy moves this page sent (the host) or played (a guest), with what gore had of the body at that moment.
  rec.moves = [];
  const moves = ctx.coop.world.modules.find(m => m && m.counts && m.queue && typeof m.play === 'function');
  if (moves) {
    const send = moves.send.bind(moves), play = moves.play.bind(moves);
    moves.send = (enemy, move, a, now) => { if (enemy.uid === rec.uid) rec.moves.push({ t: Math.round(performance.now()), sent: move }); return send(enemy, move, a, now); };
    moves.play = (enemy, event, now) => {
      if (enemy.uid === rec.uid) {
        const reflex = ctx.gore.owned?.get(enemy.char)?.rag?.muscle?.reflex;
        rec.moves.push({ t: Math.round(performance.now()), played: event.m, late: Math.round(performance.now() - event.at), gore: ctx.gore.downed(enemy.char) ? 1 : 0, phase: reflex?.phase ?? '-', lie: reflex ? +reflex.lie.toFixed(1) : -1 });
      }
      return play(enemy, event, now);
    };
  }
  rec.timer = setInterval(() => {
    const e = ctx.enemies.alive.find(e => e.uid === rec.uid);
    if (!e) return;
    const body = ctx.gore.downed(e.char);
    const reflex = ctx.gore.owned?.get(e.char)?.rag?.muscle?.reflex;
    rec.samples.push({ t: Math.round(performance.now()), downed: e.downed, gore: body ? (body.standing ? 'standing' : 'floor') : 'none', rising: e.rising > 0, phase: reflex?.phase ?? '-',
      lie: reflex ? +reflex.lie.toFixed(1) : -1, max: Math.round(e.maxHealth),
      // The push-up, as the reflex measures it: how far up it has got of where the get-up clip's first frame has it.
      push: reflex && reflex.phase === 'struggle' ? { progress: +(reflex.progress ?? 0).toFixed(2), effort: +(reflex.effort ?? 0).toFixed(2), held: +(reflex.held ?? 0).toFixed(2), hurt: +(reflex.hurt ?? 0).toFixed(2),
        hips: +(reflex.rag.parts[0].p.y - reflex.groundY).toFixed(2), keyHips: +(reflex.keyHips ?? 0).toFixed(2), keyChest: +(reflex.keyChest ?? 0).toFixed(2), fromHips: +(reflex.fromHips ?? 0).toFixed(2),
        ground: +reflex.groundY.toFixed(2), kind: reflex.kind, give: reflex.giveAt === Infinity ? 'never' : +reflex.giveAt.toFixed(2), slump: +(reflex.slump ?? 0).toFixed(2), fails: reflex.fails, knocks: reflex.knocks,
        dt: +ctx.time.dt.toFixed(4), scale: +(reflex.rag.throwScale ?? 1).toFixed(2) } : undefined,
      chest: +(e.center.y - e.position.y).toFixed(2), y: +e.center.y.toFixed(2), fallIn: +e.fallIn.toFixed(2), stagger: +e.stagger.toFixed(2) });
  }, 50);
}

export default async function (host, { sleep, outDir }) {
  const out = { tag: TAG, sim: SIM || 'off', errors: [], checks: [], screenshots: [], runs: [] };
  const { progress } = kit(outDir, `onehit-${TAG}`, out, sleep);
  let party;
  try {
    party = await startParty(host, { mode: 'crucible', players: 2, net: SIM || undefined, out, progress, sleep });
    await live(party, { enemies: 1 });
    const guest = party.pages[1];
    for (const page of party.pages) await page.evaluate(record);
    await host.evaluate(() => { const { waves } = window.__op2.ctx; waves.update = () => {}; });
    await calm(host);
    for (const page of party.pages) await page.evaluate(() => { window.__op2.ctx.player.takeDamage = () => {}; });
    const lane = await host.evaluate(() => {
      const { ctx } = window.__op2; const V = ctx.player.position.constructor;
      const s = ctx.world.playerSpawns[0];
      let best = null;
      for (let i = 0; i < 48; i++) {
        const yaw = s.yaw + (i / 48) * Math.PI * 2;
        const dir = new V(-Math.sin(yaw), 0, -Math.cos(yaw));
        const eye = s.position.clone(); eye.y += 1.4;
        const hit = ctx.physics.raycast(eye, dir, 80, 1);
        const d = hit ? hit.distance : 80;
        if (!best || d > best.d) best = { d, yaw, dir: dir.toArray(), origin: s.position.toArray() };
      }
      return best;
    });
    const P = (along, side = 0) => [lane.origin[0] + lane.dir[0] * along - lane.dir[2] * side, lane.origin[1], lane.origin[2] + lane.dir[2] * along + lane.dir[0] * side];

    for (const gun of GUNS) for (const who of ['host', 'guest']) {
      const shooter = who === 'host' ? host : guest, other = who === 'host' ? guest : host;
      await calm(host);
      const uid = await host.evaluate(at => {
        const { ctx } = window.__op2, V = ctx.player.position.constructor;
        const e = ctx.enemies.spawn('husk', new V(...at));
        e.behaviours = []; e.attacks = []; e.mode = 'hold'; e.dummy = true; e.health = e.maxHealth = 1e7;
        for (const region of [...e.limbHp.keys()]) e.limbHp.set(region, 1e9);
        return e.uid;
      }, P(8));
      await guest.waitForFunction(uid => window.__op2.ctx.enemies.alive.some(e => e.uid === uid), uid, { timeout: 30000 });
      for (const page of party.pages) await page.evaluate(uid => { const r = window.__one; r.uid = uid; r.samples = []; r.levels = []; r.moves = []; }, uid);
      const place = (page, at) => page.evaluate(([at, look]) => {
        const { ctx, game } = window.__op2; const V = ctx.player.position.constructor;
        const p = new V(...at), l = new V(...look);
        ctx.player.teleport(p, Math.atan2(-(l.x - p.x), -(l.z - p.z)));
        ctx.player.velocity.set(0, 0, 0);
        if (game.state !== 'playing') game.setState('playing');
      }, [at, P(8)]);
      await place(shooter, P(0)); await place(other, P(-2, 3));
      await give(shooter, gun);
      await shooter.waitForFunction(w => { const s = window.__op2.ctx.weapons; return s.current === w && s.drawLeft <= 0; }, gun, { timeout: 15000 });
      await sleep(SIM ? 1500 : 700);
      const shots = [];
      for (let i = 0; i < SHOTS; i++) {
        // At his chest as this screen has him now, whatever he is doing.
        const fired = await shooter.evaluate(async ([uid, burst]) => {
          const { ctx } = window.__op2;
          const t = Math.round(performance.now());
          for (let n = 0; n < burst; n++) {
            const e = ctx.enemies.alive.find(e => e.uid === uid);
            const d = e.center.clone().sub(ctx.player.eye);
            ctx.player.yaw = Math.atan2(-d.x, -d.z); ctx.player.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
            ctx.weapons.refillMagazines();
            await new Promise(r => setTimeout(r, 60));
            ctx.input.simulate('fire', true);
            await new Promise(r => setTimeout(r, 60));
            ctx.input.simulate('fire', false);
            await new Promise(r => setTimeout(r, 130));
          }
          return t;
        }, [uid, BURST]);
        shots.push(fired);
        await sleep(3500);
      }
      const [h, g] = await Promise.all(party.pages.map(page => page.evaluate(() => ({ samples: window.__one.samples, levels: window.__one.levels, moves: window.__one.moves, now: Math.round(performance.now()) }))));
      /** Seconds off its feet on this page: on the floor, and balancing on its muscles. */
      const off = page => ({ floor: +(page.samples.filter(s => s.gore === 'floor').length * 0.05).toFixed(2), balancing: +(page.samples.filter(s => s.gore === 'standing').length * 0.05).toFixed(2),
        downed: +(page.samples.filter(s => s.downed).length * 0.05).toFixed(2), seconds: +(page.samples.length * 0.05).toFixed(1) });
      const run = { gun, who, uid, host: { off: off(h), levels: h.levels }, guest: { off: off(g), levels: g.levels } };
      out.runs.push(run);
      const said = page => page.levels.map(l => `${l.how}:${l.level}${l.downed ? '*' : ''}`).join(' ');
      // The shooter's own body of him, as a strip: one letter a quarter second (. on his feet, b balancing, F on the floor).
      const strip = page => page.samples.filter((_, i) => i % 5 === 0).map(s => s.gore === 'floor' ? 'F' : s.gore === 'standing' ? 'b' : '.').join('');
      run.strips = { host: strip(h), guest: strip(g) };
      run.maxHealth = { host: h.samples[0]?.max, guest: g.samples[0]?.max };
      progress(`${gun}, ${who} fires ${SHOTS}: host's body floor ${run.host.off.floor} s, balancing ${run.host.off.balancing} s; guest's copy floor ${run.guest.off.floor} s, balancing ${run.guest.off.balancing} s (of ${run.host.off.seconds} s)`);
      progress(`   host model: ${said(h)}`);
      progress(`   guest model: ${said(g)}`);
      const t0 = h.samples[0]?.t ?? 0, g0 = g.samples[0]?.t ?? 0;
      run.moves = { host: h.moves.map(m => ({ ...m, t: m.t - t0 })), guest: g.moves.map(m => ({ ...m, t: m.t - g0 })) };
      // The guest's reflex, a letter a quarter second: f falling, l lying, s pushing up, g gathering; and what its lie timer read.
      run.phases = g.samples.filter((_, i) => i % 5 === 0).map(x => (x.phase === '-' ? '.' : x.phase[0])).join('');
      run.lies = [...new Set(g.samples.map(x => x.lie))].slice(0, 12);
      progress(`   host sent: ${run.moves.host.map(m => `${m.sent}@${(m.t / 1000).toFixed(2)}`).join(' ')}`);
      progress(`   guest played: ${run.moves.guest.map(m => `${m.played}@${(m.t / 1000).toFixed(2)}(${m.phase},lie ${m.lie},late ${m.late})`).join(' ')}`);
      progress(`   guest reflex ${run.phases}  lie values ${run.lies.join(',')}`);
      const pushes = page => page.samples.filter(x => x.push).filter((_, i) => i % 6 === 0).slice(0, 8).map(x => JSON.stringify(x.push));
      run.pushes = { host: pushes(h), guest: pushes(g) };
      for (const line of run.pushes.host) progress(`   host push  ${line}`);
      for (const line of run.pushes.guest) progress(`   guest push ${line}`);
      progress(`   host  ${run.strips.host}`);
      progress(`   guest ${run.strips.guest}   (largest health host ${run.maxHealth.host}, guest ${run.maxHealth.guest}; * a round on a body gore already had)`);
    }
    return { runs: out.runs.map(r => ({ gun: r.gun, who: r.who, host: r.host.off, guest: r.guest.off })) };
  } catch (error) {
    out.failure = error.stack ?? String(error);
    throw error;
  } finally {
    writeFileSync(`${outDir}/onehit-${TAG}-evidence.json`, JSON.stringify(out, null, 2));
    for (const g of party?.guests ?? []) await g.close().catch(() => {});
  }
}
