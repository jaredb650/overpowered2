// The akimbo mod and the Gun Kata brain chip in the real Crucible: the akimbo SMG at the hip and zoomed (right click), the
// akimbo Ultramag, an akimbo reload half way (both guns down off the screen), a Gun Kata burst half way with men all round,
// and the shop's akimbo rows and brain chip row.
//   OP2_NO_HMR=1 npx vite --port 5201 --strictPort &
//   node tools/shot.mjs --port 5201 --url "/?autostart=1" --script tools/scripts/akimbo-live.mjs --wait 500 --timeout 300 \
//     --dpr 2 --w 1440 --h 900 --quiet --out tools/out/akimbo/live.png
// AK_STEPS (comma list, default all): guns, kata, shop.
const STEPS = (process.env.AK_STEPS ?? 'guns,kata,shop').split(',');
function prelude() {
  const frame = () => new Promise(r => requestAnimationFrame(r));
  window.ak = {
    frame,
    async frames(n) { for (let i = 0; i < n; i++) await frame(); },
    /** The player at the spawn, the waves held, nobody about; `men` husks set round him at `ring` m, all the way round. */
    async stage(men = 0, ring = 12, front = false) {
      const { ctx } = window.__op2;
      const P = ctx.player;
      const V = P.eye.constructor;
      ctx.waves.update = () => {};
      P.modifiers.invulnerable = true;
      for (const e of [...ctx.enemies.alive]) e.health = 0;
      ctx.enemies.killAll?.('bench');
      await this.frames(10);
      const s = ctx.world.playerSpawns[0];
      P.teleport(s.position.clone(), 0);
      P.pitch = -0.04;
      await this.frames(10);
      const ground = (x, y, z) => {
        const hit = { point: new V(), normal: new V(), distance: 0, surface: 'concrete', collider: null };
        return ctx.physics.raycastInto(new V(x, y + 1.5, z), new V(0, -1, 0), 40, 1, hit) ? hit.point.clone() : new V(x, y, z);
      };
      const f = P.forward;
      for (let i = 0; i < men; i++) {
        // Front men spread across the view; the rest round the circle.
        const a = front ? (i - (men - 1) / 2) * 0.22 : (i / men) * Math.PI * 2;
        const d = ring + (i % 3) * 3;
        const dx = f.x * Math.cos(a) - f.z * Math.sin(a), dz = f.z * Math.cos(a) + f.x * Math.sin(a);
        const e = ctx.enemies.spawn('husk', ground(P.eye.x + dx * d, P.eye.y, P.eye.z + dz * d));
        if (e) e.speed = 0;
      }
      await this.frames(20);
      return ctx.enemies.alive.length;
    },
    gun(id, mod) {
      const w = window.__op2.ctx.weapons;
      w.give(id);
      if (mod) { w.grantMod(mod); w.fitMod(mod, true); }
      w.switchTo(id);
      w.refillMagazines();
      return { gun: w.current, akimbo: w.akimbo, ammo: { ...w.ammo() }, fitted: [...w.fitted] };
    },
    aim(on) { window.__op2.ctx.input.simulate('aim', on); },
  };
}

async function until(page, h, test, tries = 200, ms = 250) {
  for (let i = 0; i < tries; i++) {
    if (await page.evaluate(test)) return true;
    await h.sleep(ms);
  }
  return false;
}

export default async function akimboLive(page, h) {
  await page.evaluate(prelude);
  const out = {};
  out.playing = await until(page, h, () => window.__op2?.game?.state === 'playing' && window.__op2.ctx.contracts?.chips != null);
  out.stage = await page.evaluate(() => window.ak.stage(5, 16, true));
  await page.evaluate(() => { window.__op2.ctx.weapons.aimHold = true; });

  if (STEPS.includes('guns')) await guns(page, h, out);
  if (STEPS.includes('kata')) await kata(page, h, out);
  if (STEPS.includes('shop')) await shop(page, h, out);
  return out;
}

