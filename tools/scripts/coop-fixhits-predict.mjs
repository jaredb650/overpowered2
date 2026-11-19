// Co-op proof: kill prediction and the host's "no" (fix-hits, checklist C12 and C13).
//
// Three pages: the host and two guests who stand side by side and shoot the same enemies, round after round, with a
// different gun each round. Guest 1 plays with kill prediction ON, guest 2 with it OFF, in the same fight on the same
// network, so the two can be compared. Measured on each guest:
//   - the kill feel: for every enemy this page's own numbers called dead, the time from that shot to the body leaving its
//     feet on this page (a limp fall or the death itself);
//   - what prediction started: bodies dropped for dead and whole deaths played ahead of the host, how many the host
//     confirmed, how many were wrong (a wrong fall gets up: a knockdown; a wrong death is a body brought back);
//   - resurrections, counted apart from the game's own counters: an enemy that died on this page and was alive on it later;
//   - the host's refusals (none in an honest fight) and the answers a guest got to its hits (`ack`, `nack`).
// Then one forced refusal: guest 1 fires a round from where the host cannot credit it, and its numbers must come right.
//
//   OP2_NO_HMR=1 npx vite --port 5500 --strictPort
//   node tools/shot.mjs --port 5500 --w 640 --h 400 --wait 500 --timeout 1500 --quiet \
//     --script tools/scripts/coop-fixhits-predict.mjs --out tools/out/coop/fix-hits/predict.png
//
//   PREDICT_SIM=lag:150,jitter:60,loss:0.08   the network simulator on every page ("off" for a clean link)
//   PREDICT_ROUNDS=12                         rounds of PREDICT_FOES enemies (default 12 x 10)
//   PREDICT_TAG=noisy                         names the evidence file
import { writeFileSync } from 'node:fs';
import { ahead, calm, give, kit, live, shootLoop, startParty, state, stopShooting, teleport } from './coop-kit.mjs';

const SIM = process.env.PREDICT_SIM === 'off' ? '' : process.env.PREDICT_SIM ?? 'lag:150,jitter:60,loss:0.08';
const ROUNDS = Number(process.env.PREDICT_ROUNDS ?? 12);
const FOES = Number(process.env.PREDICT_FOES ?? 10);
const TAG = process.env.PREDICT_TAG ?? (SIM ? 'noisy' : 'clean');
/** A gun a round, in turn: light rounds (many answers in the air), heavy single rounds, pellets, a blast. */
const GUNS = ['smg', 'harrow', 'shotgun', 'judge', 'rivet', 'rocket'];
const KINDS = ['husk', 'husk', 'trooper', 'husk', 'gunner', 'husk', 'trooper', 'husk', 'husk', 'stalker'];

/** Runs in each page: when this page called an enemy dead, when its body left its feet here, and whether any came back. */
function record() {
  const { ctx } = window.__op2;
  const rec = window.__pk = { told: {}, down: {}, died: {}, back: [], sure: {}, acks: 0, nacks: 0 };
  const chars = new WeakMap();
  const learn = () => { for (const e of ctx.enemies.alive) chars.set(e.char, e.uid); };
  const uidOf = char => { learn(); return chars.get(char) ?? -1; };
  ctx.events.on('enemy:hit', e => {
    const uid = e.enemy.uid;
    if (e.result.killSoon && !(uid in rec.told)) { rec.told[uid] = performance.now(); rec.sure[uid] = e.result.sure ?? 'none'; }
  });
  const gore = ctx.gore;
  const knockdown = gore.knockdown.bind(gore);
  gore.knockdown = (char, options) => {
    const uid = uidOf(char), cold = options?.knockout === true;
    const ok = knockdown(char, options);
    if (ok && cold && uid > 0 && !(uid in rec.down)) rec.down[uid] = performance.now();
    return ok;
  };
  for (const death of ['ragdoll', 'collapse', 'headshot', 'gib', 'slice', 'vaporize']) {
    const real = gore[death]?.bind(gore);
    if (!real) continue;
    gore[death] = (char, ...rest) => { const uid = uidOf(char); if (uid > 0 && !(uid in rec.died)) rec.died[uid] = performance.now(); return real(char, ...rest); };
  }
  // An enemy that died on this page and is alive on it later: the one thing prediction must never do.
  setInterval(() => {
    learn();
    for (const e of ctx.enemies.alive) if (e.alive && rec.died[e.uid] !== undefined && performance.now() - rec.died[e.uid] > 50 && !rec.back.includes(e.uid)) rec.back.push(e.uid);
  }, 50);
}

