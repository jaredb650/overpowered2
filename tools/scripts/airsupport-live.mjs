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
  window.__state = () => {
    const m = ctx.progression.callInsManager;
    const ship = m.strikes.find(s => s.battery);
    return {
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

export default async function airsupport(page, h) {
  if (!(await booted(page, h))) return { booted: false };
  await page.evaluate(prelude);
  return { views, rounds, wp, bomb, ai, handover }[mode](page, h);
}
