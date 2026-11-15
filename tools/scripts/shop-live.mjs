// The Crucible's shop (weapons-update plan section 10) in the real game, and the three mods.
//
// SHOP_STEP=menu (default), in the Crucible: a supply pod falling under its beacon, landed, its E prompt, the shop opened from it with a gun
// turning (two stills a moment apart), a locked gun, the mods page, buying the suppressor, and the suppressed SMG firing.
//   node tools/shot.mjs --port 5261 --url "/?autostart=1" --script tools/scripts/shop-live.mjs --wait 500 --timeout 240 --dpr 2 --w 1440 --h 900 --out tools/out/shop/menu.png
//
// SHOP_STEP=range, on the Test Range with the lab: the panel's mod rows, the Harrow's red dot aimed, and a Sabot Raufoss round
// bursting on the gallery's first wall into the man behind it.
//   SHOP_STEP=range node tools/shot.mjs --port 5261 --url "/?map=range" --script tools/scripts/shop-live.mjs --wait 500 --timeout 240 --dpr 2 --w 1440 --h 900 --out tools/out/shop/range.png
export default async function shopLive(page, h) {
  await page.evaluate(prelude);
  return process.env.SHOP_STEP === 'range' ? range(page, h) : menu(page, h);
}

function prelude() {
  const frame = () => new Promise(r => requestAnimationFrame(r));
  window.sh = {
    frame,
    async frames(n) { for (let i = 0; i < n; i++) await frame(); },
    get ctx() { return window.__op2.ctx; },
    state() {
      const { ctx, game } = window.__op2;
      const s = ctx.contracts.shop;
      return {
        game: game.state, screen: ctx.hud.screens.name, credits: s?.credits, wave: ctx.waves.wave, phase: ctx.waves.phase,
        owned: [...ctx.weapons.owned], mods: [...ctx.weapons.mods], fitted: [...ctx.weapons.fitted], gun: ctx.weapons.current,
        focus: document.querySelector('.pc-row.focus .pc-k')?.textContent ?? null, card: document.querySelector('.pc-name')?.textContent ?? null,
        backdrop: ctx.render.backdrop ? 'on' : 'off',
      };
    },
    async play() {
      const { game, ctx } = window.__op2;
      if (game.state !== 'playing') game.setState('playing');
      ctx.hud.screens.show('none');
      await this.frames(10);
    },
  };
}

async function until(page, h, test, tries = 160) {
  for (let i = 0; i < tries; i++) {
    if (await page.evaluate(test)) return true;
    await h.sleep(250);
  }
  return false;
}

