// The Awl's extended barrel in the real Crucible: at the hip, in the scope, and one AP round on the long barrel through two
// Brutes standing in line (first person, then from the side with the clock held); then the akimbo Ultramags wearing their
// reflex sights.
//   OP2_NO_HMR=1 npx vite --port 5210 --strictPort &
//   node tools/shot.mjs --port 5210 --url "/?autostart=1" --script tools/scripts/awl-mods-live.mjs --wait 500 --timeout 300 \
//     --dpr 2 --w 1440 --h 900 --quiet --out tools/out/awl-mods/live.png
function prelude() {
  const frame = () => new Promise(r => requestAnimationFrame(r));
  window.aw = {
    frame,
    async frames(n) { for (let i = 0; i < n; i++) await frame(); },
    /** Waits `seconds` of game time, so a slow machine's long frames do not cut a step short. */
    async wait(seconds) {
      const t = window.__op2.ctx.time;
      const end = t.playerElapsed + seconds;
      while (t.playerElapsed < end) await frame();
    },
    /** The player at the spawn, the waves held, nobody about. */
    async stage() {
      const { ctx } = window.__op2;
      const P = ctx.player;
      ctx.waves.update = () => {};
      // Perks rewrite `modifiers.invulnerable` every frame: nothing reaches the player at all instead.
      P.takeDamage = () => {};
      delete ctx.enemies.update;
      for (const e of [...ctx.enemies.alive]) e.health = 0;
      ctx.enemies.killAll?.('bench');
      await this.frames(10);
      const s = ctx.world.playerSpawns[0];
      P.teleport(s.position.clone(), 0);
      P.pitch = 0;
      await this.frames(10);
      window.__lab.settings.overlay = false;
      window.__lab.settings.arsenal = false;
    },
    ground(x, y, z) {
      const { ctx } = window.__op2;
      const V = ctx.player.eye.constructor;
      const hit = { point: new V(), normal: new V(), distance: 0, surface: 'concrete', collider: null };
      return ctx.physics.raycastInto(new V(x, y + 1.5, z), new V(0, -1, 0), 40, 1, hit) ? hit.point.clone() : new V(x, y, z);
    },
    gun(id, mods) {
      const w = window.__op2.ctx.weapons;
      w.give(id);
      for (const m of mods) { w.grantMod(m); w.fitMod(m, true); }
      w.switchTo(id);
      w.refillMagazines();
      return { gun: w.current, akimbo: w.akimbo, fitted: [...w.fitted] };
    },
    /** Pins the game clock (every dt reads 0) for a still at an exact moment, or lets it run again. Rendering goes on. */
    hold(on) {
      const t = window.__op2.ctx.time;
      for (const k of ['realDt', 'dt', 'playerDt']) {
        if (on) Object.defineProperty(t, k, { get: () => 0, set: () => {}, configurable: true });
        else { delete t[k]; t[k] = 0; }
      }
    },
  };
}

async function until(page, h, test, tries = 200, ms = 250) {
  for (let i = 0; i < tries; i++) {
    if (await page.evaluate(test)) return true;
    await h.sleep(ms);
  }
  return false;
}

