// What the gore's events cost on the wire: a guest empties a minigun, then a pump shotgun, into a crowd, and the bytes of the
// host's answers to it (`ack`) and of the hits as a watching guest gets them (`hitfx`, `sever`, `kill`) are counted.
//
//   node tools/shot.mjs --port <port> --w 1280 --h 720 --wait 500 --timeout 400 \
//     --script tools/scripts/coop-gore-bytes.mjs --out tools/out/coop/gore/bytes.png
//
// Three pages: the host, the shooter, a watcher. The count is the JSON of each event as it arrived, without the match wrapper
// every message on the reliable lane carries today (58 bytes, the wire lane's to remove); both figures are in the evidence.
import { writeFileSync } from 'node:fs';
import { calm, give, inMatch, kit, spawn, startParty } from './coop-kit.mjs';

const TAG = 'gore-bytes';
const SECONDS = Number(process.env.GORE_SECONDS ?? 6);
const WRAPPER = 58;

/** Runs in a guest's page: counts the gore events that arrive, by type. */
function meter() {
  const hits = window.__op2.ctx.coop.world.hits;
  const seen = window.__goreBytes = { ack: { n: 0, bytes: 0 }, hitfx: { n: 0, bytes: 0 }, sever: { n: 0, bytes: 0 }, kill: { n: 0, bytes: 0 } };
  for (const [type, name] of [['ack', 'ackIn'], ['hitfx', 'hitfxIn'], ['sever', 'severIn'], ['kill', 'killIn']]) {
    const real = hits[name];
    hits[name] = function (value, ...rest) {
      seen[type].n++;
      seen[type].bytes += new TextEncoder().encode(JSON.stringify(value)).byteLength;
      return real.call(this, value, ...rest);
    };
  }
}
const zero = page => page.evaluate(() => { for (const row of Object.values(window.__goreBytes)) row.n = row.bytes = 0; });
const count = page => page.evaluate(() => JSON.parse(JSON.stringify(window.__goreBytes)));

export default async function (host, { sleep, outDir }) {
  const out = { errors: [], checks: [], screenshots: [], seconds: SECONDS, wrapper: WRAPPER, guns: {} };
  const { check, progress } = kit(outDir, TAG, out, sleep);
  let party;
  try {
    party = await startParty(host, { mode: 'crucible', players: 3, out, progress, sleep });
    const [shooter, watcher] = party.guests;
    await inMatch(party.pages, party.mode.contract);
    for (const page of party.pages) await page.evaluate(() => { const { ctx, game } = window.__op2; ctx.player.modifiers.invulnerable = true; game.setState('playing'); });
    await host.evaluate(() => { window.__op2.ctx.waves.update = () => {}; });
    await calm(host);
    for (const page of party.guests) await page.evaluate(meter);

    for (const gun of ['buzzsaw', 'shotgun']) {
      await calm(host);
      // A crowd that stands and takes it: sixteen sturdy husks eight metres off, so every round lands and nothing dies early.
      const uids = await spawn(host, 'husk', 16, { ahead: 8, hold: true, spacing: 0.9 });
      await host.evaluate(uids => {
        for (const enemy of window.__op2.ctx.enemies.alive) if (uids.includes(enemy.uid)) {
          enemy.health = enemy.maxHealth = 60000; enemy.speedMul = 0;
          for (const region of [...enemy.limbHp.keys()]) enemy.limbHp.set(region, 1e7);
        }
      }, uids);
      await shooter.waitForFunction(n => window.__op2.ctx.enemies.alive.length >= n, uids.length, { timeout: 20000 });
      await give(shooter, gun);
      await sleep(800);
      // The gun kept on the nearest body of the crowd (they stagger and fall), the magazine topped up as it goes. A minigun's
      // trigger is held; a pump's is pulled again for every shell.
      await shooter.evaluate(pump => {
        const { ctx, game } = window.__op2;
        game.setState('playing');
        window.__goreFired = 0;
        window.__goreOff = ctx.events.on('weapon:fired', () => { window.__goreFired++; });
        let tick = 0;
        const aim = () => {
          let to = null, best = Infinity;
          for (const e of ctx.enemies.alive) { const d = e.center.distanceToSquared(ctx.player.eye); if (d < best) { best = d; to = e.center; } }
          if (to) {
            const dx = to.x - ctx.player.eye.x, dy = to.y - ctx.player.eye.y, dz = to.z - ctx.player.eye.z;
            ctx.player.yaw = Math.atan2(-dx, -dz); ctx.player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
          }
          ctx.weapons.refillMagazines();
          ctx.input.simulate('fire', pump ? tick++ % 2 === 0 : true);
        };
        window.__goreTop = setInterval(aim, 60);
        aim();
      }, gun === 'shotgun');
      await sleep(500);
      for (const page of party.guests) await zero(page);
      await shooter.evaluate(() => { window.__goreFired = 0; window.__goreSeen = { ...window.__op2.ctx.coop.world.hitsSeen }; });
      const started = Date.now();
      await sleep(SECONDS * 1000);
      const took = (Date.now() - started) / 1000;
      const toShooter = await count(shooter), toWatcher = await count(watcher);
      const drew = await shooter.evaluate(() => {
        const seen = window.__op2.ctx.coop.world.hitsSeen, was = window.__goreSeen;
        window.__op2.ctx.input.simulate('fire', false); clearInterval(window.__goreTop); window.__goreOff?.();
        return { fired: window.__goreFired, predicted: seen.predicted - was.predicted, acks: seen.acks - was.acks, fps: window.__op2.stats().fps };
      });
      const rate = (rows, types) => {
        const n = types.reduce((sum, t) => sum + rows[t].n, 0), bytes = types.reduce((sum, t) => sum + rows[t].bytes, 0);
        return { perSecond: Math.round(n / took * 10) / 10, bytesPerSecond: Math.round(bytes / took), withWrapper: Math.round((bytes + n * WRAPPER) / took), meanBytes: n ? Math.round(bytes / n) : 0 };
      };
      out.guns[gun] = {
        seconds: took, shotsPerSecond: Math.round(drew.fired / took * 10) / 10, hitsDrawnPerSecond: Math.round(drew.predicted / took * 10) / 10, shooterFps: drew.fps,
        answersToShooter: rate(toShooter, ['ack']), hitsToWatcher: rate(toWatcher, ['hitfx']), cutsAndDeathsToWatcher: rate(toWatcher, ['sever', 'kill']),
        pictureSentToShooter: toShooter.hitfx.n,
      };
      progress(`${gun}: ${JSON.stringify(out.guns[gun])}`);
      check(drew.predicted > 0 && toShooter.ack.n > 0, `${gun}: the shooter drew its hits and the host answered them`, drew);
      check(toShooter.hitfx.n === 0, `${gun}: the shooter was sent no picture of its own hits`, toShooter.hitfx);
      check(toWatcher.hitfx.n > 0 && toWatcher.ack.n === 0, `${gun}: the watcher got the hits and no answers`, toWatcher);
      check(out.guns[gun].hitsToWatcher.meanBytes < 125 && out.guns[gun].answersToShooter.meanBytes < 75, `${gun}: a hit is under 125 bytes and an answer under 75`, out.guns[gun]);
    }
    check(out.errors.length === 0, 'No page exceptions', out.errors);
    return out;
  } catch (error) {
    out.failure = error.stack ?? String(error);
    throw error;
  } finally {
    writeFileSync(`${outDir}/${TAG}-evidence.json`, JSON.stringify(out, null, 2));
    for (const guest of party?.guests ?? []) await guest.close().catch(() => {});
  }
}
