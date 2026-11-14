// Outpost Defense on the fort.
//
// DEFENSE_STEP=shops (default): the economy on real keys: the loadout, the break on the HUD, each shop's menu, a purchase, a weapon
// refused under fire, and a lost shop with its rebuild.
//   node tools/shot.mjs --url "/?contract=defense&autostart=1" --script tools/scripts/defense-live.mjs --wait 500 --timeout 240 --dpr 2 --w 1440 --h 900 --out tools/out/economy/x.png
//
// DEFENSE_STEP=waves: a bot plays waves 1, 4, 5 and 15 with the director: it holds the outer catwalk with an aimbot (health and
// ammunition topped up, so it lasts), lets wave 1's sappers set their charges before it shoots them, buys two mortar teams and a few
// allies, and photographs the charges, the breach, the enemy mortars, engineer work, the tank, a boss and the player's shells.
//   DEFENSE_STEP=waves node tools/shot.mjs --url "/?contract=defense&autostart=1" --script tools/scripts/defense-live.mjs --wait 500 --timeout 900 --dpr 2 --w 1440 --h 900 --out tools/out/defense/w.png
export default async function defenseLive(page, h) {
  if (process.env.DEFENSE_STEP === 'waves') return waves(page, h);
  return shops(page, h);
}

async function shops(page, h) {
  const screen = () => page.evaluate(() => window.__op2?.ctx?.hud?.screens?.name ?? null);
  const state = () => page.evaluate(() => {
    const { ctx, game } = window.__op2;
    const d = ctx.contracts.defense;
    return {
      game: game.state, screen: ctx.hud.screens.name, credits: d.credits, wave: ctx.waves.wave, phase: ctx.waves.phase,
      next: Math.round(ctx.waves.nextWaveIn), owned: [...ctx.weapons.owned], stims: ctx.progression.stims.count,
      callIns: [...ctx.progression.callIns], lost: Object.fromEntries(Object.entries(d.shops).map(([k, s]) => [k, s.lost])),
      squad: ctx.allies?.allies.length ?? 0,
    };
  });
  const until = async (test, tries = 120) => {
    for (let i = 0; i < tries; i++) {
      if (await test()) return true;
      await h.sleep(250);
    }
    return false;
  };
  const out = {};
  out.loadoutUp = await until(async () => (await screen()) === 'loadout', 240);
  await h.sleep(600);
  await h.shot('loadout');
  // Up from Deploy is the Rivet, then the Judge: pick the Judge, see the change, then back to the Rivet.
  out.focus = await page.evaluate(() => document.querySelector('.scr-loadout .focus')?.textContent);
  await h.press('ArrowUp', 60);
  await h.press('ArrowUp', 60);
  await h.press('Enter', 60);
  await h.sleep(200);
  out.withJudge = await page.evaluate(() => document.querySelector('.scr-loadout .sp-wallet')?.textContent);
  await h.shot('loadout-judge');
  await h.press('ArrowDown', 60);
  await h.press('Enter', 60);
  await h.press('ArrowDown', 60);
  out.deployFocus = await page.evaluate(() => document.querySelector('.scr-loadout .focus')?.textContent);
  await h.press('Enter', 60);
  out.playing = await until(async () => (await page.evaluate(() => window.__op2.game.state)) === 'playing', 40);
  await h.sleep(800);
  out.deployed = await state();
  await h.shot('break-hud');

  // The buyer's spot: the anchor itself on the fort, 1.6 m in front of the range's stand-in counter. He faces the counter.
  const visit = async (id, name) => {
    await page.evaluate(shop => {
      const { ctx } = window.__op2;
      const a = window.__defense.anchors[shop];
      const fort = ctx.waves.constructor.name === 'DefenseDirector';
      const back = fort ? 0 : 1.6;
      const at = a.position.clone();
      at.x -= Math.sin(a.yaw) * back;
      at.z -= Math.cos(a.yaw) * back;
      at.y += 0.1;
      ctx.player.teleport(at, a.yaw + Math.PI);
    }, id);
    await h.sleep(400);
    await h.shot(`${name}-counter`);
    await h.press('e', 80);
    return until(async () => (await screen()) === 'shop', 20);
  };
  const leave = async () => {
    await h.press('e', 80);
    await until(async () => (await page.evaluate(() => window.__op2.game.state)) === 'playing', 40);
    await h.sleep(300);
  };

  await page.evaluate(() => window.__defense.earn(4000));
  out.barracksOpen = await visit('barracks', 'barracks');
  await h.shot('barracks');
  await h.press('Enter', 60); // hires the rifleman on the first row
  await h.sleep(200);
  out.afterHire = await state();
  await h.shot('barracks-hired');
  await leave();

  out.armouryOpen = await visit('armoury', 'armoury');
  await h.shot('armoury');
  // Down to the first call-in and buy it.
  out.bought = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.scr-shop:not(.scr-loadout) .sp-row')];
    const i = rows.findIndex(r => r.textContent.startsWith('AIRSTRIKE'));
    rows[i].click();
    return document.querySelector('.scr-shop:not(.scr-loadout) .set-note')?.textContent;
  });
  await h.sleep(200);
  await h.shot('armoury-bought');
  await page.evaluate(() => document.querySelector('.scr-shop:not(.scr-loadout) .sh-body').scrollTo(0, 99999));
  await h.shot('armoury-bottom');
  await leave();
  out.afterArmoury = await state();

  out.infirmaryOpen = await visit('infirmary', 'infirmary');
  await h.shot('infirmary');
  await h.press('Enter', 60);
  await h.sleep(200);
  out.afterStim = await state();
  await leave();

  // A wave: weapons are refused under fire.
  await page.evaluate(() => window.__defense.skipBreak());
  await until(async () => (await page.evaluate(() => window.__op2.ctx.waves.phase)) !== 'intermission', 40);
  await h.sleep(1500);
  await h.shot('wave-hud');
  await visit('armoury', 'armoury-wave');
  out.underFire = await page.evaluate(() => [...document.querySelectorAll('.scr-shop:not(.scr-loadout) .sp-row')].slice(0, 3).map(r => r.textContent));
  await h.shot('armoury-wave');
  await leave();

  // Lose the infirmary and come back to it.
  await page.evaluate(() => window.__defense.damageShop('infirmary', 99999));
  await h.sleep(500);
  await h.shot('infirmary-lost-hud');
  await visit('infirmary', 'infirmary-lost');
  out.lostOffers = await page.evaluate(() => [...document.querySelectorAll('.scr-shop:not(.scr-loadout) .sp-row')].map(r => r.textContent));
  await h.shot('infirmary-lost');
  await leave();
  out.end = await state();
  return out;
}