async function menu(page, h) {
  const out = {};
  out.playing = await until(page, h, () => window.__op2?.game?.state === 'playing' && window.__op2.ctx.contracts.shop != null);
  // A long break after wave 10, with money to spend.
  await page.evaluate(() => {
    const { ctx } = window.__op2;
    ctx.waves.wave = 10;
    ctx.waves.phase = 'intermission';
    ctx.waves.nextWaveIn = 600;
    ctx.contracts.shop.credits = 7400;
    for (const e of [...ctx.enemies.alive]) e.health = 0;
  });
  // A supply pod, sent as a wave's clear sends one (its own landing logic, so the spot changes from run to run).
  out.pod = await page.evaluate(async () => {
    const { ctx } = window.__op2;
    const pods = ctx.progression.pods;
    const me = ctx.player.position.clone();
    pods.call();
    const spot = pods.entries.find(e => e.active).position.clone();
    window.sh.pod = spot;
    return { spot: spot.toArray().map(n => Math.round(n)), from: me.toArray().map(n => Math.round(n)), metres: Math.round(spot.distanceTo(me)) };
  });
  // The player `dist` m off the pod, facing it: the first of eight bearings where he stands on its floor (the map is cluttered,
  // and a spot in a pit or by a wall puts some of them inside a building or on its roof).
  // With `sky`, under open sky too.
  const look = (dist, pitch, sky = false) => page.evaluate(async ([dist, pitch, sky]) => {
    const { ctx } = window.__op2;
    const P = ctx.player;
    const s = window.sh.pod;
    const a0 = Math.atan2(P.position.x - s.x, P.position.z - s.z);
    for (let k = 0; k < 8; k++) {
      const a = a0 + (k * Math.PI) / 4;
      const at = s.clone();
      at.x += Math.sin(a) * dist;
      at.z += Math.cos(a) * dist;
      at.y = s.y + 1;
      P.teleport(at, a);
      P.pitch = pitch;
      await window.sh.frames(8);
      const open = !sky || ctx.progression.pods.probe.headroom(at.x, at.y + 1, at.z, 60) >= 60;
      if (Math.abs(P.position.y - at.y) < 0.8 && open) return k;
    }
    return -1;
  }, [dist, pitch, sky]);
  // Caught mid-fall, about 28 m up, looked up at from 12 m off (farther, the map's roofs and walls get in the way), its beacon
  // already over the spot. Only the pods stop for the still.
  out.fallingFrom = await look(12, 0.95, true);
  out.falling = await page.evaluate(async () => {
    const pods = window.__op2.ctx.progression.pods;
    const pod = pods.pods.find(p => p.phase !== 'spent');
    for (let i = 0; i < 900 && !(pod.phase === 'falling' && pod.group.position.y - window.sh.pod.y < 28); i++) await window.sh.frame();
    pods.update = () => {};
    return Math.round(pod.group.position.y - window.sh.pod.y);
  });
  await h.sleep(300);
  await h.shot('pod-falling');
  await page.evaluate(() => delete window.__op2.ctx.progression.pods.update);
  out.landed = await until(page, h, () => window.__op2.ctx.progression.pods.pods.some(p => p.phase === 'open'), 120);
  out.landedFrom = await look(10, 0.28);
  await h.sleep(600);
  await h.shot('pod-landed');
  out.promptFrom = await look(3, -0.12);
  out.near = await until(page, h, () => window.__op2.ctx.progression.pods.supplyNear, 40);
  await h.sleep(400);
  await h.shot('pod-prompt');
  await h.press('KeyE', 80);
  await h.sleep(1200);
  out.opened = await page.evaluate(() => window.sh.state());
  // Down to the Judge, a gun turning, twice a moment apart.
  await h.press('ArrowDown', 60);
  await h.sleep(900);
  await h.shot('menu');
  await h.sleep(1800);
  await h.shot('menu-turned');
  out.judge = await page.evaluate(() => window.sh.state());
  // The Ultramag: wave 14, locked after wave 10.
  for (let i = 0; i < 5; i++) await h.press('ArrowDown', 60);
  await h.sleep(900);
  out.locked = await page.evaluate(() => ({ ...window.sh.state(), why: document.querySelector('.pc-state')?.textContent }));
  await h.shot('locked');
  // Buy the Deuce: up three.
  for (let i = 0; i < 3; i++) await h.press('ArrowUp', 60);
  await h.press('Enter', 60);
  await h.sleep(500);
  out.boughtDeuce = await page.evaluate(() => ({ ...window.sh.state(), note: document.querySelector('.pc-note')?.textContent }));
  // The mods page: buy the suppressor, then the red dot and the Raufoss rounds.
  await h.press('ArrowRight', 60);
  await h.sleep(900);
  await h.shot('mods');
  await h.press('Enter', 60);
  await h.sleep(900);
  await h.shot('mods-fitted');
  await h.press('ArrowDown', 60);
  await h.press('Enter', 60);
  await h.press('ArrowDown', 60);
  await h.press('Enter', 60);
  await h.sleep(900);
  await h.shot('mods-raufoss');
  out.mods = await page.evaluate(() => window.sh.state());
  await h.press('Escape', 80);
  await h.sleep(500);
  await page.evaluate(() => window.sh.play());
  out.closed = await page.evaluate(() => window.sh.state());

  // The suppressed SMG, firing.
  await page.evaluate(async () => {
    const { ctx } = window.__op2;
    ctx.weapons.switchTo('smg');
    await window.sh.frames(40);
    ctx.player.pitch = 0.05;
    ctx.input.simulate('fire', true);
    await window.sh.frames(9);
  });
  await h.shot('suppressed');
  await page.evaluate(async () => {
    await window.sh.frames(2);
  });
  await h.shot('suppressed-2');
  out.fired = await page.evaluate(() => {
    const { ctx } = window.__op2;
    ctx.input.simulate('fire', false);
    return { mag: ctx.weapons.ammo('smg').mag, interval: ctx.weapons.slots?.smg?.def?.interval };
  });
  return out;
}