async function guns(page, h, out) {
  // The SMG pair at the hip, then zoomed on right click.
  out.smg = await page.evaluate(() => window.ak.gun('smg', 'smgAkimbo'));
  await h.sleep(1200);
  await h.shot('smg-hip');
  await page.evaluate(() => window.ak.aim(true));
  await h.sleep(700);
  await h.shot('smg-aim');
  out.aimed = await page.evaluate(() => ({ fov: window.__op2.ctx.render.camera.fov, aim: window.__op2.ctx.weapons.aim }));
  await page.evaluate(() => window.ak.aim(false));
  await h.sleep(500);

  // The Ultramag pair, a shot just gone from the left.
  out.ultramag = await page.evaluate(() => window.ak.gun('ultramag', 'ultramagAkimbo'));
  await h.sleep(1200);
  await h.shot('ultramag-hip');
  await page.evaluate(() => window.__op2.ctx.input.simulate('fire', true));
  await h.sleep(60);
  await page.evaluate(() => window.__op2.ctx.input.simulate('fire', false));
  await h.sleep(500);
  await page.evaluate(() => window.__op2.ctx.input.simulate('fire', true));
  await h.sleep(40);
  await page.evaluate(() => window.__op2.ctx.input.simulate('fire', false));
  await h.shot('ultramag-fire');

  // A reload half way: both guns down off the screen.
  out.reload = await page.evaluate(async () => {
    const w = window.__op2.ctx.weapons;
    w.ammo().mag = 3;
    window.__op2.ctx.input.simulate('reload', true);
    await window.ak.frames(2);
    window.__op2.ctx.input.simulate('reload', false);
    return { reloading: w.reloading, magSize: w.ammo().magSize };
  });
  await h.sleep(300);
  await h.shot('reload-start');
  await until(page, h, () => window.__op2.ctx.weapons.reloadProgress >= 0.45, 40, 50);
  out.reloadMid = await page.evaluate(() => window.__op2.ctx.weapons.reloadProgress);
  await h.shot('reload-mid');
  await until(page, h, () => !window.__op2.ctx.weapons.reloading, 40, 100);
  await h.sleep(400);
  await h.shot('reload-done');
}

async function kata(page, h, out) {
  // Gun Kata: men all round, the brain chip fitted, T.
  out.kataStage = await page.evaluate(() => window.ak.stage(9, 9));
  out.kataGun = await page.evaluate(() => window.ak.gun('smg', 'smgAkimbo'));
  await h.sleep(900);
  out.kata = await page.evaluate(() => {
    const chips = window.__op2.ctx.contracts.chips;
    chips.rack.fit('kata', true);
    chips.index = chips.rack.fitted.indexOf('kata');
    return chips.rack.fitted;
  });
  await h.sleep(200);
  await h.press('KeyT', 40);
  await h.sleep(380);
  await h.shot('kata-mid');
  await h.sleep(220);
  await h.shot('kata-late');
  await h.sleep(1200);
  out.kataAfter = await page.evaluate(() => ({
    alive: window.__op2.ctx.enemies.alive.filter(e => e.alive).length, wait: window.__op2.ctx.contracts.chips.kataWait,
    mag: window.__op2.ctx.weapons.ammo().mag,
  }));
  await h.shot('kata-after');

  // The needs-akimbo gate with one gun.
  out.gate = await page.evaluate(async () => {
    const { ctx } = window.__op2;
    ctx.weapons.fitMod('smgAkimbo', false);
    ctx.contracts.chips.kataWait = 0;
    await window.ak.frames(5);
    return ctx.weapons.akimbo;
  });
  await h.press('KeyT', 40);
  await h.sleep(200);
  await h.shot('kata-gate');
  out.gateWait = await page.evaluate(() => window.__op2.ctx.contracts.chips.kataWait);
}

async function shop(page, h, out) {
  // The shop: a break, money, every akimbo gun owned, the mods page down to the akimbo rows, then the brain chip row.
  await page.evaluate(async () => {
    const { ctx } = window.__op2;
    ctx.waves.wave = 12;
    ctx.waves.phase = 'intermission';
    ctx.waves.nextWaveIn = 600;
    ctx.contracts.shop.credits = 9000;
    for (const g of ['rivet', 'judge', 'ultramag', 'autoraffica']) ctx.weapons.give(g);
    ctx.events.emit('shop:open', {});
    await window.ak.frames(20);
  });
  await h.sleep(800);
  await h.press('ArrowRight', 60);
  await h.sleep(600);
  const rows = await page.evaluate(() => [...document.querySelectorAll('.pc-row')].map(r => r.textContent));
  const first = rows.findIndex(t => /Akimbo/.test(t));
  out.rows = rows.filter(t => /Akimbo/.test(t));
  const at = await page.evaluate(() => [...document.querySelectorAll('.pc-row')].findIndex(r => r.classList.contains('focus')));
  for (let i = Math.max(0, at); i < first + 1; i++) await h.press('ArrowDown', 30);
  await h.sleep(900);
  await h.shot('shop-akimbo');
  await h.press('Enter', 60);
  await h.sleep(900);
  await h.shot('shop-akimbo-bought');
  await h.press('ArrowRight', 60);
  await h.sleep(600);
  const chipRows = await page.evaluate(() => [...document.querySelectorAll('.pc-row')].map(r => r.textContent));
  const kataRow = chipRows.findIndex(t => /Gun Kata/.test(t));
  out.kataRow = chipRows[kataRow];
  const at2 = await page.evaluate(() => [...document.querySelectorAll('.pc-row')].findIndex(r => r.classList.contains('focus')));
  for (let i = Math.max(0, at2); i < kataRow; i++) await h.press('ArrowDown', 30);
  await h.sleep(900);
  await h.shot('shop-kata');
}
