// Plays the real Outpost mission in real Chrome, in stretches, and reads it back. MISSION_STEP picks the stretch. Bot only: what it
// proves is that every beat runs on the real map, not that any of it is any good.
//
//   MISSION_STEP=film node tools/shot.mjs --url "/?contract=campaign&autostart=1" --script tools/scripts/mission-live.mjs --out tools/out/ms.png --wait 500 --timeout 170
//   add --dpr 2 --w 1440 --h 900 for the owner's screen, and &beat=<id> for anywhere
const STEP = process.env.MISSION_STEP ?? 'film';

export default async function missionLive(page, h) {
  const log = [];
  const read = () => page.evaluate(() => window.__op2?.campaign?.runner.describe() ?? null);
  const note = async label => {
    const d = await read();
    log.push({ label, beat: d?.beat, state: d?.state, deaths: d?.deaths, objectives: d?.objectives, tags: d?.tags });
    return d;
  };
  const until = async (test, seconds, label) => {
    for (let t = 0; t < seconds * 4; t++) {
      const d = await read();
      if (d && test(d)) return d;
      await h.sleep(250);
    }
    throw new Error(`timed out waiting for ${label}: ${JSON.stringify(await read())}`);
  };
  const press = action => page.evaluate(async a => {
    const { input } = window.__op2.ctx;
    input.simulate(a, true);
    await new Promise(r => setTimeout(r, 120));
    input.simulate(a, false);
  }, action);
  /** Moves the film on, so a stretch does not have to sit through it. */
  const seek = (index, clock) => page.evaluate(([i, c]) => {
    const film = window.__op2.campaign.host.film;
    film.index = i;
    film.clock = c;
    film.cut();
  }, [index, clock]);
  const hud = () => page.evaluate(() => ({
    radio: document.querySelector('.ms-radio.on')?.textContent ?? null,
    hint: document.querySelector('.ms-hint.on')?.textContent ?? null,
    objectives: [...document.querySelectorAll('.ms-obj')].map(e => e.textContent),
    beat: document.querySelector('.ms-beat')?.textContent ?? null,
  }));
  /** Every run rebuilds the player, so this has to go on being true. */
  const god = () => page.evaluate(() => { setInterval(() => { window.__op2.ctx.player.modifiers.invulnerable = true; }, 100); });
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
  /** Every man and machine under these tags, or everything on the map with none named. */
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
  const seat = (on) => page.evaluate(on => window.__op2.ctx.input.simulate('fire', on), on);
  /** Points the door gun at the nearest man it can reach, the way a player would sweep it. */
  const aimGun = () => page.evaluate(() => {
    const { ctx } = window.__op2;
    const rig = ctx.progression.callInsManager.seats;
    const s = rig.seat;
    if (!s) return null;
    const eye = s.view.position;
    let best = null;
    let near = 400;
    for (const e of ctx.enemies.alive) {
      const d = e.center.distanceTo(eye);
      if (d < near) { near = d; best = e; }
    }
    if (best) {
      const dx = best.center.x - eye.x, dy = best.center.y - eye.y, dz = best.center.z - eye.z;
      s.yaw = Math.atan2(-dx, -dz);
      s.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    }
    return { men: ctx.enemies.alive.length, range: Math.round(near), belt: s.left };
  });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  const steps = {
    /** The whole ride with a real gun, the crash, the climb out, and the gate in the face. */
    async ride() {
      await until(d => d.beat === 'insertion', 60, 'insertion');
      await h.sleep(4000);
      await seat(true);
      const shots = [12, 30, 55, 80, 105, 122];
      const start = Date.now();
      let next = 0;
      for (;;) {
        const d = await read();
        if (d.beat !== 'insertion') break;
        const a = await aimGun();
        const t = (Date.now() - start) / 1000;
        if (next < shots.length && t >= shots[next]) {
          await h.shot(`ride-${shots[next]}`);
          log.push({ t: Math.round(t), a, hud: await hud(), tags: d.tags });
          next++;
        }
        if (t > 175) throw new Error('ride never ended');
        await h.sleep(200);
      }
      await seat(false);
      log.push({ rideSeconds: Math.round((Date.now() - start) / 1000) + 4 });
      await h.sleep(300);
      await h.shot('crash-0');
      await h.sleep(2600);
      await h.shot('crash-1');
      log.push({ hud: await hud(), at: await page.evaluate(() => window.__op2.ctx.player.position.toArray().map(Math.round)) });
      await note('landed');
    },
    /** From the pit to the gate. */
    async lockout() {
      await until(d => d.beat === 'lockout', 60, 'lockout');
      await h.sleep(3500);
      await h.shot('lock-0');
      log.push({ hud: await hud() });
      await tp(-20, 0, 66, 0);
      await h.sleep(2500);
      await kill('lz.rim');
      await tp(0, 0, 40, 0);
      await face(0, 3, 12);
      await h.sleep(400);
      await h.shot('lock-1');
      await tp(0, 0, 30, 0);
      await until(d => d.beat === 'softskins', 30, 'gate shut');
      await h.shot('lock-2');
      await note('gate shut');
      log.push({ hud: await hud() });
    },
    /** Both waves of trucks, and the breath after them. */
    async soft() {
      await until(d => d.beat === 'softskins', 60, 'softskins');
      await tp(14, 0, 40, 0);
      await face(50, 1.5, 34);
      await h.sleep(9000);
      await h.shot('soft-0');
      log.push({ hud: await hud(), v: await page.evaluate(() => window.__op2.ctx.enemies.vehicles.describe()) });
      await tp(24, 0, 25.5, 0);
      await h.sleep(500);
      await h.shot('soft-1');
      await note('at the guardhouse');
      await until(d => d.tags['soft.first']?.endsWith('/8') && !d.tags['soft.first'].startsWith('0'), 25, 'crew booked');
      await h.sleep(8000);
      await kill('soft.first', 'soft.truck1', 'soft.truck2', 'lz.rim');
      await until(d => d.tags['soft.truck3'], 12, 'west road');
      await h.shot('soft-2');
      await h.sleep(14000);
      await note('second wave');
      await h.shot('soft-3');
      await kill('soft.second', 'soft.truck3', 'soft.truck4', 'lz.rim');
      await until(d => d.beat === 'breather', 25, 'breather');
      await h.sleep(1500);
      await h.shot('soft-4');
      log.push({ hud: await hud() });
    },
    async heavy() {
      await until(d => d.beat === 'heavy', 40, 'heavy');
      await tp(10, 0, 50, 0);
      await face(50, 1.5, 34);
      await h.sleep(9000);
      await h.shot('heavy-0');
      log.push({ hud: await hud() });
      await until(d => d.objectives.some(o => o.includes('wreck')), 30, 'told of the wreck');
      await h.shot('heavy-1');
      log.push({ hud: await hud() });
      await tp(70, 0, 76, Math.PI / 2);
      await until(d => d.beat === 'wreck', 10, 'wreck');
      await h.sleep(1500);
      await h.shot('wreck-0');
      log.push({ hud: await hud() });
      await tp(84, 4.3, 82, Math.PI);
      await h.sleep(1500);
      await h.shot('wreck-1');
      await until(d => d.beat === 'turn', 12, 'turn');
      await h.sleep(1500);
      await h.shot('turn-0');
      log.push({ hud: await hud(), owned: await page.evaluate(() => [...window.__op2.ctx.weapons.owned]) });
    },
    async turn() {
      await until(d => d.beat === 'turn', 40, 'turn');
      await h.sleep(4000);
      await kill('heavy.tank1');
      await h.sleep(9000);
      await note('one tank down');
      await h.shot('turn-1');
      await kill('heavy.tank2');
      await h.sleep(3000);
      const air = await page.evaluate(() => window.__op2.ctx.enemies.vehicles.describe().live.find(v => v.kind === 'chopper'));
      if (air) { await face(air.x, air.y, air.z); await h.sleep(300); await h.shot('turn-2'); }
      await kill('turn.chopper');
      await until(d => d.tags['turn.bulwark'], 20, 'Bulwark ordered');
      await tp(4, 0, 34, 0);
      await face(0, 2, 12);
      await h.sleep(16000);
      await h.shot('turn-3');
      await note('Bulwark in');
      await kill('turn.bulwark');
      await until(d => d.beat === 'breach', 15, 'breach');
      await h.sleep(1000);
      await h.shot('breach-0');
      log.push({ hud: await hud() });
    },
    async film() {
      await until(d => d.beat === 'briefing', 60, 'briefing');
      await h.sleep(700);
      await h.shot('film-0');
      for (const [i, c, name] of [[0, 11, 'film-1'], [1, 6, 'film-2'], [2, 6, 'film-3'], [3, 2, 'film-4'], [3, 7, 'film-5']]) {
        await seek(i, c);
        await h.sleep(500);
        await h.shot(name);
        log.push({ name, hud: await hud() });
      }
      await press('interact');
      await until(d => d.beat === 'insertion', 8, 'insertion');
      await h.sleep(400);
      await h.shot('film-after');
      await h.sleep(5000);
      await h.shot('ride-0');
      await note('in the seat');
    },
  };
  await god();
  for (const step of STEP.split(',')) await steps[step]();
  return { step: STEP, log, errors };
}
