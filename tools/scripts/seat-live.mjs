// The gunner's seats in the real game. One mode per run:
//
//   SEAT_MODE=model   node tools/shot.mjs --url "/?map=range" --script tools/scripts/seat-live.mjs --dpr 2 --w 1440 --h 900 --wait 500 --out tools/out/seat-model.png
//   SEAT_MODE=chopper node tools/shot.mjs --url "/?map=killhouse&autostart=1" --script tools/scripts/seat-live.mjs --dpr 2 --w 1440 --h 900 --wait 500 --out tools/out/seat-chopper.png
//   SEAT_MODE=door    node tools/shot.mjs --url "/?map=killhouse&autostart=1" --script tools/scripts/seat-live.mjs --dpr 2 --w 1440 --h 900 --wait 500 --out tools/out/seat-door.png
//
// Use `/?autostart=1` for the Crucible.
//
// model    both airframes and guns parked in front of the camera, from several sides
// chopper  the Attack Chopper call-in: key, the flight in, the seat, both weapons
// door     the Door Gunner call-in: key, the flight in, the door, the gun
// safe     a mortal player, enemies on the body, out of ammo and back: nothing reaches the body, control comes back
// exits    every way out of a seat: bail key, death, new run, quit to menu, and pause and resume in the middle
// full     a whole flight with a held trigger and the sight on the enemies: rounds, kills, what the combo did, and how
//          the aircraft flew (SEAT_ID=attackChopper or doorGunner)
// perf     frame times on foot against firing from a seat, in one run, then zoom
const mode = process.env.SEAT_MODE ?? 'chopper';

/** Runs in the page. */
function prelude() {
  const { ctx } = window.__op2;
  const log = { kills: {}, hits: {}, radio: [], banners: [], touched: [] };
  window.__seat = log;
  const hud = ctx.hud;
  const feed = hud.feed.bind(hud);
  hud.feed = (text, color) => {
    if (/^(HARROW|PACKMULE)/.test(text)) log.radio.push(text);
    return feed(text, color);
  };
  const banner = hud.banner.bind(hud);
  hud.banner = (text, sub, color) => {
    log.banners.push(`${text} / ${sub ?? ''}`);
    return banner(text, sub, color);
  };
  ctx.events.on('enemy:killed', e => { log.kills[e.damage.source] = (log.kills[e.damage.source] ?? 0) + 1; });
  ctx.events.on('enemy:hit', e => { log.hits[e.damage.source] = (log.hits[e.damage.source] ?? 0) + 1; });
  ctx.events.on('player:damaged', e => log.touched.push(`${e.type} parked=${ctx.player.parked} grace=${Number(ctx.player.parkGrace.toFixed(2))} seat=${ctx.progression.callInsManager.seats.occupied}`));
  window.__seatState = () => {
    const m = ctx.progression.callInsManager;
    const s = m.seats.seat;
    return {
      parked: ctx.player.parked, occupied: m.seats.occupied, stage: s?.stage ?? null, left: s?.left ?? null,
      range: s?.range ?? null, weapons: s?.weapons?.map(w => w.ammo) ?? null, health: ctx.player.health, alive: ctx.player.alive,
      held: [...ctx.progression.callIns], combo: ctx.progression.combo, score: ctx.progression.score, enemies: ctx.enemies.alive.length,
      state: window.__op2.game.state, cooldown: { attack: m.cooldown('attackChopper'), door: m.cooldown('doorGunner') },
    };
  };
}

const state = page => page.evaluate(() => window.__seatState());

/** Enemies with no warning, near a point, so a seat has something to shoot. */
const spawn = (page, count, id = 'trooper', spread = 12, x = 0, z = 0) => page.evaluate(([n, kind, r, cx, cz]) => {
  const { ctx } = window.__op2;
  const THREE = ctx.player.position.constructor;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    ctx.enemies.spawn(kind, new THREE(cx + Math.cos(a) * r, 0.1, cz + Math.sin(a) * r));
  }
}, [count, id, spread, x, z]);

