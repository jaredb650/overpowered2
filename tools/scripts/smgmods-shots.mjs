// The SMG's 50-round mag, mag tape and stock (weapons/mods.ts), with the light, the can and HP rounds beside them: hip, aimed,
// close cameras on the mag and the stock with the arms in, a reload half way with the tape on, and the shop's studio.
//   node tools/shot.mjs --port 5202 --dpr 2 --w 1440 --h 900 --wait 4000 --timeout 600 --quiet \
//     --url "/?sandbox=viewmodels&manual=1&engine=1&weapon=smg" --script tools/scripts/smgmods-shots.mjs --out tools/out/smgmods/x.png
const ALL = ['smgLight', 'suppressor', 'smgHp', 'smgMag', 'smgTape', 'smgStock'];

export default async function smgModShots(page, helpers) {
  await page.waitForFunction(() => !!window.__vm, { timeout: 60000 });
  const step = seconds => page.evaluate(value => window.__vm.step(value), seconds);
  const shot = async name => { await helpers.sleep(80); await helpers.shot(name); };
  await page.evaluate(() => window.__vm.ctx.render.renderer.setPixelRatio(2));
  const fit = async list => {
    await page.evaluate(l => { window.__vm.fakeWeapons.fitted = new Set(l); }, list);
    await page.evaluate(() => window.__vm.rig.equip('smg', 0.01));
    await step(0.6);
  };
  /** A camera held off `part` in the gun's frame, arms in; `hold` keeps the rig updating (a reload) under it. */
  const close = async (part, off, anchor = [0, 0, 0]) => {
    await page.evaluate(([p, o, k]) => {
      const view = window.__vm;
      const root = view.rig.allDefs.smg.model.root;
      const cam = view.ctx.render.viewCamera;
      if (!view.__update) view.__update = view.rig.update.bind(view.rig);
      view.rig.update = (...args) => {
        view.__update(...args);
        root.updateMatrixWorld(true);
        const partAt = view.rig.allDefs.smg.model.parts[p].getWorldPosition(root.position.clone());
        const local = root.worldToLocal(partAt.clone()).add({ x: k[0], y: k[1], z: k[2] });
        const at = root.localToWorld(local.clone());
        cam.position.copy(root.localToWorld(local.clone().add({ x: o[0], y: o[1], z: o[2] })));
        cam.lookAt(at);
        cam.updateMatrixWorld();
      };
    }, [part, off, anchor]);
    await step(0.02);
  };
  const free = () => page.evaluate(() => {
    const view = window.__vm;
    if (view.__update) { view.rig.update = view.__update; view.__update = null; }
    const cam = view.ctx.render.viewCamera;
    cam.position.set(0, 0, 0);
    cam.rotation.set(0, 0, 0);
    cam.updateMatrixWorld();
  });
  const studio = async (mods, name, yaw, pitch) => {
    await page.evaluate(async ([list, y, x]) => {
      const view = window.__vm;
      if (!window.__stage) {
        const { GunStage } = await import('/src/ui/backdrop/gunstage.ts');
        const stage = new GunStage({ ...view.ctx, viewmodel: view.rig });
        stage.active = true;
        window.__stage = stage;
      }
      const stage = window.__stage;
      stage.show('smg', new Set(list));
      stage.update(0);
      stage.camera.setViewOffset(innerWidth, innerHeight, 0, 0, innerWidth, innerHeight);
      stage.turntable.rotation.set(x, y, 0);
      view.ctx.render.render();
    }, [mods, yaw, pitch]);
    await shot(name);
  };

  const sets = { plain: ['smgLight'], mag: ['smgLight', 'smgMag'], tape: ['smgLight', 'smgTape'], stock: ['smgLight', 'smgStock'], all: ALL };
  for (const [name, mods] of Object.entries(sets)) {
    await fit(mods);
    await shot(`${name}-hip`);
  }
  // Everything on: aimed, then close on the mag from the left and from under (the hands), and on the stock.
  await fit(ALL);
  await page.evaluate(() => window.__vm.rig.setAim(1));
  await step(0.5);
  await shot('all-ads');
  await page.evaluate(() => window.__vm.rig.setAim(0));
  await step(0.5);
  await close('mag', [-0.22, -0.02, 0.05]); await shot('all-close-mag');
  await close('mag', [-0.12, -0.2, -0.12]); await shot('all-under');
  await close('stockFull', [-0.3, 0.05, 0.02], [0, 0.01, 0.22]); await shot('all-close-stock');
  await free();
  await fit(['smgLight', 'smgTape']);
  await close('mag', [-0.2, -0.03, 0.06]); await shot('tape-close-mag');
  await free();
  // A reload with the tape on (0.7 s): the mag on its way out, gone to the pouch, and coming back in.
  for (const [at, name] of [[0.17, 'reload-out'], [0.3, 'reload-pouch'], [0.38, 'reload-in']]) {
    await fit(['smgLight', 'smgTape', 'smgMag']);
    await page.evaluate(() => window.__vm.rig.reload(0.7));
    await step(at);
    await shot(name);
  }
  await fit(ALL);
  await studio(ALL, 'studio-all', Math.PI / 2 - 0.5, 0.25);
  await studio(ALL, 'studio-all-side', Math.PI / 2, 0.05);
  await studio(['smgLight', 'smgTape', 'smgStock'], 'studio-tape-stock', Math.PI / 2 - 0.5, 0.25);
  return page.evaluate(() => ({ dpr: devicePixelRatio, tris: window.__vm.rig.allDefs.smg.model.triangles }));
}
