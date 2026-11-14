// Foreclosure's beats 1 to 6 in real Chrome, played by a bot from the gunship to the courier going down (stage 9 of
// docs/proposals/mission-2-plan.md). The overwatch is flown: the seat swings onto the men, cycles the guns, drops the glide bomb on the
// fuel farm and throws flares at every launch. On foot the bot is a god who watches each set piece, then clears the beat's tags: the
// sniper's wound, the wall guns manned, the breaching charge, the market's lost Bailiff, the courier shot down. The war is sampled all
// the way (frame, draws, triangles, men on both sides) and the feed's call-outs are kept.
//
//   node tools/shot.mjs --url "/?contract=foreclosure&beat=overwatch&autostart=1" --script tools/scripts/foreclosure-live.mjs \
//     --out tools/out/foreclosure1/f.png --wait 500 --timeout 700 --dpr 2 --w 1440 --h 900
export default async function foreclosureLive(page, h) {
  const out = { beats: {}, samples: {}, feed: [], errors: [] };
  page.on('pageerror', e => out.errors.push(String(e)));
  const shot = h.shot;
  h.shot = name => Promise.race([shot(name), h.sleep(9000)]).catch(() => out.errors.push(`no shot ${name}`));

  const read = () => page.evaluate(() => {
    const op2 = window.__op2;
    const d = op2?.campaign?.runner?.describe();
    if (!d) return null;
    const { ctx } = op2;
    return { beat: d.beat, tags: d.tags, objectives: d.objectives, parked: ctx.player.parked, allies: ctx.allies?.allies.length ?? 0, alive: ctx.enemies.alive.length };
  });
  const until = async (test, seconds, what) => {
    for (let t = 0; t < seconds * 2; t++) {
      const d = await read();
      if (d && test(d)) return d;
      await h.sleep(500);
    }
    throw new Error(`timed out waiting for ${what}: ${JSON.stringify(await read())}`);
  };
  const god = () => page.evaluate(() => {
    setInterval(() => { const p = window.__op2?.ctx?.player; if (p?.modifiers) p.modifiers.invulnerable = true; }, 100);
    const { ctx, campaign } = window.__op2;
    window.bot = { feed: [], kills: 0, locks: 0, launches: 0, flares: 0, signals: [] };
    const signal = campaign.runner.signal.bind(campaign.runner);
    campaign.runner.signal = name => { window.bot.signals.push(name); signal(name); };
    ctx.events.on('comms:line', e => window.bot.feed.push(`${e.speaker ?? e.squad}: ${e.text}`));
    ctx.events.on('enemy:killed', e => { if (String(e.damage.source).startsWith('ac130')) window.bot.kills++; });
    const play = ctx.audio.play.bind(ctx.audio);
    ctx.audio.play = (id, o) => {
      if (id === 'aa_launch') {
        window.bot.launches++;
        // A pilot's answer: flares on the launch tone.
        ctx.input.simulate('jump', true);
        setTimeout(() => ctx.input.simulate('jump', false), 120);
        window.bot.flares++;
      }
      if (id === 'aa_lock') window.bot.locks++;
      return play(id, o);
    };
  });
  const sample = (beat) => page.evaluate(b => {
    const { ctx, game } = window.__op2;
    const s = window.__op2.stats();
    const allies = ctx.allies?.allies ?? [];
    // What the draws are: skinned men (alive or dead), and everything else that is drawn.
    let skinned = 0, meshes = 0;
    ctx.render.scene.traverseVisible(o => { if (o.isMesh || o.isPoints || o.isLine) { meshes++; if (o.isSkinnedMesh) skinned++; } });
    return { skinned, meshes, b, fps: s.fps, cpu: s.cpuMs, draws: s.drawCalls, tris: s.triangles, enemies: ctx.enemies.alive.length, allies: allies.length, detached: allies.filter(a => a.detached).length, allyMs: ctx.allies?.cpuMs ?? 0, corpses: ctx.gore.stats?.().corpses ?? 0, state: game.state };
  }, beat);
  const watch = async (beat, seconds) => {
    const list = (out.samples[beat] ??= []);
    for (let t = 0; t < seconds; t += 2) {
      list.push(await sample(beat));
      await h.sleep(2000);
    }
  };
  const kill = (...tags) => page.evaluate(names => {
    const { ctx, campaign } = window.__op2;
    const host = campaign.host;
    const point = ctx.player.position.clone();
    for (const e of [...ctx.enemies.alive]) {
      if (names.length && !names.includes(host.tagOf.get(e.uid))) continue;
      ctx.enemies.applyDamage(e, { amount: 1e6, type: 'true', point: e.center.clone(), dir: point.clone().set(0, 0, 1), force: 0, source: 'smg' });
    }
    for (const v of [...(ctx.enemies.vehicles?.live ?? [])]) if (!names.length || names.includes(v.tag)) v.take(1e6, null, 'rocket', v.position);
  }, tags);
  const clear = async (beat, seconds, ...tags) => {
    for (let t = 0; t < seconds; t++) {
      const d = await read();
      if (d?.beat !== beat) return d;
      await kill(...tags);
      await h.sleep(1000);
    }
    throw new Error(`still in ${beat}: ${JSON.stringify(await read())}`);
  };
  const tp = (x, y, z, yaw) => page.evaluate(([x, y, z, yaw]) => {
    const { player } = window.__op2.ctx;
    player.teleport(player.position.clone().set(x, y, z), yaw);
  }, [x, y, z, yaw]);
  const face = (x, y, z) => page.evaluate(([x, y, z]) => {
    const p = window.__op2.ctx.player;
    const dx = x - p.eye.x, dy = y - p.eye.y, dz = z - p.eye.z;
    p.yaw = Math.atan2(-dx, -dz);
    p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  }, [x, y, z]);
  const key = async (action, ms = 120) => {
    await page.evaluate(a => window.__op2.ctx.input.simulate(a, true), action);
    await h.sleep(ms);
    await page.evaluate(a => window.__op2.ctx.input.simulate(a, false), action);
  };
  const fire = on => page.evaluate(on => window.__op2.ctx.input.simulate('fire', on), on);
  /** The sight onto the thickest knot of men (or the point given), the way a player sweeps it. */
  const aim = (at) => page.evaluate(at => {
    const { ctx } = window.__op2;
    const s = ctx.progression.callInsManager.seats.seat;
    if (!s) return null;
    const eye = s.view.position;
    let best = at ? { center: { x: at[0], y: at[1], z: at[2] } } : null;
    if (!best) {
      let most = 0;
      for (const e of ctx.enemies.alive) {
        let n = 0;
        for (const o of ctx.enemies.alive) if (o.position.distanceTo(e.position) < 8) n++;
        if (n > most || (n === most && Math.random() < 0.3)) { most = n; best = e; }
      }
    }
    if (!best) return null;
    const dx = best.center.x - eye.x, dy = best.center.y - eye.y, dz = best.center.z - eye.z;
    s.yaw = Math.atan2(-dx, -dz);
    s.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    return true;
  }, at ?? null);
  const feed = async () => { out.feed.push(...(await page.evaluate(() => window.bot.feed.splice(0)))); };

  try {
  // ---- 2. overwatch: flown -------------------------------------------------------------------------------------------
  await until(d => d.beat === 'overwatch', 90, 'overwatch');
  await god();
  await h.sleep(11000);
  await h.shot('1-overwatch-station');
  const guns = ['weapon1', 'weapon2', 'weapon3', 'weapon2'];
  const start = Date.now();
  let bombed = false, shots = 0;
  for (let i = 0; Date.now() - start < 115000; i++) {
    const d = await read();
    if (d?.beat !== 'overwatch' || !d.parked) break;
    const secs = (Date.now() - start) / 1000;
    if (!bombed && secs > 38) {
      // The glide bomb on the fuel farm, the laser held on it all the way down.
      bombed = true;
      await key('weapon4');
      await aim([151, 2, 66]);
      await key('fire', 200);
      for (let k = 0; k < 14; k++) { await aim([151, 2, 66]); await h.sleep(500); }
      await h.shot('3-overwatch-bomb');
      continue;
    }
    await key(guns[i % guns.length]);
    await aim();
    await fire(true);
    for (let k = 0; k < 4; k++) { await h.sleep(500); await aim(); }
    await fire(false);
    (out.samples.overwatch ??= []).push(await sample('overwatch'));
    if (secs > 18 && shots === 0) { shots++; await h.shot('2-overwatch-fight'); }
    if (secs > 70 && shots === 1) { shots++; await h.shot('4-overwatch-late'); }
  }
  out.beats.overwatch = await page.evaluate(() => ({ kills: window.bot.kills, locks: window.bot.locks, launches: window.bot.launches, flares: window.bot.flares }));
  await feed();

  // ---- 3. landing ----------------------------------------------------------------------------------------------------
  await until(d => d.beat === 'landing', 60, 'landing');
  await h.sleep(3000);
  await face(84, 1, 76);
  await h.shot('5-landing');
  await watch('landing', 16);
  out.beats.landing = await page.evaluate(() => (window.__op2.ctx.allies?.allies ?? []).filter(a => !a.detached).map(a => `${a.type}:${a.state}`));
  await h.shot('6-landing-wounded');
  // The stim into the downed man, as the hint asks.
  out.beats.revived = await page.evaluate(() => {
    const { ctx, campaign } = window.__op2;
    const down = campaign.host.squadMen.find(a => a.state === 'down');
    return down ? ctx.allies.playerRevive(down) : 'nobody down';
  });
  await feed();
  await clear('landing', 40, 'shacks', 'sniper', 'technical.west', 'technical.east');

  // ---- 4. wall -------------------------------------------------------------------------------------------------------
  await until(d => d.beat === 'wall', 30, 'wall');
  await h.sleep(4000);
  await tp(62, 0, 66, 0);
  await face(40, 3, 48);
  await watch('wall', 8);
  out.beats.guns = await page.evaluate(() => {
    const all = window.__op2.ctx.progression.callInsManager.emplacements.all;
    return all.map(g => ({ hostile: g.hostile, manned: !!g.occupant, heat: Number(g.heat.value.toFixed(2)) }));
  });
  await h.shot('7-wall-guns');
  // Under the wall: the charge goes on.
  await tp(58, 0, 56, 0);
  await face(55, 1.5, 51);
  await h.sleep(6000);
  await h.shot('8-wall-charge');
  out.beats.charge = 'none';
  for (let t = 0; t < 40; t++) {
    const breached = await page.evaluate(() => window.bot.signals.includes('war:breached'));
    if (breached) {
      out.beats.charge = `breached at ${t}s`;
      break;
    }
    if (t === 14) await h.shot('8b-wall-charge-set');
    await h.sleep(1000);
  }
  await h.shot('9-wall-breach');
  if (out.beats.charge === 'none') {
    // The other way in: the gate's 400, as five rockets would.
    await page.evaluate(() => window.__op2.ctx.world.objects.damageExplosivesInRadius(new window.__op2.ctx.player.position.constructor(70, 1, 50), 3, 2000, 'rocket'));
    await h.sleep(1000);
    out.beats.charge = `gate blown instead: ${await page.evaluate(() => window.bot.signals.includes('war:breached'))}`;
  }
  await feed();
  await clear('wall', 60, 'wallGun.west', 'wallGun.east');
  out.beats.wall = { ...(await read()), signals: await page.evaluate(() => window.bot.signals) };

  // ---- 5. market -----------------------------------------------------------------------------------------------------
  await until(d => d.beat === 'market', 30, 'market');
  await tp(56, 0, 40, Math.PI / 2);
  await face(48, 1.5, 29);
  await h.sleep(3000);
  await h.shot('10-market');
  await watch('market', 22);
  await h.shot('11-market-lost');
  out.beats.market = await page.evaluate(() => window.__op2.campaign.host.squadMen.map(a => `${a.type}:${a.state}`));
  await feed();
  await clear('market', 60, 'lanes', 'roof.west', 'roof.north', 'roof.east');

  // ---- 6. courier ----------------------------------------------------------------------------------------------------
  await until(d => d.beat === 'courier', 30, 'courier');
  await tp(72, 0, 24, 0);
  await face(88, 45, -25);
  for (let t = 0; t < 40; t++) {
    const d = await read();
    if (d?.beat !== 'courier') break;
    const ship = await page.evaluate(() => { const c = window.__op2.campaign.host.courier; return c.ship ? [c.ship.position.x, c.ship.position.y, c.ship.position.z].map(Math.round) : null; });
    if (ship) await face(ship[0], ship[1], ship[2]);
    if (t === 8 || t === 13 || t === 18) await h.shot(`12-courier-${t}`);
    (out.samples.courier ??= []).push(await sample('courier'));
    await h.sleep(1000);
  }
  await face(124, 0, -84);
  await h.sleep(1500);
  await h.shot('13-courier-smoke');
  await feed();
  out.beats.after = await read();
  } catch (err) {
    out.errors.push(String(err));
  }

  const summary = {};
  for (const [beat, list] of Object.entries(out.samples)) {
    const fps = list.map(s => s.fps).sort((a, b) => a - b);
    summary[beat] = {
      fpsMin: fps[0], fpsMedian: fps[Math.floor(fps.length / 2)], cpuMax: Math.max(...list.map(s => s.cpu)), drawsMax: Math.max(...list.map(s => s.draws ?? 0)),
      trisMax: Math.max(...list.map(s => s.tris ?? 0)), enemiesMax: Math.max(...list.map(s => s.enemies)), alliesMax: Math.max(...list.map(s => s.allies)),
      detachedMax: Math.max(...list.map(s => s.detached)), allyMsMax: Math.max(...list.map(s => s.allyMs)),
      corpsesMax: Math.max(...list.map(s => s.corpses)), skinnedMax: Math.max(...list.map(s => s.skinned)), atMaxDraws: list.reduce((m, s) => ((s.draws ?? 0) > (m.draws ?? 0) ? s : m), {}),
    };
  }
  out.summary = summary;
  out.samples = undefined;
  return out;
}