async function model(page, h) {
  await page.evaluate(() => {
    const { ctx } = window.__op2;
    const THREE = ctx.player.position.constructor;
    const m = ctx.progression.callInsManager;
    window.__models = { m, THREE };
    ctx.hud.seat({ el: document.createElement('div'), update() {} });
    const view = { position: new THREE(), yaw: 0, pitch: 0, roll: 0, shake: 0 };
    ctx.camera.setSeat(view);
    window.__view = view;
    window.__pose = (ride, gunMount, at, yaw, eye, pitch, gunYaw) => {
      const fwd = new THREE(Math.sin(yaw), 0, Math.cos(yaw));
      const pos = new THREE(...at);
      ride.frame.fly(pos, fwd, 0);
      const pivot = ride.frame.mount(gunMount, new THREE());
      ride.gun.snap(gunYaw, -0.2);
      ride.gun.point(pivot, gunYaw, -0.2, 0);
      const e = new THREE(...eye);
      view.position.copy(e);
      const d = pos.clone().sub(e);
      view.yaw = Math.atan2(-d.x, -d.z);
      view.pitch = pitch ?? Math.atan2(d.y, Math.hypot(d.x, d.z));
    };
  });
  const views = [
    ['attack-left', 'harrow', 'chin', [0, 8, 0], 0, [16, 9, 6], Math.PI],
    ['attack-front', 'harrow', 'chin', [0, 8, 0], 0, [5, 7, 22], Math.PI],
    ['attack-top', 'harrow', 'chin', [0, 8, 0], 0, [-9, 21, -12], Math.PI],
    ['door-left', 'packmule', 'door', [0, 8, 0], 0, [17, 9, 4], Math.PI / 2],
    ['door-front', 'packmule', 'door', [0, 8, 0], 0, [-6, 8, 24], Math.PI / 2],
    ['door-rear', 'packmule', 'door', [0, 8, 0], 0, [14, 12, -16], Math.PI / 2],
  ];
  for (const [name, ride, mount, at, yaw, eye, gunYaw] of views) {
    await page.evaluate(([r, mt, a, y, e, g]) => {
      const { m } = window.__models;
      m.harrow.frame.hide(); m.harrow.gun.hide(); m.packmule.frame.hide(); m.packmule.gun.hide();
      window.__pose(m[r], mt, a, y, e, undefined, g);
    }, [ride, mount, at, yaw, eye, gunYaw]);
    await h.sleep(500);
    await h.shot(name);
  }
}

async function chopper(page, h) {
  await page.evaluate(prelude);
  await h.sleep(800);
  await spawn(page, 10, 'trooper', 14);
  await page.evaluate(() => window.__op2.ctx.progression.grantCallIn('attackChopper'));
  await h.sleep(200);
  await h.press('KeyH');
  await h.sleep(1300);
  await h.shot('1-flyin');
  await h.sleep(2200);
  await h.shot('2-seat');
  const before = await state(page);
  await page.mouse.down();
  await h.sleep(1400);
  await h.shot('3-cannon');
  await page.mouse.up();
  await page.mouse.down({ button: 'right' });
  await h.sleep(900);
  await h.shot('4-rockets');
  await page.mouse.up({ button: 'right' });
  await h.sleep(2500);
  await h.shot('5-after');
  return { before, after: await state(page), log: await page.evaluate(() => window.__seat) };
}

async function door(page, h) {
  await page.evaluate(prelude);
  await h.sleep(800);
  await spawn(page, 10, 'trooper', 14);
  await page.evaluate(() => window.__op2.ctx.progression.grantCallIn('doorGunner'));
  await h.sleep(200);
  await h.press('KeyJ');
  await h.sleep(1500);
  await h.shot('1-flyin');
  await h.sleep(2500);
  await h.shot('2-door');
  const before = await state(page);
  await page.mouse.down();
  await h.sleep(1500);
  await h.shot('3-fire');
  await h.sleep(800);
  await h.shot('4-fire');
  await page.mouse.up();
  await h.sleep(2000);
  await h.shot('5-after');
  return { before, after: await state(page), log: await page.evaluate(() => window.__seat) };
}

