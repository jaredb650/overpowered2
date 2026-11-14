// The air support update in the real game. One mode per run:
//
//   AS_MODE=views node tools/shot.mjs --url "/?map=killhouse&autostart=1" --script tools/scripts/airsupport-live.mjs --dpr 2 --w 1440 --h 900 --wait 500 --out tools/out/airsupport/views.png --timeout 200
//
// views   tap M: the AC-130 seat in TV, white-hot and black-hot
// rounds  the 40 mm's HE, AP and flak landing on a crowd
// wp      a white phosphorus shell, its cloud, and who caught fire
// bomb    the glide bomb: the ramp, the fall under the laser, the blast
// ai      hold J (door gunner) and hold M (AC-130) from the ground, then watch them work
// handover tap H, then E: the chopper fights on with the player on the ground
//
// Part 2, the enemy fights the aircraft (screenshots to tools/out/airsupport2/):
// missile  hold M, Rocketeers about: a missile climbs at the gunship from the ground's view, the crew's flares, the burst
// flares   tap M: the lock tone, the launch warning, the player's flares drawing the missile off, seen from the seat
// crash    tap H with one hit left: a missile brings it down, the player is back on the ground watching it fall and burn
// pilot    tap J: the pilot throws his own flares at a missile while the player is on the gun
//
// The fix for the gunship over the Crucible's invisible walls (screenshots to tools/out/ac130fix/):
// crucible  run on /?map=crucible&autostart=1. Tap M, hold still for 6 s: the sight must keep its spot on the floor
//           while the ship circles (it was locked on the invisible lid 35 m under the ship and dragged round with it).
//           Then the 25, 40 and 105 mm: every impact on the floor, none in the air on the lid or the walls.
const mode = process.env.AS_MODE ?? 'views';

function prelude() {
  const { ctx } = window.__op2;
  ctx.player.modifiers.invulnerable = true;
  const log = { radio: [], hurt: 0, kills: {}, fired: {} };
  window.__as = log;
  const feed = ctx.hud.feed.bind(ctx.hud);
  ctx.hud.feed = (text, color) => {
    if (/^(SPECTRE|HARROW|PACKMULE|AC-130|DOOR|ATTACK)/.test(text)) log.radio.push(text);
    return feed(text, color);
  };
  const takeDamage = ctx.player.takeDamage.bind(ctx.player);
  ctx.player.takeDamage = d => {
    if (/^(ac130|chopper|door_gun)/.test(d.source)) log.hurt++;
    return takeDamage(d);
  };
  ctx.events.on('enemy:killed', e => { log.kills[e.damage.source] = (log.kills[e.damage.source] ?? 0) + 1; });
  const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  window.__tap = async action => {
    ctx.input.simulate(action, true);
    await frame();
    ctx.input.simulate(action, false);
    await frame();
  };
  window.__hold = async (action, ms) => {
    ctx.input.simulate(action, true);
    await new Promise(r => setTimeout(r, ms));
    ctx.input.simulate(action, false);
    await frame();
  };
  window.__spawn = (count, near, only) => {
    const p = ctx.player.position;
    const ids = only ? [only] : ['husk', 'husk', 'trooper', 'brute', 'gunner'];
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const r = near + (i % 3) * 3;
      const at = p.clone();
      at.x += Math.cos(a) * r;
      at.z += Math.sin(a) * r;
      ctx.world.nav.nearest(at, 12, at);
      ctx.enemies.spawn(ids[i % ids.length], at);
    }
  };
  // Every sound id played, by count, so the tones can be read back.
  log.sounds = {};
  const play = ctx.audio.play.bind(ctx.audio);
  ctx.audio.play = (id, o) => {
    log.sounds[id] = (log.sounds[id] ?? 0) + 1;
    return play(id, o);
  };
  /** Turns the body to look at a point. */
  window.__look = p => {
    const e = ctx.player.eye;
    const dx = p.x - e.x;
    const dy = p.y - e.y;
    const dz = p.z - e.z;
    ctx.player.yaw = Math.atan2(-dx, -dz);
    ctx.player.pitch = Math.min(1.4, Math.atan2(dy, Math.hypot(dx, dz)));
  };
  window.__air = () => {
    const m = ctx.progression.callInsManager;
    const aa = m.antiAir;
    return {
      aircraft: m.aircraft.map(a => ({ hits: a.hits, flares: a.flares, rounds: a.rounds, flown: a.flown, huntable: a.huntable, y: Math.round(a.position.y) })),
      hunts: aa.hunts.map(h => ({ by: h.enemy.id, lock: Number(h.lock.toFixed(2)), missile: !!h.missile })),
      missiles: aa.missiles.map(x => ({ y: Math.round(x.body.position.y), decoy: !!x.decoy, age: Number(x.age.toFixed(1)) })),
      decoys: aa.decoys.length,
      rest: Number(aa.rest.toFixed(1)),
      tones: { lock: log.sounds.aa_lock ?? 0, launch: log.sounds.aa_launch ?? 0 },
    };
  };
  window.__state = () => {
    const m = ctx.progression.callInsManager;
    const ship = m.strikes.find(s => s.battery);
    return {
      air: window.__air(),
      seated: m.seats.occupied,
      status: m.seats.seat?.status,
      strikes: m.strikes.length,
      weapons: ship?.battery.weapons.map(w => `${w.name} ${w.ammo}/${w.max}${w.reload >= 0 ? ` r${w.reload.toFixed(2)}` : ''}`),
      burning: ctx.enemies.alive.filter(e => e.burning > 0).length,
      alive: ctx.enemies.alive.length,
      filter: ctx.render.renderer.domElement.style.filter,
      hurt: log.hurt,
      kills: log.kills,
      radio: log.radio.slice(-6),
    };
  };
}

