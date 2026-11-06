// The Outpost's machines on the Test Range: looks them over, then drives, fights and destroys each one, with the numbers to prove it.
//
//   node tools/shot.mjs --url "/?map=range" --script tools/scripts/vehicles-live.mjs --out tools/out/vehicles.png --wait 1500 --timeout 120
//   add --dpr 2 --w 1440 --h 900 for the owner's screen
//   VEHICLES_STEP=models|fight|air picks one part
export default async function vehiclesLive(page, h) {
  const step = process.env.VEHICLES_STEP ?? 'models';
  const log = {};
  const look = (px, py, pz, tx, ty, tz) => page.evaluate(([px, py, pz, tx, ty, tz]) => {
    const { player } = window.__op2.ctx;
    player.teleport(player.position.clone().set(px, py, pz));
    const dx = tx - px, dy = ty - (py + 1.6), dz = tz - pz;
    player.yaw = Math.atan2(-dx, -dz);
    player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  }, [px, py, pz, tx, ty, tz]);
  const park = (kind, x, z, yaw = 0) => page.evaluate(([kind, x, z, yaw]) => {
    const { enemies } = window.__op2.ctx;
    const v = enemies.vehicles.spawnGround(kind, { x, y: 0, z, route: [], tag: null, crew: [], crewTag: null, holds: false, holdYaw: NaN, parked: true });
    v.drive.yaw = yaw;
  }, [kind, x, z, yaw]);
  await page.waitForFunction(() => window.__op2?.ctx?.enemies?.vehicles && window.__op2.game.state === 'playing', null, { timeout: 100000 });
  await page.evaluate(() => { const b = window.__op2.ctx.world.bounds; window.__b = [b.min.x, b.min.z, b.max.x, b.max.z]; });
  log.bounds = await page.evaluate(() => window.__b);
  log.spawn = await page.evaluate(() => window.__op2.ctx.player.position.toArray());

  if (step === 'models') {
    await park('tank', 0, 0, 0.5);
    await park('truck', 12, -6, 0.5);
    await park('humvee', -11, -6, 0.5);
    await h.sleep(600);
    await look(3, 0, 18, 1, 1.6, -2);
    await h.sleep(700);
    await h.shot('models-row');
    await look(-6, 0, 8, 0, 1.6, 0);
    await h.sleep(500);
    await h.shot('models-tank');
    await look(6, 0, -13, 0, 1.6, 0);
    await h.sleep(500);
    await h.shot('models-tank-rear');
    await look(19, 0, 2, 12, 1.8, -6);
    await h.sleep(500);
    await h.shot('models-truck');
    await look(-18, 0, 0, -11, 1.2, -6);
    await h.sleep(500);
    await h.shot('models-humvee');
  }
  const read = () => page.evaluate(() => window.__op2.ctx.enemies.vehicles.describe());
  // A round from the player's eye at a world point, as a gun would fire it.
  const gun = (x, y, z, source, damage, n = 1) => page.evaluate(([x, y, z, source, damage, n]) => {
    const { ctx } = window.__op2;
    const o = ctx.player.eye.clone();
    const d = o.clone().set(x, y, z).sub(o).normalize();
    let end = null;
    for (let i = 0; i < n; i++) end = ctx.combat.fireRay(o, d, { damage, source, team: 'player', tracer: 'bullet' }).end.toArray();
    return end;
  }, [x, y, z, source, damage, n]);
  const rocket = (x, y, z) => page.evaluate(([x, y, z]) => {
    const { ctx } = window.__op2;
    const o = ctx.player.eye.clone();
    const d = o.clone().set(x, y, z).sub(o).normalize();
    ctx.combat.spawnProjectile({ origin: o, velocity: d.multiplyScalar(40), kind: 'rocket', team: 'player', damage: 100, source: 'rocket',
      explosion: { radius: 8, damage: 100, kind: 'rocket' }, trail: 'smoke', lifetime: 4 });
  }, [x, y, z]);
  const liveAt = i => page.evaluate(i => { const v = window.__op2.ctx.enemies.vehicles.live[i]; return v ? [v.position.x, v.position.y, v.position.z, v.drive?.yaw ?? 0] : null; }, i);

  if (step === 'fight') {
    // A truck drives in and lets its men out, shooting all the way.
    await look(-22, 0, 16, 10, 1.6, 10);
    await page.evaluate(() => {
      const { enemies } = window.__op2.ctx;
      enemies.vehicles.spawnGround('truck', { x: 24, y: 0, z: 12, route: [{ x: 8, z: 12, hold: 0 }, { x: -8, z: 4, hold: 0 }], tag: null,
        crew: ['trooper', 'gunner', 'trooper'], crewTag: null, holds: false, holdYaw: NaN, parked: false });
    });
    await h.sleep(1600);
    await h.shot('truck-moving');
    log.moving = await liveAt(0);
    await h.sleep(3400);
    log.stopped = await liveAt(0);
    await h.shot('truck-stopped');
    await h.sleep(1800);
    await h.shot('truck-crew');
    log.men = await page.evaluate(() => window.__op2.ctx.enemies.alive.map(e => [e.id, e.pinned, Math.round(e.position.x), Math.round(e.position.y * 10) / 10, Math.round(e.position.z)]));
    log.hurt = await page.evaluate(() => window.__op2.ctx.player.health);
    // Gunfire: the cab first, until the driver is gone, and on until it burns.
    const truck = await liveAt(0);
    await page.evaluate(() => { window.__fuel = 0; });
    await look(truck[0] - 16, 0, truck[2] + 4, truck[0], 1.8, truck[2]);
    await h.sleep(200);
    log.before = (await read()).live[0];
    await gun(truck[0], 1.7, truck[2], 'smg', 25, 16);
    await h.sleep(100);
    log.afterSmg = (await read()).live[0];
    await gun(truck[0], 1.7, truck[2], 'smg', 25, 24);
    await h.sleep(500);
    await h.shot('truck-burning');
    log.burning = (await read()).live[0];
    await h.sleep(5000);
    await h.shot('truck-gone');
    log.afterBurn = await read();
    // A tank: bullets, then a rocket on the track, then everything.
    await page.evaluate(() => {
      const { enemies } = window.__op2.ctx;
      enemies.vehicles.spawnGround('tank', { x: 24, y: 0, z: -10, route: [{ x: 4, z: -10, hold: 0 }], tag: null, crew: [], crewTag: null, holds: false, holdYaw: NaN, parked: false });
    });
    await look(-20, 0, 8, 10, 1.6, -10);
    await h.sleep(5000);
    await h.shot('tank-rolling');
    log.tankStop = await read();
    await h.sleep(3500);
    await h.shot('tank-laying');
    log.tankHealth = (await read()).live.at(-1);
    const tank = (await read()).live.at(-1);
    await gun(tank.x, 1.4, tank.z, 'smg', 25, 40);
    await h.sleep(100);
    log.tankAfterBullets = (await read()).live.at(-1);
    await rocket(tank.x, 0.8, tank.z);
    await h.sleep(1200);
    await h.shot('tank-hit');
    log.tankAfterRocket = (await read()).live.at(-1);
    for (let i = 0; i < 6; i++) {
      await rocket(tank.x, 1.3, tank.z);
      await h.sleep(900);
    }
    await h.shot('tank-blown');
    await h.sleep(900);
    await h.shot('tank-turret-flying');
    await h.sleep(2400);
    await h.shot('tank-wreck');
    log.end = await read();
  }
  if (step === 'wreck') {
    await park('truck', 8, -6, 0.4);
    await park('humvee', -8, -6, 0.4);
    await park('tank', 0, -14, 0.7);
    await h.sleep(300);
    await page.evaluate(() => {
      const v = window.__op2.ctx.enemies.vehicles;
      for (const x of [...v.live]) x.take(99999, null, 'lab', x.position);
    });
    await look(0, 0, 12, 0, 2, -9);
    await h.sleep(350);
    await h.shot('wrecks-blast');
    await h.sleep(5000);
    await look(16, 0, 2, 7, 1.4, -6);
    await h.sleep(300);
    await h.shot('wreck-truck');
    await look(-2, 0, -2, 1, 1.2, -13);
    await h.sleep(300);
    await h.shot('wreck-tank');
    log.wrecks = await read();
  }

  if (step === 'air') {
    const down = async (label, hurt) => {
      await page.evaluate(() => {
        const { enemies, player } = window.__op2.ctx;
        const a = player.position.clone().set(0, 40, -90);
        const m = [a.clone().set(0, 28, -24), a.clone().set(50, 28, 10), a.clone().set(-50, 28, 10)];
        enemies.vehicles.spawnChopper(a, m, null);
      });
      await h.sleep(8000);
      const face = () => page.evaluate(() => {
        const { ctx } = window.__op2;
        const c = ctx.player.position.clone();
        if (!ctx.enemies.vehicles.chopperAt(c)) return null;
        const p = ctx.player;
        const dx = c.x - p.eye.x, dy = c.y - p.eye.y, dz = c.z - p.eye.z;
        p.yaw = Math.atan2(-dx, -dz);
        p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
        return c.toArray().map(n => Math.round(n));
      });
      log[`${label}Flying`] = await face();
      await h.sleep(250);
      await h.shot(`${label}-flying`);
      await page.evaluate(hurt);
      for (let i = 0; i < 5; i++) {
        await h.sleep(650);
        await page.evaluate(() => {
          const { ctx } = window.__op2;
          const v = ctx.enemies.vehicles.live[0];
          const c = v ? v.position : ctx.enemies.vehicles.wrecks.at(-1).root.position;
          const p = ctx.player;
          const dx = c.x - p.eye.x, dy = c.y - p.eye.y, dz = c.z - p.eye.z;
          p.yaw = Math.atan2(-dx, -dz);
          p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
        });
        await h.sleep(60);
        await h.shot(`${label}-fall-${i}`);
      }
      await h.sleep(1600);
      log[`${label}After`] = await read();
    };
    await page.evaluate(() => { window.__op2.ctx.player.modifiers.invulnerable = true; });
    await down('tail', () => {
      const { enemies } = window.__op2.ctx;
      const v = enemies.vehicles.live[0];
      const tail = v.parts.find(p => p.def.id === 'tail');
      enemies.vehicles.direct(tail.collider, v.position, 100, 'rocket', 'rocket');
    });
    await down('cockpit', () => {
      const { enemies } = window.__op2.ctx;
      const v = enemies.vehicles.live[0];
      const part = v.parts.find(p => p.def.id === 'cockpit');
      enemies.vehicles.direct(part.collider, v.position, 99999, 'shell', 'autocannon');
    });
  }

  if (step === 'dogfight') {
    await page.evaluate(() => {
      const { ctx } = window.__op2;
      ctx.player.modifiers.invulnerable = true;
      const a = ctx.player.position.clone().set(0, 40, -60);
      ctx.enemies.vehicles.spawnChopper(a, [a.clone().set(0, 28, -24), a.clone().set(40, 28, 10)], null);
      ctx.progression.boardCallIn('doorGunner');
    });
    const seat = () => page.evaluate(() => {
      const { ctx } = window.__op2;
      const v = ctx.enemies.vehicles;
      const c = ctx.player.position.clone();
      const on = v.chopperAt(c);
      return { chopper: on ? c.toArray().map(n => Math.round(n)) : null, parked: ctx.player.parked, friendly: v.friendly?.position.toArray().map(n => Math.round(n)) ?? null, health: v.live[0]?.health };
    });
    await h.sleep(6000);
    log.seat1 = await seat();
    await h.shot('dogfight-1');
    await h.sleep(5000);
    log.seat2 = await seat();
    await h.shot('dogfight-2');
    // The gunner's M134 on its thin skin.
    log.doorGun = await page.evaluate(() => {
      const { ctx } = window.__op2;
      const v = ctx.enemies.vehicles.live[0];
      const part = v.parts.find(p => p.def.id === 'cockpit');
      const before = v.health;
      for (let i = 0; i < 30; i++) ctx.enemies.vehicles.shot(part.collider, v.position, 13, 'door_gun');
      const body = v.parts.find(p => p.def.id === 'body');
      const mid = v.health;
      for (let i = 0; i < 30; i++) ctx.enemies.vehicles.shot(body.collider, v.position, 13, 'door_gun');
      return { before, mid, after: v.health };
    });
  }

  const describe = () => page.evaluate(() => ({ run: window.__op2.campaign?.runner.describe(), v: window.__op2.ctx.enemies.vehicles.describe(), men: window.__op2.ctx.enemies.alive.length, hp: window.__op2.ctx.player.health }));
  const face = (px, py, pz, tx, ty, tz) => look(px, py, pz, tx, ty, tz);

  // The real map: ?mission=outpost&contract=outpost&map=outpost&autostart=1&beat=soft
  if (step === 'soft') {
    await page.evaluate(() => { window.__op2.ctx.player.modifiers.invulnerable = true; });
    await face(30, 0, 30, 50, 1.5, 34);
    await h.sleep(5000);
    log.t5 = await describe();
    await h.shot('soft-5');
    await h.sleep(5000);
    log.t10 = await describe();
    await h.shot('soft-10');
    await h.sleep(6000);
    log.t16 = await describe();
    await face(14, 0, 28, 26, 1.5, 34);
    await h.sleep(400);
    await h.shot('soft-16');
  }
  if (step === 'heavy') {
    await page.evaluate(() => { window.__op2.ctx.player.modifiers.invulnerable = true; });
    await face(30, 0, 44, 60, 1.5, 34);
    await h.sleep(9000);
    log.t9 = await describe();
    await h.shot('heavy-9');
    await h.sleep(9000);
    log.t18 = await describe();
    await h.shot('heavy-18');
    await h.sleep(9000);
    log.t27 = await describe();
    await h.shot('heavy-27');
  }
  if (step === 'turn') {
    await page.evaluate(() => { window.__op2.ctx.player.modifiers.invulnerable = true; });
    const kill = kind => page.evaluate(k => {
      const v = window.__op2.ctx.enemies.vehicles;
      const x = v.live.find(x => x.def.kind === k);
      if (x) x.take(1e6, null, 'rocket', x.position);
      return !!x;
    }, kind);
    await h.sleep(6000);
    log.opening = await describe();
    await kill('tank');
    await h.sleep(9000);
    log.bird = await describe();
    const air = (await read()).live.find(v => v.kind === 'chopper');
    if (air) { await face(0, 0, 30, air.x, air.y, air.z); await h.sleep(400); await h.shot('turn-bird'); }
    await kill('tank');
    await h.sleep(700);
    await page.evaluate(() => {
      const v = window.__op2.ctx.enemies.vehicles;
      const x = v.live.find(x => x.def.kind === 'chopper');
      const part = x?.parts.find(p => p.def.id === 'rotor');
      if (part) { v.direct(part.collider, x.position, 100, 'rocket', 'rocket'); v.direct(part.collider, x.position, 100, 'rocket', 'rocket'); }
    });
    await h.sleep(5000);
    log.afterBird = await describe();
    await face(4, 0, 34, 0, 2, 10);
    await h.sleep(6000);
    log.bulwarkIn = await describe();
    await h.shot('turn-bulwark');
    await h.sleep(9000);
    log.bulwarkHeld = await page.evaluate(() => {
      const v = window.__op2.ctx.enemies.vehicles.live.find(x => x.def.kind === 'tank');
      return v ? { x: v.drive.x, z: v.drive.z, yaw: v.drive.yaw, done: v.drive.done } : null;
    });
    await h.shot('turn-bulwark-held');
    await kill('tank');
    await h.sleep(3000);
    await h.shot('turn-wreck');
    log.end = await describe();
    // Dies at the next checkpoint: the wreck has to be back in the gate afterwards.
    await page.evaluate(() => { const { player } = window.__op2.ctx; player.modifiers.invulnerable = false; player.takeDamage({ amount: 9999, type: 'true', source: 'test' }); });
    await h.sleep(7000);
    log.redeployed = await describe();
    log.wreckAfter = await page.evaluate(() => window.__op2.ctx.enemies.vehicles.wrecks.map(w => [w.tag, w.root.position.toArray().map(n => Math.round(n)), w.keep]));
  }
  if (step === 'insertion') {
    const strike = () => page.evaluate(() => {
      const s = window.__op2.ctx.progression.callInsManager.strikes.at(-1);
      return s ? { clock: Math.round(s.clock), stage: s.seat.stage, at: s.frame.root.position.toArray().map(n => Math.round(n)), ends: Math.round(s.path.ends), next: s.nextMark } : null;
    });
    await h.sleep(8000);
    log.s8 = await strike();
    await h.shot('in-8');
    await h.sleep(14000);
    log.s22 = await strike();
    log.d22 = await describe();
    await h.shot('in-22');
    // Skips to the last few marks, to see the ending without sitting through the lap.
    await page.evaluate(() => {
      const s = window.__op2.ctx.progression.callInsManager.strikes.at(-1);
      s.clock = s.path.arrival(7) + 12;
    });
    await h.sleep(5000);
    log.s30 = await strike();
    await h.shot('in-hit');
    await page.waitForFunction(() => window.__op2.campaign.runner.describe().beat === 'lockout', null, { timeout: 40000 });
    await h.sleep(1500);
    log.landed = await strike();
    log.body = await page.evaluate(() => window.__op2.ctx.player.position.toArray().map(n => Math.round(n * 10) / 10));
    log.after = await describe();
    await h.shot('in-landed');
  }

  log.vehicles = await read();
  return log;
}