/** Holds the sight on the nearest enemy to it, as a steady hand would. Written before each frame. */
function aimBot() {
  const { ctx } = window.__op2;
  const tick = () => {
    window.__aiming = requestAnimationFrame(tick);
    const seat = ctx.progression.callInsManager.seats.seat;
    if (seat?.stage !== 'seated') return;
    let best = null;
    let d = Infinity;
    for (const e of ctx.enemies.alive) {
      const v = e.center.distanceToSquared(seat.point);
      if (v < d) { d = v; best = e; }
    }
    if (!best) return;
    const eye = seat.view.position;
    const dx = best.center.x - eye.x, dy = best.center.y - eye.y, dz = best.center.z - eye.z;
    seat.yaw = Math.atan2(-dx, -dz);
    seat.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  };
  tick();
}

/** Boards, and returns once seated. */
async function seatUp(page, h, id, key) {
  await page.evaluate(g => window.__op2.ctx.progression.grantCallIn(g), id);
  await h.sleep(250);
  await h.press(key);
  await page.waitForFunction(() => window.__seatState().stage === 'seated', null, { timeout: 40000 });
}

/** Mortal, with husks on the body, firing everything until the guns run dry, and then walking again. */
async function safe(page, h) {
  await page.evaluate(prelude);
  await page.evaluate(() => {
    const { ctx } = window.__op2;
    window.__lab?.settings && (window.__lab.settings.god = false);
    ctx.player.modifiers.invulnerable = false;
    ctx.player.health = 100;
    window.__seat.pos0 = ctx.player.position.toArray();
  });
  const id = process.env.SEAT_ID ?? 'doorGunner';
  const key = id === 'doorGunner' ? 'KeyJ' : 'KeyH';
  const p = await page.evaluate(() => window.__op2.ctx.player.position.toArray());
  await spawn(page, 6, 'husk', 3, p[0], p[2]);
  await seatUp(page, h, id, key);
  await page.evaluate(aimBot);
  await page.mouse.down();
  if (id === 'attackChopper') await page.mouse.down({ button: 'right' });
  const seen = [];
  for (let i = 0; i < 60; i++) {
    await h.sleep(1000);
    const s = await state(page);
    seen.push([s.stage, s.weapons?.join('/'), Math.round(s.health)].join(' '));
    if (!s.parked) break;
    // Spend the belt fast, since this is about what happens when it runs out.
    await page.evaluate(() => { const w = window.__op2.ctx.progression.callInsManager.seats.seat?.weapons; if (w) for (const x of w) x.ammo = Math.min(x.ammo, 30); });
  }
  await page.mouse.up();
  await page.mouse.up({ button: 'right' });
  const back = await state(page);
  await h.sleep(600);
  await h.shot('back');
  // Control really is back: the keys move the body and the gun fires.
  const moved = await page.evaluate(async () => {
    const { ctx } = window.__op2;
    const before = ctx.player.position.clone();
    const ammo = ctx.weapons.ammo().mag;
    ctx.input.simulate('forward', true);
    ctx.input.simulate('fire', true);
    await new Promise(r => setTimeout(r, 1500));
    ctx.input.simulate('forward', false);
    ctx.input.simulate('fire', false);
    return { walked: Number(ctx.player.position.distanceTo(before).toFixed(1)), fired: ammo - ctx.weapons.ammo().mag };
  });
  return { seen, back, moved, log: await page.evaluate(() => window.__seat) };
}

