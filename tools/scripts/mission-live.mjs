// Plays the real Outpost mission in real Chrome, in stretches, and reads it back. MISSION_STEP picks the stretch. Bot only: what it
// proves is that every beat runs on the real map, not that any of it is any good.
//
//   MISSION_STEP=film node tools/shot.mjs --url "/?contract=campaign&autostart=1" --script tools/scripts/mission-live.mjs --out tools/out/ms.png --wait 500 --timeout 170
//   add --dpr 2 --w 1440 --h 900 for the owner's screen, and &beat=<id> for anywhere
const STEP = process.env.MISSION_STEP ?? 'film';

export default async function missionLive(page, h) {
  const log = [];
  const read = () => page.evaluate(() => window.__op2?.campaign?.runner?.describe() ?? null);
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
  const god = () => page.evaluate(() => { setInterval(() => { const p = window.__op2?.ctx?.player; if (p?.modifiers) p.modifiers.invulnerable = true; }, 100); });
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
  /** Crew get out of a dying truck after the shot that killed it, so one sweep is never enough. */
  const clear = async (beat, seconds, ...tags) => {
    for (let t = 0; t < seconds; t++) {
      const d = await read();
      if (d.beat === beat) return d;
      await kill(...tags);
      await h.sleep(1000);
    }
    throw new Error(`never reached ${beat}: ${JSON.stringify(await read())}`);
  };
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
      await clear('breather', 30, 'soft.first', 'soft.second', 'soft.truck1', 'soft.truck2', 'soft.truck3', 'soft.truck4', 'lz.rim');
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
      await tp(84, 4.3, 83, Math.PI);
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
    /** The Gate Yard: the men wait, the door drops, a miss brings it up to a crawl again and again. */
    async breach() {
      await until(d => d.beat === 'breach', 40, 'breach');
      await h.sleep(1500);
      await tp(0, 0, 4, 0);
      await until(d => d.doors.blastDoor === 1, 3, 'door open');
      await h.sleep(1200);
      await tp(0, 0, 2, 0);
      await h.sleep(800);
      await h.shot('breach-1');
      await until(d => d.doors.blastDoor === 0, 8, 'door shutting');
      log.push({ hud: await hud() });
      await kill('breach.west', 'breach.east');
      await until(d => d.doors.blastDoor === 0.4, 14, 'door up, once');
      await h.sleep(1400);
      await h.shot('breach-2');
      await until(d => d.doors.blastDoor === 0, 8, 'door down');
      await until(d => d.doors.blastDoor === 0.4, 16, 'door up, twice');
      log.push({ twice: true });
      await tp(0, 0, -18, Math.PI);
      await until(d => d.beat === 'barracks', 8, 'barracks');
    },
    async barracks() {
      await until(d => d.beat === 'barracks', 40, 'barracks');
      await h.sleep(2500);
      await h.shot('bar-0');
      log.push({ hud: await hud() });
      await until(d => d.doors.sallyWest === 1, 40, 'the door west');
      await h.sleep(2500);
      await tp(-12, 0, -17.5, Math.PI / 2);
      await h.sleep(1800);
      await h.shot('bar-1');
      log.push({ hud: await hud() });
      await h.sleep(7000);
      await h.shot('bar-2');
      await note('in the corridor');
      await tp(-28, 0, -30, 0);
      await h.sleep(3000);
      await h.shot('bar-3');
      await tp(-30, 0, -42.5, Math.PI / 2);
      await clear('coolant', 25, 'bar.pin', 'bar.flank', 'bar.bunks');
      log.push({ hud: await hud() });
    },
    async coolant() {
      await until(d => d.beat === 'coolant', 40, 'coolant');
      await tp(-34, 0, -48, 0);
      await h.sleep(1500);
      await h.shot('cool-0');
      await h.sleep(9000);
      await h.shot('cool-1');
      log.push({ hud: await hud() });
      await tp(-34, 0, -72, Math.PI);
      await until(d => d.beat === 'gallery', 6, 'gallery');
    },
    async gallery() {
      await until(d => d.beat === 'gallery', 40, 'gallery');
      await tp(-20, -5, -74.5, -Math.PI / 2);
      await h.sleep(1500);
      await h.shot('gal-0');
      await h.sleep(9000);
      await h.shot('gal-1');
      log.push({ hud: await hud() });
      await tp(18, -5, -74.5, -Math.PI / 2);
      await until(d => d.beat === 'mess', 6, 'mess');
    },
    async mess() {
      await until(d => d.beat === 'mess', 40, 'mess');
      await h.sleep(4500);
      await note('waiting');
      const quiet = () => page.evaluate(() => {
        const o = window.__op2.ctx.enemies.outpost;
        return { silent: o.soldiers.filter(s => s.silent).length, men: o.soldiers.length };
      });
      await tp(46, 0, -74, Math.PI);
      await h.sleep(1000);
      await h.shot('mess-0');
      await tp(34, 0, -67, Math.PI);
      await h.sleep(2500);
      await h.shot('mess-1');
      log.push({ hud: await hud(), holding: await quiet() });
      await page.waitForFunction(() => document.querySelector('.ms-radio.on')?.textContent.includes('Now.'), null, { timeout: 16000 });
      log.push({ word: await quiet() });
      await h.sleep(1200);
      await h.shot('mess-2');
      log.push({ hud: await hud(), after: await quiet() });
      await clear('armoury', 25, 'mess.floor', 'mess.west', 'mess.east');
    },
    async armoury() {
      await until(d => d.beat === 'armoury', 40, 'armoury');
      await tp(40, 0, -37, -Math.PI / 2);
      await h.sleep(1500);
      await h.shot('arm-0');
      log.push({ hud: await hud() });
      await tp(44, 0, -37, Math.PI);
      await until(d => d.beat === 'plates', 40, 'plates');
      await h.sleep(800);
      await h.shot('arm-1');
      log.push({ hud: await hud(), owned: await page.evaluate(() => [...window.__op2.ctx.weapons.owned]) });
    },
    /** A real rocket on the floor by the line, and a real one on a plated chest, so the lesson is measured and not read off a table. */
    async plates() {
      await until(d => d.beat === 'plates', 40, 'plates');
      await tp(44, 0, -24, Math.PI / 2);
      await until(d => d.tags['plate.back'] && d.tags['plate.back'] !== '4/4' || d.tags['plate.back'] === '4/4', 10, 'second platoon');
      await h.sleep(7000);
      const men = () => page.evaluate(() => {
        const { ctx, campaign } = window.__op2;
        return ctx.enemies.alive.map(e => ({ tag: campaign.host.tagOf.get(e.uid), id: e.id, armor: Math.round(e.armor), plates: e.plates.length, hp: Math.round(e.health), max: Math.round(e.maxHealth), at: e.position.toArray().map(Math.round) }));
      });
      const before = await men();
      log.push({ before });
      await h.shot('plate-0');
      const front = before.find(m => m.tag === 'plate.front');
      if (front) {
        await page.evaluate(() => { window.__op2.ctx.weapons.switchTo('rocket'); });
        await h.sleep(600);
        await face(front.at[0], 0, front.at[2] + 2.5);
        await seat(true);
        await h.sleep(120);
        await seat(false);
        await h.sleep(2200);
        log.push({ afterFloorShot: await men() });
        await h.shot('plate-1');
      }
      await clear('stack', 30, 'plate.front', 'plate.back', 'plate.round');
    },
    async stack() {
      await until(d => d.beat === 'stack', 40, 'stack');
      await h.sleep(2500);
      await h.shot('stack-0');
      log.push({ hud: await hud() });
      await tp(-2, 5, -30, 0);
      await h.sleep(5000);
      await h.shot('stack-1');
      await note('landing');
      await kill('stack.base', 'stack.lower');
      await h.sleep(2500);
      await kill('stack.base', 'stack.lower', 'stack.upper');
      await tp(0, 10, -60, 0);
      await until(d => d.beat === 'commander', 6, 'top');
    },
    /** Into the War Room, a chunk off his health, up to the roof after him, and the shells that come down there. */
    async boss() {
      await until(d => d.beat === 'commander', 40, 'commander');
      await tp(0, 10, -63, 0);
      await h.sleep(3000);
      await h.shot('boss-0');
      const at = () => page.evaluate(() => {
        const b = window.__op2.ctx.enemies.outpost.commander.person.body;
        return b ? { at: b.position.toArray().map(Math.round), hp: Math.round(b.health), max: Math.round(b.maxHealth), armor: Math.round(b.armor) } : null;
      });
      log.push({ boss: await at(), hud: await hud() });
      // He is in the heavy suit, so it takes the plates first, as it would a player.
      await page.evaluate(async () => {
        const { ctx } = window.__op2;
        const b = ctx.enemies.outpost.commander.person.body;
        for (let i = 0; i < 120 && b.health / b.maxHealth > 0.56; i++) {
          ctx.enemies.applyDamage(b, { amount: 120, type: 'true', point: b.center.clone(), dir: b.center.clone().set(0, 0, -1), force: 0, source: 'rocket' });
          await new Promise(r => setTimeout(r, 30));
        }
      });
      await until(d => d.doors.warRoomStairs === 1, 12, 'he runs');
      await h.sleep(3000);
      await h.shot('boss-1');
      log.push({ boss: await at(), hud: await hud() });
      await tp(-14, 14, -62, Math.PI);
      await h.sleep(1500);
      await face(0, 15, -70);
      await h.sleep(600);
      await h.shot('boss-2');
      await h.sleep(14000);
      await h.shot('boss-3');
      log.push({ boss: await at(), hud: await hud(), mortar: await page.evaluate(() => window.__op2.ctx.enemies.outpost.commander.mortars.stage) });
      await kill('boss.west', 'boss.east', 'commander');
      await until(d => d.beat === 'ending', 12, 'ending');
    },
    /** His last words, the receipt, the film, the screen with the bill on it, and back round to the top. */
    async ending() {
      await until(d => d.beat === 'ending', 40, 'ending');
      await h.sleep(2000);
      await h.shot('end-0');
      log.push({ hud: await hud(), box: await page.evaluate(() => document.querySelector('.cmd-box.on:not(.ms-radio)')?.textContent ?? null) });
      await page.waitForFunction(() => window.__op2.campaign.host.film.playing, null, { timeout: 15000 });
      await h.sleep(5000);
      await h.shot('end-1');
      log.push({ hud: await hud() });
      await seek(1, 13);
      await page.waitForFunction(() => window.__op2.campaign.result !== null, null, { timeout: 30000 });
      await page.waitForFunction(() => document.querySelector('.scr-complete')?.style.display === '', null, { timeout: 20000 });
      await h.sleep(1600);
      await h.shot('end-2');
      log.push({ result: await page.evaluate(() => window.__op2.campaign.result), screen: await page.evaluate(() => document.querySelector('.scr-complete')?.innerText) });
    },
    /** Pause in the film and in the seat, Restart from checkpoint out of both, with real clicks on the real buttons. */
    async pause() {
      const button = text => page.locator('.scr-pause button, .scr-pause .mm-item, .scr-pause [role=button]').filter({ hasText: text }).first();
      const state = () => page.evaluate(() => ({
        game: window.__op2.game.state, film: window.__op2.campaign.host.film.total, playing: window.__op2.campaign.host.film.playing,
        seat: !!window.__op2.ctx.progression.callInsManager.seats?.seat, parked: window.__op2.ctx.player.parked, beat: window.__op2.campaign.runner.beat?.id, deaths: window.__op2.campaign.runner.deaths,
      }));
      const hit = async () => {
        await press('pause');
        await page.waitForFunction(() => window.__op2.game.state === 'paused', null, { timeout: 5000 });
      };
      await until(d => d.beat === 'briefing', 60, 'briefing');
      await h.sleep(3000);
      await hit();
      const a = await state();
      await h.sleep(1500);
      await h.shot('pause-film');
      const b = await state();
      log.push({ paused: a, later: b, frozen: a.film === b.film });
      await button('Resume').click();
      await page.waitForFunction(() => window.__op2.game.state === 'playing', null, { timeout: 6000 });
      await h.sleep(1500);
      log.push({ resumed: await state() });
      await hit();
      await button('Restart from checkpoint').click();
      await page.waitForFunction(() => window.__op2.game.state === 'playing', null, { timeout: 6000 });
      await h.sleep(800);
      log.push({ restartedFilm: await state(), hud: await hud() });
      await h.shot('pause-restart');
      await press('interact');
      await until(d => d.beat === 'insertion', 10, 'insertion');
      await h.sleep(6000);
      await hit();
      await h.shot('pause-seat');
      log.push({ inSeat: await state() });
      await button('Restart from checkpoint').click();
      await page.waitForFunction(() => window.__op2.game.state === 'playing', null, { timeout: 6000 });
      await h.sleep(5000);
      log.push({ restartedSeat: await state(), desc: await read() });
      await h.shot('pause-seat2');
    },
    /** A clean profile: Endless is shut, the win opens it and says so, the menu remembers, and it plays. */
    async unlock() {
      await until(d => d.beat === 'briefing', 60, 'briefing');
      const stored = () => page.evaluate(() => localStorage.getItem('op2_campaign_beaten'));
      log.push({ before: await stored() });
      await page.evaluate(() => window.__op2.campaign.runner.start('ending'));
      await page.waitForFunction(() => window.__op2.campaign.host.film.playing, null, { timeout: 15000 });
      await seek(1, 13);
      await page.waitForFunction(() => document.querySelector('.scr-complete')?.style.display === '', null, { timeout: 30000 });
      await h.sleep(2500);
      await h.shot('unlock-0');
      log.push({ after: await stored(), result: await page.evaluate(() => window.__op2.campaign.result), screen: await page.evaluate(() => document.querySelector('.scr-complete').innerText) });
      await page.locator('.scr-complete').getByText('Menu', { exact: true }).click();
      await h.sleep(1200);
      await h.shot('unlock-1');
      log.push({ tabs: await page.evaluate(() => [...document.querySelectorAll('.mm-tab')].map(t => `${t.textContent}${t.classList.contains('lock') ? ' [locked]' : ''}`)) });
      await page.locator('.mm-tab').filter({ hasText: 'Endless Humans' }).click();
      await h.sleep(500);
      await h.shot('unlock-2');
      await page.locator('.scr-menu').getByText('Play', { exact: true }).click();
      await page.waitForURL(/contract=outpost/, { timeout: 15000 });
      await page.waitForFunction(() => document.querySelector('.sp-go')?.textContent.includes('Endless') && document.querySelector('.scr-splash')?.style.display === '', null, { timeout: 60000 });
      await h.shot('unlock-3');
      await page.mouse.click(600, 400);
      await page.waitForFunction(() => window.__op2?.game?.state === 'playing', null, { timeout: 8000 });
      await h.sleep(1500);
      log.push({ endless: await page.evaluate(() => ({ url: location.search, active: window.__op2.campaign.active, waves: window.__op2.ctx.waves.constructor.name, map: window.__op2.ctx.world.map?.id ?? null })) });
    },
    /** What someone new sees: the swarm page's menu, the lock, and the walk from Play into the briefing. */
    async menu() {
      await page.waitForFunction(() => document.querySelector('.scr-splash')?.style.display === '', null, { timeout: 60000 });
      await page.mouse.click(600, 400);
      await page.waitForFunction(() => document.querySelector('.scr-menu')?.style.display === '', null, { timeout: 8000 });
      await h.sleep(800);
      await h.shot('menu-0');
      log.push({ tabs: await page.evaluate(() => [...document.querySelectorAll('.mm-tab')].map(t => `${t.textContent}${t.classList.contains('on') ? ' [on]' : ''}${t.classList.contains('lock') ? ' [locked]' : ''}`)) });
      await page.locator('.mm-tab').filter({ hasText: 'Endless Humans' }).click();
      await h.sleep(500);
      await h.shot('menu-1');
      await page.locator('.scr-menu').getByText('Play', { exact: true }).click();
      await h.sleep(600);
      log.push({ stayed: await page.evaluate(() => location.search) });
      await page.locator('.mm-tab').filter({ hasText: 'Campaign' }).click();
      await page.locator('.scr-menu').getByText('Play', { exact: true }).click();
      await page.waitForURL(/contract=campaign/, { timeout: 15000 });
      await page.waitForFunction(() => document.querySelector('.sp-go')?.textContent.includes('Campaign') && document.querySelector('.scr-splash')?.style.display === '', null, { timeout: 90000 });
      await h.shot('menu-2');
      await page.mouse.click(600, 400);
      await until(d => d.beat === 'briefing', 10, 'briefing');
      await h.sleep(2500);
      await h.shot('menu-3');
      log.push({ hud: await hud(), url: await page.evaluate(() => location.search) });
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