const read = page => page.evaluate(() => {
  const { ctx } = window.__op2, rec = window.__pk, world = ctx.coop.world;
  const lags = [];
  for (const uid of Object.keys(rec.told)) {
    const left = Math.min(rec.down[uid] ?? Infinity, rec.died[uid] ?? Infinity);
    if (Number.isFinite(left)) lags.push(Math.max(0, Math.round(left - rec.told[uid])));
  }
  lags.sort((a, b) => a - b);
  const at = q => lags.length ? lags[Math.min(lags.length - 1, Math.floor(lags.length * q))] : null;
  const sure = {};
  for (const kind of Object.values(rec.sure)) sure[kind] = (sure[kind] ?? 0) + 1;
  return { host: ctx.coop.hosting, predicting: world.feel.predictKills, seen: { ...world.hitsSeen }, books: JSON.parse(JSON.stringify(world.claimBooks)),
    kills: ctx.progression.kills, told: Object.keys(rec.told).length, fellOrDied: lags.length, lagMs: { p50: at(0.5), p90: at(0.9), max: lags.at(-1) ?? null, under50: lags.filter(l => l <= 50).length },
    sure, back: rec.back, alive: ctx.enemies.alive.length, fps: window.__op2.stats().fps };
});

export default async function (host, { sleep, outDir }) {
  const out = { tag: TAG, sim: SIM || 'off', rounds: ROUNDS, foes: FOES, errors: [], checks: [], screenshots: [], perRound: [] };
  const { check, progress } = kit(outDir, `predict-${TAG}`, out, sleep);
  let party;
  try {
    party = await startParty(host, { mode: 'crucible', players: 3, net: SIM || undefined, out, progress, sleep });
    await live(party, { enemies: 1 });
    const [, one, two] = party.pages;
    for (const page of party.pages) await page.evaluate(record);
    await host.evaluate(() => { const { waves } = window.__op2.ctx; waves.update = () => {}; });
    await calm(host);
    // Guest 1 predicts, guest 2 does not: the same fight, the same network.
    await one.evaluate(() => { window.__op2.ctx.coop.world.feel.predictKills = true; });
    await two.evaluate(() => { window.__op2.ctx.coop.world.feel.predictKills = false; });
    const spot = await ahead(host, 0);
    const side = [Math.cos(spot.yaw), 0, -Math.sin(spot.yaw)];
    const stand = (i, back = 0) => [spot.at[0] + side[0] * i * 1.6 + Math.sin(spot.yaw) * back, spot.at[1], spot.at[2] + side[2] * i * 1.6 + Math.cos(spot.yaw) * back];
    await teleport(host, stand(0, 6), spot.yaw);
    await teleport(one, stand(-1), spot.yaw);
    await teleport(two, stand(1), spot.yaw);
    // Nobody is hurt in this proof: it is about the guests' own hits.
    for (const page of party.pages) await page.evaluate(() => { const p = window.__op2.ctx.player; p.takeDamage = () => {}; });

    for (let round = 0; round < ROUNDS; round++) {
      const gun = GUNS[round % GUNS.length];
      await calm(host);
      const uids = await host.evaluate(([count, kinds, far]) => {
        const { ctx } = window.__op2, V = ctx.player.position.constructor;
        const s = ctx.world.playerSpawns[0];
        const forward = new V(-Math.sin(s.yaw), 0, -Math.cos(s.yaw)), side = new V(Math.cos(s.yaw), 0, -Math.sin(s.yaw));
        const made = [];
        for (let i = 0; i < count; i++) {
          const p = s.position.clone().addScaledVector(forward, far + (i % 2) * 2).addScaledVector(side, (i - (count - 1) / 2) * 1.5);
          const snapped = p.clone();
          if (ctx.world.nav.nearest?.(p, 4, snapped)) p.copy(snapped);
          const enemy = ctx.enemies.spawn(kinds[i % kinds.length], p);
          if (!enemy) continue;
          enemy.behaviours = []; enemy.attacks = []; enemy.mode = 'hold'; enemy.dummy = true;
          made.push(enemy.uid);
        }
        return made;
      }, [FOES, KINDS, gun === 'rocket' ? 18 : gun === 'shotgun' ? 7 : 12]);
      for (const page of [one, two]) await page.waitForFunction(n => window.__op2.ctx.enemies.alive.length >= n, uids.length, { timeout: 30000 }).catch(() => {});
      for (const page of [one, two]) { await give(page, gun); await shootLoop(page, { range: 60 }); }
      const cleared = await host.waitForFunction(() => window.__op2.ctx.enemies.alive.length === 0, null, { timeout: 60000 }).then(() => true, () => false);
      for (const page of [one, two]) await stopShooting(page);
      await sleep(SIM ? 1800 : 700);
      const left = await host.evaluate(() => window.__op2.ctx.enemies.alive.length);
      out.perRound.push({ round, gun, spawned: uids.length, cleared, left });
      progress(`round ${round + 1}/${ROUNDS} (${gun}): ${uids.length} enemies, ${cleared ? 'cleared' : `${left} left`}`);
    }
    await sleep(3200);
    const [h, a, b] = await Promise.all(party.pages.map(read));
    out.host = h; out.predicting = a; out.waiting = b;

    // ---- A hit the host refuses: guest 1's numbers come right at once ---------------------------------------------------
    await calm(host);
    const victim = await host.evaluate(([at]) => {
      const { ctx } = window.__op2, V = ctx.player.position.constructor;
      const enemy = ctx.enemies.spawn('husk', new V(...at));
      enemy.behaviours = []; enemy.attacks = []; enemy.mode = 'hold'; enemy.dummy = true;
      enemy.health = enemy.maxHealth = 400;
      return enemy.uid;
    }, [[spot.at[0] - Math.sin(spot.yaw) * 10, spot.at[1], spot.at[2] - Math.cos(spot.yaw) * 10]]);
    await one.waitForFunction(uid => window.__op2.ctx.enemies.alive.some(e => e.uid === uid), victim, { timeout: 30000 });
    await sleep(SIM ? 1500 : 600);
    const refused = await one.evaluate(async uid => {
      const { ctx } = window.__op2, world = ctx.coop.world, V = ctx.player.position.constructor;
      const enemy = ctx.enemies.alive.find(e => e.uid === uid);
      const before = { health: enemy.health, owed: enemy.owed, nacks: world.hitsSeen.nacks };
      // A claim whose eye is 500 m from where this player stands: the one thing the host's check is for.
      const eye = ctx.player.eye, was = eye.clone();
      eye.x += 500;
      ctx.enemies.applyDamage(enemy, { amount: 60, type: 'bullet', source: 'smg', point: enemy.center.clone(), dir: new V(0, 0, -1), force: 10, region: 'chest' });
      eye.copy(was);
      const drawn = { owed: enemy.owed, reckoned: enemy.health - enemy.owed };
      const t0 = performance.now();
      while (world.hitsSeen.nacks === before.nacks && performance.now() - t0 < 4000) await new Promise(r => setTimeout(r, 20));
      return { before, drawn, after: { health: enemy.health, owed: enemy.owed, reckoned: enemy.health - enemy.owed, nacks: world.hitsSeen.nacks, alive: enemy.alive }, answerMs: Math.round(performance.now() - t0) };
    }, victim);
    out.refused = refused;
    const hostAfter = await read(host);
    out.hostAfterRefusal = { refusedTotal: hostAfter.books.refusedTotal, refused: hostAfter.books.refused, last: hostAfter.books.refusals.at(-1) };

    // ---- the checks ------------------------------------------------------------------------------------------------------
    const cleared = out.perRound.filter(r => r.cleared).length;
    check(cleared >= Math.ceil(ROUNDS * 0.9), `the two guests cleared ${cleared} of ${ROUNDS} rounds`, out.perRound);
    check(h.books.refusedTotal === 0, `the host refused no claim in the fight (${h.books.received.hit} hits received, ${h.books.refused.gone ?? 0} for an enemy already dead)`, h.books.refusals.slice(-6));
    check(a.seen.falls + a.seen.deaths > 0, `prediction started deaths on the guest that has it on (${a.seen.falls} falls, ${a.seen.deaths} whole deaths)`, a.seen);
    check(b.seen.falls + b.seen.deaths === 0, 'the guest with prediction off started none', b.seen);
    check(a.seen.deathsWrong === 0 && a.back.length === 0, `no wrong resurrection on the predicting guest (${a.seen.deathsWrong} whole deaths wrong, ${a.back.length} enemies seen alive after dying)`, { seen: a.seen, back: a.back });
    check(b.back.length === 0, 'none on the other guest either', b.back);
    const wrongRate = a.seen.falls ? a.seen.fallsWrong / a.seen.falls : 0;
    out.wrong = { falls: a.seen.falls, fallsRight: a.seen.fallsRight, fallsWrong: a.seen.fallsWrong, fallsWrongRate: +wrongRate.toFixed(4), deaths: a.seen.deaths, deathsRight: a.seen.deathsRight, deathsWrong: a.seen.deathsWrong };
    check(wrongRate <= 0.05, `a body dropped for dead got up again ${a.seen.fallsWrong} times in ${a.seen.falls} (${(wrongRate * 100).toFixed(1)}%)`, out.wrong);
    check(a.lagMs.p50 !== null && b.lagMs.p50 !== null && a.lagMs.p50 <= b.lagMs.p50, `the body leaves its feet sooner with prediction: median ${a.lagMs.p50} ms against ${b.lagMs.p50} ms without (90th centile ${a.lagMs.p90} against ${b.lagMs.p90})`, { on: a.lagMs, off: b.lagMs });
    check(refused.drawn.owed === 60 && refused.after.owed === 0 && refused.after.reckoned === refused.before.health && refused.after.nacks === refused.before.nacks + 1 && refused.after.alive,
      `a refused hit: drawn at once (reckoned ${refused.drawn.reckoned}), and ${refused.answerMs} ms later the host's "no" puts the enemy back at ${refused.after.reckoned}`, refused);
    check(out.hostAfterRefusal.refusedTotal === 1 && out.hostAfterRefusal.last?.why === 'eye', 'the host counted that one refusal, with its reason', out.hostAfterRefusal);
    out.final = await Promise.all(party.pages.map(state));
    check(out.errors.length === 0, 'No page exceptions', out.errors);
    progress(`prediction on: ${JSON.stringify(out.wrong)}; body leaves its feet p50 ${a.lagMs.p50} ms (off: ${b.lagMs.p50} ms)`);
    return out;
  } catch (error) {
    out.failure = error.stack ?? String(error);
    throw error;
  } finally {
    writeFileSync(`${outDir}/predict-${TAG}-evidence.json`, JSON.stringify(out, null, 2));
    for (const guest of party?.guests ?? []) await guest.close().catch(() => {});
  }
}
