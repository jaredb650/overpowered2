// The katana's stab and combo moves in the real game on the Test Range: real mouse through pointer lock, Troopers with AI
// off, real gore. Each move is played with its real inputs, the world is frozen at a chosen moment for a still, and what
// each one struck is reported.
//
//   node tools/shot.mjs --url "/?map=range" --script tools/scripts/katana-live.mjs --wait 500 --timeout 300 \
//     --dpr 2 --w 1440 --h 900 --out tools/out/katana/live.png
//
// KATANA_ONLY=stab,lock,cleave,tornado,wave,burst,flurry reruns named moves. KATANA_AT=n,n freezes at other moments: rendered
// frames after the last input's attack starts, so a slow machine still catches the move.
const only = (process.env.KATANA_ONLY ?? '').split(',').filter(Boolean);
const wants = step => only.length === 0 || only.includes(step);

export default async function katanaLive(page, h) {
  for (let i = 0; i < 180; i++) {
    if (await page.evaluate(() => !!window.__lab && window.__op2?.game?.state === 'playing')) break;
    await h.sleep(500);
  }
  await page.evaluate(() => {
    const { ctx } = window.__op2;
    window.frame = () => new Promise(r => requestAnimationFrame(r));
    window.world = async seconds => {
      const end = ctx.time.elapsed + seconds;
      while (ctx.time.elapsed < end) await window.frame();
    };
    window.hits = [];
    ctx.events.on('enemy:hit', e => window.hits.push(e.damage.source));
    window.kills = [];
    ctx.events.on('enemy:killed', k => window.kills.push(`${k.damage.source}${k.sliced ? '/sliced' : ''}`));
    window.start = ctx.player.position.clone();
    window.startYaw = ctx.player.yaw;
    // Troopers with AI off at [ahead, right, health] from the player, after a wipe and a walk home.
    window.stand = async (spots, keep) => {
      ctx.enemies.reset();
      if (!keep) window.__lab.spawner.clearBodies();
      window.hits.length = 0;
      window.kills.length = 0;
      ctx.player.teleport(window.start, window.startYaw);
      ctx.player.pitch = -0.08;
      await window.world(0.3);
      const f = ctx.player.forward.clone().setY(0).normalize();
      const r = f.clone().set(-f.z, 0, f.x);
      for (const [a, s, hp] of spots) {
        const at = ctx.player.position.clone().addScaledVector(f, a).addScaledVector(r, s);
        at.y = ctx.player.position.y;
        const e = window.__lab.spawner.place('trooper', at, 'off');
        if (e && hp) e.health = e.maxHealth = hp;
      }
      await window.world(0.5);
    };
    window.freeze = on => { ctx.time.paused = on; };
    // Armed with a frame count, the next attack freezes the world that many rendered frames after it starts.
    window.arm = 0;
    window.frozen = false;
    ctx.events.on('weapon:fired', async () => {
      const n = window.arm;
      if (!n) return;
      window.arm = 0;
      for (let i = 0; i < n; i++) await window.frame();
      window.freeze(true);
      window.frozen = true;
    });
    window.thaw = async n => {
      window.freeze(false);
      for (let i = 0; i < n; i++) await window.frame();
      window.freeze(true);
    };
    window.report = () => ({ hits: [...window.hits], kills: [...window.kills], moved: +ctx.player.position.distanceTo(window.start).toFixed(2) });
  });
  const out = {};
  await page.mouse.click(400, 500);
  await h.sleep(500);
  await page.evaluate(async () => {
    window.__lab.draw('sword');
    await window.world(0.6);
  });

  const press = async (button, ms = 40) => {
    await page.mouse.down({ button });
    await h.sleep(ms);
    await page.mouse.up({ button });
  };
  /** Plays `inputs` (s a slash, t a stab) a beat apart, then freezes the world `at` ms after the last for each still. */
  const play = async (name, spots, inputs, at, keep = false) => {
    await page.evaluate(([s, k]) => window.stand(s, k), [spots, keep]);
    const marks = (process.env.KATANA_AT ?? '').split(',').filter(Boolean).map(Number);
    const times = marks.length ? marks : at;
    for (let i = 0; i < inputs.length; i++) {
      if (i === inputs.length - 1) await page.evaluate(n => { window.arm = n; window.frozen = false; }, times[0]);
      await press(inputs[i] === 's' ? 'left' : 'right');
      if (i < inputs.length - 1) await h.sleep(260);
    }
    for (let i = 0; i < 100 && !(await page.evaluate(() => window.frozen)); i++) await h.sleep(50);
    for (let i = 0; i < times.length; i++) {
      if (i > 0) await page.evaluate(n => window.thaw(n), times[i] - times[i - 1]);
      await h.shot(`${name}-${i + 1}`);
    }
    await page.evaluate(() => window.freeze(false));
    await h.sleep(900);
    out[name] = await page.evaluate(() => window.report());
  };

  if (wants('stab')) await play('stab', [[3.4, 0]], 't', [1, 3]);
  if (wants('lock')) await play('lock', [[5.2, 0.5]], 'st', [1, 3]);
  // Past the slashes, so the two slashes cut air and the stab locks on and dashes into the cleave.
  if (wants('cleave')) await play('cleave', [[4.6, 0, 180]], 'sst', [2, 4, 7]);
  if (wants('tornado')) await play('tornado', [[1.9, 0, 290], [0.2, 2.2], [0.2, -2.2], [-1.8, 0.3]], 'ssst', [1, 3]);
  if (wants('wave')) await play('wave', [[7, 0], [11, 0.8], [15, -0.6]], 'tts', [2, 5, 9]);
  if (wants('burst')) {
    // A wall across the line, 0.6 of the way to where the crosshair meets the floor: the flying slash goes off on it.
    await page.evaluate(() => window.stand([]));
    await page.evaluate(() => window.__lab.spawner.wall());
    await play('burst', [[6, 0], [9, 0.6]], 'tts', [3, 6, 10], true);
  }
  if (wants('flurry')) await play('flurry', [[2.4, 0, 400]], 'stt', [2, 4, 7]);
  return out;
}
