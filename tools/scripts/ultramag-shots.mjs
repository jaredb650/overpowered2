// Ultramag renders: first-person idle beside the Rivet, the fire cycle stepped frame by frame (first person and a close
// camera over the port), the reload, then the shop studio from the left, the right and three-quarters behind.
// UMAG_MODS=ultramagCan,ultramagDot fits mods for the first-person shots; UMAG_STUDIO="none;ultramagCan;all" picks the studio
// sets (each a comma list, `all` the four), each shot from the left and three-quarters behind.
//   node tools/shot.mjs --port 5276 --dpr 2 --w 1440 --h 900 --wait 4000 \
//     --url "/?sandbox=viewmodels&manual=1&engine=1&weapon=ultramag" --script tools/scripts/ultramag-shots.mjs --out tools/out/ultramag2/u.png
const CYCLE = [['back', 0.02], ['open', 0.045], ['rise', 0.1], ['strip', 0.165], ['chamber', 0.205], ['home', 0.26]];
const RELOAD = [['mag-out', 0.3], ['mag-in', 0.6], ['locked', 0.75], ['release', 0.85], ['closed', 0.98]];

export default async function ultramagShots(page, helpers) {
  if (process.env.ULTRAMAG_ADS === '1') return adsShots(page, helpers);
  await page.waitForFunction(() => !!window.__vm, { timeout: 60000 });
  const step = seconds => page.evaluate(value => window.__vm.step(value), seconds);
  const shot = async name => { await helpers.sleep(80); await helpers.shot(name); };
  const only = (process.env.UMAG_ONLY ?? 'fp,cycle,hip,close,reload,studio').split(',');
  let hipPitch = null;
  await page.evaluate(() => {
    const view = window.__vm;
    view.ctx.render.renderer.setPixelRatio(2);
    view.ammo.magSize = 7;
    view.ammo.mag = 7;
  });
  const KIT = ['ultramagCan', 'ultramagDot', 'ultramagLam', 'ultramagMag'];
  const fitted = (process.env.UMAG_MODS ?? '').split(',').filter(Boolean);
  await page.evaluate(ids => { window.__vm.fakeWeapons.fitted = new Set(ids); }, fitted);
  const equip = async id => {
    await page.evaluate(weapon => window.__vm.rig.equip(weapon, 0.01), id);
    await step(0.6);
  };
  if (only.includes('fp')) {
    await equip('rivet');
    await shot('fp-rivet');
    await equip('ultramag');
    await shot('fp-idle');
    await page.evaluate(() => { window.__vm.rig.setAim(1); window.__vm.step(0.8); });
    await shot('fp-ads');
    await page.evaluate(() => { window.__vm.rig.setAim(0); window.__vm.step(0.8); });
  }
  const fireCycle = async (prefix, setup) => {
    await equip('ultramag');
    await page.evaluate(() => { window.__vm.ammo.mag = 6; window.__vm.rig.fire(1); });
    if (setup) await setup();
    let previous = 0;
    for (const [name, time] of CYCLE) {
      await step(time - previous);
      previous = time;
      await shot(`${prefix}-${name}`);
    }
    await step(0.5);
  };
  if (only.includes('cycle')) await fireCycle('fire');
  // The hip shot's recoil: stills at fixed times, and the muzzle's pitch against rest every 1/120 s through the interval.
  if (only.includes('hip')) {
    await equip('ultramag');
    const pitch = () => page.evaluate(() => {
      const root = window.__vm.rig.allDefs.ultramag.model.root;
      root.updateMatrixWorld(true);
      const e = root.matrixWorld.elements;
      return Math.asin(Math.max(-1, Math.min(1, -e[9] / Math.hypot(e[8], e[9], e[10]))));
    });
    const rest = await pitch();
    await page.evaluate(() => { window.__vm.ammo.mag = 6; window.__vm.rig.fire(1); });
    let previous = 0;
    for (const ms of [0, 40, 90, 160, 240]) {
      await step(Math.max(ms / 1000 - previous, 1 / 240));
      previous = Math.max(ms / 1000, previous + 1 / 240);
      await shot(`hip-${ms}`);
    }
    await step(0.5);
    await page.evaluate(() => { window.__vm.ammo.mag = 6; window.__vm.rig.fire(1); });
    const trace = [];
    for (let i = 0; i <= 43; i++) {
      trace.push(Math.round((await pitch() - rest) * 1000));
      await step(1 / 120);
    }
    await step(0.3);
    hipPitch = { mradUp: trace, min: Math.min(...trace), max: Math.max(...trace) };
  }
  // A close camera above and right of the port, behind the muzzle: what the eye would see with the gun held up to it.
  const closeCam = () => page.evaluate(() => {
    const view = window.__vm;
    const root = view.rig.allDefs.ultramag.model.root;
    root.updateMatrixWorld(true);
    const target = root.localToWorld(root.position.clone().set(0, 0.04, -0.02));
    const eye = root.localToWorld(root.position.clone().set(0.17, 0.2, 0.2));
    const cam = view.ctx.render.viewCamera;
    cam.position.copy(eye);
    cam.lookAt(target);
    cam.updateMatrixWorld();
    const update = view.rig.update.bind(view.rig);
    view.rig.update = () => { update(); cam.position.copy(eye); cam.lookAt(target); cam.updateMatrixWorld(); };
  });
  if (only.includes('close')) await fireCycle('close', closeCam);
  if (only.includes('reload')) {
    await page.evaluate(() => { window.__vm.ammo.mag = 0; window.__vm.rig.fire(1); });
    await step(0.4);
    await shot('close-last-round');
    await page.evaluate(() => window.__vm.rig.reload(1.3));
    let previous = 0;
    for (const [name, progress] of RELOAD) {
      await step((progress - previous) * 1.3);
      previous = progress;
      await shot(`close-reload-${name}`);
    }
    await step(0.3);
  }
  if (only.includes('studio')) {
    await page.evaluate(async () => {
      const view = window.__vm;
      const { GunStage } = await import('/src/ui/backdrop/gunstage.ts');
      view.ammo.mag = 7;
      const stage = new GunStage({ ...view.ctx, viewmodel: view.rig });
      stage.active = true;
      stage.update(0);
      const c = stage.camera;
      c.setViewOffset(innerWidth, innerHeight, 0, 0, innerWidth, innerHeight);
      // Drawn by the renderer's own backdrop path (bloom and composite), as the shop draws it.
      window.__stage = stage;
    });
    const turn = (y, x = 0.12) => page.evaluate(([yaw, pitch]) => {
      const table = window.__stage.turntable;
      table.rotation.set(pitch, yaw, 0);
      window.__vm.ctx.render.render();
    }, [y, x]);
    for (const set of (process.env.UMAG_STUDIO ?? 'none').split(';')) {
      const ids = set === 'all' ? KIT : set === 'none' ? [] : set.split(',');
      const label = set === 'none' ? 'bare' : set === 'all' ? 'kit' : ids.map(id => id.replace('ultramag', '').toLowerCase()).join('-');
      await page.evaluate(list => window.__stage.show('ultramag', new Set(list)), ids);
      await turn(Math.PI / 2);
      await shot(`studio-${label}-left`);
      await turn(-Math.PI / 2 + 0.75, 0.42);
      await shot(`studio-${label}-three-quarter`);
      if (set === 'all' || set === 'none') {
        await turn(-Math.PI / 2);
        await shot(`studio-${label}-right`);
      }
    }
  }
  return { hipPitch, dpr: await page.evaluate(() => devicePixelRatio), cost: await page.evaluate(() => {
    const model = window.__vm.rig.allDefs.ultramag.model;
    return { triangles: model.triangles, draws: model.draws };
  }) };
}

