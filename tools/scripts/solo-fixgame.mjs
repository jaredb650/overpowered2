// Single player, the same on two builds: the review fixes of "fix-game" must leave a solo game exactly as it was.
// A frozen clock and a seeded Math.random (lib/steady.mjs), one scripted player, and a record of what happened. Run it against
// the reference build and against the branch, then compare the two JSON files (tools/scripts/solo-fixgame-compare.mjs).
//
//   node tools/shot.mjs --port <port> --url "/?contract=outpost&autostart=1" --w 640 --h 360 --wait 0 --timeout 900 \
//     --script tools/scripts/solo-fixgame.mjs --out <dir>/solo-<name>.png
//   SOLO_NAME=<name>   the record is written to <dir>/solo-<name>.json
//   SOLO_FRAMES=2400   frames of 16 ms in the long run (default 2400: 38 s)
//
// What is recorded, each from a fresh seed so one part cannot disturb the next:
//  1. `run`: Endless Humans from the first wave, the player running a wide circle and never firing. Every 200 frames: how many
//     random numbers the game has drawn, every enemy's place and health, the noises the men heard, the Commander's notebook,
//     how long the player has "stood still". Squads, soldiers' sight, footsteps, gates, the fix: all of it draws and moves.
//  2. `pod`: a supply pod called onto a fixed spot on an empty field: which way it faces, and when it was drawn.
//  3. `strikes`: an Airstrike, a Warthog and an AA Sentry, on the same field: where every rocket and shell starts.
//  4. `tank`: a Bomber shot dead with a bystander in its blast: every sound and hit marker of those frames, in order.
import { writeFileSync } from 'node:fs';
import * as steady from './lib/steady.mjs';

export const before = page => steady.install(page, { seed: 11 });

