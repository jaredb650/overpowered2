// The gunner's seats in the real game. One mode per run:
//
//   SEAT_MODE=model   node tools/shot.mjs --url "/?map=range" --script tools/scripts/seat-live.mjs --dpr 2 --w 1440 --h 900 --wait 500 --out tools/out/seat-model.png
//   SEAT_MODE=chopper node tools/shot.mjs --url "/?map=killhouse&autostart=1" --script tools/scripts/seat-live.mjs --dpr 2 --w 1440 --h 900 --wait 500 --out tools/out/seat-chopper.png
//   SEAT_MODE=door    node tools/shot.mjs --url "/?map=killhouse&autostart=1" --script tools/scripts/seat-live.mjs --dpr 2 --w 1440 --h 900 --wait 500 --out tools/out/seat-door.png
//
// Add `autostart=1` without `map=` for the Crucible. SEAT_MAP=crucible only changes the names of what is reported.
//
// model    both airframes and guns parked in front of the camera, from several sides
// chopper  the Attack Chopper call-in: key, the flight in, the seat, both weapons
// door     the Door Gunner call-in: key, the flight in, the door, the gun
// safe     a mortal player, enemies on the body, out of ammo and back: nothing reaches the body, control comes back
// exits    every way out of a seat: bail key, death, new run, quit to menu, and pause and resume in the middle
// full     a whole flight of each with a held trigger: rounds, kills by source, what the combo did
const mode = process.env.SEAT_MODE ?? 'chopper';

const op2 = () => window.__op2;

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
  ctx.events.on('player:damaged', e => log.touched.push(e.type));
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

const MODES = { model, chopper, door };

export default async function run(page, h) {
  void op2;
  return MODES[mode](page, h);
}