export default async function awlModsLive(page, h) {
  await page.evaluate(prelude);
  const out = {};
  out.playing = await until(page, h, () => window.__op2?.game?.state === 'playing');
  await page.evaluate(() => { window.__op2.ctx.player.takeDamage = () => {}; window.__op2.ctx.waves.update = () => {}; });
  await page.mouse.click(300, 400);
  await page.evaluate(() => window.aw.stage());
  await page.evaluate(() => {
    const { ctx } = window.__op2;
    ctx.weapons.aimHold = true;
    window.aw.traces = [];
    const tracer = ctx.fx.tracer.bind(ctx.fx);
    ctx.fx.tracer = (from, to, kind) => {
      window.aw.traces.push({ kind, from: from.toArray(), to: to.toArray() });
      return tracer(from, to, kind);
    };
  });

  // The long barrel at the hip, then in the scope.
  out.barrel = await page.evaluate(() => window.aw.gun('awl', ['awlBarrel']));
  await page.evaluate(() => window.aw.wait(0.9));
  await h.shot('hip-barrel');
  await page.evaluate(() => window.__op2.ctx.input.simulate('aim', true));
  await page.evaluate(() => window.aw.wait(0.9));
  out.scoped = await page.evaluate(() => window.__op2.ctx.weapons.scoped);
  await h.shot('scoped-barrel');
  await page.evaluate(() => window.__op2.ctx.input.simulate('aim', false));
  await page.evaluate(() => window.aw.wait(0.5));

  // Two Brutes in line ahead, held still; AP on the long barrel; the round at the first one's head.
  out.line = await page.evaluate(async () => {
    const { ctx } = window.__op2;
    const P = ctx.player;
    const f = P.forward.clone().setY(0).normalize();
    const men = [];
    for (const d of [13, 15]) {
      const at = window.aw.ground(P.eye.x + f.x * d, P.position.y, P.eye.z + f.z * d);
      const e = ctx.enemies.spawn('brute', at);
      if (e) { e.speed = 0; e.yaw = Math.atan2(-f.x, -f.z); men.push(e); }
    }
    await window.aw.wait(1);
    window.aw.men = men;
    return men.map(e => ({ uid: e.uid, armor: Math.round(e.armor), health: e.health, at: e.position.toArray().map(v => +v.toFixed(2)) }));
  });
  out.ap = await page.evaluate(() => window.aw.gun('awl', ['awlBarrel', 'awlAp']));
  await page.evaluate(() => window.aw.wait(0.7));
  out.aimed = await page.evaluate(async () => {
    const { ctx } = window.__op2;
    const P = ctx.player;
    const [a, b] = window.aw.men;
    const V = P.eye.constructor;
    // The height through the first man that the game's own body ray says passes through both, heads first.
    const dir = new V();
    let best = null;
    let onA = 0, onB = 0;
    // A grid across the first man (they never spawn quite in line): sideways by height.
    const side = new V(-(a.position.z - P.eye.z), 0, a.position.x - P.eye.x).normalize();
    for (let k = 0; k < 41 * 66; k++) {
      const off = -0.8 + (k % 41) * 0.04;
      const y = a.position.y + 2.3 - Math.floor(k / 41) * 0.02;
      const at = new V(a.position.x, y, a.position.z).addScaledVector(side, off);
      dir.subVectors(at, P.eye).normalize();
      const hits = ctx.enemies.raycastAll(P.eye, dir, 40, 4).map(h => ({ uid: h.enemy.uid, region: h.region }));
      if (hits.some(h => h.uid === a.uid)) onA++;
      if (hits.some(h => h.uid === b.uid)) onB++;
      const both = hits.some(h => h.uid === a.uid) && hits.some(h => h.uid === b.uid);
      if (!both) continue;
      // Heads first, then the trunk; an arm is a thin, swinging target.
      const heads = hits.filter(h => h.region === 'head').length;
      const score = hits.reduce((n, h) => n + (h.region === 'head' ? 4 : ['chest', 'abdomen', 'neck', 'pelvis'].includes(h.region) ? 2 : 1), 0);
      if (!best || score > best.score) best = { y, off, heads, score, hits, dir: dir.toArray() };
      if (heads >= 2) break;
    }
    if (!best) return { found: false, onA, onB };
    // Player.forward is (-sin yaw cos pitch, sin pitch, -cos yaw cos pitch).
    const [dx, dy, dz] = best.dir;
    P.yaw = Math.atan2(-dx, -dz);
    P.pitch = Math.asin(dy);
    // Still from here to the shot, so the line found is the line fired.
    ctx.enemies.update = () => {};
    await window.aw.frames(2);
    return { found: true, ...best, pitch: P.pitch, yaw: P.yaw };
  });
  // Fired from the scope; it drops out for the bolt and comes back as it locks, over the hanging trail.
  await page.evaluate(() => window.__op2.ctx.input.simulate('aim', true));
  await page.evaluate(() => window.aw.wait(0.6));
  await page.evaluate(async () => {
    const { ctx } = window.__op2;
    window.aw.traces.length = 0;
    ctx.enemies.update = () => {};
    ctx.input.simulate('fire', true);
    await window.aw.frames(2);
    ctx.input.simulate('fire', false);
    await window.aw.frames(4);
    window.aw.hold(true);
  });
  await page.evaluate(() => window.aw.frames(3));
  await h.shot('collateral-fp');
  out.collateral = await page.evaluate(() => ({
    men: window.aw.men.map(e => ({ alive: e.alive, health: Math.round(e.health), armor: Math.round(e.armor) })),
    traces: window.aw.traces.map(t => ({ kind: t.kind, from: t.from.map(v => +v.toFixed(2)), to: t.to.map(v => +v.toFixed(2)) })),
    state: window.__op2.game.state,
  }));
  // From the side of the line, a few metres off, looking across it.
  await page.evaluate(() => {
    const { ctx } = window.__op2;
    const t = window.aw.traces[0];
    if (!t) return;
    const V = ctx.player.eye.constructor;
    const from = new V(...t.from);
    const to = new V(...t.to);
    const dir = to.clone().sub(from).normalize();
    const side = new V(-dir.z, 0, dir.x);
    const mid = from.clone().lerp(window.aw.men[0].position.clone().setY(from.y), 0.75);
    const eye = mid.clone().addScaledVector(side, 6).add(new V(0, 0.6, 0));
    window.aw.cameraUpdate = ctx.camera.update.bind(ctx.camera);
    window.aw.viewUpdate = ctx.viewmodel.update.bind(ctx.viewmodel);
    ctx.camera.update = () => {};
    ctx.viewmodel.update = () => {};
    ctx.viewmodel.root.visible = false;
    const cam = ctx.render.camera;
    cam.position.copy(eye);
    cam.lookAt(mid.clone().addScaledVector(dir, 5));
    cam.fov = 75;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  });
  await page.evaluate(() => window.aw.frames(3));
  await h.shot('collateral-side');
  await page.evaluate(() => {
    const { ctx } = window.__op2;
    window.aw.hold(false);
    if (window.aw.cameraUpdate) ctx.camera.update = window.aw.cameraUpdate;
    if (window.aw.viewUpdate) ctx.viewmodel.update = window.aw.viewUpdate;
    ctx.viewmodel.root.visible = true;
  });
  await page.evaluate(() => window.aw.wait(0.75));
  out.rescoped = await page.evaluate(() => window.__op2.ctx.weapons.scoped);
  await h.shot('scoped-trail');
  await page.evaluate(() => window.__op2.ctx.input.simulate('aim', false));
  await page.evaluate(() => window.aw.wait(1));
  out.after = await page.evaluate(() => window.aw.men.map(e => ({ alive: e.alive, health: Math.round(e.health) })));

  // The akimbo Ultramags, their reflex sights on.
  await page.evaluate(() => window.aw.stage());
  out.akimbo = await page.evaluate(() => window.aw.gun('ultramag', ['ultramagDot', 'ultramagAkimbo']));
  await page.evaluate(() => window.aw.wait(1.2));
  await h.shot('akimbo-dots');
  await page.evaluate(() => window.__op2.ctx.input.simulate('aim', true));
  await page.evaluate(() => window.aw.wait(0.7));
  await h.shot('akimbo-dots-zoom');
  await page.evaluate(() => window.__op2.ctx.input.simulate('aim', false));
  return out;
}