/** The wave director with a bot on the walls. */
async function waves(page, h) {
  const out = { waves: [], misses: [] };
  // A slow frame can time a screenshot out on this machine. The run is worth more than any one picture.
  const shoot = h.shot;
  h = { ...h, shot: async name => { try { await shoot(name); } catch (e) { out.misses.push(`${name}: ${String(e).slice(0, 80)}`); } } };
  const until = async (test, ms) => {
    for (const end = Date.now() + ms; Date.now() < end;) {
      if (await test()) return true;
      await h.sleep(500);
    }
    return false;
  };
  await until(() => page.evaluate(() => window.__op2?.ctx?.hud?.screens?.name === 'loadout'), 60000);
  await h.sleep(600);
  await h.press('Enter', 60);
  await until(() => page.evaluate(() => window.__op2.game.state === 'playing'), 10000);
  await page.evaluate(() => {
    const { ctx } = window.__op2;
    const V = ctx.player.position.constructor;
    const d = window.__defense;
    d.earn(20000);
    window.bot = { on: false, spare: false, kills: 0 };
    ctx.events.on('enemy:killed', e => { if (e.damage.source === 'harrow') window.bot.kills++; });
    window.buys = [d.buy('barracks', { kind: 'mortar' }), d.buy('barracks', { kind: 'mortar' }),
      ...['rifleman', 'gunner', 'riot', 'rocketeer'].map(type => d.buy('barracks', { kind: 'ally', type }))];
    window.aimAt = (x, y, z) => {
      const p = ctx.player;
      const dx = x - p.eye.x, dy = y - p.eye.y, dz = z - p.eye.z;
      p.yaw = Math.atan2(-dx, -dz);
      p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    };
    /** Stands on the outer catwalk on the side of `x, z`, looking out. */
    window.post = (x, z) => {
      const side = Math.abs(x) > Math.abs(z) ? (x > 0 ? 1 : 3) : (z > 0 ? 2 : 0);
      let along = Math.max(-40, Math.min(40, side & 1 ? z : x));
      // No catwalk over a gate: the middle of each side is a hole down to the gate's passage.
      if (Math.abs(along) < 7) along = along < 0 ? -9 : 9;
      const at = [new V(along, 1.9, -50), new V(50, 1.9, along), new V(along, 1.9, 50), new V(-50, 1.9, along)][side];
      ctx.player.teleport(at, [0, -Math.PI / 2, Math.PI, Math.PI / 2][side]);
    };
    const sappers = () => new Set([...ctx.waves.siege.jobs.values()].filter(j => j.kind === 'sapper').map(j => j.s.e));
    setInterval(() => {
      const p = ctx.player;
      p.health = p.maxHealth;
      const w = ctx.weapons.ammo(ctx.weapons.current);
      if (w) w.reserve = w.maxReserve;
      if (!window.bot.on) return;
      const skip = window.bot.spare ? sappers() : new Set();
      let best = null, bestD = 95;
      for (const e of ctx.enemies.alive) {
        if (!e.alive || skip.has(e)) continue;
        const d = e.center.distanceTo(p.eye);
        if (d >= bestD) continue;
        const dir = e.center.clone().sub(p.eye).normalize();
        if (ctx.physics.raycast(p.eye, dir, d - 0.6)) continue;
        best = e;
        bestD = d;
      }
      window.bot.target = best ? best.id : null;
      if (best) window.aimAt(best.center.x, best.center.y + 0.1, best.center.z);
    }, 120);
  });
  out.buys = await page.evaluate(() => window.buys);
  const state = () => page.evaluate(() => {
    const { ctx } = window.__op2;
    const d = window.__defense;
    const pieces = ctx.world.objects.structures.filter(p => p.kind !== 'shack');
    return {
      t: Math.round(ctx.time.elapsed), ...ctx.waves.describe(), credits: d.credits, kills: window.bot.kills,
      shops: Object.fromEntries(Object.entries(d.shops).map(([k, s]) => [k, Math.round(s.health)])),
      walls: { damaged: pieces.filter(p => p.stage === 'damaged').length, breached: pieces.filter(p => p.stage === 'breached').length },
      allies: ctx.allies.allies.length, mortarRounds: d.mortars.fired,
    };
  });
  const fire = async on => {
    await page.evaluate(v => { window.bot.on = v; }, on);
    if (on) await page.mouse.down();
    else await page.mouse.up();
  };
  /** Plays the wave on for `ms` of wall time, or to its clear, logging every 6 s. */
  const play = async (label, ms, each) => {
    const log = [];
    const end = Date.now() + ms;
    while (Date.now() < end) {
      await h.sleep(3000);
      if (each) await each();
      const s = await state();
      log.push(s);
      if (s.phase === 'intermission' && s.wave > 0) break;
    }
    out.waves.push({ label, end: log[log.length - 1], log: log.filter((_, i) => i % 2 === 1).map(s => `t${s.t} ${s.phase} hostile ${s.hostile} queued ${s.queued} kills ${s.kills} ${JSON.stringify(s.siege.counts)} walls ${JSON.stringify(s.walls)} shops ${JSON.stringify(s.shops)}`) });
  };
  const fresh = async wave => {
    await fire(false);
    await page.evaluate(w => {
      const { ctx } = window.__op2;
      ctx.enemies.killAll('bot');
      ctx.waves.jumpTo(w);
    }, wave);
    await until(() => page.evaluate(() => window.__op2.ctx.waves.phase !== 'intermission'), 15000);
  };

  // ---- Wave 1: charges on the wall --------------------------------------------------------------------------------------------
  await page.evaluate(() => { window.__defense.skipBreak(); window.bot.spare = true; });
  await until(() => page.evaluate(() => window.__op2.ctx.enemies.alive.length > 0), 15000);
  await page.evaluate(() => { const e = window.__op2.ctx.enemies.alive[0]; window.post(e.position.x, e.position.z); });
  await fire(true);
  let shotCharge = false, shotBlast = false, holding = false;
  await play('wave 1', 150000, async () => {
    const r = await page.evaluate(() => {
      const { siege } = window.__op2.ctx.waves;
      const x = siege.satchels[0];
      if (x) { window.post(x.at.x, x.at.z); window.bot.on = false; window.aimAt(x.at.x, 0.2, x.at.z); }
      else window.bot.on = true;
      if (siege.counts.blown > 0) window.bot.spare = false;
      return { charge: !!x, blown: siege.counts.blown };
    });
    // Watching a charge, the trigger is off: a held trigger on it would set it off early.
    if (r.charge !== holding) {
      holding = r.charge;
      if (holding) await page.mouse.up();
      else await page.mouse.down();
    }
    if (r.charge && !shotCharge) {
      shotCharge = true;
      await h.sleep(300);
      await h.shot('w1-charge');
    }
    if (r.blown > 0 && !shotBlast) {
      shotBlast = true;
      await page.evaluate(() => {
        const p = window.__op2.ctx.world.objects.structures.find(s => s.kind !== 'shack' && s.stage !== 'intact');
        if (p) window.aimAt(p.spec.x, 1, p.spec.z);
      });
      await h.shot('w1-breach');
    }
  });

  // ---- Wave 4: mortar teams and engineers --------------------------------------------------------------------------------------
  await fresh(4);
  await page.evaluate(() => window.post(0, -60));
  await fire(true);
  let shotPit = false, shotWork = false, shotArc = false;
  await play('wave 4', 150000, async () => {
    const r = await page.evaluate(() => {
      const { ctx } = window.__op2;
      const { siege } = ctx.waves;
      const team = siege.teams.find(t => t.live && t.crew.stage !== 'moving');
      const work = siege.pads[0] ?? siege.covers[0];
      const arc = window.__defense.mortars.shells.list.find(s => s.live && s.mesh?.visible);
      return { team: team ? [team.pos.x, team.pos.z] : null, work: work ? [(work.at ?? work.out).x, (work.at ?? work.out).z] : null, arc: arc ? [arc.mesh.position.x, arc.mesh.position.y, arc.mesh.position.z] : null };
    });
    const look = async (at, name) => {
      await fire(false);
      await page.evaluate(([x, z]) => { window.post(x, z); window.aimAt(x, 0.6, z); }, at);
      await h.sleep(400);
      await h.shot(name);
      await fire(true);
    };
    if (r.team && !shotPit) { shotPit = true; await look(r.team, 'w4-mortar-pit'); }
    else if (r.work && !shotWork) { shotWork = true; await look(r.work, 'w4-engineer'); }
    else if (r.arc && !shotArc) {
      shotArc = true;
      await fire(false);
      await page.evaluate(([x, y, z]) => window.aimAt(x, y, z), r.arc);
      await h.shot('w4-our-shell');
      await fire(true);
    }
  });

  // ---- Wave 5: tanks -------------------------------------------------------------------------------------------------------------
  await fresh(5);
  await fire(true);
  let shotTank = false;
  out.frames = null;
  await play('wave 5', 120000, async () => {
    const tank = await page.evaluate(() => {
      const v = window.__op2.ctx.enemies.vehicles.live.find(x => x.alive && x.def.kind === 'tank');
      return v ? [v.position.x, v.position.z] : null;
    });
    if (tank && !shotTank) {
      shotTank = true;
      await fire(false);
      await page.evaluate(([x, z]) => { window.post(x, z); window.aimAt(x, 1.5, z); }, tank);
      await h.sleep(400);
      await h.shot('w5-tank');
      await fire(true);
      // Frame cost with the wave at its busiest: wall time between frames over 5 s, and the renderer's draw calls.
      out.frames = await page.evaluate(() => new Promise(done => {
        const { ctx } = window.__op2;
        const gaps = [];
        let last = performance.now();
        const end = last + 5000;
        const step = now => {
          gaps.push(now - last);
          last = now;
          if (now < end) requestAnimationFrame(step);
          else {
            gaps.sort((a, b) => a - b);
            const info = ctx.render.renderer.info.render;
            done({ frames: gaps.length, median: +gaps[gaps.length >> 1].toFixed(1), p95: +gaps[Math.floor(gaps.length * 0.95)].toFixed(1), calls: info.calls, triangles: info.triangles, enemies: ctx.enemies.alive.length, allies: ctx.allies.allies.length, vehicles: ctx.enemies.vehicles.live.length });
          }
        };
        requestAnimationFrame(step);
      }));
    }
  });

  // ---- Wave 15: the Juggernaut -----------------------------------------------------------------------------------------------------
  await fresh(15);
  await fire(true);
  let shotBoss = false;
  await play('wave 15', 90000, async () => {
    const b = await page.evaluate(() => {
      const e = window.__op2.ctx.enemies.alive.find(x => x.isBoss && x.entrance === 'none');
      return e ? [e.position.x, e.position.z, e.pathDist] : null;
    });
    if (b && !shotBoss) {
      shotBoss = true;
      await fire(false);
      await page.evaluate(([x, z]) => { window.post(x, z); window.aimAt(x, 2, z); }, b);
      await h.sleep(400);
      await h.shot('w15-juggernaut');
      await fire(true);
    }
  });
  await fire(false);
  out.final = await state();
  return out;
}