async function booted(page, h) {
  for (let i = 0; i < 120; i++) {
    if (await page.evaluate(() => window.__op2?.game?.state === 'playing')) return true;
    await h.sleep(1000);
  }
  return false;
}

const state = page => page.evaluate(() => window.__state());

/** Taps M with enemies about, and waits for the sensor view. */
async function seatAc130(page, h, spawn = 12) {
  await page.evaluate(n => {
    const { ctx } = window.__op2;
    ctx.player.pitch = -0.5;
    window.__spawn(n, 14);
    ctx.progression.grantCallIn('ac130');
  }, spawn);
  await page.evaluate(() => window.__tap('callinAc130'));
  await h.sleep(9000);
  return state(page);
}

async function views(page, h) {
  const out = { seat: await seatAc130(page, h) };
  await h.shot('tv');
  await page.evaluate(() => window.__tap('reload'));
  await h.sleep(500);
  await h.shot('whitehot');
  out.white = await state(page);
  await page.evaluate(() => window.__tap('reload'));
  await h.sleep(500);
  await h.shot('blackhot');
  out.black = await state(page);
  await page.evaluate(() => window.__tap('reload'));
  await h.sleep(300);
  out.back = await state(page);
  return out;
}

async function fireFor(page, h, ms) {
  await page.evaluate(m => window.__hold('fire', m), ms);
}

async function rounds(page, h) {
  const out = { seat: await seatAc130(page, h, 16) };
  await page.evaluate(() => window.__tap('weapon2'));
  for (const name of ['he', 'ap', 'flak']) {
    await fireFor(page, h, 700);
    await h.sleep(name === 'flak' ? 1500 : 1700);
    await h.shot(name);
    out[name] = await state(page);
    await h.sleep(800);
    await page.evaluate(() => window.__tap('weapon2'));
    await h.sleep(4500);
  }
  return out;
}

async function wp(page, h) {
  const out = { seat: await seatAc130(page, h, 14) };
  await page.evaluate(() => window.__tap('weapon3'));
  await page.evaluate(() => window.__tap('weapon3'));
  await fireFor(page, h, 100);
  out.fired = await state(page);
  await h.sleep(4800);
  await h.shot('hit');
  await h.sleep(3000);
  await h.shot('cloud');
  out.cloud = await state(page);
  await page.evaluate(() => window.__tap('reload'));
  await h.sleep(400);
  await h.shot('cloud-whitehot');
  return out;
}

async function bomb(page, h) {
  const out = { seat: await seatAc130(page, h, 14) };
  await page.evaluate(() => window.__tap('weapon4'));
  await fireFor(page, h, 100);
  await h.sleep(1500);
  await h.shot('bay');
  out.bay = await state(page);
  await h.sleep(2600);
  await h.shot('falling');
  out.falling = await state(page);
  for (let i = 0; i < 80; i++) {
    const live = await page.evaluate(() => window.__op2.ctx.progression.callInsManager.gunship.rounds.bombLive);
    if (!live) break;
    await h.sleep(100);
  }
  await h.sleep(250);
  await h.shot('blast');
  out.blast = await state(page);
  return out;
}