/** Everything that must hand the player back, each from a live seat. */
async function exits(page, h) {
  await page.evaluate(prelude);
  const out = {};
  const clear = () => page.evaluate(() => {
    const { ctx } = window.__op2;
    const m = ctx.progression.callInsManager;
    for (const id of ['doorGunner', 'attackChopper']) m.cooldowns[id] = 0;
  });
  const after = () => page.evaluate(() => {
    const { ctx } = window.__op2;
    const s = window.__seatState();
    return {
      parked: s.parked, occupied: s.occupied, state: s.state, seatedClass: document.querySelector('.hud').classList.contains('seated'),
      panel: !!document.querySelector('.gn'), camAtBody: ctx.render.camera.position.distanceTo(ctx.player.eye) < 1.5, fov: Math.round(ctx.camera.fov),
      holstered: ctx.weapons.holstered, airframes: [ctx.progression.callInsManager.harrow.frame.root.visible, ctx.progression.callInsManager.packmule.frame.root.visible],
    };
  });

  // Bail key.
  await seatUp(page, h, 'attackChopper', 'KeyH');
  await h.press('KeyE');
  await h.sleep(900);
  out.bail = await after();

  // Pause in the seat, hold, resume, then still in it.
  await clear();
  await seatUp(page, h, 'doorGunner', 'KeyJ');
  const left0 = (await state(page)).left;
  await page.evaluate(() => window.__op2.ctx.hud.pause());
  await h.sleep(1500);
  const paused = await page.evaluate(() => ({ state: window.__op2.game.state, left: window.__seatState().left, hudShown: document.querySelector('.hud').style.display !== 'none' }));
  await page.evaluate(() => window.__op2.game.setState('playing'));
  await h.sleep(700);
  const resumed = await state(page);
  out.pause = { left0, paused, resumed: { stage: resumed.stage, left: resumed.left, state: resumed.state } };

  // Death, from a seat. Nothing can reach a parked body, so this takes it off the hook first.
  await page.evaluate(() => {
    const { ctx } = window.__op2;
    ctx.player.modifiers.invulnerable = false;
    ctx.player.unpark(0);
    ctx.player.takeDamage({ amount: 99999, type: 'true', source: 'test' });
  });
  await h.sleep(300);
  out.death = await after();
  out.deathGrade = await page.evaluate(() => window.__op2.ctx.progression.perks.grade);
  await h.sleep(3200);

  // A new run with a live seat.
  await page.evaluate(() => { window.__op2.game.newRun(); });
  await h.sleep(600);
  await seatUp(page, h, 'attackChopper', 'KeyH');
  await page.evaluate(() => window.__op2.game.newRun());
  await h.sleep(500);
  out.newRun = await after();

  // Quit to the menu with a live seat.
  await seatUp(page, h, 'doorGunner', 'KeyJ');
  await page.evaluate(() => window.__op2.ctx.hud.quitToMenu());
  await h.sleep(500);
  out.quit = await after();
  out.grade = await page.evaluate(() => window.__op2.ctx.progression.perks.grade);
  return out;
}

/** Samples the flight: how far off the fight it stays, what it clears, and how hard it leans. */
function flightLog() {
  const { ctx } = window.__op2;
  const m = ctx.progression.callInsManager;
  const probe = m.kit.probe;
  const top = ctx.world.bounds.max.y - 1;
  const log = { n: 0, minClear: Infinity, maxBank: 0, gapSum: 0, gapMin: Infinity, gapMax: 0 };
  window.__flight = log;
  const tick = () => {
    window.__flightTick = requestAnimationFrame(tick);
    const seat = m.seats.seat;
    if (seat?.stage !== 'seated') return;
    const strike = m.strikes.find(s => s.seat === seat);
    const root = strike.frame.root;
    const p = root.position;
    const h = probe.heightAt(p.x, top, p.z, top + 20);
    log.minClear = Math.min(log.minClear, p.y - (Number.isNaN(h) ? 0 : h));
    const up = root.up.clone().applyQuaternion(root.quaternion);
    log.maxBank = Math.max(log.maxBank, Math.acos(Math.min(1, up.y)));
    const gap = Math.hypot(p.x - strike.fight.x, p.z - strike.fight.z);
    log.n++;
    log.gapSum += gap;
    log.gapMin = Math.min(log.gapMin, gap);
    log.gapMax = Math.max(log.gapMax, gap);
  };
  tick();
}

