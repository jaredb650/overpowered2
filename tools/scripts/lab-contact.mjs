// Proves heavies are solid and nothing traps or throws the player. A bot on the Test Range holds forward into bodies.
//   node tools/shot.mjs --url "/?map=range" --script tools/scripts/lab-contact.mjs --dpr 2 --w 1440 --h 900 --wait 500 --timeout 200 --out tools/out/contact.png
// CONTACT=walk,dash,slide,glance,jump,wall,titan,brutes,pack,charge,ring,knock runs only those. Left out, it runs all but `knock`,
// which runs only when named: a sprint at 12.5 m/s into a standing Trooper and a Husk, KNOCK_RUNS (10) times each, with
// whether it went down, where its hips came to rest along the run and the slowest the player went past it.
const only = (process.env.CONTACT ?? '').split(',').filter(Boolean);
const knockRuns = Number(process.env.KNOCK_RUNS ?? 10);

export default async function contactTest(page, h) {
  for (let i = 0; i < 180; i++) {
    if (await page.evaluate(() => !!window.__lab && window.__op2?.game?.state === 'playing')) break;
    await h.sleep(500);
  }
  return page.evaluate(async ({ only, knockRuns }) => {
    const wants = name => (only.length === 0 ? name !== 'knock' : only.includes(name));
    const lab = window.__lab;
    const { ctx } = window.__op2;
    const V = ctx.player.position.constructor;
    const P = ctx.player;
    const frame = () => new Promise(r => requestAnimationFrame(r));
    const until = async (test, seconds) => {
      const end = ctx.time.playerElapsed + seconds;
      while (ctx.time.playerElapsed < end && !test()) await frame();
    };
    P.modifiers.invulnerable = true;
    const clear = async () => {
      ctx.enemies.reset();
      lab.spawner.clearBodies();
      for (const a of ['forward', 'back', 'left', 'right', 'dash', 'slide', 'jump']) ctx.input.simulate(a, false);
      await until(() => false, 0.05);
    };
    const place = (id, x, z, ai = 'off') => lab.spawner.place(id, new V(x, 0, z), ai);

    /** Runs `seconds` of the bot and reports the worst of it against the body `e`, if there is one. */
    const watch = async (seconds, e, every) => {
      const r = { minGap: 99, topSpeed: 0, topY: 0, travelled: 0, stuck: 0 };
      const reach = e ? (e.def.contactRadius ?? e.def.radius) + 0.45 : 0;
      const last = P.position.clone();
      const end = ctx.time.playerElapsed + seconds;
      while (ctx.time.playerElapsed < end) {
        const t0 = ctx.time.playerElapsed;
        every?.();
        await frame();
        const dt = ctx.time.playerElapsed - t0;
        if (e?.alive) r.minGap = Math.min(r.minGap, Math.hypot(P.position.x - e.position.x, P.position.z - e.position.z) - reach);
        r.topSpeed = Math.max(r.topSpeed, Math.hypot(P.velocity.x, P.velocity.z));
        r.topY = Math.max(r.topY, P.position.y);
        const moved = P.position.distanceTo(last);
        r.travelled += moved;
        if (moved < 0.02 * Math.max(dt * 60, 1)) r.stuck += dt;
        last.copy(P.position);
      }
      for (const k of Object.keys(r)) r[k] = +r[k].toFixed(2);
      return r;
    };
    const start = (x, z, yaw) => {
      P.teleport(new V(x, 0.1, z), yaw);
      P.pitch = 0;
    };

    const out = {};
    for (const id of wants('walk') ? ['brute', 'juggernaut', 'titan'] : []) {
      await clear();
      const e = place(id, 0, 0);
      start(0, 14, 0);
      ctx.input.simulate('forward', true);
      out[`walk into ${id}`] = await watch(2, e);
      out[`walk into ${id}`].through = P.position.z < e.position.z;
      // Leaning on it: the view must sit still, not buzz.
      const zs = [];
      await watch(1, null, () => zs.push(P.position.z));
      const mean = zs.reduce((a, z) => a + z, 0) / zs.length;
      out[`walk into ${id}`].shakeMm = +(Math.sqrt(zs.reduce((a, z) => a + (z - mean) ** 2, 0) / zs.length) * 1000).toFixed(1);
    }

    if (wants('dash')) {
      await clear();
      const e = place('brute', 0, 0);
      start(0, 8, 0);
      ctx.input.simulate('forward', true);
      await until(() => P.speed > 10, 1);
      ctx.input.simulate('dash', true);
      const r = await watch(1.2, e);
      ctx.input.simulate('dash', false);
      r.through = P.position.z < e.position.z;
      out['dash into brute'] = r;
    }

    if (wants('slide')) {
      await clear();
      const e = place('brute', 0, 0);
      start(0, 8, 0);
      ctx.input.simulate('forward', true);
      await until(() => P.speed > 11, 1);
      ctx.input.simulate('slide', true);
      const r = await watch(1.5, e);
      ctx.input.simulate('slide', false);
      r.through = P.position.z < e.position.z;
      out['slide into brute'] = r;
    }

    if (wants('glance')) {
      await clear();
      // Aimed a little off centre: a run should slide round and go on, not stop dead.
      const e = place('brute', 0, 0);
      start(0.6, 12, 0);
      ctx.input.simulate('forward', true);
      const r = await watch(2.2, e);
      r.past = P.position.z < e.position.z - 1;
      out['glancing run at brute'] = r;
    }

    if (wants('jump')) {
      await clear();
      // A jump onto its shoulders must not stand the player there or throw them.
      const e = place('brute', 0, 0);
      start(0, 5, 0);
      ctx.input.simulate('forward', true);
      await until(() => Math.abs(P.position.z) < 3.2, 1.5);
      ctx.input.simulate('jump', true);
      await frame();
      ctx.input.simulate('jump', false);
      out['jump at brute'] = await watch(2, e);
    }

    if (wants('wall')) {
      await clear();
      // Backed against the wall with a Juggernaut stood in the way, then walking along the wall to get out.
      start(0, 24, 0);
      const e = place('juggernaut', 0, 24.2);
      const yawEast = -Math.PI / 2;
      P.yaw = yawEast;
      ctx.input.simulate('forward', true);
      const r = await watch(3, e);
      r.escaped = Math.abs(P.position.x) > 1.8;
      out['spawned inside juggernaut at a wall'] = r;
    }

    if (wants('titan')) {
      await clear();
      // A Titan walking at a player who stands with their back to a wall, then the player sidestepping out. Moved by
      // hand, because the nav graph stops a body short of the wall.
      const e = place('titan', 0, 14);
      start(0, 22, Math.PI);
      const walk = () => {
        if (e.position.z > 24.8) return e.velocity.set(0, 0, 0);
        e.velocity.set(0, 0, 3.6);
        e.position.z += 3.6 * Math.max(ctx.time.dt, 0);
      };
      const r = await watch(4.5, e, walk);
      r.playerZ = +P.position.z.toFixed(2);
      ctx.input.simulate('left', true);
      const after = await watch(2.2, e);
      r.freedTo = +P.position.x.toFixed(2);
      r.afterTopSpeed = after.topSpeed;
      out['titan walks player into wall'] = r;
    }

    if (wants('brutes')) {
      await clear();
      // Between two Brutes shoulder to shoulder with a wall behind.
      place('brute', -1.1, 23.4);
      place('brute', 1.1, 23.4);
      start(0, 24.9, 0);
      ctx.input.simulate('forward', true);
      const r = await watch(3, null);
      r.out = P.position.z < 22;
      out['pressed between two brutes at a wall'] = r;
    }

    for (const [name, from] of [['pack', 14], ['charge', 23]]) {
      if (!wants(name)) continue;
      await clear();
      // A run into a pack: light bodies give way, the Brute in the middle does not. Eleven husks, so a charge can put
      // them all on the floor inside gore's twelve knockdowns. The pack's front row leaves the run's line open, so the player
      // only meets two husks of the second, 0.6 m to either side, glancing at about 9 m/s toward them: a body check needs
      // nearer the middle than that. `charge` starts against the back wall, at full speed, with six husks a hand's width
      // either side of the line, five out to the sides and the Brute behind.
      const husks = [];
      if (name === 'pack') {
        for (let i = -3; i <= 3; i++) if (i !== 0) husks.push(place('husk', i * 1.2, 2));
        for (let i = -2; i <= 2; i++) husks.push(place('husk', i * 1.2 + 0.6, 0));
      } else {
        for (let i = 0; i < 6; i++) husks.push(place('husk', [0.15, -0.2, 0.05, 0.25, -0.1, -0.25][i], 6 - i * 1.4));
        for (let i = 0; i < 5; i++) husks.push(place('husk', (i % 2 ? -1 : 1) * 1.4, 5.3 - i * 1.4));
      }
      const brute = place('brute', 0.2, -3);
      const bruteZ = brute.position.z;
      start(0, from, 0);
      ctx.input.simulate('forward', true);
      const downed = new Set();
      let knockdowns = 0;
      let stepPeak = 0;
      const steps = [];
      // Every run ends at the range's back wall, so how far past the Brute is capped at 12.5 m: what a pack takes out of a run
      // is the slowest it goes from full speed until it is 3 m past the Brute.
      let fast = false;
      let slowest = 99;
      const r = await watch(from === 14 ? 4.5 : 5.2, brute, () => {
        const speed = Math.hypot(P.velocity.x, P.velocity.z);
        if (speed > 12) fast = true;
        if (fast && P.position.z > bruteZ - 3) slowest = Math.min(slowest, speed);
        for (const e of husks) if (e.downed) downed.add(e);
        const down = ctx.gore.stats().knockdowns;
        knockdowns = Math.max(knockdowns, down);
        stepPeak = Math.max(stepPeak, ctx.physics.stepMs);
        if (down > 0) steps.push(ctx.physics.stepMs);
      });
      steps.sort((a, b) => a - b);
      r.stepWhileDown = steps.length ? [steps[steps.length >> 1], steps[Math.floor(steps.length * 0.9)], steps.length].map(x => +x.toFixed(2)) : null;
      r.endZ = +P.position.z.toFixed(1);
      r.endX = +P.position.x.toFixed(1);
      r.pastBrute = +(bruteZ - P.position.z).toFixed(1);
      r.slowest = +slowest.toFixed(2);
      r.husksDown = downed.size;
      r.knockdowns = knockdowns;
      r.stepPeak = +stepPeak.toFixed(2);
      out[name === 'pack' ? 'run into a pack' : 'charge a pack from 23 m'] = r;
    }

    if (wants('knock')) {
      // A sprint into one standing body, head on to a hand's width either side. Its hips are read along the run from
      // where it stood, at the last frame gore had it, which is where it lay to get up.
      for (const id of ['trooper', 'husk']) {
        const runs = [];
        for (let i = 0; i < knockRuns; i++) {
          await clear();
          const e = place(id, 0, 0);
          const stood = e.position.clone();
          start(((i % 5) - 2) * 0.06, 18, 0);
          ctx.input.simulate('forward', true);
          await until(() => P.speed > 12.3, 2);
          const entry = +P.speed.toFixed(2);
          let down = false;
          let slowest = 99;
          let hit = -1;
          const lay = new V();
          await watch(3.2, null, () => {
            if (hit < 0 && e.lastBumpAt > 0) hit = ctx.time.playerElapsed;
            if (hit >= 0 && ctx.time.playerElapsed - hit < 0.4) slowest = Math.min(slowest, Math.hypot(P.velocity.x, P.velocity.z));
            const d = ctx.gore.downed(e.char);
            if (d) {
              down = true;
              lay.copy(d.center);
            }
          });
          ctx.input.simulate('forward', false);
          runs.push({ entry, down, along: down ? +(stood.z - lay.z).toFixed(2) : null, side: down ? +(lay.x - stood.x).toFixed(2) : null, slowest: +slowest.toFixed(2) });
        }
        const downs = runs.filter(r => r.down);
        const along = downs.map(r => r.along);
        out[`knock ${id}`] = {
          downed: `${downs.length}/${runs.length}`,
          along: along.length ? [Math.min(...along), +(along.reduce((a, b) => a + b, 0) / along.length).toFixed(2), Math.max(...along)] : null,
          slowest: Math.min(...runs.map(r => r.slowest)),
          runs,
        };
      }
    }

    if (wants('ring')) {
      await clear();
      // Hemmed in by a live pack with AI on, and running out of it.
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        place(i % 5 === 0 ? 'brute' : 'husk', Math.sin(a) * 3, 2 + Math.cos(a) * 3, 'on');
      }
      start(0, 2, 0);
      ctx.input.simulate('forward', true);
      const r = await watch(4, null);
      r.got = +Math.hypot(P.position.x, P.position.z - 2).toFixed(1);
      out['ringed by a live pack'] = r;
    }
    await clear();
    return out;
  }, { only, knockRuns });
}
