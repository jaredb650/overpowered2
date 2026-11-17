// The weapon light (weapons/mods.ts LIGHT_GUNS) on every gun that takes it, in the viewmodel sandbox: first person at the hip and
// aimed, a close camera on the light with the arms in, and the shop's studio. LIGHT_ONLY=smg,judge picks guns.
//   OP2_NO_HMR=1 npx vite --port 5194 --strictPort
//   node tools/shot.mjs --port 5194 --dpr 2 --w 1440 --h 900 --wait 4000 --timeout 600 --quiet \
//     --url "/?sandbox=viewmodels&manual=1&engine=1&weapon=smg" --script tools/scripts/light-shots.mjs --out tools/out/light/x.png
const GUNS = ['smg', 'gimlet', 'harrow', 'awl', 'shotgun', 'thresher', 'deuce', 'judge', 'rivet', 'ultramag', 'autoraffica'];
/** Mods that share the light's neighbourhood, fitted beside it so a clash shows. */
const NEIGHBOURS = { smg: ['suppressor'], gimlet: ['gimletGl', 'gimletAcog', 'gimletCan'], ultramag: ['ultramagLam', 'ultramagCan', 'ultramagDot'], harrow: ['reddot'] };

export default async function lightShots(page, helpers) {
  await page.waitForFunction(() => !!window.__vm, { timeout: 60000 });
  const step = seconds => page.evaluate(value => window.__vm.step(value), seconds);
  const shot = async name => { await helpers.sleep(80); await helpers.shot(name); };
  const only = (process.env.LIGHT_ONLY ?? GUNS.join(',')).split(',');
  const views = (process.env.LIGHT_VIEWS ?? 'hip,ads,close,studio').split(',');
  await page.evaluate(() => window.__vm.ctx.render.renderer.setPixelRatio(2));
  const fit = list => page.evaluate(l => { window.__vm.fakeWeapons.fitted = new Set(l); }, list);
  const equip = async id => {
    await page.evaluate(w => window.__vm.rig.equip(w, 0.01), id);
    await step(0.6);
  };
  /** A close camera off the light, in the model's frame (offset from the light), arms left in. */
  const close = async (id, name, off) => {
    await page.evaluate(([w, o]) => {
      const view = window.__vm;
      const root = view.rig.allDefs[w].model.root;
      const cam = view.ctx.render.viewCamera;
      if (!view.__update) view.__update = view.rig.update.bind(view.rig);
      view.rig.update = (...args) => {
        view.__update(...args);
        root.updateMatrixWorld(true);
        const light = view.rig.allDefs[w].model.parts.light;
        const at = light.getWorldPosition(root.position.clone());
        const local = root.worldToLocal(at.clone());
        cam.position.copy(root.localToWorld(local.clone().add({ x: o[0], y: o[1], z: o[2] })));
        cam.lookAt(at);
        cam.updateMatrixWorld();
      };
    }, [id, off]);
    await step(0.02);
    await shot(name);
  };
  const free = () => page.evaluate(() => {
    const view = window.__vm;
    if (view.__update) { view.rig.update = view.__update; view.__update = null; }
    const cam = view.ctx.render.viewCamera;
    cam.position.set(0, 0, 0);
    cam.rotation.set(0, 0, 0);
    cam.updateMatrixWorld();
  });
  const studio = async (id, mods, name, yaw, pitch = 0) => {
    await page.evaluate(async ([w, list, y, x]) => {
      const view = window.__vm;
      if (!window.__stage) {
        const { GunStage } = await import('/src/ui/backdrop/gunstage.ts');
        const stage = new GunStage({ ...view.ctx, viewmodel: view.rig });
        stage.active = true;
        window.__stage = stage;
      }
      const stage = window.__stage;
      stage.show(w, new Set(list));
      stage.update(0);
      stage.camera.setViewOffset(innerWidth, innerHeight, 0, 0, innerWidth, innerHeight);
      stage.turntable.rotation.set(x, y, 0);
      view.ctx.render.render();
    }, [id, mods, yaw, pitch]);
    await shot(name);
  };
  const stopStage = () => page.evaluate(() => { if (window.__stage) { window.__stage.active = false; window.__stage = null; } });

  for (const gun of GUNS.filter(g => only.includes(g))) {
    const mods = [`${gun}Light`, ...(NEIGHBOURS[gun] ?? [])];
    await fit(mods);
    await equip(gun);
    if (views.includes('hip')) await shot(`${gun}-hip`);
    if (views.includes('ads')) {
      await page.evaluate(() => window.__vm.rig.setAim(1));
      await step(0.5);
      await shot(`${gun}-ads`);
      await page.evaluate(() => window.__vm.rig.setAim(0));
      await step(0.5);
    }
    if (views.includes('close')) {
      await close(gun, `${gun}-close`, [-0.16, 0.05, -0.1]);
      await close(gun, `${gun}-under`, [-0.1, -0.12, -0.06]);
      await free();
    }
    if (views.includes('studio')) {
      await studio(gun, mods, `${gun}-studio`, Math.PI / 2 - 0.5, 0.25);
      await stopStage();
    }
  }
  return page.evaluate(() => ({ dpr: devicePixelRatio, tris: Object.fromEntries(Object.entries(window.__vm.rig.allDefs).map(([k, d]) => [k, d.model.triangles])) }));
}