// Aimed at a chest-high point on a wall 20 m down the Test Range: where the front dot and the rear notch fall on the screen, and where a shot lands.
//   ULTRAMAG_ADS=1 node tools/shot.mjs --port 5276 --dpr 2 --w 1440 --h 900 --wait 500 --timeout 400 --url "/?map=range" \
//     --script tools/scripts/ultramag-shots.mjs --out tools/out/ultramag2/ads.png
async function adsShots(page, helpers) {
  for (let i = 0; i < 180; i++) {
    if (await page.evaluate(() => !!window.__lab && window.__op2?.game?.state === 'playing').catch(() => false)) break;
    await helpers.sleep(500);
  }
  await page.mouse.click(300, 400);
  await helpers.sleep(300);
  await page.evaluate(ids => { window.__umagMods = ids; }, (process.env.UMAG_MODS ?? '').split(',').filter(Boolean));
  const still = async name => {
    await page.evaluate(() => { window.__op2.ctx.time.paused = true; });
    await helpers.sleep(150);
    await helpers.shot(name);
    await page.evaluate(() => { window.__op2.ctx.time.paused = false; });
  };
  await page.evaluate(async () => {
    const { ctx } = window.__op2;
    const P = ctx.player;
    const V = P.position.constructor;
    const frame = () => new Promise(r => requestAnimationFrame(r));
    const wait = async seconds => { const end = ctx.time.playerElapsed + seconds; while (ctx.time.playerElapsed < end) await frame(); };
    P.modifiers.invulnerable = true;
    ctx.render.renderer.setPixelRatio(2);
    ctx.weapons.give('ultramag');
    ctx.weapons.switchTo('ultramag');
    for (const id of window.__umagMods ?? []) { ctx.weapons.grantMod(id); ctx.weapons.fitMod(id, true); }
    await wait(0.8);
    ctx.input.consumeLook();
    // The range's back wall stands at z = -16: from (0, 4) facing -z it is 20 m off, a chest-high point on it the target.
    P.teleport(new V(0, 0.1, 4), 0);
    await wait(0.4);
    P.pitch = Math.atan2(1.3 - (P.eye.y - P.position.y), 20);
    window.__umagHits = [];
    for (const name of ['impact', 'bloodHit']) {
      const original = ctx.fx[name].bind(ctx.fx);
      ctx.fx[name] = (position, ...rest) => { window.__umagHits.push(position.clone()); return original(position, ...rest); };
    }
    window.__umagMeasure = () => {
      const cam = ctx.render.camera;
      const view = ctx.render.viewCamera;
      const def = ctx.viewmodel.allDefs.ultramag;
      // A fitted optic brings its own sight point and, level, no rear.
      const optic = (window.__umagMods ?? []).map(id => def.mods?.[id]).find(look => look?.sight);
      const root = def.model.root;
      root.updateMatrixWorld(true);
      const ndc = local => {
        const v = root.localToWorld(new V(local[0], local[1], local[2]));
        v.project(view);
        return [Math.round(v.x * innerWidth / 2 * 10) / 10, Math.round(v.y * innerHeight / 2 * 10) / 10];
      };
      const hits = window.__umagHits.map(h => {
        const v = h.clone().project(cam);
        return [Math.round(v.x * innerWidth / 2 * 10) / 10, Math.round(v.y * innerHeight / 2 * 10) / 10, Math.round(h.distanceTo(P.eye) * 10) / 10];
      });
      const r = n => Math.round(n * 100) / 100;
      return { player: [r(P.position.x), r(P.position.z), r(P.yaw)], aim: Math.round(ctx.weapons.aim * 1000) / 1000, fov: Math.round(cam.fov * 100) / 100, frontDotPx: ndc(optic ? optic.sight : def.sight), rearNotchPx: optic ? null : ndc(def.rear), hitsPx: hits };
    };
  });
  await still('ads-hip');
  await page.evaluate(async () => {
    const { ctx } = window.__op2;
    ctx.input.simulate('aim', true);
    const frame = () => new Promise(r => requestAnimationFrame(r));
    const end = ctx.time.playerElapsed + 0.7;
    while (ctx.time.playerElapsed < end) await frame();
  });
  const before = await page.evaluate(() => window.__umagMeasure());
  await still('ads-aimed');
  await page.evaluate(async () => {
    const { ctx } = window.__op2;
    const frame = () => new Promise(r => requestAnimationFrame(r));
    ctx.input.simulate('fire', true);
    await frame(); await frame();
    ctx.input.simulate('fire', false);
    const end = ctx.time.playerElapsed + 0.08;
    while (ctx.time.playerElapsed < end) await frame();
  });
  await still('ads-shot');
  await page.evaluate(async () => {
    const { ctx } = window.__op2;
    const frame = () => new Promise(r => requestAnimationFrame(r));
    const end = ctx.time.playerElapsed + 0.9;
    while (ctx.time.playerElapsed < end) await frame();
  });
  const after = await page.evaluate(() => window.__umagMeasure());
  await still('ads-settled');
  await page.evaluate(() => window.__op2.ctx.input.simulate('aim', false));
  return { before, after };
}
