// Proves heavies are solid and nothing traps or throws the player. A bot on the Test Range holds forward into bodies.
//   node tools/shot.mjs --url "/?map=range" --script tools/scripts/lab-contact.mjs --wait 500 --timeout 200 --out tools/out/contact.png
export default async function contactTest(page, h) {
  for (let i = 0; i < 180; i++) {
    if (await page.evaluate(() => !!window.__lab && window.__op2?.game?.state === 'playing')) break;
    await h.sleep(500);
  }
  return page.evaluate(async () => {
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
      ctx.enemies.killAll('lab');
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
    for (const id of ['brute', 'juggernaut', 'titan']) {
      await clear();
      const e = place(id, 0, 0);
      start(0, 14, 0);
      ctx.input.simulate('forward', true);
      out[`walk into ${id}`] = await watch(3, e);
      out[`walk into ${id}`].through = P.position.z < e.position.z;
    }

    await clear();
    {
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

    await clear();
    {
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

    await clear();
    {
      // Aimed a little off centre: a run should slide round and go on, not stop dead.
      const e = place('brute', 0, 0);
      start(0.6, 12, 0);
      ctx.input.simulate('forward', true);
      const r = await watch(2.2, e);
      r.past = P.position.z < e.position.z - 1;
      out['glancing run at brute'] = r;
    }

    await clear();
    {
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

    await clear();
    {
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

    await clear();
    {
      // A Titan walking at a player who stands with their back to a wall.
      const e = place('titan', 0, 12, 'patrol');
      e.behaviours = [];
      e.mode = 'point';
      e.moveTarget.set(0, 0, 26);
      e.pace = 1;
      e.dummy = true;
      start(0, 24.8, Math.PI);
      const r = await watch(6, e);
      ctx.input.simulate('left', true);
      const after = await watch(2.5, e);
      r.escapeMoved = +Math.abs(P.position.x).toFixed(2);
      r.afterTopSpeed = after.topSpeed;
      out['titan walks player into wall'] = r;
    }

    await clear();
    {
      // Between two Brutes shoulder to shoulder with a wall behind.
      place('brute', -1.1, 23.4);
      place('brute', 1.1, 23.4);
      start(0, 24.9, 0);
      ctx.input.simulate('forward', true);
      const r = await watch(3, null);
      r.out = P.position.z < 22;
      out['pressed between two brutes at a wall'] = r;
    }

    await clear();
    {
      // A run into a pack: light bodies give way, the Brute in the middle does not.
      for (let i = -3; i <= 3; i++) if (i !== 0) place('husk', i * 1.2, 2);
      for (let i = -2; i <= 2; i++) place('husk', i * 1.2 + 0.6, 0);
      const brute = place('brute', 0.2, -3);
      start(0, 14, 0);
      ctx.input.simulate('forward', true);
      const r = await watch(4.5, brute);
      r.endZ = +P.position.z.toFixed(1);
      r.endX = +P.position.x.toFixed(1);
      out['run into a pack'] = r;
    }

    await clear();
    {
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
  });
}