async function ai(page, h) {
  await page.evaluate(() => {
    const { ctx } = window.__op2;
    ctx.player.pitch = -0.2;
    window.__spawn(14, 22);
    ctx.progression.grantCallIn('doorGunner');
    ctx.progression.grantCallIn('ac130');
  });
  await page.evaluate(() => window.__hold('callinDoorGunner', 600));
  await h.sleep(300);
  await page.evaluate(() => window.__hold('callinAc130', 600));
  const out = { sent: await state(page) };
  await h.sleep(9000);
  await page.evaluate(() => { window.__op2.ctx.player.pitch = 0.15; });
  await h.shot('ground-1');
  await h.sleep(5000);
  await page.evaluate(() => { window.__op2.ctx.player.pitch = -0.15; });
  await h.shot('ground-2');
  await h.sleep(15000);
  await h.shot('ground-3');
  out.after = await state(page);
  return out;
}

async function handover(page, h) {
  await page.evaluate(() => {
    const { ctx } = window.__op2;
    window.__spawn(14, 22);
    ctx.progression.grantCallIn('attackChopper');
  });
  await page.evaluate(() => window.__tap('callinChopper'));
  await h.sleep(4500);
  const out = { seat: await state(page) };
  await h.shot('seat');
  await page.evaluate(() => window.__tap('interact'));
  await h.sleep(1500);
  out.left = await state(page);
  await page.evaluate(() => { window.__op2.ctx.player.pitch = 0.25; });
  await h.sleep(6000);
  await h.shot('ground');
  out.after = await state(page);
  // A second tap of H does nothing: the call-in is spent, and there is no way back into the seat.
  await page.evaluate(() => window.__tap('callinChopper'));
  await h.sleep(500);
  out.again = await state(page);
  return out;
}

// --- Part 2 -------------------------------------------------------------------------------------------------------------

/** Rocketeers in a ring at this range, and the next hunter picked at once. */
async function rocketeers(page, n, near) {
  await page.evaluate(([count, r]) => {
    window.__spawn(count, r, 'rocketeer');
    window.__op2.ctx.progression.callInsManager.antiAir.rest = 0;
  }, [n, near]);
}

/** Polls until `test` (a page expression over `a`, the air state) holds, or the time is up. Returns the state. */
async function until(page, h, test, ms) {
  const end = Date.now() + ms;
  let a = null;
  while (Date.now() < end) {
    a = await page.evaluate(src => { const a = window.__air(); return { a, ok: new Function('a', `return ${src}`)(a) }; }, test);
    if (a.ok) return a.a;
    await h.sleep(100);
  }
  return a?.a ?? null;
}

const lookAtAircraft = page => page.evaluate(() => {
  const a = window.__op2.ctx.progression.callInsManager.aircraft[0];
  if (a) window.__look(a.position);
});

const lookAtMissile = page => page.evaluate(() => {
  const m = window.__op2.ctx.progression.callInsManager.antiAir.missiles[0];
  const a = window.__op2.ctx.progression.callInsManager.aircraft[0];
  const p = m?.body.position ?? a?.position;
  if (p) window.__look(m && a ? p.clone().lerp(a.position, 0.35) : p);
});

async function missile(page, h) {
  await page.evaluate(() => window.__spawn(8, 20));
  await page.evaluate(() => { window.__op2.ctx.player.pitch = -0.5; window.__op2.ctx.progression.grantCallIn('ac130'); });
  await page.evaluate(() => window.__hold('callinAc130', 600));
  await h.sleep(9000);
  await rocketeers(page, 4, 16);
  const out = { locking: await until(page, h, 'a.hunts.length > 0', 15000) };
  out.launched = await until(page, h, 'a.missiles.length > 0', 8000);
  await h.sleep(900);
  await lookAtMissile(page);
  await h.sleep(60);
  await h.shot('climb');
  await h.sleep(800);
  await lookAtMissile(page);
  await h.sleep(60);
  await h.shot('climb-2');
  out.end = await until(page, h, 'a.missiles.length === 0', 8000);
  await lookAtAircraft(page);
  await h.sleep(60);
  await h.shot('after');
  out.state = await state(page);
  return out;
}

async function flares(page, h) {
  const out = { seat: await seatAc130(page, h, 8) };
  await rocketeers(page, 4, 16);
  out.locking = await until(page, h, 'a.hunts.length > 0', 15000);
  out.launched = await until(page, h, 'a.missiles.length > 0', 8000);
  await h.sleep(1200);
  await h.shot('seat-missile');
  await page.evaluate(() => window.__tap('jump'));
  await h.sleep(400);
  await h.shot('seat-flares');
  out.popped = await page.evaluate(() => window.__air());
  // A double press inside the lockout throws nothing.
  await page.evaluate(() => window.__tap('jump'));
  out.again = await page.evaluate(() => window.__air());
  await h.sleep(700);
  await h.shot('seat-burst');
  out.end = await until(page, h, 'a.missiles.length === 0', 8000);
  out.state = await state(page);
  return out;
}