/** A whole flight of one aircraft with the trigger held and the sight on the enemies. */
async function full(page, h) {
  await page.evaluate(prelude);
  await page.evaluate(flightLog);
  const id = process.env.SEAT_ID ?? 'doorGunner';
  const at = await page.evaluate(() => window.__op2.ctx.player.position.toArray());
  await spawn(page, 12, process.env.SEAT_ENEMY ?? 'trooper', 16, at[0], at[2] - 22);
  await seatUp(page, h, id, id === 'doorGunner' ? 'KeyJ' : 'KeyH');
  await page.evaluate(aimBot);
  await page.mouse.down();
  if (id === 'attackChopper') await page.mouse.down({ button: 'right' });
  const seen = [];
  const t0 = Date.now();
  for (let i = 0; i < 40; i++) {
    await h.sleep(2500);
    const s = await state(page);
    seen.push(`${Math.round((Date.now() - t0) / 1000)}s ${s.stage} ${s.weapons?.join('/')} left ${Math.round(s.left ?? 0)} combo ${s.combo} alive ${s.enemies}`);
    if (i % 4 === 1) await h.shot(`t${i}`);
    if (s.enemies < 6) await spawn(page, 8, process.env.SEAT_ENEMY ?? 'trooper', 16, at[0], at[2] - 22);
    if (!s.parked) break;
  }
  await page.mouse.up();
  await page.mouse.up({ button: 'right' });
  const flight = await page.evaluate(() => {
    const f = window.__flight;
    return { samples: f.n, clearMin: Math.round(f.minClear), bankMaxDeg: Math.round(f.maxBank * 57.3), gapAvg: Math.round(f.gapSum / f.n), gapMin: Math.round(f.gapMin), gapMax: Math.round(f.gapMax) };
  });
  return { seen, flight, end: await state(page), log: await page.evaluate(() => window.__seat) };
}

/** Frame times on foot and then in a seat with the gun firing, in one run, so the machine's load cancels out. */
async function perf(page, h) {
  await page.evaluate(prelude);
  const id = process.env.SEAT_ID ?? 'doorGunner';
  const at = await page.evaluate(() => window.__op2.ctx.player.position.toArray());
  await spawn(page, 12, 'trooper', 16, at[0], at[2] - 22);
  const sample = seconds => page.evaluate(async ms => {
    const { ctx, game } = window.__op2;
    const gaps = [];
    const cpu = [];
    let last = performance.now();
    const end = last + ms;
    await new Promise(done => {
      const tick = t => {
        gaps.push(t - last);
        last = t;
        cpu.push(game.cpuMs);
        if (t < end) requestAnimationFrame(tick);
        else done();
      };
      requestAnimationFrame(tick);
    });
    const q = (a, p) => [...a].sort((x, y) => x - y)[Math.floor(a.length * p)];
    return {
      frames: gaps.length, gapMedian: Number(q(gaps, 0.5).toFixed(1)), gapP95: Number(q(gaps, 0.95).toFixed(1)), cpuMedian: Number(q(cpu, 0.5).toFixed(1)), cpuP95: Number(q(cpu, 0.95).toFixed(1)),
      drawCalls: ctx.render.drawCalls(), triangles: ctx.render.triangles(),
    };
  }, seconds * 1000);
  const foot = await sample(5);
  await seatUp(page, h, id, id === 'doorGunner' ? 'KeyJ' : 'KeyH');
  const fov = await page.evaluate(() => window.__op2.ctx.camera.fov);
  await page.evaluate(aimBot);
  await page.mouse.down();
  await h.sleep(600);
  const seat = await sample(7);
  await page.mouse.up();
  // Zoom, by each seat's own control.
  await page.evaluate(() => cancelAnimationFrame(window.__aiming));
  if (id === 'doorGunner') await page.mouse.down({ button: 'right' });
  else await page.evaluate(() => window.__op2.ctx.input.simulate('weaponNext', true));
  await h.sleep(700);
  const zoomed = await page.evaluate(() => Math.round(window.__op2.ctx.camera.fov));
  await h.shot('zoom');
  if (id === 'doorGunner') await page.mouse.up({ button: 'right' });
  return { foot, seat, fov: Math.round(fov), zoomed, end: await state(page) };
}

const MODES = { model, chopper, door, safe, exits, full, perf };

export default async function run(page, h) {
  // __op2 appears early in boot, and the run's first reset would wipe anything set before it.
  await page.waitForFunction(() => window.__op2?.game?.state === 'playing' && window.__op2.ctx.time.frame > 40, null, { timeout: 90000 });
  return MODES[mode](page, h);
}