/** In the page: a fresh seeded generator as Math.random, counting its draws. */
const reseed = (page, seed) => page.evaluate(seed => {
  let a = seed >>> 0;
  const draws = (window.__draws = { n: 0 });
  Math.random = () => {
    draws.n++;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}, seed);

const r3 = n => Math.round(n * 1000) / 1000;

export default async function (page, { outDir }) {
  const name = process.env.SOLO_NAME ?? 'run';
  const frames = Number(process.env.SOLO_FRAMES ?? 2400);
  const out = { name, errors: [], run: [], pod: null, strikes: null, tank: null };
  try {
    await steady.ready(page, { until: "window.__op2?.game?.state === 'playing' || window.__op2?.game?.state === 'paused'", timeout: 240000 });
    // Sound is the one thing the frozen clock does not hold still, and it throws the same dice as the game (a pitch here, a
    // voice there, depending on which files have arrived). So nothing is played for the record: every call is counted and
    // dropped, on both builds alike, and the dice are the game's alone.
    await page.evaluate(() => {
      const { audio } = window.__op2.ctx;
      const heard = (window.__heardSounds = []);
      const loop = { stop() {}, setPosition() {}, setVolume() {}, setPitch() {}, set() {}, alive: true };
      audio.play = id => { heard.push(id); };
      audio.playOneOf = ids => { heard.push(ids[0]); };
      audio.layer = () => {};
      audio.startLoop = () => loop;
      audio.duck = () => {};
      audio.music = () => {};
    });

    // ---- 1. The long run ------------------------------------------------------------------------------------------
    await reseed(page, 101);
    await page.evaluate(() => {
      const { ctx, game } = window.__op2;
      game.newRun();
      game.setState('playing');
      ctx.player.modifiers.invulnerable = true;
      const o = ctx.enemies.outpost;
      const rec = (window.__solo = { noises: 0, noiseSum: 0, f: 0, samples: [] });
      const noise = o.noise.bind(o);
      o.noise = (at, radius) => { rec.noises++; rec.noiseSum += radius + at.x * 0.01 + at.z * 0.001; noise(at, radius); };
      const r3 = n => Math.round(n * 1000) / 1000;
      const sample = () => {
        let sx = 0, sz = 0, hp = 0;
        for (const e of ctx.enemies.alive) { sx += e.position.x; sz += e.position.z; hp += e.health; }
        const c = o.commander, t = c.tracker.round;
        rec.samples.push({ f: rec.f, draws: window.__draws.n, wave: ctx.waves.wave, phase: ctx.waves.phase, enemies: ctx.enemies.alive.length, sx: r3(sx), sz: r3(sz), hp: r3(hp),
          me: [r3(ctx.player.position.x), r3(ctx.player.position.y), r3(ctx.player.position.z)], noises: rec.noises, noiseSum: r3(rec.noiseSum),
          book: [r3(t.seconds), r3(t.fightSeconds), r3(t.stillSeconds), r3(t.fastSeconds), t.doorCrossings, t.shots, t.kills, r3(t.damageTaken)],
          still: r3(o.stillFor), track: r3(o.track.speed), intel: [r3(o.intel.position.x), r3(o.intel.position.z), r3(o.intel.at)], hostile: o.hostile,
          squads: o.squads.length, devices: c.devices.live.length, missions: c.mortars.missions });
      };
      // The player: a wide circle at a run, a hop now and then, never a shot. Driven from the game's own frame count.
      const drive = () => {
        if (window.__soloStop) return;
        requestAnimationFrame(drive);
        rec.f++;
        ctx.player.yaw = rec.f * 0.006;
        ctx.player.pitch = 0;
        ctx.input.simulate('forward', true);
        ctx.input.simulate('jump', rec.f % 240 === 120);
        if (rec.f % 200 === 0) sample();
      };
      requestAnimationFrame(drive);
    });
    await steady.frames(page, frames);
    out.run = await page.evaluate(() => { window.__soloStop = true; window.__op2.ctx.input.simulate('forward', false); window.__op2.ctx.input.simulate('jump', false); return window.__solo.samples; });

    // An empty field for the short parts: no wave, nobody on it, the player back at the start.
    const clear = seed => page.evaluate(() => {
      const { ctx } = window.__op2;
      ctx.waves.reset();
      for (const e of [...ctx.enemies.alive]) ctx.enemies.withdraw(e);
      const s = ctx.world.playerSpawns[0];
      ctx.player.teleport(s.position.clone(), s.yaw);
      ctx.player.pitch = -0.4;
    }).then(() => steady.frames(page, 30)).then(() => reseed(page, seed));

    // ---- 2. The pod's facing --------------------------------------------------------------------------------------
    await clear(202);
    await page.evaluate(() => {
      const { ctx } = window.__op2, V = ctx.player.position.constructor;
      const s = ctx.world.playerSpawns[0].position;
      window.__podAt = new V(s.x + 6, s.y, s.z + 6);
      ctx.progression.pods.call(window.__podAt);
      window.__podDraws = { atCall: window.__draws.n };
    });
    const podSeen = [];
    for (let i = 0; i < 10; i++) {
      await steady.frames(page, 20);
      podSeen.push(await page.evaluate(() => {
        const pod = window.__op2.ctx.progression.pods.pods.find(p => p.phase !== 'spent');
        return pod ? { phase: pod.phase, yaw: Math.round(pod.group.rotation.y * 1e6) / 1e6, draws: window.__draws.n } : null;
      }));
    }
    out.pod = { atCall: await page.evaluate(() => window.__podDraws.atCall), seen: podSeen };

    // ---- 3. Call-ins: where every round starts ---------------------------------------------------------------------
    out.strikes = {};
    for (const [id, source, wait] of [['airstrike', 'airstrike', 320], ['warthog', 'warthog', 330], ['sentry', 'sentry', 60]]) {
      await clear(303);
      await page.evaluate(([id, source]) => {
        const { ctx } = window.__op2;
        const seen = (window.__rounds = []);
        const spawn = ctx.combat.spawnProjectile.bind(ctx.combat);
        window.__unspawn = () => { ctx.combat.spawnProjectile = spawn; };
        ctx.combat.spawnProjectile = spec => { if (spec.source === source) seen.push([...spec.origin.toArray(), ...spec.velocity.toArray()].map(n => Math.round(n * 1000) / 1000)); spawn(spec); };
        window.__before = window.__draws.n;
        ctx.progression.callInsManager.fly(id);
      }, [id, source]);
      await steady.frames(page, wait);
      out.strikes[id] = await page.evaluate(() => {
        window.__unspawn();
        const m = window.__op2.ctx.progression.callInsManager;
        const last = m.strikes.at(-1);
        return { rounds: window.__rounds, drawsAtCall: window.__before, yaw: last && 'yawNow' in last ? Math.round(last.yawNow * 1e6) / 1e6 : null };
      });
    }

    // ---- 4. A tank that goes up inside the hit: what the round tells the shooter ------------------------------------
    await clear(404);
    out.tank = await page.evaluate(() => {
      const { ctx } = window.__op2, V = ctx.player.position.constructor;
      const s = ctx.world.playerSpawns[0];
      const ahead = d => { const p = new V(s.position.x - Math.sin(s.yaw) * d, s.position.y, s.position.z - Math.cos(s.yaw) * d); const q = p.clone(); return ctx.world.nav.nearest(p, 4, q) ? q : p; };
      const still = e => { e.behaviours = []; e.attacks = []; e.mode = 'hold'; e.dummy = true; return e; };
      const bomber = still(ctx.enemies.spawn('bomber', ahead(9)));
      const by = ahead(9); by.x += 1.6;
      const husk = still(ctx.enemies.spawn('husk', by));
      husk.health = husk.maxHealth = 100000;
      const said = (window.__said = []);
      ctx.audio.play = id => { said.push(`s:${id}`); };
      const mark = ctx.hud.hitMarker.bind(ctx.hud);
      ctx.hud.hitMarker = k => { said.push(`m:${k}`); mark(k); };
      ctx.weapons.refillMagazines();
      window.__tank = { bomber, husk };
      const aim = () => {
        if (!bomber.alive) { ctx.input.simulate('fire', false); return; }
        requestAnimationFrame(aim);
        const d = bomber.center.clone().sub(ctx.player.eye);
        ctx.player.yaw = Math.atan2(-d.x, -d.z); ctx.player.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
        ctx.input.simulate('fire', true);
      };
      requestAnimationFrame(aim);
      return { weapon: ctx.weapons.current, bomberHp: bomber.health };
    });
    await steady.frames(page, 240);
    Object.assign(out.tank, await page.evaluate(() => {
      const { ctx } = window.__op2;
      ctx.input.simulate('fire', false);
      const keep = /^(s:(bullet_body|machine_hit|headshot|headshot_puff|headshot_crack|kill_body|hit_marker|hit_marker_head|hit_marker_kill|limb_sever|impact_armor|enemy_explode)|m:)/;
      return { bomberAlive: window.__tank.bomber.alive, huskHurt: window.__tank.husk.health < 100000, said: window.__said.filter(x => keep.test(x)) };
    }));
  } catch (error) {
    out.errors.push(String(error?.stack ?? error));
  }
  writeFileSync(`${outDir}/solo-${name}.json`, JSON.stringify(out, null, 1));
  return { name, errors: out.errors, samples: out.run.length, last: out.run.at(-1), pod: out.pod?.seen?.find(s => s?.phase === 'falling'), strikes: Object.fromEntries(Object.entries(out.strikes ?? {}).map(([k, v]) => [k, v.rounds.length])), tank: out.tank?.said?.length };
}