async function crash(page, h) {
  await page.evaluate(() => {
    window.__spawn(10, 22);
    window.__op2.ctx.progression.grantCallIn('attackChopper');
  });
  await page.evaluate(() => window.__tap('callinChopper'));
  await h.sleep(4500);
  await page.evaluate(() => { window.__op2.ctx.progression.callInsManager.aircraft[0].hits = 1; });
  await rocketeers(page, 4, 18);
  const out = { seat: await state(page) };
  out.launched = await until(page, h, 'a.missiles.length > 0', 15000);
  await h.sleep(700);
  await h.shot('seat-incoming');
  out.down = await until(page, h, 'a.aircraft.length > 0 && a.aircraft[0].hits === 0', 8000);
  await h.sleep(200);
  out.body = await state(page);
  await lookAtAircraft(page);
  await h.sleep(60);
  await h.shot('falling');
  await h.sleep(700);
  await lookAtAircraft(page);
  await h.sleep(60);
  await h.shot('falling-2');
  await until(page, h, 'a.aircraft.length > 0 && a.aircraft[0].y < 6', 8000);
  await lookAtAircraft(page);
  await h.sleep(500);
  await h.shot('wreck');
  out.after = await state(page);
  return out;
}

async function pilot(page, h) {
  await page.evaluate(() => {
    window.__spawn(10, 22);
    window.__op2.ctx.progression.grantCallIn('doorGunner');
  });
  await page.evaluate(() => window.__tap('callinDoorGunner'));
  await h.sleep(5000);
  await rocketeers(page, 4, 18);
  const out = { launched: await until(page, h, 'a.missiles.length > 0', 15000) };
  out.thrown = await until(page, h, 'a.decoys > 0 || a.missiles.length === 0', 8000);
  await h.sleep(250);
  await h.shot('pilot-flares');
  out.end = await until(page, h, 'a.missiles.length === 0', 8000);
  await h.sleep(300);
  out.state = await state(page);
  return out;
}

/** `above` is each impact's height over the floor under it, by a ray with CG.World | CG.Air (1 | 512) through the lid. */
async function crucible(page, h) {
  const out = { seat: await seatAc130(page, h, 10) };
  await page.evaluate(() => {
    const { ctx } = window.__op2;
    const rounds = ctx.progression.callInsManager.gunship.rounds;
    const on = rounds.onImpact;
    window.__impacts = [];
    rounds.onImpact = (kind, p, n, d) => {
      const floor = ctx.physics.raycast(p.clone().setY(p.y + 1), { x: 0, y: -1, z: 0 }, 400, 1 | 512);
      window.__impacts.push({ kind, y: Math.round(p.y), above: floor ? Math.round(floor.distance - 1) : null });
      on(kind, p, n, d);
    };
    window.__sight = () => {
      const s = ctx.progression.callInsManager.seats.seat;
      return s && { x: Math.round(s.point.x), y: Math.round(s.point.y), z: Math.round(s.point.z), range: Math.round(s.range) };
    };
  });
  out.sight = [];
  for (let i = 0; i < 13; i++) {
    out.sight.push(await page.evaluate(() => window.__sight()));
    await h.sleep(500);
  }
  const [a, b] = [out.sight[0], out.sight[out.sight.length - 1]];
  out.drift = a && b ? Math.round(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)) : null;
  await h.shot('sight');
  // Off whatever the mark was on, to open floor.
  await page.evaluate(() => window.__op2.ctx.input.simulateLook(160, 60));
  await h.sleep(300);
  out.aim = await page.evaluate(() => window.__sight());
  await page.evaluate(() => window.__tap('weapon1'));
  await fireFor(page, h, 600);
  await h.sleep(1600);
  await h.shot('25mm');
  await page.evaluate(() => window.__tap('weapon2'));
  await fireFor(page, h, 700);
  await h.sleep(2200);
  await h.shot('40mm');
  await page.evaluate(() => window.__tap('weapon3'));
  await fireFor(page, h, 100);
  await h.sleep(4900);
  await h.shot('105mm');
  out.impacts = await page.evaluate(() => window.__impacts);
  // The Crucible's invisible lid is at 148 to 152 m, where every round burst before the fix.
  out.onLid = out.impacts.filter(i => i.y >= 140).length;
  return out;
}

export default async function airsupport(page, h) {
  if (!(await booted(page, h))) return { booted: false };
  await page.evaluate(prelude);
  return { views, rounds, wp, bomb, ai, handover, missile, flares, crash, pilot, crucible }[mode](page, h);
}