async function range(page, h) {
  const out = {};
  out.ready = await until(page, h, () => window.__op2?.game?.state === 'playing' && window.__lab != null);
  // The panel's rows, with the red dot granted and the Raufoss rounds fitted through them.
  await page.keyboard.press('Backquote');
  await h.sleep(400);
  out.rows = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.lab-panel .lab-row')].filter(r => /Suppressor|Red dot|Raufoss/.test(r.textContent));
    const [sup, dot, rauf] = rows;
    dot.querySelector('button').click();
    rauf.querySelectorAll('button')[1].click();
    rows[0].scrollIntoView({ block: 'center' });
    const { ctx } = window.__op2;
    return { rows: rows.map(r => r.textContent), mods: [...ctx.weapons.mods], fitted: [...ctx.weapons.fitted] };
  });
  await h.sleep(500);
  await h.shot('cheat-rows');
  out.afterFit = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.lab-panel .lab-row')].filter(r => /Red dot/.test(r.textContent));
    rows[0].querySelectorAll('button')[1].click();
    const { ctx } = window.__op2;
    return { fitted: [...ctx.weapons.fitted] };
  });
  await h.sleep(300);
  await h.shot('cheat-rows-fitted');
  await page.keyboard.press('Backquote');
  await h.sleep(300);

  // The SMG's flash and tracers leave from the can's mouth while the suppressor is on: metres of view between the two muzzles.
  out.muzzle = await page.evaluate(async () => {
    const { ctx } = window.__op2;
    const V = ctx.player.position.constructor;
    ctx.weapons.switchTo('smg');
    await window.sh.frames(40);
    const bare = ctx.viewmodel.muzzle(new V()).clone();
    ctx.weapons.grantMod('suppressor');
    ctx.weapons.fitMod('suppressor', true);
    await window.sh.frames(3);
    const can = ctx.viewmodel.muzzle(new V()).clone();
    ctx.weapons.fitMod('suppressor', false);
    return Number(bare.distanceTo(can).toFixed(3));
  });

  // The Harrow's red dot, aimed down the range.
  await page.evaluate(async () => {
    const { ctx } = window.__op2;
    ctx.weapons.give('harrow');
    ctx.weapons.switchTo('harrow');
    await window.sh.frames(40);
    ctx.player.pitch = 0;
    ctx.input.simulate('aim', true);
    await window.sh.frames(50);
  });
  await h.shot('reddot-ads');
  await page.evaluate(async () => {
    const { ctx } = window.__op2;
    ctx.input.simulate('aim', false);
    await window.sh.frames(30);
  });
  await h.shot('reddot-hip');

  // The Sabot, Raufoss fitted, into the gallery's first wall with a man behind it.
  out.raufoss = await page.evaluate(async () => {
    const { ctx } = window.__op2;
    window.__lab.gallery();
    await window.sh.frames(30);
    ctx.weapons.give('sabot');
    ctx.weapons.switchTo('sabot');
    await window.sh.frames(40);
    // The world slowed right down, so the burst is still in the air for the still at a headless frame rate.
    ctx.input.simulate('fire', true);
    await window.sh.frames(1);
    ctx.time.pushScale('shopShot', 0.03, 0, 0);
    ctx.input.simulate('fire', false);
    await window.sh.frames(1);
    return { mode: ctx.weapons.ammoMode, bursts: ctx.combat.bursts?.stats?.bursts };
  });
  await h.shot('raufoss-hit');
  await page.evaluate(() => window.sh.frames(2));
  await h.shot('raufoss-hit-2');
  await page.evaluate(() => window.__op2.ctx.time.popScale('shopShot'));
  return out;
}
